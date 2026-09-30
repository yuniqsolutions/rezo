/**
 * WR on Deno — the Fetch adapter's published worker bundle executed inside a real Deno web Worker.
 * Run: deno test --allow-all --no-check test/a-plus-fetch-worker-runtime.deno.ts
 */
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildWorkerBundle } from './fixtures/fetch-worker/build-worker-bundle.ts';
import { startWorkerFixture } from './fixtures/fetch-worker/fixture-server.ts';
import { assertWorkerRow, WORKER_ROWS, WORKER_ROW_TITLES, type WorkerReport } from './fixtures/fetch-worker/rows.ts';

const bundle = buildWorkerBundle();
if (bundle.nodeInputs.length > 0) throw new Error(`worker bundle contains node: inputs ${JSON.stringify(bundle.nodeInputs)}`);
const fixture = await startWorkerFixture();
const worker = new Worker(pathToFileURL(bundle.scriptPath).href, { type: 'module' });
const report = await new Promise<WorkerReport>((resolve, reject) => {
  worker.onmessage = (event) => resolve(event.data as WorkerReport);
  worker.onerror = (event) => reject(new Error(`worker error: ${event.message}`));
  setTimeout(() => reject(new Error('worker did not report within 20 s')), 20_000);
  worker.postMessage({ origin: fixture.origin });
});
worker.terminate();
await fixture.close();
rmSync(bundle.directory, { recursive: true, force: true });
console.log(`WR ledger: runtime=deno bundleBytes=${bundle.bundleBytes} inputs=${bundle.inputs} report=${JSON.stringify(report)}`);
for (const id of WORKER_ROWS) Deno.test(`${id} (deno worker) ${WORKER_ROW_TITLES[id]}`, () => { assertWorkerRow(report, id, 'deno'); });
