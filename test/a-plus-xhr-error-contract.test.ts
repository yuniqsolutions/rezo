import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import { DownloadResponse } from '../src/responses/universal/download';
import { StreamResponse } from '../src/responses/universal/stream';
import { UploadResponse } from '../src/responses/universal/upload';
import type { RezoDefaultOptions } from '../src/types/options';
import type { RezoRequestConfig } from '../src/types/rezo-request';

/**
 * R18 first RED carrier: deterministic source-level XHR failure/facade seams.
 *
 * This is intentionally a fake-XMLHttpRequest carrier. It proves adapter-local
 * routing and settlement under Node and Bun; reset/truncation/status-0 remain
 * real-Chrome obligations and receive no credit from this file.
 */

type FakeOutcome =
  | Readonly<{ kind: 'load'; status: number; statusText: string; body: string }>
  | Readonly<{ kind: 'hold' }>;

interface ErrorShape {
  readonly code?: string;
  readonly errno?: number;
  readonly message?: string;
}

interface CapturedOutcome {
  readonly kind: 'fulfilled' | 'rejected';
  readonly status?: number;
  readonly code?: string;
  readonly errno?: number;
}

interface TestFacade {
  on(event: string, listener: (...args: unknown[]) => void): TestFacade;
  isFinished(): boolean;
}

interface XHRInternalRequest extends RezoRequestConfig {
  _isStream?: boolean;
  _streamResponse?: StreamResponse;
  _isDownload?: boolean;
  _downloadResponse?: DownloadResponse;
  _isUpload?: boolean;
  _uploadResponse?: UploadResponse;
}

type FacadeMode = 'stream' | 'download' | 'upload';

const SOURCE_URL = 'http://xhr-error-contract.rezo.test/resource';
const ROW_SETTLE_MS = 60;
const HARNESS_BOUND_MS = 1_000;

let fakeOutcome: FakeOutcome = {
  kind: 'load',
  status: 200,
  statusText: 'OK',
  body: 'ok',
};

const instances: ControlledXMLHttpRequest[] = [];
const openTimers = new Set<ReturnType<typeof setTimeout>>();

function schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    openTimers.delete(timer);
    callback();
  }, delayMs);
  openTimers.add(timer);
  return timer;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    schedule(resolve, delayMs);
  });
}

