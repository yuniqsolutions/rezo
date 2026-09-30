// Trusted-parent bootstrap for the mutation-legs drivers — v3.1 (tayo #rezo 67076/67128).
//
// This file is NEVER executed from disk. Its bytes are the reviewer-supplied inline first JavaScript:
//
//   /usr/bin/env -i PATH=… HOME=<fresh empty dir> TMPDIR=<fresh dir> CURL_HOME=$HOME XDG_CONFIG_HOME=$HOME \
//     TZ=UTC LANG=C LC_ALL=C NO_COLOR=1 REZO_LEGS_…=… \
//     /opt/homebrew/Cellar/node/25.9.0_2/bin/node --input-type=module --eval "$(cat test/legs-bootstrap.mjs)"
//
// The outer `env -i` boundary means no preload-affecting environment (NODE_OPTIONS, NODE_PATH, …) can reach
// Node's startup; the executed bootstrap bytes are hashed from `process.execArgv` and must equal the
// independently announced REZO_LEGS_BOOTSTRAP_SHA256. Before anything is imported or spawned, the bootstrap
// authenticates the Node binary, `/usr/bin/env`, the launcher, driver, admission helper, self-test and the
// closure table (every listed file, tool, dylib, package aggregate, config and child-process site). It then
// runs the launcher as a SNAPSHOT of the verified bytes in a clean-env child, waits, rehashes everything,
// authenticates the ledger the child wrote, writes a receipt, and only then exits. `--launcher-controls`
// mode proves the boundary executably: launcher swap, bootstrap swap, a poisoned outer NODE_OPTIONS
// through the boundary (marker must stay absent), the same poison without the boundary (marker present),
// and a positive dry-run pass-through.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuse = (message) => { console.error(`bootstrap refused: ${message}`); process.exit(3); };
const env = process.env;

// 0. Own executed bytes.
const evalIndex = process.execArgv.indexOf('--eval');
if (evalIndex === -1 || typeof process.execArgv[evalIndex + 1] !== 'string') refuse('bootstrap must run as inline --eval source');
const BOOTSTRAP_SOURCE = process.execArgv[evalIndex + 1];
const BOOTSTRAP_SHA = sha256(BOOTSTRAP_SOURCE);
if (!env.REZO_LEGS_BOOTSTRAP_SHA256) refuse('REZO_LEGS_BOOTSTRAP_SHA256 (announced bootstrap identity) is required');
if (BOOTSTRAP_SHA !== env.REZO_LEGS_BOOTSTRAP_SHA256) refuse(`executed bootstrap ${BOOTSTRAP_SHA} differs from the announced ${env.REZO_LEGS_BOOTSTRAP_SHA256}`);

