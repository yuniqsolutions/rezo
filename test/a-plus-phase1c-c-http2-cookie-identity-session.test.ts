/**
 * Phase 1c-c HTTP/2 cookie identity, serialization, deadline, and pool lifetime reds.
 *
 * Every transport assertion below is backed by a real h2c stream. The only
 * reflection is the explicit read of the exported session pool's private map;
 * this lets the test distinguish a released pooled reference from a merely
 * successful follow-up request without changing product code.
 */

import * as http2 from 'node:http2';
import * as net from 'node:net';
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
import {
  executeRequest as http2Adapter,
  Http2SessionPool,
} from '../src/adapters/http2';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import type { Cookie, Cookies } from '../src/cookies/cookie-jar';
import { RezoError } from '../src/errors/rezo-error';
import { SocksClient } from '../src/internal/agents/socks-client';
import { ProxyManager } from '../src/proxy/manager';
import type { RezoResponse } from '../src/types/response';
import { RezoHeaders } from '../src/utils/headers';

interface PlannedResponse {
  readonly body?: string;
  readonly bodyDelayMs?: number;
  readonly delayMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly location?: string;
  readonly onHeaders?: () => void;
  readonly onRequest?: () => void;
  readonly reset?: boolean;
  readonly setCookie?: readonly string[];
  readonly status: number;
}

interface WireObservation {
  readonly attempt: number;
  readonly cookie: string | null;
  readonly elapsedMs: number;
  readonly path: string;
}

interface ReflectedSessionEntry {
  readonly key: string;
  readonly refCount: number;
  readonly session: http2.ClientHttp2Session;
  readonly state: 'reusable' | 'retired' | 'closed';
}

interface ReflectedSessionPool {
  readonly entriesBySession: Map<http2.ClientHttp2Session, ReflectedSessionEntry>;
  readonly pendingCreations: Set<unknown>;
  readonly sessions: Map<string, ReflectedSessionEntry>;
}

interface PoolLedger<T> {
  readonly acquisitions: number;
  readonly releases: number;
  readonly value: T;
}

interface Settlement {
  readonly elapsedMs: number;
  readonly error?: unknown;
  readonly response?: RezoResponse<unknown>;
}

interface TunnelObservation {
  completedTunnels: number;
  connections: number;
  connectRequests: string[];
}

interface TunnelFixture {
  readonly observation: TunnelObservation;
  readonly port: number;
  readonly server: net.Server;
  readonly sockets: Set<net.Socket>;
}

interface SplitTunnelFixture extends TunnelFixture {
  readonly clientSockets: Set<net.Socket>;
  readonly upstreamSockets: Set<net.Socket>;
}

let server: http2.Http2Server | undefined;
let port = 0;
let fixtureErrors: string[] = [];
let routes = new Map<string, readonly PlannedResponse[]>();
let routeAttempts = new Map<string, number>();
let testStartedAt = 0;
let wire: WireObservation[] = [];
const serverSessions = new Set<http2.ServerHttp2Session>();
const pool = Http2SessionPool.getInstance();

function fixtureUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function plan(
  path: string,
  response: PlannedResponse | readonly PlannedResponse[],
): void {
  routes.set(path, Array.isArray(response) ? response : [response]);
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

async function handleStream(
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
): Promise<void> {
  const path = String(headers[':path'] ?? '');
  for await (const _chunk of stream) {
    // Drain the request so every planned response observes a complete stream.
  }

  const attempt = (routeAttempts.get(path) ?? 0) + 1;
  routeAttempts.set(path, attempt);
  wire.push({
    attempt,
    cookie: headerValue(headers, 'cookie'),
    elapsedMs: Date.now() - testStartedAt,
    path,
  });

  const responses = routes.get(path);
  if (!responses || responses.length === 0) {
    fixtureErrors.push(`unexpected fixture route: ${path}`);
    stream.respond({ ':status': 404 });
    stream.end('unexpected fixture route');
    return;
  }

  const response = responses[Math.min(attempt - 1, responses.length - 1)];
  response.onRequest?.();
  if (response.reset) {
    stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
    return;
  }
  if (response.delayMs && response.delayMs > 0) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, response.delayMs));
    if (stream.closed || stream.destroyed) return;
  }

  const outgoing: http2.OutgoingHttpHeaders = {
    ':status': response.status,
    'content-type': 'application/json',
    ...response.headers,
  };
  if (response.location !== undefined) outgoing.location = response.location;
  if (response.setCookie !== undefined) outgoing['set-cookie'] = [...response.setCookie];
  stream.respond(outgoing);
  response.onHeaders?.();
  if (response.bodyDelayMs && response.bodyDelayMs > 0) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, response.bodyDelayMs));
    if (stream.closed || stream.destroyed) return;
  }
  stream.end(response.body ?? JSON.stringify({ attempt, path, status: response.status }));
}

function createServer(): http2.Http2Server {
  const fixture = http2.createServer();
  fixture.on('session', (session) => {
    serverSessions.add(session);
    session.on('close', () => serverSessions.delete(session));
    session.on('error', () => {});
  });
  fixture.on('stream', (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
  ) => {
    stream.on('error', () => {});
    void handleStream(stream, headers).catch((error: unknown) => {
      fixtureErrors.push(String((error as { message?: unknown })?.message ?? error));
      if (!stream.closed && !stream.destroyed) stream.destroy();
    });
  });
  return fixture;
}

function listen(fixture: http2.Http2Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      fixture.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      fixture.off('error', onError);
      const address = fixture.address();
      if (!address || typeof address === 'string') {
        rejectListen(new TypeError('h2c fixture did not expose an IP port'));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    fixture.once('error', onError);
    fixture.once('listening', onListening);
    fixture.listen(0, '127.0.0.1');
  });
}

function listenTunnel(fixture: net.Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      fixture.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      fixture.off('error', onError);
      const address = fixture.address();
      if (!address || typeof address === 'string') {
        rejectListen(new TypeError('proxy fixture did not expose an IP port'));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    fixture.once('error', onError);
    fixture.once('listening', onListening);
    fixture.listen(0, '127.0.0.1');
  });
}

async function createTunnelFixture(
  connectDelayMs: number | readonly number[] = 0,
): Promise<SplitTunnelFixture> {
  const observation: TunnelObservation = {
    completedTunnels: 0,
    connections: 0,
    connectRequests: [],
  };
  const sockets = new Set<net.Socket>();
  const clientSockets = new Set<net.Socket>();
  const upstreamSockets = new Set<net.Socket>();
  const proxy = net.createServer((clientSocket) => {
    const connectionIndex = observation.connections;
    observation.connections++;
    sockets.add(clientSocket);
    clientSockets.add(clientSocket);
    clientSocket.on('close', () => {
      sockets.delete(clientSocket);
      clientSockets.delete(clientSocket);
    });
    clientSocket.on('error', () => {});

    let requestBytes = Buffer.alloc(0);
    const onClientData = (chunk: Buffer) => {
      requestBytes = Buffer.concat([requestBytes, chunk]);
      const headerEnd = requestBytes.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      clientSocket.removeListener('data', onClientData);
      const connectRequest = requestBytes.subarray(0, headerEnd + 4).toString('latin1');
      observation.connectRequests.push(connectRequest);
      const firstLine = connectRequest.split('\r\n', 1)[0] ?? '';
      const match = /^CONNECT\s+127\.0\.0\.1:(\d+)\s+HTTP\/1\.1$/i.exec(firstLine);
      if (!match || Number(match[1]) !== port) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
        return;
      }

      const upstream = net.connect({ host: '127.0.0.1', port });
      sockets.add(upstream);
      upstreamSockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        upstreamSockets.delete(upstream);
      });
      clientSocket.once('close', () => {
        if (!upstream.destroyed) upstream.destroy();
      });
      upstream.once('close', () => {
        if (!clientSocket.destroyed) clientSocket.destroy();
      });
      upstream.on('error', () => clientSocket.destroy());
      upstream.once('connect', () => {
        const completeTunnel = () => {
          if (clientSocket.destroyed || upstream.destroyed) return;
          observation.completedTunnels++;
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const remainder = requestBytes.subarray(headerEnd + 4);
          if (remainder.length > 0) upstream.write(remainder);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        };
        const delayMs = typeof connectDelayMs === 'number'
          ? connectDelayMs
          : connectDelayMs[Math.min(connectionIndex, connectDelayMs.length - 1)] ?? 0;
        if (delayMs > 0) setTimeout(completeTunnel, delayMs);
        else completeTunnel();
      });
    };
    clientSocket.on('data', onClientData);
  });
  const tunnelPort = await listenTunnel(proxy);
  return {
    clientSockets,
    observation,
    port: tunnelPort,
    server: proxy,
    sockets,
    upstreamSockets,
  };
}

async function createFirstStalledTunnelFixture(): Promise<SplitTunnelFixture> {
  const observation: TunnelObservation = {
    completedTunnels: 0,
    connections: 0,
    connectRequests: [],
  };
  const sockets = new Set<net.Socket>();
  const clientSockets = new Set<net.Socket>();
  const upstreamSockets = new Set<net.Socket>();
  const proxy = net.createServer((clientSocket) => {
    const connectionIndex = observation.connections++;
    sockets.add(clientSocket);
    clientSockets.add(clientSocket);
    clientSocket.on('close', () => {
      sockets.delete(clientSocket);
      clientSockets.delete(clientSocket);
    });
    clientSocket.on('error', () => {});

    let requestBytes = Buffer.alloc(0);
    const onClientData = (chunk: Buffer) => {
      requestBytes = Buffer.concat([requestBytes, chunk]);
      const headerEnd = requestBytes.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      clientSocket.removeListener('data', onClientData);
      const connectRequest = requestBytes.subarray(0, headerEnd + 4).toString('latin1');
      observation.connectRequests.push(connectRequest);
      const firstLine = connectRequest.split('\r\n', 1)[0] ?? '';
      const match = /^CONNECT\s+127\.0\.0\.1:(\d+)\s+HTTP\/1\.1$/i.exec(firstLine);
      if (!match || Number(match[1]) !== port) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
        return;
      }

      // The first CONNECT remains unanswered and never owns an upstream. The
      // second connection is a normal fast tunnel to the h2c fixture.
      if (connectionIndex === 0) return;
      const upstream = net.connect({ host: '127.0.0.1', port });
      sockets.add(upstream);
      upstreamSockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        upstreamSockets.delete(upstream);
      });
      clientSocket.once('close', () => {
        if (!upstream.destroyed) upstream.destroy();
      });
      upstream.once('close', () => {
        if (!clientSocket.destroyed) clientSocket.destroy();
      });
      upstream.on('error', () => clientSocket.destroy());
      upstream.once('connect', () => {
        if (clientSocket.destroyed || upstream.destroyed) return;
        observation.completedTunnels++;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const remainder = requestBytes.subarray(headerEnd + 4);
        if (remainder.length > 0) upstream.write(remainder);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
    };
    clientSocket.on('data', onClientData);
  });
  const tunnelPort = await listenTunnel(proxy);
  return {
    clientSockets,
    observation,
    port: tunnelPort,
    server: proxy,
    sockets,
    upstreamSockets,
  };
}

