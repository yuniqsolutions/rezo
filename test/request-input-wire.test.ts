import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRezoInstance } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { rawBodyReceiver, type BodyRecord } from './fixtures/raw-body-receiver';

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter], ['curl', curl]] as const) {
  describe(`compatible inputs on ${name}`, () => {
    const client = createRezoInstance<BodyRecord>(adapter, { cache: false, disableJar: true, retry: false, keepAlive: false });
    let receiver: Awaited<ReturnType<typeof rawBodyReceiver>>;
    beforeAll(async () => { receiver = await rawBodyReceiver(adapter === http2); });
    afterAll(async () => { client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool(); await receiver.close(); });
    for (const surface of ['call', 'request'] as const) {
      it(`${surface} forwards Request body and headers and consumes it once`, async () => {
        const input = new Request(receiver.url, { method: 'POST', body: new Uint8Array([0, 255, 65]),
          headers: { 'content-type': 'application/json' } });
        const response = surface === 'call' ? await client(input) : await client.request(input);
        expect(response.data.bytes).toEqual([0, 255, 65]);
        expect(response.data.method).toBe('POST');
        expect(response.data.contentType).toBe('application/json');
        expect(input.bodyUsed).toBe(true);
        const arrivals = receiver.arrivals.length;
        const error = await client(input).then(() => undefined, (failure: unknown) => failure);
        expect(error instanceof Error && Reflect.get(error, 'code')).toBe('REZ_STREAM_ERROR');
        expect(receiver.arrivals).toHaveLength(arrivals);
      });
    }
    it('Axios data and Got query reach the wire exactly', async () => {
      const view = new DataView(Uint8Array.from([99, 0, 255, 65, 99]).buffer, 1, 3);
      const response = await client.request('bytes?discard=1', { prefixUrl: receiver.url + '/api', method: 'post',
        data: view, headers: { 'content-type': 'application/json' }, searchParams: new URLSearchParams('a=1&a=2&empty=') });
      expect(response.data.bytes).toEqual([0, 255, 65]);
      expect(response.data.path).toBe('/api/bytes?a=1&a=2&empty=');
    });
    it('Request abort prevents an attempt', async () => {
      const controller = new AbortController(); controller.abort(new Error('Synthetic caller cancellation'));
      const arrivals = receiver.arrivals.length;
      const error = await client(new Request(receiver.url, { signal: controller.signal })).then(() => undefined, (failure: unknown) => failure);
      expect(error instanceof Error && Reflect.get(error, 'isRezoError')).toBe(true);
      expect(receiver.arrivals).toHaveLength(arrivals);
    });
    it('Fetch cache control does not turn into a native cache config', async () => {
      const response = await client(receiver.url, { cache: 'no-store' });
      expect(response.data.method).toBe('GET');
    });
    it('serializer object preserves repeated keys and an empty value', async () => {
      const response = await client.request(receiver.url + '/query?original=1', { params: { a: ['1', '2'] },
        paramsSerializer: { serialize: () => 'a=1&a=2&empty=&original=changed' } });
      expect(response.data.path).toBe('/query?original=1&a=1&a=2&empty=');
    });
    it('a supported extension method never silently becomes GET', async () => {
      const response = await client.request(receiver.url, { method: 'PROPFIND', body: 'query' });
      expect(response.data.method).toBe('PROPFIND');
      expect(response.data.bytes).toEqual(Array.from(Buffer.from('query')));
    });
    for (const json of [null, false, 0, 'literal']) {
      it(`JSON input preserves ${JSON.stringify(json)}`, async () => {
        const response = await client.request(receiver.url, { method: 'POST', json });
        expect(response.data.bytes).toEqual(Array.from(Buffer.from(JSON.stringify(json))));
        expect(response.data.contentType).toBe('application/json');
      });
    }
  });
}
