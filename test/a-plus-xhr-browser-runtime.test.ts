import { afterAll, beforeAll, expect, it } from 'vitest';
import { build, type BuildOptions, type Message as EsbuildMessage, type Plugin } from 'esbuild';
import puppeteer, { type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import { builtinModules } from 'node:module';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Real-Chrome RED carrier for the XHR adapter and browser platform entry.
 *
 * The host runner only builds, serves, launches, observes, and closes Chrome.
 * Every behavioral request executes inside Chrome. The explicit XHR entry and
 * the browser platform entry are separate bundles so a Fetch-backed platform
 * default cannot borrow credit from the direct XHR bundle.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER_PATH = fileURLToPath(import.meta.url);
const XHR_ADAPTER_SOURCE = 'src/adapters/xhr.ts';
const XHR_ENTRY_SOURCE = 'src/adapters/entries/xhr.ts';
const BROWSER_PLATFORM_SOURCE = 'src/platform/browser.ts';
const FETCH_ADAPTER_SOURCE = 'src/adapters/fetch.ts';

const PINNED_XHR_ADAPTER_SHA256 = 'bfae9c0cdd31d3ec9b8c4677b7644ba203845eb03157f108a15af268b72aadc4';
const PINNED_XHR_ENTRY_SHA256 = '1a21b49e2c6789152ed3b284c142904adee6601f571a8f27eec2e60e8994688e';
const PINNED_BROWSER_PLATFORM_SHA256 = '0d03d1083716779b28c076cc2b437832931e8052f077f1012f30b90cf01a5f42';
const PINNED_ESBUILD_VERSION = '0.27.3';
const PINNED_PUPPETEER_VERSION = '24.41.0';
const PINNED_VITEST_VERSION = '4.1.4';
const PINNED_PACKAGE_SHA256 = 'e88317c8981471c782700195a12ceac472e926242650e200a4c9d3e9c9e5d6a8';
const PINNED_BUN_LOCK_SHA256 = 'cfaceb929bbba5cce3839d6356f007f6ac6c0d73548a83dab6533927541f8d53';
const PINNED_ESBUILD_BINARY_SHA256 = '79fffbb53be7306c1505f97281b63a01902f53ac56682c61f673c78011c5dd14';
const PINNED_CHROME_SHA256 = '6c897a0324dcee587c77484b855e83735da86e0fcb0a21a807f6ee6e300c2646';
const PINNED_CHROME_VERSION = 'Chrome/147.0.7727.56';

const PINNED_CHROME_EXECUTABLE = join(
  homedir(),
  '.cache/puppeteer/chrome/mac_arm-147.0.7727.56/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const PATHS = Object.freeze({
  page: '/index.html',
  xhrBundle: '/xhr-entry.js',
  browserBundle: '/browser-entry.js',
  ok: '/ok',
  badJson: '/bad-json',
  stream: '/stream',
  progress: '/progress',
  hold: '/hold',
  rate: '/rate',
  rateTotal: '/rate-total',
  retry: '/retry',
  retryVeto: '/retry-veto',
  retryDelay: '/retry-delay',
  retryStageTimeout: '/retry-stage-timeout',
  hookInterrupt: '/hook-interrupt',
  facadeHttpError: '/facade-http-error',
  facadeRetryRecover: '/facade-retry-recover',
  facadeRetryExhaust: '/facade-retry-exhaust',
  truncated: '/truncated',
  truncatedStream: '/truncated-stream',
  echo: '/echo',
  binary: '/binary',
  abortHook: '/abort-hook',
  timeoutHook: '/timeout-hook',
  stagedHeaders: '/staged-headers',
  stagedBody: '/staged-body',
  connectRefusal: '/connect-refusal',
  redirectStart: '/redirect-start',
  redirectFinal: '/redirect-final',
  hookFailure: '/hook-failure',
  afterParseFailure: '/after-parse-failure',
  upload: '/upload',
  cookieTruth: '/cookie-truth',
  cookieRefusal: '/cookie-refusal',
  downloadRefusal: '/download-refusal',
  noXhr: '/no-xhr',
});

const FIXTURE_TEXT = 'xhr-browser-runtime-body';
const FIXTURE_BYTES = Buffer.from(FIXTURE_TEXT, 'utf8');
const PROGRESS_BYTES = Buffer.alloc(128 * 1024, 0x61);
const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
const PAGE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>rezo xhr browser runtime</title>'
  + '<link rel="icon" href="data:,"></head><body>rezo xhr browser runtime</body></html>';

const TEST_NAMES = Object.freeze({
  explicitBundle: 'XB-A1 explicit XHR entry bundles with xhr.ts, no Fetch adapter, and zero Node builtins',
  browserBundle: 'XB-A2 browser platform bundle selects xhr.ts and excludes the Fetch adapter (DECISION-061)',
  explicitDispatch: 'XB-C1 explicit XHR entry reaches native XMLHttpRequest once and never fetch (control)',
  explicitAbsence: 'XB-C2 explicit XHR entry with XMLHttpRequest absent rejects structurally before wire and never falls back to fetch',
  browserDispatch: 'XB-D1 browser platform default reaches native XMLHttpRequest once and never fetch (DECISION-061)',
  explicitMalformedJson: 'XB-J1 explicit malformed JSON rejects once as REZ_INVALID_JSON',
  inferredMalformedJson: 'XB-J2 inferred malformed JSON rejects once as REZ_INVALID_JSON',
  hooks: 'XB-H1 afterHeaders and afterParse are awaited in order and afterParse transforms data',
  stream: 'XB-L1 stream publishes one data chunk and the complete end/finish/done/complete/close terminal family',
  uploadLifecycle: 'XB-L2 upload preserves native progress, option callback, and one success terminal family',
  truncatedStream: 'XB-L3 truncated stream emits one structured error and no success terminal',
  progress: 'XB-O1 onDownloadProgress receives native progress before buffered settlement',
  abort: 'XB-R1 real caller abort is prompt ABORT_ERR with one native abort and no redispatch (control)',
  rateWaitAbort: 'XB-R2 caller abort interrupts Retry-After wait promptly with no redispatch',
  retryVisibility: 'XB-R3 retry hides the rejected attempt and publishes one accepted response lifecycle',
  retryVeto: 'XB-R7 onRetry veto precedes beforeRetry and prevents redispatch',
  truncated: 'XB-N1 truncated native response rejects once without false success or a late unhandled rejection',
  typedViewBody: 'XB-B2 typed-array subviews send only their selected bytes without JSON coercion',
  nativeBodyControls: 'XB-B3 native Blob, FormData, and raw ArrayBuffer carriers reach XMLHttpRequest unchanged (control)',
  explicitBinary: 'XB-B4 explicit arrayBuffer preserves all 256 byte values (control)',
  abortHook: 'XB-H2 caller abort notifies onAbort exactly once with signal ownership',
  timeoutHook: 'XB-H3 numeric total timeout is ECONNABORTED and notifies onTimeout once',
  hookFailure: 'XB-H4 afterHeaders failure rejects once through beforeError with its cause preserved',
  stagedHeaders: 'XB-H5 staged headers timeout is ESOCKETTIMEDOUT with one timeout hook and no late settlement',
  stagedBody: 'XB-H7 staged body timeout is ESOCKETTIMEDOUT with one timeout hook and no late settlement',
  afterParseFailure: 'XB-H6 afterParse failure rejects once through beforeError with its cause preserved',
  facadeHttpError: 'XB-H8 terminal HTTP facade failure awaits beforeError once and emits its transformed identity',
  hookInterrupt: 'XB-H9 caller abort and total deadline interrupt awaited response hooks with one terminal',
  facadeRetryOwnership: 'XB-L4 facade retries suppress transient beforeError and settle exhausted failure once',
  retryTotalTimeout: 'XB-R4 numeric total timeout interrupts retry delay promptly without redispatch',
  retryStageTotalTimeout: 'XB-R5 numeric total timeout interrupts pending retry condition, beforeRetry, and onRetry stages',
  rateTotalTimeout: 'XB-R6 numeric total timeout interrupts rate-limit hook and sleep without redispatch',
  cookieTruth: 'XB-O2 outbound document cookies are not fabricated as response cookies',
  downloadRefusal: 'XB-O3 browser path download refuses prewire instead of fabricating file success',
  cookieRefusal: 'XB-O4 explicit Cookie guarantee refuses structurally before native dispatch',
  connectRefusal: 'XB-O5 staged connect timeout refuses structurally before native dispatch',
  redirectMetadata: 'XB-O6 real Chrome redirect metadata is truthful and hop guarantees refuse prewire',
  finalCleanup: 'XB-R8 final late-window ledger has no unhandled rejection',
});

const EXPECTED_RED = Object.freeze([] as string[]);

const EXPECTED_CONSOLE_ERRORS = new Set([
  'Failed to load resource: the server responded with a status of 429 (Too Many Requests)',
  'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
  'Failed to load resource: net::ERR_CONTENT_LENGTH_MISMATCH',
  'Refused to set unsafe header "cookie"',
]);

