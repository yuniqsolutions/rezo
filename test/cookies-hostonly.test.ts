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
import { Cookie, Rezo, RezoCookieJar } from '../src';
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

describe('__Host- cookie key normalization', () => {
  it('stores __Host- cookies under a tough-cookie-safe key and returns the public key on reads', async () => {
    const jar = new RezoCookieJar();

    const accepted = jar.setCookieSync(
      '__Host-single=abc; Domain=example.com; Path=/; Secure; HttpOnly',
      ORIGIN
    );
    const callbackCookieString = await new Promise<string | undefined>((resolve, reject) => {
      jar.getCookieString(ORIGIN_PATH, (error, cookieString) => {
        if (error) reject(error);
        else resolve(cookieString);
      });
    });
    const callbackCookies = await new Promise<Cookie[]>((resolve, reject) => {
      jar.getCookies(ORIGIN_PATH, (error, cookies) => {
        if (error) reject(error);
        else resolve(cookies as Cookie[]);
      });
    });

    expect(accepted?.key).toBe('__Host-single');
    expect((await jar.getCookies(ORIGIN_PATH))[0].key).toBe('__Host-single');
    expect(callbackCookies[0].key).toBe('__Host-single');
    expect(jar.getCookieStringSync(ORIGIN_PATH)).toBe('__Host-single=abc');
    expect(await jar.getCookieString(ORIGIN_PATH)).toBe('__Host-single=abc');
    expect(callbackCookieString).toBe('__Host-single=abc');
    expect(jar.getSetCookieStringsSync(ORIGIN_PATH)[0]).toContain('__Host-single=abc');
    expect((await jar.getSetCookieStrings(ORIGIN_PATH))?.[0]).toContain('__Host-single=abc');
    expect(jar.getCookieHeader(ORIGIN_PATH)).toBe('__Host-single=abc');
    expect(jar.cookies().array[0].key).toBe('__Host-single');
    expect(jar.cookies().serialized[0].key).toBe('__Host-single');
    expect(jar.cookies().setCookiesString[0]).toContain('__Host-single=abc');
    expect(jar.serializeSync()?.cookies?.[0]?.key).toBe('__Host-single');
    expect((await jar.serialize())?.cookies?.[0]?.key).toBe('__Host-single');
    expect(jar.toJSON()?.cookies?.[0]?.key).toBe('__Host-single');
  });

  it('normalizes __Host- cookies through async setCookie too', async () => {
    const jar = new RezoCookieJar();

    const accepted = await jar.setCookie(
      '__Host-async=abc; Domain=example.com; Path=/; Secure; HttpOnly',
      ORIGIN
    );

    expect(accepted?.key).toBe('__Host-async');
    expect(await jar.getCookieString(ORIGIN_PATH)).toBe('__Host-async=abc');
  });

  it('returns the public __Host- key after restoring a stored Rezo_prx_Host- key', () => {
    const jar = new RezoCookieJar();

    jar.setCookiesSync([{
      key: 'Rezo_prx_Host-loaded',
      value: 'abc',
      domain: 'example.com',
      path: '/',
      secure: true,
      httpOnly: true,
    }], ORIGIN);

    expect(jar.getCookieStringSync(ORIGIN_PATH)).toBe('__Host-loaded=abc');
    expect(jar.cookies().serialized[0].key).toBe('__Host-loaded');
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

describe('Cookie dump → save → load round-trip (real-world session restore)', () => {
  // Mirrors the user-reported flow:
  //   1) Authenticate against https://api.domain.com — host-only session cookie set
  //   2) Dump cookies (e.g. to a .txt file) via rezo.getCookies().netscape
  //   3) Later, load them back into a fresh Rezo instance via rezo.setCookies(content)
  //   4) Subsequent requests to api.domain.com must include the session cookie
  //
  // Earlier versions silently dropped every cookie on reload because the
  // Netscape format detector (`/^\S+\t/` at position 0) tripped on the
  // "# Netscape HTTP Cookie File" header line that toNetscape itself emits.
  const API = 'https://api.domain.com';
  const ME = 'https://api.domain.com/me';
  const OTHER_SUB = 'https://other.domain.com/me';

  it('Netscape dump → rezo.setCookies(dumpedString) restores a host-only session cookie', () => {
    const session = new Rezo();
    session.cookieJar.setCookiesSync(
      ['session=abc; Path=/; Secure; HttpOnly'],
      API
    );
    expect(session.cookieJar.getCookieHeader(ME)).toContain('session=abc');

    const dumped = session.getCookies().netscape;
    expect(dumped).toContain('# Netscape HTTP Cookie File');
    expect(dumped).toMatch(/api\.domain\.com\t/);

    const restored = new Rezo();
    restored.setCookies(dumped);

    expect(restored.getCookies().array.length).toBe(1);
    expect(restored.getCookies().array[0].hostOnly).toBe(true);
    expect(restored.cookieJar.getCookieHeader(ME)).toContain('session=abc');
    // No leak to a sibling subdomain of the parent
    expect(restored.cookieJar.getCookieHeader(OTHER_SUB)).toBe('');
  });

  it('Serialized JSON dump → rezo.setCookies(parsed) restores a host-only session cookie', () => {
    const session = new Rezo();
    session.cookieJar.setCookiesSync(
      ['session=abc; Path=/; Secure; HttpOnly'],
      API
    );

    const json = JSON.stringify(session.getCookies().serialized);
    const restored = new Rezo();
    restored.setCookies(JSON.parse(json));

    expect(restored.getCookies().array.length).toBe(1);
    expect(restored.getCookies().array[0].hostOnly).toBe(true);
    expect(restored.cookieJar.getCookieHeader(ME)).toContain('session=abc');
    expect(restored.cookieJar.getCookieHeader(OTHER_SUB)).toBe('');
  });
});
