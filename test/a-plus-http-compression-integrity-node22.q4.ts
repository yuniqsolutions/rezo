import { afterAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RezoHooks } from '../src/core/hooks';
import { RezoError } from '../src/errors/rezo-error';
import { getGlobalAgentPool, resetGlobalAgentPool } from '../src/utils/agent-pool';
import { getFS } from '../src/utils/http-config';

// R07 CI-Q4 carrier — the Node 22.14 (native zstd absent) evidence file.
//
// Frozen contract: PLAN/r07-zstd-integrity-implementation-plan.md item 6 and
// the R07 manifest row CI-Q4-01..10 (class ENV-PENDING). Rows 01..08 are the
// eight AUTO cells in matrix order, 09 is the `decompress:false` ×8
// truncated-bypass sweep, 10 is the unavailability error-field/asymmetry
// contract over the five rejecting AUTO observations (no additional wires).
// Physical roster when applicable: 16 legs (8 AUTO + 8 bypass).
//
// Runtime gate (exact): `process.version === 'v22.14.0'` AND both
// `zlib.createZstdDecompress` and `zlib.zstdDecompressSync` undefined. On any
// other host every CI-Q4 row is ENV-PENDING — neither passed nor skipped —
// and only the unregistered infrastructure checks execute. A ledger with
// `applicable:false` is plumbing evidence only and must never be accepted as
// Node 22.14 evidence.
//
// Archive-replayable: this file imports PUBLIC entries + RezoError + getFS
// only (all present in the immutable `fda6772` tree); it never imports zstd
// APIs or post-baseline modules. The pinned fixtures F-ZFULL/F-ZPREF are
// rebuilt byte-identically from the F-PAY generator with a raw-block RFC
// 8878 writer (verified equal to `zstdCompressSync(F-PAY)`: sha
// b89d5212…, 262159 bytes; prefix 131084 = 36fefb72…).
//
// Epochs: `env-pending` (host is not the gate), `discovery` (applicable host,
// EXPECTED_SEQUENCES not yet frozen — the first real run's observed maps are
// frozen into reviewed bytes afterwards), `green-v2` (applicable + frozen =
// canonical; classification targets/controls only then).
//
// Discovery: `.q4.ts` matches neither the vitest nor the bun default glob.
// Canonical invocation (supervisor, shell:false, sanitized env, exact argv
// recorded): `<real node v22.14.0 binary> <abs>/node_modules/vitest/vitest.mjs
// run --config test/r07-node22.vitest.config.mts` with
// `REZO_R07_Q4_LEDGER_FILE` set; Bun plumbing only: `bun test ./test/…q4.ts`.

class InfrastructureError extends Error {}

type RowId =
  | 'CI-Q4-01' | 'CI-Q4-02' | 'CI-Q4-03' | 'CI-Q4-04' | 'CI-Q4-05'
  | 'CI-Q4-06' | 'CI-Q4-07' | 'CI-Q4-08' | 'CI-Q4-09' | 'CI-Q4-10';
type Protocol = 'h1' | 'h2';
type Mode = 'buffered' | 'stream' | 'download' | 'upload';
type Terminal = 'fulfilled' | 'rejected' | 'pending';

const FILE = 'test/a-plus-http-compression-integrity-node22.q4.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const RUNTIME_VERSION = RUNTIME === 'bun' ? (process.versions.bun ?? '') : process.version;
const zlibModule = await import('node:zlib') as unknown as Record<string, unknown>;
const ZSTD_SYNC_PRESENT = typeof zlibModule.zstdDecompressSync === 'function';
const ZSTD_STREAM_PRESENT = typeof zlibModule.createZstdDecompress === 'function';
const EXACT_VERSION = 'v22.14.0';
const APPLICABLE = RUNTIME === 'node' && process.version === EXACT_VERSION && !ZSTD_SYNC_PRESENT && !ZSTD_STREAM_PRESENT;
const ENV_PENDING_REASON = APPLICABLE
  ? null
  : `env-pending:runtime=${RUNTIME}:${RUNTIME_VERSION}:zstdDecompressSync=${ZSTD_SYNC_PRESENT}:createZstdDecompress=${ZSTD_STREAM_PRESENT}`;

const H1_ENTRY = RUNTIME === 'bun'
  ? await import('../src/platform/bun')
  : await import('../src/platform/node');
const H2_ENTRY = await import('../src/adapters/entries/http2');
const H1_ENTRY_PATH = RUNTIME === 'bun' ? 'src/platform/bun.ts' : 'src/platform/node.ts';
const H2_ENTRY_PATH = 'src/adapters/entries/http2.ts';

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function sourceSha256(relativePath: string): string {
  return sha256(nodeFs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url))));
}
function adapterNameOf(instance: unknown): string {
  const adapter = Reflect.get(Object(instance), 'adapter');
  return typeof adapter === 'function' ? adapter.name : typeof adapter;
}
const ENTRY_IDENTITY = Object.freeze({
  h1: { adapterName: adapterNameOf(H1_ENTRY.default.create({})), defaultKind: typeof H1_ENTRY.default, factory: typeof H1_ENTRY.default.create, path: H1_ENTRY_PATH, sourceSha256: sourceSha256(H1_ENTRY_PATH) },
  h2: { adapterName: adapterNameOf(H2_ENTRY.default.create({})), defaultKind: typeof H2_ENTRY.default, factory: typeof H2_ENTRY.default.create, path: H2_ENTRY_PATH, sourceSha256: sourceSha256(H2_ENTRY_PATH) },
});