async function createFailureTunnelFixture(
  responseDelayMs = 0,
): Promise<TunnelFixture> {
  const observation: TunnelObservation = {
    completedTunnels: 0,
    connections: 0,
    connectRequests: [],
  };
  const sockets = new Set<net.Socket>();
  const proxy = net.createServer((clientSocket) => {
    observation.connections++;
    sockets.add(clientSocket);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    clientSocket.on('error', () => {});

    let requestBytes = Buffer.alloc(0);
    const onClientData = (chunk: Buffer) => {
      requestBytes = Buffer.concat([requestBytes, chunk]);
      const headerEnd = requestBytes.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      clientSocket.removeListener('data', onClientData);
      observation.connectRequests.push(
        requestBytes.subarray(0, headerEnd + 4).toString('latin1'),
      );
      const fail = () => {
        if (!clientSocket.destroyed) {
          clientSocket.end(
            'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n',
          );
        }
      };
      if (responseDelayMs > 0) setTimeout(fail, responseDelayMs);
      else fail();
    };
    clientSocket.on('data', onClientData);
  });
  const tunnelPort = await listenTunnel(proxy);
  return { observation, port: tunnelPort, server: proxy, sockets };
}

async function createStalledTunnelFixture(): Promise<TunnelFixture> {
  const observation: TunnelObservation = {
    completedTunnels: 0,
    connections: 0,
    connectRequests: [],
  };
  const sockets = new Set<net.Socket>();
  const proxy = net.createServer((clientSocket) => {
    observation.connections++;
    sockets.add(clientSocket);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    clientSocket.on('error', () => {});

    let requestBytes = Buffer.alloc(0);
    const onClientData = (chunk: Buffer) => {
      requestBytes = Buffer.concat([requestBytes, chunk]);
      const headerEnd = requestBytes.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      clientSocket.removeListener('data', onClientData);
      observation.connectRequests.push(
        requestBytes.subarray(0, headerEnd + 4).toString('latin1'),
      );
      // Intentionally never answer CONNECT. Pool cancellation must settle the
      // acquisition and remove its pending ownership without a transport timer.
    };
    clientSocket.on('data', onClientData);
  });
  const tunnelPort = await listenTunnel(proxy);
  return { observation, port: tunnelPort, server: proxy, sockets };
}

async function closeTunnelFixture(fixture: TunnelFixture): Promise<void> {
  for (const socket of fixture.sockets) socket.destroy();
  fixture.sockets.clear();
  if (!fixture.server.listening) return;
  await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
}

async function closeServer(fixture: http2.Http2Server | undefined): Promise<void> {
  if (!fixture?.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    fixture.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 2));
  }
}

function client(jar?: RezoCookieJar): Rezo {
  return new Rezo(jar ? { jar } : {}, http2Adapter);
}

function cookieIdentityRows(cookies: Cookies): string[] {
  return cookies.array
    .map((cookie) => `${cookie.key}|${cookie.value}|${cookie.domain ?? ''}|${cookie.path ?? ''}`)
    .sort();
}

function serializedIdentityRows(cookies: Cookies): string[] {
  return cookies.serialized
    .map((cookie) => `${cookie.key}|${cookie.value}|${cookie.domain ?? ''}|${cookie.path ?? ''}`)
    .sort();
}

function netscapeIdentityRows(cookies: Cookies): string[] {
  return cookies.netscape
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const columns = line.split('\t');
      return `${columns[5]}|${columns[6]}|${columns[0]}|${columns[2]}`;
    })
    .sort();
}

function cookieStringRows(cookies: Cookies): string[] {
  return cookies.string ? cookies.string.split('; ').sort() : [];
}

function snapshot(cookies: Cookies): Readonly<Record<string, readonly string[]>> {
  return {
    array: cookieIdentityRows(cookies),
    netscape: netscapeIdentityRows(cookies),
    serialized: serializedIdentityRows(cookies),
    setCookiesString: [...cookies.setCookiesString],
    string: cookieStringRows(cookies),
  };
}

function reflectedRefCounts(url: string): number[] {
  const origin = new URL(url).origin;
  const reflected = pool as unknown as ReflectedSessionPool;
  return [...reflected.sessions.entries()]
    .filter(([key]) => key.startsWith(origin))
    .map(([, entry]) => entry.refCount);
}

function reflectedPool(): ReflectedSessionPool {
  return pool as unknown as ReflectedSessionPool;
}

async function withPoolLedger<T>(operation: () => Promise<T>): Promise<PoolLedger<T>> {
  const originalGetSession = pool.getSession;
  const originalReleaseSession = pool.releaseSession;
  let acquisitions = 0;
  let releases = 0;

  pool.getSession = (...args: Parameters<typeof originalGetSession>) => {
    acquisitions++;
    return originalGetSession.apply(pool, args);
  };
  pool.releaseSession = (...args: Parameters<typeof originalReleaseSession>) => {
    releases++;
    return originalReleaseSession.apply(pool, args);
  };

  try {
    const value = await operation();
    return { acquisitions, releases, value };
  } finally {
    pool.getSession = originalGetSession;
    pool.releaseSession = originalReleaseSession;
  }
}

async function settle(request: Promise<RezoResponse<unknown>>): Promise<Settlement> {
  const startedAt = Date.now();
  try {
    return { elapsedMs: Date.now() - startedAt, response: await request };
  } catch (error) {
    return { elapsedMs: Date.now() - startedAt, error };
  }
}

async function collectFinalStreamEvents(
  path: string,
  options: Parameters<Rezo['stream']>[1],
): Promise<string[]> {
  const events: string[] = [];
  const stream = client().stream(fixtureUrl(path), options);
  stream.on('headers', (event) => {
    events.push(`headers:${event.status}`);
  });
  stream.on('data', (chunk) => {
    events.push(`data:${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`);
  });

  await new Promise<void>((resolveFinish, rejectFinish) => {
    stream.on('finish', (event) => {
      events.push(`finish:${event.status}`);
      if (event.status === 200) resolveFinish();
    });
    stream.once('error', rejectFinish);
  });
  return events;
}

beforeAll(async () => {
  server = createServer();
  try {
    port = await listen(server);
  } catch (error) {
    for (const session of serverSessions) session.destroy();
    serverSessions.clear();
    await closeServer(server);
    throw error;
  }
});

afterAll(async () => {
  pool.closeAllSessions();
  for (const session of serverSessions) session.destroy();
  serverSessions.clear();
  await closeServer(server);
});

beforeEach(() => {
  pool.closeAllSessions();
  fixtureErrors = [];
  routeAttempts = new Map();
  routes = new Map();
  testStartedAt = Date.now();
  wire = [];
});

afterEach(() => {
  const errors = [...fixtureErrors];
  pool.closeAllSessions();
  expect(errors).toEqual([]);
});

