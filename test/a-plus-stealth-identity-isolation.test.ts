/**
 * SIS — stealth identity isolation carrier (PLAN/stealth-wire-fidelity v4, phase 1).
 *
 * An identity is only an identity if it owns its transport: two stealth profiles talking to one origin must
 * never share an HTTP/2 session (their TLS fingerprints differ while their headers rotate), equivalent
 * profiles may share, `rotate: true` never reuses across identities, and a resolved profile or the registry
 * must not be mutable by reference. Each row opens its own origin so the module-global session pool cannot
 * bleed between rows.
 */

import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoStealth, resolveProfile } from '../src/stealth/index';
import { getProfile, listActiveProfiles, PROFILE_REGISTRY } from '../src/stealth/profiles/index';
import type { BrowserProfile } from '../src/stealth/profiles/types';
import { generateSanCertificate, settle, startH2Observer } from './fixtures/stealth/wire-observer.mjs';

const certificate = generateSanCertificate();
const observers: Array<{ close: () => Promise<void> }> = [];
afterAll(async () => { for (const observer of observers) await observer.close(); });

const client = (stealth: RezoStealth) => new Rezo({ stealth, rejectUnauthorized: false, retry: false, timeout: 6000 }, http2Adapter);
const origin = async () => { const observer = await startH2Observer(certificate); observers.push(observer); return observer; };
const userAgents = (observer: Awaited<ReturnType<typeof startH2Observer>>) => observer.streams.map((stream) => stream.headers['user-agent'] as string);

it('SIS-01 two profiles against one origin use two HTTP/2 sessions (headers and TLS rotate together)', async () => {
  const observer = await origin();
  const chrome = client(new RezoStealth('chrome-131')); const firefox = client(new RezoStealth('firefox-133'));
  const first = await settle(chrome.get(observer.url, { responseType: 'text' }));
  const second = await settle(firefox.get(observer.url, { responseType: 'text' }));
  expect(first.ok && second.ok, `requests failed: ${String((first as { error?: Error }).error?.message ?? '')} ${String((second as { error?: Error }).error?.message ?? '')}`).toBe(true);
  expect(observer.streams).toHaveLength(2);
  const agents = userAgents(observer);
  expect(agents[0]).toContain('Chrome/131'); expect(agents[1]).toContain('Firefox/133');
  expect(observer.distinctSessions()).toBe(2);
});

it('SIS-02 the same profile against one origin reuses one HTTP/2 session (control)', async () => {
  const observer = await origin();
  const rezo = client(new RezoStealth('chrome-131'));
  await settle(rezo.get(observer.url, { responseType: 'text' })); await settle(rezo.get(observer.url, { responseType: 'text' }));
  expect(observer.streams).toHaveLength(2);
  expect(observer.distinctSessions()).toBe(1);
});

it('SIS-03 an equivalent custom profile shares the session; a profile with different transport material never does', async () => {
  const base = getProfile('chrome-131')!;
  const equivalent: BrowserProfile = { ...base, id: 'custom-equivalent', tls: { ...base.tls }, h2Settings: { ...base.h2Settings } };
  const differing: BrowserProfile = { ...base, id: 'custom-differing', tls: { ...base.tls, ciphers: base.tls.ciphers.split(':').reverse().join(':') } };
  const shared = await origin();
  await settle(client(new RezoStealth('chrome-131')).get(shared.url, { responseType: 'text' }));
  await settle(client(new RezoStealth(equivalent)).get(shared.url, { responseType: 'text' }));
  expect(shared.streams).toHaveLength(2);
  expect(shared.distinctSessions()).toBe(1);
  const isolated = await origin();
  await settle(client(new RezoStealth('chrome-131')).get(isolated.url, { responseType: 'text' }));
  await settle(client(new RezoStealth(differing)).get(isolated.url, { responseType: 'text' }));
  expect(isolated.streams).toHaveLength(2);
  expect(isolated.distinctSessions()).toBe(2);
});

