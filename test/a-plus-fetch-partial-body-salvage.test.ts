/**
 * FS — Fetch `acceptPartialBody` salvage on transport truncation (R16-R9).
 *
 * `acceptPartialBody: true` is a documented request option: when the response headers passed `validateStatus` and body
 * bytes arrived before the peer tore the connection down, the request resolves normally with the partial body and
 * `truncated: true`. The HTTP/1.1 adapter honours it for buffered requests; the Fetch adapter still rejected with the
 * transport error. Each Fetch row measures the H1 reference on the same wire in the same process. Download and stream
 * facades are not salvaged on either adapter (control), and a caller cancellation is never salvaged (control).
 */

import * as http from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { installNodeRequireBridge } from './fixtures/node-require-bridge';

const server = http.createServer((request, response) => {
  const status = request.url === '/truncate-500' ? 500 : 200;
  response.writeHead(status, { 'content-length': '1000', 'content-type': request.url === '/truncate-json' ? 'application/json' : 'text/plain' });
  response.write(request.url === '/truncate-json' ? '{"partial":true' : 'partial-bytes');
  setTimeout(() => response.socket?.destroy(), 40);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const scratch = mkdtempSync(join(tmpdir(), 'fetch-salvage-'));
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));
const requireBridge = installNodeRequireBridge();
afterAll(() => requireBridge.restore());

type Adapter = typeof fetchAdapter;
type Outcome = { ok: true; status: number; data: unknown; truncated: unknown; contentLength: unknown } | { ok: false; code?: string; hasResponse: boolean };

async function buffered(adapter: Adapter, path: string, options: Record<string, unknown> = {}): Promise<Outcome> {
  const rezo = new Rezo({ retry: false, timeout: 5000, acceptPartialBody: true, ...options } as never, adapter);
  try {
    const response = await rezo.get(`${origin}${path}`, { responseType: 'text' });
    return { ok: true, status: response.status, data: response.data, truncated: (response as { truncated?: unknown }).truncated, contentLength: response.contentLength };
  } catch (error) { return { ok: false, code: (error as { code?: string }).code, hasResponse: (error as { response?: unknown }).response !== undefined }; }
}

it('FS-01 buffered transport truncation with acceptPartialBody resolves with the partial body and truncated: true, as on H1', async () => {
  const reference = await buffered(httpAdapter, '/truncate');
  const fetch = await buffered(fetchAdapter, '/truncate');
  expect(reference).toEqual({ ok: true, status: 200, data: 'partial-bytes', truncated: true, contentLength: expect.any(Number) });
  expect(fetch).toEqual(reference);
});

it('FS-02 a truncated JSON body is delivered as the H1 representation (unparseable partial text stays text) with truncated: true', async () => {
  const reference = await buffered(httpAdapter, '/truncate-json');
  const fetch = await buffered(fetchAdapter, '/truncate-json');
  expect(reference.ok).toBe(true);
  expect(fetch).toEqual(reference);
});

it('FS-03 control: a rejected status is never salvaged — the truncation stays an error carrying the response on both adapters', async () => {
  const reference = await buffered(httpAdapter, '/truncate-500');
  const fetch = await buffered(fetchAdapter, '/truncate-500');
  expect(reference.ok).toBe(false);
  expect(fetch).toEqual(reference);
});

it('FS-04 control: a caller cancellation mid-body is never salvaged into a success on either adapter', async () => {
  const run = async (adapter: Adapter): Promise<Outcome> => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15);
    const rezo = new Rezo({ retry: false, timeout: 5000, acceptPartialBody: true } as never, adapter);
    try { const response = await rezo.get(`${origin}/truncate`, { responseType: 'text', signal: controller.signal } as never); return { ok: true, status: response.status, data: response.data, truncated: (response as { truncated?: unknown }).truncated, contentLength: response.contentLength }; }
    catch (error) { return { ok: false, code: (error as { code?: string }).code, hasResponse: (error as { response?: unknown }).response !== undefined }; }
  };
  const reference = await run(httpAdapter);
  const fetch = await run(fetchAdapter);
  expect(reference.ok).toBe(false);
  expect(fetch.ok).toBe(false);
});

it('FS-05 control: download and stream facades are not salvaged on either adapter (recorded parity)', async () => {
  for (const [label, adapter] of [['h1', httpAdapter], ['fetch', fetchAdapter]] as const) {
    const rezo = new Rezo({ retry: false, timeout: 5000, acceptPartialBody: true } as never, adapter);
    const file = join(scratch, `${label}.bin`);
    const downloadEvents: string[] = [];
    try { const facade: any = await rezo.download(`${origin}/truncate`, file); for (const name of ['done', 'error']) facade.on(name, () => downloadEvents.push(name)); await new Promise((resolve) => setTimeout(resolve, 500)); } catch (error) { downloadEvents.push(`threw:${(error as { code?: string }).code}`); }
    expect(downloadEvents.includes('done')).toBe(false);
    expect(existsSync(file)).toBe(false);
    const streamEvents: string[] = [];
    try { const facade: any = await rezo.stream(`${origin}/truncate`); for (const name of ['done', 'error']) facade.on(name, () => streamEvents.push(name)); try { for await (const _chunk of facade) { /* drain */ } } catch { streamEvents.push('iter-threw'); } await new Promise((resolve) => setTimeout(resolve, 300)); } catch (error) { streamEvents.push(`threw:${(error as { code?: string }).code}`); }
    expect(streamEvents.includes('done')).toBe(false);
  }
});