describe('Phase 1c-c HTTP/2 cookie identity and accepted serialization', () => {
  it('accumulates redirect and terminal Set-Cookie across every public representation', async () => {
    const redirectRaw = 'redirected=one; Path=/identity-accumulate';
    const terminalRaw = 'terminal=two; Path=/identity-accumulate';
    plan('/identity-accumulate/start', {
      location: fixtureUrl('/identity-accumulate/final'),
      setCookie: [redirectRaw],
      status: 302,
    });
    plan('/identity-accumulate/final', {
      setCookie: [terminalRaw],
      status: 200,
    });

    const instance = client();
    const response = await instance.get<unknown>(fixtureUrl('/identity-accumulate/start'), {
      cache: false,
      timeout: 2_000,
    });
    const expected = {
      array: [
        'redirected|one|127.0.0.1|/identity-accumulate',
        'terminal|two|127.0.0.1|/identity-accumulate',
      ],
      netscape: [
        'redirected|one|127.0.0.1|/identity-accumulate',
        'terminal|two|127.0.0.1|/identity-accumulate',
      ],
      serialized: [
        'redirected|one|127.0.0.1|/identity-accumulate',
        'terminal|two|127.0.0.1|/identity-accumulate',
      ],
      setCookiesString: [redirectRaw, terminalRaw],
      string: ['redirected=one', 'terminal=two'],
    };

    expect(response.status).toBe(200);
    expect(wire.map(({ cookie, path }) => ({ cookie, path }))).toEqual([
      { cookie: null, path: '/identity-accumulate/start' },
      { cookie: 'redirected=one', path: '/identity-accumulate/final' },
    ]);
    expect(snapshot(response.config.responseCookies)).toEqual(expected);
    expect(snapshot(response.cookies)).toEqual(expected);
    expect(cookieIdentityRows(instance.getCookies(fixtureUrl('/identity-accumulate/final'))))
      .toEqual(expected.array);
  });

  it('retains same-name same-domain cookies as distinct identities when Path differs', async () => {
    const rootRaw = 'scope=root; Path=/';
    const deepRaw = 'scope=deep; Path=/identity-path/deep';
    plan('/identity-path/start', {
      location: fixtureUrl('/identity-path/deep/final'),
      setCookie: [rootRaw],
      status: 302,
    });
    plan('/identity-path/deep/final', {
      setCookie: [deepRaw],
      status: 200,
    });

    const instance = client();
    const response = await instance.get<unknown>(fixtureUrl('/identity-path/start'), {
      cache: false,
      timeout: 2_000,
    });
    const expectedRows = [
      'scope|deep|127.0.0.1|/identity-path/deep',
      'scope|root|127.0.0.1|/',
    ];

    expect(response.status).toBe(200);
    expect(cookieIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(serializedIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(netscapeIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(response.config.responseCookies.setCookiesString).toEqual([rootRaw, deepRaw]);
    expect(cookieIdentityRows(response.cookies)).toEqual(expectedRows);
    expect(serializedIdentityRows(response.cookies)).toEqual(expectedRows);
    expect(netscapeIdentityRows(response.cookies)).toEqual(expectedRows);
    expect([...response.cookies.setCookiesString].sort()).toEqual([deepRaw, rootRaw]);
    expect(cookieIdentityRows(instance.getCookies(fixtureUrl('/identity-path/deep/final'))))
      .toEqual(expectedRows);
  });

  it('commits beforeCookie value and Path mutation to jar, redirect wire, metadata, and accepted raw', async () => {
    plan('/identity-mutation/start', {
      location: fixtureUrl('/identity-mutation/final'),
      setCookie: ['mutable=before; Path=/identity-mutation/original'],
      status: 302,
    });
    plan('/identity-mutation/final', { status: 200 });
    const jar = new RezoCookieJar();
    const instance = client(jar);
    let expectedAcceptedRaw = '';

    const response = await instance.get<unknown>(fixtureUrl('/identity-mutation/start'), {
      cache: false,
      hooks: {
        beforeCookie: [(event: { cookie: Cookie }) => {
          event.cookie.value = 'after';
          event.cookie.path = '/identity-mutation';
          expectedAcceptedRaw = event.cookie.toSetCookieString();
          return true;
        }],
      },
      timeout: 2_000,
    } as never);
    const expectedRows = ['mutable|after|127.0.0.1|/identity-mutation'];

    expect(expectedAcceptedRaw).toBe('mutable=after; Path=/identity-mutation');
    expect(wire.map(({ cookie, path }) => ({ cookie, path }))).toEqual([
      { cookie: null, path: '/identity-mutation/start' },
      { cookie: 'mutable=after', path: '/identity-mutation/final' },
    ]);
    expect(cookieIdentityRows(jar.cookies())).toEqual(expectedRows);
    expect(cookieIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(serializedIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(netscapeIdentityRows(response.config.responseCookies)).toEqual(expectedRows);
    expect(response.config.responseCookies.setCookiesString).toEqual([expectedAcceptedRaw]);
    expect(cookieIdentityRows(response.cookies)).toEqual(expectedRows);
    expect(response.cookies.setCookiesString).toEqual([expectedAcceptedRaw]);
  });
});

describe('Phase 1c-c HTTP/2 abnormal settlement releases', () => {
  it('releases a beforeCookie-timeout acquisition exactly once before pooled success', async () => {
    plan('/pool-cookie-timeout', {
      setCookie: ['pending=blocked; Path=/pool-cookie-timeout'],
      status: 200,
    });
    plan('/pool-after-timeout', { status: 200 });

    const ledger = await withPoolLedger(async () => {
      const timedOut = await settle(client().get<unknown>(fixtureUrl('/pool-cookie-timeout'), {
        cache: false,
        hooks: {
          beforeCookie: [() => new Promise<boolean>(() => {})],
        },
        retry: false,
        timeout: 120,
      } as never));
      const success = await client().get<unknown>(fixtureUrl('/pool-after-timeout'), {
        cache: false,
        retry: false,
        timeout: 1_000,
      });
      return { success, timedOut };
    });

    expect(ledger.value.timedOut.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(ledger.value.success.status).toBe(200);
    expect(wire.map(({ path }) => path)).toEqual([
      '/pool-cookie-timeout',
      '/pool-after-timeout',
    ]);
    expect({
      acquisitions: ledger.acquisitions,
      refCounts: reflectedRefCounts(fixtureUrl('/')),
      releases: ledger.releases,
    }).toEqual({ acquisitions: 2, refCounts: [0], releases: 2 });
  });

  it('releases a reset attempt exactly once before retry success', async () => {
    plan('/pool-reset-retry', [
      { reset: true, status: 200 },
      { status: 200 },
    ]);

    const ledger = await withPoolLedger(async () => client().get<unknown>(
      fixtureUrl('/pool-reset-retry'),
      {
        cache: false,
        retry: {
          condition: () => true,
          maxRetries: 1,
          retryDelay: 0,
        },
        timeout: 1_000,
      } as never,
    ));

    expect(ledger.value.status).toBe(200);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/pool-reset-retry' },
      { attempt: 2, path: '/pool-reset-retry' },
    ]);
    expect({
      acquisitions: ledger.acquisitions,
      refCounts: reflectedRefCounts(fixtureUrl('/')),
      releases: ledger.releases,
    }).toEqual({ acquisitions: 2, refCounts: [0], releases: 2 });
  });
});

describe('Phase 1c-c HTTP/2 absolute lifetime across connect and response stages', () => {
  it('does not restart numeric timeout after delayed proxy CONNECT/session acquisition', async () => {
    plan('/proxy-total-deadline', {
      delayMs: 180,
      status: 200,
    });
    const tunnel = await createTunnelFixture(100);

    try {
      const ledger = await withPoolLedger(async () => {
        const result = await settle(client().get<unknown>(fixtureUrl('/proxy-total-deadline'), {
          cache: false,
          proxy: {
            host: '127.0.0.1',
            port: tunnel.port,
            protocol: 'http',
          },
          retry: false,
          timeout: 240,
        } as never));
        await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 100));
        return result;
      });

      expect(ledger.value.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
      expect(ledger.value.response).toBeUndefined();
      expect(ledger.value.elapsedMs).toBeGreaterThanOrEqual(180);
      expect(ledger.value.elapsedMs).toBeLessThan(600);
      expect(wire.map(({ path }) => path)).toEqual(['/proxy-total-deadline']);
      expect(tunnel.observation.connections).toBe(1);
      expect(tunnel.observation.connectRequests).toHaveLength(1);
      expect(tunnel.observation.connectRequests[0]?.endsWith('\r\n\r\n')).toBe(true);
      expect({
        acquisitions: ledger.acquisitions,
        refCounts: reflectedRefCounts(fixtureUrl('/')),
        releases: ledger.releases,
      }).toEqual({ acquisitions: 1, refCounts: [0], releases: 1 });
    } finally {
      pool.closeAllSessions();
      await closeTunnelFixture(tunnel);
    }
  });
});

describe('Phase 1c-c HTTP/2 caller AbortSignal lifetime', () => {
  it('rejects a pre-aborted signal before dispatch or session acquisition', async () => {
    plan('/signal-pre-abort', { status: 200 });
    const controller = new AbortController();
    controller.abort();

    const ledger = await withPoolLedger(async () => {
      const result = await settle(client().get<unknown>(fixtureUrl('/signal-pre-abort'), {
        cache: false,
        retry: false,
        signal: controller.signal,
        timeout: 1_000,
      }));
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 50));
      return result;
    });

    expect(ledger.value.error).toMatchObject({ code: 'ABORT_ERR' });
    expect(ledger.value.response).toBeUndefined();
    expect(ledger.value.elapsedMs).toBeLessThan(300);
    expect(wire).toEqual([]);
    expect({
      acquisitions: ledger.acquisitions,
      refCounts: reflectedRefCounts(fixtureUrl('/')),
      releases: ledger.releases,
    }).toEqual({ acquisitions: 0, refCounts: [], releases: 0 });
  });

  it('aborts after response headers, emits no late success, releases once, and reuses the proxy session', async () => {
    plan('/signal-mid-response', {
      body: 'LATE-SUCCESS',
      bodyDelayMs: 250,
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });
    plan('/signal-after-abort', {
      body: 'RECOVERED',
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });
    const tunnel = await createTunnelFixture();
    const proxy = {
      host: '127.0.0.1',
      port: tunnel.port,
      protocol: 'http',
    } as const;
    const controller = new AbortController();

    try {
      const ledger = await withPoolLedger(async () => {
        const events: string[] = [];
        let markHeadersSeen!: () => void;
        let resolveAbort!: (error: RezoError) => void;
        const headersSeen = new Promise<void>((resolve) => {
          markHeadersSeen = resolve;
        });
        const abortError = new Promise<RezoError>((resolve) => {
          resolveAbort = resolve;
        });
        const stream = client().stream(fixtureUrl('/signal-mid-response'), {
          cache: false,
          proxy,
          retry: false,
          signal: controller.signal,
          timeout: 1_000,
        } as never);
        stream.on('headers', (event) => {
          events.push(`headers:${event.status}`);
          markHeadersSeen();
        });
        stream.on('data', (chunk) => {
          events.push(`data:${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`);
        });
        stream.on('finish', (event) => {
          events.push(`finish:${event.status}`);
        });
        stream.on('error', (error) => {
          events.push(`error:${error.code}`);
          resolveAbort(error);
        });

        await headersSeen;
        controller.abort();
        const error = await abortError;
        const followUp = await client().get<unknown>(fixtureUrl('/signal-after-abort'), {
          cache: false,
          proxy,
          retry: false,
          timeout: 1_000,
        } as never);
        await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 280));
        return { error, events, followUp };
      });

      expect(ledger.value.error).toMatchObject({ code: 'ABORT_ERR' });
      expect(ledger.value.followUp).toMatchObject({
        data: 'RECOVERED',
        status: 200,
      });
      expect(ledger.value.events).toEqual([
        'headers:200',
        'error:ABORT_ERR',
      ]);
      expect(wire.map(({ path }) => path)).toEqual([
        '/signal-mid-response',
        '/signal-after-abort',
      ]);
      expect(tunnel.observation.connections).toBe(1);
      expect(tunnel.observation.connectRequests).toHaveLength(1);
      expect({
        acquisitions: ledger.acquisitions,
        refCounts: reflectedRefCounts(fixtureUrl('/')),
        releases: ledger.releases,
      }).toEqual({ acquisitions: 2, refCounts: [0], releases: 2 });
    } finally {
      pool.closeAllSessions();
      await closeTunnelFixture(tunnel);
    }
  });
});

describe('Phase 1c-c HTTP/2 pending CONNECT pool cancellation', () => {
  it.each([
    { cancellation: 'closeSession' as const },
    { cancellation: 'closeAllSessions' as const },
  ])('settles and forgets a timeout:null CONNECT after $cancellation', async ({ cancellation }) => {
    const tunnel = await createStalledTunnelFixture();
    const proxy = {
      host: '127.0.0.1',
      port: tunnel.port,
      protocol: 'http',
    } as const;
    const targetUrl = new URL(fixtureUrl(`/pending-connect/${cancellation}`));
    const reflected = reflectedPool();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    let observation: {
      readonly cancellationElapsedMs: number;
      readonly entries: number;
      readonly error?: unknown;
      readonly pendingCreations: number;
      readonly proxySockets: number;
      readonly sessions: number;
      readonly unhandledRejections: readonly unknown[];
      readonly value?: http2.ClientHttp2Session;
    } | undefined;

    try {
      const acquisition = pool.getSession(
        targetUrl,
        undefined,
        null as never,
        false,
        proxy,
      );
      const settlement = acquisition.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await waitForCondition(
        () => tunnel.observation.connectRequests.length === 1,
        'the stalled proxy CONNECT request',
      );

      const cancellationStartedAt = performance.now();
      if (cancellation === 'closeSession') pool.closeSession(targetUrl, proxy);
      else pool.closeAllSessions();

      let promptTimer: ReturnType<typeof setTimeout> | undefined;
      const promptSettlement = await Promise.race([
        settlement,
        new Promise<never>((_resolve, rejectPrompt) => {
          promptTimer = setTimeout(() => {
            rejectPrompt(new Error(`${cancellation} did not settle pending CONNECT promptly`));
          }, 150);
        }),
      ]).finally(() => {
        if (promptTimer !== undefined) clearTimeout(promptTimer);
      });
      const cancellationElapsedMs = performance.now() - cancellationStartedAt;

      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 325));
      await waitForCondition(
        () => tunnel.sockets.size === 0,
        'the cancelled proxy socket to close',
      );
      observation = {
        ...promptSettlement,
        cancellationElapsedMs,
        entries: reflected.entriesBySession.size,
        pendingCreations: reflected.pendingCreations.size,
        proxySockets: tunnel.sockets.size,
        sessions: reflected.sessions.size,
        unhandledRejections: [...unhandledRejections],
      };
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      pool.closeAllSessions();
      // A failing old implementation leaves a never-settling ownership token.
      // Keep that mutation discriminator from contaminating subsequent rows.
      reflected.pendingCreations.clear();
      await closeTunnelFixture(tunnel);
    }

    expect(observation).toMatchObject({
      entries: 0,
      pendingCreations: 0,
      proxySockets: 0,
      sessions: 0,
      unhandledRejections: [],
    });
    expect(observation?.error).toBeInstanceOf(Error);
    expect(observation?.value).toBeUndefined();
    expect(observation?.cancellationElapsedMs).toBeLessThan(150);
  });
});

