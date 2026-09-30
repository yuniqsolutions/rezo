// R20 Fetch connect-phase + stream-close mutation legs — v3.1.
//
// Proves that the connect-phase carrier observes the Fetch adapter's pre-dispatch refusal of a positive
// timeout.connect (R16-R15, working ruling q5-o1), that the facade-close carrier observes the trailing `close` at both
// stream success terminals (R16-R10), that the redirect-visibility carrier observes the per-hop afterHeaders hooks and
// the redirect event (R16-R8) — also on a 3xx that is not followed (accepted manual redirect, maxRedirects: 0 denial) — and that the partial-body-salvage carrier observes the acceptPartialBody salvage (R16-R9): each leg applies one exact single-occurrence mutation to the pinned
// adapter, runs the carrier, requires the EXACT frozen set of rows to fail (every other row must pass), restores the
// file and verifies its identity again. Execution model, modes and admission are identical to R17/R18/R19.
//
// Modes (REZO_LEGS_MODE): canonical (ledger is exactly plans/r20-fetch-connect-phase-legs-ledger.json, must not exist)
// · dry-run · calibration (never valid) · signal-control (ledger is exactly plans/r20-fetch-connect-phase-legs-signal-controls.json).

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const fail = (message) => { console.error(`driver invalid: ${message}`); process.exit(2); };
const LAUNCH = globalThis.__REZO_LEGS_LAUNCH__;
if (!LAUNCH || !import.meta.url.startsWith('data:')) fail('this driver executes only as a data: snapshot started by the launcher inside the trusted bootstrap');
const ROOT = LAUNCH.root;
if (realpathSync(process.cwd()) !== realpathSync(ROOT)) fail(`cwd ${process.cwd()} is not the repository root ${ROOT}`);
const MODE = LAUNCH.mode;
if (!['canonical', 'dry-run', 'calibration', 'signal-control'].includes(MODE)) fail(`unsupported mode ${JSON.stringify(MODE)} for this driver`);
const SIGNAL_CHILD = process.env.REZO_LEGS_SIGNAL_CONTROL_CHILD === '1';
const DRIVER_PATH = LAUNCH.driver.path;

// The admission helper, executed from the exact bytes the launcher hashed.
const admission = await import(`data:text/javascript;base64,${LAUNCH.admission.bytes.toString('base64')}`);
const { admitBaseline, admitCensus, admitMutatedLeg, processGroupCensus, runCarrier, runtimeIdentity, runtimeDrift, sha256Text, verifyClosureTable, verifyEvidence } = admission;
const closures = JSON.parse(LAUNCH.closures.bytes.toString('utf8'));

const FETCH = 'src/adapters/fetch.ts';
const FC = 'test/a-plus-fetch-connect-phase.test.ts';
const FX = 'test/a-plus-fetch-facade-close.test.ts';
const FR = 'test/a-plus-fetch-redirect-visibility.test.ts';
const FS = 'test/a-plus-fetch-partial-body-salvage.test.ts';

