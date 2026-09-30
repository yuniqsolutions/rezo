/**
 * Focused RED carrier for Fetch total-deadline ownership while handling a
 * rate-limit response. Synthetic 429 responses isolate adapter control flow
 * from network timing.
 */

import { describe, expect, it } from 'vitest';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const TOTAL_DEADLINE_MS = 40;
const RATE_LIMIT_WAIT_MS = 1_000;
const SETTLE_WINDOW_MS = 180;
const CLEANUP_WINDOW_MS = 600;
const STABILITY_MS = 40;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch rate-limit deadline harness: ${label}`)), ms);
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
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, release: () => resolvePromise?.() };
}

type TimerKind = 'total' | 'rate-limit';

interface TimerRecord {
  readonly kind: TimerKind;
  readonly handle: ReturnType<typeof setTimeout>;
  fired: boolean;
  live: boolean;
  clearCalls: number;
  forcedForCleanup: boolean;
  force(): void;
}

function installTimerProbe(events: string[]): {
  readonly records: TimerRecord[];
  forceRateLimitTimers(): void;
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const records: TimerRecord[] = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const kind: TimerKind | undefined = delay === TOTAL_DEADLINE_MS
      ? 'total'
      : delay === RATE_LIMIT_WAIT_MS
        ? 'rate-limit'
        : undefined;
    if (kind === undefined) return originalSetTimeout(callback, delay, ...args);

    let record: TimerRecord;
    const invoke = (...callbackArgs: unknown[]): void => {
      if (!record.live) return;
      record.fired = true;
      record.live = false;
      events.push(`timer:${kind}:fired`);
      callback(...callbackArgs);
    };
    const handle = originalSetTimeout(invoke, delay, ...args);
    record = {
      kind,
      handle,
      fired: false,
      live: true,
      clearCalls: 0,
      forcedForCleanup: false,
      force(): void {
        if (!record.live) return;
        record.forcedForCleanup = true;
        originalClearTimeout(record.handle);
        invoke();
      },
    };
    records.push(record);
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    const record = records.find((candidate) => candidate.handle === handle);
    if (record !== undefined) {
      record.clearCalls += 1;
      record.live = false;
      events.push(`timer:${record.kind}:cleared`);
    }
    originalClearTimeout(handle);
  }) as typeof clearTimeout;

  return {
    records,
    forceRateLimitTimers(): void {
      for (const record of records) if (record.kind === 'rate-limit') record.force();
    },
    restore(): void {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      for (const record of records) if (record.live) originalClearTimeout(record.handle);
    },
  };
}

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

interface Row {
  readonly id: string;
  readonly deferredHook: boolean;
}

const ROWS: readonly Row[] = [
  { id: 'FP-T17A total deadline preempts the Retry-After timer', deferredHook: false },
  { id: 'FP-T17B total deadline preempts a pending onRateLimitWait hook', deferredHook: true },
];

describe.each(ROWS)('$id', (row) => {
  it('settles once under total-deadline ownership', async () => {
    const events: string[] = [];
    const hookGate = createDeferred();
    const timerProbe = installTimerProbe(events);
    const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
    let rateLimitHookCount = 0;
    let beforeErrorCount = 0;
    let onAbortCount = 0;
    let fetchCalls = 0;
    let terminalCount = 0;
    let observation: Record<string, unknown> | undefined;

    globalThis.fetch = (async () => {
      fetchCalls += 1;
      events.push('fetch');
      return new Response(JSON.stringify({ limited: true }), {
        status: 429,
        headers: {
          'content-length': '16',
          'content-type': 'application/json',
          'retry-after': '1',
        },
      });
    }) as typeof fetch;

    try {
      const options: RezoRequestConfig = {
        cache: false,
        retry: false,
        timeout: TOTAL_DEADLINE_MS,
        waitOnStatus: [429],
        maxWaitAttempts: 1,
        maxWaitTime: RATE_LIMIT_WAIT_MS,
        hooks: {
          onRateLimitWait: [async () => {
            rateLimitHookCount += 1;
            events.push('hook:onRateLimitWait:start');
            if (row.deferredHook) await hookGate.promise;
            events.push('hook:onRateLimitWait:end');
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

      const request = Promise.resolve(fetchRezo.get(
        'http://fetch-deadline.invalid/rate-limit',
        options,
      ));
      const outcomePromise = request.then(
        (value) => {
          terminalCount += 1;
          events.push('terminal:fulfilled');
          return { kind: 'fulfilled' as const, value };
        },
        (error) => {
          terminalCount += 1;
          events.push('terminal:rejected');
          return { kind: 'rejected' as const, error };
        },
      );

      const beforeCleanup = await Promise.race([
        outcomePromise.then((outcome) => ({ settled: true as const, outcome })),
        wait(SETTLE_WINDOW_MS).then(() => ({ settled: false as const })),
      ]);
      const settledBeforeCleanup = beforeCleanup.settled;

      hookGate.release();
      await wait(20);
      if (!settledBeforeCleanup) timerProbe.forceRateLimitTimers();

      const outcome = beforeCleanup.settled
        ? beforeCleanup.outcome
        : await within(outcomePromise, CLEANUP_WINDOW_MS, 'request did not settle after harness cleanup');
      await wait(STABILITY_MS);

      const error = outcome.kind === 'rejected' ? outcome.error : undefined;
      const errorObject = Object(error);
      const elapsed = Reflect.get(errorObject, 'elapsed');
      const timeoutHook = timeoutHooks[0];
      const timerFacts = (kind: TimerKind) => timerProbe.records
        .filter((record) => record.kind === kind)
        .map((record) => ({
          fired: record.fired,
          live: record.live,
          clearCalls: record.clearCalls,
          forcedForCleanup: record.forcedForCleanup,
        }));

      observation = {
        terminal: { kind: outcome.kind, count: terminalCount, settledBeforeCleanup },
        error: {
          name: error instanceof Error ? error.name : null,
          isRezoError: error instanceof RezoError,
          code: Reflect.get(errorObject, 'code') ?? null,
          errno: Reflect.get(errorObject, 'errno') ?? null,
          phase: Reflect.get(errorObject, 'phase') ?? null,
          phaseEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'phase'),
          elapsedEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'elapsed'),
          elapsedIsValid: Number.isInteger(elapsed)
            && (elapsed as number) >= TOTAL_DEADLINE_MS
            && (elapsed as number) < SETTLE_WINDOW_MS,
          messageMatches: Reflect.get(errorObject, 'message')
            === `Total timeout: Request exceeded maximum duration of ${String(elapsed)}ms`,
          isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
          isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
          isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
          hasResponse: Reflect.get(errorObject, 'response') !== undefined
            && Reflect.get(errorObject, 'response') !== null,
          status: Reflect.get(errorObject, 'status') ?? null,
        },
        hooks: {
          onRateLimitWait: rateLimitHookCount,
          onTimeout: timeoutHooks.length,
          onTimeoutType: timeoutHook?.type ?? null,
          onTimeoutConfigured: timeoutHook?.timeout ?? null,
          onTimeoutElapsedMatchesError: timeoutHook?.elapsed === elapsed,
          beforeError: beforeErrorCount,
          onAbort: onAbortCount,
        },
        sequence: {
          waitBeforeDeadline: eventBefore(events, 'hook:onRateLimitWait:start', 'timer:total:fired'),
          deadlineBeforeTimeout: eventBefore(events, 'timer:total:fired', 'hook:onTimeout'),
          timeoutBeforeErrorHook: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
          errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'terminal:rejected'),
        },
        transport: { fetchCalls },
        timers: {
          total: timerFacts('total'),
          rateLimit: timerFacts('rate-limit'),
        },
      };
    } finally {
      hookGate.release();
      timerProbe.forceRateLimitTimers();
      globalThis.fetch = REAL_FETCH;
      timerProbe.restore();
    }

    expect(observation).toEqual({
      terminal: { kind: 'rejected', count: 1, settledBeforeCleanup: true },
      error: {
        name: 'RezoError',
        isRezoError: true,
        code: 'ECONNABORTED',
        errno: -103,
        phase: 'total',
        phaseEnumerable: true,
        elapsedEnumerable: true,
        elapsedIsValid: true,
        messageMatches: true,
        isTimeout: true,
        isRetryable: true,
        isNetworkError: false,
        hasResponse: false,
        status: null,
      },
      hooks: {
        onRateLimitWait: 1,
        onTimeout: 1,
        onTimeoutType: 'request',
        onTimeoutConfigured: TOTAL_DEADLINE_MS,
        onTimeoutElapsedMatchesError: true,
        beforeError: 1,
        onAbort: 0,
      },
      sequence: {
        waitBeforeDeadline: true,
        deadlineBeforeTimeout: true,
        timeoutBeforeErrorHook: true,
        errorHookBeforeTerminal: true,
      },
      transport: { fetchCalls: 1 },
      timers: {
        total: [{ fired: true, live: false, clearCalls: 1, forcedForCleanup: false }],
        rateLimit: row.deferredHook
          ? []
          : [{ fired: false, live: false, clearCalls: 1, forcedForCleanup: false }],
      },
    });
  }, 5_000);
});
