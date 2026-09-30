/**
 * RU — relative request URLs (R16-R4).
 *
 * The core resolves `new URL(url, baseURL)`. Without a base a relative URL cannot be resolved: that refusal was Node's bare
 * `TypeError: Invalid URL` (not a RezoError) on every adapter. It is a typed `ERR_INVALID_URL` naming the missing baseURL, raised
 * before any wire work; with a `baseURL` the same relative URL resolves (control). A malformed absolute URL keeps the runtime's
 * native `TypeError` (DECISION-058 A: distinct classes are preserved). In a browser page the platform entry supplies the document
 * location as the default base — the Chrome-backed browser-entry carrier proves that side.
 */

import * as http from 'node:http';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { RezoError } from '../src/errors/rezo-error';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

let hits = 0;
const server = http.createServer((_request, response) => { hits += 1; response.setHeader('content-type', 'text/plain'); response.end('resolved'); });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Adapter = typeof httpAdapter;
const ADAPTERS: ReadonlyArray<readonly [string, Adapter]> = [['h1', httpAdapter], ['fetch', fetchAdapter]];
// The native TypeError's text is runtime-owned (class and code are not): frozen per runtime, as the R15/R16 identity fields are.
const NATIVE_INVALID_URL_MESSAGE = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? '"http://[::1" cannot be parsed as a URL.' : 'Invalid URL';

it('RU-01 a relative URL without a baseURL is a typed ERR_INVALID_URL RezoError naming the missing base, before any wire hit, on both adapters', async () => {
  for (const [label, adapter] of ADAPTERS) {
    const before = hits; const rezo = new Rezo({ retry: false, timeout: 3000 } as never, adapter);
    let failure: unknown;
    try { await rezo.get('/relative/path'); } catch (error) { failure = error; }
    expect({ adapter: label, isRezoError: failure instanceof RezoError, code: (failure as { code?: string })?.code, mentionsBase: /baseURL/.test(String((failure as Error)?.message)), hits: hits - before })
      .toEqual({ adapter: label, isRezoError: true, code: 'ERR_INVALID_URL', mentionsBase: true, hits: 0 });
  }
});

it('RU-03 a malformed absolute URL keeps the native TypeError (code ERR_INVALID_URL, not a RezoError), before any wire hit, on both adapters — with and without a baseURL', async () => {
  for (const [label, adapter] of ADAPTERS) {
    for (const baseURL of [undefined, origin]) {
      const before = hits; const rezo = new Rezo({ retry: false, timeout: 3000, ...(baseURL ? { baseURL } : {}) } as never, adapter);
      let failure: unknown;
      try { await rezo.get('http://[::1'); } catch (error) { failure = error; }
      expect({ adapter: label, baseURL: baseURL !== undefined, isRezoError: failure instanceof RezoError, name: (failure as Error)?.name, code: (failure as { code?: string })?.code, message: (failure as Error)?.message, hits: hits - before })
        .toEqual({ adapter: label, baseURL: baseURL !== undefined, isRezoError: false, name: 'TypeError', code: 'ERR_INVALID_URL', message: NATIVE_INVALID_URL_MESSAGE, hits: 0 });
    }
  }
});

it('RU-02 control: with a baseURL the same relative URL resolves and reaches the wire on both adapters', async () => {
  for (const [label, adapter] of ADAPTERS) {
    const before = hits; const rezo = new Rezo({ retry: false, timeout: 3000, baseURL: origin } as never, adapter);
    const response = await rezo.get('/relative/path', { responseType: 'text' });
    expect({ adapter: label, status: response.status, data: response.data, hits: hits - before }).toEqual({ adapter: label, status: 200, data: 'resolved', hits: 1 });
  }
});
