/**
 * A+ React Native Phase 4 exact-current RED carrier.
 *
 * Tier-C evidence only: every transport and React Native service is injected.
 * Nothing in this file earns Metro, Hermes, JSC, Expo, RNFS, NetInfo, or real
 * operating-system background-task credit.
 *
 * RD-04 and RD-05 remain owned by
 * `test/a-plus-react-native-provider-lifecycle.test.ts`. This carrier owns the
 * other 30 logical RD/RP/RR rows and expands modes/stages inside those rows.
 */

import { afterAll, afterEach, beforeAll, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { DownloadResponse } from '../src/responses/universal/download.js';
import { StreamResponse } from '../src/responses/universal/stream.js';
import { UploadResponse } from '../src/responses/universal/upload.js';
import type {
  RezoReactNativeFileDownloadResult,
  RezoReactNativeFileUploadResult,
  RezoReactNativeStreamResult,
} from '../src/types/react-native.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER_PATH = fileURLToPath(import.meta.url);
const ADAPTER_PATH = resolve(REPO_ROOT, 'src/adapters/react-native.ts');
const PINNED_ADAPTER_SHA256 = 'd637e5c5658fbbb2f473663d85d18ae76968aa0249a15fd0a888d3311c86e3cf';

const APPLICATION_TIMEOUT_MS = 35;
const CURRENT_WINDOW_MS = 85;
const LATE_WINDOW_MS = 35;
const HARNESS_TIMEOUT_MS = 1_200;
const URL_BASE = 'https://phase4.react-native.rezo.test';

const REGISTERED = [
  'RD-01', 'RD-02', 'RD-03', 'RD-06', 'RD-07',
  'RD-08', 'RD-09', 'RD-10', 'RD-11', 'RD-12',
  'RP-01', 'RP-02', 'RP-03', 'RP-04', 'RP-05',
  'RP-06', 'RP-07', 'RP-08', 'RP-09', 'RP-10',
  'RR-01', 'RR-02', 'RR-03', 'RR-04', 'RR-05',
  'RR-06', 'RR-07', 'RR-08', 'RR-09', 'RR-10',
] as const;

type RowId = (typeof REGISTERED)[number];
type NativeMode = 'stream' | 'download' | 'upload';

const EXPECTED_RED: readonly RowId[] = [];

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface ProviderRequest {
  readonly signal?: AbortSignal | null;
  readonly onHeaders?: (event: Record<string, unknown>) => void | Promise<void>;
  readonly onChunk?: (chunk: Uint8Array | string) => void | Promise<void>;
  readonly onProgress?: (event: Record<string, unknown>) => void | Promise<void>;
}

interface FacadeLike {
  on(event: string, listener: (...args: unknown[]) => void): FacadeLike;
  isFinished(): boolean;
}

interface FacadeLedger {
  readonly events: string[];
  readonly errors: Array<{
    code: string | null;
    status: number | null;
    history: number[];
    value: unknown;
  }>;
  readonly headers: number[];
  readonly statuses: number[];
  readonly successes: number[];
  readonly data: string[];
  readonly progress: number[];
  readonly cookies: number[];
  snapshot(): FacadeSnapshot;
}

interface FacadeSnapshot {
  readonly events: string[];
  readonly errorCodes: Array<string | null>;
  readonly errorStatuses: Array<number | null>;
  readonly errorHistories: number[][];
  readonly errorRetryAttempts: Array<number | null>;
  readonly errorMessages: string[];
  readonly errorCauseMessages: Array<string | null>;
  readonly headers: number[];
  readonly headerDetails: Array<{
    status: number | null;
    contentType: string | null;
    providerSource: string | null;
  }>;
  readonly statuses: number[];
  readonly successes: number[];
  readonly successDetails: Array<{
    event: 'finish' | 'done' | 'complete';
    status: number | null;
    finalUrl: string | null;
    retryAttempts: number | null;
    history: number[];
  }>;
  readonly data: string[];
  readonly progress: number[];
  readonly cookies: number[];
  readonly isFinished: boolean;
}

interface RowResult {
  readonly actual: unknown;
  readonly desired: unknown;
  readonly desiredPass: boolean;
  readonly currentSignature: boolean;
}

interface RowObservation {
  readonly actual: unknown;
  readonly desired: unknown;
  readonly desiredPass: boolean;
  readonly currentSignature: boolean;
  readonly timerResidue: number;
  readonly unhandled: string[];
}

interface TimerAudit {
  readonly live: Set<ReturnType<typeof setTimeout>>;
  restore(): void;
  dispose(): void;
}

interface AbortListenerAudit {
  readonly added: number;
  readonly removed: number;
  readonly live: number;
  restore(): void;
}

const invocations = new Map<RowId, number>();
const observations = new Map<RowId, RowObservation>();
const actualRed = new Set<RowId>();
const passed = new Set<RowId>();
const fixtureErrors: string[] = [];
const oracleMismatches: string[] = [];
const cleanupErrors: string[] = [];
const unhandledRejections: unknown[] = [];
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`RN Phase 4 carrier infrastructure invalidity: ${message}`);
    this.name = 'InfrastructureError';
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const OPENING = Object.freeze({
  adapterSha256: sha256(ADAPTER_PATH),
  carrierSha256: sha256(CARRIER_PATH),
});

if (OPENING.adapterSha256 !== PINNED_ADAPTER_SHA256) {
  throw new InfrastructureError(
    `react-native adapter actual ${OPENING.adapterSha256} expected ${PINNED_ADAPTER_SHA256}`,
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>['resolve'];
  let rejectPromise!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
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

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const code = Reflect.get(value, 'code');
  return typeof code === 'string' ? code : null;
}

function errorStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = Reflect.get(value, 'response');
  if (typeof response !== 'object' || response === null) return null;
  const status = Reflect.get(response, 'status');
  return typeof status === 'number' ? status : null;
}

function errorResponse(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return null;
  return Reflect.get(value, 'response') ?? null;
}

function eventStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const direct = Reflect.get(value, 'status');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(value, 'response');
  if (typeof response !== 'object' || response === null) return null;
  const nested = Reflect.get(response, 'status');
  return typeof nested === 'number' ? nested : null;
}

function retryHistory(value: unknown): number[] {
  if (typeof value !== 'object' || value === null) return [];
  const config = Reflect.get(value, 'config');
  if (typeof config !== 'object' || config === null) return [];
  const errors = Reflect.get(config, 'errors');
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const attempt = Reflect.get(entry, 'attempt');
    return typeof attempt === 'number' ? [attempt] : [];
  });
}

function retryAttempts(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const config = Reflect.get(value, 'config');
  if (typeof config !== 'object' || config === null) return null;
  const attempts = Reflect.get(config, 'retryAttempts');
  return typeof attempts === 'number' ? attempts : null;
}

function errorMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value);
  const message = Reflect.get(value, 'message');
  return typeof message === 'string' ? message : String(value);
}

function causeMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const cause = Reflect.get(value, 'cause');
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null) {
    const message = Reflect.get(cause, 'message');
    if (typeof message === 'string') return message;
  }
  return cause === undefined || cause === null ? null : String(cause);
}

function eventFinalUrl(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const finalUrl = Reflect.get(value, 'finalUrl');
  return typeof finalUrl === 'string' ? finalUrl : null;
}

function eventHeader(value: unknown, name: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const headers = Reflect.get(value, 'headers');
  if (typeof headers !== 'object' || headers === null) return null;
  const get = Reflect.get(headers, 'get');
  if (typeof get === 'function') {
    const result = Reflect.apply(get, headers, [name]);
    return typeof result === 'string' ? result : null;
  }
  const direct = Reflect.get(headers, name);
  return typeof direct === 'string' ? direct : null;
}

function configMutationSnapshot(config: unknown): Record<string, unknown> | null {
  if (typeof config !== 'object' || config === null) return null;
  const transfer = Reflect.get(config, 'transfer');
  const responseCookies = Reflect.get(config, 'responseCookies');
  return {
    status: Reflect.get(config, 'status') ?? null,
    statusText: Reflect.get(config, 'statusText') ?? null,
    finalUrl: Reflect.get(config, 'finalUrl') ?? null,
    bodySize: typeof transfer === 'object' && transfer !== null
      ? (Reflect.get(transfer, 'bodySize') ?? null)
      : null,
    responseSize: typeof transfer === 'object' && transfer !== null
      ? (Reflect.get(transfer, 'responseSize') ?? null)
      : null,
    responseCookieCount: typeof responseCookies === 'object' && responseCookies !== null
      && Array.isArray(Reflect.get(responseCookies, 'array'))
      ? (Reflect.get(responseCookies, 'array') as unknown[]).length
      : null,
  };
}

function backgroundTaskMutationSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const config = Reflect.get(value, 'config');
  if (typeof config !== 'object' || config === null) return null;
  const trackingData = Reflect.get(config, 'trackingData');
  if (typeof trackingData !== 'object' || trackingData === null) return null;
  const reactNative = Reflect.get(trackingData, 'reactNative');
  if (typeof reactNative !== 'object' || reactNative === null) return null;
  const backgroundTask = Reflect.get(reactNative, 'backgroundTask');
  if (typeof backgroundTask !== 'object' || backgroundTask === null) return null;
  const active = Reflect.get(backgroundTask, 'active');
  const unregistered = Reflect.get(backgroundTask, 'unregistered');
  const unregisterError = Reflect.get(backgroundTask, 'unregisterError');
  return {
    active: typeof active === 'boolean' ? active : null,
    unregistered: typeof unregistered === 'boolean' ? unregistered : null,
    unregisterError: typeof unregisterError === 'string' ? unregisterError : null,
  };
}

function installAbortListenerAudit(signal: AbortSignal): AbortListenerAudit {
  const nativeAdd = signal.addEventListener.bind(signal);
  const nativeRemove = signal.removeEventListener.bind(signal);
  const wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
  const live = new Set<EventListenerOrEventListenerObject>();
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
      live.add(listener);
      const once = typeof options === 'object' && options?.once === true;
      const delegate: EventListener = (event) => {
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

function observeFacade(facade: FacadeLike): FacadeLedger {
  const events: string[] = [];
  const errors: FacadeLedger['errors'] = [];
  const headers: number[] = [];
  const statuses: number[] = [];
  const successes: number[] = [];
  const data: string[] = [];
  const progress: number[] = [];
  const cookies: number[] = [];
  const headerDetails: FacadeSnapshot['headerDetails'] = [];
  const successDetails: FacadeSnapshot['successDetails'] = [];

  facade.on('error', (error) => {
    events.push('error');
    errors.push({
      code: errorCode(error),
      status: errorStatus(error),
      history: retryHistory(error),
      value: error,
    });
  });
  facade.on('headers', (event) => {
    events.push('headers');
    const status = eventStatus(event);
    if (status !== null) headers.push(status);
    headerDetails.push({
      status,
      contentType: eventHeader(event, 'content-type'),
      providerSource: eventHeader(event, 'x-provider-source'),
    });
  });
  facade.on('status', (status) => {
    events.push('status');
    if (typeof status === 'number') statuses.push(status);
  });
  facade.on('data', (chunk) => {
    events.push('data');
    data.push(typeof chunk === 'string' ? chunk : String(chunk));
  });
  facade.on('progress', (event) => {
    events.push('progress');
    if (typeof event === 'object' && event !== null) {
      const loaded = Reflect.get(event, 'loaded');
      if (typeof loaded === 'number') progress.push(loaded);
    }
  });
  facade.on('cookies', (event) => {
    events.push('cookies');
    cookies.push(Array.isArray(event) ? event.length : 0);
  });
  for (const terminal of ['finish', 'done', 'complete'] as const) {
    facade.on(terminal, (event) => {
      events.push(terminal);
      const status = eventStatus(event);
      if (status !== null) successes.push(status);
      successDetails.push({
        event: terminal,
        status,
        finalUrl: eventFinalUrl(event),
        retryAttempts: retryAttempts(event),
        history: retryHistory(event),
      });
    });
  }
  facade.on('end', () => events.push('end'));

  return {
    events,
    errors,
    headers,
    statuses,
    successes,
    data,
    progress,
    cookies,
    snapshot: () => ({
      events: [...events],
      errorCodes: errors.map((entry) => entry.code),
      errorStatuses: errors.map((entry) => entry.status),
      errorHistories: errors.map((entry) => [...entry.history]),
      errorRetryAttempts: errors.map((entry) => retryAttempts(entry.value)),
      errorMessages: errors.map((entry) => errorMessage(entry.value)),
      errorCauseMessages: errors.map((entry) => causeMessage(entry.value)),
      headers: [...headers],
      headerDetails: headerDetails.map((entry) => ({ ...entry })),
      statuses: [...statuses],
      successes: [...successes],
      successDetails: successDetails.map((entry) => ({ ...entry, history: [...entry.history] })),
      data: [...data],
      progress: [...progress],
      cookies: [...cookies],
      isFinished: facade.isFinished(),
    }),
  };
}

function terminalCount(snapshot: FacadeSnapshot): number {
  return snapshot.events.filter((event) => event === 'error' || event === 'complete').length;
}

function validResult(mode: NativeMode, status = 200, url = `${URL_BASE}/result`):
RezoReactNativeStreamResult | RezoReactNativeFileDownloadResult | RezoReactNativeFileUploadResult {
  const base = {
    status,
    statusText: status >= 400 ? 'Failure' : status === 201 ? 'Created' : 'OK',
    headers: { 'content-type': mode === 'download' ? 'application/octet-stream' : 'text/plain' },
    finalUrl: url,
    contentType: mode === 'download' ? 'application/octet-stream' : 'text/plain',
    contentLength: mode === 'download' ? 4 : 2,
  };
  if (mode === 'download') return { ...base, filePath: '/tmp/rezo-rn-phase4.bin', fileSize: 4 };
  if (mode === 'upload') return { ...base, body: 'ok', uploadSize: 4, fileName: 'phase4.bin' };
  return base;
}

function createFacade(mode: NativeMode): FacadeLike {
  if (mode === 'stream') return new StreamResponse() as unknown as FacadeLike;
  if (mode === 'download') {
    return new DownloadResponse('/tmp/rezo-rn-phase4.bin', `${URL_BASE}/download`) as unknown as FacadeLike;
  }
  return new UploadResponse(`${URL_BASE}/upload`, 'phase4.bin') as unknown as FacadeLike;
}

interface NativeExecution {
  readonly facade: FacadeLike;
  readonly ledger: FacadeLedger;
  readonly returned: unknown;
}

async function executeNative(
  mode: NativeMode,
  provider: (request: ProviderRequest) => Promise<unknown>,
  requestExtras: Record<string, unknown> = {},
  defaultExtras: Record<string, unknown> = {},
): Promise<NativeExecution> {
  const facade = createFacade(mode);
  const ledger = observeFacade(facade);
  const request: Record<string, unknown> = {
    url: `${URL_BASE}/${mode}`,
    method: mode === 'upload' ? 'POST' : 'GET',
    retry: false,
    cache: false,
    ...requestExtras,
  };
  const reactNative: Record<string, unknown> = { ...defaultExtras };

  if (mode === 'stream') {
    request.responseType = 'stream';
    request._streamResponse = facade;
    reactNative.streamTransport = { name: 'phase4-stream', stream: provider };
  } else if (mode === 'download') {
    request.saveTo = '/tmp/rezo-rn-phase4.bin';
    request._isDownload = true;
    request._downloadResponse = facade;
    reactNative.fileSystemAdapter = {
      name: 'phase4-file-system',
      capabilities: { fileDownload: true, downloadProgress: true },
      downloadFile: provider,
    };
  } else {
    request.body = {
      uri: 'file:///tmp/rezo-rn-phase4.bin',
      name: 'phase4.bin',
      type: 'application/octet-stream',
      size: 4,
    };
    request._isUpload = true;
    request._uploadResponse = facade;
    reactNative.fileSystemAdapter = {
      name: 'phase4-file-system',
      capabilities: { uploadFromFile: true, uploadProgress: true },
      uploadFile: provider,
    };
  }

  const returned = await withWatchdog(
    executeRequest(request as never, { reactNative } as never, new RezoCookieJar()),
    `${mode} facade return`,
  );
  if (returned !== facade) throw new InfrastructureError(`${mode} returned a different facade`);
  return { facade, ledger, returned };
}

function installFetch(
  implementation: (url: string, init: RequestInit) => Promise<Response>,
): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: implementation,
  });
}

