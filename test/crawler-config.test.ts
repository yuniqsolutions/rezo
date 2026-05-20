import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Crawler, CrawlerOptions, Decodo, Oxylabs } from '../src/crawler/index.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-crawler-config-test-'));
}

function createHtmlResponse(url: string) {
  return {
    data: `<html><head><title>${url}</title></head><body><main>${url}</main></body></html>`,
    contentType: 'text/html; charset=utf-8',
    finalUrl: url,
    url,
    headers: {},
    status: 200,
    contentLength: 96
  };
}

function createRecordingHttp(calls: any[]) {
  const respond = async (url: string, options?: any) => {
    calls.push(options ?? {});
    return createHtmlResponse(url);
  };

  return {
    get: respond,
    post: respond,
    patch: respond,
    put: respond
  } as any;
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

describe('Crawler configuration wiring', () => {
  it('creates a stable-throughput preset with deterministic limiter defaults', async () => {
    const preset = CrawlerOptions.createStableThroughputOptions({
      baseUrl: 'https://example.com/path',
      overrides: {
        enableCache: false
      }
    });

    expect(preset).toMatchObject({
      baseUrl: 'https://example.com/path',
      autoThrottle: false,
      concurrency: 40,
      scraperConcurrency: 10,
      retryDelay: 1000,
      maxRetryAttempts: 2,
      retryOnStatusCode: [408, 500, 502, 503, 504],
      maxWaitOn429: 15000,
      alwaysWaitOn429: false,
      enableCache: false,
      limiter: {
        enable: true,
        limiters: [
          {
            isGlobal: true,
            options: {
              concurrency: 8
            }
          },
          {
            domain: 'example.com',
            options: {
              concurrency: 2,
              interval: 1000,
              intervalCap: 2,
              randomDelay: 150
            },
            retry: {
              enable: true,
              max429Retries: 2,
              retryDelay: 1000,
              maxRetryAttempts: 2,
              backoff: true
            }
          }
        ]
      }
    });

    const crawler = new Crawler(preset, createRecordingHttp([]));
    expect(crawler.config.autoThrottle).toBe(false);
    expect(crawler.config.getRetryOptions('https://example.com/inside')).toMatchObject({
      enable: true,
      max429Retries: 2
    });
    await crawler.destroy();
  });

  it('removes domain-specific limiter and provider queues when domain configs are deleted', () => {
    const options = new CrawlerOptions({
      baseUrl: 'https://example.com'
    });

    options.addLimiter({
      domain: 'example.com',
      options: { concurrency: 1 }
    });
    options.addOxylabs({
      domain: 'example.com',
      options: { username: 'user', password: 'pass' },
      queueOptions: { concurrency: 1 }
    });
    options.addDecodo({
      domain: 'example.com',
      options: { username: 'user', password: 'pass' },
      queueOptions: { concurrency: 1 }
    });

    const limiterDestroy = vi.spyOn(options.getLimiters()[0].pqueue, 'destroy');
    const oxylabsDestroy = vi.spyOn(options.oxylabs[0].pqueue!, 'destroy');
    const decodoDestroy = vi.spyOn(options.decodo[0].pqueue!, 'destroy');

    options.removeDomain('example.com');

    expect(limiterDestroy).toHaveBeenCalledTimes(1);
    expect(oxylabsDestroy).toHaveBeenCalledTimes(1);
    expect(decodoDestroy).toHaveBeenCalledTimes(1);
    expect(options.getConfiguredDomains('decodo')).toEqual([]);
    expect(options.getConfigurationSummary()).toMatchObject({
      limiters: { total: 0 },
      oxylabs: { total: 0 },
      decodo: { total: 0 }
    });
  });

  it('clears global Decodo, Oxylabs, and limiter queues alongside other global configs', () => {
    const options = new CrawlerOptions({
      baseUrl: 'https://example.com',
      proxy: {
        enable: true,
        proxies: [{
          isGlobal: true,
          proxy: {
            protocol: 'http',
            host: 'proxy.local',
            port: 8080
          }
        }]
      },
      limiter: {
        enable: true,
        limiters: [{
          isGlobal: true,
          options: {
            concurrency: 1
          }
        }]
      },
      oxylabs: {
        enable: true,
        labs: [{
          isGlobal: true,
          domain: '*',
          options: {
            username: 'user',
            password: 'pass'
          },
          queueOptions: {
            concurrency: 1
          }
        }]
      },
      decodo: {
        enable: true,
        labs: [{
          isGlobal: true,
          domain: '*',
          options: {
            username: 'user',
            password: 'pass'
          },
          queueOptions: {
            concurrency: 1
          }
        }]
      }
    });

    const limiterDestroy = vi.spyOn(options.getLimiters()[0].pqueue, 'destroy');
    const oxylabsDestroy = vi.spyOn(options.oxylabs[0].pqueue!, 'destroy');
    const decodoDestroy = vi.spyOn(options.decodo[0].pqueue!, 'destroy');

    options.clearGlobalConfigs();

    expect(limiterDestroy).toHaveBeenCalledTimes(1);
    expect(oxylabsDestroy).toHaveBeenCalledTimes(1);
    expect(decodoDestroy).toHaveBeenCalledTimes(1);
    expect(options.getConfigurationSummary()).toMatchObject({
      headers: { total: 0 },
      proxies: { total: 0 },
      limiters: { total: 0 },
      oxylabs: { total: 0 },
      decodo: { total: 0 }
    });
  });

  it('applies global proxy and limiter configs automatically', async () => {
    const tempDir = createTempDir();
    const calls: any[] = [];

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir,
        proxy: {
          enable: true,
          proxies: [{
            isGlobal: true,
            proxy: {
              protocol: 'http',
              host: 'proxy.local',
              port: 8080
            }
          }]
        },
        limiter: {
          enable: true,
          limiters: [{
            isGlobal: true,
            options: {
              concurrency: 1
            }
          }]
        }
      }, createRecordingHttp(calls));

      crawler.visit('/global-config');
      await crawler.waitForAll();

      expect(calls).toHaveLength(1);
      expect(calls[0].proxy).toMatchObject({
        protocol: 'http',
        host: 'proxy.local',
        port: 8080
      });
      expect(calls[0].queue).toBeTruthy();

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps rotating proxy metadata and skips domain-wide 429 cooldown for rotating proxies', async () => {
    const tempDir = createTempDir();
    let attempts = 0;

    try {
      const options = new CrawlerOptions({
        baseUrl: 'https://example.com'
      });
      options.addProxies([{
        domain: 'example.com',
        rotating: true,
        proxy: {
          protocol: 'http',
          host: 'proxy.local',
          port: 8080
        }
      }]);
      expect(options.getProxyConfig('https://example.com/from-add-proxy')).toEqual({
        proxy: {
          protocol: 'http',
          host: 'proxy.local',
          port: 8080
        },
        rotating: true
      });

      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir,
        proxy: {
          enable: true,
          proxies: [{
            isGlobal: true,
            rotating: true,
            proxy: {
              protocol: 'http',
              host: 'proxy.local',
              port: 8080
            }
          }]
        },
        limiter: {
          enable: true,
          limiters: [{
            isGlobal: true,
            retry: {
              enable: true,
              max429Retries: 1,
              retryDelay: 1,
              backoff: false
            }
          }]
        }
      }, {
        get: async (url: string) => {
          attempts++;
          if (attempts === 1) {
            const error = new Error('rate limited') as any;
            error.response = { status: 429, headers: {} };
            throw error;
          }
          return createHtmlResponse(url);
        },
        post: async (url: string) => createHtmlResponse(url),
        patch: async (url: string) => createHtmlResponse(url),
        put: async (url: string) => createHtmlResponse(url)
      } as any);

      expect(crawler.config.getProxyConfig('https://example.com/a', true)).toEqual({
        proxy: {
          protocol: 'http',
          host: 'proxy.local',
          port: 8080
        },
        rotating: true
      });

      crawler.visit('/rotating-429');
      await crawler.waitForAll();

      expect((crawler as any).rateLimitedDomains.get('example.com')).toBeUndefined();

      await (crawler as any).handle429Response(
        'https://example.com/static-429',
        { headers: {} },
        0,
        'example.com',
        false
      );
      expect((crawler as any).rateLimitedDomains.get('example.com')).toBeGreaterThan(Date.now());

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('forwards Oxylabs overrides through the crawler request path', async () => {
    const tempDir = createTempDir();
    const scrape = vi.fn(async (url: string, options?: any) => ({
      statusCode: 200,
      url,
      content: '<html><head><title>oxylabs</title></head><body></body></html>',
      cookies: [],
      headers: {},
      rendered: !!options?.render,
      raw: { results: [{ content: '', status_code: 200, url }] }
    }));

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir
      }, createRecordingHttp([]));

      crawler.config.oxylabs.push({
        isGlobal: true,
        adaptar: { scrape } as any
      });

      crawler.visit('/protected', {
        useOxylabsScraperAi: true,
        method: 'POST',
        body: 'hello world',
        headers: { 'x-test': '1' },
        browserType: 'mobile',
        geoLocation: 'United States',
        follow_redirects: false,
        successful_status_codes: [404],
        session_id: 'session-1',
        javascript_rendering: true
      });

      await crawler.waitForAll();

      expect(scrape).toHaveBeenCalledTimes(1);
      expect(scrape).toHaveBeenCalledWith(
        'https://example.com/protected',
        expect.objectContaining({
          browserType: 'mobile',
          geoLocation: 'United States',
          http_method: 'post',
          base64Body: Buffer.from('hello world').toString('base64'),
          follow_redirects: false,
          successful_status_codes: [404],
          session_id: 'session-1',
          javascript_rendering: true,
          headers: expect.objectContaining({
            'x-test': '1'
          })
        })
      );

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('forwards Decodo overrides through the crawler request path', async () => {
    const tempDir = createTempDir();
    const scrape = vi.fn(async (url: string, options?: any) => ({
      statusCode: 200,
      url,
      content: '<html><head><title>decodo</title></head><body></body></html>',
      cookies: [],
      headers: {},
      rendered: !!options?.headless,
      raw: { results: [{ body: '', status_code: 200, url }] }
    }));

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir
      }, createRecordingHttp([]));

      crawler.config.decodo.push({
        isGlobal: true,
        adaptar: { scrape } as any
      });

      crawler.visit('/rendered', {
        useDecodo: true,
        method: 'POST',
        body: { hello: 'world' },
        headers: { 'x-test': '1' },
        country: 'United States',
        waitForCss: '.ready',
        session_id: 'session-2',
        successful_status_codes: [202]
      });

      await crawler.waitForAll();

      expect(scrape).toHaveBeenCalledTimes(1);
      expect(scrape).toHaveBeenCalledWith(
        'https://example.com/rendered',
        expect.objectContaining({
          country: 'United States',
          waitForCss: '.ready',
          http_method: 'post',
          base64Body: Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64'),
          session_id: 'session-2',
          successful_status_codes: [202],
          headers: expect.objectContaining({
            'x-test': '1'
          })
        })
      );

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses Oxylabs queueOptions to gate provider requests', async () => {
    const tempDir = createTempDir();
    const scrape = vi.fn(async (url: string) => ({
      statusCode: 200,
      url,
      content: '<html><head><title>oxylabs-queued</title></head><body></body></html>',
      cookies: [],
      headers: {},
      rendered: false,
      raw: { results: [{ content: '', status_code: 200, url }] }
    }));

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir,
        oxylabs: {
          enable: true,
          labs: [{
            isGlobal: true,
            domain: '*',
            options: {
              username: 'user',
              password: 'pass'
            },
            queueOptions: {
              autoStart: false,
              concurrency: 1
            }
          }]
        }
      }, createRecordingHttp([]));

      crawler.config.oxylabs[0].adaptar.scrape = scrape as any;

      crawler.visit('/queued-oxylabs', {
        useOxylabsScraperAi: true
      });

      await waitUntil(() => crawler.config.oxylabs[0].pqueue?.size === 1, 2000);
      expect(scrape).not.toHaveBeenCalled();

      crawler.config.oxylabs[0].pqueue?.start();
      await crawler.waitForAll();

      expect(scrape).toHaveBeenCalledTimes(1);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses Decodo queueOptions to gate provider requests', async () => {
    const tempDir = createTempDir();
    const scrape = vi.fn(async (url: string) => ({
      statusCode: 200,
      url,
      content: '<html><head><title>decodo-queued</title></head><body></body></html>',
      cookies: [],
      headers: {},
      rendered: false,
      raw: { results: [{ body: '', status_code: 200, url }] }
    }));

    try {
      const crawler = new Crawler({
        baseUrl: 'https://example.com',
        enableCache: false,
        autoThrottle: false,
        concurrency: 1,
        scraperConcurrency: 1,
        cacheDir: tempDir,
        decodo: {
          enable: true,
          labs: [{
            isGlobal: true,
            domain: '*',
            options: {
              username: 'user',
              password: 'pass'
            },
            queueOptions: {
              autoStart: false,
              concurrency: 1
            }
          }]
        }
      }, createRecordingHttp([]));

      crawler.config.decodo[0].adaptar.scrape = scrape as any;

      crawler.visit('/queued-decodo', {
        useDecodo: true
      });

      await waitUntil(() => crawler.config.decodo[0].pqueue?.size === 1, 2000);
      expect(scrape).not.toHaveBeenCalled();

      crawler.config.decodo[0].pqueue?.start();
      await crawler.waitForAll();

      expect(scrape).toHaveBeenCalledTimes(1);

      await crawler.destroy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Provider payload builders', () => {
  it('serializes Oxylabs request overrides into the documented payload shape', async () => {
    const postJson = vi.fn(async () => ({
      data: {
        results: [{
          content: '<html></html>',
          status_code: 200,
          url: 'https://example.com',
          _response: {}
        }]
      }
    }));

    const oxylabs = new Oxylabs({
      username: 'user',
      password: 'pass'
    });
    (oxylabs as any).http = { postJson };

    await oxylabs.scrape('https://example.com', {
      http_method: 'post',
      base64Body: 'Ym9keQ==',
      headers: { 'X-Test': '1' },
      cookies: [{ key: 'session', value: 'abc' }],
      session_id: 'session-3',
      follow_redirects: false,
      successful_status_codes: [404],
      javascript_rendering: true,
      returnAsBase64: true
    });

    const [, requestBody] = postJson.mock.calls[0];
    const context = new Map(requestBody.context.map((item: any) => [item.key, item.value]));

    expect(requestBody).toMatchObject({
      source: 'universal',
      url: 'https://example.com',
      render: 'html',
      content_encoding: 'base64'
    });
    expect(context.get('headers')).toEqual({ 'X-Test': '1' });
    expect(context.get('cookies')).toEqual([{ key: 'session', value: 'abc' }]);
    expect(context.get('session_id')).toBe('session-3');
    expect(context.get('http_method')).toBe('post');
    expect(context.get('content')).toBe('Ym9keQ==');
    expect(context.get('follow_redirects')).toBe(false);
    expect(context.get('successful_status_codes')).toEqual([404]);
  });

  it('serializes Decodo request overrides into the documented payload shape', async () => {
    const postJson = vi.fn(async () => ({
      data: {
        id: 'task-1',
        status: 'completed',
        results: [{
          body: '<html></html>',
          status_code: 200,
          url: 'https://example.com'
        }]
      }
    }));

    const decodo = new Decodo({
      username: 'user',
      password: 'pass'
    });
    (decodo as any).http = { postJson };

    await decodo.scrape('https://example.com', {
      http_method: 'post',
      base64Body: 'Ym9keQ==',
      headers: { 'X-Test': '1' },
      cookies: [{ key: 'session', value: 'abc' }],
      session_id: 'session-4',
      successful_status_codes: [202],
      javascript_rendering: true
    });

    const [, requestBody] = postJson.mock.calls[0];

    expect(requestBody).toMatchObject({
      target: 'universal',
      url: 'https://example.com',
      headless: 'html',
      http_method: 'post',
      payload: 'Ym9keQ==',
      session_id: 'session-4',
      successful_status_codes: [202],
      headers: { 'X-Test': '1' },
      force_headers: true,
      cookies: 'session=abc',
      force_cookies: true
    });
  });
});