describe('Phase 1c-c HTTP/2 superseded stalled CONNECT ownership', () => {
  it('cancels a stalled timeout:null creator when a fast same-key creator wins', async () => {
    const tunnel = await createFirstStalledTunnelFixture();
    const proxy = {
      host: '127.0.0.1',
      port: tunnel.port,
      protocol: 'http',
    } as const;
    const targetUrl = new URL(fixtureUrl('/stalled-connect-race'));
    const reflected = reflectedPool();
    const baselineServerSessions = new Set(serverSessions);
    const unhandledRejections: unknown[] = [];
    const targetSessionCount = () => [...serverSessions]
      .filter((session) => !baselineServerSessions.has(session)).length;
    const targetEntries = () => [...reflected.entriesBySession.values()]
      .filter((entry) => entry.key.startsWith(targetUrl.origin));
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    let observation: {
      readonly afterCloseAll: {
        readonly clientSockets: number;
        readonly entries: number;
        readonly pendingCreations: number;
        readonly sessions: number;
        readonly targetSessions: number;
        readonly upstreamSockets: number;
      };
      readonly beforeRelease: {
        readonly clientSockets: number;
        readonly connectRequests: number;
        readonly entries: number;
        readonly pendingCreations: number;
        readonly refCounts: readonly number[];
        readonly sessions: number;
        readonly targetSessions: number;
        readonly upstreamSockets: number;
      };
      readonly callersSharedWinner: boolean;
      readonly promptElapsedMs: number;
      readonly unhandledRejections: readonly unknown[];
    } | undefined;

    try {
      const stalledCreator = pool.getSession(
        targetUrl,
        undefined,
        null as never,
        false,
        proxy,
      );
      await waitForCondition(
        () => tunnel.observation.connectRequests.length === 1,
        'the first stalled CONNECT request',
      );

      const fastStartedAt = performance.now();
      const fastCreator = pool.getSession(
        targetUrl,
        undefined,
        1_000,
        false,
        proxy,
      );
      let promptTimer: ReturnType<typeof setTimeout> | undefined;
      const [stalledWinner, fastWinner] = await Promise.race([
        Promise.all([stalledCreator, fastCreator]),
        new Promise<never>((_resolve, rejectPrompt) => {
          promptTimer = setTimeout(() => {
            rejectPrompt(new Error('same-key winner did not settle both CONNECT creators promptly'));
          }, 200);
        }),
      ]).finally(() => {
        if (promptTimer !== undefined) clearTimeout(promptTimer);
      });
      const promptElapsedMs = performance.now() - fastStartedAt;

      await waitForCondition(
        () => tunnel.observation.connectRequests.length === 2
          && tunnel.observation.completedTunnels === 1,
        'the fast proxy tunnel to complete',
      );
      await new Promise<void>((resolveCleanupWindow) => {
        setTimeout(resolveCleanupWindow, 400);
      });
      const beforeRelease = {
        clientSockets: tunnel.clientSockets.size,
        connectRequests: tunnel.observation.connectRequests.length,
        entries: targetEntries().length,
        pendingCreations: reflected.pendingCreations.size,
        refCounts: targetEntries().map(({ refCount }) => refCount),
        sessions: [...reflected.sessions.keys()]
          .filter((key) => key.startsWith(targetUrl.origin)).length,
        targetSessions: targetSessionCount(),
        upstreamSockets: tunnel.upstreamSockets.size,
      };

      pool.releaseSession(targetUrl, proxy);
      pool.releaseSession(targetUrl, proxy);
      pool.closeAllSessions();
      await new Promise<void>((resolveCloseWindow) => setTimeout(resolveCloseWindow, 325));
      observation = {
        afterCloseAll: {
          clientSockets: tunnel.clientSockets.size,
          entries: targetEntries().length,
          pendingCreations: reflected.pendingCreations.size,
          sessions: [...reflected.sessions.keys()]
            .filter((key) => key.startsWith(targetUrl.origin)).length,
          targetSessions: targetSessionCount(),
          upstreamSockets: tunnel.upstreamSockets.size,
        },
        beforeRelease,
        callersSharedWinner: stalledWinner === fastWinner,
        promptElapsedMs,
        unhandledRejections: [...unhandledRejections],
      };
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      pool.closeAllSessions();
      await closeTunnelFixture(tunnel);
    }

    expect(observation).toMatchObject({
      afterCloseAll: {
        clientSockets: 0,
        entries: 0,
        pendingCreations: 0,
        sessions: 0,
        targetSessions: 0,
        upstreamSockets: 0,
      },
      beforeRelease: {
        clientSockets: 1,
        connectRequests: 2,
        entries: 1,
        pendingCreations: 0,
        refCounts: [2],
        sessions: 1,
        targetSessions: 1,
        upstreamSockets: 1,
      },
      callersSharedWinner: true,
      unhandledRejections: [],
    });
    expect(observation?.promptElapsedMs).toBeLessThan(200);
  });
});

describe('Phase 1c-c HTTP/2 legacy pool release across forceNew generations', () => {
  it('drains current and retired references through the unchanged public release signature', async () => {
    const targetUrl = new URL(fixtureUrl('/legacy-force-new-release'));
    const reflected = reflectedPool();
    const baselineServerSessions = new Set(serverSessions);
    const targetSessionCount = () => [...serverSessions]
      .filter((session) => !baselineServerSessions.has(session)).length;
    const targetEntries = () => [...reflected.entriesBySession.values()]
      .filter((entry) => entry.key.startsWith(targetUrl.origin));

    try {
      const baseline = await pool.getSession(targetUrl, undefined, 1_000);
      const replacement = await pool.getSession(targetUrl, undefined, 1_000, true);
      const replacementLease = await pool.getSession(targetUrl, undefined, 1_000);

      expect(replacement).not.toBe(baseline);
      expect(replacementLease).toBe(replacement);
      expect(pool.releaseSession.length).toBe(2);
      expect(targetEntries().map(({ refCount, state }) => ({ refCount, state })))
        .toEqual([
          { refCount: 1, state: 'retired' },
          { refCount: 2, state: 'reusable' },
        ]);
      await waitForCondition(
        () => targetSessionCount() === 2,
        'both forceNew target sessions to reach the server',
      );
      expect(targetSessionCount()).toBe(2);

      // This is the legacy public path. The exact-generation adapter path stays
      // covered independently by the concurrent acquisition test below.
      pool.releaseSession(targetUrl);
      pool.releaseSession(targetUrl);
      pool.releaseSession(targetUrl);

      expect(targetEntries().map(({ refCount, state }) => ({ refCount, state })))
        .toEqual([{ refCount: 0, state: 'reusable' }]);

      pool.closeAllSessions();
      await waitForCondition(
        () => targetSessionCount() === 0,
        'all forceNew target sessions to close',
      );
      expect({
        entries: targetEntries().length,
        sessions: [...reflected.sessions.keys()]
          .filter((key) => key.startsWith(targetUrl.origin)).length,
        targetSessions: targetSessionCount(),
      }).toEqual({ entries: 0, sessions: 0, targetSessions: 0 });
    } finally {
      pool.closeAllSessions();
    }
  });
});

describe('Phase 1c-c HTTP/2 late SOCKS acquisition ownership', () => {
  it('disposes a SOCKS socket that resolves after its creation was superseded', async () => {
    const targetUrl = new URL(fixtureUrl('/late-socks-acquisition'));
    const proxy = 'socks5://127.0.0.1:1';
    const reflected = reflectedPool();
    const originalCreateConnection = SocksClient.createConnection;
    const baselineServerSessions = new Set(serverSessions);
    const openedSockets = new Set<net.Socket>();
    const unhandledRejections: unknown[] = [];
    const targetSessionCount = () => [...serverSessions]
      .filter((session) => !baselineServerSessions.has(session)).length;
    const targetEntries = () => [...reflected.entriesBySession.values()]
      .filter((entry) => entry.key.startsWith(targetUrl.origin));
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    let connectionCount = 0;
    let markLateConnectionResolved!: () => void;
    const lateConnectionResolved = new Promise<void>((resolve) => {
      markLateConnectionResolved = resolve;
    });
    process.on('unhandledRejection', onUnhandledRejection);

    let observation: {
      readonly afterCloseAll: {
        readonly entries: number;
        readonly openSockets: number;
        readonly pendingCreations: number;
        readonly sessions: number;
        readonly targetSessions: number;
      };
      readonly beforeRelease: {
        readonly entries: number;
        readonly openSockets: number;
        readonly pendingCreations: number;
        readonly refCounts: readonly number[];
        readonly sessions: number;
        readonly targetSessions: number;
      };
      readonly callersSharedWinner: boolean;
      readonly unhandledRejections: readonly unknown[];
    } | undefined;

    try {
      SocksClient.createConnection = async (options) => {
        const connectionIndex = connectionCount++;
        const socket = net.connect({
          host: options.destination.host,
          port: options.destination.port,
        });
        openedSockets.add(socket);
        socket.on('close', () => openedSockets.delete(socket));
        socket.on('error', () => {});
        await new Promise<void>((resolveConnection, rejectConnection) => {
          socket.once('connect', resolveConnection);
          socket.once('error', rejectConnection);
        });
        if (connectionIndex === 0) {
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 220));
          markLateConnectionResolved();
        }
        return { socket };
      };

      const slowCreator = pool.getSession(
        targetUrl,
        undefined,
        1_000,
        false,
        proxy,
      );
      await waitForCondition(
        () => connectionCount === 1 && targetSessionCount() === 1,
        'the delayed SOCKS target connection',
      );
      const fastCreator = pool.getSession(
        targetUrl,
        undefined,
        1_000,
        false,
        proxy,
      );
      const [slowWinner, fastWinner] = await Promise.all([slowCreator, fastCreator]);

      await lateConnectionResolved;
      await new Promise<void>((resolveCleanupWindow) => {
        setTimeout(resolveCleanupWindow, 325);
      });
      observation = {
        afterCloseAll: {
          entries: -1,
          openSockets: -1,
          pendingCreations: -1,
          sessions: -1,
          targetSessions: -1,
        },
        beforeRelease: {
          entries: targetEntries().length,
          openSockets: openedSockets.size,
          pendingCreations: reflected.pendingCreations.size,
          refCounts: targetEntries().map(({ refCount }) => refCount),
          sessions: [...reflected.sessions.keys()]
            .filter((key) => key.startsWith(targetUrl.origin)).length,
          targetSessions: targetSessionCount(),
        },
        callersSharedWinner: slowWinner === fastWinner,
        unhandledRejections: [],
      };

      pool.releaseSession(targetUrl, proxy);
      pool.releaseSession(targetUrl, proxy);
      pool.closeAllSessions();
      await new Promise<void>((resolveCloseWindow) => setTimeout(resolveCloseWindow, 325));
      observation = {
        ...observation,
        afterCloseAll: {
          entries: targetEntries().length,
          openSockets: openedSockets.size,
          pendingCreations: reflected.pendingCreations.size,
          sessions: [...reflected.sessions.keys()]
            .filter((key) => key.startsWith(targetUrl.origin)).length,
          targetSessions: targetSessionCount(),
        },
        unhandledRejections: [...unhandledRejections],
      };
    } finally {
      SocksClient.createConnection = originalCreateConnection;
      process.off('unhandledRejection', onUnhandledRejection);
      pool.closeAllSessions();
      for (const socket of openedSockets) socket.destroy();
      openedSockets.clear();
    }

    expect(observation).toEqual({
      afterCloseAll: {
        entries: 0,
        openSockets: 0,
        pendingCreations: 0,
        sessions: 0,
        targetSessions: 0,
      },
      beforeRelease: {
        entries: 1,
        openSockets: 1,
        pendingCreations: 0,
        refCounts: [2],
        sessions: 1,
        targetSessions: 1,
      },
      callersSharedWinner: true,
      unhandledRejections: [],
    });
  });
});

