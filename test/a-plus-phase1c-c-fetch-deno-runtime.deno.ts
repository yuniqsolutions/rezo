import { Rezo, RezoError } from '../src/index.ts';
import type { RezoDefaultOptions, RezoRequestConfig } from '../src/index.ts';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch.ts';

interface SerializedError {
  readonly code: string | null;
  readonly errno: number | null;
  readonly message: string;
  readonly name: string;
  readonly requestFullUrl: string | null;
  readonly responseFinalUrl: string | null;
  readonly responseStatus: number | null;
}

function errorRecord(value: unknown): SerializedError {
  const object = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Record<string, unknown>
    : null;
  const request = object?.request as Record<string, unknown> | undefined;
  const response = object?.response as Record<string, unknown> | undefined;
  return {
    code: typeof object?.code === 'string' ? object.code : null,
    errno: typeof object?.errno === 'number' ? object.errno : null,
    message: typeof object?.message === 'string' ? object.message : String(value),
    name: typeof object?.name === 'string' ? object.name : typeof value,
    requestFullUrl: typeof request?.fullUrl === 'string' ? request.fullUrl : null,
    responseFinalUrl: typeof response?.finalUrl === 'string' ? response.finalUrl : null,
    responseStatus: typeof response?.status === 'number' ? response.status : null,
  };
}

function jsonEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

interface WireEntry {
  readonly body: string;
  readonly marker: string | null;
  readonly method: string;
  readonly path: string;
}

type ProbeOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'rejected'; readonly value: unknown }
  | { readonly kind: 'resolved'; readonly value: unknown };

interface ProbeObservation {
  readonly baseUrl: string;
  readonly cleanupFailures: readonly string[];
  readonly globalErrors: readonly SerializedError[];
  readonly globalUnhandledRejections: readonly SerializedError[];
  readonly lateWireStable: boolean;
  readonly outcome: ProbeOutcome;
  readonly wire: readonly WireEntry[];
}

interface ProbeContext {
  readonly baseUrl: string;
  readonly client: Rezo;
}

interface RedirectCapture {
  readonly config: unknown;
  readonly request: unknown;
  readonly response: unknown;
}

interface StructuredErrorExpectation {
  readonly code: string;
  readonly errno: number;
  readonly historyLength: number;
  readonly location?: string | null;
  readonly maxRedirectsReached: boolean;
  readonly message: string;
  readonly redirectCount: number;
  readonly responseStatus: number;
  readonly sourceUrl: string;
  readonly wirePaths: readonly string[];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Record<string, unknown>
    : null;
}

function headerValue(headers: unknown, name: string): string | null {
  const record = objectRecord(headers);
  const getter = record?.get;
  if (typeof getter !== 'function') return null;
  const value = Reflect.apply(getter, headers, [name]);
  return typeof value === 'string' ? value : null;
}

function wirePaths(observation: ProbeObservation): string[] {
  return observation.wire.map((entry) => entry.path);
}

function rowCheck(
  failures: string[],
  condition: boolean,
  message: string,
): void {
  if (!condition) failures.push(message);
}

function rowEqual(
  failures: string[],
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  if (!jsonEqual(actual, expected)) {
    failures.push(`${label}\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(actual)}`);
  }
}

function finishRow(failures: readonly string[]): void {
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((message) => new Error(message)),
      failures.join('\n\n'),
    );
  }
}

function requestOptions(overrides: RezoRequestConfig = {}): RezoRequestConfig {
  return {
    cache: false,
    retry: false,
    timeout: 2_000,
    ...overrides,
  };
}

function responseWithLocation(status: number, location: string): Response {
  return new Response(null, {
    headers: {
      location,
      'x-phase3-source': 'redirect',
    },
    status,
  });
}

