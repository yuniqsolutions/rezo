/**
 * Phase 1c-c HTTP/2 R5 — Cookie/jar/XSRF recomposition.
 *
 * Every scenario uses real h2c dispatch and compares the complete wire ledger.
 * This keeps absence distinct from an empty Cookie header and makes duplicate,
 * reordered, or otherwise unexpected requests visible.
 */

import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Rezo } from '../src';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import type { RezoResponse } from '../src/types/response';
import { RezoHeaders } from '../src/utils/headers';

type FixtureName = 'source' | 'foreign';

interface WireObservation {
  readonly authority: string;
  readonly control: string | null;
  readonly cookie: string | null;
  readonly cookies: Record<string, string>;
  readonly lifetimeWitness: string | null;
  readonly name: FixtureName;
  readonly ordinal: number;
  readonly path: string;
  readonly retryWitness: string | null;
  readonly xsrf: string | null;
}

interface ExpectedWireObservation {
  readonly control?: string | null;
  readonly cookie?: string | null;
  readonly cookies?: Record<string, string>;
  readonly lifetimeWitness?: string | null;
  readonly name: FixtureName;
  readonly path: string;
  readonly retryWitness?: string | null;
  readonly xsrf?: string | null;
}

interface PlannedResponse {
  readonly location?: string;
  readonly onRequest?: () => void;
  readonly reset?: boolean;
  readonly setCookie?: readonly string[];
  readonly status: number;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

let sourceServer: http2.Http2Server | undefined;
let foreignServer: http2.Http2Server | undefined;
let sourcePort = 0;
let foreignPort = 0;
let wire: WireObservation[] = [];
let fixtureErrors: string[] = [];
let routes = new Map<string, readonly PlannedResponse[]>();
const sessions = new Set<http2.ServerHttp2Session>();
const ASYNC_HOOK_BARRIER_MS = 1_000;

function sourceUrl(path: string): string {
  return `http://127.0.0.1:${sourcePort}${path}`;
}

function foreignUrl(path: string): string {
  return `http://127.0.0.1:${foreignPort}${path}`;
}

function authority(name: FixtureName): string {
  return `127.0.0.1:${name === 'source' ? sourcePort : foreignPort}`;
}

function headerValue(
  headers: http2.IncomingHttpHeaders,
  name: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(headers, name)) return null;
  const value = headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}

function cookieRecord(value: string | null): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(';').map((part) => {
    const separator = part.indexOf('=');
    const name = separator < 0 ? part.trim() : part.slice(0, separator).trim();
    const cookieValue = separator < 0 ? '' : part.slice(separator + 1).trim();
    return [name, cookieValue];
  }));
}

function routeKey(name: FixtureName, path: string): string {
  return `${name}:${path}`;
}

function planRoute(
  name: FixtureName,
  path: string,
  response: PlannedResponse | readonly PlannedResponse[],
): void {
  routes.set(routeKey(name, path), Array.isArray(response) ? response : [response]);
}

function planRedirect(
  name: FixtureName,
  path: string,
  location: string,
  options: Omit<PlannedResponse, 'location' | 'status'> = {},
): void {
  planRoute(name, path, { ...options, location, status: 302 });
}

function planTerminal(
  name: FixtureName,
  path: string,
  options: Omit<PlannedResponse, 'status'> = {},
): void {
  planRoute(name, path, { ...options, status: 200 });
}

function expectedWire(
  entries: readonly ExpectedWireObservation[],
): WireObservation[] {
  return entries.map((entry, index) => {
    const cookies = entry.cookies ?? {};
    const cookie = entry.cookie === undefined
      ? (Object.keys(cookies).length === 0
          ? null
          : Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; '))
      : entry.cookie;
    return {
      authority: authority(entry.name),
      control: entry.control ?? null,
      cookie,
      cookies,
      lifetimeWitness: entry.lifetimeWitness ?? null,
      name: entry.name,
      ordinal: index + 1,
      path: entry.path,
      retryWitness: entry.retryWitness ?? null,
      xsrf: entry.xsrf ?? null,
    };
  });
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function destinationArrivedBeforeBarrier(
  destinationArrival: Promise<void>,
  barrierMs = ASYNC_HOOK_BARRIER_MS,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const barrier = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), barrierMs);
  });
  const result = await Promise.race([
    destinationArrival.then(() => true),
    barrier,
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  return result;
}

function retryState(response: RezoResponse<unknown>): unknown {
  return {
    attempts: response.config.errors.map((entry) => ({
      attempt: entry.attempt,
      code: entry.error?.code,
      status: entry.error?.status,
    })),
    history: response.config.redirectHistory.map((entry) => ({
      method: entry.method,
      statusCode: entry.statusCode,
      url: entry.url,
    })),
    redirectCount: response.config.redirectCount,
    retryAttempts: response.config.retryAttempts,
  };
}

async function handleStream(
  name: FixtureName,
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
): Promise<void> {
  const path = String(headers[':path'] ?? '');
  for await (const _chunk of stream) {
    // Drain request bodies so every fixture path observes a complete stream.
  }

  const rawCookie = headerValue(headers, 'cookie');
  wire.push({
    authority: headerValue(headers, ':authority') ?? '',
    control: headerValue(headers, 'x-control'),
    cookie: rawCookie,
    cookies: cookieRecord(rawCookie),
    lifetimeWitness: headerValue(headers, 'x-lifetime-witness'),
    name,
    ordinal: wire.length + 1,
    path,
    retryWitness: headerValue(headers, 'x-retry-witness'),
    xsrf: headerValue(headers, 'x-xsrf-token'),
  });

  const plan = routes.get(routeKey(name, path));
  if (!plan) {
    fixtureErrors.push(`unexpected fixture route: ${name}:${path}`);
    stream.respond({ ':status': 404 });
    stream.end('unexpected route');
    return;
  }

  const attempt = wire.filter((entry) => entry.name === name && entry.path === path).length;
  const response = plan[Math.min(attempt - 1, plan.length - 1)];
  response.onRequest?.();

  if (response.reset) {
    stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
    return;
  }

  const outgoing: http2.OutgoingHttpHeaders = { ':status': response.status };
  if (response.location !== undefined) outgoing.location = response.location;
  if (response.setCookie !== undefined) outgoing['set-cookie'] = [...response.setCookie];
  if (response.status === 200) outgoing['content-type'] = 'application/json';
  stream.respond(outgoing);
  stream.end(response.status === 200
    ? JSON.stringify({ name, path, reached: true })
    : `fixture status ${response.status}`);
}

function createServer(name: FixtureName): http2.Http2Server {
  const server = http2.createServer();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
    session.on('error', () => {});
  });
  server.on('stream', (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
  ) => {
    stream.on('error', () => {});
    void handleStream(name, stream, headers).catch((error: unknown) => {
      fixtureErrors.push(String((error as { message?: unknown })?.message ?? error));
      if (!stream.destroyed && !stream.closed) stream.destroy();
    });
  });
  return server;
}

