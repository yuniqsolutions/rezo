/**
 * Phase 1c-c HTTP/2 recomposition transaction discriminators.
 *
 * Real h2c wire ledgers cover source-review defects that the lifetime matrix
 * cannot observe: invalid-patch rollback, later-hop hook/base updates,
 * representation-header cleanup, and prototype-shaped header names.
 */

import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Rezo } from '../src';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoHeaders } from '../src/utils/headers';

const ORIGINAL_BODY = 'http2-transaction-original';
const APPROVED_BODY = 'http2-transaction-approved';
const OBSERVED_HEADER_NAMES = [
  '__proto__',
  'content-length',
  'content-type',
  'x-hook',
  'x-one-hop',
  'x-order',
  'x-persistent',
  'x-safe',
  'x-witness',
] as const;

interface WireObservation {
  readonly body: string;
  readonly headers: ReadonlyArray<readonly [string, string | null]>;
  readonly method: string;
  readonly ordinal: number;
  readonly path: string;
}

interface CapturedConfig {
  finalUrl?: string;
  method?: string;
  originalBody?: unknown;
  redirectCount?: number;
  redirectHistory?: Array<{
    method?: string;
    statusCode?: number;
    url?: string;
  }>;
}

interface CapturedRequest {
  body?: unknown;
  fullUrl?: string;
  headers?: { get?: (name: string) => string | null | undefined };
  method?: string;
}

interface LiveReferences {
  config?: CapturedConfig;
  request?: CapturedRequest;
}

interface StateSnapshot {
  readonly body: string | null;
  readonly configMethod: string;
  readonly finalUrl: string;
  readonly headers: Readonly<{
    safe: string | null;
    witness: string | null;
  }>;
  readonly history: Array<{
    method: string;
    statusCode: number;
    url: string;
  }>;
  readonly method: string;
  readonly originalBody: string | null;
  readonly redirectCount: number;
  readonly url: string;
}

let server: http2.Http2Server | undefined;
let port = 0;
let wireLedger: WireObservation[] = [];
let fixtureErrors: string[] = [];
const sessions = new Set<http2.ServerHttp2Session>();

function url(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function headerValue(
  headers: http2.IncomingHttpHeaders,
  name: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(headers, name)) return null;
  const value = headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}

function observedHeaders(
  headers: http2.IncomingHttpHeaders,
): ReadonlyArray<readonly [string, string | null]> {
  return OBSERVED_HEADER_NAMES.map((name) => [name, headerValue(headers, name)] as const);
}

function expectedHeaders(
  overrides: Readonly<Record<string, string>> = {},
): ReadonlyArray<readonly [string, string | null]> {
  return OBSERVED_HEADER_NAMES.map((name) => [
    name,
    Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : null,
  ] as const);
}

function expectedWire(
  ordinal: number,
  path: string,
  options: Readonly<{
    body?: string;
    headers?: Readonly<Record<string, string>>;
    method?: string;
  }> = {},
): WireObservation {
  return {
    body: options.body ?? '',
    headers: expectedHeaders(options.headers),
    method: options.method ?? 'GET',
    ordinal,
    path,
  };
}