class InfrastructureError extends Error {
  constructor(message: string) {
    super(`XHR browser carrier infrastructure invalidity: ${message}`);
    this.name = 'InfrastructureError';
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sourceSha256(relativePath: string): string {
  return sha256File(join(REPO_ROOT, relativePath));
}

function packageVersion(relativePath: string): string {
  const parsed = JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string') throw new InfrastructureError(`${relativePath} has no string version`);
  return parsed.version;
}

const OPENING = Object.freeze({
  carrierSha256: sha256File(CARRIER_PATH),
  xhrAdapterSha256: sourceSha256(XHR_ADAPTER_SOURCE),
  xhrEntrySha256: sourceSha256(XHR_ENTRY_SOURCE),
  browserPlatformSha256: sourceSha256(BROWSER_PLATFORM_SOURCE),
  esbuildVersion: packageVersion('node_modules/esbuild/package.json'),
  puppeteerVersion: packageVersion('node_modules/puppeteer/package.json'),
  vitestVersion: packageVersion('node_modules/vitest/package.json'),
  packageSha256: sha256File(join(REPO_ROOT, 'package.json')),
  bunLockSha256: sha256File(join(REPO_ROOT, 'bun.lock')),
  esbuildBinarySha256: sha256File(join(REPO_ROOT, 'node_modules/@esbuild/darwin-arm64/bin/esbuild')),
  chromeSha256: sha256File(PINNED_CHROME_EXECUTABLE),
});

if (OPENING.xhrAdapterSha256 !== PINNED_XHR_ADAPTER_SHA256) {
  throw new InfrastructureError(`xhr adapter actual ${OPENING.xhrAdapterSha256} expected ${PINNED_XHR_ADAPTER_SHA256}`);
}
if (OPENING.xhrEntrySha256 !== PINNED_XHR_ENTRY_SHA256) {
  throw new InfrastructureError(`xhr entry actual ${OPENING.xhrEntrySha256} expected ${PINNED_XHR_ENTRY_SHA256}`);
}
if (OPENING.browserPlatformSha256 !== PINNED_BROWSER_PLATFORM_SHA256) {
  throw new InfrastructureError(`browser platform actual ${OPENING.browserPlatformSha256} expected ${PINNED_BROWSER_PLATFORM_SHA256}`);
}
if (OPENING.esbuildVersion !== PINNED_ESBUILD_VERSION || OPENING.puppeteerVersion !== PINNED_PUPPETEER_VERSION) {
  throw new InfrastructureError(`tool versions esbuild=${OPENING.esbuildVersion} puppeteer=${OPENING.puppeteerVersion}`);
}
if (OPENING.vitestVersion !== PINNED_VITEST_VERSION
  || OPENING.packageSha256 !== PINNED_PACKAGE_SHA256
  || OPENING.bunLockSha256 !== PINNED_BUN_LOCK_SHA256
  || OPENING.esbuildBinarySha256 !== PINNED_ESBUILD_BINARY_SHA256
  || OPENING.chromeSha256 !== PINNED_CHROME_SHA256) {
  throw new InfrastructureError(`runner/package closure mismatch: ${JSON.stringify(OPENING)}`);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(`${label} exceeded ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

// --------------------------------------------------------------- bundles --

type BundleKind = 'xhr-entry' | 'browser-platform';

interface RejectedResolve {
  readonly importer: string;
  readonly path: string;
}

interface BundleObservation {
  readonly kind: BundleKind;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly rejected: readonly RejectedResolve[];
  readonly inputs: readonly string[];
  readonly bytes: number;
  readonly text: string;
}

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
if (!NODE_BUILTINS.has('punycode') || !NODE_BUILTINS.has('string_decoder') || NODE_BUILTINS.size < 80) {
  throw new InfrastructureError(`running Node builtin census is implausible (${NODE_BUILTINS.size})`);
}

function formatBuildMessage(message: EsbuildMessage): string {
  const location = message.location;
  return location === null
    ? message.text
    : `${message.text} (${location.file}:${location.line}:${location.column})`;
}

function createBuiltinRejectionPlugin(rejected: RejectedResolve[]): Plugin {
  return {
    name: 'rezo-xhr-browser-reject-node-builtins',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        if (!/^node:/.test(args.path) && !NODE_BUILTINS.has(args.path)) return null;
        rejected.push({ importer: args.importer, path: args.path });
        return { errors: [{ text: `Node builtin ${args.path} requested by ${args.importer || '<entry>'}` }] };
      });
    },
  };
}

async function bundle(kind: BundleKind): Promise<BundleObservation> {
  const entry = kind === 'xhr-entry' ? XHR_ENTRY_SOURCE : BROWSER_PLATFORM_SOURCE;
  const rejected: RejectedResolve[] = [];
  const options: BuildOptions = {
    absWorkingDir: REPO_ROOT,
    entryPoints: [join(REPO_ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins: [createBuiltinRejectionPlugin(rejected)],
  };
  try {
    const result = await build(options);
    if (result.outputFiles?.length !== 1 || result.metafile === undefined) {
      throw new InfrastructureError(`${kind} produced no singular output/metafile`);
    }
    return {
      kind,
      errors: result.errors.map(formatBuildMessage),
      warnings: result.warnings.map(formatBuildMessage),
      rejected: [...rejected].sort((a, b) => compareStrings(`${a.importer}:${a.path}`, `${b.importer}:${b.path}`)),
      inputs: Object.keys(result.metafile.inputs).sort(compareStrings),
      bytes: result.outputFiles[0].contents.byteLength,
      text: result.outputFiles[0].text,
    };
  } catch (error) {
    const failure = error as { errors?: EsbuildMessage[]; warnings?: EsbuildMessage[] };
    if (Array.isArray(failure.errors) && Array.isArray(failure.warnings)) {
      return {
        kind,
        errors: failure.errors.map(formatBuildMessage),
        warnings: failure.warnings.map(formatBuildMessage),
        rejected,
        inputs: [],
        bytes: 0,
        text: '',
      };
    }
    throw error;
  }
}

// --------------------------------------------------------------- browser --

interface SettledObservation {
  readonly outcome: 'fulfilled' | 'rejected' | 'timeout';
  readonly status: number | null;
  readonly code: string | null;
  readonly errno: number | null;
  readonly message: string | null;
  readonly data: unknown;
  readonly elapsedMs: number;
}

interface TransportCounters {
  readonly opens: number;
  readonly sends: number;
  readonly aborts: number;
  readonly fetches: number;
}

interface DispatchObservation {
  readonly settled: SettledObservation;
  readonly transport: TransportCounters;
}

interface HookObservation {
  readonly settled: SettledObservation;
  readonly events: readonly string[];
  readonly transformed: boolean;
}

interface StreamObservation {
  readonly events: readonly string[];
  readonly dataCount: number;
  readonly dataBytes: number;
  readonly errorCount: number;
  readonly isFinished: boolean | null;
  readonly settledBy: string;
}

interface ProgressObservation {
  readonly settled: SettledObservation;
  readonly callbackCount: number;
  readonly lastLoaded: number;
}

interface NoXhrObservation {
  readonly outcome: 'rejected' | 'fulfilled';
  readonly message: string | null;
  readonly code: string | null;
  readonly errno: number | null;
  readonly fetches: number;
}

interface RetryVisibilityObservation {
  readonly events: readonly string[];
  readonly headerStatuses: readonly number[];
  readonly statusValues: readonly number[];
  readonly errorStatuses: readonly (number | null)[];
  readonly beforeRetryCount: number;
  readonly beforeRetryEvents: readonly string[];
  readonly opensAtBeforeRetryStart: number | null;
  readonly opensAtBeforeRetryEnd: number | null;
  readonly onRetryCount: number;
  readonly callbackOrder: readonly string[];
  readonly retryAttempts: number | null;
  readonly historyAttempts: readonly (number | null)[];
  readonly historyStatuses: readonly (number | null)[];
  readonly nativeProgressCounts: readonly number[];
  readonly activeAbortListenersAtClose: number | null;
  readonly transport: TransportCounters;
  readonly settledBy: string;
}

interface RetryVetoObservation {
  readonly callbackOrder: readonly string[];
  readonly beforeRetryCount: number;
  readonly onRetryCount: number;
  readonly headerStatuses: readonly number[];
  readonly errorStatuses: readonly (number | null)[];
  readonly transport: TransportCounters;
  readonly settledBy: string;
}

interface FacadeErrorObservation {
  readonly events: readonly string[];
  readonly beforeErrorCount: number;
  readonly emittedIsSentinel: boolean;
  readonly emittedCode: string | null;
  readonly headerStatuses: readonly number[];
  readonly errorStatuses: readonly (number | null)[];
  readonly transport: TransportCounters;
  readonly settledBy: string;
}

interface FacadeRetryObservation extends FacadeErrorObservation {
  readonly caseName: 'recover' | 'exhaust';
}

interface TruncatedObservation {
  readonly settled: SettledObservation;
  readonly transport: TransportCounters;
  readonly nativeTerminalEvents: readonly string[];
  readonly unhandledReasons: readonly string[];
}

interface BodyEchoObservation {
  readonly caseName: string;
  readonly sentKind: string;
  readonly bodyHex: string;
  readonly bodyLength: number;
  readonly contentType: string;
}

interface BinaryObservation {
  readonly kind: string;
  readonly bytes: readonly number[];
}

interface LifecycleHookObservation {
  readonly settled: SettledObservation;
  readonly events: readonly string[];
  readonly hookCount: number;
  readonly hookPayload: Record<string, unknown> | null;
}

interface HookFailureObservation {
  readonly settled: SettledObservation;
  readonly events: readonly string[];
  readonly beforeErrorCount: number;
  readonly causeMessage: string | null;
}

interface CookieTruthObservation {
  readonly outboundCookie: string;
  readonly responseCookieNames: readonly string[];
  readonly responseCookieString: string;
}

interface FacadeRefusalObservation {
  readonly events: readonly string[];
  readonly errorCodes: readonly (string | null)[];
  readonly isFinished: boolean | null;
  readonly settledBy: string;
  readonly transport: TransportCounters;
}

interface UploadLifecycleObservation {
  readonly events: readonly string[];
  readonly facadeProgressCount: number;
  readonly optionProgressCount: number;
  readonly errorCodes: readonly (string | null)[];
  readonly isFinished: boolean | null;
  readonly settledBy: string;
  readonly transport: TransportCounters;
}

interface StagedHeadersObservation extends LifecycleHookObservation {
  readonly transport: TransportCounters;
}

interface DeadlineStageObservation extends DispatchObservation {
  readonly caseName: string;
  readonly stageStarted: number;
  readonly stageSettled: number;
  readonly onTimeoutCount: number;
}

interface HookInterruptObservation extends DispatchObservation {
  readonly phase: 'afterHeaders' | 'afterParse';
  readonly owner: 'caller' | 'total';
  readonly hookStarted: number;
  readonly hookSettled: number;
  readonly beforeErrorCount: number;
  readonly onAbortCount: number;
  readonly onTimeoutCount: number;
}

interface RedirectMetadataObservation {
  readonly finalUrl: string | null;
  readonly urls: readonly string[];
  readonly configFinalUrl: string | null;
  readonly adapterUsed: string | null;
  readonly transport: TransportCounters;
  readonly refusal: SettledObservation;
  readonly refusalTransport: TransportCounters;
}

interface TruncatedStreamObservation {
  readonly events: readonly string[];
  readonly errorCodes: readonly (string | null)[];
  readonly errorErrnos: readonly (number | null)[];
  readonly isFinished: boolean | null;
  readonly settledBy: string;
  readonly transport: TransportCounters;
}

interface ExplicitBrowserObservation {
  readonly explicitHref: string;
  readonly explicitExports: readonly string[];
  readonly explicitDispatch: DispatchObservation;
  readonly explicitMalformedJson: SettledObservation;
  readonly inferredMalformedJson: SettledObservation;
  readonly hooks: HookObservation;
  readonly stream: StreamObservation;
  readonly uploadLifecycle: UploadLifecycleObservation;
  readonly truncatedStream: TruncatedStreamObservation;
  readonly progress: ProgressObservation;
  readonly abort: DispatchObservation;
  readonly rateWaitAbort: DispatchObservation;
  readonly retryVisibility: RetryVisibilityObservation;
  readonly retryVeto: RetryVetoObservation;
  readonly truncated: TruncatedObservation;
  readonly falsyBodies: readonly BodyEchoObservation[];
  readonly typedViewBody: BodyEchoObservation;
  readonly nativeBodyControls: readonly BodyEchoObservation[];
  readonly explicitBinary: BinaryObservation;
  readonly autoBinary: BinaryObservation;
  readonly abortHook: LifecycleHookObservation;
  readonly timeoutHook: LifecycleHookObservation;
  readonly hookFailure: HookFailureObservation;
  readonly afterParseFailure: HookFailureObservation;
  readonly facadeHttpError: FacadeErrorObservation;
  readonly facadeRetryOwnership: readonly FacadeRetryObservation[];
  readonly hookInterrupt: readonly HookInterruptObservation[];
  readonly stagedHeaders: StagedHeadersObservation;
  readonly stagedBody: StagedHeadersObservation;
  readonly retryTotalTimeout: DispatchObservation & { readonly onTimeoutCount: number };
  readonly retryStageTotalTimeout: readonly DeadlineStageObservation[];
  readonly rateTotalTimeout: readonly DeadlineStageObservation[];
  readonly cookieTruth: CookieTruthObservation;
  readonly downloadRefusal: FacadeRefusalObservation;
  readonly cookieRefusal: DispatchObservation;
  readonly connectRefusal: DispatchObservation;
  readonly redirectMetadata: RedirectMetadataObservation;
  readonly finalUnhandledReasons: readonly string[];
}

interface PlatformBrowserObservation {
  readonly platformHref: string;
  readonly platformExports: readonly string[];
  readonly browserDispatch: DispatchObservation;
}

interface BrowserObservation extends ExplicitBrowserObservation, PlatformBrowserObservation {
  readonly explicitAbsence: NoXhrObservation;
}

interface BrowserClientLike {
  get(url: string, options?: Record<string, unknown>): Promise<unknown>;
  request(options: Record<string, unknown>): Promise<unknown>;
  stream(url: string, options?: Record<string, unknown>): BrowserFacadeLike;
  download(url: string, saveTo: string, options?: Record<string, unknown>): BrowserFacadeLike;
  upload(url: string, data: unknown, options?: Record<string, unknown>): BrowserFacadeLike;
  create(config?: Record<string, unknown>): BrowserClientLike;
}

interface BrowserFacadeLike {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    isFinished?: () => boolean;
}

async function observeExplicitInChrome(paths: typeof PATHS): Promise<ExplicitBrowserObservation> {
  const objectField = (value: unknown, field: string): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    return Reflect.get(value, field);
  };
  const stringField = (value: unknown, field: string): string | null => {
    const candidate = objectField(value, field);
    return typeof candidate === 'string' ? candidate : null;
  };
  const numberField = (value: unknown, field: string): number | null => {
    const candidate = objectField(value, field);
    return typeof candidate === 'number' ? candidate : null;
  };
  const counters = { opens: 0, sends: 0, aborts: 0, fetches: 0 };
  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  const sentBodyKinds = new Map<string, string[]>();
  const retryNativeProgressCounts: number[] = [];
  const nativeTruncationEvents: string[] = [];
  const unhandledReasons: string[] = [];
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    unhandledReasons.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
  });
  const snapshot = (): TransportCounters => ({ ...counters });
  const delta = (before: TransportCounters): TransportCounters => ({
    opens: counters.opens - before.opens,
    sends: counters.sends - before.sends,
    aborts: counters.aborts - before.aborts,
    fetches: counters.fetches - before.fetches,
  });
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeAbort = XMLHttpRequest.prototype.abort;
  XMLHttpRequest.prototype.open = function instrumentedOpen(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['open']>) {
    counters.opens += 1;
    requestUrls.set(this, String(args[1]));
    return Reflect.apply(nativeOpen, this, args);
  } as XMLHttpRequest['open'];
  XMLHttpRequest.prototype.send = function instrumentedSend(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
    counters.sends += 1;
    const requestUrl = requestUrls.get(this);
    if (requestUrl !== undefined) {
      const parsedUrl = new URL(requestUrl, location.href);
      const key = parsedUrl.searchParams.get('case') ?? parsedUrl.pathname;
      const body = args[0];
      const kind = body === null || body === undefined
        ? 'null'
        : typeof body === 'string'
          ? `string:${body}`
          : body instanceof FormData
            ? 'FormData'
            : body instanceof Blob
              ? `Blob:${body.type}:${body.size}`
              : body instanceof ArrayBuffer
                ? `ArrayBuffer:${body.byteLength}`
                : ArrayBuffer.isView(body)
                  ? `${body.constructor.name}:${body.byteOffset}:${body.byteLength}`
                  : Object.prototype.toString.call(body);
      sentBodyKinds.set(key, [...(sentBodyKinds.get(key) ?? []), kind]);
    }
    if (requestUrl !== undefined && new URL(requestUrl, location.href).pathname === paths.truncated) {
      for (const eventName of ['load', 'error', 'timeout', 'abort', 'loadend']) {
        this.addEventListener(eventName, () => nativeTruncationEvents.push(eventName), { once: true });
      }
    }
    if (requestUrl !== undefined && new URL(requestUrl, location.href).pathname === paths.retry) {
      const attemptIndex = retryNativeProgressCounts.length;
      retryNativeProgressCounts.push(0);
      this.addEventListener('progress', () => {
        retryNativeProgressCounts[attemptIndex] = (retryNativeProgressCounts[attemptIndex] ?? 0) + 1;
      });
    }
    return Reflect.apply(nativeSend, this, args);
  } as XMLHttpRequest['send'];
  XMLHttpRequest.prototype.abort = function instrumentedAbort(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['abort']>) {
    counters.aborts += 1;
    return Reflect.apply(nativeAbort, this, args);
  } as XMLHttpRequest['abort'];
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    counters.fetches += 1;
    return nativeFetch(...args);
  }) as typeof fetch;

  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  const requireClient = (moduleValue: unknown): BrowserClientLike => {
    const candidate = objectField(moduleValue, 'default');
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
      throw new Error('bundle default export missing');
    }
    const client = candidate as BrowserClientLike;
    if (typeof client.get !== 'function'
      || typeof client.request !== 'function'
      || typeof client.stream !== 'function'
      || typeof client.download !== 'function'
      || typeof client.upload !== 'function'
      || typeof client.create !== 'function') {
      throw new Error('bundle default export lacks get/request/stream/download/upload/create');
    }
    return client;
  };
  const withinPage = async <T>(promise: Promise<T>, milliseconds: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`page operation exceeded ${milliseconds}ms`)), milliseconds);
    });
    return Promise.race([promise, guard]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  };
  const summarizeData = (value: unknown): unknown => {
    if (typeof value === 'string' && value.length > 256) {
      return { kind: 'string', length: value.length, prefix: value.slice(0, 32) };
    }
    if (value instanceof ArrayBuffer) return { kind: 'ArrayBuffer', byteLength: value.byteLength };
    if (value instanceof Blob) return { kind: 'Blob', size: value.size, type: value.type };
    return value;
  };
  const settle = async (promise: Promise<unknown>, milliseconds = 4_000): Promise<SettledObservation> => {
    const started = performance.now();
    try {
      const value = await withinPage(promise, milliseconds);
      return {
        outcome: 'fulfilled',
        status: numberField(value, 'status'),
        code: null,
        errno: null,
        message: null,
        data: summarizeData(objectField(value, 'data') ?? null),
        elapsedMs: performance.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : stringField(error, 'message') ?? String(error);
      return {
        outcome: message.startsWith('page operation exceeded') ? 'timeout' : 'rejected',
        status: numberField(objectField(error, 'response'), 'status'),
        code: stringField(error, 'code'),
        errno: numberField(error, 'errno'),
        message,
        data: null,
        elapsedMs: performance.now() - started,
      };
    }
  };
  const absolute = (path: string): string => new URL(path, location.href).href;

  const explicitModule = await dynamicImport(paths.xhrBundle);
  const explicitFactory = requireClient(explicitModule);
  const explicitClient = explicitFactory.create({});
  const explicitBefore = snapshot();
  const explicitSettled = await settle(explicitClient.get(absolute(paths.ok), { cache: false }));
  const explicitDispatch = { settled: explicitSettled, transport: delta(explicitBefore) };

  const explicitMalformedJson = await settle(explicitClient.get(absolute(paths.badJson), {
    cache: false,
    responseType: 'json',
  }));
  const inferredMalformedJson = await settle(explicitClient.get(absolute(paths.badJson), {
    cache: false,
    responseType: 'auto',
  }));

  const hookEvents: string[] = [];
  const hookClient = explicitFactory.create({
    hooks: {
      afterHeaders: [async () => {
        hookEvents.push('afterHeaders:start');
        await new Promise<void>((resolveHook) => setTimeout(resolveHook, 25));
        hookEvents.push('afterHeaders:end');
      }],
      afterParse: [async (event: unknown) => {
        hookEvents.push('afterParse:start');
        await new Promise<void>((resolveHook) => setTimeout(resolveHook, 25));
        hookEvents.push('afterParse:end');
        return { hooked: true, original: objectField(event, 'data') };
      }],
    },
  });
  const hookSettled = await settle(hookClient.get(absolute(paths.ok), { cache: false }));
  const hooks = {
    settled: hookSettled,
    events: [...hookEvents],
    transformed: objectField(hookSettled.data, 'hooked') === true,
  };

  const stream = await new Promise<StreamObservation>((resolveStream) => {
    const events: string[] = [];
    let dataCount = 0;
    let dataBytes = 0;
    let errorCount = 0;
    let resolved = false;
    let streamFacade: ReturnType<BrowserClientLike['stream']> | null = null;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveStream({
        events: [...events],
        dataCount,
        dataBytes,
        errorCount,
        isFinished: typeof streamFacade?.isFinished === 'function' ? streamFacade.isFinished() : null,
        settledBy,
      });
    };
    try {
      streamFacade = explicitClient.stream(absolute(paths.stream), { cache: false });
      for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'end', 'finish', 'done', 'complete', 'close']) {
        streamFacade.on(eventName, () => {
          events.push(eventName);
          if (eventName === 'close') setTimeout(() => finish('close'), 30);
          if (eventName === 'done') setTimeout(() => finish('done'), 100);
        });
      }
      streamFacade.on('data', (chunk: unknown) => {
        events.push('data');
        dataCount += 1;
        dataBytes += numberField(chunk, 'byteLength') ?? numberField(chunk, 'length') ?? 0;
      });
      streamFacade.on('error', () => {
        events.push('error');
        errorCount += 1;
        setTimeout(() => finish('error'), 30);
      });
    } catch (error) {
      events.push(`setup-error:${error instanceof Error ? error.message : String(error)}`);
      errorCount += 1;
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  let uploadOptionProgressCount = 0;
  const uploadBefore = snapshot();
  const uploadLifecycle = await new Promise<UploadLifecycleObservation>((resolveUpload) => {
    const events: string[] = [];
    const errorCodes: Array<string | null> = [];
    let facadeProgressCount = 0;
    let facade: BrowserFacadeLike | null = null;
    let resolved = false;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveUpload({
        events: [...events],
        facadeProgressCount,
        optionProgressCount: uploadOptionProgressCount,
        errorCodes: [...errorCodes],
        isFinished: typeof facade?.isFinished === 'function' ? facade.isFinished() : null,
        settledBy,
        transport: delta(uploadBefore),
      });
    };
    try {
      facade = explicitClient.upload(
        absolute(paths.upload),
        new Blob([new Uint8Array(64 * 1024).fill(0x5a)], { type: 'application/octet-stream' }),
        {
          cache: false,
          onUploadProgress: () => { uploadOptionProgressCount += 1; },
        },
      );
      for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'finish', 'done', 'complete']) {
        facade.on(eventName, () => {
          events.push(eventName);
          if (eventName === 'done') setTimeout(() => finish('done'), 80);
        });
      }
      facade.on('progress', () => {
        events.push('progress');
        facadeProgressCount += 1;
      });
      facade.on('error', (error: unknown) => {
        events.push('error');
        errorCodes.push(stringField(error, 'code'));
        setTimeout(() => finish('error'), 30);
      });
    } catch (error) {
      events.push('setup-error');
      errorCodes.push(stringField(error, 'code'));
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  const truncatedStreamBefore = snapshot();
  const truncatedStream = await new Promise<TruncatedStreamObservation>((resolveTruncatedStream) => {
    const events: string[] = [];
    const errorCodes: Array<string | null> = [];
    const errorErrnos: Array<number | null> = [];
    let facade: BrowserFacadeLike | null = null;
    let resolved = false;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveTruncatedStream({
        events: [...events],
        errorCodes: [...errorCodes],
        errorErrnos: [...errorErrnos],
        isFinished: typeof facade?.isFinished === 'function' ? facade.isFinished() : null,
        settledBy,
        transport: delta(truncatedStreamBefore),
      });
    };
    try {
      facade = explicitClient.stream(absolute(paths.truncatedStream), {
        cache: false,
        responseType: 'arrayBuffer',
      });
      for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'data', 'end', 'finish', 'done', 'complete', 'close', 'progress']) {
        facade.on(eventName, () => {
          events.push(eventName);
          if (eventName === 'done' || eventName === 'close') setTimeout(() => finish(eventName), 80);
        });
      }
      facade.on('error', (error: unknown) => {
        events.push('error');
        errorCodes.push(stringField(error, 'code'));
        errorErrnos.push(numberField(error, 'errno'));
        setTimeout(() => finish('error'), 100);
      });
    } catch (error) {
      events.push('setup-error');
      errorCodes.push(stringField(error, 'code'));
      errorErrnos.push(numberField(error, 'errno'));
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  let progressCount = 0;
  let lastLoaded = 0;
  const progressSettled = await settle(explicitClient.get(absolute(paths.progress), {
    cache: false,
    onDownloadProgress: (event: unknown) => {
      progressCount += 1;
      lastLoaded = numberField(event, 'loaded') ?? lastLoaded;
    },
  }));
  const progress = { settled: progressSettled, callbackCount: progressCount, lastLoaded };

  const abortController = new AbortController();
  const abortBefore = snapshot();
  const abortTimer = setTimeout(() => abortController.abort(), 50);
  const abortSettled = await settle(explicitClient.get(absolute(paths.hold), {
    cache: false,
    signal: abortController.signal,
    timeout: 5_000,
  }), 3_000);
  clearTimeout(abortTimer);
  const abort = { settled: abortSettled, transport: delta(abortBefore) };

  const rateController = new AbortController();
  const rateBefore = snapshot();
  const rateTimer = setTimeout(() => rateController.abort(), 60);
  const rateSettled = await settle(explicitClient.get(absolute(paths.rate), {
    cache: false,
    signal: rateController.signal,
    waitOnStatus: [429],
    maxWaitAttempts: 1,
    maxWaitTime: 3_000,
  }), 4_000);
  clearTimeout(rateTimer);
  const rateWaitAbort = { settled: rateSettled, transport: delta(rateBefore) };

  let beforeRetryCount = 0;
  const beforeRetryEvents: string[] = [];
  let opensAtBeforeRetryStart: number | null = null;
  let opensAtBeforeRetryEnd: number | null = null;
  let onRetryCount = 0;
  const retryCallbackOrder: string[] = [];
  const retryController = new AbortController();
  const retryAbortListeners = new Set<EventListenerOrEventListenerObject>();
  const nativeRetrySignalAdd = retryController.signal.addEventListener.bind(retryController.signal);
  const nativeRetrySignalRemove = retryController.signal.removeEventListener.bind(retryController.signal);
  Object.defineProperty(retryController.signal, 'addEventListener', {
    configurable: true,
    value: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'abort' && listener !== null) retryAbortListeners.add(listener);
      return nativeRetrySignalAdd(type, listener, options);
    },
  });
  Object.defineProperty(retryController.signal, 'removeEventListener', {
    configurable: true,
    value: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'abort' && listener !== null) retryAbortListeners.delete(listener);
      return nativeRetrySignalRemove(type, listener, options);
    },
  });
  const retryBefore = snapshot();
  const retryVisibility = await new Promise<RetryVisibilityObservation>((resolveRetry) => {
    const events: string[] = [];
    const headerStatuses: number[] = [];
    const statusValues: number[] = [];
    const errorStatuses: Array<number | null> = [];
    let retryAttempts: number | null = null;
    const historyAttempts: Array<number | null> = [];
    const historyStatuses: Array<number | null> = [];
    let activeAbortListenersAtClose: number | null = null;
    let resolved = false;
    let facade: ReturnType<BrowserClientLike['stream']> | null = null;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveRetry({
        events: [...events],
        headerStatuses: [...headerStatuses],
        statusValues: [...statusValues],
        errorStatuses: [...errorStatuses],
        beforeRetryCount,
        beforeRetryEvents: [...beforeRetryEvents],
        opensAtBeforeRetryStart,
        opensAtBeforeRetryEnd,
        onRetryCount,
        callbackOrder: [...retryCallbackOrder],
        retryAttempts,
        historyAttempts: [...historyAttempts],
        historyStatuses: [...historyStatuses],
        nativeProgressCounts: [...retryNativeProgressCounts],
        activeAbortListenersAtClose,
        transport: delta(retryBefore),
        settledBy,
      });
    };
    try {
      facade = explicitClient.stream(absolute(paths.retry), {
        cache: false,
        signal: retryController.signal,
        retry: {
          maxRetries: 1,
          retryDelay: 0,
          statusCodes: [503],
          onRetry: () => {
            onRetryCount += 1;
            retryCallbackOrder.push('onRetry');
          },
        },
        hooks: {
          beforeRetry: [async () => {
            beforeRetryCount += 1;
            beforeRetryEvents.push('start');
            retryCallbackOrder.push('beforeRetry:start');
            opensAtBeforeRetryStart = counters.opens - retryBefore.opens;
            await new Promise<void>((resolveHook) => setTimeout(resolveHook, 20));
            opensAtBeforeRetryEnd = counters.opens - retryBefore.opens;
            beforeRetryEvents.push('end');
            retryCallbackOrder.push('beforeRetry:end');
          }],
        },
      });
      for (const eventName of ['initiated', 'start', 'cookies', 'end', 'finish', 'done', 'complete', 'close']) {
        facade.on(eventName, (event: unknown) => {
          events.push(eventName);
          if (eventName === 'finish') {
            const terminalConfig = objectField(event, 'config');
            retryAttempts = numberField(terminalConfig, 'retryAttempts');
            const errors = objectField(terminalConfig, 'errors');
            if (Array.isArray(errors)) {
              for (const entry of errors) {
                historyAttempts.push(numberField(entry, 'attempt'));
                historyStatuses.push(numberField(objectField(entry, 'error'), 'status'));
              }
            }
          }
          if (eventName === 'close') {
            activeAbortListenersAtClose = retryAbortListeners.size;
            retryController.abort();
            setTimeout(() => finish('close'), 60);
          }
          if (eventName === 'done') setTimeout(() => finish('done'), 100);
        });
      }
      facade.on('data', () => events.push('data'));
      facade.on('progress', () => events.push('progress'));
      facade.on('headers', (event: unknown) => {
        events.push('headers');
        const status = numberField(event, 'status');
        if (status !== null) headerStatuses.push(status);
      });
      facade.on('status', (status: unknown) => {
        events.push('status');
        if (typeof status === 'number') statusValues.push(status);
      });
      facade.on('error', (error: unknown) => {
        events.push('error');
        errorStatuses.push(numberField(objectField(error, 'response'), 'status'));
      });
    } catch (error) {
      events.push(`setup-error:${error instanceof Error ? error.message : String(error)}`);
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  const retryVetoBefore = snapshot();
  const retryVeto = await new Promise<RetryVetoObservation>((resolveVeto) => {
    const callbackOrder: string[] = [];
    const headerStatuses: number[] = [];
    const errorStatuses: Array<number | null> = [];
    let beforeRetryCount = 0;
    let onRetryCount = 0;
    let resolved = false;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveVeto({
        callbackOrder: [...callbackOrder],
        beforeRetryCount,
        onRetryCount,
        headerStatuses: [...headerStatuses],
        errorStatuses: [...errorStatuses],
        transport: delta(retryVetoBefore),
        settledBy,
      });
    };
    try {
      const facade = explicitClient.stream(absolute(paths.retryVeto), {
        cache: false,
        retry: {
          maxRetries: 1,
          retryDelay: 0,
          statusCodes: [503],
          onRetry: () => {
            onRetryCount += 1;
            callbackOrder.push('onRetry');
            return false;
          },
        },
        hooks: {
          beforeRetry: [() => {
            beforeRetryCount += 1;
            callbackOrder.push('beforeRetry');
          }],
        },
      });
      facade.on('headers', (event: unknown) => {
        const status = numberField(event, 'status');
        if (status !== null) headerStatuses.push(status);
      });
      facade.on('error', (error: unknown) => {
        errorStatuses.push(numberField(objectField(error, 'response'), 'status'));
        setTimeout(() => finish('error'), 100);
      });
      for (const eventName of ['done', 'close']) {
        facade.on(eventName, () => setTimeout(() => finish(eventName), 100));
      }
    } catch {
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  const truncationBefore = snapshot();
  const truncatedSettled = await settle(explicitClient.get(absolute(paths.truncated), {
    cache: false,
    responseType: 'arrayBuffer',
  }), 3_000);
  await new Promise<void>((resolveLateWindow) => setTimeout(resolveLateWindow, 200));
  const truncated = {
    settled: truncatedSettled,
    transport: delta(truncationBefore),
    nativeTerminalEvents: [...nativeTruncationEvents],
    unhandledReasons: [...unhandledReasons],
  };

  const observeEcho = async (caseName: string, body: unknown): Promise<BodyEchoObservation> => {
    const value = await withinPage(explicitClient.request({
      url: `${absolute(paths.echo)}?case=${encodeURIComponent(caseName)}`,
      method: 'POST',
      body,
      cache: false,
      responseType: 'json',
      headers: { 'content-type': 'application/octet-stream' },
    }), 3_000);
    const data = objectField(value, 'data');
    return {
      caseName,
      sentKind: sentBodyKinds.get(caseName)?.at(-1) ?? '<missing>',
      bodyHex: stringField(data, 'bodyHex') ?? '',
      bodyLength: numberField(data, 'bodyLength') ?? -1,
      contentType: stringField(data, 'contentType') ?? '',
    };
  };

  const falsyBodies = await Promise.all([
    observeEcho('falsy-zero', 0),
    observeEcho('falsy-false', false),
    observeEcho('falsy-empty', ''),
  ]);

  const typedBacking = new Uint8Array([0xaa, 0x00, 0x01, 0x02, 0xbb]);
  const typedViewBody = await observeEcho(
    'typed-view',
    new Uint8Array(typedBacking.buffer, 1, 3),
  );

  const nativeBlob = new Blob([new Uint8Array([0x00, 0xff, 0x01])], { type: 'application/octet-stream' });
  const nativeForm = new FormData();
  nativeForm.append('alpha', 'one');
  nativeForm.append('omega', 'two');
  const nativeBodyControls = [
    await observeEcho('native-blob', nativeBlob),
    await observeEcho('native-form', nativeForm),
    await observeEcho('native-arraybuffer', new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer),
  ];

  const observeBinary = async (value: unknown): Promise<BinaryObservation> => {
    const data = objectField(value, 'data');
    if (data instanceof Blob) {
      return { kind: 'Blob', bytes: Array.from(new Uint8Array(await data.arrayBuffer())) };
    }
    if (data instanceof ArrayBuffer) {
      return { kind: 'ArrayBuffer', bytes: Array.from(new Uint8Array(data)) };
    }
    if (ArrayBuffer.isView(data)) {
      return {
        kind: data.constructor.name,
        bytes: Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
      };
    }
    if (typeof data === 'string') {
      return { kind: 'string', bytes: Array.from(new TextEncoder().encode(data)) };
    }
    return { kind: data === null ? 'null' : typeof data, bytes: [] };
  };
  const explicitBinary = await observeBinary(await withinPage(explicitClient.get(absolute(paths.binary), {
    cache: false,
    responseType: 'arrayBuffer',
  }), 3_000));
  const autoBinary = await observeBinary(await withinPage(explicitClient.get(absolute(paths.binary), {
    cache: false,
    responseType: 'auto',
  }), 3_000));

  let abortHookCount = 0;
  let abortHookPayload: Record<string, unknown> | null = null;
  const abortHookEvents: string[] = [];
  const abortHookController = new AbortController();
  const abortHookTimer = setTimeout(() => abortHookController.abort(), 50);
  const abortHookSettled = await settle(explicitClient.get(absolute(paths.abortHook), {
    cache: false,
    signal: abortHookController.signal,
    timeout: 5_000,
    hooks: {
      onAbort: [(event: unknown) => {
        abortHookCount += 1;
        abortHookEvents.push('onAbort');
        abortHookPayload = {
          reason: stringField(event, 'reason'),
          url: stringField(event, 'url'),
          elapsed: numberField(event, 'elapsed'),
        };
      }],
    },
  }), 3_000);
  clearTimeout(abortHookTimer);
  const abortHook = {
    settled: abortHookSettled,
    events: [...abortHookEvents],
    hookCount: abortHookCount,
    hookPayload: abortHookPayload,
  };

  let timeoutHookCount = 0;
  let timeoutHookPayload: Record<string, unknown> | null = null;
  const timeoutHookEvents: string[] = [];
  const timeoutHookSettled = await settle(explicitClient.get(absolute(paths.timeoutHook), {
    cache: false,
    timeout: 80,
    hooks: {
      onTimeout: [(event: unknown) => {
        timeoutHookCount += 1;
        timeoutHookEvents.push('onTimeout');
        timeoutHookPayload = {
          type: stringField(event, 'type'),
          timeout: numberField(event, 'timeout'),
          elapsed: numberField(event, 'elapsed'),
          url: stringField(event, 'url'),
        };
      }],
    },
  }), 3_000);
  const timeoutHook = {
    settled: timeoutHookSettled,
    events: [...timeoutHookEvents],
    hookCount: timeoutHookCount,
    hookPayload: timeoutHookPayload,
  };

  let stagedHeadersHookCount = 0;
  let stagedHeadersHookPayload: Record<string, unknown> | null = null;
  const stagedHeadersEvents: string[] = [];
  const stagedHeadersBefore = snapshot();
  const stagedHeadersController = new AbortController();
  const stagedHeadersSettled = await settle(explicitClient.get(absolute(paths.stagedHeaders), {
    cache: false,
    signal: stagedHeadersController.signal,
    timeout: { headers: 120, total: 1_000 },
    hooks: {
      onTimeout: [(event: unknown) => {
        stagedHeadersHookCount += 1;
        stagedHeadersEvents.push('onTimeout');
        stagedHeadersHookPayload = {
          type: stringField(event, 'type'),
          timeout: numberField(event, 'timeout'),
          elapsed: numberField(event, 'elapsed'),
          url: stringField(event, 'url'),
        };
      }],
    },
  }), 750);
  if (stagedHeadersSettled.outcome === 'timeout') {
    stagedHeadersController.abort();
    await new Promise<void>((resolveCleanup) => setTimeout(resolveCleanup, 50));
  }
  const stagedHeaders = {
    settled: stagedHeadersSettled,
    events: [...stagedHeadersEvents],
    hookCount: stagedHeadersHookCount,
    hookPayload: stagedHeadersHookPayload,
    transport: delta(stagedHeadersBefore),
  };

  let stagedBodyHookCount = 0;
  let stagedBodyHookPayload: Record<string, unknown> | null = null;
  const stagedBodyEvents: string[] = [];
  const stagedBodyBefore = snapshot();
  const stagedBodySettled = await settle(explicitClient.get(absolute(paths.stagedBody), {
    cache: false,
    responseType: 'arrayBuffer',
    timeout: { body: 100, total: 300 },
    hooks: {
      onTimeout: [(event: unknown) => {
        stagedBodyHookCount += 1;
        stagedBodyEvents.push('onTimeout');
        stagedBodyHookPayload = {
          type: stringField(event, 'type'),
          timeout: numberField(event, 'timeout'),
          elapsed: numberField(event, 'elapsed'),
          url: stringField(event, 'url'),
        };
      }],
    },
  }), 1_000);
  const stagedBody = {
    settled: stagedBodySettled,
    events: [...stagedBodyEvents],
    hookCount: stagedBodyHookCount,
    hookPayload: stagedBodyHookPayload,
    transport: delta(stagedBodyBefore),
  };

  const hookFailureEvents: string[] = [];
  let beforeErrorCount = 0;
  let hookFailureCauseMessage: string | null = null;
  const hookFailureClient = explicitFactory.create({
    hooks: {
      afterHeaders: [() => {
        hookFailureEvents.push('afterHeaders');
        throw new Error('afterHeaders boom');
      }],
      beforeError: [(error: unknown) => {
        beforeErrorCount += 1;
        hookFailureEvents.push('beforeError');
        return error;
      }],
    },
  });
  const hookFailurePromise = hookFailureClient.get(absolute(paths.hookFailure), { cache: false }).catch((error: unknown) => {
    hookFailureCauseMessage = stringField(objectField(error, 'cause'), 'message');
    throw error;
  });
  const hookFailureSettled = await settle(hookFailurePromise, 3_000);
  const hookFailure = {
    settled: hookFailureSettled,
    events: [...hookFailureEvents],
    beforeErrorCount,
    causeMessage: hookFailureCauseMessage,
  };

  const afterParseFailureEvents: string[] = [];
  let afterParseBeforeErrorCount = 0;
  let afterParseFailureCauseMessage: string | null = null;
  const afterParseFailureClient = explicitFactory.create({
    hooks: {
      afterHeaders: [() => { afterParseFailureEvents.push('afterHeaders'); }],
      afterParse: [() => {
        afterParseFailureEvents.push('afterParse');
        throw new Error('afterParse boom');
      }],
      beforeError: [(error: unknown) => {
        afterParseBeforeErrorCount += 1;
        afterParseFailureEvents.push('beforeError');
        return error;
      }],
    },
  });
  const afterParseFailurePromise = afterParseFailureClient.get(
    absolute(paths.afterParseFailure),
    { cache: false },
  ).catch((error: unknown) => {
    afterParseFailureCauseMessage = stringField(objectField(error, 'cause'), 'message');
    throw error;
  });
  const afterParseFailureSettled = await settle(afterParseFailurePromise, 3_000);
  const afterParseFailure = {
    settled: afterParseFailureSettled,
    events: [...afterParseFailureEvents],
    beforeErrorCount: afterParseBeforeErrorCount,
    causeMessage: afterParseFailureCauseMessage,
  };

  const observeHookInterrupt = async (
    phase: 'afterHeaders' | 'afterParse',
    owner: 'caller' | 'total',
  ): Promise<HookInterruptObservation> => {
    const controller = new AbortController();
    let hookStarted = 0;
    let hookSettled = 0;
    let beforeErrorCount = 0;
    let onAbortCount = 0;
    let onTimeoutCount = 0;
    const pendingHook = async (): Promise<void> => {
      hookStarted += 1;
      if (owner === 'caller') setTimeout(() => controller.abort(), 20);
      await new Promise<void>((resolveHook) => setTimeout(resolveHook, 250));
      hookSettled += 1;
    };
    const hooks: Record<string, unknown> = {
      beforeError: [(error: unknown) => {
        beforeErrorCount += 1;
        return error;
      }],
      onAbort: [() => { onAbortCount += 1; }],
      onTimeout: [() => { onTimeoutCount += 1; }],
      [phase]: [pendingHook],
    };
    const before = snapshot();
    const settled = await settle(explicitClient.get(absolute(paths.hookInterrupt), {
      cache: false,
      signal: controller.signal,
      timeout: owner === 'total' ? 80 : 1_000,
      hooks,
    }), 1_000);
    await new Promise<void>((resolveLateHook) => setTimeout(resolveLateHook, 300));
    return {
      phase,
      owner,
      settled,
      transport: delta(before),
      hookStarted,
      hookSettled,
      beforeErrorCount,
      onAbortCount,
      onTimeoutCount,
    };
  };
  const hookInterrupt = [
    await observeHookInterrupt('afterHeaders', 'caller'),
    await observeHookInterrupt('afterParse', 'caller'),
    await observeHookInterrupt('afterHeaders', 'total'),
    await observeHookInterrupt('afterParse', 'total'),
  ];

  const observeFacadeError = async (
    path: string,
    retry?: Record<string, unknown>,
  ): Promise<FacadeErrorObservation> => {
    const before = snapshot();
    const events: string[] = [];
    const headerStatuses: number[] = [];
    const errorStatuses: Array<number | null> = [];
    const sentinel = Object.assign(new Error(`facade sentinel for ${path}`), { code: 'XB_FACADE_SENTINEL' });
    let beforeErrorCount = 0;
    let emittedIsSentinel = false;
    let emittedCode: string | null = null;
    let resolved = false;
    return new Promise<FacadeErrorObservation>((resolveFacade) => {
      const finish = (settledBy: string) => {
        if (resolved) return;
        resolved = true;
        resolveFacade({
          events: [...events],
          beforeErrorCount,
          emittedIsSentinel,
          emittedCode,
          headerStatuses: [...headerStatuses],
          errorStatuses: [...errorStatuses],
          transport: delta(before),
          settledBy,
        });
      };
      try {
        const facade = explicitClient.stream(absolute(path), {
          cache: false,
          responseType: 'json',
          ...(retry === undefined ? {} : { retry }),
          hooks: {
            beforeError: [async () => {
              beforeErrorCount += 1;
              events.push('beforeError:start');
              await new Promise<void>((resolveHook) => setTimeout(resolveHook, 20));
              events.push('beforeError:end');
              return sentinel;
            }],
          },
        });
        facade.on('headers', (event: unknown) => {
          events.push('headers');
          const status = numberField(event, 'status');
          if (status !== null) headerStatuses.push(status);
        });
        facade.on('status', () => events.push('status'));
        for (const eventName of ['finish', 'done', 'complete', 'close']) {
          facade.on(eventName, () => {
            events.push(eventName);
            if (eventName === 'close') setTimeout(() => finish('close'), 100);
            if (eventName === 'done') setTimeout(() => finish('done'), 250);
          });
        }
        facade.on('error', (error: unknown) => {
          events.push('error');
          emittedIsSentinel = error === sentinel;
          emittedCode = stringField(error, 'code');
          errorStatuses.push(numberField(objectField(error, 'response'), 'status'));
          setTimeout(() => finish('error'), 100);
        });
      } catch {
        events.push('setup-error');
        finish('setup-error');
      }
      setTimeout(() => finish('timeout'), 2_000);
    });
  };

  const facadeHttpError = await observeFacadeError(paths.facadeHttpError);
  const facadeRetryOwnership = [
    {
      caseName: 'recover' as const,
      ...await observeFacadeError(paths.facadeRetryRecover, {
        maxRetries: 1,
        retryDelay: 0,
        condition: () => true,
      }),
    },
    {
      caseName: 'exhaust' as const,
      ...await observeFacadeError(paths.facadeRetryExhaust, {
        maxRetries: 1,
        retryDelay: 0,
        condition: () => true,
      }),
    },
  ];

  let retryTimeoutHookCount = 0;
  const retryTimeoutBefore = snapshot();
  const retryTimeoutSettled = await settle(explicitClient.get(absolute(paths.retryDelay), {
    cache: false,
    timeout: 120,
    retry: { maxRetries: 1, retryDelay: 2_000, statusCodes: [503] },
    hooks: { onTimeout: [() => { retryTimeoutHookCount += 1; }] },
  }), 3_000);
  const retryTotalTimeout = {
    settled: retryTimeoutSettled,
    transport: delta(retryTimeoutBefore),
    onTimeoutCount: retryTimeoutHookCount,
  };

  const observeRetryStageTotalTimeout = async (
    caseName: 'condition' | 'beforeRetry' | 'onRetry',
  ): Promise<DeadlineStageObservation> => {
    let stageStarted = 0;
    let stageSettled = 0;
    let onTimeoutCount = 0;
    const pendingStage = async (result: unknown): Promise<unknown> => {
      stageStarted += 1;
      await new Promise<void>((resolveStage) => setTimeout(resolveStage, 250));
      stageSettled += 1;
      return result;
    };
    const retry: Record<string, unknown> = {
      maxRetries: 1,
      retryDelay: 0,
      statusCodes: [503],
    };
    const hooks: Record<string, unknown> = {
      onTimeout: [() => { onTimeoutCount += 1; }],
    };
    if (caseName === 'condition') retry.condition = () => pendingStage(true);
    if (caseName === 'beforeRetry') hooks.beforeRetry = [() => pendingStage(undefined)];
    if (caseName === 'onRetry') retry.onRetry = () => pendingStage(undefined);

    const before = snapshot();
    const settled = await settle(explicitClient.get(absolute(paths.retryStageTimeout), {
      cache: false,
      timeout: 80,
      retry,
      hooks,
    }), 1_000);
    await new Promise<void>((resolveLateStage) => setTimeout(resolveLateStage, 300));
    return {
      caseName,
      settled,
      transport: delta(before),
      stageStarted,
      stageSettled,
      onTimeoutCount,
    };
  };
  const retryStageTotalTimeout = [
    await observeRetryStageTotalTimeout('condition'),
    await observeRetryStageTotalTimeout('beforeRetry'),
    await observeRetryStageTotalTimeout('onRetry'),
  ];

  const observeRateTotalTimeout = async (
    caseName: 'hook' | 'sleep',
  ): Promise<DeadlineStageObservation> => {
    let stageStarted = 0;
    let stageSettled = 0;
    let onTimeoutCount = 0;
    const hooks: Record<string, unknown> = {
      onTimeout: [() => { onTimeoutCount += 1; }],
    };
    if (caseName === 'hook') {
      hooks.onRateLimitWait = [async () => {
        stageStarted += 1;
        await new Promise<void>((resolveStage) => setTimeout(resolveStage, 300));
        stageSettled += 1;
      }];
    }

    const before = snapshot();
    const settled = await settle(explicitClient.get(absolute(paths.rateTotal), {
      cache: false,
      timeout: 80,
      waitOnStatus: [429],
      maxWaitAttempts: 1,
      maxWaitTime: 1_000,
      defaultWaitTime: 300,
      hooks,
    }), 1_000);
    await new Promise<void>((resolveLateStage) => setTimeout(resolveLateStage, 350));
    return {
      caseName,
      settled,
      transport: delta(before),
      stageStarted,
      stageSettled,
      onTimeoutCount,
    };
  };
  const rateTotalTimeout = [
    await observeRateTotalTimeout('hook'),
    await observeRateTotalTimeout('sleep'),
  ];

  document.cookie = 'xhr_outbound=one; Path=/; SameSite=Lax';
  const cookieValue = await withinPage(explicitClient.get(absolute(paths.cookieTruth), { cache: false }), 3_000);
  const cookieData = objectField(cookieValue, 'data');
  const cookieCollection = objectField(cookieValue, 'cookies');
  const cookieArray = objectField(cookieCollection, 'array');
  const cookieTruth = {
    outboundCookie: stringField(cookieData, 'outboundCookie') ?? '',
    responseCookieNames: Array.isArray(cookieArray)
      ? cookieArray.map((cookie) => stringField(cookie, 'key') ?? '<missing>')
      : [],
    responseCookieString: stringField(cookieCollection, 'string') ?? '',
  };
  document.cookie = 'xhr_outbound=; Path=/; Max-Age=0; SameSite=Lax';

  const cookieRefusalBefore = snapshot();
  const cookieRefusalSettled = await settle(explicitClient.request({
    url: absolute(paths.cookieRefusal),
    method: 'GET',
    cache: false,
    headers: { Cookie: 'manual=1' },
  }), 3_000);
  const cookieRefusal = {
    settled: cookieRefusalSettled,
    transport: delta(cookieRefusalBefore),
  };

  const connectRefusalBefore = snapshot();
  const connectRefusalClient = explicitFactory.create({});
  const connectRefusalSettled = await settle(connectRefusalClient.get(absolute(paths.connectRefusal), {
    cache: false,
    timeout: { connect: 100, total: 1_000 },
  }), 1_000);
  const connectRefusal = {
    settled: connectRefusalSettled,
    transport: delta(connectRefusalBefore),
  };

  const redirectClient = explicitFactory.create({});
  const redirectBefore = snapshot();
  const redirectedValue = await withinPage(redirectClient.get(absolute(paths.redirectStart), {
    cache: false,
    responseType: 'json',
  }), 3_000);
  const redirectedConfig = objectField(redirectedValue, 'config');
  const redirectedUrls = objectField(redirectedValue, 'urls');
  const redirectTransport = delta(redirectBefore);
  const redirectRefusalBefore = snapshot();
  const redirectRefusal = await settle(redirectClient.get(absolute(paths.redirectStart), {
    cache: false,
    onRedirect: () => true,
  }), 1_000);
  const redirectMetadata: RedirectMetadataObservation = {
    finalUrl: stringField(redirectedValue, 'finalUrl'),
    urls: Array.isArray(redirectedUrls)
      ? redirectedUrls.filter((entry): entry is string => typeof entry === 'string')
      : [],
    configFinalUrl: stringField(redirectedConfig, 'finalUrl'),
    adapterUsed: stringField(redirectedConfig, 'adapterUsed'),
    transport: redirectTransport,
    refusal: redirectRefusal,
    refusalTransport: delta(redirectRefusalBefore),
  };

  const downloadBefore = snapshot();
  const downloadRefusal = await new Promise<FacadeRefusalObservation>((resolveDownload) => {
    const events: string[] = [];
    const errorCodes: Array<string | null> = [];
    let facade: BrowserFacadeLike | null = null;
    let resolved = false;
    const finish = (settledBy: string) => {
      if (resolved) return;
      resolved = true;
      resolveDownload({
        events: [...events],
        errorCodes: [...errorCodes],
        isFinished: typeof facade?.isFinished === 'function' ? facade.isFinished() : null,
        settledBy,
        transport: delta(downloadBefore),
      });
    };
    try {
      facade = explicitClient.download(absolute(paths.downloadRefusal), 'browser-path.bin', { cache: false });
      for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'finish', 'done', 'complete']) {
        facade.on(eventName, () => {
          events.push(eventName);
          if (eventName === 'done') setTimeout(() => finish('done'), 80);
        });
      }
      facade.on('error', (error: unknown) => {
        events.push('error');
        errorCodes.push(stringField(error, 'code'));
        setTimeout(() => finish('error'), 30);
      });
    } catch (error) {
      events.push('setup-error');
      errorCodes.push(stringField(error, 'code'));
      finish('setup-error');
    }
    setTimeout(() => finish('timeout'), 2_000);
  });

  await new Promise<void>((resolveFinalLateWindow) => setTimeout(resolveFinalLateWindow, 350));
  return {
    explicitHref: location.href,
    explicitExports: Object.keys(Object(explicitModule)).sort(),
    explicitDispatch,
    explicitMalformedJson,
    inferredMalformedJson,
    hooks,
    stream,
    uploadLifecycle,
    truncatedStream,
    progress,
    abort,
    rateWaitAbort,
    retryVisibility,
    retryVeto,
    truncated,
    falsyBodies,
    typedViewBody,
    nativeBodyControls,
    explicitBinary,
    autoBinary,
    abortHook,
    timeoutHook,
    hookFailure,
    afterParseFailure,
    hookInterrupt,
    facadeHttpError,
    facadeRetryOwnership,
    stagedHeaders,
    stagedBody,
    retryTotalTimeout,
    retryStageTotalTimeout,
    rateTotalTimeout,
    cookieTruth,
    downloadRefusal,
    cookieRefusal,
    connectRefusal,
    redirectMetadata,
    finalUnhandledReasons: [...unhandledReasons],
  };
}

async function observePlatformInChrome(paths: typeof PATHS): Promise<PlatformBrowserObservation> {
  const field = (value: unknown, name: string): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    return Reflect.get(value, name);
  };
  const numberField = (value: unknown, name: string): number | null => {
    const candidate = field(value, name);
    return typeof candidate === 'number' ? candidate : null;
  };
  const counters = { opens: 0, sends: 0, aborts: 0, fetches: 0 };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeAbort = XMLHttpRequest.prototype.abort;
  XMLHttpRequest.prototype.open = function platformOpen(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['open']>) {
    counters.opens += 1;
    return Reflect.apply(nativeOpen, this, args);
  } as XMLHttpRequest['open'];
  XMLHttpRequest.prototype.send = function platformSend(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
    counters.sends += 1;
    return Reflect.apply(nativeSend, this, args);
  } as XMLHttpRequest['send'];
  XMLHttpRequest.prototype.abort = function platformAbort(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['abort']>) {
    counters.aborts += 1;
    return Reflect.apply(nativeAbort, this, args);
  } as XMLHttpRequest['abort'];
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    counters.fetches += 1;
    return nativeFetch(...args);
  }) as typeof fetch;

  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  const platformModule = await dynamicImport(paths.browserBundle);
  const platformClient = field(platformModule, 'default') as BrowserClientLike;
  if (typeof platformClient?.get !== 'function') throw new Error('platform bundle default export lacks get');
  const started = performance.now();
  let settled: SettledObservation;
  try {
    const response = await platformClient.get(paths.ok, { cache: false });
    settled = {
      outcome: 'fulfilled',
      status: numberField(response, 'status'),
      code: null,
      errno: null,
      message: null,
      data: field(response, 'data') ?? null,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    settled = {
      outcome: 'rejected',
      status: numberField(field(error, 'response'), 'status'),
      code: typeof field(error, 'code') === 'string' ? field(error, 'code') as string : null,
      errno: numberField(error, 'errno'),
      message: error instanceof Error ? error.message : String(error),
      data: null,
      elapsedMs: performance.now() - started,
    };
  }
  return {
    platformHref: location.href,
    platformExports: Object.keys(Object(platformModule)).sort(),
    browserDispatch: { settled, transport: counters },
  };
}

async function observeWithoutXhrInChrome(paths: typeof PATHS): Promise<NoXhrObservation> {
  let fetches = 0;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetches += 1;
    return nativeFetch(...args);
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    value: undefined,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  try {
    const moduleValue = await dynamicImport(paths.xhrBundle);
    const factory = Reflect.get(Object(moduleValue), 'default') as BrowserClientLike;
    if (typeof factory?.create !== 'function') throw new Error('explicit bundle default export lacks create');
    const client = factory.create({});
    await client.get(new URL(paths.noXhr, location.href).href, { cache: false });
    return { outcome: 'fulfilled', message: null, code: null, errno: null, fetches };
  } catch (error) {
    return {
      outcome: 'rejected',
      message: error instanceof Error ? error.message : String(error),
      code: typeof Reflect.get(Object(error), 'code') === 'string' ? Reflect.get(Object(error), 'code') as string : null,
      errno: typeof Reflect.get(Object(error), 'errno') === 'number' ? Reflect.get(Object(error), 'errno') as number : null,
      fetches,
    };
  }
}

// ---------------------------------------------------------------- harness --

interface HarnessState {
  xhrBundle: BundleObservation | null;
  browserBundle: BundleObservation | null;
  server: http.Server | null;
  browser: Browser | null;
  chromeVersion: string | null;
  chromeExecutable: string | null;
  chromeRootPid: number | null;
  chromeTreePids: number[];
  forcedKillPids: number[];
  lingeringPids: number[];
  hits: Record<string, number>;
  observation: BrowserObservation | null;
  pageErrors: string[];
  consoleErrors: string[];
  setupError: string | null;
  teardownErrors: string[];
}

const state: HarnessState = {
  xhrBundle: null,
  browserBundle: null,
  server: null,
  browser: null,
  chromeVersion: null,
  chromeExecutable: null,
  chromeRootPid: null,
  chromeTreePids: [],
  forcedKillPids: [],
  lingeringPids: [],
  hits: {},
  observation: null,
  pageErrors: [],
  consoleErrors: [],
  setupError: null,
  teardownErrors: [],
};

function startFixtureServer(): Promise<number> {
  const xhrText = state.xhrBundle?.text ?? 'throw new Error("xhr bundle absent")';
  const browserText = state.browserBundle?.text ?? 'throw new Error("browser bundle absent")';
  const server = http.createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    state.hits[path] = (state.hits[path] ?? 0) + 1;
    if (path === PATHS.page) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(PAGE_HTML);
      return;
    }
    if (path === PATHS.xhrBundle || path === PATHS.browserBundle) {
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      response.end(path === PATHS.xhrBundle ? xhrText : browserText);
      return;
    }
    if (path === PATHS.ok) {
      const body = Buffer.from('{"ok":true}', 'utf8');
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (path === PATHS.badJson) {
      const body = Buffer.from('{"broken":', 'utf8');
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (path === PATHS.stream) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(FIXTURE_BYTES.length), 'cache-control': 'no-store' });
      response.end(FIXTURE_BYTES);
      return;
    }
    if (path === PATHS.progress) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(PROGRESS_BYTES.length), 'cache-control': 'no-store' });
      response.write(PROGRESS_BYTES.subarray(0, PROGRESS_BYTES.length / 2));
      setTimeout(() => response.end(PROGRESS_BYTES.subarray(PROGRESS_BYTES.length / 2)), 30);
      return;
    }
    if (path === PATHS.hold
      || path === PATHS.abortHook
      || path === PATHS.timeoutHook
      || path === PATHS.stagedHeaders) {
      request.once('close', () => {
        if (!response.writableEnded) response.destroy();
      });
      return;
    }
    if (path === PATHS.stagedBody) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(FIXTURE_BYTES.length + 4_096),
        'cache-control': 'no-store',
      });
      response.write(FIXTURE_BYTES.subarray(0, Math.max(1, Math.floor(FIXTURE_BYTES.length / 2))));
      request.once('close', () => {
        if (!response.writableEnded) response.destroy();
      });
      return;
    }
    if (path === PATHS.rate) {
      const body = Buffer.from('{"retry":true}', 'utf8');
      response.writeHead(429, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'retry-after': '2',
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.rateTotal) {
      const body = Buffer.from('{"retry":true}', 'utf8');
      response.writeHead(429, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.retry) {
      const retryHit = state.hits[path] ?? 0;
      const status = retryHit === 1 ? 503 : 200;
      const body = Buffer.from(status === 503 ? '{"retry":true}' : '{"ok":true}', 'utf8');
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.retryVeto || path === PATHS.facadeHttpError) {
      const body = Buffer.from('{"retry":true}', 'utf8');
      response.writeHead(503, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.facadeRetryRecover || path === PATHS.facadeRetryExhaust) {
      const recover = path === PATHS.facadeRetryRecover && state.hits[path] === 2;
      const body = Buffer.from(recover ? '{"ok":true}' : '{"broken":', 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.retryDelay) {
      const retryHit = state.hits[path] ?? 0;
      const status = retryHit === 1 ? 503 : 200;
      const body = Buffer.from(status === 503 ? '{"retry":true}' : '{"ok":true}', 'utf8');
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.retryStageTimeout) {
      const body = Buffer.from('{"retry":true}', 'utf8');
      response.writeHead(503, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.truncated || path === PATHS.truncatedStream) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(FIXTURE_BYTES.length + 4_096),
        'cache-control': 'no-store',
      });
      response.write(FIXTURE_BYTES.subarray(0, Math.max(1, Math.floor(FIXTURE_BYTES.length / 2))));
      setTimeout(() => response.destroy(), 20);
      return;
    }
    if (path === PATHS.echo || path === PATHS.upload) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const received = Buffer.concat(chunks);
        const body = Buffer.from(JSON.stringify({
          bodyHex: received.toString('hex'),
          bodyLength: received.length,
          contentType: request.headers['content-type'] ?? '',
        }), 'utf8');
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(body.length),
          'cache-control': 'no-store',
        });
        response.end(body);
      });
      return;
    }
    if (path === PATHS.binary) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(ALL_BYTES.length),
        'cache-control': 'no-store',
      });
      response.end(ALL_BYTES);
      return;
    }
    if (path === PATHS.hookFailure || path === PATHS.afterParseFailure || path === PATHS.hookInterrupt) {
      const body = Buffer.from('{"ok":true}', 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.cookieTruth) {
      const body = Buffer.from(JSON.stringify({ outboundCookie: request.headers.cookie ?? '' }), 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.cookieRefusal) {
      const body = Buffer.from(JSON.stringify({ inboundCookie: request.headers.cookie ?? '' }), 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.downloadRefusal) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(FIXTURE_BYTES.length),
        'cache-control': 'no-store',
      });
      response.end(FIXTURE_BYTES);
      return;
    }
    if (path === PATHS.connectRefusal) {
      const body = Buffer.from('{"ok":true}', 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (path === PATHS.redirectStart) {
      response.writeHead(302, {
        location: PATHS.redirectFinal,
        'cache-control': 'no-store',
      });
      response.end();
      return;
    }
    if (path === PATHS.redirectFinal) {
      const body = Buffer.from('{"redirected":true}', 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      });
      response.end(body);
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
  }), 3_000, 'fixture server listen');
}

async function closeServer(): Promise<void> {
  const server = state.server;
  if (server === null) return;
  state.server = null;
  server.closeAllConnections();
  await within(new Promise<void>((resolveClose) => server.close(() => resolveClose())), 5_000, 'fixture server close');
}

function processTable(): Array<{ pid: number; ppid: number }> {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]) }];
  });
}

function processTree(rootPid: number): number[] {
  const table = processTable();
  const children = new Map<number, number[]>();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const found: number[] = [];
  const visit = (pid: number) => {
    if (found.includes(pid)) return;
    found.push(pid);
    for (const child of children.get(pid) ?? []) visit(child);
  };
  visit(rootPid);
  return found;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidsGone(pids: readonly number[], milliseconds: number): Promise<number[]> {
  const deadline = Date.now() + milliseconds;
  let alive = pids.filter(pidAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
    alive = pids.filter(pidAlive);
  }
  return alive;
}

async function launchChrome(): Promise<Browser> {
  const attempts = ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const browser = await within(puppeteer.launch({
        headless: true,
        executablePath: PINNED_CHROME_EXECUTABLE,
        args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
      }), 15_000, `Chrome launch ${attempt}`);
      state.chromeExecutable = PINNED_CHROME_EXECUTABLE;
      return browser;
    } catch (error) {
      failures.push(`${attempt}:${describeError(error)}`);
    }
  }
  throw new InfrastructureError(`all Chrome launches failed: ${failures.join(' | ')}`);
}

async function closeBrowser(): Promise<void> {
  const browser = state.browser;
  if (browser === null) return;
  state.browser = null;
  const rootPid = browser.process()?.pid ?? null;
  if (rootPid !== null) {
    state.chromeRootPid = rootPid;
    state.chromeTreePids = processTree(rootPid);
  }
  try {
    await within(browser.close(), 10_000, 'Chrome close');
  } catch (error) {
    state.teardownErrors.push(describeError(error));
  }
  let alive = await waitForPidsGone(state.chromeTreePids, 3_000);
  if (alive.length > 0) {
    state.forcedKillPids = [...alive];
    for (const pid of [...alive].reverse()) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    alive = await waitForPidsGone(alive, 1_000);
    for (const pid of [...alive].reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    alive = await waitForPidsGone(alive, 1_000);
  }
  state.lingeringPids = alive;
  if (alive.length > 0) state.teardownErrors.push(`Chrome PIDs still alive: ${alive.join(',')}`);
}

function isConsoleMessage(value: unknown): value is ConsoleMessage {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; text?: unknown };
  return typeof candidate.type === 'function' && typeof candidate.text === 'function';
}

function attachPageLedgers(page: Page): void {
  page.on('pageerror', (error: unknown) => state.pageErrors.push(describeError(error)));
  page.on('console', (message: unknown) => {
    if (isConsoleMessage(message) && message.type() === 'error') state.consoleErrors.push(message.text());
  });
}

async function inFreshPage<T>(
  browser: Browser,
  port: number,
  label: string,
  probe: (page: Page) => Promise<T>,
): Promise<T> {
  let context: BrowserContext | null = null;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    attachPageLedgers(page);
    await within(
      page.goto(`http://127.0.0.1:${port}${PATHS.page}?probe=${encodeURIComponent(label)}`, { waitUntil: 'load' }),
      15_000,
      `${label} navigation`,
    );
    return await probe(page);
  } finally {
    if (context !== null) await within(context.close(), 5_000, `${label} context close`);
  }
}

beforeAll(async () => {
  try {
    state.xhrBundle = await bundle('xhr-entry');
    state.browserBundle = await bundle('browser-platform');
    const port = await startFixtureServer();
    const browser = await launchChrome();
    state.browser = browser;
    state.chromeVersion = await browser.version();
    if (state.chromeVersion !== PINNED_CHROME_VERSION) {
      throw new InfrastructureError(`Chrome version actual ${state.chromeVersion} expected ${PINNED_CHROME_VERSION}`);
    }
    const explicit = await inFreshPage(browser, port, 'explicit', (page) => within(
      page.evaluate(observeExplicitInChrome, PATHS),
      20_000,
      'explicit XHR observation',
    ));
    const platform = await inFreshPage(browser, port, 'platform', (page) => within(
      page.evaluate(observePlatformInChrome, PATHS),
      10_000,
      'browser platform observation',
    ));
    const explicitAbsence = await inFreshPage(browser, port, 'no-xhr', (page) => within(
      page.evaluate(observeWithoutXhrInChrome, PATHS),
      10_000,
      'no-XHR observation',
    ));
    state.observation = { ...explicit, ...platform, explicitAbsence };
  } catch (error) {
    state.setupError = describeError(error);
  } finally {
    await closeBrowser();
    await closeServer();
  }
}, 60_000);

// ------------------------------------------------------------------ rows --

const passed = new Set<string>();
const failed = new Set<string>();

function carrier(name: string, body: () => void | Promise<void>): void {
  it(name, async () => {
    try {
      await body();
      passed.add(name);
    } catch (error) {
      failed.add(name);
      throw error;
    }
  }, 60_000);
}

function requireObservation(row: string): BrowserObservation {
  if (state.setupError !== null) throw new Error(`${row}: ${state.setupError}`);
  if (state.observation === null) throw new Error(`${row}: no Chrome observation`);
  return state.observation;
}

function assertBundleBasics(bundleObservation: BundleObservation | null, entry: string): BundleObservation {
  if (bundleObservation === null) throw new Error(`${entry} bundle absent`);
  expect(bundleObservation.errors).toEqual([]);
  expect(bundleObservation.warnings).toEqual([]);
  expect(bundleObservation.rejected).toEqual([]);
  expect(bundleObservation.inputs.some((input) => input.startsWith('node:'))).toBe(false);
  expect(bundleObservation.inputs.includes(entry)).toBe(true);
  expect(bundleObservation.bytes).toBeGreaterThan(0);
  return bundleObservation;
}

carrier(TEST_NAMES.explicitBundle, () => {
  const observed = assertBundleBasics(state.xhrBundle, XHR_ENTRY_SOURCE);
  expect(observed.inputs.includes(XHR_ADAPTER_SOURCE)).toBe(true);
  expect(observed.inputs.includes(FETCH_ADAPTER_SOURCE)).toBe(false);
});

carrier(TEST_NAMES.browserBundle, () => {
  const observed = assertBundleBasics(state.browserBundle, BROWSER_PLATFORM_SOURCE);
  expect(observed.inputs.includes(XHR_ADAPTER_SOURCE)).toBe(true);
  expect(observed.inputs.includes(FETCH_ADAPTER_SOURCE)).toBe(false);
});

carrier(TEST_NAMES.explicitDispatch, () => {
  const observed = requireObservation('XB-C1').explicitDispatch;
  expect(observed.settled.outcome).toBe('fulfilled');
  expect(observed.settled.status).toBe(200);
  expect(observed.settled.data).toEqual({ ok: true });
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
});

carrier(TEST_NAMES.explicitAbsence, () => {
  const observed = requireObservation('XB-C2').explicitAbsence;
  expect(observed.outcome).toBe('rejected');
  expect(observed.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observed.errno).toBe(-1075);
  expect(observed.message).toContain('XMLHttpRequest is not available');
  expect(observed.fetches).toBe(0);
  expect(state.hits[PATHS.noXhr]).toBeUndefined();
});

carrier(TEST_NAMES.browserDispatch, () => {
  const observed = requireObservation('XB-D1').browserDispatch;
  expect(observed.settled.outcome).toBe('fulfilled');
  expect(observed.settled.status).toBe(200);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
});

function assertInvalidJson(observed: SettledObservation): void {
  expect(observed.outcome).toBe('rejected');
  expect(observed.code).toBe('REZ_INVALID_JSON');
  expect(observed.errno).toBe(-1064);
  expect(observed.status).toBe(200);
}

carrier(TEST_NAMES.explicitMalformedJson, () => {
  assertInvalidJson(requireObservation('XB-J1').explicitMalformedJson);
});

carrier(TEST_NAMES.inferredMalformedJson, () => {
  assertInvalidJson(requireObservation('XB-J2').inferredMalformedJson);
});

carrier(TEST_NAMES.hooks, () => {
  const observed = requireObservation('XB-H1').hooks;
  expect(observed.settled.outcome).toBe('fulfilled');
  expect(observed.events).toEqual(['afterHeaders:start', 'afterHeaders:end', 'afterParse:start', 'afterParse:end']);
  expect(observed.transformed).toBe(true);
});

carrier(TEST_NAMES.stream, () => {
  const observed = requireObservation('XB-L1').stream;
  expect(observed.dataCount).toBe(1);
  expect(observed.dataBytes).toBe(FIXTURE_BYTES.length);
  expect(observed.errorCount).toBe(0);
  expect(observed.events).toEqual(['initiated', 'start', 'headers', 'status', 'cookies', 'data', 'end', 'finish', 'done', 'complete', 'close']);
  expect(observed.isFinished).toBe(true);
  expect(observed.settledBy).toBe('close');
});

carrier(TEST_NAMES.uploadLifecycle, () => {
  const observed = requireObservation('XB-L2').uploadLifecycle;
  for (const eventName of ['initiated', 'start', 'headers', 'status', 'cookies', 'finish', 'done', 'complete']) {
    expect(observed.events.filter((event) => event === eventName)).toHaveLength(1);
  }
  expect(observed.events.filter((event) => event === 'error')).toHaveLength(0);
  expect(observed.events.filter((event) => event !== 'progress')).toEqual([
    'initiated',
    'start',
    'headers',
    'status',
    'cookies',
    'finish',
    'done',
    'complete',
  ]);
  const firstProgress = observed.events.indexOf('progress');
  expect(firstProgress).toBeGreaterThan(observed.events.indexOf('start'));
  expect(firstProgress).toBeLessThan(observed.events.indexOf('headers'));
  expect(observed.errorCodes).toEqual([]);
  expect(observed.facadeProgressCount).toBeGreaterThan(0);
  expect(observed.optionProgressCount).toBeGreaterThan(0);
  expect(observed.isFinished).toBe(true);
  expect(observed.settledBy).toBe('done');
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.upload]).toBe(1);
});

