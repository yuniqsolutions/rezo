// responseType lifecycle gates (DECISION-063 C, carrier 3) — the exact
// shared-core order ruled by DECISION-068 option A:
//
//   init → resolve/validate → beforeRequest → mock-return
//        → resolve/validate → cache lookup/revalidation → adapter dispatch
//
// Two gates bracket the mutable hook, and the cache is keyed from the
// FINALIZED post-hook request. Today the order is inverted: `src/core/rezo.ts`
// performs cache lookup and conditional-header injection before
// `executeWithHooks` ever calls `beforeRequest`, so a hook cannot influence
// the identity its own request is served under, and a cache hit returns
// without the hook running at all.
//
// RED-first: HG-01..HG-04 fail on the pre-C bytes. HG-05 and HG-06 are the
// positive controls — the mock short-circuit and an ordinary valid request
// must keep working, so an ordering failure can never be mistaken for a
// broken harness.
import { describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import type { AdapterFunction } from '../src/core/rezo.js';
import type { RezoRequestConfig } from '../src/types/rezo-request.js';
import { registerAdapterCapabilities } from '../src/core/adapter-capabilities.js';

const URL_UNDER_TEST = 'https://example.invalid/hook-gates';

interface Recorder {
  readonly adapter: AdapterFunction;
  readonly events: string[];
  dispatches: number;
  observed: RezoRequestConfig[];
}

/** Adapter that records dispatch order and returns a cacheable response. */
function createRecorder(): Recorder {
  const recorder: Recorder = {
    events: [],
    dispatches: 0,
    observed: [],
    adapter: (async (options: RezoRequestConfig) => {
      recorder.dispatches += 1;
      recorder.observed.push(options);
      recorder.events.push('dispatch');
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' },
        config: options,
      } as never;
    }) as AdapterFunction,
  };
  return recorder;
}

type RequestFn = (config: unknown) => Promise<unknown>;

async function settle(promise: Promise<unknown>): Promise<{ settled: 'resolved' | 'rejected'; code: unknown }> {
  try {
    await promise;
    return { settled: 'resolved', code: null };
  } catch (error) {
    return { settled: 'rejected', code: (error as { code?: unknown })?.code ?? null };
  }
}

