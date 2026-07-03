/**
 * Regression tests for the debug error dump.
 *
 * With `debug: true`, a failing request must print the full diagnostic
 * fingerprint (name, code, response state, attempt history) so users never
 * have to hand-write try/catch logging to understand a failure.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';

describe('debug: true dumps the full error', () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
  });

  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
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

  it('HTTP error (404) dump includes code, response line and data info', async () => {
    const base = await baseUrl();
    const rezo = new Rezo();

    await expect(rezo.get(`${base}/missing`, { debug: true })).rejects.toThrow();

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('REZ_HTTP_ERROR');
    expect(output).toContain('Response: 404');
    expect(output).toMatch(/data: (object|string)/);
  });

  it('network error (ECONNREFUSED) dump reports no response received', async () => {
    const rezo = new Rezo();

    // Port 1 on localhost: nothing listens there
    await expect(
      rezo.get('http://127.0.0.1:1/', { debug: true })
    ).rejects.toThrow();

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('ECONNREFUSED');
    expect(output).toContain('Response: none received');
  });

  it('trackUrl (without debug) prints a single failure summary line', async () => {
    const base = await baseUrl();
    const rezo = new Rezo();

    await expect(rezo.get(`${base}/missing`, { trackUrl: true } as any)).rejects.toThrow();

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('[Rezo Track] ✗');
    // Full dump lines must NOT appear without debug
    expect(output).not.toContain('Flags: timeout=');
  });
});