function listen(server: http2.Http2Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectListen(new TypeError('h2c fixture did not expose an IP port'));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeServer(server: http2.Http2Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

beforeAll(async () => {
  sourceServer = createServer('source');
  foreignServer = createServer('foreign');
  try {
    sourcePort = await listen(sourceServer);
    foreignPort = await listen(foreignServer);
  } catch (error) {
    for (const session of sessions) session.destroy();
    sessions.clear();
    await Promise.allSettled([closeServer(sourceServer), closeServer(foreignServer)]);
    throw error;
  }
});

afterAll(async () => {
  for (const session of sessions) session.destroy();
  sessions.clear();
  await Promise.all([closeServer(sourceServer), closeServer(foreignServer)]);
});

beforeEach(() => {
  fixtureErrors = [];
  routes = new Map();
  wire = [];
});

afterEach(() => {
  expect(fixtureErrors).toEqual([]);
});

function client(jar?: RezoCookieJar): Rezo {
  return new Rezo(jar ? { jar } : {}, http2Adapter);
}

const requestDefaults = Object.freeze({ cache: false, timeout: 5_000 });

describe('Phase 1c-c HTTP/2 R5 — destination jar controls', () => {
  it('control: projects the strict request jar and automatic XSRF onto a real h2c wire', async () => {
    planTerminal('foreign', '/direct-projection');
    const jar = new RezoCookieJar(null, { allowSecureOnLocal: false });
    jar.setCookiesSync([
      'matched=destination; Path=/direct-projection',
      'XSRF-TOKEN=destination-token; Path=/direct-projection',
      'wrong_path=blocked; Path=/wrong-path',
    ], foreignUrl('/direct-projection'));
    jar.setCookiesSync(
      ['wrong_domain=blocked; Path=/direct-projection'],
      `http://localhost:${foreignPort}/direct-projection`,
    );
    jar.setCookiesSync(
      ['secure_only=blocked; Path=/direct-projection; Secure'],
      `https://127.0.0.1:${foreignPort}/direct-projection`,
    );

    expect(cookieRecord(jar.getCookieHeader(foreignUrl('/direct-projection')))).toEqual({
      matched: 'destination',
      'XSRF-TOKEN': 'destination-token',
    });
    expect(cookieRecord(jar.getCookieHeader(`https://127.0.0.1:${foreignPort}/direct-projection`)))
      .toEqual({
        matched: 'destination',
        'XSRF-TOKEN': 'destination-token',
        secure_only: 'blocked',
      });
    expect(cookieRecord(jar.getCookieHeader(foreignUrl('/wrong-path')))).toEqual({
      wrong_path: 'blocked',
    });
    expect(cookieRecord(jar.getCookieHeader(`http://localhost:${foreignPort}/direct-projection`)))
      .toEqual({ wrong_domain: 'blocked' });

    const response = await client(jar).get(foreignUrl('/direct-projection'), {
      ...requestDefaults,
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      {
        name: 'foreign',
        path: '/direct-projection',
        cookies: { matched: 'destination', 'XSRF-TOKEN': 'destination-token' },
        xsrf: 'destination-token',
      },
    ]));
  });

  it('control: a non-Cookie callback patch does not suppress destination jar projection', async () => {
    planRedirect('source', '/callback-control/source', foreignUrl('/callback-control/final'));
    planTerminal('foreign', '/callback-control/final');
    const instance = client();
    instance.setCookies(
      ['matched=destination; Path=/callback-control/final'],
      foreignUrl('/callback-control/final'),
    );
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/callback-control/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return { redirect: true, setHeaders: { 'X-Control': 'present' } };
      },
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(1);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/callback-control/source' },
      {
        control: 'present',
        cookies: { matched: 'destination' },
        name: 'foreign',
        path: '/callback-control/final',
      },
    ]));
  });

  it('keeps a same-origin literal Cookie while adding destination jar Cookie/XSRF', async () => {
    planRedirect('source', '/literal-coexist/source', sourceUrl('/literal-coexist/destination'));
    planTerminal('source', '/literal-coexist/destination');
    const instance = client();
    instance.setCookies(
      ['XSRF-TOKEN=destination-token; Path=/literal-coexist/destination'],
      sourceUrl('/literal-coexist/destination'),
    );

    const response = await instance.get(sourceUrl('/literal-coexist/source'), {
      ...requestDefaults,
      headers: { Cookie: 'literal=caller' },
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      { cookies: { literal: 'caller' }, name: 'source', path: '/literal-coexist/source' },
      {
        cookie: 'literal=caller; XSRF-TOKEN=destination-token',
        cookies: { 'XSRF-TOKEN': 'destination-token', literal: 'caller' },
        name: 'source',
        path: '/literal-coexist/destination',
        xsrf: 'destination-token',
      },
    ]));
    expect(Object.fromEntries(
      response.config.requestCookies.map((cookie) => [cookie.key, cookie.value]),
    )).toEqual({ 'XSRF-TOKEN': 'destination-token', literal: 'caller' });
    expect(cookieRecord(response.cookies.string)).toEqual({
      'XSRF-TOKEN': 'destination-token',
      literal: 'caller',
    });
  });

  it('expires a literal Cookie at a port-origin boundary and projects only destination jar state', async () => {
    planRedirect('source', '/literal-cross/source', foreignUrl('/literal-cross/destination'));
    planTerminal('foreign', '/literal-cross/destination');
    const instance = client();
    instance.setCookies(
      ['matched=destination; Path=/literal-cross/destination'],
      foreignUrl('/literal-cross/destination'),
    );

    const response = await instance.get(sourceUrl('/literal-cross/source'), {
      ...requestDefaults,
      headers: { Cookie: 'literal=source' },
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      { cookies: { literal: 'source' }, name: 'source', path: '/literal-cross/source' },
      {
        cookies: { matched: 'destination' },
        name: 'foreign',
        path: '/literal-cross/destination',
      },
    ]));
  });

  it('uses a request custom jar for request and response state without touching the instance jar', async () => {
    planTerminal('source', '/request-custom-jar', {
      setCookie: ['responseJar=accepted; Path=/request-custom-jar'],
    });
    const instanceJar = new RezoCookieJar();
    const requestJar = new RezoCookieJar();
    instanceJar.setCookiesSync(
      ['instanceJar=blocked; Path=/request-custom-jar'],
      sourceUrl('/request-custom-jar'),
    );
    requestJar.setCookiesSync(
      ['requestJar=selected; Path=/request-custom-jar'],
      sourceUrl('/request-custom-jar'),
    );
    const instance = new Rezo({ jar: instanceJar }, http2Adapter);

    const response = await instance.get(sourceUrl('/request-custom-jar'), {
      ...requestDefaults,
      jar: requestJar,
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      {
        cookies: { requestJar: 'selected' },
        name: 'source',
        path: '/request-custom-jar',
      },
    ]));
    expect(cookieRecord(requestJar.getCookieHeader(sourceUrl('/request-custom-jar'))))
      .toEqual({ requestJar: 'selected', responseJar: 'accepted' });
    expect(cookieRecord(instanceJar.getCookieHeader(sourceUrl('/request-custom-jar'))))
      .toEqual({ instanceJar: 'blocked' });
  });

  it('honours default Cookie, request precedence, and manual Cookie with useCookies false', async () => {
    planTerminal('source', '/default-cookie');
    planTerminal('source', '/request-cookie');
    planTerminal('source', '/manual-no-jar');
    const jar = new RezoCookieJar();
    jar.setCookiesSync(
      ['jarCookie=blocked; Path=/manual-no-jar'],
      sourceUrl('/manual-no-jar'),
    );
    const instance = new Rezo({
      headers: { Cookie: 'default=caller' },
      jar,
    }, http2Adapter);

    const defaultResponse = await instance.get(sourceUrl('/default-cookie'), requestDefaults);
    const requestResponse = await instance.get(sourceUrl('/request-cookie'), {
      ...requestDefaults,
      headers: { Cookie: 'request=winner' },
    } as never);
    const manualResponse = await instance.get(sourceUrl('/manual-no-jar'), {
      ...requestDefaults,
      headers: { Cookie: 'manual=caller' },
      useCookies: false,
    } as never);

    expect([defaultResponse.status, requestResponse.status, manualResponse.status])
      .toEqual([200, 200, 200]);
    expect(wire).toEqual(expectedWire([
      { cookies: { default: 'caller' }, name: 'source', path: '/default-cookie' },
      { cookies: { request: 'winner' }, name: 'source', path: '/request-cookie' },
      { cookies: { manual: 'caller' }, name: 'source', path: '/manual-no-jar' },
    ]));
  });
});

