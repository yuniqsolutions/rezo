import { createServer } from 'node:http';
import { createServer as createH2Server } from 'node:http2';
import type { ServerHttp2Session } from 'node:http2';
import type { Socket } from 'node:net';

export interface BodyRecord {
  method: string;
  bytes: number[];
  contentType?: string;
  contentLength?: string;
  path: string;
}

export async function rawBodyReceiver(http2 = false, reply?: (record: BodyRecord, records: BodyRecord[]) => {
  status: number; headers?: Record<string, string>;
}, onChunk?: () => void) {
  const records: BodyRecord[] = [];
  const arrivals: string[] = [];
  const sockets = new Set<Socket>();
  const sessions = new Set<ServerHttp2Session>();
  const errors: Error[] = [];
  const server = http2 ? createH2Server() : createServer();
  server.on('request', (request, response) => {
    arrivals.push(request.url ?? '');
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('error', (error: Error) => { if (!request.aborted) errors.push(error); });
    response.on('error', (error: Error) => errors.push(error));
    request.on('data', (chunk: Buffer) => {
      length += chunk.byteLength;
      onChunk?.();
      if (length > 1024 * 1024) request.destroy(new Error('Synthetic body exceeds fixture limit'));
      else chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => {
      const record: BodyRecord = {
        method: request.method ?? '',
        bytes: Array.from(Buffer.concat(chunks)), path: request.url ?? '',
        contentType: request.headers['content-type'], contentLength: request.headers['content-length'],
      };
      records.push(record);
      const selected = reply?.(record, records);
      response.writeHead(selected?.status ?? 200, {
        'content-type': 'application/json', 'cache-control': 'no-store', ...selected?.headers,
      });
      response.end(JSON.stringify(record));
    });
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  if (http2) server.on('session', (session: ServerHttp2Session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
    session.on('error', error => errors.push(error));
  });
  server.on('error', error => errors.push(error));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Receiver failed to acquire a port');
  return {
    url: `http://127.0.0.1:${address.port}`, records, arrivals,
    async close() {
      for (const session of sessions) session.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      if (errors.length) throw new AggregateError(errors, 'Body receiver failed');
    },
  };
}
