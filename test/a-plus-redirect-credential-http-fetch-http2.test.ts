/**
 * A+ Phase 1b regression: caller credentials must not survive a redirect to a
 * different origin, on the HTTP, Fetch, and HTTP/2 adapters.
 *
 * Rezo currently forwards `Authorization` (and the source `Cookie`) across a
 * redirect that changes host or port, so any server can obtain a caller's
 * bearer token by answering with a 302. `isSameDomain()` compares only
 * `URL.hostname`, so a port change reads as same-origin, and no adapter strips
 * on a hostname change either.
 *
 * These assertions are written against the *post-repair* contract and are
 * expected to be RED until Phase 1b lands. The same-origin cases are the
 * controls that keep the cross-origin ones meaningful: they prove the tests
 * distinguish "strips on origin change" from "strips everything".
 *
 * Ground truth is the destination server, not the client-visible response —
 * a request that fails for an unrelated reason must not be mistaken for a
 * request whose credentials were stripped.
 *
 * The token is a literal placeholder. Only header *presence* is recorded.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http2Adapter } from '../src/adapters/http2';

const TOKEN = 'Bearer A-PLUS-PLACEHOLDER-NOT-A-CREDENTIAL';
const COOKIE = 'sid=a-plus-placeholder';

/** What the destination actually received. Reset before every request. */
interface Received {
  authorization: boolean;
  cookie: boolean;
  reached: boolean;
}
const received: Received = { authorization: false, cookie: false, reached: false };
/** Recorded separately: hop-by-hop, so it is not part of the inherited set. */
let receivedProxyAuthorization = false;
const resetReceived = () => {
  received.authorization = false;
  received.cookie = false;
  received.reached = false;
  receivedProxyAuthorization = false;
};

const recordAndFinish = (
  headers: Record<string, unknown>,
  end: (body: string) => void,
) => {
  received.reached = true;
  received.authorization = Boolean(headers['authorization']);
  received.cookie = Boolean(headers['cookie']);
  receivedProxyAuthorization = Boolean(headers['proxy-authorization']);
  end(JSON.stringify({ arrived: true }));
};

// ── HTTP/1.1 fixtures: one redirector, one cross-origin destination ─────────
let h1Redirector: http.Server;
let h1Destination: http.Server;
let h1RedirectorPort = 0;
let h1DestinationPort = 0;

// ── h2c fixtures: the HTTP/2 adapter cannot speak to an HTTP/1.1 server, so
//    it needs its own pair. Pointing it at the h1 fixture yields a connection
//    error that would score as a vacuous pass — the destination is never
//    reached, so no credential is observed, and nothing was actually stripped.
let h2Redirector: http2.Http2Server;
let h2Destination: http2.Http2Server;
let h2RedirectorPort = 0;
let h2DestinationPort = 0;

