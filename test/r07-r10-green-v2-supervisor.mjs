#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fileConstants, realpathSync, writeSync } from 'node:fs';
import {
  chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_ACCEPTED = 70;
const EXIT_INFRASTRUCTURE = 72;
const EXIT_RUNNER_OR_LEDGER = 73;
const EXIT_HASH = 74;

const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const REPORT_LIMIT_BYTES = 64 * 1024;
const SUMMARY_LIMIT_BYTES = 32 * 1024 * 1024;
const FAILURE_LIMIT_BYTES = 1024 * 1024;
const INTEGRATION_TIMEOUT_MILLISECONDS = 180_000;
const VALIDATOR_TIMEOUT_MILLISECONDS = 60_000;
const VERSION_TIMEOUT_MILLISECONDS = 10_000;
const TERMINATION_GRACE_MILLISECONDS = 5_000;
const GROUP_POLL_MILLISECONDS = 2_000;
const GROUP_POLL_INTERVAL_MILLISECONDS = 25;

const REPOSITORY_ROOT = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SUPERVISOR_FILE = 'test/r07-r10-green-v2-supervisor.mjs';
const R07_FILE = 'test/a-plus-http-compression-integrity.test.ts';
const R10_FILE = 'test/a-plus-stream-terminal-contract.test.ts';
const VALIDATOR_FILE = 'test/a-plus-zstd-frame-validator.test.ts';
const NODE_ENTRY_FILE = 'src/platform/node.ts';
const BUN_ENTRY_FILE = 'src/platform/bun.ts';
const H2_ENTRY_FILE = 'src/adapters/entries/http2.ts';

const NODE_EXECUTABLE = '/opt/homebrew/Cellar/node/25.9.0_2/bin/node';
const NODE_VERSION = 'v25.9.0';
const BUN_EXECUTABLE = '/Users/jmathew/.bun/bin/bun';
const BUN_VERSION = '1.3.14';
const VITEST_ENTRY = join(REPOSITORY_ROOT, 'node_modules/vitest/vitest.mjs');

const R07_LEDGER_PREFIX = 'REZO_R07_LEDGER_V2:';
const R10_LEDGER_PREFIX = 'REZO_R10_LEDGER_V2:';
const SUPERVISOR_PREFIX = 'REZO_R07_R10_SUPERVISOR_V1:';
const FAILURE_PREFIX = 'REZO_R07_R10_SUPERVISOR_FAILURE:';

// This must remain false until Pass 6 mechanically refreezes every provisional
// identity/fact pin. The preflight hashes and versions still run, but the gate
// must govern a non-70 exit before child 1 is created.
const CANONICAL_EXECUTION_ELIGIBLE = false;
const FAILURE_STREAM_ARTIFACT_BYTES = 64 * 1024;
const FAILURE_PARSED_ARTIFACT_BYTES = 512 * 1024;
const FAILURE_STAGE_TIMEOUT_MILLISECONDS = 15_000;

// Pass 5 is deliberately noncanonical. Pass 6 must mechanically refreeze the
// carrier/governance/source identities and the explicitly marked fact tables
// before this supervisor receives execution credit.
const APPROVED_FILE_HASHES = Object.freeze({
  'PLAN/r07-zstd-integrity-README.md': '57c70a369b1db5524cff95bc1506a5c5ace76f6569d6e30fab87f441dd59fd99',
  'PLAN/r07-zstd-integrity-implementation-plan.md': 'f488e0861a8bb275c769f03750e1aeb33aac932d2750219429117074694d3dd6',
  'PLAN/r10-stream-terminal-contract-README.md': '8d60e3ae90bd81ec40da7e088d90677bd5ff96508d2ea3cc5206540bc78191c2',
  'PLAN/r10-stream-terminal-contract-implementation-plan.md': '1654c94366cbf1727e6901cb1126f4b05fa4e6e41febd5e2f21317ceaf75f821',
  'bun.lock': 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53',
  [BUN_ENTRY_FILE]: '484f9c2a6fd36983df8ea8a7633b04ab07b363ccd0f0501f62553b8ae570a18e',
  [H2_ENTRY_FILE]: '99b31fc38ed2a6bd01f713d281d863ab8179df3457f6557f791965e6cad32e9f',
  [NODE_ENTRY_FILE]: 'f5d9a4e6c545ed820f6d62768fa070dc14a674719356fd8f4662b35fbf4608ab',
  'node_modules/vitest/dist/cli.js': '82eeb1d47d25b7bd42168baff61b5e5044aced1970c65aee303fa9f4fad0889e',
  'node_modules/vitest/vitest.mjs': '39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6',
  'package.json': '7102307674739b1f58903f7ae2245699e3a7ee7e4d8a144591efac3c0720d37b',
  'plans/r07-zstd-integrity-red-row-manifest.md': 'a6f86817b046c6f8a7c65e2f6d621e5af8dc9f160d12f066c0adbd679a1cf102',
  'src/utils/zstd-frame-validator.ts': '6af90ff72f07c9a0e03a69d4a128a4afb13c1224e43d05a4c44bbf5feb0fb46f',
  [R07_FILE]: '190281aaa5026e024936122833fab7f46445c461f9eea00aa7e05db5099e8fd1',
  [R10_FILE]: '32d407ad4570746773e28abcd77c8aa80d5efb103bece51e3efb1af50bfe8e75',
  [VALIDATOR_FILE]: 'ada8a25396980d09f931766542f14d544c9b402d668e496ede334f546b0497e4',
  'tsconfig.json': '6fe72dae6b89d68ecd05557a971d72e622c97795f505d7d6bb651ecafef8f20e',
});

const APPROVED_SOURCE = Object.freeze({
  files: 155,
  sha256: '991f93f42fc3a6f2c63f06b179e40ccf8f8cfd3e18573428488482260198e6ee',
});

const APPROVED_NODE_MODULES = Object.freeze({
  files: 35_571,
  sha256: '7157b7ed40a64d92502208d4c58f65cbcd7ad3eb8d23433cb389fad5e94f13bd',
});

const APPROVED_TOOLS = Object.freeze({
  bun: Object.freeze({
    path: BUN_EXECUTABLE,
    sha256: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233',
    version: BUN_VERSION,
  }),
  node: Object.freeze({
    path: NODE_EXECUTABLE,
    sha256: 'a8797df8016acac522da6e203ffa45f51522f96e25f0fb68664cfa1e387b89bc',
    version: NODE_VERSION,
  }),
});

const ROOT_CONFIGURATION_ABSENCE = Object.freeze([
  '.env', '.env.local', '.env.test', '.env.test.local', 'bunfig.toml',
  'vite.config.cjs', 'vite.config.cts', 'vite.config.js', 'vite.config.mjs',
  'vite.config.mts', 'vite.config.ts', 'vite.workspace.cjs',
  'vite.workspace.cts', 'vite.workspace.js', 'vite.workspace.mjs',
  'vite.workspace.mts', 'vite.workspace.ts', 'vitest.config.cjs',
  'vitest.config.cts', 'vitest.config.js', 'vitest.config.mjs',
  'vitest.config.mts', 'vitest.config.ts', 'vitest.projects.cjs',
  'vitest.projects.cts', 'vitest.projects.js', 'vitest.projects.json',
  'vitest.projects.mjs', 'vitest.projects.mts', 'vitest.projects.ts',
  'vitest.workspace.cjs', 'vitest.workspace.cts', 'vitest.workspace.js',
  'vitest.workspace.json', 'vitest.workspace.mjs', 'vitest.workspace.mts',
  'vitest.workspace.ts',
]);

const R07_REGISTERED = Object.freeze([
  'CI-B1', 'CI-C0', 'CI-C1', 'CI-C2', 'CI-C3', 'CI-C4',
  'CI-G1A', 'CI-G1B', 'CI-G1C', 'CI-M1', 'CI-M2', 'CI-M3',
  'CI-S1', 'CI-S2', 'CI-S3', 'CI-Z1', 'CI-Z2', 'CI-Z3',
  'CI-Z4', 'CI-Z5', 'CI-Z6', 'CI-Z7', 'CI-Z8',
]);
const R10_REGISTERED = Object.freeze([
  'ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05',
  'ST-06', 'ST-07', 'ST-08', 'ST-09',
]);

const R07_LEG_KEYS = Object.freeze([
  'CI-B1:h1/buffered/br/GET/direct/1',
  'CI-B1:h2/buffered/br/GET/direct/2',
  'CI-C0:h1/br',
  'CI-C0:h1/brotli',
  'CI-C0:h1/deflate',
  'CI-C0:h1/gzip',
  'CI-C0:h1/gzip-raw',
  'CI-C0:h1/x-deflate',
  'CI-C0:h1/x-gzip',
  'CI-C0:h1/zstd',
  'CI-C0:h2/br',
  'CI-C0:h2/brotli',
  'CI-C0:h2/deflate',
  'CI-C0:h2/gzip',
  'CI-C0:h2/gzip-raw',
  'CI-C0:h2/x-deflate',
  'CI-C0:h2/x-gzip',
  'CI-C0:h2/zstd',
  'CI-C1:h1/buffered/br',
  'CI-C1:h1/buffered/deflate',
  'CI-C1:h1/buffered/gzip',
  'CI-C1:h1/buffered/zstd',
  'CI-C1:h1/download/br',
  'CI-C1:h1/download/deflate',
  'CI-C1:h1/download/gzip',
  'CI-C1:h1/download/zstd',
  'CI-C1:h1/stream/br',
  'CI-C1:h1/stream/deflate',
  'CI-C1:h1/stream/gzip',
  'CI-C1:h1/stream/zstd',
  'CI-C1:h1/upload/br',
  'CI-C1:h1/upload/deflate',
  'CI-C1:h1/upload/gzip',
  'CI-C1:h1/upload/zstd',
  'CI-C1:h2/buffered/br',
  'CI-C1:h2/buffered/deflate',
  'CI-C1:h2/buffered/gzip',
  'CI-C1:h2/buffered/zstd',
  'CI-C1:h2/download/br',
  'CI-C1:h2/download/deflate',
  'CI-C1:h2/download/gzip',
  'CI-C1:h2/download/zstd',
  'CI-C1:h2/stream/br',
  'CI-C1:h2/stream/deflate',
  'CI-C1:h2/stream/gzip',
  'CI-C1:h2/stream/zstd',
  'CI-C1:h2/upload/br',
  'CI-C1:h2/upload/deflate',
  'CI-C1:h2/upload/gzip',
  'CI-C1:h2/upload/zstd',
  'CI-C2:h1/103-204',
  'CI-C2:h1/204',
  'CI-C2:h1/304',
  'CI-C2:h1/HEAD',
  'CI-C2:h2/103-204',
  'CI-C2:h2/204',
  'CI-C2:h2/304',
  'CI-C2:h2/HEAD',
  'CI-C3:h1/buffered',
  'CI-C3:h1/download',
  'CI-C3:h1/stream',
  'CI-C3:h1/upload',
  'CI-C3:h2/buffered',
  'CI-C3:h2/download',
  'CI-C3:h2/stream',
  'CI-C3:h2/upload',
  'CI-C4:h1/buffered',
  'CI-C4:h1/download',
  'CI-C4:h1/stream',
  'CI-C4:h1/upload',
  'CI-C4:h2/buffered',
  'CI-C4:h2/download',
  'CI-C4:h2/stream',
  'CI-C4:h2/upload',
  'CI-G1A:h1/buffered/gzip-raw/GET/direct/1',
  'CI-G1A:h2/buffered/gzip-raw/GET/direct/2',
  'CI-G1B:h1/buffered/gzip-raw/GET/direct/1',
  'CI-G1B:h2/buffered/gzip-raw/GET/direct/2',
  'CI-G1C:h1/buffered/gzip-raw/GET/direct/1',
  'CI-G1C:h2/buffered/gzip-raw/GET/direct/2',
  'CI-M1:h1/buffered/br/GET/direct/6',
  'CI-M1:h1/buffered/deflate/GET/direct/2',
  'CI-M1:h1/buffered/gzip/GET/direct/1',
  'CI-M1:h1/buffered/zstd/GET/direct/3',
  'CI-M1:h1/buffered/zstd/GET/direct/4',
  'CI-M1:h1/buffered/zstd/GET/direct/5',
  'CI-M1:h2/buffered/zstd/GET/direct/7',
  'CI-M2:h1/buffered/br/GET/direct/5',
  'CI-M2:h1/buffered/br/GET/direct/6',
  'CI-M2:h1/buffered/deflate/GET/direct/3',
  'CI-M2:h1/buffered/deflate/GET/direct/4',
  'CI-M2:h1/buffered/gzip/GET/direct/1',
  'CI-M2:h1/buffered/gzip/GET/direct/2',
  'CI-M3:h1/buffered/zstd/GET/direct/1',
  'CI-M3:h2/buffered/zstd/GET/direct/2',
  'CI-S1:h1/buffered/gzip/GET/direct/1',
  'CI-S2:h1/buffered/gzip/GET/direct/1',
  'CI-S3:h1/buffered/zstd/GET/direct/1',
  'CI-S3:h2/buffered/zstd/GET/direct/2',
  'CI-Z1:h1/buffered/zstd/GET/direct/1',
  'CI-Z2:h1/stream/zstd/GET/direct/1',
  'CI-Z3:h1/download/zstd/GET/direct/1',
  'CI-Z4:h1/upload/zstd/GET/direct/1',
  'CI-Z5:h2/buffered/zstd/GET/direct/1',
  'CI-Z6:h2/stream/zstd/GET/direct/1',
  'CI-Z7:h2/download/zstd/GET/direct/1',
  'CI-Z8:h2/upload/zstd/GET/direct/1',
]);

const R10_LEG_KEYS = Object.freeze([
  'ST-01:h2:stream:truncated',
  'ST-02:h1:stream:truncated',
  'ST-03:h2:stream:happy',
  'ST-04:h1:stream:happy',
  'ST-05:h2:buffered:truncated',
  'ST-06:h1:buffered:truncated',
  'ST-07:h2:stream:happy',
  'ST-08:h1:stream:happy',
  'ST-09:h1:stream:zstd-truncated',
]);

const R07_LEDGER_KEYS = Object.freeze([
  'cleanup', 'cleanupErrors', 'clientPools', 'entryIdentity', 'epoch',
  'expectedLegCount', 'expectedPassed', 'expectedRed', 'file',
  'fixtureErrors', 'fixtureEvents', 'lateEvents', 'legCount', 'legs',
  'listeners', 'oracleMismatches', 'passed', 'processFaults', 'red',
  'registered', 'registry', 'runtime', 'runtimeVersion', 'schema',
  'setupErrors', 'skipped', 'teardownErrors',
]);

// `listeners` is the required Pass 6 slot. The current Pass 5 R10 carrier
// deliberately lacks it, so these provisional bytes cannot execute green.
const R10_LEDGER_KEYS = Object.freeze([
  'cleanup', 'cleanupErrors', 'clientPools', 'entryIdentity', 'epoch',
  'expectedLegCount', 'expectedPassed', 'expectedRed', 'file',
  'fixtureErrors', 'fixtureEvents', 'lateEvents', 'legCount', 'legs',
  'listeners', 'oracleMismatches', 'passed', 'processFaults', 'red',
  'registered', 'registry', 'runtime', 'runtimeVersion', 'schema',
  'setupErrors', 'skipped', 'teardownErrors',
]);

const R07_LEG_SCHEMA = Object.freeze([
  'adapter', 'bodyLength', 'bodySha256', 'clientNaturalAtCaseEnd', 'code',
  'encoding', 'errno', 'errorEvents', 'errorIdentity', 'eventSequence',
  'fileState', 'hooks', 'informational', 'isFinished', 'isNetworkError',
  'isRetryable', 'isTimeout', 'message', 'method', 'mode',
  'naturalAtCaseEnd', 'progressEvents', 'protocol', 'responseBodyLength',
  'responseBodySha256', 'responseStatus', 'stable', 'status',
  'streamLength', 'streamSha256', 'successEvents', 'terminal', 'uncaught',
  'unhandled', 'wireHits', 'wireInformationalSent', 'wireLength',
  'wireSha256', 'wireStatus',
]);

const R10_STREAM_LEG_SCHEMA = Object.freeze([
  'adapter', 'bodyExact', 'bodyIsPrefix', 'bodySha256', 'bytes',
  'clientNaturalAtCaseEnd', 'dataAfterTerminal', 'endEvents', 'errorCodes',
  'errors', 'hooks', 'isFinished', 'lateContradiction',
  'naturalAtCaseEnd', 'protocol', 'runtime', 'statusEvents', 'successOrder',
  'terminalSequence', 'wireHits',
]);

const R10_BUFFERED_BASE_SCHEMA = Object.freeze([
  'adapter', 'clientNaturalAtCaseEnd', 'code', 'error', 'fulfilled', 'hooks',
  'naturalAtCaseEnd', 'protocol', 'responseBodyLength', 'responseBodySha256',
  'responseStatus', 'runtime', 'wireHits',
]);

const ERROR_FIELDS_SCHEMA = Object.freeze([
  'code', 'errno', 'hasCause', 'hasResponse', 'isNetworkError',
  'isRetryable', 'isRezoError', 'isTimeout', 'message', 'name',
]);
const HOOK_SCHEMA = Object.freeze([
  'afterHeaders', 'afterParse', 'afterResponse', 'beforeError', 'onAbort',
  'onTimeout',
]);
const H1_POOL_SCHEMA = Object.freeze([
  'activeSockets', 'agentShape', 'agents', 'evictionTimer', 'freeSockets',
  'queuedRequests',
]);
const H2_POOL_SCHEMA = Object.freeze([
  'cleanupInterval', 'entries', 'leases', 'pending', 'sessions', 'states',
  'unhealthy',
]);

const R07_REGISTRY = Object.freeze({
  controls: Object.freeze(['CI-C0', 'CI-C1', 'CI-C2', 'CI-C3', 'CI-C4']),
  targets: Object.freeze([
    'CI-Z1', 'CI-Z2', 'CI-Z3', 'CI-Z4', 'CI-Z5', 'CI-Z6',
    'CI-Z7', 'CI-Z8', 'CI-M1', 'CI-M2', 'CI-M3', 'CI-B1',
    'CI-G1A', 'CI-G1B', 'CI-G1C', 'CI-S1', 'CI-S2', 'CI-S3',
  ]),
});
const R10_REGISTRY = Object.freeze({
  controls: Object.freeze(['ST-02', 'ST-03', 'ST-04', 'ST-06']),
  targets: Object.freeze(['ST-01', 'ST-05', 'ST-07', 'ST-08', 'ST-09']),
});

const VALIDATOR_SUITES = Object.freeze([
  Object.freeze({
    assertions: 13, line: 56, name: 'real frames',
    tests: Object.freeze([
      Object.freeze({ assertions: 2, line: 57, title: 'accepts exactly one real full frame' }),
      Object.freeze({ assertions: 2, line: 62, title: 'reports the truncated prefix incomplete, never complete' }),
      Object.freeze({ assertions: 2, line: 68, title: 'reports magic-only incomplete' }),
      Object.freeze({ assertions: 7, line: 74, title: 'is chunking-invariant across arbitrary split points' }),
    ]),
  }),
  Object.freeze({
    assertions: 4, line: 84, name: 'frame-header rules',
    tests: Object.freeze([
      Object.freeze({ assertions: 1, line: 85, title: 'rejects reserved descriptor bit 3' }),
      Object.freeze({ assertions: 1, line: 90, title: 'never interprets unused descriptor bit 4' }),
      Object.freeze({ assertions: 1, line: 95, title: 'rejects an invalid magic' }),
      Object.freeze({ assertions: 1, line: 101, title: 'recognizes then rejects a skippable frame' }),
    ]),
  }),
  Object.freeze({
    assertions: 5, line: 111, name: 'RFC 9659 HTTP profile',
    tests: Object.freeze([
      Object.freeze({ assertions: 2, line: 112, title: 'accepts an 8 MiB window and rejects the next exponent' }),
      Object.freeze({ assertions: 1, line: 125, title: 'rejects a single-segment FCS-derived window above 8 MiB' }),
      Object.freeze({ assertions: 1, line: 133, title: 'rejects a block above min(window, 128KiB)' }),
      Object.freeze({ assertions: 1, line: 145, title: 'rejects a block above a small single-segment window (window arm of the min)' }),
    ]),
  }),
  Object.freeze({
    assertions: 4, line: 159, name: 'block rules',
    tests: Object.freeze([
      Object.freeze({ assertions: 1, line: 160, title: 'rejects the reserved block type' }),
      Object.freeze({ assertions: 1, line: 170, title: 'walks an RLE block with a single carried byte' }),
      Object.freeze({ assertions: 2, line: 182, title: 'EOF before any block completes is incomplete, not complete' }),
    ]),
  }),
  Object.freeze({
    assertions: 5, line: 194, name: 'single-frame subset boundary',
    tests: Object.freeze([
      Object.freeze({ assertions: 1, line: 195, title: 'rejects trailing bytes after a complete frame' }),
      Object.freeze({ assertions: 1, line: 200, title: 'rejects concatenated frames at the second frame boundary' }),
      Object.freeze({ assertions: 3, line: 205, title: 'requires the full checksum trailer when flagged' }),
    ]),
  }),
]);

const VALIDATOR_ROSTER = Object.freeze(VALIDATOR_SUITES.flatMap((suite) => (
  suite.tests.map((test) => Object.freeze({
    ancestor: suite.name,
    assertions: test.assertions,
    fullName: suite.name + ' ' + test.title,
    line: test.line,
    title: test.title,
  }))
)));

const COMMON_VITEST_ARGUMENTS = Object.freeze([
  'run', '--pool=forks', '--isolate', '--no-file-parallelism',
  '--maxWorkers=1', '--maxConcurrency=1', '--testTimeout=30000',
  '--hookTimeout=120000', '--teardownTimeout=30000', '--bail=0',
  '--retry=0', '--no-cache',
]);

// Observed Pass 5 facts. Hooks/error facts remain mechanical Pass 6 refreeze
// candidates after the carrier correction; the supervisor never weakens them.
const R10_STREAM_FACTS = Object.freeze({
  'ST-01:h2:stream:truncated': Object.freeze({ bodyExact: false, bodySha256: '37a680133bd09342f934afb8dd2c7d9e1b624da5f35e3a38adb103e37c055ed1', bytes: 4, code: 'ECONNRESET', endEvents: 0, hooks: Object.freeze([0, 0, 0, 0, 0, 0]), isFinished: false, sequence: Object.freeze(['data', 'error']), successOrder: Object.freeze([]) }),
  'ST-02:h1:stream:truncated': Object.freeze({ bodyExact: false, bodySha256: '37a680133bd09342f934afb8dd2c7d9e1b624da5f35e3a38adb103e37c055ed1', bytes: 4, code: 'ECONNRESET', endEvents: 0, hooks: Object.freeze([1, 0, 0, 0, 0, 0]), isFinished: false, sequence: Object.freeze(['data', 'error']), successOrder: Object.freeze([]) }),
  'ST-03:h2:stream:happy': Object.freeze({ bodyExact: true, bodySha256: '4dffdf7ea6809dffd76f1b01c481325d01270cf5d55f61a720dcc336196ff80f', bytes: 24, code: null, endEvents: 1, hooks: Object.freeze([0, 0, 0, 0, 0, 0]), isFinished: true, sequence: Object.freeze(['data', 'end', 'finish', 'done', 'complete']), successOrder: Object.freeze(['finish', 'done', 'complete']) }),
  'ST-04:h1:stream:happy': Object.freeze({ bodyExact: true, bodySha256: '4dffdf7ea6809dffd76f1b01c481325d01270cf5d55f61a720dcc336196ff80f', bytes: 24, code: null, endEvents: 1, hooks: Object.freeze([1, 1, 0, 0, 0, 0]), isFinished: true, sequence: Object.freeze(['data', 'end', 'finish', 'done', 'complete']), successOrder: Object.freeze(['finish', 'done', 'complete']) }),
  'ST-07:h2:stream:happy': Object.freeze({ bodyExact: true, bodySha256: '4dffdf7ea6809dffd76f1b01c481325d01270cf5d55f61a720dcc336196ff80f', bytes: 24, code: null, endEvents: 1, hooks: Object.freeze([0, 0, 0, 0, 0, 0]), isFinished: true, sequence: Object.freeze(['data', 'end', 'finish', 'done', 'complete']), successOrder: Object.freeze(['finish', 'done', 'complete']) }),
  'ST-08:h1:stream:happy': Object.freeze({ bodyExact: true, bodySha256: '4dffdf7ea6809dffd76f1b01c481325d01270cf5d55f61a720dcc336196ff80f', bytes: 24, code: null, endEvents: 1, hooks: Object.freeze([1, 1, 0, 0, 0, 0]), isFinished: true, sequence: Object.freeze(['data', 'end', 'finish', 'done', 'complete']), successOrder: Object.freeze(['finish', 'done', 'complete']) }),
  'ST-09:h1:stream:zstd-truncated': Object.freeze({ bodyExact: false, bodySha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d', bytes: 131_084, code: 'REZ_DECOMPRESSION_ERROR', endEvents: 0, hooks: Object.freeze([1, 1, 0, 0, 0, 0]), isFinished: false, sequence: Object.freeze(['data', 'error']), successOrder: Object.freeze([]) }),
});

// The tests execute ST-09 before ST-08; these are exact cumulative fixture
// resources, not values inferred from sorted leg keys.
const R10_NATURAL_BY_LEG = Object.freeze({
  'ST-01:h2:stream:truncated': Object.freeze([1, 1, 1, 0]),
  'ST-02:h1:stream:truncated': Object.freeze([2, 1, 2, 0]),
  'ST-03:h2:stream:happy': Object.freeze([3, 2, 3, 0]),
  'ST-04:h1:stream:happy': Object.freeze([4, 2, 4, 0]),
  'ST-05:h2:buffered:truncated': Object.freeze([5, 3, 5, 0]),
  'ST-06:h1:buffered:truncated': Object.freeze([6, 3, 6, 0]),
  'ST-07:h2:stream:happy': Object.freeze([7, 4, 7, 0]),
  'ST-08:h1:stream:happy': Object.freeze([9, 4, 9, 0]),
  'ST-09:h1:stream:zstd-truncated': Object.freeze([8, 4, 8, 0]),
});

const executionState = {
  activeChild: null,
  children: [],
  closingIdentity: null,
  closingVersions: null,
  environment: null,
  failureEvidence: null,
  governedFailurePromise: null,
  inFlightStage: null,
  openingIdentity: null,
  openingVersions: null,
  temporary: null,
  temporaryCleanupPromise: null,
  temporaryCleanup: null,
  terminal: {
    claim: 'open',
    sentinelWritten: false,
  },
};

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

function exactArray(value, expected) {
  return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function boundedReason(value) {
  let text;
  try {
    text = String(value);
  } catch {
    text = '[unstringifiable]';
  }
  return text.length <= 4096 ? text : text.slice(0, 4096) + ':truncated';
}

function fail(exitCode, reason, options) {
  throw new SupervisorFailure(exitCode, reason, options);
}

function ledgerAssert(condition, context, reason) {
  if (!condition) fail(EXIT_RUNNER_OR_LEDGER, 'ledger:' + context + ':' + reason);
}

function repositoryPath(relativePath) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  const escape = relative(REPOSITORY_ROOT, absolutePath);
  if (escape === '..' || escape.startsWith('../') || resolve(absolutePath) !== absolutePath) {
    fail(EXIT_HASH, 'governed-path-escape:' + relativePath);
  }
  return absolutePath;
}

async function hashRegularFile(absolutePath, label) {
  let information;
  let resolvedPath;
  let bytes;
  try {
    information = await lstat(absolutePath);
    resolvedPath = await realpath(absolutePath);
    bytes = await readFile(absolutePath);
  } catch (error) {
    fail(EXIT_HASH, 'file-read:' + label, { cause: error });
  }
  if (!information.isFile() || information.isSymbolicLink() || resolvedPath !== absolutePath) {
    fail(EXIT_HASH, 'file-shape:' + label);
  }
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function isSkippedDependencyDirectory(relativeDirectory, entryName) {
  if (entryName === '.vite') return relativeDirectory === 'node_modules';
  if (entryName !== '.bin') return false;
  return relativeDirectory === 'node_modules'
    || relativeDirectory.endsWith('/node_modules');
}

async function collectRegularEntries(relativeDirectory, options = {}) {
  const absoluteDirectory = repositoryPath(relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    fail(EXIT_HASH, 'directory-read:' + relativeDirectory, { cause: error });
  }
  const collected = [];
  entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ));
  for (const entry of entries) {
    const childPath = join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) fail(EXIT_HASH, 'tree-symlink:' + childPath);
    if (entry.isDirectory()) {
      if (options.dependencyTree === true
        && isSkippedDependencyDirectory(relativeDirectory, entry.name)) continue;
      collected.push(...await collectRegularEntries(childPath, options));
      continue;
    }
    if (!entry.isFile()) fail(EXIT_HASH, 'tree-non-file:' + childPath);
    const identity = await hashRegularFile(repositoryPath(childPath), childPath);
    collected.push([childPath, identity.sha256]);
  }
  return collected;
}

function aggregateEntries(entries) {
  return {
    files: entries.length,
    sha256: sha256(Buffer.from(
      entries.map(([path, hash]) => path + '\0' + hash + '\n').join(''),
    )),
  };
}

async function captureRootConfigurationAbsence() {
  const absent = [];
  for (const relativePath of ROOT_CONFIGURATION_ABSENCE) {
    try {
      await lstat(repositoryPath(relativePath));
      fail(EXIT_HASH, 'root-configuration-present:' + relativePath);
    } catch (error) {
      if (error instanceof SupervisorFailure) throw error;
      if (error?.code !== 'ENOENT') {
        fail(EXIT_HASH, 'root-configuration-lstat:' + relativePath, { cause: error });
      }
      absent.push(relativePath);
    }
  }
  return absent;
}

async function captureIdentity() {
  const files = {};
  for (const relativePath of Object.keys(APPROVED_FILE_HASHES).sort()) {
    files[relativePath] = await hashRegularFile(repositoryPath(relativePath), relativePath);
  }
  files[SUPERVISOR_FILE] = await hashRegularFile(
    repositoryPath(SUPERVISOR_FILE),
    SUPERVISOR_FILE,
  );
  const source = aggregateEntries(await collectRegularEntries('src'));
  const nodeModules = aggregateEntries(await collectRegularEntries(
    'node_modules',
    { dependencyTree: true },
  ));
  const tools = {};
  for (const [name, approved] of Object.entries(APPROVED_TOOLS)) {
    tools[name] = {
      path: approved.path,
      ...await hashRegularFile(approved.path, 'tool:' + name),
    };
  }
  return {
    files,
    nodeModules,
    rootConfigurationAbsent: await captureRootConfigurationAbsence(),
    source,
    tools,
  };
}

function validateApprovedIdentity(identity) {
  for (const [relativePath, expectedHash] of Object.entries(APPROVED_FILE_HASHES)) {
    if (identity.files[relativePath]?.sha256 !== expectedHash) {
      fail(
        EXIT_HASH,
        'approved-hash:' + relativePath + ':' + String(identity.files[relativePath]?.sha256)
          + ':expected:' + expectedHash,
      );
    }
  }
  if (identity.source.files !== APPROVED_SOURCE.files
    || identity.source.sha256 !== APPROVED_SOURCE.sha256) {
    fail(EXIT_HASH, 'approved-source:' + identity.source.files + ':' + identity.source.sha256);
  }
  if (identity.nodeModules.files !== APPROVED_NODE_MODULES.files
    || identity.nodeModules.sha256 !== APPROVED_NODE_MODULES.sha256) {
    fail(
      EXIT_HASH,
      'approved-node-modules:' + identity.nodeModules.files + ':'
        + identity.nodeModules.sha256,
    );
  }
  if (!exactStringArray(identity.rootConfigurationAbsent, ROOT_CONFIGURATION_ABSENCE)) {
    fail(EXIT_HASH, 'approved-root-configuration-absence');
  }
  for (const [name, approved] of Object.entries(APPROVED_TOOLS)) {
    const actual = identity.tools[name];
    if (actual?.path !== approved.path || actual.sha256 !== approved.sha256) {
      fail(EXIT_HASH, 'approved-tool:' + name + ':' + String(actual?.sha256));
    }
  }
}

function validateSupervisorProcess() {
  if (process.platform !== 'darwin'
    || typeof process.getuid !== 'function'
    || typeof process.getgid !== 'function'
    || typeof process.kill !== 'function') {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-host-not-posix-darwin');
  }
  if (process.version !== NODE_VERSION) {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-node-version:' + process.version);
  }
  let executable;
  let argvZero;
  let entry;
  try {
    executable = realpathSync(process.execPath);
    argvZero = realpathSync(process.argv0);
    entry = realpathSync(process.argv[1]);
  } catch (error) {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-realpath', { cause: error });
  }
  if (executable !== NODE_EXECUTABLE || argvZero !== NODE_EXECUTABLE) {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-executable:' + executable + ':' + argvZero);
  }
  if (entry !== repositoryPath(SUPERVISOR_FILE)) {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-entry:' + entry);
  }
  if (process.execArgv.length !== 0) {
    fail(EXIT_INFRASTRUCTURE, 'supervisor-exec-argv:' + JSON.stringify(process.execArgv));
  }
  if (process.argv.length !== 2) {
    fail(EXIT_INFRASTRUCTURE, 'usage: node test/r07-r10-green-v2-supervisor.mjs');
  }
  const rejectedEnvironmentKeys = Object.keys(process.env).filter((key) => (
    /^(?:BUN_OPTIONS|LD_PRELOAD|NODE_OPTIONS|NODE_PATH|NODE_V8_COVERAGE)$/iu.test(key)
    || /^DYLD_/u.test(key)
    || /(?:PRELOAD|LOADER)/iu.test(key)
  ));
  if (rejectedEnvironmentKeys.length !== 0) {
    fail(
      EXIT_INFRASTRUCTURE,
      'supervisor-injection-environment:' + JSON.stringify(rejectedEnvironmentKeys.sort()),
    );
  }
  return {
    argv: [argvZero, entry],
    execArgv: [],
    execPath: executable,
    gid: process.getgid(),
    platform: process.platform,
    uid: process.getuid(),
    version: process.version,
  };
}

async function assertOwnedDirectory(path, expectedParent) {
  let information;
  let resolvedPath;
  try {
    information = await lstat(path);
    resolvedPath = await realpath(path);
  } catch (error) {
    fail(EXIT_INFRASTRUCTURE, 'temporary-directory-read:' + path, { cause: error });
  }
  if (!information.isDirectory()
    || information.isSymbolicLink()
    || resolvedPath !== path
    || information.uid !== process.getuid()
    || (information.mode & 0o777) !== 0o700
    || dirname(path) !== expectedParent) {
    fail(EXIT_INFRASTRUCTURE, 'temporary-directory-shape:' + path);
  }
}

async function assertEmptyDirectory(path) {
  let entries;
  try {
    entries = await readdir(path);
  } catch (error) {
    fail(EXIT_INFRASTRUCTURE, 'temporary-directory-list:' + path, { cause: error });
  }
  if (entries.length !== 0) fail(EXIT_INFRASTRUCTURE, 'temporary-directory-not-empty:' + path);
}

async function assertAbsent(path, label) {
  try {
    await lstat(path);
    fail(EXIT_INFRASTRUCTURE, 'unexpected-file:' + label);
  } catch (error) {
    if (error instanceof SupervisorFailure) throw error;
    if (error?.code !== 'ENOENT') {
      fail(EXIT_INFRASTRUCTURE, 'absence-check:' + label, { cause: error });
    }
  }
}

async function createOwnedTemporary() {
  const parent = '/private/tmp';
  let root;
  let temporary;
  try {
    root = await mkdtemp(join(parent, 'rezo-r07-r10-green-v2.'));
    temporary = {
      bunValidatorReport: join(root, 'reports', 'bun-validator.xml'),
      home: join(root, 'home'),
      nodeValidatorReport: join(root, 'reports', 'node-validator.json'),
      reports: join(root, 'reports'),
      root,
      xdg: join(root, 'xdg'),
    };
    // Publish the freshly-created path before the next await. A fatal handler
    // can then identify the exact owned candidate while setup drains through
    // the in-flight-stage barrier.
    executionState.temporary = temporary;
    await chmod(root, 0o700);
  } catch (error) {
    fail(EXIT_INFRASTRUCTURE, 'temporary-create', { cause: error });
  }
  await assertOwnedDirectory(root, parent);
  for (const path of [temporary.home, temporary.reports, temporary.xdg]) {
    try {
      await mkdir(path, { mode: 0o700 });
      await chmod(path, 0o700);
    } catch (error) {
      fail(EXIT_INFRASTRUCTURE, 'temporary-subdirectory:' + path, { cause: error });
    }
    await assertOwnedDirectory(path, root);
    await assertEmptyDirectory(path);
  }
  await assertAbsent(temporary.nodeValidatorReport, 'node-validator-report-before');
  await assertAbsent(temporary.bunValidatorReport, 'bun-validator-report-before');
  return temporary;
}

function sanitizedChildEnvironment(temporary) {
  return Object.freeze({
    HOME: temporary.home,
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    PATH: '/usr/bin:/bin',
    TERM: 'dumb',
    TMPDIR: temporary.root,
    TZ: 'UTC',
    XDG_CONFIG_HOME: temporary.xdg,
  });
}

function buildChildren(temporary) {
  return Object.freeze([
    Object.freeze({
      args: Object.freeze([
        VITEST_ENTRY, ...COMMON_VITEST_ARGUMENTS, '--reporter=verbose',
        resolve(REPOSITORY_ROOT, R07_FILE), resolve(REPOSITORY_ROOT, R10_FILE),
      ]),
      executable: NODE_EXECUTABLE,
      kind: 'integration',
      name: 'node-integration',
      runtime: 'node',
      runtimeVersion: NODE_VERSION,
      timeoutMilliseconds: INTEGRATION_TIMEOUT_MILLISECONDS,
    }),
    Object.freeze({
      args: Object.freeze([
        'test', '--timeout=30000', '--max-concurrency=1', '--retry=0',
        './' + R07_FILE, './' + R10_FILE,
      ]),
      executable: BUN_EXECUTABLE,
      kind: 'integration',
      name: 'bun-integration',
      runtime: 'bun',
      runtimeVersion: BUN_VERSION,
      timeoutMilliseconds: INTEGRATION_TIMEOUT_MILLISECONDS,
    }),
    Object.freeze({
      args: Object.freeze([
        VITEST_ENTRY, ...COMMON_VITEST_ARGUMENTS, '--reporter=json',
        '--outputFile=' + temporary.nodeValidatorReport,
        resolve(REPOSITORY_ROOT, VALIDATOR_FILE),
      ]),
      executable: NODE_EXECUTABLE,
      kind: 'validator-json',
      name: 'node-validator',
      reportPath: temporary.nodeValidatorReport,
      runtime: 'node',
      runtimeVersion: NODE_VERSION,
      timeoutMilliseconds: VALIDATOR_TIMEOUT_MILLISECONDS,
    }),
    Object.freeze({
      args: Object.freeze([
        'test', '--timeout=30000', '--max-concurrency=1', '--retry=0',
        '--reporter=junit', '--reporter-outfile=' + temporary.bunValidatorReport,
        './' + VALIDATOR_FILE,
      ]),
      executable: BUN_EXECUTABLE,
      kind: 'validator-junit',
      name: 'bun-validator',
      reportPath: temporary.bunValidatorReport,
      runtime: 'bun',
      runtimeVersion: BUN_VERSION,
      timeoutMilliseconds: VALIDATOR_TIMEOUT_MILLISECONDS,
    }),
  ]);
}

function probeToolVersions(environment) {
  const observed = {};
  for (const [name, approved] of Object.entries(APPROVED_TOOLS)) {
    const result = spawnSync(approved.path, ['--version'], {
      cwd: REPOSITORY_ROOT,
      encoding: null,
      env: environment,
      input: Buffer.alloc(0),
      killSignal: 'SIGKILL',
      maxBuffer: REPORT_LIMIT_BYTES,
      shell: false,
      timeout: VERSION_TIMEOUT_MILLISECONDS,
      windowsHide: true,
    });
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
    const expected = Buffer.from(approved.version + '\n');
    if (result.error !== undefined
      || result.status !== 0
      || result.signal !== null
      || stderr.length !== 0
      || !stdout.equals(expected)) {
      fail(EXIT_INFRASTRUCTURE, 'version-probe:' + name + ':' + JSON.stringify({
        error: result.error === undefined ? null : String(result.error),
        signal: result.signal,
        status: result.status,
        stderrBytes: stderr.length,
        stderrSha256: sha256(stderr),
        stdoutBytes: stdout.length,
        stdoutSha256: sha256(stdout),
      }));
    }
    observed[name] = {
      executable: approved.path,
      stderrBytes: 0,
      stdoutBytes: stdout.length,
      stdoutSha256: sha256(stdout),
      version: approved.version,
    };
  }
  return observed;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function beginInFlightStage(label) {
  if (executionState.inFlightStage !== null) {
    fail(EXIT_INFRASTRUCTURE, 'in-flight-stage-overlap:' + label);
  }
  let resolveCompletion;
  const completion = new Promise((resolveStage) => { resolveCompletion = resolveStage; });
  const stage = {
    completion,
    label,
    resolveCompletion,
    settled: false,
  };
  executionState.inFlightStage = stage;
  return stage;
}

function completeInFlightStage(stage) {
  if (stage.settled) return;
  stage.settled = true;
  if (executionState.inFlightStage === stage) executionState.inFlightStage = null;
  stage.resolveCompletion();
}

async function awaitInFlightStage() {
  const stage = executionState.inFlightStage;
  if (stage === null) return { kind: 'none' };
  const completed = await Promise.race([
    stage.completion.then(() => true),
    delay(FAILURE_STAGE_TIMEOUT_MILLISECONDS).then(() => false),
  ]);
  return {
    kind: completed ? 'completed' : 'timeout',
    label: stage.label,
  };
}

function signalProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { kind: 'failure', message: 'invalid-pid', signal };
  }
  try {
    process.kill(-pid, signal);
    return { kind: 'signaled', signal };
  } catch (error) {
    if (error?.code === 'ESRCH') return { kind: 'absent', signal };
    return {
      code: typeof error?.code === 'string' ? error.code : null,
      kind: 'failure',
      message: boundedReason(error),
      signal,
    };
  }
}

