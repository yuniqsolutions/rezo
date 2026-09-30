/**
 * A+ cURL lifecycle ownership.
 *
 * The cURL adapter owns the same request lifecycle as the in-process adapters:
 * every staged budget (`headers`, `body`, not only `connect`/`total`), one
 * total budget across retry attempts and their delays, a download target that
 * is either committed whole or reported as a typed failure, stage cleanup that
 * precedes the public abort, informational `1xx` responses that are never
 * redirect hops, and redirect cookies stored against the hop that set them.
 * Every row observes the public `Rezo` surface on an untouched fixture.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import * as nodeFs from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
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

const pending = new Set<NodeJS.Timeout>();
const later = (ms: number, fn: () => void): void => { const t = setTimeout(() => { pending.delete(t); fn(); }, ms); pending.add(t); };
const holds = new Set<http.ServerResponse>();

type Seen = { cookie: string | null; host: string | null; method: string; url: string };
const seen: Seen[] = [];
let server: http.Server;
let baseUrl = '';
/** Listens on every interface so `localhost` (a different host name) reaches it too. */
let localhostServer: http.Server;
let localhostUrl = '';
let rawServer: net.Server;
let rawBaseUrl = '';

function record(request: http.IncomingMessage): void {
  seen.push({ cookie: request.headers.cookie ?? null, host: request.headers.host ?? null, method: request.method ?? '', url: request.url ?? '/' });
}

function serve(request: http.IncomingMessage, response: http.ServerResponse): void {
  record(request);
  const url = request.url ?? '/';
  if (url === '/slow-headers') { holds.add(response); later(700, () => { holds.delete(response); if (!response.destroyed) { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('late'); } }); return; }
  if (url === '/dripping-body') {
    // Five chunks 80ms apart, then a 700ms stall: the body budget must restart on every chunk.
    response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '24' });
    holds.add(response);
    for (let chunk = 0; chunk < 5; chunk += 1) later(80 * chunk, () => { if (!response.destroyed) response.write('drip'); });
    later(320 + 700, () => { holds.delete(response); if (!response.destroyed) response.end('end!'); });
    return;
  }
  // writeHead only records the headers: flushHeaders puts them on the wire without any body byte.
  if (url === '/never-starting-body') { response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '8' }); response.flushHeaders(); holds.add(response); later(700, () => { holds.delete(response); if (!response.destroyed) response.end('too late'); }); return; }
  if (url === '/redirect-to-slow-headers') { response.writeHead(302, { location: '/slow-headers' }); response.end(); return; }
  if (url === '/flaky') {
    const hits = seen.filter((wire) => wire.url === '/flaky').length;
    later(180, () => { if (response.destroyed) return; if (hits === 1) { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('busy'); } else { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok'); } });
    return;
  }
  if (url === '/slow-download') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '12' });
    response.write('head');
    holds.add(response);
    later(300, () => { if (!response.destroyed) response.write('body'); });
    later(600, () => { holds.delete(response); if (!response.destroyed) response.end('tail'); });
    return;
  }
  if (url === '/dripping-download') {
    // Six chunks 70ms apart and then the end: no gap reaches a 120ms body budget.
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '24' });
    holds.add(response);
    for (let chunk = 0; chunk < 6; chunk += 1) later(70 * chunk, () => { if (!response.destroyed) response.write('drip'); });
    later(70 * 6, () => { holds.delete(response); if (!response.destroyed) response.end(); });
    return;
  }
  if (url === '/stalled-download') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '12' });
    response.write('head');
    holds.add(response);
    later(700, () => { holds.delete(response); if (!response.destroyed) response.end('tailtail'); });
    return;
  }
  if (url === '/set-hostonly-cookie') { response.writeHead(302, { location: `${localhostUrl}/dest`, 'set-cookie': 'hop=1; Path=/' }); response.end(); return; }
  if (url === '/dest') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('dest'); return; }
  response.writeHead(404); response.end();
}

