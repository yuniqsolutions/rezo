/**
 * A+ React Native Phase 5 provider-factory exact-current RED carrier.
 *
 * Tier-C evidence only: Fetch, Expo FileSystem, react-native-fs, NetInfo,
 * Expo BackgroundTask, and Expo TaskManager are injected doubles. Nothing in
 * this file earns Metro, Hermes, JSC, Expo, RNFS, NetInfo, device, filesystem,
 * or operating-system background-task credit.
 */

import { afterAll, beforeAll, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createExpoBackgroundTaskProvider,
  createExpoFileSystemAdapter,
  createFetchStreamTransport,
  createNetInfoProvider,
  createReactNativeFsAdapter,
} from '../src/platform/react-native-providers.js';
import type {
  ExpoFileSystemFileLike,
  FetchStreamReaderResultLike,
  ReactNativeFsDownloadOptionsLike,
} from '../src/platform/react-native-providers.js';
import type {
  RezoReactNativeFileDownloadHeadersEvent,
  RezoReactNativeFileDownloadProgressEvent,
  RezoReactNativeFileUploadProgressEvent,
  RezoReactNativeStreamHeadersEvent,
  RezoReactNativeStreamProgressEvent,
} from '../src/types/react-native.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER_PATH = fileURLToPath(import.meta.url);
const PROVIDER_PATH = resolve(REPO_ROOT, 'src/platform/react-native-providers.ts');
const TYPES_PATH = resolve(REPO_ROOT, 'src/types/react-native.ts');
const PINNED_PROVIDER_SHA256 = '79fa5dd41d2db2386b811559e3429891636ea34e4c937db2e25214544d76bbbf';
const PINNED_TYPES_SHA256 = '02e904681abe67ad5b3f08750edc9490d6bb6dcee54f3340e2fc9e2668fb884f';

const PROMPT_WINDOW_MS = 25;
const LATE_WINDOW_MS = 25;
const HARNESS_TIMEOUT_MS = 1_500;

const REGISTERED = [
  'RV-01', 'RV-02', 'RV-03', 'RV-04', 'RV-05',
  'RV-06', 'RV-07', 'RV-08', 'RV-09', 'RV-10',
] as const;

type RowId = (typeof REGISTERED)[number];

const EXPECTED_RED: readonly RowId[] = [];

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface PromiseProbe<T> {
  readonly state: {
    outcome: 'pending' | 'fulfilled' | 'rejected';
    value: T | undefined;
    reason: unknown;
  };
  readonly settled: Promise<void>;
}

interface RowResult {
  readonly actual: unknown;
  readonly desired: unknown;
  readonly desiredPass: boolean;
  readonly currentSignature: boolean;
}

interface SignalAudit {
  readonly added: number;
  readonly removed: number;
  readonly live: number;
  readonly events: readonly string[];
  restore(): void;
}

interface RowContext {
  auditSignal(signal: AbortSignal): SignalAudit;
}

interface TimerAudit {
  readonly live: Set<ReturnType<typeof setTimeout>>;
  restore(): void;
  dispose(): void;
}

interface RowObservation {
  readonly actual: unknown;
  readonly desired: unknown;
  readonly desiredPass: boolean;
  readonly currentSignature: boolean;
  readonly timers: number;
  readonly listeners: {
    readonly added: number;
    readonly removed: number;
    readonly live: number;
  };
  readonly unhandled: string[];
}

const invocations = new Map<RowId, number>();
const observations = new Map<RowId, RowObservation>();
const actualRed = new Set<RowId>();
const passed = new Set<RowId>();
const fixtureErrors: string[] = [];
const oracleMismatches: string[] = [];
const cleanupErrors: string[] = [];
const unhandledRejections: unknown[] = [];

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`RN Phase 5 provider carrier infrastructure invalidity: ${message}`);
    this.name = 'InfrastructureError';
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const OPENING = Object.freeze({
  providerSha256: sha256(PROVIDER_PATH),
  typesSha256: sha256(TYPES_PATH),
  carrierSha256: sha256(CARRIER_PATH),
});

if (OPENING.providerSha256 !== PINNED_PROVIDER_SHA256) {
  throw new InfrastructureError(
    `provider actual ${OPENING.providerSha256} expected ${PINNED_PROVIDER_SHA256}`,
  );
}
if (OPENING.typesSha256 !== PINNED_TYPES_SHA256) {
  throw new InfrastructureError(
    `types actual ${OPENING.typesSha256} expected ${PINNED_TYPES_SHA256}`,
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>['resolve'];
  let rejectPromise!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function probePromise<T>(promise: Promise<T>): PromiseProbe<T> {
  const state: PromiseProbe<T>['state'] = {
    outcome: 'pending',
    value: undefined,
    reason: undefined,
  };
  const settled = promise.then(
    (value) => {
      state.outcome = 'fulfilled';
      state.value = value;
    },
    (reason: unknown) => {
      state.outcome = 'rejected';
      state.reason = reason;
    },
  );
  return { state, settled };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new InfrastructureError(`${label} exceeded ${HARNESS_TIMEOUT_MS}ms`));
        }, HARNESS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= HARNESS_TIMEOUT_MS) {
      throw new InfrastructureError(label);
    }
    await delay(2);
  }
}

function installTimerAudit(): TimerAudit {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const live = new Set<ReturnType<typeof setTimeout>>();

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    let handle: ReturnType<typeof setTimeout>;
    const wrapped = () => {
      live.delete(handle);
      if (typeof handler === 'function') {
        (handler as (...values: unknown[]) => void)(...args);
      }
    };
    handle = nativeSetTimeout(wrapped, timeout);
    live.add(handle);
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    if (handle !== undefined) live.delete(handle as ReturnType<typeof setTimeout>);
    nativeClearTimeout(handle);
  }) as typeof clearTimeout;

  return {
    live,
    restore() {
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
    },
    dispose() {
      for (const handle of live) nativeClearTimeout(handle);
      live.clear();
    },
  };
}

function installSignalAudit(signal: AbortSignal): SignalAudit {
  const nativeAdd = signal.addEventListener.bind(signal);
  const nativeRemove = signal.removeEventListener.bind(signal);
  const wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
  const live = new Set<EventListenerOrEventListenerObject>();
  const events: string[] = [];
  let added = 0;
  let removed = 0;

  Object.defineProperty(signal, 'addEventListener', {
    configurable: true,
    value(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
      if (type !== 'abort' || listener === null) {
        nativeAdd(type, listener, options);
        return;
      }
      added += 1;
      events.push('add');
      live.add(listener);
      const once = typeof options === 'object' && options?.once === true;
      const delegate: EventListener = (event) => {
        events.push('fire');
        if (once) live.delete(listener);
        if (typeof listener === 'function') listener.call(signal, event);
        else listener.handleEvent(event);
      };
      wrapped.set(listener, delegate);
      nativeAdd(type, delegate, options);
    },
  });
  Object.defineProperty(signal, 'removeEventListener', {
    configurable: true,
    value(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
      if (type === 'abort' && listener !== null) {
        removed += 1;
        events.push('remove');
        live.delete(listener);
        nativeRemove(type, wrapped.get(listener) ?? listener, options);
        wrapped.delete(listener);
        return;
      }
      nativeRemove(type, listener, options);
    },
  });

  return {
    get added() { return added; },
    get removed() { return removed; },
    get live() { return live.size; },
    get events() { return [...events]; },
    restore() {
      for (const [listener, delegate] of wrapped) {
        nativeRemove('abort', delegate);
        live.delete(listener);
      }
      wrapped.clear();
      Reflect.deleteProperty(signal, 'addEventListener');
      Reflect.deleteProperty(signal, 'removeEventListener');
    },
  };
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null) {
    const message = Reflect.get(value, 'message');
    if (typeof message === 'string') return message;
  }
  return String(value);
}

function valueStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const status = Reflect.get(value, 'status');
  return typeof status === 'number' ? status : null;
}

function valueString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? field : null;
}

function errorShape(value: unknown): { name: string; code: string | null; message: string } {
  const name = value instanceof Error ? value.name : typeof value;
  const code = typeof value === 'object' && value !== null && typeof Reflect.get(value, 'code') === 'string'
    ? String(Reflect.get(value, 'code'))
    : null;
  return { name, code, message: errorMessage(value) };
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error
    && value.name === 'AbortError'
    && value.message.toLowerCase().includes('abort');
}

function isInvalidExpoUploadResultError(
  value: unknown,
  category: 'missing-result' | 'invalid-status',
): boolean {
  if (!(value instanceof Error)) return false;
  const message = value.message.toLowerCase();
  if (!message.includes('expo') || !message.includes('upload')) return false;
  return category === 'missing-result'
    ? message.includes('result') && (message.includes('missing') || message.includes('absent'))
    : message.includes('status') && message.includes('invalid');
}

function isUnsupportedBackgroundMetadataError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  const shape = errorShape(value);
  if (shape.code === 'REZ_UNSUPPORTED_CAPABILITY') return true;
  const message = shape.message.toLowerCase();
  return message.includes('background')
    && message.includes('metadata')
    && (message.includes('unsupported') || message.includes('refused'));
}

function signalWasCleanlyObserved(audit: SignalAudit): boolean {
  const events = JSON.stringify(audit.events);
  return audit.added === 1
    && audit.live === 0
    && (events === '["add","fire"]' || events === '["add","fire","remove"]');
}

function hasStructuredRetainedPartialDisposition(
  value: unknown,
  expectedPath: string,
  expectedBytes: number,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const nestedCandidates = ['partialFile', 'partialOutput', 'retainedPartial'].flatMap((key) => {
    const candidate = Reflect.get(value, key);
    return typeof candidate === 'object' && candidate !== null ? [candidate] : [];
  });
  for (const candidate of [value, ...nestedCandidates]) {
    const path = ['partialFilePath', 'partialPath', 'filePath', 'path', 'uri']
      .map((key) => Reflect.get(candidate, key))
      .find((entry) => typeof entry === 'string');
    const bytes = ['partialBytes', 'bytesWritten', 'size', 'byteLength']
      .map((key) => Reflect.get(candidate, key))
      .find((entry) => typeof entry === 'number');
    const marker = Reflect.get(candidate, 'partial') === true
      || Reflect.get(candidate, 'retained') === true
      || Reflect.get(candidate, 'partialRetained') === true
      || Reflect.get(candidate, 'disposition') === 'retained'
      || Reflect.get(candidate, 'state') === 'retained-partial';
    if (path === expectedPath && bytes === expectedBytes && marker) return true;
  }
  return false;
}

function logicalRow(
  id: RowId,
  title: string,
  operation: (context: RowContext) => Promise<RowResult>,
): void {
  it(`${id} ${title}`, async () => {
    invocations.set(id, (invocations.get(id) ?? 0) + 1);
    const timerAudit = installTimerAudit();
    const signalAudits: SignalAudit[] = [];
    const unhandledStart = unhandledRejections.length;
    const context: RowContext = {
      auditSignal(signal) {
        const audit = installSignalAudit(signal);
        signalAudits.push(audit);
        return audit;
      },
    };
    let result: RowResult | undefined;
    let operationError: unknown;
    let operationCompleted = false;
    let timerResidue = 0;
    let listenerSummary = { added: 0, removed: 0, live: 0 };

    try {
      result = await withWatchdog(operation(context), `${id} operation`);
      await delay(LATE_WINDOW_MS);
      operationCompleted = true;
    } catch (error) {
      fixtureErrors.push(`${id}:${describeUnknown(error)}`);
      operationError = error;
    } finally {
      listenerSummary = signalAudits.reduce(
        (summary, audit) => ({
          added: summary.added + audit.added,
          removed: summary.removed + audit.removed,
          live: summary.live + audit.live,
        }),
        { added: 0, removed: 0, live: 0 },
      );
      for (const audit of signalAudits) audit.restore();
      timerAudit.restore();
      timerResidue = timerAudit.live.size;
      if (timerResidue > 0) {
        cleanupErrors.push(`${id}:timers:${timerResidue}`);
        timerAudit.dispose();
      }
      if (listenerSummary.live > 0) {
        cleanupErrors.push(`${id}:listeners:${listenerSummary.live}`);
      }
    }

    if (!operationCompleted || result === undefined) throw operationError;
    const unhandled = unhandledRejections.slice(unhandledStart).map(describeUnknown);
    const observation: RowObservation = {
      actual: result.actual,
      desired: result.desired,
      desiredPass: result.desiredPass,
      currentSignature: result.currentSignature,
      timers: timerResidue,
      listeners: listenerSummary,
      unhandled,
    };
    observations.set(id, observation);

    if (result.desiredPass && timerResidue === 0 && listenerSummary.live === 0 && unhandled.length === 0) {
      passed.add(id);
      return;
    }
    if (!EXPECTED_RED.includes(id)) {
      oracleMismatches.push(`${id}:unexpected-failure`);
      throw new Error(`${id} unexpected failure: ${JSON.stringify(observation)}`);
    }
    if (!result.currentSignature) {
      oracleMismatches.push(`${id}:current-signature-moved`);
      throw new Error(`${id} current signature moved: ${JSON.stringify(observation)}`);
    }
    actualRed.add(id);
    throw new Error(`${id} expected RED: ${JSON.stringify(observation)}`);
  }, HARNESS_TIMEOUT_MS + 1_000);
}

