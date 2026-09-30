/**
 * A+ cURL transfer integrity.
 *
 * The cURL adapter owns a child process, so every byte it reports must be
 * exactly what the server sent: no response framing in the body, no trailing
 * bytes, no corruption of binary or compressed payloads, exact stream chunks,
 * exact files on disk, and metadata that describes the payload that was
 * actually delivered. Each row pins the bytes with a digest, never a length.
 */

import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as nodeFs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import * as zlib from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
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

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// Payloads chosen to collide with every framing heuristic a multiplexed
// parser could rely on: CRLF pairs, a fake status line, the adapter's own
// former statistics markers, NUL bytes and high bytes.
const TEXT = 'exact text without a trailing newline';
const DELIMITER_TEXT = 'line one\r\n\r\nHTTP/1.1 200 OK\r\n---CURL_STATS_START---\nhttp_code:999\n---CURL_STATS_END---\nline two';
const BINARY = Buffer.concat([
  Buffer.from('AB\r\n\r\nHTTP/1.1 200 OK\r\n'),
  Buffer.from('---CURL_STATS_START---\n'),
  Buffer.from([0, 1, 2, 255, 254, 10, 13, 10, 13]),
  randomBytes(64 * 1024),
]);
const JSON_BODY = { text: 'quotes " and \\ backslashes \n and unicode é中', nested: { n: 1 } };

let server: http.Server;
let baseUrl = '';
let workDir = '';

beforeAll(async () => {
  await ensureFilesystemAccess();
  workDir = mkdtempSync(join(tmpdir(), 'rezo-curl-integrity-'));
  server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    if (url === '/text') { response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end(TEXT); return; }
    if (url === '/delimiters') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(DELIMITER_TEXT); return; }
    if (url === '/binary') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(BINARY.length) }); response.end(BINARY); return; }
    if (url === '/gzip') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' }); response.end(zlib.gzipSync(BINARY)); return; }
    if (url === '/deflate') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'deflate' }); response.end(zlib.deflateSync(BINARY)); return; }
    if (url === '/br') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'br' }); response.end(zlib.brotliCompressSync(BINARY)); return; }
    if (url === '/zstd') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'zstd' }); response.end(zlib.zstdCompressSync(BINARY)); return; }
    if (url === '/json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(JSON_BODY)); return; }
    if (url === '/hop') { response.writeHead(302, { location: '/binary', 'set-cookie': 'hop=1; Path=/' }); response.end(); return; }
    if (url === '/chunked') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      let offset = 0;
      const tick = (): void => {
        if (offset >= BINARY.length) { response.end(); return; }
        response.write(BINARY.subarray(offset, offset + 7001));
        offset += 7001;
        setTimeout(tick, 2);
      };
      tick();
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workDir, { recursive: true, force: true });
  restoreRequireBridge?.();
});

const client = (): Rezo => new Rezo({}, curlAdapter as any);

it('CTI-01 text body is byte-exact with no trailing newline', async () => {
  const response = await client().get(`${baseUrl}/text`, { responseType: 'text' });
  expect(response.status).toBe(200);
  expect(response.data).toBe(TEXT);
  expect(response.contentLength).toBe(Buffer.byteLength(TEXT));
});

it('CTI-02 body resembling response framing and statistics markers is payload', async () => {
  const response = await client().get(`${baseUrl}/delimiters`, { responseType: 'text' });
  expect(response.status).toBe(200);
  expect(response.data).toBe(DELIMITER_TEXT);
});

it('CTI-03 binary body is byte-exact as a Buffer', async () => {
  const response = await client().get<Buffer>(`${baseUrl}/binary`, { responseType: 'buffer' });
  expect(response.status).toBe(200);
  expect(Buffer.isBuffer(response.data)).toBe(true);
  expect(response.data.length).toBe(BINARY.length);
  expect(sha256(response.data)).toBe(sha256(BINARY));
  expect(response.contentLength).toBe(BINARY.length);
});

for (const encoding of ['gzip', 'deflate', 'br', 'zstd'] as const) {
  it(`CTI-04 ${encoding} decoded body is byte-exact`, async () => {
    const response = await client().get<Buffer>(`${baseUrl}/${encoding}`, { responseType: 'buffer' });
    expect(response.status).toBe(200);
    expect(sha256(response.data)).toBe(sha256(BINARY));
    expect(response.contentLength).toBe(BINARY.length);
  });
}

it('CTI-05 JSON body round-trips without escaping changes', async () => {
  const response = await client().get(`${baseUrl}/json`);
  expect(response.status).toBe(200);
  expect(response.data).toEqual(JSON_BODY);
});

it('CTI-06 stream delivers exactly the body bytes and exactly one end', async () => {
  const chunks: Buffer[] = [];
  let ends = 0;
  let finishes = 0;
  const stream = await client().stream(`${baseUrl}/chunked`);
  stream.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); });
  stream.on('end', () => { ends += 1; });
  stream.on('finish', () => { finishes += 1; });
  await new Promise<void>((resolve, reject) => {
    stream.on('complete', () => resolve());
    stream.on('error', reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const received = Buffer.concat(chunks);
  expect(received.length).toBe(BINARY.length);
  expect(sha256(received)).toBe(sha256(BINARY));
  expect(finishes).toBe(1);
  expect(ends).toBe(1);
});

it('CTI-07 download writes exactly the body bytes and reports the payload size', async () => {
  const target = join(workDir, 'download.bin');
  const download = client().download(`${baseUrl}/gzip`, target);
  const finish: any = await new Promise((resolve, reject) => {
    download.on('finish', resolve);
    download.on('error', reject);
  });
  const written = readFileSync(target);
  expect(sha256(written)).toBe(sha256(BINARY));
  expect(finish.fileSize).toBe(BINARY.length);
  expect(finish.contentLength).toBe(BINARY.length);
});

it('CTI-08 redirect hop headers stay out of the body and cookies from every hop are kept', async () => {
  const response = await client().get<Buffer>(`${baseUrl}/hop`, { responseType: 'buffer' });
  expect(response.status).toBe(200);
  expect(sha256(response.data)).toBe(sha256(BINARY));
  expect(response.finalUrl).toBe(`${baseUrl}/binary`);
  expect(response.cookies.array.map((cookie) => cookie.key)).toContain('hop');
});
