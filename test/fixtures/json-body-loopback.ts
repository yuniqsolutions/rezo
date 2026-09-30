// Synthetic receiver: capture actual request bytes, including empty bodies.
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

export interface BodyWireRecord {
  path: string;
  method: string;
  contentType: string;
  bodyBytes: number[];
}

export interface JsonBodyFixture {
  url: string;
  seen: BodyWireRecord[];
}

async function bounded(stage: string, operation: Promise<void>, milliseconds = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `JSON loopback ${stage} exceeded ${milliseconds} ms`,
        )), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withJsonBodyLoopback(run: (fixture: JsonBodyFixture) => Promise<void>): Promise<void> {
  const seen: BodyWireRecord[] = [];
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  const listenAbort = new AbortController();
  let stage = 'listen';
  let stopping = false;
  let listenInitiated = false;
  let rejectStage: ((error: Error) => void) | undefined;
  const recordFailure = (error: unknown) => {
    if (!failures.includes(error)) failures.push(error);
  };
  const failStage = (cause: Error) => {
    const error = new Error(`JSON loopback ${stage} failed`, { cause });
    recordFailure(error);
    rejectStage?.(error);
  };
  const server = createServer((request, response) => {
    const record: BodyWireRecord = {
      path: request.url ?? '', method: request.method ?? '',
      contentType: request.headers['content-type'] ?? '', bodyBytes: [],
    };
    seen.push(record); // Arrival is recorded even if the body never completes.
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    request.on('error', failStage);
    response.on('error', failStage);
    request.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > 16384) {
        request.destroy(new Error('Synthetic JSON request exceeded 16384 bytes'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once('end', () => {
      record.bodyBytes = Array.from(Buffer.concat(chunks));
      response.writeHead(200, {
        'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close',
      });
      response.end(JSON.stringify(record));
    });
  });
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
  server.on('listening', () => {
    if (stopping) closeServer(); // Defensive cleanup of a queued late bind.
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
    if (!address || typeof address === 'string') throw new Error('JSON loopback did not bind a TCP port');
    await bounded('request', run({ url: `http://127.0.0.1:${address.port}/json-body`, seen }), 3000);
  } catch (error) {
    recordFailure(error);
  } finally {
    stopping = true;
    stage = 'close';
    try {
      await bounded('close', new Promise<void>((resolve, reject) => {
        rejectStage = reject;
        server.once('close', resolve); // Calling close() alone is not success.
        if (server.listening) closeServer();
        else if (listenInitiated) listenAbort.abort();
        else resolve(); // A synchronous listen failure acquired no listener.
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
  if (failures.length > 1) throw new AggregateError(failures, 'JSON loopback operation and/or cleanup failed');
}
