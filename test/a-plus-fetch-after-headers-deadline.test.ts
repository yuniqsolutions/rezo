/**
 * Focused RED carrier for Fetch deadline ownership while an afterHeaders hook
 * is still pending. The response is synthetic, so this measures adapter
 * control flow without assigning a network failure to the product.
 */

import { expect, it } from 'vitest';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const BODY_DEADLINE_MS = 40;
const PRE_RELEASE_WINDOW_MS = 180;
const CLEANUP_WINDOW_MS = 1_000;
const STABILITY_MS = 40;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch afterHeaders deadline harness: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  release(): void;
}

function createDeferred(): Deferred {
  let releasePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { releasePromise = resolve; });
  return { promise, release: () => releasePromise?.() };
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
    if (delay !== BODY_DEADLINE_MS) return originalSetTimeout(callback, delay, ...args);
    let record: DeadlineTimerRecord;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      events.push('timer:body:fired');
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
      events.push('timer:body:cleared');
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

interface Outcome {
  readonly kind: 'fulfilled' | 'rejected';
  readonly value?: unknown;
  readonly error?: unknown;
}

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

it('FP-T20 a pending afterHeaders hook cannot outlive the staged body deadline', async () => {
  const events: string[] = [];
  const deferredHook = createDeferred();
  const timerProbe = installDeadlineTimerProbe(events);
  const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
  let beforeErrorCount = 0;
  let onAbortCount = 0;
  let afterParseCount = 0;
  let afterResponseCount = 0;
  let fetchCalls = 0;
  let bodyCancelCalls = 0;
  let terminalCount = 0;
  let observation: Record<string, unknown> | undefined;

  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('ok'));
      controller.close();
    },
    cancel() {
      bodyCancelCalls += 1;
      events.push('body:cancelled');
    },
  });

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push('fetch');
    return new Response(responseBody, {
      status: 200,
      headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;

  try {
    const options: RezoRequestConfig = {
      cache: false,
      responseType: 'buffer',
      retry: false,
      timeout: { body: BODY_DEADLINE_MS },
      hooks: {
        afterHeaders: [async () => {
          events.push('hook:afterHeaders:start');
          await deferredHook.promise;
          events.push('hook:afterHeaders:released');
        }],
        afterParse: [() => {
          afterParseCount += 1;
          events.push('hook:afterParse');
        }],
        afterResponse: [() => {
          afterResponseCount += 1;
          events.push('hook:afterResponse');
        }],
        onTimeout: [(event) => {
          timeoutHooks.push({ type: event.type, timeout: event.timeout, elapsed: event.elapsed });
          events.push('hook:onTimeout');
        }],
        onAbort: [() => {
          onAbortCount += 1;
          events.push('hook:onAbort');
        }],
        beforeError: [(error) => {
          beforeErrorCount += 1;
          events.push('hook:beforeError');
          return error;
        }],
      },
    };

    let request: Promise<unknown>;
    try {
      request = Promise.resolve(fetchRezo.get('http://fetch-deadline.invalid/after-headers', options));
    } catch (error) {
      request = Promise.reject(error);
    }
    const outcomePromise: Promise<Outcome> = request.then(
      (value) => {
        terminalCount += 1;
        events.push('terminal:fulfilled');
        return { kind: 'fulfilled', value };
      },
      (error) => {
        terminalCount += 1;
        events.push('terminal:rejected');
        return { kind: 'rejected', error };
      },
    );

    const beforeRelease = await Promise.race([
      outcomePromise.then((outcome) => ({ settled: true as const, outcome })),
      wait(PRE_RELEASE_WINDOW_MS).then(() => ({ settled: false as const })),
    ]);
    const settledBeforeRelease = beforeRelease.settled;
    deferredHook.release();

    const outcome = beforeRelease.settled
      ? beforeRelease.outcome
      : await within(outcomePromise, CLEANUP_WINDOW_MS, 'request did not settle after hook cleanup release');
    await wait(STABILITY_MS);

    const error = outcome.error;
    const errorObject = Object(error);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const timeoutHook = timeoutHooks[0];
    observation = {
      terminal: { kind: outcome.kind, count: terminalCount, settledBeforeRelease },
      error: {
        name: error instanceof Error ? error.name : null,
        isRezoError: error instanceof RezoError,
        code: Reflect.get(errorObject, 'code') ?? null,
        errno: Reflect.get(errorObject, 'errno') ?? null,
        phase: Reflect.get(errorObject, 'phase') ?? null,
        phaseEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'phase'),
        elapsedEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'elapsed'),
        elapsedIsInteger: Number.isInteger(elapsed),
        elapsedAtLeastBudget: typeof elapsed === 'number' && elapsed >= BODY_DEADLINE_MS,
        elapsedWithinWindow: typeof elapsed === 'number' && elapsed < PRE_RELEASE_WINDOW_MS,
        messageMatchesElapsed: Reflect.get(errorObject, 'message') === `Body timeout: Response body transfer stalled for ${elapsed}ms`,
        isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
        isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
        isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
        hasResponse: Reflect.get(errorObject, 'response') !== undefined && Reflect.get(errorObject, 'response') !== null,
        status: Reflect.get(errorObject, 'status') ?? null,
      },
      hooks: {
        afterHeaders: events.filter((event) => event === 'hook:afterHeaders:start').length,
        afterParse: afterParseCount,
        afterResponse: afterResponseCount,
        onTimeout: timeoutHooks.length,
        onTimeoutType: timeoutHook?.type ?? null,
        onTimeoutConfigured: timeoutHook?.timeout ?? null,
        onTimeoutElapsedMatchesError: timeoutHook !== undefined && timeoutHook.elapsed === elapsed,
        beforeError: beforeErrorCount,
        onAbort: onAbortCount,
      },
      sequence: {
        deadlineBeforeTimeout: eventBefore(events, 'timer:body:fired', 'hook:onTimeout'),
        timeoutBeforeErrorHook: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
        errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'terminal:rejected'),
        terminalBeforeCleanupRelease: eventBefore(events, 'terminal:rejected', 'hook:afterHeaders:released'),
      },
      transport: { fetchCalls, bodyCancelCalls },
      timers: timerProbe.records.map((record) => ({ fired: record.fired, live: record.live, clearCalls: record.clearCalls })),
    };
  } finally {
    deferredHook.release();
    globalThis.fetch = REAL_FETCH;
    timerProbe.restore();
  }

  expect(observation).toEqual({
    terminal: { kind: 'rejected', count: 1, settledBeforeRelease: true },
    error: {
      name: 'RezoError',
      isRezoError: true,
      code: 'ESOCKETTIMEDOUT',
      errno: -1073,
      phase: 'body',
      phaseEnumerable: true,
      elapsedEnumerable: true,
      elapsedIsInteger: true,
      elapsedAtLeastBudget: true,
      elapsedWithinWindow: true,
      messageMatchesElapsed: true,
      isTimeout: true,
      isRetryable: true,
      isNetworkError: false,
      hasResponse: false,
      status: null,
    },
    hooks: {
      afterHeaders: 1,
      afterParse: 0,
      afterResponse: 0,
      onTimeout: 1,
      onTimeoutType: 'response',
      onTimeoutConfigured: BODY_DEADLINE_MS,
      onTimeoutElapsedMatchesError: true,
      beforeError: 1,
      onAbort: 0,
    },
    sequence: {
      deadlineBeforeTimeout: true,
      timeoutBeforeErrorHook: true,
      errorHookBeforeTerminal: true,
      terminalBeforeCleanupRelease: true,
    },
    transport: { fetchCalls: 1, bodyCancelCalls: 1 },
    timers: [{ fired: true, live: false, clearCalls: 1 }],
  });
}, 5_000);