function onUnhandledRejection(reason: unknown): void {
  unhandledRejections.push(reason);
}

beforeAll(() => {
  process.on('unhandledRejection', onUnhandledRejection);
});

logicalRow('RV-01', 'Fetch stream preserves request, metadata, chunks, progress, and reader release', async () => {
  const signal = new AbortController().signal;
  const requestBody = 'request-body';
  const fetchCalls: Array<{ input: string; init: RequestInit | undefined }> = [];
  const headers: RezoReactNativeStreamHeadersEvent[] = [];
  const chunks: number[][] = [];
  const progress: RezoReactNativeStreamProgressEvent[] = [];
  let reads = 0;
  let releases = 0;
  const values = [new Uint8Array([1, 2]), new Uint8Array([3])];
  const transport = createFetchStreamTransport(async (input, init) => {
    fetchCalls.push({ input: String(input), init });
    return {
      status: 206,
      statusText: 'Partial Content',
      url: 'https://provider.rezo.test/final',
      headers: {
        *entries() {
          yield ['content-type', 'application/octet-stream'] as [string, string];
          yield ['content-length', '3'] as [string, string];
          yield ['x-provider', 'fetch-stream'] as [string, string];
        },
      },
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              const value = values.shift();
              return value ? { done: false, value } : { done: true };
            },
            releaseLock() { releases += 1; },
          };
        },
      },
    };
  }, { name: 'rv-fetch' });

  const result = await transport.stream({
    url: 'https://provider.rezo.test/start',
    method: 'POST',
    headers: { accept: 'application/octet-stream' },
    body: requestBody,
    signal,
    onHeaders(event) { headers.push(event); },
    onChunk(chunk) {
      if (typeof chunk === 'string') throw new InfrastructureError('RV-01 received string chunk');
      chunks.push(Array.from(chunk));
    },
    onProgress(event) { progress.push(event); },
  });

  const actual = {
    transportName: transport.name,
    fetchCalls: fetchCalls.map((call) => ({
      input: call.input,
      method: call.init?.method,
      headers: call.init?.headers,
      bodyIdentity: call.init?.body === requestBody,
      signalIdentity: call.init?.signal === signal,
      redirect: call.init?.redirect,
    })),
    headers,
    chunks,
    loaded: progress.map((event) => event.loaded),
    totals: progress.map((event) => event.total),
    reads,
    releases,
    result,
  };
  const desiredPass = transport.name === 'rv-fetch'
    && fetchCalls.length === 1
    && fetchCalls[0]?.input === 'https://provider.rezo.test/start'
    && fetchCalls[0]?.init?.method === 'POST'
    && fetchCalls[0]?.init?.body === requestBody
    && fetchCalls[0]?.init?.signal === signal
    && fetchCalls[0]?.init?.redirect === 'manual'
    && JSON.stringify(fetchCalls[0]?.init?.headers) === JSON.stringify({ accept: 'application/octet-stream' })
    && headers.length === 1
    && headers[0]?.status === 206
    && headers[0]?.statusText === 'Partial Content'
    && headers[0]?.finalUrl === 'https://provider.rezo.test/final'
    && headers[0]?.contentType === 'application/octet-stream'
    && headers[0]?.contentLength === 3
    && JSON.stringify(headers[0]?.headers) === JSON.stringify({
      'content-type': 'application/octet-stream',
      'content-length': '3',
      'x-provider': 'fetch-stream',
    })
    && JSON.stringify(chunks) === '[[1,2],[3]]'
    && JSON.stringify(progress.map((event) => event.loaded)) === '[2,3]'
    && JSON.stringify(progress.map((event) => event.total)) === '[3,3]'
    && progress.every((event, index) => index === 0 || event.loaded > (progress[index - 1]?.loaded ?? -1))
    && reads === 3
    && releases === 1
    && result.status === 206
    && result.finalUrl === 'https://provider.rezo.test/final'
    && result.contentType === 'application/octet-stream'
    && result.contentLength === 3;
  return {
    actual,
    desired: 'one exact manual Fetch dispatch; truthful metadata; chunks [1,2],[3]; loaded 2,3; one release',
    desiredPass,
    currentSignature: desiredPass,
  };
});

logicalRow('RV-02', 'Fetch stream preserves DataView and Uint16Array subview byte ranges', async () => {
  const firstBuffer = Uint8Array.from([90, 10, 11, 91]).buffer;
  const secondBuffer = Uint8Array.from([92, 93, 12, 13, 94, 95]).buffer;
  const values: Array<DataView | Uint16Array> = [
    new DataView(firstBuffer, 1, 2),
    new Uint16Array(secondBuffer, 2, 1),
  ];
  const chunks: number[][] = [];
  let releases = 0;
  const transport = createFetchStreamTransport(async () => ({
    status: 200,
    headers: { *entries() { yield ['content-length', '4'] as [string, string]; } },
    body: {
      getReader() {
        return {
          async read() {
            const value = values.shift();
            return value ? { done: false, value } : { done: true };
          },
          releaseLock() { releases += 1; },
        };
      },
    },
  }));
  await transport.stream({
    url: 'https://provider.rezo.test/subviews',
    method: 'GET',
    headers: {},
    onChunk(chunk) {
      if (typeof chunk === 'string') throw new InfrastructureError('RV-02 received string chunk');
      chunks.push(Array.from(chunk));
    },
  });
  const actual = { chunks, releases };
  const desiredPass = JSON.stringify(chunks) === '[[10,11],[12,13]]' && releases === 1;
  return {
    actual,
    desired: { chunks: [[10, 11], [12, 13]], releases: 1 },
    desiredPass,
    currentSignature: desiredPass,
  };
});

logicalRow('RV-03', 'Fetch string chunks use UTF-8 byte counts for loaded and speed', async () => {
  const nativeNow = Date.now;
  let nowCalls = 0;
  Date.now = () => (nowCalls++ === 0 ? 1_000 : 1_001);
  try {
    const values: Array<string | undefined> = ['é'];
    const chunks: Array<string | number[]> = [];
    const progress: RezoReactNativeStreamProgressEvent[] = [];
    const transport = createFetchStreamTransport(async () => ({
      status: 200,
      headers: { *entries() { yield ['content-length', '2'] as [string, string]; } },
      body: {
        getReader() {
          return {
            async read() {
              const value = values.shift();
              return value === undefined ? { done: true } : { done: false, value };
            },
          };
        },
      },
    }));
    await transport.stream({
      url: 'https://provider.rezo.test/utf8',
      method: 'GET',
      headers: {},
      onChunk(chunk) { chunks.push(typeof chunk === 'string' ? chunk : Array.from(chunk)); },
      onProgress(event) { progress.push(event); },
    });
    const actual = {
      chunks,
      loaded: progress.map((event) => event.loaded),
      speed: progress.map((event) => event.speed),
      averageSpeed: progress.map((event) => event.averageSpeed),
      total: progress.map((event) => event.total),
    };
    const desiredPass = JSON.stringify(actual) === JSON.stringify({
      chunks: ['é'], loaded: [2], speed: [2_000], averageSpeed: [2_000], total: [2],
    });
    return {
      actual,
      desired: { chunks: ['é'], loaded: [2], speed: [2_000], averageSpeed: [2_000], total: [2] },
      desiredPass,
      currentSignature: JSON.stringify(actual) === JSON.stringify({
        chunks: ['é'], loaded: [1], speed: [1_000], averageSpeed: [1_000], total: [2],
      }),
    };
  } finally {
    Date.now = nativeNow;
  }
});

logicalRow('RV-04', 'Fetch reader honors pre-abort and cancels/quarantines mid-abort', async (context) => {
  const preController = new AbortController();
  const preAudit = context.auditSignal(preController.signal);
  preController.abort();
  let preReads = 0;
  let preCancels = 0;
  let preReleases = 0;
  const preTransport = createFetchStreamTransport(async () => ({
    status: 200,
    headers: { *entries() {} },
    body: {
      getReader() {
        return {
          async read() { preReads += 1; return { done: true }; },
          async cancel() { preCancels += 1; },
          releaseLock() { preReleases += 1; },
        };
      },
    },
  }));
  const preProbe = probePromise(preTransport.stream({
    url: 'https://provider.rezo.test/pre-abort',
    method: 'GET',
    headers: {},
    signal: preController.signal,
  }));
  await preProbe.settled;

  const midController = new AbortController();
  const midAudit = context.auditSignal(midController.signal);
  const pendingRead = createDeferred<FetchStreamReaderResultLike>();
  let midReads = 0;
  let midCancels = 0;
  let midReleases = 0;
  const midChunks: number[][] = [];
  const midProgress: number[] = [];
  const midTransport = createFetchStreamTransport(async () => ({
    status: 200,
    headers: { *entries() { yield ['content-length', '2'] as [string, string]; } },
    body: {
      getReader() {
        return {
          async read() {
            midReads += 1;
            if (midReads === 1) return { done: false, value: new Uint8Array([1]) };
            if (midReads === 2) return pendingRead.promise;
            return { done: true };
          },
          async cancel() { midCancels += 1; },
          releaseLock() { midReleases += 1; },
        };
      },
    },
  }));
  const midProbe = probePromise(midTransport.stream({
    url: 'https://provider.rezo.test/mid-abort',
    method: 'GET',
    headers: {},
    signal: midController.signal,
    onChunk(chunk) {
      if (typeof chunk === 'string') throw new InfrastructureError('RV-04 received string chunk');
      midChunks.push(Array.from(chunk));
    },
    onProgress(event) { midProgress.push(event.loaded); },
  }));
  await waitFor(() => midReads === 2, 'RV-04 never entered the pending read');
  midController.abort();
  await delay(PROMPT_WINDOW_MS);
  const pendingBeforeLateRead = midProbe.state.outcome === 'pending';
  pendingRead.resolve({ done: false, value: new Uint8Array([9]) });
  await midProbe.settled;
  await delay(LATE_WINDOW_MS);

  const syncDispatchController = new AbortController();
  const syncDispatchAudit = context.auditSignal(syncDispatchController.signal);
  const syncDispatchSentinel = new Error('rv04-fetch-dispatch-sync');
  let syncDispatches = 0;
  let syncDispatchCallbacks = 0;
  const syncDispatchTransport = createFetchStreamTransport(() => {
    syncDispatches += 1;
    syncDispatchController.abort();
    throw syncDispatchSentinel;
  });
  const syncDispatchProbe = probePromise(syncDispatchTransport.stream({
    url: 'https://provider.rezo.test/sync-dispatch-abort',
    method: 'GET',
    headers: {},
    signal: syncDispatchController.signal,
    onHeaders() { syncDispatchCallbacks += 1; },
    onChunk() { syncDispatchCallbacks += 1; },
    onProgress() { syncDispatchCallbacks += 1; },
  }));
  await syncDispatchProbe.settled;

  const syncReaderController = new AbortController();
  const syncReaderAudit = context.auditSignal(syncReaderController.signal);
  const syncReaderSentinel = new Error('rv04-get-reader-sync');
  let syncReaderAcquisitions = 0;
  let syncReaderCallbacks = 0;
  const syncReaderTransport = createFetchStreamTransport(async () => ({
    status: 200,
    headers: { *entries() { yield ['content-length', '1'] as [string, string]; } },
    body: {
      getReader() {
        syncReaderAcquisitions += 1;
        syncReaderController.abort();
        throw syncReaderSentinel;
      },
    },
  }));
  const syncReaderProbe = probePromise(syncReaderTransport.stream({
    url: 'https://provider.rezo.test/sync-reader-abort',
    method: 'GET',
    headers: {},
    signal: syncReaderController.signal,
    onHeaders() { syncReaderCallbacks += 1; },
    onChunk() { syncReaderCallbacks += 1; },
    onProgress() { syncReaderCallbacks += 1; },
  }));
  await syncReaderProbe.settled;

  const actual = {
    pre: {
      outcome: preProbe.state.outcome,
      reads: preReads,
      cancels: preCancels,
      releases: preReleases,
      listener: { added: preAudit.added, removed: preAudit.removed, live: preAudit.live },
    },
    mid: {
      pendingBeforeLateRead,
      outcome: midProbe.state.outcome,
      reads: midReads,
      cancels: midCancels,
      releases: midReleases,
      chunks: midChunks,
      loaded: midProgress,
      listener: { added: midAudit.added, removed: midAudit.removed, live: midAudit.live },
    },
    syncAuthority: {
      dispatch: {
        outcome: syncDispatchProbe.state.outcome,
        reason: errorShape(syncDispatchProbe.state.reason),
        leakedSentinel: syncDispatchProbe.state.reason === syncDispatchSentinel,
        dispatches: syncDispatches,
        callbacks: syncDispatchCallbacks,
        listener: {
          added: syncDispatchAudit.added,
          removed: syncDispatchAudit.removed,
          live: syncDispatchAudit.live,
          events: syncDispatchAudit.events,
        },
      },
      reader: {
        outcome: syncReaderProbe.state.outcome,
        reason: errorShape(syncReaderProbe.state.reason),
        leakedSentinel: syncReaderProbe.state.reason === syncReaderSentinel,
        acquisitions: syncReaderAcquisitions,
        callbacks: syncReaderCallbacks,
        listener: {
          added: syncReaderAudit.added,
          removed: syncReaderAudit.removed,
          live: syncReaderAudit.live,
          events: syncReaderAudit.events,
        },
      },
    },
  };
  const desiredPass = preProbe.state.outcome === 'rejected'
    && preReads === 0
    && !pendingBeforeLateRead
    && midProbe.state.outcome === 'rejected'
    && midReads === 2
    && midCancels === 1
    && midReleases === 1
    && JSON.stringify(midChunks) === '[[1]]'
    && JSON.stringify(midProgress) === '[1]'
    && preAudit.live === 0
    && midAudit.live === 0
    && syncDispatchProbe.state.outcome === 'rejected'
    && isAbortError(syncDispatchProbe.state.reason)
    && syncDispatchProbe.state.reason !== syncDispatchSentinel
    && syncDispatches === 1
    && syncDispatchCallbacks === 0
    && signalWasCleanlyObserved(syncDispatchAudit)
    && syncReaderProbe.state.outcome === 'rejected'
    && isAbortError(syncReaderProbe.state.reason)
    && syncReaderProbe.state.reason !== syncReaderSentinel
    && syncReaderAcquisitions === 1
    && syncReaderCallbacks === 0
    && signalWasCleanlyObserved(syncReaderAudit);
  const currentSignature = preProbe.state.outcome === 'fulfilled'
    && preReads === 1
    && preCancels === 0
    && preReleases === 1
    && pendingBeforeLateRead
    && midProbe.state.outcome === 'fulfilled'
    && midReads === 3
    && midCancels === 0
    && midReleases === 1
    && JSON.stringify(midChunks) === '[[1],[9]]'
    && JSON.stringify(midProgress) === '[1,2]';
  return {
    actual,
    desired: 'pre-abort rejects before read; mid-abort rejects promptly, cancels/releases once, and publishes no late chunk/progress; reentrant Fetch/getReader aborts remain authoritative over synchronous throws',
    desiredPass,
    currentSignature,
  };
});

