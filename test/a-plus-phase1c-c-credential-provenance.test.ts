/**
 * A+ Phase 1c-c — credential provenance and retained retry history.
 *
 * Rows R6 (structured auth / URL userinfo), R7 (Proxy-Authorization is
 * proxy-channel-only at every layer), HTTP retained retry history, and HTTP/2's
 * lifetime coverage on h2c fixtures — the coverage the lifetime file defers here
 * because it needs h2c regardless.
 *
 * Asserts the POST-repair contract; expected RED until Phase 1c-c lands.
 * Ground truth is always a destination ledger. Every failing row has a passing
 * control beside it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

const PROXY_AUTH = 'Basic A-PLUS-1CC-PROXY-PLACEHOLDER';
const OVERLAY = 'one-hop-value';

interface Seen { hits: number; headers: Array<Record<string, string>>; }
const fresh = (): Seen => ({ hits: 0, headers: [] });

let origin: http.Server; let foreign: http.Server;
let pOrigin = 0; let pForeign = 0;
let sOrigin = fresh(); let sForeign = fresh();

let h2: http2.Http2Server; let pH2 = 0; let sH2 = fresh();

const listen = (s: http.Server | http2.Http2Server): Promise<number> =>
  new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

const reset = () => { sOrigin = fresh(); sForeign = fresh(); sH2 = fresh(); };
const last = (s: Seen): Record<string, string> => s.headers[s.headers.length - 1] ?? {};

beforeAll(async () => {
  foreign = http.createServer((req, res) => {
    sForeign.hits++; sForeign.headers.push({ ...(req.headers as Record<string, string>) });
    req.on('data', () => {}); req.on('end', () => { res.writeHead(200); res.end('{"hop":"foreign"}'); });
  });
  pForeign = await listen(foreign);

  origin = http.createServer((req, res) => {
    sOrigin.hits++; sOrigin.headers.push({ ...(req.headers as Record<string, string>) });
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    req.on('data', () => {});
    req.on('end', () => {
      if (pathname === '/to-foreign') { res.writeHead(302, { location: `http://localhost:${pForeign}/f` }); res.end(); return; }
      if (pathname === '/same-hop') { res.writeHead(302, { location: `http://127.0.0.1:${pOrigin}/final` }); res.end(); return; }
      if (pathname === '/retry-once') {
        if (sOrigin.hits === 1) { res.writeHead(503); res.end('{"e":1}'); return; }
        res.writeHead(200); res.end('{"ok":true}'); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"hop":"origin"}');
    });
  });
  pOrigin = await listen(origin);

  h2 = http2.createServer();
  h2.on('session', (s) => s.on('error', () => {}));
  h2.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    sH2.hits++; sH2.headers.push({ ...(headers as Record<string, string>) });
    const path = String(headers[':path'] ?? '/');
    if (path === '/same-hop') { stream.respond({ ':status': 302, location: `http://127.0.0.1:${pH2}/final` }); stream.end(); return; }
    stream.respond({ ':status': 200, 'content-type': 'application/json' }); stream.end('{"hop":"h2"}');
  });
  pH2 = await listen(h2);
});

afterAll(async () => {
  await Promise.all([origin, foreign, h2].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const serverAdapters = [
  { name: 'http', adapter: httpAdapter },
  { name: 'fetch', adapter: fetchAdapter },
] as const;

describe('A+ Phase 1c-c — R6: structured auth materializes consistently', () => {
  for (const { name, adapter } of serverAdapters) {
    it(`${name}: structured auth reaches the origin as Authorization`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/final`, {
          timeout: 5000, auth: { username: 'u', password: 'p' },
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(1);
      // Executed baseline: http materializes `Basic dTpw`; fetch and http2 send nothing.
      expect(last(sOrigin)['authorization']).toBe('Basic dTpw');
    });

    it(`${name}: control — an explicit Authorization header still reaches the origin`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/final`, {
          timeout: 5000, headers: { Authorization: 'Basic CONTROL' },
        } as never);
      } catch { /* ledger decides */ }
      expect(sOrigin.hits).toBe(1);
      expect(last(sOrigin)['authorization']).toBe('Basic CONTROL');
    });
  }

  it('http2: control — an explicit Authorization header still reaches the origin', async () => {
    reset();
    try {
      await new Rezo({}, http2Adapter).get(`http://127.0.0.1:${pH2}/final`, {
        timeout: 5000, headers: { Authorization: 'Basic CONTROL' },
      } as never);
    } catch { /* ledger decides */ }
    expect(sH2.hits).toBe(1);
    expect(last(sH2)['authorization']).toBe('Basic CONTROL');
  });

  it('http2: structured auth reaches the origin as Authorization', async () => {
    reset();
    try {
      await new Rezo({}, http2Adapter).get(`http://127.0.0.1:${pH2}/final`, {
        timeout: 5000, auth: { username: 'u', password: 'p' },
      } as never);
    } catch { /* ledger decides */ }
    expect(sH2.hits).toBe(1);
    expect(last(sH2)['authorization']).toBe('Basic dTpw');
  });
});

