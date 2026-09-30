/** The worker-runtime contract, asserted on the report a worker posts back (shared by the vitest/Bun and Deno drivers). */
export interface WorkerReport { runtime: string; hasDocument: boolean; hasWindow: boolean; hasFetch: boolean; rows: Array<Record<string, unknown>>; failure?: string }

function fail(message: string): never { throw new Error(message); }
const row = (report: WorkerReport, id: string): Record<string, unknown> => report.rows.find((candidate) => candidate.id === id) ?? fail(`${id}: missing from the worker report ${JSON.stringify(report)}`);

export const WORKER_ROWS = ['WR-01', 'WR-02', 'WR-03', 'WR-04'] as const;
export const WORKER_ROW_TITLES: Record<(typeof WORKER_ROWS)[number], string> = {
  'WR-01': 'buffered GET inside the worker delivers the 24-byte body as an ArrayBuffer-like payload',
  'WR-02': 'stream inside the worker emits binary chunks totalling 24 bytes and reaches done without an error',
  'WR-03': 'a rejected 500 inside the worker is a typed REZ_HTTP_ERROR carrying the response',
  'WR-04': 'a caller abort inside the worker settles ABORT_ERR promptly',
};

/** Asserts one row of the report; the shape (no DOM, fetch present) is checked with the first row. */
export function assertWorkerRow(report: WorkerReport, id: (typeof WORKER_ROWS)[number], expectedRuntime: string): void {
  if (report.failure) fail(`worker failed: ${report.failure}`);
  if (report.runtime !== expectedRuntime) fail(`worker runtime ${report.runtime} !== ${expectedRuntime}`);
  if (report.hasDocument || report.hasWindow || !report.hasFetch) fail(`worker shape: document=${report.hasDocument} window=${report.hasWindow} fetch=${report.hasFetch}`);
  const r = row(report, id);
  switch (id) {
    case 'WR-01':
      if (r.status !== 200 || r.bytes !== 24) fail(`WR-01: ${JSON.stringify(r)}`);
      if (!['ArrayBuffer', 'Uint8Array', 'Buffer'].includes(String(r.kind))) fail(`WR-01 payload kind ${String(r.kind)}`);
      return;
    case 'WR-02':
      if (r.bytes !== 24 || Number(r.chunks) < 1 || r.unsettled === true) fail(`WR-02: ${JSON.stringify(r)}`);
      if (!(r.seen as string[]).includes('done') || (r.seen as string[]).some((name) => name.startsWith('error:'))) fail(`WR-02 events ${JSON.stringify(r.seen)}`);
      if (!(r.kinds as string[]).every((kind) => ['Uint8Array', 'Buffer'].includes(kind))) fail(`WR-02 chunk kinds ${JSON.stringify(r.kinds)}`);
      return;
    case 'WR-03':
      if (r.code !== 'REZ_HTTP_ERROR' || r.status !== 500 || r.isRezoError !== true) fail(`WR-03: ${JSON.stringify(r)}`);
      return;
    case 'WR-04':
      if (r.code !== 'ABORT_ERR' || r.prompt !== true) fail(`WR-04: ${JSON.stringify(r)}`);
      return;
  }
}
