// Generates the literal closure table `test/legs-carrier-closures.json` that the trusted bootstrap and the
// mutation-legs drivers verify before, during and after every run (tayo #rezo 66957/67038/67076).
//
//   node test/legs-carrier-closures.generate.mjs > test/legs-carrier-closures.json
//
// Deterministic on identical bytes: reviewers regenerate and diff. Contents: per-carrier static ESM closure
// (esbuild metafile, node_modules externalised) with a full sha per file; tool identities (env, sh, the Node
// binary, curl and its dylibs, esbuild, pgrep as optional diagnostic); runtime package aggregates; config
// closure (tsconfig, absent config candidates, no package.json vitest key); the frozen environment allowlist;
// and every child-process creation site reachable by the carriers (none may escape the process group).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { aggregateDirectory, scanChildProcessSites, sha256File } from './legs-admission.mjs';

const ROOT = process.cwd();
const CARRIERS = [
  'test/a-plus-curl-redirect-method-parity.test.ts',
  'test/a-plus-curl-lifecycle-ownership.test.ts',
  'test/a-plus-dns-cache-transport.test.ts',
  'test/a-plus-http-timeout-concurrency.test.ts',
  'test/a-plus-http2-staged-timeouts.test.ts',
  'test/a-plus-lifecycle-hook-containment.test.ts',
  'test/a-plus-hook-overrun-deadline.test.ts',
  'test/a-plus-stealth-wire-fidelity.test.ts',
  'test/a-plus-stealth-identity-isolation.test.ts',
  'test/a-plus-stealth-route-parity.test.ts',
  'test/a-plus-stealth-entry-shape.test.ts',
  'test/a-plus-stealth-proxy-connect.test.ts',
  'test/a-plus-curl-argument-fidelity.test.ts',
  'test/a-plus-fetch-connect-phase.test.ts',
  'test/a-plus-fetch-facade-close.test.ts',
  'test/a-plus-fetch-redirect-visibility.test.ts',
  'test/a-plus-fetch-partial-body-salvage.test.ts',
  'test/a-plus-http-manual-redirect-facade.test.ts',
  'test/a-plus-proxy-scheme-classification.test.ts',
  'test/a-plus-http-stream-status-decision.test.ts',
  'test/a-plus-http-wait-cancellation.test.ts',
  'test/a-plus-relative-url-resolution.test.ts',
  'test/a-plus-http2-stream-facade-contract.test.ts',
  'test/a-plus-terminal-header-visibility.test.ts',
  'test/a-plus-stealth-declaration-resolution.test.ts',
  'test/a-plus-curl-facade-contract.test.ts',
  'test/a-plus-edge-entry-resolution.test.ts',
];
const PACKAGES = ['vitest', 'vite', 'vite-node', 'tinypool', 'esbuild', '@esbuild/darwin-arm64', 'rollup', '@rollup/rollup-darwin-arm64', 'tsx', 'tough-cookie', 'tldts'];
const CONFIG_CANDIDATES = ['vitest.config', 'vite.config', 'vitest.workspace'].flatMap((stem) => ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts', 'json'].map((ext) => `${stem}.${ext}`));
const fail = (message) => { console.error(`closures generator: ${message}`); process.exit(2); };

const ESBUILD = 'node_modules/.bin/esbuild';
const esbuildReal = realpathSync(resolve(ROOT, ESBUILD));
const esbuildVersion = execFileSync(esbuildReal, ['--version'], { encoding: 'utf8' }).trim();
const esbuildArgs = (entry, metafile) => [entry, '--bundle', `--metafile=${metafile}`, '--outfile=/dev/null', '--platform=node', '--format=esm', '--packages=external', '--log-level=error'];
// Dynamic build inputs a carrier executes at runtime without importing them statically
// (DECISION-064 → A, corrected scope): ER-10/ER-13 run the real `scripts/bundle.ts` build, which
// READS far more than its own import graph — it transpiles every `src` TypeScript file as data,
// resolves declarations through `tsconfig.bundle.json` (extending `tsconfig.json`), reads
// `package.json` (with `bun.lock` freezing the toolchain that resolves) and copies
// README/LICENSE/assets into the pack. The edge carrier's authenticated closure therefore carries
// the FULL set of files the build reads — dynamic build inputs never sit outside the table.
const srcTranspileInputs = () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(relative(ROOT, abs));
    }
  };
  walk(resolve(ROOT, 'src'));
  return files;
};
const assetFiles = () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs); else if (entry.isFile()) files.push(relative(ROOT, abs));
    }
  };
  walk(resolve(ROOT, 'assets'));
  return files;
};
const DYNAMIC_INPUTS = {
  'test/a-plus-edge-entry-resolution.test.ts': () => [
    ...walkEntry('scripts/bundle.ts'),
    ...srcTranspileInputs(),
    'tsconfig.bundle.json', 'tsconfig.json', 'package.json', 'bun.lock', 'README.md', 'LICENSE',
    ...assetFiles(),
  ],
};