// ------------------------------------------------------- pinned fixtures --
// F-PAY generator (identical to the R07 suite), then the RFC 8878 raw-block
// writer that reproduces `zstdCompressSync(F-PAY)` byte for byte: magic,
// FHD 0xA0 (Single_Segment + 4-byte FCS), FCS LE, Raw blocks of 128 KiB
// with Last_Block on the final one.
const PAYLOAD = (() => {
  const buffer = Buffer.allocUnsafe(262_144);
  let state = 0x12345678;
  for (let index = 0; index < buffer.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    buffer[index] = state >>> 24;
  }
  return buffer;
})();
function buildZstdRawFrame(payload: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0])];
  const frameContentSize = Buffer.alloc(4);
  frameContentSize.writeUInt32LE(payload.length, 0);
  parts.push(frameContentSize);
  const blockLimit = 128 * 1024;
  let offset = 0;
  do {
    const size = Math.min(blockLimit, payload.length - offset);
    const last = offset + size >= payload.length ? 1 : 0;
    const header = Buffer.alloc(3);
    header.writeUIntLE((size << 3) | last, 0, 3);
    parts.push(header, payload.subarray(offset, offset + size));
    offset += size;
  } while (offset < payload.length);
  return Buffer.concat(parts);
}
const Z_FULL = buildZstdRawFrame(PAYLOAD);
const Z_PREF = Z_FULL.subarray(0, 131_084);
const FIXTURE_PINS: ReadonlyArray<readonly [string, Buffer, number, string]> = [
  ['F-PAY', PAYLOAD, 262_144, 'd7cb0977f0db94fae6a83d9675043121ef7786f4ccfc8af5876af13712e3388e'],
  ['F-ZFULL', Z_FULL, 262_159, 'b89d52126599ef3ddc74d18792958079e0c230ac85f7addd3426195c1736d1f6'],
  ['F-ZPREF', Z_PREF, 131_084, '36fefb72cec301bd8ac8a4627601d7dd3d6324a1765a5d47f6623ab4cc0a123d'],
];
function assertFixturePins(): void {
  for (const [label, bytes, length, expected] of FIXTURE_PINS) {
    if (expected.length !== 64) throw new InfrastructureError(`${label} pin is not a full sha256`);
    if (bytes.length !== length) throw new InfrastructureError(`${label} length drift: ${bytes.length}`);
    const actual = sha256(bytes);
    if (actual !== expected) throw new InfrastructureError(`${label} sha drift: ${actual}`);
  }
}
const Z_FULL_SHA = FIXTURE_PINS[1][3];
const Z_PREF_SHA = FIXTURE_PINS[2][3];

// --------------------------------------------------------- frozen matrix --
interface HookTuple { afterHeaders: number; afterParse: number; afterResponse: number; beforeError: number; onAbort: number; onTimeout: number }
interface AutoCell { readonly id: RowId; readonly protocol: Protocol; readonly mode: Mode; readonly outcome: 'reject' | 'success'; readonly hooks: HookTuple }
// AUTO matrix (decompress default, F-ZFULL). Hook tuples per the frozen Q4
// table by NAMED field; two entries are AMENDED from the frozen prediction to
// the observed current-host contract (107-leg R07 GREEN-v2 table, Node and
// Bun): H1 stream/download SUCCESS fire afterParse 1, not 0 — the hook is
// zstd-independent, so the 22.14 runner must see the same value.
const AUTO_MATRIX: readonly AutoCell[] = [
  { id: 'CI-Q4-01', protocol: 'h1', mode: 'buffered', outcome: 'reject', hooks: { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-02', protocol: 'h1', mode: 'stream', outcome: 'success', hooks: { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-03', protocol: 'h1', mode: 'download', outcome: 'success', hooks: { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-04', protocol: 'h1', mode: 'upload', outcome: 'reject', hooks: { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-05', protocol: 'h2', mode: 'buffered', outcome: 'reject', hooks: { afterHeaders: 0, afterParse: 1, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-06', protocol: 'h2', mode: 'stream', outcome: 'success', hooks: { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-07', protocol: 'h2', mode: 'download', outcome: 'reject', hooks: { afterHeaders: 0, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
  { id: 'CI-Q4-08', protocol: 'h2', mode: 'upload', outcome: 'reject', hooks: { afterHeaders: 0, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 } },
];
// Bypass sweep hooks (`decompress:false`, F-ZPREF, all eight cells succeed):
// the observed current-host fulfilled tuples per protocol/mode.
const BYPASS_HOOKS: Readonly<Record<string, HookTuple>> = Object.freeze({
  'h1/buffered': { afterHeaders: 1, afterParse: 1, afterResponse: 1, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h1/download': { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h1/stream': { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h1/upload': { afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h2/buffered': { afterHeaders: 0, afterParse: 0, afterResponse: 1, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h2/download': { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h2/stream': { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
  'h2/upload': { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 },
});
const ALL_MODES: readonly Mode[] = ['buffered', 'stream', 'download', 'upload'];
const REGISTERED: readonly RowId[] = ['CI-Q4-01', 'CI-Q4-02', 'CI-Q4-03', 'CI-Q4-04', 'CI-Q4-05', 'CI-Q4-06', 'CI-Q4-07', 'CI-Q4-08', 'CI-Q4-09', 'CI-Q4-10'];
// Frozen per-leg event sequences (normalized: data/progress runs collapse to
// one `body` token, every other event keeps raw cardinality). EMPTY until the
// first real Node 22.14 discovery run freezes them in reviewed bytes; while
// empty the carrier runs in DISCOVERY epoch and classification stays pending.
const EXPECTED_SEQUENCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
});
// Independent literal physical-leg oracle (never derived from the matrix that
// drives execution): 8 AUTO + 8 bypass; CI-Q4-10 drives no wire of its own.
const EXPECTED_LEG_COUNT = 16;
const EXPECTED_LEG_KEYS_LITERAL: readonly string[] = Object.freeze([
  'CI-Q4-01:h1:buffered:auto', 'CI-Q4-02:h1:stream:auto', 'CI-Q4-03:h1:download:auto', 'CI-Q4-04:h1:upload:auto',
  'CI-Q4-05:h2:buffered:auto', 'CI-Q4-06:h2:stream:auto', 'CI-Q4-07:h2:download:auto', 'CI-Q4-08:h2:upload:auto',
  'CI-Q4-09:h1:buffered:bypass', 'CI-Q4-09:h1:stream:bypass', 'CI-Q4-09:h1:download:bypass', 'CI-Q4-09:h1:upload:bypass',
  'CI-Q4-09:h2:buffered:bypass', 'CI-Q4-09:h2:stream:bypass', 'CI-Q4-09:h2:download:bypass', 'CI-Q4-09:h2:upload:bypass',
]);
const EXPECTED_LEG_KEYS: readonly string[] = APPLICABLE ? EXPECTED_LEG_KEYS_LITERAL : [];
const CANONICAL = APPLICABLE && Object.keys(EXPECTED_SEQUENCES).length === EXPECTED_LEG_COUNT;
const EPOCH = !APPLICABLE ? 'env-pending' : CANONICAL ? 'green-v2' : 'discovery';
// Classification stays PENDING until the real archive/current runs freeze the
// RED/PASS map; only a canonical run labels targets/controls.
const REGISTRY = Object.freeze(CANONICAL
  ? { controls: ['CI-Q4-09'] as readonly RowId[], pending: [] as readonly RowId[], targets: ['CI-Q4-01', 'CI-Q4-02', 'CI-Q4-03', 'CI-Q4-04', 'CI-Q4-05', 'CI-Q4-06', 'CI-Q4-07', 'CI-Q4-08', 'CI-Q4-10'] as readonly RowId[] }
  : { controls: [] as readonly RowId[], pending: [...REGISTERED] as readonly RowId[], targets: [] as readonly RowId[] });

// ---------------------------------------------------------------- oracle --
const invocations = new Map<RowId, number>();
const passedRows = new Set<RowId>();
const redRows = new Set<RowId>();
const envPending: string[] = [];
const infrastructure: Record<string, unknown> = {};
const fixtureErrors: string[] = [];
const oracleMismatches: string[] = [];
const lateEvents: string[] = [];
const cleanupErrors: string[] = [];
const legs: Record<string, Snapshot & { encoding: string; protocol: Protocol; wireLength: number; wireSha256: string }> = {};
const fixtureEvents: string[] = [];
const activeServers = new Set<http.Server | http2.Http2Server>();
const activeSockets = new Set<net.Socket>();
const activeSessions = new Set<http2.ServerHttp2Session>();
const activeTimers = new Set<NodeJS.Timeout>();
const activeTemporaryDirectories = new Set<string>();
const forcedCleanup = { serversClosed: 0, sessionsDestroyed: 0, socketsClosedWithSessions: 0, socketsDestroyed: 0, temporaryDirectoriesRemoved: 0 };

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

const processFaults = { uncaught: 0, unhandled: 0 };
const onUncaught = (): void => { processFaults.uncaught += 1; };
const onUnhandled = (): void => { processFaults.unhandled += 1; };
process.on('uncaughtException', onUncaught);
process.on('unhandledRejection', onUnhandled);
let currentRow: RowId | null = null;
function normalizeSequence(sequence: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const entry of sequence) {
    if (/^(data|progress)(x\d+)?$/.test(entry)) { if (normalized[normalized.length - 1] !== 'body') normalized.push('body'); continue; }
    normalized.push(entry);
  }
  return normalized;
}

async function observeRow(id: RowId, body: () => Promise<void>): Promise<void> {
  if (invocations.has(id)) throw new InfrastructureError(`duplicate row invocation ${id}`);
  invocations.set(id, 1);
  currentRow = id;
  if (!APPLICABLE) {
    // ENV-PENDING: neither passed nor skipped until executed on the runner.
    envPending.push(`${id}:${ENV_PENDING_REASON}`);
    return;
  }
  try {
    await body();
    passedRows.add(id);
  } catch (error) {
    if (error instanceof InfrastructureError) { fixtureErrors.push(`${id}:${error.message}`); throw error; }
    redRows.add(id);
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { activeTimers.delete(timer); resolve(); }, milliseconds);
    activeTimers.add(timer);
  });
}
function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { if (timer) activeTimers.delete(timer); reject(new InfrastructureError(label)); }, milliseconds);
    activeTimers.add(timer);
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) { clearTimeout(timer); activeTimers.delete(timer); } });
}