function response(spec: {
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
  readonly url?: string;
  readonly text?: () => Promise<string>;
  readonly body?: string;
}): Response {
  const body = spec.body ?? 'ok';
  const headers = new Headers(spec.headers ?? { 'content-type': 'text/plain' });
  return {
    status: spec.status ?? 200,
    statusText: spec.statusText ?? ((spec.status ?? 200) >= 400 ? 'Failure' : 'OK'),
    headers,
    url: spec.url ?? `${URL_BASE}/fetch-final`,
    text: spec.text ?? (async () => body),
    async json() { return JSON.parse(body); },
    async arrayBuffer() { return new TextEncoder().encode(body).buffer; },
    async blob() { return new Blob([body]); },
  } as Response;
}

async function executeBuffered(
  requestExtras: Record<string, unknown> = {},
  defaults: Record<string, unknown> = {},
): Promise<unknown> {
  return executeRequest({
    url: `${URL_BASE}/fetch`,
    method: 'GET',
    retry: false,
    cache: false,
    ...requestExtras,
  } as never, defaults as never, new RezoCookieJar());
}

async function waitForTerminal(ledger: FacadeLedger, label: string): Promise<FacadeSnapshot> {
  await waitFor(() => terminalCount(ledger.snapshot()) > 0, `${label} produced no terminal`);
  return ledger.snapshot();
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

function logicalRow(
  id: RowId,
  title: string,
  operation: () => Promise<RowResult>,
): void {
  it(`${id} ${title}`, async () => {
    invocations.set(id, (invocations.get(id) ?? 0) + 1);
    const unhandledStart = unhandledRejections.length;
    const timerAudit = installTimerAudit();
    let result: RowResult | undefined;
    let operationError: unknown;
    let operationCompleted = false;
    let timerResidue = 0;
    try {
      result = await withWatchdog(operation(), `${id} operation`);
      await delay(LATE_WINDOW_MS);
      operationCompleted = true;
    } catch (error) {
      fixtureErrors.push(`${id}:${describeUnknown(error)}`);
      operationError = error;
    } finally {
      timerAudit.restore();
      timerResidue = timerAudit.live.size;
      if (timerResidue > 0) {
        cleanupErrors.push(`${id}:timers:${timerResidue}`);
        timerAudit.dispose();
      }
    }

    if (!operationCompleted || result === undefined) throw operationError;
    const unhandled = unhandledRejections
      .slice(unhandledStart)
      .map(describeUnknown);
    const observation: RowObservation = {
      actual: result.actual,
      desired: result.desired,
      desiredPass: result.desiredPass,
      currentSignature: result.currentSignature,
      timerResidue,
      unhandled,
    };
    observations.set(id, observation);

    if (result.desiredPass && timerResidue === 0 && unhandled.length === 0) {
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

beforeAll(() => {
  process.on('unhandledRejection', onUnhandledRejection);
});

afterEach(() => {
  if (originalFetchDescriptor) {
    Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

function onUnhandledRejection(reason: unknown): void {
  unhandledRejections.push(reason);
}

interface PromiseState {
  outcome: 'pending' | 'fulfilled' | 'rejected';
  code: string | null;
  status: number | null;
  value: unknown;
}

function trackPromise(promise: Promise<unknown>): PromiseState {
  const state: PromiseState = {
    outcome: 'pending',
    code: null,
    status: null,
    value: undefined,
  };
  void promise.then(
    (value) => {
      state.outcome = 'fulfilled';
      state.status = eventStatus(value);
      state.value = value;
    },
    (error) => {
      state.outcome = 'rejected';
      state.code = errorCode(error);
      state.status = errorStatus(error);
      state.value = error;
    },
  );
  return state;
}

function promiseSnapshot(state: PromiseState): Omit<PromiseState, 'value'> {
  return { outcome: state.outcome, code: state.code, status: state.status };
}

// --------------------------------------------------------------- RD rows --

logicalRow('RD-01', 'numeric total positive control succeeds below its budget and disposes ownership', async () => {
  let calls = 0;
  let aborts = 0;
  const execution = await executeNative('stream', async (request) => {
    calls += 1;
    request.signal?.addEventListener('abort', () => { aborts += 1; }, { once: true });
    await request.onHeaders?.({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      finalUrl: `${URL_BASE}/rd01`,
      contentLength: 2,
    });
    await request.onChunk?.('ok');
    await delay(5);
    return validResult('stream', 200, `${URL_BASE}/rd01`);
  }, { timeout: 80 });
  const terminal = await waitForTerminal(execution.ledger, 'RD-01');
  const actual = {
    calls,
    aborts,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    status: terminal.successes.at(-1) ?? null,
    data: terminal.data,
    successFamily: terminal.events.filter((event) => (
      event === 'finish' || event === 'done' || event === 'complete'
    )),
    endCount: terminal.events.filter((event) => event === 'end').length,
    finished: terminal.isFinished,
  };
  const desired = {
    calls: 1,
    aborts: 0,
    errors: 0,
    completes: 1,
    status: 200,
    data: ['ok'],
    successFamily: ['finish', 'done', 'complete'],
    endCount: 1,
    finished: true,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: true,
  };
});

logicalRow('RD-02', 'pre-aborted prepared signal prevents every preflight and transport dispatch', async () => {
  const modes = ['fetch', 'stream', 'download', 'upload'] as const;
  const actual: Array<Record<string, unknown>> = [];

  for (const mode of modes) {
    const controller = new AbortController();
    const listenerAudit = installAbortListenerAudit(controller.signal);
    controller.abort();
    let netInfoCalls = 0;
    let backgroundCalls = 0;
    let transportCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    const hooks = {
      onAbort: [async () => { onAbortCalls += 1; }],
      onTimeout: [async () => { onTimeoutCalls += 1; }],
    };
    const reactNativeServices = {
      networkInfoProvider: {
        async fetch() {
          netInfoCalls += 1;
          return { isConnected: true, isInternetReachable: true };
        },
      },
      backgroundTask: { enabled: true, name: `rd02-${mode}` },
      backgroundTaskProvider: {
        async isTaskRegistered() { backgroundCalls += 1; return true; },
        async registerTask() { backgroundCalls += 1; },
        async unregisterTask() { backgroundCalls += 1; },
      },
    };

    if (mode === 'fetch') {
      installFetch(async () => {
        transportCalls += 1;
        return response({ status: 200 });
      });
      const pending = executeBuffered(
        { signal: controller.signal, hooks },
        { reactNative: reactNativeServices },
      );
      const state = trackPromise(pending);
      await waitFor(() => state.outcome !== 'pending', 'RD-02 fetch did not settle');
      actual.push({
        mode,
        netInfoCalls,
        backgroundCalls,
        transportCalls,
        outcome: state.outcome,
        code: state.code,
        onAbortCalls,
        onTimeoutCalls,
        callerListeners: {
          added: listenerAudit.added,
          removed: listenerAudit.removed,
          live: listenerAudit.live,
        },
      });
    } else {
      const execution = await executeNative(mode, async () => {
        transportCalls += 1;
        return validResult(mode, 200, `${URL_BASE}/rd02-${mode}`);
      }, { signal: controller.signal, hooks }, reactNativeServices);
      const terminal = await waitForTerminal(execution.ledger, `RD-02 ${mode}`);
      actual.push({
        mode,
        netInfoCalls,
        backgroundCalls,
        transportCalls,
        errors: terminal.errorCodes,
        successes: terminal.successes.length,
        terminalCount: terminalCount(terminal),
        onAbortCalls,
        onTimeoutCalls,
        callerListeners: {
          added: listenerAudit.added,
          removed: listenerAudit.removed,
          live: listenerAudit.live,
        },
      });
    }
    listenerAudit.restore();
  }

  const desired = modes.map((mode) => ({
    mode,
    netInfoCalls: 0,
    backgroundCalls: 0,
    transportCalls: 0,
    aborted: true,
  }));
  const desiredPass = actual.every((entry) => (
    entry.netInfoCalls === 0
    && entry.backgroundCalls === 0
    && entry.transportCalls === 0
    && entry.onAbortCalls === 1
    && entry.onTimeoutCalls === 0
    && (entry.callerListeners as { live: number }).live === 0
    && (
      (entry.outcome === 'rejected' && entry.code === 'ABORT_ERR')
      || (
        JSON.stringify(entry.errors) === '["ABORT_ERR"]'
        && entry.terminalCount === 1
        && entry.successes === 0
      )
    )
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      Number(entry.netInfoCalls) > 0
      && Number(entry.backgroundCalls) > 0
      && Number(entry.transportCalls) > 0
    )),
  };
});

logicalRow('RD-03', 'mid-flight caller abort hard-settles a non-cooperative native provider', async () => {
  const entered = createDeferred<void>();
  const release = createDeferred<unknown>();
  const controller = new AbortController();
  let calls = 0;
  let providerSignalAborts = 0;
  let providerSignalWasPresent = false;
  let onAbortCalls = 0;
  let onTimeoutCalls = 0;
  const listenerAudit = installAbortListenerAudit(controller.signal);
  const execution = await executeNative('stream', async (request) => {
    calls += 1;
    providerSignalWasPresent = request.signal instanceof AbortSignal;
    request.signal?.addEventListener('abort', () => { providerSignalAborts += 1; }, { once: true });
    entered.resolve(undefined);
    return release.promise;
  }, {
    signal: controller.signal,
    hooks: {
      onAbort: [async () => { onAbortCalls += 1; }],
      onTimeout: [async () => { onTimeoutCalls += 1; }],
    },
  });
  await entered.promise;
  controller.abort();
  await delay(CURRENT_WINDOW_MS);
  const atAbort = execution.ledger.snapshot();
  release.resolve(validResult('stream', 200, `${URL_BASE}/rd03`));
  await delay(LATE_WINDOW_MS);
  const afterRelease = execution.ledger.snapshot();
  const callerListeners = {
    added: listenerAudit.added,
    removed: listenerAudit.removed,
    live: listenerAudit.live,
  };
  listenerAudit.restore();
  const actual = {
    calls,
    providerSignalWasPresent,
    providerSignalAborts,
    onAbortCalls,
    onTimeoutCalls,
    callerListeners,
    atAbort,
    afterRelease,
  };
  const desired = {
    calls: 1,
    providerSignalWasPresent: true,
    providerSignalAborts: 1,
    terminal: ['error'],
    lateStable: true,
  };
  const desiredPass = providerSignalAborts === 1
    && JSON.stringify(atAbort.errorCodes) === '["ABORT_ERR"]'
    && terminalCount(atAbort) === 1
    && onAbortCalls === 1
    && onTimeoutCalls === 0
    && callerListeners.added >= 1
    && callerListeners.live === 0
    && JSON.stringify(atAbort) === JSON.stringify(afterRelease);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: providerSignalWasPresent && providerSignalAborts === 0 && terminalCount(atAbort) === 0,
  };
});

logicalRow('RD-06', 'total deadline and caller abort own a hanging NetInfo preflight', async () => {
  const variants = ['timeout', 'signal'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const networkRelease = createDeferred<{ isConnected: boolean; isInternetReachable: boolean }>();
    const controller = new AbortController();
    const listenerAudit = variant === 'signal' ? installAbortListenerAudit(controller.signal) : null;
    let networkCalls = 0;
    let backgroundCalls = 0;
    let transportCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    installFetch(async () => {
      transportCalls += 1;
      return response({ status: 200 });
    });
    const pending = executeBuffered({
      ...(variant === 'timeout' ? { timeout: APPLICATION_TIMEOUT_MS } : { signal: controller.signal }),
      hooks: {
        onAbort: [async () => { onAbortCalls += 1; }],
        onTimeout: [async () => { onTimeoutCalls += 1; }],
      },
    }, {
      reactNative: {
        networkInfoProvider: {
          fetch() {
            networkCalls += 1;
            return networkRelease.promise;
          },
        },
        backgroundTask: { enabled: true, name: `rd06-${variant}` },
        backgroundTaskProvider: {
          async isTaskRegistered() { backgroundCalls += 1; return true; },
          async registerTask() { backgroundCalls += 1; },
          async unregisterTask() { backgroundCalls += 1; },
        },
      },
    });
    const state = trackPromise(pending);
    await waitFor(() => networkCalls === 1, `RD-06 ${variant} never entered NetInfo`);
    if (variant === 'signal') controller.abort();
    await delay(CURRENT_WINDOW_MS);
    const atBoundary = promiseSnapshot(state);
    const transportCallsAtBoundary = transportCalls;
    const backgroundCallsAtBoundary = backgroundCalls;
    networkRelease.resolve({ isConnected: true, isInternetReachable: true });
    await waitFor(() => state.outcome !== 'pending', `RD-06 ${variant} did not settle after release`);
    await delay(LATE_WINDOW_MS);
    const afterRelease = promiseSnapshot(state);
    const callerListeners = listenerAudit === null ? null : {
      added: listenerAudit.added,
      removed: listenerAudit.removed,
      live: listenerAudit.live,
    };
    listenerAudit?.restore();
    actual.push({
      variant,
      networkCalls,
      backgroundCallsAtBoundary,
      finalBackgroundCalls: backgroundCalls,
      transportCallsAtBoundary,
      finalTransportCalls: transportCalls,
      atBoundary,
      afterRelease,
      onAbortCalls,
      onTimeoutCalls,
      callerListeners,
    });
  }
  const desired = variants.map((variant) => ({
    variant,
    networkCalls: 1,
    transportCallsAtBoundary: 0,
    atBoundary: { outcome: 'rejected', typedCancellation: true },
  }));
  const desiredPass = actual.every((entry) => (
    (entry.atBoundary as { outcome: string }).outcome === 'rejected'
    && (entry.atBoundary as { code: string | null }).code === (entry.variant === 'signal' ? 'ABORT_ERR' : 'ETIMEDOUT')
    && entry.transportCallsAtBoundary === 0
    && entry.finalTransportCalls === 0
    && entry.backgroundCallsAtBoundary === entry.finalBackgroundCalls
    && JSON.stringify(entry.atBoundary) === JSON.stringify(entry.afterRelease)
    && entry.onAbortCalls === (entry.variant === 'signal' ? 1 : 0)
    && entry.onTimeoutCalls === (entry.variant === 'timeout' ? 1 : 0)
    && (
      entry.variant !== 'signal'
      || (
        (entry.callerListeners as { added: number; live: number }).added >= 1
        && (entry.callerListeners as { added: number; live: number }).live === 0
      )
    )
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      (entry.atBoundary as { outcome: string }).outcome === 'pending'
      && entry.transportCallsAtBoundary === 0
      && entry.finalTransportCalls === 1
      && (entry.afterRelease as { outcome: string }).outcome === 'fulfilled'
    )),
  };
});

logicalRow('RD-07', 'root lifetime owns background isTaskRegistered and registerTask preflight', async () => {
  const stages = ['isTaskRegistered', 'registerTask'] as const;
  const variants = ['timeout', 'signal'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    for (const variant of variants) {
      const gate = createDeferred<boolean | void>();
      const controller = new AbortController();
      const listenerAudit = variant === 'signal' ? installAbortListenerAudit(controller.signal) : null;
      let stageCalls = 0;
      let unregisterCalls = 0;
      let transportCalls = 0;
      let onAbortCalls = 0;
      let onTimeoutCalls = 0;
      installFetch(async () => {
        transportCalls += 1;
        return response({ status: 200 });
      });
      const provider = {
        async isTaskRegistered() {
          if (stage !== 'isTaskRegistered') return false;
          stageCalls += 1;
          return gate.promise as Promise<boolean>;
        },
        async registerTask() {
          if (stage === 'registerTask') {
            stageCalls += 1;
            await gate.promise;
          }
        },
        async unregisterTask() { unregisterCalls += 1; },
      };
      const pending = executeBuffered({
        ...(variant === 'timeout' ? { timeout: APPLICATION_TIMEOUT_MS } : { signal: controller.signal }),
        hooks: {
          onAbort: [async () => { onAbortCalls += 1; }],
          onTimeout: [async () => { onTimeoutCalls += 1; }],
        },
      }, {
        reactNative: {
          backgroundTask: { enabled: true, name: `rd07-${stage}-${variant}` },
          backgroundTaskProvider: provider,
        },
      });
      const state = trackPromise(pending);
      await waitFor(() => stageCalls === 1, `RD-07 ${stage}/${variant} was not entered`);
      if (variant === 'signal') controller.abort();
      await delay(CURRENT_WINDOW_MS);
      const atDeadline = promiseSnapshot(state);
      const transportCallsAtDeadline = transportCalls;
      gate.resolve(stage === 'isTaskRegistered' ? true : undefined);
      await waitFor(() => state.outcome !== 'pending', `RD-07 ${stage}/${variant} did not settle after release`);
      await delay(LATE_WINDOW_MS);
      const afterRelease = promiseSnapshot(state);
      const callerListeners = listenerAudit === null ? null : {
        added: listenerAudit.added,
        removed: listenerAudit.removed,
        live: listenerAudit.live,
      };
      listenerAudit?.restore();
      actual.push({
        stage,
        variant,
        stageCalls,
        unregisterCalls,
        transportCallsAtDeadline,
        finalTransportCalls: transportCalls,
        atDeadline,
        afterRelease,
        onAbortCalls,
        onTimeoutCalls,
        callerListeners,
      });
    }
  }
  const desired = stages.flatMap((stage) => variants.map((variant) => ({
    stage,
    variant,
    atDeadline: 'typed rejection',
    finalTransportCalls: 0,
    unregisterCalls: 0,
  })));
  const desiredPass = actual.every((entry) => (
    (entry.atDeadline as { outcome: string }).outcome === 'rejected'
    && (entry.atDeadline as { code: string | null }).code === (entry.variant === 'signal' ? 'ABORT_ERR' : 'ETIMEDOUT')
    && entry.transportCallsAtDeadline === 0
    && entry.finalTransportCalls === 0
    && entry.unregisterCalls === 0
    && JSON.stringify(entry.atDeadline) === JSON.stringify(entry.afterRelease)
    && entry.onAbortCalls === (entry.variant === 'signal' ? 1 : 0)
    && entry.onTimeoutCalls === (entry.variant === 'timeout' ? 1 : 0)
    && (
      entry.variant !== 'signal'
      || (
        (entry.callerListeners as { added: number; live: number }).added >= 1
        && (entry.callerListeners as { added: number; live: number }).live === 0
      )
    )
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      (entry.atDeadline as { outcome: string }).outcome === 'pending'
      && entry.transportCallsAtDeadline === 0
      && entry.finalTransportCalls === 1
      && (entry.afterRelease as { outcome: string }).outcome === 'fulfilled'
    )),
  };
});

logicalRow('RD-08', 'background unregister cleanup cannot outlive the request total', async () => {
  const unregisterGate = createDeferred<void>();
  let unregisterCalls = 0;
  let fetchCalls = 0;
  let onAbortCalls = 0;
  let onTimeoutCalls = 0;
  installFetch(async () => {
    fetchCalls += 1;
    return response({ status: 200 });
  });
  const facade = new UploadResponse(`${URL_BASE}/rd08`, 'buffered') as unknown as FacadeLike;
  const ledger = observeFacade(facade);
  const returned = await executeRequest({
    url: `${URL_BASE}/rd08`,
    method: 'POST',
    body: 'payload',
    _isUpload: true,
    _uploadResponse: facade,
    retry: false,
    cache: false,
    timeout: APPLICATION_TIMEOUT_MS,
    hooks: {
      onAbort: [async () => { onAbortCalls += 1; }],
      onTimeout: [async () => { onTimeoutCalls += 1; }],
    },
  } as never, {
    reactNative: {
      backgroundTask: { enabled: true, name: 'rd08', keepRegistered: false },
      backgroundTaskProvider: {
        async isTaskRegistered() { return false; },
        async registerTask() {},
        async unregisterTask() {
          unregisterCalls += 1;
          await unregisterGate.promise;
        },
      },
    },
  } as never, new RezoCookieJar());
  if (returned !== facade) throw new InfrastructureError('RD-08 Fetch facade identity moved');
  await waitFor(() => unregisterCalls === 1, 'RD-08 did not enter unregisterTask');
  await delay(CURRENT_WINDOW_MS);
  const atDeadline = ledger.snapshot();
  unregisterGate.resolve(undefined);
  await delay(LATE_WINDOW_MS);
  const afterRelease = ledger.snapshot();
  const cleanup = {
    fetchCalls,
    unregisterCalls,
    onAbortCalls,
    onTimeoutCalls,
    atDeadline,
    afterRelease,
  };
  const cancellation: Array<Record<string, unknown>> = [];
  for (const variant of ['timeout', 'signal'] as const) {
    for (const lateSettlement of ['resolve', 'reject'] as const) {
      const controller = new AbortController();
      const listenerAudit = variant === 'signal' ? installAbortListenerAudit(controller.signal) : null;
      const cancellationUnregisterGate = createDeferred<void>();
      let cancellationRegisterCalls = 0;
      let cancellationUnregisterCalls = 0;
      let cancellationFetchCalls = 0;
      let cancellationOnAbortCalls = 0;
      let cancellationOnTimeoutCalls = 0;
      installFetch(async (_url, init) => {
        cancellationFetchCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      });
      const cancellationFacade = new UploadResponse(
        `${URL_BASE}/rd08-${variant}-${lateSettlement}`,
        'buffered',
      ) as unknown as FacadeLike;
      const cancellationLedger = observeFacade(cancellationFacade);
      const cancellationReturned = await executeRequest({
        url: `${URL_BASE}/rd08-${variant}-${lateSettlement}`,
        method: 'POST',
        body: 'payload',
        _isUpload: true,
        _uploadResponse: cancellationFacade,
        retry: false,
        cache: false,
        ...(variant === 'timeout'
          ? { timeout: APPLICATION_TIMEOUT_MS }
          : { signal: controller.signal }),
        hooks: {
          onAbort: [async () => { cancellationOnAbortCalls += 1; }],
          onTimeout: [async () => { cancellationOnTimeoutCalls += 1; }],
        },
      } as never, {
        reactNative: {
          backgroundTask: {
            enabled: true,
            name: `rd08-${variant}-${lateSettlement}`,
            keepRegistered: false,
          },
          backgroundTaskProvider: {
            async isTaskRegistered() { return false; },
            async registerTask() { cancellationRegisterCalls += 1; },
            async unregisterTask() {
              cancellationUnregisterCalls += 1;
              await cancellationUnregisterGate.promise;
            },
          },
        },
      } as never, new RezoCookieJar());
      if (cancellationReturned !== cancellationFacade) {
        throw new InfrastructureError(`RD-08 ${variant}/${lateSettlement} Fetch facade identity moved`);
      }
      await waitFor(
        () => cancellationFetchCalls === 1,
        `RD-08 ${variant}/${lateSettlement} did not dispatch Fetch`,
      );
      if (variant === 'signal') controller.abort();
      const cancellationTerminal = await waitForTerminal(
        cancellationLedger,
        `RD-08 ${variant}/${lateSettlement} cancellation`,
      );
      await waitFor(
        () => cancellationUnregisterCalls === 1,
        `RD-08 ${variant}/${lateSettlement} did not enter unregisterTask`,
      );
      const terminalError = cancellationLedger.errors.at(-1)?.value;
      const terminalConfig = backgroundTaskMutationSnapshot(terminalError);
      if (lateSettlement === 'resolve') {
        cancellationUnregisterGate.resolve(undefined);
      } else {
        cancellationUnregisterGate.reject(new Error('late unregister rejection'));
      }
      await delay(LATE_WINDOW_MS);
      const callerListeners = listenerAudit === null ? null : {
        added: listenerAudit.added,
        removed: listenerAudit.removed,
        live: listenerAudit.live,
      };
      listenerAudit?.restore();
      cancellation.push({
        variant,
        lateSettlement,
        registerCalls: cancellationRegisterCalls,
        unregisterCalls: cancellationUnregisterCalls,
        fetchCalls: cancellationFetchCalls,
        onAbortCalls: cancellationOnAbortCalls,
        onTimeoutCalls: cancellationOnTimeoutCalls,
        terminal: cancellationTerminal,
        final: cancellationLedger.snapshot(),
        terminalConfig,
        afterLateConfig: backgroundTaskMutationSnapshot(terminalError),
        callerListeners,
      });
    }
  }
  const actual = { cleanup, cancellation };
  const desired = {
    cleanup: {
      fetchCalls: 1,
      unregisterCalls: 1,
      errorCodes: ['ETIMEDOUT'],
      successFamily: [],
      onTimeoutCalls: 1,
      onAbortCalls: 0,
      lateStable: true,
    },
    cancellation: 'registered task unregisters once after timeout/abort; late resolve/reject cannot mutate public/config terminal state',
  };
  const cleanupPass = fetchCalls === 1
    && unregisterCalls === 1
    && JSON.stringify(atDeadline.errorCodes) === '["ETIMEDOUT"]'
    && terminalCount(atDeadline) === 1
    && atDeadline.successDetails.length === 0
    && onTimeoutCalls === 1
    && onAbortCalls === 0
    && JSON.stringify(atDeadline) === JSON.stringify(afterRelease);
  const cancellationPass = cancellation.every((entry) => {
    const terminal = entry.terminal as FacadeSnapshot;
    return entry.registerCalls === 1
      && entry.unregisterCalls === 1
      && entry.fetchCalls === 1
      && JSON.stringify(terminal.errorCodes)
        === JSON.stringify([entry.variant === 'signal' ? 'ABORT_ERR' : 'ETIMEDOUT'])
      && terminalCount(terminal) === 1
      && terminal.successDetails.length === 0
      && entry.onAbortCalls === (entry.variant === 'signal' ? 1 : 0)
      && entry.onTimeoutCalls === (entry.variant === 'timeout' ? 1 : 0)
      && JSON.stringify(terminal) === JSON.stringify(entry.final)
      && JSON.stringify(entry.terminalConfig) === JSON.stringify(entry.afterLateConfig)
      && (
        entry.variant !== 'signal'
        || (
          (entry.callerListeners as { added: number; live: number }).added >= 1
          && (entry.callerListeners as { live: number }).live === 0
        )
      );
  });
  return {
    actual,
    desired,
    desiredPass: cleanupPass && cancellationPass,
    currentSignature: cleanupPass && cancellation.every((entry) => {
      const terminal = entry.terminal as FacadeSnapshot;
      const terminalConfig = entry.terminalConfig as Record<string, unknown> | null;
      const afterLateConfig = entry.afterLateConfig as Record<string, unknown> | null;
      return entry.registerCalls === 1
        && entry.unregisterCalls === 1
        && entry.fetchCalls === 1
        && JSON.stringify(terminal.errorCodes)
          === JSON.stringify([entry.variant === 'signal' ? 'ABORT_ERR' : 'ETIMEDOUT'])
        && terminalCount(terminal) === 1
        && JSON.stringify(terminal) === JSON.stringify(entry.final)
        && terminalConfig?.active === true
        && terminalConfig.unregistered === null
        && terminalConfig.unregisterError === null
        && afterLateConfig?.active === false
        && (
          entry.lateSettlement === 'resolve'
            ? afterLateConfig.unregistered === true && afterLateConfig.unregisterError === null
            : afterLateConfig.unregistered === null
              && afterLateConfig.unregisterError === 'late unregister rejection'
        )
        && (
          entry.variant !== 'signal'
          || (
            (entry.callerListeners as { added: number; live: number }).added >= 1
            && (entry.callerListeners as { live: number }).live === 0
          )
        );
    }),
  };
});

logicalRow('RD-09', 'original total interrupts retry delay without a second provider dispatch', async () => {
  let calls = 0;
  let onAbortCalls = 0;
  let onTimeoutCalls = 0;
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    const status = calls === 1 ? 503 : 200;
    await request.onHeaders?.({ status, statusText: status === 503 ? 'Failure' : 'OK', headers: {}, finalUrl: `${URL_BASE}/rd09` });
    return validResult('download', status, `${URL_BASE}/rd09`);
  }, {
    timeout: APPLICATION_TIMEOUT_MS,
    retry: { limit: 1, delay: CURRENT_WINDOW_MS + 40 },
    hooks: {
      onAbort: [async () => { onAbortCalls += 1; }],
      onTimeout: [async () => { onTimeoutCalls += 1; }],
    },
  });
  await delay(CURRENT_WINDOW_MS);
  const atDeadline = execution.ledger.snapshot();
  const callsAtDeadline = calls;
  await waitFor(() => terminalCount(execution.ledger.snapshot()) > 0, 'RD-09 never reached its eventual terminal');
  await delay(LATE_WINDOW_MS);
  const final = execution.ledger.snapshot();
  const actual = { callsAtDeadline, atDeadline, finalCalls: calls, final, onAbortCalls, onTimeoutCalls };
  const desired = {
    callsAtDeadline: 1,
    errorCodes: ['ETIMEDOUT'],
    finalCalls: 1,
    onTimeoutCalls: 1,
    onAbortCalls: 0,
  };
  return {
    actual,
    desired,
    desiredPass: calls === 1
      && callsAtDeadline === 1
      && JSON.stringify(atDeadline.errorCodes) === '["ETIMEDOUT"]'
      && terminalCount(atDeadline) === 1
      && atDeadline.successDetails.length === 0
      && onTimeoutCalls === 1
      && onAbortCalls === 0
      && JSON.stringify(atDeadline) === JSON.stringify(final),
    currentSignature: atDeadline.errorCodes.length === 0 && final.successes.includes(200) && calls === 2,
  };
});

logicalRow('RD-10', 'total interrupts retry decision hooks and rate-limit hooks before redispatch', async () => {
  const stages = ['condition', 'onRetry', 'beforeRetry', 'rateHook', 'rateSleep'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    const gate = createDeferred<void>();
    let calls = 0;
    let stageCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    const retry = {
      limit: 1,
      delay: 0,
      ...(stage === 'condition' ? { condition: async () => { stageCalls += 1; await gate.promise; return true; } } : {}),
      ...(stage === 'onRetry' ? { onRetry: async () => { stageCalls += 1; await gate.promise; return true; } } : {}),
    };
    const hooks = {
      ...(stage === 'beforeRetry' ? { beforeRetry: [async () => { stageCalls += 1; await gate.promise; }] } : {}),
      ...(stage === 'rateHook' ? { onRateLimitWait: [async () => { stageCalls += 1; await gate.promise; }] } : {}),
      ...(stage === 'rateSleep' ? { onRateLimitWait: [async () => { stageCalls += 1; }] } : {}),
      onAbort: [async () => { onAbortCalls += 1; }],
      onTimeout: [async () => { onTimeoutCalls += 1; }],
    };
    const execution = await executeNative('download', async (request) => {
      calls += 1;
      const rateStage = stage === 'rateHook' || stage === 'rateSleep';
      const status = calls === 1 ? (rateStage ? 429 : 503) : 200;
      await request.onHeaders?.({
        status,
        statusText: status === 200 ? 'OK' : 'Failure',
        headers: stage === 'rateHook' ? { 'retry-after': '0' } : {},
        finalUrl: `${URL_BASE}/rd10-${stage}`,
      });
      return validResult('download', status, `${URL_BASE}/rd10-${stage}`);
    }, {
      timeout: APPLICATION_TIMEOUT_MS,
      retry,
      hooks,
      ...(stage === 'rateHook' ? { waitOnStatus: true, defaultWaitTime: 0 } : {}),
      ...(stage === 'rateSleep' ? {
        waitOnStatus: true,
        defaultWaitTime: CURRENT_WINDOW_MS + 40,
        maxWaitTime: CURRENT_WINDOW_MS + 100,
      } : {}),
    });
    await waitFor(() => stageCalls === 1, `RD-10 ${stage} was not entered`);
    if (stage === 'rateSleep') await delay(5);
    await delay(CURRENT_WINDOW_MS);
    const atDeadline = execution.ledger.snapshot();
    const callsAtDeadline = calls;
    gate.resolve(undefined);
    await waitFor(() => terminalCount(execution.ledger.snapshot()) > 0, `RD-10 ${stage} did not settle after release`);
    await delay(LATE_WINDOW_MS);
    const final = execution.ledger.snapshot();
    actual.push({
      stage,
      callsAtDeadline,
      atDeadlineTerminals: terminalCount(atDeadline),
      atDeadlineCodes: atDeadline.errorCodes,
      finalCalls: calls,
      final,
      onAbortCalls,
      onTimeoutCalls,
    });
  }
  const desired = stages.map((stage) => ({ stage, callsAtDeadline: 1, atDeadlineTerminals: 1, finalCalls: 1 }));
  const desiredPass = actual.every((entry) => (
    entry.atDeadlineTerminals === 1
    && JSON.stringify(entry.atDeadlineCodes) === '["ETIMEDOUT"]'
    && entry.finalCalls === 1
    && entry.onTimeoutCalls === 1
    && entry.onAbortCalls === 0
    && (entry.final as FacadeSnapshot).successDetails.length === 0
    && terminalCount(entry.final as FacadeSnapshot) === 1
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      entry.atDeadlineTerminals === 0
      && entry.callsAtDeadline === 1
      && entry.finalCalls === 2
      && (entry.final as FacadeSnapshot).events.filter((event) => event === 'complete').length === 1
    )),
  };
});

logicalRow('RD-11', 'total remains armed through afterHeaders and buffered body consumption', async () => {
  const stages = ['afterHeaders', 'body', 'nativeUploadBody'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    const gate = createDeferred<void>();
    let hookCalls = 0;
    let bodyCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;

    if (stage === 'nativeUploadBody') {
      const execution = await executeNative('upload', async () => (
        validResult('upload', 201, `${URL_BASE}/rd11-native-upload`)
      ), {
        timeout: APPLICATION_TIMEOUT_MS,
        hooks: {
          afterParse: [async () => {
            bodyCalls += 1;
            await gate.promise;
            return 'late-body';
          }],
          onAbort: [async () => { onAbortCalls += 1; }],
          onTimeout: [async () => { onTimeoutCalls += 1; }],
        },
      });
      await waitFor(() => bodyCalls === 1, 'RD-11 native upload body conversion was not entered');
      await delay(CURRENT_WINDOW_MS);
      const atDeadline = execution.ledger.snapshot();
      gate.resolve(undefined);
      await delay(LATE_WINDOW_MS);
      const afterRelease = execution.ledger.snapshot();
      actual.push({
        stage,
        hookCalls,
        bodyCalls,
        atDeadline,
        afterRelease,
        onAbortCalls,
        onTimeoutCalls,
      });
      continue;
    }

    installFetch(async () => response({
      status: 200,
      text: async () => {
        bodyCalls += 1;
        if (stage === 'body') await gate.promise;
        return 'ok';
      },
    }));
    const pending = executeBuffered({
      timeout: APPLICATION_TIMEOUT_MS,
      hooks: {
        ...(stage === 'afterHeaders' ? {
          afterHeaders: [async () => { hookCalls += 1; await gate.promise; }],
        } : {}),
        onAbort: [async () => { onAbortCalls += 1; }],
        onTimeout: [async () => { onTimeoutCalls += 1; }],
      },
    });
    const state = trackPromise(pending);
    await waitFor(
      () => stage === 'afterHeaders' ? hookCalls === 1 : bodyCalls === 1,
      `RD-11 ${stage} was not entered`,
    );
    await delay(CURRENT_WINDOW_MS);
    const atDeadline = promiseSnapshot(state);
    gate.resolve(undefined);
    await waitFor(() => state.outcome !== 'pending', `RD-11 ${stage} did not settle after release`);
    await delay(LATE_WINDOW_MS);
    actual.push({
      stage,
      hookCalls,
      bodyCalls,
      atDeadline,
      afterRelease: promiseSnapshot(state),
      onAbortCalls,
      onTimeoutCalls,
    });
  }
  const desired = stages.map((stage) => ({ stage, atDeadline: 'one ETIMEDOUT terminal', lateStable: true }));
  const desiredPass = actual.every((entry) => {
    if (entry.stage === 'nativeUploadBody') {
      const atDeadline = entry.atDeadline as FacadeSnapshot;
      return JSON.stringify(atDeadline.errorCodes) === '["ETIMEDOUT"]'
        && terminalCount(atDeadline) === 1
        && atDeadline.successDetails.length === 0
        && entry.onTimeoutCalls === 1
        && entry.onAbortCalls === 0
        && JSON.stringify(entry.atDeadline) === JSON.stringify(entry.afterRelease);
    }
    return (entry.atDeadline as { outcome: string; code: string | null }).outcome === 'rejected'
      && (entry.atDeadline as { outcome: string; code: string | null }).code === 'ETIMEDOUT'
      && entry.onTimeoutCalls === 1
      && entry.onAbortCalls === 0
      && JSON.stringify(entry.atDeadline) === JSON.stringify(entry.afterRelease);
  });
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => {
      if (entry.stage === 'nativeUploadBody') {
        const atDeadline = entry.atDeadline as FacadeSnapshot;
        return atDeadline.errorCodes.length === 0
          && atDeadline.events.filter((event) => event === 'complete').length === 1
          && JSON.stringify(entry.atDeadline) === JSON.stringify(entry.afterRelease);
      }
      return (entry.atDeadline as { outcome: string }).outcome === 'pending'
        && (entry.afterRelease as { outcome: string }).outcome === 'fulfilled';
    }),
  };
});