describe('Phase 1c-c HTTP/2 concurrent session acquisition ownership', () => {
  it('does not let a superseded slow acquisition overwrite or outlive the winner', async () => {
    plan('/session-race/aborted-slow', { status: 200 });
    let markFastRequestStarted!: () => void;
    const fastRequestStarted = new Promise<void>((resolve) => {
      markFastRequestStarted = resolve;
    });
    plan('/session-race/fast-live', {
      delayMs: 350,
      onRequest: markFastRequestStarted,
      status: 200,
    });
    const tunnel = await createTunnelFixture([160, 0]);
    const proxy = {
      host: '127.0.0.1',
      port: tunnel.port,
      protocol: 'http',
    } as const;
    const controller = new AbortController();
    const abortReasons: string[] = [];
    const baselineSessions = new Set(serverSessions);
    const targetSessionCount = () => [...serverSessions]
      .filter((session) => !baselineSessions.has(session)).length;
    const reflected = reflectedPool();
    const targetEntryCount = () => [...reflected.entriesBySession.values()]
      .filter((entry) => entry.key.startsWith(new URL(fixtureUrl('/')).origin)).length;

    try {
      const ledger = await withPoolLedger(async () => {
        const instance = client();
        const slowSettlementPromise = settle(instance.get<unknown>(
          fixtureUrl('/session-race/aborted-slow'),
          {
            cache: false,
            hooks: {
              onAbort: [(event: { reason: string }) => {
                abortReasons.push(event.reason);
              }],
            },
            proxy,
            retry: false,
            signal: controller.signal,
            timeout: 1_000,
          } as never,
        ));
        await waitForCondition(
          () => tunnel.observation.connectRequests.length === 1,
          'the slow proxy CONNECT request',
        );
        controller.abort();
        const slowSettlement = await slowSettlementPromise;

        const fastResponsePromise = instance.get<unknown>(
          fixtureUrl('/session-race/fast-live'),
          {
            cache: false,
            proxy,
            retry: false,
            timeout: 1_000,
          } as never,
        );
        await fastRequestStarted;
        await waitForCondition(
          () => tunnel.observation.connectRequests.length === 2
            && tunnel.observation.completedTunnels === 1
            && tunnel.clientSockets.size === 1
            && tunnel.upstreamSockets.size === 1
            && reflected.pendingCreations.size === 0
            && targetSessionCount() === 1,
          'the winner tunnel to remain after loser cleanup',
        );
        const refCountsWhileFastRequestLive = reflectedRefCounts(fixtureUrl('/'));
        const targetSessionsWhileFastRequestLive = targetSessionCount();
        const entriesWhileFastRequestLive = targetEntryCount();
        const pendingWhileFastRequestLive = reflected.pendingCreations.size;
        const proxyClientsWhileFastRequestLive = tunnel.clientSockets.size;
        const proxyUpstreamsWhileFastRequestLive = tunnel.upstreamSockets.size;

        const fastResponse = await fastResponsePromise;
        const refCountsAfterFastResponse = reflectedRefCounts(fixtureUrl('/'));
        const targetSessionsBeforeCloseAll = targetSessionCount();
        pool.closeAllSessions();
        await waitForCondition(
          () => targetSessionCount() === 0
            && tunnel.clientSockets.size === 0
            && tunnel.upstreamSockets.size === 0,
          'the winner tunnel to close',
        );

        return {
          entriesAfterCloseAll: targetEntryCount(),
          entriesWhileFastRequestLive,
          fastResponse,
          pendingAfterCloseAll: reflected.pendingCreations.size,
          pendingWhileFastRequestLive,
          proxyClientsAfterCloseAll: tunnel.clientSockets.size,
          proxyClientsWhileFastRequestLive,
          proxyUpstreamsAfterCloseAll: tunnel.upstreamSockets.size,
          proxyUpstreamsWhileFastRequestLive,
          refCountsAfterFastResponse,
          refCountsWhileFastRequestLive,
          slowSettlement,
          targetSessionsAfterCloseAll: targetSessionCount(),
          targetSessionsBeforeCloseAll,
          targetSessionsWhileFastRequestLive,
        };
      });

      expect(ledger.value.slowSettlement.error).toMatchObject({ code: 'ABORT_ERR' });
      expect(ledger.value.slowSettlement.response).toBeUndefined();
      expect(ledger.value.fastResponse.status).toBe(200);
      expect(abortReasons).toEqual(['signal']);
      expect(tunnel.observation).toMatchObject({
        completedTunnels: 1,
        connections: 2,
      });
      expect(tunnel.observation.connectRequests).toHaveLength(2);
      expect(wire.map(({ path }) => path)).toEqual(['/session-race/fast-live']);
      expect({
        acquisitions: ledger.acquisitions,
        entriesAfterCloseAll: ledger.value.entriesAfterCloseAll,
        entriesWhileFastRequestLive: ledger.value.entriesWhileFastRequestLive,
        pendingAfterCloseAll: ledger.value.pendingAfterCloseAll,
        pendingWhileFastRequestLive: ledger.value.pendingWhileFastRequestLive,
        proxyClientsAfterCloseAll: ledger.value.proxyClientsAfterCloseAll,
        proxyClientsWhileFastRequestLive: ledger.value.proxyClientsWhileFastRequestLive,
        proxyUpstreamsAfterCloseAll: ledger.value.proxyUpstreamsAfterCloseAll,
        proxyUpstreamsWhileFastRequestLive: ledger.value.proxyUpstreamsWhileFastRequestLive,
        refCountsAfterFastResponse: ledger.value.refCountsAfterFastResponse,
        refCountsWhileFastRequestLive: ledger.value.refCountsWhileFastRequestLive,
        releases: ledger.releases,
        targetSessionsAfterCloseAll: ledger.value.targetSessionsAfterCloseAll,
        targetSessionsBeforeCloseAll: ledger.value.targetSessionsBeforeCloseAll,
        targetSessionsWhileFastRequestLive: ledger.value.targetSessionsWhileFastRequestLive,
      }).toEqual({
        acquisitions: 2,
        entriesAfterCloseAll: 0,
        entriesWhileFastRequestLive: 1,
        pendingAfterCloseAll: 0,
        pendingWhileFastRequestLive: 0,
        proxyClientsAfterCloseAll: 0,
        proxyClientsWhileFastRequestLive: 1,
        proxyUpstreamsAfterCloseAll: 0,
        proxyUpstreamsWhileFastRequestLive: 1,
        refCountsAfterFastResponse: [0],
        refCountsWhileFastRequestLive: [1],
        // One release: the aborted caller cancels its own pending creation (creators race, never join),
        // so the superseded acquisition never holds a lease — only the winner releases.
        releases: 1,
        targetSessionsAfterCloseAll: 0,
        targetSessionsBeforeCloseAll: 1,
        targetSessionsWhileFastRequestLive: 1,
      });
    } finally {
      pool.closeAllSessions();
      await closeTunnelFixture(tunnel);
    }
  });
});

describe('Phase 1c-c HTTP/2 timed-out redirect hook transaction', () => {
  it('does not let a late beforeRedirect continuation mutate the rejected public state', async () => {
    plan('/late-redirect-hook/start', {
      location: fixtureUrl('/late-redirect-hook/final'),
      status: 302,
    });
    plan('/late-redirect-hook/final', { status: 200 });
    let releaseHook!: () => void;
    let markHookComplete!: () => void;
    let markHookStarted!: () => void;
    const hookRelease = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const hookComplete = new Promise<void>((resolve) => {
      markHookComplete = resolve;
    });
    const hookStarted = new Promise<void>((resolve) => {
      markHookStarted = resolve;
    });
    const request = client().get<unknown>(fixtureUrl('/late-redirect-hook/start'), {
      cache: false,
      headers: { 'X-Stable': 'caller' },
      hooks: {
        beforeRedirect: [async (context: {
          request: {
            fullUrl: string;
            headers: RezoHeaders;
            method: string;
          };
        }) => {
          markHookStarted();
          await hookRelease;
          context.request.fullUrl = fixtureUrl('/late-redirect-hook/late-mutation');
          context.request.method = 'POST';
          context.request.headers.set('X-Late', 'mutated');
          markHookComplete();
        }],
      },
      retry: false,
      timeout: 120,
    } as never);

    await hookStarted;
    const settlement = await settle(request);
    expect(settlement.error).toBeInstanceOf(RezoError);
    const error = settlement.error as RezoError;
    expect(error.code).toBe('ECONNABORTED');
    const beforeLateContinuation = {
      configHeaders: (error.config.headers as RezoHeaders).get('X-Late') ?? null,
      configMethod: error.config.method,
      configUrl: error.config.finalUrl,
      requestHeaders: (error.request?.headers as RezoHeaders).get('X-Late') ?? null,
      requestMethod: error.request?.method,
      requestUrl: error.request?.fullUrl,
    };

    releaseHook();
    await hookComplete;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 0));

    expect({
      configHeaders: (error.config.headers as RezoHeaders).get('X-Late') ?? null,
      configMethod: error.config.method,
      configUrl: error.config.finalUrl,
      requestHeaders: (error.request?.headers as RezoHeaders).get('X-Late') ?? null,
      requestMethod: error.request?.method,
      requestUrl: error.request?.fullUrl,
    }).toEqual(beforeLateContinuation);
    expect(beforeLateContinuation).toMatchObject({
      configHeaders: null,
      configMethod: 'GET',
      configUrl: fixtureUrl('/late-redirect-hook/start'),
      requestHeaders: null,
      requestMethod: 'GET',
      requestUrl: fixtureUrl('/late-redirect-hook/start'),
    });
    expect(wire.map(({ path }) => path)).toEqual(['/late-redirect-hook/start']);
  });
});

