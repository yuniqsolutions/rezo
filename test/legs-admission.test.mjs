/**
 * Self-regressions for the mutation-legs admission helper — v3.1.
 *
 * A validator must prove it can fail before it judges product mutations. Every row below feeds the
 * helper a synthetic runner log or probe and asserts that the exact hole it encodes is rejected;
 * SA-10 and SA-11 are the positive controls (a perfect leg and a perfect baseline are admitted).
 * SA-16…SA-24 pin the typed census: signal-0 is the deciding backend (only ESRCH is an observed
 * empty group; EPERM/EACCES/other errnos and invalid PGIDs are non-observed), pgrep is a diagnostic
 * whose every failure mode — including the exact macOS sysmond status-3 failure — is never a zero.
 * SA-25 proves the data:-URL import path executes exactly the authenticated bytes; SA-26 is a real
 * live→reaped kernel control. SA-29…SA-31 pin the v3.2 build closure (DECISION-064 → A): the
 * recorded top-level aggregate exclusion, the exact undotted `Bun.spawn(` scanner shape, and the
 * build-tool/frozen-PATH/external-root refusals of verifyClosureTable. The drivers run this file
 * first and refuse to judge anything unless it is fully green against the literal SA roster.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import {
  admitBaseline, admitCensus, admitContainment, admitMutatedLeg, aggregateDirectory, interpretProcessGroupProbe, interpretSignalZero,
  reportShape, rowsFromLog, runnerSummaryOf, runtimeDrift, scanChildProcessSites, sha256Text, validatePgid, verifyClosureTable, verifyEvidence,
} from './legs-admission.mjs';

const ROW_ID = /\b(ROW-\d{2})\b/u;
const ROSTER = ['ROW-01', 'ROW-02', 'ROW-03'];
const spawnOf = (status, signal = null, error = undefined) => ({ status, signal, error });

/** Builds a verbose-reporter log from row outcomes plus the summary block vitest prints. */
function logOf({ rows, summary, testFiles, failedBlock, extra = [] }) {
  const lines = [' RUN  v4.1.4 /repo', ''];
  for (const [id, glyph] of rows) lines.push(`   ${glyph} test/x.test.ts > ${id} does something 12ms`);
  lines.push('', ...extra);
  if (failedBlock !== undefined) lines.push(`⎯⎯⎯⎯⎯⎯⎯ Failed Tests ${failedBlock} ⎯⎯⎯⎯⎯⎯⎯⎯`);
  lines.push('', ` Test Files  ${testFiles}`, `      Tests  ${summary}`, '   Start at  16:00:00', '   Duration  1.00s', '');
  return lines.join('\n');
}
const perfectLeg = () => logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 1 });
const perfectBaseline = () => logOf({ rows: [['ROW-01', '✓'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '3 passed (3)', testFiles: '1 passed (1)' });
const judge = (log, overrides = {}) => admitMutatedLeg({ spawn: spawnOf(1), log, rowId: ROW_ID, roster: ROSTER, expectedFailed: ['ROW-01'], mode: 'canonical', ...overrides });

it('SA-01 the seq66678 case: expected failure + pass + collateral skip is rejected, not admitted', () => {
  const log = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '↓']], summary: '1 failed | 1 passed | 1 skipped (3)', testFiles: '1 failed (1)', failedBlock: 1 });
  const verdict = judge(log);
  expect(verdict.rows.skipped).toEqual(['ROW-03']);
  expect(verdict.invalid.some((entry) => entry.startsWith('skipped rows'))).toBe(true);
  expect(verdict.invalid.some((entry) => entry.startsWith('passed rows'))).toBe(true);
  expect(verdict.invalid.some((entry) => entry.startsWith('runner summary'))).toBe(true);
});

