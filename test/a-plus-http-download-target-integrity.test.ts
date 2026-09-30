import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import {
  executeRequest as http2Adapter,
  Http2SessionPool,
} from '../src/adapters/http2';
import { getFS } from '../src/utils/http-config';

class InfrastructureError extends Error {}

type Protocol = 'h1' | 'h2';
type RowId =
  | 'R36-01' | 'R36-02' | 'R36-03' | 'R36-04'
  | 'R36-05' | 'R36-06' | 'R36-07' | 'R36-08'
  | 'R36-09' | 'R36-10' | 'R36-11';

type LegId =
  | 'R36-01-H1-DOWNLOAD'
  | 'R36-02-H2-DOWNLOAD'
  | 'R36-03-H1-PREMATURE31'
  | 'R36-04-H1-REQUEST-SAVETO'
  | 'R36-04-H1-REQUEST-FILENAME'
  | 'R36-04-H1-GET-SAVETO'
  | 'R36-04-H1-GET-FILENAME'
  | 'R36-04-H2-REQUEST-SAVETO'
  | 'R36-04-H2-REQUEST-FILENAME'
  | 'R36-04-H2-GET-SAVETO'
  | 'R36-04-H2-GET-FILENAME'
  | 'R36-05-H1-FRESH-GZIP'
  | 'R36-05-H2-FRESH-GZIP'
  | 'R36-05-H1-FRESH-PREMATURE31'
  | 'R36-06-H1-SUCCESS'
  | 'R36-06-H2-SUCCESS'
  | 'R36-07-H1-PLAIN500'
  | 'R36-07-H2-PLAIN500'
  | 'R36-08-H1-RETRY'
  | 'R36-08-H2-RETRY'
  | 'R36-09-H1-REDIRECT'
  | 'R36-09-H2-REDIRECT'
  | 'R36-10-H1-CONCURRENT'
  | 'R36-10-H2-CONCURRENT'
  | 'R36-11-H1-DIRECTORY'
  | 'R36-11-H2-DIRECTORY';

const FILE = 'test/a-plus-http-download-target-integrity.test.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const RUNTIME_VERSION = RUNTIME === 'bun'
  ? process.versions.bun ?? ''
  : process.version;

const REGISTERED: RowId[] = [
  'R36-01', 'R36-02', 'R36-03', 'R36-04', 'R36-05', 'R36-06',
  'R36-07', 'R36-08', 'R36-09', 'R36-10', 'R36-11',
];
const EXPECTED_RED: RowId[] = [
  'R36-01', 'R36-02', 'R36-03', 'R36-04', 'R36-08', 'R36-10', 'R36-11',
];
const EXPECTED_PASSED = REGISTERED.filter((id) => !EXPECTED_RED.includes(id));
const EXPECTED_LEGS: LegId[] = [
  'R36-01-H1-DOWNLOAD',
  'R36-02-H2-DOWNLOAD',
  'R36-03-H1-PREMATURE31',
  'R36-04-H1-REQUEST-SAVETO',
  'R36-04-H1-REQUEST-FILENAME',
  'R36-04-H1-GET-SAVETO',
  'R36-04-H1-GET-FILENAME',
  'R36-04-H2-REQUEST-SAVETO',
  'R36-04-H2-REQUEST-FILENAME',
  'R36-04-H2-GET-SAVETO',
  'R36-04-H2-GET-FILENAME',
  'R36-05-H1-FRESH-GZIP',
  'R36-05-H2-FRESH-GZIP',
  'R36-05-H1-FRESH-PREMATURE31',
  'R36-06-H1-SUCCESS',
  'R36-06-H2-SUCCESS',
  'R36-07-H1-PLAIN500',
  'R36-07-H2-PLAIN500',
  'R36-08-H1-RETRY',
  'R36-08-H2-RETRY',
  'R36-09-H1-REDIRECT',
  'R36-09-H2-REDIRECT',
  'R36-10-H1-CONCURRENT',
  'R36-10-H2-CONCURRENT',
  'R36-11-H1-DIRECTORY',
  'R36-11-H2-DIRECTORY',
];

const armedRed = new Set<RowId>();
const observedFailures = new Set<RowId>();
const observedInvocations = new Map<RowId, number>();
const observedPasses = new Set<RowId>();
const observedLegs = new Map<LegId, LegRecord>();
const cleanupErrors: string[] = [];
const fixtureErrors: string[] = [];
const lateEvents: string[] = [];
const oracleInvalidations: string[] = [];
const setupErrors: string[] = [];
const teardownErrors: string[] = [];
const processFaults: ErrorSnapshot[] = [];

const activeServers = new Set<http.Server | http2.Http2Server>();
const activeSockets = new Set<net.Socket>();
const activeHttp2Sessions = new Set<http2.ServerHttp2Session>();
const activeHttp2Streams = new Set<http2.ServerHttp2Stream>();
const activeTimers = new Set<NodeJS.Timeout>();
const activeGates = new Set<Gate>();
const activeTemporaryDirectories = new Set<string>();
const activeTemporaryFiles = new Set<string>();
const activeFinalTargets = new Set<string>();
const activeOwnedStages = new Set<string>();
let processObserversInstalled = false;

const SENTINEL = Buffer.from(
  'PREEXISTING-SENTINEL::MUST-SURVIVE-FAILED-DOWNLOAD',
);
const PAYLOAD = Buffer.from('successful decoded download payload');
const FULL_GZIP = gzipSync(PAYLOAD);
const TRUNCATED_GZIP = FULL_GZIP.subarray(0, FULL_GZIP.length - 4);
const PLAIN_500 = Buffer.from('plain non-2xx response');
const PREMATURE_PREFIX = Buffer.from('PARTIAL-WIRE-BYTES-BEFORE-CLOSE');
const A_FIRST = Buffer.from('AAAA');
const A_LAST = Buffer.from('AAAAAAAA');
const B_FIRST = Buffer.from('BBBB');
const B_LAST = Buffer.from('DDDD');
const A_COMPLETE = Buffer.concat([A_FIRST, A_LAST]);
const B_COMPLETE = Buffer.concat([B_FIRST, B_LAST]);

const H1_FAILURE_EVENTS = 'initiated,start,headers,status,cookies,error';
const H2_FAILURE_EVENTS = 'initiated,start,headers,status,cookies,progress,error';
const SUCCESS_EVENTS = 'initiated,start,headers,status,cookies,progress,finish,done,complete';
const H2_CONCURRENT_SUCCESS_EVENTS = 'initiated,start,headers,status,cookies,progress,progress,finish,done,complete';
const H1_REDIRECT_SUCCESS_EVENTS = 'initiated,start,redirect,headers,status,cookies,progress,finish,done,complete';
// john 2026-08-29 (HD-5): HTTP/2 publishes headers/status/cookies before a terminal status error, as HTTP/1.1 does.
const H2_STATUS_FAILURE_EVENTS = 'initiated,start,headers,status,cookies,error';
// john 2026-08-29 (HD-6): a facade exposes only the terminal attempt. HTTP/1.1's first attempt here is a 500 that the status-code
// retry will follow — its header-time events are no longer published. HTTP/2's first attempt is an ACCEPTED 200 retried only by the
// custom `condition`: a condition-driven retry of an accepted response cannot be known at headers time, so both attempts publish.
const H1_RETRY_SUCCESS_EVENTS = 'initiated,start,headers,status,cookies,progress,finish,done,complete';
const H2_RETRY_SUCCESS_EVENTS = 'initiated,start,headers,status,cookies,progress,headers,status,cookies,progress,finish,done,complete';

function exactH1PrematureFailureEvents(events: readonly string[]): boolean {
  const actual = events.join(',');
  return actual === H1_FAILURE_EVENTS
    || (RUNTIME === 'bun' && actual === H2_FAILURE_EVENTS);
}

const FIXTURE_PINS: Array<readonly [string, Buffer, number, string]> = [
  ['F-SENTINEL', SENTINEL, 50, '609e298420f642aa3d3c07298124192a69eee810c4d1b3e9534941b9e2ff3aa3'],
  ['F-PAYLOAD', PAYLOAD, 35, 'c81cb3cd95092e459218d35a697d094842dab92f5cff17899453a1f88d8edd53'],
  ['F-GZIP', FULL_GZIP, 52, 'e447bb95ce5b5438fca0f62deb4ae388c0277469b9785c5d5143c05fb5965031'],
  ['F-GZIP-BAD', TRUNCATED_GZIP, 48, 'a2022ab4b0374001825cf382eb9aac71a65820abc9591560597b4e35c9cf9bae'],
  ['F-500', PLAIN_500, 22, '420bb28eb058daeb604fdd98c84c8e8aca5de32d8d4eec6f995b74be08287e2b'],
  ['F-PREFIX31', PREMATURE_PREFIX, 31, '201c81ff0a423aa5c2790eea7df45e824d93db47524ee41ba30cd24f4e8ac9f4'],
  ['F-A-FIRST', A_FIRST, 4, '63c1dd951ffedf6f7fd968ad4efa39b8ed584f162f46e715114ee184f8de9201'],
  ['F-A-FINAL', A_COMPLETE, 12, '0592cedeabbf836d8d1c7456417c7653ac208f71e904d3d0ab37faf711021aff'],
  ['F-B-FIRST', B_FIRST, 4, '4a8d8134f29b0b7b60c126f5532bc9f5d9bb73037373cf6fb872d81f1dcefdfd'],
  ['F-B-FINAL', B_COMPLETE, 8, '2b1b3a16bfc56c82f45c697f9fbb54a8233166d44d97a0e1109dd30ee886a474'],
];

interface ErrorSnapshot {
  readonly channel?: string;
  readonly code: unknown;
  readonly errno: unknown;
  readonly message: string;
  readonly name: string;
  readonly responseStatus: unknown;
  readonly status: unknown;
}

type PathSnapshot =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'file';
      readonly length: number;
      readonly sha256: string;
      readonly utf8: string;
    }
  | {
      readonly children: ReadonlyArray<{
        readonly name: string;
        readonly snapshot: PathSnapshot;
      }>;
      readonly entries: readonly string[];
      readonly kind: 'directory';
    };

interface CaseSnapshot {
  readonly stages: ReadonlyArray<{
    readonly name: string;
    readonly snapshot: PathSnapshot;
  }>;
  readonly target: PathSnapshot;
}

interface CaseContext {
  readonly directory: string;
  readonly stagePaths: Set<string>;
  readonly target: string;
}

interface TerminalCapture {
  readonly event: 'complete' | 'done' | 'error' | 'finish';
  readonly finishedInsideListener: boolean;
  readonly snapshot: CaseSnapshot;
}

interface ObserverResult {
  readonly errors: readonly ErrorSnapshot[];
  readonly events: readonly string[];
  readonly final: CaseSnapshot;
  readonly finished: boolean;
  readonly stable: boolean;
  readonly terminalCaptures: readonly TerminalCapture[];
}

interface LegRecord {
  readonly calls: number;
  readonly complete: number;
  readonly details: unknown;
  readonly done: number;
  readonly errors: number;
  readonly finish: number;
  readonly hits: number;
  readonly invocations: 1;
  readonly protocol: Protocol;
}

interface NodeRequireBridge {
  restore(): void;
}

