/**
 * A+ cURL request contract.
 *
 * The cURL adapter must honour the shared request contract exactly like the
 * in-process adapters: method semantics on the wire, credentials, the
 * total/connect timeout surface (codes, phase, elapsed, hooks), caller
 * cancellation, status validation, redirect limits, and the dedicated `curl`
 * option object. Every row observes the wire or the public error shape.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { execFile, execFileSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { RezoFormData } from '../src/utils/form-data';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { RezoHeaders } from '../src/utils/headers';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { CurlCommandBuilder, CurlExecutor, type CurlRequestConfig } from '../src/adapters/entries/curl';
import type { RezoConfig } from '../src/types/rezo-config';
import { getFS } from '../src/utils/http-config';

// Under the Vitest module runner the product's dynamic import of 'node:fs' can
// resolve to nothing; the shared helper then falls back to a global require.
// Install a bridge that answers exactly 'node:fs' and restore it afterwards.
let restoreRequireBridge: (() => void) | undefined;
async function ensureFilesystemAccess(): Promise<void> {
  if (await getFS() !== undefined) return;
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'require');
  Object.defineProperty(globalThis, 'require', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (specifier: string): unknown => {
      if (specifier !== 'node:fs' && specifier !== 'fs') throw new Error(`require bridge rejected ${specifier}`);
      return nodeFs;
    },
  });
  restoreRequireBridge = () => {
    Reflect.deleteProperty(globalThis, 'require');
    if (prior) Object.defineProperty(globalThis, 'require', prior);
  };
  if (await getFS() === undefined) throw new Error('require bridge did not enable filesystem access');
}

type Seen = { method: string; headers: http.IncomingHttpHeaders; url: string };
const seen: Seen[] = [];
let server: http.Server;
let baseUrl = '';
const holds = new Set<http.ServerResponse>();
let tlsServer: https.Server;
let tlsBaseUrl = '';
let tlsDirectory = '';
let refusedPort = 0;
let rawServer: net.Server;
let rawBaseUrl = '';

/**
 * Interrupted transfers are served from a raw TCP listener: an http-layer server
 * (Bun's in particular) resets any connection whose response object is unfinished,
 * so only a raw socket can send the partial body followed by a clean FIN.
 */
function serveInterruptedTransfer(socket: net.Socket): void {
  socket.once('data', (chunk: Buffer) => {
    const target = chunk.toString('latin1').split(' ')[1] ?? '/';
    if (target === '/empty-reply') { socket.destroy(); return; }
    socket.write(PARTIAL_WIRE, () => setTimeout(() => {
      if (target === '/partial') { socket.end(); return; }
      const resettable = socket as net.Socket & { resetAndDestroy?: () => void };
      if (typeof resettable.resetAndDestroy === 'function') resettable.resetAndDestroy(); else socket.destroy();
    }, 40));
  });
}

function generateTlsMaterial(): { key: Buffer; cert: Buffer } {
  tlsDirectory = mkdtempSync(path.join(tmpdir(), 'rezo-crc-tls-'));
  const keyPath = path.join(tlsDirectory, 'key.pem');
  const certificatePath = path.join(tlsDirectory, 'certificate.pem');
  const commonArguments = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-subj', '/CN=127.0.0.1', '-days', '1'];
  try {
    execFileSync('openssl', [...commonArguments, '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  } catch {
    // Older LibreSSL releases do not support `-addext`; the rows only need an untrusted self-signed certificate.
    execFileSync('openssl', commonArguments, { stdio: 'ignore' });
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certificatePath) };
}

const PARTIAL_WIRE = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\npart';
const received = new Map<string, Buffer>();
const BIG = Buffer.alloc(256 * 1024, 0x5a);
const FILE_BYTES = Buffer.concat([Buffer.from('file\r\nbytes\r\n\r\n--not-a-boundary\r\n'), Buffer.from([0, 1, 2, 3, 255, 254])]);

beforeAll(async () => {
  await ensureFilesystemAccess();
  server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    seen.push({ method: request.method ?? '', headers: request.headers, url });
    if (url === '/head') { response.writeHead(200, { 'content-length': '5', 'x-head': 'yes' }); response.end(); return; }
    if (url === '/echo') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok'); return; }
    if (url === '/slow') { holds.add(response); setTimeout(() => { if (!response.destroyed) { response.writeHead(200); response.end('late'); } holds.delete(response); }, 700); return; }
    if (url === '/missing') { response.writeHead(404, { 'content-type': 'text/plain' }); response.end('missing'); return; }
    if (url === '/a') { response.writeHead(302, { location: '/b' }); response.end(); return; }
    if (url === '/b') { response.writeHead(302, { location: '/c' }); response.end(); return; }
    if (url === '/c') { response.writeHead(200); response.end('c'); return; }
    if (url === '/upload') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => { received.set('upload', Buffer.concat(chunks)); response.writeHead(200); response.end('received'); });
      return;
    }
    if (url === '/post-redirect') { response.writeHead(302, { location: '/landing' }); response.end(); return; }
    if (url === '/landing') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('landed'); return; }
    if (url === '/big') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(BIG.length) }); let offset = 0; const tick = (): void => { if (offset >= BIG.length) { response.end(); return; } response.write(BIG.subarray(offset, offset + 16384)); offset += 16384; setTimeout(tick, 3); }; tick(); return; }
    if (url === '/bad-json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"unterminated": '); return; }
    // Interrupted transfers are framed on the raw socket so both runtimes' servers send exactly the declared length minus the missing tail.
    if (url === '/xssi-json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(")]}'\n{\"guarded\":true}"); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tlsServer = https.createServer(generateTlsMaterial(), (_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('tls-ok'); });
  await new Promise<void>((resolve) => tlsServer.listen(0, '127.0.0.1', () => resolve()));
  tlsBaseUrl = `https://127.0.0.1:${(tlsServer.address() as AddressInfo).port}`;
  rawServer = net.createServer(serveInterruptedTransfer);
  await new Promise<void>((resolve) => rawServer.listen(0, '127.0.0.1', () => resolve()));
  rawBaseUrl = `http://127.0.0.1:${(rawServer.address() as AddressInfo).port}`;
  const vacated = http.createServer();
  await new Promise<void>((resolve) => vacated.listen(0, '127.0.0.1', () => resolve()));
  refusedPort = (vacated.address() as AddressInfo).port;
  await new Promise<void>((resolve) => vacated.close(() => resolve()));
});

