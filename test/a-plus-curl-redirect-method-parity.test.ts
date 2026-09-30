/**
 * A+ cURL redirect method parity.
 *
 * Following a redirect must rewrite the request the same way on every adapter:
 * 301/302/303 land as GET without the body or its representation headers,
 * 307/308 keep the method and body, credentials leave the request when the hop
 * changes origin, and the redirect limit is one typed error. curl's own `-L`
 * keeps an explicit `-X` method on every hop, so the cURL adapter owns those
 * hops itself. Every row observes the destination wire through the public
 * `Rezo` surface and compares it with the HTTP/1.1 adapter on the same scenario.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as nodeFs from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { getFS } from '../src/utils/http-config';

// Under the Vitest module runner the product's dynamic import of 'node:fs' can
// resolve to nothing; the shared helper then falls back to a global require.
let restoreRequireBridge: (() => void) | undefined;
async function ensureFilesystemAccess(): Promise<void> {
  if (await getFS() !== undefined) return;
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'require');
  Object.defineProperty(globalThis, 'require', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (specifier: string): unknown => {
      if (specifier !== 'node:fs' && specifier !== 'fs') throw new Error(`require bridge rejected ${specifier}`);
      return nodeFs;
    },
  });
  restoreRequireBridge = () => {
    Reflect.deleteProperty(globalThis, 'require');
    if (prior) Object.defineProperty(globalThis, 'require', prior);
  };
  if (await getFS() === undefined) throw new Error('require bridge did not enable filesystem access');
}

/** One request as the destination saw it. */
interface Wire {
  authorization: string | null;
  bodyLength: number;
  contentType: string | null;
  cookie: string | null;
  method: string;
  path: string;
}

interface Origin {
  server: http.Server;
  url: string;
  seen: Wire[];
}

const originA: Origin = { server: undefined as unknown as http.Server, url: '', seen: [] };
const originB: Origin = { server: undefined as unknown as http.Server, url: '', seen: [] };

/**
 * Routes (identical on both origins):
 *   /redirect/<status>             -> Location: /dest
 *   /redirect/<status>/chain       -> Location: /redirect/302      (two hops, second is a 302)
 *   /redirect/<status>/chain-same  -> Location: /redirect/<status> (two hops of the same status)
 *   /redirect/<status>/cross       -> Location: <origin B>/dest
 *   /redirect/<status>/cookie      -> Location: /dest + Set-Cookie: hop=1
 *   /dest                          -> 200 "dest"
 */
function serveOrigin(origin: Origin): http.RequestListener {
  return (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = request.url ?? '/';
      origin.seen.push({
        authorization: request.headers.authorization ?? null,
        bodyLength: Buffer.concat(chunks).length,
        contentType: request.headers['content-type'] ?? null,
        cookie: request.headers.cookie ?? null,
        method: request.method ?? '',
        path: url,
      });
      const redirect = /^\/redirect\/(30[12378])(?:\/(chain|chain-same|cross|cookie))?$/u.exec(url);
      if (redirect) {
        const status = Number(redirect[1]);
        const variant = redirect[2];
        const location = variant === 'chain' ? '/redirect/302'
          : variant === 'chain-same' ? `/redirect/${status}`
            : variant === 'cross' ? `${originB.url}/dest`
              : '/dest';
        response.writeHead(status, { location, ...(variant === 'cookie' ? { 'set-cookie': 'hop=1; Path=/' } : {}) });
        response.end();
        return;
      }
      if (url === '/dest') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('dest'); return; }
      response.writeHead(404); response.end();
    });
  };
}