describe('responseType hook gates and lifecycle order', () => {
  it('HG-01 beforeRequest runs on a cache HIT, not only on a miss (D068-A consequence)', async () => {
    const recorder = createRecorder();
    const hookCalls: string[] = [];
    const client = new Rezo({
      cache: true,
      hooks: {
        beforeRequest: [(config: RezoRequestConfig) => { hookCalls.push(String(config.responseType)); return undefined; }],
      },
    } as never, recorder.adapter);

    await (client.request as RequestFn)({ url: URL_UNDER_TEST, method: 'GET', responseType: 'json', cache: true });
    const afterSeed = { hookCalls: hookCalls.length, dispatches: recorder.dispatches };

    await (client.request as RequestFn)({ url: URL_UNDER_TEST, method: 'GET', responseType: 'json', cache: true });

    // Seed: one hook call, one dispatch. Hit: a SECOND hook call, still one dispatch.
    expect({ afterSeed, hookCallsAfterHit: hookCalls.length })
      .toEqual({ afterSeed: { hookCalls: 1, dispatches: 1 }, hookCallsAfterHit: 2 });
  });

  it('HG-02 an invalid hook mutation refuses at the second gate: zero dispatch, zero cache write, one beforeError', async () => {
    const recorder = createRecorder();
    const beforeErrors: unknown[] = [];
    const client = new Rezo({
      cache: true,
      hooks: {
        beforeRequest: [(config: RezoRequestConfig) => {
          (config as { responseType?: unknown }).responseType = 'BOGUS';
          return undefined;
        }],
        beforeError: [(error: unknown) => { beforeErrors.push(error); return error; }],
      },
    } as never, recorder.adapter);

    const outcome = await settle((client.request as RequestFn)({
      url: URL_UNDER_TEST, method: 'GET', responseType: 'json', cache: true,
    }));

    expect({ settled: outcome.settled, code: outcome.code, dispatches: recorder.dispatches, beforeErrors: beforeErrors.length })
      .toEqual({ settled: 'rejected', code: 'REZ_INVALID_RESPONSE_TYPE', dispatches: 0, beforeErrors: 1 });
  });

  it('HG-03 a valid hook mutation is re-canonicalized before dispatch', async () => {
    const recorder = createRecorder();
    const client = new Rezo({
      hooks: {
        beforeRequest: [(config: RezoRequestConfig) => {
          (config as { responseType?: unknown }).responseType = 'arraybuffer';
          return undefined;
        }],
      },
    } as never, recorder.adapter);

    await (client.request as RequestFn)({ url: URL_UNDER_TEST, method: 'GET', responseType: 'json' });

    const observed = recorder.observed[0] as { responseType?: unknown };
    expect({ dispatches: recorder.dispatches, observed: observed?.responseType })
      .toEqual({ dispatches: 1, observed: 'arrayBuffer' });
  });

  it('HG-04 an initially invalid value never reaches beforeRequest, the cache, or the wire', async () => {
    const recorder = createRecorder();
    const hookCalls: unknown[] = [];
    const beforeErrors: unknown[] = [];
    const client = new Rezo({
      cache: true,
      hooks: {
        beforeRequest: [(config: RezoRequestConfig) => { hookCalls.push(config.responseType); return undefined; }],
        beforeError: [(error: unknown) => { beforeErrors.push(error); return error; }],
      },
    } as never, recorder.adapter);

    const outcome = await settle((client.request as RequestFn)({
      url: URL_UNDER_TEST, method: 'GET', responseType: 'JSON', cache: true,
    }));

    expect({
      settled: outcome.settled,
      code: outcome.code,
      hookCalls: hookCalls.length,
      dispatches: recorder.dispatches,
      beforeErrors: beforeErrors.length,
    }).toEqual({
      settled: 'rejected',
      code: 'REZ_INVALID_RESPONSE_TYPE',
      hookCalls: 0,
      dispatches: 0,
      beforeErrors: 1,
    });
  });

  it('HG-05 CONTROL: a hook-returned mock short-circuits before the cache and the adapter', async () => {
    const recorder = createRecorder();
    const client = new Rezo({
      cache: true,
      hooks: {
        beforeRequest: [() => ({
          data: { mocked: true },
          status: 200,
          statusText: 'OK',
          headers: {},
        })],
      },
    } as never, recorder.adapter);

    const response = await (client.request as RequestFn)({
      url: URL_UNDER_TEST, method: 'GET', responseType: 'json', cache: true,
    }) as { data?: { mocked?: boolean } };

    expect({ mocked: response?.data?.mocked, dispatches: recorder.dispatches })
      .toEqual({ mocked: true, dispatches: 0 });
  });

  it('HG-06 CONTROL: an ordinary valid request runs the hook once and dispatches once', async () => {
    const recorder = createRecorder();
    let hookCalls = 0;
    const client = new Rezo({
      hooks: { beforeRequest: [() => { hookCalls += 1; return undefined; }] },
    } as never, recorder.adapter);

    await (client.request as RequestFn)({ url: URL_UNDER_TEST, method: 'GET', responseType: 'json' });

    expect({ hookCalls, dispatches: recorder.dispatches }).toEqual({ hookCalls: 1, dispatches: 1 });
  });
});

describe('mock short-circuit precedes every pre-dispatch gate', () => {
  it('HG-07 a hook-returned mock wins over a hidden-lane capability refusal', async () => {
    // Written from the PROPERTY, not from the mechanism: "a mock short-circuits
    // before anything that could refuse or dispatch." HG-05 asserts the same
    // sentence but cannot see this violation, because its adapter is
    // unregistered and it supplies no redirect guarantee — so the capability
    // precheck never engages and its zero-dispatch assertion passes either way.
    //
    // Here the precheck DOES engage: caching is on, a redirect guarantee is
    // supplied, and the lane is hidden. If any gate runs ahead of the mock
    // decision, the caller gets REZ_UNSUPPORTED_CAPABILITY instead of the
    // response their own hook returned.
    let dispatches = 0;
    const adapter: AdapterFunction = (async () => {
      dispatches += 1;
      return { data: 'wire', status: 200, statusText: 'OK', headers: {}, config: {} } as never;
    }) as AdapterFunction;

    // Registering the adapter as a hidden lane is what makes the capability
    // precheck engage at all — HG-05's adapter is unregistered, which is why it
    // cannot see this.
    registerAdapterCapabilities(adapter, {
      evaluateRedirectVisibility: () => ({ visibility: 'hidden', lane: 'curl-native' }) as never,
    });

    let hookRuns = 0;
    const client = new Rezo(
      {
        cache: { response: { enable: true, ttl: 60_000 } },
        hooks: {
          beforeRequest: [() => {
            hookRuns += 1;
            return { data: 'mocked', status: 200, statusText: 'OK', headers: {}, config: {} } as never;
          }],
        },
      } as never,
      adapter,
    );

    let outcome: unknown;
    let raised: unknown;
    try {
      outcome = await (client.get as (url: string, options: unknown) => Promise<unknown>)(
        'https://example.invalid/hidden-lane-mock',
        // A redirect guarantee: this is what engages the capability precheck.
        { onRedirect: () => ({ redirect: true }) },
      );
    } catch (error) {
      raised = error;
    }

    expect({
      data: (outcome as { data?: unknown } | undefined)?.data ?? null,
      code: raised === undefined ? 'none' : (raised as { code?: string }).code ?? 'non-rezo',
      hookRuns,
      dispatches,
    }).toEqual({ data: 'mocked', code: 'none', hookRuns: 1, dispatches: 0 });
  });
});

