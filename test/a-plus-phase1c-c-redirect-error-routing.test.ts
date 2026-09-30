/**
 * Phase 1c-c redirect-error routing — remote malformed-Location safety.
 *
 * Every malformed adapter request runs in a child process because the current
 * HTTP implementation throws from an asynchronous response listener. The
 * parent owns the loopback fixtures, so a raw process failure cannot kill the
 * suite or make its own server disappear before the failure is observed. The
 * stream rows stay in the parent behind response gates so listeners are
 * installed before fixture I/O is released.
 */

import { execFile, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo, Socket } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { executeRequest as executeFetchRequest } from '../src/adapters/fetch.js';
import { executeRequest as executeHttpRequest } from '../src/adapters/http.js';
import { executeRequest as executeHttp2Request } from '../src/adapters/http2.js';
import {
  Rezo,
  RezoError,
  type RezoDefaultOptions,
  type RezoHttpRequest,
  type RezoResponse,
} from '../src/index.js';
import type { RedirectEvent, StreamFinishEvent } from '../src/responses/types.js';

type AdapterName = 'http' | 'fetch' | 'http2';

interface SerializedError {
  readonly code: string | null;
  readonly message: string;
  readonly name: string;
}

interface ProbeResult {
  readonly adapter: AdapterName;
  readonly callbackCount: number;
  readonly configFinalUrl: string | null;
  readonly configRedirectCount: number | null;
  readonly configRedirectHistory: unknown[] | null;
  readonly error: (SerializedError & {
    readonly errno: number | null;
    readonly requestFullUrl: string | null;
    readonly responseFinalUrl: string | null;
    readonly responseStatus: number | null;
  }) | null;
  readonly globalErrors: SerializedError[];
  readonly globalUnhandledRejections: SerializedError[];
  readonly lateTurnComplete: boolean;
  readonly processUncaughtExceptions: Array<SerializedError & { readonly origin: string }>;
  readonly processUnhandledRejections: SerializedError[];
  readonly responseStatus: number | null;
  readonly settlement: 'pending' | 'rejected' | 'resolved';
  readonly settlementBound: 'pending' | 'settled';
  readonly targetUrl: string;
}

interface StreamProbeResult {
  readonly callbackCount: number;
  readonly configFinalUrl: string | null;
  readonly configRedirectCount: number | null;
  readonly configRedirectHistory: unknown[] | null;
  readonly error: (SerializedError & {
    readonly errno: number | null;
    readonly requestFullUrl: string | null;
    readonly responseFinalUrl: string | null;
    readonly responseStatus: number | null;
  }) | null;
  readonly errorIsRezoError: boolean;
  readonly events: string[];
  readonly globalErrors: SerializedError[];
  readonly globalUnhandledRejections: SerializedError[];
  readonly lateTurnComplete: boolean;
  readonly processUncaughtExceptions: Array<SerializedError & { readonly origin: string }>;
  readonly processUnhandledRejections: SerializedError[];
  readonly settlement: 'error' | 'pending';
  readonly settlementBound: 'pending' | 'settled';
  readonly targetUrl: string;
}

interface WireObservation {
  readonly body?: string;
  readonly diagnosticHeader?: string;
  readonly method?: string;
  readonly path: string;
  readonly protocol: 'h1' | 'h2';
}

type MatrixOutcome =
  | { readonly kind: 'rejected'; readonly reason: unknown }
  | { readonly kind: 'resolved'; readonly response: RezoResponse<unknown> };

interface MatrixErrorSnapshot {
  readonly code: unknown;
  readonly configFinalUrl: unknown;
  readonly configOriginalBody: unknown;
  readonly configRedirectCount: unknown;
  readonly configRedirectHistoryLength: number | null;
  readonly errno: unknown;
  readonly maxRedirectsReached: unknown;
  readonly message: unknown;
  readonly requestBody: unknown;
  readonly requestDiagnosticHeader: unknown;
  readonly requestFullUrl: unknown;
  readonly requestMethod: unknown;
  readonly requestUrl: unknown;
  readonly responseFinalUrl: unknown;
  readonly responseLocation: unknown;
  readonly responseStatus: unknown;
}

interface MatrixCallbackCapture {
  callbackCount: number;
  readonly callbackMethods: string[];
  readonly callbackBodies: unknown[];
  readonly hookConfigs: unknown[];
  readonly hookRequests: unknown[];
  readonly hookResponses: unknown[];
}

const CHILD_SETTLEMENT_BOUND_MS = 350;
const CHILD_TIMEOUT_MS = 5_000;
const CHILD_OUTPUT_PREFIX = 'REZO_REDIRECT_PROBE:';
const MATRIX_GET_HEADER = 'phase3-get-carrier';
const MATRIX_POST_BODY = 'phase3-rollback-body';
const MATRIX_POST_HEADER = 'phase3-rollback-header';
const STREAM_PLAIN_SOURCE_PATH = '/phase1-stream-plain';
const STREAM_VALID_SOURCE_PATH = '/phase1-stream-valid';
const STREAM_VALID_TARGET_PATH = '/phase1-stream-final';
const STREAM_INVALID_SOURCE_PATH = '/phase1-stream-malformed';
const STREAM_VALID_LOCATION = './phase1-stream-final?via=relative';

let h1Server: http.Server | undefined;
let h2Server: http2.Http2Server | undefined;
let h1Port = 0;
let h2Port = 0;
const h1Sockets = new Set<Socket>();
const h2Sessions = new Set<http2.ServerHttp2Session>();
const activeChildren = new Set<ChildProcess>();
const wireLedger: WireObservation[] = [];
const fixtureErrors: string[] = [];
let observePlainStreamSource: ((response: http.ServerResponse) => void) | undefined;
let observeValidStreamSource: ((response: http.ServerResponse) => void) | undefined;

function serializeThrown(value: unknown): SerializedError {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const object = value as { code?: unknown; message?: unknown; name?: unknown };
    return {
      code: typeof object.code === 'string' ? object.code : null,
      message: typeof object.message === 'string' ? object.message : String(value),
      name: typeof object.name === 'string' ? object.name : typeof value,
    };
  }
  return { code: null, message: String(value), name: typeof value };
}

function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolveWithin, rejectWithin) => {
    const timer = setTimeout(() => rejectWithin(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveWithin(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectWithin(error);
      },
    );
  });
}