describe('A+ Phase 1c-c — R7: Proxy-Authorization is proxy-channel-only at every layer', () => {
  for (const { name, adapter } of serverAdapters) {
    it(`${name}: an initial request with no proxy never sends Proxy-Authorization`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/final`, {
          timeout: 5000, headers: { 'Proxy-Authorization': PROXY_AUTH },
        } as never);
      } catch { /* ledger decides */ }
      expect(sOrigin.hits).toBe(1);
      expect(last(sOrigin)['proxy-authorization']).toBeUndefined();
    });

    it(`${name}: a one-hop patch cannot introduce Proxy-Authorization`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/same-hop`, {
          timeout: 5000,
          onRedirect: () => ({ redirect: true, setHeaders: { 'Proxy-Authorization': PROXY_AUTH, 'X-Ok': OVERLAY } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2);
      // DISCRIMINATOR: the overlay must have applied, or "no proxy-auth" is vacuous.
      expect(last(sOrigin)['x-ok']).toBe(OVERLAY);
      expect(last(sOrigin)['proxy-authorization']).toBeUndefined();
    });

    it(`${name}: a persistent patch cannot introduce Proxy-Authorization`, async () => {
      reset();
      try {
        await new Rezo({}, adapter).get(`http://127.0.0.1:${pOrigin}/same-hop`, {
          timeout: 5000,
          onRedirect: () => ({ redirect: true, setHeadersOnRedirects: { 'Proxy-Authorization': PROXY_AUTH, 'X-Ok': OVERLAY } }),
        } as never);
      } catch { /* ledger decides */ }

      expect(sOrigin.hits).toBe(2);
      expect(last(sOrigin)['x-ok']).toBe(OVERLAY);
      expect(last(sOrigin)['proxy-authorization']).toBeUndefined();
    });
  }
});

describe('A+ Phase 1c-c — HTTP retained retry history (http.ts:2423 reset)', () => {
  it('http: a successful retry retains exactly one accurate 503 error entry', async () => {
    reset();
    let result: unknown = null;
    try {
      result = await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${pOrigin}/retry-once`, {
        timeout: 6000, retry: { maxRetries: 2, retryOn: [503], delay: 30 },
      } as never);
    } catch { /* ledger decides */ }

    // Transport control — the retry itself must work (it does today).
    expect(sOrigin.hits).toBe(2);
    expect((result as { status?: number })?.status).toBe(200);

    // The defect: setInitialConfig() resets config.errors, so the successful
    // retry destroys its own history. A successful retry must leave a trace.
    const cfg = (result as {
      config?: { errors?: Array<{ attempt?: number; error?: { code?: string; status?: number } }> };
    })?.config;
    expect(cfg, 'successful response must expose the request config').toBeDefined();
    const errors = cfg!.errors ?? [];
    expect(errors).toHaveLength(1);
    // Accuracy, not merely presence: the retained entry must identify the real
    // 503 and the attempt it belongs to.
    expect(errors[0]?.error?.code).toBe('REZ_HTTP_ERROR');
    expect(errors[0]?.error?.status).toBe(503);
    expect(errors[0]?.attempt).toBe(1);
  });
});

describe('A+ Phase 1c-c — HTTP/2 lifetime coverage on h2c', () => {
  it('http2: a one-hop patch applies to its hop', async () => {
    reset();
    try {
      await new Rezo({}, http2Adapter).get(`http://127.0.0.1:${pH2}/same-hop`, {
        timeout: 5000,
        onRedirect: () => ({ redirect: true, setHeaders: { 'X-One-Hop': OVERLAY } }),
      } as never);
    } catch { /* ledger decides */ }

    expect(sH2.hits).toBe(2);
    // HTTP/2 currently invokes the callback and ignores both header fields.
    expect(last(sH2)['x-one-hop']).toBe(OVERLAY);
  });

  it('http2: a persistent patch applies to its hop', async () => {
    reset();
    try {
      await new Rezo({}, http2Adapter).get(`http://127.0.0.1:${pH2}/same-hop`, {
        timeout: 5000,
        onRedirect: () => ({ redirect: true, setHeadersOnRedirects: { 'X-Persist': OVERLAY } }),
      } as never);
    } catch { /* ledger decides */ }

    expect(sH2.hits).toBe(2);
    expect(last(sH2)['x-persist']).toBe(OVERLAY);
  });

  it('http2: control — a plain same-origin redirect is followed', async () => {
    reset();
    try {
      await new Rezo({}, http2Adapter).get(`http://127.0.0.1:${pH2}/same-hop`, { timeout: 5000 } as never);
    } catch { /* ledger decides */ }
    expect(sH2.hits).toBe(2);
  });
});
