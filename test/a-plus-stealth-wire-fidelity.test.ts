/**
 * SWF / SWF2 — stealth wire fidelity carrier (PLAN/stealth-wire-fidelity v4, phase 1).
 *
 * Every row measures what a stealth identity actually puts on the wire, from the server side of a real
 * connection, against the independent oracle in test/fixtures/stealth/expected/identities.json:
 *   a  ClientHello ciphers + sigalgs + supported versions + ALPN        b  supported groups + key-share groups
 *   c  header order on the wire (+ client-hint values for Chromium)     d  HTTP/2 pseudo-header order
 *   e  HTTP/2 SETTINGS id set, order and values                          f  HTTP/2 connection WINDOW_UPDATE
 * SWF rows cover the shipped identities (chrome-131, firefox-133, safari-18.2, edge-131); SWF2 rows cover the
 * current identities (chrome-151, edge-151, firefox-154, safari-26.6) and are RED until phase 3 ships them.
 * SWF-fallback (Node only) proves the hybrid-group probe fallback path. Rows never skip: an identity that cannot
 * be resolved fails its rows with the resolution error.
 */

import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoStealth, resolveProfile } from '../src/stealth/index';
import { generateSanCertificate, settle, startClientHelloObserver, startH1Observer, startH2FrameObserver, startH2Observer } from './fixtures/stealth/wire-observer.mjs';
import { chromiumGreaseBrands, validateKnownObservations } from './fixtures/stealth/chromium-grease.mjs';

type Oracle = {
  tls: { ciphers: string[]; sigalgs: string[]; supportedGroups: string[]; keyShareGroups: string[]; supportedVersions: string[]; alpn: { h1: string[]; h2: string[] } };
  h1HeaderOrder: string[];
  h2: { pseudoOrder: string[]; headerOrder: string[]; settings: [number, number][]; windowUpdate: number };
  clientHints: { 'sec-ch-ua': string; 'sec-ch-ua-mobile': string } | null;
  accept: string; acceptEncoding: string; userAgentMajor: number;
};
const ORACLE_FILE = JSON.parse(readFileSync(new URL('./fixtures/stealth/expected/identities.json', import.meta.url), 'utf8'));
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
/** Resolves `{ "same": "<identity>" }` references field by field so every identity is a complete literal oracle. */
function oracleFor(id: string, depth = 0): Oracle {
  if (depth > 4) throw new Error(`oracle reference cycle at ${id}`);
  const raw = ORACLE_FILE.identities[id];
  if (!raw) throw new Error(`no oracle for ${id}`);
  const resolve = (value: unknown, path: string[]): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.same === 'string') { let target: unknown = oracleFor(record.same, depth + 1); for (const key of path) target = (target as Record<string, unknown>)[key]; return target; }
      return Object.fromEntries(Object.entries(record).map(([key, inner]) => [key, resolve(inner, [...path, key])]));
    }
    return value;
  };
  return resolve(raw, []) as Oracle;
}
const BRAND: Record<string, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge' };
const expectedSecChUa = (id: string, oracle: Oracle): string | null => {
  if (!oracle.clientHints) return null;
  const value = oracle.clientHints['sec-ch-ua'];
  const algorithm = /^algorithm:chromium-grease\((\d+), "([^"]+)"\)$/u.exec(value);
  return algorithm ? chromiumGreaseBrands(Number(algorithm[1]), algorithm[2]) : value;
};

const IDENTITIES = {
  SWF: { C: 'chrome-131', F: 'firefox-133', S: 'safari-18.2', E: 'edge-131' },
  SWF2: { C: 'chrome-151', E: 'edge-151', F: 'firefox-154', S: 'safari-26.6' },
} as const;
const ADAPTERS = { 1: http1Adapter, 2: http2Adapter } as const;

type Observation = { error?: string; hello?: any; h1?: any; h2?: any; frames?: any };
const certificate = generateSanCertificate();
const observations = new Map<string, Promise<Observation>>();
const observers: Array<{ close: () => Promise<void> }> = [];

