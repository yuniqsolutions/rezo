/**
 * HW — HTTP/1.1 retry delays and Retry-After waits are cancellation-raced (R16-R3).
 *
 * The Fetch adapter runs its status-code retry delay and its Retry-After wait through a cancellation-safe race: a caller
 * abort during the wait settles the request promptly and disposes the timer (R16 rows FP-87 / FP-93: `retryDelayTimer`
 * cleared). HTTP/1.1 raced those waits against the total deadline only (FP-C9 / FP-C12: the timer fired): a caller who
 * aborts during a long Retry-After wait kept waiting. Each row measures Fetch on the same wire in the same process.
 */

import * as http from 'node:http';
import { getEventListeners } from 'node:events';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

let hits = 0;
const server = http.createServer((request, response) => {
  hits += 1;
  if (request.url === '/503') { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('busy'); return; }
  if (request.url === '/429') { response.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '2' }); response.end('slow down'); return; }
  response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Adapter = typeof httpAdapter;
type Outcome = { code: string | undefined; elapsedMs: number; hits: number; onAbort: number };
const RETRY_DELAY_MS = 1500;

async function abortDuringWait(adapter: Adapter, path: string, options: Record<string, unknown>, abortAfterMs: number): Promise<Outcome> {
  const before = hits; let onAbort = 0;
  const controller = new AbortController();
  const rezo = new Rezo({ timeout: 10_000, hooks: { onAbort: [() => { onAbort += 1; }] } } as never, adapter);
  const started = performance.now();
  setTimeout(() => controller.abort(), abortAfterMs);
  let code: string | undefined;
  // Options travel per request, exactly as the R16 rows pass them (retry object with statusCodes + onRetry, waitOnStatus list).
  try { await rezo.get(`${origin}${path}`, { signal: controller.signal, ...options } as never); code = 'fulfilled'; } catch (error) { code = (error as { code?: string }).code; }
  return { code, elapsedMs: performance.now() - started, hits: hits - before, onAbort };
}

it('HW-01 a caller abort during a status-code retry delay settles promptly with ABORT_ERR and no second dispatch — as Fetch', async () => {
  const options = { retry: { maxRetries: 1, retryDelay: RETRY_DELAY_MS, backoff: 1, statusCodes: [503], onRetry: () => true } };
  const reference = await abortDuringWait(fetchAdapter, '/503', options, 150);
  const h1 = await abortDuringWait(httpAdapter, '/503', options, 150);
  expect({ code: reference.code, hits: reference.hits, prompt: reference.elapsedMs < RETRY_DELAY_MS - 300 }).toEqual({ code: 'ABORT_ERR', hits: 1, prompt: true });
  expect({ code: h1.code, hits: h1.hits, prompt: h1.elapsedMs < RETRY_DELAY_MS - 300 }).toEqual({ code: reference.code, hits: reference.hits, prompt: true });
});

it('HW-02 a caller abort during a Retry-After wait ends the wait promptly with ABORT_ERR — as Fetch', async () => {
  const options = { retry: false, waitOnStatus: [429] };
  const reference = await abortDuringWait(fetchAdapter, '/429', options, 150);
  const h1 = await abortDuringWait(httpAdapter, '/429', options, 150);
  expect({ code: reference.code, hits: reference.hits, prompt: reference.elapsedMs < 1500 }).toEqual({ code: 'ABORT_ERR', hits: 1, prompt: true });
  expect({ code: h1.code, hits: h1.hits, prompt: h1.elapsedMs < 1500 }).toEqual({ code: reference.code, hits: reference.hits, prompt: true });
});

it('HW-03 control: without an abort the status-code retry still re-dispatches after the delay on both adapters', async () => {
  const options = { retry: { maxRetries: 1, retryDelay: 200, backoff: 1, statusCodes: [503], onRetry: () => true } };
  for (const adapter of [fetchAdapter, httpAdapter]) {
    const before = hits; const rezo = new Rezo({ timeout: 10_000 } as never, adapter);
    let code = 'fulfilled'; try { await rezo.get(`${origin}/503`, options as never); } catch (error) { code = (error as { code?: string }).code ?? 'no-code'; }
    expect({ code, hits: hits - before }).toEqual({ code: 'REZ_HTTP_ERROR', hits: 2 });
  }
});