function createRawEventCapture(): {
  readonly globalErrors: SerializedError[];
  readonly globalUnhandledRejections: SerializedError[];
  readonly processUncaughtExceptions: Array<SerializedError & { readonly origin: string }>;
  readonly processUnhandledRejections: SerializedError[];
  readonly start: () => void;
  readonly stop: () => void;
} {
  const processUncaughtExceptions: Array<SerializedError & { readonly origin: string }> = [];
  const processUnhandledRejections: SerializedError[] = [];
  const globalErrors: SerializedError[] = [];
  const globalUnhandledRejections: SerializedError[] = [];
  const globalEventTarget = globalThis as unknown as {
    addEventListener?: (name: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (name: string, listener: (event: unknown) => void) => void;
  };
  const onProcessUncaught = (error: Error, origin: string): void => {
    processUncaughtExceptions.push({ ...serializeThrown(error), origin });
  };
  const onProcessUnhandled = (reason: unknown): void => {
    processUnhandledRejections.push(serializeThrown(reason));
  };
  const onGlobalError = (event: unknown): void => {
    const errorEvent = event as { error?: unknown; preventDefault?: () => void };
    globalErrors.push(serializeThrown(errorEvent.error ?? event));
    errorEvent.preventDefault?.();
  };
  const onGlobalUnhandled = (event: unknown): void => {
    const rejectionEvent = event as { preventDefault?: () => void; reason?: unknown };
    globalUnhandledRejections.push(serializeThrown(rejectionEvent.reason));
    rejectionEvent.preventDefault?.();
  };

  return {
    globalErrors,
    globalUnhandledRejections,
    processUncaughtExceptions,
    processUnhandledRejections,
    start: () => {
      process.on('uncaughtException', onProcessUncaught);
      process.on('unhandledRejection', onProcessUnhandled);
      globalEventTarget.addEventListener?.('error', onGlobalError);
      globalEventTarget.addEventListener?.('unhandledrejection', onGlobalUnhandled);
    },
    stop: () => {
      process.off('uncaughtException', onProcessUncaught);
      process.off('unhandledRejection', onProcessUnhandled);
      globalEventTarget.removeEventListener?.('error', onGlobalError);
      globalEventTarget.removeEventListener?.('unhandledrejection', onGlobalUnhandled);
    },
  };
}

function listen(server: http.Server | http2.Http2Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectListen(new Error('redirect fixture did not expose an IP port'));
        return;
      }
      resolveListen((address as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeH1Server(): Promise<void> {
  if (!h1Server) return;
  for (const socket of h1Sockets) socket.destroy();
  h1Sockets.clear();
  h1Server.closeAllConnections?.();
  if (!h1Server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    h1Server!.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function closeH2Server(): Promise<void> {
  if (!h2Server) return;
  for (const session of h2Sessions) session.destroy();
  h2Sessions.clear();
  if (!h2Server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    h2Server!.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function sourcePath(adapter: AdapterName): string {
  return `/phase1-malformed-${adapter}`;
}

function targetUrl(adapter: AdapterName): string {
  const port = adapter === 'http2' ? h2Port : h1Port;
  return `http://127.0.0.1:${port}${sourcePath(adapter)}`;
}

function childSource(adapter: AdapterName, url: string): string {
  const rezoModuleUrl = pathToFileURL(resolve('src/index.ts')).href;
  const adapterModuleUrl = pathToFileURL(resolve(`src/adapters/${adapter}.ts`)).href;
  return `
const adapterName = ${JSON.stringify(adapter)};
const targetUrl = ${JSON.stringify(url)};
const outputPrefix = ${JSON.stringify(CHILD_OUTPUT_PREFIX)};
const settlementBoundMs = ${CHILD_SETTLEMENT_BOUND_MS};
const processUncaughtExceptions = [];
const processUnhandledRejections = [];
const globalErrors = [];
const globalUnhandledRejections = [];

function serializedError(value) {
  const object = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value
    : null;
  return {
    code: typeof object?.code === 'string' ? object.code : null,
    message: typeof object?.message === 'string' ? object.message : String(value),
    name: typeof object?.name === 'string' ? object.name : typeof value,
  };
}

function serializedRequestError(value) {
  const basic = serializedError(value);
  const object = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value
    : null;
  const config = object?.config;
  const request = object?.request;
  const response = object?.response;
  return {
    ...basic,
    errno: typeof object?.errno === 'number' ? object.errno : null,
    requestFullUrl: typeof request?.fullUrl === 'string' ? request.fullUrl : null,
    responseFinalUrl: typeof response?.finalUrl === 'string' ? response.finalUrl : null,
    responseStatus: typeof response?.status === 'number' ? response.status : null,
    configFinalUrl: typeof config?.finalUrl === 'string' ? config.finalUrl : null,
    configRedirectCount: typeof config?.redirectCount === 'number' ? config.redirectCount : null,
    configRedirectHistory: Array.isArray(config?.redirectHistory)
      ? config.redirectHistory.map((entry) => ({
        method: typeof entry?.method === 'string' ? entry.method : null,
        statusCode: typeof entry?.statusCode === 'number' ? entry.statusCode : null,
        url: typeof entry?.url === 'string' ? entry.url : null,
      }))
      : null,
  };
}

process.on('uncaughtException', (error, origin) => {
  processUncaughtExceptions.push({ ...serializedError(error), origin: String(origin) });
});
process.on('unhandledRejection', (reason) => {
  processUnhandledRejections.push(serializedError(reason));
});
globalThis.addEventListener?.('error', (event) => {
  globalErrors.push(serializedError(event?.error ?? event));
  event?.preventDefault?.();
});
globalThis.addEventListener?.('unhandledrejection', (event) => {
  globalUnhandledRejections.push(serializedError(event?.reason));
  event?.preventDefault?.();
});

let callbackCount = 0;
let settlement = 'pending';
let responseStatus = null;
let requestError = null;

const requestPromise = (async () => {
  try {
    const [{ Rezo }, adapterModule] = await Promise.all([
      import(${JSON.stringify(rezoModuleUrl)}),
      import(${JSON.stringify(adapterModuleUrl)}),
    ]);
    const client = new Rezo({}, adapterModule.executeRequest);
    const response = await client.get(targetUrl, {
      cache: false,
      onRedirect: () => {
        callbackCount++;
        return { redirect: true };
      },
      retry: false,
      timeout: 5_000,
    });
    responseStatus = typeof response?.status === 'number' ? response.status : null;
    settlement = 'resolved';
  } catch (error) {
    const serialized = serializedRequestError(error);
    requestError = {
      code: serialized.code,
      errno: serialized.errno,
      message: serialized.message,
      name: serialized.name,
      requestFullUrl: serialized.requestFullUrl,
      responseFinalUrl: serialized.responseFinalUrl,
      responseStatus: serialized.responseStatus,
    };
    globalThis.__rezoConfigObservation = {
      finalUrl: serialized.configFinalUrl,
      redirectCount: serialized.configRedirectCount,
      redirectHistory: serialized.configRedirectHistory,
    };
    settlement = 'rejected';
  }
})();

const settlementBound = await Promise.race([
  requestPromise.then(() => 'settled'),
  new Promise((resolveBound) => setTimeout(() => resolveBound('pending'), settlementBoundMs)),
]);
await new Promise((resolveTurn) => setTimeout(resolveTurn, 35));
const configObservation = globalThis.__rezoConfigObservation ?? {
  finalUrl: null,
  redirectCount: null,
  redirectHistory: null,
};
const outcome = {
  adapter: adapterName,
  callbackCount,
  configFinalUrl: configObservation.finalUrl,
  configRedirectCount: configObservation.redirectCount,
  configRedirectHistory: configObservation.redirectHistory,
  error: requestError,
  globalErrors,
  globalUnhandledRejections,
  lateTurnComplete: true,
  processUncaughtExceptions,
  processUnhandledRejections,
  responseStatus,
  settlement,
  settlementBound,
  targetUrl,
};
process.stdout.write(outputPrefix + JSON.stringify(outcome) + '\\n', () => process.exit(0));
setTimeout(() => process.exit(0), 100);
`;
}

function streamChildSource(url: string): string {
  const rezoModuleUrl = pathToFileURL(resolve('src/index.ts')).href;
  const adapterModuleUrl = pathToFileURL(resolve('src/adapters/http.ts')).href;
  return `
const targetUrl = ${JSON.stringify(url)};
const outputPrefix = ${JSON.stringify(CHILD_OUTPUT_PREFIX)};
const settlementBoundMs = ${CHILD_SETTLEMENT_BOUND_MS};
const processUncaughtExceptions = [];
const processUnhandledRejections = [];
const globalErrors = [];
const globalUnhandledRejections = [];

function serializedError(value) {
  const object = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value
    : null;
  return {
    code: typeof object?.code === 'string' ? object.code : null,
    message: typeof object?.message === 'string' ? object.message : String(value),
    name: typeof object?.name === 'string' ? object.name : typeof value,
  };
}

function serializedRequestError(value) {
  const basic = serializedError(value);
  const object = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value
    : null;
  const config = object?.config;
  const request = object?.request;
  const response = object?.response;
  return {
    ...basic,
    errno: typeof object?.errno === 'number' ? object.errno : null,
    requestFullUrl: typeof request?.fullUrl === 'string' ? request.fullUrl : null,
    responseFinalUrl: typeof response?.finalUrl === 'string' ? response.finalUrl : null,
    responseStatus: typeof response?.status === 'number' ? response.status : null,
    configFinalUrl: typeof config?.finalUrl === 'string' ? config.finalUrl : null,
    configRedirectCount: typeof config?.redirectCount === 'number' ? config.redirectCount : null,
    configRedirectHistory: Array.isArray(config?.redirectHistory)
      ? config.redirectHistory.map((entry) => ({
        method: typeof entry?.method === 'string' ? entry.method : null,
        statusCode: typeof entry?.statusCode === 'number' ? entry.statusCode : null,
        url: typeof entry?.url === 'string' ? entry.url : null,
      }))
      : null,
  };
}

process.on('uncaughtException', (error, origin) => {
  processUncaughtExceptions.push({ ...serializedError(error), origin: String(origin) });
});
process.on('unhandledRejection', (reason) => {
  processUnhandledRejections.push(serializedError(reason));
});
globalThis.addEventListener?.('error', (event) => {
  globalErrors.push(serializedError(event?.error ?? event));
  event?.preventDefault?.();
});
globalThis.addEventListener?.('unhandledrejection', (event) => {
  globalUnhandledRejections.push(serializedError(event?.reason));
  event?.preventDefault?.();
});

const [{ Rezo, RezoError }, adapterModule] = await Promise.all([
  import(${JSON.stringify(rezoModuleUrl)}),
  import(${JSON.stringify(adapterModuleUrl)}),
]);
const client = new Rezo({}, adapterModule.executeRequest);
const events = [];
let callbackCount = 0;
let errorIsRezoError = false;
let requestError = null;
let settlement = 'pending';
let resolveError;
const errorPromise = new Promise((resolveErrorEvent) => {
  resolveError = resolveErrorEvent;
});
const stream = client.stream(targetUrl, {
  cache: false,
  onRedirect: () => {
    callbackCount++;
    return { redirect: true };
  },
  retry: false,
  timeout: 5_000,
});
for (const eventName of [
  'initiated', 'start', 'redirect', 'headers', 'status', 'cookies', 'data',
  'progress', 'finish', 'done', 'complete', 'close',
]) {
  stream.on(eventName, () => events.push(eventName));
}
stream.on('error', (error) => {
  events.push('error');
  errorIsRezoError = error instanceof RezoError;
  const serialized = serializedRequestError(error);
  requestError = {
    code: serialized.code,
    errno: serialized.errno,
    message: serialized.message,
    name: serialized.name,
    requestFullUrl: serialized.requestFullUrl,
    responseFinalUrl: serialized.responseFinalUrl,
    responseStatus: serialized.responseStatus,
  };
  globalThis.__rezoConfigObservation = {
    finalUrl: serialized.configFinalUrl,
    redirectCount: serialized.configRedirectCount,
    redirectHistory: serialized.configRedirectHistory,
  };
  settlement = 'error';
  resolveError();
});

const settlementBound = await Promise.race([
  errorPromise.then(() => 'settled'),
  new Promise((resolveBound) => setTimeout(() => resolveBound('pending'), settlementBoundMs)),
]);
await new Promise((resolveTurn) => setTimeout(resolveTurn, 35));
const configObservation = globalThis.__rezoConfigObservation ?? {
  finalUrl: null,
  redirectCount: null,
  redirectHistory: null,
};
const outcome = {
  callbackCount,
  configFinalUrl: configObservation.finalUrl,
  configRedirectCount: configObservation.redirectCount,
  configRedirectHistory: configObservation.redirectHistory,
  error: requestError,
  errorIsRezoError,
  events,
  globalErrors,
  globalUnhandledRejections,
  lateTurnComplete: true,
  processUncaughtExceptions,
  processUnhandledRejections,
  settlement,
  settlementBound,
  targetUrl,
};
process.stdout.write(outputPrefix + JSON.stringify(outcome) + '\\n', () => process.exit(0));
setTimeout(() => process.exit(0), 100);
`;
}

function runProbe(adapter: AdapterName): Promise<ProbeResult> {
  const url = targetUrl(adapter);
  const source = childSource(adapter, url);
  const isBun = typeof process.versions.bun === 'string';
  const args = isBun
    ? ['--eval', source]
    : ['--import', 'tsx', '--input-type=module', '--eval', source];

  return new Promise((resolveProbe, rejectProbe) => {
    const child = execFile(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: CHILD_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      activeChildren.delete(child);
      const outputLines = String(stdout).split(/\r?\n/u).filter(Boolean);
      const probeLines = outputLines.filter((line) => line.startsWith(CHILD_OUTPUT_PREFIX));
      const unexpectedLines = outputLines.filter((line) => !line.startsWith(CHILD_OUTPUT_PREFIX));
      if (error || probeLines.length !== 1 || unexpectedLines.length > 0) {
        rejectProbe(new Error([
          `${adapter} child did not produce one clean probe record`,
          `exit: ${String((error as { code?: unknown } | null)?.code ?? 0)}`,
          `stdout: ${String(stdout).trim()}`,
          `stderr: ${String(stderr).trim()}`,
        ].join('\n'), { cause: error ?? undefined }));
        return;
      }
      try {
        resolveProbe(JSON.parse(probeLines[0].slice(CHILD_OUTPUT_PREFIX.length)) as ProbeResult);
      } catch (parseError) {
        rejectProbe(new Error(`${adapter} child emitted invalid JSON: ${probeLines[0]}`, {
          cause: parseError,
        }));
      }
    });
    activeChildren.add(child);
  });
}

function runStreamProbe(url: string): Promise<StreamProbeResult> {
  const source = streamChildSource(url);
  const isBun = typeof process.versions.bun === 'string';
  const args = isBun
    ? ['--eval', source]
    : ['--import', 'tsx', '--input-type=module', '--eval', source];

  return new Promise((resolveProbe, rejectProbe) => {
    const child = execFile(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: CHILD_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      activeChildren.delete(child);
      const outputLines = String(stdout).split(/\r?\n/u).filter(Boolean);
      const probeLines = outputLines.filter((line) => line.startsWith(CHILD_OUTPUT_PREFIX));
      const unexpectedLines = outputLines.filter((line) => !line.startsWith(CHILD_OUTPUT_PREFIX));
      if (error || probeLines.length !== 1 || unexpectedLines.length > 0) {
        rejectProbe(new Error([
          'http stream child did not produce one clean probe record',
          `exit: ${String((error as { code?: unknown } | null)?.code ?? 0)}`,
          `stdout: ${String(stdout).trim()}`,
          `stderr: ${String(stderr).trim()}`,
        ].join('\n'), { cause: error ?? undefined }));
        return;
      }
      try {
        resolveProbe(JSON.parse(
          probeLines[0].slice(CHILD_OUTPUT_PREFIX.length),
        ) as StreamProbeResult);
      } catch (parseError) {
        rejectProbe(new Error(`http stream child emitted invalid JSON: ${probeLines[0]}`, {
          cause: parseError,
        }));
      }
    });
    activeChildren.add(child);
  });
}

function wireFor(adapter: AdapterName): WireObservation[] {
  return wireLedger.filter((entry) => entry.path === sourcePath(adapter));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function recordField(value: unknown, key: PropertyKey): unknown {
  return isRecord(value) ? Reflect.get(value, key) : undefined;
}

function nestedField(value: unknown, ...keys: PropertyKey[]): unknown {
  return keys.reduce<unknown>((current, key) => recordField(current, key), value);
}

function matrixHeaderValue(headers: unknown, name: string): unknown {
  if (!isRecord(headers)) return undefined;
  const getter = recordField(headers, 'get');
  if (typeof getter === 'function') return Reflect.apply(getter, headers, [name]);
  return recordField(headers, name);
}

function matrixErrorSnapshot(reason: unknown): MatrixErrorSnapshot {
  const configHistory = nestedField(reason, 'config', 'redirectHistory');
  const requestHeaders = nestedField(reason, 'request', 'headers');
  const responseHeaders = nestedField(reason, 'response', 'headers');
  return {
    code: recordField(reason, 'code'),
    configFinalUrl: nestedField(reason, 'config', 'finalUrl'),
    configOriginalBody: nestedField(reason, 'config', 'originalBody'),
    configRedirectCount: nestedField(reason, 'config', 'redirectCount'),
    configRedirectHistoryLength: Array.isArray(configHistory) ? configHistory.length : null,
    errno: recordField(reason, 'errno'),
    maxRedirectsReached: nestedField(reason, 'config', 'maxRedirectsReached'),
    message: recordField(reason, 'message'),
    requestBody: nestedField(reason, 'request', 'body'),
    requestDiagnosticHeader: matrixHeaderValue(requestHeaders, 'x-rezo-matrix'),
    requestFullUrl: nestedField(reason, 'request', 'fullUrl'),
    requestMethod: nestedField(reason, 'request', 'method'),
    requestUrl: nestedField(reason, 'request', 'url'),
    responseFinalUrl: nestedField(reason, 'response', 'finalUrl'),
    responseLocation: matrixHeaderValue(responseHeaders, 'location'),
    responseStatus: nestedField(reason, 'response', 'status'),
  };
}

async function settleMatrix(
  promise: Promise<RezoResponse<unknown>>,
): Promise<MatrixOutcome> {
  try {
    return { kind: 'resolved', response: await promise };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function createMatrixCapture(): MatrixCallbackCapture {
  return {
    callbackBodies: [],
    callbackCount: 0,
    callbackMethods: [],
    hookConfigs: [],
    hookRequests: [],
    hookResponses: [],
  };
}

function matrixPrefix(adapter: AdapterName, id: string): string {
  return `/phase3/${adapter}/${id}`;
}

function matrixUrl(adapter: AdapterName, id: string, route: string): string {
  const port = adapter === 'http2' ? h2Port : h1Port;
  return `http://127.0.0.1:${port}${matrixPrefix(adapter, id)}/${route}`;
}

function matrixWire(adapter: AdapterName, id: string): WireObservation[] {
  const prefix = `${matrixPrefix(adapter, id)}/`;
  return wireLedger.filter((entry) => entry.path.startsWith(prefix));
}

function matrixClient(adapter: AdapterName, defaults: RezoDefaultOptions = {}): Rezo {
  if (adapter === 'http') return new Rezo(defaults, executeHttpRequest);
  if (adapter === 'fetch') return new Rezo(defaults, executeFetchRequest);
  return new Rezo(defaults, executeHttp2Request);
}

async function withMatrixLedger<T>(run: () => Promise<T>): Promise<T> {
  const uncaught: unknown[] = [];
  const unhandled: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    uncaught.push(error);
  };
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('uncaughtExceptionMonitor', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await run();
    await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 35));
    expect(uncaught).toEqual([]);
    expect(unhandled).toEqual([]);
    return result;
  } finally {
    process.off('uncaughtExceptionMonitor', onUncaught);
    process.off('unhandledRejection', onUnhandled);
  }
}

function matrixResponseFor(path: string): {
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly status: number;
} {
  const redirect = (suffix: string, status = 302) => ({
    body: '',
    headers: { location: `${path.slice(0, path.lastIndexOf('/'))}/${suffix}` },
    status,
  });
  if (path.endsWith('/chain/0')) return redirect('1');
  if (path.endsWith('/chain/1')) return redirect('2');
  if (path.endsWith('/chain/2')) return redirect('3');
  if (path.endsWith('/chain/3') || path.endsWith('/forbidden')) {
    return { body: 'matrix-final', headers: { 'content-type': 'text/plain' }, status: 200 };
  }
  if (path.endsWith('/source')) return redirect('forbidden');
  if (path.endsWith('/malformed')) {
    return { body: '', headers: { location: 'http://[' }, status: 302 };
  }
  if (path.endsWith('/callback/start')) return redirect('forbidden', 307);
  if (path.endsWith('/cycle/start')) return redirect('middle?raw=first');
  if (path.endsWith('/cycle/middle')) return redirect('raw-alias?raw=second');
  if (path.endsWith('/cycle/raw-alias')) {
    return { body: 'cycle-escaped', headers: { 'content-type': 'text/plain' }, status: 200 };
  }
  if (path.endsWith('/missing')) return { body: '', headers: {}, status: 302 };
  if (path.endsWith('/status/304')) return redirect('forbidden', 304);
  if (path.endsWith('/status/404')) {
    return { body: 'not-found', headers: { 'content-type': 'text/plain' }, status: 404 };
  }
  if (path.endsWith('/status/500')) {
    return { body: 'server-error', headers: { 'content-type': 'text/plain' }, status: 500 };
  }
  return { body: 'unexpected matrix route', headers: {}, status: 418 };
}

function readH1Body(request: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.once('error', rejectBody);
  });
}

function readH2Body(stream: http2.ServerHttp2Stream): Promise<string> {
  return new Promise<string>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', rejectBody);
  });
}

function matrixOptions(options: RezoHttpRequest = {}): RezoHttpRequest {
  return {
    cache: false,
    headers: { 'x-rezo-matrix': MATRIX_GET_HEADER },
    retry: false,
    timeout: 5_000,
    ...options,
  };
}

function matrixGet(
  adapter: AdapterName,
  id: string,
  route: string,
  options: RezoHttpRequest = {},
  defaults: RezoDefaultOptions = {},
): Promise<RezoResponse<unknown>> {
  return matrixClient(adapter, defaults).get(
    matrixUrl(adapter, id, route),
    matrixOptions(options),
  ) as Promise<RezoResponse<unknown>>;
}

function matrixPost(
  adapter: AdapterName,
  id: string,
  route: string,
  options: RezoHttpRequest = {},
  defaults: RezoDefaultOptions = {},
): Promise<RezoResponse<unknown>> {
  return matrixClient(adapter, defaults).request({
    ...matrixOptions(options),
    body: MATRIX_POST_BODY,
    headers: { 'x-rezo-matrix': MATRIX_POST_HEADER },
    method: 'POST',
    url: matrixUrl(adapter, id, route),
  }) as Promise<RezoResponse<unknown>>;
}

function resolvedMatrixSnapshot(outcome: MatrixOutcome): {
  readonly finalUrl: unknown;
  readonly location: unknown;
  readonly status: unknown;
} {
  if (outcome.kind === 'rejected') {
    return { finalUrl: undefined, location: undefined, status: undefined };
  }
  return {
    finalUrl: outcome.response.finalUrl,
    location: outcome.response.headers.get('location'),
    status: outcome.response.status,
  };
}

function expectResolvedMatrixChain(
  outcome: MatrixOutcome,
  finalUrl: string,
): void {
  expect(outcome.kind).toBe('resolved');
  if (outcome.kind !== 'resolved') return;
  const config = outcome.response.config;
  expect({
    configFinalUrl: config.finalUrl,
    finalUrl: outcome.response.finalUrl,
    historyLength: config.redirectHistory.length,
    redirectCount: config.redirectCount,
    status: outcome.response.status,
  }).toEqual({
    configFinalUrl: finalUrl,
    finalUrl,
    historyLength: 3,
    redirectCount: 3,
    status: 200,
  });
  expect(config.maxRedirectsReached).not.toBe(true);
}

function expectResolvedMatrixSource(
  outcome: MatrixOutcome,
  sourceUrl: string,
  location: string,
): void {
  expect(outcome.kind).toBe('resolved');
  if (outcome.kind !== 'resolved') return;
  const response = outcome.response;
  const config = response.config;
  const request = config.originalRequest;
  expect(isRecord(config)).toBe(true);
  expect(isRecord(request)).toBe(true);
  expect({
    configFinalUrl: config.finalUrl,
    configOriginalBody: config.originalBody,
    finalUrl: response.finalUrl,
    historyLength: config.redirectHistory.length,
    location: response.headers.get('location'),
    redirectCount: config.redirectCount,
    requestBody: request.body,
    requestFullUrl: request.fullUrl,
    requestHeader: matrixHeaderValue(request.headers, 'x-rezo-matrix'),
    requestMethod: request.method,
    requestUrl: request.url,
    status: response.status,
  }).toEqual({
    configFinalUrl: sourceUrl,
    configOriginalBody: undefined,
    finalUrl: sourceUrl,
    historyLength: 0,
    location,
    redirectCount: 0,
    requestBody: undefined,
    requestFullUrl: sourceUrl,
    requestHeader: MATRIX_GET_HEADER,
    requestMethod: 'GET',
    requestUrl: sourceUrl,
    status: 302,
  });
  expect(config.maxRedirectsReached).not.toBe(true);
}

function expectMatrixRollback(
  capture: MatrixCallbackCapture,
  sourceUrl: string,
): void {
  expect(capture.hookConfigs).toHaveLength(1);
  expect(capture.hookRequests).toHaveLength(1);
  expect(capture.hookResponses).toHaveLength(1);
  const config = capture.hookConfigs[0];
  const request = capture.hookRequests[0];
  const response = capture.hookResponses[0];
  expect(isRecord(config)).toBe(true);
  expect(isRecord(request)).toBe(true);
  expect(isRecord(response)).toBe(true);
  expect({
    configBody: recordField(config, 'originalBody'),
    configFinalUrl: recordField(config, 'finalUrl'),
    historyLength: Array.isArray(recordField(config, 'redirectHistory'))
      ? (recordField(config, 'redirectHistory') as unknown[]).length
      : null,
    redirectCount: recordField(config, 'redirectCount'),
    requestBody: recordField(request, 'body'),
    requestFullUrl: recordField(request, 'fullUrl'),
    requestHeader: matrixHeaderValue(recordField(request, 'headers'), 'x-rezo-matrix'),
    requestMethod: recordField(request, 'method'),
    requestUrl: recordField(request, 'url'),
    responseFinalUrl: recordField(response, 'finalUrl'),
    responseStatus: recordField(response, 'status'),
  }).toEqual({
    configBody: MATRIX_POST_BODY,
    configFinalUrl: sourceUrl,
    historyLength: 0,
    redirectCount: 0,
    requestBody: MATRIX_POST_BODY,
    requestFullUrl: sourceUrl,
    requestHeader: MATRIX_POST_HEADER,
    requestMethod: 'POST',
    requestUrl: sourceUrl,
    responseFinalUrl: sourceUrl,
    responseStatus: 307,
  });
  if (isRecord(config)) expect(recordField(config, 'originalRequest')).toBe(request);
  if (isRecord(response)) expect(recordField(response, 'config')).toBe(config);
}

function expectMatrixError(
  outcome: MatrixOutcome,
  expected: {
    readonly code: string;
    readonly errno: number;
    readonly historyLength: number;
    readonly maxRedirectsReached?: boolean;
    readonly message: string;
    readonly post?: boolean;
    readonly redirectCount: number;
    readonly responseStatus: number;
    readonly sourceUrl: string;
  },
): void {
  expect(outcome.kind).toBe('rejected');
  if (outcome.kind !== 'rejected') return;
  const snapshot = matrixErrorSnapshot(outcome.reason);
  expect(snapshot).toMatchObject({
    code: expected.code,
    errno: expected.errno,
    message: expected.message,
    responseFinalUrl: expected.sourceUrl,
    responseStatus: expected.responseStatus,
  });
  expect(snapshot.configFinalUrl).toBe(expected.sourceUrl);
  expect(snapshot.requestFullUrl).toBe(expected.sourceUrl);
  expect(snapshot.requestUrl).toBe(expected.sourceUrl);
  expect(snapshot.configRedirectCount).toBe(expected.redirectCount);
  expect(snapshot.configRedirectHistoryLength).toBe(expected.historyLength);
  expect(snapshot.requestMethod).toBe(expected.post ? 'POST' : 'GET');
  expect(snapshot.requestBody).toBe(expected.post ? MATRIX_POST_BODY : undefined);
  expect(snapshot.configOriginalBody).toBe(expected.post ? MATRIX_POST_BODY : undefined);
  expect(snapshot.requestDiagnosticHeader).toBe(expected.post ? MATRIX_POST_HEADER : MATRIX_GET_HEADER);
  if (typeof expected.maxRedirectsReached === 'boolean') {
    expect(snapshot.maxRedirectsReached).toBe(expected.maxRedirectsReached);
  } else {
    expect(snapshot.maxRedirectsReached).not.toBe(true);
  }
  const config = recordField(outcome.reason, 'config');
  const request = recordField(outcome.reason, 'request');
  const response = recordField(outcome.reason, 'response');
  expect(isRecord(config)).toBe(true);
  expect(isRecord(request)).toBe(true);
  expect(isRecord(response)).toBe(true);
  if (isRecord(config)) expect(recordField(config, 'originalRequest')).toBe(request);
  if (isRecord(response)) expect(recordField(response, 'config')).toBe(config);
}

function expectMatrixHttpError(
  outcome: MatrixOutcome,
  sourceUrl: string,
  status: number,
): void {
  expect(outcome.kind).toBe('rejected');
  if (outcome.kind !== 'rejected') return;
  const snapshot = matrixErrorSnapshot(outcome.reason);
  expect(snapshot.code).toBe('REZ_HTTP_ERROR');
  expect(snapshot.errno).toBe(-1031);
  expect(snapshot.responseStatus).toBe(status);
  expect(snapshot.responseFinalUrl).toBe(sourceUrl);
  expect(snapshot.configFinalUrl).toBe(sourceUrl);
  expect(snapshot.requestFullUrl).toBe(sourceUrl);
  expect(snapshot.requestUrl).toBe(sourceUrl);
  expect(snapshot.configRedirectCount).toBe(0);
  expect(snapshot.configRedirectHistoryLength).toBe(0);
  expect(snapshot.maxRedirectsReached).not.toBe(true);
  expect(snapshot.requestMethod).toBe('GET');
  expect(snapshot.requestBody).toBeUndefined();
  expect(snapshot.configOriginalBody).toBeUndefined();
  expect(snapshot.requestDiagnosticHeader).toBe(MATRIX_GET_HEADER);
  const config = recordField(outcome.reason, 'config');
  const request = recordField(outcome.reason, 'request');
  const response = recordField(outcome.reason, 'response');
  expect(isRecord(config)).toBe(true);
  expect(isRecord(request)).toBe(true);
  expect(isRecord(response)).toBe(true);
  if (isRecord(config)) expect(recordField(config, 'originalRequest')).toBe(request);
  if (isRecord(response)) expect(recordField(response, 'config')).toBe(config);
}

function captureHook(capture: MatrixCallbackCapture): RezoHttpRequest['hooks'] {
  return {
    beforeRedirect: [(_context, config, response) => {
      capture.hookConfigs.push(config);
      capture.hookRequests.push(config.originalRequest);
      capture.hookResponses.push(response);
    }],
  };
}

function captureCallback(
  capture: MatrixCallbackCapture,
  result: false | { readonly redirect: false } | true | { readonly redirect: true; readonly url: string },
): NonNullable<RezoHttpRequest['onRedirect']> {
  return (details) => {
    capture.callbackCount += 1;
    capture.callbackBodies.push(details.body);
    capture.callbackMethods.push(details.method);
    return result;
  };
}

function expectedMatrixWire(
  adapter: AdapterName,
  paths: string[],
  post = false,
): Array<{
  readonly body?: string;
  readonly diagnosticHeader?: string;
  readonly method?: string;
  readonly path: string;
  readonly protocol: 'h1' | 'h2';
}> {
  return paths.map((path) => post ? {
    body: MATRIX_POST_BODY,
    diagnosticHeader: MATRIX_POST_HEADER,
    method: 'POST',
    path,
    protocol: adapter === 'http2' ? 'h2' : 'h1',
  } : {
    body: '',
    diagnosticHeader: MATRIX_GET_HEADER,
    method: 'GET',
    path,
    protocol: adapter === 'http2' ? 'h2' : 'h1',
  });
}

function assertNoLateMatrixWire(
  adapter: AdapterName,
  id: string,
  stableWire: WireObservation[],
): void {
  expect(matrixWire(adapter, id)).toEqual(stableWire);
  expect(fixtureErrors).toEqual([]);
}

beforeAll(async () => {
  h1Server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    if (path.startsWith('/phase3/')) {
      void (async () => {
        try {
          const body = await readH1Body(request);
          wireLedger.push({
            body,
            diagnosticHeader: request.headers['x-rezo-matrix'],
            method: request.method,
            path,
            protocol: 'h1',
          });
          const fixture = matrixResponseFor(path);
          response.writeHead(fixture.status, fixture.headers);
          response.end(fixture.body);
        } catch (error) {
          fixtureErrors.push(`matrix h1 fixture failed: ${serializeThrown(error).message}`);
          if (!response.headersSent) response.writeHead(500);
          if (!response.writableEnded) response.end('matrix fixture failure');
        }
      })();
      return;
    }
    wireLedger.push({ path, protocol: 'h1' });
    request.resume();
    if (path === STREAM_PLAIN_SOURCE_PATH) {
      const observer = observePlainStreamSource;
      observePlainStreamSource = undefined;
      if (observer) {
        observer(response);
        return;
      }
      fixtureErrors.push('plain stream source arrived without an observer');
      response.writeHead(500);
      response.end('missing plain stream observer');
      return;
    }
    if (path === STREAM_VALID_SOURCE_PATH) {
      const observer = observeValidStreamSource;
      observeValidStreamSource = undefined;
      if (observer) {
        observer(response);
        return;
      }
      fixtureErrors.push('valid stream source arrived without an observer');
      response.writeHead(500);
      response.end('missing valid stream observer');
      return;
    }
    if (path === STREAM_VALID_TARGET_PATH) {
      response.writeHead(200, {
        'content-length': Buffer.byteLength('stream-final'),
        'content-type': 'text/plain',
      });
      response.end('stream-final');
      return;
    }
    if (path === STREAM_INVALID_SOURCE_PATH) {
      response.writeHead(302, { location: 'http://[' });
      response.end();
      return;
    }
    if (path === sourcePath('http') || path === sourcePath('fetch')) {
      response.writeHead(302, { location: 'http://[' });
      response.end();
      return;
    }
    fixtureErrors.push(`unexpected h1 route: ${path}`);
    response.writeHead(404);
    response.end('unexpected fixture route');
  });
  h1Server.on('connection', (socket) => {
    h1Sockets.add(socket);
    socket.on('close', () => h1Sockets.delete(socket));
  });

  h2Server = http2.createServer();
  h2Server.on('session', (session) => {
    h2Sessions.add(session);
    session.on('close', () => h2Sessions.delete(session));
    session.on('error', () => undefined);
  });
  h2Server.on('stream', (stream, headers) => {
    const path = String(headers[':path'] ?? '/').split('?', 1)[0];
    if (path.startsWith('/phase3/')) {
      void (async () => {
        try {
          const body = await readH2Body(stream);
          wireLedger.push({
            body,
            diagnosticHeader: typeof headers['x-rezo-matrix'] === 'string'
              ? headers['x-rezo-matrix']
              : undefined,
            method: typeof headers[':method'] === 'string' ? headers[':method'] : undefined,
            path,
            protocol: 'h2',
          });
          const fixture = matrixResponseFor(path);
          stream.respond({ ':status': fixture.status, ...fixture.headers });
          stream.end(fixture.body);
        } catch (error) {
          fixtureErrors.push(`matrix h2 fixture failed: ${serializeThrown(error).message}`);
          if (!stream.destroyed && !stream.headersSent) stream.respond({ ':status': 500 });
          if (!stream.destroyed && !stream.closed) stream.end('matrix fixture failure');
        }
      })();
      return;
    }
    wireLedger.push({ path, protocol: 'h2' });
    stream.on('error', () => undefined);
    if (path === sourcePath('http2')) {
      stream.respond({ ':status': 302, location: 'http://[' });
      stream.end();
      return;
    }
    fixtureErrors.push(`unexpected h2 route: ${path}`);
    stream.respond({ ':status': 404 });
    stream.end('unexpected fixture route');
  });

  try {
    h1Port = await listen(h1Server);
    h2Port = await listen(h2Server);
  } catch (error) {
    const cleanup = await Promise.allSettled([closeH1Server(), closeH2Server()]);
    const cleanupErrors = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    throw new AggregateError([error, ...cleanupErrors], 'redirect fixture start/cleanup failed');
  }
});

