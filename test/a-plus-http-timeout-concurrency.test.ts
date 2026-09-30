import { afterAll, afterEach, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Rezo } from '../src/core/rezo';
import { CurlCommandBuilder, CurlExecutor } from '../src/adapters/curl';
import { classifyCurlExitCode } from '../src/adapters/curl-exit-code';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import {
  executeRequest as http2Adapter,
  Http2SessionPool,
} from '../src/adapters/http2';
import { executeRequest as reactNativeAdapter } from '../src/adapters/react-native';
import type { CurlRequestConfig } from '../src/types/curl-options';
import type { RezoHooks } from '../src/core/hooks';
import type { RezoConfig } from '../src/types/rezo-config';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { RezoHeaders } from '../src/utils/headers';
import { getFS } from '../src/utils/http-config';
import {
  parseStagedTimeouts,
  resolveTimeoutMs,
} from '../src/utils/staged-timeout';

declare module 'node:http' {
  interface Agent {
    addRequest(request: ClientRequest, options: ClientRequestArgs): void;
  }
}

type RowId =
  | 'HTO-01'
  | 'HTO-02'
  | 'HTO-03C'
  | 'HTO-03F'
  | 'HTO-03H'
  | 'HTO-03R'
  | 'HTO-03X'
  | 'HTO-04'
  | 'HTO-05'
  | 'HTO-06'
  | 'HTO-07'
  | 'HTO-08'
  | 'HTO-09'
  | 'HTO-10'
  | 'HTO-11'
  | 'HTO-12'
  | 'HTO-13'
  | 'HTO-14'
  | 'HTO-15'
  | 'HTO-16'
  | 'HTO-17B'
  | 'HTO-17S'
  | 'HTO-17D'
  | 'HTO-17U'
  | 'HTO-18C'
  | 'HTO-19P'
  | 'HTO-20P'
  | 'HTO-21P'
  | 'HTO-22P';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly released: boolean;
  release(value: T): void;
}

interface CapturedOutcome {
  readonly error: unknown | null;
  readonly value: unknown | null;
}

interface CleanupLedger {
  agents: number;
  children: number;
  complete: boolean;
  heldGates: number;
  requests: number;
  responses: number;
  servers: number;
  sockets: number;
  temporaryTlsPaths: number;
  timers: number;
}

interface PhaseLedger {
  cleanup: CleanupLedger;
  cleanupErrors: string[];
  file: string;
  fixtureErrors: string[];
  lateEvents: string[];
  oracleMismatches: string[];
  passed: string[];
  red: string[];
  registered: string[];
  runtime: string;
  schema: string;
  setupErrors: string[];
  skipped: string[];
  teardownErrors: string[];
}

const FILE = 'test/a-plus-http-timeout-concurrency.test.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const NODE_REGISTERED: RowId[] = [
  'HTO-01',
  'HTO-02',
  'HTO-03C',
  'HTO-03F',
  'HTO-03H',
  'HTO-03R',
  'HTO-03X',
  'HTO-04',
  'HTO-05',
  'HTO-06',
  'HTO-07',
  'HTO-08',
  'HTO-09',
  'HTO-10',
  'HTO-11',
  'HTO-12',
  'HTO-13',
  'HTO-14',
  'HTO-15',
  'HTO-16',
  'HTO-17B',
  'HTO-17S',
  'HTO-17D',
  'HTO-17U',
  'HTO-18C',
  'HTO-19P',
  'HTO-20P',
  'HTO-21P',
  'HTO-22P',
];
const BUN_REGISTERED: RowId[] = [
  'HTO-01',
  'HTO-02',
  'HTO-03C',
  'HTO-03F',
  'HTO-03H',
  'HTO-03R',
  'HTO-03X',
  'HTO-11',
  'HTO-15',
  'HTO-16',
  'HTO-17B',
  'HTO-17S',
  'HTO-17D',
  'HTO-17U',
  'HTO-18C',
  'HTO-19P',
  'HTO-20P',
  'HTO-21P',
  'HTO-22P',
];
const REGISTERED = RUNTIME === 'bun' ? BUN_REGISTERED : NODE_REGISTERED;
// Every registered row is GREEN on the current bytes (2026-08-23); the arming machinery stays for a future regression.
const NODE_RED: RowId[] = [];
const BUN_RED: RowId[] = [];
const EXPECTED_RED = RUNTIME === 'bun' ? BUN_RED : NODE_RED;
const EXPECTED_PASSED = REGISTERED.filter((id) => !EXPECTED_RED.includes(id));
const armedRed = new Set<RowId>();
const observedFailures = new Set<RowId>();
const observedInvocations = new Map<RowId, number>();
const observedPasses = new Set<RowId>();
const cleanupErrors: string[] = [];
const fixtureErrors: string[] = [];
const lateEvents: string[] = [];
const oracleInvalidations: string[] = [];
const setupErrors: string[] = [];
const teardownErrors: string[] = [];
const activeAgents = new Set<http.Agent>();
const activeGates = new Set<Deferred<unknown>>();
const activeHttp2Sessions = new Set<http2.ServerHttp2Session>();
const activeHttp2Streams = new Set<http2.ServerHttp2Stream>();
const activeRequests = new Set<http.ClientRequest>();
const activeResponses = new Set<http.ServerResponse>();
const activeServers = new Set<http.Server | http2.Http2Server | net.Server>();
const activeSockets = new Set<net.Socket>();
const activeTemporaryDirectories = new Set<string>();
const activeTimers = new Set<NodeJS.Timeout>();
let http2SessionPool: Http2SessionPool | undefined;

interface Http2PoolSnapshot {
  readonly cleanupIntervalIsNull: boolean;
  readonly entries: number;
  readonly leases: number;
  readonly pendingCreations: number;
  readonly sessions: number;
}

type PrematureCloseEncoding = 'gzip' | 'plain';
type PrematureCloseMode = 'buffered' | 'download' | 'stream' | 'upload';

interface ByteSnapshot {
  readonly hex: string;
  readonly length: number;
}

interface PublicErrorSnapshot {
  readonly body: ByteSnapshot | null;
  readonly causeCode: unknown;
  readonly causeMessage: unknown;
  readonly causeName: unknown;
  readonly code: unknown;
  readonly errno: unknown;
  readonly isNetworkError: unknown;
  readonly isRetryable: unknown;
  readonly isTimeout: unknown;
  readonly message: unknown;
  readonly name: unknown;
  readonly phase: unknown;
  readonly responseStatus: unknown;
  readonly status: unknown;
}

interface PrematureCloseSnapshot {
  readonly advertisedLength: number;
  readonly connections: number;
  readonly encoding: PrematureCloseEncoding;
  readonly errors: PublicErrorSnapshot[];
  readonly events: string[];
  readonly file: (ByteSnapshot & { readonly exists: true }) | {
    readonly exists: false;
    readonly hex: '';
    readonly length: 0;
  } | null;
  readonly hooks: {
    readonly afterHeaders: number;
    readonly afterParse: number;
    readonly afterResponse: number;
    readonly beforeError: number;
    readonly onTimeout: number;
    readonly parsedBodies: Array<ByteSnapshot | null>;
  };
  readonly isFinished: boolean | null;
  readonly mode: PrematureCloseMode;
  readonly promiseEvents: string[];
  readonly requestBodies: ByteSnapshot[];
  readonly requestEnds: number;
  readonly serverHits: number;
  readonly settled: boolean;
  readonly sent: ByteSnapshot;
  readonly stable: boolean;
  readonly terminals: number;
  readonly uncaught: string[];
  readonly unhandled: string[];
  readonly valueStatus: unknown;
}

function armRed(id: RowId): void {
  if (!EXPECTED_RED.includes(id)) {
    throw new InfrastructureError(`${id} attempted to arm outside its runtime target map`);
  }
  if (armedRed.has(id)) {
    throw new InfrastructureError(`${id} attempted to arm more than once`);
  }
  armedRed.add(id);
}

function http2PoolSnapshot(pool: Http2SessionPool): Http2PoolSnapshot {
  const entries: Map<unknown, unknown> = Reflect.get(
    pool,
    'entriesBySession',
  );
  const pendingCreations: Set<unknown> = Reflect.get(
    pool,
    'pendingCreations',
  );
  const sessions: Map<unknown, unknown> = Reflect.get(
    pool,
    'sessions',
  );
  if (
    !(entries instanceof Map) ||
    !(pendingCreations instanceof Set) ||
    !(sessions instanceof Map)
  ) {
    throw new InfrastructureError('HTTP/2 pool internals were not observable');
  }
  let leases = 0;
  for (const entry of entries.values()) {
    const refCount = Reflect.get(Object(entry), 'refCount');
    if (
      typeof refCount !== 'number' ||
      !Number.isInteger(refCount) ||
      refCount < 0
    ) {
      throw new InfrastructureError('HTTP/2 pool lease count was not observable');
    }
    leases += refCount;
  }
  return {
    cleanupIntervalIsNull: Reflect.get(pool, 'cleanupInterval') === null,
    entries: entries.size,
    leases,
    pendingCreations: pendingCreations.size,
    sessions: sessions.size,
  };
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.get === right.get &&
    left.set === right.set &&
    left.value === right.value &&
    left.writable === right.writable;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let released = false;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  const deferred: Deferred<T> = {
    get released() {
      return released;
    },
    promise,
    release(value: T) {
      if (released) return;
      released = true;
      activeGates.delete(deferred as Deferred<unknown>);
      resolvePromise(value);
    },
  };
  activeGates.add(deferred as Deferred<unknown>);
  return deferred;
}

function recordFixtureError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  fixtureErrors.push(message);
}

function trackClientRequest(
  request: http.ClientRequest,
): http.ClientRequest {
  activeRequests.add(request);
  request.once('close', () => activeRequests.delete(request));
  return request;
}

function trackSocket<T extends net.Socket>(socket: T): T {
  if (activeSockets.has(socket)) return socket;
  activeSockets.add(socket);
  socket.on('error', () => undefined);
  socket.once('close', () => activeSockets.delete(socket));
  return socket;
}

function trackServer<T extends http.Server | http2.Http2Server | net.Server>(
  server: T,
): T {
  activeServers.add(server);
  server.once('close', () => activeServers.delete(server));
  server.on('connection', (socket: net.Socket) => {
    trackSocket(socket);
  });
  server.on('error', recordFixtureError);
  return server;
}

function trackAgent<T extends http.Agent>(agent: T): T {
  activeAgents.add(agent);
  return agent;
}

function trackResponse(response: http.ServerResponse): http.ServerResponse {
  activeResponses.add(response);
  response.on('error', () => undefined);
  const settle = () => activeResponses.delete(response);
  response.once('close', settle);
  response.once('finish', settle);
  response.socket?.once('close', settle);
  return response;
}

function trackHttp2Session(
  session: http2.ServerHttp2Session,
): http2.ServerHttp2Session {
  activeHttp2Sessions.add(session);
  session.on('error', () => undefined);
  session.once('close', () => activeHttp2Sessions.delete(session));
  return session;
}

function trackHttp2Stream(
  stream: http2.ServerHttp2Stream,
): http2.ServerHttp2Stream {
  activeHttp2Streams.add(stream);
  stream.on('error', () => undefined);
  stream.once('close', () => activeHttp2Streams.delete(stream));
  return stream;
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

function snapshotBytes(value: unknown): ByteSnapshot | null {
  let bytes: Buffer;
  if (typeof value === 'string') {
    bytes = Buffer.from(value);
  } else if (Buffer.isBuffer(value)) {
    bytes = value;
  } else if (value instanceof Uint8Array) {
    bytes = Buffer.from(value);
  } else {
    return null;
  }
  return { hex: bytes.toString('hex'), length: bytes.length };
}

function nonemptyStringState(value: unknown): unknown {
  return typeof value === 'string' && value.length > 0 ? 'nonempty' : value;
}

function snapshotPublicError(
  error: unknown,
  includeBody: boolean,
): PublicErrorSnapshot {
  const response = errorField(error, 'response');
  const cause = errorField(error, 'cause');
  return {
    body: includeBody ? snapshotBytes(errorField(response, 'data')) : null,
    causeCode: errorField(cause, 'code'),
    causeMessage: nonemptyStringState(errorField(cause, 'message')),
    causeName: errorField(cause, 'name'),
    code: errorField(error, 'code'),
    errno: errorField(error, 'errno'),
    isNetworkError: errorField(error, 'isNetworkError'),
    isRetryable: errorField(error, 'isRetryable'),
    isTimeout: errorField(error, 'isTimeout'),
    message: nonemptyStringState(errorField(error, 'message')),
    name: errorField(error, 'name'),
    phase: errorField(error, 'phase'),
    responseStatus: errorField(response, 'status'),
    status: errorField(error, 'status'),
  };
}

async function snapshotFile(
  filePath: string,
): Promise<PrematureCloseSnapshot['file']> {
  try {
    const bytes = await readFile(filePath);
    return { exists: true, hex: bytes.toString('hex'), length: bytes.length };
  } catch (error) {
    if (errorField(error, 'code') === 'ENOENT') {
      return { exists: false, hex: '', length: 0 };
    }
    throw new InfrastructureError('failed to inspect premature-close file', {
      cause: error,
    });
  }
}

async function createTemporaryDirectory(label: string): Promise<string> {
  try {
    const directory = await mkdtemp(join(tmpdir(), `${label}-`));
    activeTemporaryDirectories.add(directory);
    return directory;
  } catch (error) {
    throw new InfrastructureError(`failed to create ${label} directory`, {
      cause: error,
    });
  }
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
    activeTemporaryDirectories.delete(directory);
  } catch (error) {
    throw new InfrastructureError('failed to remove premature-close directory', {
      cause: error,
    });
  }
}

interface NodeRequireBridge {
  restore(): void;
}

