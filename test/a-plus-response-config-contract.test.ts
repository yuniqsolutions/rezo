// Response-config contract (RO-11) — the `config` a finish event carries is a
// detached DTO owning exactly 13 keys, never the live request config. The
// live config leaks nested aliases, functions, the jar, signals, hooks and
// credential material through every adapter's shallow copy (and cURL's direct
// cast). RED-first: CC-01..CC-03 and CC-05 are red on the shallow-copy bytes
// and flip green with the shared projector; CC-04 exercises the projector's
// own allowlists once it exists.
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeRequest } from '../src/adapters/react-native.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { StreamResponse } from '../src/responses/universal/stream.js';
import { RezoHeaders } from '../src/utils/headers.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SANITIZED_KEYS = [
  'adapterMetadata', 'adapterUsed', 'errors', 'finalUrl', 'headers', 'method',
  'network', 'redirectCount', 'responseType', 'retryAttempts', 'timing', 'transfer', 'url',
] as const;

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${label}: condition not reached within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 25));
}

// Drives the React Native adapter with a fake native stream transport (no
// network) and returns the config carried by its finish event.
async function harvestReactNativeFinishConfig(): Promise<{ eventConfig: Record<string, unknown>; liveConfig: Record<string, unknown> }> {
  const facade = new StreamResponse();
  const finishConfigs: unknown[] = [];
  facade.on('finish', (event: { config?: unknown }) => { finishConfigs.push(event?.config); });
  let liveConfig: Record<string, unknown> | undefined;
  const release = createDeferred<void>();
  await executeRequest({
    url: 'https://user:secret@config-contract.rezo.test/resource?token=abc',
    method: 'GET',
    responseType: 'stream',
    retry: false,
    cache: false,
    headers: { authorization: 'Bearer credential-material', 'x-plain': 'kept' },
    _streamResponse: facade,
  } as never, {
    reactNative: {
      streamTransport: {
        name: 'config-contract',
        async stream(streamRequest: { onChunk(chunk: Uint8Array): Promise<void> | void; config?: unknown }) {
          await streamRequest.onChunk(new Uint8Array([1]));
          await release.promise;
          return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain', 'content-length': '1' },
            finalUrl: 'https://config-contract.rezo.test/resource',
            contentType: 'text/plain',
            contentLength: 1,
          };
        },
      },
    },
  } as never, new RezoCookieJar()).then((returned) => {
    liveConfig = (returned as { config?: Record<string, unknown> }).config
      ?? liveConfig;
    return returned;
  });
  release.resolve(undefined);
  await waitFor(() => finishConfigs.length > 0 && facade.isFinished(), 'react-native finish event');
  const eventConfig = finishConfigs[0] as Record<string, unknown>;
  // The facade return hides the live config; recover it from the event's own
  // leak when the DTO is not yet in place, else from the sanitized copy.
  return { eventConfig, liveConfig: (liveConfig ?? eventConfig) };
}

