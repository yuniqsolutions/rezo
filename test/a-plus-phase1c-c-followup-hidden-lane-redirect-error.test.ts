/**
 * Phase 1c-c follow-up — cURL / React Native / XHR redirect-error routing.
 *
 * Contract: DECISION-106 opt-1 + DECISION-107 opt-1 composition pin:
 * `followRedirects: false` performs zero onward dispatch; with no user
 * validateStatus (or validateStatus: null) the untouched source 3xx
 * RESOLVES; an explicitly resolved user validator that rejects the 3xx
 * rejects ordinary REZ_HTTP_ERROR carrying the source response — never a
 * redirect-control code. Only the adapter's implicit 2xx default is
 * bypassed for that manual settlement. `maxRedirects: 0`
 * rejects REZ_REDIRECT_DENIED (-1032) with maxRedirectsReached === true.
 * Positive exhaustion rejects REZ_MAX_REDIRECTS_EXCEEDED (-1035). 3xx
 * without Location while following rejects REZ_MISSING_REDIRECT_LOCATION
 * (-1028). Malformed Location rejects structured ERR_INVALID_URL (-1009).
 * Hidden browser-owned lanes refuse unenforceable disable requests before
 * dispatch with REZ_UNSUPPORTED_CAPABILITY (-1075).
 *
 * Reachability note: rows marked [carrier] stay red until shared prep
 * projects resolved followRedirects/maxRedirects onto the adapter-consumed
 * carrier (Tayo Phase 4). They fail today because the option is silently
 * dropped — that IS the defect under test, not an environment artifact.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';

// Fixture constraint (executed evidence, 2026-08-16): src/adapters/xhr.ts:62
// captures `hasXHR: typeof XMLHttpRequest !== 'undefined'` at MODULE LOAD.
// Real browsers always satisfy it; an injected fake must therefore exist
// BEFORE the adapter modules are imported. Static imports hoist above any
// statement, so the entries are loaded via dynamic import after the fake
// XMLHttpRequest below is installed. Test-harness mechanics only — no
// product behavior is altered by this ordering.
type XHRScenario = { status: number; statusText?: string; headers: string; body?: string; responseURL?: string };

let xhrSends = 0;
let xhrScenario: XHRScenario = { status: 200, headers: '' };

function installFakeXMLHttpRequest(): void {
  (globalThis as any).XMLHttpRequest = FakeXMLHttpRequest;
}

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

installFakeXMLHttpRequest();
const curlClient = (await import('../src/adapters/entries/curl')).default;
const rnClient = (await import('../src/adapters/entries/react-native')).default;
const xhrClient = (await import('../src/adapters/entries/xhr')).default;

const REDIRECT_CODES = [
  'REZ_MISSING_REDIRECT_LOCATION',
  'REZ_REDIRECT_DENIED',
  'REZ_MAX_REDIRECTS_EXCEEDED',
  'REZ_REDIRECT_CYCLE_DETECTED',
] as const;

// ---------------------------------------------------------------------------
// Loopback fixture with per-path hit ledger
// ---------------------------------------------------------------------------
const hits: Record<string, number> = {};
let server: Server;
let port = 0;
const base = () => `http://127.0.0.1:${port}`;

function resetHits(): void {
  for (const key of Object.keys(hits)) delete hits[key];
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    hits[path] = (hits[path] ?? 0) + 1;
    switch (path) {
      case '/302-no-location':
        res.writeHead(302);
        res.end();
        return;
      case '/302-malformed':
        res.writeHead(302, { Location: 'http://[' });
        res.end();
        return;
      case '/302-forbidden':
        res.writeHead(302, { Location: `${base()}/forbidden` });
        res.end();
        return;
      case '/loop-a':
        res.writeHead(302, { Location: `${base()}/loop-b` });
        res.end();
        return;
      case '/loop-b':
        res.writeHead(302, { Location: `${base()}/loop-a` });
        res.end();
        return;
      case '/304-with-location':
        res.writeHead(304, { Location: `${base()}/forbidden` });
        res.end();
        return;
      case '/404':
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      case '/500':
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      case '/forbidden':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('FORBIDDEN-REACHED');
        return;
      default:
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Unhandled-rejection ledger: every row requires it to stay empty.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
beforeEach(() => {
  resetHits();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.removeListener('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    const value = await promise;
    return { __resolved: true, value };
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// cURL adapter — native lane (real curl binary, loopback)
// ---------------------------------------------------------------------------
describe('curl adapter redirect-error routing', () => {
  it('C1 — positive limit exhaustion maps native exit 47 to REZ_MAX_REDIRECTS_EXCEEDED', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/loop-a`, { maxRedirects: 1, timeout: 8000, retry: false as never }),
    );
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
    expect(error.errno).toBe(-1035);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect((hits['/loop-a'] ?? 0) + (hits['/loop-b'] ?? 0)).toBe(2);
  });

  it('C2 — terminal 3xx without Location while following yields REZ_MISSING_REDIRECT_LOCATION', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-no-location`, { timeout: 8000, retry: false as never }),
    );
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    expect(error.response?.status).toBe(302);
    expect(hits['/302-no-location']).toBe(1);
  });

  it('C3 — malformed raw Location stays structured ERR_INVALID_URL (control)', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-malformed`, { timeout: 8000, retry: false as never }),
    );
    expect(error.code).toBe('ERR_INVALID_URL');
    expect(error.errno).toBe(-1009);
    expect(hits['/302-malformed']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  // Fixture rule (v6): composition rows use a MALFORMED Location — the row can
  // only pass if the untaken hop's Location is never parsed.
  it('C4 — [carrier] followRedirects:false with NO user validateStatus resolves the untouched 302 (malformed Location never parsed)', async () => {
    const response: any = await curlClient.get(`${base()}/302-malformed`, {
      followRedirects: false, timeout: 8000, retry: false as never,
    });
    expect(response.status).toBe(302);
    expect(String(response.headers?.get?.('location') ?? response.headers?.location)).toBe('http://[');
    expect(hits['/302-malformed']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C5 — [carrier] followRedirects:false with validateStatus:null resolves the untouched 302 (malformed Location never parsed)', async () => {
    const response: any = await curlClient.get(`${base()}/302-malformed`, {
      followRedirects: false, timeout: 8000, retry: false as never,
      validateStatus: null as never,
    });
    expect(response.status).toBe(302);
    expect(hits['/302-malformed']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C6 — [carrier] followRedirects:false + explicit 2xx-only validateStatus rejects ordinary REZ_HTTP_ERROR with the source 302 (malformed Location never parsed)', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-malformed`, {
        followRedirects: false, timeout: 8000, retry: false as never,
        validateStatus: (status: number) => status >= 200 && status < 300,
      }),
    );
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(REDIRECT_CODES).not.toContain(error.code);
    expect(error.response?.status).toBe(302);
    expect(hits['/302-malformed']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C7 — [carrier] public maxRedirects:0 refuses the first hop with REZ_REDIRECT_DENIED', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-forbidden`, { maxRedirects: 0, timeout: 8000, retry: false as never }),
    );
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C8 — per-hop guarantee refusal stays pre-dispatch (control)', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-forbidden`, {
        timeout: 8000, retry: false as never, onRedirect: () => true,
      } as never),
    );
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(Object.keys(hits)).toHaveLength(0);
  });

  it('C9 — ordinary 404 keeps REZ_HTTP_ERROR with response metadata (control)', async () => {
    const error = await rejection(curlClient.get(`${base()}/404`, { timeout: 8000, retry: false as never }));
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(error.response?.status).toBe(404);
  });

  it('C10 — retry-disabled 500 keeps REZ_HTTP_ERROR with response metadata (control)', async () => {
    const error = await rejection(curlClient.get(`${base()}/500`, { timeout: 8000, retry: false as never }));
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(error.response?.status).toBe(500);
    expect(hits['/500']).toBe(1);
  });

  it('C11 — 304 (+Location) under followRedirects:false with no validator stays non-redirect (settlement excludes 304; exact -1031)', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/304-with-location`, {
        followRedirects: false, timeout: 8000, retry: false as never,
      }),
    );
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(error.errno).toBe(-1031);
    expect(error.response?.status).toBe(304);
    expect(REDIRECT_CODES).not.toContain(error.code);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C12 — [carrier] instance-default followRedirects:false with request absent resolves the untouched 302', async () => {
    const instance = (curlClient as any).create({ followRedirects: false });
    const response: any = await instance.get(`${base()}/302-forbidden`, { timeout: 8000, retry: false });
    expect(response.status).toBe(302);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C13 — request followRedirects:true overrides an instance-default false (follows — control)', async () => {
    const instance = (curlClient as any).create({ followRedirects: false });
    const response: any = await instance.get(`${base()}/302-forbidden`, {
      followRedirects: true, timeout: 8000, retry: false,
    });
    expect(response.status).toBe(200);
    expect(hits['/forbidden']).toBe(1);
  });

  it('C14 — request positive maxRedirects overrides an instance-default zero (follows — control)', async () => {
    const instance = (curlClient as any).create({ maxRedirects: 0 });
    const response: any = await instance.get(`${base()}/302-forbidden`, {
      maxRedirects: 5, timeout: 8000, retry: false,
    });
    expect(response.status).toBe(200);
    expect(hits['/forbidden']).toBe(1);
  });

  it('C15 — [carrier] instance-default maxRedirects:0 with request absent rejects REZ_REDIRECT_DENIED', async () => {
    const instance = (curlClient as any).create({ maxRedirects: 0 });
    const error = await rejection(instance.get(`${base()}/302-forbidden`, { timeout: 8000, retry: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });

  it('C16 — [carrier] same-level followRedirects:false + maxRedirects:0 — zero denial wins (fail-closed)', async () => {
    const error = await rejection(
      curlClient.get(`${base()}/302-forbidden`, {
        followRedirects: false, maxRedirects: 0, timeout: 8000, retry: false as never,
      }),
    );
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(hits['/302-forbidden']).toBe(1);
    expect(hits['/forbidden']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// React Native adapter — injected manual-hop fetch
// ---------------------------------------------------------------------------
type RNScenario = (url: string) => { status: number; headers: Record<string, string>; body?: string };

const rnCalls: string[] = [];
let rnScenario: RNScenario = () => ({ status: 200, headers: {} });

class FakeFetchResponse {
  status: number;
  statusText: string;
  headers: Headers;
  url = '';
  #body: string;
  constructor(status: number, headers: Record<string, string>, body = '') {
    this.status = status;
    this.statusText = status === 302 ? 'Found' : status === 304 ? 'Not Modified' : 'OK';
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

const RN_BASE = 'http://rn.test';
const rnRedirectTo = (target: string): RNScenario => (url) =>
  url.endsWith('/start')
    ? { status: 302, headers: { location: target } }
    : { status: 200, headers: {}, body: 'FINAL' };

describe('react-native adapter redirect-error routing', () => {
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    (globalThis as any).fetch = async (url: string | URL) => {
      const value = String(url);
      rnCalls.push(value);
      const s = rnScenario(value);
      return new FakeFetchResponse(s.status, s.headers, s.body ?? '');
    };
  });
  afterAll(() => { (globalThis as any).fetch = realFetch; });
  beforeEach(() => { rnCalls.length = 0; });

  const rnGet = (req: Record<string, unknown>) =>
    rnClient.request({ url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false, ...req });

  it('R1 — 3xx without Location classifies as redirect and yields REZ_MISSING_REDIRECT_LOCATION', async () => {
    rnScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: {} } : { status: 200, headers: {} });
    const error = await rejection(rnGet({}));
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    expect(error.response?.status).toBe(302);
    expect(rnCalls).toHaveLength(1);
  });

  it('R2 — malformed raw Location yields structured ERR_INVALID_URL', async () => {
    rnScenario = (u) => (u.endsWith('/start') ? { status: 302, headers: { location: 'http://[' } } : { status: 200, headers: {} });
    const error = await rejection(rnGet({}));
    expect(error.code).toBe('ERR_INVALID_URL');
    expect(error.errno).toBe(-1009);
    expect(rnCalls).toHaveLength(1);
  });

  // Fixture rule (v6): composition rows use a MALFORMED Location — the row can
  // only pass if the untaken hop's Location is never parsed.
  const rnMalformedRedirect: RNScenario = (u) =>
    u.endsWith('/start') ? { status: 302, headers: { location: 'http://[' } } : { status: 200, headers: {} };

  it('R3 — [carrier] followRedirects:false with NO user validateStatus resolves the untouched 302 (malformed Location never parsed)', async () => {
    rnScenario = rnMalformedRedirect;
    const response: any = await rnGet({ followRedirects: false });
    expect(response.status).toBe(302);
    expect(rnCalls).toHaveLength(1);
  });

  it('R4 — [carrier] followRedirects:false with validateStatus:null resolves the untouched 302 (malformed Location never parsed)', async () => {
    rnScenario = rnMalformedRedirect;
    const response: any = await rnGet({ followRedirects: false, validateStatus: null });
    expect(response.status).toBe(302);
    expect(rnCalls).toHaveLength(1);
  });

  it('R5 — [carrier] followRedirects:false + explicit 2xx-only validateStatus rejects ordinary REZ_HTTP_ERROR with the source 302 (malformed Location never parsed)', async () => {
    rnScenario = rnMalformedRedirect;
    const error = await rejection(rnGet({
      followRedirects: false,
      validateStatus: (status: number) => status >= 200 && status < 300,
    }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(REDIRECT_CODES).not.toContain(error.code);
    expect(error.response?.status).toBe(302);
    expect(rnCalls).toHaveLength(1);
  });

  it('R6 — [carrier] public maxRedirects:0 rejects REZ_REDIRECT_DENIED via the existing branch', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const error = await rejection(rnGet({ maxRedirects: 0 }));
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect(rnCalls).toHaveLength(1);
  });

  it('R7 — callback denial keeps REZ_REDIRECT_DENIED (control)', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const error = await rejection(rnGet({ onRedirect: () => false }));
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(rnCalls).toHaveLength(1);
  });

  it('R8 — positive limit exhaustion keeps REZ_MAX_REDIRECTS_EXCEEDED (control)', async () => {
    rnScenario = (u) =>
      u.endsWith('/start') ? { status: 302, headers: { location: `${RN_BASE}/hop1` } }
      : u.endsWith('/hop1') ? { status: 302, headers: { location: `${RN_BASE}/hop2` } }
      : { status: 200, headers: {}, body: 'FINAL' };
    const error = await rejection(rnGet({ maxRedirects: 1 }));
    expect(error.code).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
    expect(error.errno).toBe(-1035);
    expect(rnCalls).toHaveLength(2);
  });

  it('R9 — enabled cycle detection keeps REZ_REDIRECT_CYCLE_DETECTED (control)', async () => {
    rnScenario = (u) =>
      u.endsWith('/start') ? { status: 302, headers: { location: `${RN_BASE}/a` } }
      : u.endsWith('/a') ? { status: 302, headers: { location: `${RN_BASE}/start` } }
      : { status: 200, headers: {} };
    const error = await rejection(rnGet({ enableRedirectCycleDetection: true }));
    expect(error.code).toBe('REZ_REDIRECT_CYCLE_DETECTED');
    expect(error.errno).toBe(-1036);
  });

  it('R10 — ordinary 404 and retry-disabled 500 keep REZ_HTTP_ERROR (two obligations, non-short-circuit)', async () => {
    rnScenario = () => ({ status: 404, headers: {}, body: 'not found' });
    const notFound = await rejection(rnGet({}));
    rnScenario = () => ({ status: 500, headers: {}, body: 'boom' });
    const serverError = await rejection(rnGet({}));
    // Both executed above; both asserted below — a 4xx failure cannot mask the 5xx half.
    expect([notFound.code, serverError.code]).toEqual(['REZ_HTTP_ERROR', 'REZ_HTTP_ERROR']);
    expect([notFound.response?.status, serverError.response?.status]).toEqual([404, 500]);
  });

  it('R11 — 304 (+Location) under followRedirects:false with no validator stays non-redirect (settlement excludes 304; exact -1031)', async () => {
    rnScenario = () => ({ status: 304, headers: { location: `${RN_BASE}/forbidden` } });
    const error = await rejection(rnGet({ followRedirects: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(error.errno).toBe(-1031);
    expect(error.response?.status).toBe(304);
    expect(REDIRECT_CODES).not.toContain(error.code);
    expect(rnCalls).toHaveLength(1);
  });

  it('R12 — [carrier] instance-default followRedirects:false with request absent resolves the untouched 302', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const instance = (rnClient as any).create({ followRedirects: false });
    const response: any = await instance.request({ url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false });
    expect(response.status).toBe(302);
    expect(rnCalls).toHaveLength(1);
  });

  it('R13 — request followRedirects:true overrides an instance-default false (follows — control)', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const instance = (rnClient as any).create({ followRedirects: false });
    const response: any = await instance.request({
      url: `${RN_BASE}/start`, method: 'GET', followRedirects: true, timeout: 8000, retry: false,
    });
    expect(response.status).toBe(200);
    expect(rnCalls).toHaveLength(2);
  });

  it('R14 — request positive maxRedirects overrides an instance-default zero (follows — control)', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const instance = (rnClient as any).create({ maxRedirects: 0 });
    const response: any = await instance.request({
      url: `${RN_BASE}/start`, method: 'GET', maxRedirects: 5, timeout: 8000, retry: false,
    });
    expect(response.status).toBe(200);
    expect(rnCalls).toHaveLength(2);
  });

  it('R15 — [carrier] instance-default maxRedirects:0 with request absent rejects REZ_REDIRECT_DENIED', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const instance = (rnClient as any).create({ maxRedirects: 0 });
    const error = await rejection(instance.request({ url: `${RN_BASE}/start`, method: 'GET', timeout: 8000, retry: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(error.config?.maxRedirectsReached).toBe(true);
    expect(rnCalls).toHaveLength(1);
  });

  it('R16 — [carrier] same-level followRedirects:false + maxRedirects:0 — zero denial wins (fail-closed)', async () => {
    rnScenario = rnRedirectTo(`${RN_BASE}/forbidden`);
    const error = await rejection(rnGet({ followRedirects: false, maxRedirects: 0 }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_REDIRECT_DENIED');
    expect(error.errno).toBe(-1032);
    expect(rnCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// XHR adapter — injected XMLHttpRequest, browser-owned hop semantics
// ---------------------------------------------------------------------------

describe('xhr adapter redirect-error routing', () => {
  beforeEach(() => { xhrSends = 0; });

  const xhrGet = (req: Record<string, unknown>) =>
    xhrClient.request({ url: 'http://xhr.test/start', method: 'GET', timeout: 8000, retry: false, ...req });

  it('X1 — followRedirects:false refuses pre-dispatch with REZ_UNSUPPORTED_CAPABILITY (browser owns hops)', async () => {
    xhrScenario = { status: 200, headers: '', body: 'FINAL', responseURL: 'http://xhr.test/forbidden' };
    const error = await rejection(xhrGet({ followRedirects: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(xhrSends).toBe(0);
  });

  it('X2 — maxRedirects:0 refuses pre-dispatch with REZ_UNSUPPORTED_CAPABILITY (browser owns hops)', async () => {
    xhrScenario = { status: 200, headers: '', body: 'FINAL', responseURL: 'http://xhr.test/forbidden' };
    const error = await rejection(xhrGet({ maxRedirects: 0 }));
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(xhrSends).toBe(0);
  });

  it('X3 — delivered terminal 302 without Location yields REZ_MISSING_REDIRECT_LOCATION', async () => {
    xhrScenario = { status: 302, statusText: 'Found', headers: '' };
    const error = await rejection(xhrGet({}));
    expect(error.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    expect(error.errno).toBe(-1028);
    expect(error.response?.status).toBe(302);
    expect(xhrSends).toBe(1);
  });

  it('X4 — per-hop guarantee refusal stays pre-dispatch (control)', async () => {
    xhrScenario = { status: 200, headers: '' };
    const error = await rejection(xhrGet({ onRedirect: () => true }));
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(xhrSends).toBe(0);
  });

  it('X5 — ordinary 404 and retry-disabled 500 keep REZ_HTTP_ERROR (two obligations, non-short-circuit)', async () => {
    xhrScenario = { status: 404, statusText: 'Not Found', headers: '', body: 'not found' };
    const notFound = await rejection(xhrGet({}));
    xhrScenario = { status: 500, statusText: 'Server Error', headers: '', body: 'boom' };
    const serverError = await rejection(xhrGet({}));
    // Both executed above; both asserted below — a 4xx failure cannot mask the 5xx half.
    expect([notFound.code, serverError.code]).toEqual(['REZ_HTTP_ERROR', 'REZ_HTTP_ERROR']);
    expect([notFound.response?.status, serverError.response?.status]).toEqual([404, 500]);
  });

  it('X6 — rejected non-redirect 304 receives exact ordinary REZ_HTTP_ERROR/-1031 and no redirect-control code', async () => {
    xhrScenario = { status: 304, statusText: 'Not Modified', headers: 'location: http://xhr.test/forbidden\r\n' };
    const error = await rejection(xhrGet({}));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_HTTP_ERROR');
    expect(error.errno).toBe(-1031);
    expect(error.response?.status).toBe(304);
    expect(REDIRECT_CODES).not.toContain(error.code);
    expect(xhrSends).toBe(1);
  });

  it('X7 — instance-default followRedirects:false refuses pre-dispatch with REZ_UNSUPPORTED_CAPABILITY', async () => {
    xhrScenario = { status: 200, headers: '', body: 'FINAL' };
    const instance = (xhrClient as any).create({ followRedirects: false });
    const error = await rejection(instance.request({ url: 'http://xhr.test/start', method: 'GET', timeout: 8000, retry: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(xhrSends).toBe(0);
  });

  it('X8 — instance-default maxRedirects:0 refuses pre-dispatch with REZ_UNSUPPORTED_CAPABILITY', async () => {
    xhrScenario = { status: 200, headers: '', body: 'FINAL' };
    const instance = (xhrClient as any).create({ maxRedirects: 0 });
    const error = await rejection(instance.request({ url: 'http://xhr.test/start', method: 'GET', timeout: 8000, retry: false }));
    expect(error.__resolved).toBeUndefined();
    expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    expect(error.errno).toBe(-1075);
    expect(xhrSends).toBe(0);
  });
});