function installNodeRequireBridge(): NodeRequireBridge {
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
  if (priorDescriptor !== undefined) {
    throw new InfrastructureError('test require bridge found an unexpected own descriptor');
  }
  const nodeRequire = (specifier: string): unknown => {
    if (specifier !== 'node:fs') {
      throw new InfrastructureError(`test require bridge rejected ${specifier}`);
    }
    return nodeFs;
  };
  let installed = false;
  const restore = (): void => {
    if (installed) {
      if (!Reflect.deleteProperty(globalThis, 'require')) {
        throw new InfrastructureError('failed to delete the test require bridge');
      }
      installed = false;
    }
    const restoredDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
    if (!samePropertyDescriptor(restoredDescriptor, priorDescriptor)) {
      throw new InfrastructureError('test require descriptor was not restored exactly');
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
    const installedDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
    if (
      installedDescriptor?.configurable !== true ||
      installedDescriptor.enumerable !== false ||
      installedDescriptor?.get !== undefined ||
      installedDescriptor?.set !== undefined ||
      installedDescriptor?.value !== nodeRequire ||
      installedDescriptor.writable !== false
    ) {
      throw new InfrastructureError('test require bridge did not install exactly');
    }
    if (nodeRequire('node:fs') !== nodeFs) {
      throw new InfrastructureError('test require bridge did not return node:fs exactly');
    }
    let rejectedOtherSpecifier = false;
    try {
      nodeRequire('node:path');
    } catch (error) {
      rejectedOtherSpecifier = error instanceof InfrastructureError;
    }
    if (!rejectedOtherSpecifier) {
      throw new InfrastructureError('test require bridge accepted another module');
    }
  } catch (error) {
    try {
      restore();
    } catch (restoreError) {
      throw new InfrastructureError('test require bridge installation and restore failed', {
        cause: restoreError,
      });
    }
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('test require bridge installation failed', { cause: error });
  }

  return { restore };
}

async function runPrematureCloseCase(
  mode: PrematureCloseMode,
  encoding: PrematureCloseEncoding,
): Promise<PrematureCloseSnapshot> {
  const fullBody = encoding === 'gzip'
    ? gzipSync(Buffer.from('part'))
    : Buffer.from('ABCDEFGHIJKLMNOPQRST');
  const sentBody = encoding === 'gzip'
    ? fullBody.subarray(0, -8)
    : fullBody.subarray(0, 4);
  const advertisedLength = fullBody.length;
  const responseStarted = createDeferred<void>();
  const sourceClosed = createDeferred<void>();
  const events: string[] = [];
  const errors: PublicErrorSnapshot[] = [];
  const parsedBodies: Array<ByteSnapshot | null> = [];
  const requestBodies: ByteSnapshot[] = [];
  const uncaught: string[] = [];
  const unhandled: string[] = [];
  let afterHeaders = 0;
  let afterParse = 0;
  let afterResponse = 0;
  let beforeError = 0;
  let connections = 0;
  let facadeFinished: (() => boolean) | undefined;
  let facadeStatus: (() => unknown) | undefined;
  let onTimeout = 0;
  const promiseState: { observation: SettlementObservation | null } = {
    observation: null,
  };
  let requestEnds = 0;
  let requireBridge: NodeRequireBridge | undefined;
  let serverHits = 0;
  let temporaryDirectory: string | undefined;
  let temporaryFile: string | undefined;

  const onUncaughtException = (error: Error): void => {
    uncaught.push(`${error.name}:${String(errorField(error, 'code') ?? '')}:${error.message}`);
  };
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason instanceof Error
      ? `${reason.name}:${String(errorField(reason, 'code') ?? '')}:${reason.message}`
      : String(reason));
  };
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  const hooks: Partial<RezoHooks> = {
    afterHeaders: [() => {
      afterHeaders += 1;
    }],
    afterParse: [(event) => {
      afterParse += 1;
      parsedBodies.push(snapshotBytes(event.data));
      return event.data;
    }],
    afterResponse: [(response) => {
      afterResponse += 1;
      return response;
    }],
    beforeError: [(error) => {
      beforeError += 1;
      return error;
    }],
    onTimeout: [() => {
      onTimeout += 1;
    }],
  };

  const server = trackServer(http.createServer((request, response) => {
    serverHits += 1;
    trackResponse(response);
    const bodyChunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => bodyChunks.push(Buffer.from(chunk)));
    request.on('error', recordFixtureError);
    request.once('end', () => {
      requestEnds += 1;
      requestBodies.push(snapshotBytes(Buffer.concat(bodyChunks)) ?? {
        hex: '',
        length: 0,
      });
      const socket = response.socket;
      if (socket === null) {
        recordFixtureError(new Error('premature-close response had no socket'));
        responseStarted.release();
        sourceClosed.release();
        return;
      }
      socket.once('close', () => sourceClosed.release());
      const headers: http.OutgoingHttpHeaders = {
        'content-length': String(advertisedLength),
        'content-type': 'text/plain',
      };
      if (encoding === 'gzip') headers['content-encoding'] = 'gzip';
      response.writeHead(200, headers);
      response.flushHeaders();
      response.write(sentBody, () => {
        void delay(20).then(() => socket.destroy()).catch(recordFixtureError);
      });
      responseStarted.release();
    });
  }));
  server.on('connection', () => {
    connections += 1;
  });

  try {
    const port = await listenHttp(server);
    const url = `http://127.0.0.1:${port}/hto-17-${mode}-${encoding}`;
    if (mode === 'download') {
      let loadedFs = await getFS();
      if (loadedFs === undefined) {
        requireBridge = installNodeRequireBridge();
        loadedFs = await getFS();
      }
      if (
        loadedFs?.accessSync !== nodeFs.accessSync ||
        loadedFs?.createWriteStream !== nodeFs.createWriteStream ||
        loadedFs?.constants !== nodeFs.constants ||
        loadedFs?.existsSync !== nodeFs.existsSync ||
        loadedFs?.mkdirSync !== nodeFs.mkdirSync ||
        loadedFs?.statSync !== nodeFs.statSync ||
        loadedFs?.unlinkSync !== nodeFs.unlinkSync
      ) {
        throw new InfrastructureError('download fixture did not load exact node:fs capabilities');
      }
    }
    const client = new Rezo({}, httpAdapter);
    const options = { cache: false, hooks, retry: false } as const;

    if (mode === 'buffered') {
      const request = client.get(url, options);
      void settleExactlyOnce(request).then((observation) => {
        promiseState.observation = observation;
      }).catch(recordFixtureError);
    } else if (mode === 'stream') {
      const stream = client.stream(url, options);
      facadeFinished = () => stream.isFinished();
      stream.on('initiated', () => events.push('initiated'));
      stream.on('start', (event) => events.push(`start:${event.method}`));
      stream.on('headers', (event) => {
        events.push(
          `headers:${event.status}:${event.contentLength ?? 0}:${event.contentType ?? ''}`,
        );
      });
      stream.on('status', (status, statusText) => {
        events.push(`status:${String(status)}:${String(statusText)}`);
      });
      stream.on('cookies', (cookies) => events.push(`cookies:${cookies.length}`));
      stream.on('progress', (event) => {
        events.push(`progress:${event.loaded}:${event.total}`);
      });
      stream.on('data', (chunk) => {
        events.push(`data:${Buffer.from(chunk).toString('hex')}`);
      });
      stream.on('error', (error) => {
        errors.push(snapshotPublicError(error, false));
        events.push('error');
      });
      stream.on('finish', () => events.push('finish'));
      stream.on('done', () => events.push('done'));
      stream.on('complete', () => events.push('complete'));
      stream.on('end', () => events.push('end'));
      stream.on('close', () => events.push('close'));
    } else if (mode === 'download') {
      temporaryDirectory = await createTemporaryDirectory('rezo-hto17-download');
      temporaryFile = join(temporaryDirectory, `${encoding}.bin`);
      const download = client.download(url, temporaryFile, options);
      facadeFinished = () => download.isFinished();
      facadeStatus = () => download.status;
      download.on('initiated', () => events.push('initiated'));
      download.on('start', (event) => events.push(`start:${event.method}`));
      download.on('headers', (event) => {
        events.push(
          `headers:${event.status}:${event.contentLength ?? 0}:${event.contentType ?? ''}`,
        );
      });
      download.on('status', (status, statusText) => {
        events.push(`status:${String(status)}:${String(statusText)}`);
      });
      download.on('cookies', (cookies) => events.push(`cookies:${cookies.length}`));
      download.on('progress', (event) => {
        events.push(`progress:${event.loaded}:${event.total}`);
      });
      download.on('error', (error) => {
        errors.push(snapshotPublicError(error, false));
        events.push('error');
      });
      download.on('finish', () => events.push('finish'));
      download.on('done', () => events.push('done'));
      download.on('complete', () => events.push('complete'));
    } else {
      const upload = client.upload(url, 'UPLOAD-D10', options);
      facadeFinished = () => upload.isFinished();
      facadeStatus = () => upload.status;
      upload.on('initiated', () => events.push('initiated'));
      upload.on('start', (event) => events.push(`start:${event.method}`));
      upload.on('headers', (event) => {
        events.push(
          `headers:${event.status}:${event.contentLength ?? 0}:${event.contentType ?? ''}`,
        );
      });
      upload.on('status', (status, statusText) => {
        events.push(`status:${String(status)}:${String(statusText)}`);
      });
      upload.on('cookies', (cookies) => events.push(`cookies:${cookies.length}`));
      upload.on('progress', (event) => {
        events.push(`progress:${event.loaded}:${event.total}`);
      });
      upload.on('error', (error) => {
        errors.push(snapshotPublicError(error, true));
        events.push('error');
      });
      upload.on('finish', () => events.push('finish'));
      upload.on('done', () => events.push('done'));
      upload.on('complete', () => events.push('complete'));
    }

    await within(
      responseStarted.promise,
      1_000,
      `${mode}/${encoding} fixture did not start its response ` +
        `(hits=${serverHits}, ends=${requestEnds}, events=${JSON.stringify(events)}, ` +
        `errors=${JSON.stringify(errors)})`,
    );
    if (requireBridge !== undefined) {
      requireBridge.restore();
      if (await getFS() !== undefined) {
        throw new InfrastructureError('test require bridge remained observable after restore');
      }
    }
    await within(
      sourceClosed.promise,
      1_000,
      `${mode}/${encoding} fixture source did not close`,
    );
    await delay(200);
    const observationBeforeStability = promiseState.observation;
    const fileBeforeStability = temporaryFile === undefined
      ? null
      : await snapshotFile(temporaryFile);
    const stabilityBefore = JSON.stringify({
      afterHeaders,
      afterParse,
      afterResponse,
      beforeError,
      errors,
      events,
      file: fileBeforeStability,
      isFinished: facadeFinished?.() ?? null,
      onTimeout,
      promiseEvents: observationBeforeStability === null
        ? []
        : [...observationBeforeStability.events],
      terminals: observationBeforeStability?.terminals() ?? 0,
      uncaught,
      unhandled,
      valueStatus: observationBeforeStability === null
        ? facadeStatus?.()
        : errorField(observationBeforeStability.outcome.value, 'status'),
    });
    await delay(100);
    const observation = promiseState.observation;
    const fileAfterStability = temporaryFile === undefined
      ? null
      : await snapshotFile(temporaryFile);
    const stabilityAfter = JSON.stringify({
      afterHeaders,
      afterParse,
      afterResponse,
      beforeError,
      errors,
      events,
      file: fileAfterStability,
      isFinished: facadeFinished?.() ?? null,
      onTimeout,
      promiseEvents: observation === null
        ? []
        : [...observation.events],
      terminals: observation?.terminals() ?? 0,
      uncaught,
      unhandled,
      valueStatus: observation === null
        ? facadeStatus?.()
        : errorField(observation.outcome.value, 'status'),
    });
    if (stabilityAfter !== stabilityBefore) {
      lateEvents.push(`HTO-17-${mode}-${encoding}:${stabilityBefore}->${stabilityAfter}`);
    }

    if (
      observation !== null &&
      observation.outcome.error !== null
    ) {
      errors.push(snapshotPublicError(
        observation.outcome.error,
        mode === 'buffered' || mode === 'upload',
      ));
    }
    const hasSuccessEvent = events.some((event) => (
      event === 'finish' || event === 'done' || event === 'complete' || event === 'end'
    ));
    return {
      advertisedLength,
      connections,
      encoding,
      errors,
      events,
      file: fileAfterStability,
      hooks: {
        afterHeaders,
        afterParse,
        afterResponse,
        beforeError,
        onTimeout,
        parsedBodies,
      },
      isFinished: facadeFinished?.() ?? null,
      mode,
      promiseEvents: observation === null
        ? []
        : [...observation.events],
      requestBodies,
      requestEnds,
      serverHits,
      settled: observation !== null || errors.length > 0 || hasSuccessEvent,
      sent: snapshotBytes(sentBody) ?? { hex: '', length: 0 },
      stable: stabilityAfter === stabilityBefore,
      terminals: observation?.terminals() ?? (
        errors.length + (hasSuccessEvent ? 1 : 0)
      ),
      uncaught,
      unhandled,
      valueStatus: observation === null
        ? facadeStatus?.()
        : errorField(observation.outcome.value, 'status'),
    };
  } finally {
    try {
      requireBridge?.restore();
    } finally {
      try {
        try {
          await closeTrackedHttpServer(server);
        } finally {
          if (temporaryDirectory !== undefined) {
            await removeTemporaryDirectory(temporaryDirectory);
          }
        }
      } finally {
        process.off('uncaughtException', onUncaughtException);
        process.off('unhandledRejection', onUnhandledRejection);
      }
    }
  }
}

interface PrematureCloseExpectedDetails {
  readonly errors?: PublicErrorSnapshot[];
  readonly events?: string[];
  readonly file?: PrematureCloseSnapshot['file'];
  readonly hooks?: PrematureCloseSnapshot['hooks'];
  readonly isFinished?: boolean | null;
  readonly promiseEvents?: string[];
  readonly settled?: boolean;
  readonly terminals?: number;
  readonly valueStatus?: unknown;
}

function expectedNetworkError(
  body: ByteSnapshot | null,
  withNativeCause: boolean,
): PublicErrorSnapshot {
  return {
    body,
    causeCode: withNativeCause ? 'ECONNRESET' : undefined,
    causeMessage: withNativeCause ? 'nonempty' : undefined,
    causeName: withNativeCause ? 'Error' : undefined,
    code: 'ECONNRESET',
    errno: -104,
    isNetworkError: true,
    isRetryable: true,
    isTimeout: false,
    message: 'nonempty',
    name: 'RezoError',
    phase: undefined,
    responseStatus: 200,
    status: 200,
  };
}

function expectedPrematureCloseSnapshot(
  mode: PrematureCloseMode,
  encoding: PrematureCloseEncoding,
  details: PrematureCloseExpectedDetails = {},
): PrematureCloseSnapshot {
  const fullBody = encoding === 'gzip'
    ? gzipSync(Buffer.from('part'))
    : Buffer.from('ABCDEFGHIJKLMNOPQRST');
  const sentBody = encoding === 'gzip'
    ? fullBody.subarray(0, -8)
    : fullBody.subarray(0, 4);
  return {
    advertisedLength: fullBody.length,
    connections: 1,
    encoding,
    errors: details.errors ?? [],
    events: details.events ?? [],
    file: details.file ?? null,
    hooks: details.hooks ?? {
      afterHeaders: 1,
      afterParse: 0,
      afterResponse: 0,
      // R15 P2 (2026-08-22): every rejection runs beforeError exactly once, facades included.
      beforeError: (details.errors ?? []).length > 0 ? 1 : 0,
      onTimeout: 0,
      parsedBodies: [],
    },
    isFinished: details.isFinished ?? null,
    mode,
    promiseEvents: details.promiseEvents ?? [],
    requestBodies: [mode === 'upload'
      ? { hex: Buffer.from('UPLOAD-D10').toString('hex'), length: 10 }
      : { hex: '', length: 0 }],
    requestEnds: 1,
    serverHits: 1,
    settled: details.settled ?? false,
    sent: { hex: sentBody.toString('hex'), length: sentBody.length },
    stable: true,
    terminals: details.terminals ?? 0,
    uncaught: [],
    unhandled: [],
    valueStatus: details.valueStatus,
  };
}

function expectedFacadePrefix(
  method: 'GET' | 'POST',
  encoding: PrematureCloseEncoding,
): string[] {
  const advertisedLength = encoding === 'gzip'
    ? gzipSync(Buffer.from('part')).length
    : 20;
  return [
    'initiated',
    `start:${method}`,
    `headers:200:${advertisedLength}:text/plain`,
    'status:200:OK',
    'cookies:0',
  ];
}

class InfrastructureError extends Error {
  constructor(label: string, options?: ErrorOptions) {
    super(label, options);
    this.name = 'InfrastructureError';
  }
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new InfrastructureError(label)),
      milliseconds,
    );
    activeTimers.add(timer);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(timer);
    }
  }
}

function errorField(error: unknown, field: string): unknown {
  return Reflect.get(Object(error), field);
}

function expectTimeout(
  outcome: CapturedOutcome,
  code: string,
  phase: string,
): void {
  expect(outcome.value === null).toBe(true);
  expect(errorField(outcome.error, 'code')).toBe(code);
  expect(errorField(outcome.error, 'phase')).toBe(phase);
  expect(errorField(outcome.error, 'isTimeout')).toBe(true);
}

function expectStagedTimeoutSignature(
  error: unknown,
  code: string,
  phase: 'body' | 'connect' | 'headers' | 'total',
): void {
  expect(errorField(error, 'name')).toBe('RezoError');
  expect(errorField(error, 'code')).toBe(code);
  expect(errorField(error, 'phase')).toBe(phase);
  expect(errorField(error, 'isTimeout')).toBe(true);
  const elapsed = errorField(error, 'elapsed');
  expect(typeof elapsed).toBe('number');
  if (typeof elapsed === 'number') {
    expect(Number.isInteger(elapsed)).toBe(true);
    expect(elapsed).toBeGreaterThan(0);
    const messages = {
      body: `Body timeout: Response body transfer stalled for ${elapsed}ms`,
      connect: `Connection timeout: Failed to establish TCP connection within ${elapsed}ms`,
      headers: `Headers timeout: Server did not send response headers within ${elapsed}ms`,
      total: `Total timeout: Request exceeded maximum duration of ${elapsed}ms`,
    };
    expect(errorField(error, 'message')).toBe(messages[phase]);
  }
}

function expectNoLateLifecycle(
  id: RowId,
  before: readonly unknown[],
  after: readonly unknown[],
): void {
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    lateEvents.push(`${id}:${JSON.stringify({ after, before })}`);
  }
  expect(after).toEqual(before);
}