logicalRow('RD-12', 'staged total is enforced and unsupported connect/body phases refuse or time out honestly', async () => {
  const stages = ['total', 'body', 'connect'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    if (stage === 'body') {
      const gate = createDeferred<void>();
      let bodyCalls = 0;
      let fetchCalls = 0;
      let onAbortCalls = 0;
      let onTimeoutCalls = 0;
      installFetch(async () => {
        fetchCalls += 1;
        return response({
        text: async () => { bodyCalls += 1; await gate.promise; return 'ok'; },
        });
      });
      const pending = executeBuffered({
        timeout: { body: APPLICATION_TIMEOUT_MS },
        hooks: {
          onAbort: [async () => { onAbortCalls += 1; }],
          onTimeout: [async () => { onTimeoutCalls += 1; }],
        },
      });
      const state = trackPromise(pending);
      await waitFor(
        () => bodyCalls === 1 || state.outcome !== 'pending',
        'RD-12 body neither entered nor structurally refused',
      );
      if (bodyCalls === 1) await delay(CURRENT_WINDOW_MS);
      const atBoundary = promiseSnapshot(state);
      gate.resolve(undefined);
      await waitFor(() => state.outcome !== 'pending', 'RD-12 body did not settle after release');
      await delay(LATE_WINDOW_MS);
      actual.push({
        stage,
        dispatches: fetchCalls,
        bodyCalls,
        atBoundary,
        afterRelease: promiseSnapshot(state),
        onAbortCalls,
        onTimeoutCalls,
      });
      continue;
    }

    const gate = createDeferred<unknown>();
    let calls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    const execution = await executeNative('stream', async () => {
      calls += 1;
      return gate.promise;
    }, {
      timeout: { [stage]: APPLICATION_TIMEOUT_MS },
      hooks: {
        onAbort: [async () => { onAbortCalls += 1; }],
        onTimeout: [async () => { onTimeoutCalls += 1; }],
      },
    });
    await waitFor(
      () => calls === 1 || terminalCount(execution.ledger.snapshot()) > 0,
      `RD-12 ${stage} neither dispatched nor refused`,
    );
    if (calls === 1) await delay(CURRENT_WINDOW_MS);
    const atBoundary = execution.ledger.snapshot();
    gate.resolve(validResult('stream', 200, `${URL_BASE}/rd12-${stage}`));
    await waitFor(() => terminalCount(execution.ledger.snapshot()) > 0, `RD-12 ${stage} did not settle after release`);
    await delay(LATE_WINDOW_MS);
    actual.push({
      stage,
      dispatches: calls,
      atBoundaryTerminals: terminalCount(atBoundary),
      atBoundaryCodes: atBoundary.errorCodes,
      atBoundarySuccesses: atBoundary.successDetails.length,
      afterRelease: execution.ledger.snapshot(),
      onAbortCalls,
      onTimeoutCalls,
    });
  }
  const desired = [
    { stage: 'total', dispatches: 1, terminal: 'timeout' },
    { stage: 'body', dispatches: 1, terminal: 'body-timeout-or-prewire-refusal' },
    { stage: 'connect', dispatches: 0, terminal: 'REZ_UNSUPPORTED_CAPABILITY' },
  ];
  const total = actual.find((entry) => entry.stage === 'total');
  const body = actual.find((entry) => entry.stage === 'body');
  const connect = actual.find((entry) => entry.stage === 'connect');
  const bodyState = body?.atBoundary as { outcome?: string; code?: string | null } | undefined;
  const bodyEnforced = body?.dispatches === 1
    && bodyState?.outcome === 'rejected'
    && (bodyState.code === 'ETIMEDOUT' || bodyState.code === 'ESOCKETTIMEDOUT')
    && body?.onTimeoutCalls === 1;
  const bodyRefused = body?.dispatches === 0
    && bodyState?.outcome === 'rejected'
    && bodyState.code === 'REZ_UNSUPPORTED_CAPABILITY'
    && body?.onTimeoutCalls === 0;
  const desiredPass = Number(total?.atBoundaryTerminals) === 1
    && JSON.stringify(total?.atBoundaryCodes) === '["ETIMEDOUT"]'
    && total?.atBoundarySuccesses === 0
    && total?.onTimeoutCalls === 1
    && total?.onAbortCalls === 0
    && JSON.stringify(total?.atBoundaryCodes)
      === JSON.stringify((total?.afterRelease as FacadeSnapshot | undefined)?.errorCodes)
    && (bodyEnforced || bodyRefused)
    && JSON.stringify(body?.atBoundary) === JSON.stringify(body?.afterRelease)
    && connect?.dispatches === 0
    && JSON.stringify(connect?.atBoundaryCodes) === '["REZ_UNSUPPORTED_CAPABILITY"]'
    && connect?.atBoundaryTerminals === 1
    && connect?.atBoundarySuccesses === 0
    && connect?.onTimeoutCalls === 0
    && connect?.onAbortCalls === 0
    && JSON.stringify(connect?.atBoundaryCodes)
      === JSON.stringify((connect?.afterRelease as FacadeSnapshot | undefined)?.errorCodes);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: Number(total?.atBoundaryTerminals) === 0
      && (body?.atBoundary as { outcome?: string } | undefined)?.outcome === 'pending'
      && connect?.dispatches === 1
      && Number(connect?.atBoundaryTerminals) === 0,
  };
});

