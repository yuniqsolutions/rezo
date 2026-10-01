import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import tls from 'node:tls';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http1Adapter } from '../src/adapters/http';
import { executeRequest as http2Adapter, Http2SessionPool } from '../src/adapters/http2';
import { listProfiles, RezoStealth } from '../src/stealth/index';
import type { BrowserProfileName } from '../src/stealth/types';
import { generateSanCertificate, startConnectProxy, startH1Observer, startH2Observer } from './fixtures/stealth/wire-observer.mjs';

// Run this same carrier on Node, Bun and Electron (ELECTRON_RUN_AS_NODE=1).
// Its native CA fixture requires setDefaultCACertificates (Node 24.5+, Electron 43, Bun 1.4).
// Real receivers assert the request, TLS ALPN and proxy tunnel, not just successful construction.
let h1: Awaited<ReturnType<typeof startH1Observer>>;
let h2: Awaited<ReturnType<typeof startH2Observer>>;
let httpProxy: Awaited<ReturnType<typeof startConnectProxy>>;
let httpsProxy: Awaited<ReturnType<typeof startConnectProxy>>;
let untrustedH1: Awaited<ReturnType<typeof startH1Observer>>;
let untrustedH2: Awaited<ReturnType<typeof startH2Observer>>;
let originalAuthorities: string[];
beforeAll(async () => {
  const certificate = generateSanCertificate();
  // Trust just this test's certificate using the runtime's native CA API. No TLS constructor is mocked.
  originalAuthorities = tls.getCACertificates();
  tls.setDefaultCACertificates([...originalAuthorities, certificate.cert]);
  h1 = await startH1Observer(certificate);
  h2 = await startH2Observer(certificate);
  httpProxy = await startConnectProxy();
  // @ts-expect-error The JS fixture infers secure:null from its default, but accepts native certificate options.
  httpsProxy = await startConnectProxy({ secure: certificate });
  const untrusted = generateSanCertificate();
  untrustedH1 = await startH1Observer(untrusted);
  untrustedH2 = await startH2Observer(untrusted);
});
afterEach(() => Http2SessionPool.getInstance().closeAllSessions());
afterAll(async () => {
  Http2SessionPool.getInstance().destroy();
  for (const receiver of [h1, h2, httpProxy, httpsProxy, untrustedH1, untrustedH2]) await receiver?.close();
  if (originalAuthorities) tls.setDefaultCACertificates(originalAuthorities);
});

for (const protocol of ['h1', 'h2'] as const) {
  for (const route of ['direct', 'http-proxy', 'https-proxy'] as const) {
    for (const id of listProfiles()) {
      it(`${id} completes ${protocol} TLS and a response over ${route}`, async () => {
        const proxy = route === 'direct' ? undefined : route === 'http-proxy' ? httpProxy : httpsProxy;
        const tunnelsBefore = proxy?.tunnels.length ?? 0;
        const observations = protocol === 'h1' ? h1.requests : h2.streams;
        const before = observations.length;
        const path = `/${protocol}/${route}/${id}`;
        const stealth = new RezoStealth(id as BrowserProfileName);
        const client = new Rezo({ stealth, retry: false, timeout: 3000, rejectUnauthorized: true }, protocol === 'h1' ? http1Adapter : http2Adapter);
        const response = await client.get(new URL(path, protocol === 'h1' ? h1.url : h2.url).href, { proxy: proxy?.url });
        expect(response.status).toBe(200);
        expect(response.data).toBe('ok');
        expect(observations).toHaveLength(before + 1);
        const observation = observations[before];
        expect(protocol === 'h1' ? observation.path : observation.headers[':path']).toBe(path);
        expect(observation.headers['user-agent']).toBe(stealth.resolve().defaultHeaders['user-agent']);
        // Bun's HTTPS server does not expose ALPN on IncomingMessage.socket; the H1 response still proves the protocol.
        const bunH1 = protocol === 'h1' && typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
        expect(observation.alpn).toBe(bunH1 ? null : protocol === 'h1' ? 'http/1.1' : 'h2');
        if (proxy) expect(proxy.tunnels).toHaveLength(tunnelsBefore + 1);
      });
    }

    it(`${protocol} ${route} still rejects untrusted certificates`, async () => {
      const proxy = route === 'direct' ? undefined : route === 'http-proxy' ? httpProxy : httpsProxy;
      const observations = protocol === 'h1' ? untrustedH1.requests : untrustedH2.streams;
      const before = observations.length;
      const client = new Rezo({ stealth: new RezoStealth('firefox-133'), retry: false, timeout: 3000, rejectUnauthorized: true }, protocol === 'h1' ? http1Adapter : http2Adapter);
      await expect(client.get(protocol === 'h1' ? untrustedH1.url : untrustedH2.url, { proxy: proxy?.url })).rejects.toMatchObject({ isRezoError: true, code: expect.stringMatching(/CERT|SELF_SIGNED/u) });
      expect(observations).toHaveLength(before);
    });
  }
}