async function pollProcessGroupAbsent(pid) {
  const started = Date.now();
  let attempts = 0;
  while (Date.now() - started <= GROUP_POLL_MILLISECONDS) {
    attempts += 1;
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return { attempts, elapsedMilliseconds: Date.now() - started, kind: 'absent' };
      }
      return {
        attempts,
        code: typeof error?.code === 'string' ? error.code : null,
        elapsedMilliseconds: Date.now() - started,
        kind: 'failure',
        message: boundedReason(error),
      };
    }
    await delay(GROUP_POLL_INTERVAL_MILLISECONDS);
  }
  return { attempts, elapsedMilliseconds: Date.now() - started, kind: 'present' };
}

function createTerminationOwnership(child, spec) {
  let resolveCloseObserved;
  const closeObserved = new Promise((resolveClose) => {
    resolveCloseObserved = resolveClose;
  });
  return {
    child,
    closeObserved,
    closeRecord: null,
    groupState: 'owned',
    leaderState: 'owned',
    name: spec.name,
    operations: [],
    pid: child.pid,
    queue: Promise.resolve(),
    resolveCloseObserved,
    terminationPromise: null,
  };
}

async function withTerminationOwnership(ownership, operation) {
  const previous = ownership.queue;
  let release;
  ownership.queue = new Promise((resolveQueue) => { release = resolveQueue; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function recordOwnershipOperation(ownership, operation, result) {
  const record = { operation, result };
  ownership.operations.push(record);
  return result;
}

async function probeOwnedProcessGroup(ownership, operation) {
  return withTerminationOwnership(ownership, async () => {
    if (ownership.groupState === 'absent') {
      return recordOwnershipOperation(ownership, operation, {
        kind: 'absent-cached',
      });
    }
    const result = await pollProcessGroupAbsent(ownership.pid);
    if (result.kind === 'absent') ownership.groupState = 'absent';
    else if (ownership.leaderState !== 'owned') {
      ownership.groupState = 'present-after-leader-loss';
    }
    return recordOwnershipOperation(ownership, operation, result);
  });
}

async function signalOwnedProcessGroup(ownership, signal, operation) {
  return withTerminationOwnership(ownership, async () => {
    if (ownership.groupState === 'absent') {
      return recordOwnershipOperation(ownership, operation, {
        kind: 'not-sent',
        reason: 'group-already-absent',
        signal,
      });
    }
    if (ownership.leaderState !== 'owned'
      || ownership.child.exitCode !== null
      || ownership.child.signalCode !== null) {
      ownership.leaderState = 'lost';
      return recordOwnershipOperation(ownership, operation, {
        kind: 'not-sent',
        reason: 'child-process-leader-ownership-lost',
        signal,
      });
    }
    const result = signalProcessGroup(ownership.pid, signal);
    if (result.kind === 'absent') ownership.groupState = 'absent';
    return recordOwnershipOperation(ownership, operation, result);
  });
}

function requestOwnedTermination(ownership, reason) {
  if (ownership.terminationPromise !== null) return ownership.terminationPromise;
  ownership.terminationPromise = (async () => {
    const term = await signalOwnedProcessGroup(
      ownership,
      'SIGTERM',
      'termination:' + reason + ':term',
    );
    if (term.kind !== 'absent' && term.kind !== 'absent-cached') {
      await delay(TERMINATION_GRACE_MILLISECONDS);
    }
    const kill = await signalOwnedProcessGroup(
      ownership,
      'SIGKILL',
      'termination:' + reason + ':kill',
    );
    const groupPoll = await probeOwnedProcessGroup(
      ownership,
      'termination:' + reason + ':group-poll',
    );
    return { groupPoll, kill, reason, term };
  })();
  return ownership.terminationPromise;
}

function serializeTerminationOwnership(ownership) {
  if (ownership === null) return null;
  return {
    closeRecord: ownership.closeRecord,
    groupState: ownership.groupState,
    leaderState: ownership.leaderState,
    operations: ownership.operations,
    pid: ownership.pid,
  };
}

function createFailureStreamCapture() {
  return {
    exactChunks: [],
    head: Buffer.alloc(0),
    tail: Buffer.alloc(0),
    totalBytes: 0,
  };
}

function updateFailureStreamCapture(capture, bytes) {
  const halfLimit = Math.floor(FAILURE_STREAM_ARTIFACT_BYTES / 2);
  capture.totalBytes += bytes.length;
  if (capture.exactChunks !== null) {
    if (capture.totalBytes <= FAILURE_STREAM_ARTIFACT_BYTES) {
      capture.exactChunks.push(bytes);
    } else {
      capture.exactChunks = null;
    }
  }
  if (capture.head.length < halfLimit) {
    const needed = halfLimit - capture.head.length;
    capture.head = Buffer.concat([capture.head, bytes.subarray(0, needed)]);
  }
  const combinedTail = Buffer.concat([capture.tail, bytes]);
  capture.tail = combinedTail.length <= halfLimit
    ? combinedTail
    : combinedTail.subarray(combinedTail.length - halfLimit);
}

function finalizeFailureStreamCapture(capture, digest) {
  const common = { bytes: capture.totalBytes, sha256: digest };
  if (capture.exactChunks !== null) {
    const exact = Buffer.concat(capture.exactChunks);
    try {
      return {
        ...common,
        text: new TextDecoder('utf-8', { fatal: true }).decode(exact),
        truncated: false,
      };
    } catch {
      return {
        ...common,
        data: exact.toString('base64'),
        encoding: 'base64',
        truncated: false,
      };
    }
  }
  return {
    ...common,
    encoding: 'base64',
    head: capture.head.toString('base64'),
    tail: capture.tail.toString('base64'),
    truncated: true,
  };
}

function runChild(spec, environment) {
  return new Promise((resolveRun) => {
    let child = null;
    let closeRecord = null;
    let completed = false;
    let finalizing = false;
    let infrastructureReason = null;
    let launchError = null;
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let terminating = false;
    let watchdogTimer;
    let ownership = null;
    const stderrChunks = [];
    const stderrFailureCapture = createFailureStreamCapture();
    const stdoutChunks = [];
    const stdoutFailureCapture = createFailureStreamCapture();
    const stderrHasher = createHash('sha256');
    const stdoutHasher = createHash('sha256');
    const lifecycle = {
      groupPoll: null,
      ownership: null,
      postCloseSignal: null,
      termination: null,
    };

    const finish = async (drained) => {
      if (completed || finalizing) return;
      finalizing = true;
      clearTimeout(watchdogTimer);
      if (ownership !== null) {
        lifecycle.postCloseSignal = {
          kind: 'not-sent',
          reason: 'natural-group-absence-required-after-close',
        };
        lifecycle.groupPoll = await probeOwnedProcessGroup(
          ownership,
          'post-close-natural-group-poll',
        );
        if (!['absent', 'absent-cached'].includes(lifecycle.groupPoll.kind)) {
          infrastructureReason ??= 'process-group-not-naturally-absent:' + spec.name;
        }
        lifecycle.ownership = serializeTerminationOwnership(ownership);
      }
      if (executionState.activeChild?.ownership === ownership
        && ['absent', 'absent-cached'].includes(lifecycle.groupPoll?.kind)) {
        executionState.activeChild = null;
      }
      try { child?.unref(); } catch { /* Evidence below is authoritative. */ }
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrDigest = stderrHasher.digest('hex');
      const stdoutDigest = stdoutHasher.digest('hex');
      let stderrText;
      let stdoutText;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        stderrText = decoder.decode(stderrBuffer);
        stdoutText = decoder.decode(stdoutBuffer);
      } catch {
        infrastructureReason ??= 'child-output-invalid-utf8:' + spec.name;
        stderrText = stderrBuffer.toString('utf8');
        stdoutText = stdoutBuffer.toString('utf8');
      }
      completed = true;
      resolveRun({
        args: [...spec.args],
        closeRecord,
        command: spec.executable,
        drained,
        infrastructureReason,
        lifecycle,
        name: spec.name,
        pid: child?.pid ?? null,
        runtime: spec.runtime,
        stderr: stderrText,
        stderrBytes,
        stderrFailureArtifact: finalizeFailureStreamCapture(
          stderrFailureCapture,
          stderrDigest,
        ),
        stderrSha256: stderrDigest,
        stdout: stdoutText,
        stdoutBytes,
        stdoutFailureArtifact: finalizeFailureStreamCapture(
          stdoutFailureCapture,
          stdoutDigest,
        ),
        stdoutSha256: stdoutDigest,
      });
    };

    const terminate = async (reason) => {
      if (completed || terminating) return;
      terminating = true;
      infrastructureReason ??= reason;
      lifecycle.termination = ownership === null
        ? { kind: 'no-ownership', reason }
        : await requestOwnedTermination(ownership, reason);
      await delay(TERMINATION_GRACE_MILLISECONDS);
      if (!completed) {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        await finish(false);
      }
    };

    watchdogTimer = setTimeout(
      () => { void terminate('child-timeout:' + spec.name); },
      spec.timeoutMilliseconds,
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
      infrastructureReason = 'spawn-threw:' + spec.name + ':' + boundedReason(error);
      void finish(true);
      return;
    }
    ownership = createTerminationOwnership(child, spec);
    executionState.activeChild = { child, name: spec.name, ownership, pid: child.pid };

    const capture = (stream, chunk) => {
      const bytes = Buffer.from(chunk);
      if (stream === 'stdout') {
        stdoutHasher.update(bytes);
        updateFailureStreamCapture(stdoutFailureCapture, bytes);
        stdoutBytes += bytes.length;
        if (stdoutBytes <= OUTPUT_LIMIT_BYTES) stdoutChunks.push(bytes);
      } else {
        stderrHasher.update(bytes);
        updateFailureStreamCapture(stderrFailureCapture, bytes);
        stderrBytes += bytes.length;
        if (stderrBytes <= OUTPUT_LIMIT_BYTES) stderrChunks.push(bytes);
      }
      if (stdoutBytes > OUTPUT_LIMIT_BYTES || stderrBytes > OUTPUT_LIMIT_BYTES) {
        void terminate('child-output-limit:' + spec.name);
      }
    };
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    child.stdout.on('error', (error) => {
      void terminate('stdout-pipe:' + spec.name + ':' + boundedReason(error));
    });
    child.stderr.on('error', (error) => {
      void terminate('stderr-pipe:' + spec.name + ':' + boundedReason(error));
    });
    child.once('error', (error) => { launchError = error; });
    child.once('close', (code, signal) => {
      closeRecord = launchError === null
        ? { code, kind: 'close', signal }
        : { code, kind: 'launch', message: boundedReason(launchError), signal };
      ownership.closeRecord = closeRecord;
      ownership.leaderState = 'lost';
      ownership.resolveCloseObserved(closeRecord);
      if (launchError !== null) infrastructureReason ??= 'launch-error:' + spec.name;
      void finish(true);
    });
  });
}

function rawChildSummary(run, spec) {
  return {
    args: run.args,
    command: run.command,
    drained: run.drained,
    evidence: null,
    infrastructureReason: run.infrastructureReason,
    kind: spec.kind,
    lifecycle: run.lifecycle,
    name: spec.name,
    outcome: run.closeRecord,
    pid: run.pid,
    runtime: spec.runtime,
    runtimeVersion: spec.runtimeVersion,
    stderrBytes: run.stderrBytes,
    stderrSha256: run.stderrSha256,
    stdoutBytes: run.stdoutBytes,
    stdoutSha256: run.stdoutSha256,
    timeoutMilliseconds: spec.timeoutMilliseconds,
  };
}

function boundedTextArtifact(value, limitBytes) {
  const bytes = Buffer.from(value);
  const common = { bytes: bytes.length, sha256: sha256(bytes) };
  if (bytes.length <= limitBytes) {
    return { ...common, text: value, truncated: false };
  }
  const sliceBytes = Math.floor(limitBytes / 2);
  return {
    ...common,
    encoding: 'base64',
    head: bytes.subarray(0, sliceBytes).toString('base64'),
    tail: bytes.subarray(bytes.length - sliceBytes).toString('base64'),
    truncated: true,
  };
}

function boundedParsedArtifact(kind, value) {
  const serialized = JSON.stringify(value);
  const bytes = Buffer.from(serialized);
  const common = { bytes: bytes.length, kind, sha256: sha256(bytes) };
  if (bytes.length <= FAILURE_PARSED_ARTIFACT_BYTES) {
    return { ...common, parsed: value, truncated: false };
  }
  const sliceBytes = Math.floor(FAILURE_PARSED_ARTIFACT_BYTES / 4);
  return {
    ...common,
    encoding: 'base64-json-fragments',
    head: bytes.subarray(0, sliceBytes).toString('base64'),
    tail: bytes.subarray(bytes.length - sliceBytes).toString('base64'),
    truncated: true,
  };
}

function stageFailureRun(run, spec) {
  executionState.failureEvidence = {
    child: {
      name: spec.name,
      outcome: run.closeRecord,
      runtime: spec.runtime,
      stderr: run.stderrFailureArtifact,
      stdout: run.stdoutFailureArtifact,
    },
    parseContext: { stage: 'raw-child-captured' },
    primaryArtifact: null,
    reportArtifact: null,
    secondaryArtifact: null,
  };
}

function stageFailureParseContext(stage, details = {}) {
  if (executionState.failureEvidence === null) return;
  executionState.failureEvidence.parseContext = { ...details, stage };
}

function stageFailureParsedArtifact(slot, kind, value) {
  if (executionState.failureEvidence === null) return;
  executionState.failureEvidence[slot] = boundedParsedArtifact(kind, value);
}

function stageFailureReport(spec, report) {
  if (executionState.failureEvidence === null) return;
  executionState.failureEvidence.reportArtifact = {
    kind: spec.kind,
    path: spec.reportPath,
    report: boundedTextArtifact(report.text, REPORT_LIMIT_BYTES),
  };
}

function stageFailureRawReport(spec, report) {
  if (executionState.failureEvidence === null) return;
  executionState.failureEvidence.reportArtifact = {
    kind: spec.kind,
    path: spec.reportPath,
    report: {
      bytes: report.bytes.length,
      data: report.bytes.toString('base64'),
      encoding: 'base64',
      sha256: report.sha256,
      truncated: false,
    },
  };
}

function validateRawResult(run) {
  const combined = run.stdout + '\n' + run.stderr;
  if (combined.includes(SUPERVISOR_PREFIX) || combined.includes(FAILURE_PREFIX)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'supervisor-sentinel-in-child:' + run.name);
  }
  if (run.infrastructureReason !== null) fail(EXIT_INFRASTRUCTURE, run.infrastructureReason);
  if (run.closeRecord?.kind !== 'close') {
    fail(EXIT_INFRASTRUCTURE, 'raw-launch:' + run.name + ':' + JSON.stringify(run.closeRecord));
  }
  if (run.closeRecord.signal !== null) {
    fail(EXIT_INFRASTRUCTURE, 'raw-signal:' + run.name + ':' + run.closeRecord.signal);
  }
  if (run.closeRecord.code !== 0) {
    fail(EXIT_RUNNER_OR_LEDGER, 'raw-exit:' + run.name + ':' + run.closeRecord.code);
  }
  if (!run.drained
    || !Number.isSafeInteger(run.pid)
    || run.pid <= 0
    || Buffer.byteLength(run.stdout) !== run.stdoutBytes
    || Buffer.byteLength(run.stderr) !== run.stderrBytes
    || run.lifecycle?.groupPoll?.kind !== 'absent'
    || run.lifecycle?.postCloseSignal?.kind !== 'not-sent'
    || run.lifecycle?.ownership?.groupState !== 'absent'
    || run.lifecycle?.ownership?.leaderState !== 'lost') {
    fail(EXIT_INFRASTRUCTURE, 'raw-capture-or-lifecycle:' + run.name);
  }
  if (run.stderrBytes !== 0) fail(EXIT_RUNNER_OR_LEDGER, 'raw-stderr:' + run.name);
}

function extractLedger(stdout, prefix, childName) {
  if (stdout.split(prefix).length !== 2) {
    fail(EXIT_RUNNER_OR_LEDGER, 'ledger-prefix-count:' + childName + ':' + prefix);
  }
  const lines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) {
    fail(EXIT_RUNNER_OR_LEDGER, 'ledger-line-count:' + childName + ':' + prefix);
  }
  try {
    return JSON.parse(lines[0].slice(prefix.length));
  } catch (error) {
    fail(EXIT_RUNNER_OR_LEDGER, 'ledger-json:' + childName + ':' + prefix, { cause: error });
  }
}

