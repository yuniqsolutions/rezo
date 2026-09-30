#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import typescriptEslintPlugin from '@typescript-eslint/eslint-plugin';
import typescriptEslintParser from '@typescript-eslint/parser';
import typescript from 'typescript';

const EXIT_ACCEPTED = 70;
const EXIT_INFRASTRUCTURE = 72;
const EXIT_RUNNER_OR_LEDGER = 73;
const EXIT_HASH = 74;

const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const RUNNER_WATCHDOG_MILLISECONDS = 120_000;
const TERMINATION_GRACE_MILLISECONDS = 5_000;
const CAPTURE_FLUSH_MILLISECONDS = 5_000;

const REPOSITORY_ROOT = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
);
const TEST_FILE = 'test/a-plus-http-download-target-integrity.test.ts';
const SUPERVISOR_FILE = 'test/r36-download-target-integrity-supervisor.mjs';
const LEDGER_PREFIX = 'REZO_R36_LEDGER_V1:';
const DISCOVERY_PREFIX = 'REZO_R36_DISCOVERY_V1:';
const SUPERVISOR_PREFIX = 'REZO_R36_SUPERVISOR_V1:';

const NODE_EXECUTABLE = '/opt/homebrew/Cellar/node/25.9.0_2/bin/node';
const BUN_EXECUTABLE = '/Users/jmathew/.bun/bin/bun';
const GIT_EXECUTABLE = '/usr/bin/git';

const RUNTIME_SPECS = Object.freeze({
  node: Object.freeze({
    args: Object.freeze([
      './node_modules/.bin/vitest',
      'run',
      '--pool=forks',
      '--isolate',
      '--no-file-parallelism',
      '--maxWorkers=1',
      '--maxConcurrency=1',
      '--testTimeout=20000',
      '--hookTimeout=45000',
      '--teardownTimeout=20000',
      '--bail=0',
      '--retry=0',
      '--reporter=verbose',
      './' + TEST_FILE,
    ]),
    executable: NODE_EXECUTABLE,
    ledgerVersion: 'v25.9.0',
    versionOutput: 'v25.9.0',
  }),
  bun: Object.freeze({
    args: Object.freeze([
      'test',
      '--timeout=20000',
      '--max-concurrency=1',
      '--retry=0',
      './' + TEST_FILE,
    ]),
    executable: BUN_EXECUTABLE,
    ledgerVersion: '1.3.14',
    versionOutput: '1.3.14',
  }),
});

const STATIC_COMMAND_SPECS = Object.freeze({
  'test-typecheck': Object.freeze({
    args: Object.freeze([
      './node_modules/.bin/tsc',
      '--ignoreConfig',
      '--noEmit',
      '--pretty',
      'false',
      '--ignoreDeprecations',
      '6.0',
      '--target',
      'esnext',
      '--module',
      'esnext',
      '--moduleResolution',
      'node',
      '--strict',
      '--esModuleInterop',
      '--allowSyntheticDefaultImports',
      '--forceConsistentCasingInFileNames',
      '--resolveJsonModule',
      '--skipLibCheck',
      '--noFallthroughCasesInSwitch',
      '--types',
      'node,bun,deno',
      './' + TEST_FILE,
    ]),
    executable: NODE_EXECUTABLE,
    identity: 'node',
  }),
  'source-typecheck': Object.freeze({
    args: Object.freeze([
      './node_modules/.bin/tsc',
      '--noEmit',
      '--ignoreDeprecations',
      '6.0',
    ]),
    executable: NODE_EXECUTABLE,
    identity: 'node',
  }),
  'root-lint': Object.freeze({
    args: Object.freeze(['run', 'lint']),
    executable: BUN_EXECUTABLE,
    identity: 'bun',
  }),
  'diff-check': Object.freeze({
    args: Object.freeze(['diff', '--check']),
    executable: GIT_EXECUTABLE,
    identity: 'git',
  }),
});

const STATIC_GATE_ORDER = Object.freeze([
  'test-typecheck',
  'source-typecheck',
  'focused-lint',
  'root-lint',
  'structural-policy',
  'diff-check',
]);

const REGISTERED = Object.freeze([
  'R36-01',
  'R36-02',
  'R36-03',
  'R36-04',
  'R36-05',
  'R36-06',
  'R36-07',
  'R36-08',
  'R36-09',
  'R36-10',
  'R36-11',
]);
const RED = Object.freeze([
  'R36-01',
  'R36-02',
  'R36-03',
  'R36-04',
  'R36-08',
  'R36-10',
  'R36-11',
]);
const PASSED = Object.freeze([
  'R36-05',
  'R36-06',
  'R36-07',
  'R36-09',
]);

function leg(protocol, overrides = {}) {
  return Object.freeze({
    calls: 1,
    complete: 0,
    done: 0,
    errors: 1,
    finish: 0,
    hits: 1,
    invocations: 1,
    protocol,
    ...overrides,
  });
}

const LEG_SIGNATURES = Object.freeze({
  'R36-01-H1-DOWNLOAD': leg('h1'),
  'R36-02-H2-DOWNLOAD': leg('h2'),
  'R36-03-H1-PREMATURE31': leg('h1'),
  'R36-04-H1-GET-FILENAME': leg('h1'),
  'R36-04-H1-GET-SAVETO': leg('h1'),
  'R36-04-H1-REQUEST-FILENAME': leg('h1'),
  'R36-04-H1-REQUEST-SAVETO': leg('h1'),
  'R36-04-H2-GET-FILENAME': leg('h2'),
  'R36-04-H2-GET-SAVETO': leg('h2'),
  'R36-04-H2-REQUEST-FILENAME': leg('h2'),
  'R36-04-H2-REQUEST-SAVETO': leg('h2'),
  'R36-05-H1-FRESH-GZIP': leg('h1'),
  'R36-05-H1-FRESH-PREMATURE31': leg('h1'),
  'R36-05-H2-FRESH-GZIP': leg('h2'),
  'R36-06-H1-SUCCESS': leg('h1', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
  }),
  'R36-06-H2-SUCCESS': leg('h2', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
  }),
  'R36-07-H1-PLAIN500': leg('h1'),
  'R36-07-H2-PLAIN500': leg('h2'),
  'R36-08-H1-RETRY': leg('h1', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
    hits: 2,
  }),
  'R36-08-H2-RETRY': leg('h2', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
    hits: 2,
  }),
  'R36-09-H1-REDIRECT': leg('h1', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
    hits: 2,
  }),
  'R36-09-H2-REDIRECT': leg('h2', {
    complete: 1,
    done: 1,
    errors: 0,
    finish: 1,
    hits: 2,
  }),
  'R36-10-H1-CONCURRENT': leg('h1', {
    calls: 2,
    complete: 2,
    done: 2,
    errors: 0,
    finish: 2,
    hits: 2,
  }),
  'R36-10-H2-CONCURRENT': leg('h2', {
    calls: 2,
    complete: 2,
    done: 2,
    errors: 0,
    finish: 2,
    hits: 2,
  }),
  'R36-11-H1-DIRECTORY': leg('h1'),
  'R36-11-H2-DIRECTORY': leg('h2', { errors: 2 }),
});

const LEDGER_KEYS = Object.freeze([
  'cleanup',
  'cleanupErrors',
  'file',
  'fixtureErrors',
  'lateEvents',
  'legs',
  'oracleMismatches',
  'passed',
  'red',
  'registered',
  'runtime',
  'runtimeVersion',
  'schema',
  'setupErrors',
  'skipped',
  'teardownErrors',
]);