logicalRow('RV-05', 'Fetch unreadable bodies refuse before public metadata callbacks', async () => {
  const expectedMessage = 'Configured RN stream transport requires a readable response body. Use `expo/fetch` or another fetch implementation that exposes `response.body.getReader()`.';
  const observationsByBody: Array<{
    body: string;
    dispatches: number;
    dispatchedUrl: string | null;
    outcome: string;
    reason: { name: string; code: string | null; message: string };
    message: string;
    headers: number;
    chunks: number;
    progress: number;
  }> = [];
  for (const variant of [
    { name: 'null', body: null },
    { name: 'unreadable', body: {} },
  ] as const) {
    let fetchDispatches = 0;
    let dispatchedUrl: string | null = null;
    let headerCalls = 0;
    let chunkCalls = 0;
    let progressCalls = 0;
    const transport = createFetchStreamTransport(async (input) => {
      fetchDispatches += 1;
      dispatchedUrl = String(input);
      return {
        status: 200,
        headers: { *entries() { yield ['content-type', 'text/plain'] as [string, string]; } },
        body: variant.body as never,
      };
    });
    const probe = probePromise(transport.stream({
      url: `https://provider.rezo.test/${variant.name}`,
      method: 'GET',
      headers: {},
      onHeaders() { headerCalls += 1; },
      onChunk() { chunkCalls += 1; },
      onProgress() { progressCalls += 1; },
    }));
    await probe.settled;
    observationsByBody.push({
      body: variant.name,
      dispatches: fetchDispatches,
      dispatchedUrl,
      outcome: probe.state.outcome,
      reason: errorShape(probe.state.reason),
      message: errorMessage(probe.state.reason),
      headers: headerCalls,
      chunks: chunkCalls,
      progress: progressCalls,
    });
  }
  const desiredPass = observationsByBody.every((entry) => (
    entry.dispatches === 1
    && entry.dispatchedUrl === `https://provider.rezo.test/${entry.body}`
    && entry.outcome === 'rejected'
    && entry.reason.name === 'Error'
    && entry.reason.code === null
    && entry.message === expectedMessage
    && entry.headers === 0
    && entry.chunks === 0
    && entry.progress === 0
  ));
  const currentSignature = observationsByBody.every((entry) => (
    entry.dispatches === 1
    && entry.dispatchedUrl === `https://provider.rezo.test/${entry.body}`
    && entry.outcome === 'rejected'
    && entry.reason.name === 'Error'
    && entry.reason.code === null
    && entry.message === expectedMessage
    && entry.headers === 1
    && entry.chunks === 0
    && entry.progress === 0
  ));
  return {
    actual: observationsByBody,
    desired: 'one matching Fetch dispatch per body; exact unreadable-body Error; refusal before headers/chunks/progress',
    desiredPass,
    currentSignature,
  };
});

logicalRow('RV-06', 'Expo capabilities and unsupported download/upload shapes are honest', async () => {
  let downloadDispatches = 0;
  let topLevelUploadDispatches = 0;
  class MockFile {
    constructor(readonly path: string) {}
  }
  const expoModule = Object.assign({
    File: Object.assign(MockFile, {
      async downloadFileAsync() {
        downloadDispatches += 1;
        return {};
      },
    }),
  }, {
    createUploadTask() { topLevelUploadDispatches += 1; },
    FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
  });
  const adapter = createExpoFileSystemAdapter(expoModule);
  const methodProbe = probePromise(adapter.downloadFile!({
    url: 'https://provider.rezo.test/expo-method',
    destination: '/tmp/rv06-method.bin',
    method: 'POST',
    headers: {},
  }));
  const bodyProbe = probePromise(adapter.downloadFile!({
    url: 'https://provider.rezo.test/expo-body',
    destination: '/tmp/rv06-body.bin',
    method: 'GET',
    headers: {},
    body: 'not-supported',
  }));
  await Promise.all([methodProbe.settled, bodyProbe.settled]);
  const actual = {
    capabilities: adapter.capabilities,
    uploadMethod: typeof adapter.uploadFile,
    method: { outcome: methodProbe.state.outcome, message: errorMessage(methodProbe.state.reason) },
    body: { outcome: bodyProbe.state.outcome, message: errorMessage(bodyProbe.state.reason) },
    downloadDispatches,
    topLevelUploadDispatches,
  };
  const desiredPass = JSON.stringify(adapter.capabilities) === JSON.stringify({
    fileDownload: true,
    downloadProgress: false,
    uploadFromFile: false,
    uploadProgress: false,
    backgroundTasks: false,
  })
    && adapter.uploadFile === undefined
    && methodProbe.state.outcome === 'rejected'
    && bodyProbe.state.outcome === 'rejected'
    && errorMessage(methodProbe.state.reason).includes('only support GET requests without a request body')
    && errorMessage(bodyProbe.state.reason).includes('only support GET requests without a request body')
    && downloadDispatches === 0
    && topLevelUploadDispatches === 0;
  return {
    actual,
    desired: 'download-only flags; no false progress/upload capability; method/body refusal before dispatch',
    desiredPass,
    currentSignature: desiredPass,
  };
});

