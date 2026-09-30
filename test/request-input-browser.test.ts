import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer, { type Browser } from 'puppeteer';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';

const sockets = new Set<Socket>();
const server = createServer();
let browser: Browser;
let origin: string;
let arrivals = 0;
beforeAll(async () => {
  const bundles = new Map<string, string>();
  for (const name of ['fetch', 'xhr', 'worker']) {
    const entry = name === 'worker' ? 'src/platform/worker.ts' : `src/adapters/entries/${name}.ts`;
    const result = await build({ entryPoints: [entry], bundle: true,
      platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
    bundles.set(`/${name}.js`, result.outputFiles[0].text);
  }
  bundles.set('/worker-input.js', `import rezo from './worker.js';
    if (typeof ServiceWorkerGlobalScope !== 'undefined') {
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    }
    self.addEventListener('message', event => {
      const run = async () => {
        const origin = event.data.origin;
        const defaults = {retry:false,cache:false,timeout:2000,responseType:'json'};
        try {
          const request = new Request(origin+'/echo', {method:'POST',body:new Uint8Array([0,255,65]),headers:{'content-type':'application/json'}});
          const first = await rezo(request, defaults);
          const second = await rezo.request(origin+'/echo', {...defaults,method:'POST',data:new DataView(new Uint8Array([99,1,2,99]).buffer,1,2)});
          const third = await rezo.request('echo', {...defaults,prefixUrl:origin,method:'POST',body:'native',searchParams:'x=1&x=2'});
          event.ports[0].postMessage({rows:[first.data,second.data,third.data]});
        } catch(error) { event.ports[0].postMessage({error:{code:error.code,message:error.message}}); }
        finally { rezo.destroy(); }
      };
      const completion = run();
      if (event.waitUntil) event.waitUntil(completion);
    });`);
  server.on('request', (req, res) => {
    if (bundles.has(req.url ?? '')) { res.setHeader('content-type', 'text/javascript'); res.end(bundles.get(req.url!)); return; }
    if (req.url === '/') { res.end('<!doctype html><title>Request inputs</title>'); return; }
    if (req.url?.startsWith('/echo')) arrivals++;
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', () => res.destroy());
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, path: req.url, bytes: [...Buffer.concat(chunks)], headers: req.headers }));
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Receiver failed to listen');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true, timeout: 15000,
    executablePath: join(homedir(), '.cache/puppeteer/chrome/mac_arm-147.0.7727.56/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
}, 20000);
afterAll(async () => {
  await browser?.close(); for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

for (const kind of ['Web', 'Service']) {
  it(`${kind} Worker: Request and Axios/Got forms preserve exact bytes`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin); const previous = arrivals;
      const result = await page.evaluate(async name => {
        let worker: Worker | ServiceWorker;
        let registration: ServiceWorkerRegistration | undefined;
        if (name === 'Web') worker = new Worker('/worker-input.js', { type: 'module' });
        else {
          registration = await navigator.serviceWorker.register('/worker-input.js', { type: 'module' });
          await navigator.serviceWorker.ready;
          worker = registration.active!;
        }
        const channel = new MessageChannel();
        try {
          return await new Promise<{ rows?: unknown[]; error?: unknown }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker input probe timed out')), 5000);
            channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
            worker.postMessage({ origin: location.origin }, [channel.port2]);
          });
        } finally {
          channel.port1.close();
          if (worker instanceof Worker) worker.terminate();
          await registration?.unregister();
        }
      }, kind);
      expect(result.error).toBeUndefined();
      expect(result.rows).toHaveLength(3);
      expect(result.rows![0]).toMatchObject({ method: 'POST', bytes: [0, 255, 65], headers: { 'content-type': 'application/json' } });
      expect(result.rows![1]).toMatchObject({ method: 'POST', bytes: [1, 2] });
      expect(result.rows![2]).toMatchObject({ method: 'POST', path: '/echo?x=1&x=2', bytes: [...Buffer.from('native')] });
      expect(arrivals).toBe(previous + 3);
    } finally { await page.close(); }
  });
}

for (const adapter of ['fetch', 'xhr']) {
  it(`${adapter}: Request and URL/config forms work in real Chrome`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const rows = await page.evaluate(async name => {
        const { default: rezo } = await new Function('path', 'return import(path)')(`/${name}.js`);
        const request = new Request(location.origin + '/echo', { method: 'POST', body: new Uint8Array([0, 255, 65]),
          headers: { 'content-type': 'application/json', 'x-original': 'yes' } });
        const options = { retry: false, cache: false, timeout: 2000, ...(name === 'xhr' ? { body: new Uint8Array([0, 255, 65]) } : {}) };
        const first = await rezo(request, options);
        const second = await rezo.request('/echo', { method: 'post', data: new Uint8Array([1, 2]),
          headers: [['x-pair', 'yes']], responseType: 'json' });
        const third = await rezo({ url: '/echo', method: 'POST', body: 'native', headers: new Headers({ 'x-config': 'yes' }) });
        return [first.data, second.data, third.data];
      }, adapter);
      expect(rows[0]).toMatchObject({ method: 'POST', bytes: [0, 255, 65], headers: { 'content-type': 'application/json', 'x-original': 'yes' } });
      expect(rows[1]).toMatchObject({ method: 'POST', bytes: [1, 2], headers: { 'x-pair': 'yes' } });
      expect(rows[2]).toMatchObject({ method: 'POST', bytes: [...Buffer.from('native')], headers: { 'x-config': 'yes' } });
    } finally { await page.close(); }
  });
}

it('XHR Request streams and credentials omit are refused before browser dispatch', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin); const previous = arrivals;
    const codes = await page.evaluate(async () => {
      const { default: rezo } = await new Function('path', 'return import(path)')('/xhr.js');
      const codes: string[] = [];
      for (const args of [[new Request(location.origin + '/echo', { method: 'POST', body: 'stream' })],
        [location.origin + '/echo', { credentials: 'omit' }]]) {
        try { await rezo(...args); codes.push('unexpected success'); } catch (error) { codes.push((error as { code: string }).code); }
      }
      return codes;
    });
    expect(codes).toEqual(['REZ_UNSUPPORTED_CAPABILITY', 'REZ_UNSUPPORTED_CAPABILITY']);
    expect(arrivals).toBe(previous);
  } finally { await page.close(); }
});

it('browser debug with TLS verification enabled never changes process-wide TLS state', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    const value = await page.evaluate(async () => {
      Reflect.set(globalThis, 'process', { env: { NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
      const { default: rezo } = await new Function('path', 'return import(path)')('/fetch.js');
      await rezo.get(location.origin + '/echo', { debug: true, rejectUnauthorized: true });
      return Reflect.get(globalThis, 'process').env.NODE_TLS_REJECT_UNAUTHORIZED;
    });
    expect(value).toBe('1');
  } finally { await page.close(); }
});
