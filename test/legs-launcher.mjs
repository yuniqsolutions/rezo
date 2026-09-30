// Clean-env launcher for the mutation-legs drivers — v3.1. Executed ONLY as a snapshot of its verified bytes by
// the trusted-parent bootstrap (`node --input-type=module --eval "<these bytes>"` inside the `env -i` boundary).
// It re-authenticates its own executed bytes and every stage file against the announced expectations, then
// executes the driver from a data: URL of the exact bytes it just hashed; the driver does the same for the
// admission helper. Nothing here is a trust root: the bootstrap already authenticated everything before this
// process existed, and rehashes everything after it exits.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuse = (message) => { console.error(`launcher refused: ${message}`); process.exit(3); };
const env = process.env;

const evalIndex = process.execArgv.indexOf('--eval');
if (evalIndex === -1 || typeof process.execArgv[evalIndex + 1] !== 'string') refuse('launcher must run as an inline --eval snapshot');
const LAUNCHER_SOURCE = process.execArgv[evalIndex + 1];
const LAUNCHER_SHA = sha256(LAUNCHER_SOURCE);
if (LAUNCHER_SHA !== env.REZO_LEGS_LAUNCHER_SHA256) refuse(`executed launcher ${LAUNCHER_SHA} !== announced ${env.REZO_LEGS_LAUNCHER_SHA256}`);
if (!env.REZO_LEGS_LAUNCH_PARENT) refuse('launcher must be started by the trusted bootstrap');
if (env.REZO_LEGS_LAUNCH_PARENT !== env.REZO_LEGS_BOOTSTRAP_SHA256) refuse('launch parent identity does not match the announced bootstrap');
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE']) if (key in env) refuse(`preload-affecting ${key} present`);

const ROOT = env.REZO_LEGS_ROOT;
if (!ROOT || !isAbsolute(ROOT) || !existsSync(ROOT)) refuse('REZO_LEGS_ROOT is required');
const stage = (label, path, expected) => {
  if (!expected) refuse(`expected hash for ${label} is required`);
  if (!existsSync(path)) refuse(`${label} ${path} does not exist`);
  const bytes = readFileSync(path); const actual = sha256(bytes);
  if (actual !== expected) refuse(`${label} ${actual} !== announced ${expected}`);
  return { path, bytes, sha256: actual };
};
const driver = stage('driver', resolve(ROOT, env.REZO_LEGS_DRIVER), env.REZO_LEGS_DRIVER_SHA256);
const admission = stage('admission helper', resolve(ROOT, 'test/legs-admission.mjs'), env.REZO_LEGS_ADMISSION_SHA256);
const selfTest = stage('self-test', resolve(ROOT, 'test/legs-admission.test.mjs'), env.REZO_LEGS_SELFTEST_SHA256);
const closures = stage('closures', resolve(ROOT, 'test/legs-carrier-closures.json'), env.REZO_LEGS_CLOSURES_SHA256);

globalThis.__REZO_LEGS_LAUNCH__ = Object.freeze({
  root: ROOT,
  mode: env.REZO_LEGS_MODE,
  bootstrap: { sha256: env.REZO_LEGS_BOOTSTRAP_SHA256 },
  launcher: { path: resolve(ROOT, 'test/legs-launcher.mjs'), executedBytesSha256: LAUNCHER_SHA, source: LAUNCHER_SOURCE },
  driver: { path: driver.path, executedBytesSha256: driver.sha256 },
  admission: { path: admission.path, sha256: admission.sha256, bytes: admission.bytes },
  selfTest: { path: selfTest.path, sha256: selfTest.sha256 },
  closures: { path: closures.path, sha256: closures.sha256, bytes: closures.bytes },
  node: { execPath: process.execPath, version: process.version },
});

await import(`data:text/javascript;base64,${driver.bytes.toString('base64')}`);
