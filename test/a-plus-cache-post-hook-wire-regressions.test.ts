// Supporting RED for finalized request identity (D068/D076).
// Real core + built-in HTTP requests, not an injected counting/mock adapter.
// Only synthetic loopback data; no TLS, persistence or other-adapter claim.
// A→B lookup separation only; changed-state reuse/write identity and missing
// Vary are not covered. The fixture always declares Vary: Authorization.
import { describe, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import { executeRequest as httpAdapter } from '../src/adapters/http.js';
import { RezoHeaders } from '../src/utils/headers.js';
import type { RezoRequestOptions } from '../src/types/rezo-request.js';
import type { RezoConfig } from '../src/types/rezo-config.js';
import { withLoopback, type WireRecord } from './fixtures/cache-post-hook-loopback.js';

const seedRecord: WireRecord = { path: '/initial', method: 'GET', marker: 'fixture-tenant-A' };

interface HookCase {
  id: string;
  name: string;
  mutate(config: RezoConfig, origin: string): void;
  expected: WireRecord;
  text?: boolean;
}

const cases: HookCase[] = [
  {
    id: 'PHW-01', name: 'URL', expected: { ...seedRecord, path: '/retargeted' },
    mutate(config, origin) { config.url = `${origin}/retargeted`; },
  },
  {
    id: 'PHW-02', name: 'method', expected: { ...seedRecord, method: 'POST' },
    mutate(config) { config.method = 'POST'; },
  },
  {
    id: 'PHW-03', name: 'Authorization', expected: { ...seedRecord, marker: 'fixture-tenant-B' },
    mutate(config) {
      const headers = new RezoHeaders(config.headers);
      headers.set('authorization', 'fixture-tenant-B');
      config.headers = headers;
    },
  },
  {
    id: 'PHW-04', name: 'responseType', expected: { ...seedRecord }, text: true,
    mutate(config) { config.responseType = 'text'; },
  },
];

function requestOptions(origin: string, cache: boolean): RezoRequestOptions & { responseType: 'json' } {
  return {
    url: `${origin}/initial`, method: 'GET', responseType: 'json', cache,
    timeout: 2000, keepAlive: false, retry: false,
    headers: { authorization: 'fixture-tenant-A', accept: 'application/json' },
  };
}

describe('post-hook cache identity through real HTTP', () => {
  for (const row of cases) {
    for (const cache of [true, false]) {
      it(`${row.id}${cache ? '' : '-C'} ${cache ? 'separates' : 'CONTROL wire applies'} changed ${row.name}`, async () => {
        await withLoopback(async ({ origin, seen }) => {
          let changed = false;
          let hookCalls = 0;
          const client = new Rezo({
            cache, disableJar: true, keepAlive: false, retry: false,
            hooks: {
              beforeRequest: [(config: RezoConfig) => {
                hookCalls += 1;
                if (changed) row.mutate(config, origin);
              }],
            },
          }, httpAdapter);
          try {
            const seed = await client.request(requestOptions(origin, cache));
            expect({ data: seed.data, seen: [...seen], hookCalls })
              .toEqual({ data: seedRecord, seen: [seedRecord], hookCalls: 1 });
            changed = true;
            // A fresh caller config ensures the second request differs only
            // through the hook, not through source mutation of the seed input.
            const result = await client.request(requestOptions(origin, cache));
            const data = row.text ? JSON.stringify(row.expected) : row.expected;
            const fromCache = '_fromCache' in result && result._fromCache === true;
            expect({ data: result.data, seen: [...seen], hookCalls, fromCache })
              .toEqual({ data, seen: [seedRecord, row.expected], hookCalls: 2, fromCache: false });
          } finally {
            client.destroy();
          }
        });
      }, 10000);
    }
  }

  it('PHW-C05 CONTROL identical finalized request still hits and runs its hook', async () => {
    await withLoopback(async ({ origin, seen }) => {
      let hookCalls = 0;
      const client = new Rezo({
        cache: true, disableJar: true, keepAlive: false, retry: false,
        hooks: { beforeRequest: [() => { hookCalls += 1; }] },
      }, httpAdapter);
      try {
        const seed = await client.request(requestOptions(origin, true));
        expect({ data: seed.data, seen: [...seen], hookCalls })
          .toEqual({ data: seedRecord, seen: [seedRecord], hookCalls: 1 });
        const result = await client.request(requestOptions(origin, true));
        const fromCache = '_fromCache' in result && result._fromCache === true;
        expect({ data: result.data, seen: [...seen], hookCalls, fromCache })
          .toEqual({ data: seedRecord, seen: [seedRecord], hookCalls: 2, fromCache: true });
      } finally {
        client.destroy();
      }
    });
  }, 10000);
});
