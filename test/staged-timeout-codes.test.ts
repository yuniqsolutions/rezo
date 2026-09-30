/**
 * Regression tests for staged-timeout error codes.
 *
 * Two bugs previously made timeouts surface as "RezoError: Connection Reset":
 *
 * 1. `createTimeoutError()` mapped `body` and `total` phase timeouts to the
 *    code `ECONNRESET`, and the RezoError constructor replaces the message
 *    with the registry text for the code — so every exceeded `timeout`
 *    reported as a connection reset instead of a timeout.
 *
 * 2. `createTimeoutError()` assigned to `error.isRetryable`, which RezoError
 *    defines as a read-only property. Under ESM strict mode (this package is
 *    `"type": "module"`) that assignment threw
 *    `TypeError: Cannot assign to read only property 'isRetryable'`
 *    from inside the timeout timer callback.
 */

import { afterAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { RezoError } from '../src/errors/rezo-error';
import { StagedTimeoutManager } from '../src/utils/staged-timeout';

describe('StagedTimeoutManager.createTimeoutError (unit)', () => {
  const manager = new StagedTimeoutManager({
    connect: 100,
    headers: 100,
    body: 100,
    total: 100,
  });

  it('does not throw when constructing a timeout error (ESM read-only crash regression)', () => {
    // The factory returns the error; it must never throw. (Bun's toThrow treats a
    // returned Error as thrown, so the return value is captured explicitly.)
    let created: unknown;
    expect(() => { created = manager.createTimeoutError('total', 100); }).not.toThrow();
    expect(created).toBeInstanceOf(RezoError);
    for (const phase of ['body', 'headers', 'connect'] as const) {
      let phaseError: unknown;
      expect(() => { phaseError = manager.createTimeoutError(phase, 100); }).not.toThrow();
      expect(phaseError).toBeInstanceOf(RezoError);
    }
  });

  it('maps each phase to a timeout code — never ECONNRESET', () => {
    const codes: Record<string, string> = {
      connect: 'ETIMEDOUT',
      headers: 'ESOCKETTIMEDOUT',
      body: 'ESOCKETTIMEDOUT',
      total: 'ECONNABORTED',
    };

    for (const [phase, expected] of Object.entries(codes)) {
      const err = manager.createTimeoutError(phase, 100) as any;
      expect(err.code).toBe(expected);
      expect(err.code).not.toBe('ECONNRESET');
      expect(err.isTimeout).toBe(true);
      expect(err.phase).toBe(phase);
      expect(err.elapsed).toBe(100);
    }
  });

  it('timeout errors are flagged retryable via their code', () => {
    for (const phase of ['connect', 'headers', 'body', 'total']) {
      const err = manager.createTimeoutError(phase, 100) as any;
      expect(err.isRetryable).toBe(true);
    }
  });

  it('keeps the specific phase message instead of registry boilerplate', () => {
    const err = manager.createTimeoutError('total', 100) as any;
    expect(err.message).toContain('Total timeout');
    expect(err.message).toContain('100ms');
    // Registry text is still available for context
    expect(err.details).toBeTruthy();
    expect(err.suggestion).toBeTruthy();
  });
});

describe('RezoError message preservation', () => {
  it('prefers the caller message when a code is present', () => {
    const err = new RezoError('Something specific happened', {} as any, 'ECONNABORTED');
    expect(err.message).toBe('Something specific happened');
    expect((err as any).details).toBeTruthy();
  });

  it('falls back to the registry message when no message is given', () => {
    const err = new RezoError('', {} as any, 'ECONNRESET');
    expect(err.message).toBe('Connection Reset');
  });
});

describe('Timeout error codes (integration, real server)', () => {
  const timers: NodeJS.Timeout[] = [];
  const server = http.createServer((req, res) => {
    res.on('error', () => { /* client destroyed the socket first — expected */ });
    // Never respond within the client timeout
    timers.push(setTimeout(() => {
      try { res.end('late'); } catch { /* ignore */ }
    }, 5000));
  });

  afterAll(async () => {
    for (const t of timers) clearTimeout(t);
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function startServer(): Promise<string> {
    if (!server.listening) {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    }
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/slow`;
  }

  it('total timeout surfaces as ECONNABORTED, not ECONNRESET', async () => {
    const url = await startServer();
    const rezo = new Rezo();

    let caught: any;
    try {
      await rezo.get(url, { timeout: { total: 250 } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('ECONNABORTED');
    expect(caught.code).not.toBe('ECONNRESET');
    expect(caught.phase).toBe('total');
    expect(caught.isTimeout).toBe(true);
  });

  it('headers timeout surfaces as ESOCKETTIMEDOUT, not ECONNRESET', async () => {
    const url = await startServer();
    const rezo = new Rezo();

    let caught: any;
    try {
      await rezo.get(url, { timeout: { headers: 250 } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('ESOCKETTIMEDOUT');
    expect(caught.code).not.toBe('ECONNRESET');
    expect(caught.phase).toBe('headers');
    expect(caught.isTimeout).toBe(true);
  });
});
