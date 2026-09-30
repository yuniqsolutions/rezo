import { afterAll, afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { Rezo, type AdapterFunction } from '../src/core/rezo';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import { DNSCache, getGlobalDNSCache, resetGlobalDNSCache } from '../src/cache/dns-cache';
import { executeRequest as curlAdapter } from '../src/adapters/curl';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import {
  executeRequest as http2Adapter,
  Http2SessionPool,
} from '../src/adapters/http2';
import { executeRequest as reactNativeAdapter } from '../src/adapters/react-native';
import type { AfterHeadersHook, BeforeRedirectHook } from '../src/core/hooks';
import type { RezoRequestConfig } from '../src/types/rezo-request';
import { getDefaultConfig, prepareHTTPOptions } from '../src/utils/http-config';

declare module 'node:http' {
  interface Agent {
    addRequest(request: ClientRequest, options: ClientRequestArgs): void;
  }
}

type RowId =
  | 'DNS-01' | 'DNS-02' | 'DNS-03A' | 'DNS-03B' | 'DNS-04'
  | 'DNS-05B' | 'DNS-05N' | 'DNS-06' | 'DNS-07' | 'DNS-08'
  | 'DNS-09' | 'DNS-10' | 'DNS-11' | 'DNS-12A' | 'DNS-12S'
  | 'DNS-13A' | 'DNS-13S' | 'DNS-14' | 'DNS-15' | 'DNS-16A'
  | 'DNS-16B' | 'DNS-16C' | 'DNS-17' | 'DNS-18C' | 'DNS-18F' | 'DNS-18H'
  | 'DNS-18R' | 'DNS-18X';
type DNSFamily = 4 | 6;
type PublicLookup = NonNullable<RezoRequestConfig['dnsLookup']>;

interface DNSAddress { address: string; family: DNSFamily }
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly released: boolean;
  release(value: T): void;
  releaseForCleanup(): void;
}
interface DeferredResource {
  readonly promise: Promise<unknown>;
  readonly released: boolean;
  releaseForCleanup(): void;
}
interface ResolverCall { family: DNSFamily | undefined; hostname: string }
interface DNSResolverHarness {
  readonly allCalls: ResolverCall[];
  readonly scalarCalls: ResolverCall[];
  restore(): void;
}
interface CleanupLedger {
  agents: number;
  children: number;
  complete: boolean;
  heldGates: number;
  requests: number;
  responses: number;
  servers: number;
  sockets: number;
  temporaryTlsPaths: number;
  timers: number;
}
interface PhaseLedger {
  cleanup: CleanupLedger;
  cleanupErrors: string[];
  file: string;
  fixtureErrors: string[];
  lateEvents: string[];
  oracleMismatches: string[];
  passed: string[];
  red: string[];
  registered: string[];
  runtime: string;
  schema: string;
  setupErrors: string[];
  skipped: string[];
  teardownErrors: string[];
}

type InfrastructureKind = 'child' | 'cleanup' | 'fixture' | 'setup' | 'teardown' | 'watchdog';

class InfrastructureError extends Error {
  readonly kind: InfrastructureKind;

  constructor(kind: InfrastructureKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'InfrastructureError';
    this.kind = kind;
  }
}

const FILE = 'test/a-plus-dns-cache-transport.test.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const NODE_REGISTERED: RowId[] = [
  'DNS-01', 'DNS-02', 'DNS-03A', 'DNS-03B', 'DNS-04',
  'DNS-05N',
  'DNS-06', 'DNS-07', 'DNS-08', 'DNS-09', 'DNS-10', 'DNS-11',
  'DNS-12A', 'DNS-12S', 'DNS-13A', 'DNS-13S', 'DNS-14', 'DNS-15',
  'DNS-16A', 'DNS-16B', 'DNS-16C', 'DNS-17', 'DNS-18C', 'DNS-18F', 'DNS-18H',
  'DNS-18R', 'DNS-18X',
];
const BUN_REGISTERED: RowId[] = [
  'DNS-01', 'DNS-05B', 'DNS-06', 'DNS-07', 'DNS-08', 'DNS-09',
  'DNS-10', 'DNS-11', 'DNS-16C', 'DNS-17', 'DNS-18C', 'DNS-18F', 'DNS-18H',
  'DNS-18R', 'DNS-18X',
];
const REGISTERED = RUNTIME === 'bun' ? BUN_REGISTERED : NODE_REGISTERED;
// Every registered row is GREEN on both runtimes since the DNS carriers reach the
// HTTP adapter (2026-08-23); the arming machinery stays for any future regression.
const NODE_RED: RowId[] = [];
const BUN_RED: RowId[] = [];
const EXPECTED_RED = RUNTIME === 'bun' ? BUN_RED : NODE_RED;
const EXPECTED_PASSED = REGISTERED.filter((id) => !EXPECTED_RED.includes(id));
const armedRed = new Set<RowId>();
const observedInvocations = new Map<RowId, number>();
const observedFailures = new Set<RowId>();
const observedOracleInvalidities: string[] = [];
const observedPasses = new Set<RowId>();
const cleanupErrors: string[] = [];
const fixtureErrors: string[] = [];
const lateEvents: string[] = [];
const setupErrors: string[] = [];
const teardownErrors: string[] = [];
const activeAgents = new Set<http.Agent>();
const activeChildren = new Set<ChildProcess>();
const activeGates = new Set<DeferredResource>();
const activeHttp2Sessions = new Set<http2.ServerHttp2Session>();
const activeHttp2Streams = new Set<http2.ServerHttp2Stream>();
const activeRequests = new Set<http.ClientRequest>();
const activeResponses = new Set<http.ServerResponse>();
const activeServers = new Set<http.Server | http2.Http2Server | net.Server>();
const activeSockets = new Set<net.Socket>();
const activeTimers = new Set<NodeJS.Timeout>();
const childSettlements = new Map<ChildProcess, Promise<void>>();
const gateSettlements = new Map<DeferredResource, Promise<void>>();
const http2SessionSettlements = new Map<http2.ServerHttp2Session, Promise<void>>();
const http2StreamSettlements = new Map<http2.ServerHttp2Stream, Promise<void>>();
const requestSettlements = new Map<http.ClientRequest, Promise<void>>();
const responseSettlements = new Map<http.ServerResponse, Promise<void>>();
const serverSettlements = new Map<http.Server | http2.Http2Server | net.Server, Promise<void>>();
const socketSettlements = new Map<net.Socket, Promise<void>>();
const settlementCallbacks = new WeakMap<object, () => void>();
let currentRow: RowId | undefined;
let currentRowTerminal = false;
let trackedHttp2SessionPool: Http2SessionPool | undefined;

const SCALAR_CONTROL_HOST = 'scalar-shadow-control.rezo.invalid';
const ALL_CONTROL_HOST = 'all-shadow-control.rezo.invalid';
const priorXmlHttpRequestDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'XMLHttpRequest',
);

interface Http2PoolSnapshot {
  readonly cleanupTimerActive: boolean;
  readonly entries: number;
  readonly leases: number;
  readonly pendingCreations: number;
  readonly sessions: number;
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.get === right.get &&
    left.set === right.set &&
    left.value === right.value &&
    left.writable === right.writable;
}

function http2PoolSnapshot(pool: Http2SessionPool): Http2PoolSnapshot {
  const entries: Map<unknown, unknown> = Reflect.get(pool, 'entriesBySession');
  const pendingCreations: Set<unknown> = Reflect.get(pool, 'pendingCreations');
  const sessions: Map<unknown, unknown> = Reflect.get(pool, 'sessions');
  if (
    !(entries instanceof Map) ||
    !(pendingCreations instanceof Set) ||
    !(sessions instanceof Map)
  ) {
    throw new InfrastructureError('fixture', 'HTTP/2 pool internals were not observable');
  }
  let leases = 0;
  for (const entry of entries.values()) {
    const refCount = Reflect.get(Object(entry), 'refCount');
    if (
      typeof refCount !== 'number' ||
      !Number.isInteger(refCount) ||
      refCount < 0
    ) {
      throw new InfrastructureError('fixture', 'HTTP/2 pool lease count was not observable');
    }
    leases += refCount;
  }
  return {
    cleanupTimerActive: Reflect.get(pool, 'cleanupInterval') !== null,
    entries: entries.size,
    leases,
    pendingCreations: pendingCreations.size,
    sessions: sessions.size,
  };
}

class ControlledProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable = false;
  readonly loaded = 0;
  readonly total = 0;
}

class ControlledXMLHttpRequestUpload extends EventTarget implements XMLHttpRequestUpload {
  onabort: XMLHttpRequestUpload['onabort'] = null;
  onerror: XMLHttpRequestUpload['onerror'] = null;
  onload: XMLHttpRequestUpload['onload'] = null;
  onloadend: XMLHttpRequestUpload['onloadend'] = null;
  onloadstart: XMLHttpRequestUpload['onloadstart'] = null;
  onprogress: XMLHttpRequestUpload['onprogress'] = null;
  ontimeout: XMLHttpRequestUpload['ontimeout'] = null;
}

class ControlledXMLHttpRequest extends EventTarget implements XMLHttpRequest {
  static readonly DONE = 4;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly OPENED = 1;
  static readonly UNSENT = 0;
  readonly DONE = 4;
  readonly HEADERS_RECEIVED = 2;
  readonly LOADING = 3;
  readonly OPENED = 1;
  readonly UNSENT = 0;
  readyState = 0;
  response: unknown = '';
  responseText = '';
  responseType: XMLHttpRequestResponseType = '';
  responseURL = '';
  responseXML: Document | null = null;
  status = 0;
  statusText = '';
  timeout = 0;
  upload = new ControlledXMLHttpRequestUpload();
  withCredentials = false;
  onabort: XMLHttpRequest['onabort'] = null;
  onerror: XMLHttpRequest['onerror'] = null;
  onload: XMLHttpRequest['onload'] = null;
  onloadend: XMLHttpRequest['onloadend'] = null;
  onloadstart: XMLHttpRequest['onloadstart'] = null;
  onprogress: XMLHttpRequest['onprogress'] = null;
  onreadystatechange: XMLHttpRequest['onreadystatechange'] = null;
  ontimeout: XMLHttpRequest['ontimeout'] = null;
  #url = '';

  abort(): void { this.onabort?.call(this, new ControlledProgressEvent('abort')); }
  getAllResponseHeaders(): string { return 'content-type: text/plain\r\ncontent-length: 2\r\n'; }
  getResponseHeader(name: string): string | null {
    if (name.toLowerCase() === 'content-type') return 'text/plain';
    if (name.toLowerCase() === 'content-length') return '2';
    return null;
  }
  open(_method: string, url: string): void { this.#url = url; this.readyState = 1; }
  overrideMimeType(_mime: string): void {}
  send(): void {
    queueMicrotask(() => {
      try {
        this.readyState = 4;
        this.response = 'ok';
        this.responseText = 'ok';
        this.responseURL = this.#url;
        this.status = 200;
        this.statusText = 'OK';
        this.onreadystatechange?.call(this, new Event('readystatechange'));
        this.onload?.call(this, new ControlledProgressEvent('load'));
      } catch (error) {
        recordFixtureError(error);
      }
    });
  }
  setRequestHeader(_name: string, _value: string): void {}
}

Object.defineProperty(globalThis, 'XMLHttpRequest', {
  configurable: true,
  enumerable: priorXmlHttpRequestDescriptor?.enumerable ?? false,
  value: ControlledXMLHttpRequest,
  writable: true,
});
const { executeRequest: xhrAdapter } = await import('../src/adapters/xhr');

function recordInfrastructure(error: InfrastructureError): void {
  const message = `${error.kind}:${error.message}`;
  if (error.kind === 'cleanup') cleanupErrors.push(message);
  else if (error.kind === 'fixture') fixtureErrors.push(message);
  else if (error.kind === 'teardown') teardownErrors.push(message);
  else setupErrors.push(message);
}

async function postTerminalTurn(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => globalThis.setImmediate(resolve));
  await Promise.resolve();
}

function beginTracking<T extends object>(
  resource: T,
  active: Set<T>,
  settlements: Map<T, Promise<void>>,
  installSettlement: (settle: () => void) => void,
): T {
  if (active.has(resource)) return resource;
  let resolveSettlement: (() => void) | undefined;
  let settled = false;
  const settlement = new Promise<void>((resolve) => { resolveSettlement = resolve; });
  const settle = (): void => {
    if (settled) return;
    settled = true;
    active.delete(resource);
    settlements.delete(resource);
    settlementCallbacks.delete(resource);
    resolveSettlement?.();
  };
  active.add(resource);
  settlements.set(resource, settlement);
  settlementCallbacks.set(resource, settle);
  installSettlement(settle);
  return resource;
}

