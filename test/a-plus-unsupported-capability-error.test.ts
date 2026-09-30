import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RezoError as CanonicalRezoError,
  RezoErrorCode as CanonicalRezoErrorCode,
  ERROR_INFO,
  getCode,
  getErrorInfo,
  type RezoErrorCodeString,
} from '../src/errors/rezo-error';
import type { RezoConfig } from '../src/types/rezo-config';
import { RezoError as RootRezoError, RezoErrorCode as RootRezoErrorCode } from '../src/index';
import { RezoError as NodeRezoError, RezoErrorCode as NodeRezoErrorCode } from '../src/platform/node';
import { RezoError as BrowserRezoError, RezoErrorCode as BrowserRezoErrorCode } from '../src/platform/browser';
import { RezoError as BunRezoError, RezoErrorCode as BunRezoErrorCode } from '../src/platform/bun';
import { RezoError as DenoRezoError, RezoErrorCode as DenoRezoErrorCode } from '../src/platform/deno';
import { RezoError as WorkerRezoError, RezoErrorCode as WorkerRezoErrorCode } from '../src/platform/worker';
import { RezoError as ReactNativePlatformRezoError, RezoErrorCode as ReactNativePlatformRezoErrorCode } from '../src/platform/react-native';
import { RezoError as HttpRezoError, RezoErrorCode as HttpRezoErrorCode } from '../src/adapters/entries/http';
import { RezoError as Http2RezoError, RezoErrorCode as Http2RezoErrorCode } from '../src/adapters/entries/http2';
import { RezoError as CurlRezoError, RezoErrorCode as CurlRezoErrorCode } from '../src/adapters/entries/curl';
import { RezoError as FetchRezoError, RezoErrorCode as FetchRezoErrorCode } from '../src/adapters/entries/fetch';
import { RezoError as XhrRezoError, RezoErrorCode as XhrRezoErrorCode } from '../src/adapters/entries/xhr';
import { RezoError as ReactNativeAdapterRezoError, RezoErrorCode as ReactNativeAdapterRezoErrorCode } from '../src/adapters/entries/react-native';

const UNSUPPORTED_CODE = 'REZ_UNSUPPORTED_CAPABILITY';
// john 2026-09-01: re-pinned for DECISION-063 C — one governed recut adds REZ_INVALID_RESPONSE_TYPE (-1077) and
// REZ_CACHE_PERSISTENCE_UNAVAILABLE (-1078); registry 64 → 66. Previously: DEC-186 Q3 added REZ_STEALTH_PLATFORM_UNSUPPORTED (-1076; registry 63 → 64)
// and DEC-186 Q7 added the `react-native` / `browser` conditions inside exports["./stealth"] (no export path added, renamed or removed).
const EXPECTED_EXPORTS_HASH = 'c19dffbb3465b98a9e9e253ea847e3952dd9e97e2e671e5a9e63ee96d0781b38';
const EXPECTED_REGISTRY_KEYS_HASH = '1a131bd878ad0c8144186916c131d0efac6a360f09b7bb1402ec2ff7ec85fac9';
const EXPECTED_ENUM_ENTRIES_HASH = '562212ad7d597566681a8725fbd610d5aeaec9bf6bf503e8e76634dee5458216';
const EXPECTED_SORTED_CODE_HASH = 'f781e12cc6041c17d0ce5b191558fcca34e3d26b1288db37ed28c50928d0b152';
const EXPECTED_INFO = {
  code: -1075,
  message: 'Unsupported Capability',
  details: 'The selected adapter or runtime cannot provide a capability requested by this operation.',
  suggestion: 'Choose an adapter or runtime that supports the requested capability, or remove the unsupported requirement.',
} as const;

const errorClasses = [
  RootRezoError,
  NodeRezoError,
  BrowserRezoError,
  BunRezoError,
  DenoRezoError,
  WorkerRezoError,
  ReactNativePlatformRezoError,
  HttpRezoError,
  Http2RezoError,
  CurlRezoError,
  FetchRezoError,
  XhrRezoError,
  ReactNativeAdapterRezoError,
] as const;

const errorEnums = [
  RootRezoErrorCode,
  NodeRezoErrorCode,
  BrowserRezoErrorCode,
  BunRezoErrorCode,
  DenoRezoErrorCode,
  WorkerRezoErrorCode,
  ReactNativePlatformRezoErrorCode,
  HttpRezoErrorCode,
  Http2RezoErrorCode,
  CurlRezoErrorCode,
  FetchRezoErrorCode,
  XhrRezoErrorCode,
  ReactNativeAdapterRezoErrorCode,
] as const;

