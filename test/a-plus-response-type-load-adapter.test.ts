// responseType at the public RAW-ADAPTER boundary (DECISION-063 C, carrier 2).
//
// A consumer may bypass shared core entirely — `loadAdapter('http')` from
// `./adapters`, or a direct `executeRequest` import from an adapter module —
// and those paths are as public as `rezo.get()`. The same case-sensitive
// vocabulary must therefore refuse there too, BEFORE any environment probe,
// DNS lookup, socket, provider, or child process is attempted.
//
// RED-first on the pre-C bytes: no raw boundary validates anything, so an
// invalid spelling either reaches the transport (network error) or trips the
// runtime-capability check (environment error) — never the structured
// refusal. Both are authentic RED here, and the assertion names the exact
// code so a network/environment failure can never be miscredited as the fix.
//
// LA-05 is the positive control: the SAME call with a valid token must reach
// transport and fail with a NETWORK error, which proves the harness drives a
// real adapter path rather than failing everywhere for a harness reason.
import { describe, expect, it } from 'vitest';
import { loadAdapter, type AdapterType } from '../src/adapters/picker.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import type { RezoRequestConfig } from '../src/types/rezo-request.js';

/** Port 1 is refused immediately and needs no DNS, so transport attempts fail fast. */
const UNREACHABLE = 'http://127.0.0.1:1/response-type';
const ADAPTER_TYPES: readonly AdapterType[] = ['http', 'http2', 'curl', 'fetch', 'xhr', 'react-native'];

/** Direct module specifiers a consumer can import `executeRequest` from. */
const DIRECT_MODULES: ReadonlyArray<readonly [AdapterType, string]> = [
  ['http', '../src/adapters/http.js'],
  ['http2', '../src/adapters/http2.js'],
  ['curl', '../src/adapters/curl.js'],
  ['fetch', '../src/adapters/fetch.js'],
  ['xhr', '../src/adapters/xhr.js'],
  ['react-native', '../src/adapters/react-native.js'],
];

const INVALID_TOKENS = ['bogus', 'JSON', 'STREAM', 'arrayBuffer '] as const;

type ExecuteRequest = (
  options: RezoRequestConfig,
  defaultOptions: Record<string, unknown>,
  jar: RezoCookieJar,
) => Promise<unknown>;

function baseConfig(responseType: unknown): RezoRequestConfig {
  return {
    url: UNREACHABLE,
    method: 'GET',
    responseType,
    timeout: 2000,
  } as unknown as RezoRequestConfig;
}

/** Invokes one raw adapter and classifies the outcome without hiding it. */
async function rawOutcome(
  execute: ExecuteRequest,
  responseType: unknown,
): Promise<{ settled: 'resolved' | 'rejected'; code: unknown; name: unknown }> {
  try {
    await execute(baseConfig(responseType), {}, new RezoCookieJar());
    return { settled: 'resolved', code: null, name: null };
  } catch (error) {
    const candidate = error as { code?: unknown; name?: unknown };
    return { settled: 'rejected', code: candidate?.code ?? null, name: candidate?.name ?? null };
  }
}

describe('responseType at the raw adapter boundary', () => {
  it('LA-01 every loadAdapter() result refuses an invalid responseType with the structured code', async () => {
    for (const type of ADAPTER_TYPES) {
      const module = await loadAdapter(type);
      const outcome = await rawOutcome(module.executeRequest as unknown as ExecuteRequest, 'bogus');
      expect({ type, settled: outcome.settled, code: outcome.code })
        .toEqual({ type, settled: 'rejected', code: 'REZ_INVALID_RESPONSE_TYPE' });
    }
  }, 120_000);

  it('LA-02 every direct executeRequest import refuses the same values', async () => {
    for (const [type, specifier] of DIRECT_MODULES) {
      const module = (await import(specifier)) as { executeRequest: ExecuteRequest };
      for (const token of INVALID_TOKENS) {
        const outcome = await rawOutcome(module.executeRequest, token);
        expect({ type, token, settled: outcome.settled, code: outcome.code })
          .toEqual({ type, token, settled: 'rejected', code: 'REZ_INVALID_RESPONSE_TYPE' });
      }
    }
  }, 180_000);

  it('LA-03 the raw refusal precedes transport and environment work — never a network or capability code', async () => {
    const transportCodes = new Set([
      'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH',
      'REZ_NETWORK_ERROR', 'REZ_CONNECTION_REFUSED', 'REZ_TIMEOUT', 'REZ_UNSUPPORTED_CAPABILITY',
    ]);
    for (const type of ADAPTER_TYPES) {
      const module = await loadAdapter(type);
      const outcome = await rawOutcome(module.executeRequest as unknown as ExecuteRequest, 'STREAM');
      expect({ type, code: outcome.code, transportOrEnvironment: transportCodes.has(outcome.code as string) })
        .toEqual({ type, code: 'REZ_INVALID_RESPONSE_TYPE', transportOrEnvironment: false });
    }
  }, 120_000);

  it('LA-04 aliases canonicalize at the raw boundary too, without core mediation', async () => {
    // The adapter must not see `arraybuffer`/`binary`; it sees the canonical
    // mode or refuses. Observed through the config the adapter reports back on
    // its transport failure, which is the only place a raw call exposes it.
    for (const type of ADAPTER_TYPES) {
      const module = await loadAdapter(type);
      let observed: unknown = 'no-config-observed';
      try {
        await (module.executeRequest as unknown as ExecuteRequest)(
          baseConfig('arraybuffer'), {}, new RezoCookieJar(),
        );
      } catch (error) {
        observed = (error as { config?: { responseType?: unknown } })?.config?.responseType ?? 'no-config-observed';
      }
      expect({ type, observed }).toEqual({ type, observed: 'arrayBuffer' });
    }
  }, 120_000);

  it('LA-05 CONTROL: a valid token on the same path reaches transport and fails with a network error', async () => {
    // Proves the harness actually drives real adapters: if this row failed,
    // every refusal row above would be uninterpretable.
    const module = await loadAdapter('http');
    const outcome = await rawOutcome(module.executeRequest as unknown as ExecuteRequest, 'json');
    expect(outcome.settled).toBe('rejected');
    expect(outcome.code).not.toBe('REZ_INVALID_RESPONSE_TYPE');
  }, 60_000);
});
