import tls from 'node:tls';
import { afterEach, expect, it, vi } from 'vitest';
import { buildTlsOptions, createSecureContext, getProfile, listProfiles, resolveProfile } from '../src/stealth/index';
import type { TlsFingerprint } from '../src/stealth/profiles/types';
import type { BrowserProfileName } from '../src/stealth/types';

const nativeCreateContext = tls.createSecureContext;
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
afterEach(() => vi.restoreAllMocks());

// A controlled provider rejects specific options at BOTH probing and final construction.
// The all-profile tests below independently exercise the real provider without this stub.
function provider(reject: (options: tls.SecureContextOptions) => boolean) {
  const context = nativeCreateContext();
  const cause = Object.assign(new Error('TLS provider rejected the options'), { code: 'ERR_CRYPTO_OPERATION_FAILED' });
  const calls = vi.spyOn(tls, 'createSecureContext').mockImplementation((options = {}) => {
    if (reject(options)) throw cause;
    return context;
  });
  return { calls, context, cause };
}

it('preserves plain accepted groups through final construction, including a supported hybrid', () => {
  const { calls, context } = provider(options => String(options.ecdhCurve).includes('*'));
  const resolved = resolveProfile('chrome-131');
  expect(resolved.tls.ecdhCurve).toBe('X25519MLKEM768:X25519:prime256v1:secp384r1');
  expect(resolved.tlsBoundary.hybridGroup).toBe(IS_BUN ? 'unsupported' : 'supported');
  expect(resolved.tlsBoundary.notExpressible).toContain(IS_BUN ? 'groups' : 'keyShareGroups');
  calls.mockClear();
  expect(createSecureContext(resolved.tls)).toBe(context);
  expect(calls).toHaveBeenCalledTimes(1);
  expect(calls.mock.calls[0][0]?.ecdhCurve).toBe(resolved.tls.ecdhCurve);
});

it('constructs Firefox after independently rejecting markers, generated security directives and FFDHE groups', () => {
  const { calls, context } = provider(options => String(options.ecdhCurve).includes('*') || String(options.ecdhCurve).includes('ffdhe') || String(options.ciphers).includes('@'));
  const resolved = resolveProfile('firefox-133');
  expect(resolved.tls.ecdhCurve).toBe('X25519MLKEM768:X25519:prime256v1:secp384r1:secp521r1');
  expect(resolved.tls.ciphers).not.toContain('@');
  expect(resolved.tlsBoundary.notExpressible).toContain('groups');
  calls.mockClear();
  expect(buildTlsOptions(resolved.tls).secureContext).toBe(context);
  expect(calls).toHaveBeenCalledTimes(1);
  expect(calls.mock.calls[0][0]?.ciphers).toBe(resolved.tls.ciphers);
});

it('removes only the rejected hybrid and keeps supported groups in order', () => {
  const { context } = provider(options => String(options.ecdhCurve).includes('X25519Kyber768Draft00'));
  const resolved = resolveProfile('chrome-124');
  expect(resolved.tls.ecdhCurve.replace(/\*/gu, '')).toBe('X25519:prime256v1:secp384r1');
  expect(resolved.tlsBoundary.hybridGroup).toBe('unsupported');
  expect(createSecureContext(resolved.tls)).toBe(context);
});

it('keeps accepted OpenSSL markers and records the cipher directive actually used', () => {
  const { calls } = provider(() => false);
  const resolved = resolveProfile('firefox-133');
  expect(resolved.tls.ecdhCurve).toContain('*X25519');
  expect(resolved.tls.ciphers).toMatch(/:@SECLEVEL=0$/u);
  calls.mockClear();
  createSecureContext(resolved.tls);
  expect(calls.mock.calls[0][0]?.ciphers).toBe(resolved.tls.ciphers);
});

it('never overrides or strips a caller security-level directive to make it pass', () => {
  const { cause } = provider(options => String(options.ciphers).includes('@SECLEVEL=2'));
  const fingerprint = { ...getProfile('firefox-133')!.tls, ciphers: `${getProfile('firefox-133')!.tls.ciphers}:@SECLEVEL=2` };
  expect(() => createSecureContext(fingerprint)).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY', cause }));
});

it('does not silently discard an invalid custom group', () => {
  const { cause } = provider(options => String(options.ecdhCurve).includes('misspelled-group'));
  const fingerprint = { ...getProfile('chrome-120')!.tls, ecdhCurve: 'misspelled-group:X25519' };
  expect(() => createSecureContext(fingerprint)).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY', cause }));
});

it('does not reuse stale accepted material after the caller mutates a resolved fingerprint', () => {
  const { cause } = provider(options => options.ciphers === 'invalid-cipher');
  const resolved = resolveProfile('chrome-120');
  resolved.tls.ciphers = 'invalid-cipher';
  expect(() => createSecureContext(resolved.tls)).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY', cause }));
});

it('validates session timeout during probing and preserves native failure as the cause', () => {
  const { cause } = provider(options => options.sessionTimeout === -1);
  expect(() => resolveProfile({ profile: 'chrome-120', tls: { sessionTimeout: -1 } })).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY', cause }));
});

it('wraps a final-constructor failure even when the earlier capability probe succeeded', () => {
  const { calls, cause } = provider(() => false);
  const resolved = resolveProfile('chrome-120');
  calls.mockImplementation(() => { throw cause; });
  expect(() => createSecureContext(resolved.tls)).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY', cause }));
});

for (const id of listProfiles()) {
  it(`${id} constructs raw and resolved material on the actual TLS provider`, () => {
    const original = getProfile(id)!.tls;
    const snapshot = JSON.stringify(original);
    expect(createSecureContext(original as TlsFingerprint)).toBeDefined();
    const resolved = resolveProfile(id as BrowserProfileName);
    expect(createSecureContext(resolved.tls)).toBeDefined();
    const options = buildTlsOptions(resolved.tls);
    expect(options.secureContext).toBeDefined();
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ALPNProtocols).toEqual(original.alpnProtocols);
    expect(options.minVersion).toBe(original.minVersion);
    expect(options.maxVersion).toBe(original.maxVersion);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
}