async function runProbe(
  rowId: string,
  execute: (context: ProbeContext) => Promise<unknown>,
  defaults: RezoDefaultOptions = {},
): Promise<ProbeObservation> {
  const cleanupFailures: string[] = [];
  const globalErrors: SerializedError[] = [];
  const globalUnhandledRejections: SerializedError[] = [];
  const wire: WireEntry[] = [];
  const prefix = `/matrix/deno/${rowId.toLowerCase()}`;

  const onGlobalError = (event: ErrorEvent): void => {
    globalErrors.push(errorRecord(event.error ?? event));
    event.preventDefault();
  };
  const onGlobalUnhandled = (event: PromiseRejectionEvent): void => {
    globalUnhandledRejections.push(errorRecord(event.reason));
    event.preventDefault();
  };
  globalThis.addEventListener('error', onGlobalError);
  globalThis.addEventListener('unhandledrejection', onGlobalUnhandled);

  const server = Deno.serve({
    hostname: '127.0.0.1',
    onListen: () => undefined,
    port: 0,
  }, async (request) => {
    const url = new URL(request.url);
    const body = request.body === null ? '' : await request.text();
    wire.push({
      body,
      marker: request.headers.get('x-phase3-marker'),
      method: request.method,
      path: url.pathname,
    });

    const route = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : url.pathname;
    switch (route) {
      case '/chain/0':
        return responseWithLocation(302, `${prefix}/chain/1`);
      case '/chain/1':
        return responseWithLocation(302, `${prefix}/chain/2`);
      case '/chain/2':
        return responseWithLocation(302, `${prefix}/chain/3`);
      case '/chain/3':
        return new Response('chain-final', {
          headers: { 'x-phase3-target': 'chain-final' },
          status: 200,
        });
      case '/valid/start':
        return responseWithLocation(307, `${prefix}/valid/forbidden`);
      case '/valid/forbidden':
        return new Response('forbidden-destination', { status: 200 });
      case '/malformed/start':
        return responseWithLocation(302, 'http://[');
      case '/missing/start':
        return new Response(null, {
          headers: { 'x-phase3-source': 'missing' },
          status: 302,
        });
      case '/cycle/start':
        return responseWithLocation(307, `${prefix}/cycle/raw-first-alias`);
      case '/cycle/middle':
        return responseWithLocation(307, `${prefix}/cycle/raw-second-alias`);
      case '/cycle/raw-first-alias':
      case '/cycle/raw-second-alias':
        return new Response('cycle-alias-should-not-run', { status: 200 });
      case '/status/404':
        return new Response('not-found', {
          headers: { 'x-phase3-source': '404' },
          status: 404,
        });
      case '/status/500':
        return new Response('server-error', {
          headers: { 'x-phase3-source': '500' },
          status: 500,
        });
      case '/status/304':
        return responseWithLocation(304, `${prefix}/valid/forbidden`);
      default:
        return new Response('unexpected fixture route', { status: 418 });
    }
  });
  const port = (server.addr as Deno.NetAddr).port;
  const baseUrl = `http://127.0.0.1:${port}${prefix}`;
  const client = new Rezo(defaults, fetchAdapter);

  let outcome: ProbeOutcome;
  let wireCountAtSettlement = 0;
  let settlementTimer: number | undefined;
  try {
    const observedRequest = execute({ baseUrl, client }).then<ProbeOutcome>(
      (value) => ({ kind: 'resolved', value }),
      (value: unknown) => ({ kind: 'rejected', value }),
    );
    outcome = await Promise.race([
      observedRequest,
      new Promise<ProbeOutcome>((resolveBound) => {
        settlementTimer = setTimeout(() => resolveBound({ kind: 'pending' }), 2_500);
      }),
    ]);
    if (settlementTimer !== undefined) clearTimeout(settlementTimer);
    wireCountAtSettlement = wire.length;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 40));
  } finally {
    if (settlementTimer !== undefined) clearTimeout(settlementTimer);
    client.destroy();
    globalThis.removeEventListener('error', onGlobalError);
    globalThis.removeEventListener('unhandledrejection', onGlobalUnhandled);
    try {
      await server.shutdown();
    } catch (error) {
      cleanupFailures.push(`fixture cleanup failed: ${errorRecord(error).message}`);
    }
  }

  return {
    baseUrl,
    cleanupFailures,
    globalErrors,
    globalUnhandledRejections,
    lateWireStable: wire.length === wireCountAtSettlement,
    outcome,
    wire,
  };
}

function expectCleanProbe(
  failures: string[],
  label: string,
  observation: ProbeObservation,
): void {
  rowEqual(failures, `${label}: global error ledger`, observation.globalErrors, []);
  rowEqual(
    failures,
    `${label}: global unhandled-rejection ledger`,
    observation.globalUnhandledRejections,
    [],
  );
  rowEqual(failures, `${label}: cleanup failures`, observation.cleanupFailures, []);
  rowCheck(failures, observation.lateWireStable, `${label}: wire changed after settlement`);
}

function expectStructuredError(
  failures: string[],
  label: string,
  observation: ProbeObservation,
  expected: StructuredErrorExpectation,
): void {
  expectCleanProbe(failures, label, observation);
  rowEqual(failures, `${label}: wire`, wirePaths(observation), expected.wirePaths);
  if (observation.outcome.kind !== 'rejected') {
    failures.push(`${label}: expected rejection, received ${observation.outcome.kind}`);
    return;
  }

  const error = objectRecord(observation.outcome.value);
  const config = objectRecord(error?.config);
  const request = objectRecord(error?.request);
  const response = objectRecord(error?.response);
  const history = config?.redirectHistory;
  rowEqual(failures, `${label}: code`, error?.code, expected.code);
  rowEqual(failures, `${label}: errno`, error?.errno, expected.errno);
  rowEqual(failures, `${label}: message`, error?.message, expected.message);
  rowEqual(failures, `${label}: response status`, response?.status, expected.responseStatus);
  rowEqual(failures, `${label}: response final URL`, response?.finalUrl, expected.sourceUrl);
  if (Object.prototype.hasOwnProperty.call(expected, 'location')) {
    rowEqual(
      failures,
      `${label}: response Location`,
      headerValue(response?.headers, 'location'),
      expected.location,
    );
  }
  rowEqual(failures, `${label}: request full URL`, request?.fullUrl, expected.sourceUrl);
  rowEqual(failures, `${label}: config final URL`, config?.finalUrl, expected.sourceUrl);
  rowEqual(failures, `${label}: redirect count`, config?.redirectCount, expected.redirectCount);
  rowEqual(
    failures,
    `${label}: redirect history length`,
    Array.isArray(history) ? history.length : null,
    expected.historyLength,
  );
  if (expected.maxRedirectsReached) {
    rowEqual(
      failures,
      `${label}: maxRedirectsReached`,
      config?.maxRedirectsReached,
      true,
    );
  } else {
    rowCheck(
      failures,
      config?.maxRedirectsReached !== true,
      `${label}: maxRedirectsReached was true outside limit enforcement`,
    );
  }
  rowCheck(failures, config !== null, `${label}: error.config is not an object`);
  rowCheck(failures, request !== null, `${label}: error.request is not an object`);
  rowCheck(failures, response !== null, `${label}: error.response is not an object`);
  rowCheck(
    failures,
    response?.config === error?.config,
    `${label}: response.config is not the exact error.config`,
  );
  rowCheck(
    failures,
    config?.originalRequest === error?.request,
    `${label}: config.originalRequest is not the exact error.request`,
  );
}