// Vitest fork/VM services serve neither loader strategy inside getFS(), so
// download legs install the pair-approved literal-node:fs require bridge
// exactly as the R07 suite does (runtime-conditional, fail-closed restore).
function installNodeRequireBridge(): { restore(): void } {
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
  if (priorDescriptor !== undefined) throw new InfrastructureError('require bridge found an unexpected own descriptor');
  const nodeRequire = (specifier: string): unknown => {
    if (specifier !== 'node:fs') throw new InfrastructureError(`require bridge rejected ${specifier}`);
    return nodeFs;
  };
  Object.defineProperty(globalThis, 'require', { configurable: true, enumerable: false, value: nodeRequire, writable: false });
  return {
    restore(): void {
      if (!Reflect.deleteProperty(globalThis, 'require')) throw new InfrastructureError('failed to delete the require bridge');
      if (Object.getOwnPropertyDescriptor(globalThis, 'require') !== undefined) throw new InfrastructureError('require descriptor was not restored exactly');
    },
  };
}

function collapseEvents(sequence: readonly string[]): string[] {
  // Only data/progress chunk runs are run-length encoded; every other event
  // is one token per occurrence so duplicates stay visible.
  const collapsed: string[] = [];
  let previous: string | null = null;
  let run = 0;
  const flush = (): void => { if (previous !== null) collapsed.push(run > 1 ? `${previous}x${run}` : previous); };
  for (const name of sequence) {
    if (name === 'data' || name === 'progress') { if (name === previous) { run += 1; continue; } flush(); previous = name; run = 1; continue; }
    flush(); previous = null; run = 0; collapsed.push(name);
  }
  flush();
  return collapsed;
}
function assertNormalizerKeepsCardinality(): void {
  const collapsed = collapseEvents(['end', 'end', 'data', 'data', 'data', 'progress', 'finish', 'close', 'close']);
  if (JSON.stringify(collapsed) !== JSON.stringify(['end', 'end', 'datax3', 'progress', 'finish', 'close', 'close'])) throw new InfrastructureError(`collapseEvents drift: ${JSON.stringify(collapsed)}`);
  const normalized = normalizeSequence(collapsed);
  if (JSON.stringify(normalized) !== JSON.stringify(['end', 'end', 'body', 'finish', 'close', 'close'])) throw new InfrastructureError(`normalizeSequence drift: ${JSON.stringify(normalized)}`);
}