it('SA-02 a skipped row in the baseline is rejected', () => {
  const log = logOf({ rows: [['ROW-01', '✓'], ['ROW-02', '✓'], ['ROW-03', '↓']], summary: '2 passed | 1 skipped (3)', testFiles: '1 passed (1)' });
  const verdict = admitBaseline({ spawn: spawnOf(0), log, rowId: ROW_ID, roster: ROSTER });
  expect(verdict.invalid.some((entry) => entry.startsWith('baseline skipped rows'))).toBe(true);
  expect(verdict.invalid.some((entry) => entry.startsWith('baseline passed rows'))).toBe(true);
});

it('SA-03 a perfect log with exit 0, a signal, or a spawn error is rejected', () => {
  expect(judge(perfectLeg(), { spawn: spawnOf(0) }).invalid).toContain('child exit 0 (expected exactly 1)');
  expect(judge(perfectLeg(), { spawn: spawnOf(null, 'SIGKILL') }).invalid).toContain('runner killed by SIGKILL');
  expect(judge(perfectLeg(), { spawn: spawnOf(1, null, { code: 'ETIMEDOUT' }) }).invalid).toContain('spawn error ETIMEDOUT');
  expect(admitBaseline({ spawn: spawnOf(1), log: perfectBaseline(), rowId: ROW_ID, roster: ROSTER }).invalid).toContain('baseline child exit 1 (expected exactly 0)');
});

it('SA-04 a partial roster (one row never reported) is rejected even when the summary agrees with itself', () => {
  const log = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓']], summary: '1 failed | 1 passed (2)', testFiles: '1 failed (1)', failedBlock: 1 });
  const verdict = judge(log);
  expect(verdict.invalid.some((entry) => entry.startsWith('passed rows'))).toBe(true);
  expect(verdict.invalid.some((entry) => entry.startsWith('runner summary'))).toBe(true);
});

it('SA-05 a duplicate row report is rejected', () => {
  const log = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 1 });
  expect(judge(log).invalid).toContain('duplicate row reports ["ROW-02"]');
});

it('SA-06 Errors, Failed Suites, and Unhandled collateral are each rejected', () => {
  const withExtra = (extra) => judge(logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 1, extra })).invalid;
  expect(withExtra(['     Errors  1 error'])).toContain('Errors collateral present');
  expect(withExtra(['⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯'])).toContain('Failed Suites 1 !== expected 0');
  expect(withExtra(['⎯⎯⎯⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯⎯⎯⎯'])).toContain('Unhandled error/rejection collateral present');
});

it('SA-15 a frozen suite failure (a fail-closed afterAll ledger) is admitted only with the exact count, file and message', () => {
  const suite = (message, count = 1) => logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 1,
    extra: [`⎯⎯⎯⎯⎯⎯⎯ Failed Suites ${count} ⎯⎯⎯⎯⎯⎯⎯⎯`, '', ' FAIL  test/x.test.ts [ test/x.test.ts ]', message, '', '- Expected', '+ Received'] });
  const frozen = [{ file: 'test/x.test.ts', message: 'AssertionError: expected [ …(1) ] to deeply equal []' }];
  expect(judge(suite('AssertionError: expected [ …(1) ] to deeply equal []'), { expectedSuiteFailures: frozen }).invalid).toEqual([]);
  expect(judge(suite('AssertionError: expected [ …(2) ] to deeply equal []'), { expectedSuiteFailures: frozen }).invalid).toContain('suite failure message "AssertionError: expected [ …(2) ] to deeply equal []" !== expected "AssertionError: expected [ …(1) ] to deeply equal []"');
  expect(judge(suite('AssertionError: expected [ …(1) ] to deeply equal []', 2), { expectedSuiteFailures: frozen }).invalid).toContain('Failed Suites 2 !== expected 1');
  expect(judge(suite('AssertionError: expected [ …(1) ] to deeply equal []')).invalid).toContain('Failed Suites 1 !== expected 0');
  expect(judge(perfectLeg(), { expectedSuiteFailures: frozen }).invalid).toContain('Failed Suites 0 !== expected 1');
  expect(admitBaseline({ spawn: spawnOf(0), log: suite('x').replace('1 failed (1)', '1 passed (1)'), rowId: ROW_ID, roster: ROSTER }).invalid).toContain('Failed Suites 1 !== expected 0');
});

