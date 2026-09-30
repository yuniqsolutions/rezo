/**
 * WW / SW — the Fetch adapter's published worker bundle executed inside a real browser Web Worker and a real Service
 * Worker (headless Chrome via puppeteer, the same launch path as the browser-entry carrier). The fixture serves a page,
 * the worker script and the bundle from one origin; the page spawns a module Worker and registers a module Service
 * Worker, posts { origin } to each, and stores the reports they post back; the rows assert those reports.
 * Rows: WW-01…04 (Web Worker) and SW-01…04 (Service Worker): buffered 24 bytes, stream to done, typed 500, prompt abort.
 */
import puppeteer, { type Browser } from 'puppeteer';
import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildWorkerBundle, type WorkerBundle } from './fixtures/fetch-worker/build-worker-bundle.ts';
import { startWorkerFixture, type WorkerFixture } from './fixtures/fetch-worker/fixture-server.ts';
import { assertWorkerRow, WORKER_ROWS, WORKER_ROW_TITLES, type WorkerReport } from './fixtures/fetch-worker/rows.ts';

const STAGE_TIMEOUT_MS = 30_000;
const FALLBACK_CHROME_EXECUTABLE = join(
  homedir(),
  '.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>rezo fetch workers</title><link rel="icon" href="data:,"></head><body>rezo fetch workers
<script type="module">
const origin = location.origin;
const worker = new Worker('/worker-script.mjs', { type: 'module' });
worker.onmessage = (event) => { window.__workerReport = event.data; };
worker.onerror = (event) => { window.__workerReport = { failure: 'worker error: ' + event.message }; };
worker.postMessage({ origin });
(async () => {
  try {
    navigator.serviceWorker.addEventListener('message', (event) => { window.__swReport = event.data; });
    const registration = await navigator.serviceWorker.register('/worker-script.mjs', { type: 'module', scope: '/' });
    await navigator.serviceWorker.ready;
    const active = registration.active ?? registration.waiting ?? registration.installing;
    if (!active) throw new Error('service worker never became active');
    active.postMessage({ origin });
  } catch (error) { window.__swReport = { failure: 'service worker: ' + (error && error.stack ? error.stack : String(error)) }; }
})();
</script></body></html>`;

let bundle: WorkerBundle; let fixture: WorkerFixture; let browser: Browser | undefined;
let workerReport: WorkerReport; let serviceWorkerReport: WorkerReport; const pageErrors: string[] = [];

async function launchChrome(): Promise<Browser> {
  try { return await puppeteer.launch({ headless: true }); }
  catch (defaultError) {
    try { return await puppeteer.launch({ headless: true, executablePath: FALLBACK_CHROME_EXECUTABLE }); }
    catch (fallbackError) { throw new Error(`Chrome launch failed twice: ${String(defaultError)} / ${String(fallbackError)}`); }
  }
}

beforeAll(async () => {
  bundle = buildWorkerBundle();
  expect(bundle.nodeInputs, 'worker bundle must not contain node: inputs').toEqual([]);
  const bundleBytes = readFileSync(bundle.bundlePath); const scriptBytes = readFileSync(bundle.scriptPath);
  fixture = await startWorkerFixture((request, response) => {
    const serve = (body: Buffer | string, type: string): boolean => { response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(body); return true; };
    if (request.url === '/' || request.url === '/index.html') return serve(PAGE_HTML, 'text/html; charset=utf-8');
    if (request.url === '/worker-script.mjs') return serve(scriptBytes, 'text/javascript');
    if (request.url === '/fetch-entry.worker.mjs') return serve(bundleBytes, 'text/javascript');
    return false;
  });
  browser = await launchChrome();
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${fixture.origin}/`, { waitUntil: 'load', timeout: STAGE_TIMEOUT_MS });
  await page.waitForFunction(() => (window as unknown as { __workerReport?: unknown }).__workerReport !== undefined && (window as unknown as { __swReport?: unknown }).__swReport !== undefined, { timeout: STAGE_TIMEOUT_MS });
  const reports = await page.evaluate(() => ({ worker: (window as unknown as { __workerReport: unknown }).__workerReport, serviceWorker: (window as unknown as { __swReport: unknown }).__swReport }));
  workerReport = reports.worker as WorkerReport; serviceWorkerReport = reports.serviceWorker as WorkerReport;
  console.log(`WW/SW ledger: chrome=${await browser.version()} bundleBytes=${bundle.bundleBytes} hits=${fixture.hits()} pageErrors=${JSON.stringify(pageErrors)} worker=${JSON.stringify(workerReport)} serviceWorker=${JSON.stringify(serviceWorkerReport)}`);
}, 90_000);
afterAll(async () => { await browser?.close(); await fixture?.close(); if (bundle) rmSync(bundle.directory, { recursive: true, force: true }); });

for (const id of WORKER_ROWS) {
  it(`WW-${id.slice(3)} (Chrome Web Worker) ${WORKER_ROW_TITLES[id]}`, () => { assertWorkerRow(workerReport, id, 'browser-worker'); expect(pageErrors).toEqual([]); });
}
for (const id of WORKER_ROWS) {
  it(`SW-${id.slice(3)} (Chrome Service Worker) ${WORKER_ROW_TITLES[id]}`, () => { assertWorkerRow(serviceWorkerReport, id, 'browser-service-worker'); expect(pageErrors).toEqual([]); });
}
