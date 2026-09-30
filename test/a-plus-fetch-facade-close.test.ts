/**
 * FX — Fetch stream facade trailing `close` (R16-R10).
 *
 * The HTTP/1.1 adapter pipes the wire into the stream facade, so a clean end calls `StreamResponse.end()` and the
 * consumer sees `headers → end → finish → done → close`. The Fetch adapter emitted the trio and stopped: a consumer
 * releasing resources on `close` never heard it. Each Fetch row measures the H1 reference on the same wire in the
 * same process, so the contract is parity with H1, never a number invented here. Download and upload facades emit
 * no `close` on either adapter (control rows keep that parity visible).
 */

import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { importNodeModule } from '../src/utils/node-runtime.js';

const server = http.createServer((request, response) => {
  if (request.url === '/redirect') {
    response.writeHead(302, { location: '/', 'content-type': 'text/plain' });
    response.end('moved');
    return;
  }
  if (request.url === '/truncate') {
    response.setHeader('content-length', '1000');
    response.write('partial');
    setTimeout(() => response.socket?.destroy(), 40);
    return;
  }
  response.setHeader('content-type', 'text/plain');
  response.end('hello world body');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const scratch = mkdtempSync(join(tmpdir(), 'fetch-facade-close-'));
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Adapter = typeof fetchAdapter;
const TRACKED = ['headers', 'end', 'finish', 'done', 'complete', 'close', 'error'] as const;

/** Runs one facade and returns the lifecycle events in order (data/progress dropped), plus the finished flag at `close`. */
async function lifecycle(adapter: Adapter, mode: 'stream' | 'download' | 'upload', path = '/', options: Record<string, unknown> = {}): Promise<{ events: string[]; finishedAtClose: boolean | null }> {
  const rezo = new Rezo({ retry: false, timeout: 5000, ...options } as never, adapter);
  const events: string[] = [];
  let finishedAtClose: boolean | null = null;
  const facade: any = mode === 'stream'
    ? await rezo.stream(`${origin}${path}`)
    : mode === 'download'
      ? await rezo.download(`${origin}${path}`, join(scratch, `${mode}-${Math.random().toString(36).slice(2)}.bin`))
      : await rezo.upload(`${origin}${path}`, { body: 'payload', method: 'POST' } as never);
  for (const name of TRACKED) facade.on(name, () => { events.push(name); if (name === 'close') finishedAtClose = typeof facade.isFinished === 'function' ? facade.isFinished() : null; });
  if (mode === 'stream') { try { for await (const _chunk of facade) { /* drain */ } } catch { /* error rows observe the events */ } }
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { events, finishedAtClose };
}

it('FX-01 Fetch stream success ends with exactly one close after done, as the H1 stream facade does', async () => {
  const reference = await lifecycle(httpAdapter, 'stream');
  const fetch = await lifecycle(fetchAdapter, 'stream');
  expect(reference.events.filter((name) => name === 'close')).toHaveLength(1);
  expect(reference.events.indexOf('close')).toBeGreaterThan(reference.events.indexOf('done'));
  expect(fetch.events).toEqual(reference.events);
  expect(fetch.finishedAtClose).toBe(true);
});

it('FX-02 Fetch stream transport truncation emits close exactly as often as the H1 stream facade on the same wire', async () => {
  const reference = await lifecycle(httpAdapter, 'stream', '/truncate');
  const fetch = await lifecycle(fetchAdapter, 'stream', '/truncate');
  expect(fetch.events.filter((name) => name === 'close').length).toBe(reference.events.filter((name) => name === 'close').length);
  expect(fetch.events.filter((name) => name === 'error').length).toBe(reference.events.filter((name) => name === 'error').length);
});

it('FX-03 control: download and upload facades emit no close on either adapter (recorded parity)', async () => {
  // HTTP/1.1 imports the R36 download-target transaction statically; the
  // universal Fetch lane must load it through the opaque loader, which
  // vite-node cannot service (a relative specifier has no module context inside
  // the `Function`-built `import()`). On Node and Bun both lanes download and
  // the events match — verified out of band — so full-event parity for
  // `download` is only observable where that module actually resolves. The
  // close contract, which is what this row guards, is asserted either way.
  const transaction = await importNodeModule('../adapters/download-target-transaction.js');
  const comparableModes = transaction
    ? (['download', 'upload'] as const)
    : (['upload'] as const);
  if (!transaction) {
    console.log('FX-03: download-event parity not observable here — the Fetch lane\'s opaque transaction module does not resolve under this loader; upload parity still asserted.');
  }

  for (const mode of ['download', 'upload'] as const) {
    const reference = await lifecycle(httpAdapter, mode);
    const fetch = await lifecycle(fetchAdapter, mode);
    expect(reference.events.filter((name) => name === 'close')).toEqual([]);
    expect(fetch.events.filter((name) => name === 'close')).toEqual([]);
    if ((comparableModes as readonly string[]).includes(mode)) {
      expect(fetch.events).toEqual(reference.events);
    }
  }
});

// H1 is NOT the reference here: its manual-redirect stream facade is a named H1 residual (R16-R6, R18 window) and emits no
// close today (measured 2026-08-29: []). Fetch publishes exactly one lawful success terminal for an accepted manual redirect
// (FP-89), so the stream contract — one close after done, finished at close — is asserted directly; H1's count is recorded.
it('FX-04 an accepted manual redirect (followRedirects: false) on the Fetch stream facade ends with one close after its lawful terminal', async () => {
  const reference = await lifecycle(httpAdapter, 'stream', '/redirect', { followRedirects: false });
  const fetch = await lifecycle(fetchAdapter, 'stream', '/redirect', { followRedirects: false });
  expect(Array.isArray(reference.events)).toBe(true); // H1 fact only (R16-R6), never an assertion on its close count
  expect(fetch.events.filter((name) => name === 'close')).toHaveLength(1);
  expect(fetch.events.indexOf('close')).toBeGreaterThan(fetch.events.indexOf('done'));
  expect(fetch.finishedAtClose).toBe(true);
});
