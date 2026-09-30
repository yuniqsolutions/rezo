import { afterAll, afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  brotliCompressSync,
  deflateRawSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from 'node:zlib';
import * as nodeFs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RezoHooks } from '../src/core/hooks';
import { RezoError } from '../src/errors/rezo-error';
import { executeRequest as httpExecuteRequest } from '../src/adapters/http';
import { executeRequest as http2ExecuteRequest } from '../src/adapters/http2';
import { getGlobalAgentPool, resetGlobalAgentPool } from '../src/utils/agent-pool';
import { getFS } from '../src/utils/http-config';

class InfrastructureError extends Error {}

type RowId =
  | 'CI-Z1' | 'CI-Z2' | 'CI-Z3' | 'CI-Z4'
  | 'CI-Z5' | 'CI-Z6' | 'CI-Z7' | 'CI-Z8'
  | 'CI-M1' | 'CI-M2' | 'CI-M3' | 'CI-B1'
  | 'CI-G1A' | 'CI-G1B' | 'CI-G1C'
  | 'CI-S1' | 'CI-S2' | 'CI-S3'
  | 'CI-C0' | 'CI-C1' | 'CI-C2' | 'CI-C3' | 'CI-C4';

const FILE = 'test/a-plus-http-compression-integrity.test.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const RUNTIME_VERSION = RUNTIME === 'bun' ? (process.versions.bun ?? '') : process.version;
// GREEN-v2 (DECISION-153/155, DEC160-Q2 constraint): clients are built from the
// PUBLIC runtime entries' captured defaults via `.create()` — never through an
// adapterless `new Rezo()` or direct adapter injection. Each entry's default
// instance closes over its own explicit adapter even though every entry
// mutates the shared global adapter on import.
const H1_ENTRY = RUNTIME === 'bun'
  ? await import('../src/platform/bun')
  : await import('../src/platform/node');
const H2_ENTRY = await import('../src/adapters/entries/http2');
const H1_ENTRY_PATH = RUNTIME === 'bun' ? 'src/platform/bun.ts' : 'src/platform/node.ts';
const H2_ENTRY_PATH = 'src/adapters/entries/http2.ts';
function sourceSha256(relativePath: string): string {
  return sha256(nodeFs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url))));
}
function adapterIdentityOf(instance: unknown): 'http' | 'http2' | 'unknown' {
  const adapter = Reflect.get(Object(instance), 'adapter');
  if (adapter === httpExecuteRequest) return 'http';
  if (adapter === http2ExecuteRequest) return 'http2';
  return 'unknown';
}
// Entry identity is an OBSERVATION, never a label: the entry source bytes
// hashed at runtime plus the adapter function each captured default closes
// over (compared by identity against the adapter modules themselves).
// The captured default is the callable request shorthand (a function wrapper
// over the instance), so the adapter is observed on a client produced by its
// `.create()` factory — the exact construction path every leg uses.
const ENTRY_IDENTITY = Object.freeze({
  h1: { adapter: adapterIdentityOf(H1_ENTRY.default.create({})), defaultKind: typeof H1_ENTRY.default, factory: typeof H1_ENTRY.default.create, path: H1_ENTRY_PATH, sourceSha256: sourceSha256(H1_ENTRY_PATH) },
  h2: { adapter: adapterIdentityOf(H2_ENTRY.default.create({})), defaultKind: typeof H2_ENTRY.default, factory: typeof H2_ENTRY.default.create, path: H2_ENTRY_PATH, sourceSha256: sourceSha256(H2_ENTRY_PATH) },
});
const REGISTERED: RowId[] = [
  'CI-Z1', 'CI-Z2', 'CI-Z3', 'CI-Z4', 'CI-Z5', 'CI-Z6', 'CI-Z7', 'CI-Z8',
  'CI-M1', 'CI-M2', 'CI-M3', 'CI-B1', 'CI-G1A', 'CI-G1B', 'CI-G1C',
  'CI-S1', 'CI-S2', 'CI-S3',
  'CI-C0', 'CI-C1', 'CI-C2', 'CI-C3', 'CI-C4',
];
// GREEN epoch (R07 software-complete, 2026-08-18): every previously RED
// row's accepted-current signature was repaired out of existence. The
// arming machinery stays fail-closed — if any silent-success signature
// ever reproduces again, armRed() throws on the empty membership and
// the run is loudly invalid rather than quietly red.
const EXPECTED_RED: RowId[] = [];
const EXPECTED_PASSED = REGISTERED.filter((id) => !EXPECTED_RED.includes(id));
// Frozen target/control registry (GREEN-v2 schema): targets are the 18 rows
// that were RED before the R07 repairs; controls are the five coherence rows.
const REGISTRY = Object.freeze({
  controls: ['CI-C0', 'CI-C1', 'CI-C2', 'CI-C3', 'CI-C4'] as readonly RowId[],
  targets: [
    'CI-Z1', 'CI-Z2', 'CI-Z3', 'CI-Z4', 'CI-Z5', 'CI-Z6', 'CI-Z7', 'CI-Z8',
    'CI-M1', 'CI-M2', 'CI-M3', 'CI-B1', 'CI-G1A', 'CI-G1B', 'CI-G1C',
    'CI-S1', 'CI-S2', 'CI-S3',
  ] as readonly RowId[],
});

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
const activeServers = new Set<http.Server | http2.Http2Server>();
const activeSockets = new Set<net.Socket>();
const activeSessions = new Set<http2.ServerHttp2Session>();
const activeTimers = new Set<NodeJS.Timeout>();
const activeTemporaryDirectories = new Set<string>();
// Forced-teardown counters: every resource the fixture had to destroy or
// remove itself is counted, so cleanup zeros can never be manufactured
// silently — the ledger reports natural state per leg AND the forced work.
const forcedCleanup = { serversClosed: 0, sessionsDestroyed: 0, socketsClosedWithSessions: 0, socketsDestroyed: 0, temporaryDirectoriesRemoved: 0, timersCleared: 0 };
// Every server-side error the fixture observes (server/session/stream/socket)
// is recorded here; every R07 wire responds fully, so any entry fails the file.
const fixtureEvents: string[] = [];
// GREEN-v2 physical-leg ledger: every wire the file executes is recorded
// under its row with exact outcome/hash/event/error/lifecycle/hook fields.
const legs: Record<string, unknown> = {};
let currentRow: RowId | null = null;
let legSequence = 0;

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorField(error: unknown, field: string): unknown {
  return Reflect.get(Object(error), field);
}

// Ordered event serialization with run-length collapse (`data x 17`), so a
// leg's exact facade/hook/settlement order survives into the ledger.
// Frozen-sequence normalization: drop `progress` (its count follows the
// runtime's chunking, recorded separately as progressEvents) and collapse
// consecutive duplicates, so the exact ORDER of every other facade event,
// hook firing and settlement is pinned per leg on Node and Bun alike.
function normalizeSequence(sequence: readonly string[]): string[] {
  // Raw cardinality is preserved for every terminal/control/hook event; only
  // the runtime-dependent chunk multiplicity (data/progress runs, the sole
  // tokens collapseEvents ever run-length encodes) collapses into a single
  // `body` token. A duplicate end/error/finish stays one token each.
  const normalized: string[] = [];
  for (const entry of sequence) {
    if (/^(data|progress)(x\d+)?$/.test(entry)) {
      if (normalized[normalized.length - 1] !== 'body') normalized.push('body');
      continue;
    }
    normalized.push(entry);
  }
  return normalized;
}

function collapseEvents(sequence: readonly string[]): string[] {
  // Only data/progress chunk runs are run-length encoded (`data x 17`);
  // every other event is emitted one token per occurrence.
  const collapsed: string[] = [];
  let previous: string | null = null;
  let run = 0;
  const flush = (): void => { if (previous !== null) collapsed.push(run > 1 ? `${previous}x${run}` : previous); };
  for (const name of sequence) {
    if (name === 'data' || name === 'progress') {
      if (name === previous) { run += 1; continue; }
      flush();
      previous = name;
      run = 1;
      continue;
    }
    flush();
    previous = null;
    run = 0;
    collapsed.push(name);
  }
  flush();
  return collapsed;
}

// Deterministic self-check of the cardinality property (executed by the
// `fixture pins are exact` test): duplicates of non-body events survive.
function assertNormalizerKeepsCardinality(): void {
  const raw = ['end', 'end', 'data', 'data', 'data', 'progress', 'finish', 'close', 'close'];
  const expected = ['end', 'end', 'body', 'finish', 'close', 'close'];
  const collapsed = collapseEvents(raw);
  if (JSON.stringify(collapsed) !== JSON.stringify(['end', 'end', 'datax3', 'progress', 'finish', 'close', 'close'])) throw new InfrastructureError(`collapseEvents drift: ${JSON.stringify(collapsed)}`);
  if (JSON.stringify(normalizeSequence(collapsed)) !== JSON.stringify(expected)) throw new InfrastructureError(`normalizeSequence drift: ${JSON.stringify(normalizeSequence(collapsed))}`);
}

function armRed(id: RowId): void {
  if (!EXPECTED_RED.includes(id)) {
    throw new InfrastructureError(`${id} attempted to arm outside its target map`);
  }
  if (armedRed.has(id)) {
    throw new InfrastructureError(`${id} attempted to arm more than once`);
  }
  armedRed.add(id);
}

async function observeRow(id: RowId, operation: () => Promise<void>): Promise<void> {
  observedInvocations.set(id, (observedInvocations.get(id) ?? 0) + 1);
  currentRow = id;
  legSequence = 0;
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

// Vitest fork/VM services serve neither loader strategy inside getFS(), so
// download-mode cases install the pair-approved literal-node:fs require
// bridge exactly as frozen for HTO-17D (runtime-conditional; Bun's native
// async import needs no bridge). Same descriptor trio, same fail-closed
// install/restore proofs; the R07 manifest carries this file's allowance.
interface NodeRequireBridge { restore(): void; }

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.get === right.get && left.set === right.set &&
    left.value === right.value && left.writable === right.writable;
}

function installNodeRequireBridge(): NodeRequireBridge {
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
  if (priorDescriptor !== undefined) {
    throw new InfrastructureError('require bridge found an unexpected own descriptor');
  }
  const nodeRequire = (specifier: string): unknown => {
    if (specifier !== 'node:fs') {
      throw new InfrastructureError(`require bridge rejected ${specifier}`);
    }
    return nodeFs;
  };
  let installed = false;
  const restore = (): void => {
    if (installed) {
      if (!Reflect.deleteProperty(globalThis, 'require')) {
        throw new InfrastructureError('failed to delete the require bridge');
      }
      installed = false;
    }
    const restoredDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
    if (!samePropertyDescriptor(restoredDescriptor, priorDescriptor)) {
      throw new InfrastructureError('require descriptor was not restored exactly');
    }
  };
  try {
    Object.defineProperty(globalThis, 'require', {
      configurable: true, enumerable: false, value: nodeRequire, writable: false,
    });
    installed = true;
    if (nodeRequire('node:fs') !== nodeFs) {
      throw new InfrastructureError('require bridge did not return node:fs exactly');
    }
  } catch (error) {
    try { restore(); } catch (restoreError) {
      throw new InfrastructureError('require bridge install and restore failed', { cause: restoreError });
    }
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('require bridge installation failed', { cause: error });
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

async function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(label)), milliseconds);
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

// ---------------------------------------------------------------------------
// Fixtures — deterministic, sha-asserted at build time (drift invalidates).
// ---------------------------------------------------------------------------

const PAYLOAD = (() => {
  const buffer = Buffer.allocUnsafe(262_144);
  let state = 0x12345678;
  for (let index = 0; index < buffer.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    buffer[index] = state >>> 24;
  }
  return buffer;
})();
const SMALL = Buffer.from('R07 compression fixture payload!');
const Z_FULL = zstdCompressSync(PAYLOAD);
const Z_PREF = Z_FULL.subarray(0, 131_084);
const G_FULL = gzipSync(SMALL);
const D_FULL = deflateSync(SMALL);
const B_FULL = brotliCompressSync(SMALL);
const RAW_D = deflateRawSync(SMALL);
const Z_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const DAMAGED_GZ = Buffer.concat([Buffer.from([0x1e, 0x8b]), G_FULL.subarray(2)]);
const PLAIN = Buffer.from('just plain text body');

