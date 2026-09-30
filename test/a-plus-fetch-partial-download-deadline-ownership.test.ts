/**
 * Fetch FP-T80: after download bytes arrive, a staged body timeout is
 * hard-final even when retry policy exists.
 */
import { describe, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const BODY_TIMEOUT_MS = 40;
const SETTLE_WINDOW_MS = 300;
const STABILITY_MS = 40;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;
const IS_BUN = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error('Fetch FP-T80 harness: ' + label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) REAL_CLEAR_TIMEOUT(guard);
  }
}

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

interface DeadlineTimerRecord {
  readonly handle: ReturnType<typeof setTimeout>;
  fired: boolean;
  live: boolean;
  clearCalls: number;
}

function installDeadlineTimerProbe(events: string[]): {
  readonly records: DeadlineTimerRecord[];
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const records: DeadlineTimerRecord[] = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== BODY_TIMEOUT_MS) return originalSetTimeout(callback, delay, ...args);
    let record: DeadlineTimerRecord;
    const ordinal = records.length + 1;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      events.push('timer:body:' + String(ordinal) + ':fired');
      callback(...callbackArgs);
    }, delay, ...args);
    record = { handle, fired: false, live: true, clearCalls: 0 };
    records.push(record);
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    const record = records.find((candidate) => candidate.handle === handle);
    if (record !== undefined) {
      record.clearCalls += 1;
      record.live = false;
      events.push('timer:body:' + String(records.indexOf(record) + 1) + ':cleared');
    }
    originalClearTimeout(handle);
  }) as typeof clearTimeout;

  return {
    records,
    restore(): void {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      for (const record of records) if (record.live) originalClearTimeout(record.handle);
    },
  };
}

function installNodeRequireBridge(): { restore(): void } {
  if (Object.getOwnPropertyDescriptor(globalThis, 'require') !== undefined) {
    throw new Error('Fetch FP-T80 harness found an unexpected require descriptor');
  }
  const nodeRequire = (specifier: string): unknown => {
    if (specifier !== 'node:fs') throw new Error('Fetch FP-T80 bridge rejected ' + specifier);
    return nodeFs;
  };
  Object.defineProperty(globalThis, 'require', {
    configurable: true,
    enumerable: false,
    value: nodeRequire,
    writable: false,
  });
  return {
    restore(): void {
      if (!Reflect.deleteProperty(globalThis, 'require')) {
        throw new Error('Fetch FP-T80 bridge could not restore require');
      }
    },
  };
}