describe('Phase 1c-c HTTP/2 delayed recomposition and total deadline', () => {
  it('recomposes after retryDelay so a now-expired Max-Age cookie is absent', async () => {
    plan('/retry-expiry', [
      { status: 503 },
      { status: 200 },
    ]);
    const jar = new RezoCookieJar();
    let onRetryCount = 0;

    const response = await client(jar).get<unknown>(fixtureUrl('/retry-expiry'), {
      cache: false,
      retry: {
        maxRetries: 1,
        onRetry: () => {
          onRetryCount++;
          jar.setCookiesSync(
            ['short=alive; Max-Age=1; Path=/retry-expiry'],
            fixtureUrl('/retry-expiry'),
          );
        },
        retryDelay: 1_200,
        retryOn: [503],
      },
      timeout: 2_000,
    } as never);

    expect(response.status).toBe(200);
    expect(onRetryCount).toBe(1);
    expect(wire.map(({ attempt, cookie, path }) => ({ attempt, cookie, path }))).toEqual([
      { attempt: 1, cookie: null, path: '/retry-expiry' },
      { attempt: 2, cookie: null, path: '/retry-expiry' },
    ]);
    expect(jar.getCookieHeader(fixtureUrl('/retry-expiry'))).toBe('');
  });

  it('treats numeric timeout as one deadline across Retry-After waiting', async () => {
    plan('/deadline-wait', [
      { headers: { 'retry-after': '1' }, status: 429 },
      { status: 200 },
    ]);

    const settlement = await settle(client().get<unknown>(fixtureUrl('/deadline-wait'), {
      cache: false,
      maxWaitAttempts: 1,
      retry: false,
      timeout: 150,
      waitOnStatus: true,
    }));

    expect(settlement.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(settlement.response).toBeUndefined();
    expect(settlement.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(settlement.elapsedMs).toBeLessThan(600);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/deadline-wait' },
    ]);
  });

  it('treats numeric timeout as one deadline across status retryDelay', async () => {
    plan('/deadline-retry', [
      { status: 503 },
      { status: 200 },
    ]);

    const settlement = await settle(client().get<unknown>(fixtureUrl('/deadline-retry'), {
      cache: false,
      retry: {
        maxRetries: 1,
        retryDelay: 1_000,
        retryOn: [503],
      },
      timeout: 150,
    }));

    expect(settlement.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(settlement.response).toBeUndefined();
    expect(settlement.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(settlement.elapsedMs).toBeLessThan(600);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/deadline-retry' },
    ]);
  });
});

describe('Phase 1c-c HTTP/2 retry bounds and custom condition authority', () => {
  it('caps an always-true custom network condition at maxRetries plus the initial attempt', async () => {
    plan('/condition-cap', { reset: true, status: 200 });
    let conditionCalls = 0;

    const settlement = await settle(client().get<unknown>(fixtureUrl('/condition-cap'), {
      cache: false,
      retry: {
        condition: () => {
          conditionCalls++;
          return true;
        },
        maxRetries: 1,
        retryDelay: 0,
      },
      timeout: 1_000,
    } as never));

    expect(settlement.error).toBeDefined();
    expect(settlement.response).toBeUndefined();
    expect(conditionCalls).toBeLessThanOrEqual(2);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/condition-cap' },
      { attempt: 2, path: '/condition-cap' },
    ]);
  });

  it('applies a false custom condition to a retryable status and refuses the retry', async () => {
    plan('/condition-status-refuse', [
      { status: 503 },
      { status: 200 },
    ]);
    let conditionCalls = 0;

    const settlement = await settle(client().get<unknown>(fixtureUrl('/condition-status-refuse'), {
      cache: false,
      retry: {
        condition: () => {
          conditionCalls++;
          return false;
        },
        maxRetries: 1,
        retryDelay: 0,
        retryOn: [503],
      },
      timeout: 1_000,
    } as never));

    expect(settlement.error).toBeDefined();
    expect(settlement.response).toBeUndefined();
    expect(conditionCalls).toBe(1);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/condition-status-refuse' },
    ]);
  });
});

describe('Phase 1c-c HTTP/2 streaming exposes only the accepted terminal attempt', () => {
  it('suppresses and drains redirect bodies before final headers and data', async () => {
    plan('/stream-redirect/start', {
      body: 'REDIRECT',
      headers: { 'content-type': 'text/plain' },
      location: fixtureUrl('/stream-redirect/final'),
      status: 302,
    });
    plan('/stream-redirect/final', {
      body: 'FINAL',
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });

    const events = await collectFinalStreamEvents('/stream-redirect/start', {
      cache: false,
      retry: false,
      timeout: 1_000,
    });

    expect(events).toEqual([
      'headers:200',
      'data:FINAL',
      'finish:200',
    ]);
    expect(wire.map(({ path }) => path)).toEqual([
      '/stream-redirect/start',
      '/stream-redirect/final',
    ]);
  });

  it('suppresses failed status-attempt events and emits one final finish after retry', async () => {
    plan('/stream-status-retry', [
      {
        body: 'ERROR',
        headers: { 'content-type': 'text/plain' },
        status: 503,
      },
      {
        body: 'OK',
        headers: { 'content-type': 'text/plain' },
        status: 200,
      },
    ]);

    const events = await collectFinalStreamEvents('/stream-status-retry', {
      cache: false,
      retry: {
        maxRetries: 1,
        retryDelay: 0,
        retryOn: [503],
      },
      timeout: 1_000,
    });

    expect(events).toEqual([
      'headers:200',
      'data:OK',
      'finish:200',
    ]);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/stream-status-retry' },
      { attempt: 2, path: '/stream-status-retry' },
    ]);
  });

  it('suppresses waitOnStatus attempt events and emits only the accepted response', async () => {
    plan('/stream-status-wait', [
      {
        body: 'WAIT',
        headers: { 'content-type': 'text/plain', 'retry-after': '0' },
        status: 429,
      },
      {
        body: 'OK',
        headers: { 'content-type': 'text/plain' },
        status: 200,
      },
    ]);

    const events = await collectFinalStreamEvents('/stream-status-wait', {
      cache: false,
      maxWaitAttempts: 1,
      retry: false,
      timeout: 1_000,
      waitOnStatus: true,
    });

    expect(events).toEqual([
      'headers:200',
      'data:OK',
      'finish:200',
    ]);
    expect(wire.map(({ attempt, path }) => ({ attempt, path }))).toEqual([
      { attempt: 1, path: '/stream-status-wait' },
      { attempt: 2, path: '/stream-status-wait' },
    ]);
  });

  it('stops publication when a headers listener synchronously aborts the caller signal', async () => {
    plan('/stream-headers-sync-abort', {
      body: 'FORBIDDEN-LATE-BODY',
      bodyDelayMs: 200,
      setCookie: ['streamAbort=server; Path=/'],
      status: 200,
    });
    const controller = new AbortController();
    const events: string[] = [];

    const ledger = await withPoolLedger(async () => {
      const stream = client().stream(fixtureUrl('/stream-headers-sync-abort'), {
        cache: false,
        hooks: {
          onAbort: [(event: { reason: string }) => {
            events.push(`onAbort:${event.reason}`);
          }],
        },
        retry: false,
        signal: controller.signal,
        timeout: 1_000,
      } as never);
      stream.on('headers', (event) => {
        events.push(`headers:${event.status}`);
        controller.abort();
      });
      stream.on('status', (status) => events.push(`status:${status}`));
      stream.on('cookies', () => events.push('cookies'));
      stream.on('data', () => events.push('data'));
      stream.on('progress', () => events.push('progress'));
      stream.on('finish', () => events.push('finish'));
      stream.on('done', () => events.push('done'));
      stream.on('complete', () => events.push('complete'));

      const error = await new Promise<unknown>((resolveError) => {
        stream.once('error', (streamError: unknown) => {
          const code = (streamError as { code?: unknown })?.code;
          events.push(`error:${String(code)}`);
          resolveError(streamError);
        });
      });
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 230));
      return { error, refCounts: reflectedRefCounts(fixtureUrl('/')) };
    });

    expect({
      acquisitions: ledger.acquisitions,
      code: (ledger.value.error as RezoError).code,
      events,
      onAbortCalls: events.filter((event) => event === 'onAbort:signal').length,
      refCountsSane: ledger.value.refCounts.every((count) => count === 0),
      releases: ledger.releases,
      wire: wire.map(({ path }) => path),
    }).toEqual({
      acquisitions: 1,
      code: 'ABORT_ERR',
      events: [
        'headers:200',
        'onAbort:signal',
        'error:ABORT_ERR',
      ],
      onAbortCalls: 1,
      refCountsSane: true,
      releases: 1,
      wire: ['/stream-headers-sync-abort'],
    });
  });

  it('stops publication when a data listener synchronously aborts the caller signal', async () => {
    plan('/stream-data-sync-abort', {
      body: 'ABORT-ON-DATA',
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });
    const controller = new AbortController();
    const events: string[] = [];

    const ledger = await withPoolLedger(async () => {
      const stream = client().stream(fixtureUrl('/stream-data-sync-abort'), {
        cache: false,
        hooks: {
          onAbort: [(event: { reason: string }) => {
            events.push(`onAbort:${event.reason}`);
          }],
        },
        retry: false,
        signal: controller.signal,
        timeout: 1_000,
      } as never);
      stream.on('headers', (event) => events.push(`headers:${event.status}`));
      stream.on('data', (chunk) => {
        events.push(
          `data:${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`,
        );
        controller.abort();
      });
      stream.on('progress', () => events.push('progress'));
      stream.on('finish', () => events.push('finish'));
      stream.on('done', () => events.push('done'));
      stream.on('complete', () => events.push('complete'));

      const error = await new Promise<unknown>((resolveError) => {
        stream.once('error', (streamError: unknown) => {
          const code = (streamError as { code?: unknown })?.code;
          events.push(`error:${String(code)}`);
          resolveError(streamError);
        });
      });
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 50));
      return { error, refCounts: reflectedRefCounts(fixtureUrl('/')) };
    });

    expect({
      acquisitions: ledger.acquisitions,
      code: (ledger.value.error as RezoError).code,
      events,
      onAbortCalls: events.filter((event) => event === 'onAbort:signal').length,
      refCountsSane: ledger.value.refCounts.every((count) => count === 0),
      releases: ledger.releases,
      wire: wire.map(({ path }) => path),
    }).toEqual({
      acquisitions: 1,
      code: 'ABORT_ERR',
      events: [
        'headers:200',
        'data:ABORT-ON-DATA',
        'onAbort:signal',
        'error:ABORT_ERR',
      ],
      onAbortCalls: 1,
      refCountsSane: true,
      releases: 1,
      wire: ['/stream-data-sync-abort'],
    });
  });
});

