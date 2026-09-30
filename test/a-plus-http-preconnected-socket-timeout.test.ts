import { afterAll, afterEach, expect, it } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rezo } from '../src/core/rezo';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';

declare module 'node:http' {
  interface Agent {
    addRequest(request: ClientRequest, options: ClientRequestArgs): void;
  }
}

type RowId =
  | 'PCS-01'
  | 'PCS-02'
  | 'PCS-03'
  | 'PCS-04N'
  | 'PCS-05N'
  | 'PCS-06'
  | 'PCS-07';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly released: boolean;
  release(value: T): void;
}

interface CapturedOutcome {
  readonly error: unknown | null;
  readonly value: unknown | null;
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

const FILE = 'test/a-plus-http-preconnected-socket-timeout.test.ts';
const RUNTIME = typeof process.versions.bun === 'string' ? 'bun' : 'node';
const REGISTERED: RowId[] = RUNTIME === 'node'
  ? ['PCS-01', 'PCS-02', 'PCS-03', 'PCS-04N', 'PCS-05N', 'PCS-06', 'PCS-07']
  : ['PCS-06', 'PCS-07'];
const EXPECTED_RED: RowId[] = [];
const EXPECTED_PASSED = REGISTERED.filter((id) => !EXPECTED_RED.includes(id));
const observedInvocations = new Map<RowId, number>();
const observedFailures = new Set<RowId>();
const observedPasses = new Set<RowId>();
const oracleInvalidations: string[] = [];
let currentRow: RowId | undefined;
const cleanupErrors: string[] = [];
const fixtureErrors: string[] = [];
const lateEvents: string[] = [];
const setupErrors: string[] = [];
const teardownErrors: string[] = [];
const activeAgents = new Set<http.Agent>();
const activeGates = new Set<Deferred<void>>();
const activeRequests = new Set<http.ClientRequest>();
const activeResponses = new Set<http.ServerResponse>();
const activeServers = new Set<http.Server | https.Server | net.Server>();
const activeSockets = new Set<net.Socket>();
const activeTimers = new Set<NodeJS.Timeout>();
const activeTlsPaths = new Set<string>();
const armedRed = new Set<RowId>();

function armExpectedRed(id: RowId): void {
  if (currentRow !== id || !EXPECTED_RED.includes(id) || armedRed.has(id)) {
    throw new InfrastructureError(`invalid expected-RED arm for ${id}`);
  }
  armedRed.add(id);
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let released = false;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    get released() {
      return released;
    },
    promise,
    release(value: T) {
      if (released) return;
      released = true;
      resolvePromise(value);
    },
  };
}

function createGate(): Deferred<void> {
  const gate = createDeferred<void>();
  const trackedGate: Deferred<void> = {
    get released() {
      return gate.released;
    },
    promise: gate.promise,
    release(value: void) {
      activeGates.delete(trackedGate);
      gate.release(value);
    },
  };
  activeGates.add(trackedGate);
  return trackedGate;
}

function recordFixtureError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  fixtureErrors.push(message);
}

function trackServer<T extends http.Server | https.Server | net.Server>(
  server: T,
): T {
  activeServers.add(server);
  server.on('connection', (socket: net.Socket) => {
    activeSockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => activeSockets.delete(socket));
  });
  if ('on' in server) {
    server.on('secureConnection', (socket: tls.TLSSocket) => {
      activeSockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => activeSockets.delete(socket));
    });
  }
  server.on('error', recordFixtureError);
  return server;
}

function trackAgent<T extends http.Agent>(agent: T): T {
  activeAgents.add(agent);
  return agent;
}

function trackClientSocket<T extends net.Socket>(socket: T): T {
  activeSockets.add(socket);
  socket.on('error', () => undefined);
  socket.once('close', () => activeSockets.delete(socket));
  return socket;
}

function trackResponse(response: http.ServerResponse): http.ServerResponse {
  activeResponses.add(response);
  response.on('error', () => undefined);
  response.once('close', () => activeResponses.delete(response));
  return response;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      resolve();
    }, milliseconds);
    activeTimers.add(timer);
  });
}

class InfrastructureError extends Error {
  constructor(label: string) {
    super(label);
    this.name = 'InfrastructureError';
  }
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(label)), milliseconds);
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

async function capture(promise: Promise<unknown>): Promise<CapturedOutcome> {
  try {
    return { error: null, value: await promise };
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    return { error, value: null };
  }
}

function errorField(error: unknown, field: string): unknown {
  return Reflect.get(Object(error), field);
}

