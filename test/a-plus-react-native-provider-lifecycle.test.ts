import { describe, expect, it } from 'vitest';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import type {
  RezoReactNativeStreamRequest,
  RezoReactNativeStreamResult,
  RezoReactNativeStreamTransport,
} from '../src/types/react-native.js';

const REQUEST_TIMEOUT_MS = 40;
const DEADLINE_OBSERVATION_MS = 140;
const RELEASE_OBSERVATION_MS = 60;
const HARNESS_TIMEOUT_MS = 750;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface StreamFacade {
  on(event: string, listener: (...args: unknown[]) => void): StreamFacade;
  isFinished(): boolean;
}

interface TerminalSnapshot {
  events: string[];
  errorCodes: Array<string | null>;
  successStatuses: Array<number | null>;
  isFinished: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withHarnessDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`RN provider lifecycle harness fault: ${label}`));
        }, HARNESS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function readErrorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null;
  return typeof value.code === 'string' ? value.code : null;
}

function readStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('status' in value)) return null;
  return typeof value.status === 'number' ? value.status : null;
}

function observeTerminalLifecycle(facade: StreamFacade): () => TerminalSnapshot {
  const events: string[] = [];
  const errorCodes: Array<string | null> = [];
  const successStatuses: Array<number | null> = [];

  facade.on('error', (error) => {
    events.push('error');
    errorCodes.push(readErrorCode(error));
  });
  for (const event of ['finish', 'done', 'complete'] as const) {
    facade.on(event, (value) => {
      events.push(event);
      successStatuses.push(readStatus(value));
    });
  }
  facade.on('end', () => {
    events.push('end');
  });

  return () => ({
    events: [...events],
    errorCodes: [...errorCodes],
    successStatuses: [...successStatuses],
    isFinished: facade.isFinished(),
  });
}

function successfulProviderResult(url: string): RezoReactNativeStreamResult {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    finalUrl: url,
    contentType: 'text/plain',
    contentLength: 0,
  };
}

async function executeStreamRequest(
  url: string,
  streamTransport: RezoReactNativeStreamTransport,
): Promise<StreamFacade> {
  const result = await withHarnessDeadline(
    executeRequest({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: REQUEST_TIMEOUT_MS,
      retry: false,
      cache: false,
    }, {
      reactNative: { streamTransport },
    }, new RezoCookieJar()),
    'adapter did not return the stream facade',
  );
  return result as unknown as StreamFacade;
}

describe('A+ React Native native-provider deadline lifecycle', () => {
  it('control: a cooperative provider exposes the adapter timeout as one typed error', async () => {
    const providerEntered = createDeferred<void>();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    let providerCalls = 0;
    let abortEvents = 0;
    let signalWasProvided = false;

    const streamTransport: RezoReactNativeStreamTransport = {
      name: 'cooperative-deadline-control',
      stream(request: RezoReactNativeStreamRequest) {
        providerCalls += 1;
        signalWasProvided = request.signal instanceof AbortSignal;
        providerEntered.resolve(undefined);

        return new Promise<RezoReactNativeStreamResult>((_resolve, reject) => {
          const rejectAsAborted = () => {
            abortEvents += 1;
            const error = new Error('provider observed abort');
            error.name = 'AbortError';
            reject(error);
          };
          if (request.signal?.aborted) {
            rejectAsAborted();
          } else {
            request.signal?.addEventListener('abort', rejectAsAborted, { once: true });
          }
        });
      },
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const facade = await executeStreamRequest(
        'https://example.com/rn-cooperative-deadline',
        streamTransport,
      );
      const terminalSnapshot = observeTerminalLifecycle(facade);

      await withHarnessDeadline(providerEntered.promise, 'cooperative provider was not invoked');
      await delay(DEADLINE_OBSERVATION_MS);

      expect({
        providerCalls,
        signalWasProvided,
        abortEvents,
        terminal: terminalSnapshot(),
        unhandledRejections,
      }).toEqual({
        providerCalls: 1,
        signalWasProvided: true,
        abortEvents: 1,
        terminal: {
          events: ['error'],
          errorCodes: ['ETIMEDOUT'],
          successStatuses: [],
          isFinished: false,
        },
        unhandledRejections: [],
      });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('hard-settles a non-cooperative provider at the deadline and quarantines late success', async () => {
    const providerEntered = createDeferred<void>();
    const providerRelease = createDeferred<RezoReactNativeStreamResult>();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    let providerCalls = 0;
    let abortEvents = 0;
    let signalWasProvided = false;

    const streamTransport: RezoReactNativeStreamTransport = {
      name: 'non-cooperative-deadline-probe',
      stream(request: RezoReactNativeStreamRequest) {
        providerCalls += 1;
        signalWasProvided = request.signal instanceof AbortSignal;
        request.signal?.addEventListener('abort', () => {
          abortEvents += 1;
        }, { once: true });
        providerEntered.resolve(undefined);
        return providerRelease.promise;
      },
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const url = 'https://example.com/rn-non-cooperative-deadline';
      const facade = await executeStreamRequest(url, streamTransport);
      const terminalSnapshot = observeTerminalLifecycle(facade);

      await withHarnessDeadline(providerEntered.promise, 'non-cooperative provider was not invoked');
      await delay(DEADLINE_OBSERVATION_MS);
      const atDeadline = terminalSnapshot();

      providerRelease.resolve(successfulProviderResult(url));
      await delay(RELEASE_OBSERVATION_MS);
      const afterLateRelease = terminalSnapshot();

      expect({
        providerCalls,
        signalWasProvided,
        abortEvents,
        atDeadline,
        afterLateRelease,
        unhandledRejections,
      }).toEqual({
        providerCalls: 1,
        signalWasProvided: true,
        abortEvents: 1,
        atDeadline: {
          events: ['error'],
          errorCodes: ['ETIMEDOUT'],
          successStatuses: [],
          isFinished: false,
        },
        afterLateRelease: {
          events: ['error'],
          errorCodes: ['ETIMEDOUT'],
          successStatuses: [],
          isFinished: false,
        },
        unhandledRejections: [],
      });
    } finally {
      providerRelease.resolve(successfulProviderResult(
        'https://example.com/rn-non-cooperative-deadline',
      ));
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