// Pins are frozen from the GREEN epoch (Fetch connect-phase refusal + stream close, 2026-08-29); the driver refuses any other bytes before it mutates anything.
const PINNED = Object.freeze({
  [FETCH]: '186d790c8b6e8b424a794c5f220050e7be96abefccd199f041be54ce1da40eba',
  [FC]: '4db740212723cfec554d242cffd6b63c77afb8aa4a4a441bdba72fd8087c043d',
  [FX]: '230bf0b5dc3fa5f149a8515d05e3b8f71a64bb732514cae0a9a99e24263ca64e',
  [FR]: '192cea7187fce1375a2ea68b873b034efebd1edcb2550eec13e321f2acf2aaab',
  [FS]: '8ad0222dc3532b9454e525b2d16c01c6dfe4a34b732f2c68227111ddf0ef32a3',
});
const PINNED_NODE_VERSION = 'v25.9.0';
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_RUNTIME = Object.freeze({
  node: { version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' },
  vitest: { version: '4.1.4', runnerPath: 'node_modules/vitest/vitest.mjs', sha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' },
  lock: { path: 'bun.lock', sha256: 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53' },
  packageJson: { path: 'package.json', sha256: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8' },
});
const PINNED_AGGREGATE = '1ee739d1c23ae77e9f1b2d589e8f9887b734d35fa2dbb09d079ae516d4d60fc0';
const ROSTERS = Object.freeze({
  [FC]: Object.freeze(['FC-01', 'FC-02', 'FC-03', 'FC-04']),
  [FX]: Object.freeze(['FX-01', 'FX-02', 'FX-03', 'FX-04']),
  [FR]: Object.freeze(['FR-01', 'FR-02', 'FR-03', 'FR-04', 'FR-05', 'FR-06', 'FR-07']),
  [FS]: Object.freeze(['FS-01', 'FS-02', 'FS-03', 'FS-04', 'FS-05']),
});
const EXPECTED_LEG_IDS = Object.freeze(['MF-01', 'MF-02', 'MX-01', 'MX-02', 'MR-01', 'MR-02', 'MR-03', 'MS-01', 'MS-02']);
const VITEST_ARGS = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=120000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const ROW_ID = /\b((?:FC|FX|FR|FS)-\d{2})\b/u;
const SELF_TEST = 'test/legs-admission.test.mjs';
const SELF_ROW_ID = /\b(SA-\d{2})\b/u;
const SELF_ROSTER = Object.freeze(["SA-01","SA-02","SA-03","SA-04","SA-05","SA-06","SA-07","SA-08","SA-09","SA-10","SA-11","SA-12","SA-13","SA-14","SA-15","SA-16","SA-17","SA-18","SA-19","SA-20","SA-21","SA-22","SA-23","SA-24","SA-25","SA-26","SA-27","SA-28","SA-29","SA-30","SA-31"]);
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
if (process.version !== PINNED_NODE_VERSION) fail(`node ${process.version} differs from the pinned ${PINNED_NODE_VERSION}`);

// Stage identities: launch context, announced expectations and disk bytes must all agree.
const announced = (key) => { const value = process.env[key]; if (!value) fail(`${key} (announced identity) is required`); return value; };
const IDENTITY = {
  bootstrap: { sha256: announced('REZO_LEGS_BOOTSTRAP_SHA256') },
  launcher: { path: relative(ROOT, LAUNCH.launcher.path), executedBytesSha256: LAUNCH.launcher.executedBytesSha256, expectedSha256: announced('REZO_LEGS_LAUNCHER_SHA256') },
  driver: { path: relative(ROOT, DRIVER_PATH), executedBytesSha256: LAUNCH.driver.executedBytesSha256, expectedSha256: announced('REZO_LEGS_DRIVER_SHA256'), openingDiskSha256: sha256(DRIVER_PATH) },
  admission: { path: 'test/legs-admission.mjs', executedBytesSha256: LAUNCH.admission.sha256, expectedSha256: announced('REZO_LEGS_ADMISSION_SHA256'), openingDiskSha256: sha256('test/legs-admission.mjs') },
  selfTest: { path: SELF_TEST, sha256: LAUNCH.selfTest.sha256, expectedSha256: announced('REZO_LEGS_SELFTEST_SHA256'), openingDiskSha256: sha256(SELF_TEST) },
  closures: { path: 'test/legs-carrier-closures.json', sha256: LAUNCH.closures.sha256, expectedSha256: announced('REZO_LEGS_CLOSURES_SHA256'), openingDiskSha256: sha256('test/legs-carrier-closures.json') },
};
if (LAUNCH.bootstrap.sha256 !== IDENTITY.bootstrap.sha256) fail('launch context bootstrap identity differs from the announced one');
if (IDENTITY.launcher.executedBytesSha256 !== IDENTITY.launcher.expectedSha256) fail('executed launcher bytes differ from the announced identity');
for (const name of ['driver', 'admission']) if (IDENTITY[name].executedBytesSha256 !== IDENTITY[name].expectedSha256 || IDENTITY[name].openingDiskSha256 !== IDENTITY[name].expectedSha256) fail(`${name}: executed ${IDENTITY[name].executedBytesSha256} / disk ${IDENTITY[name].openingDiskSha256} / announced ${IDENTITY[name].expectedSha256} disagree`);
for (const name of ['selfTest', 'closures']) if (IDENTITY[name].sha256 !== IDENTITY[name].expectedSha256 || IDENTITY[name].openingDiskSha256 !== IDENTITY[name].expectedSha256) fail(`${name}: launch ${IDENTITY[name].sha256} / disk ${IDENTITY[name].openingDiskSha256} / announced ${IDENTITY[name].expectedSha256} disagree`);

// Environment: the launcher already runs inside the boundary; children get exactly the allowlist.
const ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'CURL_HOME', 'XDG_CONFIG_HOME', 'TZ', 'LANG', 'LC_ALL', 'NO_COLOR'];
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE']) if (key in process.env) fail(`preload-affecting ${key} present`);
for (const key of ENV_KEYS) if (!(key in process.env)) fail(`environment lacks ${key}`);
if (process.env.PATH !== closures.env.PATH) fail(`PATH ${JSON.stringify(process.env.PATH)} !== frozen ${JSON.stringify(closures.env.PATH)}`);
for (const [key, value] of Object.entries(closures.env.fixed)) if (process.env[key] !== value) fail(`${key}=${JSON.stringify(process.env[key])} !== frozen ${JSON.stringify(value)}`);
const CHILD_ENV = Object.freeze(Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])));
const curlOnPath = closures.env.PATH.split(':').map((dir) => join(dir, 'curl')).find((candidate) => existsSync(candidate)) ?? null;
if (curlOnPath !== closures.tools.curl.path) fail(`curl resolved from PATH is ${curlOnPath}, frozen tool is ${closures.tools.curl.path}`);
const PGREP_PATH = closures.tools.pgrep?.sha256 && existsSync(closures.tools.pgrep.path) ? closures.tools.pgrep.path : null;