async function listen(origin: Origin): Promise<void> {
  origin.server = http.createServer(serveOrigin(origin));
  await new Promise<void>((resolve) => origin.server.listen(0, '127.0.0.1', () => resolve()));
  origin.url = `http://127.0.0.1:${(origin.server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await ensureFilesystemAccess();
  await listen(originA);
  await listen(originB);
});

afterAll(async () => {
  for (const origin of [originA, originB]) {
    origin.server.closeAllConnections?.();
    await new Promise<void>((resolve) => origin.server.close(() => resolve()));
  }
  restoreRequireBridge?.();
});

const field = (value: unknown, name: string): unknown => Reflect.get(Object(value), name);
const curlClient = (): Rezo => new Rezo({}, curlAdapter as never);
const httpClient = (): Rezo => new Rezo({}, httpAdapter as never);

interface Outcome {
  /** What the destination saw, or null when the chain never reached `/dest`. */
  dest: Wire | null;
  error: unknown;
  errorCode: unknown;
  finalUrl: unknown;
  /** Every request either origin saw, in order. */
  hops: Wire[];
  status: unknown;
  urls: unknown;
  value: unknown;
}

async function observe(client: Rezo, scenario: (client: Rezo) => Promise<unknown>): Promise<Outcome> {
  originA.seen.length = 0;
  originB.seen.length = 0;
  let value: unknown = null;
  let error: unknown = null;
  try { value = await scenario(client); } catch (caught) { error = caught; }
  const hops = [...originA.seen, ...originB.seen];
  const dest = hops.find((wire) => wire.path === '/dest') ?? null;
  return {
    dest,
    error,
    errorCode: error ? field(error, 'code') : null,
    finalUrl: value ? field(value, 'finalUrl') : undefined,
    hops,
    status: value ? field(value, 'status') : undefined,
    urls: value ? field(value, 'urls') : undefined,
    value,
  };
}

/** Runs the scenario through the HTTP/1.1 adapter (reference) and then through cURL. */
async function observeBoth(scenario: (client: Rezo) => Promise<unknown>): Promise<{ curl: Outcome; reference: Outcome }> {
  const reference = await observe(httpClient(), scenario);
  const curl = await observe(curlClient(), scenario);
  return { curl, reference };
}

const GET_WITHOUT_BODY: Wire = { authorization: null, bodyLength: 0, contentType: null, cookie: null, method: 'GET', path: '/dest' };

const METHOD_ROWS: ReadonlyArray<{ id: string; method: 'PUT' | 'PATCH' | 'DELETE' | 'POST'; body: string | undefined; status: 301 | 302 | 303 }> = [
  { id: 'CRM-01', method: 'PUT', body: 'payload', status: 301 },
  { id: 'CRM-02', method: 'PUT', body: 'payload', status: 302 },
  { id: 'CRM-03', method: 'PUT', body: 'payload', status: 303 },
  { id: 'CRM-04', method: 'PATCH', body: 'payload', status: 301 },
  { id: 'CRM-05', method: 'PATCH', body: 'payload', status: 302 },
  { id: 'CRM-06', method: 'PATCH', body: 'payload', status: 303 },
  { id: 'CRM-07', method: 'DELETE', body: undefined, status: 301 },
  { id: 'CRM-08', method: 'DELETE', body: undefined, status: 302 },
  { id: 'CRM-09', method: 'DELETE', body: undefined, status: 303 },
  { id: 'CRM-10', method: 'POST', body: undefined, status: 301 },
  { id: 'CRM-11', method: 'POST', body: undefined, status: 302 },
  { id: 'CRM-12', method: 'POST', body: undefined, status: 303 },
];

function send(client: Rezo, method: 'PUT' | 'PATCH' | 'DELETE' | 'POST' | 'GET', url: string, body: string | undefined, options: Record<string, unknown> = {}): Promise<unknown> {
  const requestOptions = { responseType: 'text', retry: false, ...options } as never;
  if (method === 'PUT') return client.put(url, body, requestOptions);
  if (method === 'PATCH') return client.patch(url, body, requestOptions);
  if (method === 'POST') return client.post(url, body, requestOptions);
  if (method === 'DELETE') return client.delete(url, requestOptions);
  return client.get(url, requestOptions);
}

for (const row of METHOD_ROWS) {
  it(`${row.id} ${row.method}${row.body ? ' with a body' : ' without a body'} followed through a ${row.status} lands as GET without the body (HTTP/1.1 parity)`, async () => {
    const { curl, reference } = await observeBoth((client) => send(client, row.method, `${originA.url}/redirect/${row.status}`, row.body));
    expect(reference.dest).toEqual(GET_WITHOUT_BODY);
    expect(curl.error).toBeNull();
    expect(curl.dest).toEqual(GET_WITHOUT_BODY);
    expect(curl.hops.map((wire) => wire.method)).toEqual(reference.hops.map((wire) => wire.method));
    expect(field(curl.value, 'data')).toBe('dest');
    expect(curl.status).toBe(200);
    expect(curl.finalUrl).toBe(`${originA.url}/dest`);
    expect(curl.urls).toEqual([`${originA.url}/redirect/${row.status}`, `${originA.url}/dest`]);
    expect(curl.urls).toEqual(reference.urls);
  });
}

for (const status of [307, 308] as const) {
  it(`CRM-13${status === 307 ? 'A' : 'B'} PUT followed through a ${status} keeps the method and the body (control)`, async () => {
    const { curl, reference } = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/${status}`, 'payload'));
    const expected: Wire = { authorization: null, bodyLength: 7, contentType: reference.dest?.contentType ?? null, cookie: null, method: 'PUT', path: '/dest' };
    expect(reference.dest).toEqual(expected);
    expect(curl.error).toBeNull();
    expect(curl.dest).toEqual(expected);
    expect(curl.status).toBe(200);
    expect(curl.urls).toEqual(reference.urls);
  });
}

