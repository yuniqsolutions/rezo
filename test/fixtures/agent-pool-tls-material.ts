import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TlsIdentity { cert: Buffer; key: Buffer; pfx: Buffer }
export interface PoolTlsMaterial {
  server: TlsIdentity;
  first: TlsIdentity;
  second: TlsIdentity;
  passphrase: string;
  dispose(): void;
}

// Fresh test-only keys; never read workstation credentials or ambient TLS config.
export function createPoolTlsMaterial(): PoolTlsMaterial {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-pool-tls-'));
  const passphrase = 'synthetic-pool-pfx-passphrase';
  const openssl = (args: string[]) => execFileSync('openssl', args, {
    timeout: 10000, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OPENSSL_CONF: '/dev/null' },
  });
  const create = (name: string): TlsIdentity => {
    const keyPath = join(directory, `${name}.key`);
    const certPath = join(directory, `${name}.crt`);
    const pfxPath = join(directory, `${name}.p12`);
    openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', `/CN=${name}`,
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'extendedKeyUsage=serverAuth,clientAuth']);
    openssl(['pkcs12', '-export', '-inkey', keyPath, '-in', certPath,
      '-out', pfxPath, '-passout', `pass:${passphrase}`]);
    return { cert: readFileSync(certPath), key: readFileSync(keyPath), pfx: readFileSync(pfxPath) };
  };
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    return { server: create('pool-server'), first: create('client-first'),
      second: create('client-second'), passphrase, dispose };
  } catch (error) {
    try { dispose(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'TLS fixture creation and cleanup failed');
    }
    throw error;
  }
}