carrier(TEST_NAMES.truncatedStream, () => {
  const observed = requireObservation('XB-L3').truncatedStream;
  expect(observed.events.filter((event) => event === 'error')).toHaveLength(1);
  for (const eventName of ['data', 'end', 'finish', 'done', 'complete', 'close']) {
    expect(observed.events.filter((event) => event === eventName)).toHaveLength(0);
  }
  expect(observed.errorCodes).toEqual(['ERR_STREAM_PREMATURE_CLOSE']);
  expect(observed.errorErrnos).toEqual([-1011]);
  expect(observed.isFinished).toBe(false);
  expect(observed.settledBy).toBe('error');
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.truncatedStream]).toBe(1);
});

carrier(TEST_NAMES.progress, () => {
  const observed = requireObservation('XB-O1').progress;
  expect(observed.settled.outcome).toBe('fulfilled');
  expect(observed.settled.status).toBe(200);
  expect(observed.callbackCount).toBeGreaterThan(0);
  expect(observed.lastLoaded).toBe(PROGRESS_BYTES.length);
});

carrier(TEST_NAMES.abort, () => {
  const observed = requireObservation('XB-R1').abort;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ABORT_ERR');
  expect(observed.settled.errno).toBe(-1025);
  expect(observed.settled.elapsedMs).toBeLessThan(750);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 1, fetches: 0 });
});

