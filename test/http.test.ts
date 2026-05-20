import { describe, it, expect, vi, afterEach } from 'vitest';
import rezo, { Rezo } from '../src/index';

// Helper to create a fake adapter that returns a minimal valid response
function createFakeAdapter(name: string) {
  return async (cfg: any) => ({
    data: { ok: true, adapter: name },
    status: 200,
    statusText: 'OK',
    finalUrl: cfg.url || 'about:blank',
    cookies: {} as any,
    headers: {} as any,
    contentType: 'application/json',
    contentLength: undefined,
    urls: [cfg.url || 'about:blank'],
    config: { ...cfg, adapter: name } as any,
    httpVersion: '1.1'
  });
}

describe('adapterPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects http adapter when custom adapter is provided', async () => {
    const fakeAdapter = createFakeAdapter('http');
    const client = new Rezo({}, fakeAdapter as any);
    const res = await client.get('https://example.com');
    expect(res).toBeDefined();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, adapter: 'http' });
  });

  it('uses custom adapter function passed via constructor', async () => {
    const fakeAdapter = createFakeAdapter('custom');
    const client = new Rezo({}, fakeAdapter as any);
    const res = await client.get('https://example.com');
    expect(res).toBeDefined();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, adapter: 'custom' });
  });
});

describe('HTTP Adapter', () => {
  it('should perform a GET request and receive status 200', async () => {
    const response = await rezo.request({
      url: 'https://httpbin.org/get',
      method: 'GET',
      responseType: 'json',
      cookies: 'session=1'
    });
    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
  });

  it('should throw RezoError on invalid request', async () => {
    await expect(rezo.request({ url: '' })).rejects.toThrow();
  });
});
