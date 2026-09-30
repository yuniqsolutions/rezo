import { afterAll, beforeAll, expect, it } from 'vitest';
import { build, type BuildOptions, type Message as EsbuildMessage, type Plugin } from 'esbuild';
import puppeteer, { type Browser, type ConsoleMessage } from 'puppeteer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

// R16 carrier: Fetch adapter browser/worker entry proof. The universal Fetch
// adapter (src/adapters/fetch.ts) is published for browsers and workers through
// src/adapters/entries/fetch.ts. Two fail-closed controls over that entry:
//   A. BUNDLE CONTROL — esbuild bundles the entry for the browser, and again
//      under the `worker` condition, while a resolve plugin rejects every Node
//      builtin (`node:*` and the bare names). The metafile must carry the
//      adapter and the entry, never a `node:` input and never the HTTP/1.1
//      download-target transaction.
//   B. BINARY-SHAPE CONTROL — the browser bundle runs in a real headless Chrome
//      against a local fixture server. `responseType: 'buffer'` must deliver a
//      24-byte ArrayBuffer (the adapter hands the raw ArrayBuffer out whenever
//      Environment.isNode is false) and `stream()` must emit Uint8Array chunks
//      and the `done` terminal without an error. RED on pristine bytes is the
//      expected state for the stream row: handleStreamingResponse wraps every
//      chunk in Buffer.from, which does not exist in a browser.
//   C. AUTHENTICITY PINS — the adapter and the entry source bytes are hashed at
//      load and compared to the two pinned constants below.
//   D. LEDGER — afterAll prints exactly one REZO_R16_BROWSER_LEDGER_V1 line.
// URL form: the core resolves request URLs with `new URL(url, baseURL)`
// (src/utils/http-config.ts); the browser platform entry supplies the page
// location as the default base (2026-08-29, R16-R4), so the relative '/body'
// form resolves in Chrome — row B3 asserts it. The shape rows keep the
// page-origin absolute URL so they measure the binary shape alone.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FETCH_ADAPTER_SOURCE = 'src/adapters/fetch.ts';
const FETCH_ENTRY_SOURCE = 'src/adapters/entries/fetch.ts';
// Re-pin by editing exactly these two lines after an approved change to the adapter or the entry.
const PINNED_FETCH_ADAPTER_SHA256 = '3aefd6bdd263e90f81ad06a7ca725c30f8c04b6ddceeea2160eb2ccda46dc5c5';
const PINNED_FETCH_ENTRY_SHA256 = '723bc636e4e6dcbce37909cd317eb02ec5c4e2be4fae8a1c0da02f0660e77c9b';
// The carrier's own identity and the runner envelope travel in the ledger; every identity is re-hashed at closing.
const CARRIER_PATH = fileURLToPath(import.meta.url);
const carrierSha256Now = (): string => createHash('sha256').update(readFileSync(CARRIER_PATH)).digest('hex');
const CARRIER_SHA256 = carrierSha256Now();

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`R16 browser-entry infrastructure invalidity: ${message}`);
    this.name = 'InfrastructureError';
  }
}

function sourceSha256(relativePath: string): string {
  return createHash('sha256').update(readFileSync(join(REPO_ROOT, relativePath))).digest('hex');
}

const AUTHENTICITY = Object.freeze({
  fetchAdapterSha256: sourceSha256(FETCH_ADAPTER_SOURCE),
  fetchEntrySha256: sourceSha256(FETCH_ENTRY_SOURCE),
});
if (AUTHENTICITY.fetchAdapterSha256 !== PINNED_FETCH_ADAPTER_SHA256) {
  throw new InfrastructureError(`fetch adapter bytes: actual ${AUTHENTICITY.fetchAdapterSha256} expected ${PINNED_FETCH_ADAPTER_SHA256}`);
}
if (AUTHENTICITY.fetchEntrySha256 !== PINNED_FETCH_ENTRY_SHA256) {
  throw new InfrastructureError(`fetch entry bytes: actual ${AUTHENTICITY.fetchEntrySha256} expected ${PINNED_FETCH_ENTRY_SHA256}`);
}