class ControlledXMLHttpRequest {
  readyState = 0;
  status = 0;
  statusText = '';
  response: unknown = '';
  responseText = '';
  responseURL = '';
  responseType = '';
  timeout = 0;
  withCredentials = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: unknown) => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  upload = { onprogress: null as ((event: unknown) => void) | null };

  readonly lifecycle: string[] = ['constructed'];
  abortCalls = 0;
  sendCalls = 0;
  loadCalls = 0;

  #url = '';
  #terminal = false;
  #scheduled?: ReturnType<typeof setTimeout>;

  constructor() {
    instances.push(this);
  }

  open(method: string, url: string, async = true): void {
    this.#url = url;
    this.readyState = 1;
    this.lifecycle.push(`open:${method.toUpperCase()}:${url}:${String(async)}`);
  }

  setRequestHeader(name: string, value: string): void {
    this.lifecycle.push(`header:${name.toLowerCase()}:${value}`);
  }

  getAllResponseHeaders(): string {
    return 'content-type: text/plain\r\ncontent-length: 2\r\n';
  }

  getResponseHeader(name: string): string | null {
    const normalized = name.toLowerCase();
    if (normalized === 'content-type') return 'text/plain';
    if (normalized === 'content-length') return '2';
    return null;
  }

  send(body?: unknown): void {
    this.sendCalls += 1;
    this.lifecycle.push(`send:${body === null || body === undefined ? 'empty' : 'body'}`);
    if (this.#terminal || fakeOutcome.kind === 'hold') return;
    this.#scheduled = schedule(() => this.releaseLoad(), 5);
  }

  abort(): void {
    this.abortCalls += 1;
    this.lifecycle.push('abort');
    if (this.#terminal) return;
    this.#terminal = true;
    if (this.#scheduled) {
      clearTimeout(this.#scheduled);
      openTimers.delete(this.#scheduled);
      this.#scheduled = undefined;
    }
    queueMicrotask(() => this.onabort?.());
  }

  releaseLoad(): void {
    if (this.#terminal) return;
    this.#terminal = true;
    const outcome = fakeOutcome.kind === 'load'
      ? fakeOutcome
      : { kind: 'load' as const, status: 200, statusText: 'OK', body: 'released' };
    this.status = outcome.status;
    this.statusText = outcome.statusText;
    this.responseText = outcome.body;
    this.response = outcome.body;
    this.responseURL = this.#url;
    this.readyState = 4;
    this.lifecycle.push('readyState:4');
    this.onreadystatechange?.();
    this.loadCalls += 1;
    this.lifecycle.push('load');
    this.onload?.();
  }

  dispose(): void {
    if (this.#scheduled) {
      clearTimeout(this.#scheduled);
      openTimers.delete(this.#scheduled);
      this.#scheduled = undefined;
    }
  }
}

// xhr.ts captures Environment.hasXHR when the module evaluates. Install the
// fake before the dynamic import, then restore the exact prior descriptor.
const priorXHRDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
Object.defineProperty(globalThis, 'XMLHttpRequest', {
  configurable: true,
  enumerable: priorXHRDescriptor?.enumerable ?? false,
  value: ControlledXMLHttpRequest,
  writable: true,
});

const { executeRequest: executeXHRRequest } = await import('../src/adapters/xhr');

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  fakeOutcome = { kind: 'load', status: 200, statusText: 'OK', body: 'ok' };
  instances.length = 0;
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  await delay(0);
  process.off('unhandledRejection', onUnhandled);
  for (const instance of instances) instance.dispose();
  for (const timer of openTimers) clearTimeout(timer);
  openTimers.clear();
});

afterAll(() => {
  if (priorXHRDescriptor) {
    Object.defineProperty(globalThis, 'XMLHttpRequest', priorXHRDescriptor);
  } else {
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  }
  expect(Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest')).toEqual(priorXHRDescriptor);
});

function baseRequest(): XHRInternalRequest {
  return {
    url: SOURCE_URL,
    method: 'GET',
    responseType: 'text',
    retry: false,
    cache: false,
    timeout: 0,
  };
}

function createFacadeMode(mode: FacadeMode): {
  readonly facade: TestFacade;
  readonly request: XHRInternalRequest;
} {
  const request = baseRequest();
  if (mode === 'stream') {
    const facade = new StreamResponse();
    request._isStream = true;
    request._streamResponse = facade;
    return { facade: facade as TestFacade, request };
  }
  if (mode === 'download') {
    const facade = new DownloadResponse('/virtual/xhr-download.bin', SOURCE_URL);
    request._isDownload = true;
    request._downloadResponse = facade;
    return { facade: facade as TestFacade, request };
  }
  const facade = new UploadResponse(SOURCE_URL, 'payload.txt');
  request.method = 'POST';
  request.body = 'payload';
  request._isUpload = true;
  request._uploadResponse = facade;
  return { facade: facade as TestFacade, request };
}

function attachTerminalLedger(facade: TestFacade): {
  readonly events: string[];
  readonly errors: ErrorShape[];
} {
  const events: string[] = [];
  const errors: ErrorShape[] = [];
  facade.on('finish', () => events.push('finish'));
  facade.on('done', () => events.push('done'));
  facade.on('complete', () => events.push('complete'));
  facade.on('error', (error: unknown) => {
    events.push('error');
    errors.push(error as ErrorShape);
  });
  return { events, errors };
}

function capturedUnhandled(): Array<{ code?: string; errno?: number }> {
  return unhandled.map((reason) => {
    const error = reason as ErrorShape;
    return { code: error?.code, errno: error?.errno };
  });
}

async function captureOutcome(promise: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    const value = await promise;
    const response = value as { status?: number };
    return { kind: 'fulfilled', status: response?.status };
  } catch (error) {
    const caught = error as ErrorShape;
    return {
      kind: 'rejected',
      code: caught?.code,
      errno: caught?.errno,
    };
  }
}

async function waitFor(
  condition: () => boolean,
  failureMessage: string,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= HARNESS_BOUND_MS) {
      throw new Error(`XHR carrier harness fault: ${failureMessage}`);
    }
    await delay(1);
  }
}

async function observePromptOutcome(
  outcomePromise: Promise<CapturedOutcome>,
  release: () => void,
): Promise<{ readonly prompt: boolean; readonly outcome: CapturedOutcome }> {
  const sentinel = Symbol('row-watchdog');
  const first = await Promise.race([
    outcomePromise,
    delay(ROW_SETTLE_MS).then(() => sentinel),
  ]);
  if (first !== sentinel) {
    return { prompt: true, outcome: first };
  }
  release();
  return { prompt: false, outcome: await outcomePromise };
}

const DEFAULTS: RezoDefaultOptions = {};
const FACADE_MODES: readonly FacadeMode[] = ['stream', 'download', 'upload'];

describe('R18 XHR caller-provided facade ownership and terminal settlement', () => {
  it.each(FACADE_MODES)('XE-FS-%s success returns and settles the caller facade exactly once', async (mode) => {
    fakeOutcome = { kind: 'load', status: 200, statusText: 'OK', body: 'ok' };
    const { facade, request } = createFacadeMode(mode);
    const ledger = attachTerminalLedger(facade);

    const returned = await executeXHRRequest(request, DEFAULTS, new RezoCookieJar());
    await delay(ROW_SETTLE_MS);

    expect({
      returnedSameFacade: returned === facade,
      constructed: instances.length,
      sendCalls: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      loadCalls: instances.reduce((sum, instance) => sum + instance.loadCalls, 0),
      terminalEvents: ledger.events,
      errorCodes: ledger.errors.map((error) => error.code),
      isFinished: facade.isFinished(),
      unhandled: capturedUnhandled(),
    }).toEqual({
      returnedSameFacade: true,
      constructed: 1,
      sendCalls: 1,
      loadCalls: 1,
      terminalEvents: ['finish', 'done', 'complete'],
      errorCodes: [],
      isFinished: true,
      unhandled: [],
    });
  });

  it.each(FACADE_MODES)('XE-FE-%s HTTP failure returns the caller facade and emits one error only', async (mode) => {
    fakeOutcome = { kind: 'load', status: 503, statusText: 'Service Unavailable', body: 'unavailable' };
    const { facade, request } = createFacadeMode(mode);
    const ledger = attachTerminalLedger(facade);

    const returned = await executeXHRRequest(request, DEFAULTS, new RezoCookieJar());
    if (returned !== facade && typeof (returned as TestFacade).on === 'function') {
      // Observe the adapter's private current facade so its event is never a
      // harness-side uncaught error; the orphaned request rejection remains
      // independently observable through the process ledger below.
      (returned as TestFacade).on('error', () => undefined);
    }
    await delay(ROW_SETTLE_MS);

    expect({
      returnedSameFacade: returned === facade,
      constructed: instances.length,
      sendCalls: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      loadCalls: instances.reduce((sum, instance) => sum + instance.loadCalls, 0),
      terminalEvents: ledger.events,
      errorCodes: ledger.errors.map((error) => error.code),
      errorErrnos: ledger.errors.map((error) => error.errno),
      isFinished: facade.isFinished(),
      unhandled: capturedUnhandled(),
    }).toEqual({
      returnedSameFacade: true,
      constructed: 1,
      sendCalls: 1,
      loadCalls: 1,
      terminalEvents: ['error'],
      errorCodes: ['REZ_HTTP_ERROR'],
      errorErrnos: [-1031],
      isFinished: false,
      unhandled: [],
    });
  });
});

describe('R12/R18 XHR fetchOptions.signal propagation and abort taxonomy', () => {
  it('XE-S1 pre-aborted signal calls xhr.abort and promptly rejects as ABORT_ERR', async () => {
    fakeOutcome = { kind: 'hold' };
    const controller = new AbortController();
    controller.abort();
    const request = { ...baseRequest(), signal: controller.signal };
    const outcomePromise = captureOutcome(
      executeXHRRequest(request, DEFAULTS, new RezoCookieJar()),
    );

    await waitFor(() => instances.length === 1, 'pre-abort never reached the XHR carrier');
    const observed = await observePromptOutcome(outcomePromise, () => instances[0]?.releaseLoad());

    expect({
      ...observed,
      constructed: instances.length,
      abortCalls: instances.reduce((sum, instance) => sum + instance.abortCalls, 0),
      sendCalls: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      unhandled: capturedUnhandled(),
    }).toEqual({
      prompt: true,
      outcome: { kind: 'rejected', code: 'ABORT_ERR', errno: -1025 },
      constructed: 1,
      abortCalls: 1,
      sendCalls: 1,
      unhandled: [],
    });
  });

  it('XE-S2 mid-flight signal calls xhr.abort and promptly rejects as ABORT_ERR', async () => {
    fakeOutcome = { kind: 'hold' };
    const controller = new AbortController();
    const request = { ...baseRequest(), signal: controller.signal };
    const outcomePromise = captureOutcome(
      executeXHRRequest(request, DEFAULTS, new RezoCookieJar()),
    );

    await waitFor(
      () => instances.length === 1 && instances[0]!.sendCalls === 1,
      'mid-flight abort never reached one dispatched XHR',
    );
    controller.abort();
    const observed = await observePromptOutcome(outcomePromise, () => instances[0]?.releaseLoad());

    expect({
      ...observed,
      constructed: instances.length,
      abortCalls: instances.reduce((sum, instance) => sum + instance.abortCalls, 0),
      sendCalls: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      unhandled: capturedUnhandled(),
    }).toEqual({
      prompt: true,
      outcome: { kind: 'rejected', code: 'ABORT_ERR', errno: -1025 },
      constructed: 1,
      abortCalls: 1,
      sendCalls: 1,
      unhandled: [],
    });
  });

  it('XE-SC no signal dispatches once, never aborts, and fulfills normally', async () => {
    fakeOutcome = { kind: 'load', status: 200, statusText: 'OK', body: 'ok' };
    const outcome = await captureOutcome(
      executeXHRRequest(baseRequest(), DEFAULTS, new RezoCookieJar()),
    );
    await delay(0);

    expect({
      outcome,
      constructed: instances.length,
      abortCalls: instances.reduce((sum, instance) => sum + instance.abortCalls, 0),
      sendCalls: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      loadCalls: instances.reduce((sum, instance) => sum + instance.loadCalls, 0),
      unhandled: capturedUnhandled(),
    }).toEqual({
      outcome: { kind: 'fulfilled', status: 200 },
      constructed: 1,
      abortCalls: 0,
      sendCalls: 1,
      loadCalls: 1,
      unhandled: [],
    });
  });
});