afterAll(async () => {
  for (const response of holds) response.destroy();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  tlsServer.closeAllConnections?.();
  await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
  if (tlsDirectory) rmSync(tlsDirectory, { recursive: true, force: true });
  restoreRequireBridge?.();
});

const client = (): Rezo => new Rezo({}, curlAdapter as any);
const last = (): Seen => seen[seen.length - 1]!;
const field = (error: unknown, name: string): unknown => Reflect.get(Object(error), name);
const settle = async <T,>(promise: Promise<T>): Promise<{ value: T | null; error: unknown; ms: number }> => {
  const started = performance.now();
  try { return { value: await promise, error: null, ms: performance.now() - started }; }
  catch (error) { return { value: null, error, ms: performance.now() - started }; }
};

it('CRC-01 HEAD settles on the headers even when the server declares a body', async () => {
  const outcome = await settle(client().head(`${baseUrl}/head`));
  expect(outcome.error).toBeNull();
  expect(outcome.ms).toBeLessThan(1500);
  expect(last().method).toBe('HEAD');
  expect(outcome.value!.status).toBe(200);
  expect(outcome.value!.headers.get('x-head')).toBe('yes');
  expect(outcome.value!.data === '' || outcome.value!.data === undefined || outcome.value!.data === null).toBe(true);
});

it('CRC-02 TRACE reaches the wire as TRACE', async () => {
  const outcome = await settle(client().request({ url: `${baseUrl}/echo`, method: 'TRACE' as any }));
  expect(outcome.error).toBeNull();
  expect(last().method).toBe('TRACE');
});

it('CRC-03 basic credentials produce the Authorization header', async () => {
  const outcome = await settle(client().get(`${baseUrl}/echo`, { auth: { username: 'rezo', password: 'placeholder' } } as any));
  expect(outcome.error).toBeNull();
  expect(last().headers.authorization).toBe(`Basic ${Buffer.from('rezo:placeholder').toString('base64')}`);
});

it('CRC-04 a numeric timeout is one total budget with the shared error surface and onTimeout hook', async () => {
  const hookEvents: unknown[] = [];
  const outcome = await settle(client().get(`${baseUrl}/slow`, { timeout: 150, retry: false, hooks: { onTimeout: [(event: unknown) => { hookEvents.push(event); }] } } as any));
  expect(outcome.value).toBeNull();
  expect(outcome.ms).toBeLessThan(600);
  expect(field(outcome.error, 'name')).toBe('RezoError');
  expect(field(outcome.error, 'code')).toBe('ECONNABORTED');
  expect(field(outcome.error, 'phase')).toBe('total');
  expect(field(outcome.error, 'isTimeout')).toBe(true);
  const elapsed = field(outcome.error, 'elapsed');
  expect(Number.isInteger(elapsed)).toBe(true);
  expect(elapsed as number).toBeGreaterThanOrEqual(150);
  expect(field(outcome.error, 'message')).toBe(`Total timeout: Request exceeded maximum duration of ${elapsed}ms`);
  expect(hookEvents).toHaveLength(1);
  expect((hookEvents[0] as { type: string }).type).toBe('request');
});

