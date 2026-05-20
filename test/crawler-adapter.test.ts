import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Rezo } from '../src/core/rezo.js';
import type { RezoResponse } from '../src/types/response';

vi.mock('../src/adapters/picker.js', () => ({
  loadAdapter: vi.fn()
}));

import { loadAdapter } from '../src/adapters/picker.js';
import { Crawler } from '../src/crawler/index.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-crawler-adapter-test-'));
}

function createAdapterResponse(url: string): RezoResponse<string> {
  return {
    data: '<html><head><title>adapted</title></head><body></body></html>',
    status: 200,
    statusText: 'OK',
    finalUrl: url,
    cookies: {} as any,
    headers: {} as any,
    contentType: 'text/html; charset=utf-8',
    contentLength: 62,
    urls: [url],
    config: { url } as any,
    httpVersion: '1.1'
  };
}

describe('Crawler adapter selection', () => {
  it('uses the configured adapter executor for crawl requests', async () => {
    const tempDir = createTempDir();
    const loadAdapterMock = vi.mocked(loadAdapter);

    loadAdapterMock.mockResolvedValue({
      executeRequest: vi.fn(async (options: any) => createAdapterResponse(options.url))
    } as any);

    try {
      const fallbackHttp = new Rezo({}, async () => {
        throw new Error('base adapter should not be used');
      });

      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        adapter: 'fetch',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir
      }, fallbackHttp);

      const titles: string[] = [];
      crawler.onDocument(async (document) => {
        titles.push(document.title);
      });

      crawler.visit('/adapted');
      await crawler.waitForAll();

      expect(loadAdapterMock).toHaveBeenCalledWith('fetch');
      expect(titles).toEqual(['adapted']);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
