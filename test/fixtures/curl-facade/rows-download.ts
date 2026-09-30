/**
 * Download target integrity (repair family 2c): CFC-05 manual redirect commits no file, CFC-10 accepted download control,
 * CFC-19 rejected 500 leaves a pre-existing target byte-identical, CFC-25 a failed staging cleanup is surfaced as the cause.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureServer } from './fixture-server.ts';
import { check, equal, fileState, runFacade, sha256, type FacadeOutcome } from './harness.ts';
import type { Row } from './row.ts';

const shape = (outcome: FacadeOutcome) => ({ events: outcome.events, finished: outcome.finished, hits: outcome.hits, error: outcome.error?.code ?? null, finish: outcome.finish, unsettled: outcome.unsettled, late: outcome.lateEvents });
const scratch = (): string => mkdtempSync(join(tmpdir(), 'cfc-download-'));

export const downloadRows: Row[] = [
  {
    id: 'CFC-05', title: 'an accepted manual redirect settles the download facade and commits NO file; a pre-existing target stays byte-identical; the stage is gone',
    async run(fixture: FixtureServer) {
      const directory = scratch();
      try {
        const instance = { followRedirects: false };
        const referenceFile = join(directory, 'h1.bin');
        const reference = await runFacade(fixture, { kind: 'download', adapter: 'http1', url: `${fixture.origin}/redirect`, instance, file: referenceFile });
        equal({ ...shape(reference), file: existsSync(referenceFile) }, { events: ['finish', 'done', 'complete'], finished: true, hits: 1, error: null, finish: { contentLength: 0, fileSize: 0, status: 302 }, unsettled: false, late: [], file: false }, 'HTTP/1.1 oracle');
        const curlFile = join(directory, 'curl.bin');
        writeFileSync(curlFile, 'pre-existing');
        const before = fileState(curlFile);
        let stagePath = '';
        const curl = await runFacade(fixture, { kind: 'download', adapter: 'curl', url: `${fixture.origin}/redirect`, instance, file: curlFile, targetDirectory: directory, during: async ({ stageObserved }) => { stagePath = await Promise.race([stageObserved(), new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000))]); } });
        equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
        equal(fileState(curlFile), before, 'pre-existing target byte-identical');
        check(stagePath === '' || !existsSync(stagePath), `stage file still present: ${stagePath}`);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  },
  {
    id: 'CFC-10', title: 'control: an accepted download commits the wire bytes on both adapters with exact terminal metadata',
    async run(fixture: FixtureServer) {
      const directory = scratch();
      try {
        const referenceFile = join(directory, 'h1.bin');
        const reference = await runFacade(fixture, { kind: 'download', adapter: 'http1', url: `${fixture.origin}/200`, file: referenceFile });
        equal({ ...shape(reference), file: fileState(referenceFile) }, { events: ['headers:200', 'status:200', 'cookies', 'finish', 'done', 'complete'], finished: true, hits: 1, error: null, finish: { contentLength: 5, fileSize: 5, status: 200 }, unsettled: false, late: [], file: { exists: true, size: 5, sha256: sha256('hello') } }, 'HTTP/1.1 oracle');
        const curlFile = join(directory, 'curl.bin');
        const curl = await runFacade(fixture, { kind: 'download', adapter: 'curl', url: `${fixture.origin}/200`, file: curlFile });
        equal({ ...shape(curl), file: fileState(curlFile) }, { ...shape(reference), file: fileState(referenceFile) }, 'cURL vs HTTP/1.1');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  },
  {
    id: 'CFC-19', title: 'a rejected 500 on the download facade writes nothing: the pre-existing target is byte-identical and the error carries the response',
    async run(fixture: FixtureServer) {
      const directory = scratch();
      try {
        const referenceFile = join(directory, 'h1.bin');
        writeFileSync(referenceFile, 'pre-existing');
        const referenceBefore = fileState(referenceFile);
        const reference = await runFacade(fixture, { kind: 'download', adapter: 'http1', url: `${fixture.origin}/500`, file: referenceFile });
        equal({ ...shape(reference), status: reference.error?.status, file: fileState(referenceFile) }, { events: ['headers:500', 'status:500', 'cookies', 'error:REZ_HTTP_ERROR'], finished: false, hits: 1, error: 'REZ_HTTP_ERROR', finish: null, unsettled: false, late: [], status: 500, file: referenceBefore }, 'HTTP/1.1 oracle');
        const curlFile = join(directory, 'curl.bin');
        writeFileSync(curlFile, 'pre-existing');
        const curlBefore = fileState(curlFile);
        const curl = await runFacade(fixture, { kind: 'download', adapter: 'curl', url: `${fixture.origin}/500`, file: curlFile });
        equal({ ...shape(curl), status: curl.error?.status, file: fileState(curlFile) }, { ...shape(reference), status: reference.error?.status, file: curlBefore }, 'cURL vs HTTP/1.1');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  },
  {
    id: 'CFC-25', title: 'a rejected 500 whose staging cleanup also fails surfaces both: cause is AggregateError([primary, cleanup]) "Download failed and staging cleanup also failed"',
    async run(fixture: FixtureServer) {
      const directory = scratch();
      const key = `cfc25-${Date.now()}`;
      const curlFile = join(directory, 'curl.bin');
      let stagePath = '';
      try {
        const curl = await runFacade(fixture, {
          kind: 'download', adapter: 'curl', url: `${fixture.origin}/hold/${key}`, file: curlFile, targetDirectory: directory,
          during: async ({ stageObserved }) => {
            stagePath = await Promise.race([stageObserved(), new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000))]);
            // The stage exists: make its directory read-only so the cleanup's unlink fails, then let the response finish.
            if (stagePath !== '') chmodSync(directory, 0o500);
            fixture.release(key);
          },
        });
        chmodSync(directory, 0o700);
        check(stagePath !== '', 'the stage file was never observed');
        const error = curl.error;
        check(error !== null && error.code === 'REZ_HTTP_ERROR' && error.status === 500, `terminal error: ${JSON.stringify(error)}`);
        equal({ events: curl.events, unsettled: curl.unsettled, late: curl.lateEvents, file: existsSync(curlFile) }, { events: ['headers:500', 'status:500', 'cookies', 'error:REZ_HTTP_ERROR'], unsettled: false, late: [], file: false }, 'cURL facade');
        // The public error's cause names both failures (the real transaction helper's contract).
        equal({ causeMessage: error.causeMessage, causeErrorCount: error.causeErrorCount }, { causeMessage: 'Download failed and staging cleanup also failed', causeErrorCount: 2 }, 'cleanup failure surfaced as the cause');
      } finally {
        try { chmodSync(directory, 0o700); } catch { /* already writable */ }
        rmSync(directory, { recursive: true, force: true });
      }
    },
  },
];