it('SA-14 a test title that merely mentions Failed Suites, Unhandled Rejection or Errors is not collateral', () => {
  const titled = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 1,
    extra: ['   ✓ test/x.test.ts > SA-06 Errors, Failed Suites, and Unhandled Rejection collateral are each rejected 1ms'] });
  const shape = reportShape(titled);
  expect([shape.failedSuitesCount, shape.suiteFailures, shape.unhandled, shape.errors]).toEqual([0, [], false, false]);
  expect(judge(titled).invalid).toEqual([]);
});

it('SA-07 a missing or duplicated Tests summary line is rejected', () => {
  const none = perfectLeg().replace(/ {6}Tests {2}[^\n]+\n/u, '');
  expect(runnerSummaryOf(none)).toBeNull();
  expect(judge(none).invalid.some((entry) => entry.startsWith('runner summary null'))).toBe(true);
  const twice = perfectLeg().replace('      Tests  1 failed | 2 passed (3)', '      Tests  1 failed | 2 passed (3)\n      Tests  1 failed | 2 passed (3)');
  expect(judge(twice).invalid.some((entry) => entry.startsWith('runner summary null'))).toBe(true);
});

it('SA-08 a Failed Tests block that disagrees with the failed rows, or a wrong Test Files line, is rejected', () => {
  const block = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed (1)', failedBlock: 2 });
  expect(judge(block).invalid).toContain('Failed Tests block 2 !== 1');
  const files = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓']], summary: '1 failed | 2 passed (3)', testFiles: '1 failed | 1 passed (2)', failedBlock: 1 });
  expect(judge(files).invalid).toContain('test files line "Test Files 1 failed | 1 passed (2)"');
  expect(reportShape(block).failedTestsBlock).toBe(2);
});

it('SA-09 calibration mode is never valid, even for a perfect leg', () => {
  expect(judge(perfectLeg(), { mode: 'calibration' }).invalid).toEqual(['calibration run: never valid']);
});

it('SA-10 positive control: a perfect canonical leg is admitted with no invalidity', () => {
  const verdict = judge(perfectLeg());
  expect(verdict.invalid).toEqual([]);
  expect(verdict.rows).toEqual({ failed: ['ROW-01'], passed: ['ROW-02', 'ROW-03'], skipped: [], duplicates: [] });
  expect(verdict.summary).toBe('Tests 1 failed | 2 passed (3)');
  expect(judge(perfectLeg(), { expectedFailed: ['ROW-02'] }).invalid).toContain('failed set ["ROW-01"] !== expected ["ROW-02"]');
});

it('SA-11 positive control: a perfect baseline is admitted; a foreign failed row is rejected', () => {
  expect(admitBaseline({ spawn: spawnOf(0), log: perfectBaseline(), rowId: ROW_ID, roster: ROSTER }).invalid).toEqual([]);
  const foreign = logOf({ rows: [['ROW-01', '×'], ['ROW-02', '✓'], ['ROW-03', '✓'], ['ROW-99', '✓']], summary: '1 failed | 3 passed (4)', testFiles: '1 failed (1)', failedBlock: 1 });
  expect(judge(foreign).invalid.some((entry) => entry.startsWith('passed rows'))).toBe(true);
  expect(rowsFromLog(foreign, ROW_ID).passed).toContain('ROW-99');
});

it('SA-12 runtime identity drift is reported field by field; an identical identity reports nothing', () => {
  const pinned = { node: { version: 'v25.9.0', sha256: 'aa' }, vitest: { version: '4.1.4' } };
  expect(runtimeDrift({ node: { version: 'v25.9.0', sha256: 'aa' }, vitest: { version: '4.1.4' } }, pinned)).toEqual([]);
  expect(runtimeDrift({ node: { version: 'v22.0.0', sha256: 'aa' }, vitest: { version: '4.1.4' } }, pinned)).toEqual(['node.version "v22.0.0" !== pinned "v25.9.0"']);
  expect(runtimeDrift({ node: { version: 'v25.9.0' }, vitest: { version: '4.1.4' } }, pinned)).toEqual(['node.sha256 undefined !== pinned "aa"']);
});