async function observeRow(
  id: RowId,
  operation: () => Promise<void> | void,
): Promise<void> {
  observedInvocations.set(id, (observedInvocations.get(id) ?? 0) + 1);
  try {
    await operation();
    if (armedRed.delete(id)) {
      throw new InfrastructureError(`${id} passed its desired assertion after arming RED`);
    }
    observedPasses.add(id);
  } catch (error) {
    const wasArmed = armedRed.delete(id);
    if (error instanceof InfrastructureError) {
      fixtureErrors.push(`${id} infrastructure: ${error.message}`);
      throw error;
    }
    if (!wasArmed) {
      oracleInvalidations.push(
        `${id}:unarmed:${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    observedFailures.add(id);
    throw error;
  }
}

interface SettlementObservation {
  readonly events: string[];
  readonly outcome: CapturedOutcome;
  terminals(): number;
}

async function settleExactlyOnce(
  promise: Promise<unknown>,
): Promise<SettlementObservation> {
  let terminalCount = 0;
  const events: string[] = [];
  const outcome = await promise.then(
    (value) => {
      terminalCount += 1;
      events.push('fulfilled');
      return { error: null, value } as CapturedOutcome;
    },
    (error: unknown) => {
      if (error instanceof InfrastructureError) throw error;
      terminalCount += 1;
      events.push('rejected');
      return { error, value: null } as CapturedOutcome;
    },
  );
  return { events, outcome, terminals: () => terminalCount };
}

async function listenHttp(server: http.Server): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
  } catch (error) {
    throw new InfrastructureError('HTTP fixture failed to listen', {
      cause: error,
    });
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new InfrastructureError('HTTP fixture did not expose an IP port');
  }
  return address.port;
}

async function closeTrackedHttpServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  try {
    await within(new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }), 1_000, 'premature-close fixture server did not close');
  } catch (error) {
    throw new InfrastructureError('premature-close fixture cleanup failed', {
      cause: error,
    });
  }
}

async function listenHttp2(server: http2.Http2Server): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
  } catch (error) {
    throw new InfrastructureError('HTTP/2 fixture failed to listen', {
      cause: error,
    });
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new InfrastructureError('HTTP/2 fixture did not expose an IP port');
  }
  return address.port;
}

function safeEnd(response: http.ServerResponse, body = ''): void {
  if (response.destroyed || response.writableEnded) return;
  response.end(body);
}

function agentResourceCount(agent: http.Agent): number {
  const countEntries = (
    entries: NodeJS.ReadOnlyDict<readonly unknown[]>,
  ): number => Object.values(entries).reduce(
    (total, values) => total + (values?.length ?? 0),
    0,
  );
  return countEntries(agent.requests) +
    countEntries(agent.sockets) +
    countEntries(agent.freeSockets);
}

async function cleanupResources(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const server of [...activeServers]) {
    closePromises.push(new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      try {
        server.close((error?: Error) => {
          if (error) cleanupErrors.push(error.message);
          resolve();
        });
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
        resolve();
      }
    }));
  }

  if (http2SessionPool !== undefined) {
    try {
      http2SessionPool.destroy();
      const poolSnapshot = http2PoolSnapshot(http2SessionPool);
      if (
        !poolSnapshot.cleanupIntervalIsNull ||
        poolSnapshot.entries !== 0 ||
        poolSnapshot.leases !== 0 ||
        poolSnapshot.pendingCreations !== 0 ||
        poolSnapshot.sessions !== 0
      ) {
        cleanupErrors.push(`HTTP/2 pool retained ${JSON.stringify(poolSnapshot)}`);
      }
    } catch (error) {
      cleanupErrors.push(
        `HTTP/2 pool cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const stream of [...activeHttp2Streams]) stream.destroy();
  for (const session of [...activeHttp2Sessions]) session.destroy();

  for (const request of activeRequests) request.destroy();
  for (const response of activeResponses) safeEnd(response);
  for (const socket of activeSockets) socket.destroy();
  for (const agent of activeAgents) agent.destroy();
  for (const server of [...activeServers]) {
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    if ('closeAllConnections' in server) server.closeAllConnections();
  }
  resetGlobalAgentPool();

  if (closePromises.length > 0) {
    try {
      await within(Promise.all(closePromises).then(() => undefined), 5_000, 'server cleanup timed out');
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const timer of [...activeTimers]) {
    clearTimeout(timer);
    activeTimers.delete(timer);
  }

  const settlementDeadline = Date.now() + 5_000;
  while (
    (
      activeRequests.size > 0 ||
      activeResponses.size > 0 ||
      activeHttp2Sessions.size > 0 ||
      activeHttp2Streams.size > 0 ||
      activeServers.size > 0 ||
      activeSockets.size > 0
    ) &&
    Date.now() < settlementDeadline
  ) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  // The historical ledger key is `temporaryTlsPaths`, but it represents every
  // test-owned temporary path. Remove these only after network resources have
  // settled so a download writer cannot race directory deletion.
  for (const directory of [...activeTemporaryDirectories]) {
    try {
      await removeTemporaryDirectory(directory);
    } catch (error) {
      cleanupErrors.push(
        `temporary-directory cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const agent of [...activeAgents]) {
    const resources = agentResourceCount(agent);
    if (resources === 0) {
      activeAgents.delete(agent);
    } else {
      cleanupErrors.push(`agent retained ${resources} resource(s) after destroy`);
    }
  }
  for (const gate of activeGates) {
    if (!gate.released) cleanupErrors.push('value gate still held after cleanup');
  }
  for (const request of activeRequests) {
    cleanupErrors.push(
      request.destroyed
        ? 'destroyed client request did not emit close'
        : 'client request remained active after cleanup',
    );
  }
  for (const response of activeResponses) {
    cleanupErrors.push(
      response.destroyed
        ? 'destroyed server response did not emit close'
        : 'server response remained active after cleanup',
    );
  }
  for (const stream of activeHttp2Streams) {
    cleanupErrors.push(
      stream.destroyed
        ? 'destroyed HTTP/2 stream did not emit close'
        : 'HTTP/2 stream remained active after cleanup',
    );
  }
  for (const session of activeHttp2Sessions) {
    cleanupErrors.push(
      session.destroyed
        ? 'destroyed HTTP/2 session did not emit close'
        : 'HTTP/2 session remained active after cleanup',
    );
  }
  for (const server of activeServers) {
    cleanupErrors.push(
      server.listening
        ? 'server still listening after close'
        : 'server did not emit close after cleanup',
    );
  }
  for (const socket of activeSockets) {
    cleanupErrors.push(
      socket.destroyed
        ? 'destroyed socket did not emit close'
        : 'socket remained active after cleanup',
    );
  }
}

class AssignmentAgent extends http.Agent {
  assignments = 0;
  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    trackClientRequest(request);
    request.once('socket', (socket) => {
      this.assignments += 1;
      trackSocket(socket);
    });
    super.addRequest(request, options);
  }
}

class QueueLedgerAgent extends http.Agent {
  readonly assignmentPaths: string[] = [];
  connections = 0;
  readonly lookupHosts: string[] = [];

  constructor(private readonly destinationPort: number) {
    super({ keepAlive: true, maxSockets: 1 });
  }

  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    const path = String(options.path);
    trackClientRequest(request);
    request.once('socket', (socket) => {
      this.assignmentPaths.push(path);
      trackSocket(socket);
    });
    super.addRequest(request, options);
  }

  override createConnection(
    _options: http.ClientRequestArgs,
    callback?: (error: Error | null, stream: net.Socket) => void,
  ): net.Socket {
    void callback;
    this.connections += 1;
    const lookup: net.LookupFunction = (hostname, options, completion) => {
      this.lookupHosts.push(hostname);
      const wantsAll = typeof options === 'object' && options.all === true;
      const result = wantsAll
        ? [null, [{ address: '127.0.0.1', family: 4 }]]
        : [null, '127.0.0.1', 4];
      Reflect.apply(completion, undefined, result);
    };
    return trackSocket(net.createConnection({
      host: 'queued.rezo.test',
      lookup,
      port: this.destinationPort,
    }));
  }
}

class PendingLookupAgent extends http.Agent {
  assignments = 0;
  lookupCalls = 0;
  readonly lookupObserved = createDeferred<void>();
  #lookupRelease: (() => void) | undefined;

  constructor(private readonly destinationPort: number) {
    super({ keepAlive: false, maxSockets: 1 });
  }

  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    trackClientRequest(request);
    request.once('socket', (socket) => {
      this.assignments += 1;
      trackSocket(socket);
    });
    super.addRequest(request, options);
  }

  override createConnection(
    _options: http.ClientRequestArgs,
    callback?: (error: Error | null, stream: net.Socket) => void,
  ): net.Socket {
    void callback;
    const lookup: net.LookupFunction = (hostname, options, completion) => {
      this.lookupCalls += 1;
      this.lookupObserved.release();
      this.#lookupRelease = () => {
        const wantsAll = typeof options === 'object' && options.all === true;
        const result = wantsAll
          ? [null, [{ address: '127.0.0.1', family: 4 }]]
          : [null, '127.0.0.1', 4];
        Reflect.apply(completion, undefined, result);
      };
      expect(hostname).toBe('pending.rezo.test');
    };
    return trackSocket(net.createConnection({
      host: 'pending.rezo.test',
      lookup,
      port: this.destinationPort,
    }));
  }

  releaseLookup(): void {
    this.#lookupRelease?.();
    this.#lookupRelease = undefined;
  }
}

const priorXmlHttpRequestDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'XMLHttpRequest',
);

class ControlledXMLHttpRequest {
  static readonly DONE = 4;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly OPENED = 1;
  static readonly UNSENT = 0;
  readonly DONE = 4;
  readonly HEADERS_RECEIVED = 2;
  readonly LOADING = 3;
  readonly OPENED = 1;
  readonly UNSENT = 0;
  readyState = 0;
  response: unknown = '';
  responseText = '';
  responseType: XMLHttpRequestResponseType = '';
  responseURL = '';
  status = 0;
  statusText = '';
  timeout = 0;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  withCredentials = false;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  static readonly instances: ControlledXMLHttpRequest[] = [];
  readonly lifecycle: string[] = [];
  readonly requestHeaders: string[] = [];
  #url = '';

  constructor() {
    this.lifecycle.push('constructed');
    ControlledXMLHttpRequest.instances.push(this);
  }

  abort(): void {
    this.lifecycle.push('abort');
    this.onabort?.();
  }

  getAllResponseHeaders(): string {
    return 'content-type: text/plain\r\ncontent-length: 2\r\n';
  }

  getResponseHeader(name: string): string | null {
    if (name.toLowerCase() === 'content-type') return 'text/plain';
    if (name.toLowerCase() === 'content-length') return '2';
    return null;
  }

  open(method: string, url: string, async = true): void {
    this.#url = url;
    this.readyState = 1;
    this.lifecycle.push(`open:${method}:${url}:${String(async)}`);
  }

  send(body?: unknown): void {
    this.lifecycle.push(`send:${body === null || body === undefined ? 'empty' : 'body'}`);
    queueMicrotask(() => {
      this.readyState = 4;
      this.response = 'ok';
      this.responseText = 'ok';
      this.responseURL = this.#url;
      this.status = 200;
      this.statusText = 'OK';
      this.lifecycle.push('readystatechange:4');
      this.onreadystatechange?.();
      this.lifecycle.push('load');
      this.onload?.();
    });
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.push(`${name.toLowerCase()}:${value}`);
    this.lifecycle.push(`header:${name.toLowerCase()}:${value}`);
  }
}

Object.defineProperty(globalThis, 'XMLHttpRequest', {
  configurable: true,
  enumerable: priorXmlHttpRequestDescriptor?.enumerable ?? false,
  value: ControlledXMLHttpRequest,
  writable: true,
});
const { executeRequest: xhrAdapter } = await import('../src/adapters/xhr');

afterEach(async () => {
  await cleanupResources();
});

afterAll(async () => {
  await cleanupResources();
  if (priorXmlHttpRequestDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  } else {
    Object.defineProperty(
      globalThis,
      'XMLHttpRequest',
      priorXmlHttpRequestDescriptor,
    );
  }
  const restoredXmlHttpRequestDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'XMLHttpRequest',
  );
  if (!samePropertyDescriptor(
    restoredXmlHttpRequestDescriptor,
    priorXmlHttpRequestDescriptor,
  )) {
    teardownErrors.push('XMLHttpRequest descriptor was not restored exactly');
  }
  const expectedRed = [...EXPECTED_RED].sort();
  const expectedPassed = [...EXPECTED_PASSED].sort();
  const actualRed = [...observedFailures].sort();
  const actualPassed = [...observedPasses].sort();
  const actualRegistered = [...observedInvocations.keys()].sort();
  const oracleMismatches = [...oracleInvalidations];
  if (armedRed.size !== 0) {
    oracleMismatches.push(`armed-after-file:${JSON.stringify([...armedRed].sort())}`);
  }
  for (const id of REGISTERED) {
    const count = observedInvocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
  }
  for (const [id, count] of observedInvocations) {
    if (!REGISTERED.includes(id)) {
      oracleMismatches.push(`unexpected-invocations:${id}:${count}`);
    }
  }
  if (JSON.stringify(actualRegistered) !== JSON.stringify([...REGISTERED].sort())) {
    oracleMismatches.push(`registered:${JSON.stringify(actualRegistered)}`);
  }
  if (JSON.stringify(actualRed) !== JSON.stringify(expectedRed)) {
    oracleMismatches.push(`red:${JSON.stringify(actualRed)}`);
  }
  if (JSON.stringify(actualPassed) !== JSON.stringify(expectedPassed)) {
    oracleMismatches.push(`passed:${JSON.stringify(actualPassed)}`);
  }
  const cleanup: CleanupLedger = {
    agents: activeAgents.size,
    children: 0,
    complete:
      cleanupErrors.length === 0 &&
      teardownErrors.length === 0 &&
      activeAgents.size === 0 &&
      activeGates.size === 0 &&
      activeHttp2Sessions.size === 0 &&
      activeHttp2Streams.size === 0 &&
      activeRequests.size === 0 &&
      activeResponses.size === 0 &&
      activeServers.size === 0 &&
      activeSockets.size === 0 &&
      activeTemporaryDirectories.size === 0 &&
      activeTimers.size === 0,
    heldGates: [...activeGates].filter((gate) => !gate.released).length,
    requests: activeRequests.size,
    responses: activeResponses.size,
    servers: activeServers.size,
    sockets: activeSockets.size,
    temporaryTlsPaths: activeTemporaryDirectories.size,
    timers: activeTimers.size,
  };
  const ledger: PhaseLedger = {
    cleanup,
    cleanupErrors,
    file: FILE,
    fixtureErrors,
    lateEvents,
    oracleMismatches,
    passed: actualPassed,
    red: actualRed,
    registered: actualRegistered,
    runtime: RUNTIME,
    schema: 'rezo.etimedout.phase1.ledger/v1',
    setupErrors,
    skipped: [],
    teardownErrors,
  };
  console.log(`REZO_PHASE1_LEDGER_V1:${JSON.stringify(ledger)}`);
  // Fail closed: the ledger is an oracle, not a printout.
  expect(ledger.oracleMismatches).toEqual([]);
  expect(ledger.fixtureErrors).toEqual([]);
  expect(ledger.setupErrors).toEqual([]);
  expect(ledger.teardownErrors).toEqual([]);
  expect(ledger.cleanupErrors).toEqual([]);
  expect(ledger.lateEvents).toEqual([]);
  expect(ledger.cleanup.complete).toBe(true);
});

it('HTO-01 numeric timeout is one total-only budget', async () => {
  await observeRow('HTO-01', () => {
    const values = [5_000, 10_000, 30_000, 60_000];
    const parsed = values.map((value) => parseStagedTimeouts(value));
    const acceptedSourceSignature = [
      { connect: 5_000, headers: 5_000, total: 5_000 },
      { connect: 10_000, headers: 10_000, total: 10_000 },
      { connect: 10_000, headers: 30_000, total: 30_000 },
      { connect: 10_000, headers: 30_000, total: 60_000 },
    ];
    const hasAcceptedSourceSignature = parsed.every((entry, index) => (
      entry.connect === acceptedSourceSignature[index]?.connect &&
      entry.headers === acceptedSourceSignature[index]?.headers &&
      entry.total === acceptedSourceSignature[index]?.total &&
      Object.keys(entry).sort().join(',') === 'connect,headers,total'
    ));
    if (hasAcceptedSourceSignature) {
      expect(parsed).toEqual(acceptedSourceSignature);
      armRed('HTO-01');
    }
    expect(parsed).toEqual(
      values.map((total) => ({ total })),
    );
  });
});

it('HTO-02 explicit staged timeout preserves exact values', async () => {
  await observeRow('HTO-02', () => {
    const explicit = { body: 0, connect: 17, headers: 29, total: 0 };
    expect(parseStagedTimeouts(explicit)).toBe(explicit);
    expect(parseStagedTimeouts({ connect: 0 })).toEqual({ connect: 0 });
    expect(parseStagedTimeouts({ total: 73 })).toEqual({ total: 73 });
  });
});

it('HTO-03F Fetch preserves representative scalar and staged timeout behavior', async () => {
  await observeRow('HTO-03F', async () => {
    const priorFetch = globalThis.fetch;
    let calls = 0;
    const controlledFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        return new Response('ok', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        });
      },
      { preconnect: (_url: string | URL): void => undefined },
    );
    globalThis.fetch = controlledFetch;
    try {
      expect(resolveTimeoutMs(211)).toBe(211);
      expect(resolveTimeoutMs({ connect: 11, headers: 22, total: 233 })).toBe(233);
      const response = await new Rezo({}, fetchAdapter).get('http://fetch.rezo.test/', {
        retry: false,
        timeout: { total: 233 },
      });
      expect(response.status).toBe(200);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

it('HTO-03X XHR preserves representative scalar and staged timeout behavior', async () => {
  await observeRow('HTO-03X', async () => {
    expect(ControlledXMLHttpRequest.instances).toHaveLength(0);
    expect(resolveTimeoutMs(223)).toBe(223);
    expect(resolveTimeoutMs({ body: 71, headers: 31 })).toBe(71);
    const response = await new Rezo({}, xhrAdapter).get('http://xhr.rezo.test/', {
      retry: false,
      timeout: { total: 500 },
    });
    const installedDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'XMLHttpRequest',
    );
    expect(installedDescriptor).toEqual({
      configurable: true,
      enumerable: priorXmlHttpRequestDescriptor?.enumerable ?? false,
      value: ControlledXMLHttpRequest,
      writable: true,
    });
    expect(ControlledXMLHttpRequest.instances).toHaveLength(1);
    const [instance] = ControlledXMLHttpRequest.instances;
    expect(instance?.timeout).toBe(0);
    expect(instance?.readyState).toBe(4);
    expect(instance?.status).toBe(200);
    expect(instance?.responseText).toBe('ok');
    expect(instance?.responseURL).toBe('http://xhr.rezo.test/');
    expect(instance?.requestHeaders).toEqual([]);
    expect(instance?.lifecycle).toEqual([
      'constructed',
      'open:GET:http://xhr.rezo.test/:true',
      'send:empty',
      'readystatechange:4',
      'load',
    ]);
    expect(response.status).toBe(200);
  });
});

it('HTO-03H HTTP2 preserves representative staged deadline behavior', async () => {
  await observeRow('HTO-03H', async () => {
    expect(http2SessionPool).toBeUndefined();
    const pool = Http2SessionPool.getInstance();
    http2SessionPool = pool;
    pool.destroy();
    expect(http2PoolSnapshot(pool)).toEqual({
      cleanupIntervalIsNull: true,
      entries: 0,
      leases: 0,
      pendingCreations: 0,
      sessions: 0,
    });
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerLive = 0;
    let responseCompletions = 0;
    let serverSessions = 0;
    let serverStreams = 0;
    let tailExecutions = 0;
    const server = trackServer(http2.createServer());
    server.on('session', (session) => {
      serverSessions += 1;
      trackHttp2Session(session);
    });
    server.on('stream', async (incomingStream: http2.ServerHttp2Stream) => {
      serverStreams += 1;
      handlerLive += 1;
      const stream = trackHttp2Stream(incomingStream);
      try {
        await releaseTail.promise;
        tailExecutions += 1;
        if (!stream.destroyed && !stream.closed) {
          stream.respond({ ':status': 200, 'content-type': 'text/plain' });
          stream.end('late');
        }
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        responseCompletions += 1;
        tailCompleted.release();
      }
    });
    const port = await listenHttp2(server);
    expect(resolveTimeoutMs({ headers: 41, total: 521 })).toBe(521);
    const request = new Rezo({}, http2Adapter).get(
      `http://127.0.0.1:${port}/hto-03h`,
      {
        hooks: {
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: false,
        timeout: { total: 80 },
      },
    );
    const observation = await within(
      settleExactlyOnce(request),
      1_000,
      'HTTP/2 held stream did not time out',
    );

    expect(observation.outcome.value).toBeNull();
    // Parity: the HTTP/2 total budget surfaces exactly like HTTP/1.1 and Fetch.
    expectStagedTimeoutSignature(observation.outcome.error, 'ECONNABORTED', 'total');
    expect(observation.events).toEqual(['rejected']);
    expect(observation.terminals()).toBe(1);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(serverSessions).toBe(1);
    expect(serverStreams).toBe(1);
    expect(handlerLive).toBe(1);
    expect(responseCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(http2PoolSnapshot(pool)).toEqual({
      cleanupIntervalIsNull: true,
      entries: 1,
      leases: 0,
      pendingCreations: 0,
      sessions: 1,
    });
    const beforeLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
    ];
    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'HTTP/2 held stream tail did not complete',
    );
    await delay(50);
    const afterLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
    ];
    expectNoLateLifecycle('HTO-03H', beforeLate, afterLate);
    expect(handlerLive).toBe(0);
    expect(responseCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    pool.destroy();
    await delay(50);
    expect(http2PoolSnapshot(pool)).toEqual({
      cleanupIntervalIsNull: true,
      entries: 0,
      leases: 0,
      pendingCreations: 0,
      sessions: 0,
    });
    expect(activeHttp2Streams.size).toBe(0);
    expect(activeHttp2Sessions.size).toBe(0);
  });
});

it('HTO-03C cURL preserves representative numeric deadline behavior', async () => {
  await observeRow('HTO-03C', () => {
    expect(resolveTimeoutMs(601)).toBe(601);
    const executor = new CurlExecutor();
    const builder = new CurlCommandBuilder(
      Reflect.get(executor, 'tempFileManager'),
      Reflect.get(executor, 'capabilities'),
    );
    const config = {
      curl: true,
      disableJar: true,
      headers: new RezoHeaders(),
      http2: false,
      maxRedirects: 0,
      method: 'GET',
      rejectUnauthorized: true,
      timeout: 601,
      url: 'http://curl.rezo.test/hto-03c',
    } as RezoConfig;
    const request = {
      headers: new RezoHeaders(),
      method: 'GET',
      retry: false,
      url: 'http://curl.rezo.test/hto-03c',
    } as CurlRequestConfig;
    const { args, tempFiles } = builder.build(config, request);
    const timeoutIndexes = args.flatMap((argument, index) => (
      argument === '--max-time' ? [index] : []
    ));
    expect(timeoutIndexes).toHaveLength(1);
    expect(args[timeoutIndexes[0] ?? -1]).toBe('--max-time');
    // The adapter owns the total budget (601 ms); curl's own limit is the safety
    // net one second later, in seconds with millisecond precision.
    expect(args[(timeoutIndexes[0] ?? -2) + 1]).toBe('1.601');
    expect(args).not.toContain('--connect-timeout');
    expect(tempFiles).toEqual([]);

    // curl exit 28 is classified by the adapter's own timeout phases (connect →
    // ETIMEDOUT, total → ECONNABORTED; CRC-04/CRC-05 observe the live codes) and
    // never reaches the exit-status table, which answers only transport failures.
    expect(classifyCurlExitCode(28, 'curl: (28) Operation timed out')).toBe('REZ_UNKNOWN_ERROR');
    expect(classifyCurlExitCode(7, 'curl: (7) Failed to connect to 127.0.0.1 port 1: Connection refused')).toBe('ECONNREFUSED');
  });
});

it('HTO-03R React Native preserves representative staged timeout behavior', async () => {
  await observeRow('HTO-03R', async () => {
    const priorFetch = globalThis.fetch;
    let calls = 0;
    const controlledFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        return new Response('ok', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        });
      },
      { preconnect: (_url: string | URL): void => undefined },
    );
    globalThis.fetch = controlledFetch;
    try {
      expect(resolveTimeoutMs({ body: 91, headers: 42 })).toBe(91);
      const response = await new Rezo({}, reactNativeAdapter).get(
        'http://react-native.rezo.test/',
        { retry: false, timeout: { total: 700 } },
      );
      expect(response.status).toBe(200);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

if (RUNTIME === 'node') {
  it('HTO-04 pending connect expires once without reaching the server', async () => {
    await observeRow('HTO-04', async () => {
      let afterResponseCalls = 0;
      let beforeErrorCalls = 0;
      let serverHits = 0;
      const server = trackServer(http.createServer((_request, response) => {
        serverHits += 1;
        response.end('unexpected');
      }));
      const port = await listenHttp(server);
      const agent = trackAgent(new PendingLookupAgent(port));
      const request = new Rezo({}, httpAdapter).get(
        'http://pending.rezo.test/hto-04',
        {
          hooks: {
            afterResponse: [(response) => {
              afterResponseCalls += 1;
              return response;
            }],
            beforeError: [(error) => {
              beforeErrorCalls += 1;
              return error;
            }],
          },
          httpAgent: agent,
          retry: false,
          timeout: { connect: 80, total: 500 },
        },
      );
      const settlement = settleExactlyOnce(request);
      await within(
        agent.lookupObserved.promise,
        500,
        'pending lookup was not observed',
      );
      const observation = await within(
        settlement,
        1_000,
        'connect timeout did not settle',
      );

      expectTimeout(observation.outcome, 'ETIMEDOUT', 'connect');
      expectStagedTimeoutSignature(
        observation.outcome.error,
        'ETIMEDOUT',
        'connect',
      );
      expect(observation.terminals()).toBe(1);
      expect(observation.events).toEqual(['rejected']);
      expect(afterResponseCalls).toBe(0);
      expect(beforeErrorCalls).toBe(1);
      expect(agent.assignments).toBe(1);
      expect(agent.lookupCalls).toBe(1);
      expect(serverHits).toBe(0);
      const beforeLate = [
        afterResponseCalls,
        beforeErrorCalls,
        observation.terminals(),
        [...observation.events],
        serverHits,
      ];
      agent.releaseLookup();
      await delay(50);
      const afterLate = [
        afterResponseCalls,
        beforeErrorCalls,
        observation.terminals(),
        [...observation.events],
        serverHits,
      ];
      expectNoLateLifecycle('HTO-04', beforeLate, afterLate);
    });
  });

it('HTO-05 held headers time out once and an early response still succeeds', async () => {
  await observeRow('HTO-05', async () => {
    const heldResponse = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterHeadersCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerCompletions = 0;
    let handlerLive = 0;
    let heldHits = 0;
    let responseFinishes = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (request, response) => {
      if (request.url === '/early') {
        trackResponse(response);
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
        return;
      }
      heldHits += 1;
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        heldResponse.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'late');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const client = new Rezo({}, httpAdapter);
    const pending = client.get(`http://127.0.0.1:${port}/held`, {
      hooks: {
        afterHeaders: [() => {
          afterHeadersCalls += 1;
        }],
        afterResponse: [(response) => {
          afterResponseCalls += 1;
          return response;
        }],
        beforeError: [(error) => {
          beforeErrorCalls += 1;
          return error;
        }],
      },
      retry: false,
      timeout: { headers: 80, total: 500 },
    });
    const settlement = settleExactlyOnce(pending);
    const response = await within(
      heldResponse.promise,
      500,
      'held-headers request did not arrive',
    );
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    const observation = await within(
      settlement,
      1_000,
      'headers timeout did not settle',
    );

    expectTimeout(observation.outcome, 'ESOCKETTIMEDOUT', 'headers');
    expectStagedTimeoutSignature(
      observation.outcome.error,
      'ESOCKETTIMEDOUT',
      'headers',
    );
    expect(observation.terminals()).toBe(1);
    expect(observation.events).toEqual(['rejected']);
    expect(afterHeadersCalls).toBe(0);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(heldHits).toBe(1);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    const beforeLate = [
      afterHeadersCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      heldHits,
    ];
    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'held-headers response tail did not execute',
    );
    await delay(50);
    const afterLate = [
      afterHeadersCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      heldHits,
    ];
    expectNoLateLifecycle('HTO-05', beforeLate, afterLate);
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    expect(responseFinishes).toBe(1);

    let earlyAfterHeadersCalls = 0;
    let earlyAfterResponseCalls = 0;
    let earlyBeforeErrorCalls = 0;
    const earlyRequest = client.get(`http://127.0.0.1:${port}/early`, {
      hooks: {
        afterHeaders: [() => {
          earlyAfterHeadersCalls += 1;
        }],
        afterResponse: [(earlyResponse) => {
          earlyAfterResponseCalls += 1;
          return earlyResponse;
        }],
        beforeError: [(error) => {
          earlyBeforeErrorCalls += 1;
          return error;
        }],
      },
      retry: false,
      timeout: { headers: 300, total: 500 },
    });
    const earlyObservation = await within(
      settleExactlyOnce(earlyRequest),
      1_000,
      'early-headers control did not settle',
    );
    expect(earlyObservation.outcome.error).toBeNull();
    expect(errorField(earlyObservation.outcome.value, 'status')).toBe(200);
    expect(earlyObservation.terminals()).toBe(1);
    expect(earlyObservation.events).toEqual(['fulfilled']);
    expect(earlyAfterHeadersCalls).toBe(1);
    expect(earlyAfterResponseCalls).toBe(1);
    expect(earlyBeforeErrorCalls).toBe(0);
  });
});

it('HTO-06 buffered body timeout rejects once with no late success', async () => {
  await observeRow('HTO-06', async () => {
    const heldResponse = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterHeadersCalls = 0;
    let afterParseCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerCompletions = 0;
    let handlerLive = 0;
    const parsedValues: unknown[] = [];
    let responseFinishes = 0;
    let serverHits = 0;
    let serverWrites = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      serverHits += 1;
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        response.writeHead(200, {
          'content-length': '9',
          'content-type': 'text/plain',
        });
        response.write('part');
        serverWrites += 1;
        heldResponse.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'ial!!');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/buffered`,
      {
        hooks: {
          afterHeaders: [() => {
            afterHeadersCalls += 1;
          }],
          afterParse: [(event) => {
            afterParseCalls += 1;
            parsedValues.push(event.data);
            return event.data;
          }],
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: false,
        timeout: { body: 80, total: 500 },
      },
    );
    const settlement = settleExactlyOnce(request);
    const response = await within(
      heldResponse.promise,
      500,
      'buffered body did not start',
    );
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    const observation = await within(
      settlement,
      1_000,
      'body timeout did not settle',
    );

    expectTimeout(observation.outcome, 'ESOCKETTIMEDOUT', 'body');
    expectStagedTimeoutSignature(
      observation.outcome.error,
      'ESOCKETTIMEDOUT',
      'body',
    );
    expect(observation.terminals()).toBe(1);
    expect(observation.events).toEqual(['rejected']);
    expect(afterHeadersCalls).toBe(1);
    expect(afterParseCalls).toBe(0);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(serverHits).toBe(1);
    expect(serverWrites).toBe(1);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    const beforeLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
      serverHits,
      serverWrites,
    ];
    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'buffered body tail did not execute',
    );
    await delay(50);
    const afterLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
      serverHits,
      serverWrites,
    ];
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    expect(responseFinishes).toBe(1);
    if (
      afterParseCalls === 1 &&
      parsedValues.length === 1 &&
      parsedValues[0] === 'part'
    ) {
      expect(afterParseCalls).toBe(1);
      expect(parsedValues).toEqual(['part']);
      expect(afterResponseCalls).toBe(0);
      expect(beforeErrorCalls).toBe(1);
      expect(observation.terminals()).toBe(1);
      expect(observation.events).toEqual(['rejected']);
      expect(afterLate).toEqual([
        1,
        1,
        0,
        1,
        1,
        ['rejected'],
        ['part'],
        1,
        1,
      ]);
      armRed('HTO-06');
    }
    expect(afterLate).toEqual(beforeLate);
  });
});

it('HTO-07 streaming body timeout emits exactly one error and no success terminal', async () => {
  await observeRow('HTO-07', async () => {
    const heldResponse = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    const terminal = createDeferred<void>();
    const events: string[] = [];
    const errors: unknown[] = [];
    const headerPayloads: Array<{
      contentLength: number | undefined;
      contentType: string | undefined;
      cookies: string[];
      status: number;
      statusText: string;
    }> = [];
    const startPayloads: Array<{
      maxRedirects: number | undefined;
      method: string;
      retryMaxRetries: number | undefined;
      timeout: number | undefined;
      url: string;
    }> = [];
    const statusPayloads: Array<[number | undefined, string | undefined]> = [];
    const cookiePayloads: string[][] = [];
    const progressPayloads: Array<{
      averageMatchesSpeed: boolean;
      estimatedTimePositive: boolean;
      keys: string[];
      loaded: number;
      percentage: number;
      speedPositive: boolean;
      timestampPositive: boolean;
      total: number;
    }> = [];
    let handlerCompletions = 0;
    let handlerLive = 0;
    let responseFinishes = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        response.writeHead(200, {
          'content-length': '9',
          'content-type': 'text/plain',
          'set-cookie': 'hto07=accepted; Path=/',
        });
        response.write('part');
        heldResponse.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'ial!!');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const stream = new Rezo({}, httpAdapter).stream(`http://127.0.0.1:${port}/stream`, {
      retry: false,
      timeout: { body: 80, total: 500 },
    });
    stream.on('initiated', () => events.push('initiated'));
    stream.on('start', (event) => {
      events.push('start');
      startPayloads.push({
        maxRedirects: event.maxRedirects,
        method: event.method,
        retryMaxRetries: event.retry?.maxRetries,
        timeout: event.timeout,
        url: event.url,
      });
    });
    stream.on('headers', (event) => {
      events.push('headers');
      headerPayloads.push({
        contentLength: event.contentLength,
        contentType: event.contentType,
        cookies: (event.cookies ?? []).map(
          (cookie) => `${cookie.key}=${cookie.value};${cookie.path}`,
        ),
        status: event.status,
        statusText: event.statusText,
      });
    });
    stream.on('status', (status, statusText) => {
      events.push('status');
      statusPayloads.push([status, statusText]);
    });
    stream.on('cookies', (cookies) => {
      events.push('cookies');
      cookiePayloads.push(
        cookies.map((cookie) => `${cookie.key}=${cookie.value};${cookie.path}`),
      );
    });
    stream.on('progress', (event) => {
      events.push('progress');
      progressPayloads.push({
        averageMatchesSpeed: event.averageSpeed === event.speed,
        estimatedTimePositive: event.estimatedTime > 0,
        keys: Object.keys(event).sort(),
        loaded: event.loaded,
        percentage: event.percentage,
        speedPositive: event.speed > 0,
        timestampPositive: event.timestamp > 0,
        total: event.total,
      });
    });
    stream.on('data', (chunk) => events.push(`data:${Buffer.from(chunk).toString('utf8')}`));
    stream.on('error', (error) => {
      errors.push(error);
      events.push('error');
      terminal.release();
    });
    stream.on('finish', () => events.push('finish'));
    stream.on('done', () => events.push('done'));
    stream.on('complete', () => events.push('complete'));
    stream.on('end', () => events.push('end'));
    stream.on('close', () => events.push('close'));
    const response = await within(heldResponse.promise, 500, 'stream body did not start');
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    await within(terminal.promise, 1_000, 'stream body timeout did not emit');
    await delay(40);

    if (errors.length === 2) {
      expect(errors).toHaveLength(2);
      expect(errors[1]).toBe(errors[0]);
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(errorField(errors[0], 'code')).toBe('ESOCKETTIMEDOUT');
    expect(errorField(errors[0], 'phase')).toBe('body');
    expect(errorField(errors[0], 'isTimeout')).toBe(true);
    expectStagedTimeoutSignature(
      errors[0],
      'ESOCKETTIMEDOUT',
      'body',
    );
    for (const error of errors) {
      expect(errorField(error, 'code')).toBe('ESOCKETTIMEDOUT');
      expect(errorField(error, 'phase')).toBe('body');
      expect(errorField(error, 'isTimeout')).toBe(true);
    }
    expect(startPayloads).toEqual([{
      maxRedirects: 10,
      method: 'GET',
      retryMaxRetries: undefined,
      timeout: 500,
      url: `http://127.0.0.1:${port}/stream`,
    }]);
    expect(headerPayloads).toEqual([{
      contentLength: 9,
      contentType: 'text/plain',
      // R15 P1 (2026-08-22): H1 exposes the merged response cookies (previously always empty).
      cookies: ['hto07=accepted;/'],
      status: 200,
      statusText: 'OK',
    }]);
    expect(statusPayloads).toEqual([[200, 'OK']]);
    expect(cookiePayloads).toEqual([['hto07=accepted;/']]);
    expect(progressPayloads).toEqual([{
      averageMatchesSpeed: true,
      estimatedTimePositive: true,
      keys: [
        'averageSpeed',
        'estimatedTime',
        'loaded',
        'percentage',
        'speed',
        'timestamp',
        'total',
      ],
      loaded: 4,
      percentage: 400 / 9,
      speedPositive: true,
      timestampPositive: true,
      total: 9,
    }]);
    const expectedEvents = errors.length === 2
      ? [
          'initiated',
          'start',
          'headers',
          'status',
          'cookies',
          'progress',
          'data:part',
          'error',
          'error',
        ]
      : [
          'initiated',
          'start',
          'headers',
          'status',
          'cookies',
          'progress',
          'data:part',
          'error',
        ];
    expect(events).toEqual(expectedEvents);
    const beforeLate = [
      errors.length,
      events.filter((event) => event === 'error').length,
      events.filter((event) => event === 'end').length,
      events.filter((event) => event === 'close').length,
      events.filter((event) => event === 'finish').length,
      events.filter((event) => event === 'done').length,
      events.filter((event) => event === 'complete').length,
      [...events],
    ];
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'stream body tail did not execute',
    );
    await delay(50);
    const afterLate = [
      errors.length,
      events.filter((event) => event === 'error').length,
      events.filter((event) => event === 'end').length,
      events.filter((event) => event === 'close').length,
      events.filter((event) => event === 'finish').length,
      events.filter((event) => event === 'done').length,
      events.filter((event) => event === 'complete').length,
      [...events],
    ];
    expectNoLateLifecycle('HTO-07', beforeLate, afterLate);
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    expect(responseFinishes).toBe(0);
    if (errors.length === 2) {
      expect(events.filter((event) => event === 'error')).toHaveLength(2);
      expect(events.filter((event) => event === 'end')).toHaveLength(0);
      expect(events.filter((event) => event === 'close')).toHaveLength(0);
      expect(events.filter((event) => event === 'finish')).toHaveLength(0);
      expect(events.filter((event) => event === 'done')).toHaveLength(0);
      expect(events.filter((event) => event === 'complete')).toHaveLength(0);
      armRed('HTO-07');
    }
    expect(errors).toHaveLength(1);
  });
});

it('HTO-08 queued request expires before socket assignment and never dispatches late', async () => {
  await observeRow('HTO-08', async () => {
    const heldA = createDeferred<http.ServerResponse>();
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let queuedHits = 0;
    const server = trackServer(http.createServer((request, response) => {
      if (request.url === '/a') {
        trackResponse(response);
        response.setHeader('connection', 'close');
        response.shouldKeepAlive = false;
        heldA.release(response);
        return;
      }
      queuedHits += 1;
      trackResponse(response);
      response.setHeader('connection', 'close');
      response.shouldKeepAlive = false;
      response.end('queued');
    }));
    const port = await listenHttp(server);
    const agent = trackAgent(new QueueLedgerAgent(port));
    const client = new Rezo({}, httpAdapter);
    const requestA = client.get(`http://queued.rezo.test:${port}/a`, {
      httpAgent: agent,
      retry: false,
    });
    const settlementA = settleExactlyOnce(requestA);
    const responseA = await within(
      heldA.promise,
      500,
      'request A did not occupy the socket',
    );
    let bSettled = false;
    const requestB = client.get(`http://queued.rezo.test:${port}/b`, {
      hooks: {
        afterResponse: [(response) => {
          afterResponseCalls += 1;
          return response;
        }],
        beforeError: [(error) => {
          beforeErrorCalls += 1;
          return error;
        }],
      },
      httpAgent: agent,
      retry: false,
      timeout: { total: 80 },
    });
    const settlementB = settleExactlyOnce(requestB).then((observation) => {
      bSettled = true;
      return observation;
    });

    await delay(150);
    const settledBeforeRelease = bSettled;
    const assignmentsBeforeRelease = [...agent.assignmentPaths];
    const connectionsBeforeRelease = agent.connections;
    const hitsBeforeRelease = queuedHits;
    const lookupsBeforeRelease = [...agent.lookupHosts];
    expect(assignmentsBeforeRelease).toEqual(['/a']);
    expect(connectionsBeforeRelease).toBe(1);
    expect(hitsBeforeRelease).toBe(0);
    expect(lookupsBeforeRelease).toEqual(['queued.rezo.test']);

    safeEnd(responseA, 'a');
    const observationA = await within(
      settlementA,
      1_000,
      'request A did not settle after release',
    );
    expect(observationA.outcome.error).toBeNull();
    expect(errorField(observationA.outcome.value, 'status')).toBe(200);
    expect(observationA.terminals()).toBe(1);
    expect(observationA.events).toEqual(['fulfilled']);

    const observationB = await within(
      settlementB,
      1_000,
      'queued request did not settle after release',
    );
    expect(observationB.terminals()).toBe(1);
    if (observationB.outcome.value !== null) {
      expect(settledBeforeRelease).toBe(false);
      expect(observationB.outcome.error).toBeNull();
      expect(errorField(observationB.outcome.value, 'status')).toBe(200);
      expect(observationB.events).toEqual(['fulfilled']);
      expect(afterResponseCalls).toBe(1);
      expect(beforeErrorCalls).toBe(0);
      expect(agent.assignmentPaths).toEqual(['/a', '/b']);
      expect(agent.connections).toBe(2);
      expect(agent.lookupHosts).toEqual([
        'queued.rezo.test',
        'queued.rezo.test',
      ]);
      expect(queuedHits).toBe(1);
    }

    const beforeLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observationB.terminals(),
      [...observationB.events],
      [...agent.assignmentPaths],
      agent.connections,
      [...agent.lookupHosts],
      queuedHits,
    ];
    await delay(50);
    const afterLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observationB.terminals(),
      [...observationB.events],
      [...agent.assignmentPaths],
      agent.connections,
      [...agent.lookupHosts],
      queuedHits,
    ];
    expectNoLateLifecycle('HTO-08', beforeLate, afterLate);

    if (observationB.outcome.value !== null) {
      expect(afterLate).toEqual([
        1,
        0,
        1,
        ['fulfilled'],
        ['/a', '/b'],
        2,
        ['queued.rezo.test', 'queued.rezo.test'],
        1,
      ]);
      armRed('HTO-08');
    }

    expect(settledBeforeRelease).toBe(true);
    expectTimeout(observationB.outcome, 'ECONNABORTED', 'total');
    expect(observationB.events).toEqual(['rejected']);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(agent.assignmentPaths).toEqual(['/a']);
    expect(agent.connections).toBe(1);
    expect(agent.lookupHosts).toEqual(['queued.rezo.test']);
    expect(queuedHits).toBe(0);
  });
});

