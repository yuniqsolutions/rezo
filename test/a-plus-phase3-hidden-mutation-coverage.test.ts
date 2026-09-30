/**
 * Phase 3 hidden mutation coverage — the two rows authorized by
 * DECISION-119 Q5 ("Add two rows + legs 41–42").
 *
 * This file exists because two landed routes had NO discriminating row in
 * the frozen matrices (34-row supplemental `3978050a…`, 40-row hidden red
 * `7c9ea4b3…` — both stay byte-untouched by this file):
 *
 *   MC1 — RN STREAM explicit-validator composition (leg 41 discriminator).
 *         `followRedirects: false` + an explicitly resolved validator that
 *         rejects the source 3xx must reject ordinary `REZ_HTTP_ERROR`
 *         (-1031) on the STREAM path (DECISION-107: explicit validator
 *         governs; the absent/null resolve variants are already pinned by
 *         SS1/ST-rows in the frozen supplemental). Mutations (10)-stream
 *         (drop the `validateStatus === undefined` settle condition) and
 *         (11)-stream (re-generic the createHttpError construction) must
 *         each turn this row red.
 *
 *   MC2 — XHR terminal 304 WITHOUT Location (leg 42 discriminator).
 *         A delivered terminal 304 carrying NO Location header must settle
 *         as ordinary `REZ_HTTP_ERROR` (-1031) and must NEVER classify as
 *         `REZ_MISSING_REDIRECT_LOCATION` (-1028). The frozen X6/ST10 rows
 *         use 304+Location, so they cannot witness removal of the
 *         `status !== 304` carve from XHR's terminal missing-Location
 *         classifier; this row can, and leg 42 must turn it red.
 *
 * Freeze discipline: green on the landed tree under Vitest AND Bun before
 * freezing; self-contained typed seams (zero banned loose-typing escapes);
 * unhandled-rejection ledger on every row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  RezoReactNativeOptions,
  RezoReactNativeStreamRequest,
  RezoReactNativeStreamResult,
} from '../src/types/react-native';
import type { InternalResponseType } from '../src/types/rezo-request';

// ---------------------------------------------------------------------------
// Typed test seams (self-contained duplicate of the frozen supplemental's
// seams — frozen files stay standalone by design).
// ---------------------------------------------------------------------------
interface TestRequestOptions {
  url: string;
  method?: string;
  timeout?: number;
  retry?: boolean;
  followRedirects?: boolean;
  maxRedirects?: number;
  validateStatus?: ((status: number) => boolean) | null;
  responseType?: InternalResponseType;
  reactNative?: RezoReactNativeOptions;
}

interface TestClient {
  request(options: TestRequestOptions): Promise<unknown>;
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
  finalUrl?: string;
  redirectCount?: number;
  redirectHistory?: unknown[];
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
// XHR fake (module scope, BEFORE entry imports — xhr.ts captures the global
// at module load). The prior global descriptor is SAVED here and RESTORED in
// afterAll so this module never leaks its fake into later suites.
// ---------------------------------------------------------------------------
type XHRScenario = { status: number; statusText?: string; headers: string; body?: string; responseURL?: string };
// ONE ordered lifecycle ledger, appended at the exact moments the fake's
// surface is exercised (open/send/readyState/load/abort). A row asserts the
// WHOLE sequence with exact equality, so a re-open, second send, abort, or
// alternate settle path changes the ledger and fails the row — absence of
// abort/error/timeout follows from the exact-sequence equality rather than
// from counters nothing could increment.
const xhrLifecycle: string[] = [];
let xhrScenario: XHRScenario = { status: 200, headers: '' };
function resetXhrLedger(): void {
  xhrLifecycle.length = 0;
}

class FakeXMLHttpRequest {
  readyState = 0; status = 0; statusText = '';
  response: unknown = ''; responseText = ''; responseURL = '';
  responseType = ''; timeout = 0; withCredentials = false;
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: unknown) => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  upload = { onprogress: null as ((event: unknown) => void) | null };
  // error/timeout are accessor-wrapped (review rider): whoever reads the
  // assigned handler receives a dispatcher that appends to the lifecycle
  // ledger BEFORE invoking the stored callback — so an adapter-driven
  // `this.onerror?.()` / `xhr.ontimeout?.()` is RECORDED on every possible
  // invocation path, and the exact-sequence assertion can genuinely prove
  // the absence of these events.
  #onerror: (() => void) | null = null;
  #ontimeout: (() => void) | null = null;
  get onerror(): (() => void) | null {
    const stored = this.#onerror;
    if (!stored) return null;
    return () => { xhrLifecycle.push('error'); stored(); };
  }
  set onerror(handler: (() => void) | null) { this.#onerror = handler; }
  get ontimeout(): (() => void) | null {
    const stored = this.#ontimeout;
    if (!stored) return null;
    return () => { xhrLifecycle.push('timeout'); stored(); };
  }
  set ontimeout(handler: (() => void) | null) { this.#ontimeout = handler; }
  #url = '';
  open(method: string, url: string) {
    xhrLifecycle.push(`open ${method.toUpperCase()} ${url}`);
    this.#url = url;
    this.readyState = 1;
  }
  setRequestHeader() {}
  getAllResponseHeaders() { return xhrScenario.headers; }
  getResponseHeader(name: string) {
    const line = xhrScenario.headers.split('\r\n').find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    return line ? line.split(':').slice(1).join(':').trim() : null;
  }
  abort() { xhrLifecycle.push('abort'); this.onabort?.(); }
  send() {
    xhrLifecycle.push('send');
    setTimeout(() => {
      this.status = xhrScenario.status;
      this.statusText = xhrScenario.statusText ?? String(xhrScenario.status);
      this.responseText = xhrScenario.body ?? '';
      this.response = xhrScenario.body ?? '';
      this.responseURL = xhrScenario.responseURL ?? this.#url;
      this.readyState = 4;
      xhrLifecycle.push('readyState4');
      this.onreadystatechange?.();
      xhrLifecycle.push('load');
      this.onload?.();
    }, 5);
  }
}
// Save the prior global descriptor BEFORE overwriting; restored in afterAll
// (tayo review rider: this module must not leak its fake into later suites).
const priorXhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXMLHttpRequest;
afterAll(() => {
  if (priorXhrDescriptor) {
    Object.defineProperty(globalThis, 'XMLHttpRequest', priorXhrDescriptor);
  } else {
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  }
  // Prove the restore actually landed: the post-restore descriptor must be
  // exactly what was saved (or absent when nothing was saved).
  const restored = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  if (priorXhrDescriptor) {
    expect(restored, 'prior XMLHttpRequest descriptor restored').toEqual(priorXhrDescriptor);
  } else {
    expect(restored, 'no XMLHttpRequest descriptor remains (none existed before)').toBeUndefined();
  }
});

const rnClient = (await import('../src/adapters/entries/react-native')).default as unknown as TestClient;
const xhrClient = (await import('../src/adapters/entries/xhr')).default as unknown as TestClient;

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

// Ten own properties + five Cookies members (own-property AND value) +
// present-object config identity + carrier link (anti-vacuity: identity is
// asserted only after BOTH sides are proven present objects).
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
// MC1 — RN stream explicit-validator composition (leg 41 discriminator)
// ---------------------------------------------------------------------------
interface TestStreamEmitter {
  on?(event: string, listener: (...args: never[]) => void): unknown;
}

describe('MC1 — RN stream: false + explicit rejecting validator settles ordinary -1031', () => {
  const RN_BASE = 'http://phase3-coverage.test';
  type StreamHop = { status: number; headers: Record<string, string>; body?: string };
  const transportHits: string[] = [];
  let streamScenario: (url: string) => StreamHop = () => ({ status: 200, headers: {} });

  const fakeTransport = {
    name: 'phase3-coverage-fake-transport',
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
    dataEvents: number;
    redirectEvents: number;
    completeEvents: number;
    endEvents: number;
    closeEvents: number;
    finishEvents: number;
    doneEvents: number;
    errorEvents: unknown[];
  };

  async function runStream(req: Partial<TestRequestOptions>): Promise<StreamOutcome> {
    const outcome: StreamOutcome = {
      settled: 'resolved', statusEvents: [], headersEvents: 0, dataEvents: 0,
      redirectEvents: 0, completeEvents: 0, endEvents: 0, closeEvents: 0,
      finishEvents: 0, doneEvents: 0, errorEvents: [],
    };
    try {
      const stream = (await rnClient.request({
        url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false,
        responseType: 'stream',
        reactNative: { streamTransport: fakeTransport },
        ...req,
      })) as TestStreamEmitter;
      stream.on?.('status', (status: number) => { outcome.statusEvents.push(status); });
      stream.on?.('headers', () => { outcome.headersEvents += 1; });
      stream.on?.('data', () => { outcome.dataEvents += 1; });
      stream.on?.('redirect', () => { outcome.redirectEvents += 1; });
      stream.on?.('complete', () => { outcome.completeEvents += 1; });
      stream.on?.('end', () => { outcome.endEvents += 1; });
      stream.on?.('close', () => { outcome.closeEvents += 1; });
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

  function totalErrorDeliveries(outcome: StreamOutcome): number {
    return (outcome.settled === 'rejected' ? 1 : 0) + outcome.errorEvents.length;
  }

  function firstError(outcome: StreamOutcome): CapturedOutcome | undefined {
    return outcome.settled === 'rejected' ? outcome.error : (outcome.errorEvents[0] as CapturedOutcome | undefined);
  }

  it('MC1 — stream false + 302 (valid Location) + explicit 2xx-only validator: the SUPPLIED validator provably runs (invocation ledger exactly [302]); ordinary REZ_HTTP_ERROR -1031; NEVER a redirect-control code; one transport invocation, zero destination hits; every observable channel pinned; source-URL carrier state', async () => {
    streamScenario = (u) =>
      u.endsWith('/start')
        ? { status: 302, headers: { location: `${RN_BASE}/destination` } }
        : { status: 200, headers: {}, body: 'FINAL' };
    // Anti-vacuity (tayo review rider 1): the validator records every status
    // it is invoked with. An implementation that IGNORES the supplied
    // function and applies the implicit 2xx default would produce an EMPTY
    // ledger while still rejecting — this pin makes that substitution fail.
    const validatorLedger: number[] = [];
    const outcome = await runStream({
      followRedirects: false,
      validateStatus: (status: number) => {
        validatorLedger.push(status);
        return status >= 200 && status < 300;
      },
    });
    expect(validatorLedger, 'the SUPPLIED validator ran, exactly once, with the source status').toEqual([302]);
    const error = firstError(outcome);
    // DECISION-107: the explicitly resolved validator governs the unfollowed
    // source 3xx — rejection is ORDINARY, never a redirect-control code.
    expect(error?.code, 'ordinary HTTP error code').toBe('REZ_HTTP_ERROR');
    expect(error?.errno, 'ordinary HTTP errno').toBe(-1031);
    expect(REDIRECT_CODES).not.toContain(error?.code);
    expect(error?.config?.maxRedirectsReached, 'zero-denial flag must NOT be set by validator rejection').not.toBe(true);
    expect(transportHits, 'transport dispatch list is EXACTLY [SOURCE]').toEqual([`${RN_BASE}/start`]);
    // Anti-vacuity (rider 2): EVERY observable stream channel pinned to its
    // contract value. The stream delivers the SOURCE status and headers
    // (status [302] ×1, headers ×1), carries no body chunk for this fixture
    // (data 0), never redirects/completes/ends/closes observably, then errors
    // at settlement — the success terminals never fire, and the error arrives
    // on exactly one channel.
    expect(outcome.statusEvents, 'stream emits the SOURCE status exactly once').toEqual([302]);
    expect(outcome.headersEvents, 'stream emits headers exactly once').toBe(1);
    expect(outcome.dataEvents, 'no data chunk for the bodyless 302 fixture').toBe(0);
    expect(outcome.redirectEvents, 'no redirect event').toBe(0);
    expect(outcome.completeEvents, 'no complete event').toBe(0);
    expect(outcome.endEvents, 'no end event').toBe(0);
    expect(outcome.closeEvents, 'no close event').toBe(0);
    expect(outcome.finishEvents, 'no finish').toBe(0);
    expect(outcome.doneEvents, 'no done').toBe(0);
    expect(totalErrorDeliveries(outcome), 'exactly one error delivery across both channels').toBe(1);
    expect(error).toBeDefined();
    assertTypedSourceResponse(error as CapturedOutcome, { status: 302, sourceUrl: `${RN_BASE}/start` });
    // Rider 2 (source-carrier state): the request and config the error carries
    // must still describe the SOURCE dispatch — executable rollback state,
    // not merely identity between two objects.
    const carried = error as CapturedOutcome;
    expect(String(carried.request?.fullUrl ?? carried.request?.url), 'error.request carries the SOURCE URL')
      .toBe(`${RN_BASE}/start`);
    expect(carried.config?.finalUrl, 'error.config.finalUrl is the SOURCE, never the destination')
      .toBe(`${RN_BASE}/start`);
    // Direct-value pins (review rider): no fallback — a MISSING property is
    // a failure, not a silent pass.
    expect(carried.config?.redirectCount, 'config.redirectCount is present AND 0 — no hop was consumed').toBe(0);
    expect(carried.config?.redirectHistory, 'config.redirectHistory is present AND empty').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MC2 — XHR terminal 304 WITHOUT Location (leg 42 discriminator)
// ---------------------------------------------------------------------------
describe('MC2 — XHR: delivered terminal 304 with NO Location settles ordinary -1031, never -1028', () => {
  beforeEach(() => { resetXhrLedger(); });
  const SOURCE = 'http://xhr-phase3-coverage.test/start';

  it('MC2 — 304 without Location: REZ_HTTP_ERROR -1031 exactly; NEVER REZ_MISSING_REDIRECT_LOCATION; the EXACT ordered lifecycle is `open GET SOURCE → send → readyState4 → load` (an abort/error/timeout/re-open would change the sequence); complete typed source response', async () => {
    xhrScenario = { status: 304, statusText: 'Not Modified', headers: '', responseURL: SOURCE };
    const error = await rejection(xhrClient.request({ url: SOURCE, method: 'GET', timeout: 8000, retry: false }));
    expect(error.__resolved, 'the 304 must reject under the default validator').toBeUndefined();
    expect(error.code, 'ordinary HTTP error code').toBe('REZ_HTTP_ERROR');
    expect(error.errno, 'ordinary HTTP errno').toBe(-1031);
    expect(error.code).not.toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(REDIRECT_CODES).not.toContain(error.code);
    // Anti-vacuity (tayo review rider 3, re-cut per the vacuous-counter
    // block): ONE ordered ledger appended where the fake's surface is
    // actually exercised, asserted with EXACT sequence equality — the open
    // records its real {method,url}; a second open/send, an abort, or some
    // alternate settle path appends entries and fails the equality, so the
    // absence of abort/error/timeout is proven by the sequence itself, not
    // by counters nothing could increment.
    expect(xhrLifecycle, 'exact ordered lifecycle').toEqual([
      `open GET ${SOURCE}`,
      'send',
      'readyState4',
      'load',
    ]);
    assertTypedSourceResponse(error, { status: 304, sourceUrl: SOURCE });
  });
});