// Closure surface: verified now, before and after every leg, and at close.
const verifySurface = (label) => verifyClosureTable(ROOT, closures).problems.map((problem) => `${label}: ${problem}`);
const openingSurface = verifySurface('opening');
if (openingSurface.length) fail(`closure surface not authenticated: ${JSON.stringify(openingSurface.slice(0, 8))}`);
const openingRuntime = runtimeIdentity(ROOT);
for (const drift of runtimeDrift(openingRuntime, PINNED_RUNTIME)) fail(`runtime ${drift}`);
const aggregate = () => sha256Text(Object.keys(PINNED).sort().map((file) => `${file}:${sha256(file)}`).join('\n'));
const openingAggregate = aggregate();
if (openingAggregate !== PINNED_AGGREGATE) fail(`opening aggregate ${openingAggregate} !== pinned ${PINNED_AGGREGATE}`);
const closureOf = (carrier) => new Set((closures.carriers[carrier]?.files ?? []).map((file) => file.path));

// Paths: a fresh scratch root outside the repository; the ledger inside the scratch root
// (dry-run / calibration) or exactly the repository author path (canonical, signal-control), never pre-existing.
const SCRATCH = process.env.REZO_LEGS_SCRATCH; const LEDGER = process.env.REZO_LEGS_LEDGER;
if (!SCRATCH || !LEDGER) fail('REZO_LEGS_SCRATCH and REZO_LEGS_LEDGER are both required');
const REPO_REAL = realpathSync(ROOT);
const canonicalParent = (p) => { let dir = resolve(p); while (!existsSync(dir)) dir = dirname(dir); return realpathSync(dir); };
const inside = (p, dir) => { const r = relative(dir, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const scratchAbs = resolve(SCRATCH); const ledgerAbs = resolve(LEDGER);
if (existsSync(scratchAbs)) fail(`scratch root already exists: ${scratchAbs}`);
if (inside(canonicalParent(scratchAbs), REPO_REAL)) fail(`scratch root ${scratchAbs} resolves inside the repository`);
if (existsSync(ledgerAbs)) fail(`ledger output already exists: ${ledgerAbs}`);
mkdirSync(scratchAbs, { recursive: true });
const SCRATCH_REAL = realpathSync(scratchAbs);
const CANONICAL_LEDGER = resolve(ROOT, 'plans/r20-fetch-connect-phase-legs-ledger.json');
if (MODE === 'canonical') { if (ledgerAbs !== CANONICAL_LEDGER) fail('canonical mode writes exactly plans/r20-fetch-connect-phase-legs-ledger.json'); }
else if (MODE === 'signal-control' && !SIGNAL_CHILD) { if (ledgerAbs !== resolve(ROOT, 'plans/r20-fetch-connect-phase-legs-signal-controls.json')) fail('signal-control mode writes exactly plans/r20-fetch-connect-phase-legs-signal-controls.json'); }
else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger must live inside the scratch root`);

// Opening identities, pinned before any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const MUTABLE = [FETCH];
const PRISTINE = Object.fromEntries(MUTABLE.map((file) => [file, resolve(scratchAbs, `${file.replace(/[\\/]/gu, '__')}.pristine`)]));
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// Legs: one exact single-occurrence mutation each, the carrier that must notice it, and the EXACT
// failed set frozen from the calibration pass. Every other row of that carrier must pass.
const LEGS = [
  { id: 'MF-01', title: 'connect-phase refusal removed: a positive timeout.connect is silently dropped again', file: FETCH, carrier: FC,
    from: "  if (typeof requestedConnectTimeout === 'number' && Number.isFinite(requestedConnectTimeout) && requestedConnectTimeout > 0) {\n", to: "  if (typeof requestedConnectTimeout === 'number' && Number.isFinite(requestedConnectTimeout) && requestedConnectTimeout > 0 && false) { // MUTATION MF-01\n", expectedFailed: ['FC-01', 'FC-02'] },
  { id: 'MF-02', title: 'refusal degraded to an untyped error', file: FETCH, carrier: FC,
    from: "      'REZ_UNSUPPORTED_CAPABILITY',\n      fetchOptions,\n    );\n  }\n\n  // The runtime's fetch owns the connection: no proxy can be applied here.", to: "      'REZ_UNKNOWN_ERROR', // MUTATION MF-02\n      fetchOptions,\n    );\n  }\n\n  // The runtime's fetch owns the connection: no proxy can be applied here.", expectedFailed: ['FC-01', 'FC-02'] },
  { id: 'MX-01', title: 'trailing close removed at the streaming success terminal', file: FETCH, carrier: FX,
    from: "    streamResult._markFinished();\n    // HTTP/1.1 parity (R16-R10): the piped wire ends the facade after the success trio — exactly one trailing `close`.\n    streamResult.end();\n", to: "    streamResult._markFinished(); // MUTATION MX-01: no trailing close\n", expectedFailed: ['FX-01'] },
  { id: 'MX-02', title: 'trailing close removed at the manual-redirect success terminal', file: FETCH, carrier: FX,
    from: "      // HTTP/1.1 parity (R16-R10): the piped wire ends the facade after the success trio, which is the consumer's `close`.\n      streamResult.end();\n", to: "      // MUTATION MX-02: no trailing close at the manual-redirect terminal\n", expectedFailed: ['FX-04'] },
  { id: 'MR-01', title: 'afterHeaders hooks skipped on every 3xx (followed, manual, denied)', file: FETCH, carrier: FR,
    from: "        if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {\n          const hopContentLength = response.headers.get('content-length');\n", to: "        if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0 && false) { // MUTATION MR-01\n          const hopContentLength = response.headers.get('content-length');\n", expectedFailed: ['FR-01', 'FR-02', 'FR-03', 'FR-05', 'FR-06', 'FR-07'] },
  { id: 'MR-02', title: 'redirect event never emitted on facades', file: FETCH, carrier: FR,
    from: "          eventEmitter.emit('redirect', redirectEvent);\n", to: "          void redirectEvent; // MUTATION MR-02: no redirect event\n", expectedFailed: ['FR-02'] },
  { id: 'MR-03', title: 'afterHeaders hooks skipped on a 3xx that is not followed (manual redirect, maxRedirects: 0 denial)', file: FETCH, carrier: FR,
    from: "        if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {\n          const hopContentLength = response.headers.get('content-length');\n", to: "        if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0 && fetchOptions.followRedirects !== false && config.maxRedirects !== 0) { // MUTATION MR-03\n          const hopContentLength = response.headers.get('content-length');\n", expectedFailed: ['FR-05', 'FR-06', 'FR-07'] },
  { id: 'MS-01', title: 'acceptPartialBody salvage condition disabled', file: FETCH, carrier: FS,
    from: "      fetchOptions.acceptPartialBody === true && bytes.byteLength > 0 && statusAccepted\n", to: "      fetchOptions.acceptPartialBody === true && bytes.byteLength > 0 && statusAccepted && false // MUTATION MS-01\n", expectedFailed: ['FS-01', 'FS-02'] },
  { id: 'MS-02', title: 'salvaged response no longer flagged truncated', file: FETCH, carrier: FS,
    from: "    if (salvagedTruncation) (finalResponse as RezoResponse<T> & { truncated?: boolean }).truncated = true;\n", to: "    // MUTATION MS-02: salvaged response not flagged truncated\n", expectedFailed: ['FS-01', 'FS-02'] },
];
for (const leg of LEGS) {
  const source = readFileSync(leg.file, 'utf8');
  const occurrences = source.split(leg.from).length - 1;
  if (occurrences !== 1) fail(`${leg.id}: anchor occurs ${occurrences} times in ${leg.file}`);
  if (!closureOf(leg.carrier).has(leg.file)) fail(`${leg.id}: ${leg.file} is not in the frozen closure of ${leg.carrier}`);
}
if (MODE === 'dry-run') { console.log(JSON.stringify({ driver: IDENTITY.driver.executedBytesSha256, opening, legs: LEGS.map((leg) => leg.id), closureFiles: closures.union.count, containmentSites: closures.containment.sites.length })); process.exit(0); }

// Restoration: guaranteed on every exit path including signals.
let mutatedFile = null; let finalized = false;
const restoreAll = () => { const restored = {}; for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(copy, file); restored[file] = sha256(file); } mutatedFile = null; return restored; };
const onSignal = (signal) => { if (finalized) return; const restored = mutatedFile ? restoreAll() : null; console.error(`driver interrupted by ${signal}; restored: ${JSON.stringify(restored)}`); process.exit(130); };
// SIGKILL cannot be intercepted: a killed driver leaves the mutated file on disk and the announced opening pins expose it.
for (const signal of SIGNALS) process.on(signal, () => onSignal(signal));

const identityBlock = () => ({ schema: null, mode: MODE, bootstrap: IDENTITY.bootstrap, launcher: IDENTITY.launcher, driver: { ...IDENTITY.driver, closingDiskSha256: sha256(DRIVER_PATH) }, admission: { ...IDENTITY.admission, closingDiskSha256: sha256('test/legs-admission.mjs') }, selfTest: { ...IDENTITY.selfTest, closingDiskSha256: sha256(SELF_TEST) }, closures: { ...IDENTITY.closures, closingDiskSha256: sha256('test/legs-carrier-closures.json'), union: closures.union.count, containmentSites: closures.containment.sites.length }, env: { keys: Object.keys(process.env).sort(), childEnv: CHILD_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, tools: { curlOnPath, pgrepDiagnostic: PGREP_PATH } });

// Signal-control CHILD: the real restoration path under a real signal — mutate the first leg, announce, wait.
if (SIGNAL_CHILD) {
  const leg = LEGS[0];
  const source = readFileSync(leg.file, 'utf8');
  writeFileSync(leg.file, source.replace(leg.from, leg.to)); mutatedFile = leg.file;
  console.log(`SIGNAL-CONTROL-READY ${leg.file} ${sha256(leg.file)}`);
  // A bare pending promise does not keep the event loop alive (Node exits 13 before any signal arrives);
  // the interval holds the process open until the parent's signal reaches the restoration handler.
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}

// Signal-control PARENT: four signals, each against a fresh child running this exact launcher + driver snapshot.
if (MODE === 'signal-control') {
  const controls = [];
  for (const signal of SIGNALS) {
    const childScratch = resolve(scratchAbs, `signal-${signal}`); const childLedger = resolve(childScratch, 'ledger.json');
    const childEnv = { ...process.env, REZO_LEGS_SIGNAL_CONTROL_CHILD: '1', REZO_LEGS_SCRATCH: childScratch, REZO_LEGS_LEDGER: childLedger };
    const record = { signal, ready: null, mutatedFile: null, mutatedSha: null, mutatedOnDisk: null, exitCode: null, exitSignal: null, stderrTail: '', restoredSha: null, census: null, childLedgerWritten: null, canonicalLedgerWritten: null, invalidities: [], valid: false };
    await new Promise((done) => {
      const child = spawn(process.execPath, ['--input-type=module', '--eval', LAUNCH.launcher.source], { cwd: ROOT, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = ''; let sent = false;
      const deadline = setTimeout(() => { if (!sent) { record.invalidities.push('child never announced readiness within 120s'); try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } } }, 120_000);
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
        const ready = /SIGNAL-CONTROL-READY (\S+) ([0-9a-f]{64})/u.exec(out);
        if (ready && !sent) {
          sent = true; record.ready = true; record.mutatedFile = ready[1]; record.mutatedSha = ready[2]; record.mutatedOnDisk = sha256(ready[1]);
          if (record.mutatedOnDisk !== record.mutatedSha) record.invalidities.push('announced mutated sha differs from disk');
          if (record.mutatedOnDisk === PINNED[ready[1]]) record.invalidities.push('child announced readiness without a mutation on disk');
          try { process.kill(child.pid, signal); } catch (error) { record.invalidities.push(`could not deliver ${signal}: ${error.code}`); }
        }
      });
      child.stderr.on('data', (chunk) => { err += chunk.toString(); });
      child.on('error', (error) => { record.invalidities.push(`child spawn error ${error.code ?? error.message}`); clearTimeout(deadline); done(); });
      child.on('exit', async (code, exitSignal) => {
        clearTimeout(deadline);
        record.exitCode = code; record.exitSignal = exitSignal; record.stderrTail = err.slice(-1500);
        record.restoredSha = record.mutatedFile ? sha256(record.mutatedFile) : null;
        record.census = await processGroupCensus(child.pid, { execPath: process.execPath, pgrepPath: PGREP_PATH, env: CHILD_ENV });
        done();
      });
    });
    if (record.ready !== true) record.invalidities.push('child never became ready');
    if (record.exitCode !== 130 || record.exitSignal !== null) record.invalidities.push(`child exit ${record.exitCode} signal ${record.exitSignal} (expected handler exit 130)`);
    if (!record.stderrTail.includes(`driver interrupted by ${signal}; restored:`)) record.invalidities.push('restoration handler did not report');
    if (record.mutatedFile && record.restoredSha !== PINNED[record.mutatedFile]) record.invalidities.push(`file not restored: ${record.restoredSha}`);
    admitCensus(record.census, `signal-control ${signal}`, record.invalidities);
    record.childLedgerWritten = existsSync(childLedger); if (record.childLedgerWritten) record.invalidities.push('killed child published a ledger');
    record.canonicalLedgerWritten = existsSync(CANONICAL_LEDGER); if (record.canonicalLedgerWritten) record.invalidities.push('canonical ledger appeared during signal controls');
    record.invalidities.push(...verifySurface(`after ${signal}`));
    record.valid = record.invalidities.length === 0;
    controls.push(record);
    console.log(`signal-control ${signal} ${record.valid ? 'valid' : `INVALID ${JSON.stringify(record.invalidities)}`}`);
  }
  finalized = true;
  const closingRuntime = runtimeIdentity(ROOT);
  const runInvalidities = [...runtimeDrift(closingRuntime, PINNED_RUNTIME).map((d) => `closing runtime ${d}`), ...verifySurface('closing')];
  if (aggregate() !== PINNED_AGGREGATE) runInvalidities.push('closing aggregate differs from the pin');
  const valid = controls.length === SIGNALS.length && controls.every((c) => c.valid) && runInvalidities.length === 0;
  const ledger = { ...identityBlock(), schema: 'rezo.r20.fetch-connect-phase-legs.signal-controls/v3.1', signals: SIGNALS, controlledLeg: { id: LEGS[0].id, file: LEGS[0].file }, controls, runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, invalidities: runInvalidities, valid };
  writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}`);
  process.exit(valid ? 0 : 1);
}

