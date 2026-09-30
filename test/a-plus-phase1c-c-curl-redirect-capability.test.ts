/**
 * A+ Phase 1c-c cURL regressions.
 *
 * Native cURL owns `-L` redirect traversal, so Rezo cannot provide per-hop
 * callback guarantees without a future manual redirect loop. Phase 1c keeps
 * native behavior when no guarantee is requested, restores the existing
 * `curl.locationTrusted` escape hatch, and refuses callback/hook guarantees
 * before entering the process-owning executor.
 *
 * These tests deliberately separate argv reachability, destination wire
 * truth, and the pre-process capability boundary so one cannot vacuously
 * satisfy another.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import rezo, {
  CurlCommandBuilder,
  CurlExecutor,
  Rezo,
  RezoError,
  type CurlRequestConfig,
} from '../src/adapters/entries/curl';

const AUTHORIZATION = 'Bearer A-PLUS-CURL-PLACEHOLDER-NOT-A-CREDENTIAL';
const COOKIE = 'phase1c_curl_cookie=a-plus-placeholder';
const EXECUTOR_SENTINEL = 'A_PLUS_CURL_EXECUTOR_ENTERED';

type RedirectPath = '/same-origin' | '/cross-port' | '/cross-host' | '/guard';

interface HopObservation {
  reached: boolean;
  authorization: string | null;
  cookie: string | null;
}

interface WireResult {
  status: number;
  source: HopObservation;
  destination: HopObservation;
  args: string[];
}

interface GuaranteeRow {
  name: string;
  options: Record<string, unknown>;
  capabilities: string[];
}

const emptyObservation = (): HopObservation => ({
  reached: false,
  authorization: null,
  cookie: null,
});

const observations = new Map<string, HopObservation>();
const capturedArgumentLists: string[][] = [];

let sourceHits = 0;
let destinationHits = 0;
let sequence = 0;
let sourcePort = 0;
let destinationPort = 0;
let tlsSourcePort = 0;
let tlsDirectory = '';

let sourceServer: http.Server;
let destinationServer: http.Server;
let tlsSourceServer: https.Server;
let builderSpy: ReturnType<typeof vi.spyOn>;

const listen = (server: http.Server | https.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

const close = (server?: http.Server | https.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });

function recordHop(id: string, role: 'source' | 'destination', request: http.IncomingMessage): void {
  if (role === 'source') sourceHits += 1;
  else destinationHits += 1;

  observations.set(`${id}:${role}`, {
    reached: true,
    authorization: request.headers.authorization ?? null,
    cookie: request.headers.cookie ?? null,
  });
}

function generateTlsMaterial(): { key: Buffer; cert: Buffer } {
  tlsDirectory = mkdtempSync(path.join(tmpdir(), 'rezo-phase1c-c-curl-'));
  const keyPath = path.join(tlsDirectory, 'key.pem');
  const certificatePath = path.join(tlsDirectory, 'certificate.pem');
  const commonArguments = [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-subj',
    '/CN=127.0.0.1',
    '-days',
    '1',
  ];

  try {
    execFileSync('openssl', [
      ...commonArguments,
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' });
  } catch {
    // Older LibreSSL releases do not support `-addext`. The cURL request uses
    // rejectUnauthorized:false, so a CN-only throwaway certificate is enough.
    execFileSync('openssl', commonArguments, { stdio: 'ignore' });
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
  };
}

beforeAll(async () => {
  const originalBuild = CurlCommandBuilder.prototype.build;
  builderSpy = vi.spyOn(CurlCommandBuilder.prototype, 'build').mockImplementation(function (
    this: CurlCommandBuilder,
    config,
    originalRequest,
  ) {
    const result = originalBuild.call(this, config, originalRequest);
    capturedArgumentLists.push([...result.args]);
    return result;
  });

  destinationServer = http.createServer((request, response) => {
    const parsed = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const id = parsed.searchParams.get('id') ?? 'missing-id';
    recordHop(id, 'destination', request);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ reached: true }));
  });
  destinationPort = await listen(destinationServer);

  sourceServer = http.createServer((request, response) => {
    const parsed = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const id = parsed.searchParams.get('id') ?? 'missing-id';

    if (parsed.pathname === '/final') {
      recordHop(id, 'destination', request);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ reached: true }));
      return;
    }

    recordHop(id, 'source', request);
    let location: string;
    switch (parsed.pathname as RedirectPath) {
      case '/same-origin':
        location = `http://127.0.0.1:${sourcePort}/final?id=${id}`;
        break;
      case '/cross-host':
        location = `http://localhost:${destinationPort}/destination?id=${id}`;
        break;
      case '/cross-port':
      case '/guard':
        location = `http://127.0.0.1:${destinationPort}/destination?id=${id}`;
        break;
      default:
        response.writeHead(404);
        response.end('missing fixture route');
        return;
    }

    response.writeHead(302, { location });
    response.end();
  });
  sourcePort = await listen(sourceServer);

  const tlsMaterial = generateTlsMaterial();
  tlsSourceServer = https.createServer(tlsMaterial, (request, response) => {
    const parsed = new URL(request.url ?? '/', `https://${request.headers.host}`);
    const id = parsed.searchParams.get('id') ?? 'missing-id';
    recordHop(id, 'source', request);
    response.writeHead(302, {
      location: `http://127.0.0.1:${destinationPort}/destination?id=${id}`,
    });
    response.end();
  });
  tlsSourcePort = await listen(tlsSourceServer);
});

beforeEach(() => {
  observations.clear();
  capturedArgumentLists.length = 0;
  sourceHits = 0;
  destinationHits = 0;
});

afterAll(async () => {
  builderSpy?.mockRestore();
  await Promise.all([
    close(sourceServer),
    close(destinationServer),
    close(tlsSourceServer),
  ]);
  if (tlsDirectory) rmSync(tlsDirectory, { recursive: true, force: true });
});

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function observation(id: string, role: 'source' | 'destination'): HopObservation {
  return observations.get(`${id}:${role}`) ?? emptyObservation();
}

async function requestWire(
  pathName: RedirectPath | '/downgrade',
  requestOptions: Partial<CurlRequestConfig> = {},
): Promise<WireResult> {
  const id = nextId('wire');
  const isTls = pathName === '/downgrade';
  const baseUrl = isTls
    ? `https://127.0.0.1:${tlsSourcePort}`
    : `http://127.0.0.1:${sourcePort}`;
  const client = new Rezo({ disableJar: true });
  const response = await client.get(`${baseUrl}${pathName}?id=${id}`, {
    headers: {
      Authorization: AUTHORIZATION,
      Cookie: COOKIE,
    },
    cache: false,
    timeout: 5000,
    ...(isTls ? { rejectUnauthorized: false } : {}),
    ...requestOptions,
  } as never);

  // The adapter owns every hop: one curl run for the source hop and one for the destination. `args` is the argv of
  // every run, so a flag that must never appear is checked on all of them.
  expect(capturedArgumentLists).toHaveLength(2);
  return {
    status: response.status,
    source: observation(id, 'source'),
    destination: observation(id, 'destination'),
    args: capturedArgumentLists.flat(),
  };
}

function expectedCapabilityMessage(capabilities: string[]): string {
  return `Native cURL cannot enforce redirect capability "${capabilities.join(', ')}" before dispatch.`;
}

function expectUnsupportedCapability(error: unknown, capabilities: string[]): void {
  expect(error).toBeInstanceOf(RezoError);
  const rezoError = error as RezoError;
  expect(rezoError.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(rezoError.errno).toBe(-1075);
  expect(rezoError.isRetryable).toBe(false);
  expect(rezoError.message).toBe(expectedCapabilityMessage(capabilities));
  expect(rezoError.message).not.toContain(AUTHORIZATION);
  expect(rezoError.message).not.toContain(COOKIE);
  expect(rezoError.message).not.toContain('127.0.0.1');
}

const guaranteeRows: GuaranteeRow[] = [
  {
    name: 'beforeRedirect',
    options: { beforeRedirect: () => true },
    capabilities: ['beforeRedirect'],
  },
  {
    name: 'onRedirect',
    options: { onRedirect: () => true },
    capabilities: ['onRedirect'],
  },
  {
    name: 'hooks.beforeRedirect',
    options: { hooks: { beforeRedirect: [() => undefined] } },
    capabilities: ['hooks.beforeRedirect'],
  },
  {
    name: 'all callback/hook guarantees together',
    options: {
      beforeRedirect: () => true,
      onRedirect: () => true,
      hooks: { beforeRedirect: [() => undefined] },
    },
    capabilities: ['beforeRedirect', 'onRedirect', 'hooks.beforeRedirect'],
  },
];

describe('Phase 1c-c R8 — public curl.locationTrusted governs the adapter-owned hop rule (wire behavior, never native argv)', () => {
  it('extends trust across the hop through the adapter rule; curl never runs -L or --location-trusted', async () => {
    const result = await requestWire('/cross-port', {
      curl: { locationTrusted: true },
    });

    expect(result.status).toBe(200);
    expect(result.args).not.toContain('-L');
    expect(result.args).not.toContain('--location-trusted');
    expect(result.destination).toEqual({
      reached: true,
      authorization: AUTHORIZATION,
      cookie: COOKIE,
    });
  });

  it.each([
    { label: 'unset', curl: undefined },
    { label: 'false', curl: { locationTrusted: false } },
  ])('keeps the native safe default when locationTrusted is $label', async ({ curl }) => {
    const result = await requestWire('/cross-port', curl ? { curl } : {});

    expect(result.status).toBe(200);
    expect(result.source).toEqual({
      reached: true,
      authorization: AUTHORIZATION,
      cookie: COOKIE,
    });
    expect(result.destination).toEqual({
      reached: true,
      authorization: null,
      cookie: null,
    });
    expect(result.args).not.toContain('--location-trusted');
  });

  it('does not alias withCredentials to cURL redirect trust', async () => {
    const result = await requestWire('/cross-port', { withCredentials: true });

    expect(result.status).toBe(200);
    expect(result.destination).toEqual({
      reached: true,
      authorization: null,
      cookie: null,
    });
    expect(result.args).not.toContain('--location-trusted');
  });

  it('retains credentials on a same-origin redirect without requiring native broad trust', async () => {
    const result = await requestWire('/same-origin', {
      curl: { locationTrusted: true },
    });

    expect(result.status).toBe(200);
    expect(result.source.reached).toBe(true);
    expect(result.destination).toEqual({
      reached: true,
      authorization: AUTHORIZATION,
      cookie: COOKIE,
    });
  });

  it.each([
    { label: 'same host with a different port', pathName: '/cross-port' as const },
    { label: '127.0.0.1 to localhost', pathName: '/cross-host' as const },
    { label: 'HTTPS to HTTP downgrade', pathName: '/downgrade' as const },
  ])('matches native --location-trusted wire behavior across $label', async ({ pathName }) => {
    const result = await requestWire(pathName, {
      curl: { locationTrusted: true },
    });

    expect(result.status).toBe(200);
    expect(result.source).toEqual({
      reached: true,
      authorization: AUTHORIZATION,
      cookie: COOKIE,
    });
    expect(result.destination).toEqual({
      reached: true,
      authorization: AUTHORIZATION,
      cookie: COOKIE,
    });
  });
});

describe('Phase 1c-c native-cURL R11 — hidden redirect guarantees fail before spawn', () => {
  it.each(guaranteeRows)('does not enter the process-owning executor for $name', async ({ options, capabilities }) => {
    const executeSpy = vi.spyOn(CurlExecutor.prototype, 'execute').mockImplementation(async () => {
      throw new Error(EXECUTOR_SENTINEL);
    });
    let error: unknown;

    try {
      await rezo.get(`http://127.0.0.1:${sourcePort}/guard?id=${nextId('executor')}`, {
        timeout: 5000,
        ...options,
      } as never);
    } catch (caught) {
      error = caught;
    }

    const executorCalls = executeSpy.mock.calls.length;
    executeSpy.mockRestore();

    expect(executorCalls).toBe(0);
    expectUnsupportedCapability(error, capabilities);
  });

  it.each(guaranteeRows)('returns the exact structured refusal with zero wire hits for $name', async ({ options, capabilities }) => {
    let error: unknown;

    try {
      await rezo.get(`http://127.0.0.1:${sourcePort}/guard?id=${nextId('wire-guard')}`, {
        timeout: 5000,
        ...options,
      } as never);
    } catch (caught) {
      error = caught;
    }

    expectUnsupportedCapability(error, capabilities);
    expect(sourceHits).toBe(0);
    expect(destinationHits).toBe(0);
    expect(capturedArgumentLists).toHaveLength(0);
  });

  it.each(guaranteeRows)('also detects $name supplied through instance defaults', async ({ options, capabilities }) => {
    const client = new Rezo({
      disableJar: true,
      ...options,
    } as never);
    let error: unknown;

    try {
      await client.get(`http://127.0.0.1:${sourcePort}/guard?id=${nextId('default-guard')}`, {
        timeout: 5000,
      } as never);
    } catch (caught) {
      error = caught;
    }

    expectUnsupportedCapability(error, capabilities);
    expect(sourceHits).toBe(0);
    expect(destinationHits).toBe(0);
    expect(capturedArgumentLists).toHaveLength(0);
  });

  it('detects a hook registered through the public instance hook collection', async () => {
    const client = new Rezo({ disableJar: true });
    const hook = vi.fn();
    client.hooks.beforeRedirect.push(hook);
    const executeSpy = vi.spyOn(CurlExecutor.prototype, 'execute').mockImplementation(async () => {
      throw new Error(EXECUTOR_SENTINEL);
    });
    let error: unknown;

    try {
      await client.get(`http://127.0.0.1:${sourcePort}/guard?id=${nextId('public-hook')}`, {
        timeout: 5000,
      } as never);
    } catch (caught) {
      error = caught;
    }

    const executorCalls = executeSpy.mock.calls.length;
    executeSpy.mockRestore();

    expectUnsupportedCapability(error, ['hooks.beforeRedirect']);
    expect(executorCalls).toBe(0);
    expect(hook).not.toHaveBeenCalled();
    expect(sourceHits).toBe(0);
    expect(destinationHits).toBe(0);
    expect(capturedArgumentLists).toHaveLength(0);
  });

  it('keeps native behavior when hooks.beforeRedirect is empty', async () => {
    const result = await requestWire('/cross-port', {
      hooks: { beforeRedirect: [] },
    });

    expect(result.status).toBe(200);
    expect(sourceHits).toBe(1);
    expect(destinationHits).toBe(1);
    expect(result.destination.authorization).toBeNull();
  });

  it('keeps native behavior when an unrelated hook is non-empty', async () => {
    const result = await requestWire('/cross-port', {
      hooks: { beforeRetry: [async () => undefined] },
    });

    expect(result.status).toBe(200);
    expect(sourceHits).toBe(1);
    expect(destinationHits).toBe(1);
    expect(result.destination.authorization).toBeNull();
  });

  it('does not mistake curl.locationTrusted itself for a per-hop callback guarantee', async () => {
    const result = await requestWire('/same-origin', {
      curl: { locationTrusted: true },
    });

    expect(result.status).toBe(200);
    expect(sourceHits).toBe(1);
    expect(destinationHits).toBe(1);
  });
});
