// Stealth wire fidelity supervisor — PLAN/stealth-wire-fidelity v4 (phase 7.8 freeze — H2 pin moved by HD-7 (manual-redirect facades, redirect event); recut per phase).
//
// Runs the five stealth carriers on every applicable leg, sequentially, and judges each leg against LITERAL
// rosters and FROZEN per-leg verdict sets: every row must be reported exactly once, the RED set must equal the
// frozen RED set and the GREEN set the frozen GREEN set — a row that unexpectedly passes is as invalid as one
// that unexpectedly fails (deferred rows must stay exactly RED until their phase). Pins (tool closure, carriers,
// fixtures, the 14 src/stealth files, adapter/package/tsconfig identities) are verified at open and close.
// Never valid on drift, on a skipped/duplicated row, on a missing leg, or in --calibrate mode.
//
//   REZO_STEALTH_SUPERVISOR_SHA256=<sha256 of this file> REZO_STEALTH_LEDGER=<new file> \
//     node test/stealth-wire-fidelity-supervisor.mjs [--calibrate]
//
// canonical: the ledger is exactly plans/stealth-wire-fidelity-ledger.json (must not exist).
// --calibrate: runs every leg and prints the observed verdict sets instead of judging them.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAGS = process.argv.slice(2);
const MODE = FLAGS.length === 0 ? 'canonical' : FLAGS.length === 1 && FLAGS[0] === '--calibrate' ? 'calibration' : null;
const ROOT = process.cwd();
const SUPERVISOR_PATH = fileURLToPath(import.meta.url);
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const fail = (message) => { console.error(`supervisor invalid: ${message}`); process.exit(2); };
if (MODE === null) fail(`unrecognised flags ${JSON.stringify(FLAGS)} (allowed: none, --calibrate)`);

const supervisorSha = sha256(SUPERVISOR_PATH);
const expectedSupervisorSha = process.env.REZO_STEALTH_SUPERVISOR_SHA256;
if (!expectedSupervisorSha) fail('REZO_STEALTH_SUPERVISOR_SHA256 (the announced supervisor identity) is required');
if (supervisorSha !== expectedSupervisorSha) fail(`supervisor ${supervisorSha} differs from the announced ${expectedSupervisorSha}`);

