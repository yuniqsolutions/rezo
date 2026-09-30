// R21 HTTP facade-contract mutation legs — v3.1.
//
// Proves that the epoch's carriers observe the HTTP/1.1 exact-once stream verdict (HD-3), the total deadline over every wait
// (HD-4), the DECISION-058 URL error classes, the HTTP/2 validator taxonomy and absolute redirect payload, the terminal-attempt
// late-flush of header-time events on all three adapters, and the packed stealth declarations: each leg applies one exact
// single-occurrence mutation to a pinned file, runs the carrier, requires the EXACT frozen set of rows to fail (every other row
// must pass), restores the file and verifies its identity again. Execution model, modes and admission are identical to R17–R20.
//
// Modes (REZO_LEGS_MODE): canonical (ledger is exactly plans/r21-http-facade-legs-ledger.json, must not exist)
// · dry-run · calibration (never valid) · signal-control (ledger is exactly plans/r21-http-facade-legs-signal-controls.json).

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

const SHARED_WAIT = 'src/shared/combine-wait-interrupts.ts';
const HTTP = 'src/adapters/http.ts';
const HTTP2 = 'src/adapters/http2.ts';
const FETCH = 'src/adapters/fetch.ts';
const HTTP_CONFIG = 'src/utils/http-config.ts';
const TLS = 'src/stealth/tls-fingerprint.ts';
const PACKAGE = 'package.json';
const WORKER = 'src/platform/worker.ts';
const HSD = 'test/a-plus-http-stream-status-decision.test.ts';
const HW = 'test/a-plus-http-wait-cancellation.test.ts';
const RU = 'test/a-plus-relative-url-resolution.test.ts';
const H2S = 'test/a-plus-http2-stream-facade-contract.test.ts';
const TH = 'test/a-plus-terminal-header-visibility.test.ts';
const SDR = 'test/a-plus-stealth-declaration-resolution.test.ts';
const EDGE = 'test/a-plus-edge-entry-resolution.test.ts';