it('SIS-04 rotate: true never reuses a session across identities, and only presents current (non-retired) identities', async () => {
  const observer = await origin();
  const rezo = client(new RezoStealth({ rotate: true }));
  for (let i = 0; i < 8; i += 1) await settle(rezo.get(observer.url, { responseType: 'text' }));
  expect(observer.streams).toHaveLength(8);
  const identities = new Set(userAgents(observer));
  expect(identities.size).toBeGreaterThan(1);
  expect(observer.distinctSessions()).toBe(8);
  // Q5: identities older than the family's current major − 2 never enter the rotate/family pools (ESR exempt).
  const active = listActiveProfiles();
  const activeAgents = new Set(active.flatMap((profile) => Object.values(profile.userAgents)));
  for (const agent of identities) expect(activeAgents.has(agent), `rotated to a retired identity: ${agent}`).toBe(true);
  expect(active.some((profile) => profile.id === 'chrome-120')).toBe(false);
  expect(active.some((profile) => profile.id === 'safari-18.2')).toBe(false);
  expect(active.some((profile) => profile.id === 'firefox-140-esr')).toBe(true);
  expect(active.some((profile) => profile.id === 'chrome-151')).toBe(true);
  // Opera and Brave retire against their own family's newest member, so a Chromium-131-era Opera/Brave leaves the pool once the 151-era one ships.
  expect(active.some((profile) => profile.id === 'opera-135')).toBe(true);
  expect(active.some((profile) => profile.id === 'brave-1.93')).toBe(true);
  expect(active.some((profile) => profile.id === 'opera-115')).toBe(false);
  expect(active.some((profile) => profile.id === 'brave-1.73')).toBe(false);
});

it('SIS-05 mutating a resolved profile never reaches the next resolution', () => {
  const first = resolveProfile('chrome-131');
  const originalCiphers = first.tls.ciphers; const originalOrder = [...first.headerOrder]; const originalSettings = { ...first.h2Settings };
  (first.tls as { ciphers: string }).ciphers = 'AES128-SHA';
  first.headerOrder.push('x-mutated');
  (first.h2Settings as { initialWindowSize: number }).initialWindowSize = 1;
  first.defaultHeaders['user-agent'] = 'mutated';
  const second = resolveProfile('chrome-131');
  expect(second.tls.ciphers).toBe(originalCiphers);
  expect(second.headerOrder).toEqual(originalOrder);
  expect(second.h2Settings).toEqual(originalSettings);
  expect(second.defaultHeaders['user-agent']).toContain('Chrome/131');
});

it('SIS-06 mutating the registry view never reaches the next resolution', () => {
  const before = resolveProfile('firefox-133');
  const originalCiphers = before.tls.ciphers; const originalOrder = [...before.headerOrder];
  const viaGet = getProfile('firefox-133') as BrowserProfile;
  const viaRegistry = PROFILE_REGISTRY.get('firefox-133') as BrowserProfile;
  const attempts: string[] = [];
  for (const [label, target] of [['getProfile', viaGet], ['PROFILE_REGISTRY.get', viaRegistry]] as const) {
    try { (target.tls as { ciphers: string }).ciphers = 'AES128-SHA'; target.headerOrder.push('x-mutated'); } catch (error) { attempts.push(`${label}: ${(error as Error).name}`); }
  }
  try { (PROFILE_REGISTRY as unknown as Map<string, BrowserProfile>).set('firefox-133', { ...viaGet, tls: { ...viaGet.tls, ciphers: 'AES256-SHA' } }); } catch (error) { attempts.push(`set: ${(error as Error).name}`); }
  try { (PROFILE_REGISTRY as unknown as Map<string, BrowserProfile>).delete('firefox-133'); } catch (error) { attempts.push(`delete: ${(error as Error).name}`); }
  const after = resolveProfile('firefox-133');
  expect(after.tls.ciphers).toBe(originalCiphers);
  expect(after.headerOrder).toEqual(originalOrder);
  expect(getProfile('firefox-133')).toBeDefined();
});