// ------------------------------------------------------------- fixtures --
const FIXTURE_BODY_TEXT = 'parity-exact-body-bytes!';
const FIXTURE_BODY_LENGTH = 24;
const FIXTURE_BODY = Buffer.from(FIXTURE_BODY_TEXT, 'utf8');
if (FIXTURE_BODY.length !== FIXTURE_BODY_LENGTH) {
  throw new InfrastructureError(`fixture body is ${FIXTURE_BODY.length} bytes, expected ${FIXTURE_BODY_LENGTH}`);
}
const FIXTURE_BODY_PATH = '/body';
const FIXTURE_BUNDLE_PATH = '/bundle.js';
const FIXTURE_PAGE_PATH = '/index.html';
const FIXTURE_PAGE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>rezo r16 browser entry</title>'
  + '<link rel="icon" href="data:,"></head><body>rezo r16 browser entry</body></html>';
const STREAM_SETTLE_TIMEOUT_MS = 5_000;
const STAGE_TIMEOUT_MS = 20_000;
const FALLBACK_CHROME_EXECUTABLE = join(
  homedir(),
  '.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const TEST_NAMES = Object.freeze({
  browserBundle: 'A1 browser bundle: src/adapters/entries/fetch.ts bundles for the browser with zero Node builtins and no download-target transaction',
  workerBundle: 'A2 worker bundle: src/adapters/entries/fetch.ts bundles under the worker condition with zero Node builtins and no download-target transaction',
  bufferedShape: 'B1 buffered shape: responseType buffer delivers a 24-byte ArrayBuffer in headless Chrome',
  streamShape: 'B2 stream shape: stream data chunks are Uint8Array, done emitted, no error, no page errors in headless Chrome',
  relativeUrl: 'B3 relative URL: the browser entry resolves a relative request URL against the page location (status 200 in headless Chrome)',
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

// ------------------------------------------------------- bundle control --
type BundleVariant = 'browser' | 'worker';

// The EXHAUSTIVE builtin set of the running Node (node:module builtinModules, bare and node:-prefixed),
// never a hand-written list (tayo seq 61620: punycode, string_decoder, … must be rejected too).
const NODE_BUILTIN_SPECIFIERS: ReadonlySet<string> = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
if (NODE_BUILTIN_SPECIFIERS.size < 80 || !NODE_BUILTIN_SPECIFIERS.has('punycode') || !NODE_BUILTIN_SPECIFIERS.has('string_decoder')) throw new Error(`builtin set implausible: ${NODE_BUILTIN_SPECIFIERS.size}`);

function isNodeBuiltinSpecifier(specifier: string): boolean {
  return /^node:/.test(specifier) || NODE_BUILTIN_SPECIFIERS.has(specifier);
}

interface RejectedResolve {
  readonly importer: string;
  readonly path: string;
}

interface BundleObservation {
  readonly variant: BundleVariant;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly rejected: readonly RejectedResolve[];
  /** Sorted metafile input keys, relative to the repository root. */
  readonly inputs: readonly string[];
  readonly bytes: number;
  readonly text: string;
}

function formatEsbuildMessage(message: EsbuildMessage): string {
  const location = message.location;
  return location ? `${message.text} (${location.file}:${location.line}:${location.column})` : message.text;
}

function isBuildFailure(value: unknown): value is { errors: EsbuildMessage[]; warnings: EsbuildMessage[] } {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { errors?: unknown; warnings?: unknown };
  return Array.isArray(candidate.errors) && Array.isArray(candidate.warnings);
}

function sortRejected(rejected: readonly RejectedResolve[]): RejectedResolve[] {
  return [...rejected].sort((left, right) => compareStrings(`${left.importer} -> ${left.path}`, `${right.importer} -> ${right.path}`));
}

function createNodeBuiltinRejectionPlugin(rejected: RejectedResolve[]): Plugin {
  return {
    name: 'rezo-r16-reject-node-builtins',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        if (!isNodeBuiltinSpecifier(args.path)) return null;
        rejected.push({ importer: args.importer, path: args.path });
        return { errors: [{ text: `Node builtin "${args.path}" requested by ${args.importer || '<entry>'}` }] };
      });
    },
  };
}