// ——— frozen surfaces ———
const TOOL_CLOSURE = 'test/fixtures/stealth/tool-closure.json';
const PINNED_TOOL_CLOSURE_SHA256 = '38c0c9203670d5af8590581cb6b7e1a68fdad4defbc99fc073c5fa427e8651ed';
const CARRIERS = {
  SWF: 'test/a-plus-stealth-wire-fidelity.test.ts',
  SIS: 'test/a-plus-stealth-identity-isolation.test.ts',
  SRP: 'test/a-plus-stealth-route-parity.test.ts',
  ESH: 'test/a-plus-stealth-entry-shape.test.ts',
  SPC: 'test/a-plus-stealth-proxy-connect.test.ts',
};
const PINNED_CARRIERS = {
  SWF: '81de91893656d58751e8ee8e48780ad503dae2f75ee670a6a889e0579c3e97d8',
  SIS: '3085840965a5b8d82ce89759f24316212b8e384e6d6f8ec1f7fe6813d30c471d',
  SRP: '95a3df9f987b70817bbe3277d6a4a9cc934ada1b9f2298586f98badac5a32ff5',
  ESH: 'b9b75177fed7faedeb8de312dd82c936d0c228780a4b7c8ec6258b942d2a10c5',
  SPC: '1a8113b35ad586d98be9ad9ca1c265635eca03bad1b88fb60e25b01feb936981',
};
const families = ['C', 'F', 'S', 'E'];
const aspects = (adapter) => (adapter === 1 ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd', 'e', 'f']);
const swfRows = (prefix) => families.flatMap((family) => [1, 2].flatMap((adapter) => aspects(adapter).map((aspect) => `${prefix}-${family}${adapter}${aspect}`)));
const ROSTERS = Object.freeze({
  SWF: Object.freeze([...swfRows('SWF'), ...swfRows('SWF2'), 'SWF-grease', 'SWF-fallback']),
  SIS: Object.freeze(['SIS-01', 'SIS-02', 'SIS-03', 'SIS-04', 'SIS-05', 'SIS-06']),
  SRP: Object.freeze(['SRP-1-direct', 'SRP-1-str', 'SRP-1-obj', 'SRP-1-socks', 'SRP-2-direct', 'SRP-2-str', 'SRP-2-obj', 'SRP-2-socks', 'SRP-agent-1', 'SRP-agent-2', 'SRP-platform', 'SRP-consistency', 'SRP-curl-map', 'SRP-curl-refuse', 'SRP-curl-probe-fail']),
  // The TLS-fronted CONNECT rows (named finding) live in their own carrier so the route roster is fully GREEN for the mutation legs.
  SPC: Object.freeze(['SRP-1-connect', 'SRP-2-connect', 'SPC-03']),
  SRP_BUN: Object.freeze(['SRP-bun-socks']),
  ESH: Object.freeze(['ESH-01', 'ESH-02', 'ESH-03', 'ESH-04', 'ESH-05', 'ESH-06', 'ESH-07', 'ESH-08']),
});
const ROW_ID = /\b((?:SWF2?-[CFSE][12][a-f]|SWF-grease|SWF-fallback|SIS-\d{2}|SRP-[12]-(?:direct|str|obj|connect|socks)|SRP-bun-socks|SPC-\d{2}|SRP-agent-[12]|SRP-platform|SRP-consistency|SRP-curl-(?:map|refuse|probe-fail)|ESH-\d{2}))\b/u;

// Legs: literal command, tool identity, carriers and the FROZEN GREEN set per carrier (everything else in the roster must be RED).
const NODE = '/opt/homebrew/Cellar/node/25.9.0_2/bin/node';
const BUN = `${process.env.HOME}/.bun/bin/bun`;
const vitestArgs = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=300000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
// Bun prints only failing rows on a non-TTY; its JUnit reporter lists every testcase, so the Bun leg is judged from that XML.
const bunArgs = (carrier, junitPath) => ['test', '--timeout=300000', '--max-concurrency=1', '--retry=0', '--reporter=junit', `--reporter-outfile=${junitPath}`, carrier];
const LEGS = [
  { id: 'node', tool: 'node', command: (carrier) => [NODE, ...vitestArgs(carrier)], carriers: ['SWF', 'SIS', 'SRP', 'ESH', 'SPC'], rosters: { SWF: ROSTERS.SWF, SIS: ROSTERS.SIS, SRP: ROSTERS.SRP, ESH: ROSTERS.ESH, SPC: ROSTERS.SPC },
    // Phase 6 freeze — Node 25.9.0 (2026-08-29 05:15Z): route roster 15/15 GREEN, CONNECT finding isolated in SPC (RED); identities, cURL mapping and the public ./stealth entry (browser / Worker / RN / Deno / packed) fully GREEN; TLS-fronted CONNECT rows RED (named finding).
    frozenGreen: {
      SWF: [...ROSTERS.SWF],
      SIS: ['SIS-01', 'SIS-02', 'SIS-03', 'SIS-04', 'SIS-05', 'SIS-06'],
      SRP: ['SRP-1-direct', 'SRP-1-obj', 'SRP-1-socks', 'SRP-1-str', 'SRP-2-direct', 'SRP-2-obj', 'SRP-2-socks', 'SRP-2-str', 'SRP-agent-1', 'SRP-agent-2', 'SRP-consistency', 'SRP-curl-map', 'SRP-curl-probe-fail', 'SRP-curl-refuse', 'SRP-platform'],
      ESH: ['ESH-01', 'ESH-02', 'ESH-03', 'ESH-04', 'ESH-05', 'ESH-06', 'ESH-07', 'ESH-08'],
      SPC: ['SRP-1-connect', 'SRP-2-connect', 'SPC-03'],
    } },
  { id: 'bun', tool: 'bun', command: (carrier, junitPath) => [BUN, ...bunArgs(carrier, junitPath)], carriers: ['SWF', 'SIS', 'SRP', 'SPC'], rosters: { SWF: ROSTERS.SWF, SIS: ROSTERS.SIS, SRP: [...ROSTERS.SRP, ...ROSTERS.SRP_BUN], SPC: ROSTERS.SPC },
    // Phase 6 freeze — Bun 1.3.14 (2026-08-29 05:15Z): cURL rows GREEN; TLS/H1-order rows for both identity sets assert the recorded runtime boundary and rotation isolates sessions; Bun node:http2 SETTINGS/ALPN (*2a, *2e), the fallback row, and direct/SOCKS route parity remain RED (Bun follow-up).
    frozenGreen: {
      SWF: ['SWF-C1a', 'SWF-C1b', 'SWF-C1c', 'SWF-C2b', 'SWF-C2c', 'SWF-C2d', 'SWF-C2f', 'SWF-E1a', 'SWF-E1b', 'SWF-E1c', 'SWF-E2b', 'SWF-E2c', 'SWF-E2d', 'SWF-E2f', 'SWF-F1a', 'SWF-F1b', 'SWF-F1c', 'SWF-F2b', 'SWF-F2c', 'SWF-F2d', 'SWF-F2f', 'SWF-S1a', 'SWF-S1b', 'SWF-S1c', 'SWF-S2a', 'SWF-S2b', 'SWF-S2c', 'SWF-S2d', 'SWF-S2f', 'SWF-grease', 'SWF2-C1a', 'SWF2-C1b', 'SWF2-C1c', 'SWF2-C2b', 'SWF2-C2c', 'SWF2-C2d', 'SWF2-C2f', 'SWF2-E1a', 'SWF2-E1b', 'SWF2-E1c', 'SWF2-E2b', 'SWF2-E2c', 'SWF2-E2d', 'SWF2-E2f', 'SWF2-F1a', 'SWF2-F1b', 'SWF2-F1c', 'SWF2-F2b', 'SWF2-F2c', 'SWF2-F2d', 'SWF2-F2f', 'SWF2-S1a', 'SWF2-S1b', 'SWF2-S1c', 'SWF2-S2a', 'SWF2-S2b', 'SWF2-S2c', 'SWF2-S2d', 'SWF2-S2f'],
      SIS: ['SIS-01', 'SIS-02', 'SIS-03', 'SIS-04', 'SIS-05', 'SIS-06'],
      SRP: ['SRP-1-obj', 'SRP-1-str', 'SRP-2-obj', 'SRP-2-socks', 'SRP-2-str', 'SRP-agent-1', 'SRP-agent-2', 'SRP-consistency', 'SRP-curl-map', 'SRP-curl-probe-fail', 'SRP-curl-refuse', 'SRP-platform'],
      SPC: ['SRP-1-connect', 'SRP-2-connect', 'SPC-03'],
    } },
];
const MINIMUM_RUNTIME_GAP = 'advertised minimum Node 22 has no installed supported runtime older than 25.9.0 on this host (node@20 is below the minimum; /opt/homebrew/opt/node@24 is a dangling alias to Node 25); the minimum-runtime leg is a named gap until the Engineer installs node@22 or node@24';

// ——— opening pins ———
const toolClosureSha = sha256(TOOL_CLOSURE);
if (toolClosureSha !== PINNED_TOOL_CLOSURE_SHA256) fail(`tool closure ${toolClosureSha} !== pinned ${PINNED_TOOL_CLOSURE_SHA256}`);
const toolClosure = JSON.parse(readFileSync(TOOL_CLOSURE, 'utf8'));
const verifyToolClosure = (label) => {
  const problems = [];
  for (const [name, tool] of Object.entries(toolClosure.tools)) {
    if (tool.missing) continue;
    const path = tool.realpath ?? resolve(ROOT, tool.path);
    if (!existsSync(path)) { problems.push(`${label}: tool ${name} missing at ${path}`); continue; }
    const actual = sha256(path); if (actual !== tool.sha256) problems.push(`${label}: tool ${name} ${actual} !== ${tool.sha256}`);
    for (const dylib of tool.dylibs ?? []) { const found = existsSync(dylib.path) ? sha256(dylib.path) : null; if (found !== dylib.sha256) problems.push(`${label}: ${name} dylib ${dylib.path} drifted`); }
  }
  for (const group of ['stealthSources']) for (const file of toolClosure[group]) { const actual = sha256(resolve(ROOT, file.path)); if (actual !== file.sha256) problems.push(`${label}: ${file.path} ${actual} !== ${file.sha256}`); }
  for (const [file, expected] of Object.entries({ ...toolClosure.pins, ...toolClosure.fixtures })) { const actual = sha256(resolve(ROOT, file)); if (actual !== expected) problems.push(`${label}: ${file} ${actual} !== ${expected}`); }
  for (const [key, path] of Object.entries(CARRIERS)) { const actual = sha256(resolve(ROOT, path)); if (actual !== PINNED_CARRIERS[key]) problems.push(`${label}: carrier ${key} ${actual} !== ${PINNED_CARRIERS[key]}`); }
  return problems;
};
const openingProblems = verifyToolClosure('opening');
if (openingProblems.length) fail(JSON.stringify(openingProblems.slice(0, 8)));
const LEDGER = process.env.REZO_STEALTH_LEDGER;
if (!LEDGER) fail('REZO_STEALTH_LEDGER is required');
const ledgerAbs = resolve(LEDGER);
if (existsSync(ledgerAbs)) fail(`ledger already exists: ${ledgerAbs}`);
if (MODE === 'canonical' && ledgerAbs !== resolve(ROOT, 'plans/stealth-wire-fidelity-ledger.json')) fail('canonical mode writes exactly plans/stealth-wire-fidelity-ledger.json');

// ——— row parsing (vitest verbose glyphs; bun test (pass)/(fail)) ———
const ANSI = /\[[0-9;]*m/gu;
function rowsOf(log, tool) {
  const passed = new Set(); const failed = new Set(); const skipped = new Set(); const duplicates = new Set();
  const seen = (id) => passed.has(id) || failed.has(id) || skipped.has(id);
  for (const raw of log.split('\n')) {
    const line = raw.replace(ANSI, '').trimStart();
    const match = ROW_ID.exec(line); if (!match) continue; const id = match[1];
    let verdict = null;
    if (tool === 'node') verdict = line.startsWith('✓') ? 'pass' : line.startsWith('×') ? 'fail' : line.startsWith('↓') ? 'skip' : null;
    else verdict = line.startsWith('(pass)') ? 'pass' : line.startsWith('(fail)') ? 'fail' : line.startsWith('(skip)') || line.startsWith('(todo)') ? 'skip' : null;
    if (!verdict) continue;
    if (seen(id)) duplicates.add(id);
    (verdict === 'pass' ? passed : verdict === 'fail' ? failed : skipped).add(id);
  }
  return { passed: [...passed].sort(), failed: [...failed].sort(), skipped: [...skipped].sort(), duplicates: [...duplicates].sort() };
}
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** Bun JUnit XML: one <testcase name="<row> …"> per row, with a <failure> or <skipped> child when not green. */
function rowsOfJunit(xml) {
  const passed = new Set(); const failed = new Set(); const skipped = new Set(); const duplicates = new Set();
  const seen = (id) => passed.has(id) || failed.has(id) || skipped.has(id);
  const cases = xml.split('<testcase ').slice(1);
  for (const block of cases) {
    const name = /name="([^"]*)"/u.exec(block)?.[1] ?? '';
    const match = ROW_ID.exec(name.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&')); if (!match) continue; const id = match[1];
    const body = block.split('</testcase>')[0];
    const verdict = /<failure/u.test(body) ? 'fail' : /<skipped/u.test(body) ? 'skip' : 'pass';
    if (seen(id)) duplicates.add(id);
    (verdict === 'pass' ? passed : verdict === 'fail' ? failed : skipped).add(id);
  }
  return { passed: [...passed].sort(), failed: [...failed].sort(), skipped: [...skipped].sort(), duplicates: [...duplicates].sort() };
}

// ——— run legs ———
const results = [];
const junitDir = mkdtempSync(join(tmpdir(), 'stealth-supervisor-junit-'));
for (const leg of LEGS) {
  for (const key of leg.carriers) {
    const carrier = CARRIERS[key]; const roster = leg.rosters[key];
    const junitPath = join(junitDir, `${leg.id}-${key}.xml`);
    const argv = leg.command(carrier, junitPath);
    const started = new Date().toISOString();
    const run = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
    const log = `${run.stdout ?? ''}\n--- stderr ---\n${run.stderr ?? ''}`;
    const rows = leg.tool === 'bun' ? (existsSync(junitPath) ? rowsOfJunit(readFileSync(junitPath, 'utf8')) : { passed: [], failed: [], skipped: [], duplicates: [] }) : rowsOf(log, leg.tool);
    const invalid = [];
    if (run.error) invalid.push(`spawn error ${run.error.code ?? run.error.message}`);
    if (run.signal) invalid.push(`runner killed by ${run.signal}`);
    const reported = [...rows.passed, ...rows.failed, ...rows.skipped];
    if (rows.skipped.length) invalid.push(`skipped rows ${JSON.stringify(rows.skipped)}`);
    if (rows.duplicates.length) invalid.push(`duplicate rows ${JSON.stringify(rows.duplicates)}`);
    if (!sameSet(reported, roster)) invalid.push(`reported rows (${reported.length}) !== literal roster (${roster.length}); missing ${JSON.stringify(roster.filter((id) => !reported.includes(id)))} foreign ${JSON.stringify(reported.filter((id) => !roster.includes(id)))}`);
    const frozenGreen = leg.frozenGreen[key];
    const frozenRed = Array.isArray(frozenGreen) ? roster.filter((id) => !frozenGreen.includes(id)) : null;
    if (MODE === 'canonical') {
      if (!Array.isArray(frozenGreen)) invalid.push('no frozen GREEN set for this leg/carrier');
      else {
        const unexpectedGreen = rows.passed.filter((id) => !frozenGreen.includes(id)); const unexpectedRed = rows.failed.filter((id) => frozenGreen.includes(id));
        if (unexpectedGreen.length) invalid.push(`rows GREEN that are frozen RED: ${JSON.stringify(unexpectedGreen)}`);
        if (unexpectedRed.length) invalid.push(`rows RED that are frozen GREEN: ${JSON.stringify(unexpectedRed)}`);
      }
    } else invalid.push('calibration run: never valid');
    const record = { leg: leg.id, carrier: key, path: carrier, command: argv, started, exitCode: run.status, signal: run.signal, rosterCount: roster.length, observedGreen: rows.passed, observedRed: rows.failed, frozenGreen: Array.isArray(frozenGreen) ? frozenGreen : null, frozenRed, invalidities: invalid, valid: invalid.length === 0, logSha256: createHash('sha256').update(log).digest('hex') };
    results.push(record);
    console.log(`${leg.id} ${key}: green=${rows.passed.length} red=${rows.failed.length} of ${roster.length} ${invalid.length === 0 ? 'valid' : `INVALID ${JSON.stringify(invalid).slice(0, 400)}`}`);
    if (MODE === 'calibration') console.log(`  observed GREEN ${key}@${leg.id}: ${JSON.stringify(rows.passed)}`);
  }
}

// ——— close ———
const closingProblems = verifyToolClosure('closing');
const closingSupervisorSha = sha256(SUPERVISOR_PATH);
if (closingSupervisorSha !== expectedSupervisorSha) closingProblems.push(`closing supervisor ${closingSupervisorSha} !== announced ${expectedSupervisorSha}`);
const expectedRuns = LEGS.reduce((n, leg) => n + leg.carriers.length, 0);
const valid = MODE === 'canonical' && closingProblems.length === 0 && results.length === expectedRuns && results.every((r) => r.valid);
const ledger = { schema: 'rezo.stealth.wire-fidelity.ledger/v4-phase8', mode: MODE, supervisor: { path: relative(ROOT, SUPERVISOR_PATH), sha256: supervisorSha, closingSha256: closingSupervisorSha }, toolClosure: { path: TOOL_CLOSURE, sha256: toolClosureSha }, carriers: Object.fromEntries(Object.entries(CARRIERS).map(([key, path]) => [key, { path, sha256: PINNED_CARRIERS[key] }])), rosters: { SWF: ROSTERS.SWF.length, SIS: ROSTERS.SIS.length, SRP: ROSTERS.SRP.length, SRP_BUN: ROSTERS.SRP_BUN.length, ESH: ROSTERS.ESH.length, SPC: ROSTERS.SPC.length }, legs: LEGS.map((leg) => ({ id: leg.id, tool: leg.tool, carriers: leg.carriers })), minimumRuntimeGap: MINIMUM_RUNTIME_GAP, results, closingProblems, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${closingProblems.length ? ' closing=' + JSON.stringify(closingProblems).slice(0, 400) : ''}`);
process.exit(valid ? 0 : 1);
