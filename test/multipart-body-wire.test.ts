import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { RezoFormData } from '../src/utils/form-data';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';
import { rawBodyReceiver, type BodyRecord } from './fixtures/raw-body-receiver';

type Field = readonly [string, string | { name: string; type: string; bytes: number[] }];
const cases: { name: string; fields: Field[] }[] = [
  { name: 'boundary and repeated fields', fields: [
    ['repeat', 'first'], ['repeat', 'second'],
    ['file', { name: 'first.bin', type: 'application/octet-stream', bytes: [0, 255, 65] }],
    ['file', { name: 'second.txt', type: 'text/plain;charset=utf-8', bytes: [66, 13, 10] }],
  ] },
  { name: 'literal curl form syntax', fields: [
    ['at', '@rezo-synthetic-missing-file'], ['less', '<rezo-synthetic-missing-file'],
    ['metadata', 'hello;type=application/json;filename=synthetic.json'],
  ] },
  { name: 'embedded NUL text', fields: [['text', 'before\0after']] },
  { name: 'field paths and filename metadata', fields: [
    ['dir/part', { name: 'part;type=text.txt', type: 'application/octet-stream', bytes: [0, 128, 255] }],
  ] },
  { name: 'empty form', fields: [] },
];

function formBody(fields: Field[], native: boolean): FormData | RezoFormData {
  const form = native ? new FormData() : new RezoFormData();
  for (const [key, value] of fields) {
    if (typeof value === 'string') form.append(key, value);
    else form.append(key, new Blob([Uint8Array.from(value.bytes)], { type: value.type }), value.name);
  }
  return form;
}

async function receivedFields(record: BodyRecord): Promise<Field[]> {
  expect(record.contentType).toMatch(/^multipart\/form-data;\s*boundary=.+/);
  const form = await new Response(Uint8Array.from(record.bytes), {
    headers: { 'Content-Type': record.contentType! },
  }).formData();
  // Bun's FormData parser can infer a file type from its filename, replacing
  // the received MIME type. Check that header directly on the wire instead.
  const boundary = record.contentType!.match(/boundary=(?:"([^"]+)"|([^;]+))/)!;
  const parts = Buffer.from(record.bytes).toString('latin1').split(`--${boundary[1] ?? boundary[2]}`).slice(1, -1);
  const fields: Field[] = [];
  for (const [key, value] of form) {
    const partHeaders = parts[fields.length].split('\r\n\r\n', 1)[0];
    fields.push([key, typeof value === 'string' ? value : {
      name: value.name, type: partHeaders.match(/\r\nContent-Type: ([^\r\n]+)/i)![1],
      bytes: Array.from(new Uint8Array(await value.arrayBuffer())),
    }]);
  }
  expect(parts).toHaveLength(fields.length);
  if (record.contentLength !== undefined) expect(Number(record.contentLength)).toBe(record.bytes.length);
  return fields;
}

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter], ['curl', curl]] as const) {
  describe(`${name} multipart wire integrity`, () => {
    let receiver: Awaited<ReturnType<typeof rawBodyReceiver>>;
    const client = new Rezo({ cache: false, retry: false, disableJar: true, keepAlive: false }, adapter);
    beforeAll(async () => {
      receiver = await rawBodyReceiver(adapter === http2, (record, records) => {
        if (record.path.startsWith('/303-retry/')) {
          return { status: 303, headers: { location: `/retry/${record.path.slice(1)}` } };
        }
        if (/^\/(303|307|308)\//.test(record.path)) {
          return { status: Number(record.path.slice(1, 4)), headers: { location: '/final' } };
        }
        if (record.path.startsWith('/retry/') && records.filter(r => r.path === record.path).length === 1) {
          return { status: 503 };
        }
        return { status: 200 };
      });
    });
    afterAll(async () => {
      client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool();
      await receiver?.close();
    });
    for (const native of [true, false]) {
      const kind = native ? 'native' : 'Rezo';
      for (const sample of cases) {
        it(`${kind}: ${sample.name}`, async () => {
          const response = await client.request<BodyRecord>({
            url: receiver.url, method: 'POST', body: formBody(sample.fields, native),
            responseType: 'json', timeout: 2000,
          });
          expect(response.data.method).toBe('POST');
          expect(await receivedFields(response.data)).toEqual(sample.fields);
        });
      }
      it(`${kind}: concurrent form reuse preserves every file`, async () => {
        const body = formBody(cases[0].fields, native);
        const responses = await Promise.all(Array.from({ length: 4 }, () => client.request<BodyRecord>({
          url: receiver.url, method: 'POST', body, responseType: 'json', timeout: 2000,
        })));
        for (const response of responses) expect(await receivedFields(response.data)).toEqual(cases[0].fields);
      });
      if (adapter === http2 || adapter === curl) {
        for (const status of [303, 307, 308, 'retry']) {
          it(`${kind}: ${status} preserves the multipart contract`, async () => {
            const before = receiver.records.length;
            const response = await client.request<BodyRecord>({
              url: `${receiver.url}/${status}/${kind}`, method: 'PUT',
              body: formBody(cases[0].fields, native), responseType: 'json', timeout: 2000,
              retry: { maxRetries: 1, retryDelay: 1, retryOn: [503], statusCodes: [503] },
            });
            const records = receiver.records.slice(before);
            expect(records).toHaveLength(2);
            expect(await receivedFields(records[0])).toEqual(cases[0].fields);
            if (status === 303) {
              expect(response.data.method).toBe('GET');
              expect(response.data.bytes).toEqual([]);
              expect(response.data.contentType).toBeUndefined();
            } else {
              expect(response.data.method).toBe('PUT');
              expect(await receivedFields(response.data)).toEqual(cases[0].fields);
            }
          });
        }
        it(`${kind}: retry after a 303 does not restore the dropped body`, async () => {
          const before = receiver.records.length;
          await client.request<BodyRecord>({
            url: `${receiver.url}/303-retry/${kind}`, method: 'PUT', body: formBody(cases[0].fields, native),
            responseType: 'json', timeout: 2000,
            retry: { maxRetries: 1, retryDelay: 1, retryOn: [503], statusCodes: [503] },
          });
          const records = receiver.records.slice(before);
          expect(records).toHaveLength(3);
          expect(await receivedFields(records[0])).toEqual(cases[0].fields);
          for (const record of records.slice(1)) {
            expect(record.method).toBe('GET');
            expect(record.bytes).toEqual([]);
            expect(record.contentType).toBeUndefined();
          }
        });
      }
    }
    if (adapter === fetchAdapter) {
      for (const sample of cases) {
        it(`independent native Fetch control: ${sample.name}`, async () => {
          const response = await fetch(receiver.url, {
            method: 'POST', body: formBody(sample.fields, true) as FormData,
            signal: AbortSignal.timeout(2000),
          });
          expect(await receivedFields(await response.json() as BodyRecord)).toEqual(sample.fields);
        });
      }
    }
  });
}
