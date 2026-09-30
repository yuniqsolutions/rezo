/**
 * H2S — the HTTP/2 stream facade keeps the HTTP/1.1 facade contract at both ends of a response.
 *
 * Measured 2026-08-29 on a local h2 server (self-signed SAN certificate, `allowHTTP1` so the same wire serves both adapters):
 * on a rejected status HTTP/1.1 publishes `headers`, `status`, `cookies` and then the `REZ_HTTP_ERROR`; HTTP/2 published only the
 * error. On an accepted response HTTP/1.1 ends the facade with one trailing `close` after `complete` (the contract the Fetch adapter
 * was aligned to, R16-R10); HTTP/2 stopped at `complete`. Each row measures HTTP/1.1 in-row on the same wire.
 */

import * as http2 from 'node:http2';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { generateSanCertificate } from './fixtures/stealth/wire-observer.mjs';
import { installNodeRequireBridge } from './fixtures/node-require-bridge';

// Bun's node:http2 client does not complete a stream against this server (the same boundary the stealth carriers freeze RED:
// SWF *2a/*2e, SRP direct/SOCKS on Bun); the rows are Node facts and skip on Bun with this reason rather than pass on nothing.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const certificate = generateSanCertificate() as { key: string; cert: string };
const requireBridge = installNodeRequireBridge();
const scratch = mkdtempSync(join(tmpdir(), 'h2-facade-'));
const server = http2.createSecureServer({ key: certificate.key, cert: certificate.cert, allowHTTP1: true }, (request, response) => {
  if (request.url === '/redirect' || request.url === '/chain') { response.writeHead(302, { location: '/200', 'content-type': 'text/plain' }); response.end('moved'); return; }
  if (request.url === '/held') { response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' }); response.write('x'); return; }
  const status = request.url === '/500' ? 500 : 200;
  response.writeHead(status, { 'content-type': 'text/plain', 'content-length': '5', 'set-cookie': 'k=v; Path=/' });
  response.end(status === 500 ? 'oops!' : 'hello');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { requireBridge.restore(); server.close(() => resolve()); }));

type Adapter = typeof httpAdapter;
const TRACKED = ['headers', 'status', 'cookies', 'data', 'end', 'done', 'complete', 'close', 'error'] as const;
async function events(adapter: Adapter, path: string, config: Record<string, unknown> = {}): Promise<string[]> {
  const rezo = new Rezo({ retry: false, timeout: 5000, rejectUnauthorized: false, ...config } as never, adapter);
  const seen: string[] = [];
  const facade: any = rezo.stream(`${origin}${path}`);
  for (const name of TRACKED) facade.on(name, (payload: unknown) => seen.push(name === 'error' ? `error:${(payload as { code?: string })?.code}` : name));
  await new Promise((resolve) => setTimeout(resolve, 700));
  return seen;
}
const beforeError = (seen: string[]) => seen.slice(0, Math.max(0, seen.findIndex((name) => name.startsWith('error:'))));

it.skipIf(isBun)('H2S-01 a rejected status publishes headers, status and cookies before the REZ_HTTP_ERROR on HTTP/2, as on HTTP/1.1', async () => {
  const reference = await events(httpAdapter, '/500');
  const h2 = await events(http2Adapter, '/500');
  expect({ before: beforeError(reference), settled: reference.filter((n) => n.startsWith('error:') || n === 'done') }).toEqual({ before: ['headers', 'status', 'cookies'], settled: ['error:REZ_HTTP_ERROR'] });
  expect({ before: beforeError(h2), settled: h2.filter((n) => n.startsWith('error:') || n === 'done') }).toEqual({ before: beforeError(reference), settled: ['error:REZ_HTTP_ERROR'] });
});

it.skipIf(isBun)('H2S-02 an accepted response ends the HTTP/2 stream facade with one trailing close after complete, as on HTTP/1.1', async () => {
  const reference = await events(httpAdapter, '/200');
  const h2 = await events(http2Adapter, '/200');
  expect(reference.slice(-4)).toEqual(['end', 'done', 'complete', 'close']);
  expect(h2.slice(-4)).toEqual(reference.slice(-4));
  expect(h2.filter((n) => n === 'close')).toHaveLength(1);
});

it.skipIf(isBun)('H2S-03 a throwing validateStatus publishes headers, status and cookies before the callback failure on HTTP/2, as on HTTP/1.1', async () => {
  const config = { validateStatus: () => { throw new Error('validator boom'); } };
  const reference = await events(httpAdapter, '/200', config);
  const h2 = await events(http2Adapter, '/200', config);
  expect({ before: beforeError(reference), settled: reference.filter((n) => n.startsWith('error:')) }).toEqual({ before: ['headers', 'status', 'cookies'], settled: ['error:REZ_UNKNOWN_ERROR'] });
  expect({ before: beforeError(h2), settled: h2.filter((n) => n.startsWith('error:')) }).toEqual({ before: beforeError(reference), settled: ['error:REZ_UNKNOWN_ERROR'] });
});

it.skipIf(isBun)('H2S-04 control: an accepted response streams its five bytes to a success terminal on both adapters', async () => {
  for (const adapter of [httpAdapter, http2Adapter]) {
    const seen = await events(adapter, '/200');
    expect(seen.filter((n) => n === 'data').length).toBeGreaterThan(0);
    expect(seen.filter((n) => n === 'done' || n.startsWith('error:'))).toEqual(['done']);
  }
});

type ManualOutcome = { events: string[]; finished: boolean; fileExists: boolean | null };
async function manualRedirect(adapter: Adapter, kind: 'stream' | 'download' | 'upload', label: string): Promise<ManualOutcome> {
  const rezo = new Rezo({ retry: false, timeout: 5000, rejectUnauthorized: false, followRedirects: false } as never, adapter);
  const seen: string[] = []; const file = join(scratch, `${label}-${kind}.bin`);
  const facade: any = kind === 'stream' ? rezo.stream(`${origin}/redirect`) : kind === 'download' ? rezo.download(`${origin}/redirect`, file) : rezo.upload(`${origin}/redirect`, 'H2S-UPLOAD');
  for (const name of ['redirect', 'finish', 'done', 'complete', 'close', 'error']) facade.on(name, (payload: unknown) => seen.push(name === 'error' ? `error:${(payload as { code?: string })?.code}` : name));
  await new Promise((resolve) => setTimeout(resolve, 700));
  return { events: seen, finished: facade.isFinished(), fileExists: kind === 'download' ? existsSync(file) : null };
}

it.skipIf(isBun)('H2S-05 an accepted manual redirect settles the HTTP/2 stream facade with the lawful terminal (finish, done, complete, close) and no redirect event, as HTTP/1.1', async () => {
  const reference = await manualRedirect(httpAdapter, 'stream', 'h1');
  const h2 = await manualRedirect(http2Adapter, 'stream', 'h2');
  expect({ events: reference.events, finished: reference.finished }).toEqual({ events: ['finish', 'done', 'complete', 'close'], finished: true });
  expect({ events: h2.events, finished: h2.finished }).toEqual({ events: reference.events, finished: true });
});

it.skipIf(isBun)('H2S-06 an accepted manual redirect settles the HTTP/2 download facade (finish, done, complete), commits no file, as HTTP/1.1', async () => {
  const reference = await manualRedirect(httpAdapter, 'download', 'h1');
  const h2 = await manualRedirect(http2Adapter, 'download', 'h2');
  expect({ events: reference.events, finished: reference.finished, file: reference.fileExists }).toEqual({ events: ['finish', 'done', 'complete'], finished: true, file: false });
  expect({ events: h2.events, finished: h2.finished, file: h2.fileExists }).toEqual({ events: reference.events, finished: true, file: false });
});

it.skipIf(isBun)('H2S-07 an accepted manual redirect settles the HTTP/2 upload facade (finish, done, complete), as HTTP/1.1', async () => {
  const reference = await manualRedirect(httpAdapter, 'upload', 'h1');
  const h2 = await manualRedirect(http2Adapter, 'upload', 'h2');
  expect({ events: reference.events, finished: reference.finished }).toEqual({ events: ['finish', 'done', 'complete'], finished: true });
  expect({ events: h2.events, finished: h2.finished }).toEqual({ events: reference.events, finished: true });
});

it.skipIf(isBun)('H2S-08 a followed redirect emits exactly one redirect event per hop on the HTTP/2 stream facade, as HTTP/1.1', async () => {
  const collect = async (adapter: Adapter): Promise<string[]> => { const rezo = new Rezo({ retry: false, timeout: 5000, rejectUnauthorized: false } as never, adapter); const seen: string[] = []; const facade: any = rezo.stream(`${origin}/chain`); for (const name of ['redirect', 'done', 'error']) facade.on(name, (payload: unknown) => seen.push(name === 'error' ? `error:${(payload as { code?: string })?.code}` : name)); await new Promise((resolve) => setTimeout(resolve, 700)); return seen; };
  const reference = await collect(httpAdapter);
  const h2 = await collect(http2Adapter);
  expect(reference).toEqual(['redirect', 'done']);
  expect(h2).toEqual(reference);
});

// Step 3 rows (2026-08-29 20:58Z): validator taxonomy and the redirect payload on HTTP/2.
type FailurePayload = { code: string | undefined; cause: unknown; causeRaw: unknown; elapsedFromHeadersMs: number | null; data: number; done: boolean };
async function failurePayload(adapter: Adapter, path: string, config: Record<string, unknown> = {}): Promise<FailurePayload> {
  const rezo = new Rezo({ retry: false, timeout: 5000, rejectUnauthorized: false, ...config } as never, adapter);
  const facade: any = rezo.stream(`${origin}${path}`);
  let headersAt: number | null = null; let errorAt: number | null = null; let failure: any; let data = 0; let done = false;
  facade.on('headers', () => { headersAt = performance.now(); });
  facade.on('data', (chunk: { length?: number }) => { data += chunk?.length ?? 0; });
  facade.on('done', () => { done = true; });
  const settled = new Promise<void>((resolve) => { facade.on('error', (error: unknown) => { errorAt = performance.now(); failure = error; resolve(); }); facade.on('done', () => resolve()); });
  await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 2500))]);
  const cause = failure?.cause; const causeRaw = cause instanceof Error && Object.prototype.hasOwnProperty.call(cause, 'cause') ? (cause as { cause?: unknown }).cause : cause;
  return { code: failure?.code, cause, causeRaw, elapsedFromHeadersMs: headersAt !== null && errorAt !== null ? errorAt - headersAt : null, data, done };
}