function expectTimeout(
  outcome: CapturedOutcome,
  code: string,
  phase: string,
): void {
  expect(outcome.value === null).toBe(true);
  expect(errorField(outcome.error, 'code')).toBe(code);
  expect(errorField(outcome.error, 'phase')).toBe(phase);
  expect(errorField(outcome.error, 'isTimeout')).toBe(true);
}

async function observeRow(
  id: RowId,
  operation: () => Promise<void> | void,
): Promise<void> {
  observedInvocations.set(id, (observedInvocations.get(id) ?? 0) + 1);
  currentRow = id;
  try {
    await operation();
    if (armedRed.delete(id)) {
      throw new InfrastructureError(
        `${id} passed its desired assertion after arming RED`,
      );
    }
    observedPasses.add(id);
  } catch (error) {
    const wasArmed = armedRed.delete(id);
    if (error instanceof InfrastructureError) {
      fixtureErrors.push(`${id} infrastructure: ${error.message}`);
    } else if (wasArmed) {
      observedFailures.add(id);
    } else {
      oracleInvalidations.push(
        `${id}:unarmed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  } finally {
    currentRow = undefined;
  }
}

async function settleExactlyOnce(
  promise: Promise<unknown>,
): Promise<{ events: string[]; outcome: CapturedOutcome; terminals: () => number }> {
  let terminalCount = 0;
  const events: string[] = [];
  const observed = promise.then(
    (value) => {
      terminalCount += 1;
      events.push('fulfilled');
      return { error: null, value } as CapturedOutcome;
    },
    (error: unknown) => {
      if (error instanceof InfrastructureError) throw error;
      terminalCount += 1;
      events.push('rejected');
      return { error, value: null } as CapturedOutcome;
    },
  );
  const outcome = await observed;
  return { events, outcome, terminals: () => terminalCount };
}

async function listenServer(
  server: http.Server | https.Server | net.Server,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture did not expose an IP port');
  }
  return address.port;
}

function safeEnd(response: http.ServerResponse, body = ''): void {
  if (response.destroyed || response.writableEnded) return;
  response.end(body);
}

async function preconnectPlain(port: number): Promise<net.Socket> {
  const socket = trackClientSocket(net.createConnection({ host: '127.0.0.1', port }));
  await within(
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    }),
    5_000,
    'raw TCP preconnect timed out',
  );
  return socket;
}

async function preconnectSecure(port: number): Promise<tls.TLSSocket> {
  const socket = tls.connect({
    host: '127.0.0.1',
    port,
    rejectUnauthorized: false,
  });
  trackClientSocket(socket);
  await within(
    new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', () => resolve());
      socket.once('error', reject);
    }),
    5_000,
    'TLS preconnect timed out',
  );
  return socket;
}

function agentResourceCount(agent: http.Agent): number {
  const countEntries = (
    entries: NodeJS.ReadOnlyDict<readonly unknown[]>,
  ): number => Object.values(entries).reduce(
    (total, values) => total + (values?.length ?? 0),
    0,
  );
  return countEntries(agent.requests) +
    countEntries(agent.sockets) +
    countEntries(agent.freeSockets);
}

async function cleanupResources(): Promise<void> {
  for (const gate of activeGates) {
    if (!gate.released) {
      cleanupErrors.push('row gate reached cleanup still held');
    }
  }
  const closePromises: Promise<void>[] = [];
  for (const server of [...activeServers]) {
    closePromises.push(new Promise<void>((resolve) => {
      if (!server.listening) {
        activeServers.delete(server);
        resolve();
        return;
      }
      try {
        server.close((error?: Error) => {
          if (error) cleanupErrors.push(error.message);
          else activeServers.delete(server);
          resolve();
        });
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
        resolve();
      }
    }));
  }

  for (const request of activeRequests) request.destroy();
  for (const response of activeResponses) safeEnd(response);
  for (const socket of activeSockets) socket.destroy();
  for (const agent of activeAgents) agent.destroy();
  for (const server of activeServers) {
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    if ('closeAllConnections' in server) server.closeAllConnections();
  }

  if (closePromises.length > 0) {
    try {
      await within(
        Promise.all(closePromises).then(() => undefined),
        5_000,
        'server cleanup timed out',
      );
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const timer of activeTimers) {
    clearTimeout(timer);
    activeTimers.delete(timer);
  }
  for (const path of activeTlsPaths) {
    try {
      rmSync(path, { force: true, recursive: true });
      activeTlsPaths.delete(path);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  resetGlobalAgentPool();

  const settlementDeadline = Date.now() + 5_000;
  while (
    (
      activeRequests.size > 0 ||
      activeResponses.size > 0 ||
      activeSockets.size > 0
    ) &&
    Date.now() < settlementDeadline
  ) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  for (const socket of activeSockets) {
    cleanupErrors.push(
      socket.destroyed
        ? 'destroyed socket did not emit close'
        : 'socket remained active after cleanup',
    );
  }
  for (const request of activeRequests) {
    cleanupErrors.push(
      request.destroyed
        ? 'destroyed client request did not emit close'
        : 'client request remained active after cleanup',
    );
  }
  for (const response of activeResponses) {
    cleanupErrors.push(
      response.destroyed
        ? 'destroyed server response did not emit close'
        : 'server response remained active after cleanup',
    );
  }
  for (const server of activeServers) {
    cleanupErrors.push(
      server.listening
        ? 'server still listening after close'
        : 'server did not settle after close',
    );
  }
  for (const agent of [...activeAgents]) {
    const resources = agentResourceCount(agent);
    if (resources === 0) {
      activeAgents.delete(agent);
    } else {
      cleanupErrors.push(`agent retained ${resources} resource(s) after destroy`);
    }
  }
}

interface TlsMaterial {
  certificatePath: string;
  keyPath: string;
}

function errorSummary(error: unknown): string {
  const boxed = Object(error);
  const code = Reflect.get(boxed, 'code');
  const message = Reflect.get(boxed, 'message');
  return [code, message]
    .filter((value) => value !== undefined)
    .map(String)
    .join(': ');
}

function generateTlsMaterial(): TlsMaterial {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-phase1-pcs-'));
  activeTlsPaths.add(directory);
  const keyPath = join(directory, 'key.pem');
  const certificatePath = join(directory, 'certificate.pem');
  const commonArguments = [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-subj',
    '/CN=127.0.0.1',
    '-days',
    '1',
  ];
  try {
    execFileSync('openssl', [
      ...commonArguments,
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 15_000 });
  } catch (extensionError) {
    try {
      // Older LibreSSL releases do not support -addext. Verification is
      // disabled inside the requesting row, so a CN-only fixture suffices.
      execFileSync('openssl', commonArguments, {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 15_000,
      });
    } catch (fallbackError) {
      throw new Error(
        `unable to generate the TLS fixture (addext: ${errorSummary(extensionError)}; fallback: ${errorSummary(fallbackError)})`,
        { cause: fallbackError },
      );
    }
  }
  return { certificatePath, keyPath };
}

class HandoffAgent extends http.Agent {
  handoffs = 0;
  connectionsCreated = 0;
  #providedSocket: net.Socket | null;

  constructor(providedSocket: net.Socket) {
    super({ keepAlive: false, maxSockets: 1 });
    this.#providedSocket = providedSocket;
  }

  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    this.handoffs += 1;
    activeRequests.add(request);
    request.once('close', () => activeRequests.delete(request));
    super.addRequest(request, options);
  }

  override createConnection(
    _options: http.ClientRequestArgs,
    callback?: (error: Error | null, stream: net.Socket) => void,
  ): net.Socket {
    this.connectionsCreated += 1;
    const socket = this.#providedSocket;
    this.#providedSocket = null;
    if (socket === null) {
      // Unreachable by construction (maxSockets: 1, single request); the
      // guard fails the row loudly instead of fabricating a socket.
      throw new Error('preconnected fixture socket was already consumed');
    }
    if (callback) {
      queueMicrotask(() => callback(null, socket));
    }
    return socket;
  }
}

class SecureHandoffAgent extends https.Agent {
  handoffs = 0;
  connectionsCreated = 0;
  #providedSocket: net.Socket | null;

  constructor(providedSocket: net.Socket) {
    super({ keepAlive: false, maxSockets: 1 });
    this.#providedSocket = providedSocket;
  }

  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    this.handoffs += 1;
    activeRequests.add(request);
    request.once('close', () => activeRequests.delete(request));
    super.addRequest(request, options);
  }

  override createConnection(
    _options: http.ClientRequestArgs,
    callback?: (error: Error | null, stream: net.Socket) => void,
  ): net.Socket {
    this.connectionsCreated += 1;
    const socket = this.#providedSocket;
    this.#providedSocket = null;
    if (socket === null) {
      // Unreachable by construction (maxSockets: 1, single request); the
      // guard fails the row loudly instead of fabricating a socket.
      throw new Error('preconnected fixture socket was already consumed');
    }
    if (callback) {
      queueMicrotask(() => callback(null, socket));
    }
    return socket;
  }
}

class CountingAgent extends http.Agent {
  assignments = 0;
  connectionsCreated = 0;

  constructor() {
    super({ keepAlive: true, maxSockets: 1 });
  }

  override addRequest(
    request: http.ClientRequest,
    options: http.ClientRequestArgs,
  ): void {
    activeRequests.add(request);
    request.once('close', () => activeRequests.delete(request));
    request.once('socket', () => {
      this.assignments += 1;
    });
    super.addRequest(request, options);
  }

  override createConnection(
    options: http.ClientRequestArgs,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    this.connectionsCreated += 1;
    const trackingCallback = callback
      ? (error: Error | null, stream: Duplex): void => {
          if (!error && stream instanceof net.Socket) trackClientSocket(stream);
          callback(error, stream);
        }
      : undefined;
    const created = super.createConnection(options, trackingCallback);
    if (created instanceof net.Socket) trackClientSocket(created);
    return created;
  }
}

function client(): Rezo {
  return new Rezo({}, httpAdapter);
}

afterEach(async () => {
  await cleanupResources();
});

afterAll(async () => {
  await cleanupResources();
  const expectedRed = [...EXPECTED_RED].sort();
  const expectedPassed = [...EXPECTED_PASSED].sort();
  const actualRed = [...observedFailures].sort();
  const actualPassed = [...observedPasses].sort();
  const actualRegistered = [...observedInvocations.keys()].sort();
  const oracleMismatches = [...oracleInvalidations];
  for (const id of REGISTERED) {
    const count = observedInvocations.get(id) ?? 0;
    if (count !== 1) oracleMismatches.push(`invocations:${id}:${count}`);
  }
  for (const [id, count] of observedInvocations) {
    if (!REGISTERED.includes(id)) {
      oracleMismatches.push(`unexpected-invocations:${id}:${count}`);
    }
  }
  if (JSON.stringify(actualRegistered) !== JSON.stringify([...REGISTERED].sort())) {
    oracleMismatches.push(`registered:${JSON.stringify(actualRegistered)}`);
  }
  if (armedRed.size !== 0) {
    oracleMismatches.push(`armed-after-file:${JSON.stringify([...armedRed].sort())}`);
  }
  if (JSON.stringify(actualRed) !== JSON.stringify(expectedRed)) {
    oracleMismatches.push(`red:${JSON.stringify(actualRed)}`);
  }
  if (JSON.stringify(actualPassed) !== JSON.stringify(expectedPassed)) {
    oracleMismatches.push(`passed:${JSON.stringify(actualPassed)}`);
  }
  const cleanup: CleanupLedger = {
    agents: activeAgents.size,
    children: 0,
    complete:
      cleanupErrors.length === 0 &&
      teardownErrors.length === 0 &&
      activeAgents.size === 0 &&
      activeGates.size === 0 &&
      activeRequests.size === 0 &&
      activeResponses.size === 0 &&
      activeServers.size === 0 &&
      activeSockets.size === 0 &&
      activeTimers.size === 0 &&
      activeTlsPaths.size === 0,
    heldGates: [...activeGates].filter((gate) => !gate.released).length,
    requests: activeRequests.size,
    responses: activeResponses.size,
    servers: activeServers.size,
    sockets: activeSockets.size,
    temporaryTlsPaths: activeTlsPaths.size,
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
});

if (RUNTIME === 'node') {
  it('PCS-01 first-use preconnected socket succeeds without a false connect terminal', async () => {
    await observeRow('PCS-01', async () => {
      let serverHits = 0;
      let responseCompletions = 0;
      const requestArrived = createGate();
      const releaseResponse = createGate();
      const responseSent = createGate();
      const server = trackServer(http.createServer((request, response) => {
        serverHits += 1;
        trackResponse(response);
        request.on('error', () => undefined);
        requestArrived.release();
        void releaseResponse.promise.then(() => {
          try {
            if (!response.destroyed && !response.writableEnded && !response.headersSent) {
              response.writeHead(200, { 'content-type': 'text/plain' });
            }
            safeEnd(response, 'ok');
            responseCompletions += 1;
          } catch (error) {
            recordFixtureError(error);
          } finally {
            responseSent.release();
          }
        }).catch(() => undefined);
      }));
      const port = await listenServer(server);
      const preconnected = await preconnectPlain(port);
      let afterHeadersCalls = 0;
      let afterResponseCalls = 0;
      let beforeErrorCalls = 0;
      const channelSequence: string[] = [];
      preconnected.on('data', () => {
        channelSequence.push('client-data');
      });
      const agent = trackAgent(new HandoffAgent(preconnected));

      let settled = false;
      const trackedSettlement = settleExactlyOnce(
        within(
          client().get(`http://127.0.0.1:${port}/pcs-01`, {
            hooks: {
              afterHeaders: [() => {
                afterHeadersCalls += 1;
                channelSequence.push('after-headers');
              }],
              afterResponse: [(response) => {
                afterResponseCalls += 1;
                channelSequence.push('after-response');
                return response;
              }],
              beforeError: [(error) => {
                beforeErrorCalls += 1;
                channelSequence.push('before-error');
                return error;
              }],
            },
            httpAgent: agent,
            retry: false,
            timeout: { connect: 250, headers: 4_000, total: 8_000 },
          }),
          7_000,
          'PCS-01 watchdog',
        ),
      ).then((result) => {
        settled = true;
        return result;
      });
      void trackedSettlement.catch(() => undefined);

      await within(requestArrived.promise, 500, 'PCS-01 request did not reach the server');
      await delay(400);
      const settledBeforeRelease = settled;
      let observation: Awaited<ReturnType<typeof settleExactlyOnce>> | undefined;
      if (settledBeforeRelease) {
        observation = await within(
          trackedSettlement,
          100,
          'PCS-01 pre-release settlement was not observable',
        );
        expect(errorField(observation.outcome.error, 'code')).toBe('ETIMEDOUT');
        expect(errorField(observation.outcome.error, 'phase')).toBe('connect');
        expect(errorField(observation.outcome.error, 'isTimeout')).toBe(true);
        expect(observation.outcome.value).toBeNull();
        expect(agent.handoffs).toBe(1);
        expect(agent.connectionsCreated).toBe(1);
        expect(serverHits).toBe(1);
        expect(responseCompletions).toBe(0);
        expect(afterHeadersCalls).toBe(0);
        expect(afterResponseCalls).toBe(0);
        expect(beforeErrorCalls).toBe(1);
        expect(channelSequence).toEqual(['before-error']);
        expect(observation.events).toEqual(['rejected']);
        expect(observation.terminals()).toBe(1);
        const beforeLate = [
          afterHeadersCalls,
          afterResponseCalls,
          beforeErrorCalls,
          observation.terminals(),
          [...observation.events],
          [...channelSequence],
        ];
        releaseResponse.release();
        await within(responseSent.promise, 500, 'PCS-01 held response tail did not execute');
        await delay(150);
        const afterLate = [
          afterHeadersCalls,
          afterResponseCalls,
          beforeErrorCalls,
          observation.terminals(),
          [...observation.events],
          [...channelSequence],
        ];
        if (JSON.stringify(afterLate) !== JSON.stringify(beforeLate)) {
          lateEvents.push(`PCS-01:${JSON.stringify({ after: afterLate, before: beforeLate })}`);
        }
        expect(afterLate).toEqual(beforeLate);
        expect(responseCompletions).toBe(1);
        expect(lateEvents).toEqual([]);
        armExpectedRed('PCS-01');
      } else {
        releaseResponse.release();
      }

      const finalObservation = observation ?? await within(
        trackedSettlement,
        8_500,
        'PCS-01 settlement was not observable',
      );
      expect(errorField(finalObservation.outcome.error, 'code')).not.toBe('ETIMEDOUT');
      expect(errorField(finalObservation.outcome.error, 'phase')).not.toBe('connect');
      expect(finalObservation.outcome.error === null).toBe(true);
      expect(errorField(finalObservation.outcome.value, 'status')).toBe(200);
      expect(serverHits).toBe(1);
      expect(agent.handoffs).toBe(1);
      expect(agent.connectionsCreated).toBe(1);
      expect(afterHeadersCalls).toBe(1);
      expect(afterResponseCalls).toBe(1);
      expect(beforeErrorCalls).toBe(0);
      expect(channelSequence.filter((channel) => channel === 'client-data').length).toBeGreaterThan(0);
      expect(channelSequence.filter((channel) => channel === 'after-headers')).toHaveLength(1);
      expect(channelSequence.filter((channel) => channel === 'after-response')).toHaveLength(1);
      expect(channelSequence.filter((channel) => channel === 'before-error')).toHaveLength(0);
      expect(finalObservation.events).toEqual(['fulfilled']);
      await within(responseSent.promise, 500, 'PCS-01 response completion was not observable');
      const beforeLate = [
        afterHeadersCalls,
        afterResponseCalls,
        beforeErrorCalls,
        finalObservation.terminals(),
        [...finalObservation.events],
        [...channelSequence],
      ];
      await delay(150);
      const afterLate = [
        afterHeadersCalls,
        afterResponseCalls,
        beforeErrorCalls,
        finalObservation.terminals(),
        [...finalObservation.events],
        [...channelSequence],
      ];
      if (JSON.stringify(afterLate) !== JSON.stringify(beforeLate)) {
        lateEvents.push(`PCS-01:${JSON.stringify({ after: afterLate, before: beforeLate })}`);
      }
      expect(afterLate).toEqual(beforeLate);
      expect(responseCompletions).toBe(1);
      expect(finalObservation.terminals()).toBe(1);
      expect(lateEvents).toEqual([]);
    });
  });
}