async function bundleFetchEntry(variant: BundleVariant): Promise<BundleObservation> {
  const rejected: RejectedResolve[] = [];
  const options: BuildOptions = {
    entryPoints: [join(REPO_ROOT, FETCH_ENTRY_SOURCE)],
    absWorkingDir: REPO_ROOT,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    logLevel: 'silent',
    target: 'es2022',
    plugins: [createNodeBuiltinRejectionPlugin(rejected)],
  };
  if (variant === 'worker') options.conditions = ['worker'];
  try {
    const result = await build(options);
    const metafile = result.metafile;
    const outputFiles = result.outputFiles;
    if (metafile === undefined || outputFiles === undefined) {
      throw new InfrastructureError(`${variant} bundle produced no metafile or output files`);
    }
    if (outputFiles.length !== 1) {
      throw new InfrastructureError(`${variant} bundle produced ${outputFiles.length} output files, expected 1`);
    }
    const output = outputFiles[0];
    return {
      variant,
      errors: result.errors.map(formatEsbuildMessage),
      warnings: result.warnings.map(formatEsbuildMessage),
      rejected: sortRejected(rejected),
      inputs: Object.keys(metafile.inputs).sort(compareStrings),
      bytes: output.contents.byteLength,
      text: output.text,
    };
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    if (isBuildFailure(error)) {
      return {
        variant,
        errors: error.errors.map(formatEsbuildMessage),
        warnings: error.warnings.map(formatEsbuildMessage),
        rejected: sortRejected(rejected),
        inputs: [],
        bytes: 0,
        text: '',
      };
    }
    throw error;
  }
}

