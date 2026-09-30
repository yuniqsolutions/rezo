// R18 lifecycle-ownership mutation legs — v3.1.
//
// Proves that the carriers landed in the 2026-08-23 reopen observe the mechanisms they claim:
// pending proxy-handshake destruction, the cumulative HTTP/2 establishment budget and its
// SOCKS taxonomy, lifecycle-hook containment with a fresh event per hook, the single public
// error publisher of the cURL facades with cleanup before every publication, download-mode
// body ownership from the stage file, and the clock checkpoints after synchronous afterHeaders/
// afterParse hooks. One exact single-occurrence mutation per leg, the carrier that must notice
// it, the EXACT frozen failed set; restore + closing identity after every leg.
//
// v3.1 execution model (tayo #rezo 66948/66957/67012/67025/67038/67076/67128): this module is never
// executed from disk. The trusted bootstrap (`test/legs-bootstrap.mjs`, inline first JavaScript
// inside an `env -i` boundary) authenticates every stage and the full closure table, then starts the
// launcher as a snapshot of its verified bytes; the launcher executes this driver from a data: URL of
// the exact bytes it hashed, and this driver executes the admission helper the same way. The process
// group census is signal-0 with a live→reaped sentinel control per census (pgrep is diagnostic only);
// the full closure table — 74 runtime source files, tools, dylibs, package aggregates, configs and
// every child-process creation site — is verified at open, before and after every leg, and at close.
//
// Modes (REZO_LEGS_MODE, carried by the launch context): canonical (ledger is exactly
// plans/r18-lifecycle-ownership-legs-ledger.json, must not exist) · dry-run (pins and anchors only) ·
// calibration (runs every leg, never valid) · signal-control (4 signals × restoration proof; ledger is
// exactly plans/r18-lifecycle-ownership-legs-signal-controls.json).

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

const HTTP = 'src/adapters/http.ts';
const HTTP2 = 'src/adapters/http2.ts';
const CURL = 'src/adapters/curl.ts';
const STAGED = 'src/utils/staged-timeout.ts';
const HELPER = 'src/shared/contain-lifecycle-hook.ts';
const HTTPS_PROXY = 'src/internal/agents/https-proxy.ts';
const HTO = 'test/a-plus-http-timeout-concurrency.test.ts';
const HS = 'test/a-plus-http2-staged-timeouts.test.ts';
const LHC = 'test/a-plus-lifecycle-hook-containment.test.ts';
const HOD = 'test/a-plus-hook-overrun-deadline.test.ts';
const CLO = 'test/a-plus-curl-lifecycle-ownership.test.ts';

