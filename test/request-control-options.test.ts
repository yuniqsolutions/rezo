/**
 * Regression tests for request-control options being dropped before the adapter.
 *
 * `prepareHTTPOptions` builds a fresh `fetchOptions` object and only copies
 * whitelisted fields. `timeout`, `signal`, and `auth` were missing from that
 * whitelist, so all three silently did nothing on the standard request path:
 * timeouts never armed, user AbortSignals couldn't cancel requests, and
 * `auth` never became an Authorization header.
 *
 * (`timeout` end-to-end coverage lives in staged-timeout-codes.test.ts.)
 */

import { afterAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';

describe('Request control options reach the adapter', () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/echo-auth') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers['authorization'] || null }));
      return;
    }
    // anything else (/hang): never respond
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function baseUrl(): Promise<string> {
    if (!server.listening) {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    }
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it('user AbortSignal cancels an in-flight request', async () => {
    const base = await baseUrl();
    const rezo = new Rezo();

    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 150);

    let caught: any;
    try {
      await rezo.get(`${base}/hang`, { signal: controller.signal });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Must reject promptly after abort(), not hang until some other limit
    expect(Date.now() - started).toBeLessThan(2000);
    expect(caught.code).toBe('ABORT_ERR');
  });

  it('auth option produces a Basic Authorization header', async () => {
    const base = await baseUrl();
    const rezo = new Rezo();

    const res = await rezo.get(`${base}/echo-auth`, {
      auth: { username: 'user', password: 'pass' },
    });

    const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
    expect(res.data?.authorization).toBe(expected);
  });
});

describe('keepAlive option controls connection reuse', () => {
  function startCountingServer(): Promise<{ url: string; connections: () => number; close: () => Promise<void> }> {
    let connCount = 0;
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
    });
    server.on('connection', () => connCount++);
    return new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          url: `http://127.0.0.1:${port}/`,
          connections: () => connCount,
          close: () => new Promise<void>(r => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
        });
      });
    });
  }

  it('keepAlive: false opens a fresh connection for every request', async () => {
    const srv = await startCountingServer();
    try {
      const rezo = new Rezo();
      await rezo.get(srv.url, { keepAlive: false });
      await rezo.get(srv.url, { keepAlive: false });
      expect(srv.connections()).toBe(2);
    } finally {
      await srv.close();
    }
  });

  it('default (keepAlive on) reuses the pooled connection', async () => {
    const srv = await startCountingServer();
    try {
      const rezo = new Rezo();
      await rezo.get(srv.url);
      await rezo.get(srv.url);
      expect(srv.connections()).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('instance default keepAlive: false is honored', async () => {
    const srv = await startCountingServer();
    try {
      const rezo = new Rezo({ keepAlive: false });
      await rezo.get(srv.url);
      await rezo.get(srv.url);
      expect(srv.connections()).toBe(2);
    } finally {
      await srv.close();
    }
  });
});