it('HTO-09 queued request without timeout dispatches after release', async () => {
  await observeRow('HTO-09', async () => {
    const heldA = createDeferred<http.ServerResponse>();
    let queuedHits = 0;
    const server = trackServer(http.createServer((request, response) => {
      if (request.url === '/a') {
        trackResponse(response);
        heldA.release(response);
        return;
      }
      queuedHits += 1;
      response.end('queued');
    }));
    const port = await listenHttp(server);
    const agent = trackAgent(new AssignmentAgent({ keepAlive: true, maxSockets: 1 }));
    const client = new Rezo({}, httpAdapter);
    const requestA = client.get(`http://127.0.0.1:${port}/a`, {
      httpAgent: agent,
      retry: false,
    });
    const responseA = await within(heldA.promise, 500, 'request A did not occupy the socket');
    const requestB = client.get(`http://127.0.0.1:${port}/b`, {
      httpAgent: agent,
      retry: false,
    });
    await delay(30);
    expect(queuedHits).toBe(0);
    safeEnd(responseA, 'a');
    await requestA;
    const responseB = await within(requestB, 1_000, 'queued request did not dispatch');
    expect(responseB.status).toBe(200);
    expect(queuedHits).toBe(1);
    expect(agent.assignments).toBe(2);
  });
});

