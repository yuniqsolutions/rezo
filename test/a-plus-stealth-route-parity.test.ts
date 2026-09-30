/**
 * SRP — stealth route parity carrier (PLAN/stealth-wire-fidelity v4, phase 1).
 *
 * The identity must reach the target unchanged on every route Rezo offers: direct (control), string and
 * object HTTP proxies and SOCKS5 — for HTTP/1.1 and HTTP/2 — plus Bun's SOCKS path (the TLS-fronted CONNECT
 * rows live in test/a-plus-stealth-proxy-connect.test.ts while that named finding stays RED). Conflicts must be typed: a custom agent cannot carry a profile's TLS (Q2), an unsupported platform
 * is a typed error (Q3), and the cURL adapter maps what curl can express and refuses the rest (Q4). Route
 * rows compare the ClientHello observed through the route with the ClientHello observed directly.
 */

import * as https from 'node:https';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { RezoStealth, resolveProfile } from '../src/stealth/index';
import { settle, startClientHelloObserver, startConnectProxy, startSocks5Proxy } from './fixtures/stealth/wire-observer.mjs';

const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const ORACLES = JSON.parse(readFileSync(new URL('./fixtures/stealth/expected/identities.json', import.meta.url), 'utf8')).identities;
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
  it(`SRP-${adapter}-direct ${label} direct route emits exactly the resolved profile's declared TLS material (control)`, async () => {
    const hello = await directHello(adapter);
    expect(hello.error).toBeUndefined();
    const declared = resolveProfile('chrome-131' as never).tls;
    expect(hello.ciphers).toEqual(declared.ciphers.split(':').filter((name) => !name.startsWith('@')));
    expect(hello.sigalgs).toEqual(declared.sigalgs.split(':'));
    expect(hello.supportedGroups).toEqual(declared.ecdhCurve.split(':').map((group) => group.replace(/^\*/u, '')));
    expect(hello.alpn).toEqual(adapter === 1 ? ['http/1.1'] : declared.alpnProtocols);
  });
  it(`SRP-${adapter}-str ${label} through a string HTTP proxy the target sees the same ClientHello as direct`, async () => {
    const proxy = await startConnectProxy(); observers.push(proxy);
    const hello = await helloVia(adapter, { proxy: proxy.url });
    expect(hello.error).toBeUndefined();
    expect(proxy.tunnels).toHaveLength(1);
    expect(transport(hello)).toEqual(transport(await directHello(adapter)));
  });
  it(`SRP-${adapter}-obj ${label} through an object HTTP proxy the target sees the same ClientHello as direct`, async () => {
    const proxy = await startConnectProxy(); observers.push(proxy);
    const hello = await helloVia(adapter, { proxy: { protocol: 'http', host: '127.0.0.1', port: proxy.port } });
    expect(hello.error).toBeUndefined();
    expect(proxy.tunnels).toHaveLength(1);
    expect(transport(hello)).toEqual(transport(await directHello(adapter)));
  });
  it(`SRP-${adapter}-socks ${label} through SOCKS5 the target sees the same ClientHello as direct`, async () => {
    const proxy = await startSocks5Proxy(); observers.push(proxy);
    const hello = await helloVia(adapter, { proxy: proxy.url });
    expect(hello.error).toBeUndefined();
    expect(proxy.connects).toHaveLength(1);
    expect(transport(hello)).toEqual(transport(await directHello(adapter)));
  });
}

if (IS_BUN) {
  it('SRP-bun-socks Bun HTTP/1.1 through SOCKS5 carries the profile TLS to the target (no generic rebuilt socket)', async () => {
    const proxy = await startSocks5Proxy(); observers.push(proxy);
    const hello = await helloVia(1, { proxy: proxy.url });
    expect(hello.error).toBeUndefined();
    expect(transport(hello)).toEqual(transport(await directHello(1)));
  });
}

it('SRP-agent-1 HTTP/1.1: a custom httpsAgent together with a stealth profile is refused with REZ_UNSUPPORTED_CAPABILITY', async () => {
  const observer = await startClientHelloObserver(); observers.push(observer);
  const rezo = new Rezo({ stealth: new RezoStealth('chrome-131'), rejectUnauthorized: false, retry: false, timeout: 6000 }, http1Adapter);
  const result = await settle(rezo.get(observer.url, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } as never));
  expect(result.ok).toBe(false);
  expect((result as { error: { code?: string } }).error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observer.hellos).toHaveLength(0);
});

it('SRP-agent-2 HTTP/2: a custom httpsAgent together with a stealth profile is refused with REZ_UNSUPPORTED_CAPABILITY', async () => {
  const observer = await startClientHelloObserver(); observers.push(observer);
  const rezo = new Rezo({ stealth: new RezoStealth('chrome-131'), rejectUnauthorized: false, retry: false, timeout: 6000 }, http2Adapter);
  const result = await settle(rezo.get(observer.url, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } as never));
  expect(result.ok).toBe(false);
  expect((result as { error: { code?: string } }).error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observer.hellos).toHaveLength(0);
});

