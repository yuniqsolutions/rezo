/**
 * Regression test for GitHub issue #1
 * https://github.com/yuniqsolutions/rezo/issues/1
 *
 * Host-only cookies (Set-Cookie with no Domain= attribute) must not
 * leak to subdomains. Earlier versions of Rezo round-tripped accepted
 * cookies through `Cookie.toSetCookieString()` in every adapter, which
 * unconditionally emitted `Domain=<host>` and promoted host-only cookies
 * to domain cookies — making them visible to sub.host.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Cookie, RezoCookieJar } from '../src';
import { RezoFileCookieStore } from '../src/cookies/file-store';

const ORIGIN = 'https://example.com';
const ORIGIN_PATH = 'https://example.com/api';
const SUBDOMAIN = 'https://sub.example.com/api';

describe('Host-only cookies (regression: issue #1)', () => {
  it('toSetCookieString() omits Domain= when the cookie is host-only', () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    const cookie = jar.cookies().array[0];
    expect(cookie).toBeDefined();
    expect(cookie.hostOnly).toBe(true);

    const serialized = cookie.toSetCookieString();
    expect(serialized).not.toMatch(/;\s*Domain=/i);
  });

  it('toSetCookieString() still includes Domain= when the cookie is a real domain cookie', () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(
      ['tracker=xyz; Domain=example.com; Path=/; Secure'],
      ORIGIN
    );

    const cookie = jar.cookies().array[0];
    expect(cookie).toBeDefined();
    expect(cookie.hostOnly).toBe(false);

    const serialized = cookie.toSetCookieString();
    expect(serialized).toMatch(/;\s*Domain=example\.com/i);
  });

  it('host-only cookie survives a parse → toSetCookieString → re-parse round trip', () => {
    const first = new RezoCookieJar();
    first.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    const second = new RezoCookieJar();
    second.setCookiesSync(
      first.cookies().array.map(c => c.toSetCookieString()),
      ORIGIN
    );

    const cookie = second.cookies().array[0];
    expect(cookie).toBeDefined();
    expect(cookie.hostOnly).toBe(true);
  });

  it('host-only cookie is returned for the originating host', () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    const header = jar.getCookieHeader(ORIGIN_PATH);
    expect(header).toContain('session=abc');
  });

  it('host-only cookie does NOT leak to a subdomain', () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    const header = jar.getCookieHeader(SUBDOMAIN);
    expect(header).not.toContain('session=abc');
  });

  it('host-only cookie does NOT leak to a subdomain after a round trip', () => {
    const first = new RezoCookieJar();
    first.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    // Simulate the adapter path: re-serialize accepted cookies via
    // toSetCookieString() and feed them into the persistent jar.
    const persistent = new RezoCookieJar();
    persistent.setCookiesSync(
      first.cookies().array.map(c => c.toSetCookieString()),
      ORIGIN
    );

    expect(persistent.getCookieHeader(ORIGIN_PATH)).toContain('session=abc');
    expect(persistent.getCookieHeader(SUBDOMAIN)).not.toContain('session=abc');
  });

  it('Cookie constructed with hostOnly=true serializes without Domain=', () => {
    const cookie = new Cookie({
      key: 'session',
      value: 'abc',
      domain: 'example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: true,
    });

    expect(cookie.toSetCookieString()).not.toMatch(/;\s*Domain=/i);
  });
});

describe('Host-only cookies — Netscape round-trip (regression: issue #1)', () => {
  it('toNetscapeFormat → netscapeCookiesToSetCookieArray preserves host-only', () => {
    const first = new RezoCookieJar();
    first.setCookiesSync(['session=abc; Path=/; Secure; HttpOnly'], ORIGIN);

    const netscapeText = first.cookies().array
      .map(c => c.toNetscapeFormat())
      .join('\n');

    // Round-trip back to Set-Cookie strings
    const setCookieStrings = RezoCookieJar.netscapeCookiesToSetCookieArray(
      '# Netscape HTTP Cookie File\n' + netscapeText + '\n'
    );

    expect(setCookieStrings.length).toBe(1);
    expect(setCookieStrings[0]).not.toMatch(/;\s*Domain=/i);
    expect(setCookieStrings[0]).toContain('session=abc');

    // Load back into a fresh jar and verify scoping
    const reloaded = new RezoCookieJar();
    reloaded.setCookiesSync(setCookieStrings, ORIGIN);

    expect(reloaded.cookies().array[0].hostOnly).toBe(true);
    expect(reloaded.getCookieHeader(ORIGIN_PATH)).toContain('session=abc');
    expect(reloaded.getCookieHeader(SUBDOMAIN)).not.toContain('session=abc');
  });

  it('toNetscapeFormat → netscapeCookiesToSetCookieArray preserves real domain cookies', () => {
    const first = new RezoCookieJar();
    first.setCookiesSync(
      ['tracker=xyz; Domain=example.com; Path=/; Secure'],
      ORIGIN
    );

    const netscapeText = first.cookies().array
      .map(c => c.toNetscapeFormat())
      .join('\n');

    const setCookieStrings = RezoCookieJar.netscapeCookiesToSetCookieArray(
      '# Netscape HTTP Cookie File\n' + netscapeText + '\n'
    );

    expect(setCookieStrings.length).toBe(1);
    // A real domain cookie SHOULD still emit Domain= so subdomain match works
    expect(setCookieStrings[0]).toMatch(/;\s*Domain=example\.com/i);

    const reloaded = new RezoCookieJar();
    reloaded.setCookiesSync(setCookieStrings, ORIGIN);

    expect(reloaded.cookies().array[0].hostOnly).toBe(false);
    expect(reloaded.getCookieHeader(ORIGIN_PATH)).toContain('tracker=xyz');
    expect(reloaded.getCookieHeader(SUBDOMAIN)).toContain('tracker=xyz');
  });
});

describe('Host-only cookies — RezoFileCookieStore round-trip (regression: issue #1)', () => {
  it('host-only cookie persisted to a Netscape file is reloaded as host-only', () => {
    const tmpFile = path.join(
      os.tmpdir(),
      `rezo-hostonly-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );

    // Hand-craft a Netscape file: no leading dot on the domain → host-only.
    const content =
      '# Netscape HTTP Cookie File\n' +
      'example.com\tTRUE\t/\tTRUE\t0\tsession\tabc\n';
    fs.writeFileSync(tmpFile, content);

    try {
      const store = new RezoFileCookieStore({ filePath: tmpFile });
      const jar = new RezoCookieJar(store);

      expect(jar.getCookieHeader(ORIGIN_PATH)).toContain('session=abc');
      expect(jar.getCookieHeader(SUBDOMAIN)).not.toContain('session=abc');

      store.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('domain cookie persisted to a Netscape file (leading dot) reloads as a domain cookie', () => {
    const tmpFile = path.join(
      os.tmpdir(),
      `rezo-domain-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );

    // Leading dot on the domain → domain cookie (subdomain match).
    const content =
      '# Netscape HTTP Cookie File\n' +
      '.example.com\tTRUE\t/\tTRUE\t0\ttracker\txyz\n';
    fs.writeFileSync(tmpFile, content);

    try {
      const store = new RezoFileCookieStore({ filePath: tmpFile });
      const jar = new RezoCookieJar(store);

      expect(jar.getCookieHeader(ORIGIN_PATH)).toContain('tracker=xyz');
      expect(jar.getCookieHeader(SUBDOMAIN)).toContain('tracker=xyz');

      store.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});