afterAll(async () => {
  for (const child of activeChildren) child.kill('SIGKILL');
  activeChildren.clear();
  const cleanup = await Promise.allSettled([closeH1Server(), closeH2Server()]);
  const cleanupErrors = cleanup
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'redirect fixture cleanup failed');
  }
});

describe('Phase 1c-c remote malformed-Location safety', () => {
  for (const adapter of ['http', 'fetch', 'http2'] as const) {
    it(`${adapter}: rejects malformed Location structurally without an escaped event or pending caller`, async () => {
      const url = targetUrl(adapter);
      const result = await runProbe(adapter);
      expect({
        adapter: result.adapter,
        callbackCount: result.callbackCount,
        configFinalUrl: result.configFinalUrl,
        configRedirectCount: result.configRedirectCount,
        configRedirectHistory: result.configRedirectHistory,
        error: result.error,
        fixtureErrors,
        globalErrors: result.globalErrors,
        globalUnhandledRejections: result.globalUnhandledRejections,
        lateTurnComplete: result.lateTurnComplete,
        processUncaughtExceptions: result.processUncaughtExceptions,
        processUnhandledRejections: result.processUnhandledRejections,
        responseStatus: result.responseStatus,
        settlement: result.settlement,
        settlementBound: result.settlementBound,
        targetUrl: result.targetUrl,
        wire: wireFor(adapter),
      }).toEqual({
        adapter,
        callbackCount: 0,
        configFinalUrl: url,
        configRedirectCount: 0,
        configRedirectHistory: [],
        error: {
          code: 'ERR_INVALID_URL',
          errno: -1009,
          message: 'Invalid redirect destination URL',
          name: 'RezoError',
          requestFullUrl: url,
          responseFinalUrl: url,
          responseStatus: 302,
        },
        fixtureErrors: [],
        globalErrors: [],
        globalUnhandledRejections: [],
        lateTurnComplete: true,
        processUncaughtExceptions: [],
        processUnhandledRejections: [],
        responseStatus: null,
        settlement: 'rejected',
        settlementBound: 'settled',
        targetUrl: url,
        wire: [{ path: sourcePath(adapter), protocol: adapter === 'http2' ? 'h2' : 'h1' }],
      });
    }, 10_000);
  }

  it('http plain stream publishes its complete lifecycle without raw errors', async () => {
    const sourceUrl = `http://127.0.0.1:${h1Port}${STREAM_PLAIN_SOURCE_PATH}`;
    const wireStart = wireLedger.length;
    const rawEvents = createRawEventCapture();
    const events: string[] = [];
    const streamErrors: SerializedError[] = [];
    let completeEvent: Pick<StreamFinishEvent, 'finalUrl' | 'status'> | null = null;
    let heldSourceResponse: http.ServerResponse | undefined;
    let resolveTerminal: (value: 'complete' | 'error') => void = () => undefined;
    const terminalPromise = new Promise<'complete' | 'error'>((resolveTerminalEvent) => {
      resolveTerminal = resolveTerminalEvent;
    });
    const sourceResponsePromise = new Promise<http.ServerResponse>((resolveSource) => {
      observePlainStreamSource = resolveSource;
    });

    rawEvents.start();
    try {
      const client = new Rezo({}, executeHttpRequest);
      const stream = client.stream(sourceUrl, {
        cache: false,
        retry: false,
        timeout: 5_000,
      });
      stream.on('error', (error) => {
        events.push('error');
        streamErrors.push(serializeThrown(error));
        resolveTerminal('error');
      });
      stream.on('initiated', () => events.push('initiated'));
      stream.on('start', () => events.push('start'));
      stream.on('redirect', () => events.push('redirect'));
      stream.on('headers', (event) => events.push(`headers:${event.status}`));
      stream.on('status', (status) => events.push(`status:${status}`));
      stream.on('cookies', () => events.push('cookies'));
      stream.on('progress', () => events.push('progress'));
      stream.on('data', (chunk) => {
        const text = typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk).toString('utf8');
        events.push(`data:${text}`);
      });
      stream.on('finish', () => events.push('finish'));
      stream.on('done', () => events.push('done'));
      stream.on('complete', (event) => {
        events.push('complete');
        completeEvent = { finalUrl: event.finalUrl, status: event.status };
        resolveTerminal('complete');
      });
      stream.on('close', () => events.push('close'));

      heldSourceResponse = await within(
        sourceResponsePromise,
        2_000,
        'plain stream source was not dispatched',
      );
      heldSourceResponse.writeHead(200, {
        'content-length': Buffer.byteLength('plain-stream'),
        'content-type': 'text/plain',
      });
      heldSourceResponse.end('plain-stream');

      const terminal = await within(
        terminalPromise,
        2_000,
        'plain stream did not complete or emit an error',
      );
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 35));

      expect({
        completeEvent,
        events,
        fixtureErrors,
        rawEvents: {
          globalErrors: rawEvents.globalErrors,
          globalUnhandledRejections: rawEvents.globalUnhandledRejections,
          processUncaughtExceptions: rawEvents.processUncaughtExceptions,
          processUnhandledRejections: rawEvents.processUnhandledRejections,
        },
        streamErrors,
        terminal,
        wire: wireLedger.slice(wireStart),
      }).toEqual({
        completeEvent: { finalUrl: sourceUrl, status: 200 },
        events: [
          'initiated',
          'start',
          'headers:200',
          'status:200',
          'cookies',
          'progress',
          'data:plain-stream',
          'finish',
          'done',
          'complete',
          'close',
        ],
        fixtureErrors: [],
        rawEvents: {
          globalErrors: [],
          globalUnhandledRejections: [],
          processUncaughtExceptions: [],
          processUnhandledRejections: [],
        },
        streamErrors: [],
        terminal: 'complete',
        wire: [{ path: STREAM_PLAIN_SOURCE_PATH, protocol: 'h1' }],
      });
    } finally {
      observePlainStreamSource = undefined;
      if (heldSourceResponse && !heldSourceResponse.writableEnded && !heldSourceResponse.destroyed) {
        heldSourceResponse.end();
      }
      rawEvents.stop();
    }
  }, 10_000);

  it('http stream emits a normalized redirect before the held source body ends and completes the final hop', async () => {
    const sourceUrl = `http://127.0.0.1:${h1Port}${STREAM_VALID_SOURCE_PATH}#retained`;
    const destinationUrl = `http://127.0.0.1:${h1Port}${STREAM_VALID_TARGET_PATH}?via=relative#retained`;
    const wireStart = wireLedger.length;
    const rawEvents = createRawEventCapture();
    const events: string[] = [];
    const redirectEvents: Array<Pick<
      RedirectEvent,
      'destinationUrl' | 'method' | 'redirectCount' | 'sourceStatus' | 'sourceUrl'
    >> = [];
    const streamErrors: SerializedError[] = [];
    let callbackCount = 0;
    let completeEvent: Pick<StreamFinishEvent, 'finalUrl' | 'status'> | null = null;
    let heldSourceResponse: http.ServerResponse | undefined;
    let sourceBodyEndedBeforeRedirect: boolean | null = null;
    let resolveTerminal: (value: 'complete' | 'error') => void = () => undefined;
    const terminalPromise = new Promise<'complete' | 'error'>((resolveTerminalEvent) => {
      resolveTerminal = resolveTerminalEvent;
    });
    const sourceResponsePromise = new Promise<http.ServerResponse>((resolveSource) => {
      observeValidStreamSource = resolveSource;
    });

    rawEvents.start();
    try {
      const client = new Rezo({}, executeHttpRequest);
      const stream = client.stream(sourceUrl, {
        cache: false,
        onRedirect: () => {
          callbackCount++;
          return { redirect: true };
        },
        retry: false,
        timeout: 5_000,
      });
      stream.on('error', (error) => {
        events.push('error');
        streamErrors.push(serializeThrown(error));
        resolveTerminal('error');
      });
      stream.on('initiated', () => events.push('initiated'));
      stream.on('start', () => events.push('start'));
      stream.on('redirect', (event) => {
        events.push('redirect');
        redirectEvents.push({
          destinationUrl: event.destinationUrl,
          method: event.method,
          redirectCount: event.redirectCount,
          sourceStatus: event.sourceStatus,
          sourceUrl: event.sourceUrl,
        });
        sourceBodyEndedBeforeRedirect = heldSourceResponse?.writableEnded ?? null;
        heldSourceResponse?.end('held-redirect-body');
      });
      stream.on('headers', (event) => events.push(`headers:${event.status}`));
      stream.on('status', (status) => events.push(`status:${status}`));
      stream.on('cookies', () => events.push('cookies'));
      stream.on('progress', () => events.push('progress'));
      stream.on('data', (chunk) => {
        const text = typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk).toString('utf8');
        events.push(`data:${text}`);
      });
      stream.on('finish', () => events.push('finish'));
      stream.on('done', () => events.push('done'));
      stream.on('complete', (event) => {
        events.push('complete');
        completeEvent = { finalUrl: event.finalUrl, status: event.status };
        resolveTerminal('complete');
      });
      stream.on('close', () => events.push('close'));
      heldSourceResponse = await within(
        sourceResponsePromise,
        2_000,
        'valid stream source was not dispatched',
      );
      heldSourceResponse.writeHead(302, { location: STREAM_VALID_LOCATION });
      heldSourceResponse.flushHeaders();
      const terminal = await within(
        terminalPromise,
        2_000,
        'valid stream redirect did not complete or emit an error',
      );
      await new Promise<void>((resolveLateTurn) => setTimeout(resolveLateTurn, 35));
      const eventCounts = Object.fromEntries([
        'close', 'complete', 'cookies', 'data', 'done', 'error', 'finish',
        'headers', 'initiated', 'progress', 'redirect', 'start', 'status',
      ].map((eventName) => [eventName, events.filter(
        (event) => event === eventName || event.startsWith(`${eventName}:`),
      ).length]));
      const observation = {
        callbackCount,
        completeEvent,
        data: events.filter((event) => event.startsWith('data:')),
        eventCounts,
        fixtureErrors,
        rawEvents: {
          globalErrors: rawEvents.globalErrors,
          globalUnhandledRejections: rawEvents.globalUnhandledRejections,
          processUncaughtExceptions: rawEvents.processUncaughtExceptions,
          processUnhandledRejections: rawEvents.processUnhandledRejections,
        },
        redirectEvents,
        sourceBodyEndedBeforeRedirect,
        streamErrors,
        terminal,
        wire: wireLedger.slice(wireStart),
      };
      expect(observation).toEqual({
        callbackCount: 1,
        completeEvent: { finalUrl: destinationUrl, status: 200 },
        data: ['data:stream-final'],
        eventCounts: {
          close: 1,
          complete: 1,
          cookies: 1,
          data: 1,
          done: 1,
          error: 0,
          finish: 1,
          headers: 1,
          initiated: 1,
          progress: 1,
          redirect: 1,
          start: 1,
          status: 1,
        },
        fixtureErrors: [],
        rawEvents: {
          globalErrors: [],
          globalUnhandledRejections: [],
          processUncaughtExceptions: [],
          processUnhandledRejections: [],
        },
        redirectEvents: [{
          destinationUrl,
          method: 'GET',
          redirectCount: 1,
          sourceStatus: 302,
          sourceUrl,
        }],
        sourceBodyEndedBeforeRedirect: false,
        streamErrors: [],
        terminal: 'complete',
        wire: [
          { path: STREAM_VALID_SOURCE_PATH, protocol: 'h1' },
          { path: STREAM_VALID_TARGET_PATH, protocol: 'h1' },
        ],
      });
    } finally {
      observeValidStreamSource = undefined;
      if (heldSourceResponse && !heldSourceResponse.writableEnded && !heldSourceResponse.destroyed) {
        heldSourceResponse.end();
      }
      rawEvents.stop();
    }
  }, 10_000);

  it('http stream rejects malformed Location once without publishing response lifecycle events', async () => {
    const url = `http://127.0.0.1:${h1Port}${STREAM_INVALID_SOURCE_PATH}`;
    const result = await runStreamProbe(url);

    expect({
      callbackCount: result.callbackCount,
      configFinalUrl: result.configFinalUrl,
      configRedirectCount: result.configRedirectCount,
      configRedirectHistory: result.configRedirectHistory,
      error: result.error,
      errorIsRezoError: result.errorIsRezoError,
      events: result.events,
      fixtureErrors,
      globalErrors: result.globalErrors,
      globalUnhandledRejections: result.globalUnhandledRejections,
      lateTurnComplete: result.lateTurnComplete,
      processUncaughtExceptions: result.processUncaughtExceptions,
      processUnhandledRejections: result.processUnhandledRejections,
      settlement: result.settlement,
      settlementBound: result.settlementBound,
      targetUrl: result.targetUrl,
      wire: wireLedger.filter((entry) => entry.path === STREAM_INVALID_SOURCE_PATH),
    }).toEqual({
      callbackCount: 0,
      configFinalUrl: url,
      configRedirectCount: 0,
      configRedirectHistory: [],
      error: {
        code: 'ERR_INVALID_URL',
        errno: -1009,
        message: 'Invalid redirect destination URL',
        name: 'RezoError',
        requestFullUrl: url,
        responseFinalUrl: url,
        responseStatus: 302,
      },
      errorIsRezoError: true,
      events: ['initiated', 'start', 'error'],
      fixtureErrors: [],
      globalErrors: [],
      globalUnhandledRejections: [],
      lateTurnComplete: true,
      processUncaughtExceptions: [],
      processUnhandledRejections: [],
      settlement: 'error',
      settlementBound: 'settled',
      targetUrl: url,
      wire: [{ path: STREAM_INVALID_SOURCE_PATH, protocol: 'h1' }],
    });
  }, 10_000);
});