it('SA-13 tampered evidence is detected on reread; intact evidence is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legs-admission-'));
  const path = join(dir, 'leg.log');
  writeFileSync(path, 'original');
  expect(verifyEvidence(path, sha256Text('original'))).toBeNull();
  writeFileSync(path, 'tampered');
  expect(verifyEvidence(path, sha256Text('original'))).toMatch(/^evidence .* !== recorded /u);
});

// ——— v3.1 census rows (tayo #rezo 66948/67012/67025) ———

const pgrepProbe = (over) => ({ status: 0, signal: null, error: null, stdout: '', stderr: '', ...over });

it('SA-16 pgrep diagnostic: status 0 with strictly numeric rows is observed with the member set preserved', () => {
  const typed = interpretProcessGroupProbe(pgrepProbe({ stdout: '123\n456\n' }));
  expect(typed).toEqual({ observed: true, zero: false, members: [123, 456], reason: null });
});

it('SA-17 pgrep diagnostic: status 1 with empty stdout and stderr is its only credible zero', () => {
  expect(interpretProcessGroupProbe(pgrepProbe({ status: 1 }))).toEqual({ observed: true, zero: true, members: [], reason: null });
});

it('SA-18 pgrep diagnostic: status 2 and the exact sysmond status-3 failure are never a zero', () => {
  expect(interpretProcessGroupProbe(pgrepProbe({ status: 2, stderr: 'usage: pgrep …' })).observed).toBe(false);
  const sysmond = pgrepProbe({ status: 3, stderr: 'sysmon request failed with error: sysmond service not found\npgrep: Cannot get process list\n' });
  const typed = interpretProcessGroupProbe(sysmond);
  expect(typed.observed).toBe(false);
  expect(typed.members).toEqual([]);
  expect(typed.reason).toContain('pgrep exit 3');
  expect(typed.reason).toContain('sysmond service not found');
});

it('SA-19 pgrep diagnostic: a spawn error or a signal is never a zero', () => {
  expect(interpretProcessGroupProbe(pgrepProbe({ error: { code: 'ENOENT' } })).observed).toBe(false);
  expect(interpretProcessGroupProbe(pgrepProbe({ signal: 'SIGKILL' })).observed).toBe(false);
});

it('SA-20 pgrep diagnostic: output anomalies (stderr with status 0, stdout or stderr with status 1) are never a zero', () => {
  expect(interpretProcessGroupProbe(pgrepProbe({ stdout: '123\n', stderr: 'warning\n' })).observed).toBe(false);
  expect(interpretProcessGroupProbe(pgrepProbe({ status: 1, stdout: '123\n' })).observed).toBe(false);
  expect(interpretProcessGroupProbe(pgrepProbe({ status: 1, stderr: 'x' })).observed).toBe(false);
});

it('SA-21 pgrep diagnostic: malformed rows, duplicate rows, and status 0 with no rows are never a zero', () => {
  expect(interpretProcessGroupProbe(pgrepProbe({ stdout: '12a\n' })).observed).toBe(false);
  expect(interpretProcessGroupProbe(pgrepProbe({ stdout: '123\n123\n' })).observed).toBe(false);
  expect(interpretProcessGroupProbe(pgrepProbe({ stdout: '' })).observed).toBe(false);
});

it('SA-22 signal-0 decides: ALIVE means members present, only ESRCH is empty, every other errno is non-observed', () => {
  expect(interpretSignalZero('ALIVE')).toEqual({ observed: true, empty: false, reason: null });
  expect(interpretSignalZero('ESRCH')).toEqual({ observed: true, empty: true, reason: null });
  for (const errno of ['EPERM', 'EACCES', 'EINVAL', 'UNKNOWN']) expect(interpretSignalZero(errno).observed).toBe(false);
});