logicalRow('RV-07', 'Expo download cancellation suppresses metadata/success and handles partial output', async (context) => {
  let positiveDispatches = 0;
  class PositiveMockFile {
    uri?: string;
    size?: number;
    type?: string;
    constructor(readonly path: string) {}
  }
  const positiveAdapter = createExpoFileSystemAdapter({
    File: Object.assign(PositiveMockFile, {
      async downloadFileAsync(_url: string, destination: PositiveMockFile) {
        positiveDispatches += 1;
        destination.uri = 'file:///tmp/rv07-positive.bin';
        destination.size = 5;
        destination.type = 'application/octet-stream';
        return destination;
      },
    }),
  });
  const positiveHeaders: RezoReactNativeFileDownloadHeadersEvent[] = [];
  const positiveProgress: RezoReactNativeFileDownloadProgressEvent[] = [];
  const positiveResult = await positiveAdapter.downloadFile!({
    url: 'https://provider.rezo.test/expo-positive-download',
    destination: '/tmp/rv07-positive.bin',
    method: 'GET',
    headers: { accept: 'application/octet-stream' },
    onHeaders(event) { positiveHeaders.push(event); },
    onProgress(event) { positiveProgress.push(event); },
  });
  const positive = {
    dispatches: positiveDispatches,
    headers: positiveHeaders,
    progress: positiveProgress,
    result: positiveResult,
  };
  const positivePass = positiveDispatches === 1
    && JSON.stringify(positiveHeaders) === JSON.stringify([{
      status: 200,
      statusText: 'OK',
      finalUrl: 'https://provider.rezo.test/expo-positive-download',
      contentLength: 5,
    }])
    && JSON.stringify(positiveProgress) === JSON.stringify([{
      loaded: 5,
      total: 5,
      averageSpeed: 0,
      speed: 0,
      estimatedTime: 0,
    }])
    && JSON.stringify(positiveResult) === JSON.stringify({
      status: 200,
      statusText: 'OK',
      finalUrl: 'https://provider.rezo.test/expo-positive-download',
      contentType: 'application/octet-stream',
      contentLength: 5,
      filePath: 'file:///tmp/rv07-positive.bin',
      fileSize: 5,
    });

  const syncController = new AbortController();
  const syncAudit = context.auditSignal(syncController.signal);
  const syncSentinel = new Error('rv07-expo-download-sync');
  let syncDispatches = 0;
  let syncCallbacks = 0;
  let syncForwardedSignal: unknown;
  class SyncMockFile {
    constructor(readonly path: string) {}
  }
  const syncAdapter = createExpoFileSystemAdapter({
    File: Object.assign(SyncMockFile, {
      downloadFileAsync(_url: string, _destination: SyncMockFile, options: unknown) {
        syncDispatches += 1;
        syncForwardedSignal = typeof options === 'object' && options !== null
          ? Reflect.get(options, 'signal')
          : undefined;
        syncController.abort();
        throw syncSentinel;
      },
    }),
  });
  const syncProbe = probePromise(syncAdapter.downloadFile!({
    url: 'https://provider.rezo.test/expo-sync-download',
    destination: '/tmp/rv07-sync.bin',
    method: 'GET',
    headers: {},
    signal: syncController.signal,
    onHeaders() { syncCallbacks += 1; },
    onProgress() { syncCallbacks += 1; },
  }));
  await syncProbe.settled;

  const deferred = createDeferred<ExpoFileSystemFileLike>();
  const destinationPath = '/tmp/rv07.partial';
  const partialUri = 'file:///tmp/rv07.partial';
  const lifecycle: string[] = [];
  let clock = 0;
  let dispatches = 0;
  let deleteCalls = 0;
  let abortAt = 0;
  let rejectedAt = 0;
  let fulfilledAt = 0;
  let forwardedSignal: unknown;
  const partialState = {
    exists: false,
    bytes: 0,
    establishedAt: 0,
    deletedAt: 0,
  };
  let destinationFile: MockFile | undefined;
  class MockFile {
    uri = partialUri;
    size = 0;
    exists = false;
    constructor(readonly path: string) { destinationFile = this; }
    async delete() {
      lifecycle.push('delete');
      deleteCalls += 1;
      this.exists = false;
      this.size = 0;
      partialState.exists = false;
      partialState.bytes = 0;
      partialState.deletedAt = ++clock;
    }
  }
  const adapter = createExpoFileSystemAdapter({
    File: Object.assign(MockFile, {
      downloadFileAsync(_url: string, destination: MockFile, options: unknown) {
        lifecycle.push('dispatch');
        dispatches += 1;
        forwardedSignal = typeof options === 'object' && options !== null
          ? Reflect.get(options, 'signal')
          : undefined;
        if (destination !== destinationFile || destination.path !== destinationPath) {
          throw new InfrastructureError('RV-07 destination identity moved');
        }
        destination.exists = true;
        destination.size = 2;
        partialState.exists = true;
        partialState.bytes = 2;
        partialState.establishedAt = ++clock;
        lifecycle.push('partial-established');
        return deferred.promise;
      },
    }),
  });
  const controller = new AbortController();
  const signalAudit = context.auditSignal(controller.signal);
  const headers: RezoReactNativeFileDownloadHeadersEvent[] = [];
  const progress: RezoReactNativeFileDownloadProgressEvent[] = [];
  const publicPromise = adapter.downloadFile!({
    url: 'https://provider.rezo.test/expo-download',
    destination: destinationPath,
    method: 'GET',
    headers: {},
    signal: controller.signal,
    onHeaders(event) { lifecycle.push('headers'); headers.push(event); },
    onProgress(event) { lifecycle.push('progress'); progress.push(event); },
  });
  const probe = probePromise(publicPromise);
  void publicPromise.then(
    () => { lifecycle.push('fulfilled'); fulfilledAt = ++clock; },
    () => { lifecycle.push('rejected'); rejectedAt = ++clock; },
  );
  await waitFor(() => dispatches === 1, 'RV-07 Expo download did not dispatch');
  if (!partialState.exists || partialState.bytes !== 2 || partialState.establishedAt === 0) {
    throw new InfrastructureError('RV-07 did not independently establish two partial bytes');
  }
  lifecycle.push('abort');
  abortAt = ++clock;
  controller.abort();
  await delay(PROMPT_WINDOW_MS);
  const pendingBeforeLateResult = probe.state.outcome === 'pending';
  lifecycle.push('late-result');
  deferred.resolve(destinationFile ?? { uri: partialUri, size: 2, exists: true });
  await probe.settled;
  await delay(LATE_WINDOW_MS);
  const retainedDisposition = hasStructuredRetainedPartialDisposition(
    probe.state.reason,
    destinationPath,
    2,
  ) || hasStructuredRetainedPartialDisposition(probe.state.reason, partialUri, 2);
  const deletedBeforeRejection = deleteCalls === 1
    && !partialState.exists
    && partialState.bytes === 0
    && partialState.deletedAt > abortAt
    && rejectedAt > partialState.deletedAt;
  const retainedBeforeRejection = partialState.exists
    && partialState.bytes === 2
    && partialState.establishedAt < abortAt
    && rejectedAt > abortAt
    && retainedDisposition;
  const actual = {
    positive,
    syncAuthority: {
      outcome: syncProbe.state.outcome,
      reason: errorShape(syncProbe.state.reason),
      leakedSentinel: syncProbe.state.reason === syncSentinel,
      dispatches: syncDispatches,
      callbacks: syncCallbacks,
      forwardedSignalIdentity: syncForwardedSignal === syncController.signal,
      listener: {
        added: syncAudit.added,
        removed: syncAudit.removed,
        live: syncAudit.live,
        events: syncAudit.events,
      },
    },
    dispatches,
    forwardedSignalIdentity: forwardedSignal === controller.signal,
    lifecycle,
    partialState,
    abortAt,
    rejectedAt,
    fulfilledAt,
    pendingBeforeLateResult,
    outcome: probe.state.outcome,
    result: {
      status: valueStatus(probe.state.value),
      filePath: valueString(probe.state.value, 'filePath'),
    },
    headers: headers.map((event) => event.status),
    progress: progress.map((event) => event.loaded),
    deleteCalls,
    retainedDisposition,
    deletedBeforeRejection,
    retainedBeforeRejection,
    listener: {
      added: signalAudit.added,
      removed: signalAudit.removed,
      live: signalAudit.live,
      events: signalAudit.events,
    },
  };
  const desiredPass = positivePass
    && syncProbe.state.outcome === 'rejected'
    && isAbortError(syncProbe.state.reason)
    && syncProbe.state.reason !== syncSentinel
    && syncDispatches === 1
    && syncCallbacks === 0
    && syncForwardedSignal === syncController.signal
    && signalWasCleanlyObserved(syncAudit)
    && !pendingBeforeLateResult
    && probe.state.outcome === 'rejected'
    && dispatches === 1
    && headers.length === 0
    && progress.length === 0
    && forwardedSignal === controller.signal
    && (deletedBeforeRejection || retainedBeforeRejection)
    && signalWasCleanlyObserved(signalAudit);
  const currentSignature = positivePass
    && pendingBeforeLateResult
    && probe.state.outcome === 'fulfilled'
    && dispatches === 1
    && valueStatus(probe.state.value) === 200
    && valueString(probe.state.value, 'filePath') === partialUri
    && JSON.stringify(headers.map((event) => event.status)) === '[200]'
    && JSON.stringify(progress.map((event) => event.loaded)) === '[2]'
    && deleteCalls === 0
    && partialState.exists
    && partialState.bytes === 2
    && !retainedDisposition
    && !deletedBeforeRejection
    && !retainedBeforeRejection
    && rejectedAt === 0
    && fulfilledAt > abortAt
    && signalAudit.added === 0
    && signalAudit.removed === 0
    && signalAudit.live === 0
    && JSON.stringify(signalAudit.events) === '[]'
    && JSON.stringify(lifecycle) === JSON.stringify([
      'dispatch', 'partial-established', 'abort', 'late-result', 'headers', 'progress', 'fulfilled',
    ]);
  return {
    actual,
    desired: 'valid Expo download dispatches once with truthful 200 metadata/progress/result; exact caller signal reaches native options; reentrant abort dominates synchronous acquisition failure; cancelled download rejects promptly without post-abort metadata/success, handles witnessed partial, and cleans its listener',
    desiredPass,
    currentSignature,
  };
});

