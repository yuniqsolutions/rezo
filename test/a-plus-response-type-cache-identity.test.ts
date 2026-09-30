// Response-cache identity, tenant isolation, and backend conformance
// (DECISION-063 C, carrier 4 — DECISION-070 r2 option A).
//
// A cached entry may only ever be served back to a request that would have
// produced it. Today both backends key an entry by method + URL plus at most
// `accept`/`accept-encoding`, so:
//
//   * tenant A's private body is served to tenant B at the same URL whenever
//     only credentials differ — proven below on BOTH implementations, with
//     and without a server `Vary: authorization`; and
//   * two different response representations of the same URL (json vs text,
//     and every alias/`auto` distinction) collide on one entry.
//
// The ruled identity is
//   version + uppercase method + exact URL + canonical buffered mode +
//   digest(complete effective request-header multimap)
// with `Vary: *` uncacheable and every variant removed by one `invalidate`.
//
// RED-first on the pre-C bytes. CI-06 and CI-12 are the positive controls: an
// identical request must still HIT, and an unrelated URL must survive
// invalidation — so a leak row can never be an artifact of a cache that
// simply never stores anything.
import { describe, expect, it } from 'vitest';
import { ResponseCache } from '../src/cache/response-cache.js';
import { UniversalResponseCache } from '../src/cache/universal-response-cache.js';
import { createResponseCacheIdentity } from '../src/cache/response-cache-identity.js';
import type { RezoResponse } from '../src/types/response.js';

const URL_A = 'https://example.invalid/tenant-resource';
const URL_PREFIX_SIBLING = 'https://example.invalid/tenant-resource-2';

const TENANT_A_HEADERS = { authorization: 'Bearer tenant-A-secret', accept: 'application/json' };
const TENANT_B_HEADERS = { authorization: 'Bearer tenant-B-secret', accept: 'application/json' };

/** A cacheable response carrying a tenant-identifying body. */
function tenantResponse(tenant: string, extraHeaders: Record<string, string> = {}): RezoResponse {
  return {
    data: { tenant },
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300', ...extraHeaders },
    config: {},
  } as unknown as RezoResponse;
}

/** Both backends expose the same three operations used by these rows. */
interface CacheLike {
  get(method: string, url: string, headers?: Record<string, string>): { data?: unknown } | undefined | null;
  set(method: string, url: string, response: RezoResponse, headers?: Record<string, string>): unknown;
}

const BACKENDS: ReadonlyArray<readonly [string, () => CacheLike]> = [
  ['ResponseCache (Node)', () => new ResponseCache(true) as unknown as CacheLike],
  ['UniversalResponseCache (browser/RN)', () => new UniversalResponseCache(true) as unknown as CacheLike],
];

/** The body a second tenant observes for the same URL, or `null` on a miss. */
function crossTenantRead(
  makeCache: () => CacheLike,
  responseHeaders: Record<string, string> = {},
): unknown {
  const cache = makeCache();
  cache.set('GET', URL_A, tenantResponse('tenant-A', responseHeaders), TENANT_A_HEADERS);
  const seen = cache.get('GET', URL_A, TENANT_B_HEADERS);
  return (seen as { data?: { tenant?: string } })?.data?.tenant ?? null;
}

