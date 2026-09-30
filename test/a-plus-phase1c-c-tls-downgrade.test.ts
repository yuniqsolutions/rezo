/**
 * Phase 1c-c R3 — redirect policy must treat HTTPS -> HTTP as an origin
 * transition even when hostname and effective routing stay otherwise familiar.
 *
 * Each adapter runs in its own Node + tsx child. This keeps Fetch's necessary
 * self-signed-certificate bypass process-local and gives every probe fresh
 * adapter/module state. Wire observations come from real ephemeral HTTPS and
 * HTTP servers; a rejected request, missing callback, or skipped hop cannot
 * satisfy the expected ledger.
 */

import {
  execFile,
  execFileSync,
  type ExecFileSyncOptions,
} from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type AdapterName = 'http' | 'fetch';

interface CallbackObservation {
  method: string;
  ordinal: number;
  protocol: string;
  status: number;
  url: string;
}

interface WireObservation {
  authorization: string | null;
  encrypted: boolean;
  host: string | null;
  method: string;
  ordinal: number;
  path: string;
  persistent: string | null;
  transport: 'http' | 'https';
  oneHop: string | null;
}

interface ProbeResult {
  adapter: AdapterName;
  callbackLedger: CallbackObservation[];
  destinationPort: number;
  finalUrl: string;
  ok: true;
  parentTlsSetting: string | null;
  sourcePort: number;
  status: number;
  tlsBypass: boolean;
  wireLedger: WireObservation[];
}

interface TlsMaterial {
  certificatePath: string;
  keyPath: string;
}

const INHERITED_AUTHORIZATION = 'Bearer rezo-r3-inherited-placeholder';
const PERSISTENT_AUTHORIZATION = 'Bearer rezo-r3-persistent-placeholder';
const REISSUED_AUTHORIZATION = 'Bearer rezo-r3-reissued-placeholder';
const PERSISTENT_MARKER = 'rezo-r3-persistent-marker';
const ONE_HOP_MARKER = 'rezo-r3-one-hop-marker';
const CHILD_TIMEOUT_MS = 20_000;

const adapterUrls = {
  fetch: pathToFileURL(resolve('src/adapters/fetch.ts')).href,
  http: pathToFileURL(resolve('src/adapters/http.ts')).href,
} as const;
const rezoUrl = pathToFileURL(resolve('src/core/rezo.ts')).href;

let tlsDirectory: string | undefined;
let tlsMaterial: TlsMaterial | undefined;

function errorSummary(error: unknown): string {
  const boxed = Object(error);
  const code = Reflect.get(boxed, 'code');
  const message = Reflect.get(boxed, 'message');
  return [code, message]
    .filter((value) => value !== undefined)
    .map(String)
    .join(': ');
}

function generateTlsMaterial(): TlsMaterial {
  tlsDirectory = mkdtempSync(join(tmpdir(), 'rezo-phase1c-c-r3-'));
  const keyPath = join(tlsDirectory, 'key.pem');
  const certificatePath = join(tlsDirectory, 'certificate.pem');
  const commonArguments = [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-subj',
    '/CN=127.0.0.1',
    '-days',
    '1',
  ];
  const commandOptions: ExecFileSyncOptions = {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 15_000,
  };

  try {
    execFileSync('openssl', [
      ...commonArguments,
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ], commandOptions);
  } catch (extensionError) {
    try {
      // Older LibreSSL releases do not support -addext. Certificate validation
      // is disabled only inside the requesting child, so a CN-only fixture is
      // sufficient for this transport/policy regression.
      execFileSync('openssl', commonArguments, commandOptions);
    } catch (fallbackError) {
      throw new Error(
        `unable to generate the TLS fixture (addext: ${errorSummary(extensionError)}; fallback: ${errorSummary(fallbackError)})`,
        { cause: fallbackError },
      );
    }
  }

  return { certificatePath, keyPath };
}

beforeAll(() => {
  try {
    tlsMaterial = generateTlsMaterial();
  } catch (error) {
    if (tlsDirectory) rmSync(tlsDirectory, { force: true, recursive: true });
    tlsDirectory = undefined;
    throw error;
  }
});

afterAll(() => {
  if (tlsDirectory) rmSync(tlsDirectory, { force: true, recursive: true });
});

