/**
 * A+ Phase 1c-b, P1-M1: redirect callback headers overlay the prepared base.
 *
 * The wire control proves the same redirect preserves caller/default headers
 * without an overlay. The overlay row then requires those same headers to
 * survive while an inert collision is replaced. Direct shared-preparation rows
 * pin cloning, tombstones, and the final proxy-only credential guard without
 * claiming cookie/XSRF, representation framing, or callback-lifetime closure.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RezoResponse } from '../src';
import { Rezo, RezoCookieJar, RezoHeaders } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { getDefaultConfig, prepareHTTPOptions } from '../src/utils/http-config';
import { prepareRedirectHeaders } from '../src/utils/headers';

const SOURCE_URL = 'http://a-plus.test/source';
const TARGET_URL = 'http://a-plus.test/destination';

interface RedirectLedger {
  sourceHits: number;
  destinationHits: number;
  headers: http.IncomingHttpHeaders | null;
}

const ledger: RedirectLedger = { sourceHits: 0, destinationHits: 0, headers: null };
let server: http.Server | undefined;
let port = 0;

function resetLedger(): void {
  ledger.sourceHits = 0;
  ledger.destinationHits = 0;
  ledger.headers = null;
}

function listen(value: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      value.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      value.off('error', onError);
      resolve((value.address() as AddressInfo).port);
    };
    value.once('error', onError);
    value.once('listening', onListening);
    value.listen(0, '127.0.0.1');
  });
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    if (path === '/redirect') {
      ledger.sourceHits += 1;
      response.writeHead(302, { location: `http://127.0.0.1:${port}/destination` });
      response.end();
      return;
    }
    if (path === '/destination') {
      ledger.destinationHits += 1;
      ledger.headers = request.headers;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ arrived: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  port = await listen(server);
});

beforeEach(resetLedger);

afterAll(async () => {
  if (!server || !server.listening) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

async function followRedirect(withOverlay: boolean): Promise<{
  status: number | null;
  code: string | null;
}> {
  const client = new Rezo(
    { headers: { 'X-Prepared': 'prepared' } },
    httpAdapter,
  );
  let response: RezoResponse<unknown> | undefined;
  let caught: unknown;

  try {
    response = await client.get(`http://127.0.0.1:${port}/redirect`, {
      headers: {
        Accept: 'application/json',
        'X-Caller': 'caller',
        'X-Keep': 'survives',
        'X-Collision': 'base',
      },
      timeout: 5000,
      ...(withOverlay
        ? {
            onRedirect: () => ({
              redirect: true,
              setHeaders: {
                'X-Overlay': 'applied',
                'X-Collision': 'overlay',
                'Proxy-Authorization': 'Basic forbidden-on-origin',
              },
            }),
          }
        : {}),
    } as never) as RezoResponse<unknown>;
  } catch (error) {
    caught = error;
  }

  return { status: response?.status ?? null, code: errorCode(caught) };
}

function receivedHeader(name: string): string | null {
  const value = ledger.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : null;
}

function headerEntries(headers: RezoHeaders): [string, string][] {
  return [...headers.entries()].map(([name, value]) => [name, value]);
}

function sameEntries(left: [string, string][], right: [string, string][]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function prepareBase() {
  const defaultOptions = await getDefaultConfig({ headers: { 'X-Prepared': 'prepared' } });
  const jar = new RezoCookieJar();
  const initial = prepareHTTPOptions(
    {
      url: SOURCE_URL,
      fullUrl: SOURCE_URL,
      method: 'GET',
      headers: {
        'X-Caller': 'caller',
        'X-Keep': 'survives',
        'X-Collision': 'base',
        'X-Delete-Undefined': 'remove-me',
        'X-Delete-Empty': 'remove-me-too',
        'Proxy-Authorization': 'Basic inherited-proxy-only',
      },
    },
    jar,
    { defaultOptions },
  );
  expect(initial.fetchOptions.headers).toBeInstanceOf(RezoHeaders);
  return { initial, jar, defaultOptions, base: initial.fetchOptions.headers as RezoHeaders };
}

function prepareWithOverlay(
  prepared: Awaited<ReturnType<typeof prepareBase>>,
  customHeaders: NonNullable<Parameters<typeof prepareHTTPOptions>[2]['customHeaders']>,
) {
  return prepareHTTPOptions(
    {
      ...prepared.initial.fetchOptions,
      url: SOURCE_URL,
      fullUrl: TARGET_URL,
      headers: prepared.base,
    },
    prepared.jar,
    {
      defaultOptions: prepared.defaultOptions,
      customHeaders,
      isRedirected: true,
      redirectedUrl: TARGET_URL,
      fullUrl: SOURCE_URL,
      lastRedirectedUrl: SOURCE_URL,
      redirectCode: 302,
    },
    prepared.initial.config,
  );
}

describe('A+ Phase 1c-b P1-M1 — redirect overlay wire ground truth', () => {
  it('control: the same-origin redirect preserves caller and prepared headers without an overlay', async () => {
    const outcome = await followRedirect(false);
    expect({
      sourceHits: ledger.sourceHits,
      destinationHits: ledger.destinationHits,
      status: outcome.status,
      code: outcome.code,
      accept: receivedHeader('accept'),
      caller: receivedHeader('x-caller'),
      keep: receivedHeader('x-keep'),
      prepared: receivedHeader('x-prepared'),
      collision: receivedHeader('x-collision'),
    }).toEqual({
      sourceHits: 1,
      destinationHits: 1,
      status: 200,
      code: null,
      accept: 'application/json',
      caller: 'caller',
      keep: 'survives',
      prepared: 'prepared',
      collision: 'base',
    });
  });

  it('merges the overlay over caller and prepared headers at the destination', async () => {
    const outcome = await followRedirect(true);
    expect({
      sourceHits: ledger.sourceHits,
      destinationHits: ledger.destinationHits,
      status: outcome.status,
      code: outcome.code,
      accept: receivedHeader('accept'),
      caller: receivedHeader('x-caller'),
      keep: receivedHeader('x-keep'),
      prepared: receivedHeader('x-prepared'),
      collision: receivedHeader('x-collision'),
      overlay: receivedHeader('x-overlay'),
      proxyAuthorization: receivedHeader('proxy-authorization'),
    }).toEqual({
      sourceHits: 1,
      destinationHits: 1,
      status: 200,
      code: null,
      accept: 'application/json',
      caller: 'caller',
      keep: 'survives',
      prepared: 'prepared',
      collision: 'overlay',
      overlay: 'applied',
      proxyAuthorization: null,
    });
  });
});

describe('A+ Phase 1c-b P1-M1 — immutable shared header composition', () => {
  it('preserves inherited Authorization for a same-origin explicit overlay', async () => {
    const prepared = await prepareBase();
    prepared.base.set('Authorization', 'Bearer same-origin-control');
    const baseSnapshot = headerEntries(prepared.base);
    const overlay = { 'X-Overlay': 'applied' };
    const overlaySnapshot = JSON.stringify(overlay);
    const result = prepareWithOverlay(prepared, overlay);
    const resultHeaders = result.fetchOptions.headers as RezoHeaders;

    expect({
      authorization: resultHeaders.get('authorization'),
      overlay: resultHeaders.get('x-overlay'),
      proxyAuthorization: resultHeaders.get('proxy-authorization'),
      distinctFromBase: resultHeaders !== prepared.base,
      baseUnchanged: sameEntries(headerEntries(prepared.base), baseSnapshot),
      overlayUnchanged: JSON.stringify(overlay) === overlaySnapshot,
    }).toEqual({
      authorization: 'Bearer same-origin-control',
      overlay: 'applied',
      proxyAuthorization: null,
      distinctFromBase: true,
      baseUnchanged: true,
      overlayUnchanged: true,
    });
  });

  it('merges RezoHeaders without mutating or aliasing either input', async () => {
    const prepared = await prepareBase();
    const overlay = new RezoHeaders({
      'X-Overlay': 'applied',
      'X-Collision': 'overlay',
      'Proxy-Authorization': 'Basic forbidden-on-origin',
    });
    const baseSnapshot = headerEntries(prepared.base);
    const overlaySnapshot = headerEntries(overlay);
    const result = prepareWithOverlay(prepared, overlay);
    const resultHeaders = result.fetchOptions.headers as RezoHeaders;

    expect({
      caller: resultHeaders.get('x-caller'),
      keep: resultHeaders.get('x-keep'),
      prepared: resultHeaders.get('x-prepared'),
      collision: resultHeaders.get('x-collision'),
      overlay: resultHeaders.get('x-overlay'),
      proxyAuthorization: resultHeaders.get('proxy-authorization'),
      distinctFromBase: resultHeaders !== prepared.base,
      distinctFromOverlay: resultHeaders !== overlay,
      baseUnchanged: sameEntries(headerEntries(prepared.base), baseSnapshot),
      overlayUnchanged: sameEntries(headerEntries(overlay), overlaySnapshot),
    }).toEqual({
      caller: 'caller',
      keep: 'survives',
      prepared: 'prepared',
      collision: 'overlay',
      overlay: 'applied',
      proxyAuthorization: null,
      distinctFromBase: true,
      distinctFromOverlay: true,
      baseUnchanged: true,
      overlayUnchanged: true,
    });

    resultHeaders.set('X-Result-Only', 'result');
    expect(headerEntries(prepared.base)).toEqual(baseSnapshot);
    expect(headerEntries(overlay)).toEqual(overlaySnapshot);
  });

  it('honors record tombstones while retaining the base and final proxy guard', async () => {
    const prepared = await prepareBase();
    const overlay = {
      'X-Overlay': 'applied',
      'X-Delete-Undefined': undefined,
      'X-Delete-Empty': [] as string[],
      'Proxy-Authorization': 'Basic forbidden-on-origin',
    };
    const overlaySnapshot = Object.entries(overlay).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]);
    const result = prepareWithOverlay(prepared, overlay);
    const resultHeaders = result.fetchOptions.headers as RezoHeaders;

    expect({
      caller: resultHeaders.get('x-caller'),
      prepared: resultHeaders.get('x-prepared'),
      overlay: resultHeaders.get('x-overlay'),
      undefinedTombstone: resultHeaders.get('x-delete-undefined'),
      emptyArrayTombstone: resultHeaders.get('x-delete-empty'),
      proxyAuthorization: resultHeaders.get('proxy-authorization'),
      overlayUnchanged: JSON.stringify(Object.entries(overlay).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ])) === JSON.stringify(overlaySnapshot),
    }).toEqual({
      caller: 'caller',
      prepared: 'prepared',
      overlay: 'applied',
      undefinedTombstone: null,
      emptyArrayTombstone: null,
      proxyAuthorization: null,
      overlayUnchanged: true,
    });
  });

  it('control: prepareRedirectHeaders is fixed-point, immutable, and proxy-safe', () => {
    const base = new RezoHeaders({
      'X-Keep': 'survives',
      'X-Collision': 'base',
      'Proxy-Authorization': 'Basic inherited-proxy-only',
    });
    const overlay = {
      'X-Collision': 'overlay',
      'X-Overlay': 'applied',
      'Proxy-Authorization': 'Basic forbidden-on-origin',
    };
    const baseSnapshot = headerEntries(base);
    const overlaySnapshot = JSON.stringify(overlay);
    const once = prepareRedirectHeaders(base, 'same-origin', overlay);
    const twice = prepareRedirectHeaders(once, 'same-origin', overlay);

    expect(headerEntries(twice)).toEqual(headerEntries(once));
    expect(headerEntries(base)).toEqual(baseSnapshot);
    expect(JSON.stringify(overlay)).toBe(overlaySnapshot);
    expect(once.get('x-keep')).toBe('survives');
    expect(once.get('x-collision')).toBe('overlay');
    expect(once.get('x-overlay')).toBe('applied');
    expect(once.has('proxy-authorization')).toBe(false);
  });
});