/** Raw runner logs are retained durably: next to the canonical ledger (`<ledger>-evidence/`) or inside the scratch root. */
const evidenceDir = MODE === 'canonical' ? ledgerAbs.replace(/\.json$/u, '-evidence') : resolve(scratchAbs, 'evidence');
if (existsSync(evidenceDir)) fail(`evidence directory already exists: ${evidenceDir}`);
mkdirSync(evidenceDir, { recursive: true });
const evidence = {};
const keepLog = (name, log, expectedSha) => {
  const path = resolve(evidenceDir, `${name}.log`); writeFileSync(path, log);
  const problem = verifyEvidence(path, expectedSha); if (problem !== null) fail(problem);
  const rel = relative(ROOT, path); evidence[rel] = expectedSha; return rel;
};
const carrierRun = (target) => runCarrier({ execPath: process.execPath, args: VITEST_ARGS(target), cwd: ROOT, timeoutMs: LEG_TIMEOUT_MS, pgrepPath: PGREP_PATH, env: CHILD_ENV });
const runRecord = (run) => ({ command: [process.execPath, ...run.args], exitCode: run.spawn.status, signal: run.spawn.signal, timedOut: run.spawn.error?.code === 'ETIMEDOUT', pid: run.pid, census: run.census });

// Self-test gate: the admission helper's own regressions must reproduce the LITERAL SA roster exactly
// (the same closed baseline predicate that judges the carriers) — a validator that cannot fail is not a validator.
const selfRun = await carrierRun(SELF_TEST); selfRun.args = VITEST_ARGS(SELF_TEST);
const selfAdmitted = admitBaseline({ spawn: selfRun.spawn, log: selfRun.log, rowId: SELF_ROW_ID, roster: SELF_ROSTER });
admitCensus(selfRun.census, 'self-test', selfAdmitted.invalid);
if (sha256(SELF_TEST) !== IDENTITY.selfTest.expectedSha256) selfAdmitted.invalid.push('self-test file changed before the gate');
const selfTest = { ...IDENTITY.selfTest, roster: SELF_ROSTER, total: SELF_ROSTER.length, runnerSummary: selfAdmitted.summary, report: selfAdmitted.shape, rows: selfAdmitted.rows, ...runRecord(selfRun), log: { path: keepLog('self-test', selfRun.log, selfRun.logSha256), sha256: selfRun.logSha256 }, invalidities: selfAdmitted.invalid, valid: selfAdmitted.invalid.length === 0 };
console.log(`self-test ${SELF_TEST} rows=${SELF_ROSTER.length} ${selfTest.valid ? 'valid' : `INVALID ${JSON.stringify(selfAdmitted.invalid)}`}`);
if (!selfTest.valid) { finalized = true; writeFileSync(ledgerAbs, `${JSON.stringify({ ...identityBlock(), schema: 'rezo.legs.ledger/self-test-refused', selfTest, valid: false }, null, 2)}\n`); console.log(`ledger ${ledgerAbs} mode=${MODE} valid=false (self-test refused)`); process.exit(1); }

