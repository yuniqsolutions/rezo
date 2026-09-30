// R07 Q4 carrier config (DECISION-153/155): runs ONLY the non-discovered
// Node 22.14 carrier under the canonical serial/forks settings. The carrier
// file deliberately does not match the default `*.test.ts` glob, so it can
// never leak into the ordinary `bun run test` sweep on a zstd-capable host.
// Canonical invocation (supervisor-driven; shell:false, sanitized env, exact
// argv recorded at execution; never npx/shims/version spoofs):
//   REZO_R07_Q4_LEDGER_FILE=<ledger path> \
//   <real node v22.14.0 binary> <abs>/node_modules/vitest/vitest.mjs run \
//     --config test/r07-node22.vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    bail: 0,
    fileParallelism: false,
    hookTimeout: 45_000,
    include: ['test/a-plus-http-compression-integrity-node22.q4.ts'],
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    pool: 'forks',
    // The verbose reporter keeps afterAll console output (the ledger line)
    // visible on an all-pass run; the default reporter dropped it.
    reporters: ['verbose'],
    retry: 0,
    teardownTimeout: 20_000,
    testTimeout: 60_000,
  },
});