function childSource(adapter: AdapterName, material: TlsMaterial): string {
  return `
const adapterName = ${JSON.stringify(adapter)};
const adapterUrl = ${JSON.stringify(adapterUrls[adapter])};
const rezoUrl = ${JSON.stringify(rezoUrl)};
const keyPath = ${JSON.stringify(material.keyPath)};
const certificatePath = ${JSON.stringify(material.certificatePath)};
const inheritedAuthorization = ${JSON.stringify(INHERITED_AUTHORIZATION)};
const persistentAuthorization = ${JSON.stringify(PERSISTENT_AUTHORIZATION)};
const reissuedAuthorization = ${JSON.stringify(REISSUED_AUTHORIZATION)};
const persistentMarker = ${JSON.stringify(PERSISTENT_MARKER)};
const oneHopMarker = ${JSON.stringify(ONE_HOP_MARKER)};

const http = await import('node:http');
const https = await import('node:https');
const { readFileSync } = await import('node:fs');

let destinationPort = 0;
let sourcePort = 0;
let destinationServer;
let sourceServer;
let sourceHttpsAgent;
const callbackLedger = [];
const wireLedger = [];

function serializeError(error) {
  const boxed = Object(error);
  return {
    code: Reflect.get(boxed, 'code') ?? null,
    message: Reflect.get(boxed, 'message') ?? String(error),
    name: Reflect.get(boxed, 'name') ?? typeof error,
    signal: Reflect.get(boxed, 'signal') ?? null,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fixture did not expose an IP port'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function recordWire(transport, request) {
  const parsed = new URL(request.url ?? '/', transport + '://fixture.invalid');
  wireLedger.push({
    authorization: request.headers.authorization ?? null,
    encrypted: request.socket?.encrypted === true,
    host: request.headers.host ?? null,
    method: String(request.method ?? ''),
    ordinal: wireLedger.length + 1,
    path: parsed.pathname,
    persistent: request.headers['x-r3-persistent'] ?? null,
    transport,
    oneHop: request.headers['x-r3-one-hop'] ?? null,
  });
  return parsed.pathname;
}

let outcome;
try {
  destinationServer = http.createServer((request, response) => {
    const path = recordWire('http', request);
    if (path === '/downgrade') {
      response.writeHead(302, {
        location: 'http://127.0.0.1:' + destinationPort + '/final',
      });
      response.end();
      return;
    }
    if (path === '/final') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ reached: true }));
      return;
    }
    response.writeHead(404);
    response.end('unexpected HTTP fixture route');
  });
  destinationPort = await listen(destinationServer);

  sourceServer = https.createServer({
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath),
  }, (request, response) => {
    const path = recordWire('https', request);
    if (path === '/start') {
      response.writeHead(302, {
        location: 'https://127.0.0.1:' + sourcePort + '/same-https',
      });
      response.end();
      return;
    }
    if (path === '/same-https') {
      response.writeHead(302, {
        location: 'http://127.0.0.1:' + destinationPort + '/downgrade',
      });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end('unexpected HTTPS fixture route');
  });
  sourcePort = await listen(sourceServer);

  const { Rezo } = await import(rezoUrl);
  const { executeRequest } = await import(adapterUrl);
  sourceHttpsAgent = adapterName === 'http'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;
  const client = new Rezo({ disableJar: true }, executeRequest);
  const response = await client.get(
    'https://127.0.0.1:' + sourcePort + '/start',
    {
      cache: false,
      headers: { Authorization: inheritedAuthorization },
      maxRedirects: 5,
      onRedirect: ({ method, status, url }) => {
        const ordinal = callbackLedger.length + 1;
        callbackLedger.push({
          method,
          ordinal,
          protocol: url.protocol,
          status,
          url: url.href,
        });
        if (ordinal === 1) {
          return {
            redirect: true,
            setHeadersOnRedirects: {
              Authorization: persistentAuthorization,
              'X-R3-Persistent': persistentMarker,
            },
            url: url.href,
          };
        }
        if (ordinal === 2) {
          return {
            redirect: true,
            setHeaders: {
              Authorization: reissuedAuthorization,
              'X-R3-One-Hop': oneHopMarker,
            },
            url: url.href,
          };
        }
        return { redirect: true, url: url.href };
      },
      timeout: 5_000,
      ...(adapterName === 'http'
        ? { httpsAgent: sourceHttpsAgent, rejectUnauthorized: false }
        : {}),
    },
  );

  outcome = {
    adapter: adapterName,
    callbackLedger,
    destinationPort,
    finalUrl: response.finalUrl,
    ok: true,
    sourcePort,
    status: response.status,
    tlsBypass: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
    wireLedger,
  };
} catch (error) {
  outcome = {
    adapter: adapterName,
    callbackLedger,
    destinationPort,
    error: serializeError(error),
    ok: false,
    sourcePort,
    wireLedger,
  };
} finally {
  sourceHttpsAgent?.destroy();
  const cleanupResults = await Promise.allSettled([
    closeServer(sourceServer),
    closeServer(destinationServer),
  ]);
  const cleanupErrors = cleanupResults
    .filter((result) => result.status === 'rejected')
    .map((result) => serializeError(result.reason));
  if (cleanupErrors.length > 0) {
    outcome = {
      adapter: adapterName,
      cleanupErrors,
      error: { message: 'fixture cleanup failed', name: 'CleanupError' },
      ok: false,
      partial: outcome,
    };
  }
}

process.stdout.write(JSON.stringify(outcome) + '\\n');
if (!outcome?.ok) process.exitCode = 1;
`;
}