function settleTracked(resource: object): void {
  settlementCallbacks.get(resource)?.();
}

function createDeferred<T>(cleanupValue: T): Deferred<T> {
  let resolver: ((value: T) => void) | undefined;
  let released = false;
  const promise = new Promise<T>((resolve) => { resolver = resolve; });
  const deferred: Deferred<T> = {
    get released() { return released; },
    promise,
    release(value) {
      if (released) return;
      released = true;
      resolver?.(value);
    },
    releaseForCleanup() {
      this.release(cleanupValue);
    },
  };
  const resource: DeferredResource = deferred;
  activeGates.add(resource);
  const settlement = promise.then(() => {
    activeGates.delete(resource);
    gateSettlements.delete(resource);
  });
  gateSettlements.set(resource, settlement);
  return deferred;
}

function recordFixtureError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  fixtureErrors.push(`${currentRow ?? 'file'}:${message}`);
}

function armExpectedRed(id: RowId): void {
  if (currentRow !== id || currentRowTerminal || !EXPECTED_RED.includes(id) || armedRed.has(id)) {
    throw new InfrastructureError('fixture', `invalid expected-RED arm for ${id}`);
  }
  armedRed.add(id);
}

function trackChild(child: ChildProcess): ChildProcess {
  return beginTracking(child, activeChildren, childSettlements, (settle) => {
    child.once('close', settle);
  });
}

function trackRequest(request: http.ClientRequest): http.ClientRequest {
  return beginTracking(request, activeRequests, requestSettlements, (settle) => {
    request.once('close', settle);
  });
}

function trackSocket(socket: net.Socket): net.Socket {
  return beginTracking(socket, activeSockets, socketSettlements, (settle) => {
    socket.on('error', () => undefined);
    socket.once('close', settle);
  });
}

function trackServer<T extends http.Server | http2.Http2Server | net.Server>(server: T): T {
  beginTracking(server, activeServers, serverSettlements, (settle) => {
    server.once('close', settle);
  });
  server.on('connection', (socket: net.Socket) => {
    trackSocket(socket);
  });
  server.on('error', recordFixtureError);
  return server;
}

function trackAgent<T extends http.Agent>(agent: T): T {
  activeAgents.add(agent);
  return agent;
}

function trackHttp2Session(
  session: http2.ServerHttp2Session,
): http2.ServerHttp2Session {
  return beginTracking(
    session,
    activeHttp2Sessions,
    http2SessionSettlements,
    (settle) => {
      session.on('error', (error) => {
        if (!currentRowTerminal) recordFixtureError(error);
      });
      session.once('close', settle);
    },
  );
}

function trackHttp2Stream(
  stream: http2.ServerHttp2Stream,
): http2.ServerHttp2Stream {
  return beginTracking(
    stream,
    activeHttp2Streams,
    http2StreamSettlements,
    (settle) => {
      stream.once('close', settle);
    },
  );
}

function trackResponse(response: http.ServerResponse): http.ServerResponse {
  if (currentRowTerminal) lateEvents.push(`${currentRow ?? 'file'}:response-after-terminal`);
  return beginTracking(response, activeResponses, responseSettlements, (settle) => {
    response.once('finish', settle);
    response.once('close', settle);
    response.on('error', (error) => {
      if (!currentRowTerminal) recordFixtureError(error);
    });
  });
}

function createHttpFixture(listener: http.RequestListener): http.Server {
  return trackServer(http.createServer((request, response) => {
    trackResponse(response);
    try {
      listener(request, response);
    } catch (error) {
      recordFixtureError(error);
      safeEnd(response);
    }
  }));
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
  kind: InfrastructureKind = 'watchdog',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(kind, label)), milliseconds);
    activeTimers.add(timer);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(timer);
    }
  }
}

async function observeRow(id: RowId, operation: () => Promise<void> | void): Promise<void> {
  observedInvocations.set(id, (observedInvocations.get(id) ?? 0) + 1);
  currentRow = id;
  currentRowTerminal = false;
  try {
    await operation();
    if (armedRed.delete(id)) {
      throw new InfrastructureError('fixture', `${id} passed its desired assertion after arming RED`);
    }
    currentRowTerminal = true;
    await postTerminalTurn();
    observedPasses.add(id);
  } catch (error) {
    const wasArmed = armedRed.delete(id);
    currentRowTerminal = true;
    await postTerminalTurn();
    if (error instanceof InfrastructureError) recordInfrastructure(error);
    else if (wasArmed) observedFailures.add(id);
    else {
      const detail = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      observedOracleInvalidities.push(`unarmed-failure:${id}:${detail}`);
    }
    throw error;
  }
}

async function listenHttp(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(new InfrastructureError('setup', 'HTTP fixture listen failed', error));
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new InfrastructureError('setup', 'HTTP fixture port absent');
  }
  return (address as AddressInfo).port;
}

async function listenHttp2(server: http2.Http2Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(new InfrastructureError('setup', 'HTTP/2 fixture listen failed', error));
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new InfrastructureError('setup', 'HTTP/2 fixture port absent');
  }
  return (address as AddressInfo).port;
}

function safeEnd(response: http.ServerResponse, body = ''): void {
  if (!response.destroyed && !response.writableEnded) response.end(body);
}

function agentIsDrained(agent: http.Agent): boolean {
  const socketCount = Object.values(agent.sockets).reduce((sum, sockets) => sum + (sockets?.length ?? 0), 0);
  const freeSocketCount = Object.values(agent.freeSockets).reduce((sum, sockets) => sum + (sockets?.length ?? 0), 0);
  const requestCount = Object.values(agent.requests).reduce((sum, requests) => sum + (requests?.length ?? 0), 0);
  return socketCount === 0 && freeSocketCount === 0 && requestCount === 0;
}

function attemptCleanup(label: string, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    cleanupErrors.push(`${label}:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cleanupResources(): Promise<void> {
  try {
    for (const server of [...activeServers]) {
      attemptCleanup('cleanup:server-close', () => {
        if (server.listening) {
          server.close((error?: Error) => {
            if (error) cleanupErrors.push(`cleanup:server-close-callback:${error.message}`);
          });
        } else if (server.address() === null) {
          settleTracked(server);
        }
      });
    }
    for (const gate of [...activeGates]) {
      attemptCleanup('cleanup:gate-release', () => gate.releaseForCleanup());
    }
    for (const request of [...activeRequests]) {
      attemptCleanup('cleanup:request-destroy', () => request.destroy());
    }
    for (const response of [...activeResponses]) {
      attemptCleanup('cleanup:response-end', () => safeEnd(response));
    }
    for (const child of [...activeChildren]) {
      attemptCleanup('cleanup:child-kill', () => { child.kill('SIGKILL'); });
    }
    for (const agent of [...activeAgents]) {
      attemptCleanup('cleanup:agent-destroy', () => agent.destroy());
    }
    for (const stream of [...activeHttp2Streams]) {
      attemptCleanup('cleanup:http2-stream-destroy', () => stream.destroy());
    }
    for (const session of [...activeHttp2Sessions]) {
      attemptCleanup('cleanup:http2-session-destroy', () => session.destroy());
    }
    if (trackedHttp2SessionPool) {
      attemptCleanup('cleanup:http2-pool-destroy', () => trackedHttp2SessionPool?.destroy());
    }
    for (const socket of [...activeSockets]) {
      attemptCleanup('cleanup:socket-destroy', () => socket.destroy());
    }
    for (const server of [...activeServers]) {
      if ('closeIdleConnections' in server) {
        attemptCleanup('cleanup:server-close-idle', () => server.closeIdleConnections());
      }
      if ('closeAllConnections' in server) {
        attemptCleanup('cleanup:server-close-all', () => server.closeAllConnections());
      }
    }
    const pendingSettlements = [
      ...childSettlements.values(),
      ...gateSettlements.values(),
      ...http2SessionSettlements.values(),
      ...http2StreamSettlements.values(),
      ...requestSettlements.values(),
      ...responseSettlements.values(),
      ...serverSettlements.values(),
      ...socketSettlements.values(),
    ];
    await within(
      Promise.all(pendingSettlements).then(() => undefined),
      5_000,
      'DNS cleanup resource settlement timed out',
      'cleanup',
    );
    await postTerminalTurn();
    for (const agent of [...activeAgents]) {
      if (agentIsDrained(agent)) activeAgents.delete(agent);
      else cleanupErrors.push('cleanup:DNS Agent retained sockets, requests, or free sockets after destroy');
    }
    if (trackedHttp2SessionPool) {
      try {
        const poolSnapshot = http2PoolSnapshot(trackedHttp2SessionPool);
        if (
          poolSnapshot.cleanupTimerActive ||
          poolSnapshot.entries !== 0 ||
          poolSnapshot.leases !== 0 ||
          poolSnapshot.pendingCreations !== 0 ||
          poolSnapshot.sessions !== 0
        ) {
          cleanupErrors.push(`cleanup:HTTP/2 pool retained ${JSON.stringify(poolSnapshot)}`);
        }
      } catch (error) {
        cleanupErrors.push(
          `cleanup:HTTP/2 pool inspection failed:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof InfrastructureError) recordInfrastructure(error);
    else cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  for (const timer of activeTimers) clearTimeout(timer);
}

function restoreOwnProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  const restored = descriptor === undefined
    ? Reflect.deleteProperty(target, key)
    : Reflect.defineProperty(target, key, descriptor);
  if (!restored) {
    throw new InfrastructureError('teardown', `failed to restore DNS descriptor ${String(key)}`);
  }
}

async function installDNSResolverHarness(
  cache: DNSCache,
  scalarResolver: (hostname: string, family?: DNSFamily) => Promise<DNSAddress | undefined>,
  allResolver: (hostname: string, family?: DNSFamily) => Promise<DNSAddress[]>,
): Promise<DNSResolverHarness> {
  const previousScalar = Object.getOwnPropertyDescriptor(cache, 'resolveDNS');
  const previousAll = Object.getOwnPropertyDescriptor(cache, 'resolveAllDNS');
  const scalarCalls: ResolverCall[] = [];
  const allCalls: ResolverCall[] = [];
  const resolveDNS = async (hostname: string, family?: DNSFamily): Promise<DNSAddress | undefined> => {
    scalarCalls.push({ family, hostname });
    if (hostname === SCALAR_CONTROL_HOST) return { address: '127.0.0.201', family: 4 };
    return scalarResolver(hostname, family);
  };
  const resolveAllDNS = async (hostname: string, family?: DNSFamily): Promise<DNSAddress[]> => {
    allCalls.push({ family, hostname });
    if (hostname === ALL_CONTROL_HOST) return [{ address: '::1', family: 6 }];
    return allResolver(hostname, family);
  };
  let scalarInstalled = false;
  let allInstalled = false;
  let active = true;
  const restore = (): void => {
    if (!active) return;
    const errors: unknown[] = [];
    if (allInstalled) {
      try { restoreOwnProperty(cache, 'resolveAllDNS', previousAll); } catch (error) { errors.push(error); }
    }
    if (scalarInstalled) {
      try { restoreOwnProperty(cache, 'resolveDNS', previousScalar); } catch (error) { errors.push(error); }
    }
    active = false;
    if (errors.length > 0) {
      throw new InfrastructureError(
        'teardown',
        'DNS descriptor restoration failed',
        new AggregateError(errors),
      );
    }
  };
  try {
    scalarInstalled = Reflect.defineProperty(cache, 'resolveDNS', {
      configurable: true, enumerable: false, value: resolveDNS, writable: true,
    });
    allInstalled = Reflect.defineProperty(cache, 'resolveAllDNS', {
      configurable: true, enumerable: false, value: resolveAllDNS, writable: true,
    });
    if (!scalarInstalled || !allInstalled) {
      throw new InfrastructureError('setup', 'DNS resolver shadow installation failed');
    }
    const scalarControl = await cache.lookup(SCALAR_CONTROL_HOST, 4);
    const allControl = await cache.lookupAll(ALL_CONTROL_HOST, 6);
    expect(scalarControl).toEqual({ address: '127.0.0.201', family: 4 });
    expect(allControl).toEqual([{ address: '::1', family: 6 }]);
    expect(scalarCalls).toHaveLength(1);
    expect(allCalls).toHaveLength(1);
    cache.clear();
    scalarCalls.length = 0;
    allCalls.length = 0;
  } catch (error) {
    try {
      restore();
    } catch (restoreError) {
      throw restoreError;
    }
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('setup', 'DNS resolver shadow self-control failed', error);
  }
  return { allCalls, restore, scalarCalls };
}

