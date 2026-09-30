/**
 * SPC — stealth through a TLS-fronted CONNECT proxy (PLAN/stealth-wire-fidelity v4, named finding).
 *
 * Both HTTP adapters spoke plaintext to an `https://` CONNECT proxy (`ERR_SSL_HTTPS_PROXY_REQUEST`), with or without
 * stealth, while the proxy agents tunnelled correctly when driven directly: `parseProxyString` classified every `https://`
 * proxy as `http` (tested `startsWith('http')` first — 2026-08-29, carrier test/a-plus-proxy-scheme-classification.test.ts).
 * These two rows carried the finding RED and are GREEN since the fix; they stay apart from the route-parity carrier. Row ids
 * are unchanged from the plan registry (SRP-1-connect, SRP-2-connect). SPC-03 is the always-GREEN control (a plaintext http://
 * CONNECT proxy is unaffected by the scheme order) so a mutation leg that kills both TLS rows still leaves a parseable summary.
 */

import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoStealth } from '../src/stealth/index';
import { generateSanCertificate, settle, startClientHelloObserver, startConnectProxy } from './fixtures/stealth/wire-observer.mjs';

const ORACLES = JSON.parse(readFileSync(new URL('./fixtures/stealth/expected/identities.json', import.meta.url), 'utf8')).identities;
void ORACLES;
const certificate = generateSanCertificate();
const observers: Array<{ close: () => Promise<void> }> = [];
afterAll(async () => { for (const observer of observers) await observer.close(); });

const ADAPTERS = { 1: http1Adapter, 2: http2Adapter } as const;
type Hello = { ciphers: string[]; sigalgs: string[]; supportedGroups: string[]; keyShareGroups: string[]; alpn: string[]; error?: string };

/** Observes the ClientHello a client emits towards a fresh hello observer, optionally through a proxy; the request itself is expected to fail. */
async function helloVia(adapter: 1 | 2, requestOptions: Record<string, unknown> = {}, identity = 'chrome-131'): Promise<Hello> {
  const observer = await startClientHelloObserver(); observers.push(observer);
  const rezo = new Rezo({ stealth: new RezoStealth(identity as never), rejectUnauthorized: false, retry: false, timeout: 6000 }, ADAPTERS[adapter]);
  const result = await settle(rezo.get(observer.url, requestOptions as never));
  return observer.hellos[0] ?? { error: `no ClientHello observed (${result.ok ? 'request succeeded' : String((result.error as Error)?.message)})`, ciphers: [], sigalgs: [], supportedGroups: [], keyShareGroups: [], alpn: [] };
}
const transport = (hello: Hello) => ({ ciphers: hello.ciphers, sigalgs: hello.sigalgs, supportedGroups: hello.supportedGroups, keyShareGroups: hello.keyShareGroups, alpn: hello.alpn });
const direct: Partial<Record<1 | 2, Promise<Hello>>> = {};
const directHello = (adapter: 1 | 2) => (direct[adapter] ??= helloVia(adapter));

for (const adapter of [1, 2] as const) {
  const label = adapter === 1 ? 'H1' : 'H2';
  it(`SRP-${adapter}-connect ${label} through a TLS-fronted CONNECT proxy the target sees the same ClientHello as direct`, async () => {
    const proxy = await startConnectProxy({ secure: certificate }); observers.push(proxy);
    const hello = await helloVia(adapter, { proxy: proxy.url });
    expect(hello.error).toBeUndefined();
    expect(proxy.tunnels).toHaveLength(1);
    expect(transport(hello)).toEqual(transport(await directHello(adapter)));
  });
}

it('SPC-03 control: through a plaintext http:// CONNECT proxy the target sees the same ClientHello as direct (H1)', async () => {
  const proxy = await startConnectProxy(); observers.push(proxy);
  const hello = await helloVia(1, { proxy: proxy.url });
  expect(hello.error).toBeUndefined();
  expect(proxy.tunnels).toHaveLength(1);
  expect(transport(hello)).toEqual(transport(await directHello(1)));
});