it.skipIf(isBun)('H2S-09 a stateful validateStatus (false, then true) on the HTTP/2 stream facade is consulted once and the first verdict settles the request (REZ_HTTP_ERROR), no data', async () => {
  let calls = 0;
  const outcome = await failurePayload(http2Adapter, '/500', { validateStatus: () => { calls += 1; return calls > 1; } });
  expect({ calls, code: outcome.code, data: outcome.data, done: outcome.done }).toEqual({ calls: 1, code: 'REZ_HTTP_ERROR', data: 0, done: false });
});

it.skipIf(isBun)('H2S-10 a validator that throws a coded error while the body is held open settles the facade promptly as a callback failure (REZ_UNKNOWN_ERROR carrying the cause), never a transport error', async () => {
  const thrown = Object.assign(new Error('custom'), { code: 'ECONNRESET' });
  const outcome = await failurePayload(http2Adapter, '/held', { validateStatus: () => { throw thrown; } });
  expect({ code: outcome.code, cause: outcome.cause === thrown, prompt: outcome.elapsedFromHeadersMs !== null && outcome.elapsedFromHeadersMs < 300, done: outcome.done }).toEqual({ code: 'REZ_UNKNOWN_ERROR', cause: true, prompt: true, done: false });
});

it.skipIf(isBun)('H2S-11 every falsy thrown validator value is a callback failure whose wrapper cause carries the raw value under Object.is — never a status rejection', async () => {
  const values: unknown[] = [undefined, null, 0, -0, 0n, NaN, '', false];
  const results = [] as Array<{ value: string; code: string | undefined; raw: boolean }>;
  for (const value of values) {
    const outcome = await failurePayload(http2Adapter, '/500', { validateStatus: () => { throw value; } });
    results.push({ value: typeof value === 'bigint' ? '0n' : Object.is(value, -0) ? '-0' : String(value), code: outcome.code, raw: Object.is(outcome.causeRaw, value) });
  }
  expect(results).toEqual(values.map((value) => ({ value: typeof value === 'bigint' ? '0n' : Object.is(value, -0) ? '-0' : String(value), code: 'REZ_UNKNOWN_ERROR', raw: true })));
});

