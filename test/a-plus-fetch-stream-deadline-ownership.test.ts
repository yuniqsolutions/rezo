/**
 * Focused RED carrier for Fetch stream deadline ownership after headers.
 * A synthetic body couples its held read to Fetch's transport signal, so the
 * test distinguishes deadline ownership from caller cancellation without a
 * network fixture.
 */

import { describe, expect, it } from 'vitest';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const BUDGET_MS = 40;
const SETTLE_WINDOW_MS = 220;
const STABILITY_MS = 40;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error('Fetch stream deadline harness: ' + label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
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
    if (delay !== BUDGET_MS) return originalSetTimeout(callback, delay, ...args);
    let record: DeadlineTimerRecord;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      events.push('timer:deadline:fired');
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
      events.push('timer:deadline:cleared');
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

interface Row {
  readonly id: string;
  readonly timeout: RezoRequestConfig['timeout'];
  readonly callerAbort: boolean;
  readonly code: string;
  readonly errno: number;
  readonly phase: 'body' | 'total' | null;
  readonly timeoutType: 'response' | 'request' | null;
  readonly transportErrorsBody: boolean;
}

const ROWS: readonly Row[] = [
  { id: 'FP-T21 staged body owns held stream read', timeout: { body: BUDGET_MS }, callerAbort: false, code: 'ESOCKETTIMEDOUT', errno: -1073, phase: 'body', timeoutType: 'response', transportErrorsBody: true },
  { id: 'FP-T22 numeric total owns held stream read', timeout: BUDGET_MS, callerAbort: false, code: 'ECONNABORTED', errno: -103, phase: 'total', timeoutType: 'request', transportErrorsBody: true },
  { id: 'FP-T23 staged body preempts a non-cooperative stream read', timeout: { body: BUDGET_MS }, callerAbort: false, code: 'ESOCKETTIMEDOUT', errno: -1073, phase: 'body', timeoutType: 'response', transportErrorsBody: false },
  { id: 'FP-TC11 caller abort remains caller-owned', timeout: 0, callerAbort: true, code: 'ABORT_ERR', errno: -1025, phase: null, timeoutType: null, transportErrorsBody: true },
];

describe.each(ROWS)('$id', (row) => {
  it('keeps stream failure ownership exact', async () => {
    const events: string[] = [];
    const timerProbe = installDeadlineTimerProbe(events);
    const caller = row.callerAbort ? new AbortController() : undefined;
    const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
    const abortReasons: unknown[] = [];
    let beforeErrorCount = 0;
    let afterParseCount = 0;
    let afterResponseCount = 0;
    let fetchCalls = 0;
    let transportAbortEvents = 0;
    let bodyCancelCalls = 0;
    let dataEvents = 0;
    let errorEvents = 0;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let transportSignal: AbortSignal | undefined;
    let transportEnteredResolve: (() => void) | undefined;
    const transportEntered = new Promise<void>((resolve) => { transportEnteredResolve = resolve; });

    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new Uint8Array([0x41]));
        events.push('body:first-byte');
      },
      cancel() {
        bodyCancelCalls += 1;
        events.push('body:cancel');
      },
    });

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      events.push('fetch');
      transportSignal = init?.signal ?? undefined;
      const abortTransport = (): void => {
        transportAbortEvents += 1;
        events.push('transport:abort');
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        if (row.transportErrorsBody) {
          try { bodyController?.error(abortError); } catch { }
        }
      };
      if (transportSignal?.aborted) abortTransport();
      else transportSignal?.addEventListener('abort', abortTransport, { once: true });
      transportEnteredResolve?.();
      return new Response(responseBody, {
        status: 200,
        headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
      });
    }) as typeof fetch;

    try {
      const options: RezoRequestConfig = {
        cache: false,
        retry: false,
        timeout: row.timeout,
        ...(caller === undefined ? {} : { signal: caller.signal }),
        hooks: {
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
          onAbort: [(event) => {
            abortReasons.push(event.reason);
            events.push('hook:onAbort');
          }],
          beforeError: [(error) => {
            beforeErrorCount += 1;
            events.push('hook:beforeError');
            return error;
          }],
        },
      };

      const stream = fetchRezo.stream(
        'http://fetch-deadline.invalid/held-stream',
        options,
      );
      for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'progress', 'download-progress', 'end', 'finish', 'done', 'complete'] as const) {
        stream.on(eventName, () => { events.push('facade:' + eventName); });
      }
      stream.on('data', (chunk) => {
        dataEvents += 1;
        events.push('facade:data:' + String(Reflect.get(Object(chunk), 'length') ?? Reflect.get(Object(chunk), 'byteLength')));
      });

      const terminal = new Promise<unknown>((resolve) => {
        stream.on('error', (error) => {
          errorEvents += 1;
          events.push('facade:error');
          resolve(error);
        });
      });

      if (caller !== undefined) {
        await within(transportEntered, SETTLE_WINDOW_MS, 'transport was not entered');
        await wait(15);
        events.push('caller:abort');
        caller.abort();
      }

      const error = await within(terminal, SETTLE_WINDOW_MS, 'stream did not reject');
      await wait(STABILITY_MS);

      const errorObject = Object(error);
      const elapsedValue = Reflect.get(errorObject, 'elapsed');
      const elapsed = typeof elapsedValue === 'number' ? elapsedValue : null;
      const timeoutHook = timeoutHooks[0];
      const expectedMessage = row.phase === 'body'
        ? 'Body timeout: Response body transfer stalled for ' + String(elapsed) + 'ms'
        : row.phase === 'total'
          ? 'Total timeout: Request exceeded maximum duration of ' + String(elapsed) + 'ms'
          : 'Request aborted by signal';
      const successEvents = events.filter((event) => (
        event === 'facade:end'
        || event === 'facade:finish'
        || event === 'facade:done'
        || event === 'facade:complete'
      ));

      const observation = {
        error: {
          name: error instanceof Error ? error.name : null,
          isRezoError: error instanceof RezoError,
          code: Reflect.get(errorObject, 'code') ?? null,
          errno: Reflect.get(errorObject, 'errno') ?? null,
          phase: Reflect.get(errorObject, 'phase') ?? null,
          phaseEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'phase'),
          elapsedEnumerable: Object.prototype.propertyIsEnumerable.call(errorObject, 'elapsed'),
          elapsedIsValid: row.phase === null
            ? elapsed === null
            : Number.isInteger(elapsed) && (elapsed as number) >= BUDGET_MS && (elapsed as number) < SETTLE_WINDOW_MS,
          messageMatches: Reflect.get(errorObject, 'message') === expectedMessage,
          isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
          isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
          isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
          hasResponse: Reflect.get(errorObject, 'response') !== undefined && Reflect.get(errorObject, 'response') !== null,
          status: Reflect.get(errorObject, 'status') ?? null,
        },
        hooks: {
          afterParse: afterParseCount,
          afterResponse: afterResponseCount,
          onTimeout: timeoutHooks.length,
          onTimeoutType: timeoutHook?.type ?? null,
          onTimeoutConfigured: timeoutHook?.timeout ?? null,
          onTimeoutElapsedMatchesError: timeoutHook === undefined ? null : timeoutHook.elapsed === elapsed,
          beforeError: beforeErrorCount,
          onAbort: abortReasons.length,
          abortReasons,
        },
        facade: {
          dataEvents,
          errorEvents,
          successEvents,
          isFinished: stream.isFinished(),
        },
        transport: {
          fetchCalls,
          abortEvents: transportAbortEvents,
          signalAborted: transportSignal?.aborted ?? null,
          bodyCancelCalls,
        },
        timers: timerProbe.records.map((record) => ({
          fired: record.fired,
          live: record.live,
          clearCalls: record.clearCalls,
        })),
        sequence: {
          ownerBeforeTransportAbort: row.phase === null
            ? eventBefore(events, 'caller:abort', 'transport:abort')
            : eventBefore(events, 'timer:deadline:fired', 'transport:abort'),
          transportAbortBeforeOwnerHook: eventBefore(
            events,
            'transport:abort',
            row.phase === null ? 'hook:onAbort' : 'hook:onTimeout',
          ),
          ownerHookBeforeErrorHook: eventBefore(
            events,
            row.phase === null ? 'hook:onAbort' : 'hook:onTimeout',
            'hook:beforeError',
          ),
          errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'facade:error'),
        },
      };

      const timeoutOwned = row.phase !== null;
      expect(observation).toEqual({
        error: {
          name: 'RezoError',
          isRezoError: true,
          code: row.code,
          errno: row.errno,
          phase: row.phase,
          phaseEnumerable: timeoutOwned,
          elapsedEnumerable: timeoutOwned,
          elapsedIsValid: true,
          messageMatches: true,
          isTimeout: timeoutOwned,
          isRetryable: timeoutOwned,
          isNetworkError: false,
          hasResponse: false,
          status: null,
        },
        hooks: {
          afterParse: 0,
          afterResponse: 0,
          onTimeout: timeoutOwned ? 1 : 0,
          onTimeoutType: row.timeoutType,
          onTimeoutConfigured: timeoutOwned ? BUDGET_MS : null,
          onTimeoutElapsedMatchesError: timeoutOwned ? true : null,
          beforeError: 1,
          onAbort: timeoutOwned ? 0 : 1,
          abortReasons: timeoutOwned ? [] : ['signal'],
        },
        facade: {
          dataEvents: 1,
          errorEvents: 1,
          successEvents: [],
          isFinished: false,
        },
        transport: {
          fetchCalls: 1,
          abortEvents: 1,
          signalAborted: true,
          bodyCancelCalls: row.transportErrorsBody ? 0 : 1,
        },
        timers: timeoutOwned
          ? [{ fired: true, live: false, clearCalls: 1 }]
          : [],
        sequence: {
          ownerBeforeTransportAbort: true,
          transportAbortBeforeOwnerHook: true,
          ownerHookBeforeErrorHook: true,
          errorHookBeforeTerminal: true,
        },
      });
    } finally {
      caller?.abort();
      globalThis.fetch = REAL_FETCH;
      timerProbe.restore();
      try { bodyController?.close(); } catch { }
    }
  }, 5_000);
});
