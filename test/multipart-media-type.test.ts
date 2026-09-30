import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { executeRequest as reactNative } from '../src/adapters/react-native';
import { RezoFormData } from '../src/utils/form-data';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { rawBodyReceiver, type BodyRecord } from './fixtures/raw-body-receiver';

function body(native: boolean): FormData | RezoFormData {
  const form = native ? new FormData() : new RezoFormData();
  form.append('note', 'literal form value');
  form.append('file', new Blob([Uint8Array.from([0, 255, 65])]), 'bytes.bin');
  return form;
}

async function expectMultipartBytes(record: BodyRecord, withFile = true): Promise<void> {
  // Explicit media types need not describe multipart. Derive the boundary from
  // bytes solely for the payload assertion; the actual header is checked apart.
  const boundary = Buffer.from(record.bytes).toString('latin1').split('\r\n', 1)[0].slice(2);
  expect(boundary.length).toBeGreaterThan(0);
  const parsed = await new Response(Uint8Array.from(record.bytes), {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  }).formData();
  expect(parsed.get('note')).toBe('literal form value');
  if (withFile) {
    const file = parsed.get('file') as File;
    expect(file.name).toBe('bytes.bin');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0, 255, 65]);
  }
}

const mediaTypes = ['application/json', 'application/x-custom', 'multipart/form-data', ''];
for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter],
  ['curl', curl], ['react-native host fetch', reactNative]] as const) {
  describe(`${name} multipart media type ownership`, () => {
    let receiver: Awaited<ReturnType<typeof rawBodyReceiver>>;
    const client = new Rezo({ cache: false, retry: false, disableJar: true, keepAlive: false }, adapter);
    beforeAll(async () => { receiver = await rawBodyReceiver(adapter === http2); });
    afterAll(async () => {
      client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool();
      await receiver?.close();
    });
    for (const native of [true, false]) {
      for (const contentType of mediaTypes) {
        it(`${native ? 'native' : 'Rezo'} FormData preserves explicit ${contentType || 'empty'} header`, async () => {
          const response = await client.request<BodyRecord>({
            url: receiver.url, method: 'POST', body: body(native), responseType: 'json', timeout: 2000,
            headers: { 'Content-Type': contentType },
          });
          expect(response.data.contentType).toBe(contentType);
          await expectMultipartBytes(response.data);
        });
      }
      it(`${native ? 'native' : 'Rezo'} FormData respects Rezo's contentType option`, async () => {
        const response = await client.request<BodyRecord>({
          url: receiver.url, method: 'POST', body: body(native), responseType: 'json', timeout: 2000,
          contentType: 'application/x-custom',
        });
        expect(response.data.contentType).toBe('application/x-custom');
        await expectMultipartBytes(response.data);
      });
    }
    for (const options of [
      { contentType: 'application/x-custom' },
      { headers: { 'Content-Type': '' } },
    ]) {
      it(`URLSearchParams respects explicit ${Object.keys(options)[0]}`, async () => {
        const response = await client.request<BodyRecord>({
          url: receiver.url, method: 'POST', body: new URLSearchParams({ note: 'literal form value' }),
          responseType: 'json', timeout: 2000, ...options,
        });
        expect(response.data.contentType).toBe(options.contentType ?? '');
        expect(Buffer.from(response.data.bytes).toString()).toBe('note=literal+form+value');
      });
    }
    for (const options of [
      { multipart: { note: 'literal form value' } },
      { formData: { note: 'literal form value' } },
      { body: { note: 'literal form value' }, contentType: 'multipart/form-data' },
    ]) {
      it(`native shorthand ${Object.keys(options)[0]} still generates its boundary`, async () => {
        const response = await client.request<BodyRecord>({
          url: receiver.url, method: 'POST', responseType: 'json', timeout: 2000, ...options,
        });
        expect(response.data.contentType).toMatch(/^multipart\/form-data;\s*boundary=.+/);
        await expectMultipartBytes(response.data, false);
      });
    }
    it('Rezo generated headers remain paired with the transmitted representation', async () => {
      const form = body(false) as RezoFormData;
      const headers = await form.getHeadersAsync();
      const response = await client.request<BodyRecord>({
        url: receiver.url, method: 'POST', body: form, headers, responseType: 'json', timeout: 2000,
      });
      const parsed = await new Response(Uint8Array.from(response.data.bytes), {
        headers: { 'Content-Type': response.data.contentType! },
      }).formData();
      expect(parsed.get('note')).toBe('literal form value');
      expect(Array.from(new Uint8Array(await (parsed.get('file') as File).arrayBuffer()))).toEqual([0, 255, 65]);
    });
    if (adapter === fetchAdapter) {
      for (const contentType of mediaTypes) {
        it(`independent native Fetch preserves explicit ${contentType || 'empty'} header`, async () => {
          const response = await fetch(receiver.url, {
            method: 'POST', body: body(true) as FormData, headers: { 'Content-Type': contentType },
            signal: AbortSignal.timeout(2000),
          });
          const record = await response.json() as BodyRecord;
          expect(record.contentType).toBe(contentType);
          await expectMultipartBytes(record);
        });
      }
    }
  });
}
