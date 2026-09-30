// Pool identity (not wire) and selected LRU contract. Former fake PEM/PFX bytes
// are valid disposable material now that secureContext must honor the inputs.
// Actual TLS behavior is covered separately in a-plus-agent-pool-wire.test.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { AgentPool } from '../src/utils/agent-pool.js';
import { createPoolTlsMaterial, type PoolTlsMaterial } from './fixtures/agent-pool-tls-material.js';

type AgentOptions = NonNullable<Parameters<AgentPool['getHttpsAgent']>[0]>;
type AgentPair = readonly [AgentOptions, AgentOptions];
type ProbeEvent = {
  phase: string;
  runtime?: string;
  version?: string;
  first?: number | null;
  second?: number | null;
  size?: number;
  errorName?: string;
};

let material: PoolTlsMaterial;
beforeAll(() => { material = createPoolTlsMaterial(); }, 35000);
afterAll(() => { material?.dispose(); });

const runtime = process.versions.bun ? 'bun' : 'node';
const runtimeVersion = process.versions.bun ?? process.versions.node;
const lruSource = new URL('../src/cache/lru-cache.ts', import.meta.url).href;

function capacityProbe(maxEntries: number): ProbeEvent {
  // Synchronous writes make the before-set marker observable even when set()
  // spins forever and its child must be killed. Import/startup is outside the
  // product-refusal catch, so an unavailable loader cannot count as a pass.
  const script = `
    import { writeSync } from 'node:fs';
    const emit = (event) => writeSync(1, JSON.stringify(event) + '\\n');
    emit({phase:'started', runtime:process.versions.bun ? 'bun' : 'node',
      version:process.versions.bun ?? process.versions.node});
    const { LRUCache } = await import(${JSON.stringify(lruSource)});
    emit({phase:'before-construction'});
    let phase = 'construction';
    let cache;
    let refused = false;
    try {
      cache = new LRUCache({maxEntries:${maxEntries}});
      phase = 'set';
      emit({phase:'before-set'});
      cache.set('first', 1);
      cache.set('second', 2);
    } catch (error) {
      refused = true;
      emit({phase:'refused-' + phase, errorName:error.name});
    }
    if (!refused) emit({phase:'completed', first:cache.get('first') ?? null,
      second:cache.get('second') ?? null, size:cache.size});
  `;
  const args = runtime === 'bun' ? ['--eval', script] : ['--input-type=module', '--eval', script];
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 2_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
  });
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const events = stdout.trim().split('\n').filter(Boolean).map((line): ProbeEvent => {
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== 'object' || !('phase' in event) || typeof event.phase !== 'string') {
      throw new Error(`Invalid capacity-probe event: ${line}`);
    }
    return event as ProbeEvent;
  });
  const phases = events.map((event) => event.phase);
  const details = JSON.stringify({ runtime, runtimeVersion, maxEntries,
    status: child.status, signal: child.signal, error: child.error?.message, phases, stdout, stderr });
  expect(events[0], `Child startup/runtime failed: ${details}`).toEqual({
    phase: 'started', runtime, version: runtimeVersion,
  });
  expect(phases[1], `LRU import/startup failed: ${details}`).toBe('before-construction');
  if (child.error || child.signal || child.status !== 0) {
    const boundary = phases.includes('before-set') ? 'set did not settle'
      : 'constructor did not settle';
    throw new Error(`LRU capacity ${maxEntries}: ${boundary}; ${details}`);
  }
  expect(stderr, `Unexpected child diagnostic: ${details}`).toBe('');
  const terminal = events.at(-1)!;
  const expectedPhases = terminal.phase === 'refused-construction'
    ? ['started', 'before-construction', 'refused-construction']
    : ['started', 'before-construction', 'before-set', terminal.phase];
  expect(phases, `Unexpected child event sequence: ${details}`).toEqual(expectedPhases);
  expect(['completed', 'refused-construction', 'refused-set'], details).toContain(terminal.phase);
  return terminal;
}

it('CP-01 zero capacity completes without storing either entry', () => {
  expect(capacityProbe(0)).toEqual({ phase: 'completed', first: null, second: null, size: 0 });
}, 10_000);

it('CP-02 negative capacity throws RangeError during construction', () => {
  expect(capacityProbe(-1)).toEqual({ phase: 'refused-construction', errorName: 'RangeError' });
}, 10_000);

for (const [index, capacity] of [0.5, NaN, Infinity, -Infinity].entries()) {
  it(`CP-0${index + 3} invalid capacity ${capacity} throws RangeError during construction`, () => {
    expect(capacityProbe(capacity)).toEqual({ phase: 'refused-construction', errorName: 'RangeError' });
  }, 10_000);
}

it('CP-C01 capacity one CONTROL executes the same child and preserves newest-entry eviction', () => {
  expect(capacityProbe(1)).toEqual({ phase: 'completed', first: null, second: 2, size: 1 });
}, 10_000);

function pooledIdentity(pair: AgentPair): boolean {
  const pool = new AgentPool({ dnsCache: false, idleEvictionMs: 0 });
  try {
    return pool.getHttpsAgent(pair[0]) === pool.getHttpsAgent(pair[1]);
  } finally {
    // No request is dispatched: these Agents have no sockets. Destroy still
    // runs before the assertion, including a RED row or construction failure.
    pool.destroy();
  }
}

