import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { Rezo } from '../src/core/rezo.js';
import { RezoError } from '../src/errors/rezo-error.js';
import { DownloadResponse } from '../src/responses/universal/download.js';
import { UploadResponse } from '../src/responses/universal/upload.js';

type HiddenLane = 'stock-fetch' | 'upload-provider' | 'download-provider';
type TriggerCarrier = 'request' | 'default';
type RedirectCapability = 'beforeRedirect' | 'onRedirect' | 'hooks.beforeRedirect';
type EmptyHookControl = 'none' | 'request-empty-hook' | 'default-empty-hook';

const SECRET = 'BEARER-RN-CAPABILITY-SENTINEL';
const SECRET_URL_VALUE = 'RN-CAPABILITY-URL-SENTINEL';
const DETAILS = 'The selected adapter or runtime cannot provide a capability requested by this operation.';
const SUGGESTION = 'Choose an adapter or runtime that supports the requested capability, or remove the unsupported requirement.';
const ALL_CAPABILITIES: readonly RedirectCapability[] = [
  'beforeRedirect',
  'onRedirect',
  'hooks.beforeRedirect',
];

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
);
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'fetch',
);

function replaceGlobal(name: 'navigator' | 'fetch', value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function restoreGlobal(
  name: 'navigator' | 'fetch',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, name);
}

const laneNames: Record<HiddenLane, string> = {
  'stock-fetch': 'React Native stock Fetch',
  'upload-provider': 'React Native file upload provider',
  'download-provider': 'React Native file download provider',
};

interface TriggerSpies {
  beforeRedirect: ReturnType<typeof vi.fn>;
  onRedirect: ReturnType<typeof vi.fn>;
  hook: ReturnType<typeof vi.fn>;
}

interface LaneHarness {
  request: Record<string, any>;
  defaults: Record<string, any>;
  fetchMock: ReturnType<typeof vi.fn>;
  uploadFile: ReturnType<typeof vi.fn>;
  downloadFile: ReturnType<typeof vi.fn>;
  networkInfoFetch: ReturnType<typeof vi.fn>;
  isTaskRegistered: ReturnType<typeof vi.fn>;
  registerTask: ReturnType<typeof vi.fn>;
  unregisterTask: ReturnType<typeof vi.fn>;
  completion?: Promise<unknown>;
}

function createMockResponse({
  body = '{"ok":true}',
  headers = { 'content-type': 'application/json' },
  status = 200,
  statusText = 'OK',
  url = 'https://hidden-rn.example/final',
}: {
  body?: string;
  headers?: Record<string, string>;
  status?: number;
  statusText?: string;
  url?: string;
} = {}): Response {
  return {
    status,
    statusText,
    headers: new Headers(headers),
    url,
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    },
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
    async blob() {
      return new Blob([body]);
    },
  } as Response;
}

function createTriggerSpies(): TriggerSpies {
  return {
    beforeRedirect: vi.fn(() => true),
    onRedirect: vi.fn(() => true),
    hook: vi.fn(),
  };
}

function applyTriggers(
  target: Record<string, any>,
  capabilities: readonly RedirectCapability[],
  spies: TriggerSpies,
): void {
  if (capabilities.includes('beforeRedirect')) {
    target.beforeRedirect = spies.beforeRedirect;
  }
  if (capabilities.includes('onRedirect')) {
    target.onRedirect = spies.onRedirect;
  }
  if (capabilities.includes('hooks.beforeRedirect')) {
    target.hooks = { beforeRedirect: [spies.hook] };
  }
}

function expectedMessage(
  lane: HiddenLane,
  capabilities: readonly RedirectCapability[],
): string {
  const noun = capabilities.length === 1 ? 'capability' : 'capabilities';
  const names = capabilities.map((capability) => `"${capability}"`).join(', ');
  return `${laneNames[lane]} cannot enforce redirect ${noun} ${names} before dispatch.`;
}

