// Persistent response-cache readiness, ordering, and hydration integrity
// (DECISION-063 C, carrier 8 — Phase 6).
//
// RED-first against the pre-Phase-6 source. The opening defect is that the
// persistent cache never persists at all on this runtime: `ResponseCache`
// resolves `node:fs` through `Function('return typeof require ...')()`, which
// is `undefined` in an ESM module, so `persistenceEnabled` is false and every
// write and hydrate path returns early — silently, with `cacheDir` accepted.
// `package.json` sends `deno`, `bun`, and every `default` condition to the ESM
// build, so that is the shipped path for most consumers.
//
// Behind that, two more defects are unobservable until persistence runs:
// `onEvict` is wired to `persistToDisk` while `LRUCache` fires `onEvict` on
// delete and clear, so removing an entry would WRITE it to disk; and the final
// file is produced by a direct `writeFile`, so an interrupted write leaves a
// torn artifact where a complete entry is supposed to be.
//
// PC-10 and PC-11 are the positive controls: ordinary memory caching keeps
// working with no `cacheDir`, and "persistence was never requested" stays
// distinguishable from "persistence was requested and could not be honoured".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { ResponseCache } from '../src/cache/response-cache.js';
import { bindResponseCache } from '../src/cache/bound-response-cache.js';
import { createResponseCacheIdentity, sha256Hex } from '../src/cache/response-cache-identity.js';
import { cachePersistence } from '../src/cache/response-cache-readiness.js';
import { RezoError } from '../src/errors/rezo-error.js';
import type { RezoResponse } from '../src/types/response.js';

const URL_A = 'https://example.invalid/persisted-resource';
const URL_B = 'https://example.invalid/persisted-sibling';
const HEADERS = { authorization: 'Bearer tenant-secret', accept: 'application/json' };

/** The lease filename the store owns; kept in one place for these rows. */
const LEASE_FILE = '.rezo-cache-lease.json';

const temporaryDirectories: string[] = [];