const CLEANUP_KEYS = Object.freeze([
  'children',
  'complete',
  'finalTargets',
  'gates',
  'http2Leases',
  'http2PendingCreations',
  'http2PoolEntries',
  'http2Sessions',
  'http2Streams',
  'ownedStages',
  'processObservers',
  'servers',
  'sockets',
  'temporaryDirectories',
  'temporaryFiles',
  'timers',
]);

const LEG_KEYS = Object.freeze([
  'calls',
  'complete',
  'details',
  'done',
  'errors',
  'finish',
  'hits',
  'invocations',
  'protocol',
]);

// These are the atomic post-decision governance-recut identities. Product
// source remains sealed until author and blocking reviewer independently
// reproduce this exact table and the unchanged RED ledger. This file cannot
// self-pin; its full hash belongs in the external Aroko verdict.
const APPROVED_HASHES = Object.freeze({
  'PLAN/r07-zstd-integrity-README.md': 'c71dc14f9a936c5dfabffcce79f57ae9bfc757f4bae511f26f586adbfbf3cf8a',
  'PLAN/r07-zstd-integrity-implementation-plan.md': '667842c83bda723e08ef4c8fe3aaf5ebf49022bfd165c8edf91847ad5d8a6e7b',
  'PLAN/r36-download-target-integrity-README.md': '73e41380f4c7e51b927a4215d2e5b199c099846de6b8555c1a675db1ba00aab6',
  'PLAN/r36-download-target-integrity-implementation-plan.md': 'f821da1c0db03d487ff1c0badc5d8384b586c4e32b5a484efc4717faf47ca6f0',
  'bun.lock': 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53',
  'eslint.config.js': '07e657bef793c54a808b67bb7c34b19f9bcecdb46d012349465dfb8e4c889075',
  'package.json': '7102307674739b1f58903f7ae2245699e3a7ee7e4d8a144591efac3c0720d37b',
  'plans/etimedout-phase1-red-row-manifest.md': 'b153de9a52e9b3f931ddb86a840837311010450d33a67603edd1df67c573f121',
  'plans/r07-zstd-integrity-red-row-manifest.md': '83c697764dd4b4fdc4daf5e0360e9a5747fa3f59341a4bf6b9f502350b392f02',
  'plans/r36-download-target-integrity-red-row-manifest.md': '2dfcbb7a265b902da8a6ce641cc9057fc6d18fe20358d5ae1b9eb63c1e294807',
  'src/adapters/http.ts': '696fb15221d9f6d567ad163c6ee9be06754af204b5e069083c1b59568468f3a5',
  'src/adapters/http2.ts': 'b4951350fd9da1b50d71851a92861515c92a84821d35e70c893b85076bb64853',
  'src/types/response.ts': '34547395d26c19c28f094f022c79332c546951d67ee07d690cfedd9ad271d059',
  'src/utils/compression.ts': '3ae45087af03a5723ea7396d8cd22be43b043454d2fc4001325d09b180ebc5fa',
  'src/utils/zstd-frame-validator.ts': '6af90ff72f07c9a0e03a69d4a128a4afb13c1224e43d05a4c44bbf5feb0fb46f',
  'test/a-plus-dns-cache-transport.test.ts': 'd717e6d4c6dc88869e914ad351d1b789b0616ad6ce67f0d5ed14b3fc7d5b57a6',
  'test/a-plus-http-compression-integrity.test.ts': '97d40f54d9642a865a9d1dbb6c42286b693617149b87789f26a99fd31d6d2aa3',
  'test/a-plus-http-download-target-integrity.test.ts': 'f7d8c013a948f0940e7f8ff78b97a825aa5d4d26a5d911fa4ef6887c8804f799',
  'test/a-plus-http-preconnected-socket-timeout.test.ts': '653e5d23a79a1c7975de4ead79c2c4e9c6033b00ac58927383b3d98d13dd00fb',
  'test/a-plus-http-timeout-concurrency.test.ts': '1700bde9d5c2cdb1ab9dbb2107d840fdb973d0f0af67d85790f30027cd3d42cf',
  'test/a-plus-zstd-frame-validator.test.ts': 'ada8a25396980d09f931766542f14d544c9b402d668e496ede334f546b0497e4',
  'tsconfig.json': '6fe72dae6b89d68ecd05557a971d72e622c97795f505d7d6bb651ecafef8f20e',
  'website/src/content/docs/core/response-schema.svx': '9032c5df5b9be840a8c0df3faff8a8b7e6ed932529de46589a8438ff0c5ef5d2',
  'website/src/content/docs/features/downloads.svx': '942edc6b8ee6fab92f69354241e094c1741d71955629df87773c2349f744d15a',
});

// Filled from the same sorted `relative-path NUL file-sha LF` algorithm used
// by captureHashes(). It is intentionally independent of Git's tracked set.
const APPROVED_SOURCE_AGGREGATE = '42e681f288bf7a403318e7f6139633e0093c33d0f7dd0269c121764eb4ea41d3';

class SupervisorFailure extends Error {
  constructor(exitCode, reason, options) {
    super(reason, options);
    this.exitCode = exitCode;
    this.reason = reason;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expected].sort());
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string')
    && new Set(value).size === value.length
    && JSON.stringify(value) === JSON.stringify(expected);
}

function exactNonNegativeInteger(value, expected) {
  return Number.isSafeInteger(value) && value >= 0 && value === expected;
}

function repositoryPath(relativePath) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  const escape = relative(REPOSITORY_ROOT, absolutePath);
  if (escape === '..' || escape.startsWith('../') || resolve(absolutePath) !== absolutePath) {
    throw new SupervisorFailure(EXIT_HASH, 'governed-path-escape:' + relativePath);
  }
  return absolutePath;
}

async function hashRegularFile(relativePath) {
  const absolutePath = repositoryPath(relativePath);
  let information;
  let resolvedPath;
  try {
    information = await lstat(absolutePath);
    resolvedPath = await realpath(absolutePath);
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_HASH,
      'governed-file-stat:' + relativePath,
      { cause: error },
    );
  }
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || resolvedPath !== absolutePath
  ) {
    throw new SupervisorFailure(EXIT_HASH, 'governed-file-shape:' + relativePath);
  }
  try {
    return sha256(await readFile(absolutePath));
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_HASH,
      'governed-file-read:' + relativePath,
      { cause: error },
    );
  }
}

async function collectSourceEntries(relativeDirectory = 'src') {
  const absoluteDirectory = repositoryPath(relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_HASH,
      'source-directory-read:' + relativeDirectory,
      { cause: error },
    );
  }
  const collected = [];
  for (const entry of entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ))) {
    const childPath = join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SupervisorFailure(EXIT_HASH, 'source-symlink:' + childPath);
    }
    if (entry.isDirectory()) {
      collected.push(...await collectSourceEntries(childPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new SupervisorFailure(EXIT_HASH, 'source-non-file:' + childPath);
    }
    collected.push([childPath, await hashRegularFile(childPath)]);
  }
  return collected;
}

async function captureHashes() {
  const files = {};
  for (const relativePath of Object.keys(APPROVED_HASHES).sort()) {
    files[relativePath] = await hashRegularFile(relativePath);
  }
  files[SUPERVISOR_FILE] = await hashRegularFile(SUPERVISOR_FILE);
  const sourceEntries = await collectSourceEntries();
  const sourceAggregate = sha256(Buffer.from(
    sourceEntries.map(([path, hash]) => path + '\0' + hash + '\n').join(''),
  ));
  return { files, sourceAggregate };
}