if (RUNTIME === 'node') {
  it('PCS-02 preconnected readiness arms the headers phase, never a false connect error', async () => {
    await observeRow('PCS-02', async () => {
      let serverHits = 0;
      let lateWriteExecutions = 0;
      const requestArrived = createGate();
      const headersGate = createGate();
      const responseSent = createGate();
      const server = trackServer(http.createServer((request, response) => {
        serverHits += 1;
        trackResponse(response);
        request.on('error', () => undefined);
        requestArrived.release();
        void headersGate.promise.then(() => {
          try {
            if (!response.headersSent && !response.destroyed && !response.writableEnded) {
              response.writeHead(200, { 'content-type': 'text/plain' });
            }
            safeEnd(response, 'late');
            lateWriteExecutions += 1;
          } catch (error) {
            recordFixtureError(error);
          } finally {
            responseSent.release();
          }
        }).catch(() => undefined);
      }));
      const port = await listenServer(server);
      const preconnected = await preconnectPlain(port);
      let afterHeadersCalls = 0;
      let afterResponseCalls = 0;
      let beforeErrorCalls = 0;
      const channelSequence: string[] = [];
      preconnected.on('data', () => {
        channelSequence.push('client-data');
      });
      const agent = trackAgent(new HandoffAgent(preconnected));

      let settled = false;
      const trackedSettlement = settleExactlyOnce(
        within(
          client().get(`http://127.0.0.1:${port}/pcs-02`, {
            hooks: {
              afterHeaders: [() => {
                afterHeadersCalls += 1;
                channelSequence.push('after-headers');
              }],
              afterResponse: [(response) => {
                afterResponseCalls += 1;
                channelSequence.push('after-response');
                return response;
              }],
              beforeError: [(error) => {
                beforeErrorCalls += 1;
                channelSequence.push('before-error');
                return error;
              }],
            },
            httpAgent: agent,
            retry: false,
            timeout: { connect: 250, headers: 700, total: 8_000 },
          }),
          7_000,
          'PCS-02 watchdog',
        ),
      ).then((result) => {
        settled = true;
        return result;
      });
      void trackedSettlement.catch(() => undefined);

      await within(requestArrived.promise, 500, 'PCS-02 request did not reach the server');
      await delay(400);
      const settledBeforeRelease = settled;
      let observation: Awaited<ReturnType<typeof settleExactlyOnce>> | undefined;
      if (settledBeforeRelease) {
        observation = await within(
          trackedSettlement,
          100,
          'PCS-02 pre-release settlement was not observable',
        );
        expect(errorField(observation.outcome.error, 'code')).toBe('ETIMEDOUT');
        expect(errorField(observation.outcome.error, 'phase')).toBe('connect');
        expect(errorField(observation.outcome.error, 'isTimeout')).toBe(true);
        expect(observation.outcome.value).toBeNull();
        expect(agent.handoffs).toBe(1);
        expect(serverHits).toBe(1);
        expect(lateWriteExecutions).toBe(0);
        expect(afterHeadersCalls).toBe(0);
        expect(afterResponseCalls).toBe(0);
        expect(beforeErrorCalls).toBe(1);
        expect(channelSequence).toEqual(['before-error']);
        expect(observation.events).toEqual(['rejected']);
        expect(observation.terminals()).toBe(1);
        const beforeLate = [
          afterHeadersCalls,
          afterResponseCalls,
          beforeErrorCalls,
          observation.terminals(),
          [...observation.events],
          [...channelSequence],
        ];
        headersGate.release();
        await within(responseSent.promise, 500, 'PCS-02 held response tail did not execute');
        await delay(150);
        const afterLate = [
          afterHeadersCalls,
          afterResponseCalls,
          beforeErrorCalls,
          observation.terminals(),
          [...observation.events],
          [...channelSequence],
        ];
        if (JSON.stringify(afterLate) !== JSON.stringify(beforeLate)) {
          lateEvents.push(`PCS-02:${JSON.stringify({ after: afterLate, before: beforeLate })}`);
        }
        expect(afterLate).toEqual(beforeLate);
        expect(lateWriteExecutions).toBe(1);
        expect(lateEvents).toEqual([]);
        armExpectedRed('PCS-02');
      }

      const finalObservation = observation ?? await within(
        trackedSettlement,
        8_500,
        'PCS-02 settlement was not observable',
      );
      expect(errorField(finalObservation.outcome.error, 'code')).not.toBe('ETIMEDOUT');
      expect(errorField(finalObservation.outcome.error, 'phase')).not.toBe('connect');
      expectTimeout(finalObservation.outcome, 'ESOCKETTIMEDOUT', 'headers');
      expect(serverHits).toBe(1);
      expect(agent.handoffs).toBe(1);
      expect(afterHeadersCalls).toBe(0);
      expect(afterResponseCalls).toBe(0);
      expect(beforeErrorCalls).toBe(1);
      expect(channelSequence).toEqual(['before-error']);
      expect(finalObservation.events).toEqual(['rejected']);

      headersGate.release();
      await within(responseSent.promise, 500, 'PCS-02 late-write completion was not observable');
      const beforeLate = [
        afterHeadersCalls,
        afterResponseCalls,
        beforeErrorCalls,
        finalObservation.terminals(),
        [...finalObservation.events],
        [...channelSequence],
      ];
      await delay(150);
      const afterLate = [
        afterHeadersCalls,
        afterResponseCalls,
        beforeErrorCalls,
        finalObservation.terminals(),
        [...finalObservation.events],
        [...channelSequence],
      ];
      if (JSON.stringify(afterLate) !== JSON.stringify(beforeLate)) {
        lateEvents.push(`PCS-02:${JSON.stringify({ after: afterLate, before: beforeLate })}`);
      }
      expect(afterLate).toEqual(beforeLate);
      expect(lateWriteExecutions).toBe(1);
      expect(finalObservation.terminals()).toBe(1);
      expect(finalObservation.outcome.value === null).toBe(true);
      expect(lateEvents).toEqual([]);
    });
  });
}