const listen = (server: http.Server | http2.Http2Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

beforeAll(async () => {
  h1Destination = http.createServer((req, res) => {
    recordAndFinish(req.headers as Record<string, unknown>, (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  h1DestinationPort = await listen(h1Destination);

  h1Redirector = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://placeholder');
    if (pathname === '/to-cross-host') {
      // 127.0.0.1 -> localhost: same machine, different host string AND port
      res.writeHead(302, { location: `http://localhost:${h1DestinationPort}/dest` });
      res.end();
    } else if (pathname === '/to-cross-port') {
      res.writeHead(302, { location: `http://127.0.0.1:${h1DestinationPort}/dest` });
      res.end();
    } else if (pathname === '/to-same-origin') {
      res.writeHead(302, { location: `http://127.0.0.1:${h1RedirectorPort}/final` });
      res.end();
    } else if (pathname === '/final') {
      recordAndFinish(req.headers as Record<string, unknown>, (body) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  h1RedirectorPort = await listen(h1Redirector);

  h2Destination = http2.createServer();
  h2Destination.on('session', (session) => session.on('error', () => {}));
  h2Destination.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    recordAndFinish(headers as Record<string, unknown>, (body) => {
      stream.respond({ ':status': 200, 'content-type': 'application/json' });
      stream.end(body);
    });
  });
  h2DestinationPort = await listen(h2Destination);

  h2Redirector = http2.createServer();
  h2Redirector.on('session', (session) => session.on('error', () => {}));
  h2Redirector.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    const path = String(headers[':path'] ?? '/');
    if (path === '/to-cross-host') {
      stream.respond({ ':status': 302, location: `http://localhost:${h2DestinationPort}/dest` });
      stream.end();
    } else if (path === '/to-same-origin') {
      stream.respond({ ':status': 302, location: `http://127.0.0.1:${h2RedirectorPort}/final` });
      stream.end();
    } else if (path === '/final') {
      recordAndFinish(headers as Record<string, unknown>, (body) => {
        stream.respond({ ':status': 200, 'content-type': 'application/json' });
        stream.end(body);
      });
    } else {
      stream.respond({ ':status': 404 });
      stream.end();
    }
  });
  h2RedirectorPort = await listen(h2Redirector);
});

afterAll(async () => {
  await Promise.all(
    [h1Redirector, h1Destination, h2Redirector, h2Destination].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

/** Issue one credentialed request and report what the destination saw. */
async function requestWithCredentials(
  adapter: typeof httpAdapter,
  url: string,
): Promise<Received> {
  resetReceived();
  const client = new Rezo({}, adapter);
  try {
    await client.get(url, {
      headers: { Authorization: TOKEN, Cookie: COOKIE },
      timeout: 5000,
    } as never);
  } catch {
    // A rejection is not itself a pass. The destination ledger decides.
  }
  return { ...received };
}

const adapters = [
  { name: 'http', adapter: httpAdapter, h2: false },
  { name: 'fetch', adapter: fetchAdapter, h2: false },
  { name: 'http2', adapter: http2Adapter, h2: true },
] as const;

describe('A+ Phase 1b — credentials must not cross an origin boundary on redirect', () => {
  for (const { name, adapter, h2 } of adapters) {
    describe(`${name} adapter`, () => {
      it('strips Authorization when the redirect changes host', async () => {
        const base = h2 ? h2RedirectorPort : h1RedirectorPort;
        const seen = await requestWithCredentials(adapter, `http://127.0.0.1:${base}/to-cross-host`);

        // The destination must be reached, or this assertion proves nothing.
        expect(seen.reached).toBe(true);
        expect(seen.authorization).toBe(false);
      });

      it('strips the source Cookie when the redirect changes host', async () => {
        const base = h2 ? h2RedirectorPort : h1RedirectorPort;
        const seen = await requestWithCredentials(adapter, `http://127.0.0.1:${base}/to-cross-host`);

        expect(seen.reached).toBe(true);
        expect(seen.cookie).toBe(false);
      });

      it('retains Authorization when the redirect stays on the same origin', async () => {
        const base = h2 ? h2RedirectorPort : h1RedirectorPort;
        const seen = await requestWithCredentials(adapter, `http://127.0.0.1:${base}/to-same-origin`);

        expect(seen.reached).toBe(true);
        expect(seen.authorization).toBe(true);
      });
    });
  }

  // Port-only change: the specific case `isSameDomain()`'s hostname-only
  // comparison misclassifies as same-origin. HTTP/1.1 adapters only — the h2c
  // fixture already exercises a host change.
  for (const { name, adapter } of adapters.filter((entry) => !entry.h2)) {
    it(`${name}: strips Authorization when only the port changes`, async () => {
      const seen = await requestWithCredentials(
        adapter,
        `http://127.0.0.1:${h1RedirectorPort}/to-cross-port`,
      );

      expect(seen.reached).toBe(true);
      expect(seen.authorization).toBe(false);
    });
  }
});

/**
 * P1-N01 — `Proxy-Authorization` is hop-by-hop. It addresses the proxy, never
 * the origin, so it must not appear on an origin request at all: no redirect
 * involved, no proxy configured. Rezo currently forwards it straight through.
 */
describe('A+ Phase 1b — Proxy-Authorization must never reach an origin', () => {
  for (const { name, adapter, h2 } of adapters) {
    it(`${name}: omits Proxy-Authorization on an initial request with no proxy`, async () => {
      resetReceived();
      const port = h2 ? h2RedirectorPort : h1RedirectorPort;
      const client = new Rezo({}, adapter);
      try {
        await client.get(`http://127.0.0.1:${port}/final`, {
          headers: { 'Proxy-Authorization': `Basic ${TOKEN}` },
          timeout: 5000,
        } as never);
      } catch {
        // Ground truth is the server ledger, not the client outcome.
      }

      expect(received.reached).toBe(true);
      expect(receivedProxyAuthorization).toBe(false);
    });
  }

  /**
   * An explicit `onRedirect.setHeaders` overlay must be able to set
   * destination `Authorization`/`Cookie` — but it must never be able to
   * reintroduce a hop-by-hop credential. In the HTTP adapter the overlay
   * travels on a separate carrier (`addedOptions.customHeaders`) that is
   * applied *after* the inherited headers are sanitised, so the strip alone
   * does not close this path.
   */
  it('http: an onRedirect.setHeaders overlay cannot reintroduce Proxy-Authorization', async () => {
    resetReceived();
    const client = new Rezo({}, httpAdapter);
    try {
      await client.get(`http://127.0.0.1:${h1RedirectorPort}/to-cross-port`, {
        timeout: 5000,
        // `onRedirect` is a callback that returns the directive.
        onRedirect: () => ({
          redirect: true,
          setHeaders: {
            'Proxy-Authorization': `Basic ${TOKEN}`,
            Authorization: TOKEN,
          },
        }),
      } as never);
    } catch {
      // Ground truth is the destination ledger.
    }

    expect(received.reached).toBe(true);
    // The hop-by-hop credential must not survive the overlay...
    expect(receivedProxyAuthorization).toBe(false);
    // ...while an explicit destination Authorization remains a valid overlay.
    expect(received.authorization).toBe(true);
  });
});
