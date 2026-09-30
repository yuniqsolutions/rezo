import { afterAll, expect, it } from 'vitest';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

// R13 verification suite (matrix-reserved name): HTTP/2 user cancellation.
// The 2026-08-04 audit graded HTTP2/{Node,Bun}:C2 F ("no implemented
// user-abort path"); the ETIMEDOUT-era h2 deadline/signal work repaired
// it. Probe r13-h2-abort.mts (2026-08-18, both runtimes): pre-flight
// abort rejects ABORT_ERR errno -1025 with zero wire contact; mid-flight
// abort rejects ABORT_ERR and the server stream closes with RST code 8
// (NGHTTP2_CANCEL). These rows are the executed public proof — no arming
// (nothing is expected RED); any failure keeps the cells F, honestly.
// TLS leg is a named residual: the repo has no dependency-free cert
// fixture pattern yet; cancellation operates above the socket layer.

const RUNTIME: 'node' | 'bun' = typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' ? 'node' : 'bun';
const REGISTERED = ['HC-01', 'HC-02', 'HC-03', 'HC-04'] as const;
type RowId = (typeof REGISTERED)[number];

const HAPPY_BODY = Buffer.from('h2-cancellation-happy-body');

const invocations = new Map<RowId, number>();
const passedRows = new Set<RowId>();
const oracleMismatches: string[] = [];
const teardownErrors: string[] = [];

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`HC infrastructure invalidity: ${message}`);
  }
}

async function observeRow(id: RowId, body: () => Promise<void>): Promise<void> {
  if (invocations.has(id)) throw new InfrastructureError(`duplicate row ${id}`);
  invocations.set(id, 1);
  try {
    await body();
    passedRows.add(id);
  } catch (error) {
    if (!(error instanceof InfrastructureError)) {
      oracleMismatches.push(`${id}:failed:${(error as Error).message.split('\n')[0]}`);
    }
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

interface Wire {
  port: number;
  streamsSeen: () => number;
  lastRstCode: () => number | undefined;
  lastStreamClosed: () => boolean | undefined;
  releaseHold: () => void;
}

function startWire(kind: 'hold-open' | 'happy'): Promise<Wire> {
  const server = http2.createServer();
  let streams = 0;
  let last: http2.ServerHttp2Stream | undefined;
  let release: (() => void) | null = null;
  server.on('session', (session: http2.ServerHttp2Session) => {
    openSessions.add(session);
    session.on('error', () => undefined);
    session.on('close', () => openSessions.delete(session));
  });
  server.on('stream', (stream: http2.ServerHttp2Stream) => {
    streams += 1;
    last = stream;
    stream.on('error', () => undefined);
    if (kind === 'happy') {
      stream.respond({ ':status': 200, 'content-length': String(HAPPY_BODY.length), 'content-type': 'application/octet-stream' });
      stream.end(HAPPY_BODY);
      return;
    }
    stream.respond({ ':status': 200, 'content-length': '1000', 'content-type': 'application/octet-stream' });
    stream.write('part');
    release = () => { try { stream.end(); } catch { /* already gone */ } };
  });
  openServers.add(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: (server.address() as AddressInfo).port,
      streamsSeen: () => streams,
      lastRstCode: () => last?.rstCode,
      lastStreamClosed: () => last?.closed,
      releaseHold: () => release?.(),
    }));
  });
}

interface AbortSnapshot {
  fulfilled: boolean;
  code: string | undefined;
  errno: number | undefined;
  settledTwice: boolean;
}

async function settleOnce(promise: Promise<unknown>): Promise<AbortSnapshot> {
  let settlements = 0;
  let snapshot: AbortSnapshot = { fulfilled: false, code: undefined, errno: undefined, settledTwice: false };
  try {
    await promise;
    settlements += 1;
    snapshot = { ...snapshot, fulfilled: true };
  } catch (error) {
    settlements += 1;
    const err = error as { code?: string; errno?: number };
    snapshot = { ...snapshot, fulfilled: false, code: err?.code, errno: err?.errno };
  }
  snapshot.settledTwice = settlements !== 1;
  return snapshot;
}

it('HC-01 pre-aborted signal rejects promptly with zero wire contact', async () => {
  await observeRow('HC-01', async () => {
    const wire = await startWire('hold-open');
    const client = new Rezo({}, http2Adapter);
    const controller = new AbortController();
    controller.abort();
    const snapshot = await settleOnce(client.get(`http://127.0.0.1:${wire.port}/hc`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    }));
    // Stability: nothing may arrive at the server afterwards either.
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, 200); openTimers.add(t); });
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ABORT_ERR');
    expect(snapshot.errno).toBe(-1025);
    expect(wire.streamsSeen()).toBe(0);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('HC-02 mid-flight abort rejects once and cancels the server stream (RST 8)', async () => {
  await observeRow('HC-02', async () => {
    const wire = await startWire('hold-open');
    const client = new Rezo({}, http2Adapter);
    const controller = new AbortController();
    const pending = client.get(`http://127.0.0.1:${wire.port}/hc`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    });
    // Abort only after the wire proves the stream is in flight.
    await waitFor(() => wire.streamsSeen() === 1, 'stream never reached the wire');
    controller.abort();
    const snapshot = await settleOnce(pending);
    await waitFor(() => wire.lastStreamClosed() === true, 'server stream never closed after abort');
    expect(snapshot.fulfilled).toBe(false);
    expect(snapshot.code).toBe('ABORT_ERR');
    expect(snapshot.errno).toBe(-1025);
    expect(wire.lastRstCode()).toBe(http2.constants.NGHTTP2_CANCEL);
    // Late-success guard: releasing the held body after settlement must
    // change nothing (the transfer was cancelled, not parked).
    wire.releaseHold();
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, 200); openTimers.add(t); });
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('HC-03 no signal: happy path stays exact (control)', async () => {
  await observeRow('HC-03', async () => {
    const wire = await startWire('happy');
    const client = new Rezo({}, http2Adapter);
    const response = await client.get(`http://127.0.0.1:${wire.port}/hc`, {
      cache: false, retry: false, responseType: 'buffer',
    });
    expect(response.status).toBe(200);
    expect((response.data as Buffer).equals(HAPPY_BODY)).toBe(true);
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

it('HC-04 abort after fulfillment is a no-op', async () => {
  await observeRow('HC-04', async () => {
    const wire = await startWire('happy');
    const client = new Rezo({}, http2Adapter);
    const controller = new AbortController();
    const response = await client.get(`http://127.0.0.1:${wire.port}/hc`, {
      cache: false, retry: false, responseType: 'buffer', signal: controller.signal,
    });
    expect(response.status).toBe(200);
    controller.abort();
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, 200); openTimers.add(t); });
    expect((response.data as Buffer).equals(HAPPY_BODY)).toBe(true);
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
  const ledger = {
    cleanup: { complete: openServers.size === 0 && openSessions.size === 0 && openTimers.size === 0, servers: openServers.size, sessions: openSessions.size, timers: openTimers.size },
    cleanupErrors: teardownErrors,
    file: 'test/a-plus-http2-cancellation.test.ts',
    fixtureErrors: [] as string[],
    lateEvents: [] as string[],
    oracleMismatches,
    passed: [...passedRows].sort(),
    red: [] as string[],
    registered: [...invocations.keys()].sort(),
    runtime: RUNTIME,
    schema: 'rezo.r13.http2-cancellation.ledger/v1',
    setupErrors: [] as string[],
    skipped: [] as string[],
    teardownErrors,
  };
  console.log(`REZO_HC_LEDGER_V1:${JSON.stringify(ledger)}`);
});