if (RUNTIME === 'node') {
  it('PCS-03 already-open socket with an immediate response succeeds exactly once', async () => {
    await observeRow('PCS-03', async () => {
      let serverHits = 0;
      const server = trackServer(http.createServer((request, response) => {
        serverHits += 1;
        trackResponse(response);
        request.on('error', () => undefined);
        response.writeHead(200, { 'content-type': 'text/plain' });
        safeEnd(response, 'ok');
      }));
      const port = await listenServer(server);
      const preconnected = await preconnectPlain(port);
      const agent = trackAgent(new HandoffAgent(preconnected));

      const outcome = await capture(
        within(
          client().get(`http://127.0.0.1:${port}/pcs-03`, {
            httpAgent: agent,
            retry: false,
            timeout: { connect: 300, total: 5_000 },
          }),
          6_000,
          'PCS-03 watchdog',
        ),
      );

      expect(outcome.error === null).toBe(true);
      expect(errorField(outcome.value, 'status')).toBe(200);
      expect(serverHits).toBe(1);
      expect(agent.handoffs).toBe(1);
      expect(agent.connectionsCreated).toBe(1);
    });
  });
}

if (RUNTIME === 'node') {
  it('PCS-04N already-secure HTTPS socket succeeds once through the custom Agent', async () => {
    await observeRow('PCS-04N', async () => {
      const material = generateTlsMaterial();
      let serverHits = 0;
      const server = trackServer(https.createServer({
        cert: readFileSync(material.certificatePath),
        key: readFileSync(material.keyPath),
      }, (request, response) => {
        serverHits += 1;
        trackResponse(response);
        request.on('error', () => undefined);
        response.writeHead(200, { 'content-type': 'text/plain' });
        safeEnd(response, 'ok');
      }));
      const port = await listenServer(server);
      const preconnected = await preconnectSecure(port);
      const agent = trackAgent(new SecureHandoffAgent(preconnected));

      const outcome = await capture(
        within(
          client().get(`https://127.0.0.1:${port}/pcs-04n`, {
            httpsAgent: agent,
            rejectUnauthorized: false,
            retry: false,
            timeout: { connect: 300, total: 5_000 },
          }),
          6_000,
          'PCS-04N watchdog',
        ),
      );

      expect(outcome.error === null).toBe(true);
      expect(errorField(outcome.value, 'status')).toBe(200);
      expect(serverHits).toBe(1);
      expect(agent.handoffs).toBe(1);
      expect(agent.connectionsCreated).toBe(1);
    });
  });

  it('PCS-05N TCP-open TLS-pending socket remains governed by the connect budget', async () => {
    await observeRow('PCS-05N', async () => {
      let rawConnections = 0;
      const server = trackServer(net.createServer((socket) => {
        rawConnections += 1;
        socket.on('error', () => undefined);
        socket.on('data', () => undefined);
      }));
      const port = await listenServer(server);
      const tcpSocket = await preconnectPlain(port);
      let secureConnectEvents = 0;
      const pendingTls = tls.connect({
        rejectUnauthorized: false,
        socket: tcpSocket,
      });
      trackClientSocket(pendingTls);
      pendingTls.on('secureConnect', () => {
        secureConnectEvents += 1;
      });
      const agent = trackAgent(new SecureHandoffAgent(pendingTls));

      const { outcome, terminals } = await settleExactlyOnce(
        within(
          client().get(`https://127.0.0.1:${port}/pcs-05n`, {
            httpsAgent: agent,
            rejectUnauthorized: false,
            retry: false,
            timeout: { connect: 400, total: 5_000 },
          }),
          6_000,
          'PCS-05N watchdog',
        ),
      );

      expect(secureConnectEvents).toBe(0);
      expectTimeout(outcome, 'ETIMEDOUT', 'connect');
      expect(terminals()).toBe(1);
      expect(agent.handoffs).toBe(1);
      expect(rawConnections).toBe(1);
    });
  });
}