describe('Phase 1c-c HTTP/2 R5 — callback authority and lifetime', () => {
  it('lets one-hop callback Cookie beat jar/XSRF, then restores the next destination jar', async () => {
    planRedirect('source', '/one-hop/source', sourceUrl('/one-hop/middle'));
    planRedirect('source', '/one-hop/middle', sourceUrl('/one-hop/final'));
    planTerminal('source', '/one-hop/final');
    const instance = client();
    instance.setCookies([
      'jar_middle=destination; Path=/one-hop/middle',
      'XSRF-TOKEN=middle-token; Path=/one-hop/middle',
    ], sourceUrl('/one-hop/middle'));
    instance.setCookies([
      'jar_final=destination; Path=/one-hop/final',
      'XSRF-TOKEN=final-token; Path=/one-hop/final',
    ], sourceUrl('/one-hop/final'));
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/one-hop/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return callbackCount === 1
          ? {
              redirect: true,
              setHeaders: {
                Cookie: 'callback=one-hop',
                'X-Lifetime-Witness': 'one-hop',
              },
            }
          : { redirect: true };
      },
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(2);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/one-hop/source' },
      {
        cookies: { callback: 'one-hop' },
        lifetimeWitness: 'one-hop',
        name: 'source',
        path: '/one-hop/middle',
        xsrf: 'middle-token',
      },
      {
        cookies: { jar_final: 'destination', 'XSRF-TOKEN': 'final-token' },
        name: 'source',
        path: '/one-hop/final',
        xsrf: 'final-token',
      },
    ]));
  });

  it('keeps persistent callback Cookie above jar for every hop on its exact origin', async () => {
    planRedirect('source', '/persistent-exact/source', foreignUrl('/persistent-exact/middle'));
    planRedirect('foreign', '/persistent-exact/middle', foreignUrl('/persistent-exact/final'));
    planTerminal('foreign', '/persistent-exact/final');
    const instance = client();
    instance.setCookies(
      ['jar_middle=destination; Path=/persistent-exact/middle'],
      foreignUrl('/persistent-exact/middle'),
    );
    instance.setCookies(
      ['jar_final=destination; Path=/persistent-exact/final'],
      foreignUrl('/persistent-exact/final'),
    );
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/persistent-exact/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return callbackCount === 1
          ? {
              redirect: true,
              setHeadersOnRedirects: {
                Cookie: 'callback=persistent',
                'X-Lifetime-Witness': 'persistent',
              },
            }
          : { redirect: true };
      },
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(2);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/persistent-exact/source' },
      {
        cookies: { callback: 'persistent' },
        lifetimeWitness: 'persistent',
        name: 'foreign',
        path: '/persistent-exact/middle',
      },
      {
        cookies: { callback: 'persistent' },
        lifetimeWitness: 'persistent',
        name: 'foreign',
        path: '/persistent-exact/final',
      },
    ]));
  });

  it('expires persistent callback Cookie terminally on A→B→A→B without revival', async () => {
    planRedirect('source', '/persistent-expiry/source', foreignUrl('/persistent-expiry/middle'));
    planRedirect('foreign', '/persistent-expiry/middle', sourceUrl('/persistent-expiry/away'));
    planRedirect('source', '/persistent-expiry/away', foreignUrl('/persistent-expiry/return'));
    planTerminal('foreign', '/persistent-expiry/return');
    const instance = client();
    instance.setCookies(
      ['jar_middle=destination; Path=/persistent-expiry/middle'],
      foreignUrl('/persistent-expiry/middle'),
    );
    instance.setCookies(
      ['jar_away=destination; Path=/persistent-expiry/away'],
      sourceUrl('/persistent-expiry/away'),
    );
    instance.setCookies(
      ['jar_return=destination; Path=/persistent-expiry/return'],
      foreignUrl('/persistent-expiry/return'),
    );
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/persistent-expiry/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return callbackCount === 1
          ? {
              redirect: true,
              setHeadersOnRedirects: {
                Cookie: 'callback=persistent',
                'X-Lifetime-Witness': 'persistent',
              },
            }
          : { redirect: true };
      },
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(3);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/persistent-expiry/source' },
      {
        cookies: { callback: 'persistent' },
        lifetimeWitness: 'persistent',
        name: 'foreign',
        path: '/persistent-expiry/middle',
      },
      {
        cookies: { jar_away: 'destination' },
        name: 'source',
        path: '/persistent-expiry/away',
      },
      {
        cookies: { jar_return: 'destination' },
        name: 'foreign',
        path: '/persistent-expiry/return',
      },
    ]));
  });

  const tombstoneCases = [
    { field: 'undefined', lifetime: 'one-hop', value: undefined },
    { field: 'empty-array', lifetime: 'one-hop', value: [] },
    { field: 'undefined', lifetime: 'persistent', value: undefined },
    { field: 'empty-array', lifetime: 'persistent', value: [] },
  ] as const;

  it.each(tombstoneCases)(
    'keeps $lifetime $field Cookie/XSRF tombstones authoritative over literal and jar layers',
    async ({ field, lifetime, value }) => {
      const prefix = `/tombstone/${lifetime}-${field}`;
      planRedirect('source', `${prefix}/source`, sourceUrl(`${prefix}/middle`));
      planRedirect('source', `${prefix}/middle`, sourceUrl(`${prefix}/final`));
      planTerminal('source', `${prefix}/final`);
      const instance = client();
      instance.setCookies([
        `jar_middle=destination; Path=${prefix}/middle`,
        `XSRF-TOKEN=middle-token; Path=${prefix}/middle`,
      ], sourceUrl(`${prefix}/middle`));
      instance.setCookies([
        `jar_final=destination; Path=${prefix}/final`,
        `XSRF-TOKEN=final-token; Path=${prefix}/final`,
      ], sourceUrl(`${prefix}/final`));
      let callbackCount = 0;
      const witness = `${lifetime}-${field}`;

      const response = await instance.get(sourceUrl(`${prefix}/source`), {
        ...requestDefaults,
        headers: { Cookie: 'literal=caller' },
        onRedirect: () => {
          callbackCount++;
          if (callbackCount !== 1) return { redirect: true };
          const patch = {
            Cookie: value,
            'X-Lifetime-Witness': witness,
            'X-XSRF-TOKEN': undefined,
          };
          return lifetime === 'one-hop'
            ? { redirect: true, setHeaders: patch }
            : { redirect: true, setHeadersOnRedirects: patch };
        },
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
      } as never);

      const terminal = lifetime === 'one-hop'
        ? {
            cookie: 'literal=caller; jar_final=destination; XSRF-TOKEN=final-token',
            cookies: { jar_final: 'destination', 'XSRF-TOKEN': 'final-token', literal: 'caller' },
            name: 'source' as const,
            path: `${prefix}/final`,
            xsrf: 'final-token',
          }
        : {
            cookie: null,
            lifetimeWitness: witness,
            name: 'source' as const,
            path: `${prefix}/final`,
            xsrf: null,
          };

      expect(response.status).toBe(200);
      expect(callbackCount).toBe(2);
      expect(wire).toEqual(expectedWire([
        { cookies: { literal: 'caller' }, name: 'source', path: `${prefix}/source` },
        {
          cookie: null,
          lifetimeWitness: witness,
          name: 'source',
          path: `${prefix}/middle`,
          xsrf: null,
        },
        terminal,
      ]));
    },
  );
});

