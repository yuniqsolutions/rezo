/**
 * Sept 9 persistence review: desired-property REDs on unchanged source.
 * All filesystem mutations target this carrier's disposable fixtures. A fresh
 * cache below is a new same-process instance, not a process restart/crash test.
 * PR-01..06 reproduce the six authenticated STEPS counterexamples. Later rows
 * extend variant/capture coverage; controls prove actual JSON/binary hydration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResponseCache } from '../src/cache/response-cache.js';
import { cachePersistence } from '../src/cache/response-cache-readiness.js';
import { createResponseCacheIdentity, sha256Hex } from '../src/cache/response-cache-identity.js';
import type { RezoResponse } from '../src/types/response.js';

const URL_UNDER_TEST = 'https://example.invalid/persistence-review';
const REQUEST_HEADERS = { accept: 'application/json' };
const IDENTITY = createResponseCacheIdentity({
  method: 'GET', url: URL_UNDER_TEST, mode: null, headers: REQUEST_HEADERS,
});
const ARTIFACT = `rezo-v2-${sha256Hex(IDENTITY)}.json`;
const directories: string[] = [];
const caches: ResponseCache[] = [];
type FileHandle = Awaited<ReturnType<typeof fs.promises.open>>;
const openHandles = new Set<FileHandle>();

async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded 5 seconds`)), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function makeDirectory(label: string): string {
  // Match the product's canonical path: /var and /private/var differ on macOS.
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), `rezo-review-${label}-`)));
  directories.push(directory);
  return directory;
}

function makeCache(directory: string): ResponseCache {
  const cache = new ResponseCache({ enable: true, ttl: 60_000, cacheDir: directory });
  caches.push(cache);
  return cache;
}

async function drain(cache: ResponseCache): Promise<void> {
  const store = cachePersistence(cache);
  expect(store, 'private readiness oracle must exist').toBeDefined();
  if (!store) throw new Error('Missing cache persistence oracle');
  await bounded((async () => { await store.drain(); await store.drain(); })(), 'cache drain');
  expect({ state: store.state, persistent: cache.isPersistent }).toEqual({ state: 'ready', persistent: true });
}

function set(cache: ResponseCache, data: unknown): void {
  // This cache-only fixture deliberately omits unused transport/cookie metadata
  // and exercises the accepted plain-header-map path, not a wire RezoResponse.
  cache.set('GET', URL_UNDER_TEST, {
    data, status: 200, statusText: 'OK',
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }, config: {},
  } as unknown as RezoResponse, REQUEST_HEADERS);
}

async function hydrate(directory: string): Promise<unknown> {
  const fresh = makeCache(directory);
  await drain(fresh);
  return fresh.get('GET', URL_UNDER_TEST, REQUEST_HEADERS)?.data;
}

function contents(path: string): string | undefined {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : undefined;
}

function isFixtureTemp(path: unknown, directory: string): boolean {
  return String(path).startsWith(`${join(directory, ARTIFACT)}.`) && String(path).endsWith('.tmp');
}

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await bounded(Promise.all(caches.map(async (cache) => {
      const store = cachePersistence(cache);
      if (store) { await store.drain(); await store.drain(); }
    })), 'fixture teardown drain');
  } finally {
    caches.length = 0;
    try {
      await bounded(Promise.all([...openHandles].map((handle) => handle.close())), 'fixture handle cleanup');
    } finally {
      openHandles.clear();
      for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}, 15_000);

describe('persistence review regressions — desired properties, not bug-observation passes', () => {
  it('PR-C01 CONTROL: ordinary JSON persists and hydrates in a fresh instance', async () => {
    const directory = makeDirectory('json-control');
    const cache = makeCache(directory);
    await drain(cache);
    set(cache, { generation: 'ordinary-json', nested: [1, true, null] });
    await drain(cache);
    expect(fs.existsSync(join(directory, ARTIFACT))).toBe(true);
    expect(await hydrate(directory)).toEqual({ generation: 'ordinary-json', nested: [1, true, null] });
  }, 15_000);

  it('PR-C02 CONTROL: ordinary Blob bytes and MIME persist and hydrate', async () => {
    const directory = makeDirectory('blob-control');
    const cache = makeCache(directory);
    await drain(cache);
    set(cache, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await drain(cache);
    expect(fs.existsSync(join(directory, ARTIFACT))).toBe(true);
    const hydrated = await hydrate(directory);
    expect(hydrated).toBeInstanceOf(Blob);
    const blob = hydrated as Blob;
    expect({ bytes: [...new Uint8Array(await bounded(blob.arrayBuffer(), 'Blob read'))], type: blob.type })
      .toEqual({ bytes: [1, 2, 3], type: 'image/png' });
  }, 15_000);

  it.each([
    { k: 'json', v: { ok: true } },
    { k: 'buffer', v: 'AQID' },
    { k: 'arraybuffer', v: 'AQID' },
    { k: 'blob', v: 'AQID', t: 'image/png' },
    { k: 'view', v: 'AQID', t: 'Uint8Array' },
  ])('PR-01 an unknown nested $k body field is refused without changing the foreign artifact', async (body) => {
    const directory = makeDirectory('nested-schema');
    const path = join(directory, ARTIFACT);
    const bytes = JSON.stringify({
      v: 2, identity: IDENTITY, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { ...body, extra: 'foreign-extension' },
      timestamp: Date.now(), ttl: 60_000,
    });
    fs.writeFileSync(path, bytes);
    expect(JSON.parse(fs.readFileSync(path, 'utf8')).body.extra).toBe('foreign-extension');
    const served = await hydrate(directory);
    expect({ served, bytesAfter: contents(path) }).toEqual({ served: undefined, bytesAfter: bytes });
  }, 15_000);

  it('PR-02 a pre-existing next temp name keeps its original operator bytes', async () => {
    const directory = makeDirectory('temp-collision');
    const cache = makeCache(directory);
    await drain(cache);
    const temp = join(directory, `${ARTIFACT}.${(0.5).toString(36).slice(2)}.tmp`);
    const operatorBytes = 'operator-owned-before-temp-create';
    fs.writeFileSync(temp, operatorBytes);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let randomCalls = 0;
    try {
      set(cache, { generation: 'temp-collision' });
      await drain(cache);
      randomCalls = random.mock.calls.length;
    } finally { random.mockRestore(); }
    expect(randomCalls, 'the controlled next temp-name source must have been used').toBeGreaterThan(0);
    // Collision-safe refusal or another owned publication name are both valid.
    expect(contents(temp)).toBe(operatorBytes);
  }, 15_000);

  it('PR-03 publication preserves operator bytes arriving after the final-path check', async () => {
    const directory = makeDirectory('final-replacement');
    const cache = makeCache(directory);
    await drain(cache);
    const finalPath = join(directory, ARTIFACT);
    const operatorBytes = 'operator-arrived-after-final-check';
    const originalWrite = fs.promises.writeFile;
    let replacements = 0;
    const write = vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args) => {
      if (isFixtureTemp(args[0], directory)) {
        fs.writeFileSync(finalPath, operatorBytes);
        replacements += 1;
      }
      return Reflect.apply(originalWrite, fs.promises, args);
    });
    try { set(cache, { generation: 'final-replacement' }); await drain(cache); }
    finally { write.mockRestore(); }
    expect(replacements, 'the foreign final occupant must actually have been installed').toBe(1);
    expect(contents(finalPath)).toBe(operatorBytes);
  }, 15_000);

  it('PR-04 failed publication does not unlink a temp replaced with operator bytes', async () => {
    const directory = makeDirectory('cleanup-replacement');
    const cache = makeCache(directory);
    await drain(cache);
    const operatorBytes = 'operator-replaced-temp-before-failed-rename';
    const originalRename = fs.promises.rename;
    let replacementPath: string | undefined;
    let renameFailures = 0;
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args) => {
      if (isFixtureTemp(args[0], directory)) {
        replacementPath = String(args[0]);
        fs.writeFileSync(replacementPath, operatorBytes);
        renameFailures += 1;
        throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
      }
      return Reflect.apply(originalRename, fs.promises, args);
    });
    try { set(cache, { generation: 'cleanup-replacement' }); await drain(cache); }
    finally { rename.mockRestore(); }
    expect(renameFailures, 'rename must have reached the replacement/failure boundary').toBe(1);
    if (!replacementPath) throw new Error('No replacement path was observed');
    expect({ replacement: contents(replacementPath), finalExists: fs.existsSync(join(directory, ARTIFACT)) })
      .toEqual({ replacement: operatorBytes, finalExists: false });
  }, 15_000);

  it('PR-05 an actual file-handle sync EIO cannot publish a fresh durable entry', async () => {
    const directory = makeDirectory('file-sync-eio');
    const cache = makeCache(directory);
    await drain(cache);
    const originalOpen = fs.promises.open;
    const restorers: Array<() => void> = [];
    let tempOpens = 0;
    let syncFailures = 0;
    let tempCloses = 0;
    const open = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle: FileHandle = await Reflect.apply(originalOpen, fs.promises, args);
      if (isFixtureTemp(args[0], directory)) {
        tempOpens += 1;
        openHandles.add(handle);
        const originalClose = handle.close;
        const sync = vi.spyOn(handle, 'sync').mockImplementation(async () => {
          syncFailures += 1;
          throw Object.assign(new Error('synthetic file sync failure'), { code: 'EIO' });
        });
        const close = vi.spyOn(handle, 'close').mockImplementation(async () => {
          await originalClose.call(handle);
          tempCloses += 1;
          openHandles.delete(handle);
        });
        restorers.push(() => sync.mockRestore(), () => close.mockRestore());
      }
      return handle;
    });
    try { set(cache, { generation: 'must-not-publish-after-sync-eio' }); await drain(cache); }
    finally { open.mockRestore(); for (const restore of restorers) restore(); }
    // A real open succeeded; the actual handle's sync failed, and it was closed.
    expect({ tempOpens, syncFailures, tempCloses }).toEqual({ tempOpens: 1, syncFailures: 1, tempCloses: 1 });
    const freshData = await hydrate(directory);
    expect({ finalExists: fs.existsSync(join(directory, ARTIFACT)), freshData })
      .toEqual({ finalExists: false, freshData: undefined });
  }, 15_000);

  it('PR-06 a post-set Blob prototype replacement cannot substitute persisted bytes', async () => {
    const directory = makeDirectory('late-blob-prototype');
    const cache = makeCache(directory);
    await drain(cache);
    set(cache, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    let replacementCalls = 0;
    const replacement = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async () => {
      replacementCalls += 1;
      return new Uint8Array([9, 8]).buffer;
    });
    try {
      expect(Blob.prototype.arrayBuffer, 'the late prototype substitution must be installed').toBe(replacement);
      await drain(cache);
    } finally { replacement.mockRestore(); }
    const hydrated = await hydrate(directory);
    expect(hydrated).toBeInstanceOf(Blob);
    const blob = hydrated as Blob;
    expect({ bytes: [...new Uint8Array(await bounded(blob.arrayBuffer(), 'Blob read'))], type: blob.type },
      `late replacement invoked ${replacementCalls} time(s); a captured intrinsic may correctly bypass it`)
      .toEqual({ bytes: [1, 2, 3], type: 'image/png' });
  }, 15_000);

  it('PR-07 a post-set Blob constructor replacement cannot substitute accepted MIME metadata', async () => {
    const directory = makeDirectory('late-blob-mime');
    const cache = makeCache(directory);
    await drain(cache);
    set(cache, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    // Bun's native MIME getter is non-configurable, but the global constructor
    // is replaceable on both hosts. This exposes the same deferred lookup.
    const OriginalBlob = Blob;
    class ReplacementBlob extends OriginalBlob {
      override get type(): string { return 'text/plain'; }
    }
    globalThis.Blob = ReplacementBlob;
    try {
      expect(Blob, 'the late global constructor substitution must be installed').toBe(ReplacementBlob);
      await drain(cache);
    } finally { globalThis.Blob = OriginalBlob; }
    const hydrated = await hydrate(directory);
    expect(hydrated).toBeInstanceOf(Blob);
    const blob = hydrated as Blob;
    expect({ bytes: [...new Uint8Array(await bounded(blob.arrayBuffer(), 'Blob read'))], type: blob.type })
      .toEqual({ bytes: [1, 2, 3], type: 'image/png' });
  }, 15_000);

  it('PR-C03 CONTROL: exact binary body variants and null JSON still hydrate', async () => {
    const directory = makeDirectory('body-schema-controls');
    const cache = makeCache(directory);
    await drain(cache);
    const values = [null, Buffer.from([1, 2, 3]), new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 2, 3])];
    for (const value of values) {
      set(cache, value);
      await drain(cache);
      const hydrated = await hydrate(directory);
      expect(hydrated).toEqual(value);
      if (value !== null) expect(Object.getPrototypeOf(hydrated)).toBe(Object.getPrototypeOf(value));
    }
  }, 15_000);

  it('PR-08 Blob persistence keeps acceptance-time headers despite later input mutation', async () => {
    const directory = makeDirectory('late-blob-headers');
    const cache = makeCache(directory);
    await drain(cache);
    const store = cachePersistence(cache);
    if (!store) throw new Error('Missing cache persistence oracle');
    const headers = { 'content-type': 'image/png', 'x-generation': 'accepted' };
    store.write(IDENTITY, {
      identity: IDENTITY, data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      status: 200, statusText: 'OK', headers, timestamp: Date.now(), ttl: 60_000,
    });
    headers['content-type'] = 'text/plain';
    headers['x-generation'] = 'later';
    await drain(cache);
    // This observes disk's decoder directly, not the existing memory entry.
    const accepted = store.readOne(IDENTITY);
    expect(accepted?.headers).toEqual({ 'content-type': 'image/png', 'x-generation': 'accepted' });
    expect(accepted?.data).toBeInstanceOf(Blob);
    expect([...(new Uint8Array(await bounded((accepted!.data as Blob).arrayBuffer(), 'Blob read')))])
      .toEqual([1, 2, 3]);
  }, 15_000);
});
