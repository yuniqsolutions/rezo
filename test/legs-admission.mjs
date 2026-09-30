// Shared admission predicate for the mutation-legs drivers (R17, R18) — v3.1.
//
// A gate that cannot fail is not a gate. A mutated leg is admitted only when the runner itself failed
// exactly as frozen: exit status exactly 1, no signal, no spawn error, no skipped row, no duplicate
// report, the failed set equal to the frozen expectation, the passed set equal to the LITERAL roster
// minus the failed set, the runner's own `Tests k failed | N-k passed (N)` line, `Test Files 1 failed (1)`,
// a `Failed Tests k` report block, and no `Failed Suites` / `Unhandled` / `Errors` collateral. The
// baseline (unmutated carrier) must be exit 0 with every literal roster row passing. Calibration runs
// are never valid. Runtime identity (Node binary, Vitest runner, lockfile) is pinned by the drivers.
//
// v3.1 census (tayo #rezo 66948/66957/67012/67025): the process-group census is typed, and its PRIMARY
// backend is the kernel signal-0 probe `kill(-pgid, 0)` — it works where /usr/bin/pgrep and /bin/ps do
// not (sandboxes without sysmond access). Contract: the PGID must be the recorded detached group-leader
// PID (integer > 1); a successful kill means members are present (refuse); ONLY ESRCH is an observed
// empty group; EPERM/EACCES/any other errno is NON-OBSERVED (refuse). Every census runs its own real
// live→reaped sentinel control first, proving both directions of the instrument on this host at that
// moment. pgrep, where its pinned binary exists, is a recorded DIAGNOSTIC that can name members but can
// never override signal-0. Backend, PGID, raw result, errno and timestamp are preserved per census.

