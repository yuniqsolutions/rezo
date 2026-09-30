/**
 * CAF — cURL argument fidelity carrier.
 *
 * curl is spawned with an argv array and no shell, so every header value the adapter hands it must reach the wire
 * byte for byte. The adapter used to backslash-escape `"`, `\`, `$`, backticks and `!` as if a shell were in between,
 * which turned `If-None-Match: "abc"` into `\"abc\"` (conditional requests could never match) and mangled every
 * client-hint brand list. Each row observes the raw request on a local HTTP/1.1 server.
 */

import http from 'node:http';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import RezoFormData from '../src/utils/form-data';

const seen: string[][] = [];
const server = http.createServer((request, response) => { seen.push(request.rawHeaders); response.end('ok'); });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const rezo = new Rezo({ retry: false, timeout: 8000 }, curlAdapter);
const pairsOf = (raw: string[]) => { const pairs: Record<string, string> = {}; for (let i = 0; i < raw.length; i += 2) pairs[raw[i]!.toLowerCase()] = raw[i + 1]!; return pairs; };

it('CAF-01 a quoted entity tag reaches the server verbatim (conditional requests can match)', async () => {
  seen.length = 0;
  await rezo.get(origin, { headers: { 'if-none-match': '"abc123"' } });
  expect(pairsOf(seen[0]!)['if-none-match']).toBe('"abc123"');
});

it('CAF-02 a client-hint brand list keeps every quote', async () => {
  seen.length = 0;
  const brands = '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"';
  await rezo.get(origin, { headers: { 'sec-ch-ua': brands } });
  expect(pairsOf(seen[0]!)['sec-ch-ua']).toBe(brands);
});

it('CAF-03 dollar signs, backticks, bangs and backslashes are not escaped', async () => {
  seen.length = 0;
  const value = 'price $5 and `tick` and bang! and back\\slash';
  await rezo.get(origin, { headers: { 'x-fidelity': value } });
  expect(pairsOf(seen[0]!)['x-fidelity']).toBe(value);
});

// ——— beyond headers: every other value the adapter hands curl as an argument ———

const bodies: string[] = [];
const bodyServer = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => { bodies.push(Buffer.concat(chunks).toString('utf8')); response.end('ok'); });
});
await new Promise<void>((resolve) => bodyServer.listen(0, '127.0.0.1', resolve));
const bodyOrigin = `http://127.0.0.1:${(bodyServer.address() as { port: number }).port}/`;
afterAll(() => new Promise<void>((resolve) => bodyServer.close(() => resolve())));

it('CAF-04 a JSON body keeps its quotes (every JSON POST depends on it)', async () => {
  bodies.length = 0;
  await rezo.post(bodyOrigin, { name: 'a"b', price: '$5!' });
  expect(JSON.parse(bodies[0]!)).toEqual({ name: 'a"b', price: '$5!' });
});

it('CAF-05 a string body with quotes, dollars, backticks, bangs and backslashes arrives verbatim', async () => {
  bodies.length = 0;
  const body = 'q="x" $y `z` w! back\\slash';
  await rezo.post(bodyOrigin, body, { headers: { 'content-type': 'text/plain' } });
  expect(bodies[0]).toBe(body);
});

it('CAF-06 multipart form fields keep the same characters', async () => {
  bodies.length = 0;
  const form = new RezoFormData();
  form.append('note', 'say "hi" for $5 `now`!');
  await rezo.post(bodyOrigin, form);
  expect(bodies[0]).toContain('say "hi" for $5 `now`!');
});

const proxyAuth: string[] = [];
const proxyServer = http.createServer((request, response) => { proxyAuth.push(request.headers['proxy-authorization'] ?? ''); response.end('via proxy'); });
await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
const proxyPort = (proxyServer.address() as { port: number }).port;
afterAll(() => new Promise<void>((resolve) => proxyServer.close(() => resolve())));

it('CAF-07 proxy credentials with dollars and bangs authenticate as typed', async () => {
  proxyAuth.length = 0;
  const viaProxy = new Rezo({ retry: false, timeout: 8000, proxy: { protocol: 'http', host: '127.0.0.1', port: proxyPort, auth: { username: 'user', password: 'pa$$w0rd!' } } }, curlAdapter);
  const response = await viaProxy.get('http://example.invalid/');
  expect(response.data).toBe('via proxy');
  const [scheme, token] = (proxyAuth[0] ?? '').split(' ');
  expect(scheme).toBe('Basic');
  expect(Buffer.from(token ?? '', 'base64').toString('utf8')).toBe('user:pa$$w0rd!');
});

// Named gap (RED on purpose until the curl adapter learns the platform FormData the HTTP adapter already accepts).
it('CAF-08 a platform FormData body reaches the wire as multipart, as it does on the HTTP adapter', async () => {
  bodies.length = 0;
  const form = new FormData();
  form.append('note', 'platform form');
  await rezo.post(bodyOrigin, form);
  expect(bodies[0]).toContain('platform form');
});