function validateHooks(value, expected = null) {
  if (!exactKeys(value, HOOK_SCHEMA)) return false;
  const tuple = HOOK_SCHEMA.map((key) => value[key]);
  return tuple.every(isNonnegativeInteger)
    && (expected === null || exactArray(tuple, expected));
}

function validateNatural(value, expectedKeys, expectedValues = null) {
  if (!exactKeys(value, expectedKeys)) return false;
  const tuple = expectedKeys.map((key) => value[key]);
  return tuple.every(isNonnegativeInteger)
    && (expectedValues === null || exactArray(tuple, expectedValues));
}

function validateH1Pool(value, phase = 'natural') {
  if (!exactKeys(value, H1_POOL_SCHEMA)
    || !['null', 'ref', 'unref'].includes(value.evictionTimer)
    || !['node', 'opaque'].includes(value.agentShape)
    || !['agents', 'activeSockets', 'freeSockets', 'queuedRequests']
      .every((key) => isNonnegativeInteger(value[key]))) return false;
  if (phase === 'natural') {
    return value.agents === 1
      && value.activeSockets === 0
      && value.queuedRequests === 0
      && value.evictionTimer === 'unref'
      && value.agentShape === 'node';
  }
  return value.agents === 0
    && value.activeSockets === 0
    && value.freeSockets === 0
    && value.queuedRequests === 0
    && value.evictionTimer === 'null'
    && value.agentShape === 'node';
}