function makeCacheDir(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `rezo-cache-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function cacheableResponse(tag: string): RezoResponse {
  return {
    data: { tag },
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
    config: {},
  } as unknown as RezoResponse;
}

interface PersistentCacheLike {
  get(method: string, url: string, headers?: Record<string, string>): { data?: unknown } | undefined | null;
  set(method: string, url: string, response: RezoResponse, headers?: Record<string, string>): unknown;
  invalidate(url: string, method?: string): void;
  clear(): void;
  readonly isPersistent: boolean;
}

function makeCache(cacheDir: string | undefined, extra: Record<string, unknown> = {}): PersistentCacheLike {
  return new ResponseCache({
    enable: true,
    ttl: 60_000,
    ...(cacheDir === undefined ? {} : { cacheDir }),
    ...extra,
  } as never) as unknown as PersistentCacheLike;
}

/**
 * Waits for the cache's own persistence readiness rather than for a fixed
 * delay, so a row can never pass because a sleep happened to be long enough.
 * Falls back to a bounded poll on the pre-Phase-6 source, which exposes no
 * readiness oracle at all.
 */
async function whenSettled(cache: PersistentCacheLike): Promise<void> {
  const persistence = cachePersistence(cache as unknown as object);
  if (persistence) {
    // Two drains: the first lets hydration and any queued write finish, the
    // second covers work the first one scheduled.
    await persistence.drain();
    await persistence.drain();
    return;
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function listing(directory: string): string[] {
  return readdirSync(directory).filter((entry) => !entry.startsWith('.'));
}

/** A cacheable response carrying an arbitrary body. */
function cacheableBody(body: unknown): RezoResponse {
  return {
    data: body,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'max-age=300' },
    config: {},
  } as unknown as RezoResponse;
}

/** Names what came back when it is not the type the row expected. */
function describeKind(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return `object(${Object.keys(value as object).slice(0, 3).join(',')})`;
}

describe('persistent response cache — readiness, ordering, hydration integrity', () => {
  it('PC-01 a configured cacheDir actually persists an accepted set on this runtime', async () => {
    const directory = makeCacheDir('persists');
    const cache = makeCache(directory);
    await whenSettled(cache);

    cache.set('GET', URL_A, cacheableResponse('stored'), HEADERS);
    await whenSettled(cache);

    expect({ files: listing(directory).length, persistent: cache.isPersistent })
      .toEqual({ files: 1, persistent: true });
  });

  it('PC-02 a restart on the same directory hydrates and serves the entry', async () => {
    const directory = makeCacheDir('restart');
    const first = makeCache(directory);
    await whenSettled(first);
    first.set('GET', URL_A, cacheableResponse('survives-restart'), HEADERS);
    await whenSettled(first);

    const second = makeCache(directory);
    await whenSettled(second);
    const seen = second.get('GET', URL_A, HEADERS);

    expect((seen as { data?: { tag?: string } })?.data?.tag ?? null).toBe('survives-restart');
  });

  it('PC-03 clear() removes the artifacts instead of writing the entries it is removing', async () => {
    const directory = makeCacheDir('clear');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('one'), HEADERS);
    cache.set('GET', URL_B, cacheableResponse('two'), HEADERS);
    await whenSettled(cache);
    const before = listing(directory).length;

    cache.clear();
    await whenSettled(cache);

    // `LRUCache` fires `onEvict` for every entry on clear, and `onEvict` is
    // wired to `persistToDisk`: clearing must not be a way to write the whole
    // cache to disk.
    expect({ before, after: listing(directory).length }).toEqual({ before: 2, after: 0 });
  });

  it('PC-04 invalidate() removes the artifact and a restart cannot resurrect it', async () => {
    const directory = makeCacheDir('invalidate');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('doomed'), HEADERS);
    cache.set('GET', URL_B, cacheableResponse('kept'), HEADERS);
    await whenSettled(cache);

    cache.invalidate(URL_A);
    await whenSettled(cache);

    const revived = makeCache(directory);
    await whenSettled(revived);

    expect({
      invalidated: revived.get('GET', URL_A, HEADERS) ? 'resurrected' : 'gone',
      // CONTROL half: an unrelated entry must survive the invalidation.
      sibling: (revived.get('GET', URL_B, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ invalidated: 'gone', sibling: 'kept' });
  });

  it('PC-05 a capacity eviction does not write an entry back to disk', async () => {
    const directory = makeCacheDir('evict');
    const cache = makeCache(directory, { maxEntries: 1 });
    await whenSettled(cache);

    cache.set('GET', URL_A, cacheableResponse('first'), HEADERS);
    await whenSettled(cache);
    // Remove the artifact out of band, then force the entry out of memory.
    for (const file of listing(directory)) rmSync(join(directory, file));
    cache.set('GET', URL_B, cacheableResponse('second'), HEADERS);
    await whenSettled(cache);

    // Only an explicit accepted set or revalidation may persist. If eviction
    // still persists, the deleted artifact for URL_A reappears here.
    const files = listing(directory);
    expect({ count: files.length }).toEqual({ count: 1 });
  });

  it('PC-06 the final artifact is published by an atomic rename, never a direct write', async () => {
    const directory = makeCacheDir('atomic');
    const renameSpy = vi.spyOn(nodeFs.promises, 'rename');
    const writeSpy = vi.spyOn(nodeFs.promises, 'writeFile');

    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('atomic'), HEADERS);
    await whenSettled(cache);

    // The store canonicalises its directory, and on macOS `/var/...` realpaths
    // to `/private/var/...`. Filtering the spy by the TEST's path therefore
    // discarded every recorded write, so `directFinalWrites` was structurally
    // always 0 and this row could not fail — it passed a mutant that wrote
    // straight to the final path. Compare against the path the store uses.
    const canonical = realpathSync(directory);
    const targets = writeSpy.mock.calls.map((call) => String(call[0]))
      .filter((target) => target.startsWith(canonical));
    const renameTargets = renameSpy.mock.calls.map((call) => String(call[1]));

    expect({
      // A torn write must never be observable at the final path.
      // Artifact paths only: the lease is legitimately a direct `wx` create,
      // and counting it made the corrected filter fail on clean source.
      directFinalWrites: targets.filter((target) => /rezo-v2-[0-9a-f]{64}\.json$/.test(target)).length,
      wroteAnOwnedTemp: targets.some((target) => target.endsWith('.tmp')),
      renamedIntoPlace: renameTargets.some((target) => target.endsWith('.json')),
    }).toEqual({ directFinalWrites: 0, wroteAnOwnedTemp: true, renamedIntoPlace: true });
  });

  it('PC-07 hydration refuses an artifact whose envelope identity does not match its filename', async () => {
    const directory = makeCacheDir('identity');
    const identityA = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    const identityB = createResponseCacheIdentity({ method: 'GET', url: URL_B, mode: null, headers: HEADERS });

    // Filed under A, but the envelope declares B: a dropped-in file must not be
    // able to answer for an identity it does not belong to.
    writeFileSync(
      join(directory, `rezo-v2-${sha256Hex(identityA)}.json`),
      JSON.stringify({
        v: 2,
        identity: identityB,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { tag: 'planted' },
        timestamp: Date.now(),
        ttl: 60_000,
      }),
      'utf-8',
    );

    const cache = makeCache(directory);
    await whenSettled(cache);

    expect(cache.get('GET', URL_A, HEADERS) ? 'served-planted' : 'refused').toBe('refused');
  });

  it('PC-08 hydration skips an oversized artifact instead of loading it', async () => {
    const directory = makeCacheDir('oversized');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    writeFileSync(
      join(directory, `rezo-v2-${sha256Hex(identity)}.json`),
      JSON.stringify({
        v: 2,
        identity,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { tag: 'x'.repeat(12 * 1024 * 1024) },
        timestamp: Date.now(),
        ttl: 60_000,
      }),
      'utf-8',
    );

    const cache = makeCache(directory);
    await whenSettled(cache);

    expect(cache.get('GET', URL_A, HEADERS) ? 'loaded' : 'skipped').toBe('skipped');
  });

  it('PC-09 a requested but unusable cacheDir is surfaced, never silently downgraded', async () => {
    const directory = makeCacheDir('unusable');
    // A regular file where the cache directory must be: the directory cannot be
    // created, so persistence was asked for and cannot be honoured.
    const blocked = join(directory, 'blocked');
    writeFileSync(blocked, 'not-a-directory', 'utf-8');

    const cache = makeCache(blocked);
    await whenSettled(cache);

    const bound = bindResponseCache(cache as unknown as object, 'json');
    let raised: unknown;
    try {
      bound?.get('GET', URL_A, HEADERS);
    } catch (error) {
      raised = error;
    }

    expect({
      persistent: cache.isPersistent,
      code: raised instanceof RezoError ? raised.code : raised === undefined ? 'none' : 'non-rezo',
    }).toEqual({ persistent: false, code: 'REZ_CACHE_PERSISTENCE_UNAVAILABLE' });
  });

  it('PC-10 CONTROL: with no cacheDir, memory caching still hits and nothing is written', async () => {
    const directory = makeCacheDir('memory-only');
    const cache = makeCache(undefined);
    await whenSettled(cache);

    cache.set('GET', URL_A, cacheableResponse('memory'), HEADERS);
    const seen = cache.get('GET', URL_A, HEADERS);

    expect({
      hit: (seen as { data?: { tag?: string } })?.data?.tag ?? null,
      persistent: cache.isPersistent,
      strayFiles: listing(directory).length,
    }).toEqual({ hit: 'memory', persistent: false, strayFiles: 0 });
  });

  it('PC-11 CONTROL: "never requested" stays distinguishable from "requested and unavailable"', async () => {
    const cache = makeCache(undefined);
    await whenSettled(cache);
    const bound = bindResponseCache(cache as unknown as object, 'json');

    let raised: unknown;
    try {
      bound?.set('GET', URL_A, cacheableResponse('memory-bound'), HEADERS);
    } catch (error) {
      raised = error;
    }

    // A caller who never asked for persistence must not be handed a
    // persistence error; only an unhonoured request raises.
    expect(raised === undefined ? 'no-error' : 'raised').toBe('no-error');
  });

  it('PC-13 a binary body survives a restart as the type it was stored as', async () => {
    const directory = makeCacheDir('binary');
    const bytes = [0, 1, 250, 255];

    const first = makeCache(directory);
    await whenSettled(first);
    first.set('GET', URL_A, cacheableBody(new Uint8Array(bytes).buffer), HEADERS);
    first.set('GET', URL_B, cacheableBody(Buffer.from(bytes)), HEADERS);
    await whenSettled(first);

    const second = makeCache(directory);
    await whenSettled(second);
    const arrayBufferEntry = second.get('GET', URL_A, HEADERS) as { data?: unknown } | undefined;
    const bufferEntry = second.get('GET', URL_B, HEADERS) as { data?: unknown } | undefined;

    // A JSON round trip turns an ArrayBuffer into `{}` and a Buffer into
    // `{type:'Buffer',data:[...]}`. Either way the caller gets something that
    // is not the body they cached, which is worse than a miss.
    expect({
      arrayBufferKind: arrayBufferEntry?.data instanceof ArrayBuffer ? 'ArrayBuffer' : describeKind(arrayBufferEntry?.data),
      arrayBufferBytes: arrayBufferEntry?.data instanceof ArrayBuffer
        ? Array.from(new Uint8Array(arrayBufferEntry.data)) : null,
      bufferKind: Buffer.isBuffer(bufferEntry?.data) ? 'Buffer' : describeKind(bufferEntry?.data),
      bufferBytes: Buffer.isBuffer(bufferEntry?.data) ? Array.from(bufferEntry.data) : null,
    }).toEqual({
      arrayBufferKind: 'ArrayBuffer',
      arrayBufferBytes: bytes,
      bufferKind: 'Buffer',
      bufferBytes: bytes,
    });
  });

  it('PC-14 a body the codec cannot carry stays memory-only, with no artifact written', async () => {
    const directory = makeCacheDir('lossy');
    const cache = makeCache(directory);
    await whenSettled(cache);

    const circular: Record<string, unknown> = { name: 'circular' };
    circular.self = circular;
    cache.set('GET', URL_A, cacheableBody(circular), HEADERS);
    await whenSettled(cache);

    // Memory keeps the real value; disk gets nothing rather than a corrupted
    // or partial artifact.
    const inMemory = cache.get('GET', URL_A, HEADERS) as { data?: Record<string, unknown> } | undefined;
    expect({
      servedFromMemory: inMemory?.data?.name ?? null,
      artifacts: listing(directory).length,
    }).toEqual({ servedFromMemory: 'circular', artifacts: 0 });
  });

  it('PC-15 invalidate() removes an artifact whose entry is no longer in memory', async () => {
    const directory = makeCacheDir('evicted-invalidate');
    // maxEntries 1: storing the second entry pushes the first out of memory
    // while its artifact stays on disk, which is the whole point of persisting.
    const cache = makeCache(directory, { maxEntries: 1 });
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('doomed'), HEADERS);
    cache.set('GET', URL_B, cacheableResponse('resident'), HEADERS);
    await whenSettled(cache);

    cache.invalidate(URL_A);
    await whenSettled(cache);

    const revived = makeCache(directory);
    await whenSettled(revived);

    expect({
      // `invalidate` walks the in-memory keys, so an entry living only on disk
      // is silently skipped and comes back on the next start.
      invalidated: revived.get('GET', URL_A, HEADERS) ? 'resurrected' : 'gone',
      resident: (revived.get('GET', URL_B, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ invalidated: 'gone', resident: 'resident' });
  });

  it('PC-16 an invalidate racing hydration is not undone when hydration lands', async () => {
    const directory = makeCacheDir('hydration-race');
    const seed = makeCache(directory);
    await whenSettled(seed);
    seed.set('GET', URL_A, cacheableResponse('doomed'), HEADERS);
    await whenSettled(seed);

    // Hydration is asynchronous, so this invalidate is issued while the store
    // is still loading: nothing is in memory yet for it to walk.
    const racing = makeCache(directory);
    racing.invalidate(URL_A);
    await whenSettled(racing);

    expect(racing.get('GET', URL_A, HEADERS) ? 'resurrected' : 'gone').toBe('gone');
  });

  it('PC-17 two caches in one process share the directory rather than fighting over it', async () => {
    const directory = makeCacheDir('same-process');
    const first = makeCache(directory);
    await whenSettled(first);
    const second = makeCache(directory);
    await whenSettled(second);

    first.set('GET', URL_A, cacheableResponse('shared'), HEADERS);
    await whenSettled(first);

    // Same-process instances share one lease; the second must not be refused
    // as if it were a competing process.
    expect({
      firstPersistent: first.isPersistent,
      secondPersistent: second.isPersistent,
      secondSeesIt: (second.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ firstPersistent: true, secondPersistent: true, secondSeesIt: 'shared' });
  });

  it('PC-18 a lease held by another process is refused, never stolen', async () => {
    const directory = makeCacheDir('foreign-lease');
    const leasePath = join(directory, LEASE_FILE);
    const foreign = JSON.stringify({ pid: process.pid + 1, token: 'foreign-token', startedAt: Date.now() });
    writeFileSync(leasePath, foreign, 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('should-not-persist'), HEADERS);
    await whenSettled(cache);

    const bound = bindResponseCache(cache as unknown as object, 'json');
    let raised: unknown;
    try {
      bound?.get('GET', URL_A, HEADERS);
    } catch (error) {
      raised = error;
    }

    expect({
      persistent: cache.isPersistent,
      code: raised instanceof RezoError ? raised.code : raised === undefined ? 'none' : 'non-rezo',
      // No steal: the other holder's lease is left exactly as it was found.
      leaseUntouched: readFileSync(leasePath, 'utf-8') === foreign,
      artifacts: listing(directory).length,
    }).toEqual({
      persistent: false,
      code: 'REZ_CACHE_PERSISTENCE_UNAVAILABLE',
      leaseUntouched: true,
      artifacts: 0,
    });
  });

  it('PC-19 CONTROL: removing a stale lease restores persistence on the next start', async () => {
    const directory = makeCacheDir('lease-recovery');
    const leasePath = join(directory, LEASE_FILE);
    writeFileSync(leasePath, JSON.stringify({ pid: process.pid + 1, token: 'stale', startedAt: 0 }), 'utf-8');

    const refused = makeCache(directory);
    await whenSettled(refused);
    expect(refused.isPersistent).toBe(false);

    // Explicit operator recovery: the lease is not reclaimed automatically, but
    // removing it must be all that is required.
    rmSync(leasePath);
    const recovered = makeCache(directory);
    await whenSettled(recovered);
    recovered.set('GET', URL_A, cacheableResponse('after-recovery'), HEADERS);
    await whenSettled(recovered);

    expect({ persistent: recovered.isPersistent, artifacts: listing(directory).length })
      .toEqual({ persistent: true, artifacts: 1 });
  });

  it('PC-20 a bound use before readiness settles does not falsely refuse', async () => {
    const directory = makeCacheDir('immediate-bound');
    // A perfectly valid directory. Initialization is asynchronous, so this bound
    // call lands while the store is still starting: "not ready yet" is not
    // "cannot be honoured", and must not surface -1078.
    const cache = makeCache(directory);
    const bound = bindResponseCache(cache as unknown as object, 'json');

    let raised: unknown;
    let seen: unknown;
    try {
      seen = bound?.get('GET', URL_A, HEADERS);
    } catch (error) {
      raised = error;
    }
    await whenSettled(cache);

    expect({
      code: raised instanceof RezoError ? raised.code : raised === undefined ? 'none' : 'non-rezo',
      hit: seen === undefined || seen === null ? 'miss' : 'hit',
      persistentOnceSettled: cache.isPersistent,
    }).toEqual({ code: 'none', hit: 'miss', persistentOnceSettled: true });
  });

  it('PC-21 a set issued before readiness is still persisted and survives a restart', async () => {
    const directory = makeCacheDir('immediate-set');
    const cache = makeCache(directory);
    // No await: this is the first thing a real caller does after constructing.
    cache.set('GET', URL_A, cacheableResponse('written-immediately'), HEADERS);
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    expect((restarted.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null)
      .toBe('written-immediately');
  });

  it('PC-22 invalidate then set leaves the NEW entry, in memory and after a restart', async () => {
    const directory = makeCacheDir('invalidate-then-set');
    const seed = makeCache(directory);
    await whenSettled(seed);
    seed.set('GET', URL_A, cacheableResponse('old'), HEADERS);
    await whenSettled(seed);

    // Both issued before readiness, in the ruled order. The invalidate's disk
    // sweep completes later; it must not reach back and delete the newer entry
    // it never described.
    const cache = makeCache(directory);
    cache.invalidate(URL_A);
    cache.set('GET', URL_A, cacheableResponse('new'), HEADERS);
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    // Memory is inspected BEFORE any lookup: a `get()` can load the new artifact
    // back through from disk, which would mask a broken generation guard that
    // had wrongly deleted it from memory. Size first, then value.
    const memorySize = (cache as unknown as { size: number }).size;
    expect({
      memorySize,
      inMemory: (cache.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
      afterRestart: (restarted.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ memorySize: 1, inMemory: 'new', afterRestart: 'new' });
  });

  it('PC-28 clear() before readiness is not undone by the hydration that follows it', async () => {
    const directory = makeCacheDir('clear-before-hydration');
    const seed = makeCache(directory);
    await whenSettled(seed);
    seed.set('GET', URL_A, cacheableResponse('old-a'), HEADERS);
    seed.set('GET', URL_B, cacheableResponse('old-b'), HEADERS);
    await whenSettled(seed);

    // `clear()` empties a memory that is still empty, and the queued disk sweep
    // runs later — but the constructor's hydration lands in between and
    // repopulates everything the clear was supposed to remove. The logical last
    // operation has to win in memory as well as on disk.
    const cache = makeCache(directory);
    cache.clear();
    cache.set('GET', URL_A, cacheableResponse('new-a'), HEADERS);
    await whenSettled(cache);

    const memorySize = (cache as unknown as { size: number }).size;
    const sibling = makeCache(directory);
    await whenSettled(sibling);

    expect({
      memorySize,
      a: (cache.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
      // `old-b` was cleared: it must be gone from this instance and from disk.
      b: (cache.get('GET', URL_B, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
      siblingB: (sibling.get('GET', URL_B, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ memorySize: 1, a: 'new-a', b: null, siblingB: null });
  });

  it('PC-23 clear() leaves a file this cache does not own byte-identical', async () => {
    const directory = makeCacheDir('hostile-clear');
    // An operator's own file that happens to match the artifact NAME shape.
    // Name shape is not ownership: only an artifact this cache wrote, filed
    // under its own identity, may be removed. Deleting caller data is the worst
    // thing this module could do.
    const strangerName = `rezo-v2-${'a'.repeat(64)}.json`;
    const strangerBody = JSON.stringify({ operator: 'do not delete me' });
    writeFileSync(join(directory, strangerName), strangerBody, 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('ours'), HEADERS);
    await whenSettled(cache);

    cache.clear();
    await whenSettled(cache);

    let survives = false;
    let contents: string | null = null;
    try {
      contents = readFileSync(join(directory, strangerName), 'utf-8');
      survives = true;
    } catch { /* deleted */ }

    expect({ survives, contents }).toEqual({ survives: true, contents: strangerBody });
  });

  it('PC-24 invalidate() leaves a file this cache does not own byte-identical', async () => {
    const directory = makeCacheDir('hostile-invalidate');
    const strangerName = `rezo-v2-${'b'.repeat(64)}.json`;
    const strangerBody = JSON.stringify({ operator: 'unrelated backup' });
    writeFileSync(join(directory, strangerName), strangerBody, 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('ours'), HEADERS);
    await whenSettled(cache);

    cache.invalidate(URL_A);
    await whenSettled(cache);

    let survives = false;
    let contents: string | null = null;
    try {
      contents = readFileSync(join(directory, strangerName), 'utf-8');
      survives = true;
    } catch { /* deleted */ }

    expect({ survives, contents }).toEqual({ survives: true, contents: strangerBody });
  });

  it('PC-25 a body JSON cannot round-trip exactly is never stored as if it could', async () => {
    const directory = makeCacheDir('lossy-json');
    // Each of these survives `JSON.stringify` without throwing, and every one
    // comes back as a DIFFERENT value: NaN and ±Infinity become null, -0
    // becomes 0, a Date becomes a string, an own `undefined` property
    // disappears, and a sparse hole becomes null. "stringify did not throw" is
    // not losslessness. Anything not provably round-trippable must stay
    // memory-only rather than be filed as an exact entry.
    const lossy: Array<[string, unknown]> = [
      ['nan', { value: NaN }],
      ['infinity', { value: Infinity }],
      ['negative-zero', { value: -0 }],
      ['date', { value: new Date(0) }],
      ['own-undefined', { value: undefined }],
      ['sparse-hole', { value: [1, , 3] }],
      ['map', { value: new Map([['a', 1]]) }],
      ['custom-tojson', { value: { toJSON: () => 'replaced' } }],
    ];

    const cache = makeCache(directory);
    await whenSettled(cache);
    for (const [label, body] of lossy) {
      cache.set('GET', `${URL_A}/${label}`, cacheableBody(body), HEADERS);
    }
    await whenSettled(cache);

    // Memory still holds the real values; disk holds none of them.
    const servedFromMemory = lossy.every(([label]) =>
      cache.get('GET', `${URL_A}/${label}`, HEADERS) !== undefined);

    expect({ artifacts: listing(directory).length, servedFromMemory })
      .toEqual({ artifacts: 0, servedFromMemory: true });
  });

  it('PC-26 CONTROL: an ordinary JSON body still persists and round-trips exactly', async () => {
    const directory = makeCacheDir('lossless-json');
    const body = { tag: 'plain', nested: { list: [1, 2, 3], flag: true, nothing: null }, text: 'ok' };

    const first = makeCache(directory);
    await whenSettled(first);
    first.set('GET', URL_A, cacheableBody(body), HEADERS);
    await whenSettled(first);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;

    // Non-vacuity for PC-25: the conservative test must not reject everything.
    expect({ artifacts: listing(directory).length, hydrated })
      .toEqual({ artifacts: 1, hydrated: body });
  });

  it('PC-27 two caches constructed at once in one process both get the directory', async () => {
    const directory = makeCacheDir('concurrent-construct');
    // Constructed synchronously, the ordinary case: both enter lease
    // acquisition before either has recorded ownership, so one wins the
    // exclusive create and the other sees EEXIST. Seeing EEXIST is not evidence
    // of a competing PROCESS — in-process acquisition has to be serialized, or
    // a second client in the same program is refused for no reason. PC-17
    // stays as the sequential control.
    const first = makeCache(directory);
    const second = makeCache(directory);
    await whenSettled(first);
    await whenSettled(second);

    first.set('GET', URL_A, cacheableResponse('shared'), HEADERS);
    await whenSettled(first);

    expect({
      firstPersistent: first.isPersistent,
      secondPersistent: second.isPersistent,
      secondSeesIt: (second.get('GET', URL_A, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ firstPersistent: true, secondPersistent: true, secondSeesIt: 'shared' });
  });

  it('PC-29 a hostile or shape-losing body never escapes the codec and never persists', async () => {
    const directory = makeCacheDir('hostile-codec');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // A VALUE getter must never be invoked: inspection reads descriptors, so a
    // caller's getter is never run by us. A Proxy's structural traps
    // (`ownKeys`, `getOwnPropertyDescriptor`) unavoidably fire when anything
    // asks an object for its own keys — there is no trap-free way to inspect
    // one — so for a Proxy the contract is containment and non-persistence,
    // not non-invocation.
    let valueGetterFired = false;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'trap', {
      enumerable: true,
      get() { valueGetterFired = true; throw new Error('getter escaped the codec'); },
    });

    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.value = 'restored as a plain object, not a null-prototype one';

    const hiddenOwn: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(hiddenOwn, 'secret', { enumerable: false, value: 'dropped by stringify' });

    const arrayWithExtras: unknown[] = [1, 2];
    (arrayWithExtras as unknown as Record<string, unknown>).extra = 'dropped by stringify';

    const proxied = new Proxy({ ok: 1 }, {
      get() { valueGetterFired = true; throw new Error('proxy value trap escaped the codec'); },
      ownKeys() { throw new Error('proxy structural trap'); },
    });

    const cases: Array<[string, unknown]> = [
      ['getter', hostile],
      ['null-prototype', nullPrototype],
      ['non-enumerable-own', hiddenOwn],
      ['array-extra-own', arrayWithExtras],
      ['proxy', proxied],
    ];

    let escaped: string | null = null;
    for (const [label, body] of cases) {
      try {
        cache.set('GET', `${URL_A}/${label}`, cacheableBody(body), HEADERS);
      } catch (error) {
        // A public `set` must never let a caller's trap escape through us.
        escaped = `${label}: ${(error as Error).message}`;
      }
    }
    await whenSettled(cache);

    expect({ escaped, valueGetterFired, artifacts: listing(directory).length })
      .toEqual({ escaped: null, valueGetterFired: false, artifacts: 0 });
  });

  it('PC-30 a TRANSPARENT proxy is snapshotted: structural traps may fire, the value trap never does', async () => {
    const directory = makeCacheDir('transparent-proxy');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // Unlike PC-29's hostile proxy, this one ALLOWS inspection — so it passes
    // the descriptor walk and reaches serialization. If the tagged body carries
    // the caller's object rather than a detached snapshot, the deferred
    // `JSON.stringify` reads it later and fires the value trap.
    const valueReads: string[] = [];
    const target = { ok: 1, nested: { deep: 'value' } };
    const transparent = new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === 'string') valueReads.push(key);
        return Reflect.get(object, key, receiver);
      },
    });

    cache.set('GET', URL_A, cacheableBody(transparent), HEADERS);
    // Mutated BEFORE the first drain, so the write has not serialized yet. If
    // the tag carried the caller's object, the deferred stringify would pick up
    // 999; the snapshot taken at acceptance must win. Draining first would make
    // this assertion vacuous — the artifact would already be on disk.
    target.ok = 999;
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;

    expect({ valueReads, hydrated })
      .toEqual({ valueReads: [], hydrated: { ok: 1, nested: { deep: 'value' } } });
  });

  it('PC-31 a body with a repeated reference is not filed as if JSON preserved the alias', async () => {
    const directory = makeCacheDir('aliased');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // `{a: shared, b: shared}` restores as two distinct objects: the alias
    // identity is lost, so the restored value is not the value that was cached.
    const shared = { count: 1 };
    cache.set('GET', URL_A, cacheableBody({ a: shared, b: shared }), HEADERS);
    await whenSettled(cache);

    const inMemory = cache.get('GET', URL_A, HEADERS) as { data?: { a?: unknown; b?: unknown } } | undefined;
    expect({
      artifacts: listing(directory).length,
      // Memory still holds the real value, aliases intact.
      aliasIntactInMemory: inMemory?.data?.a === inMemory?.data?.b,
    }).toEqual({ artifacts: 0, aliasIntactInMemory: true });
  });

  it('PC-32 hostile BINARY classification is contained and never escapes cache.set', async () => {
    const directory = makeCacheDir('hostile-binary');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // Classification runs before the JSON walk, so it needs its own
    // containment: a Proxy wrapping a Buffer or ArrayBuffer keeps the
    // prototype chain, and a real typed array can carry a throwing own
    // `constructor` getter.
    // Two classes, deliberately separated. An impersonating Proxy keeps the
    // prototype chain of a Buffer or ArrayBuffer, and there is no way to reach
    // its bytes without a property read — so there the contract is containment,
    // exactly as for PC-29's structural traps. The other two are OUR reads to
    // avoid: `constructor` on a real typed array, and `length` on an array.
    let impersonatorTrapFired = false;
    let avoidableReadFired = false;
    const proxiedBuffer = new Proxy(Buffer.from([1, 2, 3]), {
      get(object, key, receiver) {
        impersonatorTrapFired = true;
        if (key === 'toString') throw new Error('buffer trap escaped classification');
        return Reflect.get(object, key, receiver);
      },
    });
    const proxiedArrayBuffer = new Proxy(new Uint8Array([1, 2]).buffer, {
      get() { impersonatorTrapFired = true; throw new Error('arraybuffer trap escaped classification'); },
    });
    const hostileView = new Uint8Array([1, 2, 3]);
    Object.defineProperty(hostileView, 'constructor', {
      get() { avoidableReadFired = true; throw new Error('constructor getter escaped classification'); },
    });
    const proxiedArray = new Proxy([1, 2, 3], {
      get(object, key, receiver) {
        if (key === 'length') { avoidableReadFired = true; throw new Error('length read escaped inspection'); }
        return Reflect.get(object, key, receiver);
      },
    });

    let escaped: string | null = null;
    for (const [label, body] of [
      ['proxied-buffer', proxiedBuffer],
      ['proxied-arraybuffer', proxiedArrayBuffer],
      ['hostile-view', hostileView],
      ['proxied-array', proxiedArray],
    ] as Array<[string, unknown]>) {
      try {
        cache.set('GET', `${URL_A}/${label}`, cacheableBody(body), HEADERS);
      } catch (error) {
        escaped = `${label}: ${(error as Error).message}`;
      }
    }
    await whenSettled(cache);

    // A hostile body may not escape a public `set`. The real typed array with a
    // throwing `constructor` is legitimately storable — its bytes are reachable
    // without touching that getter — so this asserts containment, not a
    // blanket refusal.
    // Strengthened after the intrinsic binary reads landed. I had argued that
    // an impersonating Proxy's trap must fire because reaching its bytes
    // requires a property read — that was too generous to the implementation.
    // Internal-slot reads prove the brand without touching a single caller
    // property, so NOTHING fires here: not the avoidable reads, not the
    // impersonator's traps, and nothing escapes.
    expect({ escaped, avoidableReadFired, impersonatorTrapFired })
      .toEqual({ escaped: null, avoidableReadFired: false, impersonatorTrapFired: false });
  });

  it('PC-36 a Blob body persists its bytes AND its MIME type, and restores as a Blob', async () => {
    const directory = makeCacheDir('blob-body');
    const bytes = [0, 1, 250, 255];
    const first = makeCache(directory);
    await whenSettled(first);

    // The frozen contract requires byte + MIME persistence for a Blob. It was
    // left memory-only because its bytes are only readable asynchronously — but
    // the write is already queued and async, and a Blob is immutable, so
    // reading it inside the queue is sound.
    first.set('GET', URL_A, cacheableBody(new Blob([new Uint8Array(bytes)], { type: 'image/png' })), HEADERS);
    await whenSettled(first);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;
    const restoredBytes = hydrated instanceof Blob
      ? Array.from(new Uint8Array(await hydrated.arrayBuffer()))
      : null;

    expect({
      artifacts: listing(directory).length,
      kind: hydrated instanceof Blob ? 'Blob' : describeKind(hydrated),
      type: hydrated instanceof Blob ? hydrated.type : null,
      bytes: restoredBytes,
    }).toEqual({ artifacts: 1, kind: 'Blob', type: 'image/png', bytes });
  });

  it('PC-37 invalidate() re-authenticates the file it is about to unlink', async () => {
    const directory = makeCacheDir('invalidate-authenticate');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('ours'), HEADERS);
    await whenSettled(cache);

    // An operator replaces the artifact byte-for-byte at the exact path. The
    // in-memory branch of `invalidate` knows an identity and unlinks its path
    // directly — but the FILE there is no longer ours, and a path is not
    // ownership any more than a name was.
    const [artifact] = listing(directory);
    const operatorContent = JSON.stringify({ operator: 'replaced this file' });
    writeFileSync(join(directory, artifact), operatorContent, 'utf-8');

    cache.invalidate(URL_A);
    await whenSettled(cache);

    let survives = false;
    let contents: string | null = null;
    try {
      contents = readFileSync(join(directory, artifact), 'utf-8');
      survives = true;
    } catch { /* deleted */ }

    expect({ survives, contents }).toEqual({ survives: true, contents: operatorContent });
  });

  it('PC-38 a body over the artifact bound is not written at all', async () => {
    const directory = makeCacheDir('write-bound');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // The 4 MiB bound is enforced on READ. Writing past it produces an artifact
    // that can never be read back — unreadable residue that also survives as
    // a file nothing will ever use.
    cache.set('GET', URL_A, cacheableBody({ blob: 'x'.repeat(5 * 1024 * 1024) }), HEADERS);
    await whenSettled(cache);

    expect({ artifacts: listing(directory).length }).toEqual({ artifacts: 0 });
  });

  it('PC-39 an own __proto__ key never becomes the snapshot prototype', async () => {
    const directory = makeCacheDir('proto-key');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // `copy[key] = value` for the key `__proto__` sets the PROTOTYPE rather than
    // an own property, so the snapshot silently loses the key and restores as
    // `{}` — a body that was accepted as exactly round-trippable.
    const body = JSON.parse('{"__proto__": {"tainted": true}, "keep": 1}') as Record<string, unknown>;
    cache.set('GET', URL_A, cacheableBody(body), HEADERS);
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: Record<string, unknown> } | undefined)?.data;

    // Either it round-trips exactly, or it was never filed. Silently dropping
    // the key is the one outcome the contract forbids.
    const filed = listing(directory).length;
    expect(
      filed === 0
        ? { outcome: 'not-filed' }
        : { outcome: 'round-tripped', keys: Object.keys(hydrated ?? {}).sort() },
    ).toEqual(filed === 0 ? { outcome: 'not-filed' } : { outcome: 'round-tripped', keys: ['__proto__', 'keep'] });
  });

  it('PC-40 a derived Blob cannot substitute its own bytes or MIME type', async () => {
    const directory = makeCacheDir('derived-blob');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // A subclass overriding `arrayBuffer` and `type` runs CALLER code on the
    // write queue and substitutes what gets stored. Either the intrinsic bytes
    // are used, or the exotic shape is refused — never the caller's overrides.
    class DerivedBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        return new Uint8Array([9, 8, 7]).buffer;
      }
      override get type(): string { return 'application/x-derived'; }
    }
    cache.set('GET', URL_A, cacheableBody(new DerivedBlob([new Uint8Array([1, 2, 3])], { type: 'image/png' })), HEADERS);
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;
    const bytes = hydrated instanceof Blob ? Array.from(new Uint8Array(await hydrated.arrayBuffer())) : null;
    const type = hydrated instanceof Blob ? hydrated.type : null;

    const filed = listing(directory).length;
    expect(
      filed === 0
        ? { outcome: 'refused' }
        : { outcome: 'intrinsic', bytes, type },
    ).toEqual(filed === 0 ? { outcome: 'refused' } : { outcome: 'intrinsic', bytes: [1, 2, 3], type: 'image/png' });
  });

  it('PC-41 a write never renames over a file this cache does not own', async () => {
    const directory = makeCacheDir('overwrite-authenticate');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('ours'), HEADERS);
    await whenSettled(cache);

    // Authentication before UNLINK was not enough: the atomic rename publishes
    // over whatever sits at the final path, so an operator file there is
    // destroyed by an ordinary re-store of the same entry.
    const [artifact] = listing(directory);
    const operatorContent = JSON.stringify({ operator: 'replaced this file' });
    writeFileSync(join(directory, artifact), operatorContent, 'utf-8');

    cache.set('GET', URL_A, cacheableResponse('second-store'), HEADERS);
    await whenSettled(cache);

    expect(readFileSync(join(directory, artifact), 'utf-8')).toBe(operatorContent);
  });

  it('PC-42 a malformed envelope body is never hydrated and never treated as owned', async () => {
    const directory = makeCacheDir('malformed-body');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    const name = `rezo-v2-${sha256Hex(identity)}.json`;
    // `{k:"json"}` with no `v`: the body tag is structurally incomplete, so the
    // entry has no value at all. Hydrating it yields `data: undefined`, and
    // treating it as owned means `clear()` deletes a file we cannot even read.
    const malformed = JSON.stringify({
      v: 2, identity, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { k: 'json' }, timestamp: Date.now(), ttl: 60_000,
    });
    writeFileSync(join(directory, name), malformed, 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    const hydrated = cache.get('GET', URL_A, HEADERS);
    cache.clear();
    await whenSettled(cache);

    let survives = false;
    try { readFileSync(join(directory, name), 'utf-8'); survives = true; } catch { /* deleted */ }

    expect({ hydrated: hydrated === undefined || hydrated === null ? 'refused' : 'served', survives })
      .toEqual({ hydrated: 'refused', survives: true });
  });

  it('PC-43 a non-canonical base64 body is refused, not decoded into invented bytes', async () => {
    const directory = makeCacheDir('bad-base64');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    const name = `rezo-v2-${sha256Hex(identity)}.json`;
    // `Buffer.from(x, 'base64')` is lenient: it skips invalid characters and
    // produces *some* bytes. A body that is not canonical base64 must be
    // refused rather than decoded into whatever the parser salvages.
    writeFileSync(join(directory, name), JSON.stringify({
      v: 2, identity, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/octet-stream' },
      body: { k: 'buffer', v: '%%%not-base64%%%' }, timestamp: Date.now(), ttl: 60_000,
    }), 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    const hydrated = cache.get('GET', URL_A, HEADERS);

    expect(hydrated === undefined || hydrated === null ? 'refused' : 'decoded').toBe('refused');
  });

  it('PC-44 a temp file this cache can PROVE is its own is reclaimed', async () => {
    const directory = makeCacheDir('residue');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_B, mode: null, headers: HEADERS });
    const finalName = `rezo-v2-${sha256Hex(identity)}.json`;

    // My first version of this row expected a PARTIAL temp file to be
    // reclaimed. That was wrong, and PC-48 is why: a partial write cannot prove
    // it is ours, and deleting what we cannot authenticate is the destructive
    // bug in a different costume. So the reclaimable case is the one we CAN
    // prove — a complete envelope left behind by a crash between the write and
    // the rename — and an unprovable one is left alone by PC-48.
    const ownedTemp = join(directory, `${finalName}.abc123.tmp`);
    writeFileSync(ownedTemp, JSON.stringify({
      v: 2, identity, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { k: 'json', v: { orphaned: true } }, timestamp: Date.now(), ttl: 60_000,
    }), 'utf-8');

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    let residue = false;
    try { readFileSync(ownedTemp, 'utf-8'); residue = true; } catch { /* reclaimed */ }

    expect({ residue }).toEqual({ residue: false });
  });

  it('PC-45 a Blob whose overridden arrayBuffer never settles cannot own the write queue', async () => {
    const directory = makeCacheDir('hanging-blob');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // Resolution runs inside the shared per-directory queue, so if it awaited a
    // caller's override, a subclass that never settles would wedge every later
    // write, invalidate and clear behind it — an indefinite wait owned by
    // caller code. Intrinsic reads must make that impossible.
    class HangingBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return new Promise<ArrayBuffer>(() => { /* never settles */ });
      }
    }
    cache.set('GET', URL_A, cacheableBody(new HangingBlob([new Uint8Array([1, 2, 3])])), HEADERS);

    // A later operation must still complete: the queue belongs to us.
    cache.set('GET', URL_B, cacheableResponse('after-the-hanging-blob'), HEADERS);

    const settled = await Promise.race([
      whenSettled(cache).then(() => 'drained'),
      new Promise((resolve) => setTimeout(() => resolve('wedged'), 5_000)),
    ]);

    expect({
      settled,
      laterEntry: (cache.get('GET', URL_B, HEADERS) as { data?: { tag?: string } })?.data?.tag ?? null,
    }).toEqual({ settled: 'drained', laterEntry: 'after-the-hanging-blob' });
  });

  it('PC-46 the write bound counts UTF-8 bytes, not UTF-16 code units', async () => {
    const directory = makeCacheDir('multibyte-bound');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // `serialized.length` is code units; the read bound is bytes. A body of
    // multibyte characters passes the write check and produces an artifact past
    // the read bound — written, then never hydratable.
    cache.set('GET', URL_A, cacheableBody({ euro: '\u20AC'.repeat(1_500_000) }), HEADERS);
    await whenSettled(cache);

    expect({ artifacts: listing(directory).length }).toEqual({ artifacts: 0 });
  });

  it('PC-47 CONTROL: a body just under the bound still persists and hydrates', async () => {
    const directory = makeCacheDir('under-bound');
    const body = { pad: 'a'.repeat(1_000_000) };
    const first = makeCache(directory);
    await whenSettled(first);
    first.set('GET', URL_A, cacheableBody(body), HEADERS);
    await whenSettled(first);

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    // Non-vacuity for PC-46: the byte bound must not reject ordinary bodies.
    expect({
      artifacts: listing(directory).length,
      hydrated: (restarted.get('GET', URL_A, HEADERS) as { data?: { pad?: string } })?.data?.pad?.length ?? null,
    }).toEqual({ artifacts: 1, hydrated: 1_000_000 });
  });

  it('PC-48 an unknown temp-shaped file is never reclaimed by its name alone', async () => {
    const directory = makeCacheDir('temp-ownership');
    // My own residue reclamation matched a regex and deleted — the same
    // name-is-ownership mistake as `clear()` and `remove()`, in the fix for a
    // different one. A caller file wearing the temp shape must survive.
    const strangerTemp = join(directory, `rezo-v2-${'d'.repeat(64)}.json.operator.tmp`);
    const strangerBody = 'operator-owned';
    writeFileSync(strangerTemp, strangerBody, 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);

    let survives = false;
    let contents: string | null = null;
    try { contents = readFileSync(strangerTemp, 'utf-8'); survives = true; } catch { /* deleted */ }

    expect({ survives, contents }).toEqual({ survives: true, contents: strangerBody });
  });

  it('PC-49 array inspection uses one descriptor snapshot, not a second query', async () => {
    const directory = makeCacheDir('array-double-query');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // The trap must respect Proxy invariants — a non-configurable `length`
    // reported as configurable makes `getOwnPropertyDescriptors` throw, and the
    // row then "passes" without ever reaching the cardinality check. My first
    // version did exactly that and could not kill its own mutant.
    //
    // So: real descriptors throughout, and ONLY the second own-name query
    // differs. A Proxy that hides a key between the two queries must not be
    // able to file a body that loses it.
    const target: unknown[] = [1, 2];
    (target as unknown as Record<string, unknown>).extra = 'lost';
    let ownKeysQueries = 0;
    const proxied = new Proxy(target, {
      ownKeys(object) {
        ownKeysQueries += 1;
        const real = Reflect.ownKeys(object);
        return ownKeysQueries === 1 ? real : real.filter((key) => key !== 'extra');
      },
    });

    cache.set('GET', URL_A, cacheableBody(proxied), HEADERS);
    await whenSettled(cache);

    // Either it round-trips with `extra`, or nothing is filed. Filing it and
    // losing the key is the forbidden outcome.
    expect({ artifacts: listing(directory).length, ownKeysQueries: ownKeysQueries >= 1 })
      .toEqual({ artifacts: 0, ownKeysQueries: true });
  });

  it('PC-50 an ambient Object.prototype.toJSON cannot rewrite the artifact', async () => {
    const directory = makeCacheDir('ambient-tojson');
    const cache = makeCache(directory);
    await whenSettled(cache);

    cache.set('GET', URL_A, cacheableBody({ real: 'value' }), HEADERS);
    // Installed AFTER acceptance and BEFORE the queued write: if serialization
    // consults mutable prototypes, the whole artifact becomes the replacement.
    const prototype = Object.prototype as unknown as Record<string, unknown>;
    prototype.toJSON = function toJSON() { return { ambientReplacement: true }; };
    try {
      await whenSettled(cache);
    } finally {
      delete prototype.toJSON;
    }

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    expect((restarted.get('GET', URL_A, HEADERS) as { data?: { real?: string } })?.data?.real ?? null)
      .toBe('value');
  });

  it('PC-51 an envelope with an out-of-range status is refused', async () => {
    const directory = makeCacheDir('range-status');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    // ONLY the status is wrong — no unknown key to reject it for. No response
    // carries status -1, so type-checking the field is not validating it.
    writeFileSync(join(directory, `rezo-v2-${sha256Hex(identity)}.json`), JSON.stringify({
      v: 2, identity, status: -1, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { k: 'json', v: { any: 1 } }, timestamp: Date.now(), ttl: 60_000,
    }), 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    expect(cache.get('GET', URL_A, HEADERS) ? 'loaded' : 'refused').toBe('refused');
  });

  it('PC-52 an envelope carrying an unknown key is refused', async () => {
    const directory = makeCacheDir('unknown-key');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    // Everything else is valid: an unknown key alone means this is not our
    // format, and reading it as if it were is how a foreign file becomes ours.
    writeFileSync(join(directory, `rezo-v2-${sha256Hex(identity)}.json`), JSON.stringify({
      v: 2, identity, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { k: 'json', v: { any: 1 } }, timestamp: Date.now(), ttl: 60_000,
      unexpected: 'extra key',
    }), 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    expect(cache.get('GET', URL_A, HEADERS) ? 'loaded' : 'refused').toBe('refused');
  });

  it('PC-53 headers that are not a string map are refused', async () => {
    const directory = makeCacheDir('header-shape');
    const identity = createResponseCacheIdentity({ method: 'GET', url: URL_A, mode: null, headers: HEADERS });
    writeFileSync(join(directory, `rezo-v2-${sha256Hex(identity)}.json`), JSON.stringify({
      v: 2, identity, status: 200, statusText: 'OK', headers: [],
      body: { k: 'json', v: { any: 1 } }, timestamp: Date.now(), ttl: 60_000,
    }), 'utf-8');

    const cache = makeCache(directory);
    await whenSettled(cache);
    expect(cache.get('GET', URL_A, HEADERS) ? 'loaded' : 'refused').toBe('refused');
  });

  it('PC-54 an ambient toJSON installed BEFORE the set cannot rewrite the artifact', async () => {
    const directory = makeCacheDir('ambient-tojson-early');
    const cache = makeCache(directory);
    await whenSettled(cache);

    // PC-50 installs it after `set`, which the acceptance-time serialization
    // alone defeats — so PC-50 cannot prove the prototype detachment. Installing
    // it BEFORE isolates that: serialization must not consult a mutable
    // prototype no matter when it was poisoned.
    const prototype = Object.prototype as unknown as Record<string, unknown>;
    prototype.toJSON = function toJSON() { return { ambientReplacement: true }; };
    try {
      cache.set('GET', URL_A, cacheableBody({ real: 'value' }), HEADERS);
      await whenSettled(cache);
    } finally {
      delete prototype.toJSON;
    }

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    expect((restarted.get('GET', URL_A, HEADERS) as { data?: { real?: string } })?.data?.real ?? null)
      .toBe('value');
  });

  it('PC-55 every binary body either restores EXACTLY or is refused outright', async () => {
    const directory = makeCacheDir('binary-exactness');

    // PC-32 asserts containment flags — that nothing escaped — and never what
    // was actually stored. This asserts the property that matters: for each
    // hostile shape, the artifact either round-trips with the exact runtime
    // type and bytes, or no artifact exists at all. Silently filing something
    // else is the outcome the contract forbids.
    const spoofedTag = new Uint8Array([255]);
    Object.defineProperty(spoofedTag, Symbol.toStringTag, { value: 'Int8Array' });

    const lyingView = new Uint8Array([1, 2]);
    let getterReads = 0;
    for (const key of ['buffer', 'byteOffset', 'byteLength'] as const) {
      Object.defineProperty(lyingView, key, {
        get() {
          getterReads += 1;
          return key === 'buffer' ? new Uint8Array([9]).buffer : 0;
        },
      });
    }

    const cases: Array<[string, unknown, { kind: string; bytes: number[] } | null]> = [
      ['proxy-arraybuffer', new Proxy(new Uint8Array([1, 2, 255]).buffer, {}), null],
      ['proxy-buffer', new Proxy(Buffer.from([1, 2]), {}), null],
      ['spoofed-tag', spoofedTag, { kind: 'Uint8Array', bytes: [255] }],
      ['lying-getters', lyingView, { kind: 'Uint8Array', bytes: [1, 2] }],
    ];

    const observed: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [label, body, want] of cases) {
      const caseDirectory = makeCacheDir(`binary-${label}`);
      const first = makeCache(caseDirectory);
      await whenSettled(first);
      first.set('GET', URL_A, cacheableBody(body), HEADERS);
      await whenSettled(first);

      const restarted = makeCache(caseDirectory);
      await whenSettled(restarted);
      const hydrated = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;
      const filed = listing(caseDirectory).length;

      observed[label] = filed === 0
        ? 'refused'
        : {
            kind: Object.prototype.toString.call(hydrated).slice(8, -1),
            bytes: ArrayBuffer.isView(hydrated)
              ? Array.from(new Uint8Array((hydrated as Uint8Array).buffer, (hydrated as Uint8Array).byteOffset, (hydrated as Uint8Array).byteLength))
              : hydrated instanceof ArrayBuffer ? Array.from(new Uint8Array(hydrated)) : null,
          };
      expected[label] = want === null ? 'refused' : want;
    }

    expect({ ...observed, getterReads }).toEqual({ ...expected, getterReads: 0 });
    void directory;
  });

  it('PC-60 an ARRAY body is prototype-proof too, on every ambient path', async () => {
    // PC-50 and PC-54 use object bodies only. `detachPrototypes` returned
    // `value.map(...)` for arrays — a call through mutable `Array.prototype`
    // that hands back a prototypeful Array — so all three ambient paths could
    // still rewrite an array artifact. Objects were made safe and the sibling
    // was left, which is the same mistake as clear/remove/rename.
    const cases: Array<[string, () => () => void]> = [
      ['object-tojson', () => {
        const prototype = Object.prototype as unknown as Record<string, unknown>;
        prototype.toJSON = () => ({ ambientArrayReplacement: true });
        return () => { delete prototype.toJSON; };
      }],
      ['array-tojson', () => {
        const prototype = Array.prototype as unknown as Record<string, unknown>;
        prototype.toJSON = () => ['substituted'];
        return () => { delete prototype.toJSON; };
      }],
      ['array-map', () => {
        const prototype = Array.prototype as unknown as Record<string, unknown>;
        const realMap = prototype.map;
        prototype.map = () => ['mapped-away'];
        return () => { prototype.map = realMap; };
      }],
    ];

    const observed: Record<string, unknown> = {};
    for (const [label, poison] of cases) {
      const caseDirectory = makeCacheDir(`array-proto-${label}`);
      const cache = makeCache(caseDirectory);
      await whenSettled(cache);

      const restore = poison();
      try {
        cache.set('GET', URL_A, cacheableBody([1, 2, 3]), HEADERS);
        await whenSettled(cache);
      } finally {
        restore();
      }

      const restarted = makeCache(caseDirectory);
      await whenSettled(restarted);
      observed[label] = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data ?? null;
    }

    expect(observed).toEqual({
      'object-tojson': [1, 2, 3],
      'array-tojson': [1, 2, 3],
      'array-map': [1, 2, 3],
    });
  });

  it('PC-62 a tampered view kind cannot reach an inherited table property', async () => {
    // The restore table is an object literal, so it inherits `constructor`,
    // `toString`, `valueOf` and friends, and its key comes off DISK. Without an
    // own-property guard, `t: "constructor"` resolves to `Object` and
    // `new Object(buffer)` hands the caller back the raw ArrayBuffer under a
    // typed-array tag.
    //
    // Two `hasOwnProperty` guards already prevent this — verified by probe, not
    // by reading — so this row exists to keep it that way: nothing in the module
    // states the property, and a refactor could drop either guard silently.
    const observed: Record<string, unknown> = {};
    for (const kind of ['Uint8Array', 'constructor', 'toString', '__proto__', 'valueOf', 'NotAReal']) {
      const directory = makeCacheDir(`view-kind-${kind.replace(/[^a-z]/gi, '') || 'proto'}`);
      const cache = makeCache(directory);
      await whenSettled(cache);
      cache.set('GET', URL_A, cacheableBody(new Uint8Array([1, 2, 3])), HEADERS);
      await whenSettled(cache);

      // Tamper ONLY the view-kind string, leaving a fully valid artifact.
      const [file] = listing(directory);
      const artifact = JSON.parse(readFileSync(join(directory, file), 'utf-8')) as
        { body: { t: string } };
      artifact.body.t = kind;
      writeFileSync(join(directory, file), JSON.stringify(artifact), 'utf-8');

      const restarted = makeCache(directory);
      await whenSettled(restarted);
      const data = (restarted.get('GET', URL_A, HEADERS) as { data?: unknown })?.data;
      observed[kind] = data === undefined
        ? 'refused'
        : (Object.getPrototypeOf(data) as { constructor?: { name?: string } })?.constructor?.name ?? 'null-proto';
    }

    expect(observed).toEqual({
      Uint8Array: 'Uint8Array',
      constructor: 'refused',
      toString: 'refused',
      __proto__: 'refused',
      valueOf: 'refused',
      NotAReal: 'refused',
    });
  });

  it('PC-63 publishing replaces the live artifact, never writes into it', async () => {
    // The carrier claimed atomic publication and proved nothing: a mutant that
    // wrote straight to the final path, with no temp file and no rename, passed
    // all 62 rows. Atomicity was asserted in a comment, not by a test.
    //
    // Racing a reader against a partial write would be flaky, so this pins the
    // property that MAKES publication atomic and is deterministic: the existing
    // artifact is never opened for writing. It is replaced by `rename`, which
    // POSIX allows over a read-only file (permission belongs to the directory),
    // while an in-place write to that same file gets EACCES. A reader holding
    // the old file therefore always holds a complete version of it.
    const directory = makeCacheDir('atomic-publish');
    const cache = makeCache(directory);
    await whenSettled(cache);

    cache.set('GET', URL_A, cacheableBody({ generation: 'first' }), HEADERS);
    await whenSettled(cache);

    const [artifact] = listing(directory);
    const artifactPath = join(directory, artifact);
    chmodSync(artifactPath, 0o444);

    // Same identity, so this republishes to that exact read-only path.
    cache.set('GET', URL_A, cacheableBody({ generation: 'second' }), HEADERS);
    await whenSettled(cache);

    const restarted = makeCache(directory);
    await whenSettled(restarted);
    const restored = (restarted.get('GET', URL_A, HEADERS) as { data?: { generation?: string } })
      ?.data?.generation;

    chmodSync(artifactPath, 0o644);
    expect({ artifacts: listing(directory).length, restored })
      .toEqual({ artifacts: 1, restored: 'second' });
  });

  it('PC-64 hydration reaps expired artifacts, so a long-lived directory cannot grow forever', async () => {
    // There are two disk read paths — bulk hydration and a lazy per-identity
    // read on a memory miss — and PC-02 passes with EITHER disabled, because
    // the surviving one still serves the entry. That redundancy is good for
    // consumers but it left hydration's own effects unproven.
    //
    // This is the effect only hydration has: an artifact whose TTL has run out
    // is removed from disk at load. Without it nothing ever collects expired
    // entries and a long-lived cache directory grows without bound.
    const directory = makeCacheDir('expiry-reaping');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('stale'), HEADERS);
    await whenSettled(cache);

    // Age the artifact deterministically rather than waiting on a real TTL.
    const [artifact] = listing(directory);
    const artifactPath = join(directory, artifact);
    const envelope = JSON.parse(readFileSync(artifactPath, 'utf-8')) as
      { timestamp: number; ttl: number };
    envelope.timestamp = Date.now() - (envelope.ttl + 60_000);
    writeFileSync(artifactPath, JSON.stringify(envelope), 'utf-8');

    const restarted = makeCache(directory);
    await whenSettled(restarted);

    expect({
      artifactsLeftOnDisk: listing(directory).length,
      served: restarted.get('GET', URL_A, HEADERS) === undefined ? 'miss' : 'hit',
    }).toEqual({ artifactsLeftOnDisk: 0, served: 'miss' });
  });

  it('PC-12 no artifact records a raw URL or raw request-header material', async () => {
    const directory = makeCacheDir('digests');
    const cache = makeCache(directory);
    await whenSettled(cache);
    cache.set('GET', URL_A, cacheableResponse('digest-only'), HEADERS);
    await whenSettled(cache);

    const leaks: string[] = [];
    for (const file of listing(directory)) {
      const contents = readFileSync(join(directory, file), 'utf-8');
      if (file.includes('example.invalid') || contents.includes(URL_A)) leaks.push(`${file}:url`);
      if (contents.includes('tenant-secret')) leaks.push(`${file}:authorization`);
      try {
        const decoded = Buffer.from(file.replace(/\.json$/, ''), 'base64url').toString('utf-8');
        if (decoded.includes('example.invalid')) leaks.push(`${file}:filename-url`);
      } catch { /* not a decodable name */ }
    }

    expect(leaks).toEqual([]);
  });
});

/**
 * Cross-process lease rows.
 *
 * PC-17/18/19/27 prove refusal logic against a lease FILE and sibling sharing
 * inside one process. They cannot prove what the lease exists for — two LIVE
 * processes contending on the exclusive create, a holder surviving a contender,
 * token-authenticated cleanup on a normal exit, and no-steal after a crash.
 * These rows spawn real processes and synchronise on observed NDJSON events
 * rather than sleeps.
 */
describe('cache-directory lease across real processes', () => {
  const DRIVER = resolve('test/fixtures/response-cache/lease-driver.ts');

  interface Driver {
    child: ReturnType<typeof spawn>;
    next(event: string): Promise<Record<string, unknown>>;
    send(command: string): void;
    kill(signal: NodeJS.Signals): void;
    closed(): Promise<void>;
  }

  function startDriver(directory: string, mode?: 'poison'): Driver {
    // Never the `tsx` shim: it spawns a child, so a SIGKILL would land on the
    // wrapper while the real holder exited CLEANLY — running its lease cleanup
    // and quietly turning the crash row into a clean-exit row that passes. The
    // process we signal has to be the one holding the lease.
    //
    // And runtime-aware: Bun executes TypeScript natively, while
    // `bun --import tsx` fails outright with `Cannot find module
    // './cjs/index.cjs'`. Under a Bun host the lease rows would otherwise never
    // run at all — the proof has to execute on the runtime it claims to cover.
    const onBun = Boolean((process.versions as { bun?: string }).bun);
    const child = spawn(
      process.execPath,
      onBun
        ? [DRIVER, directory, ...(mode ? [mode] : [])]
        : ['--import', 'tsx', DRIVER, directory, ...(mode ? [mode] : [])],
      // stderr is piped and DRAINED into a bounded buffer: ignoring it hid why
      // a child died, and leaving it unread can fill the pipe and block.
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const events: Record<string, unknown>[] = [];
    const consumed = new Set<number>();
    const waiters: Array<{ event: string; resolve: (value: Record<string, unknown>) => void }> = [];
    let buffered = '';
    // A spawn failure is otherwise invisible: without this the child simply
    // never speaks, and every wait times out with "saw []" — which describes
    // the symptom and hides the cause.
    let spawnFailure: string | null = null;
    let stderrTail = '';
    child.on('error', (error: Error) => { spawnFailure = `spawn failed: ${error.message}`; });
    child.stderr!.setEncoding('utf-8');
    child.stderr!.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-600);
    });

    child.stdout!.setEncoding('utf-8');
    child.stdout!.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          events.push(parsed);
          const index = waiters.findIndex((waiter) => waiter.event === parsed.event);
          if (index >= 0) {
            consumed.add(parsed.seq as number);
            waiters.splice(index, 1)[0].resolve(parsed);
          }
        }
        newline = buffered.indexOf('\n');
      }
    });

    return {
      child,
      // CONSUMING: each call returns an event not yet handed out. A
      // non-consuming reader would answer a second `use` with the first
      // `bound` line, so "reported exactly once" could never fail.
      next: (event) => {
        const index = events.findIndex((entry) => entry.event === event && !consumed.has(entry.seq as number));
        if (index >= 0) {
          const seen = events[index];
          consumed.add(seen.seq as number);
          return Promise.resolve(seen);
        }
        // A bounded wait that reports what DID arrive: an unbounded one turns
        // any harness mistake into an indistinguishable timeout.
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(
              spawnFailure
                ?? `waited for "${event}"; saw ${JSON.stringify(events)} `
                  + `(exit=${child.exitCode}, signal=${child.signalCode}) stderr: ${stderrTail.trim()}`,
            ));
          }, 20_000);
          waiters.push({
            event,
            resolve: (value) => { clearTimeout(timer); resolve(value); },
          });
        });
      },
      send: (command) => { child.stdin!.write(`${command}\n`); },
      kill: (signal) => { child.kill(signal); },
      // Bounded, and it force-kills rather than waiting forever: a child that
      // fails to exit is a defect to report, not a reason to wedge the suite.
      closed: () => new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 15_000);
        child.on('close', () => { clearTimeout(timer); resolve(); });
      }),
    };
  }

  it('PC-33 one live holder, one refused contender — and the holder keeps working', async () => {
    const directory = makeCacheDir('cross-holder');
    const holder = startDriver(directory);
    const holderReady = await holder.next('ready');

    // Only once the holder actually owns the directory does the contender start.
    const contender = startDriver(directory);
    const contenderReady = await contender.next('ready');

    contender.send('use');
    const contenderBound = await contender.next('bound');
    holder.send('store');
    const holderStored = await holder.next('set');

    holder.send('exit');
    contender.send('exit');
    await holder.closed();
    await contender.closed();

    expect({
      holder: { state: holderReady.state, persistent: holderReady.isPersistent },
      contender: { state: contenderReady.state, persistent: contenderReady.isPersistent },
      contenderCode: contenderBound.code,
      holderStored: holderStored.ok,
    }).toEqual({
      holder: { state: 'ready', persistent: true },
      contender: { state: 'unavailable', persistent: false },
      contenderCode: 'REZ_CACHE_PERSISTENCE_UNAVAILABLE',
      holderStored: true,
    });
  }, 120_000);

  it('PC-56 two processes racing for the same directory yield exactly one holder', async () => {
    const directory = makeCacheDir('cross-simultaneous');
    // PC-33 waits for the holder to be ready before starting the contender, so
    // it never actually races. Both are started in the same tick here: the
    // exclusive create is the arbiter, and exactly one must win.
    const first = startDriver(directory);
    const second = startDriver(directory);
    const [a, b] = await Promise.all([first.next('ready'), second.next('ready')]);

    first.send('exit');
    second.send('exit');
    await first.closed();
    await second.closed();

    const states = [a.state, b.state].sort();
    expect({ states, persistentCount: [a.isPersistent, b.isPersistent].filter(Boolean).length })
      .toEqual({ states: ['ready', 'unavailable'], persistentCount: 1 });
  }, 120_000);

  it('PC-57 a refused contender reports -1078 exactly once, not on every use', async () => {
    const directory = makeCacheDir('cross-once-only');
    const holder = startDriver(directory);
    await holder.next('ready');
    const contender = startDriver(directory);
    await contender.next('ready');

    // Three separate bound uses, three separate answers — the consuming reader
    // is what makes this checkable at all.
    contender.send('use');
    const first = await contender.next('bound');
    contender.send('use');
    const second = await contender.next('bound');
    contender.send('use');
    const third = await contender.next('bound');

    holder.send('exit');
    contender.send('exit');
    await holder.closed();
    await contender.closed();

    expect([first.code, second.code, third.code])
      .toEqual(['REZ_CACHE_PERSISTENCE_UNAVAILABLE', 'none', 'none']);
  }, 120_000);

  it('PC-58 a lease replaced by a different token is not removed on exit', async () => {
    const directory = makeCacheDir('cross-token-mismatch');
    const holder = startDriver(directory);
    await holder.next('ready');
    holder.send('lease');
    const held = await holder.next('lease');
    expect(typeof held.contents).toBe('string');

    // The HOLDER's own pid with a different token. Using the test's pid instead
    // would let a PID-only unlink pass by accident — it would mismatch for the
    // wrong reason — so the row could not distinguish token authentication from
    // pid authentication at all.
    const replacement = JSON.stringify({
      pid: holder.child.pid, token: 'someone-elses-token', startedAt: Date.now(),
    });
    writeFileSync(join(directory, LEASE_FILE), replacement, 'utf-8');

    holder.send('exit');
    await holder.closed();

    expect(readFileSync(join(directory, LEASE_FILE), 'utf-8')).toBe(replacement);
  }, 120_000);

  it('PC-59 a malformed lease is preserved byte-for-byte, not repaired or removed', async () => {
    const directory = makeCacheDir('cross-malformed-lease');
    const malformed = 'this is not json at all';
    writeFileSync(join(directory, LEASE_FILE), malformed, 'utf-8');

    const driver = startDriver(directory);
    const ready = await driver.next('ready');
    driver.send('exit');
    await driver.closed();

    // Unreadable is not unowned: the file stays exactly as found, and the
    // store refuses rather than assuming the directory is free.
    expect({ state: ready.state, contents: readFileSync(join(directory, LEASE_FILE), 'utf-8') })
      .toEqual({ state: 'unavailable', contents: malformed });
  }, 120_000);

  it('PC-61 an ambient toJSON cannot cost a process the token to its own lease', async () => {
    // The sibling of PC-60 on the OTHER serialization site. `detachPrototypes`
    // hardened the envelope, but the lease was still written from a plain
    // object literal carrying `Object.prototype` — so an ambient `toJSON`
    // replaced the whole lease, taking the token with it.
    //
    // The damage is worse than a corrupt entry. Exit cleanup authenticates by
    // token, so the process could no longer recognise its OWN lease; the file
    // outlived it, and every later run — clean ones included — found the
    // directory held and went permanently `unavailable`. One dependency
    // patching Object.prototype disabled the cache directory for good.
    const directory = makeCacheDir('lease-ambient-tojson');

    const poisoned = startDriver(directory, 'poison');
    const ready = await poisoned.next('ready');
    poisoned.send('exit');
    await poisoned.closed();

    const leaseSurvivedItsOwner = readdirSync(directory).includes(LEASE_FILE);

    // The real consequence, measured on a completely clean successor.
    const successor = startDriver(directory);
    const successorReady = await successor.next('ready');
    successor.send('exit');
    await successor.closed();

    expect({
      poisonedRunPersisted: ready.isPersistent,
      leaseSurvivedItsOwner,
      successorState: successorReady.state,
    }).toEqual({
      poisonedRunPersisted: true,
      leaseSurvivedItsOwner: false,
      successorState: 'ready',
    });
  }, 120_000);

  it('PC-34 a normal exit releases the lease and the next process reacquires it', async () => {
    const directory = makeCacheDir('cross-clean-exit');
    const first = startDriver(directory);
    await first.next('ready');
    first.send('exit');
    await first.closed();

    // The lease file must be gone once the owner has exited cleanly.
    const leaseAfterExit = readdirSync(directory).includes(LEASE_FILE);

    const second = startDriver(directory);
    const secondReady = await second.next('ready');
    second.send('exit');
    await second.closed();

    expect({ leaseAfterExit, reacquired: secondReady.state })
      .toEqual({ leaseAfterExit: false, reacquired: 'ready' });
  }, 120_000);

  it('PC-35 a crashed holder leaves its lease, is never stolen, and unlinking recovers it', async () => {
    const directory = makeCacheDir('cross-crash');
    const holder = startDriver(directory);
    await holder.next('ready');

    // SIGKILL: no exit handler can run, so the lease is left behind exactly as
    // a real crash leaves it.
    holder.kill('SIGKILL');
    await holder.closed();

    const leaseAfterCrash = readFileSync(join(directory, LEASE_FILE), 'utf-8');

    const afterCrash = startDriver(directory);
    const afterCrashReady = await afterCrash.next('ready');
    afterCrash.send('exit');
    await afterCrash.closed();

    // Not stolen: a successor cannot tell a crashed owner from a live idle one,
    // so it refuses and leaves the lease untouched.
    const leaseUntouched = readFileSync(join(directory, LEASE_FILE), 'utf-8') === leaseAfterCrash;

    // Explicit operator recovery is the only thing that reclaims it.
    rmSync(join(directory, LEASE_FILE));
    const recovered = startDriver(directory);
    const recoveredReady = await recovered.next('ready');
    recovered.send('exit');
    await recovered.closed();

    expect({
      afterCrash: afterCrashReady.state,
      leaseUntouched,
      recovered: recoveredReady.state,
    }).toEqual({ afterCrash: 'unavailable', leaseUntouched: true, recovered: 'ready' });
  }, 120_000);
});