carrier(TEST_NAMES.rateWaitAbort, () => {
  const observed = requireObservation('XB-R2').rateWaitAbort;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ABORT_ERR');
  expect(observed.settled.errno).toBe(-1025);
  expect(observed.settled.elapsedMs).toBeLessThan(750);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.rate]).toBe(1);
});

carrier(TEST_NAMES.retryVisibility, () => {
  const observed = requireObservation('XB-R3').retryVisibility;
  expect(observed.beforeRetryCount).toBe(1);
  expect(observed.beforeRetryEvents).toEqual(['start', 'end']);
  expect(observed.opensAtBeforeRetryStart).toBe(1);
  expect(observed.opensAtBeforeRetryEnd).toBe(1);
  expect(observed.onRetryCount).toBe(1);
  expect(observed.callbackOrder).toEqual(['onRetry', 'beforeRetry:start', 'beforeRetry:end']);
  expect(observed.events.filter((event) => event === 'start')).toHaveLength(1);
  expect(observed.events.filter((event) => event === 'progress')).toHaveLength(1);
  expect(observed.events.filter((event) => event === 'data')).toHaveLength(1);
  expect(observed.retryAttempts).toBe(1);
  expect(observed.historyAttempts).toEqual([1]);
  expect(observed.historyStatuses).toEqual([503]);
  expect(observed.nativeProgressCounts).toHaveLength(2);
  expect(observed.nativeProgressCounts.every((count) => count > 0)).toBe(true);
  expect(observed.activeAbortListenersAtClose).toBe(0);
  expect(observed.headerStatuses).toEqual([200]);
  expect(observed.statusValues).toEqual([200]);
  expect(observed.errorStatuses).toEqual([]);
  expect(observed.events.filter((event) => event === 'finish')).toHaveLength(1);
  expect(observed.events.filter((event) => event === 'done')).toHaveLength(1);
  expect(observed.events.filter((event) => event === 'complete')).toHaveLength(1);
  expect(observed.transport).toEqual({ opens: 2, sends: 2, aborts: 0, fetches: 0 });
  expect(observed.settledBy).not.toBe('timeout');
  expect(state.hits[PATHS.retry]).toBe(2);
});

