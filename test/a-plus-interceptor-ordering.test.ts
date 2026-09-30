/**
 * IC — interceptor ordering and chaining as a consumer sees it, on HTTP/1.1, HTTP/2, Fetch and cURL: request interceptors
 * run in registration order and each sees the previous one's change on the wire; response interceptors run in order and
 * chain their transforms; the rejected side receives the typed error and its replacement is what the caller gets; eject
 * removes exactly one; per-request `hooks` run after the instance's interceptors; `runWhen` skips. HTTP/1.1 is the
 * in-row reference.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { RezoError } from '../src/errors/rezo-error';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { startH2Origin, startHttpOrigin, type Handler, type Origin } from './fixtures/contract/servers.ts';

const ADAPTERS = { http1: http1Adapter, http2: http2Adapter, fetch: fetchAdapter, curl: curlAdapter } as const;
type AdapterName = keyof typeof ADAPTERS;
const handler: Handler = (request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture');
  if (url.pathname === '/500') { response.writeHead(500, { 'content-type': 'text/plain' }); response.end('oops!'); return; }
  const echo = JSON.stringify({ a: request.headers['x-a'] ?? null, b: request.headers['x-b'] ?? null, c: request.headers['x-c'] ?? null, marker: 'origin' });
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(echo);
};
let plain: Origin; let h2: Origin;
beforeAll(async () => { plain = await startHttpOrigin(handler); h2 = await startH2Origin(handler); });
afterAll(async () => { await plain.close(); await h2.close(); });
const originFor = (adapter: AdapterName): string => (adapter === 'http2' ? h2.origin : plain.origin);
const client = (adapter: AdapterName) => new Rezo({ retry: false, timeout: 8000, rejectUnauthorized: false } as never, ADAPTERS[adapter]);
/** The config an interceptor receives carries the caller's headers as given (a plain object or a RezoHeaders); both are supported here. */
const headerOf = (config: any, name: string): string | null => { const h = config.headers; if (!h) return null; if (typeof h.get === 'function') return h.get(name) ?? null; const key = Object.keys(h).find((k) => k.toLowerCase() === name); return key ? String(h[key]) : null; };
const setHeader = (config: any, name: string, value: string): void => { if (config.headers && typeof config.headers.set === 'function') config.headers.set(name, value); else config.headers = { ...(config.headers ?? {}), [name]: value }; };

type Shape = Record<string, unknown>;
const ROWS: Array<{ id: string; title: string; run(adapter: AdapterName): Promise<Shape>; reference: Shape }> = [
  { id: 'IC-01', title: 'request interceptors run in registration order and each sees the previous change on the wire',
    async run(adapter) {
      const order: string[] = []; const rezo = client(adapter);
      rezo.interceptors.request.use((config: any) => { order.push('A'); setHeader(config, 'x-a', '1'); return config; });
      rezo.interceptors.request.use((config: any) => { order.push('B'); setHeader(config, 'x-b', headerOf(config, 'x-a') === '1' ? 'saw-a' : 'no-a'); return config; });
      const r = await rezo.get(`${originFor(adapter)}/echo`, { cache: false } as never) as { data: { a: string | null; b: string | null } };
      return { order, a: r.data.a, b: r.data.b };
    }, reference: { order: ['A', 'B'], a: '1', b: 'saw-a' } },
  { id: 'IC-02', title: 'response interceptors run in registration order and chain their transforms',
    async run(adapter) {
      const order: string[] = []; const rezo = client(adapter);
      rezo.interceptors.response.use((response: any) => { order.push('A'); response.data = { ...response.data, a: 'A' }; return response; });
      rezo.interceptors.response.use((response: any) => { order.push('B'); response.data = { ...response.data, b: response.data.a === 'A' ? 'saw-a' : 'no-a' }; return response; });
      const r = await rezo.get(`${originFor(adapter)}/echo`, { cache: false } as never) as { data: { a: string; b: string; marker: string } };
      return { order, a: r.data.a, b: r.data.b, marker: r.data.marker };
    }, reference: { order: ['A', 'B'], a: 'A', b: 'saw-a', marker: 'origin' } },
  { id: 'IC-03', title: 'the rejected side receives the typed HTTP error and its replacement is what the caller gets',
    async run(adapter) {
      const seen: string[] = []; const rezo = client(adapter);
      rezo.interceptors.response.use(undefined, (error: any) => { seen.push(`${error?.code}:${error?.response?.status}`); return new RezoError('replaced by interceptor', error.config, 'REZ_UNKNOWN_ERROR', error.request); });
      let outcome: string;
      try { await rezo.get(`${originFor(adapter)}/500`, { cache: false } as never); outcome = 'fulfilled'; } catch (error) { outcome = `${(error as { code?: string })?.code}:${(error as Error).message}`; }
      return { seen, outcome };
    }, reference: { seen: ['REZ_HTTP_ERROR:500'], outcome: 'REZ_UNKNOWN_ERROR:replaced by interceptor' } },
  { id: 'IC-04', title: 'eject removes exactly the ejected interceptor',
    async run(adapter) {
      const order: string[] = []; const rezo = client(adapter);
      const idA = rezo.interceptors.request.use((config: any) => { order.push('A'); return config; });
      rezo.interceptors.request.use((config: any) => { order.push('B'); return config; });
      rezo.interceptors.request.eject(idA);
      await rezo.get(`${originFor(adapter)}/echo`, { cache: false } as never);
      return { order };
    }, reference: { order: ['B'] } },
  { id: 'IC-05', title: 'per-request beforeRequest hooks run after the instance interceptors',
    async run(adapter) {
      const order: string[] = []; const rezo = client(adapter);
      rezo.interceptors.request.use((config: any) => { order.push('A'); setHeader(config, 'x-a', '1'); return config; });
      const r = await rezo.get(`${originFor(adapter)}/echo`, { cache: false, hooks: { beforeRequest: [(config: any) => { order.push('C'); setHeader(config, 'x-c', headerOf(config, 'x-a') === '1' ? 'saw-a' : 'no-a'); }] } } as never) as { data: { c: string | null } };
      return { order, c: r.data.c };
    }, reference: { order: ['A', 'C'], c: 'saw-a' } },
  { id: 'IC-06', title: 'runWhen false skips the interceptor',
    async run(adapter) {
      const order: string[] = []; const rezo = client(adapter);
      rezo.interceptors.request.use((config: any) => { order.push('A'); return config; }, undefined, { runWhen: () => false });
      rezo.interceptors.request.use((config: any) => { order.push('B'); return config; });
      await rezo.get(`${originFor(adapter)}/echo`, { cache: false } as never);
      return { order };
    }, reference: { order: ['B'] } },
];
for (const row of ROWS) for (const adapter of Object.keys(ADAPTERS) as AdapterName[]) {
  it(`${row.id} [${adapter}] ${row.title}`, async () => {
    const shape = await row.run(adapter);
    if (adapter === 'http1') expect(shape, 'HTTP/1.1 oracle').toEqual(row.reference);
    else { const reference = await row.run('http1'); expect(shape, `${adapter} vs HTTP/1.1`).toEqual(reference); }
  }, 20_000);
}
