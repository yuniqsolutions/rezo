/**
 * SFB on Deno — the Fetch adapter's stealth header identity and runtime-owned boundaries, executed natively under Deno.
 * Twin of test/a-plus-stealth-fetch-boundary.test.ts (Node + Bun). Run: deno test --allow-all --no-check <this file>.
 */
import { createServer, type Server } from 'node:http';
import { Rezo } from '../src/core/rezo.ts';
import { RezoStealth } from '../src/stealth/index.ts';
import type { ResolvedStealthProfile } from '../src/stealth/types.ts';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch.ts';
import { executeRequest as http1Adapter } from '../src/adapters/http.ts';
import { settle, startClientHelloObserver } from './fixtures/stealth/wire-observer.mjs';

const IDENTITY = 'chrome-131';
type Adapter = typeof fetchAdapter;
type Seen = { names: string[]; headers: Record<string, string | string[] | undefined> };

function fail(message: string): never { throw new Error(message); }
const equal = (actual: unknown, expected: unknown, label: string): void => { if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); };
const value = (seen: Seen, name: string): string | undefined => { const raw = seen.headers[name.toLowerCase()]; return Array.isArray(raw) ? raw.join(', ') : raw; };

async function withServer<T>(run: (origin: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    const names: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) names.push(request.rawHeaders[index].toLowerCase());
    seen.push({ names, headers: request.headers });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { return await run(origin, seen); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
async function send(origin: string, seen: Seen[], adapter: Adapter, headers?: Record<string, string>): Promise<{ seen: Seen; resolved: ResolvedStealthProfile }> {
  const stealth = new RezoStealth(IDENTITY);
  const resolved = stealth.resolve();
  const rezo = new Rezo({ stealth, retry: false, timeout: 6000 }, adapter);
  const before = seen.length;
  const response = await rezo.get(`${origin}/sfb`, headers ? { headers } : undefined);
  if (response.status !== 200) fail(`status ${response.status}`);
  if (seen.length !== before + 1) fail(`expected one wire hit, saw ${seen.length - before}`);
  return { seen: seen[before], resolved };
}
const orderOf = (seen: Seen, resolved: ResolvedStealthProfile) => {
  const profileNames = new Set(resolved.headerOrder.map((name) => name.toLowerCase()));
  const wire = seen.names.filter((name) => profileNames.has(name));
  const sent = new Set(wire);
  return { wire, profile: resolved.headerOrder.map((name) => name.toLowerCase()).filter((name) => sent.has(name)) };
};

Deno.test('SFB-01 (Deno) Fetch carries every profile header with the profile values', async () => {
  await withServer(async (origin, seen) => {
    const { seen: wire, resolved } = await send(origin, seen, fetchAdapter);
    const names = Object.keys(resolved.defaultHeaders);
    if (names.length < 12) fail(`profile exposes ${names.length} headers`);
    for (const name of names) equal(value(wire, name), resolved.defaultHeaders[name], name);
  });
});

Deno.test('SFB-02 (Deno) a caller header beats the profile default while the rest of the identity stays', async () => {
  await withServer(async (origin, seen) => {
    const { seen: wire, resolved } = await send(origin, seen, fetchAdapter, { 'user-agent': 'sfb-custom/1.0' });
    equal(value(wire, 'user-agent'), 'sfb-custom/1.0', 'user-agent');
    equal(value(wire, 'sec-ch-ua'), resolved.defaultHeaders['sec-ch-ua'], 'sec-ch-ua');
  });
});

Deno.test('SFB-03 (Deno) header order is runtime-owned on Fetch; HTTP/1.1 reproduces the profile order', async () => {
  await withServer(async (origin, seen) => {
    const fetchOrder = await send(origin, seen, fetchAdapter).then(({ seen: wire, resolved }) => orderOf(wire, resolved));
    const h1Order = await send(origin, seen, http1Adapter).then(({ seen: wire, resolved }) => orderOf(wire, resolved));
    equal(h1Order.wire, h1Order.profile, 'HTTP/1.1 order');
    if (fetchOrder.wire.length < 12) fail(`Fetch sent ${fetchOrder.wire.length} profile headers`);
    if (JSON.stringify(fetchOrder.wire) === JSON.stringify(fetchOrder.profile)) fail('Fetch reproduced the profile order — the boundary moved');
  });
});

Deno.test('SFB-04 (Deno) the HTTP/2-only priority header never reaches an HTTP/1.1 wire', async () => {
  await withServer(async (origin, seen) => {
    const viaFetch = await send(origin, seen, fetchAdapter);
    const viaH1 = await send(origin, seen, http1Adapter);
    if (viaFetch.resolved.extraHeaders.h2?.priority === undefined) fail('profile has no h2 priority header');
    if (value(viaFetch.seen, 'priority') !== undefined) fail('priority on the Fetch wire');
    if (value(viaH1.seen, 'priority') !== undefined) fail('priority on the HTTP/1.1 wire');
  });
});

Deno.test('SFB-05 (Deno) the ClientHello is runtime-owned on Fetch and differs from the profile material', async () => {
  const stealth = new RezoStealth(IDENTITY);
  const resolved = stealth.resolve();
  const observer = await startClientHelloObserver();
  try {
    const rezo = new Rezo({ stealth, rejectUnauthorized: false, retry: false, timeout: 6000 }, fetchAdapter);
    await settle(rezo.get(observer.url));
    const hello = observer.hellos[0] as { ciphers?: string[]; error?: string } | undefined;
    if (hello?.error !== undefined || hello?.ciphers === undefined) fail(`no ClientHello captured: ${hello?.error ?? 'empty'}`);
    const profileCiphers = resolved.tls.ciphers.split(':').filter((name) => !name.startsWith('@'));
    if (JSON.stringify(hello.ciphers) === JSON.stringify(profileCiphers)) fail('Deno fetch presented the profile cipher order — the boundary moved');
  } finally { await observer.close(); }
});