// ----------------------------------------------------------------- wires --
interface WireCase {
  readonly body: Buffer;
  readonly encoding: 'zstd';
  readonly legLabel: string;
  readonly mode: Mode;
  readonly options?: Record<string, unknown>;
  readonly protocol: Protocol;
}
interface Snapshot {
  readonly bodySha256: string | null;
  readonly bodyLength: number | null;
  readonly clientNaturalAtCaseEnd: ClientPoolSnapshot;
  readonly code: unknown;
  readonly errno: unknown;
  readonly errorEvents: number;
  readonly errorName: string | null;
  readonly errorStatus: unknown;
  readonly eventSequence: string[];
  readonly fileState: { exists: boolean; sha256: string; length: number } | null;
  readonly hasCause: boolean | null;
  readonly hasResponse: boolean | null;
  readonly hooks: HookTuple;
  readonly isFinished: boolean | null;
  readonly isNetworkError: unknown;
  readonly isRetryable: unknown;
  readonly isRezoError: boolean | null;
  readonly isTimeout: unknown;
  readonly message: unknown;
  readonly mode: Mode;
  readonly naturalAtCaseEnd: { sessions: number; sockets: number; temporaryDirectories: number; timers: number };
  readonly responseBodyLength: number | null;
  readonly responseBodySha256: string | null;
  readonly stable: boolean;
  readonly status: unknown;
  readonly streamSha256: string | null;
  readonly streamLength: number | null;
  readonly successEvents: number;
  readonly successOrder: string[];
  readonly terminal: Terminal;
  readonly uploadDoneKeys: string[] | null;
  readonly wireHits: number;
}

