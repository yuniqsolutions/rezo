import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Crawler, UrlStore } from '../src/crawler/index.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-crawler-test-'));
}

function createFakeHttp() {
  const respond = async (url: string) => ({
    data: `<html><head><title>${url}</title></head><body><main>${url}</main></body></html>`,
    contentType: 'text/html; charset=utf-8',
    finalUrl: url,
    url,
    headers: {},
    status: 200,
    contentLength: 96
  });

  return {
    get: respond,
    post: respond,
    patch: respond,
    put: respond
  } as any;
}

describe('Crawler lifecycle', () => {
  it('runs start once, awaits finish, and preserves exportable data after waitForAll', async () => {
    const tempDir = createTempDir();
    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir
      }, createFakeHttp());

      let startCount = 0;
      let finishComplete = false;
      let documentObservedStarted = true;

      crawler.onStart(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        startCount++;
      });

      crawler.onDocument(async (document) => {
        documentObservedStarted = documentObservedStarted && startCount === 1;
        crawler.collect({ title: document.title });
      });

      crawler.onFinish(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        finishComplete = true;
      });

      crawler.visit('/first');
      crawler.visit('/second');

      await crawler.waitForAll();

      expect(startCount).toBe(1);
      expect(documentObservedStarted).toBe(true);
      expect(finishComplete).toBe(true);
      expect(crawler.getCollectedData()).toEqual([
        { title: 'https://example.com/first' },
        { title: 'https://example.com/second' }
      ]);

      const exportPath = path.join(tempDir, 'results.json');
      await crawler.exportData(exportPath, 'json');

      expect(JSON.parse(fs.readFileSync(exportPath, 'utf8'))).toEqual([
        { title: 'https://example.com/first' },
        { title: 'https://example.com/second' }
      ]);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws when visit is called after destroy', async () => {
    const tempDir = createTempDir();
    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir
      }, createFakeHttp());

      crawler.visit('/before-destroy');
      await crawler.waitForAll();
      await crawler.destroy();

      expect(() => crawler.visit('/after-destroy')).toThrow(/destroyed/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('UrlStore memory bounds', () => {
  it('caps the in-memory default visited cache without losing correctness', async () => {
    const tempDir = createTempDir();
    try {
      const store = await UrlStore.create({
        storeDir: tempDir,
        inMemoryMaxUrls: 5
      });

      const urls = Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`);
      await store.setMany(urls, 'default');

      expect((store as any).inMemoryVisited.size).toBeLessThanOrEqual(5);
      await expect(store.has(urls[0], 'default')).resolves.toBe(true);
      await expect(store.has(urls[19], 'default')).resolves.toBe(true);

      await store.close();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
