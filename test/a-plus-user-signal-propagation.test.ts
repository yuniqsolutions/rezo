import { afterAll, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

// R12 rows (matrix-reserved name), Fetch legs (Node/Bun — the locally
// runnable slice; XHR/browser and cURL legs join under their own row IDs
// when their environments execute). Probe r12-fetch-abort.mts
// (2026-08-18, BOTH runtimes): the fetch adapter's user signal is fully
// disconnected — config.signal is never populated on the fetch path and
// fetchOptions.signal is never read — so pre-flight AND mid-flight
// aborts never settle at all.

const RUNTIME: 'node' | 'bun' = typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' ? 'node' : 'bun';
const REGISTERED = ['FS-01', 'FS-02', 'FS-03', 'FS-04'] as const;
type RowId = (typeof REGISTERED)[number];
const EXPECTED_RED: readonly RowId[] = ['FS-01', 'FS-02'];

const HAPPY_BODY = Buffer.from('fetch-signal-happy-body');
const SETTLE_BOUND_MS = 5_000; // infrastructure bound, never a verdict

const invocations = new Map<RowId, number>();
const armed = new Set<RowId>();
const consumedArms = new Set<RowId>();
const redRows = new Set<RowId>();
const passedRows = new Set<RowId>();
const oracleMismatches: string[] = [];
const teardownErrors: string[] = [];

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`FS infrastructure invalidity: ${message}`);
  }
}

function armRed(id: RowId): void {
  if (!EXPECTED_RED.includes(id)) throw new InfrastructureError(`armRed(${id}) not expected-red`);
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
      throw new InfrastructureError(`${id} armed RED but desired contract passed (armed-success)`);
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

const openServers = new Set<http.Server>();
const openSockets = new Set<import('node:net').Socket>();
const openTimers = new Set<ReturnType<typeof setTimeout>>();
const uncaught: string[] = [];
const unhandled: string[] = [];
const onUncaughtException = (error: Error): void => { uncaught.push(String(error?.message ?? error)); };
const onUnhandledRejection = (reason: unknown): void => { unhandled.push(String((reason as Error)?.message ?? reason)); };
process.on('uncaughtException', onUncaughtException);
process.on('unhandledRejection', onUnhandledRejection);

function startWire(kind: 'hold-open' | 'happy'): Promise<{ port: number; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    request.resume();
    request.once('end', () => {
      if (kind === 'happy') {
        response.writeHead(200, { 'content-length': String(HAPPY_BODY.length), 'content-type': 'application/octet-stream' });
        response.end(HAPPY_BODY);
        return;
      }
      response.writeHead(200, { 'content-length': '1000', 'content-type': 'application/octet-stream' });
      response.write('part'); // hold open
    });
  });
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  openServers.add(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, hits: () => hits }));
  });
}

interface SettleSnapshot {
  settled: boolean;
  fulfilled: boolean;
  code: string | undefined;
  errno: number | undefined;
}

async function observeSettlement(pending: Promise<unknown>): Promise<SettleSnapshot> {
  let snapshot: SettleSnapshot = { settled: false, fulfilled: false, code: undefined, errno: undefined };
  const settled = (async () => {
    try {
      await pending;
      snapshot = { settled: true, fulfilled: true, code: undefined, errno: undefined };
    } catch (error) {
      const err = error as { code?: string; errno?: number };
      snapshot = { settled: true, fulfilled: false, code: err?.code, errno: err?.errno };
    }
  })();
  const bound = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SETTLE_BOUND_MS);
    openTimers.add(timer);
  });
  await Promise.race([settled, bound]);
  if (!snapshot.settled) void pending.catch(() => undefined);
  return snapshot;
}

it('FS-01 fetch pre-aborted signal must settle promptly with abort taxonomy', async () => {
  await observeRow('FS-01', async () => {
    const wire = await startWire('hold-open');
    const client = new Rezo({}, fetchAdapter);
    const controller = new AbortController();
    controller.abort();
    const snapshot = await observeSettlement(client.get(`http://127.0.0.1:${wire.port}/fs`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    }));
    const acceptedCurrent = snapshot.settled === false;
    if (acceptedCurrent) armRed('FS-01');
    expect(snapshot.settled).toBe(true);
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ABORT_ERR');
    expect(snapshot.errno).toBe(-1025);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('FS-02 fetch mid-flight abort must settle promptly with abort taxonomy', async () => {
  await observeRow('FS-02', async () => {
    const wire = await startWire('hold-open');
    const client = new Rezo({}, fetchAdapter);
    const controller = new AbortController();
    const pending = client.get(`http://127.0.0.1:${wire.port}/fs`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    });
    await waitFor(() => wire.hits() === 1, 'request never reached the wire');
    controller.abort();
    const snapshot = await observeSettlement(pending);
    const acceptedCurrent = snapshot.settled === false;
    if (acceptedCurrent) armRed('FS-02');
    expect(snapshot.settled).toBe(true);
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ABORT_ERR');
    expect(snapshot.errno).toBe(-1025);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('FS-03 no signal: fetch happy path stays exact (control)', async () => {
  await observeRow('FS-03', async () => {
    const wire = await startWire('happy');
    const client = new Rezo({}, fetchAdapter);
    const response = await client.get(`http://127.0.0.1:${wire.port}/fs`, {
      cache: false, retry: false, responseType: 'buffer',
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(response.data as ArrayBuffer | Buffer).equals(HAPPY_BODY)).toBe(true);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('FS-04 abort after fulfillment is a no-op (control)', async () => {
  await observeRow('FS-04', async () => {
    const wire = await startWire('happy');
    const client = new Rezo({}, fetchAdapter);
    const controller = new AbortController();
    const response = await client.get(`http://127.0.0.1:${wire.port}/fs`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    });
    expect(response.status).toBe(200);
    controller.abort();
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, 200); openTimers.add(t); });
    expect(Buffer.from(response.data as ArrayBuffer | Buffer).equals(HAPPY_BODY)).toBe(true);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

async function waitFor(condition: () => boolean, failure: string): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > 10_000) throw new InfrastructureError(`watchdog: ${failure}`);
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, 20); openTimers.add(t); });
  }
}

afterAll(async () => {
  for (const timer of openTimers) clearTimeout(timer);
  openTimers.clear();
  for (const socket of openSockets) {
    try { socket.destroy(); } catch (error) { teardownErrors.push(String((error as Error).message)); }
  }
  openSockets.clear();
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
    cleanup: { complete: openServers.size === 0 && openSockets.size === 0 && openTimers.size === 0, servers: openServers.size, sockets: openSockets.size, timers: openTimers.size },
    cleanupErrors: teardownErrors,
    file: 'test/a-plus-user-signal-propagation.test.ts',
    fixtureErrors: [] as string[],
    lateEvents: [] as string[],
    oracleMismatches,
    passed: [...passedRows].sort(),
    red: [...redRows].sort(),
    registered: [...invocations.keys()].sort(),
    runtime: RUNTIME,
    schema: 'rezo.r12.user-signal-propagation.ledger/v1',
    setupErrors: [] as string[],
    skipped: [] as string[],
    teardownErrors,
  };
  console.log(`REZO_FS_LEDGER_V1:${JSON.stringify(ledger)}`);
});