it('PCS-06 ordinary fresh and reused Agent sockets keep exact connection counts', async () => {
  await observeRow('PCS-06', async () => {
    let serverConnections = 0;
    let serverHits = 0;
    const server = trackServer(http.createServer((request, response) => {
      serverHits += 1;
      trackResponse(response);
      request.on('error', () => undefined);
      response.writeHead(200, { 'content-type': 'text/plain' });
      safeEnd(response, 'ok');
    }));
    server.on('connection', () => {
      serverConnections += 1;
    });
    const port = await listenServer(server);
    const agent = trackAgent(new CountingAgent());
    const rezo = client();

    const first = await within(
      rezo.get(`http://127.0.0.1:${port}/pcs-06-a`, {
        httpAgent: agent,
        retry: false,
        timeout: { connect: 500, total: 4_000 },
      }),
      6_000,
      'PCS-06 first watchdog',
    );
    const second = await within(
      rezo.get(`http://127.0.0.1:${port}/pcs-06-b`, {
        httpAgent: agent,
        retry: false,
        timeout: { connect: 500, total: 4_000 },
      }),
      6_000,
      'PCS-06 second watchdog',
    );

    expect(errorField(first, 'status')).toBe(200);
    expect(errorField(second, 'status')).toBe(200);
    expect(serverHits).toBe(2);
    expect(serverConnections).toBe(1);
    if (RUNTIME === 'node') {
      expect(agent.connectionsCreated).toBe(1);
      expect(agent.assignments).toBe(2);
    }
  });
});

