/**
 * FR — Fetch per-hop redirect visibility (R16-R8).
 *
 * On a followed redirect the HTTP/1.1 adapter runs the `afterHeaders` hooks for every hop before its `beforeRedirect`
 * hooks and emits the documented `redirect` event on stream facades; the Fetch adapter ran `afterHeaders` for the final
 * response only and emitted no `redirect` event. Each Fetch row measures the H1 timeline on the same wire in the same
 * process — the contract is parity with H1, never a number invented here. FR-05…FR-07 (2026-08-29, after HD-1): a redirect the
 * adapter does not follow — an accepted manual redirect (followRedirects: false) or a maxRedirects: 0 denial — is still a response
 * the caller may inspect: H1 runs afterHeaders once for it; Fetch ran nothing.
 */

import * as http from 'node:http';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import type { RedirectEvent } from '../src/responses/types';

let requests = 0;
const server = http.createServer((request, response) => {
  requests += 1;
  if (request.url === '/a') { response.writeHead(302, { location: '/b' }); response.end('to b'); return; }
  if (request.url === '/b') { response.writeHead(301, { location: '/c' }); response.end('to c'); return; }
  response.setHeader('content-type', 'text/plain');
  response.end('final');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Adapter = typeof fetchAdapter;
type Timeline = { entries: string[]; redirectEvents: RedirectEvent[]; error?: { code?: string; hasCause: boolean }; requests: number };

async function timeline(adapter: Adapter, mode: 'buffered' | 'stream', options: { throwOnHop?: boolean; followRedirects?: boolean; maxRedirects?: number; path?: string } = {}): Promise<Timeline> {
  const entries: string[] = []; const redirectEvents: RedirectEvent[] = [];
  const before = requests;
  const rezo = new Rezo({
    retry: false, timeout: 5000, maxRedirects: options.maxRedirects ?? 5, ...(options.followRedirects === false ? { followRedirects: false } : {}),
    hooks: {
      afterHeaders: [(event: { status: number }) => { entries.push(`afterHeaders:${event.status}`); if (options.throwOnHop && event.status >= 300 && event.status < 400) throw new Error('hop rejected by afterHeaders'); }],
      beforeRedirect: [(context: { status: number }) => { entries.push(`beforeRedirect:${context.status}`); }],
      afterResponse: [(response: { status: number }) => { entries.push(`afterResponse:${response.status}`); return response; }],
    },
  } as never, adapter);
  let error: Timeline['error'];
  try {
    const path = options.path ?? '/a';
    if (mode === 'buffered') { await rezo.get(`${origin}${path}`); }
    else {
      const stream: any = await rezo.stream(`${origin}${path}`);
      stream.on('redirect', (event: RedirectEvent) => { entries.push('event:redirect'); redirectEvents.push(event); });
      for (const name of ['headers', 'done']) stream.on(name, () => entries.push(`event:${name}`));
      stream.on('error', (failure: { code?: string; cause?: unknown }) => { error = { code: failure?.code, hasCause: failure?.cause !== undefined }; });
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  } catch (failure) { error = { code: (failure as { code?: string }).code, hasCause: (failure as { cause?: unknown }).cause !== undefined }; }
  return { entries, redirectEvents, error, requests: requests - before };
}

it('FR-01 buffered: afterHeaders runs for every hop before beforeRedirect, in the H1 order', async () => {
  const reference = await timeline(httpAdapter, 'buffered');
  const fetch = await timeline(fetchAdapter, 'buffered');
  expect(reference.entries).toEqual(['afterHeaders:302', 'beforeRedirect:302', 'afterHeaders:301', 'beforeRedirect:301', 'afterHeaders:200', 'afterResponse:200']);
  expect(fetch.entries).toEqual(reference.entries);
  expect(fetch.requests).toBe(reference.requests);
});

it('FR-02 stream: the redirect event fires per hop between afterHeaders and beforeRedirect, with the documented payload', async () => {
  const reference = await timeline(httpAdapter, 'stream');
  const fetch = await timeline(fetchAdapter, 'stream');
  expect(reference.entries.filter((entry) => entry === 'event:redirect')).toHaveLength(2);
  expect(fetch.entries).toEqual(reference.entries);
  expect(fetch.redirectEvents.map((event) => [event.sourceStatus, new URL(event.destinationUrl).pathname, event.redirectCount, event.maxRedirects, event.method]))
    .toEqual(reference.redirectEvents.map((event) => [event.sourceStatus, new URL(event.destinationUrl).pathname, event.redirectCount, event.maxRedirects, event.method]));
  expect(fetch.redirectEvents[0]!.sourceUrl).toBe(`${origin}/a`);
  expect(fetch.redirectEvents[0]!.headers.get('location')).toBe('/b');
});

it('FR-03 a per-hop afterHeaders throw is a callback failure before the next hop is dispatched, as on H1', async () => {
  const reference = await timeline(httpAdapter, 'buffered', { throwOnHop: true });
  const fetch = await timeline(fetchAdapter, 'buffered', { throwOnHop: true });
  expect(reference.error).toBeDefined();
  expect(fetch.error).toEqual(reference.error);
  expect(fetch.entries).toEqual(reference.entries);
  expect(fetch.requests).toBe(reference.requests);
});

// H1 announces a `redirect` event even when it does not follow (measured 2026-08-29: one event with followRedirects:false) —
// an H1 quirk against the documented "emitted when a redirect is followed", recorded as a fact for the H1 lane, not asserted here.
it('FR-04 control: with followRedirects:false exactly one request reaches the wire on both adapters and Fetch emits no redirect event', async () => {
  const reference = await timeline(httpAdapter, 'stream', { followRedirects: false });
  const fetch = await timeline(fetchAdapter, 'stream', { followRedirects: false });
  expect(Array.isArray(reference.entries)).toBe(true); // H1 fact only
  expect(fetch.entries.filter((entry) => entry === 'event:redirect')).toEqual([]);
  expect(reference.requests).toBe(1);
  expect(fetch.requests).toBe(1);
});

const afterHeadersEntries = (result: Timeline): string[] => result.entries.filter((entry) => entry.startsWith('afterHeaders:'));

it('FR-05 an accepted manual redirect (followRedirects: false) runs afterHeaders once for the 3xx on both adapters, buffered and stream', async () => {
  for (const mode of ['buffered', 'stream'] as const) {
    const reference = await timeline(httpAdapter, mode, { followRedirects: false });
    const fetch = await timeline(fetchAdapter, mode, { followRedirects: false });
    expect(afterHeadersEntries(reference)).toEqual(['afterHeaders:302']);
    expect(afterHeadersEntries(fetch)).toEqual(afterHeadersEntries(reference));
    expect(fetch.error).toEqual(reference.error);
    expect(fetch.requests).toBe(reference.requests);
  }
});

it('FR-06 a throwing afterHeaders on an accepted manual redirect is a callback failure carrying the cause on both adapters', async () => {
  const reference = await timeline(httpAdapter, 'buffered', { followRedirects: false, throwOnHop: true });
  const fetch = await timeline(fetchAdapter, 'buffered', { followRedirects: false, throwOnHop: true });
  expect(reference.error).toBeDefined();
  expect(fetch.error).toEqual(reference.error);
  expect(afterHeadersEntries(fetch)).toEqual(afterHeadersEntries(reference));
  expect(fetch.requests).toBe(reference.requests);
});

it('FR-07 a maxRedirects: 0 denial runs afterHeaders for the denied 3xx exactly as H1 does (parity of the hook timeline and the failure code)', async () => {
  const reference = await timeline(httpAdapter, 'buffered', { maxRedirects: 0, path: '/b' });
  const fetch = await timeline(fetchAdapter, 'buffered', { maxRedirects: 0, path: '/b' });
  expect(afterHeadersEntries(fetch)).toEqual(afterHeadersEntries(reference));
  expect(fetch.error?.code).toBe(reference.error?.code);
  expect(fetch.requests).toBe(reference.requests);
});
