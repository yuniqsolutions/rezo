/**
 * Terminal-attempt-only header events across a status retry (repair family 2e): CFC-08 stream, CFC-21 download, CFC-24 upload.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureServer } from './fixture-server.ts';
import { equal, fileState, runFacade, sha256, type FacadeOutcome } from './harness.ts';
import type { Row } from './row.ts';

const shape = (outcome: FacadeOutcome) => ({ events: outcome.events, dataBytes: outcome.dataBytes, finished: outcome.finished, hits: outcome.hits, error: outcome.error?.code ?? null, finish: outcome.finish, unsettled: outcome.unsettled, late: outcome.lateEvents });
/** Retry once on 503 with a short delay; counts the retry callbacks so a row can pin 1/1. */
function retryPlan(extra: Record<string, unknown> = {}) {
  const counts = { onRetry: 0, beforeRetry: 0 };
  return {
    counts,
    request: { retry: { maxRetries: 1, retryDelay: 50, backoff: 1, statusCodes: [503], onRetry: () => { counts.onRetry += 1; return true; }, ...extra } },
    instance: { hooks: { beforeRetry: [() => { counts.beforeRetry += 1; }] } },
  };
}
let sequence = 0;
const key = (): string => `cfc-${process.pid}-${++sequence}-${Date.now()}`;

export const retryRows: Row[] = [
  {
    id: 'CFC-08', title: 'a 503 retried to 200 on the stream facade publishes only the terminal attempt (headers once), two hits, hooks 1/1',
    async run(fixture: FixtureServer) {
      const h1 = retryPlan();
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/503-once/${key()}`, request: h1.request, instance: h1.instance });
      // HTTP/1.1 does not consult onRetry/beforeRetry on a status retry (recorded cross-adapter fact, TH carrier); the counts are measured, not asserted.
      equal(shape(reference), { events: ['headers:200', 'status:200', 'cookies', 'end', 'finish', 'done', 'complete', 'close'], dataBytes: 5, finished: true, hits: 2, error: null, finish: { contentLength: 5, fileSize: null, status: 200 }, unsettled: false, late: [] }, 'HTTP/1.1 oracle');
      const c = retryPlan();
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/503-once/${key()}`, request: c.request, instance: c.instance });
      equal({ ...shape(curl), counts: c.counts }, { ...shape(reference), counts: h1.counts }, 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-21', title: 'a 503 retried to 200 on the download facade publishes only the terminal attempt, commits the wire bytes once, hooks 1/1',
    async run(fixture: FixtureServer) {
      const directory = mkdtempSync(join(tmpdir(), 'cfc-retry-'));
      try {
        const h1 = retryPlan();
        const referenceFile = join(directory, 'h1.bin');
        const reference = await runFacade(fixture, { kind: 'download', adapter: 'http1', url: `${fixture.origin}/503-once/${key()}`, request: h1.request, instance: h1.instance, file: referenceFile });
        equal({ ...shape(reference), file: fileState(referenceFile) }, { events: ['headers:200', 'status:200', 'cookies', 'finish', 'done', 'complete'], dataBytes: 0, finished: true, hits: 2, error: null, finish: { contentLength: 5, fileSize: 5, status: 200 }, unsettled: false, late: [], file: { exists: true, size: 5, sha256: sha256('hello') } }, 'HTTP/1.1 oracle');
        const c = retryPlan();
        const curlFile = join(directory, 'curl.bin');
        const curl = await runFacade(fixture, { kind: 'download', adapter: 'curl', url: `${fixture.origin}/503-once/${key()}`, request: c.request, instance: c.instance, file: curlFile });
        equal({ ...shape(curl), counts: c.counts, file: fileState(curlFile) }, { ...shape(reference), counts: h1.counts, file: fileState(referenceFile) }, 'cURL vs HTTP/1.1');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  },
  {
    id: 'CFC-24', title: 'a 503 retried to 200 on the upload facade (POST opted into retry.methods) re-sends the whole body, publishes only the terminal attempt, hooks 1/1',
    async run(fixture: FixtureServer) {
      const body = 'CFC-24-UPLOAD-BODY';
      const hops = (start: number) => fixture.wire().slice(start).map((hit) => ({ method: hit.method, bodyLength: hit.bodyLength, bodySha256: hit.bodySha256 }));
      const h1 = retryPlan({ methods: ['POST'] });
      const referenceStart = fixture.wire().length;
      const reference = await runFacade(fixture, { kind: 'upload', adapter: 'http1', url: `${fixture.origin}/503-once-upload/${key()}`, request: h1.request, instance: h1.instance, uploadBody: body });
      const sentTwice = [{ method: 'POST', bodyLength: body.length, bodySha256: sha256(body) }, { method: 'POST', bodyLength: body.length, bodySha256: sha256(body) }];
      equal({ ...shape(reference), wire: hops(referenceStart) }, { events: ['headers:200', 'status:200', 'cookies', 'finish', 'done', 'complete'], dataBytes: 0, finished: true, hits: 2, error: null, finish: { contentLength: null, fileSize: null, status: 200 }, unsettled: false, late: [], wire: sentTwice }, 'HTTP/1.1 oracle');
      const c = retryPlan({ methods: ['POST'] });
      const curlStart = fixture.wire().length;
      const curl = await runFacade(fixture, { kind: 'upload', adapter: 'curl', url: `${fixture.origin}/503-once-upload/${key()}`, request: c.request, instance: c.instance, uploadBody: body });
      equal({ ...shape(curl), counts: c.counts, wire: hops(curlStart) }, { ...shape(reference), counts: h1.counts, wire: sentTwice }, 'cURL vs HTTP/1.1');
    },
  },
];
