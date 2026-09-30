import { afterAll, expect, it } from 'vitest';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';
import { zstdCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RezoHooks } from '../src/core/hooks';
import { RezoError } from '../src/errors/rezo-error';
import { executeRequest as httpExecuteRequest } from '../src/adapters/http';
import { executeRequest as http2ExecuteRequest } from '../src/adapters/http2';
import { getGlobalAgentPool, resetGlobalAgentPool } from '../src/utils/agent-pool';

// R10-1 RED suite: stream terminal contract under transport truncation.
// Banked dual-runtime probe (r10-stream-terminal.mts, 2026-08-18): h2c
// advertises content-length 1000, writes a 4-byte prefix, destroys the
// stream — the public stream facade delivers 4 bytes then emits a full
// finish/done/complete success trio with ZERO error on Node and Bun.
// HTTP/1 under the same wire errors exactly once (ECONNRESET, no
// success). ST-01 freezes that violation; ST-02..04 are controls.

const RUNTIME: 'node' | 'bun' = typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' ? 'node' : 'bun';
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
  return createHash('sha256').update(nodeFs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)))).digest('hex');
}
function adapterIdentityOf(instance: unknown): 'http' | 'http2' | 'unknown' {
  const adapter = Reflect.get(Object(instance), 'adapter');
  if (adapter === httpExecuteRequest) return 'http';
  if (adapter === http2ExecuteRequest) return 'http2';
  return 'unknown';
}
// Entry identity is an OBSERVATION, never a label: entry source bytes hashed
// at runtime plus the adapter function each captured default closes over.
// The captured default is the callable request shorthand (a function wrapper
// over the instance), so the adapter is observed on a client produced by its
// `.create()` factory — the exact construction path every leg uses.
const ENTRY_IDENTITY = Object.freeze({
  h1: { adapter: adapterIdentityOf(H1_ENTRY.default.create({})), defaultKind: typeof H1_ENTRY.default, factory: typeof H1_ENTRY.default.create, path: H1_ENTRY_PATH, sourceSha256: sourceSha256(H1_ENTRY_PATH) },
  h2: { adapter: adapterIdentityOf(H2_ENTRY.default.create({})), defaultKind: typeof H2_ENTRY.default, factory: typeof H2_ENTRY.default.create, path: H2_ENTRY_PATH, sourceSha256: sourceSha256(H2_ENTRY_PATH) },
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
// (R10 registers its own two process listeners below; they are removed in
// afterAll before the delta is computed.)
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

// Frozen physical-leg key set: nine wires per runtime, identical on Node and
// Bun. Any missing, extra, or renamed leg fails the file closed.
const EXPECTED_LEG_KEYS: readonly string[] = Object.freeze([
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
const REGISTERED = ['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05', 'ST-06', 'ST-07', 'ST-08', 'ST-09'] as const;
type RowId = (typeof REGISTERED)[number];
// GREEN epoch (R10 software-complete, 2026-08-18): ST-01/ST-05 (h2
// transport-truncation taxonomy), ST-07/ST-08 (documented 'end' before the
// trio) and ST-09 (end() no longer marks finished) were each repaired out of
// existence. Arming stays fail-closed on the empty membership: if any old
// silent-success signature ever reproduces, armRed() throws
// InfrastructureError and the run is loudly invalid rather than quietly red.
const EXPECTED_RED: readonly RowId[] = [];
const EXPECTED_PASSED: readonly RowId[] = REGISTERED.filter((id) => !(EXPECTED_RED as readonly string[]).includes(id));
// Frozen target/control registry (GREEN-v2 schema): targets were RED before
// the R10 repairs; controls are the H1 and happy-path coherence rows.
const REGISTRY = Object.freeze({
  controls: ['ST-02', 'ST-03', 'ST-04', 'ST-06'] as readonly RowId[],
  targets: ['ST-01', 'ST-05', 'ST-07', 'ST-08', 'ST-09'] as readonly RowId[],
});

interface HookCounts { afterHeaders: number; afterParse: number; afterResponse: number; beforeError: number; onAbort: number; onTimeout: number }
function createHookProbe(): { counts: HookCounts; hooks: Partial<RezoHooks> } {
  const counts: HookCounts = { afterHeaders: 0, afterParse: 0, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 };
  const hooks: Partial<RezoHooks> = {
    afterHeaders: [() => { counts.afterHeaders += 1; }],
    afterParse: [(event) => { counts.afterParse += 1; return event.data; }],
    afterResponse: [(response) => { counts.afterResponse += 1; return response; }],
    beforeError: [(error) => { counts.beforeError += 1; return error; }],
    onAbort: [() => { counts.onAbort += 1; }],
    onTimeout: [() => { counts.onTimeout += 1; }],
  };
  return { counts, hooks };
}

// Truncated zstd frame whose wire length matches Content-Length: the
// clean wire end makes h1's pipe call the facade's end() before the
// integrity tee settles the error (ST-09).
const ZSTD_PAYLOAD = (() => {
  const buffer = Buffer.allocUnsafe(262_144);
  let state = 0x12345678;
  for (let index = 0; index < buffer.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    buffer[index] = state >>> 24;
  }
  return buffer;
})();
const ZSTD_TRUNCATED = zstdCompressSync(ZSTD_PAYLOAD).subarray(0, 131_084);

const EXACT_BODY = Buffer.from('exact-stream-body-bytes!');
// Exact error messages observed on Node v25.9.0 and Bun 1.3.14: the H2
// declared-length gate's message is Rezo's own (runtime-independent); the H1
// transport reset message is the runtime's socket error text.
const H2_TRUNCATION_MESSAGE = 'HTTP/2 stream ended before the declared content-length was delivered (received 4 of 1000 bytes)';
const H1_TRUNCATION_MESSAGE = RUNTIME === 'bun'
  ? 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
  : 'aborted';
const PREFIX = Buffer.from('part');
const ADVERTISED_LENGTH = '1000';

// ---------------------------------------------------------------- oracle --
const invocations = new Map<RowId, number>();
const armed = new Set<RowId>();
const consumedArms = new Set<RowId>();
const redRows = new Set<RowId>();
const passedRows = new Set<RowId>();
const oracleMismatches: string[] = [];
const setupErrors: string[] = [];
const teardownErrors: string[] = [];
const lateEvents: string[] = [];
// Server-side fixture observations: every session/stream error the fixture
// sees is recorded with its wire mode; on a `happy` wire it is an oracle
// mismatch, on a truncated wire the destroy-induced error is expected noise.
const fixtureEvents: string[] = [];
const fixtureErrors: string[] = [];
// GREEN-v2 physical-leg ledger: every wire this file drives is recorded
// under its row with exact byte/event/error/lifecycle fields.
const legs: Record<string, unknown> = {};
let currentRow: RowId | null = null;

function recordLeg(label: string, snapshot: object, client: unknown): void {
  if (currentRow === null) throw new InfrastructureError(`leg ${label} recorded outside a row`);
  const legId = `${currentRow}:${label}`;
  if (legId in legs) throw new InfrastructureError(`duplicate leg ${legId}`);
  // Natural resource state at case end — nothing in this file force-cleans
  // per case, so these are the true counts before the afterAll teardown.
  const naturalAtCaseEnd = { servers: openServers.size, sessions: openSessions.size, sockets: openSockets.size, timers: openTimers.size };
  legs[legId] = { ...snapshot, adapter: adapterIdentityOf(client), clientNaturalAtCaseEnd: snapshotClientPools(), naturalAtCaseEnd, protocol: label.split(':')[0], runtime: RUNTIME };
}

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`R10 infrastructure invalidity: ${message}`);
  }
}

function armRed(id: RowId): void {
  if (!(EXPECTED_RED as readonly string[]).includes(id)) {
    throw new InfrastructureError(`armRed(${id}) is not an expected-red member`);
  }
  if (armed.has(id) || consumedArms.has(id)) {
    throw new InfrastructureError(`armRed(${id}) duplicate arm`);
  }
  armed.add(id);
}

async function observeRow(id: RowId, body: () => Promise<void>): Promise<void> {
  if (invocations.has(id)) throw new InfrastructureError(`duplicate row invocation ${id}`);
  invocations.set(id, 1);
  currentRow = id;
  try {
    await body();
    if (armed.has(id)) {
      armed.delete(id);
      consumedArms.add(id);
      throw new InfrastructureError(`${id} armed RED but desired contract passed (armed-success)`);
    }
    passedRows.add(id);
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    if (armed.has(id)) {
      armed.delete(id);
      consumedArms.add(id);
      redRows.add(id);
      throw error; // authenticated RED
    }
    oracleMismatches.push(`${id}:unarmed:${(error as Error).message.split('\n')[0]}`);
    throw error;
  }
}

// ------------------------------------------------------------ resources --
const openServers = new Set<http.Server | http2.Http2Server>();
const openSockets = new Set<Socket>();
const openSessions = new Set<http2.ServerHttp2Session>();
const openTimers = new Set<ReturnType<typeof setTimeout>>();
const forcedCleanup = { serversClosed: 0, sessionsDestroyed: 0, socketsDestroyed: 0, timersCleared: 0 };
const uncaught: string[] = [];
const unhandled: string[] = [];

const onUncaughtException = (error: Error): void => { uncaught.push(String(error?.message ?? error)); };
const onUnhandledRejection = (reason: unknown): void => { unhandled.push(String((reason as Error)?.message ?? reason)); };
process.on('uncaughtException', onUncaughtException);
process.on('unhandledRejection', onUnhandledRejection);

function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { if (timer) openTimers.delete(timer); reject(new InfrastructureError(label)); }, milliseconds);
    openTimers.add(timer);
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) { clearTimeout(timer); openTimers.delete(timer); } });
}