function expectResolvedChain(
  failures: string[],
  label: string,
  observation: ProbeObservation,
): void {
  expectCleanProbe(failures, label, observation);
  rowEqual(failures, `${label}: wire`, wirePaths(observation), [
    `${new URL(observation.baseUrl).pathname}/chain/0`,
    `${new URL(observation.baseUrl).pathname}/chain/1`,
    `${new URL(observation.baseUrl).pathname}/chain/2`,
    `${new URL(observation.baseUrl).pathname}/chain/3`,
  ]);
  if (observation.outcome.kind !== 'resolved') {
    failures.push(`${label}: expected resolution, received ${observation.outcome.kind}`);
    return;
  }
  const response = objectRecord(observation.outcome.value);
  const config = objectRecord(response?.config);
  const finalUrl = `${observation.baseUrl}/chain/3`;
  rowEqual(failures, `${label}: status`, response?.status, 200);
  rowEqual(failures, `${label}: final URL`, response?.finalUrl, finalUrl);
  rowEqual(failures, `${label}: config final URL`, config?.finalUrl, finalUrl);
  rowEqual(failures, `${label}: redirect count`, config?.redirectCount, 3);
  rowEqual(
    failures,
    `${label}: redirect history length`,
    Array.isArray(config?.redirectHistory) ? config.redirectHistory.length : null,
    3,
  );
  rowCheck(
    failures,
    config?.maxRedirectsReached !== true,
    `${label}: maxRedirectsReached was true on a completed chain`,
  );
}

function expectResolvedSource(
  failures: string[],
  label: string,
  observation: ProbeObservation,
  sourcePath: string,
  location: string,
  expectedStatus = 302,
): void {
  expectCleanProbe(failures, label, observation);
  const path = `${new URL(observation.baseUrl).pathname}${sourcePath}`;
  const sourceUrl = `${observation.baseUrl}${sourcePath}`;
  rowEqual(failures, `${label}: wire`, wirePaths(observation), [path]);
  if (observation.outcome.kind !== 'resolved') {
    failures.push(`${label}: expected source response, received ${observation.outcome.kind}`);
    return;
  }
  const response = objectRecord(observation.outcome.value);
  const config = objectRecord(response?.config);
  rowEqual(failures, `${label}: status`, response?.status, expectedStatus);
  rowEqual(failures, `${label}: final URL`, response?.finalUrl, sourceUrl);
  rowEqual(failures, `${label}: Location`, headerValue(response?.headers, 'location'), location);
  rowEqual(failures, `${label}: config final URL`, config?.finalUrl, sourceUrl);
  rowEqual(failures, `${label}: redirect count`, config?.redirectCount, 0);
  rowEqual(
    failures,
    `${label}: redirect history length`,
    Array.isArray(config?.redirectHistory) ? config.redirectHistory.length : null,
    0,
  );
  rowCheck(
    failures,
    config?.maxRedirectsReached !== true,
    `${label}: maxRedirectsReached was true on manual source settlement`,
  );
}

function expectRedirectRollback(
  failures: string[],
  label: string,
  capture: RedirectCapture | null,
  sourceUrl: string,
): void {
  const request = objectRecord(capture?.request);
  const config = objectRecord(capture?.config);
  const response = objectRecord(capture?.response);
  rowCheck(failures, capture !== null, `${label}: redirect hook never captured source state`);
  rowEqual(failures, `${label}: request URL rollback`, request?.fullUrl, sourceUrl);
  rowEqual(failures, `${label}: request method rollback`, request?.method, 'POST');
  rowEqual(failures, `${label}: request body rollback`, request?.body, 'phase3-body');
  rowEqual(
    failures,
    `${label}: request header rollback`,
    headerValue(request?.headers, 'x-phase3-marker'),
    'rollback',
  );
  rowEqual(failures, `${label}: config final URL rollback`, config?.finalUrl, sourceUrl);
  rowEqual(failures, `${label}: config redirect count rollback`, config?.redirectCount, 0);
  rowEqual(
    failures,
    `${label}: config history rollback`,
    Array.isArray(config?.redirectHistory) ? config.redirectHistory.length : null,
    0,
  );
  rowEqual(failures, `${label}: config body rollback`, config?.originalBody, 'phase3-body');
  rowEqual(failures, `${label}: response status`, response?.status, 307);
  rowEqual(failures, `${label}: response final URL`, response?.finalUrl, sourceUrl);
  rowCheck(
    failures,
    response?.config === capture?.config,
    `${label}: captured response/config identity changed`,
  );
  rowCheck(
    failures,
    config?.originalRequest === capture?.request,
    `${label}: captured config/request identity changed`,
  );
}