async function runWireCase(wire: WireCase): Promise<Snapshot> {
  const events: string[] = [];
  const counts: HookTuple = { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 };
  const hooks: Partial<RezoHooks> = {
    afterHeaders: [() => { counts.afterHeaders += 1; events.push('hook:afterHeaders'); }],
    afterParse: [(event) => { counts.afterParse += 1; events.push('hook:afterParse'); return event.data; }],
    afterResponse: [(response) => { counts.afterResponse += 1; events.push('hook:afterResponse'); return response; }],
    beforeError: [(error) => { counts.beforeError += 1; events.push('hook:beforeError'); return error; }],
    onAbort: [() => { counts.onAbort += 1; events.push('hook:onAbort'); }],
    onTimeout: [() => { counts.onTimeout += 1; events.push('hook:onTimeout'); }],
  };
  const headers: Record<string, string> = {
    'content-encoding': wire.encoding,
    'content-length': String(wire.body.length),
    'content-type': 'application/octet-stream',
  };
  // Server-side hit counter: one wire means exactly one request/stream
  // reached the fixture (retry:false). Every server-side error is recorded;
  // all Q4 wires respond fully, so any fixture error is an oracle mismatch.
  let wireHits = 0;
  let hitsAtSnapshot = -1;
  const recordFixtureEvent = (kind: string, error: unknown): void => { fixtureEvents.push(`${wire.legLabel}:${kind}:${String(Reflect.get(Object(error), 'code') ?? Reflect.get(Object(error), 'message'))}`); };
  let server: http.Server | http2.Http2Server;
  if (wire.protocol === 'h1') {
    server = http.createServer((request, response) => {
      wireHits += 1;
      request.resume();
      request.once('end', () => { response.writeHead(200, headers); response.end(wire.body); });
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
      const respond = (): void => { stream.respond({ ':status': 200, ...headers }); stream.end(wire.body); };
      if (requestHeaders[':method'] === 'GET' || requestHeaders[':method'] === 'HEAD') respond();
      else { stream.resume(); stream.once('end', respond); }
    });
    server = h2server;
  }
  let listenReject: ((error: Error) => void) | null = null;
  server.on('error', (error: Error) => { if (listenReject !== null) listenReject(error); else recordFixtureEvent('server', error); });
  try {
    await within(new Promise<void>((resolve, reject) => {
      listenReject = reject;
      server.listen(0, '127.0.0.1', () => { listenReject = null; resolve(); });
    }), 2_000, 'q4 fixture failed to listen');
  } catch (error) {
    listenReject = null;
    server.close();
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
  if (address === null || typeof address === 'string') throw new InfrastructureError('q4 fixture had no port');
  const url = `http://127.0.0.1:${address.port}/q4-${wire.protocol}-${wire.mode}`;
  const client = (wire.protocol === 'h1' ? H1_ENTRY.default : H2_ENTRY.default).create({});
  if (wire.protocol === 'h1') h1PoolTouched = true; else h2PoolTouched = true;
  const baseOptions = { cache: false, hooks, retry: false, ...(wire.options ?? {}) };

  let terminal: Terminal = 'pending';
  let outcomeValue: unknown = null;
  let outcomeError: unknown = null;
  let temporaryDirectory: string | undefined;
  let temporaryFile: string | undefined;
  let requireBridge: { restore(): void } | undefined;
  let facadeRef: { isFinished?: () => boolean } | null = null;
  const streamChunks: Buffer[] = [];
  const successOrder: string[] = [];
  try {
    if (wire.mode === 'buffered') {
      try {
        outcomeValue = await within(client.get(url, { ...baseOptions, responseType: 'buffer' }), 8_000, 'buffered case hung');
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
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'rezo-q4-'));
        activeTemporaryDirectories.add(temporaryDirectory);
        temporaryFile = join(temporaryDirectory, 'target.bin');
        if (await getFS() === undefined) {
          requireBridge = installNodeRequireBridge();
          if (await getFS() === undefined) throw new InfrastructureError('require bridge did not restore fs loading');
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
        for (const name of ['initiated', 'start', 'headers', 'status', 'cookies', 'redirect', 'progress', 'end', 'close'] as const) facade.on(name, () => { events.push(name); });
        facade.on('error', finish('rejected'));
        facade.on('done', (value: unknown) => { events.push('done'); successOrder.push('done'); outcomeValue = value; finish('fulfilled')(value); });
        facade.on('finish', () => { events.push('finish'); successOrder.push('finish'); });
        facade.on('complete', () => { events.push('complete'); successOrder.push('complete'); });
        facade.on('data', (chunk: unknown) => { events.push('data'); if (Buffer.isBuffer(chunk)) streamChunks.push(Buffer.from(chunk)); else if (chunk instanceof Uint8Array) streamChunks.push(Buffer.from(chunk)); });
      });
      await within(settled, 10_000, `${wire.protocol}/${wire.mode} facade did not settle`);
    }
    await delay(150);
    const before = JSON.stringify({ counts, events, terminal, processFaults });
    await delay(100);
    const after = JSON.stringify({ counts, events, terminal, processFaults });
    if (before !== after) lateEvents.push(`${currentRow}:${wire.legLabel}:${before}->${after}`);

    const toBuffer = (data: unknown): Buffer | null => {
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof Uint8Array) return Buffer.from(data);
      if (data instanceof ArrayBuffer) return Buffer.from(data);
      if (typeof data === 'string') return Buffer.from(data);
      return null;
    };
    const bodyBuffer = terminal === 'fulfilled' && wire.mode === 'buffered' ? toBuffer(Reflect.get(Object(outcomeValue), 'data')) : null;
    let fileState: Snapshot['fileState'] = null;
    if (temporaryFile !== undefined) {
      try {
        const fileBytes = await readFile(temporaryFile);
        fileState = { exists: true, sha256: sha256(fileBytes), length: fileBytes.length };
      } catch (error) {
        // Only ENOENT proves absence; any other read failure is infrastructure.
        if (Reflect.get(Object(error), 'code') !== 'ENOENT') throw new InfrastructureError(`target read failed: ${String(error)}`);
        fileState = { exists: false, sha256: '', length: 0 };
      }
    }
    const field = (name: string): unknown => terminal === 'rejected' ? Reflect.get(Object(outcomeError), name) : null;
    const response = terminal === 'rejected' ? Reflect.get(Object(outcomeError), 'response') : undefined;
    const responseBody = terminal === 'rejected' ? toBuffer(Reflect.get(Object(response), 'data')) : null;
    const stream = streamChunks.length > 0 ? Buffer.concat(streamChunks) : null;
    const snapshot: Snapshot = {
      bodySha256: bodyBuffer === null ? null : sha256(bodyBuffer),
      bodyLength: bodyBuffer === null ? null : bodyBuffer.length,
      clientNaturalAtCaseEnd: snapshotClientPools(),
      code: field('code'),
      errno: field('errno'),
      errorEvents: events.filter((event) => event === 'error').length,
      errorName: terminal === 'rejected' ? String(field('name') ?? '') : null,
      errorStatus: field('status'),
      eventSequence: collapseEvents(events),
      fileState,
      hasCause: terminal === 'rejected' ? field('cause') !== undefined : null,
      hasResponse: terminal === 'rejected' ? response !== undefined && response !== null : null,
      hooks: { ...counts },
      isFinished: facadeRef !== null && typeof facadeRef.isFinished === 'function' ? facadeRef.isFinished() : null,
      isNetworkError: field('isNetworkError'),
      isRetryable: field('isRetryable'),
      isRezoError: terminal === 'rejected' ? outcomeError instanceof RezoError : null,
      isTimeout: field('isTimeout'),
      message: field('message'),
      mode: wire.mode,
      naturalAtCaseEnd: { sessions: activeSessions.size, sockets: activeSockets.size, temporaryDirectories: activeTemporaryDirectories.size, timers: activeTimers.size },
      responseBodyLength: responseBody === null ? null : responseBody.length,
      responseBodySha256: responseBody === null ? null : sha256(responseBody),
      stable: before === after,
      status: terminal === 'fulfilled' ? Reflect.get(Object(outcomeValue), 'status') ?? null : (Reflect.get(Object(response), 'status') ?? null),
      streamSha256: stream === null ? null : sha256(stream),
      streamLength: stream === null ? null : stream.length,
      successEvents: events.filter((event) => event === 'finish' || event === 'done' || event === 'complete').length,
      successOrder: [...successOrder],
      terminal,
      uploadDoneKeys: wire.mode === 'upload' && terminal === 'fulfilled' && outcomeValue !== null && typeof outcomeValue === 'object' ? Object.keys(outcomeValue as object).sort() : null,
      wireHits,
    };
    const legId = `${currentRow ?? 'INFRA'}:${wire.legLabel}`;
    if (Object.hasOwn(legs, legId)) throw new InfrastructureError(`duplicate leg id ${legId}`);
    hitsAtSnapshot = wireHits;
    if (currentRow !== null) legs[legId] = { ...snapshot, encoding: wire.encoding, protocol: wire.protocol, wireLength: wire.body.length, wireSha256: sha256(wire.body) };
    return snapshot;
  } finally {
    try { requireBridge?.restore(); } catch (error) { cleanupErrors.push(`bridge:${String(error)}`); }
    // Destroy, then AWAIT closure (bounded) before each handle leaves its set.
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
    for (const session of [...activeSessions]) { if (!activeSessions.has(session)) continue; forcedCleanup.sessionsDestroyed += 1; const closed = awaitClose(session, 'session'); session.destroy(); await closed; activeSessions.delete(session); }
    forcedCleanup.socketsClosedWithSessions += socketsBeforeSessions - activeSockets.size;
    for (const socket of [...activeSockets]) { if (!activeSockets.has(socket)) continue; forcedCleanup.socketsDestroyed += 1; const closed = awaitClose(socket, 'socket'); socket.destroy(); await closed; activeSockets.delete(socket); }
    await within(new Promise<void>((resolve) => { forcedCleanup.serversClosed += 1; server.close(() => resolve()); }), 3_000, 'q4 fixture server did not close').catch((error) => { cleanupErrors.push(String(error)); });
    // Live hit counter re-read after the wire's bounded close: a late hit is an oracle failure.
    if (hitsAtSnapshot !== -1 && wireHits !== hitsAtSnapshot) oracleMismatches.push(`late-hit:${wire.protocol}/${wire.mode}/${wire.legLabel}:${wireHits}!==${hitsAtSnapshot}`);
    if (temporaryDirectory !== undefined) {
      forcedCleanup.temporaryDirectoriesRemoved += 1;
      await rm(temporaryDirectory, { force: true, recursive: true });
      activeTemporaryDirectories.delete(temporaryDirectory);
    }
  }
}