async function listenOrThrow(server: http.Server | http2.Http2Server, label: string): Promise<void> {
  // One permanent server error listener: listen rejection while binding,
  // then the fixture-error recorder (fail-closed) for the rest of the wire.
  let listenReject: ((error: Error) => void) | null = null;
  server.on('error', (error: Error) => { if (listenReject !== null) listenReject(error); else fixtureErrors.push(`${label}:server:${String((error as NodeJS.ErrnoException).code ?? error.message)}`); });
  try {
    await within(new Promise<void>((resolve, reject) => {
      listenReject = reject;
      server.listen(0, '127.0.0.1', () => { listenReject = null; resolve(); });
    }), 2_000, `${label} failed to listen`);
  } catch (error) {
    listenReject = null;
    setupErrors.push(`listen:${label}:${String(error)}`);
    openServers.delete(server);
    try { server.close(); } catch { /* already closed */ }
    throw error instanceof InfrastructureError ? error : new InfrastructureError(`${label} listen failed: ${String(error)}`);
  }
}

function trackedTimeout(fn: () => void, ms: number): void {
  const timer = setTimeout(() => { openTimers.delete(timer); fn(); }, ms);
  openTimers.add(timer);
}

async function closeAllResources(): Promise<void> {
  forcedCleanup.timersCleared += openTimers.size;
  forcedCleanup.sessionsDestroyed += openSessions.size;
  forcedCleanup.socketsDestroyed += openSockets.size;
  forcedCleanup.serversClosed += openServers.size;
  for (const timer of openTimers) clearTimeout(timer);
  openTimers.clear();
  // Destroy, then AWAIT each close event (bounded) before the set is cleared,
  // so the end state reflects closed handles, not merely issued destroys.
  // A handle still in its set has not emitted 'close' (the close handlers
  // remove it), so the actual bounded close is awaited even when
  // destroyed === true: destroyed is a flag, not the close event.
  const awaitClose = (emitter: { once(event: 'close', listener: () => void): unknown }, label: string): Promise<void> =>
    within(new Promise<void>((resolve) => { emitter.once('close', () => resolve()); }), 2_000, `${label} did not close`).catch((error) => { teardownErrors.push(String(error)); });
  for (const session of [...openSessions]) {
    // Closed meanwhile (e.g. by the client pool teardown): the 'close' handler already removed it.
    if (!openSessions.has(session)) continue;
    const closed = awaitClose(session, 'session');
    try { session.destroy(); } catch (error) { teardownErrors.push(`session:${(error as Error).message}`); }
    await closed;
  }
  openSessions.clear();
  for (const socket of [...openSockets]) {
    if (!openSockets.has(socket)) continue;
    const closed = awaitClose(socket, 'socket');
    try { socket.destroy(); } catch (error) { teardownErrors.push(`socket:${(error as Error).message}`); }
    await closed;
  }
  openSockets.clear();
  for (const server of openServers) {
    await within(new Promise<void>((resolve) => {
      try { server.close(() => resolve()); } catch (error) { teardownErrors.push(`server:${(error as Error).message}`); resolve(); }
    }), 2_000, 'server did not close').catch((error) => { teardownErrors.push(String(error)); });
  }
  openServers.clear();
}