// Full sha256 pins where the program record carries them; dual-runtime
// probe-verified 16-hex prefixes for the remaining deterministic fixtures.
const FIXTURE_PINS: Array<[string, Buffer, number, string]> = [
  ['F-PAY', PAYLOAD, 262_144, 'd7cb0977f0db94fae6a83d9675043121ef7786f4ccfc8af5876af13712e3388e'],
  ['F-ZFULL', Z_FULL, 262_159, 'b89d52126599ef3ddc74d18792958079e0c230ac85f7addd3426195c1736d1f6'],
  ['F-ZPREF', Z_PREF, 131_084, '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d'],
  ['F-GFULL', G_FULL, 52, '2ed46717842ab6e8af3f7d1da6f7f94066998874f3ae12a11b5373a934c4b1dc'],
  ['F-DFULL', D_FULL, 40, '2e2bada67a1d489fe7136a65d4353ee98f0bfe1e4f505f9697fa570d00922970'],
  ['F-BFULL', B_FULL, 36, 'abac13d1af7161f10e51e6c87bc694993f84b0d0a0f61390fc7e1be1d721a8d3'],
  ['F-RAWD', RAW_D, 34, 'aad0719c72fd92615d1119ce533a16964614a38f6855e91e9dd3cf67b457b931'],
];

function assertFixturePins(): void {
  for (const [label, bytes, length, expected] of FIXTURE_PINS) {
    if (bytes.length !== length) {
      throw new InfrastructureError(`${label} length drift: ${bytes.length}`);
    }
    const actual = sha256(bytes);
    if (expected.length !== 64) {
      throw new InfrastructureError(`${label} pin is not a full sha256`);
    }
    if (actual !== expected) {
      throw new InfrastructureError(`${label} sha drift: ${actual}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Case engine — one wire case across protocol × mode, full snapshot.
// ---------------------------------------------------------------------------

type Protocol = 'h1' | 'h2';
type Mode = 'buffered' | 'stream' | 'download' | 'upload';

interface WireCase {
  readonly body: Buffer;
  readonly contentLength?: number;
  readonly encoding?: string;
  readonly method?: 'GET' | 'HEAD';
  readonly mode: Mode;
  readonly options?: Record<string, unknown>;
  readonly protocol: Protocol;
  readonly status?: number;
  readonly informational?: 103;
  readonly legLabel?: string;
}

interface CaseSnapshot {
  readonly bodySha256: string | null;
  readonly bodyLength: number | null;
  readonly code: unknown;
  readonly errno: unknown;
  readonly isNetworkError: unknown;
  readonly isRetryable: unknown;
  readonly isTimeout: unknown;
  readonly errorEvents: number;
  readonly fileState: { exists: boolean; sha256Digest: string; length: number } | null;
  readonly hooks: { afterHeaders: number; afterParse: number; beforeError: number; afterResponse: number; onAbort: number; onTimeout: number };
  readonly streamSha256: string | null;
  readonly message: unknown;
  readonly adapter: 'http' | 'http2' | 'unknown';
  readonly clientNaturalAtCaseEnd: ClientPoolSnapshot;
  readonly errorIdentity: { readonly causeCode: string; readonly causeName: string; readonly hasCause: boolean; readonly hasResponse: boolean; readonly isRezoError: boolean; readonly name: string } | null;
  readonly eventSequence: string[];
  readonly isFinished: boolean | null;
  readonly mode: Mode;
  readonly progressEvents: number;
  readonly responseBodyLength: number | null;
  readonly responseBodySha256: string | null;
  readonly responseStatus: unknown;
  readonly streamLength: number | null;
  readonly wireHits: number;
  readonly wireInformationalSent: number;
  readonly naturalAtCaseEnd: { readonly sessions: number; readonly sockets: number; readonly temporaryDirectories: number; readonly timers: number };
  readonly stable: boolean;
  readonly status: unknown;
  readonly successEvents: number;
  readonly terminal: 'fulfilled' | 'rejected' | 'pending';
  readonly uncaught: number;
  readonly unhandled: number;
}

async function runWireCase(wire: WireCase): Promise<CaseSnapshot> {
  const uncaught: string[] = [];
  const unhandled: string[] = [];
  const onUncaught = (error: Error): void => { uncaught.push(error.message); };
  const onUnhandled = (reason: unknown): void => { unhandled.push(String(reason)); };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);

  let afterHeaders = 0; let afterParse = 0; let beforeError = 0; let afterResponse = 0;
  let onAbort = 0; let onTimeout = 0;
  const events: string[] = [];
  const hooks: Partial<RezoHooks> = {
    onAbort: [() => { onAbort += 1; events.push('hook:onAbort'); }],
    onTimeout: [() => { onTimeout += 1; events.push('hook:onTimeout'); }],
    afterHeaders: [() => { afterHeaders += 1; events.push('hook:afterHeaders'); }],
    afterParse: [(event) => { afterParse += 1; events.push('hook:afterParse'); return event.data; }],
    afterResponse: [(response) => { afterResponse += 1; events.push('hook:afterResponse'); return response; }],
    beforeError: [(error) => { beforeError += 1; events.push('hook:beforeError'); return error; }],
  };

  const status = wire.status ?? 200;
  const contentLength = wire.contentLength ?? wire.body.length;
  const headers: Record<string, string> = {
    'content-length': String(contentLength),
    'content-type': 'application/octet-stream',
  };
  if (wire.encoding !== undefined) headers['content-encoding'] = wire.encoding;
  // Server-side proof that the informational response actually went on the
  // wire: the public client surface intentionally hides 1xx responses.
  let informationalSent = 0;
  // Server-side hit counter: "one wire" means exactly one request/stream
  // reached the fixture (retry:false), not merely one client snapshot.
  let wireHits = 0;
  let hitsAtSnapshot = -1;

  const recordFixtureEvent = (kind: string, error: unknown): void => { fixtureEvents.push(`${wire.protocol}/${wire.mode}/${wire.legLabel ?? 'leg'}:${kind}:${String(errorField(error, 'code') ?? errorField(error, 'message'))}`); };
  let server: http.Server | http2.Http2Server;
  if (wire.protocol === 'h1') {
    server = http.createServer((request, response) => {
      wireHits += 1;
      request.resume();
      request.once('end', () => {
        if (wire.informational === 103) { response.writeEarlyHints({ link: '</ci-hint>; rel=preload' }); informationalSent += 1; }
        response.writeHead(status, headers);
        response.end(wire.body);
      });
    });
  } else {
    const h2server = http2.createServer();
    h2server.on('session', (session) => {
      activeSessions.add(session);
      session.on('error', (error) => recordFixtureEvent('session', error));
      session.once('close', () => activeSessions.delete(session));
    });
    h2server.on('stream', (stream: http2.ServerHttp2Stream, requestHeaders: http2.IncomingHttpHeaders) => {
      wireHits += 1;
      stream.on('error', (error) => recordFixtureEvent('stream', error));
      const respond = (): void => {
        if (wire.informational === 103) { stream.additionalHeaders({ ':status': 103 }); informationalSent += 1; }
        // HEAD/204/304 responses have no body: node:http2 ends the stream
        // inside respond(), so end() afterwards is a write-after-end error
        // (hidden until fixture errors stopped being swallowed in pass 5).
        const bodyless = wire.method === 'HEAD' || status === 204 || status === 304;
        if (bodyless) { stream.respond({ ':status': status, ...headers }, { endStream: true }); return; }
        stream.respond({ ':status': status, ...headers });
        stream.end(wire.body);
      };
      if (requestHeaders[':method'] === 'GET' || requestHeaders[':method'] === 'HEAD') {
        respond();
      } else {
        stream.resume();
        stream.once('end', respond);
      }
    });
    server = h2server;
  }
  // Earned zeros: the server enters the resource ledger only once it is
  // actually listening; a listen failure closes it before rethrowing so no
  // phantom server/observer survives into teardown.
  // One permanent server error listener: routes to the listen rejection while
  // binding, then to the fixture-event recorder for the rest of the wire.
  let listenReject: ((error: Error) => void) | null = null;
  server.on('error', (error: Error) => { if (listenReject !== null) listenReject(error); else recordFixtureEvent('server', error); });
  try {
    await within(new Promise<void>((resolve, reject) => {
      listenReject = reject;
      server.listen(0, '127.0.0.1', () => { listenReject = null; resolve(); });
    }), 2_000, 'compression fixture failed to listen');
  } catch (error) {
    listenReject = null;
    setupErrors.push(`listen:${wire.protocol}/${wire.mode}:${String(error)}`);
    server.close();
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
    throw error instanceof InfrastructureError ? error : new InfrastructureError(`listen failed: ${String(error)}`);
  }
  activeServers.add(server);
  server.once('close', () => activeServers.delete(server));
  server.on('connection', (socket: net.Socket) => {
    activeSockets.add(socket);
    socket.on('error', (error) => recordFixtureEvent('socket', error));
    socket.once('close', () => activeSockets.delete(socket));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new InfrastructureError('compression fixture had no port');
  }
  const url = `http://127.0.0.1:${address.port}/ci-${wire.protocol}-${wire.mode}`;

  const entry = wire.protocol === 'h1' ? H1_ENTRY.default : H2_ENTRY.default;
  const client = entry.create({});
  if (wire.protocol === 'h1') h1PoolTouched = true; else h2PoolTouched = true;
  const baseOptions = { cache: false, hooks, retry: false, ...(wire.options ?? {}) };

  let terminal: 'fulfilled' | 'rejected' | 'pending' = 'pending';
  let outcomeValue: unknown = null;
  let outcomeError: unknown = null;
  let temporaryDirectory: string | undefined;
  let temporaryFile: string | undefined;
  let requireBridge: NodeRequireBridge | undefined;
  let facadeRef: { isFinished?: () => boolean } | null = null;
  const streamChunks: Buffer[] = [];

  try {
    if (wire.mode === 'buffered') {
      try {
        outcomeValue = wire.method === 'HEAD'
          ? await within(client.head(url, baseOptions), 8_000, 'buffered case hung')
          : await within(client.get(url, { ...baseOptions, responseType: 'buffer' }), 8_000, 'buffered case hung');
        terminal = 'fulfilled';
        events.push('settled:fulfilled');
      } catch (error) {
        if (error instanceof InfrastructureError) throw error;
        outcomeError = error;
        terminal = 'rejected';
        events.push('settled:rejected');
      }
    } else {
      let facade: { on(event: string, listener: (...args: unknown[]) => void): unknown };
      if (wire.mode === 'stream') {
        facade = client.stream(url, baseOptions) as typeof facade;
      } else if (wire.mode === 'download') {
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'rezo-ci-'));
        activeTemporaryDirectories.add(temporaryDirectory);
        temporaryFile = join(temporaryDirectory, 'target.bin');
        if (await getFS() === undefined) {
          requireBridge = installNodeRequireBridge();
          if (await getFS() === undefined) {
            throw new InfrastructureError('require bridge did not restore fs loading');
          }
        }
        facade = client.download(url, temporaryFile, baseOptions) as typeof facade;
      } else {
        facade = client.upload(url, 'CI-UPLOAD', baseOptions) as typeof facade;
      }
      facadeRef = facade as unknown as { isFinished?: () => boolean };
      const settled = new Promise<void>((resolve) => {
        let done = false;
        const finish = (kind: 'fulfilled' | 'rejected') => (payload: unknown): void => {
          if (kind === 'rejected') { outcomeError = payload; events.push('error'); }
          if (!done) { done = true; terminal = kind; resolve(); }
        };
        for (const name of ['initiated', 'start', 'headers', 'status', 'cookies', 'redirect', 'progress', 'end', 'close'] as const) {
          facade.on(name, () => { events.push(name); });
        }
        facade.on('error', finish('rejected'));
        facade.on('done', (value: unknown) => { events.push('done'); outcomeValue = value; finish('fulfilled')(value); });
        facade.on('finish', () => events.push('finish'));
        facade.on('complete', () => events.push('complete'));
        facade.on('data', (chunk: unknown) => { events.push('data'); if (Buffer.isBuffer(chunk)) streamChunks.push(Buffer.from(chunk)); else if (chunk instanceof Uint8Array) streamChunks.push(Buffer.from(chunk)); });
      });
      await within(settled, 10_000, `${wire.protocol}/${wire.mode} facade did not settle`);
    }

    await delay(150);
    const stabilityBefore = JSON.stringify({ afterHeaders, afterParse, afterResponse, beforeError, onAbort, onTimeout, events, terminal, uncaught, unhandled });
    await delay(100);
    const stabilityAfter = JSON.stringify({ afterHeaders, afterParse, afterResponse, beforeError, onAbort, onTimeout, events, terminal, uncaught, unhandled });
    if (stabilityAfter !== stabilityBefore) {
      lateEvents.push(`${wire.protocol}/${wire.mode}:${stabilityBefore}->${stabilityAfter}`);
    }

    let bodyBuffer: Buffer | null = null;
    if (terminal === 'fulfilled' && outcomeValue !== null && wire.mode !== 'download') {
      const data = errorField(outcomeValue, 'data');
      if (typeof data === 'string') bodyBuffer = Buffer.from(data);
      else if (data instanceof ArrayBuffer) bodyBuffer = Buffer.from(data);
      else if (Buffer.isBuffer(data)) bodyBuffer = data;
      else if (data instanceof Uint8Array) bodyBuffer = Buffer.from(data);
    }
    let fileState: CaseSnapshot['fileState'] = null;
    if (temporaryFile !== undefined) {
      try {
        const fileBytes = await readFile(temporaryFile);
        fileState = { exists: true, sha256Digest: sha256(fileBytes), length: fileBytes.length };
      } catch (error) {
        // Only ENOENT proves absence; any other read failure is infrastructure.
        if (errorField(error, 'code') !== 'ENOENT') throw new InfrastructureError(`target read failed: ${String(error)}`);
        fileState = { exists: false, sha256Digest: '', length: 0 };
      }
    }

    const responseValue = terminal === 'rejected' ? errorField(outcomeError, 'response') : undefined;
    // `status` is the error's OWN status; `responseStatus` is captured
    // independently from error.response — never coalesced.
    const statusValue = terminal === 'fulfilled'
      ? errorField(outcomeValue, 'status')
      : errorField(outcomeError, 'status');
    // Two-phase cleanup accounting: whatever is still open NOW — before the
    // forced teardown in the finally block — is the natural state this leg
    // reports. Suite timers must be naturally zero; server sockets/sessions
    // are recorded, not asserted (keep-alive ownership belongs to the client).
    const naturalAtCaseEnd = {
      sessions: activeSessions.size,
      sockets: activeSockets.size,
      temporaryDirectories: activeTemporaryDirectories.size,
      timers: activeTimers.size,
    };
    const causeValue = terminal === 'rejected' ? errorField(outcomeError, 'cause') : undefined;
    const responseData = terminal === 'rejected' ? errorField(responseValue, 'data') : undefined;
    const responseBody = Buffer.isBuffer(responseData) ? responseData
      : responseData instanceof Uint8Array ? Buffer.from(responseData)
      : typeof responseData === 'string' ? Buffer.from(responseData)
      : null;
    const errorIdentity = terminal === 'rejected'
      ? {
          causeCode: String(errorField(causeValue, 'code') ?? ''),
          causeName: String(errorField(causeValue, 'name') ?? ''),
          hasCause: causeValue !== undefined,
          hasResponse: responseValue !== undefined && responseValue !== null,
          isRezoError: outcomeError instanceof RezoError,
          name: String(errorField(outcomeError, 'name') ?? ''),
        }
      : null;
    legSequence += 1;
    const legId = `${currentRow ?? 'UNROWED'}:${wire.legLabel ?? `${wire.protocol}/${wire.mode}/${wire.encoding ?? 'identity'}/${wire.method ?? 'GET'}/${wire.informational ?? 'direct'}/${legSequence}`}`;
    if (Object.hasOwn(legs, legId)) throw new InfrastructureError(`duplicate leg id ${legId}`);
    const snapshotOut: CaseSnapshot = {
      bodySha256: bodyBuffer === null ? null : sha256(bodyBuffer),
      bodyLength: bodyBuffer === null ? null : bodyBuffer.length,
      code: terminal === 'rejected' ? errorField(outcomeError, 'code') : null,
      errno: terminal === 'rejected' ? errorField(outcomeError, 'errno') : null,
      isNetworkError: terminal === 'rejected' ? errorField(outcomeError, 'isNetworkError') : null,
      isRetryable: terminal === 'rejected' ? errorField(outcomeError, 'isRetryable') : null,
      isTimeout: terminal === 'rejected' ? errorField(outcomeError, 'isTimeout') : null,
      errorEvents: events.filter((event) => event === 'error').length,
      fileState,
      hooks: { afterHeaders, afterParse, beforeError, afterResponse, onAbort, onTimeout },
      adapter: adapterIdentityOf(client),
      clientNaturalAtCaseEnd: snapshotClientPools(),
      errorIdentity,
      eventSequence: collapseEvents(events),
      isFinished: facadeRef !== null && typeof facadeRef.isFinished === 'function' ? facadeRef.isFinished() : null,
      mode: wire.mode,
      progressEvents: events.filter((event) => event === 'progress').length,
      responseBodyLength: responseBody === null ? null : responseBody.length,
      responseBodySha256: responseBody === null ? null : sha256(responseBody),
      responseStatus: terminal === 'rejected' ? (errorField(responseValue, 'status') ?? null) : null,
      streamLength: wire.mode === 'stream' && streamChunks.length > 0 ? Buffer.concat(streamChunks).length : null,
      wireHits,
      naturalAtCaseEnd,
      wireInformationalSent: informationalSent,
      streamSha256: wire.mode === 'stream' && streamChunks.length > 0 ? sha256(Buffer.concat(streamChunks)) : null,
      message: terminal === 'rejected' ? errorField(outcomeError, 'message') : null,
      stable: stabilityAfter === stabilityBefore,
      status: statusValue ?? null,
      successEvents: events.filter((event) => event === 'finish' || event === 'done' || event === 'complete').length,
      terminal,
      uncaught: uncaught.length,
      unhandled: unhandled.length,
    };
    hitsAtSnapshot = wireHits;
    legs[legId] = { ...snapshotOut, encoding: wire.encoding ?? null, informational: wire.informational ?? null, method: wire.method ?? 'GET', protocol: wire.protocol, wireLength: wire.body.length, wireSha256: sha256(wire.body), wireStatus: wire.status ?? 200 };
    return snapshotOut;
  } finally {
    try {
      try { requireBridge?.restore(); } catch (error) { teardownErrors.push(`bridge:${String(error)}`); }
      // Destroy, then AWAIT each close event (bounded) before the handle
      // leaves its set, so end-state zeros reflect closed handles.
      // A handle still in its active set has not emitted 'close' (the close
      // handlers remove it), so the actual bounded close is awaited even when
      // destroyed === true: destroyed is a flag, not the close event.
      const awaitClose = (emitter: { once(event: 'close', listener: () => void): unknown }, label: string): Promise<void> =>
        within(new Promise<void>((resolve) => { emitter.once('close', () => resolve()); }), 2_000, `${label} did not close`).catch((error) => { cleanupErrors.push(String(error)); });
      // An H2 socket closes as a consequence of its session teardown (the
      // 'close' handler removes it from the set while the await runs), so the
      // shrink during the session loop is counted separately and the wire
      // equality is socketsDestroyed + socketsClosedWithSessions === legs.
      const socketsBeforeSessions = activeSockets.size;
      for (const session of [...activeSessions]) {
        // Closed meanwhile: the 'close' handler already removed it from the set.
        if (!activeSessions.has(session)) continue;
        forcedCleanup.sessionsDestroyed += 1;
        const closed = awaitClose(session, 'session');
        session.destroy();
        await closed;
        activeSessions.delete(session);
      }
      forcedCleanup.socketsClosedWithSessions += socketsBeforeSessions - activeSockets.size;
      for (const socket of [...activeSockets]) {
        if (!activeSockets.has(socket)) continue;
        forcedCleanup.socketsDestroyed += 1;
        const closed = awaitClose(socket, 'socket');
        socket.destroy();
        await closed;
        activeSockets.delete(socket);
      }
      await within(new Promise<void>((resolve) => {
        forcedCleanup.serversClosed += 1;
        server.close(() => resolve());
      }), 3_000, 'compression fixture server did not close').catch((error) => {
        cleanupErrors.push(String(error));
      });
      // Live hit counter re-read after the wire's bounded close: a late hit
      // (a retried or duplicated attempt landing after the snapshot) is an
      // oracle failure, never a hidden second request.
      if (hitsAtSnapshot !== -1 && wireHits !== hitsAtSnapshot) oracleInvalidations.push(`late-hit:${wire.protocol}/${wire.mode}/${wire.legLabel ?? 'leg'}:${wireHits}!==${hitsAtSnapshot}`);
      if (temporaryDirectory !== undefined) {
        forcedCleanup.temporaryDirectoriesRemoved += 1;
        try { await rm(temporaryDirectory, { force: true, recursive: true }); } catch (error) { teardownErrors.push(`tmpdir:${String(error)}`); }
        activeTemporaryDirectories.delete(temporaryDirectory);
      }
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUnhandled);
    }
  }
}

