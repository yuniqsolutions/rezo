/**
 * Row harness for the cURL facade contract: runs one facade (stream / download / upload) or one buffered request through an
 * adapter, with every listener attached synchronously before the first byte, settles on the facade's own terminal (never a
 * fixed sleep), keeps a bounded watchdog that records `unsettled` and tears the request down through a test-owned signal,
 * and reports an outcome the rows compare field by field against the HTTP/1.1 adapter measured on the same wire.
 * Runtime-agnostic: no test-framework imports, so the vitest/bun driver and the Deno driver share the rows verbatim.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { Rezo } from '../../../src/core/rezo.ts';
import { executeRequest as curlAdapter } from '../../../src/adapters/curl.ts';
import { executeRequest as http1Adapter } from '../../../src/adapters/http.ts';
import type { FixtureServer } from './fixture-server.ts';

export class InfrastructureError extends Error { constructor(message: string) { super(message); this.name = 'InfrastructureError'; } }
export type Adapter = typeof http1Adapter;
export const ADAPTERS = { http1: http1Adapter, curl: curlAdapter } as const;
export type AdapterName = keyof typeof ADAPTERS;
export const RUNTIME: 'node' | 'bun' | 'deno' = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined' ? 'deno' : 'node';
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** Throws with a readable diff; the drivers surface it as the row failure. */
export function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
}
export function check(condition: boolean, label: string): void { if (!condition) throw new Error(label); }

export const WATCHDOG_MS = 5000;
export interface FacadeOutcome {
  /** Event names in emission order; header-time events carry the status, errors their code. `data` is counted, not listed. */
  events: string[];
  dataBytes: number;
  dataSha256: string;
  finished: boolean;
  hits: number;
  error: { code: string | null; message: string; status: number | null; hasResponse: boolean; causeIsThrown: boolean; causeMessage: string | null; causeErrorCount: number | null } | null;
  redirects: Array<{ sourceUrl: string; destinationUrl: string; redirectCount: number }>;
  hooks: string[];
  finish: { contentLength: number | null; fileSize: number | null; status: number | null } | null;
  unsettled: boolean;
  lateEvents: string[];
}
export interface FacadeRun {
  kind: 'stream' | 'download' | 'upload';
  adapter: AdapterName;
  url: string;
  instance?: Record<string, unknown>;
  request?: Record<string, unknown>;
  file?: string;
  uploadBody?: string;
  /** A value a throwing validator threw, to prove `cause` identity. */
  thrown?: unknown;
  /** Called once listeners are attached, before settlement (e.g. to release a held response or chmod a directory). */
  during?: (context: { stageObserved: () => Promise<string> }) => Promise<void>;
  targetDirectory?: string;
}

const TERMINAL: Record<FacadeRun['kind'], string[]> = { stream: ['close', 'error'], download: ['complete', 'error'], upload: ['complete', 'error'] };