function callbackRequest(
  client: Rezo,
  url: string,
  onRedirect: NonNullable<RezoRequestConfig['onRedirect']>,
  onCapture: (capture: RedirectCapture) => void,
  overrides: RezoRequestConfig = {},
): Promise<unknown> {
  return client.request(requestOptions({
    ...overrides,
    body: 'phase3-body',
    headers: {
      'content-type': 'text/plain',
      'x-phase3-marker': 'rollback',
    },
    hooks: {
      beforeRedirect: [(context, config, response) => {
        onCapture({ config, request: context.request, response });
      }],
    },
    method: 'POST',
    onRedirect,
    url,
  }));
}

Deno.test('Phase 1c-c Deno Fetch rejects malformed Location without an escaped event', async () => {
  const failures: string[] = [];
  const wire: string[] = [];
  const globalErrors: SerializedError[] = [];
  const globalUnhandledRejections: SerializedError[] = [];
  let callbackCount = 0;
  let settlement: 'pending' | 'rejected' | 'resolved' = 'pending';
  let responseStatus: number | null = null;
  let thrown: SerializedError | null = null;

  const onGlobalError = (event: ErrorEvent): void => {
    globalErrors.push(errorRecord(event.error ?? event));
    event.preventDefault();
  };
  const onGlobalUnhandled = (event: PromiseRejectionEvent): void => {
    globalUnhandledRejections.push(errorRecord(event.reason));
    event.preventDefault();
  };
  globalThis.addEventListener('error', onGlobalError);
  globalThis.addEventListener('unhandledrejection', onGlobalUnhandled);

  const server = Deno.serve({
    hostname: '127.0.0.1',
    onListen: () => undefined,
    port: 0,
  }, (request) => {
    const path = new URL(request.url).pathname;
    wire.push(path);
    if (path === '/phase1-malformed-fetch') {
      return new Response(null, {
        headers: { location: 'http://[' },
        status: 302,
      });
    }
    return new Response('unexpected fixture route', { status: 404 });
  });
  const port = (server.addr as Deno.NetAddr).port;
  const url = `http://127.0.0.1:${port}/phase1-malformed-fetch`;

  try {
    const request = new Rezo({}, fetchAdapter).get(url, {
      cache: false,
      onRedirect: () => {
        callbackCount++;
        return { redirect: true };
      },
      retry: false,
      timeout: 5_000,
    }).then((response) => {
      responseStatus = response.status;
      settlement = 'resolved';
    }, (error: unknown) => {
      thrown = errorRecord(error);
      settlement = 'rejected';
    });

    const settlementBound = await Promise.race([
      request.then(() => 'settled' as const),
      new Promise<'pending'>((resolveBound) => setTimeout(() => resolveBound('pending'), 500)),
    ]);
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 35));

    const actual = {
      callbackCount,
      error: thrown,
      globalErrors,
      globalUnhandledRejections,
      responseStatus,
      settlement,
      settlementBound,
      wire,
    };
    const expected = {
      callbackCount: 0,
      error: {
        code: 'ERR_INVALID_URL',
        errno: -1009,
        message: 'Invalid redirect destination URL',
        name: 'RezoError',
        requestFullUrl: url,
        responseFinalUrl: url,
        responseStatus: 302,
      },
      globalErrors: [],
      globalUnhandledRejections: [],
      responseStatus: null,
      settlement: 'rejected',
      settlementBound: 'settled',
      wire: ['/phase1-malformed-fetch'],
    };
    if (!jsonEqual(actual, expected)) {
      failures.push(`malformed Fetch observation mismatch\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(actual)}`);
    }
  } catch (error) {
    failures.push(`probe harness threw: ${errorRecord(error).message}`);
  } finally {
    globalThis.removeEventListener('error', onGlobalError);
    globalThis.removeEventListener('unhandledrejection', onGlobalUnhandled);
    try {
      await server.shutdown();
    } catch (error) {
      failures.push(`fixture cleanup failed: ${errorRecord(error).message}`);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures.map((message) => new Error(message)), failures.join('\n\n'));
  }
});

Deno.test('DENO-01 — Fetch P1 follows the default three-hop chain to 200 at hit four', async () => {
  const failures: string[] = [];
  const observation = await runProbe('DENO-01', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/chain/0`, requestOptions())
  ));

  expectResolvedChain(failures, 'DENO-01', observation);
  finishRow(failures);
});

Deno.test('DENO-02 — Fetch P2 reports typed positive-limit exhaustion at hit three', async () => {
  const failures: string[] = [];
  const observation = await runProbe('DENO-02', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/chain/0`, requestOptions({ maxRedirects: 2 }))
  ));
  const path = new URL(observation.baseUrl).pathname;

  expectStructuredError(failures, 'DENO-02', observation, {
    code: 'REZ_MAX_REDIRECTS_EXCEEDED',
    errno: -1035,
    historyLength: 2,
    location: `${path}/chain/3`,
    maxRedirectsReached: true,
    message: 'Max redirects (2) reached',
    redirectCount: 2,
    responseStatus: 302,
    sourceUrl: `${observation.baseUrl}/chain/2`,
    wirePaths: [
      `${path}/chain/0`,
      `${path}/chain/1`,
      `${path}/chain/2`,
    ],
  });
  finishRow(failures);
});