async function readBody(stream: http2.ServerHttp2Stream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function redirect(
  stream: http2.ServerHttp2Stream,
  location: string,
  status: number,
): void {
  stream.respond({ ':status': status, location });
  stream.end();
}

async function handleStream(
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
): Promise<void> {
  const path = String(headers[':path'] ?? '');
  const body = await readBody(stream);
  wireLedger.push({
    body,
    headers: observedHeaders(headers),
    method: String(headers[':method'] ?? ''),
    ordinal: wireLedger.length + 1,
    path,
  });

  const redirects: Record<string, { readonly location: string; readonly status: number }> = {
    '/combined-middle': { location: url('/combined-final'), status: 302 },
    '/combined-start': { location: url('/combined-middle'), status: 302 },
    '/control-start': { location: url('/control-final'), status: 307 },
    '/hook-middle': { location: url('/hook-final'), status: 302 },
    '/hook-start': { location: url('/hook-middle'), status: 302 },
    '/invalid-start': { location: url('/invalid-final'), status: 307 },
    '/malformed-location-start': { location: 'http://[', status: 302 },
    '/proto-start': { location: url('/proto-final'), status: 302 },
    '/representation-middle': { location: url('/representation-final'), status: 302 },
    '/representation-start': { location: url('/representation-middle'), status: 307 },
  };
  const next = redirects[path];
  if (next) {
    redirect(stream, next.location, next.status);
    return;
  }

  const terminalPaths = new Set([
    '/combined-final',
    '/control-final',
    '/hook-final',
    '/invalid-final',
    '/proto-final',
    '/representation-final',
  ]);
  if (terminalPaths.has(path)) {
    stream.respond({ ':status': 200, 'content-type': 'application/json' });
    stream.end(JSON.stringify({ path, reached: true }));
    return;
  }

  fixtureErrors.push(`unexpected fixture route: ${path}`);
  stream.respond({ ':status': 404 });
  stream.end('unexpected route');
}

function listen(instance: http2.Http2Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      instance.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      instance.off('error', onError);
      const address = instance.address();
      if (!address || typeof address === 'string') {
        rejectListen(new Error('h2c fixture did not expose an IP port'));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    instance.once('error', onError);
    instance.once('listening', onListening);
    instance.listen(0, '127.0.0.1');
  });
}

async function closeServer(): Promise<void> {
  for (const session of sessions) session.destroy();
  sessions.clear();
  if (!server?.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server!.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

beforeAll(async () => {
  server = http2.createServer();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
    session.on('error', () => {});
  });
  server.on('stream', (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
  ) => {
    stream.on('error', () => {});
    void handleStream(stream, headers).catch((error: unknown) => {
      fixtureErrors.push(String((error as { message?: unknown })?.message ?? error));
      if (!stream.destroyed && !stream.closed) stream.destroy();
    });
  });
  try {
    port = await listen(server);
  } catch (error) {
    await closeServer();
    throw error;
  }
});

afterAll(async () => {
  await closeServer();
});

beforeEach(() => {
  wireLedger = [];
  fixtureErrors = [];
});

afterEach(() => {
  expect(fixtureErrors).toEqual([]);
});

function client(): Rezo {
  return new Rezo({ disableJar: true }, http2Adapter);
}

function bodyText(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`captured body must be string or undefined, received ${typeof value}`);
  }
  return value;
}

function snapshotState(references: LiveReferences): StateSnapshot {
  const { config, request } = references;
  if (!config || !request) throw new TypeError('beforeRedirect did not capture live state');
  if (
    typeof config.method !== 'string'
    || typeof config.finalUrl !== 'string'
    || typeof config.redirectCount !== 'number'
    || !Array.isArray(config.redirectHistory)
    || typeof request.fullUrl !== 'string'
    || typeof request.headers?.get !== 'function'
    || typeof request.method !== 'string'
  ) {
    throw new TypeError('captured redirect state is incomplete');
  }
  const history = config.redirectHistory.map((entry) => {
    if (
      typeof entry.method !== 'string'
      || typeof entry.statusCode !== 'number'
      || typeof entry.url !== 'string'
    ) {
      throw new TypeError('captured redirect-history entry is incomplete');
    }
    return { method: entry.method, statusCode: entry.statusCode, url: entry.url };
  });
  return {
    body: bodyText(request.body),
    configMethod: config.method,
    finalUrl: config.finalUrl,
    headers: {
      safe: request.headers.get('x-safe') ?? null,
      witness: request.headers.get('x-witness') ?? null,
    },
    history,
    method: request.method,
    originalBody: bodyText(config.originalBody),
    redirectCount: config.redirectCount,
    url: request.fullUrl,
  };
}