it('PCS-07 stale keep-alive reset still recovers with one fresh-socket retry', async () => {
  await observeRow('PCS-07', async () => {
    let connectionCount = 0;
    const requestsPerConnection: number[] = [];
    const server = trackServer(net.createServer((socket) => {
      const index = connectionCount;
      connectionCount += 1;
      requestsPerConnection[index] = 0;
      let buffer = '';
      socket.on('error', () => undefined);
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('latin1');
        while (buffer.includes('\r\n\r\n')) {
          buffer = buffer.slice(buffer.indexOf('\r\n\r\n') + 4);
          requestsPerConnection[index] += 1;
          if (index === 0 && requestsPerConnection[index] === 2) {
            socket.destroy();
            return;
          }
          socket.write(
            'HTTP/1.1 200 OK\r\n' +
            'Content-Type: text/plain\r\n' +
            'Content-Length: 2\r\n' +
            'Connection: keep-alive\r\n' +
            '\r\n' +
            'ok',
          );
        }
      });
    }));
    const port = await listenServer(server);
    const rezo = client();
    const url = `http://127.0.0.1:${port}/pcs-07`;

    const first = await within(
      rezo.get(url, { retry: false, timeout: { total: 5_000 } }),
      6_000,
      'PCS-07 first watchdog',
    );
    const second = await within(
      rezo.get(url, { retry: false, timeout: { total: 5_000 } }),
      6_000,
      'PCS-07 second watchdog',
    );

    expect(errorField(first, 'status')).toBe(200);
    expect(errorField(second, 'status')).toBe(200);
    expect(connectionCount).toBe(2);
    expect(requestsPerConnection[0]).toBe(2);
    expect(requestsPerConnection[1]).toBe(1);
  });
});
