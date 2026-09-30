/**
 * TH — header-time events belong to the terminal attempt, exactly once, on every adapter (Phase 1c-c contract, HD-6).
 *
 * The decision "is this attempt terminal?" is taken by `statusAttemptContinues` before any user code or wait cap runs, so an
 * attempt that a later refusal makes terminal (Retry-After caps, `condition`, `onRetry`, `maxRetries`) had its `headers` /
 * `status` / `cookies` suppressed and never published. The late-flush contract keeps terminal-only visibility and makes it exact:
 * the events of a provisionally non-terminal attempt are held and published only if that attempt turns out terminal, before its
 * error terminal. Five scenarios × {HTTP/1.1, HTTP/2 (Node), Fetch}; per-adapter wire hits are recorded as diagnostics because the
 * refusal points differ per adapter (HTTP/2 consults `condition`/`onRetry` on status retries; HTTP/1.1 and Fetch do not).
 */

import * as http from 'node:http';
import * as http2 from 'node:http2';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as http2Adapter } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
// @ts-expect-error — untyped ESM fixture
import { generateSanCertificate } from './fixtures/stealth/wire-observer.mjs';

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const attempts = new Map<string, number>();
let hits = 0;
function serve(url: string | undefined, writeHead: (status: number, headers: Record<string, string>) => void, end: (body: string) => void): void {
  hits += 1;
  const path = url ?? '/'; const route = path.split('?')[0]; const attempt = (attempts.get(path) ?? 0) + 1; attempts.set(path, attempt);
  if (route === '/503-once' && attempt === 1) { writeHead(503, { 'content-type': 'text/plain', 'content-length': '4' }); end('busy'); return; }
  if (route === '/503') { writeHead(503, { 'content-type': 'text/plain', 'content-length': '4' }); end('busy'); return; }
  if (route === '/429') { writeHead(429, { 'content-type': 'text/plain', 'content-length': '4', 'retry-after': '1' }); end('slow'); return; }
  writeHead(200, { 'content-type': 'text/plain', 'content-length': '5' }); end('hello');
}
const h1Server = http.createServer((request, response) => serve(request.url, (s, h) => response.writeHead(s, h), (b) => response.end(b)));
await new Promise<void>((resolve) => h1Server.listen(0, '127.0.0.1', resolve));
const h1Origin = `http://127.0.0.1:${(h1Server.address() as { port: number }).port}`;
const certificate = generateSanCertificate() as { key: string; cert: string };
const h2Server = http2.createSecureServer({ key: certificate.key, cert: certificate.cert, allowHTTP1: true }, (request, response) => serve(request.url, (s, h) => response.writeHead(s, h), (b) => response.end(b)));
await new Promise<void>((resolve) => h2Server.listen(0, '127.0.0.1', resolve));
const h2Origin = `https://127.0.0.1:${(h2Server.address() as { port: number }).port}`;
afterAll(() => new Promise<void>((resolve) => { h1Server.closeAllConnections?.(); h1Server.close(() => h2Server.close(() => resolve())); }));

type Adapter = typeof httpAdapter;
type Observation = { headers: number[]; terminal: string; headersBeforeTerminal: boolean; hits: number };
let rowSeq = 0;
async function observe(adapter: Adapter, origin: string, path: string, options: Record<string, unknown>): Promise<Observation> {
  const before = hits; rowSeq += 1;
  // Options travel per request, exactly as the HSD retry/wait rows pass them.
  const rezo = new Rezo({ timeout: 8000, rejectUnauthorized: false } as never, adapter);
  const facade: any = rezo.stream(`${origin}${path}?r=${rowSeq}`, options as never);
  const headers: number[] = []; let terminal = 'none'; let terminalAt = -1; let lastHeadersAt = -1; let index = 0;
  facade.on('headers', (event: { status?: number }) => { headers.push(event?.status ?? -1); lastHeadersAt = index++; });
  await new Promise<void>((resolve) => {
    facade.on('done', () => { terminal = 'done'; terminalAt = index++; resolve(); });
    facade.on('error', (error: { code?: string }) => { terminal = `error:${error?.code}`; terminalAt = index++; resolve(); });
    setTimeout(resolve, 6000);
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { headers, terminal, headersBeforeTerminal: headers.length > 0 && lastHeadersAt < terminalAt, hits: hits - before };
}
const retryOnce = (extra: Record<string, unknown> = {}) => ({ retry: { maxRetries: 1, retryDelay: 50, backoff: 1, statusCodes: [503], onRetry: () => true, ...extra } });
const SCENARIOS: Array<{ id: string; path: string; options: Record<string, unknown>; expectStatus: (observation: Observation) => number }> = [
  { id: 'S1 accepted retry-listed 503 then 200', path: '/503-once', options: retryOnce(), expectStatus: () => 200 },
  { id: 'S2 condition refuses the 503 retry', path: '/503-once', options: retryOnce({ condition: () => false }), expectStatus: (o) => (o.hits === 1 ? 503 : 200) },
  { id: 'S3 onRetry refuses the 503 retry', path: '/503-once', options: retryOnce({ onRetry: () => false }), expectStatus: (o) => (o.hits === 1 ? 503 : 200) },
  { id: 'S4 Retry-After wait refused by maxWaitAttempts: 0', path: '/429', options: { retry: false, waitOnStatus: [429], maxWaitAttempts: 0 }, expectStatus: () => 429 },
  { id: 'S5 Retry-After wait refused by maxWaitTime below Retry-After', path: '/429', options: { retry: false, waitOnStatus: [429], maxWaitTime: 1 }, expectStatus: () => 429 },
];
const ADAPTERS: Array<{ label: string; adapter: Adapter; origin: string; base: number; nodeOnly: boolean }> = [
  { label: 'h1', adapter: httpAdapter, origin: h1Origin, base: 0, nodeOnly: false },
  { label: 'h2', adapter: http2Adapter, origin: h2Origin, base: 5, nodeOnly: true },
  { label: 'fetch', adapter: fetchAdapter, origin: h1Origin, base: 10, nodeOnly: false },
];
for (const { label, adapter, origin, base, nodeOnly } of ADAPTERS) {
  SCENARIOS.forEach((scenario, index) => {
    const id = `TH-${String(base + index + 1).padStart(2, '0')}`;
    it.skipIf(nodeOnly && isBun)(`${id} ${label}: ${scenario.id} — header-time events exactly once, for the terminal attempt, before the terminal`, async () => {
      const observation = await observe(adapter, origin, scenario.path, scenario.options);
      console.log(`${id} ${label} diagnostics: ${JSON.stringify(observation)}`);
      const terminalStatus = scenario.expectStatus(observation);
      const expectedTerminal = terminalStatus === 200 ? 'done' : 'error:REZ_HTTP_ERROR';
      expect({ headers: observation.headers, terminal: observation.terminal, headersBeforeTerminal: observation.headersBeforeTerminal })
        .toEqual({ headers: [terminalStatus], terminal: expectedTerminal, headersBeforeTerminal: true });
    });
  });
}
