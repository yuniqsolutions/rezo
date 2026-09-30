/**
 * A+ Phase 1c-c — R5 cookie provenance, redirect-error routing, and canonical
 * callback precedence.
 *
 * Also the home for R9/R11-browser (real Chrome) and R3 (HTTPS→HTTP reissue),
 * which need a puppeteer lane and a TLS fixture respectively; those rows are
 * named in the request thread and land here before the green review.
 *
 * Asserts the POST-repair contract; expected RED until Phase 1c-c lands.
 * Ground truth is a destination ledger on every row, and no assertion uses a
 * fallback default — an absent captured object must fail, not silently satisfy.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

interface Seen { hits: number; headers: Array<Record<string, string>>; }
const fresh = (): Seen => ({ hits: 0, headers: [] });

let origin: http.Server; let foreign: http.Server;
let pOrigin = 0; let pForeign = 0;
let sOrigin = fresh(); let sForeign = fresh();

const listen = (s: http.Server): Promise<number> =>
  new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const reset = () => { sOrigin = fresh(); sForeign = fresh(); };
const last = (s: Seen): Record<string, string> => s.headers[s.headers.length - 1] ?? {};

beforeAll(async () => {
  foreign = http.createServer((req, res) => {
    sForeign.hits++; sForeign.headers.push({ ...(req.headers as Record<string, string>) });
    req.on('data', () => {}); req.on('end', () => { res.writeHead(200); res.end('{"hop":"foreign"}'); });
  });
  pForeign = await listen(foreign);

  origin = http.createServer((req, res) => {
    sOrigin.hits++; sOrigin.headers.push({ ...(req.headers as Record<string, string>) });
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    req.on('data', () => {});
    req.on('end', () => {
      if (pathname === '/set-cookie') {
        res.writeHead(200, { 'set-cookie': 'jarid=origin-owned; Path=/' }); res.end('{}'); return;
      }
      if (pathname === '/to-foreign') {
        res.writeHead(302, { location: `http://localhost:${pForeign}/f` }); res.end(); return;
      }
      if (pathname === '/same-hop') {
        res.writeHead(302, { location: `http://127.0.0.1:${pOrigin}/final` }); res.end(); return;
      }
      if (pathname === '/redirect-no-location') {
        // A 302 with NO Location header — the registered missing-Location case.
        res.writeHead(302, { 'content-type': 'application/json' }); res.end('{}'); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"hop":"origin"}');
    });
  });
  pOrigin = await listen(origin);
});

afterAll(async () => {
  await Promise.all([origin, foreign].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const adapters = [
  { name: 'http', adapter: httpAdapter },
  { name: 'fetch', adapter: fetchAdapter },
] as const;

describe('A+ Phase 1c-c — R5: literal Cookie is origin-bound; the jar is a separate authority', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: a caller's literal Cookie does not follow a foreign redirect`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/to-foreign`, {
          timeout: 5000, headers: { Cookie: 'sid=caller-owned' },
        } as never);
      } catch { /* ledger decides */ }

      expect(sForeign.hits).toBe(1);
      expect(last(sOrigin)['cookie']).toContain('sid=caller-owned'); // control: sent to its own origin
      expect(last(sForeign)['cookie']).toBeUndefined();
    });

    it(`${name}: an explicit callback Cookie wins over the caller's literal Cookie`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/same-hop`, {
          timeout: 5000,
          headers: { Cookie: 'sid=caller-owned' },
          onRedirect: () => ({ redirect: true, setHeaders: { Cookie: 'sid=callback-owned' } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2);
      expect(last(sOrigin)['cookie']).toBe('sid=callback-owned');
    });

    it(`${name}: a Cookie tombstone suppresses the caller's literal Cookie on the hop`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/same-hop`, {
          timeout: 5000,
          headers: { Cookie: 'sid=caller-owned', 'X-Keep': 'survives' },
          onRedirect: () => ({ redirect: true, setHeaders: { Cookie: undefined } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2);
      expect(last(sOrigin)['cookie']).toBeUndefined();
      // DISCRIMINATOR: wholesale replacement must not masquerade as a tombstone.
      expect(last(sOrigin)['x-keep']).toBe('survives');
    });
  }
});

describe('A+ Phase 1c-c — redirect-error routing (advisory 1)', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: a 3xx without Location produces the registered missing-Location code`, async () => {
      reset();
      let thrown: unknown = null;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/redirect-no-location`, {
          timeout: 5000,
        } as never);
      } catch (error) { thrown = error; }

      expect(sOrigin.hits).toBe(1);
      expect(thrown, 'a 3xx without Location must reject').toBeTruthy();
      // Registered, enumerated and factory-backed at rezo-error.ts:205/:407/:871 —
      // and currently emitted by no adapter, which is the defect.
      expect((thrown as { code?: string })?.code).toBe('REZ_MISSING_REDIRECT_LOCATION');
    });
  }
});

