/**
 * Phase 2b supplemental closure gates — S-STREAM / S-PROVIDER / S-TYPED /
 * S-CURL, per the CO-SIGNED plan pair (README `9469b90c…`, plan `9bfae6bd…`,
 * Tayo EXACT CO-SIGN 16:57:53Z) and Engineer DECISION-112 ("Approve
 * test-only RED", 17:04:07Z). The frozen 40-row file `7c9ea4b3…` is
 * untouched; this file is SEPARATE and additive.
 *
 * Denominator: 33 rows + ONE separately-labelled NON-ROW postscript block
 * (the four XHR pre-dispatch attachment scenarios; outside the 33-row
 * count) = 34 vitest tests total.
 *
 * Expected 2b-RED baseline (authoritative split, Tayo-measured, v20 pair):
 *   rows 28 RED / 5 GREEN — green = SS2b, SS4, SPs-e, SPd-e, SPu-e;
 *   postscript block RED (all four scenarios silently resolve on the live
 *   repo today). A delta returns to the plan gate before this file freezes.
 *
 * Contracts under test (DECISION-106/107 + captain rulings):
 * - Stream (RN visible streamTransport lane): redirect-class is 3xx
 *   EXCLUDING 304; zero denial (-1032 + maxRedirectsReached) precedes ALL
 *   Location inspection; resolved followRedirects:false settles the
 *   untouched source 3xx on the SAME returned stream; 304 always settles
 *   ordinarily (-1031 under the default validator).
 * - Provider-hidden lanes (react-native-stock-fetch /
 *   react-native-file-download / react-native-file-upload): a resolved
 *   followRedirects:false or maxRedirects:0 — request OR instance level —
 *   refuses REZ_UNSUPPORTED_CAPABILITY (-1075) BEFORE dispatch; ALL THREE
 *   lane counters are asserted on EVERY row (own per signature; unrelated
 *   ZERO).
 * - Typed source responses: every RN/XHR settle error (-1028/-1009/
 *   -1031/-1032) attaches ONE complete typed RezoResponse — all ten own
 *   properties, the five Cookies members (own-property AND value), config
 *   present-object identity, the carrier link
 *   error.config.originalRequest === error.request, finalUrl === SOURCE,
 *   first-hop urls === [SOURCE]. ST3/ST7/ST10 execute BOTH a sub-400 (304)
 *   and a >=400 (404) case, non-short-circuit.
 * - cURL composition: -1075 guarantee refusal fires ONLY while following
 *   remains enabled; resolved false skips the callback and settles the
 *   source 302 (SC1); zero denies -1032 with callback 0 (SC2, RULED).
 *
 * Fixture notes:
 * - XHR: src/adapters/xhr.ts:62 captures `hasXHR` at MODULE LOAD — the fake
 *   XMLHttpRequest below installs before the dynamic entry imports (same
 *   pattern as the frozen file).
 * - RN stock-fetch: Environment.isReactNative is a LIVE GETTER reading
 *   navigator.product at call time; the helper below saves the original
 *   PROPERTY DESCRIPTOR and restores in `finally` — defineProperty when a
 *   descriptor existed, delete-own-property when it did not.
 * - Typing: this file adds zero banned loose-typing escapes. Loose seams
 *   are crossed with named structural interfaces plus `unknown` narrowing
 *   (TestClient / TestRequestOptions / CapturedOutcome below).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type {
  RezoReactNativeFileDownloadRequest,
  RezoReactNativeFileDownloadResult,
  RezoReactNativeFileUploadRequest,
  RezoReactNativeFileUploadResult,
  RezoReactNativeOptions,
  RezoReactNativeStreamRequest,
  RezoReactNativeStreamResult,
} from '../src/types/react-native';
import type { InternalResponseType } from '../src/types/rezo-request';

// ---------------------------------------------------------------------------
// Typed test seams (zero banned loose-typing escapes)
// ---------------------------------------------------------------------------
interface TestRequestOptions {
  url: string;
  method?: string;
  timeout?: number;
  retry?: boolean;
  followRedirects?: boolean;
  maxRedirects?: number;
  validateStatus?: ((status: number) => boolean) | null;
  saveTo?: string;
  responseType?: InternalResponseType;
  reactNative?: RezoReactNativeOptions;
  onRedirect?: () => boolean;
}

interface TestClient {
  request(options: TestRequestOptions): Promise<unknown>;
  get(url: string, options?: Omit<TestRequestOptions, 'url'>): Promise<unknown>;
  create(defaults: Partial<TestRequestOptions>): TestClient;
}

interface TestErrorCookies {
  array?: unknown;
  serialized?: unknown;
  netscape?: unknown;
  string?: unknown;
  setCookiesString?: unknown;
}

interface TestErrorResponse {
  data?: unknown;
  status?: unknown;
  statusText?: unknown;
  finalUrl?: unknown;
  cookies?: TestErrorCookies;
  headers?: unknown;
  contentType?: unknown;
  contentLength?: unknown;
  urls?: unknown;
  config?: unknown;
}

interface TestErrorConfig {
  maxRedirectsReached?: boolean;
  originalRequest?: unknown;
  url?: string;
  finalUrl?: string;
}

interface CapturedOutcome {
  __resolved?: true;
  value?: unknown;
  code?: string;
  errno?: number;
  message?: string;
  config?: TestErrorConfig;
  request?: { fullUrl?: unknown; url?: unknown };
  response?: TestErrorResponse;
}

async function rejection(promise: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    const value = await promise;
    return { __resolved: true, value };
  } catch (error) {
    return error as CapturedOutcome;
  }
}

// ---------------------------------------------------------------------------
// XHR fake (module scope, BEFORE entry imports — xhr.ts:62 load capture)
// ---------------------------------------------------------------------------
type XHRScenario = { status: number; statusText?: string; headers: string; body?: string; responseURL?: string };
let xhrSends = 0;
let xhrScenario: XHRScenario = { status: 200, headers: '' };

class FakeXMLHttpRequest {
  readyState = 0; status = 0; statusText = '';
  response: unknown = ''; responseText = ''; responseURL = '';
  responseType = ''; timeout = 0; withCredentials = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: unknown) => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  upload = { onprogress: null as ((event: unknown) => void) | null };
  #url = '';
  open(_method: string, url: string) { this.#url = url; this.readyState = 1; }
  setRequestHeader() {}
  getAllResponseHeaders() { return xhrScenario.headers; }
  getResponseHeader(name: string) {
    const line = xhrScenario.headers.split('\r\n').find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    return line ? line.split(':').slice(1).join(':').trim() : null;
  }
  abort() { this.onabort?.(); }
  send() {
    xhrSends += 1;
    setTimeout(() => {
      this.status = xhrScenario.status;
      this.statusText = xhrScenario.statusText ?? String(xhrScenario.status);
      this.responseText = xhrScenario.body ?? '';
      this.response = xhrScenario.body ?? '';
      this.responseURL = xhrScenario.responseURL ?? this.#url;
      this.readyState = 4;
      this.onreadystatechange?.();
      this.onload?.();
    }, 5);
  }
}
(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXMLHttpRequest;

const rnClient = (await import('../src/adapters/entries/react-native')).default as unknown as TestClient;
const xhrClient = (await import('../src/adapters/entries/xhr')).default as unknown as TestClient;
const curlClient = (await import('../src/adapters/entries/curl')).default as unknown as TestClient;

const REDIRECT_CODES = [
  'REZ_MISSING_REDIRECT_LOCATION',
  'REZ_REDIRECT_DENIED',
  'REZ_MAX_REDIRECTS_EXCEEDED',
  'REZ_REDIRECT_CYCLE_DETECTED',
] as const;

// Unhandled-rejection ledger (house standard): every row requires it empty.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.removeListener('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

// Descriptor-managed navigator.product (pinned rule: defineProperty when a
// saved descriptor exists; delete the temporary own property when it did
// not; always in finally).
async function withReactNativeNavigator<T>(fn: () => Promise<T>): Promise<T> {
  const globalCarrier = globalThis as { navigator?: Record<string, unknown> };
  const hadNavigator = 'navigator' in globalThis;
  const target: Record<string, unknown> = globalCarrier.navigator ?? {};
  if (!hadNavigator) globalCarrier.navigator = target;
  const saved = Object.getOwnPropertyDescriptor(target, 'product');
  Object.defineProperty(target, 'product', { value: 'ReactNative', configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (saved) Object.defineProperty(target, 'product', saved);
    else delete target.product;
    if (!hadNavigator) delete globalCarrier.navigator;
  }
}

// ---------------------------------------------------------------------------
// RN buffered fake fetch (global read at call time)
// ---------------------------------------------------------------------------
type RNScenario = (url: string) => { status: number; headers: Record<string, string>; body?: string };
const rnCalls: string[] = [];
let rnScenario: RNScenario = () => ({ status: 200, headers: {} });

class FakeFetchResponse {
  status: number; statusText: string; headers: Headers; url = '';
  #body: string;
  constructor(status: number, headers: Record<string, string>, body = '') {
    this.status = status;
    this.statusText = status === 302 ? 'Found' : status === 304 ? 'Not Modified' : status === 404 ? 'Not Found' : 'OK';
    this.headers = new Headers(headers);
    this.#body = body;
  }
  async text() { return this.#body; }
  async json() { return this.#body ? JSON.parse(this.#body) : null; }
  async arrayBuffer() { return new TextEncoder().encode(this.#body).buffer; }
  async blob() { return new Blob([this.#body]); }
  get body() { return null; }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return this; }
}

const RN_BASE = 'http://phase2b.test';
const realFetch = globalThis.fetch;
function installRnFetch(): void {
  const fakeFetch = async (url: string | URL) => {
    const value = String(url);
    rnCalls.push(value);
    const s = rnScenario(value);
    return new FakeFetchResponse(s.status, s.headers, s.body ?? '');
  };
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
}
function restoreRnFetch(): void {
  globalThis.fetch = realFetch;
}

const rnGet = (req: Partial<TestRequestOptions>) =>
  rnClient.request({ url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false, ...req });

// Ten own properties + five Cookies members (own-property AND value) +
// present-object config identity + carrier link (v20 non-vacuity).
function assertTypedSourceResponse(error: CapturedOutcome, expected: { status: number; sourceUrl: string }) {
  expect(error?.response, 'typed source response attached').toBeTruthy();
  const resp = error.response as TestErrorResponse;
  const fields = ['data', 'status', 'statusText', 'finalUrl', 'cookies', 'headers', 'contentType', 'contentLength', 'urls', 'config'] as const;
  for (const field of fields) {
    expect(Object.prototype.hasOwnProperty.call(resp, field), `own property "${field}"`).toBe(true);
  }
  expect(resp.status).toBe(expected.status);
  const cookieMembers = ['array', 'serialized', 'netscape', 'string', 'setCookiesString'] as const;
  const cookieCarrier: TestErrorCookies = resp.cookies ?? {};
  for (const member of cookieMembers) {
    expect(Object.prototype.hasOwnProperty.call(cookieCarrier, member), `cookies own property "${member}"`).toBe(true);
    expect(cookieCarrier[member], `cookies.${member} value`).toBeDefined();
  }
  // Anti-vacuity: identity may not be satisfied by two undefineds — both
  // sides must be present objects BEFORE the identity check.
  expect(!!resp.config && typeof resp.config === 'object', 'response.config is a present object').toBe(true);
  expect(!!error.config && typeof error.config === 'object', 'error.config is a present object').toBe(true);
  expect(!!error.request && typeof error.request === 'object', 'error.request is a present object').toBe(true);
  expect(resp.config === error.config, 'response.config === error.config').toBe(true);
  expect(
    error.config?.originalRequest === error.request,
    'carrier link: error.config.originalRequest === error.request (both sides proven present above)',
  ).toBe(true);
  expect(resp.finalUrl, 'finalUrl reflects the SOURCE').toBe(expected.sourceUrl);
  expect(resp.urls, 'first-hop urls === [SOURCE]').toEqual([expected.sourceUrl]);
}

// ---------------------------------------------------------------------------
// S-STREAM — RN visible streamTransport lane (SS1, SS2a-c, SS3, SS4)
// ---------------------------------------------------------------------------
interface TestStreamEmitter {
  on?(event: string, listener: (...args: never[]) => void): unknown;
}

describe('S-STREAM — RN stream-path redirect policy', () => {
  type StreamHop = { status: number; headers: Record<string, string>; body?: string };
  const transportHits: string[] = [];
  let streamScenario: (url: string) => StreamHop = () => ({ status: 200, headers: {} });

  const fakeTransport = {
    name: 'phase2b-fake-transport',
    async stream(request: RezoReactNativeStreamRequest): Promise<RezoReactNativeStreamResult> {
      transportHits.push(request.url);
      const hop = streamScenario(request.url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await request.onHeaders?.({
        status: hop.status,
        statusText: String(hop.status),
        headers: hop.headers,
        contentType: 'text/plain',
        contentLength: (hop.body ?? '').length,
      });
      if (hop.body) await request.onChunk?.(hop.body);
      return { status: hop.status, statusText: String(hop.status), headers: hop.headers };
    },
  };

  beforeEach(() => { transportHits.length = 0; });

  type StreamOutcome = {
    settled: 'resolved' | 'rejected';
    error?: CapturedOutcome;
    statusEvents: number[];
    headersEvents: number;
    finishEvents: number;
    doneEvents: number;
    errorEvents: unknown[];
  };

  async function runStream(req: Partial<TestRequestOptions>): Promise<StreamOutcome> {
    const outcome: StreamOutcome = { settled: 'resolved', statusEvents: [], headersEvents: 0, finishEvents: 0, doneEvents: 0, errorEvents: [] };
    try {
      const stream = (await rnClient.request({
        url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false,
        responseType: 'stream',
        reactNative: { streamTransport: fakeTransport },
        ...req,
      })) as TestStreamEmitter;
      stream.on?.('status', (status: number) => { outcome.statusEvents.push(status); });
      stream.on?.('headers', () => { outcome.headersEvents += 1; });
      stream.on?.('finish', () => { outcome.finishEvents += 1; });
      stream.on?.('done', () => { outcome.doneEvents += 1; });
      stream.on?.('error', (streamError: unknown) => { outcome.errorEvents.push(streamError); });
      await new Promise((resolve) => setTimeout(resolve, 60));
    } catch (error) {
      outcome.settled = 'rejected';
      outcome.error = error as CapturedOutcome;
    }
    return outcome;
  }

  // Total error deliveries across BOTH channels (rejection + 'error' events):
  // duplicate delivery is a defect the rows must catch.
  function totalErrorDeliveries(outcome: StreamOutcome): number {
    return (outcome.settled === 'rejected' ? 1 : 0) + outcome.errorEvents.length;
  }

  function firstError(outcome: StreamOutcome): CapturedOutcome | undefined {
    return outcome.settled === 'rejected' ? outcome.error : (outcome.errorEvents[0] as CapturedOutcome | undefined);
  }

  const malformedThenFinal: (url: string) => StreamHop = (u) =>
    u.endsWith('/start') ? { status: 302, headers: { location: 'http://[' } } : { status: 200, headers: {}, body: 'FINAL' };
  const validRedirect: (url: string) => StreamHop = (u) =>
    u.endsWith('/start') ? { status: 302, headers: { location: `${RN_BASE}/destination` } } : { status: 200, headers: {}, body: 'FINAL' };

  it('SS1 — stream false + 302 (malformed Location) settles the untouched 302 on the same stream: one transport invocation; status ×1; headers ×1; finish ×1; done ×1; error 0', async () => {
    streamScenario = malformedThenFinal;
    const outcome = await runStream({ followRedirects: false });
    expect(outcome.settled).toBe('resolved');
    expect(transportHits).toHaveLength(1);
    expect(outcome.statusEvents).toEqual([302]);
    expect(outcome.headersEvents).toBe(1);
    expect(outcome.finishEvents, 'finish exactly once').toBe(1);
    expect(outcome.doneEvents, 'done exactly once').toBe(1);
    expect(totalErrorDeliveries(outcome), 'error deliveries = 0').toBe(0);
  });

  it('SS2a — stream zero + 302, Location ABSENT: typed -1032 + maxRedirectsReached BEFORE Location inspection; one transport invocation; exactly one error; NO finish/done', async () => {
    streamScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: {} } : { status: 200, headers: {} });
    const outcome = await runStream({ maxRedirects: 0 });
    const error = firstError(outcome);
    expect(error?.code).toBe('REZ_REDIRECT_DENIED');
    expect(error?.errno).toBe(-1032);
    expect(error?.config?.maxRedirectsReached).toBe(true);
    expect(transportHits).toHaveLength(1);
    expect(outcome.finishEvents + outcome.doneEvents, 'NO finish/done').toBe(0);
    expect(totalErrorDeliveries(outcome), 'exactly one error delivery').toBe(1);
  });

  it('SS2b — stream zero + 302, Location PRESENT (valid): same -1032 contract; destination transport hits ZERO', async () => {
    streamScenario = validRedirect;
    const outcome = await runStream({ maxRedirects: 0 });
    const error = firstError(outcome);
    expect(error?.code).toBe('REZ_REDIRECT_DENIED');
    expect(error?.errno).toBe(-1032);
    expect(error?.config?.maxRedirectsReached).toBe(true);
    expect(transportHits).toHaveLength(1);
    expect(transportHits.filter((u) => u.includes('/destination'))).toHaveLength(0);
    expect(outcome.finishEvents + outcome.doneEvents, 'NO finish/done').toBe(0);
    expect(totalErrorDeliveries(outcome), 'exactly one error delivery').toBe(1);
  });

  it('SS2c — stream zero + 302, Location MALFORMED: same -1032 contract — never -1009; parse never attempted', async () => {
    streamScenario = malformedThenFinal;
    const outcome = await runStream({ maxRedirects: 0 });
    const error = firstError(outcome);
    expect(error?.code).toBe('REZ_REDIRECT_DENIED');
    expect(error?.errno).toBe(-1032);
    expect(error?.config?.maxRedirectsReached, 'zero-denial flag applies to the malformed variant too').toBe(true);
    expect(error?.code).not.toBe('ERR_INVALID_URL');
    expect(transportHits).toHaveLength(1);
    expect(outcome.finishEvents + outcome.doneEvents, 'NO finish/done').toBe(0);
    expect(totalErrorDeliveries(outcome), 'exactly one error delivery').toBe(1);
  });

  it('SS3 — stream DEFAULT + 304+Location: ordinary -1031; one transport invocation; never followed; exactly one error; NO finish/done', async () => {
    streamScenario = (u) =>
      u.endsWith('/start') ? { status: 304, headers: { location: `${RN_BASE}/destination` } } : { status: 200, headers: {} };
    const outcome = await runStream({});
    const error = firstError(outcome);
    expect(error?.code).toBe('REZ_HTTP_ERROR');
    expect(error?.errno).toBe(-1031);
    expect(REDIRECT_CODES).not.toContain(error?.code);
    expect(transportHits).toHaveLength(1);
    expect(transportHits.filter((u) => u.includes('/destination'))).toHaveLength(0);
    expect(outcome.finishEvents + outcome.doneEvents, 'NO finish/done').toBe(0);
    expect(totalErrorDeliveries(outcome), 'exactly one error delivery').toBe(1);
  });

  it('SS4 — stream plain 302 follow (control): exactly two transport invocations with per-path attribution; status ×1; headers ×1; finish ×1; done ×1; error 0', async () => {
    streamScenario = validRedirect;
    const outcome = await runStream({});
    expect(outcome.settled).toBe('resolved');
    expect(transportHits).toHaveLength(2);
    expect(transportHits.filter((u) => u.endsWith('/start'))).toHaveLength(1);
    expect(transportHits.filter((u) => u.includes('/destination'))).toHaveLength(1);
    expect(outcome.statusEvents).toEqual([200]);
    expect(outcome.headersEvents).toBe(1);
    expect(outcome.finishEvents, 'finish exactly once').toBe(1);
    expect(outcome.doneEvents, 'done exactly once').toBe(1);
    expect(totalErrorDeliveries(outcome), 'error deliveries = 0').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S-PROVIDER — the three enumerated hidden lanes (15 rows). ALL THREE lane
// counters are captured and asserted on EVERY row (v20: own counter per
// signature; every unrelated provider/fetch counter ZERO).
// ---------------------------------------------------------------------------
const providerDownloadCalls: string[] = [];
const providerUploadCalls: string[] = [];
const sharedProviderFS = {
  name: 'phase2b-shared-fs',
  capabilities: { fileDownload: true, uploadFromFile: true },
  async downloadFile(request: RezoReactNativeFileDownloadRequest): Promise<RezoReactNativeFileDownloadResult> {
    providerDownloadCalls.push(request.url);
    await request.onHeaders?.({ status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, contentLength: 5 });
    return { status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, filePath: request.destination, fileSize: 5 };
  },
  async uploadFile(request: RezoReactNativeFileUploadRequest): Promise<RezoReactNativeFileUploadResult> {
    providerUploadCalls.push(request.url);
    return { status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, uploadSize: 5, fileName: 'u.bin', body: 'ok' };
  },
};

// Tri-lane ledger assertion — stock fetch / downloadFile / uploadFile.
function expectLaneLedger(expected: { stock: number; download: number; upload: number }, label: string) {
  expect(rnCalls.length, `${label}: stock-fetch counter`).toBe(expected.stock);
  expect(providerDownloadCalls.length, `${label}: downloadFile counter`).toBe(expected.download);
  expect(providerUploadCalls.length, `${label}: uploadFile counter`).toBe(expected.upload);
}

function resetLaneLedgers(): void {
  rnCalls.length = 0;
  providerDownloadCalls.length = 0;
  providerUploadCalls.length = 0;
}

describe('S-PROVIDER — react-native-stock-fetch lane', () => {
  beforeAll(installRnFetch);
  afterAll(restoreRnFetch);
  beforeEach(() => { resetLaneLedgers(); rnScenario = () => ({ status: 200, headers: {}, body: 'FINAL' }); });

  const stockGet = (req: Partial<TestRequestOptions>, instanceDefaults?: Partial<TestRequestOptions>) =>
    withReactNativeNavigator(async () => {
      const client = instanceDefaults ? rnClient.create(instanceDefaults) : rnClient;
      return rejection(client.request({ url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false, ...req }));
    });

  it('SPs-a — request followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await stockGet({ followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPs-a');
  });

  it('SPs-b — request maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await stockGet({ maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPs-b');
  });

  it('SPs-c — instance-default followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await stockGet({}, { followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPs-c');
  });

  it('SPs-d — instance-default maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await stockGet({}, { maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPs-d');
  });

  it('SPs-e — no policy options (reachable control): lane vector exactly [1,0,0]; resolves', async () => {
    const outcome = await stockGet({});
    expect(outcome.__resolved).toBe(true);
    expect((outcome.value as { status?: number } | undefined)?.status).toBe(200);
    expectLaneLedger({ stock: 1, download: 0, upload: 0 }, 'SPs-e');
  });
});

describe('S-PROVIDER — react-native-file-download lane', () => {
  beforeAll(installRnFetch);
  afterAll(restoreRnFetch);
  beforeEach(() => { resetLaneLedgers(); });

  const downloadReq = (req: Partial<TestRequestOptions>, instanceDefaults?: Partial<TestRequestOptions>) => {
    const client = instanceDefaults ? rnClient.create(instanceDefaults) : rnClient;
    return rejection(client.request({
      url: `${RN_BASE}/file.bin`, method: 'GET', timeout: 8000, retry: false,
      saveTo: '/tmp/phase2b-download.bin',
      reactNative: { fileSystemAdapter: sharedProviderFS },
      ...req,
    }));
  };

  it('SPd-a — request followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await downloadReq({ followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPd-a');
  });

  it('SPd-b — request maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await downloadReq({ maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPd-b');
  });

  it('SPd-c — instance-default followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await downloadReq({}, { followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPd-c');
  });

  it('SPd-d — instance-default maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await downloadReq({}, { maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPd-d');
  });

  it('SPd-e — no policy options (reachable control): lane vector exactly [0,1,0]', async () => {
    const outcome = await downloadReq({});
    expect(outcome.__resolved).toBe(true);
    expectLaneLedger({ stock: 0, download: 1, upload: 0 }, 'SPd-e');
  });
});

describe('S-PROVIDER — react-native-file-upload lane', () => {
  beforeAll(installRnFetch);
  afterAll(restoreRnFetch);
  beforeEach(() => { resetLaneLedgers(); });

  const uploadReq = (req: Partial<TestRequestOptions>, instanceDefaults?: Partial<TestRequestOptions>) => {
    const client = instanceDefaults ? rnClient.create(instanceDefaults) : rnClient;
    return rejection(client.request({
      url: `${RN_BASE}/upload`, method: 'POST', timeout: 8000, retry: false,
      responseType: 'upload',
      reactNative: { fileSystemAdapter: sharedProviderFS, upload: { enabled: true, uri: 'file:///tmp/phase2b-u.bin', name: 'u.bin' } },
      ...req,
    }));
  };

  it('SPu-a — request followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await uploadReq({ followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPu-a');
  });

  it('SPu-b — request maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await uploadReq({ maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPu-b');
  });

  it('SPu-c — instance-default followRedirects:false refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await uploadReq({}, { followRedirects: false });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPu-c');
  });

  it('SPu-d — instance-default maxRedirects:0 refuses -1075 pre-dispatch; all three lane counters ZERO', async () => {
    const error = await uploadReq({}, { maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expectLaneLedger({ stock: 0, download: 0, upload: 0 }, 'SPu-d');
  });

  it('SPu-e — no policy options (reachable control): lane vector exactly [0,0,1]', async () => {
    const outcome = await uploadReq({});
    expect(outcome.__resolved).toBe(true);
    expectLaneLedger({ stock: 0, download: 0, upload: 1 }, 'SPu-e');
  });
});

// ---------------------------------------------------------------------------
// S-TYPED — complete typed source responses (ST1-ST10; 13 settle-case
// executions) + the NON-ROW XHR pre-dispatch attachment postscript block
// ---------------------------------------------------------------------------
describe('S-TYPED — RN buffered settle errors attach complete typed source responses', () => {
  beforeAll(installRnFetch);
  afterAll(restoreRnFetch);
  beforeEach(() => { rnCalls.length = 0; });

  const SOURCE = `${RN_BASE}/start`;

  it('ST1 — RN buffered -1028 (302 without Location) attaches the complete typed source response', async () => {
    rnScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: {} } : { status: 200, headers: {} });
    const error = await rejection(rnGet({}));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });

  it('ST2 — RN buffered -1009 (malformed Location) attaches the complete typed source response', async () => {
    rnScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: { location: 'http://[' } } : { status: 200, headers: {} });
    const error = await rejection(rnGet({}));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('ERR_INVALID_URL');
    expect(error.errno).toBe(-1009);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });

  it('ST3 — RN buffered -1031 DUAL SITE: sub-400 (304+Location, false) AND >=400 (404) both attach complete typed responses (non-short-circuit)', async () => {
    rnScenario = () => ({ status: 304, headers: { location: `${RN_BASE}/forbidden` } });
    const notModified = await rejection(rnGet({ followRedirects: false }));
    rnScenario = () => ({ status: 404, headers: {}, body: 'not found' });
    const notFound = await rejection(rnGet({}));
    // Both executed above; both asserted below — R10/X5 pattern.
    expect([notModified.code, notFound.code]).toEqual(['REZ_HTTP_ERROR', 'REZ_HTTP_ERROR']);
    expect([notModified.errno, notFound.errno]).toEqual([-1031, -1031]);
    assertTypedSourceResponse(notModified, { status: 304, sourceUrl: SOURCE });
    assertTypedSourceResponse(notFound, { status: 404, sourceUrl: SOURCE });
  });

  it('ST4 — RN buffered -1032 (maxRedirects:0 + 302) attaches the complete typed source response', async () => {
    rnScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: { location: `${RN_BASE}/forbidden` } } : { status: 200, headers: {} });
    const error = await rejection(rnGet({ maxRedirects: 0 }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });
});

describe('S-TYPED — RN stream settle errors attach complete typed source responses', () => {
  type StreamHop = { status: number; headers: Record<string, string>; body?: string };
  const transportHits: string[] = [];
  let streamScenario: (url: string) => StreamHop = () => ({ status: 200, headers: {} });
  const fakeTransport = {
    name: 'phase2b-fake-transport-st',
    async stream(request: RezoReactNativeStreamRequest): Promise<RezoReactNativeStreamResult> {
      transportHits.push(request.url);
      const hop = streamScenario(request.url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await request.onHeaders?.({ status: hop.status, statusText: String(hop.status), headers: hop.headers });
      return { status: hop.status, statusText: String(hop.status), headers: hop.headers };
    },
  };
  beforeEach(() => { transportHits.length = 0; });

  const SOURCE = `${RN_BASE}/start`;

  async function streamError(req: Partial<TestRequestOptions>): Promise<CapturedOutcome> {
    try {
      const stream = (await rnClient.request({
        url: SOURCE, method: 'GET', timeout: 8000, retry: false,
        responseType: 'stream', reactNative: { streamTransport: fakeTransport }, ...req,
      })) as TestStreamEmitter;
      const captured: unknown[] = [];
      stream.on?.('error', (streamErr: unknown) => { captured.push(streamErr); });
      await new Promise((resolve) => setTimeout(resolve, 60));
      return (captured[0] as CapturedOutcome | undefined) ?? { __resolved: true };
    } catch (error) {
      return error as CapturedOutcome;
    }
  }

  it('ST5 — RN stream -1028 (302 without Location while following) attaches the complete typed source response', async () => {
    streamScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: {} } : { status: 200, headers: {} });
    const error = await streamError({});
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });

  it('ST6 — RN stream -1009 (malformed Location while following) attaches the complete typed source response', async () => {
    streamScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: { location: 'http://[' } } : { status: 200, headers: {} });
    const error = await streamError({});
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('ERR_INVALID_URL');
    expect(error.errno).toBe(-1009);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });

  it('ST7 — RN stream -1031 DUAL SITE: sub-400 (304+Location, default) AND >=400 (404) both attach complete typed responses (non-short-circuit)', async () => {
    streamScenario = () => ({ status: 304, headers: { location: `${RN_BASE}/forbidden` } });
    const notModified = await streamError({});
    streamScenario = () => ({ status: 404, headers: {} });
    const notFound = await streamError({});
    expect([notModified.code, notFound.code]).toEqual(['REZ_HTTP_ERROR', 'REZ_HTTP_ERROR']);
    expect([notModified.errno, notFound.errno]).toEqual([-1031, -1031]);
    assertTypedSourceResponse(notModified, { status: 304, sourceUrl: SOURCE });
    assertTypedSourceResponse(notFound, { status: 404, sourceUrl: SOURCE });
  });

  it('ST8 — RN stream -1032 (maxRedirects:0 + 302 with VALID Location) attaches the complete typed SOURCE response (source finalUrl/urls, never destination-valued)', async () => {
    streamScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: { location: `${RN_BASE}/destination` } } : { status: 200, headers: {} });
    const error = await streamError({ maxRedirects: 0 });
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });
});

describe('S-TYPED — XHR settle errors attach complete typed source responses', () => {
  beforeEach(() => { xhrSends = 0; });
  const SOURCE = 'http://xhr-phase2b.test/start';
  const xhrGet = (req: Partial<TestRequestOptions>) =>
    xhrClient.request({ url: SOURCE, method: 'GET', timeout: 8000, retry: false, ...req });

  it('ST9 — XHR -1028 (delivered terminal 302 without Location) attaches the complete typed source response', async () => {
    xhrScenario = { status: 302, statusText: 'Found', headers: '', responseURL: SOURCE };
    const error = await rejection(xhrGet({}));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    assertTypedSourceResponse(error, { status: 302, sourceUrl: SOURCE });
  });

  it('ST10 — XHR -1031 DUAL SITE: sub-400 (304+Location) AND >=400 (404) both attach complete typed responses (non-short-circuit)', async () => {
    xhrScenario = { status: 304, statusText: 'Not Modified', headers: 'location: http://xhr-phase2b.test/forbidden\r\n', responseURL: SOURCE };
    const notModified = await rejection(xhrGet({}));
    xhrScenario = { status: 404, statusText: 'Not Found', headers: '', body: 'not found', responseURL: SOURCE };
    const notFound = await rejection(xhrGet({}));
    expect([notModified.code, notFound.code]).toEqual(['REZ_HTTP_ERROR', 'REZ_HTTP_ERROR']);
    expect([notModified.errno, notFound.errno]).toEqual([-1031, -1031]);
    assertTypedSourceResponse(notModified, { status: 304, sourceUrl: SOURCE });
    assertTypedSourceResponse(notFound, { status: 404, sourceUrl: SOURCE });
  });

  it('NON-ROW postscript block (outside the 33-row denominator) — XHR pre-dispatch -1075 attachment: ALL FOUR scenarios execute non-short-circuit; aggregate labels/outcomes; exact attachment identities', async () => {
    xhrScenario = { status: 200, headers: '', body: 'FINAL' };
    const scenarios: Array<{ label: string; req: Partial<TestRequestOptions>; instance?: Partial<TestRequestOptions> }> = [
      { label: 'X1 request followRedirects:false', req: { followRedirects: false } },
      { label: 'X2 request maxRedirects:0', req: { maxRedirects: 0 } },
      { label: 'X7 instance followRedirects:false', req: {}, instance: { followRedirects: false } },
      { label: 'X8 instance maxRedirects:0', req: {}, instance: { maxRedirects: 0 } },
    ];
    // EXECUTE all four first — an expected failure on X1 must never prevent
    // X2/X7/X8 from executing (non-short-circuit, R10/X5 pattern).
    const outcomes: Array<{ label: string; error: CapturedOutcome }> = [];
    for (const scenario of scenarios) {
      const client = scenario.instance ? xhrClient.create(scenario.instance) : xhrClient;
      const error = await rejection(client.request({ url: SOURCE, method: 'GET', timeout: 8000, retry: false, ...scenario.req }));
      outcomes.push({ label: scenario.label, error });
    }
    const labels = outcomes.map((o) => o.label);
    expect(labels, 'all four scenarios executed, in order').toEqual([
      'X1 request followRedirects:false',
      'X2 request maxRedirects:0',
      'X7 instance followRedirects:false',
      'X8 instance maxRedirects:0',
    ]);
    // Aggregate assertions so every scenario's state is visible in one diff.
    expect(outcomes.map((o) => o.error.__resolved), 'each refuses pre-dispatch (no resolution)')
      .toEqual([undefined, undefined, undefined, undefined]);
    expect(outcomes.map((o) => o.error.code), 'each carries REZ_UNSUPPORTED_CAPABILITY')
      .toEqual(['REZ_UNSUPPORTED_CAPABILITY', 'REZ_UNSUPPORTED_CAPABILITY', 'REZ_UNSUPPORTED_CAPABILITY', 'REZ_UNSUPPORTED_CAPABILITY']);
    expect(
      outcomes.map((o) => !!o.error.request && typeof o.error.request === 'object'),
      'each attaches the dispatched carrier as request',
    ).toEqual([true, true, true, true]);
    expect(
      outcomes.map((o) => String(o.error.request?.fullUrl ?? o.error.request?.url).includes('xhr-phase2b.test')),
      'each request carries the dispatched URL identity',
    ).toEqual([true, true, true, true]);
    expect(
      outcomes.map((o) => !!o.error.config && typeof o.error.config === 'object'),
      'each attaches the live config object',
    ).toEqual([true, true, true, true]);
    expect(
      outcomes.map((o) =>
        !!o.error.request && typeof o.error.request === 'object'
        && o.error.config?.originalRequest === o.error.request),
      'each proves the exact carrier-link identity: config.originalRequest === error.request (presence-gated, never undefined===undefined)',
    ).toEqual([true, true, true, true]);
    expect(
      outcomes.map((o) => o.error.response === undefined),
      'each has response === undefined (none exists by design)',
    ).toEqual([true, true, true, true]);
  });
});

// ---------------------------------------------------------------------------
// S-CURL — composition: false skips hooks; zero dominates (SC1, SC2)
// ---------------------------------------------------------------------------
describe('S-CURL — followRedirects:false / maxRedirects:0 versus the callback guarantee', () => {
  const hits: Record<string, number> = {};
  let server: Server;
  let port = 0;
  const base = () => `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      hits[path] = (hits[path] ?? 0) + 1;
      if (path === '/302-forbidden') {
        res.writeHead(302, { Location: `${base()}/forbidden` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(path === '/forbidden' ? 'FORBIDDEN-REACHED' : 'ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => { for (const key of Object.keys(hits)) delete hits[key]; });

  it('SC1 — cURL followRedirects:false + onRedirect: settles the untouched source 302; callback invocations ZERO; never -1075', async () => {
    let callbackInvocations = 0;
    const response = (await curlClient.get(`${base()}/302-forbidden`, {
      followRedirects: false, timeout: 8000, retry: false,
      onRedirect: () => { callbackInvocations += 1; return true; },
    })) as { status?: number };
    expect(response.status).toBe(302);
    expect(callbackInvocations).toBe(0);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('SC2 — cURL maxRedirects:0 + onRedirect (RULED): zero dominates — one source dispatch, typed -1032 + maxRedirectsReached, callback ZERO, never -1075', async () => {
    let callbackInvocations = 0;
    const error = await rejection(curlClient.get(`${base()}/302-forbidden`, {
      maxRedirects: 0, timeout: 8000, retry: false,
      onRedirect: () => { callbackInvocations += 1; return true; },
    }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect(callbackInvocations).toBe(0);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });
});
