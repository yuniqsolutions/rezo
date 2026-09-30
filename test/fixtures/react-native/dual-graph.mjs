// Machinery for the DG dual-graph stream close carrier (DECISION-063 B, Phase 1):
//  - buildAllGraphs: one esbuild invocation per graph (bundle local src, packages external,
//    metafile), every bundle built BEFORE any load so Bun's test runner (which caches a directory's
//    module listing at first resolution) sees the complete set; ESM loads via file-URL dynamic
//    import and CJS via createRequire — the split keeps the carrier valid across the package's
//    declared `node >=22.0.0` floor, where require() of ESM throws until 22.12. Metafile inputs are
//    realpath-canonicalised so containment checks survive macOS /var → /private/var aliasing.
//  - drive: the public `new Rezo({reactNative:{streamTransport}}, observedAdapter).stream()` path
//    through the real deferred publisher — publishSuccess is never called, nothing emits manually;
//    reports the exact terminal ORDER, the provider ledger, and public data traversal.
//  - workspace + git-state helpers with fail-closed subprocess checks, and the historical-root
//    authenticator pinning every source identity the wrappers pull from the `7e77995` archive.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const TERMINALS = ['end', 'finish', 'done', 'complete', 'close'];
export const FULL_ORDER = ['end', 'finish', 'done', 'complete', 'close'];
export const RED_ORDER = ['end', 'finish', 'done', 'complete'];
const URL_BASE = 'https://dual-graph.react-native.rezo.test';

/** Key blobs the wrappers name directly, pinned to the exact `7e77995` bytes. */
const HISTORICAL_PINS = {
  'src/adapters/react-native.ts': '3ee2c78125239abbcb380922c6ccdaf5d3e5bae75075069d1f503462ef429c52',
  'src/core/rezo.ts': '359744266541763452261d2d060041fffacf0ab2f65e3df409361387ad466d27',
  'src/responses/universal/stream.ts': '08310c24e6d8644ef226071a48b659eb364ef178103a7f3fd4a9e50f22211c1f',
};
/**
 * The complete historical `src/**\/*.ts` aggregate under the project's canonical path-NUL-hash
 * algorithm (R16 style: sorted relative paths, each row `path\0sha256\n`, sha256 of the stream) —
 * esbuild consumes transitive local inputs, so the WHOLE tree is what "exact archive" means.
 */
const HISTORICAL_SRC_AGGREGATE = {
  files: 171,
  sha256: '257ea9aaba0f8516f3652b03c40e67e04bfb4180c1f24ce8408f0ae98dce1131',
};

function walkRegularFiles(root, prefix, out) {
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`historical root FAILS CLOSED: ${rel} is a symlink`);
    if (entry.isDirectory()) walkRegularFiles(root, rel, out);
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`historical root FAILS CLOSED: ${rel} is not a regular file or directory`);
  }
  return out;
}

/**
 * Hashes EVERY regular file under `src` (symlinks and specials are refused outright), so an added
 * `.js`/any-extension mutant, a removal, or a byte change all break the pinned identity. At
 * `7e77995` the tree is exactly 171 regular files, every one `.ts`, so the pin stays 171/257ea9aa….
 */
export function srcAggregate(root) {
  const files = walkRegularFiles(root, 'src', []).sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(rel);
    hash.update(Buffer.from([0]));
    hash.update(createHash('sha256').update(readFileSync(join(root, rel))).digest('hex'));
    hash.update('\n');
  }
  return { files: files.length, sha256: hash.digest('hex') };
}

const fileSha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const realpathIfExists = (path) => { try { return realpathSync(path); } catch { return path; } };

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw new Error(`git ${args[0]} failed to spawn: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args[0]} exited ${result.status}: ${result.stderr.slice(-200)}`);
  return result.stdout;
}

/** Raw, unfiltered state: byte-exact opening/closing equality tolerates whatever pre-exists and detects ANY new mutation. */
export function gitState(repoRoot) {
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']).trim();
  const status = runGit(repoRoot, ['status', '--porcelain=v1', '-z']);
  return { head, status };
}