function unsupportedMember(errorCode: typeof CanonicalRezoErrorCode): string | undefined {
  return (errorCode as unknown as Record<string, string>).UNSUPPORTED_CAPABILITY;
}

describe('Phase 1c-a additive unsupported-capability error', () => {
  it('adds exactly one enum member without narrowing the open code-string type', () => {
    const typedCode: RezoErrorCodeString = UNSUPPORTED_CODE;
    const futureExtensionCode: RezoErrorCodeString = 'REZ_FUTURE_EXTENSION_SENTINEL';

    expect(typedCode).toBe(UNSUPPORTED_CODE);
    expect(futureExtensionCode).toBe('REZ_FUTURE_EXTENSION_SENTINEL');
    expect(unsupportedMember(CanonicalRezoErrorCode)).toBe(UNSUPPORTED_CODE);
  });

  it('pins exact post-addition registry and enum semantics', () => {
    const registryKeys = Object.keys(ERROR_INFO);
    const enumEntries = Object.entries(CanonicalRezoErrorCode);
    const enumValues = enumEntries.map(([, value]) => value).sort();
    const sortedRegistryKeys = [...registryKeys].sort();
    const hash = (value: unknown) => createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');

    expect(registryKeys).toHaveLength(66);
    expect(enumEntries).toHaveLength(66);
    expect(hash(registryKeys)).toBe(EXPECTED_REGISTRY_KEYS_HASH);
    expect(hash(enumEntries)).toBe(EXPECTED_ENUM_ENTRIES_HASH);
    expect(enumValues).toEqual(sortedRegistryKeys);
    expect(hash(enumValues)).toBe(EXPECTED_SORTED_CODE_HASH);
  });

  it('registers exact non-secret pre-dispatch metadata at unused errno -1075', () => {
    expect(ERROR_INFO[UNSUPPORTED_CODE]).toEqual(EXPECTED_INFO);
    expect(
      Object.entries(ERROR_INFO)
        .filter(([, value]) => value.code === -1075)
        .map(([name]) => name),
    ).toEqual([UNSUPPORTED_CODE]);
  });

  it('keeps registry lookup helpers in exact agreement', () => {
    expect(getCode(UNSUPPORTED_CODE)).toEqual({
      message: EXPECTED_INFO.message,
      details: EXPECTED_INFO.details,
      suggestion: EXPECTED_INFO.suggestion,
      errno: EXPECTED_INFO.code,
    });
    expect(getErrorInfo(UNSUPPORTED_CODE)).toEqual(getCode(UNSUPPORTED_CODE));
  });

  it('constructs a structured, non-retryable error while preserving fixed safe context', () => {
    const safeMessage = 'Browser Fetch cannot enforce redirect capability "beforeRedirect" before dispatch.';
    const error = new CanonicalRezoError(
      safeMessage,
      {} as RezoConfig,
      UNSUPPORTED_CODE as RezoErrorCodeString,
    );

    expect(error.code).toBe(UNSUPPORTED_CODE);
    expect(error.message).toBe(safeMessage);
    expect(error.errno).toBe(-1075);
    expect(error.suggestion).toBe(EXPECTED_INFO.suggestion);
    expect(Reflect.get(error, 'details')).toBe(EXPECTED_INFO.details);
    expect(error.isRetryable).toBe(false);
    expect(error.isTimeout).toBe(false);
    expect(error.isAborted).toBe(false);
    expect(error.isNetworkError).toBe(false);
    expect(error.isHttpError).toBe(false);
    expect(error.isProxyError).toBe(false);
    expect(error.isSocksError).toBe(false);
    expect(error.isTlsError).toBe(false);
    expect(error.toJSON()).toEqual({
      name: 'RezoError',
      message: safeMessage,
      code: UNSUPPORTED_CODE,
    });
  });

  it('keeps one RezoError class and enum object across every dedicated public entry', () => {
    for (const errorClass of errorClasses) expect(errorClass).toBe(CanonicalRezoError);
    for (const errorCode of errorEnums) expect(errorCode).toBe(CanonicalRezoErrorCode);
  });

  it('propagates the additive member through root, platform, and adapter entries', () => {
    for (const errorCode of errorEnums) {
      expect(unsupportedMember(errorCode)).toBe(UNSUPPORTED_CODE);
    }
  });

  it('does not alter package export paths or their condition order', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: unknown;
    };
    const exportsHash = createHash('sha256')
      .update(JSON.stringify(packageJson.exports))
      .digest('hex');

    expect(exportsHash).toBe(EXPECTED_EXPORTS_HASH);
  });
});
