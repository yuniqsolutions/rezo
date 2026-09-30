// R15 v4g mutation battery — durable driver v4 (john; tayo seq 61306/61338/61362/61426).
// Run from the repository root:
//   REZO_LEGS_DRIVER_SHA256=<sha256 of this file> REZO_LEGS_SCRATCH=<new dir> REZO_LEGS_LEDGER=<new file> \
//     node test/r15-failure-surface-parity-legs.mjs [--dry-run | --calibrate]
// Fail-closed proof: the driver's own bytes are anchored by an independently supplied expected
// sha256; the Node executable/version, the vitest runner identity, the full R15 source set, the
// carrier and the src aggregate are pinned at opening and re-verified at closing; each leg applies
// one exact single-occurrence mutation, runs the canonical Node carrier invocation (argv, no shell,
// bounded), requires child exit 1, exactly one full-line carrier marker, a recursively typed ledger
// envelope, the exact expected failed set, the exact literal oracle collateral, a complete 90-leg
// inventory, no unsettled/unstable row outside the expected set, zero setup/teardown/fixture/table/
// listener/resource issues, and byte-exact restoration. Any invalidity ⇒ `valid:false` + nonzero exit.
// `--calibrate` records observed collateral for authoring and can NEVER produce a valid ledger.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Strict flags: exactly none, --dry-run, or --calibrate; anything else is a launch failure.
const FLAGS = process.argv.slice(2);
const MODE = FLAGS.length === 0 ? 'canonical' : FLAGS.length === 1 && FLAGS[0] === '--dry-run' ? 'dry-run' : FLAGS.length === 1 && FLAGS[0] === '--calibrate' ? 'calibration' : null;
const ROOT = process.cwd();
const DRIVER_PATH = fileURLToPath(import.meta.url);
const CARRIER = 'test/a-plus-failure-surface-parity.test.ts';
const HTTP = 'src/adapters/http.ts';
const HTTP2 = 'src/adapters/http2.ts';
const PINNED = Object.freeze({
  [CARRIER]: '3f56f209e025daa9b9b7975cc75c6f62de9e1046e4f9e890aa6686a9f2680aee',
  [HTTP]: 'a26715a4df7953c99e977d9e159eedf8c25de2549f22405f768e262708678e92',
  [HTTP2]: 'fdf5df4e6138b48abcd696fb462dff69ccd041f4d4b83c856aa7356ea0bc47a7',
  'src/core/rezo.ts': '359744266541763452261d2d060041fffacf0ab2f65e3df409361387ad466d27',
  'src/core/hooks.ts': '28cca4cdea83fc8e7b0dae0b07e2a974575fdb3140bac8521fefdf4077b725dc',
  'src/responses/buildResponse.ts': '0344d213a1eb022acfc5d27b135a9ea368df61f47e3fc8246176f977a43f321b',
});
const PINNED_AGGREGATE = '7fcce236f3d3108834bf791c4f186a5091184e04d1f48e9696f285855e8c077f';
const PINNED_NODE_VERSION = 'v25.9.0';
const PINNED_VITEST = Object.freeze({ version: '4.1.4', runnerSha256: '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6' });
const ROSTER = Object.freeze([...Array.from({ length: 83 }, (_, i) => `FP-${String(i + 1).padStart(2, '0')}`), 'FP-C1', 'FP-C2', 'FP-C3', 'FP-C4', 'FP-C5', 'FP-C6', 'FP-C7']);
const RUNNER_TESTS = 91;
const VITEST_ARGS = ['node_modules/vitest/vitest.mjs', 'run', CARRIER, '--pool=forks', '--isolate', '--no-file-parallelism', '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=60000', '--hookTimeout=45000', '--teardownTimeout=20000', '--bail=0', '--retry=0', '--reporter=verbose'];
const LEG_TIMEOUT_MS = 15 * 60 * 1000;
const MARKER = 'REZO_R15_LEDGER_V4:';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256Text = (text) => createHash('sha256').update(text).digest('hex');
const fail = (message) => { console.error(`driver invalid: ${message}`); process.exit(2); };
if (MODE === null) fail(`unrecognised flags ${JSON.stringify(FLAGS)} (allowed: none, --dry-run, --calibrate)`);
const PINNED_NODE_REALPATH = '/opt/homebrew/Cellar/node/25.9.0_2/bin/node';
const PINNED_NODE_SHA256 = 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc';
// Literal contract of the carrier ledger (extracted from the GREEN ledger of carrier 84e51249…):
const ENVELOPE_KEYS = ["cleanup","clientPools","epoch","expectedPassed","failed","file","fixtureErrors","legCount","legs","listeners","oracleMismatches","parity","passed","processFaults","registered","registry","runtime","runtimeVersion","schema","setupErrors","teardownErrors"];
const CLEANUP_END_STATE_KEYS = ["servers","sessions","sockets","temporaryDirectories","timers"];
const CLEANUP_FORCED_KEYS = ["serversClosed","sessionsDestroyed","socketsClosedWithSessions","socketsDestroyed","temporaryDirectoriesRemoved"];
const PARITY_KEYS = ["fields","protocolSplit","runtimeSplit","tableProblems"];
const CLIENT_POOL_KEYS = ["endState","natural"];
const LEG_KEYS = ["FP-01:h2:stream:truncated","FP-02:h2:buffered:truncated","FP-03:h1:stream:zstd-truncated","FP-04:h2:stream:zstd-truncated","FP-05:h1:download:zstd-truncated","FP-06:h2:download:zstd-truncated","FP-07:h1:upload:zstd-truncated","FP-08:h2:upload:zstd-truncated","FP-09:h2:buffered:happy","FP-10:h2:stream:happy","FP-11:h2:download:happy","FP-12:h2:upload:happy","FP-13:h1:stream:hold-after-prefix","FP-14:h2:buffered:zstd-truncated","FP-15:h1:stream:reset-before-headers","FP-16:h2:stream:reset-before-headers","FP-17:h1:stream:happy","FP-18:h2:stream:happy","FP-19:h1:download:happy","FP-20:h2:download:happy","FP-21:h1:stream:happy","FP-22:h2:stream:happy","FP-23:h1:stream:happy","FP-24:h2:stream:happy","FP-25:h1:buffered:happy","FP-26:h2:buffered:happy","FP-27:h2:stream:hold-after-prefix","FP-28:h1:download:hold-after-prefix","FP-29:h2:download:hold-after-prefix","FP-30:h1:stream:happy","FP-31:h2:stream:happy","FP-32:h1:buffered:hold-after-prefix","FP-33:h2:buffered:hold-after-prefix","FP-34:h1:stream:zstd-truncated","FP-35:h2:stream:zstd-truncated","FP-36:h1:stream:hold-after-prefix","FP-37:h2:stream:hold-after-prefix","FP-38:h1:stream:happy","FP-39:h2:stream:happy","FP-40:h1:buffered:happy","FP-41:h2:buffered:happy","FP-42:h1:upload:happy","FP-43:h2:upload:happy","FP-44:h1:download:happy","FP-45:h2:download:happy","FP-46:h1:buffered:happy","FP-47:h2:buffered:happy","FP-48:h1:download:happy","FP-49:h2:download:happy","FP-50:h1:buffered:happy","FP-51:h2:buffered:happy","FP-52:h1:upload:happy","FP-53:h2:upload:happy","FP-54:h1:stream:reset-before-headers","FP-55:h2:stream:reset-before-headers","FP-56:h1:download:happy","FP-57:h2:download:happy","FP-58:h1:upload:happy","FP-59:h2:upload:happy","FP-60:h1:upload:happy","FP-61:h2:upload:happy","FP-62:h1:stream:happy","FP-63:h2:stream:happy","FP-64:h1:stream:reset-before-headers","FP-65:h2:stream:reset-before-headers","FP-66:h1:stream:reset-before-headers","FP-67:h2:stream:reset-before-headers","FP-68:h1:stream:reset-before-headers","FP-69:h2:stream:reset-before-headers","FP-70:h1:stream:reset-before-headers","FP-71:h2:stream:reset-before-headers","FP-72:h1:stream:reset-before-headers","FP-73:h2:stream:reset-before-headers","FP-74:h1:stream:reset-before-headers","FP-75:h2:stream:reset-before-headers","FP-76:h1:stream:reset-before-headers","FP-77:h2:stream:reset-before-headers","FP-78:h1:stream:reset-before-headers","FP-79:h2:stream:reset-before-headers","FP-80:h1:stream:reset-before-headers","FP-81:h2:stream:reset-before-headers","FP-82:h1:stream:reset-before-headers","FP-83:h2:stream:reset-before-headers","FP-C1:h1:stream:truncated","FP-C2:h1:buffered:truncated","FP-C3:h1:buffered:zstd-truncated","FP-C4:h1:buffered:happy","FP-C5:h1:stream:happy","FP-C6:h1:download:happy","FP-C7:h1:upload:happy"];
const OBSERVATION_KEYS = ["afterParsePayloads","bodySha256","causeCode","causeDescriptor","causeMessage","causeName","causeOwnNonEnumerable","clientNaturalAtCaseEnd","closeEmitted","code","connections","doneEmitted","errno","errorEvents","fileState","fixtureEchoes","hasCause","hasResponse","hooks","isFinished","isNetworkError","isRetryable","isRezoError","isTimeout","jarAfterValues","lateConnections","lateHits","message","name","normalizedSequence","progressEmitted","rawSequence","resetSurface","responseBodyLength","responseBodySha256","responseConfigStatus","responseConfigStatusText","responseContentLength","responseContentLengthField","responseContentType","responseCookieNames","responseCookieNetscapeLines","responseCookieString","responseCookieValues","responseFinalUrl","responseHeaderNames","responseHeaderValues","responseSerializedCount","responseSetCookieCount","responseStatus","responseStatusText","responseUrlCount","retryAttempts","retryTimerDelays","retryTimerDisposal","retryVectors","runtime","status","terminal","transformed","truncatedFlag","wireHits"];
const OBSERVATION_TYPES = {"afterParsePayloads":["array"],"bodySha256":["null","string"],"causeCode":["null","string"],"causeDescriptor":["string"],"causeMessage":["null","object","string"],"causeName":["null","string"],"causeOwnNonEnumerable":["boolean","null"],"clientNaturalAtCaseEnd":["object"],"closeEmitted":["boolean"],"code":["null","string"],"connections":["number"],"doneEmitted":["boolean"],"errno":["null","number","string"],"errorEvents":["number"],"fileState":["null","object"],"fixtureEchoes":["array"],"hasCause":["boolean","null"],"hasResponse":["boolean","null"],"hooks":["object"],"isFinished":["boolean","null"],"isNetworkError":["boolean","null","string"],"isRetryable":["boolean","null","string"],"isRezoError":["boolean","null"],"isTimeout":["boolean","null","string"],"jarAfterValues":["array","null"],"lateConnections":["number"],"lateHits":["number"],"message":["null","object","string"],"name":["null","string"],"normalizedSequence":["array"],"progressEmitted":["boolean"],"rawSequence":["array"],"resetSurface":["null","object"],"responseBodyLength":["null","number"],"responseBodySha256":["null","string"],"responseConfigStatus":["null","number"],"responseConfigStatusText":["null","string"],"responseContentLength":["null","string"],"responseContentLengthField":["null","number"],"responseContentType":["null","string"],"responseCookieNames":["array","null"],"responseCookieNetscapeLines":["null","number"],"responseCookieString":["null","string"],"responseCookieValues":["array","null"],"responseFinalUrl":["null","string"],"responseHeaderNames":["array","null"],"responseHeaderValues":["array","null"],"responseSerializedCount":["null","number"],"responseSetCookieCount":["null","number"],"responseStatus":["null","number"],"responseStatusText":["null","string"],"responseUrlCount":["null","number"],"retryAttempts":["number","string"],"retryTimerDelays":["array"],"retryTimerDisposal":["array"],"retryVectors":["array"],"runtime":["string"],"status":["null","number","string"],"terminal":["string"],"transformed":["boolean","null"],"truncatedFlag":["boolean","null"],"wireHits":["number"]};
const TERMINALS = ['fulfilled', 'rejected', 'unsettled', 'unstable'];
const CONTROLS = ['FP-C1', 'FP-C2', 'FP-C3', 'FP-C4', 'FP-C5', 'FP-C6', 'FP-C7'];
const TARGETS = Array.from({ length: 83 }, (_, i) => `FP-${String(i + 1).padStart(2, '0')}`);
const sortedJson = (list) => JSON.stringify([...list].sort());
// The src aggregate uses the exact R15 shell algorithm (no interpolated input).
// The source aggregate covers the H1/H2 lane's source set (the pinned files plus every helper the two adapters
// import for timeouts, telemetry and request configuration). It is NOT the whole src tree: a second lane edits
// src/ concurrently and a whole-tree pin could never hold between opening and closing.
const LANE_SOURCE_SET = Object.freeze([CARRIER, HTTP, HTTP2, 'src/core/rezo.ts', 'src/core/hooks.ts', 'src/responses/buildResponse.ts', 'src/responses/sanitize-config.ts', 'src/utils/staged-timeout.ts', 'src/utils/socket-telemetry.ts', 'src/utils/http-config.ts', 'src/shared/index.ts', 'src/shared/create-total-deadline.ts', 'src/shared/create-staged-timeout-error.ts']);
const aggregate = () => sha256Text(LANE_SOURCE_SET.map((p) => `${p}\0${sha256(p)}\n`).join(''));