export function createWorkspace(repoRoot) {
  const tempDir = mkdtempSync(join(tmpdir(), 'rezo-dual-graph-'));
  // Bundles keep npm packages external; borrowing the repo's installed set beside the bundles makes
  // raw require, Node ESM, and Bun resolve them identically.
  symlinkSync(join(repoRoot, 'node_modules'), join(tempDir, 'node_modules'), 'dir');
  return tempDir;
}

export function destroyWorkspace(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
  if (existsSync(tempDir)) throw new Error(`workspace ${tempDir} survived cleanup`);
}

/**
 * Fails CLOSED before any build: the COMPLETE historical src aggregate must match the pinned
 * `7e77995` identity (count and hash), the directly named blobs must match byte-exactly, and the
 * settlement gate must be single.
 */
export function authenticateHistoricalRoot(root) {
  const aggregate = srcAggregate(root);
  if (aggregate.files !== HISTORICAL_SRC_AGGREGATE.files || aggregate.sha256 !== HISTORICAL_SRC_AGGREGATE.sha256) {
    throw new Error(`historical root FAILS CLOSED: src aggregate is ${aggregate.files}/${aggregate.sha256}, expected ${HISTORICAL_SRC_AGGREGATE.files}/${HISTORICAL_SRC_AGGREGATE.sha256}`);
  }
  for (const [relative, expected] of Object.entries(HISTORICAL_PINS)) {
    const actual = fileSha(join(root, relative));
    if (actual !== expected) throw new Error(`historical root FAILS CLOSED: ${relative} is ${actual}, expected ${expected}`);
  }
  const gateSites = readFileSync(join(root, 'src/adapters/react-native.ts'), 'utf8').split('instanceof StreamResponse').length - 1;
  if (gateSites !== 1) throw new Error(`historical root FAILS CLOSED: expected exactly 1 settlement-gate site, found ${gateSites}`);
  return realpathIfExists(root);
}

function wrapperSource(kind, sourceRoot) {
  const root = sourceRoot.replace(/\\/g, '/');
  if (kind === 'facade') {
    return `export { Rezo } from '${root}/src/core/rezo';\n`
      + `export { UniversalStreamResponse as FacadeStreamResponse } from '${root}/src/responses/universal/stream';\n`;
  }
  return `export { executeRequest } from '${root}/src/adapters/react-native';\n`
    + `export { UniversalStreamResponse as AdapterStreamResponse } from '${root}/src/responses/universal/stream';\n`
    + `export { Rezo as AdapterRezo } from '${root}/src/core/rezo';\n`;
}

/**
 * Builds EVERY graph bundle before any module load touches the workspace: Bun's test runner caches a
 * directory's module listing at first resolution, so a bundle written after any sibling has loaded
 * resolves as "Cannot find module … from ''". Building the complete set first, then loading, keeps
 * Node, vitest, and `bun test` on identical bytes. ESM then loads via file-URL dynamic import and
 * CJS via require — require() of ESM would throw ERR_REQUIRE_ESM on Node 22.0–22.11, inside the
 * package's declared support floor.
 */
export async function buildAllGraphs({ cache, tempDir, repoRoot, historicalRoot }) {
  const esbuild = require('esbuild');
  const plans = [
    { key: 'head-facade-esm', kind: 'facade', sourceRoot: repoRoot, format: 'esm' },
    { key: 'head-facade-cjs', kind: 'facade', sourceRoot: repoRoot, format: 'cjs' },
    { key: 'head-adapter-esm', kind: 'adapter', sourceRoot: repoRoot, format: 'esm' },
    { key: 'head-adapter-cjs', kind: 'adapter', sourceRoot: repoRoot, format: 'cjs' },
    ...(historicalRoot ? [
      { key: 'old-facade-esm', kind: 'facade', sourceRoot: historicalRoot, format: 'esm' },
      { key: 'old-facade-cjs', kind: 'facade', sourceRoot: historicalRoot, format: 'cjs' },
      { key: 'old-adapter-esm', kind: 'adapter', sourceRoot: historicalRoot, format: 'esm' },
      { key: 'old-adapter-cjs', kind: 'adapter', sourceRoot: historicalRoot, format: 'cjs' },
    ] : []),
  ];
  const staged = [];
  for (const plan of plans) {
    const entry = join(tempDir, `${plan.key}.entry.ts`);
    writeFileSync(entry, wrapperSource(plan.kind, plan.sourceRoot));
    const outfile = join(tempDir, `${plan.key}.${plan.format === 'esm' ? 'mjs' : 'cjs'}`);
    const result = await esbuild.build({
      entryPoints: [entry], outfile, bundle: true, format: plan.format, platform: 'node',
      packages: 'external', metafile: true, logLevel: 'silent', absWorkingDir: repoRoot,
    });
    const inputs = Object.keys(result.metafile.inputs).map((p) => realpathIfExists(resolve(repoRoot, p)));
    staged.push({ key: plan.key, entry, outfile, format: plan.format, sourceRoot: plan.sourceRoot, inputs });
  }
  for (const { key, entry, outfile, format, sourceRoot, inputs } of staged) {
    const module = format === 'esm' ? await import(pathToFileURL(outfile).href) : require(outfile);
    cache.set(key, {
      module, bundleSha256: fileSha(outfile), inputs,
      entryFile: realpathIfExists(entry),
      eraSrcRoot: realpathIfExists(join(sourceRoot, 'src')),
    });
  }
}

