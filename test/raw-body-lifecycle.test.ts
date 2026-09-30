import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { RezoError } from '../src/errors/rezo-error';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { rawBodyReceiver, type BodyRecord } from './fixtures/raw-body-receiver';
import { streamBodyCases } from './fixtures/raw-body-carriers';

const bytes = [65, 0, 255, 13, 10];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function failure(operation: Promise<unknown>): Promise<RezoError> {
  const error = await operation.then(() => undefined, (reason: unknown) => reason);
  expect(error instanceof RezoError).toBe(true);
  return error as RezoError;
}

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter], ['curl', curl]] as const) {
  describe(`${name} request body ownership`, () => {
    let receiver: Awaited<ReturnType<typeof rawBodyReceiver>>;
    const client = new Rezo({ cache: false, disableJar: true, retry: false, keepAlive: false }, adapter);
    beforeAll(async () => {
      receiver = await rawBodyReceiver(adapter === http2, (record, records) => {
        if (record.path.startsWith('/307') || record.path.startsWith('/308')) {
          return { status: Number(record.path.slice(1, 4)), headers: { location: '/final' } };
        }
        if (record.path.startsWith('/retry') && records.filter(r => r.path === record.path).length === 1) {
          return { status: 503 };
        }
        return { status: 200 };
      });
    });
    afterAll(async () => {
      client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool();
      await receiver?.close();
    });
    const send = (body: unknown, path = '/', extra = {}) => client.request<BodyRecord>({
      url: `${receiver.url}${path}`, method: 'PUT', body, responseType: 'json', timeout: 1500,
      headers: { 'Content-Type': 'application/json' }, ...extra,
    });

    for (const carrier of streamBodyCases) {
      const kind = carrier.name;
      it(`claims a shared ${kind} body once across concurrent requests`, async () => {
        const before = receiver.arrivals.length;
        const body = carrier.make();
        const results = await Promise.allSettled([send(body), send(body)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason.code).toBe('REZ_STREAM_ERROR');
        await sleep(30);
        expect(receiver.arrivals).toHaveLength(before + 1);
      });

      it(`refuses an externally consumed ${kind} stream before dispatch`, async () => {
        const before = receiver.arrivals.length;
        const body = carrier.make() as Readable | ReadableStream<Uint8Array>;
        if (body instanceof Readable) { for await (const _chunk of body) { /* Drain outside Rezo. */ } }
        else {
          const reader = body.getReader();
          while (!(await reader.read()).done) { /* Drain outside Rezo. */ }
          reader.releaseLock();
        }
        const error = await failure(send(body));
        expect(error.code).toBe('REZ_STREAM_ERROR');
        expect(receiver.arrivals).toHaveLength(before);
      });

      it(`leaves a pre-aborted ${kind} available for a later request`, async () => {
        const before = receiver.arrivals.length;
        const body = carrier.make();
        const error = await failure(send(body, '/pre-aborted', { signal: AbortSignal.abort() }));
        expect(error.code).toBe('ABORT_ERR');
        expect(receiver.arrivals).toHaveLength(before);
        expect((await send(body)).data.bytes).toEqual(bytes);
      });
    }

    for (const kind of ['Node', 'Web']) {
      it(`${kind} sends its first bytes before waiting for producer completion`, async () => {
        let reachedReceiver!: () => void;
        const firstBytes = new Promise<void>(resolve => { reachedReceiver = resolve; });
        const incremental = await rawBodyReceiver(adapter === http2, undefined, reachedReceiver);
        const body = kind === 'Node' ? Readable.from((async function* () {
          yield Buffer.from(bytes); await firstBytes; yield Buffer.from(bytes);
        })()) : new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(Uint8Array.from(bytes)); await firstBytes;
            controller.enqueue(Uint8Array.from(bytes)); controller.close();
          },
        });
        try {
          const response = await client.request<BodyRecord>({
            url: incremental.url, method: 'POST', body, timeout: 1000, responseType: 'json',
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          expect(response.data.bytes).toEqual([...bytes, ...bytes]);
          expect(response.data.method).toBe('POST');
        } finally { reachedReceiver(); await incremental.close(); }
      });
    }

    for (const status of [307, 308, 'retry']) {
      it(`${status} replays only the selected bytes`, async () => {
        const before = receiver.records.length;
        const body = new DataView(Uint8Array.from([88, ...bytes, 89]).buffer, 1, bytes.length);
        const response = await send(body, `/${status}/bytes`, {
          retry: { maxRetries: 1, retryDelay: 1, retryOn: [503], statusCodes: [503] },
        });
        expect(response.data.bytes).toEqual(bytes);
        expect(receiver.records.slice(before).map(r => r.bytes)).toEqual([bytes, bytes]);
      });
      for (const carrier of streamBodyCases) {
        it(`${status} refuses exhausted ${carrier.name} before a second dispatch`, async () => {
          const before = receiver.records.length;
          const error = await failure(send(carrier.make(), `/${status}/${encodeURIComponent(carrier.name)}`, {
            retry: { maxRetries: 1, retryDelay: 1, retryOn: [503], statusCodes: [503] },
          }));
          expect(error.code).toBe('REZ_STREAM_ERROR');
          expect(receiver.records.slice(before).map(r => r.bytes)).toEqual([bytes]);
        });
      }
    }

    for (const kind of ['Node', 'Web']) {
      for (const terminal of ['abort', 'deadline', 'source error']) {
        it(`${terminal} releases a pending ${kind} producer`, async () => {
          let stopped = 0;
          let produced = 0;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const cause = new Error('Synthetic body producer failure');
          const body = kind === 'Node' ? new Readable({
            read() {
              if (produced++) return;
              this.push(Buffer.from(bytes));
              if (terminal === 'source error') timer = setTimeout(() => this.destroy(cause), 30);
            },
            destroy(error, callback) { stopped++; clearTimeout(timer); callback(error); },
          }) : new ReadableStream<Uint8Array>({
            start(controller) {
              produced++; controller.enqueue(Uint8Array.from(bytes));
              if (terminal === 'source error') timer = setTimeout(() => { stopped++; controller.error(cause); }, 30);
            },
            cancel() { stopped++; clearTimeout(timer); },
          });
          const controller = new AbortController();
          const abort = terminal === 'abort' ? setTimeout(() => controller.abort(), 80) : undefined;
          try {
            const error = await failure(send(body, '/pending', {
              signal: controller.signal, timeout: terminal === 'deadline' ? 100 : 1000,
            }));
            expect(typeof error.code).toBe('string');
            if (terminal === 'deadline') expect(error.code).toBe('ECONNABORTED');
            if (terminal === 'source error') expect(error.code).not.toBe('ECONNABORTED');
            await sleep(40);
            expect(stopped).toBe(1);
          } finally { clearTimeout(abort); clearTimeout(timer); }
        });
      }
    }
  });
}