const STANDARD_MATRIX_NAMES = [
  'P1 default three-hop chain resolves final 200',
  'P2 positive maxRedirects exhaustion is typed at hop three',
  'D2-a request zero and same-level false plus zero deny hop one',
  'D2-d instance zero survives request follow true',
  'D2-b request false settles valid/null/malformed source responses',
  'D2-c instance false survives a positive request max',
  'boolean callback refusal is typed and rolls back',
  'object callback refusal is typed and rolls back',
  'request and instance validators remain authoritative under false; rejected 304 remains non-redirect',
  'request true overrides an instance false default',
  'request positive max overrides an instance zero default',
  'callback-finalized alias cycle is typed before a third dispatch',
  'redirect without Location is typed',
  'ordinary callback Error preserves exact identity',
  'primitive callback throw preserves exact value',
  'callback RezoError preserves exact identity',
  'ordinary 404 retains its HTTP error',
  'retry-disabled 500 retains its HTTP error',
] as const;

const H2_MATRIX_NAMES = [
  ...STANDARD_MATRIX_NAMES.slice(0, 6),
  'boolean and object callback refusals are both typed and rolled back',
  STANDARD_MATRIX_NAMES[8],
  STANDARD_MATRIX_NAMES[9],
  STANDARD_MATRIX_NAMES[10],
  STANDARD_MATRIX_NAMES[11],
  STANDARD_MATRIX_NAMES[12],
  STANDARD_MATRIX_NAMES[13],
  STANDARD_MATRIX_NAMES[14],
  STANDARD_MATRIX_NAMES[15],
  'ordinary 404 retains its HTTP error',
  'retry-disabled 500 retains its HTTP error',
  'rejected 304 with Location stays non-redirect',
] as const;