Deno.test('DENO-03 — request zero and same-level false plus zero both deny the first hop', async () => {
  let requestZeroCallbackCount = 0;
  let sameLevelCallbackCount = 0;
  const requestZero = await runProbe('DENO-03-A', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      maxRedirects: 0,
      onRedirect: () => {
        requestZeroCallbackCount++;
        return true;
      },
    }))
  ));
  const sameLevel = await runProbe('DENO-03-B', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      followRedirects: false,
      maxRedirects: 0,
      onRedirect: () => {
        sameLevelCallbackCount++;
        return true;
      },
    }))
  ));
  const failures: string[] = [];

  for (const [label, observation] of [
    ['DENO-03 request zero', requestZero],
    ['DENO-03 same-level false plus zero', sameLevel],
  ] as const) {
    const path = new URL(observation.baseUrl).pathname;
    expectStructuredError(failures, label, observation, {
      code: 'REZ_REDIRECT_DENIED',
      errno: -1032,
      historyLength: 0,
      location: `${path}/valid/forbidden`,
      maxRedirectsReached: true,
      message: 'Redirects are disabled (maxRedirects=0)',
      redirectCount: 0,
      responseStatus: 307,
      sourceUrl: `${observation.baseUrl}/valid/start`,
      wirePaths: [`${path}/valid/start`],
    });
  }
  rowEqual(failures, 'DENO-03 request-zero callback count', requestZeroCallbackCount, 0);
  rowEqual(failures, 'DENO-03 same-level callback count', sameLevelCallbackCount, 0);
  finishRow(failures);
});

Deno.test('DENO-04 — request true cannot relax an instance maxRedirects zero', async () => {
  let callbackCount = 0;
  const observation = await runProbe('DENO-04', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      followRedirects: true,
      onRedirect: () => {
        callbackCount++;
        return true;
      },
    }))
  ), { maxRedirects: 0 });
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;

  expectStructuredError(failures, 'DENO-04', observation, {
    code: 'REZ_REDIRECT_DENIED',
    errno: -1032,
    historyLength: 0,
    location: `${path}/valid/forbidden`,
    maxRedirectsReached: true,
    message: 'Redirects are disabled (maxRedirects=0)',
    redirectCount: 0,
    responseStatus: 307,
    sourceUrl: `${observation.baseUrl}/valid/start`,
    wirePaths: [`${path}/valid/start`],
  });
  rowEqual(failures, 'DENO-04 callback count', callbackCount, 0);
  finishRow(failures);
});

Deno.test('DENO-05 — request false settles normal and malformed source 302 responses untouched', async () => {
  let nullValidatorCallbackCount = 0;
  let nullValidatorHookCount = 0;
  let malformedCallbackCount = 0;
  let malformedHookCount = 0;
  const nullValidator = await runProbe('DENO-05-A', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      followRedirects: false,
      hooks: {
        beforeRedirect: [() => {
          nullValidatorHookCount++;
        }],
      },
      onRedirect: () => {
        nullValidatorCallbackCount++;
        return true;
      },
      validateStatus: null,
    }))
  ));
  const malformed = await runProbe('DENO-05-B', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/malformed/start`, requestOptions({
      followRedirects: false,
      hooks: {
        beforeRedirect: [() => {
          malformedHookCount++;
        }],
      },
      onRedirect: () => {
        malformedCallbackCount++;
        return true;
      },
    }))
  ));
  const failures: string[] = [];
  const normalPath = new URL(nullValidator.baseUrl).pathname;

  expectResolvedSource(
    failures,
    'DENO-05 null validator',
    nullValidator,
    '/valid/start',
    `${normalPath}/valid/forbidden`,
    307,
  );
  expectResolvedSource(
    failures,
    'DENO-05 malformed Location',
    malformed,
    '/malformed/start',
    'http://[',
  );
  rowEqual(failures, 'DENO-05 null-validator callback count', nullValidatorCallbackCount, 0);
  rowEqual(failures, 'DENO-05 null-validator hook count', nullValidatorHookCount, 0);
  rowEqual(failures, 'DENO-05 malformed callback count', malformedCallbackCount, 0);
  rowEqual(failures, 'DENO-05 malformed hook count', malformedHookCount, 0);
  finishRow(failures);
});

Deno.test('DENO-06 — request positive max cannot relax instance followRedirects false', async () => {
  let callbackCount = 0;
  let hookCount = 0;
  const observation = await runProbe('DENO-06', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      hooks: {
        beforeRedirect: [() => {
          hookCount++;
        }],
      },
      maxRedirects: 5,
      onRedirect: () => {
        callbackCount++;
        return true;
      },
    }))
  ), { followRedirects: false });
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;

  expectResolvedSource(
    failures,
    'DENO-06',
    observation,
    '/valid/start',
    `${path}/valid/forbidden`,
    307,
  );
  rowEqual(failures, 'DENO-06 callback count', callbackCount, 0);
  rowEqual(failures, 'DENO-06 hook count', hookCount, 0);
  finishRow(failures);
});

Deno.test('DENO-07 — callback false returns typed denial with full transaction rollback', async () => {
  let callbackCount = 0;
  let capture: RedirectCapture | null = null;
  const observation = await runProbe('DENO-07', ({ baseUrl, client }) => callbackRequest(
    client,
    `${baseUrl}/valid/start`,
    () => {
      callbackCount++;
      return false;
    },
    (value) => {
      capture = value;
    },
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/valid/start`;

  expectStructuredError(failures, 'DENO-07', observation, {
    code: 'REZ_REDIRECT_DENIED',
    errno: -1032,
    historyLength: 0,
    location: `${path}/valid/forbidden`,
    maxRedirectsReached: false,
    message: 'Redirect denied by user',
    redirectCount: 0,
    responseStatus: 307,
    sourceUrl,
    wirePaths: [`${path}/valid/start`],
  });
  expectRedirectRollback(failures, 'DENO-07', capture, sourceUrl);
  rowEqual(failures, 'DENO-07 callback count', callbackCount, 1);
  rowEqual(failures, 'DENO-07 detailed wire', observation.wire, [{
    body: 'phase3-body',
    marker: 'rollback',
    method: 'POST',
    path: `${path}/valid/start`,
  }]);
  finishRow(failures);
});