/** One real request per (identity, adapter) against each observer; memoised so the six aspect rows share it. */
function observe(identity: string, adapter: 1 | 2): Promise<Observation> {
  const key = `${identity}#${adapter}`;
  if (!observations.has(key)) observations.set(key, (async () => {
    let stealth: RezoStealth;
    try { stealth = new RezoStealth(identity as never); resolveProfile(identity as never); } catch (error) { return { error: `identity cannot be resolved: ${(error as Error).message}` }; }
    const hello = await startClientHelloObserver(); observers.push(hello);
    const rezo = new Rezo({ stealth, rejectUnauthorized: false, retry: false, timeout: 6000 }, ADAPTERS[adapter]);
    await settle(rezo.get(hello.url));
    const observation: Observation = { hello: hello.hellos[0] ?? { error: 'no ClientHello captured' } };
    if (adapter === 1) {
      const h1 = await startH1Observer(certificate); observers.push(h1);
      const result = await settle(rezo.get(h1.url, { responseType: 'text' }));
      observation.h1 = h1.requests[0] ?? { error: `no H1 request observed: ${result.ok ? 'empty' : String((result.error as Error)?.message)}` };
    } else {
      const h2 = await startH2Observer(certificate); observers.push(h2);
      const frames = await startH2FrameObserver(certificate); observers.push(frames);
      const result = await settle(rezo.get(h2.url, { responseType: 'text' }));
      observation.h2 = h2.streams[0] ?? { error: `no H2 stream observed: ${result.ok ? 'empty' : String((result.error as Error)?.message)}` };
      await settle(rezo.get(frames.url));
      observation.frames = frames.sessions[0] ?? { error: 'no H2 frames observed' };
    }
    return observation;
  })());
  return observations.get(key)!;
}
const ready = (observation: Observation, part: 'hello' | 'h1' | 'h2' | 'frames') => {
  expect(observation.error, 'identity resolution').toBeUndefined();
  const value = observation[part];
  expect(value?.error, `${part} observation`).toBeUndefined();
  return value;
};

afterAll(async () => { for (const observer of observers) await observer.close(); });

for (const [registry, families] of Object.entries(IDENTITIES)) for (const [family, identity] of Object.entries(families)) for (const adapter of [1, 2] as const) {
  const oracle = oracleFor(identity);
  const id = (aspect: string) => `${registry}-${family}${adapter}${aspect}`;
  const alpnKey = adapter === 1 ? 'h1' : 'h2';

  // On Bun the TLS material cannot be shaped (BoringSSL ignores the node:tls options): the a/b rows assert the frozen
  // fixed Bun hello AND that the product records the boundary on the resolved profile, instead of the browser oracle.
  const bunHello = IS_BUN ? ORACLE_FILE.runtimes.bun.defaultHello[alpnKey] : null;
  const bunBoundary = () => { const resolved = resolveProfile(identity as never) as unknown as { tlsBoundary?: { runtime?: { name?: string; tlsShaping?: string } } }; expect(resolved.tlsBoundary?.runtime?.name).toBe('bun'); expect(resolved.tlsBoundary?.runtime?.tlsShaping).toBe('unavailable'); };
  it(`${id('a')} ${identity} HTTP/${adapter === 1 ? '1.1' : '2'}: ClientHello ciphers, sigalgs, versions and ALPN equal the oracle${IS_BUN ? ' (Bun: fixed BoringSSL hello + recorded runtime boundary)' : ''}`, async () => {
    const hello = ready(await observe(identity, adapter), 'hello');
    expect(hello.ciphers).toEqual(bunHello ? bunHello.ciphers : oracle.tls.ciphers);
    expect(hello.sigalgs).toEqual(bunHello ? bunHello.sigalgs : oracle.tls.sigalgs);
    expect(hello.supportedVersions).toEqual(oracle.tls.supportedVersions);
    expect(hello.alpn).toEqual(oracle.tls.alpn[alpnKey]);
    if (IS_BUN) bunBoundary();
  });
  it(`${id('b')} ${identity} HTTP/${adapter === 1 ? '1.1' : '2'}: supported groups and key-share groups equal the oracle${IS_BUN ? ' (Bun: fixed BoringSSL hello + recorded runtime boundary)' : ''}`, async () => {
    const hello = ready(await observe(identity, adapter), 'hello');
    expect(hello.supportedGroups).toEqual(bunHello ? bunHello.supportedGroups : oracle.tls.supportedGroups);
    expect(hello.keyShareGroups).toEqual(bunHello ? bunHello.keyShareGroups : oracle.tls.keyShareGroups);
    if (IS_BUN) bunBoundary();
  });
  if (adapter === 1) {
    it(`${id('c')} ${identity} HTTP/1.1: header order on the wire (and Chromium client hints) equals the oracle${IS_BUN ? ' (Bun: its HTTP client re-orders headers — the boundary must be recorded)' : ''}`, async () => {
      const request = ready(await observe(identity, adapter), 'h1');
      if (IS_BUN) {
        // Bun's node:http emits headers in its own (alphabetical) order; the product must declare that it cannot hold the browser order there.
        const resolved = resolveProfile(identity as never) as unknown as { tlsBoundary?: { notExpressible?: string[] } };
        expect(resolved.tlsBoundary?.notExpressible).toContain('h1HeaderOrder');
        expect([...request.headerNames].sort()).toEqual([...oracle.h1HeaderOrder].sort());
      } else expect(request.headerNames).toEqual(oracle.h1HeaderOrder);
      const secChUa = expectedSecChUa(identity, oracle);
      if (secChUa !== null) { expect(request.headers['sec-ch-ua']).toBe(secChUa); expect(request.headers['sec-ch-ua-mobile']).toBe(oracle.clientHints!['sec-ch-ua-mobile']); }
      expect(request.headers.accept).toBe(oracle.accept);
      expect(request.headers['accept-encoding']).toBe(oracle.acceptEncoding);
    });
  } else {
    it(`${id('c')} ${identity} HTTP/2: regular header order on the wire (and Chromium client hints) equals the oracle`, async () => {
      const stream = ready(await observe(identity, adapter), 'h2');
      expect(stream.headerNames.filter((name: string) => !name.startsWith(':'))).toEqual(oracle.h2.headerOrder);
      const secChUa = expectedSecChUa(identity, oracle);
      if (secChUa !== null) { expect(stream.headers['sec-ch-ua']).toBe(secChUa); expect(stream.headers['sec-ch-ua-mobile']).toBe(oracle.clientHints!['sec-ch-ua-mobile']); }
      expect(stream.headers.accept).toBe(oracle.accept);
      expect(stream.headers['accept-encoding']).toBe(oracle.acceptEncoding);
    });
    it(`${id('d')} ${identity} HTTP/2: pseudo-header order equals the oracle`, async () => {
      const stream = ready(await observe(identity, adapter), 'h2');
      expect(stream.headerNames.slice(0, 4)).toEqual(oracle.h2.pseudoOrder);
    });
    it(`${id('e')} ${identity} HTTP/2: SETTINGS id set, order and values equal the oracle (an order node:http2 cannot emit must be declared on tlsBoundary)`, async () => {
      const frames = ready(await observe(identity, adapter), 'frames');
      expect(frames.prefaceOk).toBe(true);
      const observed = frames.settings.map((s: { id: number; value: number }) => [s.id, s.value] as [number, number]);
      const byId = (pairs: [number, number][]) => [...pairs].sort((a, b) => a[0] - b[0]);
      expect(byId(observed)).toEqual(byId(oracle.h2.settings));
      const oracleAscending = oracle.h2.settings.every((pair, index) => index === 0 || oracle.h2.settings[index - 1][0] < pair[0]);
      if (oracleAscending) expect(observed).toEqual(oracle.h2.settings);
      else {
        // node:http2 always emits SETTINGS in ascending id order: the browser's order is a declared boundary, never a silent mismatch.
        const resolved = resolveProfile(identity as never) as unknown as { tlsBoundary?: { notExpressible?: string[] } };
        expect(resolved.tlsBoundary?.notExpressible).toContain('h2SettingsOrder');
      }
    });
    it(`${id('f')} ${identity} HTTP/2: connection WINDOW_UPDATE increment equals the oracle and precedes HEADERS`, async () => {
      const frames = ready(await observe(identity, adapter), 'frames');
      expect(frames.windowUpdate).toBe(oracle.h2.windowUpdate);
      expect(frames.windowUpdateBeforeHeaders).toBe(true);
    });
  }
}

