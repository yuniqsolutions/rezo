// Entry-shape fixtures for the ESH rows (PLAN/stealth-wire-fidelity v4, phase 1):
//  - bundleStealthEntry: bundles the public `./stealth` entry for a condition set, resolving the exports map the way a
//    bundler would (source-level: dist targets are mapped to their src counterparts so the proof runs on today's bytes);
//  - packStealth: builds lib/ with the repository bundler, packs a real tarball, installs it network-free into a fresh
//    directory (tarball extracted under node_modules/rezo, runtime dependencies symlinked from the repository's
//    node_modules) so `rezo/stealth` resolves through the published exports map;
//  - runInChrome: serves a page (and optional worker script) on 127.0.0.1 and executes it in the pinned Chrome for
//    Testing 146 headless; the page reports back over fetch.
// Tool identities live in tool-closure.json; nothing here reaches the network.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import {tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The account's home from the passwd database, not $HOME: the admission boundary runs carriers with a fresh empty HOME.
const ACCOUNT_HOME = userInfo().homedir;
export const CHROME_PATH = `${ACCOUNT_HOME}/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const BUN_PATH = `${ACCOUNT_HOME}/.bun/bin/bun`;
export const DENO_PATH = '/opt/local/bin/deno';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Resolves `exports["./stealth"]` for an ESM bundler: the user conditions plus the implicit `import` and `default`, in object key order (first match wins). */
export function resolveStealthExport(packageJson, conditions) {
  const entry = packageJson.exports?.['./stealth'];
  const active = new Set([...conditions, 'import', 'default']);
  const walk = (target) => {
    if (typeof target === 'string') return target;
    if (!target || typeof target !== 'object') return null;
    for (const [condition, inner] of Object.entries(target)) {
      if (condition === 'types') continue;
      if (active.has(condition)) { const found = walk(inner); if (found) return found; }
    }
    return null;
  };
  return walk(entry);
}

/** Bundles the public stealth entry for a condition set on today's source bytes. Returns { target, code, errors }. */
export async function bundleStealthEntry(root, { conditions, platform }) {
  const esbuild = await import(pathToFileURL(resolve(root, 'node_modules/esbuild/lib/main.js')).href);
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const target = resolveStealthExport(packageJson, conditions);
  if (!target) return { target: null, code: null, errors: [`exports["./stealth"] resolves nothing for ${JSON.stringify(conditions)}`] };
  const sourceTarget = target.replace(/^\.\/dist\//u, './src/').replace(/\.(m?js|cjs)$/u, '.ts');
  const entry = resolve(root, sourceTarget);
  if (!existsSync(entry)) return { target, code: null, errors: [`source counterpart ${sourceTarget} does not exist`] };
  try {
    const result = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform, conditions, logLevel: 'silent', absWorkingDir: root, packages: 'bundle', external: platform === 'neutral' ? [] : [] });
    return { target, sourceTarget, code: result.outputFiles[0].text, errors: result.errors.map((e) => e.text), warnings: result.warnings.map((w) => w.text) };
  } catch (error) {
    return { target, sourceTarget, code: null, errors: (error.errors ?? [{ text: error.message }]).map((e) => e.text) };
  }
}

let packed = null;
/** Builds, packs and installs the package network-free once per process. Returns { tarball, installDir, packageDir, lib }. */
export function packStealth(root) {
  if (packed) return packed;
  // The proof build is offline and non-mutating: it pins the version the tracked src/version.ts already carries, so the bundle
  // never consults the registry and never rewrites source (byte-identical content is skipped by the bundle script).
  const committedVersion = /VERSION = '([^']+)'/.exec(readFileSync(resolve(root, 'src/version.ts'), 'utf8'))?.[1];
  if (!committedVersion) throw new Error('src/version.ts carries no VERSION constant');
  const build = spawnSync(BUN_PATH, ['scripts/bundle.ts'], { cwd: root, encoding: 'utf8', timeout: 300_000, env: { ...process.env, REZO_BUNDLE_VERSION: committedVersion } });
  if (build.status !== 0) throw new Error(`bundle failed: ${build.stderr.slice(-800)}`);
  const stage = mkdtempSync(join(tmpdir(), 'stealth-packed-'));
  const pack = spawnSync('npm', ['pack', resolve(root, 'lib'), '--pack-destination', stage, '--ignore-scripts', '--quiet'], { cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, npm_config_offline: 'true' } });
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr.slice(-800)}`);
  const tarball = join(stage, pack.stdout.trim().split('\n').pop());
  const installDir = join(stage, 'install'); const packageDir = join(installDir, 'node_modules', 'rezo');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(installDir, 'package.json'), JSON.stringify({ name: 'stealth-packed-consumer', private: true, type: 'module' }, null, 2));
  const extract = spawnSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', packageDir], { encoding: 'utf8', timeout: 60_000 });
  if (extract.status !== 0) throw new Error(`tar failed: ${extract.stderr.slice(-400)}`);
  const installedPackage = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(installedPackage.dependencies ?? {})) {
    const source = resolve(root, 'node_modules', dependency); const link = join(installDir, 'node_modules', dependency);
    if (existsSync(source) && !existsSync(link)) { mkdirSync(resolve(link, '..'), { recursive: true }); symlinkSync(source, link, 'dir'); }
  }
  packed = { tarball, tarballSha256: sha256(readFileSync(tarball)), installDir, packageDir, installedPackage, buildStdoutTail: build.stdout.slice(-300) };
  return packed;
}