it('HTO-10 maxSockets two allows both requests to reach the server', async () => {
  await observeRow('HTO-10', async () => {
    let hits = 0;
    const bothArrived = createDeferred<void>();
    const responses: http.ServerResponse[] = [];
    const server = trackServer(http.createServer((_request, response) => {
      hits += 1;
      responses.push(trackResponse(response));
      if (hits === 2) bothArrived.release();
    }));
    const port = await listenHttp(server);
    const agent = trackAgent(new AssignmentAgent({ keepAlive: true, maxSockets: 2 }));
    const client = new Rezo({}, httpAdapter);
    const first = client.get(`http://127.0.0.1:${port}/first`, {
      httpAgent: agent,
      retry: false,
    });
    const second = client.get(`http://127.0.0.1:${port}/second`, {
      httpAgent: agent,
      retry: false,
    });
    await within(bothArrived.promise, 500, 'maxSockets two did not dispatch both requests');
    for (const response of responses) safeEnd(response, 'ok');
    const results = await Promise.all([first, second]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(hits).toBe(2);
    expect(agent.assignments).toBe(2);
  });
});
}

it('HTO-11 unqueued total timeout rejects exactly once', async () => {
  await observeRow('HTO-11', async () => {
    const held = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterHeadersCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerCompletions = 0;
    let handlerLive = 0;
    let responseFinishes = 0;
    let serverHits = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      serverHits += 1;
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        held.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'late');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/slow`,
      {
        hooks: {
          afterHeaders: [() => {
            afterHeadersCalls += 1;
          }],
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: false,
        timeout: { total: 80 },
      },
    );
    const settlement = settleExactlyOnce(request);
    const response = await within(held.promise, 500, 'slow request did not arrive');
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    const observation = await within(
      settlement,
      1_000,
      'total timeout did not settle',
    );

    expectTimeout(observation.outcome, 'ECONNABORTED', 'total');
    expectStagedTimeoutSignature(
      observation.outcome.error,
      'ECONNABORTED',
      'total',
    );
    expect(observation.terminals()).toBe(1);
    expect(observation.events).toEqual(['rejected']);
    expect(afterHeadersCalls).toBe(0);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(serverHits).toBe(1);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    const beforeLate = [
      afterHeadersCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      serverHits,
    ];
    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'unqueued total response tail did not execute',
    );
    await delay(50);
    const afterLate = [
      afterHeadersCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      serverHits,
    ];
    expectNoLateLifecycle('HTO-11', beforeLate, afterLate);
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    expect(responseFinishes).toBe(1);
  });
});

if (RUNTIME === 'node') {
  it('HTO-12 raw node http proves maxSockets one queues and later dispatches', async () => {
    await observeRow('HTO-12', async () => {
    const heldA = createDeferred<http.ServerResponse>();
    let queuedHits = 0;
    const server = trackServer(http.createServer((request, response) => {
      if (request.url === '/a') {
        trackResponse(response);
        heldA.release(response);
        return;
      }
      queuedHits += 1;
      response.end('queued');
    }));
    const port = await listenHttp(server);
    const agent = trackAgent(new http.Agent({ keepAlive: true, maxSockets: 1 }));
    const rawRequest = (path: string): Promise<number> => new Promise((resolve, reject) => {
      const request = http.get({ agent, host: '127.0.0.1', path, port }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      activeRequests.add(request);
      request.once('close', () => activeRequests.delete(request));
      request.once('error', reject);
    });
    const first = rawRequest('/a');
    const responseA = await within(heldA.promise, 500, 'raw request A did not arrive');
    const second = rawRequest('/b');
    await delay(30);
    expect(queuedHits).toBe(0);
    safeEnd(responseA, 'a');
    expect(await first).toBe(200);
    expect(await within(second, 1_000, 'raw queued request did not dispatch')).toBe(200);
    expect(queuedHits).toBe(1);
    });
  });

it('HTO-13 numeric total spans retry attempts without reset', async () => {
  await observeRow('HTO-13', async () => {
    const secondResponseCompleted = createDeferred<void>();
    let afterResponseCalls = 0;
    let attempts = 0;
    let beforeErrorCalls = 0;
    let connections = 0;
    const backoffObservations: Array<{
      attempt: number;
      baseDelay: number;
    }> = [];
    let secondResponseCompletions = 0;
    let secondResponseWrites = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      attempts += 1;
      trackResponse(response);
      try {
        if (attempts === 1) {
          await delay(90);
          response.shouldKeepAlive = false;
          response.writeHead(503, {
            connection: 'close',
            'content-type': 'text/plain',
          });
          response.end('retry');
          return;
        }
        response.writeHead(200, {
          'content-length': '2',
          'content-type': 'text/plain',
        });
        response.write('o');
        secondResponseWrites += 1;
        await delay(120);
        secondResponseCompletions += 1;
        safeEnd(response, 'k');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        if (attempts === 2) secondResponseCompleted.release();
      }
    }));
    server.on('connection', () => {
      connections += 1;
    });
    const port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/retry`,
      {
        hooks: {
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: {
          backoff: (attempt, baseDelay) => {
            backoffObservations.push({ attempt, baseDelay });
            return 0;
          },
          maxRetries: 1,
          retryDelay: 0,
          retryOn: [503],
        },
        timeout: 160,
      },
    );
    const observation = await within(
      settleExactlyOnce(request),
      1_000,
      'retry-budget request did not settle',
    );

    expect(attempts).toBe(2);
    expect(connections).toBe(2);
    expect(backoffObservations).toEqual([{ attempt: 1, baseDelay: 0 }]);
    expect(secondResponseWrites).toBe(1);
    expect(observation.terminals()).toBe(1);
    if (observation.outcome.value !== null) {
      expect(secondResponseCompletions).toBe(1);
      expect(observation.outcome.error).toBeNull();
      expect(errorField(observation.outcome.value, 'status')).toBe(200);
      expect(observation.events).toEqual(['fulfilled']);
      expect(afterResponseCalls).toBe(1);
      expect(beforeErrorCalls).toBe(0);
    } else {
      expect(secondResponseCompletions).toBe(0);
    }

    const beforeLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
    ];
    await within(
      secondResponseCompleted.promise,
      500,
      'retry second response did not complete',
    );
    await delay(50);
    const afterLate = [
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
    ];
    expect(secondResponseCompletions).toBe(1);
    expectNoLateLifecycle('HTO-13', beforeLate, afterLate);

    if (observation.outcome.value !== null) {
      expect(afterLate).toEqual([1, 0, 1, ['fulfilled']]);
      armRed('HTO-13');
    }

    expectTimeout(observation.outcome, 'ECONNABORTED', 'total');
    expect(observation.events).toEqual(['rejected']);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
  });
});

