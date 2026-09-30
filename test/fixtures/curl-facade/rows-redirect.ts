/**
 * Redirect visibility per hop (repair family 2d): CFC-07 followed chain, CFC-12 the HTTP/1.1 control, CFC-20a credential
 * boundary, CFC-20b cookie boundary, CFC-20c absolute destinationUrl. Wire facts come from the fixture's request log.
 */
import { Rezo } from '../../../src/core/rezo.ts';
import type { FixtureServer } from './fixture-server.ts';
import { ADAPTERS, check, equal, runFacade, type AdapterName, type FacadeOutcome } from './harness.ts';
import type { Row } from './row.ts';

const shape = (outcome: FacadeOutcome) => ({ events: outcome.events, hooks: outcome.hooks, redirects: outcome.redirects, dataBytes: outcome.dataBytes, finished: outcome.finished, hits: outcome.hits, error: outcome.error?.code ?? null, unsettled: outcome.unsettled, late: outcome.lateEvents });
const followedChain = (fixture: FixtureServer) => ({
  events: ['redirect', 'redirect', 'headers:200', 'status:200', 'cookies', 'end', 'finish', 'done', 'complete', 'close'],
  hooks: ['afterHeaders', 'redirect', 'afterHeaders', 'redirect', 'afterHeaders'],
  redirects: [{ sourceUrl: `${fixture.origin}/chain`, destinationUrl: `${fixture.origin}/chain-2`, redirectCount: 1 }, { sourceUrl: `${fixture.origin}/chain-2`, destinationUrl: `${fixture.origin}/200`, redirectCount: 2 }],
  dataBytes: 5, finished: true, hits: 3, error: null, unsettled: false, late: [],
});

/** One buffered GET with caller credentials through `adapter`; returns the credential headers the fixture saw per hit. */
async function credentialHops(fixture: FixtureServer, adapter: AdapterName, path: string, headers: Record<string, string>): Promise<Array<{ host: string; path: string; authorization: string | null; cookie: string | null }>> {
  const rezo = new Rezo({ retry: false, timeout: 8000 } as never, ADAPTERS[adapter]);
  const before = fixture.wire().length;
  const response = await rezo.get(`${fixture.origin}${path}`, { headers } as never);
  check((response as { status: number }).status === 200, `${adapter}: status ${(response as { status: number }).status}`);
  return fixture.wire().slice(before).map((hit) => ({ host: hit.host.split(':')[0], path: hit.path, authorization: hit.authorization, cookie: hit.cookie }));
}

export const redirectRows: Row[] = [
  {
    id: 'CFC-07', title: 'a followed two-hop chain publishes one redirect per hop (afterHeaders → redirect) before the final headers; three hits',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/chain` });
      equal(shape(reference), followedChain(fixture), 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/chain` });
      equal(shape(curl), shape(reference), 'cURL vs HTTP/1.1');
    },
  },
  {
    id: 'CFC-12', title: 'control: the HTTP/1.1 oracle for CFC-07 holds on this runtime (redirect ×2)',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/chain` });
      equal(shape(reference), followedChain(fixture), 'HTTP/1.1 oracle');
    },
  },
  {
    id: 'CFC-20a', title: 'a cross-host redirect drops Authorization on the foreign host and keeps it on the same host — as HTTP/1.1',
    async run(fixture: FixtureServer) {
      const headers = { authorization: 'Bearer cfc-20a' };
      const referenceCross = await credentialHops(fixture, 'http1', '/cross', headers);
      const referenceSame = await credentialHops(fixture, 'http1', '/same', headers);
      equal(referenceCross.map((hit) => [hit.host, hit.authorization]), [['127.0.0.1', 'Bearer cfc-20a'], ['localhost', null]], 'HTTP/1.1 oracle (cross-host)');
      equal(referenceSame.map((hit) => [hit.host, hit.authorization]), [['127.0.0.1', 'Bearer cfc-20a'], ['127.0.0.1', 'Bearer cfc-20a']], 'HTTP/1.1 oracle (same host)');
      equal(await credentialHops(fixture, 'curl', '/cross', headers), referenceCross, 'cURL vs HTTP/1.1 (cross-host)');
      equal(await credentialHops(fixture, 'curl', '/same', headers), referenceSame, 'cURL vs HTTP/1.1 (same host)');
    },
  },
  {
    id: 'CFC-20b', title: 'a cross-host redirect scopes the caller Cookie to its host — as HTTP/1.1',
    async run(fixture: FixtureServer) {
      const headers = { cookie: 'session=cfc-20b' };
      const referenceCross = await credentialHops(fixture, 'http1', '/cross', headers);
      const referenceSame = await credentialHops(fixture, 'http1', '/same', headers);
      equal(referenceCross.map((hit) => [hit.host, hit.cookie]), [['127.0.0.1', 'session=cfc-20b'], ['localhost', null]], 'HTTP/1.1 oracle (cross-host)');
      equal(referenceSame.map((hit) => [hit.host, hit.cookie]), [['127.0.0.1', 'session=cfc-20b'], ['127.0.0.1', 'session=cfc-20b']], 'HTTP/1.1 oracle (same host)');
      equal(await credentialHops(fixture, 'curl', '/cross', headers), referenceCross, 'cURL vs HTTP/1.1 (cross-host)');
      equal(await credentialHops(fixture, 'curl', '/same', headers), referenceSame, 'cURL vs HTTP/1.1 (same host)');
    },
  },
  {
    id: 'CFC-20c', title: 'the redirect payload carries an absolute destinationUrl resolved against the source (relative Location on the wire)',
    async run(fixture: FixtureServer) {
      const reference = await runFacade(fixture, { kind: 'stream', adapter: 'http1', url: `${fixture.origin}/chain` });
      equal(reference.redirects.map((hop) => hop.destinationUrl), [`${fixture.origin}/chain-2`, `${fixture.origin}/200`], 'HTTP/1.1 oracle');
      const curl = await runFacade(fixture, { kind: 'stream', adapter: 'curl', url: `${fixture.origin}/chain` });
      equal(curl.redirects, reference.redirects, 'cURL vs HTTP/1.1');
    },
  },
];
