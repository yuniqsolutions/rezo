/**
 * CSP — network-free cURL command/profile coherence regressions.
 *
 * These rows execute the exported command builder, not curl or a wire observer.
 * A valid upstream H2 mapping must not leave H2-derived header state behind when
 * the caller explicitly selects H1.1. A typed capability refusal is also safe:
 * the eventual source decision may reject a conflicting mapping instead of
 * rebuilding it. Silently ignoring the caller's protocol is not accepted.
 *
 * TLS acceptance-probe outcomes remain pending: mocking exit codes alone cannot
 * supply the independent accepted-ClientHello control that those rows need.
 * H3 negotiation, fallback and fingerprint fidelity are not claimed here.
 */

import { expect, it } from 'vitest';

import { CurlCommandBuilder } from '../src/adapters/curl';
import type { CurlStealthMapping } from '../src/adapters/curl-stealth';
import { RezoError } from '../src/errors/rezo-error';
import { resolveProfile } from '../src/stealth/resolver';
import type { ResolvedStealthProfile } from '../src/stealth/types';
import type { CurlHttpVersion, CurlRequestConfig } from '../src/types/curl-options';
import type { RezoConfig } from '../src/types/rezo-config';
import { RezoHeaders } from '../src/utils/headers';

type Protocol = '1.1' | '2';
type BuiltCommand = { args: string[]; headers: Record<string, string> };
const ORIGIN = 'https://csp.example.invalid/';

/** Real registry data, with no TLS factory import or runtime capability probe. */
function profileFor(protocol: Protocol): ResolvedStealthProfile {
  return resolveProfile({
    profile: 'firefox-128',
    platform: 'linux',
    tls: { alpnProtocols: protocol === '2' ? ['h2', 'http/1.1'] : ['http/1.1'] },
  });
}

/** A controlled input at the builder seam, not a claim that curl accepted TLS. */
function mappingFor(protocol: Protocol): CurlStealthMapping {
  return {
    tlsArgs: [],
    httpVersionArg: protocol === '2' ? '--http2' : '--http1.1',
    useHttp2Headers: protocol === '2',
    notExpressible: [],
  };
}

function build(
  profile: ResolvedStealthProfile,
  mappedProtocol: Protocol,
  requestedProtocol?: CurlHttpVersion,
  callerHeaders: Record<string, string> = {},
): BuiltCommand {
  // The builder needs an internal temp-manager type with private fields. This
  // narrow double returns a name only; no directory/file/process is created.
  const allocated: string[] = [];
  const tempFiles = {
    createTempFile(prefix = 'unexpected', extension = '.tmp'): string {
      expect(prefix).toBe('headers');
      const filename = `csp-inert-not-created/${prefix}${extension}`;
      allocated.push(filename);
      return filename;
    },
  } as unknown as ConstructorParameters<typeof CurlCommandBuilder>[0];
  const capabilities = {
    supportsHttp2: (): boolean => true,
  } as unknown as ConstructorParameters<typeof CurlCommandBuilder>[1];
  const headers = new RezoHeaders({
    ...profile.defaultHeaders,
    'x-csp-caller': 'preserved',
    ...callerHeaders,
  });
  const request: CurlRequestConfig & {
    _resolvedStealth: ResolvedStealthProfile;
    disableJar: boolean;
  } = {
    url: ORIGIN,
    fullUrl: ORIGIN,
    method: 'GET',
    headers,
    disableJar: true,
    followRedirects: false,
    _resolvedStealth: profile,
    ...(requestedProtocol === undefined ? {} : { curl: { httpVersion: requestedProtocol } }),
  };
  // Unused execution/timing fields are deliberately absent at this builder seam.
  const config = {
    url: ORIGIN, method: 'GET', headers, disableJar: true,
    http2: mappedProtocol === '2', curl: true, maxRedirects: 0,
    compression: { enabled: false },
  } as RezoConfig;
  const { args } = new CurlCommandBuilder(tempFiles, capabilities).build(
    config, request, new Map(), {}, mappingFor(mappedProtocol),
  );
  expect(allocated).toEqual(['csp-inert-not-created/headers.txt']);
  const emittedHeaders: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '-H') continue;
    const header = args[index + 1]!;
    const separator = header.indexOf(':');
    expect(separator).toBeGreaterThan(0);
    emittedHeaders[header.slice(0, separator).toLowerCase()] = header.slice(separator + 1).trimStart();
  }
  expect(emittedHeaders['x-csp-caller']).toBe('preserved');
  expect(emittedHeaders['user-agent']).toBe(profile.defaultHeaders['user-agent']);
  return { args, headers: emittedHeaders };
}

