/**
 * SFB — stealth header identity and runtime-owned boundaries on the Fetch adapter (Node + Bun; the Deno rows live in
 * test/a-plus-stealth-fetch-boundary.deno.ts).
 *
 * The core resolves the stealth profile once per request and merges its headers into every adapter's request
 * (src/core/rezo.ts), so the Fetch adapter carries the same header identity as HTTP/1.1. What the runtime's own `fetch`
 * owns and Rezo cannot shape — header order, the TLS ClientHello, and on Node the spec-forced `sec-fetch-mode` — is pinned
 * here per runtime as a measured fact, with the HTTP/1.1 adapter on the same wire as the contrast. A runtime that starts
 * (or stops) honouring any of it turns a row RED instead of drifting silently.
 *
 * Rows: SFB-01 header identity · SFB-02 caller headers win · SFB-03 order is runtime-owned (H1 contrast) ·
 *       SFB-04 the HTTP/2-only `priority` header stays off the H1 wire · SFB-05 ClientHello is runtime-owned (H1 contrast).
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { RezoStealth } from '../src/stealth/index';
import type { ResolvedStealthProfile } from '../src/stealth/types';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { installNodeRequireBridge } from './fixtures/node-require-bridge';
import { settle, startClientHelloObserver } from './fixtures/stealth/wire-observer.mjs';

const IDENTITY = 'chrome-131';
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const ORACLE_FILE = JSON.parse(readFileSync(new URL('./fixtures/stealth/expected/identities.json', import.meta.url), 'utf8'));
/** Resolves `{ "same": "<identity>" }` references so the identity's TLS oracle is a literal list (same rule as SWF). */
function oracleCiphers(id: string, depth = 0): string[] {
  if (depth > 4) throw new Error(`oracle reference cycle at ${id}`);
  const raw = ORACLE_FILE.identities[id];
  if (!raw) throw new Error(`no oracle for ${id}`);
  const tls = raw.tls;
  if (tls && typeof tls.same === 'string') return oracleCiphers(tls.same, depth + 1);
  if (tls && tls.ciphers && typeof tls.ciphers.same === 'string') return oracleCiphers(tls.ciphers.same, depth + 1);
  return tls.ciphers as string[];
}
type Adapter = typeof fetchAdapter;
type Seen = { names: string[]; headers: Record<string, string | string[] | undefined> };

const seen: Seen[] = [];
const observers: Array<{ close: () => Promise<void> }> = [];
let server: Server; let origin = ''; let requireBridge: { restore(): void } | undefined;

beforeAll(async () => {
  if (!IS_BUN) requireBridge = installNodeRequireBridge();
  server = createServer((request, response) => {
    const names: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) names.push(request.rawHeaders[index].toLowerCase());
    seen.push({ names, headers: request.headers });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const observer of observers) await observer.close();
  requireBridge?.restore();
});

/** One request through `adapter` with a fresh `chrome-131` identity; returns what the server saw and the profile the instance used. */
async function send(adapter: Adapter, headers?: Record<string, string>): Promise<{ seen: Seen; resolved: ResolvedStealthProfile }> {
  const stealth = new RezoStealth(IDENTITY);
  const resolved = stealth.resolve();
  const rezo = new Rezo({ stealth, retry: false, timeout: 6000 }, adapter);
  const before = seen.length;
  const response = await rezo.get(`${origin}/sfb`, headers ? { headers } : undefined);
  expect(response.status).toBe(200);
  expect(seen.length, 'exactly one wire hit').toBe(before + 1);
  return { seen: seen[before], resolved };
}
const value = (seen: Seen, name: string): string | undefined => { const raw = seen.headers[name.toLowerCase()]; return Array.isArray(raw) ? raw.join(', ') : raw; };
/** The wire order restricted to the profile's header names, and the profile order restricted to the names actually sent. */
const orderOf = (seen: Seen, resolved: ResolvedStealthProfile) => {
  const profileNames = new Set(resolved.headerOrder.map((name) => name.toLowerCase()));
  const wire = seen.names.filter((name) => profileNames.has(name));
  const sent = new Set(wire);
  return { wire, profile: resolved.headerOrder.map((name) => name.toLowerCase()).filter((name) => sent.has(name)) };
};