describe('Phase 1c-c HTTP/2 synchronous callback deadline enforcement', () => {
  it('returns the total-timeout error (ECONNABORTED) after a retry condition blocks past the total deadline', async () => {
    plan('/busy-retry-condition', { status: 503 });
    let conditionCalls = 0;
    let busyDurationMs = 0;

    const settlement = await settle(client().get<unknown>(fixtureUrl('/busy-retry-condition'), {
      cache: false,
      retry: {
        condition: () => {
          conditionCalls++;
          const busyStartedAt = performance.now();
          while (performance.now() - busyStartedAt < 150) {
            // Deliberately occupy this turn past the request deadline.
          }
          busyDurationMs = performance.now() - busyStartedAt;
          return false;
        },
        maxRetries: 1,
        retryDelay: 0,
        retryOn: [503],
      },
      timeout: 60,
    } as never));

    expect(conditionCalls).toBe(1);
    expect(busyDurationMs).toBeGreaterThanOrEqual(140);
    expect(settlement.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect((settlement.error as RezoError).response).toBeUndefined();
    expect(settlement.response).toBeUndefined();
    expect(wire.map(({ path }) => path)).toEqual(['/busy-retry-condition']);
  });
});

describe('Phase 1c-c HTTP/2 signal-aware pending hooks', () => {
  it('aborts a pending beforeRedirect without a total timeout and isolates its late continuation', async () => {
    plan('/signal-redirect-hook/start', {
      location: fixtureUrl('/signal-redirect-hook/final'),
      status: 302,
    });
    plan('/signal-redirect-hook/final', { status: 200 });
    const controller = new AbortController();
    let markHookStarted!: () => void;
    let releaseHook!: () => void;
    let markHookComplete!: () => void;
    const hookStarted = new Promise<void>((resolve) => {
      markHookStarted = resolve;
    });
    const hookRelease = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const hookComplete = new Promise<void>((resolve) => {
      markHookComplete = resolve;
    });

    const request = client().get<unknown>(fixtureUrl('/signal-redirect-hook/start'), {
      cache: false,
      headers: { 'X-Stable': 'caller' },
      hooks: {
        beforeRedirect: [async (context: {
          request: {
            fullUrl: string;
            headers: RezoHeaders;
            method: string;
          };
        }) => {
          markHookStarted();
          await hookRelease;
          context.request.fullUrl = fixtureUrl('/signal-redirect-hook/late');
          context.request.method = 'POST';
          context.request.headers.set('X-Late', 'mutated');
          markHookComplete();
        }],
      },
      retry: false,
      signal: controller.signal,
      timeout: null,
    } as never);
    await hookStarted;
    controller.abort();
    const finalSettlement = settle(request);
    let barrierTimer: ReturnType<typeof setTimeout> | undefined;
    const early = await Promise.race([
      finalSettlement.then((result) => ({ kind: 'settled' as const, result })),
      new Promise<{ kind: 'pending' }>((resolve) => {
        barrierTimer = setTimeout(() => resolve({ kind: 'pending' }), 150);
      }),
    ]);
    if (barrierTimer !== undefined) clearTimeout(barrierTimer);

    const beforeRelease = early.kind === 'settled' ? early.result : undefined;
    const beforeState = beforeRelease?.error instanceof RezoError
      ? {
          configLate: (beforeRelease.error.config.headers as RezoHeaders).get('X-Late') ?? null,
          configMethod: beforeRelease.error.config.method,
          configUrl: beforeRelease.error.config.finalUrl,
          requestLate: (beforeRelease.error.request?.headers as RezoHeaders).get('X-Late') ?? null,
          requestMethod: beforeRelease.error.request?.method,
          requestUrl: beforeRelease.error.request?.fullUrl,
        }
      : undefined;

    releaseHook();
    await hookComplete;
    const completed = beforeRelease ?? await finalSettlement;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 0));
    expect(completed.error).toBeInstanceOf(RezoError);
    const error = completed.error as RezoError;
    const afterState = {
      configLate: (error.config.headers as RezoHeaders).get('X-Late') ?? null,
      configMethod: error.config.method,
      configUrl: error.config.finalUrl,
      requestLate: (error.request?.headers as RezoHeaders).get('X-Late') ?? null,
      requestMethod: error.request?.method,
      requestUrl: error.request?.fullUrl,
    };

    expect({
      afterState,
      beforeState,
      code: error.code,
      settledBeforeRelease: early.kind === 'settled',
      wire: wire.map(({ path }) => path),
    }).toEqual({
      afterState: {
        configLate: null,
        configMethod: 'GET',
        configUrl: fixtureUrl('/signal-redirect-hook/start'),
        requestLate: null,
        requestMethod: 'GET',
        requestUrl: fixtureUrl('/signal-redirect-hook/start'),
      },
      beforeState: {
        configLate: null,
        configMethod: 'GET',
        configUrl: fixtureUrl('/signal-redirect-hook/start'),
        requestLate: null,
        requestMethod: 'GET',
        requestUrl: fixtureUrl('/signal-redirect-hook/start'),
      },
      code: 'ABORT_ERR',
      settledBeforeRelease: true,
      wire: ['/signal-redirect-hook/start'],
    });
  });

  it('prevents a late onRateLimitWait mutation and Retry-After timer after timeout', async () => {
    plan('/late-rate-limit-hook', {
      headers: { 'retry-after': '1' },
      status: 429,
    });
    let markHookStarted!: () => void;
    let releaseHook!: () => void;
    let markHookComplete!: () => void;
    const hookStarted = new Promise<void>((resolve) => {
      markHookStarted = resolve;
    });
    const hookRelease = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const hookComplete = new Promise<void>((resolve) => {
      markHookComplete = resolve;
    });
    const originalSetTimeout = globalThis.setTimeout;
    const trackedTimers: Array<{
      readonly delay: number;
      readonly handle: ReturnType<typeof setTimeout>;
    }> = [];
    const instrumentedSetTimeout = ((
      handler: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = Reflect.apply(originalSetTimeout, globalThis, [
        handler,
        delay,
        ...args,
      ]) as ReturnType<typeof setTimeout>;
      trackedTimers.push({ delay: Number(delay ?? 0), handle });
      return handle;
    }) as typeof setTimeout;
    globalThis.setTimeout = instrumentedSetTimeout;
    const controlTimer = globalThis.setTimeout(() => {}, 997);
    clearTimeout(controlTimer);
    let settlement: Settlement | undefined;
    let markerBeforeRelease: unknown;

    try {
      const request = client().get<unknown>(fixtureUrl('/late-rate-limit-hook'), {
        cache: false,
        hooks: {
          onRateLimitWait: [async (_event: unknown, config: {
            lateRateLimitMarker?: string;
          }) => {
            markHookStarted();
            await hookRelease;
            config.lateRateLimitMarker = 'mutated-after-settlement';
            markHookComplete();
          }],
        },
        maxWaitAttempts: 1,
        retry: false,
        timeout: 60,
        waitOnStatus: true,
      } as never);
      await hookStarted;
      settlement = await settle(request);
      markerBeforeRelease = (
        (settlement.error as RezoError).config as unknown as {
          lateRateLimitMarker?: string;
        }
      ).lateRateLimitMarker;
      releaseHook();
      await hookComplete;
      await new Promise<void>((resolveTurn) => originalSetTimeout(resolveTurn, 5));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      for (const timer of trackedTimers) {
        if (timer.delay === 1_000) clearTimeout(timer.handle);
      }
    }

    expect(settlement?.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    const error = settlement?.error as RezoError;
    expect({
      markerAfterRelease: (
        error.config as unknown as { lateRateLimitMarker?: string }
      ).lateRateLimitMarker,
      markerBeforeRelease,
      retryAfterTimers: trackedTimers.filter(({ delay }) => delay === 1_000).length,
      timerProbeObserved: trackedTimers.some(({ delay }) => delay === 997),
      wire: wire.map(({ path }) => path),
    }).toEqual({
      markerAfterRelease: undefined,
      markerBeforeRelease: undefined,
      retryAfterTimers: 0,
      timerProbeObserved: true,
      wire: ['/late-rate-limit-hook'],
    });
  });

  it('isolates late rate-limit jar and nested config mutations after timeout', async () => {
    const requestUrl = fixtureUrl('/late-rate-limit-deep-isolation');
    plan('/late-rate-limit-deep-isolation', {
      headers: { 'retry-after': '1' },
      setCookie: ['responseStable=server; Path=/'],
      status: 429,
    });
    const jar = new RezoCookieJar();
    jar.setCookieSync('rootStable=caller; Path=/', requestUrl);
    let markHookStarted!: () => void;
    let releaseHook!: () => void;
    let markHookComplete!: () => void;
    const hookStarted = new Promise<void>((resolve) => {
      markHookStarted = resolve;
    });
    const hookRelease = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const hookComplete = new Promise<void>((resolve) => {
      markHookComplete = resolve;
    });
    const originalSetTimeout = globalThis.setTimeout;
    const trackedTimers: Array<{
      readonly delay: number;
      readonly handle: ReturnType<typeof setTimeout>;
    }> = [];
    const instrumentedSetTimeout = ((
      handler: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = Reflect.apply(originalSetTimeout, globalThis, [
        handler,
        delay,
        ...args,
      ]) as ReturnType<typeof setTimeout>;
      trackedTimers.push({ delay: Number(delay ?? 0), handle });
      return handle;
    }) as typeof setTimeout;
    globalThis.setTimeout = instrumentedSetTimeout;
    const controlTimer = globalThis.setTimeout(() => {}, 997);
    clearTimeout(controlTimer);
    let settlement: Settlement | undefined;
    let detachedAfterMutation: {
      readonly authUsername: string | undefined;
      readonly jar: string[];
      readonly originalLate: string | null;
      readonly responseValue: string | null;
      readonly retryMaxRetries: number;
    } | undefined;

    const callerOptions = {
        auth: {
          password: 'caller-password',
          username: 'caller-auth',
        },
        cache: false,
        headers: { 'X-Stable': 'caller' },
        hooks: {
          onRateLimitWait: [async (_event: unknown, hookConfig: {
            jar: RezoCookieJar;
            originalRequest: {
              auth?: { password: string; username: string };
              headers: RezoHeaders;
            };
            responseCookies: Cookies;
            retry: { maxRetries: number };
          }) => {
            markHookStarted();
            await hookRelease;
            hookConfig.jar.setCookieSync('lateJar=mutated; Path=/', requestUrl);
            hookConfig.originalRequest.headers.set('X-Late-Original', 'mutated');
            if (hookConfig.originalRequest.auth) {
              hookConfig.originalRequest.auth.username = 'late';
            }
            hookConfig.retry.maxRetries = 77;
            const responseCookie = hookConfig.responseCookies.array
              .find((cookie) => cookie.key === 'responseStable');
            if (responseCookie) responseCookie.value = 'mutated';
            detachedAfterMutation = {
              authUsername: hookConfig.originalRequest.auth?.username,
              jar: cookieIdentityRows(hookConfig.jar.cookies()),
              originalLate: hookConfig.originalRequest.headers.get('X-Late-Original'),
              responseValue: responseCookie?.value ?? null,
              retryMaxRetries: hookConfig.retry.maxRetries,
            };
            markHookComplete();
          }],
        },
        maxWaitAttempts: 1,
        retry: {
          maxRetries: 2,
          retryDelay: 0,
          retryOn: [503],
        },
        timeout: 60,
        waitOnStatus: true,
    };

    try {
      const request = client(jar).get<unknown>(requestUrl, callerOptions as never);
      await hookStarted;
      settlement = await settle(request);
      releaseHook();
      await hookComplete;
      await new Promise<void>((resolveTurn) => originalSetTimeout(resolveTurn, 5));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      for (const timer of trackedTimers) {
        if (timer.delay === 1_000) clearTimeout(timer.handle);
      }
    }

    expect(settlement?.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    const error = settlement?.error as RezoError;
    const publicOriginalHeaders = new RezoHeaders(error.config.originalRequest.headers);
    const expectedPublicJar = [
      'responseStable|server|127.0.0.1|/',
      'rootStable|caller|127.0.0.1|/',
    ];
    expect({
      detachedAfterMutation,
      callerAuthUsername: callerOptions.auth.username,
      callerRetryMaxRetries: callerOptions.retry.maxRetries,
      publicConfigJar: cookieIdentityRows(error.config.jar.cookies()),
      publicConfigRetryMaxRetries: error.config.retry?.maxRetries,
      publicOriginalAuthUsername: error.config.originalRequest.auth?.username,
      publicOriginalLate: publicOriginalHeaders.get('X-Late-Original'),
      publicOriginalStable: publicOriginalHeaders.get('X-Stable'),
      publicResponseCookies: cookieIdentityRows(error.config.responseCookies),
      retryAfterTimers: trackedTimers.filter(({ delay }) => delay === 1_000).length,
      rootJar: cookieIdentityRows(jar.cookies()),
      timerProbeObserved: trackedTimers.some(({ delay }) => delay === 997),
      wire: wire.map(({ cookie, path }) => ({ cookie, path })),
    }).toEqual({
      callerAuthUsername: 'caller-auth',
      callerRetryMaxRetries: 2,
      detachedAfterMutation: {
        authUsername: 'late',
        jar: [
          'lateJar|mutated|127.0.0.1|/',
          ...expectedPublicJar,
        ],
        originalLate: 'mutated',
        responseValue: 'mutated',
        retryMaxRetries: 77,
      },
      publicConfigJar: expectedPublicJar,
      publicConfigRetryMaxRetries: 2,
      publicOriginalAuthUsername: 'caller-auth',
      publicOriginalLate: null,
      publicOriginalStable: 'caller',
      publicResponseCookies: ['responseStable|server|127.0.0.1|/'],
      retryAfterTimers: 0,
      rootJar: expectedPublicJar,
      timerProbeObserved: true,
      wire: [{ cookie: 'rootStable=caller', path: '/late-rate-limit-deep-isolation' }],
    });
  });
});

describe('Phase 1c-c HTTP/2 aborted zero-delay retry transaction', () => {
  it('does not enter retry policy for a pre-aborted caller signal', async () => {
    plan('/pre-aborted-retry', { status: 200 });
    const controller = new AbortController();
    controller.abort();
    let conditionCalls = 0;
    let onRetryCalls = 0;
    let beforeRetryCalls = 0;

    const settlement = await settle(client().get<unknown>(fixtureUrl('/pre-aborted-retry'), {
      cache: false,
      hooks: {
        beforeRetry: [() => {
          beforeRetryCalls++;
        }],
      },
      retry: {
        condition: () => {
          conditionCalls++;
          return true;
        },
        maxRetries: 1,
        onRetry: () => {
          onRetryCalls++;
        },
        retryDelay: 0,
      },
      signal: controller.signal,
      timeout: 1_000,
    } as never));

    expect(settlement.error).toMatchObject({ code: 'ABORT_ERR' });
    expect({
      beforeRetryCalls,
      conditionCalls,
      onRetryCalls,
      retryAttempts: (settlement.error as RezoError).config.retryAttempts,
      wire: wire.map(({ path }) => path),
    }).toEqual({
      beforeRetryCalls: 0,
      conditionCalls: 0,
      onRetryCalls: 0,
      retryAttempts: 0,
      wire: [],
    });
  });

  it('does not refresh, count, or dispatch retry after a mid-response abort', async () => {
    let markHeadersSent!: () => void;
    const headersSent = new Promise<void>((resolve) => {
      markHeadersSent = resolve;
    });
    plan('/mid-aborted-retry', {
      body: 'LATE',
      bodyDelayMs: 200,
      onHeaders: markHeadersSent,
      status: 200,
    });
    const controller = new AbortController();
    const jar = new RezoCookieJar();
    let conditionCalls = 0;
    let onRetryCalls = 0;

    const request = client(jar).get<unknown>(fixtureUrl('/mid-aborted-retry'), {
      cache: false,
      retry: {
        condition: () => {
          conditionCalls++;
          return true;
        },
        maxRetries: 1,
        onRetry: () => {
          onRetryCalls++;
          jar.setCookiesSync(
            ['retryRefresh=forbidden; Path=/mid-aborted-retry'],
            fixtureUrl('/mid-aborted-retry'),
          );
        },
        retryDelay: 0,
      },
      signal: controller.signal,
      timeout: 1_000,
    } as never);
    await headersSent;
    controller.abort();
    const settlement = await settle(request);
    await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 230));

    expect(settlement.error).toMatchObject({ code: 'ABORT_ERR' });
    expect({
      conditionCalls,
      jar: jar.getCookieHeader(fixtureUrl('/mid-aborted-retry')),
      onRetryCalls,
      requestCookies: (settlement.error as RezoError).config.requestCookies
        .map((cookie) => `${cookie.key}=${cookie.value}`),
      retryAttempts: (settlement.error as RezoError).config.retryAttempts,
      wire: wire.map(({ attempt, path }) => ({ attempt, path })),
    }).toEqual({
      conditionCalls: 0,
      jar: '',
      onRetryCalls: 0,
      requestCookies: [],
      retryAttempts: 0,
      wire: [{ attempt: 1, path: '/mid-aborted-retry' }],
    });
  });
});