interface ControlledClock {
  advance(milliseconds: number): void;
  restore(): void;
}

function installControlledClock(start: number): ControlledClock {
  const previous = Object.getOwnPropertyDescriptor(Date, 'now');
  if (!previous) throw new InfrastructureError('setup', 'Date.now descriptor absent');
  let current = start;
  let active = true;
  if (!Reflect.defineProperty(Date, 'now', { ...previous, value: () => current })) {
    throw new InfrastructureError('setup', 'controlled clock install failed');
  }
  return {
    advance(milliseconds) { current += milliseconds; },
    restore() {
      if (!active) return;
      active = false;
      if (!Reflect.defineProperty(Date, 'now', previous)) {
        throw new InfrastructureError('teardown', 'controlled clock restore failed');
      }
    },
  };
}

afterEach(async () => {
  await cleanupResources();
  currentRow = undefined;
  currentRowTerminal = false;
});

afterAll(async () => {
  await cleanupResources();
  try {
    if (priorXmlHttpRequestDescriptor === undefined) {
      if (!Reflect.deleteProperty(globalThis, 'XMLHttpRequest')) {
        throw new InfrastructureError('teardown', 'controlled XMLHttpRequest deletion failed');
      }
    } else {
      Object.defineProperty(
        globalThis,
        'XMLHttpRequest',
        priorXmlHttpRequestDescriptor,
      );
    }
    const restoredXmlHttpRequestDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'XMLHttpRequest',
    );
    if (!samePropertyDescriptor(
      restoredXmlHttpRequestDescriptor,
      priorXmlHttpRequestDescriptor,
    )) {
      throw new InfrastructureError('teardown', 'controlled XMLHttpRequest descriptor mismatch');
    }
  } catch (error) {
    recordInfrastructure(new InfrastructureError('teardown', 'controlled XMLHttpRequest restore failed', error));
  }
  resetGlobalDNSCache();
  const expectedRed = [...EXPECTED_RED].sort();
  const expectedPassed = [...EXPECTED_PASSED].sort();
  const actualRed = [...observedFailures].sort();
  const actualPassed = [...observedPasses].sort();
  const actualRegistered = [...observedInvocations.keys()].sort();
  const oracleMismatches = [...observedOracleInvalidities];
  if (armedRed.size !== 0) {
    oracleMismatches.push(`armed-after-file:${JSON.stringify([...armedRed].sort())}`);
  }
  for (const id of REGISTERED) {
    const count = observedInvocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
  }
  for (const [id, count] of observedInvocations) {
    if (!REGISTERED.includes(id)) oracleMismatches.push(`unexpected-invocations:${id}:${count}`);
  }
  if (JSON.stringify(actualRegistered) !== JSON.stringify([...REGISTERED].sort())) {
    oracleMismatches.push(`registered:${JSON.stringify(actualRegistered)}`);
  }
  if (JSON.stringify(actualRed) !== JSON.stringify(expectedRed)) {
    oracleMismatches.push(`red:${JSON.stringify(actualRed)}`);
  }
  if (JSON.stringify(actualPassed) !== JSON.stringify(expectedPassed)) {
    oracleMismatches.push(`passed:${JSON.stringify(actualPassed)}`);
  }
  const cleanup: CleanupLedger = {
    agents: activeAgents.size,
    children: activeChildren.size,
    complete: cleanupErrors.length === 0 && teardownErrors.length === 0
      && activeAgents.size === 0
      && activeChildren.size === 0 && activeGates.size === 0
      && activeHttp2Sessions.size === 0 && activeHttp2Streams.size === 0
      && activeRequests.size === 0 && activeResponses.size === 0
      && activeServers.size === 0 && activeSockets.size === 0
      && activeTimers.size === 0 && childSettlements.size === 0
      && gateSettlements.size === 0 && requestSettlements.size === 0
      && http2SessionSettlements.size === 0 && http2StreamSettlements.size === 0
      && responseSettlements.size === 0 && serverSettlements.size === 0
      && socketSettlements.size === 0,
    heldGates: [...activeGates].filter((gate) => !gate.released).length,
    requests: activeRequests.size,
    responses: activeResponses.size,
    servers: activeServers.size,
    sockets: activeSockets.size,
    temporaryTlsPaths: 0,
    timers: activeTimers.size,
  };
  const ledger: PhaseLedger = {
    cleanup,
    cleanupErrors,
    file: FILE,
    fixtureErrors,
    lateEvents,
    oracleMismatches,
    passed: actualPassed,
    red: actualRed,
    registered: actualRegistered,
    runtime: RUNTIME,
    schema: 'rezo.etimedout.phase1.ledger/v1',
    setupErrors,
    skipped: [],
    teardownErrors,
  };
  console.log(`REZO_PHASE1_LEDGER_V1:${JSON.stringify(ledger)}`);
  // Fail closed: the ledger is an oracle, not a printout.
  expect(ledger.oracleMismatches).toEqual([]);
  expect(ledger.fixtureErrors).toEqual([]);
  expect(ledger.setupErrors).toEqual([]);
  expect(ledger.teardownErrors).toEqual([]);
  expect(ledger.cleanupErrors).toEqual([]);
  expect(ledger.cleanup.complete).toBe(true);
});

function fixedLookup(address: string, family: DNSFamily): PublicLookup {
  return (_hostname, _options, callback) => callback(null, address, family);
}

interface NativeLoaderResult {
  address: string | null;
  family: number | null;
  runtime: 'bun' | 'node';
  schema: 'rezo.etimedout.phase1.dns-native-child/v1';
  size: number;
  version: string;
}

const NATIVE_CHILD_PREFIX = 'REZO_DNS_NATIVE_CHILD_V1:';
const NATIVE_CHILD_SCHEMA = 'rezo.etimedout.phase1.dns-native-child/v1';

interface SelectedLookupCall {
  all: boolean;
  error: unknown | null;
  family: number | undefined;
  hints: number | undefined;
  hostname: string;
  order: unknown;
  result: unknown[];
}

interface ControlledLookupLedger {
  bootstrapSelections: number;
  connections: number;
  missingSelections: number;
  selectedCalls: SelectedLookupCall[];
}

interface CapturedOutcome {
  error: unknown | null;
  value: unknown | null;
}

async function capture(promise: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    return { error: null, value: await promise };
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    return { error, value: null };
  }
}

class ControlledLookupAgent extends http.Agent {
  readonly selectedCalls: SelectedLookupCall[];

  get bootstrapSelections(): number { return this.ledger.bootstrapSelections; }
  get connections(): number { return this.ledger.connections; }
  get missingSelections(): number { return this.ledger.missingSelections; }

  constructor(
    private readonly destinationPort: number,
    private readonly forceAll: boolean,
    private missingLookupBudget = 0,
    private readonly ledger: ControlledLookupLedger = {
      bootstrapSelections: 0, connections: 0, missingSelections: 0, selectedCalls: [],
    },
  ) {
    super({ keepAlive: false, maxSockets: 1 });
    this.selectedCalls = ledger.selectedCalls;
  }

  override addRequest(request: http.ClientRequest, options: http.ClientRequestArgs): void {
    trackRequest(request);
    super.addRequest(request, options);
  }

  override createConnection(
    options: http.ClientRequestArgs,
    callback?: (error: Error | null, socket: net.Socket) => void,
  ): net.Socket {
    void callback;
    this.ledger.connections += 1;
    const selectedLookup = options.lookup;
    const lookup = ((
      hostname: string,
      runtimeOptions: unknown,
      completion: (...args: unknown[]) => void,
    ) => {
      if (!selectedLookup) {
        if (this.missingLookupBudget > 0) {
          this.missingLookupBudget -= 1;
          this.ledger.bootstrapSelections += 1;
          const runtimeAll = typeof runtimeOptions === 'object'
            && runtimeOptions !== null
            && Reflect.get(runtimeOptions, 'all') === true;
          Reflect.apply(completion, undefined, runtimeAll
            ? [null, [{ address: '127.0.0.1', family: 4 }]]
            : [null, '127.0.0.1', 4]);
          return;
        }
        this.ledger.missingSelections += 1;
        const error = new Error('controlled selected lookup absent') as NodeJS.ErrnoException;
        error.code = 'ENOTFOUND';
        Reflect.apply(completion, undefined, [error]);
        return;
      }
      const forcedOptions = {
        all: this.forceAll,
        family: 4,
        hints: 0,
        order: 'verbatim' as const,
      };
      const selectedCompletion = (...args: unknown[]): void => {
        this.selectedCalls.push({
          all: this.forceAll,
          error: args[0] ?? null,
          family: forcedOptions.family,
          hints: forcedOptions.hints,
          hostname,
          order: forcedOptions.order,
          result: args.slice(1),
        });
        const error = args[0];
        if (error instanceof Error) {
          Reflect.apply(completion, undefined, [error]);
          return;
        }
        const runtimeAll = typeof runtimeOptions === 'object'
          && runtimeOptions !== null
          && Reflect.get(runtimeOptions, 'all') === true;
        Reflect.apply(completion, undefined, runtimeAll
          ? [null, [{ address: '127.0.0.1', family: 4 }]]
          : [null, '127.0.0.1', 4]);
      };
      Reflect.apply(selectedLookup, undefined, [hostname, forcedOptions, selectedCompletion]);
    }) as net.LookupFunction;
    return trackSocket(net.createConnection({
      host: String(options.hostname ?? options.host),
      lookup,
      port: Number(options.port ?? this.destinationPort),
    }));
  }
}