function validateH2Pool(value, phase = 'natural') {
  if (!exactKeys(value, H2_POOL_SCHEMA)
    || !exactKeys(value.states, ['closed', 'retired', 'reusable'])
    || !['null', 'ref', 'unref'].includes(value.cleanupInterval)
    || !['entries', 'leases', 'pending', 'sessions', 'unhealthy']
      .every((key) => isNonnegativeInteger(value[key]))
    || !['closed', 'retired', 'reusable']
      .every((key) => isNonnegativeInteger(value.states[key]))) return false;
  if (phase === 'natural') {
    return value.pending === 0
      && value.leases === 0
      && value.entries === value.sessions
      && value.unhealthy === 0
      && value.states.closed === 0
      && value.states.retired === 0
      && value.states.reusable === value.sessions
      && value.cleanupInterval === 'unref';
  }
  return value.entries === 0
    && value.leases === 0
    && value.pending === 0
    && value.sessions === 0
    && value.unhealthy === 0
    && value.states.closed === 0
    && value.states.retired === 0
    && value.states.reusable === 0
    && value.cleanupInterval === 'null';
}

function validatePoolPair(value, protocol = null) {
  if (!exactKeys(value, ['h1', 'h2'])) return false;
  if (value.h1 !== null && !validateH1Pool(value.h1, 'natural')) return false;
  if (value.h2 !== null && !validateH2Pool(value.h2, 'natural')) return false;
  if (protocol === 'h1' && value.h1 === null) return false;
  if (protocol === 'h2' && value.h2 === null) return false;
  return true;
}

