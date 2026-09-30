/**
 * PP — proxy scheme classification (the SPC finding's root cause).
 *
 * `parseProxyString` tested `startsWith('http')` before `'https'`, so every `https://` proxy — a TLS-fronted CONNECT proxy
 * per the documented table — was classified `http` and both HTTP adapters (and the proxy manager's rotation lists) spoke
 * plaintext to it (`ERR_SSL_HTTPS_PROXY_REQUEST`). These rows pin the parser; the SPC carrier proves the tunnel end to end.
 */

import { expect, it } from 'vitest';

import { parseProxyString } from '../src/proxy/parse';

it('PP-01 an https:// proxy string is classified https, with host, port and credentials intact', () => {
  expect(parseProxyString('https://127.0.0.1:8443')).toEqual({ protocol: 'https', host: '127.0.0.1', port: 8443 });
  expect(parseProxyString('https://user:pw@proxy.example:8443')).toEqual({ protocol: 'https', host: 'proxy.example', port: 8443, auth: { username: 'user', password: 'pw' } });
  expect(parseProxyString('HTTPS://proxy.example:8443')?.protocol).toBe('https');
});

it('PP-02 control: http://, socks4:// and socks5:// keep their classification', () => {
  expect(parseProxyString('http://127.0.0.1:8080')?.protocol).toBe('http');
  expect(parseProxyString('socks4://127.0.0.1:1080')?.protocol).toBe('socks4');
  expect(parseProxyString('socks5://127.0.0.1:1080')?.protocol).toBe('socks5');
});

it('PP-03 fact: a scheme-less host:port is classified socks5 (recorded, not asserted as a contract)', () => {
  expect(['socks5', 'http']).toContain(parseProxyString('127.0.0.1:3128')?.protocol);
});