function validateApprovedHashes(capture) {
  for (const [relativePath, expectedHash] of Object.entries(APPROVED_HASHES)) {
    if (capture.files[relativePath] !== expectedHash) {
      throw new SupervisorFailure(
        EXIT_HASH,
        'approved-hash-mismatch:' + relativePath + ':'
          + capture.files[relativePath] + ':expected:' + expectedHash,
      );
    }
  }
  if (capture.sourceAggregate !== APPROVED_SOURCE_AGGREGATE) {
    throw new SupervisorFailure(
      EXIT_HASH,
      'approved-source-aggregate-mismatch:' + capture.sourceAggregate
        + ':expected:' + APPROVED_SOURCE_AGGREGATE,
    );
  }
}

function runtimeIdentity(spec) {
  let information;
  let resolvedExecutable;
  try {
    information = lstatSync(spec.executable);
    resolvedExecutable = realpathSync(spec.executable);
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'runtime-executable-stat:' + spec.executable,
      { cause: error },
    );
  }
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || resolvedExecutable !== spec.executable
  ) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'runtime-executable-identity:' + spec.executable,
    );
  }
  const version = spawnSync(spec.executable, ['--version'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (
    version.error !== undefined
    || version.status !== 0
    || version.signal !== null
    || version.stderr !== ''
    || version.stdout.trim() !== spec.versionOutput
  ) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'runtime-version-identity:' + spec.executable,
      { cause: version.error },
    );
  }
  return {
    executable: resolvedExecutable,
    version: version.stdout.trim(),
  };
}

function staticCommandIdentity(spec) {
  if (spec.identity === 'node' || spec.identity === 'bun') {
    return runtimeIdentity(RUNTIME_SPECS[spec.identity]);
  }
  if (spec.identity !== 'git' || spec.executable !== GIT_EXECUTABLE) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'static-command-identity-kind:' + String(spec.identity),
    );
  }
  let information;
  let resolvedExecutable;
  try {
    information = lstatSync(spec.executable);
    resolvedExecutable = realpathSync(spec.executable);
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'static-command-executable-stat:' + spec.executable,
      { cause: error },
    );
  }
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || resolvedExecutable !== spec.executable
  ) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'static-command-executable-identity:' + spec.executable,
    );
  }
  const version = spawnSync(spec.executable, ['--version'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (
    version.error !== undefined
    || version.status !== 0
    || version.signal !== null
    || version.stderr !== ''
    || !/^git version [^\r\n]+$/u.test(version.stdout.trim())
  ) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'static-command-version-identity:' + spec.executable,
      { cause: version.error },
    );
  }
  return {
    executable: resolvedExecutable,
    version: version.stdout.trim(),
  };
}

function validateLegs(value) {
  const expectedIds = Object.keys(LEG_SIGNATURES).sort();
  if (!exactKeys(value, expectedIds)) return 'ledger-leg-keys';
  for (const id of expectedIds) {
    const actual = value[id];
    const expected = LEG_SIGNATURES[id];
    if (!exactKeys(actual, LEG_KEYS)) return 'ledger-leg-shape:' + id;
    if (
      actual.details === null
      || typeof actual.details !== 'object'
      || Array.isArray(actual.details)
    ) return 'ledger-leg-details:' + id;
    for (const key of [
      'calls',
      'complete',
      'done',
      'errors',
      'finish',
      'hits',
      'invocations',
    ]) {
      if (!exactNonNegativeInteger(actual[key], expected[key])) {
        return 'ledger-leg-counter:' + id + ':' + key;
      }
    }
    if (actual.protocol !== expected.protocol) {
      return 'ledger-leg-protocol:' + id;
    }
    if (id.startsWith('R36-10-')) {
      for (const key of ['callsA', 'callsB', 'hitsA', 'hitsB']) {
        if (!exactNonNegativeInteger(actual.details[key], 1)) {
          return 'ledger-leg-detail-counter:' + id + ':' + key;
        }
      }
    }
  }
  return null;
}

function validateLedger(stdout, stderr, runtime, spec) {
  if (stderr.includes(LEDGER_PREFIX)) return 'ledger-prefix-in-stderr';
  if (stdout.includes(DISCOVERY_PREFIX) || stderr.includes(DISCOVERY_PREFIX)) {
    return 'discovery-output-present';
  }
  if (stdout.split(LEDGER_PREFIX).length !== 2) return 'ledger-prefix-count';
  const ledgerLines = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(LEDGER_PREFIX));
  if (ledgerLines.length !== 1) return 'ledger-line-count';
  let ledger;
  try {
    ledger = JSON.parse(ledgerLines[0].slice(LEDGER_PREFIX.length));
  } catch {
    return 'ledger-json';
  }
  if (!exactKeys(ledger, LEDGER_KEYS)) return 'ledger-keys';
  if (ledger.schema !== 'rezo.r36.download-target-integrity.ledger/v1') {
    return 'ledger-schema';
  }
  if (
    ledger.runtime !== runtime
    || ledger.runtimeVersion !== spec.ledgerVersion
    || ledger.file !== TEST_FILE
  ) return 'ledger-identity';
  if (!exactStringArray(ledger.registered, REGISTERED)) return 'ledger-registered';
  if (!exactStringArray(ledger.red, RED)) return 'ledger-red';
  if (!exactStringArray(ledger.passed, PASSED)) return 'ledger-passed';
  for (const key of [
    'cleanupErrors',
    'fixtureErrors',
    'lateEvents',
    'oracleMismatches',
    'setupErrors',
    'skipped',
    'teardownErrors',
  ]) {
    if (!exactStringArray(ledger[key], [])) return 'ledger-' + key;
  }
  if (!exactKeys(ledger.cleanup, CLEANUP_KEYS)) return 'ledger-cleanup-keys';
  if (ledger.cleanup.complete !== true) return 'ledger-cleanup-complete';
  for (const key of CLEANUP_KEYS.filter((entry) => entry !== 'complete')) {
    if (ledger.cleanup[key] !== 0) return 'ledger-cleanup:' + key;
  }
  return validateLegs(ledger.legs);
}

async function runFocusedLint() {
  const absoluteTestPath = repositoryPath(TEST_FILE);
  const information = await lstat(absoluteTestPath);
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || await realpath(absoluteTestPath) !== absoluteTestPath
  ) {
    throw new SupervisorFailure(
      EXIT_RUNNER_OR_LEDGER,
      'focused-lint-test-identity',
    );
  }
  const eslint = new ESLint({
    allowInlineConfig: false,
    errorOnUnmatchedPattern: true,
    globInputPaths: false,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: {
        parser: typescriptEslintParser,
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
      },
      plugins: { '@typescript-eslint': typescriptEslintPlugin },
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['error', {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        }],
      },
    }],
    warnIgnored: true,
  });
  const results = await eslint.lintFiles([absoluteTestPath]);
  const actualPaths = results.map((result) => resolve(result.filePath));
  if (
    results.length !== 1
    || actualPaths.length !== 1
    || actualPaths[0] !== absoluteTestPath
  ) {
    throw new SupervisorFailure(
      EXIT_RUNNER_OR_LEDGER,
      'focused-lint-result-set',
    );
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  const errorCount = results.reduce(
    (total, result) => total + result.errorCount,
    0,
  );
  const warningCount = results.reduce(
    (total, result) => total + result.warningCount,
    0,
  );
  if (errorCount !== 0 || warningCount !== 0 || output.length !== 0) {
    throw new SupervisorFailure(
      EXIT_RUNNER_OR_LEDGER,
      'focused-lint-findings:' + errorCount + ':' + warningCount + ':'
        + sha256(Buffer.from(output)),
    );
  }
  return {
    errorCount,
    file: TEST_FILE,
    resultCount: results.length,
    warningCount,
  };
}