// Pins are frozen from the GREEN epoch (HTTP facade contract, 2026-08-29 21:20Z); the driver refuses any other bytes before it mutates anything.
const PINNED = Object.freeze({
  [SHARED_WAIT]: '7b51aebbdb802b6624eeb33d1a5c5067e8655c1e5a50573693a0a363b9224f17',
  [HTTP]: 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  [HTTP2]: 'fdf5df4e6138b48abcd696fb462dff69ccd041f4d4b83c856aa7356ea0bc47a7',
  [FETCH]: '186d790c8b6e8b424a794c5f220050e7be96abefccd199f041be54ce1da40eba',
  [HTTP_CONFIG]: 'ab33e9d5e78f112bc63741e62cc3790c388e822f54bf9b696b66c38a87973c21',
  [TLS]: '2f7d79721c47b9561df39bfa9d2692be236729dc5b7097b9c201f3e9394eef28',
  [PACKAGE]: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8',
  [WORKER]: 'f984a6edcb61f5003a2744c4f401d2374d1036d98fa4980ba323cf4ac6581216',
  [HSD]: 'b0ebefc2e88f4755af0422e95435893c6d9ffec0f5a8f329bf360ed1eb7720c6',
  [HW]: 'f453914ab7dc77ea91389c7d423a101c799b67f2ba157f677b06d146770ff7d0',
  [RU]: 'aa2ef6199d79ab586b86b0f22afe2575906864f77fe394012bb7ccc54a97987c',
  [H2S]: '5f2db66fd9446b8263cb659f54f9844f502e710318e525f3f9b95702c2e4fd5e',
  [TH]: '03b80028b9899154e12027b0907f0e4149189a92b9211f78796115222f20aabb',
  [SDR]: '10d8bf73640cbbedfae689d727c1ce8fbe0dc3f045d52c20930cee38801714e4',
  [EDGE]: '43fa493ac98860004c238e45ec3883c4575cd07b4b7b0ac9536c281e425deb56',
});
const PINNED_NODE_VERSION = 'v25.9.0';
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_RUNTIME = Object.freeze({
  node: { version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' },
  vitest: { version: '4.1.4', runnerPath: 'node_modules/vitest/vitest.mjs', sha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' },
  lock: { path: 'bun.lock', sha256: 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53' },
  packageJson: { path: 'package.json', sha256: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8' },
});
const PINNED_AGGREGATE = 'd7f2561875190c23710ea9766fd6bf13fd7327f733e5c4f03c7834a892496d1e';
const ROSTERS = Object.freeze({
  [HSD]: Object.freeze(['HSD-01', 'HSD-02', 'HSD-03', 'HSD-04', 'HSD-05', 'HSD-06', 'HSD-07', 'HSD-08', 'HSD-09', 'HSD-10', 'HSD-11']),
  [HW]: Object.freeze(['HW-01', 'HW-02', 'HW-03', 'HW-04', 'HW-05', 'HW-06', 'HW-07', 'HW-08', 'HW-09', 'HW-10', 'HW-11', 'HW-12']),
  [RU]: Object.freeze(['RU-01', 'RU-02', 'RU-03']),
  [H2S]: Object.freeze(['H2S-01', 'H2S-02', 'H2S-03', 'H2S-04', 'H2S-05', 'H2S-06', 'H2S-07', 'H2S-08', 'H2S-09', 'H2S-10', 'H2S-11', 'H2S-12', 'H2S-16']),
  [TH]: Object.freeze(['TH-01', 'TH-02', 'TH-03', 'TH-04', 'TH-05', 'TH-06', 'TH-07', 'TH-08', 'TH-09', 'TH-10', 'TH-11', 'TH-12', 'TH-13', 'TH-14', 'TH-15']),
  [SDR]: Object.freeze(['SDR-01', 'SDR-02', 'SDR-03', 'SDR-04', 'SDR-05', 'SDR-06', 'SDR-07']),
  [EDGE]: Object.freeze(['ER-01', 'ER-02', 'ER-03', 'ER-04', 'ER-05', 'ER-06', 'ER-07', 'ER-08', 'ER-09', 'ER-10', 'ER-11', 'ER-12', 'ER-13']),
});
const EXPECTED_LEG_IDS = Object.freeze(['L21-01', 'L21-02', 'L21-03', 'L21-04', 'L21-05', 'L21-06', 'L21-07', 'L21-08', 'L21-09', 'L21-10', 'L21-11', 'L21-12', 'L21-13', 'L21-14', 'L21-15', 'L21-16', 'L21-17', 'L21-18', 'L21-19', 'L21-20', 'L21-21', 'L21-22']);
const VITEST_ARGS = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=400000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const ROW_ID = /\b((?:HSD|HW|RU|H2S|TH|SDR|ER)-\d{2})\b/u;
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
const CANONICAL_LEDGER = resolve(ROOT, 'plans/r21-http-facade-legs-ledger.json');
if (MODE === 'canonical') { if (ledgerAbs !== CANONICAL_LEDGER) fail('canonical mode writes exactly plans/r21-http-facade-legs-ledger.json'); }
else if (MODE === 'signal-control' && !SIGNAL_CHILD) { if (ledgerAbs !== resolve(ROOT, 'plans/r21-http-facade-legs-signal-controls.json')) fail('signal-control mode writes exactly plans/r21-http-facade-legs-signal-controls.json'); }
else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger must live inside the scratch root`);

// Opening identities, pinned before any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const MUTABLE = [SHARED_WAIT, HTTP, HTTP2, FETCH, HTTP_CONFIG, TLS, PACKAGE, WORKER];
const PRISTINE = Object.fromEntries(MUTABLE.map((file) => [file, resolve(scratchAbs, `${file.replace(/[\\/]/gu, '__')}.pristine`)]));
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// Legs: one exact single-occurrence mutation each, the carrier that must notice it, and the EXACT
// failed set frozen from the calibration pass. Every other row of that carrier must pass.
const LEGS = [
  { id: 'L21-01', title: 'HD-3: buffered fallback re-consults the validator instead of the recorded stream verdict', file: HTTP, carrier: HSD,
    from: "                (recordedStatusVerdict !== undefined ? recordedStatusVerdict.accepted\n", to: "                (false ? false\n", expectedFailed: ['HSD-07'] },
  { id: 'L21-02', title: 'HD-3: buffered-branch salvage re-consults the validator', file: HTTP, carrier: HSD,
    from: "                if (recordedStatusVerdict !== undefined ? recordedStatusVerdict.accepted : (fetchOptions.validateStatus === null || _validateStatus(statusCode))) {\n", to: "                if (fetchOptions.validateStatus === null || _validateStatus(statusCode)) { // MUTATION L21-02\n", expectedFailed: ['HSD-08', 'HSD-10'] },
  { id: 'L21-03', title: 'HD-3: stream verdict never recorded', file: HTTP, carrier: HSD,
    from: "            recordedStatusVerdict = { accepted: streamStatusAccepted };\n", to: "            // MUTATION L21-03: verdict not recorded\n", expectedFailed: ['HSD-07', 'HSD-08', 'HSD-10'] },
  { id: 'L21-04', title: 'HD-4: total deadline dropped from the shared wait interrupt (src/shared/combine-wait-interrupts.ts)', file: SHARED_WAIT, carrier: HW,
    from: "  const sources = [callerSignal, totalSignal].filter((signal): signal is AbortSignal => signal !== undefined);\n", to: "  const sources = [callerSignal].filter((signal): signal is AbortSignal => signal !== undefined); // MUTATION L21-04\n", expectedFailed: ['HW-05', 'HW-06', 'HW-07'] },
  { id: 'L21-05', title: 'HD-4: combined wait interrupt listeners never released', file: HTTP, carrier: HW,
    from: "            waitInterrupt.release();\n", to: "            // MUTATION L21-05: listeners not released\n", expectedFailed: ['HW-11'] },
  { id: 'L21-06', title: 'DECISION-058: every unresolvable URL wrapped as RezoError (malformed absolute loses its native class)', file: HTTP_CONFIG, carrier: RU,
    from: "        if (isRelative && baseURL === undefined) {\n", to: "        if (true) { // MUTATION L21-06\n", expectedFailed: ['RU-03'] },
  { id: 'L21-07', title: 'DECISION-058: relative URL without a base rethrows the native error', file: HTTP_CONFIG, carrier: RU,
    from: "        if (isRelative && baseURL === undefined) {\n", to: "        if (isRelative && baseURL === undefined && false) { // MUTATION L21-07\n", expectedFailed: ['RU-01'] },
  { id: 'L21-08', title: 'H2: validator throw held until the body ends (prompt settlement removed)', file: HTTP2, carrier: H2S,
    from: "          if (responseValidationFailure !== undefined) throw responseValidationFailure.thrown;\n", to: "          // MUTATION L21-08: validator throw held until the body ends\n", expectedFailed: ['H2S-10', 'H2S-11'] },
  { id: 'L21-09', title: 'H2: falsy thrown validator values dropped', file: HTTP2, carrier: H2S,
    from: "            responseValidationFailure = { thrown: error };\n", to: "            responseValidationFailure = error ? { thrown: error } : undefined; // MUTATION L21-09\n", expectedFailed: ['H2S-11'] },
  { id: 'L21-10', title: 'H2: manual-redirect validator throw escapes into the transport taxonomy', file: HTTP2, carrier: H2S,
    from: "            } catch (thrown) {\n              throw buildH2CallbackFailure(thrown, config, fetchOptions);\n            }\n", to: "            } catch (thrown) {\n              throw thrown; // MUTATION L21-10\n            }\n", expectedFailed: ['H2S-12'] },
  { id: 'L21-11', title: 'H2: redirect payload carries the raw Location', file: HTTP2, carrier: H2S,
    from: "            destinationUrl: absoluteRedirectDestination(location, String(fetchOptions.fullUrl || fetchOptions.url)),\n", to: "            destinationUrl: location, // MUTATION L21-11\n", expectedFailed: ['H2S-16'] },
  { id: 'L21-12', title: 'late-flush removed on HTTP/1.1 (refused attempt loses its header-time events)', file: HTTP, carrier: TH,
    from: "        _stats.deferredHeaderEvents?.();\n        _stats.deferredHeaderEvents = undefined;\n        throw httpError;\n", to: "        throw httpError; // MUTATION L21-12\n", expectedFailed: ['TH-02', 'TH-03', 'TH-04', 'TH-05'] },
  { id: 'L21-13', title: 'late-flush removed on Fetch', file: FETCH, carrier: TH,
    from: "        _stats.deferredHeaderEvents?.();\n        _stats.deferredHeaderEvents = undefined;\n        throw httpError;\n", to: "        throw httpError; // MUTATION L21-13\n", expectedFailed: ['TH-12', 'TH-13', 'TH-14', 'TH-15'] },
  { id: 'L21-14', title: 'late-flush removed on HTTP/2 at the condition refusal', file: HTTP2, carrier: TH,
    from: "            if (!retryAllowed) {\n              // Refused here: this attempt is terminal, so its held header-time events are published before the error.\n              _stats.deferredHeaderEvents?.();\n              _stats.deferredHeaderEvents = undefined;\n              throw httpError;\n            }\n", to: "            if (!retryAllowed) throw httpError; // MUTATION L21-14\n", expectedFailed: ['TH-07'] },
  { id: 'L21-15', title: 'late-flush removed on HTTP/2 at the onRetry refusal', file: HTTP2, carrier: TH,
    from: "              if (shouldProceed === false) {\n                _stats.deferredHeaderEvents?.();\n                _stats.deferredHeaderEvents = undefined;\n                throw httpError;\n              }\n", to: "              if (shouldProceed === false) throw httpError; // MUTATION L21-15\n", expectedFailed: ['TH-08'] },
  { id: 'L21-16', title: 'late-flush removed on HTTP/2 at the wait-cap / ceiling refusal', file: HTTP2, carrier: TH,
    from: "        _stats.deferredHeaderEvents?.();\n        _stats.deferredHeaderEvents = undefined;\n        throw httpError;\n", to: "        throw httpError; // MUTATION L21-16\n", expectedFailed: ['TH-09', 'TH-10'] },
  { id: 'L21-17', title: 'stealth declarations: tls types resolved through the default import again (bundled d.ts loses the import)', file: TLS, carrier: SDR,
    from: "import type { ConnectionOptions, SecureContext } from 'node:tls';\n", to: "type ConnectionOptions = tls.ConnectionOptions; type SecureContext = tls.SecureContext; // MUTATION L21-17\n", expectedFailed: ['SDR-04'] },
  { id: 'L21-18', title: 'stealth exports: top-level types listed before the runtime blocks again', file: PACKAGE, carrier: SDR,
    from: "      \"react-native\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"browser\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"workerd\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"edge-light\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"types\": \"./dist/stealth/index.d.ts\",\n", to: "      \"types\": \"./dist/stealth/index.d.ts\",\n      \"react-native\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"browser\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"workerd\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"edge-light\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n", expectedFailed: ['SDR-02', 'SDR-03', 'SDR-04', 'SDR-07'] },
  { id: 'L21-19', title: 'root exports: bare types hoisted before the runtime condition blocks', file: PACKAGE, carrier: EDGE,
    from: "      \"react-native\": {\n        \"types\": \"./dist/platform/react-native.d.ts\",\n        \"require\": \"./dist/platform/react-native.cjs\",\n        \"default\": \"./dist/platform/react-native.js\"\n      },\n      \"workerd\": {\n        \"types\": \"./dist/platform/worker.d.ts\",\n        \"require\": \"./dist/platform/worker.cjs\",\n        \"default\": \"./dist/platform/worker.js\"\n      },\n      \"edge-light\": {\n        \"types\": \"./dist/platform/worker.d.ts\",\n        \"require\": \"./dist/platform/worker.cjs\",\n        \"default\": \"./dist/platform/worker.js\"\n      },\n      \"browser\": {\n        \"types\": \"./dist/platform/browser.d.ts\",\n        \"require\": \"./dist/platform/browser.cjs\",\n        \"default\": \"./dist/platform/browser.js\"\n      },\n      \"types\": \"./dist/index.d.ts\",\n", to: "      \"types\": \"./dist/index.d.ts\",\n      \"react-native\": {\n        \"types\": \"./dist/platform/react-native.d.ts\",\n        \"require\": \"./dist/platform/react-native.cjs\",\n        \"default\": \"./dist/platform/react-native.js\"\n      },\n      \"workerd\": {\n        \"types\": \"./dist/platform/worker.d.ts\",\n        \"require\": \"./dist/platform/worker.cjs\",\n        \"default\": \"./dist/platform/worker.js\"\n      },\n      \"edge-light\": {\n        \"types\": \"./dist/platform/worker.d.ts\",\n        \"require\": \"./dist/platform/worker.cjs\",\n        \"default\": \"./dist/platform/worker.js\"\n      },\n      \"browser\": {\n        \"types\": \"./dist/platform/browser.d.ts\",\n        \"require\": \"./dist/platform/browser.cjs\",\n        \"default\": \"./dist/platform/browser.js\"\n      },\n", expectedFailed: ['ER-07', 'ER-13'] },
  { id: 'L21-20', title: 'stealth exports: the edge-light default target slides to the node entry', file: PACKAGE, carrier: EDGE,
    from: "      \"edge-light\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/universal.js\"\n      },\n      \"types\": \"./dist/stealth/index.d.ts\",\n", to: "      \"edge-light\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",\n        \"require\": \"./dist/stealth/universal.cjs\",\n        \"default\": \"./dist/stealth/index.js\"\n      },\n      \"types\": \"./dist/stealth/index.d.ts\",\n", expectedFailed: ['ER-11'] },
  { id: 'L21-21', title: 'root exports: the historical broad worker block returns before browser', file: PACKAGE, carrier: EDGE,
    from: "      \"browser\": {\n        \"types\": \"./dist/platform/browser.d.ts\",\n        \"require\": \"./dist/platform/browser.cjs\",\n        \"default\": \"./dist/platform/browser.js\"\n      },\n", to: "      \"worker\": {\n        \"types\": \"./dist/platform/worker.d.ts\",\n        \"require\": \"./dist/platform/worker.cjs\",\n        \"default\": \"./dist/platform/worker.js\"\n      },\n      \"browser\": {\n        \"types\": \"./dist/platform/browser.d.ts\",\n        \"require\": \"./dist/platform/browser.cjs\",\n        \"default\": \"./dist/platform/browser.js\"\n      },\n", expectedFailed: ['ER-07', 'ER-12'] },
  { id: 'L21-22', title: 'worker platform: the default export degrades to a named empty object', file: WORKER, carrier: EDGE,
    from: "export default rezo;\n", to: "const emptyDefault = {};\nexport default emptyDefault; // MUTATION L21-22\n", expectedFailed: ['ER-10'] },
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
  const ledger = { ...identityBlock(), schema: 'rezo.r21.http-facade-legs.signal-controls/v3.1', signals: SIGNALS, controlledLeg: { id: LEGS[0].id, file: LEGS[0].file }, controls, runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, invalidities: runInvalidities, valid };
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
const ledger = { ...identity, schema: 'rezo.r21.http-facade-legs.ledger/v3.1', runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, rosters: ROSTERS, expectedLegIds: EXPECTED_LEG_IDS, legTimeoutMs: LEG_TIMEOUT_MS, evidenceDir: relative(ROOT, evidenceDir), evidence, census: { backend: 'signal-0 (primary, live→reaped sentinel control per census); pgrep diagnostic only', boundary: 'signal-0 proves the detached carrier group empty; escape into another group/session is excluded by the authenticated containment table, never assumed' }, selfTest, baselines, results, invalidities: runInvalidities, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 600) : ''}`);
process.exit(valid ? 0 : 1);