// --------------------------------------------------------------- RP rows --

logicalRow('RP-01', 'provider result alone is authoritative for success metadata in every native mode', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    let calls = 0;
    const execution = await executeNative(mode, async () => {
      calls += 1;
      return validResult(mode, 201, `${URL_BASE}/rp01-${mode}`);
    });
    const terminal = await waitForTerminal(execution.ledger, `RP-01 ${mode}`);
    actual.push({
      mode,
      calls,
      headers: terminal.headers,
      headerDetails: terminal.headerDetails,
      statuses: terminal.statuses,
      terminalStatus: terminal.successes.at(-1) ?? null,
      successDetails: terminal.successDetails,
      errors: terminal.errorCodes,
    });
  }
  const desired = actual.map((entry) => ({
    mode: entry.mode,
    calls: 1,
    headers: [201],
    statuses: [201],
    terminalStatus: 201,
    errors: [],
  }));
  const desiredPass = actual.every((entry) => (
    JSON.stringify(entry.headers) === '[201]'
    && JSON.stringify(entry.statuses) === '[201]'
    && entry.terminalStatus === 201
    && entry.calls === 1
    && (entry.headerDetails as FacadeSnapshot['headerDetails']).length === 1
    && (entry.headerDetails as FacadeSnapshot['headerDetails'])[0]?.contentType
      === (entry.mode === 'download' ? 'application/octet-stream' : 'text/plain')
    && JSON.stringify(
      (entry.successDetails as FacadeSnapshot['successDetails']).map((detail) => detail.event),
    ) === '["finish","done","complete"]'
    && (entry.successDetails as FacadeSnapshot['successDetails']).every((detail) => (
      detail.status === 201
      && detail.finalUrl === `${URL_BASE}/rp01-${String(entry.mode)}`
    ))
    && (entry.errors as unknown[]).length === 0
  ));
  const stream = actual.find((entry) => entry.mode === 'stream');
  const files = actual.filter((entry) => entry.mode !== 'stream');
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: JSON.stringify(stream?.headers) === '[]'
      && stream?.terminalStatus === 200
      && files.every((entry) => entry.terminalStatus === 201),
  };
});