// 1. Environment exactness: the allowlist, the expectations, nothing else (macOS injects one CF key).
const FIXED_ENV = { TZ: 'UTC', LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' };
const REQUIRED_KEYS = ['PATH', 'HOME', 'TMPDIR', 'CURL_HOME', 'XDG_CONFIG_HOME', ...Object.keys(FIXED_ENV),
  'REZO_LEGS_ROOT', 'REZO_LEGS_MODE', 'REZO_LEGS_DRIVER', 'REZO_LEGS_LAUNCHER', 'REZO_LEGS_BOOTSTRAP_SHA256', 'REZO_LEGS_LAUNCHER_SHA256',
  'REZO_LEGS_DRIVER_SHA256', 'REZO_LEGS_ADMISSION_SHA256', 'REZO_LEGS_SELFTEST_SHA256', 'REZO_LEGS_CLOSURES_SHA256', 'REZO_LEGS_NODE',
  'REZO_LEGS_NODE_SHA256', 'REZO_LEGS_ENV_SHA256', 'REZO_LEGS_SCRATCH', 'REZO_LEGS_LEDGER', 'REZO_LEGS_RECEIPT'];
const OPTIONAL_KEYS = ['REZO_LEGS_MARKER', 'REZO_LEGS_CONTROL_LABEL'];
const TOLERATED_KEYS = ['__CF_USER_TEXT_ENCODING'];
const MODES = ['canonical', 'dry-run', 'calibration', 'signal-control', 'launcher-controls'];
{
  const keys = Object.keys(env).sort();
  const foreign = keys.filter((key) => !REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key) && !TOLERATED_KEYS.includes(key));
  if (foreign.length) refuse(`environment carries keys outside the allowlist: ${JSON.stringify(foreign)}`);
  const missing = REQUIRED_KEYS.filter((key) => !(key in env));
  if (missing.length) refuse(`environment lacks required keys: ${JSON.stringify(missing)}`);
  for (const [key, value] of Object.entries(FIXED_ENV)) if (env[key] !== value) refuse(`${key}=${JSON.stringify(env[key])} !== fixed ${JSON.stringify(value)}`);
  if (env.CURL_HOME !== env.HOME || env.XDG_CONFIG_HOME !== env.HOME) refuse('CURL_HOME and XDG_CONFIG_HOME must equal the fresh HOME');
  if (!MODES.includes(env.REZO_LEGS_MODE)) refuse(`unknown mode ${JSON.stringify(env.REZO_LEGS_MODE)}`);
}
const MODE = env.REZO_LEGS_MODE;
const ROOT = env.REZO_LEGS_ROOT;
if (!isAbsolute(ROOT) || !existsSync(ROOT)) refuse(`REZO_LEGS_ROOT ${ROOT} is not an existing absolute path`);
const ROOT_REAL = realpathSync(ROOT);
const inside = (p, dir) => { const r = relative(dir, resolve(p)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const freshEmptyDir = (label, path) => {
  if (!isAbsolute(path)) refuse(`${label} must be absolute`);
  if (!existsSync(path) || !statSync(path).isDirectory()) refuse(`${label} ${path} must be an existing directory`);
  if (inside(realpathSync(path), ROOT_REAL)) refuse(`${label} ${path} resolves inside the repository`);
  if (readdirSync(path).length !== 0) refuse(`${label} ${path} must be empty at start`);
};
freshEmptyDir('HOME', env.HOME); freshEmptyDir('TMPDIR', env.TMPDIR);

// 2. Tool identities: the Node binary that is running, and the env binary that built the boundary.
const NODE_REAL = realpathSync(process.execPath);
if (NODE_REAL !== env.REZO_LEGS_NODE) refuse(`node realpath ${NODE_REAL} !== pinned ${env.REZO_LEGS_NODE}`);
const NODE_SHA = sha256(readFileSync(NODE_REAL));
if (NODE_SHA !== env.REZO_LEGS_NODE_SHA256) refuse(`node binary ${NODE_SHA} !== pinned ${env.REZO_LEGS_NODE_SHA256}`);
const ENV_SHA = sha256(readFileSync('/usr/bin/env'));
if (ENV_SHA !== env.REZO_LEGS_ENV_SHA256) refuse(`/usr/bin/env ${ENV_SHA} !== pinned ${env.REZO_LEGS_ENV_SHA256}`);

// 3. Stage files: read + hash BEFORE anything is imported or spawned.
const FILES = {
  launcher: { path: isAbsolute(env.REZO_LEGS_LAUNCHER) ? env.REZO_LEGS_LAUNCHER : resolve(ROOT, env.REZO_LEGS_LAUNCHER), expected: env.REZO_LEGS_LAUNCHER_SHA256 },
  driver: { path: resolve(ROOT, env.REZO_LEGS_DRIVER), expected: env.REZO_LEGS_DRIVER_SHA256 },
  admission: { path: resolve(ROOT, 'test/legs-admission.mjs'), expected: env.REZO_LEGS_ADMISSION_SHA256 },
  selfTest: { path: resolve(ROOT, 'test/legs-admission.test.mjs'), expected: env.REZO_LEGS_SELFTEST_SHA256 },
  closures: { path: resolve(ROOT, 'test/legs-carrier-closures.json'), expected: env.REZO_LEGS_CLOSURES_SHA256 },
};
if (['canonical', 'signal-control'].includes(MODE) && relative(ROOT, FILES.launcher.path) !== 'test/legs-launcher.mjs') refuse(`launcher must be test/legs-launcher.mjs in ${MODE} mode (got ${FILES.launcher.path})`);
const readStage = (name) => {
  const stage = FILES[name];
  if (!existsSync(stage.path)) refuse(`${name} ${stage.path} does not exist`);
  const bytes = readFileSync(stage.path); const actual = sha256(bytes);
  if (!stage.expected) refuse(`expected hash for ${name} is required`);
  if (actual !== stage.expected) refuse(`${name} ${actual} !== announced ${stage.expected}`);
  return { ...stage, bytes, sha256: actual };
};
const stages = Object.fromEntries(Object.keys(FILES).map((name) => [name, readStage(name)]));
const rehashStages = (label) => Object.entries(stages).flatMap(([name, stage]) => { const now = sha256(readFileSync(stage.path)); return now === stage.sha256 ? [] : [`${label}: ${name} ${now} !== ${stage.sha256}`]; });

// 4. Closure pre-authentication through the verified admission helper (imported from its exact bytes).
const admission = await import(`data:text/javascript;base64,${stages.admission.bytes.toString('base64')}`);
const closures = JSON.parse(stages.closures.bytes.toString('utf8'));
const closureVerdict = admission.verifyClosureTable(ROOT, closures);
if (closureVerdict.problems.length) refuse(`closure surface not authenticated: ${JSON.stringify(closureVerdict.problems.slice(0, 8))}${closureVerdict.problems.length > 8 ? ` …(+${closureVerdict.problems.length - 8})` : ''}`);
if (env.PATH !== closures.env.PATH) refuse(`PATH ${JSON.stringify(env.PATH)} !== frozen ${JSON.stringify(closures.env.PATH)}`);

// 5. Paths for this run.
const SCRATCH = resolve(env.REZO_LEGS_SCRATCH); const LEDGER = resolve(env.REZO_LEGS_LEDGER); const RECEIPT = resolve(env.REZO_LEGS_RECEIPT);
if (existsSync(RECEIPT)) refuse(`receipt already exists: ${RECEIPT}`);
if (existsSync(LEDGER)) refuse(`ledger already exists: ${LEDGER}`);
if (existsSync(SCRATCH)) refuse(`scratch already exists: ${SCRATCH}`);
if (inside(SCRATCH, ROOT_REAL)) refuse(`scratch ${SCRATCH} resolves inside the repository`);
const evidence = { schema: 'rezo.legs.bootstrap-receipt/v3.1', mode: MODE, bootstrap: { sha256: BOOTSTRAP_SHA, sourceBytes: Buffer.byteLength(BOOTSTRAP_SOURCE) },
  env: { keys: Object.keys(env).sort(), fixed: FIXED_ENV, PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, toleratedInjected: TOLERATED_KEYS.filter((k) => k in env) },
  node: { execPath: process.execPath, realpath: NODE_REAL, version: process.version, sha256: NODE_SHA }, envBinary: { path: '/usr/bin/env', sha256: ENV_SHA },
  stages: Object.fromEntries(Object.entries(stages).map(([name, s]) => [name, { path: relative(ROOT, s.path) || s.path, sha256: s.sha256 }])),
  closure: closureVerdict.summary, child: null, ledger: null, rehash: null, invalidities: [], valid: false };
const finish = (invalidities) => {
  evidence.invalidities = invalidities; evidence.valid = invalidities.length === 0;
  mkdirSync(dirname(RECEIPT), { recursive: true });
  writeFileSync(RECEIPT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`bootstrap receipt ${RECEIPT} mode=${MODE} valid=${evidence.valid}${invalidities.length ? ' ' + JSON.stringify(invalidities).slice(0, 800) : ''}`);
  process.exit(evidence.valid ? 0 : 1);
};

/** Runs one child to completion with piped stdio, teeing to our own stdio; returns exit, signal and tails. */
const runChild = (command, args, childEnv, label) => new Promise((done) => {
  const child = spawn(command, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (chunk) => { const text = chunk.toString(); out += text; process.stdout.write(text); });
  child.stderr.on('data', (chunk) => { const text = chunk.toString(); err += text; process.stderr.write(text); });
  child.on('error', (error) => done({ label, pid: child.pid ?? null, exitCode: null, signal: null, error: String(error), stdoutTail: out.slice(-4000), stderrTail: err.slice(-4000) }));
  child.on('exit', (code, signal) => done({ label, pid: child.pid ?? null, exitCode: code, signal, error: null, stdoutTail: out.slice(-4000), stderrTail: err.slice(-4000) }));
});
const launcherArgs = () => ['--input-type=module', '--eval', stages.launcher.bytes.toString('utf8')];

if (MODE === 'launcher-controls') {
  // Nested controls: each spawns a NEW bootstrap (this exact source) under its own fresh paths.
  if (relative(ROOT, LEDGER) !== 'plans/legs-launcher-controls.json') refuse('launcher-controls ledger must be exactly plans/legs-launcher-controls.json');
  mkdirSync(SCRATCH, { recursive: true });
  const nested = (label, overrides, viaPoisonedOuter = false, boundary = true) => {
    const dir = resolve(SCRATCH, label); mkdirSync(resolve(dir, 'home'), { recursive: true }); mkdirSync(resolve(dir, 'tmp'), { recursive: true });
    const childEnv = { ...Object.fromEntries(REQUIRED_KEYS.map((key) => [key, env[key]])), HOME: resolve(dir, 'home'), CURL_HOME: resolve(dir, 'home'), XDG_CONFIG_HOME: resolve(dir, 'home'), TMPDIR: resolve(dir, 'tmp'),
      REZO_LEGS_MODE: 'dry-run', REZO_LEGS_SCRATCH: resolve(dir, 'scratch'), REZO_LEGS_LEDGER: resolve(dir, 'scratch', 'ledger.json'), REZO_LEGS_RECEIPT: resolve(dir, 'receipt.json'), REZO_LEGS_CONTROL_LABEL: label, ...overrides };
    const marker = resolve(dir, 'marker'); childEnv.REZO_LEGS_MARKER = marker;
    const preload = `import{writeFileSync}from"node:fs";writeFileSync(${JSON.stringify(marker)},"preload executed");`;
    const poisoned = `NODE_OPTIONS=--import=data:text/javascript,${encodeURIComponent(preload)}`;
    const nodeArgs = ['--input-type=module', '--eval', BOOTSTRAP_SOURCE];
    const boundaryArgs = ['-i', ...Object.entries(childEnv).map(([key, value]) => `${key}=${value}`), NODE_REAL, ...nodeArgs];
    const run = viaPoisonedOuter
      ? (boundary ? runChild('/usr/bin/env', [poisoned, '/usr/bin/env', ...boundaryArgs], {}, label) : runChild('/usr/bin/env', [poisoned, NODE_REAL, '--input-type=module', '--eval', 'console.log("ENTRY")'], {}, label))
      : runChild('/usr/bin/env', boundaryArgs, {}, label);
    return run.then((result) => ({ ...result, marker, markerPresent: existsSync(marker), receiptPresent: existsSync(childEnv.REZO_LEGS_RECEIPT), ledgerPresent: existsSync(childEnv.REZO_LEGS_LEDGER) }));
  };
  const swappedLauncher = resolve(SCRATCH, 'swapped-launcher.mjs');
  writeFileSync(swappedLauncher, `${stages.launcher.bytes.toString('utf8')}\nimport { writeFileSync as __w } from 'node:fs'; __w(process.env.REZO_LEGS_MARKER, 'swapped launcher executed');\n`);
  const controls = [];
  const expect = (result, expected) => { const ok = Object.entries(expected).every(([key, value]) => JSON.stringify(result[key]) === JSON.stringify(value)); controls.push({ ...result, expected, ok }); return ok; };
  expect(await nested('launcher-swap', { REZO_LEGS_LAUNCHER: swappedLauncher }), { exitCode: 3, markerPresent: false, receiptPresent: false, ledgerPresent: false });
  expect(await nested('bootstrap-swap', { REZO_LEGS_BOOTSTRAP_SHA256: '0'.repeat(64) }), { exitCode: 3, markerPresent: false, receiptPresent: false });
  expect(await nested('driver-swap', { REZO_LEGS_DRIVER_SHA256: '1'.repeat(64) }), { exitCode: 3, markerPresent: false, receiptPresent: false });
  expect(await nested('helper-swap', { REZO_LEGS_ADMISSION_SHA256: '2'.repeat(64) }), { exitCode: 3, markerPresent: false, receiptPresent: false });
  expect(await nested('poisoned-without-boundary', {}, true, false), { exitCode: 0, markerPresent: true });
  expect(await nested('poisoned-through-boundary', {}, true, true), { exitCode: 0, markerPresent: false, receiptPresent: true });
  expect(await nested('positive-dry-run', {}), { exitCode: 0, markerPresent: false, receiptPresent: true });
  const rehash = rehashStages('after controls');
  const valid = controls.every((c) => c.ok) && rehash.length === 0;
  const ledger = { schema: 'rezo.legs.launcher-controls/v3.1', bootstrap: evidence.bootstrap, node: evidence.node, envBinary: evidence.envBinary, stages: evidence.stages, env: evidence.env, controls: controls.map((c) => ({ ...c, stdoutTail: c.stdoutTail.slice(-1500), stderrTail: c.stderrTail.slice(-1500) })), rehashAfter: rehash, valid };
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  evidence.ledger = { path: relative(ROOT, LEDGER), sha256: sha256(readFileSync(LEDGER)), valid };
  finish(valid ? [] : [`controls failed: ${JSON.stringify(controls.filter((c) => !c.ok).map((c) => c.label))}`, ...rehash]);
}

// 6. Normal modes: the launcher runs as a snapshot of its verified bytes in a clean-env child.
if ('REZO_LEGS_LAUNCH_PARENT' in env) refuse('the bootstrap must be the root process');
const childEnv = { ...Object.fromEntries([...REQUIRED_KEYS, ...OPTIONAL_KEYS].filter((key) => key in env).map((key) => [key, env[key]])), REZO_LEGS_LAUNCH_PARENT: BOOTSTRAP_SHA };
const child = await runChild(NODE_REAL, launcherArgs(), childEnv, 'launcher');
evidence.child = { argv: [NODE_REAL, '--input-type=module', '--eval', `<launcher snapshot ${stages.launcher.sha256}>`], envKeys: Object.keys(childEnv).sort(), pid: child.pid, exitCode: child.exitCode, signal: child.signal, error: child.error, stdoutTail: child.stdoutTail, stderrTail: child.stderrTail };

// 7. Close: rehash every stage and the closure surface, authenticate the ledger, bind digests.
const invalid = [...rehashStages('closing')];
const closingClosure = admission.verifyClosureTable(ROOT, closures);
if (closingClosure.problems.length) invalid.push(`closing closure: ${JSON.stringify(closingClosure.problems.slice(0, 8))}`);
evidence.rehash = { stages: 'ok', closureProblems: closingClosure.problems.length };
if (MODE === 'dry-run') {
  if (child.exitCode !== 0) invalid.push(`dry-run child exit ${child.exitCode} signal ${child.signal}`);
  if (existsSync(LEDGER)) invalid.push('dry-run wrote a ledger');
} else {
  if (!existsSync(LEDGER)) invalid.push(`ledger ${LEDGER} was not written`);
  else {
    const ledgerBytes = readFileSync(LEDGER);
    let ledger = null; try { ledger = JSON.parse(ledgerBytes.toString('utf8')); } catch (error) { invalid.push(`ledger unparsable: ${error.message}`); }
    if (ledger) {
      const bind = (label, actual, expected) => { if (actual !== expected) invalid.push(`ledger binding ${label} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); };
      bind('bootstrap', ledger.bootstrap?.sha256, BOOTSTRAP_SHA);
      bind('launcher', ledger.launcher?.executedBytesSha256, stages.launcher.sha256);
      bind('driver', ledger.driver?.executedBytesSha256, stages.driver.sha256);
      bind('admission', ledger.admission?.executedBytesSha256, stages.admission.sha256);
      bind('selfTest', ledger.selfTest?.expectedSha256 ?? ledger.selfTest?.sha256, stages.selfTest.sha256);
      bind('closures', ledger.closures?.sha256, stages.closures.sha256);
      bind('mode', ledger.mode, MODE);
      const expectValid = MODE !== 'calibration';
      if (ledger.valid !== expectValid) invalid.push(`ledger valid=${ledger.valid} (expected ${expectValid} in ${MODE})`);
      if ((child.exitCode === 0) !== ledger.valid) invalid.push(`child exit ${child.exitCode} disagrees with ledger valid=${ledger.valid}`);
      evidence.ledger = { path: relative(ROOT, LEDGER) || LEDGER, sha256: sha256(ledgerBytes), valid: ledger.valid, schema: ledger.schema };
    }
  }
}
finish(invalid);