// ------------------------------------------------------------- contracts --
// Contract item 8 + Q4 asymmetry: every unavailability rejection.
function expectUnavailabilityRejection(snapshot: Snapshot, cell: AutoCell): void {
  expect(snapshot.terminal).toBe('rejected');
  expect(snapshot.wireHits).toBe(1);
  expect(snapshot.code).toBe('REZ_DECOMPRESSION_ERROR');
  expect(snapshot.errno).toBe(-1029);
  expect(snapshot.message).toBe('Decompression failed');
  expect(snapshot.errorName).toBe('RezoError');
  expect(snapshot.isNetworkError).toBe(false);
  expect(snapshot.isTimeout).toBe(false);
  expect(snapshot.isRetryable).toBe(false);
  expect(snapshot.isRezoError).toBe(true);
  expect(snapshot.hasResponse).toBe(true);
  // Contract item 8: `status` AND `response.status` are 200, independently.
  expect(snapshot.errorStatus).toBe(200);
  expect(snapshot.status).toBe(200);
  expect(snapshot.hooks).toEqual(cell.hooks);
  expect(snapshot.successEvents).toBe(0);
  expect(snapshot.errorEvents).toBe(cell.mode === 'buffered' ? 0 : 1);
  expect(snapshot.isFinished).toBe(cell.mode === 'buffered' ? null : false);
  expect(snapshot.bodySha256).toBeNull();
  expect(snapshot.stable).toBe(true);
  // Response-body asymmetry preserved, never normalized: H1 carries ZERO
  // decoded bytes (an empty body, never an absent one); H2 carries the
  // EXACT encoded body.
  if (cell.protocol === 'h1') expect(snapshot.responseBodyLength).toBe(0);
  else { expect(snapshot.responseBodySha256).toBe(Z_FULL_SHA); expect(snapshot.responseBodyLength).toBe(Z_FULL.length); }
}
function expectRawSuccess(snapshot: Snapshot, cell: AutoCell): void {
  expect(snapshot.terminal).toBe('fulfilled');
  expect(snapshot.wireHits).toBe(1);
  expect(snapshot.code).toBeNull();
  expect(snapshot.status).toBe(200);
  expect(snapshot.hooks).toEqual(cell.hooks);
  expect(snapshot.successOrder).toEqual(['finish', 'done', 'complete']);
  expect(snapshot.successEvents).toBe(3);
  expect(snapshot.errorEvents).toBe(0);
  expect(snapshot.isFinished).toBe(true);
  expect(snapshot.stable).toBe(true);
  if (cell.mode === 'stream') { expect(snapshot.streamSha256).toBe(Z_FULL_SHA); expect(snapshot.streamLength).toBe(Z_FULL.length); }
  if (cell.mode === 'download') { expect(snapshot.fileState?.exists).toBe(true); expect(snapshot.fileState?.sha256).toBe(Z_FULL_SHA); expect(snapshot.fileState?.length).toBe(Z_FULL.length); }
}

const autoSnapshots = new Map<RowId, Snapshot>();

// ------------------------------------------------------------------ rows --
for (const cell of AUTO_MATRIX) {
  it(`${cell.id} AUTO ${cell.protocol} ${cell.mode} ${cell.outcome === 'reject' ? 'rejects structurally' : 'succeeds exact raw'} (Node 22.14, zstd absent)`, async () => {
    await observeRow(cell.id, async () => {
      const snapshot = await runWireCase({ body: Z_FULL, encoding: 'zstd', legLabel: `${cell.protocol}:${cell.mode}:auto`, mode: cell.mode, protocol: cell.protocol });
      autoSnapshots.set(cell.id, snapshot);
      if (cell.outcome === 'reject') {
        expectUnavailabilityRejection(snapshot, cell);
        if (cell.mode === 'download') expect(snapshot.fileState?.exists).toBe(false);
      } else {
        expectRawSuccess(snapshot, cell);
      }
    });
  });
}

it('CI-Q4-09 decompress:false x8 truncated-bypass sweep succeeds exact raw', async () => {
  await observeRow('CI-Q4-09', async () => {
    for (const protocol of ['h1', 'h2'] as const) {
      for (const mode of ALL_MODES) {
        const snapshot = await runWireCase({ body: Z_PREF, encoding: 'zstd', legLabel: `${protocol}:${mode}:bypass`, mode, options: { decompress: false }, protocol });
        expect(snapshot.terminal).toBe('fulfilled');
        expect(snapshot.wireHits).toBe(1);
        expect(snapshot.code).toBeNull();
        expect(snapshot.hooks).toEqual(BYPASS_HOOKS[`${protocol}/${mode}`]);
        expect(snapshot.stable).toBe(true);
        if (mode === 'buffered') { expect(snapshot.status).toBe(200); expect(snapshot.bodySha256).toBe(Z_PREF_SHA); expect(snapshot.bodyLength).toBe(Z_PREF.length); }
        else if (mode === 'stream') { expect(snapshot.status).toBe(200); expect(snapshot.streamSha256).toBe(Z_PREF_SHA); expect(snapshot.streamLength).toBe(Z_PREF.length); }
        else if (mode === 'download') { expect(snapshot.status).toBe(200); expect(snapshot.fileState?.sha256).toBe(Z_PREF_SHA); expect(snapshot.fileState?.length).toBe(Z_PREF.length); }
        // Upload: the facade's done payload exposes no response body and no
        // status today (keys recorded); the raw-exact claim is narrowed in
        // governance to lifecycle + zero errors for this cell.
        else { expect(snapshot.status).toBeNull(); expect(snapshot.uploadDoneKeys).not.toBeNull(); }
        if (mode !== 'buffered') { expect(snapshot.successOrder).toEqual(['finish', 'done', 'complete']); expect(snapshot.errorEvents).toBe(0); expect(snapshot.isFinished).toBe(true); }
      }
    }
  });
});

it('CI-Q4-10 unavailability error-field/asymmetry contract over the five rejecting AUTO cells', async () => {
  await observeRow('CI-Q4-10', async () => {
    const rejecting = AUTO_MATRIX.filter((cell) => cell.outcome === 'reject');
    expect(rejecting.map((cell) => cell.id)).toEqual(['CI-Q4-01', 'CI-Q4-04', 'CI-Q4-05', 'CI-Q4-07', 'CI-Q4-08']);
    for (const cell of rejecting) {
      const snapshot = autoSnapshots.get(cell.id);
      if (snapshot === undefined) throw new InfrastructureError(`${cell.id} observation missing for CI-Q4-10`);
      expectUnavailabilityRejection(snapshot, cell);
      expect(snapshot.hasCause).toBe(false);
    }
    const h1 = autoSnapshots.get('CI-Q4-01');
    const h2 = autoSnapshots.get('CI-Q4-05');
    expect(h1?.responseBodyLength ?? 0).toBe(0);
    expect(h2?.responseBodySha256).toBe(Z_FULL_SHA);
  });
});