logicalRow('RP-02', 'provider result-only HTTP failure rejects once with exact response status', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    const execution = await executeNative(mode, async () => (
      validResult(mode, 503, `${URL_BASE}/rp02-${mode}`)
    ));
    const terminal = await waitForTerminal(execution.ledger, `RP-02 ${mode}`);
    const rawError = execution.ledger.errors.at(-1)?.value;
    actual.push({
      mode,
      errors: terminal.errorCodes.length,
      errorCode: terminal.errorCodes.at(-1) ?? null,
      errorStatus: terminal.errorStatuses.at(-1) ?? null,
      errorContentType: eventHeader(errorResponse(rawError), 'content-type'),
      completes: terminal.events.filter((event) => event === 'complete').length,
      successFamily: terminal.successDetails.length,
      terminalStatus: terminal.successes.at(-1) ?? null,
    });
  }
  const desired = actual.map((entry) => ({ mode: entry.mode, errors: 1, errorStatus: 503, completes: 0 }));
  const desiredPass = actual.every((entry) => (
    entry.errors === 1
    && entry.errorCode === 'REZ_HTTP_ERROR'
    && entry.errorStatus === 503
    && entry.errorContentType
      === (entry.mode === 'download' ? 'application/octet-stream' : 'text/plain')
    && entry.completes === 0
    && entry.successFamily === 0
  ));
  const stream = actual.find((entry) => entry.mode === 'stream');
  const files = actual.filter((entry) => entry.mode !== 'stream');
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: stream?.errors === 0
      && stream?.terminalStatus === 200
      && files.every((entry) => entry.errors === 1 && entry.errorStatus === 503),
  };
});

logicalRow('RP-03', 'status zero is never normalized into fabricated provider success', async () => {
  const failureCodes: Record<NativeMode, string> = {
    stream: 'REZ_STREAM_ERROR',
    download: 'REZ_DOWNLOAD_FAILED',
    upload: 'REZ_UPLOAD_FAILED',
  };
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    const invalid = { ...validResult(mode, 200, `${URL_BASE}/rp03-${mode}`), status: 0 };
    const execution = await executeNative(mode, async () => invalid);
    const terminal = await waitForTerminal(execution.ledger, `RP-03 ${mode}`);
    actual.push({
      mode,
      errors: terminal.errorCodes.length,
      errorCode: terminal.errorCodes.at(-1) ?? null,
      headers: terminal.headers.length,
      statuses: terminal.statuses.length,
      completes: terminal.events.filter((event) => event === 'complete').length,
      successFamily: terminal.successDetails.length,
      terminalStatus: terminal.successes.at(-1) ?? null,
    });
  }
  const desired = actual.map((entry) => ({ mode: entry.mode, errors: 1, completes: 0, terminalStatus: null }));
  const desiredPass = actual.every((entry) => (
    entry.errors === 1
    && entry.errorCode === failureCodes[entry.mode as NativeMode]
    && entry.headers === 0
    && entry.statuses === 0
    && entry.completes === 0
    && entry.successFamily === 0
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => entry.errors === 0 && entry.terminalStatus === 200),
  };
});

logicalRow('RP-04', 'null, missing, and NaN statuses are structured provider failures', async () => {
  const failureCodes: Record<NativeMode, string> = {
    stream: 'REZ_STREAM_ERROR',
    download: 'REZ_DOWNLOAD_FAILED',
    upload: 'REZ_UPLOAD_FAILED',
  };
  const invalidStatuses = ['null', 'missing', 'nan'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    for (const invalidStatus of invalidStatuses) {
      const invalid = { ...validResult(mode, 200, `${URL_BASE}/rp04-${mode}-${invalidStatus}`) } as Record<string, unknown>;
      if (invalidStatus === 'missing') Reflect.deleteProperty(invalid, 'status');
      else invalid.status = invalidStatus === 'null' ? null : Number.NaN;
      const execution = await executeNative(mode, async () => invalid);
      const terminal = await waitForTerminal(execution.ledger, `RP-04 ${mode}/${invalidStatus}`);
      actual.push({
        mode,
        invalidStatus,
        errors: terminal.errorCodes.length,
        errorCode: terminal.errorCodes.at(-1) ?? null,
        headers: terminal.headers.length,
        statuses: terminal.statuses.length,
        completes: terminal.events.filter((event) => event === 'complete').length,
        successFamily: terminal.successDetails.length,
        terminalStatus: terminal.successes.at(-1) ?? null,
      });
    }
  }
  const desired = actual.map((entry) => ({ mode: entry.mode, invalidStatus: entry.invalidStatus, errors: 1, completes: 0 }));
  const desiredPass = actual.every((entry) => (
    entry.errors === 1
    && entry.errorCode === failureCodes[entry.mode as NativeMode]
    && entry.headers === 0
    && entry.statuses === 0
    && entry.completes === 0
    && entry.successFamily === 0
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => entry.errors === 0 && entry.terminalStatus === 200),
  };
});

logicalRow('RP-05', 'callback and result metadata disagreement cannot publish split terminal truth', async () => {
  const failureCodes: Record<NativeMode, string> = {
    stream: 'REZ_STREAM_ERROR',
    download: 'REZ_DOWNLOAD_FAILED',
    upload: 'REZ_UPLOAD_FAILED',
  };
  const variants = [
    'status',
    'statusText',
    'headers',
    'finalUrl',
    'contentType',
    'contentLength',
    'callbackHeaderContentTypeVsResultContentType',
    'callbackContentTypeVsResultHeaderContentType',
    'callbackContentLengthVsResultHeaderContentLength',
    'callbackHeaderContentLengthVsResultContentLength',
  ] as const;
  const crossRepresentationVariants = new Set<(typeof variants)[number]>([
    'callbackHeaderContentTypeVsResultContentType',
    'callbackContentTypeVsResultHeaderContentType',
    'callbackContentLengthVsResultHeaderContentLength',
    'callbackHeaderContentLengthVsResultContentLength',
  ]);
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    for (const variant of variants) {
      const execution = await executeNative(mode, async (request) => {
        const result = {
          ...validResult(mode, 201, `${URL_BASE}/rp05-${mode}`),
        } as Record<string, any>;
        const callback: Record<string, any> = {
          status: result.status,
          statusText: result.statusText,
          headers: { ...(result.headers ?? {}) },
          finalUrl: result.finalUrl,
          contentType: result.contentType,
          contentLength: result.contentLength,
        };
        if (variant === 'status') callback.status = 202;
        if (variant === 'statusText') callback.statusText = 'Callback Status';
        if (variant === 'headers') {
          callback.headers = { ...callback.headers, 'x-provider-source': 'callback' };
          result.headers = { ...result.headers, 'x-provider-source': 'result' };
        }
        if (variant === 'finalUrl') callback.finalUrl = `${URL_BASE}/rp05-callback`;
        if (variant === 'contentType') {
          delete callback.headers['content-type'];
          delete result.headers['content-type'];
          callback.contentType = 'application/x-callback';
        }
        if (variant === 'contentLength') callback.contentLength = Number(result.contentLength) + 1;
        if (variant === 'callbackHeaderContentTypeVsResultContentType') {
          delete callback.contentType;
          delete result.headers['content-type'];
          callback.headers['content-type'] = 'application/x-callback';
          result.contentType = 'application/x-result';
        }
        if (variant === 'callbackContentTypeVsResultHeaderContentType') {
          delete callback.headers['content-type'];
          delete result.contentType;
          callback.contentType = 'application/x-callback';
          result.headers['content-type'] = 'application/x-result';
        }
        if (variant === 'callbackContentLengthVsResultHeaderContentLength') {
          const resultLength = Number(result.contentLength);
          delete result.contentLength;
          callback.contentLength = resultLength;
          result.headers['content-length'] = String(resultLength + 1);
        }
        if (variant === 'callbackHeaderContentLengthVsResultContentLength') {
          const resultLength = Number(result.contentLength);
          delete callback.contentLength;
          callback.headers['content-length'] = String(resultLength + 1);
        }
        await request.onHeaders?.(callback);
        return result;
      });
      const terminal = await waitForTerminal(execution.ledger, `RP-05 ${mode}/${variant}`);
      actual.push({
        mode,
        variant,
        headers: terminal.headers,
        headerDetails: terminal.headerDetails,
        statuses: terminal.statuses,
        errors: terminal.errorCodes.length,
        errorCode: terminal.errorCodes.at(-1) ?? null,
        errorStatus: terminal.errorStatuses.at(-1) ?? null,
        completes: terminal.events.filter((event) => event === 'complete').length,
        successFamily: terminal.successDetails.length,
        terminalStatus: terminal.successes.at(-1) ?? null,
      });
    }
  }
  const desired = actual.map((entry) => ({
    mode: entry.mode,
    variant: entry.variant,
    statuses: [],
    errors: 1,
    completes: 0,
    providerProtocolFailure: true,
  }));
  const desiredPass = actual.every((entry) => (
    (entry.headers as unknown[]).length === 0
    && (entry.statuses as unknown[]).length === 0
    && entry.errors === 1
    && entry.errorCode === failureCodes[entry.mode as NativeMode]
    && entry.errorStatus === null
    && entry.completes === 0
    && entry.successFamily === 0
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      crossRepresentationVariants.has(entry.variant as (typeof variants)[number])
        ? entry.errors === 0
          && entry.terminalStatus === 201
          && JSON.stringify(entry.statuses) === '[201]'
          && entry.successFamily === 3
        : entry.errors === 1
          && entry.errorCode === failureCodes[entry.mode as NativeMode]
          && entry.errorStatus === null
          && (entry.headers as unknown[]).length === 0
          && (entry.statuses as unknown[]).length === 0
          && entry.completes === 0
          && entry.successFamily === 0
    )),
  };
});