// Desired (post-fix) rejection shape shared by every rejecting row,
// asserting the full frozen contract-8 field set.
function expectStructuredRejection(snapshot: CaseSnapshot): void {
  expect(snapshot.terminal).toBe('rejected');
  expect(snapshot.code).toBe('REZ_DECOMPRESSION_ERROR');
  expect(snapshot.errno).toBe(-1029);
  expect(snapshot.message).toBe('Decompression failed');
  expect(snapshot.isNetworkError).toBe(false);
  expect(snapshot.isTimeout).toBe(false);
  expect(snapshot.isRetryable).toBe(false);
  expect(snapshot.errorIdentity?.isRezoError).toBe(true);
  expect(snapshot.errorIdentity?.name).toBe('RezoError');
  // Observed on Node and Bun across all 8 protocol/mode cells: every
  // structured decompression rejection carries its response.
  expect(snapshot.errorIdentity?.hasResponse).toBe(true);
  expect(snapshot.status).toBe(200);
  expect(snapshot.responseStatus).toBe(200);
  expect(snapshot.wireHits).toBe(1);
  // Exactly one error terminal on facade modes; the promise surface has none.
  expect(snapshot.errorEvents).toBe(snapshot.mode === 'buffered' ? 0 : 1);
  expect(snapshot.isFinished).toBe(snapshot.mode === 'buffered' ? null : false);
  expect(snapshot.successEvents).toBe(0);
  expect(snapshot.uncaught).toBe(0);
  expect(snapshot.unhandled).toBe(0);
  expect(snapshot.stable).toBe(true);
}

// Accepted-RED helper: current silent fulfillment with specific body echo.
function fulfilledWith(snapshot: CaseSnapshot, sha256Digest: string | null, length: number | null): boolean {
  return snapshot.terminal === 'fulfilled' &&
    snapshot.status === 200 &&
    snapshot.uncaught === 0 && snapshot.unhandled === 0 && snapshot.stable &&
    (sha256Digest === null || snapshot.bodySha256 === sha256Digest) &&
    (length === null || snapshot.bodyLength === length);
}

const ZPREF_HEX = '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d';
const ZDEC_HEX = '7a633a252b69870eac53f22b114461d01fece3d079de5b0ff878d0c6aeffff37';
const PAY_HEX = 'd7cb0977f0db94fae6a83d9675043121ef7786f4ccfc8af5876af13712e3388e';

afterEach(() => {
  forcedCleanup.timersCleared += activeTimers.size;
  for (const timer of activeTimers) clearTimeout(timer);
  activeTimers.clear();
});

