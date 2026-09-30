/**
 * Focused RED carrier for Fetch total-deadline ownership while an awaited
 * beforeRedirect hook is pending. A synthetic redirect isolates adapter
 * transaction control from network timing.
 */

import { expect, it } from 'vitest';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const TOTAL_DEADLINE_MS = 40;
const SETTLE_WINDOW_MS = 180;
const CLEANUP_WINDOW_MS = 600;
const STABILITY_MS = 40;
const SYNC_OVERRUN_MS = 90;
const REAL_FETCH = globalThis.fetch;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch redirect deadline harness: ${label}`)), ms);
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
    if (delay !== TOTAL_DEADLINE_MS) return originalSetTimeout(callback, delay, ...args);
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

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

function blockEventLoop(ms: number): void {
  const startedAt = performance.now();
  while (performance.now() - startedAt < ms) {
    // Deliberately occupy this callback turn: a queued timeout cannot run.
  }
}

function requestHeader(request: unknown, name: string): unknown {
  const headers = Reflect.get(Object(request), 'headers');
  const get = Reflect.get(Object(headers), 'get');
  return typeof get === 'function' ? Reflect.apply(get, headers, [name]) : null;
}

it('FP-T19 a pending beforeRedirect hook cannot outlive or mutate past the total deadline', async () => {
  const events: string[] = [];
  const hookGate = createDeferred();
  const timerProbe = installDeadlineTimerProbe(events);
  const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
  let hookConfig: {
    redirectCount?: number;
    redirectHistory?: unknown[];
    finalUrl?: unknown;
    originalRequest?: unknown;
  } | undefined;
  let hookResponseConfig: object | undefined;
  let hookRequest: RezoRequestConfig | undefined;
  let hookRequestBeforeLateMutation: Record<string, unknown> | undefined;
  let hookConfigBeforeLateMutation: Record<string, unknown> | undefined;
  let hookConfigAfterLateMutation: Record<string, unknown> | undefined;
  let lateHookMutationApplied = false;
  let beforeRedirectCount = 0;
  let beforeErrorCount = 0;
  let onAbortCount = 0;
  let fetchCalls = 0;
  let terminalCount = 0;
  let observation: Record<string, unknown> | undefined;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push(`fetch:${String(fetchCalls)}`);
    if (fetchCalls === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://fetch-deadline.invalid/final' },
      });
    }
    return new Response('ok', {
      status: 200,
      headers: { 'content-length': '2', 'content-type': 'text/plain' },
    });
  }) as typeof fetch;

  try {
    const options: RezoRequestConfig = {
      cache: false,
      retry: false,
      timeout: TOTAL_DEADLINE_MS,
      maxRedirects: 3,
      hooks: {
        beforeRedirect: [async (context, config, response) => {
          hookConfig = config;
          hookResponseConfig = response.config;
          hookRequest = context.request;
          hookRequestBeforeLateMutation = {
            fullUrl: context.request.fullUrl,
            url: context.request.url,
            method: context.request.method,
            lateHeader: requestHeader(context.request, 'x-late-hook'),
          };
          hookConfigBeforeLateMutation = {
            redirectCount: config.redirectCount,
            historyLength: config.redirectHistory.length,
            finalUrl: config.finalUrl,
            originalRequest: config.originalRequest,
            responseConfigSame: Object.is(response.config, config),
          };
          beforeRedirectCount += 1;
          events.push('hook:beforeRedirect:start');
          await hookGate.promise;
          context.request.fullUrl = 'http://late-hook.invalid/mutated';
          context.request.url = 'http://late-hook.invalid/mutated';
          context.request.method = 'DELETE';
          const headers = Reflect.get(Object(context.request), 'headers');
          Reflect.apply(Reflect.get(Object(headers), 'set'), headers, ['X-Late-Hook', 'mutated']);
          config.redirectCount = 91;
          config.redirectHistory.push({ lateHookMutation: true } as never);
          response.config.finalUrl = 'http://late-hook.invalid/final';
          response.config.originalRequest = context.request;
          hookConfigAfterLateMutation = {
            redirectCount: config.redirectCount,
            historyLength: config.redirectHistory.length,
            finalUrl: response.config.finalUrl,
            originalRequest: response.config.originalRequest,
          };
          lateHookMutationApplied = true;
          events.push('hook:beforeRedirect:end');
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
      'http://fetch-deadline.invalid/start',
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

    const outcome = beforeCleanup.settled
      ? beforeCleanup.outcome
      : await within(outcomePromise, CLEANUP_WINDOW_MS, 'request did not settle after hook release');
    await wait(STABILITY_MS);

    const error = outcome.kind === 'rejected' ? outcome.error : undefined;
    const errorObject = Object(error);
    const errorRequest = Reflect.get(errorObject, 'request');
    const errorConfig = Reflect.get(errorObject, 'config');
    const errorConfigObject = Object(errorConfig);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const timeoutHook = timeoutHooks[0];
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
        beforeRedirect: beforeRedirectCount,
        onTimeout: timeoutHooks.length,
        onTimeoutType: timeoutHook?.type ?? null,
        onTimeoutConfigured: timeoutHook?.timeout ?? null,
        onTimeoutElapsedMatchesError: timeoutHook?.elapsed === elapsed,
        beforeError: beforeErrorCount,
        onAbort: onAbortCount,
      },
      sequence: {
        hookBeforeDeadline: eventBefore(events, 'hook:beforeRedirect:start', 'timer:total:fired'),
        deadlineBeforeTimeout: eventBefore(events, 'timer:total:fired', 'hook:onTimeout'),
        timeoutBeforeErrorHook: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
        errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'terminal:rejected'),
        terminalBeforeHookRelease: eventBefore(events, 'terminal:rejected', 'hook:beforeRedirect:end'),
      },
      transport: { fetchCalls },
      redirect: {
        count: Reflect.get(errorConfigObject, 'redirectCount') ?? null,
        historyLength: Array.isArray(Reflect.get(errorConfigObject, 'redirectHistory'))
          ? Reflect.get(errorConfigObject, 'redirectHistory').length
          : null,
      },
      lateHook: {
        mutationApplied: lateHookMutationApplied,
        errorRequestPresent: errorRequest !== undefined && errorRequest !== null,
        errorConfigPresent: errorConfig !== undefined && errorConfig !== null,
        detachedFromHookRequest: !Object.is(errorRequest, hookRequest),
        configDetachedFromHookConfig: !Object.is(errorConfig, hookConfig),
        configDetachedFromResponseConfig: !Object.is(errorConfig, hookResponseConfig),
        hookAndResponseConfigSame: Object.is(hookConfig, hookResponseConfig),
        errorOriginalRequestMatchesErrorRequest:
          Object.is(Reflect.get(errorConfigObject, 'originalRequest'), errorRequest),
        fullUrlStable: Reflect.get(Object(errorRequest), 'fullUrl')
          === hookRequestBeforeLateMutation?.fullUrl,
        urlStable: Reflect.get(Object(errorRequest), 'url')
          === hookRequestBeforeLateMutation?.url,
        methodStable: Reflect.get(Object(errorRequest), 'method')
          === hookRequestBeforeLateMutation?.method,
        headerStable: requestHeader(errorRequest, 'x-late-hook')
          === hookRequestBeforeLateMutation?.lateHeader,
        redirectCountStable: Reflect.get(errorConfigObject, 'redirectCount')
          === hookConfigBeforeLateMutation?.redirectCount,
        historyStable: Array.isArray(Reflect.get(errorConfigObject, 'redirectHistory'))
          && Reflect.get(errorConfigObject, 'redirectHistory').length
            === hookConfigBeforeLateMutation?.historyLength,
        finalUrlStable: Reflect.get(errorConfigObject, 'finalUrl')
          === hookConfigBeforeLateMutation?.finalUrl,
        hookRedirectMutationVisible: hookConfigAfterLateMutation?.redirectCount === 91
          && hookConfigAfterLateMutation.historyLength === 1,
        responseConfigMutationVisible:
          hookConfigAfterLateMutation?.finalUrl === 'http://late-hook.invalid/final'
          && Object.is(hookConfigAfterLateMutation.originalRequest, hookRequest),
      },
      timers: timerProbe.records.map((record) => ({
        fired: record.fired,
        live: record.live,
        clearCalls: record.clearCalls,
      })),
    };
  } finally {
    hookGate.release();
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
      beforeRedirect: 1,
      onTimeout: 1,
      onTimeoutType: 'request',
      onTimeoutConfigured: TOTAL_DEADLINE_MS,
      onTimeoutElapsedMatchesError: true,
      beforeError: 1,
      onAbort: 0,
    },
    sequence: {
      hookBeforeDeadline: true,
      deadlineBeforeTimeout: true,
      timeoutBeforeErrorHook: true,
      errorHookBeforeTerminal: true,
      terminalBeforeHookRelease: true,
    },
    transport: { fetchCalls: 1 },
    redirect: { count: 0, historyLength: 0 },
    lateHook: {
      mutationApplied: true,
      errorRequestPresent: true,
      errorConfigPresent: true,
      detachedFromHookRequest: true,
      configDetachedFromHookConfig: true,
      configDetachedFromResponseConfig: true,
      hookAndResponseConfigSame: true,
      errorOriginalRequestMatchesErrorRequest: true,
      fullUrlStable: true,
      urlStable: true,
      methodStable: true,
      headerStable: true,
      redirectCountStable: true,
      historyStable: true,
      finalUrlStable: true,
      hookRedirectMutationVisible: true,
      responseConfigMutationVisible: true,
    },
    timers: [{ fired: true, live: false, clearCalls: 1 }],
  });
}, 5_000);

type SyncRedirectSite = 'hook' | 'legacy-callback';

async function observeSyncRedirectOverrun(site: SyncRedirectSite): Promise<Record<string, unknown>> {
  const events: string[] = [];
  const timerProbe = installDeadlineTimerProbe(events);
  const timeoutHooks: Array<{ type: unknown; timeout: unknown; elapsed: unknown }> = [];
  let beforeErrorCount = 0;
  let onAbortCount = 0;
  let redirectCallbackCount = 0;
  let redirectHookCount = 0;
  let redirectResultReadCount = 0;
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    events.push(`fetch:${String(fetchCalls)}`);
    return fetchCalls === 1
      ? new Response(null, {
        status: 302,
        headers: { location: 'http://fetch-deadline.invalid/final' },
      })
      : new Response('ok', {
        status: 200,
        headers: { 'content-length': '2', 'content-type': 'text/plain' },
      });
  }) as typeof fetch;

  try {
    const options: RezoRequestConfig = {
      cache: false,
      retry: false,
      timeout: TOTAL_DEADLINE_MS,
      maxRedirects: 3,
      beforeRedirect: site === 'legacy-callback'
        ? () => {
          redirectCallbackCount += 1;
          events.push('callback:beforeRedirect:start');
          blockEventLoop(SYNC_OVERRUN_MS);
          events.push('callback:beforeRedirect:end');
          return {
            get redirect(): true {
              redirectResultReadCount += 1;
              return true;
            },
          };
        }
        : () => {
          redirectCallbackCount += 1;
          events.push('callback:afterHook');
          return true;
        },
      hooks: {
        ...(site === 'hook' ? {
          beforeRedirect: [() => {
            redirectHookCount += 1;
            events.push('hook:beforeRedirect:start');
            blockEventLoop(SYNC_OVERRUN_MS);
            events.push('hook:beforeRedirect:end');
          }],
        } : {}),
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

    const outcome = await within(Promise.resolve(fetchRezo.get(
      'http://fetch-deadline.invalid/start',
      options,
    )).then(
      (value) => {
        events.push('terminal:fulfilled');
        return { kind: 'fulfilled' as const, value };
      },
      (error) => {
        events.push('terminal:rejected');
        return { kind: 'rejected' as const, error };
      },
    ), CLEANUP_WINDOW_MS, `${site} synchronous overrun did not settle`);
    await wait(STABILITY_MS);

    const error = outcome.kind === 'rejected' ? outcome.error : undefined;
    const errorObject = Object(error);
    const terminalObject = Object(outcome.kind === 'rejected' ? outcome.error : outcome.value);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const config = Reflect.get(terminalObject, 'config');
    const timeoutHook = timeoutHooks[0];

    return {
      terminal: outcome.kind,
      error: {
        isRezoError: error instanceof RezoError,
        code: Reflect.get(errorObject, 'code') ?? null,
        errno: Reflect.get(errorObject, 'errno') ?? null,
        phase: Reflect.get(errorObject, 'phase') ?? null,
        elapsedIsValid: Number.isInteger(elapsed)
          && (elapsed as number) >= TOTAL_DEADLINE_MS
          && (elapsed as number) < CLEANUP_WINDOW_MS,
        messageMatches: Reflect.get(errorObject, 'message')
          === `Total timeout: Request exceeded maximum duration of ${String(elapsed)}ms`,
      },
      hooks: {
        redirectCallback: redirectCallbackCount,
        redirectHook: redirectHookCount,
        redirectResultReads: redirectResultReadCount,
        onTimeout: timeoutHooks.length,
        onTimeoutType: timeoutHook?.type ?? null,
        onTimeoutConfigured: timeoutHook?.timeout ?? null,
        onTimeoutElapsedMatchesError: timeoutHook?.elapsed === elapsed,
        beforeError: beforeErrorCount,
        onAbort: onAbortCount,
      },
      sequence: {
        callbackReturnedBeforeTimeout: site === 'legacy-callback'
          ? eventBefore(events, 'callback:beforeRedirect:end', 'hook:onTimeout')
          : eventBefore(events, 'hook:beforeRedirect:end', 'hook:onTimeout'),
        timeoutBeforeErrorHook: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
        errorHookBeforeTerminal: eventBefore(events, 'hook:beforeError', 'terminal:rejected'),
      },
      transport: { fetchCalls },
      state: {
        configPresent: config !== undefined && config !== null,
        redirectCount: Reflect.get(Object(config), 'redirectCount') ?? null,
        historyLength: Array.isArray(Reflect.get(Object(config), 'redirectHistory'))
          ? Reflect.get(Object(config), 'redirectHistory').length
          : null,
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

for (const site of ['hook', 'legacy-callback'] as const) {
  it(`deadline wins after synchronous ${site} redirect overrun`, async () => {
    expect(await observeSyncRedirectOverrun(site)).toEqual({
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
        redirectCallback: site === 'legacy-callback' ? 1 : 0,
        redirectHook: site === 'hook' ? 1 : 0,
        redirectResultReads: 0,
        onTimeout: 1,
        onTimeoutType: 'request',
        onTimeoutConfigured: TOTAL_DEADLINE_MS,
        onTimeoutElapsedMatchesError: true,
        beforeError: 1,
        onAbort: 0,
      },
      sequence: {
        callbackReturnedBeforeTimeout: true,
        timeoutBeforeErrorHook: true,
        errorHookBeforeTerminal: true,
      },
      transport: { fetchCalls: 1 },
      state: {
        configPresent: true,
        redirectCount: 0,
        historyLength: 0,
      },
      timers: [{ fired: true, live: false, clearCalls: 1 }],
    });
  }, 5_000);
}

it('control: a legacy redirect thenable return is inspected synchronously, not assimilated', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return fetchCalls === 1
      ? new Response(null, {
        status: 302,
        headers: { location: 'http://fetch-deadline.invalid/final' },
      })
      : new Response('ok', { status: 200 });
  }) as typeof fetch;

  try {
    const outcome = await within(Promise.resolve(fetchRezo.get(
      'http://fetch-deadline.invalid/start',
      {
        cache: false,
        retry: false,
        beforeRedirect: () => Promise.resolve(true) as never,
      },
    )).then(
      (value) => ({ kind: 'fulfilled' as const, value }),
      (error) => ({ kind: 'rejected' as const, error }),
    ), CLEANUP_WINDOW_MS, 'legacy thenable return was assimilated');
    const error = outcome.kind === 'rejected' ? outcome.error : undefined;
    const errorObject = Object(error);
    const config = Reflect.get(errorObject, 'config');
    expect({
      kind: outcome.kind,
      isRezoError: error instanceof RezoError,
      code: Reflect.get(errorObject, 'code') ?? null,
      fetchCalls,
      redirectCount: Reflect.get(Object(config), 'redirectCount') ?? null,
      historyLength: Array.isArray(Reflect.get(Object(config), 'redirectHistory'))
        ? Reflect.get(Object(config), 'redirectHistory').length
        : null,
    }).toEqual({
      kind: 'rejected',
      isRezoError: true,
      code: 'REZ_REDIRECT_DENIED',
      fetchCalls: 1,
      redirectCount: 0,
      historyLength: 0,
    });
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
}, 5_000);
