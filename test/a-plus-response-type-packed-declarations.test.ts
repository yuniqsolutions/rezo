// responseType in the PACKED declarations (DECISION-063 C, carrier 7).
//
// Source-level types are not the shipped contract: consumers compile against
// the generated `.d.ts` files inside the published tarball. This carrier
// builds a REAL pack/install with the repository bundler, writes a consumer
// module against the packed package, and compiles it with the pinned
// TypeScript — so a claim about the public responseType contract is only
// credited when the artifact a customer installs actually carries it.
//
// RED-first on the pre-C bytes: the packed declarations inherit today's
// source types, so the 11-token intake, the 8-token default set, the 9
// canonical effective modes, and the Promise-shaped facade returns are all
// absent from the artifact.
//
// PD-01 is the positive control: the 19 declaration outputs must exist and a
// plain typed call must compile from the packed entry. If it ever fails, the
// pack/install/compile harness broke and no other row is interpretable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packStealth } from './fixtures/stealth/entry-shape.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The 19 declaration outputs `scripts/bundle.ts` generates, behind 18 specifiers. */
const DECLARATION_OUTPUTS = [
  'index.d.ts', 'crawler.d.ts', 'dom/index.d.ts', 'wget/index.d.ts',
  'platform/node.d.ts', 'platform/browser.d.ts', 'platform/bun.d.ts',
  'platform/deno.d.ts', 'platform/worker.d.ts', 'platform/react-native.d.ts',
  'adapters/entries/http.d.ts', 'adapters/entries/http2.d.ts',
  'adapters/entries/fetch.d.ts', 'adapters/entries/curl.d.ts',
  'adapters/entries/xhr.d.ts', 'adapters/entries/react-native.d.ts',
  'stealth/index.d.ts', 'stealth/universal.d.ts', 'adapters/index.d.ts',
] as const;

interface PackedInstall { packageDir: string; installDir: string; tarball: string }

let packed: PackedInstall;
const stages = new Set<string>();
const consumerFiles: string[] = [];

/** Compiles one consumer source against the PACKED declarations. */
function compileConsumer(name: string, source: string): { diagnostics: string[] } {
  const ts = require('typescript') as typeof import('typescript');
  const consumerPath = join(packed.installDir, `${name}.ts`);
  writeFileSync(consumerPath, source, 'utf8');
  consumerFiles.push(consumerPath);

  const program = ts.createProgram([consumerPath], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  );
  return { diagnostics };
}

beforeAll(async () => {
  packed = packStealth(REPO_ROOT) as PackedInstall;
  stages.add(dirname(packed.tarball));
}, 400_000);

afterAll(() => {
  for (const file of consumerFiles) rmSync(file, { force: true });
  for (const stage of stages) {
    rmSync(stage, { recursive: true, force: true });
    expect(existsSync(stage), `packed stage ${stage} survived cleanup`).toBe(false);
  }
});

describe('responseType in packed declarations', () => {
  it('PD-01 CONTROL: all 19 declaration outputs ship and a plain typed call compiles from the packed entry', () => {
    const missing = DECLARATION_OUTPUTS.filter(
      (relative) => !existsSync(join(packed.packageDir, 'dist', relative)),
    );
    expect(missing).toEqual([]);

    const { diagnostics } = compileConsumer('control-consumer', [
      "import rezo from 'rezo';",
      "const response = rezo.get('https://example.invalid/', { responseType: 'json' });",
      'export default response;',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
  }, 400_000);

  it('PD-02 the packed entry accepts all 11 request tokens', () => {
    const calls = [
      'auto', 'json', 'text', 'blob', 'arrayBuffer', 'arraybuffer',
      'buffer', 'binary', 'stream', 'download', 'upload',
    ].map((token, index) =>
      `export const call${index} = rezo.get('https://example.invalid/', { responseType: '${token}' });`,
    );
    const { diagnostics } = compileConsumer('tokens-consumer', [
      "import rezo from 'rezo';",
      ...calls,
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
  }, 200_000);

  it('PD-03 the packed entry rejects unknown and miscased tokens', () => {
    const { diagnostics } = compileConsumer('invalid-consumer', [
      "import rezo from 'rezo';",
      "export const bogus = rezo.get('https://example.invalid/', { responseType: 'bogus' });",
      "export const miscased = rezo.get('https://example.invalid/', { responseType: 'JSON' });",
      "export const facadeMiscased = rezo.get('https://example.invalid/', { responseType: 'STREAM' });",
      '',
    ].join('\n'));
    // Each of the three invalid spellings must produce at least one diagnostic.
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
  }, 200_000);

  it('PD-04 packed instance defaults accept the 8 buffered inputs and refuse facade modes', () => {
    // `create` is a method on the default export, not a named export. The
    // earlier spelling made BOTH halves dishonest: the accepted half failed on
    // an unresolvable import, and the refused half passed on that same
    // unresolvable import rather than on the facade-default refusal.
    const accepted = compileConsumer('defaults-accepted-consumer', [
      "import rezo from 'rezo';",
      "export const a = rezo.create({ responseType: 'auto' });",
      "export const b = rezo.create({ responseType: 'arraybuffer' });",
      "export const c = rezo.create({ responseType: 'binary' });",
      '',
    ].join('\n'));
    expect(accepted.diagnostics).toEqual([]);

    const refused = compileConsumer('defaults-refused-consumer', [
      "import rezo from 'rezo';",
      "export const streamDefault = rezo.create({ responseType: 'stream' });",
      "export const downloadDefault = rezo.create({ responseType: 'download' });",
      '',
    ].join('\n'));
    expect(refused.diagnostics.length).toBeGreaterThanOrEqual(2);
    // Refused for the ruled reason — the facade token — not for an unrelated
    // resolution failure that would make this row pass without proving anything.
    for (const diagnostic of refused.diagnostics) {
      expect(diagnostic).toMatch(/responsetype|["']stream["']|["']download["']/i);
    }
  }, 200_000);

  it('PD-05 packed ordinary facade-selecting calls are Promise-shaped', () => {
    const { diagnostics } = compileConsumer('facade-consumer', [
      "import rezo from 'rezo';",
      "import type { RezoStreamResponse } from 'rezo';",
      "const put = rezo.put('https://example.invalid/', {}, { responseType: 'stream' });",
      'type Equal<L, R> = (<V>() => V extends L ? 1 : 2) extends (<V>() => V extends R ? 1 : 2) ? true : false;',
      'type Assert<V extends true> = V;',
      'export type PutIsPromise = Assert<Equal<typeof put, Promise<RezoStreamResponse>>>;',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
  }, 200_000);
});