it('HW-04 a caller abort while a never-settling onRateLimitWait hook is pending settles promptly and stops the hook chain on both adapters', async () => {
  for (const [label, adapter] of [['fetch', fetchAdapter], ['h1', httpAdapter]] as const) {
    const before = hits; let secondHookCalls = 0;
    const controller = new AbortController();
    const rezo = new Rezo({ timeout: 10_000, hooks: { onRateLimitWait: [() => new Promise<void>(() => undefined), () => { secondHookCalls += 1; }] } } as never, adapter);
    const started = performance.now();
    setTimeout(() => controller.abort(), 150);
    let code: string | undefined;
    try { await rezo.get(`${origin}/429`, { signal: controller.signal, retry: false, waitOnStatus: [429] } as never); code = 'fulfilled'; } catch (error) { code = (error as { code?: string }).code; }
    const elapsedMs = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect({ adapter: label, code, hits: hits - before, prompt: elapsedMs < 1500, secondHookCalls }).toEqual({ adapter: label, code: 'ABORT_ERR', hits: 1, prompt: true, secondHookCalls: 0 });
  }
});

// HD-4 (tayo 13:05Z): the total deadline is the second authority over every wait. Fetch races its Retry-After wait and its
// status-code retry delay against the caller signal AND the total deadline; HTTP/1.1 gave the Retry-After wait the caller
// signal only, and its delay wait registers on a total signal that may already be aborted. A total expiry settles with the
// typed total timeout (ECONNABORTED, phase 'total', onTimeout once) promptly, never after the full wait.
type TotalOutcome = { code: string | undefined; phase: unknown; elapsedMs: number; hits: number; onTimeout: string[]; secondHookCalls: number };
const TOTAL_MS = 400;
const UNSETTLED_GUARD_MS = 4000;

async function totalDuringWait(adapter: Adapter, path: string, options: Record<string, unknown>, neverSettlingRateLimitHook = false): Promise<TotalOutcome> {
  const before = hits; const onTimeout: string[] = []; let secondHookCalls = 0;
  const hooks: Record<string, unknown[]> = { onTimeout: [(event: { type: string }) => { onTimeout.push(event.type); }] };
  if (neverSettlingRateLimitHook) hooks.onRateLimitWait = [() => new Promise<void>(() => undefined), () => { secondHookCalls += 1; }];
  const rezo = new Rezo({ hooks } as never, adapter);
  const started = performance.now();
  let code: string | undefined; let phase: unknown;
  // A request that never settles is a carrier-owned bounded outcome ('unsettled' after UNSETTLED_GUARD_MS), never the framework
  // timeout; the request is then torn down through a test-owned signal and awaited to its terminal so nothing outlives the row.
  const teardown = new AbortController();
  let guard: ReturnType<typeof setTimeout> | undefined;
  const unsettled = new Promise<'unsettled'>((resolve) => { guard = setTimeout(() => resolve('unsettled'), UNSETTLED_GUARD_MS); });
  const request = rezo.get(`${origin}${path}`, { timeout: TOTAL_MS, signal: teardown.signal, ...options } as never).then(() => 'fulfilled' as const);
  try { code = await Promise.race([request, unsettled]); }
  catch (error) { code = (error as { code?: string }).code; phase = (error as { phase?: unknown }).phase; }
  finally { if (guard !== undefined) clearTimeout(guard); }
  const elapsedMs = performance.now() - started;
  if (code === 'unsettled') { teardown.abort(); await request.catch(() => undefined); }
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { code, phase, elapsedMs, hits: hits - before, onTimeout, secondHookCalls };
}
const settledPromptly = (outcome: TotalOutcome) => outcome.elapsedMs < TOTAL_MS + 700;
const totalShape = (outcome: TotalOutcome) => ({ code: outcome.code, phase: outcome.phase, hits: outcome.hits, onTimeout: outcome.onTimeout, prompt: settledPromptly(outcome) });
const TOTAL_TIMEOUT = { code: 'ECONNABORTED', phase: 'total', hits: 1, onTimeout: ['request'], prompt: true };

it('HW-05 a total deadline expiring during a Retry-After wait ends the wait promptly with the typed total timeout — as Fetch', async () => {
  const options = { retry: false, waitOnStatus: [429] };
  const reference = await totalDuringWait(fetchAdapter, '/429', options);
  const h1 = await totalDuringWait(httpAdapter, '/429', options);
  expect(totalShape(reference)).toEqual(TOTAL_TIMEOUT);
  expect(totalShape(h1)).toEqual(TOTAL_TIMEOUT);
});

it('HW-06 a total deadline expiring while a never-settling onRateLimitWait hook is pending settles promptly with the total timeout and stops the hook chain — as Fetch', async () => {
  const options = { retry: false, waitOnStatus: [429] };
  const reference = await totalDuringWait(fetchAdapter, '/429', options, true);
  const h1 = await totalDuringWait(httpAdapter, '/429', options, true);
  expect({ ...totalShape(reference), secondHookCalls: reference.secondHookCalls }).toEqual({ ...TOTAL_TIMEOUT, secondHookCalls: 0 });
  expect({ ...totalShape(h1), secondHookCalls: h1.secondHookCalls }).toEqual({ ...TOTAL_TIMEOUT, secondHookCalls: 0 });
});