function captureLiveState(
  references: LiveReferences,
): (context: { request?: CapturedRequest }, config: CapturedConfig) => void {
  return (context, config) => {
    if (!context.request) throw new TypeError('beforeRedirect request is absent');
    references.config = config;
    references.request = context.request;
  };
}

function initialState(path: string): StateSnapshot {
  return {
    body: ORIGINAL_BODY,
    configMethod: 'POST',
    finalUrl: url(path),
    headers: { safe: null, witness: 'caller' },
    history: [],
    method: 'POST',
    originalBody: ORIGINAL_BODY,
    redirectCount: 0,
    url: url(path),
  };
}

describe('Phase 1c-c HTTP/2 recomposition controls', () => {
  it('real h2c 307 preserves method, body, and an ordinary caller header', async () => {
    const response = await client().request({
      body: ORIGINAL_BODY,
      cache: false,
      headers: { 'X-Witness': 'caller' },
      method: 'POST',
      timeout: 5_000,
      url: url('/control-start'),
    } as never);

    expect(response.status).toBe(200);
    expect(wireLedger).toEqual([
      expectedWire(1, '/control-start', {
        body: ORIGINAL_BODY,
        headers: { 'content-type': 'text/plain', 'x-witness': 'caller' },
        method: 'POST',
      }),
      expectedWire(2, '/control-final', {
        body: ORIGINAL_BODY,
        headers: { 'content-type': 'text/plain', 'x-witness': 'caller' },
        method: 'POST',
      }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 invalid-patch transaction rollback', () => {
  const invalidFields = [
    {
      field: 'setHeaders',
      value: Object.fromEntries([
        ['X-Safe', 'must-not-partially-apply'],
        ['bad header', 'rejected'],
      ]),
    },
    { field: 'setHeadersOnRedirects', value: 42 },
  ] as const;

  for (const { field, value } of invalidFields) {
    it(`${field}: structured refusal commits no URL/count/history/method/body state`, async () => {
      const references: LiveReferences = {};
      const callbackLedger: Array<{
        body: string | null;
        method: string;
        status: number;
        url: string;
      }> = [];
      const requestOptions: Record<string, unknown> = {
        body: ORIGINAL_BODY,
        cache: false,
        headers: { 'X-Witness': 'caller' },
        hooks: { beforeRedirect: [captureLiveState(references)] },
        method: 'POST',
        onRedirect: (context: {
          body?: unknown;
          method: string;
          status: number;
          url: URL;
        }) => {
          callbackLedger.push({
            body: bodyText(context.body),
            method: context.method,
            status: context.status,
            url: context.url.href,
          });
          return {
            body: APPROVED_BODY,
            method: 'PUT',
            redirect: true,
            [field]: value,
          };
        },
        timeout: 5_000,
        url: url('/invalid-start'),
      };
      let result: unknown = null;
      let thrown: unknown = null;
      try {
        result = await client().request(requestOptions as never);
      } catch (error) {
        thrown = error;
      }

      expect({
        callbackLedger,
        errorCode: (thrown as { code?: unknown } | null)?.code ?? null,
        errorMessage: (thrown as { message?: unknown } | null)?.message ?? null,
        hasFullUrl: Object.hasOwn(requestOptions, 'fullUrl'),
        optionBody: requestOptions.body,
        optionMethod: requestOptions.method,
        resolvedStatus: (result as { status?: unknown } | null)?.status ?? null,
        state: snapshotState(references),
        wire: wireLedger,
      }).toEqual({
        callbackLedger: [{
          body: ORIGINAL_BODY,
          method: 'POST',
          status: 307,
          url: url('/invalid-final'),
        }],
        errorCode: 'ERR_INVALID_ARG_TYPE',
        errorMessage: `Invalid redirect header patch "${field}"`,
        hasFullUrl: false,
        optionBody: ORIGINAL_BODY,
        optionMethod: 'POST',
        resolvedStatus: null,
        state: initialState('/invalid-start'),
        wire: [expectedWire(1, '/invalid-start', {
          body: ORIGINAL_BODY,
          headers: { 'content-type': 'text/plain', 'x-witness': 'caller' },
          method: 'POST',
        })],
      });
    });
  }

  it('turns a malformed Location into structured ERR_INVALID_URL with no commit', async () => {
    let callbackCount = 0;
    const requestOptions: Record<string, unknown> = {
      body: ORIGINAL_BODY,
      cache: false,
      headers: { 'X-Witness': 'caller' },
      method: 'POST',
      onRedirect: () => {
        callbackCount++;
        return { redirect: true };
      },
      timeout: 5_000,
      url: url('/malformed-location-start'),
    };
    let thrown: unknown = null;
    try {
      await client().request(requestOptions as never);
    } catch (error) {
      thrown = error;
    }

    const structured = thrown as {
      code?: unknown;
      config?: CapturedConfig;
      message?: unknown;
      request?: CapturedRequest;
    } | null;
    expect({
      callbackCount,
      errorCode: structured?.code ?? null,
      errorMessage: structured?.message ?? null,
      hasFullUrl: Object.hasOwn(requestOptions, 'fullUrl'),
      optionBody: requestOptions.body,
      optionMethod: requestOptions.method,
      state: snapshotState({
        config: structured?.config,
        request: structured?.request,
      }),
      wire: wireLedger,
    }).toEqual({
      callbackCount: 0,
      errorCode: 'ERR_INVALID_URL',
      errorMessage: 'Invalid redirect destination URL',
      hasFullUrl: false,
      optionBody: ORIGINAL_BODY,
      optionMethod: 'POST',
      state: initialState('/malformed-location-start'),
      wire: [expectedWire(1, '/malformed-location-start', {
        body: ORIGINAL_BODY,
        headers: { 'content-type': 'text/plain', 'x-witness': 'caller' },
        method: 'POST',
      })],
    });
  });
});

describe('Phase 1c-c HTTP/2 later-hop clean-base updates', () => {
  it('preserves a second-redirect hook mutation instead of restoring the first-hop value', async () => {
    let hookCount = 0;
    const response = await client().get(url('/hook-start'), {
      cache: false,
      headers: { 'X-Hook': 'caller', 'X-Witness': 'caller' },
      hooks: {
        beforeRedirect: [(
          context: { request?: { headers?: { set?: (name: string, value: string) => void } } },
        ) => {
          hookCount++;
          context.request?.headers?.set?.('X-Hook', hookCount === 1 ? 'first-hop' : 'second-hop');
        }],
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(hookCount).toBe(2);
    expect(wireLedger).toEqual([
      expectedWire(1, '/hook-start', {
        headers: { 'x-hook': 'caller', 'x-witness': 'caller' },
      }),
      expectedWire(2, '/hook-middle', {
        headers: { 'x-hook': 'first-hop', 'x-witness': 'caller' },
      }),
      expectedWire(3, '/hook-final', {
        headers: { 'x-hook': 'second-hop', 'x-witness': 'caller' },
      }),
    ]);
  });

  it('keeps later hook intent without baking expired policy overlays into the clean base', async () => {
    let hookCount = 0;
    let callbackCount = 0;
    const response = await client().get(url('/combined-start'), {
      cache: false,
      headers: {
        'X-Hook': 'caller-hook',
        'X-One-Hop': 'caller-one-hop',
        'X-Order': 'caller-order',
        'X-Persistent': 'caller-persistent',
        'X-Witness': 'caller-witness',
      },
      hooks: {
        beforeRedirect: [(
          context: { request?: { headers?: { set?: (name: string, value: string) => void } } },
        ) => {
          hookCount++;
          context.request?.headers?.set?.('X-Hook', hookCount === 1 ? 'hook-first' : 'hook-second');
        }],
      },
      onRedirect: () => {
        callbackCount++;
        if (callbackCount === 1) {
          return {
            redirect: true,
            setHeaders: { 'X-One-Hop': 'overlay-one-hop', 'X-Order': 'overlay-one-hop' },
            setHeadersOnRedirects: {
              'X-Order': 'overlay-persistent',
              'X-Persistent': 'overlay-persistent',
            },
          };
        }
        return { redirect: true, setHeadersOnRedirects: {} };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect({ callbackCount, hookCount }).toEqual({ callbackCount: 2, hookCount: 2 });
    expect(wireLedger).toEqual([
      expectedWire(1, '/combined-start', {
        headers: {
          'x-hook': 'caller-hook',
          'x-one-hop': 'caller-one-hop',
          'x-order': 'caller-order',
          'x-persistent': 'caller-persistent',
          'x-witness': 'caller-witness',
        },
      }),
      expectedWire(2, '/combined-middle', {
        headers: {
          'x-hook': 'hook-first',
          'x-one-hop': 'overlay-one-hop',
          'x-order': 'overlay-one-hop',
          'x-persistent': 'overlay-persistent',
          'x-witness': 'caller-witness',
        },
      }),
      expectedWire(3, '/combined-final', {
        headers: {
          'x-hook': 'hook-second',
          'x-one-hop': 'caller-one-hop',
          'x-order': 'caller-order',
          'x-persistent': 'caller-persistent',
          'x-witness': 'caller-witness',
        },
      }),
    ]);
  });

  it('does not resurrect Content-Type after a later 302 removes the request body', async () => {
    const response = await client().request({
      body: ORIGINAL_BODY,
      cache: false,
      headers: { 'Content-Type': 'application/custom', 'X-Witness': 'caller' },
      method: 'POST',
      timeout: 5_000,
      url: url('/representation-start'),
    } as never);

    expect(response.status).toBe(200);
    expect(wireLedger).toEqual([
      expectedWire(1, '/representation-start', {
        body: ORIGINAL_BODY,
        headers: { 'content-type': 'application/custom', 'x-witness': 'caller' },
        method: 'POST',
      }),
      expectedWire(2, '/representation-middle', {
        body: ORIGINAL_BODY,
        headers: { 'content-type': 'application/custom', 'x-witness': 'caller' },
        method: 'POST',
      }),
      expectedWire(3, '/representation-final', {
        headers: { 'x-witness': 'caller' },
        method: 'GET',
      }),
    ]);
  });

  it('does not resurrect Content-Length: 0 after a later 302 changes POST to GET', async () => {
    const response = await client().request({
      body: '',
      cache: false,
      headers: { 'Content-Length': '0', 'X-Witness': 'caller' },
      method: 'POST',
      timeout: 5_000,
      url: url('/representation-start'),
    } as never);

    expect(response.status).toBe(200);
    expect(wireLedger).toEqual([
      expectedWire(1, '/representation-start', {
        headers: { 'content-length': '0', 'x-witness': 'caller' },
        method: 'POST',
      }),
      expectedWire(2, '/representation-middle', {
        headers: { 'content-length': '0', 'x-witness': 'caller' },
        method: 'POST',
      }),
      expectedWire(3, '/representation-final', {
        headers: { 'x-witness': 'caller' },
        method: 'GET',
      }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 prototype-shaped header carrier', () => {
  it('sends a valid __proto__ one-hop header alongside an ordinary witness', async () => {
    const patch = new RezoHeaders();
    patch.set('__proto__', 'preserved');
    patch.set('X-Safe', 'safe');

    const response = await client().get(url('/proto-start'), {
      cache: false,
      onRedirect: () => ({ redirect: true, setHeaders: patch }),
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(wireLedger).toEqual([
      expectedWire(1, '/proto-start'),
      expectedWire(2, '/proto-final', {
        headers: Object.fromEntries([
          ['__proto__', 'preserved'],
          ['x-safe', 'safe'],
        ]),
      }),
    ]);
  });
});