it('SRP-platform an unsupported platform for the chosen profile is a typed REZ_STEALTH_PLATFORM_UNSUPPORTED error, never a silent substitute', () => {
  for (const options of [{ profile: 'safari-18.2', platform: 'windows' }, { profile: 'safari-18.2', platform: 'linux' }, { profile: 'chrome-131', platform: 'ios' }] as const) {
    let thrown: { code?: string; message?: string } | null = null;
    try { resolveProfile(options as never); } catch (error) { thrown = error as { code?: string }; }
    expect(thrown, `${options.profile} on ${options.platform} resolved silently`).not.toBeNull();
    expect(thrown?.code).toBe('REZ_STEALTH_PLATFORM_UNSUPPORTED');
  }
});

it('SRP-consistency the user-agent, client hints and navigator agree on the selected platform (control)', () => {
  const resolved = resolveProfile({ profile: 'chrome-131', platform: 'macos' } as never);
  expect(resolved.defaultHeaders['user-agent']).toContain('Macintosh');
  expect(resolved.defaultHeaders['sec-ch-ua-platform']).toBe('"macOS"');
  expect(resolved.defaultHeaders['sec-ch-ua-mobile']).toBe('?0');
  expect(resolved.navigator.platform).toBe('MacIntel');
  expect(resolved.navigator.maxTouchPoints).toBe(0);
});

it('SRP-curl-map cURL with a profile curl can express (safari-18.2) puts the mapped ciphers, groups and ALPN on the wire', async () => {
  const observer = await startClientHelloObserver(); observers.push(observer);
  const rezo = new Rezo({ stealth: new RezoStealth('safari-18.2'), rejectUnauthorized: false, retry: false, timeout: 8000 }, curlAdapter);
  await settle(rezo.get(observer.url));
  const hello = observer.hellos[0] as Hello | undefined;
  expect(hello, 'no ClientHello observed from curl').toBeDefined();
  // curl's OpenSSL appends the TLS_EMPTY_RENEGOTIATION_INFO_SCSV signalling value after the cipher list; no curl flag
  // controls it, so it is a documented boundary of the curl route (`renegotiationScsv`), not a cipher the profile chose.
  expect(hello!.ciphers.filter((suite) => !suite.endsWith('_SCSV'))).toEqual(ORACLES['safari-18.2'].tls.ciphers);
  expect(hello!.supportedGroups).toEqual(ORACLES['safari-18.2'].tls.supportedGroups);
  expect(hello!.alpn).toEqual(['h2', 'http/1.1']);
});

it('SRP-curl-refuse cURL with a profile demanding what the probed curl cannot express (chrome-131 hybrid group) is refused with REZ_UNSUPPORTED_CAPABILITY', async () => {
  const observer = await startClientHelloObserver(); observers.push(observer);
  const rezo = new Rezo({ stealth: new RezoStealth('chrome-131'), rejectUnauthorized: false, retry: false, timeout: 8000 }, curlAdapter);
  const result = await settle(rezo.get(observer.url));
  expect(result.ok).toBe(false);
  expect((result as { error: { code?: string } }).error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observer.hellos).toHaveLength(0);
});

it('SRP-curl-probe-fail a failing curl probe surfaces as REZ_UNSUPPORTED_CAPABILITY, never a raw error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stealth-curl-probe-'));
  const fakeCurl = join(dir, 'curl'); writeFileSync(fakeCurl, '#!/bin/sh\necho "fake curl: probe failure" 1>&2\nexit 2\n'); chmodSync(fakeCurl, 0o755);
  const root = process.cwd().replace(/\\/gu, '/');
  const script = join(dir, 'probe.mjs');
  writeFileSync(script, [
    `const { Rezo } = await import(${JSON.stringify(`file://${root}/src/core/rezo.ts`)});`,
    `const { executeRequest } = await import(${JSON.stringify(`file://${root}/src/adapters/curl.ts`)});`,
    `const { RezoStealth } = await import(${JSON.stringify(`file://${root}/src/stealth/stealth.ts`)});`,
    "const rezo = new Rezo({ stealth: new RezoStealth('safari-18.2'), retry: false, timeout: 5000 }, executeRequest);",
    "try { await rezo.get('https://localhost:9/'); console.log(JSON.stringify({ ok: true })); } catch (error) { console.log(JSON.stringify({ ok: false, code: error && error.code, name: error && error.name, message: String(error && error.message).slice(0, 200) })); }",
  ].join('\n'));
  const args = IS_BUN ? [script] : ['--import', 'tsx', script];
  const child = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` } });
  const line = child.stdout.trim().split('\n').pop() ?? '';
  let verdict: { ok: boolean; code?: string; message?: string } = { ok: true };
  try { verdict = JSON.parse(line); } catch { verdict = { ok: true, message: `unparsable child output: ${child.stdout.slice(-200)} ${child.stderr.slice(-200)}` }; }
  expect(verdict.ok, verdict.message).toBe(false);
  expect(verdict.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
});
