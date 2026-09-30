// React Native stream close contract — the reachable native stream publisher
// must speak the one-API terminal order every other adapter speaks:
// `end → finish → done → complete → close`, each exactly once. The close is
// the RF-06 stream-only close at the emission site inside
// `executeNativeStreamRequest`'s deferred success path (final placement — the
// reviewer wave moved it off the settlement `publishSuccess` `instanceof`
// sniff, which a dual CJS/ESM build defeats; the dual-graph carrier pins that
// hazard). RED-first history: XN-01/XN-02 were red on the pre-close-out bytes
// (`finish → done → complete → end`, no close) and flipped green with the
// publisher alignment + the stream-only close. XN-03/XN-04 pin that the
// download and upload publishers gain no close and keep their trio order.
// Supplied and auto-created native-provider facades are both exercised.
import { describe, expect, it } from 'vitest';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { StreamResponse } from '../src/responses/universal/stream.js';
import { DownloadResponse } from '../src/responses/universal/download.js';
import { UploadResponse } from '../src/responses/universal/upload.js';

const URL_BASE = 'https://close-contract.react-native.rezo.test';
const TERMINAL_EVENTS = ['end', 'finish', 'done', 'complete', 'close'] as const;

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

interface FacadeLedger { events: string[]; errors: unknown[] }
function observeFacade(facade: { on(event: string, listener: (...args: unknown[]) => void): unknown; }): FacadeLedger {
  const events: string[] = [];
  const errors: unknown[] = [];
  for (const event of TERMINAL_EVENTS) facade.on(event, () => events.push(event));
  facade.on('data', () => events.push('data'));
  facade.on('error', (error) => { events.push('error'); errors.push(error); });
  return { events, errors };
}

function terminalSequence(ledger: FacadeLedger): string[] {
  return ledger.events.filter((event) => (TERMINAL_EVENTS as readonly string[]).includes(event));
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${label}: condition not reached within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
  // One extra macrotask so a synchronous publish block finishes entirely.
  await new Promise((r) => setTimeout(r, 25));
}

function nativeStreamResult(suffix: string): Record<string, unknown> {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain', 'content-length': '1' },
    finalUrl: `${URL_BASE}/${suffix}`,
    contentType: 'text/plain',
    contentLength: 1,
  };
}

async function driveStream(suffix: string, facade?: StreamResponse): Promise<{ facade: StreamResponse; ledger: FacadeLedger }> {
  const release = createDeferred<void>();
  const entered = createDeferred<void>();
  const request: Record<string, unknown> = {
    url: `${URL_BASE}/${suffix}`,
    method: 'GET',
    responseType: 'stream',
    retry: false,
    cache: false,
  };
  if (facade) request._streamResponse = facade;
  const returned = await executeRequest(request as never, {
    reactNative: {
      streamTransport: {
        name: `close-contract-${suffix}`,
        async stream(streamRequest: { onChunk(chunk: Uint8Array): Promise<void> | void }) {
          entered.resolve(undefined);
          await streamRequest.onChunk(new Uint8Array([1]));
          await release.promise;
          return nativeStreamResult(suffix);
        },
      },
    },
  } as never, new RezoCookieJar()) as unknown as StreamResponse;
  if (facade && returned !== facade) throw new Error(`${suffix}: supplied facade identity moved`);
  const observed = facade ?? returned;
  const ledger = observeFacade(observed as never);
  await entered.promise;
  release.resolve(undefined);
  await waitFor(() => observed.isFinished(), `${suffix} stream publish`);
  return { facade: observed, ledger };
}

describe('react-native stream close contract', () => {
  it('XN-01 a supplied stream facade publishes end→finish→done→complete→close exactly once each', async () => {
    const supplied = new StreamResponse();
    const ledger = observeFacade(supplied as never);
    const { facade } = await driveStream('supplied', supplied);
    expect(terminalSequence(ledger)).toEqual([...TERMINAL_EVENTS]);
    expect({ finished: facade.isFinished(), errors: ledger.errors.length }).toEqual({ finished: true, errors: 0 });
  });

  it('XN-02 an auto-created stream facade publishes the same full sequence', async () => {
    const { facade, ledger } = await driveStream('auto-created');
    expect(terminalSequence(ledger)).toEqual([...TERMINAL_EVENTS]);
    expect({ finished: facade.isFinished(), errors: ledger.errors.length }).toEqual({ finished: true, errors: 0 });
  });

  it('XN-03 the download publisher keeps its trio order and gains no close', async () => {
    const facade = new DownloadResponse(`/tmp/close-contract-download.bin`, `${URL_BASE}/download`);
    const ledger = observeFacade(facade as never);
    await executeRequest({
      url: `${URL_BASE}/download`,
      method: 'GET',
      saveTo: '/tmp/close-contract-download.bin',
      retry: false,
      cache: false,
      _isDownload: true,
      _downloadResponse: facade,
    } as never, {
      reactNative: {
        fileSystemAdapter: {
          name: 'close-contract-fs',
          capabilities: { fileDownload: true, downloadProgress: true },
          async downloadFile() {
            return {
              ...nativeStreamResult('download'),
              headers: { 'content-type': 'application/octet-stream', 'content-length': '1' },
              contentType: 'application/octet-stream',
              filePath: '/tmp/close-contract-download.bin',
              fileSize: 1,
            };
          },
        },
      },
    } as never, new RezoCookieJar());
    await waitFor(() => facade.isFinished(), 'download publish');
    expect(terminalSequence(ledger)).toEqual(['finish', 'done', 'complete']);
  });

  it('XN-04 the upload publisher keeps its trio order and gains no close', async () => {
    const facade = new UploadResponse(`${URL_BASE}/upload`, 'close-contract-upload.bin');
    const ledger = observeFacade(facade as never);
    await executeRequest({
      url: `${URL_BASE}/upload`,
      method: 'POST',
      body: { uri: 'file:///tmp/close-contract-upload.bin', name: 'close-contract-upload.bin', type: 'application/octet-stream', size: 1 },
      retry: false,
      cache: false,
      _isUpload: true,
      _uploadResponse: facade,
    } as never, {
      reactNative: {
        fileSystemAdapter: {
          name: 'close-contract-fs',
          capabilities: { uploadFromFile: true, uploadProgress: true },
          async uploadFile() {
            return {
              ...nativeStreamResult('upload'),
              body: 'ok',
              uploadSize: 1,
              fileName: 'close-contract-upload.bin',
            };
          },
        },
      },
    } as never, new RezoCookieJar());
    await waitFor(() => facade.isFinished(), 'upload publish');
    expect(terminalSequence(ledger)).toEqual(['finish', 'done', 'complete']);
  });
});
