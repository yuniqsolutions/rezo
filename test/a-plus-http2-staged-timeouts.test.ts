/**
 * A+ HTTP/2 staged timeouts.
 *
 * The HTTP/2 adapter honours the same staged budget as HTTP/1.1: `headers`
 * runs from dispatch until the response headers arrive, `body` from the
 * headers until the stream ends, and `total` spans the whole request. Each
 * expiry surfaces the shared error shape (code, phase, integer elapsed,
 * message) and fires `onTimeout` once with the HTTP/1.1 payload type.
 */

import * as http2 from 'node:http2';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

let server: http2.Http2Server;
let baseUrl = '';
const pending = new Set<NodeJS.Timeout>();
const later = (ms: number, fn: () => void): void => { const t = setTimeout(() => { pending.delete(t); fn(); }, ms); pending.add(t); };

beforeAll(async () => {
  server = http2.createServer();
  server.on('stream', (stream, headers) => {
    const path = String(headers[':path'] ?? '/');
    const finish = (): void => { if (!stream.destroyed) stream.end('ok'); };
    if (path === '/slow-headers') { later(400, () => { if (!stream.destroyed) { stream.respond({ ':status': 200 }); finish(); } }); return; }
    if (path === '/stalled-body') { stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.write('o'); later(400, finish); return; }
    if (path === '/slow-body') { stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.write('o'); later(150, finish); return; }
    if (path === '/ok') { stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.end('ok'); return; }
    stream.respond({ ':status': 404 }); stream.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

// A proxy that accepts the TCP connection and never answers CONNECT: session
// establishment (TCP, tunnel, TLS) is the request's connection phase.
let silentProxy: net.Server;
let silentProxyUrl = '';
const proxySockets = new Set<net.Socket>();
let proxyConnections = 0;
beforeAll(async () => {
  // Read and discard: a paused socket never surfaces the peer's FIN, so only a reading proxy can observe the client closing its end.
  silentProxy = net.createServer((socket) => { proxyConnections += 1; proxySockets.add(socket); socket.on('error', () => undefined); socket.resume(); socket.once('close', () => proxySockets.delete(socket)); });
  await new Promise<void>((resolve) => silentProxy.listen(0, '127.0.0.1', () => resolve()));
  silentProxyUrl = `http://127.0.0.1:${(silentProxy.address() as AddressInfo).port}`;
});

// A proxy that accepts CONNECT only after a delay: a target on 127.0.0.1 is then
// piped to the local HTTP/2 server, any other target never receives a byte (the
// TLS ClientHello or the h2 preface vanish). The connect budget must span the
// whole establishment — TCP, CONNECT, TLS, preface — not restart per stage.
let tunnelProxy: net.Server;
let tunnelProxyUrl = '';
const TUNNEL_ACCEPT_DELAY_MS = 90;
beforeAll(async () => {
  tunnelProxy = net.createServer((socket) => {
    proxySockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => proxySockets.delete(socket));
    socket.once('data', (chunk: Buffer) => {
      const target = /^CONNECT\s+(\S+)/u.exec(chunk.toString('latin1'))?.[1] ?? '';
      later(TUNNEL_ACCEPT_DELAY_MS, () => {
        if (socket.destroyed) return;
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        if (!target.startsWith('127.0.0.1:')) return;
        const upstream = net.connect(Number(target.slice('127.0.0.1:'.length)), '127.0.0.1');
        proxySockets.add(upstream);
        upstream.on('error', () => socket.destroy());
        upstream.once('close', () => { proxySockets.delete(upstream); socket.destroy(); });
        socket.once('close', () => upstream.destroy());
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    });
  });
  await new Promise<void>((resolve) => tunnelProxy.listen(0, '127.0.0.1', () => resolve()));
  tunnelProxyUrl = `http://127.0.0.1:${(tunnelProxy.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of proxySockets) socket.destroy();
  await new Promise<void>((resolve) => tunnelProxy.close(() => resolve()));
  await new Promise<void>((resolve) => silentProxy.close(() => resolve()));
  for (const t of pending) clearTimeout(t);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const field = (error: unknown, name: string): unknown => Reflect.get(Object(error), name);
const settle = async <T,>(promise: Promise<T>): Promise<{ value: T | null; error: unknown; ms: number }> => {
  const started = performance.now();
  try { return { value: await promise, error: null, ms: performance.now() - started }; }
  catch (error) { return { value: null, error, ms: performance.now() - started }; }
};
const MESSAGES = {
  headers: (elapsed: number) => `Headers timeout: Server did not send response headers within ${elapsed}ms`,
  body: (elapsed: number) => `Body timeout: Response body transfer stalled for ${elapsed}ms`,
  total: (elapsed: number) => `Total timeout: Request exceeded maximum duration of ${elapsed}ms`,
  connect: (elapsed: number) => `Connection timeout: Failed to establish TCP connection within ${elapsed}ms`,
};
function expectStaged(outcome: { value: unknown; error: unknown }, code: string, phase: 'connect' | 'headers' | 'body' | 'total', budget: number): number {
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'name')).toBe('RezoError');
  expect(field(outcome.error, 'code')).toBe(code);
  expect(field(outcome.error, 'phase')).toBe(phase);
  expect(field(outcome.error, 'isTimeout')).toBe(true);
  const elapsed = field(outcome.error, 'elapsed') as number;
  expect(Number.isInteger(elapsed)).toBe(true);
  expect(elapsed).toBeGreaterThanOrEqual(budget);
  expect(field(outcome.error, 'message')).toBe(MESSAGES[phase](elapsed));
  return elapsed;
}

it('HS-01 the headers budget fails the headers phase with the shared surface and one onTimeout', async () => {
  const events: Array<{ type: string }> = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get(`${baseUrl}/slow-headers`, { retry: false, timeout: { headers: 120, total: 2000 }, hooks: { onTimeout: [(event: { type: string }) => { events.push(event); }] } } as any));
  expect(outcome.ms).toBeLessThan(1000);
  expectStaged(outcome, 'ESOCKETTIMEDOUT', 'headers', 120);
  expect(events.map((event) => event.type)).toEqual(['response']);
});

it('HS-02 the body budget fails the body phase after the headers arrived', async () => {
  const events: Array<{ type: string }> = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get(`${baseUrl}/stalled-body`, { retry: false, timeout: { body: 120, total: 2000 }, hooks: { onTimeout: [(event: { type: string }) => { events.push(event); }] } } as any));
  expect(outcome.ms).toBeLessThan(1000);
  expectStaged(outcome, 'ESOCKETTIMEDOUT', 'body', 120);
  expect(events.map((event) => event.type)).toEqual(['response']);
});

it('HS-03 a satisfied headers budget never fires while a slower body completes', async () => {
  const events: unknown[] = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get(`${baseUrl}/slow-body`, { retry: false, responseType: 'text', timeout: { headers: 120, total: 2000 }, hooks: { onTimeout: [(event: unknown) => { events.push(event); }] } } as any));
  expect(outcome.error).toBeNull();
  expect((outcome.value as { status: number; data: string }).status).toBe(200);
  expect((outcome.value as { data: string }).data).toBe('ook');
  expect(events).toEqual([]);
});

it('HS-04 the total budget wins over a longer headers budget', async () => {
  const events: Array<{ type: string }> = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get(`${baseUrl}/slow-headers`, { retry: false, timeout: { headers: 1500, total: 120 }, hooks: { onTimeout: [(event: { type: string }) => { events.push(event); }] } } as any));
  expect(outcome.ms).toBeLessThan(1000);
  expectStaged(outcome, 'ECONNABORTED', 'total', 120);
  expect(events.map((event) => event.type)).toEqual(['request']);
});

it('HS-05 the connect budget bounds session establishment through a silent proxy with ETIMEDOUT/connect', async () => {
  const timeoutTypes: string[] = [];
  const before = proxyConnections;
  const started = performance.now();
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-05', {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: silentProxyUrl,
    retry: false,
    timeout: { connect: 120, total: 1500 },
  } as any));
  expect(performance.now() - started).toBeLessThan(1_000);
  expectStaged(outcome, 'ETIMEDOUT', 'connect', 120);
  expect(timeoutTypes).toEqual(['connect']);
  expect(proxyConnections - before).toBe(1);
});

it('HS-06 the total budget still wins inside session establishment through a silent proxy (control)', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-06', {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: silentProxyUrl,
    retry: false,
    timeout: 250,
  } as any));
  expectStaged(outcome, 'ECONNABORTED', 'total', 250);
  expect(timeoutTypes).toEqual(['request']);
});

it('HS-07 the connect budget spans CONNECT and TLS: a tunnel accepted late then silent fails at the budget with ETIMEDOUT/connect', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-07', {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: tunnelProxyUrl,
    retry: false,
    timeout: { connect: 120, total: 1500 },
  } as any));
  const elapsed = expectStaged(outcome, 'ETIMEDOUT', 'connect', 120);
  expect(elapsed).toBeLessThan(200);
  expect(outcome.ms).toBeLessThan(400);
  expect(timeoutTypes).toEqual(['connect']);
});

it('HS-08 after a late-but-in-budget CONNECT the silent h2c preface belongs to the headers budget, not connect (boundary control)', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get('http://proxied.rezo.test/hs-08', {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: tunnelProxyUrl,
    retry: false,
    timeout: { connect: 120, headers: 150, total: 1500 },
  } as any));
  const elapsed = expectStaged(outcome, 'ESOCKETTIMEDOUT', 'headers', 150);
  expect(elapsed).toBeLessThan(400);
  expect(outcome.ms).toBeLessThan(600);
  expect(timeoutTypes).toEqual(['response']);
});

it('HS-09 a tunnel accepted inside the budget still establishes the session and serves the request (control)', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(new Rezo({}, http2Adapter).get(`${baseUrl}/ok`, {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: tunnelProxyUrl,
    retry: false,
    timeout: { connect: 400, total: 1500 },
  } as any));
  expect(outcome.error).toBeNull();
  expect((outcome.value as { status: number; data: unknown }).status).toBe(200);
  expect((outcome.value as { status: number; data: unknown }).data).toBe('ok');
  expect(timeoutTypes).toEqual([]);
});

it('HS-10 the connect budget bounds a silent SOCKS5 handshake with ETIMEDOUT/connect', async () => {
  const timeoutTypes: string[] = [];
  const before = proxyConnections;
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-10', {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    proxy: silentProxyUrl.replace('http://', 'socks5://'),
    retry: false,
    timeout: { connect: 120, total: 1500 },
  } as any));
  const elapsed = expectStaged(outcome, 'ETIMEDOUT', 'connect', 120);
  expect(elapsed).toBeLessThan(200);
  expect(outcome.ms).toBeLessThan(400);
  expect(timeoutTypes).toEqual(['connect']);
  expect(proxyConnections - before).toBe(1);
});

it('HS-11 a connect timeout inside the CONNECT handshake closes the pending proxy socket on its own (natural finality, no fixture cleanup)', async () => {
  const existing = new Set(proxySockets);
  const liveOwn = (): number => [...proxySockets].filter((socket) => !existing.has(socket)).length;
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-11', { proxy: silentProxyUrl, retry: false, timeout: { connect: 120, total: 1500 } } as any));
  expectStaged(outcome, 'ETIMEDOUT', 'connect', 120);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  const liveAfter50 = liveOwn();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  const liveAfter300 = liveOwn();
  expect({ liveAfter50, liveAfter300 }).toEqual({ liveAfter50: 0, liveAfter300: 0 });
});

it('HS-12 a caller abort inside the CONNECT handshake closes the pending proxy socket on its own (natural finality, no fixture cleanup)', async () => {
  const existing = new Set(proxySockets);
  const liveOwn = (): number => [...proxySockets].filter((socket) => !existing.has(socket)).length;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 60);
  const outcome = await settle(new Rezo({}, http2Adapter).get('https://proxied.rezo.test/hs-12', { proxy: silentProxyUrl, retry: false, signal: controller.signal, timeout: { connect: 1500, total: 2500 } } as any));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('ABORT_ERR');
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  const liveAfter50 = liveOwn();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  const liveAfter300 = liveOwn();
  expect({ liveAfter50, liveAfter300 }).toEqual({ liveAfter50: 0, liveAfter300: 0 });
});