// ---------------------------------------------------------------- wires --
interface WireHandle { port: number; hits: () => number }
// Live hit getters retained through reconciliation: each is re-read after
// its server's bounded close in afterAll (a stored scalar cannot see a late hit).
const liveWireHits: Array<() => number> = [];

async function startH1Wire(mode: 'truncated' | 'happy' | 'zstd-truncated'): Promise<WireHandle> {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    request.resume();
    request.once('end', () => {
      if (mode === 'happy') {
        response.writeHead(200, { 'content-length': String(EXACT_BODY.length), 'content-type': 'application/octet-stream' });
        response.end(EXACT_BODY);
        return;
      }
      if (mode === 'zstd-truncated') {
        response.writeHead(200, { 'content-encoding': 'zstd', 'content-length': String(ZSTD_TRUNCATED.length), 'content-type': 'application/octet-stream' });
        response.end(ZSTD_TRUNCATED);
        return;
      }
      response.writeHead(200, { 'content-length': ADVERTISED_LENGTH, 'content-type': 'application/octet-stream' });
      response.write(PREFIX);
      trackedTimeout(() => response.socket?.destroy(), 30);
    });
  });
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
    socket.on('error', (error: NodeJS.ErrnoException) => { fixtureEvents.push(`${mode}:socket:${String(error?.code ?? error?.message)}`); });
    socket.on('close', () => openSockets.delete(socket));
  });
  openServers.add(server);
  await listenOrThrow(server, `h1/${mode}`);
  liveWireHits.push(() => hits);
  return { port: (server.address() as AddressInfo).port, hits: () => hits };
}

async function startH2Wire(mode: 'truncated' | 'happy'): Promise<WireHandle> {
  let hits = 0;
  const server = http2.createServer();
  server.on('session', (session: http2.ServerHttp2Session) => {
    openSessions.add(session);
    session.once('close', () => openSessions.delete(session));
    session.on('error', (error: NodeJS.ErrnoException) => { fixtureEvents.push(`${mode}:session:${String(error?.code ?? error?.message)}`); });
    session.on('close', () => openSessions.delete(session));
  });
  server.on('stream', (stream: http2.ServerHttp2Stream) => {
    hits += 1;
    stream.on('error', (error: NodeJS.ErrnoException) => { fixtureEvents.push(`${mode}:stream:${String(error?.code ?? error?.message)}`); });
    if (mode === 'happy') {
      stream.respond({ ':status': 200, 'content-length': String(EXACT_BODY.length), 'content-type': 'application/octet-stream' });
      stream.end(EXACT_BODY);
      return;
    }
    stream.respond({ ':status': 200, 'content-length': ADVERTISED_LENGTH, 'content-type': 'application/octet-stream' });
    stream.write(PREFIX);
    trackedTimeout(() => stream.destroy(), 30);
  });
  openServers.add(server);
  await listenOrThrow(server, `h2/${mode}`);
  liveWireHits.push(() => hits);
  return { port: (server.address() as AddressInfo).port, hits: () => hits };
}

// ------------------------------------------------------------- observer --
interface ErrorFields {
  causeCode: unknown;
  causeName: string | null;
  code: string;
  errno: unknown;
  hasCause: boolean;
  hasResponse: boolean;
  isNetworkError: unknown;
  isRetryable: unknown;
  isRezoError: boolean;
  isTimeout: unknown;
  message: string;
  name: string;
  responseBodyLength: number | null;
  responseBodySha256: string | null;
  responseStatus: unknown;
  status: unknown;
}

// Exact stream-error facts: own status, independent response status and
// body identity, cause presence/name/code, name/message/code/errno/flags.
function captureErrorFields(error: unknown): ErrorFields {
  const fields = Object(error) as Record<string, unknown>;
  const cause = fields.cause;
  const response = fields.response;
  const hasResponse = response !== undefined && response !== null;
  const data = hasResponse ? Reflect.get(Object(response), 'data') : undefined;
  const body = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : typeof data === 'string' ? Buffer.from(data) : null;
  return {
    causeCode: cause === undefined ? null : (Reflect.get(Object(cause), 'code') ?? null),
    causeName: cause === undefined ? null : String(Reflect.get(Object(cause), 'name') ?? ''),
    code: String(fields.code ?? 'UNKNOWN'),
    errno: fields.errno,
    hasCause: cause !== undefined,
    hasResponse,
    isNetworkError: fields.isNetworkError,
    isRetryable: fields.isRetryable,
    isRezoError: error instanceof RezoError,
    isTimeout: fields.isTimeout,
    message: String(fields.message ?? ''),
    name: String(fields.name ?? ''),
    responseBodyLength: body === null ? null : body.length,
    responseBodySha256: body === null ? null : sha256Of(body),
    responseStatus: hasResponse ? (Reflect.get(Object(response), 'status') ?? null) : null,
    status: fields.status ?? null,
  };
}

interface StreamSnapshot {
  hooks: HookCounts;
  statusEvents: number[];
  wireHits: number;
  bytes: number;
  bodyExact: boolean;
  // Exact data-before-error proof: every delivered byte is a prefix of the
  // bytes the wire actually produced (EXACT_BODY, PREFIX, or the zstd payload).
  bodyIsPrefix: boolean;
  bodySha256: string;
  dataAfterTerminal: number;
  successOrder: string[];
  errorCodes: string[];
  errors: ErrorFields[];
  endEvents: number;
  terminalSequence: string[];
  isFinished: boolean;
  lateContradiction: boolean;
}