import { createHash } from 'node:crypto';
import { spawn as spawnAsync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const ANSI = /\[[0-9;]*m/gu;
export const sha256Text = (text) => createHash('sha256').update(text).digest('hex');
export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const clean = (line) => line.replace(ANSI, '').trim().replace(/\s+/gu, ' ');

/** The vitest `Tests …` summary line, whitespace-normalised; null unless exactly one. */
export function runnerSummaryOf(text) {
  const lines = text.split('\n').map(clean).filter((line) => /^Tests \d/u.test(line));
  return lines.length === 1 ? lines[0] : null;
}

/** Closed report schema: the `Test Files` line, the `Failed Tests N` block, and every collateral marker. */
export function reportShape(text) {
  const lines = text.split('\n').map(clean);
  const testFiles = lines.filter((line) => /^Test Files \d/u.test(line));
  const failedTests = lines.map((line) => /^⎯+ Failed Tests (\d+) ⎯+$/u.exec(line)).filter(Boolean).map((m) => Number(m[1]));
  // Collateral is recognised by vitest's own report structure (rule lines and the summary column), never by a
  // phrase inside a test title — a title may legitimately mention "Failed Suites" or "Unhandled".
  const failedSuitesHeaders = lines.map((line) => /^⎯+ Failed Suites (\d+) ⎯+$/u.exec(line)).filter(Boolean).map((m) => Number(m[1]));
  // Suite-level failures (hooks such as a carrier's fail-closed afterAll ledger) are listed as
  // `FAIL <file> [ <file> ]` followed by the error's first line; per-test entries carry ` > ` and are not suites.
  const suiteFailures = [];
  for (let index = 0; index < lines.length; index += 1) {
    const suite = /^FAIL (\S+) \[ \S+ \]$/u.exec(lines[index]);
    if (!suite) continue;
    let next = index + 1; while (next < lines.length && lines[next] === '') next += 1;
    suiteFailures.push({ file: suite[1], message: lines[next] ?? '' });
  }
  return {
    testFiles: testFiles.length === 1 ? testFiles[0] : null,
    failedTestsBlock: failedTests.length === 1 ? failedTests[0] : failedTests.length === 0 ? null : NaN,
    failedSuitesCount: failedSuitesHeaders.length === 0 ? 0 : failedSuitesHeaders.length === 1 ? failedSuitesHeaders[0] : NaN,
    suiteFailures,
    unhandled: lines.some((line) => /^⎯+ Unhandled (Errors?|Rejections?)( \d+)? ⎯+$/u.test(line)),
    errors: lines.some((line) => /^Errors \d+ errors?$/u.test(line)),
  };
}

/** Row ids from the verbose reporter: `✓` pass, `×` failure, `↓` skipped; a second report of the same id is a duplicate. */
export function rowsFromLog(log, rowId) {
  const passed = new Set(); const failed = new Set(); const skipped = new Set(); const duplicates = new Set();
  const seen = (id) => passed.has(id) || failed.has(id) || skipped.has(id);
  for (const line of log.split('\n')) {
    const trimmed = line.replace(ANSI, '').trimStart();
    const match = rowId.exec(trimmed);
    if (!match) continue;
    const id = match[1];
    if (trimmed.startsWith('✓')) { if (seen(id)) duplicates.add(id); passed.add(id); }
    else if (trimmed.startsWith('×')) { if (seen(id)) duplicates.add(id); failed.add(id); }
    else if (trimmed.startsWith('↓')) { if (seen(id)) duplicates.add(id); skipped.add(id); }
  }
  return { failed: [...failed].sort(), passed: [...passed].sort(), skipped: [...skipped].sort(), duplicates: [...duplicates].sort() };
}

/** A census PGID must be the recorded detached group-leader PID: an integer strictly greater than 1. */
export function validatePgid(pgid) {
  if (typeof pgid !== 'number' || !Number.isInteger(pgid)) return `invalid pgid ${JSON.stringify(pgid)} (not an integer)`;
  if (pgid <= 1) return `invalid pgid ${pgid} (must be > 1; kill(-0)/kill(-1) target the caller's or every group)`;
  return null;
}

/**
 * Typed interpretation of one raw signal-0 outcome against a process group. `ALIVE` (the kill
 * succeeded) means at least one member exists — never a zero. ONLY `ESRCH` is an observed empty
 * group. EPERM/EACCES mean something exists that we may not signal — but a foreign process in a
 * recycled group id is indistinguishable from a leftover, so both are NON-OBSERVED (refused), as is
 * every other errno. PGID reuse can therefore only conservatively false-positive, never hide a leftover.
 */
export function interpretSignalZero(result) {
  if (result === 'ALIVE') return { observed: true, empty: false, reason: null };
  if (result === 'ESRCH') return { observed: true, empty: true, reason: null };
  return { observed: false, empty: null, reason: `signal-0 probe unexpected result ${JSON.stringify(result)}` };
}

/**
 * DIAGNOSTIC interpretation of one raw `pgrep -g <pgid>` probe. It can NAME members when healthy but
 * never decides the census. A zero is credible ONLY as the documented no-match: exit status exactly 1
 * with empty stdout and stderr. Status 0 requires strictly numeric, unique PID rows and an empty
 * stderr. Everything else — spawn error, signal, status >= 2 (usage errors, the macOS sysmond service
 * failure), stderr with status 0, stdout with status 1, malformed or duplicate rows — is NON-OBSERVED.
 */
export function interpretProcessGroupProbe(probe) {
  const notObserved = (reason) => ({ observed: false, zero: null, members: [], reason });
  if (probe.error) return notObserved(`pgrep spawn error ${probe.error.code ?? probe.error.message ?? String(probe.error)}`);
  if (probe.signal) return notObserved(`pgrep killed by ${probe.signal}`);
  const stdout = probe.stdout ?? ''; const stderr = probe.stderr ?? '';
  if (probe.status === 1) {
    if (stdout === '' && stderr === '') return { observed: true, zero: true, members: [], reason: null };
    return notObserved(`pgrep status 1 with output (stdout ${JSON.stringify(stdout.slice(0, 120))}, stderr ${JSON.stringify(stderr.slice(0, 240))})`);
  }
  if (probe.status === 0) {
    if (stderr !== '') return notObserved(`pgrep status 0 with stderr ${JSON.stringify(stderr.slice(0, 240))}`);
    const rows = stdout.split('\n');
    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
    if (rows.length === 0) return notObserved('pgrep status 0 with no PID rows');
    const malformed = rows.filter((row) => !/^\d+$/u.test(row));
    if (malformed.length > 0) return notObserved(`malformed pgrep rows ${JSON.stringify(malformed.slice(0, 5))}`);
    const members = rows.map(Number);
    if (new Set(members).size !== members.length) return notObserved(`duplicate pgrep rows ${JSON.stringify(rows)}`);
    return { observed: true, zero: false, members, reason: null };
  }
  return notObserved(`pgrep exit ${probe.status}${stderr !== '' ? ` stderr ${JSON.stringify(stderr.slice(0, 240))}` : ''}`);
}

const rawPgrepProbe = (pgrepPath, target, env) => {
  const probe = spawnSync(pgrepPath, ['-g', String(target)], { encoding: 'utf8', timeout: 10_000, env });
  return { status: probe.status, signal: probe.signal, error: probe.error ?? null, stdout: probe.stdout ?? '', stderr: probe.stderr ?? '' };
};
const signalZero = (target) => { try { process.kill(-target, 0); return 'ALIVE'; } catch (error) { return error.code ?? 'UNKNOWN'; } };
const pollFor = async (predicate, budgetMs) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return predicate();
};

/**
 * Full census of a process group. Backend: kernel signal-0 (primary, decides), pgrep (diagnostic,
 * recorded, may name members, never decides). Every census first runs a real live→reaped sentinel
 * control: a detached child (leader of its own fresh group) must probe ALIVE while running and exactly
 * ESRCH after SIGKILL + reap — both directions proven on this host at this moment, raw records kept.
 */
export async function processGroupCensus(pgid, { execPath, pgrepPath = null, env = undefined }) {
  const at = new Date().toISOString();
  const pgidProblem = validatePgid(pgid);
  if (pgidProblem !== null) return { backend: 'signal-0', pgid, at, observed: false, empty: null, members: [], reason: pgidProblem, control: null, result: null, diagnostic: null };
  const control = { sentinelPid: null, live: null, reaped: null, valid: false, reason: null };
  let sentinel = null;
  try {
    sentinel = spawnAsync(execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore', env });
    sentinel.on('error', () => {});
    if (typeof sentinel.pid !== 'number' || validatePgid(sentinel.pid) !== null) { control.reason = 'sentinel spawn produced no usable pid'; }
    else {
      control.sentinelPid = sentinel.pid;
      const alive = await pollFor(() => signalZero(sentinel.pid) === 'ALIVE', 2_000);
      control.live = { result: signalZero(sentinel.pid), reachedAlive: alive };
      try { process.kill(-sentinel.pid, 'SIGKILL'); } catch { /* recorded through the reaped-direction probe */ }
      const gone = await pollFor(() => signalZero(sentinel.pid) === 'ESRCH', 2_000);
      control.reaped = { result: signalZero(sentinel.pid), reachedEsrch: gone };
      control.valid = alive && control.live.result === 'ALIVE' && gone && control.reaped.result === 'ESRCH';
      if (!control.valid) control.reason = `live→reaped control failed (live ${JSON.stringify(control.live)}, reaped ${JSON.stringify(control.reaped)})`;
    }
  } finally {
    if (sentinel && typeof sentinel.pid === 'number') { try { process.kill(-sentinel.pid, 'SIGKILL'); } catch { /* already gone */ } sentinel.unref(); }
  }
  if (!control.valid) return { backend: 'signal-0', pgid, at, observed: false, empty: null, members: [], reason: control.reason ?? 'instrument control failed', control, result: null, diagnostic: null };
  const result = signalZero(pgid);
  const interpreted = interpretSignalZero(result);
  // pgrep diagnostic (never decides): recorded raw + typed; enriches member naming when credible.
  let diagnostic = null;
  if (pgrepPath !== null) {
    const probe = rawPgrepProbe(pgrepPath, pgid, env);
    diagnostic = { pgrepPath, probe, interpreted: interpretProcessGroupProbe(probe) };
  }
  const members = interpreted.observed && interpreted.empty === false && diagnostic?.interpreted.observed && diagnostic.interpreted.zero === false
    ? diagnostic.interpreted.members : [];
  return { backend: 'signal-0', pgid, at, observed: interpreted.observed, empty: interpreted.empty, members, reason: interpreted.reason, control, result, diagnostic };
}

/** Census admission: a run is judged only on an OBSERVED, EMPTY census; anything else is an invalidity. */
export function admitCensus(census, label, invalid) {
  if (!census || typeof census !== 'object') { invalid.push(`${label}: process-group census missing`); return; }
  if (!census.observed) invalid.push(`${label}: process-group census not observed (${census.reason})`);
  else if (census.empty !== true) invalid.push(`${label}: leftover processes in the group (signal-0 ${census.result}${census.members.length > 0 ? `, named ${JSON.stringify(census.members)}` : ''})`);
}

/** Runs one carrier in its own process group; returns the spawn result, the combined log, and the typed census. */
export async function runCarrier({ execPath, args, cwd, timeoutMs, pgrepPath = null, env = undefined }) {
  const spawn = spawnSync(execPath, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, detached: true, env });
  const log = `${spawn.stdout ?? ''}\n--- stderr ---\n${spawn.stderr ?? ''}`;
  const census = typeof spawn.pid === 'number'
    ? await processGroupCensus(spawn.pid, { execPath, pgrepPath, env })
    : { backend: 'signal-0', pgid: spawn.pid ?? null, at: new Date().toISOString(), observed: false, empty: null, members: [], reason: 'carrier pid unavailable', control: null, result: null, diagnostic: null };
  return { spawn, log, logSha256: sha256Text(log), pid: spawn.pid ?? null, census };
}

/** Re-reads an evidence file and compares it with the hash recorded for it; null when intact. */
export function verifyEvidence(path, expectedSha256) {
  const actual = sha256File(path);
  return actual === expectedSha256 ? null : `evidence ${path} ${actual} !== recorded ${expectedSha256}`;
}

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const collateral = (shape, invalid) => {
  if (shape.unhandled) invalid.push('Unhandled error/rejection collateral present');
  if (shape.errors) invalid.push('Errors collateral present');
};
/** Suite failures are admitted only when frozen per leg: exact count, file and first error line. */
const suiteFailuresAgainst = (shape, expected, invalid) => {
  if (shape.failedSuitesCount !== expected.length) invalid.push(`Failed Suites ${shape.failedSuitesCount} !== expected ${expected.length}`);
  if (shape.suiteFailures.length !== expected.length) invalid.push(`suite failure entries ${shape.suiteFailures.length} !== expected ${expected.length}`);
  expected.forEach((want, index) => {
    const got = shape.suiteFailures[index];
    if (!got) return;
    if (got.file !== want.file) invalid.push(`suite failure file ${got.file} !== expected ${want.file}`);
    if (got.message !== want.message) invalid.push(`suite failure message ${JSON.stringify(got.message)} !== expected ${JSON.stringify(want.message)}`);
  });
};

/** Baseline: the unmutated carrier must be fully green against the LITERAL roster. */
export function admitBaseline({ spawn, log, rowId, roster }) {
  const invalid = [];
  const rows = rowsFromLog(log, rowId);
  const summary = runnerSummaryOf(log);
  const shape = reportShape(log);
  if (spawn.error) invalid.push(`baseline spawn error ${spawn.error.code ?? spawn.error.message}`);
  if (spawn.signal) invalid.push(`baseline runner killed by ${spawn.signal}`);
  if (spawn.status !== 0) invalid.push(`baseline child exit ${spawn.status} (expected exactly 0)`);
  if (rows.failed.length !== 0) invalid.push(`baseline failed rows ${JSON.stringify(rows.failed)}`);
  if (rows.skipped.length !== 0) invalid.push(`baseline skipped rows ${JSON.stringify(rows.skipped)}`);
  if (rows.duplicates.length !== 0) invalid.push(`baseline duplicate rows ${JSON.stringify(rows.duplicates)}`);
  if (!sameSet(rows.passed, roster)) invalid.push(`baseline passed rows ${JSON.stringify(rows.passed)} !== literal roster (${roster.length} rows)`);
  const expectedSummary = `Tests ${roster.length} passed (${roster.length})`;
  if (summary !== expectedSummary) invalid.push(`baseline runner summary ${JSON.stringify(summary)} !== ${JSON.stringify(expectedSummary)}`);
  if (shape.testFiles !== 'Test Files 1 passed (1)') invalid.push(`baseline test files line ${JSON.stringify(shape.testFiles)}`);
  if (shape.failedTestsBlock !== null) invalid.push(`baseline has a Failed Tests block (${shape.failedTestsBlock})`);
  suiteFailuresAgainst(shape, [], invalid);
  collateral(shape, invalid);
  return { invalid, rows, summary, shape };
}

/** Mutated leg: exact exit 1, literal roster minus frozen failed set, closed report schema; calibration never valid. */
export function admitMutatedLeg({ spawn, log, rowId, roster, expectedFailed, expectedSuiteFailures = [], mode }) {
  const invalid = [];
  const rows = rowsFromLog(log, rowId);
  const summary = runnerSummaryOf(log);
  const shape = reportShape(log);
  if (spawn.error) invalid.push(`spawn error ${spawn.error.code ?? spawn.error.message}`);
  if (spawn.signal) invalid.push(`runner killed by ${spawn.signal}`);
  if (spawn.status !== 1) invalid.push(`child exit ${spawn.status} (expected exactly 1)`);
  if (rows.skipped.length !== 0) invalid.push(`skipped rows ${JSON.stringify(rows.skipped)} (every other row must pass)`);
  if (rows.duplicates.length !== 0) invalid.push(`duplicate row reports ${JSON.stringify(rows.duplicates)}`);
  if (rows.failed.length === 0) invalid.push('the mutation went unnoticed');
  for (const id of rows.failed) if (!roster.includes(id)) invalid.push(`failed row ${id} is not in the literal roster`);
  if (mode === 'canonical' && !sameSet(rows.failed, expectedFailed)) invalid.push(`failed set ${JSON.stringify(rows.failed)} !== expected ${JSON.stringify([...expectedFailed].sort())}`);
  const expectedPassed = roster.filter((id) => !rows.failed.includes(id));
  if (!sameSet(rows.passed, expectedPassed)) invalid.push(`passed rows ${JSON.stringify(rows.passed)} !== literal roster minus failed (${expectedPassed.length} rows)`);
  const expectedSummary = `Tests ${rows.failed.length} failed | ${roster.length - rows.failed.length} passed (${roster.length})`;
  if (summary !== expectedSummary) invalid.push(`runner summary ${JSON.stringify(summary)} !== ${JSON.stringify(expectedSummary)}`);
  if (shape.testFiles !== 'Test Files 1 failed (1)') invalid.push(`test files line ${JSON.stringify(shape.testFiles)}`);
  if (shape.failedTestsBlock !== rows.failed.length) invalid.push(`Failed Tests block ${shape.failedTestsBlock} !== ${rows.failed.length}`);
  suiteFailuresAgainst(shape, expectedSuiteFailures, invalid);
  collateral(shape, invalid);
  if (mode === 'calibration') invalid.push('calibration run: never valid');
  return { invalid, rows, summary, shape };
}

/** The identity of the runtime that executed the carriers: Node binary, Vitest runner, lockfile, package manifest. */
export function runtimeIdentity(root) {
  const realpath = realpathSync(process.execPath);
  const runnerPath = 'node_modules/vitest/vitest.mjs';
  return {
    node: { version: process.version, realpath, sha256: sha256File(realpath) },
    vitest: { version: JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8')).version, runnerPath, sha256: sha256File(resolve(root, runnerPath)) },
    lock: { path: 'bun.lock', sha256: sha256File(resolve(root, 'bun.lock')) },
    packageJson: { path: 'package.json', sha256: sha256File(resolve(root, 'package.json')) },
  };
}

/** Differences between the observed runtime identity and the pinned one (empty when identical). */
export function runtimeDrift(observed, pinned) {
  const drift = [];
  for (const [group, fields] of Object.entries(pinned)) for (const [field, expected] of Object.entries(fields)) {
    const actual = observed[group]?.[field];
    if (actual !== expected) drift.push(`${group}.${field} ${JSON.stringify(actual)} !== pinned ${JSON.stringify(expected)}`);
  }
  return drift;
}

// ——— v3.1 closure + containment (tayo #rezo 66957/67038/67076) ———

/** shasum-style aggregate of every regular file under a directory: byte-sorted `./relative` paths, `<sha>  <path>\n` lines, hashed. */
export function aggregateDirectory(directory, { excludeTopLevel = [] } = {}) {
  // excludeTopLevel: root-level entries that are RUNNER OUTPUT rather than input (e.g. Vitest's
  // `.vite` cache inside node_modules) — a closure that hashed them would self-invalidate during
  // its own run. Exclusions are recorded in the table and re-applied identically at verification.
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (rel === '.' && excludeTopLevel.includes(entry.name)) continue;
      const abs = join(dir, entry.name); const relative = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, relative); else if (entry.isFile()) files.push(relative);
    }
  };
  walk(directory, '.');
  files.sort();
  const text = files.map((relative) => `${sha256File(join(directory, relative))}  ${relative}\n`).join('');
  return { fileCount: files.length, aggregate: sha256Text(text) };
}

