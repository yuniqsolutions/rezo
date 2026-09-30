/**
 * Facade terminals (repair family 2b): CFC-03 accepted stream, CFC-04 manual-redirect stream, CFC-06 manual-redirect upload,
 * CFC-11 the HTTP/1.1 self-check control for CFC-03.
 */
import type { FixtureServer } from './fixture-server.ts';
import { equal, runFacade, sha256, type FacadeOutcome } from './harness.ts';
import type { Row } from './row.ts';

const shape = (outcome: FacadeOutcome) => ({ events: outcome.events, dataBytes: outcome.dataBytes, sha: outcome.dataSha256, finished: outcome.finished, hits: outcome.hits, error: outcome.error?.code ?? null, unsettled: outcome.unsettled, late: outcome.lateEvents });
const ACCEPTED_STREAM = { events: ['headers:200', 'status:200', 'cookies', 'end', 'finish', 'done', 'complete', 'close'], dataBytes: 5, sha: sha256('hello'), finished: true, hits: 1, error: null, unsettled: false, late: [] };
const MANUAL_REDIRECT_STREAM = { events: ['end', 'finish', 'done', 'complete', 'close'], dataBytes: 0, sha: '', finished: true, hits: 1, error: null, unsettled: false, late: [] };
const MANUAL_REDIRECT_UPLOAD = { events: ['finish', 'done', 'complete'], dataBytes: 0, sha: '', finished: true, hits: 1, error: null, unsettled: false, late: [] };

export const terminalRows: Row[] = [
  {
    id: 'CFC-03', title: 'an accepted stream publishes headers, five body bytes, then end → finish → done → complete → close, finished',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/200` });
      equal(shape(reference), ACCEPTED_STREAM, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/200` });
      equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-04', title: 'an accepted manual redirect (followRedirects: false) settles the stream with the lawful terminal, streams nothing, no redirect event',
    async run(fixture: FixtureServer) {
      const instance = { followRedirects: false };
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/redirect`, instance });
      equal(shape(reference), MANUAL_REDIRECT_STREAM, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/redirect`, instance });
      equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-06', title: 'an accepted manual redirect settles the upload facade with finish → done → complete, finished',
    async run(fixture: FixtureServer) {
      const instance = { followRedirects: false };
      const reference = await runFacade(fixture, { kind: 'upload', adapter: 'http1', url: `${fixture.origin}/redirect`, instance });
      equal(shape(reference), MANUAL_REDIRECT_UPLOAD, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'upload', adapter: 'curl', url: `${fixture.origin}/redirect`, instance });
      equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-11', title: 'control: the HTTP/1.1 oracle for CFC-03 holds on this runtime',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/200` });
      equal(shape(reference), ACCEPTED_STREAM, 'HTTP/1.1 oracle');
    },
  },
];
