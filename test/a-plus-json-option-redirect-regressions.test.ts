// Approved JSON replay follow-up: PLAN/tayo-terminal-a-plus-implementation-plan.md.
// Public core + unwrapped Fetch adapter + real localhost on the executing host.
// No browser, HTTP/2, cURL, cross-origin, or other-adapter qualification is implied.
import { describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch.js';
import type { OnRedirectOptions } from '../src/types/rezo-request.js';
import {
  withJsonRedirectLoopback, type JsonRedirectFixture, type JsonRedirectRecord,
} from './fixtures/json-redirect-loopback.js';

const jsonBytes = '{"marker":"redirect-json-control","value":1}';
const payload = () => ({ marker: 'redirect-json-control', value: 1 });
const requestOptions = () => ({
  method: 'POST' as const, responseType: 'text' as const, cache: false,
  timeout: 2000, keepAlive: false, retry: false as const, disableJar: true,
});
const rowId = (value: number) => `JR-C${String(value).padStart(2, '0')}`;

function hop(index: number, body: string, contentType = 'application/json'): JsonRedirectRecord {
  return { path: `/hop/${index}`, method: 'POST', contentType, bodyBytes: Array.from(Buffer.from(body)) };
}

async function withClient(
  redirects: readonly (307 | 308)[],
  run: (client: Rezo, fixture: JsonRedirectFixture) => Promise<void>,
) {
  await withJsonRedirectLoopback(redirects, async (fixture) => {
    const client = new Rezo(requestOptions(), fetchAdapter);
    try {
      await run(client, fixture);
    } finally {
      client.destroy();
    }
  });
}

describe('JSON option replay through real Fetch redirects', () => {
  for (const [index, status] of ([307, 308] as const).entries()) {
    it(`JR-0${index + 1} ${status} callback sees and replays the once-serialized JSON body`, async () => {
      await withClient([status], async (client, { url, seen }) => {
        let serializations = 0;
        const callbackBodies: unknown[] = [];
        const json = { toJSON() { return { marker: 'redirect-json-control', value: ++serializations }; } };
        const result = await client.request({
          ...requestOptions(), url, json,
          onRedirect: (context) => {
            callbackBodies.push(context.body);
            return { redirect: true, url: context.url.href };
          },
        });
        expect({ status: result.status, data: result.data, serializations, callbackBodies, seen }).toEqual({
          status: 200, data: 'redirect-complete', serializations: 1,
          callbackBodies: [jsonBytes], seen: [hop(0, jsonBytes), hop(1, jsonBytes)],
        });
      });
    }, 7000);

    it(`${rowId(3 + index)} CONTROL ${status} plain JSON redirect preserves both wire bodies`, async () => {
      await withClient([status], async (client, { url, seen }) => {
        const result = await client.request({ ...requestOptions(), url, json: payload() });
        expect({ status: result.status, data: result.data, seen }).toEqual({
          status: 200, data: 'redirect-complete', seen: [hop(0, jsonBytes), hop(1, jsonBytes)],
        });
      });
    }, 7000);

    for (const callback of [false, true]) {
      it(`${rowId((callback ? 7 : 5) + index)} CONTROL ${status} ${callback ? 'callback' : 'plain'} explicit-body twin`, async () => {
        await withClient([status], async (client, { url, seen }) => {
          const callbackBodies: unknown[] = [];
          const onRedirect = callback ? (context: OnRedirectOptions) => {
            callbackBodies.push(context.body);
            return { redirect: true as const, url: context.url.href };
          } : undefined;
          const result = await client.request({ ...requestOptions(), url, body: jsonBytes, onRedirect });
          expect({ status: result.status, data: result.data, callbackBodies, seen }).toEqual({
            status: 200, data: 'redirect-complete', callbackBodies: callback ? [jsonBytes] : [],
            seen: [hop(0, jsonBytes), hop(1, jsonBytes)],
          });
        });
      }, 7000);
    }

    it(`${rowId(9 + index)} CONTROL ${status} explicit body plus json keeps the explicit replay identity`, async () => {
      await withClient([status], async (client, { url, seen }) => {
        const body = '{ "source": "explicit-twin" }';
        const callbackBodies: unknown[] = [];
        const result = await client.request({
          ...requestOptions(), url, body,
          json: { toJSON() { throw new Error('Explicit body must bypass JSON serialization'); } },
          onRedirect: (context) => {
            callbackBodies.push(context.body);
            return { redirect: true, url: context.url.href };
          },
        });
        expect({ status: result.status, data: result.data, callbackBodies, seen }).toEqual({
          status: 200, data: 'redirect-complete', callbackBodies: [body],
          seen: [hop(0, body), hop(1, body)],
        });
      });
    }, 7000);

    it(`${rowId(11 + index)} CONTROL ${status} removal survives another callback without resurrecting json`, async () => {
      await withClient([status, status], async (client, { url, seen }) => {
        const callbackBodies: unknown[] = [];
        const result = await client.request({
          ...requestOptions(), url, json: payload(),
          onRedirect: (context) => {
            callbackBodies.push(context.body);
            return { redirect: true, url: context.url.href, withoutBody: callbackBodies.length === 1 };
          },
        });
        // Initial callback visibility is the desired-property row above; this
        // control independently pins committed removal on the following hop.
        expect({ status: result.status, data: result.data, calls: callbackBodies.length,
          laterBodies: callbackBodies.slice(1), seen }).toEqual({
          status: 200, data: 'redirect-complete', calls: 2, laterBodies: [undefined],
          seen: [hop(0, jsonBytes), hop(1, '', ''), hop(2, '', '')],
        });
      });
    }, 7000);

    for (const replacement of ['{ "source": "callback-override" }', '']) {
      it(`${rowId((replacement ? 13 : 15) + index)} CONTROL ${status} ${replacement ? 'replacement' : 'empty-string override'} remains the next replay body`, async () => {
        await withClient([status, status], async (client, { url, seen }) => {
          const callbackBodies: unknown[] = [];
          const result = await client.request({
            ...requestOptions(), url, json: payload(),
            onRedirect: (context) => {
              callbackBodies.push(context.body);
              return callbackBodies.length === 1
                ? { redirect: true, url: context.url.href, body: replacement }
                : { redirect: true, url: context.url.href };
            },
          });
          expect({ status: result.status, data: result.data, calls: callbackBodies.length,
            laterBodies: callbackBodies.slice(1), seen }).toEqual({
            status: 200, data: 'redirect-complete', calls: 2, laterBodies: [replacement],
            seen: [hop(0, jsonBytes), hop(1, replacement), hop(2, replacement)],
          });
        });
      }, 7000);
    }
  }
});