Deno.test('DENO-08 — callback object refusal returns typed denial with full rollback', async () => {
  let callbackCount = 0;
  let capture: RedirectCapture | null = null;
  const observation = await runProbe('DENO-08', ({ baseUrl, client }) => callbackRequest(
    client,
    `${baseUrl}/valid/start`,
    () => {
      callbackCount++;
      return { redirect: false };
    },
    (value) => {
      capture = value;
    },
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/valid/start`;

  expectStructuredError(failures, 'DENO-08', observation, {
    code: 'REZ_REDIRECT_DENIED',
    errno: -1032,
    historyLength: 0,
    location: `${path}/valid/forbidden`,
    maxRedirectsReached: false,
    message: 'Redirect denied by user',
    redirectCount: 0,
    responseStatus: 307,
    sourceUrl,
    wirePaths: [`${path}/valid/start`],
  });
  expectRedirectRollback(failures, 'DENO-08', capture, sourceUrl);
  rowEqual(failures, 'DENO-08 callback count', callbackCount, 1);
  rowEqual(failures, 'DENO-08 detailed wire', observation.wire, [{
    body: 'phase3-body',
    marker: 'rollback',
    method: 'POST',
    path: `${path}/valid/start`,
  }]);
  finishRow(failures);
});

Deno.test('DENO-09 — rejecting request and instance validators remain authoritative under false', async () => {
  let requestCallbackCount = 0;
  let requestHookCount = 0;
  let instanceCallbackCount = 0;
  let instanceHookCount = 0;
  const rejectNon2xx = (status: number): boolean => status >= 200 && status < 300;
  const requestValidator = await runProbe('DENO-09-A', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      followRedirects: false,
      hooks: {
        beforeRedirect: [() => {
          requestHookCount++;
        }],
      },
      onRedirect: () => {
        requestCallbackCount++;
        return true;
      },
      validateStatus: rejectNon2xx,
    }))
  ));
  const instanceValidator = await runProbe('DENO-09-B', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/valid/start`, requestOptions({
      hooks: {
        beforeRedirect: [() => {
          instanceHookCount++;
        }],
      },
      onRedirect: () => {
        instanceCallbackCount++;
        return true;
      },
    }))
  ), {
    followRedirects: false,
    validateStatus: rejectNon2xx,
  });
  const failures: string[] = [];

  for (const [label, observation] of [
    ['DENO-09 request validator', requestValidator],
    ['DENO-09 instance validator', instanceValidator],
  ] as const) {
    const path = new URL(observation.baseUrl).pathname;
    expectStructuredError(failures, label, observation, {
      code: 'REZ_HTTP_ERROR',
      errno: -1031,
      historyLength: 0,
      location: `${path}/valid/forbidden`,
      maxRedirectsReached: false,
      message: 'Request failed with status code 307',
      redirectCount: 0,
      responseStatus: 307,
      sourceUrl: `${observation.baseUrl}/valid/start`,
      wirePaths: [`${path}/valid/start`],
    });
  }
  rowEqual(failures, 'DENO-09 request callback count', requestCallbackCount, 0);
  rowEqual(failures, 'DENO-09 request hook count', requestHookCount, 0);
  rowEqual(failures, 'DENO-09 instance callback count', instanceCallbackCount, 0);
  rowEqual(failures, 'DENO-09 instance hook count', instanceHookCount, 0);
  finishRow(failures);
});

Deno.test('DENO-10 — request true overrides the corresponding instance false default', async () => {
  const failures: string[] = [];
  const observation = await runProbe('DENO-10', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/chain/0`, requestOptions({ followRedirects: true }))
  ), { followRedirects: false });

  expectResolvedChain(failures, 'DENO-10', observation);
  finishRow(failures);
});

Deno.test('DENO-11 — positive request max overrides the corresponding instance zero default', async () => {
  const failures: string[] = [];
  const observation = await runProbe('DENO-11', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/chain/0`, requestOptions({ maxRedirects: 4 }))
  ), { maxRedirects: 0 });

  expectResolvedChain(failures, 'DENO-11', observation);
  finishRow(failures);
});