function validateEntryIdentity(value, runtime, identity) {
  if (!exactKeys(value, ['h1', 'h2'])) return false;
  const expected = {
    h1: { adapter: 'http', path: runtime === 'bun' ? BUN_ENTRY_FILE : NODE_ENTRY_FILE },
    h2: { adapter: 'http2', path: H2_ENTRY_FILE },
  };
  for (const key of ['h1', 'h2']) {
    const entry = value[key];
    if (!exactKeys(entry, ['adapter', 'defaultKind', 'factory', 'path', 'sourceSha256'])
      || entry.adapter !== expected[key].adapter
      || entry.defaultKind !== 'function'
      || entry.factory !== 'function'
      || entry.path !== expected[key].path
      || entry.sourceSha256 !== identity.files[entry.path]?.sha256) return false;
  }
  return true;
}

function validateClientPoolLedger(value, legs, kind) {
  const expectedKeys = kind === 'r07'
    ? ['endState', 'forced', 'naturalMax']
    : ['endState', 'forced'];
  if (!exactKeys(value, expectedKeys)
    || !exactKeys(value.endState, ['h1', 'h2'])
    || value.endState.h1 === null
    || value.endState.h2 === null
    || !validateH1Pool(value.endState.h1, 'end')
    || !validateH2Pool(value.endState.h2, 'end')
    || !exactKeys(value.forced, ['h1After', 'h1Before', 'h2After', 'h2Before'])
    || value.forced.h1Before === null
    || value.forced.h2Before === null
    || !validateH1Pool(value.forced.h1Before, 'natural')
    || !validateH2Pool(value.forced.h2Before, 'natural')
    || !validateH1Pool(value.forced.h1After, 'end')
    || !validateH2Pool(value.forced.h2After, 'end')
    || JSON.stringify(value.endState.h1) !== JSON.stringify(value.forced.h1After)
    || JSON.stringify(value.endState.h2) !== JSON.stringify(value.forced.h2After)) return false;
  if (kind === 'r07') {
    if (!exactKeys(value.naturalMax, ['h1', 'h2'])
      || !exactKeys(value.naturalMax.h1, [
        'activeSockets', 'agents', 'freeSockets', 'queuedRequests',
      ])
      || !exactKeys(value.naturalMax.h2, [
        'entries', 'leases', 'pending', 'sessions', 'unhealthy',
      ])) return false;
    const h1Max = { activeSockets: 0, agents: 0, freeSockets: 0, queuedRequests: 0 };
    const h2Max = { entries: 0, leases: 0, pending: 0, sessions: 0, unhealthy: 0 };
    for (const leg of Object.values(legs)) {
      const pools = leg.clientNaturalAtCaseEnd;
      if (pools.h1 !== null) {
        for (const key of Object.keys(h1Max)) h1Max[key] = Math.max(h1Max[key], pools.h1[key]);
      }
      if (pools.h2 !== null) {
        for (const key of Object.keys(h2Max)) h2Max[key] = Math.max(h2Max[key], pools.h2[key]);
      }
    }
    if (JSON.stringify(value.naturalMax.h1) !== JSON.stringify(h1Max)
      || JSON.stringify(value.naturalMax.h2) !== JSON.stringify(h2Max)) return false;
  }
  return true;
}

function validateCommonLedger(ledger, contract, runtime, runtimeVersion, identity, context) {
  ledgerAssert(exactKeys(ledger, contract.keys), context, 'top-level-keys');
  ledgerAssert(
    ledger.schema === contract.schema
      && ledger.file === contract.file
      && ledger.runtime === runtime
      && ledger.runtimeVersion === runtimeVersion
      && ledger.epoch === 'green-v2',
    context,
    'identity',
  );
  for (const key of contract.emptyArrays) {
    ledgerAssert(exactStringArray(ledger[key], []), context, 'nonempty:' + key);
  }
  ledgerAssert(exactStringArray(ledger.expectedRed, []), context, 'expected-red');
  ledgerAssert(exactStringArray(ledger.red, []), context, 'red');
  ledgerAssert(exactStringArray(ledger.skipped, []), context, 'skipped');
  ledgerAssert(
    exactStringArray(ledger.registered, contract.registered),
    context,
    'registered',
  );
  ledgerAssert(
    exactStringArray(ledger.expectedPassed, contract.registered),
    context,
    'expected-passed',
  );
  ledgerAssert(exactStringArray(ledger.passed, contract.registered), context, 'passed');
  ledgerAssert(
    ledger.expectedLegCount === contract.legKeys.length
      && ledger.legCount === contract.legKeys.length
      && isRecord(ledger.legs)
      && exactStringArray(Object.keys(ledger.legs).sort(), contract.legKeys),
    context,
    'leg-keys',
  );
  ledgerAssert(exactKeys(ledger.registry, ['controls', 'targets']), context, 'registry-keys');
  ledgerAssert(
    exactStringArray(ledger.registry.controls, contract.registry.controls),
    context,
    'registry-controls',
  );
  ledgerAssert(
    exactStringArray(ledger.registry.targets, contract.registry.targets),
    context,
    'registry-targets',
  );
  ledgerAssert(
    exactKeys(ledger.processFaults, ['uncaught', 'unhandled'])
      && ledger.processFaults.uncaught === 0
      && ledger.processFaults.unhandled === 0,
    context,
    'process-faults',
  );
  ledgerAssert(
    validateEntryIdentity(ledger.entryIdentity, runtime, identity),
    context,
    'entry-identity',
  );
}

function validateNullableHashPair(length, hash) {
  return (length === null && hash === null)
    || (isNonnegativeInteger(length) && isSha256(hash));
}

function validateR07Leg(leg, legKey, context) {
  ledgerAssert(exactKeys(leg, R07_LEG_SCHEMA), context, 'leg-schema:' + legKey);
  const protocol = legKey.slice(legKey.indexOf(':') + 1).split('/')[0];
  const modeMatch = legKey.match(/\/(buffered|download|stream|upload)(?:\/|$)/u);
  const expectedMode = modeMatch?.[1] ?? 'buffered';
  ledgerAssert(
    (protocol === 'h1' || protocol === 'h2')
      && leg.protocol === protocol
      && leg.adapter === (protocol === 'h1' ? 'http' : 'http2')
      && leg.mode === expectedMode
      && leg.wireHits === 1,
    context,
    'leg-routing:' + legKey,
  );
  ledgerAssert(
    validateNatural(
      leg.naturalAtCaseEnd,
      ['sessions', 'sockets', 'temporaryDirectories', 'timers'],
      [protocol === 'h2' ? 1 : 0, 1, expectedMode === 'download' ? 1 : 0, 0],
    ),
    context,
    'leg-natural:' + legKey,
  );
  ledgerAssert(
    validatePoolPair(leg.clientNaturalAtCaseEnd, protocol),
    context,
    'leg-client-pools:' + legKey,
  );
  ledgerAssert(validateHooks(leg.hooks), context, 'leg-hooks:' + legKey);
  ledgerAssert(
    validateNullableHashPair(leg.bodyLength, leg.bodySha256)
      && validateNullableHashPair(leg.responseBodyLength, leg.responseBodySha256)
      && validateNullableHashPair(leg.streamLength, leg.streamSha256)
      && isSha256(leg.wireSha256)
      && isNonnegativeInteger(leg.wireLength),
    context,
    'leg-body-facts:' + legKey,
  );
  if (expectedMode === 'download') {
    ledgerAssert(
      exactKeys(leg.fileState, ['exists', 'length', 'sha256Digest'])
        && typeof leg.fileState.exists === 'boolean'
        && isNonnegativeInteger(leg.fileState.length)
        && (leg.fileState.exists
          ? isSha256(leg.fileState.sha256Digest)
          : leg.fileState.length === 0 && leg.fileState.sha256Digest === ''),
      context,
      'leg-file-state:' + legKey,
    );
  } else {
    ledgerAssert(leg.fileState === null, context, 'leg-file-state:' + legKey);
  }
  ledgerAssert(
    Array.isArray(leg.eventSequence)
      && leg.eventSequence.every((event) => typeof event === 'string' && event.length > 0)
      && isNonnegativeInteger(leg.errorEvents)
      && isNonnegativeInteger(leg.progressEvents)
      && isNonnegativeInteger(leg.successEvents)
      && leg.stable === true
      && leg.uncaught === 0
      && leg.unhandled === 0
      && (leg.isFinished === null || typeof leg.isFinished === 'boolean')
      && (leg.encoding === null || typeof leg.encoding === 'string')
      && (leg.informational === null || leg.informational === 103)
      && leg.method === (legKey.includes('/HEAD') ? 'HEAD' : 'GET')
      && isNonnegativeInteger(leg.wireInformationalSent)
      && isNonnegativeInteger(leg.wireStatus)
      && (leg.status === null || isNonnegativeInteger(leg.status))
      && (leg.responseStatus === null || isNonnegativeInteger(leg.responseStatus)),
    context,
    'leg-types:' + legKey,
  );
  ledgerAssert(
    leg.terminal === 'fulfilled' || leg.terminal === 'rejected',
    context,
    'leg-terminal:' + legKey,
  );
  if (leg.terminal === 'fulfilled') {
    ledgerAssert(
      leg.code === null
        && leg.errno === null
        && leg.errorIdentity === null
        && leg.isNetworkError === null
        && leg.isRetryable === null
        && leg.isTimeout === null
        && leg.message === null
        && leg.errorEvents === 0,
      context,
      'leg-fulfilled-facts:' + legKey,
    );
  } else {
    ledgerAssert(
      typeof leg.code === 'string'
        && (typeof leg.errno === 'number' || typeof leg.errno === 'string' || leg.errno === null)
        && typeof leg.message === 'string'
        && typeof leg.isNetworkError === 'boolean'
        && typeof leg.isRetryable === 'boolean'
        && typeof leg.isTimeout === 'boolean'
        && exactKeys(leg.errorIdentity, [
          'causeCode', 'causeName', 'hasCause', 'hasResponse', 'isRezoError', 'name',
        ])
        && typeof leg.errorIdentity.causeCode === 'string'
        && typeof leg.errorIdentity.causeName === 'string'
        && typeof leg.errorIdentity.hasCause === 'boolean'
        && typeof leg.errorIdentity.hasResponse === 'boolean'
        && leg.errorIdentity.isRezoError === true
        && leg.errorIdentity.name === 'RezoError'
        && leg.successEvents === 0,
      context,
      'leg-rejected-facts:' + legKey,
    );
  }
}

function validateR07Ledger(ledger, runtime, runtimeVersion, identity, context) {
  validateCommonLedger(ledger, {
    emptyArrays: [
      'cleanupErrors', 'fixtureErrors', 'fixtureEvents', 'lateEvents',
      'listeners', 'oracleMismatches', 'setupErrors', 'skipped', 'teardownErrors',
    ],
    file: R07_FILE,
    keys: R07_LEDGER_KEYS,
    legKeys: R07_LEG_KEYS,
    registered: R07_REGISTERED,
    registry: R07_REGISTRY,
    schema: 'rezo.r07.integrity.ledger/v2',
  }, runtime, runtimeVersion, identity, context);
  for (const legKey of R07_LEG_KEYS) validateR07Leg(ledger.legs[legKey], legKey, context);
  ledgerAssert(
    exactKeys(ledger.cleanup, ['complete', 'endState', 'forced', 'naturalMax'])
      && ledger.cleanup.complete === true
      && validateNatural(
        ledger.cleanup.endState,
        ['servers', 'sessions', 'sockets', 'temporaryDirectories', 'timers'],
        [0, 0, 0, 0, 0],
      )
      && validateNatural(
        ledger.cleanup.naturalMax,
        ['sessions', 'sockets', 'temporaryDirectories', 'timers'],
        [1, 1, 1, 0],
      )
      && exactKeys(ledger.cleanup.forced, [
        'serversClosed', 'sessionsDestroyed', 'socketsClosedWithSessions',
        'socketsDestroyed', 'temporaryDirectoriesRemoved', 'timersCleared',
      ]),
    context,
    'cleanup-schema',
  );
  const forced = ledger.cleanup.forced;
  ledgerAssert(
    forced.serversClosed === 107
      && forced.sessionsDestroyed === 47
      && forced.temporaryDirectoriesRemoved === 14
      && forced.timersCleared === 0
      && forced.socketsDestroyed + forced.socketsClosedWithSessions === 107
      && (runtime !== 'node'
        || (forced.socketsDestroyed === 60 && forced.socketsClosedWithSessions === 47))
      && (runtime !== 'bun'
        || (forced.socketsDestroyed === 107 && forced.socketsClosedWithSessions === 0)),
    context,
    'cleanup-facts-pass6-refreeze',
  );
  ledgerAssert(
    validateClientPoolLedger(ledger.clientPools, ledger.legs, 'r07'),
    context,
    'client-pools',
  );
}

