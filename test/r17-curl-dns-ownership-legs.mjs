// R17 cURL/DNS ownership mutation legs — v3.1.
//
// Proves that the cURL lifecycle/redirect carriers and the DNS transport carrier observe the
// source they claim to observe: each leg applies one exact single-occurrence mutation to a
// pinned source file, runs the carrier that must notice it, requires the EXACT frozen set of
// rows to fail (every other row must pass), restores the file and verifies its identity again.
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
// plans/r17-curl-dns-ownership-legs-ledger.json, must not exist) · dry-run (pins and anchors only) ·
// calibration (runs every leg, never valid) · signal-control (4 signals × restoration proof; ledger is
// exactly plans/r17-curl-dns-ownership-legs-signal-controls.json).

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

const CURL = 'src/adapters/curl.ts';
const CURL_REDIRECT_HOP = 'src/adapters/curl-redirect-hop.ts';
const CURL_EXIT_CODE = 'src/adapters/curl-exit-code.ts';
const DNS_CACHE = 'src/cache/dns-cache.ts';
const HTTP = 'src/adapters/http.ts';
const CRM = 'test/a-plus-curl-redirect-method-parity.test.ts';
const CLO = 'test/a-plus-curl-lifecycle-ownership.test.ts';
const CFC = 'test/a-plus-curl-facade-contract.test.ts';
const DNS = 'test/a-plus-dns-cache-transport.test.ts';