async function runStreamCase(protocol: 'h1' | 'h2', mode: 'truncated' | 'happy' | 'zstd-truncated'): Promise<StreamSnapshot> {
  if (mode === 'zstd-truncated' && protocol !== 'h1') {
    throw new InfrastructureError('zstd-truncated wire is an h1-only fixture');
  }
  const wire = protocol === 'h1' ? await startH1Wire(mode) : await startH2Wire(mode as 'truncated' | 'happy');
  const client = (protocol === 'h1' ? H1_ENTRY.default : H2_ENTRY.default).create({});
  if (protocol === 'h1') h1PoolTouched = true; else h2PoolTouched = true;
  const probe = createHookProbe();
  const stream = client.stream(`http://127.0.0.1:${wire.port}/r10`, { cache: false, hooks: probe.hooks, retry: false });
  const statusEvents: number[] = [];
  stream.on('status', (status: number) => { statusEvents.push(status); });

  const chunks: Buffer[] = [];
  const successOrder: string[] = [];
  const errorCodes: string[] = [];
  const errors: ErrorFields[] = [];
  let endEvents = 0;
  let dataAfterTerminal = 0;
  let terminalReached = false;
  let terminalSeen: (() => void) | null = null;
  const terminal = new Promise<void>((resolve) => { terminalSeen = resolve; });

  const terminalSequence: string[] = [];
  stream.on('data', (chunk: Buffer) => {
    if (terminalReached) dataAfterTerminal += 1;
    terminalSequence.push('data');
    chunks.push(Buffer.from(chunk));
  });
  stream.on('end', () => { endEvents += 1; terminalSequence.push('end'); });
  stream.on('error', (error: NodeJS.ErrnoException) => {
    errorCodes.push(String(error?.code ?? 'UNKNOWN'));
    errors.push(captureErrorFields(error));
    terminalSequence.push('error');
    terminalReached = true;
    terminalSeen?.();
  });
  for (const alias of ['finish', 'done', 'complete'] as const) {
    stream.on(alias, () => {
      successOrder.push(alias);
      terminalSequence.push(alias);
      if (alias === 'complete') { terminalReached = true; terminalSeen?.(); }
    });
  }

  // Infrastructure watchdog only — never a verdict. Terminal is decided by
  // the facade's own events (error, or the complete alias).
  // GREEN-v2: the watchdog and the stability timer are cleared by the case
  // itself, so the ledger's timers:0 is earned per case, never by teardown.
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    watchdogTimer = setTimeout(() => {
      if (watchdogTimer !== undefined) openTimers.delete(watchdogTimer);
      reject(new InfrastructureError(`${protocol}/${mode} watchdog: no terminal event`));
    }, 15_000);
    openTimers.add(watchdogTimer);
  });
  try {
    await Promise.race([terminal, watchdog]);
  } finally {
    if (watchdogTimer !== undefined) { clearTimeout(watchdogTimer); openTimers.delete(watchdogTimer); }
  }

  // Post-terminal stability: two macro turns, then record contradictions.
  const terminalErrorCount = errorCodes.length;
  const terminalSuccessCount = successOrder.length;
  await new Promise<void>((resolve) => {
    const stabilityTimer = setTimeout(() => { openTimers.delete(stabilityTimer); resolve(); }, 150);
    openTimers.add(stabilityTimer);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const lateContradiction =
    (terminalErrorCount === 0 && errorCodes.length > 0 && terminalSuccessCount > 0)
    || (terminalSuccessCount === 0 && successOrder.length > 0 && terminalErrorCount > 0);
  if (lateContradiction) lateEvents.push(`${protocol}/${mode}:late-contradiction`);

  const body = Buffer.concat(chunks);
  // Raw stream mode delivers the encoded WIRE bytes untouched (http.ts stream
  // branch; R07 CI-C1/CI-C3 stream legs pin streamHex16 === encodedHex), so
  // the zstd-truncated fixture's produced bytes are the truncated frame
  // itself, never the decoded payload.
  const producedBody = mode === 'happy' ? EXACT_BODY : mode === 'truncated' ? PREFIX : ZSTD_TRUNCATED;
  const snapshot: StreamSnapshot = {
    hooks: { ...probe.counts },
    statusEvents: [...statusEvents],
    wireHits: wire.hits(),
    bytes: body.length,
    bodyExact: body.equals(EXACT_BODY),
    bodyIsPrefix: body.length <= producedBody.length && producedBody.subarray(0, body.length).equals(body),
    bodySha256: createHash('sha256').update(body).digest('hex'),
    dataAfterTerminal,
    successOrder: [...successOrder],
    errorCodes: [...errorCodes],
    errors: [...errors],
    endEvents,
    terminalSequence: collapseSequence(terminalSequence),
    isFinished: stream.isFinished(),
    lateContradiction,
  };
  recordLeg(`${protocol}:stream:${mode}`, snapshot, client);
  return snapshot;
}

// ----------------------------------------------------------------- rows --
it('ST-01 h2 stream transport truncation must reject, never succeed', async () => {
  await observeRow('ST-01', async () => {
    const snapshot = await runStreamCase('h2', 'truncated');
    const acceptedCurrent =
      snapshot.bytes === PREFIX.length
      && snapshot.errorCodes.length === 0
      && isDeepOrderedTrio(snapshot.successOrder);
    if (acceptedCurrent) armRed('ST-01');
    // Desired terminal contract: data-then-error, no success aliases.
    expect(snapshot.bytes).toBe(PREFIX.length);
    expect(snapshot.errorCodes).toEqual(['ECONNRESET']);
    expect(snapshot.errors[0].errno).toBe(-104);
    expect(snapshot.errors[0].message).toBe(H2_TRUNCATION_MESSAGE);
    expect(snapshot.errors[0].isNetworkError).toBe(true);
    expect(snapshot.errors[0].isRetryable).toBe(true);
    expect(snapshot.errors[0].isTimeout).toBe(false);
    expect(snapshot.errors[0].hasCause).toBe(true);
    expect(snapshot.errors[0].causeName).toBe('Error');
    expect(snapshot.errors[0].causeCode).toBe('ECONNRESET');
    // R15 P1: the stream truncation error carries its headers/status
    // response with no body (the bytes were delivered through the facade).
    expect(snapshot.errors[0].hasResponse).toBe(true);
    expect(snapshot.errors[0].status).toBe(200);
    expect(snapshot.errors[0].responseStatus).toBe(200);
    expect(snapshot.errors[0].responseBodyLength).toBeNull();
    expect(snapshot.errors[0].responseBodySha256).toBeNull();
    expect(snapshot.wireHits).toBe(1);
    expect(snapshot.bodyIsPrefix).toBe(true);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.terminalSequence.filter((event) => event === 'error')).toHaveLength(1);
    expect(typeof snapshot.errors[0].errno).toBe('number');
    expect(snapshot.errors[0].isRezoError).toBe(true);
    expect(snapshot.errors[0].name).toBe('RezoError');
    expect(snapshot.errors[0].message.length).toBeGreaterThan(0);
    expect(snapshot.successOrder).toEqual([]);
    expect(snapshot.isFinished).toBe(false);
    expect(snapshot.lateContradiction).toBe(false);
    // Exact data-then-error terminal shape and hook/status facts (R15 P2/P3:
    // afterHeaders once on header arrival, beforeError once before the error).
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'error']);
    expect(snapshot.endEvents).toBe(0);
    expect(snapshot.bodySha256).toBe(sha256Of(PREFIX));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 0, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 });
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('ST-02 h1 stream transport truncation errors exactly once (control)', async () => {
  await observeRow('ST-02', async () => {
    const snapshot = await runStreamCase('h1', 'truncated');
    expect(snapshot.errorCodes).toEqual(['ECONNRESET']);
    expect(snapshot.errors[0].errno).toBe(-104);
    expect(snapshot.errors[0].message).toBe(H1_TRUNCATION_MESSAGE);
    expect(snapshot.errors[0].isNetworkError).toBe(true);
    expect(snapshot.errors[0].isRetryable).toBe(true);
    expect(snapshot.errors[0].isTimeout).toBe(false);
    // Observed on both runtimes: the H1 stream transport error carries a
    // cause (since R15 P1b the promise-surface ST-06 error does too).
    expect(snapshot.errors[0].hasCause).toBe(true);
    expect(snapshot.errors[0].causeName).toBe('Error');
    expect(snapshot.errors[0].causeCode).toBe('ECONNRESET');
    // The H1 stream truncation error carries its headers/status response
    // with no body (the bytes were delivered through the facade).
    expect(snapshot.errors[0].hasResponse).toBe(true);
    expect(snapshot.errors[0].status).toBe(200);
    expect(snapshot.errors[0].responseStatus).toBe(200);
    expect(snapshot.errors[0].responseBodyLength).toBeNull();
    expect(snapshot.errors[0].responseBodySha256).toBeNull();
    expect(snapshot.wireHits).toBe(1);
    expect(snapshot.successOrder).toEqual([]);
    expect(snapshot.bytes).toBeLessThanOrEqual(PREFIX.length);
    expect(snapshot.bodyIsPrefix).toBe(true);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(typeof snapshot.errors[0].errno).toBe('number');
    expect(snapshot.errors[0].isRezoError).toBe(true);
    expect(snapshot.errors[0].name).toBe('RezoError');
    expect(snapshot.errors[0].message.length).toBeGreaterThan(0);
    expect(snapshot.isFinished).toBe(false);
    expect(snapshot.lateContradiction).toBe(false);
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'error']);
    expect(snapshot.endEvents).toBe(0);
    expect(snapshot.bytes).toBe(PREFIX.length);
    expect(snapshot.bodySha256).toBe(sha256Of(PREFIX));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 0, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 });
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('ST-03 h2 stream happy path stays exact and single-trio (control)', async () => {
  await observeRow('ST-03', async () => {
    const snapshot = await runStreamCase('h2', 'happy');
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 });
    expect(snapshot.bodyExact).toBe(true);
    expect(isDeepOrderedTrio(snapshot.successOrder)).toBe(true);
    expect(snapshot.errorCodes).toEqual([]);
    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.endEvents).toBe(1);
    expect(snapshot.lateContradiction).toBe(false);
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'end', 'finish', 'done', 'complete']);
    expect(snapshot.bodySha256).toBe(sha256Of(EXACT_BODY));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('ST-04 h1 stream happy path stays exact and single-trio (control)', async () => {
  await observeRow('ST-04', async () => {
    const snapshot = await runStreamCase('h1', 'happy');
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 });
    expect(snapshot.bodyExact).toBe(true);
    expect(isDeepOrderedTrio(snapshot.successOrder)).toBe(true);
    expect(snapshot.errorCodes).toEqual([]);
    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.endEvents).toBe(1);
    expect(snapshot.lateContradiction).toBe(false);
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'end', 'finish', 'done', 'complete']);
    expect(snapshot.bodySha256).toBe(sha256Of(EXACT_BODY));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