describe('response-cache identity and tenant isolation', () => {
  it('CI-01 a different Authorization never reads another tenant’s cached body (both backends)', () => {
    for (const [name, makeCache] of BACKENDS) {
      expect({ backend: name, crossedData: crossTenantRead(makeCache) })
        .toEqual({ backend: name, crossedData: null });
    }
  });

  it('CI-02 a declared Vary: authorization does not rescue the leak either', () => {
    for (const [name, makeCache] of BACKENDS) {
      expect({ backend: name, crossedData: crossTenantRead(makeCache, { vary: 'authorization' }) })
        .toEqual({ backend: name, crossedData: null });
    }
  });

  it('CI-03 a custom tenant header (X-API-Key) separates entries even when the server omits Vary', () => {
    for (const [name, makeCache] of BACKENDS) {
      const cache = makeCache();
      cache.set('GET', URL_A, tenantResponse('tenant-A'), { 'x-api-key': 'key-A', accept: 'application/json' });
      const seen = cache.get('GET', URL_A, { 'x-api-key': 'key-B', accept: 'application/json' });
      expect({ backend: name, crossedData: (seen as { data?: { tenant?: string } })?.data?.tenant ?? null })
        .toEqual({ backend: name, crossedData: null });
    }
  });

  it('CI-04 a different Cookie separates entries', () => {
    for (const [name, makeCache] of BACKENDS) {
      const cache = makeCache();
      cache.set('GET', URL_A, tenantResponse('tenant-A'), { cookie: 'sid=A', accept: 'application/json' });
      const seen = cache.get('GET', URL_A, { cookie: 'sid=B', accept: 'application/json' });
      expect({ backend: name, crossedData: (seen as { data?: { tenant?: string } })?.data?.tenant ?? null })
        .toEqual({ backend: name, crossedData: null });
    }
  });

  it('CI-05 two representations of the same URL never collide (json vs text)', () => {
    // The canonical buffered mode is part of the identity, so a `text` request
    // must not be served the parsed `json` entry stored for the same URL.
    for (const [name, makeCache] of BACKENDS) {
      const cache = makeCache();
      const headers = { authorization: 'Bearer same', accept: 'application/json' };
      cache.set('GET', URL_A, tenantResponse('json-representation'), headers);
      // A different representation of the same request identity: today the key
      // ignores the mode entirely, so the json entry is returned verbatim.
      const seenAsText = cache.get('GET', URL_A, { ...headers, accept: 'text/plain' });
      expect({ backend: name, crossed: (seenAsText as { data?: { tenant?: string } })?.data?.tenant ?? null })
        .toEqual({ backend: name, crossed: null });
    }
  });

  it('CI-13 the ambient-credential decision separates entries (browser cookies are never in the header map)', () => {
    // In a browser the cookies that authenticate a request are attached by the
    // user agent, not by us: they never appear in the request-header multimap
    // the identity digests. So a credentialed request and an anonymous one for
    // the same URL, with identical explicit headers, currently produce the SAME
    // identity — and the anonymous caller can be served the authenticated body.
    // The effective credential scope must therefore be part of the identity.
    const credentialed = createResponseCacheIdentity({
      method: 'GET', url: URL_A, mode: 'json', headers: { accept: 'application/json' }, credentials: 'include',
    });
    const anonymous = createResponseCacheIdentity({
      method: 'GET', url: URL_A, mode: 'json', headers: { accept: 'application/json' }, credentials: 'omit',
    });

    expect(credentialed === anonymous ? 'shared' : 'separate').toBe('separate');
  });

  it('CI-14 CONTROL: the same credential scope still produces one identity', () => {
    // Non-vacuity for CI-13: separation must come from the scope differing, not
    // from the identity having become unstable.
    const first = createResponseCacheIdentity({
      method: 'GET', url: URL_A, mode: 'json', headers: { accept: 'application/json' }, credentials: 'include',
    });
    const second = createResponseCacheIdentity({
      method: 'GET', url: URL_A, mode: 'json', headers: { accept: 'application/json' }, credentials: 'include',
    });

    expect(first).toBe(second);
  });

  // MODE-IDENTITY COVERAGE IS OWED, NOT PRESENT. CI-05 above varies `Accept`,
  // so the complete-header digest alone forces its miss — it would stay GREEN
  // even though the mode is currently absent from every identity (both public
  // backends hard-code `mode: null`, and nothing consumes the bound view).
  //
  // A row was drafted here that held the headers identical and expected a miss,
  // marked `it.fails`. It was removed: with no mode on either operation it is
  // an identical unbound lookup that SHOULD hit, so no honest fix could ever
  // flip it, and the marker hid that contradiction rather than recording a gap.
  //
  // The real row needs two genuinely different canonical modes carried through
  // whichever transport DECISION-075 selects, plus a same-mode hit control. It
  // is written once that is ruled. Until then, "carriers GREEN" must not be
  // read as mode-identity coverage.

  it('CI-06 CONTROL: an identical request still HITS on both backends', () => {
    for (const [name, makeCache] of BACKENDS) {
      const cache = makeCache();
      cache.set('GET', URL_A, tenantResponse('tenant-A'), TENANT_A_HEADERS);
      const seen = cache.get('GET', URL_A, TENANT_A_HEADERS);
      expect({ backend: name, data: (seen as { data?: { tenant?: string } })?.data?.tenant ?? null })
        .toEqual({ backend: name, data: 'tenant-A' });
    }
  });

  it('CI-07 invalidate(url) removes every header variant for that URL', () => {
    const cache = new ResponseCache(true);
    cache.set('GET', URL_A, tenantResponse('tenant-A'), TENANT_A_HEADERS);
    cache.set('GET', URL_A, tenantResponse('tenant-B'), TENANT_B_HEADERS);
    cache.set('GET', URL_PREFIX_SIBLING, tenantResponse('sibling'), TENANT_A_HEADERS);

    (cache as unknown as { invalidate(url: string, method?: string): void }).invalidate(URL_A);

    const remainingA = cache.get('GET', URL_A, TENANT_A_HEADERS);
    const remainingB = cache.get('GET', URL_A, TENANT_B_HEADERS);
    const sibling = cache.get('GET', URL_PREFIX_SIBLING, TENANT_A_HEADERS);

    expect({
      variantA: remainingA ? 'present' : 'removed',
      variantB: remainingB ? 'present' : 'removed',
      // CONTROL half: a prefix-related URL must survive.
      sibling: sibling ? 'present' : 'removed',
    }).toEqual({ variantA: 'removed', variantB: 'removed', sibling: 'present' });
  });

  it('CI-08 Vary: * is never cacheable', () => {
    for (const [name, makeCache] of BACKENDS) {
      const cache = makeCache();
      cache.set('GET', URL_A, tenantResponse('tenant-A', { vary: '*' }), TENANT_A_HEADERS);
      const seen = cache.get('GET', URL_A, TENANT_A_HEADERS);
      expect({ backend: name, stored: seen ? 'present' : 'absent' })
        .toEqual({ backend: name, stored: 'absent' });
    }
  });

  it('CI-09 UniversalResponseCache implements the declared public Node contract', () => {
    const universal = new UniversalResponseCache(true) as unknown as Record<string, unknown>;
    const node = new ResponseCache(true) as unknown as Record<string, unknown>;

    const missing = ['invalidate', 'isEnabled', 'isPersistent', 'getConfig']
      .filter((member) => typeof universal[member] !== typeof node[member]);

    // `size` is a getter on the declared contract, not a method.
    const universalSizeIsGetter = typeof universal.size === 'number';
    const nodeSizeIsGetter = typeof node.size === 'number';

    expect({ missing, universalSizeIsGetter, nodeSizeIsGetter })
      .toEqual({ missing: [], universalSizeIsGetter: true, nodeSizeIsGetter: true });
  });

  it('CI-10 getConditionalHeaders returns the same shape on both backends', () => {
    const node = new ResponseCache(true);
    const universal = new UniversalResponseCache(true);
    node.set('GET', URL_A, tenantResponse('tenant-A', { etag: '"v1"' }), TENANT_A_HEADERS);
    universal.set('GET', URL_A, tenantResponse('tenant-A', { etag: '"v1"' }), TENANT_A_HEADERS);

    const nodeHeaders = node.getConditionalHeaders('GET', URL_A, TENANT_A_HEADERS);
    const universalHeaders = universal.getConditionalHeaders('GET', URL_A, TENANT_A_HEADERS);

    // One API everywhere: the same call must not return a header map on one
    // runtime and an `{ etag, lastModified }` record on another.
    expect({
      node: nodeHeaders === undefined || nodeHeaders === null ? 'empty' : Object.keys(nodeHeaders).sort(),
      universal: universalHeaders === undefined || universalHeaders === null ? 'empty' : Object.keys(universalHeaders).sort(),
    }).toEqual({
      node: ['If-None-Match'],
      universal: ['If-None-Match'],
    });
  });
});