it('HW-07 a total deadline already expired when a status-code retry delay is scheduled (after an interrupted Retry-After wait) settles promptly, never after the full delay — as Fetch', async () => {
  const options = { waitOnStatus: [429], retry: { maxRetries: 1, retryDelay: RETRY_DELAY_MS, backoff: 1, statusCodes: [429], onRetry: () => true } };
  const reference = await totalDuringWait(fetchAdapter, '/429', options);
  const h1 = await totalDuringWait(httpAdapter, '/429', options);
  expect(totalShape(reference)).toEqual(TOTAL_TIMEOUT);
  expect(totalShape(h1)).toEqual(TOTAL_TIMEOUT);
});

it('HW-08 control: a total deadline expiring during a status-code retry delay settles promptly with the total timeout on both adapters', async () => {
  const options = { retry: { maxRetries: 1, retryDelay: RETRY_DELAY_MS, backoff: 1, statusCodes: [503], onRetry: () => true } };
  const reference = await totalDuringWait(fetchAdapter, '/503', options);
  const h1 = await totalDuringWait(httpAdapter, '/503', options);
  expect(totalShape(reference)).toEqual(TOTAL_TIMEOUT);
  expect(totalShape(h1)).toEqual(TOTAL_TIMEOUT);
});

it('HW-09 a caller abort raised synchronously inside the first onRateLimitWait hook (which then never settles) is observed before the wait registers: ABORT_ERR promptly, no re-dispatch, second hook never runs — both adapters', async () => {
  for (const [label, adapter] of [['fetch', fetchAdapter], ['h1', httpAdapter]] as const) {
    const before = hits; let secondHookCalls = 0;
    const controller = new AbortController();
    const rezo = new Rezo({ timeout: 10_000, hooks: { onRateLimitWait: [() => { controller.abort(); return new Promise<void>(() => undefined); }, () => { secondHookCalls += 1; }] } } as never, adapter);
    const started = performance.now();
    let code: string | undefined;
    try { await rezo.get(`${origin}/429`, { signal: controller.signal, retry: false, waitOnStatus: [429] } as never); code = 'fulfilled'; } catch (error) { code = (error as { code?: string }).code; }
    const elapsedMs = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect({ adapter: label, code, hits: hits - before, prompt: elapsedMs < 1500, secondHookCalls }).toEqual({ adapter: label, code: 'ABORT_ERR', hits: 1, prompt: true, secondHookCalls: 0 });
  }
});

// Disposal and late effects (tayo 15:52Z): a wait that ends by an authority must leave no abort listener on the caller's signal
// and no live long timer behind, and nothing may reach the wire after the request settled. Product timers are observed by wrapping
// the global timer functions for the duration of one request (delays recorded); listeners are read with events.getEventListeners.
type DisposalLedger = { code: string | undefined; hits: number; listenersLeft: number; runtimeInternalListeners: number; longTimersLeft: number[]; hitsAfterWaitWindow: number };
// Product timers are the ones created from Rezo source; the runtimes keep their own long timers (undici's H1 parser timeout on
// Node) that no adapter owns. Bun's node:http ClientRequest keeps its internal abort hook (`this[kAbortController]?.abort()`) on
// the caller signal after the request settled — a Bun runtime allowance, counted separately and pinned per runtime.
const SOURCE_ROOT = new URL('../src/', import.meta.url).pathname;
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const isRuntimeInternalListener = (listener: unknown) => IS_BUN && String(listener).includes('kAbortController');

async function disposalLedger(adapter: Adapter, path: string, options: Record<string, unknown>, authority: 'abort' | 'total', observeAfterMs: number): Promise<DisposalLedger> {
  const before = hits;
  const controller = new AbortController();
  const liveLongTimers = new Map<unknown, number>();
  const realSetTimeout = globalThis.setTimeout; const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const id: unknown = realSetTimeout(() => { liveLongTimers.delete(id); handler(...args); }, delay);
    if (typeof delay === 'number' && delay >= 1000 && String(new Error().stack).includes(SOURCE_ROOT)) liveLongTimers.set(id, delay);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => { liveLongTimers.delete(id); return realClearTimeout(id as never); }) as typeof clearTimeout;
  let code: string | undefined;
  try {
    const rezo = new Rezo({ timeout: authority === 'total' ? TOTAL_MS : 10_000 } as never, adapter);
    if (authority === 'abort') realSetTimeout(() => controller.abort(), 150);
    try { await rezo.get(`${origin}${path}`, { signal: controller.signal, ...options } as never); code = 'fulfilled'; } catch (error) { code = (error as { code?: string }).code; }
  } finally {
    globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
  }
  const hitsAtSettle = hits - before;
  await new Promise((resolve) => realSetTimeout(resolve, observeAfterMs));
  const left = getEventListeners(controller.signal, 'abort');
  return { code, hits: hitsAtSettle, listenersLeft: left.filter((listener) => !isRuntimeInternalListener(listener)).length, runtimeInternalListeners: left.filter(isRuntimeInternalListener).length, longTimersLeft: [...liveLongTimers.values()].sort((a, b) => a - b), hitsAfterWaitWindow: hits - before };
}