// Pins are frozen from the GREEN epoch; the driver refuses any other bytes before it mutates anything.
const PINNED = Object.freeze({
  [HTTP]: 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  [HTTP2]: 'fdf5df4e6138b48abcd696fb462dff69ccd041f4d4b83c856aa7356ea0bc47a7',
  [CURL]: '5c8dc5a6d4e6f171021117a26751866875daeb695532176ba0013f26480dfd99',
  [STAGED]: '665b55f2b2ee9f2b07c6e70c3f3f3a234e500c9b22f26bd184602c8e6008f6c7',
  [HELPER]: '7ffb6783a8e9fc5ce00e2caf6cbe4b8431b772d4d7f63135a0ec14be1035d368',
  [HTTPS_PROXY]: 'a02c480599bbd0c009b45cf5415501c68e6ae00289a15e21051953dd2a9ebeee',
  [HTO]: '36f752e50ef60fd22ae0e8aa21ba940864991b46f9c2286b072e47392ac98366',
  [HS]: '9d317ec261a7db1e33e3fe5443c0e051ae20aa2b5e38ab1fa45111002cb7609d',
  [LHC]: '1bf1032d95062dfe289daded1749c363c0260985ab77fb1c4f8e04b293c7d16f',
  [HOD]: 'ed46dc8116e1ac31d1b5546845ffe24ffcf11f865a4b23a36cb0a5cb8a4b6d74',
  [CLO]: '620724d102cadd23b8b9c7bb57ddbc9446ef9b48c1d5cacb1f213be2cd37a9ed',
});
const PINNED_NODE_VERSION = 'v25.9.0';
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_RUNTIME = Object.freeze({
  node: { version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' },
  vitest: { version: '4.1.4', runnerPath: 'node_modules/vitest/vitest.mjs', sha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' },
  lock: { path: 'bun.lock', sha256: 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53' },
  packageJson: { path: 'package.json', sha256: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8' },
});
const PINNED_AGGREGATE = '8acbb3e2364ab9f244cde7a90d9d60f58e70d41f5eaf7c44a8ac007c4caba591';
const ROSTERS = Object.freeze({
  [HTO]: Object.freeze(["HTO-01","HTO-02","HTO-03C","HTO-03F","HTO-03H","HTO-03R","HTO-03X","HTO-04","HTO-05","HTO-06","HTO-07","HTO-08","HTO-09","HTO-10","HTO-11","HTO-12","HTO-13","HTO-14","HTO-15","HTO-16","HTO-17B","HTO-17D","HTO-17S","HTO-17U","HTO-18C","HTO-19P","HTO-20P","HTO-21P","HTO-22P"]),
  [HS]: Object.freeze(["HS-01","HS-02","HS-03","HS-04","HS-05","HS-06","HS-07","HS-08","HS-09","HS-10","HS-11","HS-12"]),
  [LHC]: Object.freeze(["LHC-01","LHC-02","LHC-03","LHC-11","LHC-12","LHC-13","LHC-20","LHC-21","LHC-22","LHC-23","LHC-24"]),
  [HOD]: Object.freeze(["HOD-01","HOD-02","HOD-11","HOD-12","HOD-21","HOD-22","HOD-31","HOD-32","HOD-41","HOD-42","HOD-51","HOD-52","HOD-61","HOD-62"]),
  [CLO]: Object.freeze(["CLO-01","CLO-02","CLO-02B","CLO-03","CLO-04","CLO-05","CLO-06","CLO-07","CLO-08","CLO-09","CLO-10","CLO-11","CLO-12","CLO-13","CLO-14","CLO-15"]),
});
const EXPECTED_LEG_IDS = Object.freeze(["M-L1","M-L2","M-L3","M-L4","M-L5","M-L6","M-L7","M-L8","M-L9","M-L10","M-L11","M-L12","M-L13","M-L14","M-L15","M-L16","M-L17"]);
const VITEST_ARGS = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=60000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const ROW_ID = /\b((?:HTO|HS|LHC|HOD|CLO)-[0-9]{2}[A-Z]?)\b/u;
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
const CANONICAL_LEDGER = resolve(ROOT, 'plans/r18-lifecycle-ownership-legs-ledger.json');
if (MODE === 'canonical') { if (ledgerAbs !== CANONICAL_LEDGER) fail('canonical mode writes exactly plans/r18-lifecycle-ownership-legs-ledger.json'); }
else if (MODE === 'signal-control' && !SIGNAL_CHILD) { if (ledgerAbs !== resolve(ROOT, 'plans/r18-lifecycle-ownership-legs-signal-controls.json')) fail('signal-control mode writes exactly plans/r18-lifecycle-ownership-legs-signal-controls.json'); }
else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger must live inside the scratch root`);

// Opening identities, pinned before any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const MUTABLE = [HTTP, HTTP2, CURL, HELPER, HTTPS_PROXY];
const PRISTINE = Object.fromEntries(MUTABLE.map((file) => [file, resolve(scratchAbs, `${file.replace(/[\\/]/gu, '__')}.pristine`)]));
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// Legs: one exact single-occurrence mutation each, the carrier that must notice it, and the EXACT
// failed set frozen from the calibration pass. Every other row of that carrier must pass.
const LEGS = [
  { id: 'M-L1', title: 'pending CONNECT/SOCKS handshake not torn down at settlement', file: HTTP, carrier: HTO,
    from: '          destroyPendingProxyHandshake(req, error);\n        };\n        timeoutManager.setTimeoutCallback(', to: '          // MUTATION M-L1: handshake socket left to the proxy\n        };\n        timeoutManager.setTimeoutCallback(', expectedFailed: ['HTO-21P', 'HTO-22P'],
    expectedSuiteFailures: [{ file: HTO, message: "AssertionError: expected [ …(3) ] to deeply equal []" }] },
  { id: 'M-L2', title: 'handshake socket never registered by the CONNECT agent', file: HTTPS_PROXY, carrier: HTO,
    from: '    trackPendingProxyHandshake(req, socket);\n', to: '    // MUTATION M-L2: nothing registered\n', expectedFailed: ['HTO-21P'],
    expectedSuiteFailures: [{ file: HTO, message: "AssertionError: expected [ …(2) ] to deeply equal []" }] },
  { id: 'M-L3', title: 'TLS over CONNECT gets no establishment budget', file: HTTP2, carrier: HS,
    from: '                const tlsBudget = remainingUntil(establishmentDeadlineAt);\n', to: '                const tlsBudget = remainingUntil(undefined); // MUTATION M-L3\n', expectedFailed: ['HS-07'] },
  { id: 'M-L4', title: 'SOCKS handshake timeout not mapped to the connect taxonomy', file: HTTP2, carrier: HS,
    from: "            if (err instanceof Error && err.message === SOCKS_PROXY_CONNECTION_TIMEOUT_MESSAGE) {\n", to: "            if (err instanceof Error && err.message === 'never') { // MUTATION M-L4\n", expectedFailed: ['HS-10'] },
  { id: 'M-L5', title: 'aborted caller no longer cancels its pending session creation', file: HTTP2, carrier: HS,
    from: "      const onAbort = (): void => creation.cancel(new Error('HTTP/2 session acquisition aborted by the caller'));\n", to: "      const onAbort = (): void => undefined; // MUTATION M-L5\n", expectedFailed: ['HS-12'] },
  { id: 'M-L6', title: 'returned thenables no longer assimilated by the helper', file: HELPER, carrier: LHC,
    from: '  void Promise.resolve(outcome).then(undefined, report);\n', to: '  return; // MUTATION M-L6\n', expectedFailed: ['LHC-01', 'LHC-02', 'LHC-03', 'LHC-11', 'LHC-12', 'LHC-13', 'LHC-20', 'LHC-21', 'LHC-22', 'LHC-24'] },
  { id: 'M-L7', title: 'H1 abort hooks share one event object', file: HTTP, carrier: LHC,
    from: "  for (const hook of hooks) {\n    // Fresh event per hook: one hook's mutation never reaches the next.\n    containLifecycleHook(() => hook({ reason, message, url, elapsed, timestamp: Date.now() }, config), (hookError) => {\n      if (config.debug) console.log('[Rezo Debug] onAbort hook error:', hookError);\n    });\n  }\n}\n\nasync function request<T>(", to: "  const shared = { reason, message, url, elapsed, timestamp: Date.now() }; // MUTATION M-L7\n  for (const hook of hooks) {\n    containLifecycleHook(() => hook(shared, config), (hookError) => {\n      if (config.debug) console.log('[Rezo Debug] onAbort hook error:', hookError);\n    });\n  }\n}\n\nasync function request<T>(", expectedFailed: ['LHC-11'] },
  { id: 'M-L8', title: 'H2 abort hooks share one event object', file: HTTP2, carrier: LHC,
    from: "  for (const hook of hooks) {\n    // Fresh event per hook: one hook's mutation never reaches the next.\n    containLifecycleHook(() => hook({ reason, message: error.message, url, elapsed, timestamp: Date.now() }, config), (hookError) => {", to: "  const shared = { reason, message: error.message, url, elapsed, timestamp: Date.now() }; // MUTATION M-L8\n  for (const hook of hooks) {\n    containLifecycleHook(() => hook(shared, config), (hookError) => {", expectedFailed: ['LHC-12'] },
  { id: 'M-L9', title: 'cURL abort hooks share one event object', file: CURL, carrier: LHC,
    from: "  for (const hook of hooks) {\n    // Fresh event per hook: one hook's mutation never reaches the next.\n    containLifecycleHook(() => hook({ reason, message, url, elapsed, timestamp: Date.now() }, config), (hookError) => {", to: "  const shared = { reason, message, url, elapsed, timestamp: Date.now() }; // MUTATION M-L9\n  for (const hook of hooks) {\n    containLifecycleHook(() => hook(shared, config), (hookError) => {", expectedFailed: ['LHC-13'] },
  { id: 'M-L10', title: 'H1 afterHeaders checkpoint removed', file: HTTP, carrier: HOD,
    from: "              if (terminalState !== 'open' || settleOverdueBudget()) return;\n", to: "              if (terminalState !== 'open') return; // MUTATION M-L10\n", expectedFailed: ['HOD-01', 'HOD-11'] },
  { id: 'M-L11', title: 'H1 afterParse checkpoint removed (buffered/upload)', file: HTTP, carrier: HOD,
    from: '              const overdueAfterParse = totalOverdueAfterParse();\n              if (overdueAfterParse) { settlePromise(overdueAfterParse); return; }\n', to: '              // MUTATION M-L11: no afterParse checkpoint\n', expectedFailed: ['HOD-31', 'HOD-51'] },
  { id: 'M-L12', title: 'H2 afterHeaders checkpoint removed', file: HTTP2, carrier: HOD,
    from: '              if (resolved || settleOverdueDeadlines()) return;\n', to: '              if (resolved) return; // MUTATION M-L12\n', expectedFailed: ['HOD-02', 'HOD-12'] },
  { id: 'M-L13', title: 'H2 afterParse checkpoint removed', file: HTTP2, carrier: HOD,
    from: '          if (requestDeadline && performance.now() >= requestDeadline.expiresAt) {\n            releaseSessionLease();\n', to: '          if (requestDeadline && performance.now() >= requestDeadline.expiresAt + 1e9) { // MUTATION M-L13\n            releaseSessionLease();\n', expectedFailed: ['HOD-32', 'HOD-52'] },
  { id: 'M-L14', title: 'cURL facades publish the error themselves again (second terminal)', file: CURL, carrier: CLO,
    from: '      const settleWithError = (error: RezoError): void => { reject(error); };\n', to: "      const settleWithError = (error: RezoError): void => { streamResult?.emit('error', error); downloadResult?.emit('error', error); uploadResult?.emit('error', error); reject(error); }; // MUTATION M-L14\n", expectedFailed: ['CLO-06', 'CLO-09', 'CLO-10', 'CLO-11', 'CLO-12', 'CLO-13', 'CLO-15'] },
  { id: 'M-L15', title: 'cURL abort publishes hooks before the stage is discarded', file: CURL, carrier: CLO,
    from: "        curl.kill('SIGKILL');\n        discardStagedDownload(downloadTarget);\n        notifyCurlAbortHooks(config, originalRequest, startedAt, 'signal', message);\n", to: "        curl.kill('SIGKILL');\n        notifyCurlAbortHooks(config, originalRequest, startedAt, 'signal', message);\n        discardStagedDownload(downloadTarget); // MUTATION M-L15\n", expectedFailed: ['CLO-06'] },
  { id: 'M-L16', title: 'download body phase not restarted by stage growth', file: CURL, carrier: CLO,
    from: "          receivedBytes = stageBytes;\n          if (stagedPhases.hasPhase('body')) stagedPhases.startPhase('body');\n          publishDownloadProgress();\n", to: "          receivedBytes = stageBytes;\n          publishDownloadProgress(); // MUTATION M-L16\n", expectedFailed: ['CLO-14'] },
  { id: 'M-L17', title: 'download progress no longer published from stage growth', file: CURL, carrier: CLO,
    from: "          if (stagedPhases.hasPhase('body')) stagedPhases.startPhase('body');\n          publishDownloadProgress();\n        }, 15);\n", to: "          if (stagedPhases.hasPhase('body')) stagedPhases.startPhase('body'); // MUTATION M-L17\n        }, 15);\n", expectedFailed: ['CLO-14'] },
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
  const ledger = { ...identityBlock(), schema: 'rezo.r18.lifecycle-ownership-legs.signal-controls/v3.1', signals: SIGNALS, controlledLeg: { id: LEGS[0].id, file: LEGS[0].file }, controls, runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, invalidities: runInvalidities, valid };
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
const ledger = { ...identity, schema: 'rezo.r18.lifecycle-ownership-legs.ledger/v3.1', runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, rosters: ROSTERS, expectedLegIds: EXPECTED_LEG_IDS, legTimeoutMs: LEG_TIMEOUT_MS, evidenceDir: relative(ROOT, evidenceDir), evidence, census: { backend: 'signal-0 (primary, live→reaped sentinel control per census); pgrep diagnostic only', boundary: 'signal-0 proves the detached carrier group empty; escape into another group/session is excluded by the authenticated containment table, never assumed' }, selfTest, baselines, results, invalidities: runInvalidities, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 600) : ''}`);
process.exit(valid ? 0 : 1);
