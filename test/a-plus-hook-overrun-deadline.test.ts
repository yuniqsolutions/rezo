/**
 * A+ hook overrun vs. deadline ownership (HTTP/1.1, HTTP/2).
 *
 * A synchronous hook that runs past a budget cannot be interrupted, but it must
 * not steal the terminal from the budget that came due while it ran: the
 * timer task only runs after the hook returns, by which time the body and the
 * success path are already queued. After every `afterHeaders` and `afterParse`
 * hook the adapter re-checks its budgets by the clock — earliest owner first —
 * before any body is consumed or anything is published. A fast hook changes
 * nothing.
 */

import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

let h1Server: http.Server;
let h1Url = '';
let h2Server: http2.Http2Server;
let h2Url = '';

beforeAll(async () => {
  h1Server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok'); });
  await new Promise<void>((resolve) => h1Server.listen(0, '127.0.0.1', () => resolve()));
  h1Url = `http://127.0.0.1:${(h1Server.address() as AddressInfo).port}/immediate`;
  h2Server = http2.createServer();
  h2Server.on('stream', (stream) => { stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.end('ok'); });
  await new Promise<void>((resolve) => h2Server.listen(0, '127.0.0.1', () => resolve()));
  h2Url = `http://127.0.0.1:${(h2Server.address() as AddressInfo).port}/immediate`;
});

afterAll(async () => {
  h1Server.closeAllConnections?.();
  await new Promise<void>((resolve) => h1Server.close(() => resolve()));
  await new Promise<void>((resolve) => h2Server.close(() => resolve()));
});

const field = (value: unknown, name: string): unknown => Reflect.get(Object(value), name);
const settle = async <T,>(promise: Promise<T>): Promise<{ value: T | null; error: unknown; ms: number }> => {
  const started = performance.now();
  try { return { value: await promise, error: null, ms: performance.now() - started }; }
  catch (error) { return { value: null, error, ms: performance.now() - started }; }
};
/** Occupies the thread for `ms` — the hook cannot be interrupted by any timer. */
const blockFor = (ms: number): void => { const until = performance.now() + ms; while (performance.now() < until) { /* spin */ } };

interface Counters { afterHeaders: number; afterParse: number; beforeError: number; timeoutTypes: string[] }
const counters = (): Counters => ({ afterHeaders: 0, afterParse: 0, beforeError: 0, timeoutTypes: [] });

function hooks(seen: Counters, overrun: { afterHeaders?: number; afterParse?: number }): Record<string, unknown[]> {
  return {
    afterHeaders: [() => { seen.afterHeaders += 1; if (overrun.afterHeaders) blockFor(overrun.afterHeaders); }],
    afterParse: [(event: { data: unknown }) => { seen.afterParse += 1; if (overrun.afterParse) blockFor(overrun.afterParse); return event.data; }],
    beforeError: [(error: unknown) => { seen.beforeError += 1; return error; }],
    onTimeout: [(info: { type?: string }) => { seen.timeoutTypes.push(String(info.type)); }],
  };
}

function expectTimeout(outcome: { value: unknown; error: unknown }, code: string, phase: string, budget: number): void {
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'code')).toBe(code);
  expect(field(outcome.error, 'phase')).toBe(phase);
  expect(field(outcome.error, 'isTimeout')).toBe(true);
  expect(field(outcome.error, 'elapsed')).toBeGreaterThanOrEqual(budget);
}

const ADAPTERS = [
  { label: 'HTTP/1.1', adapter: httpAdapter, url: (): string => h1Url },
  { label: 'HTTP/2', adapter: http2Adapter, url: (): string => h2Url },
] as const;