describe('Phase 1c-c HTTP/2 R5 — stale state and retry recomposition', () => {
  it('retains literal Cookie while deleting unmatched source jar Cookie and automatic XSRF', async () => {
    planRedirect('source', '/stale/source/start', sourceUrl('/stale/destination/final'));
    planTerminal('source', '/stale/destination/final');
    const instance = client();
    instance.setCookies([
      'stale=source; Path=/stale/source/start',
      'XSRF-TOKEN=source-token; Path=/stale/source/start',
    ], sourceUrl('/stale/source/start'));

    const response = await instance.get(sourceUrl('/stale/source/start'), {
      ...requestDefaults,
      headers: { Cookie: 'literal=caller' },
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      {
        cookie: 'literal=caller; stale=source; XSRF-TOKEN=source-token',
        cookies: { stale: 'source', 'XSRF-TOKEN': 'source-token', literal: 'caller' },
        name: 'source',
        path: '/stale/source/start',
        xsrf: 'source-token',
      },
      {
        cookies: { literal: 'caller' },
        name: 'source',
        path: '/stale/destination/final',
      },
    ]));
  });

  it('recomputes destination XSRF from the destination-matched jar cookie', async () => {
    planRedirect('source', '/xsrf/source/start', sourceUrl('/xsrf/destination/final'));
    planTerminal('source', '/xsrf/destination/final');
    const instance = client();
    instance.setCookies(
      ['XSRF-TOKEN=source-token; Path=/xsrf/source/start'],
      sourceUrl('/xsrf/source/start'),
    );
    instance.setCookies(
      ['XSRF-TOKEN=destination-token; Path=/xsrf/destination/final'],
      sourceUrl('/xsrf/destination/final'),
    );

    const response = await instance.get(sourceUrl('/xsrf/source/start'), {
      ...requestDefaults,
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      {
        cookies: { 'XSRF-TOKEN': 'source-token' },
        name: 'source',
        path: '/xsrf/source/start',
        xsrf: 'source-token',
      },
      {
        cookies: { 'XSRF-TOKEN': 'destination-token' },
        name: 'source',
        path: '/xsrf/destination/final',
        xsrf: 'destination-token',
      },
    ]));
  });

  it('projects retry-time Set-Cookie/XSRF refresh without consuming the one-hop layer', async () => {
    planRedirect('source', '/retry-positive/source', sourceUrl('/retry-positive/destination'));
    planRoute('source', '/retry-positive/destination', [
      { setCookie: ['XSRF-TOKEN=after; Path=/retry-positive'], status: 503 },
      { status: 200 },
    ]);
    const instance = client();
    instance.setCookies(
      ['XSRF-TOKEN=before; Path=/retry-positive'],
      sourceUrl('/retry-positive/source'),
    );
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/retry-positive/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return {
          redirect: true,
          setHeaders: { 'X-Retry-Witness': 'one-hop' },
        };
      },
      retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(1);
    expect(retryState(response)).toEqual({
      attempts: [{ attempt: 1, code: 'REZ_HTTP_ERROR', status: 503 }],
      history: [{ method: 'GET', statusCode: 302, url: sourceUrl('/retry-positive/source') }],
      redirectCount: 1,
      retryAttempts: 1,
    });
    expect(wire).toEqual(expectedWire([
      {
        cookies: { 'XSRF-TOKEN': 'before' },
        name: 'source',
        path: '/retry-positive/source',
        xsrf: 'before',
      },
      {
        cookies: { 'XSRF-TOKEN': 'before' },
        name: 'source',
        path: '/retry-positive/destination',
        retryWitness: 'one-hop',
        xsrf: 'before',
      },
      {
        cookies: { 'XSRF-TOKEN': 'after' },
        name: 'source',
        path: '/retry-positive/destination',
        retryWitness: 'one-hop',
        xsrf: 'after',
      },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/retry-positive/destination')).string))
      .toEqual({ 'XSRF-TOKEN': 'after' });
  });

  it('control: a retry refresh stays below the still-live Cookie tombstone', async () => {
    planRedirect('source', '/retry-tombstone/source', sourceUrl('/retry-tombstone/destination'));
    planRoute('source', '/retry-tombstone/destination', [
      { setCookie: ['XSRF-TOKEN=after; Path=/retry-tombstone'], status: 503 },
      { status: 200 },
    ]);
    const instance = client();
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/retry-tombstone/source'), {
      ...requestDefaults,
      onRedirect: () => {
        callbackCount++;
        return {
          redirect: true,
          setHeaders: {
            Cookie: undefined,
            'X-Retry-Witness': 'one-hop',
            'X-XSRF-TOKEN': undefined,
          },
        };
      },
      retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    } as never);

    expect(response.status).toBe(200);
    expect(callbackCount).toBe(1);
    expect(retryState(response)).toEqual({
      attempts: [{ attempt: 1, code: 'REZ_HTTP_ERROR', status: 503 }],
      history: [{ method: 'GET', statusCode: 302, url: sourceUrl('/retry-tombstone/source') }],
      redirectCount: 1,
      retryAttempts: 1,
    });
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/retry-tombstone/source' },
      {
        cookie: null,
        name: 'source',
        path: '/retry-tombstone/destination',
        retryWitness: 'one-hop',
      },
      {
        cookie: null,
        name: 'source',
        path: '/retry-tombstone/destination',
        retryWitness: 'one-hop',
      },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/retry-tombstone/destination')).string))
      .toEqual({ 'XSRF-TOKEN': 'after' });
  });

  it('keeps a beforeRedirect hook Cookie deletion authoritative across retry', async () => {
    planRedirect('source', '/hook-retry/source', sourceUrl('/hook-retry/destination'));
    planRoute('source', '/hook-retry/destination', [
      { status: 503 },
      { status: 200 },
    ]);
    const instance = client();
    instance.setCookies(
      ['targetJar=destination; Path=/hook-retry/destination'],
      sourceUrl('/hook-retry/destination'),
    );
    let hookCount = 0;

    const response = await instance.get(sourceUrl('/hook-retry/source'), {
      ...requestDefaults,
      hooks: {
        beforeRedirect: [(context: { request: { headers: RezoHeaders } }) => {
          hookCount++;
          context.request.headers.delete('Cookie');
          context.request.headers.set('X-Retry-Witness', 'hook');
        }],
      },
      retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
    } as never);

    expect(response.status).toBe(200);
    expect(hookCount).toBe(1);
    expect(retryState(response)).toEqual({
      attempts: [{ attempt: 1, code: 'REZ_HTTP_ERROR', status: 503 }],
      history: [{ method: 'GET', statusCode: 302, url: sourceUrl('/hook-retry/source') }],
      redirectCount: 1,
      retryAttempts: 1,
    });
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/hook-retry/source' },
      {
        cookie: null,
        name: 'source',
        path: '/hook-retry/destination',
        retryWitness: 'hook',
      },
      {
        cookie: null,
        name: 'source',
        path: '/hook-retry/destination',
        retryWitness: 'hook',
      },
    ]));
    expect(response.config.requestCookies).toEqual([]);
    expect(cookieRecord(instance.getCookies(sourceUrl('/hook-retry/destination')).string))
      .toEqual({ targetJar: 'destination' });
  });

  it('expires hook Cookie suppression at a cross-origin boundary', async () => {
    planRedirect('source', '/hook-expiry/source', sourceUrl('/hook-expiry/middle'));
    planRedirect('source', '/hook-expiry/middle', foreignUrl('/hook-expiry/final'));
    planTerminal('foreign', '/hook-expiry/final');
    const instance = client();
    instance.setCookies(
      ['sourceJar=blocked; Path=/hook-expiry/middle'],
      sourceUrl('/hook-expiry/middle'),
    );
    instance.setCookies(
      ['foreignJar=restored; Path=/hook-expiry/final'],
      foreignUrl('/hook-expiry/final'),
    );
    let hookCount = 0;

    const response = await instance.get(sourceUrl('/hook-expiry/source'), {
      ...requestDefaults,
      hooks: {
        beforeRedirect: [(context: { request: { headers: RezoHeaders } }) => {
          hookCount++;
          if (hookCount === 1) context.request.headers.delete('Cookie');
        }],
      },
    } as never);

    expect(response.status).toBe(200);
    expect(hookCount).toBe(2);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/hook-expiry/source' },
      { cookie: null, name: 'source', path: '/hook-expiry/middle' },
      {
        cookies: { foreignJar: 'restored' },
        name: 'foreign',
        path: '/hook-expiry/final',
      },
    ]));
    expect(Object.fromEntries(
      response.config.requestCookies.map((cookie) => [cookie.key, cookie.value]),
    )).toEqual({ foreignJar: 'restored' });
  });

  it('treats whole hook-carrier Cookie omission as authoritative over destination jar', async () => {
    planRedirect('source', '/hook-replacement/source', sourceUrl('/hook-replacement/final'));
    planTerminal('source', '/hook-replacement/final');
    const instance = client();
    instance.setCookies(
      ['targetJar=destination; Path=/hook-replacement/final'],
      sourceUrl('/hook-replacement/final'),
    );
    let hookCount = 0;

    const response = await instance.get(sourceUrl('/hook-replacement/source'), {
      ...requestDefaults,
      hooks: {
        beforeRedirect: [(context: { request: { headers: RezoHeaders } }) => {
          hookCount++;
          context.request.headers = new RezoHeaders({ 'X-Control': 'replacement' });
        }],
      },
    } as never);

    expect(response.status).toBe(200);
    expect(hookCount).toBe(1);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/hook-replacement/source' },
      {
        control: 'replacement',
        cookie: null,
        name: 'source',
        path: '/hook-replacement/final',
      },
    ]));
    expect(response.config.requestCookies).toEqual([]);
    expect(cookieRecord(instance.getCookies(sourceUrl('/hook-replacement/final')).string))
      .toEqual({ targetJar: 'destination' });
  });

  it('keeps a hook-set Cookie authoritative across retry while preserving its witness', async () => {
    planRedirect('source', '/hook-set-retry/source', sourceUrl('/hook-set-retry/destination'));
    planRoute('source', '/hook-set-retry/destination', [
      { status: 503 },
      { status: 200 },
    ]);
    const instance = client();
    instance.setCookies(
      ['targetJar=destination; Path=/hook-set-retry/destination'],
      sourceUrl('/hook-set-retry/destination'),
    );
    let hookCount = 0;

    const response = await instance.get(sourceUrl('/hook-set-retry/source'), {
      ...requestDefaults,
      hooks: {
        beforeRedirect: [(context: { request: { headers: RezoHeaders } }) => {
          hookCount++;
          context.request.headers.set('Cookie', 'hook=winner');
          context.request.headers.set('X-Retry-Witness', 'hook-set');
        }],
      },
      retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
    } as never);

    expect(response.status).toBe(200);
    expect(hookCount).toBe(1);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/hook-set-retry/source' },
      {
        cookies: { hook: 'winner' },
        name: 'source',
        path: '/hook-set-retry/destination',
        retryWitness: 'hook-set',
      },
      {
        cookies: { hook: 'winner' },
        name: 'source',
        path: '/hook-set-retry/destination',
        retryWitness: 'hook-set',
      },
    ]));
    expect(Object.fromEntries(
      response.config.requestCookies.map((cookie) => [cookie.key, cookie.value]),
    )).toEqual({ hook: 'winner' });
  });

  it('lets callback Cookie authority win after a conflicting hook Cookie mutation', async () => {
    planRedirect('source', '/hook-callback/source', sourceUrl('/hook-callback/final'));
    planTerminal('source', '/hook-callback/final');
    const instance = client();
    instance.setCookies(
      ['targetJar=destination; Path=/hook-callback/final'],
      sourceUrl('/hook-callback/final'),
    );
    let hookCount = 0;
    let callbackCount = 0;

    const response = await instance.get(sourceUrl('/hook-callback/source'), {
      ...requestDefaults,
      hooks: {
        beforeRedirect: [(context: { request: { headers: RezoHeaders } }) => {
          hookCount++;
          context.request.headers.set('Cookie', 'hook=loser');
          context.request.headers.set('X-Control', 'hook-ran');
        }],
      },
      onRedirect: () => {
        callbackCount++;
        return { redirect: true, setHeaders: { Cookie: 'callback=winner' } };
      },
    } as never);

    expect(response.status).toBe(200);
    expect({ callbackCount, hookCount }).toEqual({ callbackCount: 1, hookCount: 1 });
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/hook-callback/source' },
      {
        control: 'hook-ran',
        cookies: { callback: 'winner' },
        name: 'source',
        path: '/hook-callback/final',
      },
    ]));
    expect(Object.fromEntries(
      response.config.requestCookies.map((cookie) => [cookie.key, cookie.value]),
    )).toEqual({ callback: 'winner' });
  });

  it('recomposes after a network-error onRetry jar mutation', async () => {
    planRoute('source', '/network-retry', [
      { reset: true, status: 200 },
      { status: 200 },
    ]);
    const jar = new RezoCookieJar();
    jar.setCookiesSync(
      ['retryCookie=before; Path=/network-retry'],
      sourceUrl('/network-retry'),
    );
    let onRetryCount = 0;

    const response = await client(jar).get(sourceUrl('/network-retry'), {
      ...requestDefaults,
      retry: {
        condition: () => true,
        maxRetries: 1,
        onRetry: () => {
          onRetryCount++;
          jar.setCookiesSync(
            ['retryCookie=after; Path=/network-retry'],
            sourceUrl('/network-retry'),
          );
        },
        retryDelay: 0,
      },
    } as never);

    expect(response.status).toBe(200);
    expect(onRetryCount).toBe(1);
    expect(response.config.retryAttempts).toBe(1);
    expect(wire).toEqual(expectedWire([
      { cookies: { retryCookie: 'before' }, name: 'source', path: '/network-retry' },
      { cookies: { retryCookie: 'after' }, name: 'source', path: '/network-retry' },
    ]));
  });

  it('recomposes a status retry after onRetry and beforeRetry jar mutations', async () => {
    planRoute('source', '/status-hook-retry', [
      { status: 503 },
      { status: 200 },
    ]);
    const jar = new RezoCookieJar();
    jar.setCookiesSync(
      ['retryCookie=before; Path=/status-hook-retry'],
      sourceUrl('/status-hook-retry'),
    );
    let onRetryCount = 0;
    let beforeRetryCount = 0;

    const response = await client(jar).get(sourceUrl('/status-hook-retry'), {
      ...requestDefaults,
      hooks: {
        beforeRetry: [() => {
          beforeRetryCount++;
          jar.setCookiesSync(
            ['retryCookie=before-hook; Path=/status-hook-retry'],
            sourceUrl('/status-hook-retry'),
          );
        }],
      },
      retry: {
        maxRetries: 1,
        onRetry: () => {
          onRetryCount++;
          jar.setCookiesSync(
            ['retryCookie=on-retry; Path=/status-hook-retry'],
            sourceUrl('/status-hook-retry'),
          );
        },
        retryDelay: 0,
        retryOn: [503],
      },
    } as never);

    expect(response.status).toBe(200);
    expect({ beforeRetryCount, onRetryCount }).toEqual({
      beforeRetryCount: 1,
      onRetryCount: 1,
    });
    expect(wire).toEqual(expectedWire([
      { cookies: { retryCookie: 'before' }, name: 'source', path: '/status-hook-retry' },
      {
        cookies: { retryCookie: 'before-hook' },
        name: 'source',
        path: '/status-hook-retry',
      },
    ]));
  });
});