/** Child-process creation sites: `spawn`/`spawnSync`/`exec*`/`fork` calls not written as a method (`.exec(` is a RegExp). */
// The dotted-call exclusion below keeps arbitrary method calls out; `Bun.spawn(` is the one dotted
// child-process site the closures reach (scripts/bundle.ts, non-detached) and is matched exactly —
// no other dotted or Sync variant is admitted (DECISION-063 B Phase 4, tayo ruling A).
const CHILD_PROCESS_CALL = /(?:^|[^.\w$])(?:spawn|spawnSync|execFile|execFileSync|execSync|exec|fork)\s*\(|(?:^|[^.\w$])Bun\.spawn\s*\(/u;
const ESCAPE_OPTION = /detached\s*:\s*true|\bsetsid\b/u;
export function scanChildProcessSites(root, relativePaths) {
  const sites = [];
  for (const file of relativePaths) {
    const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!CHILD_PROCESS_CALL.test(line)) return;
      const window = lines.slice(index, index + 8).join('\n');
      sites.push({ file, line: index + 1, snippet: line.trim().slice(0, 160), detached: ESCAPE_OPTION.test(window) });
    });
  }
  return sites;
}

/** Containment: the observed site set must equal the frozen table exactly, and no site may escape the process group. */
export function admitContainment(observed, frozen) {
  const key = (site) => `${site.file}:${site.line}:${site.snippet}`;
  const invalid = [];
  const observedKeys = new Set(observed.map(key)); const frozenKeys = new Set(frozen.map(key));
  for (const site of observed) if (!frozenKeys.has(key(site))) invalid.push(`new child-process site ${key(site)}`);
  for (const site of frozen) if (!observedKeys.has(key(site))) invalid.push(`frozen child-process site missing ${key(site)}`);
  for (const site of observed) if (site.detached) invalid.push(`escaping child-process site ${key(site)} (detached/setsid)`);
  for (const site of frozen) if (site.detached) invalid.push(`frozen table admits an escaping site ${key(site)}`);
  return invalid;
}

