// Synthetic loopback only: complete raw-body capture at every configured hop.
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

export interface JsonRedirectRecord {
  path: string;
  method: string;
  contentType: string;
  bodyBytes: number[];
}

export interface JsonRedirectFixture {
  url: string;
  seen: JsonRedirectRecord[];
}

async function bounded(stage: string, operation: Promise<void>, milliseconds = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `JSON redirect loopback ${stage} exceeded ${milliseconds} ms`,
        )), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withJsonRedirectLoopback(
  redirects: readonly (307 | 308)[],
  run: (fixture: JsonRedirectFixture) => Promise<void>,
): Promise<void> {
  const seen: JsonRedirectRecord[] = [];
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
    const error = new Error(`JSON redirect loopback ${stage} failed`, { cause });
    recordFailure(error);
    rejectStage?.(error);
  };
  const server = createServer((request, response) => {
    const record: JsonRedirectRecord = {
      path: request.url ?? '', method: request.method ?? '',
      contentType: request.headers['content-type'] ?? '', bodyBytes: [],
    };
    seen.push(record); // Arrival alone is not evidence that body capture completed.
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    request.on('error', failStage);
    response.on('error', failStage);
    request.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > 16384) {
        request.destroy(new Error('Synthetic JSON redirect body exceeded 16384 bytes'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once('end', () => {
      record.bodyBytes = Array.from(Buffer.concat(chunks));
      const match = /^\/hop\/(\d+)$/.exec(record.path);
      const hop = match ? Number(match[1]) : -1;
      if (hop < 0 || hop > redirects.length) {
        response.writeHead(404, { connection: 'close' });
        response.end('Unexpected synthetic redirect route');
      } else if (hop < redirects.length) {
        response.writeHead(redirects[hop], {
          location: `/hop/${hop + 1}`, connection: 'close', 'cache-control': 'no-store',
        });
        response.end();
      } else {
        response.writeHead(200, {
          'content-type': 'text/plain', 'cache-control': 'no-store', connection: 'close',
        });
        response.end('redirect-complete');
      }
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
    if (!address || typeof address === 'string') throw new Error('JSON redirect loopback did not bind a TCP port');
    await bounded('request', run({ url: `http://127.0.0.1:${address.port}/hop/0`, seen }), 3000);
  } catch (error) {
    recordFailure(error);
  } finally {
    stopping = true;
    stage = 'close';
    try {
      await bounded('close', new Promise<void>((resolve, reject) => {
        rejectStage = reject;
        server.once('close', resolve);
        if (server.listening) closeServer();
        else if (listenInitiated) listenAbort.abort();
        else resolve();
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
  if (failures.length > 1) throw new AggregateError(failures, 'JSON redirect loopback operation and/or cleanup failed');
}