it('HTO-14 staged total spans redirect hops without reset', async () => {
  await observeRow('HTO-14', async () => {
    const destinationResponseCompleted = createDeferred<void>();
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let beforeRedirectCalls = 0;
    let connections = 0;
    let destinationCompletions = 0;
    let sourceHits = 0;
    let destinationHits = 0;
    let destinationWrites = 0;
    const paths: string[] = [];
    let port = 0;
    const server = trackServer(http.createServer(async (request, response) => {
      paths.push(request.url ?? '<missing>');
      trackResponse(response);
      try {
        if (request.url === '/start') {
          sourceHits += 1;
          await delay(90);
          response.shouldKeepAlive = false;
          response.writeHead(302, {
            connection: 'close',
            location: `http://127.0.0.1:${port}/destination`,
          });
          response.end();
          return;
        }
        destinationHits += 1;
        response.writeHead(200, {
          'content-length': '2',
          'content-type': 'text/plain',
        });
        response.write('o');
        destinationWrites += 1;
        await delay(120);
        destinationCompletions += 1;
        safeEnd(response, 'k');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        if (request.url === '/destination') {
          destinationResponseCompleted.release();
        }
      }
    }));
    server.on('connection', () => {
      connections += 1;
    });
    port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/start`,
      {
        hooks: {
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
          beforeRedirect: [() => {
            beforeRedirectCalls += 1;
          }],
        },
        retry: false,
        timeout: { total: 160 },
      },
    );
    const observation = await within(
      settleExactlyOnce(request),
      1_000,
      'redirect-budget request did not settle',
    );

    expect(sourceHits).toBe(1);
    expect(destinationHits).toBe(1);
    expect(paths).toEqual(['/start', '/destination']);
    expect(connections).toBe(2);
    expect(destinationWrites).toBe(1);
    expect(beforeRedirectCalls).toBe(1);
    expect(observation.terminals()).toBe(1);
    if (observation.outcome.value !== null) {
      expect(destinationCompletions).toBe(1);
      expect(observation.outcome.error).toBeNull();
      expect(errorField(observation.outcome.value, 'status')).toBe(200);
      expect(observation.events).toEqual(['fulfilled']);
      expect(afterResponseCalls).toBe(1);
      expect(beforeErrorCalls).toBe(0);
    } else {
      expect(destinationCompletions).toBe(0);
    }

    const beforeLate = [
      afterResponseCalls,
      beforeErrorCalls,
      beforeRedirectCalls,
      observation.terminals(),
      [...observation.events],
    ];
    await within(
      destinationResponseCompleted.promise,
      500,
      'redirect destination response did not complete',
    );
    await delay(50);
    const afterLate = [
      afterResponseCalls,
      beforeErrorCalls,
      beforeRedirectCalls,
      observation.terminals(),
      [...observation.events],
    ];
    expect(destinationCompletions).toBe(1);
    expectNoLateLifecycle('HTO-14', beforeLate, afterLate);

    if (observation.outcome.value !== null) {
      expect(afterLate).toEqual([1, 0, 1, 1, ['fulfilled']]);
      armRed('HTO-14');
    }

    expectTimeout(observation.outcome, 'ECONNABORTED', 'total');
    expect(observation.events).toEqual(['rejected']);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
  });
});
}

it('HTO-15 Agent-free fresh loopback never retains a false connect phase', async () => {
  await observeRow('HTO-15', async () => {
    const heldResponse = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterHeadersCalls = 0;
    let afterParseCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerCompletions = 0;
    let handlerLive = 0;
    const parsedValues: unknown[] = [];
    let responseFinishes = 0;
    let serverHits = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      serverHits += 1;
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        heldResponse.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'ok');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/hto-15`,
      {
        hooks: {
          afterHeaders: [() => {
            afterHeadersCalls += 1;
          }],
          afterParse: [(event) => {
            afterParseCalls += 1;
            parsedValues.push(event.data);
            return event.data;
          }],
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: false,
        timeout: { connect: 60, headers: 400, total: 700 },
      },
    );
    let settled = false;
    const settlement = settleExactlyOnce(request).then((observation) => {
      settled = true;
      return observation;
    });
    const response = await within(
      heldResponse.promise,
      500,
      'HTO-15 request did not reach the loopback server',
    );
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);

    await delay(120);
    const settledBeforeRelease = settled;
    let observationBeforeRelease: SettlementObservation | null = null;
    if (settledBeforeRelease) {
      observationBeforeRelease = await within(
        settlement,
        100,
        'HTO-15 pre-release settlement was not observable',
      );
    }
    expect(serverHits).toBe(1);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    const beforeReleaseError = observationBeforeRelease?.outcome.error;
    const beforeReleaseElapsed = errorField(beforeReleaseError, 'elapsed');
    const beforeReleaseSnapshot = {
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      error: {
        code: errorField(beforeReleaseError, 'code'),
        elapsed: beforeReleaseElapsed,
        isTimeout: errorField(beforeReleaseError, 'isTimeout'),
        message: errorField(beforeReleaseError, 'message'),
        name: errorField(beforeReleaseError, 'name'),
        phase: errorField(beforeReleaseError, 'phase'),
      },
      events: observationBeforeRelease === null
        ? []
        : [...observationBeforeRelease.events],
      handlerCompletions,
      handlerLive,
      observationPresent: observationBeforeRelease !== null,
      outcomeValueIsNull: observationBeforeRelease?.outcome.value === null,
      parsedValues: [...parsedValues],
      responseFinishes,
      serverHits,
      settledBeforeRelease,
      tailExecutions,
      terminals: observationBeforeRelease?.terminals() ?? 0,
    };

    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'HTO-15 held response tail did not execute',
    );
    const observation = await within(
      settlement,
      1_000,
      'HTO-15 request did not settle',
    );
    const beforeLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
      responseFinishes,
    ];
    await delay(80);
    const afterLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
      responseFinishes,
    ];

    expect(serverHits).toBe(1);
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    expect(observation.terminals()).toBe(1);
    expectNoLateLifecycle('HTO-15', beforeLate, afterLate);
    const observationError = observation.outcome.error;
    const afterReleaseSnapshot = {
      afterLate,
      beforeLate,
      error: {
        code: errorField(observationError, 'code'),
        elapsed: errorField(observationError, 'elapsed'),
        isTimeout: errorField(observationError, 'isTimeout'),
        message: errorField(observationError, 'message'),
        name: errorField(observationError, 'name'),
        phase: errorField(observationError, 'phase'),
      },
      handlerCompletions,
      handlerLive,
      observationMatchesPreRelease:
        observationBeforeRelease !== null && observation === observationBeforeRelease,
      outcomeValueIsNull: observation.outcome.value === null,
      responseFinishes,
      serverHits,
      status: errorField(observation.outcome.value, 'status'),
      tailExecutions,
      terminals: observation.terminals(),
    };
    const acceptedBunMessage = typeof beforeReleaseElapsed === 'number'
      ? `Connection timeout: Failed to establish TCP connection within ${beforeReleaseElapsed}ms`
      : undefined;
    const acceptedBunBeforeReleaseSnapshot = {
      afterHeadersCalls: 0,
      afterParseCalls: 0,
      afterResponseCalls: 0,
      beforeErrorCalls: 1,
      error: {
        code: 'ETIMEDOUT',
        elapsed: beforeReleaseElapsed,
        isTimeout: true,
        message: acceptedBunMessage,
        name: 'RezoError',
        phase: 'connect',
      },
      events: ['rejected'],
      handlerCompletions: 0,
      handlerLive: 1,
      observationPresent: true,
      outcomeValueIsNull: true,
      parsedValues: [],
      responseFinishes: 0,
      serverHits: 1,
      settledBeforeRelease: true,
      tailExecutions: 0,
      terminals: 1,
    };
    const acceptedBunAfterReleaseSnapshot = {
      afterLate: [0, 0, 0, 1, 1, ['rejected'], [], 0],
      beforeLate: [0, 0, 0, 1, 1, ['rejected'], [], 0],
      error: {
        code: 'ETIMEDOUT',
        elapsed: beforeReleaseElapsed,
        isTimeout: true,
        message: acceptedBunMessage,
        name: 'RezoError',
        phase: 'connect',
      },
      handlerCompletions: 1,
      handlerLive: 0,
      observationMatchesPreRelease: true,
      outcomeValueIsNull: true,
      responseFinishes: 0,
      serverHits: 1,
      status: undefined,
      tailExecutions: 1,
      terminals: 1,
    };
    const hasAcceptedBunSignature = RUNTIME === 'bun' &&
      typeof beforeReleaseElapsed === 'number' &&
      Number.isInteger(beforeReleaseElapsed) &&
      beforeReleaseElapsed > 0 &&
      JSON.stringify(beforeReleaseSnapshot) ===
        JSON.stringify(acceptedBunBeforeReleaseSnapshot) &&
      JSON.stringify(afterReleaseSnapshot) ===
        JSON.stringify(acceptedBunAfterReleaseSnapshot);
    const desiredBeforeReleaseSnapshot = {
      afterHeadersCalls: 0,
      afterParseCalls: 0,
      afterResponseCalls: 0,
      beforeErrorCalls: 0,
      error: {
        code: undefined,
        elapsed: undefined,
        isTimeout: undefined,
        message: undefined,
        name: undefined,
        phase: undefined,
      },
      events: [],
      handlerCompletions: 0,
      handlerLive: 1,
      observationPresent: false,
      outcomeValueIsNull: false,
      parsedValues: [],
      responseFinishes: 0,
      serverHits: 1,
      settledBeforeRelease: false,
      tailExecutions: 0,
      terminals: 0,
    };
    const desiredLifecycle = [
      1,
      1,
      1,
      0,
      1,
      ['fulfilled'],
      [Buffer.from('ok')],
      1,
    ];
    const desiredAfterReleaseSnapshot = {
      afterLate: desiredLifecycle,
      beforeLate: desiredLifecycle,
      error: {
        code: undefined,
        elapsed: undefined,
        isTimeout: undefined,
        message: undefined,
        name: undefined,
        phase: undefined,
      },
      handlerCompletions: 1,
      handlerLive: 0,
      observationMatchesPreRelease: false,
      outcomeValueIsNull: false,
      responseFinishes: 1,
      serverHits: 1,
      status: 200,
      tailExecutions: 1,
      terminals: 1,
    };
    if (hasAcceptedBunSignature) {
      expect(beforeReleaseSnapshot).toEqual(acceptedBunBeforeReleaseSnapshot);
      expect(afterReleaseSnapshot).toEqual(acceptedBunAfterReleaseSnapshot);
      expectStagedTimeoutSignature(observationError, 'ETIMEDOUT', 'connect');
      armRed('HTO-15');
    }
    expect([beforeReleaseSnapshot, afterReleaseSnapshot]).toEqual([
      desiredBeforeReleaseSnapshot,
      desiredAfterReleaseSnapshot,
    ]);
  });
});

