/**
 * A+ Phase 1c-c — adapter-local redirect-capability refusal.
 *
 * These probes invoke the raw Fetch/XHR adapter with no response cache. Each
 * probe runs in a fresh Node realm so browser globals cannot leak into Vitest,
 * and so XHR availability is captured before its adapter module is evaluated.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type AdapterName = 'fetch' | 'xhr';
type Scenario =
  | 'hidden'
  | 'worker'
  | 'empty'
  | 'unavailable'
  | 'invalid'
  | 'server'
  | 'edge';
type Carrier =
  | 'request-before'
  | 'request-on'
  | 'default-before'
  | 'default-on'
  | 'request-hooks'
  | 'default-hooks'
  | 'live-hooks'
  | 'plural'
  | 'empty';

interface ProbeResult {
  cacheEnabled: boolean | null;
  callbackCalls: number;
  error: null | {
    code?: string;
    errno?: number;
    isRetryable?: boolean;
    message: string;
    name: string;
    serialized?: unknown;
  };
  fetchCalls: number;
  ownKeys: string[];
  response: null | { code?: string; status?: number };
  xhrConstructed: number;
  xhrSent: number;
}

const adapterUrls = {
  fetch: pathToFileURL(resolve('src/adapters/fetch.ts')).href,
  xhr: pathToFileURL(resolve('src/adapters/xhr.ts')).href,
} as const;
const cookieJarUrl = pathToFileURL(resolve('src/cookies/cookie-jar.ts')).href;
const rezoUrl = pathToFileURL(resolve('src/core/rezo.ts')).href;

function runProbe(
  adapterName: AdapterName,
  scenario: Scenario,
  carrier: Carrier = 'empty',
): ProbeResult {
  const source = `
const adapterName = ${JSON.stringify(adapterName)};
const scenario = ${JSON.stringify(scenario)};
const carrier = ${JSON.stringify(carrier)};
const adapterUrl = ${JSON.stringify(adapterUrls[adapterName])};
const cookieJarUrl = ${JSON.stringify(cookieJarUrl)};
const rezoUrl = ${JSON.stringify(rezoUrl)};
const keys = [
  'process', 'Bun', 'Deno', 'EdgeRuntime', 'caches', 'window', 'document',
  'navigator', 'self', 'WorkerGlobalScope', 'importScripts', 'fetch',
  'XMLHttpRequest',
];
const saved = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const hostProcess = globalThis.process;
const NativeResponse = globalThis.Response;
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, {
  configurable: true,
  enumerable: true,
  value,
  writable: true,
});
const clearGlobal = (key) => Reflect.deleteProperty(globalThis, key);
const restore = () => {
  for (const [key, descriptor] of saved) {
    Reflect.deleteProperty(globalThis, key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
};

let callbackCalls = 0;
let cacheEnabled = null;
let fetchCalls = 0;
let xhrConstructed = 0;
let xhrSent = 0;
let result;

class FakeXMLHttpRequest {
  constructor() {
    xhrConstructed += 1;
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this.onabort = null;
    this.onprogress = null;
    this.upload = {};
    this.response = null;
    this.responseText = '{"ok":true}';
    this.responseType = '';
    this.responseURL = '';
    this.status = 200;
    this.statusText = 'OK';
    this.timeout = 0;
    this.withCredentials = false;
  }
  open(_method, url) { this.responseURL = url; }
  setRequestHeader() {}
  abort() {}
  getAllResponseHeaders() { return 'content-type: application/json\\r\\n'; }
  getResponseHeader(name) {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  }
  send() {
    xhrSent += 1;
    this.onload?.();
  }
}

try {
  const { RezoCookieJar } = await import(cookieJarUrl);
  const browserLike = ['hidden', 'empty', 'unavailable', 'invalid'].includes(scenario);
  const workerLike = scenario === 'worker';
  const edgeLike = scenario === 'edge';

  if (browserLike) {
    setGlobal('window', {});
    setGlobal('document', { cookie: '' });
    setGlobal('navigator', { userAgent: 'rezo-phase1c-c-browser-probe' });
  }
  if (workerLike || edgeLike) {
    setGlobal('WorkerGlobalScope', function WorkerGlobalScope() {});
    setGlobal('self', globalThis);
  }
  if (edgeLike) {
    setGlobal('EdgeRuntime', 'rezo-phase1c-c-edge-probe');
  }

  if (!(adapterName === 'xhr' && scenario === 'unavailable')) {
    setGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  } else {
    clearGlobal('XMLHttpRequest');
  }

  if (!(adapterName === 'fetch' && scenario === 'unavailable')) {
    setGlobal('fetch', async () => {
      fetchCalls += 1;
      if ((scenario === 'server' || scenario === 'edge') && fetchCalls === 1) {
        return new NativeResponse(null, {
          status: 302,
          headers: { location: 'https://rezo.invalid/direct-capability-final' },
        });
      }
      return new NativeResponse('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  } else {
    clearGlobal('fetch');
  }

  const { executeRequest } = await import(adapterUrl);
  const { Rezo } = await import(rezoUrl);
  const ownKeys = Reflect.ownKeys(executeRequest).map(String);

  if (browserLike || workerLike || edgeLike) {
    setGlobal('process', undefined);
    clearGlobal('Bun');
    clearGlobal('Deno');
    if (!edgeLike) {
      clearGlobal('EdgeRuntime');
      clearGlobal('caches');
    }
    if (browserLike) {
      clearGlobal('WorkerGlobalScope');
      clearGlobal('importScripts');
    }
  }

  const callback = () => {
    callbackCalls += 1;
    return { redirect: true };
  };
  const options = {
    method: 'GET',
    url: scenario === 'invalid' || scenario === 'unavailable'
      ? 'http://[::1'
      : 'https://rezo.invalid/direct-capability',
  };
  const defaults = {};

  if (carrier === 'request-before') options.beforeRedirect = callback;
  if (carrier === 'request-on') options.onRedirect = callback;
  if (carrier === 'default-before') defaults.beforeRedirect = callback;
  if (carrier === 'default-on') defaults.onRedirect = callback;
  if (carrier === 'request-hooks') options.hooks = { beforeRedirect: [callback] };
  if (carrier === 'default-hooks') defaults.hooks = { beforeRedirect: [callback] };
  if (carrier === 'plural') {
    options.onRedirect = callback;
    defaults.beforeRedirect = callback;
    defaults.hooks = { beforeRedirect: [callback] };
    defaults._hooks = { beforeRedirect: [callback] };
  }
  if (carrier === 'empty') {
    options.hooks = { beforeRedirect: [] };
    defaults.hooks = { beforeRedirect: [] };
    defaults._hooks = { beforeRedirect: [] };
  }

  let response = null;
  let error = null;
  try {
    if (carrier === 'live-hooks') {
      const client = new Rezo({
        cache: { response: { enable: false } },
      }, executeRequest);
      client.hooks.beforeRedirect.push(callback);
      cacheEnabled = client.responseCache?.isEnabled ?? false;
      response = await client.get(options.url);
    } else {
      response = await executeRequest(options, defaults, new RezoCookieJar());
    }
  } catch (caught) {
    error = caught;
  }

  result = {
    cacheEnabled,
    callbackCalls,
    error: error ? {
      code: error.code,
      errno: error.errno,
      isRetryable: error.isRetryable,
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
      serialized: typeof error?.toJSON === 'function' ? error.toJSON() : undefined,
    } : null,
    fetchCalls,
    ownKeys,
    response: response ? { code: response.code, status: response.status } : null,
    xhrConstructed,
    xhrSent,
  };
} catch (caught) {
  result = {
    cacheEnabled,
    callbackCalls,
    error: {
      code: caught?.code,
      errno: caught?.errno,
      isRetryable: caught?.isRetryable,
      message: caught instanceof Error ? caught.message : String(caught),
      name: caught instanceof Error ? caught.name : typeof caught,
      serialized: typeof caught?.toJSON === 'function' ? caught.toJSON() : undefined,
    },
    fetchCalls,
    ownKeys: [],
    response: null,
    xhrConstructed,
    xhrSent,
  };
} finally {
  restore();
}

hostProcess.stdout.write(JSON.stringify(result) + '\\n');
`;

  const output = execFileSync('node', [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    source,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const finalLine = output.trim().split('\n').at(-1);
  if (!finalLine) throw new Error('direct-capability probe emitted no result');
  return JSON.parse(finalLine) as ProbeResult;
}

const carriers = [
  { carrier: 'request-before', label: 'request beforeRedirect', capability: 'beforeRedirect' },
  { carrier: 'request-on', label: 'request onRedirect', capability: 'onRedirect' },
  { carrier: 'default-before', label: 'default beforeRedirect', capability: 'beforeRedirect' },
  { carrier: 'default-on', label: 'default onRedirect', capability: 'onRedirect' },
  { carrier: 'request-hooks', label: 'request hooks.beforeRedirect', capability: 'hooks.beforeRedirect' },
  { carrier: 'default-hooks', label: 'default hooks.beforeRedirect', capability: 'hooks.beforeRedirect' },
  { carrier: 'live-hooks', label: 'effective live client hook', capability: 'hooks.beforeRedirect' },
] as const;

const adapters = [
  { adapter: 'fetch', label: 'Browser Fetch' },
  { adapter: 'xhr', label: 'XMLHttpRequest' },
] as const;

function expectStructuredRefusal(
  result: ProbeResult,
  message: string,
): void {
  expect(result.error).toEqual({
    code: 'REZ_UNSUPPORTED_CAPABILITY',
    errno: -1075,
    isRetryable: false,
    message,
    name: 'RezoError',
    serialized: {
      code: 'REZ_UNSUPPORTED_CAPABILITY',
      message,
      name: 'RezoError',
    },
  });
  expect(result.response).toBeNull();
  expect(result.callbackCalls).toBe(0);
  expect(result.fetchCalls).toBe(0);
  expect(result.xhrConstructed).toBe(0);
  expect(result.xhrSent).toBe(0);
}

describe('A+ Phase 1c-c — direct/no-cache hidden Fetch and XHR refusal', () => {
  for (const { adapter, label } of adapters) {
    for (const { carrier, label: carrierLabel, capability } of carriers) {
      it(`${label}: ${carrierLabel} refuses before adapter dispatch`, () => {
        const result = runProbe(adapter, 'hidden', carrier);
        expectStructuredRefusal(
          result,
          `${label} cannot enforce redirect capability "${capability}" before dispatch.`,
        );
        if (carrier === 'live-hooks') expect(result.cacheEnabled).toBe(false);
      });
    }

    it(`${label}: combined carriers use deterministic plural formatting`, () => {
      const result = runProbe(adapter, 'hidden', 'plural');
      expectStructuredRefusal(
        result,
        `${label} cannot enforce redirect capabilities "beforeRedirect", "onRedirect", "hooks.beforeRedirect" before dispatch.`,
      );
    });

    it(`${label}: empty hook arrays remain reachable`, () => {
      const result = runProbe(adapter, 'empty');
      expect(result.error).toBeNull();
      expect(result.response?.status).toBe(200);
      if (adapter === 'fetch') {
        expect(result.fetchCalls).toBe(1);
        expect(result.xhrConstructed).toBe(0);
        expect(result.xhrSent).toBe(0);
      } else {
        expect(result.fetchCalls).toBe(0);
        expect(result.xhrConstructed).toBe(1);
        expect(result.xhrSent).toBe(1);
      }
    });

    it(`${label}: malformed URL fails during preparation before capability refusal`, () => {
      const result = runProbe(adapter, 'invalid', 'request-on');
      expect(result.error).toEqual({
        code: 'ERR_INVALID_URL',
        message: 'Invalid URL',
        name: 'TypeError',
      });
      expect(result.response).toBeNull();
      expect(result.callbackCalls).toBe(0);
      expect(result.fetchCalls).toBe(0);
      expect(result.xhrConstructed).toBe(0);
      expect(result.xhrSent).toBe(0);
    });

    it(`${label}: unavailable transport keeps its original availability error`, () => {
      const result = runProbe(adapter, 'unavailable', 'request-on');
      expect(result.error?.message).toBe(
        adapter === 'fetch'
          ? 'Fetch API is not available in this environment'
          : 'XMLHttpRequest is not available in this environment',
      );
      expect(result.error?.code).not.toBe('REZ_UNSUPPORTED_CAPABILITY');
      expect(result.error?.name).toBe('Error');
      expect(result.response).toBeNull();
      expect(result.callbackCalls).toBe(0);
      expect(result.fetchCalls).toBe(0);
      expect(result.xhrConstructed).toBe(0);
      expect(result.xhrSent).toBe(0);
    });
  }

  it('server Fetch stays visible and reaches its transport', () => {
    const result = runProbe('fetch', 'server', 'request-before');
    expect(result.error).toBeNull();
    expect(result.response?.status).toBe(200);
    expect(result.fetchCalls).toBe(2);
    expect(result.callbackCalls).toBe(1);
  });

  it('edge Fetch stays visible even with Worker-shaped globals', () => {
    const result = runProbe('fetch', 'edge', 'request-before');
    expect(result.error).toBeNull();
    expect(result.response?.status).toBe(200);
    expect(result.fetchCalls).toBe(2);
    expect(result.callbackCalls).toBe(1);
  });

  it('Web Worker Fetch refuses the direct hidden lane before dispatch', () => {
    const result = runProbe('fetch', 'worker', 'request-on');
    expectStructuredRefusal(
      result,
      'Browser Fetch cannot enforce redirect capability "onRedirect" before dispatch.',
    );
  });

  it('registration and direct guards do not add reflective adapter keys', () => {
    expect(runProbe('fetch', 'server').ownKeys).toEqual(['length', 'name']);
    expect(runProbe('xhr', 'empty').ownKeys).toEqual(['length', 'name']);
  });
});