it('CRM-14 a POST with a body followed through a 302 lands as GET and a plain GET chain stays GET (curl-native controls)', async () => {
  const post = await observeBoth((client) => send(client, 'POST', `${originA.url}/redirect/302`, 'payload'));
  expect(post.reference.dest).toEqual(GET_WITHOUT_BODY);
  expect(post.curl.dest).toEqual(GET_WITHOUT_BODY);
  const get = await observeBoth((client) => send(client, 'GET', `${originA.url}/redirect/302/chain`, undefined));
  expect(get.reference.dest).toEqual(GET_WITHOUT_BODY);
  expect(get.curl.dest).toEqual(GET_WITHOUT_BODY);
  expect(get.curl.urls).toEqual([`${originA.url}/redirect/302/chain`, `${originA.url}/redirect/302`, `${originA.url}/dest`]);
  expect(get.curl.urls).toEqual(get.reference.urls);
});

it('CRM-15 a PUT through a two-hop chain lands as GET with the full url chain (adapter hop, then curl-native tail)', async () => {
  const { curl, reference } = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302/chain`, 'payload'));
  expect(reference.dest).toEqual(GET_WITHOUT_BODY);
  expect(curl.error).toBeNull();
  expect(curl.dest).toEqual(GET_WITHOUT_BODY);
  expect(curl.hops.map((wire) => `${wire.method} ${wire.path}`)).toEqual(['PUT /redirect/302/chain', 'GET /redirect/302', 'GET /dest']);
  expect(curl.hops.map((wire) => `${wire.method} ${wire.path}`)).toEqual(reference.hops.map((wire) => `${wire.method} ${wire.path}`));
  expect(curl.urls).toEqual([`${originA.url}/redirect/302/chain`, `${originA.url}/redirect/302`, `${originA.url}/dest`]);
  expect(curl.urls).toEqual(reference.urls);
});

it('CRM-16 the redirect limit is one typed error whether the adapter or curl follows the hop that exceeds it', async () => {
  const owned = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/307/chain-same`, 'payload', { maxRedirects: 1 }));
  expect(owned.reference.errorCode).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
  expect(owned.curl.errorCode).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
  expect(owned.curl.dest).toBeNull();
  const tail = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302/chain`, 'payload', { maxRedirects: 1 }));
  expect(tail.reference.errorCode).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
  expect(tail.curl.errorCode).toBe('REZ_MAX_REDIRECTS_EXCEEDED');
  expect(tail.curl.dest).toBeNull();
  const within = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302/chain`, 'payload', { maxRedirects: 2 }));
  expect(within.curl.error).toBeNull();
  expect(within.curl.dest).toEqual(GET_WITHOUT_BODY);
});