function propertyAccessParts(expression) {
  const parts = [];
  let current = expression;
  while (typescript.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (typescript.isIdentifier(current)) {
    parts.unshift(current.text);
    return parts;
  }
  return [];
}

function literalText(node) {
  return typescript.isStringLiteral(node)
    || typescript.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function isInlineCallback(node) {
  return typescript.isArrowFunction(node) || typescript.isFunctionExpression(node);
}

function isFalseKeyword(node) {
  return node.kind === typescript.SyntaxKind.FalseKeyword;
}

function validateLiteralOptions(node, findings, location) {
  if (!typescript.isObjectLiteralExpression(node)) {
    findings.push(location + ':registration-options-not-literal');
    return;
  }
  for (const property of node.properties) {
    if (
      !typescript.isPropertyAssignment(property)
      || property.name === undefined
      || property.name === null
      || property.name.getText() === ''
      || property.name.kind === typescript.SyntaxKind.ComputedPropertyName
    ) {
      findings.push(location + ':registration-option-shape');
      continue;
    }
    const name = typescript.isIdentifier(property.name)
      || typescript.isStringLiteral(property.name)
      ? property.name.text
      : property.name.getText();
    if (name === 'concurrent' && !isFalseKeyword(property.initializer)) {
      findings.push(location + ':concurrent-option-not-false');
      continue;
    }
    if (
      !isFalseKeyword(property.initializer)
      && property.initializer.kind !== typescript.SyntaxKind.TrueKeyword
      && !typescript.isNumericLiteral(property.initializer)
      && literalText(property.initializer) === undefined
    ) {
      findings.push(location + ':registration-option-not-literal:' + name);
    }
  }
}

function hasConditionalRegistrationAncestor(call, sourceFile) {
  let current = call.parent;
  while (current !== undefined && current !== sourceFile) {
    if (
      typescript.isIfStatement(current)
      || typescript.isConditionalExpression(current)
      || typescript.isSwitchStatement(current)
      || typescript.isCaseClause(current)
      || typescript.isDefaultClause(current)
      || typescript.isForStatement(current)
      || typescript.isForInStatement(current)
      || typescript.isForOfStatement(current)
      || typescript.isWhileStatement(current)
      || typescript.isDoStatement(current)
      || typescript.isTryStatement(current)
      || typescript.isCatchClause(current)
      || typescript.isFunctionLike(current)
      || (
        typescript.isBinaryExpression(current)
        && [
          typescript.SyntaxKind.AmpersandAmpersandToken,
          typescript.SyntaxKind.BarBarToken,
          typescript.SyntaxKind.QuestionQuestionToken,
        ].includes(current.operatorToken.kind)
      )
    ) return true;
    current = current.parent;
  }
  return false;
}

function accessRootIdentifier(expression) {
  if (expression === undefined) return undefined;
  let current = expression;
  while (
    typescript.isPropertyAccessExpression(current)
    || typescript.isElementAccessExpression(current)
  ) current = current.expression;
  return typescript.isIdentifier(current) ? current.text : undefined;
}

function accessContainsProperty(expression, name) {
  if (expression === undefined) return false;
  let current = expression;
  while (
    typescript.isPropertyAccessExpression(current)
    || typescript.isElementAccessExpression(current)
  ) {
    if (
      typescript.isPropertyAccessExpression(current)
      && current.name.text === name
    ) return true;
    if (
      typescript.isElementAccessExpression(current)
      && current.argumentExpression !== undefined
      && literalText(current.argumentExpression) === name
    ) return true;
    current = current.expression;
  }
  return false;
}

function isAssignmentToken(kind) {
  return kind >= typescript.SyntaxKind.FirstAssignment
    && kind <= typescript.SyntaxKind.LastAssignment;
}

function nodeLocation(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return String(position.line + 1) + ':' + String(position.character + 1);
}

async function runStructuralPolicy() {
  const source = (await readFile(repositoryPath(TEST_FILE))).toString('utf8');
  const sourceFile = typescript.createSourceFile(
    TEST_FILE,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const findings = [];
  const textualPolicies = [
    [/\bREZO_R36_DISCOVERY\b/u, 'discovery-environment'],
    [/@ts-(?:ignore|expect-error|nocheck)\b/u, 'typescript-suppression'],
    [/eslint-disable/u, 'eslint-suppression'],
  ];
  for (const [pattern, label] of textualPolicies) {
    if (pattern.test(source)) findings.push('text:' + label);
  }

  let defineRequireCalls = 0;
  let deleteRequireCalls = 0;
  let descriptorRequireCalls = 0;
  let literalNodeRequireCalls = 0;
  const processObserverCalls = [];
  const registrationNames = [];
  let vitestImports = 0;
  const forbiddenModifiers = new Set([
    'concurrent',
    'each',
    'extend',
    'fails',
    'for',
    'only',
    'runIf',
    'skip',
    'skipIf',
    'todo',
    'todoIf',
  ]);

  const visit = (node) => {
    const location = nodeLocation(sourceFile, node);
    if (node.kind === typescript.SyntaxKind.AnyKeyword) {
      findings.push(location + ':explicit-any');
    }
    if (
      (typescript.isAsExpression(node) || typescript.isTypeAssertionExpression(node))
      && node.type.kind === typescript.SyntaxKind.NeverKeyword
    ) findings.push(location + ':never-assertion');
    if (
      (typescript.isAsExpression(node) || typescript.isTypeAssertionExpression(node))
      && (
        typescript.isAsExpression(node.expression)
        || typescript.isTypeAssertionExpression(node.expression)
      )
      && node.expression.type.kind === typescript.SyntaxKind.UnknownKeyword
    ) findings.push(location + ':double-unknown-assertion');

    if (typescript.isImportDeclaration(node)) {
      if (literalText(node.moduleSpecifier) === 'node:module') {
        findings.push(location + ':dynamic-loader-module-import');
      }
      if (literalText(node.moduleSpecifier) === 'vitest') {
        vitestImports += 1;
        const bindings = node.importClause?.namedBindings;
        if (
          bindings === undefined
          || !typescript.isNamedImports(bindings)
          || bindings.elements.some(
            (element) => element.propertyName !== undefined,
          )
          || JSON.stringify(
            bindings.elements.map((element) => element.name.text).sort(),
          ) !== JSON.stringify(['afterAll', 'beforeAll', 'expect', 'it'])
        ) findings.push(location + ':vitest-import-shape');
      }
    }
    if (
      typescript.isVariableDeclaration(node)
      && node.initializer !== undefined
      && (
        (typescript.isIdentifier(node.initializer)
          && ['global', 'globalThis', 'module', 'require'].includes(node.initializer.text))
        || accessContainsProperty(node.initializer, 'require')
        || (
          typescript.isIdentifier(node.initializer)
          && ['describe', 'it', 'test'].includes(node.initializer.text)
        )
      )
    ) findings.push(location + ':loader-root-alias');

    if (
      typescript.isBinaryExpression(node)
      && isAssignmentToken(node.operatorToken.kind)
    ) {
      const root = accessRootIdentifier(node.left);
      if (root === 'global' || root === 'globalThis') {
        findings.push(location + ':global-assignment');
      }
      if (accessContainsProperty(node.left, 'prototype')) {
        findings.push(location + ':prototype-assignment');
      }
    }
    if (
      (typescript.isPrefixUnaryExpression(node)
        || typescript.isPostfixUnaryExpression(node))
      && (
        node.operator === typescript.SyntaxKind.PlusPlusToken
        || node.operator === typescript.SyntaxKind.MinusMinusToken
      )
      && (
        ['global', 'globalThis'].includes(accessRootIdentifier(node.operand) ?? '')
        || accessContainsProperty(node.operand, 'prototype')
      )
    ) findings.push(location + ':global-or-prototype-update');
    if (
      typescript.isDeleteExpression(node)
      && (
        ['global', 'globalThis'].includes(accessRootIdentifier(node.expression) ?? '')
        || accessContainsProperty(node.expression, 'prototype')
      )
    ) findings.push(location + ':global-or-prototype-delete');

    if (typescript.isNewExpression(node)) {
      if (
        typescript.isIdentifier(node.expression)
        && node.expression.text === 'Function'
      ) findings.push(location + ':function-constructor');
    }

    if (typescript.isCallExpression(node)) {
      const parts = propertyAccessParts(node.expression);
      if (node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
        findings.push(location + ':dynamic-import');
      }
      if (
        typescript.isIdentifier(node.expression)
        && ['eval', 'Function', 'require', 'createRequire'].includes(node.expression.text)
      ) findings.push(location + ':dynamic-loader-or-eval:' + node.expression.text);
      if (
        parts.includes('createRequire')
        || parts.includes('getBuiltinModule')
      ) findings.push(location + ':dynamic-loader-acquisition');
      if (
        parts.at(-1) === 'require'
        && ['global', 'globalThis', 'module'].includes(parts[0] ?? '')
      ) findings.push(location + ':dynamic-loader-root-call');

      const finalPart = parts.at(-1);
      if (
        finalPart !== undefined
        && forbiddenModifiers.has(finalPart)
        && ['describe', 'it', 'test'].includes(parts[0] ?? '')
      ) {
        findings.push(location + ':forbidden-test-modifier:' + finalPart);
      }

      if (
        typescript.isIdentifier(node.expression)
        && (node.expression.text === 'it' || node.expression.text === 'test')
      ) {
        if (hasConditionalRegistrationAncestor(node, sourceFile)) {
          findings.push(location + ':conditional-test-registration');
        }
        const [name, second, third] = node.arguments;
        if (name === undefined || literalText(name) === undefined) {
          findings.push(location + ':registration-name-not-literal');
        } else {
          registrationNames.push(literalText(name));
        }
        const direct = node.arguments.length === 2
          && second !== undefined
          && isInlineCallback(second);
        const timed = node.arguments.length === 3
          && second !== undefined
          && isInlineCallback(second)
          && third !== undefined
          && typescript.isNumericLiteral(third);
        const configured = node.arguments.length === 3
          && second !== undefined
          && typescript.isObjectLiteralExpression(second)
          && third !== undefined
          && isInlineCallback(third);
        if (!direct && !timed && !configured) {
          findings.push(location + ':registration-call-shape');
        }
        if (configured && second !== undefined) {
          validateLiteralOptions(second, findings, location);
        }
      }

      if (
        parts.length === 2
        && parts[0] === 'Object'
        && parts[1] === 'defineProperty'
        && node.arguments[0]?.getText() === 'globalThis'
      ) {
        if (
          node.arguments.length !== 3
          || literalText(node.arguments[1]) !== 'require'
          || !typescript.isObjectLiteralExpression(node.arguments[2])
        ) {
          findings.push(location + ':global-define-property');
        } else {
          const descriptor = node.arguments[2];
          const expectedDescriptor = {
            configurable: 'true',
            enumerable: 'false',
            value: 'nodeRequire',
            writable: 'false',
          };
          const actualDescriptor = {};
          for (const property of descriptor.properties) {
            if (!typescript.isPropertyAssignment(property)) {
              findings.push(location + ':require-descriptor-shape');
              continue;
            }
            const name = typescript.isIdentifier(property.name)
              || typescript.isStringLiteral(property.name)
              ? property.name.text
              : property.name.getText();
            actualDescriptor[name] = property.initializer.getText();
          }
          if (
            JSON.stringify(actualDescriptor)
              !== JSON.stringify(expectedDescriptor)
          ) findings.push(location + ':require-descriptor-values');
          defineRequireCalls += 1;
        }
      } else if (
        parts.length >= 2
        && ['Object', 'Reflect'].includes(parts[0])
        && [
          'assign',
          'deleteProperty',
          'defineProperties',
          'defineProperty',
          'freeze',
          'preventExtensions',
          'seal',
          'set',
          'setPrototypeOf',
        ].includes(parts[1])
        && !(
          parts[0] === 'Reflect'
          && parts[1] === 'deleteProperty'
          && node.arguments.length === 2
          && node.arguments[0]?.getText() === 'globalThis'
          && literalText(node.arguments[1]) === 'require'
        )
        && (
          ['global', 'globalThis'].includes(accessRootIdentifier(node.arguments[0]) ?? '')
          || accessContainsProperty(node.arguments[0], 'prototype')
        )
      ) findings.push(location + ':global-or-prototype-mutator');

      if (
        parts.length === 2
        && parts[0] === 'Reflect'
        && parts[1] === 'deleteProperty'
        && node.arguments[0]?.getText() === 'globalThis'
      ) {
        if (
          node.arguments.length !== 2
          || literalText(node.arguments[1]) !== 'require'
        ) findings.push(location + ':global-delete-property');
        else deleteRequireCalls += 1;
      }
      if (
        parts.length === 2
        && parts[0] === 'Object'
        && parts[1] === 'getOwnPropertyDescriptor'
        && node.arguments[0]?.getText() === 'globalThis'
      ) {
        if (
          node.arguments.length !== 2
          || literalText(node.arguments[1]) !== 'require'
        ) findings.push(location + ':global-descriptor-read');
        else descriptorRequireCalls += 1;
      }
      if (
        typescript.isIdentifier(node.expression)
        && node.expression.text === 'nodeRequire'
      ) {
        if (
          node.arguments.length !== 1
          || literalText(node.arguments[0]) !== 'node:fs'
        ) findings.push(location + ':node-require-service');
        else literalNodeRequireCalls += 1;
      }
      if (
        parts.length === 2
        && parts[0] === 'process'
        && (parts[1] === 'on' || parts[1] === 'off')
      ) {
        const event = literalText(node.arguments[0]);
        const handler = node.arguments[1];
        const handlerName = handler !== undefined && typescript.isIdentifier(handler)
          ? handler.text
          : undefined;
        const accepted = node.arguments.length === 2
          && (
            (event === 'uncaughtException' && handlerName === 'onUncaughtException')
            || (event === 'unhandledRejection' && handlerName === 'onUnhandledRejection')
          );
        if (!accepted) findings.push(location + ':process-observer-call');
        else processObserverCalls.push(parts[1] + ':' + event + ':' + handlerName);
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (defineRequireCalls !== 1) {
    findings.push('cardinality:define-require:' + defineRequireCalls);
  }
  if (deleteRequireCalls !== 1) {
    findings.push('cardinality:delete-require:' + deleteRequireCalls);
  }
  if (descriptorRequireCalls !== 2) {
    findings.push('cardinality:descriptor-require:' + descriptorRequireCalls);
  }
  if (literalNodeRequireCalls !== 1) {
    findings.push('cardinality:literal-node-require:' + literalNodeRequireCalls);
  }
  if (vitestImports !== 1) {
    findings.push('cardinality:vitest-imports:' + vitestImports);
  }
  if (registrationNames.length !== REGISTERED.length + 1) {
    findings.push('cardinality:registrations:' + registrationNames.length);
  }
  if (
    registrationNames.filter((name) => name === 'fixture pins are exact').length !== 1
  ) findings.push('cardinality:fixture-registration');
  for (const id of REGISTERED) {
    if (
      registrationNames.filter((name) => name?.startsWith(id + ' ')).length !== 1
    ) findings.push('cardinality:row-registration:' + id);
  }
  if (
    registrationNames.some(
      (name) => name !== 'fixture pins are exact'
        && !REGISTERED.some((id) => name?.startsWith(id + ' ')),
    )
  ) findings.push('registration:unknown-name');
  const expectedProcessObserverCalls = [
    'off:uncaughtException:onUncaughtException',
    'off:unhandledRejection:onUnhandledRejection',
    'on:uncaughtException:onUncaughtException',
    'on:unhandledRejection:onUnhandledRejection',
  ];
  if (
    JSON.stringify([...processObserverCalls].sort())
      !== JSON.stringify(expectedProcessObserverCalls)
  ) findings.push('cardinality:process-observers:' + JSON.stringify(processObserverCalls));
  if (sourceFile.parseDiagnostics.length !== 0) {
    findings.push('typescript-parse-diagnostics:' + sourceFile.parseDiagnostics.length);
  }
  if (findings.length !== 0) {
    throw new SupervisorFailure(
      EXIT_RUNNER_OR_LEDGER,
      'structural-policy-findings:' + findings.join('|'),
    );
  }
  return {
    file: TEST_FILE,
    findings: 0,
    processObserverCalls: expectedProcessObserverCalls.length,
    requireBridgeCalls: defineRequireCalls + deleteRequireCalls
      + descriptorRequireCalls + literalNodeRequireCalls,
  };
}

let activeRunner = null;
let activeTermination = null;
let fatalInProgress = false;

function signalProcessGroup(child, signal) {
  if (child === null || child === undefined || child.pid === undefined) return true;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ESRCH') {
      return true;
    }
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  }
}

function forceKillActiveRunner() {
  const child = activeRunner;
  if (child === null) return true;
  const killed = signalProcessGroup(child, 'SIGKILL');
  try {
    child.stdout?.destroy();
  } catch {
    // Fatal cleanup is best-effort; the returned flag retains failure.
  }
  try {
    child.stderr?.destroy();
  } catch {
    // Fatal cleanup is best-effort; the returned flag retains failure.
  }
  try {
    child.unref();
  } catch {
    // Fatal cleanup is best-effort; the returned flag retains failure.
  }
  return killed;
}

function fatalInfrastructure(error) {
  if (fatalInProgress) {
    forceKillActiveRunner();
    process.exit(EXIT_INFRASTRUCTURE);
  }
  fatalInProgress = true;
  const groupCleanupSucceeded = forceKillActiveRunner();
  try {
    writeSync(
      2,
      'REZO_R36_SUPERVISOR_FATAL:' + String(error)
        + ':groupCleanup=' + String(groupCleanupSucceeded) + '\n',
    );
  } catch {
    // Nothing remains trustworthy after the fatal write itself fails.
  }
  process.exit(EXIT_INFRASTRUCTURE);
}

process.on('uncaughtException', fatalInfrastructure);
process.on('unhandledRejection', fatalInfrastructure);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (activeTermination !== null) {
      activeTermination('external-' + signal, signal);
      return;
    }
    fatalInfrastructure('external-' + signal);
  });
}

function sanitizedChildEnvironment() {
  const forbidden = [
    'BUN_OPTIONS',
    'NODE_DEBUG',
    'NODE_OPTIONS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'REZO_R36_DISCOVERY',
  ];
  for (const key of forbidden) {
    if (Object.hasOwn(process.env, key)) {
      throw new SupervisorFailure(
        EXIT_INFRASTRUCTURE,
        'forbidden-environment:' + key,
      );
    }
  }
  const environment = { ...process.env };
  for (const key of forbidden) delete environment[key];
  return environment;
}

function runSupervised(runtime, spec, environment) {
  return new Promise((resolveRun) => {
    let child;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let launchError = null;
    let closeRecord = null;
    let infrastructureReason = null;
    let killIssued = false;
    let completed = false;
    let hardKillTimer;
    let drainTimer;

    const finish = (naturalClose, forcedDrain) => {
      if (completed) return;
      completed = true;
      clearTimeout(watchdogTimer);
      if (hardKillTimer !== undefined) clearTimeout(hardKillTimer);
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      activeTermination = null;
      child?.unref();
      activeRunner = null;
      resolveRun({
        args: [...spec.args],
        closeRecord,
        command: spec.executable,
        drained: naturalClose && !forcedDrain,
        infrastructureReason,
        pid: child?.pid ?? null,
        runtime,
        stderr,
        stderrBytes,
        stdout,
        stdoutBytes,
      });
    };

    const beginTermination = (reason, signal) => {
      if (completed || infrastructureReason !== null) return;
      infrastructureReason = reason;
      clearTimeout(watchdogTimer);
      signalProcessGroup(child, signal);
      hardKillTimer = setTimeout(() => {
        killIssued = true;
        signalProcessGroup(child, 'SIGKILL');
        if (closeRecord !== null) {
          finish(true, false);
          return;
        }
        drainTimer = setTimeout(() => {
          child?.stdout?.destroy();
          child?.stderr?.destroy();
          child?.unref();
          finish(false, true);
        }, TERMINATION_GRACE_MILLISECONDS);
      }, TERMINATION_GRACE_MILLISECONDS);
    };

    activeTermination = beginTermination;

    const watchdogTimer = setTimeout(
      () => beginTermination('outer-timeout', 'SIGTERM'),
      RUNNER_WATCHDOG_MILLISECONDS,
    );

    try {
      child = spawn(spec.executable, spec.args, {
        cwd: REPOSITORY_ROOT,
        detached: true,
        env: environment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      infrastructureReason = 'spawn-threw:' + String(error);
      finish(true, false);
      return;
    }
    activeRunner = child;

    const capture = (stream, chunk) => {
      const bytes = Buffer.byteLength(chunk);
      if (stream === 'stdout') {
        stdoutBytes += bytes;
        if (stdoutBytes <= OUTPUT_LIMIT_BYTES) stdout += chunk;
      } else {
        stderrBytes += bytes;
        if (stderrBytes <= OUTPUT_LIMIT_BYTES) stderr += chunk;
      }
      if (stdoutBytes > OUTPUT_LIMIT_BYTES || stderrBytes > OUTPUT_LIMIT_BYTES) {
        beginTermination('output-limit', 'SIGTERM');
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    child.stdout.on('error', () => beginTermination('stdout-pipe-error', 'SIGKILL'));
    child.stderr.on('error', () => beginTermination('stderr-pipe-error', 'SIGKILL'));
    child.once('error', (error) => {
      launchError = error;
    });
    child.once('close', (code, signal) => {
      closeRecord = launchError === null
        ? { code, kind: 'close', signal }
        : {
            code,
            kind: 'launch',
            message: String(launchError),
            signal,
          };
      if (launchError !== null) {
        infrastructureReason = 'launch-error';
        finish(true, false);
      } else if (infrastructureReason !== null) {
        if (killIssued) finish(true, false);
      } else if (signal !== null || code === null) {
        beginTermination('child-signal-' + (signal ?? 'null'), 'SIGTERM');
      } else {
        if (!signalProcessGroup(child, 'SIGKILL')) {
          infrastructureReason = 'post-close-group-cleanup';
        }
        finish(true, false);
      }
    });
  });
}

function appendStaticGateCapture(captures, name, run) {
  for (const stream of ['stdout', 'stderr']) {
    const retained = run[stream];
    const frame = 'REZO_R36_STATIC_GATE_OUTPUT_V1:' + JSON.stringify({
      gate: name,
      observedBytes: run[stream + 'Bytes'],
      retainedBytes: Buffer.byteLength(retained),
      retainedSha256: sha256(Buffer.from(retained)),
      stream,
    }) + '\n' + retained + (retained.endsWith('\n') ? '' : '\n');
    if (
      Buffer.byteLength(captures[stream]) + Buffer.byteLength(frame)
        > OUTPUT_LIMIT_BYTES
    ) return 'static-capture-output-limit:' + stream;
    captures[stream] += frame;
  }
  return null;
}

async function runStaticCommandGate(name, spec, environment, captures) {
  const openingIdentity = staticCommandIdentity(spec);
  const run = await runSupervised('static:' + name, spec, environment);
  const captureReason = appendStaticGateCapture(captures, name, run);
  const closingIdentity = staticCommandIdentity(spec);
  const result = {
    args: run.args,
    command: run.command,
    drained: run.drained,
    identity: closingIdentity,
    limits: {
      outputBytes: OUTPUT_LIMIT_BYTES,
      terminationGraceMilliseconds: TERMINATION_GRACE_MILLISECONDS,
      watchdogMilliseconds: RUNNER_WATCHDOG_MILLISECONDS,
    },
    outcome: run.closeRecord ?? {
      code: null,
      kind: 'drain-timeout',
      signal: null,
    },
    pid: run.pid,
    stderrBytes: run.stderrBytes,
    stderrSha256: sha256(Buffer.from(run.stderr)),
    stdoutBytes: run.stdoutBytes,
    stdoutSha256: sha256(Buffer.from(run.stdout)),
  };
  if (captureReason !== null) {
    return { exitCode: EXIT_INFRASTRUCTURE, reason: captureReason, result };
  }
  if (JSON.stringify(closingIdentity) !== JSON.stringify(openingIdentity)) {
    return {
      exitCode: EXIT_INFRASTRUCTURE,
      reason: 'static-command-identity-drift:' + name,
      result,
    };
  }
  if (run.infrastructureReason !== null) {
    return {
      exitCode: EXIT_INFRASTRUCTURE,
      reason: 'static-command-infrastructure:' + name + ':'
        + run.infrastructureReason,
      result,
    };
  }
  if (run.closeRecord?.kind !== 'close') {
    return {
      exitCode: EXIT_INFRASTRUCTURE,
      reason: 'static-command-launch:' + name,
      result,
    };
  }
  if (
    !run.drained
    || !Number.isSafeInteger(run.pid)
    || run.pid <= 0
    || run.stdoutBytes !== Buffer.byteLength(run.stdout)
    || run.stderrBytes !== Buffer.byteLength(run.stderr)
    || run.closeRecord.signal !== null
    || !Number.isSafeInteger(run.closeRecord.code)
  ) {
    return {
      exitCode: EXIT_INFRASTRUCTURE,
      reason: 'static-command-settlement:' + name,
      result,
    };
  }
  if (run.closeRecord.code !== 0) {
    return {
      exitCode: EXIT_RUNNER_OR_LEDGER,
      reason: 'static-command-findings:' + name + ':exit:'
        + run.closeRecord.code + ':stdout:' + result.stdoutSha256
        + ':stderr:' + result.stderrSha256,
      result,
    };
  }
  return { exitCode: EXIT_ACCEPTED, reason: null, result };
}

async function createCaptureDirectory() {
  let directory;
  try {
    directory = await mkdtemp('/private/tmp/rezo-r36-supervisor.');
    const information = await lstat(directory);
    if (
      !information.isDirectory()
      || information.isSymbolicLink()
      || await realpath(directory) !== directory
      || !directory.startsWith('/private/tmp/rezo-r36-supervisor.')
    ) {
      throw new Error('capture directory identity mismatch');
    }
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'capture-directory',
      { cause: error },
    );
  }
  return directory;
}

async function writeCaptures(directory, run, summary) {
  let flushTimer;
  try {
    await Promise.race([
      Promise.all([
        writeFile(join(directory, 'runner.stdout'), run.stdout, {
          flag: 'wx',
          mode: 0o600,
        }),
        writeFile(join(directory, 'runner.stderr'), run.stderr, {
          flag: 'wx',
          mode: 0o600,
        }),
        writeFile(
          join(directory, 'summary.json'),
          JSON.stringify(summary) + '\n',
          { flag: 'wx', mode: 0o600 },
        ),
      ]),
      new Promise((_resolve, reject) => {
        flushTimer = setTimeout(
          () => reject(new Error('capture-flush-timeout')),
          CAPTURE_FLUSH_MILLISECONDS,
        );
      }),
    ]);
  } catch (error) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'capture-write',
      { cause: error },
    );
  } finally {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
  }
}

function emitSummary(summary) {
  writeSync(1, SUPERVISOR_PREFIX + JSON.stringify(summary) + '\n');
}

const IN_PROCESS_STATIC_GATES = Object.freeze({
  'focused-lint': runFocusedLint,
  'structural-policy': runStructuralPolicy,
});

async function runStaticMode(mode, openingHashes, environment) {
  const captureDirectory = await createCaptureDirectory();
  const requestedGates = mode === 'static' ? STATIC_GATE_ORDER : [mode];
  const gates = [];
  const captures = { stderr: '', stdout: '' };
  let acceptanceReason = null;
  let infrastructureReason = null;
  for (const name of requestedGates) {
    try {
      if (Object.hasOwn(STATIC_COMMAND_SPECS, name)) {
        const outcome = await runStaticCommandGate(
          name,
          STATIC_COMMAND_SPECS[name],
          environment,
          captures,
        );
        if (outcome.exitCode === EXIT_ACCEPTED) {
          gates.push({ name, result: outcome.result, status: 'passed' });
          continue;
        }
        const status = outcome.exitCode === EXIT_RUNNER_OR_LEDGER
          ? 'failed'
          : 'infrastructure';
        gates.push({
          name,
          reason: outcome.reason,
          result: outcome.result,
          status,
        });
        acceptanceReason ??= outcome.reason;
        if (outcome.exitCode === EXIT_INFRASTRUCTURE) {
          infrastructureReason = outcome.reason;
          acceptanceReason = outcome.reason;
          break;
        }
        continue;
      }
      const operation = IN_PROCESS_STATIC_GATES[name];
      if (operation === undefined) {
        throw new SupervisorFailure(
          EXIT_INFRASTRUCTURE,
          'unknown-static-gate:' + name,
        );
      }
      gates.push({ name, result: await operation(), status: 'passed' });
    } catch (error) {
      if (error instanceof SupervisorFailure && error.exitCode === EXIT_HASH) {
        throw error;
      }
      const exitCode = error instanceof SupervisorFailure
        ? error.exitCode
        : EXIT_INFRASTRUCTURE;
      const reason = error instanceof SupervisorFailure
        ? error.reason
        : 'static-gate-threw:' + name + ':' + String(error);
      const status = exitCode === EXIT_RUNNER_OR_LEDGER
        ? 'failed'
        : 'infrastructure';
      gates.push({ name, reason, status });
      acceptanceReason ??= reason;
      if (exitCode !== EXIT_RUNNER_OR_LEDGER) {
        infrastructureReason = reason;
        acceptanceReason = reason;
        break;
      }
    }
  }
  const closingHashes = await captureHashes();
  if (JSON.stringify(closingHashes) !== JSON.stringify(openingHashes)) {
    throw new SupervisorFailure(EXIT_HASH, 'governed-hash-sandwich-drift');
  }
  validateApprovedHashes(closingHashes);
  const exitCode = infrastructureReason !== null
    ? EXIT_INFRASTRUCTURE
    : acceptanceReason === null
      ? EXIT_ACCEPTED
      : EXIT_RUNNER_OR_LEDGER;
  const summary = {
    acceptanceReason,
    captureDirectory,
    closingHashes,
    gates,
    infrastructureReason,
    limits: {
      captureFlushMilliseconds: CAPTURE_FLUSH_MILLISECONDS,
      outputBytes: OUTPUT_LIMIT_BYTES,
      terminationGraceMilliseconds: TERMINATION_GRACE_MILLISECONDS,
      watchdogMilliseconds: RUNNER_WATCHDOG_MILLISECONDS,
    },
    mode,
    openingHashes,
    schema: 'rezo.r36.download-target-integrity.supervisor-static/v1',
    stderrBytes: Buffer.byteLength(captures.stderr),
    stderrSha256: sha256(Buffer.from(captures.stderr)),
    stdoutBytes: Buffer.byteLength(captures.stdout),
    stdoutSha256: sha256(Buffer.from(captures.stdout)),
    supervisorExit: exitCode,
  };
  await writeCaptures(captureDirectory, captures, summary);
  emitSummary(summary);
  process.exit(exitCode);
}

async function main() {
  if (process.platform === 'win32') {
    throw new SupervisorFailure(EXIT_INFRASTRUCTURE, 'posix-process-group-required');
  }
  if (
    realpathSync(process.execPath) !== NODE_EXECUTABLE
    || process.version !== 'v25.9.0'
  ) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'supervisor-node-identity',
    );
  }
  const requested = process.argv.slice(2);
  const allowedModes = new Set([
    'bun',
    'diff-check',
    'focused-lint',
    'node',
    'root-lint',
    'source-typecheck',
    'static',
    'structural-policy',
    'test-typecheck',
  ]);
  if (requested.length !== 1 || !allowedModes.has(requested[0])) {
    throw new SupervisorFailure(
      EXIT_INFRASTRUCTURE,
      'usage: node test/r36-download-target-integrity-supervisor.mjs '
        + '<node|bun|static|test-typecheck|source-typecheck|focused-lint|'
        + 'root-lint|structural-policy|diff-check>',
    );
  }
  const environment = sanitizedChildEnvironment();
  const openingHashes = await captureHashes();
  validateApprovedHashes(openingHashes);
  if (!Object.hasOwn(RUNTIME_SPECS, requested[0])) {
    await runStaticMode(requested[0], openingHashes, environment);
    return;
  }
  const runtime = requested[0];
  const spec = RUNTIME_SPECS[runtime];
  const openingRuntimeIdentity = runtimeIdentity(spec);
  const captureDirectory = await createCaptureDirectory();

  const run = await runSupervised(runtime, spec, environment);

  let closingHashes = null;
  let hashReason = null;
  try {
    closingHashes = await captureHashes();
    if (JSON.stringify(closingHashes) !== JSON.stringify(openingHashes)) {
      hashReason = 'governed-hash-sandwich-drift';
    } else {
      validateApprovedHashes(closingHashes);
    }
  } catch (error) {
    if (error instanceof SupervisorFailure && error.exitCode === EXIT_HASH) {
      hashReason = error.reason;
    } else {
      hashReason = 'closing-hash-capture:' + String(error);
    }
  }
  const closingRuntimeIdentity = runtimeIdentity(spec);
  if (
    JSON.stringify(closingRuntimeIdentity)
      !== JSON.stringify(openingRuntimeIdentity)
  ) {
    throw new SupervisorFailure(EXIT_INFRASTRUCTURE, 'runtime-identity-drift');
  }

  let exitCode = EXIT_INFRASTRUCTURE;
  let acceptanceReason = hashReason;
  if (hashReason !== null) {
    exitCode = EXIT_HASH;
  } else if (run.infrastructureReason === null && run.closeRecord?.kind === 'close') {
    const ledgerReason = validateLedger(run.stdout, run.stderr, runtime, spec);
    if (
      run.closeRecord.code === 1
      && run.closeRecord.signal === null
      && ledgerReason === null
      && run.drained
      && Number.isSafeInteger(run.pid)
      && run.pid > 0
      && run.stdoutBytes === Buffer.byteLength(run.stdout)
      && run.stderrBytes === Buffer.byteLength(run.stderr)
    ) {
      exitCode = EXIT_ACCEPTED;
    } else {
      exitCode = EXIT_RUNNER_OR_LEDGER;
      acceptanceReason = ledgerReason
        ?? (!run.drained ? 'runner-pipes-not-drained' : null)
        ?? (
          !Number.isSafeInteger(run.pid) || run.pid <= 0
            ? 'runner-pid-invalid'
            : null
        )
        ?? (
          run.stdoutBytes !== Buffer.byteLength(run.stdout)
          || run.stderrBytes !== Buffer.byteLength(run.stderr)
            ? 'runner-output-not-fully-retained'
            : null
        )
        ?? ('unexpected-runner-exit:' + String(run.closeRecord.code));
    }
  } else {
    acceptanceReason = run.infrastructureReason ?? 'runner-did-not-close';
  }

  const summary = {
    acceptanceReason,
    args: run.args,
    captureDirectory,
    closingHashes,
    command: run.command,
    drained: run.drained,
    file: TEST_FILE,
    infrastructureReason: run.infrastructureReason,
    limits: {
      captureFlushMilliseconds: CAPTURE_FLUSH_MILLISECONDS,
      outputBytes: OUTPUT_LIMIT_BYTES,
      terminationGraceMilliseconds: TERMINATION_GRACE_MILLISECONDS,
      watchdogMilliseconds: RUNNER_WATCHDOG_MILLISECONDS,
    },
    openingHashes,
    outcome: run.closeRecord ?? {
      code: null,
      kind: 'drain-timeout',
      signal: null,
    },
    pid: run.pid,
    runtime,
    runtimeIdentity: closingRuntimeIdentity,
    schema: 'rezo.r36.download-target-integrity.supervisor/v1',
    stderrBytes: run.stderrBytes,
    stderrSha256: sha256(Buffer.from(run.stderr)),
    stdoutBytes: run.stdoutBytes,
    stdoutSha256: sha256(Buffer.from(run.stdout)),
    supervisorExit: exitCode,
  };
  await writeCaptures(captureDirectory, run, summary);
  emitSummary(summary);
  process.exit(exitCode);
}

await main().catch((error) => {
  if (error instanceof SupervisorFailure) {
    try {
      writeSync(
        2,
        'REZO_R36_SUPERVISOR_FAILURE:' + JSON.stringify({
          exitCode: error.exitCode,
          reason: error.reason,
        }) + '\n',
      );
    } catch {
      process.exit(EXIT_INFRASTRUCTURE);
    }
    process.exit(error.exitCode);
  }
  fatalInfrastructure(error);
});
