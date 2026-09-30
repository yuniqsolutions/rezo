/**
 * A+ Phase 1c-c — redirect patch lifetime and precedence on visible-hop adapters.
 *
 * Rows U2, R1, R2, R4 from the approved plan, plus the wire-level relation
 * intersection that a `'same-origin'` → `'cross-origin'` mutation survived
 * across 1,050 assertions because no test stood at it.
 *
 * These assert the POST-repair contract and are expected RED until Phase 1c-c
 * lands. Every failing row has a passing control beside it, and ground truth is
 * always the destination server's ledger — a client-side rejection is not
 * evidence that a header was withheld.
 *
 * Covered here: HTTP and server Fetch. HTTP/2 receives its U2/R1/R2/R4 coverage
 * in the credential-provenance file, which carries the h2c fixtures. Browser
 * lanes own R9/R11 and cannot evidence per-hop lifetime, because the platform
 * owns the chain.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

const AUTH = 'Bearer A-PLUS-1CC-PLACEHOLDER';
const OVERLAY = 'overlay-applied';

/** What each hop actually received. Reset before every request. */
interface HopLedger {
  hits: number;
  headers: Array<Record<string, string>>;
  methods: string[];
  bodies: string[];
}
const ledger = (): HopLedger => ({ hits: 0, headers: [], methods: [], bodies: [] });

let A: http.Server; let B: http.Server; let C: http.Server;
let pA = 0; let pB = 0; let pC = 0;
let lA = ledger(); let lB = ledger(); let lC = ledger();

const record = (l: HopLedger, req: http.IncomingMessage, body: string) => {
  l.hits++;
  l.headers.push({ ...(req.headers as Record<string, string>) });
  l.methods.push(String(req.method));
  l.bodies.push(body);
};

const collect = (req: http.IncomingMessage, done: (body: string) => void) => {
  const chunks: Buffer[] = [];
  req.on('data', (d: Buffer) => chunks.push(d));
  req.on('end', () => done(Buffer.concat(chunks).toString()));
};

const listen = (s: http.Server): Promise<number> =>
  new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));

const resetAll = () => { lA = ledger(); lB = ledger(); lC = ledger(); };

beforeAll(async () => {
  // C — terminal destination, never redirects.
  C = http.createServer((req, res) => {
    collect(req, (body) => {
      record(lC, req, body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"hop":"C"}');
    });
  });
  pC = await listen(C);

  // B — second hop. Redirects onward per path.
  B = http.createServer((req, res) => {
    collect(req, (body) => {
      record(lB, req, body);
      const { pathname } = new URL(req.url ?? '/', 'http://placeholder');
      if (pathname === '/to-c-foreign') {
        res.writeHead(302, { location: `http://localhost:${pC}/c` });
      } else if (pathname === '/to-c-same') {
        res.writeHead(302, { location: `http://127.0.0.1:${pB}/final` });
      } else if (pathname === '/back-to-a') {
        res.writeHead(302, { location: `http://127.0.0.1:${pA}/final` });
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"hop":"B-final"}');
        return;
      }
      res.end();
    });
  });
  pB = await listen(B);

  // A — origin. Redirects to B on several shapes.
  A = http.createServer((req, res) => {
    collect(req, (body) => {
      record(lA, req, body);
      const { pathname } = new URL(req.url ?? '/', 'http://placeholder');
      if (pathname === '/same-origin-hop') {
        res.writeHead(302, { location: `http://127.0.0.1:${pA}/final` });
      } else if (pathname === '/to-b-same-origin') {
        res.writeHead(302, { location: `http://127.0.0.1:${pA}/second-same` });
      } else if (pathname === '/second-same') {
        res.writeHead(302, { location: `http://127.0.0.1:${pA}/final` });
      } else if (pathname === '/to-b-then-foreign') {
        res.writeHead(302, { location: `http://127.0.0.1:${pB}/to-c-foreign` });
      } else if (pathname === '/to-b-then-back') {
        res.writeHead(302, { location: `http://127.0.0.1:${pB}/back-to-a` });
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"hop":"A-final"}');
        return;
      }
      res.end();
    });
  });
  pA = await listen(A);
});