describe('A+ Phase 1c-c — canonical callback precedence (advisory 2)', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: a request-level onRedirect outranks an instance-default beforeRedirect`, async () => {
      reset();
      let requestCb = 0;
      let defaultCb = 0;
      const client = new Rezo({
        beforeRedirect: () => { defaultCb++; return { redirect: true }; },
      } as never, adapter);

      try {
        await client.get(`http://127.0.0.1:${pOrigin}/same-hop`, {
          timeout: 5000,
          onRedirect: () => { requestCb++; return { redirect: true }; },
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2); // the hop was followed either way
      // Request level must win over instance default. The alias must never
      // invert the precedence callers rely on everywhere else.
      expect(requestCb).toBe(1);
      expect(defaultCb).toBe(0);
    });

    it(`${name}: control — an instance-default callback runs when the request supplies none`, async () => {
      reset();
      let defaultCb = 0;
      const client = new Rezo({
        beforeRedirect: () => { defaultCb++; return { redirect: true }; },
      } as never, adapter);

      try {
        await client.get(`http://127.0.0.1:${pOrigin}/same-hop`, { timeout: 5000 } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2);
      expect(defaultCb).toBe(1);
    });
  }
});

describe('A+ Phase 1c-c — R11 Fetch visibility classifier (Worker half)', () => {
  // Neutralising ONLY `process` is not enough: under native Bun `globalThis.Bun`
  // still satisfies the server predicate, so the Worker row saw `visible`.
  // Save and restore exact property descriptors so no global is left mutated.
  const SERVER_MARKERS = ['process', 'Bun', 'Deno', 'EdgeRuntime'] as const;

  // Option 2 (Codex's call, its contract): keep the evaluator reading globals and
  // scope the two mutation-based rows to runtimes whose server markers can
  // actually be neutralised. `globalThis.Bun` is configurable:false AND
  // writable:false — frozen into the realm — so under native Bun these rows
  // cannot pass by construction, not because they are mis-written. The product
  // classifier is verified on Bun by Codex's executed probe instead.
  const canNeutraliseServerMarkers = SERVER_MARKERS.every((key) => {
    const d = Object.getOwnPropertyDescriptor(globalThis as Record<string, unknown>, key);
    return d === undefined || d.configurable === true;
  });
  const mutationRow = canNeutraliseServerMarkers ? it : it.skip;
  const withGlobals = async (
    set: Record<string, unknown>,
    clear: readonly string[],
    run: () => Promise<void> | void,
  ) => {
    const g = globalThis as Record<string, unknown>;
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const key of [...clear, ...Object.keys(set)]) {
      saved.set(key, Object.getOwnPropertyDescriptor(g, key));
    }
    try {
      for (const key of clear) delete g[key];
      for (const [key, value] of Object.entries(set)) {
        Object.defineProperty(g, key, { value, configurable: true, writable: true });
      }
      await run();
    } finally {
      for (const [key, descriptor] of saved) {
        delete g[key];
        if (descriptor) Object.defineProperty(g, key, descriptor);
      }
    }
  };

  mutationRow('classifies a browser Web Worker global as hidden, not visible', async () => {
    const { evaluateAdapterRedirectVisibility } = await import('../src/core/adapter-capabilities');
    const { executeRequest } = await import('../src/adapters/fetch');
    await withGlobals({ WorkerGlobalScope: function () {} }, SERVER_MARKERS, () => {
      expect(evaluateAdapterRedirectVisibility(executeRequest as never, {} as never).visibility)
        .toBe('hidden');
    });
  });

  mutationRow('an edge runtime with worker globals stays VISIBLE (it owns its own loop)', async () => {
    const { evaluateAdapterRedirectVisibility } = await import('../src/core/adapter-capabilities');
    const { executeRequest } = await import('../src/adapters/fetch');
    await withGlobals(
      { WorkerGlobalScope: function () {}, EdgeRuntime: 'vercel' },
      SERVER_MARKERS,
      () => {
        expect(evaluateAdapterRedirectVisibility(executeRequest as never, {} as never).visibility)
          .toBe('visible');
      },
    );
  });

  it('control — the real runtime remains visible with no globals altered', async () => {
    const { evaluateAdapterRedirectVisibility } = await import('../src/core/adapter-capabilities');
    const { executeRequest } = await import('../src/adapters/fetch');
    expect(evaluateAdapterRedirectVisibility(executeRequest as never, {} as never).visibility)
      .toBe('visible');
  });
});