function validateErrorFields(value, expected = null) {
  if (!exactKeys(value, ERROR_FIELDS_SCHEMA)
    || typeof value.code !== 'string'
    || !(typeof value.errno === 'number' || typeof value.errno === 'string' || value.errno === null)
    || typeof value.hasCause !== 'boolean'
    || typeof value.hasResponse !== 'boolean'
    || typeof value.isNetworkError !== 'boolean'
    || typeof value.isRetryable !== 'boolean'
    || value.isRezoError !== true
    || typeof value.isTimeout !== 'boolean'
    || typeof value.message !== 'string'
    || value.name !== 'RezoError') return false;
  if (expected === null) return true;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function validateR10Natural(value, legKey) {
  return validateNatural(
    value,
    ['servers', 'sessions', 'sockets', 'timers'],
    R10_NATURAL_BY_LEG[legKey],
  );
}

function validateR10StreamLeg(leg, legKey, runtime, context) {
  const fact = R10_STREAM_FACTS[legKey];
  ledgerAssert(fact !== undefined, context, 'stream-fact-unfrozen:' + legKey);
  ledgerAssert(exactKeys(leg, R10_STREAM_LEG_SCHEMA), context, 'stream-schema:' + legKey);
  const protocol = legKey.split(':')[1];
  ledgerAssert(
    leg.protocol === protocol
      && leg.adapter === (protocol === 'h1' ? 'http' : 'http2')
      && leg.runtime === runtime
      && leg.wireHits === 1
      && validateR10Natural(leg.naturalAtCaseEnd, legKey)
      && validatePoolPair(leg.clientNaturalAtCaseEnd, protocol),
    context,
    'stream-routing-resources:' + legKey,
  );
  ledgerAssert(
    leg.bytes === fact.bytes
      && leg.bodyExact === fact.bodyExact
      && leg.bodyIsPrefix === true
      && leg.bodySha256 === fact.bodySha256
      && leg.dataAfterTerminal === 0
      && leg.endEvents === fact.endEvents
      && leg.isFinished === fact.isFinished
      && leg.lateContradiction === false
      && exactArray(leg.statusEvents, [200])
      && exactArray(leg.successOrder, fact.successOrder)
      && exactArray(leg.terminalSequence, fact.sequence)
      && validateHooks(leg.hooks, fact.hooks),
    context,
    'stream-settlement-facts-pass6-refreeze:' + legKey,
  );
  if (fact.code === null) {
    ledgerAssert(
      exactStringArray(leg.errorCodes, []) && exactArray(leg.errors, []),
      context,
      'stream-success-errors:' + legKey,
    );
    return;
  }
  ledgerAssert(
    exactStringArray(leg.errorCodes, [fact.code])
      && Array.isArray(leg.errors)
      && leg.errors.length === 1,
    context,
    'stream-error-cardinality:' + legKey,
  );
  const expected = fact.code === 'REZ_DECOMPRESSION_ERROR'
    ? {
        code: fact.code,
        errno: -1029,
        isNetworkError: false,
        isRetryable: false,
        isTimeout: false,
        message: 'Decompression failed',
      }
    : {
        code: fact.code,
        errno: -104,
        hasCause: true,
        isNetworkError: true,
        isRetryable: true,
        isTimeout: false,
        message: protocol === 'h2'
          ? 'HTTP/2 stream ended before the declared content-length was delivered (received 4 of 1000 bytes)'
          : runtime === 'bun'
            ? 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
            : 'aborted',
      };
  ledgerAssert(
    validateErrorFields(leg.errors[0], expected),
    context,
    'stream-error-facts-pass6-refreeze:' + legKey,
  );
}

function validateR10BufferedLeg(leg, legKey, runtime, context) {
  const protocol = legKey.split(':')[1];
  const expectedSchema = legKey.startsWith('ST-06:')
    ? [...R10_BUFFERED_BASE_SCHEMA, 'status']
    : R10_BUFFERED_BASE_SCHEMA;
  ledgerAssert(exactKeys(leg, expectedSchema), context, 'buffered-schema:' + legKey);
  ledgerAssert(
    leg.protocol === protocol
      && leg.adapter === (protocol === 'h1' ? 'http' : 'http2')
      && leg.runtime === runtime
      && leg.wireHits === 1
      && leg.fulfilled === false
      && leg.code === 'ECONNRESET'
      && validateR10Natural(leg.naturalAtCaseEnd, legKey)
      && validatePoolPair(leg.clientNaturalAtCaseEnd, protocol),
    context,
    'buffered-routing-settlement:' + legKey,
  );
  const h2 = protocol === 'h2';
  ledgerAssert(
    validateHooks(leg.hooks, h2 ? [0, 0, 0, 1, 0, 0] : [1, 1, 0, 1, 0, 0])
      && leg.responseStatus === (h2 ? null : 200)
      && leg.responseBodyLength === (h2 ? null : 4)
      && leg.responseBodySha256 === (h2
        ? null
        : '37a680133bd09342f934afb8dd2c7d9e1b624da5f35e3a38adb103e37c055ed1')
      && (h2 ? !Object.hasOwn(leg, 'status') : leg.status === 200),
    context,
    'buffered-response-facts-pass6-refreeze:' + legKey,
  );
  ledgerAssert(
    validateErrorFields(leg.error, {
      code: 'ECONNRESET',
      errno: -104,
      hasCause: h2,
      hasResponse: !h2,
      isNetworkError: true,
      isRetryable: true,
      isTimeout: false,
      message: h2
        ? 'HTTP/2 stream ended before the declared content-length was delivered (received 4 of 1000 bytes)'
        : runtime === 'bun'
          ? 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
          : 'aborted',
    }),
    context,
    'buffered-error-facts-pass6-refreeze:' + legKey,
  );
}

function validateR10Ledger(ledger, runtime, runtimeVersion, identity, context) {
  validateCommonLedger(ledger, {
    emptyArrays: [
      'cleanupErrors', 'fixtureErrors', 'fixtureEvents', 'lateEvents',
      'listeners', 'oracleMismatches', 'setupErrors', 'skipped', 'teardownErrors',
    ],
    file: R10_FILE,
    keys: R10_LEDGER_KEYS,
    legKeys: R10_LEG_KEYS,
    registered: R10_REGISTERED,
    registry: R10_REGISTRY,
    schema: 'rezo.r10.stream-terminal.ledger/v2',
  }, runtime, runtimeVersion, identity, context);
  for (const legKey of R10_LEG_KEYS) {
    if (legKey.includes(':buffered:')) {
      validateR10BufferedLeg(ledger.legs[legKey], legKey, runtime, context);
    } else {
      validateR10StreamLeg(ledger.legs[legKey], legKey, runtime, context);
    }
  }
  ledgerAssert(
    exactKeys(ledger.cleanup, [
      'complete', 'endState', 'forced', 'naturalBeforeTeardown',
    ])
      && ledger.cleanup.complete === true
      && validateNatural(
        ledger.cleanup.endState,
        ['servers', 'sessions', 'sockets', 'timers'],
        [0, 0, 0, 0],
      )
      && validateNatural(
        ledger.cleanup.naturalBeforeTeardown,
        ['servers', 'sessions', 'sockets', 'timers'],
        [9, 4, 9, 0],
      )
      && exactKeys(ledger.cleanup.forced, [
        'serversClosed', 'sessionsDestroyed', 'socketsDestroyed', 'timersCleared',
      ])
      && exactArray([
        ledger.cleanup.forced.serversClosed,
        ledger.cleanup.forced.sessionsDestroyed,
        ledger.cleanup.forced.socketsDestroyed,
        ledger.cleanup.forced.timersCleared,
      ], [9, 4, 9, 0]),
    context,
    'cleanup-facts-pass6-refreeze',
  );
  ledgerAssert(
    validateClientPoolLedger(ledger.clientPools, ledger.legs, 'r10'),
    context,
    'client-pools',
  );
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function validateNodeIntegrationSummary(output) {
  const plain = stripAnsi(output);
  return /Test Files\s+2 passed \(2\)/u.test(plain)
    && /Tests\s+33 passed \(33\)/u.test(plain);
}

function validateBunSummary(output, tests, files) {
  const plain = stripAnsi(output).replace(/\r/gu, '');
  const pass = new RegExp('(?:^|\\n)\\s*' + tests + ' pass(?:ed)?\\s*(?:\\n|$)', 'u');
  const failPattern = /(?:^|\n)\s*0 fail(?:ed)?\s*(?:\n|$)/u;
  const ran = new RegExp(
    'Ran\\s+' + tests + '\\s+tests?\\s+across\\s+' + files + '\\s+files?',
    'u',
  );
  return pass.test(plain) && failPattern.test(plain) && ran.test(plain);
}

function captureIntegrationLedgersBeforeRawValidation(run, spec) {
  stageFailureParseContext('integration-ledger-marker-roster', { child: spec.name });
  try {
    const ledgerMarkers = (run.stdout + '\n' + run.stderr)
      .match(/REZO_[A-Z0-9_]*LEDGER[A-Z0-9_]*:/gu) ?? [];
    if (JSON.stringify([...ledgerMarkers].sort())
      !== JSON.stringify([R07_LEDGER_PREFIX, R10_LEDGER_PREFIX].sort())) {
      fail(
        EXIT_RUNNER_OR_LEDGER,
        'integration-ledger-roster:' + spec.name + ':' + JSON.stringify(ledgerMarkers),
      );
    }
    stageFailureParseContext('integration-extract-r07', { child: spec.name });
    const r07 = extractLedger(run.stdout, R07_LEDGER_PREFIX, spec.name);
    stageFailureParsedArtifact('primaryArtifact', 'parsed-r07-ledger', r07);
    stageFailureParseContext('integration-extract-r10', { child: spec.name });
    const r10 = extractLedger(run.stdout, R10_LEDGER_PREFIX, spec.name);
    stageFailureParsedArtifact('secondaryArtifact', 'parsed-r07-ledger', r07);
    stageFailureParsedArtifact('primaryArtifact', 'parsed-r10-ledger', r10);
    return { kind: 'captured', r07, r10 };
  } catch (error) {
    stageFailureParseContext('integration-ledger-capture-failed-before-raw-validation', {
      child: spec.name,
      reason: boundedReason(error instanceof SupervisorFailure ? error.reason : error),
    });
    return { error, kind: 'failure' };
  }
}

function validateIntegration(run, spec, identity, ledgerCapture) {
  if (ledgerCapture.kind !== 'captured') throw ledgerCapture.error;
  const { r07, r10 } = ledgerCapture;
  stageFailureParseContext('integration-validate-r07', { child: spec.name });
  validateR07Ledger(r07, spec.runtime, spec.runtimeVersion, identity, spec.name + ':r07');
  stageFailureParsedArtifact('secondaryArtifact', 'parsed-r07-ledger', r07);
  stageFailureParsedArtifact('primaryArtifact', 'parsed-r10-ledger', r10);
  stageFailureParseContext('integration-validate-r10', { child: spec.name });
  validateR10Ledger(r10, spec.runtime, spec.runtimeVersion, identity, spec.name + ':r10');
  stageFailureParseContext('integration-validate-runner-summary', { child: spec.name });
  const summaryValid = spec.runtime === 'node'
    ? validateNodeIntegrationSummary(run.stdout)
    : validateBunSummary(run.stdout, 33, 2);
  if (!summaryValid) fail(EXIT_RUNNER_OR_LEDGER, 'integration-summary:' + spec.name);
  return { r07, r10 };
}

function validateUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail(EXIT_RUNNER_OR_LEDGER, 'report-utf8:' + label, { cause: error });
  }
}

async function readOwnedReport(path, label) {
  let before;
  let handle;
  try {
    before = await lstat(path);
  } catch (error) {
    fail(EXIT_RUNNER_OR_LEDGER, 'report-lstat:' + label, { cause: error });
  }
  if (!before.isFile()
    || before.isSymbolicLink()
    || before.uid !== process.getuid()
    || before.nlink !== 1
    || before.size < 1
    || before.size > REPORT_LIMIT_BYTES
    || (before.mode & 0o033) !== 0) {
    fail(EXIT_RUNNER_OR_LEDGER, 'report-shape:' + label);
  }
  try {
    handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    const openedBefore = await handle.stat();
    if (openedBefore.dev !== before.dev
      || openedBefore.ino !== before.ino
      || openedBefore.size !== before.size) {
      fail(EXIT_RUNNER_OR_LEDGER, 'report-race-before:' + label);
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    if (bytes.length !== before.size
      || openedAfter.dev !== before.dev
      || openedAfter.ino !== before.ino
      || openedAfter.size !== before.size) {
      fail(EXIT_RUNNER_OR_LEDGER, 'report-race-after:' + label);
    }
    return { bytes, sha256: sha256(bytes) };
  } catch (error) {
    if (error instanceof SupervisorFailure) throw error;
    fail(EXIT_RUNNER_OR_LEDGER, 'report-read:' + label, { cause: error });
  } finally {
    try { await handle?.close(); } catch { /* Prior evidence remains authoritative. */ }
  }
}

async function captureValidatorReportBeforeRawValidation(spec) {
  stageFailureParseContext('validator-capture-report-before-raw-validation', {
    child: spec.name,
  });
  try {
    const rawReport = await readOwnedReport(spec.reportPath, spec.name);
    stageFailureRawReport(spec, rawReport);
    const report = {
      ...rawReport,
      text: validateUtf8(rawReport.bytes, spec.name),
    };
    stageFailureReport(spec, report);
    stageFailureParseContext('validator-report-captured-before-raw-validation', {
      child: spec.name,
      reportBytes: report.bytes.length,
      reportSha256: report.sha256,
    });
    return { kind: 'captured', report };
  } catch (error) {
    stageFailureParseContext('validator-report-capture-failed-before-raw-validation', {
      child: spec.name,
      reason: boundedReason(error instanceof SupervisorFailure ? error.reason : error),
    });
    return { error, kind: 'failure' };
  }
}

function validateNodeValidatorReport(report, spec, run) {
  let result;
  try {
    result = JSON.parse(report.text);
  } catch (error) {
    fail(EXIT_RUNNER_OR_LEDGER, 'validator-json-parse', { cause: error });
  }
  const topKeys = [
    'numFailedTestSuites', 'numFailedTests', 'numPassedTestSuites',
    'numPassedTests', 'numPendingTestSuites', 'numPendingTests',
    'numTodoTests', 'numTotalTestSuites', 'numTotalTests', 'snapshot',
    'startTime', 'success', 'testResults',
  ];
  const snapshotKeys = [
    'added', 'didUpdate', 'failure', 'filesAdded', 'filesRemoved',
    'filesRemovedList', 'filesUnmatched', 'filesUpdated', 'matched', 'total',
    'unchecked', 'uncheckedKeysByFile', 'unmatched', 'updated',
  ];
  ledgerAssert(exactKeys(result, topKeys), spec.name, 'validator-top-keys');
  ledgerAssert(
    result.numTotalTestSuites === 6
      && result.numPassedTestSuites === 6
      && result.numFailedTestSuites === 0
      && result.numPendingTestSuites === 0
      && result.numTotalTests === 18
      && result.numPassedTests === 18
      && result.numFailedTests === 0
      && result.numPendingTests === 0
      && result.numTodoTests === 0
      && result.success === true
      && isFiniteNonnegative(result.startTime)
      && Array.isArray(result.testResults)
      && result.testResults.length === 1,
    spec.name,
    'validator-counts',
  );
  ledgerAssert(
    exactKeys(result.snapshot, snapshotKeys)
      && result.snapshot.failure === false
      && result.snapshot.didUpdate === false
      && exactArray(result.snapshot.filesRemovedList, [])
      && exactArray(result.snapshot.uncheckedKeysByFile, [])
      && snapshotKeys
        .filter((key) => !['failure', 'didUpdate', 'filesRemovedList', 'uncheckedKeysByFile'].includes(key))
        .every((key) => result.snapshot[key] === 0),
    spec.name,
    'validator-snapshot',
  );
  const file = result.testResults[0];
  ledgerAssert(
    exactKeys(file, ['assertionResults', 'endTime', 'message', 'name', 'startTime', 'status'])
      && file.name === repositoryPath(VALIDATOR_FILE)
      && file.status === 'passed'
      && file.message === ''
      && isFiniteNonnegative(file.startTime)
      && isFiniteNonnegative(file.endTime)
      && file.endTime >= file.startTime
      && Array.isArray(file.assertionResults)
      && file.assertionResults.length === 18,
    spec.name,
    'validator-file',
  );
  const observed = [];
  for (let index = 0; index < VALIDATOR_ROSTER.length; index += 1) {
    const assertion = file.assertionResults[index];
    const expected = VALIDATOR_ROSTER[index];
    ledgerAssert(
      exactKeys(assertion, [
        'ancestorTitles', 'duration', 'failureMessages', 'fullName', 'meta',
        'status', 'tags', 'title',
      ])
        && exactStringArray(assertion.ancestorTitles, [expected.ancestor])
        && assertion.fullName === expected.fullName
        && assertion.title === expected.title
        && assertion.status === 'passed'
        && isFiniteNonnegative(assertion.duration)
        && exactStringArray(assertion.failureMessages, [])
        && exactKeys(assertion.meta, [])
        && exactArray(assertion.tags, []),
      spec.name,
      'validator-assertion:' + index,
    );
    observed.push(assertion.fullName);
  }
  ledgerAssert(new Set(observed).size === 18, spec.name, 'validator-duplicate-title');
  ledgerAssert(
    run.stdout.trim() === 'JSON report written to ' + spec.reportPath,
    spec.name,
    'validator-console',
  );
  return {
    assertions: 31,
    failed: 0,
    file: VALIDATOR_FILE,
    files: 1,
    passed: 18,
    reportBytes: report.bytes.length,
    reportSha256: report.sha256,
    roster: observed,
    tests: 18,
  };
}

function decodeXmlAttribute(value, label) {
  if (/[^\u0020-\u007e]/u.test(value)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-attribute-control:' + label);
  }
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/u.test(value)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-entity:' + label);
  }
  const decoded = value.replace(/&(amp|lt|gt|quot|apos);/gu, (_, entity) => ({
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  })[entity]);
  if (/&(amp|lt|gt|quot|apos);/u.test(decoded)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-double-entity:' + label);
  }
  return decoded;
}