// ---- launch anchor and tool identity
const expectedDriverSha = process.env.REZO_LEGS_DRIVER_SHA256;
const driverSha = sha256(DRIVER_PATH);
if (!expectedDriverSha) fail('REZO_LEGS_DRIVER_SHA256 (the announced driver identity) is required');
if (expectedDriverSha !== driverSha) fail(`driver bytes ${driverSha} differ from the announced identity ${expectedDriverSha}`);
if (process.version !== PINNED_NODE_VERSION) fail(`node ${process.version} differs from the pinned ${PINNED_NODE_VERSION}`);
const nodeRealpath = realpathSync(process.execPath);
if (nodeRealpath !== PINNED_NODE_REALPATH) fail(`node executable ${nodeRealpath} differs from the pinned ${PINNED_NODE_REALPATH}`);
const nodeSha = sha256(nodeRealpath);
if (nodeSha !== PINNED_NODE_SHA256) fail(`node binary ${nodeSha} differs from the pinned ${PINNED_NODE_SHA256}`);
const vitestVersion = JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version;
const vitestRunnerSha = sha256('node_modules/vitest/vitest.mjs');
if (vitestVersion !== PINNED_VITEST.version || vitestRunnerSha !== PINNED_VITEST.runnerSha256) fail(`vitest identity ${vitestVersion}/${vitestRunnerSha} differs from the pinned ${PINNED_VITEST.version}/${PINNED_VITEST.runnerSha256}`);

