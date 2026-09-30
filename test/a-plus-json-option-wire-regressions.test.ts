// Approved bounded JSON-only repair: PLAN/tayo-terminal-a-plus-implementation-plan.md.
// Real core + unwrapped built-in HTTP adapter, synthetic loopback receiver.
// This does not qualify other adapters, redirects, callable forms or all JSON values.
import { describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import { executeRequest as httpAdapter } from '../src/adapters/http.js';
import { withJsonBodyLoopback, type BodyWireRecord, type JsonBodyFixture } from './fixtures/json-body-loopback.js';

function payload() {
  return { label: 'café', nested: { active: true }, values: [1, 2, 3] };
}

const expectedJson = '{"label":"café","nested":{"active":true},"values":[1,2,3]}';

function requestOptions() {
  return {
    responseType: 'json' as const, cache: false, timeout: 2000,
    keepAlive: false, retry: false as const,
  };
}

function expectedRecord(method: string, body = expectedJson): BodyWireRecord {
  return {
    path: '/json-body', method, contentType: 'application/json',
    bodyBytes: Array.from(Buffer.from(body, 'utf8')),
  };
}

async function withClient(run: (client: Rezo, fixture: JsonBodyFixture) => Promise<void>) {
  await withJsonBodyLoopback(async (fixture) => {
    const client = new Rezo({ cache: false, disableJar: true, keepAlive: false, retry: false }, httpAdapter);
    try {
      await run(client, fixture);
    } finally {
      client.destroy();
    }
  });
}

describe('JSON option body through real HTTP', () => {
  for (const [index, method] of (['POST', 'PUT', 'PATCH'] as const).entries()) {
    it(`JW-0${index + 1} request({ json }) ${method} transmits exact JSON bytes and Content-Type`, async () => {
      await withClient(async (client, { url, seen }) => {
        const result = await client.request({ ...requestOptions(), url, method, json: payload() });
        const expected = expectedRecord(method);
        expect({ status: result.status, seen }).toEqual({ status: 200, seen: [expected] });
        expect(result.data).toEqual(expected);
      });
    }, 7000);
  }

  for (const [id, method] of [['JW-C04', 'post'], ['JW-C05', 'postJson']] as const) {
    it(`${id} CONTROL ${method}(url, data, options) already transmits JSON`, async () => {
      await withClient(async (client, { url, seen }) => {
        // The second argument is positional body data; options are third.
        const result = method === 'post'
          ? await client.post(url, payload(), requestOptions())
          : await client.postJson(url, payload(), requestOptions());
        const expected = expectedRecord('POST');
        expect({ status: result.status, seen }).toEqual({ status: 200, seen: [expected] });
        expect(result.data).toEqual(expected);
      });
    }, 7000);
  }

  it('JW-C06 CONTROL explicit string body wins over the json option unchanged', async () => {
    await withClient(async (client, { url, seen }) => {
      const body = '{ "source": "explicit-string", "text": "café" }';
      const result = await client.request({
        ...requestOptions(), url, method: 'POST', json: payload(), body,
      });
      const expected = expectedRecord('POST', body);
      expect({ status: result.status, seen }).toEqual({ status: 200, seen: [expected] });
      expect(result.data).toEqual(expected);
    });
  }, 7000);

  it('JW-07 circular json rejects once through beforeError before any receiver arrival', async () => {
    await withClient(async (client, { url, seen }) => {
      const json: { label: string; self?: unknown } = { label: 'circular-fixture' };
      json.self = json;
      let beforeErrors = 0;
      const outcome = await client.request({
        ...requestOptions(), url, method: 'POST', json,
        hooks: { beforeError: [(error) => { beforeErrors += 1; return error; }] },
      }).then(
        () => ({ rejected: false, typeError: false }),
        (error: unknown) => ({ rejected: true, typeError: error instanceof TypeError }),
      );
      expect({ ...outcome, beforeErrors, seen }).toEqual({
        rejected: true, typeError: true, beforeErrors: 1, seen: [],
      });
    });
  }, 7000);
});
