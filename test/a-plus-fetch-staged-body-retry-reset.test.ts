/**
 * Focused RED carrier for Fetch's per-attempt staged body deadline.
 *
 * Both physical responses expose headers but zero body bytes. The first body
 * timeout is therefore eligible for the configured retry; the second attempt
 * must own a fresh timer and produce the final timeout independently.
 */

import { describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const BODY_DEADLINE_MS = 300;
const PRE_RELEASE_WINDOW_MS = 1_100;
const CLEANUP_WINDOW_MS = 1_000;
const STABILITY_MS = 60;
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch staged-body RED harness: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
  }
}

interface HeldBodyWire {
  url: string;
  hits(): number;
  release(): void;
  destroyConnections(): void;
  resources(): { listening: boolean; sockets: number };
  close(): Promise<void>;
}

async function startHeldBodyWire(): Promise<HeldBodyWire> {
  let hits = 0;
  const held = new Set<http.ServerResponse>();
  const sockets = new Set<Socket>();
  const server = http.createServer((request, response) => {
    hits += 1;
    request.on('error', () => undefined);
    response.on('error', () => undefined);
    request.resume();

    held.add(response);
    response.once('close', () => held.delete(response));
    response.writeHead(200, {
      'content-length': '8',
      'content-type': 'application/octet-stream',
    });
    response.flushHeaders();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('error', () => undefined);

  await within(new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  }), CLEANUP_WINDOW_MS, 'fixture did not listen');

  const release = (): void => {
    for (const response of held) {
      if (response.destroyed || response.writableEnded) continue;
      try {
        response.end('complete');
      } catch {
        // A correct product deadline may already have closed the peer.
      }
    }
  };
  const destroyConnections = (): void => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections?.();
  };

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/staged-body-retry`,
    hits: () => hits,
    release,
    destroyConnections,
    resources: () => ({ listening: server.listening, sockets: sockets.size }),
    close: async () => {
      release();
      destroyConnections();
      if (server.listening) {
        await within(
          new Promise<void>((resolve) => { server.close(() => resolve()); }),
          CLEANUP_WINDOW_MS,
          'fixture did not close',
        );
      }
      await wait(0);
    },
  };
}

interface TimerRecord {
  ordinal: number;
  delay: number;
  handle: ReturnType<typeof setTimeout>;
  fired: boolean;
  live: boolean;
  clearCalls: number;
  firstClearAt: number | null;
}

function installBodyTimerProbe(events: string[]): {
  records: TimerRecord[];
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRandom = Math.random;
  const records: TimerRecord[] = [];

  Math.random = () => 0.5;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== BODY_DEADLINE_MS) return originalSetTimeout(callback, delay, ...args);

    const ordinal = records.length + 1;
    let record: TimerRecord;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      events.push(`timer:body:${ordinal}:fired`);
      callback(...callbackArgs);
    }, delay, ...args);
    record = {
      ordinal,
      delay,
      handle,
      fired: false,
      live: true,
      clearCalls: 0,
      firstClearAt: null,
    };
    records.push(record);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    const record = records.find((candidate) => candidate.handle === handle);
    if (record !== undefined) {
      record.clearCalls += 1;
      record.live = false;
      if (record.firstClearAt === null) {
        record.firstClearAt = events.push(`timer:body:${record.ordinal}:cleared`) - 1;
      }
    }
    originalClearTimeout(handle);
  }) as unknown as typeof clearTimeout;

  return {
    records,
    restore(): void {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      Math.random = originalRandom;
      for (const record of records) if (record.live) originalClearTimeout(record.handle);
    },
  };
}

interface Outcome {
  kind: 'fulfilled' | 'rejected';
  value?: unknown;
  error?: unknown;
}

interface TimeoutHookFact {
  type: unknown;
  timeout: unknown;
  elapsed: unknown;
}

interface RetryFact {
  attempt: unknown;
  delay: unknown;
  code: unknown;
  phase: unknown;
}

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

function bodyTimeoutMessageMatches(elapsed: unknown, message: unknown): boolean {
  return Number.isInteger(elapsed)
    && message === `Body timeout: Response body transfer stalled for ${elapsed}ms`;
}

async function runPerAttemptBodyDeadline(): Promise<Record<string, unknown>> {
  const wire = await startHeldBodyWire();
  const events: string[] = [];
  const timeoutHooks: TimeoutHookFact[] = [];
  const retryFacts: RetryFact[] = [];
  const beforeRetryFacts: Array<{ attempt: unknown; code: unknown; phase: unknown }> = [];
  const abortReasons: unknown[] = [];
  let beforeErrorCount = 0;
  let terminalCount = 0;
  const timerProbe = installBodyTimerProbe(events);
  let observation: Record<string, unknown> | undefined;

  try {
    const requestOptions: RezoRequestConfig = {
      cache: false,
      hooks: {
        onTimeout: [(event) => {
          timeoutHooks.push({ type: event.type, timeout: event.timeout, elapsed: event.elapsed });
          events.push(`hook:onTimeout:${timeoutHooks.length}`);
        }],
        onAbort: [(event) => {
          abortReasons.push(event.reason);
          events.push('hook:onAbort');
        }],
        beforeRetry: [(_config, error, attempt) => {
          beforeRetryFacts.push({ attempt, code: error.code, phase: Reflect.get(error, 'phase') });
          events.push('hook:beforeRetry:1');
        }],
        beforeError: [(error) => {
          beforeErrorCount += 1;
          events.push('hook:beforeError');
          return error;
        }],
      },
      responseType: 'buffer',
      retry: {
        maxRetries: 1,
        retryDelay: 0,
        backoff: 1,
        retryOnTimeout: true,
        onRetry: (error, attempt, delay) => {
          retryFacts.push({
            attempt,
            delay,
            code: Reflect.get(Object(error), 'code'),
            phase: Reflect.get(Object(error), 'phase'),
          });
          events.push('retry:onRetry:1');
        },
      },
      timeout: { body: BODY_DEADLINE_MS },
    };
    const signalOwnProperty = Object.prototype.hasOwnProperty.call(requestOptions, 'signal');

    let dispatch: Promise<unknown>;
    try {
      dispatch = Promise.resolve(fetchRezo.get(wire.url, requestOptions));
    } catch (error) {
      dispatch = Promise.reject(error);
    }
    const outcomePromise: Promise<Outcome> = dispatch.then(
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

    const first = await Promise.race([
      outcomePromise.then((outcome) => ({ settled: true as const, outcome })),
      wait(PRE_RELEASE_WINDOW_MS).then(() => ({ settled: false as const })),
    ]);
    const settledBeforeRelease = first.settled;
    const hitsBeforeRelease = wire.hits();
    wire.release();

    let outcome: Outcome;
    if (first.settled) {
      outcome = first.outcome;
    } else {
      const afterRelease = await Promise.race([
        outcomePromise.then((value) => ({ settled: true as const, value })),
        wait(CLEANUP_WINDOW_MS).then(() => ({ settled: false as const })),
      ]);
      if (afterRelease.settled) outcome = afterRelease.value;
      else {
        wire.destroyConnections();
        outcome = await within(outcomePromise, CLEANUP_WINDOW_MS, 'request remained pending after fixture release');
      }
    }
    await wait(STABILITY_MS);

    const error = outcome.error;
    const errorObject = Object(error);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const errorConfig = Object(Reflect.get(errorObject, 'config'));
    const terminalEvent = outcome.kind === 'rejected' ? 'terminal:rejected' : 'terminal:fulfilled';
    const terminalAt = events.indexOf(terminalEvent);
    const timerFacts = timerProbe.records.map((record) => ({
      ordinal: record.ordinal,
      delay: record.delay,
      fired: record.fired,
      clearCalls: record.clearCalls,
      live: record.live,
      clearedBeforeTerminal: record.firstClearAt !== null && terminalAt > record.firstClearAt,
    }));

    observation = {
      id: 'FP-T32',
      signalOwnProperty,
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
        elapsedWithinAttemptWindow: typeof elapsed === 'number' && elapsed < PRE_RELEASE_WINDOW_MS,
        messageMatchesElapsed: bodyTimeoutMessageMatches(elapsed, Reflect.get(errorObject, 'message')),
        isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
        isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
        isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
        hasResponse: Reflect.get(errorObject, 'response') !== undefined && Reflect.get(errorObject, 'response') !== null,
        status: Reflect.get(errorObject, 'status') ?? null,
        retryAttempts: Reflect.get(errorConfig, 'retryAttempts') ?? null,
      },
      hooks: {
        onTimeoutCount: timeoutHooks.length,
        onTimeoutTypes: timeoutHooks.map((fact) => fact.type),
        onTimeoutConfigured: timeoutHooks.map((fact) => fact.timeout),
        onTimeoutElapsedIntegers: timeoutHooks.map((fact) => Number.isInteger(fact.elapsed)),
        onTimeoutElapsedAtLeastBudget: timeoutHooks.map(
          (fact) => typeof fact.elapsed === 'number' && fact.elapsed >= BODY_DEADLINE_MS,
        ),
        finalTimeoutElapsedMatchesError: timeoutHooks.at(-1)?.elapsed === elapsed,
        onRetryCount: retryFacts.length,
        retryFacts,
        beforeRetryCount: beforeRetryFacts.length,
        beforeRetryFacts,
        beforeErrorCount,
        onAbortCount: abortReasons.length,
        abortReasons,
      },
      sequence: {
        firstTimerBeforeFirstTimeout: eventBefore(events, 'timer:body:1:fired', 'hook:onTimeout:1'),
        firstTimeoutBeforeRetry: eventBefore(events, 'hook:onTimeout:1', 'retry:onRetry:1'),
        retryBeforeBeforeRetry: eventBefore(events, 'retry:onRetry:1', 'hook:beforeRetry:1'),
        beforeRetryBeforeSecondTimer: eventBefore(events, 'hook:beforeRetry:1', 'timer:body:2:fired'),
        secondTimerBeforeSecondTimeout: eventBefore(events, 'timer:body:2:fired', 'hook:onTimeout:2'),
        secondTimeoutBeforeError: eventBefore(events, 'hook:onTimeout:2', 'hook:beforeError'),
        errorBeforeTerminal: eventBefore(events, 'hook:beforeError', terminalEvent),
      },
      wire: { hitsBeforeRelease },
      timers: {
        body: timerFacts,
        live: timerProbe.records.filter((record) => record.live).length,
      },
      events,
    };
  } finally {
    timerProbe.restore();
    await wire.close();
  }

  return { ...observation, resourcesAfter: wire.resources() };
}

describe('Fetch staged body deadline resets per physical retry attempt', () => {
  it('FP-T32 re-arms a zero-byte body timeout once, then publishes the second timeout', async () => {
    const observation = await runPerAttemptBodyDeadline();

    expect(observation).toMatchObject({
      id: 'FP-T32',
      signalOwnProperty: false,
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
        elapsedWithinAttemptWindow: true,
        messageMatchesElapsed: true,
        isTimeout: true,
        isRetryable: true,
        isNetworkError: false,
        hasResponse: false,
        status: null,
        retryAttempts: 1,
      },
      hooks: {
        onTimeoutCount: 2,
        onTimeoutTypes: ['response', 'response'],
        onTimeoutConfigured: [BODY_DEADLINE_MS, BODY_DEADLINE_MS],
        onTimeoutElapsedIntegers: [true, true],
        onTimeoutElapsedAtLeastBudget: [true, true],
        finalTimeoutElapsedMatchesError: true,
        onRetryCount: 1,
        retryFacts: [{ attempt: 1, delay: 0, code: 'ESOCKETTIMEDOUT', phase: 'body' }],
        beforeRetryCount: 1,
        beforeRetryFacts: [{ attempt: 1, code: 'ESOCKETTIMEDOUT', phase: 'body' }],
        beforeErrorCount: 1,
        onAbortCount: 0,
        abortReasons: [],
      },
      sequence: {
        firstTimerBeforeFirstTimeout: true,
        firstTimeoutBeforeRetry: true,
        retryBeforeBeforeRetry: true,
        beforeRetryBeforeSecondTimer: true,
        secondTimerBeforeSecondTimeout: true,
        secondTimeoutBeforeError: true,
        errorBeforeTerminal: true,
      },
      wire: { hitsBeforeRelease: 2 },
      timers: {
        body: [
          { ordinal: 1, delay: BODY_DEADLINE_MS, fired: true, clearCalls: 1, live: false, clearedBeforeTerminal: true },
          { ordinal: 2, delay: BODY_DEADLINE_MS, fired: true, clearCalls: 1, live: false, clearedBeforeTerminal: true },
        ],
        live: 0,
      },
      resourcesAfter: { listening: false, sockets: 0 },
    });
  }, 5_000);
});