// ------------------------------------------------- binary-shape control --
interface BufferedShapeObservation {
  readonly outcome: 'response' | 'error';
  readonly status: number | null;
  readonly dataCtor: string | null;
  readonly isArrayBuffer: boolean;
  readonly isUint8Array: boolean;
  readonly byteLength: number | null;
  readonly bufferGlobalDefined: boolean;
  readonly errorName: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

interface StreamShapeObservation {
  readonly chunkCtor: string | null;
  readonly isUint8Array: boolean;
  readonly chunkLength: number | null;
  readonly chunkCount: number;
  readonly doneEmitted: boolean;
  readonly errorEmitted: boolean;
  readonly errorCount: number;
  readonly errorName: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly errorCauseMessage: string | null;
  /** Event names in emission order (first `data`/`done`/`error` included). */
  readonly events: readonly string[];
  readonly settledBy: 'done' | 'error' | 'timeout' | 'setup-throw';
}

interface RelativeUrlProbeObservation {
  readonly outcome: 'response' | 'error';
  readonly status: number | null;
  readonly errorName: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

interface BrowserObservation {
  readonly pageHref: string;
  readonly moduleExportKeys: readonly string[];
  readonly bufferGlobalDefined: boolean;
  readonly buffered: BufferedShapeObservation;
  readonly stream: StreamShapeObservation;
  readonly relativeUrlProbe: RelativeUrlProbeObservation;
}

interface BrowserClientLike {
  get(url: string, options: Record<string, unknown>): Promise<unknown>;
  stream(url: string, options: Record<string, unknown>): { on(event: string, listener: (...args: unknown[]) => void): unknown };
}

/**
 * Runs INSIDE Chrome via page.evaluate: only browser globals and the three
 * parameters are reachable here (no module-scope bindings). The bundle is
 * loaded through a Function-constructed import so the test transform never
 * rewrites the dynamic import for the server side.
 */
async function observeInPage(bundlePath: string, bodyPath: string, streamTimeoutMs: number): Promise<BrowserObservation> {
  const fieldUnknown = (value: unknown, field: string): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    return (value as Record<string, unknown>)[field];
  };
  const fieldString = (value: unknown, field: string): string | null => {
    const raw = fieldUnknown(value, field);
    return typeof raw === 'string' ? raw : null;
  };
  const fieldNumber = (value: unknown, field: string): number | null => {
    const raw = fieldUnknown(value, field);
    return typeof raw === 'number' ? raw : null;
  };
  const ctorName = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null;
    const name = prototype?.constructor?.name;
    return typeof name === 'string' ? name : null;
  };
  const messageOf = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (value instanceof Error) return value.message;
    return fieldString(value, 'message') ?? String(value);
  };
  const nameOf = (value: unknown): string | null => (value instanceof Error ? value.name : fieldString(value, 'name'));
  const codeOf = (value: unknown): string | null => fieldString(value, 'code');
  const causeMessageOf = (value: unknown): string | null => messageOf(fieldUnknown(value, 'cause')) ?? messageOf(fieldUnknown(value, 'originalError'));
  const bufferGlobalDefined = (): boolean => typeof Buffer !== 'undefined';

  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  const loaded: unknown = await dynamicImport(bundlePath);
  const moduleExportKeys = Object.keys(Object(loaded)).sort();
  const defaultExport = fieldUnknown(loaded, 'default');
  const create = fieldUnknown(defaultExport, 'create');
  if (typeof create !== 'function') {
    throw new Error(`bundle default export has no create(): export keys ${moduleExportKeys.join(',')}`);
  }
  const client = (create as (config: Record<string, unknown>) => unknown).call(defaultExport, {}) as BrowserClientLike;
  if (typeof client.get !== 'function' || typeof client.stream !== 'function') {
    throw new Error(`create({}) returned no get/stream client: ${ctorName(client) ?? typeof client}`);
  }

  const observeBuffered = async (url: string): Promise<BufferedShapeObservation> => {
    try {
      const response = await client.get(url, { responseType: 'buffer', cache: false });
      const data = fieldUnknown(response, 'data');
      return {
        outcome: 'response',
        status: fieldNumber(response, 'status'),
        dataCtor: ctorName(data),
        isArrayBuffer: data instanceof ArrayBuffer,
        isUint8Array: data instanceof Uint8Array,
        byteLength: fieldNumber(data, 'byteLength'),
        bufferGlobalDefined: bufferGlobalDefined(),
        errorName: null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        outcome: 'error',
        status: null,
        dataCtor: null,
        isArrayBuffer: false,
        isUint8Array: false,
        byteLength: null,
        bufferGlobalDefined: bufferGlobalDefined(),
        errorName: nameOf(error),
        errorCode: codeOf(error),
        errorMessage: messageOf(error),
      };
    }
  };

  const observeStream = (url: string): Promise<StreamShapeObservation> => new Promise((resolveObservation) => {
    const events: string[] = [];
    let chunkCtor: string | null = null;
    let isUint8Array = false;
    let chunkLength: number | null = null;
    let chunkCount = 0;
    let doneEmitted = false;
    let errorEmitted = false;
    let errorCount = 0;
    let errorName: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let errorCauseMessage: string | null = null;
    let settled = false;
    const settle = (settledBy: StreamShapeObservation['settledBy']): void => {
      if (settled) return;
      settled = true;
      resolveObservation({
        chunkCtor, isUint8Array, chunkLength, chunkCount, doneEmitted, errorEmitted, errorCount,
        errorName, errorCode, errorMessage, errorCauseMessage, events: [...events], settledBy,
      });
    };
    let stream: ReturnType<BrowserClientLike['stream']>;
    try {
      stream = client.stream(url, { cache: false });
    } catch (error) {
      errorEmitted = true;
      errorCount = 1;
      errorName = nameOf(error);
      errorCode = codeOf(error);
      errorMessage = messageOf(error);
      events.push('setup-throw');
      settle('setup-throw');
      return;
    }
    for (const event of ['initiated', 'start', 'headers', 'status', 'cookies', 'progress', 'download-progress', 'finish', 'complete', 'end', 'close']) {
      stream.on(event, () => { events.push(event); });
    }
    stream.on('data', (chunk: unknown) => {
      events.push('data');
      chunkCount += 1;
      if (chunkCount === 1) {
        chunkCtor = ctorName(chunk);
        isUint8Array = chunk instanceof Uint8Array;
        chunkLength = fieldNumber(chunk, 'length') ?? fieldNumber(chunk, 'byteLength');
      }
    });
    stream.on('done', () => {
      events.push('done');
      doneEmitted = true;
      setTimeout(() => settle('done'), 50);
    });
    stream.on('error', (error: unknown) => {
      events.push('error');
      errorEmitted = true;
      errorCount += 1;
      if (errorCount === 1) {
        errorName = nameOf(error);
        errorCode = codeOf(error);
        errorMessage = messageOf(error);
        errorCauseMessage = causeMessageOf(error);
      }
      setTimeout(() => settle('error'), 50);
    });
    setTimeout(() => settle('timeout'), streamTimeoutMs);
  });

  const observeRelativeUrl = async (): Promise<RelativeUrlProbeObservation> => {
    try {
      const response = await client.get(bodyPath, { responseType: 'buffer', cache: false });
      return { outcome: 'response', status: fieldNumber(response, 'status'), errorName: null, errorCode: null, errorMessage: null };
    } catch (error) {
      return { outcome: 'error', status: null, errorName: nameOf(error), errorCode: codeOf(error), errorMessage: messageOf(error) };
    }
  };

  const absoluteBodyUrl = new URL(bodyPath, location.href).href;
  const buffered = await observeBuffered(absoluteBodyUrl);
  const stream = await observeStream(absoluteBodyUrl);
  const relativeUrlProbe = await observeRelativeUrl();
  return { pageHref: location.href, moduleExportKeys, bufferGlobalDefined: bufferGlobalDefined(), buffered, stream, relativeUrlProbe };
}

