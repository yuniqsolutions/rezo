// Synthetic wire recorder with independently bounded startup and shutdown.
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

export interface WireRecord {
  path: string;
  method: string;
  marker: string;
}

interface Fixture {
  origin: string;
  seen: WireRecord[];
}

const lifecycleTimeout = 1000;

async function bounded(stage: string, operation: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `Loopback ${stage} exceeded ${lifecycleTimeout} ms`,
        )), lifecycleTimeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withLoopback(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const seen: WireRecord[] = [];
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  const listenAbort = new AbortController();
  let stage = 'listen';
  let stopping = false;
  let listenInitiated = false;
  let rejectStage: ((error: Error) => void) | undefined;
  const server = createServer((request, response) => {
    const record = {
      path: request.url ?? '',
      method: request.method ?? '',
      marker: request.headers.authorization ?? '',
    };
    seen.push(record);
    request.resume();
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'max-age=300',
      vary: 'Authorization',
      connection: 'close',
    });
    response.end(JSON.stringify(record));
  });
  const recordFailure = (error: unknown) => {
    if (!failures.includes(error)) failures.push(error);
  };
  const failStage = (cause: Error) => {
    const error = new Error(`Loopback ${stage} failed`, { cause });
    recordFailure(error);
    rejectStage?.(error);
  };
  const destroySockets = () => {
    for (const socket of sockets) socket.destroy();
  };
  const closeServer = () => {
    server.close((error) => { if (error) failStage(error); });
    destroySockets();
  };
  server.on('error', failStage);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (stopping) socket.destroy();
  });
  // Abort cancels a pending bind; retain a guard for a queued late listen event.
  server.on('listening', () => {
    if (stopping) closeServer();
  });
  try {
    await bounded('listen', new Promise<void>((resolve, reject) => {
      rejectStage = reject;
      server.listen({ port: 0, host: '127.0.0.1', signal: listenAbort.signal }, resolve);
      listenInitiated = true;
    }));
    rejectStage = undefined;
    stage = 'request';
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Loopback did not bind a TCP port');
    await run({ origin: `http://127.0.0.1:${address.port}`, seen });
  } catch (error) {
    recordFailure(error);
  } finally {
    stopping = true;
    stage = 'close';
    try {
      await bounded('close', new Promise<void>((resolve, reject) => {
        rejectStage = reject;
        // Success requires a real close event, not merely calling close().
        server.once('close', resolve);
        if (server.listening) closeServer();
        else if (listenInitiated) listenAbort.abort();
        else resolve(); // Synchronous listen failure never acquired a listener.
        destroySockets();
      }));
    } catch (error) {
      recordFailure(error);
    } finally {
      rejectStage = undefined;
      destroySockets();
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Loopback operation and/or cleanup failed');
}
