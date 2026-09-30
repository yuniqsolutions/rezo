import { afterAll, expect, it } from 'vitest';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

// E3-facet RED suite: a real non-zero RST_STREAM must surface as the
// reset family (ECONNRESET parity with HTTP/1), never as
// REZ_UNKNOWN_ERROR (-9999). Probe r10c-rst-taxonomy.mts (2026-08-18,
// both runtimes): mid-body NGHTTP2_INTERNAL_ERROR -> Node
// REZ_UNKNOWN_ERROR; Bun reaches the R10 declared-length gate first and
// already yields ECONNRESET (runtime-split expected-red below).
// Pre-body NGHTTP2_REFUSED_STREAM -> REZ_UNKNOWN_ERROR on both.

const RUNTIME: 'node' | 'bun' = typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' ? 'node' : 'bun';
const REGISTERED = ['RT-01', 'RT-02', 'RT-03'] as const;
type RowId = (typeof REGISTERED)[number];
const EXPECTED_RED: readonly RowId[] = RUNTIME === 'node' ? ['RT-01', 'RT-02'] : ['RT-02'];

const HAPPY_BODY = Buffer.from('reset-taxonomy-happy-body');

const invocations = new Map<RowId, number>();
const armed = new Set<RowId>();
const consumedArms = new Set<RowId>();
const redRows = new Set<RowId>();
const passedRows = new Set<RowId>();
const oracleMismatches: string[] = [];
const teardownErrors: string[] = [];

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`RT infrastructure invalidity: ${message}`);
  }
}

function armRed(id: RowId): void {
  if (!EXPECTED_RED.includes(id)) throw new InfrastructureError(`armRed(${id}) not expected-red on ${RUNTIME}`);
  if (armed.has(id) || consumedArms.has(id)) throw new InfrastructureError(`armRed(${id}) duplicate`);
  armed.add(id);
}

async function observeRow(id: RowId, body: () => Promise<void>): Promise<void> {
  if (invocations.has(id)) throw new InfrastructureError(`duplicate row ${id}`);
  invocations.set(id, 1);
  try {
    await body();
    if (armed.has(id)) {
      armed.delete(id);
      consumedArms.add(id);
      throw new InfrastructureError(`${id} armed RED but desired passed`);
    }
    passedRows.add(id);
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    if (armed.has(id)) {
      armed.delete(id);
      consumedArms.add(id);
      redRows.add(id);
      throw error;
    }
    oracleMismatches.push(`${id}:unarmed:${(error as Error).message.split('\n')[0]}`);
    throw error;
  }
}

const openServers = new Set<http2.Http2Server>();
const openSessions = new Set<http2.ServerHttp2Session>();
const openTimers = new Set<ReturnType<typeof setTimeout>>();
const uncaught: string[] = [];
const unhandled: string[] = [];
const onUncaughtException = (error: Error): void => { uncaught.push(String(error?.message ?? error)); };
const onUnhandledRejection = (reason: unknown): void => { unhandled.push(String((reason as Error)?.message ?? reason)); };
process.on('uncaughtException', onUncaughtException);
process.on('unhandledRejection', onUnhandledRejection);

type WireKind = 'mid-body-internal-error' | 'pre-body-refused' | 'happy';

async function startWire(kind: WireKind): Promise<number> {
  const server = http2.createServer();
  server.on('session', (session: http2.ServerHttp2Session) => {
    openSessions.add(session);
    session.on('error', () => undefined);
    session.on('close', () => openSessions.delete(session));
  });
  server.on('stream', (stream: http2.ServerHttp2Stream) => {
    stream.on('error', () => undefined);
    if (kind === 'pre-body-refused') {
      stream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
      return;
    }
    if (kind === 'happy') {
      stream.respond({ ':status': 200, 'content-length': String(HAPPY_BODY.length), 'content-type': 'application/octet-stream' });
      stream.end(HAPPY_BODY);
      return;
    }
    stream.respond({ ':status': 200, 'content-length': '1000', 'content-type': 'application/octet-stream' });
    stream.write('part');
    const timer = setTimeout(() => {
      openTimers.delete(timer);
      stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
    }, 30);
    openTimers.add(timer);
  });
  openServers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface Snapshot {
  fulfilled: boolean;
  status: number | undefined;
  bytes: number | undefined;
  code: string | undefined;
  errno: number | undefined;
}

async function runCase(kind: WireKind): Promise<Snapshot> {
  const port = await startWire(kind);
  const client = new Rezo({}, http2Adapter);
  try {
    const response = await client.get(`http://127.0.0.1:${port}/rt`, { cache: false, responseType: 'buffer', retry: false });
    return { fulfilled: true, status: response.status, bytes: (response.data as Buffer)?.length, code: undefined, errno: undefined };
  } catch (error) {
    const err = error as { code?: string; errno?: number };
    return { fulfilled: false, status: undefined, bytes: undefined, code: err?.code, errno: err?.errno };
  }
}

it('RT-01 mid-body non-zero RST surfaces as the reset family', async () => {
  await observeRow('RT-01', async () => {
    const snapshot = await runCase('mid-body-internal-error');
    const acceptedCurrent = !snapshot.fulfilled && snapshot.code === 'REZ_UNKNOWN_ERROR' && snapshot.errno === -9999;
    if (acceptedCurrent && RUNTIME === 'node') armRed('RT-01');
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ECONNRESET');
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('RT-02 pre-body REFUSED_STREAM surfaces as the reset family', async () => {
  await observeRow('RT-02', async () => {
    const snapshot = await runCase('pre-body-refused');
    const acceptedCurrent = !snapshot.fulfilled && snapshot.code === 'REZ_UNKNOWN_ERROR' && snapshot.errno === -9999;
    if (acceptedCurrent) armRed('RT-02');
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ECONNRESET');
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('RT-03 happy path stays exact (control)', async () => {
  await observeRow('RT-03', async () => {
    const snapshot = await runCase('happy');
    expect(snapshot.fulfilled).toBe(true);
    expect(snapshot.status).toBe(200);
    expect(snapshot.bytes).toBe(HAPPY_BODY.length);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

afterAll(async () => {
  for (const timer of openTimers) clearTimeout(timer);
  openTimers.clear();
  for (const session of openSessions) {
    try { session.destroy(); } catch (error) { teardownErrors.push(String((error as Error).message)); }
  }
  openSessions.clear();
  for (const server of openServers) {
    await new Promise<void>((resolve) => { try { server.close(() => resolve()); } catch { resolve(); } });
  }
  openServers.clear();
  process.off('uncaughtException', onUncaughtException);
  process.off('unhandledRejection', onUnhandledRejection);
  for (const id of REGISTERED) {
    const count = invocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
  }
  if (armed.size > 0) oracleMismatches.push(`unconsumed-arms:${[...armed].join(',')}`);
  const ledger = {
    cleanup: { complete: openServers.size === 0 && openSessions.size === 0 && openTimers.size === 0, servers: openServers.size, sessions: openSessions.size, timers: openTimers.size },
    cleanupErrors: teardownErrors,
    file: 'test/a-plus-http2-reset-taxonomy.test.ts',
    fixtureErrors: [] as string[],
    lateEvents: [] as string[],
    oracleMismatches,
    passed: [...passedRows].sort(),
    red: [...redRows].sort(),
    registered: [...invocations.keys()].sort(),
    runtime: RUNTIME,
    schema: 'rezo.r10.reset-taxonomy.ledger/v1',
    setupErrors: [] as string[],
    skipped: [] as string[],
    teardownErrors,
  };
  console.log(`REZO_RT_LEDGER_V1:${JSON.stringify(ledger)}`);
});