Deno.test('DENO-12 — finalized callback destination cycle is typed before either raw alias dispatches', async () => {
  const captures: RedirectCapture[] = [];
  let callbackCount = 0;
  let middleUrl = '';
  const observation = await runProbe('DENO-12', ({ baseUrl, client }) => {
    middleUrl = `${baseUrl}/cycle/middle`;
    return callbackRequest(
      client,
      `${baseUrl}/cycle/start`,
      () => {
        callbackCount++;
        return { redirect: true, url: middleUrl };
      },
      (capture) => {
        captures.push(capture);
      },
      { enableRedirectCycleDetection: true },
    );
  });
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;

  expectStructuredError(failures, 'DENO-12', observation, {
    code: 'REZ_REDIRECT_CYCLE_DETECTED',
    errno: -1036,
    historyLength: 1,
    location: `${path}/cycle/raw-second-alias`,
    maxRedirectsReached: false,
    message: `Redirect cycle detected: ${middleUrl}`,
    redirectCount: 1,
    responseStatus: 307,
    sourceUrl: middleUrl,
    wirePaths: [`${path}/cycle/start`, `${path}/cycle/middle`],
  });
  rowEqual(failures, 'DENO-12 callback count', callbackCount, 2);
  rowEqual(failures, 'DENO-12 hook capture count', captures.length, 2);
  const finalCapture = captures.at(-1) ?? null;
  const request = objectRecord(finalCapture?.request);
  const config = objectRecord(finalCapture?.config);
  const response = objectRecord(finalCapture?.response);
  rowEqual(failures, 'DENO-12 current request URL', request?.fullUrl, middleUrl);
  rowEqual(failures, 'DENO-12 current request method', request?.method, 'POST');
  rowEqual(failures, 'DENO-12 current request body', request?.body, 'phase3-body');
  rowEqual(
    failures,
    'DENO-12 current request marker',
    headerValue(request?.headers, 'x-phase3-marker'),
    'rollback',
  );
  rowEqual(failures, 'DENO-12 current config URL', config?.finalUrl, middleUrl);
  rowEqual(failures, 'DENO-12 current redirect count', config?.redirectCount, 1);
  rowEqual(
    failures,
    'DENO-12 current history length',
    Array.isArray(config?.redirectHistory) ? config.redirectHistory.length : null,
    1,
  );
  rowEqual(failures, 'DENO-12 source response status', response?.status, 307);
  rowEqual(failures, 'DENO-12 source response URL', response?.finalUrl, middleUrl);
  rowCheck(
    failures,
    response?.config === finalCapture?.config,
    'DENO-12 source response/config identity changed',
  );
  rowEqual(failures, 'DENO-12 detailed wire', observation.wire, [
    {
      body: 'phase3-body',
      marker: 'rollback',
      method: 'POST',
      path: `${path}/cycle/start`,
    },
    {
      body: 'phase3-body',
      marker: 'rollback',
      method: 'POST',
      path: `${path}/cycle/middle`,
    },
  ]);
  finishRow(failures);
});

