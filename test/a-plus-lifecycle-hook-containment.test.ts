/**
 * A+ lifecycle hook containment (HTTP/1.1, HTTP/2, cURL) and the shared helper.
 *
 * `onTimeout` and `onAbort` are fire-and-forget: a hook's failure never enters
 * the request flow and never leaves the process. The public type is `void`,
 * which TypeScript still satisfies with an `async` function, so a hook that
 * returns a rejecting promise must be contained exactly like one that throws:
 * every later hook still runs with its own fresh payload, the terminal keeps
 * its timing and taxonomy, and the process sees no `unhandledRejection`.
 *
 * The shared helper behind that contract is exercised directly with hostile
 * thenables: a `then` getter that throws, a function-valued thenable, and an
 * object thenable whose getter must be read exactly once.
 */

import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { containLifecycleHook } from '../src/shared/contain-lifecycle-hook';

const pending = new Set<NodeJS.Timeout>();
const later = (ms: number, fn: () => void): void => { const t = setTimeout(() => { pending.delete(t); fn(); }, ms); pending.add(t); };
const holds = new Set<http.ServerResponse>();
const h2Holds = new Set<http2.ServerHttp2Stream>();

let h1Server: http.Server;
let h1Url = '';
let h2Server: http2.Http2Server;
let h2Url = '';

beforeAll(async () => {
  h1Server = http.createServer((_request, response) => {
    holds.add(response);
    later(700, () => { holds.delete(response); if (!response.destroyed) { response.writeHead(200); response.end('late'); } });
  });
  await new Promise<void>((resolve) => h1Server.listen(0, '127.0.0.1', () => resolve()));
  h1Url = `http://127.0.0.1:${(h1Server.address() as AddressInfo).port}/hold`;
  h2Server = http2.createServer();
  h2Server.on('stream', (stream) => {
    h2Holds.add(stream);
    later(700, () => { h2Holds.delete(stream); if (!stream.destroyed) { stream.respond({ ':status': 200 }); stream.end('late'); } });
  });
  await new Promise<void>((resolve) => h2Server.listen(0, '127.0.0.1', () => resolve()));
  h2Url = `http://127.0.0.1:${(h2Server.address() as AddressInfo).port}/hold`;
});

afterAll(async () => {
  for (const t of pending) clearTimeout(t);
  for (const response of holds) response.destroy();
  for (const stream of h2Holds) stream.destroy();
  h1Server.closeAllConnections?.();
  await new Promise<void>((resolve) => h1Server.close(() => resolve()));
  await new Promise<void>((resolve) => h2Server.close(() => resolve()));
});