it('SWF-grease the Chromium grease-brand rule reproduces every known real capture (120, 124, 128, 131, 146)', () => {
  expect(validateKnownObservations()).toEqual([]);
});

it('SWF-fallback a runtime that rejects X25519MLKEM768 falls back to the frozen group list and records tlsBoundary.hybridGroup = "unsupported"', () => {
  const original = tls.createSecureContext;
  const rejecting = (options?: tls.SecureContextOptions) => {
    if (typeof options?.ecdhCurve === 'string' && options.ecdhCurve.includes('X25519MLKEM768')) { const error = new Error('unsupported group X25519MLKEM768') as NodeJS.ErrnoException; error.code = 'ERR_OSSL_EVP_UNSUPPORTED'; throw error; }
    return original(options);
  };
  (tls as { createSecureContext: typeof tls.createSecureContext }).createSecureContext = rejecting as typeof tls.createSecureContext;
  try {
    const resolved = resolveProfile('chrome-131' as never) as unknown as { tls: { ecdhCurve: string }; tlsBoundary?: { hybridGroup?: string; groups?: string[] } };
    expect(resolved.tlsBoundary?.hybridGroup).toBe('unsupported');
    expect(resolved.tlsBoundary?.groups).toEqual(['X25519', 'prime256v1', 'secp384r1']);
    // The configured group string may carry OpenSSL key-share marks (`*`); the group list itself is what the wire shows.
    expect(resolved.tls.ecdhCurve.replace(/\*/gu, '')).toBe('X25519:prime256v1:secp384r1');
  } finally {
    (tls as { createSecureContext: typeof tls.createSecureContext }).createSecureContext = original;
  }
});