it('HTO-16 Agent-free partial body preserves body-timeout taxonomy once', async () => {
  await observeRow('HTO-16', async () => {
    const heldResponse = createDeferred<http.ServerResponse>();
    const releaseTail = createDeferred<void>();
    const tailCompleted = createDeferred<void>();
    let afterHeadersCalls = 0;
    let afterParseCalls = 0;
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    let handlerCompletions = 0;
    let handlerLive = 0;
    const parsedValues: unknown[] = [];
    let responseFinishes = 0;
    let serverHits = 0;
    let serverWrites = 0;
    let tailExecutions = 0;
    const server = trackServer(http.createServer(async (_request, response) => {
      serverHits += 1;
      trackResponse(response);
      handlerLive += 1;
      response.once('finish', () => {
        responseFinishes += 1;
      });
      try {
        response.writeHead(200, {
          'content-length': '9',
          'content-type': 'text/plain',
        });
        response.flushHeaders();
        response.write('part');
        serverWrites += 1;
        heldResponse.release(response);
        await releaseTail.promise;
        tailExecutions += 1;
        safeEnd(response, 'ial!!');
      } catch (error) {
        recordFixtureError(error);
      } finally {
        handlerLive -= 1;
        handlerCompletions += 1;
        tailCompleted.release();
      }
    }));
    const port = await listenHttp(server);
    const request = new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${port}/hto-16`,
      {
        hooks: {
          afterHeaders: [() => {
            afterHeadersCalls += 1;
          }],
          afterParse: [(event) => {
            afterParseCalls += 1;
            parsedValues.push(event.data);
            return event.data;
          }],
          afterResponse: [(response) => {
            afterResponseCalls += 1;
            return response;
          }],
          beforeError: [(error) => {
            beforeErrorCalls += 1;
            return error;
          }],
        },
        retry: false,
        timeout: { body: 80, total: 500 },
      },
    );
    let settled = false;
    const settlement = settleExactlyOnce(request).then((observation) => {
      settled = true;
      return observation;
    });
    const response = await within(
      heldResponse.promise,
      500,
      'HTO-16 partial body did not reach the loopback wire',
    );
    expect(response.destroyed === true).toBe(false);
    expect(response.writableEnded).toBe(false);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    const observation = await within(
      settlement,
      1_000,
      'HTO-16 body timeout did not settle',
    );
    const settledBeforeRelease = settled;

    const beforeLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
    ];
    expect(settledBeforeRelease).toBe(true);
    expect(serverHits).toBe(1);
    expect(serverWrites).toBe(1);
    expect(handlerLive).toBe(1);
    expect(handlerCompletions).toBe(0);
    expect(tailExecutions).toBe(0);
    expect(responseFinishes).toBe(0);
    const observationError = observation.outcome.error;
    const observationElapsed = errorField(observationError, 'elapsed');
    const beforeReleaseSnapshot = {
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      error: {
        code: errorField(observationError, 'code'),
        elapsed: observationElapsed,
        isTimeout: errorField(observationError, 'isTimeout'),
        message: errorField(observationError, 'message'),
        name: errorField(observationError, 'name'),
        phase: errorField(observationError, 'phase'),
      },
      events: [...observation.events],
      handlerCompletions,
      handlerLive,
      lifecycle: beforeLate,
      outcomeValueIsNull: observation.outcome.value === null,
      parsedValues: [...parsedValues],
      responseFinishes,
      serverHits,
      serverWrites,
      settledBeforeRelease,
      tailExecutions,
      terminals: observation.terminals(),
    };

    releaseTail.release();
    await within(
      tailCompleted.promise,
      500,
      'HTO-16 partial body tail did not execute',
    );
    await delay(250);
    const afterLate = [
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      observation.terminals(),
      [...observation.events],
      [...parsedValues],
    ];

    expect(serverHits).toBe(1);
    expect(serverWrites).toBe(1);
    expect(handlerLive).toBe(0);
    expect(handlerCompletions).toBe(1);
    expect(tailExecutions).toBe(1);
    const afterReleaseSnapshot = {
      afterHeadersCalls,
      afterParseCalls,
      afterResponseCalls,
      beforeErrorCalls,
      error: {
        code: errorField(observationError, 'code'),
        elapsed: observationElapsed,
        isTimeout: errorField(observationError, 'isTimeout'),
        message: errorField(observationError, 'message'),
        name: errorField(observationError, 'name'),
        phase: errorField(observationError, 'phase'),
      },
      events: [...observation.events],
      handlerCompletions,
      handlerLive,
      lifecycle: afterLate,
      outcomeValueIsNull: observation.outcome.value === null,
      parsedValues: [...parsedValues],
      responseFinishes,
      serverHits,
      serverWrites,
      tailExecutions,
      terminals: observation.terminals(),
    };
    const acceptedNodeMessage = typeof observationElapsed === 'number'
      ? `Body timeout: Response body transfer stalled for ${observationElapsed}ms`
      : undefined;
    const acceptedNodeBeforeReleaseSnapshot = {
      afterHeadersCalls: 1,
      afterParseCalls: 0,
      afterResponseCalls: 0,
      beforeErrorCalls: 1,
      error: {
        code: 'ESOCKETTIMEDOUT',
        elapsed: observationElapsed,
        isTimeout: true,
        message: acceptedNodeMessage,
        name: 'RezoError',
        phase: 'body',
      },
      events: ['rejected'],
      handlerCompletions: 0,
      handlerLive: 1,
      lifecycle: [1, 0, 0, 1, 1, ['rejected'], []],
      outcomeValueIsNull: true,
      parsedValues: [],
      responseFinishes: 0,
      serverHits: 1,
      serverWrites: 1,
      settledBeforeRelease: true,
      tailExecutions: 0,
      terminals: 1,
    };
    const acceptedNodeAfterReleaseSnapshot = {
      afterHeadersCalls: 1,
      afterParseCalls: 1,
      afterResponseCalls: 0,
      beforeErrorCalls: 1,
      error: {
        code: 'ESOCKETTIMEDOUT',
        elapsed: observationElapsed,
        isTimeout: true,
        message: acceptedNodeMessage,
        name: 'RezoError',
        phase: 'body',
      },
      events: ['rejected'],
      handlerCompletions: 1,
      handlerLive: 0,
      lifecycle: [1, 1, 0, 1, 1, ['rejected'], ['part']],
      outcomeValueIsNull: true,
      parsedValues: ['part'],
      responseFinishes: 1,
      serverHits: 1,
      serverWrites: 1,
      tailExecutions: 1,
      terminals: 1,
    };
    const acceptedBunBeforeReleaseSnapshot = {
      afterHeadersCalls: 1,
      afterParseCalls: 2,
      afterResponseCalls: 0,
      beforeErrorCalls: 1,
      error: {
        code: 'REZ_HTTP_ERROR',
        elapsed: undefined,
        isTimeout: false,
        message: 'Request failed with status code 200',
        name: 'RezoError',
        phase: undefined,
      },
      events: ['rejected'],
      handlerCompletions: 0,
      handlerLive: 1,
      lifecycle: [1, 2, 0, 1, 1, ['rejected'], ['part', 'part']],
      outcomeValueIsNull: true,
      parsedValues: ['part', 'part'],
      responseFinishes: 0,
      serverHits: 1,
      serverWrites: 1,
      settledBeforeRelease: true,
      tailExecutions: 0,
      terminals: 1,
    };
    const acceptedBunAfterReleaseSnapshot = {
      afterHeadersCalls: 1,
      afterParseCalls: 2,
      afterResponseCalls: 0,
      beforeErrorCalls: 1,
      error: {
        code: 'REZ_HTTP_ERROR',
        elapsed: undefined,
        isTimeout: false,
        message: 'Request failed with status code 200',
        name: 'RezoError',
        phase: undefined,
      },
      events: ['rejected'],
      handlerCompletions: 1,
      handlerLive: 0,
      lifecycle: [1, 2, 0, 1, 1, ['rejected'], ['part', 'part']],
      outcomeValueIsNull: true,
      parsedValues: ['part', 'part'],
      responseFinishes: 1,
      serverHits: 1,
      serverWrites: 1,
      tailExecutions: 1,
      terminals: 1,
    };
    const hasAcceptedNodeSignature = RUNTIME === 'node' &&
      typeof observationElapsed === 'number' &&
      Number.isInteger(observationElapsed) &&
      observationElapsed > 0 &&
      JSON.stringify(beforeReleaseSnapshot) ===
        JSON.stringify(acceptedNodeBeforeReleaseSnapshot) &&
      JSON.stringify(afterReleaseSnapshot) ===
        JSON.stringify(acceptedNodeAfterReleaseSnapshot);
    const hasAcceptedBunSignature = RUNTIME === 'bun' &&
      JSON.stringify(beforeReleaseSnapshot) ===
        JSON.stringify(acceptedBunBeforeReleaseSnapshot) &&
      JSON.stringify(afterReleaseSnapshot) ===
        JSON.stringify(acceptedBunAfterReleaseSnapshot);
    const desiredBeforeReleaseSnapshot = acceptedNodeBeforeReleaseSnapshot;
    const desiredAfterReleaseSnapshot = {
      ...acceptedNodeAfterReleaseSnapshot,
      afterParseCalls: 0,
      lifecycle: [1, 0, 0, 1, 1, ['rejected'], []],
      parsedValues: [],
    };
    if (hasAcceptedNodeSignature) {
      expect(beforeReleaseSnapshot).toEqual(acceptedNodeBeforeReleaseSnapshot);
      expect(afterReleaseSnapshot).toEqual(acceptedNodeAfterReleaseSnapshot);
      expectStagedTimeoutSignature(observationError, 'ESOCKETTIMEDOUT', 'body');
      armRed('HTO-16');
    } else if (hasAcceptedBunSignature) {
      expect(beforeReleaseSnapshot).toEqual(acceptedBunBeforeReleaseSnapshot);
      expect(afterReleaseSnapshot).toEqual(acceptedBunAfterReleaseSnapshot);
      armRed('HTO-16');
    }
    expect([beforeReleaseSnapshot, afterReleaseSnapshot]).toEqual([
      desiredBeforeReleaseSnapshot,
      desiredAfterReleaseSnapshot,
    ]);
    expectStagedTimeoutSignature(observationError, 'ESOCKETTIMEDOUT', 'body');
  });
});

it('HTO-17B buffered gzip source reset settles once with partial response metadata', async () => {
  await observeRow('HTO-17B', async () => {
    const plain = await runPrematureCloseCase('buffered', 'plain');
    const gzip = await runPrematureCloseCase('buffered', 'gzip');
    const plainBody = { hex: '41424344', length: 4 };
    const gzipBody = { hex: '70617274', length: 4 };
    const plainControl = expectedPrematureCloseSnapshot('buffered', 'plain', {
      // R15 P1b (2026-08-22): the H1 buffered network-error settlement carries its transport cause.
      errors: [expectedNetworkError(plainBody, true)],
      hooks: {
        afterHeaders: 1,
        afterParse: 1,
        afterResponse: 0,
        beforeError: 1,
        onTimeout: 0,
        parsedBodies: [plainBody],
      },
      promiseEvents: ['rejected'],
      settled: true,
      terminals: 1,
    });
    const acceptedGzip = expectedPrematureCloseSnapshot('buffered', 'gzip');
    const desiredGzip = expectedPrematureCloseSnapshot('buffered', 'gzip', {
      errors: [expectedNetworkError(gzipBody, true)],
      hooks: {
        afterHeaders: 1,
        afterParse: 1,
        afterResponse: 0,
        beforeError: 1,
        onTimeout: 0,
        parsedBodies: [gzipBody],
      },
      promiseEvents: ['rejected'],
      settled: true,
      terminals: 1,
    });
    const actual = [plain, gzip];
    const accepted = [plainControl, acceptedGzip];
    const desired = [plainControl, desiredGzip];
    if (JSON.stringify(actual) === JSON.stringify(accepted)) {
      expect(actual).toEqual(accepted);
      armRed('HTO-17B');
    }
    expect(actual).toEqual(desired);
  });
});

it('HTO-17S stream source reset settles once after plain and gzip partial data', async () => {
  await observeRow('HTO-17S', async () => {
    const plain = await runPrematureCloseCase('stream', 'plain');
    const gzip = await runPrematureCloseCase('stream', 'gzip');
    const plainPrefix = [
      ...expectedFacadePrefix('GET', 'plain'),
      'progress:4:20',
      'data:41424344',
    ];
    const gzipSent = expectedPrematureCloseSnapshot('stream', 'gzip').sent;
    const gzipPrefix = [
      ...expectedFacadePrefix('GET', 'gzip'),
      `progress:${gzipSent.length}:24`,
      `data:${gzipSent.hex}`,
    ];
    const accepted = [
      expectedPrematureCloseSnapshot('stream', 'plain', {
        events: plainPrefix,
        isFinished: false,
      }),
      expectedPrematureCloseSnapshot('stream', 'gzip', {
        events: gzipPrefix,
        isFinished: false,
      }),
    ];
    const desired = [
      expectedPrematureCloseSnapshot('stream', 'plain', {
        errors: [expectedNetworkError(null, true)],
        events: [...plainPrefix, 'error'],
        isFinished: false,
        settled: true,
        terminals: 1,
      }),
      expectedPrematureCloseSnapshot('stream', 'gzip', {
        errors: [expectedNetworkError(null, true)],
        events: [...gzipPrefix, 'error'],
        isFinished: false,
        settled: true,
        terminals: 1,
      }),
    ];
    const actual = [plain, gzip];
    if (JSON.stringify(actual) === JSON.stringify(accepted)) {
      expect(actual).toEqual(accepted);
      armRed('HTO-17S');
    }
    expect(actual).toEqual(desired);
  });
});

it('HTO-17D download source reset settles once and removes every partial file', async () => {
  await observeRow('HTO-17D', async () => {
    const plain = await runPrematureCloseCase('download', 'plain');
    const gzip = await runPrematureCloseCase('download', 'gzip');
    const plainPrefix = expectedFacadePrefix('GET', 'plain');
    const gzipPrefix = expectedFacadePrefix('GET', 'gzip');
    const plainSent = expectedPrematureCloseSnapshot('download', 'plain').sent;
    const gzipSent = expectedPrematureCloseSnapshot('download', 'gzip').sent;
    const accepted = [
      expectedPrematureCloseSnapshot('download', 'plain', {
        events: plainPrefix,
        file: { exists: true, hex: plainSent.hex, length: plainSent.length },
        isFinished: false,
        valueStatus: 200,
      }),
      expectedPrematureCloseSnapshot('download', 'gzip', {
        events: gzipPrefix,
        file: { exists: true, hex: gzipSent.hex, length: gzipSent.length },
        isFinished: false,
        valueStatus: 200,
      }),
    ];
    const desiredMissingFile = { exists: false, hex: '', length: 0 } as const;
    const desired = [
      expectedPrematureCloseSnapshot('download', 'plain', {
        errors: [expectedNetworkError(null, true)],
        events: [...plainPrefix, 'error'],
        file: desiredMissingFile,
        isFinished: false,
        settled: true,
        terminals: 1,
        valueStatus: 200,
      }),
      expectedPrematureCloseSnapshot('download', 'gzip', {
        errors: [expectedNetworkError(null, true)],
        events: [...gzipPrefix, 'error'],
        file: desiredMissingFile,
        isFinished: false,
        settled: true,
        terminals: 1,
        valueStatus: 200,
      }),
    ];
    const actual = [plain, gzip];
    if (JSON.stringify(actual) === JSON.stringify(accepted)) {
      expect(actual).toEqual(accepted);
      armRed('HTO-17D');
    }
    expect(actual).toEqual(desired);
  });
});

it('HTO-17U upload gzip response-source reset preserves response-error taxonomy', async () => {
  await observeRow('HTO-17U', async () => {
    const plain = await runPrematureCloseCase('upload', 'plain');
    const gzip = await runPrematureCloseCase('upload', 'gzip');
    const plainBody = { hex: '41424344', length: 4 };
    const gzipBody = { hex: '70617274', length: 4 };
    const plainPrefix = expectedFacadePrefix('POST', 'plain');
    const gzipPrefix = expectedFacadePrefix('POST', 'gzip');
    const plainControl = expectedPrematureCloseSnapshot('upload', 'plain', {
      // R15 P1b (2026-08-22): the H1 buffered network-error settlement carries its transport cause.
      errors: [expectedNetworkError(plainBody, true)],
      events: [...plainPrefix, 'error'],
      hooks: {
        afterHeaders: 1,
        afterParse: 1,
        afterResponse: 0,
        beforeError: 1,
        onTimeout: 0,
        parsedBodies: [plainBody],
      },
      isFinished: false,
      settled: true,
      terminals: 1,
      valueStatus: 200,
    });
    const acceptedGzip = expectedPrematureCloseSnapshot('upload', 'gzip', {
      events: gzipPrefix,
      isFinished: false,
      valueStatus: 200,
    });
    const desiredGzip = expectedPrematureCloseSnapshot('upload', 'gzip', {
      errors: [expectedNetworkError(gzipBody, true)],
      events: [...gzipPrefix, 'error'],
      hooks: {
        afterHeaders: 1,
        afterParse: 1,
        afterResponse: 0,
        beforeError: 1,
        onTimeout: 0,
        parsedBodies: [gzipBody],
      },
      isFinished: false,
      settled: true,
      terminals: 1,
      valueStatus: 200,
    });
    const actual = [plain, gzip];
    const accepted = [plainControl, acceptedGzip];
    const desired = [plainControl, desiredGzip];
    if (JSON.stringify(actual) === JSON.stringify(accepted)) {
      expect(actual).toEqual(accepted);
      armRed('HTO-17U');
    }
    expect(actual).toEqual(desired);
  });
});

interface CauseDescriptorSnapshot {
  readonly configurable: boolean | undefined;
  readonly enumerable: boolean | undefined;
  readonly hasGet: boolean;
  readonly hasSet: boolean;
  readonly valueIsThrown: boolean;
  readonly writable: boolean | undefined;
}

interface RawResponseSnapshot {
  readonly closeCount: number;
  readonly closed: boolean;
  readonly complete: boolean;
  readonly destroyed: boolean;
}

interface ForgedHookThrowSnapshot {
  readonly beforeErrorArgIsOutcome: boolean;
  readonly causeDescriptor: CauseDescriptorSnapshot | null;
  readonly causeKeyEnumerated: boolean;
  readonly causeMessageExact: boolean;
  readonly connections: number;
  readonly error: PublicErrorSnapshot | null;
  readonly facade: {
    readonly captureCalls: number;
    readonly captureListenerGoneAfterFire: boolean;
    readonly requestCalls: number;
    readonly requestPaths: string[];
  };
  readonly hooks: {
    readonly afterHeaders: number;
    readonly afterParse: number;
    readonly afterResponse: number;
    readonly beforeError: number;
    readonly onTimeout: number;
  };
  readonly hopTwoContentLength: unknown;
  readonly hopTwoStatus: unknown;
  readonly order: string[];
  readonly promiseEvents: string[];
  readonly publicMessageExact: boolean;
  readonly rawAtBeforeError: RawResponseSnapshot | null;
  readonly rawAtSettlement: RawResponseSnapshot | null;
  readonly requestEnds: number;
  readonly serverHits: number;
  readonly stable: boolean;
  readonly terminals: number;
  readonly uncaught: string[];
  readonly unhandled: string[];
}

interface FacadeCaptureState {
  captureCalls: number;
  captured: http.IncomingMessage | null;
  captureListenerGoneAfterFire: boolean;
  closeCount: number;
  readonly order: string[];
  requestCalls: number;
  readonly requestPaths: string[];
}

interface HttpModuleFacade {
  request(...requestArgs: unknown[]): http.ClientRequest;
}

function snapshotFacadeRaw(state: FacadeCaptureState): RawResponseSnapshot | null {
  if (state.captured === null) return null;
  return {
    closeCount: state.closeCount,
    closed: state.captured.closed,
    complete: state.captured.complete,
    destroyed: state.captured.destroyed,
  };
}

// Per-request transport facade: a redirect hook assigns this object as
// `config.adapter` for one logical request only, so the capture rides the
// product's own adapter-selection seam (the runtime consumes only
// `.request`, http.ts:1681). The sole exact-path request gets a plain
// `prependOnceListener('response')` — established EventEmitter API,
// instance-local, automatically one-shot; no descriptor machinery anywhere.
// Every facade call is counted and its path recorded BEFORE filtering, and
// only an exact path match may attach, so stray traffic or a non-string
// path deviates the pinned snapshot instead of being captured.
function createHttpModuleFacade(
  exactPath: string,
  state: FacadeCaptureState,
): HttpModuleFacade {
  const nativeRequest = http.request as (
    ...requestArgs: unknown[]
  ) => http.ClientRequest;
  let attachInstalled = false;
  return {
    request(...requestArgs: unknown[]): http.ClientRequest {
      const request = nativeRequest(...requestArgs);
      state.requestCalls += 1;
      const requestPath = Reflect.get(request, 'path');
      state.requestPaths.push(
        typeof requestPath === 'string' ? requestPath : '(non-string)',
      );
      if (requestPath !== exactPath || attachInstalled) {
        return request;
      }
      attachInstalled = true;
      const capture = (response: http.IncomingMessage): void => {
        state.captureCalls += 1;
        state.captured = response;
        response.once('close', () => {
          state.closeCount += 1;
        });
        state.order.push('captured');
        state.captureListenerGoneAfterFire =
          !request.listeners('response').includes(capture);
      };
      request.prependOnceListener('response', capture);
      return request;
    },
  };
}

async function runForgedHookThrowCase(): Promise<ForgedHookThrowSnapshot> {
  const responseStarted = createDeferred<void>();
  const settlementObserved = createDeferred<void>();
  const uncaught: string[] = [];
  const unhandled: string[] = [];
  let afterHeaders = 0;
  let afterParse = 0;
  let afterResponse = 0;
  let beforeError = 0;
  const beforeErrorArgState: { value: unknown } = { value: undefined };
  let connections = 0;
  const facadeState: FacadeCaptureState = {
    captureCalls: 0,
    captured: null,
    captureListenerGoneAfterFire: false,
    closeCount: 0,
    order: [],
    requestCalls: 0,
    requestPaths: [],
  };
  const fixtureSockets: net.Socket[] = [];
  let hopTwoContentLength: unknown;
  let hopTwoStatus: unknown;
  let onTimeout = 0;
  const promiseState: { observation: SettlementObservation | null } = {
    observation: null,
  };
  const rawState: { atBeforeError: RawResponseSnapshot | null } = {
    atBeforeError: null,
  };
  let requestEnds = 0;
  let serverHits = 0;
  const facade = createHttpModuleFacade('/hto-18c-hop2', facadeState);

  const onUncaughtException = (error: Error): void => {
    uncaught.push(`${error.name}:${String(errorField(error, 'code') ?? '')}:${error.message}`);
  };
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason instanceof Error
      ? `${reason.name}:${String(errorField(reason, 'code') ?? '')}:${reason.message}`
      : String(reason));
  };
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  const thrown = new Error('hookboom-18c');
  (thrown as NodeJS.ErrnoException).code = 'ECONNRESET';

  const hooks: Partial<RezoHooks> = {
    afterHeaders: [(event, config) => {
      afterHeaders += 1;
      if (event.status === 302) {
        facadeState.order.push('bootstrap-afterHeaders');
        // Route ONLY this logical request's next hop through the facade via
        // the product's own adapter-selection seam (http.ts httpModule pick).
        config.adapter = facade;
        return;
      }
      facadeState.order.push('target-afterHeaders');
      hopTwoContentLength = event.contentLength;
      hopTwoStatus = event.status;
      throw thrown;
    }],
    afterParse: [(event) => {
      afterParse += 1;
      return event.data;
    }],
    afterResponse: [(response) => {
      afterResponse += 1;
      return response;
    }],
    beforeError: [(error) => {
      beforeError += 1;
      beforeErrorArgState.value = error;
      facadeState.order.push('beforeError');
      // beforeError runs before public settlement, so this snapshot proves
      // the raw client response was already torn down BEFORE rejection.
      rawState.atBeforeError = snapshotFacadeRaw(facadeState);
      return error;
    }],
    onTimeout: [() => {
      onTimeout += 1;
    }],
  };

  const server = trackServer(http.createServer((request, response) => {
    serverHits += 1;
    trackResponse(response);
    request.on('data', () => undefined);
    request.on('error', recordFixtureError);
    request.once('end', () => {
      requestEnds += 1;
      if (request.url === '/hto-18c-hop1') {
        response.writeHead(302, { location: '/hto-18c-hop2' });
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-length': '1000',
        'content-type': 'text/plain',
      });
      response.flushHeaders();
      response.write('part');
      responseStarted.release();
    });
  }));
  server.on('connection', (socket: net.Socket) => {
    connections += 1;
    fixtureSockets.push(socket);
  });

  try {
    const port = await listenHttp(server);
    const url = `http://127.0.0.1:${port}/hto-18c-hop1`;
    const client = new Rezo({}, httpAdapter);
    const options = { cache: false, hooks, retry: false } as const;
    const request = client.get(url, options);
    void settleExactlyOnce(request).then((observation) => {
      promiseState.observation = observation;
      facadeState.order.push(...observation.events);
      settlementObserved.release();
    }).catch((error: unknown) => {
      recordFixtureError(error);
      settlementObserved.release();
    });

    await within(
      responseStarted.promise,
      1_000,
      `forged-hook fixture did not start its response (hits=${serverHits}, ends=${requestEnds})`,
    );
    await within(
      settlementObserved.promise,
      3_000,
      'forged-hook request did not settle after the hook threw',
    );
    // A missing raw-response teardown is a PRODUCT defect signal, so it must
    // surface through the desired-snapshot assertion (rawAtBeforeError and
    // rawAtSettlement below), never as an infrastructure throw.
    const rawAtSettlement = snapshotFacadeRaw(facadeState);
    await delay(200);
    const observationBeforeStability = promiseState.observation;
    const stabilityBefore = JSON.stringify({
      afterHeaders,
      afterParse,
      afterResponse,
      beforeError,
      onTimeout,
      promiseEvents: observationBeforeStability === null
        ? []
        : [...observationBeforeStability.events],
      rawLive: snapshotFacadeRaw(facadeState),
      terminals: observationBeforeStability?.terminals() ?? 0,
      uncaught,
      unhandled,
    });
    await delay(100);
    const observation = promiseState.observation;
    const stabilityAfter = JSON.stringify({
      afterHeaders,
      afterParse,
      afterResponse,
      beforeError,
      onTimeout,
      promiseEvents: observation === null ? [] : [...observation.events],
      rawLive: snapshotFacadeRaw(facadeState),
      terminals: observation?.terminals() ?? 0,
      uncaught,
      unhandled,
    });
    if (stabilityAfter !== stabilityBefore) {
      lateEvents.push(`HTO-18C:${stabilityBefore}->${stabilityAfter}`);
    }
    const outcomeError = observation === null ? null : observation.outcome.error;
    const causeDescriptor = outcomeError === null
      ? null
      : Object.getOwnPropertyDescriptor(Object(outcomeError), 'cause');
    const causeValue = outcomeError === null
      ? undefined
      : errorField(outcomeError, 'cause');
    return {
      beforeErrorArgIsOutcome: outcomeError !== null &&
        beforeErrorArgState.value === outcomeError,
      causeDescriptor: outcomeError === null ? null : {
        configurable: causeDescriptor?.configurable,
        enumerable: causeDescriptor?.enumerable,
        hasGet: causeDescriptor?.get !== undefined,
        hasSet: causeDescriptor?.set !== undefined,
        valueIsThrown: causeDescriptor?.value === thrown,
        writable: causeDescriptor?.writable,
      },
      causeKeyEnumerated: outcomeError !== null &&
        Object.keys(Object(outcomeError)).includes('cause'),
      causeMessageExact: errorField(causeValue, 'message') === 'hookboom-18c',
      connections,
      error: outcomeError === null ? null : snapshotPublicError(outcomeError, true),
      facade: {
        captureCalls: facadeState.captureCalls,
        captureListenerGoneAfterFire: facadeState.captureListenerGoneAfterFire,
        requestCalls: facadeState.requestCalls,
        requestPaths: [...facadeState.requestPaths],
      },
      hooks: { afterHeaders, afterParse, afterResponse, beforeError, onTimeout },
      hopTwoContentLength,
      hopTwoStatus,
      order: [...facadeState.order],
      promiseEvents: observation === null ? [] : [...observation.events],
      publicMessageExact: outcomeError !== null &&
        errorField(outcomeError, 'message') === 'hookboom-18c',
      rawAtBeforeError: rawState.atBeforeError,
      rawAtSettlement,
      requestEnds,
      serverHits,
      stable: stabilityAfter === stabilityBefore,
      terminals: observation?.terminals() ?? 0,
      uncaught,
      unhandled,
    };
  } finally {
    try {
      for (const socket of fixtureSockets) {
        if (!socket.destroyed) socket.destroy();
      }
      await closeTrackedHttpServer(server);
    } finally {
      process.off('uncaughtException', onUncaughtException);
      process.off('unhandledRejection', onUnhandledRejection);
    }
  }
}

it('HTO-18C forged-code hook throw keeps callback taxonomy and tears down the raw response before settlement', async () => {
  await observeRow('HTO-18C', async () => {
    const actual = await runForgedHookThrowCase();
    const rawTornDown: RawResponseSnapshot = {
      closeCount: 1,
      closed: true,
      complete: false,
      destroyed: true,
    };
    const desired: ForgedHookThrowSnapshot = {
      beforeErrorArgIsOutcome: true,
      causeDescriptor: {
        configurable: false,
        enumerable: false,
        hasGet: false,
        hasSet: false,
        valueIsThrown: true,
        writable: false,
      },
      causeKeyEnumerated: false,
      causeMessageExact: true,
      connections: 1,
      error: {
        body: null,
        causeCode: 'ECONNRESET',
        causeMessage: 'nonempty',
        causeName: 'Error',
        code: 'REZ_UNKNOWN_ERROR',
        errno: -9999,
        isNetworkError: false,
        isRetryable: false,
        isTimeout: false,
        message: 'nonempty',
        name: 'RezoError',
        phase: undefined,
        responseStatus: undefined,
        status: undefined,
      },
      facade: {
        captureCalls: 1,
        captureListenerGoneAfterFire: true,
        requestCalls: 1,
        requestPaths: ['/hto-18c-hop2'],
      },
      hooks: {
        afterHeaders: 2,
        afterParse: 1,
        afterResponse: 0,
        beforeError: 1,
        onTimeout: 0,
      },
      hopTwoContentLength: 1000,
      hopTwoStatus: 200,
      order: [
        'bootstrap-afterHeaders',
        'captured',
        'target-afterHeaders',
        'beforeError',
        'rejected',
      ],
      promiseEvents: ['rejected'],
      publicMessageExact: true,
      rawAtBeforeError: rawTornDown,
      rawAtSettlement: rawTornDown,
      requestEnds: 2,
      serverHits: 2,
      stable: true,
      terminals: 1,
      uncaught: [],
      unhandled: [],
    };
    expect(actual).toEqual(desired);
  });
});

// A proxy that accepts the TCP connection and never answers: the tunnel
// handshake is the request's connection phase, which no 'socket' event anchors.
async function startSilentProxy(): Promise<{ url: string; socksUrl: string; connections: () => number; live: () => number; release: () => void }> {
  const sockets = new Set<net.Socket>();
  let connections = 0;
  const proxy = trackServer(net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    // Read and discard: a paused socket never surfaces the peer's FIN, so only a
    // reading proxy can observe the client closing its end.
    socket.resume();
    socket.once('close', () => sockets.delete(socket));
  }));
  const port = await new Promise<number>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as net.AddressInfo).port)));
  return {
    url: `http://127.0.0.1:${port}`,
    socksUrl: `socks5://127.0.0.1:${port}`,
    connections: () => connections,
    live: () => sockets.size,
    release: () => { for (const socket of sockets) socket.destroy(); },
  };
}