const field = (value: unknown, name: string): unknown => Reflect.get(Object(value), name);
const settle = async <T,>(promise: Promise<T>): Promise<{ value: T | null; error: unknown }> => {
  try { return { value: await promise, error: null }; } catch (error) { return { value: null, error }; }
};
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const messages = (failures: unknown[]): string[] => failures.map((failure) => (failure instanceof Error ? failure.message : String(failure)));
/** Counts process-level unhandled rejections raised while the operation runs, then a settling turn. */
async function countUnhandledRejections(operation: () => Promise<void>): Promise<number> {
  let count = 0;
  const listener = (): void => { count += 1; };
  process.on('unhandledRejection', listener);
  try {
    await operation();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return count;
}

// ---- the shared helper, exercised directly ---------------------------------------------------

it('LHC-20 helper: a thenable whose `then` getter throws is reported once, never escapes, and the getter is read exactly once', async () => {
  let reads = 0;
  const failures: unknown[] = [];
  const hostile = { get then(): unknown { reads += 1; throw new Error('getter throws'); } };
  expect(() => containLifecycleHook(() => hostile, (failure) => { failures.push(failure); })).not.toThrow();
  await turn();
  expect(reads).toBe(1);
  expect(messages(failures)).toEqual(['getter throws']);
});

it('LHC-21 helper: a function-valued thenable is assimilated exactly once and its rejection is contained', async () => {
  let thenCalls = 0;
  const failures: unknown[] = [];
  const thenable = Object.assign(() => undefined, {
    then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void { thenCalls += 1; reject(new Error('function thenable rejects')); },
  });
  containLifecycleHook(() => thenable, (failure) => { failures.push(failure); });
  await turn();
  expect(thenCalls).toBe(1);
  expect(messages(failures)).toEqual(['function thenable rejects']);
});

it('LHC-22 helper: an object thenable has its `then` read exactly once and is settled exactly once', async () => {
  let reads = 0;
  let thenCalls = 0;
  const failures: unknown[] = [];
  const thenable = {
    get then(): (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void {
      reads += 1;
      return (_resolve, reject) => { thenCalls += 1; reject(new Error('object thenable rejects')); };
    },
  };
  containLifecycleHook(() => thenable, (failure) => { failures.push(failure); });
  await turn();
  expect(reads).toBe(1);
  expect(thenCalls).toBe(1);
  expect(messages(failures)).toEqual(['object thenable rejects']);
});

it('LHC-23 helper: a synchronous throw is reported once; plain object, primitive and undefined returns report nothing', async () => {
  const failures: unknown[] = [];
  containLifecycleHook(() => { throw new Error('sync'); }, (failure) => { failures.push(failure); });
  containLifecycleHook(() => ({ plain: true }), (failure) => { failures.push(failure); });
  containLifecycleHook(() => 42, (failure) => { failures.push(failure); });
  containLifecycleHook(() => undefined, (failure) => { failures.push(failure); });
  await turn();
  expect(messages(failures)).toEqual(['sync']);
});

it('LHC-24 helper: a rejecting promise is reported after the helper already returned, and a throwing reporter never escapes', async () => {
  const order: string[] = [];
  const rejections = await countUnhandledRejections(async () => {
    containLifecycleHook(() => Promise.reject(new Error('late')), (failure) => { order.push(`report:${(failure as Error).message}`); throw new Error('reporter throws'); });
    order.push('returned');
    await turn();
  });
  expect(order).toEqual(['returned', 'report:late']);
  expect(rejections).toBe(0);
});

// ---- the adapters, through the public surface -----------------------------------------------

const ADAPTERS = [
  { label: 'HTTP/1.1', adapter: httpAdapter, url: (): string => h1Url },
  { label: 'HTTP/2', adapter: http2Adapter, url: (): string => h2Url },
  { label: 'cURL', adapter: curlAdapter, url: (): string => h1Url },
] as const;

for (const [index, { label, adapter, url }] of ADAPTERS.entries()) {
  it(`LHC-0${index + 1} ${label}: a rejecting async onTimeout hook that mutates its event is contained — the next hook gets its own pristine event, the total terminal stands, no unhandled rejection`, async () => {
    const payloads: Array<Record<string, unknown>> = [];
    let firstEvent: object | undefined;
    let secondEvent: object | undefined;
    let outcome: { value: unknown; error: unknown } | undefined;
    const rejections = await countUnhandledRejections(async () => {
      outcome = await settle(new Rezo({}, adapter as never).get(url(), {
        hooks: {
          onTimeout: [
            async (info: Record<string, unknown>) => { firstEvent = info; info.type = 'mutated-by-hook-one'; throw new Error('hook one rejects'); },
            (info: Record<string, unknown>) => { secondEvent = info; payloads.push({ ...info }); },
          ],
        },
        retry: false,
        timeout: 120,
      } as never));
    });
    expect(outcome!.value).toBeNull();
    expect(field(outcome!.error, 'code')).toBe('ECONNABORTED');
    expect(field(outcome!.error, 'phase')).toBe('total');
    expect(payloads.length).toBe(1);
    expect(payloads[0].type).toBe('request');
    expect(payloads[0].elapsed).toBe(field(outcome!.error, 'elapsed'));
    expect(secondEvent).not.toBe(firstEvent);
    expect(rejections).toBe(0);
  });

  it(`LHC-1${index + 1} ${label}: a rejecting async onAbort hook that mutates its event is contained — the next hook gets its own pristine event, the abort terminal stands, no unhandled rejection`, async () => {
    const reasons: string[] = [];
    let firstEvent: object | undefined;
    let secondEvent: object | undefined;
    let outcome: { value: unknown; error: unknown } | undefined;
    const rejections = await countUnhandledRejections(async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 60);
      outcome = await settle(new Rezo({}, adapter as never).get(url(), {
        hooks: {
          onAbort: [
            async (event: Record<string, unknown>) => { firstEvent = event; event.reason = 'mutated-by-first'; throw new Error('abort hook one rejects'); },
            (event: Record<string, unknown>) => { secondEvent = event; reasons.push(String(event.reason)); },
          ],
        },
        retry: false,
        signal: controller.signal,
        timeout: 2000,
      } as never));
    });
    expect(outcome!.value).toBeNull();
    expect(field(outcome!.error, 'code')).toBe('ABORT_ERR');
    expect(reasons).toEqual(['signal']);
    expect(secondEvent).not.toBe(firstEvent);
    expect(rejections).toBe(0);
  });
}
