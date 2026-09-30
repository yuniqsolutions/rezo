import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { executeRequest as reactNative } from '../src/adapters/react-native';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { rawBodyCases, streamBodyCases } from './fixtures/raw-body-carriers';
import { rawBodyReceiver, type BodyRecord } from './fixtures/raw-body-receiver';

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter],
  ['curl', curl], ['react-native host fetch', reactNative]] as const) {
  describe(name, () => {
    let receiver: Awaited<ReturnType<typeof rawBodyReceiver>>;
    const client = new Rezo({ cache: false, disableJar: true, retry: false, keepAlive: false }, adapter);
    beforeAll(async () => { receiver = await rawBodyReceiver(adapter === http2); });
    afterAll(async () => {
      client.destroy();
      Http2SessionPool.getInstance().destroy();
      resetGlobalAgentPool();
      await receiver?.close();
    });
    for (const contentType of [undefined, 'application/json', 'text/plain', 'application/octet-stream']) {
      for (const carrier of rawBodyCases) {
        it(`${contentType ?? 'inferred'} / ${carrier.name}`, async () => {
          const response = await client.request<BodyRecord>({
            url: receiver.url, method: 'POST', body: carrier.make(), timeout: 1500,
            responseType: 'json', headers: contentType ? { 'Content-Type': contentType } : undefined,
          });
          expect(response.data.bytes).toEqual(carrier.bytes);
          expect(response.data.method).toBe('POST');
          if (contentType) expect(response.data.contentType).toBe(contentType);
          if (response.data.contentLength !== undefined) {
            expect(Number(response.data.contentLength)).toBe(carrier.bytes.length);
          }
        });
      }
    }
    for (const carrier of streamBodyCases) {
      it(`application/json / ${carrier.name}`, async () => {
        const call = client.request<BodyRecord>({
          url: receiver.url, method: 'POST', body: carrier.make(), timeout: 1500,
          responseType: 'json', headers: { 'Content-Type': 'application/json' },
        });
        if (adapter === reactNative) {
          const receivedBefore = receiver.records.length;
          const error = await call.then(() => undefined, (failure: unknown) => failure);
          expect(error instanceof Error && Reflect.get(error, 'code')).toBe('REZ_UNSUPPORTED_CAPABILITY');
          expect(receiver.records).toHaveLength(receivedBefore);
        } else {
          const response = await call;
          expect(response.data.bytes).toEqual(carrier.bytes);
          expect(response.data.method).toBe('POST');
        }
      });
    }
  });
}