// ---- paths (canonical-parent containment, symlink-proof): the scratch root must be a FRESH
// path OUTSIDE the repository; the ledger must live inside the scratch root (dry-run /
// calibration) or be exactly the repository author ledger path (canonical), never pre-existing.
const SCRATCH = process.env.REZO_LEGS_SCRATCH; const LEDGER = process.env.REZO_LEGS_LEDGER;
if (!SCRATCH || !LEDGER) fail('REZO_LEGS_SCRATCH and REZO_LEGS_LEDGER are both required');
const REPO_REAL = realpathSync(ROOT);
const canonicalParent = (p) => { let dir = resolve(p); while (!existsSync(dir)) dir = dirname(dir); return realpathSync(dir); };
const inside = (p, dir) => { const r = relative(dir, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const scratchAbs = resolve(SCRATCH); const ledgerAbs = resolve(LEDGER);
if (existsSync(scratchAbs)) fail(`scratch root already exists: ${scratchAbs} (a fresh external root is required)`);
if (inside(canonicalParent(scratchAbs), REPO_REAL)) fail(`scratch root ${scratchAbs} resolves inside the repository ${REPO_REAL}`);
if (existsSync(ledgerAbs)) fail(`ledger output already exists: ${ledgerAbs}`);
mkdirSync(scratchAbs, { recursive: true });
const SCRATCH_REAL = realpathSync(scratchAbs);
if (MODE === 'canonical') {
  if (resolve(ledgerAbs) !== resolve(ROOT, 'plans/r15-failure-surface-parity-legs-ledger.json') || !inside(canonicalParent(ledgerAbs), REPO_REAL)) fail('canonical mode writes exactly plans/r15-failure-surface-parity-legs-ledger.json inside the repository');
} else if (!inside(canonicalParent(ledgerAbs), SCRATCH_REAL)) fail(`${MODE} ledger ${ledgerAbs} must live inside the scratch root ${SCRATCH_REAL}`);

// ---- opening identities pinned BEFORE any mutation; pristine copies verified against the pins.
const opening = {};
for (const [file, expected] of Object.entries(PINNED)) { const actual = sha256(file); opening[file] = actual; if (actual !== expected) fail(`${file}: actual ${actual} expected ${expected}`); }
const openingAggregate = aggregate();
if (openingAggregate !== PINNED_AGGREGATE) fail(`src aggregate: actual ${openingAggregate} expected ${PINNED_AGGREGATE}`);
const PRISTINE = { [HTTP]: resolve(scratchAbs, 'http.ts.pristine'), [HTTP2]: resolve(scratchAbs, 'http2.ts.pristine') };
for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(file, copy); if (sha256(copy) !== PINNED[file]) fail(`pristine copy of ${file} does not match the pin`); }

// ---- legs: exact single-occurrence mutations; EXACT expected failed set; EXACT literal oracle
// collateral (normalised kind:row entries, authored from the calibration pass and frozen here).
const LEGS = [
  { id: "M-J1", title: "helper post-success recheck removed", file: "src/adapters/http.ts", from: "        cancellationWins();\n        throwIfTotalExpired();\n        return result;", to: "        // MUTATION M-J1: post-success recheck removed\n        throwIfTotalExpired();\n        return result;", expectedFailed: ["FP-70"], expectedCollateral: ["assertion:FP-70:expected 'ECONNRESET' to be 'ABORT_ERR' // Object.is equality","other:failed:[\"FP-70\"]","passed-summary:149058bcf584bbe9b2628eb3a5f3ad19d2dd28c28d89eec5cb034a4d05566bf8","signature-drift:FP-70:1405745f71b412a4bcc7eeeebdc20839ff05c5f84a7bf0ca94dba18f4f413420"] },
  { id: "M-J2", title: "condition wrapper removed", file: "src/adapters/http.ts", from: "const shouldContinue = await awaitUnlessCancelled(() => retryConfig.condition!(response, retryAttempt));", to: "const shouldContinue = await retryConfig.condition!(response, retryAttempt); // MUTATION M-J2", expectedFailed: ["FP-64","FP-66","FP-70"], expectedCollateral: ["assertion:FP-64:expected 'unsettled' to be 'rejected' // Object.is equality","assertion:FP-66:expected '<absent>' to be +0 // Object.is equality","assertion:FP-70:expected 'ECONNRESET' to be 'ABORT_ERR' // Object.is equality","other:failed:[\"FP-64\",\"FP-66\",\"FP-70\"]","passed-summary:d9c9b52a5f5d0516527e0f6c0731d8e528b4fd87a1044afd9e4287f9b3ff8768","signature-drift:FP-64:8a2aa78dad6f898fd3b37bb25b5ae65d542a7cfa737f9768a49a4d6cd4e5010c","signature-drift:FP-66:f6548e00681f747c47cf12511e7f072ee8bb56358f1cac194db794815690b50a","signature-drift:FP-70:1405745f71b412a4bcc7eeeebdc20839ff05c5f84a7bf0ca94dba18f4f413420"] },
  { id: "M-J3", title: "custom-condition ceiling exhaustion wrapper removed", file: "src/adapters/http.ts", from: "          debugLog.maxRetries(config, retryConfig.maxRetries);\n          if (retryConfig.onRetryExhausted) {\n            await awaitUnlessCancelled(() => retryConfig.onRetryExhausted!(response, retryAttempt));\n          }\n          throw response;\n        }\n\n        // Check custom condition first if provided", to: "          debugLog.maxRetries(config, retryConfig.maxRetries);\n          if (retryConfig.onRetryExhausted) {\n            await retryConfig.onRetryExhausted!(response, retryAttempt); // MUTATION M-J3\n          }\n          throw response;\n        }\n\n        // Check custom condition first if provided", expectedFailed: ["FP-80"], expectedCollateral: ["assertion:FP-80:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-80\"]","passed-summary:6bc1f14a859e4b51cb788d6f6838c4819d3f60fcec584b18572f6a20fca0679d","signature-drift:FP-80:7b64d5e975f40cba7a76eece315b663d642acf5c7a04290803c1ece623e85644"] },
  { id: "M-J4", title: "condition-false exhaustion wrapper removed", file: "src/adapters/http.ts", from: "            // Call onRetryExhausted if condition returns false\n            if (retryConfig.onRetryExhausted) {\n              await awaitUnlessCancelled(() => retryConfig.onRetryExhausted!(response, retryAttempt));", to: "            // Call onRetryExhausted if condition returns false\n            if (retryConfig.onRetryExhausted) {\n              await retryConfig.onRetryExhausted!(response, retryAttempt); // MUTATION M-J4", expectedFailed: ["FP-78"], expectedCollateral: ["assertion:FP-78:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-78\"]","passed-summary:cc309bf760115f7c1fe615e43a3e5955ad37e8e9dbac3d2bbed3b4c2d097eccc","signature-drift:FP-78:f6c3290bd91d974942ba696420fb008cbfab08bd9f164d3d627b8c154917b0c1"] },
  { id: "M-J5", title: "standard-policy ceiling exhaustion wrapper removed", file: "src/adapters/http.ts", from: "              debugLog.maxRetries(config, retryConfig.maxRetries);\n              if (retryConfig.onRetryExhausted) {\n                await awaitUnlessCancelled(() => retryConfig.onRetryExhausted!(response, retryAttempt));", to: "              debugLog.maxRetries(config, retryConfig.maxRetries);\n              if (retryConfig.onRetryExhausted) {\n                await retryConfig.onRetryExhausted!(response, retryAttempt); // MUTATION M-J5", expectedFailed: ["FP-82"], expectedCollateral: ["assertion:FP-82:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-82\"]","passed-summary:993876e43717d0c2c5154d3dc1bb2cc9320c63d2df158d24509dc12fb30a0ff3","signature-drift:FP-82:8d4d425a04e4a170b51f6c7aaae1ef73aaa36dd22e2ff97b99a4beeaa752072f"] },
  { id: "M-J6", title: "onRetry wrapper removed", file: "src/adapters/http.ts", from: "const shouldProceed = await awaitUnlessCancelled(() => retryConfig.onRetry!(response, retryAttempt, currentDelay));", to: "const shouldProceed = await retryConfig.onRetry!(response, retryAttempt, currentDelay); // MUTATION M-J6", expectedFailed: ["FP-72"], expectedCollateral: ["assertion:FP-72:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-72\"]","passed-summary:12df344bd6481f346aa0871cacfcf45e34299a9e6073b65c64e2028b2929ec41","signature-drift:FP-72:4738bda16983f7d15d0c9afbd783ce8b9aea80341994ea28ca7cd32e074fa04e"] },
  { id: "M-J7", title: "beforeRetry wrapper removed", file: "src/adapters/http.ts", from: "            await awaitUnlessCancelled(() => hook(config, response, retryAttempt));", to: "            await hook(config, response, retryAttempt); // MUTATION M-J7", expectedFailed: ["FP-74"], expectedCollateral: ["assertion:FP-74:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-74\"]","passed-summary:32cb3ff71ae4b22b8e0c9f5c4599240790d55b1e9ddb76fc2eec357952152f7c","signature-drift:FP-74:948c6f08e243085d9095bafc511878ba977b89efc242eccaf5c001632138b7fc"] },
  { id: "M-J8", title: "delay wrapper removed", file: "src/adapters/http.ts", from: "            await awaitUnlessCancelled(() => new Promise<void>((resolve) => { delayTimer = setTimeout(resolve, currentDelay); }));", to: "            await new Promise<void>((resolve) => { delayTimer = setTimeout(resolve, currentDelay); }); // MUTATION M-J8", expectedFailed: ["FP-76"], expectedCollateral: ["assertion:FP-76:expected 'unsettled' to be 'rejected' // Object.is equality","other:failed:[\"FP-76\"]","other:product-timer:h1:stream:reset-before-headers:probe:none:retry1:delay-abort:30000:live","passed-summary:33b75930e613b07bf2c7d98d5114e66046f9ac68a233a2c9a368f4b9694df83f","signature-drift:FP-76:850f7dcca26de0972a172cecbcb269617e761f36e0a61c5c32d423114f2aa366"] },
  { id: "M-J9", title: "http.ts delay disposal reverted (timer left live on abort)", file: "src/adapters/http.ts", from: "          let delayTimer: ReturnType<typeof setTimeout> | undefined;\n          try {\n            await awaitUnlessCancelled(() => new Promise<void>((resolve) => { delayTimer = setTimeout(resolve, currentDelay); }));\n          } finally {\n            if (delayTimer !== undefined) clearTimeout(delayTimer);\n          }", to: "          await awaitUnlessCancelled(() => new Promise<void>((resolve) => setTimeout(resolve, currentDelay))); // MUTATION M-J9", expectedFailed: ["FP-76"], expectedCollateral: ["assertion:FP-76:expected [ 'live' ] to deeply equal [ 'cleared' ]","other:failed:[\"FP-76\"]","other:product-timer:h1:stream:reset-before-headers:probe:none:retry1:delay-abort:30000:live","passed-summary:33b75930e613b07bf2c7d98d5114e66046f9ac68a233a2c9a368f4b9694df83f","signature-drift:FP-76:91f3d9dfaa09c1ec032c94b1f45d4e11089e6669bfa7041e0aefa1147783c695"] },
  { id: "M-J10", title: "http2.ts delay disposal reverted (timer left live on abort)", file: "src/adapters/http2.ts", from: "  let delayTimer: ReturnType<typeof setTimeout> | undefined;\n  try {\n    await awaitH2Deadline(\n      () => new Promise<void>((resolve) => { delayTimer = setTimeout(resolve, delayMs); }),\n      deadline,\n      config,\n      fetchOptions,\n      stage,\n    );\n  } finally {\n    if (delayTimer !== undefined) clearTimeout(delayTimer);\n  }", to: "  await awaitH2Deadline(\n    () => new Promise<void>(resolve => setTimeout(resolve, delayMs)), // MUTATION M-J10\n    deadline,\n    config,\n    fetchOptions,\n    stage,\n  );", expectedFailed: ["FP-77"], expectedCollateral: ["assertion:FP-77:expected [ 'live' ] to deeply equal [ 'cleared' ]","other:failed:[\"FP-77\"]","other:product-timer:h2:stream:reset-before-headers:probe:none:retry1:delay-abort:30000:live","passed-summary:052c56fef3a801122f7d7846060e597954f3ad5193bb566b323b35ad9c285da0","signature-drift:FP-77:d2b68d18587136b364e007acb7ba7b02350b1ff17b498907b6fdf21af05a574e"] },
];

// ---- exact, recursive envelope validation: exact key sets, typed fields, literal roster and
// partition, exact leg keys, exact per-leg observation key sets and type categories.
const cat = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const sameKeys = (obj, keys) => isObj(obj) && sortedJson(Object.keys(obj)) === sortedJson(keys);
function validateEnvelope(ledger) {
  const p = [];
  if (!isObj(ledger)) return ['envelope: not a plain object'];
  if (!sameKeys(ledger, ENVELOPE_KEYS)) p.push(`envelope: key set ${JSON.stringify(Object.keys(ledger).sort())} !== literal`);
  const need = (cond, msg) => { if (!cond) p.push(`envelope: ${msg}`); };
  need(ledger.schema === 'rezo.r15.parity.ledger/v4', 'schema'); need(ledger.epoch === 'green-v4', 'epoch'); need(ledger.runtime === 'node', 'runtime'); need(ledger.runtimeVersion === PINNED_NODE_VERSION, 'runtimeVersion'); need(ledger.file === CARRIER, 'file');
  need(isStrArray(ledger.passed), 'passed type'); need(isStrArray(ledger.failed), 'failed type');
  need(isStrArray(ledger.expectedPassed) && sortedJson(ledger.expectedPassed) === sortedJson(ROSTER), 'expectedPassed literal');
  need(isStrArray(ledger.registered) && sortedJson(ledger.registered) === sortedJson(ROSTER), 'registered literal');
  need(ledger.legCount === ROSTER.length, 'legCount');
  need(isObj(ledger.registry) && sameKeys(ledger.registry, ['controls', 'targets']) && isStrArray(ledger.registry.targets) && isStrArray(ledger.registry.controls) && sortedJson(ledger.registry.targets) === sortedJson(TARGETS) && sortedJson(ledger.registry.controls) === sortedJson(CONTROLS), 'registry literal partition');
  need(isStrArray(ledger.fixtureErrors) && ledger.fixtureErrors.length === 0, 'fixtureErrors empty'); need(isStrArray(ledger.setupErrors) && ledger.setupErrors.length === 0, 'setupErrors empty'); need(isStrArray(ledger.teardownErrors) && ledger.teardownErrors.length === 0, 'teardownErrors empty');
  need(Array.isArray(ledger.listeners) && ledger.listeners.length === 0, 'listeners empty'); need(isStrArray(ledger.oracleMismatches), 'oracleMismatches type');
  need(isObj(ledger.processFaults) && sameKeys(ledger.processFaults, ['uncaught', 'unhandled']) && ledger.processFaults.uncaught === 0 && ledger.processFaults.unhandled === 0, 'processFaults zero');
  need(isObj(ledger.parity) && sameKeys(ledger.parity, PARITY_KEYS) && isStrArray(ledger.parity.fields) && isObj(ledger.parity.protocolSplit) && isObj(ledger.parity.runtimeSplit) && Array.isArray(ledger.parity.tableProblems) && ledger.parity.tableProblems.length === 0, 'parity');
  need(isObj(ledger.cleanup) && sameKeys(ledger.cleanup, ['endState', 'forced']) && sameKeys(ledger.cleanup.endState, CLEANUP_END_STATE_KEYS) && CLEANUP_END_STATE_KEYS.every((k) => ledger.cleanup.endState[k] === 0) && sameKeys(ledger.cleanup.forced, CLEANUP_FORCED_KEYS) && CLEANUP_FORCED_KEYS.every((k) => Number.isInteger(ledger.cleanup.forced[k]) && ledger.cleanup.forced[k] >= 0), 'cleanup');
  need(isObj(ledger.clientPools) && sameKeys(ledger.clientPools, CLIENT_POOL_KEYS) && isObj(ledger.clientPools.endState), 'clientPools');
  if (isObj(ledger.legs)) {
    need(sortedJson(Object.keys(ledger.legs)) === sortedJson(LEG_KEYS), 'legs: exact literal leg keys');
    for (const [key, leg] of Object.entries(ledger.legs)) {
      if (!isObj(leg)) { p.push(`leg ${key}: not an object`); continue; }
      if (!sameKeys(leg, OBSERVATION_KEYS)) p.push(`leg ${key}: observation key set differs`);
      for (const [field, allowed] of Object.entries(OBSERVATION_TYPES)) if (field in leg && !allowed.includes(cat(leg[field]))) p.push(`leg ${key}: ${field} type ${cat(leg[field])} not in ${JSON.stringify(allowed)}`);
      if (leg.runtime !== 'node') p.push(`leg ${key}: runtime`);
      if (!TERMINALS.includes(leg.terminal)) p.push(`leg ${key}: terminal ${String(leg.terminal)}`);
    }
  } else p.push('envelope: legs not an object');
  return p;
}
// Collateral is normalised to a literal that keeps its identifying payload.
function normaliseCollateral(entry, legs) {
  let m;
  if ((m = /^signature-drift:(FP-[0-9C]+):([\s\S]*)$/.exec(entry))) return `signature-drift:${m[1]}:${sha256Text(m[2])}`;
  if ((m = /^late-wire:([^:]+(?::[^:]+)*?):(\d+\/\d+!==\d+\/\d+)$/.exec(entry))) { const label = m[1]; const key = Object.keys(legs).find((k) => k.endsWith(`:${label}`)); return `late-wire:${key ? key.split(':')[0] : 'UNKNOWN-ROW'}:${label}:${m[2]}`; }
  if (/^passed:\[/.test(entry)) return `passed-summary:${sha256Text(entry)}`;
  if ((m = /^(FP-[0-9C]+):([\s\S]*)$/.exec(entry))) return `assertion:${m[1]}:${m[2]}`;
  return `other:${entry}`;
}

// ---- restoration: only after a mutation; guaranteed on every exit path including signals.
let mutatedFile = null; let finalized = false;
const restoreAll = () => { const out = {}; for (const [file, copy] of Object.entries(PRISTINE)) { copyFileSync(copy, file); out[file] = sha256(file); } return out; };
const onSignal = (signal) => { if (finalized) return; const restored = mutatedFile ? restoreAll() : null; console.error(`driver interrupted by ${signal}; restored: ${JSON.stringify(restored)}`); process.exit(130); };
process.on('SIGINT', () => onSignal('SIGINT')); process.on('SIGTERM', () => onSignal('SIGTERM'));

const runnerSummaryOf = (text) => (text.match(/Tests\s+\d+ failed \| \d+ passed \(\d+\)|Tests\s+\d+ passed \(\d+\)/) || [null])[0];
const results = []; const runInvalidities = [];
try {
  for (const leg of LEGS) {
    const invalid = [];
    const source = readFileSync(PRISTINE[leg.file], 'utf8');
    const count = source.split(leg.from).length - 1;
    if (count !== 1) invalid.push(`anchor occurrences ${count} (expected 1)`);
    const record = { id: leg.id, title: leg.title, file: leg.file, mutation: { from: leg.from, to: leg.to }, expectedFailed: leg.expectedFailed, expectedCollateral: leg.expectedCollateral, opening: opening[leg.file] };
    if (MODE === 'dry-run' || count !== 1) { record.invalidities = invalid; record.valid = invalid.length === 0; results.push(record); console.log(JSON.stringify({ id: leg.id, mode: MODE, valid: record.valid, invalidities: invalid })); if (!record.valid) runInvalidities.push(`${leg.id}: ${invalid.join('; ')}`); continue; }
    const log = resolve(SCRATCH_REAL, `r15-legs-${leg.id}.log`);
    let mutatedSha = null, restoredSha = null, spawn = null;
    try {
      writeFileSync(leg.file, source.replace(leg.from, leg.to)); mutatedFile = leg.file; mutatedSha = sha256(leg.file);
      spawn = spawnSync(process.execPath, VITEST_ARGS, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: LEG_TIMEOUT_MS });
      writeFileSync(log, `${spawn.stdout ?? ''}\n--- stderr ---\n${spawn.stderr ?? ''}`);
    } finally {
      copyFileSync(PRISTINE[leg.file], leg.file); restoredSha = sha256(leg.file); if (restoredSha === PINNED[leg.file]) mutatedFile = null;
    }
    if (restoredSha !== PINNED[leg.file]) invalid.push(`restore mismatch ${restoredSha}`);
    if (spawn.error) invalid.push(`spawn error ${spawn.error.code ?? spawn.error.message}`);
    if (spawn.signal) invalid.push(`runner killed by ${spawn.signal}`);
    if (spawn.status !== 1) invalid.push(`child exit ${spawn.status} (expected exactly 1)`);
    const text = readFileSync(log, 'utf8');
    const runnerSummary = runnerSummaryOf(text);
    const markerLines = text.split('\n').filter((line) => line.startsWith(MARKER));
    let ledger = null, observedCollateral = null, actualFailed = null;
    if (markerLines.length !== 1) invalid.push(`carrier marker lines ${markerLines.length} (expected exactly 1 full line)`);
    else { try { const parsed = JSON.parse(markerLines[0].slice(MARKER.length)); if (isObj(parsed)) ledger = parsed; else invalid.push(`carrier ledger is ${cat(parsed)}, not an object`); } catch (error) { invalid.push(`carrier ledger unparsable: ${String(error).slice(0, 80)}`); } }
    if (ledger !== null) {
      invalid.push(...validateEnvelope(ledger));
      actualFailed = isStrArray(ledger.failed) ? ledger.failed : [];
      if (sortedJson(actualFailed) !== sortedJson(leg.expectedFailed)) invalid.push(`failed set ${JSON.stringify(actualFailed)} !== expected ${JSON.stringify(leg.expectedFailed)}`);
      const expectedPassed = ROSTER.filter((id) => !leg.expectedFailed.includes(id));
      if (sortedJson(isStrArray(ledger.passed) ? ledger.passed : []) !== sortedJson(expectedPassed)) invalid.push('passed set differs from roster minus expected failed');
      if (isObj(ledger.legs)) for (const [key, leg0] of Object.entries(ledger.legs)) { const row = key.split(':')[0]; if (!leg.expectedFailed.includes(row) && isObj(leg0) && leg0.terminal !== 'fulfilled' && leg0.terminal !== 'rejected') invalid.push(`${row} terminal ${String(leg0.terminal)} outside the expected failed set`); }
      observedCollateral = (isStrArray(ledger.oracleMismatches) ? ledger.oracleMismatches : []).map((entry) => normaliseCollateral(entry, isObj(ledger.legs) ? ledger.legs : {})).sort();
      if (MODE === 'canonical' && JSON.stringify(observedCollateral) !== JSON.stringify([...leg.expectedCollateral].sort())) invalid.push(`collateral differs from the literal expected set (${observedCollateral.length} vs ${leg.expectedCollateral.length})`);
      const expectedSummary = `Tests  ${leg.expectedFailed.length} failed | ${RUNNER_TESTS - leg.expectedFailed.length} passed (${RUNNER_TESTS})`;
      if (runnerSummary === null || runnerSummary.replace(/\s+/g, ' ') !== expectedSummary.replace(/\s+/g, ' ')) invalid.push(`runner summary ${JSON.stringify(runnerSummary)} !== ${JSON.stringify(expectedSummary)}`);
    }
    if (MODE === 'calibration') invalid.push('calibration run: never valid');
    Object.assign(record, { command: [process.execPath, ...VITEST_ARGS], exitCode: spawn.status, signal: spawn.signal, timedOut: spawn.error?.code === 'ETIMEDOUT', runnerSummary, actualFailed, observedCollateral, mutatedSha, restoredSha, log: { path: log, sha256: sha256(log) }, invalidities: invalid, valid: invalid.length === 0 });
    results.push(record); if (!record.valid) runInvalidities.push(`${leg.id}: ${invalid.join('; ')}`);
    console.log(JSON.stringify({ id: leg.id, mode: MODE, valid: record.valid, failed: actualFailed, collateral: observedCollateral, invalidities: MODE === 'calibration' ? invalid.filter((x) => !x.startsWith('calibration')) : invalid }));
  }
} finally {
  const restored = MODE === 'dry-run' ? null : restoreAll(); finalized = true;
  if (restored) for (const [file, actual] of Object.entries(restored)) if (actual !== PINNED[file]) runInvalidities.push(`final restore mismatch ${file} ${actual}`);
  const closing = Object.fromEntries(Object.keys(PINNED).map((file) => [file, sha256(file)]));
  for (const [file, actual] of Object.entries(closing)) if (actual !== PINNED[file]) runInvalidities.push(`closing identity ${file} ${actual}`);
  const closingAggregate = aggregate(); if (closingAggregate !== PINNED_AGGREGATE) runInvalidities.push(`closing aggregate ${closingAggregate}`);
  const valid = MODE === 'canonical' && runInvalidities.length === 0 && results.length === LEGS.length && results.every((r) => r.valid);
  const ledgerOut = { schema: 'rezo.r15.legs.ledger/v4h', mode: MODE, driver: { path: relative(ROOT, DRIVER_PATH), sha256: driverSha, expectedSha256: expectedDriverSha }, node: { execPath: process.execPath, realpath: nodeRealpath, sha256: nodeSha, version: process.version }, vitest: { version: vitestVersion, runnerSha256: vitestRunnerSha }, pinned: PINNED, pinnedAggregate: PINNED_AGGREGATE, opening, openingAggregate, closing, closingAggregate, roster: ROSTER, runnerTests: RUNNER_TESTS, legTimeoutMs: LEG_TIMEOUT_MS, contract: { envelopeKeys: ENVELOPE_KEYS, legKeys: LEG_KEYS.length, observationKeys: OBSERVATION_KEYS.length }, results, invalidities: runInvalidities, valid };
  mkdirSync(dirname(ledgerAbs), { recursive: true });
  writeFileSync(ledgerAbs, JSON.stringify(ledgerOut, null, 2) + '\n');
  console.log(`ledger ${ledgerAbs} mode=${MODE} valid=${valid}${runInvalidities.length ? ' invalidities=' + JSON.stringify(runInvalidities).slice(0, 400) : ''}`);
  if (!valid) process.exitCode = 1;
}