// ------------------------------------------ unregistered infrastructure --
// Current-host plumbing proofs: never Q4 rows, never counted, reported under
// `infrastructure` in the ledger so a plumbing regression is still visible.
it('infrastructure: pinned fixtures, entry factories, wire engine, bypass engine', async () => {
  currentRow = null;
  assertFixturePins();
  assertNormalizerKeepsCardinality();
  // Matrix-vs-literal drift check: the executing matrix must reproduce the
  // independent literal oracle exactly (and never drive the expectation).
  const derivedKeys = [
    ...AUTO_MATRIX.map((cell) => `${cell.id}:${cell.protocol}:${cell.mode}:auto`),
    ...(['h1', 'h2'] as const).flatMap((protocol) => ALL_MODES.map((mode) => `CI-Q4-09:${protocol}:${mode}:bypass`)),
  ];
  expect(derivedKeys).toEqual([...EXPECTED_LEG_KEYS_LITERAL]);
  expect(EXPECTED_LEG_KEYS_LITERAL).toHaveLength(EXPECTED_LEG_COUNT);
  infrastructure.fixturePins = FIXTURE_PINS.map(([label, bytes, length]) => ({ label, length, sha256: sha256(bytes) }));
  if (ZSTD_SYNC_PRESENT) {
    const decoded = (zlibModule.zstdDecompressSync as (input: Buffer) => Buffer)(Z_FULL);
    infrastructure.handBuiltFrameRoundTrip = sha256(decoded) === FIXTURE_PINS[0][3];
    expect(infrastructure.handBuiltFrameRoundTrip).toBe(true);
  } else {
    infrastructure.handBuiltFrameRoundTrip = 'n/a';
  }
  expect(ENTRY_IDENTITY.h1.factory).toBe('function');
  expect(ENTRY_IDENTITY.h2.factory).toBe('function');
  const engine: Record<string, unknown> = {};
  if (APPLICABLE) {
    // On the applicable host no extra wire is driven: the registered AUTO
    // stream observations already prove the raw engine.
    for (const id of ['CI-Q4-02', 'CI-Q4-06'] as const) {
      const observed = autoSnapshots.get(id);
      engine[id] = observed === undefined ? 'missing' : { terminal: observed.terminal, streamSha256: observed.streamSha256 };
    }
    infrastructure.wiresDriven = 0;
  } else {
    for (const protocol of ['h1', 'h2'] as const) {
      const raw = await runWireCase({ body: Z_FULL, encoding: 'zstd', legLabel: `${protocol}:stream:infra`, mode: 'stream', protocol });
      engine[`${protocol}/stream/raw`] = { terminal: raw.terminal, streamSha256: raw.streamSha256, hooks: raw.hooks, eventSequence: raw.eventSequence, wireHits: raw.wireHits };
      expect(raw.terminal).toBe('fulfilled');
      expect(raw.wireHits).toBe(1);
      expect(raw.streamSha256).toBe(Z_FULL_SHA);
      const bypass = await runWireCase({ body: Z_PREF, encoding: 'zstd', legLabel: `${protocol}:buffered:infra`, mode: 'buffered', options: { decompress: false }, protocol });
      engine[`${protocol}/buffered/bypass`] = { terminal: bypass.terminal, bodySha256: bypass.bodySha256, hooks: bypass.hooks, wireHits: bypass.wireHits };
      expect(bypass.terminal).toBe('fulfilled');
      expect(bypass.wireHits).toBe(1);
      expect(bypass.bodySha256).toBe(Z_PREF_SHA);
    }
    infrastructure.wiresDriven = 4;
  }
  infrastructure.engine = engine;
});