function expectProtocol(command: BuiltCommand, protocol: Protocol): void {
  const flags = command.args.filter((arg) => /^--http(?:1|2|3)/u.test(arg));
  expect(flags).toEqual([protocol === '2' ? '--http2' : '--http1.1']);
}

/** Only the product's typed refusal is an allowed alternative, never a raw throw. */
function buildExplicitH1(profile: ResolvedStealthProfile): BuiltCommand | undefined {
  try {
    return build(profile, '2', '1.1');
  } catch (error) {
    expect(error).toBeInstanceOf(RezoError);
    expect((error as RezoError).code).toBe('REZ_UNSUPPORTED_CAPABILITY');
    return undefined;
  }
}

it('CSP-01 compatible H1.1 retains H1 profile extras and connection semantics', () => {
  const profile = profileFor('1.1');
  expect(profile.extraHeaders.h1?.priority).toBe('u=0, i');
  expect(profile.extraHeaders.h1?.te).toBeUndefined();
  const command = build(profile, '1.1', '1.1');
  expectProtocol(command, '1.1');
  expect(command.headers.priority).toBe('u=0, i');
  expect(command.headers.te).toBeUndefined();
  expect(command.headers.connection).toBe('keep-alive');
});

it('CSP-02 compatible H2 retains its protocol extras without an H1 connection header', () => {
  const command = build(profileFor('2'), '2', '2');
  expectProtocol(command, '2');
  expect(command.headers.te).toBe('trailers');
  expect(command.headers.priority).toBe('u=0, i');
  expect(command.headers.connection).toBeUndefined();
});

it('CSP-03 no explicit protocol preserves the mapped H2 command', () => {
  const command = build(profileFor('2'), '2');
  expectProtocol(command, '2');
  expect(command.headers.te).toBe('trailers');
});

it('CSP-04 explicit H1.1 cannot retain automatically added H2-only profile headers', () => {
  const profile = profileFor('2');
  expect(profile.defaultHeaders.te).toBeUndefined();
  expect(profile.extraHeaders.h1?.te).toBeUndefined();
  expect(profile.extraHeaders.h2?.te).toBe('trailers');
  const command = buildExplicitH1(profile);
  if (!command) return;
  expectProtocol(command, '1.1');
  expect(command.headers.te).toBeUndefined();
});

it('CSP-05 explicit H1.1 restores its own profile-derived state, not just its version flag', () => {
  const profile = profileFor('2');
  profile.extraHeaders = { h1: { 'x-csp-profile-h1': 'present' }, h2: { 'x-csp-profile-h2': 'present' } };
  const command = buildExplicitH1(profile);
  if (!command) return;
  expectProtocol(command, '1.1');
  expect(command.headers['x-csp-profile-h1']).toBe('present');
  expect(command.headers['x-csp-profile-h2']).toBeUndefined();
  expect(command.headers.connection).toBe('keep-alive');
});

it('CSP-06 caller-owned headers remain caller-owned on a compatible H1.1 command', () => {
  const command = build(profileFor('1.1'), '1.1', '1.1', { te: 'trailers', priority: 'u=7' });
  expectProtocol(command, '1.1');
  expect(command.headers.te).toBe('trailers');
  expect(command.headers.priority).toBe('u=7');
});