/**
 * Verifies the frozen closure table against the disk: every carrier file, tool, dylib, package
 * aggregate, config and child-process site — and (table v3.2, DECISION-064 → A) every executed
 * build tool by realpath+sha with npm/tar additionally re-resolved along the frozen boundary PATH,
 * plus the external root aggregates (repo node_modules, global npm installation).
 */
export function verifyClosureTable(root, table) {
  const problems = [];
  const union = new Map();
  for (const carrier of Object.values(table.carriers)) for (const file of carrier.files) union.set(file.path, file.sha256);
  for (const [path, expected] of union) {
    let actual = null;
    try { actual = sha256File(resolve(root, path)); } catch (error) { problems.push(`${path}: ${error.code ?? error.message}`); continue; }
    if (actual !== expected) problems.push(`${path} ${actual} !== frozen ${expected}`);
  }
  for (const [name, tool] of Object.entries(table.tools)) {
    const path = tool.realpath ?? tool.path;
    if (!existsSync(path)) { if (tool.optional) continue; problems.push(`tool ${name} missing at ${path}`); continue; }
    const actual = sha256File(realpathSync(path));
    if (actual !== tool.sha256) problems.push(`tool ${name} ${actual} !== frozen ${tool.sha256}`);
    for (const dylib of tool.dylibs ?? []) {
      const found = existsSync(dylib.path) ? sha256File(dylib.path) : null;
      if (found !== dylib.sha256) problems.push(`tool ${name} dylib ${dylib.path} ${found} !== frozen ${dylib.sha256}`);
    }
  }
  for (const [name, pkg] of Object.entries(table.packages)) {
    const dir = resolve(root, 'node_modules', name);
    if (!existsSync(dir)) { problems.push(`package ${name} missing`); continue; }
    const observed = aggregateDirectory(dir);
    if (observed.aggregate !== pkg.aggregate || observed.fileCount !== pkg.fileCount) problems.push(`package ${name} ${observed.aggregate}/${observed.fileCount} !== frozen ${pkg.aggregate}/${pkg.fileCount}`);
  }
  for (const [name, tool] of Object.entries(table.buildTools ?? {})) {
    if (!existsSync(tool.path)) { problems.push(`build tool ${name} missing at ${tool.path}`); continue; }
    const actualRealpath = realpathSync(tool.path);
    if (actualRealpath !== tool.realpath) { problems.push(`build tool ${name} realpath ${actualRealpath} !== frozen ${tool.realpath}`); continue; }
    const actual = sha256File(actualRealpath);
    if (actual !== tool.sha256) problems.push(`build tool ${name} ${actual} !== frozen ${tool.sha256}`);
  }
  // npm and tar are the only build tools the fixture resolves by NAME: what the frozen boundary
  // PATH hands those names must be the pinned binaries, or the run is refused.
  const resolveOnFrozenPath = (command) => {
    for (const dir of (table.env?.PATH ?? '').split(':')) {
      const candidate = join(dir, command);
      if (existsSync(candidate)) return realpathSync(candidate);
    }
    return null;
  };
  for (const name of ['npm', 'tar']) {
    const pinned = table.buildTools?.[name];
    if (!pinned) continue;
    const resolved = resolveOnFrozenPath(name);
    if (resolved !== pinned.realpath) problems.push(`frozen PATH resolves ${name} to ${resolved ?? '<nothing>'} !== pinned ${pinned.realpath}`);
  }
  for (const [name, external] of Object.entries(table.externalRoots ?? {})) {
    const dir = isAbsolute(external.path) ? external.path : resolve(root, external.path);
    if (!existsSync(dir)) { problems.push(`external root ${name} missing at ${external.path}`); continue; }
    const observed = aggregateDirectory(dir, { excludeTopLevel: external.excluded ?? [] });
    if (observed.aggregate !== external.aggregate || observed.fileCount !== external.fileCount) problems.push(`external root ${name} ${observed.aggregate}/${observed.fileCount} !== frozen ${external.aggregate}/${external.fileCount}`);
  }
  const tsconfig = sha256File(resolve(root, 'tsconfig.json'));
  if (tsconfig !== table.configs.tsconfig.sha256) problems.push(`tsconfig.json ${tsconfig} !== frozen ${table.configs.tsconfig.sha256}`);
  for (const candidate of table.configs.absentConfigCandidates) if (existsSync(resolve(root, candidate))) problems.push(`config candidate present: ${candidate}`);
  if ('vitest' in JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))) problems.push('package.json carries a vitest key');
  const observedSites = scanChildProcessSites(root, [...union.keys()].sort());
  problems.push(...admitContainment(observedSites, table.containment.sites));
  return { problems, summary: { closureFiles: union.size, tools: Object.keys(table.tools).length, buildTools: Object.keys(table.buildTools ?? {}).length, externalRoots: Object.keys(table.externalRoots ?? {}).length, packages: Object.keys(table.packages).length, containmentSites: observedSites.length } };
}