it('SA-23 an invalid PGID (0, 1, negative, non-integer, non-number) is never censused', () => {
  expect(validatePgid(2)).toBeNull();
  expect(validatePgid(46704)).toBeNull();
  for (const bad of [0, 1, -5, 1.5, Number.NaN, '12', undefined, null]) expect(validatePgid(bad)).not.toBeNull();
});

it('SA-24 admitCensus: missing, non-observed and non-empty censuses are invalidities; an observed empty one is admitted', () => {
  const run = (census) => { const invalid = []; admitCensus(census, 'leg X', invalid); return invalid; };
  expect(run(undefined)).toEqual(['leg X: process-group census missing']);
  expect(run({ observed: false, empty: null, members: [], reason: 'signal-0 probe unexpected result "EPERM"', result: null })).toEqual(['leg X: process-group census not observed (signal-0 probe unexpected result "EPERM")']);
  expect(run({ observed: true, empty: false, members: [7], result: 'ALIVE' })).toEqual(['leg X: leftover processes in the group (signal-0 ALIVE, named [7])']);
  expect(run({ observed: true, empty: false, members: [], result: 'ALIVE' })).toEqual(['leg X: leftover processes in the group (signal-0 ALIVE)']);
  expect(run({ observed: true, empty: true, members: [], result: 'ESRCH' })).toEqual([]);
});

it('SA-25 the helper imports from a data: URL built from its exact disk bytes (executed = authenticated)', async () => {
  const bytes = readFileSync(new URL('./legs-admission.mjs', import.meta.url));
  const mod = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
  expect(typeof mod.admitBaseline).toBe('function');
  expect(typeof mod.admitMutatedLeg).toBe('function');
  expect(mod.interpretSignalZero('ESRCH')).toEqual({ observed: true, empty: true, reason: null });
  expect(mod.interpretProcessGroupProbe({ status: 1, signal: null, error: null, stdout: '', stderr: '' }).zero).toBe(true);
});

it('SA-26 real control: a detached child group probes ALIVE while running and exactly ESRCH after reap', async () => {
  const probe = (pgid) => { try { process.kill(-pgid, 0); return 'ALIVE'; } catch (error) { return error.code; } };
  const poll = async (predicate, budgetMs) => { const t0 = Date.now(); while (Date.now() - t0 < budgetMs) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 25)); } return predicate(); };
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  expect(typeof child.pid).toBe('number');
  expect(await poll(() => probe(child.pid) === 'ALIVE', 2000)).toBe(true);
  process.kill(-child.pid, 'SIGKILL');
  expect(await poll(() => probe(child.pid) === 'ESRCH', 2000)).toBe(true);
  expect(probe(child.pid)).toBe('ESRCH');
  child.unref();
});

it('SA-27 containment: a synthetic escaped child (detached/setsid) or an unfrozen spawn site fails the gate; RegExp .exec( is not a site', () => {
  const root = mkdtempSync(join(tmpdir(), 'legs-containment-'));
  writeFileSync(join(root, 'a.ts'), "const m = /x/u.exec(line);\nconst child = spawn(process.execPath, args, {\n  stdio: 'pipe',\n});\n");
  writeFileSync(join(root, 'b.ts'), "const escaped = spawn('x', [], {\n  detached: true,\n});\n");
  writeFileSync(join(root, 'c.ts'), "import { execFileSync } from 'node:child_process';\nsetsid; execFileSync('sh');\n");
  const a = scanChildProcessSites(root, ['a.ts']);
  expect(a).toEqual([{ file: 'a.ts', line: 2, snippet: 'const child = spawn(process.execPath, args, {', detached: false }]);
  expect(admitContainment(a, a)).toEqual([]);
  const ab = scanChildProcessSites(root, ['a.ts', 'b.ts']);
  const verdict = admitContainment(ab, a);
  expect(verdict.some((entry) => entry.startsWith('new child-process site b.ts:1:'))).toBe(true);
  expect(verdict.some((entry) => entry.includes('escaping child-process site b.ts:1:'))).toBe(true);
  expect(admitContainment(a, ab).some((entry) => entry.startsWith('frozen table admits an escaping site'))).toBe(true);
  expect(admitContainment([], a)).toEqual([`frozen child-process site missing a.ts:2:${a[0].snippet}`]);
  expect(scanChildProcessSites(root, ['c.ts'])[0].detached).toBe(true);
});

