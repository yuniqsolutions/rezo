/**
 * Claude's INDEPENDENT verification of Codex's shared-core pre-cache capability
 * guard. Written from my own probe design rather than reusing Codex's rows, so
 * the seam is checked from outside its own lane.
 *
 * Two properties, and the second is the one most likely to be traded away:
 *   1. a hidden lane carrying a per-hop guarantee must NOT be served from cache;
 *   2. a VISIBLE lane carrying the same guarantee must still be served from
 *      cache — the regression that would make the guard worse than the defect.
 *
 * Ground truth is a counting adapter: the adapter is entered or it is not.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' });
    res.end('{"ok":true}');
  });
  port = await new Promise<number>((r) =>
    server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)),
  );
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('A+ Phase 1c-c — Claude independent check of the pre-cache capability seam', () => {
  it('VISIBLE lane: a primed cache hit survives a redirect callback (no cache regression)', async () => {
    let entered = 0;
    const counting = ((...args: unknown[]) => {
      entered++;
      return (httpAdapter as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof httpAdapter;

    const client = new Rezo({ cache: true } as never, counting);
    const url = `http://127.0.0.1:${port}/visible`;

    await client.get(url, { timeout: 5000 } as never).catch(() => {});
    const afterPrime = entered;
    expect(afterPrime, 'prime must reach the adapter').toBeGreaterThan(0);

    // Same request, now WITH a per-hop guarantee. http is a visible lane: it owns
    // its own redirect loop, so the guarantee is honourable and the cached
    // response must still be served.
    const second = await client
      .get(url, { timeout: 5000, onRedirect: () => ({ redirect: true }) } as never)
      .catch((e: unknown) => e);

    expect(entered - afterPrime, 'visible lane must not re-enter the adapter').toBe(0);
    expect(
      (second as { _fromCache?: boolean })?._fromCache,
      'visible lane must still be served from cache when a callback is supplied',
    ).toBe(true);
  });

  it('control — a visible lane with no guarantee is also served from cache', async () => {
    let entered = 0;
    const counting = ((...args: unknown[]) => {
      entered++;
      return (httpAdapter as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof httpAdapter;

    const client = new Rezo({ cache: true } as never, counting);
    const url = `http://127.0.0.1:${port}/control`;

    await client.get(url, { timeout: 5000 } as never).catch(() => {});
    const afterPrime = entered;
    const second = await client.get(url, { timeout: 5000 } as never).catch((e: unknown) => e);

    expect(entered - afterPrime).toBe(0);
    expect((second as { _fromCache?: boolean })?._fromCache).toBe(true);
  });
});