logicalRow('RP-06', 'duplicate provider header callbacks publish at most one header lifecycle', async () => {
  const variants = ['identical', 'conflict'] as const;
  const failureCodes: Record<'stream' | 'download', string> = {
    stream: 'REZ_STREAM_ERROR',
    download: 'REZ_DOWNLOAD_FAILED',
  };
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download'] as const) {
    for (const variant of variants) {
      let afterHeadersCalls = 0;
      const execution = await executeNative(mode, async (request) => {
        const first = {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': mode === 'download' ? 'application/octet-stream' : 'text/plain',
            'x-provider-source': 'first',
          },
          finalUrl: `${URL_BASE}/rp06-${mode}`,
        };
        const second = variant === 'identical' ? first : {
          ...first,
          status: 201,
          statusText: 'Conflict',
          headers: { 'content-type': 'text/plain', 'x-provider-source': 'second' },
          finalUrl: `${URL_BASE}/rp06-${mode}-conflict`,
        };
        await request.onHeaders?.(first);
        await request.onHeaders?.(second);
        return validResult(mode, 200, `${URL_BASE}/rp06-${mode}`);
      }, {
        hooks: { afterHeaders: [async () => { afterHeadersCalls += 1; }] },
      });
      const terminal = await waitForTerminal(execution.ledger, `RP-06 ${mode}/${variant}`);
      actual.push({
        mode,
        variant,
        headerEvents: terminal.headers.length,
        statusEvents: terminal.statuses.length,
        cookieEvents: terminal.cookies.length,
        afterHeadersCalls,
        errorCodes: terminal.errorCodes,
        successFamily: terminal.successDetails.map((detail) => detail.event),
      });
    }
  }
  const desired = actual.map((entry) => ({
    mode: entry.mode,
    disposition: entry.variant === 'identical' ? 'one accepted lifecycle' : 'one protocol failure',
  }));
  const desiredPass = actual.every((entry) => {
    if (entry.variant === 'identical') {
      return entry.headerEvents === 1
        && entry.statusEvents === 1
        && entry.cookieEvents === 1
        && entry.afterHeadersCalls === 1
        && JSON.stringify(entry.errorCodes) === '[]'
        && JSON.stringify(entry.successFamily) === '["finish","done","complete"]';
    }
    return entry.headerEvents === 0
      && entry.statusEvents === 0
      && entry.cookieEvents === 0
      && entry.afterHeadersCalls === 0
      && JSON.stringify(entry.errorCodes) === JSON.stringify([failureCodes[entry.mode as 'stream' | 'download']])
      && JSON.stringify(entry.successFamily) === '[]';
  });
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      entry.headerEvents === 2 && entry.statusEvents === 2 && entry.afterHeadersCalls === 2
      && entry.cookieEvents === 2
    )),
  };
});

logicalRow('RP-07', 'upload provider receives and reconciles its declared onHeaders callback', async () => {
  let callbackPresent = false;
  let callbackInvoked = false;
  let afterHeadersCalls = 0;
  const execution = await executeNative('upload', async (request) => {
    callbackPresent = typeof request.onHeaders === 'function';
    if (request.onHeaders) {
      callbackInvoked = true;
      await request.onHeaders({
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'text/plain' },
        finalUrl: `${URL_BASE}/rp07`,
      });
    }
    return validResult('upload', 201, `${URL_BASE}/rp07`);
  }, { hooks: { afterHeaders: [async () => { afterHeadersCalls += 1; }] } });
  const terminal = await waitForTerminal(execution.ledger, 'RP-07');
  const actual = {
    callbackPresent,
    callbackInvoked,
    headerEvents: terminal.headers.length,
    statuses: terminal.statuses,
    cookieEvents: terminal.cookies.length,
    afterHeadersCalls,
    errors: terminal.errorCodes,
    successFamily: terminal.successDetails.map((detail) => detail.event),
    terminalStatus: terminal.successes.at(-1) ?? null,
  };
  const desired = {
    callbackPresent: true,
    callbackInvoked: true,
    headerEvents: 1,
    statuses: [201],
    cookieEvents: 1,
    afterHeadersCalls: 1,
    errors: [],
    successFamily: ['finish', 'done', 'complete'],
    terminalStatus: 201,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: !callbackPresent && !callbackInvoked && terminal.successes.at(-1) === 201,
  };
});

logicalRow('RP-08', 'late provider resolve and reject are quarantined after native deadline settlement', async () => {
  const variants = ['resolve', 'reject'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const gate = createDeferred<unknown>();
    let aborts = 0;
    const execution = await executeNative('stream', async (request) => {
      request.signal?.addEventListener('abort', () => { aborts += 1; }, { once: true });
      return gate.promise;
    }, { timeout: APPLICATION_TIMEOUT_MS });
    const terminal = await waitForTerminal(execution.ledger, `RP-08 ${variant}`);
    const beforeLate = execution.ledger.snapshot();
    if (variant === 'resolve') gate.resolve(validResult('stream', 200, `${URL_BASE}/rp08`));
    else gate.reject(new Error('late provider rejection'));
    await delay(LATE_WINDOW_MS);
    const afterLate = execution.ledger.snapshot();
    actual.push({
      variant,
      aborts,
      initialTerminal: terminal.events,
      errorCodes: terminal.errorCodes,
      stable: JSON.stringify(beforeLate) === JSON.stringify(afterLate),
      errorCount: afterLate.errorCodes.length,
      successCount: afterLate.successDetails.length,
      finished: afterLate.isFinished,
    });
  }
  const desired = variants.map((variant) => ({
    variant,
    aborts: 1,
    initialTerminal: ['error'],
    stable: true,
    errorCount: 1,
    successCount: 0,
  }));
  const desiredPass = actual.every((entry) => (
    entry.aborts === 1
    && JSON.stringify(entry.errorCodes) === '["ETIMEDOUT"]'
    && entry.stable === true
    && entry.errorCount === 1
    && entry.successCount === 0
    && entry.finished === false
  ));
  return { actual, desired, desiredPass, currentSignature: desiredPass };
});

logicalRow('RP-09', 'captured callbacks are inert after timeout/error terminal', async () => {
  let captured: ProviderRequest | null = null;
  let capturedConfig: unknown = null;
  let afterHeadersCalls = 0;
  let onTimeoutCalls = 0;
  let onAbortCalls = 0;
  const gate = createDeferred<unknown>();
  const execution = await executeNative('stream', async (request) => {
    captured = request;
    return gate.promise;
  }, {
    timeout: APPLICATION_TIMEOUT_MS,
    hooks: {
      afterHeaders: [async (_event: unknown, config: unknown) => {
        afterHeadersCalls += 1;
        capturedConfig = config;
      }],
      onTimeout: [async (_event: unknown, config: unknown) => {
        onTimeoutCalls += 1;
        capturedConfig = config;
      }],
      onAbort: [async (_event: unknown, config: unknown) => {
        onAbortCalls += 1;
        capturedConfig = config;
      }],
    },
  });
  await waitFor(() => captured !== null, 'RP-09 did not capture provider request');
  await waitForTerminal(execution.ledger, 'RP-09 timeout');
  const beforeLate = execution.ledger.snapshot();
  const beforeHooks = { afterHeadersCalls, onTimeoutCalls, onAbortCalls };
  const beforeConfig = configMutationSnapshot(capturedConfig);
  await captured?.onHeaders?.({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    finalUrl: `${URL_BASE}/rp09-late`,
  });
  await captured?.onChunk?.('late-data');
  await captured?.onProgress?.({ loaded: 9, total: 9 });
  gate.resolve(validResult('stream', 200, `${URL_BASE}/rp09-late`));
  await delay(LATE_WINDOW_MS);
  const afterLate = execution.ledger.snapshot();
  const afterHooks = { afterHeadersCalls, onTimeoutCalls, onAbortCalls };
  const afterConfig = configMutationSnapshot(capturedConfig);
  const actual = { beforeLate, afterLate, beforeHooks, afterHooks, beforeConfig, afterConfig };
  const desired = { lateStable: true, terminal: ['error'] };
  const desiredPass = JSON.stringify(beforeLate.errorCodes) === '["ETIMEDOUT"]'
    && terminalCount(beforeLate) === 1
    && beforeLate.successDetails.length === 0
    && JSON.stringify(beforeLate) === JSON.stringify(afterLate)
    && JSON.stringify(beforeHooks) === JSON.stringify(afterHooks)
    && JSON.stringify(beforeConfig) === JSON.stringify(afterConfig);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: beforeLate.errorCodes.length === 1
      && afterLate.headers.length > beforeLate.headers.length
      && afterLate.data.includes('late-data')
      && afterLate.progress.includes(9),
  };
});

logicalRow('RP-10', 'captured callbacks are inert after successful native terminal', async () => {
  let captured: ProviderRequest | null = null;
  let capturedConfig: unknown = null;
  let afterHeadersCalls = 0;
  const execution = await executeNative('stream', async (request) => {
    captured = request;
    await request.onHeaders?.({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      finalUrl: `${URL_BASE}/rp10`,
    });
    await request.onChunk?.('initial');
    return validResult('stream', 200, `${URL_BASE}/rp10`);
  }, {
    hooks: {
      afterHeaders: [async (_event: unknown, config: unknown) => {
        afterHeadersCalls += 1;
        capturedConfig = config;
      }],
    },
  });
  await waitForTerminal(execution.ledger, 'RP-10 success');
  const beforeLate = execution.ledger.snapshot();
  const beforeAfterHeadersCalls = afterHeadersCalls;
  const beforeConfig = configMutationSnapshot(capturedConfig);
  await captured?.onHeaders?.({
    status: 201,
    statusText: 'Late',
    headers: { 'content-type': 'text/plain' },
    finalUrl: `${URL_BASE}/rp10-late`,
  });
  await captured?.onChunk?.('late-data');
  await captured?.onProgress?.({ loaded: 10, total: 10 });
  await delay(LATE_WINDOW_MS);
  const afterLate = execution.ledger.snapshot();
  const afterConfig = configMutationSnapshot(capturedConfig);
  const actual = {
    beforeLate,
    afterLate,
    beforeAfterHeadersCalls,
    afterAfterHeadersCalls: afterHeadersCalls,
    beforeConfig,
    afterConfig,
  };
  const desired = { lateStable: true, terminalStatus: 200 };
  const desiredPass = beforeLate.errorCodes.length === 0
    && JSON.stringify(beforeLate.successDetails.map((detail) => detail.event)) === '["finish","done","complete"]'
    && beforeLate.successDetails.every((detail) => detail.status === 200)
    && beforeAfterHeadersCalls === 1
    && afterHeadersCalls === 1
    && JSON.stringify(beforeLate) === JSON.stringify(afterLate)
    && JSON.stringify(beforeConfig) === JSON.stringify(afterConfig);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: beforeLate.events.includes('complete')
      && afterLate.headers.length > beforeLate.headers.length
      && afterLate.data.includes('late-data')
      && afterLate.progress.includes(10),
  };
});

// --------------------------------------------------------------- RR rows --

logicalRow('RR-01', 'retry controls recover once while Fetch-backed facades hide transient attempt errors', async () => {
  const native: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    let calls = 0;
    const order: string[] = [];
    const execution = await executeNative(mode, async (request) => {
      calls += 1;
      order.push(`attempt:${calls}`);
      const status = calls === 1 ? 503 : 200;
      if (mode !== 'upload') {
        await request.onHeaders?.({
          status,
          statusText: status === 200 ? 'OK' : 'Failure',
          headers: {},
          finalUrl: `${URL_BASE}/rr01-${mode}`,
        });
      }
      return validResult(mode, status, `${URL_BASE}/rr01-${mode}`);
    }, {
      retry: {
        limit: 1,
        delay: 0,
        methods: ['GET', 'POST'],
        onRetry: async () => { order.push('onRetry'); return true; },
      },
      hooks: { beforeRetry: [async () => { order.push('beforeRetry'); }] },
    });
    await waitFor(() => execution.ledger.snapshot().events.includes('complete'), `RR-01 ${mode} did not recover`);
    const terminal = execution.ledger.snapshot();
    const complete = terminal.successDetails.find((detail) => detail.event === 'complete');
    native.push({
      mode,
      calls,
      order,
      publicErrors: terminal.errorCodes.length,
      completes: terminal.events.filter((event) => event === 'complete').length,
      status: terminal.successes.at(-1) ?? null,
      history: complete?.history ?? [],
      retryAttempts: complete?.retryAttempts ?? null,
    });
  }

  let fetchCalls = 0;
  const fetchOrder: string[] = [];
  installFetch(async () => {
    fetchCalls += 1;
    fetchOrder.push(`attempt:${fetchCalls}`);
    return response({ status: fetchCalls === 1 ? 503 : 200, body: fetchCalls === 1 ? 'retry' : 'ok' });
  });
  const fetchFacade = new UploadResponse(`${URL_BASE}/rr01-fetch`, 'buffered') as unknown as FacadeLike;
  const fetchLedger = observeFacade(fetchFacade);
  const returned = await executeRequest({
    url: `${URL_BASE}/rr01-fetch`,
    method: 'POST',
    body: 'payload',
    _isUpload: true,
    _uploadResponse: fetchFacade,
    retry: {
      limit: 1,
      delay: 0,
      methods: ['POST'],
      onRetry: async () => { fetchOrder.push('onRetry'); return true; },
    },
    hooks: { beforeRetry: [async () => { fetchOrder.push('beforeRetry'); }] },
    cache: false,
  } as never, {} as never, new RezoCookieJar());
  if (returned !== fetchFacade) throw new InfrastructureError('RR-01 Fetch facade identity moved');
  await waitFor(() => fetchLedger.snapshot().events.includes('complete'), 'RR-01 Fetch facade did not recover');
  const fetchActual = {
    calls: fetchCalls,
    publicErrors: fetchLedger.snapshot().errorCodes.length,
    completes: fetchLedger.snapshot().events.filter((event) => event === 'complete').length,
    status: fetchLedger.snapshot().successes.at(-1) ?? null,
    history: fetchLedger.snapshot().successDetails.find((detail) => detail.event === 'complete')?.history ?? [],
    retryAttempts: fetchLedger.snapshot().successDetails.find((detail) => detail.event === 'complete')?.retryAttempts ?? null,
    order: fetchOrder,
  };
  const actual = { native, fetch: fetchActual };
  const desired = {
    native: 'each two attempts, onRetry then beforeRetry, no public attempt error, one 200 terminal',
    fetch: {
      calls: 2,
      publicErrors: 0,
      completes: 1,
      status: 200,
      history: [1],
      retryAttempts: 1,
      order: ['attempt:1', 'onRetry', 'beforeRetry', 'attempt:2'],
    },
  };
  const nativePass = native.every((entry) => (
    entry.calls === 2
    && JSON.stringify(entry.order) === '["attempt:1","onRetry","beforeRetry","attempt:2"]'
    && entry.publicErrors === 0
    && entry.completes === 1
    && entry.status === 200
    && JSON.stringify(entry.history) === '[1]'
    && entry.retryAttempts === 1
  ));
  const desiredPass = nativePass && JSON.stringify(fetchActual) === JSON.stringify(desired.fetch);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: nativePass
      && fetchActual.calls === 2
      && fetchActual.publicErrors === 1
      && fetchActual.completes === 1
      && fetchActual.status === 200
      && JSON.stringify(fetchActual.history) === '[1]'
      && fetchActual.retryAttempts === 1
      && JSON.stringify(fetchActual.order) === '["attempt:1","onRetry","beforeRetry","attempt:2"]',
  };
});

