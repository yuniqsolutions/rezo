import { describe, it, expect, vi, afterEach } from 'vitest';
import { Rezo } from '../src';
import type { RezoResponse } from '../src/types/response';

// Helper to create a fake adapter that returns a minimal valid RezoResponse
function createFakeAdapter(name: string) {
  return async (cfg: any): Promise<RezoResponse> => ({
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

describe('adapterPicker behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses custom adapter passed via constructor', async () => {
    const fakeAdapter = createFakeAdapter('http');
    const client = new Rezo({}, fakeAdapter as any);
    const res = await client.get('https://example.com');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, adapter: 'http' });
  });

  it('returns correct data from custom adapter', async () => {
    const fakeAdapter = createFakeAdapter('custom');
    const client = new Rezo({}, fakeAdapter as any);
    const res = await client.get('https://example.com');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, adapter: 'custom' });
  });

  it('uses function adapter provided via constructor for echo', async () => {
    const echoAdapter = async (cfg: any) => {
      const response: RezoResponse = {
        data: { echoedUrl: cfg.url },
        status: 200,
        statusText: 'OK',
        finalUrl: cfg.url,
        cookies: {} as any,
        headers: {} as any,
        contentType: 'application/json',
        contentLength: undefined,
        urls: [cfg.url],
        config: { url: cfg.url } as any
      };
      return response;
    };

    const client = new Rezo({}, echoAdapter as any);
    const res = await client.request({
      url: 'https://example.com/echo',
      method: 'GET',
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ echoedUrl: 'https://example.com/echo' });
  });
});
