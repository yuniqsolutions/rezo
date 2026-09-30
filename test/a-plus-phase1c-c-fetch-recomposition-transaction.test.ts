/**
 * Phase 1c-c Fetch redirect recomposition — hook-carrier integrity.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';

const wire = new Map<string, http.IncomingHttpHeaders[]>();
let server: http.Server | undefined;
let port = 0;

function listen(target: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      target.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      target.off('error', onError);
      resolve((target.address() as AddressInfo).port);
    };
    target.once('error', onError);
    target.once('listening', onListening);
    target.listen(0, '127.0.0.1');
  });
}

function last(path: string): http.IncomingHttpHeaders {
  const entry = wire.get(path)?.at(-1);
  if (!entry) throw new Error(`fixture path was not reached: ${path}`);
  return entry;
}

const runtimeKeys = [
  'Bun',
  'Deno',
  'EdgeRuntime',
  'caches',
  'document',
  'navigator',
  'WorkerGlobalScope',
  'importScripts',
] as const;
const hasUnmaskableBunServerMarker = (
  Object.getOwnPropertyDescriptor(globalThis, 'Bun')?.configurable === false
);

async function withRuntimeGlobals<T>(
  overrides: Partial<Record<(typeof runtimeKeys)[number], unknown>>,
  action: () => Promise<T> | T,
): Promise<T> {
  const saved = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const key of runtimeKeys) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Reflect.deleteProperty(globalThis, key);
  }
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  try {
    return await action();
  } finally {
    for (const key of runtimeKeys) {
      Reflect.deleteProperty(globalThis, key);
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    }
  }
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    wire.set(path, [...(wire.get(path) ?? []), { ...request.headers }]);
    request.resume();
    if (path === '/start') {
      response.writeHead(302, { location: `http://127.0.0.1:${port}/final` });
    } else if (path === '/cycle-raw-start' || path === '/cycle-a') {
      response.writeHead(302, { location: `http://127.0.0.1:${port}/raw` });
    } else if (path === '/cycle-rewrite-start') {
      response.writeHead(302, { location: `http://127.0.0.1:${port}/raw-one` });
    } else if (path === '/cycle-repeat') {
      response.writeHead(302, { location: `http://127.0.0.1:${port}/raw-two` });
    } else if (path.startsWith('/not-modified')) {
      response.writeHead(304, { etag: '"fetch-304"' });
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
    }
    response.end(path === '/start' ? undefined : '{"ok":true}');
  });
  port = await listen(server);
});

afterAll(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server!.closeAllConnections?.();
  });
});

beforeEach(() => wire.clear());

describe('Phase 1c-c Fetch hook-carrier integrity', () => {
  it.skipIf(hasUnmaskableBunServerMarker)(
    'classifies browser and React Native process-shim lanes as platform-owned',
    async () => {
      let callbackCalls = 0;
      const invoke = (overrides: Parameters<typeof withRuntimeGlobals>[0]) => (
        withRuntimeGlobals(overrides, async () => {
          expect(typeof process).toBe('object');
          try {
            await fetchAdapter({
              method: 'GET',
              onRedirect: () => {
                callbackCalls++;
                return { redirect: true };
              },
              url: `http://127.0.0.1:${port}/start`,
            } as never, {}, new RezoCookieJar());
          } catch (error) {
            return error;
          }
          return undefined;
        })
      );

      const browserError = await invoke({
        document: {},
        navigator: { product: 'Gecko', userAgent: 'browser-with-process-shim' },
      });
      const reactNativeError = await invoke({
        navigator: { product: 'ReactNative' },
      });

      expect(browserError).toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY' });
      expect(reactNativeError).toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY' });
      expect(callbackCalls).toBe(0);
      expect(wire.get('/start')).toBeUndefined();
    },
  );

  it.skipIf(hasUnmaskableBunServerMarker)(
    'delegates a no-guarantee browser redirect to platform follow semantics',
    async () => {
      const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
      const originalFetch = globalThis.fetch;
      const redirectModes: Array<RequestInit['redirect']> = [];
      Object.defineProperty(globalThis, 'fetch', {
        ...originalFetchDescriptor,
        configurable: true,
        value: (input: RequestInfo | URL, init?: RequestInit) => {
          redirectModes.push(init?.redirect);
          return originalFetch(input, init);
        },
      });

      let response: Awaited<ReturnType<Rezo['get']>>;
      try {
        response = await withRuntimeGlobals({
          document: {},
          navigator: { product: 'Gecko', userAgent: 'browser-with-process-shim' },
        }, () => new Rezo({}, fetchAdapter).get(
          `http://127.0.0.1:${port}/start`,
        ));
      } finally {
        Reflect.deleteProperty(globalThis, 'fetch');
        if (originalFetchDescriptor) {
          Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
        }
      }

      expect(redirectModes).toEqual(['follow']);
      expect(wire.get('/start')).toHaveLength(1);
      expect(wire.get('/final')).toHaveLength(1);
      expect(response.status).toBe(200);
      expect(response.finalUrl).toBe(`http://127.0.0.1:${port}/final`);
      expect(response.config.finalUrl).toBe(response.finalUrl);
      expect(response.config.redirectCount).toBe(0);
      expect(response.config.redirectHistory).toEqual([]);
    },
  );

  it('keeps inherited read-only methods out of the convenience-mutator table', async () => {
    let rendered: unknown;
    const hook = vi.fn((context: unknown) => {
      const headers = (context as { request: { headers: { toString(): string } } })
        .request.headers;
      rendered = headers.toString();
    });

    const response = await new Rezo({}, fetchAdapter).get(
      `http://127.0.0.1:${port}/start`,
      {
        headers: { 'X-Readable': 'present' },
        hooks: { beforeRedirect: [hook] },
      } as never,
    );

    expect(hook).toHaveBeenCalledTimes(1);
    expect(typeof rendered).toBe('string');
    expect(String(rendered)).toContain('x-readable: present');
    expect(wire.get('/start')).toHaveLength(1);
    expect(wire.get('/final')).toHaveLength(1);
    expect(response.status).toBe(200);
  });

  it('keeps the standard forEach parent argument on the recording carrier', async () => {
    let mutated = false;
    const hook = vi.fn((context: unknown) => {
      const headers = (context as {
        request: {
          headers: {
            forEach(
              callback: (
                value: string,
                key: string,
                parent: { set(name: string, value: string): void },
              ) => void,
            ): void;
          };
        };
      }).request.headers;
      headers.forEach((_value, _key, parent) => {
        if (!mutated) {
          mutated = true;
          parent.set('X-ForEach-Escape', 'recorded');
        }
      });
    });

    await new Rezo({}, fetchAdapter).get(`http://127.0.0.1:${port}/start`, {
      headers: { 'X-Control': 'caller' },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(mutated).toBe(true);
    expect(last('/start')['x-foreach-escape']).toBeUndefined();
    expect(last('/final')).toMatchObject({
      'x-control': 'caller',
      'x-foreach-escape': 'recorded',
    });
  });

  it('applies cycle detection to callback-finalized destinations, not raw Location', async () => {
    let calls = 0;
    const response = await new Rezo({}, fetchAdapter).get(
      `http://127.0.0.1:${port}/cycle-raw-start`,
      {
        enableRedirectCycleDetection: true,
        onRedirect: ({ url }: { url: URL }) => {
          calls++;
          return {
            redirect: true,
            url: calls === 1
              ? `http://127.0.0.1:${port}/cycle-a`
              : `http://127.0.0.1:${port}/cycle-final`,
          };
        },
      } as never,
    );

    expect(calls).toBe(2);
    expect(wire.get('/cycle-raw-start')).toHaveLength(1);
    expect(wire.get('/cycle-a')).toHaveLength(1);
    expect(wire.get('/raw')).toBeUndefined();
    expect(wire.get('/cycle-final')).toHaveLength(1);
    expect(response.status).toBe(200);
  });

  it('rejects distinct raw Locations rewritten to the same finalized destination', async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await new Rezo({}, fetchAdapter).get(
        `http://127.0.0.1:${port}/cycle-rewrite-start`,
        {
          enableRedirectCycleDetection: true,
          onRedirect: () => {
            calls++;
            return {
              redirect: true,
              url: `http://127.0.0.1:${port}/cycle-repeat`,
            };
          },
        } as never,
      );
    } catch (error) {
      thrown = error;
    }

    expect(calls).toBe(2);
    expect(wire.get('/cycle-rewrite-start')).toHaveLength(1);
    expect(wire.get('/cycle-repeat')).toHaveLength(1);
    expect(wire.get('/raw-one')).toBeUndefined();
    expect(wire.get('/raw-two')).toBeUndefined();
    expect(String((thrown as { message?: string })?.message)).toContain(
      'Redirect cycle detected',
    );
  });

  it('keeps explicit validateStatus authority for a non-redirect 304', async () => {
    let rejected: unknown;
    const rejectValidator = vi.fn(() => false);
    try {
      await new Rezo({}, fetchAdapter).get(
        `http://127.0.0.1:${port}/not-modified-reject`,
        { validateStatus: rejectValidator } as never,
      );
    } catch (error) {
      rejected = error;
    }
    const acceptValidator = vi.fn((status: number) => status === 304);
    let accepted: Awaited<ReturnType<Rezo['get']>> | undefined;
    let acceptError: unknown;
    try {
      accepted = await new Rezo({}, fetchAdapter).get(
        `http://127.0.0.1:${port}/not-modified-accept`,
        { validateStatus: acceptValidator } as never,
      );
    } catch (error) {
      acceptError = error;
    }

    expect(wire.get('/not-modified-reject')).toHaveLength(1);
    expect(wire.get('/not-modified-accept')).toHaveLength(1);
    expect(rejectValidator).toHaveBeenCalledWith(304);
    expect(acceptValidator).toHaveBeenCalledWith(304);
    expect(rejected).toBeDefined();
    expect((rejected as { code?: string }).code).not.toBe(
      'REZ_MISSING_REDIRECT_LOCATION',
    );
    expect((rejected as { response?: { status?: number } }).response?.status).toBe(304);
    expect(acceptError).toBeUndefined();
    expect(accepted?.status).toBe(304);
  });
});
