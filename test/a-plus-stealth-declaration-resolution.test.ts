/**
 * SDR — packed stealth declarations resolve and compile for every published condition set (DECISION-060 cross-check, 2026-08-29).
 *
 * Measured on the packed artifact: `exports["./stealth"]` lists `types` before `react-native` / `browser`, so TypeScript selects
 * `dist/stealth/index.d.ts` for every condition set and never `universal.d.ts`; and `index.d.ts` references `tls.SecureContext` /
 * `tls.ConnectionOptions` without importing `node:tls` (the default import is dropped by the declaration bundler) → TS2503 for
 * every consumer, Node included. Each row resolves with the TypeScript API and compiles a strict `noEmit` consumer against the
 * real packed install (offline, version pinned to the committed `src/version.ts`); the self-mutation row proves the resolver
 * check discriminates. Admitted to `test/` on 2026-08-29 20:53Z under the Engineer's co-signed-role ruling.
 */

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

// @ts-expect-error — untyped ESM fixture
import { packStealth } from './fixtures/stealth/entry-shape.mjs';
// The source entry and the exports map are this carrier's static inputs as well as its packed inputs: the admission legs mutate
// exactly `src/stealth/tls-fingerprint.ts` (reached through the Node entry) and `package.json`, and a leg's mutated file must sit in
// the carrier's frozen static closure, not only behind the pack.
import * as nodeEntry from '../src/stealth/index';
import packageJson from '../package.json';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const ROOT = resolve(import.meta.dirname, '..');
const packed = packStealth(ROOT) as { installDir: string; tarballSha256: string };
const CONDITIONS = { node: [], browser: ['browser'], 'react-native': ['react-native'] } as const;
type ConditionSet = keyof typeof CONDITIONS;

function resolveStealth(installDir: string, customConditions: readonly string[]): string {
  const options: import('typescript').CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, customConditions: [...customConditions] };
  const result = ts.resolveModuleName('rezo/stealth', join(installDir, 'consumer.ts'), options, ts.sys);
  const file = result.resolvedModule?.resolvedFileName ?? '<unresolved>';
  return file.slice(file.indexOf('/node_modules/rezo/') + '/node_modules/rezo/'.length);
}

function consumerDiagnostics(installDir: string, condition: ConditionSet, control = false): string[] {
  const file = join(installDir, control ? 'consumer-control.ts' : `consumer-${condition}.ts`);
  writeFileSync(file, control
    ? 'declare const context: tls.SecureContext; export const probe = context;\n'
    : "import { RezoStealth } from 'rezo/stealth';\nexport const stealth = new RezoStealth({} as never);\nexport const resolved = stealth.resolve();\n");
  const options: import('typescript').CompilerOptions = { strict: true, noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, customConditions: [...CONDITIONS[condition]], target: ts.ScriptTarget.ES2022 };
  if (condition === 'node') options.types = ['node']; else { options.types = []; options.lib = ['lib.es2022.d.ts', 'lib.dom.d.ts']; }
  const program = ts.createProgram([file], options);
  return [...new Set(ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`.slice(0, 160)))];
}

it('SDR-01 control: the Node condition set resolves rezo/stealth to the Node declaration (dist/stealth/index.d.ts)', () => {
  expect(resolveStealth(packed.installDir, CONDITIONS.node)).toBe('dist/stealth/index.d.ts');
});

it('SDR-02 the browser condition set resolves rezo/stealth to the universal declaration (dist/stealth/universal.d.ts)', () => {
  expect(resolveStealth(packed.installDir, CONDITIONS.browser)).toBe('dist/stealth/universal.d.ts');
});

it('SDR-03 the react-native condition set resolves rezo/stealth to the universal declaration (dist/stealth/universal.d.ts)', () => {
  expect(resolveStealth(packed.installDir, CONDITIONS['react-native'])).toBe('dist/stealth/universal.d.ts');
});

it('SDR-04 a strict consumer of rezo/stealth compiles with zero diagnostics under every condition set (no TS2503 from the packed declaration)', () => {
  const report = Object.fromEntries((Object.keys(CONDITIONS) as ConditionSet[]).map((condition) => [condition, consumerDiagnostics(packed.installDir, condition)]));
  expect(report).toEqual({ node: [], browser: [], 'react-native': [] });
});

it('SDR-05 control: the consumer compile catches a missing tls namespace (TS2503) when a consumer references it without an import', () => {
  expect(consumerDiagnostics(packed.installDir, 'node', true)).toEqual(["TS2503 Cannot find namespace 'tls'."]);
});

it('SDR-06 non-vacuity: on a temp copy of the packed package whose ./stealth export lists the react-native and browser blocks before types, those condition sets select universal.d.ts and Node keeps index.d.ts', () => {
  const mutated = mkdtempSync(join(tmpdir(), 'stealth-exports-order-'));
  cpSync(packed.installDir, mutated, { recursive: true });
  const packagePath = join(mutated, 'node_modules', 'rezo', 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { exports: Record<string, Record<string, unknown>> };
  const stealth = manifest.exports['./stealth'];
  manifest.exports['./stealth'] = { 'react-native': stealth['react-native'], browser: stealth.browser, types: stealth.types, import: stealth.import, require: stealth.require };
  writeFileSync(packagePath, JSON.stringify(manifest, null, 2));
  expect({ node: resolveStealth(mutated, CONDITIONS.node), browser: resolveStealth(mutated, CONDITIONS.browser), 'react-native': resolveStealth(mutated, CONDITIONS['react-native']) })
    .toEqual({ node: 'dist/stealth/index.d.ts', browser: 'dist/stealth/universal.d.ts', 'react-native': 'dist/stealth/universal.d.ts' });
});

it('SDR-07 control: the Node stealth entry and the exports map are the carrier\'s static inputs (the legs mutate tls-fingerprint.ts and package.json through them)', () => {
  expect(typeof nodeEntry.createSecureContext).toBe('function');
  expect(typeof nodeEntry.buildTlsOptions).toBe('function');
  expect(Object.keys((packageJson as { exports: Record<string, Record<string, unknown>> }).exports['./stealth'])).toEqual(['react-native', 'browser', 'workerd', 'edge-light', 'types', 'import', 'require']);
});