carrier(TEST_NAMES.retryVeto, () => {
  const observed = requireObservation('XB-R7').retryVeto;
  expect(observed.callbackOrder).toEqual(['onRetry']);
  expect(observed.beforeRetryCount).toBe(0);
  expect(observed.onRetryCount).toBe(1);
  expect(observed.headerStatuses).toEqual([503]);
  expect(observed.errorStatuses).toEqual([503]);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(observed.settledBy).toBe('error');
  expect(state.hits[PATHS.retryVeto]).toBe(1);
});

carrier(TEST_NAMES.truncated, () => {
  const observed = requireObservation('XB-N1').truncated;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ERR_STREAM_PREMATURE_CLOSE');
  expect(observed.settled.errno).toBe(-1011);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(observed.nativeTerminalEvents.filter((event) => event === 'error')).toHaveLength(1);
  expect(observed.nativeTerminalEvents.filter((event) => event === 'load')).toHaveLength(0);
  expect(observed.nativeTerminalEvents.filter((event) => event === 'loadend')).toHaveLength(1);
  expect(observed.unhandledReasons).toEqual([]);
  expect(state.hits[PATHS.truncated]).toBe(1);
});

carrier(TEST_NAMES.typedViewBody, () => {
  const observed = requireObservation('XB-B2').typedViewBody;
  expect(observed.sentKind).toBe('Uint8Array:1:3');
  expect(observed.bodyHex).toBe('000102');
  expect(observed.bodyLength).toBe(3);
  expect(state.hits[PATHS.echo]).toBe(7);
});

