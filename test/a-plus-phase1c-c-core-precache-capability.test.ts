/**
 * A+ Phase 1c-c — shared-core capability refusal before response-cache reads.
 *
 * These are post-repair expectations. C1/C4 are deliberately RED against the
 * pre-fix source: cold cURL consults the cache before its adapter-local refusal,
 * while an identical primed request returns from cache and bypasses refusal.
 * C2/C3/C6 are green compatibility controls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Rezo, type AdapterFunction } from '../src/core/rezo';
import { RezoError } from '../src/errors/rezo-error';
import { VERSION, PACKAGE_NAME } from '../src/version';
import { executeRequest as curlAdapter, CurlExecutor } from '../src/adapters/curl';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as reactNativeAdapter } from '../src/adapters/react-native';
import { executeRequest as xhrAdapter } from '../src/adapters/xhr';
import type { RezoDefaultOptions } from '../src/types/options';
import type { RezoHttpRequest } from '../src/types/rezo-request';

const URL = 'https://rezo.invalid/phase1c-c-core-precache';
const CACHE_DEFAULTS: RezoDefaultOptions = {
  cache: { response: { enable: true, ttl: 60_000 } },
};
const nodeRequire = createRequire(import.meta.url);
const nodeHttp = nodeRequire('node:http') as typeof import('node:http');
const nodeHttps = nodeRequire('node:https') as typeof import('node:https');
const nodeHttp2 = nodeRequire('node:http2') as typeof import('node:http2');
const REGISTRY_KEY = Symbol.for(
  'solutions.yuniq.rezo.internal.adapter-capability-registry.v1',
);
const TSX_PATH = resolve('node_modules/.bin/tsx');
const ESBUILD_PATH = resolve('node_modules/.bin/esbuild');
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const CACHED_RESPONSE = {
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  data: { sentinel: 'phase1c-c-primed-cache' },
  config: {},
} as never;

interface CapturedOutcome {
  response: unknown;
  error: unknown;
}

async function captureOutcome(operation: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    return { response: await operation, error: null };
  } catch (error) {
    return { response: null, error };
  }
}

function createClient(
  adapter: AdapterFunction,
  defaults: RezoDefaultOptions = {},
): Rezo {
  return new Rezo({ ...CACHE_DEFAULTS, ...defaults }, adapter);
}

// A cached entry is now keyed by the COMPLETE effective request-header
// multimap (DECISION-063 C / DECISION-070 r2 A), so an entry primed with no
// headers is only reachable by a request that sends none — which no real
// request does. Priming therefore stores under the exact headers these clients
// put on the wire; the string is derived from the product's own constants so a
// version bump cannot silently turn every primed row into a miss.
const EFFECTIVE_REQUEST_HEADERS: Record<string, string> = {
  'user-agent': `Rezo/${VERSION} (+https://www.npmjs.com/package/${PACKAGE_NAME})`,
};

function prime(client: Rezo): void {
  expect(client.responseCache, 'test client must expose its enabled response cache').toBeDefined();
  client.responseCache!.set('GET', URL, CACHED_RESPONSE, EFFECTIVE_REQUEST_HEADERS);
}

function expectCachedSentinel(response: unknown): void {
  expect(response).toMatchObject({
    _fromCache: true,
    data: { sentinel: 'phase1c-c-primed-cache' },
  });
}

function replaceGlobal(name: 'fetch' | 'navigator', value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function restoreGlobal(
  name: 'fetch' | 'navigator',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}

function stubNodeAndFetchDispatch(): {
  fetch: ReturnType<typeof vi.fn>;
  http: ReturnType<typeof vi.spyOn>;
  https: ReturnType<typeof vi.spyOn>;
  http2: ReturnType<typeof vi.spyOn>;
} {
  const dispatchSentinel = () => {
    throw new Error('network dispatch sentinel: cache path must return first');
  };
  const fetchSpy = vi.fn(dispatchSentinel);
  replaceGlobal('fetch', fetchSpy);

  return {
    fetch: fetchSpy,
    http: vi.spyOn(nodeHttp, 'request').mockImplementation(dispatchSentinel as never),
    https: vi.spyOn(nodeHttps, 'request').mockImplementation(dispatchSentinel as never),
    http2: vi.spyOn(nodeHttp2, 'connect').mockImplementation(dispatchSentinel as never),
  };
}

function expectZeroDispatch(
  boundaries: ReturnType<typeof stubNodeAndFetchDispatch>,
): void {
  expect(boundaries.fetch).not.toHaveBeenCalled();
  expect(boundaries.http).not.toHaveBeenCalled();
  expect(boundaries.https).not.toHaveBeenCalled();
  expect(boundaries.http2).not.toHaveBeenCalled();
}

function createReactNativeZeroWorkHarness(): {
  defaults: RezoDefaultOptions;
  fetch: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
  networkInfo: ReturnType<typeof vi.fn>;
  registerTask: ReturnType<typeof vi.fn>;
  unregisterTask: ReturnType<typeof vi.fn>;
} {
  replaceGlobal('navigator', { product: 'ReactNative' });
  const failIfCalled = (boundary: string) => vi.fn(async () => {
    throw new Error(`${boundary} must not run before capability refusal`);
  });
  const fetch = failIfCalled('React Native global Fetch');
  const download = failIfCalled('React Native file download provider');
  const upload = failIfCalled('React Native file upload provider');
  const stream = failIfCalled('React Native stream transport');
  const networkInfo = failIfCalled('React Native network-info provider');
  const registerTask = failIfCalled('React Native background-task registration');
  const unregisterTask = failIfCalled('React Native background-task cleanup');
  replaceGlobal('fetch', fetch);

  const defaults = {
    reactNative: {
      fileSystemAdapter: {
        name: 'phase1c-c-zero-work-files',
        downloadFile: download,
        uploadFile: upload,
      },
      streamTransport: {
        name: 'phase1c-c-zero-work-stream',
        stream,
      },
      networkInfoProvider: { fetch: networkInfo },
      backgroundTaskProvider: { registerTask, unregisterTask },
    },
  } as unknown as RezoDefaultOptions;

  return {
    defaults,
    fetch,
    download,
    upload,
    stream,
    networkInfo,
    registerTask,
    unregisterTask,
  };
}

function expectZeroReactNativeWork(
  harness: ReturnType<typeof createReactNativeZeroWorkHarness>,
): void {
  expect(harness.fetch).not.toHaveBeenCalled();
  expect(harness.download).not.toHaveBeenCalled();
  expect(harness.upload).not.toHaveBeenCalled();
  expect(harness.stream).not.toHaveBeenCalled();
  expect(harness.networkInfo).not.toHaveBeenCalled();
  expect(harness.registerTask).not.toHaveBeenCalled();
  expect(harness.unregisterTask).not.toHaveBeenCalled();
}

function runIsolatedTsxProbe(source: string): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-phase1c-c-registry-'));
  const scriptPath = join(directory, 'probe.ts');
  writeFileSync(scriptPath, source, 'utf8');

  try {
    const output = execFileSync(TSX_PATH, [scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const finalLine = output.trim().split('\n').at(-1);
    if (!finalLine) {
      throw new Error('isolated registry probe produced no JSON output');
    }
    return JSON.parse(finalLine) as Record<string, unknown>;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runIsolatedGcProbe(source: string): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-phase1c-c-retention-'));
  const scriptPath = join(directory, 'probe.ts');
  writeFileSync(scriptPath, source, 'utf8');

  try {
    const output = execFileSync('node', [
      '--expose-gc',
      '--import',
      'tsx',
      scriptPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const finalLine = output.trim().split('\n').at(-1);
    if (!finalLine) {
      throw new Error('isolated retention probe produced no JSON output');
    }
    return JSON.parse(finalLine) as Record<string, unknown>;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runMixedGraphProbe(): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-phase1c-c-mixed-graph-'));
  const rootOutput = join(directory, 'root.cjs');
  const adaptersDirectory = join(directory, 'esm');
  const adaptersOutput = join(adaptersDirectory, 'adapters.mjs');
  const runnerPath = join(directory, 'runner.cjs');

  try {
    execFileSync(ESBUILD_PATH, [
      resolve('src/index.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${rootOutput}`,
    ], { cwd: process.cwd(), stdio: 'pipe' });
    execFileSync(ESBUILD_PATH, [
      resolve('src/adapters/index.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--splitting',
      `--outdir=${adaptersDirectory}`,
      '--out-extension:.js=.mjs',
      '--entry-names=adapters',
      '--chunk-names=chunks/[name]-[hash]',
    ], { cwd: process.cwd(), stdio: 'pipe' });

    writeFileSync(runnerPath, `
const root = require(${JSON.stringify(rootOutput)});
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
let spawnCalls = 0;
childProcess.spawn = (...args) => {
  spawnCalls += 1;
  throw new Error('mixed-graph cURL spawn sentinel');
};

void (async () => {
  const adapters = await import(${JSON.stringify(pathToFileURL(adaptersOutput).href)});
  const loaded = await adapters.loadAdapter('curl');
  const rawAdapter = loaded.executeRequest;
  const originalExecute = loaded.CurlExecutor.prototype.execute;
  let executorCalls = 0;
  loaded.CurlExecutor.prototype.execute = async () => {
    executorCalls += 1;
    throw new Error('mixed-graph cURL executor sentinel');
  };
  const client = new root.Rezo({
    cache: { response: { enable: true, ttl: 60000 } },
  }, rawAdapter);
  const url = 'https://rezo.invalid/phase1c-c-mixed-graph';
  // Primed under the exact effective request headers, since identity now binds
  // the complete header multimap (see EFFECTIVE_REQUEST_HEADERS above).
  client.responseCache.set('GET', url, {
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { sentinel: 'mixed-graph-cache' },
    config: {},
  }, ${JSON.stringify(EFFECTIVE_REQUEST_HEADERS)});
  const originalGet = client.responseCache.get.bind(client.responseCache);
  let cacheReads = 0;
  client.responseCache.get = (...args) => {
    cacheReads += 1;
    return originalGet(...args);
  };
  let callbackCalls = 0;
  let response = null;
  let error = null;
  try {
    response = await client.get(url, {
      cache: 'force-cache',
      onRedirect: () => {
        callbackCalls += 1;
        return { redirect: true };
      },
    });
  } catch (caught) {
    error = caught;
  } finally {
    loaded.CurlExecutor.prototype.execute = originalExecute;
    childProcess.spawn = originalSpawn;
  }
  console.log(JSON.stringify({
    callbackCalls,
    cacheReads,
    code: error?.code ?? null,
    errno: error?.errno ?? null,
    executorCalls,
    fromCache: response?._fromCache ?? false,
    localErrorIdentity: error instanceof root.RezoError,
    message: error?.message ?? null,
    ownKeys: Reflect.ownKeys(rawAdapter).map((key) => String(key)),
    spawnCalls,
  }));
})().catch((error) => {
  childProcess.spawn = originalSpawn;
  console.error(error);
  process.exitCode = 1;
});
`, 'utf8');

    const output = execFileSync(process.execPath, [runnerPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const finalLine = output.trim().split('\n').at(-1);
    if (!finalLine) {
      throw new Error('mixed-graph probe produced no JSON output');
    }
    return JSON.parse(finalLine) as Record<string, unknown>;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

type GuaranteeCase = {
  name: string;
  expectedCapability: string;
  defaults?: (callback: ReturnType<typeof vi.fn>) => RezoDefaultOptions;
  request?: (callback: ReturnType<typeof vi.fn>) => RezoHttpRequest;
  configureClient?: (client: Rezo, callback: ReturnType<typeof vi.fn>) => void;
};

const guaranteeCases: GuaranteeCase[] = [
  {
    name: 'request beforeRedirect',
    expectedCapability: 'beforeRedirect',
    request: (callback) => ({ beforeRedirect: callback }),
  },
  {
    name: 'request onRedirect',
    expectedCapability: 'onRedirect',
    request: (callback) => ({ onRedirect: callback }),
  },
  {
    name: 'instance beforeRedirect',
    expectedCapability: 'beforeRedirect',
    defaults: (callback) => ({ beforeRedirect: callback }),
  },
  {
    name: 'instance onRedirect',
    expectedCapability: 'onRedirect',
    defaults: (callback) => ({ onRedirect: callback }),
  },
  {
    name: 'request hooks.beforeRedirect',
    expectedCapability: 'hooks.beforeRedirect',
    request: (callback) => ({ hooks: { beforeRedirect: [callback] } }),
  },
  {
    name: 'instance hooks.beforeRedirect',
    expectedCapability: 'hooks.beforeRedirect',
    defaults: (callback) => ({ hooks: { beforeRedirect: [callback] } }),
  },
  {
    name: 'live client hooks.beforeRedirect',
    expectedCapability: 'hooks.beforeRedirect',
    configureClient: (client, callback) => {
      client.hooks.beforeRedirect.push(callback);
    },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  restoreGlobal('fetch', originalFetchDescriptor);
  restoreGlobal('navigator', originalNavigatorDescriptor);
});

describe('A+ Phase 1c-c core C1/C4 — hidden-lane refusal is cold/primed deterministic and pre-cache', () => {
  for (const guaranteeCase of guaranteeCases) {
    const expectedMessage =
      `Native cURL cannot enforce redirect capability "${guaranteeCase.expectedCapability}" before dispatch.`;

    it(`exact cURL identity: ${guaranteeCase.name} refuses cold before any cache operation`, async () => {
      const callback = vi.fn(() => ({ redirect: true }));
      const defaults = guaranteeCase.defaults?.(callback) ?? {};
      const request = guaranteeCase.request?.(callback) ?? {};
      const executeSpy = vi.spyOn(CurlExecutor.prototype, 'execute').mockImplementation(async () => {
        throw new Error('cURL executor sentinel: capability guard must return first');
      });

      const cold = createClient(curlAdapter, defaults);
      guaranteeCase.configureClient?.(cold, callback);
      const coldGet = vi.spyOn(cold.responseCache!, 'get');
      const coldConditional = vi.spyOn(cold.responseCache!, 'getConditionalHeaders');
      const coldSet = vi.spyOn(cold.responseCache!, 'set');
      const coldOutcome = await captureOutcome(cold.get(URL, {
        ...request,
      } as never));

      expect(coldOutcome.error).toBeInstanceOf(RezoError);
      expect(coldOutcome.error).toMatchObject({
        code: 'REZ_UNSUPPORTED_CAPABILITY',
        errno: -1075,
        message: expectedMessage,
      });
      expect(coldOutcome.response).toBeNull();
      expect(coldGet).not.toHaveBeenCalled();
      expect(coldConditional).not.toHaveBeenCalled();
      expect(coldSet).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it(`exact cURL identity: ${guaranteeCase.name} refuses primed before any cache operation`, async () => {
      const callback = vi.fn(() => ({ redirect: true }));
      const defaults = guaranteeCase.defaults?.(callback) ?? {};
      const request = guaranteeCase.request?.(callback) ?? {};
      const executeSpy = vi.spyOn(CurlExecutor.prototype, 'execute').mockImplementation(async () => {
        throw new Error('cURL executor sentinel: capability guard must return first');
      });
      const primed = createClient(curlAdapter, defaults);
      guaranteeCase.configureClient?.(primed, callback);
      prime(primed);
      const primedGet = vi.spyOn(primed.responseCache!, 'get');
      const primedConditional = vi.spyOn(primed.responseCache!, 'getConditionalHeaders');
      const primedSet = vi.spyOn(primed.responseCache!, 'set');
      const primedOutcome = await captureOutcome(primed.get(URL, {
        ...request,
        cache: 'force-cache',
      } as never));

      expect(primedOutcome.error).toBeInstanceOf(RezoError);
      expect(primedOutcome.error).toMatchObject({
        code: 'REZ_UNSUPPORTED_CAPABILITY',
        errno: -1075,
        message: expectedMessage,
      });
      expect(primedOutcome.response).toBeNull();
      expect(primedGet).not.toHaveBeenCalled();
      expect(primedConditional).not.toHaveBeenCalled();
      expect(primedSet).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(executeSpy).not.toHaveBeenCalled();

      const noGuaranteeClient = createClient(curlAdapter);
      prime(noGuaranteeClient);
      const noGuaranteeGet = vi.spyOn(noGuaranteeClient.responseCache!, 'get');
      const noGuarantee = await noGuaranteeClient.get(URL, {
        cache: 'force-cache',
      } as never);
      expectCachedSentinel(noGuarantee);
      expect(noGuaranteeGet).toHaveBeenCalledTimes(1);
      expect(executeSpy).not.toHaveBeenCalled();
    });
  }
});

describe('A+ Phase 1c-c core C1/C4 — stock React Native refusal is cold/primed deterministic', () => {
  const expectedMessage =
    'React Native stock Fetch cannot enforce redirect capability "onRedirect" before dispatch.';

  it('exact stock-RN identity refuses cold before cache and provider work', async () => {
    const harness = createReactNativeZeroWorkHarness();
    const callback = vi.fn(() => ({ redirect: true }));
    const client = createClient(reactNativeAdapter, harness.defaults);
    const getSpy = vi.spyOn(client.responseCache!, 'get');
    const conditionalSpy = vi.spyOn(client.responseCache!, 'getConditionalHeaders');
    const setSpy = vi.spyOn(client.responseCache!, 'set');

    const outcome = await captureOutcome(client.get(URL, { onRedirect: callback } as never));

    expect(outcome.error).toBeInstanceOf(RezoError);
    expect(outcome.error).toMatchObject({
      code: 'REZ_UNSUPPORTED_CAPABILITY',
      errno: -1075,
      message: expectedMessage,
    });
    expect(outcome.response).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
    expect(conditionalSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expectZeroReactNativeWork(harness);
  });

  it('exact stock-RN identity refuses primed before cache and provider work', async () => {
    const harness = createReactNativeZeroWorkHarness();
    const callback = vi.fn(() => ({ redirect: true }));
    const client = createClient(reactNativeAdapter, harness.defaults);
    prime(client);
    const getSpy = vi.spyOn(client.responseCache!, 'get');
    const conditionalSpy = vi.spyOn(client.responseCache!, 'getConditionalHeaders');
    const setSpy = vi.spyOn(client.responseCache!, 'set');

    const outcome = await captureOutcome(client.get(URL, {
      cache: 'force-cache',
      onRedirect: callback,
    } as never));

    expect(outcome.error).toBeInstanceOf(RezoError);
    expect(outcome.error).toMatchObject({
      code: 'REZ_UNSUPPORTED_CAPABILITY',
      errno: -1075,
      message: expectedMessage,
    });
    expect(outcome.response).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
    expect(conditionalSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expectZeroReactNativeWork(harness);
  });
});

describe('A+ Phase 1c-c core C2 — visible lanes retain callback-bearing cache hits', () => {
  const visibleAdapters = [
    { name: 'http', adapter: httpAdapter },
    { name: 'server fetch', adapter: fetchAdapter },
    { name: 'http2', adapter: http2Adapter },
  ] as const;

  for (const { name, adapter } of visibleAdapters) {
    it(`${name}: primed callback request remains a cache hit without invoking the callback`, async () => {
      const boundaries = stubNodeAndFetchDispatch();
      const callback = vi.fn(() => ({ redirect: true }));
      const hook = vi.fn();
      const client = createClient(adapter);
      prime(client);
      const getSpy = vi.spyOn(client.responseCache!, 'get');
      const conditionalSpy = vi.spyOn(client.responseCache!, 'getConditionalHeaders');

      const response = await client.get(URL, {
        cache: 'force-cache',
        onRedirect: callback,
        hooks: { beforeRedirect: [hook] },
      } as never);

      expectCachedSentinel(response);
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(conditionalSpy).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(hook).not.toHaveBeenCalled();
      expectZeroDispatch(boundaries);
    });
  }

  it('stock-RN adapter with a configured stream transport remains a visible primed cache hit', async () => {
    replaceGlobal('navigator', { product: 'ReactNative' });
    const fetchSpy = vi.fn(() => {
      throw new Error('global Fetch must not run on a primed stream-transport hit');
    });
    replaceGlobal('fetch', fetchSpy);
    const stream = vi.fn(async () => {
      throw new Error('stream transport must not run on a primed hit');
    });
    const callback = vi.fn(() => ({ redirect: true }));
    const client = createClient(reactNativeAdapter, {
      reactNative: {
        streamTransport: { name: 'phase1c-c-visible-stream', stream },
      },
    });
    prime(client);
    const getSpy = vi.spyOn(client.responseCache!, 'get');

    const response = await client.get(URL, {
      cache: 'force-cache',
      responseType: 'stream',
      onRedirect: callback,
    } as never);

    expectCachedSentinel(response);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  // Superseded by the ruled responseType contract (DECISION-063 C / 065 A): a
  // facade mode is legal per request but never as an INSTANCE DEFAULT, so an
  // ordinary `.get()` can no longer inherit a facade lane from a hidden
  // default. Inverted rather than deleted — the row still holds the evidence
  // for default-driven selection, which must now refuse ahead of the cache.
  it('stock-RN adapter refuses an inherited default stream response type ahead of cache classification', async () => {
    replaceGlobal('navigator', { product: 'ReactNative' });
    const fetchSpy = vi.fn(() => {
      throw new Error('global Fetch must not run on a primed default stream-transport hit');
    });
    replaceGlobal('fetch', fetchSpy);
    const stream = vi.fn(async () => {
      throw new Error('stream transport must not run on a primed default hit');
    });
    const callback = vi.fn(() => ({ redirect: true }));
    const client = createClient(reactNativeAdapter, {
      responseType: 'stream',
      reactNative: {
        streamTransport: { name: 'phase1c-c-default-visible-stream', stream },
      },
    });
    prime(client);
    const getSpy = vi.spyOn(client.responseCache!, 'get');

    const outcome = await captureOutcome(client.get(URL, {
      cache: 'force-cache',
      onRedirect: callback,
    } as never));

    expect(outcome.response).toBeNull();
    expect((outcome.error as RezoError).code).toBe('REZ_INVALID_RESPONSE_TYPE');
    // Ahead of cache classification: the entry is primed and reachable, yet the
    // refusal lands before the lookup, so the cache is never consulted.
    expect(getSpy).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});

describe('A+ Phase 1c-c core C3 — hidden identities without guarantees keep cache behavior', () => {
  const hiddenAdapters = [
    { name: 'curl', adapter: curlAdapter },
    { name: 'react-native', adapter: reactNativeAdapter },
  ] as const;

  for (const { name, adapter } of hiddenAdapters) {
    it(`${name}: no guarantee and empty hook list returns the primed entry`, async () => {
      if (name === 'react-native') {
        replaceGlobal('navigator', { product: 'ReactNative' });
        replaceGlobal('fetch', vi.fn(() => {
          throw new Error('React Native Fetch must not run on a primed no-guarantee hit');
        }));
      }
      const client = createClient(adapter);
      prime(client);
      const getSpy = vi.spyOn(client.responseCache!, 'get');

      const response = await client.get(URL, {
        cache: 'force-cache',
        hooks: { beforeRedirect: [] },
      } as never);

      expectCachedSentinel(response);
      expect(getSpy).toHaveBeenCalledTimes(1);
    });
  }
});

describe('A+ Phase 1c-c core C6 — unregistered and wrapped adapters fail open', () => {
  it('a cold custom adapter with a guarantee executes normally', async () => {
    const adapter = vi.fn<AdapterFunction>(async (request) => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { sentinel: 'custom-adapter' },
      config: request,
    } as never));
    const client = createClient(adapter);

    const response = await client.get(URL, {
      cache: 'force-cache',
      onRedirect: () => ({ redirect: true }),
    } as never);

    expect(response).toMatchObject({ data: { sentinel: 'custom-adapter' } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('a primed custom adapter with a guarantee remains a normal cache hit', async () => {
    const adapter = vi.fn<AdapterFunction>(async () => {
      throw new Error('custom adapter must not run on a primed hit');
    });
    const client = createClient(adapter);
    prime(client);
    const getSpy = vi.spyOn(client.responseCache!, 'get');

    const response = await client.get(URL, {
      cache: 'force-cache',
      onRedirect: () => ({ redirect: true }),
    } as never);

    expectCachedSentinel(response);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('a wrapper, bound function, and proxy around registered cURL remain unregistered on primed hits', async () => {
    const wrapper: AdapterFunction = (...args) => curlAdapter(...args);
    const bound = curlAdapter.bind(null) as AdapterFunction;
    const proxied = new Proxy(curlAdapter, {});

    for (const adapter of [wrapper, bound, proxied]) {
      const client = createClient(adapter);
      prime(client);
      const getSpy = vi.spyOn(client.responseCache!, 'get');
      const response = await client.get(URL, {
        cache: 'force-cache',
        onRedirect: () => ({ redirect: true }),
      } as never);

      expectCachedSentinel(response);
      expect(getSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('registration adds no reflective own keys to any registered raw adapter function', () => {
    for (const adapter of [curlAdapter, reactNativeAdapter, fetchAdapter, xhrAdapter]) {
      expect(Reflect.ownKeys(adapter)).toEqual(['length', 'name']);
    }
  });
});

describe('A+ Phase 1c-c core registry carrier — global shape, isolation, and mixed graphs', () => {
  it('registered built-ins share one frozen protocol-v1 slot without retaining request state', () => {
    const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, REGISTRY_KEY);

    expect(globalDescriptor).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
    });

    const registry = globalDescriptor?.value as {
      protocol?: unknown;
      adapters?: WeakMap<AdapterFunction, unknown>;
    } | undefined;
    expect(registry?.protocol).toBe(1);
    expect(registry?.adapters).toBeInstanceOf(WeakMap);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Reflect.ownKeys(registry ?? {})).toEqual(['protocol', 'adapters']);

    for (const adapter of [curlAdapter, reactNativeAdapter, fetchAdapter, xhrAdapter]) {
      const capabilityDescriptor = registry?.adapters?.get(adapter) as
        | Record<PropertyKey, unknown>
        | undefined;
      expect(capabilityDescriptor).toBeDefined();
      expect(Object.isFrozen(capabilityDescriptor)).toBe(true);
      expect(Reflect.ownKeys(capabilityDescriptor ?? {})).toEqual([
        'evaluateRedirectVisibility',
      ]);
      for (const forbiddenRetentionKey of [
        'request',
        'defaults',
        'response',
        'cache',
        'cookieJar',
        'headers',
      ]) {
        expect(capabilityDescriptor).not.toHaveProperty(forbiddenRetentionKey);
      }
    }

    const curlDescriptor = registry?.adapters?.get(curlAdapter) as {
      evaluateRedirectVisibility?: (context: Readonly<{
        request: Readonly<Record<string, never>>;
        defaults: Readonly<Record<string, never>>;
        effectiveHooks: Readonly<{ beforeRedirect: readonly never[] }>;
      }>) => unknown;
    } | undefined;
    const visibility = curlDescriptor?.evaluateRedirectVisibility?.(Object.freeze({
      request: Object.freeze({}),
      defaults: Object.freeze({}),
      effectiveHooks: Object.freeze({ beforeRedirect: Object.freeze([]) }),
    }));
    expect(visibility).toEqual({
      visibility: 'hidden',
      lane: 'curl-native',
    });
    expect(Object.isFrozen(visibility)).toBe(true);
    expect(Reflect.ownKeys((visibility ?? {}) as object)).toEqual([
      'visibility',
      'lane',
    ]);
  });

  it('a registry-backed counting adapter refuses before cache reads or adapter entry', async () => {
    const registry = Object.getOwnPropertyDescriptor(globalThis, REGISTRY_KEY)?.value as {
      adapters?: WeakMap<AdapterFunction, unknown>;
    } | undefined;
    const curlDescriptor = registry?.adapters?.get(curlAdapter);
    expect(curlDescriptor).toBeDefined();

    const countingAdapter = vi.fn<AdapterFunction>(async () => {
      throw new Error('registered counting adapter must not be entered');
    });
    registry!.adapters!.set(countingAdapter, curlDescriptor);
    const client = createClient(countingAdapter);
    const getSpy = vi.spyOn(client.responseCache!, 'get');
    const conditionalSpy = vi.spyOn(client.responseCache!, 'getConditionalHeaders');
    const setSpy = vi.spyOn(client.responseCache!, 'set');

    const outcome = await captureOutcome(client.get(URL, {
      beforeRedirect: () => ({ redirect: true }),
    } as never));

    expect(outcome.error).toMatchObject({
      code: 'REZ_UNSUPPORTED_CAPABILITY',
      errno: -1075,
      message:
        'Native cURL cannot enforce redirect capability "beforeRedirect" before dispatch.',
    });
    expect(outcome.response).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
    expect(conditionalSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(countingAdapter).not.toHaveBeenCalled();
  });

  it('a disabled response cache skips capability evaluation and preserves adapter-local execution', async () => {
    const registry = Object.getOwnPropertyDescriptor(globalThis, REGISTRY_KEY)?.value as {
      adapters?: WeakMap<AdapterFunction, unknown>;
    } | undefined;
    let evaluations = 0;
    const countingAdapter = vi.fn<AdapterFunction>(async (request) => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { sentinel: 'disabled-cache-adapter' },
      config: request,
    } as never));
    registry!.adapters!.set(countingAdapter, Object.freeze({
      evaluateRedirectVisibility: () => {
        evaluations += 1;
        return Object.freeze({ visibility: 'hidden', lane: 'curl-native' });
      },
    }));
    const client = createClient(countingAdapter, {
      cache: { response: { enable: false } },
    });

    expect(client.responseCache?.isEnabled).toBe(false);
    const response = await client.get(URL, {
      beforeRedirect: () => ({ redirect: true }),
    } as never);

    expect(response).toMatchObject({
      data: { sentinel: 'disabled-cache-adapter' },
    });
    expect(evaluations).toBe(0);
    expect(countingAdapter).toHaveBeenCalledTimes(1);
  });

  it('does not retain evaluated request/default/hook/context objects', () => {
    const capabilitiesUrl = pathToFileURL(resolve('src/core/adapter-capabilities.ts')).href;
    const result = runIsolatedGcProbe(`
void (async () => {
  const capabilities = await import(${JSON.stringify(capabilitiesUrl)});
  let evaluations = 0;
  const adapter = async () => null;
  capabilities.registerAdapterCapabilities(adapter, {
    evaluateRedirectVisibility: () => {
      evaluations += 1;
      return capabilities.visibleRedirectVisibility();
    },
  });
  let references;
  let visibility;
  (() => {
    let request = { onRedirect: () => ({ redirect: true }) };
    let defaults = { timeout: 1000 };
    let effectiveHooks = { beforeRedirect: [] };
    let context = Object.freeze({ request, defaults, effectiveHooks });
    references = [
      new WeakRef(request),
      new WeakRef(defaults),
      new WeakRef(effectiveHooks),
      new WeakRef(context),
    ];
    visibility = capabilities.evaluateAdapterRedirectVisibility(adapter, context);
    request = null;
    defaults = null;
    effectiveHooks = null;
    context = null;
  })();
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
    let pressure = Array.from({ length: 1000 }, () => ({ index }));
    pressure = [];
  }
  console.log(JSON.stringify({
    collected: references.map((reference) => reference.deref() === undefined),
    evaluations,
    visibility,
    visibilityFrozen: Object.isFrozen(visibility),
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`);

    expect(result).toEqual({
      collected: [true, true, true, true],
      evaluations: 1,
      visibility: { visibility: 'visible' },
      visibilityFrozen: true,
    });
  });

  it('core-only lookup stays lazy and does not create the global slot', () => {
    const coreUrl = pathToFileURL(resolve('src/core/rezo.ts')).href;
    const result = runIsolatedTsxProbe(`
const key = Symbol.for('solutions.yuniq.rezo.internal.adapter-capability-registry.v1');
void (async () => {
  const beforeImport = Object.prototype.hasOwnProperty.call(globalThis, key);
  const { Rezo } = await import(${JSON.stringify(coreUrl)});
  const afterImport = Object.prototype.hasOwnProperty.call(globalThis, key);
  let adapterCalls = 0;
  const customAdapter = async (request) => {
    adapterCalls += 1;
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { sentinel: 'custom' },
      config: request,
    };
  };
  const client = new Rezo({
    cache: { response: { enable: true, ttl: 60000 } },
  }, customAdapter);
  const url = 'https://rezo.invalid/phase1c-c-lazy-lookup';
  // Primed under the exact effective request headers, since identity now binds
  // the complete header multimap (see EFFECTIVE_REQUEST_HEADERS above).
  client.responseCache.set('GET', url, {
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { sentinel: 'lazy-cache' },
    config: {},
  }, ${JSON.stringify(EFFECTIVE_REQUEST_HEADERS)});
  const response = await client.get(url, {
    cache: 'force-cache',
    onRedirect: () => ({ redirect: true }),
  });
  console.log(JSON.stringify({
    adapterCalls,
    afterImport,
    afterLookup: Object.prototype.hasOwnProperty.call(globalThis, key),
    beforeImport,
    fromCache: response._fromCache === true,
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`);

    expect(result).toEqual({
      adapterCalls: 0,
      afterImport: false,
      afterLookup: false,
      beforeImport: false,
      fromCache: true,
    });
  });

  it.each([
    {
      descriptor: { configurable: true, enumerable: true, writable: true },
      name: 'valid record with invalid carrier attributes',
      seededExpression: 'Object.freeze({ protocol: 1, adapters: new WeakMap() })',
    },
    {
      descriptor: { configurable: false, enumerable: false, writable: false },
      name: 'wrong protocol',
      seededExpression: 'Object.freeze({ protocol: 2, adapters: new WeakMap() })',
    },
    {
      descriptor: { configurable: false, enumerable: false, writable: false },
      name: 'malformed protocol-v1 record',
      seededExpression: 'Object.freeze({ protocol: 1, adapters: Object.freeze({}) })',
    },
    {
      descriptor: { configurable: false, enumerable: false, writable: false },
      name: 'accessor-bearing protocol-v1 record',
      seededExpression: `Object.freeze(Object.defineProperties({}, {
        protocol: {
          configurable: true,
          enumerable: true,
          get() { throw new Error('COLLISION_SENTINEL'); },
        },
        adapters: {
          configurable: true,
          enumerable: true,
          value: new WeakMap(),
          writable: true,
        },
      }))`,
    },
    {
      descriptor: { configurable: false, enumerable: false, writable: false },
      name: 'extra-key protocol-v1 record',
      seededExpression: 'Object.freeze({ protocol: 1, adapters: new WeakMap(), extra: true })',
    },
  ])('a $name slot is rejected and never overwritten', ({
    descriptor,
    seededExpression,
  }) => {
    const curlUrl = pathToFileURL(resolve('src/adapters/curl.ts')).href;
    const result = runIsolatedTsxProbe(`
const key = Symbol.for('solutions.yuniq.rezo.internal.adapter-capability-registry.v1');
const seeded = ${seededExpression};
Object.defineProperty(globalThis, key, {
  configurable: ${descriptor.configurable},
  enumerable: ${descriptor.enumerable},
  value: seeded,
  writable: ${descriptor.writable},
});
const beforeDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);
void (async () => {
  let imported = false;
  let message = null;
  try {
    await import(${JSON.stringify(curlUrl)});
    imported = true;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const afterDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  console.log(JSON.stringify({
    descriptorPreserved:
      afterDescriptor?.configurable === beforeDescriptor?.configurable &&
      afterDescriptor?.enumerable === beforeDescriptor?.enumerable &&
      afterDescriptor?.writable === beforeDescriptor?.writable &&
      afterDescriptor?.value === beforeDescriptor?.value,
    imported,
    message,
    preserved: globalThis[key] === seeded,
  }));
})();
`);

    expect(result).toMatchObject({
      descriptorPreserved: true,
      imported: false,
      preserved: true,
    });
    expect(result.message).toBe(
      '[Rezo] Invalid adapter capability registry v1; refusing to overwrite the existing realm slot.',
    );
  });

  it('CJS root recognizes cURL loaded through the public ESM adapter picker in the same realm', () => {
    expect(runMixedGraphProbe()).toEqual({
      callbackCalls: 0,
      cacheReads: 0,
      code: 'REZ_UNSUPPORTED_CAPABILITY',
      errno: -1075,
      executorCalls: 0,
      fromCache: false,
      localErrorIdentity: true,
      message:
        'Native cURL cannot enforce redirect capability "onRedirect" before dispatch.',
      ownKeys: ['length', 'name'],
      spawnCalls: 0,
    });
  });
});
