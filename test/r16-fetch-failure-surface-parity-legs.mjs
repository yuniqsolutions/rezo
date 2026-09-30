// R16 Fetch failure-surface parity — mutation legs driver v1 (john; built from the R15 driver v4 with
// the tayo seq 61527 canonical-only gates and the seq 61620 external runner/invocation gate).
// Run from the repository root:
//   REZO_LEGS_DRIVER_SHA256=<sha256 of this file> REZO_LEGS_SCRATCH=<new external dir> REZO_LEGS_LEDGER=<new file> \
//     node test/r16-fetch-failure-surface-parity-legs.mjs [--dry-run | --calibrate]
// Fail-closed proof: the driver's own bytes are anchored by an independently supplied sha256; the
// repository identity (cwd realpath === this driver's repository root), the Node and Bun executables
// (realpath + sha256 + version), the vitest runner identity, the invocation state (execArgv empty,
// NODE_OPTIONS unset), the pinned source/test set and the src aggregate are verified at opening and
// closing; each leg applies one exact single-occurrence mutation to src/adapters/fetch.ts, runs the
// canonical invocation of its runtime (argv, no shell, bounded, sanitised env), requires the runner
// exit code the runtime uses for failures, exactly one full-line carrier marker, a recursively typed
// ledger envelope, the exact expected failed set, the exact literal oracle collateral, the complete
// 61-leg inventory, no unsettled/unstable row outside the expected set, zero setup/teardown/fixture/
// table/listener/process issues, and byte-exact restoration. Any invalidity ⇒ `valid:false` + nonzero
// exit. `--calibrate` records observed collateral for authoring and can NEVER produce a valid ledger;
// a CALIBRATION build refuses canonical mode; canonical output is promoted to plans/ only when valid.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, realpathSync, openSync, closeSync, unlinkSync, constants as fsConstants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILD = 'canonical'; // 'calibration' | 'canonical' — a calibration build never runs canonical mode
const FLAGS = process.argv.slice(2);
const MODE = FLAGS.length === 0 ? 'canonical' : FLAGS.length === 1 && FLAGS[0] === '--dry-run' ? 'dry-run' : FLAGS.length === 1 && FLAGS[0] === '--calibrate' ? 'calibration' : null;
const DRIVER_PATH = fileURLToPath(import.meta.url);
const DRIVER_REPO = realpathSync(resolve(dirname(DRIVER_PATH), '..'));
const ROOT = process.cwd();
const CARRIER = 'test/a-plus-fetch-failure-surface-parity.test.ts';
const FETCH = 'src/adapters/fetch.ts';
const PINNED = Object.freeze({
  [CARRIER]: '7df4be057b07d91fb32b44c2646ade551ca2ed5b3a33cdea7c8fe0fda2f311c6',
  [FETCH]: '186d790c8b6e8b424a794c5f220050e7be96abefccd199f041be54ce1da40eba',
  'src/adapters/entries/fetch.ts': '723bc636e4e6dcbce37909cd317eb02ec5c4e2be4fae8a1c0da02f0660e77c9b',
  'src/adapters/http.ts': 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  'src/adapters/http2.ts': 'fdf5df4e6138b48abcd696fb462dff69ccd041f4d4b83c856aa7356ea0bc47a7',
  'src/adapters/download-target-transaction.ts': '7de051ab62dfed8e30d97f547357496770b17af6e8fdfcb303f9d9854e3bc731',
  'src/platform/node.ts': 'f5d9a4e6c545ed820f6d62768fa070dc14a674719356fd8f4662b35fbf4608ab',
  'src/platform/bun.ts': '484f9c2a6fd36983df8ea8a7633b04ab07b363ccd0f0501f62553b8ae570a18e',
  'src/utils/node-runtime.ts': 'bb54d1f220539b642a93f05817c9e699c14b675ae2a0a831887f855c0f5a27a3',
});
const PINNED_AGGREGATE = '90952c2510b740ca328112161a5861ed748163bb645254db3bc30a7978e49557';
const PINNED_NODE = Object.freeze({ version: 'v25.9.0', realpath: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node', sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc' });
const PINNED_BUN = Object.freeze({ version: '1.3.14', realpath: '/Users/jmathew/.bun/bin/bun', sha256: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233' });
const PINNED_VITEST = Object.freeze({ version: '4.1.4', runnerSha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' });
const TARGETS = Object.freeze(["FP-01","FP-02","FP-04","FP-06","FP-08","FP-09","FP-10","FP-11","FP-12","FP-14","FP-16","FP-18","FP-20","FP-22","FP-24","FP-26","FP-27","FP-29","FP-33","FP-35","FP-37","FP-43","FP-45","FP-47","FP-49","FP-51","FP-53","FP-55","FP-61","FP-63","FP-65","FP-67","FP-69","FP-85","FP-87","FP-89","FP-91","FP-93","FP-95","FP-97","FP-99","FP-101","FP-103","FP-105","FP-107","FP-111","FP-113","FP-115","FP-117","FP-119","FP-121"]);
const CONTROLS = Object.freeze(["FP-39","FP-41","FP-57","FP-59","FP-C4","FP-C5","FP-C6","FP-C7","FP-C8","FP-C9","FP-C10","FP-C12","FP-C13","FP-C14","FP-109","FP-C15"]);
const ROSTER = Object.freeze([...TARGETS, ...CONTROLS]);
const RUNNER_TESTS = 68;
const VITEST_ARGS = ['node_modules/vitest/vitest.mjs', 'run', CARRIER, '--pool=forks', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=60000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const BUN_ARGS = ['test', '--timeout=60000', '--max-concurrency=1', '--retry=0', `./${CARRIER}`];
const LEG_TIMEOUT_MS = 15 * 60 * 1000;
const MARKER = 'REZO_R16_LEDGER_V2:';
const LEDGER_SCHEMA = 'rezo.r16.fetch-parity.ledger/v2';
const CANONICAL_LEDGER = 'plans/r16-fetch-failure-surface-parity-legs-ledger.json';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256Text = (text) => createHash('sha256').update(text).digest('hex');
const fail = (message) => { console.error(`driver invalid: ${message}`); process.exit(2); };
if (MODE === null) fail(`unrecognised flags ${JSON.stringify(FLAGS)} (allowed: none, --dry-run, --calibrate)`);
if (MODE === 'canonical' && BUILD !== 'canonical') fail('this is a CALIBRATION build: canonical mode is refused (freeze the collateral into a canonical build first)');
// Literal contract of the carrier ledger (extracted from the GREEN Node ledger dce711da… of carrier 8717639a…):
const ENVELOPE_KEYS = ["authenticity","carrierSha256","cleanup","clientPools","closingAuthenticity","contract","epoch","expectedPassed","failed","file","fixtureErrors","legCount","legs","listeners","oracleMismatches","parity","passed","processFaults","registered","registry","runner","runtime","runtimeVersion","schema","setupErrors","teardownErrors"];
const CLEANUP_END_STATE_KEYS = ["servers","sessions","sockets","temporaryDirectories","timers"];
const CLEANUP_FORCED_KEYS = ["serversClosed","sessionsDestroyed","socketsClosedWithSessions","socketsDestroyed","temporaryDirectoriesRemoved"];
const PARITY_KEYS = ["fields","runtimeSplit","tableProblems"];
const CLIENT_POOL_KEYS = ["endState","natural"];
const POOL_SNAPSHOT_KEYS = ["activeSockets","agentShape","agents","evictionTimer","freeSockets","queuedRequests"];
const HOOK_KEYS = ["afterHeaders","afterParse","afterResponse","beforeError","onAbort","onTimeout","retryBeforeRetry","retryCondition","retryExhausted","retryOnRetry"];
const AUTHENTICITY_KEYS = ["adapter","adapterSha256","adapterSource","entrySha256","entrySource"];
const CLOSING_KEYS = ["carrierSha256","fetchAdapterSha256","fetchEntrySha256","h1AdapterSha256","h1EntrySha256"];
const CONTRACT_KEYS = ["controlCount","controls","rowCount","runnerTests","targetCount","targets"];
const RUNNER_KEYS = ["argv","cwd","execArgv","execPath","rowTestTimeoutMs","rowWatchdogMs"];
const LEG_KEYS = ["FP-89:fetch:stream:redirect-302-held","FP-C10:h1:stream:redirect-302-held","FP-91:fetch:upload:happy","FP-113:fetch:upload:happy","FP-111:fetch:buffered:happy","FP-115:fetch:buffered:redirect-302-held","FP-121:fetch:buffered:happy","FP-117:fetch:download:redirect-302-held","FP-119:fetch:upload:redirect-302-held","FP-93:fetch:buffered:status-429","FP-C12:h1:buffered:status-429","FP-95:fetch:stream:hold-after-prefix","FP-97:fetch:download:hold-after-prefix","FP-C13:h1:stream:hold-after-prefix","FP-99:fetch:stream:happy","FP-C14:h1:stream:happy","FP-101:fetch:buffered:happy","FP-103:fetch:stream:happy","FP-105:fetch:buffered:happy","FP-107:fetch:stream:happy","FP-109:fetch:buffered:happy","FP-C15:h1:buffered:happy","FP-85:fetch:stream:hold-after-prefix","FP-C8:h1:stream:hold-after-prefix","FP-87:fetch:buffered:status-503","FP-C9:h1:buffered:status-503","FP-01:fetch:stream:truncated","FP-02:fetch:buffered:truncated","FP-04:fetch:stream:zstd-truncated","FP-06:fetch:download:zstd-truncated","FP-08:fetch:upload:zstd-truncated","FP-14:fetch:buffered:zstd-truncated","FP-16:fetch:stream:reset-before-headers","FP-35:fetch:stream:zstd-truncated","FP-09:fetch:buffered:happy","FP-10:fetch:stream:happy","FP-11:fetch:download:happy","FP-12:fetch:upload:happy","FP-C4:h1:buffered:happy","FP-C5:h1:stream:happy","FP-C6:h1:download:happy","FP-C7:h1:upload:happy","FP-18:fetch:stream:happy","FP-20:fetch:download:happy","FP-22:fetch:stream:happy","FP-24:fetch:stream:happy","FP-26:fetch:buffered:happy","FP-27:fetch:stream:hold-after-prefix","FP-29:fetch:download:hold-after-prefix","FP-33:fetch:buffered:hold-after-prefix","FP-37:fetch:stream:hold-after-prefix","FP-55:fetch:stream:reset-before-headers","FP-63:fetch:stream:happy","FP-65:fetch:stream:reset-before-headers","FP-67:fetch:stream:reset-before-headers","FP-69:fetch:stream:reset-before-headers","FP-39:fetch:stream:happy","FP-41:fetch:buffered:happy","FP-57:fetch:download:happy","FP-59:fetch:upload:happy","FP-43:fetch:upload:happy","FP-45:fetch:download:happy","FP-47:fetch:buffered:happy","FP-61:fetch:upload:happy","FP-49:fetch:download:happy","FP-51:fetch:buffered:happy","FP-53:fetch:upload:happy"];
const OBSERVATION_KEYS = ["afterHeadersEventCookies","afterParsePayloads","bodySha256","causeCode","causeDescriptor","causeMessage","causeName","causeOwnNonEnumerable","clientNaturalAtCaseEnd","closeEmitted","code","connections","doneEmitted","donePayloadCookies","errno","errorEvents","errorIdentity","fileState","finishPayloadCookies","fixtureEchoes","hasCause","hasResponse","headersEventCookies","headersEventHeaderNames","headersEventHeaderValues","hooks","isFinished","isNetworkError","isRetryable","isRezoError","isTimeout","jarAfterValues","lateConnections","lateHits","message","name","normalizedSequence","progressEmitted","promptAfterAbort","rawSequence","responseBodyLength","responseBodySha256","responseConfigStatus","responseConfigStatusText","responseContentLength","responseContentLengthField","responseContentType","responseCookieNames","responseCookieNetscapeLines","responseCookieString","responseCookieValues","responseFinalUrl","responseHeaderNames","responseHeaderValues","responseSerializedCount","responseSetCookieCount","responseStatus","responseStatusText","responseUrlCount","retryAttempts","retryDelayTimer","runtime","socketClosesAtCaseEnd","status","terminal","transformed","truncatedFlag","wireHits"];
const OBSERVATION_TYPES = {"afterHeadersEventCookies":["array","null"],"afterParsePayloads":["array"],"bodySha256":["null","string"],"causeCode":["null","string"],"causeDescriptor":["string"],"causeMessage":["null","string"],"causeName":["null","string"],"causeOwnNonEnumerable":["boolean","null"],"clientNaturalAtCaseEnd":["object"],"closeEmitted":["boolean"],"code":["null","string"],"connections":["number"],"doneEmitted":["boolean"],"donePayloadCookies":["array","null"],"errno":["null","number","string"],"errorEvents":["number"],"errorIdentity":["null","string"],"fileState":["null","object"],"finishPayloadCookies":["array","null"],"fixtureEchoes":["array"],"hasCause":["boolean","null"],"hasResponse":["boolean","null"],"headersEventCookies":["array","null"],"headersEventHeaderNames":["array","null"],"headersEventHeaderValues":["array","null"],"hooks":["object"],"isFinished":["boolean","null"],"isNetworkError":["boolean","null","string"],"isRetryable":["boolean","null","string"],"isRezoError":["boolean","null"],"isTimeout":["boolean","null","string"],"jarAfterValues":["array","null"],"lateConnections":["number"],"lateHits":["number"],"message":["null","string"],"name":["null","string"],"normalizedSequence":["array"],"progressEmitted":["boolean"],"promptAfterAbort":["boolean","null"],"rawSequence":["array"],"responseBodyLength":["null","number"],"responseBodySha256":["null","string"],"responseConfigStatus":["null","number"],"responseConfigStatusText":["null","string"],"responseContentLength":["null","string"],"responseContentLengthField":["null","number"],"responseContentType":["null","string"],"responseCookieNames":["array","null"],"responseCookieNetscapeLines":["null","number"],"responseCookieString":["null","string"],"responseCookieValues":["array","null"],"responseFinalUrl":["null","string"],"responseHeaderNames":["array","null"],"responseHeaderValues":["array","null"],"responseSerializedCount":["null","number"],"responseSetCookieCount":["null","number"],"responseStatus":["null","number"],"responseStatusText":["null","string"],"responseUrlCount":["null","number"],"retryAttempts":["number","string"],"retryDelayTimer":["null","object"],"runtime":["string"],"socketClosesAtCaseEnd":["number"],"status":["number","string"],"terminal":["string"],"transformed":["boolean","null"],"truncatedFlag":["boolean","null"],"wireHits":["number"]};
const STRING_ARRAY_FIELDS = ["afterParsePayloads","fixtureEchoes","jarAfterValues","normalizedSequence","rawSequence","responseCookieNames","responseCookieValues","responseHeaderNames","responseHeaderValues","headersEventCookies","afterHeadersEventCookies","headersEventHeaderNames"];
const TERMINALS = ['fulfilled', 'rejected', 'unsettled', 'unstable'];
const TIMER_STATES = ['null', 'ref', 'unref'];
const DISPOSALS = ['cleared', 'fired', 'live'];
const sortedJson = (list) => JSON.stringify([...list].sort());
// The src aggregate uses the exact R15 shell algorithm with PINNED absolute tool paths and a whitelisted
// environment (collation passed through so the value stays comparable with the channel convention).
const TOOL_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'C.UTF-8', ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}) });
for (const tool of ['/bin/sh', '/usr/bin/find', '/usr/bin/sort', '/usr/bin/shasum', '/usr/bin/cut']) if (!existsSync(tool)) fail(`pinned tool missing: ${tool}`);
const aggregate = () => { const r = spawnSync('/bin/sh', ['-c', "/usr/bin/find src -type f -name '*.ts' | /usr/bin/sort | while read p; do printf '%s\\0%s\\n' \"$p\" \"$(/usr/bin/shasum -a 256 \"$p\" | /usr/bin/cut -c1-64)\"; done | /usr/bin/shasum -a 256 | /usr/bin/cut -c1-64"], { cwd: ROOT, encoding: 'utf8', env: TOOL_ENV }); if (r.status !== 0) fail('aggregate computation failed'); return r.stdout.trim(); };

// ---- launch anchor, repository identity, tool identity, invocation state
const expectedDriverSha = process.env.REZO_LEGS_DRIVER_SHA256;
const driverSha = sha256(DRIVER_PATH);
if (!expectedDriverSha) fail('REZO_LEGS_DRIVER_SHA256 (the announced driver identity) is required');
if (expectedDriverSha !== driverSha) fail(`driver bytes ${driverSha} differ from the announced identity ${expectedDriverSha}`);
const REPO_REAL = realpathSync(ROOT);
if (REPO_REAL !== DRIVER_REPO) fail(`cwd ${REPO_REAL} is not this driver's repository root ${DRIVER_REPO}`);
if (relative(DRIVER_REPO, DRIVER_PATH) !== 'test/r16-fetch-failure-surface-parity-legs.mjs') fail(`driver path ${relative(DRIVER_REPO, DRIVER_PATH)} is not test/r16-fetch-failure-surface-parity-legs.mjs`);
for (const file of Object.keys(PINNED)) { const real = realpathSync(resolve(ROOT, file)); if (real !== resolve(REPO_REAL, file)) fail(`${file} resolves outside its canonical path: ${real}`); }
if (process.execArgv.length !== 0) fail(`driver execArgv must be empty: ${JSON.stringify(process.execArgv)}`);
if ((process.env.NODE_OPTIONS ?? '') !== '') fail('NODE_OPTIONS must be unset for the driver and its children');
if (process.version !== PINNED_NODE.version) fail(`node ${process.version} differs from the pinned ${PINNED_NODE.version}`);
const nodeRealpath = realpathSync(process.execPath);
if (nodeRealpath !== PINNED_NODE.realpath) fail(`node executable ${nodeRealpath} differs from the pinned ${PINNED_NODE.realpath}`);
const nodeSha = sha256(nodeRealpath);
if (nodeSha !== PINNED_NODE.sha256) fail(`node binary ${nodeSha} differs from the pinned ${PINNED_NODE.sha256}`);
if (!existsSync(PINNED_BUN.realpath) || realpathSync(PINNED_BUN.realpath) !== PINNED_BUN.realpath) fail(`bun executable ${PINNED_BUN.realpath} is not a canonical path`);
const bunSha = sha256(PINNED_BUN.realpath);
if (bunSha !== PINNED_BUN.sha256) fail(`bun binary ${PINNED_BUN.realpath} ${bunSha} differs from the pinned ${PINNED_BUN.sha256}`);
const bunVersionRun = spawnSync(PINNED_BUN.realpath, ['--version'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
const bunVersion = (bunVersionRun.stdout ?? '').trim();
if (bunVersionRun.status !== 0 || bunVersion !== PINNED_BUN.version) fail(`bun version ${bunVersion} differs from the pinned ${PINNED_BUN.version}`);
const vitestVersion = JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version;
const vitestRunnerSha = sha256('node_modules/vitest/vitest.mjs');
if (vitestVersion !== PINNED_VITEST.version || vitestRunnerSha !== PINNED_VITEST.runnerSha256) fail(`vitest identity ${vitestVersion}/${vitestRunnerSha} differs from the pinned ${PINNED_VITEST.version}/${PINNED_VITEST.runnerSha256}`);
// Children run with a WHITELISTED environment (never ambient inheritance): absolute binaries, no PATH lookups.
const CHILD_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: process.env.LANG ?? 'C.UTF-8', NO_COLOR: '1' });

// ---- paths (canonical-parent containment, symlink-proof)
const SCRATCH = process.env.REZO_LEGS_SCRATCH; const LEDGER = process.env.REZO_LEGS_LEDGER;
if (!SCRATCH || !LEDGER) fail('REZO_LEGS_SCRATCH and REZO_LEGS_LEDGER are both required');
const canonicalParent = (p) => { let dir = resolve(p); while (!existsSync(dir)) dir = dirname(dir); return realpathSync(dir); };
const inside = (p, dir) => { const r = relative(dir, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const scratchAbs = resolve(SCRATCH); const ledgerAbs = resolve(LEDGER);
if (existsSync(scratchAbs)) fail(`scratch root already exists: ${scratchAbs} (a fresh external root is required)`);
if (inside(canonicalParent(scratchAbs), REPO_REAL)) fail(`scratch root ${scratchAbs} resolves inside the repository ${REPO_REAL}`);
if (existsSync(ledgerAbs)) fail(`ledger output already exists: ${ledgerAbs}`);
mkdirSync(scratchAbs, { recursive: true });
const SCRATCH_REAL = realpathSync(scratchAbs);
// Post-create containment recheck (symlink races): the realpath must still resolve outside the repository.
if (inside(SCRATCH_REAL, REPO_REAL)) fail(`scratch root realpath ${SCRATCH_REAL} resolves inside the repository`);
// Exclusive lock: a second driver on the same scratch root fails at creation.
const LOCK_PATH = resolve(SCRATCH_REAL, '.rezo-legs.lock'); closeSync(openSync(LOCK_PATH, 'wx'));
if (MODE === 'canonical') {
  if (resolve(ledgerAbs) !== resolve(ROOT, CANONICAL_LEDGER) || !inside(canonicalParent(ledgerAbs), REPO_REAL)) fail(`canonical mode publishes exactly ${CANONICAL_LEDGER} inside the repository`);
} else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger ${ledgerAbs} must live inside the scratch root ${SCRATCH_REAL}`);
// The ledger is ALWAYS written inside the scratch root first; canonical mode promotes it only when valid.
const STAGED_LEDGER = resolve(SCRATCH_REAL, `staged-${basename(ledgerAbs)}`);
// The staged ledger is RESERVED exclusively now and written through this descriptor at the end.
const STAGED_FD = openSync(STAGED_LEDGER, 'wx');

// ---- opening identities pinned BEFORE any mutation; the pristine copy verified against the pin.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const openingAggregate = aggregate();
if (openingAggregate !== PINNED_AGGREGATE) fail(`src aggregate: actual ${openingAggregate} expected ${PINNED_AGGREGATE}`);
const PRISTINE = { [FETCH]: resolve(SCRATCH_REAL, 'fetch.ts.pristine') };
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }
// The carrier pins the adapter bytes at load (tayo seq 61291), so every leg also re-pins the
// carrier's literal `fetchAdapterSha256` to the mutated adapter hash; the carrier's self-hash in the
// ledger proves exactly which carrier bytes ran (pristine + that one literal), and both files are
// restored byte-exactly after each leg.
PRISTINE[CARRIER] = resolve(SCRATCH_REAL, 'carrier.ts.pristine');
copyFileSync(CARRIER, PRISTINE[CARRIER]); if (sha256(PRISTINE[CARRIER]) !== PINNED[CARRIER]) fail('pristine copy of the carrier does not match the pin');
const CARRIER_PIN_LITERAL = `fetchAdapterSha256: '${PINNED[FETCH]}'`;
if (readFileSync(CARRIER, 'utf8').split(CARRIER_PIN_LITERAL).length - 1 !== 1) fail('carrier pin literal is not single-occurrence');

// ---- legs: exact single-occurrence mutations of src/adapters/fetch.ts (one or more edits per leg);
// EXACT expected failed set; EXACT literal oracle collateral (authored by calibration, frozen in the
// canonical build). `runner` selects the canonical invocation of the runtime that proves the leg.
const LEGS = [
  { id: "F-1", title: "stream fan-out bypasses settleFacadeError (raw emit, no beforeError)", runner: "node", edits: [{ from: "        void settleFacadeError(mainConfig.hooks, streamResponse, err);", to: "        streamResponse.emit('error', err); // MUTATION F-1" }], expectedFailed: ["FP-01","FP-103","FP-107","FP-16","FP-18","FP-22","FP-27","FP-37","FP-55","FP-63","FP-65","FP-67","FP-69","FP-85","FP-95"], expectedCollateral: ["assertion:FP-01:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-103:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-107:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-16:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-18:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-22:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-27:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-37:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-55:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-63:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-65:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-67:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-69:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-85:hook:beforeError present: expected -1 to be greater than -1","assertion:FP-95:hook:beforeError present: expected -1 to be greater than -1","failed-summary:9392bed30fc89d1709c3f320aef7e3699c397250b201f28aad0dc7235e1e6ccb","passed-summary:fcd1e33890fb56f92b9c485e0d3bb69aa50baf25a7ada3474ad24090ee6d9b3e","signature-drift:FP-01:7e464ed9ba4cfae67c9db7f305e647a092fed95c8f95241fea59c5269f8becf6","signature-drift:FP-103:90a821877d9048e5faa46dcc9988ef1390971c834364e1383a95d6ff7e04f7ac","signature-drift:FP-107:8f7263f3fdf8b840be49cd993ee186e31e180fa6ae973bda57e26f392e65cf94","signature-drift:FP-16:0114487ab7a348dcd539dcc0b87611d8410a94d4c1fcfc4814ed5e3f6d3ed3ac","signature-drift:FP-18:fc3a0febcb5247adde1ad9ba0ed26b40e39700eeca02203098c4596670a8542c","signature-drift:FP-22:75c26e3dbc696f709963d3d2f181668bce55ef14855ee5b06a8cf43497b624b1","signature-drift:FP-27:a47faab4b6922c475dfd118145afdaefd792b0042ee416fa18da131d46b7e55b","signature-drift:FP-37:a47faab4b6922c475dfd118145afdaefd792b0042ee416fa18da131d46b7e55b","signature-drift:FP-55:cd3347da200b45effe32da9bfb57859fd28e33fffef14ec3ffc99104989bf0c4","signature-drift:FP-63:289310081575247014f10b180bdb50e974cfdf693e6bed6f8234958d2bcf6bad","signature-drift:FP-65:cd3347da200b45effe32da9bfb57859fd28e33fffef14ec3ffc99104989bf0c4","signature-drift:FP-67:cd3347da200b45effe32da9bfb57859fd28e33fffef14ec3ffc99104989bf0c4","signature-drift:FP-69:14e19d85792b7cd7bde4437c29739692fef0d30b62b7ef76dd6e79987b532202","signature-drift:FP-85:969ccedd431bfdbdeb3f31d844a0eb1d3bf988b7e3534ca998b5f8e41c59ac3b","signature-drift:FP-95:6894427a7aa9903ef6ef6da15cc368a26acab9b3863f34f6e5a32afadf3b36a1"] },
  { id: "F-2", title: "ABORT_ERR hard-final gate removed (cancellation reaches the retry policy)", runner: "node", edits: [{ from: "        if ((response as { code?: unknown }).code === 'ABORT_ERR') {\n          throw response;\n        }", to: "        // MUTATION F-2: hard-final gate removed" }], expectedFailed: [], expectedCollateral: ["signature-drift:FP-63:45b70f9dc2de470e9a194ccca34f329ce9080d134b387d88745e1915a55b6a85"] },
  { id: "F-3", title: "onAbort final-error site removed", runner: "node", edits: [{ from: "      if (finalError instanceof RezoError && finalError.code === 'ABORT_ERR') {\n        notifyFetchAbortHooksOnce(config, _stats, requestUrl, timing.startTime, finalError.message);\n      }", to: "      // MUTATION F-3: onAbort site removed" }], expectedFailed: ["FP-27","FP-29","FP-33","FP-37","FP-55","FP-63","FP-65","FP-67","FP-87","FP-93"], expectedCollateral: ["assertion:FP-27:expected +0 to be 1 // Object.is equality","assertion:FP-29:expected +0 to be 1 // Object.is equality","assertion:FP-33:expected +0 to be 1 // Object.is equality","assertion:FP-37:expected +0 to be 1 // Object.is equality","assertion:FP-55:hook:onAbort present: expected -1 to be greater than -1","assertion:FP-63:expected +0 to be 1 // Object.is equality","assertion:FP-65:hook:onAbort present: expected -1 to be greater than -1","assertion:FP-67:hook:onAbort present: expected -1 to be greater than -1","assertion:FP-87:expected { Object (afterHeaders, afterParse, ...) } to deeply equal { Object (afterHeaders, afterParse, ...) }","assertion:FP-93:expected +0 to be 1 // Object.is equality","failed-summary:36a4dcb25f80c891fa854e678afdb44354e14ec42c9dc873d50c5cb42f0ff97a","passed-summary:9a1900a005948c4afb5b31a940ed3ce2820163b147df38bb68c297d15401f7c7","signature-drift:FP-27:fb4a448445fed8960f3ebddf216d91277823b68982905447243b2004c27759a1","signature-drift:FP-29:fe627e333fe10d81a4126b968e0b89fe27af3431788338fc07d84f97631d24bb","signature-drift:FP-33:48b5155976126adfb05b296a9489e28d8e388fd18007f127259316099dd408db","signature-drift:FP-37:fb4a448445fed8960f3ebddf216d91277823b68982905447243b2004c27759a1","signature-drift:FP-55:a84a19163f42361f6cf60a8b789529e0410743f332d0457f8ab62432f764a04e","signature-drift:FP-63:b8a1cd58287af038c66b9802efe507de786329538d0102aa339c704a7074c0de","signature-drift:FP-65:a84a19163f42361f6cf60a8b789529e0410743f332d0457f8ab62432f764a04e","signature-drift:FP-67:a84a19163f42361f6cf60a8b789529e0410743f332d0457f8ab62432f764a04e","signature-drift:FP-87:2592ea4b34c098d17fa9ca63bc4f59ef48d9af3c41505a528b6b5c62df8def97","signature-drift:FP-93:9432447c456014c51723df464aa0f0c6f95be82a543b427302c64a8f0b831eab"] },
  { id: "F-4", title: "status-code retry delay un-raced and undisposed (plain setTimeout)", runner: "node", edits: [{ from: "              await awaitRetryDelay(currentDelay);\n              _stats.deferredHeaderEvents = undefined;", to: "              await new Promise((resolve) => setTimeout(resolve, currentDelay)); // MUTATION F-4\n              _stats.deferredHeaderEvents = undefined;" }], expectedFailed: ["FP-87"], expectedCollateral: ["assertion:FP-87:expected { delay: 600, disposal: 'fired' } to deeply equal { delay: 600, disposal: 'cleared' }","failed-summary:e6213f77d7ad60311bc8031d2cdb909bcaabe192b7b11b8c0c7ab9bf1490e943","passed-summary:9160764f6a12616081a09d899c0fdc66820d57fc9da660fbd335cef94a71183c","signature-drift:FP-87:d12dd5ceaf9cdf7919c9557bcbe74d72b2ee35183fbae97ed312b73c4074de83"] },
  { id: "F-5", title: "Retry-After wait loses the signal and the activity check", runner: "node", edits: [{ from: "              signal: rateLimitWaitController.signal,\n              isActive: () => rateLimitWaitController.signal.aborted !== true,", to: "              // MUTATION F-5: signal/isActive removed" }], expectedFailed: [], expectedCollateral: ["signature-drift:FP-93:caa05dedb86a92b260e8e56e907cbdbf875c22d814310ea7c67594aae6842a7a"] },
  { id: "F-6", title: "throwing validateStatus re-thrown (generic classification, body unconsumed)", runner: "node", edits: [{ from: "      try { await response.body?.cancel(); } catch { }\n      return buildFetchCallbackFailure(callbackFailure, config, fetchOptions);", to: "      throw callbackFailure; // MUTATION F-6" }], expectedFailed: ["FP-95","FP-97"], expectedCollateral: ["assertion:FP-95:expected 0 to be greater than or equal to 1","assertion:FP-97:expected 0 to be greater than or equal to 1","failed-summary:8862ee5c96764608db38344c8299bf0d9f7cf13d62e44f230ce5f7618116d5d8","passed-summary:fdc0555bebbc99bcdbf2a7fb7499d318a89a1d6c7706bc90acb019d14c5c4bd7","signature-drift:FP-95:802017e5f7d314d7273911687bd4ceda301f08f747b34b9465f1ef694cadee30","signature-drift:FP-97:e5ba69aaea7870ba98f03dabe61e8354db0ffc1c5f4916587640f0e8120d6fbd"] },
  { id: "F-7", title: "stream terminal order reverted (finish before end)", runner: "node", edits: [{ from: "    streamResult.emit('end');\n    streamResult.emit('finish', streamFinishEvent);", to: "    streamResult.emit('finish', streamFinishEvent); // MUTATION F-7\n    streamResult.emit('end');" }], expectedFailed: ["FP-10","FP-24","FP-99"], expectedCollateral: ["assertion:FP-10:expected [ 'initiated', 'start', …(10) ] to deeply equal [ 'initiated', 'start', …(10) ]","assertion:FP-24:expected [ 'initiated', 'start', …(11) ] to deeply equal [ 'initiated', 'start', …(11) ]","assertion:FP-99:expected [ 'initiated', 'start', …(10) ] to deeply equal [ 'initiated', 'start', …(10) ]","failed-summary:2d4185b63cb7384542a4182331fc001c721b000cf4928199bfb6c313408e963f","passed-summary:e530c0a652065c44a20d6c5d3b0a2d62443311a0b80f3faf9fe9d624d296ee6e","signature-drift:FP-04:5ac89db6bc81e133e3fbaff1f096a153424a1bd810cfb637a9c81296df3a2231","signature-drift:FP-10:69d56212193aaae7abc639e192ca8a1842c393b71333b670a3723c2cf6611c0e","signature-drift:FP-24:ef43199684838baa3d32ad4b677922a02f733ea1361c651bf3d0d1881c69ac50","signature-drift:FP-35:5ac89db6bc81e133e3fbaff1f096a153424a1bd810cfb637a9c81296df3a2231","signature-drift:FP-99:f855642a94bf2f15a21d5f37cd0589e6ede7b348ba3b54084cf9e3687414a0dd"] },
  { id: "F-9", title: "stream afterParse removed", runner: "node", edits: [{ from: "      runAfterParseHooks(config, { data: emptyBody, rawData: emptyBody as unknown as Buffer, contentType: response.headers.get('content-type') || '', parseDuration: 0, timestamp: Date.now() });", to: "      void emptyBody; // MUTATION F-9: stream afterParse removed" }], expectedFailed: ["FP-04","FP-10","FP-22","FP-24","FP-35","FP-99"], expectedCollateral: ["assertion:FP-04:expected +0 to be 1 // Object.is equality","assertion:FP-10:expected { afterHeaders: 1, …(9) } to deeply equal { Object (afterHeaders, afterParse, ...) }","assertion:FP-22:expected 'fulfilled' to be 'rejected' // Object.is equality","assertion:FP-24:expected { afterHeaders: 1, …(9) } to deeply equal { Object (afterHeaders, afterParse, ...) }","assertion:FP-35:expected +0 to be 1 // Object.is equality","assertion:FP-99:expected { afterHeaders: 1, …(9) } to deeply equal { Object (afterHeaders, afterParse, ...) }","failed-summary:b134cb7de93c76dae6140963a4216b999e37668be1c52e44d802135c6d0cd70b","passed-summary:1b3a1329d656e667d9189f2489640bbf767ec98eee07a68398d64438aa484e82","signature-drift:FP-04:c5a3b25c6dba7daccd69d6a3ef5c2c61e9801cf21c4614d865863f9c544d6c4d","signature-drift:FP-10:ec1f7fa038dfcfa1d830461fa1129389a4cf39752e037baae463ca448d47af98","signature-drift:FP-22:ec1f7fa038dfcfa1d830461fa1129389a4cf39752e037baae463ca448d47af98","signature-drift:FP-24:f7265a679d462561d26a0888ef6f50fb2c46d6acfda6f65a3db321d8f2e7ca70","signature-drift:FP-35:c5a3b25c6dba7daccd69d6a3ef5c2c61e9801cf21c4614d865863f9c544d6c4d","signature-drift:FP-99:9cfbd1b2a396c123323526676745f3e58cb583c74268a28ad9d65835a1cc0a7d"] },
  { id: "F-11", title: "decode identity set disabled (Bun decode failures unclassified)", runner: "bun", edits: [{ from: "    if (typeof code === 'string' && PLATFORM_DECODE_FAILURE_IDENTITIES.has(code)) found = { identity: code, source: current };\n    else if (PLATFORM_DECODE_FAILURE_IDENTITIES.has(current.name)) found = { identity: current.name, source: current };", to: "    if (false) found = { identity: String(code), source: current }; // MUTATION F-11: identity set disabled" }], expectedFailed: ["FP-04","FP-06","FP-08","FP-101","FP-105","FP-107","FP-121","FP-14","FP-35"], expectedCollateral: ["assertion:FP-04:expect(received).toBe(expected)","assertion:FP-06:expect(received).toBe(expected)","assertion:FP-08:expect(received).toBe(expected)","assertion:FP-101:expect(received).toBe(expected)","assertion:FP-105:expect(received).toEqual(expected)","assertion:FP-107:expect(received).toBe(expected)","assertion:FP-121:expect(received).toBe(expected)","assertion:FP-14:expect(received).toBe(expected)","assertion:FP-35:expect(received).toEqual(expected)","failed-summary:ff7dffdd2739e98932c5f247e2c961651fdc1deafde0f42d9f3090e17491e0d3","passed-summary:5a156fbfba4453a72e830a13396698e6b80cc96b192899960b556ae04bdffb00","signature-drift:FP-04:3d1dc889866564f110a7ecd470da0645ff3b88d79dcd4bb7cad530a07d772e37","signature-drift:FP-06:111890da5027bec1accc7e36d65dc1a838dd8ce7618e3657426a5051d0663020","signature-drift:FP-08:111c4f52256ef90c241f7aae535d8714c093090c681c734617276432c542bfd2","signature-drift:FP-101:a2acdbe672f4b992bab0490c66b541b0bc58627352cd8eb624bbe2f23d9f7a5a","signature-drift:FP-105:544599abbc1e6b7e3fd9d0cf5295b2ed79f7d3e744d7fd8d5c8a394885e476c6","signature-drift:FP-107:4bf3cd799631943a5d6cfe6cad51c69d18407b893b3e4756ed3f22f7f07048c3","signature-drift:FP-121:a2acdbe672f4b992bab0490c66b541b0bc58627352cd8eb624bbe2f23d9f7a5a","signature-drift:FP-14:b2531507c14f582b2b9620f3fc00dc2a87198a6560a8335bda2abe4f1bf299bb","signature-drift:FP-35:d4a58ac782eaf960abc11b9afc5f4b82d269da6a51ba9640a2b9a010909a668e"] },
  { id: "F-12", title: "body preparation no longer bounded by the attempt abort/timeout authority", runner: "node", edits: [{ from: "      preparedBody = await raceWithStageAbort(prepareFetchBody(body));", to: "      preparedBody = await prepareFetchBody(body); // MUTATION F-12" }], expectedFailed: ["FP-91"], expectedCollateral: ["assertion:FP-91:expected 'unsettled' to be 'rejected' // Object.is equality","failed-summary:f42adda41f032b63347b3eba2c40d9d4f5d43ba4e1c4093651ca62be48148117","passed-summary:5d28d3526d3249d4f58a39a3a62cc2a9650ae1c439de7a23a20aea16185073cb","signature-drift:FP-91:8daa84c298b0af2d48f777a9c9745d1f42b56743b87772eae9bf36c61b1d9fc3"] },
  { id: "F-13", title: "accepted manual redirect leaves the facade unfinished", runner: "node", edits: [{ from: "          publishFacadeTerminal(response);\n          return response;", to: "          return response; // MUTATION F-13: facade terminal removed" }], expectedFailed: ["FP-117","FP-119","FP-89"], expectedCollateral: ["assertion:FP-117:expected 'unsettled' to be 'fulfilled' // Object.is equality","assertion:FP-119:expected 'unsettled' to be 'fulfilled' // Object.is equality","assertion:FP-89:expected 'unsettled' to be 'fulfilled' // Object.is equality","failed-summary:a6ab4bd0592b67dc5d27617c8559a68b97a933d4539d8ff258141dee73ca3316","passed-summary:95d83e9387b17db47ff9191142836e648f975f6bf0b86c711420554586083a99","signature-drift:FP-117:ed9c4515968bc5577cb4dc30d07874ae9745bc8966ba8c5c8554d9279d51c5c5","signature-drift:FP-119:a7950989a8b9e8265219345f5501d28ee48b0590553bf6585bfb80b5f88eda82","signature-drift:FP-89:04e760866f396be2b0ec613e63afd2fa72e0a753b16c7360f2ce5ecede56aa63"] },
  { id: "F-14", title: "signal listener notifies onAbort itself and is never detached", runner: "node", edits: [{ from: "      onUserAbort = () => {\n        abortController.abort();\n      };", to: "      onUserAbort = () => {\n        abortController.abort();\n        notifyFetchAbortHooksOnce(config, _stats, url.toString(), timing.startTime, 'Request aborted by signal'); // MUTATION F-14\n      };" }, { from: "    if (userSignal && onUserAbort) userSignal.removeEventListener('abort', onUserAbort);", to: "    // MUTATION F-14: abort listener never detached" }], expectedFailed: ["FP-85"], expectedCollateral: ["assertion:FP-85:expected { afterHeaders: 1, …(9) } to deeply equal { afterHeaders: 1, …(9) }","failed-summary:f01a66f4be9c1504f991b326880eaf85b19ba616508626660f68ad5f97a460c9","passed-summary:9ad35decde2acd775c97b6775679b40b252ce311956f4071dd3b5ad84885d779","signature-drift:FP-85:4f27d067ef8e595e8ad0fabaebbb07a7f7861c89dc46de466ab2188b62844426"] },
  { id: "F-17", title: "partial-body afterParse removed (buffered truncation)", runner: "node", edits: [{ from: "        parsedPartial = runAfterParseHooks<T>(config, {\n          data: partialData,", to: "        parsedPartial = ((): T => partialData)(); void ({ // MUTATION F-17\n          data: partialData," }], expectedFailed: ["FP-02"], expectedCollateral: ["assertion:FP-02:expected { afterHeaders: 1, …(9) } to deeply equal { Object (afterHeaders, afterParse, ...) }","failed-summary:5fbde102bdfb98c1b0a0af49ff5bde0410a38c3aa523eabe1c2644619aafd064","passed-summary:4fefe31b0021302eef4b5f47ca2bde31e0e6b680f6f384581ecb25a96926aef3","signature-drift:FP-02:03c6bc840c7b2815d0fab4b24b5674f375fdbe7bbe5dce1e7d48eefe2134bd62"] },
  { id: "F-19", title: "transaction specifier reverted to the caller-relative path", runner: "node", edits: [{ from: "('../adapters/download-target-transaction.js');", to: "('./download-target-transaction.js'); // MUTATION F-19" }], expectedFailed: ["FP-06","FP-11","FP-49"], expectedCollateral: ["assertion:FP-06:expected 'rejected' to be 'fulfilled' // Object.is equality","assertion:FP-11:expected 'rejected' to be 'fulfilled' // Object.is equality","assertion:FP-49:expected 'rejected' to be 'fulfilled' // Object.is equality","failed-summary:a04f8530a8d429c5368cd4a87a067e2d7a0e43939da32d93990cd244b0530194","passed-summary:65221fa310571f6114e445d626739d4170132851bd09ede0b69e54e2ba9aa3c3","signature-drift:FP-06:5beb4ca340312b7036214378bbcd733d3623dc6521d79966b17559b5d490be48","signature-drift:FP-11:ce07cade8b54dcad5ce62ad8b8134a76c13e256158a156b539f2001e07848e7d","signature-drift:FP-49:a588610dfe9f0087d18aab0be5a8261eab10f47de7386967eb57682d72bdcb75"] },
  { id: "F-22", title: "decoder identity no longer resolved through the cause chain", runner: "node", edits: [{ from: "  while (current instanceof Error && depth <= 4) {", to: "  while (current instanceof Error && depth <= 0) { // MUTATION F-22: cause walk removed" }], expectedFailed: ["FP-101","FP-105","FP-107","FP-121"], expectedCollateral: ["assertion:FP-101:expected 'ECONNRESET' to be 'REZ_DECOMPRESSION_ERROR' // Object.is equality","assertion:FP-105:expected [ '0' ] to deeply equal [ 'null' ]","assertion:FP-107:expected 'ECONNRESET' to be 'REZ_UNKNOWN_ERROR' // Object.is equality","assertion:FP-121:expected 'ECONNRESET' to be 'REZ_DECOMPRESSION_ERROR' // Object.is equality","failed-summary:76976412a888ba78c337b5127f4f62dc1090f5c046e525c7d36b091af5bc13af","passed-summary:4f82142dd7b246aeb3d206903d89e369ed0691b247ffd7a72cb970fdc24ae96f","signature-drift:FP-101:79aa14b6c8f0081b5af57e4b891e4541dccac9afa7e264c6e04cc89f9faa9602","signature-drift:FP-105:544599abbc1e6b7e3fd9d0cf5295b2ed79f7d3e744d7fd8d5c8a394885e476c6","signature-drift:FP-107:b4345f5bf12edf67c2f8a5733e378b506639c61e48bf04660865c7b800284cd5","signature-drift:FP-121:79aa14b6c8f0081b5af57e4b891e4541dccac9afa7e264c6e04cc89f9faa9602"] },
  { id: "F-23", title: "stream RezoError pass-through moved after the platform classifiers", runner: "node", edits: [{ from: "    if (err instanceof RezoError) {\n      releaseReaderLock();\n      return err;\n    }", to: "    if (err instanceof RezoError) {\n      releaseReaderLock();\n    } // MUTATION F-23: pass-through demoted" }, { from: "    return buildSmartError(config, fetchOptions, normaliseFetchFailure(err, userSignal));", to: "    return err instanceof RezoError ? err : buildSmartError(config, fetchOptions, normaliseFetchFailure(err, userSignal)); // MUTATION F-23" }], expectedFailed: ["FP-103"], expectedCollateral: ["assertion:FP-103:expected 'rebuilt' to be 'injected' // Object.is equality","failed-summary:32d80917a3e4348cfb5e2f0ffdc726c656e6501f53e16d2ea4e8702acc4378aa","passed-summary:60cbf76280314d9614c637f70289251c0fe185a003be2de5bf5a30cc4c9694b4","signature-drift:FP-103:b4345f5bf12edf67c2f8a5733e378b506639c61e48bf04660865c7b800284cd5"] },
  { id: "F-24", title: "buffered decode-failure afterParse throw no longer a callback failure", runner: "node", edits: [{ from: "        let failure: RezoError;\n        try {\n        failure = buildDecompressionError<T>({", to: "        const failure = buildDecompressionError<T>({ // MUTATION F-24" }, { from: "        } catch (hookFailure) {\n          return buildFetchCallbackFailure(hookFailure, config, fetchOptions);\n        }\n        // The decompression cause rides", to: "        // The decompression cause rides" }], expectedFailed: ["FP-105"], expectedCollateral: ["assertion:FP-105:expected 'ECONNRESET' to be 'REZ_UNKNOWN_ERROR' // Object.is equality","failed-summary:7137062c4a1652725ef4f79b7db342f93d83ba1fe3f6e6ad74ee03c4d526a85d","passed-summary:401358869e4df049927dcc41a4ed897a4644d18145affa759b811151a8ed33ee","signature-drift:FP-105:f7778c1b0230a11caa2900d375856fd5b52cfe7b81c116d6ec554fc583807eb0"] },
  { id: "F-25", title: "stream decode-failure afterParse throw no longer a callback failure", runner: "node", edits: [{ from: "      let failure: RezoError;\n      try {\n      failure = buildDecompressionError({", to: "      const failure = buildDecompressionError({ // MUTATION F-25" }, { from: "      } catch (hookFailure) {\n        return buildFetchCallbackFailure(hookFailure, config, fetchOptions);\n      }\n      // No decompression cause outside download mode", to: "      // No decompression cause outside download mode" }], expectedFailed: ["FP-107"], expectedCollateral: ["assertion:FP-107:expected 'ECONNRESET' to be 'REZ_UNKNOWN_ERROR' // Object.is equality","failed-summary:2d8eb66d16f53137c15bf4dfeac2c617d5429e0c005a8583347c770de836fe19","passed-summary:cb2bddaa943f4ce006130c546e5bc15c527f9e577aa52fa13c5771fe81045922","signature-drift:FP-107:a83b3519778bbee58e1eb11d217cb45119f7826d445bbcb8ac8b54afa195d09e"] },
];
// Independent literal leg roster: the LEGS table must equal it exactly (ids, count, order).
// F-21 and F-26 were retired 2026-08-31 as equivalent mutants on the current
// bytes (both mutated runs pass 68/68: the retry rework made the post-race
// recheck redundant, and the outer-catch decoder scope closed F-26's window).
const LEG_IDS = Object.freeze(["F-1","F-2","F-3","F-4","F-5","F-6","F-7","F-9","F-11","F-12","F-13","F-14","F-17","F-19","F-22","F-23","F-24","F-25"]);
if (JSON.stringify(LEGS.map((l) => l.id)) !== JSON.stringify(LEG_IDS)) fail('LEGS table differs from the literal leg roster');
if (new Set(LEGS.map((l) => l.id)).size !== LEGS.length) fail('duplicate leg ids');
// Exact runner envelope literals per runtime (observed from the GREEN ledgers; any other invocation is invalid).
const RUNNER_LITERALS = Object.freeze({
  node: { argv: [PINNED_NODE.realpath, resolve(REPO_REAL, 'node_modules/vitest/dist/workers/forks.js')], execArgv: ['--experimental-import-meta-resolve', '--require', resolve(REPO_REAL, 'node_modules/vitest/suppress-warnings.cjs'), '--conditions', 'node', '--conditions', 'development'] },
  bun: { argv: [PINNED_BUN.realpath, resolve(REPO_REAL, CARRIER)], execArgv: [] },
});
const SOURCE_LITERALS = Object.freeze({ fetchAdapter: FETCH, fetchEntry: 'src/adapters/entries/fetch.ts', h1Adapter: 'src/adapters/http.ts', h1Entry: { node: 'src/platform/node.ts', bun: 'src/platform/bun.ts' } });
const PARITY_FIELDS_LITERAL = ["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","status","responseStatus","responseStatusText","responseContentLength","responseContentType","responseBodyLength","responseBodySha256","bodySha256","fileState","isFinished","doneEmitted","errorEvents","transformed","truncatedFlag","afterParsePayloads","normalizedSequence","wireHits","connections","causeOwnNonEnumerable","responseCookieNames","responseCookieValues","responseCookieString","responseSerializedCount","responseSetCookieCount","responseFinalUrl","responseUrlCount","retryAttempts","responseConfigStatus","responseConfigStatusText","responseContentLengthField","responseCookieNetscapeLines","jarAfterValues","retryDelayTimer","promptAfterAbort","headersEventCookies","afterHeadersEventCookies","errorIdentity","donePayloadCookies","finishPayloadCookies","hooks.retryBeforeRetry","hooks.retryCondition","hooks.retryExhausted","hooks.retryOnRetry","hooks.afterHeaders","hooks.afterParse","hooks.afterResponse","hooks.beforeError","hooks.onAbort","hooks.onTimeout"];
const RUNTIME_SPLIT_LITERAL = {"FP-04":["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","responseStatus","responseStatusText","responseContentLength","responseContentType","bodySha256","isFinished","doneEmitted","errorEvents","transformed","afterParsePayloads","normalizedSequence","responseCookieNames","responseCookieValues","responseCookieString","responseSerializedCount","responseSetCookieCount","responseFinalUrl","responseUrlCount","responseConfigStatus","responseConfigStatusText","responseContentLengthField","responseCookieNetscapeLines","donePayloadCookies","finishPayloadCookies","hooks.beforeError"],"FP-06":["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","responseStatus","responseStatusText","responseContentLength","responseContentType","fileState","isFinished","doneEmitted","errorEvents","transformed","normalizedSequence","causeOwnNonEnumerable","responseCookieNames","responseCookieValues","responseCookieString","responseSerializedCount","responseSetCookieCount","responseFinalUrl","responseUrlCount","responseConfigStatus","responseConfigStatusText","responseContentLengthField","responseCookieNetscapeLines","donePayloadCookies","finishPayloadCookies","hooks.beforeError"],"FP-08":["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","responseStatus","responseStatusText","responseContentLength","responseContentType","isFinished","doneEmitted","errorEvents","transformed","afterParsePayloads","normalizedSequence","responseCookieNames","responseCookieValues","responseCookieString","responseSerializedCount","responseSetCookieCount","responseFinalUrl","responseUrlCount","responseConfigStatus","responseConfigStatusText","responseContentLengthField","responseCookieNetscapeLines","donePayloadCookies","finishPayloadCookies","hooks.beforeError"],"FP-14":["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","responseStatus","responseStatusText","responseContentLength","responseContentType","bodySha256","errorEvents","transformed","truncatedFlag","afterParsePayloads","normalizedSequence","responseCookieNames","responseCookieValues","responseCookieString","responseSerializedCount","responseSetCookieCount","responseFinalUrl","responseUrlCount","responseConfigStatus","responseConfigStatusText","responseContentLengthField","responseCookieNetscapeLines","hooks.afterResponse","hooks.beforeError"],"FP-16":["wireHits"],"FP-27":["connections"],"FP-29":["connections"],"FP-33":["connections"],"FP-35":["terminal","code","errno","name","isRezoError","isNetworkError","isRetryable","isTimeout","hasCause","hasResponse","status","bodySha256","isFinished","doneEmitted","errorEvents","transformed","afterParsePayloads","normalizedSequence","retryAttempts","donePayloadCookies","finishPayloadCookies","hooks.beforeError"],"FP-37":["connections"],"FP-55":["wireHits"],"FP-65":["wireHits"],"FP-67":["wireHits"],"FP-69":["wireHits"],"FP-85":["connections"],"FP-89":["connections"],"FP-95":["connections"],"FP-97":["connections"],"FP-115":["connections"],"FP-117":["connections"],"FP-119":["connections"]};

// ---- exact, recursive envelope validation
const cat = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCount = (v) => Number.isInteger(v) && v >= 0;
const sameKeys = (obj, keys) => isObj(obj) && sortedJson(Object.keys(obj)) === sortedJson(keys);
const poolOk = (s) => sameKeys(s, POOL_SNAPSHOT_KEYS) && isCount(s.agents) && isCount(s.activeSockets) && isCount(s.freeSockets) && isCount(s.queuedRequests) && TIMER_STATES.includes(s.evictionTimer) && s.agentShape === 'node';
function validateEnvelope(ledger, runtime, expectedCarrierSha, expectedFetchSha) {
  const p = [];
  if (!isObj(ledger)) return ['envelope: not a plain object'];
  if (!sameKeys(ledger, ENVELOPE_KEYS)) p.push(`envelope: key set ${JSON.stringify(Object.keys(ledger).sort())} !== literal`);
  const need = (cond, msg) => { if (!cond) p.push(`envelope: ${msg}`); };
  need(ledger.schema === LEDGER_SCHEMA, 'schema'); need(ledger.epoch === 'green-v1', 'epoch'); need(ledger.runtime === runtime, 'runtime');
  need(ledger.runtimeVersion === (runtime === 'bun' ? PINNED_BUN.version : PINNED_NODE.version), 'runtimeVersion'); need(ledger.file === CARRIER, 'file');
  need(ledger.carrierSha256 === expectedCarrierSha, `carrierSha256 ${String(ledger.carrierSha256)} !== ${expectedCarrierSha}`);
  need(isObj(ledger.authenticity) && sameKeys(ledger.authenticity, ['fetch', 'h1']) && sameKeys(ledger.authenticity.fetch, AUTHENTICITY_KEYS) && sameKeys(ledger.authenticity.h1, AUTHENTICITY_KEYS) && ledger.authenticity.fetch.adapter === 'fetch' && ledger.authenticity.h1.adapter === 'http' && ledger.authenticity.fetch.adapterSha256 === expectedFetchSha && ledger.authenticity.fetch.entrySha256 === PINNED['src/adapters/entries/fetch.ts'] && ledger.authenticity.h1.adapterSha256 === PINNED['src/adapters/http.ts'] && ledger.authenticity.h1.entrySha256 === PINNED[runtime === 'bun' ? 'src/platform/bun.ts' : 'src/platform/node.ts'], 'authenticity (adapter identities + mutated fetch sha + pinned entries)');
  need(isObj(ledger.authenticity) && ledger.authenticity.fetch.adapterSource === SOURCE_LITERALS.fetchAdapter && ledger.authenticity.fetch.entrySource === SOURCE_LITERALS.fetchEntry && ledger.authenticity.h1.adapterSource === SOURCE_LITERALS.h1Adapter && ledger.authenticity.h1.entrySource === SOURCE_LITERALS.h1Entry[runtime], 'authenticity source paths literal');
  need(isObj(ledger.closingAuthenticity) && sameKeys(ledger.closingAuthenticity, CLOSING_KEYS) && ledger.closingAuthenticity.carrierSha256 === expectedCarrierSha && ledger.closingAuthenticity.fetchAdapterSha256 === expectedFetchSha && ledger.closingAuthenticity.fetchEntrySha256 === PINNED['src/adapters/entries/fetch.ts'] && ledger.closingAuthenticity.h1AdapterSha256 === PINNED['src/adapters/http.ts'] && ledger.closingAuthenticity.h1EntrySha256 === PINNED[runtime === 'bun' ? 'src/platform/bun.ts' : 'src/platform/node.ts'], 'closingAuthenticity (every closing identity equals its pin)');
  need(isObj(ledger.contract) && sameKeys(ledger.contract, CONTRACT_KEYS) && ledger.contract.targetCount === TARGETS.length && ledger.contract.controlCount === CONTROLS.length && ledger.contract.rowCount === ROSTER.length && ledger.contract.runnerTests === RUNNER_TESTS && sortedJson(ledger.contract.targets) === sortedJson(TARGETS) && sortedJson(ledger.contract.controls) === sortedJson(CONTROLS), 'contract literal');
  need(isObj(ledger.runner) && sameKeys(ledger.runner, RUNNER_KEYS) && JSON.stringify(ledger.runner.argv) === JSON.stringify(RUNNER_LITERALS[runtime].argv) && JSON.stringify(ledger.runner.execArgv) === JSON.stringify(RUNNER_LITERALS[runtime].execArgv) && ledger.runner.execPath === (runtime === 'bun' ? PINNED_BUN.realpath : PINNED_NODE.realpath) && ledger.runner.cwd === REPO_REAL && ledger.runner.rowTestTimeoutMs === 60000 && ledger.runner.rowWatchdogMs === 10000, 'runner envelope (exact argv/execArgv literals, execPath, cwd, timeouts)');
  need(isStrArray(ledger.passed), 'passed type'); need(isStrArray(ledger.failed), 'failed type');
  need(isStrArray(ledger.expectedPassed) && sortedJson(ledger.expectedPassed) === sortedJson(ROSTER), 'expectedPassed literal');
  need(isStrArray(ledger.registered) && sortedJson(ledger.registered) === sortedJson(ROSTER), 'registered literal');
  need(ledger.legCount === ROSTER.length, 'legCount');
  need(isObj(ledger.registry) && sameKeys(ledger.registry, ['controls', 'targets']) && sortedJson(ledger.registry.targets) === sortedJson(TARGETS) && sortedJson(ledger.registry.controls) === sortedJson(CONTROLS), 'registry literal partition');
  need(isStrArray(ledger.fixtureErrors) && ledger.fixtureErrors.length === 0, 'fixtureErrors empty'); need(isStrArray(ledger.setupErrors) && ledger.setupErrors.length === 0, 'setupErrors empty'); need(isStrArray(ledger.teardownErrors) && ledger.teardownErrors.length === 0, 'teardownErrors empty');
  need(Array.isArray(ledger.listeners) && ledger.listeners.length === 0, 'listeners empty'); need(isStrArray(ledger.oracleMismatches), 'oracleMismatches type');
  need(isObj(ledger.processFaults) && sameKeys(ledger.processFaults, ['uncaught', 'unhandled']) && ledger.processFaults.uncaught === 0 && ledger.processFaults.unhandled === 0, 'processFaults zero');
  need(isObj(ledger.parity) && sameKeys(ledger.parity, PARITY_KEYS) && JSON.stringify(ledger.parity.fields) === JSON.stringify(PARITY_FIELDS_LITERAL) && JSON.stringify(ledger.parity.runtimeSplit) === JSON.stringify(RUNTIME_SPLIT_LITERAL) && Array.isArray(ledger.parity.tableProblems) && ledger.parity.tableProblems.length === 0, 'parity (literal fields, literal runtimeSplit, no table problems)');
  need(isObj(ledger.cleanup) && sameKeys(ledger.cleanup, ['endState', 'forced']) && sameKeys(ledger.cleanup.endState, CLEANUP_END_STATE_KEYS) && CLEANUP_END_STATE_KEYS.every((k) => ledger.cleanup.endState[k] === 0) && sameKeys(ledger.cleanup.forced, CLEANUP_FORCED_KEYS) && CLEANUP_FORCED_KEYS.every((k) => isCount(ledger.cleanup.forced[k])), 'cleanup');
  need(isObj(ledger.clientPools) && sameKeys(ledger.clientPools, CLIENT_POOL_KEYS) && sameKeys(ledger.clientPools.endState, ['h1']) && sameKeys(ledger.clientPools.natural, ['h1']) && (ledger.clientPools.endState.h1 === null || poolOk(ledger.clientPools.endState.h1)) && (ledger.clientPools.natural.h1 === null || poolOk(ledger.clientPools.natural.h1)), 'clientPools (h1 snapshots typed)');
  if (isObj(ledger.legs)) {
    need(sortedJson(Object.keys(ledger.legs)) === sortedJson(LEG_KEYS), 'legs: exact literal leg keys');
    for (const [key, leg] of Object.entries(ledger.legs)) {
      if (!isObj(leg)) { p.push(`leg ${key}: not an object`); continue; }
      if (!sameKeys(leg, OBSERVATION_KEYS)) p.push(`leg ${key}: observation key set differs`);
      for (const [field, allowed] of Object.entries(OBSERVATION_TYPES)) if (field in leg && !allowed.includes(cat(leg[field]))) p.push(`leg ${key}: ${field} type ${cat(leg[field])} not in ${JSON.stringify(allowed)}`);
      for (const field of STRING_ARRAY_FIELDS) if (Array.isArray(leg[field]) && !isStrArray(leg[field])) p.push(`leg ${key}: ${field} elements`);
      if (!(isObj(leg.hooks) && sameKeys(leg.hooks, HOOK_KEYS) && HOOK_KEYS.every((k) => isCount(leg.hooks[k])))) p.push(`leg ${key}: hooks shape`);
      if (leg.fileState !== null && !(isObj(leg.fileState) && sameKeys(leg.fileState, ['exists', 'length', 'sha256']) && typeof leg.fileState.exists === 'boolean' && isCount(leg.fileState.length) && typeof leg.fileState.sha256 === 'string')) p.push(`leg ${key}: fileState shape`);
      if (leg.retryDelayTimer !== null && !(isObj(leg.retryDelayTimer) && sameKeys(leg.retryDelayTimer, ['delay', 'disposal']) && typeof leg.retryDelayTimer.delay === 'number' && DISPOSALS.includes(leg.retryDelayTimer.disposal))) p.push(`leg ${key}: retryDelayTimer shape`);
      if (!(isObj(leg.clientNaturalAtCaseEnd) && sameKeys(leg.clientNaturalAtCaseEnd, ['h1']) && (leg.clientNaturalAtCaseEnd.h1 === null || poolOk(leg.clientNaturalAtCaseEnd.h1)))) p.push(`leg ${key}: clientNaturalAtCaseEnd shape`);
      if (!isCount(leg.wireHits) || !isCount(leg.connections) || !isCount(leg.errorEvents)) p.push(`leg ${key}: counts`);
      if (leg.runtime !== runtime) p.push(`leg ${key}: runtime`);
      if (!TERMINALS.includes(leg.terminal)) p.push(`leg ${key}: terminal ${String(leg.terminal)}`);
    }
  } else p.push('envelope: legs not an object');
  return p;
}
// Collateral normalised to a literal that keeps its identifying payload; the carrier writes the row id
// into every late-wire entry, so attribution is exact (an entry without a roster row is invalid).
const ROSTER_SET = new Set(ROSTER);
function normaliseCollateral(entry) {
  let m;
  if ((m = /^signature-drift:(FP-[0-9C]+):([\s\S]*)$/.exec(entry))) return `signature-drift:${m[1]}:${sha256Text(m[2])}`;
  if ((m = /^late-wire:(FP-[0-9C]+):([\s\S]*?):(\d+\/\d+!==\d+\/\d+)$/.exec(entry))) return `late-wire:${ROSTER_SET.has(m[1]) ? m[1] : `UNKNOWN-ROW[${m[1]}]`}:${m[2]}:${m[3]}`;
  if (/^passed:\[/.test(entry)) return `passed-summary:${sha256Text(entry)}`;
  if (/^failed:\[/.test(entry)) return `failed-summary:${sha256Text(entry)}`;
  if ((m = /^(FP-[0-9C]+):([\s\S]*)$/.exec(entry))) return `assertion:${m[1]}:${m[2]}`;
  return `other:${entry}`;
}

// ---- restoration: only after a mutation began; guaranteed on every exit path including signals.
let mutationBegan = false; let finalized = false;
const restoreAll = () => { const out = {}; for (const [file, copy] of Object.entries(PRISTINE)) { try { copyFileSync(copy, file); out[file] = sha256(file); } catch (error) { out[file] = `RESTORE-FAILED:${String(error).slice(0, 80)}`; } } return out; };
const onSignal = (signal) => { if (finalized) return; const restored = mutationBegan ? restoreAll() : null; console.error(`driver interrupted by ${signal}; restored: ${JSON.stringify(restored)}`); process.exit(130); };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, () => onSignal(signal));

const nodeSummaryOf = (text) => { const all = text.match(/Tests\s+\d+ failed \| \d+ passed \(\d+\)|Tests\s+\d+ passed \(\d+\)/g) || []; return all.length === 1 ? all[0] : null; };
const bunSummaryOf = (text) => { const passAll = text.match(/^\s*(\d+) pass$/gm) || []; const failAll = text.match(/^\s*(\d+) fail$/gm) || []; const ranAll = text.match(/^Ran (\d+) tests? across/gm) || []; if (passAll.length !== 1 || ranAll.length !== 1 || failAll.length > 1) return null; return `${passAll[0].trim().split(' ')[0]} pass / ${failAll.length === 1 ? failAll[0].trim().split(' ')[0] : 0} fail / Ran ${ranAll[0].match(/\d+/)[0]}`; };
const results = []; const runInvalidities = [];
try {
  for (const leg of LEGS) {
    const invalid = [];
    const runtime = leg.runner;
    const pristineFetch = readFileSync(PRISTINE[FETCH], 'utf8');
    let mutatedSource = pristineFetch;
    for (const [index, edit] of leg.edits.entries()) { const count = mutatedSource.split(edit.from).length - 1; if (count !== 1) invalid.push(`edit ${index + 1}: anchor occurrences ${count} (expected 1)`); else mutatedSource = mutatedSource.replace(edit.from, () => edit.to); }
    const record = { id: leg.id, title: leg.title, runner: runtime, file: FETCH, edits: leg.edits, expectedFailed: leg.expectedFailed, expectedCollateral: leg.expectedCollateral, opening: opening[FETCH] };
    if (MODE === 'dry-run' || invalid.length > 0) { record.invalidities = invalid; record.valid = invalid.length === 0; results.push(record); console.log(JSON.stringify({ id: leg.id, mode: MODE, valid: record.valid, invalidities: invalid })); if (!record.valid) runInvalidities.push(`${leg.id}: ${invalid.join('; ')}`); continue; }
    const log = resolve(SCRATCH_REAL, `r16-legs-${leg.id}.log`);
    const mutatedSha = sha256Text(mutatedSource);
    const carrierMutated = readFileSync(PRISTINE[CARRIER], 'utf8').replace(CARRIER_PIN_LITERAL, `fetchAdapterSha256: '${mutatedSha}'`);
    const carrierMutatedSha = sha256Text(carrierMutated);
    let restoredSha = null, restoredCarrierSha = null, spawn = null;
    try {
      mutationBegan = true;
      writeFileSync(FETCH, mutatedSource); writeFileSync(CARRIER, carrierMutated);
      if (sha256(FETCH) !== mutatedSha || sha256(CARRIER) !== carrierMutatedSha) invalid.push('mutated bytes did not land as computed');
      // Synchronous child, bounded by a HARD deadline (SIGKILL on timeout); the parent's own signal
      // handlers run after the child returns, so restoration never races the child.
      spawn = runtime === 'bun'
        ? spawnSync(PINNED_BUN.realpath, BUN_ARGS, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: LEG_TIMEOUT_MS, killSignal: 'SIGKILL', env: CHILD_ENV })
        : spawnSync(nodeRealpath, VITEST_ARGS, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: LEG_TIMEOUT_MS, killSignal: 'SIGKILL', env: CHILD_ENV });
      writeFileSync(log, `${spawn.stdout ?? ''}\n--- stderr ---\n${spawn.stderr ?? ''}`);
    } finally {
      copyFileSync(PRISTINE[FETCH], FETCH); copyFileSync(PRISTINE[CARRIER], CARRIER); restoredSha = sha256(FETCH); restoredCarrierSha = sha256(CARRIER);
    }
    if (restoredSha !== PINNED[FETCH]) invalid.push(`restore mismatch ${restoredSha}`);
    if (restoredCarrierSha !== PINNED[CARRIER]) invalid.push(`carrier restore mismatch ${restoredCarrierSha}`);
    if (spawn.error) invalid.push(`spawn error ${spawn.error.code ?? spawn.error.message}`);
    if (spawn.signal) invalid.push(`runner killed by ${spawn.signal}`);
    if (spawn.status !== 1) invalid.push(`child exit ${spawn.status} (expected exactly 1)`);
    const text = readFileSync(log, 'utf8');
    const runnerSummary = runtime === 'bun' ? bunSummaryOf(text) : nodeSummaryOf(text);
    const markerLines = text.split('\n').filter((line) => line.startsWith(MARKER));
    const harvestLines = text.split('\n').filter((line) => line.startsWith('REZO_R16_HARVEST_V1:'));
    if (harvestLines.length !== 1) invalid.push(`carrier harvest marker lines ${harvestLines.length} (expected exactly 1)`);
    let ledger = null, observedCollateral = null, actualFailed = null;
    if (markerLines.length !== 1) invalid.push(`carrier marker lines ${markerLines.length} (expected exactly 1 full line)`);
    else { try { const parsed = JSON.parse(markerLines[0].slice(MARKER.length)); if (isObj(parsed)) ledger = parsed; else invalid.push(`carrier ledger is ${cat(parsed)}, not an object`); } catch (error) { invalid.push(`carrier ledger unparsable: ${String(error).slice(0, 80)}`); } }
    if (ledger !== null) {
      invalid.push(...validateEnvelope(ledger, runtime, carrierMutatedSha, mutatedSha));
      actualFailed = isStrArray(ledger.failed) ? ledger.failed : [];
      if (sortedJson(actualFailed) !== sortedJson(leg.expectedFailed)) invalid.push(`failed set ${JSON.stringify(actualFailed)} !== expected ${JSON.stringify(leg.expectedFailed)}`);
      const expectedPassed = ROSTER.filter((id) => !leg.expectedFailed.includes(id));
      if (sortedJson(isStrArray(ledger.passed) ? ledger.passed : []) !== sortedJson(expectedPassed)) invalid.push('passed set differs from roster minus expected failed');
      if (isObj(ledger.legs)) for (const [key, leg0] of Object.entries(ledger.legs)) { const row = key.split(':')[0]; if (!leg.expectedFailed.includes(row) && isObj(leg0) && leg0.terminal !== 'fulfilled' && leg0.terminal !== 'rejected') invalid.push(`${row} terminal ${String(leg0.terminal)} outside the expected failed set`); }
      observedCollateral = (isStrArray(ledger.oracleMismatches) ? ledger.oracleMismatches : []).map(normaliseCollateral).sort();
      if (observedCollateral.some((c) => c.startsWith('late-wire:UNKNOWN-ROW'))) invalid.push('late-wire collateral names a row outside the roster');
      if (MODE === 'canonical' && JSON.stringify(observedCollateral) !== JSON.stringify([...leg.expectedCollateral].sort())) invalid.push(`collateral differs from the literal expected set (${observedCollateral.length} vs ${leg.expectedCollateral.length})`);
      const k = leg.expectedFailed.length;
      // A leg whose kill is ledger-level only (zero failing rows, afterAll
      // throws) still exits 1, but vitest's Tests line then reports no
      // failures; bun's runner already counts the afterAll failure via +1.
      const expectedSummary = runtime === 'bun' ? `${RUNNER_TESTS - k} pass / ${k + 1} fail / Ran ${RUNNER_TESTS + 1}` : k === 0 ? `Tests  ${RUNNER_TESTS} passed (${RUNNER_TESTS})` : `Tests  ${k} failed | ${RUNNER_TESTS - k} passed (${RUNNER_TESTS})`;
      if (runnerSummary === null || runnerSummary.replace(/\s+/g, ' ') !== expectedSummary.replace(/\s+/g, ' ')) invalid.push(`runner summary ${JSON.stringify(runnerSummary)} !== ${JSON.stringify(expectedSummary)}`);
    }
    if (MODE === 'calibration') invalid.push('calibration run: never valid');
    Object.assign(record, { command: runtime === 'bun' ? [PINNED_BUN.realpath, ...BUN_ARGS] : [nodeRealpath, ...VITEST_ARGS], exitCode: spawn.status, signal: spawn.signal, timedOut: spawn.error?.code === 'ETIMEDOUT', runnerSummary, actualFailed, observedCollateral, mutatedSha, carrierMutatedSha, restoredSha, restoredCarrierSha, log: { path: log, sha256: sha256(log) }, invalidities: invalid, valid: invalid.length === 0 });
    results.push(record); if (!record.valid) runInvalidities.push(`${leg.id}: ${invalid.join('; ')}`);
    console.log(JSON.stringify({ id: leg.id, runner: runtime, mode: MODE, valid: record.valid, failed: actualFailed, collateral: observedCollateral, invalidities: MODE === 'calibration' ? invalid.filter((x) => !x.startsWith('calibration')) : invalid }));
  }
} finally {
  const restored = mutationBegan ? restoreAll() : null; finalized = true;
  if (restored) for (const [file, actual] of Object.entries(restored)) if (actual !== PINNED[file]) runInvalidities.push(`final restore mismatch ${file} ${actual}`);
  const closing = Object.fromEntries(Object.keys(PINNED).map((file) => [file, sha256(file)]));
  for (const [file, actual] of Object.entries(closing)) if (actual !== PINNED[file]) runInvalidities.push(`closing identity ${file} ${actual}`);
  const closingAggregate = aggregate(); if (closingAggregate !== PINNED_AGGREGATE) runInvalidities.push(`closing aggregate ${closingAggregate}`);
  // Closing re-verification of EVERY identity the opening gate checked: driver, node, bun, vitest, pinned canonical paths.
  if (sha256(DRIVER_PATH) !== driverSha) runInvalidities.push('closing driver identity moved');
  if (sha256(nodeRealpath) !== PINNED_NODE.sha256 || realpathSync(process.execPath) !== PINNED_NODE.realpath) runInvalidities.push('closing node identity moved');
  if (sha256(PINNED_BUN.realpath) !== PINNED_BUN.sha256) runInvalidities.push('closing bun identity moved');
  if (sha256('node_modules/vitest/vitest.mjs') !== PINNED_VITEST.runnerSha256) runInvalidities.push('closing vitest identity moved');
  for (const file of Object.keys(PINNED)) { try { if (realpathSync(resolve(ROOT, file)) !== resolve(REPO_REAL, file)) runInvalidities.push(`closing canonical path moved: ${file}`); } catch { runInvalidities.push(`closing canonical path missing: ${file}`); } }
  if (realpathSync(ROOT) !== REPO_REAL) runInvalidities.push('closing repository identity moved');
  const valid = MODE === 'canonical' && BUILD === 'canonical' && runInvalidities.length === 0 && results.length === LEGS.length && results.every((r) => r.valid);
  const ledgerOut = { schema: 'rezo.r16.legs.ledger/v1', build: BUILD, mode: MODE, driver: { path: relative(ROOT, DRIVER_PATH), sha256: driverSha, expectedSha256: expectedDriverSha }, repository: REPO_REAL, node: { execPath: process.execPath, realpath: nodeRealpath, sha256: nodeSha, version: process.version, execArgv: process.execArgv }, bun: { realpath: PINNED_BUN.realpath, sha256: bunSha, version: bunVersion }, vitest: { version: vitestVersion, runnerSha256: vitestRunnerSha }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, roster: ROSTER, runnerTests: RUNNER_TESTS, legTimeoutMs: LEG_TIMEOUT_MS, contract: { envelopeKeys: ENVELOPE_KEYS, legKeys: LEG_KEYS.length, observationKeys: OBSERVATION_KEYS.length }, results, invalidities: runInvalidities, valid };
  writeFileSync(STAGED_FD, JSON.stringify(ledgerOut, null, 2) + '\n'); closeSync(STAGED_FD);
  // Publication is EXCLUSIVE (never overwrites a file that appeared mid-run): canonical only when valid.
  const publish = () => { mkdirSync(dirname(ledgerAbs), { recursive: true }); copyFileSync(STAGED_LEDGER, ledgerAbs, fsConstants.COPYFILE_EXCL); unlinkSync(STAGED_LEDGER); };
  if (MODE === 'canonical' && valid) publish(); else if (MODE !== 'canonical') publish();
  try { unlinkSync(LOCK_PATH); } catch { /* lock already gone */ }
  const published = MODE === 'canonical' && !valid ? STAGED_LEDGER : ledgerAbs;
  console.log(`ledger ${published} build=${BUILD} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 400) : ''}`);
  if (!valid) process.exitCode = 1;
}