function parseStrictXml(xml) {
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  if (!xml.startsWith(declaration)) fail(EXIT_RUNNER_OR_LEDGER, 'junit-declaration');
  if (/<!--[\s\S]*?-->|<!\[CDATA\[|<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-forbidden-markup');
  }
  let cursor = declaration.length;
  let nodeCount = 0;

  const skipWhitespace = () => {
    while (cursor < xml.length && /[\t\n\r ]/u.test(xml[cursor])) cursor += 1;
  };
  const parseName = () => {
    const match = /^[A-Za-z][A-Za-z0-9-]*/u.exec(xml.slice(cursor));
    if (match === null) fail(EXIT_RUNNER_OR_LEDGER, 'junit-name:' + cursor);
    cursor += match[0].length;
    return match[0];
  };
  const parseNode = (depth) => {
    if (depth > 3 || nodeCount >= 25 || xml[cursor] !== '<') {
      fail(EXIT_RUNNER_OR_LEDGER, 'junit-depth-or-node-count:' + cursor);
    }
    cursor += 1;
    if (xml[cursor] === '/' || xml[cursor] === '!' || xml[cursor] === '?') {
      fail(EXIT_RUNNER_OR_LEDGER, 'junit-opening-tag:' + cursor);
    }
    const name = parseName();
    if (!['testcase', 'testsuite', 'testsuites'].includes(name)) {
      fail(EXIT_RUNNER_OR_LEDGER, 'junit-tag:' + name);
    }
    nodeCount += 1;
    const attributes = [];
    const seen = new Set();
    let selfClosing = false;
    while (true) {
      skipWhitespace();
      if (xml.startsWith('/>', cursor)) {
        cursor += 2;
        selfClosing = true;
        break;
      }
      if (xml[cursor] === '>') {
        cursor += 1;
        break;
      }
      if (attributes.length >= 10) fail(EXIT_RUNNER_OR_LEDGER, 'junit-attribute-count');
      const attributeName = parseName();
      if (seen.has(attributeName)) fail(EXIT_RUNNER_OR_LEDGER, 'junit-duplicate-attribute');
      seen.add(attributeName);
      if (xml[cursor] !== '=') fail(EXIT_RUNNER_OR_LEDGER, 'junit-attribute-equals');
      cursor += 1;
      if (xml[cursor] !== '"') fail(EXIT_RUNNER_OR_LEDGER, 'junit-attribute-quote');
      cursor += 1;
      const end = xml.indexOf('"', cursor);
      if (end < cursor || end - cursor > 512) {
        fail(EXIT_RUNNER_OR_LEDGER, 'junit-attribute-size');
      }
      const attributeValue = decodeXmlAttribute(
        xml.slice(cursor, end),
        name + ':' + attributeName,
      );
      cursor = end + 1;
      attributes.push([attributeName, attributeValue]);
    }
    const children = [];
    if (!selfClosing) {
      while (true) {
        skipWhitespace();
        if (xml.startsWith('</', cursor)) {
          cursor += 2;
          const closingName = parseName();
          if (closingName !== name || xml[cursor] !== '>') {
            fail(EXIT_RUNNER_OR_LEDGER, 'junit-closing-tag:' + name);
          }
          cursor += 1;
          break;
        }
        if (xml[cursor] !== '<') fail(EXIT_RUNNER_OR_LEDGER, 'junit-text:' + cursor);
        children.push(parseNode(depth + 1));
      }
    }
    return { attributes, children, name, selfClosing };
  };

  skipWhitespace();
  const root = parseNode(0);
  skipWhitespace();
  if (cursor !== xml.length || nodeCount !== 25) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-trailing-or-node-count:' + nodeCount);
  }
  return root;
}

function attributesObject(node, expectedOrder, context) {
  const names = node.attributes.map(([name]) => name);
  ledgerAssert(exactArray(names, expectedOrder), context, 'junit-attribute-order');
  return Object.fromEntries(node.attributes);
}

function validateDecimal(value) {
  return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
    && Number.isFinite(Number(value))
    && Number(value) >= 0;
}

function validateBunConsoleRoster(stdout, context) {
  const lines = stripAnsi(stdout).replace(/\r/gu, '').split('\n');
  const passLines = lines.filter((line) => line.startsWith('(pass) '));
  ledgerAssert(passLines.length === 18, context, 'console-pass-count');
  const observed = passLines.map((line) => {
    const match = /^\(pass\) (.+?)(?: \[[0-9]+(?:\.[0-9]+)?(?:ms|s)\])?$/u.exec(line);
    ledgerAssert(match !== null, context, 'console-pass-shape');
    return match[1].replace(' > ', ' ');
  });
  ledgerAssert(
    exactStringArray(observed, VALIDATOR_ROSTER.map((test) => test.fullName)),
    context,
    'console-roster',
  );
  ledgerAssert(validateBunSummary(stdout, 18, 1), context, 'console-summary');
  return observed;
}

function validateBunValidatorReport(report, spec, run) {
  if (report.bytes.length > REPORT_LIMIT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(report.text)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'junit-size-or-controls');
  }
  const root = parseStrictXml(report.text);
  ledgerAssert(root.name === 'testsuites' && !root.selfClosing, spec.name, 'junit-root');
  const rootAttributes = attributesObject(
    root,
    ['name', 'tests', 'assertions', 'failures', 'skipped', 'time'],
    spec.name,
  );
  ledgerAssert(
    rootAttributes.name === 'bun test'
      && rootAttributes.tests === '18'
      && rootAttributes.assertions === '31'
      && rootAttributes.failures === '0'
      && rootAttributes.skipped === '0'
      && validateDecimal(rootAttributes.time)
      && root.children.length === 1,
    spec.name,
    'junit-root-facts',
  );
  const fileSuite = root.children[0];
  ledgerAssert(
    fileSuite.name === 'testsuite' && !fileSuite.selfClosing,
    spec.name,
    'junit-file-suite',
  );
  const fileAttributes = attributesObject(
    fileSuite,
    ['name', 'file', 'tests', 'assertions', 'failures', 'skipped', 'time', 'hostname'],
    spec.name,
  );
  const hostname = fileAttributes.hostname;
  ledgerAssert(
    fileAttributes.name === VALIDATOR_FILE
      && fileAttributes.file === VALIDATOR_FILE
      && fileAttributes.tests === '18'
      && fileAttributes.assertions === '31'
      && fileAttributes.failures === '0'
      && fileAttributes.skipped === '0'
      && validateDecimal(fileAttributes.time)
      && /^[A-Za-z0-9.-]{1,255}$/u.test(hostname)
      && fileSuite.children.length === 5,
    spec.name,
    'junit-file-facts',
  );
  const observed = [];
  let recomputedTests = 0;
  let recomputedAssertions = 0;
  for (let suiteIndex = 0; suiteIndex < VALIDATOR_SUITES.length; suiteIndex += 1) {
    const suite = fileSuite.children[suiteIndex];
    const expectedSuite = VALIDATOR_SUITES[suiteIndex];
    ledgerAssert(
      suite.name === 'testsuite' && !suite.selfClosing,
      spec.name,
      'junit-suite-tag',
    );
    const suiteAttributes = attributesObject(
      suite,
      ['name', 'file', 'line', 'tests', 'assertions', 'failures', 'skipped', 'time', 'hostname'],
      spec.name,
    );
    ledgerAssert(
      suiteAttributes.name === expectedSuite.name
        && suiteAttributes.file === VALIDATOR_FILE
        && suiteAttributes.line === String(expectedSuite.line)
        && suiteAttributes.tests === String(expectedSuite.tests.length)
        && suiteAttributes.assertions === String(expectedSuite.assertions)
        && suiteAttributes.failures === '0'
        && suiteAttributes.skipped === '0'
        && validateDecimal(suiteAttributes.time)
        && suiteAttributes.hostname === hostname
        && suite.children.length === expectedSuite.tests.length,
      spec.name,
      'junit-suite-facts:' + suiteIndex,
    );
    let suiteAssertions = 0;
    for (let testIndex = 0; testIndex < expectedSuite.tests.length; testIndex += 1) {
      const test = suite.children[testIndex];
      const expectedTest = expectedSuite.tests[testIndex];
      ledgerAssert(
        test.name === 'testcase' && test.selfClosing,
        spec.name,
        'junit-testcase-tag',
      );
      const testAttributes = attributesObject(
        test,
        ['name', 'classname', 'time', 'file', 'line', 'assertions'],
        spec.name,
      );
      ledgerAssert(
        test.children.length === 0
          && testAttributes.name === expectedTest.title
          && testAttributes.classname === expectedSuite.name
          && validateDecimal(testAttributes.time)
          && testAttributes.file === VALIDATOR_FILE
          && testAttributes.line === String(expectedTest.line)
          && testAttributes.assertions === String(expectedTest.assertions),
        spec.name,
        'junit-testcase-facts:' + suiteIndex + ':' + testIndex,
      );
      observed.push(expectedSuite.name + ' ' + expectedTest.title);
      suiteAssertions += expectedTest.assertions;
    }
    ledgerAssert(
      suiteAssertions === expectedSuite.assertions,
      spec.name,
      'junit-suite-recount',
    );
    recomputedTests += expectedSuite.tests.length;
    recomputedAssertions += suiteAssertions;
  }
  ledgerAssert(
    recomputedTests === 18
      && recomputedAssertions === 31
      && new Set(observed).size === 18,
    spec.name,
    'junit-total-recount',
  );
  const consoleRoster = validateBunConsoleRoster(run.stdout, spec.name);
  ledgerAssert(exactStringArray(consoleRoster, observed), spec.name, 'junit-console-crosscheck');
  return {
    assertions: 31,
    failed: 0,
    file: VALIDATOR_FILE,
    files: 1,
    passed: 18,
    reportBytes: report.bytes.length,
    reportSha256: report.sha256,
    roster: observed,
    suites: VALIDATOR_SUITES.map((suite) => ({
      assertions: suite.assertions,
      name: suite.name,
      tests: suite.tests.length,
    })),
    tests: 18,
  };
}

function validateValidator(run, spec, reportCapture) {
  const combined = run.stdout + '\n' + run.stderr;
  stageFailureParseContext('validator-reject-ledger-markers', { child: spec.name });
  if (/REZO_[A-Z0-9_]*LEDGER[A-Z0-9_]*:/u.test(combined)) {
    fail(EXIT_RUNNER_OR_LEDGER, 'validator-ledger:' + spec.name);
  }
  if (reportCapture.kind !== 'captured') throw reportCapture.error;
  const report = reportCapture.report;
  stageFailureParseContext(
    spec.kind === 'validator-json'
      ? 'validator-parse-node-json'
      : 'validator-parse-bun-junit',
    { child: spec.name, reportBytes: report.bytes.length, reportSha256: report.sha256 },
  );
  return spec.kind === 'validator-json'
    ? validateNodeValidatorReport(report, spec, run)
    : validateBunValidatorReport(report, spec, run);
}

function writeAll(fileDescriptor, value) {
  const bytes = Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fileDescriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error('write made no progress');
    offset += written;
  }
}

async function terminateActiveChild(reason) {
  const active = executionState.activeChild;
  if (active === null) return { kind: 'none', reason };
  const termination = await requestOwnedTermination(active.ownership, reason);
  const closeObserved = await Promise.race([
    active.ownership.closeObserved.then(() => true),
    delay(TERMINATION_GRACE_MILLISECONDS).then(() => false),
  ]);
  const groupAbsent = ['absent', 'absent-cached'].includes(termination.groupPoll.kind);
  if (closeObserved) {
    try { active.child.stdout?.destroy(); } catch { /* Recorded below. */ }
    try { active.child.stderr?.destroy(); } catch { /* Recorded below. */ }
  }
  if (closeObserved && groupAbsent && executionState.activeChild === active) {
    executionState.activeChild = null;
  }
  return {
    child: active.name,
    closeObserved,
    kind: closeObserved && groupAbsent ? 'terminated' : 'failure',
    ownership: serializeTerminationOwnership(active.ownership),
    reason,
    termination,
  };
}

async function performOwnedTemporaryCleanup() {
  const temporary = executionState.temporary;
  if (temporary === null) return { kind: 'none' };
  if (executionState.inFlightStage !== null) {
    return {
      kind: 'refused-in-flight-stage',
      label: executionState.inFlightStage.label,
      root: temporary.root,
    };
  }
  if (executionState.activeChild !== null) {
    return { kind: 'refused-active-child', root: temporary.root };
  }
  try {
    await assertOwnedDirectory(temporary.root, '/private/tmp');
    if (!temporary.root.startsWith('/private/tmp/rezo-r07-r10-green-v2.')) {
      fail(EXIT_INFRASTRUCTURE, 'temporary-cleanup-prefix');
    }
    await rm(temporary.root, { force: false, recursive: true });
    await assertAbsent(temporary.root, 'temporary-root-after-cleanup');
    executionState.temporary = null;
    return { kind: 'removed', root: temporary.root };
  } catch (error) {
    return {
      kind: 'failure',
      message: boundedReason(error instanceof SupervisorFailure ? error.reason : error),
      root: temporary.root,
    };
  }
}

function cleanupOwnedTemporary() {
  if (executionState.temporaryCleanupPromise === null) {
    executionState.temporaryCleanupPromise = performOwnedTemporaryCleanup();
  }
  return executionState.temporaryCleanupPromise;
}

async function captureClosingEvidence() {
  const evidence = {};
  if (executionState.environment !== null) {
    try {
      executionState.closingVersions ??= probeToolVersions(executionState.environment);
      evidence.versions = executionState.closingVersions;
      evidence.versionsMatchOpening = executionState.openingVersions !== null
        && JSON.stringify(executionState.closingVersions)
          === JSON.stringify(executionState.openingVersions);
    } catch (error) {
      evidence.versionError = boundedReason(
        error instanceof SupervisorFailure ? error.reason : error,
      );
    }
  }
  if (executionState.openingIdentity !== null) {
    try {
      executionState.closingIdentity ??= await captureIdentity();
      evidence.identity = executionState.closingIdentity;
      evidence.identityMatchesOpening = JSON.stringify(executionState.closingIdentity)
        === JSON.stringify(executionState.openingIdentity);
      try {
        validateApprovedIdentity(executionState.closingIdentity);
        evidence.identityApproved = true;
      } catch (error) {
        evidence.identityApproved = false;
        evidence.identityApprovalError = boundedReason(
          error instanceof SupervisorFailure ? error.reason : error,
        );
      }
    } catch (error) {
      evidence.identityError = boundedReason(
        error instanceof SupervisorFailure ? error.reason : error,
      );
    }
  }
  return evidence;
}

function compareAndSetTerminal(expected, next) {
  if (executionState.terminal.claim !== expected) return false;
  executionState.terminal.claim = next;
  return true;
}

function selfTrustBoundary(openingIdentity, closingIdentity = null) {
  const openingSha256 = openingIdentity?.files?.[SUPERVISOR_FILE]?.sha256 ?? null;
  const closingSha256 = closingIdentity?.files?.[SUPERVISOR_FILE]?.sha256 ?? null;
  return {
    externalFrozenSha256: {
      authority: 'out-of-band execution authorization',
      requirement: 'caller must match the separately frozen SHA-256 before invocation',
      selfAuthenticating: false,
    },
    internalHashSandwich: {
      closingSha256,
      matches: closingSha256 === null ? null : closingSha256 === openingSha256,
      openingSha256,
    },
  };
}