// Drives the HTTP/1.1 adapter against a local fixture and returns the stream
// finish event's config.
async function harvestHttpFinishConfig(): Promise<Record<string, unknown>> {
  // The fixture holds the body open until the finish listener is attached:
  // finish is not a replayed event, so a fully-buffered tiny response would
  // race the listener.
  let releaseResponse: (() => void) | undefined;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
    response.write('o');
    releaseResponse = () => response.end('k');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const { default: platformEntry } = await import('../src/platform/node.js');
    const client = (platformEntry as { create(config: Record<string, unknown>): { stream(url: string, options?: Record<string, unknown>): { on(event: string, listener: (payload: unknown) => void): unknown; isFinished(): boolean } } }).create({});
    const stream = client.stream(`http://user:secret@127.0.0.1:${port}/fixture?probe=1`, {
      headers: { authorization: 'Bearer credential-material', 'x-plain': 'kept' },
    });
    const finishConfigs: unknown[] = [];
    stream.on('finish', (event) => { finishConfigs.push((event as { config?: unknown })?.config); });
    await waitFor(() => releaseResponse !== undefined, 'http fixture reached');
    releaseResponse?.();
    await waitFor(() => finishConfigs.length > 0, 'http finish event');
    return finishConfigs[0] as Record<string, unknown>;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('response config contract', () => {
  it('CC-01 the react-native finish event config owns exactly the 13 sanitized keys', async () => {
    const { eventConfig } = await harvestReactNativeFinishConfig();
    expect(Object.keys(eventConfig as object).sort()).toEqual([...SANITIZED_KEYS]);
  });

  it('CC-02 the react-native finish event config is detached and credential-free', async () => {
    const { eventConfig } = await harvestReactNativeFinishConfig();
    const record = eventConfig as Record<string, unknown>;
    const headers = record.headers as RezoHeaders;
    expect({
      jar: 'jar' in record,
      signal: 'signal' in record,
      hooks: 'hooks' in record,
      data: 'data' in record,
      authorization: headers instanceof RezoHeaders ? headers.get('authorization') : '<no-headers>',
      plainHeader: headers instanceof RezoHeaders ? headers.get('x-plain') : '<no-headers>',
      urlCredential: String(record.url).includes('secret'),
      lookup: typeof (record.network as Record<string, unknown> | undefined)?.lookup,
    }).toEqual({
      jar: false, signal: false, hooks: false, data: false,
      authorization: null, plainHeader: 'kept', urlCredential: false, lookup: 'undefined',
    });
  });

  it('CC-03 the http finish event config owns exactly the 13 sanitized keys with sanitized url and headers', async () => {
    const config = await harvestHttpFinishConfig();
    const headers = config.headers as RezoHeaders;
    expect({
      keys: Object.keys(config as object).sort(),
      authorization: headers instanceof RezoHeaders ? headers.get('authorization') : '<no-headers>',
      urlCredential: String(config.url).includes('secret'),
    }).toEqual({ keys: [...SANITIZED_KEYS], authorization: null, urlCredential: false });
  });

  it('CC-04 the projector strips credentials, drops lookup, snapshots scalars and detaches errors', async () => {
    const module = await import('../src/responses/sanitize-config.js').catch(() => null);
    expect(module, 'src/responses/sanitize-config.ts must exist and export sanitizeConfig').not.toBeNull();
    const sanitizeConfig = (module as { sanitizeConfig(config: unknown): Record<string, unknown> }).sanitizeConfig;
    const nested = { called: 0 };
    const liveError = Object.assign(new Error('boom'), { code: 'REZ_NETWORK_ERROR', status: 502 });
    const live: Record<string, unknown> = {
      url: 'https://user:secret@example.test/a?b=1',
      finalUrl: 'https://user:secret@example.test/a',
      method: 'GET',
      adapterUsed: 'http',
      adapterMetadata: { version: '1', features: ['h1'], capabilities: { proxy: () => nested.called++ } },
      headers: new RezoHeaders({ authorization: 'Bearer x', cookie: 'sid=1', 'x-keep': 'yes' }),
      network: { protocol: 'https:', remotePort: 443, lookup: () => nested.called++, httpVersion: '1.1' },
      timing: { startTime: 1, domainLookupStart: 0, domainLookupEnd: 0, connectStart: 0, secureConnectionStart: 0, connectEnd: 0, requestStart: 2, responseStart: 3, responseEnd: Number.NaN },
      transfer: { requestSize: 10, responseSize: 20, headerSize: 5, bodySize: 15, compressionRatio: Number.POSITIVE_INFINITY },
      retryAttempts: 1,
      redirectCount: 0,
      responseType: undefined,
      errors: [{ attempt: 1, duration: 12, error: liveError }],
      jar: { leak: true },
      signal: { leak: true },
      data: 'body-material',
    };
    const projected = sanitizeConfig(live);
    const projectedHeaders = projected.headers as RezoHeaders;
    const projectedError = (projected.errors as Array<Record<string, unknown>>)[0];
    (projected.timing as Record<string, number>).startTime = 999;
    ((projected.errors as Array<Record<string, unknown>>)).push({ attempt: 9 });
    expect({
      keys: Object.keys(projected).sort(),
      url: projected.url,
      authorization: projectedHeaders.get('authorization'),
      cookie: projectedHeaders.get('cookie'),
      kept: projectedHeaders.get('x-keep'),
      lookup: 'lookup' in (projected.network as object),
      metadataCapabilities: 'capabilities' in (projected.adapterMetadata as object),
      nanBecameFinite: Number.isFinite((projected.timing as Record<string, number>).responseEnd),
      infinityDropped: (projected.transfer as Record<string, unknown>).compressionRatio,
      errorIsPlain: projectedError?.error instanceof Error,
      errorShape: projectedError?.error,
      liveTimingUntouched: (live.timing as Record<string, number>).startTime,
      liveErrorsUntouched: (live.errors as unknown[]).length,
    }).toEqual({
      keys: [...SANITIZED_KEYS],
      url: 'https://example.test/a?b=1',
      authorization: null,
      cookie: null,
      kept: 'yes',
      lookup: false,
      metadataCapabilities: false,
      nanBecameFinite: true,
      infinityDropped: undefined,
      errorIsPlain: false,
      errorShape: { name: 'Error', message: 'boom', code: 'REZ_NETWORK_ERROR', status: 502 },
      liveTimingUntouched: 1,
      liveErrorsUntouched: 1,
    });
  });

  it('CC-06 the projector survives hostile inputs: string family, unparseable credential URLs, foreign header containers, invalid header names', async () => {
    const module = await import('../src/responses/sanitize-config.js');
    const sanitizeConfig = (module as { sanitizeConfig(config: unknown): Record<string, unknown> }).sanitizeConfig;
    const stringFamily = sanitizeConfig({ network: { protocol: 'https:', family: 'IPv4' } });
    const stringFamilySix = sanitizeConfig({ network: { protocol: 'https:', family: 'IPv6' } });
    const protocolRelative = sanitizeConfig({ url: '//user:secret@internal.host/path', finalUrl: '//user:secret@internal.host/path' });
    const bracketlessSix = sanitizeConfig({ url: 'http://u:p@::1/x' });
    const whatwg = sanitizeConfig({ headers: new Headers({ accept: 'application/json', authorization: 'Bearer leak' }) });
    const invalidName = sanitizeConfig({ headers: { 'bad name': 'v', 'x-good': 'kept' } });
    expect({
      family4: (stringFamily.network as Record<string, unknown>).family,
      family6: (stringFamilySix.network as Record<string, unknown>).family,
      protocolRelativeUrl: protocolRelative.url,
      protocolRelativeFinal: protocolRelative.finalUrl,
      bracketlessCredential: String(bracketlessSix.url).includes('u:p@'),
      whatwgAccept: (whatwg.headers as RezoHeaders).get('accept'),
      whatwgAuthorization: (whatwg.headers as RezoHeaders).get('authorization'),
      invalidNameKept: (invalidName.headers as RezoHeaders).get('x-good'),
    }).toEqual({
      family4: 4,
      family6: 6,
      protocolRelativeUrl: '//internal.host/path',
      protocolRelativeFinal: '//internal.host/path',
      bracketlessCredential: false,
      whatwgAccept: 'application/json',
      whatwgAuthorization: null,
      invalidNameKept: 'kept',
    });
  });

  it('CC-05 every adapter routes through the shared projector with no local helper and no live cast', () => {
    const adapters = ['http.ts', 'http2.ts', 'fetch.ts', 'xhr.ts', 'curl.ts', 'react-native.ts'];
    const shape = Object.fromEntries(adapters.map((name) => {
      const source = readFileSync(resolve(REPO_ROOT, 'src/adapters', name), 'utf8');
      return [name, {
        importsProjector: source.includes("from '../responses/sanitize-config"),
        localHelper: source.includes('function sanitizeConfig('),
        liveCast: source.includes('as SanitizedRezoConfig'),
      }];
    }));
    expect(shape).toEqual(Object.fromEntries(adapters.map((name) => [name, {
      importsProjector: true, localHelper: false, liveCast: false,
    }])));
  });
});