Deno.test('DENO-13 — missing Location carries the typed source-response error', async () => {
  let callbackCount = 0;
  const observation = await runProbe('DENO-13', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/missing/start`, requestOptions({
      onRedirect: () => {
        callbackCount++;
        return true;
      },
    }))
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;

  expectStructuredError(failures, 'DENO-13', observation, {
    code: 'REZ_MISSING_REDIRECT_LOCATION',
    errno: -1028,
    historyLength: 0,
    location: null,
    maxRedirectsReached: false,
    message: 'Redirect location not found',
    redirectCount: 0,
    responseStatus: 302,
    sourceUrl: `${observation.baseUrl}/missing/start`,
    wirePaths: [`${path}/missing/start`],
  });
  rowEqual(failures, 'DENO-13 callback count', callbackCount, 0);
  finishRow(failures);
});

Deno.test('DENO-14 — ordinary callback Error preserves exact identity and rollback', async () => {
  const sentinel = new Error('DENO-14 ordinary callback sentinel');
  let callbackCount = 0;
  let capture: RedirectCapture | null = null;
  const observation = await runProbe('DENO-14', ({ baseUrl, client }) => callbackRequest(
    client,
    `${baseUrl}/valid/start`,
    () => {
      callbackCount++;
      throw sentinel;
    },
    (value) => {
      capture = value;
    },
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/valid/start`;

  expectCleanProbe(failures, 'DENO-14', observation);
  rowCheck(
    failures,
    observation.outcome.kind === 'rejected' && observation.outcome.value === sentinel,
    'DENO-14 did not reject with the exact ordinary Error object',
  );
  rowEqual(failures, 'DENO-14 callback count', callbackCount, 1);
  rowEqual(failures, 'DENO-14 wire', observation.wire, [{
    body: 'phase3-body',
    marker: 'rollback',
    method: 'POST',
    path: `${path}/valid/start`,
  }]);
  expectRedirectRollback(failures, 'DENO-14', capture, sourceUrl);
  finishRow(failures);
});

Deno.test('DENO-15 — primitive callback throw preserves exact value and rollback', async () => {
  const sentinel = 73;
  let callbackCount = 0;
  let capture: RedirectCapture | null = null;
  const observation = await runProbe('DENO-15', ({ baseUrl, client }) => callbackRequest(
    client,
    `${baseUrl}/valid/start`,
    () => {
      callbackCount++;
      throw sentinel;
    },
    (value) => {
      capture = value;
    },
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/valid/start`;

  expectCleanProbe(failures, 'DENO-15', observation);
  rowCheck(
    failures,
    observation.outcome.kind === 'rejected' && observation.outcome.value === sentinel,
    'DENO-15 did not reject with the exact primitive value',
  );
  rowEqual(failures, 'DENO-15 callback count', callbackCount, 1);
  rowEqual(failures, 'DENO-15 wire', observation.wire, [{
    body: 'phase3-body',
    marker: 'rollback',
    method: 'POST',
    path: `${path}/valid/start`,
  }]);
  expectRedirectRollback(failures, 'DENO-15', capture, sourceUrl);
  finishRow(failures);
});

Deno.test('DENO-16 — callback-thrown RezoError preserves exact identity and rollback', async () => {
  let sentinel: RezoError | null = null;
  let callbackCount = 0;
  let capture: RedirectCapture | null = null;
  const observation = await runProbe('DENO-16', async ({ baseUrl, client }) => {
    try {
      await client.get(`${baseUrl}/status/404`, requestOptions());
    } catch (error) {
      if (!(error instanceof RezoError)) throw error;
      sentinel = error;
    }
    if (sentinel === null) throw new Error('DENO-16 failed to obtain a RezoError sentinel');
    return callbackRequest(
      client,
      `${baseUrl}/valid/start`,
      () => {
        callbackCount++;
        throw sentinel;
      },
      (value) => {
        capture = value;
      },
    );
  });
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/valid/start`;

  expectCleanProbe(failures, 'DENO-16', observation);
  rowCheck(failures, sentinel instanceof RezoError, 'DENO-16 sentinel was not created');
  rowCheck(
    failures,
    observation.outcome.kind === 'rejected' && observation.outcome.value === sentinel,
    'DENO-16 did not reject with the exact RezoError object',
  );
  rowEqual(failures, 'DENO-16 callback count', callbackCount, 1);
  rowEqual(failures, 'DENO-16 wire', observation.wire, [
    {
      body: '',
      marker: null,
      method: 'GET',
      path: `${path}/status/404`,
    },
    {
      body: 'phase3-body',
      marker: 'rollback',
      method: 'POST',
      path: `${path}/valid/start`,
    },
  ]);
  expectRedirectRollback(failures, 'DENO-16', capture, sourceUrl);
  finishRow(failures);
});

Deno.test('DENO-17 — ordinary 404 and retry-disabled 500 retain typed HTTP errors', async () => {
  const notFound = await runProbe('DENO-17-A', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/status/404`, requestOptions())
  ));
  const serverError = await runProbe('DENO-17-B', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/status/500`, requestOptions({ retry: false }))
  ));
  const failures: string[] = [];

  for (const [label, observation, status] of [
    ['DENO-17 404', notFound, 404],
    ['DENO-17 retry-disabled 500', serverError, 500],
  ] as const) {
    const path = new URL(observation.baseUrl).pathname;
    expectStructuredError(failures, label, observation, {
      code: 'REZ_HTTP_ERROR',
      errno: -1031,
      historyLength: 0,
      location: null,
      maxRedirectsReached: false,
      message: `Request failed with status code ${status}`,
      redirectCount: 0,
      responseStatus: status,
      sourceUrl: `${observation.baseUrl}/status/${status}`,
      wirePaths: [`${path}/status/${status}`],
    });
  }
  finishRow(failures);
});

Deno.test('DENO-18 — rejected 304 with Location remains an ordinary non-redirect error', async () => {
  let callbackCount = 0;
  const observation = await runProbe('DENO-18', ({ baseUrl, client }) => (
    client.get(`${baseUrl}/status/304`, requestOptions({
      onRedirect: () => {
        callbackCount++;
        return true;
      },
      validateStatus: (status) => status >= 200 && status < 300,
    }))
  ));
  const failures: string[] = [];
  const path = new URL(observation.baseUrl).pathname;
  const sourceUrl = `${observation.baseUrl}/status/304`;
  expectCleanProbe(failures, 'DENO-18', observation);
  rowEqual(failures, 'DENO-18 wire', wirePaths(observation), [`${path}/status/304`]);
  if (observation.outcome.kind !== 'rejected') {
    failures.push(`DENO-18 expected rejection, received ${observation.outcome.kind}`);
  } else {
    const error = objectRecord(observation.outcome.value);
    const config = objectRecord(error?.config);
    const request = objectRecord(error?.request);
    const response = objectRecord(error?.response);
    const redirectControlCodes = [
      'REZ_MISSING_REDIRECT_LOCATION',
      'REZ_REDIRECT_DENIED',
      'REZ_MAX_REDIRECTS_EXCEEDED',
      'REZ_REDIRECT_CYCLE_DETECTED',
    ];
    rowCheck(
      failures,
      typeof error?.code === 'string' && !redirectControlCodes.includes(error.code),
      `DENO-18 received redirect-control code ${String(error?.code)}`,
    );
    rowEqual(failures, 'DENO-18 message', error?.message, 'Request failed with status code 304');
    rowEqual(failures, 'DENO-18 response status', response?.status, 304);
    rowEqual(failures, 'DENO-18 response URL', response?.finalUrl, sourceUrl);
    rowEqual(
      failures,
      'DENO-18 response Location',
      headerValue(response?.headers, 'location'),
      `${path}/valid/forbidden`,
    );
    rowEqual(failures, 'DENO-18 request URL', request?.fullUrl, sourceUrl);
    rowEqual(failures, 'DENO-18 config URL', config?.finalUrl, sourceUrl);
    rowEqual(failures, 'DENO-18 redirect count', config?.redirectCount, 0);
    rowEqual(
      failures,
      'DENO-18 history length',
      Array.isArray(config?.redirectHistory) ? config.redirectHistory.length : null,
      0,
    );
    rowCheck(
      failures,
      config?.maxRedirectsReached !== true,
      'DENO-18 maxRedirectsReached was true for non-redirect 304',
    );
    rowCheck(
      failures,
      response?.config === error?.config,
      'DENO-18 response/config identity changed',
    );
    rowCheck(
      failures,
      config?.originalRequest === error?.request,
      'DENO-18 config/request identity changed',
    );
  }
  rowEqual(failures, 'DENO-18 callback count', callbackCount, 0);
  finishRow(failures);
});
