/**
 * HSD — the HTTP/1.1 stream facade decides `validateStatus` at headers time, as the Fetch adapter and H1's own buffered path do.
 *
 * Measured 2026-08-29: `rezo.stream()` on HTTP/1.1 fulfilled a 500 (headers, data, end, done, complete, close) and fulfilled with a
 * THROWING validateStatus — the validator was never consulted for a stream facade. The Fetch adapter publishes `headers`, then settles
 * the facade with `REZ_HTTP_ERROR` (rejected status; the body is read as the error payload, never streamed) or `REZ_UNKNOWN_ERROR`
 * carrying the thrown cause (callback failure). Each row measures Fetch on the same wire in the same process as the reference.
 */

import * as http from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

let hits = 0; const attempts = new Map<string, number>();
const server = http.createServer((request, response) => {
  hits += 1;
  const path = request.url ?? '/'; const attempt = (attempts.get(path) ?? 0) + 1; attempts.set(path, attempt);
  // first-attempt-only failures for the retry/wait rows
  if (path.startsWith('/503-once') && attempt === 1) { response.writeHead(503, { 'content-type': 'text/plain', 'content-length': '4' }); response.end('busy'); return; }
  if (path.startsWith('/429-once') && attempt === 1) { response.writeHead(429, { 'content-type': 'text/plain', 'content-length': '4', 'retry-after': '0' }); response.end('slow'); return; }
  if (path === '/500-truncated') {
    // a rejected status whose error payload is torn down by the peer mid-body (content-length promises more than is sent)
    response.writeHead(500, { 'content-type': 'text/plain', 'content-length': '100' }); response.write('oops!');
    setTimeout(() => response.socket?.destroy(), 40); return;
  }
  if (path === '/500-truncated-gzip') {
    // a gzip-encoded error payload torn down mid-stream: the decompression transform, not the raw response, carries the bytes
    const body = gzipSync(Buffer.from('x'.repeat(4000)));
    response.writeHead(500, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': String(body.length + 50) });
    response.write(body.subarray(0, Math.floor(body.length / 2)));
    setTimeout(() => response.socket?.destroy(), 40); return;
  }
  if (path === '/500-truncated-fin') {
    // the same truncation, ended by a graceful FIN instead of a reset: the client sees a premature close without a transport error
    response.writeHead(500, { 'content-type': 'text/plain', 'content-length': '100' }); response.write('oops!');
    setTimeout(() => response.socket?.end(), 40); return;
  }
  const status = request.url === '/500' ? 500 : 200;
  response.writeHead(status, { 'content-type': 'text/plain', 'content-length': '5' });
  response.end(status === 500 ? 'oops!' : 'hello');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Adapter = typeof httpAdapter;
type Outcome = { events: string[]; errorCode: string | null; errorStatus: number | null; causeMessage: string | null; dataBytes: number; finished: boolean; hits: number };

async function streamOutcome(adapter: Adapter, path: string, config: Record<string, unknown> = {}, requestOptions: Record<string, unknown> = {}): Promise<Outcome> {
  const before = hits;
  const rezo = new Rezo({ retry: false, timeout: 5000, ...config } as never, adapter);
  const events: string[] = []; let errorCode: string | null = null; let errorStatus: number | null = null; let causeMessage: string | null = null; let dataBytes = 0;
  const facade: any = rezo.stream(`${origin}${path}`, requestOptions as never);
  for (const name of ['headers', 'data', 'end', 'done', 'complete', 'close', 'error']) facade.on(name, (payload: unknown) => {
    events.push(name === 'headers' ? `headers:${(payload as { status?: number })?.status}` : name);
    if (name === 'data') dataBytes += (payload as { length?: number })?.length ?? 0;
    if (name === 'error') { const failure = payload as { code?: string; response?: { status?: number }; cause?: { message?: string } }; errorCode = failure?.code ?? null; errorStatus = failure?.response?.status ?? null; causeMessage = failure?.cause?.message ?? null; }
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { events, errorCode, errorStatus, causeMessage, dataBytes, finished: facade.isFinished(), hits: hits - before };
}
const settled = (outcome: Outcome) => outcome.events.filter((name) => ['done', 'error'].includes(name));

it('HSD-01 a rejected status (500) settles the stream facade with REZ_HTTP_ERROR after headers, streams no data — as Fetch', async () => {
  const reference = await streamOutcome(fetchAdapter, '/500');
  const h1 = await streamOutcome(httpAdapter, '/500');
  expect({ settled: settled(reference), code: reference.errorCode, status: reference.errorStatus, data: reference.dataBytes }).toEqual({ settled: ['error'], code: 'REZ_HTTP_ERROR', status: 500, data: 0 });
  expect({ settled: settled(h1), code: h1.errorCode, status: h1.errorStatus, data: h1.dataBytes, hits: h1.hits }).toEqual({ settled: settled(reference), code: reference.errorCode, status: reference.errorStatus, data: reference.dataBytes, hits: reference.hits });
  expect(h1.events[0]).toBe('headers:500');
});

it('HSD-02 a throwing validateStatus is a callback failure (REZ_UNKNOWN_ERROR carrying the cause), no data — as Fetch', async () => {
  const config = { validateStatus: () => { throw new Error('validator boom'); } };
  const reference = await streamOutcome(fetchAdapter, '/200', config);
  const h1 = await streamOutcome(httpAdapter, '/200', config);
  expect({ settled: settled(reference), code: reference.errorCode, cause: reference.causeMessage, data: reference.dataBytes }).toEqual({ settled: ['error'], code: 'REZ_UNKNOWN_ERROR', cause: 'validator boom', data: 0 });
  expect({ settled: settled(h1), code: h1.errorCode, cause: h1.causeMessage, data: h1.dataBytes }).toEqual({ settled: settled(reference), code: reference.errorCode, cause: reference.causeMessage, data: reference.dataBytes });
});

it('HSD-03 control: validateStatus: null accepts the 500 and the body streams to a success terminal on both adapters', async () => {
  const reference = await streamOutcome(fetchAdapter, '/500', { validateStatus: null });
  const h1 = await streamOutcome(httpAdapter, '/500', { validateStatus: null });
  expect({ settled: settled(reference), data: reference.dataBytes }).toEqual({ settled: ['done'], data: 5 });
  expect({ settled: settled(h1), data: h1.dataBytes, finished: h1.finished }).toEqual({ settled: ['done'], data: 5, finished: true });
});

it('HSD-04 control: an accepted 200 streams its body to a success terminal on both adapters', async () => {
  const reference = await streamOutcome(fetchAdapter, '/200');
  const h1 = await streamOutcome(httpAdapter, '/200');
  expect({ settled: settled(reference), data: reference.dataBytes }).toEqual({ settled: ['done'], data: 5 });
  expect({ settled: settled(h1), data: h1.dataBytes }).toEqual({ settled: ['done'], data: 5 });
});

const headersSeen = (outcome: Outcome) => outcome.events.filter((name) => name.startsWith('headers:'));

it('HSD-05 a retried status-code attempt is not exposed on the stream facade: only the accepted terminal attempt publishes headers (Phase 1c-c contract) — H1 and Fetch', async () => {
  const retry = { retry: { maxRetries: 1, retryDelay: 50, backoff: 1, statusCodes: [503], onRetry: () => true } };
  const reference = await streamOutcome(fetchAdapter, '/503-once-fetch', {}, retry);
  const h1 = await streamOutcome(httpAdapter, '/503-once-h1', {}, retry);
  expect({ headers: headersSeen(reference), settled: settled(reference), hits: reference.hits }).toEqual({ headers: ['headers:200'], settled: ['done'], hits: 2 });
  expect({ headers: headersSeen(h1), settled: settled(h1), hits: h1.hits }).toEqual({ headers: ['headers:200'], settled: ['done'], hits: 2 });
});

it('HSD-06 a Retry-After wait attempt is not exposed on the stream facade: only the accepted response publishes headers — H1 and Fetch', async () => {
  const wait = { waitOnStatus: [429] };
  const reference = await streamOutcome(fetchAdapter, '/429-once-fetch', {}, wait);
  const h1 = await streamOutcome(httpAdapter, '/429-once-h1', {}, wait);
  expect({ headers: headersSeen(reference), settled: settled(reference), hits: reference.hits }).toEqual({ headers: ['headers:200'], settled: ['done'], hits: 2 });
  expect({ headers: headersSeen(h1), settled: settled(h1), hits: h1.hits }).toEqual({ headers: ['headers:200'], settled: ['done'], hits: 2 });
});

it('HSD-07 a stateful validateStatus (false, then true) on a stream facade is consulted exactly once and the first verdict settles the request (REZ_HTTP_ERROR), no data — H1 and Fetch', async () => {
  const run = async (adapter: Adapter) => {
    let calls = 0; const config = { validateStatus: () => { calls += 1; return calls > 1; } };
    const outcome = await streamOutcome(adapter, '/500', config);
    return { calls, settled: settled(outcome), code: outcome.errorCode, data: outcome.dataBytes, finished: outcome.finished };
  };
  const reference = await run(fetchAdapter);
  const h1 = await run(httpAdapter);
  expect(reference).toEqual({ calls: 1, settled: ['error'], code: 'REZ_HTTP_ERROR', data: 0, finished: reference.finished });
  expect({ calls: h1.calls, settled: h1.settled, code: h1.code, data: h1.data }).toEqual({ calls: 1, settled: ['error'], code: 'REZ_HTTP_ERROR', data: 0 });
});

it('HSD-08 a rejected stream whose error payload is truncated by the peer is never salvaged into a success by acceptPartialBody: the recorded verdict rules the salvage, the validator is consulted once — H1 and Fetch', async () => {
  const run = async (adapter: Adapter) => {
    let calls = 0;
    const config = { acceptPartialBody: true, validateStatus: () => { calls += 1; return calls > 1; } };
    const outcome = await streamOutcome(adapter, '/500-truncated', config);
    return { calls, settled: settled(outcome), data: outcome.dataBytes, done: outcome.events.includes('done'), code: outcome.errorCode };
  };
  const reference = await run(fetchAdapter); const h1 = await run(httpAdapter);
  expect({ calls: reference.calls, settled: reference.settled, data: reference.data, done: reference.done }).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
  expect({ calls: h1.calls, settled: h1.settled, data: h1.data, done: h1.done }).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
  console.log(`HSD-08 codes: fetch=${reference.code} h1=${h1.code}`);
});

it('HSD-09 an accepted stream under a stateful validateStatus (true, then false) streams to a success terminal: the first verdict rules and the validator is consulted once — H1 and Fetch', async () => {
  const run = async (adapter: Adapter) => {
    let calls = 0;
    const config = { validateStatus: () => { calls += 1; return calls === 1; } };
    const outcome = await streamOutcome(adapter, '/ok', config);
    return { calls, settled: settled(outcome), data: outcome.dataBytes, finished: outcome.finished };
  };
  const reference = await run(fetchAdapter); const h1 = await run(httpAdapter);
  expect(reference).toEqual({ calls: 1, settled: ['done'], data: 5, finished: true });
  expect(h1).toEqual({ calls: 1, settled: ['done'], data: 5, finished: true });
});

it('HSD-10 the FIN-truncated variant of HSD-08 (premature close, no reset): the recorded verdict rules every salvage path, the validator is consulted once, no done — H1 and Fetch', async () => {
  const run = async (adapter: Adapter) => {
    let calls = 0;
    const config = { acceptPartialBody: true, validateStatus: () => { calls += 1; return calls > 1; } };
    const outcome = await streamOutcome(adapter, '/500-truncated-fin', config);
    return { calls, settled: settled(outcome), data: outcome.dataBytes, done: outcome.events.includes('done'), code: outcome.errorCode };
  };
  const reference = await run(fetchAdapter); const h1 = await run(httpAdapter);
  console.log(`HSD-10 codes: fetch=${reference.code} h1=${h1.code}`);
  expect({ calls: reference.calls, settled: reference.settled, data: reference.data, done: reference.done }).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
  expect({ calls: h1.calls, settled: h1.settled, data: h1.data, done: h1.done }).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
});

it('HSD-11 the gzip-encoded variant of HSD-08 (error payload truncated inside the decompression transform): the recorded verdict rules, the validator is consulted once, no done — H1 and Fetch', async () => {
  const run = async (adapter: Adapter) => {
    let calls = 0;
    const config = { acceptPartialBody: true, validateStatus: () => { calls += 1; return calls > 1; } };
    const outcome = await streamOutcome(adapter, '/500-truncated-gzip', config);
    return { calls, settled: settled(outcome), data: outcome.dataBytes, done: outcome.events.includes('done') };
  };
  const reference = await run(fetchAdapter); const h1 = await run(httpAdapter);
  expect(reference).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
  expect(h1).toEqual({ calls: 1, settled: ['error'], data: 0, done: false });
});