describe('Phase 1c-c HTTP/2 R5 — response-cookie synchronization', () => {
  it('control: an accepted redirect Set-Cookie reaches the next wire and root jar', async () => {
    planRedirect('source', '/response-accepted/source', sourceUrl('/response-accepted/final'), {
      setCookie: ['accepted=source; Path=/response-accepted'],
    });
    planTerminal('source', '/response-accepted/final');
    const instance = client();

    const response = await instance.get(sourceUrl('/response-accepted/source'), requestDefaults);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/response-accepted/source' },
      {
        cookies: { accepted: 'source' },
        name: 'source',
        path: '/response-accepted/final',
      },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/response-accepted/final')).string))
      .toEqual({ accepted: 'source' });
  });

  it('publishes accepted host-only response cookies in config and final response metadata', async () => {
    planTerminal('source', '/response-metadata', {
      setCookie: ['terminal=accepted; Path=/response-metadata'],
    });
    const instance = client();

    const response = await instance.get(sourceUrl('/response-metadata'), requestDefaults);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/response-metadata' },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/response-metadata')).string))
      .toEqual({ terminal: 'accepted' });
    expect(response.config.responseCookies.setCookiesString).toEqual([
      'terminal=accepted; Path=/response-metadata',
    ]);
    expect(response.config.responseCookies.array.map((cookie) => cookie.key))
      .toEqual(['terminal']);
    expect(response.config.responseCookies.serialized.map((cookie) => cookie.key))
      .toEqual(['terminal']);
    expect(response.config.responseCookies.netscape).toContain('\tterminal\taccepted');
    expect(cookieRecord(response.config.responseCookies.string))
      .toEqual({ terminal: 'accepted' });
    expect(response.cookies.array.map((cookie) => cookie.key)).toEqual(['terminal']);
    expect(response.cookies.serialized.map((cookie) => cookie.key)).toEqual(['terminal']);
    expect(response.cookies.netscape).toContain('\tterminal\taccepted');
    expect(cookieRecord(response.cookies.string)).toEqual({ terminal: 'accepted' });
    expect(response.cookies.setCookiesString).toEqual([
      'terminal=accepted; Path=/response-metadata',
    ]);
  });

  it('awaits async beforeCookie acceptance before following the redirect', async () => {
    const hookStarted = deferred();
    const hookRelease = deferred();
    const destinationArrival = deferred();
    const eventLedger: string[] = [];
    const hookLedger: Array<Record<string, string>> = [];
    let hookCount = 0;
    let hookCompleted = false;
    let followedBeforeHook = false;
    planRedirect('source', '/response-async-accept/source', sourceUrl('/response-async-accept/final'), {
      setCookie: ['accepted=async; Path=/response-async-accept'],
    });
    planTerminal('source', '/response-async-accept/final', {
      onRequest: () => {
        eventLedger.push('destination:dispatch');
        followedBeforeHook = !hookCompleted;
        destinationArrival.resolve();
      },
    });
    const instance = client();

    const responsePromise = instance.get(sourceUrl('/response-async-accept/source'), {
      ...requestDefaults,
      hooks: {
        beforeCookie: [async (context: {
          cookie: { key: string; value: string };
          source: string;
          url: string;
        }) => {
          hookCount++;
          eventLedger.push('hook:start');
          hookLedger.push({
            key: context.cookie.key,
            source: context.source,
            url: context.url,
            value: context.cookie.value,
          });
          hookStarted.resolve();
          await hookRelease.promise;
          hookCompleted = true;
          eventLedger.push('hook:complete');
          return true;
        }],
      },
    } as never);
    await hookStarted.promise;
    const prematureDestination = await destinationArrivedBeforeBarrier(
      destinationArrival.promise,
    );
    hookRelease.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect({ followedBeforeHook, hookCompleted, hookCount, prematureDestination }).toEqual({
      followedBeforeHook: false,
      hookCompleted: true,
      hookCount: 1,
      prematureDestination: false,
    });
    expect(hookLedger).toEqual([{
      key: 'accepted',
      source: 'response',
      url: sourceUrl('/response-async-accept/source'),
      value: 'async',
    }]);
    expect(eventLedger).toEqual([
      'hook:start',
      'hook:complete',
      'destination:dispatch',
    ]);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/response-async-accept/source' },
      {
        cookies: { accepted: 'async' },
        name: 'source',
        path: '/response-async-accept/final',
      },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/response-async-accept/final')).string))
      .toEqual({ accepted: 'async' });
    expect(response.config.responseCookies.setCookiesString).toEqual([
      'accepted=async; Path=/response-async-accept',
    ]);
  });

  it('awaits async beforeCookie rejection and never leaks the rejected cookie', async () => {
    const hookStarted = deferred();
    const hookRelease = deferred();
    const destinationArrival = deferred();
    const eventLedger: string[] = [];
    const hookLedger: Array<Record<string, string>> = [];
    let hookCount = 0;
    let hookCompleted = false;
    let followedBeforeHook = false;
    planRedirect('source', '/response-async-reject/source', sourceUrl('/response-async-reject/final'), {
      setCookie: ['rejected=blocked; Path=/response-async-reject'],
    });
    planTerminal('source', '/response-async-reject/final', {
      onRequest: () => {
        eventLedger.push('destination:dispatch');
        followedBeforeHook = !hookCompleted;
        destinationArrival.resolve();
      },
    });
    const instance = client();

    const responsePromise = instance.get(sourceUrl('/response-async-reject/source'), {
      ...requestDefaults,
      hooks: {
        beforeCookie: [async (context: {
          cookie: { key: string; value: string };
          source: string;
          url: string;
        }) => {
          hookCount++;
          eventLedger.push('hook:start');
          hookLedger.push({
            key: context.cookie.key,
            source: context.source,
            url: context.url,
            value: context.cookie.value,
          });
          hookStarted.resolve();
          await hookRelease.promise;
          hookCompleted = true;
          eventLedger.push('hook:complete');
          return false;
        }],
      },
    } as never);
    await hookStarted.promise;
    const prematureDestination = await destinationArrivedBeforeBarrier(
      destinationArrival.promise,
    );
    hookRelease.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect({ followedBeforeHook, hookCompleted, hookCount, prematureDestination }).toEqual({
      followedBeforeHook: false,
      hookCompleted: true,
      hookCount: 1,
      prematureDestination: false,
    });
    expect(hookLedger).toEqual([{
      key: 'rejected',
      source: 'response',
      url: sourceUrl('/response-async-reject/source'),
      value: 'blocked',
    }]);
    expect(eventLedger).toEqual([
      'hook:start',
      'hook:complete',
      'destination:dispatch',
    ]);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/response-async-reject/source' },
      { cookie: null, name: 'source', path: '/response-async-reject/final' },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/response-async-reject/final')).string))
      .toEqual({});
    expect(response.config.responseCookies.setCookiesString).toEqual([]);
    expect(response.config.responseCookies.array.map((cookie) => cookie.key))
      .not.toContain('rejected');
  });

  it('emits accepted cookie headers before streaming body data', async () => {
    const hookStarted = deferred();
    const hookRelease = deferred();
    const dataArrival = deferred();
    const eventLedger: string[] = [];
    planTerminal('source', '/response-stream-order', {
      setCookie: ['streamAccepted=yes; Path=/response-stream-order'],
    });
    const instance = client();

    const stream = instance.stream(sourceUrl('/response-stream-order'), {
      ...requestDefaults,
      hooks: {
        beforeCookie: [async () => {
          eventLedger.push('hook:start');
          hookStarted.resolve();
          await hookRelease.promise;
          eventLedger.push('hook:complete');
          return true;
        }],
      },
    } as never);
    stream.on('headers', (event) => {
      eventLedger.push(`headers:${event.cookies.map((cookie) => cookie.key).join(',')}`);
    });
    stream.on('status', (status) => {
      eventLedger.push(`status:${status}`);
    });
    stream.on('cookies', (cookies) => {
      eventLedger.push(`cookies:${cookies.map((cookie) => cookie.key).join(',')}`);
    });
    stream.on('data', () => {
      eventLedger.push('data');
      dataArrival.resolve();
    });
    stream.on('progress', () => {
      eventLedger.push('progress');
    });
    const finishPromise = new Promise<unknown>((resolveFinish, rejectFinish) => {
      stream.once('finish', (event) => {
        eventLedger.push(`finish:${event.cookies.array.map((cookie) => cookie.key).join(',')}`);
        resolveFinish(event);
      });
      stream.once('error', rejectFinish);
    });

    await hookStarted.promise;
    const dataBeforeCookiePolicy = await destinationArrivedBeforeBarrier(
      dataArrival.promise,
      100,
    );
    hookRelease.resolve();
    await finishPromise;

    expect(dataBeforeCookiePolicy).toBe(false);
    expect(eventLedger).toEqual([
      'hook:start',
      'hook:complete',
      'headers:streamAccepted',
      'status:200',
      'cookies:streamAccepted',
      'data',
      'progress',
      'finish:streamAccepted',
    ]);
  });

  it('keeps disableJar response cookies out of the root jar while preserving manual Cookie', async () => {
    planRedirect('source', '/disable-jar/source', sourceUrl('/disable-jar/final'), {
      setCookie: ['blocked=response; Path=/disable-jar'],
    });
    planTerminal('source', '/disable-jar/final');
    const jar = new RezoCookieJar();
    const instance = new Rezo({ disableJar: true, jar }, http2Adapter);

    const response = await instance.get(sourceUrl('/disable-jar/source'), {
      ...requestDefaults,
      headers: { Cookie: 'manual=caller' },
    } as never);

    expect(response.status).toBe(200);
    expect(wire).toEqual(expectedWire([
      { cookies: { manual: 'caller' }, name: 'source', path: '/disable-jar/source' },
      { cookies: { manual: 'caller' }, name: 'source', path: '/disable-jar/final' },
    ]));
    expect(cookieRecord(jar.getCookieHeader(sourceUrl('/disable-jar/final')))).toEqual({});
    expect(response.config.responseCookies.setCookiesString).toEqual([
      'blocked=response; Path=/disable-jar',
    ]);
    expect(response.config.responseCookies.array.map((cookie) => cookie.key)).toContain('blocked');
  });

  it('bounds a never-settling beforeCookie hook with the request timeout', async () => {
    planRedirect('source', '/cookie-timeout/source', sourceUrl('/cookie-timeout/final'), {
      setCookie: ['blocked=pending; Path=/cookie-timeout'],
    });
    planTerminal('source', '/cookie-timeout/final');
    const instance = client();
    let hookCount = 0;
    const startedAt = Date.now();

    const request = instance.get(sourceUrl('/cookie-timeout/source'), {
      cache: false,
      hooks: {
        beforeCookie: [() => {
          hookCount++;
          return new Promise<boolean>(() => {});
        }],
      },
      timeout: 150,
    } as never);

    await expect(request).rejects.toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(hookCount).toBe(1);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/cookie-timeout/source' },
    ]));
    expect(cookieRecord(instance.getCookies(sourceUrl('/cookie-timeout/final')).string))
      .toEqual({});
  });

  it('does not mutate the root jar when a beforeCookie hook resolves after timeout', async () => {
    const hookStarted = deferred();
    const hookRelease = deferred();
    const hookCompleted = deferred();
    planTerminal('source', '/cookie-timeout-late-release', {
      setCookie: ['late=accepted; Path=/cookie-timeout-late-release'],
    });
    const instance = client();

    const request = instance.get(sourceUrl('/cookie-timeout-late-release'), {
      cache: false,
      hooks: {
        beforeCookie: [async () => {
          hookStarted.resolve();
          await hookRelease.promise;
          hookCompleted.resolve();
          return true;
        }],
      },
      timeout: 150,
    } as never);

    await hookStarted.promise;
    await expect(request).rejects.toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(cookieRecord(instance.getCookies(sourceUrl('/cookie-timeout-late-release')).string))
      .toEqual({});

    hookRelease.resolve();
    await hookCompleted.promise;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 0));

    expect(cookieRecord(instance.getCookies(sourceUrl('/cookie-timeout-late-release')).string))
      .toEqual({});
  });

  it('bounds a never-settling beforeRedirect hook with the request timeout', async () => {
    planRedirect('source', '/redirect-hook-timeout/source', sourceUrl('/redirect-hook-timeout/final'));
    planTerminal('source', '/redirect-hook-timeout/final');
    let hookCount = 0;
    const startedAt = Date.now();

    const request = client().get(sourceUrl('/redirect-hook-timeout/source'), {
      cache: false,
      hooks: {
        beforeRedirect: [() => {
          hookCount++;
          return new Promise<void>(() => {});
        }],
      },
      timeout: 150,
    } as never);

    await expect(request).rejects.toMatchObject({ code: 'ECONNABORTED', phase: 'total' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(hookCount).toBe(1);
    expect(wire).toEqual(expectedWire([
      { name: 'source', path: '/redirect-hook-timeout/source' },
    ]));
  });
});