function summarizeError(error: unknown) {
  if (!(error instanceof RezoError)) {
    return {
      kind: error === undefined ? 'none' : 'non-rezo',
      value: error instanceof Error ? error.message : String(error),
    };
  }

  const serialized = JSON.stringify(error);
  return {
    kind: 'rezo',
    name: error.name,
    message: error.message,
    code: error.code,
    errno: error.errno,
    details: Reflect.get(error, 'details'),
    suggestion: error.suggestion,
    isRetryable: error.isRetryable,
    isTimeout: error.isTimeout,
    isAborted: error.isAborted,
    isNetworkError: error.isNetworkError,
    isHttpError: error.isHttpError,
    isProxyError: error.isProxyError,
    isSocksError: error.isSocksError,
    isTlsError: error.isTlsError,
    json: error.toJSON(),
    messageContainsSecret: error.message.includes(SECRET) || error.message.includes(SECRET_URL_VALUE),
    stackContainsSecret: Boolean(error.stack?.includes(SECRET) || error.stack?.includes(SECRET_URL_VALUE)),
    serializedContainsSecret: serialized.includes(SECRET) || serialized.includes(SECRET_URL_VALUE),
  };
}

function expectedError(message: string) {
  return {
    kind: 'rezo',
    name: 'RezoError',
    message,
    code: 'REZ_UNSUPPORTED_CAPABILITY',
    errno: -1075,
    details: DETAILS,
    suggestion: SUGGESTION,
    isRetryable: false,
    isTimeout: false,
    isAborted: false,
    isNetworkError: false,
    isHttpError: false,
    isProxyError: false,
    isSocksError: false,
    isTlsError: false,
    json: {
      name: 'RezoError',
      message,
      code: 'REZ_UNSUPPORTED_CAPABILITY',
    },
    messageContainsSecret: false,
    stackContainsSecret: false,
    serializedContainsSecret: false,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}

function createLaneHarness(lane: HiddenLane, includePreflight: boolean): LaneHarness {
  replaceGlobal('navigator', { product: 'ReactNative' });

  const fetchMock = vi.fn().mockResolvedValue(createMockResponse());
  replaceGlobal('fetch', fetchMock);

  const networkInfoFetch = vi.fn().mockResolvedValue({
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
  });
  const isTaskRegistered = vi.fn().mockResolvedValue(false);
  const registerTask = vi.fn().mockResolvedValue(undefined);
  const unregisterTask = vi.fn().mockResolvedValue(undefined);

  const uploadFile = vi.fn(async () => ({
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/json' },
    finalUrl: 'https://hidden-rn.example/upload',
    body: '{"ok":true}',
    uploadSize: 4,
    fileName: 'payload.bin',
  }));
  const downloadFile = vi.fn(async (providerRequest: Record<string, any>) => {
    await providerRequest.onHeaders?.({
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': '4',
      },
      finalUrl: 'https://hidden-rn.example/download',
    });
    return {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': '4',
      },
      finalUrl: 'https://hidden-rn.example/download',
      filePath: '/tmp/rezo-rn-capability.bin',
      fileSize: 4,
    };
  });

  const request: Record<string, any> = {
    url: `https://hidden-rn.example/request?token=${SECRET_URL_VALUE}`,
    method: lane === 'upload-provider' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${SECRET}` },
  };
  const defaults: Record<string, any> = {
    reactNative: {
      fileSystemAdapter: {
        name: 'capability-test-fs',
        capabilities: {
          fileDownload: true,
          downloadProgress: true,
          uploadFromFile: true,
          uploadProgress: true,
        },
        uploadFile,
        downloadFile,
      },
      ...(includePreflight
        ? {
            networkInfoProvider: { fetch: networkInfoFetch },
            backgroundTaskProvider: {
              isTaskRegistered,
              registerTask,
              unregisterTask,
            },
          }
        : {}),
    },
  };

  if (includePreflight) {
    request.reactNative = {
      backgroundTask: { name: 'rezo.capability-test' },
    };
  }

  let completion: Promise<unknown> | undefined;
  if (lane === 'upload-provider') {
    const response = new UploadResponse(request.url, 'payload.bin');
    completion = new Promise((resolve, reject) => {
      response.once('complete', resolve);
      response.once('error', reject);
    });
    request.responseType = 'upload';
    request._isUpload = true;
    request._uploadResponse = response;
    request.body = {
      uri: 'file:///tmp/payload.bin',
      name: 'payload.bin',
      type: 'application/octet-stream',
      size: 4,
    };
  } else if (lane === 'download-provider') {
    const response = new DownloadResponse('/tmp/rezo-rn-capability.bin', request.url);
    completion = new Promise((resolve, reject) => {
      response.once('complete', resolve);
      response.once('error', reject);
    });
    request.responseType = 'download';
    request._isDownload = true;
    request._downloadResponse = response;
    request.saveTo = '/tmp/rezo-rn-capability.bin';
  }

  return {
    request,
    defaults,
    fetchMock,
    uploadFile,
    downloadFile,
    networkInfoFetch,
    isTaskRegistered,
    registerTask,
    unregisterTask,
    completion,
  };
}

const triggerCases = [
  ['beforeRedirect', ['beforeRedirect']],
  ['onRedirect', ['onRedirect']],
  ['hooks.beforeRedirect', ['hooks.beforeRedirect']],
  ['combined', ALL_CAPABILITIES],
] as const satisfies readonly (readonly [string, readonly RedirectCapability[]])[];

const hiddenLanes: readonly HiddenLane[] = [
  'stock-fetch',
  'upload-provider',
  'download-provider',
];

afterEach(() => {
  vi.restoreAllMocks();
  restoreGlobal('navigator', originalNavigatorDescriptor);
  restoreGlobal('fetch', originalFetchDescriptor);
});

describe('A+ Phase 1c-c R11 — React Native hidden redirect lanes refuse before dispatch', () => {
  for (const lane of hiddenLanes) {
    describe(laneNames[lane], () => {
      for (const carrier of ['request', 'default'] as const satisfies readonly TriggerCarrier[]) {
        for (const [caseName, capabilities] of triggerCases) {
          it(`${carrier} ${caseName} trigger returns the exact capability error with zero work`, async () => {
            const harness = createLaneHarness(lane, true);
            const spies = createTriggerSpies();
            applyTriggers(
              carrier === 'request' ? harness.request : harness.defaults,
              capabilities,
              spies,
            );

            const error = await captureError(executeRequest(
              harness.request as never,
              harness.defaults as never,
              new RezoCookieJar(),
            ));
            await flushAsyncWork();

            expect({
              error: summarizeError(error),
              fetchCalls: harness.fetchMock.mock.calls.length,
              uploadProviderCalls: harness.uploadFile.mock.calls.length,
              downloadProviderCalls: harness.downloadFile.mock.calls.length,
              networkInfoCalls: harness.networkInfoFetch.mock.calls.length,
              backgroundIsRegisteredCalls: harness.isTaskRegistered.mock.calls.length,
              backgroundRegisterCalls: harness.registerTask.mock.calls.length,
              backgroundUnregisterCalls: harness.unregisterTask.mock.calls.length,
              beforeRedirectCalls: spies.beforeRedirect.mock.calls.length,
              onRedirectCalls: spies.onRedirect.mock.calls.length,
              hookCalls: spies.hook.mock.calls.length,
            }).toEqual({
              error: expectedError(expectedMessage(lane, capabilities)),
              fetchCalls: 0,
              uploadProviderCalls: 0,
              downloadProviderCalls: 0,
              networkInfoCalls: 0,
              backgroundIsRegisteredCalls: 0,
              backgroundRegisterCalls: 0,
              backgroundUnregisterCalls: 0,
              beforeRedirectCalls: 0,
              onRedirectCalls: 0,
              hookCalls: 0,
            });
          });
        }
      }
    });
  }
});

describe('A+ Phase 1c-c R11 — supported/no-guarantee controls remain reachable', () => {
  const controls: readonly EmptyHookControl[] = [
    'none',
    'request-empty-hook',
    'default-empty-hook',
  ];

  for (const lane of hiddenLanes) {
    for (const control of controls) {
      it(`${lane}: ${control} does not trigger capability refusal`, async () => {
        const harness = createLaneHarness(lane, false);
        if (control === 'request-empty-hook') {
          harness.request.hooks = { beforeRedirect: [] };
        } else if (control === 'default-empty-hook') {
          harness.defaults.hooks = { beforeRedirect: [] };
        }

        const result = await executeRequest(
          harness.request as never,
          harness.defaults as never,
          new RezoCookieJar(),
        ) as any;
        if (harness.completion) {
          await harness.completion;
        }

        expect({
          status: lane === 'stock-fetch' ? result.status : undefined,
          fetchCalls: harness.fetchMock.mock.calls.length,
          uploadProviderCalls: harness.uploadFile.mock.calls.length,
          downloadProviderCalls: harness.downloadFile.mock.calls.length,
        }).toEqual({
          status: lane === 'stock-fetch' ? 200 : undefined,
          fetchCalls: lane === 'stock-fetch' ? 1 : 0,
          uploadProviderCalls: lane === 'upload-provider' ? 1 : 0,
          downloadProviderCalls: lane === 'download-provider' ? 1 : 0,
        });
      });
    }
  }

  it('keeps the Node/Bun injected manual redirect path available to callbacks and hooks', async () => {
    replaceGlobal('navigator', { product: 'Node.js' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse({
        body: '',
        headers: { location: '/destination' },
        status: 302,
        statusText: 'Found',
        url: 'https://injected-rn.example/source',
      }))
      .mockResolvedValueOnce(createMockResponse({
        url: 'https://injected-rn.example/destination',
      }));
    replaceGlobal('fetch', fetchMock);

    const callback = vi.fn(() => ({
      redirect: true,
      setHeaders: { 'X-Injected-Manual': 'reached' },
    }));
    const hook = vi.fn();
    const response = await executeRequest({
      url: 'https://injected-rn.example/source',
      method: 'GET',
      onRedirect: callback,
      hooks: { beforeRedirect: [hook] },
    } as never, {}, new RezoCookieJar()) as any;
    const destinationHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;

    expect({
      status: response.status,
      fetchCalls: fetchMock.mock.calls.length,
      callbackCalls: callback.mock.calls.length,
      hookCalls: hook.mock.calls.length,
      destinationHeader: destinationHeaders.get('x-injected-manual'),
      redirectCount: response.config.redirectCount,
    }).toEqual({
      status: 200,
      fetchCalls: 2,
      callbackCalls: 1,
      hookCalls: 1,
      destinationHeader: 'reached',
      redirectCount: 1,
    });
  });

  it('refuses a hidden stock-Fetch guarantee registered through the public instance hook collection', async () => {
    const harness = createLaneHarness('stock-fetch', true);
    const client = new Rezo(harness.defaults as never, executeRequest as never);
    const hook = vi.fn();
    client.hooks.beforeRedirect.push(hook);

    const error = await captureError(client.get(harness.request.url, {
      headers: harness.request.headers,
      reactNative: harness.request.reactNative,
    } as never));
    await flushAsyncWork();

    expect({
      error: summarizeError(error),
      fetchCalls: harness.fetchMock.mock.calls.length,
      networkInfoCalls: harness.networkInfoFetch.mock.calls.length,
      backgroundIsRegisteredCalls: harness.isTaskRegistered.mock.calls.length,
      backgroundRegisterCalls: harness.registerTask.mock.calls.length,
      backgroundUnregisterCalls: harness.unregisterTask.mock.calls.length,
      hookCalls: hook.mock.calls.length,
    }).toEqual({
      error: expectedError(expectedMessage('stock-fetch', ['hooks.beforeRedirect'])),
      fetchCalls: 0,
      networkInfoCalls: 0,
      backgroundIsRegisteredCalls: 0,
      backgroundRegisterCalls: 0,
      backgroundUnregisterCalls: 0,
      hookCalls: 0,
    });
  });
});