// Pins are frozen from the GREEN epoch; the driver refuses any other bytes before it mutates anything.
const PINNED = Object.freeze({
  [CURL]: '5c8dc5a6d4e6f171021117a26751866875daeb695532176ba0013f26480dfd99',
  [CURL_REDIRECT_HOP]: 'd8c3b89abe034fba5b296f7e61402ca82a734cae0899bac148adb12d46deabe1',
  [CURL_EXIT_CODE]: '899041cf8cbeb700e886cdc00cc57c63c1dff621ec1aabffd5ee5e940ab143cb',
  [DNS_CACHE]: 'e7b09149741f23bd2a2282bd0c8fafbb9fc88a93c1413d757792cd8a117dd10e',
  [HTTP]: 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  [CRM]: 'b427759819acf8dd43d5594ae97d62621974dbcc3957cbb27ff9560dd7895ce3',
  [CLO]: '620724d102cadd23b8b9c7bb57ddbc9446ef9b48c1d5cacb1f213be2cd37a9ed',
  [CFC]: '6de58ddb73e850387df0396c0d6b289140c4b41dfbe70526d098fd933ad58b62',
  [DNS]: '6dd08cf87d5cbb6fcaf448a587c4025d379b9c957154606c1b536c1363946e7d',
});
const PINNED_NODE_VERSION = 'v25.9.0';
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_RUNTIME = Object.freeze({
  node: { version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' },
  vitest: { version: '4.1.4', runnerPath: 'node_modules/vitest/vitest.mjs', sha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' },
  lock: { path: 'bun.lock', sha256: 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53' },
  packageJson: { path: 'package.json', sha256: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8' },
});
const PINNED_AGGREGATE = 'e922c0f06dd72941f7ae894c54b8425e9553711e065321a1f365040407d80691';
const ROSTERS = Object.freeze({
  [CRM]: Object.freeze(["CRM-01","CRM-02","CRM-03","CRM-04","CRM-05","CRM-06","CRM-07","CRM-08","CRM-09","CRM-10","CRM-11","CRM-12","CRM-13A","CRM-13B","CRM-14","CRM-15","CRM-16","CRM-17","CRM-18","CRM-19","CRM-20","CRM-21","CRM-22"]),
  [CLO]: Object.freeze(["CLO-01","CLO-02","CLO-02B","CLO-03","CLO-04","CLO-05","CLO-06","CLO-07","CLO-08","CLO-09","CLO-10","CLO-11","CLO-12","CLO-13","CLO-14","CLO-15"]),
  [CFC]: Object.freeze(["CFC-01","CFC-02","CFC-03","CFC-04","CFC-05","CFC-06","CFC-07","CFC-08","CFC-09","CFC-10","CFC-11","CFC-12","CFC-13","CFC-14","CFC-15","CFC-16","CFC-17","CFC-18","CFC-19","CFC-20a","CFC-20b","CFC-20c","CFC-21","CFC-22","CFC-23","CFC-24","CFC-25","CFC-26"]),
  [DNS]: Object.freeze(["DNS-01","DNS-02","DNS-03A","DNS-03B","DNS-04","DNS-05N","DNS-06","DNS-07","DNS-08","DNS-09","DNS-10","DNS-11","DNS-12A","DNS-12S","DNS-13A","DNS-13S","DNS-14","DNS-15","DNS-16A","DNS-16B","DNS-16C","DNS-17","DNS-18C","DNS-18F","DNS-18H","DNS-18R","DNS-18X"]),
});
const EXPECTED_LEG_IDS = Object.freeze(["M-C1","M-C2","M-C3","M-C4","M-C5","M-C6","M-C7","M-C8","M-C9","M-C10","M-C12","M-D1","L-C1a","L-C1b","L-C2a","L-C2b","L-C2c","L-C3a","L-C3b","L-C4","L-C5a","L-C5d","L-C5b","L-C5c","L-C6a","L-C6b","L-C6d"]);
const VITEST_ARGS = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=60000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const ROW_ID = /\b((?:CRM|CLO|DNS)-[0-9]{2}[A-Z]?|CFC-[0-9]{2}[a-c]?)\b/u;
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
const CANONICAL_LEDGER = resolve(ROOT, 'plans/r17-curl-dns-ownership-legs-ledger.json');
if (MODE === 'canonical') { if (ledgerAbs !== CANONICAL_LEDGER) fail('canonical mode writes exactly plans/r17-curl-dns-ownership-legs-ledger.json'); }
else if (MODE === 'signal-control' && !SIGNAL_CHILD) { if (ledgerAbs !== resolve(ROOT, 'plans/r17-curl-dns-ownership-legs-signal-controls.json')) fail('signal-control mode writes exactly plans/r17-curl-dns-ownership-legs-signal-controls.json'); }
else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger must live inside the scratch root`);

// Opening identities, pinned before any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const MUTABLE = [CURL, CURL_REDIRECT_HOP, HTTP];
const PRISTINE = Object.fromEntries(MUTABLE.map((file) => [file, resolve(scratchAbs, `${file.replace(/[\\/]/gu, '__')}.pristine`)]));
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// Legs: one exact single-occurrence mutation each, the carrier that must notice it, and the EXACT
// failed set frozen from the calibration pass. Every other row of that carrier must pass.
const LEGS = [
  { id: 'M-C1', title: 'redirect hop rewrite keeps the method on 301/302/303', file: CURL_REDIRECT_HOP, carrier: CRM,
    from: "  if (status === 301 || status === 302 || status === 303) return { dropBody: true, method: 'GET', url };\n", to: "  // MUTATION M-C1: the method survives every hop\n", expectedFailed: ['CRM-01', 'CRM-02', 'CRM-03', 'CRM-04', 'CRM-05', 'CRM-06', 'CRM-07', 'CRM-08', 'CRM-09', 'CRM-10', 'CRM-11', 'CRM-12', 'CRM-14', 'CRM-15', 'CRM-16', 'CRM-18', 'CRM-19', 'CRM-20', 'CRM-21', 'CRM-22'] },
  { id: 'M-C2', title: 'credential boundary removed from adapter-owned hops', file: CURL, carrier: CRM,
    from: '    const headers = prepareRedirectHeaders(inherited, relation);\n', to: '    const headers = new RezoHeaders(inherited); // MUTATION M-C2\n', expectedFailed: ['CRM-18'] },
  { id: 'M-C3', title: 'curl.locationTrusted ignored by adapter-owned hops', file: CURL, carrier: CRM,
    from: "    const relation = locationTrusted ? 'same-origin' : classifyRedirectOrigin(fromUrl, plan.url);\n", to: '    const relation = classifyRedirectOrigin(fromUrl, plan.url); // MUTATION M-C3\n', expectedFailed: ['CRM-19'] },
  { id: 'M-C4', title: 'redirect limit not enforced on adapter-owned hops', file: CURL, carrier: CRM,
    from: '        if (adapterHops > config.maxRedirects) {\n', to: '        if (adapterHops > config.maxRedirects + 1000) { // MUTATION M-C4\n', expectedFailed: ['CRM-16'] },
  { id: 'M-C5', title: 'headers phase never armed', file: CURL, carrier: CLO,
    from: "        if (stagedPhases.hasPhase('headers')) stagedPhases.startPhase('headers');\n        headerPoll = setInterval(observeHeaders, 15);\n", to: '        headerPoll = setInterval(observeHeaders, 15); // MUTATION M-C5\n', expectedFailed: ['CLO-01', 'CLO-03'] },
  { id: 'M-C6', title: 'body phase never armed', file: CURL, carrier: CLO,
    from: "        stagedPhases.clearPhase('headers');\n        stopHeaderPoll();\n        if (stagedPhases.hasPhase('body')) stagedPhases.startPhase('body');\n", to: "        stagedPhases.clearPhase('headers');\n        stopHeaderPoll(); // MUTATION M-C6\n", expectedFailed: ['CLO-02B'] },
  { id: 'M-C7', title: 'retry delay not raced against the total budget', file: CURL, carrier: CLO,
    from: '            if (currentDelay > 0) {\n              await awaitRetryDelay(currentDelay, totalDeadline, config, originalRequest, callerSignal);\n              throwIfCallerAborted();\n            }\n', to: '            if (currentDelay > 0) {\n              await new Promise<void>((resolve) => setTimeout(resolve, currentDelay)); // MUTATION M-C7\n            }\n', expectedFailed: ['CLO-04'] },
  { id: 'M-C8', title: 'missing stage accepted at commit', file: CURL, carrier: CLO,
    from: 'function commitStagedDownload(target: StagedDownloadTarget | null): void {\n  if (!target) return;\n', to: 'function commitStagedDownload(target: StagedDownloadTarget | null): void {\n  if (!target || !fs.existsSync(target.stagedPath)) return; // MUTATION M-C8\n', expectedFailed: ['CLO-05'] },
  { id: 'M-C9', title: 'stage discard removed from the abort path (left to the child close)', file: CURL, carrier: CLO,
    from: "        curl.kill('SIGKILL');\n        discardStagedDownload(downloadTarget);\n        notifyCurlAbortHooks(config, originalRequest, startedAt, 'signal', message);\n", to: "        curl.kill('SIGKILL');\n        notifyCurlAbortHooks(config, originalRequest, startedAt, 'signal', message); // MUTATION M-C9\n", expectedFailed: ['CLO-06'] },
  { id: 'M-C10', title: '1xx blocks counted as hops', file: CURL, carrier: CLO,
    from: "    const blocks = this.parseAllHttpResponses(headerDump).filter((block) => block.headers !== '' && !this.isInformationalBlock(block.headers));\n", to: "    const blocks = this.parseAllHttpResponses(headerDump).filter((block) => block.headers !== ''); // MUTATION M-C10\n", expectedFailed: ['CLO-07'] },
  { id: 'M-C12', title: 'body phase not restarted by body bytes', file: CURL, carrier: CLO,
    from: "        if (stagedPhases.hasPhase('body')) stagedPhases.startPhase('body');\n        publishDownloadProgress();\n", to: '        publishDownloadProgress(); // MUTATION M-C12\n', expectedFailed: ['CLO-02'] },
  { id: 'M-D1', title: 'DNS lookup projected on the pool-off path only', file: HTTP, carrier: DNS,
    from: '  } else if (dnsCacheOption !== false) {\n', to: '  } else if (dnsCacheOption !== false && !useAgentPool) { // MUTATION M-D1\n', expectedFailed: ['DNS-04', 'DNS-12A', 'DNS-12S', 'DNS-13A', 'DNS-13S', 'DNS-14', 'DNS-15', 'DNS-16A', 'DNS-16B', 'DNS-16C'],
    expectedSuiteFailures: [{ file: DNS, message: "AssertionError: expected [ …(10) ] to deeply equal []" }] },
  // cURL facade contract legs (PLAN/curl-facade-contract r10, Phase 3): one mechanism each, anchored on the landed Phase 2 diff.
  { id: 'L-C1a', title: 'exit 22 no longer a complete transfer: a rejected status settles through the exit-code map', file: CURL, carrier: CFC,
    from: "          const transferComplete = code === 0 || (code === 22 && dump !== '');\n", to: "          const transferComplete = code === 0; // MUTATION L-C1a\n", expectedFailed: ['CFC-01', 'CFC-08', 'CFC-09', 'CFC-13', 'CFC-14', 'CFC-15', 'CFC-19', 'CFC-21', 'CFC-24', 'CFC-25'] },
  { id: 'L-C1b', title: 'stream-facade validator invocation removed (default 2xx rule only)', file: CURL, carrier: CFC,
    from: "            accepted = validate === null ? true : Boolean((validate ?? ((status: number) => status >= 200 && status < 300))(head.status));\n", to: "            accepted = head.status >= 200 && head.status < 300; // MUTATION L-C1b\n", expectedFailed: ['CFC-02', 'CFC-16', 'CFC-17'] },
  { id: 'L-C2a', title: 'success terminal: _markFinished() and the trailing close removed', file: CURL, carrier: CFC,
    from: "            streamResult._markFinished();\n            streamResult.emit('close');\n", to: "            // MUTATION L-C2a\n", expectedFailed: ['CFC-03', 'CFC-07', 'CFC-08', 'CFC-17'] },
  { id: 'L-C2b', title: 'manual-redirect stream terminal: _markFinished() and close removed', file: CURL, carrier: CFC,
    from: "      streamResponse._markFinished();\n      streamResponse.emit('close');\n", to: "      // MUTATION L-C2b\n", expectedFailed: ['CFC-04'] },
  { id: 'L-C2c', title: 'manual-redirect upload terminal never marks the facade finished', file: CURL, carrier: CFC,
    from: "      uploadResponse.emit('complete', terminal);\n      uploadResponse._markFinished();\n", to: "      uploadResponse.emit('complete', terminal); // MUTATION L-C2c\n", expectedFailed: ['CFC-06'] },
  { id: 'L-C3a', title: 'download stage committed instead of discarded for a rejected or unfollowed response', file: CURL, carrier: CFC,
    from: "            const cleanupFailure = discardStagedDownload(downloadTarget);\n            if (cleanupFailure) run.stats.downloadCleanupFailure = cleanupFailure;\n            resolve(response);\n            return;\n", to: "            commitStagedDownload(downloadTarget); // MUTATION L-C3a\n            resolve(response);\n            return;\n", expectedFailed: ['CFC-05', 'CFC-19', 'CFC-25'] },
  { id: 'L-C3b', title: 'staging cleanup failure swallowed again (no cause on the public error)', file: CURL, carrier: CFC,
    from: "            if (downloadResponse && stats.downloadCleanupFailure) attachDownloadTargetFailureCause(httpError, httpError, stats.downloadCleanupFailure);\n", to: "            // MUTATION L-C3b\n", expectedFailed: ['CFC-25'] },
  { id: 'L-C4', title: 'header-time events published for every attempt, not only the terminal one', file: CURL, carrier: CFC,
    from: "            if (!continues) publishHeaderTimeEvents();\n            else run.stats.deferredHeaderEvents = publishHeaderTimeEvents;\n", to: "            publishHeaderTimeEvents(); // MUTATION L-C4\n", expectedFailed: ['CFC-08', 'CFC-21', 'CFC-24'] },
  { id: 'L-C5a', title: 'total deadline dropped from the Retry-After wait interrupt', file: CURL, carrier: CFC,
    from: "            const waitInterrupt = combineWaitInterrupts(callerSignal, totalDeadline?.signal);\n", to: "            const waitInterrupt = combineWaitInterrupts(callerSignal, undefined); // MUTATION L-C5a\n", expectedFailed: ['CFC-14', 'CFC-15'] },
  { id: 'L-C5d', title: 'caller signal dropped from the Retry-After wait interrupt', file: CURL, carrier: CFC,
    from: "            const waitInterrupt = combineWaitInterrupts(callerSignal, totalDeadline?.signal);\n", to: "            const waitInterrupt = combineWaitInterrupts(undefined, totalDeadline?.signal); // MUTATION L-C5d\n", expectedFailed: ['CFC-09'] },
  { id: 'L-C5b', title: 'retry delay no longer ends on a caller abort', file: CURL, carrier: CFC,
    from: "    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });\n", to: "    // MUTATION L-C5b\n", expectedFailed: ['CFC-13'] },
  { id: 'L-C5c', title: 'child not killed on a caller abort', file: CURL, carrier: CFC,
    from: "        const abortError = RezoError.createAbortError(message, config, originalRequest);\n        curl.kill('SIGKILL');\n", to: "        const abortError = RezoError.createAbortError(message, config, originalRequest); // MUTATION L-C5c\n", expectedFailed: ['CFC-23', 'CFC-26'] },
  { id: 'L-C6a', title: 'per-hop redirect emission removed', file: CURL, carrier: CFC,
    from: "        this.publishRedirectHop(plan, response, config, adapterHops, streamResult ?? downloadResult ?? uploadResult);\n", to: "        // MUTATION L-C6a\n", expectedFailed: ['CFC-07', 'CFC-20c'] },
  { id: 'L-C6b', title: 'Authorization boundary removed from adapter-owned hops (the hop Cookie is jar-derived either way, so CFC-20b stays green)', file: CURL, carrier: CFC,
    from: '    const headers = prepareRedirectHeaders(inherited, relation);\n', to: '    const headers = new RezoHeaders(inherited); // MUTATION L-C6b\n', expectedFailed: ['CFC-20a'] },
  { id: 'L-C6d', title: 'destinationUrl normalisation reverted (raw Location)', file: CURL_REDIRECT_HOP, carrier: CFC,
    from: '  const url = new URL(location, currentUrl).toString();\n', to: '  const url = location; // MUTATION L-C6d\n', expectedFailed: ['CFC-07', 'CFC-20c'] },
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
  const ledger = { ...identityBlock(), schema: 'rezo.r17.ownership-legs.signal-controls/v3.1', signals: SIGNALS, controlledLeg: { id: LEGS[0].id, file: LEGS[0].file }, controls, runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, invalidities: runInvalidities, valid };
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
const ledger = { ...identity, schema: 'rezo.r17.ownership-legs.ledger/v3.1', runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, rosters: ROSTERS, expectedLegIds: EXPECTED_LEG_IDS, legTimeoutMs: LEG_TIMEOUT_MS, evidenceDir: relative(ROOT, evidenceDir), evidence, census: { backend: 'signal-0 (primary, live→reaped sentinel control per census); pgrep diagnostic only', boundary: 'signal-0 proves the detached carrier group empty; escape into another group/session is excluded by the authenticated containment table, never assumed' }, selfTest, baselines, results, invalidities: runInvalidities, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 600) : ''}`);
process.exit(valid ? 0 : 1);