type DownloadFacade = ReturnType<Rezo['download']>;

interface DownloadObserver {
  readonly errors: ErrorSnapshot[];
  readonly events: string[];
  readonly firstTerminal: Promise<void>;
  readonly terminalCaptures: TerminalCapture[];
}

interface WireReply {
  destroy(): void;
  end(chunk?: Buffer): void;
  respond(status: number, headers?: Readonly<Record<string, string>>): void;
  write(chunk: Buffer): Promise<void>;
}

type RouteHandler = (
  path: string,
  reply: WireReply,
) => Promise<void> | void;

interface FixtureServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorField(value: unknown, field: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  return Reflect.get(value, field);
}

function recordHttp2PoolInvalidityBeforeDestroy(label: string): void {
  const pool = Http2SessionPool.getInstance();
  const entries = errorField(pool, 'entriesBySession');
  const pendingCreations = errorField(pool, 'pendingCreations');

  if (!(entries instanceof Map)) {
    cleanupErrors.push(label + ':http2-pool-entries-unobservable');
  } else {
    let leases = 0;
    for (const entry of entries.values()) {
      const refCount = errorField(entry, 'refCount');
      if (
        typeof refCount !== 'number'
        || !Number.isInteger(refCount)
        || refCount < 0
      ) {
        cleanupErrors.push(label + ':http2-pool-refcount-invalid');
        continue;
      }
      leases += refCount;
    }
    if (leases !== 0) {
      cleanupErrors.push(label + ':http2-leases-before-destroy:' + leases);
    }
  }

  if (!(pendingCreations instanceof Set)) {
    cleanupErrors.push(label + ':http2-pending-creations-unobservable');
  } else if (pendingCreations.size !== 0) {
    cleanupErrors.push(
      label + ':http2-pending-creations-before-destroy:' + pendingCreations.size,
    );
  }
}

function errorSnapshot(value: unknown, channel?: string): ErrorSnapshot {
  const response = errorField(value, 'response');
  return {
    channel,
    code: errorField(value, 'code'),
    errno: errorField(value, 'errno'),
    message: String(errorField(value, 'message') ?? value),
    name: String(errorField(value, 'name') ?? typeof value),
    responseStatus: errorField(response, 'status'),
    status: errorField(value, 'status'),
  };
}

function onUncaughtException(error: Error): void {
  processFaults.push(errorSnapshot(error, 'uncaughtException'));
}

function onUnhandledRejection(reason: unknown): void {
  processFaults.push(errorSnapshot(reason, 'unhandledRejection'));
}

function installProcessObservers(): void {
  if (processObserversInstalled) {
    throw new InfrastructureError('process observers installed twice');
  }
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);
  processObserversInstalled = true;
}

function restoreProcessObservers(): void {
  if (!processObserversInstalled) return;
  process.off('uncaughtException', onUncaughtException);
  process.off('unhandledRejection', onUnhandledRejection);
  processObserversInstalled = false;
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.configurable === right.configurable
    && left.enumerable === right.enumerable
    && left.get === right.get
    && left.set === right.set
    && left.value === right.value
    && left.writable === right.writable;
}

function installNodeRequireBridge(): NodeRequireBridge {
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
  if (priorDescriptor !== undefined) {
    throw new InfrastructureError('require bridge found an unexpected own descriptor');
  }
  const nodeRequire = (specifier: string): unknown => {
    if (specifier !== 'node:fs') {
      throw new InfrastructureError('require bridge rejected ' + specifier);
    }
    return nodeFs;
  };
  let installed = false;
  const restore = (): void => {
    if (installed) {
      if (!Reflect.deleteProperty(globalThis, 'require')) {
        throw new InfrastructureError('failed to delete require bridge');
      }
      installed = false;
    }
    const restored = Object.getOwnPropertyDescriptor(globalThis, 'require');
    if (!samePropertyDescriptor(restored, priorDescriptor)) {
      throw new InfrastructureError('require descriptor did not restore exactly');
    }
  };
  try {
    Object.defineProperty(globalThis, 'require', {
      configurable: true,
      enumerable: false,
      value: nodeRequire,
      writable: false,
    });
    installed = true;
    if (nodeRequire('node:fs') !== nodeFs) {
      throw new InfrastructureError('require bridge returned wrong capability');
    }
  } catch (error) {
    try {
      restore();
    } catch (restoreError) {
      throw new InfrastructureError(
        'require bridge install and restore failed',
        { cause: restoreError },
      );
    }
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('require bridge installation failed', {
      cause: error,
    });
  }
  return { restore };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      resolve();
    }, milliseconds);
    activeTimers.add(timer);
  });
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new InfrastructureError(label));
    }, milliseconds);
    activeTimers.add(timer);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
      activeTimers.delete(timer);
    }
  }
}

class Gate {
  readonly label: string;
  readonly promise: Promise<void>;
  private releasePromise: (() => void) | undefined;

  constructor(label: string) {
    this.label = label;
    this.promise = new Promise((resolve) => {
      this.releasePromise = resolve;
    });
    activeGates.add(this);
  }

  release(): void {
    const release = this.releasePromise;
    if (release === undefined) return;
    this.releasePromise = undefined;
    activeGates.delete(this);
    release();
  }

  forceReleaseForCleanup(): void {
    if (this.releasePromise === undefined) return;
    cleanupErrors.push('held-gate:' + this.label);
    this.release();
  }
}

function assertFixturePins(): void {
  for (const [label, bytes, length, hash] of FIXTURE_PINS) {
    if (bytes.length !== length) {
      throw new InfrastructureError(label + ' length drift ' + bytes.length);
    }
    const actual = sha256(bytes);
    if (actual !== hash) {
      throw new InfrastructureError(label + ' sha drift ' + actual);
    }
  }
}

function snapshotPathSync(path: string): PathSnapshot {
  try {
    const information = nodeFs.lstatSync(path);
    if (information.isDirectory()) {
      const entries = nodeFs.readdirSync(path).sort();
      return {
        children: entries.map((name) => ({
          name,
          snapshot: snapshotPathSync(join(path, name)),
        })),
        entries,
        kind: 'directory',
      };
    }
    if (!information.isFile()) {
      throw new InfrastructureError('unsupported target type at ' + path);
    }
    const bytes = nodeFs.readFileSync(path);
    return {
      kind: 'file',
      length: bytes.length,
      sha256: sha256(bytes),
      utf8: bytes.toString('utf8'),
    };
  } catch (error) {
    if (errorField(error, 'code') === 'ENOENT') return { kind: 'absent' };
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('snapshot failed at ' + path, { cause: error });
  }
}

function snapshotCaseSync(context: CaseContext): CaseSnapshot {
  for (const prior of context.stagePaths) activeOwnedStages.delete(prior);
  context.stagePaths.clear();
  let names: string[];
  try {
    names = nodeFs.readdirSync(context.directory).sort();
  } catch (error) {
    throw new InfrastructureError(
      'case directory snapshot failed at ' + context.directory,
      { cause: error },
    );
  }
  const targetName = basename(context.target);
  const stages = names
    .filter((name) => name !== targetName)
    .map((name) => {
      const path = join(context.directory, name);
      context.stagePaths.add(path);
      activeOwnedStages.add(path);
      return { name, snapshot: snapshotPathSync(path) };
    });
  return {
    stages,
    target: snapshotPathSync(context.target),
  };
}

async function createCase(
  label: string,
  targetKind: 'absent' | 'directory' | 'file',
): Promise<CaseContext> {
  const directory = await mkdtemp(join(tmpdir(), 'rezo-r36-' + label + '-'));
  activeTemporaryDirectories.add(directory);
  const target = join(directory, 'target.bin');
  activeFinalTargets.add(target);
  if (targetKind === 'file') {
    await writeFile(target, SENTINEL);
  } else if (targetKind === 'directory') {
    await mkdir(target);
    const child = join(target, 'sentinel-child');
    await writeFile(child, SENTINEL);
    activeTemporaryFiles.add(child);
  }
  return { directory, stagePaths: new Set(), target };
}

async function cleanupCase(context: CaseContext): Promise<void> {
  try {
    const snapshot = snapshotCaseSync(context);
    if (snapshot.stages.length !== 0) {
      cleanupErrors.push(
        'stage-residue:' + context.directory + ':'
          + snapshot.stages.map((stage) => stage.name).join(','),
      );
    }
  } catch (error) {
    cleanupErrors.push(
      'case-final-snapshot:' + (error instanceof Error ? error.message : String(error)),
    );
  }
  for (const stage of context.stagePaths) activeOwnedStages.delete(stage);
  context.stagePaths.clear();
  try {
    await rm(context.directory, { force: true, recursive: true });
    activeTemporaryDirectories.delete(context.directory);
    activeFinalTargets.delete(context.target);
    for (const file of [...activeTemporaryFiles]) {
      if (file.startsWith(context.directory + '/')) activeTemporaryFiles.delete(file);
    }
  } catch (error) {
    cleanupErrors.push(
      'case-remove:' + (error instanceof Error ? error.message : String(error)),
    );
  }
}

function armRed(id: RowId): void {
  if (!EXPECTED_RED.includes(id)) {
    throw new InfrastructureError(id + ' attempted to arm outside target map');
  }
  if (armedRed.has(id)) {
    throw new InfrastructureError(id + ' attempted to arm twice');
  }
  armedRed.add(id);
}

async function observeRow(
  id: RowId,
  operation: () => Promise<void>,
): Promise<void> {
  observedInvocations.set(id, (observedInvocations.get(id) ?? 0) + 1);
  try {
    await operation();
    if (armedRed.delete(id)) {
      throw new InfrastructureError(id + ' passed after arming RED');
    }
    observedPasses.add(id);
  } catch (error) {
    const wasArmed = armedRed.delete(id);
    if (error instanceof InfrastructureError) {
      fixtureErrors.push(id + ':infrastructure:' + error.message);
      throw error;
    }
    if (!wasArmed) {
      oracleInvalidations.push(
        id + ':unarmed:' + (error instanceof Error ? error.message : String(error)),
      );
      throw error;
    }
    observedFailures.add(id);
    throw error;
  }
}

function recordLeg(
  id: LegId,
  protocol: Protocol,
  result: ObserverResult,
  details: unknown,
  calls: number,
  hits: number,
): void {
  if (observedLegs.has(id)) {
    throw new InfrastructureError(id + ' recorded more than once');
  }
  observedLegs.set(id, {
    calls,
    complete: result.events.filter((event) => event === 'complete').length,
    details,
    done: result.events.filter((event) => event === 'done').length,
    errors: result.errors.length,
    finish: result.events.filter((event) => event === 'finish').length,
    hits,
    invocations: 1,
    protocol,
  });
}

function requireDownloadFacade(value: unknown): DownloadFacade {
  if (
    typeof errorField(value, 'on') !== 'function'
    || typeof errorField(value, 'isFinished') !== 'function'
  ) {
    throw new InfrastructureError('public alias did not yield a download facade');
  }
  return value as DownloadFacade;
}

function clientFor(protocol: Protocol): Rezo {
  return new Rezo({}, protocol === 'h1' ? httpAdapter : http2Adapter);
}