it('HTO-19P proxied connect phase expires inside the tunnel handshake with ETIMEDOUT/connect', async () => {
  await observeRow('HTO-19P', async () => {
    const proxy = await startSilentProxy();
    let afterResponseCalls = 0;
    let beforeErrorCalls = 0;
    const timeoutTypes: string[] = [];
    const request = new Rezo({}, httpAdapter).get('https://proxied.rezo.test/hto-19p', {
      hooks: {
        afterResponse: [(response) => { afterResponseCalls += 1; return response; }],
        beforeError: [(error) => { beforeErrorCalls += 1; return error; }],
        onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }],
      },
      proxy: proxy.url,
      retry: false,
      timeout: { connect: 120, total: 1500 },
    });
    const observation = await within(settleExactlyOnce(request), 1_000, 'proxied connect timeout did not settle');
    expectTimeout(observation.outcome, 'ETIMEDOUT', 'connect');
    expectStagedTimeoutSignature(observation.outcome.error, 'ETIMEDOUT', 'connect');
    expect(observation.terminals()).toBe(1);
    expect(observation.events).toEqual(['rejected']);
    expect(timeoutTypes).toEqual(['connect']);
    expect(afterResponseCalls).toBe(0);
    expect(beforeErrorCalls).toBe(1);
    expect(proxy.connections()).toBe(1);
    const beforeLate = [afterResponseCalls, beforeErrorCalls, observation.terminals(), [...observation.events], [...timeoutTypes]];
    proxy.release();
    await delay(50);
    const afterLate = [afterResponseCalls, beforeErrorCalls, observation.terminals(), [...observation.events], [...timeoutTypes]];
    expectNoLateLifecycle('HTO-19P', beforeLate, afterLate);
  });
});

it('HTO-20P proxied total budget still settles ECONNABORTED/total inside the tunnel handshake (control)', async () => {
  await observeRow('HTO-20P', async () => {
    const proxy = await startSilentProxy();
    const timeoutTypes: string[] = [];
    const request = new Rezo({}, httpAdapter).get('https://proxied.rezo.test/hto-20p', {
      hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
      proxy: proxy.url,
      retry: false,
      timeout: 250,
    });
    const observation = await within(settleExactlyOnce(request), 1_000, 'proxied total timeout did not settle');
    expectTimeout(observation.outcome, 'ECONNABORTED', 'total');
    expectStagedTimeoutSignature(observation.outcome.error, 'ECONNABORTED', 'total');
    expect(observation.terminals()).toBe(1);
    expect(timeoutTypes).toEqual(['request']);
    expect(proxy.connections()).toBe(1);
    proxy.release();
  });
});

/**
 * The pending handshake socket belongs to the adapter. A connect timeout that
 * fires inside the proxy handshake settles the request AND tears that socket
 * down, so the proxy observes the close on its own; the caller never has to
 * release anything. Sampled at settlement, +50ms and +300ms without any
 * fixture-side release.
 */
async function observePendingHandshakeFinality(id: RowId, proxyUrl: (proxy: Awaited<ReturnType<typeof startSilentProxy>>) => string): Promise<void> {
  await observeRow(id, async () => {
    if (EXPECTED_RED.includes(id)) armRed(id);
    const proxy = await startSilentProxy();
    try {
      const timeoutTypes: string[] = [];
      const request = new Rezo({}, httpAdapter).get(`https://proxied.rezo.test/${id.toLowerCase()}`, {
        hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
        proxy: proxyUrl(proxy),
        retry: false,
        timeout: { connect: 120, total: 1500 },
      });
      const observation = await within(settleExactlyOnce(request), 1_000, 'proxied connect timeout did not settle');
      expectTimeout(observation.outcome, 'ETIMEDOUT', 'connect');
      expectStagedTimeoutSignature(observation.outcome.error, 'ETIMEDOUT', 'connect');
      expect(timeoutTypes).toEqual(['connect']);
      expect(proxy.connections()).toBe(1);
      const liveAtSettlement = proxy.live();
      await delay(50);
      const liveAfter50 = proxy.live();
      await delay(250);
      const liveAfter300 = proxy.live();
      expect({ liveAtSettlementAtMostOne: liveAtSettlement <= 1, liveAfter50, liveAfter300 }).toEqual({ liveAtSettlementAtMostOne: true, liveAfter50: 0, liveAfter300: 0 });
      expect(observation.terminals()).toBe(1);
      expect(observation.events).toEqual(['rejected']);
    } finally {
      proxy.release();
    }
  });
}

it('HTO-21P a connect timeout inside the CONNECT handshake closes the pending proxy socket without caller help', async () => {
  await observePendingHandshakeFinality('HTO-21P', (proxy) => proxy.url);
});

it('HTO-22P a connect timeout inside the SOCKS5 handshake closes the pending proxy socket without caller help', async () => {
  await observePendingHandshakeFinality('HTO-22P', (proxy) => proxy.socksUrl);
});