it('HW-10 disposal ledger: a caller abort during a Retry-After wait leaves no abort listener on the caller signal and no live long timer, on both adapters', async () => {
  const options = { retry: false, waitOnStatus: [429] };
  const ledgers = { fetch: await disposalLedger(fetchAdapter, '/429', options, 'abort', 200), h1: await disposalLedger(httpAdapter, '/429', options, 'abort', 200) };
  console.log(`HW-10 ledgers: ${JSON.stringify(ledgers)}`);
  const expected = { code: 'ABORT_ERR', hits: 1, listenersLeft: 0, longTimersLeft: [], hitsAfterWaitWindow: 1 };
  expect(ledgers.fetch).toEqual({ ...expected, runtimeInternalListeners: 0 });
  expect(ledgers.h1).toEqual({ ...expected, runtimeInternalListeners: 0 });
});

it('HW-11 late effects: after a total-deadline settlement during a Retry-After wait nothing reaches the wire for the rest of the Retry-After window and no long timer stays alive, on both adapters', async () => {
  const options = { retry: false, waitOnStatus: [429] };
  const ledgers = { fetch: await disposalLedger(fetchAdapter, '/429', options, 'total', 2300), h1: await disposalLedger(httpAdapter, '/429', options, 'total', 2300) };
  console.log(`HW-11 ledgers: ${JSON.stringify(ledgers)}`);
  const expected = { code: 'ECONNABORTED', hits: 1, listenersLeft: 0, longTimersLeft: [], hitsAfterWaitWindow: 1 };
  expect(ledgers.fetch).toEqual({ ...expected, runtimeInternalListeners: 0 });
  // Bun's node:http keeps one internal abort hook on the caller signal (runtime allowance); Node keeps none.
  expect(ledgers.h1).toEqual({ ...expected, runtimeInternalListeners: IS_BUN ? 1 : 0 });
});

it('HW-12 control for the carrier-owned bound: a never-settling onRateLimitWait hook with no authority present yields the bounded "unsettled" outcome at the guard; the request is then torn down by a test-owned abort, awaited to ABORT_ERR, and leaves no listener, no product timer and no late wire effect — both adapters', async () => {
  for (const [label, adapter] of [['fetch', fetchAdapter], ['h1', httpAdapter]] as const) {
    const before = hits;
    const teardown = new AbortController();
    const liveLongTimers = new Map<unknown, number>();
    const realSetTimeout = globalThis.setTimeout; const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const id: unknown = realSetTimeout(() => { liveLongTimers.delete(id); handler(...args); }, delay);
      if (typeof delay === 'number' && delay >= 1000 && String(new Error().stack).includes(SOURCE_ROOT)) liveLongTimers.set(id, delay);
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => { liveLongTimers.delete(id); return realClearTimeout(id as never); }) as typeof clearTimeout;
    let first: string; let terminal: string;
    try {
      const rezo = new Rezo({ hooks: { onRateLimitWait: [() => new Promise<void>(() => undefined)] } } as never, adapter);
      const started = performance.now();
      let guard: ReturnType<typeof setTimeout> | undefined;
      const unsettled = new Promise<'unsettled'>((resolve) => { guard = realSetTimeout(() => resolve('unsettled'), UNSETTLED_GUARD_MS); });
      const request = rezo.get(`${origin}/429`, { retry: false, waitOnStatus: [429], signal: teardown.signal } as never).then(() => 'fulfilled' as const, (error: { code?: string }) => error.code ?? 'no-code');
      first = await Promise.race([request, unsettled]);
      if (guard !== undefined) realClearTimeout(guard);
      const elapsedMs = performance.now() - started;
      expect({ adapter: label, first, boundedAtGuard: elapsedMs >= UNSETTLED_GUARD_MS - 50 && elapsedMs < UNSETTLED_GUARD_MS + 1500 }).toEqual({ adapter: label, first: 'unsettled', boundedAtGuard: true });
      teardown.abort();
      terminal = await request;
    } finally {
      globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 300));
    const left = getEventListeners(teardown.signal, 'abort');
    expect({ adapter: label, terminal, hits: hits - before, listenersLeft: left.filter((listener) => !isRuntimeInternalListener(listener)).length, longTimersLeft: [...liveLongTimers.values()] })
      .toEqual({ adapter: label, terminal: 'ABORT_ERR', hits: 1, listenersLeft: 0, longTimersLeft: [] });
  }
});
