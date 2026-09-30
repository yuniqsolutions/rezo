/**
 * CFC — the cURL adapter's facade contracts (stream, download, upload, redirect visibility, wait cancellation, child
 * lifecycle) measured against HTTP/1.1 on the same local wire. 28 rows: 24 repair rows + 4 controls; the row bodies live in
 * test/fixtures/curl-facade/ and are shared verbatim with the native Deno driver (a-plus-curl-facade-contract.deno.ts).
 * Every listener is attached before the first byte, every wait settles on the facade's own terminal under a bounded
 * watchdog, wire hits are counted by the fixture, and a missing or foreign curl fails the file instead of skipping.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from './fixtures/curl-facade/fixture-server.ts';
import { RUNTIME, requireCurl } from './fixtures/curl-facade/harness.ts';
import { CFC_ROWS } from './fixtures/curl-facade/rows.ts';
import { installNodeRequireBridge } from './fixtures/node-require-bridge';

let fixture: FixtureServer;
let requireBridge: { restore(): void } | undefined;
beforeAll(async () => {
  if (RUNTIME === 'node') requireBridge = installNodeRequireBridge();
  const curl = requireCurl();
  console.log(`CFC ledger: runtime=${RUNTIME} curl=${curl.path} "${curl.version}"`);
  fixture = await startFixtureServer();
});
afterAll(async () => { await fixture?.close(); requireBridge?.restore(); });

for (const row of CFC_ROWS) {
  it(`${row.id} ${row.title}`, async () => {
    await row.run(fixture);
    expect(true).toBe(true);
  }, 20_000);
}