const metaDir = mkdtempSync(join(tmpdir(), 'legs-closures-'));
const walkEntry = (entry) => {
  const metafile = join(metaDir, `${entry.replace(/[\\/]/gu, '__')}.json`);
  execFileSync(esbuildReal, esbuildArgs(entry, metafile), { cwd: ROOT });
  return Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs).filter((path) => !path.startsWith('node_modules/'));
};
const carriers = {};
for (const entry of CARRIERS) {
  const inputs = [...new Set([...walkEntry(entry), ...(DYNAMIC_INPUTS[entry]?.() ?? [])])].sort();
  carriers[entry] = { count: inputs.length, files: inputs.map((path) => ({ path, sha256: sha256File(resolve(ROOT, path)) })) };
}
const union = [...new Set(Object.values(carriers).flatMap((carrier) => carrier.files.map((file) => file.path)))].sort();

const tool = (path, extra = {}) => { const realpath = realpathSync(path); return { path, realpath, sha256: sha256File(realpath), ...extra }; };
const curlVersionLine = execFileSync('/opt/local/bin/curl', ['--version'], { encoding: 'utf8' }).split('\n')[0];
const curlDylibs = execFileSync('/usr/bin/otool', ['-L', '/opt/local/bin/curl'], { encoding: 'utf8' }).split('\n').slice(1)
  .map((line) => line.trim().split(' ')[0]).filter((path) => path !== '' && existsSync(path))
  .map((path) => ({ path: realpathSync(path), sha256: sha256File(realpathSync(path)) }));
const tools = {
  env: tool('/usr/bin/env'),
  sh: tool('/bin/sh'),
  node: tool(process.execPath, { version: process.version }),
  curl: tool('/opt/local/bin/curl', { versionLine: curlVersionLine, dylibs: curlDylibs }),
  esbuild: tool(resolve(ROOT, ESBUILD), { version: esbuildVersion }),
  pgrep: { path: '/usr/bin/pgrep', realpath: '/usr/bin/pgrep', sha256: existsSync('/usr/bin/pgrep') ? sha256File('/usr/bin/pgrep') : null, optional: true, role: 'diagnostic only — never decides the census' },
};

// The build/pack toolchain ER-10/ER-13 actually execute (DECISION-064 → A): bun runs
// `scripts/bundle.ts` (absolute path from the account home, PATH-independent), bunx (beside bun)
// runs dts-bundle-generator, npm packs the staged lib and tar extracts the tarball — npm and tar
// resolve along the frozen boundary PATH. Each is pinned by realpath + sha; the runtime verifier
// additionally re-resolves npm/tar on the frozen PATH and refuses any drift.
const BUN_HOME_PATH = join(userInfo().homedir, '.bun/bin/bun');
const buildTools = {
  bun: tool(BUN_HOME_PATH, { version: execFileSync(BUN_HOME_PATH, ['--version'], { encoding: 'utf8' }).trim() }),
  bunx: tool(join(userInfo().homedir, '.bun/bin/bunx')),
  npm: tool('/opt/homebrew/bin/npm', { version: execFileSync('/opt/homebrew/bin/npm', ['--version'], { encoding: 'utf8' }).trim() }),
  tar: tool('/usr/bin/tar'),
  dtsBundleGenerator: tool(resolve(ROOT, 'node_modules/dts-bundle-generator/dist/bin/dts-bundle-generator.js')),
};

