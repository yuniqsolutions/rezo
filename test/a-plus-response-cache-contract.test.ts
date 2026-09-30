/**
 * RC — the response cache as a consumer sees it, on every adapter that offers it (HTTP/1.1, HTTP/2, Fetch, cURL):
 * a fresh `max-age` response is served from the cache on the second request (one wire hit), `no-store` is never cached,
 * `no-cache` + ETag revalidates with `If-None-Match` and a 304 hands back the cached body, streams and POSTs are never
 * cached, and `cache: false` always hits the wire. HTTP/1.1 is measured in-row as the reference; every other adapter must
 * match its shape field by field. Wire hits are counted by the fixture per unique key, so rows never share cache entries.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { startH2Origin, startHttpOrigin, type Handler, type Origin } from './fixtures/contract/servers.ts';

const ADAPTERS = { http1: http1Adapter, http2: http2Adapter, fetch: fetchAdapter, curl: curlAdapter } as const;
type AdapterName = keyof typeof ADAPTERS;
const hits = new Map<string, Array<{ ifNoneMatch: string | null; method: string; headers: Record<string, unknown> }>>();
const handler: Handler = (request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture');
  const key = url.searchParams.get('k') ?? 'none';
  const list = hits.get(key) ?? []; hits.set(key, list);
  list.push({ ifNoneMatch: (request.headers['if-none-match'] as string | undefined) ?? null, method: request.method ?? 'GET', headers: { ...request.headers } });
  const n = list.length;
  const text = (status: number, body: string, headers: Record<string, string>) => { response.writeHead(status, { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(body)), ...headers }); response.end(body); };
  if (url.pathname === '/max-age') return text(200, `hit-${n}`, { 'cache-control': 'max-age=60' });
  if (url.pathname === '/no-store') return text(200, `hit-${n}`, { 'cache-control': 'no-store' });
  if (url.pathname === '/etag') {
    if (request.headers['if-none-match'] === '"v1"') { response.writeHead(304, { etag: '"v1"', 'cache-control': 'no-cache' }); response.end(); return; }
    return text(200, `fresh-${n}`, { etag: '"v1"', 'cache-control': 'no-cache' });
  }
  if (url.pathname === '/post') return text(200, `post-${n}`, { 'cache-control': 'max-age=60' });
  return text(404, 'no route', {});
};
let plain: Origin; let h2: Origin;
beforeAll(async () => { plain = await startHttpOrigin(handler); h2 = await startH2Origin(handler); });
afterAll(async () => { await plain.close(); await h2.close(); });

let sequence = 0;
const key = (adapter: string, row: string): string => `${adapter}-${row}-${process.pid}-${++sequence}`;
const originFor = (adapter: AdapterName): string => (adapter === 'http2' ? h2.origin : plain.origin);
const client = (adapter: AdapterName) => new Rezo({ retry: false, timeout: 8000, rejectUnauthorized: false } as never, ADAPTERS[adapter]);

type Shape = { hits: number; bodies: string[]; conditional: Array<string | null>; statuses: number[] };
async function twice(adapter: AdapterName, path: string, k: string, options: Record<string, unknown>): Promise<Shape> {
  const rezo = client(adapter); const bodies: string[] = []; const statuses: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const response = await rezo.get(`${originFor(adapter)}${path}?k=${k}`, { ...options, responseType: 'text' } as never) as { data: string; status: number };
    bodies.push(String(response.data)); statuses.push(response.status);
  }
  const seen = hits.get(k) ?? [];
  return { hits: seen.length, bodies, conditional: seen.map((hit) => hit.ifNoneMatch), statuses };
}
const ROWS: Array<{ id: string; title: string; run(adapter: AdapterName): Promise<Shape>; reference: Shape }> = [
  { id: 'RC-01', title: 'a fresh max-age response is served from the cache on the second request: one wire hit, same body',
    run: (adapter) => twice(adapter, '/max-age', key(adapter, 'rc01'), { cache: true }),
    reference: { hits: 1, bodies: ['hit-1', 'hit-1'], conditional: [null], statuses: [200, 200] } },
  { id: 'RC-02', title: 'no-store is never cached: two wire hits, two bodies',
    run: (adapter) => twice(adapter, '/no-store', key(adapter, 'rc02'), { cache: true }),
    reference: { hits: 2, bodies: ['hit-1', 'hit-2'], conditional: [null, null], statuses: [200, 200] } },
  { id: 'RC-03', title: 'no-cache + ETag revalidates: the second request carries If-None-Match, the 304 hands back the cached body as a 200',
    run: (adapter) => twice(adapter, '/etag', key(adapter, 'rc03'), { cache: true }),
    reference: { hits: 2, bodies: ['fresh-1', 'fresh-1'], conditional: [null, '"v1"'], statuses: [200, 200] } },
  { id: 'RC-05', title: 'POST is never cached by default: two wire hits',
    run: async (adapter) => { const rezo = client(adapter); const k = key(adapter, 'rc05'); const bodies: string[] = []; for (let i = 0; i < 2; i += 1) { const r = await rezo.post(`${originFor(adapter)}/post?k=${k}`, 'x', { cache: true, responseType: 'text' } as never) as { data: string }; bodies.push(String(r.data)); } const seen = hits.get(k) ?? []; return { hits: seen.length, bodies, conditional: seen.map((h) => h.ifNoneMatch), statuses: [200, 200] }; },
    reference: { hits: 2, bodies: ['post-1', 'post-2'], conditional: [null, null], statuses: [200, 200] } },
  { id: 'RC-06', title: 'control: cache false always hits the wire',
    run: (adapter) => twice(adapter, '/max-age', key(adapter, 'rc06'), { cache: false }),
    reference: { hits: 2, bodies: ['hit-1', 'hit-2'], conditional: [null, null], statuses: [200, 200] } },
];
for (const row of ROWS) for (const adapter of Object.keys(ADAPTERS) as AdapterName[]) {
  it(`${row.id} [${adapter}] ${row.title}`, async () => {
    const shape = await row.run(adapter);
    if (adapter === 'http1') expect(shape, `HTTP/1.1 oracle | second request headers ${JSON.stringify((hits.get([...hits.keys()].pop() ?? '') ?? [])[1]?.headers ?? null)}`).toEqual(row.reference);
    else { const reference = await row.run('http1'); expect(shape, `${adapter} vs HTTP/1.1`).toEqual(reference); }
  }, 20_000);
}
it('RC-04 streams are never cached: two stream requests with cache true hit the wire twice (HTTP/1.1, Fetch, cURL)', async () => {
  for (const adapter of ['http1', 'fetch', 'curl'] as AdapterName[]) {
    const rezo = client(adapter); const k = key(adapter, 'rc04');
    for (let i = 0; i < 2; i += 1) await new Promise<void>((resolve, reject) => { const s: any = rezo.stream(`${originFor(adapter)}/max-age?k=${k}`, { cache: true } as never); s.on('data', () => undefined); s.on('complete', () => resolve()); s.on('close', () => resolve()); s.on('error', (e: unknown) => reject(e)); setTimeout(() => reject(new Error(`${adapter}: stream did not settle`)), 5000); });
    expect((hits.get(k) ?? []).length, `${adapter} stream wire hits`).toBe(2);
  }
}, 30_000);
