/**
 * Regression tests for `acceptPartialBody`.
 *
 * Some servers send the payload and then tear the connection down without a
 * clean end-of-stream (or advertise a Content-Length larger than what they
 * send). Node reports `aborted`/ECONNRESET even though the received data may
 * be complete and usable.
 *
 * Default: such responses throw (silently returning a short body is the
 * dangerous default). With `acceptPartialBody: true` the request resolves
 * with whatever arrived and the response is flagged `truncated: true`.
 */

import { afterAll, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';

const PAYLOAD = 'ABCDEFGHIJKLMNOPQRST'; // 20 bytes actually sent
const ADVERTISED = 100;                  // Content-Length promised

describe('acceptPartialBody', () => {
  const server = net.createServer(socket => {
    socket.on('error', () => { /* teardown races are expected here */ });
    socket.on('data', () => {
      socket.write(
        'HTTP/1.1 200 OK\r\n' +
        'Content-Type: text/plain\r\n' +
        `Content-Length: ${ADVERTISED}\r\n` +
        'Connection: close\r\n' +
        '\r\n' +
        PAYLOAD
      );
      // Close before delivering the advertised byte count → client sees
      // an incomplete message ("aborted") despite the 200 + body bytes.
      setTimeout(() => socket.destroy(), 50);
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function url(): Promise<string> {
    if (!server.listening) {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    }
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/cut`;
  }

  it('default: a torn body still throws (with partial data attached)', async () => {
    const rezo = new Rezo();

    let caught: any;
    try {
      await rezo.get(await url());
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('ECONNRESET');
    expect(caught.response?.status).toBe(200);
    expect(String(caught.response?.data)).toContain(PAYLOAD);
  });

  it('acceptPartialBody: true resolves with the received data, flagged truncated', async () => {
    const rezo = new Rezo();

    const res = await rezo.get(await url(), { acceptPartialBody: true });

    expect(res.status).toBe(200);
    expect(res.truncated).toBe(true);
    expect(String(res.data)).toContain(PAYLOAD);
  });

  it('works as an instance-level default', async () => {
    const rezo = new Rezo({ acceptPartialBody: true });

    const res = await rezo.get(await url());

    expect(res.status).toBe(200);
    expect(res.truncated).toBe(true);
    expect(String(res.data)).toContain(PAYLOAD);
  });
});
