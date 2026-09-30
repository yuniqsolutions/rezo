// R19 stealth wire-fidelity mutation legs — v3.1.
//
// Proves that the stealth carriers (wire fidelity, identity isolation, route parity, public entry shape) observe
// the source they claim to observe: each leg applies one exact single-occurrence mutation to a pinned source
// file, runs the carrier that must notice it, requires the EXACT frozen set of rows to fail (every other row
// must pass), restores the file and verifies its identity again. Named gaps (recorded, not run here): ML-05
// (Bun SOCKS TLS options — the Bun route rows are frozen RED until the Bun follow-up) and ML-11 (provenance
// tags live in the frozen oracle fixture, whose identity the tool closure pins; removing one is caught by the pin).
//
// Execution model, modes and admission are identical to R17/R18 (test/r17-curl-dns-ownership-legs.mjs): this
// module is never executed from disk — the trusted bootstrap (env -i boundary) authenticates every stage, the
// launcher executes this driver from a data: URL of the exact bytes it hashed, the process-group census is
// signal-0 with a sentinel control, and the full closure table is verified at open, around every leg, and at close.
//
// Modes (REZO_LEGS_MODE): canonical (ledger is exactly plans/r19-stealth-fidelity-legs-ledger.json, must not exist)
// · dry-run · calibration (never valid) · signal-control (ledger is exactly plans/r19-stealth-fidelity-legs-signal-controls.json).

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
const CURL_STEALTH = 'src/adapters/curl-stealth.ts';
const CONSTANTS = 'src/stealth/profiles/constants.ts';
const PROFILES_INDEX = 'src/stealth/profiles/index.ts';
const TLS_FINGERPRINT = 'src/stealth/tls-fingerprint.ts';
const RESOLVER = 'src/stealth/resolver.ts';
const UNIVERSAL = 'src/stealth/universal.ts';
const TLS_UNIVERSAL = 'src/stealth/tls-fingerprint.universal.ts';
const PACKAGE = 'package.json';
const SWF = 'test/a-plus-stealth-wire-fidelity.test.ts';
const SIS = 'test/a-plus-stealth-identity-isolation.test.ts';
const SRP = 'test/a-plus-stealth-route-parity.test.ts';
const ESH = 'test/a-plus-stealth-entry-shape.test.ts';
const PARSE = 'src/proxy/parse.ts';
const PP = 'test/a-plus-proxy-scheme-classification.test.ts';
const SPC = 'test/a-plus-stealth-proxy-connect.test.ts';

