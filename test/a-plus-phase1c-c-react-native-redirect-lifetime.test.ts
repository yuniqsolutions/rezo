/**
 * A+ Phase 1c-c, R10: React Native injected-manual redirect policy.
 *
 * This is deliberately Tier-C evidence. It runs the React Native adapter with
 * an injected Fetch implementation under Node/Bun; it is not evidence about
 * stock React Native, Hermes, or a native provider-owned redirect chain.
 *
 * The injected transport records the exact URL, method, body, redirect mode,
 * and headers at every dispatch. Redirect responses remain visible so the
 * adapter must enforce the shared R1-R7 lifetime and provenance contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { Rezo } from '../src/core/rezo.js';
import { RezoError } from '../src/errors/rezo-error.js';
import { StreamResponse } from '../src/responses/universal/stream.js';
import type {
  RezoReactNativeStreamRequest,
  RezoReactNativeStreamTransport,
} from '../src/types/react-native.js';

const INJECTED_EVIDENCE = 'injected Node/Bun RN adapter evidence; not stock-RN proof';
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NAVIGATOR_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

interface ScriptedResponse {
  readonly status: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

interface DispatchRecord {
  readonly url: string;
  readonly method: string;
  readonly body: BodyInit | null | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly headers: Readonly<Record<string, string>>;
}

interface StreamDispatchRecord {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

type ResponseScript = (
  dispatch: DispatchRecord,
  index: number,
) => ScriptedResponse | Promise<ScriptedResponse>;

function makeResponse(spec: ScriptedResponse, requestUrl: string): Response {
  const body = spec.body ?? '';
  const headers = new Headers(spec.headers || {});
  const asText = (): string => {
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (body instanceof Uint8Array) return new TextDecoder().decode(body);
    return JSON.stringify(body);
  };

  return {
    status: spec.status,
    statusText: spec.statusText || (spec.status >= 300 && spec.status < 400 ? 'Found' : 'OK'),
    headers,
    url: spec.url || requestUrl,
    async text() {
      return asText();
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
    async arrayBuffer() {
      if (body instanceof ArrayBuffer) return body;
      if (body instanceof Uint8Array) return body.slice().buffer;
      return new TextEncoder().encode(asText()).buffer;
    },
    async blob() {
      return new Blob([body instanceof ArrayBuffer ? body : asText()]);
    },
  } as Response;
}

function installInjectedFetch(script: ResponseScript): {
  readonly fetchMock: ReturnType<typeof vi.fn>;
  readonly dispatches: DispatchRecord[];
} {
  const dispatches: DispatchRecord[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.href;
    const nativeHeaders = new Headers(init?.headers || {});
    const headers = Object.freeze(
      Object.fromEntries([...nativeHeaders.entries()].map(([name, value]) => [name.toLowerCase(), value])),
    );
    const dispatch = Object.freeze({
      url,
      method: (init?.method || 'GET').toUpperCase(),
      body: init?.body,
      redirect: init?.redirect,
      headers,
    });
    dispatches.push(dispatch);
    const response = await script(dispatch, dispatches.length - 1);
    return makeResponse(response, url);
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
  return { fetchMock, dispatches };
}

function header(dispatch: DispatchRecord | undefined, name: string): string | null {
  if (!dispatch) return null;
  return dispatch.headers[name.toLowerCase()] ?? null;
}

function redirect(location: string, url?: string, status = 302): ScriptedResponse {
  return {
    status,
    statusText: 'Found',
    url,
    headers: { location },
  };
}

function setNavigatorProduct(product: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    enumerable: true,
    value: { product },
    writable: true,
  });
}

function createRedirectingStreamTransport(
  source: string,
  destination: string,
  redirectHeaders: Readonly<Record<string, string>> = {},
): {
  readonly transport: RezoReactNativeStreamTransport;
  readonly dispatches: StreamDispatchRecord[];
  readonly stream: ReturnType<typeof vi.fn>;
} {
  const dispatches: StreamDispatchRecord[] = [];
  const stream = vi.fn(async (request: RezoReactNativeStreamRequest) => {
    dispatches.push(Object.freeze({
      url: request.url,
      method: request.method,
      body: request.body,
      headers: Object.freeze(
        Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
        ),
      ),
    }));

    if (dispatches.length === 1) {
      const headers = { ...redirectHeaders, location: destination };
      await request.onHeaders?.({
        status: 302,
        statusText: 'Found',
        headers,
        finalUrl: destination,
      });
      return { status: 302, statusText: 'Found', headers, finalUrl: destination };
    }

    const headers = { 'content-type': 'text/plain' };
    await request.onHeaders?.({
      status: 200,
      statusText: 'OK',
      headers,
      finalUrl: destination,
    });
    await request.onChunk?.('ok');
    return { status: 200, statusText: 'OK', headers, finalUrl: destination };
  });

  return {
    transport: { name: 'phase1c-c-visible-stream', stream },
    dispatches,
    stream,
  };
}

function waitForStreamFailure(response: StreamResponse): Promise<RezoError> {
  return new Promise((resolve, reject) => {
    response.once('error', resolve);
    response.once('complete', () => reject(new Error('Expected stream request to fail')));
  });
}

function waitForStreamCompletion(response: StreamResponse): Promise<unknown> {
  return new Promise((resolve, reject) => {
    response.once('complete', resolve);
    response.once('error', reject);
  });
}

function ok(url: string, body: unknown = { ok: true }): ScriptedResponse {
  return {
    status: 200,
    statusText: 'OK',
    url,
    headers: { 'content-type': 'application/json' },
    body,
  };
}

function serverError(url: string): ScriptedResponse {
  return {
    status: 503,
    statusText: 'Service Unavailable',
    url,
    headers: { 'content-type': 'text/plain' },
    body: 'retry me',
  };
}

async function captureFailure(run: Promise<unknown>): Promise<RezoError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(RezoError);
    return error as RezoError;
  }
  throw new Error('Expected the injected RN request to reject');
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'fetch', {
    value: ORIGINAL_FETCH,
    configurable: true,
    writable: true,
  });
  if (ORIGINAL_NAVIGATOR_DESCRIPTOR) {
    Object.defineProperty(globalThis, 'navigator', ORIGINAL_NAVIGATOR_DESCRIPTOR);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

describe(`A+ Phase 1c-c RN R10 redirect lifetime (${INJECTED_EVIDENCE})`, () => {
  it('control: the injected transport exposes a manual redirect and preserves its exact dispatch ledger', async () => {
    const source = 'https://manual.test/start';
    const destination = 'https://manual.test/final';
    const callback = vi.fn(() => true);
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect('/final', source) : ok(destination)
    ));

    const response = await executeRequest({
      url: source,
      method: 'GET',
      headers: { 'X-Control': 'visible-hop' },
      beforeRedirect: callback,
    } as never, {}, new RezoCookieJar()) as any;

    expect({
      evidence: INJECTED_EVIDENCE,
      urls: dispatches.map((entry) => entry.url),
      methods: dispatches.map((entry) => entry.method),
      redirectModes: dispatches.map((entry) => entry.redirect),
      headers: dispatches.map((entry) => header(entry, 'x-control')),
      callbackCount: callback.mock.calls.length,
      redirectCount: response.config.redirectCount,
      history: response.config.redirectHistory.map((entry: any) => entry.url),
      finalStatus: response.status,
    }).toEqual({
      evidence: INJECTED_EVIDENCE,
      urls: [source, destination],
      methods: ['GET', 'GET'],
      redirectModes: ['manual', 'manual'],
      headers: ['visible-hop', 'visible-hop'],
      callbackCount: 1,
      redirectCount: 1,
      history: [source],
      finalStatus: 200,
    });
  });

  it('control: public default callback and effective instance hook each run once on the visible manual path', async () => {
    const source = 'https://public-hooks.test/start';
    const destination = 'https://public-hooks.test/final';
    const callback = vi.fn(() => true);
    const instanceHook = vi.fn();
    const requestHook = vi.fn();
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect('/final', source) : ok(destination)
    ));
    const client = new Rezo({ onRedirect: callback }, executeRequest as never);
    client.hooks.beforeRedirect.push(instanceHook);

    const response = await client.get(source, {
      hooks: { beforeRedirect: [requestHook] },
    } as never);

    expect({
      status: response.status,
      urls: dispatches.map((entry) => entry.url),
      callbackCalls: callback.mock.calls.length,
      instanceHookCalls: instanceHook.mock.calls.length,
      requestHookCalls: requestHook.mock.calls.length,
    }).toEqual({
      status: 200,
      urls: [source, destination],
      callbackCalls: 1,
      instanceHookCalls: 1,
      requestHookCalls: 1,
    });
  });

  it('control: an actual-RN marker keeps an explicitly selected hop-visible stream transport callback-capable', async () => {
    setNavigatorProduct('ReactNative');
    const source = 'https://visible-stream.test/start';
    const destination = 'https://visible-stream.test/final';
    const callback = vi.fn(() => true);
    const { transport, dispatches } = createRedirectingStreamTransport(source, destination);
    const streamResponse = new StreamResponse();
    const completion = waitForStreamCompletion(streamResponse);

    const returned = await executeRequest({
      url: source,
      method: 'GET',
      responseType: 'stream',
      _streamResponse: streamResponse,
      reactNative: { streamTransport: transport },
      onRedirect: callback,
    } as never, {}, new RezoCookieJar());
    await completion;

    expect({
      sameResponse: returned === streamResponse,
      urls: dispatches.map((entry) => entry.url),
      callbackCalls: callback.mock.calls.length,
    }).toEqual({
      sameResponse: true,
      urls: [source, destination],
      callbackCalls: 1,
    });
  });

  // Superseded by the ruled responseType contract (DECISION-063 C / 065 A):
  // a facade mode is legal per request but never as an instance default, so an
  // ordinary call can no longer be escalated into a facade by a hidden default.
  // The row is kept — inverted, not deleted — because default-driven selection
  // still needs standing evidence, now that it must refuse before the wire.
  // The stream lane's reachability stays proven by the five request-level rows
  // in this carrier, so nothing here becomes vacuous.
  it('control: a DEFAULT facade responseType refuses before dispatch; the request-level token remains the way in', async () => {
    setNavigatorProduct('ReactNative');
    const source = 'https://default-visible-stream.test/start';
    const destination = 'https://default-visible-stream.test/final';
    const callback = vi.fn(() => true);
    const { transport, dispatches } = createRedirectingStreamTransport(source, destination);
    const streamResponse = new StreamResponse();
    const completion = waitForStreamCompletion(streamResponse);
    let returned: unknown;
    let error: unknown;

    try {
      returned = await executeRequest({
        url: source,
        method: 'GET',
        _streamResponse: streamResponse,
      } as never, {
        responseType: 'stream',
        reactNative: { streamTransport: transport },
        onRedirect: callback,
      } as never, new RezoCookieJar());
      if (returned === streamResponse) await completion;
    } catch (caught) {
      error = caught;
    }

    expect({
      errorCode: error instanceof RezoError ? error.code : error === undefined ? null : 'non-rezo',
      sameResponse: returned === streamResponse,
      urls: dispatches.map((entry) => entry.url),
      callbackCalls: callback.mock.calls.length,
    }).toEqual({
      errorCode: 'REZ_INVALID_RESPONSE_TYPE',
      sameResponse: false,
      // Empty: the refusal happens at the raw boundary, so no hop is dispatched
      // and the redirect callback never runs.
      urls: [],
      callbackCalls: 0,
    });
  });

  it('R1/R5: the hop-visible stream retry refreshes jar and XSRF projection without advancing redirect state', async () => {
    const source = 'https://stream-retry-cookie.test/start';
    const destination = 'https://stream-retry-cookie.test/dest/final';
    const dispatches: StreamDispatchRecord[] = [];
    const stream = vi.fn(async (request: RezoReactNativeStreamRequest) => {
      dispatches.push(Object.freeze({
        url: request.url,
        method: request.method,
        body: request.body,
        headers: Object.freeze(
          Object.fromEntries(
            Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
          ),
        ),
      }));
      const index = dispatches.length - 1;
      if (index === 0) {
        const headers = { location: '/dest/final' };
        await request.onHeaders?.({
          status: 302,
          statusText: 'Found',
          headers,
          finalUrl: source,
        });
        return { status: 302, statusText: 'Found', headers, finalUrl: source };
      }
      if (index === 1) {
        const headers = {
          'content-type': 'text/plain',
          'set-cookie': 'xsrf=fresh-stream-token; Path=/dest; Secure',
        };
        await request.onHeaders?.({
          status: 503,
          statusText: 'Service Unavailable',
          headers,
          finalUrl: destination,
        });
        return { status: 503, statusText: 'Service Unavailable', headers, finalUrl: destination };
      }
      const headers = { 'content-type': 'text/plain' };
      await request.onHeaders?.({
        status: 200,
        statusText: 'OK',
        headers,
        finalUrl: destination,
      });
      await request.onChunk?.('ok');
      return { status: 200, statusText: 'OK', headers, finalUrl: destination };
    });
    const transport: RezoReactNativeStreamTransport = {
      name: 'phase1c-c-retrying-stream',
      stream,
    };
    const callback = vi.fn(({ url }: { url: URL }) => ({
      redirect: true,
      url: url.href,
      setHeaders: { 'X-One-Hop': 'survives-stream-retry' },
    }));
    const streamResponse = new StreamResponse();
    const completion = waitForStreamCompletion(streamResponse);

    await executeRequest({
      url: source,
      method: 'GET',
      responseType: 'stream',
      _streamResponse: streamResponse,
      reactNative: { streamTransport: transport },
      retry: { limit: 1, delay: 0 },
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: callback,
    } as never, {}, new RezoCookieJar());
    const finish = await completion as any;

    expect({
      urls: dispatches.map((entry) => entry.url),
      oneHop: dispatches.map((entry) => entry.headers['x-one-hop'] ?? null),
      cookie: dispatches.map((entry) => entry.headers.cookie ?? null),
      xsrf: dispatches.map((entry) => entry.headers['x-xsrf-token'] ?? null),
      callbackCalls: callback.mock.calls.length,
      redirectCount: finish.config.redirectCount,
      // The finish event's config is the detached 13-key snapshot: redirect
      // state is public as `redirectCount`; the per-hop history (which
      // carries live request configs) stays on the live config only.
      historyExposed: 'redirectHistory' in finish.config,
    }).toEqual({
      urls: [source, destination, destination],
      oneHop: [null, 'survives-stream-retry', 'survives-stream-retry'],
      cookie: [null, null, 'xsrf=fresh-stream-token'],
      xsrf: [null, null, 'fresh-stream-token'],
      callbackCalls: 1,
      redirectCount: 1,
      historyExposed: false,
    });
  });

  it('R1: one-hop headers reach one logical destination and its retry, then expire before the next redirect', async () => {
    const source = 'https://r1.test/start';
    const logical = 'https://r1.test/logical';
    const final = 'https://r1.test/final';
    const callback = vi.fn(({ url }: { url: URL }) => (
      url.href === logical
        ? {
            redirect: true,
            url: url.href,
            setHeaders: {
              'X-One-Hop': 'logical-only',
              'X-Overlay': 'applied',
            },
          }
        : true
    ));
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/logical', source);
      if (index === 1) return serverError(logical);
      if (index === 2) return redirect('/final', logical);
      return ok(final);
    });

    const response = await executeRequest({
      url: source,
      method: 'GET',
      headers: {
        Authorization: 'Bearer inherited-same-origin',
        'X-Base': 'base',
      },
      retry: { limit: 1, delay: 0 },
      onRedirect: callback,
    } as never, {}, new RezoCookieJar()) as any;

    expect({
      urls: dispatches.map((entry) => entry.url),
      oneHop: dispatches.map((entry) => header(entry, 'x-one-hop')),
      overlays: dispatches.map((entry) => header(entry, 'x-overlay')),
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
      methods: dispatches.map((entry) => entry.method),
      redirectModes: dispatches.map((entry) => entry.redirect),
      callbackCount: callback.mock.calls.length,
      redirectCount: response.config.redirectCount,
      retryAttempts: response.config.retryAttempts,
      retainedErrors: response.config.errors.map((entry: any) => entry.error.code),
      status: response.status,
    }).toEqual({
      urls: [source, logical, logical, final],
      oneHop: [null, 'logical-only', 'logical-only', null],
      overlays: [null, 'applied', 'applied', null],
      authorization: [
        'Bearer inherited-same-origin',
        'Bearer inherited-same-origin',
        'Bearer inherited-same-origin',
        'Bearer inherited-same-origin',
      ],
      methods: ['GET', 'GET', 'GET', 'GET'],
      redirectModes: ['manual', 'manual', 'manual', 'manual'],
      callbackCount: 2,
      redirectCount: 2,
      retryAttempts: 1,
      retainedErrors: ['REZ_HTTP_ERROR'],
      status: 200,
    });
  });

  it('R1/R5: a destination retry refreshes jar and XSRF projection without expiring its one-hop patch', async () => {
    const source = 'https://retry-cookie.test/start';
    const destination = 'https://retry-cookie.test/dest/final';
    const jar = new RezoCookieJar();
    const callback = vi.fn(({ url }: { url: URL }) => ({
      redirect: true,
      url: url.href,
      setHeaders: { 'X-One-Hop': 'survives-retry' },
    }));
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/dest/final', source);
      if (index === 1) {
        return {
          ...serverError(destination),
          headers: {
            'content-type': 'text/plain',
            'set-cookie': 'xsrf=fresh-token; Path=/dest; Secure',
          },
        };
      }
      return ok(destination);
    });

    const response = await executeRequest({
      url: source,
      method: 'GET',
      retry: { limit: 1, delay: 0 },
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: callback,
    } as never, {}, jar) as any;

    expect({
      urls: dispatches.map((entry) => entry.url),
      oneHop: dispatches.map((entry) => header(entry, 'x-one-hop')),
      cookie: dispatches.map((entry) => header(entry, 'cookie')),
      xsrf: dispatches.map((entry) => header(entry, 'x-xsrf-token')),
      callbackCalls: callback.mock.calls.length,
      redirectCount: response.config.redirectCount,
      history: response.config.redirectHistory.map((entry: any) => entry.url),
    }).toEqual({
      urls: [source, destination, destination],
      oneHop: [null, 'survives-retry', 'survives-retry'],
      cookie: [null, null, 'xsrf=fresh-token'],
      xsrf: [null, null, 'fresh-token'],
      callbackCalls: 1,
      redirectCount: 1,
      history: [source],
    });
  });

  it('R1/R5 control: one-hop tombstones continue to suppress freshly projected retry cookies and XSRF', async () => {
    const source = 'https://retry-cookie-delete.test/start';
    const destination = 'https://retry-cookie-delete.test/dest/final';
    const jar = new RezoCookieJar();
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/dest/final', source);
      if (index === 1) {
        return {
          ...serverError(destination),
          headers: {
            'content-type': 'text/plain',
            'set-cookie': 'xsrf=fresh-token; Path=/dest; Secure',
          },
        };
      }
      return ok(destination);
    });

    await executeRequest({
      url: source,
      method: 'GET',
      retry: { limit: 1, delay: 0 },
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        setHeaders: {
          Cookie: undefined,
          'X-XSRF-Token': undefined,
        },
      }),
    } as never, {}, jar);

    expect({
      cookie: dispatches.map((entry) => header(entry, 'cookie')),
      xsrf: dispatches.map((entry) => header(entry, 'x-xsrf-token')),
    }).toEqual({
      cookie: [null, null, null],
      xsrf: [null, null, null],
    });
  });

  it('R2: persistent headers apply immediately, survive exact-origin hops, expire on an origin change, and never revive', async () => {
    const source = 'https://persist-a.test/start';
    const sameOne = 'https://persist-a.test/one';
    const sameTwo = 'https://persist-a.test/two';
    const foreign = 'https://persist-b.test/foreign';
    const returned = 'https://persist-a.test/returned';
    const callback = vi.fn(({ url }: { url: URL }) => (
      url.href === sameOne
        ? {
            redirect: true,
            url: url.href,
            setHeadersOnRedirects: { 'X-Persistent': 'anchored-a' },
          }
        : true
    ));
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/one', source);
      if (index === 1) return redirect('/two', sameOne);
      if (index === 2) return redirect(foreign, sameTwo);
      if (index === 3) return redirect(returned, foreign);
      return ok(returned);
    });

    const response = await executeRequest({
      url: source,
      method: 'GET',
      onRedirect: callback,
    } as never, {}, new RezoCookieJar()) as any;

    expect({
      urls: dispatches.map((entry) => entry.url),
      persistent: dispatches.map((entry) => header(entry, 'x-persistent')),
      callbackCount: callback.mock.calls.length,
      redirectCount: response.config.redirectCount,
      history: response.config.redirectHistory.map((entry: any) => entry.url),
    }).toEqual({
      urls: [source, sameOne, sameTwo, foreign, returned],
      persistent: [null, 'anchored-a', 'anchored-a', null, null],
      callbackCount: 4,
      redirectCount: 4,
      history: [source, sameOne, sameTwo, foreign],
    });
  });

  it('R3: a downgrade expires inherited Authorization when the callback does not reissue it', async () => {
    const secure = 'https://downgrade.test/start';
    const plain = 'http://downgrade.test/final';
    const callback = vi.fn((_options: { url: URL; status: number }) => true);
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(plain, secure) : ok(plain)
    ));

    await executeRequest({
      url: secure,
      method: 'GET',
      headers: { Authorization: 'Bearer inherited-must-expire' },
      beforeRedirect: callback,
    } as never, {}, new RezoCookieJar());

    expect({
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
      callbackTarget: (callback.mock.calls[0]?.[0] as any)?.url?.href,
      callbackStatus: (callback.mock.calls[0]?.[0] as any)?.status,
    }).toEqual({
      authorization: ['Bearer inherited-must-expire', null],
      callbackTarget: plain,
      callbackStatus: 302,
    });
  });

  it('R3 control: a fresh callback can deliberately reissue Authorization after observing a downgrade', async () => {
    const secure = 'https://downgrade-reissue.test/start';
    const plain = 'http://downgrade-reissue.test/final';
    const callback = vi.fn(({ url }: { url: URL }) => ({
      redirect: true,
      url: url.href,
      setHeaders: { Authorization: 'Bearer explicitly-reissued' },
    }));
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(plain, secure) : ok(plain)
    ));

    await executeRequest({
      url: secure,
      method: 'GET',
      headers: { Authorization: 'Bearer inherited-must-expire' },
      onRedirect: callback,
    } as never, {}, new RezoCookieJar());

    expect({
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
      callbackCount: callback.mock.calls.length,
      callbackTarget: (callback.mock.calls[0]?.[0] as any)?.url?.href,
    }).toEqual({
      authorization: ['Bearer inherited-must-expire', 'Bearer explicitly-reissued'],
      callbackCount: 1,
      callbackTarget: plain,
    });
  });

  it('R4: one-hop wins persistent collisions, tombstones suppress lower layers, and empty persistent clears before the next hop', async () => {
    const source = 'https://precedence.test/start';
    const current = 'https://precedence.test/current';
    const final = 'https://precedence.test/final';
    let callbackCount = 0;
    const callback = vi.fn(({ url }: { url: URL }) => {
      callbackCount += 1;
      if (callbackCount === 1) {
        return {
          redirect: true,
          url: url.href,
          setHeadersOnRedirects: {
            'X-Priority': 'persistent',
            'X-Delete-Undefined': 'persistent-undefined',
            'X-Delete-Empty': 'persistent-empty',
          },
          setHeaders: {
            'X-Priority': 'one-hop',
            'X-Delete-Undefined': undefined,
            'X-Delete-Empty': [],
          },
        };
      }
      return {
        redirect: true,
        url: url.href,
        setHeadersOnRedirects: {},
      };
    });
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/current', source);
      if (index === 1) return redirect('/final', current);
      return ok(final);
    });

    await executeRequest({
      url: source,
      method: 'GET',
      headers: {
        'X-Priority': 'base',
        'X-Delete-Undefined': 'base-undefined',
        'X-Delete-Empty': 'base-empty',
      },
      onRedirect: callback,
    } as never, {}, new RezoCookieJar());

    expect(dispatches.map((entry) => ({
      priority: header(entry, 'x-priority'),
      deleteUndefined: header(entry, 'x-delete-undefined'),
      deleteEmpty: header(entry, 'x-delete-empty'),
    }))).toEqual([
      {
        priority: 'base',
        deleteUndefined: 'base-undefined',
        deleteEmpty: 'base-empty',
      },
      {
        priority: 'one-hop',
        deleteUndefined: null,
        deleteEmpty: null,
      },
      {
        priority: 'base',
        deleteUndefined: 'base-undefined',
        deleteEmpty: 'base-empty',
      },
    ]);
  });

  it('R5: literal source Cookie expires on a port change while destination jar/XSRF state is recomputed and callback Cookie wins', async () => {
    const source = 'https://cookie.test:443/start';
    const destination = 'https://cookie.test:8443/destination/final';
    const callerHeaders = Object.freeze({
      Cookie: 'literal=source-only',
      'X-Caller': 'immutable',
    });
    const jar = new RezoCookieJar();
    jar.setCookiesSync([
      'destination=jar-owned; Path=/destination; Secure',
      'xsrf=target-token; Path=/destination; Secure',
    ], destination);
    const callback = vi.fn(({ url }: { url: URL }) => ({
      redirect: true,
      url: url.href,
      setHeaders: { Cookie: 'explicit=callback-owned' },
    }));
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: callerHeaders,
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: callback,
    } as never, {}, jar);

    expect({
      cookie: dispatches.map((entry) => header(entry, 'cookie')),
      xsrf: dispatches.map((entry) => header(entry, 'x-xsrf-token')),
      literalAtDestination: header(dispatches[1], 'cookie')?.includes('literal=') ?? false,
      destinationJarAtDestination: header(dispatches[1], 'cookie')?.includes('destination=') ?? false,
      callerHeaders,
    }).toEqual({
      cookie: ['literal=source-only', 'explicit=callback-owned'],
      xsrf: [null, 'target-token'],
      literalAtDestination: false,
      destinationJarAtDestination: false,
      callerHeaders: {
        Cookie: 'literal=source-only',
        'X-Caller': 'immutable',
      },
    });
  });

  it('R5: a callback Cookie tombstone suppresses both inherited literal and destination jar cookies', async () => {
    const source = 'https://cookie-delete.test/start';
    const destination = 'https://cookie-delete.test/destination/final';
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['destination=jar-owned; Path=/destination; Secure'], destination);
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: { Cookie: 'literal=source-only' },
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        setHeaders: { Cookie: undefined },
      }),
    } as never, {}, jar);

    expect(dispatches.map((entry) => header(entry, 'cookie'))).toEqual([
      'literal=source-only',
      null,
    ]);
  });

  it('R5: same-origin literal Cookie coexists with freshly matched destination jar and XSRF state', async () => {
    const source = 'https://cookie-same.test/source/start';
    const destination = 'https://cookie-same.test/destination/final';
    const jar = new RezoCookieJar();
    jar.setCookiesSync([
      'sourceOnly=source; Path=/source; Secure',
      'xsrf=source-token; Path=/source; Secure',
    ], source);
    jar.setCookiesSync([
      'destination=dest; Path=/destination; Secure',
      'xsrf=destination-token; Path=/destination; Secure',
    ], destination);
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: { Cookie: 'literal=caller' },
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: () => true,
    } as never, {}, jar);

    const sourceCookie = header(dispatches[0], 'cookie') || '';
    const destinationCookie = header(dispatches[1], 'cookie') || '';
    expect({
      sourceLiteral: sourceCookie.includes('literal=caller'),
      sourceJar: sourceCookie.includes('sourceOnly=source'),
      sourceDestinationJar: sourceCookie.includes('destination=dest'),
      destinationLiteral: destinationCookie.includes('literal=caller'),
      destinationJar: destinationCookie.includes('destination=dest'),
      destinationSourceJar: destinationCookie.includes('sourceOnly=source'),
      xsrf: dispatches.map((entry) => header(entry, 'x-xsrf-token')),
    }).toEqual({
      sourceLiteral: true,
      sourceJar: true,
      sourceDestinationJar: false,
      destinationLiteral: true,
      destinationJar: true,
      destinationSourceJar: false,
      xsrf: ['source-token', 'destination-token'],
    });
  });

  it('R5: an empty destination jar match removes stale source jar and XSRF state but retains same-origin literal Cookie', async () => {
    const source = 'https://cookie-empty.test/source/start';
    const destination = 'https://cookie-empty.test/empty/final';
    const jar = new RezoCookieJar();
    jar.setCookiesSync([
      'sourceOnly=source; Path=/source; Secure',
      'xsrf=source-token; Path=/source; Secure',
    ], source);
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: { Cookie: 'literal=caller' },
      xsrfCookieName: 'xsrf',
      xsrfHeaderName: 'X-XSRF-Token',
      onRedirect: () => true,
    } as never, {}, jar);

    expect({
      sourceCookie: header(dispatches[0], 'cookie'),
      destinationCookie: header(dispatches[1], 'cookie'),
      xsrf: dispatches.map((entry) => header(entry, 'x-xsrf-token')),
    }).toEqual({
      sourceCookie: 'literal=caller; sourceOnly=source; xsrf=source-token',
      destinationCookie: 'literal=caller',
      xsrf: ['source-token', null],
    });
  });

  it('R5: a Fetch provider destination hint cannot rebind a redirect response cookie', async () => {
    const source = 'https://fetch-cookie-source.test/start';
    const destination = 'https://fetch-cookie-destination.test/final';
    const jar = new RezoCookieJar();
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0
        ? {
            status: 302,
            statusText: 'Found',
            url: destination,
            headers: {
              location: destination,
              'set-cookie': 'issuer=source-response; Path=/; Secure',
            },
          }
        : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      onRedirect: () => true,
    } as never, {}, jar);

    expect({
      cookiesAtWire: dispatches.map((entry) => header(entry, 'cookie')),
      sourceJar: jar.getCookieHeader(source),
      destinationJar: jar.getCookieHeader(destination),
    }).toEqual({
      cookiesAtWire: [null, null],
      sourceJar: 'issuer=source-response',
      destinationJar: '',
    });
  });

  it('R5: a stream provider destination hint cannot rebind a redirect response cookie', async () => {
    const source = 'https://stream-cookie-source.test/start';
    const destination = 'https://stream-cookie-destination.test/final';
    const jar = new RezoCookieJar();
    const { transport, dispatches } = createRedirectingStreamTransport(
      source,
      destination,
      { 'set-cookie': 'issuer=source-response; Path=/; Secure' },
    );
    const streamResponse = new StreamResponse();
    const completion = waitForStreamCompletion(streamResponse);

    const returned = await executeRequest({
      url: source,
      method: 'GET',
      responseType: 'stream',
      _streamResponse: streamResponse,
      reactNative: { streamTransport: transport },
      onRedirect: () => true,
    } as never, {}, jar);
    if (returned === streamResponse) await completion;

    expect({
      cookiesAtWire: dispatches.map((entry) => entry.headers.cookie ?? null),
      sourceJar: jar.getCookieHeader(source),
      destinationJar: jar.getCookieHeader(destination),
    }).toEqual({
      cookiesAtWire: [null, null],
      sourceJar: 'issuer=source-response',
      destinationJar: '',
    });
  });

  it('R5 control: destination jar projection independently enforces domain, path, and Secure matching', async () => {
    const source = 'https://source.cookie-domain.test/start';
    const destination = 'http://api.cookie-domain.test/allowed/final';
    const jar = new RezoCookieJar();
    jar.setCookiesSync([
      'domainWide=allowed; Domain=cookie-domain.test; Path=/allowed',
      'plain=allowed; Domain=cookie-domain.test; Path=/allowed',
      'wrongPath=blocked; Domain=cookie-domain.test; Path=/other',
      'secureOnly=blocked; Domain=cookie-domain.test; Path=/allowed; Secure',
    ], 'https://api.cookie-domain.test/allowed/seed');
    jar.setCookiesSync(
      ['otherHostOnly=blocked; Path=/allowed'],
      'http://other.cookie-domain.test/allowed/seed',
    );
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: { Cookie: 'literal=source-only' },
      onRedirect: () => true,
    } as never, {}, jar);

    const destinationCookie = header(dispatches[1], 'cookie') || '';
    expect({
      domainWide: destinationCookie.includes('domainWide=allowed'),
      plain: destinationCookie.includes('plain=allowed'),
      literal: destinationCookie.includes('literal=source-only'),
      wrongPath: destinationCookie.includes('wrongPath=blocked'),
      secureOnly: destinationCookie.includes('secureOnly=blocked'),
      otherHostOnly: destinationCookie.includes('otherHostOnly=blocked'),
    }).toEqual({
      domainWide: true,
      plain: true,
      literal: false,
      wrongPath: false,
      secureOnly: false,
      otherHostOnly: false,
    });
  });

  it('R6: structured auth materializes exactly once before dispatch', async () => {
    const url = 'https://structured-auth.test/resource';
    const { dispatches } = installInjectedFetch(() => ok(url));

    await executeRequest({
      url,
      method: 'GET',
      auth: { username: 'user', password: 'pass' },
    } as never, {}, new RezoCookieJar());

    expect({
      url: dispatches[0]?.url,
      authorization: header(dispatches[0], 'authorization'),
      calls: dispatches.length,
    }).toEqual({
      url,
      authorization: 'Basic dXNlcjpwYXNz',
      calls: 1,
    });
  });

  it('R6: URL userinfo normalizes once, never reaches Fetch raw, and follows explicit-header > structured-auth > userinfo precedence', async () => {
    const rawUrl = 'https://url-user:url-pass@userinfo.test/resource';
    const normalizedUrl = 'https://userinfo.test/resource';
    const callerHeaders = Object.freeze({ Authorization: 'Bearer explicit-wins' });
    const { dispatches } = installInjectedFetch(() => ok(normalizedUrl));

    await executeRequest({
      url: rawUrl,
      method: 'GET',
      headers: callerHeaders,
      auth: { username: 'structured', password: 'loses' },
    } as never, {}, new RezoCookieJar());

    expect({
      providerUrl: dispatches[0]?.url,
      rawUserinfoReachedProvider: dispatches[0]?.url.includes('@') ?? true,
      authorization: header(dispatches[0], 'authorization'),
      callerHeaders,
    }).toEqual({
      providerUrl: normalizedUrl,
      rawUserinfoReachedProvider: false,
      authorization: 'Bearer explicit-wins',
      callerHeaders: { Authorization: 'Bearer explicit-wins' },
    });
  });

  it('R6: URL userinfo alone becomes Basic authorization without reaching Fetch raw', async () => {
    const rawUrl = 'https://user:pass@userinfo-only.test/resource';
    const normalizedUrl = 'https://userinfo-only.test/resource';
    const { dispatches } = installInjectedFetch(() => ok(normalizedUrl));

    await executeRequest({
      url: rawUrl,
      method: 'GET',
    } as never, {}, new RezoCookieJar());

    expect({
      providerUrl: dispatches[0]?.url,
      authorization: header(dispatches[0], 'authorization'),
      calls: dispatches.length,
    }).toEqual({
      providerUrl: normalizedUrl,
      authorization: 'Basic dXNlcjpwYXNz',
      calls: 1,
    });
  });

  it('R6: structured auth outranks URL userinfo when no explicit Authorization header exists', async () => {
    const rawUrl = 'https://url-user:url-pass@userinfo-structured.test/resource';
    const normalizedUrl = 'https://userinfo-structured.test/resource';
    const { dispatches } = installInjectedFetch(() => ok(normalizedUrl));

    await executeRequest({
      url: rawUrl,
      method: 'GET',
      auth: { username: 'structured', password: 'wins' },
    } as never, {}, new RezoCookieJar());

    expect({
      providerUrl: dispatches[0]?.url,
      authorization: header(dispatches[0], 'authorization'),
    }).toEqual({
      providerUrl: normalizedUrl,
      authorization: 'Basic c3RydWN0dXJlZDp3aW5z',
    });
  });

  it('R6: default auth outranks userinfo inherited from default baseURL and the provider sees a normalized URL', async () => {
    const normalizedUrl = 'https://default-userinfo.test/resource';
    const { dispatches } = installInjectedFetch(() => ok(normalizedUrl));

    await executeRequest({
      url: '/resource',
      method: 'GET',
    } as never, {
      baseURL: 'https://base-user:base-pass@default-userinfo.test/root/',
      auth: { username: 'default', password: 'wins' },
    } as never, new RezoCookieJar());

    expect({
      providerUrl: dispatches[0]?.url,
      rawUserinfoReachedProvider: dispatches[0]?.url.includes('@') ?? true,
      authorization: header(dispatches[0], 'authorization'),
    }).toEqual({
      providerUrl: normalizedUrl,
      rawUserinfoReachedProvider: false,
      authorization: 'Basic ZGVmYXVsdDp3aW5z',
    });
  });

  it('R6: materialized structured auth follows origin-bound lifetime and is not rematerialized after a foreign redirect', async () => {
    const source = 'https://structured-lifetime.test/start';
    const destination = 'https://structured-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      auth: { username: 'user', password: 'pass' },
      onRedirect: () => true,
    } as never, {}, new RezoCookieJar());

    expect({
      urls: dispatches.map((entry) => entry.url),
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
    }).toEqual({
      urls: [source, destination],
      authorization: ['Basic dXNlcjpwYXNz', null],
    });
  });

  it('R6: normalized URL userinfo follows origin-bound lifetime and never returns to a later provider URL', async () => {
    const rawSource = 'https://url-user:url-pass@userinfo-lifetime.test/start';
    const source = 'https://userinfo-lifetime.test/start';
    const destination = 'https://userinfo-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source) : ok(destination)
    ));

    await executeRequest({
      url: rawSource,
      method: 'GET',
      onRedirect: () => true,
    } as never, {}, new RezoCookieJar());

    expect({
      urls: dispatches.map((entry) => entry.url),
      rawUserinfoReachedProvider: dispatches.some((entry) => entry.url.includes('@')),
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
    }).toEqual({
      urls: [source, destination],
      rawUserinfoReachedProvider: false,
      authorization: ['Basic dXJsLXVzZXI6dXJsLXBhc3M=', null],
    });
  });

  it('R7: initial, inherited, persistent, and one-hop Proxy-Authorization never reach an RN origin', async () => {
    const source = 'https://proxy-metadata.test/start';
    const destination = 'https://proxy-metadata.test/final';
    const callback = vi.fn(({ url }: { url: URL }) => ({
      redirect: true,
      url: url.href,
      setHeadersOnRedirects: { 'Proxy-Authorization': 'Basic persistent-forbidden' },
      setHeaders: { 'Proxy-Authorization': 'Basic one-hop-forbidden' },
    }));
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect('/final', source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'GET',
      headers: { 'Proxy-Authorization': 'Basic inherited-forbidden' },
      onRedirect: callback,
    } as never, {}, new RezoCookieJar());

    expect({
      proxyAuthorization: dispatches.map((entry) => header(entry, 'proxy-authorization')),
      callbackCount: callback.mock.calls.length,
      adapterProxyCapability: false,
    }).toEqual({
      proxyAuthorization: [null, null],
      callbackCount: 1,
      adapterProxyCapability: false,
    });
  });

  it('R7 control: instance-default Authorization and literal Cookie persist only across exact-origin redirects', async () => {
    const source = 'https://default-authority.test/start';
    const sameOrigin = 'https://default-authority.test/same';
    const foreign = 'https://default-authority-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => {
      if (index === 0) return redirect('/same', source);
      if (index === 1) return redirect(foreign, sameOrigin);
      return ok(foreign);
    });

    await executeRequest({
      url: source,
      method: 'GET',
      onRedirect: () => true,
    } as never, {
      headers: {
        Authorization: 'Bearer default-origin-bound',
        Cookie: 'defaultLiteral=origin-bound',
      },
    }, new RezoCookieJar());

    expect({
      authorization: dispatches.map((entry) => header(entry, 'authorization')),
      cookie: dispatches.map((entry) => header(entry, 'cookie')),
    }).toEqual({
      authorization: [
        'Bearer default-origin-bound',
        'Bearer default-origin-bound',
        null,
      ],
      cookie: [
        'defaultLiteral=origin-bound',
        'defaultLiteral=origin-bound',
        null,
      ],
    });
  });

  it('R7 guardrail: callback patches cannot reintroduce hop-by-hop, connection-nominated, proxy, host, or bodyless framing headers', async () => {
    const source = 'https://guardrail.test/start';
    const destination = 'https://guardrail.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect('/final', source) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'POST',
      body: 'payload',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Encoding': 'gzip',
      },
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        method: 'GET',
        withoutBody: true,
        setHeaders: {
          Host: 'forbidden.example',
          'Proxy-Authenticate': 'Basic realm="forbidden"',
          'Proxy-Authorization': 'Basic forbidden',
          Connection: 'X-Callback-Hop',
          'X-Callback-Hop': 'forbidden',
          'Proxy-Connection': 'keep-alive',
          'Keep-Alive': 'timeout=10',
          'Transfer-Encoding': 'chunked',
          TE: 'trailers',
          Trailer: 'X-Trailer',
          Upgrade: 'websocket',
          'Content-Length': '999',
          'Content-Type': 'application/forbidden',
          'Content-Encoding': 'gzip',
        },
      }),
    } as never, {}, new RezoCookieJar());

    const destinationDispatch = dispatches[1];
    expect({
      method: destinationDispatch?.method,
      body: destinationDispatch?.body ?? null,
      host: header(destinationDispatch, 'host'),
      proxyAuthenticate: header(destinationDispatch, 'proxy-authenticate'),
      proxyAuthorization: header(destinationDispatch, 'proxy-authorization'),
      connection: header(destinationDispatch, 'connection'),
      nominated: header(destinationDispatch, 'x-callback-hop'),
      proxyConnection: header(destinationDispatch, 'proxy-connection'),
      keepAlive: header(destinationDispatch, 'keep-alive'),
      transferEncoding: header(destinationDispatch, 'transfer-encoding'),
      te: header(destinationDispatch, 'te'),
      trailer: header(destinationDispatch, 'trailer'),
      upgrade: header(destinationDispatch, 'upgrade'),
      contentLength: header(destinationDispatch, 'content-length'),
      contentType: header(destinationDispatch, 'content-type'),
      contentEncoding: header(destinationDispatch, 'content-encoding'),
    }).toEqual({
      method: 'GET',
      body: null,
      host: null,
      proxyAuthenticate: null,
      proxyAuthorization: null,
      connection: null,
      nominated: null,
      proxyConnection: null,
      keepAlive: null,
      transferEncoding: null,
      te: null,
      trailer: null,
      upgrade: null,
      contentLength: null,
      contentType: null,
      contentEncoding: null,
    });
  });

  it('R7 representation: callback body replacement drops stale metadata unless explicitly reissued', async () => {
    const source = 'https://representation.test/start';
    const destination = 'https://representation-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source, 307) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'POST',
      body: 'original',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
      },
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        method: 'POST',
        body: 'replacement',
      }),
    } as never, {}, new RezoCookieJar());

    expect({
      method: dispatches[1]?.method,
      body: dispatches[1]?.body,
      contentType: header(dispatches[1], 'content-type'),
      contentEncoding: header(dispatches[1], 'content-encoding'),
      contentLength: header(dispatches[1], 'content-length'),
    }).toEqual({
      method: 'POST',
      body: 'replacement',
      contentType: null,
      contentEncoding: null,
      contentLength: null,
    });
  });

  it('R7 representation control: a 307 byte-identical replay retains its representation metadata', async () => {
    const source = 'https://representation-replay.test/start';
    const destination = 'https://representation-replay-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source, 307) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'POST',
      body: 'original',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
      },
      onRedirect: () => true,
    } as never, {}, new RezoCookieJar());

    expect({
      method: dispatches[1]?.method,
      body: dispatches[1]?.body,
      contentType: header(dispatches[1], 'content-type'),
      contentEncoding: header(dispatches[1], 'content-encoding'),
      contentLength: header(dispatches[1], 'content-length'),
    }).toEqual({
      method: 'POST',
      body: 'original',
      contentType: 'application/octet-stream',
      contentEncoding: 'gzip',
      contentLength: null,
    });
  });

  it('R7 representation control: a replacement body may explicitly reissue representation metadata but not Content-Length', async () => {
    const source = 'https://representation-reissue.test/start';
    const destination = 'https://representation-reissue-foreign.test/final';
    const { dispatches } = installInjectedFetch((_dispatch, index) => (
      index === 0 ? redirect(destination, source, 307) : ok(destination)
    ));

    await executeRequest({
      url: source,
      method: 'POST',
      body: 'original',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
      },
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        method: 'POST',
        body: '{"replacement":true}',
        setHeaders: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'br',
          'Content-Length': '999',
        },
      }),
    } as never, {}, new RezoCookieJar());

    expect({
      method: dispatches[1]?.method,
      body: dispatches[1]?.body,
      contentType: header(dispatches[1], 'content-type'),
      contentEncoding: header(dispatches[1], 'content-encoding'),
      contentLength: header(dispatches[1], 'content-length'),
    }).toEqual({
      method: 'POST',
      body: '{"replacement":true}',
      contentType: 'application/json',
      contentEncoding: 'br',
      contentLength: null,
    });
  });
});

describe(`A+ Phase 1c-c RN U2 redirect rollback (${INJECTED_EVIDENCE})`, () => {
  it('callback denial commits no URL/count/history/method/body state and performs no second dispatch', async () => {
    const source = 'https://rollback.test/deny';
    const destination = 'https://rollback.test/denied-target';
    const body = Object.freeze({ immutable: true });
    const callerHeaders = Object.freeze({ 'Content-Type': 'application/json' });
    const input = {
      url: source,
      method: 'POST',
      body,
      headers: callerHeaders,
      beforeRedirect: vi.fn(() => false),
    } as const;
    const { dispatches } = installInjectedFetch(() => redirect(destination, source));

    const error = await captureFailure(executeRequest(input as never, {}, new RezoCookieJar()));

    expect({
      code: error.code,
      calls: dispatches.length,
      firstMethod: dispatches[0]?.method,
      firstBody: dispatches[0]?.body,
      redirectCount: error.config.redirectCount,
      historyLength: error.config.redirectHistory.length,
      finalUrl: error.config.finalUrl,
      configMethod: error.config.method,
      originalBodyIdentity: error.config.originalBody === body,
      callbackCount: input.beforeRedirect.mock.calls.length,
      callerMethod: input.method,
      callerBodyIdentity: input.body === body,
      callerHeaders,
    }).toEqual({
      code: 'REZ_REDIRECT_DENIED',
      calls: 1,
      firstMethod: 'POST',
      firstBody: JSON.stringify(body),
      redirectCount: 0,
      historyLength: 0,
      finalUrl: source,
      configMethod: 'POST',
      originalBodyIdentity: true,
      callbackCount: 1,
      callerMethod: 'POST',
      callerBodyIdentity: true,
      callerHeaders: { 'Content-Type': 'application/json' },
    });
  });

  it('callback throw commits no URL/count/history/method/body state and preserves the thrown cause safely', async () => {
    const source = 'https://rollback.test/throw';
    const destination = 'https://rollback.test/throw-target';
    const body = Object.freeze({ immutable: 'throw' });
    const callbackError = Object.assign(new Error('redirect callback marker'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
    const callback = vi.fn(() => {
      throw callbackError;
    });
    const input = {
      url: source,
      method: 'POST',
      body,
      headers: Object.freeze({ 'Content-Type': 'application/json' }),
      onRedirect: callback,
    } as const;
    const { dispatches } = installInjectedFetch(() => redirect(destination, source));

    const error = await captureFailure(executeRequest(input as never, {}, new RezoCookieJar()));

    expect({
      code: error.code,
      message: error.message,
      calls: dispatches.length,
      redirectCount: error.config.redirectCount,
      historyLength: error.config.redirectHistory.length,
      finalUrl: error.config.finalUrl,
      configMethod: error.config.method,
      originalBodyIdentity: error.config.originalBody === body,
      callbackCount: callback.mock.calls.length,
      callerMethod: input.method,
      callerBodyIdentity: input.body === body,
    }).toEqual({
      code: 'ERR_INVALID_ARG_TYPE',
      message: 'redirect callback marker',
      calls: 1,
      redirectCount: 0,
      historyLength: 0,
      finalUrl: source,
      configMethod: 'POST',
      originalBodyIdentity: true,
      callbackCount: 1,
      callerMethod: 'POST',
      callerBodyIdentity: true,
    });
  });

  it('Fetch callback denial keeps provider-hinted redirect cookies bound to the source', async () => {
    const source = 'https://fetch-denial-cookie-source.test/start';
    const destination = 'https://fetch-denial-cookie-destination.test/final';
    const jar = new RezoCookieJar();
    const { dispatches } = installInjectedFetch(() => ({
      status: 302,
      statusText: 'Found',
      url: destination,
      headers: {
        location: destination,
        'set-cookie': 'issuer=source-response; Path=/; Secure',
      },
    }));

    const error = await captureFailure(executeRequest({
      url: source,
      method: 'GET',
      onRedirect: () => false,
    } as never, {}, jar));

    expect({
      code: error.code,
      providerCalls: dispatches.length,
      finalUrl: error.config.finalUrl,
      sourceJar: jar.getCookieHeader(source),
      destinationJar: jar.getCookieHeader(destination),
    }).toEqual({
      code: 'REZ_REDIRECT_DENIED',
      providerCalls: 1,
      finalUrl: source,
      sourceJar: 'issuer=source-response',
      destinationJar: '',
    });
  });

  it('stream callback denial keeps provider-hinted redirect cookies bound to the source', async () => {
    const source = 'https://stream-denial-cookie-source.test/start';
    const destination = 'https://stream-denial-cookie-destination.test/final';
    const jar = new RezoCookieJar();
    const { transport, dispatches } = createRedirectingStreamTransport(
      source,
      destination,
      { 'set-cookie': 'issuer=source-response; Path=/; Secure' },
    );
    const streamResponse = new StreamResponse();
    const failure = waitForStreamFailure(streamResponse);

    await executeRequest({
      url: source,
      method: 'GET',
      responseType: 'stream',
      _streamResponse: streamResponse,
      reactNative: { streamTransport: transport },
      onRedirect: () => false,
    } as never, {}, jar);
    const error = await failure;

    expect({
      code: error.code,
      providerCalls: dispatches.length,
      finalUrl: error.config.finalUrl,
      sourceJar: jar.getCookieHeader(source),
      destinationJar: jar.getCookieHeader(destination),
    }).toEqual({
      code: 'REZ_REDIRECT_DENIED',
      providerCalls: 1,
      finalUrl: source,
      sourceJar: 'issuer=source-response',
      destinationJar: '',
    });
  });

  const streamRollbackCases = [
    {
      name: 'callback denial',
      expectedCode: 'REZ_REDIRECT_DENIED',
      createCallback: () => vi.fn(() => false),
    },
    {
      name: 'callback throw',
      expectedCode: 'ERR_INVALID_ARG_TYPE',
      createCallback: () => vi.fn(() => {
        throw Object.assign(new Error('stream redirect callback marker'), {
          code: 'ERR_INVALID_ARG_TYPE',
        });
      }),
    },
    {
      name: 'invalid callback URL',
      expectedCode: 'ERR_INVALID_URL',
      createCallback: () => vi.fn(() => ({
        redirect: true,
        url: 'ftp://invalid-stream-target.test/resource',
      })),
    },
    {
      name: 'invalid callback header patch',
      expectedCode: 'ERR_INVALID_ARG_TYPE',
      createCallback: () => vi.fn(({ url }: { url: URL }) => ({
        redirect: true,
        url: url.href,
        setHeaders: { 'Invalid Header Name': 'rejected' },
      })),
    },
  ] as const;

  it.each(streamRollbackCases)('$name is transactional on the hop-visible stream path', async ({
    name,
    expectedCode,
    createCallback,
  }) => {
    const slug = name.replaceAll(' ', '-');
    const source = `https://stream-rollback.test/${slug}`;
    const destination = `https://stream-rollback.test/${slug}/target`;
    const body = Object.freeze({ immutable: slug });
    const callback = createCallback();
    const { transport, dispatches } = createRedirectingStreamTransport(source, destination);
    const streamResponse = new StreamResponse();
    const failure = waitForStreamFailure(streamResponse);
    const input = {
      url: source,
      method: 'POST',
      body,
      headers: Object.freeze({ 'Content-Type': 'application/json' }),
      responseType: 'stream',
      _streamResponse: streamResponse,
      reactNative: { streamTransport: transport },
      onRedirect: callback,
    } as const;

    const returned = await executeRequest(input as never, {}, new RezoCookieJar());
    const error = await failure;

    expect({
      sameResponse: returned === streamResponse,
      code: error.code,
      providerCalls: dispatches.length,
      redirectCount: error.config.redirectCount,
      historyLength: error.config.redirectHistory.length,
      finalUrl: error.config.finalUrl,
      configMethod: error.config.method,
      originalBodyIdentity: error.config.originalBody === body,
      callbackCalls: callback.mock.calls.length,
      callerMethod: input.method,
      callerBodyIdentity: input.body === body,
    }).toEqual({
      sameResponse: true,
      code: expectedCode,
      providerCalls: 1,
      redirectCount: 0,
      historyLength: 0,
      finalUrl: source,
      configMethod: 'POST',
      originalBodyIdentity: true,
      callbackCalls: 1,
      callerMethod: 'POST',
      callerBodyIdentity: true,
    });
  });
});