it('CRC-05 a staged connect budget fails the connection phase with ETIMEDOUT/connect', async () => {
  const hookEvents: unknown[] = [];
  const outcome = await settle(client().get('http://192.0.2.1:9/blackhole', { timeout: { connect: 150, total: 3000 }, retry: false, hooks: { onTimeout: [(event: unknown) => { hookEvents.push(event); }] } } as any));
  expect(outcome.value).toBeNull();
  expect(outcome.ms).toBeLessThan(2500);
  expect(field(outcome.error, 'code')).toBe('ETIMEDOUT');
  expect(field(outcome.error, 'phase')).toBe('connect');
  expect(field(outcome.error, 'isTimeout')).toBe(true);
  expect(hookEvents).toHaveLength(1);
  expect((hookEvents[0] as { type: string }).type).toBe('connect');
});

it('CRC-06 a caller abort settles promptly as ABORT_ERR with one onAbort notification', async () => {
  const controller = new AbortController();
  const abortEvents: unknown[] = [];
  setTimeout(() => controller.abort(), 100);
  const outcome = await settle(client().get(`${baseUrl}/slow`, { signal: controller.signal, retry: false, hooks: { onAbort: [(event: unknown) => { abortEvents.push(event); }] } } as any));
  expect(outcome.value).toBeNull();
  expect(outcome.ms).toBeLessThan(600);
  expect(field(outcome.error, 'code')).toBe('ABORT_ERR');
  expect(field(outcome.error, 'message')).toBe('Request aborted by signal');
  expect(abortEvents).toHaveLength(1);
  expect((abortEvents[0] as { reason: string }).reason).toBe('signal');
});

it('CRC-07 validateStatus: null resolves a 4xx with its body', async () => {
  const outcome = await settle(client().get(`${baseUrl}/missing`, { validateStatus: null, responseType: 'text' } as any));
  expect(outcome.error).toBeNull();
  expect(outcome.value!.status).toBe(404);
  expect(outcome.value!.data).toBe('missing');
});

it('CRC-08 maxRedirects bounds the chain with a typed redirect-control error', async () => {
  const outcome = await settle(client().get(`${baseUrl}/a`, { maxRedirects: 1, retry: false } as any));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
});

it('CRC-09 the dedicated curl option object reaches the command', async () => {
  const outcome = await settle(client().get(`${baseUrl}/echo`, { curl: { referer: 'https://rezo.test/origin' } } as any));
  expect(outcome.error).toBeNull();
  expect(last().headers.referer).toBe('https://rezo.test/origin');
});

it('CRC-10 http2 selects HTTP/2 negotiation in the command', () => {
  const executor = new CurlExecutor();
  const builder = new CurlCommandBuilder(Reflect.get(executor, 'tempFileManager'), Reflect.get(executor, 'capabilities'));
  const config = { curl: true, disableJar: true, headers: new RezoHeaders(), http2: true, maxRedirects: 0, method: 'GET', rejectUnauthorized: true, url: 'http://curl.rezo.test/h2' } as unknown as RezoConfig;
  const request = { headers: new RezoHeaders(), method: 'GET', retry: false, url: 'http://curl.rezo.test/h2' } as CurlRequestConfig;
  const { args } = builder.build(config, request);
  expect(args).toContain('--http2');
  expect(args).not.toContain('--http1.1');
});

