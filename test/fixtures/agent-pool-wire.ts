import { get, type Agent, type RequestOptions } from 'node:https';
import type { Socket } from 'node:net';
import { createServer } from 'node:tls';
import type { PoolTlsMaterial } from './agent-pool-tls-material.js';

async function bounded(stage: string, operation: Promise<void>, milliseconds = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Pool TLS ${stage} exceeded ${milliseconds} ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export interface PoolWireFixture { url: string; seen: string[]; tlsErrors: string[] }

export async function withPoolWire(material: PoolTlsMaterial, clientAuth: boolean,
  run: (fixture: PoolWireFixture) => Promise<void>): Promise<void> {
  const seen: string[] = [];
  const tlsErrors: string[] = [];
  const failures: unknown[] = [];
  const sockets = new Set<Socket>();
  const signal = new AbortController();
  let stopping = false;
  let started = false;
  let stage = 'listen';
  let rejectStage: ((error: Error) => void) | undefined;
  const recordFailure = (error: unknown) => { if (!failures.includes(error)) failures.push(error); };
  const fail = (cause: Error) => {
    const error = new Error(`Pool TLS ${stage} failed`, { cause });
    recordFailure(error); rejectStage?.(error);
  };
  const server = createServer({ key: material.server.key, cert: material.server.cert,
    ca: [material.first.cert, material.second.cert], requestCert: clientAuth, rejectUnauthorized: clientAuth,
  }, (socket) => {
    if (clientAuth && !socket.authorized) {
      fail(new Error('Pool TLS receiver did not authenticate the client certificate'));
      socket.destroy();
      return;
    }
    const peer = socket.getPeerCertificate();
    const commonName = peer.subject?.CN;
    const identity = Array.isArray(commonName) ? commonName.join(',') : commonName ?? 'no-client-certificate';
    let headers = '';
    socket.on('error', fail);
    socket.on('data', (chunk: Buffer) => {
      headers += chunk.toString('latin1');
      if (headers.length > 16384) {
        socket.destroy(new Error('Pool TLS fixture received oversized HTTP headers'));
      } else if (headers.includes('\r\n\r\n')) {
        socket.removeAllListeners('data');
        seen.push(identity);
        socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(identity)}\r\nConnection: close\r\n\r\n${identity}`);
      }
    });
  });
  const destroySockets = () => { for (const socket of sockets) socket.destroy(); };
  const close = () => { server.close((error) => { if (error) fail(error); }); destroySockets(); };
  server.on('error', fail);
  // TLS refusals are expected inputs for negative trust/credential rows.
  server.on('tlsClientError', (error: Error & { code?: string }) => tlsErrors.push(error.code ?? error.name));
  server.on('connection', (socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    if (stopping) socket.destroy();
  });
  server.on('listening', () => { if (stopping) close(); });
  try {
    await bounded('listen', new Promise<void>((resolve, reject) => {
      rejectStage = reject;
      server.listen({ host: '127.0.0.1', port: 0, signal: signal.signal }, resolve);
      started = true;
    }));
    rejectStage = undefined; stage = 'request';
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Pool TLS fixture did not bind');
    await bounded('request', run({ url: `https://127.0.0.1:${address.port}/`, seen, tlsErrors }), 6000);
  } catch (error) { recordFailure(error); }
  finally {
    stopping = true; stage = 'close';
    try {
      await bounded('close', new Promise<void>((resolve, reject) => {
        rejectStage = reject; server.once('close', resolve);
        if (server.listening) close(); else if (started) signal.abort(); else resolve();
        destroySockets();
      }));
    } catch (error) { recordFailure(error); }
    finally { rejectStage = undefined; destroySockets(); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Pool TLS operation and/or cleanup failed');
}

export function requestThroughAgent(url: string, agent: Agent,
  extraOptions: Pick<RequestOptions, 'pfx' | 'passphrase'> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedResponse = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, body?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(body ?? '');
    };
    const request = get(url, { agent, ...extraOptions }, (response) => {
      receivedResponse = true;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('error', (error) => finish(error));
      response.once('aborted', () => finish(new Error('Pool TLS response aborted')));
      response.once('end', () => response.statusCode === 200 ? finish(undefined, body)
        : finish(new Error(`Pool TLS response status ${response.statusCode}`)));
      response.once('close', () => { if (!settled) finish(new Error('Pool TLS response closed before settlement')); });
    });
    timer = setTimeout(() => {
      const error = new Error('Pool TLS request exceeded 2000 ms');
      finish(error); request.destroy(error);
    }, 2000);
    // Bun closes the request before buffered response data/end events drain.
    // Once a response exists, its own end/close/error and the deadline own settlement.
    request.once('close', () => {
      if (!settled && !receivedResponse) finish(new Error('Pool TLS request closed before response'));
    });
    request.once('error', (error) => finish(error));
  });
}