it('SA-28 the package aggregate is deterministic, byte-sorted, and moves on any byte', () => {
  const root = mkdtempSync(join(tmpdir(), 'legs-aggregate-'));
  writeFileSync(join(root, 'b.txt'), 'bee'); writeFileSync(join(root, 'a.txt'), 'ay');
  mkdirSync(join(root, 'sub')); writeFileSync(join(root, 'sub', 'c.txt'), 'sea');
  const expected = sha256Text([['./a.txt', 'ay'], ['./b.txt', 'bee'], ['./sub/c.txt', 'sea']].map(([path, body]) => `${sha256Text(body)}  ${path}\n`).join(''));
  expect(aggregateDirectory(root)).toEqual({ fileCount: 3, aggregate: expected });
  writeFileSync(join(root, 'sub', 'c.txt'), 'sea!');
  expect(aggregateDirectory(root).aggregate).not.toBe(expected);
});

it('SA-29 excludeTopLevel drops ONLY the named root entries: bytes inside them never move the aggregate, a nested dir of the same name still counts', () => {
  const root = mkdtempSync(join(tmpdir(), 'legs-aggregate-excl-'));
  writeFileSync(join(root, 'a.txt'), 'ay');
  mkdirSync(join(root, '.vite')); writeFileSync(join(root, '.vite', 'results.json'), 'v1');
  mkdirSync(join(root, 'sub')); mkdirSync(join(root, 'sub', '.vite')); writeFileSync(join(root, 'sub', '.vite', 'kept.txt'), 'kept');
  const excluded = aggregateDirectory(root, { excludeTopLevel: ['.vite'] });
  expect(excluded.fileCount).toBe(2); // a.txt + sub/.vite/kept.txt — the ROOT .vite alone is out
  writeFileSync(join(root, '.vite', 'results.json'), 'v2-rewritten-mid-run');
  expect(aggregateDirectory(root, { excludeTopLevel: ['.vite'] })).toEqual(excluded);
  writeFileSync(join(root, 'sub', '.vite', 'kept.txt'), 'kept-changed');
  expect(aggregateDirectory(root, { excludeTopLevel: ['.vite'] }).aggregate).not.toBe(excluded.aggregate);
  expect(aggregateDirectory(root).fileCount).toBe(3); // without the exclusion the cache file counts again
});

it('SA-30 the scanner: the exact 11-case Bun.spawn matrix — only undotted Bun.spawn( matches, plus the attributed pre-existing bare-spawn branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'legs-scan-bun-'));
  // The full near-miss matrix from the DECISION-064 → A extension review. Case 11 matches through
  // the PRE-EXISTING bare-spawn branch (the space before `spawn` satisfies `[^.\w$]`), not through
  // the Bun extension — attributed, kept in the matrix so the boundary is pinned where it truly is.
  const matrix = [
    ['const proc = Bun.spawn([cmd]);', true],   // 1 — the one admitted dotted site
    ['globalThis.Bun.spawn([cmd]);', false],    // 2 — dotted prefix
    ['MyBun.spawn([cmd]);', false],             // 3 — identifier suffix
    ['BunX.spawn([cmd]);', false],              // 4 — identifier suffix after Bun
    ['Bun.spawnSync([cmd]);', false],           // 5 — Sync variant not admitted as dotted
    ['Bun["spawn"]([cmd]);', false],            // 6 — computed member access
    ['xBun.spawn([cmd]);', false],              // 7 — identifier prefix
    ['obj.Bun.spawn([cmd]);', false],           // 8 — nested dotted prefix
    ['await Bun.spawn([', true],                // 9 — the real scripts/bundle.ts shape
    ['bun.spawn([cmd]);', false],               // 10 — lower-case receiver
    ['Bun . spawn(cmd);', true],                // 11 — pre-existing bare-spawn branch (attributed)
  ];
  writeFileSync(join(root, 'probe.ts'), matrix.map(([line]) => line).join('\n'));
  const sites = scanChildProcessSites(root, ['probe.ts']);
  expect(sites.map((site) => site.line)).toEqual(matrix.flatMap(([, matches], index) => (matches ? [index + 1] : [])));
  expect(sites.map((site) => site.line)).toEqual([1, 9, 11]);
  expect(sites.every((site) => site.detached === false)).toBe(true);
});