carrier(TEST_NAMES.nativeBodyControls, () => {
  const [blob, form, arrayBuffer] = requireObservation('XB-B3').nativeBodyControls;
  expect(blob).toMatchObject({
    caseName: 'native-blob',
    sentKind: 'Blob:application/octet-stream:3',
    bodyHex: '00ff01',
    bodyLength: 3,
    contentType: 'application/octet-stream',
  });
  expect(form.caseName).toBe('native-form');
  expect(form.sentKind).toBe('FormData');
  expect(form.contentType).toMatch(/^multipart\/form-data; boundary=/);
  const multipartText = Buffer.from(form.bodyHex, 'hex').toString('utf8');
  expect(multipartText).toContain('name="alpha"');
  expect(multipartText).toContain('one');
  expect(multipartText).toContain('name="omega"');
  expect(multipartText).toContain('two');
  expect(arrayBuffer).toEqual({
    caseName: 'native-arraybuffer',
    sentKind: 'ArrayBuffer:4',
    bodyHex: 'deadbeef',
    bodyLength: 4,
    contentType: 'application/octet-stream',
  });
});

carrier(TEST_NAMES.explicitBinary, () => {
  const observed = requireObservation('XB-B4').explicitBinary;
  expect(observed.kind).toBe('ArrayBuffer');
  expect(observed.bytes).toEqual(Array.from(ALL_BYTES));
  expect(state.hits[PATHS.binary]).toBe(2);
});