// --------------------------------------------------------------- harness --
type LaunchPath = 'default' | 'fallback-executable';

interface HarnessState {
  bundles: { browser: BundleObservation | null; worker: BundleObservation | null };
  server: http.Server | null;
  port: number | null;
  browser: Browser | null;
  launchPath: LaunchPath | null;
  chromeVersion: string | null;
  setupError: string | null;
  launchError: string | null;
  evaluationError: string | null;
  observation: BrowserObservation | null;
  pageErrors: string[];
  consoleErrors: string[];
  teardownErrors: string[];
}

const state: HarnessState = {
  bundles: { browser: null, worker: null },
  server: null,
  port: null,
  browser: null,
  launchPath: null,
  chromeVersion: null,
  setupError: null,
  launchError: null,
  evaluationError: null,
  observation: null,
  pageErrors: [],
  consoleErrors: [],
  teardownErrors: [],
};

function startFixtureServer(bundle: BundleObservation | null): Promise<number> {
  const bundleText = bundle !== null && bundle.errors.length === 0 && bundle.text.length > 0
    ? bundle.text
    : `throw new Error(${JSON.stringify(`browser bundle unavailable: ${bundle === null ? 'never built' : bundle.errors.join('; ')}`)});`;
  const server = http.createServer((request, response) => {
    const url = request.url ?? '';
    if (request.method === 'GET' && url === FIXTURE_BUNDLE_PATH) {
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      response.end(bundleText);
      return;
    }
    if (request.method === 'GET' && url === FIXTURE_PAGE_PATH) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(FIXTURE_PAGE_HTML);
      return;
    }
    if (request.method === 'GET' && url === FIXTURE_BODY_PATH) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(FIXTURE_BODY_LENGTH),
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      response.end(FIXTURE_BODY);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  state.server = server;
  return within(new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePort((server.address() as AddressInfo).port);
    });
  }), 2_000, 'fixture server listen');
}

async function closeFixtureServer(): Promise<void> {
  const server = state.server;
  if (server === null) return;
  state.server = null;
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => { server.close(() => resolveClose()); });
}

async function launchChrome(): Promise<Browser> {
  let defaultError = 'not attempted';
  try {
    const browser = await within(puppeteer.launch({ headless: true }), STAGE_TIMEOUT_MS, 'default chrome launch');
    state.launchPath = 'default';
    return browser;
  } catch (error) {
    defaultError = describeError(error);
  }
  try {
    const browser = await within(
      puppeteer.launch({ headless: true, executablePath: FALLBACK_CHROME_EXECUTABLE }),
      STAGE_TIMEOUT_MS,
      'fallback chrome launch',
    );
    state.launchPath = 'fallback-executable';
    return browser;
  } catch (error) {
    throw new Error(`Chrome launch failed twice. default: ${defaultError}; fallback executable ${FALLBACK_CHROME_EXECUTABLE}: ${describeError(error)}`);
  }
}

async function closeBrowser(): Promise<void> {
  const browser = state.browser;
  if (browser === null) return;
  state.browser = null;
  try {
    await within(browser.close(), 10_000, 'chrome close');
  } catch (error) {
    state.teardownErrors.push(`chrome close: ${describeError(error)}`);
  }
}

function isConsoleMessage(value: unknown): value is ConsoleMessage {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; text?: unknown };
  return typeof candidate.type === 'function' && typeof candidate.text === 'function';
}

