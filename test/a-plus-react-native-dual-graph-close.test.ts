/**
 * DG — dual-graph stream close carrier (DECISION-063 B, Phase 1; closes residual 11).
 *
 * A dual CJS/ESM build gives the stream facade a second class identity, so any
 * `facade instanceof StreamResponse` gate inside the adapter graph is FALSE for a facade the root
 * graph created — the historical settlement close skipped exactly there. The shipped fix closes at
 * the emission site in `executeNativeStreamRequest`'s deferred success path, with no type sniff.
 *
 * DG-01/02 (HEAD mixed, both directions) are the standing tripwire: restoring any instanceof-gated
 * close turns their exact terminal order from all-five to close-less. DG-03 is the shared-bundle
 * control (`AdapterRezo` from inside the adapter bundle — one graph by construction; the
 * mixed-vs-shared distinction is the proof). DG-04..06 reproduce the witnessed historical RED on the
 * exact `7e77995` archive when `REZO_DUAL_GRAPH_HISTORICAL_ROOT` is armed — the arm FAILS CLOSED on
 * any root whose pinned source blobs mismatch; unarmed, those rows are counted as env-gated skips
 * and are NEVER closure evidence (the closure evidence is the armed battery run). DG-07
 * authenticates every build: realpath-canonicalised metafile inputs with zero cross-era leaks and
 * hashed outputs. The suite runs inside a fail-closed git SHA/status sandwich, keeps an
 * unhandled-rejection ledger, and tears its workspace down with an absence check.
 * Machinery: `test/fixtures/react-native/dual-graph.mjs`.
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error — untyped ESM fixture
import { FULL_ORDER, RED_ORDER, authenticateHistoricalRoot, buildAllGraphs, createWorkspace, destroyWorkspace, drive, gitState, realpathIfExists } from './fixtures/react-native/dual-graph.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const HISTORICAL_ROOT = process.env.REZO_DUAL_GRAPH_HISTORICAL_ROOT ?? '';
const historicalArmed = HISTORICAL_ROOT.length > 0;

interface DriveReport {
  sequence: string[]; errors: string[]; dataEvents: number; dataPayloads: number[][];
  terminalSnapshots: Array<{ terminal: string; releasedAtEmit: boolean; payloadAtEmit: boolean }>;
  provider: { streamCalls: number; chunksDelivered: number; released: boolean };
  finished: boolean; finishedAtClose: boolean | null; returnedIsCaptured: boolean;
  facadeInstanceofFacadeGraph: boolean; facadeInstanceofAdapterGraph: boolean; graphsDistinct: boolean;
}
interface BuiltGraph { module: Record<string, unknown>; bundleSha256: string; inputs: string[]; entryFile: string; eraSrcRoot: string }

let tempDir = '';
let historicalRealRoot = '';
let opening: { head: string; status: string };
const builds = new Map<string, BuiltGraph>();
const rejections: string[] = [];
const onRejection = (reason: unknown) => { rejections.push(String((reason as { message?: string })?.message ?? reason)); };

function graph(key: string): BuiltGraph {
  const built = builds.get(key);
  if (!built) throw new Error(`graph ${key} was not staged in beforeAll`);
  return built;
}

function expectHealthy(report: DriveReport, order: string[], mixed: boolean): void {
  expect(report.sequence, 'exact terminal order').toEqual(order);
  expect(report.finishedAtClose, 'close observes isFinished()===true when it fires; null when close never fires')
    .toBe(order.includes('close') ? true : null);
  expect(report.provider, 'provider entered once, delivered one chunk, released').toEqual({ streamCalls: 1, chunksDelivered: 1, released: true });
  expect(report.terminalSnapshots, 'release and the exact public payload [1] precede EVERY terminal emission')
    .toEqual(order.map((terminal) => ({ terminal, releasedAtEmit: true, payloadAtEmit: true })));
  expect(report.dataPayloads, 'the one native chunk traverses the public data path byte-exact').toEqual([[1]]);
  expect(report.returnedIsCaptured, 'facade identity threads unchanged through the adapter').toBe(true);
  expect(report.facadeInstanceofFacadeGraph, 'facade belongs to its own graph').toBe(true);
  expect(report.facadeInstanceofAdapterGraph, 'facade foreign to the adapter graph iff mixed').toBe(!mixed);
  expect(report.graphsDistinct).toBe(mixed);
  expect({ finished: report.finished, errors: report.errors }).toEqual({ finished: true, errors: [] });
}

beforeAll(async () => {
  opening = gitState(REPO_ROOT);
  process.on('unhandledRejection', onRejection);
  tempDir = createWorkspace(REPO_ROOT);
  if (historicalArmed) historicalRealRoot = authenticateHistoricalRoot(HISTORICAL_ROOT);
  await buildAllGraphs({ cache: builds, tempDir, repoRoot: REPO_ROOT, historicalRoot: historicalArmed ? historicalRealRoot : '' });
});

afterAll(() => {
  try {
    process.off('unhandledRejection', onRejection);
    expect(rejections, 'no unhandled rejections escaped any row').toEqual([]);
    const closing = gitState(REPO_ROOT);
    expect(closing.head, 'working tree HEAD moved during the suite').toBe(opening.head);
    expect(closing.status, 'working tree status changed during the suite (raw porcelain bytes)').toBe(opening.status);
    // Restoration proof: the archived tree must still authenticate byte-exactly AFTER the RED rows ran.
    if (historicalArmed) authenticateHistoricalRoot(HISTORICAL_ROOT);
  } finally {
    if (tempDir) destroyWorkspace(tempDir);
  }
});

describe('react-native dual-graph stream close', () => {
  it('DG-01 HEAD mixed: ESM facade graph × CJS adapter graph publishes the exact five-terminal order', async () => {
    const facade = graph('head-facade-esm');
    const adapter = graph('head-adapter-cjs');
    expectHealthy(await drive({ label: 'head-mixed-a', facadeGraph: facade.module, adapterGraph: adapter.module }), FULL_ORDER, true);
  });

  it('DG-02 HEAD mixed: CJS facade graph × ESM adapter graph publishes the exact five-terminal order', async () => {
    const facade = graph('head-facade-cjs');
    const adapter = graph('head-adapter-esm');
    expectHealthy(await drive({ label: 'head-mixed-b', facadeGraph: facade.module, adapterGraph: adapter.module }), FULL_ORDER, true);
  });

  it('DG-03 HEAD shared-bundle control: AdapterRezo keeps one graph and the full order', async () => {
    const adapter = graph('head-adapter-esm');
    const report = await drive({ label: 'head-control', facadeGraph: adapter.module, adapterGraph: adapter.module, RezoCtor: adapter.module.AdapterRezo });
    expectHealthy(report as DriveReport, FULL_ORDER, false);
  });

  describe.skipIf(!historicalArmed)('historical settlement-gate reproduction (armed via REZO_DUAL_GRAPH_HISTORICAL_ROOT, fail-closed)', () => {
    it('DG-04 OLD mixed: ESM facade × CJS adapter loses ONLY close (RED), finished stays true', async () => {
      const facade = graph('old-facade-esm');
      const adapter = graph('old-adapter-cjs');
      expectHealthy(await drive({ label: 'old-mixed-a', facadeGraph: facade.module, adapterGraph: adapter.module }), RED_ORDER, true);
    });

    it('DG-05 OLD mixed: CJS facade × ESM adapter loses ONLY close (RED), finished stays true', async () => {
      const facade = graph('old-facade-cjs');
      const adapter = graph('old-adapter-esm');
      expectHealthy(await drive({ label: 'old-mixed-b', facadeGraph: facade.module, adapterGraph: adapter.module }), RED_ORDER, true);
    });

    it('DG-06 OLD shared-bundle control: one graph closes fully — the RED above is the identity split alone', async () => {
      const adapter = graph('old-adapter-esm');
      const report = await drive({ label: 'old-control', facadeGraph: adapter.module, adapterGraph: adapter.module, RezoCtor: adapter.module.AdapterRezo });
      expectHealthy(report as DriveReport, FULL_ORDER, false);
    });
  });

  it('DG-07 every built bundle authenticates: each input is the exact entry or inside its own era src, nothing else', () => {
    expect(builds.size).toBeGreaterThan(0);
    const contains = (root: string, path: string): boolean => {
      const rel = relative(root, path);
      return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
    };
    for (const [key, built] of builds) {
      expect(built.bundleSha256, `${key} bundle hash`).toMatch(/^[0-9a-f]{64}$/);
      const strays = built.inputs.filter((p: string) => p !== built.entryFile && !contains(built.eraSrcRoot, p));
      expect(strays, `${key}: every input must be the exact generated entry or inside ${built.eraSrcRoot}`).toEqual([]);
      const srcInputs = built.inputs.filter((p: string) => contains(built.eraSrcRoot, p));
      expect(srcInputs.length, `${key} must read its own era src`).toBeGreaterThan(0);
      expect(built.inputs, `${key} must name its exact generated entry`).toContain(built.entryFile);
    }
  });
});
