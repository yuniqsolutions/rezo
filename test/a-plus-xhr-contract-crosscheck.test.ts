/**
 * XC — XHR contract cross-check in a real headless Chrome (john, reviewer lane, 2026-08-30).
 *
 * The XHR entry bundle and the Fetch entry bundle run the SAME probes in the same Chrome against the same fixture
 * origin, and every probe is compared field by field: Fetch-in-browser is the reference (its contracts were proved
 * on the john lane today), XHR must match it the way every adapter must match HTTP/1.1 in the cache rows. Chrome's
 * own HTTP cache is disabled per page so the client-side cache is what gets measured. Read-only on xhr.ts: a
 * difference is a finding for the XHR lane, never an edit from here.
 *
 * Probes: proxy option and proxy pool (typed refusal, zero wire contact), cache hit, no-cache + ETag revalidation,
 * cache off, request/response interceptors (header on the wire, fulfilled transform, rejected-side tag), buffer
 * shape, the measured stealth header boundary (which headers a real Chrome lets each entry shape), page hygiene.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build, type BuildOptions, type Message as EsbuildMessage, type Plugin } from 'esbuild';
import puppeteer, { type Browser } from 'puppeteer';
import * as http from 'node:http';
import { builtinModules } from 'node:module';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = { xhr: 'src/adapters/entries/xhr.ts', fetch: 'src/adapters/entries/fetch.ts' } as const;
type EntryName = keyof typeof ENTRIES;
const ENTRY_NAMES: EntryName[] = ['xhr', 'fetch'];
const FALLBACK_CHROME_EXECUTABLE = join(homedir(), '.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const STAGE_TIMEOUT_MS = 30_000;
const BYTES_BODY = Buffer.from('parity-exact-body-bytes!', 'utf8');

// ------------------------------------------------------------------------------------------------------ bundles --
const NODE_BUILTINS: ReadonlySet<string> = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
function rejectNodeBuiltins(rejected: string[]): Plugin {
  return { name: 'xc-reject-node-builtins', setup(pluginBuild) { pluginBuild.onResolve({ filter: /.*/ }, (args) => {
    if (!(/^node:/.test(args.path) || NODE_BUILTINS.has(args.path))) return null;
    rejected.push(`${args.importer || '<entry>'} -> ${args.path}`);
    return { errors: [{ text: `Node builtin "${args.path}" requested by ${args.importer || '<entry>'}` }] };
  }); } };
}
const formatMessage = (message: EsbuildMessage): string => (message.location ? `${message.text} (${message.location.file}:${message.location.line})` : message.text);
async function bundleEntry(entry: EntryName): Promise<{ text: string; errors: string[]; rejected: string[]; bytes: number }> {
  const rejected: string[] = [];
  const options: BuildOptions = { entryPoints: [join(REPO_ROOT, ENTRIES[entry])], absWorkingDir: REPO_ROOT, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent', target: 'es2022', plugins: [rejectNodeBuiltins(rejected)] };
  try {
    const result = await build(options);
    const text = result.outputFiles?.[0]?.text ?? '';
    return { text, errors: result.errors.map(formatMessage), rejected, bytes: text.length };
  } catch (error) {
    const failure = error as { errors?: EsbuildMessage[] };
    return { text: '', errors: Array.isArray(failure.errors) ? failure.errors.map(formatMessage) : [String(error)], rejected, bytes: 0 };
  }
}

// ------------------------------------------------------------------------------------------------------ fixture --
type Hit = { method: string; ifNoneMatch: string | null; headers: Record<string, string> };
const hits = new Map<string, Hit[]>();
const bundles: Partial<Record<EntryName, Awaited<ReturnType<typeof bundleEntry>>>> = {};
let server: http.Server | null = null; let origin = '';
function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://fixture');
  const text = (status: number, body: string | Buffer, headers: Record<string, string>) => { response.writeHead(status, { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(body)), ...headers }); response.end(body); };
  if (url.pathname === '/index.html') return text(200, '<!doctype html><html><head><meta charset="utf-8"><title>rezo xhr cross-check</title><link rel="icon" href="data:,"></head><body>xc</body></html>', { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (url.pathname === '/bundle/xhr.js' || url.pathname === '/bundle/fetch.js') {
    const entry = url.pathname.endsWith('xhr.js') ? 'xhr' : 'fetch';
    const built = bundles[entry];
    const body = built && built.errors.length === 0 ? built.text : `throw new Error(${JSON.stringify(`bundle unavailable: ${built?.errors.join('; ') ?? 'never built'}`)});`;
    return text(200, body, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
  }
  const key = url.searchParams.get('k') ?? 'none';
  const list = hits.get(key) ?? []; hits.set(key, list);
  const headers: Record<string, string> = {}; for (const [name, value] of Object.entries(request.headers)) headers[name] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  list.push({ method: request.method ?? 'GET', ifNoneMatch: headers['if-none-match'] ?? null, headers });
  const n = list.length;
  if (url.pathname === '/r') return text(200, 'ok', { 'cache-control': 'no-store' });
  if (url.pathname === '/max-age') return text(200, `hit-${n}`, { 'cache-control': 'max-age=60' });
  if (url.pathname === '/etag') {
    if (headers['if-none-match'] === '"v1"') { response.writeHead(304, { etag: '"v1"', 'cache-control': 'no-cache' }); response.end(); return; }
    return text(200, `fresh-${n}`, { etag: '"v1"', 'cache-control': 'no-cache' });
  }
  if (url.pathname === '/status/503') return text(503, 'unavailable', { 'cache-control': 'no-store' });
  if (url.pathname === '/bytes') return text(200, BYTES_BODY, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
  return text(404, 'no route', {});
}

// ------------------------------------------------------------------------------------------------------ in-page --
type Attempt = { ok: boolean; status: number | null; code: string | null; isRezoError: boolean; tagged: string | null; message: string | null; value: unknown };
type EntryObservation = { exportKeys: string[]; probes: Record<string, Attempt>; unhandled: number };
type Keys = Record<string, string>;
/** Runs inside Chrome: no module-scope bindings may be referenced. */
async function observeEntry(bundlePath: string, base: string, keys: Keys): Promise<EntryObservation> {
  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  let unhandled = 0; window.addEventListener('unhandledrejection', () => { unhandled += 1; });
  const loaded = (await dynamicImport(bundlePath)) as Record<string, unknown>;
  const def = loaded.default as { create: (config: Record<string, unknown>) => any };
  const create = (config: Record<string, unknown>) => def.create.call(def, config);
  const ctorName = (value: unknown): string | null => (value === null || value === undefined ? null : ((Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null)?.constructor?.name ?? null));
  const attempt = async (fn: () => Promise<unknown>): Promise<Attempt> => {
    try { const value = await fn(); return { ok: true, status: null, code: null, isRezoError: false, tagged: null, message: null, value }; }
    catch (error) { const e = error as { code?: unknown; isRezoError?: unknown; tagged?: unknown; message?: unknown; response?: { status?: unknown } };
      return { ok: false, status: typeof e?.response?.status === 'number' ? e.response.status : null, code: typeof e?.code === 'string' ? e.code : null, isRezoError: e?.isRezoError === true, tagged: typeof e?.tagged === 'string' ? e.tagged : null, message: String(e?.message ?? error).slice(0, 200), value: null }; }
  };
  const setHeader = (config: any, name: string, value: string): void => { if (config.headers && typeof config.headers.set === 'function') config.headers.set(name, value); else config.headers = { ...(config.headers ?? {}), [name]: value }; };
  const options = { retry: false, timeout: 8000 };
  const url = (path: string, key: string) => `${base}${path}?k=${key}`;
  const textGet = async (client: any, path: string, key: string, extra: Record<string, unknown> = {}) => { const r = await client.get(url(path, key), { cache: false, responseType: 'text', ...extra }); return { status: r.status, data: String(r.data) }; };
  const twice = async (path: string, key: string, extra: Record<string, unknown>) => { const client = create(options); const bodies: string[] = []; const statuses: number[] = []; for (let i = 0; i < 2; i += 1) { const r = await client.get(url(path, key), { ...extra, responseType: 'text' }); bodies.push(String(r.data)); statuses.push(r.status); } return { bodies, statuses }; };
  const probes: Record<string, Attempt> = {};
  probes.proxyOption = await attempt(() => textGet(create(options), '/r', keys.proxyOption, { proxy: { protocol: 'http', host: '127.0.0.1', port: 9 } }));
  probes.proxyPool = await attempt(() => textGet(create({ ...options, proxyManager: { proxies: [{ protocol: 'http', host: '127.0.0.1', port: 9 }], rotation: 'sequential' } }), '/r', keys.proxyPool));
  probes.cacheHit = await attempt(() => twice('/max-age', keys.cacheHit, { cache: true }));
  probes.cacheRevalidate = await attempt(() => twice('/etag', keys.cacheRevalidate, { cache: true }));
  probes.cacheOff = await attempt(() => twice('/max-age', keys.cacheOff, { cache: false }));
  probes.interceptorRequest = await attempt(async () => { const client = create(options); client.interceptors.request.use((config: any) => { setHeader(config, 'x-ic', '1'); return config; }); return textGet(client, '/r', keys.interceptorRequest); });
  const tagged = create(options);
  tagged.interceptors.response.use((response: any) => { response.data = `T:${String(response.data)}`; return response; }, (error: any) => { if (error && typeof error === 'object') error.tagged = 'rejected-side'; throw error; });
  probes.interceptorFulfilled = await attempt(() => textGet(tagged, '/r', keys.interceptorFulfilled));
  probes.interceptorRejected = await attempt(() => textGet(tagged, '/status/503', keys.interceptorRejected));
  probes.bufferShape = await attempt(async () => { const r = await create(options).get(url('/bytes', keys.bufferShape), { responseType: 'buffer', cache: false }); const data = r.data as { byteLength?: number; length?: number } | null; return { status: r.status, ctor: ctorName(data), byteLength: typeof data?.byteLength === 'number' ? data.byteLength : (typeof data?.length === 'number' ? data.length : null) }; });
  probes.headerBaseline = await attempt(() => textGet(create(options), '/r', keys.headerBaseline));
  probes.headerShaping = await attempt(() => textGet(create(options), '/r', keys.headerShaping, { headers: { 'x-probe': 'shaped', 'user-agent': 'rezo-xc-probe/1', 'sec-ch-ua': '"RezoProbe";v="1"', 'accept-language': 'xx-XX', 'sec-fetch-mode': 'navigate', 'accept-encoding': 'identity', referer: `${base}/probe-referer`, origin: 'http://probe.invalid' } }));
  await new Promise((settle) => setTimeout(settle, 150));
  return { exportKeys: Object.keys(loaded).sort(), probes, unhandled };
}

// ------------------------------------------------------------------------------------------------------ harness --
const PROBES = ['proxyOption', 'proxyPool', 'cacheHit', 'cacheRevalidate', 'cacheOff', 'interceptorRequest', 'interceptorFulfilled', 'interceptorRejected', 'bufferShape', 'headerBaseline', 'headerShaping'] as const;
/** The header set the shaping probe asks for (profile-class names plus one plain control), lower-cased as the fixture sees them. */
const SHAPING_REQUEST: Record<string, string> = { 'x-probe': 'shaped', 'user-agent': 'rezo-xc-probe/1', 'sec-ch-ua': '"RezoProbe";v="1"', 'accept-language': 'xx-XX', 'sec-fetch-mode': 'navigate', 'accept-encoding': 'identity', referer: '/probe-referer', origin: 'http://probe.invalid' };
const keysFor = (entry: EntryName): Keys => Object.fromEntries(PROBES.map((probe) => [probe, `${entry}-${probe}-${process.pid}`]));
const state: { browser: Browser | null; chromeVersion: string | null; launchPath: string | null; setupError: string | null; observations: Partial<Record<EntryName, EntryObservation>>; pageErrors: Record<EntryName, string[]>; consoleErrors: Record<EntryName, string[]> } = { browser: null, chromeVersion: null, launchPath: null, setupError: null, observations: {}, pageErrors: { xhr: [], fetch: [] }, consoleErrors: { xhr: [], fetch: [] } };
const describeError = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); });
  return Promise.race([promise, guard]).finally(() => { if (timer !== null) clearTimeout(timer); });
}
async function launchChrome(): Promise<Browser> {
  try { const browser = await within(puppeteer.launch({ headless: true }), STAGE_TIMEOUT_MS, 'default chrome launch'); state.launchPath = 'default'; return browser; }
  catch (defaultError) {
    try { const browser = await within(puppeteer.launch({ headless: true, executablePath: FALLBACK_CHROME_EXECUTABLE }), STAGE_TIMEOUT_MS, 'fallback chrome launch'); state.launchPath = 'fallback-executable'; return browser; }
    catch (fallbackError) { throw new Error(`Chrome launch failed twice: ${describeError(defaultError)}; fallback: ${describeError(fallbackError)}`); }
  }
}
beforeAll(async () => {
  try {
    for (const entry of ENTRY_NAMES) bundles[entry] = await bundleEntry(entry);
    server = http.createServer(handle);
    const port = await within(new Promise<number>((resolvePort, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', () => resolvePort((server!.address() as AddressInfo).port)); }), 2_000, 'fixture listen');
    origin = `http://127.0.0.1:${port}`;
    state.browser = await launchChrome();
    state.chromeVersion = await state.browser.version();
    for (const entry of ENTRY_NAMES) {
      const page = await state.browser.newPage();
      page.on('pageerror', (error: unknown) => { state.pageErrors[entry].push(describeError(error)); });
      page.on('console', (message) => { if (message.type() === 'error') state.consoleErrors[entry].push(message.text().slice(0, 200)); });
      await page.setCacheEnabled(false);
      await within(page.goto(`${origin}/index.html`, { waitUntil: 'load' }), STAGE_TIMEOUT_MS, `${entry} page load`);
      state.observations[entry] = await within(page.evaluate(observeEntry, `/bundle/${entry}.js`, origin, keysFor(entry)), STAGE_TIMEOUT_MS * 2, `${entry} probes`) as EntryObservation;
      await page.close();
    }
  } catch (error) { state.setupError = describeError(error); }
}, STAGE_TIMEOUT_MS * 5);
afterAll(async () => {
  if (state.browser) { try { await within(state.browser.close(), 10_000, 'chrome close'); } catch { /* reported by the hygiene row through pageErrors */ } state.browser = null; }
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server!.close(() => done())); server = null; }
});

// --------------------------------------------------------------------------------------------------------- rows --
const probe = (entry: EntryName, name: string): Attempt => { const observation = state.observations[entry]; if (!observation) throw new Error(`no observation for ${entry}: ${state.setupError ?? 'unknown setup failure'}`); return observation.probes[name]; };
const ledger = (entry: EntryName, name: string): Hit[] => hits.get(keysFor(entry)[name]) ?? [];
const context = (): string => `chrome ${state.chromeVersion ?? '?'} (${state.launchPath ?? '?'})${state.setupError ? ` setup: ${state.setupError}` : ''}`;
const parity = (name: string, project: (attempt: Attempt, entry: EntryName) => unknown = (attempt) => attempt): void => {
  const fetchShape = project(probe('fetch', name), 'fetch'); const xhrShape = project(probe('xhr', name), 'xhr');
  expect(xhrShape, `${name}: XHR entry vs Fetch entry | ${context()}`).toEqual(fetchShape);
};
const noValue = (attempt: Attempt): Omit<Attempt, 'value'> & { value?: unknown } => ({ ...attempt, value: attempt.ok ? attempt.value : undefined });

it('XC-A1 both entries bundle for the browser with zero Node builtins and load in Chrome with a create() export', () => {
  expect(state.setupError, context()).toBeNull();
  for (const entry of ENTRY_NAMES) { expect(bundles[entry]?.errors, `${entry} bundle errors`).toEqual([]); expect(bundles[entry]?.rejected, `${entry} node builtins`).toEqual([]); expect(state.observations[entry]?.exportKeys, `${entry} exports`).toContain('default'); }
});
const proxyShape = (entry: EntryName, name: string) => ({ ...noValue(probe(entry, name)), message: null, wireHits: ledger(entry, name).length });
it('XC-01 a proxy option the browser cannot honour: XHR entry matches the Fetch entry — typed REZ_UNSUPPORTED_CAPABILITY, zero wire contact', () => {
  expect(proxyShape('fetch', 'proxyOption'), `Fetch reference | ${context()}`).toMatchObject({ ok: false, code: 'REZ_UNSUPPORTED_CAPABILITY', isRezoError: true, wireHits: 0 });
  expect(proxyShape('xhr', 'proxyOption'), `XHR entry vs Fetch entry | ${context()}`).toEqual(proxyShape('fetch', 'proxyOption'));
});
it('XC-02 a proxy pool the browser cannot honour: XHR entry matches the Fetch entry — typed REZ_UNSUPPORTED_CAPABILITY, zero wire contact', () => {
  expect(proxyShape('fetch', 'proxyPool'), `Fetch reference | ${context()}`).toMatchObject({ ok: false, code: 'REZ_UNSUPPORTED_CAPABILITY', isRezoError: true, wireHits: 0 });
  expect(proxyShape('xhr', 'proxyPool'), `XHR entry vs Fetch entry | ${context()}`).toEqual(proxyShape('fetch', 'proxyPool'));
});
const cacheShape = (entry: EntryName, name: string) => { const attempt = probe(entry, name); const seen = ledger(entry, name); return { ok: attempt.ok, code: attempt.code, hits: seen.length, conditional: seen.map((hit) => hit.ifNoneMatch), ...(attempt.ok ? (attempt.value as { bodies: string[]; statuses: number[] }) : { bodies: [], statuses: [] }) }; };
it('XC-03 cache hit (RC-01 shape): a fresh max-age response is served from the client cache on the second request on both entries', () => {
  const reference = { ok: true, code: null, hits: 1, conditional: [null], bodies: ['hit-1', 'hit-1'], statuses: [200, 200] };
  expect(cacheShape('fetch', 'cacheHit'), `Fetch reference | ${context()}`).toEqual(reference);
  expect(cacheShape('xhr', 'cacheHit'), `XHR entry | ${context()}`).toEqual(reference);
});
it('XC-04 no-cache + ETag (RC-03 shape): the second request carries If-None-Match and the 304 hands back the cached body as a 200 on both entries', () => {
  const reference = { ok: true, code: null, hits: 2, conditional: [null, '"v1"'], bodies: ['fresh-1', 'fresh-1'], statuses: [200, 200] };
  expect(cacheShape('fetch', 'cacheRevalidate'), `Fetch reference | ${context()}`).toEqual(reference);
  expect(cacheShape('xhr', 'cacheRevalidate'), `XHR entry | ${context()}`).toEqual(reference);
});
it('XC-05 control: cache false always hits the wire on both entries', () => {
  const reference = { ok: true, code: null, hits: 2, conditional: [null, null], bodies: ['hit-1', 'hit-2'], statuses: [200, 200] };
  expect(cacheShape('fetch', 'cacheOff'), `Fetch reference | ${context()}`).toEqual(reference);
  expect(cacheShape('xhr', 'cacheOff'), `XHR entry | ${context()}`).toEqual(reference);
});
it('XC-06 a request interceptor header reaches the wire on both entries', () => {
  for (const entry of ENTRY_NAMES) { expect(probe(entry, 'interceptorRequest'), `${entry} outcome | ${context()}`).toMatchObject({ ok: true, value: { status: 200, data: 'ok' } }); expect(ledger(entry, 'interceptorRequest').map((hit) => hit.headers['x-ic']), `${entry} x-ic on the wire`).toEqual(['1']); }
});
it('XC-07 response interceptors: the fulfilled transform and the rejected-side tag are identical on both entries', () => {
  expect(probe('fetch', 'interceptorFulfilled'), `Fetch reference | ${context()}`).toMatchObject({ ok: true, value: { status: 200, data: 'T:ok' } });
  expect(probe('fetch', 'interceptorRejected'), `Fetch reference | ${context()}`).toMatchObject({ ok: false, isRezoError: true, tagged: 'rejected-side', status: 503 });
  parity('interceptorFulfilled'); parity('interceptorRejected', (attempt) => ({ ...noValue(attempt), message: null }));
});
it('XC-08 responseType buffer delivers the same binary shape on both entries (24 bytes)', () => {
  expect(probe('fetch', 'bufferShape'), `Fetch reference | ${context()}`).toMatchObject({ ok: true, value: { status: 200, byteLength: 24 } });
  parity('bufferShape');
});
/** Which requested headers reached the wire with the requested value (accepted) and which Chrome owned instead (refused). */
const shaped = (entry: EntryName): { accepted: string[]; refused: Record<string, string | null> } => {
  const seen = ledger(entry, 'headerShaping')[0]?.headers ?? {};
  const accepted: string[] = []; const refused: Record<string, string | null> = {};
  for (const [name, requested] of Object.entries(SHAPING_REQUEST)) {
    const value = seen[name] ?? null; const wanted = name === 'referer' ? `${origin}${requested}` : requested;
    if (value === wanted) accepted.push(name); else refused[name] = normaliseChromeOwned(name, value);
  }
  return { accepted: accepted.sort(), refused };
};
/** Chrome-owned values carry the page URL or the Chrome build; pin their identity, not their bytes. */
const normaliseChromeOwned = (name: string, value: string | null): string | null => {
  if (value === null) return null;
  if (name === 'referer' && value === `${origin}/index.html`) return '<page-url>';
  if (name === 'user-agent' && /HeadlessChrome\/\d+/u.test(value)) return '<chrome-owned>';
  if (name === 'sec-ch-ua' && /"Chromium";v="\d+"/u.test(value)) return '<chrome-owned>';
  return value;
};
it('XC-09 header boundary: the plain control header reaches the wire, and a real Chrome lets both entries shape the same profile-class headers', () => {
  for (const entry of ENTRY_NAMES) { expect(probe(entry, 'headerBaseline'), `${entry} baseline | ${context()}`).toMatchObject({ ok: true, value: { status: 200 } }); expect(probe(entry, 'headerShaping'), `${entry} shaped request | ${context()}`).toMatchObject({ ok: true, value: { status: 200 } }); expect(shaped(entry).accepted, `${entry} control header`).toContain('x-probe'); }
  const fetchShaped = shaped('fetch'); const xhrShaped = shaped('xhr');
  expect(xhrShaped, `XHR ${JSON.stringify(xhrShaped)} vs Fetch ${JSON.stringify(fetchShaped)} | ${context()}`).toEqual(fetchShaped);
  expect({ boundary: fetchShaped, chromeConsole: state.consoleErrors }, `measured boundary | ${context()}`).toEqual({ boundary: FROZEN_BOUNDARY, chromeConsole: FROZEN_CHROME_CONSOLE });
});
/** Frozen from the measured Chrome 147 boundary (calibration run 2026-08-30): the headers a page can shape through either entry. */
const FROZEN_BOUNDARY: { accepted: string[]; refused: Record<string, string | null> } = {
  accepted: ['accept-language', 'x-probe'],
  refused: { 'accept-encoding': 'gzip, deflate, br, zstd', origin: null, referer: '<page-url>', 'sec-ch-ua': '<chrome-owned>', 'sec-fetch-mode': 'cors', 'user-agent': '<chrome-owned>' },
};
const FIXTURE_503_CONSOLE = 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
const FROZEN_CHROME_CONSOLE: Record<EntryName, string[]> = {
  xhr: [FIXTURE_503_CONSOLE, ...['accept-encoding', 'origin', 'referer', 'sec-ch-ua', 'sec-fetch-mode', 'user-agent'].map((name) => `Refused to set unsafe header "${name}"`)],
  fetch: [FIXTURE_503_CONSOLE],
};
/** Chrome-owned console lines the probes provoke on purpose: the 503 fixture and the forbidden-header refusals measured by XC-09. */
const CHROME_OWNED_CONSOLE = [/^Failed to load resource: the server responded with a status of 503/u, /^Refused to set unsafe header "[a-z-]+"$/u];
it('XC-10 hygiene: no page errors, no console errors beyond the Chrome-owned lines the probes provoke, no unhandled rejections on either page', () => {
  expect(state.setupError, context()).toBeNull();
  for (const entry of ENTRY_NAMES) { expect(state.pageErrors[entry], `${entry} page errors`).toEqual([]); expect(state.consoleErrors[entry].filter((line) => !CHROME_OWNED_CONSOLE.some((pattern) => pattern.test(line))), `${entry} console errors`).toEqual([]); expect(state.observations[entry]?.unhandled, `${entry} unhandled rejections`).toBe(0); }
});