async function runBrowserProbe(port: number): Promise<void> {
  let browser: Browser;
  try {
    browser = await launchChrome();
  } catch (error) {
    state.launchError = describeError(error);
    return;
  }
  state.browser = browser;
  try {
    state.chromeVersion = await browser.version();
    const page = await browser.newPage();
    page.on('pageerror', (error: unknown) => { state.pageErrors.push(describeError(error)); });
    page.on('console', (message: unknown) => {
      if (isConsoleMessage(message) && message.type() === 'error') state.consoleErrors.push(message.text());
    });
    await within(page.goto(`http://127.0.0.1:${port}${FIXTURE_PAGE_PATH}`, { waitUntil: 'load' }), STAGE_TIMEOUT_MS, 'page navigation');
    state.observation = await within(
      page.evaluate(observeInPage, FIXTURE_BUNDLE_PATH, FIXTURE_BODY_PATH, STREAM_SETTLE_TIMEOUT_MS),
      STAGE_TIMEOUT_MS,
      'page evaluation',
    );
  } catch (error) {
    state.evaluationError = describeError(error);
  } finally {
    await closeBrowser();
  }
}

beforeAll(async () => {
  try {
    state.bundles.browser = await bundleFetchEntry('browser');
    state.bundles.worker = await bundleFetchEntry('worker');
    state.port = await startFixtureServer(state.bundles.browser);
    try {
      await runBrowserProbe(state.port);
    } finally {
      await closeFixtureServer();
    }
  } catch (error) {
    state.setupError = describeError(error);
  }
}, 45_000);