describe('Fetch partial-download deadline ownership', () => {
  it('FP-T80 makes a staged body timeout hard-final after the first received byte', async () => {
    const events: string[] = [];
    const timerProbe = installDeadlineTimerProbe(events);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rezo-fetch-fp-t80-'));
    const nodeBridge = IS_BUN ? undefined : installNodeRequireBridge();
    const target = join(temporaryDirectory, 'target.bin');
    const responseBodies: ReadableStream<Uint8Array>[] = [];
    const bodyControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
    let fetchCalls = 0;
    let transportAbortEvents = 0;
    let bodyCancelCalls = 0;
    let retryConditionCalls = 0;
    let onRetryCalls = 0;
    let beforeRetryCalls = 0;
    let retryExhaustedCalls = 0;
    let afterParseCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let onAbortCalls = 0;
    let errorEvents = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const ordinal = fetchCalls;
      events.push('fetch:' + String(ordinal));
      const body = new ReadableStream<Uint8Array>({
        start(bodyController) {
          bodyControllers.push(bodyController);
          bodyController.enqueue(new Uint8Array([0x41]));
          events.push('body:' + String(ordinal) + ':first-byte');
        },
        cancel() {
          bodyCancelCalls += 1;
          events.push('body:' + String(ordinal) + ':cancel');
        },
      });
      responseBodies.push(body);

      const onTransportAbort = (): void => {
        transportAbortEvents += 1;
        events.push('transport:' + String(ordinal) + ':abort');
      };
      if (init?.signal?.aborted) onTransportAbort();
      else init?.signal?.addEventListener('abort', onTransportAbort, { once: true });

      return new Response(body, {
        status: 200,
        headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
      });
    }) as typeof fetch;

    try {
      const options: RezoRequestConfig = {
        cache: false,
        timeout: { body: BODY_TIMEOUT_MS },
        retry: {
          maxRetries: 2,
          retryDelay: 0,
          condition: () => {
            retryConditionCalls += 1;
            events.push('retry:condition');
            return true;
          },
          onRetry: () => {
            onRetryCalls += 1;
            events.push('retry:onRetry');
            return true;
          },
          onRetryExhausted: () => {
            retryExhaustedCalls += 1;
            events.push('retry:exhausted');
          },
        },
        hooks: {
          beforeRetry: [() => {
            beforeRetryCalls += 1;
            events.push('hook:beforeRetry');
          }],
          afterParse: [() => {
            afterParseCalls += 1;
            events.push('hook:afterParse');
          }],
          afterResponse: [() => {
            afterResponseCalls += 1;
            events.push('hook:afterResponse');
          }],
          onTimeout: [(event) => {
            timeoutHooks.push({ type: event.type, timeout: event.timeout, elapsed: event.elapsed });
            events.push('hook:onTimeout:' + String(timeoutHooks.length));
          }],
          onAbort: [() => {
            onAbortCalls += 1;
            events.push('hook:onAbort');
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            events.push('hook:beforeError');
            return error;
          }],
        },
      };

      const download = fetchRezo.download(
        'http://fetch-deadline.invalid/partial-download',
        target,
        options,
      );
      const successEvents: string[] = [];
      for (const eventName of ['finish', 'done', 'complete'] as const) {
        download.on(eventName, () => {
          successEvents.push(eventName);
          events.push('facade:' + eventName);
        });
      }
      const terminal = new Promise<unknown>((resolve) => {
        download.on('error', (error) => {
          errorEvents += 1;
          events.push('facade:error');
          resolve(error);
        });
      });

      const error = await within(terminal, SETTLE_WINDOW_MS, 'download did not reject');
      await wait(STABILITY_MS);

      const errorObject = Object(error);
      const elapsedValue = Reflect.get(errorObject, 'elapsed');
      const elapsed = typeof elapsedValue === 'number' ? elapsedValue : null;
      const errorConfig = Object(Reflect.get(errorObject, 'config'));
      const timeoutHook = timeoutHooks[0];
      const directoryEntries = (await readdir(temporaryDirectory)).sort();
      const expectedMessage = 'Body timeout: Response body transfer stalled for ' + String(elapsed) + 'ms';

      const observation = {
        error: {
          name: error instanceof Error ? error.name : null,
          isRezoError: error instanceof RezoError,
          code: Reflect.get(errorObject, 'code') ?? null,
          errno: Reflect.get(errorObject, 'errno') ?? null,
          phase: Reflect.get(errorObject, 'phase') ?? null,
          phaseEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'phase'),
          elapsedEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'elapsed'),
          elapsedIsValid: Number.isInteger(elapsed) && (elapsed as number) >= BODY_TIMEOUT_MS && (elapsed as number) < SETTLE_WINDOW_MS,
          messageMatches: Reflect.get(errorObject, 'message') === expectedMessage,
          isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
          isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
          isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
          hasResponse: Reflect.get(errorObject, 'response') !== undefined && Reflect.get(errorObject, 'response') !== null,
          status: Reflect.get(errorObject, 'status') ?? null,
          retryAttempts: Reflect.get(errorConfig, 'retryAttempts') ?? null,
        },
        hooks: {
          onTimeout: timeoutHooks.length,
          onTimeoutType: timeoutHook?.type ?? null,
          onTimeoutConfigured: timeoutHook?.timeout ?? null,
          onTimeoutElapsedMatchesError: timeoutHook?.elapsed === elapsed,
          retryCondition: retryConditionCalls,
          onRetry: onRetryCalls,
          beforeRetry: beforeRetryCalls,
          retryExhausted: retryExhaustedCalls,
          afterParse: afterParseCalls,
          afterResponse: afterResponseCalls,
          beforeError: beforeErrorCalls,
          onAbort: onAbortCalls,
        },
        facade: {
          errorEvents,
          successEvents,
          isFinished: download.isFinished(),
        },
        transport: {
          fetchCalls,
          abortEvents: transportAbortEvents,
          bodyCancelCalls,
          bodyLocked: responseBodies.map((body) => body.locked),
        },
        target: { directoryEntries },
        timers: timerProbe.records.map((record) => ({
          fired: record.fired,
          live: record.live,
          clearCalls: record.clearCalls,
        })),
        sequence: {
          firstByteBeforeTimeout: eventBefore(events, 'body:1:first-byte', 'timer:body:1:fired'),
          timeoutBeforeTransportAbort: eventBefore(events, 'timer:body:1:fired', 'transport:1:abort'),
          transportAbortBeforeTimeoutHook: eventBefore(events, 'transport:1:abort', 'hook:onTimeout:1'),
          timeoutHookBeforeErrorHook: eventBefore(events, 'hook:onTimeout:1', 'hook:beforeError'),
          errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'facade:error'),
        },
      };

      expect(observation).toEqual({
        error: {
          name: 'RezoError',
          isRezoError: true,
          code: 'ESOCKETTIMEDOUT',
          errno: -1073,
          phase: 'body',
          phaseEnumerable: true,
          elapsedEnumerable: true,
          elapsedIsValid: true,
          messageMatches: true,
          isTimeout: true,
          isRetryable: true,
          isNetworkError: false,
          hasResponse: false,
          status: null,
          retryAttempts: 0,
        },
        hooks: {
          onTimeout: 1,
          onTimeoutType: 'response',
          onTimeoutConfigured: BODY_TIMEOUT_MS,
          onTimeoutElapsedMatchesError: true,
          retryCondition: 0,
          onRetry: 0,
          beforeRetry: 0,
          retryExhausted: 0,
          afterParse: 0,
          afterResponse: 0,
          beforeError: 1,
          onAbort: 0,
        },
        facade: { errorEvents: 1, successEvents: [], isFinished: false },
        transport: { fetchCalls: 1, abortEvents: 1, bodyCancelCalls: 1, bodyLocked: [false] },
        target: { directoryEntries: [] },
        timers: [{ fired: true, live: false, clearCalls: 1 }],
        sequence: {
          firstByteBeforeTimeout: true,
          timeoutBeforeTransportAbort: true,
          transportAbortBeforeTimeoutHook: true,
          timeoutHookBeforeErrorHook: true,
          errorHookBeforeTerminal: true,
        },
      });
    } finally {
      globalThis.fetch = REAL_FETCH;
      timerProbe.restore();
      nodeBridge?.restore();
      for (const controller of bodyControllers) {
        try { controller.close(); } catch { }
      }
      await wait(0);
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }, 5_000);
});