for (const [index, { label, adapter, url }] of ADAPTERS.entries()) {
  const n = index + 1;

  it(`HOD-0${n} ${label}: a synchronous afterHeaders hook that outlives the body budget loses to the body timeout, once`, async () => {
    const seen = counters();
    const outcome = await settle(new Rezo({}, adapter as never).get(url(), { hooks: hooks(seen, { afterHeaders: 90 }), retry: false, timeout: { body: 40, total: 500 } } as never));
    expectTimeout(outcome, 'ESOCKETTIMEDOUT', 'body', 40);
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 0, beforeError: 1, timeoutTypes: ['response'] });
  });

  it(`HOD-1${n} ${label}: a synchronous afterHeaders hook that outlives the total budget loses to the total timeout, once`, async () => {
    const seen = counters();
    const outcome = await settle(new Rezo({}, adapter as never).get(url(), { hooks: hooks(seen, { afterHeaders: 90 }), retry: false, timeout: 40 } as never));
    expectTimeout(outcome, 'ECONNABORTED', 'total', 40);
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 0, beforeError: 1, timeoutTypes: ['request'] });
  });

  it(`HOD-2${n} ${label}: a fast afterHeaders hook under the same budgets changes nothing (control)`, async () => {
    const seen = counters();
    const outcome = await settle(new Rezo({}, adapter as never).get(url(), { hooks: hooks(seen, {}), responseType: 'text', retry: false, timeout: { body: 40, total: 500 } } as never));
    expect(outcome.error).toBeNull();
    expect(field(outcome.value, 'status')).toBe(200);
    expect(field(outcome.value, 'data')).toBe('ok');
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 1, beforeError: 0, timeoutTypes: [] });
  });

  it(`HOD-3${n} ${label}: a synchronous afterParse hook that outlives the total budget loses to the total timeout, once, with nothing published`, async () => {
    const seen = counters();
    const outcome = await settle(new Rezo({}, adapter as never).get(url(), { hooks: hooks(seen, { afterParse: 90 }), responseType: 'text', retry: false, timeout: 40 } as never));
    expectTimeout(outcome, 'ECONNABORTED', 'total', 40);
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 1, beforeError: 1, timeoutTypes: ['request'] });
  });

  it(`HOD-4${n} ${label}: a fast afterParse hook under a total budget changes nothing (control)`, async () => {
    const seen = counters();
    const outcome = await settle(new Rezo({}, adapter as never).get(url(), { hooks: hooks(seen, {}), responseType: 'text', retry: false, timeout: 400 } as never));
    expect(outcome.error).toBeNull();
    expect(field(outcome.value, 'data')).toBe('ok');
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 1, beforeError: 0, timeoutTypes: [] });
  });
}

// ---- upload facade: the same rule before any success terminal -------------------------------

/** The facade's own finished flag (a method on the public responses). */
const finished = (facade: unknown): boolean => { const flag = field(facade, 'isFinished'); return typeof flag === 'function' ? Boolean(Reflect.apply(flag, facade, [])) : Boolean(flag); };
interface FacadeTerminals { complete: number; done: number; errors: unknown[]; finish: number }
function collectUploadTerminals(facade: { on(event: string, listener: (...args: unknown[]) => void): unknown }, windowMs: number): Promise<FacadeTerminals> {
  return new Promise((resolve) => {
    const seen: FacadeTerminals = { complete: 0, done: 0, errors: [], finish: 0 };
    let armed = false;
    const settleSoon = (): void => { if (armed) return; armed = true; setTimeout(() => resolve(seen), windowMs); };
    facade.on('error', (error) => { seen.errors.push(error); settleSoon(); });
    facade.on('finish', () => { seen.finish += 1; settleSoon(); });
    facade.on('done', () => { seen.done += 1; settleSoon(); });
    facade.on('complete', () => { seen.complete += 1; settleSoon(); });
  });
}

for (const [index, { label, adapter, url }] of ADAPTERS.entries()) {
  const n = index + 1;

  it(`HOD-5${n} ${label} upload: a synchronous afterParse hook that outlives the total budget loses to the total timeout before any success terminal`, async () => {
    const seen = counters();
    const upload = new Rezo({}, adapter as never).upload(url(), 'payload', { hooks: hooks(seen, { afterParse: 90 }), retry: false, timeout: 40 } as never);
    const terminals = await collectUploadTerminals(upload, 150);
    expect(terminals.errors.map((error) => [field(error, 'code'), field(error, 'phase')])).toEqual([['ECONNABORTED', 'total']]);
    expect({ complete: terminals.complete, done: terminals.done, finish: terminals.finish, isFinished: finished(upload) }).toEqual({ complete: 0, done: 0, finish: 0, isFinished: false });
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 1, beforeError: 1, timeoutTypes: ['request'] });
  });

  it(`HOD-6${n} ${label} upload: a fast afterParse hook under a total budget completes normally (control)`, async () => {
    const seen = counters();
    const upload = new Rezo({}, adapter as never).upload(url(), 'payload', { hooks: hooks(seen, {}), retry: false, timeout: 400 } as never);
    const terminals = await collectUploadTerminals(upload, 150);
    expect(terminals.errors).toEqual([]);
    expect({ complete: terminals.complete, done: terminals.done, finish: terminals.finish }).toEqual({ complete: 1, done: 1, finish: 1 });
    expect(seen).toEqual({ afterHeaders: 1, afterParse: 1, beforeError: 0, timeoutTypes: [] });
  });
}