// ---------------------------------------------------------------- ledger --
afterAll(() => {
  const clientPools = forcedPoolTeardown();
  oracleMismatches.push(...clientPools.naturalProblems);
  process.off('uncaughtException', onUncaught);
  process.off('unhandledRejection', onUnhandled);
  const listeners = listenerDelta();
  if (listeners.length > 0) oracleMismatches.push(`listeners:${listeners.join(',')}`);
  for (const id of REGISTERED) {
    if ((invocations.get(id) ?? 0) !== 1) oracleMismatches.push(`invocations:${id}:${invocations.get(id) ?? 0}`);
  }
  const legKeys = Object.keys(legs).sort();
  const missingKeys = EXPECTED_LEG_KEYS.filter((key) => !legKeys.includes(key));
  const extraKeys = legKeys.filter((key) => !EXPECTED_LEG_KEYS.includes(key));
  if (missingKeys.length > 0) oracleMismatches.push(`legs-missing:${JSON.stringify(missingKeys)}`);
  if (extraKeys.length > 0) oracleMismatches.push(`legs-extra:${JSON.stringify(extraKeys)}`);
  const naturalMax = { sessions: 0, sockets: 0, temporaryDirectories: 0, timers: 0 };
  for (const [legId, leg] of Object.entries(legs)) {
    if (leg.naturalAtCaseEnd.timers !== 0) oracleMismatches.push(`natural-timers:${legId}:${leg.naturalAtCaseEnd.timers}`);
    for (const key of Object.keys(naturalMax) as Array<keyof typeof naturalMax>) naturalMax[key] = Math.max(naturalMax[key], leg.naturalAtCaseEnd[key]);
    if (leg.wireHits !== 1) oracleMismatches.push(`wire-hits:${legId}:${leg.wireHits}`);
    const pools = leg.clientNaturalAtCaseEnd;
    if (pools.h1 !== null && (pools.h1.queuedRequests !== 0 || pools.h1.activeSockets !== 0 || pools.h1.agents !== 1 || pools.h1.agentShape !== 'node' || pools.h1.evictionTimer !== 'unref')) oracleMismatches.push(`client-h1:${legId}:${JSON.stringify(pools.h1)}`);
    if (pools.h2 !== null && (pools.h2.pending !== 0 || pools.h2.leases !== 0 || pools.h2.entries !== pools.h2.sessions || pools.h2.unhealthy !== 0 || pools.h2.states.retired !== 0 || pools.h2.states.closed !== 0 || pools.h2.states.reusable !== pools.h2.sessions || pools.h2.cleanupInterval !== 'unref')) oracleMismatches.push(`client-h2:${legId}:${JSON.stringify(pools.h2)}`);
    if (CANONICAL) {
      const expectedSequence = EXPECTED_SEQUENCES[legId];
      if (expectedSequence === undefined) oracleMismatches.push(`sequence-unfrozen:${legId}`);
      else if (JSON.stringify(normalizeSequence(leg.eventSequence)) !== JSON.stringify(expectedSequence)) oracleMismatches.push(`sequence:${legId}:${JSON.stringify(normalizeSequence(leg.eventSequence))}`);
    }
  }
  if (fixtureEvents.length > 0) oracleMismatches.push(`fixture-events:${JSON.stringify(fixtureEvents)}`);
  if (APPLICABLE) {
    const h2LegCount = Object.values(legs).filter((leg) => leg.protocol === 'h2').length;
    const downloadLegCount = Object.values(legs).filter((leg) => leg.mode === 'download').length;
    const legCount = Object.keys(legs).length;
    if (forcedCleanup.serversClosed !== legCount || forcedCleanup.socketsDestroyed + forcedCleanup.socketsClosedWithSessions !== legCount || forcedCleanup.sessionsDestroyed !== h2LegCount || forcedCleanup.temporaryDirectoriesRemoved !== downloadLegCount) oracleMismatches.push(`forced:${JSON.stringify(forcedCleanup)}`);
  }
  if (clientPools.h1After !== null && (clientPools.h1After.evictionTimer !== 'null' || clientPools.h1After.agents !== 0 || clientPools.h1After.activeSockets + clientPools.h1After.freeSockets + clientPools.h1After.queuedRequests !== 0)) oracleMismatches.push(`client-h1-after:${JSON.stringify(clientPools.h1After)}`);
  if (clientPools.h2After !== null && (clientPools.h2After.cleanupInterval !== 'null' || clientPools.h2After.sessions + clientPools.h2After.entries + clientPools.h2After.pending + clientPools.h2After.leases + clientPools.h2After.states.reusable + clientPools.h2After.states.retired + clientPools.h2After.states.closed !== 0)) oracleMismatches.push(`client-h2-after:${JSON.stringify(clientPools.h2After)}`);
  const expectedPending = APPLICABLE ? 0 : REGISTERED.length;
  if (envPending.length !== expectedPending) oracleMismatches.push(`env-pending:${envPending.length}!==${expectedPending}`);
  if (APPLICABLE && passedRows.size + redRows.size !== REGISTERED.length) oracleMismatches.push(`rows-unaccounted:${passedRows.size + redRows.size}!==${REGISTERED.length}`);
  const registryUnion = [...REGISTRY.targets, ...REGISTRY.controls, ...REGISTRY.pending].sort();
  if (JSON.stringify(registryUnion) !== JSON.stringify([...REGISTERED].sort())) oracleMismatches.push(`registry:${JSON.stringify(registryUnion)}`);
  if (REGISTRY.targets.some((id) => REGISTRY.controls.includes(id) || REGISTRY.pending.includes(id))) oracleMismatches.push('registry-overlap');
  const ledger = {
    applicable: APPLICABLE,
    canonical: CANONICAL,
    cleanup: {
      complete: cleanupErrors.length === 0 && activeServers.size === 0 && activeSockets.size === 0 && activeSessions.size === 0 && activeTimers.size === 0 && activeTemporaryDirectories.size === 0 && naturalMax.timers === 0,
      endState: { servers: activeServers.size, sessions: activeSessions.size, sockets: activeSockets.size, temporaryDirectories: activeTemporaryDirectories.size, timers: activeTimers.size },
      forced: { ...forcedCleanup },
      naturalMax,
    },
    cleanupErrors,
    clientPools: { endState: { h1: clientPools.h1After, h2: clientPools.h2After }, forced: clientPools },
    entryIdentity: ENTRY_IDENTITY,
    envPending: [...envPending].sort(),
    envPendingReason: ENV_PENDING_REASON,
    epoch: EPOCH,
    exactVersion: EXACT_VERSION,
    expectedLegCount: EXPECTED_LEG_KEYS.length,
    expectedLegKeys: [...EXPECTED_LEG_KEYS],
    file: FILE,
    fixture: { fullFrameSha256: Z_FULL_SHA, payloadSha256: FIXTURE_PINS[0][3], truncatedFrameSha256: Z_PREF_SHA },
    fixtureErrors,
    fixtureEvents,
    infrastructure,
    lateEvents,
    legCount: legKeys.length,
    legs,
    oracleMismatches,
    passed: [...passedRows].sort(),
    processFaults: { ...processFaults },
    red: [...redRows].sort(),
    registered: [...invocations.keys()].sort(),
    registry: REGISTRY,
    runtime: RUNTIME,
    runtimeVersion: RUNTIME_VERSION,
    schema: 'rezo.r07.q4.ledger/v1',
    zstd: { createZstdDecompress: ZSTD_STREAM_PRESENT, zstdDecompressSync: ZSTD_SYNC_PRESENT },
  };
  const ledgerLine = `REZO_R07_Q4_LEDGER_V1:${JSON.stringify(ledger)}`;
  console.log(ledgerLine);
  const ledgerFile = process.env.REZO_R07_Q4_LEDGER_FILE;
  if (ledgerFile !== undefined && ledgerFile !== '') {
    try {
      nodeFs.writeFileSync(ledgerFile, `${ledgerLine}\n`, { encoding: 'utf-8', flag: 'w' });
    } catch (error) {
      fixtureErrors.push(`ledger-file:${String(error)}`);
    }
  }
  const failures: string[] = [];
  if (oracleMismatches.length > 0) failures.push(`oracle:${oracleMismatches.join('|')}`);
  if (fixtureErrors.length > 0) failures.push(`fixture:${fixtureErrors.length}`);
  if (cleanupErrors.length > 0) failures.push(`cleanup-errors:${cleanupErrors.length}`);
  if (lateEvents.length > 0) failures.push(`late-events:${lateEvents.length}`);
  if (!ledger.cleanup.complete) failures.push('cleanup-incomplete');
  if (processFaults.uncaught !== 0 || processFaults.unhandled !== 0) failures.push('process-faults');
  if (failures.length > 0) throw new InfrastructureError(`R07 Q4 ledger rejected: ${failures.join('; ')}`);
});
