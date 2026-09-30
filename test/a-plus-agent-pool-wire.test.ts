// Actual TLS through returned Agents, not Rezo adapter option propagation or proxy routing.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Agent } from 'node:https';
import { AgentPool } from '../src/utils/agent-pool.js';
import { createPoolTlsMaterial, type PoolTlsMaterial } from './fixtures/agent-pool-tls-material.js';
import { requestThroughAgent, withPoolWire } from './fixtures/agent-pool-wire.js';

let material: PoolTlsMaterial;
beforeAll(() => { material = createPoolTlsMaterial(); }, 35000);
afterAll(() => { material?.dispose(); });
const createPool = () => new AgentPool({ dnsCache: false, idleEvictionMs: 0, keepAlive: false });

it('AW-C01 CONTROL native Agent independently authenticates the server and client fixture', async () => {
  await withPoolWire(material, true, async ({ url, seen }) => {
    const agent = new Agent({ ca: material.server.cert, cert: material.first.cert, key: material.first.key, rejectUnauthorized: true });
    try {
      expect(await requestThroughAgent(url, agent)).toBe('client-first');
      expect(seen).toEqual(['client-first']);
    } finally { agent.destroy(); }
  });
}, 10000);

it('AW-01 pooled explicit CA authenticates the real self-signed server', async () => {
  const pool = createPool();
  try {
    await withPoolWire(material, false, async ({ url, seen }) => {
      expect(await requestThroughAgent(url, pool.getHttpsAgent({ ca: material.server.cert }))).toBe('no-client-certificate');
      expect(seen).toEqual(['no-client-certificate']);
    });
  } finally { pool.destroy(); }
}, 10000);

for (const mode of ['pem', 'pfx'] as const) {
  const unsupportedPfx = mode === 'pfx' && Boolean(process.versions.bun);
  it(`AW-${mode === 'pem' ? '02' : '03'} ${unsupportedPfx ? 'native PFX unsupported means typed pool refusal' : `distinct pooled ${mode} clients reach the server as themselves`}`, async () => {
    const pool = createPool();
    try {
      await withPoolWire(material, true, async ({ url, seen }) => {
        if (mode === 'pfx') {
          const native = new Agent({ ca: material.server.cert, rejectUnauthorized: true });
          try {
            const control = requestThroughAgent(url, native, { pfx: material.first.pfx, passphrase: material.passphrase });
            if (unsupportedPfx) {
              await expect(control).rejects.toThrow('pfx is not supported');
              for (const identity of [material.first, material.second]) {
                let refusal: unknown;
                try { pool.getHttpsAgent({ pfx: identity.pfx, passphrase: material.passphrase }); }
                catch (error) { refusal = error; }
                expect(refusal).toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY', isRezoError: true,
                  config: { adapterUsed: null } });
              }
              expect(pool.getStats().httpsAgents).toBe(0);
              expect(seen).toEqual([]);
              return;
            }
            expect(await control).toBe('client-first');
          } finally { native.destroy(); }
        }
        for (const identity of [material.first, material.second]) {
          const options = mode === 'pem' ? { cert: identity.cert, key: identity.key }
            : { pfx: identity.pfx, passphrase: material.passphrase };
          await requestThroughAgent(url, pool.getHttpsAgent({ ca: material.server.cert, ...options }));
        }
        expect(seen).toEqual(mode === 'pfx' ? ['client-first', 'client-first', 'client-second'] : ['client-first', 'client-second']);
        expect(pool.getStats().httpsAgents).toBe(2);
      });
    } finally { pool.destroy(); }
  }, 10000);
}

it('AW-04 a different CA cannot reuse an already trusted connection context', async () => {
  const pool = createPool();
  try {
    await withPoolWire(material, false, async ({ url, seen }) => {
      await requestThroughAgent(url, pool.getHttpsAgent({ ca: material.server.cert }));
      const failureCode = async (agent: Agent) => {
        try { await requestThroughAgent(url, agent); return 'accepted'; }
        catch (error) { return String(Reflect.get(Object(error), 'code') ?? 'no-code'); }
      };
      const native = new Agent({ ca: material.first.cert, rejectUnauthorized: true });
      let expectedCode: string;
      try { expectedCode = await failureCode(native); } finally { native.destroy(); }
      expect(expectedCode).toMatch(/CERT|SELF_SIGNED|ISSUER/);
      expect(await failureCode(pool.getHttpsAgent({ ca: material.first.cert }))).toBe(expectedCode);
      expect(seen).toEqual(['no-client-certificate']);
      expect(pool.getStats().httpsAgents).toBe(2);
    });
  } finally { pool.destroy(); }
}, 10000);