it('SA-31 verifyClosureTable refuses a wrong build-tool sha, a frozen-PATH drift for npm/tar, and a moved external-root aggregate — and admits the true state', () => {
  // realpathSync the fixture root: macOS hands mkdtemp a /var/folders path whose realpath is
  // /private/var/folders, and the verifier compares realpaths exactly.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'legs-verify-build-')));
  writeFileSync(join(root, 'tsconfig.json'), '{}');
  writeFileSync(join(root, 'package.json'), '{"name":"probe"}');
  const binDir = join(root, 'bin'); mkdirSync(binDir);
  const npmBin = join(binDir, 'npm'); writeFileSync(npmBin, '#!/bin/sh\n');
  const tarBin = join(binDir, 'tar'); writeFileSync(tarBin, '#!/bin/sh\n');
  const externalDir = join(root, 'external'); mkdirSync(externalDir); writeFileSync(join(externalDir, 'f.txt'), 'frozen');
  const truth = {
    schema: 'probe', env: { PATH: binDir },
    carriers: {}, tools: {}, packages: {},
    configs: { tsconfig: { path: 'tsconfig.json', sha256: sha256Text('{}') }, absentConfigCandidates: [] },
    buildTools: {
      npm: { path: npmBin, realpath: npmBin, sha256: sha256Text('#!/bin/sh\n') },
      tar: { path: tarBin, realpath: tarBin, sha256: sha256Text('#!/bin/sh\n') },
    },
    externalRoots: { probeRoot: { path: externalDir, excluded: [], ...aggregateDirectory(externalDir) } },
    containment: { sites: [] },
  };
  expect(verifyClosureTable(root, truth).problems).toEqual([]);
  const wrongSha = structuredClone(truth); wrongSha.buildTools.npm.sha256 = sha256Text('other');
  expect(verifyClosureTable(root, wrongSha).problems.some((p) => p.startsWith('build tool npm '))).toBe(true);
  // PATH drift alone, mutation-sensitively: the pinned tools stay VALID at their real paths and
  // shas; only env.PATH points at a directory holding ALTERNATE existing npm+tar files. The ONLY
  // acceptable outcome is the two exact frozen-PATH drift messages — deleting the frozen-PATH
  // verifier would return [] here and fail the row.
  const altDir = join(root, 'altbin'); mkdirSync(altDir);
  writeFileSync(join(altDir, 'npm'), '#!/bin/sh\n# alternate npm\n');
  writeFileSync(join(altDir, 'tar'), '#!/bin/sh\n# alternate tar\n');
  const pathDrift = structuredClone(truth); pathDrift.env = { PATH: altDir };
  expect(verifyClosureTable(root, pathDrift).problems).toEqual([
    `frozen PATH resolves npm to ${join(altDir, 'npm')} !== pinned ${npmBin}`,
    `frozen PATH resolves tar to ${join(altDir, 'tar')} !== pinned ${tarBin}`,
  ]);
  const movedRoot = structuredClone(truth);
  writeFileSync(join(externalDir, 'f.txt'), 'moved');
  expect(verifyClosureTable(root, movedRoot).problems.some((p) => p.startsWith('external root probeRoot '))).toBe(true);
});