// Baselines: every carrier runs unmutated first and must reproduce its LITERAL roster exactly.
const baselines = {};
const runInvalidities = [];
for (const carrier of [...new Set(LEGS.map((leg) => leg.carrier))]) {
  if (!ROSTERS[carrier]) fail(`no literal roster for ${carrier}`);
  const run = await carrierRun(carrier); run.args = VITEST_ARGS(carrier);
  const admitted = admitBaseline({ spawn: run.spawn, log: run.log, rowId: ROW_ID, roster: ROSTERS[carrier] });
  admitCensus(run.census, `baseline ${carrier}`, admitted.invalid);
  baselines[carrier] = { roster: ROSTERS[carrier], total: ROSTERS[carrier].length, runnerSummary: admitted.summary, report: admitted.shape, rows: admitted.rows, ...runRecord(run), log: { path: keepLog(`baseline__${carrier.replace(/[\\/]/gu, '__')}`, run.log, run.logSha256), sha256: run.logSha256 }, invalidities: admitted.invalid, valid: admitted.invalid.length === 0 };
  if (admitted.invalid.length) runInvalidities.push(`baseline ${carrier}: ${admitted.invalid.join('; ')}`);
  console.log(`baseline ${carrier} rows=${ROSTERS[carrier].length} ${admitted.invalid.length === 0 ? 'valid' : `INVALID ${JSON.stringify(admitted.invalid)}`}`);
}
runInvalidities.push(...verifySurface('after baselines'));

