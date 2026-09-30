// Generates test/fixtures/stealth/tool-closure.json — the literal runtime/tool identities the stealth supervisor
// verifies before every leg (PLAN/stealth-wire-fidelity v4: Node current, node@24 exception leg, Bun, Deno,
// Chrome for Testing, esbuild, curl + dylibs, OpenSSL CLI, Vitest runner, and the 14 src/stealth files).
//
//   node test/fixtures/stealth/tool-closure.generate.mjs > test/fixtures/stealth/tool-closure.json
//
// This stdout is the SOLE canonical writer of the table (DECISION-063 B Phase 5, residual 13): every
// non-ASCII UTF-16 code unit — surrogate halves included, so astral characters become their pair of
// \uXXXX escapes — is emitted as a lowercase \uXXXX escape, making the bytes pure ASCII and stable
// across writers and platforms. The epoch cascade invokes this generator; no inline rewriter exists.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const version = (command, args) => { try { return execFileSync(command, args, { encoding: 'utf8', timeout: 20_000 }).trim().split('\n')[0]; } catch (error) { return `unavailable: ${error.code ?? error.message}`; } };
const tool = (path, extra = {}) => { const realpath = realpathSync(path); return { path, realpath, sha256: sha256File(realpath), ...extra }; };
const HOME = process.env.HOME ?? '';
const NODE24 = '/opt/homebrew/opt/node@24/bin/node';
const CHROME = `${HOME}/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const curlDylibs = execFileSync('/usr/bin/otool', ['-L', '/opt/local/bin/curl'], { encoding: 'utf8' }).split('\n').slice(1)
  .map((line) => line.trim().split(' ')[0]).filter((path) => path !== '' && existsSync(path))
  .map((path) => ({ path: realpathSync(path), sha256: sha256File(realpathSync(path)) }));

const STEALTH_SOURCES = ['src/stealth/index.ts', 'src/stealth/resolver.ts', 'src/stealth/stealth.ts', 'src/stealth/tls-fingerprint.ts', 'src/stealth/tls-fingerprint.universal.ts', 'src/stealth/types.ts', 'src/stealth/universal.ts', 'src/stealth/profiles/chrome-profiles.ts', 'src/stealth/profiles/constants.ts', 'src/stealth/profiles/edge-profiles.ts', 'src/stealth/profiles/firefox-profiles.ts', 'src/stealth/profiles/index.ts', 'src/stealth/profiles/safari-profiles.ts', 'src/stealth/profiles/types.ts'];
for (const file of STEALTH_SOURCES) if (!existsSync(resolve(ROOT, file))) { console.error(`missing ${file}`); process.exit(2); }

const table = {
  schema: 'rezo.stealth.tool-closure/v4',
  tools: {
    node: tool(process.execPath, { version: process.version, openssl: process.versions.openssl, role: 'Node current leg' }),
    node24: existsSync(NODE24) ? tool(NODE24, { version: version(NODE24, ['--version']), role: 'oldest installed supported runtime (Q9-B exception leg)' }) : { path: NODE24, missing: true },
    bun: tool(`${HOME}/.bun/bin/bun`, { version: version(`${HOME}/.bun/bin/bun`, ['--version']), role: 'Bun leg' }),
    deno: tool('/opt/local/bin/deno', { version: version('/opt/local/bin/deno', ['--version']), role: 'ESH-03 packed public subpath' }),
    chrome: existsSync(CHROME) ? tool(CHROME, { version: '146.0.7680.153', role: 'ESH-05/08 execution; parser golden source — certifies Chrome 146 only' }) : { path: CHROME, missing: true },
    esbuild: tool(resolve(ROOT, 'node_modules/.bin/esbuild'), { version: version(resolve(ROOT, 'node_modules/.bin/esbuild'), ['--version']), role: 'bundle-shape rows' }),
    curl: tool('/opt/local/bin/curl', { version: version('/opt/local/bin/curl', ['--version']), dylibs: curlDylibs, role: 'SRP-curl-* rows and the Q4 probe' }),
    openssl: tool('/opt/homebrew/bin/openssl', { version: version('/opt/homebrew/bin/openssl', ['version']), role: 'SAN certificate generation for the observers' }),
    vitest: { path: 'node_modules/vitest/vitest.mjs', sha256: sha256File(resolve(ROOT, 'node_modules/vitest/vitest.mjs')), version: JSON.parse(readFileSync(resolve(ROOT, 'node_modules/vitest/package.json'), 'utf8')).version, role: 'runner' },
  },
  stealthSources: STEALTH_SOURCES.map((file) => ({ path: file, sha256: sha256File(resolve(ROOT, file)) })),
  pins: Object.fromEntries(['src/adapters/http.ts', 'src/adapters/http2.ts', 'src/adapters/curl.ts', 'package.json', 'tsconfig.json'].map((file) => [file, sha256File(resolve(ROOT, file))])),
  fixtures: Object.fromEntries(['test/fixtures/stealth/wire-observer.mjs', 'test/fixtures/stealth/entry-shape.mjs', 'test/fixtures/stealth/chromium-grease.mjs', 'test/fixtures/stealth/expected/identities.json'].map((file) => [file, sha256File(resolve(ROOT, file))])),
};
// Deliberately NOT a /u regex: matching per UTF-16 code unit escapes each surrogate half of an
// astral character separately - byte-identical to python's ensure_ascii, with lowercase hex.
const asciiCanonical = `${JSON.stringify(table, null, 1)}\n`.replace(/[\u0080-\uffff]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
process.stdout.write(asciiCanonical);
