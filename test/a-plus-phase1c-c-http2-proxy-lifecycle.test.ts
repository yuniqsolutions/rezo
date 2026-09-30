/**
 * Phase 1c-c HTTP/2 proxy lifecycle red tests.
 *
 * These probes deliberately use real loopback TCP proxies around a real h2c
 * target. The strict proxy distinguishes a complete HTTP CONNECT request from
 * a prefix, while the rotation probe distinguishes every selected/attempted
 * proxy and the final origin wire request.
 */

import * as http2 from 'node:http2';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProxyManager, Rezo } from '../src';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoCookieJar } from '../src/cookies/cookie-jar';

interface ConnectObservation {
  readonly completed: string[];
  connections: number;
  latest: string;
}

interface TargetObservation {
  readonly cookies: Array<string | null>;
  readonly paths: string[];
}

const servers = new Set<net.Server | http2.Http2Server>();
const sockets = new Set<net.Socket>();
const sessions = new Set<http2.ServerHttp2Session>();
const managers = new Set<ProxyManager>();

function trackSocket(socket: net.Socket): net.Socket {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  return socket;
}

function listen(server: net.Server | http2.Http2Server): Promise<number> {
  servers.add(server);
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new TypeError('loopback fixture did not expose an IP port'));
        return;
      }
      resolve((address as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server: net.Server | http2.Http2Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function createTarget(observation: TargetObservation): http2.Http2Server {
  const server = http2.createServer();
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
    observation.paths.push(String(headers[':path'] ?? ''));
    observation.cookies.push(
      Object.prototype.hasOwnProperty.call(headers, 'cookie')
        ? String(headers.cookie)
        : null,
    );
    stream.respond({ ':status': 200, 'content-type': 'application/json' });
    stream.end(JSON.stringify({ reached: true }));
  });
  return server;
}