describe('gate 2 precedes the capability refusal', () => {
  it('HG-08 an invalid responseType mutation is refused before a hidden-lane capability', async () => {
    // The frozen order is mock → second resolve/validate → cache/dispatch. The
    // capability precheck now runs after the mock, but still AHEAD of gate 2,
    // so a `beforeRequest` that mutates responseType to something invalid gets
    // a capability refusal instead of the vocabulary refusal that should have
    // caught it first. The caller is told the wrong thing about their request.
    let dispatches = 0;
    const adapter: AdapterFunction = (async () => {
      dispatches += 1;
      return { data: 'wire', status: 200, statusText: 'OK', headers: {}, config: {} } as never;
    }) as AdapterFunction;

    registerAdapterCapabilities(adapter, {
      evaluateRedirectVisibility: () => ({ visibility: 'hidden', lane: 'curl-native' }) as never,
    });

    const client = new Rezo(
      {
        cache: { response: { enable: true, ttl: 60_000 } },
        hooks: {
          beforeRequest: [(config: Record<string, unknown>) => {
            config.responseType = 'BOGUS';
            return undefined as never;
          }],
        },
      } as never,
      adapter,
    );

    let raised: unknown;
    try {
      await (client.get as (url: string, options: unknown) => Promise<unknown>)(
        'https://example.invalid/gate-two-before-capability',
        { onRedirect: () => ({ redirect: true }) },
      );
    } catch (error) {
      raised = error;
    }

    expect({
      code: raised === undefined ? 'none' : (raised as { code?: string }).code ?? 'non-rezo',
      dispatches,
    }).toEqual({ code: 'REZ_INVALID_RESPONSE_TYPE', dispatches: 0 });
  });
});