/** Exported names of a .d.ts (values and types) — the public roster parity check. */
export function declaredExports(declarationPath) {
  const text = readFileSync(declarationPath, 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/gu)) names.add(match[1]);
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gu)) names.add(match[1]);
  for (const match of text.matchAll(/export\s*(type\s*)?\{([^}]*)\}/gu)) for (const item of match[2].split(',')) { const name = item.trim().split(/\s+as\s+/u).pop()?.trim(); if (name) names.add(name.replace(/^type\s+/u, '')); }
  return [...names].sort();
}

/**
 * Serves `page` (and optionally `worker`) on 127.0.0.1 and runs Chrome headless against it; resolves with the JSON the page
 * POSTs to /report. A launch that never reports (measured once right after a previous instance was killed) is retried once
 * with a fresh profile — a real report is still the only way to succeed.
 */
/**
 * Chrome for Testing 146 headless intermittently never loads the page at all (measured 2026-08-29: ≈1 launch in 5, also outside the
 * admission boundary; the only stderr is a crashpad mach_vm_read warning). A healthy launch reports within ≈1 s, so a silent launch
 * is given a short budget and retried: up to LAUNCH_ATTEMPTS attempts of LAUNCH_TIMEOUT_MS each, every silent attempt torn down.
 */
const LAUNCH_ATTEMPTS = 4;
const LAUNCH_TIMEOUT_MS = 6_000;
export async function runInChrome(options) {
  const silent = [];
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt++) {
    const result = await launchChromeOnce({ timeoutMs: LAUNCH_TIMEOUT_MS, ...options });
    if (!(result && typeof result.error === 'string' && result.error.startsWith('no report within'))) return silent.length ? { ...result, silentAttempts: silent } : result;
    silent.push({ attempt, error: result.error, stderrTail: result.stderrTail });
  }
  return { error: `no report from Chrome in ${LAUNCH_ATTEMPTS} launches of ${LAUNCH_TIMEOUT_MS}ms`, silentAttempts: silent };
}