const results = [];
for (const leg of LEGS) {
  const record = { id: leg.id, title: leg.title, file: leg.file, carrier: leg.carrier, expectedFailed: leg.expectedFailed, expectedSuiteFailures: leg.expectedSuiteFailures ?? [] };
  const invalid = [...verifySurface(`${leg.id} before mutation`)];
  let mutatedSha = null; let restoredSha = null; let run = null;
  try {
    const source = readFileSync(leg.file, 'utf8');
    writeFileSync(leg.file, source.replace(leg.from, leg.to)); mutatedFile = leg.file; mutatedSha = sha256(leg.file);
    if (mutatedSha === PINNED[leg.file]) invalid.push('mutation produced identical bytes');
    run = await carrierRun(leg.carrier); run.args = VITEST_ARGS(leg.carrier);
    record.log = { path: keepLog(leg.id, run.log, run.logSha256), sha256: run.logSha256 };
  } finally {
    copyFileSync(PRISTINE[leg.file], leg.file); restoredSha = sha256(leg.file); if (restoredSha === PINNED[leg.file]) mutatedFile = null;
  }
  if (restoredSha !== PINNED[leg.file]) invalid.push(`restore mismatch ${restoredSha}`);
  invalid.push(...verifySurface(`${leg.id} after restore`));
  const baseline = baselines[leg.carrier];
  let rows = { failed: [], passed: [], skipped: [], duplicates: [] }; let summary = null; let shape = null;
  if (run === null) invalid.push('runner never spawned');
  else {
    admitCensus(run.census, leg.id, invalid);
    if (!baseline.valid) invalid.push('baseline invalid: the literal roster was not reproduced');
    else { const admitted = admitMutatedLeg({ spawn: run.spawn, log: run.log, rowId: ROW_ID, roster: ROSTERS[leg.carrier], expectedFailed: leg.expectedFailed, expectedSuiteFailures: leg.expectedSuiteFailures ?? [], mode: MODE }); invalid.push(...admitted.invalid); rows = admitted.rows; summary = admitted.summary; shape = admitted.shape; }
  }
  Object.assign(record, run === null ? { command: [process.execPath, ...VITEST_ARGS(leg.carrier)], exitCode: null, signal: null, timedOut: false, pid: null, census: null } : runRecord(run), { runnerSummary: summary, report: shape, rows, mutatedSha, restoredSha, invalidities: invalid, valid: invalid.length === 0 });
  results.push(record);
  console.log(`${leg.id} ${leg.carrier} failed=${JSON.stringify(rows.failed)} passed=${rows.passed.length} ${invalid.length === 0 ? 'valid' : `INVALID ${JSON.stringify(invalid)}`}`);
}
finalized = true;