// ---------------------------------------------------------------- ledger --
interface LedgerBundle {
  readonly bytes: number;
  readonly inputs: readonly string[];
  readonly rejected: readonly RejectedResolve[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

interface LedgerV1 {
  readonly schema: 'rezo.r16.fetch-browser-entry.ledger/v1';
  readonly runtime: string;
  readonly chromeVersion: string | null;
  readonly chromeLaunchPath: LaunchPath | null;
  readonly bundles: { readonly browser: LedgerBundle | null; readonly worker: LedgerBundle | null };
  readonly shapes: {
    readonly buffered: BufferedShapeObservation | null;
    readonly stream: StreamShapeObservation | null;
    readonly relativeUrlProbe: RelativeUrlProbeObservation | null;
    readonly page: { readonly href: string; readonly moduleExportKeys: readonly string[]; readonly bufferGlobalDefined: boolean } | null;
  };
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly authenticity: { readonly fetchAdapterSha256: string; readonly fetchEntrySha256: string };
  readonly carrierSha256: string;
  readonly closingAuthenticity: { readonly carrierSha256: string; readonly fetchAdapterSha256: string; readonly fetchEntrySha256: string };
  readonly runner: { readonly argv: readonly string[]; readonly execArgv: readonly string[]; readonly execPath: string; readonly cwd: string };
  readonly infrastructure: {
    readonly setupError: string | null;
    readonly launchError: string | null;
    readonly evaluationError: string | null;
    readonly teardownErrors: readonly string[];
  };
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

const passedTests = new Set<string>();
const failedTests = new Set<string>();

function ledgerBundle(bundle: BundleObservation | null): LedgerBundle | null {
  if (bundle === null) return null;
  return { bytes: bundle.bytes, inputs: bundle.inputs, rejected: bundle.rejected, errors: bundle.errors, warnings: bundle.warnings };
}

function buildLedger(): LedgerV1 {
  const observation = state.observation;
  return {
    schema: 'rezo.r16.fetch-browser-entry.ledger/v1',
    runtime: process.version,
    chromeVersion: state.chromeVersion,
    chromeLaunchPath: state.launchPath,
    bundles: { browser: ledgerBundle(state.bundles.browser), worker: ledgerBundle(state.bundles.worker) },
    shapes: {
      buffered: observation?.buffered ?? null,
      stream: observation?.stream ?? null,
      relativeUrlProbe: observation?.relativeUrlProbe ?? null,
      page: observation === null
        ? null
        : { href: observation.pageHref, moduleExportKeys: observation.moduleExportKeys, bufferGlobalDefined: observation.bufferGlobalDefined },
    },
    pageErrors: [...state.pageErrors],
    consoleErrors: [...state.consoleErrors],
    authenticity: { fetchAdapterSha256: AUTHENTICITY.fetchAdapterSha256, fetchEntrySha256: AUTHENTICITY.fetchEntrySha256 },
    carrierSha256: CARRIER_SHA256,
    closingAuthenticity: { carrierSha256: carrierSha256Now(), fetchAdapterSha256: sourceSha256(FETCH_ADAPTER_SOURCE), fetchEntrySha256: sourceSha256(FETCH_ENTRY_SOURCE) },
    runner: { argv: [...process.argv], execArgv: [...process.execArgv], execPath: process.execPath, cwd: process.cwd() },
    infrastructure: {
      setupError: state.setupError,
      launchError: state.launchError,
      evaluationError: state.evaluationError,
      teardownErrors: [...state.teardownErrors],
    },
    passed: [...passedTests].sort(compareStrings),
    failed: [...failedTests].sort(compareStrings),
  };
}

afterAll(async () => {
  try {
    await closeBrowser();
    await closeFixtureServer();
  } finally {
    const ledger = buildLedger();
    console.log(`REZO_R16_BROWSER_LEDGER_V1:${JSON.stringify(ledger)}`);
  // Fail closed (tayo seq 61730/61735): any setup/launch/evaluation/teardown fault, page or console
  // error, bundle error/warning/rejection, failed row, or a row count other than the contract rejects
  // the run — a printed ledger is never a pass by itself.
  const faults: string[] = [];
  if (ledger.infrastructure.setupError !== null) faults.push(`setup:${ledger.infrastructure.setupError}`);
  if (ledger.infrastructure.launchError !== null) faults.push(`launch:${ledger.infrastructure.launchError}`);
  if (ledger.infrastructure.evaluationError !== null) faults.push(`evaluation:${ledger.infrastructure.evaluationError}`);
  if (ledger.infrastructure.teardownErrors.length > 0) faults.push(`teardown:${ledger.infrastructure.teardownErrors.join("|")}`);
  if (ledger.pageErrors.length > 0) faults.push(`page-errors:${ledger.pageErrors.join("|")}`);
  if (ledger.consoleErrors.length > 0) faults.push(`console-errors:${ledger.consoleErrors.join("|")}`);
  for (const variant of ["browser", "worker"] as const) { const bundle = ledger.bundles[variant]; if (bundle === null) faults.push(`bundle:${variant}:absent`); else if (bundle.errors.length > 0 || bundle.warnings.length > 0 || bundle.rejected.length > 0) faults.push(`bundle:${variant}`); }
  if (ledger.failed.length > 0) faults.push(`failed:${ledger.failed.join(",")}`);
  if (ledger.passed.length + ledger.failed.length !== 5) faults.push(`row-count:${ledger.passed.length + ledger.failed.length}`);
  // Exact row identity: the passed set must be exactly the four literal names (count alone is not enough).
  if (JSON.stringify([...ledger.passed].sort(compareStrings)) !== JSON.stringify(Object.values(TEST_NAMES).sort(compareStrings))) faults.push(`passed-names:${JSON.stringify(ledger.passed)}`);
  // Closing identities must equal the opening pins: a carrier or source that moved mid-run earns nothing.
  if (ledger.closingAuthenticity.carrierSha256 !== ledger.carrierSha256 || ledger.closingAuthenticity.fetchAdapterSha256 !== ledger.authenticity.fetchAdapterSha256 || ledger.closingAuthenticity.fetchEntrySha256 !== ledger.authenticity.fetchEntrySha256) faults.push('authenticity-moved');
  if (faults.length > 0) throw new Error(`browser-entry ledger rejected: ${faults.join("; ")}`);
  }
}, 20_000);

// ----------------------------------------------------------------- rows --
function carrier(name: string, body: () => void | Promise<void>): void {
  it(name, async () => {
    try {
      await body();
      passedTests.add(name);
    } catch (error) {
      failedTests.add(name);
      throw error;
    }
  }, 60_000);
}

function assertBundleControl(variant: BundleVariant): void {
  const bundle = state.bundles[variant];
  if (bundle === null) {
    throw new Error(`${variant} bundle was never built | setupError ${state.setupError ?? 'none'}`);
  }
  const summary = JSON.stringify({
    variant, errors: bundle.errors, warnings: bundle.warnings, rejected: bundle.rejected, bytes: bundle.bytes, inputCount: bundle.inputs.length,
  });
  expect(bundle.errors, `${variant} bundle must build with zero errors | observed ${summary}`).toEqual([]);
  expect(bundle.rejected, `${variant} bundle must never resolve a Node builtin | observed ${summary}`).toEqual([]);
  const nodeInputs = bundle.inputs.filter((key) => /^node:/.test(key));
  expect(nodeInputs, `${variant} bundle metafile must not contain node: inputs | observed ${JSON.stringify(nodeInputs)}`).toEqual([]);
  const transactionInputs = bundle.inputs.filter((key) => key.endsWith('adapters/download-target-transaction.ts'));
  expect(transactionInputs, `${variant} bundle must not pull the download-target transaction | observed ${JSON.stringify(transactionInputs)}`).toEqual([]);
  expect(bundle.inputs.includes(FETCH_ADAPTER_SOURCE), `${variant} bundle metafile must include ${FETCH_ADAPTER_SOURCE} | inputs ${JSON.stringify(bundle.inputs)}`).toBe(true);
  expect(bundle.inputs.includes(FETCH_ENTRY_SOURCE), `${variant} bundle metafile must include ${FETCH_ENTRY_SOURCE} | inputs ${JSON.stringify(bundle.inputs)}`).toBe(true);
  expect(bundle.bytes > 0, `${variant} bundle must carry bytes | observed ${bundle.bytes}`).toBe(true);
}

function requireObservation(row: string): BrowserObservation {
  if (state.launchError !== null) throw new Error(`${row}: ${state.launchError}`);
  if (state.evaluationError !== null) {
    throw new Error(`${row}: page evaluation failed: ${state.evaluationError} | pageErrors ${JSON.stringify(state.pageErrors)} consoleErrors ${JSON.stringify(state.consoleErrors)}`);
  }
  if (state.setupError !== null) throw new Error(`${row}: harness setup failed: ${state.setupError}`);
  if (state.observation === null) throw new Error(`${row}: no browser observation was recorded`);
  return state.observation;
}

carrier(TEST_NAMES.browserBundle, () => { assertBundleControl('browser'); });

carrier(TEST_NAMES.workerBundle, () => { assertBundleControl('worker'); });

carrier(TEST_NAMES.bufferedShape, () => {
  const observation = requireObservation('B1');
  const buffered = observation.buffered;
  const observed = JSON.stringify({ buffered, chrome: state.chromeVersion, page: observation.pageHref });
  expect(buffered.status, `B1 status must be 200 | observed ${observed}`).toBe(200);
  expect(buffered.isArrayBuffer, `B1 data must be an ArrayBuffer | observed ${observed}`).toBe(true);
  expect(buffered.byteLength, `B1 byteLength must be ${FIXTURE_BODY_LENGTH} | observed ${observed}`).toBe(FIXTURE_BODY_LENGTH);
});

carrier(TEST_NAMES.streamShape, () => {
  const observation = requireObservation('B2');
  const stream = observation.stream;
  const observed = JSON.stringify({ stream, pageErrors: state.pageErrors, chrome: state.chromeVersion, page: observation.pageHref });
  expect(stream.isUint8Array, `B2 first data chunk must be a Uint8Array | observed ${observed}`).toBe(true);
  expect(stream.chunkLength, `B2 first data chunk must carry ${FIXTURE_BODY_LENGTH} bytes | observed ${observed}`).toBe(FIXTURE_BODY_LENGTH);
  expect(stream.doneEmitted, `B2 done must be emitted | observed ${observed}`).toBe(true);
  expect(stream.errorEmitted, `B2 error must not be emitted | observed ${observed}`).toBe(false);
  expect(state.pageErrors, `B2 page must raise no errors | observed ${observed}`).toEqual([]);
  expect(state.consoleErrors, `B2 page must log no console errors | observed ${observed}`).toEqual([]);
});

carrier(TEST_NAMES.relativeUrl, () => {
  const observation = requireObservation('B3');
  const probe = observation.relativeUrlProbe;
  const observed = JSON.stringify({ probe, page: observation.pageHref, chrome: state.chromeVersion });
  expect(probe.outcome, `B3 the relative URL must resolve against the page location | observed ${observed}`).toBe('response');
  expect(probe.status, `B3 status must be 200 | observed ${observed}`).toBe(200);
});