carrier(TEST_NAMES.abortHook, () => {
  const observed = requireObservation('XB-H2').abortHook;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ABORT_ERR');
  expect(observed.settled.errno).toBe(-1025);
  expect(observed.hookCount).toBe(1);
  expect(observed.events).toEqual(['onAbort']);
  expect(observed.hookPayload?.reason).toBe('signal');
  expect(observed.hookPayload?.url).toContain(PATHS.abortHook);
  expect(observed.hookPayload?.elapsed).toEqual(expect.any(Number));
  expect(state.hits[PATHS.abortHook]).toBe(1);
});

carrier(TEST_NAMES.timeoutHook, () => {
  const observed = requireObservation('XB-H3').timeoutHook;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ECONNABORTED');
  expect(observed.settled.errno).toBe(-103);
  expect(observed.settled.elapsedMs).toBeLessThan(750);
  expect(observed.hookCount).toBe(1);
  expect(observed.events).toEqual(['onTimeout']);
  expect(observed.hookPayload?.type).toBe('request');
  expect(observed.hookPayload?.timeout).toBe(80);
  expect(observed.hookPayload?.url).toContain(PATHS.timeoutHook);
  expect(state.hits[PATHS.timeoutHook]).toBe(1);
});

carrier(TEST_NAMES.stagedHeaders, () => {
  const observed = requireObservation('XB-H5').stagedHeaders;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ESOCKETTIMEDOUT');
  expect(observed.settled.errno).toBe(-1073);
  expect(observed.settled.elapsedMs).toBeLessThan(750);
  expect(observed.hookCount).toBe(1);
  expect(observed.events).toEqual(['onTimeout']);
  expect(observed.hookPayload?.type).toBe('response');
  expect(observed.hookPayload?.timeout).toBe(120);
  expect(observed.hookPayload?.url).toContain(PATHS.stagedHeaders);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 1, fetches: 0 });
  expect(state.hits[PATHS.stagedHeaders]).toBe(1);
});

carrier(TEST_NAMES.stagedBody, () => {
  const observed = requireObservation('XB-H7').stagedBody;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ESOCKETTIMEDOUT');
  expect(observed.settled.errno).toBe(-1073);
  expect(observed.settled.elapsedMs).toBeLessThan(220);
  expect(observed.hookCount).toBe(1);
  expect(observed.events).toEqual(['onTimeout']);
  expect(observed.hookPayload?.type).toBe('response');
  expect(observed.hookPayload?.timeout).toBe(100);
  expect(observed.hookPayload?.url).toContain(PATHS.stagedBody);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 1, fetches: 0 });
  expect(state.hits[PATHS.stagedBody]).toBe(1);
});

carrier(TEST_NAMES.hookFailure, () => {
  const observed = requireObservation('XB-H4').hookFailure;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('REZ_UNKNOWN_ERROR');
  expect(observed.settled.errno).toBe(-9999);
  expect(observed.events).toEqual(['afterHeaders', 'beforeError']);
  expect(observed.beforeErrorCount).toBe(1);
  expect(observed.causeMessage).toBe('afterHeaders boom');
  expect(state.hits[PATHS.hookFailure]).toBe(1);
});