afterAll(async () => {
  await Promise.all([A, B, C].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const adapters = [
  { name: 'http', adapter: httpAdapter },
  { name: 'fetch', adapter: fetchAdapter },
] as const;

const lastHeadersAt = (l: HopLedger): Record<string, string> => l.headers[l.headers.length - 1] ?? {};

describe('A+ Phase 1c-c — U2: a denied or throwing callback commits nothing', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: a denied redirect performs no onward dispatch and leaves the response at the source`, async () => {
      resetAll();
      const client = new Rezo({}, adapter);
      let settled: unknown = null;
      try {
        settled = await client.get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          onRedirect: () => ({ redirect: false }),
        } as never);
      } catch (error) {
        settled = error;
      }

      // Ground truth: the source was reached exactly once and nothing went onward.
      expect(lA.hits).toBe(1);
      // U2 full state invariant — count, history and URL must all be uncommitted.
      const cfg = (settled as {
        config?: { redirectCount?: number; redirectHistory?: unknown[]; finalUrl?: string };
      })?.config;
      // No fallback defaults: an absent config must FAIL, not silently satisfy
      // the invariant. `?? 0` would pass this row when nothing was captured.
      expect(cfg, 'settled result must expose the request config').toBeDefined();
      expect(cfg!.redirectCount).toBe(0);
      expect(cfg!.redirectHistory).toEqual([]);
      // RezoConfig exposes `finalUrl`, not `fullUrl` — the previous assertion
      // named a property that does not exist, so it could never be meaningful.
      expect(cfg!.finalUrl, 'finalized URL must be captured').toBeDefined();
      expect(String(cfg!.finalUrl)).toContain('/same-origin-hop');
    });

    it(`${name}: a throwing callback commits no onward dispatch (control: undenied redirect does)`, async () => {
      // CONTROL — without denial the same fixture must follow the hop.
      resetAll();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, { timeout: 5000 } as never);
      } catch { /* ledger decides */ }
      const controlHits = lA.hits;
      expect(controlHits).toBe(2); // source + final, same origin

      resetAll();
      const SENTINEL = 'U2-THROW-SENTINEL-7Q';
      const cb = vi.fn(() => { throw new Error(SENTINEL); });
      // A raw thrown sentinel is not required to carry `.config`. Capture the
      // LIVE config through the hook instead, then assert the sentinel
      // propagated separately. Asserting `.config` on the sentinel tested the
      // error's shape, not the commit invariant.
      let liveConfig:
        | { redirectCount?: number; redirectHistory?: unknown[]; finalUrl?: string }
        | undefined;
      let thrown: unknown = null;
      let resolved: unknown = null;
      try {
        resolved = await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          onRedirect: cb as never,
          hooks: {
            // Rezo passes config as ARGUMENT 2, not as `context.config`. Reading
            // `ctx.config` never fired, so `liveConfig` stayed undefined and the
            // assertion silently fell back to the thrown error's config.
            beforeRedirect: [(_context: unknown, config: typeof liveConfig) => {
              liveConfig = config;
            }],
          },
        } as never);
      } catch (error) { thrown = error; }

      // The callback must actually have run — otherwise a mutation that ignores
      // the callback and simply stops after the source would pass this row.
      expect(cb).toHaveBeenCalledTimes(1);
      // The sentinel must survive: a throw is not silently swallowed into success.
      expect(resolved).toBeNull();
      expect(String((thrown as { message?: string })?.message ?? thrown)).toContain(SENTINEL);
      // No onward dispatch, and no committed hop state.
      expect(lA.hits).toBe(1);
      // Commit invariant, measured on the LIVE config where the hook saw it —
      // or on the thrown error's config when the adapter attaches one. Whichever
      // is available must show an uncommitted hop; absence of both fails.
      // Measured on the LIVE config only. Falling back to the thrown error's
      // config would let a hook that never fired still satisfy the row, and
      // `?? 0` / `?? []` would let an ABSENT field pass as a committed-nothing
      // state. Every assertion below is positive-value: absence fails.
      expect(
        liveConfig,
        'the beforeRedirect hook must deliver the live config as argument 2',
      ).toBeDefined();
      expect(liveConfig!.redirectCount).toBe(0);
      expect(liveConfig!.redirectHistory).toEqual([]);
      // The strongest of the three: the source URL is still the destination of
      // record, so no hop was committed anywhere in the config.
      expect(liveConfig!.finalUrl).toBe(`http://127.0.0.1:${pA}/same-origin-hop`);
    });
  }
});

