import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createSecureServer, type ClientHttp2Session, type Http2SecureServer, type ServerHttp2Session } from 'node:http2';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { Http2SessionPool } from '../src/adapters/http2';
import { createPoolTlsMaterial, type PoolTlsMaterial } from './fixtures/agent-pool-tls-material';

const pool = Http2SessionPool.getInstance();
const sessions = new Set<ServerHttp2Session>(), sockets = new Set<Socket>();
let material: PoolTlsMaterial, server: Http2SecureServer, origin: URL;
let arrivals = 0;
beforeAll(async () => {
  material = createPoolTlsMaterial();
  server = createSecureServer({ key: material.server.key, cert: material.server.cert,
    requestCert: true, rejectUnauthorized: false, ca: [material.first.cert, material.second.cert] });
  server.on('session', session => { sessions.add(session); session.on('error', () => {}); session.once('close', () => sessions.delete(session)); });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  server.on('stream', stream => {
    arrivals++;
    const socket = stream.session!.socket as TLSSocket;
    stream.respond({ ':status': 200, 'content-type': 'application/json' });
    stream.end(JSON.stringify({ peer: socket.getPeerCertificate().subject?.CN ?? null, alpn: socket.alpnProtocol }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TLS receiver did not listen');
  origin = new URL(`https://127.0.0.1:${address.port}`);
});
afterEach(() => { pool.closeAllSessions(); });
afterAll(async () => {
  pool.destroy(); for (const session of sessions) session.destroy(); for (const socket of sockets) socket.destroy();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  material?.dispose();
});

async function observe(session: ClientHttp2Session): Promise<{ peer: string | null; alpn: string }> {
  return new Promise((resolve, reject) => {
    const request = session.request({ ':path': '/' });
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk)); request.once('error', reject);
    request.once('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); } });
    request.end();
  });
}

async function refuses(work: Promise<ClientHttp2Session>): Promise<void> {
  // Do not dump a live TLS session or its key material when an assertion fails.
  expect(await work.then(() => false, error => error instanceof Error)).toBe(true);
}

it('strict TLS never borrows a session opened with verification disabled', async () => {
  const before = arrivals;
  await refuses(pool.getSession(origin, undefined, 1000));
  const insecure = await pool.getSession(origin, { rejectUnauthorized: false }, 1000);
  expect(await observe(insecure)).toEqual({ peer: null, alpn: 'h2' });
  pool.releaseSession(origin);
  await refuses(pool.getSession(origin, { rejectUnauthorized: true }, 1000));
  expect(arrivals).toBe(before + 1);
});

it('inherited verification policy is isolated like an own property', async () => {
  const options = Object.create({ rejectUnauthorized: false });
  const insecure = await pool.getSession(origin, options, 1000);
  expect((await observe(insecure)).alpn).toBe('h2');
  await refuses(pool.getSession(origin, undefined, 1000));
});

it('equal effective TLS bytes reuse a session across string/Buffer representations', async () => {
  const first = await pool.getSession(origin, { ca: material.server.cert }, 1000);
  const second = await pool.getSession(origin, { ca: material.server.cert.toString(), rejectUnauthorized: true }, 1000);
  expect(second === first).toBe(true);
  expect((await observe(second)).alpn).toBe('h2');
});

it('a different trust root cannot borrow an already trusted session', async () => {
  const trusted = await pool.getSession(origin, { ca: material.server.cert }, 1000);
  expect((await observe(trusted)).alpn).toBe('h2');
  await refuses(pool.getSession(origin, { ca: material.first.cert }, 1000));
});

it('different client certificates reach the peer on distinct sessions', async () => {
  const first = await pool.getSession(origin, { ca: material.server.cert, cert: material.first.cert, key: material.first.key }, 1000);
  const second = await pool.getSession(origin, { ca: material.server.cert, cert: material.second.cert, key: material.second.key }, 1000);
  expect((await observe(first)).peer).toBe('client-first');
  expect((await observe(second)).peer).toBe('client-second');
  expect(second === first).toBe(false);
});

it('mutating a trust buffer changes its connection identity', async () => {
  const ca = Buffer.from(material.server.cert);
  const trusted = await pool.getSession(origin, { ca }, 1000);
  expect((await observe(trusted)).alpn).toBe('h2');
  ca.fill(0);
  await refuses(pool.getSession(origin, { ca }, 1000));
});

it('a changed verification callback cannot inherit a prior successful handshake', async () => {
  let denied = false;
  const options = { ca: material.server.cert, checkServerIdentity: () => denied ? new Error('Synthetic policy denial') : undefined };
  const accepted = await pool.getSession(origin, options, 1000);
  expect((await observe(accepted)).alpn).toBe('h2');
  denied = true;
  await refuses(pool.getSession(origin, options, 1000));
});

it('parallel creations with different verification policies remain separate', async () => {
  const [trusted, insecure] = await Promise.all([
    pool.getSession(origin, { ca: material.server.cert }, 1000),
    pool.getSession(origin, { rejectUnauthorized: false }, 1000),
  ]);
  expect(trusted === insecure).toBe(false);
  expect((await observe(trusted)).alpn).toBe('h2');
  expect((await observe(insecure)).alpn).toBe('h2');
});

it('legacy release and close drain every connection policy without exposing TLS material', async () => {
  await pool.getSession(origin, { ca: material.server.cert }, 1000);
  await pool.getSession(origin, { rejectUnauthorized: false }, 1000);
  pool.releaseSession(origin); pool.releaseSession(origin);
  const entries = Reflect.get(pool, 'entriesBySession') as Map<ClientHttp2Session, { key: string; refCount: number }>;
  expect(entries.size).toBe(2);
  expect([...entries.values()].map(entry => entry.refCount)).toEqual([0, 0]);
  for (const entry of entries.values()) expect(entry.key).not.toContain('BEGIN CERTIFICATE');
  pool.closeSession(origin);
  expect(entries.size).toBe(0);
});