it('CRC-11 multipart file parts carry the exact file bytes, name and type', async () => {
  const form = new RezoFormData();
  form.append('note', 'hello');
  form.append('upload', new File([FILE_BYTES], 'payload.bin', { type: 'application/x-rezo-binary' }));
  const outcome = await settle(client().post(`${baseUrl}/upload`, form));
  expect(outcome.error).toBeNull();
  const body = received.get('upload')!;
  expect(body.includes(FILE_BYTES)).toBe(true);
  const text = body.toString('latin1');
  expect(text).toContain('name="upload"; filename="payload.bin"');
  expect(text).toContain('Content-Type: application/x-rezo-binary');
  expect(text).toContain('name="note"');
  expect(last().headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
});

it('CRC-12 a readable stream body is sent byte-exact', async () => {
  const payload = Buffer.concat([Buffer.from('line one\r\nline two\n'), Buffer.from([13, 10, 0, 255])]);
  const outcome = await settle(client().post(`${baseUrl}/upload`, Readable.from([payload.subarray(0, 7), payload.subarray(7)]), { headers: { 'content-type': 'application/octet-stream' } } as any));
  expect(outcome.error).toBeNull();
  expect(received.get('upload')!.equals(payload)).toBe(true);
});

it('CRC-13 download progress events report loaded bytes up to the total', async () => {
  const events: Array<{ loaded: number; total: number }> = [];
  const outcome = await settle(client().get<Buffer>(`${baseUrl}/big`, { responseType: 'buffer', onDownloadProgress: (event: { loaded: number; total: number }) => { events.push({ loaded: event.loaded, total: event.total }); } } as any));
  expect(outcome.error).toBeNull();
  expect(outcome.value!.data.length).toBe(BIG.length);
  expect(events.length).toBeGreaterThan(0);
  expect(Math.max(...events.map((event) => event.loaded))).toBe(BIG.length);
  expect(events.every((event) => event.total === BIG.length)).toBe(true);
});

it('CRC-14 a POST followed through a 302 lands as GET (HTTP/1.1 parity)', async () => {
  const outcome = await settle(client().post(`${baseUrl}/post-redirect`, 'payload', { responseType: 'text' } as any));
  expect(outcome.error).toBeNull();
  expect(outcome.value!.data).toBe('landed');
  expect(last().url).toBe('/landing');
  expect(last().method).toBe('GET');
});

it('CRC-15 malformed JSON resolves as the raw text and XSSI-guarded JSON parses (HTTP/1.1 parity)', async () => {
  const malformed = await settle(client().get(`${baseUrl}/bad-json`, { responseType: 'json' } as any));
  expect(malformed.error).toBeNull();
  expect(malformed.value!.data).toBe('{"unterminated": ');
  const guarded = await settle(client().get(`${baseUrl}/xssi-json`));
  expect(guarded.error).toBeNull();
  expect(guarded.value!.data).toEqual({ guarded: true });
});

it('CRC-16 a transfer cut short maps to ERR_STREAM_PREMATURE_CLOSE and acceptPartialBody salvages the bytes as truncated', async () => {
  const failed = await settle(client().get(`${rawBaseUrl}/partial`, { responseType: 'text' } as any));
  expect(failed.value).toBeNull();
  expect(field(failed.error, 'code')).toBe('ERR_STREAM_PREMATURE_CLOSE');
  const salvaged = await settle(client().get<string>(`${rawBaseUrl}/partial`, { responseType: 'text', acceptPartialBody: true } as any));
  expect(salvaged.error).toBeNull();
  expect(salvaged.value!.status).toBe(200);
  expect(salvaged.value!.data).toBe('part');
  expect(salvaged.value!.truncated).toBe(true);
});

it('CRC-17 an empty reply maps to ECONNRESET (socket hang up parity)', async () => {
  const outcome = await settle(client().get(`${rawBaseUrl}/empty-reply`));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('ECONNRESET');
});

it('CRC-18 a connection reset mid-body maps to the peer-interruption code and is never a success without acceptPartialBody', async () => {
  // Observe this runtime's socket behavior independently. Older Bun sent FIN;
  // newer Bun sends RST, so the runtime name alone is not an error oracle.
  const raw = await new Promise<{ code: number | string | undefined; body: string }>((resolve) => {
    execFile('curl', ['-sS', '--max-time', '2', '--noproxy', '*', `${rawBaseUrl}/reset-mid-body`],
      { timeout: 3000 }, (error, stdout) => resolve({ code: error?.code, body: stdout }));
  });
  expect([18, 56]).toContain(raw.code);
  expect(raw.body).toBe('part');
  const outcome = await settle(client().get(`${rawBaseUrl}/reset-mid-body`, { responseType: 'text' } as any));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe(raw.code === 56 ? 'ECONNRESET' : 'ERR_STREAM_PREMATURE_CLOSE');
});

it('CRC-19 a refused connection maps to ECONNREFUSED', async () => {
  const outcome = await settle(client().get(`http://127.0.0.1:${refusedPort}/echo`));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('ECONNREFUSED');
});

it('CRC-20 an untrusted self-signed certificate maps to DEPTH_ZERO_SELF_SIGNED_CERT', async () => {
  const outcome = await settle(client().get(`${tlsBaseUrl}/echo`));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
  const trusted = await settle(client().get<string>(`${tlsBaseUrl}/echo`, { rejectUnauthorized: false, responseType: 'text' } as any));
  expect(trusted.error).toBeNull();
  expect(trusted.value!.data).toBe('tls-ok');
});

it('CRC-21 a TLS handshake against a plain-HTTP port maps to EPROTO', async () => {
  const outcome = await settle(client().get(`https://127.0.0.1:${(server.address() as AddressInfo).port}/echo`));
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe('EPROTO');
});

it('CRC-22 an interrupted download leaves no file and no stage file at the target', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-crc-download-'));
  const target = path.join(directory, 'download.bin');
  try {
    const download = client().download(`${rawBaseUrl}/partial`, target);
    const failure = await new Promise<unknown>((resolve) => { download.on('error', resolve); download.on('finish', () => resolve(null)); });
    expect(field(failure, 'code')).toBe('ERR_STREAM_PREMATURE_CLOSE');
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