async function runNativeLoaderChild(): Promise<NativeLoaderResult> {
  const cacheUrl = new URL('../src/cache/dns-cache.ts', import.meta.url).href;
  const source = [
    `const { DNSCache } = await import(${JSON.stringify(cacheUrl)});`,
    `const cache = new DNSCache({ enable: true, ttl: 60000, maxEntries: 8 });`,
    `const result = await cache.lookup('localhost', 4);`,
    `const runtime = typeof process.versions.bun === 'string' ? 'bun' : 'node';`,
    `const version = runtime === 'bun' ? process.versions.bun : process.version;`,
    `console.log(${JSON.stringify(NATIVE_CHILD_PREFIX)} + JSON.stringify({`,
    `  address: result?.address ?? null, family: result?.family ?? null, runtime,`,
    `  schema: ${JSON.stringify(NATIVE_CHILD_SCHEMA)}, size: cache.size, version,`,
    `}));`,
  ].join('\n');
  const args = RUNTIME === 'bun'
    ? ['--eval', source]
    : ['--import', 'tsx', '--input-type=module', '--eval', source];
  const resolvedPath = process.env.PATH;
  if (typeof resolvedPath !== 'string' || resolvedPath.length === 0) {
    throw new InfrastructureError('setup', 'native DNS loader child PATH absent');
  }
  const child = trackChild(spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { PATH: resolvedPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let stdout = '';
  let stderr = '';
  if (!child.stdout || !child.stderr) {
    throw new InfrastructureError('child', 'native DNS loader child pipes absent');
  }
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const exit = await within(new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', (error) => {
      reject(new InfrastructureError('child', 'native DNS loader child launch failed', error));
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  }), 10_000, 'native DNS loader child timed out');
  if (exit.code !== 0 || exit.signal !== null) {
    throw new InfrastructureError(
      'child',
      `native DNS loader child failed: ${JSON.stringify({ exit, stderr, stdout })}`,
    );
  }
  if (stderr !== '') {
    throw new InfrastructureError('child', `native DNS loader child stderr was non-empty: ${stderr}`);
  }
  const lines = stdout.split(/\r?\n/u);
  if (lines.length !== 2 || lines[1] !== '' || !lines[0]?.startsWith(NATIVE_CHILD_PREFIX)) {
    throw new InfrastructureError(
      'child',
      `native DNS loader child output invalid: ${JSON.stringify({ stderr, stdout })}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0].slice(NATIVE_CHILD_PREFIX.length));
  } catch (error) {
    throw new InfrastructureError('child', 'native DNS loader child JSON invalid', error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InfrastructureError('child', 'native DNS loader child payload was not an object');
  }
  const keys = Object.keys(parsed).sort();
  const expectedKeys = ['address', 'family', 'runtime', 'schema', 'size', 'version'];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new InfrastructureError('child', `native DNS loader child keys invalid: ${JSON.stringify(keys)}`);
  }
  const address = Reflect.get(parsed, 'address');
  const family = Reflect.get(parsed, 'family');
  const runtime = Reflect.get(parsed, 'runtime');
  const schema = Reflect.get(parsed, 'schema');
  const size = Reflect.get(parsed, 'size');
  const version = Reflect.get(parsed, 'version');
  const expectedVersion = RUNTIME === 'bun' ? process.versions.bun : process.version;
  const addressIsValid = address === null || (typeof address === 'string' && net.isIP(address) !== 0);
  const familyIsValid = family === null || family === 4 || family === 6;
  if (
    !addressIsValid || !familyIsValid || runtime !== RUNTIME || schema !== NATIVE_CHILD_SCHEMA ||
    typeof size !== 'number' || !Number.isInteger(size) || size < 0 ||
    typeof version !== 'string' || version !== expectedVersion
  ) {
    throw new InfrastructureError(
      'child',
      `native DNS loader child payload invalid: ${JSON.stringify(parsed)}`,
    );
  }
  if (address === null && (family !== null || size !== 0)) {
    throw new InfrastructureError(
      'child',
      `native DNS loader child null tuple invalid: ${JSON.stringify({ address, family, size })}`,
    );
  }
  return { address, family, runtime, schema, size, version };
}

interface RedirectCarrierResult {
  destinationCache: unknown;
  destinationHits: number;
  destinationLookupIsSeeded: boolean;
  hookCalls: number;
  resolverCalls: number;
  selectedCalls: number;
  sourceHits: number;
  status: number | undefined;
}

async function runRedirectCarrierRow(): Promise<RedirectCarrierResult> {
  let sourceHits = 0;
  let destinationHits = 0;
  let resolverCalls = 0;
  let hookCalls = 0;
  let hookInfrastructureError: InfrastructureError | undefined;
  const destination = createHttpFixture((_request, response) => {
    destinationHits += 1;
    response.end('ok');
  });
  const destinationPort = await listenHttp(destination);
  const source = createHttpFixture((_request, response) => {
    sourceHits += 1;
    response.writeHead(302, {
      location: `http://dns-03.rezo.test:${destinationPort}/destination`,
    });
    response.end();
  });
  const sourcePort = await listenHttp(source);
  const agent = trackAgent(new ControlledLookupAgent(destinationPort, false));
  const lookup: PublicLookup = (hostname, options, callback) => {
    resolverCalls += 1;
    expect(hostname).toBe('dns-03.rezo.test');
    expect(Reflect.get(Object(options), 'all')).toBe(false);
    callback(null, '127.0.0.1', 4);
  };
  const hook: BeforeRedirectHook = (context) => {
    hookCalls += 1;
    if (!Reflect.set(context.request, 'dnsLookup', lookup)) {
      hookInfrastructureError = new InfrastructureError('setup', 'DNS-03 redirect lookup seed failed');
      throw hookInfrastructureError;
    }
    if (!Reflect.set(context.request, 'dnsCache', false)) {
      hookInfrastructureError = new InfrastructureError('setup', 'DNS-03 redirect cache seed failed');
      throw hookInfrastructureError;
    }
  };
  const outcome = await capture(within(
    new Rezo({}, httpAdapter).get(
      `http://127.0.0.1:${sourcePort}/source`,
      { hooks: { beforeRedirect: [hook] }, httpAgent: agent, retry: false },
    ),
    10_000,
    'DNS-03 redirect request timed out',
  ));
  if (hookInfrastructureError) throw hookInfrastructureError;
  const terminalCounts = { destinationHits, hookCalls, resolverCalls, selectedCalls: agent.selectedCalls.length, sourceHits };
  await postTerminalTurn();
  expect({ destinationHits, hookCalls, resolverCalls, selectedCalls: agent.selectedCalls.length, sourceHits })
    .toEqual(terminalCounts);
  const terminalConfig = Reflect.get(Object(outcome.value ?? outcome.error), 'config');
  const destinationRequest = Reflect.get(Object(terminalConfig), 'originalRequest');
  return {
    destinationCache: Reflect.get(Object(destinationRequest), 'dnsCache'),
    destinationHits,
    destinationLookupIsSeeded: Reflect.get(Object(destinationRequest), 'dnsLookup') === lookup,
    hookCalls,
    resolverCalls,
    selectedCalls: agent.selectedCalls.length,
    sourceHits,
    status: outcome.value ? Reflect.get(Object(outcome.value), 'status') as number | undefined : undefined,
  };
}

interface RetryTransportOptions {
  all: boolean;
  client?: Rezo;
  dnsCache: RezoRequestConfig['dnsCache'];
  dnsLookup?: PublicLookup;
  requestCache?: DNSCache;
}

interface RetryTransportResult {
  agent: ControlledLookupAgent;
  attempts: number;
  error: unknown | null;
  hookCalls: number;
  status: number | undefined;
  terminalCache: unknown;
  terminalLookupIsSeeded: boolean | null;
  terminalRequestCache: unknown;
  terminalRequestIsHookRequest: boolean;
}

async function runRetryTransport(options: RetryTransportOptions): Promise<RetryTransportResult> {
  let attempts = 0;
  let hookCalls = 0;
  let hookRequest: object | undefined;
  let hookInfrastructureError: InfrastructureError | undefined;
  let carrierSeeded = false;
  const server = createHttpFixture((_request, response) => {
    attempts += 1;
    if (attempts === 1) {
      response.writeHead(503, { connection: 'close' });
      response.end('retry');
      return;
    }
    response.end('ok');
  });
  const port = await listenHttp(server);
  const lookupLedger: ControlledLookupLedger = {
    bootstrapSelections: 0, connections: 0, missingSelections: 0, selectedCalls: [],
  };
  let agent = trackAgent(new ControlledLookupAgent(port, options.all, 1, lookupLedger));
  const afterHeaders: AfterHeadersHook = (_event, config) => {
    if (carrierSeeded) return;
    carrierSeeded = true;
    hookCalls += 1;
    const liveRequest = config.originalRequest;
    hookRequest = liveRequest;
    agent = trackAgent(new ControlledLookupAgent(port, options.all, 0, lookupLedger));
    if (!Reflect.set(liveRequest, 'httpAgent', agent)) {
      hookInfrastructureError = new InfrastructureError('setup', 'fresh retry agent seed failed');
      throw hookInfrastructureError;
    }
    if (!Reflect.set(liveRequest, 'useAgentPool', false)) {
      hookInfrastructureError = new InfrastructureError('setup', 'pool-off carrier seed failed');
      throw hookInfrastructureError;
    }
    if (!Reflect.set(liveRequest, 'dnsCache', options.dnsCache)) {
      hookInfrastructureError = new InfrastructureError('setup', 'DNS cache carrier seed failed');
      throw hookInfrastructureError;
    }
    if (options.dnsLookup && !Reflect.set(liveRequest, 'dnsLookup', options.dnsLookup)) {
      hookInfrastructureError = new InfrastructureError('setup', 'custom lookup carrier seed failed');
      throw hookInfrastructureError;
    }
    if (options.requestCache && !Reflect.set(liveRequest, '_dnsCache', options.requestCache)) {
      hookInfrastructureError = new InfrastructureError('setup', 'request cache carrier seed failed');
      throw hookInfrastructureError;
    }
    expect(Reflect.get(liveRequest, 'useAgentPool')).toBe(false);
    expect(Reflect.get(liveRequest, 'dnsCache')).toBe(options.dnsCache);
    if (options.dnsLookup) expect(Reflect.get(liveRequest, 'dnsLookup')).toBe(options.dnsLookup);
    if (options.requestCache) expect(Reflect.get(liveRequest, '_dnsCache')).toBe(options.requestCache);
    expect(Reflect.get(liveRequest, 'httpAgent')).toBe(agent);
  };
  const client = options.client ?? new Rezo({}, httpAdapter);
  const outcome = await capture(within(
    client.get(`http://localhost:${port}/retry`, {
      hooks: { afterHeaders: [afterHeaders] },
      httpAgent: agent,
      retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
    }),
    10_000,
    'DNS retry transport request timed out',
  ));
  if (hookInfrastructureError) throw hookInfrastructureError;
  const terminalCounts = {
    attempts,
    bootstrapSelections: agent.bootstrapSelections,
    connections: agent.connections,
    hookCalls,
    missingSelections: agent.missingSelections,
    selectedCalls: agent.selectedCalls.length,
  };
  await postTerminalTurn();
  expect({
    attempts,
    bootstrapSelections: agent.bootstrapSelections,
    connections: agent.connections,
    hookCalls,
    missingSelections: agent.missingSelections,
    selectedCalls: agent.selectedCalls.length,
  }).toEqual(terminalCounts);
  const terminalConfig = Reflect.get(Object(outcome.value ?? outcome.error), 'config');
  const terminalRequestFromConfig = Reflect.get(Object(terminalConfig), 'originalRequest');
  const terminalRequest = terminalRequestFromConfig
    ?? Reflect.get(Object(outcome.error), 'request');
  return {
    agent,
    attempts,
    error: outcome.error,
    hookCalls,
    status: outcome.value
      ? Reflect.get(Object(outcome.value), 'status') as number | undefined
      : undefined,
    terminalCache: Reflect.get(Object(terminalRequest), 'dnsCache'),
    terminalLookupIsSeeded: options.dnsLookup
      ? Reflect.get(Object(terminalRequest), 'dnsLookup') === options.dnsLookup
      : null,
    terminalRequestCache: Reflect.get(Object(terminalRequest), '_dnsCache'),
    terminalRequestIsHookRequest: hookRequest !== undefined && terminalRequest === hookRequest,
  };
}

interface InertCarrierResult {
  boundaryMatches: boolean[];
  cacheCalls: number;
  cacheSize: number;
  dispatches: number;
  status: number;
}

async function runInertCarrier(
  adapter: AdapterFunction,
  url: string,
): Promise<InertCarrierResult> {
  const boundaryMatches: boolean[] = [];
  let cache: DNSCache | undefined;
  let dispatches = 0;
  const forwarding: AdapterFunction = async (request, defaults, jar) => {
    dispatches += 1;
    boundaryMatches.push(Reflect.get(defaults, '_dnsCache') === cache);
    return adapter(request, defaults, jar);
  };
  const client = new Rezo(
    { cache: { dns: { enable: true, maxEntries: 8, ttl: 60_000 } } },
    forwarding,
  );
  cache = client.dnsCache;
  if (!cache) throw new InfrastructureError('setup', 'inert-carrier cache absent');
  const previousCarrier = Object.getOwnPropertyDescriptor(client.defaults, '_dnsCache');
  let harness: DNSResolverHarness | undefined;
  try {
    harness = await installDNSResolverHarness(
      cache,
      async () => { throw new Error('inert scalar DNS carrier was consumed'); },
      async () => { throw new Error('inert all-address DNS carrier was consumed'); },
    );
    if (!Reflect.defineProperty(client.defaults, '_dnsCache', {
      configurable: true, enumerable: true, value: cache, writable: true,
    })) throw new InfrastructureError('setup', 'inert carrier install failed');
    const response = await within(
      client.get(url, { retry: false }),
      10_000,
      'inert DNS carrier request timed out',
    );
    await postTerminalTurn();
    return {
      boundaryMatches,
      cacheCalls: harness.scalarCalls.length + harness.allCalls.length,
      cacheSize: cache.size,
      dispatches,
      status: response.status,
    };
  } finally {
    client.clearCache();
    restoreOwnProperty(client.defaults, '_dnsCache', previousCarrier);
    harness?.restore();
  }
}

function expectInertCarrier(result: InertCarrierResult): void {
  expect(result).toEqual({ boundaryMatches: [true], cacheCalls: 0, cacheSize: 0, dispatches: 1, status: 200 });
}