logicalRow('RV-08', 'Expo upload rejects absent/zero status and quarantines abort-late work', async (context) => {
  class MockFile {
    constructor(readonly path: string) {}
  }
  let happyTaskCreations = 0;
  let happyUploadDispatches = 0;
  let happyCancelCalls = 0;
  const happyHeaders: RezoReactNativeFileDownloadHeadersEvent[] = [];
  const happyProgress: RezoReactNativeFileUploadProgressEvent[] = [];
  const happyAdapter = createExpoFileSystemAdapter({
    File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
  }, {
    uploadTaskModule: {
      createUploadTask(_url, _fileUri, _options, callback) {
        happyTaskCreations += 1;
        return {
          async uploadAsync() {
            happyUploadDispatches += 1;
            callback?.({ totalBytesSent: 4, totalBytesExpectedToSend: 8 });
            callback?.({ totalBytesSent: 8, totalBytesExpectedToSend: 8 });
            return {
              status: 201,
              headers: {
                'content-type': 'application/json',
                'content-length': '11',
                'x-provider': 'expo-upload',
              },
              body: '{"ok":true}',
            };
          },
          async cancelAsync() { happyCancelCalls += 1; },
        };
      },
      FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
    },
  });
  const happyResult = await happyAdapter.uploadFile!({
    url: 'https://provider.rezo.test/expo-positive-upload',
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    file: {
      uri: 'file:///tmp/rv08-happy.bin',
      name: 'rv08-happy.bin',
      type: 'application/octet-stream',
      size: 8,
    },
    onHeaders(event) { happyHeaders.push(event); },
    onProgress(event) { happyProgress.push(event); },
  });
  const happy = {
    taskCreations: happyTaskCreations,
    uploadDispatches: happyUploadDispatches,
    cancelCalls: happyCancelCalls,
    headers: happyHeaders,
    progress: happyProgress.map((event) => [event.loaded, event.total]),
    result: happyResult,
  };
  const happyPass = happyTaskCreations === 1
    && happyUploadDispatches === 1
    && happyCancelCalls === 0
    && JSON.stringify(happyHeaders) === JSON.stringify([{
      status: 201,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'content-length': '11',
        'x-provider': 'expo-upload',
      },
      finalUrl: 'https://provider.rezo.test/expo-positive-upload',
      contentType: 'application/json',
      contentLength: 11,
    }])
    && JSON.stringify(happy.progress) === '[[4,8],[8,8]]'
    && JSON.stringify(happyResult) === JSON.stringify({
      status: 201,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'content-length': '11',
        'x-provider': 'expo-upload',
      },
      finalUrl: 'https://provider.rezo.test/expo-positive-upload',
      contentType: 'application/json',
      contentLength: 11,
      body: '{"ok":true}',
      uploadSize: 8,
      fileName: 'rv08-happy.bin',
    });

  const syncController = new AbortController();
  const syncAudit = context.auditSignal(syncController.signal);
  const syncSentinel = new Error('rv08-expo-upload-sync');
  let syncTaskCreations = 0;
  let syncUploadDispatches = 0;
  let syncCancelCalls = 0;
  let syncHeaderCalls = 0;
  const syncProgress: number[] = [];
  let syncUploadCallback: ((event: {
    totalBytesSent: number;
    totalBytesExpectedToSend: number;
  }) => void) | undefined;
  const syncAdapter = createExpoFileSystemAdapter({
    File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
  }, {
    uploadTaskModule: {
      createUploadTask(_url, _fileUri, _options, callback) {
        syncTaskCreations += 1;
        syncUploadCallback = callback;
        syncController.abort();
        throw syncSentinel;
      },
      FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
    },
  });
  const syncProbe = probePromise(syncAdapter.uploadFile!({
    url: 'https://provider.rezo.test/expo-sync-upload',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv08-sync.bin', size: 2 },
    signal: syncController.signal,
    onHeaders() { syncHeaderCalls += 1; },
    onProgress(event) { syncProgress.push(event.loaded); },
  }));
  await syncProbe.settled;
  syncUploadCallback?.({ totalBytesSent: 2, totalBytesExpectedToSend: 2 });
  await Promise.resolve();

  const invalid: Array<{
    name: string;
    category: 'missing-result' | 'invalid-status';
    taskCreations: number;
    uploadDispatches: number;
    outcome: string;
    reason: { name: string; code: string | null; message: string };
    taxonomyMatches: boolean;
    resultStatus: number | null;
    headerStatuses: number[];
  }> = [];
  const invalidValues: Array<null | undefined | { status: number; body: string }> = [
    null,
    undefined,
    { status: 0, body: 'invalid-zero' },
  ];
  for (const [index, invalidValue] of invalidValues.entries()) {
    const category = invalidValue === null || invalidValue === undefined
      ? 'missing-result'
      : 'invalid-status';
    let taskCreations = 0;
    let invalidUploadDispatches = 0;
    const headerStatuses: number[] = [];
    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
    }, {
      uploadTaskModule: {
        createUploadTask() {
          taskCreations += 1;
          return {
            async uploadAsync() {
              invalidUploadDispatches += 1;
              return invalidValue;
            },
          };
        },
        FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
      },
    });
    const probe = probePromise(adapter.uploadFile!({
      url: `https://provider.rezo.test/expo-invalid-${index}`,
      method: 'POST',
      headers: {},
      file: { uri: 'file:///tmp/rv08.bin' },
      onHeaders(event) { headerStatuses.push(event.status); },
    }));
    await probe.settled;
    invalid.push({
      name: invalidValue === null ? 'null' : invalidValue === undefined ? 'undefined' : 'zero',
      category,
      taskCreations,
      uploadDispatches: invalidUploadDispatches,
      outcome: probe.state.outcome,
      reason: errorShape(probe.state.reason),
      taxonomyMatches: isInvalidExpoUploadResultError(probe.state.reason, category),
      resultStatus: valueStatus(probe.state.value),
      headerStatuses,
    });
  }

  const drainResultDeferred = createDeferred<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>();
  const drainFirstDeferred = createDeferred<void>();
  const drainSecondDeferred = createDeferred<void>();
  let drainCallback: ((event: {
    totalBytesSent: number;
    totalBytesExpectedToSend: number;
  }) => void) | undefined;
  let drainTaskCreations = 0;
  let drainUploadDispatches = 0;
  let drainCancelCalls = 0;
  let drainFirstSettled = false;
  let drainSecondSettled = false;
  let secondAppendedWhileFirstPending = false;
  const drainCallbackStarts: number[] = [];
  const drainCallbackSettles: number[] = [];
  const drainAdapter = createExpoFileSystemAdapter({
    File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
  }, {
    uploadTaskModule: {
      createUploadTask(_url, _fileUri, _options, callback) {
        drainTaskCreations += 1;
        drainCallback = callback;
        return {
          uploadAsync() {
            drainUploadDispatches += 1;
            return drainResultDeferred.promise;
          },
          async cancelAsync() { drainCancelCalls += 1; },
        };
      },
      FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
    },
  });
  const drainPublicPromise = drainAdapter.uploadFile!({
    url: 'https://provider.rezo.test/expo-drain',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv08-drain.bin', size: 2 },
    onProgress(event) {
      drainCallbackStarts.push(event.loaded);
      if (event.loaded === 1) {
        return drainFirstDeferred.promise.then(() => {
          drainFirstSettled = true;
          drainCallbackSettles.push(1);
        });
      }
      if (event.loaded === 2) {
        return drainSecondDeferred.promise.then(() => {
          drainSecondSettled = true;
          drainCallbackSettles.push(2);
        });
      }
      drainCallbackSettles.push(event.loaded);
    },
  });
  const drainProbe = probePromise(drainPublicPromise);
  await waitFor(
    () => drainTaskCreations === 1 && drainUploadDispatches === 1 && drainCallback !== undefined,
    'RV-08 drain fixture did not dispatch',
  );
  drainCallback?.({ totalBytesSent: 1, totalBytesExpectedToSend: 2 });
  secondAppendedWhileFirstPending = !drainFirstSettled;
  drainCallback?.({ totalBytesSent: 2, totalBytesExpectedToSend: 2 });
  drainResultDeferred.resolve({
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: '{"drain":true}',
  });
  await Promise.resolve();
  await Promise.resolve();
  const pendingWithBothCallbacks = drainProbe.state.outcome === 'pending';
  drainFirstDeferred.resolve(undefined);
  await waitFor(() => drainFirstSettled, 'RV-08 first pending callback did not settle');
  const pendingAfterFirstCallback = drainProbe.state.outcome === 'pending';
  drainSecondDeferred.resolve(undefined);
  await drainProbe.settled;
  drainCallback?.({ totalBytesSent: 3, totalBytesExpectedToSend: 3 });
  await Promise.resolve();
  const postResultCallbackBlocked = JSON.stringify(drainCallbackStarts) === '[1,2]';

  const callbackFailures: Array<{
    mode: 'reject' | 'throw';
    taskCreations: number;
    uploadDispatches: number;
    callbackCalls: number;
    cancelCalls: number;
    outcome: string;
    exactCause: boolean;
    reason: { name: string; code: string | null; message: string };
    lateCallbackBlocked: boolean;
  }> = [];
  for (const mode of ['reject', 'throw'] as const) {
    const progressError = new Error(`rv08-progress-${mode}`);
    const cancellationError = new Error(`rv08-cancel-${mode}`);
    let callback: ((event: {
      totalBytesSent: number;
      totalBytesExpectedToSend: number;
    }) => void) | undefined;
    let taskCreations = 0;
    let uploadDispatches = 0;
    let callbackCalls = 0;
    let cancelCallsForMode = 0;
    const failureAdapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
    }, {
      uploadTaskModule: {
        createUploadTask(_url, _fileUri, _options, value) {
          taskCreations += 1;
          callback = value;
          return {
            uploadAsync() {
              uploadDispatches += 1;
              callback?.({ totalBytesSent: 1, totalBytesExpectedToSend: 2 });
              return new Promise<never>(() => undefined);
            },
            cancelAsync() {
              cancelCallsForMode += 1;
              if (mode === 'throw') throw cancellationError;
              return Promise.reject(cancellationError);
            },
          };
        },
        FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
      },
    });
    const failureProbe = probePromise(failureAdapter.uploadFile!({
      url: `https://provider.rezo.test/expo-callback-${mode}`,
      method: 'POST',
      headers: {},
      file: { uri: `file:///tmp/rv08-callback-${mode}.bin`, size: 2 },
      async onProgress() {
        callbackCalls += 1;
        throw progressError;
      },
    }));
    await failureProbe.settled;
    callback?.({ totalBytesSent: 2, totalBytesExpectedToSend: 2 });
    await Promise.resolve();
    callbackFailures.push({
      mode,
      taskCreations,
      uploadDispatches,
      callbackCalls,
      cancelCalls: cancelCallsForMode,
      outcome: failureProbe.state.outcome,
      exactCause: failureProbe.state.reason === progressError,
      reason: errorShape(failureProbe.state.reason),
      lateCallbackBlocked: callbackCalls === 1,
    });
  }

  const uploadDeferred = createDeferred<{ status: number; headers: Record<string, string>; body: string }>();
  let uploadCallback: ((event: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void) | undefined;
  const abortLifecycle: string[] = [];
  let abortTaskCreations = 0;
  let abortUploadDispatches = 0;
  let cancelCalls = 0;
  let abortClock = 0;
  let abortOrder = 0;
  let rejectedOrder = 0;
  let fulfilledOrder = 0;
  let lateResultOrder = 0;
  const abortTimelineStartedAt = performance.now();
  let abortAtMs = 0;
  let rejectedAtMs = 0;
  let fulfilledAtMs = 0;
  let lateResultAtMs = 0;
  const abortAdapter = createExpoFileSystemAdapter({
    File: Object.assign(MockFile, { async downloadFileAsync() { return {}; } }),
  }, {
    uploadTaskModule: {
      createUploadTask(_url, _fileUri, _options, callback) {
        abortLifecycle.push('create');
        abortTaskCreations += 1;
        uploadCallback = callback;
        return {
          uploadAsync() {
            abortLifecycle.push('dispatch');
            abortUploadDispatches += 1;
            return uploadDeferred.promise;
          },
          async cancelAsync() { abortLifecycle.push('cancel'); cancelCalls += 1; },
        };
      },
      FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
    },
  });
  const controller = new AbortController();
  const signalAudit = context.auditSignal(controller.signal);
  const abortHeaders: number[] = [];
  const abortProgress: RezoReactNativeFileUploadProgressEvent[] = [];
  const abortPublicPromise = abortAdapter.uploadFile!({
    url: 'https://provider.rezo.test/expo-abort',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv08.bin', size: 4 },
    signal: controller.signal,
    onHeaders(event) { abortLifecycle.push('headers'); abortHeaders.push(event.status); },
    onProgress(event) { abortLifecycle.push('progress'); abortProgress.push(event); },
  });
  const abortProbe = probePromise(abortPublicPromise);
  void abortPublicPromise.then(
    () => {
      abortLifecycle.push('fulfilled');
      fulfilledOrder = ++abortClock;
      fulfilledAtMs = performance.now() - abortTimelineStartedAt;
    },
    () => {
      abortLifecycle.push('rejected');
      rejectedOrder = ++abortClock;
      rejectedAtMs = performance.now() - abortTimelineStartedAt;
    },
  );
  await waitFor(
    () => abortTaskCreations === 1 && abortUploadDispatches === 1,
    'RV-08 Expo upload did not dispatch exactly once',
  );
  const outcomeImmediatelyBeforeAbort = abortProbe.state.outcome;
  abortLifecycle.push('abort');
  abortOrder = ++abortClock;
  abortAtMs = performance.now() - abortTimelineStartedAt;
  controller.abort();
  await delay(PROMPT_WINDOW_MS);
  const pendingBeforeLateResult = abortProbe.state.outcome === 'pending';
  const rejectedPromptlyBeforeLateResult = abortProbe.state.outcome === 'rejected'
    && rejectedOrder > abortOrder
    && rejectedAtMs > abortAtMs;
  abortLifecycle.push('late-progress');
  uploadCallback?.({ totalBytesSent: 4, totalBytesExpectedToSend: 4 });
  abortLifecycle.push('late-result');
  lateResultOrder = ++abortClock;
  lateResultAtMs = performance.now() - abortTimelineStartedAt;
  uploadDeferred.resolve({
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  });
  await abortProbe.settled;
  await delay(LATE_WINDOW_MS);

  const actual = {
    happy,
    syncAuthority: {
      outcome: syncProbe.state.outcome,
      reason: errorShape(syncProbe.state.reason),
      leakedSentinel: syncProbe.state.reason === syncSentinel,
      taskCreations: syncTaskCreations,
      uploadDispatches: syncUploadDispatches,
      cancelCalls: syncCancelCalls,
      headers: syncHeaderCalls,
      progress: syncProgress,
      listener: {
        added: syncAudit.added,
        removed: syncAudit.removed,
        live: syncAudit.live,
        events: syncAudit.events,
      },
    },
    invalid,
    drain: {
      taskCreations: drainTaskCreations,
      uploadDispatches: drainUploadDispatches,
      cancelCalls: drainCancelCalls,
      secondAppendedWhileFirstPending,
      pendingWithBothCallbacks,
      pendingAfterFirstCallback,
      firstSettled: drainFirstSettled,
      secondSettled: drainSecondSettled,
      callbackStarts: drainCallbackStarts,
      callbackSettles: drainCallbackSettles,
      postResultCallbackBlocked,
      outcome: drainProbe.state.outcome,
      resultStatus: valueStatus(drainProbe.state.value),
    },
    callbackFailures,
    abort: {
      outcomeImmediatelyBeforeAbort,
      pendingBeforeLateResult,
      rejectedPromptlyBeforeLateResult,
      outcome: abortProbe.state.outcome,
      ordering: {
        abortOrder,
        rejectedOrder,
        fulfilledOrder,
        lateResultOrder,
        abortAtMs,
        rejectedAtMs,
        fulfilledAtMs,
        lateResultAtMs,
      },
      resultStatus: valueStatus(abortProbe.state.value),
      taskCreations: abortTaskCreations,
      uploadDispatches: abortUploadDispatches,
      cancelCalls,
      lifecycle: abortLifecycle,
      headers: abortHeaders,
      progress: abortProgress.map((event) => event.loaded),
      listener: {
        added: signalAudit.added,
        removed: signalAudit.removed,
        live: signalAudit.live,
        events: signalAudit.events,
      },
    },
  };
  const invalidPass = invalid.every((entry) => (
    entry.taskCreations === 1
    && entry.uploadDispatches === 1
    && entry.outcome === 'rejected'
    && entry.taxonomyMatches
    && entry.resultStatus === null
    && entry.headerStatuses.length === 0
  ));
  const syncPass = syncProbe.state.outcome === 'rejected'
    && isAbortError(syncProbe.state.reason)
    && syncProbe.state.reason !== syncSentinel
    && syncTaskCreations === 1
    && syncUploadDispatches === 0
    && syncCancelCalls === 0
    && syncHeaderCalls === 0
    && syncProgress.length === 0
    && syncAudit.added === 0
    && syncAudit.removed === 0
    && syncAudit.live === 0
    && JSON.stringify(syncAudit.events) === '[]';
  const drainPass = drainTaskCreations === 1
    && drainUploadDispatches === 1
    && drainCancelCalls === 0
    && secondAppendedWhileFirstPending
    && pendingWithBothCallbacks
    && pendingAfterFirstCallback
    && drainFirstSettled
    && drainSecondSettled
    && JSON.stringify(drainCallbackStarts) === '[1,2]'
    && JSON.stringify(drainCallbackSettles) === '[1,2]'
    && postResultCallbackBlocked
    && drainProbe.state.outcome === 'fulfilled'
    && valueStatus(drainProbe.state.value) === 201;
  const callbackFailurePass = callbackFailures.every((entry) => (
    entry.taskCreations === 1
    && entry.uploadDispatches === 1
    && entry.callbackCalls === 1
    && entry.cancelCalls === 1
    && entry.outcome === 'rejected'
    && entry.exactCause
    && entry.reason.name === 'Error'
    && entry.reason.message === `rv08-progress-${entry.mode}`
    && entry.lateCallbackBlocked
  ));
  const abortPass = outcomeImmediatelyBeforeAbort === 'pending'
    && !pendingBeforeLateResult
    && rejectedPromptlyBeforeLateResult
    && abortProbe.state.outcome === 'rejected'
    && rejectedOrder > abortOrder
    && rejectedOrder < lateResultOrder
    && fulfilledOrder === 0
    && rejectedAtMs > abortAtMs
    && rejectedAtMs < lateResultAtMs
    && abortTaskCreations === 1
    && abortUploadDispatches === 1
    && cancelCalls === 1
    && abortHeaders.length === 0
    && abortProgress.length === 0
    && signalWasCleanlyObserved(signalAudit);
  const currentSignature = happyPass
    && invalid.every((entry) => (
    entry.taskCreations === 1
    && entry.uploadDispatches === 1
    && entry.outcome === 'fulfilled'
    && entry.reason.name === 'undefined'
    && !entry.taxonomyMatches
    && entry.resultStatus === 200
    && JSON.stringify(entry.headerStatuses) === '[200]'
  ))
    && outcomeImmediatelyBeforeAbort === 'pending'
    && pendingBeforeLateResult
    && abortProbe.state.outcome === 'fulfilled'
    && !rejectedPromptlyBeforeLateResult
    && rejectedOrder === 0
    && fulfilledOrder > lateResultOrder
    && fulfilledAtMs >= lateResultAtMs
    && abortTaskCreations === 1
    && abortUploadDispatches === 1
    && valueStatus(abortProbe.state.value) === 201
    && cancelCalls === 1
    && JSON.stringify(abortHeaders) === '[201]'
    && JSON.stringify(abortProgress.map((event) => event.loaded)) === '[4]'
    && signalAudit.added === 1
    && signalAudit.removed === 1
    && signalAudit.live === 0
    && JSON.stringify(signalAudit.events) === '["add","fire","remove"]'
    && JSON.stringify(abortLifecycle) === JSON.stringify([
      'create', 'dispatch', 'abort', 'cancel', 'late-progress', 'progress', 'late-result', 'headers', 'fulfilled',
    ]);
  return {
    actual,
    desired: 'valid upload proves truthful 201 metadata/body/progress; reentrant acquisition abort dominates synchronous failure; result waits for every accepted async progress callback and blocks post-result callbacks; callback rejection surfaces its exact cause and cancels once even when cancellation throws/rejects; invalid results and abort retain their exact refusal/cleanup contracts',
    desiredPass: happyPass && syncPass && invalidPass && drainPass && callbackFailurePass && abortPass,
    currentSignature,
  };
});