async function launchChromeOnce({ page, worker = null, timeoutMs = 20_000 }) {
  if (!existsSync(CHROME_PATH)) throw new Error(`Chrome for Testing 146 missing at ${CHROME_PATH}`);
  const profile = mkdtempSync(join(tmpdir(), 'stealth-chrome-'));
  let reportResolve; const report = new Promise((r) => { reportResolve = r; });
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.writeHead(204); res.end(); try { reportResolve(JSON.parse(body)); } catch (error) { reportResolve({ error: `unparsable report: ${error.message}` }); } }); return; }
    if (req.url === '/worker.js' && worker) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(worker); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const chrome = spawn(CHROME_PATH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--enable-logging=stderr', '--v=0', url], {
    // Chrome for Testing needs the account's ~/Library (measured 2026-08-29: with a fresh HOME it never loads the page);
    // it gets the account home while the carrier itself stays inside the admission boundary.
    env: { ...process.env, HOME: ACCOUNT_HOME },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; chrome.stderr.on('data', (c) => { stderr += c; });
  const exited = new Promise((r) => chrome.on('exit', (code, signal) => r({ code, signal })));
  const timer = new Promise((r) => setTimeout(() => r({ error: `no report within ${timeoutMs}ms`, stderrTail: stderr.slice(-600) }), timeoutMs));
  const result = await Promise.race([report, timer]);
  await killChromeTree(chrome, exited);
  await new Promise((r) => server.close(() => r()));
  return result;
}

/** Every live descendant pid of `pid` (GPU, renderer, crashpad helpers), deepest first, from one `ps` snapshot. */
function descendantPids(pid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const children = new Map(); for (const [child, parent] of rows) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(child); }
  const out = []; const walk = (p) => { for (const child of children.get(p) ?? []) { walk(child); out.push(child); } }; walk(pid); return out;
}

/**
 * Kills Chrome and every helper it spawned, then waits (bounded) until none of them answers signal 0: a helper outliving the
 * carrier is exactly what the admission census counts as a leftover process. Chrome stays in the carrier's process group on
 * purpose — a detached child would escape that census instead of being accounted for.
 */
async function killChromeTree(chrome, exited) {
  const tree = [...descendantPids(chrome.pid), chrome.pid];
  for (const pid of tree) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = tree.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (alive.length === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Chrome process tree of ${chrome.pid} still alive 5 s after SIGKILL`);
}

/** HTML page that imports an ESM bundle text inline (as a blob module) and reports the resolver outcome. */
export function pageForBundle(bundleCode, { withWorker = false } = {}) {
  const b64 = Buffer.from(bundleCode, 'utf8').toString('base64');
  return `<!doctype html><html><body><script type="module">
const report = (payload) => fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
try {
  const code = atob(${JSON.stringify(b64)});
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const mod = await import(url);
  const resolved = mod.resolveProfile('chrome-131');
  const payload = { ok: true, where: 'page', count: mod.listProfiles().length, userAgent: resolved.defaultHeaders['user-agent'], hasCreateSecureContext: typeof mod.createSecureContext === 'function' };
  try { mod.createSecureContext(resolved.tls); payload.tlsCall = 'returned'; } catch (error) { payload.tlsCall = { name: error && error.name, code: error && error.code, message: String(error && error.message).slice(0, 160) }; }
  ${withWorker ? `
  const worker = new Worker('/worker.js', { type: 'module' });
  worker.onmessage = (event) => report({ ...payload, worker: event.data });
  worker.onerror = (event) => report({ ...payload, worker: { error: String(event.message || event) } });
  ` : 'await report(payload);'}
} catch (error) { await report({ ok: false, where: 'page', error: String(error && error.stack || error).slice(0, 600) }); }
</script></body></html>`;
}

/** Module worker script that executes the resolver from a bundle text and posts the outcome to the page. */
export function workerForBundle(bundleCode) {
  const b64 = Buffer.from(bundleCode, 'utf8').toString('base64');
  return `try { const code = atob(${JSON.stringify(b64)}); const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const mod = await import(url); const resolved = mod.resolveProfile('firefox-133'); self.postMessage({ ok: true, where: 'worker', count: mod.listProfiles().length, userAgent: resolved.defaultHeaders['user-agent'] }); } catch (error) { self.postMessage({ ok: false, where: 'worker', error: String(error && error.stack || error).slice(0, 600) }); }`;
}

export const listDeclarationFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith('.d.ts'));