carrier(TEST_NAMES.afterParseFailure, () => {
  const observed = requireObservation('XB-H6').afterParseFailure;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('REZ_UNKNOWN_ERROR');
  expect(observed.settled.errno).toBe(-9999);
  expect(observed.events).toEqual(['afterHeaders', 'afterParse', 'beforeError']);
  expect(observed.beforeErrorCount).toBe(1);
  expect(observed.causeMessage).toBe('afterParse boom');
  expect(state.hits[PATHS.afterParseFailure]).toBe(1);
});

carrier(TEST_NAMES.hookInterrupt, () => {
  const observed = requireObservation('XB-H9').hookInterrupt;
  expect(observed.map((entry) => `${entry.phase}:${entry.owner}`)).toEqual([
    'afterHeaders:caller',
    'afterParse:caller',
    'afterHeaders:total',
    'afterParse:total',
  ]);
  for (const entry of observed) {
    expect(entry.settled.outcome).toBe('rejected');
    expect(entry.settled.elapsedMs).toBeLessThan(180);
    expect(entry.hookStarted).toBe(1);
    expect(entry.hookSettled).toBe(1);
    expect(entry.beforeErrorCount).toBe(1);
    expect(entry.transport).toEqual({ opens: 1, sends: 1, aborts: 1, fetches: 0 });
    if (entry.owner === 'caller') {
      expect(entry.settled.code).toBe('ABORT_ERR');
      expect(entry.settled.errno).toBe(-1025);
      expect(entry.onAbortCount).toBe(1);
      expect(entry.onTimeoutCount).toBe(0);
    } else {
      expect(entry.settled.code).toBe('ECONNABORTED');
      expect(entry.settled.errno).toBe(-103);
      expect(entry.onAbortCount).toBe(0);
      expect(entry.onTimeoutCount).toBe(1);
    }
  }
  expect(state.hits[PATHS.hookInterrupt]).toBe(4);
});

carrier(TEST_NAMES.facadeHttpError, () => {
  const observed = requireObservation('XB-H8').facadeHttpError;
  expect(observed.events).toEqual([
    'headers',
    'status',
    'beforeError:start',
    'beforeError:end',
    'error',
  ]);
  expect(observed.beforeErrorCount).toBe(1);
  expect(observed.emittedIsSentinel).toBe(true);
  expect(observed.emittedCode).toBe('XB_FACADE_SENTINEL');
  expect(observed.headerStatuses).toEqual([503]);
  expect(observed.errorStatuses).toEqual([null]);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(observed.settledBy).toBe('error');
  expect(state.hits[PATHS.facadeHttpError]).toBe(1);
});

carrier(TEST_NAMES.facadeRetryOwnership, () => {
  const [recover, exhaust] = requireObservation('XB-L4').facadeRetryOwnership;
  expect(recover.caseName).toBe('recover');
  expect(recover.events).toEqual(['headers', 'status', 'finish', 'done', 'complete', 'close']);
  expect(recover.beforeErrorCount).toBe(0);
  expect(recover.emittedIsSentinel).toBe(false);
  expect(recover.emittedCode).toBeNull();
  expect(recover.headerStatuses).toEqual([200]);
  expect(recover.errorStatuses).toEqual([]);
  expect(recover.transport).toEqual({ opens: 2, sends: 2, aborts: 0, fetches: 0 });
  expect(recover.settledBy).toBe('close');

  expect(exhaust.caseName).toBe('exhaust');
  expect(exhaust.events).toEqual([
    'headers',
    'status',
    'beforeError:start',
    'beforeError:end',
    'error',
  ]);
  expect(exhaust.beforeErrorCount).toBe(1);
  expect(exhaust.emittedIsSentinel).toBe(true);
  expect(exhaust.emittedCode).toBe('XB_FACADE_SENTINEL');
  expect(exhaust.headerStatuses).toEqual([200]);
  expect(exhaust.errorStatuses).toEqual([null]);
  expect(exhaust.transport).toEqual({ opens: 2, sends: 2, aborts: 0, fetches: 0 });
  expect(exhaust.settledBy).toBe('error');
  expect(state.hits[PATHS.facadeRetryRecover]).toBe(2);
  expect(state.hits[PATHS.facadeRetryExhaust]).toBe(2);
});

carrier(TEST_NAMES.retryTotalTimeout, () => {
  const observed = requireObservation('XB-R4').retryTotalTimeout;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ECONNABORTED');
  expect(observed.settled.errno).toBe(-103);
  expect(observed.settled.elapsedMs).toBeLessThan(750);
  expect(observed.onTimeoutCount).toBe(1);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.retryDelay]).toBe(1);
});

function assertDeadlineStage(
  observed: DeadlineStageObservation,
  expectStageStart: boolean,
): void {
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('ECONNABORTED');
  expect(observed.settled.errno).toBe(-103);
  expect(observed.settled.elapsedMs).toBeLessThan(180);
  expect(observed.onTimeoutCount).toBe(1);
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(observed.stageStarted).toBe(expectStageStart ? 1 : 0);
  expect(observed.stageSettled).toBe(expectStageStart ? 1 : 0);
}

carrier(TEST_NAMES.retryStageTotalTimeout, () => {
  const observed = requireObservation('XB-R5').retryStageTotalTimeout;
  expect(observed.map((entry) => entry.caseName)).toEqual(['condition', 'beforeRetry', 'onRetry']);
  for (const entry of observed) assertDeadlineStage(entry, true);
  expect(state.hits[PATHS.retryStageTimeout]).toBe(3);
});

carrier(TEST_NAMES.rateTotalTimeout, () => {
  const observed = requireObservation('XB-R6').rateTotalTimeout;
  expect(observed.map((entry) => entry.caseName)).toEqual(['hook', 'sleep']);
  assertDeadlineStage(observed[0], true);
  assertDeadlineStage(observed[1], false);
  expect(state.hits[PATHS.rateTotal]).toBe(2);
});

carrier(TEST_NAMES.cookieTruth, () => {
  const observed = requireObservation('XB-O2').cookieTruth;
  expect(observed.outboundCookie).toContain('xhr_outbound=one');
  expect(observed.responseCookieNames).toEqual([]);
  expect(observed.responseCookieString).toBe('');
  expect(state.hits[PATHS.cookieTruth]).toBe(1);
});

carrier(TEST_NAMES.downloadRefusal, () => {
  const observed = requireObservation('XB-O3').downloadRefusal;
  expect(observed.events).toEqual(['error']);
  expect(observed.errorCodes).toEqual(['REZ_UNSUPPORTED_CAPABILITY']);
  expect(observed.isFinished).toBe(false);
  expect(observed.settledBy).toBe('error');
  expect(observed.transport).toEqual({ opens: 0, sends: 0, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.downloadRefusal]).toBeUndefined();
});

carrier(TEST_NAMES.cookieRefusal, () => {
  const observed = requireObservation('XB-O4').cookieRefusal;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observed.settled.errno).toBe(-1075);
  expect(observed.transport).toEqual({ opens: 0, sends: 0, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.cookieRefusal]).toBeUndefined();
});

carrier(TEST_NAMES.connectRefusal, () => {
  const observed = requireObservation('XB-O5').connectRefusal;
  expect(observed.settled.outcome).toBe('rejected');
  expect(observed.settled.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observed.settled.errno).toBe(-1075);
  expect(observed.settled.message).toContain('connect timeout');
  expect(observed.transport).toEqual({ opens: 0, sends: 0, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.connectRefusal]).toBeUndefined();
});

carrier(TEST_NAMES.redirectMetadata, () => {
  const observation = requireObservation('XB-O6');
  const observed = observation.redirectMetadata;
  const startUrl = new URL(PATHS.redirectStart, observation.explicitHref).href;
  const finalUrl = new URL(PATHS.redirectFinal, observation.explicitHref).href;
  expect(observed.finalUrl).toBe(finalUrl);
  expect(observed.urls).toEqual([startUrl, finalUrl]);
  expect(observed.configFinalUrl).toBe(finalUrl);
  expect(observed.adapterUsed).toBe('xhr');
  expect(observed.transport).toEqual({ opens: 1, sends: 1, aborts: 0, fetches: 0 });
  expect(observed.refusal.outcome).toBe('rejected');
  expect(observed.refusal.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(observed.refusal.errno).toBe(-1075);
  expect(observed.refusal.message).toContain('onRedirect');
  expect(observed.refusalTransport).toEqual({ opens: 0, sends: 0, aborts: 0, fetches: 0 });
  expect(state.hits[PATHS.redirectStart]).toBe(1);
  expect(state.hits[PATHS.redirectFinal]).toBe(1);
});

carrier(TEST_NAMES.finalCleanup, () => {
  expect(requireObservation('XB-R8').finalUnhandledReasons).toEqual([]);
});

// ---------------------------------------------------------------- ledger --

afterAll(async () => {
  await closeBrowser();
  await closeServer();
  const closing = {
    carrierSha256: sha256File(CARRIER_PATH),
    xhrAdapterSha256: sourceSha256(XHR_ADAPTER_SOURCE),
    xhrEntrySha256: sourceSha256(XHR_ENTRY_SOURCE),
    browserPlatformSha256: sourceSha256(BROWSER_PLATFORM_SOURCE),
    packageSha256: sha256File(join(REPO_ROOT, 'package.json')),
    bunLockSha256: sha256File(join(REPO_ROOT, 'bun.lock')),
    esbuildBinarySha256: sha256File(join(REPO_ROOT, 'node_modules/@esbuild/darwin-arm64/bin/esbuild')),
    chromeSha256: sha256File(PINNED_CHROME_EXECUTABLE),
  };
  const actualRed = [...failed].sort(compareStrings);
  const ledger = {
    schema: 'rezo.xhr.browser-runtime.red-ledger/v1',
    runtime: process.version,
    runner: { execPath: process.execPath, argv: [...process.argv], execArgv: [...process.execArgv], cwd: process.cwd() },
    chrome: {
      version: state.chromeVersion,
      executable: state.chromeExecutable,
      rootPid: state.chromeRootPid,
      treePids: state.chromeTreePids,
      forcedKillPids: state.forcedKillPids,
      lingeringPids: state.lingeringPids,
    },
    tools: { esbuild: OPENING.esbuildVersion, puppeteer: OPENING.puppeteerVersion },
    opening: OPENING,
    closing,
    bundles: {
      xhr: state.xhrBundle === null ? null : { inputs: state.xhrBundle.inputs, bytes: state.xhrBundle.bytes, errors: state.xhrBundle.errors, warnings: state.xhrBundle.warnings, rejected: state.xhrBundle.rejected },
      browser: state.browserBundle === null ? null : { inputs: state.browserBundle.inputs, bytes: state.browserBundle.bytes, errors: state.browserBundle.errors, warnings: state.browserBundle.warnings, rejected: state.browserBundle.rejected },
    },
    hits: state.hits,
    observation: state.observation,
    a0Dependencies: state.observation === null ? null : {
      falsyBodies: state.observation.falsyBodies,
      autoBinary: state.observation.autoBinary,
      disposition: 'witness-only; excluded from XHR expected RED denominator',
    },
    passed: [...passed].sort(compareStrings),
    actualRed,
    expectedRed: EXPECTED_RED,
    pageErrors: state.pageErrors,
    consoleErrors: state.consoleErrors,
    setupError: state.setupError,
    teardownErrors: state.teardownErrors,
  };
  console.log(`REZO_XHR_BROWSER_RED_LEDGER_V1:${JSON.stringify(ledger)}`);

  const faults: string[] = [];
  if (state.setupError !== null) faults.push(`setup:${state.setupError}`);
  if (state.pageErrors.length > 0) faults.push(`page:${state.pageErrors.join('|')}`);
  const unexpectedConsoleErrors = state.consoleErrors.filter((message) => !EXPECTED_CONSOLE_ERRORS.has(message));
  if (unexpectedConsoleErrors.length > 0) faults.push(`console:${unexpectedConsoleErrors.join('|')}`);
  if (state.teardownErrors.length > 0) faults.push(`teardown:${state.teardownErrors.join('|')}`);
  if (state.forcedKillPids.length > 0) faults.push(`forced-kill:${state.forcedKillPids.join(',')}`);
  if (state.lingeringPids.length > 0) faults.push(`lingering:${state.lingeringPids.join(',')}`);
  if (JSON.stringify(actualRed) !== JSON.stringify(EXPECTED_RED)) faults.push(`red-map:${JSON.stringify(actualRed)}`);
  if (passed.size + failed.size !== Object.keys(TEST_NAMES).length) faults.push(`row-count:${passed.size + failed.size}`);
  if (closing.carrierSha256 !== OPENING.carrierSha256
    || closing.xhrAdapterSha256 !== OPENING.xhrAdapterSha256
    || closing.xhrEntrySha256 !== OPENING.xhrEntrySha256
    || closing.browserPlatformSha256 !== OPENING.browserPlatformSha256
    || closing.packageSha256 !== OPENING.packageSha256
    || closing.bunLockSha256 !== OPENING.bunLockSha256
    || closing.esbuildBinarySha256 !== OPENING.esbuildBinarySha256
    || closing.chromeSha256 !== OPENING.chromeSha256) {
    faults.push('identity-moved');
  }
  if (faults.length > 0) throw new Error(`XHR browser RED ledger rejected: ${faults.join('; ')}`);
}, 20_000);
