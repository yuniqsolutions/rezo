// CTA: real cURL setup errors must not certify TLS-material acceptance.
// Positive evidence is an independent ClientHello, not receipt by the product's
// private destroy-on-connect listener. No completed handshake/fingerprint claim.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const driver = fileURLToPath(new URL('./fixtures/curl-acceptance-probe-child.ts', import.meta.url));
const wrapper = fileURLToPath(new URL('./fixtures/curl-acceptance-clean.sh', import.meta.url));
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
let directory: string;

interface Hello {
  legacyVersion: string;
  ciphers: string[];
  supportedGroups: string[];
  alpn: string[];
  error?: string;
}
interface Verdict {
  runtime: 'node' | 'bun';
  direct: { code: number | null; signal: string | null; stderr: string; hellos: Hello[] };
  acceptance: { accepted: boolean; detail?: string };
}

beforeAll(() => {
  const version = spawnSync(wrapper, ['--version'], { encoding: 'utf8', timeout: 3000 });
  expect({ error: version.error, status: version.status, signal: version.signal })
    .toEqual({ error: undefined, status: 0, signal: null });
  // These material oracles target an installed OpenSSL-family cURL, not every
  // backend. A missing/incompatible test environment fails visibly; no skip.
  expect(version.stdout.split('\n')[0]).toMatch(/OpenSSL\//u);
  directory = mkdtempSync(join(tmpdir(), 'rezo-curl-acceptance-'));
});
afterAll(() => { if (directory) rmdirSync(directory); });

function probe(args: string[]): Verdict {
  const commandArgs = isBun ? [driver, JSON.stringify(args)] : ['--import', 'tsx', driver, JSON.stringify(args)];
  const child = spawnSync(process.execPath, commandArgs, {
    encoding: 'utf8', timeout: 7000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  expect({ error: child.error?.message, status: child.status, signal: child.signal }, child.stderr)
    .toEqual({ error: undefined, status: 0, signal: null });
  const result = JSON.parse(child.stdout.trim()) as Verdict;
  expect(result.runtime).toBe(isBun ? 'bun' : 'node');
  expect(result.direct.signal).toBeNull();
  return result;
}

describe('real cURL TLS acceptance classification', () => {
  const setupCases = [
    { id: 'CTA-01', name: 'unknown option', code: 2, args: () => ['--rezo-invalid-probe-option'] },
    { id: 'CTA-02', name: 'invalid TLS version', code: 2, args: () => ['--tls-max', 'not-a-version'] },
    { id: 'CTA-03', name: 'missing CA file', code: 77, args: () => ['--cacert', join(directory, 'absent-ca.pem')] },
    { id: 'CTA-04', name: 'missing client certificate', code: 58, args: () => ['--cert', join(directory, 'absent-client.pem'), '--cert-type', 'PEM'] },
  ];
  for (const row of setupCases) {
    it(`${row.id} ${row.name} is not accepted`, () => {
      expect(existsSync(join(directory, 'absent-ca.pem'))).toBe(false);
      expect(existsSync(join(directory, 'absent-client.pem'))).toBe(false);
      const result = probe(row.args());
      // These preconditions distinguish a real setup failure from a listener,
      // loader, watchdog, backend or test-fixture error.
      expect(result.direct.code, result.direct.stderr).toBe(row.code);
      expect(result.direct.stderr.length).toBeGreaterThan(0);
      // OpenSSL may emit a hello before CA loading fails (exit 77). That is
      // still failed setup: seeing a ClientHello alone must not certify it.
      if (row.code === 77) {
        for (const hello of result.direct.hellos) expect(hello.error).toBeUndefined();
      } else {
        expect(result.direct.hellos).toEqual([]);
      }
      expect(result.acceptance.accepted, JSON.stringify(result)).toBe(false);
    }, 10000);
  }

  it('CTA-C01 CONTROL invalid cipher material still refuses with a diagnostic', () => {
    const result = probe(['--ciphers', 'REZO_INVALID_CIPHER']);
    expect(result.direct.code, result.direct.stderr).toBe(59);
    expect(result.direct.hellos).toEqual([]);
    expect(result.acceptance.accepted).toBe(false);
    expect(result.acceptance.detail?.length).toBeGreaterThan(0);
  }, 10000);

  it('CTA-C02 CONTROL independently observed valid material is accepted', () => {
    const result = probe([
      '--tlsv1.2', '--tls-max', '1.2', '--ciphers', 'ECDHE-RSA-AES128-GCM-SHA256',
      '--curves', 'X25519', '--http1.1',
    ]);
    // The observer drops after the ClientHello, so exit 35 is not a negative
    // acceptance oracle. The actual decoded bytes below are the positive one.
    expect(result.direct.code, result.direct.stderr).toBe(35);
    expect(result.direct.hellos).toHaveLength(1);
    const hello = result.direct.hellos[0]!;
    expect(hello.error).toBeUndefined();
    expect(hello.legacyVersion).toBe('0x0303');
    expect(hello.ciphers).toEqual(['ECDHE-RSA-AES128-GCM-SHA256', 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV']);
    expect(hello.supportedGroups).toEqual(['X25519']);
    expect(hello.alpn).toEqual(['http/1.1']);
    expect(result.acceptance.accepted).toBe(true);
  }, 10000);
});
