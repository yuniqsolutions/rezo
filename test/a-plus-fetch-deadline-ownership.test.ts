/**
 * Focused RED carrier for Fetch's no-caller-signal deadline ownership.
 *
 * These four rows deliberately avoid the frozen parity carrier: a missing
 * signature must never be able to masquerade as the product failure under
 * test. Each fixture is held beyond the configured deadline, then released
 * only as bounded cleanup when the product has not settled on its own.
 */

import { describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import fetchRezo, { RezoError, type RezoRequestConfig } from '../src/adapters/entries/fetch';

const DEADLINE_MS = 300;
const RETRY_DELAY_MS = 1_000;
const SETTLE_WINDOW_MS = 900;
const CLEANUP_WINDOW_MS = 1_000;
const STABILITY_MS = 60;

type RowId = 'FP-T01' | 'FP-T05' | 'FP-T09' | 'FP-T25';
type WireMode = 'hold-headers' | 'hold-body' | 'status-503';
type TimeoutValue = number | { headers: number };

interface RowSpec {
  id: RowId;
  title: string;
  wire: WireMode;
  timeout: TimeoutValue;
  code: 'ECONNABORTED' | 'ESOCKETTIMEDOUT';
  errno: -103 | -1073;
  phase: 'total' | 'headers';
  timeoutType: 'request' | 'response';
  retry: boolean;
}

const ROWS: readonly RowSpec[] = Object.freeze([
  { id: 'FP-T01', title: 'numeric total owns held dispatch', wire: 'hold-headers', timeout: DEADLINE_MS, code: 'ECONNABORTED', errno: -103, phase: 'total', timeoutType: 'request', retry: false },
  { id: 'FP-T05', title: 'numeric total owns held buffered body', wire: 'hold-body', timeout: DEADLINE_MS, code: 'ECONNABORTED', errno: -103, phase: 'total', timeoutType: 'request', retry: false },
  { id: 'FP-T09', title: 'numeric total owns the 503 retry delay', wire: 'status-503', timeout: DEADLINE_MS, code: 'ECONNABORTED', errno: -103, phase: 'total', timeoutType: 'request', retry: true },
  { id: 'FP-T25', title: 'staged headers owns held dispatch', wire: 'hold-headers', timeout: { headers: DEADLINE_MS }, code: 'ESOCKETTIMEDOUT', errno: -1073, phase: 'headers', timeoutType: 'response', retry: false },
]);

interface DeadlineWire {
  url: string;
  hits(): number;
  release(): void;
  destroyConnections(): void;
  close(): Promise<void>;
  resources(): { listening: boolean; sockets: number };
}

const REAL_SET_TIMEOUT = globalThis.setTimeout;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { REAL_SET_TIMEOUT(resolve, ms); });
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    guard = REAL_SET_TIMEOUT(() => reject(new Error(`Fetch deadline RED harness: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
  }
}

async function startWire(mode: WireMode): Promise<DeadlineWire> {
  let hits = 0;
  const held = new Set<http.ServerResponse>();
  const sockets = new Set<Socket>();
  const server = http.createServer((request, response) => {
    hits += 1;
    request.on('error', () => undefined);
    response.on('error', () => undefined);
    request.resume();

    if (mode === 'status-503') {
      response.writeHead(503, { 'content-length': '0', 'content-type': 'application/octet-stream' });
      response.end();
      return;
    }

    held.add(response);
    response.once('close', () => held.delete(response));
    if (mode === 'hold-body') {
      response.writeHead(200, { 'content-length': '8', 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      response.write('part');
    }
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
  }), CLEANUP_WINDOW_MS, `${mode} fixture did not listen`);

  const release = (): void => {
    for (const response of held) {
      if (response.destroyed || response.writableEnded) continue;
      try {
        if (!response.headersSent) response.writeHead(200, { 'content-length': '0', 'content-type': 'application/octet-stream' });
        else response.write('tail');
        response.end();
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
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/deadline`,
    hits: () => hits,
    release,
    destroyConnections,
    resources: () => ({ listening: server.listening, sockets: sockets.size }),
    close: async () => {
      release();
      destroyConnections();
      if (server.listening) {
        await within(new Promise<void>((resolve) => { server.close(() => resolve()); }), CLEANUP_WINDOW_MS, `${mode} fixture did not close`);
      }
      await wait(0);
    },
  };
}

type TimerKind = 'deadline' | 'retry-delay';
type TimerHandle = ReturnType<typeof setTimeout>;

interface TimerRecord {
  kind: TimerKind;
  delay: number;
  handle: TimerHandle;
  fired: boolean;
  live: boolean;
  clearCalls: number;
  firedAt: number | null;
  firstClearAt: number | null;
}

function installTimerProbe(events: string[]): {
  records: TimerRecord[];
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRandom = Math.random;
  const records: TimerRecord[] = [];

  Math.random = () => 0.5;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const kind: TimerKind | undefined = delay === DEADLINE_MS ? 'deadline' : delay === RETRY_DELAY_MS ? 'retry-delay' : undefined;
    if (kind === undefined) return originalSetTimeout(callback, delay, ...args);

    let record: TimerRecord;
    const handle = originalSetTimeout((...callbackArgs: unknown[]) => {
      record.fired = true;
      record.live = false;
      record.firedAt = events.push(`timer:${kind}:fired`) - 1;
      callback(...callbackArgs);
    }, delay, ...args);
    record = { kind, delay: delay!, handle, fired: false, live: true, clearCalls: 0, firedAt: null, firstClearAt: null };
    records.push(record);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    const record = records.find((candidate) => candidate.handle === handle);
    if (record !== undefined) {
      record.clearCalls += 1;
      record.live = false;
      if (record.firstClearAt === null) record.firstClearAt = events.push(`timer:${record.kind}:cleared`) - 1;
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

function eventBefore(events: readonly string[], first: string, second: string): boolean {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}

function timeoutMessageMatches(phase: RowSpec['phase'], elapsed: unknown, message: unknown): boolean {
  if (!Number.isInteger(elapsed)) return false;
  const expected = phase === 'total'
    ? `Total timeout: Request exceeded maximum duration of ${elapsed}ms`
    : `Headers timeout: Server did not send response headers within ${elapsed}ms`;
  return message === expected;
}

async function runRow(spec: RowSpec): Promise<Record<string, unknown>> {
  const wire = await startWire(spec.wire);
  const events: string[] = [];
  const timeoutHooks: TimeoutHookFact[] = [];
  const abortReasons: unknown[] = [];
  let beforeErrorCount = 0;
  let terminalCount = 0;
  const timerProbe = installTimerProbe(events);
  let observation: Record<string, unknown> | undefined;

  try {
    const requestOptions: RezoRequestConfig = {
      cache: false,
      hooks: {
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
      responseType: 'buffer',
      retry: spec.retry ? { maxRetries: 1, retryDelay: RETRY_DELAY_MS, statusCodes: [503] } : false,
      timeout: spec.timeout,
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
      wait(SETTLE_WINDOW_MS).then(() => ({ settled: false as const })),
    ]);
    const settledBeforeRelease = first.settled;
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
        outcome = await within(outcomePromise, CLEANUP_WINDOW_MS, `${spec.id} remained pending after fixture release`);
      }
    }
    await wait(STABILITY_MS);

    const error = outcome.error;
    const errorObject = Object(error);
    const elapsed = Reflect.get(errorObject, 'elapsed');
    const timeoutHook = timeoutHooks[0];
    const terminalEvent = outcome.kind === 'rejected' ? 'terminal:rejected' : 'terminal:fulfilled';
    const terminalAt = events.indexOf(terminalEvent);
    const timerFacts = (kind: TimerKind) => timerProbe.records
      .filter((record) => record.kind === kind)
      .map((record) => ({
        delay: record.delay,
        fired: record.fired,
        clearCalls: record.clearCalls,
        live: record.live,
        clearedBeforeTerminal: record.firstClearAt !== null && terminalAt > record.firstClearAt,
      }));

    observation = {
      id: spec.id,
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
        elapsedAtLeastBudget: typeof elapsed === 'number' && elapsed >= DEADLINE_MS,
        elapsedWithinWindow: typeof elapsed === 'number' && elapsed < SETTLE_WINDOW_MS,
        messageMatchesElapsed: timeoutMessageMatches(spec.phase, elapsed, Reflect.get(errorObject, 'message')),
        isTimeout: Reflect.get(errorObject, 'isTimeout') ?? null,
        isRetryable: Reflect.get(errorObject, 'isRetryable') ?? null,
        isNetworkError: Reflect.get(errorObject, 'isNetworkError') ?? null,
        hasResponse: Reflect.get(errorObject, 'response') !== undefined && Reflect.get(errorObject, 'response') !== null,
        status: Reflect.get(errorObject, 'status') ?? null,
      },
      hooks: {
        onTimeoutCount: timeoutHooks.length,
        onTimeoutType: timeoutHook?.type ?? null,
        onTimeoutConfigured: timeoutHook?.timeout ?? null,
        onTimeoutElapsedMatchesError: timeoutHook !== undefined && timeoutHook.elapsed === elapsed,
        beforeErrorCount,
        onAbortCount: abortReasons.length,
        abortReasons,
      },
      sequence: {
        timeoutBeforeError: eventBefore(events, 'hook:onTimeout', 'hook:beforeError'),
        errorBeforeTerminal: eventBefore(events, 'hook:beforeError', terminalEvent),
      },
      wire: { hits: wire.hits() },
      timers: {
        deadline: timerFacts('deadline'),
        retryDelay: timerFacts('retry-delay'),
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

function expectedRow(spec: RowSpec): Record<string, unknown> {
  const deadlineTimer = [{ delay: DEADLINE_MS, fired: true, clearCalls: 1, live: false, clearedBeforeTerminal: true }];
  const retryDelay = spec.retry
    ? [{ delay: RETRY_DELAY_MS, fired: false, clearCalls: 1, live: false, clearedBeforeTerminal: true }]
    : [];
  return {
    id: spec.id,
    signalOwnProperty: false,
    terminal: { kind: 'rejected', count: 1, settledBeforeRelease: true },
    error: {
      name: 'RezoError',
      isRezoError: true,
      code: spec.code,
      errno: spec.errno,
      phase: spec.phase,
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
      onTimeoutCount: 1,
      onTimeoutType: spec.timeoutType,
      onTimeoutConfigured: DEADLINE_MS,
      onTimeoutElapsedMatchesError: true,
      beforeErrorCount: 1,
      onAbortCount: 0,
      abortReasons: [],
    },
    sequence: { timeoutBeforeError: true, errorBeforeTerminal: true },
    wire: { hits: 1 },
    timers: { deadline: deadlineTimer, retryDelay, live: 0 },
    resourcesAfter: { listening: false, sockets: 0 },
  };
}

describe('Fetch logical deadline ownership without a caller signal', () => {
  for (const spec of ROWS) {
    it(`${spec.id} ${spec.title}`, async () => {
      const observation = await runRow(spec);
      expect(observation).toMatchObject(expectedRow(spec));
    }, 5_000);
  }
});