logicalRow('RV-09', 'RNFS preserves positive results and quarantines cancelled transfers', async (context) => {
  const syncDownloadController = new AbortController();
  const syncDownloadAudit = context.auditSignal(syncDownloadController.signal);
  const syncDownloadSentinel = new Error('rv09-rnfs-download-sync');
  let syncDownloadOptions: ReactNativeFsDownloadOptionsLike | undefined;
  let syncDownloadDispatches = 0;
  let syncDownloadStops = 0;
  let syncDownloadCallbacks = 0;
  const syncDownloadAdapter = createReactNativeFsAdapter({
    downloadFile(options) {
      syncDownloadDispatches += 1;
      syncDownloadOptions = options;
      syncDownloadController.abort();
      throw syncDownloadSentinel;
    },
    stopDownload() { syncDownloadStops += 1; },
  });
  const syncDownloadProbe = probePromise(syncDownloadAdapter.downloadFile!({
    url: 'https://provider.rezo.test/rnfs-sync-download',
    destination: '/tmp/rv09-sync-download.bin',
    method: 'GET',
    headers: {},
    signal: syncDownloadController.signal,
    onHeaders() { syncDownloadCallbacks += 1; },
    onProgress() { syncDownloadCallbacks += 1; },
  }));
  await syncDownloadProbe.settled;
  syncDownloadOptions?.begin?.({
    jobId: 41,
    statusCode: 200,
    contentLength: 1,
    headers: { 'content-length': '1' },
  });
  syncDownloadOptions?.progress?.({ jobId: 41, contentLength: 1, bytesWritten: 1 });

  const syncUploadController = new AbortController();
  const syncUploadAudit = context.auditSignal(syncUploadController.signal);
  const syncUploadSentinel = new Error('rv09-rnfs-upload-sync');
  let syncUploadBegin: (() => void) | undefined;
  let syncUploadProgress: (() => void) | undefined;
  let syncUploadDispatches = 0;
  let syncUploadStops = 0;
  let syncUploadCallbacks = 0;
  const syncUploadAdapter = createReactNativeFsAdapter({
    downloadFile() { throw new InfrastructureError('RV-09 sync upload reached download'); },
    uploadFiles(options) {
      syncUploadDispatches += 1;
      syncUploadBegin = () => options.begin?.({ jobId: 42 });
      syncUploadProgress = () => options.progress?.({
        jobId: 42,
        totalBytesExpectedToSend: 1,
        totalBytesSent: 1,
      });
      syncUploadController.abort();
      throw syncUploadSentinel;
    },
    stopUpload() { syncUploadStops += 1; },
  });
  const syncUploadProbe = probePromise(syncUploadAdapter.uploadFile!({
    url: 'https://provider.rezo.test/rnfs-sync-upload',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv09-sync-upload.bin', size: 1 },
    signal: syncUploadController.signal,
    onHeaders() { syncUploadCallbacks += 1; },
    onProgress() { syncUploadCallbacks += 1; },
  }));
  await syncUploadProbe.settled;
  syncUploadBegin?.();
  syncUploadProgress?.();
  await Promise.resolve();

  const positiveAdapter = createReactNativeFsAdapter({
    downloadFile(options) {
      options.begin?.({
        jobId: 1,
        statusCode: 206,
        contentLength: 3,
        headers: { 'x-positive': 'download' },
      });
      options.progress?.({ jobId: 1, contentLength: 3, bytesWritten: 3 });
      return {
        jobId: 1,
        promise: Promise.resolve({
          jobId: 1,
          statusCode: 206,
          bytesWritten: 3,
          headers: { 'x-positive': 'download' },
        }),
      };
    },
    uploadFiles(options) {
      options.begin?.({ jobId: 2 });
      options.progress?.({ jobId: 2, totalBytesExpectedToSend: 4, totalBytesSent: 4 });
      return {
        jobId: 2,
        promise: Promise.resolve({
          jobId: 2,
          statusCode: 201,
          headers: { 'content-type': 'application/json', 'content-length': '11' },
          body: '{"ok":true}',
        }),
      };
    },
  });
  const positiveDownloadHeaders: RezoReactNativeFileDownloadHeadersEvent[] = [];
  const positiveDownloadProgress: RezoReactNativeFileDownloadProgressEvent[] = [];
  const positiveUploadHeaders: RezoReactNativeFileDownloadHeadersEvent[] = [];
  const positiveUploadProgress: RezoReactNativeFileUploadProgressEvent[] = [];
  const positiveDownload = await positiveAdapter.downloadFile!({
    url: 'https://provider.rezo.test/rnfs-positive-download',
    destination: '/tmp/rv09-positive.bin',
    method: 'GET',
    headers: {},
    onHeaders(event) { positiveDownloadHeaders.push(event); },
    onProgress(event) { positiveDownloadProgress.push(event); },
  });
  const positiveUpload = await positiveAdapter.uploadFile!({
    url: 'https://provider.rezo.test/rnfs-positive-upload',
    method: 'PUT',
    headers: {},
    file: { uri: 'file:///tmp/rv09-upload.bin', name: 'rv09.bin', size: 4 },
    onHeaders(event) { positiveUploadHeaders.push(event); },
    onProgress(event) { positiveUploadProgress.push(event); },
  });

  const callbackFailures: Array<{
    mode: 'download' | 'upload';
    dispatches: number;
    callbackCalls: number;
    headerCalls: number;
    stopCalls: number;
    stopJobId: number | null;
    outcome: string;
    exactCause: boolean;
    reason: { name: string; code: string | null; message: string };
    lateCallbackBlocked: boolean;
  }> = [];

  const downloadCallbackError = new Error('rv09-download-callback');
  const downloadStopError = new Error('rv09-download-stop');
  let failureDownloadOptions: ReactNativeFsDownloadOptionsLike | undefined;
  let failureDownloadDispatches = 0;
  let failureDownloadCallbacks = 0;
  let failureDownloadHeaders = 0;
  let failureDownloadStops = 0;
  let failureDownloadStopJobId: number | null = null;
  const failureDownloadAdapter = createReactNativeFsAdapter({
    downloadFile(options) {
      failureDownloadDispatches += 1;
      failureDownloadOptions = options;
      options.progress?.({ jobId: 51, contentLength: 2, bytesWritten: 1 });
      return { jobId: 51, promise: new Promise<never>(() => undefined) };
    },
    stopDownload(jobId) {
      failureDownloadStops += 1;
      failureDownloadStopJobId = jobId;
      throw downloadStopError;
    },
  });
  const failureDownloadProbe = probePromise(failureDownloadAdapter.downloadFile!({
    url: 'https://provider.rezo.test/rnfs-callback-download',
    destination: '/tmp/rv09-callback-download.bin',
    method: 'GET',
    headers: {},
    onHeaders() { failureDownloadHeaders += 1; },
    async onProgress() {
      failureDownloadCallbacks += 1;
      throw downloadCallbackError;
    },
  }));
  await failureDownloadProbe.settled;
  failureDownloadOptions?.progress?.({ jobId: 51, contentLength: 2, bytesWritten: 2 });
  await Promise.resolve();
  callbackFailures.push({
    mode: 'download',
    dispatches: failureDownloadDispatches,
    callbackCalls: failureDownloadCallbacks,
    headerCalls: failureDownloadHeaders,
    stopCalls: failureDownloadStops,
    stopJobId: failureDownloadStopJobId,
    outcome: failureDownloadProbe.state.outcome,
    exactCause: failureDownloadProbe.state.reason === downloadCallbackError,
    reason: errorShape(failureDownloadProbe.state.reason),
    lateCallbackBlocked: failureDownloadCallbacks === 1,
  });

  const uploadCallbackError = new Error('rv09-upload-callback');
  const uploadStopError = new Error('rv09-upload-stop');
  let failureUploadProgress: (() => void) | undefined;
  let failureUploadDispatches = 0;
  let failureUploadCallbacks = 0;
  let failureUploadHeaders = 0;
  let failureUploadStops = 0;
  let failureUploadStopJobId: number | null = null;
  const failureUploadAdapter = createReactNativeFsAdapter({
    downloadFile() { throw new InfrastructureError('RV-09 callback upload reached download'); },
    uploadFiles(options) {
      failureUploadDispatches += 1;
      failureUploadProgress = () => options.progress?.({
        jobId: 52,
        totalBytesExpectedToSend: 2,
        totalBytesSent: 1,
      });
      failureUploadProgress();
      return { jobId: 52, promise: new Promise<never>(() => undefined) };
    },
    stopUpload(jobId) {
      failureUploadStops += 1;
      failureUploadStopJobId = jobId;
      return Promise.reject(uploadStopError);
    },
  });
  const failureUploadProbe = probePromise(failureUploadAdapter.uploadFile!({
    url: 'https://provider.rezo.test/rnfs-callback-upload',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv09-callback-upload.bin', size: 2 },
    onHeaders() { failureUploadHeaders += 1; },
    async onProgress() {
      failureUploadCallbacks += 1;
      throw uploadCallbackError;
    },
  }));
  await failureUploadProbe.settled;
  failureUploadProgress?.();
  await Promise.resolve();
  callbackFailures.push({
    mode: 'upload',
    dispatches: failureUploadDispatches,
    callbackCalls: failureUploadCallbacks,
    headerCalls: failureUploadHeaders,
    stopCalls: failureUploadStops,
    stopJobId: failureUploadStopJobId,
    outcome: failureUploadProbe.state.outcome,
    exactCause: failureUploadProbe.state.reason === uploadCallbackError,
    reason: errorShape(failureUploadProbe.state.reason),
    lateCallbackBlocked: failureUploadCallbacks === 1,
  });

  const downloadDeferred = createDeferred<{
    jobId: number;
    statusCode: number;
    bytesWritten: number;
    headers?: Record<string, string>;
  }>();
  const uploadDeferred = createDeferred<{
    jobId: number;
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }>();
  let downloadOptions: ReactNativeFsDownloadOptionsLike | undefined;
  let uploadBegin: (() => void) | undefined;
  let uploadProgress: (() => void) | undefined;
  let downloadDispatches = 0;
  let uploadDispatches = 0;
  let stopDownloadCalls = 0;
  let stopUploadCalls = 0;
  let unlinkCalls = 0;
  const partialPath = '/tmp/rv09-partial.bin';
  const cancellationLifecycle: string[] = [];
  let clock = 0;
  let abortAt = 0;
  let downloadRejectedAt = 0;
  let uploadRejectedAt = 0;
  const partialState = {
    exists: false,
    bytes: 0,
    establishedAt: 0,
    deletedAt: 0,
  };
  const cancelModule = Object.assign({
    downloadFile(options: ReactNativeFsDownloadOptionsLike) {
      cancellationLifecycle.push('download-dispatch');
      downloadDispatches += 1;
      downloadOptions = options;
      partialState.exists = true;
      partialState.bytes = 2;
      partialState.establishedAt = ++clock;
      cancellationLifecycle.push('partial-established');
      options.begin?.({
        jobId: 7,
        statusCode: 200,
        contentLength: 4,
        headers: { 'content-length': '4' },
      });
      options.progress?.({ jobId: 7, contentLength: 4, bytesWritten: 2 });
      return { jobId: 7, promise: downloadDeferred.promise };
    },
    uploadFiles(options: {
      begin?: (event: { jobId: number }) => void;
      progress?: (event: {
        jobId: number;
        totalBytesExpectedToSend: number;
        totalBytesSent: number;
      }) => void;
    }) {
      cancellationLifecycle.push('upload-dispatch');
      uploadDispatches += 1;
      uploadBegin = () => options.begin?.({ jobId: 8 });
      uploadProgress = () => options.progress?.({
        jobId: 8,
        totalBytesExpectedToSend: 4,
        totalBytesSent: 4,
      });
      uploadBegin();
      return { jobId: 8, promise: uploadDeferred.promise };
    },
    stopDownload(jobId: number) {
      if (jobId !== 7) throw new InfrastructureError(`RV-09 wrong download job ${jobId}`);
      cancellationLifecycle.push('stop-download');
      stopDownloadCalls += 1;
    },
    stopUpload(jobId: number) {
      if (jobId !== 8) throw new InfrastructureError(`RV-09 wrong upload job ${jobId}`);
      cancellationLifecycle.push('stop-upload');
      stopUploadCalls += 1;
    },
  }, {
    async unlink(path: string) {
      if (path !== partialPath) throw new InfrastructureError(`RV-09 wrong partial path ${path}`);
      cancellationLifecycle.push('unlink');
      unlinkCalls += 1;
      partialState.exists = false;
      partialState.bytes = 0;
      partialState.deletedAt = ++clock;
    },
  });
  const cancelAdapter = createReactNativeFsAdapter(cancelModule);
  const downloadController = new AbortController();
  const uploadController = new AbortController();
  const downloadSignalAudit = context.auditSignal(downloadController.signal);
  const uploadSignalAudit = context.auditSignal(uploadController.signal);
  const lateDownloadHeaders: number[] = [];
  const lateDownloadProgress: number[] = [];
  const lateUploadHeaders: number[] = [];
  const lateUploadProgress: number[] = [];
  let abortIssued = false;
  const downloadPublicPromise = cancelAdapter.downloadFile!({
    url: 'https://provider.rezo.test/rnfs-cancel-download',
    destination: partialPath,
    method: 'GET',
    headers: {},
    signal: downloadController.signal,
    onHeaders(event) {
      cancellationLifecycle.push(abortIssued ? 'late-download-headers' : 'pre-download-headers');
      lateDownloadHeaders.push(event.status);
    },
    onProgress(event) {
      cancellationLifecycle.push(abortIssued ? 'late-download-progress' : 'pre-download-progress');
      lateDownloadProgress.push(event.loaded);
    },
  });
  const uploadPublicPromise = cancelAdapter.uploadFile!({
    url: 'https://provider.rezo.test/rnfs-cancel-upload',
    method: 'POST',
    headers: {},
    file: { uri: 'file:///tmp/rv09-upload.bin', size: 4 },
    signal: uploadController.signal,
    onHeaders(event) {
      cancellationLifecycle.push(abortIssued ? 'late-upload-headers' : 'pre-upload-headers');
      lateUploadHeaders.push(event.status);
    },
    onProgress(event) {
      cancellationLifecycle.push(abortIssued ? 'late-upload-progress' : 'pre-upload-progress');
      lateUploadProgress.push(event.loaded);
    },
  });
  const downloadProbe = probePromise(downloadPublicPromise);
  const uploadProbe = probePromise(uploadPublicPromise);
  void downloadPublicPromise.catch(() => {
    cancellationLifecycle.push('download-rejected');
    downloadRejectedAt = ++clock;
  });
  void uploadPublicPromise.catch(() => {
    cancellationLifecycle.push('upload-rejected');
    uploadRejectedAt = ++clock;
  });
  await waitFor(
    () => downloadOptions !== undefined
      && uploadBegin !== undefined
      && uploadProgress !== undefined
      && downloadDispatches === 1
      && uploadDispatches === 1,
    'RV-09 RNFS cancellation fixtures did not dispatch',
  );
  if (!partialState.exists
    || partialState.bytes !== 2
    || partialState.establishedAt === 0
    || JSON.stringify(lateDownloadHeaders) !== '[200]'
    || JSON.stringify(lateDownloadProgress) !== '[2]'
    || JSON.stringify(lateUploadHeaders) !== '[]'
    || JSON.stringify(lateUploadProgress) !== '[0]') {
    throw new InfrastructureError('RV-09 pre-abort partial/callback boundary was not established');
  }
  const callbackBoundary = {
    downloadHeaders: [...lateDownloadHeaders],
    downloadProgress: [...lateDownloadProgress],
    uploadHeaders: [...lateUploadHeaders],
    uploadProgress: [...lateUploadProgress],
  };
  cancellationLifecycle.push('abort');
  abortIssued = true;
  abortAt = ++clock;
  downloadController.abort();
  uploadController.abort();
  await delay(PROMPT_WINDOW_MS);
  const downloadPendingBeforeLate = downloadProbe.state.outcome === 'pending';
  const uploadPendingBeforeLate = uploadProbe.state.outcome === 'pending';
  const downloadRejectedBeforeLate = downloadRejectedAt > abortAt;
  const uploadRejectedBeforeLate = uploadRejectedAt > abortAt;
  cancellationLifecycle.push('late-callback-release');
  downloadOptions?.begin?.({
    jobId: 7,
    statusCode: 200,
    contentLength: 4,
    headers: { 'content-length': '4' },
  });
  downloadOptions?.progress?.({ jobId: 7, contentLength: 4, bytesWritten: 4 });
  uploadBegin?.();
  uploadProgress?.();
  cancellationLifecycle.push('late-result-release');
  downloadDeferred.resolve({
    jobId: 7,
    statusCode: 200,
    bytesWritten: 4,
    headers: { 'content-length': '4' },
  });
  uploadDeferred.resolve({
    jobId: 8,
    statusCode: 201,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  });
  await Promise.all([downloadProbe.settled, uploadProbe.settled]);
  await delay(LATE_WINDOW_MS);
  const retainedDisposition = hasStructuredRetainedPartialDisposition(
    downloadProbe.state.reason,
    partialPath,
    2,
  );
  const deletedBeforeRejection = unlinkCalls === 1
    && !partialState.exists
    && partialState.bytes === 0
    && partialState.deletedAt > abortAt
    && downloadRejectedAt > partialState.deletedAt;
  const retainedBeforeRejection = partialState.exists
    && partialState.bytes === 2
    && partialState.establishedAt < abortAt
    && downloadRejectedAt > abortAt
    && retainedDisposition;

  const positive = {
    download: positiveDownload,
    downloadHeaders: positiveDownloadHeaders.map((event) => ({
      status: event.status,
      length: event.contentLength,
      marker: event.headers?.['x-positive'],
    })),
    downloadProgress: positiveDownloadProgress.map((event) => [event.loaded, event.total]),
    upload: positiveUpload,
    uploadHeaders: positiveUploadHeaders.map((event) => ({
      status: event.status,
      type: event.contentType,
      length: event.contentLength,
    })),
    uploadProgress: positiveUploadProgress.map((event) => [event.loaded, event.total]),
  };
  const syncAuthority = {
    download: {
      outcome: syncDownloadProbe.state.outcome,
      reason: errorShape(syncDownloadProbe.state.reason),
      leakedSentinel: syncDownloadProbe.state.reason === syncDownloadSentinel,
      dispatches: syncDownloadDispatches,
      stops: syncDownloadStops,
      callbacks: syncDownloadCallbacks,
      listener: {
        added: syncDownloadAudit.added,
        removed: syncDownloadAudit.removed,
        live: syncDownloadAudit.live,
        events: syncDownloadAudit.events,
      },
    },
    upload: {
      outcome: syncUploadProbe.state.outcome,
      reason: errorShape(syncUploadProbe.state.reason),
      leakedSentinel: syncUploadProbe.state.reason === syncUploadSentinel,
      dispatches: syncUploadDispatches,
      stops: syncUploadStops,
      callbacks: syncUploadCallbacks,
      listener: {
        added: syncUploadAudit.added,
        removed: syncUploadAudit.removed,
        live: syncUploadAudit.live,
        events: syncUploadAudit.events,
      },
    },
  };
  const cancelled = {
    downloadDispatches,
    uploadDispatches,
    callbackBoundary,
    cancellationLifecycle,
    partialState,
    abortAt,
    downloadRejectedAt,
    uploadRejectedAt,
    downloadPendingBeforeLate,
    uploadPendingBeforeLate,
    downloadRejectedBeforeLate,
    uploadRejectedBeforeLate,
    downloadOutcome: downloadProbe.state.outcome,
    uploadOutcome: uploadProbe.state.outcome,
    downloadStatus: valueStatus(downloadProbe.state.value),
    uploadStatus: valueStatus(uploadProbe.state.value),
    stopDownloadCalls,
    stopUploadCalls,
    downloadHeaders: lateDownloadHeaders,
    downloadProgress: lateDownloadProgress,
    uploadHeaders: lateUploadHeaders,
    uploadProgress: lateUploadProgress,
    unlinkCalls,
    retainedDisposition,
    deletedBeforeRejection,
    retainedBeforeRejection,
    listeners: {
      download: {
        added: downloadSignalAudit.added,
        removed: downloadSignalAudit.removed,
        live: downloadSignalAudit.live,
        events: downloadSignalAudit.events,
      },
      upload: {
        added: uploadSignalAudit.added,
        removed: uploadSignalAudit.removed,
        live: uploadSignalAudit.live,
        events: uploadSignalAudit.events,
      },
    },
  };
  const positivePass = positiveDownload.status === 206
    && positiveDownload.filePath === '/tmp/rv09-positive.bin'
    && positiveDownload.fileSize === 3
    && positiveDownload.contentLength === 3
    && positiveDownload.headers?.['x-positive'] === 'download'
    && JSON.stringify(positive.downloadHeaders) === JSON.stringify([{
      status: 206, length: 3, marker: 'download',
    }])
    && JSON.stringify(positive.downloadProgress) === '[[3,3]]'
    && positiveUpload.status === 201
    && positiveUpload.body === '{"ok":true}'
    && positiveUpload.fileName === 'rv09.bin'
    && positiveUpload.uploadSize === 4
    && positiveUpload.contentType === 'application/json'
    && positiveUpload.contentLength === 11
    && JSON.stringify(positive.uploadHeaders) === JSON.stringify([{
      status: 201, type: 'application/json', length: 11,
    }])
    && JSON.stringify(positive.uploadProgress) === '[[0,4],[4,4]]';
  const syncAuthorityPass = syncDownloadProbe.state.outcome === 'rejected'
    && isAbortError(syncDownloadProbe.state.reason)
    && syncDownloadProbe.state.reason !== syncDownloadSentinel
    && syncDownloadDispatches === 1
    && syncDownloadStops === 0
    && syncDownloadCallbacks === 0
    && signalWasCleanlyObserved(syncDownloadAudit)
    && syncUploadProbe.state.outcome === 'rejected'
    && isAbortError(syncUploadProbe.state.reason)
    && syncUploadProbe.state.reason !== syncUploadSentinel
    && syncUploadDispatches === 1
    && syncUploadStops === 0
    && syncUploadCallbacks === 0
    && signalWasCleanlyObserved(syncUploadAudit);
  const callbackFailurePass = callbackFailures.every((entry) => (
    entry.dispatches === 1
    && entry.callbackCalls === 1
    && entry.headerCalls === 0
    && entry.stopCalls === 1
    && entry.stopJobId === (entry.mode === 'download' ? 51 : 52)
    && entry.outcome === 'rejected'
    && entry.exactCause
    && entry.reason.name === 'Error'
    && entry.reason.message === `rv09-${entry.mode}-callback`
    && entry.lateCallbackBlocked
  ));
  const cancellationPass = !downloadPendingBeforeLate
    && !uploadPendingBeforeLate
    && downloadRejectedBeforeLate
    && uploadRejectedBeforeLate
    && downloadProbe.state.outcome === 'rejected'
    && uploadProbe.state.outcome === 'rejected'
    && downloadDispatches === 1
    && uploadDispatches === 1
    && stopDownloadCalls === 1
    && stopUploadCalls === 1
    && JSON.stringify(lateDownloadHeaders) === JSON.stringify(callbackBoundary.downloadHeaders)
    && JSON.stringify(lateDownloadProgress) === JSON.stringify(callbackBoundary.downloadProgress)
    && JSON.stringify(lateUploadHeaders) === JSON.stringify(callbackBoundary.uploadHeaders)
    && JSON.stringify(lateUploadProgress) === JSON.stringify(callbackBoundary.uploadProgress)
    && (deletedBeforeRejection || retainedBeforeRejection)
    && signalWasCleanlyObserved(downloadSignalAudit)
    && signalWasCleanlyObserved(uploadSignalAudit);
  const currentSignature = positivePass
    && downloadPendingBeforeLate
    && uploadPendingBeforeLate
    && !downloadRejectedBeforeLate
    && !uploadRejectedBeforeLate
    && downloadProbe.state.outcome === 'fulfilled'
    && uploadProbe.state.outcome === 'fulfilled'
    && downloadDispatches === 1
    && uploadDispatches === 1
    && valueStatus(downloadProbe.state.value) === 200
    && valueStatus(uploadProbe.state.value) === 201
    && stopDownloadCalls === 1
    && stopUploadCalls === 1
    && JSON.stringify(callbackBoundary) === JSON.stringify({
      downloadHeaders: [200],
      downloadProgress: [2],
      uploadHeaders: [],
      uploadProgress: [0],
    })
    && JSON.stringify(lateDownloadHeaders) === '[200,200]'
    && JSON.stringify(lateDownloadProgress) === '[2,4]'
    && JSON.stringify(lateUploadHeaders) === '[201]'
    && JSON.stringify(lateUploadProgress) === '[0,0,4]'
    && unlinkCalls === 0
    && partialState.exists
    && partialState.bytes === 2
    && !retainedDisposition
    && !deletedBeforeRejection
    && !retainedBeforeRejection
    && downloadRejectedAt === 0
    && uploadRejectedAt === 0
    && downloadSignalAudit.added === 1
    && downloadSignalAudit.removed === 1
    && downloadSignalAudit.live === 0
    && JSON.stringify(downloadSignalAudit.events) === '["add","fire","remove"]'
    && uploadSignalAudit.added === 1
    && uploadSignalAudit.removed === 1
    && uploadSignalAudit.live === 0
    && JSON.stringify(uploadSignalAudit.events) === '["add","fire","remove"]';
  return {
    actual: { syncAuthority, positive, callbackFailures, cancelled },
    desired: 'reentrant RNFS acquisition aborts dominate synchronous throws; async callback failures surface exact causes and stop once despite throwing/rejecting stop work; positive results remain exact; cancellation preserves pre-abort boundaries, rejects promptly, quarantines late callbacks/results, and reports witnessed partial output with balanced listeners',
    desiredPass: syncAuthorityPass && positivePass && callbackFailurePass && cancellationPass,
    currentSignature,
  };
});