function establishTunnel(
  client: net.Socket,
  targetPort: number,
): void {
  const upstream = trackSocket(net.connect(targetPort, '127.0.0.1'));
  upstream.once('connect', () => {
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once('error', () => client.destroy());
}

function createStrictProxy(
  targetPort: number,
  observation: ConnectObservation,
): net.Server {
  return net.createServer((rawSocket) => {
    const socket = trackSocket(rawSocket);
    observation.connections++;
    let request = '';
    let tunnelStarted = false;

    socket.on('data', (chunk: Buffer) => {
      if (tunnelStarted) return;
      request += chunk.toString('latin1');
      observation.latest = request;
      const terminator = request.indexOf('\r\n\r\n');
      if (terminator < 0) return;

      tunnelStarted = true;
      observation.completed.push(request.slice(0, terminator + 4));
      establishTunnel(socket, targetPort);
    });
  });
}

function connectHeadersArrived(request: string): boolean {
  return /^CONNECT [^\r\n]+ HTTP\/1\.1\r\nHost: [^\r\n]+/i.test(request);
}

function createTolerantFailureProxy(
  observation: ConnectObservation,
): net.Server {
  return net.createServer((rawSocket) => {
    const socket = trackSocket(rawSocket);
    observation.connections++;
    let request = '';
    let responded = false;

    socket.on('data', (chunk: Buffer) => {
      if (responded) return;
      request += chunk.toString('latin1');
      observation.latest = request;
      if (!connectHeadersArrived(request)) return;

      responded = true;
      observation.completed.push(request);
      socket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
    });
  });
}

function createTolerantTunnelProxy(
  targetPort: number,
  observation: ConnectObservation,
): net.Server {
  return net.createServer((rawSocket) => {
    const socket = trackSocket(rawSocket);
    observation.connections++;
    let request = '';
    let tunnelStarted = false;

    socket.on('data', (chunk: Buffer) => {
      if (tunnelStarted) return;
      request += chunk.toString('latin1');
      observation.latest = request;
      if (!connectHeadersArrived(request)) return;

      tunnelStarted = true;
      observation.completed.push(request);
      establishTunnel(socket, targetPort);
    });
  });
}

function emptyConnectObservation(): ConnectObservation {
  return { completed: [], connections: 0, latest: '' };
}

afterEach(async () => {
  for (const manager of managers) manager.destroy();
  managers.clear();
  for (const session of sessions) session.destroy();
  sessions.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.allSettled([...servers].map(closeServer));
  servers.clear();
});

describe('Phase 1c-c HTTP/2 — proxy wire and rotation lifecycle', () => {
  it('terminates the HTTP CONNECT request with CRLFCRLF for a strict proxy', async () => {
    const targetWire: TargetObservation = { cookies: [], paths: [] };
    const target = createTarget(targetWire);
    const targetPort = await listen(target);
    const proxyWire = emptyConnectObservation();
    const strictProxy = createStrictProxy(targetPort, proxyWire);
    const proxyPort = await listen(strictProxy);
    const client = new Rezo({}, http2Adapter);

    const [outcome] = await Promise.allSettled([
      client.get(`http://127.0.0.1:${targetPort}/strict-connect`, {
        cache: false,
        proxy: { host: '127.0.0.1', port: proxyPort, protocol: 'http' },
        retry: false,
        timeout: 400,
      }),
    ]);

    expect(proxyWire.connections).toBe(1);
    expect(proxyWire.completed).toHaveLength(1);
    expect(proxyWire.completed[0]?.endsWith('\r\n\r\n')).toBe(true);
    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled') expect(outcome.value.status).toBe(200);
    expect(targetWire.paths).toEqual(['/strict-connect']);
  });

  it('does not reuse a pooled tunnel across different proxy credentials', async () => {
    const targetWire: TargetObservation = { cookies: [], paths: [] };
    const target = createTarget(targetWire);
    const targetPort = await listen(target);
    const proxyWire = emptyConnectObservation();
    const strictProxy = createStrictProxy(targetPort, proxyWire);
    const proxyPort = await listen(strictProxy);
    const alpha = new Rezo({}, http2Adapter);
    const beta = new Rezo({}, http2Adapter);

    const alphaResponse = await alpha.get(`http://127.0.0.1:${targetPort}/auth-alpha`, {
      cache: false,
      proxy: {
        auth: { password: 'one', username: 'alpha' },
        host: '127.0.0.1',
        port: proxyPort,
        protocol: 'http',
      },
      retry: false,
      timeout: 1_000,
    });
    const betaResponse = await beta.get(`http://127.0.0.1:${targetPort}/auth-beta`, {
      cache: false,
      proxy: {
        auth: { password: 'two', username: 'beta' },
        host: '127.0.0.1',
        port: proxyPort,
        protocol: 'http',
      },
      retry: false,
      timeout: 1_000,
    });

    const proxyAuthorization = proxyWire.completed.map((request) => {
      const match = /^Proxy-Authorization:\s*(.+)$/im.exec(request);
      return match?.[1] ?? null;
    });
    expect([alphaResponse.status, betaResponse.status]).toEqual([200, 200]);
    expect(proxyWire.connections).toBe(2);
    expect(proxyAuthorization).toEqual([
      `Basic ${Buffer.from('alpha:one').toString('base64')}`,
      `Basic ${Buffer.from('beta:two').toString('base64')}`,
    ]);
    expect(targetWire.paths).toEqual(['/auth-alpha', '/auth-beta']);
  });

  it('forces retryWithNextProxy past the failed proxy regardless of schedule quota', async () => {
    const targetWire: TargetObservation = { cookies: [], paths: [] };
    const target = createTarget(targetWire);
    const targetPort = await listen(target);
    const p1Wire = emptyConnectObservation();
    const p2Wire = emptyConnectObservation();
    const p1Port = await listen(createTolerantFailureProxy(p1Wire));
    const p2Port = await listen(createTolerantTunnelProxy(targetPort, p2Wire));
    const proxyManager = new ProxyManager({
      maxProxyRetries: 1,
      proxies: [
        { host: '127.0.0.1', id: 'p1', port: p1Port, protocol: 'http' },
        { host: '127.0.0.1', id: 'p2', port: p2Port, protocol: 'http' },
      ],
      requestsPerProxy: 5,
      retryWithNextProxy: true,
      rotation: 'sequential',
    });
    managers.add(proxyManager);
    const client = new Rezo({ proxyManager }, http2Adapter);

    const response = await client.get(
      `http://127.0.0.1:${targetPort}/forced-next`,
      { cache: false, retry: false, timeout: 1_000 },
    );

    expect(response.status).toBe(200);
    expect([p1Wire.connections, p2Wire.connections]).toEqual([1, 1]);
    expect(targetWire.paths).toEqual(['/forced-next']);
    const state = Object.fromEntries(
      proxyManager.getAll().map((entry) => [entry.proxy.id, {
        failures: entry.totalFailures,
        requests: entry.requestCount,
        successes: entry.successCount,
      }]),
    );
    expect(state).toEqual({
      p1: { failures: 1, requests: 1, successes: 0 },
      p2: { failures: 0, requests: 1, successes: 1 },
    });
    expect(proxyManager.getStatus()).toMatchObject({
      totalFailures: 1,
      totalRequests: 2,
      totalSuccesses: 1,
    });
  });

  it('attempts two failed sequential proxies then preserves Cookie/jar state through the healthy proxy', async () => {
    const targetWire: TargetObservation = { cookies: [], paths: [] };
    const target = createTarget(targetWire);
    const targetPort = await listen(target);
    const p1Wire = emptyConnectObservation();
    const p2Wire = emptyConnectObservation();
    const p3Wire = emptyConnectObservation();
    const p1Port = await listen(createTolerantFailureProxy(p1Wire));
    const p2Port = await listen(createTolerantFailureProxy(p2Wire));
    const p3Port = await listen(createTolerantTunnelProxy(targetPort, p3Wire));
    const proxyManager = new ProxyManager({
      maxProxyRetries: 2,
      proxies: [
        { host: '127.0.0.1', id: 'p1', port: p1Port, protocol: 'http' },
        { host: '127.0.0.1', id: 'p2', port: p2Port, protocol: 'http' },
        { host: '127.0.0.1', id: 'p3', port: p3Port, protocol: 'http' },
      ],
      requestsPerProxy: 1,
      retryWithNextProxy: true,
      rotation: 'sequential',
    });
    managers.add(proxyManager);

    const targetUrl = `http://127.0.0.1:${targetPort}/proxy-rotation`;
    const instanceJar = new RezoCookieJar();
    const requestJar = new RezoCookieJar();
    instanceJar.setCookiesSync(['instance=blocked; Path=/'], targetUrl);
    requestJar.setCookiesSync(['custom=jar; Path=/'], targetUrl);
    const client = new Rezo({ jar: instanceJar, proxyManager }, http2Adapter);

    const [outcome] = await Promise.allSettled([
      client.get(targetUrl, {
        cache: false,
        headers: { Cookie: 'literal=caller' },
        jar: requestJar,
        retry: false,
        timeout: 1_000,
      } as never),
    ]);

    expect(p1Wire.connections).toBe(1);
    expect(p2Wire.connections).toBe(1);
    expect(p3Wire.connections).toBe(1);
    expect(targetWire.paths).toEqual(['/proxy-rotation']);
    expect(targetWire.cookies).toEqual(['literal=caller; custom=jar']);

    const state = Object.fromEntries(
      proxyManager.getAll().map((entry) => [entry.proxy.id, {
        failures: entry.totalFailures,
        requests: entry.requestCount,
        successes: entry.successCount,
      }]),
    );
    expect(state).toEqual({
      p1: { failures: 1, requests: 1, successes: 0 },
      p2: { failures: 1, requests: 1, successes: 0 },
      p3: { failures: 0, requests: 1, successes: 1 },
    });
    expect(proxyManager.getStatus()).toMatchObject({
      totalFailures: 2,
      totalRequests: 3,
      totalSuccesses: 1,
    });
    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled') expect(outcome.value.status).toBe(200);
  });
});
