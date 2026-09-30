/**
 * Phase 1c-c shared HTTP preparation — public Cookie, auth, and redirect
 * diagnostics frozen from executable loopback probes.
 *
 * Every public row records the source and destination wire. Helper-only rows
 * retain surrounding controls so a missing dispatch, empty jar, or skipped
 * runtime branch cannot satisfy the contract.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src/core/rezo';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import { RezoError } from '../src/errors/rezo-error';
import type { RezoResponse } from '../src/types/response';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import {
  getDefaultConfig,
  prepareHTTPOptions,
  type HttpRequestAddedOptions,
} from '../src/utils/http-config';
import { RezoHeaders } from '../src/utils/headers';

interface WireRequest {
  headers: http.IncomingHttpHeaders;
  method: string;
}

interface PublicResponse extends RezoResponse<unknown> {
  config: RezoResponse<unknown>['config'] & { fromCache?: boolean };
}

const wire = new Map<string, WireRequest[]>();
const revalidationStatuses: number[] = [];
const ETAG = '"phase1c-c-etag"';
let serverA: http.Server | undefined;
let serverB: http.Server | undefined;
let portA = 0;
let portB = 0;

function record(request: http.IncomingMessage): string {
  const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
  const entry: WireRequest = {
    headers: { ...request.headers },
    method: String(request.method),
  };
  wire.set(path, [...(wire.get(path) ?? []), entry]);
  return path;
}

function requestsAt(path: string): WireRequest[] {
  const entries = wire.get(path);
  if (!entries) throw new Error(`fixture path was not reached: ${path}`);
  return entries;
}

function lastAt(path: string): WireRequest {
  const entries = requestsAt(path);
  const request = entries.at(-1);
  if (!request) throw new Error(`fixture path has no request: ${path}`);
  return request;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function redirect(response: http.ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}

function json(response: http.ServerResponse, body: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  serverB = http.createServer((request, response) => {
    record(request);
    json(response, { arrived: true });
  });
  portB = await listen(serverB);

  serverA = http.createServer((request, response) => {
    const path = record(request);
    if (path.startsWith('/cookie-source/')) {
      redirect(response, `http://127.0.0.1:${portB}${path.replace('/cookie-source/', '/cookie-target/')}`);
      return;
    }
    if (path === '/xsrf-source') {
      redirect(response, `http://127.0.0.1:${portB}/xsrf-target`);
      return;
    }
    if (path.startsWith('/disable-source/')) {
      redirect(response, `http://127.0.0.1:${portB}${path.replace('/disable-source/', '/disable-target/')}`);
      return;
    }
    if (path === '/missing-location') {
      response.writeHead(302, { 'x-missing-location-control': 'reached' });
      response.end('missing location');
      return;
    }
    if (path === '/revalidate') {
      if (request.headers['if-none-match'] === ETAG) {
        revalidationStatuses.push(304);
        response.writeHead(304, {
          'cache-control': 'no-cache',
          etag: ETAG,
          'x-revalidation-control': 'not-modified',
        });
        response.end();
      } else {
        revalidationStatuses.push(200);
        response.writeHead(200, {
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          etag: ETAG,
        });
        response.end(JSON.stringify({ version: 1 }));
      }
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  portA = await listen(serverA);
});

beforeEach(() => {
  wire.clear();
  revalidationStatuses.length = 0;
});

afterAll(async () => {
  const startedServers = [serverA, serverB].filter(
    (server): server is http.Server => server !== undefined,
  );
  for (const server of startedServers) server.closeAllConnections?.();
  await Promise.all(startedServers.map((server) => (
    new Promise<void>((resolve) => server.close(() => resolve()))
  )));
});

function requestCookiePairs(response: PublicResponse): string[] {
  return response.config.requestCookies.map((cookie) => `${cookie.key}=${cookie.value}`);
}

type CookieDecision = 'control' | 'callback-set' | 'callback-delete' | 'hook-set' | 'hook-delete';

async function runCookieDecision(decision: CookieDecision): Promise<{
  diagnosticCookies: string[];
  destinationCookie: string | undefined;
  destinationHits: number;
  sourceHits: number;
  status: number;
}> {
  const sourcePath = `/cookie-source/${decision}`;
  const targetPath = `/cookie-target/${decision}`;
  const sourceUrl = `http://127.0.0.1:${portA}${sourcePath}`;
  const targetUrl = `http://127.0.0.1:${portB}${targetPath}`;
  const client = new Rezo({}, httpAdapter);
  client.setCookies([`jar=destination; Path=${targetPath}`], targetUrl);

  let options: Record<string, unknown> = {};
  if (decision === 'callback-set') {
    options = {
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        setHeaders: { Cookie: 'callback=explicit' },
        url: url.href,
      }),
    };
  } else if (decision === 'callback-delete') {
    options = {
      onRedirect: ({ url }: { url: URL }) => ({
        redirect: true,
        setHeaders: { Cookie: undefined },
        url: url.href,
      }),
    };
  } else if (decision === 'hook-set') {
    options = {
      hooks: {
        beforeRedirect: [(
          context: { request: { headers: RezoHeaders } },
        ) => context.request.headers.set('Cookie', 'hook=explicit')],
      },
    };
  } else if (decision === 'hook-delete') {
    options = {
      hooks: {
        beforeRedirect: [(
          context: { request: { headers: RezoHeaders } },
        ) => context.request.headers.delete('Cookie')],
      },
    };
  }

  const response = await client.get(sourceUrl, options as never) as PublicResponse;
  return {
    diagnosticCookies: requestCookiePairs(response),
    destinationCookie: lastAt(targetPath).headers.cookie,
    destinationHits: requestsAt(targetPath).length,
    sourceHits: requestsAt(sourcePath).length,
    status: response.status,
  };
}

type HeaderCarrier = NonNullable<HttpRequestAddedOptions['customHeaders']>;

async function prepareRedirectCookie(
  label: string,
  customHeaders?: HeaderCarrier,
): Promise<string | null> {
  const sourceUrl = `https://source.test/${label}`;
  const targetUrl = `https://destination.test/${label}`;
  const jar = new RezoCookieJar();
  jar.setCookiesSync([`jar=destination; Path=/${label}`], targetUrl);
  const defaultOptions = await getDefaultConfig({});
  const initial = prepareHTTPOptions(
    { url: sourceUrl, fullUrl: sourceUrl, method: 'GET', headers: { 'X-Control': label } },
    jar,
    { defaultOptions },
  );
  const redirected = prepareHTTPOptions(
    {
      ...initial.fetchOptions,
      url: targetUrl,
      fullUrl: targetUrl,
      headers: new RezoHeaders(initial.fetchOptions.headers),
    },
    jar,
    {
      customHeaders,
      defaultOptions,
      fullUrl: sourceUrl,
      isRedirected: true,
      lastRedirectedUrl: sourceUrl,
      redirectCode: 302,
      redirectedUrl: targetUrl,
    },
    initial.config,
  );
  return (redirected.fetchOptions.headers as RezoHeaders).get('Cookie');
}

interface AuthAttempt {
  authorization: string | null;
  error: null | { message: unknown; name: unknown };
  label: string;
}

function captureAuthorization(
  label: string,
  username: string,
  password: string,
  defaultOptions: HttpRequestAddedOptions['defaultOptions'],
  jar: RezoCookieJar,
): AuthAttempt {
  try {
    const prepared = prepareHTTPOptions(
      {
        auth: { username, password },
        method: 'GET',
        url: `https://auth.test/${label}`,
      },
      jar,
      { defaultOptions },
    );
    return {
      authorization: (prepared.fetchOptions.headers as RezoHeaders).get('Authorization'),
      error: null,
      label,
    };
  } catch (error) {
    const boxed = Object(error);
    return {
      authorization: null,
      error: {
        message: Reflect.get(boxed, 'message'),
        name: Reflect.get(boxed, 'name'),
      },
      label,
    };
  }
}

describe('Phase 1c-c HTTP-config public contracts', () => {
  it('reports exactly the callback/hook Cookie decision that reached the destination wire', async () => {
    const outcomes = [];
    for (const decision of [
      'control',
      'callback-set',
      'callback-delete',
      'hook-set',
      'hook-delete',
    ] as const) {
      outcomes.push([decision, await runCookieDecision(decision)] as const);
    }

    expect(Object.fromEntries(outcomes)).toEqual({
      control: {
        diagnosticCookies: ['jar=destination'],
        destinationCookie: 'jar=destination',
        destinationHits: 1,
        sourceHits: 1,
        status: 200,
      },
      'callback-set': {
        diagnosticCookies: ['callback=explicit'],
        destinationCookie: 'callback=explicit',
        destinationHits: 1,
        sourceHits: 1,
        status: 200,
      },
      'callback-delete': {
        diagnosticCookies: [],
        destinationCookie: undefined,
        destinationHits: 1,
        sourceHits: 1,
        status: 200,
      },
      'hook-set': {
        diagnosticCookies: ['hook=explicit'],
        destinationCookie: 'hook=explicit',
        destinationHits: 1,
        sourceHits: 1,
        status: 200,
      },
      'hook-delete': {
        diagnosticCookies: [],
        destinationCookie: undefined,
        destinationHits: 1,
        sourceHits: 1,
        status: 200,
      },
    });
  });

  it('recomputes destination XSRF projection identically on direct and redirected requests', async () => {
    const directPath = '/xsrf-direct';
    const targetPath = '/xsrf-target';
    const directUrl = `http://127.0.0.1:${portB}${directPath}`;
    const targetUrl = `http://127.0.0.1:${portB}${targetPath}`;
    const config = {
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    };

    const directClient = new Rezo({}, httpAdapter);
    directClient.setCookies([`XSRF-TOKEN=jar-secret; Path=${directPath}`], directUrl);
    const direct = await directClient.get(directUrl, config as never) as PublicResponse;

    const redirectClient = new Rezo({}, httpAdapter);
    redirectClient.setCookies([`XSRF-TOKEN=jar-secret; Path=${targetPath}`], targetUrl);
    const redirected = await redirectClient.get(
      `http://127.0.0.1:${portA}/xsrf-source`,
      config as never,
    ) as PublicResponse;

    expect({
      direct: {
        cookie: lastAt(directPath).headers.cookie,
        hits: requestsAt(directPath).length,
        status: direct.status,
        xsrf: lastAt(directPath).headers['x-xsrf-token'],
      },
      redirected: {
        cookie: lastAt(targetPath).headers.cookie,
        sourceHits: requestsAt('/xsrf-source').length,
        status: redirected.status,
        targetHits: requestsAt(targetPath).length,
        xsrf: lastAt(targetPath).headers['x-xsrf-token'],
      },
    }).toEqual({
      direct: {
        cookie: 'XSRF-TOKEN=jar-secret',
        hits: 1,
        status: 200,
        xsrf: 'jar-secret',
      },
      redirected: {
        cookie: 'XSRF-TOKEN=jar-secret',
        sourceHits: 1,
        status: 200,
        targetHits: 1,
        xsrf: 'jar-secret',
      },
    });
  });

  it('keeps callback Cookie authority when automatic jar management is disabled', async () => {
    const literalPath = '/disable-target/literal';
    const literalClient = new Rezo({ disableJar: true }, httpAdapter);
    const literal = await literalClient.get(`http://127.0.0.1:${portB}${literalPath}`, {
      headers: { Cookie: 'literal=manual' },
    } as never) as PublicResponse;

    const callbackClient = new Rezo({ disableJar: true }, httpAdapter);
    const callback = await callbackClient.get(
      `http://127.0.0.1:${portA}/disable-source/callback`,
      {
        onRedirect: ({ url }: { url: URL }) => ({
          redirect: true,
          setHeaders: { Cookie: 'callback=manual' },
          url: url.href,
        }),
      } as never,
    ) as PublicResponse;

    const hookClient = new Rezo({ disableJar: true }, httpAdapter);
    const hook = await hookClient.get(
      `http://127.0.0.1:${portA}/disable-source/hook`,
      {
        hooks: {
          beforeRedirect: [(
            context: { request: { headers: RezoHeaders } },
          ) => context.request.headers.set('Cookie', 'hook=manual')],
        },
      } as never,
    ) as PublicResponse;

    expect({
      callback: {
        cookie: lastAt('/disable-target/callback').headers.cookie,
        sourceCookie: lastAt('/disable-source/callback').headers.cookie,
        status: callback.status,
      },
      hook: {
        cookie: lastAt('/disable-target/hook').headers.cookie,
        sourceCookie: lastAt('/disable-source/hook').headers.cookie,
        status: hook.status,
      },
      literal: {
        cookie: lastAt(literalPath).headers.cookie,
        status: literal.status,
      },
    }).toEqual({
      callback: { cookie: 'callback=manual', sourceCookie: undefined, status: 200 },
      hook: { cookie: 'hook=manual', sourceCookie: undefined, status: 200 },
      literal: { cookie: 'literal=manual', status: 200 },
    });
  });

  it('encodes structured auth as UTF-8 with neither Buffer nor btoa and restores both globals', async () => {
    const credentials = [
      { label: 'ascii', password: 'pass', username: 'user' },
      { label: 'latin-1', password: 'päss', username: 'üser' },
      { label: 'wide-unicode', password: '🔒', username: '用户' },
    ] as const;
    const expected = credentials.map(({ label, password, username }) => ({
      authorization: `Basic ${Buffer.from(new TextEncoder().encode(`${username}:${password}`)).toString('base64')}`,
      error: null,
      label,
    }));
    const defaultOptions = await getDefaultConfig({});
    const jars = Array.from({ length: 9 }, () => new RezoCookieJar());
    const originalBuffer = Reflect.get(globalThis, 'Buffer');
    const originalBtoa = Reflect.get(globalThis, 'btoa');
    const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
    const btoaDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'btoa');
    if (!bufferDescriptor || !btoaDescriptor) {
      throw new Error('auth portability controls require native Buffer and btoa globals');
    }

    const native = credentials.map((credential, index) => captureAuthorization(
      credential.label,
      credential.username,
      credential.password,
      defaultOptions,
      jars[index],
    ));
    let noBuffer: AuthAttempt[] = [];
    let noBufferOrBtoa: AuthAttempt[] = [];
    try {
      if (!Reflect.set(globalThis, 'Buffer', undefined)) {
        throw new Error('failed to mask Buffer for the no-Buffer branch');
      }
      noBuffer = credentials.map((credential, index) => captureAuthorization(
        credential.label,
        credential.username,
        credential.password,
        defaultOptions,
        jars[index + 3],
      ));
      if (!Reflect.set(globalThis, 'btoa', undefined)) {
        throw new Error('failed to mask btoa for the runtime-neutral branch');
      }
      noBufferOrBtoa = credentials.map((credential, index) => captureAuthorization(
        credential.label,
        credential.username,
        credential.password,
        defaultOptions,
        jars[index + 6],
      ));
    } finally {
      Object.defineProperty(globalThis, 'Buffer', bufferDescriptor);
      Object.defineProperty(globalThis, 'btoa', btoaDescriptor);
      if (!Reflect.set(globalThis, 'Buffer', originalBuffer)) {
        throw new Error('failed to restore Buffer after the portability probe');
      }
      if (!Reflect.set(globalThis, 'btoa', originalBtoa)) {
        throw new Error('failed to restore btoa after the portability probe');
      }
    }

    expect({
      native,
      noBuffer,
      noBufferOrBtoa,
      restored: {
        btoaDescriptor: Object.getOwnPropertyDescriptor(globalThis, 'btoa'),
        btoaIdentity: Reflect.get(globalThis, 'btoa') === originalBtoa,
        bufferDescriptor: Object.getOwnPropertyDescriptor(globalThis, 'Buffer'),
        bufferIdentity: Reflect.get(globalThis, 'Buffer') === originalBuffer,
      },
    }).toEqual({
      native: expected,
      noBuffer: expected,
      noBufferOrBtoa: expected,
      restored: {
        btoaDescriptor,
        btoaIdentity: true,
        bufferDescriptor,
        bufferIdentity: true,
      },
    });
  });

  it('treats a cache-revalidation 304 without Location as non-redirect', async () => {
    let redirectCalls = 0;
    const client = new Rezo({}, httpAdapter);
    const url = `http://127.0.0.1:${portA}/revalidate`;
    const options = {
      cache: true,
      onRedirect: () => {
        redirectCalls++;
        return true;
      },
      responseType: 'json',
    };
    const first = await client.get(url, options as never) as PublicResponse;
    let second: PublicResponse | undefined;
    let secondError: unknown;
    try {
      second = await client.get(url, options as never) as PublicResponse;
    } catch (error) {
      secondError = error;
    }
    const requests = requestsAt('/revalidate');
    expect(requests).toHaveLength(2);

    expect({
      conditionalHeaders: requests.map((request) => request.headers['if-none-match']),
      first: { data: first.data, status: first.status },
      redirectCalls,
      second: second === undefined
        ? undefined
        : { data: second.data, fromCache: second.config.fromCache, status: second.status },
      secondError: secondError === undefined
        ? undefined
        : {
            code: Reflect.get(Object(secondError), 'code'),
            message: Reflect.get(Object(secondError), 'message'),
            name: Reflect.get(Object(secondError), 'name'),
          },
      servedStatuses: revalidationStatuses,
    }).toEqual({
      conditionalHeaders: [undefined, ETAG],
      first: { data: { version: 1 }, status: 200 },
      redirectCalls: 0,
      second: { data: { version: 1 }, fromCache: true, status: 200 },
      secondError: undefined,
      servedStatuses: [200, 304],
    });
  });

  it('returns a structured missing-Location error with the original request diagnostics', async () => {
    const url = `http://127.0.0.1:${portA}/missing-location`;
    let thrown: unknown;
    try {
      await new Rezo({}, httpAdapter).get(url, {
        headers: { 'X-Diagnostic': 'retained' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(requestsAt('/missing-location')).toHaveLength(1);
    expect(thrown).toBeInstanceOf(RezoError);
    const error = thrown as RezoError;
    expect({
      code: error.code,
      errno: error.errno,
      isRetryable: error.isRetryable,
      message: error.message,
      name: error.name,
      responseStatus: error.response?.status,
      responseStatusText: error.response?.statusText,
      toJSON: error.toJSON(),
    }).toEqual({
      code: 'REZ_MISSING_REDIRECT_LOCATION',
      errno: -1028,
      isRetryable: false,
      message: 'Redirect location not found',
      name: 'RezoError',
      responseStatus: 302,
      responseStatusText: 'Found',
      toJSON: {
        code: 'REZ_MISSING_REDIRECT_LOCATION',
        message: 'Redirect location not found',
        name: 'RezoError',
        status: 302,
        statusText: 'Found',
      },
    });
    expect(error.request).toBeDefined();
    expect(error.request!.headers).toBeInstanceOf(RezoHeaders);
    expect({
      diagnostic: (error.request!.headers as RezoHeaders).get('X-Diagnostic'),
      history: error.config.redirectHistory,
      method: error.request!.method,
      redirectCount: error.config.redirectCount,
      url: error.request!.fullUrl,
    }).toEqual({
      diagnostic: 'retained',
      history: [],
      method: 'GET',
      redirectCount: 0,
      url,
    });
  });

  it('recognizes Cookie decisions in every declared customHeaders carrier without mutating inputs', async () => {
    const nativeHeaders = new Headers({ Cookie: 'native=explicit' });
    const rezoHeaders = new RezoHeaders({ Cookie: 'rezo=explicit' });
    const tupleHeaders: [string, string][] = [['Cookie', 'tuple=explicit']];
    const recordHeaders = { Cookie: 'record=explicit' };
    const tombstone = { Cookie: undefined };

    const results = {
      control: await prepareRedirectCookie('control'),
      native: await prepareRedirectCookie('native', nativeHeaders),
      record: await prepareRedirectCookie('record', recordHeaders),
      rezo: await prepareRedirectCookie('rezo', rezoHeaders),
      tombstone: await prepareRedirectCookie('tombstone', tombstone),
      tuple: await prepareRedirectCookie('tuple', tupleHeaders),
    };

    expect({
      inputs: {
        native: nativeHeaders.get('Cookie'),
        record: recordHeaders.Cookie,
        rezo: rezoHeaders.get('Cookie'),
        tombstoneOwnKey: Object.prototype.hasOwnProperty.call(tombstone, 'Cookie'),
        tombstoneValue: tombstone.Cookie,
        tuple: tupleHeaders,
      },
      results,
    }).toEqual({
      inputs: {
        native: 'native=explicit',
        record: 'record=explicit',
        rezo: 'rezo=explicit',
        tombstoneOwnKey: true,
        tombstoneValue: undefined,
        tuple: [['Cookie', 'tuple=explicit']],
      },
      results: {
        control: 'jar=destination',
        native: 'native=explicit',
        record: 'record=explicit',
        rezo: 'rezo=explicit',
        tombstone: null,
        tuple: 'tuple=explicit',
      },
    });
  });
});
