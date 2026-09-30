/**
 * PM — ProxyManager failover and rotation as a consumer sees it, with local forward proxies (one that refuses every
 * connection, two that relay and tag the upstream request) on HTTP/1.1 and cURL, plus the Fetch adapter's stance on a
 * configured proxy pool (RED-first: a pool the adapter cannot honour must be a typed refusal, never a silent direct hit).
 * The origin echoes `x-forwarded-by` back as `x-served-via`, so every response says which proxy carried it.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { deadProxyPort, startForwardProxy, startHttpOrigin, type ForwardProxy, type Origin } from './fixtures/contract/servers.ts';

const ADAPTERS = { http1: http1Adapter, curl: curlAdapter, fetch: fetchAdapter } as const;
type AdapterName = keyof typeof ADAPTERS;
let origin: Origin; let proxyA: ForwardProxy; let proxyB: ForwardProxy; let deadPort: number;
const originHits: Array<{ via: string | null }> = [];
beforeAll(async () => {
  origin = await startHttpOrigin((request, response) => { const via = (request.headers['x-forwarded-by'] as string | undefined) ?? null; originHits.push({ via }); response.writeHead(200, { 'content-type': 'text/plain', 'x-served-via': via ?? 'direct' }); response.end('origin'); });
  proxyA = await startForwardProxy('A'); proxyB = await startForwardProxy('B'); deadPort = await deadProxyPort();
});
afterAll(async () => { await proxyA.close(); await proxyB.close(); await origin.close(); });
const proxyInfo = (port: number) => ({ protocol: 'http' as const, host: '127.0.0.1', port });
const dead = () => proxyInfo(deadPort);
// HTTP/1.1 reaches a proxy through a CONNECT tunnel (untagged at the origin); cURL sends absolute-URI requests. Both count as
// proxy activity; the origin's own hit count says whether the request arrived at all.
type Outcome = { status: number | null; code: string | null; isRezoError: boolean };
async function get(adapter: AdapterName, manager: Record<string, unknown>): Promise<Outcome> {
  const rezo = new Rezo({ retry: false, timeout: 8000, proxyManager: manager } as never, ADAPTERS[adapter]);
  try { const r = await rezo.get(`${origin.origin}/r`, { responseType: 'text', cache: false } as never) as { status: number }; return { status: r.status, code: null, isRezoError: false }; }
  catch (error) { const e = error as { code?: string; isRezoError?: boolean }; return { status: null, code: e?.code ?? null, isRezoError: e?.isRezoError === true }; }
}
const activity = (proxy: ForwardProxy): number => proxy.hits() + proxy.tunnels();
const snapshot = () => ({ origin: originHits.length, a: activity(proxyA), b: activity(proxyB) });
const delta = (before: ReturnType<typeof snapshot>) => { const now = snapshot(); return { origin: now.origin - before.origin, a: now.a - before.a, b: now.b - before.b }; };

for (const adapter of ['http1', 'curl'] as AdapterName[]) {
  it(`PM-01 [${adapter}] retryWithNextProxy: a refused proxy fails over to the next one; the origin is served via B`, async () => {
    const before = snapshot();
    const outcome = await get(adapter, { proxies: [dead(), proxyInfo(proxyB.port)], rotation: 'sequential', retryWithNextProxy: true, maxProxyRetries: 2 });
    expect(outcome).toEqual({ status: 200, code: null, isRezoError: false });
    expect(delta(before)).toEqual({ origin: 1, a: 0, b: 1 });
  }, 20_000);
  it(`PM-02 [${adapter}] without retryWithNextProxy a refused proxy is the typed outcome and the origin is never reached`, async () => {
    const before = snapshot();
    const outcome = await get(adapter, { proxies: [dead()], rotation: 'sequential', retryWithNextProxy: false });
    expect(outcome.status).toBeNull(); expect(outcome.isRezoError).toBe(true);
    expect(['ECONNREFUSED', 'REZ_PROXY_CONNECTION_FAILED']).toContain(outcome.code);
    expect(delta(before)).toEqual({ origin: 0, a: 0, b: 0 });
  }, 20_000);
  it(`PM-03 [${adapter}] failWithoutProxy false: once the only proxy is disabled the request goes direct`, async () => {
    const manager = { proxies: [dead()], rotation: 'sequential', retryWithNextProxy: true, maxProxyRetries: 2, autoDisableDeadProxies: true, maxFailures: 1, failWithoutProxy: false };
    const before = snapshot();
    const outcome = await get(adapter, manager);
    expect(outcome).toEqual({ status: 200, code: null, isRezoError: false });
    expect(delta(before)).toEqual({ origin: 1, a: 0, b: 0 });
  }, 20_000);
  it(`PM-04 [${adapter}] failWithoutProxy true: an exhausted pool is REZ_NO_PROXY_AVAILABLE with no wire contact`, async () => {
    const rezo = new Rezo({ retry: false, timeout: 8000, proxyManager: { proxies: [dead()], rotation: 'sequential', retryWithNextProxy: true, maxProxyRetries: 2, autoDisableDeadProxies: true, maxFailures: 1, failWithoutProxy: true } } as never, ADAPTERS[adapter]);
    const codes: Array<string | null> = [];
    const before = snapshot();
    for (let i = 0; i < 2; i += 1) { try { await rezo.get(`${origin.origin}/r`, { cache: false } as never); codes.push('fulfilled'); } catch (error) { codes.push((error as { code?: string })?.code ?? null); } }
    expect(codes[1]).toBe('REZ_NO_PROXY_AVAILABLE');
    expect(delta(before)).toEqual({ origin: 0, a: 0, b: 0 });
  }, 20_000);
  it(`PM-06 [${adapter}] sequential rotation with requestsPerProxy 1 alternates A, B, A, B`, async () => {
    const rezo = new Rezo({ retry: false, timeout: 8000, proxyManager: { proxies: [proxyInfo(proxyA.port), proxyInfo(proxyB.port)], rotation: 'sequential', requestsPerProxy: 1 } } as never, ADAPTERS[adapter]);
    const sequence: string[] = [];
    for (let i = 0; i < 4; i += 1) { const before = snapshot(); const r = await rezo.get(`${origin.origin}/r`, { cache: false } as never) as { status: number }; expect(r.status).toBe(200); const d = delta(before); sequence.push(d.a === 1 && d.b === 0 ? 'A' : d.b === 1 && d.a === 0 ? 'B' : `?${JSON.stringify(d)}`); }
    expect(sequence).toEqual(['A', 'B', 'A', 'B']);
  }, 20_000);
}
it('PM-05 [fetch] a configured proxy pool the Fetch adapter cannot honour is a typed REZ_UNSUPPORTED_CAPABILITY refusal, never a silent direct request', async () => {
  const before = snapshot();
  const outcome = await get('fetch', { proxies: [proxyInfo(proxyA.port)], rotation: 'sequential' });
  expect(outcome).toEqual({ status: null, code: 'REZ_UNSUPPORTED_CAPABILITY', isRezoError: true });
  expect(delta(before)).toEqual({ origin: 0, a: 0, b: 0 });
}, 20_000);