it('SFB-01 Fetch carries every profile header; only the runtime-owned sec-fetch-mode differs, and only on Node', async () => {
  const { seen: wire, resolved } = await send(fetchAdapter);
  const names = Object.keys(resolved.defaultHeaders);
  expect(names.length).toBeGreaterThanOrEqual(12);
  for (const name of names) expect(value(wire, name), name).toBeDefined();
  const runtimeOwned = new Set(IS_BUN ? [] : ['sec-fetch-mode']);
  for (const name of names) if (!runtimeOwned.has(name.toLowerCase())) expect(value(wire, name), name).toBe(resolved.defaultHeaders[name]);
  // Node's fetch (undici) sets sec-fetch-mode from the request mode, and the Fetch standard forbids `navigate` from script.
  expect(value(wire, 'sec-fetch-mode')).toBe(IS_BUN ? resolved.defaultHeaders['sec-fetch-mode'] : 'cors');
  expect(resolved.defaultHeaders['sec-fetch-mode']).toBe('navigate');
});

it('SFB-02 a caller header beats the profile default on Fetch while the rest of the identity stays', async () => {
  const { seen: wire, resolved } = await send(fetchAdapter, { 'user-agent': 'sfb-custom/1.0' });
  expect(value(wire, 'user-agent')).toBe('sfb-custom/1.0');
  expect(value(wire, 'sec-ch-ua')).toBe(resolved.defaultHeaders['sec-ch-ua']);
  expect(value(wire, 'accept-language')).toBe(resolved.defaultHeaders['accept-language']);
});

it('SFB-03 header order is runtime-owned on Fetch; HTTP/1.1 reproduces the profile order on the same wire (Node) or records the Bun boundary', async () => {
  const fetchOrder = await send(fetchAdapter).then(({ seen: wire, resolved }) => orderOf(wire, resolved));
  const viaH1 = await send(http1Adapter);
  const h1Order = orderOf(viaH1.seen, viaH1.resolved);
  if (IS_BUN) {
    // Bun's node:http emits headers in its own order; the product records that on the resolved profile instead of hiding it.
    expect(viaH1.resolved.tlsBoundary.notExpressible).toContain('h1HeaderOrder');
    expect(h1Order.wire, 'Bun node:http order is the runtime\'s').not.toEqual(h1Order.profile);
  } else {
    expect(viaH1.resolved.tlsBoundary.notExpressible).not.toContain('h1HeaderOrder');
    expect(h1Order.wire, 'HTTP/1.1 adapter order').toEqual(h1Order.profile);
  }
  expect(fetchOrder.wire.length).toBeGreaterThanOrEqual(12);
  expect(fetchOrder.wire, 'Fetch order is the runtime\'s, not the profile\'s').not.toEqual(fetchOrder.profile);
});

it('SFB-04 the HTTP/2-only priority header belongs to the profile but never reaches an HTTP/1.1 wire', async () => {
  const viaFetch = await send(fetchAdapter);
  const viaH1 = await send(http1Adapter);
  expect(viaFetch.resolved.extraHeaders.h2?.priority).toBeDefined();
  expect(value(viaFetch.seen, 'priority')).toBeUndefined();
  expect(value(viaH1.seen, 'priority')).toBeUndefined();
});

it('SFB-05 the ClientHello is runtime-owned on Fetch; HTTP/1.1 presents the profile material (Node) or the recorded Bun boundary', async () => {
  const profileCiphers = oracleCiphers(IDENTITY);
  const bunDefault: string[] = ORACLE_FILE.runtimes.bun.defaultHello.h1.ciphers;
  const helloThrough = async (adapter: Adapter): Promise<{ ciphers: string[]; resolved: ResolvedStealthProfile }> => {
    const stealth = new RezoStealth(IDENTITY);
    const resolved = stealth.resolve();
    const observer = await startClientHelloObserver(); observers.push(observer);
    const rezo = new Rezo({ stealth, rejectUnauthorized: false, retry: false, timeout: 6000 }, adapter);
    await settle(rezo.get(observer.url));
    const hello = observer.hellos[0] as { ciphers?: string[]; error?: string } | undefined;
    expect(hello?.error, 'ClientHello capture').toBeUndefined();
    expect(hello?.ciphers, 'ClientHello captured').toBeDefined();
    return { ciphers: hello!.ciphers!, resolved };
  };
  const viaH1 = await helloThrough(http1Adapter);
  const viaFetch = await helloThrough(fetchAdapter);
  if (IS_BUN) {
    // BoringSSL ignores the node:tls shaping: both adapters present Bun's fixed hello and the product records the boundary.
    expect(viaH1.ciphers).toEqual(bunDefault);
    expect(viaFetch.ciphers).toEqual(bunDefault);
    expect(viaFetch.resolved.tlsBoundary.runtime.tlsShaping).toBe('unavailable');
  } else {
    expect(viaH1.resolved.tlsBoundary.runtime.tlsShaping).toBe('available');
    expect(viaH1.ciphers, 'HTTP/1.1 presents the profile cipher order').toEqual(profileCiphers);
    expect(viaFetch.ciphers, 'Fetch presents the runtime\'s own hello').not.toEqual(profileCiphers);
  }
});