it.skipIf(isBun)('H2S-12 a manual 302 (followRedirects: false) whose validator throws a coded error or a falsy value is a callback failure (REZ_UNKNOWN_ERROR), never a success terminal', async () => {
  const coded = await failurePayload(http2Adapter, '/redirect', { followRedirects: false, validateStatus: () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); } });
  const falsy = await failurePayload(http2Adapter, '/redirect', { followRedirects: false, validateStatus: () => { throw 0; } });
  expect({ coded: coded.code, codedDone: coded.done, falsy: falsy.code, falsyDone: falsy.done }).toEqual({ coded: 'REZ_UNKNOWN_ERROR', codedDone: false, falsy: 'REZ_UNKNOWN_ERROR', falsyDone: false });
});

it.skipIf(isBun)('H2S-16 the redirect event of a followed hop carries the absolute destinationUrl (resolved against the source), as HTTP/1.1', async () => {
  const rezo = new Rezo({ retry: false, timeout: 5000, rejectUnauthorized: false } as never, http2Adapter);
  const facade: any = rezo.stream(`${origin}/chain`);
  const payloads: Array<{ destinationUrl?: string; sourceUrl?: string; redirectCount?: number }> = [];
  facade.on('redirect', (event: { destinationUrl?: string; sourceUrl?: string; redirectCount?: number }) => payloads.push(event));
  await new Promise<void>((resolve) => { facade.on('done', () => resolve()); facade.on('error', () => resolve()); setTimeout(resolve, 2500); });
  expect(payloads.map((event) => ({ destinationUrl: event.destinationUrl, sourceUrl: event.sourceUrl, redirectCount: event.redirectCount }))).toEqual([{ destinationUrl: `${origin}/200`, sourceUrl: `${origin}/chain`, redirectCount: 1 }]);
});
