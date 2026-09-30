/**
 * React Native A+ Phase 5 adapter carrier (RF/RB/RO).
 *
 * Tier-C evidence only: Fetch and every React Native service are injected.
 * This file earns no Metro, Hermes, JSC, device, Expo, or RNFS credit.
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER_PATH = fileURLToPath(import.meta.url);
const PINNED = Object.freeze({
  'src/adapters/react-native.ts': 'e6704a9a9cd633698731d63e95069f9ae4d874c33fe50f6c05421b402d8d5879',
  'src/utils/http-config.ts': 'ab33e9d5e78f112bc63741e62cc3790c388e822f54bf9b696b66c38a87973c21',
  'src/cache/universal-response-cache.ts': 'b91378c708a6d8d17c8bf2d6ac98161c559f86ced38b1e2451d2e9a639f023ef',
  'src/responses/universal/stream.ts': 'aa6caa9f2f779db87c02de90a22d3da78b18a1daa462ccb09e88308fd3bccf75',
  'src/responses/universal/download.ts': '8fe577f4e10d58aa5659e9c58cfb771706224c86876fe4cc102c49da3ed148ca',
  'src/responses/universal/upload.ts': 'e5074731180e2ebfe5849a9c288498b8a16c09e746e69cbfb281b60a0ac7e982',
  'src/cookies/cookie-jar.ts': 'a5bd08c165d1414f4513872ec037b9de5eb989686f2b3c675dcbf6d333294cd6',
});

const REGISTERED = [
  'RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07', 'RF-08',
  'RB-01', 'RB-02', 'RB-03', 'RB-04', 'RB-05', 'RB-06', 'RB-07', 'RB-08', 'RB-09', 'RB-10',
  'RO-01', 'RO-02', 'RO-03', 'RO-04', 'RO-05', 'RO-06', 'RO-07', 'RO-08', 'RO-09', 'RO-10', 'RO-11', 'RO-12',
] as const;
type RowId = (typeof REGISTERED)[number];
type NativeMode = 'stream' | 'download' | 'upload';

// RB-01 is a collateral Phase 4 control: the pinned adapter already awaits
// async afterParse work in both buffered Fetch and native upload lanes.
const EXPECTED_RED: readonly RowId[] = [];

const URL_BASE = 'https://phase5.react-native.rezo.test';
const LATE_WINDOW_MS = 25;
const HARNESS_TIMEOUT_MS = 1_500;

interface RowResult {
  readonly actual: unknown;
  readonly desired: unknown;
  readonly desiredPass: boolean;
  readonly currentSignature: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface FacadeLike {
  on(event: string, listener: (...args: any[]) => void): FacadeLike;
  isFinished(): boolean;
  pipe?(destination: unknown, options?: { end?: boolean }): unknown;
}

interface FacadeLedger {
  readonly events: string[];
  readonly errors: unknown[];
  readonly successes: unknown[];
  readonly chunks: unknown[];
  snapshot(): {
    events: string[];
    errorCodes: Array<string | null>;
    errorMessages: string[];
    successes: number;
    chunks: unknown[];
    finished: boolean;
  };
}

interface TimerAudit {
  readonly live: Set<ReturnType<typeof setTimeout>>;
  restore(): void;
  dispose(): void;
}

interface ListenerAudit {
  readonly live: number;
  restore(): void;
}

const invocations = new Map<RowId, number>();
const observations = new Map<RowId, RowResult>();
const actualRed = new Set<RowId>();
const passed = new Set<RowId>();
const fixtureErrors: string[] = [];
const oracleErrors: string[] = [];
const cleanupErrors: string[] = [];
const unhandledRejections: unknown[] = [];
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`RN Phase 5 carrier infrastructure invalidity: ${message}`);
    this.name = 'InfrastructureError';
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function identities(): Record<string, string> {
  return Object.fromEntries(Object.keys(PINNED).map((path) => [path, sha256(resolve(REPO_ROOT, path))]));
}

const OPENING = Object.freeze({ dependencies: identities(), carrierSha256: sha256(CARRIER_PATH) });
for (const [path, expected] of Object.entries(PINNED)) {
  if (OPENING.dependencies[path] !== expected) {
    throw new InfrastructureError(`${path} actual ${OPENING.dependencies[path]} expected ${expected}`);
  }
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const code = Reflect.get(value, 'code');
  return typeof code === 'string' ? code : null;
}

function errorMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value);
  const message = Reflect.get(value, 'message');
  return typeof message === 'string' ? message : String(value);
}

function errorCauseMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const cause = Reflect.get(value, 'cause');
  if (cause instanceof Error) return cause.message;
  return null;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>['resolve'];
  let rejectPromise!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new InfrastructureError(`${label} exceeded ${HARNESS_TIMEOUT_MS}ms`)), HARNESS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > HARNESS_TIMEOUT_MS) throw new InfrastructureError(label);
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
      if (typeof handler === 'function') (handler as (...values: unknown[]) => void)(...args);
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
    restore() { globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout; },
    dispose() { for (const handle of live) nativeClearTimeout(handle); live.clear(); },
  };
}

function installListenerAudit(): ListenerAudit {
  const prototype = AbortSignal.prototype;
  const nativeAdd = prototype.addEventListener;
  const nativeRemove = prototype.removeEventListener;
  const records: Array<{
    signal: AbortSignal;
    listener: EventListenerOrEventListenerObject;
    delegate: EventListener;
    active: boolean;
  }> = [];
  prototype.addEventListener = function addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type !== 'abort' || listener === null) {
      nativeAdd.call(this, type, listener, options);
      return;
    }
    const record = {
      signal: this,
      listener,
      delegate: undefined as unknown as EventListener,
      active: true,
    };
    const once = typeof options === 'object' && options.once === true;
    record.delegate = (event) => {
      if (once) record.active = false;
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    };
    records.push(record);
    nativeAdd.call(this, type, record.delegate, options);
  };
  prototype.removeEventListener = function removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === 'abort' && listener !== null) {
      const record = [...records].reverse().find((entry) => entry.active && entry.signal === this && entry.listener === listener);
      if (record) {
        record.active = false;
        nativeRemove.call(this, type, record.delegate, options);
        return;
      }
    }
    nativeRemove.call(this, type, listener, options);
  };
  return {
    get live() { return records.filter((record) => record.active).length; },
    restore() {
      prototype.addEventListener = nativeAdd;
      prototype.removeEventListener = nativeRemove;
      for (const record of records) {
        if (record.active) nativeRemove.call(record.signal, 'abort', record.delegate);
        record.active = false;
      }
    },
  };
}

function normalizeChunk(chunk: unknown): unknown {
  if (chunk instanceof Uint8Array) return [...chunk];
  return chunk;
}

function observeFacade(facade: FacadeLike): FacadeLedger {
  const events: string[] = [];
  const errors: unknown[] = [];
  const successes: unknown[] = [];
  const chunks: unknown[] = [];
  for (const event of ['initiated', 'start', 'headers', 'status', 'cookies', 'progress', 'end', 'close'] as const) {
    facade.on(event, () => events.push(event));
  }
  facade.on('data', (chunk) => { events.push('data'); chunks.push(normalizeChunk(chunk)); });
  facade.on('error', (error) => { events.push('error'); errors.push(error); });
  for (const event of ['finish', 'done', 'complete'] as const) {
    facade.on(event, (value) => { events.push(event); successes.push(value); });
  }
  return {
    events,
    errors,
    successes,
    chunks,
    snapshot: () => ({
      events: [...events],
      errorCodes: errors.map(errorCode),
      errorMessages: errors.map(errorMessage),
      successes: successes.length,
      chunks: [...chunks],
      finished: facade.isFinished(),
    }),
  };
}

function terminalCount(ledger: FacadeLedger): number {
  return ledger.events.filter((event) => event === 'error' || event === 'complete').length;
}

function successFamily(ledger: FacadeLedger): string[] {
  return ledger.events.filter((event) => event === 'finish' || event === 'done' || event === 'complete');
}

function eventStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const direct = Reflect.get(value, 'status');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(value, 'response');
  if (typeof response === 'object' && response !== null && typeof Reflect.get(response, 'status') === 'number') {
    return Reflect.get(response, 'status') as number;
  }
  return null;
}

function eventFinalUrl(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const finalUrl = Reflect.get(value, 'finalUrl');
  return typeof finalUrl === 'string' ? finalUrl : null;
}

async function waitForTerminal(ledger: FacadeLedger, label: string): Promise<void> {
  await waitFor(() => terminalCount(ledger) > 0, `${label} produced no terminal`);
}

function createFacade(mode: NativeMode, suffix: string): FacadeLike {
  if (mode === 'stream') return new StreamResponse() as unknown as FacadeLike;
  if (mode === 'download') return new DownloadResponse(`/tmp/${suffix}.bin`, `${URL_BASE}/${suffix}`) as unknown as FacadeLike;
  return new UploadResponse(`${URL_BASE}/${suffix}`, `${suffix}.bin`) as unknown as FacadeLike;
}

function validNativeResult(mode: NativeMode, suffix: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const contentType = mode === 'download' ? 'application/octet-stream' : 'text/plain';
  const base: Record<string, unknown> = {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': contentType, 'content-length': '2' },
    finalUrl: `${URL_BASE}/${suffix}`,
    contentType,
    contentLength: 2,
  };
  if (mode === 'download') Object.assign(base, { filePath: `/tmp/${suffix}.bin`, fileSize: 2 });
  if (mode === 'upload') Object.assign(base, { body: 'ok', uploadSize: 2, fileName: `${suffix}.bin` });
  return Object.assign(base, overrides);
}

interface NativeLaunch {
  readonly facade: FacadeLike;
  readonly ledger: FacadeLedger;
  readonly returned: unknown;
}

async function launchNative(
  mode: NativeMode,
  suffix: string,
  provider: (request: any) => Promise<any>,
  requestExtras: Record<string, unknown> = {},
  reactNativeExtras: Record<string, unknown> = {},
): Promise<NativeLaunch> {
  const facade = createFacade(mode, suffix);
  const ledger = observeFacade(facade);
  const request: Record<string, unknown> = {
    url: `${URL_BASE}/${suffix}`,
    method: mode === 'upload' ? 'POST' : 'GET',
    retry: false,
    cache: false,
    ...requestExtras,
  };
  const reactNative: Record<string, unknown> = { ...reactNativeExtras };
  if (mode === 'stream') {
    request.responseType = 'stream';
    request._streamResponse = facade;
    reactNative.streamTransport = { name: 'phase5-stream', stream: provider };
  } else if (mode === 'download') {
    request.saveTo = `/tmp/${suffix}.bin`;
    request._isDownload = true;
    request._downloadResponse = facade;
    reactNative.fileSystemAdapter = {
      name: 'phase5-fs',
      capabilities: { fileDownload: true, downloadProgress: true },
      downloadFile: provider,
    };
  } else {
    request.body = request.body ?? {
      uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, type: 'application/octet-stream', size: 2,
    };
    request._isUpload = true;
    request._uploadResponse = facade;
    reactNative.fileSystemAdapter = {
      name: 'phase5-fs',
      capabilities: { uploadFromFile: true, uploadProgress: true },
      uploadFile: provider,
    };
  }
  const returned = await withWatchdog(
    executeRequest(request as never, { reactNative } as never, new RezoCookieJar()),
    `${suffix} facade return`,
  );
  if (returned !== facade) throw new InfrastructureError(`${suffix} returned a different facade`);
  return { facade, ledger, returned };
}

function installFetch(implementation: (url: string, init: RequestInit) => Promise<Response>): void {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: implementation });
}

function fakeResponse(spec: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  url?: string;
  body?: unknown;
  bytes?: Uint8Array;
  onText?: () => void;
  onJson?: () => void;
  onArrayBuffer?: () => void;
  onBlob?: () => void;
} = {}): Response {
  const status = spec.status ?? 200;
  const body = spec.body ?? 'ok';
  const bytes = spec.bytes ?? new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  const text = typeof body === 'string' ? body : new TextDecoder().decode(bytes);
  return {
    status,
    statusText: spec.statusText ?? (status >= 400 ? 'Failure' : 'OK'),
    headers: new Headers(spec.headers ?? { 'content-type': 'text/plain', 'content-length': String(bytes.byteLength) }),
    url: spec.url ?? `${URL_BASE}/final`,
    async text() { spec.onText?.(); return text; },
    async json() { spec.onJson?.(); return JSON.parse(text); },
    async arrayBuffer() { spec.onArrayBuffer?.(); return bytes.slice().buffer; },
    async blob() { spec.onBlob?.(); return new Blob([bytes]); },
  } as Response;
}

async function settle(promise: Promise<unknown>): Promise<{ outcome: 'fulfilled' | 'rejected'; value: unknown }> {
  try { return { outcome: 'fulfilled', value: await promise }; }
  catch (error) { return { outcome: 'rejected', value: error }; }
}

function bytesOf(value: unknown): number[] | null {
  if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
  if (ArrayBuffer.isView(value)) return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
  return null;
}

function logicalRow(id: RowId, title: string, operation: () => Promise<RowResult>): void {
  it(`${id} ${title}`, async () => {
    invocations.set(id, (invocations.get(id) ?? 0) + 1);
    const unhandledStart = unhandledRejections.length;
    const timerAudit = installTimerAudit();
    const listenerAudit = installListenerAudit();
    let result: RowResult | undefined;
    let operationError: unknown;
    try {
      result = await withWatchdog(operation(), `${id} operation`);
      await delay(LATE_WINDOW_MS);
    } catch (error) {
      fixtureErrors.push(`${id}:${describeUnknown(error)}`);
      operationError = error;
    }
    timerAudit.restore();
    const timerResidue = timerAudit.live.size;
    const listenerResidue = listenerAudit.live;
    listenerAudit.restore();
    if (timerResidue > 0) { cleanupErrors.push(`${id}:timers:${timerResidue}`); timerAudit.dispose(); }
    if (listenerResidue > 0) cleanupErrors.push(`${id}:listeners:${listenerResidue}`);
    if (!result) throw operationError;
    observations.set(id, result);
    const rowUnhandled = unhandledRejections.slice(unhandledStart);
    const desiredPass = result.desiredPass && timerResidue === 0 && listenerResidue === 0 && rowUnhandled.length === 0;
    if (desiredPass) { passed.add(id); return; }
    if (!EXPECTED_RED.includes(id)) {
      oracleErrors.push(`${id}:unexpected-failure`);
      throw new Error(`${id} unexpected failure: ${JSON.stringify(result.actual)}`);
    }
    if (!result.currentSignature) {
      oracleErrors.push(`${id}:current-signature-moved`);
      throw new Error(`${id} current signature moved: ${JSON.stringify(result.actual)}`);
    }
    actualRed.add(id);
    throw new Error(`${id} expected RED: ${JSON.stringify(result.actual)}`);
  }, HARNESS_TIMEOUT_MS + 1_000);
}

function onUnhandledRejection(reason: unknown): void { unhandledRejections.push(reason); }

beforeAll(() => { process.on('unhandledRejection', onUnhandledRejection); });
afterEach(() => {
  if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  else Reflect.deleteProperty(globalThis, 'fetch');
});

// --------------------------------------------------------------- RF rows --

logicalRow('RF-01', 'ordinary GET cache entries cannot bypass a stream facade', async () => {
  const url = `${URL_BASE}/rf01`;
  let fetchCalls = 0;
  let providerCalls = 0;
  installFetch(async () => { fetchCalls += 1; return fakeResponse({ url, body: 'seed' }); });
  await executeRequest({ url, method: 'GET', cache: true, retry: false } as never, {} as never, new RezoCookieJar());
  const facade = createFacade('stream', 'rf01');
  const ledger = observeFacade(facade);
  const returned = await executeRequest({
    url, method: 'GET', responseType: 'stream', cache: true, retry: false, _streamResponse: facade,
  } as never, {
    reactNative: { streamTransport: { name: 'rf01', async stream() { providerCalls += 1; return validNativeResult('stream', 'rf01'); } } },
  } as never, new RezoCookieJar());
  await delay(10);
  const success = ledger.successes.at(-1);
  const actual = { fetchCalls, providerCalls, returnedFacade: returned === facade, successFamily: successFamily(ledger),
    errors: ledger.errors.length, status: eventStatus(success), finalUrl: eventFinalUrl(success), finished: facade.isFinished() };
  return {
    actual,
    desired: { fetchCalls: 1, providerCalls: 1, returnedFacade: true, successFamily: ['finish', 'done', 'complete'], errors: 0,
      status: 200, finalUrl: url, finished: true },
    desiredPass: fetchCalls === 1 && providerCalls === 1 && returned === facade
      && JSON.stringify(successFamily(ledger)) === JSON.stringify(['finish', 'done', 'complete']) && ledger.errors.length === 0
      && eventStatus(success) === 200 && eventFinalUrl(success) === url && facade.isFinished(),
    currentSignature: fetchCalls === 1 && providerCalls === 0 && returned !== facade && terminalCount(ledger) === 0 && !facade.isFinished(),
  };
});

logicalRow('RF-02', 'ordinary GET cache entries cannot bypass native download', async () => {
  const url = `${URL_BASE}/rf02`;
  let fetchCalls = 0;
  let providerCalls = 0;
  installFetch(async () => { fetchCalls += 1; return fakeResponse({ url, body: 'seed' }); });
  await executeRequest({ url, method: 'GET', cache: true, retry: false } as never, {} as never, new RezoCookieJar());
  const facade = createFacade('download', 'rf02');
  const ledger = observeFacade(facade);
  const returned = await executeRequest({
    url, method: 'GET', saveTo: '/tmp/rf02.bin', _isDownload: true, _downloadResponse: facade, cache: true, retry: false,
  } as never, {
    reactNative: { fileSystemAdapter: {
      name: 'rf02', capabilities: { fileDownload: true },
      async downloadFile() { providerCalls += 1; return validNativeResult('download', 'rf02'); },
    } },
  } as never, new RezoCookieJar());
  await delay(10);
  const success = ledger.successes.at(-1);
  const actual = { fetchCalls, providerCalls, returnedFacade: returned === facade, successFamily: successFamily(ledger),
    errors: ledger.errors.length, status: eventStatus(success), finalUrl: eventFinalUrl(success), finished: facade.isFinished() };
  return {
    actual,
    desired: { fetchCalls: 1, providerCalls: 1, returnedFacade: true, terminal: 1, finished: true },
    desiredPass: fetchCalls === 1 && providerCalls === 1 && returned === facade
      && JSON.stringify(successFamily(ledger)) === JSON.stringify(['finish', 'done', 'complete']) && ledger.errors.length === 0
      && eventStatus(success) === 200 && eventFinalUrl(success) === url && facade.isFinished(),
    currentSignature: fetchCalls === 1 && providerCalls === 0 && returned !== facade && terminalCount(ledger) === 0 && !facade.isFinished(),
  };
});

logicalRow('RF-03', 'configured POST cache entries cannot bypass native upload', async () => {
  const url = `${URL_BASE}/rf03`;
  const cache = { ttl: 60_000, methods: ['POST'] };
  let fetchCalls = 0;
  let providerCalls = 0;
  installFetch(async () => { fetchCalls += 1; return fakeResponse({ url, body: 'seed' }); });
  await executeRequest({
    url, method: 'POST', body: 'seed', headers: { 'content-type': 'application/octet-stream' }, cache, retry: false,
  } as never, {} as never, new RezoCookieJar());
  const facade = createFacade('upload', 'rf03');
  const ledger = observeFacade(facade);
  const returned = await executeRequest({
    url,
    method: 'POST',
    body: { uri: 'file:///tmp/rf03.bin', name: 'rf03.bin', type: 'application/octet-stream', size: 2 },
    headers: { 'content-type': 'application/octet-stream' },
    _isUpload: true,
    _uploadResponse: facade,
    cache,
    retry: false,
  } as never, {
    reactNative: { fileSystemAdapter: {
      name: 'rf03', capabilities: { uploadFromFile: true },
      async uploadFile() { providerCalls += 1; return validNativeResult('upload', 'rf03'); },
    } },
  } as never, new RezoCookieJar());
  await delay(10);
  const success = ledger.successes.at(-1);
  const actual = { fetchCalls, providerCalls, returnedFacade: returned === facade, successFamily: successFamily(ledger),
    errors: ledger.errors.length, status: eventStatus(success), finalUrl: eventFinalUrl(success), finished: facade.isFinished() };
  return {
    actual,
    desired: { fetchCalls: 1, providerCalls: 1, returnedFacade: true, terminal: 1, finished: true },
    desiredPass: fetchCalls === 1 && providerCalls === 1 && returned === facade
      && JSON.stringify(successFamily(ledger)) === JSON.stringify(['finish', 'done', 'complete']) && ledger.errors.length === 0
      && eventStatus(success) === 200 && eventFinalUrl(success) === url && facade.isFinished(),
    currentSignature: fetchCalls === 1 && providerCalls === 0 && returned !== facade && terminalCount(ledger) === 0 && !facade.isFinished(),
  };
});

logicalRow('RF-04', 'auto-created facades replay early lifecycle events after executeRequest returns', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    const suffix = `rf04-${mode}`;
    const request: Record<string, unknown> = { url: `${URL_BASE}/${suffix}`, method: mode === 'upload' ? 'POST' : 'GET', retry: false, cache: false };
    const reactNative: Record<string, unknown> = {};
    const provider = async () => validNativeResult(mode, suffix, {
      headers: { 'content-type': 'text/plain', 'x-rf04': mode, 'set-cookie': `rf04-${mode}=1; Path=/` },
      contentType: 'text/plain',
    });
    if (mode === 'stream') {
      request.responseType = 'stream';
      reactNative.streamTransport = { name: suffix, stream: provider };
    } else if (mode === 'download') {
      request.saveTo = `/tmp/${suffix}.bin`;
      request._isDownload = true;
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { fileDownload: true }, downloadFile: provider };
    } else {
      request._isUpload = true;
      request.body = { uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, size: 2 };
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { uploadFromFile: true }, uploadFile: provider };
    }
    const returned = await executeRequest(request as never, { reactNative } as never, new RezoCookieJar()) as unknown as FacadeLike;
    await delay(15);
    const replay: unknown[] = [];
    returned.on('initiated', () => replay.push({ event: 'initiated' }));
    returned.on('start', (event: any) => replay.push({ event: 'start', url: event?.url ?? null, method: event?.method ?? null }));
    returned.on('headers', (event: any) => replay.push({ event: 'headers', status: event?.status ?? null,
      contentType: event?.contentType ?? null, marker: event?.headers?.get?.('x-rf04') ?? null }));
    returned.on('status', (status: unknown, statusText: unknown) => replay.push({ event: 'status', status, statusText }));
    returned.on('cookies', (cookies: any[]) => replay.push({ event: 'cookies', names: cookies.map((cookie) => cookie.key).sort() }));
    actual.push({ mode, replay, finished: returned.isFinished() });
  }
  const expectedReplay = (mode: NativeMode) => [
    { event: 'initiated' },
    { event: 'start', url: `${URL_BASE}/rf04-${mode}`, method: mode === 'upload' ? 'POST' : 'GET' },
    { event: 'headers', status: 200, contentType: 'text/plain', marker: mode },
    { event: 'status', status: 200, statusText: 'OK' },
    { event: 'cookies', names: [`rf04-${mode}`] },
  ];
  const desiredPass = actual.every((entry) => JSON.stringify(entry.replay) === JSON.stringify(expectedReplay(entry.mode as NativeMode)) && entry.finished === true);
  return {
    actual,
    desired: 'each auto facade replays initiated,start,headers,status,cookies once in order',
    desiredPass,
    currentSignature: JSON.stringify(actual[0]?.replay) === JSON.stringify(expectedReplay('stream'))
      && (actual[1]?.replay as unknown[]).length === 0 && (actual[2]?.replay as unknown[]).length === 0,
  };
});

logicalRow('RF-05', 'native stream chunks traverse the facade write and pipe path once', async () => {
  const destination = {
    chunks: [] as unknown[], ends: 0, destroys: 0,
    write(chunk: unknown) { this.chunks.push(normalizeChunk(chunk)); },
    end() { this.ends += 1; },
    destroy() { this.destroys += 1; },
  };
  const facade = createFacade('stream', 'rf05');
  const ledger = observeFacade(facade);
  facade.pipe?.(destination as never);
  const returned = await executeRequest({
    url: `${URL_BASE}/rf05`, method: 'GET', responseType: 'stream', retry: false, cache: false, _streamResponse: facade,
  } as never, {
    reactNative: { streamTransport: { name: 'rf05', async stream(request: any) {
      await request.onChunk(new Uint8Array([1, 2]));
      await request.onChunk('é');
      return validNativeResult('stream', 'rf05');
    } } },
  } as never, new RezoCookieJar());
  if (returned !== facade) throw new InfrastructureError('RF-05 facade identity moved');
  await waitForTerminal(ledger, 'RF-05');
  const actual = { data: ledger.chunks, pipe: destination.chunks, ends: destination.ends, destroys: destination.destroys };
  const exact = JSON.stringify([[1, 2], 'é']);
  return {
    actual,
    desired: { data: [[1, 2], 'é'], pipe: [[1, 2], 'é'] },
    desiredPass: JSON.stringify(ledger.chunks) === exact && JSON.stringify(destination.chunks) === exact,
    currentSignature: JSON.stringify(ledger.chunks) === exact && destination.chunks.length === 0,
  };
});

logicalRow('RF-06', 'stream pipe success ends once with end-close while failure destroys once', async () => {
  const successDestination = {
    ends: 0, destroys: 0, write() {}, end() { this.ends += 1; }, destroy() { this.destroys += 1; },
  };
  const successEntered = createDeferred<void>();
  const successRelease = createDeferred<void>();
  const success = await launchNative('stream', 'rf06-success', async () => {
    successEntered.resolve(undefined);
    await successRelease.promise;
    return validNativeResult('stream', 'rf06-success');
  });
  await successEntered.promise;
  success.facade.pipe?.(successDestination as never);
  successRelease.resolve(undefined);
  await waitForTerminal(success.ledger, 'RF-06 success');
  const failureDestination = {
    ends: 0, destroys: 0, write() {}, end() { this.ends += 1; }, destroy() { this.destroys += 1; },
  };
  const failureEntered = createDeferred<void>();
  const failureRelease = createDeferred<void>();
  const failure = await launchNative('stream', 'rf06-failure', async () => {
    failureEntered.resolve(undefined);
    await failureRelease.promise;
    throw new Error('rf06 failure');
  });
  await failureEntered.promise;
  failure.facade.pipe?.(failureDestination as never);
  failureRelease.resolve(undefined);
  await waitForTerminal(failure.ledger, 'RF-06 failure');
  const successEvents = success.ledger.events.filter((event) => event === 'end' || event === 'close');
  const actual = {
    success: { ends: successDestination.ends, destroys: successDestination.destroys, events: successEvents },
    failure: { ends: failureDestination.ends, destroys: failureDestination.destroys, events: failure.ledger.events },
  };
  return {
    actual,
    desired: { success: { ends: 1, events: ['end', 'close'] }, failure: { ends: 0, destroys: 1 } },
    desiredPass: successDestination.ends === 1 && successDestination.destroys === 0
      && JSON.stringify(successEvents) === JSON.stringify(['end', 'close']) && success.ledger.errors.length === 0
      && failureDestination.ends === 0 && failureDestination.destroys === 1 && failure.ledger.errors.length === 1
      && failure.ledger.events.filter((event) => event === 'close').length === 0,
    currentSignature: successDestination.ends === 2 && JSON.stringify(successEvents) === JSON.stringify(['end'])
      && failureDestination.ends === 0 && failureDestination.destroys === 1,
  };
});

logicalRow('RF-07', 'native success facades expose one success trio and finished state', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    const execution = await launchNative(mode, `rf07-${mode}`, async () => validNativeResult(mode, `rf07-${mode}`));
    await waitForTerminal(execution.ledger, `RF-07 ${mode}`);
    const snapshot = execution.ledger.snapshot();
    actual.push({
      mode,
      successFamily: snapshot.events.filter((event) => ['finish', 'done', 'complete'].includes(event)),
      errors: snapshot.errorCodes,
      finished: snapshot.finished,
    });
  }
  const desiredPass = actual.every((entry) => JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && (entry.errors as unknown[]).length === 0 && entry.finished === true);
  return { actual, desired: 'one finish-done-complete, no error, finished', desiredPass, currentSignature: desiredPass };
});

logicalRow('RF-08', 'facade failures publish one transformed structured error and no success terminal', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    let hooks = 0;
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const execution = await launchNative(mode, `rf08-${mode}`, async () => {
      entered.resolve(undefined);
      await release.promise;
      throw new Error(`${mode} failure`);
    }, {
      hooks: { beforeError: [async (error: any) => { hooks += 1; error.phase5Transformed = true; return error; }] },
    });
    await entered.promise;
    const destination = { ends: 0, destroys: 0, write() {}, end() { this.ends += 1; }, destroy() { this.destroys += 1; } };
    if (mode === 'stream') execution.facade.pipe?.(destination as never);
    release.resolve(undefined);
    await waitForTerminal(execution.ledger, `RF-08 ${mode}`);
    const error = execution.ledger.errors[0] as any;
    actual.push({ mode, hooks, code: errorCode(error), message: errorMessage(error), cause: errorCauseMessage(error),
      transformed: error?.phase5Transformed === true, errors: execution.ledger.errors.length,
      successes: execution.ledger.successes.length, end: execution.ledger.events.filter((event) => event === 'end').length,
      close: execution.ledger.events.filter((event) => event === 'close').length, finished: execution.facade.isFinished(), destroys: destination.destroys });
  }
  let bufferedHooks = 0;
  installFetch(async () => fakeResponse({ status: 500, body: 'failure', headers: { 'content-type': 'text/plain' } }));
  const bufferedFacade = createFacade('upload', 'rf08-buffered');
  const bufferedLedger = observeFacade(bufferedFacade);
  const returned = await executeRequest({
    url: `${URL_BASE}/rf08-buffered`, method: 'POST', body: 'payload', _isUpload: true, _uploadResponse: bufferedFacade,
    retry: false, cache: false,
    hooks: { beforeError: [async (error: any) => { bufferedHooks += 1; error.phase5Transformed = true; return error; }] },
  } as never, {} as never, new RezoCookieJar());
  if (returned !== bufferedFacade) throw new InfrastructureError('RF-08 buffered facade identity moved');
  await waitForTerminal(bufferedLedger, 'RF-08 buffered');
  const bufferedError = bufferedLedger.errors[0] as any;
  actual.push({ mode: 'buffered-upload', hooks: bufferedHooks, code: errorCode(bufferedError), message: errorMessage(bufferedError),
    cause: errorCauseMessage(bufferedError), transformed: bufferedError?.phase5Transformed === true,
    errors: bufferedLedger.errors.length, successes: bufferedLedger.successes.length,
    end: bufferedLedger.events.filter((event) => event === 'end').length,
    close: bufferedLedger.events.filter((event) => event === 'close').length, finished: bufferedFacade.isFinished(), destroys: 0 });
  const expectedErrors = [
    { mode: 'stream', code: 'REZ_UNKNOWN_ERROR', message: 'stream failure', cause: 'stream failure' },
    { mode: 'download', code: 'REZ_UNKNOWN_ERROR', message: 'download failure', cause: 'download failure' },
    { mode: 'upload', code: 'REZ_UNKNOWN_ERROR', message: 'upload failure', cause: 'upload failure' },
    { mode: 'buffered-upload', code: 'REZ_HTTP_ERROR', message: 'Request failed with status code 500', cause: null },
  ];
  const exactError = (entry: Record<string, unknown>, index: number) => entry.mode === expectedErrors[index]?.mode
    && entry.code === expectedErrors[index]?.code && entry.message === expectedErrors[index]?.message
    && entry.cause === expectedErrors[index]?.cause;
  const desiredPass = actual.every((entry, index) => exactError(entry, index) && entry.hooks === 1 && entry.transformed === true
    && entry.errors === 1 && entry.successes === 0 && entry.end === 0 && entry.close === 0 && entry.finished === false)
    && actual[0]?.destroys === 1;
  return {
    actual,
    desired: 'one transformed structured error per mode; no success/end/close; unfinished; stream pipe destroyed once',
    desiredPass,
    currentSignature: actual.every((entry, index) => exactError(entry, index) && entry.hooks === 0 && entry.transformed === false
      && entry.errors === 1 && entry.successes === 0 && entry.end === 0 && entry.close === 0 && entry.finished === false)
      && actual[0]?.destroys === 1,
  };
});

// --------------------------------------------------------------- RB rows --

function terminalData(ledger: FacadeLedger): unknown {
  const terminal = ledger.successes.at(-1);
  if (typeof terminal !== 'object' || terminal === null) return undefined;
  const response = Reflect.get(terminal, 'response');
  if (typeof response === 'object' && response !== null) return Reflect.get(response, 'data');
  return Reflect.get(terminal, 'data');
}

function errorResponseData(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = Reflect.get(error, 'response');
  return typeof response === 'object' && response !== null ? Reflect.get(response, 'data') : undefined;
}

logicalRow('RB-01', 'async afterParse is awaited by buffered Fetch and native upload', async () => {
  let bufferedHooks = 0;
  installFetch(async () => fakeResponse({
    body: '{"alpha":1}', headers: { 'content-type': 'application/json' }, url: `${URL_BASE}/rb01-fetch`,
  }));
  const buffered = await executeRequest({
    url: `${URL_BASE}/rb01-fetch`, method: 'GET', retry: false, cache: false,
    hooks: { afterParse: [async (event: any) => { bufferedHooks += 1; await delay(3); return { ...event.data, buffered: true }; }] },
  } as never, {} as never, new RezoCookieJar()) as any;
  let uploadHooks = 0;
  const upload = await launchNative('upload', 'rb01-upload', async () => validNativeResult('upload', 'rb01-upload', {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/json' },
    contentType: 'application/json',
    body: '{"alpha":1}',
  }), {
    responseType: 'json',
    hooks: { afterParse: [async (event: any) => { uploadHooks += 1; await delay(3); return { ...event.data, upload: true }; }] },
  });
  await waitForTerminal(upload.ledger, 'RB-01 upload');
  const uploadData = terminalData(upload.ledger);
  const actual = {
    bufferedHooks,
    bufferedData: buffered.data,
    bufferedPromise: buffered.data instanceof Promise,
    uploadHooks,
    uploadData,
    uploadPromise: uploadData instanceof Promise,
  };
  const desiredPass = bufferedHooks === 1 && uploadHooks === 1
    && JSON.stringify(buffered.data) === JSON.stringify({ alpha: 1, buffered: true })
    && JSON.stringify(uploadData) === JSON.stringify({ alpha: 1, upload: true })
    && !(buffered.data instanceof Promise) && !(uploadData instanceof Promise);
  return { actual, desired: 'both transformed values are awaited concrete data', desiredPass, currentSignature: true };
});

logicalRow('RB-02', 'RN-local json shorthand sends exact JSON with content type', async () => {
  let fetchCalls = 0;
  let capturedBody: unknown;
  let capturedType: string | null = null;
  installFetch(async (_url, init) => {
    fetchCalls += 1;
    capturedBody = init.body;
    capturedType = new Headers(init.headers).get('content-type');
    return fakeResponse({ body: 'ok' });
  });
  const response = await executeRequest({
    url: `${URL_BASE}/rb02`, method: 'POST', json: { alpha: 1 }, retry: false, cache: false,
  } as never, {} as never, new RezoCookieJar()) as any;
  const actual = { fetchCalls, body: capturedBody ?? null, contentType: capturedType, requestSize: response.config.transfer.requestSize ?? null };
  return {
    actual,
    desired: { body: '{"alpha":1}', contentType: 'application/json', requestSize: 11 },
    desiredPass: fetchCalls === 1 && capturedBody === '{"alpha":1}' && capturedType === 'application/json' && response.config.transfer.requestSize === 11,
    currentSignature: fetchCalls === 1 && capturedBody === undefined && capturedType === null && response.config.transfer.requestSize === undefined,
  };
});

logicalRow('RB-03', 'falsy explicit bodies reach Fetch unchanged with exact sizes', async () => {
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, body, size] of [['zero', 0, 1], ['false', false, 5], ['empty', '', 0]] as const) {
    let captured: unknown = Symbol('absent');
    let fetchCalls = 0;
    installFetch(async (_url, init) => { fetchCalls += 1; captured = init.body; return fakeResponse({ body: 'ok' }); });
    const response = await executeRequest({
      url: `${URL_BASE}/rb03-${label}`, method: 'POST', body, retry: false, cache: false,
    } as never, {} as never, new RezoCookieJar()) as any;
    actual.push({ label, fetchCalls, bodyPresent: captured !== undefined && typeof captured !== 'symbol',
      captured: typeof captured === 'symbol' || captured === undefined ? null : captured,
      expectedBody: body, size: response.config.transfer.requestSize ?? null, expectedSize: size });
  }
  const desiredPass = actual.every((entry) => entry.fetchCalls === 1 && entry.bodyPresent === true
    && Object.is(entry.captured, entry.expectedBody) && entry.size === entry.expectedSize);
  return {
    actual,
    desired: '0/false/empty preserved with UTF-8 sizes 1/5/0',
    desiredPass,
    currentSignature: actual.every((entry) => entry.fetchCalls === 1 && entry.bodyPresent === false && entry.captured === null && entry.size === null),
  };
});

logicalRow('RB-04', 'binary and view request bodies preserve identity and exact view ranges', async () => {
  const backing = new Uint8Array([99, 1, 2, 3, 88]);
  const arrayBuffer = new Uint8Array([4, 5, 6]).buffer;
  const uint8 = new Uint8Array(backing.buffer, 1, 3);
  const dataView = new DataView(backing.buffer, 2, 2);
  const carriers = [
    ['blob', new Blob([new Uint8Array([7, 8])])],
    ['arrayBuffer', arrayBuffer],
    ['uint8Subview', uint8],
    ['dataViewSubview', dataView],
  ] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, body] of carriers) {
    let captured: unknown;
    let fetchCalls = 0;
    installFetch(async (_url, init) => { fetchCalls += 1; captured = init.body; return fakeResponse({ body: 'ok' }); });
    await executeRequest({ url: `${URL_BASE}/rb04-${label}`, method: 'POST', body, retry: false, cache: false } as never, {} as never, new RezoCookieJar());
    const kind = captured instanceof Blob ? 'Blob'
      : captured instanceof ArrayBuffer ? 'ArrayBuffer'
        : captured instanceof Uint8Array ? 'Uint8Array'
          : captured instanceof DataView ? 'DataView'
            : typeof captured;
    actual.push({ label, fetchCalls, kind, value: typeof captured === 'string' ? captured : null,
      sameIdentity: captured === body, bytes: bytesOf(captured) });
  }
  const desiredPass = actual.every((entry) => entry.fetchCalls === 1 && entry.sameIdentity === true)
    && JSON.stringify(actual[2]?.bytes) === JSON.stringify([1, 2, 3])
    && JSON.stringify(actual[3]?.bytes) === JSON.stringify([2, 3]);
  return {
    actual,
    desired: 'all identities and subview ranges preserved',
    desiredPass,
    currentSignature: actual.every((entry) => entry.fetchCalls === 1)
      && actual[0]?.kind === 'string' && actual[0]?.value === '{}' && actual[0]?.sameIdentity === false
      && actual[1]?.kind === 'ArrayBuffer' && actual[1]?.sameIdentity === true
      && actual[2]?.kind === 'Uint8Array' && actual[2]?.sameIdentity === true
      && actual[3]?.kind === 'string' && actual[3]?.value === '{}' && actual[3]?.sameIdentity === false,
  };
});

async function malformedJsonVariant(kind: 'explicit' | 'inferred'): Promise<Record<string, unknown>> {
  const contentType = kind === 'inferred' ? 'application/json' : 'text/plain';
  installFetch(async () => fakeResponse({ body: '{bad', headers: { 'content-type': contentType } }));
  const buffered = await settle(executeRequest({
    url: `${URL_BASE}/rb-json-${kind}-fetch`, method: 'GET', responseType: kind === 'explicit' ? 'json' : 'auto', retry: false, cache: false,
  } as never, {} as never, new RezoCookieJar()));
  const upload = await launchNative('upload', `rb-json-${kind}-upload`, async () => validNativeResult('upload', `rb-json-${kind}-upload`, {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': contentType },
    contentType,
    body: '{bad',
  }), { responseType: kind === 'explicit' ? 'json' : 'auto' });
  await waitForTerminal(upload.ledger, `RB JSON ${kind} upload`);
  const uploadError = upload.ledger.errors[0];
  return {
    bufferedOutcome: buffered.outcome,
    bufferedCode: errorCode(buffered.value),
    bufferedRaw: buffered.outcome === 'rejected' ? errorResponseData(buffered.value) : (buffered.value as any)?.data,
    uploadErrors: upload.ledger.errors.length,
    uploadSuccesses: upload.ledger.successes.length,
    uploadCode: errorCode(uploadError),
    uploadRaw: uploadError ? errorResponseData(uploadError) : terminalData(upload.ledger),
  };
}

logicalRow('RB-05', 'explicit malformed JSON rejects once with raw response retained', async () => {
  const actual = await malformedJsonVariant('explicit');
  const desiredPass = actual.bufferedOutcome === 'rejected' && actual.bufferedCode === 'REZ_INVALID_JSON' && actual.bufferedRaw === '{bad'
    && actual.uploadErrors === 1 && actual.uploadSuccesses === 0 && actual.uploadCode === 'REZ_INVALID_JSON' && actual.uploadRaw === '{bad';
  return {
    actual,
    desired: 'buffered/native upload each reject REZ_INVALID_JSON with raw {bad',
    desiredPass,
    currentSignature: actual.bufferedOutcome === 'fulfilled' && actual.bufferedRaw === '{bad'
      && actual.uploadErrors === 0 && actual.uploadSuccesses === 3 && actual.uploadRaw === '{bad',
  };
});

logicalRow('RB-06', 'inferred malformed JSON follows the strict structured parse contract', async () => {
  const actual = await malformedJsonVariant('inferred');
  const desiredPass = actual.bufferedOutcome === 'rejected' && actual.bufferedCode === 'REZ_INVALID_JSON' && actual.bufferedRaw === '{bad'
    && actual.uploadErrors === 1 && actual.uploadSuccesses === 0 && actual.uploadCode === 'REZ_INVALID_JSON' && actual.uploadRaw === '{bad';
  return {
    actual,
    desired: 'buffered/native upload each reject inferred malformed JSON once',
    desiredPass,
    currentSignature: actual.bufferedOutcome === 'fulfilled' && actual.bufferedRaw === '{bad'
      && actual.uploadErrors === 0 && actual.uploadSuccesses === 3 && actual.uploadRaw === '{bad',
  };
});

logicalRow('RB-07', 'explicit binary response modes preserve exact bytes', async () => {
  installFetch(async () => fakeResponse({ bytes: new Uint8Array([0, 255, 1]), body: '\u0000\ufffd\u0001', headers: { 'content-type': 'application/octet-stream' } }));
  const buffered = await executeRequest({
    url: `${URL_BASE}/rb07-fetch`, method: 'GET', responseType: 'arrayBuffer', retry: false, cache: false,
  } as never, {} as never, new RezoCookieJar()) as any;
  const backing = new Uint8Array([77, 3, 4, 5, 66]);
  const subview = new Uint8Array(backing.buffer, 1, 3);
  const upload = await launchNative('upload', 'rb07-upload', async () => validNativeResult('upload', 'rb07-upload', {
    headers: { 'content-type': 'application/octet-stream' }, contentType: 'application/octet-stream', body: subview,
  }), { responseType: 'buffer' });
  await waitForTerminal(upload.ledger, 'RB-07 upload');
  const actual = { fetch: bytesOf(buffered.data), upload: bytesOf(terminalData(upload.ledger)) };
  const desiredPass = JSON.stringify(actual.fetch) === JSON.stringify([0, 255, 1]) && JSON.stringify(actual.upload) === JSON.stringify([3, 4, 5]);
  return { actual, desired: { fetch: [0, 255, 1], upload: [3, 4, 5] }, desiredPass, currentSignature: desiredPass };
});

logicalRow('RB-08', 'native non-Uint8 response views preserve only their byte ranges', async () => {
  const variants = [
    ['dataView', new Uint8Array([99, 1, 2, 3, 88]), (bytes: Uint8Array) => new DataView(bytes.buffer, 1, 3), [1, 2, 3]],
    ['uint16', new Uint8Array([99, 88, 1, 2, 3, 4, 77, 66]), (bytes: Uint8Array) => new Uint16Array(bytes.buffer, 2, 2), [1, 2, 3, 4]],
  ] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, backing, makeView, expected] of variants) {
    const view = makeView(backing);
    const currentBytes = [...new TextEncoder().encode(JSON.stringify(view))];
    const upload = await launchNative('upload', `rb08-${label}`, async () => validNativeResult('upload', `rb08-${label}`, {
      headers: { 'content-type': 'application/octet-stream' }, contentType: 'application/octet-stream', body: makeView(backing),
    }), { responseType: 'arrayBuffer' });
    await waitForTerminal(upload.ledger, `RB-08 ${label}`);
    actual.push({ label, bytes: bytesOf(terminalData(upload.ledger)), expected, currentBytes });
  }
  const desiredPass = actual.every((entry) => JSON.stringify(entry.bytes) === JSON.stringify(entry.expected));
  return {
    actual,
    desired: 'DataView/Uint16Array exact view bytes without sentinels',
    desiredPass,
    currentSignature: actual.every((entry) => JSON.stringify(entry.bytes) === JSON.stringify(entry.currentBytes)),
  };
});

logicalRow('RB-09', 'auto octet-stream preserves invalid UTF-8 bytes', async () => {
  const raw = new Uint8Array([0, 255, 1]);
  installFetch(async () => fakeResponse({
    bytes: raw,
    body: new TextDecoder().decode(raw),
    headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
  }));
  const response = await executeRequest({
    url: `${URL_BASE}/rb09`, method: 'GET', responseType: 'auto', retry: false, cache: false,
  } as never, {} as never, new RezoCookieJar()) as any;
  const actual = { type: response.data?.constructor?.name ?? typeof response.data, bytes: bytesOf(response.data), text: typeof response.data === 'string' ? response.data : null };
  return {
    actual,
    desired: { bytes: [0, 255, 1] },
    desiredPass: JSON.stringify(bytesOf(response.data)) === JSON.stringify([0, 255, 1]),
    currentSignature: typeof response.data === 'string' && response.data.includes('\ufffd'),
  };
});

logicalRow('RB-10', 'HEAD and 204 are bodyless null responses without parsing', async () => {
  const buffered: Array<Record<string, unknown>> = [];
  for (const method of ['HEAD', 'GET'] as const) {
    for (const responseType of ['auto', 'json'] as const) {
      let fetchCalls = 0;
      const parseCalls = { text: 0, json: 0, arrayBuffer: 0, blob: 0 };
      const transformInputs: unknown[] = [];
      const afterParseInputs: unknown[] = [];
      const afterParseRawInputs: unknown[] = [];
      installFetch(async () => {
        fetchCalls += 1;
        return fakeResponse({
          status: method === 'HEAD' ? 200 : 204,
          body: '{malformed-bodyless-json',
          headers: { 'content-type': responseType === 'json' ? 'application/json' : 'text/plain', 'content-length': '0' },
          onText: () => { parseCalls.text += 1; },
          onJson: () => { parseCalls.json += 1; },
          onArrayBuffer: () => { parseCalls.arrayBuffer += 1; },
          onBlob: () => { parseCalls.blob += 1; },
        });
      });
      const result = await settle(executeRequest({
        url: `${URL_BASE}/rb10-${method}-${responseType}`, method, responseType, retry: false, cache: false,
        transformResponse: [(data: unknown) => { transformInputs.push(data); return data; }],
        hooks: { afterParse: [async (event: any) => {
          afterParseInputs.push(event.data);
          afterParseRawInputs.push(event.rawData);
          return event.data;
        }] },
      } as never, {} as never, new RezoCookieJar()));
      buffered.push({ method, responseType, outcome: result.outcome, data: result.outcome === 'fulfilled' ? (result.value as any).data : null,
        status: result.outcome === 'fulfilled' ? (result.value as any).status : null,
        size: result.outcome === 'fulfilled' ? (result.value as any).contentLength : null, fetchCalls, parseCalls,
        transformInputs, afterParseInputs, afterParseRawInputs });
    }
  }

  async function runNative(
    label: string,
    status: 200 | 204,
    responseType: 'auto' | 'json',
    body: string,
  ): Promise<Record<string, unknown>> {
    let providerCalls = 0;
    let afterHeaders = 0;
    const transformInputs: unknown[] = [];
    const afterParseInputs: unknown[] = [];
    const afterParseRawInputs: unknown[] = [];
    const upload = await launchNative('upload', label, async () => {
      providerCalls += 1;
      return validNativeResult('upload', label, {
        status,
        statusText: status === 204 ? 'No Content' : 'OK',
        headers: { 'content-type': 'application/json', 'content-length': status === 204 ? '0' : String(body.length) },
        contentType: 'application/json',
        contentLength: status === 204 ? 0 : body.length,
        body,
      });
    }, {
      responseType,
      transformResponse: [(data: unknown) => { transformInputs.push(data); return data; }],
      hooks: {
        afterHeaders: [async () => { afterHeaders += 1; }],
        afterParse: [async (event: any) => {
          afterParseInputs.push(event.data);
          afterParseRawInputs.push(event.rawData);
          return event.data;
        }],
      },
    });
    await waitForTerminal(upload.ledger, `RB-10 ${label}`);
    const uploadTerminal = upload.ledger.successes.at(-1) as any;
    const uploadError = upload.ledger.errors[0];
    return {
      label, status, responseType, providerCalls, afterHeaders, transformInputs, afterParseInputs, afterParseRawInputs,
      errors: upload.ledger.errors.length, errorName: uploadError instanceof Error ? uploadError.name : null,
      errorCode: errorCode(uploadError), errorMessage: errorMessage(uploadError), successFamily: successFamily(upload.ledger),
      observedStatus: eventStatus(uploadTerminal), data: terminalData(upload.ledger),
      size: uploadTerminal?.response?.contentLength ?? null,
      finished: upload.facade.isFinished(),
    };
  }

  const nativeBodyless = [
    await runNative('rb10-upload-204-auto', 204, 'auto', '{malformed-auto-json'),
    await runNative('rb10-upload-204-json', 204, 'json', '{malformed-explicit-json'),
  ];
  const nativePositive = await runNative('rb10-upload-200-json', 200, 'json', '{"ok":true}');
  const bufferedPass = buffered.every((entry) => entry.outcome === 'fulfilled'
    && entry.status === (entry.method === 'HEAD' ? 200 : 204) && entry.data === null && entry.size === 0
    && entry.fetchCalls === 1 && Object.values(entry.parseCalls as Record<string, number>).every((count) => count === 0)
    && JSON.stringify(entry.transformInputs) === JSON.stringify([null])
    && JSON.stringify(entry.afterParseInputs) === JSON.stringify([null])
    && JSON.stringify(entry.afterParseRawInputs) === JSON.stringify([null]));
  const nativeBodylessPass = nativeBodyless.every((entry) => entry.providerCalls === 1 && entry.afterHeaders === 1
    && entry.errors === 0 && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && JSON.stringify(entry.transformInputs) === JSON.stringify([null])
    && JSON.stringify(entry.afterParseInputs) === JSON.stringify([null])
    && JSON.stringify(entry.afterParseRawInputs) === JSON.stringify([null])
    && entry.observedStatus === 204 && entry.data === null && entry.size === 0 && entry.finished === true);
  const nativePositivePass = nativePositive.providerCalls === 1 && nativePositive.afterHeaders === 1
    && nativePositive.errors === 0 && JSON.stringify(nativePositive.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && JSON.stringify(nativePositive.transformInputs) === JSON.stringify([{ ok: true }])
    && JSON.stringify(nativePositive.afterParseInputs) === JSON.stringify([{ ok: true }])
    && JSON.stringify(nativePositive.afterParseRawInputs) === JSON.stringify(['{"ok":true}'])
    && nativePositive.observedStatus === 200 && JSON.stringify(nativePositive.data) === JSON.stringify({ ok: true }) && nativePositive.size === 11
    && nativePositive.finished === true;
  return {
    actual: { buffered, nativeBodyless, nativePositive },
    desired: 'four Fetch and two native 204 variants skip body readers/parsing, then transform null exactly once to null/size0; native 200 JSON remains a parsing control',
    desiredPass: bufferedPass && nativeBodylessPass && nativePositivePass,
    currentSignature: bufferedPass && nativePositivePass && nativeBodyless.every((entry) => entry.providerCalls === 1
      && entry.afterHeaders === 1 && entry.errors === 1 && entry.errorName === 'RezoError'
      && entry.errorCode === 'REZ_INVALID_JSON' && entry.errorMessage === 'Failed to parse JSON response'
      && JSON.stringify(entry.transformInputs) === '[]' && JSON.stringify(entry.afterParseInputs) === '[]'
      && JSON.stringify(entry.afterParseRawInputs) === '[]' && (entry.successFamily as unknown[]).length === 0
      && entry.observedStatus === null && entry.data === undefined && entry.size === null && entry.finished === false),
  };
});

// --------------------------------------------------------------- RO rows --

function sortedCookieTokens(value: string | null): string[] {
  return (value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean).sort();
}

logicalRow('RO-01', 'base URL and request paramsSerializer produce one exact URL without caller mutation', async () => {
  let capturedUrl = '';
  let fetchCalls = 0;
  installFetch(async (url) => { fetchCalls += 1; capturedUrl = url; return fakeResponse({ url }); });
  const request = {
    url: 'items',
    method: 'GET',
    params: { alpha: 'caller', ignored: 'value' },
    paramsSerializer: () => 'alpha=serialized%20value&beta=2',
    retry: false,
    cache: false,
  };
  const openingUrl = request.url;
  await executeRequest(request as never, { baseURL: `${URL_BASE}/api/` } as never, new RezoCookieJar());
  const expected = `${URL_BASE}/api/items?alpha=serialized+value&beta=2`;
  const actual = { fetchCalls, capturedUrl, callerUrl: request.url };
  const desiredPass = fetchCalls === 1 && capturedUrl === expected && request.url === openingUrl;
  return { actual, desired: { fetchCalls: 1, capturedUrl: expected, callerUrl: 'items' }, desiredPass, currentSignature: desiredPass };
});

logicalRow('RO-02', 'TRACE remains TRACE and CONNECT is unchanged or refused before dispatch', async () => {
  const connectRefusalMessage = 'React Native adapter does not support CONNECT requests.';
  const actual: Array<Record<string, unknown>> = [];
  for (const method of ['TRACE', 'CONNECT'] as const) {
    let calls = 0;
    let wireMethod: string | null = null;
    installFetch(async (_url, init) => { calls += 1; wireMethod = String(init.method); return fakeResponse({ body: 'ok' }); });
    const result = await settle(executeRequest({
      url: `${URL_BASE}/ro02-${method}`, method, retry: false, cache: false,
    } as never, {} as never, new RezoCookieJar()));
    actual.push({ method, calls, wireMethod, outcome: result.outcome, code: errorCode(result.value),
      name: result.value instanceof Error ? result.value.name : null, message: errorMessage(result.value) });
  }
  const trace = actual[0];
  const connect = actual[1];
  const tracePass = trace?.method === 'TRACE' && trace.calls === 1 && trace.wireMethod === 'TRACE' && trace.outcome === 'fulfilled';
  const connectPass = connect?.method === 'CONNECT' && ((connect.calls === 1 && connect.wireMethod === 'CONNECT' && connect.outcome === 'fulfilled')
    || (connect.calls === 0 && connect.wireMethod === null && connect.outcome === 'rejected'
      && connect.name === 'RezoError' && connect.code === 'REZ_UNSUPPORTED_CAPABILITY' && connect.message === connectRefusalMessage));
  const desiredPass = tracePass && connectPass;
  return {
    actual,
    desired: { trace: 'one unchanged successful dispatch', connect: `one unchanged successful dispatch or RezoError: ${connectRefusalMessage}` },
    desiredPass,
    currentSignature: trace?.calls === 1 && trace.wireMethod === 'TRACE' && trace.outcome === 'fulfilled'
      && connect?.calls === 1 && connect.wireMethod === 'GET' && connect.outcome === 'fulfilled',
  };
});

logicalRow('RO-03', 'authorization precedence and proxy-header exclusion remain exact', async () => {
  const actual: Array<Record<string, unknown>> = [];
  const variants = [
    {
      label: 'explicit',
      url: 'https://url-user:url-pass@phase5.react-native.rezo.test/ro03-explicit',
      extras: { auth: { username: 'structured', password: 'secret' }, headers: { authorization: 'Bearer explicit', 'proxy-authorization': 'Basic proxy' } },
      expected: 'Bearer explicit',
    },
    {
      label: 'userinfo',
      url: 'https://user:pass@phase5.react-native.rezo.test/ro03-userinfo',
      extras: {},
      expected: 'Basic dXNlcjpwYXNz',
    },
  ] as const;
  for (const variant of variants) {
    installFetch(async (url, init) => {
      const headers = new Headers(init.headers);
      actual.push({ label: variant.label, url, authorization: headers.get('authorization'), proxyAuthorization: headers.get('proxy-authorization') });
      return fakeResponse({ url });
    });
    await executeRequest({ url: variant.url, method: 'GET', retry: false, cache: false, ...variant.extras } as never, {} as never, new RezoCookieJar());
  }
  const desiredPass = actual.length === 2 && actual.every((entry, index) => entry.authorization === variants[index]?.expected
    && entry.proxyAuthorization === null && !(entry.url as string).includes('@'));
  return { actual, desired: 'explicit wins; userinfo Basic; normalized URLs; no proxy auth', desiredPass, currentSignature: desiredPass };
});

logicalRow('RO-04', 'injected jar/XSRF state is exact across same- and cross-origin redirects', async () => {
  const sameJar = new RezoCookieJar();
  sameJar.setCookiesSync(['sid=one; Path=/', 'xsrf=token-a; Path=/'], `${URL_BASE}/`);
  const sameHeaders: Array<{ cookie: string[]; xsrf: string | null; auth: string | null }> = [];
  let sameCalls = 0;
  installFetch(async (_url, init) => {
    sameCalls += 1;
    const headers = new Headers(init.headers);
    sameHeaders.push({ cookie: sortedCookieTokens(headers.get('cookie')), xsrf: headers.get('x-xsrf'), auth: headers.get('authorization') });
    if (sameCalls === 1) return fakeResponse({
      status: 302, statusText: 'Found', url: `${URL_BASE}/ro04-same-start`,
      headers: { location: '/ro04-same-final', 'set-cookie': 'hop=same; Path=/' }, body: '',
    });
    return fakeResponse({ url: `${URL_BASE}/ro04-same-final`, body: 'ok' });
  });
  await executeRequest({
    url: `${URL_BASE}/ro04-same-start`, method: 'GET', headers: { authorization: 'Bearer same' },
    xsrfCookieName: 'xsrf', xsrfHeaderName: 'x-xsrf', retry: false, cache: false,
  } as never, {} as never, sameJar);

  const crossJar = new RezoCookieJar();
  crossJar.setCookiesSync(['source=one; Path=/', 'xsrf=source-token; Path=/'], 'https://source.ro04.test/');
  crossJar.setCookiesSync(['destination=two; Path=/', 'xsrf=destination-token; Path=/'], 'https://destination.ro04.test/');
  const crossHeaders: Array<{ cookie: string[]; xsrf: string | null; auth: string | null }> = [];
  let crossCalls = 0;
  installFetch(async (_url, init) => {
    crossCalls += 1;
    const headers = new Headers(init.headers);
    crossHeaders.push({ cookie: sortedCookieTokens(headers.get('cookie')), xsrf: headers.get('x-xsrf'), auth: headers.get('authorization') });
    if (crossCalls === 1) return fakeResponse({
      status: 302, statusText: 'Found', url: 'https://source.ro04.test/start',
      headers: { location: 'https://destination.ro04.test/final', 'set-cookie': 'source-hop=one; Path=/' }, body: '',
    });
    return fakeResponse({ url: 'https://destination.ro04.test/final', body: 'ok' });
  });
  await executeRequest({
    url: 'https://source.ro04.test/start', method: 'GET', headers: { authorization: 'Bearer cross' },
    xsrfCookieName: 'xsrf', xsrfHeaderName: 'x-xsrf', retry: false, cache: false,
  } as never, {} as never, crossJar);
  const sameJarState = sortedCookieTokens(sameJar.getCookieHeader(`${URL_BASE}/ro04-same-final`));
  const crossSourceJarState = sortedCookieTokens(crossJar.getCookieHeader('https://source.ro04.test/after'));
  const crossDestinationJarState = sortedCookieTokens(crossJar.getCookieHeader('https://destination.ro04.test/after'));
  const actual = { sameHeaders, crossHeaders, sameJarState, crossSourceJarState, crossDestinationJarState };
  const desiredPass = JSON.stringify(sameHeaders) === JSON.stringify([
    { cookie: ['sid=one', 'xsrf=token-a'], xsrf: 'token-a', auth: 'Bearer same' },
    { cookie: ['hop=same', 'sid=one', 'xsrf=token-a'], xsrf: 'token-a', auth: 'Bearer same' },
  ]) && JSON.stringify(crossHeaders) === JSON.stringify([
    { cookie: ['source=one', 'xsrf=source-token'], xsrf: 'source-token', auth: 'Bearer cross' },
    { cookie: ['destination=two', 'xsrf=destination-token'], xsrf: 'destination-token', auth: null },
  ]) && JSON.stringify(sameJarState) === JSON.stringify(['hop=same', 'sid=one', 'xsrf=token-a'])
    && JSON.stringify(crossSourceJarState) === JSON.stringify(['source-hop=one', 'source=one', 'xsrf=source-token'])
    && JSON.stringify(crossDestinationJarState) === JSON.stringify(['destination=two', 'xsrf=destination-token']);
  return { actual, desired: 'exact same/cross-origin header projections and isolated final jar states', desiredPass, currentSignature: desiredPass };
});

logicalRow('RO-05', 'visible redirect/status controls execute while hidden provider policy refuses', async () => {
  let visibleCalls = 0;
  installFetch(async (_url) => {
    visibleCalls += 1;
    if (visibleCalls === 1) return fakeResponse({ status: 302, statusText: 'Found', headers: { location: '/ro05-final' }, url: `${URL_BASE}/ro05-start`, body: '' });
    return fakeResponse({ status: 200, url: `${URL_BASE}/ro05-final`, body: 'ok' });
  });
  const redirected = await executeRequest({ url: `${URL_BASE}/ro05-start`, method: 'GET', retry: false, cache: false } as never, {} as never, new RezoCookieJar()) as any;
  installFetch(async () => fakeResponse({ status: 418, statusText: 'Teapot', body: 'tea' }));
  const allowed = await executeRequest({
    url: `${URL_BASE}/ro05-418`, method: 'GET', validateStatus: (status: number) => status === 418, retry: false, cache: false,
  } as never, {} as never, new RezoCookieJar()) as any;
  const hidden: Array<Record<string, unknown>> = [];
  for (const mode of ['download', 'upload'] as const) {
    let providerCalls = 0;
    const request = mode === 'download'
      ? { url: `${URL_BASE}/ro05-hidden-download`, method: 'GET', saveTo: '/tmp/ro05.bin', _isDownload: true, followRedirects: false }
      : { url: `${URL_BASE}/ro05-hidden-upload`, method: 'POST', body: { uri: 'file:///tmp/ro05.bin', name: 'ro05.bin' }, _isUpload: true, followRedirects: false };
    const fileSystemAdapter = mode === 'download'
      ? { name: 'ro05', capabilities: { fileDownload: true }, async downloadFile() { providerCalls += 1; return validNativeResult('download', 'ro05'); } }
      : { name: 'ro05', capabilities: { uploadFromFile: true }, async uploadFile() { providerCalls += 1; return validNativeResult('upload', 'ro05'); } };
    const result = await settle(executeRequest(request as never, { reactNative: { fileSystemAdapter } } as never, new RezoCookieJar()));
    hidden.push({ mode, outcome: result.outcome, code: errorCode(result.value), providerCalls });
  }
  const actual = { visibleCalls, redirected: { status: redirected.status, finalUrl: redirected.finalUrl }, allowedStatus: allowed.status, hidden };
  const desiredPass = visibleCalls === 2 && redirected.status === 200 && redirected.finalUrl === `${URL_BASE}/ro05-final` && allowed.status === 418
    && hidden.every((entry) => entry.outcome === 'rejected' && entry.code === 'REZ_UNSUPPORTED_CAPABILITY' && entry.providerCalls === 0);
  return { actual, desired: 'visible 302->200; allowed 418; hidden typed pre-dispatch refusals', desiredPass, currentSignature: desiredPass };
});

logicalRow('RO-06', 'request transforms are lifetime-owned and facade failures settle structurally once', async () => {
  let fetchCalls = 0;
  let requestTransforms = 0;
  let responseTransforms = 0;
  let capturedBody: unknown;
  let capturedMarker: string | null = null;
  installFetch(async (_url, init) => {
    fetchCalls += 1;
    capturedBody = init.body;
    capturedMarker = new Headers(init.headers).get('x-transform');
    return fakeResponse({ body: 'before-response', headers: { 'content-type': 'text/plain' } });
  });
  const response = await executeRequest({
    url: `${URL_BASE}/ro06`, method: 'POST', body: 'before-request', retry: false, cache: false,
    transformRequest: [(data: unknown, headers: any) => { requestTransforms += 1; headers.set('x-transform', 'yes'); return `${data}-after`; }],
    transformResponse: [(data: unknown) => { responseTransforms += 1; return `${data}-after`; }],
  } as never, {} as never, new RezoCookieJar()) as any;
  const happy = { fetchCalls, requestTransforms, responseTransforms, capturedBody, capturedMarker, responseData: response.data };
  const happyPass = fetchCalls === 1 && requestTransforms === 1 && responseTransforms === 1
    && capturedBody === 'before-request-after' && capturedMarker === 'yes' && response.data === 'before-response-after';

  async function runHangingTransform(variant: 'timeout' | 'signal'): Promise<Record<string, unknown>> {
    const entered = createDeferred<void>();
    const release = createDeferred<unknown>();
    const controller = new AbortController();
    let dispatches = 0;
    let onAbort = 0;
    let onTimeout = 0;
    installFetch(async () => { dispatches += 1; return fakeResponse({ body: 'late-transform-response' }); });
    const tracked: { outcome: 'pending' | 'fulfilled' | 'rejected'; value: unknown } = { outcome: 'pending', value: undefined };
    const pending = executeRequest({
      url: `${URL_BASE}/ro06-hanging-${variant}`, method: 'POST', body: 'before', retry: false, cache: false,
      ...(variant === 'timeout' ? { timeout: { total: 35 } } : { signal: controller.signal }),
      transformRequest: [async () => { entered.resolve(undefined); return release.promise; }],
      hooks: {
        onAbort: [async () => { onAbort += 1; }],
        onTimeout: [async () => { onTimeout += 1; }],
      },
    } as never, {} as never, new RezoCookieJar());
    void pending.then(
      (value) => { tracked.outcome = 'fulfilled'; tracked.value = value; },
      (error) => { tracked.outcome = 'rejected'; tracked.value = error; },
    );
    let atBoundary: Record<string, unknown>;
    let dispatchesAtBoundary: number;
    let hooksAtBoundary: Record<string, number>;
    try {
      await withWatchdog(entered.promise, `RO-06 ${variant} transform entry`);
      if (variant === 'signal') controller.abort();
      await delay(85);
      atBoundary = {
        outcome: tracked.outcome,
        name: tracked.value instanceof Error ? tracked.value.name : null,
        code: errorCode(tracked.value),
        message: tracked.outcome === 'rejected' ? errorMessage(tracked.value) : null,
      };
      dispatchesAtBoundary = dispatches;
      hooksAtBoundary = { onAbort, onTimeout };
    } finally {
      release.resolve('released-after-public-boundary');
    }
    await waitFor(() => tracked.outcome !== 'pending', `RO-06 ${variant} transform did not settle after release`);
    await delay(10);
    const afterRelease = {
      outcome: tracked.outcome,
      name: tracked.value instanceof Error ? tracked.value.name : null,
      code: errorCode(tracked.value),
      message: tracked.outcome === 'rejected' ? errorMessage(tracked.value) : null,
    };
    return { variant, atBoundary, afterRelease, dispatchesAtBoundary, finalDispatches: dispatches,
      hooksAtBoundary, finalHooks: { onAbort, onTimeout } };
  }

  const lifetime = [await runHangingTransform('timeout'), await runHangingTransform('signal')];

  let bufferedBeforeError = 0;
  let bufferedDispatches = 0;
  installFetch(async () => { bufferedDispatches += 1; return fakeResponse({ body: 'must-not-dispatch' }); });
  const bufferedMessage = 'buffered request transform failure';
  const bufferedFailure = await settle(executeRequest({
    url: `${URL_BASE}/ro06-throw-buffered`, method: 'POST', body: 'before', retry: false, cache: false,
    transformRequest: [() => { throw new Error(bufferedMessage); }],
    hooks: { beforeError: [async (error: any) => {
      bufferedBeforeError += 1;
      error.phase5Transformed = true;
      return error;
    }] },
  } as never, {} as never, new RezoCookieJar()));
  const bufferedError = bufferedFailure.value as any;
  const bufferedThrow = {
    outcome: bufferedFailure.outcome, dispatches: bufferedDispatches, beforeError: bufferedBeforeError,
    name: bufferedError instanceof Error ? bufferedError.name : null, code: errorCode(bufferedError),
    message: errorMessage(bufferedError), cause: errorCauseMessage(bufferedError),
    transformed: bufferedError?.phase5Transformed === true,
  };

  async function runFacadeThrow(mode: NativeMode): Promise<Record<string, unknown>> {
    const suffix = `ro06-throw-${mode}`;
    const facade = createFacade(mode, suffix);
    const ledger = observeFacade(facade);
    const message = `${mode} request transform failure`;
    let beforeError = 0;
    let providerCalls = 0;
    let fetchDispatches = 0;
    installFetch(async () => { fetchDispatches += 1; return fakeResponse({ body: 'must-not-dispatch' }); });
    const request: Record<string, unknown> = {
      url: `${URL_BASE}/${suffix}`, method: mode === 'upload' ? 'POST' : 'GET', retry: false, cache: false,
      transformRequest: [() => { throw new Error(message); }],
      hooks: { beforeError: [async (error: any) => {
        beforeError += 1;
        error.phase5Transformed = true;
        return error;
      }] },
    };
    const reactNative: Record<string, unknown> = {};
    if (mode === 'stream') {
      request.responseType = 'stream';
      request._streamResponse = facade;
      reactNative.streamTransport = { name: suffix, async stream() { providerCalls += 1; return validNativeResult(mode, suffix); } };
    } else if (mode === 'download') {
      request.saveTo = `/tmp/${suffix}.bin`;
      request._isDownload = true;
      request._downloadResponse = facade;
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { fileDownload: true },
        async downloadFile() { providerCalls += 1; return validNativeResult(mode, suffix); } };
    } else {
      request.body = { uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, size: 2 };
      request._isUpload = true;
      request._uploadResponse = facade;
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { uploadFromFile: true },
        async uploadFile() { providerCalls += 1; return validNativeResult(mode, suffix); } };
    }
    const execution = await settle(executeRequest(request as never, { reactNative } as never, new RezoCookieJar()));
    if (execution.outcome === 'fulfilled') await waitForTerminal(ledger, `RO-06 ${mode} transform failure`);
    else await delay(10);
    const directError = execution.outcome === 'rejected' ? execution.value : undefined;
    const facadeError = ledger.errors[0] as any;
    return {
      mode, message, execution: execution.outcome, returnedFacade: execution.value === facade,
      directName: directError instanceof Error ? directError.name : null, directCode: errorCode(directError),
      directMessage: directError === undefined ? null : errorMessage(directError), directCause: errorCauseMessage(directError),
      providerCalls, fetchDispatches, beforeError, facadeErrors: ledger.errors.length,
      facadeName: facadeError instanceof Error ? facadeError.name : null, facadeCode: errorCode(facadeError),
      facadeMessage: facadeError === undefined ? null : errorMessage(facadeError), facadeCause: errorCauseMessage(facadeError),
      transformed: facadeError?.phase5Transformed === true, successes: ledger.successes.length,
      end: ledger.events.filter((event) => event === 'end').length,
      close: ledger.events.filter((event) => event === 'close').length, finished: facade.isFinished(),
    };
  }

  function configureAutoNativeLane(
    mode: NativeMode,
    suffix: string,
    request: Record<string, unknown>,
    reactNative: Record<string, unknown>,
    provider: (providerRequest: any) => Promise<Record<string, unknown>>,
  ): void {
    if (mode === 'stream') {
      request.responseType = 'stream';
      reactNative.streamTransport = { name: suffix, stream: provider };
      return;
    }
    if (mode === 'download') {
      request.saveTo = `/tmp/${suffix}.bin`;
      request._isDownload = true;
      reactNative.fileSystemAdapter = {
        name: suffix,
        capabilities: { fileDownload: true },
        downloadFile: provider,
      };
      return;
    }
    request.body = {
      uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, type: 'application/octet-stream', size: 2,
    };
    request._isUpload = true;
    reactNative.fileSystemAdapter = {
      name: suffix,
      capabilities: { uploadFromFile: true },
      uploadFile: provider,
    };
  }

  function isExactAutoFacade(mode: NativeMode, value: unknown): value is FacadeLike {
    if (typeof value !== 'object' || value === null) return false;
    const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
    if (mode === 'stream') {
      return value instanceof StreamResponse && constructorName === 'UniversalStreamResponse';
    }
    if (mode === 'download') {
      return value instanceof DownloadResponse && constructorName === 'ReactNativeDownloadResponse';
    }
    return value instanceof UploadResponse && constructorName === 'ReactNativeUploadResponse';
  }

  async function runAutoPreAbort(mode: NativeMode): Promise<Record<string, unknown>> {
    const suffix = `ro06-auto-preabort-${mode}`;
    const controller = new AbortController();
    let providerCalls = 0;
    let fetchDispatches = 0;
    let onAbort = 0;
    let onTimeout = 0;
    installFetch(async () => {
      fetchDispatches += 1;
      return fakeResponse({ body: 'must-not-dispatch' });
    });
    const request: Record<string, unknown> = {
      url: `${URL_BASE}/${suffix}`,
      method: mode === 'upload' ? 'POST' : 'GET',
      retry: false,
      cache: false,
      signal: controller.signal,
      hooks: {
        onAbort: [async () => { onAbort += 1; }],
        onTimeout: [async () => { onTimeout += 1; }],
      },
    };
    const reactNative: Record<string, unknown> = {};
    configureAutoNativeLane(mode, suffix, request, reactNative, async () => {
      providerCalls += 1;
      return validNativeResult(mode, suffix);
    });
    controller.abort();
    const returned = await withWatchdog(
      executeRequest(request as never, { reactNative } as never, new RezoCookieJar()),
      `RO-06 auto pre-abort ${mode} facade return`,
    );
    const exactType = isExactAutoFacade(mode, returned);
    if (!exactType) {
      return {
        mode, exactType, returnedType: (returned as any)?.constructor?.name ?? null,
        providerCalls, fetchDispatches, onAbort, onTimeout,
      };
    }
    const stableReference = returned;
    const ledger = observeFacade(returned);
    const atBoundary = ledger.snapshot();
    const hooksAtBoundary = { onAbort, onTimeout };
    const error = ledger.errors[0];
    const errorName = error instanceof Error ? error.name : null;
    await delay(24);
    const afterLate = ledger.snapshot();
    return {
      mode, exactType, returnedType: returned.constructor.name, stableIdentity: returned === stableReference,
      providerCalls, fetchDispatches, hooksAtBoundary, finalHooks: { onAbort, onTimeout },
      errorName, atBoundary, afterLate,
    };
  }

  async function runAutoPositive(mode: NativeMode): Promise<Record<string, unknown>> {
    const suffix = `ro06-auto-positive-${mode}`;
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    let providerCalls = 0;
    let fetchDispatches = 0;
    installFetch(async () => {
      fetchDispatches += 1;
      return fakeResponse({ body: 'must-not-use-fetch' });
    });
    const request: Record<string, unknown> = {
      url: `${URL_BASE}/${suffix}`,
      method: mode === 'upload' ? 'POST' : 'GET',
      retry: false,
      cache: false,
    };
    const reactNative: Record<string, unknown> = {};
    configureAutoNativeLane(mode, suffix, request, reactNative, async () => {
      providerCalls += 1;
      entered.resolve(undefined);
      await release.promise;
      return validNativeResult(mode, suffix);
    });
    const returned = await withWatchdog(
      executeRequest(request as never, { reactNative } as never, new RezoCookieJar()),
      `RO-06 auto positive ${mode} facade return`,
    );
    const exactType = isExactAutoFacade(mode, returned);
    if (!exactType) {
      release.resolve(undefined);
      return {
        mode, exactType, returnedType: (returned as any)?.constructor?.name ?? null,
        providerCalls, fetchDispatches,
      };
    }
    const stableReference = returned;
    const ledger = observeFacade(returned);
    try {
      await withWatchdog(entered.promise, `RO-06 auto positive ${mode} provider entry`);
      release.resolve(undefined);
      await waitForTerminal(ledger, `RO-06 auto positive ${mode}`);
    } finally {
      release.resolve(undefined);
    }
    await delay(10);
    const success = ledger.successes.at(-1);
    return {
      mode, exactType, returnedType: returned.constructor.name, stableIdentity: returned === stableReference,
      providerCalls, fetchDispatches, events: [...ledger.events], errors: ledger.errors.length,
      successFamily: successFamily(ledger), status: eventStatus(success), finalUrl: eventFinalUrl(success),
      finished: returned.isFinished(),
    };
  }

  const facadeThrows = [
    await runFacadeThrow('stream'),
    await runFacadeThrow('download'),
    await runFacadeThrow('upload'),
  ];
  const autoPreAbort = [
    await runAutoPreAbort('stream'),
    await runAutoPreAbort('download'),
    await runAutoPreAbort('upload'),
  ];
  const positiveAuto = [
    await runAutoPositive('stream'),
    await runAutoPositive('download'),
    await runAutoPositive('upload'),
  ];
  const lifetimePass = lifetime.every((entry) => {
    const atBoundary = entry.atBoundary as Record<string, unknown>;
    return atBoundary.outcome === 'rejected' && atBoundary.name === 'RezoError'
      && atBoundary.code === (entry.variant === 'timeout' ? 'ETIMEDOUT' : 'ABORT_ERR')
      && atBoundary.message === (entry.variant === 'timeout' ? 'Request timeout after 35ms' : 'Request was aborted')
      && entry.dispatchesAtBoundary === 0 && entry.finalDispatches === 0
      && JSON.stringify(entry.atBoundary) === JSON.stringify(entry.afterRelease)
      && JSON.stringify(entry.hooksAtBoundary) === JSON.stringify(entry.finalHooks)
      && (entry.hooksAtBoundary as Record<string, number>).onAbort === (entry.variant === 'signal' ? 1 : 0)
      && (entry.hooksAtBoundary as Record<string, number>).onTimeout === (entry.variant === 'timeout' ? 1 : 0);
  });
  const bufferedThrowPass = bufferedThrow.outcome === 'rejected' && bufferedThrow.dispatches === 0
    && bufferedThrow.beforeError === 1 && bufferedThrow.name === 'RezoError' && bufferedThrow.code === 'REZ_UNKNOWN_ERROR'
    && bufferedThrow.message === bufferedMessage && bufferedThrow.cause === bufferedMessage && bufferedThrow.transformed === true;
  const facadeThrowPass = facadeThrows.every((entry) => entry.execution === 'fulfilled' && entry.returnedFacade === true
    && entry.directName === null && entry.directCode === null && entry.directMessage === null && entry.directCause === null
    && entry.providerCalls === 0 && entry.fetchDispatches === 0 && entry.beforeError === 1
    && entry.facadeErrors === 1 && entry.facadeName === 'RezoError' && entry.facadeCode === 'REZ_UNKNOWN_ERROR'
    && entry.facadeMessage === entry.message && entry.facadeCause === entry.message && entry.transformed === true
    && entry.successes === 0 && entry.end === 0 && entry.close === 0 && entry.finished === false);
  const positiveAutoPass = positiveAuto.every((entry) => entry.exactType === true && entry.stableIdentity === true
    && entry.providerCalls === 1 && entry.fetchDispatches === 0 && entry.errors === 0
    && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && entry.status === 200 && entry.finalUrl === `${URL_BASE}/ro06-auto-positive-${entry.mode}` && entry.finished === true);
  const autoPreAbortDesiredPass = autoPreAbort.every((entry) => {
    const atBoundary = entry.atBoundary as ReturnType<FacadeLedger['snapshot']>;
    const hooksAtBoundary = entry.hooksAtBoundary as Record<string, number>;
    return entry.exactType === true && entry.stableIdentity === true
      && entry.providerCalls === 0 && entry.fetchDispatches === 0
      && hooksAtBoundary?.onAbort === 1 && hooksAtBoundary?.onTimeout === 0
      && JSON.stringify(entry.hooksAtBoundary) === JSON.stringify(entry.finalHooks)
      && entry.errorName === 'RezoError'
      && JSON.stringify(atBoundary?.events) === JSON.stringify(['error'])
      && JSON.stringify(atBoundary?.errorCodes) === JSON.stringify(['ABORT_ERR'])
      && JSON.stringify(atBoundary?.errorMessages) === JSON.stringify(['Request was aborted'])
      && atBoundary?.successes === 0 && atBoundary?.chunks.length === 0 && atBoundary?.finished === false
      && JSON.stringify(entry.atBoundary) === JSON.stringify(entry.afterLate);
  });
  const autoPreAbortCurrentLoss = autoPreAbort.every((entry) => {
    const atBoundary = entry.atBoundary as ReturnType<FacadeLedger['snapshot']>;
    const hooksAtBoundary = entry.hooksAtBoundary as Record<string, number>;
    return entry.exactType === true && entry.stableIdentity === true
      && entry.providerCalls === 0 && entry.fetchDispatches === 0
      && hooksAtBoundary?.onAbort === 1 && hooksAtBoundary?.onTimeout === 0
      && JSON.stringify(entry.hooksAtBoundary) === JSON.stringify(entry.finalHooks)
      && entry.errorName === null
      && JSON.stringify(atBoundary?.events) === JSON.stringify([])
      && JSON.stringify(atBoundary?.errorCodes) === JSON.stringify([])
      && JSON.stringify(atBoundary?.errorMessages) === JSON.stringify([])
      && atBoundary?.successes === 0 && atBoundary?.chunks.length === 0 && atBoundary?.finished === false
      && JSON.stringify(entry.atBoundary) === JSON.stringify(entry.afterLate);
  });
  const actual = { happy, lifetime, bufferedThrow, facadeThrows, autoPreAbort, positiveAuto };
  return {
    actual,
    desired: 'request transforms remain lifetime-owned; supplied facade failures stay structured; auto stream/download/upload pre-aborts replay one ABORT_ERR to post-return observers while positive auto facades still terminate',
    desiredPass: happyPass && lifetimePass && bufferedThrowPass && facadeThrowPass
      && autoPreAbortDesiredPass && positiveAutoPass,
    currentSignature: happyPass && lifetimePass && bufferedThrowPass && facadeThrowPass
      && autoPreAbortCurrentLoss && positiveAutoPass,
  };
});

logicalRow('RO-07', 'body/content/rate limits reject or explicitly refuse at owned boundaries', async () => {
  const baseVariants = [
    ['body', { method: 'POST', body: '1234', maxBodyLength: 2 }],
    ['content', { method: 'GET', maxContentLength: 2 }],
    ['rate', { method: 'GET', maxRate: 1 }],
  ] as const;
  const base: Array<Record<string, unknown>> = [];
  for (const [label, extras] of baseVariants) {
    let calls = 0;
    let bodyReads = 0;
    let responseTransforms = 0;
    let afterHeaders = 0;
    let afterParse = 0;
    installFetch(async () => {
      calls += 1;
      return fakeResponse({ body: '1234', headers: { 'content-type': 'text/plain', 'content-length': '4' },
        onText: () => { bodyReads += 1; } });
    });
    const result = await settle(executeRequest({
      url: `${URL_BASE}/ro07-${label}`, retry: false, cache: false, ...extras,
      transformResponse: [(data: unknown) => { responseTransforms += 1; return data; }],
      hooks: {
        afterHeaders: [async () => { afterHeaders += 1; }],
        afterParse: [async (event: any) => { afterParse += 1; return event.data; }],
      },
    } as never, {} as never, new RezoCookieJar()));
    base.push({ label, calls, bodyReads, responseTransforms, afterHeaders, afterParse, outcome: result.outcome, code: errorCode(result.value),
      name: result.value instanceof Error ? result.value.name : null, message: errorMessage(result.value) });
  }
  const body = base[0];
  const content = base[1];
  const rate = base[2];
  // The manifest permits observable throttling or structural refusal. This
  // Tier-C carrier deliberately selects refusal: wall-clock sleeps cannot
  // establish native bandwidth enforcement without a timing-racy oracle.
  const basePass = body?.label === 'body' && body.calls === 0 && body.bodyReads === 0
    && body.responseTransforms === 0 && body.afterHeaders === 0 && body.afterParse === 0 && body.outcome === 'rejected'
    && body.name === 'RezoError' && body.code === 'REZ_BODY_TOO_LARGE'
    && content?.label === 'content' && content.calls === 1 && content.bodyReads === 0
    && content.responseTransforms === 0 && content.afterHeaders === 0 && content.afterParse === 0 && content.outcome === 'rejected'
    && content.name === 'RezoError' && content.code === 'REZ_RESPONSE_TOO_LARGE'
    && rate?.label === 'rate' && rate.calls === 0 && rate.bodyReads === 0
    && rate.responseTransforms === 0 && rate.afterHeaders === 0 && rate.afterParse === 0 && rate.outcome === 'rejected'
    && rate.name === 'RezoError' && rate.code === 'REZ_UNSUPPORTED_CAPABILITY';

  const actualSize: Array<Record<string, unknown>> = [];
  for (const variant of ['no-length', 'underdeclared', 'malformed-json', 'below-limit'] as const) {
    const oversized = variant !== 'below-limit';
    const malformed = variant === 'malformed-json';
    const responseBody = malformed ? '{malformed-json' : oversized ? '1234' : '1';
    let fetchCalls = 0;
    let textReads = 0;
    let afterHeaders = 0;
    let responseTransforms = 0;
    let afterParse = 0;
    installFetch(async () => {
      fetchCalls += 1;
      return fakeResponse({
        body: responseBody,
        headers: {
          'content-type': malformed ? 'application/json' : 'text/plain',
          ...(variant === 'underdeclared' ? { 'content-length': '1' } : {}),
        },
        onText: () => { textReads += 1; },
      });
    });
    const result = await settle(executeRequest({
      url: `${URL_BASE}/ro07-${variant}`, method: 'GET', responseType: malformed ? 'json' : 'text',
      maxContentLength: 2, retry: false, cache: false,
      transformResponse: [(data: unknown) => { responseTransforms += 1; return data; }],
      hooks: {
        afterHeaders: [async () => { afterHeaders += 1; }],
        afterParse: [async (event: any) => { afterParse += 1; return event.data; }],
      },
    } as never, {} as never, new RezoCookieJar()));
    actualSize.push({
      variant, fetchCalls, textReads, afterHeaders, responseTransforms, afterParse,
      outcome: result.outcome, name: result.value instanceof Error ? result.value.name : null,
      code: errorCode(result.value), message: errorMessage(result.value),
      data: result.outcome === 'fulfilled' ? (result.value as any).data : null,
      size: result.outcome === 'fulfilled' ? (result.value as any).contentLength : null,
    });
  }

  async function runNativeLimit(
    mode: NativeMode,
    variant: 'oversize-option' | 'under-limit-option' | 'provider-control',
  ): Promise<Record<string, unknown>> {
    const size = variant === 'oversize-option' ? 4 : 1;
    const suffix = `ro07-${mode}-${variant}`;
    const facade = createFacade(mode, suffix);
    const ledger = observeFacade(facade);
    let providerCalls = 0;
    let fetchDispatches = 0;
    let responseTransforms = 0;
    let afterHeaders = 0;
    let afterParse = 0;
    installFetch(async () => { fetchDispatches += 1; return fakeResponse({ body: 'must-not-use-fetch' }); });
    const headers = { 'content-type': 'text/plain', 'content-length': String(size) };
    const provider = async (providerRequest: any) => {
      providerCalls += 1;
      await providerRequest.onHeaders?.({
        status: 200, statusText: 'OK', headers, contentType: 'text/plain', contentLength: size,
        finalUrl: `${URL_BASE}/${suffix}`,
      });
      if (mode === 'stream') {
        await providerRequest.onChunk?.(new Uint8Array(size).fill(7));
        await providerRequest.onProgress?.({ loaded: size, total: size });
      } else {
        await providerRequest.onProgress?.({ loaded: size, total: size });
      }
      return validNativeResult(mode, suffix, {
        headers, contentType: 'text/plain', contentLength: size,
        ...(mode === 'download' ? { fileSize: size } : {}),
        ...(mode === 'upload' ? { body: 'x'.repeat(size), uploadSize: 1 } : {}),
      });
    };
    const request: Record<string, unknown> = {
      url: `${URL_BASE}/${suffix}`, method: mode === 'upload' ? 'POST' : 'GET', retry: false, cache: false,
      ...(variant === 'provider-control' ? {} : { maxContentLength: 2 }),
      transformResponse: [(data: unknown) => { responseTransforms += 1; return data; }],
      hooks: {
        afterHeaders: [async () => { afterHeaders += 1; }],
        afterParse: [async (event: any) => { afterParse += 1; return event.data; }],
      },
    };
    const reactNative: Record<string, unknown> = {};
    if (mode === 'stream') {
      request.responseType = 'stream';
      request._streamResponse = facade;
      reactNative.streamTransport = { name: suffix, stream: provider };
    } else if (mode === 'download') {
      request.saveTo = `/tmp/${suffix}.bin`;
      request._isDownload = true;
      request._downloadResponse = facade;
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { fileDownload: true, downloadProgress: true }, downloadFile: provider };
    } else {
      request.body = { uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, size: 1 };
      request._isUpload = true;
      request._uploadResponse = facade;
      reactNative.fileSystemAdapter = { name: suffix, capabilities: { uploadFromFile: true, uploadProgress: true }, uploadFile: provider };
    }
    const execution = await settle(executeRequest(request as never, { reactNative } as never, new RezoCookieJar()));
    if (execution.outcome === 'fulfilled') await waitForTerminal(ledger, `RO-07 ${mode} ${variant}`);
    else await delay(5);
    const directError = execution.outcome === 'rejected' ? execution.value : undefined;
    return {
      mode, variant, size, execution: execution.outcome, returnedFacade: execution.value === facade,
      directName: directError instanceof Error ? directError.name : null,
      directCode: errorCode(directError), directMessage: directError === undefined ? null : errorMessage(directError),
      providerCalls, fetchDispatches, responseTransforms, afterHeaders, afterParse,
      events: [...ledger.events], chunks: ledger.chunks.map(normalizeChunk), facadeErrors: ledger.errors.length,
      facadeErrorCodes: ledger.errors.map(errorCode), successFamily: successFamily(ledger), finished: facade.isFinished(),
    };
  }

  const nativeLimits: Array<Record<string, unknown>> = [];
  for (const mode of ['stream', 'download', 'upload'] as const) {
    nativeLimits.push(await runNativeLimit(mode, 'oversize-option'));
    nativeLimits.push(await runNativeLimit(mode, 'under-limit-option'));
    nativeLimits.push(await runNativeLimit(mode, 'provider-control'));
  }

  const actualSizePass = actualSize.every((entry) => {
    if (entry.variant === 'below-limit') {
      return entry.fetchCalls === 1 && entry.textReads === 1 && entry.afterHeaders === 1
        && entry.responseTransforms === 1 && entry.afterParse === 1 && entry.outcome === 'fulfilled'
        && entry.code === null && entry.data === '1' && entry.size === 1;
    }
    return entry.fetchCalls === 1 && entry.textReads === 1 && entry.afterHeaders === 1
      && entry.responseTransforms === 0 && entry.afterParse === 0 && entry.outcome === 'rejected'
      && entry.name === 'RezoError' && entry.code === 'REZ_RESPONSE_TOO_LARGE';
  });
  const nativeRefusalPass = nativeLimits.filter((entry) => entry.variant !== 'provider-control').every((entry) => (
    entry.execution === 'rejected' && entry.returnedFacade === false
    && entry.directName === 'RezoError' && entry.directCode === 'REZ_UNSUPPORTED_CAPABILITY'
    && entry.directMessage === 'React Native adapter does not support the `maxContentLength` option.'
    && entry.providerCalls === 0 && entry.fetchDispatches === 0 && entry.responseTransforms === 0
    && entry.afterHeaders === 0 && entry.afterParse === 0 && (entry.events as unknown[]).length === 0
    && (entry.chunks as unknown[]).length === 0 && entry.facadeErrors === 0
    && (entry.successFamily as unknown[]).length === 0 && entry.finished === false
  ));
  const nativeControlsPass = nativeLimits.filter((entry) => entry.variant === 'provider-control').every((entry) => (
    entry.execution === 'fulfilled' && entry.returnedFacade === true && entry.providerCalls === 1 && entry.fetchDispatches === 0
    && entry.facadeErrors === 0 && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && entry.finished === true
    && (entry.mode === 'stream' ? (entry.chunks as unknown[]).length === 1 : (entry.events as string[]).filter((event) => event === 'progress').length === 1)
  ));
  const currentActualSize = actualSize.every((entry) => {
    if (entry.variant === 'below-limit') {
      return entry.outcome === 'fulfilled' && entry.code === null && entry.responseTransforms === 1 && entry.afterParse === 1;
    }
    if (entry.variant === 'malformed-json') {
      return entry.outcome === 'rejected' && entry.name === 'RezoError' && entry.code === 'REZ_INVALID_JSON'
        && entry.message === 'Failed to parse JSON response' && entry.responseTransforms === 0 && entry.afterParse === 0;
    }
    return entry.outcome === 'rejected' && entry.name === 'RezoError' && entry.code === 'REZ_RESPONSE_TOO_LARGE'
      && entry.responseTransforms === 1 && entry.afterParse === 1;
  });
  const currentNativeSilentSuccess = nativeLimits.filter((entry) => entry.variant !== 'provider-control').every((entry) => (
    entry.execution === 'fulfilled' && entry.returnedFacade === true && entry.providerCalls === 1 && entry.fetchDispatches === 0
    && entry.directName === null && entry.directCode === null && entry.directMessage === null
    && entry.facadeErrors === 0 && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
    && entry.finished === true
    && (entry.mode === 'stream' ? (entry.chunks as unknown[]).length === 1 : (entry.events as string[]).filter((event) => event === 'progress').length === 1)
  ));
  const actual = { base, actualSize, nativeLimits };
  return {
    actual,
    desired: 'body/content limits own their boundaries; actual Fetch bytes outrank parse/transform side effects; native maxContentLength is an exact predispatch refusal with valid provider controls',
    desiredPass: basePass && actualSizePass && nativeRefusalPass && nativeControlsPass,
    currentSignature: basePass && currentActualSize && currentNativeSilentSuccess && nativeControlsPass,
  };
});

logicalRow('RO-08', 'encoding, decompression, and partial-body controls cannot be silently ignored', async () => {
  const variants = [
    ['responseEncoding', { responseEncoding: 'latin1' }],
    ['encoding', { encoding: 'latin1' }],
    ['decompress', { decompress: false }],
    ['partial', { acceptPartialBody: true }],
  ] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, extras] of variants) {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return fakeResponse({ bytes: new Uint8Array([0xe9]), headers: { 'content-type': 'text/plain', 'content-length': '1', 'content-encoding': 'gzip' } });
    });
    const result = await settle(executeRequest({ url: `${URL_BASE}/ro08-${label}`, method: 'GET', retry: false, cache: false, ...extras } as never, {} as never, new RezoCookieJar()));
    actual.push({ label, calls, outcome: result.outcome, code: errorCode(result.value),
      name: result.value instanceof Error ? result.value.name : null,
      data: result.outcome === 'fulfilled' ? (result.value as any).data : null });
  }
  // Each manifest disjunction is narrowed to its structural-refusal arm.
  // Injected Fetch cannot authenticate RN-native decoding/decompression or
  // partial-body salvage, so a bare fulfilled response earns no execution credit.
  const desiredPass = actual.every((entry) => entry.calls === 0 && entry.outcome === 'rejected'
    && entry.name === 'RezoError' && entry.code === 'REZ_UNSUPPORTED_CAPABILITY');
  return {
    actual,
    desired: 'four independently selected unenforceable options are RezoError REZ_UNSUPPORTED_CAPABILITY before dispatch',
    desiredPass,
    currentSignature: actual.every((entry) => entry.calls === 1 && entry.outcome === 'fulfilled' && entry.code === null),
  };
});

logicalRow('RO-09', 'Node transport options structurally refuse before React Native Fetch dispatch', async () => {
  const variants = [
    ['proxy-string', { proxy: 'http://proxy.test:8080' }],
    ['proxy-object', { proxy: { protocol: 'http', host: 'proxy.test', port: 8080 } }],
    ['httpAgent', { httpAgent: { marker: 'http' } }],
    ['httpsAgent', { httpsAgent: { marker: 'https' } }],
    ['dnsLookup', { dnsLookup: () => undefined }],
    ['dnsCache-true', { dnsCache: true }],
    ['dnsCache-object', { dnsCache: { marker: 'cache' } }],
    ['rejectUnauthorized', { rejectUnauthorized: false }],
    ['secureContext', { secureContext: { marker: 'secure-context' } }],
    ['useSecureContext', { useSecureContext: true }],
    ['socketPath', { socketPath: '/tmp/rezo.sock' }],
    ['http2', { http2: true }],
  ] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, extras] of variants) {
    let calls = 0;
    installFetch(async () => { calls += 1; return fakeResponse({ body: 'ok' }); });
    const result = await settle(executeRequest({ url: `${URL_BASE}/ro09-${label}`, method: 'GET', retry: false, cache: false, ...extras } as never, {} as never, new RezoCookieJar()));
    actual.push({ label, calls, outcome: result.outcome, code: errorCode(result.value),
      name: result.value instanceof Error ? result.value.name : null });
  }
  const desiredPass = actual.every((entry) => entry.calls === 0 && entry.outcome === 'rejected'
    && entry.name === 'RezoError' && entry.code === 'REZ_UNSUPPORTED_CAPABILITY');
  return {
    actual,
    desired: 'twelve independent RezoError REZ_UNSUPPORTED_CAPABILITY pre-dispatch refusals',
    desiredPass,
    currentSignature: actual.every((entry) => entry.calls === 1 && entry.outcome === 'fulfilled' && entry.code === null),
  };
});

logicalRow('RO-10', 'missing native providers reject with structured unsupported capability errors', async () => {
  let fetchCalls = 0;
  installFetch(async () => { fetchCalls += 1; return fakeResponse({ body: 'ok' }); });
  const variants = [
    ['stream', { url: `${URL_BASE}/ro10-stream`, method: 'GET', responseType: 'stream' },
      'React Native streaming requires `reactNative.streamTransport`. Configure a dedicated RN streaming transport to use `rezo.stream(...)`.'],
    ['download', { url: `${URL_BASE}/ro10-download`, method: 'GET', saveTo: '/tmp/ro10.bin', _isDownload: true },
      'React Native file downloads require `reactNative.fileSystemAdapter`. Install and configure an Expo FileSystem or react-native-fs adapter to use `saveTo` or `fileName`.'],
    ['upload', { url: `${URL_BASE}/ro10-upload`, method: 'POST', body: { uri: 'file:///tmp/ro10.bin', name: 'ro10.bin' }, _isUpload: true },
      'React Native file uploads require `reactNative.fileSystemAdapter.uploadFile`. Install and configure an RN file upload provider to use `reactNative.upload` or file-based `rezo.upload(...)`.'],
    ['background', { url: `${URL_BASE}/ro10-background`, method: 'GET', reactNative: { backgroundTask: { name: 'ro10' } } },
      'React Native background task requests require `reactNative.backgroundTaskProvider`. Install and configure a background task provider to use `reactNative.backgroundTask`.'],
  ] as const;
  const actual: Array<Record<string, unknown>> = [];
  for (const [label, request, expectedMessage] of variants) {
    const result = await settle(executeRequest({ ...request, retry: false, cache: false } as never, {} as never, new RezoCookieJar()));
    actual.push({ label, outcome: result.outcome, code: errorCode(result.value), name: result.value instanceof Error ? result.value.name : null,
      message: errorMessage(result.value), messageMatches: errorMessage(result.value) === expectedMessage });
  }
  const desiredPass = fetchCalls === 0 && actual.every((entry) => entry.outcome === 'rejected'
    && entry.code === 'REZ_UNSUPPORTED_CAPABILITY' && entry.name === 'RezoError' && entry.messageMatches === true);
  return {
    actual: { fetchCalls, variants: actual },
    desired: 'four RezoError REZ_UNSUPPORTED_CAPABILITY refusals, zero dispatch',
    desiredPass,
    currentSignature: fetchCalls === 0 && actual.every((entry) => entry.outcome === 'rejected'
      && entry.code === null && entry.name === 'Error' && entry.messageMatches === true),
  };
});

function containsFunction(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === 'function') return true;
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    try { if (containsFunction(Reflect.get(value, key), seen)) return true; } catch { return true; }
  }
  return false;
}

const PUBLIC_CONFIG_ALLOWLIST = [
  'adapterMetadata', 'adapterUsed', 'errors', 'finalUrl', 'headers', 'method', 'network',
  'redirectCount', 'responseType', 'retryAttempts', 'timing', 'transfer', 'url',
] as const;

const FORBIDDEN_CONFIG_KEYS = new Set([
  'adapter', 'auth', 'authorization', 'backgroundTaskProvider', 'beforeRedirect', 'cancelToken',
  'cookie', 'dnsLookup', 'fileSystemAdapter', 'hooks', 'httpAgent', 'httpsAgent', 'jar',
  'networkInfoProvider', 'onRedirect', 'originalBody', 'originalRequest', 'password', 'proxy',
  'reactNative', 'secureContext', 'set-cookie', 'setSignal', 'signal', 'streamTransport',
  'useSecureContext', 'validateStatus',
]);

function forbiddenKeyPaths(value: unknown, path = '$', seen = new Set<unknown>()): string[] {
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_CONFIG_KEYS.has(key.toLowerCase()) || FORBIDDEN_CONFIG_KEYS.has(key)) paths.push(nextPath);
    try { paths.push(...forbiddenKeyPaths(Reflect.get(value, key), nextPath, seen)); }
    catch { paths.push(`${nextPath}.[[unreadable]]`); }
  }
  return paths;
}

function containsIdentity(value: unknown, forbidden: ReadonlySet<unknown>, seen = new Set<unknown>()): boolean {
  if (forbidden.has(value)) return true;
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    try { if (containsIdentity(Reflect.get(value, key), forbidden, seen)) return true; }
    catch { return true; }
  }
  return false;
}

function safeSerialize(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return '[unserializable]'; }
}

function readHeaderValue(headers: unknown, name: string): string | null {
  if (typeof headers !== 'object' || headers === null) return null;
  const getter = Reflect.get(headers, 'get');
  if (typeof getter === 'function') {
    const value = Reflect.apply(getter, headers, [name]);
    return typeof value === 'string' ? value : null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value);
  }
  return null;
}

function writeHeaderValue(headers: unknown, name: string, value: string): boolean {
  if (typeof headers !== 'object' || headers === null) return false;
  const setter = Reflect.get(headers, 'set');
  if (typeof setter === 'function') {
    Reflect.apply(setter, headers, [name, value]);
    return readHeaderValue(headers, name) === value;
  }
  try {
    Reflect.set(headers, name, value);
    return readHeaderValue(headers, name) === value;
  } catch {
    return false;
  }
}

logicalRow('RO-11', 'terminal public config is cloned and allowlisted without secrets or executable aliases', async () => {
  const controller = new AbortController();
  const secret = 'phase5-super-secret';
  const hook = async () => undefined;
  const callerHeaders: Record<string, string> = { 'x-safe': 'opening', authorization: `Bearer ${secret}` };
  const callerBody = { uri: 'file:///tmp/ro11.bin', name: 'ro11.bin', size: 2 };
  const callerAuth = { username: 'private-user', password: secret };
  const facade = createFacade('upload', 'ro11');
  const ledger = observeFacade(facade);
  const provider = {
    name: 'ro11-provider',
    capabilities: { uploadFromFile: true },
    async uploadFile() { return validNativeResult('upload', 'ro11'); },
  };
  const jar = new RezoCookieJar();
  const request: Record<string, unknown> = {
    url: `${URL_BASE}/ro11`, method: 'POST',
    body: callerBody,
    headers: callerHeaders,
    responseType: 'upload',
    _isUpload: true,
    _uploadResponse: facade,
    retry: false,
    cache: false,
    signal: controller.signal,
    auth: callerAuth,
    hooks: { afterHeaders: [hook] },
  };
  const defaults = { reactNative: { fileSystemAdapter: provider } };
  const returned = await executeRequest(request as never, defaults as never, jar);
  if (returned !== facade) throw new InfrastructureError('RO-11 returned a different facade');
  await waitForTerminal(ledger, 'RO-11');
  const publicConfigs = ledger.successes.map((terminal: any) => terminal?.config);
  const publicConfig = publicConfigs[0] as any;
  const serializedBeforeMutation = safeSerialize(publicConfig);
  const topKeys = publicConfigs.map((config) => typeof config === 'object' && config !== null ? Object.keys(config).sort() : []);
  const forbiddenPaths = publicConfigs.flatMap((config) => forbiddenKeyPaths(config));
  const forbiddenIdentities = new Set<unknown>([
    request, defaults, jar, provider, controller.signal, hook, callerHeaders, callerBody, callerAuth,
  ]);
  const identityLeak = publicConfigs.some((config) => containsIdentity(config, forbiddenIdentities));
  const functionLeak = publicConfigs.some((config) => containsFunction(config));
  const secretLeak = publicConfigs.some((config) => safeSerialize(config).includes(secret))
    || publicConfigs.some((config: any) => readHeaderValue(config?.headers, 'authorization') !== null);
  const safeHeaderBefore = readHeaderValue(publicConfig?.headers, 'x-safe');
  const truthfulCore = publicConfigs.every((config: any) => config?.adapterUsed === 'react-native'
    && config?.url === `${URL_BASE}/ro11` && config?.finalUrl === `${URL_BASE}/ro11`
    && config?.method === 'POST' && config?.responseType === 'upload'
    && Array.isArray(config?.errors) && config.errors.length === 0
    && typeof config?.adapterMetadata === 'object' && config.adapterMetadata !== null
    && readHeaderValue(config?.headers, 'x-safe') === 'opening');

  callerHeaders['x-safe'] = 'caller-mutated';
  callerBody.name = 'caller-mutated.bin';
  callerAuth.password = 'caller-mutated-secret';
  const publicStableAfterCallerMutation = readHeaderValue(publicConfig?.headers, 'x-safe') === safeHeaderBefore
    && safeSerialize(publicConfig) === serializedBeforeMutation;

  const publicHeaderMutationSucceeded = writeHeaderValue(publicConfig?.headers, 'x-safe', 'public-mutated');
  let publicTransferMutationSucceeded = false;
  try {
    publicConfig.transfer.bodySize = 77;
    publicTransferMutationSucceeded = publicConfig.transfer.bodySize === 77;
  } catch {}
  const callerStableAfterPublicMutation = callerHeaders['x-safe'] === 'caller-mutated'
    && callerBody.name === 'caller-mutated.bin' && callerAuth.password === 'caller-mutated-secret';

  const exactAllowlist = topKeys.every((keys) => JSON.stringify(keys) === JSON.stringify([...PUBLIC_CONFIG_ALLOWLIST].sort()));
  const successExact = returned === facade && JSON.stringify(successFamily(ledger)) === JSON.stringify(['finish', 'done', 'complete'])
    && ledger.successes.length === 3 && ledger.errors.length === 0 && facade.isFinished();
  const nonNullConfigs = publicConfigs.length === 3 && publicConfigs.every((config) => typeof config === 'object' && config !== null);
  const actual = {
    successFamily: successFamily(ledger), successes: ledger.successes.length, errors: ledger.errors.length,
    returnedFacade: returned === facade, finished: facade.isFinished(), nonNullConfigs,
    topKeys, exactAllowlist, forbiddenPaths, identityLeak, functionLeak, secretLeak,
    safeHeaderBefore, publicStableAfterCallerMutation, publicHeaderMutationSucceeded,
    publicTransferMutationSucceeded, callerStableAfterPublicMutation, truthfulCore,
  };
  const desiredPass = successExact && nonNullConfigs && exactAllowlist && truthfulCore
    && forbiddenPaths.length === 0 && !identityLeak && !functionLeak && !secretLeak
    && safeHeaderBefore === 'opening' && publicStableAfterCallerMutation
    && publicHeaderMutationSucceeded && publicTransferMutationSucceeded && callerStableAfterPublicMutation;
  return {
    actual,
    desired: { success: 'finish/done/complete, zero errors', allowlist: PUBLIC_CONFIG_ALLOWLIST,
      leaks: 'zero recursive forbidden keys, identities, functions, or auth secrets', aliases: 'bidirectional nested mutations isolated' },
    desiredPass,
    currentSignature: successExact && nonNullConfigs && !exactAllowlist && forbiddenPaths.length > 0
      && identityLeak && functionLeak && secretLeak && safeHeaderBefore === 'opening'
      && !publicStableAfterCallerMutation && publicHeaderMutationSucceeded && publicTransferMutationSucceeded
      && callerStableAfterPublicMutation,
  };
});

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

logicalRow('RO-12', 'malicious providers receive mutation-isolated copies of frozen caller/default inputs', async () => {
  async function runVariant(source: 'request' | 'defaults'): Promise<Record<string, unknown>> {
    const suffix = `ro12-${source}`;
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const fields = { album: 'original' };
    const upload = { uri: `file:///tmp/${suffix}.bin`, name: `${suffix}.bin`, size: 2, fields };
    const headers = { 'x-caller': 'original' };
    const mutation = { headers: false, file: false, fields: false };
    let providerCalls = 0;
    const provider = {
      name: suffix,
      capabilities: { uploadFromFile: true },
      async uploadFile(providerRequest: any) {
        providerCalls += 1;
        entered.resolve(undefined);
        await release.promise;
        try { providerRequest.headers['x-provider'] = 'mutated'; mutation.headers = providerRequest.headers['x-provider'] === 'mutated'; } catch {}
        try { providerRequest.file.name = 'mutated.bin'; mutation.file = providerRequest.file.name === 'mutated.bin'; } catch {}
        try { providerRequest.fields.album = 'mutated'; mutation.fields = providerRequest.fields.album === 'mutated'; } catch {}
        return validNativeResult('upload', suffix);
      },
    };
    const request = deepFreeze(source === 'request' ? {
      url: `${URL_BASE}/${suffix}`, method: 'POST', responseType: 'upload', retry: false, cache: false,
      headers, reactNative: { upload },
    } : {
      url: `${URL_BASE}/${suffix}`, method: 'POST', responseType: 'upload', retry: false, cache: false,
    });
    const defaults = deepFreeze(source === 'defaults'
      ? { headers, reactNative: { upload, fileSystemAdapter: provider } }
      : { reactNative: { fileSystemAdapter: provider } });
    const requestBefore = safeSerialize(request);
    const defaultsBefore = safeSerialize(defaults);
    const returned = await executeRequest(request as never, defaults as never, new RezoCookieJar()) as unknown as FacadeLike;
    await entered.promise;
    const ledger = observeFacade(returned);
    release.resolve(undefined);
    await waitForTerminal(ledger, `RO-12 ${source}`);
    const success = ledger.successes.at(-1);
    return {
      source, mutation, providerCalls, requestStable: safeSerialize(request) === requestBefore,
      defaultsStable: safeSerialize(defaults) === defaultsBefore, originalHeader: headers['x-caller'],
      originalFile: upload.name, originalField: fields.album, frozenRequest: Object.isFrozen(request),
      frozenDefaults: Object.isFrozen(defaults), successFamily: successFamily(ledger), errors: ledger.errors.length,
      finished: returned.isFinished(), status: eventStatus(success), finalUrl: eventFinalUrl(success),
    };
  }

  const actual = [await runVariant('request'), await runVariant('defaults')];
  const desiredPass = actual.every((entry) => {
    const mutation = entry.mutation as Record<string, boolean>;
    return mutation.headers && mutation.file && mutation.fields && entry.providerCalls === 1
      && entry.requestStable === true && entry.defaultsStable === true && entry.originalHeader === 'original'
      && entry.originalFile === `ro12-${entry.source}.bin` && entry.originalField === 'original'
      && entry.frozenRequest === true && entry.frozenDefaults === true
      && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
      && entry.errors === 0 && entry.finished === true && entry.status === 200
      && entry.finalUrl === `${URL_BASE}/ro12-${entry.source}`;
  });
  return {
    actual,
    desired: 'request/default sourced headers/upload/file/fields are independently cloned; provider calls once; exact success; both frozen inputs stay exact',
    desiredPass,
    currentSignature: actual.every((entry) => {
      const mutation = entry.mutation as Record<string, boolean>;
      return mutation.headers && mutation.file && !mutation.fields && entry.providerCalls === 1
        && entry.requestStable === true && entry.defaultsStable === true && entry.originalHeader === 'original'
        && entry.originalFile === `ro12-${entry.source}.bin` && entry.originalField === 'original'
        && JSON.stringify(entry.successFamily) === JSON.stringify(['finish', 'done', 'complete'])
        && entry.errors === 0 && entry.finished === true && entry.status === 200
        && entry.finalUrl === `${URL_BASE}/ro12-${entry.source}`;
    }),
  };
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandledRejection);
  const closingDependencies = identities();
  const closingCarrier = sha256(CARRIER_PATH);
  const expectedRed = [...EXPECTED_RED].sort();
  const observedRed = [...actualRed].sort();
  const missingRows = REGISTERED.filter((id) => !observations.has(id));
  const duplicateRows = REGISTERED.filter((id) => invocations.get(id) !== 1);
  const identityErrors = Object.keys(PINNED).filter((path) => closingDependencies[path] !== OPENING.dependencies[path]);
  if (closingCarrier !== OPENING.carrierSha256) identityErrors.push('carrier');
  const ledger = {
    registered: REGISTERED.length,
    expectedRed,
    actualRed: observedRed,
    controls: [...passed].sort(),
    missingRows,
    duplicateRows,
    fixtureErrors,
    oracleErrors,
    cleanupErrors,
    unhandled: unhandledRejections.map(describeUnknown),
    identityErrors,
  };
  process.stdout.write(`RN_PHASE5_ADAPTER_LEDGER ${JSON.stringify(ledger)}\n`);
  if (JSON.stringify(expectedRed) !== JSON.stringify(observedRed)
    || missingRows.length > 0 || duplicateRows.length > 0 || fixtureErrors.length > 0
    || oracleErrors.length > 0 || cleanupErrors.length > 0 || unhandledRejections.length > 0
    || identityErrors.length > 0 || passed.size !== REGISTERED.length - EXPECTED_RED.length) {
    throw new Error(`RN Phase 5 adapter ledger mismatch: ${JSON.stringify(ledger)}`);
  }
});