describe('A+ Phase 1c-c — R1: a one-hop patch expires before the next redirect', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: setHeaders applies to its own hop only, including across a same-origin chain`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-same-origin`, {
          timeout: 5000,
          // Supplied on the FIRST redirect only. A re-set would masquerade as persistence.
          onRedirect: () => {
            calls++;
            return calls === 1 ? { redirect: true, setHeaders: { 'X-One-Hop': OVERLAY } } : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      // A is hit three times: initial, /second-same, /final.
      expect(lA.hits).toBe(3);
      expect(calls).toBe(2);
      // Hop 2 legitimately carries the patch...
      expect(lA.headers[1]?.['x-one-hop']).toBe(OVERLAY);
      // ...and hop 3 must not: the patch expired with its hop.
      expect(lA.headers[2]?.['x-one-hop']).toBeUndefined();
    });

    it(`${name}: a one-hop credential does not reach a later foreign origin`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-then-foreign`, {
          timeout: 5000,
          onRedirect: () => {
            calls++;
            return calls === 1 ? { redirect: true, setHeaders: { 'X-Api-Key': AUTH } } : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      expect(lC.hits).toBe(1); // foreign destination genuinely reached
      expect(lastHeadersAt(lB)['x-api-key']).toBe(AUTH); // intended hop received it
      expect(lastHeadersAt(lC)['x-api-key']).toBeUndefined(); // foreign origin must not
    });
  }
});

describe('A+ Phase 1c-c — R2: a persistent patch is origin-anchored and never revives', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: setHeadersOnRedirects survives same-origin hops`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-same-origin`, {
          timeout: 5000,
          onRedirect: () => {
            calls++;
            return calls === 1
              ? { redirect: true, setHeadersOnRedirects: { 'X-Persist': OVERLAY } }
              : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      expect(lA.hits).toBe(3);
      expect(lA.headers[1]?.['x-persist']).toBe(OVERLAY);
      // Persistent: unlike the one-hop patch, it must still be present on hop 3.
      expect(lA.headers[2]?.['x-persist']).toBe(OVERLAY);
    });

    it(`${name}: a persistent patch expires on origin change and does not revive on A→B→A`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-then-back`, {
          timeout: 5000,
          onRedirect: () => {
            calls++;
            return calls === 1
              ? { redirect: true, setHeadersOnRedirects: { 'X-Persist': OVERLAY } }
              : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      // B is a different origin (port change) — patch expires there.
      // DISCRIMINATOR: the patch must have been *live* at the anchored hop first.
      // Without this the row passes vacuously while setHeadersOnRedirects is dead —
      // "absent after origin change" is trivially true if it is never present.
      expect(lB.headers[0]?.['x-persist']).toBe(OVERLAY);
      expect(lB.hits).toBe(1);
      // Returning to A must NOT revive it: expiry is terminal, not suspension.
      expect(lA.hits).toBe(2);
      expect(lastHeadersAt(lA)['x-persist']).toBeUndefined();
    });

    // Codex's required control: expiry must RESTORE the caller's value, not just
    // erase the key. This is the row the old mutate-in-place carrier could never
    // satisfy — it overwrote the only copy of the header set, so once a patch had
    // clobbered a caller value that value was gone for the rest of the chain.
    // Recomposition from a clean base is what makes it recoverable.
    it(`${name}: an expired persistent patch restores the caller's own same-key value`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-then-back`, {
          timeout: 5000,
          headers: { 'X-Same': 'caller-value' },
          onRedirect: () => {
            calls++;
            return calls === 1
              ? { redirect: true, setHeadersOnRedirects: { 'X-Same': 'patch-value' } }
              : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      // DISCRIMINATOR: the patch must genuinely have WON the collision at B,
      // otherwise "caller value present at the end" is trivially true.
      expect(lB.hits).toBe(1);
      expect(lB.headers[0]?.['x-same']).toBe('patch-value');
      // On expiry the caller's original value must be back — not the patch value,
      // and NOT absent. Absence would mean recomposition dropped a header the
      // caller set and never asked to have removed.
      expect(lA.hits).toBe(2);
      expect(lastHeadersAt(lA)['x-same']).toBe('caller-value');
    });

    // Codex control: the ONE-HOP patch must restore the caller's value too.
    // One-hop expiry previously worked by deleting the keys it added, which
    // cannot distinguish "patch added X" from "patch overwrote the caller's X".
    it(`${name}: an expired one-hop patch restores the caller's own same-key value`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-then-back`, {
          timeout: 5000,
          headers: { 'X-Hop': 'caller-value' },
          onRedirect: () => {
            calls++;
            return calls === 1
              ? { redirect: true, setHeaders: { 'X-Hop': 'one-hop-value' } }
              : { redirect: true };
          },
        } as never);
      } catch { /* ledger decides */ }

      expect(lB.hits).toBe(1);
      expect(lB.headers[0]?.['x-hop']).toBe('one-hop-value'); // patch won its hop
      expect(lA.hits).toBe(2);
      expect(lastHeadersAt(lA)['x-hop']).toBe('caller-value'); // restored, not erased
    });

    // Codex control (gaps 1 + 4): an invalid patch must throw the structured
    // contract AND roll back — no half-advanced request. Degrading to "no patch"
    // and following the redirect anyway is the failure this row exists to catch.
    it(`${name}: an invalid redirect header patch throws and commits nothing`, async () => {
      resetAll();
      let liveConfig: { redirectCount?: number; finalUrl?: string } | undefined;
      let thrown: unknown = null;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          // A header patch that is not a valid header container.
          onRedirect: () => ({ redirect: true, setHeaders: 42 as never }),
          hooks: {
            beforeRedirect: [(_c: unknown, cfg: typeof liveConfig) => { liveConfig = cfg; }],
          },
        } as never);
      } catch (error) { thrown = error; }

      expect(thrown, 'an invalid patch must reject, not silently follow').toBeTruthy();
      expect((thrown as { code?: string })?.code).toBe('ERR_INVALID_ARG_TYPE');
      // Rollback: the onward hop must not have been dispatched.
      expect(lA.hits).toBe(1);
      expect(liveConfig).toBeDefined();
      expect(liveConfig!.redirectCount).toBe(0);
      expect(liveConfig!.finalUrl).toBe(`http://127.0.0.1:${pA}/same-origin-hop`);
    });

    // Codex control (gap 3), measured ON THE WIRE: a hook that mutates
    // context.request.headers must still reach the destination. Recomposition
    // replaces the carrier, so this is exactly what it could silently drop.
    it(`${name}: a beforeRedirect hook's header mutation survives recomposition`, async () => {
      resetAll();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          headers: { 'X-Hook': 'original' },
          hooks: {
            beforeRedirect: [(ctx: { request?: { headers?: { set?: (k: string, v: string) => void } } }) => {
              ctx?.request?.headers?.set?.('X-Hook', 'hook-mutated');
            }],
          },
        } as never);
      } catch { /* ledger decides */ }

      expect(lA.hits).toBe(2);
      // Control: the caller's value was really there to begin with.
      expect(lA.headers[0]?.['x-hook']).toBe('original');
      expect(lastHeadersAt(lA)['x-hook']).toBe('hook-mutated');
    });
  }
});

