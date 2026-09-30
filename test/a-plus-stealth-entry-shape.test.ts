/**
 * ESH — public `./stealth` entry shape carrier (PLAN/stealth-wire-fidelity v4, phase 1).
 *
 * The public subpath must resolve and work on every advertised runtime with the same named surface: browser and
 * Worker bundles (ESH-01/02, executed in the pinned Chrome for Testing 146: ESH-05 page, ESH-08 Dedicated
 * Worker), Deno importing the packed tarball's public subpath (ESH-03), the React-Native condition with the
 * call-time typed TLS refusal (ESH-04), the packed artifact on Node and Bun (ESH-06), and declaration / named
 * export roster parity (ESH-07). Rows never skip: a missing tool fails the row with its path.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { BUN_PATH, CHROME_PATH, DENO_PATH, bundleStealthEntry, declaredExports, packStealth, pageForBundle, runInChrome, workerForBundle } from './fixtures/stealth/entry-shape.mjs';
// The two source entries and the exports map are observed statically here as well as through the bundles and the pack:
// the carrier's import graph must name every file its rows judge (the admission legs mutate exactly those files).
import * as nodeEntry from '../src/stealth/index';
import * as universalEntry from '../src/stealth/universal';
import packageJson from '../package.json';

const ROOT = process.cwd();
/** The frozen public roster of `rezo/stealth` (values and types) — every target must expose exactly these names. */
export const STEALTH_VALUE_ROSTER = ['RezoStealth', 'createSecureContext', 'buildTlsOptions', 'resolveProfile', 'detectProfileFromUserAgent', 'getProfile', 'getProfilesByFamily', 'getProfilesByDevice', 'getRandomProfile', 'getRandomProfileByFamily', 'listProfiles', 'listProfilesByFamily', 'PROFILE_REGISTRY'].sort();
export const STEALTH_TYPE_ROSTER = ['BrowserProfileName', 'RezoStealthOptions', 'ResolvedStealthProfile', 'BrowserProfile', 'TlsFingerprint', 'Http2Settings', 'ClientHints', 'NavigatorProperties'].sort();

/** A Node builtin reaches a bundle only as a module specifier; the string alone also appears in error-classification tables. */
const importsNodeBuiltin = (code: string) => /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']node:[a-z_/]+["']/u.test(code) || /^\s*import\s+["']node:[a-z_/]+["']/mu.test(code);
const bundles = new Map<string, ReturnType<typeof bundleStealthEntry>>();
const bundle = (key: string, options: { conditions: string[]; platform: 'browser' | 'neutral' | 'node' }) => { if (!bundles.has(key)) bundles.set(key, bundleStealthEntry(ROOT, options)); return bundles.get(key)!; };
const browserBundle = () => bundle('browser', { conditions: ['browser'], platform: 'browser' });
const workerBundle = () => bundle('worker', { conditions: ['workerd', 'worker', 'browser'], platform: 'browser' });
const reactNativeBundle = () => bundle('react-native', { conditions: ['react-native'], platform: 'neutral' });

it('ESH-01 the public ./stealth entry bundles for the browser condition without a Node builtin', async () => {
  const result = await browserBundle();
  expect(result.errors, `target ${result.target}`).toEqual([]);
  expect(result.code).toBeTruthy();
  expect(importsNodeBuiltin(result.code!), 'a node: module specifier survived in the bundle').toBe(false);
});

it('ESH-02 the public ./stealth entry bundles for the worker conditions without a Node builtin', async () => {
  const result = await workerBundle();
  expect(result.errors, `target ${result.target}`).toEqual([]);
  expect(importsNodeBuiltin(result.code!), 'a node: module specifier survived in the bundle').toBe(false);
});

it('ESH-03 Deno imports the public subpath from the packed tarball and resolves a profile (control)', () => {
  expect(existsSync(DENO_PATH), `deno missing at ${DENO_PATH}`).toBe(true);
  const packedInstall = packStealth(ROOT);
  const script = join(packedInstall.installDir, 'deno-entry.mjs');
  writeFileSync(script, "import { listProfiles, resolveProfile } from 'rezo/stealth';\nconsole.log(JSON.stringify({ count: listProfiles().length, userAgent: resolveProfile('chrome-131').defaultHeaders['user-agent'] }));\n");
  const run = spawnSync(DENO_PATH, ['run', '-A', '--node-modules-dir=manual', '--no-lock', script], { cwd: packedInstall.installDir, encoding: 'utf8', timeout: 60_000 });
  expect(run.status, `deno exit ${run.status}: ${run.stderr.slice(-500)}`).toBe(0);
  const report = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}');
  expect(report.count).toBeGreaterThan(0);
  expect(report.userAgent).toContain('Chrome/131');
});

