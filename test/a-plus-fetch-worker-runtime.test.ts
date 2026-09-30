/**
 * WR — the Fetch adapter's published worker bundle executed inside a real worker runtime: a Bun web Worker under
 * `bun test`, a Node worker_threads Worker under vitest (the Deno Worker rows live in a-plus-fetch-worker-runtime.deno.ts).
 * The bundle is built exactly as the browser-entry carrier proves it (worker condition, browser platform, no Node
 * builtins — checked on the metafile here too), written to a fresh directory with the worker script, and driven with one
 * message carrying the fixture origin. Cloudflare's workerd is not executed: it needs a dependency the Engineer has not approved.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildWorkerBundle, type WorkerBundle } from './fixtures/fetch-worker/build-worker-bundle.ts';
import { startWorkerFixture, type WorkerFixture } from './fixtures/fetch-worker/fixture-server.ts';
import { assertWorkerRow, WORKER_ROWS, WORKER_ROW_TITLES, type WorkerReport } from './fixtures/fetch-worker/rows.ts';

const RUNTIME = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : 'node';
let bundle: WorkerBundle; let fixture: WorkerFixture; let report: WorkerReport;

async function runInWorker(scriptPath: string, origin: string): Promise<WorkerReport> {
  if (RUNTIME === 'bun') {
    const worker = new Worker(pathToFileURL(scriptPath).href);
    try {
      return await new Promise<WorkerReport>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent) => resolve(event.data as WorkerReport);
        worker.onerror = (event: ErrorEvent) => reject(new Error(`worker error: ${event.message}`));
        setTimeout(() => reject(new Error('worker did not report within 20 s')), 20_000);
        worker.postMessage({ origin });
      });
    } finally { worker.terminate(); }
  }
  const { Worker: NodeWorker } = await import('node:worker_threads');
  const worker = new NodeWorker(scriptPath);
  try {
    return await new Promise<WorkerReport>((resolve, reject) => {
      worker.on('message', (data) => resolve(data as WorkerReport));
      worker.on('error', (error) => reject(error));
      setTimeout(() => reject(new Error('worker did not report within 20 s')), 20_000);
      worker.postMessage({ origin });
    });
  } finally { await worker.terminate(); }
}

beforeAll(async () => {
  bundle = buildWorkerBundle();
  expect(bundle.nodeInputs, 'worker bundle must not contain node: inputs').toEqual([]);
  fixture = await startWorkerFixture();
  report = await runInWorker(bundle.scriptPath, fixture.origin);
  console.log(`WR ledger: runtime=${RUNTIME} bundleBytes=${bundle.bundleBytes} inputs=${bundle.inputs} hits=${fixture.hits()} report=${JSON.stringify(report)}`);
}, 60_000);
afterAll(async () => { await fixture?.close(); if (bundle) rmSync(bundle.directory, { recursive: true, force: true }); });

for (const id of WORKER_ROWS) {
  it(`${id} (${RUNTIME} worker) ${WORKER_ROW_TITLES[id]}`, () => { assertWorkerRow(report, id, RUNTIME); expect(true).toBe(true); });
}
