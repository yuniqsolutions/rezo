/**
 * Phase 1c-c HTTP/2 redirect lifetime red specification.
 *
 * Real h2c source and foreign-origin servers prove U2/R1/R2/R4 on the wire.
 * Callback and live-state ledgers prevent a stopped or skipped redirect from
 * masquerading as correct header expiry. This file intentionally freezes the
 * post-repair contract without changing the HTTP/2 adapter.
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
  vi,
} from 'vitest';
import { Rezo } from '../src';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

type FixtureName = 'source' | 'foreign';

const ORIGINAL_BODY = 'phase1c-c-http2-original-body';
const APPROVED_BODY = 'phase1c-c-http2-approved-body';
const ONE_HOP = 'phase1c-c-http2-one-hop';
const PERSISTENT = 'phase1c-c-http2-persistent';
const CALLER = 'phase1c-c-http2-caller';
const KEEP = 'phase1c-c-http2-keep';

const observedHeaderNames = [
  'x-clear',
  'x-keep',
  'x-one-hop',
  'x-persist',
  'x-persist-witness',
  'x-persistent-delete',
  'x-same',
  'x-tombstone',
  'x-which',
] as const;

type ObservedHeaderName = typeof observedHeaderNames[number];
type ObservedHeaders = Record<ObservedHeaderName, string | null>;

interface WireObservation {
  authority: string;
  body: string;
  headers: ObservedHeaders;
  method: string;
  ordinal: number;
  path: string;
  server: FixtureName;
}

interface CallbackObservation {
  body: string | null;
  method: string;
  ordinal: number;
  status: number;
  url: string;
}

interface RedirectHistoryObservation {
  method: string;
  statusCode: number;
  url: string;
}

interface CapturedConfig {
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
  method?: string;
}

interface StateObservation {
  body: string | null;
  configMethod: string;
  history: RedirectHistoryObservation[];
  method: string;
  originalBody: string | null;
  phase: string;
  redirectCount: number;
  url: string;
}

interface StateReferences {
  config?: CapturedConfig;
  request?: CapturedRequest;
}

interface Fixture {
  name: FixtureName;
  server: http2.Http2Server;
  sessions: Set<http2.ServerHttp2Session>;
}

let sourceFixture: Fixture | undefined;
let foreignFixture: Fixture | undefined;
let sourcePort = 0;
let foreignPort = 0;
let wireLedger: WireObservation[] = [];
let fixtureErrors: string[] = [];
let routeAttempts = new Map<string, number>();

function headerValue(
  headers: http2.IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}

function observedHeaders(headers: http2.IncomingHttpHeaders): ObservedHeaders {
  return Object.fromEntries(
    observedHeaderNames.map((name) => [name, headerValue(headers, name)]),
  ) as ObservedHeaders;
}

async function readBody(stream: http2.ServerHttp2Stream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sourceUrl(path: string): string {
  return `http://127.0.0.1:${sourcePort}${path}`;
}

function foreignUrl(path: string): string {
  return `http://127.0.0.1:${foreignPort}${path}`;
}

function respondRedirect(
  stream: http2.ServerHttp2Stream,
  location: string,
  status = 302,
): void {
  stream.respond({ ':status': status, location });
  stream.end();
}

function respondTerminal(stream: http2.ServerHttp2Stream, path: string): void {
  stream.respond({ ':status': 200, 'content-type': 'application/json' });
  stream.end(JSON.stringify({ path, reached: true }));
}

function nextRouteAttempt(path: string): number {
  const attempt = (routeAttempts.get(path) ?? 0) + 1;
  routeAttempts.set(path, attempt);
  return attempt;
}

async function handleStream(
  fixtureName: FixtureName,
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
): Promise<void> {
  const path = String(headers[':path'] ?? '');
  const body = await readBody(stream);
  wireLedger.push({
    authority: String(headers[':authority'] ?? ''),
    body,
    headers: observedHeaders(headers),
    method: String(headers[':method'] ?? ''),
    ordinal: wireLedger.length + 1,
    path,
    server: fixtureName,
  });

  if (fixtureName === 'source') {
    if (path === '/r1-retry-middle') {
      if (nextRouteAttempt(path) === 1) {
        stream.respond({ ':status': 503, 'content-type': 'application/json' });
        stream.end('{"retry":true}');
      } else {
        respondRedirect(stream, sourceUrl('/r1-retry-final'));
      }
      return;
    }
    const sourceRedirects: Record<string, { location: string; status?: number }> = {
      '/callback-start': { location: sourceUrl('/callback-final'), status: 307 },
      '/plain-start': { location: sourceUrl('/plain-final'), status: 307 },
      '/r1-middle': { location: sourceUrl('/r1-final') },
      '/r1-retry-start': { location: sourceUrl('/r1-retry-middle') },
      '/r1-start': { location: sourceUrl('/r1-middle') },
      '/r2-foreign-start': { location: foreignUrl('/r2-foreign-middle') },
      '/r2-same-middle': { location: sourceUrl('/r2-same-final') },
      '/r2-same-start': { location: sourceUrl('/r2-same-middle') },
      '/r4-clear-middle': { location: sourceUrl('/r4-clear-final') },
      '/r4-clear-start': { location: sourceUrl('/r4-clear-middle') },
      '/r4-layer-middle': { location: sourceUrl('/r4-layer-final') },
      '/r4-layer-start': { location: sourceUrl('/r4-layer-middle') },
      '/u2-deny-start': { location: sourceUrl('/u2-deny-final'), status: 307 },
      '/u2-throw-start': { location: sourceUrl('/u2-throw-final'), status: 307 },
    };
    const redirect = sourceRedirects[path];
    if (redirect) {
      respondRedirect(stream, redirect.location, redirect.status);
      return;
    }
    const terminalPaths = new Set([
      '/callback-final',
      '/plain-final',
      '/r1-final',
      '/r1-retry-final',
      '/r2-foreign-final',
      '/r2-same-final',
      '/r4-clear-final',
      '/r4-layer-final',
      '/u2-deny-final',
      '/u2-throw-final',
    ]);
    if (terminalPaths.has(path)) {
      respondTerminal(stream, path);
      return;
    }
  } else if (path === '/r2-foreign-middle') {
    respondRedirect(stream, sourceUrl('/r2-foreign-final'));
    return;
  }

  fixtureErrors.push(`unexpected ${fixtureName} route: ${path}`);
  stream.respond({ ':status': 404 });
  stream.end('unexpected fixture route');
}

function createFixture(name: FixtureName): Fixture {
  const sessions = new Set<http2.ServerHttp2Session>();
  const server = http2.createServer();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
    session.on('error', () => {});
  });
  server.on('stream', (rawStream, headers) => {
    const stream = rawStream as http2.ServerHttp2Stream;
    stream.on('error', () => {});
    void handleStream(name, stream, headers).catch((error: unknown) => {
      fixtureErrors.push(
        `${name} handler: ${String((error as { message?: unknown })?.message ?? error)}`,
      );
      if (!stream.destroyed && !stream.closed) {
        try {
          stream.respond({ ':status': 500 });
          stream.end('fixture handler failed');
        } catch {
          stream.destroy();
        }
      }
    });
  });
  return { name, server, sessions };
}

function listen(fixture: Fixture): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      fixture.server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      fixture.server.off('error', onError);
      const address = fixture.server.address();
      if (!address || typeof address === 'string') {
        rejectListen(new Error(`${fixture.name} fixture did not expose an IP port`));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    fixture.server.once('error', onError);
    fixture.server.once('listening', onListening);
    fixture.server.listen(0, '127.0.0.1');
  });
}

async function closeFixture(fixture: Fixture | undefined): Promise<void> {
  if (!fixture) return;
  for (const session of fixture.sessions) session.destroy();
  fixture.sessions.clear();
  if (!fixture.server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    fixture.server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

beforeAll(async () => {
  foreignFixture = createFixture('foreign');
  sourceFixture = createFixture('source');
  try {
    foreignPort = await listen(foreignFixture);
    sourcePort = await listen(sourceFixture);
  } catch (error) {
    const cleanup = await Promise.allSettled([
      closeFixture(sourceFixture),
      closeFixture(foreignFixture),
    ]);
    const cleanupFailures = cleanup.filter((result) => result.status === 'rejected');
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures.map((result) => result.reason)], 'h2c fixture start and cleanup failed');
    }
    throw error;
  }
});

afterAll(async () => {
  const cleanup = await Promise.allSettled([
    closeFixture(sourceFixture),
    closeFixture(foreignFixture),
  ]);
  const cleanupFailures = cleanup.filter((result) => result.status === 'rejected');
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((result) => result.reason),
      'h2c fixture cleanup failed',
    );
  }
});

beforeEach(() => {
  wireLedger = [];
  fixtureErrors = [];
  routeAttempts = new Map();
});

afterEach(() => {
  expect(fixtureErrors).toEqual([]);
});

function bodyText(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`captured body must be a string or undefined, received ${typeof value}`);
  }
  return value;
}

function stateObservation(
  phase: string,
  config: CapturedConfig,
  request: CapturedRequest,
): StateObservation {
  if (typeof config.redirectCount !== 'number') {
    throw new TypeError('captured config.redirectCount is absent');
  }
  if (!Array.isArray(config.redirectHistory)) {
    throw new TypeError('captured config.redirectHistory is absent');
  }
  if (typeof config.method !== 'string') {
    throw new TypeError('captured config.method is absent');
  }
  if (typeof request.fullUrl !== 'string') {
    throw new TypeError('captured request.fullUrl is absent');
  }
  if (typeof request.method !== 'string') {
    throw new TypeError('captured request.method is absent');
  }
  const history = config.redirectHistory.map((entry) => {
    if (
      typeof entry.url !== 'string'
      || typeof entry.statusCode !== 'number'
      || typeof entry.method !== 'string'
    ) {
      throw new TypeError('captured redirect-history entry is incomplete');
    }
    return {
      method: entry.method,
      statusCode: entry.statusCode,
      url: entry.url,
    };
  });
  return {
    body: bodyText(request.body),
    configMethod: config.method,
    history,
    method: request.method,
    originalBody: bodyText(config.originalBody),
    phase,
    redirectCount: config.redirectCount,
    url: request.fullUrl,
  };
}

function captureStateHook(
  ledger: StateObservation[],
  references: StateReferences,
): (context: { request?: CapturedRequest }, config: CapturedConfig) => void {
  return (context, config) => {
    if (!context.request) throw new TypeError('beforeRedirect context.request is absent');
    references.config = config;
    references.request = context.request;
    ledger.push(stateObservation('before-callback', config, context.request));
  };
}

function appendCapturedState(
  ledger: StateObservation[],
  phase: string,
  references: StateReferences,
): void {
  expect(references.config, 'beforeRedirect must expose live config').toBeDefined();
  expect(references.request, 'beforeRedirect must expose live request').toBeDefined();
  if (!references.config || !references.request) {
    throw new TypeError('captured redirect state is absent');
  }
  ledger.push(stateObservation(phase, references.config, references.request));
}

function callbackObservation(
  ordinal: number,
  context: {
    body?: unknown;
    method: string;
    status: number;
    url: URL;
  },
): CallbackObservation {
  return {
    body: bodyText(context.body),
    method: context.method,
    ordinal,
    status: context.status,
    url: context.url.href,
  };
}

function expectedHeaders(
  overrides: Partial<Record<ObservedHeaderName, string>> = {},
): ObservedHeaders {
  return Object.fromEntries(
    observedHeaderNames.map((name) => [name, overrides[name] ?? null]),
  ) as ObservedHeaders;
}

function expectedWire(
  ordinal: number,
  server: FixtureName,
  path: string,
  options: {
    body?: string;
    headers?: Partial<Record<ObservedHeaderName, string>>;
    method?: string;
  } = {},
): WireObservation {
  const port = server === 'source' ? sourcePort : foreignPort;
  return {
    authority: `127.0.0.1:${port}`,
    body: options.body ?? '',
    headers: expectedHeaders(options.headers),
    method: options.method ?? 'GET',
    ordinal,
    path,
    server,
  };
}

function initialState(path: string): StateObservation {
  return {
    body: ORIGINAL_BODY,
    configMethod: 'POST',
    history: [],
    method: 'POST',
    originalBody: ORIGINAL_BODY,
    phase: 'before-callback',
    redirectCount: 0,
    url: sourceUrl(path),
  };
}

function client(): Rezo {
  return new Rezo({ disableJar: true }, http2Adapter);
}

describe('Phase 1c-c HTTP/2 lifetime controls', () => {
  it('plain h2c 307 follow dispatches the logical destination with method and body intact', async () => {
    const response = await client().request({
      body: ORIGINAL_BODY,
      cache: false,
      method: 'POST',
      timeout: 5_000,
      url: sourceUrl('/plain-start'),
    } as never);

    expect(response.status).toBe(200);
    expect(response.finalUrl).toBe(sourceUrl('/plain-final'));
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/plain-start', { body: ORIGINAL_BODY, method: 'POST' }),
      expectedWire(2, 'source', '/plain-final', { body: ORIGINAL_BODY, method: 'POST' }),
    ]);
  });

  it('approved callback proves the callback and captured live state can commit URL, count, history, method, and body', async () => {
    const callbacks: CallbackObservation[] = [];
    const states: StateObservation[] = [];
    const references: StateReferences = {};
    const requestOptions = {
      body: ORIGINAL_BODY,
      cache: false,
      hooks: { beforeRedirect: [captureStateHook(states, references)] },
      method: 'POST',
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbacks.push(callbackObservation(1, context));
        return {
          body: APPROVED_BODY,
          method: 'PUT',
          redirect: true,
          url: context.url.href,
        };
      },
      timeout: 5_000,
      url: sourceUrl('/callback-start'),
    };

    const response = await client().request(requestOptions as never);
    appendCapturedState(states, 'after-completion', references);

    expect(response.status).toBe(200);
    expect(callbacks).toEqual([{
      body: ORIGINAL_BODY,
      method: 'POST',
      ordinal: 1,
      status: 307,
      url: sourceUrl('/callback-final'),
    }]);
    expect(states).toEqual([
      initialState('/callback-start'),
      {
        body: APPROVED_BODY,
        configMethod: 'PUT',
        history: [{
          method: 'POST',
          statusCode: 307,
          url: sourceUrl('/callback-start'),
        }],
        method: 'PUT',
        originalBody: APPROVED_BODY,
        phase: 'after-completion',
        redirectCount: 1,
        url: sourceUrl('/callback-final'),
      },
    ]);
    // Input normalization owns a copy; the captured live adapter state above
    // commits the redirect while the caller's reusable options stay unchanged.
    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.body).toBe(ORIGINAL_BODY);
    expect((requestOptions as typeof requestOptions & { fullUrl?: string }).fullUrl)
      .toBeUndefined();
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/callback-start', { body: ORIGINAL_BODY, method: 'POST' }),
      expectedWire(2, 'source', '/callback-final', { body: APPROVED_BODY, method: 'PUT' }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 U2 — denied and throwing callbacks commit nothing', () => {
  it('denial performs zero onward dispatch and leaves URL/count/history/method/body uncommitted', async () => {
    const callbacks: CallbackObservation[] = [];
    const states: StateObservation[] = [];
    const references: StateReferences = {};
    const deny = vi.fn((context: Parameters<typeof callbackObservation>[1]) => {
      callbacks.push(callbackObservation(1, context));
      return false;
    });
    const requestOptions = {
      body: ORIGINAL_BODY,
      cache: false,
      hooks: { beforeRedirect: [captureStateHook(states, references)] },
      method: 'POST',
      onRedirect: deny,
      timeout: 5_000,
      url: sourceUrl('/u2-deny-start'),
    };
    let response: unknown = null;
    let thrown: unknown = null;

    try {
      response = await client().request(requestOptions as never);
    } catch (error) {
      thrown = error;
    }
    appendCapturedState(states, 'after-denial', references);

    expect(deny).toHaveBeenCalledTimes(1);
    expect(response).toBeNull();
    expect(thrown).toBeTruthy();
    expect(String((thrown as { message?: unknown }).message)).toContain('Redirect denied by user');
    expect(callbacks).toEqual([{
      body: ORIGINAL_BODY,
      method: 'POST',
      ordinal: 1,
      status: 307,
      url: sourceUrl('/u2-deny-final'),
    }]);
    expect(states).toEqual([
      initialState('/u2-deny-start'),
      { ...initialState('/u2-deny-start'), phase: 'after-denial' },
    ]);
    expect(requestOptions.url).toBe(sourceUrl('/u2-deny-start'));
    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.body).toBe(ORIGINAL_BODY);
    expect(Object.hasOwn(requestOptions, 'fullUrl')).toBe(false);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/u2-deny-start', { body: ORIGINAL_BODY, method: 'POST' }),
    ]);
  });

  it('throw propagates its sentinel with zero onward dispatch and no state commit', async () => {
    const callbacks: CallbackObservation[] = [];
    const states: StateObservation[] = [];
    const references: StateReferences = {};
    const sentinel = 'PHASE1C-C-HTTP2-U2-THROW-SENTINEL';
    const throwing = vi.fn((context: Parameters<typeof callbackObservation>[1]) => {
      callbacks.push(callbackObservation(1, context));
      throw new Error(sentinel);
    });
    const requestOptions = {
      body: ORIGINAL_BODY,
      cache: false,
      hooks: { beforeRedirect: [captureStateHook(states, references)] },
      method: 'POST',
      onRedirect: throwing,
      timeout: 5_000,
      url: sourceUrl('/u2-throw-start'),
    };
    let response: unknown = null;
    let thrown: unknown = null;

    try {
      response = await client().request(requestOptions as never);
    } catch (error) {
      thrown = error;
    }
    appendCapturedState(states, 'after-throw', references);

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(response).toBeNull();
    expect(thrown).toBeTruthy();
    expect(String((thrown as { message?: unknown }).message)).toContain(sentinel);
    expect(callbacks).toEqual([{
      body: ORIGINAL_BODY,
      method: 'POST',
      ordinal: 1,
      status: 307,
      url: sourceUrl('/u2-throw-final'),
    }]);
    expect(states).toEqual([
      initialState('/u2-throw-start'),
      { ...initialState('/u2-throw-start'), phase: 'after-throw' },
    ]);
    expect(requestOptions.url).toBe(sourceUrl('/u2-throw-start'));
    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.body).toBe(ORIGINAL_BODY);
    expect(Object.hasOwn(requestOptions, 'fullUrl')).toBe(false);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/u2-throw-start', { body: ORIGINAL_BODY, method: 'POST' }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 R1 — one-hop lifetime', () => {
  it('applies to exactly one logical destination and expires before its next redirect', async () => {
    const callbacks: CallbackObservation[] = [];
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r1-start'), {
      cache: false,
      maxRedirects: 5,
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbackCount++;
        callbacks.push(callbackObservation(callbackCount, context));
        return callbackCount === 1
          ? { redirect: true, setHeaders: { 'X-One-Hop': ONE_HOP } }
          : { redirect: true };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(response.finalUrl).toBe(sourceUrl('/r1-final'));
    expect(callbacks).toEqual([
      { body: null, method: 'GET', ordinal: 1, status: 302, url: sourceUrl('/r1-middle') },
      { body: null, method: 'GET', ordinal: 2, status: 302, url: sourceUrl('/r1-final') },
    ]);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r1-start'),
      expectedWire(2, 'source', '/r1-middle', { headers: { 'x-one-hop': ONE_HOP } }),
      expectedWire(3, 'source', '/r1-final'),
    ]);
  });

  it('keeps a one-hop overlay through retries of one logical destination, then expires it before the next redirect', async () => {
    const callbacks: CallbackObservation[] = [];
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r1-retry-start'), {
      cache: false,
      headers: { 'X-Keep': CALLER },
      maxRedirects: 5,
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbackCount++;
        callbacks.push(callbackObservation(callbackCount, context));
        return callbackCount === 1
          ? { redirect: true, setHeaders: { 'X-One-Hop': ONE_HOP } }
          : { redirect: true };
      },
      retry: { maxRetries: 1, retryOn: [503], retryDelay: 0 },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(response.finalUrl).toBe(sourceUrl('/r1-retry-final'));
    expect(callbacks).toEqual([
      { body: null, method: 'GET', ordinal: 1, status: 302, url: sourceUrl('/r1-retry-middle') },
      { body: null, method: 'GET', ordinal: 2, status: 302, url: sourceUrl('/r1-retry-final') },
    ]);
    expect([...routeAttempts.entries()]).toEqual([['/r1-retry-middle', 2]]);
    expect({
      attempts: response.config.errors.map((entry: {
        attempt?: number;
        error?: { code?: string; status?: number };
      }) => ({
        attempt: entry.attempt,
        code: entry.error?.code,
        status: entry.error?.status,
      })),
      history: response.config.redirectHistory.map((entry: {
        method?: string;
        statusCode?: number;
        url?: string;
      }) => ({
        method: entry.method,
        statusCode: entry.statusCode,
        url: entry.url,
      })),
      redirectCount: response.config.redirectCount,
      retryAttempts: response.config.retryAttempts,
    }).toEqual({
      attempts: [{ attempt: 1, code: 'REZ_HTTP_ERROR', status: 503 }],
      history: [
        { method: 'GET', statusCode: 302, url: sourceUrl('/r1-retry-start') },
        { method: 'GET', statusCode: 302, url: sourceUrl('/r1-retry-middle') },
      ],
      redirectCount: 2,
      retryAttempts: 1,
    });
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r1-retry-start', { headers: { 'x-keep': CALLER } }),
      expectedWire(2, 'source', '/r1-retry-middle', {
        headers: { 'x-keep': CALLER, 'x-one-hop': ONE_HOP },
      }),
      expectedWire(3, 'source', '/r1-retry-middle', {
        headers: { 'x-keep': CALLER, 'x-one-hop': ONE_HOP },
      }),
      expectedWire(4, 'source', '/r1-retry-final', { headers: { 'x-keep': CALLER } }),
    ]);
  });

  it('restores the caller same-key value when the one-hop overlay expires', async () => {
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r1-start'), {
      cache: false,
      headers: { 'X-One-Hop': CALLER },
      maxRedirects: 5,
      onRedirect: () => {
        callbackCount++;
        return callbackCount === 1
          ? { redirect: true, setHeaders: { 'X-One-Hop': ONE_HOP } }
          : { redirect: true };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(2);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r1-start', { headers: { 'x-one-hop': CALLER } }),
      expectedWire(2, 'source', '/r1-middle', { headers: { 'x-one-hop': ONE_HOP } }),
      expectedWire(3, 'source', '/r1-final', { headers: { 'x-one-hop': CALLER } }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 R2 — persistent lifetime and restoration', () => {
  it('applies immediately and survives redirects within its exact origin', async () => {
    const callbacks: CallbackObservation[] = [];
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r2-same-start'), {
      cache: false,
      maxRedirects: 5,
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbackCount++;
        callbacks.push(callbackObservation(callbackCount, context));
        return callbackCount === 1
          ? {
              redirect: true,
              setHeadersOnRedirects: {
                'X-Persist': PERSISTENT,
                'X-Persist-Witness': PERSISTENT,
              },
            }
          : { redirect: true };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(callbacks).toEqual([
      { body: null, method: 'GET', ordinal: 1, status: 302, url: sourceUrl('/r2-same-middle') },
      { body: null, method: 'GET', ordinal: 2, status: 302, url: sourceUrl('/r2-same-final') },
    ]);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r2-same-start'),
      expectedWire(2, 'source', '/r2-same-middle', {
        headers: { 'x-persist': PERSISTENT, 'x-persist-witness': PERSISTENT },
      }),
      expectedWire(3, 'source', '/r2-same-final', {
        headers: { 'x-persist': PERSISTENT, 'x-persist-witness': PERSISTENT },
      }),
    ]);
  });

  it('expires on a port/origin change, never revives on A→B→A, and restores a caller same-key value', async () => {
    const callbacks: CallbackObservation[] = [];
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r2-foreign-start'), {
      cache: false,
      headers: { 'X-Same': CALLER },
      maxRedirects: 5,
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbackCount++;
        callbacks.push(callbackObservation(callbackCount, context));
        return callbackCount === 1
          ? {
              redirect: true,
              setHeadersOnRedirects: {
                'X-Persist-Witness': PERSISTENT,
                'X-Same': PERSISTENT,
              },
            }
          : { redirect: true };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(response.finalUrl).toBe(sourceUrl('/r2-foreign-final'));
    expect(callbacks).toEqual([
      { body: null, method: 'GET', ordinal: 1, status: 302, url: foreignUrl('/r2-foreign-middle') },
      { body: null, method: 'GET', ordinal: 2, status: 302, url: sourceUrl('/r2-foreign-final') },
    ]);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r2-foreign-start', { headers: { 'x-same': CALLER } }),
      expectedWire(2, 'foreign', '/r2-foreign-middle', {
        headers: { 'x-persist-witness': PERSISTENT, 'x-same': PERSISTENT },
      }),
      expectedWire(3, 'source', '/r2-foreign-final', { headers: { 'x-same': CALLER } }),
    ]);
  });
});

describe('Phase 1c-c HTTP/2 R4 — precedence, tombstones, and clear', () => {
  it('applies persistent before one-hop, lets one-hop win, and scopes both tombstone layers', async () => {
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r4-layer-start'), {
      cache: false,
      headers: {
        'X-Keep': KEEP,
        'X-Persistent-Delete': CALLER,
        'X-Tombstone': CALLER,
      },
      maxRedirects: 5,
      onRedirect: () => {
        callbackCount++;
        return callbackCount === 1
          ? {
              redirect: true,
              setHeaders: {
                'X-One-Hop': ONE_HOP,
                'X-Tombstone': undefined,
                'X-Which': ONE_HOP,
              },
              setHeadersOnRedirects: {
                'X-Persist-Witness': PERSISTENT,
                'X-Persistent-Delete': undefined,
                'X-Tombstone': PERSISTENT,
                'X-Which': PERSISTENT,
              },
            }
          : { redirect: true };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(2);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r4-layer-start', {
        headers: {
          'x-keep': KEEP,
          'x-persistent-delete': CALLER,
          'x-tombstone': CALLER,
        },
      }),
      expectedWire(2, 'source', '/r4-layer-middle', {
        headers: {
          'x-keep': KEEP,
          'x-one-hop': ONE_HOP,
          'x-persist-witness': PERSISTENT,
          'x-which': ONE_HOP,
        },
      }),
      expectedWire(3, 'source', '/r4-layer-final', {
        headers: {
          'x-keep': KEEP,
          'x-persist-witness': PERSISTENT,
          'x-tombstone': PERSISTENT,
          'x-which': PERSISTENT,
        },
      }),
    ]);
  });

  it('an explicitly empty persistent patch clears the layer and restores the caller value', async () => {
    const callbacks: CallbackObservation[] = [];
    let callbackCount = 0;
    const response = await client().get(sourceUrl('/r4-clear-start'), {
      cache: false,
      headers: { 'X-Clear': CALLER, 'X-Keep': KEEP },
      maxRedirects: 5,
      onRedirect: (context: Parameters<typeof callbackObservation>[1]) => {
        callbackCount++;
        callbacks.push(callbackObservation(callbackCount, context));
        return callbackCount === 1
          ? {
              redirect: true,
              setHeadersOnRedirects: {
                'X-Clear': PERSISTENT,
                'X-Persist-Witness': PERSISTENT,
              },
            }
          : { redirect: true, setHeadersOnRedirects: {} };
      },
      timeout: 5_000,
    } as never);

    expect(response.status).toBe(200);
    expect(callbacks).toEqual([
      { body: null, method: 'GET', ordinal: 1, status: 302, url: sourceUrl('/r4-clear-middle') },
      { body: null, method: 'GET', ordinal: 2, status: 302, url: sourceUrl('/r4-clear-final') },
    ]);
    expect(wireLedger).toEqual([
      expectedWire(1, 'source', '/r4-clear-start', {
        headers: { 'x-clear': CALLER, 'x-keep': KEEP },
      }),
      expectedWire(2, 'source', '/r4-clear-middle', {
        headers: { 'x-clear': PERSISTENT, 'x-keep': KEEP, 'x-persist-witness': PERSISTENT },
      }),
      expectedWire(3, 'source', '/r4-clear-final', {
        headers: { 'x-clear': CALLER, 'x-keep': KEEP },
      }),
    ]);
  });
});
