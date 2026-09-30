/**
 * FC — Fetch adapter `timeout.connect` honesty (R16-R15, working ruling q5-o1).
 *
 * The platform `fetch()` exposes no connect stage, so the Fetch adapter cannot honour a connect deadline. Silently
 * dropping it (the status quo) leaves a consumer who asked for `{ connect: 300 }` against an unreachable host with no
 * deadline at all. The ruled behaviour is a typed pre-dispatch refusal (`REZ_UNSUPPORTED_CAPABILITY`): `beforeError`
 * runs exactly once, nothing reaches the wire, and the headers / body / total phases keep working as before.
 * Runs on Node (vitest) and Bun (bun test) against a local HTTP/1.1 server.
 */

import * as http from 'node:http';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { RezoError } from '../src/errors/rezo-error';

let connections = 0;
let requests = 0;
const server = http.createServer((request, response) => {
  requests += 1;
  if (request.url === '/hold-headers') return; // never answers: a headers deadline must fire
  response.end('ok');
});
server.on('connection', () => { connections += 1; });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Settled = { ok: true; status: number } | { ok: false; error: RezoError };
const settle = async (promise: Promise<{ status: number }>): Promise<Settled> => {
  try { const response = await promise; return { ok: true, status: response.status }; } catch (error) { return { ok: false, error: error as RezoError }; }
};
const client = (timeout: unknown, hooks: Record<string, unknown[]> = {}) => new Rezo({ timeout: timeout as never, retry: false, hooks: hooks as never }, fetchAdapter);

it('FC-01 a positive connect deadline alone is refused before dispatch with REZ_UNSUPPORTED_CAPABILITY (beforeError once, nothing on the wire)', async () => {
  const before = { connections, requests };
  const seen: unknown[] = [];
  const result = await settle(client({ connect: 300 }, { beforeError: [(error: unknown) => { seen.push(error); return error; }] }).get(`${origin}/`));
  expect(result.ok).toBe(false);
  const error = (result as { error: RezoError }).error;
  expect(error).toBeInstanceOf(RezoError);
  expect(error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(error.message).toMatch(/connect/u);
  expect(seen).toHaveLength(1);
  expect({ connections: connections - before.connections, requests: requests - before.requests }).toEqual({ connections: 0, requests: 0 });
});

it('FC-02 a positive connect deadline beside a total is refused as a whole (fail closed, no partial honouring)', async () => {
  const before = { connections, requests };
  const result = await settle(client({ connect: 300, total: 2000 }).get(`${origin}/`));
  expect(result.ok).toBe(false);
  expect((result as { error: RezoError }).error.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect({ connections: connections - before.connections, requests: requests - before.requests }).toEqual({ connections: 0, requests: 0 });
});

it('FC-03 control: a headers deadline still fires as a timeout on a held response', async () => {
  const started = Date.now();
  const result = await settle(client({ headers: 300 }).get(`${origin}/hold-headers`));
  expect(result.ok).toBe(false);
  const error = (result as { error: RezoError }).error;
  expect(['ECONNABORTED', 'ESOCKETTIMEDOUT', 'ETIMEDOUT']).toContain(error.code);
  expect(Date.now() - started).toBeLessThan(2500);
});

it('FC-04 control: a non-positive connect value is not a connect deadline and the request proceeds', async () => {
  const result = await settle(client({ connect: 0, total: 2000 }).get(`${origin}/`));
  expect(result.ok).toBe(true);
  expect((result as { status: number }).status).toBe(200);
});