// Closing: every identity is re-derived from the disk, never trusted from the opening snapshot.
const closing = Object.fromEntries(Object.keys(PINNED).map((file) => [file, sha256(file)]));
for (const [file, actual] of Object.entries(closing)) if (actual !== PINNED[file]) runInvalidities.push(`closing identity ${file} ${actual}`);
const closingAggregate = aggregate(); if (closingAggregate !== PINNED_AGGREGATE) runInvalidities.push(`closing aggregate ${closingAggregate} !== pinned ${PINNED_AGGREGATE}`);
const identity = identityBlock();
for (const name of ['driver', 'admission', 'selfTest', 'closures']) if (identity[name].closingDiskSha256 !== identity[name].expectedSha256) runInvalidities.push(`closing ${name} disk ${identity[name].closingDiskSha256} !== announced ${identity[name].expectedSha256}`);
const closingRuntime = runtimeIdentity(ROOT); runInvalidities.push(...runtimeDrift(closingRuntime, PINNED_RUNTIME).map((d) => `closing runtime ${d}`));
runInvalidities.push(...verifySurface('closing'));
for (const [rel, expected] of Object.entries(evidence)) { const problem = verifyEvidence(resolve(ROOT, rel), expected); if (problem !== null) runInvalidities.push(`closing ${problem}`); }
const censuses = [selfTest, ...Object.values(baselines), ...results].map((r) => r.census);
if (!censuses.every((c) => c && c.observed && c.empty === true)) runInvalidities.push('not every process-group census was observed empty');
const resultIds = results.map((r) => r.id);
if (JSON.stringify(resultIds) !== JSON.stringify(EXPECTED_LEG_IDS)) runInvalidities.push(`result ids ${JSON.stringify(resultIds)} !== expected ${JSON.stringify(EXPECTED_LEG_IDS)}`);
if (JSON.stringify(Object.keys(baselines).sort()) !== JSON.stringify([...new Set(LEGS.map((leg) => leg.carrier))].sort())) runInvalidities.push('baseline carriers differ from the legs\' carriers');
const valid = MODE === 'canonical' && selfTest.valid && runInvalidities.length === 0 && results.length === EXPECTED_LEG_IDS.length && results.every((r) => r.valid) && Object.values(baselines).every((b) => b.valid);
const ledger = { ...identity, schema: 'rezo.r20.fetch-connect-phase-legs.ledger/v3.1', runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, rosters: ROSTERS, expectedLegIds: EXPECTED_LEG_IDS, legTimeoutMs: LEG_TIMEOUT_MS, evidenceDir: relative(ROOT, evidenceDir), evidence, census: { backend: 'signal-0 (primary, live→reaped sentinel control per census); pgrep diagnostic only', boundary: 'signal-0 proves the detached carrier group empty; escape into another group/session is excluded by the authenticated containment table, never assumed' }, selfTest, baselines, results, invalidities: runInvalidities, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 600) : ''}`);
process.exit(valid ? 0 : 1);