// Pins are frozen from the GREEN epoch (stealth phase 5 + the CONNECT rows GREEN after the proxy-scheme fix); the driver refuses any other bytes before it mutates anything.
const PINNED = Object.freeze({
  [HTTP]: 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  [HTTP2]: 'fdf5df4e6138b48abcd696fb462dff69ccd041f4d4b83c856aa7356ea0bc47a7',
  [CURL]: '5c8dc5a6d4e6f171021117a26751866875daeb695532176ba0013f26480dfd99',
  [CURL_STEALTH]: 'f84e9035f89b65eca72553ed9219fa238ec0b22cb67e68836666c3e645a33558',
  [CONSTANTS]: 'dcf83572b275a6a585c7a5e4da517b0fa4bd7114b2df3d500382f98fb48e090a',
  [PROFILES_INDEX]: '7762f5c6811fbdf70ae289cabfc5156b65507ca457357388b9185be59f0061c4',
  [TLS_FINGERPRINT]: '2f7d79721c47b9561df39bfa9d2692be236729dc5b7097b9c201f3e9394eef28',
  [RESOLVER]: '20d9d21a074f0167bec68c84d88c7bd912a811782b6fe8c486ad6174ff4833be',
  [UNIVERSAL]: '454ffb0ea5a5f44e34d26d99a5f40b525fb2e1670421d0d16636b889ebd0e9cc',
  [TLS_UNIVERSAL]: 'b0e2349ca6c890441d9a6854af052e8191983048556493fe2601f56a96e02920',
  [PACKAGE]: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8',
  [SWF]: '81de91893656d58751e8ee8e48780ad503dae2f75ee670a6a889e0579c3e97d8',
  [SIS]: '3085840965a5b8d82ce89759f24316212b8e384e6d6f8ec1f7fe6813d30c471d',
  [SRP]: '95a3df9f987b70817bbe3277d6a4a9cc934ada1b9f2298586f98badac5a32ff5',
  [ESH]: 'b9b75177fed7faedeb8de312dd82c936d0c228780a4b7c8ec6258b942d2a10c5',
  [PARSE]: 'f1afb1a1110d7517d69f9823ff09fbc1b41ce827fbbe2ea48589fa673e777aa1',
  [PP]: '66deba8c51c6ee7b302296451d247f76034bf21e80853b0a8a00d8cb1f222ddc',
  [SPC]: '1a8113b35ad586d98be9ad9ca1c265635eca03bad1b88fb60e25b01feb936981',
});
const PINNED_NODE_VERSION = 'v25.9.0';
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_RUNTIME = Object.freeze({
  node: { version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' },
  vitest: { version: '4.1.4', runnerPath: 'node_modules/vitest/vitest.mjs', sha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' },
  lock: { path: 'bun.lock', sha256: 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53' },
  packageJson: { path: 'package.json', sha256: 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8' },
});
const PINNED_AGGREGATE = '52c8bb5ad2e75c4e2aa3e29ee2f51712dd431c430d36fb6956470565e5797fba';
const ROSTERS = Object.freeze({
  [SWF]: Object.freeze(["SWF-C1a","SWF-C1b","SWF-C1c","SWF-C2a","SWF-C2b","SWF-C2c","SWF-C2d","SWF-C2e","SWF-C2f","SWF-F1a","SWF-F1b","SWF-F1c","SWF-F2a","SWF-F2b","SWF-F2c","SWF-F2d","SWF-F2e","SWF-F2f","SWF-S1a","SWF-S1b","SWF-S1c","SWF-S2a","SWF-S2b","SWF-S2c","SWF-S2d","SWF-S2e","SWF-S2f","SWF-E1a","SWF-E1b","SWF-E1c","SWF-E2a","SWF-E2b","SWF-E2c","SWF-E2d","SWF-E2e","SWF-E2f","SWF2-C1a","SWF2-C1b","SWF2-C1c","SWF2-C2a","SWF2-C2b","SWF2-C2c","SWF2-C2d","SWF2-C2e","SWF2-C2f","SWF2-F1a","SWF2-F1b","SWF2-F1c","SWF2-F2a","SWF2-F2b","SWF2-F2c","SWF2-F2d","SWF2-F2e","SWF2-F2f","SWF2-S1a","SWF2-S1b","SWF2-S1c","SWF2-S2a","SWF2-S2b","SWF2-S2c","SWF2-S2d","SWF2-S2e","SWF2-S2f","SWF2-E1a","SWF2-E1b","SWF2-E1c","SWF2-E2a","SWF2-E2b","SWF2-E2c","SWF2-E2d","SWF2-E2e","SWF2-E2f","SWF-grease","SWF-fallback"]),
  [SIS]: Object.freeze(["SIS-01","SIS-02","SIS-03","SIS-04","SIS-05","SIS-06"]),
  [SRP]: Object.freeze(["SRP-1-direct","SRP-1-str","SRP-1-obj","SRP-1-socks","SRP-2-direct","SRP-2-str","SRP-2-obj","SRP-2-socks","SRP-agent-1","SRP-agent-2","SRP-platform","SRP-consistency","SRP-curl-map","SRP-curl-refuse","SRP-curl-probe-fail"]),
  [ESH]: Object.freeze(["ESH-01","ESH-02","ESH-03","ESH-04","ESH-05","ESH-06","ESH-07","ESH-08"]),
  [PP]: Object.freeze(["PP-01","PP-02","PP-03"]),
  [SPC]: Object.freeze(["SRP-1-connect","SRP-2-connect","SPC-03"]),
});
const EXPECTED_LEG_IDS = Object.freeze(["ML-01","ML-02","ML-03","ML-04","ML-06a","ML-06b","ML-07","ML-08","ML-09","ML-10","ML-12","ML-13","ML-14a","ML-14b","ML-14c","ML-15a","ML-15b"]);
const VITEST_ARGS = (carrier) => ['node_modules/vitest/vitest.mjs', 'run', carrier, '--pool=threads', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=300000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const ROW_ID = /\b((?:SWF2?-[CFSE][12][a-f]|SWF-grease|SWF-fallback|SIS-\d{2}|SRP-[12]-(?:direct|str|obj|socks|connect)|PP-\d{2}|SPC-\d{2}|SRP-agent-[12]|SRP-platform|SRP-consistency|SRP-curl-(?:map|refuse|probe-fail)|ESH-\d{2}))\b/u;
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
const CANONICAL_LEDGER = resolve(ROOT, 'plans/r19-stealth-fidelity-legs-ledger.json');
if (MODE === 'canonical') { if (ledgerAbs !== CANONICAL_LEDGER) fail('canonical mode writes exactly plans/r19-stealth-fidelity-legs-ledger.json'); }
else if (MODE === 'signal-control' && !SIGNAL_CHILD) { if (ledgerAbs !== resolve(ROOT, 'plans/r19-stealth-fidelity-legs-signal-controls.json')) fail('signal-control mode writes exactly plans/r19-stealth-fidelity-legs-signal-controls.json'); }
else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger must live inside the scratch root`);

// Opening identities, pinned before any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const MUTABLE = [HTTP, HTTP2, CURL, CURL_STEALTH, CONSTANTS, PROFILES_INDEX, TLS_FINGERPRINT, RESOLVER, UNIVERSAL, TLS_UNIVERSAL, PACKAGE, PARSE];
const PRISTINE = Object.fromEntries(MUTABLE.map((file) => [file, resolve(scratchAbs, `${file.replace(/[\\/]/gu, '__')}.pristine`)]));
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// Legs: one exact single-occurrence mutation each, the carrier that must notice it, and the EXACT
// failed set frozen from the calibration pass. Every other row of that carrier must pass.
const LEGS = [
  { id: 'ML-01', title: 'HTTP/2 session pool no longer keyed by the transport digest', file: HTTP2, carrier: SIS,
    from: "    const identityKey = stealthProfile ? `#tls:${stealthProfile.transportDigest}` : '';\n", to: "    const identityKey = ''; // MUTATION ML-01\n", expectedFailed: ['SIS-01', 'SIS-03', 'SIS-04'] },
  { id: 'ML-02', title: 'hybrid post-quantum group never attempted by the TLS probe', file: TLS_FINGERPRINT, carrier: SWF,
    from: "    { groups: requested, marked: true, hybrid: hybridRequested ? 'supported' : 'not-requested' },\n", to: "    // MUTATION ML-02: the full group list is never offered\n", expectedFailed: ['SWF-C1b', 'SWF-C2b', 'SWF-E1b', 'SWF-E2b', 'SWF-F1b', 'SWF-F2b', 'SWF2-C1b', 'SWF2-C2b', 'SWF2-E1b', 'SWF2-E2b', 'SWF2-F1b', 'SWF2-F2b', 'SWF2-S1b', 'SWF2-S2b'] },
  { id: 'ML-03', title: 'absent HTTP/2 SETTINGS fields sent with defaults again', file: HTTP2, carrier: SWF,
    from: "      if (h2.maxConcurrentStreams !== undefined) settings.maxConcurrentStreams = h2.maxConcurrentStreams;\n", to: "      settings.maxConcurrentStreams = h2.maxConcurrentStreams ?? 100; // MUTATION ML-03\n", expectedFailed: ['SWF-C2e', 'SWF-E2e', 'SWF-F2e', 'SWF2-C2e', 'SWF2-E2e', 'SWF2-F2e'] },
  { id: 'ML-04', title: 'Chromium priority slot dropped on HTTP/2', file: CONSTANTS, carrier: SWF,
    from: "const CHROMIUM_EXTRA = { h2: { priority: 'u=0, i' } };\n", to: "const CHROMIUM_EXTRA = {}; // MUTATION ML-04\n", expectedFailed: ['SWF-C2c', 'SWF-E2c', 'SWF2-C2c', 'SWF2-E2c'] },
  { id: 'ML-06a', title: 'custom-agent refusal removed on HTTP/1.1', file: HTTP, carrier: SRP,
    from: "  if (stealthProfile && (httpAgent || httpsAgent)) {\n", to: "  if (stealthProfile && (httpAgent || httpsAgent) && false) { // MUTATION ML-06a\n", expectedFailed: ['SRP-agent-1'] },
  { id: 'ML-06b', title: 'custom-agent refusal removed on HTTP/2', file: HTTP2, carrier: SRP,
    from: "      if (stealthProfile && ((fetchOptions as any).httpsAgent || (fetchOptions as any).httpAgent)) {\n", to: "      if (stealthProfile && ((fetchOptions as any).httpsAgent || (fetchOptions as any).httpAgent) && false) { // MUTATION ML-06b\n", expectedFailed: ['SRP-agent-2'] },
  { id: 'ML-07', title: 'unsupported platform substitutes an identity instead of refusing', file: RESOLVER, carrier: SRP,
    from: "  if (userAgent === undefined || !platformSupported(profile, platform)) {\n", to: "  if (userAgent === undefined) { // MUTATION ML-07\n", expectedFailed: ['SRP-platform'] },
  { id: 'ML-08', title: 'registry values no longer deep-frozen', file: PROFILES_INDEX, carrier: SIS,
    from: "]) registry.set(id, deepFreeze(profile));\n", to: "]) registry.set(id, profile); // MUTATION ML-08\n", expectedFailed: ['SIS-06'] },
  { id: 'ML-09', title: 'greased-brand permutation seed shifted', file: CONSTANTS, carrier: SWF,
    from: "  const order = GREASE_ORDERS[major % GREASE_ORDERS.length];\n", to: "  const order = GREASE_ORDERS[(major + 1) % GREASE_ORDERS.length]; // MUTATION ML-09\n", expectedFailed: ['SWF2-C1c', 'SWF2-C2c', 'SWF2-E1c', 'SWF2-E2c'] },
  { id: 'ML-10', title: 'identity retirement filter removed', file: PROFILES_INDEX, carrier: SIS,
    from: "  return profile.majorVersion < current - 2;\n", to: "  return false; // MUTATION ML-10\n", expectedFailed: ['SIS-04'] },
  { id: 'ML-12', title: 'curl acceptance verdict ignored', file: CURL_STEALTH, carrier: SRP,
    from: "  if (!acceptance.accepted) {\n", to: "  if (!acceptance.accepted && false) { // MUTATION ML-12\n", expectedFailed: ['SRP-curl-refuse'] },
  { id: 'ML-13', title: 'mapped TLS material never handed to curl', file: CURL, carrier: SRP,
    from: "      this.args.push(...stealthMapping.tlsArgs);\n", to: "      // MUTATION ML-13: no TLS material\n", expectedFailed: ['SRP-curl-map'] },
  { id: 'ML-14a', title: 'universal entry re-imports the node:tls constructors', file: UNIVERSAL, carrier: ESH,
    from: "export { createSecureContext, buildTlsOptions } from './tls-fingerprint.universal.js';\n", to: "export { createSecureContext, buildTlsOptions } from './tls-fingerprint.js'; // MUTATION ML-14a\n", expectedFailed: ['ESH-01', 'ESH-02', 'ESH-04', 'ESH-05', 'ESH-08'] },
  { id: 'ML-14b', title: 'import condition placed above the universal conditions', file: PACKAGE, carrier: ESH,
    from: "    \"./stealth\": {\n      \"react-native\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",", to: "    \"./stealth\": {\n      \"import\": \"./dist/stealth/index.js\",\n      \"react-native\": {\n        \"types\": \"./dist/stealth/universal.d.ts\",", expectedFailed: ['ESH-01', 'ESH-02', 'ESH-04', 'ESH-05', 'ESH-07', 'ESH-08'] },
  { id: 'ML-14c', title: 'call-time typed refusal removed from the universal TLS constructors', file: TLS_UNIVERSAL, carrier: ESH,
    from: "function refuseTlsShaping(constructorName: string): never {\n  throw new RezoError(\n", to: "function refuseTlsShaping(constructorName: string): never {\n  return undefined as never; // MUTATION ML-14c\n  throw new RezoError(\n", expectedFailed: ['ESH-04', 'ESH-05'] },
  { id: 'ML-15a', title: 'proxy scheme order reverted: https:// classified as http (parser rows)', file: PARSE, carrier: PP,
    from: "    const protocol: RezoProxyProtocol = proto.startsWith(\"https\") ? 'https' :\n        proto.startsWith(\"http\") ? 'http' : proto.startsWith(\"socks4\") ? 'socks4' : 'socks5'", to: "    const protocol: RezoProxyProtocol = proto.startsWith(\"http\") ? 'http' : // MUTATION ML-15a\n        proto.startsWith(\"https\") ? 'https' : proto.startsWith(\"socks4\") ? 'socks4' : 'socks5'", expectedFailed: ['PP-01'] },
  { id: 'ML-15b', title: 'proxy scheme order reverted: both adapters CONNECT in plaintext to a TLS proxy (wire rows)', file: PARSE, carrier: SPC,
    from: "    const protocol: RezoProxyProtocol = proto.startsWith(\"https\") ? 'https' :\n        proto.startsWith(\"http\") ? 'http' : proto.startsWith(\"socks4\") ? 'socks4' : 'socks5'", to: "    const protocol: RezoProxyProtocol = proto.startsWith(\"http\") ? 'http' : // MUTATION ML-15b\n        proto.startsWith(\"https\") ? 'https' : proto.startsWith(\"socks4\") ? 'socks4' : 'socks5'", expectedFailed: ['SRP-1-connect', 'SRP-2-connect'] },
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
  const ledger = { ...identityBlock(), schema: 'rezo.r19.stealth-fidelity-legs.signal-controls/v3.1', signals: SIGNALS, controlledLeg: { id: LEGS[0].id, file: LEGS[0].file }, controls, runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, invalidities: runInvalidities, valid };
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
const ledger = { ...identity, schema: 'rezo.r19.stealth-fidelity-legs.ledger/v3.1', runtime: { pinned: PINNED_RUNTIME, opening: openingRuntime, closing: closingRuntime }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, rosters: ROSTERS, expectedLegIds: EXPECTED_LEG_IDS, legTimeoutMs: LEG_TIMEOUT_MS, evidenceDir: relative(ROOT, evidenceDir), evidence, census: { backend: 'signal-0 (primary, live→reaped sentinel control per census); pgrep diagnostic only', boundary: 'signal-0 proves the detached carrier group empty; escape into another group/session is excluded by the authenticated containment table, never assumed' }, selfTest, baselines, results, invalidities: runInvalidities, valid };
writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 600) : ''}`);
process.exit(valid ? 0 : 1);
