/**
 * Status decision on the stream facade (repair family 2a): CFC-01, CFC-02, CFC-16, CFC-17, CFC-18.
 * HTTP/1.1 is measured in-row on the same wire; the literal contract is asserted on that oracle first.
 */
import type { FixtureServer } from './fixture-server.ts';
import { check, equal, runFacade, sha256, type FacadeOutcome } from './harness.ts';
import type { Row } from './row.ts';

const facadeShape = (outcome: FacadeOutcome) => ({ events: outcome.events, dataBytes: outcome.dataBytes, finished: outcome.finished, hits: outcome.hits, error: outcome.error && { code: outcome.error.code, status: outcome.error.status, hasResponse: outcome.error.hasResponse }, unsettled: outcome.unsettled, late: outcome.lateEvents });

export const statusRows: Row[] = [
  {
    id: 'CFC-01', title: 'a rejected 500 settles the stream facade with REZ_HTTP_ERROR after the header-time events, no data, one hit',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/500` });
      equal(facadeShape(reference), { events: ['headers:500', 'status:500', 'cookies', 'error:REZ_HTTP_ERROR'], dataBytes: 0, finished: false, hits: 1, error: { code: 'REZ_HTTP_ERROR', status: 500, hasResponse: true }, unsettled: false, late: [] }, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/500` });
      equal(facadeShape(curl), facadeShape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-02', title: 'a throwing validateStatus is a callback failure REZ_UNKNOWN_ERROR after headers, cause identity kept, no data',
    async run(fixture: FixtureServer) {
      const shape = (outcome: FacadeOutcome) => ({ ...facadeShape(outcome), causeIsThrown: outcome.error?.causeIsThrown ?? false });
      const thrown = new Error('validator boom');
      const options = { validateStatus: () => { throw thrown; } };
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/200`, request: options, thrown });
      equal(shape(reference), { events: ['headers:200', 'status:200', 'cookies', 'error:REZ_UNKNOWN_ERROR'], dataBytes: 0, finished: false, hits: 1, error: { code: 'REZ_UNKNOWN_ERROR', status: null, hasResponse: false }, unsettled: false, late: [], causeIsThrown: true }, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/200`, request: options, thrown });
      equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-16', title: 'a stateful validateStatus (false then true) is consulted once: the first verdict rejects the stream',
    async run(fixture: FixtureServer) {
      const build = () => { let calls = 0; return { calls: () => calls, validateStatus: () => { calls += 1; return calls > 1; } }; };
      const h1 = build();
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/200`, request: { validateStatus: h1.validateStatus } });
      equal({ ...facadeShape(reference), calls: h1.calls() }, { events: ['headers:200', 'status:200', 'cookies', 'error:REZ_HTTP_ERROR'], dataBytes: 0, finished: false, hits: 1, error: { code: 'REZ_HTTP_ERROR', status: 200, hasResponse: true }, unsettled: false, late: [], calls: 1 }, 'HTTP/1.1 oracle');
      const c = build();
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/200`, request: { validateStatus: c.validateStatus } });
      equal({ ...facadeShape(curl), calls: c.calls() }, { ...facadeShape(reference), calls: h1.calls() }, 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-17', title: 'a stateful validateStatus (true then false) is consulted once: the stream completes with its five bytes',
    async run(fixture: FixtureServer) {
      const build = () => { let calls = 0; return { calls: () => calls, validateStatus: () => { calls += 1; return calls === 1; } }; };
      const h1 = build();
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/200`, request: { validateStatus: h1.validateStatus } });
      equal({ ...facadeShape(reference), calls: h1.calls(), sha: reference.dataSha256 }, { events: ['headers:200', 'status:200', 'cookies', 'end', 'finish', 'done', 'complete', 'close'], dataBytes: 5, finished: true, hits: 1, error: null, unsettled: false, late: [], calls: 1, sha: sha256('hello') }, 'HTTP/1.1 oracle');
      const c = build();
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/200`, request: { validateStatus: c.validateStatus } });
      equal({ ...facadeShape(curl), calls: c.calls(), sha: curl.dataSha256 }, { ...facadeShape(reference), calls: h1.calls(), sha: reference.dataSha256 }, 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-18', title: 'a rejected 500 whose payload the peer truncates (acceptPartialBody) is exactly one error carrying the response, never a success',
    async run(fixture: FixtureServer) {
      const request = { acceptPartialBody: true };
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/500-truncated`, request });
      check(reference.events.filter((name) => name.startsWith('error:')).length === 1, `HTTP/1.1 oracle: exactly one error, saw ${JSON.stringify(reference.events)}`);
      check(!reference.events.includes('done') && !reference.events.includes('complete'), 'HTTP/1.1 oracle: never a success terminal');
      equal({ dataBytes: reference.dataBytes, status: reference.error?.status, hasResponse: reference.error?.hasResponse, headers: reference.events[0] }, { dataBytes: 0, status: 500, hasResponse: true, headers: 'headers:500' }, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/500-truncated`, request });
      // The code is pinned to what HTTP/1.1 measured on this runtime (the peer reset surfaces as the transport code).
      equal(facadeShape(curl), facadeShape(reference), 'cURL vs HTTP/1.1');
    },
  },
];