describe('Phase 1c-c HTTP/2 ProxyManager logical-request lifetime', () => {
  it('shares one deadline across two proxies and emits one logical onAbort', async () => {
    plan('/proxy-chain-deadline', { status: 200 });
    const first = await createFailureTunnelFixture(70);
    const second = await createTunnelFixture(90);
    const manager = new ProxyManager({
      maxProxyRetries: 1,
      proxies: [
        { host: '127.0.0.1', id: 'deadline-first', port: first.port, protocol: 'http' },
        { host: '127.0.0.1', id: 'deadline-second', port: second.port, protocol: 'http' },
      ],
      requestsPerProxy: 10,
      retryWithNextProxy: true,
      rotation: 'sequential',
    });
    const abortReasons: string[] = [];

    try {
      const settlement = await settle(new Rezo({ proxyManager: manager }, http2Adapter)
        .get<unknown>(fixtureUrl('/proxy-chain-deadline'), {
          cache: false,
          hooks: {
            onAbort: [(event: { reason: string }) => {
              abortReasons.push(event.reason);
            }],
          },
          retry: false,
          timeout: 130,
        } as never));
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 120));

      expect(settlement.error).toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
      expect(settlement.response).toBeUndefined();
      expect(settlement.elapsedMs).toBeGreaterThanOrEqual(100);
      expect(settlement.elapsedMs).toBeLessThan(500);
      expect(abortReasons).toEqual(['timeout']);
      expect(wire).toEqual([]);
      expect({
        firstConnections: first.observation.connections,
        firstRequests: first.observation.connectRequests.length,
        secondConnections: second.observation.connections,
        secondRequests: second.observation.connectRequests.length,
      }).toEqual({
        firstConnections: 1,
        firstRequests: 1,
        secondConnections: 1,
        secondRequests: 1,
      });
    } finally {
      pool.closeAllSessions();
      manager.destroy();
      await Promise.all([closeTunnelFixture(first), closeTunnelFixture(second)]);
    }
  });

  it('control: reaches the origin through the second proxy within a generous deadline', async () => {
    plan('/proxy-chain-success-control', { status: 200 });
    const first = await createFailureTunnelFixture(10);
    const second = await createTunnelFixture();
    const manager = new ProxyManager({
      maxProxyRetries: 1,
      proxies: [
        { host: '127.0.0.1', id: 'success-first', port: first.port, protocol: 'http' },
        { host: '127.0.0.1', id: 'success-second', port: second.port, protocol: 'http' },
      ],
      requestsPerProxy: 10,
      retryWithNextProxy: true,
      rotation: 'sequential',
    });
    const abortReasons: string[] = [];

    try {
      const response = await new Rezo({ proxyManager: manager }, http2Adapter)
        .get<unknown>(fixtureUrl('/proxy-chain-success-control'), {
          cache: false,
          hooks: {
            onAbort: [(event: { reason: string }) => abortReasons.push(event.reason)],
          },
          retry: false,
          timeout: 500,
        } as never);

      expect(response.status).toBe(200);
      expect(abortReasons).toEqual([]);
      expect(wire.map(({ path }) => path)).toEqual(['/proxy-chain-success-control']);
      expect([
        first.observation.connections,
        second.observation.connections,
      ]).toEqual([1, 1]);
    } finally {
      pool.closeAllSessions();
      manager.destroy();
      await Promise.all([closeTunnelFixture(first), closeTunnelFixture(second)]);
    }
  });

  it('control: reports two proxy failures without classifying them as timeout', async () => {
    const first = await createFailureTunnelFixture(10);
    const second = await createFailureTunnelFixture(10);
    const manager = new ProxyManager({
      maxProxyRetries: 1,
      proxies: [
        { host: '127.0.0.1', id: 'failure-first', port: first.port, protocol: 'http' },
        { host: '127.0.0.1', id: 'failure-second', port: second.port, protocol: 'http' },
      ],
      requestsPerProxy: 10,
      retryWithNextProxy: true,
      rotation: 'sequential',
    });
    const abortReasons: string[] = [];

    try {
      const settlement = await settle(new Rezo({ proxyManager: manager }, http2Adapter)
        .get<unknown>(fixtureUrl('/proxy-chain-failure-control'), {
          cache: false,
          hooks: {
            onAbort: [(event: { reason: string }) => abortReasons.push(event.reason)],
          },
          retry: false,
          timeout: 500,
        } as never));

      expect(settlement.error).toBeDefined();
      expect((settlement.error as RezoError).code).not.toBe('ETIMEDOUT');
      expect(settlement.response).toBeUndefined();
      expect(abortReasons).toEqual([]);
      expect(wire).toEqual([]);
      expect([
        first.observation.connections,
        second.observation.connections,
      ]).toEqual([1, 1]);
    } finally {
      pool.closeAllSessions();
      manager.destroy();
      await Promise.all([closeTunnelFixture(first), closeTunnelFixture(second)]);
    }
  });
});