async function runStandardMatrixRow(
  adapter: AdapterName,
  id: string,
  semanticRow: number,
): Promise<void> {
  const prefix = matrixPrefix(adapter, id);
  switch (semanticRow) {
    case 1: {
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(adapter, id, 'chain/0'));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectResolvedMatrixChain(observed.outcome, matrixUrl(adapter, id, 'chain/3'));
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/chain/0`, `${prefix}/chain/1`, `${prefix}/chain/2`, `${prefix}/chain/3`,
      ]));
      return;
    }
    case 2: {
      const sourceUrl = matrixUrl(adapter, id, 'chain/0');
      const terminalUrl = matrixUrl(adapter, id, 'chain/2');
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(adapter, id, 'chain/0', {
          maxRedirects: 2,
        }));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixError(observed.outcome, {
        code: 'REZ_MAX_REDIRECTS_EXCEEDED',
        errno: -1035,
        historyLength: 2,
        maxRedirectsReached: true,
        message: 'Max redirects (2) reached',
        redirectCount: 2,
        responseStatus: 302,
        sourceUrl: terminalUrl,
      });
      expect(sourceUrl).not.toBe(terminalUrl);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/chain/0`, `${prefix}/chain/1`, `${prefix}/chain/2`,
      ]));
      return;
    }
    case 3: {
      const zeroUrl = matrixUrl(adapter, id, 'zero/source');
      const sameLevelUrl = matrixUrl(adapter, id, 'same-level/source');
      const observed = await withMatrixLedger(async () => {
        const zero = await settleMatrix(matrixGet(adapter, id, 'zero/source', {
          maxRedirects: 0,
        }));
        const sameLevel = await settleMatrix(matrixGet(adapter, id, 'same-level/source', {
          followRedirects: false,
          maxRedirects: 0,
        }));
        return { outcomes: [zero, sameLevel] as const, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      for (const [index, outcome] of observed.outcomes.entries()) {
        expectMatrixError(outcome, {
          code: 'REZ_REDIRECT_DENIED',
          errno: -1032,
          historyLength: 0,
          maxRedirectsReached: true,
          message: 'Redirects are disabled (maxRedirects=0)',
          redirectCount: 0,
          responseStatus: 302,
          sourceUrl: index === 0 ? zeroUrl : sameLevelUrl,
        });
      }
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/zero/source`, `${prefix}/same-level/source`,
      ]));
      return;
    }
    case 4: {
      const defaultUrl = matrixUrl(adapter, id, 'default/source');
      const crossOptionUrl = matrixUrl(adapter, id, 'cross-option/source');
      const observed = await withMatrixLedger(async () => {
        const instanceZero = await settleMatrix(matrixGet(
          adapter, id, 'default/source', {}, { maxRedirects: 0 },
        ));
        const requestTrue = await settleMatrix(matrixGet(
          adapter,
          id,
          'cross-option/source',
          { followRedirects: true },
          { maxRedirects: 0 },
        ));
        return { outcomes: [instanceZero, requestTrue] as const, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      for (const [index, outcome] of observed.outcomes.entries()) {
        expectMatrixError(outcome, {
          code: 'REZ_REDIRECT_DENIED',
          errno: -1032,
          historyLength: 0,
          maxRedirectsReached: true,
          message: 'Redirects are disabled (maxRedirects=0)',
          redirectCount: 0,
          responseStatus: 302,
          sourceUrl: index === 0 ? defaultUrl : crossOptionUrl,
        });
      }
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/default/source`, `${prefix}/cross-option/source`,
      ]));
      return;
    }
    case 5: {
      const captures = [createMatrixCapture(), createMatrixCapture(), createMatrixCapture()];
      const observed = await withMatrixLedger(async () => {
        const noValidator = await settleMatrix(matrixGet(adapter, id, 'no-validator/source', {
          followRedirects: false,
          hooks: captureHook(captures[0]),
          onRedirect: captureCallback(captures[0], true),
        }));
        const nullValidator = await settleMatrix(matrixGet(adapter, id, 'null-validator/source', {
          followRedirects: false,
          hooks: captureHook(captures[1]),
          onRedirect: captureCallback(captures[1], true),
          validateStatus: null,
        }));
        const malformed = await settleMatrix(matrixGet(adapter, id, 'invalid/malformed', {
          followRedirects: false,
          hooks: captureHook(captures[2]),
          onRedirect: captureCallback(captures[2], true),
        }));
        return {
          outcomes: [noValidator, nullValidator, malformed] as const,
          stableWire: [...matrixWire(adapter, id)],
        };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectResolvedMatrixSource(
        observed.outcomes[0],
        matrixUrl(adapter, id, 'no-validator/source'),
        `${prefix}/no-validator/forbidden`,
      );
      expectResolvedMatrixSource(
        observed.outcomes[1],
        matrixUrl(adapter, id, 'null-validator/source'),
        `${prefix}/null-validator/forbidden`,
      );
      expectResolvedMatrixSource(
        observed.outcomes[2],
        matrixUrl(adapter, id, 'invalid/malformed'),
        'http://[',
      );
      expect(captures.map((capture) => ({
        callbackCount: capture.callbackCount,
        hookCount: capture.hookConfigs.length,
      }))).toEqual([
        { callbackCount: 0, hookCount: 0 },
        { callbackCount: 0, hookCount: 0 },
        { callbackCount: 0, hookCount: 0 },
      ]);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/no-validator/source`,
        `${prefix}/null-validator/source`,
        `${prefix}/invalid/malformed`,
      ]));
      return;
    }
    case 6: {
      const captures = [createMatrixCapture(), createMatrixCapture()];
      const observed = await withMatrixLedger(async () => {
        const defaultFalse = await settleMatrix(matrixGet(
          adapter,
          id,
          'default/source',
          {
            hooks: captureHook(captures[0]),
            onRedirect: captureCallback(captures[0], true),
          },
          { followRedirects: false },
        ));
        const positiveMax = await settleMatrix(matrixGet(
          adapter,
          id,
          'cross-option/source',
          {
            hooks: captureHook(captures[1]),
            maxRedirects: 5,
            onRedirect: captureCallback(captures[1], true),
          },
          { followRedirects: false },
        ));
        return { outcomes: [defaultFalse, positiveMax] as const, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectResolvedMatrixSource(
        observed.outcomes[0],
        matrixUrl(adapter, id, 'default/source'),
        `${prefix}/default/forbidden`,
      );
      expectResolvedMatrixSource(
        observed.outcomes[1],
        matrixUrl(adapter, id, 'cross-option/source'),
        `${prefix}/cross-option/forbidden`,
      );
      expect(captures.map((capture) => [capture.hookConfigs.length, capture.callbackCount])).toEqual([
        [0, 0], [0, 0],
      ]);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/default/source`, `${prefix}/cross-option/source`,
      ]));
      return;
    }
    case 7:
    case 8: {
      const capture = createMatrixCapture();
      const sourceUrl = matrixUrl(adapter, id, 'callback/start');
      const outcome = await withMatrixLedger(async () => settleMatrix(matrixPost(
        adapter,
        id,
        'callback/start',
        {
          hooks: captureHook(capture),
          onRedirect: captureCallback(capture, semanticRow === 7 ? false : { redirect: false }),
        },
      )));
      const stableWire = [...matrixWire(adapter, id)];
      assertNoLateMatrixWire(adapter, id, stableWire);
      expectMatrixError(outcome, {
        code: 'REZ_REDIRECT_DENIED',
        errno: -1032,
        historyLength: 0,
        message: 'Redirect denied by user',
        post: true,
        redirectCount: 0,
        responseStatus: 307,
        sourceUrl,
      });
      expect({
        callbackBodies: capture.callbackBodies,
        callbackCount: capture.callbackCount,
        callbackMethods: capture.callbackMethods,
        hookCount: capture.hookConfigs.length,
      }).toEqual({
        callbackBodies: [MATRIX_POST_BODY],
        callbackCount: 1,
        callbackMethods: ['POST'],
        hookCount: 1,
      });
      if (outcome.kind === 'rejected') {
        expect(recordField(outcome.reason, 'config')).toBe(capture.hookConfigs[0]);
        expect(recordField(outcome.reason, 'request')).toBe(capture.hookRequests[0]);
        expect(recordField(outcome.reason, 'response')).toBe(capture.hookResponses[0]);
      }
      expectMatrixRollback(capture, sourceUrl);
      expect(stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/callback/start`], true));
      return;
    }
    case 9: {
      const captures = [createMatrixCapture(), createMatrixCapture(), createMatrixCapture()];
      const validator = (status: number): boolean => status >= 200 && status < 300;
      const requestUrl = matrixUrl(adapter, id, 'request/source');
      const defaultUrl = matrixUrl(adapter, id, 'default/source');
      const status304Url = matrixUrl(adapter, id, 'status/304');
      const observed = await withMatrixLedger(async () => {
        const requestValidator = await settleMatrix(matrixGet(adapter, id, 'request/source', {
          followRedirects: false,
          hooks: captureHook(captures[0]),
          onRedirect: captureCallback(captures[0], true),
          validateStatus: validator,
        }));
        const defaultValidator = await settleMatrix(matrixGet(
          adapter,
          id,
          'default/source',
          {
            hooks: captureHook(captures[1]),
            onRedirect: captureCallback(captures[1], true),
          },
          { followRedirects: false, validateStatus: validator },
        ));
        const rejected304 = adapter === 'http2'
          ? null
          : await settleMatrix(matrixGet(adapter, id, 'status/304', {
            hooks: captureHook(captures[2]),
            onRedirect: captureCallback(captures[2], true),
            validateStatus: validator,
          }));
        return {
          outcomes: [requestValidator, defaultValidator] as const,
          rejected304,
          stableWire: [...matrixWire(adapter, id)],
        };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixHttpError(observed.outcomes[0], requestUrl, 302);
      expectMatrixHttpError(observed.outcomes[1], defaultUrl, 302);
      if (adapter === 'http2') {
        expect(observed.rejected304).toBeNull();
        expect(captures.slice(0, 2).map((capture) => [capture.hookConfigs.length, capture.callbackCount])).toEqual([
          [0, 0], [0, 0],
        ]);
        expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
          `${prefix}/request/source`, `${prefix}/default/source`,
        ]));
      } else {
        expect(observed.rejected304).not.toBeNull();
        if (observed.rejected304) expectMatrixHttpError(observed.rejected304, status304Url, 304);
        expect(captures.map((capture) => [capture.hookConfigs.length, capture.callbackCount])).toEqual([
          [0, 0], [0, 0], [0, 0],
        ]);
        expect(matrixErrorSnapshot(
          observed.rejected304?.kind === 'rejected' ? observed.rejected304.reason : undefined,
        ).responseLocation).toBe(`${prefix}/status/forbidden`);
        expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
          `${prefix}/request/source`, `${prefix}/default/source`, `${prefix}/status/304`,
        ]));
      }
      return;
    }
    case 10:
    case 11: {
      const requestOptions: RezoHttpRequest = semanticRow === 10
        ? { followRedirects: true }
        : { maxRedirects: 5 };
      const defaults: RezoDefaultOptions = semanticRow === 10
        ? { followRedirects: false }
        : { maxRedirects: 0 };
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(
          adapter, id, 'chain/0', requestOptions, defaults,
        ));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectResolvedMatrixChain(observed.outcome, matrixUrl(adapter, id, 'chain/3'));
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/chain/0`, `${prefix}/chain/1`, `${prefix}/chain/2`, `${prefix}/chain/3`,
      ]));
      return;
    }
    case 12: {
      const capture = createMatrixCapture();
      const middleUrl = matrixUrl(adapter, id, 'cycle/middle');
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(adapter, id, 'cycle/start', {
          enableRedirectCycleDetection: true,
          hooks: captureHook(capture),
          maxRedirects: 5,
          onRedirect: (details) => {
            capture.callbackCount += 1;
            capture.callbackBodies.push(details.body);
            capture.callbackMethods.push(details.method);
            return { redirect: true, url: middleUrl };
          },
        }));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixError(observed.outcome, {
        code: 'REZ_REDIRECT_CYCLE_DETECTED',
        errno: -1036,
        historyLength: 1,
        message: adapter === 'http'
          ? `Redirect cycle detected: attempting to revisit ${middleUrl}`
          : `Redirect cycle detected: ${middleUrl}`,
        redirectCount: 1,
        responseStatus: 302,
        sourceUrl: middleUrl,
      });
      expect(capture.callbackCount).toBe(2);
      expect(capture.hookConfigs).toHaveLength(2);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [
        `${prefix}/cycle/start`, `${prefix}/cycle/middle`,
      ]));
      return;
    }
    case 13: {
      const sourceUrl = matrixUrl(adapter, id, 'missing');
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(adapter, id, 'missing'));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixError(observed.outcome, {
        code: 'REZ_MISSING_REDIRECT_LOCATION',
        errno: -1028,
        historyLength: 0,
        message: 'Redirect location not found',
        redirectCount: 0,
        responseStatus: 302,
        sourceUrl,
      });
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/missing`]));
      return;
    }
    case 14:
    case 15: {
      const capture = createMatrixCapture();
      const sentinel: unknown = semanticRow === 14
        ? new Error(`${id} ordinary callback sentinel`)
        : `${id} primitive callback sentinel`;
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixPost(adapter, id, 'callback/start', {
          hooks: captureHook(capture),
          onRedirect: (details) => {
            capture.callbackCount += 1;
            capture.callbackBodies.push(details.body);
            capture.callbackMethods.push(details.method);
            throw sentinel;
          },
        }));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expect(observed.outcome.kind).toBe('rejected');
      if (observed.outcome.kind === 'rejected') expect(observed.outcome.reason).toBe(sentinel);
      expect({
        callbackBodies: capture.callbackBodies,
        callbackCount: capture.callbackCount,
        callbackMethods: capture.callbackMethods,
        hookCount: capture.hookConfigs.length,
      }).toEqual({
        callbackBodies: [MATRIX_POST_BODY],
        callbackCount: 1,
        callbackMethods: ['POST'],
        hookCount: 1,
      });
      expectMatrixRollback(capture, matrixUrl(adapter, id, 'callback/start'));
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/callback/start`], true));
      return;
    }
    case 16: {
      const sentinelOutcome = await settleMatrix(matrixGet(
        adapter, `${id}-sentinel`, 'status/404', { validateStatus: () => false },
      ));
      const sentinel = sentinelOutcome.kind === 'rejected'
        ? sentinelOutcome.reason
        : new Error(`${id} failed to create RezoError sentinel`);
      const capture = createMatrixCapture();
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixPost(adapter, id, 'callback/start', {
          hooks: captureHook(capture),
          onRedirect: (details) => {
            capture.callbackCount += 1;
            capture.callbackBodies.push(details.body);
            capture.callbackMethods.push(details.method);
            throw sentinel;
          },
        }));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expect(sentinel).toBeInstanceOf(RezoError);
      expect(observed.outcome.kind).toBe('rejected');
      if (observed.outcome.kind === 'rejected') expect(observed.outcome.reason).toBe(sentinel);
      expect(capture.callbackCount).toBe(1);
      expectMatrixRollback(capture, matrixUrl(adapter, id, 'callback/start'));
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/callback/start`], true));
      return;
    }
    case 17: {
      const notFoundUrl = matrixUrl(adapter, id, 'not-found/status/404');
      const observed = await withMatrixLedger(async () => {
        const notFound = await settleMatrix(matrixGet(adapter, id, 'not-found/status/404'));
        return { outcome: notFound, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixHttpError(observed.outcome, notFoundUrl, 404);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/not-found/status/404`]));
      return;
    }
    case 18: {
      if (adapter !== 'http2') {
        const serverErrorUrl = matrixUrl(adapter, id, 'server-error/status/500');
        const observed = await withMatrixLedger(async () => {
          const outcome = await settleMatrix(matrixGet(adapter, id, 'server-error/status/500'));
          return { outcome, stableWire: [...matrixWire(adapter, id)] };
        });
        assertNoLateMatrixWire(adapter, id, observed.stableWire);
        expectMatrixHttpError(observed.outcome, serverErrorUrl, 500);
        expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/server-error/status/500`]));
        return;
      }
      let callbackCount = 0;
      const sourceUrl = matrixUrl(adapter, id, 'status/304');
      const observed = await withMatrixLedger(async () => {
        const outcome = await settleMatrix(matrixGet(adapter, id, 'status/304', {
          onRedirect: () => {
            callbackCount += 1;
            return true;
          },
          validateStatus: (status) => status >= 200 && status < 300,
        }));
        return { outcome, stableWire: [...matrixWire(adapter, id)] };
      });
      assertNoLateMatrixWire(adapter, id, observed.stableWire);
      expectMatrixHttpError(observed.outcome, sourceUrl, 304);
      expect(callbackCount).toBe(0);
      expect(matrixErrorSnapshot(
        observed.outcome.kind === 'rejected' ? observed.outcome.reason : undefined,
      ).responseLocation).toBe(`${prefix}/status/forbidden`);
      expect(observed.stableWire).toEqual(expectedMatrixWire(adapter, [`${prefix}/status/304`]));
      return;
    }
    default:
      throw new Error(`unknown visible redirect matrix semantic row: ${semanticRow}`);
  }
}

async function runH2MatrixRow(id: string, row: number): Promise<void> {
  if (row >= 1 && row <= 6) {
    await runStandardMatrixRow('http2', id, row);
    return;
  }
  const semanticByH2Row: Readonly<Record<number, number>> = {
    8: 9,
    9: 10,
    10: 11,
    11: 12,
    12: 13,
    13: 14,
    14: 15,
    15: 16,
    18: 18,
  };
  const semanticRow = semanticByH2Row[row];
  if (semanticRow) {
    await runStandardMatrixRow('http2', id, semanticRow);
    return;
  }
  const prefix = matrixPrefix('http2', id);
  if (row === 7) {
    const captures = [createMatrixCapture(), createMatrixCapture()];
    const observed = await withMatrixLedger(async () => {
      const booleanRefusal = await settleMatrix(matrixPost('http2', id, 'boolean/callback/start', {
        hooks: captureHook(captures[0]),
        onRedirect: captureCallback(captures[0], false),
      }));
      const objectRefusal = await settleMatrix(matrixPost('http2', id, 'object/callback/start', {
        hooks: captureHook(captures[1]),
        onRedirect: captureCallback(captures[1], { redirect: false }),
      }));
      return {
        outcomes: [booleanRefusal, objectRefusal] as const,
        stableWire: [...matrixWire('http2', id)],
      };
    });
    assertNoLateMatrixWire('http2', id, observed.stableWire);
    for (const [index, outcome] of observed.outcomes.entries()) {
      expectMatrixError(outcome, {
        code: 'REZ_REDIRECT_DENIED',
        errno: -1032,
        historyLength: 0,
        message: 'Redirect denied by user',
        post: true,
        redirectCount: 0,
        responseStatus: 307,
        sourceUrl: matrixUrl('http2', id, index === 0 ? 'boolean/callback/start' : 'object/callback/start'),
      });
      expectMatrixRollback(
        captures[index],
        matrixUrl('http2', id, index === 0 ? 'boolean/callback/start' : 'object/callback/start'),
      );
    }
    expect(captures.map((capture) => [capture.hookConfigs.length, capture.callbackCount])).toEqual([
      [1, 1], [1, 1],
    ]);
    expect(observed.stableWire).toEqual(expectedMatrixWire('http2', [
      `${prefix}/boolean/callback/start`, `${prefix}/object/callback/start`,
    ], true));
    return;
  }
  if (row === 16 || row === 17) {
    const status = row === 16 ? 404 : 500;
    const route = `status/${status}`;
    const sourceUrl = matrixUrl('http2', id, route);
    const observed = await withMatrixLedger(async () => {
      const outcome = await settleMatrix(matrixGet('http2', id, route));
      return { outcome, stableWire: [...matrixWire('http2', id)] };
    });
    assertNoLateMatrixWire('http2', id, observed.stableWire);
    expectMatrixHttpError(observed.outcome, sourceUrl, status);
    expect(observed.stableWire).toEqual(expectedMatrixWire('http2', [`${prefix}/${route}`]));
    return;
  }
  throw new Error(`unknown HTTP/2 redirect matrix row: ${row}`);
}

describe('Phase 3 full visible redirect contract RED matrix', () => {
  for (const adapter of ['http', 'fetch'] as const) {
    for (const [index, name] of STANDARD_MATRIX_NAMES.entries()) {
      const row = index + 1;
      const id = `${adapter.toUpperCase()}-${String(row).padStart(2, '0')}`;
      it(`${id} — ${name}`, async () => {
        await runStandardMatrixRow(adapter, id, row);
      }, 10_000);
    }
  }

  for (const [index, name] of H2_MATRIX_NAMES.entries()) {
    const row = index + 1;
    const id = `H2-${String(row).padStart(2, '0')}`;
    it(`${id} — ${name}`, async () => {
      await runH2MatrixRow(id, row);
    }, 10_000);
  }
});
