import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest, Http2SessionPool } from '../src/adapters/http2';
import { RezoStealth } from '../src/stealth/index';
import { generateSanCertificate, startH2Observer } from './fixtures/stealth/wire-observer.mjs';
import { startHandoffProxy } from './fixtures/http2-connect-handoff';

let authorities: string[];
let target: Awaited<ReturnType<typeof startH2Observer>>;
let certificate: ReturnType<typeof generateSanCertificate>;
const proxies: Awaited<ReturnType<typeof startHandoffProxy>>[] = [];
beforeAll(async () => {
  certificate = generateSanCertificate();
  authorities = tls.getCACertificates();
  tls.setDefaultCACertificates([...authorities, certificate.cert]);
  target = await startH2Observer(certificate);
});
afterEach(async () => {
  Http2SessionPool.getInstance().closeAllSessions();
  for (const proxy of proxies.splice(0)) await proxy.close();
});
afterAll(async () => {
  Http2SessionPool.getInstance().destroy();
  await target?.close();
  if (authorities) tls.setDefaultCACertificates(authorities);
});

for (const stealth of [false, true]) {
  it(`completes verified H2 after fragmented HTTPS CONNECT, stealth=${stealth}`, async () => {
    const proxy = await startHandoffProxy(certificate, 'fragmented', target.port); proxies.push(proxy);
    const client = new Rezo({ stealth: stealth ? new RezoStealth('firefox-133') : undefined, retry: false, timeout: 1500, rejectUnauthorized: true }, executeRequest);
    const response = await client.get(`${target.url}fragmented`, { proxy: { protocol: 'https', host: '127.0.0.1', port: proxy.port } });
    expect(response.status).toBe(200); expect(response.data).toBe('ok');
    expect(proxy.observations.requests).toHaveLength(1);
    expect(target.streams.at(-1)?.headers[':path']).toBe('/fragmented');
    expect(target.streams.at(-1)?.alpn).toBe('h2');
  });
}

it('preserves server SETTINGS coalesced with CONNECT when handing a plain proxy to cleartext H2', async () => {
  const proxy = await startHandoffProxy(certificate, 'coalesced-h2c'); proxies.push(proxy);
  const response = await new Rezo({ retry: false, timeout: 1500, rejectUnauthorized: true }, executeRequest)
    .get('http://localhost/coalesced', { proxy: proxy.url });
  expect(response.status).toBe(200); expect(response.data).toBe('ok');
  expect(proxy.observations.settingsAcknowledged).toBe(true);
});

it('keeps the connect deadline and closes the proxy when target TLS stalls', async () => {
  const proxy = await startHandoffProxy(certificate, 'silent-tls'); proxies.push(proxy);
  await expect(new Rezo({ retry: false, rejectUnauthorized: true }, executeRequest)
    .get('https://localhost/stalled', { proxy: proxy.url, timeout: { connect: 100, total: 1500 } }))
    .rejects.toMatchObject({ code: 'ETIMEDOUT', phase: 'connect' });
  expect(proxy.observations.targetTlsBytes).toBeGreaterThan(0);
  await expect.poll(() => proxy.activeClients.size, { timeout: 1200 }).toBe(0);
});

it('aborts target TLS through the HTTPS proxy and closes the outer socket', async () => {
  const proxy = await startHandoffProxy(certificate, 'silent-tls'); proxies.push(proxy);
  const controller = new AbortController();
  const outcome = new Rezo({ retry: false, rejectUnauthorized: true }, executeRequest)
    .get('https://localhost/aborted', { proxy: proxy.url, signal: controller.signal, timeout: 2000 })
    .then(() => undefined, (error: unknown) => error);
  await expect.poll(() => proxy.observations.targetTlsBytes, { timeout: 1000 }).toBeGreaterThan(0);
  controller.abort();
  expect(await outcome).toMatchObject({ code: 'ABORT_ERR' });
  await expect.poll(() => proxy.activeClients.size, { timeout: 1200 }).toBe(0);
});
