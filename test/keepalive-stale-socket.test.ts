/**
 * Regression test for the keep-alive reuse race ("RezoError: Connection Reset").
 *
 * Servers close idle keep-alive sockets on their own schedule. When a pooled
 * socket is picked up just as the server kills it, the request dies with
 * ECONNRESET before a single response byte arrives. Nothing was processed, so
 * the adapter transparently retries exactly once on a fresh connection for
 * idempotent methods with a replayable (or absent) body — mirroring what
 * got/undici users get implicitly.
 *
 * The raw net server below makes the race deterministic: it serves the first
 * request on connection #1 normally (keep-alive), then destroys the socket the
 * moment the second request arrives on that reused connection.
 */

import { afterAll, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';

describe('Keep-alive stale socket transparent retry', () => {
  let connCount = 0;
  const requestsPerConn: number[] = [];

  const server = net.createServer(socket => {
    const idx = connCount++;
    requestsPerConn[idx] = 0;
    let buf = '';

    socket.on('error', () => { /* client side may reset during teardown */ });
    socket.on('data', chunk => {
      buf += chunk.toString('latin1');
      while (buf.includes('\r\n\r\n')) {
        buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
        requestsPerConn[idx]++;

        // Second request on the FIRST (reused) connection: kill the socket
        // before writing anything — the client sees ECONNRESET with zero
        // response bytes on a reused socket.
        if (idx === 0 && requestsPerConn[idx] === 2) {
          socket.destroy();
          return;
        }

        socket.write(
          'HTTP/1.1 200 OK\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 2\r\n' +
          'Connection: keep-alive\r\n' +
          '\r\n' +
          'ok'
        );
      }
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('retries once on a fresh connection and succeeds', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/`;

    const rezo = new Rezo();

    const r1 = await rezo.get(url);
    expect(r1.status).toBe(200);

    // Reuses the pooled socket; server destroys it → transparent retry → 200
    const r2 = await rezo.get(url);
    expect(r2.status).toBe(200);

    expect(connCount).toBe(2);
    expect(requestsPerConn[0]).toBe(2); // ok + killed
    expect(requestsPerConn[1]).toBe(1); // the transparent retry
  });
});
