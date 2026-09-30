// Edge entry resolution — the package's default import must select the
// worker platform (Fetch adapter) on edge runtimes, not the browser/XHR
// platform: Cloudflare's workerd resolves with conditions
// `workerd, worker, browser`, Vercel Edge with `edge-light, worker, browser`,
// and `exports["."]` names `workerd` + `edge-light` before `browser` (broad
// `worker` deliberately absent — browser web-worker bundlers set it too and
// keep the browser platform; bare `types` after the condition blocks). The
// rows pin the resolutions that must not move — condition order is
// load-bearing. RED-first history: ER-01/ER-02 and ER-07 were red until the
// edge conditions were inserted (2026-08-31; the original insertion carried
// broad `worker`, dropped in the reviewer wave). ER-13 witnesses the packed
// TypeScript declaration selection for the `"."` ordering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// The exports map is this carrier's static input as well as its probed one: the
// admission legs mutate exactly `package.json`, and a leg's mutated file must
// sit in the carrier's frozen static closure, not only behind a runtime read.
import packageJson from '../package.json';
// @ts-expect-error — untyped ESM fixture
import { packStealth } from './fixtures/stealth/entry-shape.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface ResolutionCase { id: string; title: string; conditions: string[]; expected: string }
const RESOLUTION_CASES: ResolutionCase[] = [
  { id: 'ER-01', title: 'cloudflare workers (workerd, worker, browser) resolve the worker platform', conditions: ['workerd', 'worker', 'browser'], expected: 'dist/platform/worker.js' },
  { id: 'ER-02', title: 'vercel edge (edge-light, worker, browser) resolves the worker platform', conditions: ['edge-light', 'worker', 'browser'], expected: 'dist/platform/worker.js' },
  { id: 'ER-03', title: 'browsers keep resolving the browser platform', conditions: ['browser'], expected: 'dist/platform/browser.js' },
  { id: 'ER-04', title: 'deno keeps resolving the shared index', conditions: ['deno'], expected: 'dist/index.js' },
  { id: 'ER-05', title: 'bun keeps resolving the shared index', conditions: ['bun'], expected: 'dist/index.js' },
  { id: 'ER-06', title: 'bare node keeps resolving the shared index', conditions: [], expected: 'dist/index.js' },
];

let consumerDirectory: string;
/** `stealth-packed-*` stages this run created via packStealth — removed with absence proof in teardown. */
const packedStages = new Set<string>();

/**
 * packStealth with failure-safe stage registration: a THROWING pack (bundle or
 * npm failure) has already created its `stealth-packed-*` temp stage before the
 * throw, so `packedStages.add(dirname(tarball))` alone would leak it. The
 * stage set is therefore discovered by a before/after tmpdir diff in `finally`
 * — every stage this call created is registered for the afterAll absence-proof
 * removal even when no tarball was ever returned.
 */
const trackedPackStealth = (): { installDir: string; packageDir: string; tarball: string } => {
  const stagesBefore = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('stealth-packed-')));
  try {
    const packed = packStealth(REPO_ROOT) as { installDir: string; packageDir: string; tarball: string };
    packedStages.add(dirname(packed.tarball));
    return packed;
  } finally {
    for (const name of readdirSync(tmpdir())) {
      if (name.startsWith('stealth-packed-') && !stagesBefore.has(name)) packedStages.add(join(tmpdir(), name));
    }
  }
};

beforeAll(async () => {
  consumerDirectory = await mkdtemp(join(tmpdir(), 'rezo-edge-resolution-'));
  await mkdir(join(consumerDirectory, 'node_modules'), { recursive: true });
  await symlink(REPO_ROOT, join(consumerDirectory, 'node_modules', 'rezo'), 'dir');
});

afterAll(async () => {
  try {
    if (consumerDirectory) await rm(consumerDirectory, { recursive: true, force: true });
  } finally {
    for (const stage of packedStages) {
      await rm(stage, { recursive: true, force: true });
      expect(existsSync(stage), `packed stage ${stage} survived cleanup`).toBe(false);
    }
  }
});