function isDeepOrderedTrio(order: string[]): boolean {
  return order.length === 3 && order[0] === 'finish' && order[1] === 'done' && order[2] === 'complete';
}

// Buffered legs: same truncated wire, promise surface instead of facade.
// Run-length collapse (`data x 3`) so exact event order survives while the
// runtime-specific chunk count stays out of the pinned sequence.
function collapseSequence(sequence: readonly string[]): string[] {
  // Only `data` chunk runs are run-length encoded; every other event is one
  // token per occurrence, so a duplicate end/error/alias stays visible.
  const collapsed: string[] = [];
  let dataRun = 0;
  const flush = (): void => { if (dataRun > 0) collapsed.push(dataRun > 1 ? `datax${dataRun}` : 'data'); dataRun = 0; };
  for (const name of sequence) { if (name === 'data') { dataRun += 1; continue; } flush(); collapsed.push(name); }
  flush();
  return collapsed;
}
function normalizeSequence(sequence: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const entry of sequence) {
    if (/^data(x\d+)?$/.test(entry)) { if (normalized[normalized.length - 1] !== 'data') normalized.push('data'); continue; }
    normalized.push(entry);
  }
  return normalized;
}
function assertNormalizerKeepsCardinality(): void {
  const collapsed = collapseSequence(['end', 'end', 'data', 'data', 'data', 'finish', 'close', 'close']);
  if (JSON.stringify(collapsed) !== JSON.stringify(['end', 'end', 'datax3', 'finish', 'close', 'close'])) throw new InfrastructureError(`collapseSequence drift: ${JSON.stringify(collapsed)}`);
  const normalized = normalizeSequence(collapsed);
  if (JSON.stringify(normalized) !== JSON.stringify(['end', 'end', 'data', 'finish', 'close', 'close'])) throw new InfrastructureError(`normalizeSequence drift: ${JSON.stringify(normalized)}`);
}
function sha256Of(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

interface BufferedSnapshot {
  hooks: HookCounts;
  fulfilled: boolean;
  responseBodyLength: number | null;
  responseBodySha256: string | null;
  responseStatus: number | null;
  status: number | undefined;
  wireHits: number;
  bytes: number | undefined;
  bodyText: string | undefined;
  code: string | undefined;
  error: ErrorFields | undefined;
}

async function runBufferedCase(protocol: 'h1' | 'h2'): Promise<BufferedSnapshot> {
  const wire = protocol === 'h1' ? await startH1Wire('truncated') : await startH2Wire('truncated');
  const client = (protocol === 'h1' ? H1_ENTRY.default : H2_ENTRY.default).create({});
  if (protocol === 'h1') h1PoolTouched = true; else h2PoolTouched = true;
  const probe = createHookProbe();
  let snapshot: BufferedSnapshot;
  try {
    const response = await client.get(`http://127.0.0.1:${wire.port}/r10b`, {
      cache: false,
      hooks: probe.hooks,
      responseType: 'buffer',
      retry: false,
    });
    const body = response.data as Buffer;
    snapshot = {
      hooks: { ...probe.counts },
      fulfilled: true,
      responseBodyLength: null,
      responseBodySha256: null,
      responseStatus: null,
      wireHits: wire.hits(),
      status: response.status,
      bytes: body?.length,
      bodyText: body?.toString('utf8'),
      code: undefined,
      error: undefined,
    };
  } catch (error) {
    const errorResponse = Reflect.get(Object(error), 'response');
    // `status` = the error's OWN status; `responseStatus` independent.
    const errorStatus = Reflect.get(Object(error), 'status');
    const responseStatus = Reflect.get(Object(errorResponse), 'status');
    const responseData = Reflect.get(Object(errorResponse), 'data');
    const responseBody = Buffer.isBuffer(responseData) ? responseData : responseData instanceof Uint8Array ? Buffer.from(responseData) : typeof responseData === 'string' ? Buffer.from(responseData) : null;
    snapshot = {
      hooks: { ...probe.counts },
      fulfilled: false,
      responseBodyLength: responseBody === null ? null : responseBody.length,
      responseBodySha256: responseBody === null ? null : sha256Of(responseBody),
      responseStatus: typeof responseStatus === 'number' ? responseStatus : null,
      status: typeof errorStatus === 'number' ? errorStatus : undefined,
      wireHits: wire.hits(),
      bytes: undefined,
      bodyText: undefined,
      code: String((error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'),
      error: captureErrorFields(error),
    };
  }
  recordLeg(`${protocol}:buffered:truncated`, snapshot, client);
  return snapshot;
}

it('ST-05 h2 buffered transport truncation must reject, never fulfill', async () => {
  await observeRow('ST-05', async () => {
    const snapshot = await runBufferedCase('h2');
    const acceptedCurrent = snapshot.fulfilled
      && snapshot.status === 200
      && snapshot.bytes === PREFIX.length
      && snapshot.bodyText === PREFIX.toString('utf8');
    if (acceptedCurrent) armRed('ST-05');
    // Desired: parity with the h1 control — one ECONNRESET-class rejection.
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ECONNRESET');
    expect(snapshot.error?.isRezoError).toBe(true);
    expect(snapshot.error?.name).toBe('RezoError');
    expect(snapshot.error?.errno).toBe(-104);
    expect(snapshot.error?.message).toBe(H2_TRUNCATION_MESSAGE);
    expect(snapshot.error?.isNetworkError).toBe(true);
    expect(snapshot.error?.isRetryable).toBe(true);
    expect(snapshot.error?.isTimeout).toBe(false);
    expect(snapshot.error?.hasCause).toBe(true);
    // R15 P1 (2026-08-21): the H2 truncation error carries its partial
    // response exactly like the H1 control — status 200 and the delivered
    // prefix bytes (this row flipped RED-before-GREEN with the repair).
    expect(snapshot.error?.hasResponse).toBe(true);
    expect(snapshot.status).toBe(200);
    expect(snapshot.responseStatus).toBe(200);
    expect(snapshot.responseBodyLength).toBe(PREFIX.length);
    expect(snapshot.responseBodySha256).toBe(sha256Of(PREFIX));
    expect(snapshot.wireHits).toBe(1);
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 });
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('ST-06 h1 buffered transport truncation rejects ECONNRESET (control)', async () => {
  await observeRow('ST-06', async () => {
    const snapshot = await runBufferedCase('h1');
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ECONNRESET');
    expect(snapshot.error?.isRezoError).toBe(true);
    expect(snapshot.error?.name).toBe('RezoError');
    expect(snapshot.error?.errno).toBe(-104);
    expect(snapshot.error?.message).toBe(H1_TRUNCATION_MESSAGE);
    expect(snapshot.error?.isNetworkError).toBe(true);
    expect(snapshot.error?.isRetryable).toBe(true);
    expect(snapshot.error?.isTimeout).toBe(false);
    // R15 P1b: the buffered settlement carries its transport cause like the
    // stream path and the H2 adapter (flipped RED-before-GREEN).
    expect(snapshot.error?.hasCause).toBe(true);
    expect(snapshot.error?.hasResponse).toBe(true);
    expect(snapshot.status).toBe(200);
    // The H1 truncation error carries its partial response: exactly the
    // delivered prefix bytes.
    expect(snapshot.responseStatus).toBe(200);
    expect(snapshot.responseBodyLength).toBe(PREFIX.length);
    expect(snapshot.responseBodySha256).toBe(sha256Of(PREFIX));
    expect(snapshot.wireHits).toBe(1);
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 });
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

// rezo.ts stream() JSDoc: "@returns StreamResponse that emits 'data',
// 'end', 'error' events" with an on('end') example — the documented
// terminal read event. Desired: exactly one 'end' after the last data
// and before the finish/done/complete trio, on happy paths only.
it('ST-07 h2 happy stream emits the documented end before the trio', async () => {
  await observeRow('ST-07', async () => {
    const snapshot = await runStreamCase('h2', 'happy');
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 });
    const acceptedCurrent = snapshot.bodyExact
      && snapshot.endEvents === 0
      && isDeepOrderedTrio(snapshot.successOrder);
    if (acceptedCurrent) armRed('ST-07');
    expect(snapshot.bodyExact).toBe(true);
    expect(snapshot.endEvents).toBe(1);
    expect(snapshot.successOrder).toEqual(['finish', 'done', 'complete']);
    expect(snapshot.errorCodes).toEqual([]);
    expect(snapshot.lateContradiction).toBe(false);
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'end', 'finish', 'done', 'complete']);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.bodySha256).toBe(sha256Of(EXACT_BODY));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

// end() is the pipe's write-side signal on a CLEAN wire end, not the
// success terminal: an integrity failure settled after it must still
// report isFinished()===false (the R36/R10 failure lifecycle contract).
it('ST-09 h1 stream integrity failure never reports finished', async () => {
  await observeRow('ST-09', async () => {
    const snapshot = await runStreamCase('h1', 'zstd-truncated');
    const acceptedCurrent = snapshot.errorCodes.length === 1
      && snapshot.errorCodes[0] === 'REZ_DECOMPRESSION_ERROR'
      && snapshot.successOrder.length === 0
      && snapshot.isFinished === true;
    if (acceptedCurrent) armRed('ST-09');
    expect(snapshot.errorCodes).toEqual(['REZ_DECOMPRESSION_ERROR']);
    expect(snapshot.successOrder).toEqual([]);
    expect(snapshot.endEvents).toBe(0);
    // data-then-error: every wire byte reaches the consumer before the
    // structural verdict settles the failure.
    expect(snapshot.bodyIsPrefix).toBe(true);
    expect(snapshot.bytes).toBe(ZSTD_TRUNCATED.length);
    expect(snapshot.bodySha256).toBe(sha256Of(ZSTD_TRUNCATED));
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'error']);
    expect(snapshot.statusEvents).toEqual([200]);
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 1, onAbort: 0, onTimeout: 0 });
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.errors[0].errno).toBe(-1029);
    expect(snapshot.errors[0].isRezoError).toBe(true);
    expect(snapshot.errors[0].name).toBe('RezoError');
    expect(snapshot.errors[0].message).toBe('Decompression failed');
    expect(snapshot.errors[0].isNetworkError).toBe(false);
    expect(snapshot.errors[0].isTimeout).toBe(false);
    expect(snapshot.errors[0].isRetryable).toBe(false);
    expect(snapshot.isFinished).toBe(false);
    expect(snapshot.lateContradiction).toBe(false);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('ST-08 h1 happy stream emits the documented end before the trio', async () => {
  await observeRow('ST-08', async () => {
    const snapshot = await runStreamCase('h1', 'happy');
    expect(snapshot.hooks).toEqual({ afterHeaders: 1, afterParse: 1, afterResponse: 0, beforeError: 0, onAbort: 0, onTimeout: 0 });
    const acceptedCurrent = snapshot.bodyExact
      && snapshot.endEvents === 0
      && isDeepOrderedTrio(snapshot.successOrder);
    if (acceptedCurrent) armRed('ST-08');
    expect(snapshot.bodyExact).toBe(true);
    expect(snapshot.endEvents).toBe(1);
    expect(snapshot.successOrder).toEqual(['finish', 'done', 'complete']);
    expect(snapshot.errorCodes).toEqual([]);
    expect(snapshot.lateContradiction).toBe(false);
    expect(normalizeSequence(snapshot.terminalSequence)).toEqual(['data', 'end', 'finish', 'done', 'complete']);
    expect(snapshot.dataAfterTerminal).toBe(0);
    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.bodySha256).toBe(sha256Of(EXACT_BODY));
    expect(snapshot.statusEvents).toEqual([200]);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

// ---------------------------------------------------------------- ledger --
afterAll(async () => {
  // Natural state before the forced teardown; the nine fixture servers stay
  // listening by design until here, so servers is fixture ownership, while
  // timers must already be zero (earned per case).
  const naturalBeforeTeardown = { servers: openServers.size, sessions: openSessions.size, sockets: openSockets.size, timers: openTimers.size };
  const clientPools = forcedPoolTeardown();
  oracleMismatches.push(...clientPools.naturalProblems);
  await closeAllResources();
  // Every live hit getter is authenticated after its server's bounded close.
  if (liveWireHits.length !== EXPECTED_LEG_KEYS.length) oracleMismatches.push(`live-wires:${liveWireHits.length}!==${EXPECTED_LEG_KEYS.length}`);
  liveWireHits.forEach((hits, index) => { if (hits() !== 1) oracleMismatches.push(`late-hit:wire${index}:${hits()}`); });
  process.off('uncaughtException', onUncaughtException);
  process.off('unhandledRejection', onUnhandledRejection);
  const listeners = listenerDelta();
  if (listeners.length > 0) oracleMismatches.push(`listeners:${listeners.join(',')}`);
  for (const id of REGISTERED) {
    const count = invocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
  }
  if (armed.size > 0) oracleMismatches.push(`unconsumed-arms:${[...armed].join(',')}`);
  // GREEN-v2 reconciliation: the expectation maps are compared against the
  // observed outcome sets row by row — a declared map that is never
  // reconciled is exactly the defect the v1 ledger carried.
  for (const id of REGISTERED) {
    const expectation = (EXPECTED_RED as readonly string[]).includes(id) ? 'red' : 'passed';
    const observed = redRows.has(id) ? 'red' : passedRows.has(id) ? 'passed' : 'absent';
    if (observed !== expectation) oracleMismatches.push(`expectation:${id}:expected=${expectation}:observed=${observed}`);
  }
  // Physical-leg reconciliation against the frozen key set.
  const legKeys = Object.keys(legs).sort();
  const missingKeys = EXPECTED_LEG_KEYS.filter((key) => !legKeys.includes(key));
  const extraKeys = legKeys.filter((key) => !EXPECTED_LEG_KEYS.includes(key));
  if (missingKeys.length > 0) oracleMismatches.push(`legs-missing:${JSON.stringify(missingKeys)}`);
  if (extraKeys.length > 0) oracleMismatches.push(`legs-extra:${JSON.stringify(extraKeys)}`);
  if (legKeys.length !== EXPECTED_LEG_KEYS.length) oracleMismatches.push(`legCount:${legKeys.length}!==${EXPECTED_LEG_KEYS.length}`);
  for (const [legId, leg] of Object.entries(legs)) {
    const record = leg as { adapter: string; naturalAtCaseEnd: { timers: number }; protocol: string };
    const expectedAdapter = record.protocol === 'h1' ? 'http' : 'http2';
    if (record.adapter !== expectedAdapter) oracleMismatches.push(`adapter:${legId}:${record.adapter}`);
    if (record.naturalAtCaseEnd.timers !== 0) oracleMismatches.push(`natural-timers:${legId}:${record.naturalAtCaseEnd.timers}`);
  }
  if (ENTRY_IDENTITY.h1.adapter !== 'http') oracleMismatches.push(`entry-adapter:h1:${ENTRY_IDENTITY.h1.adapter}`);
  if (ENTRY_IDENTITY.h2.adapter !== 'http2') oracleMismatches.push(`entry-adapter:h2:${ENTRY_IDENTITY.h2.adapter}`);
  if (naturalBeforeTeardown.timers !== 0) oracleMismatches.push(`natural-timers-before-teardown:${naturalBeforeTeardown.timers}`);
  // Fixture ownership: exactly one listening server per wire survives until
  // here, and the forced teardown must act on exactly what was measured.
  if (naturalBeforeTeardown.servers !== EXPECTED_LEG_KEYS.length) oracleMismatches.push(`natural-servers:${naturalBeforeTeardown.servers}!==${EXPECTED_LEG_KEYS.length}`);
  if (forcedCleanup.serversClosed !== naturalBeforeTeardown.servers || forcedCleanup.sessionsDestroyed !== naturalBeforeTeardown.sessions || forcedCleanup.socketsDestroyed !== naturalBeforeTeardown.sockets || forcedCleanup.timersCleared !== 0) {
    oracleMismatches.push(`forced-vs-natural:${JSON.stringify(forcedCleanup)}!==${JSON.stringify(naturalBeforeTeardown)}`);
  }
  const registryUnion = [...REGISTRY.targets, ...REGISTRY.controls].sort();
  if (JSON.stringify(registryUnion) !== JSON.stringify([...REGISTERED].sort())) oracleMismatches.push(`registry:${JSON.stringify(registryUnion)}`);
  const registryOverlap = REGISTRY.targets.filter((id) => REGISTRY.controls.includes(id));
  if (registryOverlap.length > 0) oracleMismatches.push(`registry-overlap:${JSON.stringify(registryOverlap)}`);
  for (const key of ['h1', 'h2'] as const) {
    if (ENTRY_IDENTITY[key].defaultKind !== 'function' || ENTRY_IDENTITY[key].factory !== 'function') oracleMismatches.push(`entry-kind:${key}`);
  }
  // No wire in this file may surface a server-side error: the truncated wires
  // destroy their own stream/socket and the harvest shows zero events there.
  if (fixtureEvents.length > 0) { fixtureErrors.push(...fixtureEvents); oracleMismatches.push(`fixture-events:${JSON.stringify(fixtureEvents)}`); }
  for (const [legId, leg] of Object.entries(legs)) {
    const pools = (leg as { clientNaturalAtCaseEnd: ClientPoolSnapshot }).clientNaturalAtCaseEnd;
    if (pools.h1 !== null && (pools.h1.queuedRequests !== 0 || pools.h1.activeSockets !== 0 || pools.h1.agents !== 1 || pools.h1.agentShape !== 'node' || pools.h1.evictionTimer !== 'unref')) oracleMismatches.push(`client-h1:${legId}:${JSON.stringify(pools.h1)}`);
    if (pools.h2 !== null && (pools.h2.pending !== 0 || pools.h2.leases !== 0 || pools.h2.entries !== pools.h2.sessions || pools.h2.unhealthy !== 0 || pools.h2.states.retired !== 0 || pools.h2.states.closed !== 0 || pools.h2.states.reusable !== pools.h2.sessions || pools.h2.cleanupInterval !== 'unref')) oracleMismatches.push(`client-h2:${legId}:${JSON.stringify(pools.h2)}`);
    const hits = (leg as { wireHits?: number }).wireHits;
    if (hits !== 1) oracleMismatches.push(`wire-hits:${legId}:${String(hits)}`);
  }
  if (clientPools.h1After !== null && (clientPools.h1After.evictionTimer !== 'null' || clientPools.h1After.agents !== 0 || clientPools.h1After.activeSockets + clientPools.h1After.freeSockets + clientPools.h1After.queuedRequests !== 0)) oracleMismatches.push(`client-h1-after:${JSON.stringify(clientPools.h1After)}`);
  if (clientPools.h2After !== null && (clientPools.h2After.cleanupInterval !== 'null' || clientPools.h2After.sessions + clientPools.h2After.entries + clientPools.h2After.pending + clientPools.h2After.leases + clientPools.h2After.states.reusable + clientPools.h2After.states.retired + clientPools.h2After.states.closed !== 0)) oracleMismatches.push(`client-h2-after:${JSON.stringify(clientPools.h2After)}`);
  assertNormalizerKeepsCardinality();
  if (clientPools.h1Before === null || clientPools.h2Before === null) oracleMismatches.push('client-pools-untouched');
  const ledger = {
    cleanup: {
      complete: openServers.size === 0 && openSessions.size === 0 && openSockets.size === 0 && openTimers.size === 0 && naturalBeforeTeardown.timers === 0,
      endState: { servers: openServers.size, sessions: openSessions.size, sockets: openSockets.size, timers: openTimers.size },
      forced: { ...forcedCleanup },
      naturalBeforeTeardown,
    },
    cleanupErrors: teardownErrors,
    clientPools: { endState: { h1: clientPools.h1After, h2: clientPools.h2After }, forced: clientPools },
    entryIdentity: ENTRY_IDENTITY,
    epoch: 'green-v2',
    expectedPassed: [...EXPECTED_PASSED],
    expectedRed: [...EXPECTED_RED],
    file: 'test/a-plus-stream-terminal-contract.test.ts',
    fixtureErrors,
    fixtureEvents,
    lateEvents,
    listeners,
    expectedLegCount: EXPECTED_LEG_KEYS.length,
    legCount: legKeys.length,
    legs,
    oracleMismatches,
    passed: [...passedRows].sort(),
    processFaults: { uncaught: uncaught.length, unhandled: unhandled.length },
    red: [...redRows].sort(),
    registered: [...invocations.keys()].sort(),
    registry: REGISTRY,
    runtime: RUNTIME,
    runtimeVersion: RUNTIME_VERSION,
    schema: 'rezo.r10.stream-terminal.ledger/v2',
    setupErrors,
    skipped: [] as string[],
    teardownErrors,
  };
  console.log(`REZO_R10_LEDGER_V2:${JSON.stringify(ledger)}`);
  // Fail closed: ledger printed for the supervisor, then any unacceptable
  // condition throws so the file can never exit 0 on a mismatch, a leak, a
  // fault, or a short leg set.
  const failures: string[] = [];
  if (oracleMismatches.length > 0) failures.push(`oracle:${oracleMismatches.join('|')}`);
  if (setupErrors.length > 0) failures.push(`setup:${setupErrors.length}`);
  if (fixtureErrors.length > 0) failures.push(`fixture:${fixtureErrors.length}`);
  if (teardownErrors.length > 0) failures.push(`teardown:${teardownErrors.length}`);
  if (lateEvents.length > 0) failures.push(`late-events:${lateEvents.length}`);
  if (!ledger.cleanup.complete) failures.push('cleanup-incomplete');
  if (uncaught.length !== 0 || unhandled.length !== 0) failures.push('process-faults');
  if (failures.length > 0) {
    throw new InfrastructureError(`R10 GREEN-v2 ledger rejected: ${failures.join('; ')}`);
  }
});