describe('a guarantee added BY the hook is still evaluated after it', () => {
  it('HG-09 a beforeRequest that adds the redirect guarantee is refused after gate 2, with no cache work', async () => {
    // The precheck reads the guarantee from the request. Every existing row
    // supplies it up front, so none proves the precheck sees a guarantee the
    // HOOK added — the case where ordering actually matters. Counters cover
    // every cache operation, not dispatch alone, so a lookup or store slipping
    // in ahead of the refusal is visible.
    let dispatches = 0;
    const adapter: AdapterFunction = (async () => {
      dispatches += 1;
      return { data: 'wire', status: 200, statusText: 'OK', headers: {}, config: {} } as never;
    }) as AdapterFunction;

    registerAdapterCapabilities(adapter, {
      evaluateRedirectVisibility: () => ({ visibility: 'hidden', lane: 'curl-native' }) as never,
    });

    const client = new Rezo(
      {
        cache: { response: { enable: true, ttl: 60_000 } },
        hooks: {
          beforeRequest: [(config: Record<string, unknown>) => {
            // The guarantee arrives here, not from the caller.
            config.onRedirect = () => ({ redirect: true });
            return undefined as never;
          }],
        },
      } as never,
      adapter,
    );

    const cache = (client as unknown as { responseCache?: Record<string, (...a: unknown[]) => unknown> }).responseCache;
    const operations: string[] = [];
    if (cache) {
      for (const name of ['get', 'set', 'getConditionalHeaders', 'updateRevalidated'] as const) {
        const real = (cache[name] as (...a: unknown[]) => unknown).bind(cache);
        cache[name] = (...args: unknown[]) => { operations.push(name); return real(...args); };
      }
    }

    let raised: unknown;
    try {
      await (client.get as (url: string) => Promise<unknown>)('https://example.invalid/hook-added-guarantee');
    } catch (error) {
      raised = error;
    }

    expect({
      code: raised === undefined ? 'none' : (raised as { code?: string }).code ?? 'non-rezo',
      operations,
      dispatches,
    }).toEqual({ code: 'REZ_UNSUPPORTED_CAPABILITY', operations: [], dispatches: 0 });
  });

  // The rule both gates enforce for a dedicated facade: a caller who holds a
  // facade may retarget the REPRESENTATION inside it, but nothing may swap the
  // facade itself. Disabling either arm left the whole suite green -- 753 tests
  // across all 37 facade-touching files passed with gate 1's arm off, and 159
  // with gate 2's off -- so this public rule had no coverage at either
  // enforcement point.

  it('HG-10 a caller-supplied facade swap is refused BEFORE beforeRequest runs', async () => {
    // First version of this row asserted only "refused, zero dispatch" and
    // survived gate 1 being disabled: gate 2 backstops it and throws the same
    // error, so the row could not tell the two gates apart. That is the same
    // over-claiming this carrier just criticised elsewhere.
    //
    // The observable that DOES separate them is when the refusal happens.
    // Gate 1 sits before the hook, gate 2 after it, so a caller-supplied
    // invalid facade must be refused with `beforeRequest` never having run.
    async function streamOutcome(responseType: string): Promise<Record<string, unknown>> {
      const recorder = createRecorder();
      let hookRuns = 0;
      const client = new Rezo({
        hooks: { beforeRequest: [() => { hookRuns += 1; return undefined; }] },
      } as never, recorder.adapter);
      const stream = client.stream(URL_UNDER_TEST, { responseType } as never);
      const failure = await new Promise<unknown>((resolve) => {
        let settled = false;
        (stream as unknown as { on(event: string, listener: (value: unknown) => void): void })
          .on('error', (error) => { settled = true; resolve(error); });
        setTimeout(() => { if (!settled) resolve(undefined); }, 50);
      });
      return { code: (failure as { code?: unknown })?.code ?? null, dispatches: recorder.dispatches, hookRuns };
    }

    // 'download' is another facade: refused, and the hook never ran.
    // 'json' only retargets the representation inside the stream: permitted.
    expect({ swap: await streamOutcome('download'), retarget: await streamOutcome('json') })
      .toEqual({
        swap: { code: 'REZ_INVALID_RESPONSE_TYPE', dispatches: 0, hookRuns: 0 },
        retarget: { code: null, dispatches: 1, hookRuns: 1 },
      });
  });

  it('HG-11 gate 2 refuses a HOOK swapping the facade, after beforeRequest has run', async () => {
    async function hookOutcome(mutation: string): Promise<{ code: unknown; dispatches: number; hookRuns: number }> {
      const recorder = createRecorder();
      let hookRuns = 0;
      const client = new Rezo({
        hooks: {
          beforeRequest: [(config: RezoRequestConfig) => {
            hookRuns += 1;
            (config as { responseType?: unknown }).responseType = mutation;
            return undefined;
          }],
        },
      } as never, recorder.adapter);
      const stream = client.stream(URL_UNDER_TEST);
      const failure = await new Promise<unknown>((resolve) => {
        let settled = false;
        (stream as unknown as { on(event: string, listener: (value: unknown) => void): void })
          .on('error', (error) => { settled = true; resolve(error); });
        setTimeout(() => { if (!settled) resolve(undefined); }, 50);
      });
      return {
        code: (failure as { code?: unknown })?.code ?? null,
        dispatches: recorder.dispatches,
        hookRuns,
      };
    }

    // The hook must have RUN in both cases — this gate sits after it, which is
    // the whole point of there being a second one.
    expect({ swap: await hookOutcome('upload'), retarget: await hookOutcome('text') })
      .toEqual({
        swap: { code: 'REZ_INVALID_RESPONSE_TYPE', dispatches: 0, hookRuns: 1 },
        retarget: { code: null, dispatches: 1, hookRuns: 1 },
      });
  });

});