logicalRow('RV-10', 'NetInfo teardown and background metadata/rejections are honest', async () => {
  const subscriptions: Array<{
    shape: string;
    deliveries: number;
    removals: number;
  }> = [];
  for (const shape of ['function', 'object'] as const) {
    let upstreamListener: ((state: {
      isConnected: boolean | null;
      isInternetReachable: boolean | null;
    }) => void) | undefined;
    let removals = 0;
    let deliveries = 0;
    const provider = createNetInfoProvider({
      async fetch() { return { isConnected: true, isInternetReachable: true }; },
      addEventListener(listener) {
        upstreamListener = listener;
        const remove = () => { removals += 1; };
        return shape === 'function' ? remove : { remove };
      },
    });
    const unsubscribe = await provider.subscribe!(() => { deliveries += 1; });
    upstreamListener?.({ isConnected: true, isInternetReachable: true });
    unsubscribe();
    unsubscribe();
    upstreamListener?.({ isConnected: false, isInternetReachable: false });
    subscriptions.push({ shape, deliveries, removals });
  }

  const registerError = new Error('rv10-register');
  const unregisterError = new Error('rv10-unregister');
  const statusError = new Error('rv10-status');
  const rejectingBackground = createExpoBackgroundTaskProvider({
    async registerTaskAsync() { throw registerError; },
    async unregisterTaskAsync() { throw unregisterError; },
  }, {
    async isTaskRegisteredAsync() { throw statusError; },
  });
  const registerProbe = probePromise(rejectingBackground.registerTask({ name: 'rv10.reject' }));
  const unregisterProbe = probePromise(rejectingBackground.unregisterTask('rv10.reject'));
  const statusProbe = probePromise(rejectingBackground.isTaskRegistered!('rv10.reject'));
  await Promise.all([registerProbe.settled, unregisterProbe.settled, statusProbe.settled]);
  const rejectionIdentity = {
    register: registerProbe.state.outcome === 'rejected' && registerProbe.state.reason === registerError,
    unregister: unregisterProbe.state.outcome === 'rejected' && unregisterProbe.state.reason === unregisterError,
    status: statusProbe.state.outcome === 'rejected' && statusProbe.state.reason === statusError,
  };

  let metadataDispatches = 0;
  let metadataOptions: unknown;
  const metadataBackground = createExpoBackgroundTaskProvider({
    async registerTaskAsync(_name, options) {
      metadataDispatches += 1;
      metadataOptions = options;
    },
    async unregisterTaskAsync() {},
  }, {
    async isTaskRegisteredAsync() { return false; },
  });
  const metadata = { owner: 'rv10', generation: 1 };
  const metadataProbe = probePromise(metadataBackground.registerTask({
    name: 'rv10.metadata',
    minimumInterval: 60,
    metadata,
  }));
  await metadataProbe.settled;
  const dispatchedMetadata = typeof metadataOptions === 'object'
    && metadataOptions !== null
    && JSON.stringify(Reflect.get(metadataOptions, 'metadata')) === JSON.stringify(metadata);
  const metadataRefusalShape = errorShape(metadataProbe.state.reason);
  const metadataRefusalTaxonomy = isUnsupportedBackgroundMetadataError(metadataProbe.state.reason);
  const metadataHonest = (metadataProbe.state.outcome === 'rejected'
      && metadataDispatches === 0
      && metadataRefusalTaxonomy)
    || (metadataProbe.state.outcome === 'fulfilled' && metadataDispatches === 1 && dispatchedMetadata);

  const actual = {
    subscriptions,
    rejectionIdentity,
    metadata: {
      outcome: metadataProbe.state.outcome,
      dispatches: metadataDispatches,
      options: metadataOptions,
      dispatchedMetadata,
      refusal: metadataRefusalShape,
      refusalTaxonomyMatches: metadataRefusalTaxonomy,
    },
  };
  const subscriptionsPass = subscriptions.every((entry) => entry.deliveries === 1 && entry.removals === 1);
  const rejectionsPass = Object.values(rejectionIdentity).every(Boolean);
  const currentSignature = subscriptions.every((entry) => entry.deliveries === 2 && entry.removals === 2)
    && rejectionsPass
    && metadataProbe.state.outcome === 'fulfilled'
    && metadataDispatches === 1
    && !dispatchedMetadata;
  return {
    actual,
    desired: 'function/object unsubscribe idempotently remove once and block late delivery; exact background rejections; metadata executes or refuses as Error/RezoError with specific unsupported background-metadata taxonomy',
    desiredPass: subscriptionsPass && rejectionsPass && metadataHonest,
    currentSignature,
  };
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandledRejection);
  const closing = {
    providerSha256: sha256(PROVIDER_PATH),
    typesSha256: sha256(TYPES_PATH),
    carrierSha256: sha256(CARRIER_PATH),
  };
  const registeredActual = [...invocations.keys()].sort();
  const invocationCounts = Object.fromEntries(
    [...invocations.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const expectedRed = [...EXPECTED_RED].sort();
  const red = [...actualRed].sort();
  const controls = [...passed].sort();
  const ledger = {
    schema: 'rezo.react-native.phase5-providers.red-ledger/v1',
    evidence: 'Tier-C injected Node/Bun evidence; no stock/native React Native credit',
    nativeCredit: false,
    file: 'test/a-plus-react-native-phase5-providers.test.ts',
    runtime: typeof process.versions.bun === 'string' ? 'bun' : 'node',
    runtimeVersion: process.versions.bun ?? process.version,
    runner: {
      execPath: process.execPath,
      argv: [...process.argv],
      execArgv: [...process.execArgv],
      cwd: process.cwd(),
    },
    opening: OPENING,
    closing,
    registered: registeredActual,
    invocationCounts,
    expectedRed,
    actualRed: red,
    controls,
    observations: Object.fromEntries(
      [...observations.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    unhandledRejections: unhandledRejections.map(describeUnknown),
    fixtureErrors,
    oracleMismatches,
    cleanupErrors,
  };
  console.log(`REZO_RN_PHASE5_PROVIDERS_RED_LEDGER_V1:${JSON.stringify(ledger)}`);

  const faults: string[] = [];
  if (registeredActual.length !== REGISTERED.length
    || JSON.stringify(registeredActual) !== JSON.stringify([...REGISTERED].sort())) {
    faults.push(`registered:${JSON.stringify(registeredActual)}`);
  }
  if ([...invocations.values()].some((count) => count !== 1)) {
    faults.push(`invocation-counts:${JSON.stringify(invocationCounts)}`);
  }
  if (JSON.stringify(red) !== JSON.stringify(expectedRed)) faults.push(`red:${JSON.stringify(red)}`);
  if (red.length !== 0 || controls.length !== 10) faults.push(`denominator:${red.length}/${controls.length}`);
  if (fixtureErrors.length > 0) faults.push(`fixture:${fixtureErrors.join('|')}`);
  if (oracleMismatches.length > 0) faults.push(`oracle:${oracleMismatches.join('|')}`);
  if (cleanupErrors.length > 0) faults.push(`cleanup:${cleanupErrors.join('|')}`);
  if (unhandledRejections.length > 0) {
    faults.push(`unhandled:${unhandledRejections.map(describeUnknown).join('|')}`);
  }
  if (closing.providerSha256 !== OPENING.providerSha256
    || closing.typesSha256 !== OPENING.typesSha256
    || closing.carrierSha256 !== OPENING.carrierSha256) {
    faults.push('identity-moved');
  }
  if (faults.length > 0) {
    throw new Error(`RN Phase 5 provider RED ledger rejected: ${faults.join('; ')}`);
  }
});
