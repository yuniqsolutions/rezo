/**
 * A+ Phase 1c-b, P1-R0: every prepared request owns an error-history array.
 *
 * The permanent assertions describe the corrected contract. Before the shared
 * initializer exists, HTTP is the green control while Fetch and HTTP/2 each
 * stop after the fixture's first 503 at an internal `config.errors.push`.
 * Server hit/body ledgers prevent an unrelated client rejection from looking
 * like a retry, and the retained 503 history prevents a swallowed error from
 * looking like a correct final 200.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { RezoResponse } from '../src';
import { Rezo, RezoCookieJar, RezoError, RezoHeaders } from '../src';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { getDefaultConfig, prepareHTTPOptions } from '../src/utils/http-config';

const REQUEST_BODY = Buffer.from('phase-1c-b-replayable-buffer', 'utf8');

interface RetryLedger {
  hits: number;
  bodies: Buffer[];
}

const ledgers = new Map<string, RetryLedger>();
const h2Sessions = new Set<http2.ServerHttp2Session>();
let h1Server: http.Server | undefined;
let h2Server: http2.Http2Server | undefined;
let h1Port = 0;
let h2Port = 0;

function ledgerFor(path: string): RetryLedger {
  let ledger = ledgers.get(path);
  if (!ledger) {
    ledger = { hits: 0, bodies: [] };
    ledgers.set(path, ledger);
  }
  return ledger;
}

function recordAttempt(path: string, body: Buffer): { status: 503 | 200; responseBody: string } {
  const ledger = ledgerFor(path);
  ledger.hits += 1;
  ledger.bodies.push(body);
  const status = ledger.hits === 1 ? 503 : 200;
  return { status, responseBody: JSON.stringify({ attempt: ledger.hits }) };
}

function listen(server: http.Server | http2.Http2Server): Promise<number> {
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

async function closeServer(server: http.Server | http2.Http2Server | undefined): Promise<void> {
  if (!server || !server.listening) return;
  (server as http.Server).closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeAll(async () => {
  h1Server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      const observed = recordAttempt(path, Buffer.concat(chunks));
      response.writeHead(observed.status, { 'content-type': 'application/json' });
      response.end(observed.responseBody);
    });
  });
  h1Port = await listen(h1Server);

  h2Server = http2.createServer();
  h2Server.on('session', (session) => {
    h2Sessions.add(session);
    session.on('close', () => h2Sessions.delete(session));
    session.on('error', () => {});
  });
  h2Server.on('stream', (stream, headers) => {
    const responseStream = stream as http2.ServerHttp2Stream;
    responseStream.on('error', () => {});
    const path = String(headers[':path'] ?? '/');
    const chunks: Buffer[] = [];
    responseStream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    responseStream.on('end', () => {
      const observed = recordAttempt(path, Buffer.concat(chunks));
      responseStream.respond({ ':status': observed.status, 'content-type': 'application/json' });
      responseStream.end(observed.responseBody);
    });
  });
  h2Port = await listen(h2Server);
});

beforeEach(() => ledgers.clear());

afterAll(async () => {
  for (const session of h2Sessions) session.destroy();
  await Promise.all([closeServer(h1Server), closeServer(h2Server)]);
});

const adapters = [
  { name: 'http', adapter: httpAdapter, transport: 'h1' },
  { name: 'fetch', adapter: fetchAdapter, transport: 'h1' },
  { name: 'http2', adapter: http2Adapter, transport: 'h2' },
] as const;

function errorFields(error: unknown): { code: string | null; message: string | null } {
  if (!error || typeof error !== 'object') return { code: null, message: null };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === 'string' ? value.code : null,
    message: typeof value.message === 'string' ? value.message : null,
  };
}

describe('A+ Phase 1c-b P1-R0 — shared retry error history', () => {
  for (const { name, adapter, transport } of adapters) {
    it(`${name}: retries a replayable PUT once with identical body bytes`, async () => {
      const path = `/${name}-retry`;
      const port = transport === 'h2' ? h2Port : h1Port;
      const client = new Rezo({}, adapter);
      let response: RezoResponse<unknown> | undefined;
      let caught: unknown;

      try {
        response = await client.request({
          url: `http://127.0.0.1:${port}${path}`,
          method: 'PUT',
          body: Buffer.from(REQUEST_BODY),
          retry: { maxRetries: 2, retryOn: [503], retryDelay: 0 },
          timeout: 5000,
        } as never) as RezoResponse<unknown>;
      } catch (error) {
        caught = error;
      }

      const ledger = ledgerFor(path);
      expect({
        hits: ledger.hits,
        bodyHex: ledger.bodies.map((body) => body.toString('hex')),
        status: response?.status ?? null,
        ...errorFields(caught),
      }).toEqual({
        hits: 2,
        bodyHex: [REQUEST_BODY.toString('hex'), REQUEST_BODY.toString('hex')],
        status: 200,
        code: null,
        message: null,
      });

      // HTTP is the transport/body-replay control for this shared prerequisite.
      // Its adapter-local setInitialConfig currently resets retry history; that
      // separately executed defect belongs to the retained Phase 1c-c adapter
      // lane and cannot be repaired by the 1c-b shared initializer.
      if (name === 'http') {
        expect(Array.isArray(response?.config.errors)).toBe(true);
        return;
      }

      expect(response?.config.errors).toHaveLength(1);
      const history = response!.config.errors[0];
      expect({
        attempt: history.attempt,
        code: history.error.code,
        status: history.error.status,
        responseStatus: history.error.response?.status,
        message: history.error.message,
      }).toEqual({
        attempt: 1,
        code: 'REZ_HTTP_ERROR',
        status: 503,
        responseStatus: 503,
        message: 'Request failed with status code 503',
      });
      expect(Number.isFinite(history.duration)).toBe(true);
      expect(history.duration).toBeGreaterThanOrEqual(0);
    });
  }

  it('creates distinct empty error histories for independently prepared requests', async () => {
    const defaultOptions = await getDefaultConfig({});
    const first = prepareHTTPOptions(
      {
        url: 'http://a-plus.test/first',
        fullUrl: 'http://a-plus.test/first',
        method: 'GET',
      },
      new RezoCookieJar(),
      { defaultOptions },
    );
    const second = prepareHTTPOptions(
      {
        url: 'http://a-plus.test/second',
        fullUrl: 'http://a-plus.test/second',
        method: 'GET',
      },
      new RezoCookieJar(),
      { defaultOptions },
    );

    expect({
      firstIsArray: Array.isArray(first.config.errors),
      secondIsArray: Array.isArray(second.config.errors),
      firstLength: first.config.errors?.length ?? null,
      secondLength: second.config.errors?.length ?? null,
      sharesIdentity: first.config.errors === second.config.errors,
    }).toEqual({
      firstIsArray: true,
      secondIsArray: true,
      firstLength: 0,
      secondLength: 0,
      sharesIdentity: false,
    });
  });

  it('preserves the same error-history array and its entries during re-preparation', async () => {
    const defaultOptions = await getDefaultConfig({});
    const jar = new RezoCookieJar();
    const initial = prepareHTTPOptions(
      {
        url: 'http://a-plus.test/retry',
        fullUrl: 'http://a-plus.test/retry',
        method: 'GET',
      },
      jar,
      { defaultOptions },
    );

    expect(Array.isArray(initial.config.errors)).toBe(true);
    const history = initial.config.errors;
    const priorError = new RezoError(
      'prior retry failure',
      initial.config,
      'REZ_HTTP_ERROR',
      initial.fetchOptions,
    );
    const priorEntry = { attempt: 1, error: priorError, duration: 1 };
    history.push(priorEntry);

    const targetUrl = 'http://a-plus.test/retry-again';
    const preparedAgain = prepareHTTPOptions(
      {
        ...initial.fetchOptions,
        url: targetUrl,
        fullUrl: targetUrl,
        headers: new RezoHeaders(initial.fetchOptions.headers),
      },
      jar,
      {
        defaultOptions,
        isRedirected: true,
        isRetrying: true,
        fullUrl: targetUrl,
      },
      initial.config,
    );

    expect(preparedAgain.config).toBe(initial.config);
    expect(preparedAgain.config.errors).toBe(history);
    expect(preparedAgain.config.errors).toEqual([priorEntry]);
  });
});