// Frozen per-leg contract tables, harvested from Node v25.9.0 and Bun 1.3.14
// runs and identical on both: the normalized event sequence of every leg, the
// exact hook tuple per protocol/mode/terminal/code, the natural resource
// state per protocol/mode, and the cause facts per rejection class. Any
// drift is an oracle mismatch and fails the file closed. The H1/H2 hook
// asymmetry visible here (afterHeaders never fires on H2; afterParse fires
// on H2 only on failure paths) is a recorded parity finding, pinned as
// observed until its own repair packet changes it RED-before-GREEN.
const EXPECTED_LEG_SEQUENCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'CI-B1:h1/buffered/br/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-B1:h2/buffered/br/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/br': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/brotli': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/gzip-raw': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/x-deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/x-gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h1/zstd': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/br': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/brotli': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/gzip-raw': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/x-deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/x-gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C0:h2/zstd': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h1/buffered/br': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h1/buffered/deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h1/buffered/gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h1/buffered/zstd': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h1/download/br': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/download/deflate': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/download/gzip': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/download/zstd': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/stream/br': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C1:h1/stream/deflate': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C1:h1/stream/gzip': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C1:h1/stream/zstd': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C1:h1/upload/br': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/upload/deflate': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/upload/gzip': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h1/upload/zstd': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/buffered/br': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h2/buffered/deflate': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h2/buffered/gzip': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h2/buffered/zstd': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C1:h2/download/br': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/download/deflate': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/download/gzip': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/download/zstd': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/stream/br': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  'CI-C1:h2/stream/deflate': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  // john 2026-08-29 (HD-5): the HTTP/2 stream facade ends with one trailing `close` after `complete`, as HTTP/1.1 and Fetch do.
  'CI-C1:h2/stream/gzip': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  'CI-C1:h2/stream/zstd': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  'CI-C1:h2/upload/br': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/upload/deflate': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/upload/gzip': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C1:h2/upload/zstd': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C2:h1/103-204': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C2:h1/204': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C2:h1/304': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-C2:h1/HEAD': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C2:h2/103-204': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C2:h2/204': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C2:h2/304': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-C2:h2/HEAD': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C3:h1/buffered': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C3:h1/download': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C3:h1/stream': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C3:h1/upload': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C3:h2/buffered': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C3:h2/download': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C3:h2/stream': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  'CI-C3:h2/upload': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C4:h1/buffered': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C4:h1/download': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C4:h1/stream': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "end", "finish", "done", "complete", "close"],
  'CI-C4:h1/upload': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "finish", "done", "complete"],
  'CI-C4:h2/buffered': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-C4:h2/download': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-C4:h2/stream': ["initiated","start","headers","status","cookies","hook:afterHeaders","body","hook:afterParse","end","finish","done","complete","close"],
  'CI-C4:h2/upload': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "finish", "done", "complete"],
  'CI-G1A:h1/buffered/gzip-raw/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-G1A:h2/buffered/gzip-raw/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:afterResponse", "settled:fulfilled"],
  'CI-G1B:h1/buffered/gzip-raw/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-G1B:h2/buffered/gzip-raw/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-G1C:h1/buffered/gzip-raw/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-G1C:h2/buffered/gzip-raw/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/br/GET/direct/6': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/deflate/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/gzip/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/zstd/GET/direct/3': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/zstd/GET/direct/4': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h1/buffered/zstd/GET/direct/5': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M1:h2/buffered/zstd/GET/direct/7': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/br/GET/direct/5': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/br/GET/direct/6': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/deflate/GET/direct/3': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/deflate/GET/direct/4': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/gzip/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M2:h1/buffered/gzip/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M3:h1/buffered/zstd/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-M3:h2/buffered/zstd/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-S1:h1/buffered/gzip/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-S2:h1/buffered/gzip/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-S3:h1/buffered/zstd/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-S3:h2/buffered/zstd/GET/direct/2': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-Z1:h1/buffered/zstd/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-Z2:h1/stream/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "close", "hook:beforeError", "error"],
  'CI-Z3:h1/download/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "hook:beforeError", "error"],
  'CI-Z4:h1/upload/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "hook:afterParse", "hook:beforeError", "error"],
  'CI-Z5:h2/buffered/zstd/GET/direct/1': ["hook:afterHeaders", "hook:afterParse", "hook:beforeError", "settled:rejected"],
  'CI-Z6:h2/stream/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "hook:beforeError", "error"],
  'CI-Z7:h2/download/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "hook:beforeError", "error"],
  'CI-Z8:h2/upload/zstd/GET/direct/1': ["initiated", "start", "headers", "status", "cookies", "hook:afterHeaders", "body", "hook:afterParse", "hook:beforeError", "error"],
});
const EXPECTED_HOOKS: Readonly<Record<string, CaseSnapshot['hooks']>> = Object.freeze({
  'h1/buffered/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 1, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h1/buffered/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h1/buffered/rejected/REZ_HTTP_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h1/download/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h1/download/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h1/stream/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h1/stream/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h1/upload/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h1/upload/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h2/buffered/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 1, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h2/buffered/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h2/buffered/rejected/REZ_HTTP_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h2/download/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h2/download/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h2/stream/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h2/stream/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
  'h2/upload/fulfilled/none': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 0, "onAbort": 0, "onTimeout": 0},
  'h2/upload/rejected/REZ_DECOMPRESSION_ERROR': {"afterHeaders": 1, "afterParse": 1, "afterResponse": 0, "beforeError": 1, "onAbort": 0, "onTimeout": 0},
});
// Per-leg progress presence (true iff body bytes reached a facade), frozen.
const EXPECTED_PROGRESS: Readonly<Record<string, boolean>> = Object.freeze({
  'CI-B1:h1/buffered/br/GET/direct/1': false,
  'CI-B1:h2/buffered/br/GET/direct/2': false,
  'CI-C0:h1/br': false,
  'CI-C0:h1/brotli': false,
  'CI-C0:h1/deflate': false,
  'CI-C0:h1/gzip': false,
  'CI-C0:h1/gzip-raw': false,
  'CI-C0:h1/x-deflate': false,
  'CI-C0:h1/x-gzip': false,
  'CI-C0:h1/zstd': false,
  'CI-C0:h2/br': false,
  'CI-C0:h2/brotli': false,
  'CI-C0:h2/deflate': false,
  'CI-C0:h2/gzip': false,
  'CI-C0:h2/gzip-raw': false,
  'CI-C0:h2/x-deflate': false,
  'CI-C0:h2/x-gzip': false,
  'CI-C0:h2/zstd': false,
  'CI-C1:h1/buffered/br': false,
  'CI-C1:h1/buffered/deflate': false,
  'CI-C1:h1/buffered/gzip': false,
  'CI-C1:h1/buffered/zstd': false,
  'CI-C1:h1/download/br': true,
  'CI-C1:h1/download/deflate': true,
  'CI-C1:h1/download/gzip': true,
  'CI-C1:h1/download/zstd': true,
  'CI-C1:h1/stream/br': true,
  'CI-C1:h1/stream/deflate': true,
  'CI-C1:h1/stream/gzip': true,
  'CI-C1:h1/stream/zstd': true,
  'CI-C1:h1/upload/br': false,
  'CI-C1:h1/upload/deflate': false,
  'CI-C1:h1/upload/gzip': false,
  'CI-C1:h1/upload/zstd': false,
  'CI-C1:h2/buffered/br': false,
  'CI-C1:h2/buffered/deflate': false,
  'CI-C1:h2/buffered/gzip': false,
  'CI-C1:h2/buffered/zstd': false,
  'CI-C1:h2/download/br': true,
  'CI-C1:h2/download/deflate': true,
  'CI-C1:h2/download/gzip': true,
  'CI-C1:h2/download/zstd': true,
  'CI-C1:h2/stream/br': true,
  'CI-C1:h2/stream/deflate': true,
  'CI-C1:h2/stream/gzip': true,
  'CI-C1:h2/stream/zstd': true,
  'CI-C1:h2/upload/br': true,
  'CI-C1:h2/upload/deflate': true,
  'CI-C1:h2/upload/gzip': true,
  'CI-C1:h2/upload/zstd': true,
  'CI-C2:h1/103-204': false,
  'CI-C2:h1/204': false,
  'CI-C2:h1/304': false,
  'CI-C2:h1/HEAD': false,
  'CI-C2:h2/103-204': false,
  'CI-C2:h2/204': false,
  'CI-C2:h2/304': false,
  'CI-C2:h2/HEAD': false,
  'CI-C3:h1/buffered': false,
  'CI-C3:h1/download': true,
  'CI-C3:h1/stream': true,
  'CI-C3:h1/upload': false,
  'CI-C3:h2/buffered': false,
  'CI-C3:h2/download': true,
  'CI-C3:h2/stream': true,
  'CI-C3:h2/upload': true,
  'CI-C4:h1/buffered': false,
  'CI-C4:h1/download': true,
  'CI-C4:h1/stream': true,
  'CI-C4:h1/upload': false,
  'CI-C4:h2/buffered': false,
  'CI-C4:h2/download': true,
  'CI-C4:h2/stream': true,
  'CI-C4:h2/upload': true,
  'CI-G1A:h1/buffered/gzip-raw/GET/direct/1': false,
  'CI-G1A:h2/buffered/gzip-raw/GET/direct/2': false,
  'CI-G1B:h1/buffered/gzip-raw/GET/direct/1': false,
  'CI-G1B:h2/buffered/gzip-raw/GET/direct/2': false,
  'CI-G1C:h1/buffered/gzip-raw/GET/direct/1': false,
  'CI-G1C:h2/buffered/gzip-raw/GET/direct/2': false,
  'CI-M1:h1/buffered/br/GET/direct/6': false,
  'CI-M1:h1/buffered/deflate/GET/direct/2': false,
  'CI-M1:h1/buffered/gzip/GET/direct/1': false,
  'CI-M1:h1/buffered/zstd/GET/direct/3': false,
  'CI-M1:h1/buffered/zstd/GET/direct/4': false,
  'CI-M1:h1/buffered/zstd/GET/direct/5': false,
  'CI-M1:h2/buffered/zstd/GET/direct/7': false,
  'CI-M2:h1/buffered/br/GET/direct/5': false,
  'CI-M2:h1/buffered/br/GET/direct/6': false,
  'CI-M2:h1/buffered/deflate/GET/direct/3': false,
  'CI-M2:h1/buffered/deflate/GET/direct/4': false,
  'CI-M2:h1/buffered/gzip/GET/direct/1': false,
  'CI-M2:h1/buffered/gzip/GET/direct/2': false,
  'CI-M3:h1/buffered/zstd/GET/direct/1': false,
  'CI-M3:h2/buffered/zstd/GET/direct/2': false,
  'CI-S1:h1/buffered/gzip/GET/direct/1': false,
  'CI-S2:h1/buffered/gzip/GET/direct/1': false,
  'CI-S3:h1/buffered/zstd/GET/direct/1': false,
  'CI-S3:h2/buffered/zstd/GET/direct/2': false,
  'CI-Z1:h1/buffered/zstd/GET/direct/1': false,
  'CI-Z2:h1/stream/zstd/GET/direct/1': true,
  'CI-Z3:h1/download/zstd/GET/direct/1': true,
  'CI-Z4:h1/upload/zstd/GET/direct/1': false,
  'CI-Z5:h2/buffered/zstd/GET/direct/1': false,
  'CI-Z6:h2/stream/zstd/GET/direct/1': true,
  'CI-Z7:h2/download/zstd/GET/direct/1': true,
  'CI-Z8:h2/upload/zstd/GET/direct/1': true,
});
// Per-leg error-response body length (null when fulfilled or no body): the
// H1-decoded vs H2-encoded error-body asymmetry, frozen exactly per leg.
const EXPECTED_RESPONSE_BODY: Readonly<Record<string, { length: number; sha256: string } | null>> = Object.freeze({
  'CI-B1:h1/buffered/br/GET/direct/1': null,
  'CI-B1:h2/buffered/br/GET/direct/2': null,
  'CI-C0:h1/br': null,
  'CI-C0:h1/brotli': null,
  'CI-C0:h1/deflate': null,
  'CI-C0:h1/gzip': null,
  'CI-C0:h1/gzip-raw': null,
  'CI-C0:h1/x-deflate': null,
  'CI-C0:h1/x-gzip': null,
  'CI-C0:h1/zstd': null,
  'CI-C0:h2/br': null,
  'CI-C0:h2/brotli': null,
  'CI-C0:h2/deflate': null,
  'CI-C0:h2/gzip': null,
  'CI-C0:h2/gzip-raw': null,
  'CI-C0:h2/x-deflate': null,
  'CI-C0:h2/x-gzip': null,
  'CI-C0:h2/zstd': null,
  'CI-C1:h1/buffered/br': null,
  'CI-C1:h1/buffered/deflate': null,
  'CI-C1:h1/buffered/gzip': null,
  'CI-C1:h1/buffered/zstd': null,
  'CI-C1:h1/download/br': null,
  'CI-C1:h1/download/deflate': null,
  'CI-C1:h1/download/gzip': null,
  'CI-C1:h1/download/zstd': null,
  'CI-C1:h1/stream/br': null,
  'CI-C1:h1/stream/deflate': null,
  'CI-C1:h1/stream/gzip': null,
  'CI-C1:h1/stream/zstd': null,
  'CI-C1:h1/upload/br': null,
  'CI-C1:h1/upload/deflate': null,
  'CI-C1:h1/upload/gzip': null,
  'CI-C1:h1/upload/zstd': null,
  'CI-C1:h2/buffered/br': null,
  'CI-C1:h2/buffered/deflate': null,
  'CI-C1:h2/buffered/gzip': null,
  'CI-C1:h2/buffered/zstd': null,
  'CI-C1:h2/download/br': null,
  'CI-C1:h2/download/deflate': null,
  'CI-C1:h2/download/gzip': null,
  'CI-C1:h2/download/zstd': null,
  'CI-C1:h2/stream/br': null,
  'CI-C1:h2/stream/deflate': null,
  'CI-C1:h2/stream/gzip': null,
  'CI-C1:h2/stream/zstd': null,
  'CI-C1:h2/upload/br': null,
  'CI-C1:h2/upload/deflate': null,
  'CI-C1:h2/upload/gzip': null,
  'CI-C1:h2/upload/zstd': null,
  'CI-C2:h1/103-204': null,
  'CI-C2:h1/204': null,
  'CI-C2:h1/304': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-C2:h1/HEAD': null,
  'CI-C2:h2/103-204': null,
  'CI-C2:h2/204': null,
  'CI-C2:h2/304': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-C2:h2/HEAD': null,
  'CI-C3:h1/buffered': null,
  'CI-C3:h1/download': null,
  'CI-C3:h1/stream': null,
  'CI-C3:h1/upload': null,
  'CI-C3:h2/buffered': null,
  'CI-C3:h2/download': null,
  'CI-C3:h2/stream': null,
  'CI-C3:h2/upload': null,
  'CI-C4:h1/buffered': null,
  'CI-C4:h1/download': null,
  'CI-C4:h1/stream': null,
  'CI-C4:h1/upload': null,
  'CI-C4:h2/buffered': null,
  'CI-C4:h2/download': null,
  'CI-C4:h2/stream': null,
  'CI-C4:h2/upload': null,
  'CI-G1A:h1/buffered/gzip-raw/GET/direct/1': null,
  'CI-G1A:h2/buffered/gzip-raw/GET/direct/2': null,
  'CI-G1B:h1/buffered/gzip-raw/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-G1B:h2/buffered/gzip-raw/GET/direct/2': { length: 40, sha256: '2e2bada67a1d489fe7136a65d4353ee98f0bfe1e4f505f9697fa570d00922970' },
  'CI-G1C:h1/buffered/gzip-raw/GET/direct/1': { length: 2, sha256: '4439e44862b85cc6d4c7f522808581e5b4489ec37c5b7b0ef2f7f0efa1333196' },
  'CI-G1C:h2/buffered/gzip-raw/GET/direct/2': { length: 17, sha256: '83ef1bcbd0f93e6d85fedec0604a1509e08da879314cef19f35da7ba91a2f1e6' },
  'CI-M1:h1/buffered/br/GET/direct/6': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h1/buffered/deflate/GET/direct/2': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h1/buffered/gzip/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h1/buffered/zstd/GET/direct/3': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h1/buffered/zstd/GET/direct/4': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h1/buffered/zstd/GET/direct/5': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M1:h2/buffered/zstd/GET/direct/7': { length: 3, sha256: 'd3f3e86cb33488c0f75956abfa0610d8f8318527a05b8300eef2156e5280c322' },
  'CI-M2:h1/buffered/br/GET/direct/5': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M2:h1/buffered/br/GET/direct/6': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M2:h1/buffered/deflate/GET/direct/3': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M2:h1/buffered/deflate/GET/direct/4': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M2:h1/buffered/gzip/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M2:h1/buffered/gzip/GET/direct/2': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M3:h1/buffered/zstd/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-M3:h2/buffered/zstd/GET/direct/2': { length: 4, sha256: '1c986dc083de2f3d01811ccf5feba7bbf933659591bf729c687c1177df4cb47d' },
  'CI-S1:h1/buffered/gzip/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-S2:h1/buffered/gzip/GET/direct/1': { length: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  'CI-S3:h1/buffered/zstd/GET/direct/1': { length: 131072, sha256: '7a633a252b69870eac53f22b114461d01fece3d079de5b0ff878d0c6aeffff37' },
  'CI-S3:h2/buffered/zstd/GET/direct/2': { length: 131084, sha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d' },
  'CI-Z1:h1/buffered/zstd/GET/direct/1': { length: 131072, sha256: '7a633a252b69870eac53f22b114461d01fece3d079de5b0ff878d0c6aeffff37' },
  'CI-Z2:h1/stream/zstd/GET/direct/1': null,
  'CI-Z3:h1/download/zstd/GET/direct/1': null,
  'CI-Z4:h1/upload/zstd/GET/direct/1': { length: 131072, sha256: '7a633a252b69870eac53f22b114461d01fece3d079de5b0ff878d0c6aeffff37' },
  'CI-Z5:h2/buffered/zstd/GET/direct/1': { length: 131084, sha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d' },
  'CI-Z6:h2/stream/zstd/GET/direct/1': { length: 131084, sha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d' },
  'CI-Z7:h2/download/zstd/GET/direct/1': { length: 131084, sha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d' },
  'CI-Z8:h2/upload/zstd/GET/direct/1': { length: 131084, sha256: '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d' },
});
const EXPECTED_NATURAL: Readonly<Record<string, CaseSnapshot['naturalAtCaseEnd']>> = Object.freeze({
  'h1/buffered': {"sessions": 0, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
  'h1/download': {"sessions": 0, "sockets": 1, "temporaryDirectories": 1, "timers": 0},
  'h1/stream': {"sessions": 0, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
  'h1/upload': {"sessions": 0, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
  'h2/buffered': {"sessions": 1, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
  'h2/download': {"sessions": 1, "sockets": 1, "temporaryDirectories": 1, "timers": 0},
  'h2/stream': {"sessions": 1, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
  'h2/upload': {"sessions": 1, "sockets": 1, "temporaryDirectories": 0, "timers": 0},
});
const EXPECTED_CAUSES: Readonly<Record<string, { causeCode: string; causeName: string; hasCause: boolean }>> = Object.freeze({
  'h1/buffered/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h1/buffered/rejected/REZ_HTTP_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h1/download/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "Error", "hasCause": true},
  'h1/stream/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h1/upload/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h2/buffered/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h2/buffered/rejected/REZ_HTTP_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h2/download/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "Error", "hasCause": true},
  'h2/stream/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
  'h2/upload/rejected/REZ_DECOMPRESSION_ERROR': {"causeCode": "", "causeName": "", "hasCause": false},
});


// ------------------------------------------------ client pool ownership --
// Tayo counter (seq 59842): pool/socket/session/maintenance-timer ownership
// IS observable read-only through existing exports, so it is recorded per
// leg (natural, before fixture teardown) and proven at forced teardown.
// H1 is inspected only after the first H1 request (the first
// getGlobalAgentPool() call's config is load-bearing); H2 through the
// public entry's Http2SessionPool singleton after the first H2 request.
interface H1PoolSnapshot { agents: number; activeSockets: number; freeSockets: number; queuedRequests: number; evictionTimer: 'null' | 'ref' | 'unref'; agentShape: 'node' | 'opaque' }
interface H2PoolSnapshot { sessions: number; entries: number; pending: number; leases: number; states: { reusable: number; retired: number; closed: number }; unhealthy: number; cleanupInterval: 'null' | 'ref' | 'unref' }
interface ClientPoolSnapshot { h1: H1PoolSnapshot | null; h2: H2PoolSnapshot | null }
let h1PoolTouched = false;
let h2PoolTouched = false;
function timerState(timer: unknown): 'null' | 'ref' | 'unref' {
  if (timer === null || timer === undefined) return 'null';
  const hasRef = Reflect.get(Object(timer), 'hasRef');
  return typeof hasRef === 'function' && hasRef.call(timer) === false ? 'unref' : 'ref';
}
// Fail closed: every member of an Agent socket/request list must be an
// array; a non-array member is shape drift, never a clean zero.
function countSocketLists(lists: unknown, label: string): number {
  if (lists === null || typeof lists !== 'object') throw new InfrastructureError(`agent ${label} is not an object`);
  let total = 0;
  for (const [key, value] of Object.entries(lists as Record<string, unknown>)) {
    if (!Array.isArray(value)) throw new InfrastructureError(`agent ${label}[${key}] is not an array`);
    total += value.length;
  }
  return total;
}
function snapshotH1PoolOf(pool: unknown): H1PoolSnapshot {
  let agents = 0; let activeSockets = 0; let freeSockets = 0; let queuedRequests = 0;
  for (const mapName of ['httpAgents', 'httpsAgents']) {
    const map = Reflect.get(Object(pool), mapName) as Map<string, { agent: unknown }> | undefined;
    // Fail closed: a missing/renamed map is shape drift, never a clean zero.
    if (!(map instanceof Map)) throw new InfrastructureError(`agent pool shape drift: ${mapName}`);
    for (const pooled of map.values()) {
      agents += 1;
      const agent = Object(pooled.agent) as Record<string, unknown>;
      activeSockets += countSocketLists(agent.sockets, 'sockets'); freeSockets += countSocketLists(agent.freeSockets, 'freeSockets'); queuedRequests += countSocketLists(agent.requests, 'requests');
    }
  }
  return { agents, activeSockets, freeSockets, queuedRequests, evictionTimer: timerState(Reflect.get(Object(pool), 'evictionTimer')), agentShape: 'node' };
}
function snapshotH2PoolOf(pool: unknown): H2PoolSnapshot {
  const sessions = Reflect.get(Object(pool), 'sessions') as Map<string, unknown>;
  const entries = Reflect.get(Object(pool), 'entriesBySession') as Map<unknown, { refCount: number; state: 'reusable' | 'retired' | 'closed'; session: { closed?: boolean; destroyed?: boolean; socket?: { destroyed?: boolean; writable?: boolean } } }>;
  const pending = Reflect.get(Object(pool), 'pendingCreations') as Set<unknown>;
  if (!(sessions instanceof Map) || !(entries instanceof Map) || !(pending instanceof Set)) throw new InfrastructureError('http2 session pool shape drift');
  let leases = 0; let unhealthy = 0; const states = { reusable: 0, retired: 0, closed: 0 };
  for (const entry of entries.values()) {
    leases += entry.refCount;
    states[entry.state] += 1;
    const session = entry.session; const socket = session.socket;
    if (session.closed === true || session.destroyed === true || (socket !== undefined && (socket.destroyed === true || socket.writable === false))) unhealthy += 1;
  }
  return { sessions: sessions.size, entries: entries.size, pending: pending.size, leases, states, unhealthy, cleanupInterval: timerState(Reflect.get(Object(pool), 'cleanupInterval')) };
}
function h2Pool(): unknown {
  return (H2_ENTRY as unknown as { Http2SessionPool: { getInstance(): unknown } }).Http2SessionPool.getInstance();
}
function snapshotClientPools(): ClientPoolSnapshot {
  return {
    h1: h1PoolTouched ? snapshotH1PoolOf(getGlobalAgentPool()) : null,
    h2: h2PoolTouched ? snapshotH2PoolOf(h2Pool()) : null,
  };
}
// Process raw listeners are snapshotted by identity at load and compared at
// the end, so the file provably restores exactly what it found.
const LISTENER_BASELINE = {
  uncaughtException: [...process.rawListeners('uncaughtException')],
  unhandledRejection: [...process.rawListeners('unhandledRejection')],
};
function listenerDelta(): string[] {
  const delta: string[] = [];
  for (const name of ['uncaughtException', 'unhandledRejection'] as const) {
    const now = process.rawListeners(name);
    const base = LISTENER_BASELINE[name];
    // Ordered, with multiplicity: the exact listener array must be restored.
    if (now.length !== base.length || now.some((listener, index) => listener !== base[index])) delta.push(`${name}:${base.length}->${now.length}`);
  }
  return delta;
}
// Natural (pre-force) pool state must be valid on its own — the per-leg
// client predicates, evaluated BEFORE destroy so a forced zero can never
// erase late state.
function naturalH1Valid(s: H1PoolSnapshot): boolean { return s.queuedRequests === 0 && s.activeSockets === 0 && s.agents === 1 && s.agentShape === 'node' && s.evictionTimer === 'unref'; }
function naturalH2Valid(s: H2PoolSnapshot): boolean { return s.pending === 0 && s.leases === 0 && s.entries === s.sessions && s.unhealthy === 0 && s.states.retired === 0 && s.states.closed === 0 && s.states.reusable === s.sessions && s.cleanupInterval === 'unref'; }
function forcedPoolTeardown(): { h1Before: H1PoolSnapshot | null; h1After: H1PoolSnapshot | null; h2Before: H2PoolSnapshot | null; h2After: H2PoolSnapshot | null; naturalProblems: string[] } {
  const naturalProblems: string[] = [];
  const h1Ref = h1PoolTouched ? getGlobalAgentPool() : null;
  const h1Before = h1Ref === null ? null : snapshotH1PoolOf(h1Ref);
  if (h1Before !== null && !naturalH1Valid(h1Before)) naturalProblems.push(`client-h1-natural:${JSON.stringify(h1Before)}`);
  if (h1Ref !== null) resetGlobalAgentPool();
  const h1After = h1Ref === null ? null : snapshotH1PoolOf(h1Ref);
  const h2Ref = h2PoolTouched ? h2Pool() : null;
  const h2Before = h2Ref === null ? null : snapshotH2PoolOf(h2Ref);
  if (h2Before !== null && !naturalH2Valid(h2Before)) naturalProblems.push(`client-h2-natural:${JSON.stringify(h2Before)}`);
  if (h2Ref !== null) (h2Ref as { destroy(): void }).destroy();
  const h2After = h2Ref === null ? null : snapshotH2PoolOf(h2Ref);
  return { h1Before, h1After, h2Before, h2After, naturalProblems };
}

// Frozen physical-leg key set (GREEN-v2 contract, DECISION-153/155): 107
// wires per runtime, identical on Node and Bun. Any missing, extra, or
// renamed leg is an oracle mismatch and fails the file closed.
const EXPECTED_LEG_COUNT = 107;
// Independent literal leg-class counts, cross-checked against the frozen key
// list and used for the forced-teardown equalities (never derived from legs).
const EXPECTED_H2_LEG_COUNT = 47;
const EXPECTED_DOWNLOAD_LEG_COUNT = 14;
const EXPECTED_LEG_KEYS: readonly string[] = Object.freeze([
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

afterAll(() => {
  // Forced client-pool teardown happens FIRST, on retained references, so the
  // ledger reports what the product's pools held and what destroying them did.
  const clientPools = forcedPoolTeardown();
  const expectedRed = [...EXPECTED_RED].sort();
  const expectedPassed = [...EXPECTED_PASSED].sort();
  const actualRed = [...observedFailures].sort();
  const actualPassed = [...observedPasses].sort();
  const actualRegistered = [...observedInvocations.keys()].sort();
  const oracleMismatches = [...oracleInvalidations, ...clientPools.naturalProblems];
  if (armedRed.size !== 0) {
    oracleMismatches.push(`armed-after-file:${JSON.stringify([...armedRed].sort())}`);
  }
  for (const id of REGISTERED) {
    const count = observedInvocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
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
  // Physical-leg reconciliation against the frozen key set.
  const legKeys = Object.keys(legs).sort();
  if (EXPECTED_LEG_KEYS.length !== EXPECTED_LEG_COUNT) {
    oracleMismatches.push(`frozen-keys:${EXPECTED_LEG_KEYS.length}!==${EXPECTED_LEG_COUNT}`);
  }
  const missingKeys = EXPECTED_LEG_KEYS.filter((key) => !legKeys.includes(key));
  const extraKeys = legKeys.filter((key) => !EXPECTED_LEG_KEYS.includes(key));
  if (missingKeys.length > 0) oracleMismatches.push(`legs-missing:${JSON.stringify(missingKeys)}`);
  if (extraKeys.length > 0) oracleMismatches.push(`legs-extra:${JSON.stringify(extraKeys)}`);
  if (legKeys.length !== EXPECTED_LEG_COUNT) oracleMismatches.push(`legCount:${legKeys.length}!==${EXPECTED_LEG_COUNT}`);
  // Per-leg authenticity: the client adapter identity must match the wire
  // protocol, and suite timers must be naturally zero at every case end.
  const naturalMax = { sessions: 0, sockets: 0, temporaryDirectories: 0, timers: 0 };
  for (const [legId, leg] of Object.entries(legs)) {
    const record = leg as CaseSnapshot & { protocol: string };
    const expectedAdapter = record.protocol === 'h1' ? 'http' : 'http2';
    if (record.adapter !== expectedAdapter) oracleMismatches.push(`adapter:${legId}:${record.adapter}`);
    if (record.naturalAtCaseEnd.timers !== 0) oracleMismatches.push(`natural-timers:${legId}:${record.naturalAtCaseEnd.timers}`);
    // Frozen per-leg contract: sequence, hook tuple, natural state, cause facts.
    const expectedSequence = EXPECTED_LEG_SEQUENCES[legId];
    const actualSequence = normalizeSequence(record.eventSequence);
    if (expectedSequence === undefined) oracleMismatches.push(`sequence-unfrozen:${legId}`);
    else if (JSON.stringify(actualSequence) !== JSON.stringify(expectedSequence)) oracleMismatches.push(`sequence:${legId}:${JSON.stringify(actualSequence)}`);
    const hookKey = `${record.protocol}/${record.mode}/${record.terminal}/${String(record.code ?? 'none')}`;
    const expectedHooks = EXPECTED_HOOKS[hookKey];
    if (expectedHooks === undefined) oracleMismatches.push(`hooks-unfrozen:${legId}:${hookKey}`);
    else if (JSON.stringify(record.hooks, Object.keys(record.hooks).sort()) !== JSON.stringify(expectedHooks, Object.keys(expectedHooks).sort())) oracleMismatches.push(`hooks:${legId}:${JSON.stringify(record.hooks)}`);
    const naturalKey = `${record.protocol}/${record.mode}`;
    const expectedNatural = EXPECTED_NATURAL[naturalKey];
    if (expectedNatural === undefined) oracleMismatches.push(`natural-unfrozen:${legId}`);
    else if (JSON.stringify(record.naturalAtCaseEnd, Object.keys(record.naturalAtCaseEnd).sort()) !== JSON.stringify(expectedNatural, Object.keys(expectedNatural).sort())) oracleMismatches.push(`natural:${legId}:${JSON.stringify(record.naturalAtCaseEnd)}`);
    if (record.terminal === 'rejected') {
      const expectedCause = EXPECTED_CAUSES[hookKey];
      if (expectedCause === undefined) oracleMismatches.push(`cause-unfrozen:${legId}:${hookKey}`);
      else if (record.errorIdentity === null || record.errorIdentity.hasCause !== expectedCause.hasCause || record.errorIdentity.causeName !== expectedCause.causeName || record.errorIdentity.causeCode !== expectedCause.causeCode) oracleMismatches.push(`cause:${legId}:${JSON.stringify(record.errorIdentity)}`);
    }
    // Exactly one server hit per wire (retry:false): a retried or duplicated
    // attempt can no longer hide behind a single client snapshot.
    if (record.wireHits !== 1) oracleMismatches.push(`wire-hits:${legId}:${record.wireHits}`);
    const expectedResponseBody = EXPECTED_RESPONSE_BODY[legId];
    if (expectedResponseBody === undefined) oracleMismatches.push(`response-body-unfrozen:${legId}`);
    else if (expectedResponseBody === null
      ? (record.responseBodyLength !== null || record.responseBodySha256 !== null)
      : (record.responseBodyLength !== expectedResponseBody.length || record.responseBodySha256 !== expectedResponseBody.sha256)) oracleMismatches.push(`response-body:${legId}:${record.responseBodyLength}:${record.responseBodySha256}`);
    // Progress: at least one event whenever body bytes reached a facade,
    // none otherwise (the count itself follows runtime chunking).
    const facadeBytes = (record.streamLength ?? 0) + (record.fileState?.length ?? 0);
    const expectedProgress = EXPECTED_PROGRESS[legId];
    if (expectedProgress === undefined) oracleMismatches.push(`progress-unfrozen:${legId}`);
    else if ((record.progressEvents > 0) !== expectedProgress) oracleMismatches.push(`progress:${legId}:${record.progressEvents}:${facadeBytes}`);
    for (const key of Object.keys(naturalMax) as Array<keyof typeof naturalMax>) {
      naturalMax[key] = Math.max(naturalMax[key], record.naturalAtCaseEnd[key]);
    }
  }
  if (ENTRY_IDENTITY.h1.adapter !== 'http') oracleMismatches.push(`entry-adapter:h1:${ENTRY_IDENTITY.h1.adapter}`);
  if (ENTRY_IDENTITY.h2.adapter !== 'http2') oracleMismatches.push(`entry-adapter:h2:${ENTRY_IDENTITY.h2.adapter}`);
  // Registry coverage: every registered row is exactly one of target/control.
  const registryUnion = [...REGISTRY.targets, ...REGISTRY.controls].sort();
  if (JSON.stringify(registryUnion) !== JSON.stringify([...REGISTERED].sort())) oracleMismatches.push(`registry:${JSON.stringify(registryUnion)}`);
  const registryOverlap = REGISTRY.targets.filter((id) => REGISTRY.controls.includes(id));
  if (registryOverlap.length > 0) oracleMismatches.push(`registry-overlap:${JSON.stringify(registryOverlap)}`);
  for (const key of ['h1', 'h2'] as const) {
    if (ENTRY_IDENTITY[key].defaultKind !== 'function' || ENTRY_IDENTITY[key].factory !== 'function') oracleMismatches.push(`entry-kind:${key}:${ENTRY_IDENTITY[key].defaultKind}/${ENTRY_IDENTITY[key].factory}`);
    if (ENTRY_IDENTITY[key].sourceSha256.length !== 64) oracleMismatches.push(`entry-source:${key}`);
  }
  // Forced teardown is pinned to exact equalities: one server and one
  // connection per wire, one H2 session per H2 wire, one tmpdir per download
  // wire, and NEVER a timer left for afterEach to clear.
  const frozenH2Keys = EXPECTED_LEG_KEYS.filter((key) => key.includes(':h2/')).length;
  const frozenDownloadKeys = EXPECTED_LEG_KEYS.filter((key) => key.includes('/download')).length;
  if (frozenH2Keys !== EXPECTED_H2_LEG_COUNT) oracleMismatches.push(`h2-literal:${frozenH2Keys}!==${EXPECTED_H2_LEG_COUNT}`);
  if (frozenDownloadKeys !== EXPECTED_DOWNLOAD_LEG_COUNT) oracleMismatches.push(`download-literal:${frozenDownloadKeys}!==${EXPECTED_DOWNLOAD_LEG_COUNT}`);
  if (forcedCleanup.serversClosed !== EXPECTED_LEG_COUNT) oracleMismatches.push(`forced-servers:${forcedCleanup.serversClosed}!==${EXPECTED_LEG_COUNT}`);
  if (forcedCleanup.socketsDestroyed + forcedCleanup.socketsClosedWithSessions !== EXPECTED_LEG_COUNT) oracleMismatches.push(`forced-sockets:${forcedCleanup.socketsDestroyed}+${forcedCleanup.socketsClosedWithSessions}!==${EXPECTED_LEG_COUNT}`);
  if (forcedCleanup.sessionsDestroyed !== EXPECTED_H2_LEG_COUNT) oracleMismatches.push(`forced-sessions:${forcedCleanup.sessionsDestroyed}!==${EXPECTED_H2_LEG_COUNT}`);
  if (forcedCleanup.temporaryDirectoriesRemoved !== EXPECTED_DOWNLOAD_LEG_COUNT) oracleMismatches.push(`forced-tmpdirs:${forcedCleanup.temporaryDirectoriesRemoved}!==${EXPECTED_DOWNLOAD_LEG_COUNT}`);
  if (fixtureEvents.length > 0) oracleMismatches.push(`fixture-events:${JSON.stringify(fixtureEvents)}`);
  if (forcedCleanup.timersCleared !== 0) oracleMismatches.push(`forced-timers:${forcedCleanup.timersCleared}`);
  // Client pools: per leg no queued H1 requests, no H2 pending creations or
  // leases, entries == sessions, no unhealthy idle session, maintenance
  // timers unref'd; after forced teardown every pool handle is zero/null.
  const clientNaturalMax = { h1: { activeSockets: 0, agents: 0, freeSockets: 0, queuedRequests: 0 }, h2: { entries: 0, leases: 0, pending: 0, sessions: 0, unhealthy: 0 } };
  for (const [legId, leg] of Object.entries(legs)) {
    const pools = (leg as CaseSnapshot).clientNaturalAtCaseEnd;
    if (pools.h1 !== null) {
      if (pools.h1.queuedRequests !== 0) oracleMismatches.push(`client-h1-queued:${legId}:${pools.h1.queuedRequests}`);
      if (pools.h1.evictionTimer !== 'unref') oracleMismatches.push(`client-h1-timer:${legId}:${pools.h1.evictionTimer}`);
      if (pools.h1.agentShape !== 'node' || pools.h1.agents !== 1 || pools.h1.activeSockets !== 0) oracleMismatches.push(`client-h1-shape:${legId}:${JSON.stringify(pools.h1)}`);
      clientNaturalMax.h1.activeSockets = Math.max(clientNaturalMax.h1.activeSockets, pools.h1.activeSockets);
      clientNaturalMax.h1.agents = Math.max(clientNaturalMax.h1.agents, pools.h1.agents);
      clientNaturalMax.h1.freeSockets = Math.max(clientNaturalMax.h1.freeSockets, pools.h1.freeSockets);
      clientNaturalMax.h1.queuedRequests = Math.max(clientNaturalMax.h1.queuedRequests, pools.h1.queuedRequests);
    }
    if (pools.h2 !== null) {
      if (pools.h2.pending !== 0) oracleMismatches.push(`client-h2-pending:${legId}:${pools.h2.pending}`);
      if (pools.h2.leases !== 0) oracleMismatches.push(`client-h2-leases:${legId}:${pools.h2.leases}`);
      if (pools.h2.entries !== pools.h2.sessions) oracleMismatches.push(`client-h2-entries:${legId}:${pools.h2.entries}!==${pools.h2.sessions}`);
      if (pools.h2.cleanupInterval !== 'unref') oracleMismatches.push(`client-h2-timer:${legId}:${pools.h2.cleanupInterval}`);
      if (pools.h2.unhealthy !== 0 || pools.h2.states.retired !== 0 || pools.h2.states.closed !== 0 || pools.h2.states.reusable !== pools.h2.sessions) oracleMismatches.push(`client-h2-health:${legId}:${JSON.stringify(pools.h2)}`);
      clientNaturalMax.h2.entries = Math.max(clientNaturalMax.h2.entries, pools.h2.entries);
      clientNaturalMax.h2.leases = Math.max(clientNaturalMax.h2.leases, pools.h2.leases);
      clientNaturalMax.h2.pending = Math.max(clientNaturalMax.h2.pending, pools.h2.pending);
      clientNaturalMax.h2.sessions = Math.max(clientNaturalMax.h2.sessions, pools.h2.sessions);
      clientNaturalMax.h2.unhealthy = Math.max(clientNaturalMax.h2.unhealthy, pools.h2.unhealthy);
    }
  }
  if (clientPools.h1After !== null && (clientPools.h1After.evictionTimer !== 'null' || clientPools.h1After.agents !== 0 || clientPools.h1After.activeSockets + clientPools.h1After.freeSockets + clientPools.h1After.queuedRequests !== 0)) oracleMismatches.push(`client-h1-after:${JSON.stringify(clientPools.h1After)}`);
  if (clientPools.h2After !== null && (clientPools.h2After.cleanupInterval !== 'null' || clientPools.h2After.sessions + clientPools.h2After.entries + clientPools.h2After.pending + clientPools.h2After.leases + clientPools.h2After.states.reusable + clientPools.h2After.states.retired + clientPools.h2After.states.closed !== 0)) oracleMismatches.push(`client-h2-after:${JSON.stringify(clientPools.h2After)}`);
  if (clientPools.h1Before === null || clientPools.h2Before === null) oracleMismatches.push('client-pools-untouched');
  // Listener reconciliation BEFORE the ledger is built, so it is part of it.
  const listeners = listenerDelta();
  if (listeners.length > 0) oracleMismatches.push(`listeners:${listeners.join(',')}`);
  const ledger = {
    cleanup: {
      complete: cleanupErrors.length === 0 && teardownErrors.length === 0 &&
        activeServers.size === 0 && activeSockets.size === 0 &&
        activeSessions.size === 0 && activeTimers.size === 0 &&
        activeTemporaryDirectories.size === 0 && naturalMax.timers === 0,
      endState: {
        servers: activeServers.size,
        sessions: activeSessions.size,
        sockets: activeSockets.size,
        temporaryDirectories: activeTemporaryDirectories.size,
        timers: activeTimers.size,
      },
      forced: { ...forcedCleanup },
      naturalMax,
    },
    cleanupErrors,
    clientPools: { endState: { h1: clientPools.h1After, h2: clientPools.h2After }, forced: clientPools, naturalMax: clientNaturalMax },
    file: FILE,
    fixtureErrors,
    fixtureEvents,
    listeners,
    lateEvents,
    oracleMismatches,
    passed: actualPassed,
    red: actualRed,
    registered: actualRegistered,
    registry: REGISTRY,
    entryIdentity: ENTRY_IDENTITY,
    epoch: 'green-v2',
    expectedLegCount: EXPECTED_LEG_COUNT,
    expectedPassed,
    expectedRed,
    legCount: legKeys.length,
    legs,
    processFaults: {
      uncaught: Object.values(legs).reduce((total: number, leg) => total + Number((leg as { uncaught: number }).uncaught), 0),
      unhandled: Object.values(legs).reduce((total: number, leg) => total + Number((leg as { unhandled: number }).unhandled), 0),
    },
    runtime: RUNTIME,
    runtimeVersion: RUNTIME_VERSION,
    schema: 'rezo.r07.integrity.ledger/v2',
    setupErrors,
    skipped: [],
    teardownErrors,
  };
  console.log(`REZO_R07_LEDGER_V2:${JSON.stringify(ledger)}`);
  // Fail closed: the ledger is printed for the supervisor, then any
  // unacceptable condition throws so the file can never exit 0 on a
  // mismatch, a leak, a fault, or a short leg set.
  const failures: string[] = [];
  if (oracleMismatches.length > 0) failures.push(`oracle:${oracleMismatches.join('|')}`);
  if (fixtureErrors.length > 0) failures.push(`fixture:${fixtureErrors.length}`);
  if (setupErrors.length > 0) failures.push(`setup:${setupErrors.length}`);
  if (teardownErrors.length > 0) failures.push(`teardown:${teardownErrors.length}`);
  if (cleanupErrors.length > 0) failures.push(`cleanup-errors:${cleanupErrors.length}`);
  if (lateEvents.length > 0) failures.push(`late-events:${lateEvents.length}`);
  if (!ledger.cleanup.complete) failures.push('cleanup-incomplete');
  if (ledger.processFaults.uncaught !== 0 || ledger.processFaults.unhandled !== 0) failures.push('process-faults');
  if (failures.length > 0) {
    throw new InfrastructureError(`R07 GREEN-v2 ledger rejected: ${failures.join('; ')}`);
  }
});

it('fixture pins are exact', () => {
  assertFixturePins();
  assertNormalizerKeepsCardinality();
});

// --------------------------- eight zstd cells ------------------------------

const Z_CELLS: Array<[RowId, Protocol, Mode]> = [
  ['CI-Z1', 'h1', 'buffered'], ['CI-Z2', 'h1', 'stream'],
  ['CI-Z3', 'h1', 'download'], ['CI-Z4', 'h1', 'upload'],
  ['CI-Z5', 'h2', 'buffered'], ['CI-Z6', 'h2', 'stream'],
  ['CI-Z7', 'h2', 'download'], ['CI-Z8', 'h2', 'upload'],
];

for (const [id, protocol, mode] of Z_CELLS) {
  it(`${id} truncated zstd frame must reject (${protocol}/${mode})`, async () => {
    await observeRow(id, async () => {
      const snapshot = await runWireCase({ body: Z_PREF, encoding: 'zstd', mode, protocol });
      // Accepted RED = today's silent success. Body/file hashes are pinned
      // where the surface is deterministic (buffered body, download file);
      // stream/upload facade payload shapes stay unpinned by design.
      const silentSuccess = snapshot.terminal === 'fulfilled' &&
        snapshot.errorEvents === 0 && snapshot.uncaught === 0 &&
        snapshot.unhandled === 0 && snapshot.stable &&
        (mode === 'buffered' ? snapshot.status === 200 : snapshot.successEvents >= 1);
      const downloadRed = mode !== 'download' || (
        snapshot.fileState?.exists === true &&
        (snapshot.fileState.sha256Digest === ZPREF_HEX || snapshot.fileState.sha256Digest === ZDEC_HEX)
      );
      const bufferedRed = mode !== 'buffered' ||
        snapshot.bodySha256 === ZDEC_HEX || snapshot.bodySha256 === ZPREF_HEX;
      if (silentSuccess && downloadRed && bufferedRed) armRed(id);
      expectStructuredRejection(snapshot);
      if (mode === 'download') expect(snapshot.fileState?.exists).toBe(false);
      // Raw stream mode delivered exactly the truncated wire bytes before the
      // structural verdict settled the failure (data-then-error).
      if (mode === 'stream') { expect(snapshot.streamSha256).toBe(ZPREF_HEX); expect(snapshot.streamLength).toBe(Z_PREF.length); }
    });
  });
}

// ------------------------------- M families --------------------------------

it('CI-M1 micro prefix misclassification must reject', async () => {
  await observeRow('CI-M1', async () => {
    const legs: Array<[Protocol, string, Buffer]> = [
      ['h1', 'gzip', Buffer.from([0x1f])],
      ['h1', 'deflate', Buffer.from([0x78])],
      ['h1', 'zstd', Buffer.from([0x28])],
      ['h1', 'zstd', Buffer.from([0x28, 0xb5])],
      ['h1', 'zstd', Buffer.from([0x28, 0xb5, 0x2f])],
      ['h1', 'br', Buffer.from([0x1b])],
      ['h2', 'zstd', Buffer.from([0x28, 0xb5, 0x2f])],
    ];
    const snapshots: CaseSnapshot[] = [];
    for (const [protocol, encoding, body] of legs) {
      snapshots.push(await runWireCase({ body, encoding, mode: 'buffered', protocol }));
    }
    const allLeakRaw = snapshots.every((snapshot, index) =>
      fulfilledWith(snapshot, sha256(legs[index][2]), legs[index][2].length));
    if (allLeakRaw) armRed('CI-M1');
    for (const snapshot of snapshots) expectStructuredRejection(snapshot);
  });
});

it('CI-M2 committed decode failure swallow must reject', async () => {
  await observeRow('CI-M2', async () => {
    const legs: Array<[string, Buffer]> = [
      ['gzip', Buffer.from([0x1f, 0x8b])],
      ['gzip', Buffer.from([0x1f, 0x8b, 0x08])],
      ['deflate', Buffer.from([0x78, 0x9c])],
      ['deflate', Buffer.from([0x78, 0x9c, 0x00])],
      ['br', B_FULL.subarray(0, 2)],
      ['br', B_FULL.subarray(0, 3)],
    ];
    const snapshots: CaseSnapshot[] = [];
    for (const [encoding, body] of legs) {
      snapshots.push(await runWireCase({ body, encoding, mode: 'buffered', protocol: 'h1' }));
    }
    const allLeakRaw = snapshots.every((snapshot, index) =>
      fulfilledWith(snapshot, sha256(legs[index][1]), legs[index][1].length));
    if (allLeakRaw) armRed('CI-M2');
    for (const snapshot of snapshots) expectStructuredRejection(snapshot);
  });
});

it('CI-M3 zstd magic-only empty fulfillment must reject', async () => {
  await observeRow('CI-M3', async () => {
    const h1 = await runWireCase({ body: Z_MAGIC, encoding: 'zstd', mode: 'buffered', protocol: 'h1' });
    const h2 = await runWireCase({ body: Z_MAGIC, encoding: 'zstd', mode: 'buffered', protocol: 'h2' });
    const emptyFulfil = (snapshot: CaseSnapshot): boolean =>
      snapshot.terminal === 'fulfilled' && snapshot.status === 200 && snapshot.bodyLength === 0;
    if (emptyFulfil(h1) && emptyFulfil(h2)) armRed('CI-M3');
    expectStructuredRejection(h1);
    expectStructuredRejection(h2);
  });
});

it('CI-B1 full valid brotli frames must decode exactly on both protocols', async () => {
  await observeRow('CI-B1', async () => {
    // Discovered during R07-1 authoring: H1's SmartDecompressStream sniffer
    // misclassifies FULL valid brotli frames and returns them compressed;
    // H2's buffered path decodes the same frame correctly (asymmetry pinned).
    const h1 = await runWireCase({ body: B_FULL, encoding: 'br', mode: 'buffered', protocol: 'h1' });
    const h2 = await runWireCase({ body: B_FULL, encoding: 'br', mode: 'buffered', protocol: 'h2' });
    const acceptedRed =
      fulfilledWith(h1, sha256(B_FULL), B_FULL.length) &&
      fulfilledWith(h2, sha256(SMALL), SMALL.length);
    if (acceptedRed) armRed('CI-B1');
    for (const snapshot of [h1, h2]) {
      expect(snapshot.terminal).toBe('fulfilled');
      expect(snapshot.bodySha256).toBe(sha256(SMALL));
      expect(snapshot.bodyLength).toBe(SMALL.length);
      expect(snapshot.uncaught).toBe(0);
      expect(snapshot.unhandled).toBe(0);
    }
  });
});

// --------------------------------- G1 --------------------------------------

it('CI-G1A gzip-raw must decode real raw deflate on both protocols', async () => {
  await observeRow('CI-G1A', async () => {
    const h1 = await runWireCase({ body: RAW_D, encoding: 'gzip-raw', mode: 'buffered', protocol: 'h1' });
    const h2 = await runWireCase({ body: RAW_D, encoding: 'gzip-raw', mode: 'buffered', protocol: 'h2' });
    const acceptedRed =
      (h1.terminal === 'rejected' && h1.code === 'REZ_DECOMPRESSION_ERROR') &&
      fulfilledWith(h2, sha256(RAW_D), RAW_D.length);
    if (acceptedRed) armRed('CI-G1A');
    for (const snapshot of [h1, h2]) {
      expect(snapshot.terminal).toBe('fulfilled');
      expect(snapshot.bodySha256).toBe(sha256(SMALL));
      expect(snapshot.bodyLength).toBe(SMALL.length);
      expect(snapshot.uncaught).toBe(0);
      expect(snapshot.unhandled).toBe(0);
    }
  });
});

it('CI-G1B gzip-raw must reject zlib-wrapped bodies on both protocols', async () => {
  await observeRow('CI-G1B', async () => {
    const h1 = await runWireCase({ body: D_FULL, encoding: 'gzip-raw', mode: 'buffered', protocol: 'h1' });
    const h2 = await runWireCase({ body: D_FULL, encoding: 'gzip-raw', mode: 'buffered', protocol: 'h2' });
    const acceptedRed =
      fulfilledWith(h1, sha256(SMALL), SMALL.length) &&
      fulfilledWith(h2, sha256(D_FULL), D_FULL.length);
    if (acceptedRed) armRed('CI-G1B');
    expectStructuredRejection(h1);
    expectStructuredRejection(h2);
  });
});

it('CI-G1C gzip-raw micro and truncated bodies must reject', async () => {
  await observeRow('CI-G1C', async () => {
    const h1micro = await runWireCase({ body: RAW_D.subarray(0, 3), encoding: 'gzip-raw', mode: 'buffered', protocol: 'h1' });
    const h2trunc = await runWireCase({ body: RAW_D.subarray(0, Math.floor(RAW_D.length / 2)), encoding: 'gzip-raw', mode: 'buffered', protocol: 'h2' });
    const acceptedRed =
      fulfilledWith(h1micro, sha256(RAW_D.subarray(0, 3)), 3) &&
      fulfilledWith(h2trunc, null, Math.floor(RAW_D.length / 2));
    if (acceptedRed) armRed('CI-G1C');
    expectStructuredRejection(h1micro);
    expectStructuredRejection(h2trunc);
  });
});

// ------------------------------ strict rows ---------------------------------

it('CI-S1 damaged-magic bodies must reject under declared encoding', async () => {
  await observeRow('CI-S1', async () => {
    const snapshot = await runWireCase({ body: DAMAGED_GZ, encoding: 'gzip', mode: 'buffered', protocol: 'h1' });
    if (fulfilledWith(snapshot, sha256(DAMAGED_GZ), DAMAGED_GZ.length)) armRed('CI-S1');
    expectStructuredRejection(snapshot);
  });
});

it('CI-S2 mislabeled-plain bodies must reject under declared encoding', async () => {
  await observeRow('CI-S2', async () => {
    const snapshot = await runWireCase({ body: PLAIN, encoding: 'gzip', mode: 'buffered', protocol: 'h1' });
    if (fulfilledWith(snapshot, sha256(PLAIN), PLAIN.length)) armRed('CI-S2');
    expectStructuredRejection(snapshot);
  });
});

it('CI-S3 acceptPartialBody never blesses integrity failure', async () => {
  await observeRow('CI-S3', async () => {
    const h1 = await runWireCase({
      body: Z_PREF, encoding: 'zstd', mode: 'buffered',
      options: { acceptPartialBody: true }, protocol: 'h1',
    });
    const h2 = await runWireCase({
      body: Z_PREF, encoding: 'zstd', mode: 'buffered',
      options: { acceptPartialBody: true }, protocol: 'h2',
    });
    if (fulfilledWith(h1, ZDEC_HEX, 131_072) && fulfilledWith(h2, ZDEC_HEX, 131_072)) armRed('CI-S3');
    expectStructuredRejection(h1);
    expectStructuredRejection(h2);
  });
});

// -------------------------------- controls ---------------------------------

// GREEN-v2 control matrix (DECISION-153/155 Q4): 72 wires/runtime.
const ALL_TOKENS = ['gzip', 'x-gzip', 'deflate', 'x-deflate', 'gzip-raw', 'br', 'brotli', 'zstd'];
const FRAME_FAMILIES: Array<[string, Buffer, string]> = [
  ['gzip', G_FULL, sha256(SMALL)],
  ['deflate', D_FULL, sha256(SMALL)],
  ['br', B_FULL, sha256(SMALL)],
  ['zstd', Z_FULL, PAY_HEX],
];
const ALL_MODES: Mode[] = ['buffered', 'stream', 'download', 'upload'];

function expectCleanSuccess(snapshot: CaseSnapshot, expectedStatus = 200): void {
  expect(snapshot.terminal).toBe('fulfilled');
  expect(snapshot.errorEvents).toBe(0);
  expect(snapshot.wireHits).toBe(1);
  // Lifecycle: facades finished exactly once; the promise surface has no facade.
  expect(snapshot.isFinished).toBe(snapshot.mode === 'buffered' ? null : true);
  expect(snapshot.successEvents).toBe(snapshot.mode === 'buffered' ? 0 : 3);
  // Status on the fulfilled surface: stream/download expose 200; the upload
  // facade's done payload carries no status today (recorded finding).
  if (snapshot.mode === 'stream' || snapshot.mode === 'download') expect(snapshot.status).toBe(200);
  // Buffered success exposes the wire status on the response itself.
  if (snapshot.mode === 'buffered') expect(snapshot.status).toBe(expectedStatus);
  if (snapshot.mode === 'upload') expect(snapshot.status).toBeNull();
  expect(snapshot.errorIdentity).toBeNull();
  expect(snapshot.responseStatus).toBeNull();
  expect(snapshot.responseBodyLength).toBeNull();
  expect(snapshot.uncaught).toBe(0);
  expect(snapshot.unhandled).toBe(0);
  expect(snapshot.stable).toBe(true);
  expect(snapshot.hooks.beforeError).toBe(0);
  expect(snapshot.hooks.onAbort).toBe(0);
  expect(snapshot.hooks.onTimeout).toBe(0);
}

it('CI-C0 zero-wire ordinary response stays green (8 tokens x H1/H2)', async () => {
  await observeRow('CI-C0', async () => {
    for (const encoding of ALL_TOKENS) {
      for (const protocol of ['h1', 'h2'] as Protocol[]) {
        const snapshot = await runWireCase({
          body: Buffer.alloc(0), contentLength: 0, encoding, mode: 'buffered', protocol,
          legLabel: `${protocol}/${encoding}`,
        });
        expectCleanSuccess(snapshot);
        expect(snapshot.status).toBe(200);
        expect(snapshot.bodyLength).toBe(0);
      }
    }
  });
});

it('CI-C1 full-frame decode stays exact across 4 families x 8 cells', async () => {
  await observeRow('CI-C1', async () => {
    for (const [encoding, body, decodedHex] of FRAME_FAMILIES) {
      const encodedHex = sha256(body);
      for (const protocol of ['h1', 'h2'] as Protocol[]) {
        for (const mode of ALL_MODES) {
          const snapshot = await runWireCase({ body, encoding, mode, protocol, legLabel: `${protocol}/${mode}/${encoding}` });
          expectCleanSuccess(snapshot);
          if (mode === 'buffered') {
            expect(snapshot.bodySha256).toBe(decodedHex);
          } else if (mode === 'stream') {
            // Raw stream mode delivers the encoded wire bytes untouched.
            expect(snapshot.streamSha256).toBe(encodedHex);
          } else if (mode === 'download') {
            // H1 downloads keep the raw wire mapping; H2 downloads decode.
            expect(snapshot.fileState?.exists).toBe(true);
            expect(snapshot.fileState?.sha256Digest).toBe(protocol === 'h1' ? encodedHex : decodedHex);
          } else {
            expect(snapshot.successEvents).toBe(3);
            expect(snapshot.errorEvents).toBe(0);
          }
        }
      }
    }
  });
});

it('CI-C2 bodyless and informational semantics stay green (H1/H2 x 4 shapes)', async () => {
  await observeRow('CI-C2', async () => {
    for (const protocol of ['h1', 'h2'] as Protocol[]) {
      const head = await runWireCase({
        body: Buffer.alloc(0), contentLength: Z_FULL.length, encoding: 'zstd',
        method: 'HEAD', mode: 'buffered', protocol, legLabel: `${protocol}/HEAD`,
      });
      expectCleanSuccess(head);
      expect(head.status).toBe(200);
      expect(head.bodyLength).toBe(0);

      const noContent = await runWireCase({
        body: Buffer.alloc(0), contentLength: 0, encoding: 'zstd', mode: 'buffered',
        protocol, status: 204, legLabel: `${protocol}/204`,
      });
      expectCleanSuccess(noContent, 204);
      expect(noContent.status).toBe(204);
      expect(noContent.bodyLength).toBe(0);

      // 304 under default validateStatus is a structured HTTP error, never a
      // decode attempt, a crash, or a hang: coherence is the control.
      const notModified = await runWireCase({
        body: Buffer.alloc(0), contentLength: 0, encoding: 'zstd', mode: 'buffered',
        protocol, status: 304, legLabel: `${protocol}/304`,
      });
      // Pinned to the single observed behavior on Node and Bun, H1 and H2:
      // default validateStatus rejects 304 as a structured HTTP error.
      expect(notModified.terminal).toBe('rejected');
      expect(notModified.code).toBe('REZ_HTTP_ERROR');
      expect(notModified.errno).toBe(-1031);
      expect(notModified.message).toBe('Request failed with status code 304');
      // Own status, independent response status, response identity with an
      // empty body, and the exact structured-error facts (identical on Node
      // and Bun, H1 and H2).
      expect(notModified.status).toBe(304);
      expect(notModified.responseStatus).toBe(304);
      expect(notModified.errorIdentity).toEqual({ causeCode: '', causeName: '', hasCause: false, hasResponse: true, isRezoError: true, name: 'RezoError' });
      expect(notModified.responseBodyLength).toBe(0);
      expect(notModified.responseBodySha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(notModified.isNetworkError).toBe(false);
      expect(notModified.isRetryable).toBe(true);
      expect(notModified.isTimeout).toBe(false);
      expect(notModified.errorEvents).toBe(0);
      expect(notModified.successEvents).toBe(0);
      expect(notModified.bodyLength).toBeNull();
      expect(notModified.wireHits).toBe(1);
      expect(notModified.uncaught).toBe(0);
      expect(notModified.unhandled).toBe(0);
      expect(notModified.stable).toBe(true);

      const informational = await runWireCase({
        body: Buffer.alloc(0), contentLength: 0, encoding: 'zstd', mode: 'buffered',
        protocol, status: 204, informational: 103, legLabel: `${protocol}/103-204`,
      });
      expectCleanSuccess(informational, 204);
      expect(informational.wireInformationalSent).toBe(1);
      expect(informational.status).toBe(204);
      expect(informational.bodyLength).toBe(0);
    }
  });
});

it('CI-C3 decompress:false bypass returns exact raw everywhere (H1/H2 x 4 modes)', async () => {
  await observeRow('CI-C3', async () => {
    for (const protocol of ['h1', 'h2'] as Protocol[]) {
      for (const mode of ALL_MODES) {
        const snapshot = await runWireCase({
          body: Z_PREF, encoding: 'zstd', mode, options: { decompress: false }, protocol,
          legLabel: `${protocol}/${mode}`,
        });
        expectCleanSuccess(snapshot);
        if (mode === 'buffered') {
          expect(snapshot.bodySha256).toBe(ZPREF_HEX);
          expect(snapshot.bodyLength).toBe(131_084);
        } else if (mode === 'stream') {
          expect(snapshot.streamSha256).toBe(ZPREF_HEX);
        } else if (mode === 'download') {
          expect(snapshot.fileState?.exists).toBe(true);
          expect(snapshot.fileState?.sha256Digest).toBe(ZPREF_HEX);
        } else {
          expect(snapshot.successEvents).toBe(3);
          expect(snapshot.errorEvents).toBe(0);
        }
      }
    }
  });
});

it('CI-C4 no content-encoding passes bytes through exactly (H1/H2 x 4 modes)', async () => {
  await observeRow('CI-C4', async () => {
    const smallHex = sha256(SMALL);
    for (const protocol of ['h1', 'h2'] as Protocol[]) {
      for (const mode of ALL_MODES) {
        const snapshot = await runWireCase({ body: SMALL, mode, protocol, legLabel: `${protocol}/${mode}` });
        expectCleanSuccess(snapshot);
        if (mode === 'buffered') expect(snapshot.bodySha256).toBe(smallHex);
        else if (mode === 'stream') expect(snapshot.streamSha256).toBe(smallHex);
        else if (mode === 'download') expect(snapshot.fileState?.sha256Digest).toBe(smallHex);
        else { expect(snapshot.successEvents).toBe(3); expect(snapshot.errorEvents).toBe(0); }
      }
    }
  });
});