/** Runs one facade to its terminal and reports what it published. */
export async function runFacade(fixture: FixtureServer, run: FacadeRun): Promise<FacadeOutcome> {
  const controller = new AbortController();
  const request = { ...(run.request ?? {}), signal: (run.request as { signal?: AbortSignal } | undefined)?.signal ?? controller.signal };
  const hitsBefore = fixture.hits();
  const outcome: FacadeOutcome = { events: [], dataBytes: 0, dataSha256: '', finished: false, hits: 0, error: null, redirects: [], hooks: [], finish: null, unsettled: false, lateEvents: [] };
  const dataHash = createHash('sha256');
  let settled = false;
  const hooks = {
    afterHeaders: [() => { outcome.hooks.push('afterHeaders'); }],
    ...((run.instance as { hooks?: Record<string, unknown[]> } | undefined)?.hooks ?? {}),
  };
  const instance = new Rezo({ retry: false, timeout: 8000, ...(run.instance ?? {}), hooks } as never, ADAPTERS[run.adapter]);
  const facade: any = run.kind === 'stream' ? instance.stream(run.url, request as never)
    : run.kind === 'download' ? instance.download(run.url, run.file as string, request as never)
    : instance.upload(run.url, run.uploadBody ?? 'CFC-UPLOAD', request as never);
  const terminal = new Promise<void>((resolve) => {
    const record = (name: string, payload: unknown): void => {
      if (settled) { outcome.lateEvents.push(name); return; }
      if (name === 'data') { const chunk = payload as Buffer; outcome.dataBytes += chunk.length; dataHash.update(chunk); return; }
      if (name === 'headers' || name === 'status') { outcome.events.push(`${name}:${(payload as { status?: number })?.status ?? payload}`); }
      else if (name === 'error') {
        const error = payload as { code?: string; message?: string; response?: { status?: number }; cause?: unknown };
        const cause = error?.cause as { message?: string; errors?: unknown[] } | undefined;
        outcome.error = { code: error?.code ?? null, message: String(error?.message ?? ''), status: error?.response?.status ?? null, hasResponse: error?.response !== undefined, causeIsThrown: run.thrown !== undefined && error?.cause === run.thrown, causeMessage: typeof cause?.message === 'string' ? cause.message : null, causeErrorCount: Array.isArray(cause?.errors) ? cause.errors.length : null };
        outcome.events.push(`error:${error?.code ?? 'no-code'}`);
      } else if (name === 'redirect') {
        const event = payload as { sourceUrl?: string; destinationUrl?: string; redirectCount?: number };
        outcome.redirects.push({ sourceUrl: event?.sourceUrl ?? '', destinationUrl: event?.destinationUrl ?? '', redirectCount: event?.redirectCount ?? -1 });
        outcome.hooks.push('redirect');
        outcome.events.push('redirect');
      } else {
        if (name === 'finish') { const event = payload as { contentLength?: number; fileSize?: number; status?: number; response?: { status?: number } }; outcome.finish = { contentLength: event?.contentLength ?? null, fileSize: event?.fileSize ?? null, status: event?.status ?? event?.response?.status ?? null }; }
        outcome.events.push(name);
      }
      if (TERMINAL[run.kind].includes(name)) { settled = true; resolve(); }
    };
    for (const name of ['headers', 'status', 'cookies', 'redirect', 'data', 'end', 'finish', 'done', 'complete', 'close', 'error']) facade.on(name, (payload: unknown) => record(name, payload));
  });
  let stageResolve: ((path: string) => void) | undefined;
  const stageObserved = new Promise<string>((resolve) => { stageResolve = resolve; });
  let stagePoll: ReturnType<typeof setInterval> | undefined;
  if (run.targetDirectory && run.file) {
    const prefix = `${run.file}.rezo-partial-`;
    const { readdirSync } = await import('node:fs');
    const { dirname, basename, join } = await import('node:path');
    stagePoll = setInterval(() => {
      try { for (const entry of readdirSync(dirname(run.file as string))) { const full = join(dirname(run.file as string), entry); if (full.startsWith(prefix) || basename(full).startsWith(`${basename(run.file as string)}.rezo-partial-`)) { stageResolve?.(full); clearInterval(stagePoll); } } } catch { /* directory may be unreadable while a row holds it */ }
    }, 5);
  }
  const duringTask = run.during ? run.during({ stageObserved: () => stageObserved }) : Promise.resolve();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { watchdog = setTimeout(resolve, WATCHDOG_MS); });
  await Promise.race([terminal, expired]);
  if (!settled) {
    outcome.unsettled = true;
    controller.abort();
    await Promise.race([terminal, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    settled = true;
  }
  clearTimeout(watchdog);
  clearInterval(stagePoll);
  await duringTask.catch(() => undefined);
  // A settled facade must stay silent: give the runtime two turns of the event loop and one timer tick.
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
  outcome.finished = typeof facade.isFinished === 'function' ? facade.isFinished() : false;
  outcome.hits = fixture.hits() - hitsBefore;
  outcome.dataSha256 = outcome.dataBytes > 0 ? dataHash.digest('hex') : '';
  return outcome;
}

export interface BufferedOutcome { code: string | null; phase: string | null; elapsedMs: number; hits: number; hooks: string[]; fulfilled: boolean; status: number | null }
export interface BufferedRun { adapter: AdapterName; url: string; instance?: Record<string, unknown>; request?: Record<string, unknown>; abortAfterMs?: number }
/** Runs one buffered GET (the wait-cancellation rows) and reports the settlement code, timeout phase and timing. */
export async function runBuffered(fixture: FixtureServer, run: BufferedRun): Promise<BufferedOutcome> {
  const hooks: string[] = [];
  const controller = new AbortController();
  const rezo = new Rezo({ timeout: 10_000, ...(run.instance ?? {}), hooks: { onTimeout: [() => { hooks.push('onTimeout'); }], onAbort: [() => { hooks.push('onAbort'); }], ...((run.instance as { hooks?: Record<string, unknown[]> } | undefined)?.hooks ?? {}) } } as never, ADAPTERS[run.adapter]);
  const hitsBefore = fixture.hits();
  const started = performance.now();
  const timer = run.abortAfterMs !== undefined ? setTimeout(() => controller.abort(), run.abortAfterMs) : undefined;
  const watchdog = new Promise<'unsettled'>((resolve) => setTimeout(() => resolve('unsettled'), WATCHDOG_MS));
  const settle = rezo.get(run.url, { ...(run.request ?? {}), signal: controller.signal } as never).then((response) => ({ fulfilled: true, status: (response as { status: number }).status, code: null as string | null, phase: null as string | null }), (error) => ({ fulfilled: false, status: null, code: (error as { code?: string })?.code ?? null, phase: (error as { phase?: string })?.phase ?? null }));
  const result = await Promise.race([settle, watchdog]);
  clearTimeout(timer);
  if (result === 'unsettled') {
    controller.abort();
    await Promise.race([settle, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    return { code: 'unsettled', phase: null, elapsedMs: performance.now() - started, hits: fixture.hits() - hitsBefore, hooks, fulfilled: false, status: null };
  }
  return { ...result, elapsedMs: performance.now() - started, hits: fixture.hits() - hitsBefore, hooks };
}

/** Live or not-yet-reaped `curl` children of this process (any runtime): the externally observable child census. `ps` prints an unreaped child as `(curl)` with state `Z`; both count. */
export function liveCurlChildren(): Array<{ pid: number; state: string; command: string }> {
  const me = typeof (globalThis as { Deno?: { pid: number } }).Deno !== 'undefined' ? (globalThis as unknown as { Deno: { pid: number } }).Deno.pid : process.pid;
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,stat=,comm='], { encoding: 'utf8' });
  const children: Array<{ pid: number; state: string; command: string }> = [];
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (match && Number(match[2]) === me && /\(?curl\)?$/u.test(match[4])) children.push({ pid: Number(match[1]), state: match[3], command: match[4] });
  }
  return children;
}
export const fileState = (path: string): { exists: boolean; size: number | null; sha256: string | null } => existsSync(path) ? { exists: true, size: statSync(path).size, sha256: sha256(readFileSync(path)) } : { exists: false, size: null, sha256: null };
export function requireCurl(): { path: string; version: string } {
  try {
    const path = execFileSync('/usr/bin/which', ['curl'], { encoding: 'utf8' }).trim();
    const version = execFileSync(path, ['--version'], { encoding: 'utf8' }).split('\n')[0];
    return { path, version };
  } catch (error) { throw new InfrastructureError(`curl is not usable on PATH: ${(error as Error).message}`); }
}
