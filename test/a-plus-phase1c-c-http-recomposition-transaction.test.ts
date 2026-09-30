/**
 * Phase 1c-c HTTP redirect recomposition — transaction and compatibility.
 *
 * This file is deliberately disjoint from Claude's lifetime suite. It stands
 * at adapter seams that the first recomposition checkpoint did not execute.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rezo } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { RezoError } from '../src/errors/rezo-error';

interface WireRequest {
  body: string;
  headers: Record<string, string>;
  method: string;
  rawHeaders: string[];
}

interface MutableRedirectConfig {
  finalUrl?: string;
  method?: string;
  originalBody?: unknown;
  redirectCount?: number;
  redirectHistory?: unknown[];
}

const wire = new Map<string, WireRequest[]>();
let serverA: http.Server;
let serverB: http.Server;
let portA = 0;
let portB = 0;

function record(path: string, request: http.IncomingMessage, body: string): void {
  const entry: WireRequest = {
    body,
    headers: { ...(request.headers as Record<string, string>) },
    method: String(request.method),
    rawHeaders: [...request.rawHeaders],
  };
  wire.set(path, [...(wire.get(path) ?? []), entry]);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function redirect(response: http.ServerResponse, location: string, status = 302): void {
  response.writeHead(status, { location });
  response.end();
}

function last(path: string): WireRequest {
  const requests = wire.get(path) ?? [];
  const request = requests.at(-1);
  if (!request) throw new Error(`fixture path was not reached: ${path}`);
  return request;
}

beforeAll(async () => {
  serverB = http.createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    record(path, request, await readBody(request));
    if (path === '/expiry-middle') {
      redirect(response, `http://127.0.0.1:${portA}/expiry-final`);
      return;
    }
    response.end('ok');
  });
  portB = await listen(serverB);

  serverA = http.createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    record(path, request, await readBody(request));
    if (path === '/invalid' || path === '/hook') {
      redirect(response, `http://127.0.0.1:${portA}/terminal`);
    } else if (path === '/history') {
      redirect(response, `http://127.0.0.1:${portA}/history-final`);
    } else if (path === '/hook-cookie-set') {
      redirect(response, `http://127.0.0.1:${portB}/cookie-set-destination`);
    } else if (path === '/hook-cookie-delete') {
      redirect(response, `http://127.0.0.1:${portB}/cookie-delete-destination`);
    } else if (path === '/hook-cookie-control') {
      redirect(response, `http://127.0.0.1:${portB}/cookie-control-destination`);
    } else if (path === '/hook-cookie-property-delete') {
      redirect(response, `http://127.0.0.1:${portB}/cookie-property-delete-destination`);
    } else if (path === '/hook-auth-reissue') {
      redirect(response, `http://127.0.0.1:${portB}/auth-destination`);
    } else if (path === '/hook-auth-control') {
      redirect(response, `http://127.0.0.1:${portB}/auth-control-destination`);
    } else if (path === '/replacement-start') {
      redirect(response, `http://127.0.0.1:${portA}/replacement-middle`);
    } else if (path === '/replacement-middle') {
      redirect(response, `http://127.0.0.1:${portA}/replacement-final`);
    } else if (path === '/retry-destination') {
      if ((wire.get(path)?.length ?? 0) === 1) {
        response.writeHead(503);
        response.end('retry');
      } else {
        redirect(response, `http://127.0.0.1:${portA}/retry-final`);
      }
    } else if (path === '/representation-start') {
      redirect(response, `http://127.0.0.1:${portA}/representation-middle`, 307);
    } else if (path === '/representation-middle') {
      redirect(response, `http://127.0.0.1:${portA}/representation-final`);
    } else if (path === '/expiry-start') {
      redirect(response, `http://127.0.0.1:${portB}/expiry-middle`);
    } else if (path === '/one-hop-start') {
      redirect(response, `http://127.0.0.1:${portA}/one-hop-middle`);
    } else if (path === '/one-hop-middle') {
      redirect(response, `http://127.0.0.1:${portA}/one-hop-final`);
    } else {
      response.end('ok');
    }
  });
  portA = await listen(serverA);
});

afterAll(async () => {
  await Promise.all([serverA, serverB].map((server) => (
    new Promise<void>((resolve) => server.close(() => resolve()))
  )));
});

beforeEach(() => wire.clear());

describe('Phase 1c-c HTTP redirect recomposition transaction', () => {
  it('rejects an invalid patch without committing URL, count, history, method, body, or headers', async () => {
    const sourceUrl = `http://127.0.0.1:${portA}/invalid`;
    const body = 'original-body';
    let liveConfig: MutableRedirectConfig | undefined;
    let thrown: unknown;

    try {
      await new Rezo({}, httpAdapter).request({
        url: sourceUrl,
        method: 'POST',
        body,
        headers: { 'Content-Length': String(Buffer.byteLength(body)), 'Content-Type': 'text/plain' },
        hooks: {
          beforeRedirect: [(_context: unknown, config: MutableRedirectConfig) => {
            liveConfig = config;
          }],
        },
        onRedirect: () => ({
          redirect: true,
          method: 'GET',
          withoutBody: true,
          setHeaders: { 'Bad\nName': 'rejected' },
        }),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(last('/invalid')).toMatchObject({ body, method: 'POST' });
    expect(wire.get('/terminal')).toBeUndefined();
    expect(thrown).toBeInstanceOf(RezoError);
    const error = thrown as RezoError;
    expect(error.code).toBe('ERR_INVALID_ARG_TYPE');
    expect(error.errno).toBe(-1008);
    expect(error.message).toBe('Invalid redirect header patch "setHeaders"');
    expect(error.isRetryable).toBe(false);
    expect(error.toJSON()).toMatchObject({
      code: 'ERR_INVALID_ARG_TYPE',
      message: 'Invalid redirect header patch "setHeaders"',
      name: 'RezoError',
    });
    expect(liveConfig).toBeDefined();
    expect(error.config).toBe(liveConfig);
    const errorHeaders = error.request?.headers as
      | { get(name: string): string | undefined }
      | undefined;
    // One aggregate assertion exposes every rollback dimension in the red
    // checkpoint; one early mismatch must not hide a second mutated field.
    expect({
      configBody: error.config.originalBody,
      configHistory: error.config.redirectHistory,
      configMethod: error.config.method,
      configUrl: error.config.finalUrl,
      count: error.config.redirectCount,
      requestBody: error.request?.body,
      requestContentLength: errorHeaders?.get('Content-Length'),
      requestContentType: errorHeaders?.get('Content-Type'),
      requestMethod: error.request?.method,
      requestUrl: error.request?.fullUrl,
    }).toEqual({
      configBody: body,
      configHistory: [],
      configMethod: 'POST',
      configUrl: sourceUrl,
      count: 0,
      requestBody: body,
      requestContentLength: String(Buffer.byteLength(body)),
      requestContentType: 'text/plain',
      requestMethod: 'POST',
      requestUrl: sourceUrl,
    });
  });

  it('snapshots redirect patch fields once before mutating transaction state', async () => {
    const sourceUrl = `http://127.0.0.1:${portA}/invalid`;
    const body = 'accessor-body';
    let reads = 0;
    let liveConfig: MutableRedirectConfig | undefined;
    let thrown: unknown;

    try {
      await new Rezo({}, httpAdapter).request({
        url: sourceUrl,
        method: 'POST',
        body,
        headers: { 'Content-Length': String(Buffer.byteLength(body)), 'Content-Type': 'text/plain' },
        hooks: {
          beforeRedirect: [(_context: unknown, config: MutableRedirectConfig) => {
            liveConfig = config;
          }],
        },
        onRedirect: () => ({
          redirect: true,
          method: 'GET',
          withoutBody: true,
          get setHeaders(): unknown {
            reads++;
            return reads === 1 ? { 'X-First-Read': 'valid' } : 42;
          },
        }),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(reads).toBe(1);
    expect(thrown).toBeUndefined();
    expect(wire.get('/terminal')).toHaveLength(1);
    expect(last('/terminal')).toMatchObject({ body: '', method: 'GET' });
    expect(last('/terminal').headers['x-first-read']).toBe('valid');
    expect(liveConfig).toBeDefined();
    expect(liveConfig?.redirectCount).toBe(1);
  });

  it('preserves hook header mutations while a callback patch keeps final precedence', async () => {
    const hook = vi.fn((context: unknown) => {
      const headers = (context as {
        request: { headers: { delete(name: string): void; set(name: string, value: string): void } };
      }).request.headers;
      headers.set('X-Hook-Added', 'hook');
      headers.set('X-Collision', 'hook');
      headers.delete('X-Hook-Deleted');
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      headers: { 'X-Base': 'base', 'X-Collision': 'caller', 'X-Hook-Deleted': 'caller' },
      hooks: { beforeRedirect: [hook] },
      onRedirect: () => ({ redirect: true, setHeaders: { 'X-Collision': 'callback' } }),
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/hook').headers['x-hook-deleted']).toBe('caller');
    expect(last('/terminal').headers).toMatchObject({
      'x-base': 'base',
      'x-collision': 'callback',
      'x-hook-added': 'hook',
    });
    expect(last('/terminal').headers['x-hook-deleted']).toBeUndefined();
  });

  it('replays an append operation exactly once on the first redirect', async () => {
    const hook = vi.fn((context: unknown) => {
      (context as {
        request: { headers: { append(name: string, value: string): void } };
      }).request.headers.append('X-List', 'hook');
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      headers: { 'X-List': 'base' },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/hook').headers['x-list']).toBe('base');
    expect(last('/terminal').headers['x-list']).toBe('base, hook');
  });

  it('normalizes a hook-replaced plain header carrier before applying the callback patch', async () => {
    const hook = vi.fn((context: unknown) => {
      const request = (context as { request: { headers?: unknown } }).request;
      request.headers = { 'X-Collision': 'hook', 'X-Hook-Replaced': 'hook' };
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      headers: { 'X-Collision': 'caller', 'X-Initial': 'caller' },
      hooks: { beforeRedirect: [hook] },
      onRedirect: () => ({
        redirect: true,
        setHeaders: { 'X-Callback': 'callback', 'X-Collision': 'callback' },
      }),
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/hook').headers['x-initial']).toBe('caller');
    expect(last('/terminal').headers).toMatchObject({
      'x-callback': 'callback',
      'x-collision': 'callback',
      'x-hook-replaced': 'hook',
    });
    expect(last('/terminal').headers['x-initial']).toBeUndefined();
  });

  it('does not confuse a user header with the private hook-recorder identity', async () => {
    const hook = vi.fn((context: unknown) => {
      const request = (context as { request: { headers?: unknown } }).request;
      request.headers = {
        __isHookRecorder: 'user-owned',
        'X-Replaced': 'hook',
      };
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      headers: { 'X-Old': 'caller' },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/terminal').headers).toMatchObject({
      '__ishookrecorder': 'user-owned',
      'x-replaced': 'hook',
    });
    expect(last('/terminal').headers['x-old']).toBeUndefined();
  });

  it('keeps inherited read-only methods out of the convenience-mutator table', async () => {
    let rendered: unknown;
    const hook = vi.fn((context: unknown) => {
      const headers = (context as { request: { headers: { toString(): string } } })
        .request.headers;
      rendered = headers.toString();
    });

    const response = await new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${portA}/hook`,
      {
        headers: { 'X-Readable': 'present' },
        hooks: { beforeRedirect: [hook] },
      } as never,
    );

    expect(hook).toHaveBeenCalledTimes(1);
    expect(typeof rendered).toBe('string');
    expect(String(rendered)).toContain('x-readable: present');
    expect(last('/hook').headers['x-readable']).toBe('present');
    expect(last('/terminal').headers['x-readable']).toBe('present');
    expect(response.status).toBe(200);
  });

  it('preserves valid prototype-shaped callback header names', async () => {
    const prototypeHeader = Object.fromEntries([
      ['__proto__', 'callback-owned'],
    ]);

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      onRedirect: () => ({ redirect: true, setHeaders: prototypeHeader }),
    } as never);

    const sourceRawHeaders = last('/hook').rawHeaders;
    const destinationRawHeaders = last('/terminal').rawHeaders;
    const sourceIndex = sourceRawHeaders.findIndex(
      (name) => name.toLowerCase() === '__proto__',
    );
    const destinationIndex = destinationRawHeaders.findIndex(
      (name) => name.toLowerCase() === '__proto__',
    );
    expect(sourceIndex).toBe(-1);
    expect(destinationIndex).toBeGreaterThanOrEqual(0);
    expect(destinationRawHeaders[destinationIndex + 1]).toBe('callback-owned');
  });

  it('keeps hook Cookie set and delete decisions authoritative over the destination jar', async () => {
    const setClient = new Rezo({}, httpAdapter);
    setClient.setCookies(
      ['jar=set; Path=/cookie-set-destination'],
      `http://127.0.0.1:${portB}/cookie-set-destination`,
    );
    await setClient.get(`http://127.0.0.1:${portA}/hook-cookie-set`, {
      hooks: {
        beforeRedirect: [((context: unknown) => {
          (context as { request: { headers: { set(name: string, value: string): void } } })
            .request.headers.set('Cookie', 'hook=explicit');
        })],
      },
    } as never);

    const deleteClient = new Rezo({}, httpAdapter);
    deleteClient.setCookies(
      ['jar=delete; Path=/cookie-delete-destination'],
      `http://127.0.0.1:${portB}/cookie-delete-destination`,
    );
    await deleteClient.get(`http://127.0.0.1:${portA}/hook-cookie-delete`, {
      hooks: {
        beforeRedirect: [((context: unknown) => {
          (context as { request: { headers: { delete(name: string): void } } })
            .request.headers.delete('Cookie');
        })],
      },
    } as never);

    // CONTROL: the mere presence of a hook must not disable destination-jar
    // projection. Only an observed Cookie operation owns that decision.
    const controlHook = vi.fn((context: unknown) => {
      (context as { request: { headers: { set(name: string, value: string): void } } })
        .request.headers.set('X-Control', 'hook');
    });
    const controlClient = new Rezo({}, httpAdapter);
    controlClient.setCookies(
      ['jar=control; Path=/cookie-control-destination'],
      `http://127.0.0.1:${portB}/cookie-control-destination`,
    );
    await controlClient.get(`http://127.0.0.1:${portA}/hook-cookie-control`, {
      hooks: { beforeRedirect: [controlHook] },
    } as never);

    expect(controlHook).toHaveBeenCalledTimes(1);
    expect({
      controlCookie: last('/cookie-control-destination').headers.cookie,
      controlHeader: last('/cookie-control-destination').headers['x-control'],
      deleteDestination: last('/cookie-delete-destination').headers.cookie,
      deleteSource: last('/hook-cookie-delete').headers.cookie,
      setDestination: last('/cookie-set-destination').headers.cookie,
      setSource: last('/hook-cookie-set').headers.cookie,
    }).toEqual({
      controlCookie: 'jar=control',
      controlHeader: 'hook',
      deleteDestination: undefined,
      deleteSource: undefined,
      setDestination: 'hook=explicit',
      setSource: undefined,
    });
  });

  it('honors an idempotent hook credential reissue after an origin change', async () => {
    const authorization = 'Bearer HOOK-REISSUE';
    // CONTROL: a hook that makes no Authorization decision must not turn off
    // ordinary cross-origin stripping merely because a hook exists.
    const controlHook = vi.fn((context: unknown) => {
      (context as { request: { headers: { set(name: string, value: string): void } } })
        .request.headers.set('X-Control', 'hook');
    });
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook-auth-control`, {
      headers: { Authorization: authorization },
      hooks: { beforeRedirect: [controlHook] },
    } as never);

    const hook = vi.fn((context: unknown) => {
      (context as { request: { headers: { set(name: string, value: string): void } } })
        .request.headers.set('Authorization', authorization);
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook-auth-reissue`, {
      headers: { Authorization: authorization },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(controlHook).toHaveBeenCalledTimes(1);
    expect(last('/hook-auth-control').headers.authorization).toBe(authorization);
    expect(last('/auth-control-destination').headers.authorization).toBeUndefined();
    expect(last('/auth-control-destination').headers['x-control']).toBe('hook');
    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/hook-auth-reissue').headers.authorization).toBe(authorization);
    expect(last('/auth-destination').headers.authorization).toBe(authorization);
  });

  it('tracks RezoHeaders convenience mutators as explicit hook intent', async () => {
    const authorization = 'Bearer CONVENIENCE-REISSUE';
    const hook = vi.fn((context: unknown) => {
      (context as {
        request: { headers: { setAuthorization(value: string): unknown } };
      }).request.headers.setAuthorization(authorization);
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook-auth-reissue`, {
      headers: { Authorization: authorization },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/hook-auth-reissue').headers.authorization).toBe(authorization);
    expect(last('/auth-destination').headers.authorization).toBe(authorization);
  });

  it('keeps convenience-mutator chains on the recording carrier', async () => {
    const authorization = 'Bearer CHAINED-REISSUE';
    let calls = 0;
    const hook = vi.fn((context: unknown) => {
      calls++;
      if (calls !== 2) return;
      (context as {
        request: {
          headers: {
            setAuthorization(value: string): { set(name: string, value: string): unknown };
          };
        };
      }).request.headers
        .setAuthorization(authorization)
        .set('X-Chain', 'recorded');
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/replacement-start`, {
      headers: { Authorization: authorization },
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(2);
    expect(last('/replacement-middle').headers['x-chain']).toBeUndefined();
    expect(last('/replacement-final').headers).toMatchObject({
      authorization,
      'x-chain': 'recorded',
    });
  });

  it('tracks dynamic RezoHeaders property assignment and deletion as hook intent', async () => {
    const authorization = 'Bearer PROPERTY-REISSUE';
    const assignmentHook = vi.fn((context: unknown) => {
      const headers = (context as { request: { headers: Record<string, string> } })
        .request.headers;
      headers.Authorization = authorization;
    });
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook-auth-reissue`, {
      headers: { Authorization: authorization },
      hooks: { beforeRedirect: [assignmentHook] },
    } as never);

    const deletionHook = vi.fn((context: unknown) => {
      const headers = (context as { request: { headers: { Cookie?: string } } })
        .request.headers;
      delete headers.Cookie;
    });
    const deleteClient = new Rezo({}, httpAdapter);
    deleteClient.setCookies(
      ['jar=property; Path=/cookie-property-delete-destination'],
      `http://127.0.0.1:${portB}/cookie-property-delete-destination`,
    );
    await deleteClient.get(`http://127.0.0.1:${portA}/hook-cookie-property-delete`, {
      hooks: { beforeRedirect: [deletionHook] },
    } as never);

    expect(assignmentHook).toHaveBeenCalledTimes(1);
    expect(deletionHook).toHaveBeenCalledTimes(1);
    expect({
      assignedAuthorization: last('/auth-destination').headers.authorization,
      deletedCookie: last('/cookie-property-delete-destination').headers.cookie,
    }).toEqual({
      assignedAuthorization: authorization,
      deletedCookie: undefined,
    });
  });

  it('preserves native RezoHeaders coercion for dynamic hook assignments', async () => {
    const hook = vi.fn((context: unknown) => {
      const headers = (context as { request: { headers: Record<string, unknown> } })
        .request.headers;
      headers['X-Undefined'] = undefined;
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/terminal').headers['x-undefined']).toBe('undefined');
  });

  it('never sends hook-added Proxy-Authorization to an origin', async () => {
    const proxyAuthorization = 'Basic PROXY-ONLY';
    const hook = vi.fn((context: unknown) => {
      const headers = (context as {
        request: { headers: { set(name: string, value: string): void } };
      }).request.headers;
      headers.set('Proxy-Authorization', proxyAuthorization);
      headers.set('X-Control', 'hook');
    });

    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/hook`, {
      hooks: { beforeRedirect: [hook] },
    } as never);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(last('/terminal').headers['x-control']).toBe('hook');
    expect(last('/terminal').headers['proxy-authorization']).toBeUndefined();
  });

  it('treats a later-hop header-carrier replacement as a full replacement', async () => {
    let calls = 0;
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/replacement-start`, {
      headers: { 'X-Initial': 'caller', 'X-Omitted': 'caller' },
      hooks: {
        beforeRedirect: [((context: unknown) => {
          calls++;
          if (calls === 2) {
            (context as { request: { headers?: unknown } }).request.headers = {
              'X-Replaced': 'hook',
            };
          }
        })],
      },
    } as never);

    expect(calls).toBe(2);
    expect(last('/replacement-middle').headers['x-initial']).toBe('caller');
    expect(last('/replacement-final').headers['x-replaced']).toBe('hook');
    expect(last('/replacement-final').headers['x-initial']).toBeUndefined();
    expect(last('/replacement-final').headers['x-omitted']).toBeUndefined();
  });

  it('does not resurrect representation headers after a 307-preserved body becomes a 302 GET', async () => {
    const body = 'representation-body';
    await new Rezo({}, httpAdapter).request({
      url: `http://127.0.0.1:${portA}/representation-start`,
      method: 'POST',
      body,
      headers: { 'Content-Length': String(Buffer.byteLength(body)), 'Content-Type': 'text/plain' },
    } as never);

    expect(last('/representation-middle')).toMatchObject({ body, method: 'POST' });
    expect(last('/representation-middle').headers['content-type']).toBe('text/plain');
    expect(last('/representation-final')).toMatchObject({ body: '', method: 'GET' });
    expect(last('/representation-final').headers['content-type']).toBeUndefined();
    expect(last('/representation-final').headers['content-length']).toBeUndefined();
  });

  it('stores an immutable source-request snapshot in redirect history', async () => {
    const sourceUrl = `http://127.0.0.1:${portA}/history`;
    const body = 'history-body';
    const result = await new Rezo({}, httpAdapter).request({
      url: sourceUrl,
      method: 'POST',
      body,
      headers: { 'Content-Length': String(Buffer.byteLength(body)), 'Content-Type': 'text/plain' },
    } as never);
    const history = result.config.redirectHistory;
    const entry = history[0];
    const requestHeaders = entry?.request.headers as
      | { get(name: string): string | undefined }
      | undefined;

    expect(history).toHaveLength(1);
    expect({
      entryMethod: entry?.method,
      entryUrl: entry?.url,
      requestBody: entry?.request.body,
      requestContentLength: requestHeaders?.get('Content-Length'),
      requestContentType: requestHeaders?.get('Content-Type'),
      requestMethod: entry?.request.method,
      requestUrl: entry?.request.fullUrl,
    }).toEqual({
      entryMethod: 'POST',
      entryUrl: sourceUrl,
      requestBody: body,
      requestContentLength: String(Buffer.byteLength(body)),
      requestContentType: 'text/plain',
      requestMethod: 'POST',
      requestUrl: sourceUrl,
    });
  });

  it('snapshots redirect history before destination-only hook mutations', async () => {
    const hook = vi.fn((context: unknown) => {
      (context as { request: { headers: { set(name: string, value: string): void } } })
        .request.headers.set('X-Destination-Only', 'hook');
    });
    const result = await new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${portA}/history`,
      { hooks: { beforeRedirect: [hook] } } as never,
    );
    const historyHeaders = result.config.redirectHistory[0]?.request.headers as
      | { get(name: string): string | undefined }
      | undefined;

    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.config.redirectHistory).toHaveLength(1);
    expect(historyHeaders).toBeDefined();
    expect(last('/history').headers['x-destination-only']).toBeUndefined();
    expect(last('/history-final').headers['x-destination-only']).toBe('hook');
    expect(historyHeaders!.get('X-Destination-Only')).toBeUndefined();
  });

  it('expires a persistent patch when the next callback returns no instruction', async () => {
    let calls = 0;
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/expiry-start`, {
      headers: { 'X-Same': 'caller' },
      onRedirect: () => {
        calls++;
        return calls === 1
          ? { redirect: true, setHeadersOnRedirects: { 'X-Same': 'persistent' } }
          : undefined;
      },
    } as never);

    expect(calls).toBe(2);
    expect(last('/expiry-middle').headers['x-same']).toBe('persistent');
    expect(last('/expiry-final').headers['x-same']).toBe('caller');
  });

  it('restores a caller value after a same-key one-hop patch expires', async () => {
    let calls = 0;
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/one-hop-start`, {
      headers: { 'X-Same': 'caller' },
      onRedirect: () => {
        calls++;
        return calls === 1
          ? { redirect: true, setHeaders: { 'X-Same': 'one-hop' } }
          : { redirect: true };
      },
    } as never);

    expect(calls).toBe(2);
    expect(last('/one-hop-middle').headers['x-same']).toBe('one-hop');
    expect(last('/one-hop-final').headers['x-same']).toBe('caller');
  });

  it('keeps a one-hop patch across retries of its destination, then expires it', async () => {
    let calls = 0;
    await new Rezo({}, httpAdapter).get(`http://127.0.0.1:${portA}/one-hop-start`, {
      headers: { 'X-Retry-Hop': 'caller' },
      onRedirect: () => {
        calls++;
        return calls === 1
          ? {
              redirect: true,
              url: `http://127.0.0.1:${portA}/retry-destination`,
              setHeaders: { 'X-Retry-Hop': 'one-hop' },
            }
          : { redirect: true };
      },
      retry: { delay: 5, maxRetries: 2, retryOn: [503] },
    } as never);

    const destinationAttempts = wire.get('/retry-destination') ?? [];
    expect(calls).toBe(2);
    expect(destinationAttempts).toHaveLength(2);
    expect(destinationAttempts.map((request) => request.headers['x-retry-hop']))
      .toEqual(['one-hop', 'one-hop']);
    expect(last('/retry-final').headers['x-retry-hop']).toBe('caller');
  });
});