/** A raw responder: `100 Continue`, then the real `200` once the declared body arrived. */
function serveExpectContinue(socket: net.Socket): void {
  let buffered = Buffer.alloc(0);
  let headersEnded = false;
  let bodyLength = 0;
  let bodyReceived = 0;
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    if (!headersEnded) {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      headersEnded = true;
      const head = buffered.subarray(0, end).toString('latin1');
      bodyLength = Number(/content-length:\s*(\d+)/iu.exec(head)?.[1] ?? '0');
      bodyReceived = buffered.length - end - 4;
      socket.write('HTTP/1.1 100 Continue\r\n\r\n');
    } else {
      bodyReceived += chunk.length;
    }
    if (headersEnded && bodyReceived >= bodyLength) {
      socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
    }
  });
}

beforeAll(async () => {
  await ensureFilesystemAccess();
  server = http.createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  localhostServer = http.createServer(serve);
  await new Promise<void>((resolve) => localhostServer.listen(0, () => resolve()));
  localhostUrl = `http://localhost:${(localhostServer.address() as AddressInfo).port}`;
  rawServer = net.createServer(serveExpectContinue);
  await new Promise<void>((resolve) => rawServer.listen(0, '127.0.0.1', () => resolve()));
  rawBaseUrl = `http://127.0.0.1:${(rawServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const t of pending) clearTimeout(t);
  for (const response of holds) response.destroy();
  for (const active of [server, localhostServer]) { active.closeAllConnections?.(); await new Promise<void>((resolve) => active.close(() => resolve())); }
  await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  restoreRequireBridge?.();
});

const field = (value: unknown, name: string): unknown => Reflect.get(Object(value), name);
const client = (): Rezo => new Rezo({}, curlAdapter as never);
const settle = async <T,>(promise: Promise<T>): Promise<{ value: T | null; error: unknown; ms: number }> => {
  const started = performance.now();
  try { return { value: await promise, error: null, ms: performance.now() - started }; }
  catch (error) { return { value: null, error, ms: performance.now() - started }; }
};
const MESSAGES = {
  headers: (elapsed: number) => `Headers timeout: Server did not send response headers within ${elapsed}ms`,
  body: (elapsed: number) => `Body timeout: Response body transfer stalled for ${elapsed}ms`,
  total: (elapsed: number) => `Total timeout: Request exceeded maximum duration of ${elapsed}ms`,
};
function expectStaged(outcome: { value: unknown; error: unknown }, code: string, phase: 'headers' | 'body' | 'total', budget: number): number {
  expect(outcome.value).toBeNull();
  expect(field(outcome.error, 'name')).toBe('RezoError');
  expect(field(outcome.error, 'code')).toBe(code);
  expect(field(outcome.error, 'phase')).toBe(phase);
  expect(field(outcome.error, 'isTimeout')).toBe(true);
  const elapsed = field(outcome.error, 'elapsed') as number;
  expect(Number.isInteger(elapsed)).toBe(true);
  expect(elapsed).toBeGreaterThanOrEqual(budget);
  expect(field(outcome.error, 'message')).toBe(MESSAGES[phase](elapsed));
  return elapsed;
}
const stageFiles = (directory: string): string[] => readdirSync(directory).filter((name) => name.includes('.rezo-partial-'));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
interface Terminals { completes: number; dones: number; ends: number; errors: unknown[]; finishes: number }
/** Collects every public terminal of a facade and settles a window after the first one, so a late duplicate is observed. */
function collectTerminals(facade: { on(event: string, listener: (...args: unknown[]) => void): unknown }, windowMs: number): Promise<Terminals> {
  return new Promise((resolve) => {
    const seen: Terminals = { completes: 0, dones: 0, ends: 0, errors: [], finishes: 0 };
    let armed = false;
    const settleSoon = (): void => { if (armed) return; armed = true; setTimeout(() => resolve(seen), windowMs); };
    facade.on('error', (error) => { seen.errors.push(error); settleSoon(); });
    facade.on('finish', () => { seen.finishes += 1; settleSoon(); });
    facade.on('end', () => { seen.ends += 1; settleSoon(); });
    facade.on('done', () => { seen.dones += 1; settleSoon(); });
    facade.on('complete', () => { seen.completes += 1; settleSoon(); });
  });
}
/** The facade's own finished flag (a method on the public responses). */
const finished = (facade: unknown): boolean => { const flag = field(facade, 'isFinished'); return typeof flag === 'function' ? Boolean(Reflect.apply(flag, facade, [])) : Boolean(flag); };
/** No success terminal of any kind, and the facade never reports itself finished. */
function expectNoSuccessTerminal(seen: Terminals, facade: unknown): void {
  expect({ completes: seen.completes, dones: seen.dones, ends: seen.ends, finishes: seen.finishes, isFinished: finished(facade) }).toEqual({ completes: 0, dones: 0, ends: 0, finishes: 0, isFinished: false });
}
async function waitForStage(directory: string): Promise<void> {
  const deadline = performance.now() + 250;
  while (performance.now() < deadline && stageFiles(directory).length === 0) await delay(10);
  expect(stageFiles(directory).length).toBe(1);
}

it('CLO-01 the headers budget fails the headers phase with ESOCKETTIMEDOUT and one response-type onTimeout', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(client().get(`${baseUrl}/slow-headers`, {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    retry: false,
    timeout: { headers: 120, total: 2000 },
  } as never));
  const elapsed = expectStaged(outcome, 'ESOCKETTIMEDOUT', 'headers', 120);
  expect(elapsed).toBeLessThan(400);
  expect(outcome.ms).toBeLessThan(600);
  expect(timeoutTypes).toEqual(['response']);
});

it('CLO-02 the body budget is a stall budget: a dripping body survives every chunk and fails only once it stalls', async () => {
  const timeoutTypes: string[] = [];
  let loaded = 0;
  const outcome = await settle(client().get(`${baseUrl}/dripping-body`, {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    onDownloadProgress: (event: { loaded: number }) => { loaded = Math.max(loaded, event.loaded); },
    retry: false,
    timeout: { body: 120, total: 2000 },
  } as never));
  const elapsed = expectStaged(outcome, 'ESOCKETTIMEDOUT', 'body', 120);
  expect(elapsed).toBeLessThan(300);
  // All five chunks (20 bytes, the last at ~320ms) arrived before the stall expired the budget.
  expect(loaded).toBe(20);
  expect(outcome.ms).toBeGreaterThan(420);
  expect(outcome.ms).toBeLessThan(800);
  expect(timeoutTypes).toEqual(['response']);
});

it('CLO-02B the body budget fails a body that never starts after the headers arrived', async () => {
  const timeoutTypes: string[] = [];
  const outcome = await settle(client().get(`${baseUrl}/never-starting-body`, {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    retry: false,
    timeout: { body: 120, total: 2000 },
  } as never));
  const elapsed = expectStaged(outcome, 'ESOCKETTIMEDOUT', 'body', 120);
  expect(elapsed).toBeLessThan(300);
  expect(outcome.ms).toBeLessThan(400);
  expect(timeoutTypes).toEqual(['response']);
});

it('CLO-03 the headers budget restarts on every hop: a fast redirect to slow headers still fails the headers phase', async () => {
  seen.length = 0;
  const outcome = await settle(client().get(`${baseUrl}/redirect-to-slow-headers`, { retry: false, timeout: { headers: 250, total: 3000 } } as never));
  const elapsed = expectStaged(outcome, 'ESOCKETTIMEDOUT', 'headers', 250);
  expect(elapsed).toBeLessThan(600);
  expect(seen.filter((wire) => wire.url === '/slow-headers').length).toBe(1);
});

it('CLO-04 one total budget spans the first attempt, the retry delay and the retry, and expires inside the delay', async () => {
  const timeoutTypes: string[] = [];
  seen.length = 0;
  const outcome = await settle(client().get(`${baseUrl}/flaky`, {
    hooks: { onTimeout: [(info) => { timeoutTypes.push(String((info as { type?: string }).type)); }] },
    retry: { maxRetries: 1, retryDelay: 250, retryOn: [503] },
    timeout: 300,
  } as never));
  const elapsed = expectStaged(outcome, 'ECONNABORTED', 'total', 300);
  // The deadline fires inside the 250ms delay (at ~300ms), never after it (~430ms).
  expect(elapsed).toBeLessThan(380);
  expect(outcome.ms).toBeLessThan(400);
  expect(timeoutTypes).toEqual(['request']);
  expect(seen.filter((wire) => wire.url === '/flaky').length).toBe(1);
});

it('CLO-05 a stage file that disappears mid-transfer is a typed download failure, never a finished download', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-clo-stage-'));
  const target = path.join(directory, 'download.bin');
  try {
    const download = client().download(`${baseUrl}/slow-download`, target);
    const settled = new Promise<{ error: unknown; finished: boolean }>((resolve) => {
      download.on('error', (error: unknown) => resolve({ error, finished: false }));
      download.on('finish', () => resolve({ error: null, finished: true }));
    });
    const removalDeadline = performance.now() + 250;
    let removed: string | null = null;
    while (performance.now() < removalDeadline) {
      const [stage] = stageFiles(directory);
      if (stage) { rmSync(path.join(directory, stage), { force: true }); removed = stage; break; }
      await delay(10);
    }
    expect(removed).not.toBeNull();
    const result = await settled;
    expect(result.finished).toBe(false);
    expect(field(result.error, 'name')).toBe('RezoError');
    expect(field(result.error, 'code')).toBe('REZ_DOWNLOAD_FAILED');
    expect(existsSync(target)).toBe(false);
    expect(stageFiles(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('CLO-06 download abort: the stage is gone before onAbort and before the single public error, and no second terminal follows', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-clo-abort-'));
  const target = path.join(directory, 'download.bin');
  try {
    const controller = new AbortController();
    let stageAtHook: string[] | undefined;
    let stageAtError: string[] | undefined;
    let targetAtError: boolean | undefined;
    const download = client().download(`${baseUrl}/slow-download`, target, {
      hooks: { onAbort: [() => { stageAtHook = stageFiles(directory); }] },
      signal: controller.signal,
    } as never);
    download.on('error', () => { if (stageAtError === undefined) { stageAtError = stageFiles(directory); targetAtError = existsSync(target); } });
    const terminals = collectTerminals(download, 250);
    await waitForStage(directory);
    controller.abort();
    const seen = await terminals;
    expect(seen.errors.map((error) => field(error, 'code'))).toEqual(['ABORT_ERR']);
    expectNoSuccessTerminal(seen, download);
    expect(stageAtHook).toEqual([]);
    expect(stageAtError).toEqual([]);
    expect(targetAtError).toBe(false);
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('CLO-09 download total timeout: the stage is gone before onTimeout and before the single public error, and no second terminal follows', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-clo-timeout-'));
  const target = path.join(directory, 'download.bin');
  try {
    let stageAtHook: string[] | undefined;
    let stageAtError: string[] | undefined;
    const download = client().download(`${baseUrl}/slow-download`, target, {
      hooks: { onTimeout: [() => { stageAtHook = stageFiles(directory); }] },
      retry: false,
      timeout: 120,
    } as never);
    download.on('error', () => { if (stageAtError === undefined) stageAtError = stageFiles(directory); });
    const seen = await collectTerminals(download, 250);
    expect(seen.errors.map((error) => [field(error, 'code'), field(error, 'phase')])).toEqual([['ECONNABORTED', 'total']]);
    expectNoSuccessTerminal(seen, download);
    expect(stageAtHook).toEqual([]);
    expect(stageAtError).toEqual([]);
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('CLO-10 stream abort publishes exactly one public error and no success terminal', async () => {
  const controller = new AbortController();
  const stream = client().stream(`${baseUrl}/slow-headers`, { retry: false, signal: controller.signal } as never);
  const terminals = collectTerminals(stream, 250);
  setTimeout(() => controller.abort(), 60);
  const seen = await terminals;
  expect(seen.errors.map((error) => field(error, 'code'))).toEqual(['ABORT_ERR']);
  expectNoSuccessTerminal(seen, stream);
});

it('CLO-11 stream total timeout publishes exactly one public error and no success terminal', async () => {
  const stream = client().stream(`${baseUrl}/slow-headers`, { retry: false, timeout: 120 } as never);
  const seen = await collectTerminals(stream, 250);
  expect(seen.errors.map((error) => [field(error, 'code'), field(error, 'phase')])).toEqual([['ECONNABORTED', 'total']]);
  expectNoSuccessTerminal(seen, stream);
});

it('CLO-12 upload abort publishes exactly one public error and no success terminal', async () => {
  const controller = new AbortController();
  const upload = client().upload(`${baseUrl}/slow-headers`, 'payload', { retry: false, signal: controller.signal } as never);
  const terminals = collectTerminals(upload, 250);
  setTimeout(() => controller.abort(), 60);
  const seen = await terminals;
  expect(seen.errors.map((error) => field(error, 'code'))).toEqual(['ABORT_ERR']);
  expectNoSuccessTerminal(seen, upload);
});

it('CLO-13 upload total timeout publishes exactly one public error and no success terminal', async () => {
  const upload = client().upload(`${baseUrl}/slow-headers`, 'payload', { retry: false, timeout: 120 } as never);
  const seen = await collectTerminals(upload, 250);
  expect(seen.errors.map((error) => [field(error, 'code'), field(error, 'phase')])).toEqual([['ECONNABORTED', 'total']]);
  expectNoSuccessTerminal(seen, upload);
});

it('CLO-14 download body budget is a stall budget: a dripping download finishes whole, with progress from the stage growth', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-clo-drip-'));
  const target = path.join(directory, 'download.bin');
  try {
    let loaded = 0;
    let progressEvents = 0;
    const download = client().download(`${baseUrl}/dripping-download`, target, {
      onDownloadProgress: (event: { loaded: number }) => { progressEvents += 1; loaded = Math.max(loaded, event.loaded); },
      retry: false,
      timeout: { body: 120, total: 2000 },
    } as never);
    const seen = await collectTerminals(download, 150);
    expect(seen.errors).toEqual([]);
    expect(seen.finishes).toBe(1);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).length).toBe(24);
    expect(progressEvents).toBeGreaterThanOrEqual(2);
    expect(loaded).toBe(24);
    expect(stageFiles(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('CLO-15 download body budget fails a stalled download once, with the stage gone before onTimeout and before the error', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rezo-clo-stall-'));
  const target = path.join(directory, 'download.bin');
  try {
    let stageAtHook: string[] | undefined;
    const download = client().download(`${baseUrl}/stalled-download`, target, {
      hooks: { onTimeout: [() => { stageAtHook = stageFiles(directory); }] },
      retry: false,
      timeout: { body: 120, total: 2000 },
    } as never);
    const seen = await collectTerminals(download, 250);
    expect(seen.errors.map((error) => [field(error, 'code'), field(error, 'phase')])).toEqual([['ESOCKETTIMEDOUT', 'body']]);
    expect(field(seen.errors[0], 'elapsed')).toBeGreaterThanOrEqual(120);
    expectNoSuccessTerminal(seen, download);
    expect(stageAtHook).toEqual([]);
    expect(existsSync(target)).toBe(false);
    expect(stageFiles(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('CLO-07 an informational 100 Continue is never a redirect hop', async () => {
  const outcome = await settle(client().post(`${rawBaseUrl}/upload`, 'payload', { headers: { expect: '100-continue' }, responseType: 'text', retry: false } as never));
  expect(outcome.error).toBeNull();
  expect(field(outcome.value, 'status')).toBe(200);
  expect(field(outcome.value, 'data')).toBe('ok');
  expect(field(outcome.value, 'urls')).toEqual([`${rawBaseUrl}/upload`]);
  const config = field(outcome.value, 'config');
  expect((field(config, 'redirectHistory') as unknown[] | undefined) ?? []).toEqual([]);
  expect(field(config, 'redirectCount') ?? 0).toBe(0);
});

it('CLO-08 a host-only cookie set by a redirect hop is stored against that hop, not the destination host', async () => {
  const jarClient = client();
  seen.length = 0;
  const followed = await settle(jarClient.get(`${baseUrl}/set-hostonly-cookie`, { responseType: 'text', retry: false } as never));
  expect(followed.error).toBeNull();
  expect(field(followed.value, 'data')).toBe('dest');
  const crossHost = await settle(jarClient.get(`${localhostUrl}/dest`, { responseType: 'text', retry: false } as never));
  expect(crossHost.error).toBeNull();
  const sameHost = await settle(jarClient.get(`${baseUrl}/dest`, { responseType: 'text', retry: false } as never));
  expect(sameHost.error).toBeNull();
  const destinations = seen.filter((wire) => wire.url === '/dest').map((wire) => ({ cookie: wire.cookie, host: wire.host?.split(':')[0] ?? null }));
  expect(destinations).toEqual([
    { cookie: null, host: 'localhost' },
    { cookie: null, host: 'localhost' },
    { cookie: 'hop=1', host: '127.0.0.1' },
  ]);
});
