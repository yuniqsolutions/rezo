// Runs INSIDE a worker — a browser Web Worker or Service Worker, a Bun / Deno web Worker, or Node worker_threads: no DOM,
// the runtime's own fetch, and the Fetch adapter's published worker bundle served or written next to this file.
// Receives { origin }, runs the rows, posts the report back (a Service Worker replies to the client that asked).
import { Rezo } from './fetch-entry.worker.mjs';

const serviceWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope;
const runtime = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : typeof WorkerGlobalScope !== 'undefined' && typeof navigator !== 'undefined' && !navigator.userAgent?.includes('Deno') ? (serviceWorker ? 'browser-service-worker' : 'browser-worker') : 'node';
const kindOf = (value) => (value === null || value === undefined ? String(value) : value.constructor?.name ?? typeof value);

async function run(origin) {
  const rows = [];
  const client = new Rezo({ retry: false, timeout: 8000 });
  try {
    const response = await client.get(`${origin}/24`, { responseType: 'buffer', cache: false });
    rows.push({ id: 'WR-01', status: response.status, bytes: response.data?.byteLength ?? null, kind: kindOf(response.data) });
  } catch (error) { rows.push({ id: 'WR-01', error: String(error?.code ?? error) }); }
  rows.push(await new Promise((resolve) => {
    const stream = client.stream(`${origin}/24`, { cache: false });
    let bytes = 0; let chunks = 0; const kinds = new Set(); const seen = []; let settled = false;
    const finish = (extra = {}) => { if (settled) return; settled = true; resolve({ id: 'WR-02', bytes, chunks, kinds: [...kinds], seen, ...extra }); };
    for (const name of ['data', 'end', 'done', 'complete', 'error', 'close']) stream.on(name, (payload) => {
      if (name === 'data') { bytes += payload?.byteLength ?? payload?.length ?? 0; chunks += 1; kinds.add(kindOf(payload)); return; }
      seen.push(name === 'error' ? `error:${payload?.code ?? 'no-code'}` : name);
      if (name === 'error' || name === 'close') finish();
      if (name === 'complete') setTimeout(() => finish(), 50);
    });
    setTimeout(() => finish({ unsettled: true }), 5000);
  }));
  try { await client.get(`${origin}/500`, { cache: false }); rows.push({ id: 'WR-03', fulfilled: true }); }
  catch (error) { rows.push({ id: 'WR-03', code: error?.code ?? null, status: error?.response?.status ?? null, isRezoError: error?.isRezoError === true }); }
  const controller = new AbortController(); const started = Date.now();
  setTimeout(() => controller.abort(), 150);
  try { await client.get(`${origin}/hold`, { cache: false, signal: controller.signal }); rows.push({ id: 'WR-04', fulfilled: true }); }
  catch (error) { rows.push({ id: 'WR-04', code: error?.code ?? null, prompt: Date.now() - started < 1500 }); }
  return { runtime, hasDocument: typeof document !== 'undefined', hasWindow: typeof window !== 'undefined', hasFetch: typeof fetch === 'function', rows };
}

if (serviceWorker) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('message', (event) => { const reply = (report) => event.source.postMessage(report); run(event.data.origin).then(reply, (error) => reply({ runtime, failure: String(error?.stack ?? error) })); });
} else if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', (event) => { run(event.data.origin).then((report) => self.postMessage(report), (error) => self.postMessage({ runtime, failure: String(error?.stack ?? error) })); });
} else {
  // Node worker_threads. No top-level await anywhere in this module: a module Service Worker must evaluate synchronously.
  import('node:worker_threads').then(({ parentPort }) => {
    parentPort.on('message', (data) => { run(data.origin).then((report) => parentPort.postMessage(report), (error) => parentPort.postMessage({ runtime, failure: String(error?.stack ?? error) })); });
  });
}