it('DNS-01 projects request DNS carriers over instance defaults and preserves false', async () => {
  await observeRow('DNS-01', async () => {
    const jar = new RezoCookieJar();
    const requestLookup = fixedLookup('127.0.0.11', 4);
    const defaultLookup = fixedLookup('127.0.0.12', 4);
    const defaultOptions = await getDefaultConfig({});
    if (!Reflect.set(defaultOptions, 'dnsLookup', defaultLookup)) {
      throw new InfrastructureError('setup', 'DNS-01 default lookup seed failed');
    }
    if (!Reflect.set(defaultOptions, 'dnsCache', { maxEntries: 7, ttl: 701 })) {
      throw new InfrastructureError('setup', 'DNS-01 default cache seed failed');
    }
    const request = prepareHTTPOptions({
      dnsCache: false,
      dnsLookup: requestLookup,
      fullUrl: 'http://dns-01.rezo.test/request',
      method: 'GET',
      url: 'http://dns-01.rezo.test/request',
    }, jar, { defaultOptions });
    const inherited = prepareHTTPOptions({
      fullUrl: 'http://dns-01.rezo.test/default',
      method: 'GET',
      url: 'http://dns-01.rezo.test/default',
    }, jar, { defaultOptions });
    const unset = prepareHTTPOptions({
      fullUrl: 'http://dns-01.rezo.test/unset',
      method: 'GET',
      url: 'http://dns-01.rezo.test/unset',
    }, jar, { defaultOptions: await getDefaultConfig({}) });
    const actual = {
      inheritedCache: inherited.fetchOptions.dnsCache,
      inheritedLookup: inherited.fetchOptions.dnsLookup,
      requestCache: request.fetchOptions.dnsCache,
      requestLookup: request.fetchOptions.dnsLookup,
      unsetCache: unset.fetchOptions.dnsCache,
      unsetLookup: unset.fetchOptions.dnsLookup,
    };
    if (isDeepStrictEqual(actual, {
      inheritedCache: undefined,
      inheritedLookup: undefined,
      requestCache: undefined,
      requestLookup: undefined,
      unsetCache: undefined,
      unsetLookup: undefined,
    })) armExpectedRed('DNS-01');
    expect(actual).toEqual({
      inheritedCache: { maxEntries: 7, ttl: 701 },
      inheritedLookup: defaultLookup,
      requestCache: false,
      requestLookup,
      unsetCache: undefined,
      unsetLookup: undefined,
    });
  });
});

if (RUNTIME === 'node') {
  it('DNS-05N resolves a non-empty native value in a fresh Node ESM child', async () => {
    await observeRow('DNS-05N', async () => {
      const result = await runNativeLoaderChild();
      const actual = { address: result.address, family: result.family, size: result.size };
      if (isDeepStrictEqual(actual, { address: null, family: null, size: 0 })) armExpectedRed('DNS-05N');
      expect(actual).toEqual({
        address: expect.stringMatching(/\S/u), family: 4, size: 1,
      });
    });
  });
} else {
  it('DNS-05B resolves a non-empty native value in a fresh Bun ESM child', async () => {
    await observeRow('DNS-05B', async () => {
      const result = await runNativeLoaderChild();
      const actual = { address: result.address, family: result.family, size: result.size };
      if (isDeepStrictEqual(actual, { address: null, family: null, size: 0 })) armExpectedRed('DNS-05B');
      expect(actual).toEqual({
        address: expect.stringMatching(/\S/u), family: 4, size: 1,
      });
    });
  });
}