it('ESH-04 the react-native condition resolves a universal target whose TLS constructors refuse at call time with REZ_UNSUPPORTED_CAPABILITY', async () => {
  const result = await reactNativeBundle();
  expect(result.errors, `target ${result.target}`).toEqual([]);
  expect(importsNodeBuiltin(result.code!), 'a node: module specifier survived in the bundle').toBe(false);
  const dataUrl = `data:text/javascript;base64,${Buffer.from(result.code!, 'utf8').toString('base64')}`;
  const mod = await import(dataUrl) as Record<string, (...args: unknown[]) => unknown>;
  expect(Object.keys(mod).filter((k) => STEALTH_VALUE_ROSTER.includes(k)).sort()).toEqual(STEALTH_VALUE_ROSTER);
  const resolved = (mod.resolveProfile as (id: string) => { tls: unknown }).call(null, 'chrome-131');
  let thrown: { code?: string } | null = null;
  try { mod.createSecureContext(resolved.tls); } catch (error) { thrown = error as { code?: string }; }
  expect(thrown?.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
});

it('ESH-05 Chrome 146 executes the browser bundle on a page: the resolver works and the TLS constructor refuses typed', async () => {
  expect(existsSync(CHROME_PATH), `Chrome for Testing 146 missing at ${CHROME_PATH}`).toBe(true);
  const built = await browserBundle();
  expect(built.errors).toEqual([]);
  const report = await runInChrome({ page: pageForBundle(built.code!) }) as { ok?: boolean; error?: string; count?: number; userAgent?: string; tlsCall?: { code?: string } | string };
  expect(report.ok, report.error).toBe(true);
  expect(report.count).toBeGreaterThan(0);
  expect(report.userAgent).toContain('Chrome/131');
  expect(typeof report.tlsCall === 'object' && report.tlsCall?.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
});

it('ESH-06 the packed tarball resolves rezo/stealth on Node and Bun through the published exports map and resolves a profile (control)', () => {
  const packedInstall = packStealth(ROOT);
  const script = join(packedInstall.installDir, 'node-entry.mjs');
  writeFileSync(script, "import { listProfiles, resolveProfile, createSecureContext } from 'rezo/stealth';\nconst resolved = resolveProfile('chrome-131');\nconsole.log(JSON.stringify({ count: listProfiles().length, userAgent: resolved.defaultHeaders['user-agent'], secureContext: typeof createSecureContext(resolved.tls) }));\n");
  for (const [label, command] of [['node', process.execPath], ['bun', BUN_PATH]] as const) {
    expect(existsSync(command), `${label} missing at ${command}`).toBe(true);
    const run = spawnSync(command, [script], { cwd: packedInstall.installDir, encoding: 'utf8', timeout: 60_000 });
    expect(run.status, `${label} exit ${run.status}: ${run.stderr.slice(-500)}`).toBe(0);
    const report = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}');
    expect(report.count, label).toBeGreaterThan(0);
    expect(report.userAgent, label).toContain('Chrome/131');
    expect(report.secureContext, label).toBe('object');
  }
});

it('ESH-07 declaration and named-export roster parity on every published ./stealth target', () => {
  const packedInstall = packStealth(ROOT);
  const exportsMap = packedInstall.installedPackage.exports?.['./stealth'] as Record<string, unknown>;
  expect(exportsMap, 'exports["./stealth"] missing from the packed package.json').toBeDefined();
  const targets = new Set<string>();
  const walk = (target: unknown): void => { if (typeof target === 'string') { if (target.endsWith('.d.ts')) targets.add(target); } else if (target && typeof target === 'object') Object.values(target).forEach(walk); };
  walk(exportsMap);
  expect(targets.size).toBeGreaterThan(0);
  for (const target of targets) {
    const path = join(packedInstall.packageDir, target);
    expect(existsSync(path), `${target} missing`).toBe(true);
    const names = declaredExports(path);
    expect(STEALTH_VALUE_ROSTER.filter((name) => !names.includes(name)), `${target} lacks values`).toEqual([]);
    expect(STEALTH_TYPE_ROSTER.filter((name) => !names.includes(name)), `${target} lacks types`).toEqual([]);
  }
  const source = readFileSync(join(ROOT, 'src/stealth/index.ts'), 'utf8');
  for (const name of [...STEALTH_VALUE_ROSTER, ...STEALTH_TYPE_ROSTER]) expect(source.includes(name), `src/stealth/index.ts no longer exports ${name}`).toBe(true);
  // Both source entries expose the same value roster, and the published exports map keeps the ruled condition order.
  const rosterOf = (entry: Record<string, unknown>) => Object.keys(entry).filter((name) => STEALTH_VALUE_ROSTER.includes(name)).sort();
  expect(rosterOf(nodeEntry as Record<string, unknown>)).toEqual([...STEALTH_VALUE_ROSTER].sort());
  expect(rosterOf(universalEntry as Record<string, unknown>)).toEqual([...STEALTH_VALUE_ROSTER].sort());
  // The runtime blocks precede the top-level `types`: TypeScript matches export conditions in key order, so a leading `types` made
  // every condition set resolve the Node declaration (SDR-02/03/06 prove the corrected order on the packed artifact, 2026-08-29).
  // 2026-08-31: `workerd` and `edge-light` joined the runtime blocks so edge runtimes resolve the universal build (ER-09 proves it).
  expect(Object.keys((packageJson as { exports: Record<string, Record<string, unknown>> }).exports['./stealth'])).toEqual(['react-native', 'browser', 'workerd', 'edge-light', 'types', 'import', 'require']);
});

it('ESH-08 Chrome 146 executes the worker bundle inside a Dedicated Worker', async () => {
  expect(existsSync(CHROME_PATH), `Chrome for Testing 146 missing at ${CHROME_PATH}`).toBe(true);
  const page = await browserBundle(); const worker = await workerBundle();
  expect(page.errors).toEqual([]); expect(worker.errors).toEqual([]);
  const report = await runInChrome({ page: pageForBundle(page.code!, { withWorker: true }), worker: workerForBundle(worker.code!) }) as { ok?: boolean; error?: string; worker?: { ok?: boolean; error?: string; count?: number; userAgent?: string } };
  expect(report.ok, report.error).toBe(true);
  expect(report.worker?.ok, report.worker?.error).toBe(true);
  expect(report.worker?.count).toBeGreaterThan(0);
  expect(report.worker?.userAgent).toContain('Firefox/133');
});
