/**
 * Fixture servers shared by the cache, proxy-failover and interceptor carriers: one plain HTTP origin and one HTTP/2 TLS
 * origin (SAN certificate from the stealth wire-observer fixture) running the same handler, plus a minimal forward proxy.
 * Runtime-agnostic (node:http / node:http2 work on Node and Bun).
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { createSecureServer, type Http2SecureServer } from 'node:http2';
import { generateSanCertificate } from '../stealth/wire-observer.mjs';

export type Handler = (request: IncomingMessage, response: ServerResponse, body: Buffer) => void;
export interface Origin { origin: string; close(): Promise<void> }

function collectBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => { const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); });
}

export async function startHttpOrigin(handler: Handler): Promise<Origin> {
  const server: Server = createServer((request, response) => { void collectBody(request).then((body) => handler(request, response, body)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((resolve) => { (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** HTTP/2-only TLS origin (the H2 adapter needs `rejectUnauthorized: false`; the SAN covers localhost and 127.0.0.1). */
export async function startH2Origin(handler: Handler): Promise<Origin> {
  const certificate = generateSanCertificate() as { key: string; cert: string };
  const server: Http2SecureServer = createSecureServer({ key: certificate.key, cert: certificate.cert, allowHTTP1: false }, (request, response) => {
    void collectBody(request as unknown as IncomingMessage).then((body) => handler(request as unknown as IncomingMessage, response as unknown as ServerResponse, body));
  });
  // Clients keep HTTP/2 sessions open; `close()` would wait for them forever, so every session is tracked and destroyed.
  const sessions = new Set<import('node:http2').ServerHttp2Session>();
  server.on('session', (session) => { sessions.add(session); session.on('close', () => sessions.delete(session)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `https://localhost:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((resolve) => { for (const session of sessions) session.destroy(); server.close(() => resolve()); setTimeout(resolve, 2000); }) };
}

export interface ForwardProxy { name: string; host: string; port: number; hits(): number; tunnels(): number; close(): Promise<void> }
/**
 * A forward HTTP proxy: relays absolute-URI requests upstream (tagging them `x-forwarded-by: <name>`) and serves CONNECT
 * tunnels (raw TCP, so tunnelled requests reach the origin untagged — count `tunnels()` for those).
 */
export async function startForwardProxy(name: string): Promise<ForwardProxy> {
  let hits = 0; let tunnels = 0;
  const server: Server = createServer((request, response) => {
    hits += 1;
    let target: URL;
    try { target = new URL(request.url ?? ''); } catch { response.writeHead(400); response.end('absolute URI required'); return; }
    const upstream = httpRequest({ host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: request.method, headers: { ...request.headers, host: target.host, 'x-forwarded-by': name } }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end('upstream failed'); });
    request.pipe(upstream);
  });
  server.on('connect', (request, clientSocket, head) => {
    tunnels += 1;
    const [host, portText] = String(request.url).split(':');
    const upstream = connect({ host, port: Number(portText) }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket); clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy()); clientSocket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { name, host: '127.0.0.1', port, hits: () => hits, tunnels: () => tunnels, close: () => new Promise<void>((resolve) => { (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** A port nothing listens on (allocated then released): a proxy that refuses every connection. */
export async function deadProxyPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
