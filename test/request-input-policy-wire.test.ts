import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createH2Server } from 'node:http2';
import { spawn } from 'node:child_process';
import type { Socket } from 'node:net';
import { createRezoInstance } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';

async function receiver(h2 = false) {
  const server = h2 ? createH2Server() : createServer();
  const sockets = new Set<Socket>();
  const arrivals: string[] = [];
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('request', (req, res) => {
    arrivals.push(req.url ?? '');
    req.resume(); req.on('error', () => res.destroy());
    req.on('end', () => {
      res.writeHead(req.url === '/redirect' ? 302 : 200, { 'content-type': 'application/json', 'set-cookie': 'server=1; Path=/',
        ...(req.url === '/redirect' ? { location: '/final' } : {}) });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? '', authorization: req.headers.authorization ?? '', path: req.url }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Receiver failed to listen');
  return { url: `http://127.0.0.1:${address.port}`, arrivals, async close() {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

it('Fetch never accepts a response with a requested mismatching integrity hash', async () => {
  const target = await receiver();
  const client = createRezoInstance(fetchAdapter, { cache: false, retry: false, disableJar: true });
  try {
    expect((await client(target.url, { integrity: '' })).status).toBe(200);
    const error = await client(target.url, { integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })
      .then(() => undefined, (error: unknown) => error);
    expect(error instanceof Error && Reflect.get(error, 'isRezoError')).toBe(true);
    if (process.versions.bun) {
      expect(Reflect.get(error as object, 'code')).toBe('REZ_UNSUPPORTED_CAPABILITY');
      expect(target.arrivals).toHaveLength(1);
    } else expect(target.arrivals).toHaveLength(2);
  } finally { client.destroy(); await target.close(); }
});

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter], ['curl', curl]] as const) {
  describe(`input policies on ${name}`, () => {
    for (const credentials of ['omit', 'same-origin'] as const) {
      it(`${credentials} prevents jar send/store while preserving explicit headers`, async () => {
        const target = await receiver(adapter === http2);
        const client = createRezoInstance<{ cookie: string; authorization: string }>(adapter, { cache: false, retry: false, keepAlive: false });
        try {
          client.jar.setCookiesSync(['ambient=1; Path=/'], target.url);
          const response = await client(target.url, { credentials, headers: { Cookie: 'literal=1', Authorization: 'Synthetic direct authorization' } });
          expect(response.data.cookie).toBe('literal=1');
          expect(response.data.authorization).toBe('Synthetic direct authorization');
          expect(client.jar.getCookieHeader(target.url)).toBe('ambient=1');
        } finally { client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool(); await target.close(); }
      });
    }
    it('manual redirects produce one request', async () => {
      const target = await receiver(adapter === http2);
      const client = createRezoInstance(adapter, { cache: false, retry: false, disableJar: true, keepAlive: false });
      try {
        expect((await client(target.url + '/redirect', { redirect: 'manual', validateStatus: null })).status).toBe(302);
        expect(target.arrivals).toEqual(['/redirect']);
      } finally { client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool(); await target.close(); }
    });
    it('Fetch cache string bypasses an enabled native response cache', async () => {
      const target = await receiver(adapter === http2);
      const client = createRezoInstance(adapter, { cache: true, retry: false, disableJar: true, keepAlive: false });
      try {
        const lookup = vi.spyOn(client.responseCache!, 'get');
        await client(target.url, { cache: 'no-store' });
        expect(lookup).not.toHaveBeenCalled();
        expect(target.arrivals).toHaveLength(1);
      } finally { client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool(); await target.close(); }
    });
    it('redirect error refuses a redirect without reaching its destination', async () => {
      const target = await receiver(adapter === http2);
      const client = createRezoInstance(adapter, { cache: false, retry: false, disableJar: true, keepAlive: false });
      try {
        const error = await client(target.url + '/redirect', { redirect: 'error' }).then(() => undefined, (error: unknown) => error);
        expect(error instanceof Error && Reflect.get(error, 'isRezoError')).toBe(true);
        expect(target.arrivals).toEqual(adapter === fetchAdapter ? ['/redirect'] : []);
      } finally { client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool(); await target.close(); }
    });
  });
}

for (const [name, adapter] of [['http', http], ['curl', curl]] as const) {
  it(`${name}: proxy false overrides a configured default proxy`, async () => {
    const target = await receiver(), proxy = await receiver();
    const client = createRezoInstance(adapter, { cache: false, retry: false, disableJar: true, keepAlive: false, proxy: proxy.url });
    try {
      await client.request(target.url, { proxy: false });
      expect(target.arrivals).toHaveLength(1); expect(proxy.arrivals).toHaveLength(0);
    } finally { client.destroy(); resetGlobalAgentPool(); await target.close(); await proxy.close(); }
  });
}

it('cURL proxy false also disables environment proxy selection', async () => {
  const target = await receiver(), proxy = await receiver();
  const keys = ['http_proxy', 'all_proxy', 'no_proxy', 'NO_PROXY'] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const client = createRezoInstance(curl, { cache: false, retry: false, disableJar: true });
  try {
    process.env.http_proxy = proxy.url; process.env.all_proxy = proxy.url;
    process.env.no_proxy = ''; process.env.NO_PROXY = '';
    await client.request(target.url, { proxy: false });
    expect(target.arrivals).toHaveLength(1); expect(proxy.arrivals).toHaveLength(0);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    client.destroy(); await target.close(); await proxy.close();
  }
});

if (process.versions.bun) it('Bun Fetch proxy off cannot silently use an environment proxy', async () => {
  const target = await receiver(), proxy = await receiver();
  try {
    // Bun may retain process proxy configuration after another test changes env.
    // A fresh child makes both the runtime control and the requested policy observable.
    const program = `import {createRezoInstance} from ${JSON.stringify(new URL('../src/core/rezo.ts', import.meta.url).href)};
      import {executeRequest} from ${JSON.stringify(new URL('../src/adapters/fetch.ts', import.meta.url).href)};
      const url=${JSON.stringify(target.url)};
      const control=await fetch(url);await control.arrayBuffer();
      const client=createRezoInstance(executeRequest,{cache:false,retry:false,disableJar:true});
      try{const code=await client.request(url,{proxy:false}).then(()=>'unexpected success',error=>error.code);
      console.log(JSON.stringify({status:control.status,code}));}finally{client.destroy();}`;
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', program], { env: { ...process.env,
        http_proxy: proxy.url, HTTP_PROXY: proxy.url, all_proxy: proxy.url, ALL_PROXY: proxy.url, no_proxy: '', NO_PROXY: '' },
      stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 200, code: 'REZ_UNSUPPORTED_CAPABILITY' });
    expect(proxy.arrivals).toHaveLength(1); expect(target.arrivals).toHaveLength(0);
  } finally {
    await target.close(); await proxy.close();
  }
});