function deferred() { let resolveFn; const promise = new Promise((r) => { resolveFn = r; }); return { promise, resolve: resolveFn }; }

async function waitFor(condition, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${label}: condition not reached within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 50));
}

export async function drive({ label, facadeGraph, adapterGraph, RezoCtor }) {
  const sequence = [];
  const errors = [];
  const dataPayloads = [];
  /** One snapshot PER terminal emission, taken inside the listener — proves release and the public
   *  payload preceded every terminal, not merely the final state. */
  const terminalSnapshots = [];
  const provider = { streamCalls: 0, chunksDelivered: 0, released: false };
  const entered = deferred();
  const release = deferred();
  let captured;
  const observedAdapter = (...args) => {
    captured = args[0]?._streamResponse;
    return adapterGraph.executeRequest(...args);
  };
  const streamTransport = {
    name: `dual-graph-${label}`,
    async stream(streamRequest) {
      provider.streamCalls += 1;
      entered.resolve();
      await streamRequest.onChunk(new Uint8Array([1]));
      provider.chunksDelivered += 1;
      await release.promise;
      provider.released = true;
      return {
        status: 200, statusText: 'OK',
        headers: { 'content-type': 'text/plain', 'content-length': '1' },
        finalUrl: `${URL_BASE}/${label}`, contentType: 'text/plain', contentLength: 1,
      };
    },
  };
  const Ctor = RezoCtor ?? facadeGraph.Rezo;
  const rezo = new Ctor({ reactNative: { streamTransport } }, observedAdapter);
  const facade = rezo.stream(`${URL_BASE}/${label}`, { retry: false, cache: false });
  let finishedAtClose = null;
  facade.on('close', () => { finishedAtClose = facade.isFinished(); });
  for (const terminal of TERMINALS) {
    facade.on(terminal, () => {
      sequence.push(terminal);
      terminalSnapshots.push({
        terminal,
        releasedAtEmit: provider.released,
        payloadAtEmit: dataPayloads.length === 1 && dataPayloads[0].length === 1 && dataPayloads[0][0] === 1,
      });
    });
  }
  facade.on('data', (chunk) => { dataPayloads.push(Array.from(chunk ?? [])); });
  facade.on('error', (error) => errors.push(String(error?.message ?? error)));
  await entered.promise;
  release.resolve();
  await waitFor(() => facade.isFinished(), `${label} publish`);
  const FacadeClass = facadeGraph.FacadeStreamResponse ?? facadeGraph.AdapterStreamResponse;
  const AdapterClass = adapterGraph.AdapterStreamResponse;
  return {
    sequence, errors, provider, finishedAtClose, terminalSnapshots,
    dataEvents: dataPayloads.length,
    dataPayloads,
    finished: facade.isFinished(),
    returnedIsCaptured: captured !== undefined && facade === captured,
    facadeInstanceofFacadeGraph: facade instanceof FacadeClass,
    facadeInstanceofAdapterGraph: facade instanceof AdapterClass,
    graphsDistinct: FacadeClass !== AdapterClass,
  };
}
