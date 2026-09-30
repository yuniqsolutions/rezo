import { describe, expect, it, vi } from 'vitest';
import { AxiosHeaders } from 'axios';
import { createRezoInstance, type AdapterFunction } from '../src/core/rezo';
import { RezoHeaders } from '../src/utils/headers';
import type { RezoResponse } from '../src/types/response';

function capture() {
  const adapter = vi.fn(async (options) => ({ data: options, status: 200, headers: new RezoHeaders() })) as unknown as AdapterFunction;
  const client = createRezoInstance(adapter, { cache: false, disableJar: true, retry: false });
  const call = client as unknown as (...args: unknown[]) => Promise<RezoResponse<Record<string, unknown>>>;
  const request = client.request as unknown as typeof call;
  return { client, call, request, adapter };
}
const url = 'https://example.invalid/path?old=1';

describe('owned native input normalization', () => {
  for (const surface of ['call', 'request'] as const) {
    it(`${surface}: URL/options and config-only forms`, async () => {
      const c = capture();
      for (const args of [[url, { method: 'post', body: 'body' }], [{ url, method: 'post', body: 'body' }]]) {
        const { data } = await c[surface](...args);
        expect(data.method).toBe('POST');
        expect(String(data.url)).toBe(url);
        expect(data.body).toBe('body');
      }
      c.client.destroy();
    });
    it(`${surface}: Request accessors, replacement headers and override body`, async () => {
      const c = capture();
      const controller = new AbortController();
      const input = new Request(url, { method: 'POST', body: 'original', signal: controller.signal,
        headers: { 'x-original': 'yes', 'content-type': 'text/plain' } });
      const inherited = (await c[surface](input)).data;
      expect(inherited.method).toBe('POST');
      expect(inherited.body).toBe(input.body);
      expect(inherited.signal).toBe(input.signal);
      expect(new Headers(inherited.headers as HeadersInit).get('x-original')).toBe('yes');
      const overridden = (await c[surface](input, { body: 'new', headers: [['x-new', 'yes']] })).data;
      expect(overridden.body).toBe('new');
      expect(new Headers(overridden.headers as HeadersInit).get('x-original')).toBeNull();
      expect(new Headers(overridden.headers as HeadersInit).get('x-new')).toBe('yes');
      expect(input.bodyUsed).toBe(false);
      c.client.destroy();
    });
    it(`${surface}: frozen config remains reusable and unchanged`, async () => {
      const c = capture();
      const headers = Object.freeze({ 'x-owned': 'yes' });
      const config = Object.freeze({ url, method: 'GET', headers });
      await c[surface](config);
      await c[surface](config);
      expect(Object.keys(config)).toEqual(['url', 'method', 'headers']);
      expect(config.headers).toBe(headers);
      c.client.destroy();
    });
  }
  for (const body of [null, false, 0, '', new Uint8Array([0, 255])]) {
    it(`native body precedence: ${String(body)}`, async () => {
      const c = capture();
      expect((await c.request({ url, method: 'POST', body, data: 'alias' })).data.body).toBe(body);
      expect((await c.request({ url, method: 'POST', body: undefined, data: body })).data.body).toBe(body);
      c.client.destroy();
    });
  }
  it('AxiosHeaders are copied without stringifying disabled/undefined values', async () => {
    const c = capture();
    const headers = new AxiosHeaders({ 'X-Yes': 'ok', 'X-No': false, 'X-Missing': undefined });
    const result = (await c.request({ url, headers })).data;
    const actual = new Headers(result.headers as HeadersInit);
    expect(actual.get('x-yes')).toBe('ok');
    expect(actual.has('x-no')).toBe(false);
    expect(actual.has('x-missing')).toBe(false);
    expect(headers.get('X-No')).toBe(false);
    c.client.destroy();
  });
  it('Axios common/method headers resolve before explicit request headers', async () => {
    const c = capture();
    const result = (await c.request({ url, method: 'POST', headers: {
      common: { 'x-base': 'yes', 'X-Choice': 'common' }, post: { 'x-method': 'yes', 'x-choice': 'method' },
      get: { 'x-wrong': 'no' }, 'X-Choice': 'explicit',
    } })).data;
    const headers = new Headers(result.headers as HeadersInit);
    expect(headers.get('x-base')).toBe('yes'); expect(headers.get('x-method')).toBe('yes');
    expect(headers.get('x-choice')).toBe('explicit'); expect(headers.has('x-wrong')).toBe(false);
    c.client.destroy();
  });
  it('Request GET override with an inherited body refuses before dispatch', async () => {
    const c = capture();
    const input = new Request(url, { method: 'POST', body: 'body' });
    await expect(c.call(input, { method: 'GET' })).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_TYPE' });
    expect(c.adapter).not.toHaveBeenCalled(); expect(input.bodyUsed).toBe(false);
    c.client.destroy();
  });
  it('Got prefixUrl and replacement multimap query preserve empty/false/zero values', async () => {
    const c = capture();
    const query = new URLSearchParams('a=1&a=2&empty=&zero=0&false=false');
    const result = (await c.request('child?discard=1', { prefixUrl: 'https://example.invalid/base', searchParams: query })).data;
    expect(String(result.url)).toBe('https://example.invalid/base/child?a=1&a=2&empty=&zero=0&false=false');
    expect(query.toString()).toBe('a=1&a=2&empty=&zero=0&false=false');
    c.client.destroy();
  });
  it('native baseURL/params take precedence over corresponding aliases', async () => {
    const c = capture();
    const result = (await c.request('child', { baseURL: 'https://native.invalid/base/', prefixUrl: 'https://alias.invalid/',
      params: { native: 1 }, searchParams: { alias: 1 } })).data;
    expect(String(result.url)).toContain('https://native.invalid/base/child');
    expect(result.params).toEqual({ native: 1 });
    expect(String(result.url)).not.toContain('alias=');
    c.client.destroy();
  });
  for (const options of [{ cancelToken: {} }, { adapter: 'http' }, { timeout: { request: 10 } },
    { retry: { calculateDelay: () => 0 } }, { resolveBodyOnly: true }, { isStream: true },
    { hooks: { beforeRetry: [() => undefined], unknownForeignHook: [] } }, { transformRequest: () => 'changed' }]) {
    it(`refuses unsupported controls before dispatch: ${Object.keys(options).join()}`, async () => {
      const c = capture();
      const beforeError = vi.fn(error => error);
      c.client.hooks.beforeError.push(beforeError);
      await expect(c.request(url, options)).rejects.toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY' });
      expect(c.adapter).not.toHaveBeenCalled();
      expect(beforeError).toHaveBeenCalledTimes(1);
      c.client.destroy();
    });
  }
  it('consumed Request refuses but an explicit replacement body is usable', async () => {
    const c = capture();
    const request = new Request(url, { method: 'POST', body: 'original' });
    await request.text();
    await expect(c.call(request)).rejects.toMatchObject({ code: 'REZ_STREAM_ERROR' });
    expect((await c.call(request, { body: 'replacement' })).data.body).toBe('replacement');
    c.client.destroy();
  });
});
