// responseType contract (DECISION-063 C, carrier 1) — the shared-core intake
// vocabulary. One exact, case-sensitive token set at every public execution
// boundary: 11 accepted request inputs, 8 buffered-only instance-default
// inputs, and 9 canonical effective modes that aliases never survive.
//
// RED-first on the pre-C bytes: intake performs zero validation, so unknown
// and miscased spellings flow to dispatch (RT-01..RT-04), aliases reach the
// adapter unnormalized (RT-06), five adapters ignore a valid instance default
// (RT-07), facade tokens are accepted as instance defaults (RT-08), and the
// structured refusal does not exist at all (RT-09/RT-10). RT-05 is the
// positive control: every valid token must still dispatch, so a harness
// failure can never be mistaken for a defect.
//
// Every refusal row also asserts ZERO dispatch: the injected tripwire adapter
// counts calls, so an "invalid value refused" claim is only credited when no
// wire work was attempted.
import { describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import type { AdapterFunction } from '../src/core/rezo.js';
import type { RezoRequestConfig } from '../src/types/rezo-request.js';
import { ERROR_INFO, RezoErrorCode } from '../src/errors/rezo-error.js';

const URL_UNDER_TEST = 'https://example.invalid/response-type';

/** The 11 case-sensitive tokens a request/callable/named option accepts. */
const ACCEPTED_REQUEST_TOKENS = [
  'auto', 'json', 'text', 'blob', 'arrayBuffer', 'arraybuffer',
  'buffer', 'binary', 'stream', 'download', 'upload',
] as const;

/** The 8 buffered inputs a `RezoDefaultOptions.responseType` accepts. */
const ACCEPTED_DEFAULT_TOKENS = [
  'auto', 'json', 'text', 'blob', 'arrayBuffer', 'arraybuffer', 'buffer', 'binary',
] as const;

/** The 3 facade tokens: legal per request, never legal as an instance default. */
const FACADE_TOKENS = ['stream', 'download', 'upload'] as const;

/** Alias → canonical effective mode. Aliases must not survive intake. */
const ALIAS_CANONICALIZATION: ReadonlyArray<readonly [string, string]> = [
  ['arraybuffer', 'arrayBuffer'],
  ['binary', 'buffer'],
];

/** Spellings that must refuse: unknown, miscased, and empty/whitespace. */
const REFUSED_STRINGS = [
  'bogus', 'JSON', 'Json', 'TEXT', 'STREAM', 'Stream', 'ArrayBuffer',
  'BUFFER', 'Binary', 'DOWNLOAD', 'Upload', 'AUTO', '', '   ', 'json ',
  ' json', 'json\n',
] as const;

interface Tripwire {
  readonly adapter: AdapterFunction;
  calls: number;
  observed: RezoRequestConfig[];
}

/**
 * An adapter that records every dispatch. Valid tokens must reach it (so the
 * positive control can pass); invalid tokens must never reach it.
 */
function createTripwire(): Tripwire {
  const tripwire: Tripwire = {
    calls: 0,
    observed: [],
    adapter: (async (options: RezoRequestConfig) => {
      tripwire.calls += 1;
      tripwire.observed.push(options);
      return {
        data: null,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: options,
      } as never;
    }) as AdapterFunction,
  };
  return tripwire;
}

/** Runs one request and returns the rejection reason, or `null` when it resolved. */
async function refusalOf(
  responseType: unknown,
  { defaults = {} as Record<string, unknown> } = {},
): Promise<{ error: unknown; calls: number }> {
  const tripwire = createTripwire();
  const client = new Rezo(defaults as never, tripwire.adapter);
  try {
    await (client.request as (config: unknown) => Promise<unknown>)({
      url: URL_UNDER_TEST,
      method: 'GET',
      responseType,
    });
    return { error: null, calls: tripwire.calls };
  } catch (error) {
    return { error, calls: tripwire.calls };
  }
}

/** Every string surface a structured error can leak a raw value through. */
function serializedSurfaces(error: unknown): string[] {
  const surfaces: string[] = [];
  const candidate = error as Record<string, unknown> & {
    toJSON?: () => unknown;
    getFullDetails?: () => unknown;
  };
  for (const key of ['message', 'details', 'suggestion', 'stack', 'code']) {
    const value = candidate?.[key];
    if (typeof value === 'string') surfaces.push(value);
  }
  surfaces.push(String(error));
  if (typeof candidate?.toJSON === 'function') surfaces.push(JSON.stringify(candidate.toJSON()));
  if (typeof candidate?.getFullDetails === 'function') surfaces.push(JSON.stringify(candidate.getFullDetails()));
  try { surfaces.push(JSON.stringify(error)); } catch { /* cyclic errors are still covered above */ }
  return surfaces.filter((surface) => typeof surface === 'string');
}

describe('responseType contract', () => {
  it('RT-01 an unknown responseType refuses with the structured code and never dispatches', async () => {
    const { error, calls } = await refusalOf('bogus');
    expect(calls).toBe(0);
    expect((error as { code?: string })?.code).toBe('REZ_INVALID_RESPONSE_TYPE');
  });

  it('RT-02 a miscased buffered spelling refuses instead of silently degrading to text', async () => {
    for (const spelling of ['JSON', 'Json', 'TEXT', 'ArrayBuffer', 'BUFFER']) {
      const { error, calls } = await refusalOf(spelling);
      expect({ spelling, calls, code: (error as { code?: string })?.code })
        .toEqual({ spelling, calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    }
  });

  it('RT-03 a miscased facade spelling refuses (the STREAM reproducer never reaches an adapter)', async () => {
    for (const spelling of ['STREAM', 'Stream', 'DOWNLOAD', 'Upload']) {
      const { error, calls } = await refusalOf(spelling);
      expect({ spelling, calls, code: (error as { code?: string })?.code })
        .toEqual({ spelling, calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    }
  });

  it('RT-04 every refused spelling, non-string, and hostile coercion value refuses without coercion', async () => {
    for (const spelling of REFUSED_STRINGS) {
      const { error, calls } = await refusalOf(spelling);
      expect({ spelling, calls, code: (error as { code?: string })?.code })
        .toEqual({ spelling, calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    }

    for (const value of [null, 5, 0, true, [], ['json'], {}, Symbol('json'), () => 'json']) {
      const { error, calls } = await refusalOf(value);
      expect({ kind: typeof value, calls, code: (error as { code?: string })?.code })
        .toEqual({ kind: typeof value, calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    }

    // Intake must never invoke user-controlled coercion to reach a verdict.
    let coercionAttempts = 0;
    const hostile = {
      toString(): string { coercionAttempts += 1; return 'json'; },
      valueOf(): string { coercionAttempts += 1; return 'json'; },
    };
    const { error, calls } = await refusalOf(hostile);
    expect({ calls, coercionAttempts, code: (error as { code?: string })?.code })
      .toEqual({ calls: 0, coercionAttempts: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
  });

  it('RT-05 CONTROL: every one of the 11 accepted request tokens still dispatches', async () => {
    for (const token of ACCEPTED_REQUEST_TOKENS) {
      const tripwire = createTripwire();
      const client = new Rezo({}, tripwire.adapter);
      await (client.request as (config: unknown) => Promise<unknown>)({
        url: URL_UNDER_TEST,
        method: 'GET',
        responseType: token,
      });
      expect({ token, calls: tripwire.calls }).toEqual({ token, calls: 1 });
    }
  });

  it('RT-06 aliases canonicalize at intake and never survive into the dispatched config', async () => {
    for (const [alias, canonical] of ALIAS_CANONICALIZATION) {
      const tripwire = createTripwire();
      const client = new Rezo({}, tripwire.adapter);
      await (client.request as (config: unknown) => Promise<unknown>)({
        url: URL_UNDER_TEST,
        method: 'GET',
        responseType: alias,
      });
      const observed = tripwire.observed[0] as { responseType?: unknown };
      expect({ alias, observed: observed?.responseType }).toEqual({ alias, observed: canonical });
    }
  });

  it('RT-07 a buffered instance default applies when the request omits responseType', async () => {
    for (const token of ACCEPTED_DEFAULT_TOKENS) {
      const tripwire = createTripwire();
      const client = new Rezo({ responseType: token } as never, tripwire.adapter);
      await (client.request as (config: unknown) => Promise<unknown>)({
        url: URL_UNDER_TEST,
        method: 'GET',
      });
      const observed = tripwire.observed[0] as { responseType?: unknown };
      const expected = token === 'arraybuffer' ? 'arrayBuffer' : token === 'binary' ? 'buffer' : token;
      expect({ token, observed: observed?.responseType }).toEqual({ token, observed: expected });
    }
  });

  it('RT-08 a facade token is refused as an instance default (a targetless default download is ill-formed)', async () => {
    for (const token of FACADE_TOKENS) {
      const { error, calls } = await refusalOf(undefined, { defaults: { responseType: token } });
      expect({ token, calls, code: (error as { code?: string })?.code })
        .toEqual({ token, calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    }
  });

  it('RT-09 the refusal never echoes the received value on any serialized surface', async () => {
    // Fail closed: a row that only checks "the canary is absent" passes
    // vacuously while no refusal exists at all. Each case must first prove a
    // real structured refusal happened, and only then scan its surfaces.
    const canary = 'SECRET-CANARY-8f3a1c';
    const { error, calls } = await refusalOf(canary);
    expect({ calls, code: (error as { code?: string })?.code })
      .toEqual({ calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    const surfaces = serializedSurfaces(error);
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
      expect(surface.includes(canary)).toBe(false);
    }

    const hostileCanary = { marker: 'SECRET-OBJECT-CANARY-2b91de' };
    const { error: objectError, calls: objectCalls } = await refusalOf(hostileCanary);
    expect({ calls: objectCalls, code: (objectError as { code?: string })?.code })
      .toEqual({ calls: 0, code: 'REZ_INVALID_RESPONSE_TYPE' });
    const objectSurfaces = serializedSurfaces(objectError);
    expect(objectSurfaces.length).toBeGreaterThan(0);
    for (const surface of objectSurfaces) {
      expect(surface.includes(hostileCanary.marker)).toBe(false);
    }
  });

  it('RT-10 the registry carries both new codes with exact metadata and moves 64 → 66', async () => {
    const registryKeys = Object.keys(ERROR_INFO);
    const enumMembers = Object.keys(RezoErrorCode).filter((key) => Number.isNaN(Number(key)));
    expect(registryKeys).toHaveLength(66);
    expect(enumMembers).toHaveLength(66);

    expect(ERROR_INFO.REZ_INVALID_RESPONSE_TYPE).toEqual({
      code: -1077,
      message: 'Invalid Response Type',
      details: "The responseType option is not one of Rezo's supported case-sensitive response modes.",
      suggestion: 'Use exactly one of: auto, json, text, blob, arrayBuffer, arraybuffer, buffer, binary, stream, download, or upload.',
    });

    expect(ERROR_INFO.REZ_CACHE_PERSISTENCE_UNAVAILABLE).toEqual({
      code: -1078,
      message: 'Cache Persistence Unavailable',
      details: 'The persistent response-cache directory could not be exclusively acquired, so disk persistence is disabled fail-closed for this instance while the in-memory tier remains correct.',
      suggestion: 'Stop the competing process using this cacheDir, clean a stale lease left by a crashed process, or configure a cacheDir this process can own exclusively.',
    });

    // Both errnos must be unique in the registry: a collision refuses rather
    // than silently renumbering an already-published code.
    const numericCodes = registryKeys.map((key) => (ERROR_INFO as Record<string, { code: number }>)[key].code);
    expect(numericCodes.filter((code) => code === -1077)).toHaveLength(1);
    expect(numericCodes.filter((code) => code === -1078)).toHaveLength(1);
  });
});
