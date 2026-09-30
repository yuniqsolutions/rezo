// Orphan and cached 304 contract (DECISION-063 C, carrier 5 —
// DECISION-066 A and DECISION-067 A).
//
// A 304 may become a cached success ONLY when this request had a real
// matching cached entry and issued the conditional revalidation itself. An
// orphan 304 — no cached entry — is an ordinary HTTP error:
//
//   exactly one `REZ_HTTP_ERROR` / `-1031`, the typed 304 response retained,
//   exactly one wire call, no hidden refetch, exactly one terminal outcome.
//
// React Native currently converts a 304 to success whenever `options.cache`
// is merely truthy, without an actual `cachedEntry`. For a facade-mode
// request that produces a NONTERMINAL facade: the caller receives an object
// that never finishes. The uppercase `STREAM` spelling was only the trigger
// that let a facade reach that path; the conversion itself is the defect, so
// these rows drive it with correctly-cased values.
//
// RED-first. OR-CONTROL-A and OR-CONTROL-B must pass on today's bytes: a
// plain 200 succeeds and the server observes exactly the expected number of
// wire calls, so a failure elsewhere is never a broken harness.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import type { RezoRequestConfig } from '../src/types/rezo-request.js';

interface WireLog { calls: number; paths: string[] }

let server: Server;
let origin: string;
const wire: WireLog = { calls: 0, paths: [] };

beforeAll(async () => {
  server = createServer((request, response) => {
    wire.calls += 1;
    wire.paths.push(request.url ?? '');
    if ((request.url ?? '').startsWith('/ok')) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=300' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    // Every other path answers 304 unconditionally — an orphan revalidation
    // response for a client that holds no cached entry.
    response.writeHead(304, { etag: '"v1"' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function resetWire(): void {
  wire.calls = 0;
  wire.paths.length = 0;
}

type ExecuteRequest = (
  options: RezoRequestConfig,
  defaultOptions: Record<string, unknown>,
  jar: RezoCookieJar,
) => Promise<unknown>;

/** The six adapter modules; each is exercised through its public export. */
const ADAPTERS: ReadonlyArray<readonly [string, string]> = [
  ['http', '../src/adapters/http.js'],
  ['fetch', '../src/adapters/fetch.js'],
  ['curl', '../src/adapters/curl.js'],
  ['react-native', '../src/adapters/react-native.js'],
];

interface Outcome {
  settled: 'resolved' | 'rejected';
  code: unknown;
  status: unknown;
  wireCalls: number;
}

async function orphan304(specifier: string, extra: Record<string, unknown> = {}): Promise<Outcome> {
  const module = (await import(specifier)) as { executeRequest: ExecuteRequest };
  resetWire();
  const config = {
    url: `${origin}/orphan`,
    method: 'GET',
    cache: true,
    timeout: 5000,
    ...extra,
  } as unknown as RezoRequestConfig;
  try {
    const response = await module.executeRequest(config, {}, new RezoCookieJar());
    return {
      settled: 'resolved',
      code: null,
      status: (response as { status?: unknown })?.status ?? null,
      wireCalls: wire.calls,
    };
  } catch (error) {
    const candidate = error as { code?: unknown; response?: { status?: unknown } };
    return {
      settled: 'rejected',
      code: candidate?.code ?? null,
      status: candidate?.response?.status ?? null,
      wireCalls: wire.calls,
    };
  }
}

describe('orphan and cached 304 contract', () => {
  it('OR-CONTROL-A a plain 200 succeeds with exactly one wire call', async () => {
    const module = (await import('../src/adapters/http.js')) as { executeRequest: ExecuteRequest };
    resetWire();
    const response = await module.executeRequest(
      { url: `${origin}/ok`, method: 'GET', timeout: 5000 } as unknown as RezoRequestConfig,
      {}, new RezoCookieJar(),
    );
    expect({ status: (response as { status?: number }).status, wireCalls: wire.calls })
      .toEqual({ status: 200, wireCalls: 1 });
  }, 30_000);

  it('OR-01 an orphan 304 is one REZ_HTTP_ERROR/-1031 with the typed 304 response and one wire call', async () => {
    for (const [name, specifier] of ADAPTERS) {
      const outcome = await orphan304(specifier);
      expect({ adapter: name, ...outcome })
        .toEqual({ adapter: name, settled: 'rejected', code: 'REZ_HTTP_ERROR', status: 304, wireCalls: 1 });
    }
  }, 120_000);

  it('OR-02 an orphan 304 never triggers a hidden unconditional refetch', async () => {
    for (const [name, specifier] of ADAPTERS) {
      const outcome = await orphan304(specifier);
      expect({ adapter: name, wireCalls: outcome.wireCalls }).toEqual({ adapter: name, wireCalls: 1 });
    }
  }, 120_000);

  it('OR-03 React Native does not convert an orphan 304 into a success just because cache is truthy', async () => {
    const outcome = await orphan304('../src/adapters/react-native.js');
    expect({ settled: outcome.settled, code: outcome.code })
      .toEqual({ settled: 'rejected', code: 'REZ_HTTP_ERROR' });
  }, 60_000);

  it('OR-04 a facade-mode orphan 304 still terminates exactly once instead of hanging', async () => {
    // The nonterminal-facade defect: with `cache: true` and a facade mode, RN
    // publishes an object that never finishes. A refusal or a terminal error
    // are both acceptable; silence is not.
    const outcome = await Promise.race([
      orphan304('../src/adapters/react-native.js', { responseType: 'stream' }),
      new Promise<Outcome>((resolve) => setTimeout(
        () => resolve({ settled: 'resolved', code: 'NEVER_SETTLED', status: null, wireCalls: wire.calls }),
        8000,
      )),
    ]);
    expect(outcome.code).not.toBe('NEVER_SETTLED');
    expect(outcome.settled).toBe('rejected');
  }, 60_000);
});