const EXPECTED_FIXTURE_TEARDOWN_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_INVALID_STREAM',
  'ERR_HTTP2_STREAM_CANCEL',
  'ERR_STREAM_DESTROYED',
]);

function observeFixtureResourceError(
  label: string,
  error: Error,
  expectedTeardownOrAbort: boolean,
): void {
  const code = errorField(error, 'code');
  if (
    expectedTeardownOrAbort
    && typeof code === 'string'
    && EXPECTED_FIXTURE_TEARDOWN_CODES.has(code)
  ) return;
  fixtureErrors.push(label + ':' + error.name + ':' + String(code) + ':' + error.message);
}

function trackSocket(
  socket: net.Socket,
  localSockets: Set<net.Socket>,
  onError: (error: Error) => void,
): void {
  localSockets.add(socket);
  activeSockets.add(socket);
  socket.on('error', onError);
  socket.once('close', () => {
    localSockets.delete(socket);
    activeSockets.delete(socket);
  });
}

async function startFixture(
  protocol: Protocol,
  handler: RouteHandler,
): Promise<FixtureServer> {
  const localSockets = new Set<net.Socket>();
  const localSessions = new Set<http2.ServerHttp2Session>();
  const localStreams = new Set<http2.ServerHttp2Stream>();
  let intentionalAbort = false;
  let server: http.Server | http2.Http2Server;
  let teardownStarted = false;
  const observeResourceError = (label: string, error: Error): void => {
    observeFixtureResourceError(
      protocol + ':' + label,
      error,
      intentionalAbort || teardownStarted,
    );
  };

  const runHandler = (path: string, reply: WireReply): void => {
    void Promise.resolve(handler(path, reply)).catch((error: unknown) => {
      fixtureErrors.push(
        protocol + ':route:' + (error instanceof Error ? error.message : String(error)),
      );
      reply.destroy();
    });
  };

  if (protocol === 'h1') {
    const h1Server = http.createServer((request, response) => {
      request.resume();
      response.on('error', (error) => {
        observeResourceError('response', error);
      });
      const reply: WireReply = {
        destroy: () => {
          intentionalAbort = true;
          response.destroy();
        },
        end: (chunk) => response.end(chunk),
        respond: (status, headers = {}) => response.writeHead(status, headers),
        write: (chunk) => new Promise((resolve, reject) => {
          response.write(chunk, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      };
      runHandler(request.url ?? '/', reply);
    });
    server = h1Server;
  } else {
    const h2Server = http2.createServer();
    h2Server.on('session', (session) => {
      localSessions.add(session);
      activeHttp2Sessions.add(session);
      session.on('error', (error) => {
        observeResourceError('session', error);
      });
      session.once('close', () => {
        localSessions.delete(session);
        activeHttp2Sessions.delete(session);
      });
    });
    h2Server.on('stream', (
      stream: http2.ServerHttp2Stream,
      headers: http2.IncomingHttpHeaders,
    ) => {
      localStreams.add(stream);
      activeHttp2Streams.add(stream);
      stream.on('error', (error) => {
        observeResourceError('stream', error);
      });
      stream.once('close', () => {
        localStreams.delete(stream);
        activeHttp2Streams.delete(stream);
      });
      const reply: WireReply = {
        destroy: () => {
          intentionalAbort = true;
          stream.destroy();
        },
        end: (chunk) => stream.end(chunk),
        respond: (status, responseHeaders = {}) => {
          stream.respond({ ':status': status, ...responseHeaders });
        },
        write: (chunk) => new Promise((resolve, reject) => {
          stream.write(chunk, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      };
      runHandler(String(headers[':path'] ?? '/'), reply);
    });
    server = h2Server;
  }

  activeServers.add(server);
  server.once('close', () => activeServers.delete(server));
  server.on('connection', (socket) => {
    trackSocket(socket, localSockets, (error) => observeResourceError('socket', error));
  });

  try {
    await within(new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    }), 3_000, protocol + ' fixture listen watchdog');
  } catch (error) {
    activeServers.delete(server);
    try {
      server.close();
    } catch {
      // The listen error is already retained as infrastructure evidence.
    }
    throw error;
  }

  server.on('error', (error) => {
    observeResourceError('server', error);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new InfrastructureError(protocol + ' fixture has no numeric address');
  }

  let closed = false;
  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    close: async () => {
      if (closed) return;
      closed = true;
      teardownStarted = true;
      recordHttp2PoolInvalidityBeforeDestroy(protocol + ':fixture-close');
      Http2SessionPool.getInstance().destroy();
      for (const stream of [...localStreams]) stream.destroy();
      for (const session of [...localSessions]) session.destroy();
      if ('closeAllConnections' in server) server.closeAllConnections();
      for (const socket of [...localSockets]) socket.destroy();
      await within(new Promise<void>((resolve) => {
        server.close(() => resolve());
      }), 3_000, protocol + ' fixture close watchdog').catch((error: unknown) => {
        cleanupErrors.push(
          protocol + ':server-close:'
            + (error instanceof Error ? error.message : String(error)),
        );
      });
      const deadline = Date.now() + 1_000;
      while (
        Date.now() < deadline
        && (
          localStreams.size !== 0
          || localSessions.size !== 0
          || localSockets.size !== 0
          || activeServers.has(server)
        )
      ) {
        await delay(10);
      }
      if (
        localStreams.size !== 0
        || localSessions.size !== 0
        || localSockets.size !== 0
        || activeServers.has(server)
      ) {
        cleanupErrors.push(
          protocol + ':fixture-events-not-drained:'
            + JSON.stringify({
              server: activeServers.has(server) ? 1 : 0,
              sessions: localSessions.size,
              sockets: localSockets.size,
              streams: localStreams.size,
            }),
        );
      }
    },
  };
}

function captureTerminal(
  observer: DownloadObserver,
  facade: DownloadFacade,
  context: CaseContext,
  event: TerminalCapture['event'],
): void {
  try {
    observer.terminalCaptures.push({
      event,
      finishedInsideListener: facade.isFinished(),
      snapshot: snapshotCaseSync(context),
    });
  } catch (error) {
    fixtureErrors.push(
      'terminal-snapshot:' + event + ':'
        + (error instanceof Error ? error.message : String(error)),
    );
  }
}

function observeDownload(
  facade: DownloadFacade,
  context: CaseContext,
): DownloadObserver {
  const errors: ErrorSnapshot[] = [];
  const events: string[] = [];
  const terminalCaptures: TerminalCapture[] = [];
  let settle: (() => void) | undefined;
  const firstTerminal = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const settleOnce = (): void => {
    const current = settle;
    if (current === undefined) return;
    settle = undefined;
    current();
  };

  facade.on('initiated', () => events.push('initiated'));
  facade.on('start', () => events.push('start'));
  facade.on('headers', () => events.push('headers'));
  facade.on('status', () => events.push('status'));
  facade.on('cookies', () => events.push('cookies'));
  facade.on('progress', () => events.push('progress'));
  facade.on('redirect', () => events.push('redirect'));
  facade.on('error', (error) => {
    events.push('error');
    errors.push(errorSnapshot(error));
    captureTerminal(
      { errors, events, firstTerminal, terminalCaptures },
      facade,
      context,
      'error',
    );
    settleOnce();
  });
  facade.on('finish', () => {
    events.push('finish');
    captureTerminal(
      { errors, events, firstTerminal, terminalCaptures },
      facade,
      context,
      'finish',
    );
    settleOnce();
  });
  facade.on('done', () => {
    events.push('done');
    captureTerminal(
      { errors, events, firstTerminal, terminalCaptures },
      facade,
      context,
      'done',
    );
  });
  facade.on('complete', () => {
    events.push('complete');
    captureTerminal(
      { errors, events, firstTerminal, terminalCaptures },
      facade,
      context,
      'complete',
    );
  });
  return { errors, events, firstTerminal, terminalCaptures };
}

async function settleDownload(
  facade: DownloadFacade,
  observer: DownloadObserver,
  context: CaseContext,
  processFaultStart: number,
): Promise<ObserverResult> {
  await within(observer.firstTerminal, 8_000, 'download facade did not settle');
  await delay(80);
  const before = JSON.stringify({
    errors: observer.errors,
    events: observer.events,
    faults: processFaults.slice(processFaultStart),
    target: snapshotCaseSync(context),
  });
  await delay(80);
  const final = snapshotCaseSync(context);
  const after = JSON.stringify({
    errors: observer.errors,
    events: observer.events,
    faults: processFaults.slice(processFaultStart),
    target: final,
  });
  if (before !== after) {
    lateEvents.push('download-stability:' + before + '->' + after);
  }
  return {
    errors: [...observer.errors],
    events: [...observer.events],
    final,
    finished: facade.isFinished(),
    stable: before === after,
    terminalCaptures: [...observer.terminalCaptures],
  };
}

type StandardRoute = 'invalid' | 'plain500' | 'premature31' | 'success';

interface StandardOutcome {
  readonly calls: number;
  readonly hits: number;
  readonly midflight?: CaseSnapshot;
  readonly processFaults: readonly ErrorSnapshot[];
  readonly result: ObserverResult;
}

async function runStandardCase(
  protocol: Protocol,
  route: StandardRoute,
  targetKind: 'absent' | 'file',
): Promise<StandardOutcome> {
  if (route === 'premature31' && protocol !== 'h1') {
    throw new InfrastructureError('premature31 is H1-only');
  }
  const context = await createCase(protocol + '-' + route, targetKind);
  const prefixWritten = route === 'premature31'
    ? new Gate(protocol + '-' + route + '-prefix')
    : undefined;
  let hits = 0;
  const fixture = await startFixture(protocol, async (_path, reply) => {
    hits += 1;
    if (route === 'plain500') {
      reply.respond(500, {
        'content-length': String(PLAIN_500.length),
        'content-type': 'text/plain',
      });
      reply.end(PLAIN_500);
      return;
    }
    if (route === 'premature31') {
      reply.respond(200, {
        'content-length': String(PREMATURE_PREFIX.length + 128),
        'content-type': 'application/octet-stream',
      });
      await reply.write(PREMATURE_PREFIX);
      prefixWritten?.release();
      await delay(300);
      reply.destroy();
      return;
    }
    const body = route === 'invalid' ? TRUNCATED_GZIP : FULL_GZIP;
    const status = route === 'invalid' && protocol === 'h1' ? 500 : 200;
    reply.respond(status, {
      'content-encoding': 'gzip',
      'content-length': String(body.length),
      'content-type': 'application/octet-stream',
    });
    reply.end(body);
  });

  const faultStart = processFaults.length;
  let calls = 0;
  let result: ObserverResult | undefined;
  let midflight: CaseSnapshot | undefined;
  try {
    const client = clientFor(protocol);
    calls += 1;
    const facade = client.download(
      fixture.baseUrl + '/' + route,
      context.target,
      {
        cache: false,
        decompress: true,
        retry: false,
        timeout: 5_000,
      },
    );
    const observer = observeDownload(facade, context);
    if (prefixWritten !== undefined) {
      await within(prefixWritten.promise, 3_000, 'premature prefix was not written');
      midflight = await waitForVisibleWrite(
        context,
        PREMATURE_PREFIX,
        1,
        protocol + '-premature31',
      );
    }
    result = await settleDownload(facade, observer, context, faultStart);
    return {
      calls,
      hits,
      midflight,
      processFaults: processFaults.slice(faultStart),
      result,
    };
  } finally {
    prefixWritten?.forceReleaseForCleanup();
    await fixture.close();
    await cleanupCase(context);
    if (result === undefined) {
      fixtureErrors.push(protocol + '-' + route + ':no-result');
    }
  }
}

function terminalSequence(result: ObserverResult): string[] {
  return result.events.filter(
    (event) => event === 'error'
      || event === 'finish'
      || event === 'done'
      || event === 'complete',
  );
}

function fileHasHash(snapshot: CaseSnapshot, expected: Buffer): boolean {
  return snapshot.target.kind === 'file'
    && snapshot.target.length === expected.length
    && snapshot.target.sha256 === sha256(expected);
}

function stageHasHash(snapshot: CaseSnapshot, expected: Buffer): boolean {
  return snapshot.stages.some(
    (stage) => stage.snapshot.kind === 'file'
      && stage.snapshot.length === expected.length
      && stage.snapshot.sha256 === sha256(expected),
  );
}

function desiredConcurrentStageAssertions(
  afterAFirst: CaseSnapshot,
  afterBFirst: CaseSnapshot,
  afterAFinish: CaseSnapshot,
  expectedABytes?: Buffer,
  expectedBBytes?: Buffer,
): CaseSnapshot['stages'] {
  expect(afterAFirst.stages).toHaveLength(1);
  expect(afterBFirst.stages).toHaveLength(2);
  expect(afterAFinish.stages).toHaveLength(1);
  expect(afterAFirst.stages.every((stage) => stage.snapshot.kind === 'file')).toBe(true);
  expect(afterBFirst.stages.every((stage) => stage.snapshot.kind === 'file')).toBe(true);
  if (expectedABytes !== undefined) {
    expect(stageHasHash(afterAFirst, expectedABytes)).toBe(true);
    expect(stageHasHash(afterBFirst, expectedABytes)).toBe(true);
  }
  if (expectedBBytes !== undefined) {
    expect(stageHasHash(afterBFirst, expectedBBytes)).toBe(true);
  }
  const aStageName = afterAFirst.stages[0]?.name;
  const bStage = afterBFirst.stages.find((stage) => stage.name !== aStageName);
  expect(aStageName).toBeDefined();
  expect(bStage).toBeDefined();
  if (aStageName === undefined || bStage === undefined) return [];
  expect(afterBFirst.stages.some((stage) => stage.name === aStageName)).toBe(true);
  expect(afterAFinish.stages).toEqual([bStage]);
  return [bStage];
}

async function waitForVisibleWrite(
  context: CaseContext,
  expectedBytes: Buffer,
  expectedStageCount: number,
  label: string,
): Promise<CaseSnapshot> {
  const deadline = Date.now() + 250;
  let snapshot = snapshotCaseSync(context);
  while (Date.now() < deadline) {
    if (
      fileHasHash(snapshot, expectedBytes)
      || (
        snapshot.stages.length >= expectedStageCount
        && stageHasHash(snapshot, expectedBytes)
      )
    ) {
      return snapshot;
    }
    await delay(10);
    snapshot = snapshotCaseSync(context);
  }
  fixtureErrors.push(label + ':active-write-not-observed');
  return snapshot;
}

interface ErrorContract {
  readonly code: string;
  readonly errno: number;
  readonly message: string;
  readonly name: string;
  readonly responseStatus: number | undefined;
  readonly status: number | undefined;
}

function decompressionError(status: number): ErrorContract {
  return {
    code: 'REZ_DECOMPRESSION_ERROR',
    errno: -1029,
    message: 'Decompression failed',
    name: 'RezoError',
    responseStatus: status,
    status,
  };
}

function resetError(): ErrorContract {
  return {
    code: 'ECONNRESET',
    errno: -104,
    message: RUNTIME === 'node'
      ? 'aborted'
      : 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
    name: 'RezoError',
    responseStatus: 200,
    status: 200,
  };
}

function httpStatusError(status: number): ErrorContract {
  return {
    code: 'REZ_HTTP_ERROR',
    errno: -1031,
    message: 'Request failed with status code ' + status,
    name: 'RezoError',
    responseStatus: status,
    status,
  };
}

function downloadError(status: number): ErrorContract {
  return {
    code: 'REZ_DOWNLOAD_FAILED',
    errno: -1030,
    message: 'Download failed',
    name: 'RezoError',
    responseStatus: status,
    status,
  };
}

function rawUnlinkError(targetPath: string): ErrorContract {
  return {
    code: 'EPERM',
    errno: -1,
    message: "EPERM: operation not permitted, unlink '" + targetPath + "'",
    name: 'Error',
    responseStatus: undefined,
    status: undefined,
  };
}

function unknownUnlinkError(targetPath: string): ErrorContract {
  return {
    code: 'REZ_UNKNOWN_ERROR',
    errno: -9999,
    message: "EPERM: operation not permitted, unlink '" + targetPath + "'",
    name: 'RezoError',
    responseStatus: undefined,
    status: undefined,
  };
}

function exactErrorSnapshot(
  actual: ErrorSnapshot | undefined,
  expected: ErrorContract,
): boolean {
  return actual !== undefined
    && actual.code === expected.code
    && actual.errno === expected.errno
    && actual.message === expected.message
    && actual.name === expected.name
    && actual.responseStatus === expected.responseStatus
    && actual.status === expected.status;
}

function exactTerminalCapture(
  capture: TerminalCapture | undefined,
  event: TerminalCapture['event'],
  expectedSnapshot: CaseSnapshot,
): boolean {
  return capture !== undefined
    && capture.event === event
    && !capture.finishedInsideListener
    && JSON.stringify(capture.snapshot) === JSON.stringify(expectedSnapshot);
}

function exactSingleErrorResult(
  result: ObserverResult,
  expected: ErrorContract,
): boolean {
  return result.errors.length === 1
    && exactErrorSnapshot(result.errors[0], expected)
    && terminalSequence(result).join(',') === 'error'
    && !result.finished
    && result.stable
    && result.terminalCaptures.length === 1
    && exactTerminalCapture(result.terminalCaptures[0], 'error', result.final);
}

function exactSuccessResult(
  result: ObserverResult,
  expected: Buffer,
  expectedStages: CaseSnapshot['stages'] = [],
): boolean {
  return result.errors.length === 0
    && terminalSequence(result).join(',') === 'finish,done,complete'
    && result.finished
    && fileHasHash(result.final, expected)
    && JSON.stringify(result.final.stages) === JSON.stringify(expectedStages)
    && result.stable
    && result.terminalCaptures.length === 3
    && result.terminalCaptures.every((capture, index) =>
      exactTerminalCapture(
        capture,
        (['finish', 'done', 'complete'] as const)[index],
        result.final,
      ),
    );
}

function desiredErrorAssertions(
  result: ObserverResult,
  expected: ErrorContract,
): void {
  expect(result.errors).toHaveLength(1);
  expect(exactErrorSnapshot(result.errors[0], expected)).toBe(true);
  expect(terminalSequence(result)).toEqual(['error']);
  expect(result.finished).toBe(false);
  expect(result.final.stages).toEqual([]);
  expect(result.stable).toBe(true);
  expect(result.terminalCaptures).toHaveLength(1);
  expect(exactTerminalCapture(result.terminalCaptures[0], 'error', result.final)).toBe(true);
}

function desiredSuccessAssertions(
  result: ObserverResult,
  expected: Buffer,
): void {
  expect(exactSuccessResult(result, expected)).toBe(true);
}

interface AliasOutcome {
  readonly atPublicPromise: CaseSnapshot;
  readonly calls: number;
  readonly hits: number;
  readonly processFaults: readonly ErrorSnapshot[];
  readonly result: ObserverResult;
}

type AliasEntry = 'get' | 'request';
type AliasTarget = 'fileName' | 'saveTo';

interface AliasLegCase {
  readonly entry: AliasEntry;
  readonly leg: LegId;
  readonly protocol: Protocol;
  readonly targetOption: AliasTarget;
}

const ALIAS_LEGS = [
  { entry: 'request', leg: 'R36-04-H1-REQUEST-SAVETO', protocol: 'h1', targetOption: 'saveTo' },
  { entry: 'request', leg: 'R36-04-H1-REQUEST-FILENAME', protocol: 'h1', targetOption: 'fileName' },
  { entry: 'get', leg: 'R36-04-H1-GET-SAVETO', protocol: 'h1', targetOption: 'saveTo' },
  { entry: 'get', leg: 'R36-04-H1-GET-FILENAME', protocol: 'h1', targetOption: 'fileName' },
  { entry: 'request', leg: 'R36-04-H2-REQUEST-SAVETO', protocol: 'h2', targetOption: 'saveTo' },
  { entry: 'request', leg: 'R36-04-H2-REQUEST-FILENAME', protocol: 'h2', targetOption: 'fileName' },
  { entry: 'get', leg: 'R36-04-H2-GET-SAVETO', protocol: 'h2', targetOption: 'saveTo' },
  { entry: 'get', leg: 'R36-04-H2-GET-FILENAME', protocol: 'h2', targetOption: 'fileName' },
] satisfies readonly AliasLegCase[];

async function runAliasCase(
  protocol: Protocol,
  entry: AliasEntry = 'request',
  targetOption: AliasTarget = 'saveTo',
): Promise<AliasOutcome> {
  const label = protocol + '-alias-' + entry + '-' + targetOption;
  const context = await createCase(label, 'file');
  const requestArrived = new Gate(label + '-arrived');
  const responseRelease = new Gate(label + '-release');
  let hits = 0;
  const fixture = await startFixture(protocol, async (_path, reply) => {
    hits += 1;
    requestArrived.release();
    await responseRelease.promise;
    const status = protocol === 'h1' ? 500 : 200;
    reply.respond(status, {
      'content-encoding': 'gzip',
      'content-length': String(TRUNCATED_GZIP.length),
    });
    reply.end(TRUNCATED_GZIP);
  });
  const faultStart = processFaults.length;
  let calls = 0;
  let result: ObserverResult | undefined;
  try {
    const client = clientFor(protocol);
    let pending: Promise<unknown>;
    calls += 1;
    if (entry === 'request' && targetOption === 'saveTo') {
      pending = client.request({
        cache: false,
        decompress: true,
        method: 'GET',
        retry: false,
        saveTo: context.target,
        timeout: 5_000,
        url: fixture.baseUrl + '/alias',
      });
    } else if (entry === 'request') {
      pending = client.request({
        cache: false,
        decompress: true,
        fileName: context.target,
        method: 'GET',
        retry: false,
        timeout: 5_000,
        url: fixture.baseUrl + '/alias',
      });
    } else if (targetOption === 'saveTo') {
      pending = client.get(fixture.baseUrl + '/alias', {
        cache: false,
        decompress: true,
        retry: false,
        saveTo: context.target,
        timeout: 5_000,
      });
    } else {
      pending = client.get(fixture.baseUrl + '/alias', {
        cache: false,
        decompress: true,
        fileName: context.target,
        retry: false,
        timeout: 5_000,
      });
    }
    await within(requestArrived.promise, 3_000, 'alias request did not arrive');
    const value = await within(
      Promise.resolve(pending),
      2_000,
      'alias promise did not yield facade while response held',
    );
    const facade = requireDownloadFacade(value);
    const atPublicPromise = snapshotCaseSync(context);
    if (facade.isFinished()) {
      throw new InfrastructureError('alias facade finished before response release');
    }
    const observer = observeDownload(facade, context);
    responseRelease.release();
    result = await settleDownload(facade, observer, context, faultStart);
    return {
      atPublicPromise,
      calls,
      hits,
      processFaults: processFaults.slice(faultStart),
      result,
    };
  } finally {
    requestArrived.forceReleaseForCleanup();
    responseRelease.forceReleaseForCleanup();
    await fixture.close();
    await cleanupCase(context);
    if (result === undefined) fixtureErrors.push(label + ':no-result');
  }
}

interface RetryOutcome {
  readonly beforeRetry: readonly CaseSnapshot[];
  readonly calls: number;
  readonly condition: readonly CaseSnapshot[];
  readonly conditionErrors: readonly ErrorSnapshot[];
  readonly hits: number;
  readonly onRetry: readonly CaseSnapshot[];
  readonly processFaults: readonly ErrorSnapshot[];
  readonly result: ObserverResult;
}

async function runRetryCase(protocol: Protocol): Promise<RetryOutcome> {
  const context = await createCase(protocol + '-retry', 'file');
  let hits = 0;
  const fixture = await startFixture(protocol, (_path, reply) => {
    hits += 1;
    const first = hits === 1;
    const body = first ? TRUNCATED_GZIP : FULL_GZIP;
    const status = first && protocol === 'h1' ? 500 : 200;
    reply.respond(status, {
      'content-encoding': 'gzip',
      'content-length': String(body.length),
    });
    reply.end(body);
  });
  const condition: CaseSnapshot[] = [];
  const onRetry: CaseSnapshot[] = [];
  const beforeRetry: CaseSnapshot[] = [];
  const conditionErrors: ErrorSnapshot[] = [];
  const faultStart = processFaults.length;
  let calls = 0;
  let result: ObserverResult | undefined;
  try {
    const client = clientFor(protocol);
    calls += 1;
    const facade = client.download(
      fixture.baseUrl + '/retry',
      context.target,
      {
        cache: false,
        decompress: true,
        hooks: {
          beforeRetry: [() => {
            beforeRetry.push(snapshotCaseSync(context));
          }],
        },
        retry: {
          condition: (error, attempt) => {
            conditionErrors.push(errorSnapshot(error));
            condition.push(snapshotCaseSync(context));
            return attempt === 1;
          },
          delay: 0,
          limit: 1,
          onRetry: () => {
            onRetry.push(snapshotCaseSync(context));
          },
        },
        timeout: 5_000,
      },
    );
    const observer = observeDownload(facade, context);
    result = await settleDownload(facade, observer, context, faultStart);
    return {
      beforeRetry,
      calls,
      condition,
      conditionErrors,
      hits,
      onRetry,
      processFaults: processFaults.slice(faultStart),
      result,
    };
  } finally {
    await fixture.close();
    await cleanupCase(context);
    if (result === undefined) fixtureErrors.push(protocol + '-retry:no-result');
  }
}

interface RedirectOutcome {
  readonly atFinalArrival: readonly CaseSnapshot[];
  readonly beforeRedirect: readonly CaseSnapshot[];
  readonly calls: number;
  readonly hits: number;
  readonly paths: readonly string[];
  readonly processFaults: readonly ErrorSnapshot[];
  readonly result: ObserverResult;
}

async function runRedirectCase(protocol: Protocol): Promise<RedirectOutcome> {
  const context = await createCase(protocol + '-redirect', 'file');
  let hits = 0;
  const paths: string[] = [];
  const atFinalArrival: CaseSnapshot[] = [];
  const fixture = await startFixture(protocol, (path, reply) => {
    hits += 1;
    paths.push(path);
    if (path === '/source') {
      reply.respond(302, {
        'content-length': '0',
        location: '/final',
      });
      reply.end();
      return;
    }
    atFinalArrival.push(snapshotCaseSync(context));
    reply.respond(200, {
      'content-encoding': 'gzip',
      'content-length': String(FULL_GZIP.length),
    });
    reply.end(FULL_GZIP);
  });
  const beforeRedirect: CaseSnapshot[] = [];
  const faultStart = processFaults.length;
  let calls = 0;
  let result: ObserverResult | undefined;
  try {
    const client = clientFor(protocol);
    calls += 1;
    const facade = client.download(
      fixture.baseUrl + '/source',
      context.target,
      {
        cache: false,
        decompress: true,
        hooks: {
          beforeRedirect: [() => {
            beforeRedirect.push(snapshotCaseSync(context));
          }],
        },
        retry: false,
        timeout: 5_000,
      },
    );
    const observer = observeDownload(facade, context);
    result = await settleDownload(facade, observer, context, faultStart);
    return {
      atFinalArrival,
      beforeRedirect,
      calls,
      hits,
      paths,
      processFaults: processFaults.slice(faultStart),
      result,
    };
  } finally {
    await fixture.close();
    await cleanupCase(context);
    if (result === undefined) fixtureErrors.push(protocol + '-redirect:no-result');
  }
}

interface ConcurrencyOutcome {
  readonly aResult: ObserverResult;
  readonly afterAFinish: CaseSnapshot;
  readonly afterAFirst: CaseSnapshot;
  readonly afterBFirst: CaseSnapshot;
  readonly bResult: ObserverResult;
  readonly callsA: number;
  readonly callsB: number;
  readonly final: CaseSnapshot;
  readonly hitsA: number;
  readonly hitsB: number;
  readonly processFaults: readonly ErrorSnapshot[];
}

async function runConcurrencyCase(protocol: Protocol): Promise<ConcurrencyOutcome> {
  const context = await createCase(protocol + '-concurrent', 'file');
  const aStarted = new Gate(protocol + '-concurrent-a-started');
  const bStarted = new Gate(protocol + '-concurrent-b-started');
  const releaseA = new Gate(protocol + '-concurrent-a-release');
  const releaseB = new Gate(protocol + '-concurrent-b-release');
  let hitsA = 0;
  let hitsB = 0;
  const fixture = await startFixture(protocol, async (path, reply) => {
    if (path === '/a') {
      hitsA += 1;
      reply.respond(200, { 'content-length': String(A_COMPLETE.length) });
      await reply.write(A_FIRST);
      aStarted.release();
      await releaseA.promise;
      reply.end(A_LAST);
      return;
    }
    hitsB += 1;
    reply.respond(200, { 'content-length': String(B_COMPLETE.length) });
    await reply.write(B_FIRST);
    bStarted.release();
    await releaseB.promise;
    reply.end(B_LAST);
  });
  const faultStart = processFaults.length;
  let callsA = 0;
  let callsB = 0;
  let complete = false;
  try {
    const client = clientFor(protocol);
    callsA += 1;
    const aFacade = client.download(
      fixture.baseUrl + '/a',
      context.target,
      { cache: false, decompress: true, retry: false, timeout: 6_000 },
    );
    const aObserver = observeDownload(aFacade, context);
    await within(aStarted.promise, 3_000, protocol + ' A did not start');
    const afterAFirst = protocol === 'h1'
      ? await waitForVisibleWrite(
          context,
          A_FIRST,
          1,
          protocol + '-concurrent-a',
        )
      : snapshotCaseSync(context);

    callsB += 1;
    const bFacade = client.download(
      fixture.baseUrl + '/b',
      context.target,
      { cache: false, decompress: true, retry: false, timeout: 6_000 },
    );
    const bObserver = observeDownload(bFacade, context);
    await within(bStarted.promise, 3_000, protocol + ' B did not start');
    const afterBFirst = protocol === 'h1'
      ? await waitForVisibleWrite(
          context,
          B_FIRST,
          2,
          protocol + '-concurrent-b',
        )
      : snapshotCaseSync(context);

    releaseA.release();
    const aResult = await settleDownload(aFacade, aObserver, context, faultStart);
    const afterAFinish = snapshotCaseSync(context);
    releaseB.release();
    const bResult = await settleDownload(bFacade, bObserver, context, faultStart);
    const final = snapshotCaseSync(context);
    complete = true;
    return {
      aResult,
      afterAFinish,
      afterAFirst,
      afterBFirst,
      bResult,
      callsA,
      callsB,
      final,
      hitsA,
      hitsB,
      processFaults: processFaults.slice(faultStart),
    };
  } finally {
    aStarted.forceReleaseForCleanup();
    bStarted.forceReleaseForCleanup();
    releaseA.forceReleaseForCleanup();
    releaseB.forceReleaseForCleanup();
    await fixture.close();
    await cleanupCase(context);
    if (!complete) fixtureErrors.push(protocol + '-concurrent:no-result');
  }
}

interface DirectoryOutcome {
  readonly calls: number;
  readonly hits: number;
  readonly processFaults: readonly ErrorSnapshot[];
  readonly result: ObserverResult;
  readonly targetPath: string;
}

async function runDirectoryCase(protocol: Protocol): Promise<DirectoryOutcome> {
  const context = await createCase(protocol + '-directory', 'directory');
  let hits = 0;
  const fixture = await startFixture(protocol, (_path, reply) => {
    hits += 1;
    reply.respond(200, {
      'content-length': String(PAYLOAD.length),
      'content-type': 'application/octet-stream',
    });
    reply.end(PAYLOAD);
  });
  const faultStart = processFaults.length;
  let calls = 0;
  let result: ObserverResult | undefined;
  try {
    const client = clientFor(protocol);
    calls += 1;
    const facade = client.download(
      fixture.baseUrl + '/directory',
      context.target,
      { cache: false, decompress: true, retry: false, timeout: 5_000 },
    );
    const observer = observeDownload(facade, context);
    result = await settleDownload(facade, observer, context, faultStart);
    return {
      calls,
      hits,
      processFaults: processFaults.slice(faultStart),
      result,
      targetPath: context.target,
    };
  } finally {
    await fixture.close();
    await cleanupCase(context);
    if (result === undefined) fixtureErrors.push(protocol + '-directory:no-result');
  }
}

function snapshotsAllHash(
  snapshots: readonly CaseSnapshot[],
  expected: Buffer,
): boolean {
  return snapshots.length !== 0
    && snapshots.every(
      (snapshot) => fileHasHash(snapshot, expected) && snapshot.stages.length === 0,
    );
}

function snapshotsAllAbsent(snapshots: readonly CaseSnapshot[]): boolean {
  return snapshots.length !== 0
    && snapshots.every(
      (snapshot) => snapshot.target.kind === 'absent' && snapshot.stages.length === 0,
    );
}

let requireBridge: NodeRequireBridge | undefined;

beforeAll(async () => {
  try {
    installProcessObservers();
    assertFixturePins();
    if (await getFS() === undefined) {
      requireBridge = installNodeRequireBridge();
      if (await getFS() === undefined) {
        throw new InfrastructureError('require bridge did not enable filesystem access');
      }
    }
  } catch (error) {
    setupErrors.push(error instanceof Error ? error.message : String(error));
    throw error;
  }
});

afterAll(async () => {
  for (const gate of [...activeGates]) gate.forceReleaseForCleanup();
  recordHttp2PoolInvalidityBeforeDestroy('after-all');
  Http2SessionPool.getInstance().destroy();
  for (const stream of [...activeHttp2Streams]) stream.destroy();
  for (const session of [...activeHttp2Sessions]) session.destroy();
  for (const socket of [...activeSockets]) socket.destroy();
  if (activeTimers.size !== 0) {
    cleanupErrors.push('active-timers-before-forced-cleanup:' + activeTimers.size);
  }
  for (const timer of [...activeTimers]) clearTimeout(timer);
  activeTimers.clear();

  try {
    requireBridge?.restore();
    requireBridge = undefined;
  } catch (error) {
    teardownErrors.push(
      'require-bridge:' + (error instanceof Error ? error.message : String(error)),
    );
  }
  restoreProcessObservers();

  const actualRed = [...observedFailures].sort();
  const actualPassed = [...observedPasses].sort();
  const actualRegistered = [...observedInvocations.keys()].sort();
  const expectedRed = [...EXPECTED_RED].sort();
  const expectedPassed = [...EXPECTED_PASSED].sort();
  const expectedRegistered = [...REGISTERED].sort();
  const expectedLegs = [...EXPECTED_LEGS].sort();
  const actualLegs = [...observedLegs.keys()].sort();
  const oracleMismatches = [...oracleInvalidations];

  if (armedRed.size !== 0) {
    oracleMismatches.push('armed-after-file:' + JSON.stringify([...armedRed].sort()));
  }
  for (const id of REGISTERED) {
    const count = observedInvocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push('row-invocations:' + id + ':' + count);
  }
  if (JSON.stringify(actualRegistered) !== JSON.stringify(expectedRegistered)) {
    oracleMismatches.push('registered:' + JSON.stringify(actualRegistered));
  }
  if (JSON.stringify(actualRed) !== JSON.stringify(expectedRed)) {
    oracleMismatches.push('red:' + JSON.stringify(actualRed));
  }
  if (JSON.stringify(actualPassed) !== JSON.stringify(expectedPassed)) {
    oracleMismatches.push('passed:' + JSON.stringify(actualPassed));
  }
  if (JSON.stringify(actualLegs) !== JSON.stringify(expectedLegs)) {
    oracleMismatches.push('legs:' + JSON.stringify(actualLegs));
  }
  for (const id of EXPECTED_LEGS) {
    const record = observedLegs.get(id);
    if (record === undefined || record.invocations !== 1) {
      oracleMismatches.push('leg-invocations:' + id);
      continue;
    }
    const expectedCalls = id.startsWith('R36-10-') ? 2 : 1;
    const expectedHits = id.startsWith('R36-08-')
      || id.startsWith('R36-09-')
      || id.startsWith('R36-10-')
      ? 2
      : 1;
    if (record.calls !== expectedCalls) {
      oracleMismatches.push('leg-calls:' + id + ':' + record.calls);
    }
    if (record.hits !== expectedHits) {
      oracleMismatches.push('leg-hits:' + id + ':' + record.hits);
    }
    if (id.startsWith('R36-10-')) {
      for (const field of ['callsA', 'callsB', 'hitsA', 'hitsB']) {
        if (errorField(record.details, field) !== 1) {
          oracleMismatches.push('leg-concurrent-' + field + ':' + id);
        }
      }
    }
  }
  if (processFaults.length !== 0) {
    oracleMismatches.push('process-faults:' + JSON.stringify(processFaults));
  }

  const pool = Http2SessionPool.getInstance();
  pool.destroy();
  const poolEntries = errorField(pool, 'entriesBySession');
  const poolSessions = errorField(pool, 'sessions');
  const pendingCreations = errorField(pool, 'pendingCreations');
  const cleanupInterval = errorField(pool, 'cleanupInterval');
  const http2Leases = poolEntries instanceof Map
    ? [...poolEntries.values()].reduce((total, entry) => {
        const count = errorField(entry, 'refCount');
        return total + (typeof count === 'number' ? count : 0);
      }, 0)
    : -1;
  const http2PoolEntries = poolEntries instanceof Map ? poolEntries.size : -1;
  const http2SessionEntries = poolSessions instanceof Map ? poolSessions.size : -1;
  const http2PendingCreations = pendingCreations instanceof Set
    ? pendingCreations.size
    : -1;
  if (cleanupInterval !== null) {
    cleanupErrors.push('http2-cleanup-interval-not-null');
  }

  const cleanup = {
    children: 0,
    complete: cleanupErrors.length === 0
      && teardownErrors.length === 0
      && activeFinalTargets.size === 0
      && activeGates.size === 0
      && http2Leases === 0
      && http2PendingCreations === 0
      && http2PoolEntries === 0
      && http2SessionEntries === 0
      && activeHttp2Sessions.size === 0
      && activeHttp2Streams.size === 0
      && activeOwnedStages.size === 0
      && !processObserversInstalled
      && activeServers.size === 0
      && activeSockets.size === 0
      && activeTemporaryDirectories.size === 0
      && activeTemporaryFiles.size === 0
      && activeTimers.size === 0,
    finalTargets: activeFinalTargets.size,
    gates: activeGates.size,
    http2Leases,
    http2PendingCreations,
    http2PoolEntries: http2PoolEntries + http2SessionEntries,
    http2Sessions: activeHttp2Sessions.size,
    http2Streams: activeHttp2Streams.size,
    ownedStages: activeOwnedStages.size,
    processObservers: processObserversInstalled ? 1 : 0,
    servers: activeServers.size,
    sockets: activeSockets.size,
    temporaryDirectories: activeTemporaryDirectories.size,
    temporaryFiles: activeTemporaryFiles.size,
    timers: activeTimers.size,
  };

  const legs = Object.fromEntries(
    [...observedLegs.entries()]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const ledger = {
    cleanup,
    cleanupErrors,
    file: FILE,
    fixtureErrors,
    lateEvents,
    legs,
    oracleMismatches,
    passed: actualPassed,
    red: actualRed,
    registered: actualRegistered,
    runtime: RUNTIME,
    runtimeVersion: RUNTIME_VERSION,
    schema: 'rezo.r36.download-target-integrity.ledger/v1',
    setupErrors,
    skipped: [],
    teardownErrors,
  };
  console.log('REZO_R36_LEDGER_V1:' + JSON.stringify(ledger));
});

it('fixture pins are exact', () => {
  assertFixturePins();
});

it('R36-01 H1 invalid download preserves an existing target', async () => {
  await observeRow('R36-01', async () => {
    const outcome = await runStandardCase('h1', 'invalid', 'file');
    recordLeg(
      'R36-01-H1-DOWNLOAD',
      'h1',
      outcome.result,
      {
        errors: outcome.result.errors,
        events: outcome.result.events,
        final: outcome.result.final,
        processFaults: outcome.processFaults,
      },
      outcome.calls,
      outcome.hits,
    );
    const acceptedCurrent = exactSingleErrorResult(
      outcome.result,
      decompressionError(500),
    )
      && outcome.calls === 1
      && outcome.result.final.target.kind === 'absent'
      && outcome.result.final.stages.length === 0
      && outcome.result.events.join(',') === H1_FAILURE_EVENTS
      && outcome.hits === 1
      && outcome.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-01');
    desiredErrorAssertions(outcome.result, decompressionError(500));
    expect(outcome.result.events.join(',')).toBe(H1_FAILURE_EVENTS);
    expect(fileHasHash(outcome.result.final, SENTINEL)).toBe(true);
  });
});

it('R36-02 H2 invalid download preserves an existing target', async () => {
  await observeRow('R36-02', async () => {
    const outcome = await runStandardCase('h2', 'invalid', 'file');
    recordLeg(
      'R36-02-H2-DOWNLOAD',
      'h2',
      outcome.result,
      {
        errors: outcome.result.errors,
        events: outcome.result.events,
        final: outcome.result.final,
        processFaults: outcome.processFaults,
      },
      outcome.calls,
      outcome.hits,
    );
    const acceptedCurrent = exactSingleErrorResult(
      outcome.result,
      decompressionError(200),
    )
      && outcome.calls === 1
      && outcome.result.final.target.kind === 'absent'
      && outcome.result.final.stages.length === 0
      && outcome.result.events.join(',') === H2_FAILURE_EVENTS
      && outcome.hits === 1
      && outcome.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-02');
    desiredErrorAssertions(outcome.result, decompressionError(200));
    expect(outcome.result.events.join(',')).toBe(H2_FAILURE_EVENTS);
    expect(fileHasHash(outcome.result.final, SENTINEL)).toBe(true);
  });
});

it('R36-03 H1 premature transfer never exposes partial final bytes', async () => {
  await observeRow('R36-03', async () => {
    const outcome = await runStandardCase('h1', 'premature31', 'file');
    recordLeg(
      'R36-03-H1-PREMATURE31',
      'h1',
      outcome.result,
      {
        errors: outcome.result.errors,
        events: outcome.result.events,
        final: outcome.result.final,
        midflight: outcome.midflight,
        processFaults: outcome.processFaults,
      },
      outcome.calls,
      outcome.hits,
    );
    const acceptedCurrent = outcome.midflight !== undefined
      && outcome.calls === 1
      && fileHasHash(outcome.midflight, PREMATURE_PREFIX)
      && outcome.midflight.stages.length === 0
      && exactSingleErrorResult(outcome.result, resetError())
      && outcome.result.final.target.kind === 'absent'
      && outcome.result.final.stages.length === 0
      && exactH1PrematureFailureEvents(outcome.result.events)
      && outcome.hits === 1
      && outcome.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-03');
    desiredErrorAssertions(outcome.result, resetError());
    expect(exactH1PrematureFailureEvents(outcome.result.events)).toBe(true);
    expect(outcome.midflight).toBeDefined();
    expect(fileHasHash(outcome.midflight ?? outcome.result.final, SENTINEL)).toBe(true);
    expect(outcome.midflight?.stages).toHaveLength(1);
    expect(stageHasHash(outcome.midflight ?? outcome.result.final, PREMATURE_PREFIX)).toBe(true);
    expect(fileHasHash(outcome.result.final, SENTINEL)).toBe(true);
  });
});

it('R36-04 initial-target aliases preserve existing targets', async () => {
  await observeRow('R36-04', async () => {
    const outcomes: Array<{
      readonly outcome: AliasOutcome;
      readonly spec: AliasLegCase;
    }> = [];
    for (const spec of ALIAS_LEGS) {
      const outcome = await runAliasCase(
        spec.protocol,
        spec.entry,
        spec.targetOption,
      );
      outcomes.push({ outcome, spec });
      recordLeg(
        spec.leg,
        spec.protocol,
        outcome.result,
        {
          atPublicPromise: outcome.atPublicPromise,
          errors: outcome.result.errors,
          events: outcome.result.events,
          final: outcome.result.final,
          finished: outcome.result.finished,
          processFaults: outcome.processFaults,
          terminalCaptures: outcome.result.terminalCaptures,
        },
        outcome.calls,
        outcome.hits,
      );
    }
    const acceptedCurrent = outcomes.every(({ outcome, spec }) => {
      const status = spec.protocol === 'h1' ? 500 : 200;
      const expectedEvents = spec.protocol === 'h1'
        ? 'headers,status,cookies,error'
        : 'headers,status,cookies,progress,error';
      return fileHasHash(outcome.atPublicPromise, SENTINEL)
        && outcome.atPublicPromise.stages.length === 0
        && outcome.calls === 1
        && exactSingleErrorResult(outcome.result, decompressionError(status))
        && outcome.result.events.join(',') === expectedEvents
        && outcome.result.final.target.kind === 'absent'
        && outcome.result.final.stages.length === 0
        && outcome.hits === 1
        && outcome.processFaults.length === 0;
    });
    if (acceptedCurrent) armRed('R36-04');
    for (const { outcome, spec } of outcomes) {
      const expectedEvents = spec.protocol === 'h1'
        ? 'headers,status,cookies,error'
        : 'headers,status,cookies,progress,error';
      expect(outcome.calls).toBe(1);
      expect(outcome.hits).toBe(1);
      expect(fileHasHash(outcome.atPublicPromise, SENTINEL)).toBe(true);
      expect(outcome.atPublicPromise.stages).toEqual([]);
      desiredErrorAssertions(
        outcome.result,
        decompressionError(spec.protocol === 'h1' ? 500 : 200),
      );
      expect(outcome.result.events.join(',')).toBe(expectedEvents);
      expect(fileHasHash(outcome.result.final, SENTINEL)).toBe(true);
    }
  });
});

it('R36-05 fresh-target failures leave no destination or residue', async () => {
  await observeRow('R36-05', async () => {
    const h1Invalid = await runStandardCase('h1', 'invalid', 'absent');
    const h2Invalid = await runStandardCase('h2', 'invalid', 'absent');
    const h1Premature = await runStandardCase('h1', 'premature31', 'absent');
    recordLeg(
      'R36-05-H1-FRESH-GZIP',
      'h1',
      h1Invalid.result,
      {
        errors: h1Invalid.result.errors,
        events: h1Invalid.result.events,
        final: h1Invalid.result.final,
      },
      h1Invalid.calls,
      h1Invalid.hits,
    );
    recordLeg(
      'R36-05-H2-FRESH-GZIP',
      'h2',
      h2Invalid.result,
      {
        errors: h2Invalid.result.errors,
        events: h2Invalid.result.events,
        final: h2Invalid.result.final,
      },
      h2Invalid.calls,
      h2Invalid.hits,
    );
    recordLeg(
      'R36-05-H1-FRESH-PREMATURE31',
      'h1',
      h1Premature.result,
      {
        errors: h1Premature.result.errors,
        events: h1Premature.result.events,
        final: h1Premature.result.final,
        midflight: h1Premature.midflight,
      },
      h1Premature.calls,
      h1Premature.hits,
    );
    desiredErrorAssertions(
      h1Invalid.result,
      decompressionError(500),
    );
    desiredErrorAssertions(
      h2Invalid.result,
      decompressionError(200),
    );
    desiredErrorAssertions(h1Premature.result, resetError());
    expect(h1Invalid.result.events.join(',')).toBe(H1_FAILURE_EVENTS);
    expect(h2Invalid.result.events.join(',')).toBe(H2_FAILURE_EVENTS);
    expect(exactH1PrematureFailureEvents(h1Premature.result.events)).toBe(true);
    for (const outcome of [h1Invalid, h2Invalid, h1Premature]) {
      expect(outcome.calls).toBe(1);
      expect(outcome.hits).toBe(1);
      expect(outcome.result.final.target.kind).toBe('absent');
      expect(outcome.result.final.stages).toEqual([]);
      expect(outcome.processFaults).toEqual([]);
    }
  });
});

it('R36-06 accepted success preserves exact protocol byte mapping', async () => {
  await observeRow('R36-06', async () => {
    const h1 = await runStandardCase('h1', 'success', 'file');
    const h2 = await runStandardCase('h2', 'success', 'file');
    recordLeg(
      'R36-06-H1-SUCCESS',
      'h1',
      h1.result,
      {
        events: h1.result.events,
        final: h1.result.final,
        terminalCaptures: h1.result.terminalCaptures,
      },
      h1.calls,
      h1.hits,
    );
    recordLeg(
      'R36-06-H2-SUCCESS',
      'h2',
      h2.result,
      {
        events: h2.result.events,
        final: h2.result.final,
        terminalCaptures: h2.result.terminalCaptures,
      },
      h2.calls,
      h2.hits,
    );
    desiredSuccessAssertions(h1.result, FULL_GZIP);
    desiredSuccessAssertions(h2.result, PAYLOAD);
    expect(h1.result.events.join(',')).toBe(SUCCESS_EVENTS);
    expect(h2.result.events.join(',')).toBe(SUCCESS_EVENTS);
    expect(h1.calls).toBe(1);
    expect(h2.calls).toBe(1);
    expect(h1.hits).toBe(1);
    expect(h2.hits).toBe(1);
    expect(h1.processFaults).toEqual([]);
    expect(h2.processFaults).toEqual([]);
  });
});

it('R36-07 plain status errors preserve existing targets', async () => {
  await observeRow('R36-07', async () => {
    const h1 = await runStandardCase('h1', 'plain500', 'file');
    const h2 = await runStandardCase('h2', 'plain500', 'file');
    recordLeg(
      'R36-07-H1-PLAIN500',
      'h1',
      h1.result,
      {
        errors: h1.result.errors,
        events: h1.result.events,
        final: h1.result.final,
      },
      h1.calls,
      h1.hits,
    );
    recordLeg(
      'R36-07-H2-PLAIN500',
      'h2',
      h2.result,
      {
        errors: h2.result.errors,
        events: h2.result.events,
        final: h2.result.final,
      },
      h2.calls,
      h2.hits,
    );
    desiredErrorAssertions(h1.result, httpStatusError(500));
    desiredErrorAssertions(h2.result, httpStatusError(500));
    expect(h1.result.events.join(',')).toBe(H1_FAILURE_EVENTS);
    expect(h2.result.events.join(',')).toBe(H2_STATUS_FAILURE_EVENTS);
    expect(h1.calls).toBe(1);
    expect(h2.calls).toBe(1);
    expect(h1.hits).toBe(1);
    expect(h2.hits).toBe(1);
    expect(fileHasHash(h1.result.final, SENTINEL)).toBe(true);
    expect(fileHasHash(h2.result.final, SENTINEL)).toBe(true);
    expect(h1.processFaults).toEqual([]);
    expect(h2.processFaults).toEqual([]);
  });
});

it('R36-08 retries preserve final ownership until accepted commit', async () => {
  await observeRow('R36-08', async () => {
    const h1 = await runRetryCase('h1');
    const h2 = await runRetryCase('h2');
    recordLeg(
      'R36-08-H1-RETRY',
      'h1',
      h1.result,
      {
        beforeRetry: h1.beforeRetry,
        condition: h1.condition,
        conditionErrors: h1.conditionErrors,
        events: h1.result.events,
        final: h1.result.final,
        onRetry: h1.onRetry,
      },
      h1.calls,
      h1.hits,
    );
    recordLeg(
      'R36-08-H2-RETRY',
      'h2',
      h2.result,
      {
        beforeRetry: h2.beforeRetry,
        condition: h2.condition,
        conditionErrors: h2.conditionErrors,
        events: h2.result.events,
        final: h2.result.final,
        onRetry: h2.onRetry,
      },
      h2.calls,
      h2.hits,
    );
    const acceptedCurrent = h1.hits === 2
      && h2.hits === 2
      && h1.calls === 1
      && h2.calls === 1
      && h1.condition.length === 1
      && h2.condition.length === 1
      && h1.onRetry.length === 1
      && h2.onRetry.length === 1
      && h1.beforeRetry.length === 1
      && h2.beforeRetry.length === 1
      && snapshotsAllAbsent(h1.condition)
      && snapshotsAllAbsent(h2.condition)
      && snapshotsAllAbsent(h1.onRetry)
      && snapshotsAllAbsent(h2.onRetry)
      && snapshotsAllAbsent(h1.beforeRetry)
      && snapshotsAllAbsent(h2.beforeRetry)
      && h1.conditionErrors.length === 1
      && h2.conditionErrors.length === 1
      && exactErrorSnapshot(h1.conditionErrors[0], decompressionError(500))
      && exactErrorSnapshot(h2.conditionErrors[0], decompressionError(200))
      && exactSuccessResult(h1.result, FULL_GZIP)
      && exactSuccessResult(h2.result, PAYLOAD)
      && h1.result.events.join(',') === H1_RETRY_SUCCESS_EVENTS
      && h2.result.events.join(',') === H2_RETRY_SUCCESS_EVENTS
      && h1.processFaults.length === 0
      && h2.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-08');
    desiredSuccessAssertions(h1.result, FULL_GZIP);
    desiredSuccessAssertions(h2.result, PAYLOAD);
    expect(h1.result.events.join(',')).toBe(H1_RETRY_SUCCESS_EVENTS);
    expect(h2.result.events.join(',')).toBe(H2_RETRY_SUCCESS_EVENTS);
    expect(h1.calls).toBe(1);
    expect(h2.calls).toBe(1);
    expect(h1.condition).toHaveLength(1);
    expect(h2.condition).toHaveLength(1);
    expect(h1.onRetry).toHaveLength(1);
    expect(h2.onRetry).toHaveLength(1);
    expect(h1.beforeRetry).toHaveLength(1);
    expect(h2.beforeRetry).toHaveLength(1);
    expect(h1.conditionErrors).toHaveLength(1);
    expect(h2.conditionErrors).toHaveLength(1);
    expect(exactErrorSnapshot(h1.conditionErrors[0], decompressionError(500))).toBe(true);
    expect(exactErrorSnapshot(h2.conditionErrors[0], decompressionError(200))).toBe(true);
    expect(snapshotsAllHash(h1.condition, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h2.condition, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h1.onRetry, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h2.onRetry, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h1.beforeRetry, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h2.beforeRetry, SENTINEL)).toBe(true);
  });
});

it('R36-09 redirect ownership commits only the final accepted hop', async () => {
  await observeRow('R36-09', async () => {
    const h1 = await runRedirectCase('h1');
    const h2 = await runRedirectCase('h2');
    recordLeg(
      'R36-09-H1-REDIRECT',
      'h1',
      h1.result,
      {
        atFinalArrival: h1.atFinalArrival,
        beforeRedirect: h1.beforeRedirect,
        events: h1.result.events,
        final: h1.result.final,
        paths: h1.paths,
      },
      h1.calls,
      h1.hits,
    );
    recordLeg(
      'R36-09-H2-REDIRECT',
      'h2',
      h2.result,
      {
        atFinalArrival: h2.atFinalArrival,
        beforeRedirect: h2.beforeRedirect,
        events: h2.result.events,
        final: h2.result.final,
        paths: h2.paths,
      },
      h2.calls,
      h2.hits,
    );
    expect(h1.hits).toBe(2);
    expect(h2.hits).toBe(2);
    expect(h1.calls).toBe(1);
    expect(h2.calls).toBe(1);
    expect(h1.paths).toEqual(['/source', '/final']);
    expect(h2.paths).toEqual(['/source', '/final']);
    expect(h1.beforeRedirect).toHaveLength(1);
    expect(h2.beforeRedirect).toHaveLength(1);
    expect(h1.atFinalArrival).toHaveLength(1);
    expect(h2.atFinalArrival).toHaveLength(1);
    expect(h1.result.events.filter((event) => event === 'redirect')).toEqual(['redirect']);
    expect(h2.result.events.filter((event) => event === 'redirect')).toEqual(['redirect']); // john 2026-08-29 (HD-7): HTTP/2 emits the documented redirect event once per followed hop, as HTTP/1.1 (was: none)
    expect(h1.result.events.join(',')).toBe(H1_REDIRECT_SUCCESS_EVENTS);
    // john 2026-08-29 (HD-7): the HTTP/2 download facade now hears the redirect event before the final hop's headers, as HTTP/1.1.
    expect(h2.result.events.join(',')).toBe(H1_REDIRECT_SUCCESS_EVENTS);
    expect(snapshotsAllHash(h1.beforeRedirect, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h2.beforeRedirect, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h1.atFinalArrival, SENTINEL)).toBe(true);
    expect(snapshotsAllHash(h2.atFinalArrival, SENTINEL)).toBe(true);
    desiredSuccessAssertions(h1.result, FULL_GZIP);
    desiredSuccessAssertions(h2.result, PAYLOAD);
    expect(h1.processFaults).toEqual([]);
    expect(h2.processFaults).toEqual([]);
  });
});

it('R36-10 concurrent same-target downloads never interleave', async () => {
  await observeRow('R36-10', async () => {
    const h1 = await runConcurrencyCase('h1');
    const h2 = await runConcurrencyCase('h2');
    const h1Combined: ObserverResult = {
      errors: [...h1.aResult.errors, ...h1.bResult.errors],
      events: [...h1.aResult.events, ...h1.bResult.events],
      final: h1.final,
      finished: h1.aResult.finished && h1.bResult.finished,
      stable: h1.aResult.stable && h1.bResult.stable,
      terminalCaptures: [
        ...h1.aResult.terminalCaptures,
        ...h1.bResult.terminalCaptures,
      ],
    };
    const h2Combined: ObserverResult = {
      errors: [...h2.aResult.errors, ...h2.bResult.errors],
      events: [...h2.aResult.events, ...h2.bResult.events],
      final: h2.final,
      finished: h2.aResult.finished && h2.bResult.finished,
      stable: h2.aResult.stable && h2.bResult.stable,
      terminalCaptures: [
        ...h2.aResult.terminalCaptures,
        ...h2.bResult.terminalCaptures,
      ],
    };
    recordLeg(
      'R36-10-H1-CONCURRENT',
      'h1',
      h1Combined,
      {
        aEvents: h1.aResult.events,
        afterAFinish: h1.afterAFinish,
        afterAFirst: h1.afterAFirst,
        afterBFirst: h1.afterBFirst,
        bEvents: h1.bResult.events,
        callsA: h1.callsA,
        callsB: h1.callsB,
        final: h1.final,
        hitsA: h1.hitsA,
        hitsB: h1.hitsB,
      },
      h1.callsA + h1.callsB,
      h1.hitsA + h1.hitsB,
    );
    recordLeg(
      'R36-10-H2-CONCURRENT',
      'h2',
      h2Combined,
      {
        aEvents: h2.aResult.events,
        afterAFinish: h2.afterAFinish,
        afterAFirst: h2.afterAFirst,
        afterBFirst: h2.afterBFirst,
        bEvents: h2.bResult.events,
        callsA: h2.callsA,
        callsB: h2.callsB,
        final: h2.final,
        hitsA: h2.hitsA,
        hitsB: h2.hitsB,
      },
      h2.callsA + h2.callsB,
      h2.hitsA + h2.hitsB,
    );
    const currentAfterA = Buffer.from('BBBBAAAAAAAA');
    const currentFinal = Buffer.from('BBBBDDDDAAAA');
    const acceptedCurrent = h1.hitsA === 1
      && h1.hitsB === 1
      && h1.callsA === 1
      && h1.callsB === 1
      && fileHasHash(h1.afterAFirst, A_FIRST)
      && h1.afterAFirst.stages.length === 0
      && fileHasHash(h1.afterBFirst, B_FIRST)
      && h1.afterBFirst.stages.length === 0
      && fileHasHash(h1.afterAFinish, currentAfterA)
      && h1.afterAFinish.stages.length === 0
      && fileHasHash(h1.final, currentFinal)
      && h1.final.stages.length === 0
      && exactSuccessResult(h1.aResult, currentAfterA)
      && exactSuccessResult(h1.bResult, currentFinal)
      && h1.aResult.events.join(',') === SUCCESS_EVENTS
      && h1.bResult.events.join(',') === SUCCESS_EVENTS
      && h1.processFaults.length === 0
      && h2.hitsA === 1
      && h2.hitsB === 1
      && h2.callsA === 1
      && h2.callsB === 1
      && fileHasHash(h2.afterAFirst, SENTINEL)
      && h2.afterAFirst.stages.length === 0
      && fileHasHash(h2.afterBFirst, SENTINEL)
      && h2.afterBFirst.stages.length === 0
      && fileHasHash(h2.afterAFinish, A_COMPLETE)
      && h2.afterAFinish.stages.length === 0
      && fileHasHash(h2.final, B_COMPLETE)
      && h2.final.stages.length === 0
      && exactSuccessResult(h2.aResult, A_COMPLETE)
      && exactSuccessResult(h2.bResult, B_COMPLETE)
      && h2.aResult.events.join(',') === H2_CONCURRENT_SUCCESS_EVENTS
      && h2.bResult.events.join(',') === H2_CONCURRENT_SUCCESS_EVENTS
      && h2.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-10');

    expect(h2.hitsA).toBe(1);
    expect(h2.hitsB).toBe(1);
    expect(h2.callsA).toBe(1);
    expect(h2.callsB).toBe(1);
    expect(fileHasHash(h2.afterAFirst, SENTINEL)).toBe(true);
    expect(fileHasHash(h2.afterBFirst, SENTINEL)).toBe(true);
    expect(h2.afterAFirst.stages).toEqual([]);
    expect(h2.afterBFirst.stages).toEqual([]);
    expect(fileHasHash(h2.afterAFinish, A_COMPLETE)).toBe(true);
    expect(h2.afterAFinish.stages).toEqual([]);
    expect(fileHasHash(h2.final, B_COMPLETE)).toBe(true);
    expect(h2.final.stages).toEqual([]);
    desiredSuccessAssertions(h2.aResult, A_COMPLETE);
    desiredSuccessAssertions(h2.bResult, B_COMPLETE);
    expect(h2.aResult.events.join(',')).toBe(H2_CONCURRENT_SUCCESS_EVENTS);
    expect(h2.bResult.events.join(',')).toBe(H2_CONCURRENT_SUCCESS_EVENTS);
    expect(h2.processFaults).toEqual([]);

    expect(fileHasHash(h1.afterAFirst, SENTINEL)).toBe(true);
    expect(fileHasHash(h1.afterBFirst, SENTINEL)).toBe(true);
    expect(h1.callsA).toBe(1);
    expect(h1.callsB).toBe(1);
    const h1RemainingStage = desiredConcurrentStageAssertions(
      h1.afterAFirst,
      h1.afterBFirst,
      h1.afterAFinish,
      A_FIRST,
      B_FIRST,
    );
    expect(fileHasHash(h1.afterAFinish, A_COMPLETE)).toBe(true);
    expect(fileHasHash(h1.final, B_COMPLETE)).toBe(true);
    expect(h1.final.stages).toEqual([]);
    expect(exactSuccessResult(h1.aResult, A_COMPLETE, h1RemainingStage)).toBe(true);
    desiredSuccessAssertions(h1.bResult, B_COMPLETE);
    expect(h1.aResult.events.join(',')).toBe(SUCCESS_EVENTS);
    expect(h1.bResult.events.join(',')).toBe(SUCCESS_EVENTS);
    expect(h1.processFaults).toEqual([]);
  });
});

it('R36-11 commit failure preserves a non-file destination and emits once', async () => {
  await observeRow('R36-11', async () => {
    const h1 = await runDirectoryCase('h1');
    const h2 = await runDirectoryCase('h2');
    recordLeg(
      'R36-11-H1-DIRECTORY',
      'h1',
      h1.result,
      {
        errors: h1.result.errors,
        events: h1.result.events,
        final: h1.result.final,
        processFaults: h1.processFaults,
        terminalCaptures: h1.result.terminalCaptures,
      },
      h1.calls,
      h1.hits,
    );
    recordLeg(
      'R36-11-H2-DIRECTORY',
      'h2',
      h2.result,
      {
        errors: h2.result.errors,
        events: h2.result.events,
        final: h2.result.final,
        processFaults: h2.processFaults,
        terminalCaptures: h2.result.terminalCaptures,
      },
      h2.calls,
      h2.hits,
    );
    const directoryPreserved = (result: ObserverResult): boolean =>
      result.final.target.kind === 'directory'
        && result.final.target.entries.join(',') === 'sentinel-child'
        && result.final.target.children.length === 1
        && result.final.target.children[0]?.name === 'sentinel-child'
        && result.final.target.children[0]?.snapshot.kind === 'file'
        && result.final.target.children[0].snapshot.length === SENTINEL.length
        && result.final.target.children[0].snapshot.sha256 === sha256(SENTINEL)
        && result.final.stages.length === 0;
    const expectedEvents = 'initiated,start,headers,status,cookies,progress,error';
    const acceptedCurrent = h1.hits === 1
      && h2.hits === 1
      && h1.calls === 1
      && h2.calls === 1
      && exactSingleErrorResult(h1.result, rawUnlinkError(h1.targetPath))
      && h1.result.events.join(',') === expectedEvents
      && h2.result.errors.length === 2
      && exactErrorSnapshot(h2.result.errors[0], downloadError(200))
      && exactErrorSnapshot(h2.result.errors[1], unknownUnlinkError(h2.targetPath))
      && h2.result.events.join(',') === expectedEvents + ',error'
      && terminalSequence(h2.result).join(',') === 'error,error'
      && !h2.result.finished
      && h2.result.stable
      && h2.result.terminalCaptures.length === 2
      && h2.result.terminalCaptures.every((capture) =>
        exactTerminalCapture(capture, 'error', h2.result.final),
      )
      && directoryPreserved(h1.result)
      && directoryPreserved(h2.result)
      && h1.processFaults.length === 0
      && h2.processFaults.length === 0;
    if (acceptedCurrent) armRed('R36-11');
    desiredErrorAssertions(h1.result, downloadError(200));
    desiredErrorAssertions(h2.result, downloadError(200));
    expect(h1.result.events.join(',')).toBe(expectedEvents);
    expect(h2.result.events.join(',')).toBe(expectedEvents);
    expect(h1.calls).toBe(1);
    expect(h2.calls).toBe(1);
    expect(h1.hits).toBe(1);
    expect(h2.hits).toBe(1);
    expect(directoryPreserved(h1.result)).toBe(true);
    expect(directoryPreserved(h2.result)).toBe(true);
    expect(h1.processFaults).toEqual([]);
    expect(h2.processFaults).toEqual([]);
  });
});