describe('A+ Phase 1c-c — R4: precedence and tombstones', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: the one-hop patch wins a collision with the persistent patch`, async () => {
      resetAll();
      let calls = 0;
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          onRedirect: () => {
            calls++;
            return {
              redirect: true,
              setHeadersOnRedirects: { 'X-Which': 'persistent', 'X-Persist-Witness': 'persistent' },
              setHeaders: { 'X-Which': 'one-hop' },
            };
          },
        } as never);
      } catch { /* ledger decides */ }

      expect(lA.hits).toBe(2);
      // DISCRIMINATOR: the persistent layer must be live and reach the hop under a
      // NON-colliding name. Without this the row passes vacuously while
      // setHeadersOnRedirects is dead — "one-hop won" is trivially true if the
      // persistent layer never applied anything at all.
      expect(lastHeadersAt(lA)['x-persist-witness']).toBe('persistent');
      expect(lastHeadersAt(lA)['x-which']).toBe('one-hop');
    });

    it(`${name}: an undefined tombstone suppresses a caller header on the next hop`, async () => {
      resetAll();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          headers: { 'X-Caller': 'present', 'X-Keep': 'survives' },
          onRedirect: () => ({ redirect: true, setHeaders: { 'X-Caller': undefined } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(lA.hits).toBe(2);
      expect(lA.headers[0]?.['x-caller']).toBe('present');       // control: present initially
      expect(lastHeadersAt(lA)['x-caller']).toBeUndefined();     // tombstoned on the hop
      // DISCRIMINATOR: a non-tombstoned caller header must SURVIVE the same hop.
      // Without this, wholesale header replacement passes as a working tombstone.
      expect(lastHeadersAt(lA)['x-keep']).toBe('survives');
    });
  }
});

describe('A+ Phase 1c-c — relation intersection (the mutation 1,050 assertions missed)', () => {
  for (const { name, adapter } of adapters) {
    it(`${name}: a same-origin hop keeps inherited Authorization while applying an overlay`, async () => {
      resetAll();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/same-origin-hop`, {
          timeout: 5000,
          headers: { Authorization: AUTH },
          onRedirect: () => ({ redirect: true, setHeaders: { 'X-Overlay': OVERLAY } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(lA.hits).toBe(2);
      // The overlay applies...
      expect(lastHeadersAt(lA)['x-overlay']).toBe(OVERLAY);
      // ...and same-origin inherited authority survives. An over-strict relation
      // ('cross-origin') would delete this and nothing else in the suite notices.
      expect(lastHeadersAt(lA)['authorization']).toBe(AUTH);
    });

    it(`${name}: control — a foreign hop still strips inherited Authorization`, async () => {
      resetAll();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pA}/to-b-then-foreign`, {
          timeout: 5000,
          headers: { Authorization: AUTH },
        } as never);
      } catch { /* ledger decides */ }

      expect(lC.hits).toBe(1);
      expect(lastHeadersAt(lC)['authorization']).toBeUndefined();
    });
  }
});
