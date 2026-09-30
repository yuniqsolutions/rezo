/**
 * CFC on Deno — the same 28 cURL facade contract rows, executed natively under Deno.
 * Run: deno test --allow-all --no-check test/a-plus-curl-facade-contract.deno.ts
 */
import { startFixtureServer } from './fixtures/curl-facade/fixture-server.ts';
import { requireCurl } from './fixtures/curl-facade/harness.ts';
import { CFC_ROWS } from './fixtures/curl-facade/rows.ts';

const curl = requireCurl();
console.log(`CFC ledger: runtime=deno curl=${curl.path} "${curl.version}"`);
for (const row of CFC_ROWS) {
  Deno.test({ name: `${row.id} ${row.title}`, sanitizeOps: false, sanitizeResources: false, async fn() {
    const fixture = await startFixtureServer();
    try { await row.run(fixture); } finally { await fixture.close(); }
  } });
}
