/**
 * HM — HTTP/1.1 manual-redirect facade contract (R16-R6 + the documented `redirect` event).
 *
 * Two facts surfaced while bringing the Fetch adapter to parity: the HTTP/1.1 adapter emits the `redirect` event on a
 * redirect it does NOT follow (the docs say "emitted when a redirect is followed"), and an accepted manual redirect
 * (`followRedirects: false`) on a stream facade never reaches a terminal — no `done`, no `close`, `isFinished()` stays
 * false while the request has already resolved with the 3xx. The Fetch adapter publishes one lawful terminal for that
 * case; this carrier holds HTTP/1.1 to the same contract. Rows observe a local HTTP/1.1 server. HM-04/HM-05 (after HD-1): the
 * download and upload facades on an accepted manual redirect — Fetch gives exactly one lawful terminal, commits no file and never
 * errors; H1 is measured against it in-row.
 */

import * as http from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { installNodeRequireBridge } from './fixtures/node-require-bridge';

const server = http.createServer((request, response) => {
  if (request.url === '/redirect') { response.writeHead(302, { location: '/', 'content-type': 'text/plain' }); response.end('moved'); return; }
  if (request.url === '/chain') { response.writeHead(302, { location: '/' }); response.end('to root'); return; }
  response.setHeader('content-type', 'text/plain');
  response.end('final');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));
const scratch = mkdtempSync(join(tmpdir(), 'h1-manual-redirect-'));
const requireBridge = installNodeRequireBridge();
afterAll(() => requireBridge.restore());

type Adapter = typeof httpAdapter;
const TRACKED = ['headers', 'redirect', 'end', 'finish', 'done', 'complete', 'close', 'error'] as const;

async function streamLifecycle(adapter: Adapter, path: string, options: Record<string, unknown> = {}): Promise<{ events: string[]; status: number; finished: boolean; finishedAtClose: boolean | null }> {
  const rezo = new Rezo({ retry: false, timeout: 5000, ...options } as never, adapter);
  const events: string[] = []; let finishedAtClose: boolean | null = null;
  const facade: any = await rezo.stream(`${origin}${path}`);
  for (const name of TRACKED) facade.on(name, () => { events.push(name); if (name === 'close') finishedAtClose = facade.isFinished(); });
  try { for await (const _chunk of facade) { /* drain */ } } catch { /* rows observe the events */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { events, status: facade.status ?? facade.statusCode ?? -1, finished: facade.isFinished(), finishedAtClose };
}

it('HM-01 HTTP/1.1 emits no redirect event on a redirect it does not follow (followRedirects: false)', async () => {
  const manual = await streamLifecycle(httpAdapter, '/redirect', { followRedirects: false });
  expect(manual.events.filter((name) => name === 'redirect')).toEqual([]);
});

it('HM-02 an accepted manual redirect on the HTTP/1.1 stream facade publishes one lawful terminal: end, finish, done, complete, then close — as the Fetch adapter does', async () => {
  const reference = await streamLifecycle(fetchAdapter, '/redirect', { followRedirects: false });
  const h1 = await streamLifecycle(httpAdapter, '/redirect', { followRedirects: false });
  expect(reference.events.filter((name) => ['end', 'finish', 'done', 'complete', 'close'].includes(name))).toEqual(['end', 'finish', 'done', 'complete', 'close']);
  expect(h1.events.filter((name) => ['end', 'finish', 'done', 'complete', 'close'].includes(name))).toEqual(['end', 'finish', 'done', 'complete', 'close']);
  expect(h1.events.filter((name) => name === 'error')).toEqual([]);
  expect(h1.finished).toBe(true);
  expect(h1.finishedAtClose).toBe(true);
});

it('HM-03 control: a followed redirect still emits exactly one redirect event per hop on HTTP/1.1', async () => {
  const followed = await streamLifecycle(httpAdapter, '/chain');
  expect(followed.events.filter((name) => name === 'redirect')).toHaveLength(1);
  expect(followed.events.filter((name) => name === 'done')).toHaveLength(1);
});

type FacadeOutcome = { events: string[]; finished: boolean; status: number; fileExists: boolean | null };
async function facadeLifecycle(adapter: Adapter, kind: 'download' | 'upload', label: string): Promise<FacadeOutcome> {
  const rezo = new Rezo({ retry: false, timeout: 5000, followRedirects: false } as never, adapter);
  const events: string[] = [];
  const file = join(scratch, `${label}-${kind}.bin`);
  const facade: any = kind === 'download' ? await rezo.download(`${origin}/redirect`, file) : await rezo.upload(`${origin}/redirect`, 'HM-UPLOAD');
  for (const name of TRACKED) facade.on(name, (payload: unknown) => events.push(name === 'error' ? `error:${String((payload as { code?: string })?.code ?? 'no-code')}:${String((payload as { name?: string })?.name ?? '')}:${String((payload as { message?: string })?.message ?? '').slice(0, 80)}` : name));
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { events, finished: facade.isFinished(), status: facade.status ?? facade.statusCode ?? -1, fileExists: kind === 'download' ? existsSync(file) : null };
}

it('HM-04 an accepted manual redirect on the HTTP/1.1 download facade publishes one lawful terminal (finish, done, complete), commits no file and never errors — as the Fetch adapter does', async () => {
  const reference = await facadeLifecycle(fetchAdapter, 'download', 'fetch');
  const h1 = await facadeLifecycle(httpAdapter, 'download', 'h1');
  const terminal = (outcome: FacadeOutcome) => outcome.events.filter((name) => name.startsWith('error:') || ['finish', 'done', 'complete'].includes(name));
  expect({ reference: terminal(reference), h1: terminal(h1) }).toEqual({ reference: ['finish', 'done', 'complete'], h1: ['finish', 'done', 'complete'] });
  expect(h1.finished).toBe(true);
  expect(h1.fileExists).toBe(false);
});

it('HM-05 an accepted manual redirect on the HTTP/1.1 upload facade publishes one lawful terminal (finish, done, complete) and never errors — as the Fetch adapter does', async () => {
  const reference = await facadeLifecycle(fetchAdapter, 'upload', 'fetch');
  const h1 = await facadeLifecycle(httpAdapter, 'upload', 'h1');
  const terminal = (outcome: FacadeOutcome) => outcome.events.filter((name) => name.startsWith('error:') || ['finish', 'done', 'complete'].includes(name));
  expect({ reference: terminal(reference), h1: terminal(h1) }).toEqual({ reference: ['finish', 'done', 'complete'], h1: ['finish', 'done', 'complete'] });
  expect(h1.finished).toBe(true);
});
