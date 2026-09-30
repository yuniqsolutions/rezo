import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import type { RezoDefaultOptions } from '../src/types/options';
import type { RezoRequestConfig } from '../src/types/rezo-request';

interface ErrorShape {
  readonly code?: string;
  readonly errno?: number;
}

interface CapturedOutcome {
  readonly kind: 'fulfilled' | 'rejected';
  readonly code?: string;
  readonly errno?: number;
}

const SOURCE_URL = 'http://xhr-retry-ownership.rezo.test/resource';
const PROMPT_WINDOW_MS = 60;
const RETRY_DELAY_MS = 160;

const instances: RetryXMLHttpRequest[] = [];
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

class RetryXMLHttpRequest {
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

  abortCalls = 0;
  sendCalls = 0;

  #url = '';
  #terminal = false;
  #scheduled?: ReturnType<typeof setTimeout>;

  constructor() {
    instances.push(this);
  }

  open(_method: string, url: string): void {
    this.#url = url;
    this.readyState = 1;
  }

  setRequestHeader(): void {}

  getAllResponseHeaders(): string {
    return 'content-type: text/plain\r\ncontent-length: 11\r\n';
  }

  getResponseHeader(name: string): string | null {
    const normalized = name.toLowerCase();
    if (normalized === 'content-type') return 'text/plain';
    if (normalized === 'content-length') return '11';
    return null;
  }

  send(): void {
    this.sendCalls += 1;
    if (this.#terminal) return;
    this.#scheduled = schedule(() => {
      if (this.#terminal) return;
      this.#terminal = true;
      this.status = 503;
      this.statusText = 'Service Unavailable';
      this.response = 'unavailable';
      this.responseText = 'unavailable';
      this.responseURL = this.#url;
      this.readyState = 4;
      this.onreadystatechange?.();
      this.onload?.();
    }, 1);
  }

  abort(): void {
    this.abortCalls += 1;
    if (this.#terminal) return;
    this.#terminal = true;
    if (this.#scheduled !== undefined) {
      clearTimeout(this.#scheduled);
      openTimers.delete(this.#scheduled);
      this.#scheduled = undefined;
    }
    queueMicrotask(() => this.onabort?.());
  }

  dispose(): void {
    if (this.#scheduled !== undefined) {
      clearTimeout(this.#scheduled);
      openTimers.delete(this.#scheduled);
      this.#scheduled = undefined;
    }
  }
}

const priorXHRDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
Object.defineProperty(globalThis, 'XMLHttpRequest', {
  configurable: true,
  enumerable: priorXHRDescriptor?.enumerable ?? false,
  value: RetryXMLHttpRequest,
  writable: true,
});

const { executeRequest: executeXHRRequest } = await import('../src/adapters/xhr');

beforeEach(() => {
  instances.length = 0;
});

afterEach(() => {
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

function baseRequest(): RezoRequestConfig {
  return {
    url: SOURCE_URL,
    method: 'GET',
    responseType: 'text',
    cache: false,
    timeout: 0,
  };
}

async function captureOutcome(promise: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    await promise;
    return { kind: 'fulfilled' };
  } catch (error) {
    const caught = error as ErrorShape;
    return { kind: 'rejected', code: caught.code, errno: caught.errno };
  }
}

async function observePromptSettlement(
  promise: Promise<CapturedOutcome>,
): Promise<{ readonly prompt: boolean; readonly outcome?: CapturedOutcome }> {
  const sentinel = Symbol('prompt-window');
  const first = await Promise.race([
    promise,
    delay(PROMPT_WINDOW_MS).then(() => sentinel),
  ]);
  return first === sentinel
    ? { prompt: false }
    : { prompt: true, outcome: first };
}

const DEFAULTS: RezoDefaultOptions = {};

describe('XHR retry ownership and caller-abort dominance', () => {
  it('XE-R1 custom condition remains bounded by maxRetries', async () => {
    let conditionCalls = 0;
    let retryCalls = 0;
    let exhaustedCalls = 0;
    const request: RezoRequestConfig = {
      ...baseRequest(),
      retry: {
        maxRetries: 1,
        retryDelay: 0,
        condition: () => {
          conditionCalls += 1;
          return true;
        },
        onRetry: () => {
          retryCalls += 1;
          return true;
        },
        onRetryExhausted: () => {
          exhaustedCalls += 1;
        },
      },
    };

    const outcome = await captureOutcome(
      executeXHRRequest(request, DEFAULTS, new RezoCookieJar()),
    );

    expect({
      outcome,
      instances: instances.length,
      sends: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      conditionCalls,
      retryCalls,
      exhaustedCalls,
    }).toEqual({
      outcome: { kind: 'rejected', code: 'REZ_HTTP_ERROR', errno: -1031 },
      instances: 2,
      sends: 2,
      conditionCalls: 1,
      retryCalls: 1,
      exhaustedCalls: 1,
    });
  });

  it('XE-R2 caller abort wins while custom retry condition is pending', async () => {
    const controller = new AbortController();
    let conditionCalls = 0;
    const neverSettles = new Promise<boolean>(() => undefined);
    const request: RezoRequestConfig = {
      ...baseRequest(),
      signal: controller.signal,
      retry: {
        maxRetries: 1,
        retryDelay: 0,
        condition: () => {
          conditionCalls += 1;
          controller.abort();
          return neverSettles;
        },
      },
    };
    const outcomePromise = captureOutcome(
      executeXHRRequest(request, DEFAULTS, new RezoCookieJar()),
    );
    const observed = await observePromptSettlement(outcomePromise);

    expect({
      ...observed,
      instances: instances.length,
      sends: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      aborts: instances.reduce((sum, instance) => sum + instance.abortCalls, 0),
      conditionCalls,
    }).toEqual({
      prompt: true,
      outcome: { kind: 'rejected', code: 'ABORT_ERR', errno: -1025 },
      instances: 1,
      sends: 1,
      aborts: 0,
      conditionCalls: 1,
    });
  });

  it('XE-R3 caller abort interrupts retry delay without redispatch', async () => {
    const controller = new AbortController();
    let retryCalls = 0;
    const request: RezoRequestConfig = {
      ...baseRequest(),
      signal: controller.signal,
      retry: {
        maxRetries: 1,
        retryDelay: RETRY_DELAY_MS,
        onRetry: () => {
          retryCalls += 1;
          schedule(() => controller.abort(), 10);
          return true;
        },
      },
    };
    const outcomePromise = captureOutcome(
      executeXHRRequest(request, DEFAULTS, new RezoCookieJar()),
    );
    const observed = await observePromptSettlement(outcomePromise);

    expect({
      ...observed,
      instances: instances.length,
      sends: instances.reduce((sum, instance) => sum + instance.sendCalls, 0),
      retryCalls,
    }).toEqual({
      prompt: true,
      outcome: { kind: 'rejected', code: 'ABORT_ERR', errno: -1025 },
      instances: 1,
      sends: 1,
      retryCalls: 1,
    });
  });
});
