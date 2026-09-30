import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRezoInstance } from '../src/core/rezo';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as xhr } from '../src/adapters/xhr';
import { executeRequest as reactNative } from '../src/adapters/react-native';

afterEach(() => vi.restoreAllMocks());
describe('Fetch init controls are owned by the transport', () => {
  it('forwards standard Fetch controls through the full pipeline', async () => {
    let received: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      received = init;
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    });
    const client = createRezoInstance(fetchAdapter, { cache: false, disableJar: true, retry: false });
    await client('https://example.invalid', { mode: 'cors', credentials: 'same-origin', cache: 'no-store',
      referrer: 'https://example.invalid/from', referrerPolicy: 'no-referrer', integrity: '',
      keepalive: true, priority: 'low', redirect: 'error' });
    expect(received).toMatchObject({ mode: 'cors', credentials: 'same-origin', cache: 'no-store',
      referrer: 'https://example.invalid/from', referrerPolicy: 'no-referrer', integrity: '',
      keepalive: true, priority: 'low', redirect: 'error' });
    client.destroy();
  });
  it('preserves Request Fetch fields unless an init override replaces them', async () => {
    let received: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      received = init; return new Response('ok');
    });
    const client = createRezoInstance(fetchAdapter, { cache: false, disableJar: true, retry: false });
    const request = new Request('https://example.invalid', { credentials: 'include', cache: 'reload', redirect: 'manual',
      referrerPolicy: 'no-referrer', integrity: 'sha256-test' });
    await client(request, { credentials: 'omit', responseType: 'text' });
    expect(received).toMatchObject({ credentials: 'omit', cache: 'reload', redirect: 'manual',
      referrerPolicy: request.referrerPolicy, integrity: request.integrity });
    client.destroy();
  });
  for (const [name, adapter, init] of [['http', http, { integrity: 'sha256-test' }],
    ['xhr', xhr, { credentials: 'omit' }], ['react-native', reactNative, { integrity: 'sha256-test' }]] as const) {
    it(`${name} refuses unsupported Fetch guarantees before dispatch`, async () => {
      const client = createRezoInstance(adapter, { cache: false, disableJar: true, retry: false });
      await expect(client('https://example.invalid', init)).rejects.toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY' });
      client.destroy();
    });
  }
  for (const [name, adapter] of [['fetch', fetchAdapter], ['xhr', xhr], ['react-native', reactNative]] as const) {
    it(`${name} refuses a TLS-disable alias without dispatch or global TLS changes`, async () => {
      const wire = vi.spyOn(globalThis, 'fetch');
      const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      const client = createRezoInstance(adapter, { cache: false, disableJar: true, retry: false });
      await expect(client.request('https://example.invalid', { https: { rejectUnauthorized: false } }))
        .rejects.toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY' });
      expect(wire).not.toHaveBeenCalled();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(previous);
      client.destroy();
    });
  }
});