it('CRM-17 followRedirects: false settles the 302 itself and never reaches the destination', async () => {
  const { curl, reference } = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302`, 'payload', { followRedirects: false }));
  expect(reference.status).toBe(302);
  expect(curl.error).toBeNull();
  expect(curl.status).toBe(302);
  expect(curl.dest).toBeNull();
  expect(curl.hops.map((wire) => `${wire.method} ${wire.path}`)).toEqual(['PUT /redirect/302']);
});

it('CRM-18 credentials stay on a same-origin hop and leave a cross-origin hop (HTTP/1.1 parity)', async () => {
  const headers = { authorization: 'Bearer test-token', cookie: 'sid=test' };
  const same = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302`, 'payload', { headers }));
  expect(same.reference.dest?.method).toBe('GET');
  expect(same.reference.dest?.authorization).toBe('Bearer test-token');
  expect(same.curl.dest).toEqual(same.reference.dest);
  const cross = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302/cross`, 'payload', { headers }));
  expect(cross.reference.dest).toEqual(GET_WITHOUT_BODY);
  expect(cross.curl.dest).toEqual(GET_WITHOUT_BODY);
  expect(cross.curl.finalUrl).toBe(`${originB.url}/dest`);
  expect(cross.curl.urls).toEqual(cross.reference.urls);
});

it('CRM-19 curl.locationTrusted keeps the credentials on a cross-origin hop, exactly like --location-trusted', async () => {
  const outcome = await observe(curlClient(), (client) => send(client, 'PUT', `${originA.url}/redirect/302/cross`, 'payload', {
    curl: { locationTrusted: true },
    headers: { authorization: 'Bearer test-token' },
  }));
  expect(outcome.error).toBeNull();
  expect(outcome.dest).toEqual({ ...GET_WITHOUT_BODY, authorization: 'Bearer test-token' });
});

it('CRM-20 a cookie set by the redirect hop reaches the destination on the next hop (HTTP/1.1 parity)', async () => {
  const { curl, reference } = await observeBoth((client) => send(client, 'PUT', `${originA.url}/redirect/302/cookie`, 'payload'));
  expect(reference.dest).toEqual({ ...GET_WITHOUT_BODY, cookie: 'hop=1' });
  expect(curl.error).toBeNull();
  expect(curl.dest).toEqual({ ...GET_WITHOUT_BODY, cookie: 'hop=1' });
});

it('CRM-21 a streamed PUT followed through a 302 streams only the destination body and lands as GET', async () => {
  const scenario = (client: Rezo): Promise<unknown> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = client.stream(`${originA.url}/redirect/302`, { data: 'payload', method: 'PUT', retry: false } as never);
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('finish', (event: { finalUrl: string; status: number }) => resolve({ body: Buffer.concat(chunks).toString(), finalUrl: event.finalUrl, status: event.status }));
  });
  const { curl, reference } = await observeBoth(scenario);
  expect(reference.dest).toEqual(GET_WITHOUT_BODY);
  expect(reference.value).toEqual({ body: 'dest', finalUrl: `${originA.url}/dest`, status: 200 });
  expect(curl.error).toBeNull();
  expect(curl.dest).toEqual(GET_WITHOUT_BODY);
  expect(curl.value).toEqual({ body: 'dest', finalUrl: `${originA.url}/dest`, status: 200 });
});

it('CRM-22 a downloaded PUT followed through a 302 writes only the destination body and leaves no stage file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-crm-download-'));
  try {
    const scenario = (client: Rezo): Promise<unknown> => new Promise((resolve, reject) => {
      const target = path.join(directory, client === undefined ? 'x' : `download-${originA.seen.length}-${Date.now()}.txt`);
      const download = client.download(`${originA.url}/redirect/302`, target, { data: 'payload', method: 'PUT', retry: false } as never);
      download.on('error', reject);
      download.on('finish', () => resolve({ content: existsSync(target) ? readFileSync(target, 'utf8') : null, target }));
    });
    const { curl, reference } = await observeBoth(scenario);
    expect(reference.dest).toEqual(GET_WITHOUT_BODY);
    expect(field(reference.value, 'content')).toBe('dest');
    expect(curl.error).toBeNull();
    expect(curl.dest).toEqual(GET_WITHOUT_BODY);
    expect(field(curl.value, 'content')).toBe('dest');
    expect(readdirSync(directory).filter((name) => name.includes('.rezo-partial-'))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
