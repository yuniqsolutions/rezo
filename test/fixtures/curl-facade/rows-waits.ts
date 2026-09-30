/**
 * Waits raced against both authorities and the child on abort (repair family 2f): CFC-09 caller abort in a Retry-After wait,
 * CFC-13 caller abort in a status-retry delay, CFC-14 total deadline in a Retry-After wait, CFC-15 a never-settling
 * onRateLimitWait hook under the total deadline, CFC-22 caller abort mid-body on the stream facade.
 */
import type { FixtureServer } from './fixture-server.ts';
import { check, equal, liveCurlChildren, runBuffered, runFacade, type BufferedOutcome } from './harness.ts';
import type { Row } from './row.ts';

const shape = (outcome: BufferedOutcome, budgetMs: number) => ({ code: outcome.code, phase: outcome.phase, prompt: outcome.elapsedMs < budgetMs, hits: outcome.hits, hooks: outcome.hooks, fulfilled: outcome.fulfilled });
let sequence = 0;
const key = (): string => `cfc-wait-${process.pid}-${++sequence}-${Date.now()}`;

export const waitRows: Row[] = [
  {
    id: 'CFC-09', title: 'a caller abort during a Retry-After wait settles ABORT_ERR within 1.1 s, onAbort once, one hit',
    async run(fixture: FixtureServer) {
      const run = { url: `${fixture.origin}/429`, request: { retry: false, waitOnStatus: [429] }, abortAfterMs: 150 };
      const reference = await runBuffered(fixture, { adapter: 'http1', ...run });
      equal(shape(reference, 1100), { code: 'ABORT_ERR', phase: null, prompt: true, hits: 1, hooks: ['onAbort'], fulfilled: false }, 'HTTP/1.1 oracle');
      const curl = await runBuffered(fixture, { adapter: 'curl', ...run });
      equal(shape(curl, 1100), shape(reference, 1100), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-13', title: 'a caller abort during a status-retry delay settles ABORT_ERR within 1.2 s, one hit',
    async run(fixture: FixtureServer) {
      const request = { retry: { maxRetries: 1, retryDelay: 5000, backoff: 1, statusCodes: [503] } };
      const reference = await runBuffered(fixture, { adapter: 'http1', url: `${fixture.origin}/503-once/${key()}`, request, abortAfterMs: 150 });
      equal(shape(reference, 1200), { code: 'ABORT_ERR', phase: null, prompt: true, hits: 1, hooks: ['onAbort'], fulfilled: false }, 'HTTP/1.1 oracle');
      const curl = await runBuffered(fixture, { adapter: 'curl', url: `${fixture.origin}/503-once/${key()}`, request, abortAfterMs: 150 });
      equal(shape(curl, 1200), shape(reference, 1200), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-14', title: 'the total deadline during a Retry-After wait settles ECONNABORTED phase total within 1.1 s, onTimeout once, one hit',
    async run(fixture: FixtureServer) {
      const run = { url: `${fixture.origin}/429`, instance: { timeout: { total: 400 } }, request: { retry: false, waitOnStatus: [429] } };
      const reference = await runBuffered(fixture, { adapter: 'http1', ...run });
      equal(shape(reference, 1100), { code: 'ECONNABORTED', phase: 'total', prompt: true, hits: 1, hooks: ['onTimeout'], fulfilled: false }, 'HTTP/1.1 oracle');
      const curl = await runBuffered(fixture, { adapter: 'curl', ...run });
      equal(shape(curl, 1100), shape(reference, 1100), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-15', title: 'a never-settling onRateLimitWait hook cannot outlive the total deadline: ECONNABORTED phase total within 1.1 s, one hit',
    async run(fixture: FixtureServer) {
      const run = { url: `${fixture.origin}/429`, instance: { timeout: { total: 400 }, hooks: { onRateLimitWait: [() => new Promise<void>(() => { /* never settles */ })] } }, request: { retry: false, waitOnStatus: [429] } };
      const reference = await runBuffered(fixture, { adapter: 'http1', ...run });
      equal(shape(reference, 1100), { code: 'ECONNABORTED', phase: 'total', prompt: true, hits: 1, hooks: ['onTimeout'], fulfilled: false }, 'HTTP/1.1 oracle');
      const curl = await runBuffered(fixture, { adapter: 'curl', ...run });
      // Today's RED observation is `code: 'unsettled'` (the harness watchdog tore the request down); the target is the oracle.
      equal(shape(curl, 1100), shape(reference, 1100), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-22', title: 'a caller abort mid-body on the stream facade settles ABORT_ERR after the first five bytes; no late data or done; the child is gone',
    async run(fixture: FixtureServer) {
      const abortAt = (ms: number) => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; };
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/slow/${key()}`, request: { signal: abortAt(400) } });
      equal({ events: reference.events, dataBytes: reference.dataBytes, finished: reference.finished, hits: reference.hits, late: reference.lateEvents, unsettled: reference.unsettled }, { events: ['headers:200', 'status:200', 'cookies', 'error:ABORT_ERR'], dataBytes: 5, finished: false, hits: 1, late: [], unsettled: false }, 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/slow/${key()}`, request: { signal: abortAt(400) } });
      equal({ events: curl.events, dataBytes: curl.dataBytes, finished: curl.finished, hits: curl.hits, late: curl.lateEvents, unsettled: curl.unsettled }, { events: reference.events, dataBytes: reference.dataBytes, finished: reference.finished, hits: reference.hits, late: reference.lateEvents, unsettled: reference.unsettled }, 'cURL vs HTTP/1.1');
      const deadline = Date.now() + 1500;
      while (liveCurlChildren().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      check(liveCurlChildren().length === 0, `live curl children after the abort: ${JSON.stringify(liveCurlChildren())}`);
    },
  },
];