async function runProbe(adapter: AdapterName): Promise<ProbeResult> {
  if (!tlsMaterial) throw new Error('TLS material was not initialized');
  const parentTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null;
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
  if (adapter === 'fetch') {
    childEnvironment.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  } else {
    delete childEnvironment.NODE_TLS_REJECT_UNAUTHORIZED;
  }

  const execution = await new Promise<{ stderr: string; stdout: string }>((resolveExecution, rejectExecution) => {
    execFile('node', [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      childSource(adapter, tlsMaterial!),
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnvironment,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: CHILD_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const output = { stderr: String(stderr), stdout: String(stdout) };
      if (error) {
        rejectExecution(new Error(
          `${adapter} child failed (${errorSummary(error)})\nstdout: ${output.stdout.trim()}\nstderr: ${output.stderr.trim()}`,
          { cause: error },
        ));
        return;
      }
      resolveExecution(output);
    });
  });

  const outputLines = execution.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (outputLines.length !== 1) {
    throw new Error(
      `${adapter} child emitted ${outputLines.length} non-empty stdout lines; stderr: ${execution.stderr.trim()}`,
    );
  }

  const parsed = JSON.parse(outputLines[0]) as ProbeResult & { ok?: boolean };
  if (parsed.ok !== true) {
    throw new Error(`${adapter} child returned a non-success outcome: ${outputLines[0]}`);
  }
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null).toBe(parentTlsSetting);
  return { ...parsed, parentTlsSetting };
}

describe('Phase 1c-c R3 — HTTPS downgrade terminates origin-bound redirect authority', () => {
  for (const adapter of ['http', 'fetch'] as const) {
    it(`${adapter}: expires persistent authority at downgrade and one-hop authority after its destination`, async () => {
      const result = await runProbe(adapter);
      expect(result.sourcePort).toBeGreaterThan(0);
      expect(result.destinationPort).toBeGreaterThan(0);
      expect(result.destinationPort).not.toBe(result.sourcePort);

      const sourceOrigin = `https://127.0.0.1:${result.sourcePort}`;
      const destinationOrigin = `http://127.0.0.1:${result.destinationPort}`;
      const sourceHost = `127.0.0.1:${result.sourcePort}`;
      const destinationHost = `127.0.0.1:${result.destinationPort}`;

      expect(result).toEqual({
        adapter,
        callbackLedger: [
          {
            method: 'GET',
            ordinal: 1,
            protocol: 'https:',
            status: 302,
            url: `${sourceOrigin}/same-https`,
          },
          {
            method: 'GET',
            ordinal: 2,
            protocol: 'http:',
            status: 302,
            url: `${destinationOrigin}/downgrade`,
          },
          {
            method: 'GET',
            ordinal: 3,
            protocol: 'http:',
            status: 302,
            url: `${destinationOrigin}/final`,
          },
        ],
        destinationPort: result.destinationPort,
        finalUrl: `${destinationOrigin}/final`,
        ok: true,
        parentTlsSetting: result.parentTlsSetting,
        sourcePort: result.sourcePort,
        status: 200,
        tlsBypass: adapter === 'fetch',
        wireLedger: [
          {
            authorization: INHERITED_AUTHORIZATION,
            encrypted: true,
            host: sourceHost,
            method: 'GET',
            oneHop: null,
            ordinal: 1,
            path: '/start',
            persistent: null,
            transport: 'https',
          },
          {
            authorization: PERSISTENT_AUTHORIZATION,
            encrypted: true,
            host: sourceHost,
            method: 'GET',
            oneHop: null,
            ordinal: 2,
            path: '/same-https',
            persistent: PERSISTENT_MARKER,
            transport: 'https',
          },
          {
            authorization: REISSUED_AUTHORIZATION,
            encrypted: false,
            host: destinationHost,
            method: 'GET',
            oneHop: ONE_HOP_MARKER,
            ordinal: 3,
            path: '/downgrade',
            persistent: null,
            transport: 'http',
          },
          {
            authorization: null,
            encrypted: false,
            host: destinationHost,
            method: 'GET',
            oneHop: null,
            ordinal: 4,
            path: '/final',
            persistent: null,
            transport: 'http',
          },
        ],
      });
    });
  }
});
