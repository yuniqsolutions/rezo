import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer, { type Browser } from 'puppeteer';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';

const records = new Map<string, { bytes: number[]; contentType?: string }>();
const sockets = new Set<Socket>();
const errors: Error[] = [];
const server = createServer();
let browser: Browser;
let origin: string;

beforeAll(async () => {
  const bundles = new Map<string, string>();
  for (const adapter of ['xhr', 'fetch']) {
    const built = await build({ entryPoints: [`src/adapters/entries/${adapter}.ts`], bundle: true,
      format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' });
    bundles.set(`/${adapter}.js`, built.outputFiles[0].text);
  }
  server.on('request', (request, response) => {
    const path = request.url ?? '/';
    if (bundles.has(path)) {
      response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundles.get(path)); return;
    }
    if (path === '/') { response.end('<!doctype html><title>Body regression</title>'); return; }
    if (!path.startsWith('/body/')) { response.writeHead(404); response.end(); return; }
    const chunks: Buffer[] = [];
    request.on('error', error => errors.push(error));
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      records.set(path, { bytes: Array.from(Buffer.concat(chunks)), contentType: request.headers['content-type'] });
      response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}');
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser receiver did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true, timeout: 15000,
    executablePath: join(homedir(), '.cache/puppeteer/chrome/mac_arm-147.0.7727.56/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
}, 20000);

afterAll(async () => {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  expect(errors).toEqual([]);
});

for (const adapter of ['xhr', 'fetch']) {
  it(`${adapter} preserves every typed view and Blob inside real Chrome`, async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    try {
      await page.goto(origin);
      const rows = await page.evaluate(async (adapter) => {
        const { default: rezo } = await new Function('path', 'return import(path)')(`/${adapter}.js`);
        const makers: Array<{ name: string; make: () => unknown; expected: number[] }> = [];
        const payload = [65, 0, 255, 13, 10];
        for (const Type of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
          Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array]) {
          const size = Type.BYTES_PER_ELEMENT;
          const expected = Array.from({ length: size * 2 }, (_, i) => i + 1);
          makers.push({ name: Type.name, expected, make: () => {
            const bytes = new Uint8Array(size * 4).fill(99); bytes.set(expected, size);
            return new Type(bytes.buffer, size, 2);
          } });
        }
        makers.push(
          { name: 'ArrayBuffer', expected: payload, make: () => Uint8Array.from(payload).buffer },
          { name: 'DataView', expected: payload, make: () => new DataView(Uint8Array.from([88, ...payload, 89]).buffer, 1, 5) },
          { name: 'Blob', expected: payload, make: () => new Blob([Uint8Array.from(payload)]) },
          { name: 'empty view', expected: [], make: () => new Uint8Array(new ArrayBuffer(4), 2, 0) },
        );
        const rows = [];
        for (const header of [undefined, 'application/json', 'text/plain', 'application/octet-stream']) {
          for (const maker of makers) {
            const path = `/body/${adapter}/${rows.length}`;
            let error: string | undefined;
            try {
              await rezo(`${location.origin}${path}`, { method: 'POST', body: maker.make(), timeout: 1000,
                retry: false, cache: false, disableJar: true, responseType: 'json',
                headers: header ? { 'Content-Type': header } : undefined });
            } catch (reason) { error = String(reason); }
            rows.push({ path, name: maker.name, header, expected: maker.expected, error });
          }
        }
        return rows;
      }, adapter);
      expect(rows).toHaveLength(60);
      for (const row of rows) {
        expect(row.error, `${row.name} ${row.header}`).toBeUndefined();
        expect(records.get(row.path)?.bytes, `${row.name} ${row.header}`).toEqual(row.expected);
        if (row.header) expect(records.get(row.path)?.contentType).toBe(row.header);
      }
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  }, 15000);
}

it('XHR rejects a Web request stream without dispatching or consuming it', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const { default: rezo } = await new Function('return import("/xhr.js")')();
      const stream = new ReadableStream();
      let code: unknown;
      try {
        await rezo(`${location.origin}/body/xhr-stream`, { method: 'POST', body: stream,
          headers: { 'Content-Type': 'application/json' }, timeout: 1000, retry: false, disableJar: true });
      } catch (error) { code = Reflect.get(Object(error), 'code'); }
      return { code, locked: stream.locked };
    });
    expect(result).toEqual({ code: 'REZ_UNSUPPORTED_CAPABILITY', locked: false });
    expect(records.has('/body/xhr-stream')).toBe(false);
  } finally { await page.close(); }
});