logicalRow('RR-02', 'custom retry condition remains bounded by maxRetries', async () => {
  let calls = 0;
  let conditionCalls = 0;
  let exhaustedCalls = 0;
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    const status = calls <= 2 ? 503 : 200;
    await request.onHeaders?.({ status, statusText: status === 200 ? 'OK' : 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr02` });
    return validResult('download', status, `${URL_BASE}/rr02`);
  }, {
    retry: {
      limit: 1,
      delay: 0,
      condition: async () => { conditionCalls += 1; return true; },
      onRetryExhausted: async () => { exhaustedCalls += 1; },
    },
  });
  await waitForTerminal(execution.ledger, 'RR-02');
  const terminal = execution.ledger.snapshot();
  const actual = {
    calls,
    conditionCalls,
    exhaustedCalls,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    terminalStatus: terminal.successes.at(-1) ?? null,
    errorHistory: terminal.errorHistories.at(-1) ?? [],
    errorRetryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
    successHistory: terminal.successDetails.find((detail) => detail.event === 'complete')?.history ?? [],
    successRetryAttempts: terminal.successDetails.find((detail) => detail.event === 'complete')?.retryAttempts ?? null,
  };
  const desired = {
    calls: 2,
    conditionCalls: 1,
    exhaustedCalls: 1,
    errors: 1,
    completes: 0,
    terminalStatus: null,
    errorHistory: [1, 2],
    errorRetryAttempts: 1,
    successHistory: [],
    successRetryAttempts: null,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: calls === 3
      && conditionCalls === 2
      && exhaustedCalls === 0
      && terminal.successes.at(-1) === 200
      && JSON.stringify(actual.successHistory) === '[1,2]'
      && actual.successRetryAttempts === 2,
  };
});

logicalRow('RR-03', 'custom condition false terminates once without retry callbacks or redispatch', async () => {
  let calls = 0;
  let conditionCalls = 0;
  let onRetryCalls = 0;
  let beforeRetryCalls = 0;
  let exhaustedCalls = 0;
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    await request.onHeaders?.({ status: 503, statusText: 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr03` });
    return validResult('download', 503, `${URL_BASE}/rr03`);
  }, {
    retry: {
      limit: 2,
      delay: 0,
      condition: async () => { conditionCalls += 1; return false; },
      onRetry: async () => { onRetryCalls += 1; return true; },
      onRetryExhausted: async () => { exhaustedCalls += 1; },
    },
    hooks: { beforeRetry: [async () => { beforeRetryCalls += 1; }] },
  });
  const terminal = await waitForTerminal(execution.ledger, 'RR-03');
  const actual = {
    calls,
    conditionCalls,
    onRetryCalls,
    beforeRetryCalls,
    exhaustedCalls,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    history: terminal.errorHistories.at(-1) ?? [],
    retryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
  };
  const desired = {
    calls: 1,
    conditionCalls: 1,
    onRetryCalls: 0,
    beforeRetryCalls: 0,
    exhaustedCalls: 1,
    errors: 1,
    completes: 0,
    history: [1],
    retryAttempts: 0,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: true,
  };
});

logicalRow('RR-04', 'onRetry false veto precedes beforeRetry, delay, and redispatch', async () => {
  let calls = 0;
  let onRetryCalls = 0;
  let beforeRetryCalls = 0;
  let exhaustedCalls = 0;
  let vetoAt = 0;
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    await request.onHeaders?.({ status: 503, statusText: 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr04` });
    return validResult('download', 503, `${URL_BASE}/rr04`);
  }, {
    retry: {
      limit: 2,
      delay: 70,
      onRetry: async () => { onRetryCalls += 1; vetoAt = Date.now(); return false; },
      onRetryExhausted: async () => { exhaustedCalls += 1; },
    },
    hooks: { beforeRetry: [async () => { beforeRetryCalls += 1; }] },
  });
  const terminal = await waitForTerminal(execution.ledger, 'RR-04');
  const settledAfterVetoMs = Date.now() - vetoAt;
  const actual = {
    calls,
    onRetryCalls,
    beforeRetryCalls,
    exhaustedCalls,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    history: terminal.errorHistories.at(-1) ?? [],
    retryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
    settledAfterVetoMs,
  };
  const desired = {
    calls: 1,
    onRetryCalls: 1,
    beforeRetryCalls: 0,
    exhaustedCalls: 0,
    errors: 1,
    completes: 0,
    history: [1],
    retryAttempts: 0,
    promptWithoutDelay: true,
  };
  return {
    actual,
    desired,
    desiredPass: calls === 1
      && onRetryCalls === 1
      && beforeRetryCalls === 0
      && exhaustedCalls === 0
      && terminal.errorCodes.length === 1
      && terminal.successDetails.length === 0
      && JSON.stringify(actual.history) === '[1]'
      && actual.retryAttempts === 0
      && settledAfterVetoMs < APPLICATION_TIMEOUT_MS,
    currentSignature: true,
  };
});

logicalRow('RR-05', 'retry decision and beforeRetry hooks preserve exact ordering and cardinality', async () => {
  let calls = 0;
  const order: string[] = [];
  let conditionError: unknown;
  let onRetrySameError = false;
  let onRetryAttempt: number | null = null;
  let onRetryDelay: number | null = null;
  const hookArguments: Array<Record<string, unknown>> = [];
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    order.push(`attempt:${calls}`);
    const status = calls === 1 ? 503 : 200;
    await request.onHeaders?.({ status, statusText: status === 200 ? 'OK' : 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr05` });
    return validResult('download', status, `${URL_BASE}/rr05`);
  }, {
    retry: {
      limit: 1,
      delay: 0,
      condition: async (error: unknown) => { conditionError = error; order.push('condition'); return true; },
      onRetry: async (error: unknown, attempt: number, retryDelay: number) => {
        onRetrySameError = error === conditionError;
        onRetryAttempt = attempt;
        onRetryDelay = retryDelay;
        order.push('onRetry');
        return true;
      },
    },
    hooks: {
      beforeRetry: [
        async (config: unknown, error: unknown, retryCount: number) => {
          hookArguments.push({
            hook: 1,
            sameError: error === conditionError,
            retryCount,
            configMatchesError: typeof error === 'object' && error !== null
              && Reflect.get(error, 'config') === config,
          });
          order.push('beforeRetry:1');
        },
        async (config: unknown, error: unknown, retryCount: number) => {
          hookArguments.push({
            hook: 2,
            sameError: error === conditionError,
            retryCount,
            configMatchesError: typeof error === 'object' && error !== null
              && Reflect.get(error, 'config') === config,
          });
          order.push('beforeRetry:2');
        },
      ],
    },
  });
  const terminal = await waitForTerminal(execution.ledger, 'RR-05');
  const complete = terminal.successDetails.find((detail) => detail.event === 'complete');
  const actual = {
    calls,
    order,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    status: terminal.successes.at(-1) ?? null,
    onRetrySameError,
    onRetryAttempt,
    onRetryDelay,
    hookArguments,
    history: complete?.history ?? [],
    retryAttempts: complete?.retryAttempts ?? null,
  };
  const desired = {
    calls: 2,
    order: ['attempt:1', 'condition', 'onRetry', 'beforeRetry:1', 'beforeRetry:2', 'attempt:2'],
    errors: 0,
    completes: 1,
    status: 200,
    onRetrySameError: true,
    onRetryAttempt: 1,
    onRetryDelay: 0,
    hookArguments: [
      { hook: 1, sameError: true, retryCount: 1, configMatchesError: true },
      { hook: 2, sameError: true, retryCount: 1, configMatchesError: true },
    ],
    history: [1],
    retryAttempts: 1,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: true,
  };
});

logicalRow('RR-06', 'beforeRetry failure is contained as one structured terminal and prevents redispatch', async () => {
  let calls = 0;
  let firstHookCalls = 0;
  let secondHookCalls = 0;
  const hookFailure = new Error('beforeRetry failure');
  Reflect.set(hookFailure, 'code', 'ECONNRESET');
  const execution = await executeNative('download', async (request) => {
    calls += 1;
    const status = calls === 1 ? 503 : 200;
    await request.onHeaders?.({ status, statusText: status === 200 ? 'OK' : 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr06` });
    return validResult('download', status, `${URL_BASE}/rr06`);
  }, {
    retry: { limit: 1, delay: 0 },
    hooks: {
      beforeRetry: [
        async () => { firstHookCalls += 1; throw hookFailure; },
        async () => { secondHookCalls += 1; },
      ],
    },
  });
  const terminal = await waitForTerminal(execution.ledger, 'RR-06');
  const publicError = execution.ledger.errors.at(-1)?.value;
  const actual = {
    calls,
    firstHookCalls,
    secondHookCalls,
    errors: terminal.errorCodes.length,
    completes: terminal.events.filter((event) => event === 'complete').length,
    status: terminal.successes.at(-1) ?? null,
    errorCode: terminal.errorCodes.at(-1) ?? null,
    causeIsHookFailure: typeof publicError === 'object' && publicError !== null
      && Reflect.get(publicError, 'cause') === hookFailure,
    causeMessage: causeMessage(publicError),
    history: terminal.errorHistories.at(-1) ?? [],
    retryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
    successFamily: terminal.successDetails.length,
  };
  const desired = {
    calls: 1,
    firstHookCalls: 1,
    secondHookCalls: 0,
    errors: 1,
    completes: 0,
    status: null,
    errorCode: 'REZ_UNKNOWN_ERROR',
    causeIsHookFailure: true,
    causeMessage: 'beforeRetry failure',
    history: [1],
    retryAttempts: 0,
    successFamily: 0,
  };
  return {
    actual,
    desired,
    desiredPass: JSON.stringify(actual) === JSON.stringify(desired),
    currentSignature: calls === 2
      && firstHookCalls === 1
      && secondHookCalls === 1
      && terminal.errorCodes.length === 0
      && terminal.successes.at(-1) === 200,
  };
});

logicalRow('RR-07', 'caller abort interrupts pending condition, onRetry, and beforeRetry stages', async () => {
  const stages = ['condition', 'onRetry', 'beforeRetry'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    const gate = createDeferred<void>();
    const controller = new AbortController();
    const listenerAudit = installAbortListenerAudit(controller.signal);
    let calls = 0;
    let stageCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    const execution = await executeNative('download', async (request) => {
      calls += 1;
      const status = calls === 1 ? 503 : 200;
      await request.onHeaders?.({ status, statusText: status === 200 ? 'OK' : 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr07-${stage}` });
      return validResult('download', status, `${URL_BASE}/rr07-${stage}`);
    }, {
      signal: controller.signal,
      retry: {
        limit: 1,
        delay: 0,
        ...(stage === 'condition' ? { condition: async () => { stageCalls += 1; await gate.promise; return true; } } : {}),
        ...(stage === 'onRetry' ? { onRetry: async () => { stageCalls += 1; await gate.promise; return true; } } : {}),
      },
      hooks: {
        ...(stage === 'beforeRetry'
          ? { beforeRetry: [async () => { stageCalls += 1; await gate.promise; }] }
          : {}),
        onAbort: [async () => { onAbortCalls += 1; }],
        onTimeout: [async () => { onTimeoutCalls += 1; }],
      },
    });
    await waitFor(() => stageCalls === 1, `RR-07 ${stage} was not entered`);
    controller.abort();
    await delay(CURRENT_WINDOW_MS);
    const atAbort = execution.ledger.snapshot();
    const callsAtAbort = calls;
    gate.resolve(undefined);
    await waitForTerminal(execution.ledger, `RR-07 ${stage} after release`);
    await delay(LATE_WINDOW_MS);
    const final = execution.ledger.snapshot();
    const callerListeners = {
      added: listenerAudit.added,
      removed: listenerAudit.removed,
      live: listenerAudit.live,
    };
    listenerAudit.restore();
    actual.push({
      stage,
      callsAtAbort,
      atAbortTerminals: terminalCount(atAbort),
      atAbortCodes: atAbort.errorCodes,
      finalCalls: calls,
      final,
      onAbortCalls,
      onTimeoutCalls,
      callerListeners,
    });
  }
  const desired = stages.map((stage) => ({ stage, callsAtAbort: 1, atAbortTerminals: 1, finalCalls: 1 }));
  const desiredPass = actual.every((entry) => (
    entry.atAbortTerminals === 1
    && JSON.stringify(entry.atAbortCodes) === '["ABORT_ERR"]'
    && entry.finalCalls === 1
    && entry.onAbortCalls === 1
    && entry.onTimeoutCalls === 0
    && (entry.callerListeners as { added: number; live: number }).added >= 1
    && (entry.callerListeners as { added: number; live: number }).live === 0
    && terminalCount(entry.final as FacadeSnapshot) === 1
    && (entry.final as FacadeSnapshot).successDetails.length === 0
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      entry.callsAtAbort === 1 && entry.atAbortTerminals === 0 && entry.finalCalls === 2
      && (entry.final as FacadeSnapshot).events.filter((event) => event === 'complete').length === 1
    )),
  };
});