function prioritizedFailureEvidence() {
  const evidence = executionState.failureEvidence;
  if (evidence === null) return null;
  return {
    child: evidence.child,
    parseContext: evidence.parseContext,
    primaryArtifact: evidence.primaryArtifact,
    reportArtifact: evidence.reportArtifact,
    secondaryArtifact: null,
  };
}

function encodeFailureLine(payload) {
  return FAILURE_PREFIX + JSON.stringify(payload) + '\n';
}

async function captureFailureOperation(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    return {
      kind: 'failure',
      message: boundedReason(error instanceof SupervisorFailure ? error.reason : error),
      stage,
    };
  }
}

function summarizeFailureChildren() {
  return executionState.children.map((child) => {
    let evidence;
    try {
      const serialized = JSON.stringify(child.evidence);
      evidence = child.evidence === null
        ? null
        : {
            bytes: Buffer.byteLength(serialized),
            sha256: sha256(Buffer.from(serialized)),
          };
    } catch (error) {
      evidence = {
        serializationError: boundedReason(error),
      };
    }
    return { ...child, evidence };
  });
}

function usableFailureArtifact(reason) {
  const evidence = prioritizedFailureEvidence();
  const candidates = [
    evidence?.reportArtifact,
    evidence?.primaryArtifact,
    evidence?.child?.stderr?.bytes > 0 ? evidence.child.stderr : null,
    evidence?.child?.stdout?.bytes > 0 ? evidence.child.stdout : null,
    evidence?.child?.stderr,
    evidence?.child?.stdout,
  ];
  return candidates.find((candidate) => candidate !== null && candidate !== undefined)
    ?? boundedTextArtifact('failure-reason:' + boundedReason(reason), FAILURE_STREAM_ARTIFACT_BYTES);
}

function writeTerminalSentinel(fileDescriptor, line) {
  if (executionState.terminal.sentinelWritten) return;
  // This is an at-most-once output latch. It is deliberately claimed before
  // the sole write attempt so a partial/failed descriptor cannot cause a
  // second, contradictory sentinel.
  executionState.terminal.sentinelWritten = true;
  writeAll(fileDescriptor, line);
}

async function runGovernedFailure(error, fatalKind = null) {
  const failure = error instanceof SupervisorFailure
    ? error
    : new SupervisorFailure(EXIT_INFRASTRUCTURE, boundedReason(error), { cause: error });
  const exitCode = [EXIT_INFRASTRUCTURE, EXIT_RUNNER_OR_LEDGER, EXIT_HASH]
    .includes(failure.exitCode) ? failure.exitCode : EXIT_INFRASTRUCTURE;
  const reason = boundedReason(failure.reason);
  try {
    const termination = await captureFailureOperation(
      'terminate-active-child',
      () => terminateActiveChild(fatalKind === null ? 'governed-failure' : fatalKind),
    );
    const inFlightStage = await captureFailureOperation(
      'await-in-flight-stage',
      awaitInFlightStage,
    );
    const closing = await captureFailureOperation(
      'capture-closing-evidence',
      captureClosingEvidence,
    );
    executionState.temporaryCleanup = await captureFailureOperation(
      'cleanup-owned-temporary',
      cleanupOwnedTemporary,
    );
    const failureChildren = summarizeFailureChildren();
    const sentinel = {
      canonicalExecutionEligible: CANONICAL_EXECUTION_ELIGIBLE,
      children: failureChildren,
      closing,
      exitCode,
      failureEvidence: executionState.failureEvidence,
      fatalKind,
      inFlightStage,
      openingIdentity: executionState.openingIdentity,
      openingVersions: executionState.openingVersions,
      reason,
      schema: 'rezo.r07-r10.green-v2.supervisor.failure/v1',
      selfTrustBoundary: selfTrustBoundary(
        executionState.openingIdentity,
        closing?.identity ?? executionState.closingIdentity,
      ),
      temporaryCleanup: executionState.temporaryCleanup,
      terminalClaim: executionState.terminal.claim,
      termination,
    };
    let line = encodeFailureLine(sentinel);
    if (Buffer.byteLength(line) > FAILURE_LIMIT_BYTES) {
      line = encodeFailureLine({
        canonicalExecutionEligible: CANONICAL_EXECUTION_ELIGIBLE,
        childCount: failureChildren.length,
        closing,
        exitCode,
        failureEvidence: prioritizedFailureEvidence(),
        fatalKind,
        inFlightStage,
        lastChild: failureChildren.at(-1) ?? null,
        reason,
        schema: 'rezo.r07-r10.green-v2.supervisor.failure/v1',
        selfTrustBoundary: selfTrustBoundary(
          executionState.openingIdentity,
          closing?.identity ?? executionState.closingIdentity,
        ),
        temporaryCleanup: executionState.temporaryCleanup,
        termination,
        truncated: true,
      });
    }
    if (Buffer.byteLength(line) > FAILURE_LIMIT_BYTES) {
      const evidence = prioritizedFailureEvidence();
      line = encodeFailureLine({
        canonicalExecutionEligible: CANONICAL_EXECUTION_ELIGIBLE,
        closingIdentity: closing?.identity ?? null,
        exitCode,
        fatalKind,
        inFlightStage,
        parseContext: evidence?.parseContext ?? null,
        reason,
        schema: 'rezo.r07-r10.green-v2.supervisor.failure/v1',
        selfTrustBoundary: selfTrustBoundary(
          executionState.openingIdentity,
          closing?.identity ?? executionState.closingIdentity,
        ),
        temporaryCleanup: executionState.temporaryCleanup,
        termination,
        truncated: true,
        usableFailingArtifact: usableFailureArtifact(reason),
      });
    }
    if (Buffer.byteLength(line) > FAILURE_LIMIT_BYTES) {
      line = encodeFailureLine({
        exitCode,
        reason: 'failure-sentinel-bound-exceeded:' + reason,
        schema: 'rezo.r07-r10.green-v2.supervisor.failure/v1',
        truncated: true,
        usableFailingArtifact: boundedTextArtifact(
          JSON.stringify(usableFailureArtifact(reason)),
          FAILURE_STREAM_ARTIFACT_BYTES,
        ),
      });
    }
    writeTerminalSentinel(2, line);
  } catch (emergency) {
    if (!executionState.terminal.sentinelWritten) {
      let emergencyLine;
      try {
        emergencyLine = encodeFailureLine({
          exitCode,
          reason: 'failure-handler-emergency:' + boundedReason(emergency) + ':' + reason,
          schema: 'rezo.r07-r10.green-v2.supervisor.failure/v1',
          usableFailingArtifact: boundedTextArtifact(
            JSON.stringify(usableFailureArtifact(reason)),
            FAILURE_STREAM_ARTIFACT_BYTES,
          ),
        });
      } catch {
        emergencyLine = FAILURE_PREFIX
          + '{"exitCode":' + exitCode
          + ',"reason":"failure-handler-unserializable"'
          + ',"schema":"rezo.r07-r10.green-v2.supervisor.failure/v1"}\n';
      }
      try { writeTerminalSentinel(2, emergencyLine); } catch { /* Non-70 is final authority. */ }
    }
  } finally {
    process.exit(exitCode);
  }
}

function startGovernedFailure(error, fatalKind = null) {
  if (executionState.governedFailurePromise !== null) {
    return executionState.governedFailurePromise;
  }
  if (!compareAndSetTerminal('open', 'failure')
    && executionState.terminal.claim !== 'failure') {
    return Promise.resolve();
  }
  const promise = runGovernedFailure(error, fatalKind);
  executionState.governedFailurePromise = promise;
  return promise;
}

async function honorGovernedFailure() {
  const failurePromise = executionState.governedFailurePromise;
  if (failurePromise === null) return false;
  await failurePromise;
  return true;
}

function beginFatal(kind, value) {
  const reason = value instanceof Error
    ? kind + ':' + boundedReason(value.stack ?? value.message)
    : kind + ':' + boundedReason(value);
  void startGovernedFailure(
    new SupervisorFailure(EXIT_INFRASTRUCTURE, reason),
    kind,
  );
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => beginFatal('external-signal:' + signal, signal));
}
process.on('uncaughtException', (error) => beginFatal('uncaught-exception', error));
process.on('unhandledRejection', (reason) => beginFatal('unhandled-rejection', reason));

async function main() {
  const supervisorProcess = validateSupervisorProcess();
  const setupStage = beginInFlightStage('owned-temporary-setup');
  try {
    executionState.temporary = await createOwnedTemporary();
  } finally {
    completeInFlightStage(setupStage);
  }
  if (await honorGovernedFailure()) return;
  executionState.environment = sanitizedChildEnvironment(executionState.temporary);
  const children = buildChildren(executionState.temporary);
  if (children.length !== 4
    || JSON.stringify(children.map((child) => child.name)) !== JSON.stringify([
      'node-integration', 'bun-integration', 'node-validator', 'bun-validator',
    ])) {
    fail(EXIT_INFRASTRUCTURE, 'child-topology');
  }

  executionState.openingVersions = probeToolVersions(executionState.environment);
  if (await honorGovernedFailure()) return;
  executionState.openingIdentity = await captureIdentity();
  if (await honorGovernedFailure()) return;
  validateApprovedIdentity(executionState.openingIdentity);
  if (await honorGovernedFailure()) return;
  if (!CANONICAL_EXECUTION_ELIGIBLE) {
    fail(EXIT_HASH, 'canonical-execution-ineligible-before-child-1');
  }

  for (const spec of children) {
    if (await honorGovernedFailure()) return;
    if (executionState.activeChild !== null) {
      fail(EXIT_INFRASTRUCTURE, 'child-overlap-before:' + spec.name);
    }
    const childStage = beginInFlightStage('child-evidence-and-validation:' + spec.name);
    try {
      if (spec.reportPath !== undefined) {
        await assertAbsent(spec.reportPath, spec.name + '-report-before');
      }
      if (executionState.governedFailurePromise === null) {
        const run = await runChild(spec, executionState.environment);
        const summary = rawChildSummary(run, spec);
        executionState.children.push(summary);
        // Raw head/tail evidence is staged synchronously before any fatal check.
        stageFailureRun(run, spec);
        const capturedEvidence = spec.kind === 'integration'
          ? captureIntegrationLedgersBeforeRawValidation(run, spec)
          : await captureValidatorReportBeforeRawValidation(spec);
        // A fatal failure owns the sole terminal promise. Finish staging first;
        // the governed path is waiting on this stage and will validate no more.
        if (executionState.governedFailurePromise === null) {
          stageFailureParseContext('raw-child-validation', { child: spec.name });
          validateRawResult(run);
          if (spec.kind === 'integration') {
            summary.evidence = validateIntegration(
              run,
              spec,
              executionState.openingIdentity,
              capturedEvidence,
            );
          } else {
            summary.evidence = validateValidator(run, spec, capturedEvidence);
          }
        }
      }
    } finally {
      completeInFlightStage(childStage);
    }
    if (await honorGovernedFailure()) return;
  }

  executionState.closingVersions = probeToolVersions(executionState.environment);
  if (await honorGovernedFailure()) return;
  executionState.closingIdentity = await captureIdentity();
  if (await honorGovernedFailure()) return;
  validateApprovedIdentity(executionState.closingIdentity);
  if (await honorGovernedFailure()) return;
  if (JSON.stringify(executionState.closingVersions)
    !== JSON.stringify(executionState.openingVersions)) {
    fail(EXIT_INFRASTRUCTURE, 'opening-closing-version-drift');
  }
  if (await honorGovernedFailure()) return;
  if (JSON.stringify(executionState.closingIdentity)
    !== JSON.stringify(executionState.openingIdentity)) {
    fail(EXIT_HASH, 'opening-closing-identity-drift');
  }
  if (await honorGovernedFailure()) return;
  if (executionState.children.length !== 4 || executionState.activeChild !== null) {
    fail(EXIT_RUNNER_OR_LEDGER, 'children-incomplete-or-live');
  }
  if (await honorGovernedFailure()) return;
  executionState.temporaryCleanup = await cleanupOwnedTemporary();
  if (await honorGovernedFailure()) return;
  if (executionState.temporaryCleanup.kind !== 'removed') {
    fail(EXIT_INFRASTRUCTURE, 'temporary-cleanup:' + executionState.temporaryCleanup.kind);
  }
  if (await honorGovernedFailure()) return;

  const summary = {
    canonicalExecutionEligible: CANONICAL_EXECUTION_ELIGIBLE,
    children: executionState.children,
    closingIdentity: executionState.closingIdentity,
    closingVersions: executionState.closingVersions,
    environment: {
      keys: Object.keys(executionState.environment).sort(),
      path: executionState.environment.PATH,
      sanitized: true,
    },
    file: SUPERVISOR_FILE,
    limits: {
      failureBytes: FAILURE_LIMIT_BYTES,
      groupPollMilliseconds: GROUP_POLL_MILLISECONDS,
      integrationTimeoutMilliseconds: INTEGRATION_TIMEOUT_MILLISECONDS,
      outputBytes: OUTPUT_LIMIT_BYTES,
      reportBytes: REPORT_LIMIT_BYTES,
      summaryBytes: SUMMARY_LIMIT_BYTES,
      terminationGraceMilliseconds: TERMINATION_GRACE_MILLISECONDS,
      validatorTimeoutMilliseconds: VALIDATOR_TIMEOUT_MILLISECONDS,
      versionTimeoutMilliseconds: VERSION_TIMEOUT_MILLISECONDS,
    },
    openingIdentity: executionState.openingIdentity,
    openingVersions: executionState.openingVersions,
    provisionalPass6Refreeze: {
      bunJunitFormatProbeCredit: false,
      canonicalExecutionEligible: CANONICAL_EXECUTION_ELIGIBLE,
      carrierAndGovernanceHashes: true,
      r07CleanupAndSettlementFacts: true,
      r10ErrorHookResourceAndSettlementFacts: true,
      r10ListenersSlotRequired: true,
      sourceAggregate: true,
    },
    schema: 'rezo.r07-r10.green-v2.supervisor/v1',
    selfTrustBoundary: selfTrustBoundary(
      executionState.openingIdentity,
      executionState.closingIdentity,
    ),
    supervisorExit: EXIT_ACCEPTED,
    supervisorProcess,
    temporaryCleanup: executionState.temporaryCleanup,
    trustedHostInfrastructure: {
      cryptographicallyGovernedBySupervisor: false,
      includes: ['darwin kernel', 'darwin dynamic loader', 'host system libraries'],
      rationale: 'Explicit host boundary outside the hashed Node/Bun/package/source closure',
    },
  };
  const line = SUPERVISOR_PREFIX + JSON.stringify(summary) + '\n';
  if (Buffer.byteLength(line) > SUMMARY_LIMIT_BYTES) {
    fail(EXIT_INFRASTRUCTURE, 'summary-output-limit');
  }
  if (await honorGovernedFailure()) return;
  if (!compareAndSetTerminal('open', 'accepted')) {
    if (await honorGovernedFailure()) return;
    fail(EXIT_INFRASTRUCTURE, 'terminal-acceptance-cas');
  }
  if (executionState.governedFailurePromise !== null
    || executionState.terminal.claim !== 'accepted') {
    return;
  }
  try {
    writeTerminalSentinel(1, line);
  } catch {
    // The accepted claim cannot be recast as a failure sentinel without
    // violating the single-writer latch. A non-70 status remains fail-closed.
    process.exit(EXIT_INFRASTRUCTURE);
  }
  process.exit(EXIT_ACCEPTED);
}

try {
  await main();
} catch (error) {
  await startGovernedFailure(error, 'top-catch');
}