// External roots the real build depends on beyond the repository files: the repository
// node_modules (the toolchain and symlinked runtime dependencies of the packed install) and the
// global npm installation that `npm pack` executes. Aggregated file-by-file like the packages.
const externalRoots = {
  // `.vite` is Vitest's own cache — RUNNER OUTPUT, not build input; hashing it would let the
  // closure self-invalidate during its own run (tayo, DECISION-064 execution review). The
  // exclusion is recorded here and re-applied identically by the runtime verifier.
  repoNodeModules: { path: 'node_modules', excluded: ['.vite'], ...aggregateDirectory(resolve(ROOT, 'node_modules'), { excludeTopLevel: ['.vite'] }) },
  globalNpm: { path: '/opt/homebrew/lib/node_modules/npm', excluded: [], ...aggregateDirectory('/opt/homebrew/lib/node_modules/npm') },
};

const packages = {};
for (const name of PACKAGES) {
  const dir = resolve(ROOT, 'node_modules', name);
  if (!existsSync(dir)) fail(`package ${name} is not installed`);
  packages[name] = { version: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, ...aggregateDirectory(dir) };
}

for (const candidate of CONFIG_CANDIDATES) if (existsSync(resolve(ROOT, candidate))) fail(`config candidate present: ${candidate}`);
if ('vitest' in JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))) fail('package.json carries a vitest key');
const sites = scanChildProcessSites(ROOT, union);
for (const site of sites) if (site.detached) fail(`escaping child-process site ${site.file}:${site.line}`);

const table = {
  schema: 'rezo.legs.carrier-closures/v3.2',
  method: 'per-carrier static ESM import graph from the esbuild metafile (node_modules externalised) with a full sha per file, plus the declared dynamic build closure for the edge carrier (every file `scripts/bundle.ts` reads: all src transpile inputs, both tsconfigs, package.json, bun.lock, README/LICENSE/assets); executed build-tool pins (bun/bunx/npm/tar/dts-bundle-generator by realpath+sha, npm/tar re-resolved on the frozen PATH at verification); external root aggregates (repo node_modules, global npm installation); runtime package aggregates; config discovery closed (no vitest/vite config candidate, no package.json vitest key, explicit CLI only). Boundary stated, not claimed away: variable-specifier dynamic imports and unlisted runtime inputs are outside this table; any unresolved load or config is a refusal, never an assumption.',
  generator: { file: 'test/legs-carrier-closures.generate.mjs', node: { realpath: tools.node.realpath, version: process.version, sha256: tools.node.sha256 }, esbuild: { realpath: esbuildReal, version: esbuildVersion, sha256: tools.esbuild.sha256 }, argsTemplate: esbuildArgs('<entry>', '<metafile>') },
  env: { PATH: '/opt/homebrew/bin:/opt/local/bin:/usr/bin:/bin', fixed: { TZ: 'UTC', LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' }, freshPerRun: ['HOME', 'TMPDIR', 'CURL_HOME', 'XDG_CONFIG_HOME'], boundary: '/usr/bin/env -i with exactly the allowlist; no preload-affecting key can exist' },
  configs: { tsconfig: { path: 'tsconfig.json', sha256: sha256File(resolve(ROOT, 'tsconfig.json')) }, absentConfigCandidates: CONFIG_CANDIDATES, packageJsonVitestKey: false },
  tools,
  buildTools,
  externalRoots,
  packages,
  containment: { rule: 'every child-process creation site reachable by the carriers is frozen here; detached:true / setsid within 8 lines of a site is an escape; any new, missing or escaping site refuses the run', scannedFiles: union.length, sites },
  carriers,
  union: { count: union.length },
};
process.stdout.write(`${JSON.stringify(table, null, 1)}\n`);