const prefix = 'Synthetic PEM fixture prefix shared beyond 32 characters\n';
const proxy = (username: string, password: string) => ({
  protocol: 'http', host: 'example.invalid', port: 8080, auth: { username, password },
});
const distinct: Array<{ id: string; title: string; pair(): AgentPair }> = [
  { id: 'AI-01', title: 'different CA Buffer bytes', pair: () => [{ ca: material.first.cert }, { ca: material.second.cert }] },
  { id: 'AI-02', title: 'CA strings differing after their first 32 characters', pair: () => [{ ca: prefix + material.first.cert }, { ca: prefix + material.second.cert }] },
  { id: 'AI-03', title: 'certificate strings differing after their first 32 characters', pair: () => [{ cert: prefix + material.first.cert }, { cert: prefix + material.second.cert }] },
  { id: 'AI-04', title: 'different certificate Buffer bytes', pair: () => [{ cert: material.first.cert }, { cert: material.second.cert }] },
  { id: 'AI-05', title: 'different private-key bytes', pair: () => [{ key: material.first.key }, { key: material.second.key }] },
  { id: 'AI-08', title: 'different proxy passwords for the same endpoint and username', pair: () => [{ proxy: proxy('synthetic-user', 'password-a') }, { proxy: proxy('synthetic-user', 'password-b') }] },
  { id: 'AI-09', title: 'proxy username delimiters cannot impersonate an SNI field', pair: () => [{ proxy: proxy('user|sni:a.invalid', 'same') }, { proxy: proxy('user', 'same'), servername: 'a.invalid' }] },
  { id: 'AI-10', title: 'complete ordered CA-array contents', pair: () => [{ ca: [material.server.cert, material.first.cert] }, { ca: [material.server.cert, material.second.cert] }] },
  { id: 'AI-11', title: 'empty SNI versus default SNI', pair: () => [{ servername: '' }, {}] },
];
for (const row of distinct) {
  it(`${row.id} pool separates ${row.title}`, () => {
    expect(pooledIdentity(row.pair()), `${row.id}: distinct supplied identities reused one Agent`).toBe(false);
  });
}

it('AI-06 PFX bytes separate, or the unsupported native provider refuses before pooling', () => {
  const pair: AgentPair = [{ pfx: material.first.pfx, passphrase: material.passphrase }, { pfx: material.second.pfx, passphrase: material.passphrase }];
  if (runtime !== 'bun') { expect(pooledIdentity(pair)).toBe(false); return; }
  const pool = new AgentPool({ dnsCache: false, idleEvictionMs: 0 });
  try {
    for (const options of pair) expect(() => { pool.getHttpsAgent(options); }).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY' }));
    expect(pool.getStats().httpsAgents).toBe(0);
  } finally { pool.destroy(); }
});

it('AI-07 invalid PFX passphrase never falls back to another pooled identity', () => {
  const pool = new AgentPool({ dnsCache: false, idleEvictionMs: 0 });
  try {
    if (runtime === 'bun') {
      for (const passphrase of [material.passphrase, 'wrong-fixture-phrase']) {
        expect(() => { pool.getHttpsAgent({ pfx: material.first.pfx, passphrase }); }).toThrow(expect.objectContaining({ code: 'REZ_UNSUPPORTED_CAPABILITY' }));
      }
      expect(pool.getStats().httpsAgents).toBe(0);
      return;
    }
    pool.getHttpsAgent({ pfx: material.first.pfx, passphrase: material.passphrase });
    expect(() => { pool.getHttpsAgent({ pfx: material.first.pfx, passphrase: 'wrong-fixture-phrase' }); }).toThrow();
    expect(pool.getStats().httpsAgents).toBe(1);
  } finally { pool.destroy(); }
});

const controls: Array<{ id: string; title: string; reuse: boolean; pair(): AgentPair }> = [
  { id: 'AI-C01', title: 'equal default options reuse', reuse: true, pair: () => [{}, {}] },
  { id: 'AI-C02', title: 'equal CA bytes in separately allocated Buffers reuse', reuse: true, pair: () => [{ ca: Buffer.from(material.first.cert) }, { ca: Buffer.from(material.first.cert) }] },
  { id: 'AI-C03', title: 'equal full PEM TLS material in independently allocated carriers reuses', reuse: true,
    pair: () => {
      const options = (): AgentOptions => ({ ca: material.server.cert.toString(), cert: Buffer.from(material.first.cert),
        key: Buffer.from(material.first.key), passphrase: material.passphrase,
        servername: 'example.invalid', rejectUnauthorized: true });
      return [options(), options()];
    } },
  { id: 'AI-C04', title: 'equal proxy credentials in separate objects reuse', reuse: true,
    pair: () => [{ proxy: proxy('same-user', 'same-password') }, { proxy: proxy('same-user', 'same-password') }] },
  { id: 'AI-C05', title: 'different server names separate', reuse: false,
    pair: () => [{ servername: 'a.invalid' }, { servername: 'b.invalid' }] },
  { id: 'AI-C06', title: 'different trust-verification policies separate', reuse: false,
    pair: () => [{ rejectUnauthorized: true }, { rejectUnauthorized: false }] },
  { id: 'AI-C07', title: 'different proxy usernames separate', reuse: false,
    pair: () => [{ proxy: proxy('user-a', 'same-password') }, { proxy: proxy('user-b', 'same-password') }] },
  { id: 'AI-C08', title: 'equal CA bytes across string, Buffer and single-element array carriers reuse', reuse: true,
    pair: () => [{ ca: material.server.cert.toString() }, { ca: [Buffer.from(material.server.cert)] }] },
  { id: 'AI-C09', title: 'default and explicit verification enabled reuse', reuse: true,
    pair: () => [{}, { rejectUnauthorized: true }] },
];
for (const row of controls) {
  it(`${row.id} CONTROL ${row.title}`, () => {
    expect(pooledIdentity(row.pair()), `${row.id}: reuse=${row.reuse}`).toBe(row.reuse);
  });
}