logicalRow('RR-08', 'caller abort interrupts retry delay and rate-limit hook wait', async () => {
  const stages = ['retryDelay', 'rateHook', 'rateSleep'] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    const controller = new AbortController();
    const listenerAudit = installAbortListenerAudit(controller.signal);
    const rateGate = createDeferred<void>();
    let calls = 0;
    let rateHookCalls = 0;
    let onAbortCalls = 0;
    let onTimeoutCalls = 0;
    const rateStage = stage === 'rateHook' || stage === 'rateSleep';
    const execution = await executeNative('download', async (request) => {
      calls += 1;
      const status = calls === 1 ? (rateStage ? 429 : 503) : 200;
      await request.onHeaders?.({
        status,
        statusText: status === 200 ? 'OK' : 'Failure',
        headers: stage === 'rateHook' ? { 'retry-after': '0' } : {},
        finalUrl: `${URL_BASE}/rr08-${stage}`,
      });
      return validResult('download', status, `${URL_BASE}/rr08-${stage}`);
    }, {
      signal: controller.signal,
      retry: { limit: 1, delay: stage === 'retryDelay' ? CURRENT_WINDOW_MS + 40 : 0 },
      ...(rateStage ? {
        waitOnStatus: true,
        defaultWaitTime: stage === 'rateSleep' ? CURRENT_WINDOW_MS + 40 : 0,
        maxWaitTime: CURRENT_WINDOW_MS + 100,
      } : {}),
      hooks: {
        ...(stage === 'rateHook'
          ? { onRateLimitWait: [async () => { rateHookCalls += 1; await rateGate.promise; }] }
          : {}),
        ...(stage === 'rateSleep'
          ? { onRateLimitWait: [async () => { rateHookCalls += 1; }] }
          : {}),
        onAbort: [async () => { onAbortCalls += 1; }],
        onTimeout: [async () => { onTimeoutCalls += 1; }],
      },
    });
    if (stage === 'retryDelay') await waitFor(() => calls === 1, 'RR-08 retry first attempt missing');
    else await waitFor(() => rateHookCalls === 1, 'RR-08 rate hook was not entered');
    if (stage !== 'rateHook') await delay(5);
    controller.abort();
    await delay(CURRENT_WINDOW_MS);
    const atAbort = execution.ledger.snapshot();
    const callsAtAbort = calls;
    rateGate.resolve(undefined);
    await waitForTerminal(execution.ledger, `RR-08 ${stage} eventual terminal`);
    await delay(LATE_WINDOW_MS);
    const final = execution.ledger.snapshot();
    const callerListeners = {
      added: listenerAudit.added,
      removed: listenerAudit.removed,
      live: listenerAudit.live,
    };
    listenerAudit.restore();
    actual.push({
      stage,
      callsAtAbort,
      atAbortTerminals: terminalCount(atAbort),
      atAbortCodes: atAbort.errorCodes,
      finalCalls: calls,
      final,
      onAbortCalls,
      onTimeoutCalls,
      callerListeners,
    });
  }
  const desired = stages.map((stage) => ({ stage, callsAtAbort: 1, atAbortTerminals: 1, finalCalls: 1 }));
  const desiredPass = actual.every((entry) => (
    entry.atAbortTerminals === 1
    && JSON.stringify(entry.atAbortCodes) === '["ABORT_ERR"]'
    && entry.finalCalls === 1
    && entry.onAbortCalls === 1
    && entry.onTimeoutCalls === 0
    && (entry.callerListeners as { added: number; live: number }).added >= 1
    && (entry.callerListeners as { added: number; live: number }).live === 0
    && terminalCount(entry.final as FacadeSnapshot) === 1
    && (entry.final as FacadeSnapshot).successDetails.length === 0
  ));
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => (
      entry.atAbortTerminals === 0
      && entry.finalCalls === 2
      && (entry.final as FacadeSnapshot).events.filter((event) => event === 'complete').length === 1
    )),
  };
});

logicalRow('RR-09', 'no retry occurs after public stream data or file transfer progress', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    let calls = 0;
    let conditionCalls = 0;
    let onRetryCalls = 0;
    let beforeRetryCalls = 0;
    let exhaustedCalls = 0;
    const execution = await executeNative(mode, async (request) => {
      calls += 1;
      if (calls === 1) {
        if (mode === 'stream') {
          await request.onHeaders?.({ status: 200, statusText: 'OK', headers: {}, finalUrl: `${URL_BASE}/rr09-stream` });
          await request.onChunk?.('public-byte');
        } else {
          await request.onProgress?.({ loaded: 1, total: 4 });
        }
        const error = new Error('provider timed out after public transfer');
        Reflect.set(error, 'code', 'ETIMEDOUT');
        throw error;
      }
      if (mode !== 'upload') {
        await request.onHeaders?.({ status: 200, statusText: 'OK', headers: {}, finalUrl: `${URL_BASE}/rr09-${mode}` });
      }
      return validResult(mode, 200, `${URL_BASE}/rr09-${mode}`);
    }, {
      retry: {
        limit: 1,
        delay: 0,
        methods: ['GET', 'POST'],
        condition: async () => { conditionCalls += 1; return true; },
        onRetry: async () => { onRetryCalls += 1; return true; },
        onRetryExhausted: async () => { exhaustedCalls += 1; },
      },
      hooks: { beforeRetry: [async () => { beforeRetryCalls += 1; }] },
    });
    const terminal = await waitForTerminal(execution.ledger, `RR-09 ${mode}`);
    actual.push({
      mode,
      calls,
      publicData: terminal.data,
      publicProgress: terminal.progress,
      errors: terminal.errorCodes.length,
      errorCodes: terminal.errorCodes,
      history: terminal.errorHistories.at(-1) ?? [],
      retryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
      completes: terminal.events.filter((event) => event === 'complete').length,
      successFamily: terminal.successDetails.length,
      conditionCalls,
      onRetryCalls,
      beforeRetryCalls,
      exhaustedCalls,
    });
  }
  const desired = actual.map((entry) => ({
    mode: entry.mode,
    calls: 1,
    errors: 1,
    completes: 0,
    publicTransferObserved: true,
  }));
  const desiredPass = actual.every((entry) => {
    const transferObserved = entry.mode === 'stream'
      ? JSON.stringify(entry.publicData) === '["public-byte"]'
      : JSON.stringify(entry.publicProgress) === '[1]';
    return transferObserved
      && entry.calls === 1
      && entry.errors === 1
      && JSON.stringify(entry.errorCodes) === '["ETIMEDOUT"]'
      && JSON.stringify(entry.history) === '[1]'
      && entry.retryAttempts === 0
      && entry.completes === 0
      && entry.successFamily === 0
      && entry.conditionCalls === 0
      && entry.onRetryCalls === 0
      && entry.beforeRetryCalls === 0
      && entry.exhaustedCalls === 0;
  });
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: actual.every((entry) => {
      const transferObserved = entry.mode === 'stream'
        ? JSON.stringify(entry.publicData) === '["public-byte"]'
        : JSON.stringify(entry.publicProgress) === '[1]';
      return transferObserved
        && entry.calls === 2
        && entry.completes === 1
        && entry.conditionCalls === 1
        && entry.onRetryCalls === 1
        && entry.beforeRetryCalls === 1;
    }),
  };
});

logicalRow('RR-10', 'final exhaustion has exact history and one public error including Fetch-backed facades', async () => {
  const native: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    let calls = 0;
    let onRetryCalls = 0;
    let beforeRetryCalls = 0;
    let exhaustedCalls = 0;
    const execution = await executeNative(mode, async (request) => {
      calls += 1;
      if (mode !== 'upload') {
        await request.onHeaders?.({ status: 503, statusText: 'Failure', headers: {}, finalUrl: `${URL_BASE}/rr10-${mode}` });
      }
      return validResult(mode, 503, `${URL_BASE}/rr10-${mode}`);
    }, {
      retry: {
        limit: 1,
        delay: 0,
        methods: ['GET', 'POST'],
        onRetry: async () => { onRetryCalls += 1; return true; },
        onRetryExhausted: async () => { exhaustedCalls += 1; },
      },
      hooks: { beforeRetry: [async () => { beforeRetryCalls += 1; }] },
    });
    const terminal = await waitForTerminal(execution.ledger, `RR-10 ${mode}`);
    native.push({
      mode,
      calls,
      onRetryCalls,
      beforeRetryCalls,
      exhaustedCalls,
      publicErrors: terminal.errorCodes.length,
      history: terminal.errorHistories.at(-1) ?? [],
      retryAttempts: terminal.errorRetryAttempts.at(-1) ?? null,
      completes: terminal.events.filter((event) => event === 'complete').length,
    });
  }

  let fetchCalls = 0;
  let fetchOnRetryCalls = 0;
  let fetchBeforeRetryCalls = 0;
  let fetchExhaustedCalls = 0;
  installFetch(async () => {
    fetchCalls += 1;
    return response({ status: 503, body: 'failure' });
  });
  const fetchFacade = new UploadResponse(`${URL_BASE}/rr10-fetch`, 'buffered') as unknown as FacadeLike;
  const fetchLedger = observeFacade(fetchFacade);
  const returned = await executeRequest({
    url: `${URL_BASE}/rr10-fetch`,
    method: 'POST',
    body: 'payload',
    _isUpload: true,
    _uploadResponse: fetchFacade,
    retry: {
      limit: 1,
      delay: 0,
      methods: ['POST'],
      onRetry: async () => { fetchOnRetryCalls += 1; return true; },
      onRetryExhausted: async () => { fetchExhaustedCalls += 1; },
    },
    hooks: { beforeRetry: [async () => { fetchBeforeRetryCalls += 1; }] },
    cache: false,
  } as never, {} as never, new RezoCookieJar());
  if (returned !== fetchFacade) throw new InfrastructureError('RR-10 Fetch facade identity moved');
  await waitFor(
    () => fetchCalls === 2
      && fetchExhaustedCalls === 1
      && terminalCount(fetchLedger.snapshot()) > 0,
    'RR-10 Fetch facade did not exhaust',
  );
  await delay(LATE_WINDOW_MS);
  const fetchTerminal = fetchLedger.snapshot();
  const fetchActual = {
    calls: fetchCalls,
    publicErrors: fetchTerminal.errorCodes.length,
    history: fetchTerminal.errorHistories.at(-1) ?? [],
    retryAttempts: fetchTerminal.errorRetryAttempts.at(-1) ?? null,
    completes: fetchTerminal.events.filter((event) => event === 'complete').length,
    onRetryCalls: fetchOnRetryCalls,
    beforeRetryCalls: fetchBeforeRetryCalls,
    exhaustedCalls: fetchExhaustedCalls,
  };
  const actual = { native, fetch: fetchActual };
  const desired = {
    native: 'each two attempts, one onRetry, one beforeRetry, one exhausted, history [1,2], one public error',
    fetch: {
      calls: 2,
      publicErrors: 1,
      history: [1, 2],
      retryAttempts: 1,
      completes: 0,
      onRetryCalls: 1,
      beforeRetryCalls: 1,
      exhaustedCalls: 1,
    },
  };
  const nativePass = native.every((entry) => (
    entry.calls === 2
    && entry.onRetryCalls === 1
    && entry.beforeRetryCalls === 1
    && entry.exhaustedCalls === 1
    && entry.publicErrors === 1
    && JSON.stringify(entry.history) === '[1,2]'
    && entry.retryAttempts === 1
    && entry.completes === 0
  ));
  const desiredPass = nativePass && JSON.stringify(fetchActual) === JSON.stringify(desired.fetch);
  return {
    actual,
    desired,
    desiredPass,
    currentSignature: nativePass
      && fetchActual.calls === 2
      && fetchActual.publicErrors === 3
      && JSON.stringify(fetchActual.history) === '[1,2]'
      && fetchActual.retryAttempts === 1
      && fetchActual.completes === 0
      && fetchActual.onRetryCalls === 1
      && fetchActual.beforeRetryCalls === 1
      && fetchActual.exhaustedCalls === 1,
  };
});

// --------------------------------------------------------------- ledger --

afterAll(() => {
  process.off('unhandledRejection', onUnhandledRejection);
  const closing = {
    adapterSha256: sha256(ADAPTER_PATH),
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
    schema: 'rezo.react-native.phase4-lifecycle.red-ledger/v1',
    evidence: 'Tier-C injected Node/Bun evidence; not stock React Native proof',
    file: 'test/a-plus-react-native-phase4-lifecycle.test.ts',
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
  console.log(`REZO_RN_PHASE4_RED_LEDGER_V1:${JSON.stringify(ledger)}`);

  const faults: string[] = [];
  if (registeredActual.length !== REGISTERED.length
    || JSON.stringify(registeredActual) !== JSON.stringify([...REGISTERED].sort())) {
    faults.push(`registered:${JSON.stringify(registeredActual)}`);
  }
  if ([...invocations.values()].some((count) => count !== 1)) {
    faults.push(`invocation-counts:${JSON.stringify(invocationCounts)}`);
  }
  if (JSON.stringify(red) !== JSON.stringify(expectedRed)) faults.push(`red:${JSON.stringify(red)}`);
  if (red.length !== 0 || controls.length !== 30) faults.push(`denominator:${red.length}/${controls.length}`);
  if (fixtureErrors.length > 0) faults.push(`fixture:${fixtureErrors.join('|')}`);
  if (oracleMismatches.length > 0) faults.push(`oracle:${oracleMismatches.join('|')}`);
  if (cleanupErrors.length > 0) faults.push(`cleanup:${cleanupErrors.join('|')}`);
  if (unhandledRejections.length > 0) faults.push(`unhandled:${unhandledRejections.map(describeUnknown).join('|')}`);
  if (closing.adapterSha256 !== OPENING.adapterSha256 || closing.carrierSha256 !== OPENING.carrierSha256) {
    faults.push('identity-moved');
  }
  if (faults.length > 0) {
    throw new Error(`RN Phase 4 RED ledger rejected: ${faults.join('; ')}`);
  }
});