// Resolution semantics under test are Node's, so the probe always spawns the
// `node` binary (never Bun) with the case's conditions.
function resolvePackageEntry(conditions: string[]): string {
  const flags = conditions.flatMap((condition) => ['--conditions', condition]);
  const probe = spawnSync('node', [...flags, '--input-type=module', '-e', "process.stdout.write(import.meta.resolve('rezo'))"], {
    cwd: consumerDirectory,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (probe.status !== 0) throw new Error(`resolution probe failed (${probe.status}): ${probe.stderr}`);
  const resolvedPath = fileURLToPath(probe.stdout.trim());
  return resolvedPath.split(`${sep}rezo${sep}`).pop()!.split(sep).join('/');
}

describe('edge entry resolution', () => {
  for (const { id, title, conditions, expected } of RESOLUTION_CASES) {
    it(`${id} ${title}`, () => {
      expect(resolvePackageEntry(conditions)).toBe(expected);
    });
  }

  it('ER-07 exports["."] names the edge conditions before browser, with bare types after the condition blocks', () => {
    const manifest = packageJson as unknown as {
      exports: { '.': Record<string, unknown>; './stealth': Record<string, unknown> };
    };
    // The bare `worker` condition is deliberately absent: browser web-worker
    // bundlers set it too, and those consumers keep the browser platform.
    // Bare `types` sits after the condition blocks so a TypeScript project
    // resolving with an edge condition reaches that block's nested types
    // (the packed-stealth-types exports-order ruling, applied here).
    expect(Object.keys(manifest.exports['.'])).toEqual([
      'deno', 'bun', 'react-native', 'workerd', 'edge-light', 'browser', 'types', 'import', 'require', 'default',
    ]);
    expect(Object.keys(manifest.exports['./stealth'])).toEqual([
      'react-native', 'browser', 'workerd', 'edge-light', 'types', 'import', 'require',
    ]);
  });

  it('ER-13 packed TypeScript resolution: both edge condition sets select the worker platform declaration', () => {
    const ts = require('typescript') as typeof import('typescript');
    const packedInstall = trackedPackStealth();
    const resolveRootDeclaration = (customConditions: string[]): string => {
      const options: import('typescript').CompilerOptions = {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        customConditions,
      };
      const result = ts.resolveModuleName('rezo', join(packedInstall.installDir, 'consumer.ts'), options, ts.sys);
      const file = result.resolvedModule?.resolvedFileName ?? '<unresolved>';
      return file.slice(file.indexOf('/node_modules/rezo/') + '/node_modules/rezo/'.length);
    };
    // A leading bare `types` would make BOTH sets select dist/index.d.ts — this
    // row is the declaration-ordering witness for exports["."].
    expect(resolveRootDeclaration(['workerd', 'worker', 'browser'])).toBe('dist/platform/worker.d.ts');
    expect(resolveRootDeclaration(['edge-light', 'worker', 'browser'])).toBe('dist/platform/worker.d.ts');
    // The explicit timeout covers the first cold `npm pack` + install under any
    // runner's default budget (bun test defaults to 5s; the pack takes ~9s).
  }, 300_000);

  it('ER-09 the stealth subpath resolves its universal build under edge conditions (never the node:tls entry)', () => {
    const flags = ['workerd', 'worker'].flatMap((condition) => ['--conditions', condition]);
    const probe = spawnSync('node', [...flags, '--input-type=module', '-e', "process.stdout.write(import.meta.resolve('rezo/stealth'))"], {
      cwd: consumerDirectory,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (probe.status !== 0) throw new Error(`stealth resolution probe failed (${probe.status}): ${probe.stderr}`);
    const resolvedPath = fileURLToPath(probe.stdout.trim());
    expect(resolvedPath.split(`${sep}rezo${sep}`).pop()!.split(sep).join('/')).toBe('dist/stealth/universal.js');
  });

  it('ER-11 the stealth subpath resolves its universal build under edge-light (the workerd row alone does not cover it)', () => {
    const flags = ['edge-light', 'worker'].flatMap((condition) => ['--conditions', condition]);
    const probe = spawnSync('node', [...flags, '--input-type=module', '-e', "process.stdout.write(import.meta.resolve('rezo/stealth'))"], {
      cwd: consumerDirectory,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (probe.status !== 0) throw new Error(`stealth edge-light probe failed (${probe.status}): ${probe.stderr}`);
    const resolvedPath = fileURLToPath(probe.stdout.trim());
    expect(resolvedPath.split(`${sep}rezo${sep}`).pop()!.split(sep).join('/')).toBe('dist/stealth/universal.js');
  });

  it('ER-12 broad-worker fallback: worker+browser without an edge condition keeps the BROWSER platform', () => {
    // Browser web-worker bundlers set `worker` alongside `browser`; the
    // deliberate absence of a broad `worker` key in exports["."] means those
    // consumers must keep the browser platform — pinned here as behavior.
    expect(resolvePackageEntry(['worker', 'browser'])).toBe('dist/platform/browser.js');
  });

  it('ER-10 the built worker entries execute, from the repo dist when whole or a real packed build otherwise — never vacuously', async () => {
    // No skip and no vacuous branch: the row always executes BOTH built worker
    // artifacts. Preference order — the repository's own dist pair when BOTH
    // are regular non-symlink files; a lone half (XOR) refuses with the
    // partial-pair reason; with neither present, the real packStealth
    // build+pack produces the artifacts (its `scripts/bundle.ts` run also
    // refreshes the repo's gitignored `lib/` staging directory — a
    // pre-existing side effect of the shared pack fixture, disclosed here),
    // and a failed build or a missing packed artifact refuses.
    const regularFile = (path: string): boolean => {
      try { return lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(); } catch { return false; }
    };
    const repoJs = resolve(REPO_ROOT, 'dist/platform/worker.js');
    const repoCjs = resolve(REPO_ROOT, 'dist/platform/worker.cjs');
    const repoHasJs = regularFile(repoJs);
    const repoHasCjs = regularFile(repoCjs);
    let workerJs: string;
    let workerCjs: string;
    if (repoHasJs && repoHasCjs) {
      workerJs = repoJs;
      workerCjs = repoCjs;
    } else if (repoHasJs !== repoHasCjs) {
      throw new Error(`ER-10 refuses a partial dist pair: worker.js present=${repoHasJs}, worker.cjs present=${repoHasCjs}`);
    } else {
      const packedInstall = trackedPackStealth();
      workerJs = join(packedInstall.packageDir, 'dist/platform/worker.js');
      workerCjs = join(packedInstall.packageDir, 'dist/platform/worker.cjs');
      if (!regularFile(workerJs) || !regularFile(workerCjs)) {
        throw new Error(`ER-10 refuses: the packed build lacks a worker artifact (js=${regularFile(workerJs)}, cjs=${regularFile(workerCjs)})`);
      }
    }
    const surfaceCheck = (moduleExpr: string) => `
      const mod = ${moduleExpr};
      const d = mod.default ?? mod;
      if (typeof d.get !== 'function') throw new Error('default .get missing');
      if (typeof d.create !== 'function') throw new Error('default .create missing');
      if (typeof mod.Rezo !== 'function') throw new Error('named Rezo missing');
      if (typeof mod.RezoError !== 'function') throw new Error('named RezoError missing');
      if (typeof mod.VERSION !== 'string') throw new Error('named VERSION missing');
    `;
    const esm = spawnSync('node', ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(workerJs).href)});${surfaceCheck('m')}process.stdout.write('ER10-ESM-OK');`,
    ], { encoding: 'utf8', timeout: 60000 });
    const cjs = spawnSync('node', ['-e',
      `const m = require(${JSON.stringify(workerCjs)});${surfaceCheck('m')}process.stdout.write('ER10-CJS-OK');`,
    ], { encoding: 'utf8', timeout: 60000 });
    expect({ status: esm.status, signal: esm.signal, error: esm.error, stderr: esm.stderr, stdout: esm.stdout })
      .toEqual({ status: 0, signal: null, error: undefined, stderr: '', stdout: 'ER10-ESM-OK' });
    expect({ status: cjs.status, signal: cjs.signal, error: cjs.error, stderr: cjs.stderr, stdout: cjs.stdout })
      .toEqual({ status: 0, signal: null, error: undefined, stderr: '', stdout: 'ER10-CJS-OK' });
  }, 400_000);

  it('ER-08 the worker platform source bundles for the edge without node builtins and carries only the fetch adapter', async () => {
    const result = await build({
      entryPoints: [resolve(REPO_ROOT, 'src/platform/worker.ts')],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      conditions: ['workerd', 'worker'],
      logLevel: 'silent',
      plugins: [{
        name: 'reject-node-builtins',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^node:/ }, (args) => ({
            errors: [{ text: `node builtin ${args.path} reached the edge bundle via ${args.importer}` }],
          }));
        },
      }],
    });
    const inputs = Object.keys(result.metafile!.inputs).map((path) => path.split(sep).join('/'));
    expect({
      fetchAdapter: inputs.some((path) => path.endsWith('src/adapters/fetch.ts')),
      xhrAdapter: inputs.some((path) => path.endsWith('src/adapters/xhr.ts')),
      httpAdapter: inputs.some((path) => path.endsWith('src/adapters/http.ts')),
      errors: result.errors.length,
    }).toEqual({ fetchAdapter: true, xhrAdapter: false, httpAdapter: false, errors: 0 });
  });
});
