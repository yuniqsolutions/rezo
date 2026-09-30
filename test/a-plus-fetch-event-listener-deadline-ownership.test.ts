/**
 * Focused RED carrier for Fetch total-deadline ownership after synchronous
 * public facade listeners return. A synthetic response removes network timing
 * so the initiated/start boundaries are observed independently.
 */

import { expect, it } from 'vitest';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const TOTAL_DEADLINE_MS = 40;
const CONTROL_DEADLINE_MS = 500;
const SYNC_OVERRUN_MS = 90;
const SETTLE_WINDOW_MS = 600;
const STABILITY_MS = 40;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

type OverrunSite = 'initiated' | 'start';
type CallerTiming = 'pre-aborted' | 'listener-entry' | 'listener-exit';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch event deadline harness: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
  }
}

function blockEventLoop(ms: number): void {
  const startedAt = performance.now();
  while (performance.now() - startedAt < ms) {
    // Deliberately occupy this listener turn: the queued total timer cannot run.
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

function installDeadlineTimerProbe(events: string[], deadlineMs: number): {
  readonly records: DeadlineTimerRecord[];
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const records: DeadlineTimerRecord[] = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== deadlineMs) return originalSetTimeout(callback, delay, ...args);
    let record: DeadlineTimerRecord;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      events.push('timer:total:fired');
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
      events.push('timer:total:cleared');
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

async function observeSynchronousListenerOverrun(site: OverrunSite): Promise<Record<string, unknown>> {
  const events: string[] = [];
  const timerProbe = installDeadlineTimerProbe(events, TOTAL_DEADLINE_MS);
  const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
  let beforeErrorCount = 0;
  let onAbortCount = 0;
  let listenerCalls = 0;
  let downstreamStartCalls = 0;
  let fetchCalls = 0;
  let dataEvents = 0;
  let errorEvents = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push('fetch');
    return new Response(new Uint8Array([0x6f, 0x6b]), {
      status: 200,
      headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;

  try {
    const options: RezoRequestConfig = {
      cache: false,
      retry: false,
      timeout: TOTAL_DEADLINE_MS,
      hooks: {
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

    const stream = fetchRezo.stream('http://fetch-deadline.invalid/event-overrun', options);
    stream.on(site, () => {
      listenerCalls += 1;
      events.push(`listener:${site}:start`);
      blockEventLoop(SYNC_OVERRUN_MS);
      events.push(`listener:${site}:end`);
    });
    if (site === 'initiated') {
      stream.on('start', () => {
        downstreamStartCalls += 1;
        events.push('downstream:start');
      });
    }
    for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'progress', 'download-progress', 'end', 'finish', 'done'] as const) {
      stream.on(eventName, () => { events.push(`facade:${eventName}`); });
    }
    stream.on('data', () => {
      dataEvents += 1;
      events.push('facade:data');
    });

    const terminal = new Promise<
      { readonly error: unknown; readonly kind: 'rejected' }
      | { readonly kind: 'fulfilled'; readonly value: unknown }
    >((resolve) => {
      stream.on('error', (error) => {
        errorEvents += 1;
        events.push('facade:error');
        resolve({ error, kind: 'rejected' });
      });
      stream.on('complete', (value) => {
        events.push('facade:complete');
        resolve({ kind: 'fulfilled', value });
      });
    });

    const outcome = await within(terminal, SETTLE_WINDOW_MS, `${site} listener overrun did not settle`);
    await wait(STABILITY_MS);

    const error = outcome.kind === 'rejected' ? outcome.error : undefined;
    const errorObject = Object(error);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const timeoutHook = timeoutHooks[0];
    const successEvents = events.filter((event) => (
      event === 'facade:end'
      || event === 'facade:finish'
      || event === 'facade:done'
      || event === 'facade:complete'
    ));

    return {
      terminal: outcome.kind,
      error: {
        isRezoError: error instanceof RezoError,
        code: Reflect.get(errorObject, 'code') ?? null,
        errno: Reflect.get(errorObject, 'errno') ?? null,
        phase: Reflect.get(errorObject, 'phase') ?? null,
        elapsedIsValid: Number.isInteger(elapsed)
          && (elapsed as number) >= TOTAL_DEADLINE_MS
          && (elapsed as number) < SETTLE_WINDOW_MS,
        messageMatches: Reflect.get(errorObject, 'message')
          === `Total timeout: Request exceeded maximum duration of ${String(elapsed)}ms`,
      },
      hooks: {
        onTimeout: timeoutHooks.length,
        onTimeoutType: timeoutHook?.type ?? null,
        onTimeoutConfigured: timeoutHook?.timeout ?? null,
        onTimeoutElapsedMatchesError: timeoutHook?.elapsed === elapsed,
        beforeError: beforeErrorCount,
        onAbort: onAbortCount,
      },
      facade: {
        listenerCalls,
        downstreamStartCalls,
        dataEvents,
        errorEvents,
        successEvents,
        isFinished: stream.isFinished(),
      },
      transport: { fetchCalls },
      sequence: {
        listenerReturnedBeforeDeadline: eventBefore(events, `listener:${site}:end`, 'timer:total:fired'),
        deadlineBeforeTimeoutHook: eventBefore(events, 'timer:total:fired', 'hook:onTimeout'),
        timeoutBeforeErrorHook: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
        errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'facade:error'),
      },
      timers: timerProbe.records.map((record) => ({
        fired: record.fired,
        live: record.live,
        clearCalls: record.clearCalls,
      })),
    };
  } finally {
    globalThis.fetch = REAL_FETCH;
    timerProbe.restore();
  }
}

async function observeCallerVsTotalAtEmitter(
  site: OverrunSite,
  timing: CallerTiming,
): Promise<Record<string, unknown>> {
  const events: string[] = [];
  const timerProbe = installDeadlineTimerProbe(events, TOTAL_DEADLINE_MS);
  const controller = new AbortController();
  let beforeErrorCount = 0;
  let onAbortCount = 0;
  let onTimeoutCount = 0;
  let initiatedCalls = 0;
  let startCalls = 0;
  let fetchCalls = 0;
  let errorEvents = 0;
  let retryConditionCalls = 0;
  let retryOnRetryCalls = 0;
  let retryBeforeRetryCalls = 0;
  let retryExhaustedCalls = 0;
  const successEvents: string[] = [];

  const issueAbort = (): void => {
    events.push('caller:abort');
    controller.abort();
  };
  if (timing === 'pre-aborted') issueAbort();

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push('fetch');
    return new Response(new Uint8Array([0x6f, 0x6b]), {
      status: 200,
      headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;

  try {
    const stream = fetchRezo.stream('http://fetch-deadline.invalid/caller-vs-total', {
      cache: false,
      signal: controller.signal,
      timeout: TOTAL_DEADLINE_MS,
      hooks: {
        onAbort: [() => {
          onAbortCount += 1;
          events.push('hook:onAbort');
        }],
        onTimeout: [() => {
          onTimeoutCount += 1;
          events.push('hook:onTimeout');
        }],
        beforeError: [(error) => {
          beforeErrorCount += 1;
          events.push('hook:beforeError');
          return error;
        }],
        beforeRetry: [() => {
          retryBeforeRetryCalls += 1;
          events.push('retry:beforeRetry');
        }],
      },
      retry: {
        maxRetries: 1,
        retryDelay: 1,
        condition: () => {
          retryConditionCalls += 1;
          events.push('retry:condition');
          return true;
        },
        onRetry: () => {
          retryOnRetryCalls += 1;
          events.push('retry:onRetry');
          return true;
        },
        onRetryExhausted: () => {
          retryExhaustedCalls += 1;
          events.push('retry:exhausted');
        },
      },
    });
    stream.on(site, () => {
      events.push(`listener:${site}:start`);
      if (timing === 'listener-entry') issueAbort();
      blockEventLoop(SYNC_OVERRUN_MS);
      if (timing === 'listener-exit') issueAbort();
      events.push(`listener:${site}:end`);
    });
    stream.on('initiated', () => {
      initiatedCalls += 1;
      events.push('facade:initiated');
    });
    stream.on('start', () => {
      startCalls += 1;
      events.push('facade:start');
    });
    for (const eventName of ['end', 'finish', 'done', 'complete'] as const) {
      stream.on(eventName, () => {
        successEvents.push(eventName);
        events.push(`facade:${eventName}`);
      });
    }

    const terminal = new Promise<
      { readonly error: unknown; readonly kind: 'rejected' }
      | { readonly kind: 'fulfilled' }
    >((resolve) => {
      stream.on('error', (error) => {
        errorEvents += 1;
        events.push('facade:error');
        resolve({ error, kind: 'rejected' });
      });
      stream.on('complete', () => {
        resolve({ kind: 'fulfilled' });
      });
    });

    const outcome = await within(terminal, SETTLE_WINDOW_MS, `${timing} caller/total ownership did not settle`);
    await wait(STABILITY_MS);
    const error = outcome.kind === 'rejected' ? outcome.error : undefined;
    const errorObject = Object(error);
    const cause = Reflect.get(errorObject, 'cause');
    const causeObject = Object(cause);
    const causeDescriptor = Object.getOwnPropertyDescriptor(errorObject, 'cause');

    return {
      terminal: outcome.kind,
      error: {
        isRezoError: error instanceof RezoError,
        code: Reflect.get(errorObject, 'code') ?? null,
        errno: Reflect.get(errorObject, 'errno') ?? null,
        phase: Reflect.get(errorObject, 'phase') ?? null,
        isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
        message: Reflect.get(errorObject, 'message') ?? null,
        cause: cause === undefined ? null : {
          name: Reflect.get(causeObject, 'name') ?? null,
          code: Reflect.get(causeObject, 'code') ?? null,
          message: Reflect.get(causeObject, 'message') ?? null,
          ownNonEnumerable: causeDescriptor?.enumerable === false,
        },
      },
      hooks: {
        onAbort: onAbortCount,
        onTimeout: onTimeoutCount,
        beforeError: beforeErrorCount,
      },
      facade: {
        initiatedCalls,
        startCalls,
        errorEvents,
        successEvents,
        isFinished: stream.isFinished(),
      },
      transport: { fetchCalls },
      retry: {
        condition: retryConditionCalls,
        onRetry: retryOnRetryCalls,
        beforeRetry: retryBeforeRetryCalls,
        exhausted: retryExhaustedCalls,
      },
      sequence: {
        listenerReturnedBeforeStart: eventBefore(events, `listener:${site}:end`, 'facade:start'),
        startBeforeAbortHook: eventBefore(events, 'facade:start', 'hook:onAbort'),
        callerBeforeDeadline: eventBefore(events, 'caller:abort', 'timer:total:fired'),
        deadlineBeforeTimeoutHook: eventBefore(events, 'timer:total:fired', 'hook:onTimeout'),
        ownerHookBeforeErrorHook: timing === 'listener-exit'
          ? eventBefore(events, 'hook:onTimeout', 'hook:beforeError')
          : eventBefore(events, 'hook:onAbort', 'hook:beforeError'),
        errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'facade:error'),
      },
      timers: timerProbe.records.map((record) => ({
        fired: record.fired,
        live: record.live,
        clearCalls: record.clearCalls,
      })),
    };
  } finally {
    globalThis.fetch = REAL_FETCH;
    timerProbe.restore();
  }
}

for (const site of ['initiated', 'start'] as const) {
  it(`FP-${site === 'initiated' ? 'T47' : 'T48'} total wins after synchronous ${site} listener overrun`, async () => {
    expect(await observeSynchronousListenerOverrun(site)).toEqual({
      terminal: 'rejected',
      error: {
        isRezoError: true,
        code: 'ECONNABORTED',
        errno: -103,
        phase: 'total',
        elapsedIsValid: true,
        messageMatches: true,
      },
      hooks: {
        onTimeout: 1,
        onTimeoutType: 'request',
        onTimeoutConfigured: TOTAL_DEADLINE_MS,
        onTimeoutElapsedMatchesError: true,
        beforeError: 1,
        onAbort: 0,
      },
      facade: {
        listenerCalls: 1,
        downstreamStartCalls: 0,
        dataEvents: 0,
        errorEvents: 1,
        successEvents: [],
        isFinished: false,
      },
      transport: { fetchCalls: 0 },
      sequence: {
        listenerReturnedBeforeDeadline: true,
        deadlineBeforeTimeoutHook: true,
        timeoutBeforeErrorHook: true,
        errorHookBeforeTerminal: true,
      },
      timers: [{ fired: true, live: false, clearCalls: 1 }],
    });
  }, 5_000);
}

for (const row of [
  { site: 'initiated', timing: 'pre-aborted' },
  { site: 'initiated', timing: 'listener-entry' },
  { site: 'start', timing: 'listener-entry' },
] as const) {
  it(`FP-${row.site === 'initiated' ? 'T47' : 'T48'}/FP-63 caller abort at ${row.timing} remains owner across a later total deadline`, async () => {
    expect(await observeCallerVsTotalAtEmitter(row.site, row.timing)).toEqual({
      terminal: 'rejected',
      error: {
        isRezoError: true,
        code: 'ABORT_ERR',
        errno: -1025,
        phase: null,
        isTimeout: false,
        message: 'Request aborted by signal before dispatch',
        cause: {
          name: 'AbortError',
          code: 'ABORT_ERR',
          message: 'Request aborted by signal before dispatch',
          ownNonEnumerable: true,
        },
      },
      hooks: {
        onAbort: 1,
        onTimeout: 0,
        beforeError: 1,
      },
      facade: {
        initiatedCalls: 1,
        startCalls: 1,
        errorEvents: 1,
        successEvents: [],
        isFinished: false,
      },
      transport: { fetchCalls: 0 },
      retry: {
        condition: 0,
        onRetry: 0,
        beforeRetry: 0,
        exhausted: 0,
      },
      sequence: {
        listenerReturnedBeforeStart: true,
        startBeforeAbortHook: true,
        callerBeforeDeadline: false,
        deadlineBeforeTimeoutHook: false,
        ownerHookBeforeErrorHook: true,
        errorHookBeforeTerminal: true,
      },
      timers: [{ fired: false, live: false, clearCalls: 1 }],
    });
  }, 5_000);
}

it('FP-T48 control: caller abort after the total boundary cannot steal deadline ownership', async () => {
  expect(await observeCallerVsTotalAtEmitter('start', 'listener-exit')).toEqual({
    terminal: 'rejected',
    error: {
      isRezoError: true,
      code: 'ECONNABORTED',
      errno: -103,
      phase: 'total',
      isTimeout: true,
      message: expect.stringMatching(/^Total timeout: Request exceeded maximum duration of \d+ms$/),
      cause: null,
    },
    hooks: {
      onAbort: 0,
      onTimeout: 1,
      beforeError: 1,
    },
    facade: {
      initiatedCalls: 1,
      startCalls: 1,
      errorEvents: 1,
      successEvents: [],
      isFinished: false,
    },
    transport: { fetchCalls: 0 },
    retry: {
      condition: 0,
      onRetry: 0,
      beforeRetry: 0,
      exhausted: 0,
    },
    sequence: {
      listenerReturnedBeforeStart: true,
      startBeforeAbortHook: false,
      callerBeforeDeadline: true,
      deadlineBeforeTimeoutHook: true,
      ownerHookBeforeErrorHook: true,
      errorHookBeforeTerminal: true,
    },
    timers: [{ fired: true, live: false, clearCalls: 1 }],
  });
}, 5_000);

it('control: fast initiated/start listeners retain one successful dispatch and clear the total timer', async () => {
  const events: string[] = [];
  const timerProbe = installDeadlineTimerProbe(events, CONTROL_DEADLINE_MS);
  let fetchCalls = 0;
  let listenerCalls = 0;
  let errorEvents = 0;
  let dataEvents = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push('fetch');
    return new Response(new Uint8Array([0x6f, 0x6b]), {
      status: 200,
      headers: { 'content-length': '2', 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;

  try {
    const stream = fetchRezo.stream('http://fetch-deadline.invalid/event-control', {
      cache: false,
      retry: false,
      timeout: CONTROL_DEADLINE_MS,
    });
    for (const eventName of ['initiated', 'start'] as const) {
      stream.on(eventName, () => {
        listenerCalls += 1;
        events.push(`listener:${eventName}`);
      });
    }
    stream.on('data', () => {
      dataEvents += 1;
      events.push('facade:data');
    });

    const terminal = new Promise<'fulfilled' | 'rejected'>((resolve) => {
      stream.on('error', () => {
        errorEvents += 1;
        events.push('facade:error');
        resolve('rejected');
      });
      stream.on('complete', () => {
        events.push('facade:complete');
        resolve('fulfilled');
      });
    });

    const outcome = await within(terminal, SETTLE_WINDOW_MS, 'fast-listener control did not settle');
    await wait(STABILITY_MS);
    expect({
      outcome,
      listenerCalls,
      fetchCalls,
      dataEvents,
      errorEvents,
      timerRecords: timerProbe.records.map((record) => ({
        fired: record.fired,
        live: record.live,
        clearCalls: record.clearCalls,
      })),
      sequence: {
        initiatedBeforeStart: eventBefore(events, 'listener:initiated', 'listener:start'),
        startBeforeFetch: eventBefore(events, 'listener:start', 'fetch'),
        fetchBeforeComplete: eventBefore(events, 'fetch', 'facade:complete'),
      },
      isFinished: stream.isFinished(),
    }).toEqual({
      outcome: 'fulfilled',
      listenerCalls: 2,
      fetchCalls: 1,
      dataEvents: 1,
      errorEvents: 0,
      timerRecords: [{ fired: false, live: false, clearCalls: 1 }],
      sequence: {
        initiatedBeforeStart: true,
        startBeforeFetch: true,
        fetchBeforeComplete: true,
      },
      isFinished: true,
    });
  } finally {
    globalThis.fetch = REAL_FETCH;
    timerProbe.restore();
  }
}, 5_000);