for (const [id, prototype] of [['AW-07', Array.prototype], ['AW-08', Object.prototype]] as const) {
  it(`${id} inherited toJSON cannot collapse distinct TLS pool identities`, () => {
    const pool = createPool();
    const original = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    let calls = 0;
    let reused = false;
    try {
      Object.defineProperty(prototype, 'toJSON', { configurable: true, value() { calls += 1; return 'collapsed'; } });
      reused = pool.getHttpsAgent({ ca: material.first.cert }) === pool.getHttpsAgent({ ca: material.second.cert });
    } finally {
      if (original) Object.defineProperty(prototype, 'toJSON', original); else Reflect.deleteProperty(prototype, 'toJSON');
      pool.destroy();
    }
    expect({ reused, calls }).toEqual({ reused: false, calls: 0 });
  });
}

(process.versions.bun ? it : it.skip)('AW-09 Bun PFX refusal precedes unrelated TLS getters', () => {
  const pool = createPool();
  let reads = 0;
  let refusal: unknown;
  try {
    try {
      pool.getHttpsAgent({ pfx: material.first.pfx,
        get cert(): Buffer { reads += 1; throw new Error('Certificate getter must not run'); },
        get key(): Buffer { reads += 1; throw new Error('Key getter must not run'); },
      });
    } catch (error) { refusal = error; }
    expect(refusal).toMatchObject({ code: 'REZ_UNSUPPORTED_CAPABILITY', config: { adapterUsed: null } });
    expect({ reads, agents: pool.getStats().httpsAgents }).toEqual({ reads: 0, agents: 0 });
  } finally { pool.destroy(); }
});

it('AW-10 PFX is captured once for both capability validation and accepted material', () => {
  const pool = createPool();
  let reads = 0;
  try {
    const agent = pool.getHttpsAgent({ passphrase: material.passphrase,
      get pfx() { reads += 1; return reads === 1 ? undefined : material.first.pfx; },
    });
    expect({ reads, hasPfx: agent.options.pfx !== undefined }).toEqual({ reads: 1, hasPfx: false });
  } finally { pool.destroy(); }
});

it('AW-05 pool-owned identity keys and statistics contain no raw credentials', () => {
  const pool = createPool();
  try {
    const agent = pool.getHttpsAgent({ ca: material.server.cert, cert: material.first.cert,
      key: material.first.key, passphrase: material.passphrase,
      proxy: { protocol: 'http', host: 'example.invalid', port: 8080,
        auth: { username: 'fixture-user', password: 'fixture-password' } },
    });
    // Native options retain TLS fields for Bun; they are configuration, not
    // pool-owned diagnostics. This corrects the initial context-only assumption.
    const pooled = Reflect.get(pool, 'httpsAgents') as Map<string, { key: string }>;
    expect(pooled.size).toBe(1);
    expect([...pooled].every(([key, entry]) => /^[a-f0-9]{64}$/.test(key) && entry.key === key)).toBe(true);
    const statistics = JSON.stringify(pool.getStats());
    expect([material.passphrase, material.first.key.toString(), 'fixture-password', 'fixture-user']
      .some((secret) => statistics.includes(secret))).toBe(false);
    expect(agent.options.secureContext).toBeDefined();
  } finally { pool.destroy(); }
});

it('AW-06 caller Buffer mutation cannot change the accepted TLS context or its reusable identity', async () => {
  const pool = createPool();
  try {
    await withPoolWire(material, true, async ({ url, seen }) => {
      const options = { ca: Buffer.from(material.server.cert), cert: Buffer.from(material.first.cert), key: Buffer.from(material.first.key) };
      const agent = pool.getHttpsAgent(options);
      options.ca.fill(0); options.cert.fill(0); options.key.fill(0);
      expect(await requestThroughAgent(url, agent)).toBe('client-first');
      expect(pool.getHttpsAgent({ ca: material.server.cert, cert: material.first.cert, key: material.first.key })).toBe(agent);
      expect(seen).toEqual(['client-first']);
    });
  } finally { pool.destroy(); }
}, 10000);

it('AW-C02 CONTROL explicit insecure verification remains supported without ambient overrides', async () => {
  const pool = createPool();
  try {
    await withPoolWire(material, false, async ({ url, seen }) => {
      expect(await requestThroughAgent(url, pool.getHttpsAgent({ rejectUnauthorized: false }))).toBe('no-client-certificate');
      expect(seen).toEqual(['no-client-certificate']);
    });
  } finally { pool.destroy(); }
}, 10000);