it('DNS-18F keeps the private DNS cache carrier inert in Fetch', async () => {
  await observeRow('DNS-18F', async () => {
    const priorFetch = globalThis.fetch;
    const controlledFetch: typeof fetch = Object.assign(
      async () => new Response('ok', { status: 200 }),
      { preconnect: (_url: string | URL): void => undefined },
    );
    globalThis.fetch = controlledFetch;
    try {
      expectInertCarrier(await runInertCarrier(fetchAdapter, 'http://dns-18f.rezo.test/'));
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

it('DNS-18X keeps the private DNS cache carrier inert in XHR', async () => {
  await observeRow('DNS-18X', async () => {
    expectInertCarrier(await runInertCarrier(xhrAdapter, 'http://dns-18x.rezo.test/'));
  });
});

it('DNS-18R keeps the private DNS cache carrier inert in React Native', async () => {
  await observeRow('DNS-18R', async () => {
    const priorFetch = globalThis.fetch;
    const controlledFetch: typeof fetch = Object.assign(
      async () => new Response('ok', { status: 200 }),
      { preconnect: (_url: string | URL): void => undefined },
    );
    globalThis.fetch = controlledFetch;
    try {
      expectInertCarrier(await runInertCarrier(reactNativeAdapter, 'http://dns-18r.rezo.test/'));
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

it('DNS-18H keeps the private DNS cache carrier inert in HTTP/2', async () => {
  await observeRow('DNS-18H', async () => {
    const pool = Http2SessionPool.getInstance();
    trackedHttp2SessionPool = pool;
    expect(http2PoolSnapshot(pool)).toEqual({
      cleanupTimerActive: true,
      entries: 0,
      leases: 0,
      pendingCreations: 0,
      sessions: 0,
    });
    const server = trackServer(http2.createServer());
    server.on('session', (session) => {
      trackHttp2Session(session);
    });
    server.on('stream', (stream: http2.ServerHttp2Stream) => {
      trackHttp2Stream(stream);
      stream.on('error', (error) => {
        if (!currentRowTerminal) recordFixtureError(error);
      });
      try {
        stream.respond({ ':status': 200, 'content-type': 'text/plain' });
        stream.end('ok');
      } catch (error) {
        recordFixtureError(error);
        try {
          stream.close();
        } catch (closeError) {
          recordFixtureError(closeError);
        }
      }
    });
    const port = await listenHttp2(server);
    expectInertCarrier(await runInertCarrier(http2Adapter, `http://127.0.0.1:${port}/dns-18h`));
    expect(http2PoolSnapshot(pool)).toEqual({
      cleanupTimerActive: true,
      entries: 1,
      leases: 0,
      pendingCreations: 0,
      sessions: 1,
    });
  });
});

it('DNS-18C keeps the private DNS cache carrier inert in cURL', async () => {
  await observeRow('DNS-18C', async () => {
    const server = createHttpFixture((_request, response) => response.end('ok'));
    const port = await listenHttp(server);
    expectInertCarrier(await runInertCarrier(curlAdapter, `http://127.0.0.1:${port}/dns-18c`));
  });
});

if (RUNTIME === 'node') {
  it('DNS-02 invokes the request resolver once and reaches the virtual-host wire', async () => {
    await observeRow('DNS-02', async () => {
      let resolverCalls = 0;
      let resolverOptions: object | undefined;
      let serverHits = 0;
      const server = createHttpFixture((request, response) => {
        serverHits += 1;
        expect(request.headers.host).toMatch(/^dns-02\.rezo\.test:/u);
        expect(request.url).toBe('/target');
        response.end('ok');
      });
      const port = await listenHttp(server);
      const agent = trackAgent(new ControlledLookupAgent(port, false));
      const lookup: PublicLookup = (hostname, options, callback) => {
        resolverCalls += 1;
        resolverOptions = Object(options);
        expect(hostname).toBe('dns-02.rezo.test');
        callback(null, '127.0.0.1', 4);
      };
      const outcome = await capture(within(
        new Rezo({}, httpAdapter).get(
          `http://dns-02.rezo.test:${port}/target`,
          { dnsCache: false, dnsLookup: lookup, httpAgent: agent, retry: false },
        ),
        10_000,
        'DNS-02 request timed out',
      ));
      const terminalCounts = {
        bootstrapSelections: agent.bootstrapSelections,
        connections: agent.connections,
        missingSelections: agent.missingSelections,
        resolverCalls,
        selected: agent.selectedCalls.length,
        serverHits,
      };
      await postTerminalTurn();
      expect({
        bootstrapSelections: agent.bootstrapSelections,
        connections: agent.connections,
        missingSelections: agent.missingSelections,
        resolverCalls,
        selected: agent.selectedCalls.length,
        serverHits,
      }).toEqual(terminalCounts);
      const actual = {
        all: resolverOptions ? Reflect.get(resolverOptions, 'all') : undefined,
        errorCode: outcome.error ? Reflect.get(Object(outcome.error), 'code') : null,
        errorMessage: outcome.error instanceof Error ? outcome.error.message : null,
        errorName: outcome.error instanceof Error ? outcome.error.name : null,
        ...terminalCounts,
        status: outcome.value ? Reflect.get(Object(outcome.value), 'status') : undefined,
      };
      if (isDeepStrictEqual(actual, {
        all: undefined,
        errorCode: 'ENOTFOUND',
        errorMessage: 'controlled selected lookup absent',
        errorName: 'RezoError',
        bootstrapSelections: 0,
        connections: 1,
        missingSelections: 1,
        resolverCalls: 0,
        selected: 0,
        serverHits: 0,
        status: undefined,
      })) armExpectedRed('DNS-02');
      expect(actual).toEqual({
        all: false,
        errorCode: null,
        errorMessage: null,
        errorName: null,
        bootstrapSelections: 0,
        connections: 1,
        missingSelections: 0,
        resolverCalls: 1,
        selected: 1,
        serverHits: 1,
        status: 200,
      });
    });
  });
}

if (RUNTIME === 'node') {
  it('DNS-03A preserves the seeded resolver identity and explicit false through real redirect reprojection', async () => {
    await observeRow('DNS-03A', async () => {
      const result = await runRedirectCarrierRow();
      if (isDeepStrictEqual(result, {
        destinationCache: undefined,
        destinationHits: 0,
        destinationLookupIsSeeded: false,
        hookCalls: 1,
        resolverCalls: 0,
        selectedCalls: 0,
        sourceHits: 1,
        status: undefined,
      })) armExpectedRed('DNS-03A');
      expect({
        cache: result.destinationCache,
        hookCalls: result.hookCalls,
        lookupIsSeeded: result.destinationLookupIsSeeded,
      }).toEqual({ cache: false, hookCalls: 1, lookupIsSeeded: true });
    });
  });

  it('DNS-03B reaches the virtual destination only through the seeded scalar resolver', async () => {
    await observeRow('DNS-03B', async () => {
      const result = await runRedirectCarrierRow();
      if (isDeepStrictEqual(result, {
        destinationCache: undefined,
        destinationHits: 0,
        destinationLookupIsSeeded: false,
        hookCalls: 1,
        resolverCalls: 0,
        selectedCalls: 0,
        sourceHits: 1,
        status: undefined,
      })) armExpectedRed('DNS-03B');
      expect(result).toMatchObject({
        destinationHits: 1,
        hookCalls: 1,
        resolverCalls: 1,
        selectedCalls: 1,
        sourceHits: 1,
        status: 200,
      });
    });
  });
}

if (RUNTIME === 'node') {
  it('DNS-04 preserves a post-projection scalar resolver across a forced-fresh retry', async () => {
    await observeRow('DNS-04', async () => {
      let attempts = 0;
      let hookCalls = 0;
      let carrierSeeded = false;
      let hookRequest: object | undefined;
      let hookInfrastructureError: InfrastructureError | undefined;
      let resolverCalls = 0;
      let resolverAll: unknown;
      const server = createHttpFixture((_request, response) => {
        attempts += 1;
        if (attempts === 1) {
          response.writeHead(503, { connection: 'close' });
          response.end('retry');
          return;
        }
        response.end('ok');
      });
      const port = await listenHttp(server);
      const lookupLedger: ControlledLookupLedger = {
        bootstrapSelections: 0, connections: 0, missingSelections: 0, selectedCalls: [],
      };
      let agent = trackAgent(new ControlledLookupAgent(port, false, 1, lookupLedger));
      const lookup: PublicLookup = (_hostname, options, callback) => {
        resolverCalls += 1;
        resolverAll = Reflect.get(Object(options), 'all');
        callback(null, '127.0.0.1', 4);
      };
      const afterHeaders: AfterHeadersHook = (_event, config) => {
        if (carrierSeeded) return;
        carrierSeeded = true;
        hookCalls += 1;
        const liveRequest = config.originalRequest;
        hookRequest = liveRequest;
        agent = trackAgent(new ControlledLookupAgent(port, false, 0, lookupLedger));
        if (!Reflect.set(liveRequest, 'httpAgent', agent)) {
          hookInfrastructureError = new InfrastructureError('setup', 'DNS-04 retry Agent seed failed');
          throw hookInfrastructureError;
        }
        if (!Reflect.set(liveRequest, 'dnsLookup', lookup)) {
          hookInfrastructureError = new InfrastructureError('setup', 'DNS-04 lookup seed failed');
          throw hookInfrastructureError;
        }
        if (!Reflect.set(liveRequest, 'dnsCache', false)) {
          hookInfrastructureError = new InfrastructureError('setup', 'DNS-04 cache-false seed failed');
          throw hookInfrastructureError;
        }
      };
      const outcome = await capture(within(
        new Rezo({}, httpAdapter).get(`http://localhost:${port}/retry`, {
          hooks: { afterHeaders: [afterHeaders] },
          httpAgent: agent,
          retry: { maxRetries: 1, retryDelay: 0, retryOn: [503] },
        }),
        10_000,
        'DNS-04 retry request timed out',
      ));
      if (hookInfrastructureError) throw hookInfrastructureError;
      if (outcome.error) throw outcome.error;
      const terminalConfig = Reflect.get(Object(outcome.value), 'config');
      const terminalRequest = Reflect.get(Object(terminalConfig), 'originalRequest');
      const terminalCounts = {
        attempts,
        bootstrapSelections: agent.bootstrapSelections,
        connections: agent.connections,
        hookCalls,
        missingSelections: agent.missingSelections,
        resolverCalls,
        selected: agent.selectedCalls.length,
      };
      await postTerminalTurn();
      expect({
        attempts,
        bootstrapSelections: agent.bootstrapSelections,
        connections: agent.connections,
        hookCalls,
        missingSelections: agent.missingSelections,
        resolverCalls,
        selected: agent.selectedCalls.length,
      }).toEqual(terminalCounts);
      expect({
        ...terminalCounts,
        resolverAll,
        status: Reflect.get(Object(outcome.value), 'status'),
        terminalCache: Reflect.get(Object(terminalRequest), 'dnsCache'),
        terminalLookupIsSeeded: Reflect.get(Object(terminalRequest), 'dnsLookup') === lookup,
        terminalRequestIsHookRequest: hookRequest !== undefined && terminalRequest === hookRequest,
      }).toEqual({
        attempts: 2,
        bootstrapSelections: 0,
        connections: 2,
        hookCalls: 1,
        missingSelections: 0,
        resolverAll: false,
        resolverCalls: 1,
        selected: 2,
        status: 200,
        terminalCache: false,
        terminalLookupIsSeeded: true,
        terminalRequestIsHookRequest: true,
      });
    });
  });
}

it('DNS-06 caches a successful scalar lookup after one miss', async () => {
  await observeRow('DNS-06', async () => {
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    const harness = await installDNSResolverHarness(
      cache,
      async () => ({ address: '127.0.0.61', family: 4 }),
      async () => [],
    );
    try {
      const first = await cache.lookup('dns-06.rezo.invalid', 4);
      const second = await cache.lookup('dns-06.rezo.invalid', 4);
      expect({ first, second, calls: harness.scalarCalls.length, size: cache.size }).toEqual({
        first: { address: '127.0.0.61', family: 4 },
        second: { address: '127.0.0.61', family: 4 },
        calls: 1,
        size: 1,
      });
    } finally {
      cache.clear();
      harness.restore();
    }
  });
});

it('DNS-07 expires cached values only after the controlled TTL boundary', async () => {
  await observeRow('DNS-07', async () => {
    const clock = installControlledClock(1_000_000);
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 100 });
    let generation = 0;
    let harness: DNSResolverHarness | undefined;
    try {
      harness = await installDNSResolverHarness(cache, async () => {
        generation += 1;
        return { address: generation === 1 ? '127.0.0.71' : '127.0.0.72', family: 4 };
      }, async () => []);
      const first = await cache.lookup('dns-07.rezo.invalid', 4);
      clock.advance(99);
      const beforeExpiry = await cache.lookup('dns-07.rezo.invalid', 4);
      clock.advance(2);
      const afterExpiry = await cache.lookup('dns-07.rezo.invalid', 4);
      expect({ afterExpiry, beforeExpiry, first, calls: harness.scalarCalls.length }).toEqual({
        afterExpiry: { address: '127.0.0.72', family: 4 },
        beforeExpiry: { address: '127.0.0.71', family: 4 },
        first: { address: '127.0.0.71', family: 4 },
        calls: 2,
      });
    } finally {
      cache.clear();
      harness?.restore();
      clock.restore();
    }
  });
});

it('DNS-08 never caches a failed scalar lookup', async () => {
  await observeRow('DNS-08', async () => {
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    const failure = new Error('deterministic DNS failure');
    let attempt = 0;
    const harness = await installDNSResolverHarness(cache, async () => {
      attempt += 1;
      if (attempt === 1) throw failure;
      return { address: '127.0.0.81', family: 4 };
    }, async () => []);
    try {
      await expect(cache.lookup('dns-08.rezo.invalid', 4)).rejects.toBe(failure);
      expect(cache.size).toBe(0);
      const recovered = await cache.lookup('dns-08.rezo.invalid', 4);
      expect({ recovered, calls: harness.scalarCalls.length, size: cache.size }).toEqual({
        recovered: { address: '127.0.0.81', family: 4 },
        calls: 2,
        size: 1,
      });
    } finally {
      cache.clear();
      harness.restore();
    }
  });
});

it('DNS-09 coalesces concurrent misses for the same cache key', async () => {
  await observeRow('DNS-09', async () => {
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    const result: DNSAddress = { address: '127.0.0.91', family: 4 };
    const gate = createDeferred<DNSAddress | undefined>(result);
    const harness = await installDNSResolverHarness(cache, async () => gate.promise, async () => []);
    const firstLookup = cache.lookup('dns-09.rezo.invalid', 4);
    const secondLookup = cache.lookup('dns-09.rezo.invalid', 4);
    try {
      gate.release(result);
      const [first, second] = await Promise.all([firstLookup, secondLookup]);
      const actual = {
        calls: harness.scalarCalls.length,
        first,
        second,
        size: cache.size,
      };
      if (isDeepStrictEqual(actual, {
        calls: 2,
        first: { address: '127.0.0.91', family: 4 },
        second: { address: '127.0.0.91', family: 4 },
        size: 1,
      })) armExpectedRed('DNS-09');
      expect(actual).toEqual({ calls: 1, first: result, second: result, size: 1 });
    } finally {
      gate.release(result);
      await Promise.allSettled([firstLookup, secondLookup]);
      cache.clear();
      harness.restore();
    }
  });
});

it('DNS-10 keeps concurrent misses for distinct keys independent', async () => {
  await observeRow('DNS-10', async () => {
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    const resultA: DNSAddress = { address: '127.0.0.101', family: 4 };
    const resultB: DNSAddress = { address: '::1', family: 6 };
    const gateA = createDeferred<DNSAddress | undefined>(resultA);
    const gateB = createDeferred<DNSAddress | undefined>(resultB);
    const harness = await installDNSResolverHarness(cache, async (hostname) => {
      if (hostname === 'dns-10-a.rezo.invalid') return gateA.promise;
      if (hostname === 'dns-10-b.rezo.invalid') return gateB.promise;
      throw new InfrastructureError('fixture', `unexpected DNS-10 hostname ${hostname}`);
    }, async () => []);
    let lookupASettled = false;
    const lookupA = cache.lookup('dns-10-a.rezo.invalid', 4).then((value) => {
      lookupASettled = true;
      return value;
    });
    const lookupB = cache.lookup('dns-10-b.rezo.invalid', 6);
    try {
      gateB.release(resultB);
      expect(await lookupB).toBe(resultB);
      expect(lookupASettled).toBe(false);
      gateA.release(resultA);
      expect(await lookupA).toBe(resultA);
      expect(harness.scalarCalls.map((call) => call.hostname)).toEqual([
        'dns-10-a.rezo.invalid', 'dns-10-b.rezo.invalid',
      ]);
      expect(cache.size).toBe(2);
    } finally {
      gateA.release(resultA);
      gateB.release(resultB);
      await Promise.allSettled([lookupA, lookupB]);
      cache.clear();
      harness.restore();
    }
  });
});

it('DNS-11 preserves mixed-family all-result order and each entry family', async () => {
  await observeRow('DNS-11', async () => {
    const cache = new DNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    const mixed: DNSAddress[] = [
      { address: '192.0.2.11', family: 4 },
      { address: '2001:db8::11', family: 6 },
    ];
    const harness = await installDNSResolverHarness(
      cache,
      async () => undefined,
      async () => mixed.map((entry) => ({ ...entry })),
    );
    try {
      const miss = await cache.lookupAll('dns-11.rezo.invalid');
      const cached = await cache.lookupAll('dns-11.rezo.invalid');
      const actual = { cached, calls: harness.allCalls.length, miss, size: cache.size };
      if (isDeepStrictEqual(actual, {
        cached: [
          { address: '192.0.2.11', family: 4 },
          { address: '2001:db8::11', family: 4 },
        ],
        calls: 1,
        miss: [
          { address: '192.0.2.11', family: 4 },
          { address: '2001:db8::11', family: 6 },
        ],
        size: 1,
      })) armExpectedRed('DNS-11');
      expect(actual).toEqual({
        cached: mixed, calls: 1, miss: mixed, size: 1,
      });
    } finally {
      cache.clear();
      harness.restore();
    }
  });
});

if (RUNTIME === 'node') {
  it('DNS-12S returns one cached scalar result through the pool-off retry path', async () => {
    await observeRow('DNS-12S', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      try {
        const result = await runRetryTransport({ all: false, dnsCache: true });
        expect({
          allCalls: harness.allCalls.length,
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          callback: result.agent.selectedCalls[1]?.result,
          connections: result.agent.connections,
          error: result.error,
          missingSelections: result.agent.missingSelections,
          scalarCalls: harness.scalarCalls.length,
          selectedCalls: result.agent.selectedCalls.length,
          status: result.status,
          terminalCache: result.terminalCache,
          terminalRequestIsHookRequest: result.terminalRequestIsHookRequest,
        }).toEqual({
          allCalls: 0,
          attempts: 2,
          bootstrapSelections: 0,
          callback: ['127.0.0.1', 4],
          connections: 2,
          error: null,
          missingSelections: 0,
          scalarCalls: 1,
          selectedCalls: 2,
          status: 200,
          terminalCache: true,
          terminalRequestIsHookRequest: true,
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-12A returns a one-entry cached array when the transport requests all', async () => {
    await observeRow('DNS-12A', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      try {
        const result = await runRetryTransport({ all: true, dnsCache: true });
        const actual = {
          allCalls: harness.allCalls.length,
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          callback: result.agent.selectedCalls[1]?.result,
          connections: result.agent.connections,
          error: result.error,
          missingSelections: result.agent.missingSelections,
          scalarCalls: harness.scalarCalls.length,
          selectedCalls: result.agent.selectedCalls.length,
          status: result.status,
          terminalCache: result.terminalCache,
          terminalRequestIsHookRequest: result.terminalRequestIsHookRequest,
        };
        if (isDeepStrictEqual(actual, {
          allCalls: 0,
          attempts: 2,
          bootstrapSelections: 1,
          callback: ['127.0.0.1', 4],
          connections: 2,
          error: null,
          missingSelections: 0,
          scalarCalls: 1,
          selectedCalls: 1,
          status: 200,
          terminalCache: true,
          terminalRequestIsHookRequest: true,
        })) armExpectedRed('DNS-12A');
        expect(actual).toEqual({
          allCalls: 1,
          attempts: 2,
          bootstrapSelections: 0,
          callback: [[{ address: '127.0.0.1', family: 4 }]],
          connections: 2,
          error: null,
          missingSelections: 0,
          scalarCalls: 0,
          selectedCalls: 2,
          status: 200,
          terminalCache: true,
          terminalRequestIsHookRequest: true,
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-13S preserves scalar custom lookup inputs and bypasses the populated cache', async () => {
    await observeRow('DNS-13S', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      const resolverCalls: Array<{ all: unknown; family: unknown; hints: unknown; hostname: string; order: unknown }> = [];
      const lookup: PublicLookup = (hostname, options, callback) => {
        resolverCalls.push({
          all: Reflect.get(Object(options), 'all'),
          family: Reflect.get(Object(options), 'family'),
          hints: Reflect.get(Object(options), 'hints'),
          hostname,
          order: Reflect.get(Object(options), 'order'),
        });
        callback(null, '127.0.0.1', 4);
      };
      try {
        await cache.lookup('localhost', 4);
        harness.scalarCalls.length = 0;
        const result = await runRetryTransport({ all: false, dnsCache: true, dnsLookup: lookup });
        expect({
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          cacheCalls: harness.scalarCalls.length + harness.allCalls.length,
          cacheSize: cache.size,
          callback: result.agent.selectedCalls[1],
          connections: result.agent.connections,
          error: result.error,
          hookCalls: result.hookCalls,
          missingSelections: result.agent.missingSelections,
          resolverCalls,
          selectedCalls: result.agent.selectedCalls.length,
          status: result.status,
          terminalCache: result.terminalCache,
          terminalLookupIsSeeded: result.terminalLookupIsSeeded,
          terminalRequestIsHookRequest: result.terminalRequestIsHookRequest,
        }).toEqual({
          attempts: 2,
          bootstrapSelections: 0,
          cacheCalls: 0,
          cacheSize: 1,
          callback: { all: false, error: null, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim', result: ['127.0.0.1', 4] },
          connections: 2,
          error: null,
          hookCalls: 1,
          missingSelections: 0,
          resolverCalls: [{ all: false, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim' }],
          selectedCalls: 2,
          status: 200,
          terminalCache: true,
          terminalLookupIsSeeded: true,
          terminalRequestIsHookRequest: true,
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-13A bridges an internal all request through one scalar public lookup', async () => {
    await observeRow('DNS-13A', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      const resolverCalls: Array<{ all: unknown; family: unknown; hints: unknown; hostname: string; order: unknown }> = [];
      const lookup: PublicLookup = (hostname, options, callback) => {
        resolverCalls.push({
          all: Reflect.get(Object(options), 'all'), family: Reflect.get(Object(options), 'family'),
          hints: Reflect.get(Object(options), 'hints'), hostname,
          order: Reflect.get(Object(options), 'order'),
        });
        callback(null, '127.0.0.1', 4);
      };
      try {
        await cache.lookup('localhost', 4);
        harness.scalarCalls.length = 0;
        const result = await runRetryTransport({ all: true, dnsCache: true, dnsLookup: lookup });
        const actual = {
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          cacheCalls: harness.scalarCalls.length + harness.allCalls.length,
          cacheSize: cache.size,
          callback: result.agent.selectedCalls[1],
          connections: result.agent.connections,
          error: result.error,
          hookCalls: result.hookCalls,
          missingSelections: result.agent.missingSelections,
          resolverCalls,
          selectedCalls: result.agent.selectedCalls.length,
          status: result.status,
          terminalCache: result.terminalCache,
          terminalLookupIsSeeded: result.terminalLookupIsSeeded,
          terminalRequestIsHookRequest: result.terminalRequestIsHookRequest,
        };
        if (isDeepStrictEqual(actual, {
          attempts: 2,
          bootstrapSelections: 1,
          cacheCalls: 0,
          cacheSize: 1,
          callback: { all: true, error: null, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim', result: ['127.0.0.1', 4] },
          connections: 2,
          error: null,
          hookCalls: 1,
          missingSelections: 0,
          resolverCalls: [{ all: true, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim' }],
          selectedCalls: 1,
          status: 200,
          terminalCache: true,
          terminalLookupIsSeeded: true,
          terminalRequestIsHookRequest: true,
        })) armExpectedRed('DNS-13A');
        expect(actual).toEqual({
          attempts: 2,
          bootstrapSelections: 0,
          cacheCalls: 0,
          cacheSize: 1,
          callback: { all: true, error: null, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim', result: [[{ address: '127.0.0.1', family: 4 }]] },
          connections: 2,
          error: null,
          hookCalls: 1,
          missingSelections: 0,
          resolverCalls: [{ all: false, family: 4, hints: 0, hostname: 'localhost', order: 'verbatim' }],
          selectedCalls: 2,
          status: 200,
          terminalCache: true,
          terminalLookupIsSeeded: true,
          terminalRequestIsHookRequest: true,
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-14 validates and normalizes every scalar resolver output before all-result wrapping', async () => {
    await observeRow('DNS-14', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      const cases: Array<{ callbackArguments: unknown[]; label: string }> = [
        { callbackArguments: [null, '127.0.0.1', 0], label: 'family-zero' },
        { callbackArguments: [null, '127.0.0.1', undefined], label: 'family-undefined' },
        { callbackArguments: [null, '127.0.0.1', 5], label: 'malformed-family' },
        { callbackArguments: [null, '127.0.0.1', 6], label: 'family-mismatch' },
        { callbackArguments: [null, 'not-an-ip', 4], label: 'malformed-address' },
      ];
      const outcomes: Array<Record<string, unknown>> = [];
      try {
        await cache.lookup('localhost', 4);
        harness.scalarCalls.length = 0;
        for (const entry of cases) {
          const resolverAll: unknown[] = [];
          const lookup: PublicLookup = (_hostname, options, callback) => {
            resolverAll.push(Reflect.get(Object(options), 'all'));
            Reflect.apply(callback, undefined, entry.callbackArguments);
          };
          const result = await runRetryTransport({ all: true, dnsCache: true, dnsLookup: lookup });
          const selected = result.agent.selectedCalls[1];
          outcomes.push({
            bootstrapSelections: result.agent.bootstrapSelections,
            label: entry.label,
            missingSelections: result.agent.missingSelections,
            outerCode: result.error ? Reflect.get(Object(result.error), 'code') : null,
            outerErrno: result.error ? Reflect.get(Object(result.error), 'errno') : null,
            resolverAll,
            selectedCalls: result.agent.selectedCalls.length,
            selectedCode: selected?.error ? Reflect.get(Object(selected.error), 'code') : null,
            selectedErrno: selected?.error ? Reflect.get(Object(selected.error), 'errno') : null,
            selectedResult: selected?.result,
            status: result.status,
          });
        }
        const actual = { cacheCalls: harness.scalarCalls.length + harness.allCalls.length, outcomes };
        if (isDeepStrictEqual(actual, {
          cacheCalls: 0,
          outcomes: [
            { bootstrapSelections: 1, label: 'family-zero', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [true], selectedCalls: 1, selectedCode: null, selectedErrno: null, selectedResult: ['127.0.0.1', 0], status: 200 },
            { bootstrapSelections: 1, label: 'family-undefined', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [true], selectedCalls: 1, selectedCode: null, selectedErrno: null, selectedResult: ['127.0.0.1', undefined], status: 200 },
            { bootstrapSelections: 1, label: 'malformed-family', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [true], selectedCalls: 1, selectedCode: null, selectedErrno: null, selectedResult: ['127.0.0.1', 5], status: 200 },
            { bootstrapSelections: 1, label: 'family-mismatch', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [true], selectedCalls: 1, selectedCode: null, selectedErrno: null, selectedResult: ['127.0.0.1', 6], status: 200 },
            { bootstrapSelections: 1, label: 'malformed-address', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [true], selectedCalls: 1, selectedCode: null, selectedErrno: null, selectedResult: ['not-an-ip', 4], status: 200 },
          ],
        })) armExpectedRed('DNS-14');
        expect(actual).toEqual({
          cacheCalls: 0,
          outcomes: [
            { bootstrapSelections: 0, label: 'family-zero', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [false], selectedCalls: 2, selectedCode: null, selectedErrno: null, selectedResult: [[{ address: '127.0.0.1', family: 4 }]], status: 200 },
            { bootstrapSelections: 0, label: 'family-undefined', missingSelections: 0, outerCode: null, outerErrno: null, resolverAll: [false], selectedCalls: 2, selectedCode: null, selectedErrno: null, selectedResult: [[{ address: '127.0.0.1', family: 4 }]], status: 200 },
            { bootstrapSelections: 0, label: 'malformed-family', missingSelections: 0, outerCode: 'ERR_INVALID_ARG_TYPE', outerErrno: -1008, resolverAll: [false], selectedCalls: 2, selectedCode: 'ERR_INVALID_ARG_TYPE', selectedErrno: -1008, selectedResult: [], status: undefined },
            { bootstrapSelections: 0, label: 'family-mismatch', missingSelections: 0, outerCode: 'ERR_INVALID_ARG_TYPE', outerErrno: -1008, resolverAll: [false], selectedCalls: 2, selectedCode: 'ERR_INVALID_ARG_TYPE', selectedErrno: -1008, selectedResult: [], status: undefined },
            { bootstrapSelections: 0, label: 'malformed-address', missingSelections: 0, outerCode: 'ERR_INVALID_ARG_TYPE', outerErrno: -1008, resolverAll: [false], selectedCalls: 2, selectedCode: 'ERR_INVALID_ARG_TYPE', selectedErrno: -1008, selectedResult: [], status: undefined },
          ],
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-15 propagates the exact custom resolver error without cache fallback', async () => {
    await observeRow('DNS-15', async () => {
      const cache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      const harness = await installDNSResolverHarness(
        cache,
        async () => ({ address: '127.0.0.1', family: 4 }),
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      const resolverError = new Error('DNS-15 controlled resolver failure');
      if (!Reflect.set(resolverError, 'code', 'EAI_AGAIN')) {
        throw new InfrastructureError('setup', 'DNS-15 error code install failed');
      }
      let resolverCalls = 0;
      const lookup: PublicLookup = (_hostname, _options, callback) => {
        resolverCalls += 1;
        Reflect.apply(callback, undefined, [resolverError]);
      };
      try {
        await cache.lookup('localhost', 4);
        harness.scalarCalls.length = 0;
        const result = await runRetryTransport({ all: true, dnsCache: true, dnsLookup: lookup });
        const selected = result.agent.selectedCalls[1];
        expect({
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          cacheCalls: harness.scalarCalls.length + harness.allCalls.length,
          causeIsResolver: result.error
            ? Reflect.get(Object(result.error), 'cause') === resolverError
            : false,
          connections: result.agent.connections,
          hookCalls: result.hookCalls,
          missingSelections: result.agent.missingSelections,
          outerCode: result.error ? Reflect.get(Object(result.error), 'code') : null,
          resolverCalls,
          selectedCalls: result.agent.selectedCalls.length,
          selectedError: selected?.error,
          selectedErrorCode: selected?.error ? Reflect.get(Object(selected.error), 'code') : null,
          status: result.status,
        }).toEqual({
          attempts: 1,
          bootstrapSelections: 0,
          cacheCalls: 0,
          causeIsResolver: true,
          connections: 2,
          hookCalls: 1,
          missingSelections: 0,
          outerCode: 'EAI_AGAIN',
          resolverCalls: 1,
          selectedCalls: 2,
          selectedError: resolverError,
          selectedErrorCode: 'EAI_AGAIN',
          status: undefined,
        });
      } finally {
        cache.clear();
        harness.restore();
      }
    });
  });

  it('DNS-16A hands the exact configured instance cache to HTTP without touching global state', async () => {
    await observeRow('DNS-16A', async () => {
      const client = new Rezo(
        { cache: { dns: { enable: true, maxEntries: 8, ttl: 60_000 } } },
        httpAdapter,
      );
      const instanceCache = client.dnsCache;
      if (!instanceCache) throw new InfrastructureError('setup', 'DNS-16A instance cache absent');
      const globalCache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      let instanceHarness: DNSResolverHarness | undefined;
      let globalHarness: DNSResolverHarness | undefined;
      try {
        instanceHarness = await installDNSResolverHarness(
          instanceCache,
          async () => ({ address: '127.0.0.31', family: 4 }),
          async () => [{ address: '127.0.0.31', family: 4 }],
        );
        globalHarness = await installDNSResolverHarness(
          globalCache,
          async () => ({ address: '127.0.0.32', family: 4 }),
          async () => [{ address: '127.0.0.32', family: 4 }],
        );
        const result = await runRetryTransport({ all: false, client, dnsCache: true });
        const beforeClear = {
          attempts: result.attempts,
          bootstrapSelections: result.agent.bootstrapSelections,
          callback: result.agent.selectedCalls[0]?.result,
          connections: result.agent.connections,
          error: result.error,
          globalCalls: globalHarness.scalarCalls.length + globalHarness.allCalls.length,
          globalSize: globalCache.size,
          hookCalls: result.hookCalls,
          instanceCalls: instanceHarness.scalarCalls.length + instanceHarness.allCalls.length,
          instanceSize: instanceCache.size,
          missingSelections: result.agent.missingSelections,
          selectedCalls: result.agent.selectedCalls.length,
          stats: client.getCacheStats().dns,
          status: result.status,
          terminalCache: result.terminalCache,
          terminalRequestIsHookRequest: result.terminalRequestIsHookRequest,
        };
        client.clearCache();
        const actual = { beforeClear, afterClear: { globalSize: globalCache.size, instanceSize: instanceCache.size } };
        if (isDeepStrictEqual(actual, {
          beforeClear: {
            attempts: 2, bootstrapSelections: 1, callback: ['127.0.0.32', 4], connections: 2, error: null,
            globalCalls: 1, globalSize: 1, hookCalls: 1, instanceCalls: 0,
            instanceSize: 0, missingSelections: 0, selectedCalls: 1,
            stats: { enabled: true, size: 0 }, status: 200,
            terminalCache: true, terminalRequestIsHookRequest: true,
          },
          afterClear: { globalSize: 1, instanceSize: 0 },
        })) armExpectedRed('DNS-16A');
        expect(actual).toEqual({
          beforeClear: {
            attempts: 2, bootstrapSelections: 0, callback: ['127.0.0.31', 4], connections: 2, error: null,
            globalCalls: 0, globalSize: 0, hookCalls: 1, instanceCalls: 1,
            instanceSize: 1, missingSelections: 0, selectedCalls: 2,
            stats: { enabled: true, size: 1 }, status: 200,
            terminalCache: true, terminalRequestIsHookRequest: true,
          },
          afterClear: { globalSize: 0, instanceSize: 0 },
        });
      } finally {
        client.clearCache();
        globalCache.clear();
        globalHarness?.restore();
        instanceHarness?.restore();
      }
    });
  });

}

// The public default-path row runs on every runtime: it is the one-rule transport claim itself.
  it('DNS-16C serves the instance cache on the public default path: a pooled agent, no carrier seeding', async () => {
    await observeRow('DNS-16C', async () => {
      let serverHits = 0;
      const server = createHttpFixture((request, response) => {
        serverHits += 1;
        expect(request.headers.host).toMatch(/^dns-16c\.rezo\.test:/u);
        response.end('ok');
      });
      const port = await listenHttp(server);
      const client = new Rezo({ cache: { dns: { enable: true, maxEntries: 8, ttl: 60_000 } } }, httpAdapter);
      const instanceCache = client.dnsCache;
      if (!instanceCache) throw new InfrastructureError('setup', 'DNS-16C instance cache absent');
      const globalCache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      let instanceHarness: DNSResolverHarness | undefined;
      let globalHarness: DNSResolverHarness | undefined;
      try {
        instanceHarness = await installDNSResolverHarness(
          instanceCache,
          async () => ({ address: '127.0.0.1', family: 4 }),
          async () => [{ address: '127.0.0.1', family: 4 }],
        );
        globalHarness = await installDNSResolverHarness(
          globalCache,
          async () => ({ address: '127.0.0.1', family: 4 }),
          async () => [{ address: '127.0.0.1', family: 4 }],
        );
        // The public surface exactly as documented: an instance cache and a plain request. No
        // httpAgent, no useAgentPool override, no request-local cache — the pooled default path.
        const outcome = await capture(within(
          client.get(`http://dns-16c.rezo.test:${port}/target`, { retry: false }),
          10_000,
          'DNS-16C request timed out',
        ));
        await postTerminalTurn();
        const actual = {
          errorCode: outcome.error ? Reflect.get(Object(outcome.error), 'code') : null,
          globalCalls: globalHarness.scalarCalls.length + globalHarness.allCalls.length,
          globalSize: globalCache.size,
          instanceCalls: instanceHarness.scalarCalls.length + instanceHarness.allCalls.length,
          instanceSize: instanceCache.size,
          serverHits,
          stats: client.getCacheStats().dns,
          status: outcome.value ? Reflect.get(Object(outcome.value), 'status') : undefined,
        };
        if (actual.instanceCalls === 0 && actual.status !== 200) armExpectedRed('DNS-16C');
        expect(actual).toEqual({
          errorCode: null,
          globalCalls: 0,
          globalSize: 0,
          instanceCalls: 1,
          instanceSize: 1,
          serverHits: 1,
          stats: { enabled: true, size: 1 },
          status: 200,
        });
      } finally {
        client.clearCache();
        globalCache.clear();
        globalHarness?.restore();
        instanceHarness?.restore();
      }
    });
  });

if (RUNTIME === 'node') {
  it('DNS-16B keeps two request-local cache identities isolated from both clients and global state', async () => {
    await observeRow('DNS-16B', async () => {
      const clientA = new Rezo({ cache: { dns: { enable: true, ttl: 60_000 } } }, httpAdapter);
      const clientB = new Rezo({ cache: { dns: { enable: true, ttl: 60_000 } } }, httpAdapter);
      if (!clientA.dnsCache || !clientB.dnsCache) {
        throw new InfrastructureError('setup', 'DNS-16B instance cache absent');
      }
      const requestCacheA = new DNSCache({ enable: true, maxEntries: 8, ttl: 100 });
      const requestCacheB = new DNSCache({ enable: true, maxEntries: 8, ttl: 1_000 });
      const globalCache = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
      let clock: ControlledClock | undefined;
      let requestHarnessA: DNSResolverHarness | undefined;
      let requestHarnessB: DNSResolverHarness | undefined;
      let instanceHarnessA: DNSResolverHarness | undefined;
      let instanceHarnessB: DNSResolverHarness | undefined;
      let globalHarness: DNSResolverHarness | undefined;
      try {
        clock = installControlledClock(2_000_000);
        requestHarnessA = await installDNSResolverHarness(
          requestCacheA, async () => ({ address: '127.0.0.41', family: 4 }), async () => [],
        );
        requestHarnessB = await installDNSResolverHarness(
          requestCacheB, async () => ({ address: '127.0.0.42', family: 4 }), async () => [],
        );
        instanceHarnessA = await installDNSResolverHarness(
          clientA.dnsCache, async () => ({ address: '127.0.0.51', family: 4 }), async () => [],
        );
        instanceHarnessB = await installDNSResolverHarness(
          clientB.dnsCache, async () => ({ address: '127.0.0.52', family: 4 }), async () => [],
        );
        globalHarness = await installDNSResolverHarness(
          globalCache, async () => ({ address: '127.0.0.43', family: 4 }), async () => [],
        );
        const resultA = await runRetryTransport({ all: false, client: clientA, dnsCache: true, requestCache: requestCacheA });
        const resultB = await runRetryTransport({ all: false, client: clientB, dnsCache: true, requestCache: requestCacheB });
        const transport = {
          addresses: [resultA.agent.selectedCalls[1]?.result, resultB.agent.selectedCalls[1]?.result],
          allCalls: [
            requestHarnessA.allCalls.length, requestHarnessB.allCalls.length,
            instanceHarnessA.allCalls.length, instanceHarnessB.allCalls.length,
            globalHarness.allCalls.length,
          ],
          attempts: [resultA.attempts, resultB.attempts],
          bootstrapSelections: [resultA.agent.bootstrapSelections, resultB.agent.bootstrapSelections],
          connections: [resultA.agent.connections, resultB.agent.connections],
          errors: [resultA.error, resultB.error],
          globalCalls: globalHarness.scalarCalls.length,
          hooks: [resultA.hookCalls, resultB.hookCalls],
          identities: new Set([requestCacheA, requestCacheB, clientA.dnsCache, clientB.dnsCache, globalCache]).size,
          instanceCalls: [instanceHarnessA.scalarCalls.length, instanceHarnessB.scalarCalls.length],
          missingSelections: [resultA.agent.missingSelections, resultB.agent.missingSelections],
          requestCacheCarriers: [
            resultA.terminalRequestCache === requestCacheA,
            resultB.terminalRequestCache === requestCacheB,
          ],
          requestCalls: [requestHarnessA.scalarCalls.length, requestHarnessB.scalarCalls.length],
          selectedCalls: [resultA.agent.selectedCalls.length, resultB.agent.selectedCalls.length],
          sizes: [requestCacheA.size, requestCacheB.size, clientA.dnsCache.size, clientB.dnsCache.size, globalCache.size],
          stats: [clientA.getCacheStats().dns, clientB.getCacheStats().dns],
          statuses: [resultA.status, resultB.status],
          terminalCaches: [resultA.terminalCache, resultB.terminalCache],
          terminalRequestsMatchHooks: [
            resultA.terminalRequestIsHookRequest,
            resultB.terminalRequestIsHookRequest,
          ],
        };
        clock.advance(200);
        await requestCacheA.lookup('localhost', 4);
        await requestCacheB.lookup('localhost', 4);
        const ttl = { callsA: requestHarnessA.scalarCalls.length, callsB: requestHarnessB.scalarCalls.length };
        await clientA.dnsCache.lookup('dns-16b-instance-a.rezo.invalid', 4);
        await clientB.dnsCache.lookup('dns-16b-instance-b.rezo.invalid', 4);
        const instanceBeforeClear = [clientA.getCacheStats().dns, clientB.getCacheStats().dns];
        requestCacheA.clear();
        clientA.clearCache();
        const actual = {
          instanceAfterClear: [clientA.getCacheStats().dns, clientB.getCacheStats().dns],
          instanceBeforeClear,
          requestAfterClear: [requestCacheA.size, requestCacheB.size],
          transport,
          ttl,
        };
        if (isDeepStrictEqual(actual, {
          instanceAfterClear: [{ enabled: true, size: 0 }, { enabled: true, size: 1 }],
          instanceBeforeClear: [{ enabled: true, size: 1 }, { enabled: true, size: 1 }],
          requestAfterClear: [0, 1],
          transport: {
            addresses: [['127.0.0.43', 4], ['127.0.0.43', 4]],
            allCalls: [0, 0, 0, 0, 0],
            attempts: [2, 2],
            bootstrapSelections: [1, 1],
            connections: [2, 2],
            errors: [null, null],
            globalCalls: 1,
            hooks: [1, 1],
            identities: 5,
            instanceCalls: [0, 0],
            missingSelections: [0, 0],
            requestCacheCarriers: [true, true],
            requestCalls: [0, 0],
            selectedCalls: [1, 1],
            sizes: [0, 0, 0, 0, 1],
            stats: [{ enabled: true, size: 0 }, { enabled: true, size: 0 }],
            statuses: [200, 200],
            terminalCaches: [true, true],
            terminalRequestsMatchHooks: [true, true],
          },
          ttl: { callsA: 1, callsB: 1 },
        })) armExpectedRed('DNS-16B');
        expect(actual).toEqual({
          instanceAfterClear: [{ enabled: true, size: 0 }, { enabled: true, size: 2 }],
          instanceBeforeClear: [{ enabled: true, size: 2 }, { enabled: true, size: 2 }],
          requestAfterClear: [0, 1],
          transport: {
            addresses: [['127.0.0.41', 4], ['127.0.0.42', 4]],
            allCalls: [0, 0, 0, 0, 0],
            attempts: [2, 2],
            bootstrapSelections: [0, 0],
            connections: [2, 2],
            errors: [null, null],
            globalCalls: 0,
            hooks: [1, 1],
            identities: 5,
            instanceCalls: [1, 1],
            missingSelections: [0, 0],
            requestCacheCarriers: [true, true],
            requestCalls: [1, 1],
            selectedCalls: [2, 2],
            sizes: [1, 1, 1, 1, 0],
            stats: [{ enabled: true, size: 1 }, { enabled: true, size: 1 }],
            statuses: [200, 200],
            terminalCaches: [true, true],
            terminalRequestsMatchHooks: [true, true],
          },
          ttl: { callsA: 2, callsB: 1 },
        });
      } finally {
        clientA.clearCache();
        clientB.clearCache();
        globalCache.clear();
        requestCacheA.clear();
        requestCacheB.clear();
        globalHarness?.restore();
        instanceHarnessB?.restore();
        instanceHarnessA?.restore();
        requestHarnessB?.restore();
        requestHarnessA?.restore();
        clock?.restore();
      }
    });
  });
}

it('DNS-17 keeps configured-instance and exported-global cache objects isolated', async () => {
  await observeRow('DNS-17', async () => {
    const client = new Rezo(
      { cache: { dns: { enable: true, maxEntries: 8, ttl: 60_000 } } },
      httpAdapter,
    );
    const instanceCache = client.dnsCache;
    if (!instanceCache) throw new InfrastructureError('setup', 'DNS-17 instance cache absent');
    const priorGlobal = getGlobalDNSCache({ enable: true, maxEntries: 8, ttl: 60_000 });
    priorGlobal.clear();
    const instanceHarness = await installDNSResolverHarness(
      instanceCache,
      async () => ({ address: '127.0.0.171', family: 4 }),
      async () => [],
    );
    let globalHarness: DNSResolverHarness | undefined;
    try {
      globalHarness = await installDNSResolverHarness(
        priorGlobal,
        async () => ({ address: '127.0.0.172', family: 4 }),
        async () => [],
      );
      expect(getGlobalDNSCache()).toBe(priorGlobal);
      expect(priorGlobal).not.toBe(instanceCache);
      expect(await instanceCache.lookup('dns-17-instance.rezo.invalid', 4)).toEqual({
        address: '127.0.0.171', family: 4,
      });
      expect(await priorGlobal.lookup('dns-17-global.rezo.invalid', 4)).toEqual({
        address: '127.0.0.172', family: 4,
      });
      client.clearCache();
      expect({ globalSize: priorGlobal.size, instanceSize: instanceCache.size }).toEqual({
        globalSize: 1, instanceSize: 0,
      });
      await instanceCache.lookup('dns-17-instance.rezo.invalid', 4);
      resetGlobalDNSCache();
      const nextGlobal = getGlobalDNSCache({ enable: true });
      expect({
        instanceSize: instanceCache.size,
        nextDiffersFromInstance: nextGlobal !== instanceCache,
        nextDiffersFromPrior: nextGlobal !== priorGlobal,
        priorGlobalSize: priorGlobal.size,
      }).toEqual({
        instanceSize: 1,
        nextDiffersFromInstance: true,
        nextDiffersFromPrior: true,
        priorGlobalSize: 0,
      });
    } finally {
      client.clearCache();
      priorGlobal.clear();
      globalHarness?.restore();
      instanceHarness.restore();
      resetGlobalDNSCache();
    }
  });
});
