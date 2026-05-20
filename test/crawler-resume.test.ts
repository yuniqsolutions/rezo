import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Crawler, NavigationHistory } from '../src/crawler/index.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-crawler-resume-test-'));
}

function createHtmlResponse(url: string, contentLength = 96) {
  return {
    data: `<html><head><title>${url}</title></head><body><main>${url}</main></body></html>`,
    contentType: 'text/html; charset=utf-8',
    finalUrl: url,
    url,
    headers: {},
    status: 200,
    contentLength
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('Crawler navigation history', () => {
  it('marks sessions completed and recreates completed session IDs cleanly on the next run', async () => {
    const tempDir = createTempDir();

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'resume-session',
        cacheDir: tempDir
      }, {
        get: async (url: string) => createHtmlResponse(url),
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      crawler.visit('/first-run');
      await crawler.waitForAll();

      expect(crawler.getSession()?.status).toBe('completed');
      await crawler.destroy();

      const nextCrawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'resume-session',
        cacheDir: tempDir
      }, {
        get: async (url: string) => createHtmlResponse(url),
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      await (nextCrawler as any).waitForNavigationHistory();

      expect(nextCrawler.getSession()).not.toBeNull();
      expect(nextCrawler.getSession()?.sessionId).toBe('resume-session');
      expect(nextCrawler.getSession()?.status).toBe('running');

      nextCrawler.visit('/second-run');
      await nextCrawler.waitForAll();
      expect(nextCrawler.getSession()?.status).toBe('completed');

      await nextCrawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('pauses queue processing and resumes the same session without duplicating queued URLs', async () => {
    const tempDir = createTempDir();
    const calls: string[] = [];

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'pause-session',
        cacheDir: tempDir
      }, {
        get: async (url: string) => {
          calls.push(url);
          await new Promise(resolve => setTimeout(resolve, 40));
          return createHtmlResponse(url);
        },
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      crawler.visit('/one');
      crawler.visit('/two');

      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return queue.pending === 1 && queue.size === 1;
      });

      await crawler.pause();
      expect((crawler as any).queue.isPaused).toBe(true);

      await waitUntil(() => calls.length === 1, 2000);
      expect(calls).toEqual(['https://example.com/one']);

      await crawler.resume();
      await crawler.waitForAll();

      expect(calls).toEqual([
        'https://example.com/one',
        'https://example.com/two'
      ]);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('removes skipped oversized responses from the persisted queue', async () => {
    const tempDir = createTempDir();

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'skip-session',
        cacheDir: tempDir,
        maxResponseSize: 10
      }, {
        get: async (url: string) => createHtmlResponse(url, 200),
        post: async (url: string) => createHtmlResponse(url, 200),
        patch: async (url: string) => createHtmlResponse(url, 200),
        put: async (url: string) => createHtmlResponse(url, 200)
      } as any);

      crawler.visit('/too-large');
      await crawler.waitForAll();

      const history = (crawler as any).navigationHistory;
      const queued = await history.getAllQueuedUrls(crawler.getSessionId());

      expect(queued).toEqual([]);
      expect(crawler.getSession()?.status).toBe('completed');

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resumes a different paused session without replaying stale in-memory queued URLs', async () => {
    const tempDir = createTempDir();
    const calls: string[] = [];

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'session-a',
        cacheDir: tempDir
      }, {
        get: async (url: string) => {
          calls.push(url);
          await new Promise(resolve => setTimeout(resolve, 40));
          return createHtmlResponse(url);
        },
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      crawler.visit('/one');
      crawler.visit('/two');

      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return queue.pending === 1 && queue.size === 1;
      });

      await crawler.pause();
      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return calls.length === 1 && queue.pending === 0 && queue.size === 1;
      }, 2000);

      const history = (crawler as any).navigationHistory as NavigationHistory;
      await history.createSession('session-b', 'https://example.com');
      await history.addToQueue('session-b', 'https://example.com/from-other');

      await crawler.resume('session-b');
      await crawler.waitForAll();

      expect(calls).toEqual([
        'https://example.com/one',
        'https://example.com/from-other'
      ]);
      expect((await history.getAllQueuedUrls('session-a')).map((entry) => entry.url)).toEqual([
        'https://example.com/two'
      ]);
      expect(crawler.getSession()?.sessionId).toBe('session-b');
      expect(crawler.getSession()?.status).toBe('completed');

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects cross-session resume while the current session still has active in-memory work', async () => {
    const tempDir = createTempDir();

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'session-a',
        cacheDir: tempDir
      }, {
        get: async (url: string) => {
          await new Promise(resolve => setTimeout(resolve, 80));
          return createHtmlResponse(url);
        },
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      crawler.visit('/one');
      crawler.visit('/two');

      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return queue.pending === 1 && queue.size === 1;
      });

      await crawler.pause();

      const history = (crawler as any).navigationHistory as NavigationHistory;
      await history.createSession('session-b', 'https://example.com');
      await history.addToQueue('session-b', 'https://example.com/from-other');

      await expect(crawler.resume('session-b')).rejects.toThrow(
        "Cannot resume session 'session-b' while session 'session-a' still has active in-memory work."
      );

      await crawler.resume();
      await crawler.waitForAll();
      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists queued session stats from navigation history during checkpoints', async () => {
    const tempDir = createTempDir();

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        enableNavigationHistory: true,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        sessionId: 'checkpoint-session',
        cacheDir: tempDir
      }, {
        get: async (url: string) => {
          await new Promise(resolve => setTimeout(resolve, 40));
          return createHtmlResponse(url);
        },
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      crawler.visit('/one');
      crawler.visit('/two');

      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return queue.pending === 1 && queue.size === 1;
      });

      await crawler.pause();
      await waitUntil(() => {
        const queue = (crawler as any).queue;
        return queue.pending === 0 && queue.size === 1;
      }, 2000);

      await crawler.saveCheckpoint();

      const history = (crawler as any).navigationHistory as NavigationHistory;
      const session = await history.getSession('checkpoint-session');

      expect(session?.urlsQueued).toBe(1);
      expect(session?.urlsVisited).toBe(1);
      expect(session?.urlsFailed).toBe(0);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
