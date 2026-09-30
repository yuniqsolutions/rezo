import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { RezoError } from '../src/errors/rezo-error';
import { debugErrorDump } from '../src/utils/debug-error-dump';
import * as toolExports from '../src/utils/tools';

type DiagnosticSanitizer = (value: unknown) => string;
type RezoConfigArgument = ConstructorParameters<typeof RezoError>[1];
type RezoRequestArgument = ConstructorParameters<typeof RezoError>[3];
type RezoResponseArgument = ConstructorParameters<typeof RezoError>[4];

const sanitizeDiagnosticUrl = (
  toolExports as unknown as { sanitizeDiagnosticUrl?: DiagnosticSanitizer }
).sanitizeDiagnosticUrl;
const sanitizeDiagnosticText = (
  toolExports as unknown as { sanitizeDiagnosticText?: DiagnosticSanitizer }
).sanitizeDiagnosticText;

const MARKERS = {
  user: 'DIAG_USER_91A7',
  password: 'DIAG_PASSWORD_82B6',
  query: 'DIAG_QUERY_73C5',
  fragment: 'DIAG_FRAGMENT_64D4',
  authorization: 'DIAG_AUTH_55E3',
  proxyAuthorization: 'DIAG_PROXY_AUTH_46F2',
  cookie: 'DIAG_COOKIE_37A1',
  folded: 'DIAG_FOLDED_28B0',
  cause: 'DIAG_CAUSE_19C9',
  attempt: 'DIAG_ATTEMPT_0AD8',
  coercion: 'DIAG_COERCION_FFE1',
} as const;

const SAFE = 'PUBLIC_DIAGNOSTIC_CONTROL';
const SECRET_VALUES = Object.values(MARKERS);

function requireUrlSanitizer(): DiagnosticSanitizer {
  expect(sanitizeDiagnosticUrl, 'internal URL sanitizer export').toBeTypeOf('function');
  return sanitizeDiagnosticUrl as DiagnosticSanitizer;
}

function requireTextSanitizer(): DiagnosticSanitizer {
  expect(sanitizeDiagnosticText, 'internal text sanitizer export').toBeTypeOf('function');
  return sanitizeDiagnosticText as DiagnosticSanitizer;
}

function serialized(value: unknown): string {
  if (typeof value === 'string') return value;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function expectNoSecrets(value: unknown, markers: readonly string[] = SECRET_VALUES): void {
  const output = serialized(value);
  for (const marker of markers) expect(output, `leaked ${marker}`).not.toContain(marker);
}

function makeUrl(path: string, queryMarker = MARKERS.query): string {
  return `https://${MARKERS.user}:${MARKERS.password}@example.test/${path}` +
    `?token=${queryMarker}&safe=${SAFE}#access_token=${MARKERS.fragment}&view=summary`;
}

function makeErrorFixture() {
  const sourceUrl = makeUrl('source');
  const redirectUrl = makeUrl('redirect', `${MARKERS.query}-redirect`);
  const finalUrl = makeUrl('final', `${MARKERS.query}-final`);
  const config = {
    debug: true,
    trackUrl: true,
    method: 'get',
    url: sourceUrl,
    fullUrl: sourceUrl,
    finalUrl,
    redirectCount: 2,
    redirectHistory: [{ url: redirectUrl }, { url: finalUrl }],
    headers: {
      Authorization: `Bearer ${MARKERS.authorization}`,
      'Proxy-Authorization': `Basic ${MARKERS.proxyAuthorization}`,
      Cookie: `session=${MARKERS.cookie}`,
    },
    errors: [{
      attempt: 1,
      error: {
        code: 'ECONNRESET',
        message: `${SAFE}; Authorization: Bearer ${MARKERS.attempt}; URL: ${redirectUrl}`,
      },
    }],
  };
  const request = { method: 'GET', url: sourceUrl, marker: MARKERS.authorization };
  const response = {
    status: 401,
    statusText: 'Unauthorized',
    data: { safe: SAFE },
    headers: new Headers({ 'content-type': 'application/json' }),
    finalUrl,
    urls: [sourceUrl, redirectUrl, finalUrl],
  };
  const cause = new Error(
    `${SAFE}; Authorization: Bearer ${MARKERS.cause}; URL: ${redirectUrl}`,
  );
  const error = RezoError.createHttpError(
    401,
    config as unknown as RezoConfigArgument,
    request as unknown as RezoRequestArgument,
    response as unknown as RezoResponseArgument,
  );
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  error.stack = `${error.name}: ${error.message}\r\n` +
    `Authorization: Bearer ${MARKERS.authorization}\r\n    at caller (/safe.ts:1:1)`;

  return { error, config, request, response, cause, sourceUrl, finalUrl };
}

function captureDebug(config: object, error: unknown): string {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    debugErrorDump(config as RezoConfigArgument, error);
    return logSpy.mock.calls.flat().map(String).join('\n');
  } finally {
    logSpy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('Phase 1a diagnostic sanitizer primitives', () => {
  it('exports the internal URL sanitizer', () => {
    expect(sanitizeDiagnosticUrl).toBeTypeOf('function');
  });

  it('exports the internal text sanitizer', () => {
    expect(sanitizeDiagnosticText).toBeTypeOf('function');
  });

  it('redacts URL userinfo and duplicate signed query/fragment values while preserving safe structure', () => {
    const output = requireUrlSanitizer()(
      `https://${MARKERS.user}:${MARKERS.password}@example.test/one` +
      `?token=${MARKERS.query}&safe=${SAFE}&token=${MARKERS.query}-duplicate` +
      `&monkey=${SAFE}#access_token=${MARKERS.fragment}`,
    );

    expectNoSecrets(output);
    expect(output).toContain('https://example.test/one');
    expect(output).toContain(`safe=${SAFE}`);
    expect(output).toContain(`monkey=${SAFE}`);
    expect(output.match(/[?&#]token=/g)).toHaveLength(2);
    expect(output).toContain('[REDACTED]');
  });

  it('preserves two adjacent comma-separated URLs while sanitizing both', () => {
    const first = makeUrl('first');
    const second = `https://${MARKERS.user}:${MARKERS.password}@two.example/second` +
      `?token=${MARKERS.authorization}&safe=${SAFE}`;
    const output = requireTextSanitizer()(`failed (${first}),${second}.`);

    expectNoSecrets(output);
    expect(output).toContain('https://example.test/first');
    expect(output).toContain('https://two.example/second');
    expect(output).toContain('),');
  });

  it('redacts route-style fragments and authenticity tokens', () => {
    const output = requireUrlSanitizer()(
      `https://example.test/callback?authenticity_token=${MARKERS.authorization}` +
      `#route?refresh_token=${MARKERS.fragment}&state=${SAFE}`,
    );

    expectNoSecrets(output);
    expect(output).toContain(`state=${SAFE}`);
    expect(output).toContain('#route?refresh_token=[REDACTED]');
  });

  it('redacts encoded and malformed credential parameter names without hiding safe controls', () => {
    const output = requireUrlSanitizer()(
      `https://example.test/callback?%74oken=${MARKERS.query}` +
      `&%61pi_key=${MARKERS.authorization}&%ZZ=${MARKERS.fragment}&safe=${SAFE}`,
    );

    expectNoSecrets(output);
    expect(output).toContain('%74oken=[REDACTED]');
    expect(output).toContain('%61pi_key=[REDACTED]');
    expect(output).toContain('%ZZ=[REDACTED]');
    expect(output).toContain(`safe=${SAFE}`);
  });

  it('redacts standard OAuth and camelCase credential parameter aliases', () => {
    const output = requireUrlSanitizer()(
      'https://example.test/callback?accessToken=' + MARKERS.query +
      '&refreshToken=' + MARKERS.fragment + '&idToken=' + MARKERS.authorization +
      '&oauth_token=' + MARKERS.cookie + '&oauth_signature=' + MARKERS.folded +
      '&safe=' + SAFE,
    );

    expectNoSecrets(output);
    expect(output).toContain('accessToken=[REDACTED]');
    expect(output).toContain('oauth_signature=[REDACTED]');
    expect(output).toContain('safe=' + SAFE);
  });

  it('redacts OAuth client assertions in direct URLs and embedded diagnostic text', () => {
    const input = 'https://client.example/token?client_assertion=' +
      MARKERS.authorization + '&safe=' + SAFE;
    const outputs = [
      requireUrlSanitizer()(input),
      requireTextSanitizer()('token exchange failed at ' + input),
    ];

    expectNoSecrets(outputs, [MARKERS.authorization]);
    for (const output of outputs) {
      expect(output).toContain('client_assertion=[REDACTED]');
      expect(output).toContain('safe=' + SAFE);
    }
  });

  it.each([
    ['leading query-name space', '? token=', MARKERS.query],
    ['trailing query-name space', '?token =', MARKERS.fragment],
    ['surrounding query-name spaces', '? TOKEN =', MARKERS.authorization],
    ['space before the query value', '?token= ', MARKERS.cookie],
    ['surrounding fragment-name spaces', '# oauth_signature =', MARKERS.folded],
  ])(
    'redacts an embedded sensitive assignment with %s',
    (_name, parameterPrefix, secret) => {
      const sanitize = requireTextSanitizer();
      const input = 'before https://space.example/path' + parameterPrefix +
        secret + ' after';
      const once = sanitize(input);

      expectNoSecrets(once, [secret]);
      expect(once).toContain('before https://space.example/path');
      expect(once).toContain('[REDACTED] after');
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([
    ['leading query-name space', '? token='],
    ['trailing query-name space', '?token ='],
    ['surrounding fragment-name spaces', '# oauth_signature ='],
  ])(
    'redacts an attached embedded URL with %s',
    (_name, parameterPrefix) => {
      const secret = 'ATTACHED_PADDED_SECRET_9D3';
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'prefixXhttps://space.example/path' + parameterPrefix + secret,
      );

      expectNoSecrets(once, [secret]);
      expect(once).toContain('[REDACTED]');
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([
    'prefixXhttps://user:password@space.example/path? token=' + MARKERS.query,
    'prefixXhttps://space.example/path?%20token%20=' + MARKERS.query,
  ])('retains the attached padded-parameter safety control: %s', (input) => {
    expectNoSecrets(requireTextSanitizer()(input), [MARKERS.query]);
  });

  it.each([
    ['canonical query name', '?token='],
    ['padded query name', '? token='],
  ])(
    'redacts a credentialed nested network marker with %s in an attached URL path',
    (_name, parameterPrefix) => {
      const secret = 'NESTED_PROTO_SECRET_39';
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'preXhttps://outer.test/path//inner.test/' + parameterPrefix + secret,
      );

      expectNoSecrets(once, [secret]);
      expect(once).toContain('[REDACTED]');
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([
    'before https://space.example/path? safe=' + SAFE + ' after',
    'before https://space.example/path?note=' + SAFE + ' after',
  ])('preserves benign embedded URL whitespace control: %s', (input) => {
    expect(requireTextSanitizer()(input)).toBe(input);
  });

  it('keeps padded sensitive assignments within a linear-time safety bound', () => {
    const secret = 'PADDED_PARAMETER_PERF_SECRET_Q7Z';
    const padding = ' '.repeat(16_384);
    const input = 'https://space.example/path?' + padding + 'token' + padding +
      '=' + padding + secret + ' after';
    const startedAt = performance.now();
    const output = requireTextSanitizer()(input);
    const elapsedMs = performance.now() - startedAt;

    expectNoSecrets(output, [secret]);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('keeps direct padded URL sanitization within a linear-time safety bound', () => {
    const secret = 'DIRECT_PADDED_PERF_SECRET_Q7Z';
    const padding = ' '.repeat(20_000);
    const input = 'https://space.example/path?' + padding + 'token' + padding +
      '=' + padding + secret;
    const startedAt = performance.now();
    const output = requireUrlSanitizer()(input);
    const elapsedMs = performance.now() - startedAt;

    expectNoSecrets(output, [secret]);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('handles semicolon parameters and comma-bearing secret values without broad substring matches', () => {
    const output = requireUrlSanitizer()(
      `https://example.test/?token=${MARKERS.query},suffix;safe=${SAFE}` +
      `&api_key=${MARKERS.authorization}&tokenize=${SAFE}&keynote=${SAFE}`,
    );

    expectNoSecrets(output);
    expect(output).toContain(`safe=${SAFE}`);
    expect(output).toContain(`tokenize=${SAFE}`);
    expect(output).toContain(`keynote=${SAFE}`);
  });

  it('sanitizes every embedded URL and credential header and neutralizes log injection', () => {
    const input = `${SAFE}\r\nAuthorization: AWS4-HMAC-SHA256 Credential=${MARKERS.authorization}, ` +
      `Signature=${MARKERS.folded}\r\nProxy-Authorization: Basic ${MARKERS.proxyAuthorization}` +
      `\r\nCookie: sid=${MARKERS.cookie}\r\nURL ${makeUrl('first')}, then ${makeUrl('second')}` +
      `\u2028Set-Cookie: sid=${MARKERS.cookie}\u2029tail=${SAFE}`;
    const output = requireTextSanitizer()(input);

    expectNoSecrets(output);
    expect(output).toContain(SAFE);
    expect(output).not.toMatch(/[\r\n\u2028\u2029]/);
  });

  it('redacts folded sensitive header continuations', () => {
    const output = requireTextSanitizer()(
      `Authorization: Digest Credential=${MARKERS.authorization},\r\n` +
      `  Signature=${MARKERS.folded}\r\nX-Safe: ${SAFE}`,
    );

    expectNoSecrets(output);
    expect(output).toContain(`X-Safe: ${SAFE}`);
  });

  it('redacts credential headers whose names are split by diagnostic controls', () => {
    const headerNames = [
      'Authorization',
      'Proxy-Authorization',
      'Cookie',
      'Set-Cookie',
    ];
    const controls = ['\u0000', '\t', '\n', '\r', '\u0085', '\u2028', '\u2029'];
    const marker = 'HEADER_SPLIT_Q7Z';
    const sanitize = requireTextSanitizer();

    for (const headerName of headerNames) {
      for (let index = 1; index < headerName.length; index += 1) {
        for (const control of controls) {
          const input = headerName.slice(0, index) + control +
            headerName.slice(index) + ': Bearer ' + marker;
          const once = sanitize(input);

          expect(once, `${headerName} at ${index} via U+${control.charCodeAt(0).toString(16)}`)
            .not.toContain(marker);
          expect(once).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
          expect(sanitize(once)).toBe(once);
        }
      }
    }
  });

  it.each([
    ['Authorization CRLF before colon', 'Authorization\r\n: Bearer ' + MARKERS.authorization],
    ['Cookie line separator before colon', 'Cookie\u2028: sid=' + MARKERS.cookie],
  ])('redacts a credential header with %s', (_name, input) => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(input);

    expectNoSecrets(once);
    expect(once).toContain('[REDACTED]');
    expect(once).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(sanitize(once)).toBe(once);
  });

  it.each([
    ['Basic', 'aUtHoRiZaTiOn', `Basic ${MARKERS.authorization}`],
    ['Bearer', 'Authorization', `Bearer ${MARKERS.authorization}`],
    ['Digest', 'AUTHORIZATION', `Digest username="safe", response="${MARKERS.authorization}"`],
    ['AWS', 'Authorization', `AWS4-HMAC-SHA256 Credential=${MARKERS.authorization}, Signature=${MARKERS.folded}`],
    ['proxy', 'pRoXy-AuThOrIzAtIoN', `Basic ${MARKERS.proxyAuthorization}`],
    ['cookie', 'COOKIE', `sid=${MARKERS.cookie}; theme=safe`],
    ['set-cookie', 'sEt-CoOkIe', `sid=${MARKERS.cookie}; HttpOnly`],
  ])('redacts the complete %s credential header value case-insensitively', (_scheme, name, value) => {
    const output = requireTextSanitizer()(`${name}: ${value}`);

    expect(output).toBe(`${name}: [REDACTED]`);
    expectNoSecrets(output);
  });

  it('does not redact benign substrings that are not credential names', () => {
    const input = 'AuthorizationStatus ready; CookiePolicy strict; Set-Cookie-Jar enabled; ' +
      'Proxy-Authorization-Mode none; tokenize=keep; signature_version=v4; password_policy=strict';

    expect(requireTextSanitizer()(input)).toBe(input);
  });

  it('redacts every credential header when multiple headers share one line', () => {
    const output = requireTextSanitizer()(
      'Authorization: Bearer ' + MARKERS.authorization + ' ' +
      'Cookie: sid=' + MARKERS.cookie + '; Proxy-Authorization: Basic ' +
      MARKERS.proxyAuthorization + ' X-Safe: ' + SAFE,
    );

    expectNoSecrets(output);
    expect(output).toContain('X-Safe: ' + SAFE);
  });

  it('sanitizes punctuation-adjacent and repeated protocol-relative URLs in prose', () => {
    const output = requireTextSanitizer()(
      'first,//' + MARKERS.user + ':' + MARKERS.password +
      '@one.example/path?token=' + MARKERS.query + '),//' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?oauth_signature=' + MARKERS.authorization,
    );

    expectNoSecrets(output);
    expect(output).toContain('//one.example/path?token=[REDACTED]');
    expect(output).toContain('//two.example/path?oauth_signature=[REDACTED]');
  });

  it('preserves a comma between adjacent URLs that both end in sensitive values', () => {
    const output = requireTextSanitizer()(
      'https://' + MARKERS.user + ':' + MARKERS.password +
      '@one.example/path?token=' + MARKERS.query + ',https://' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(output);
    expect(output).toBe(
      'https://one.example/path?token=[REDACTED],' +
      'https://two.example/path?token=[REDACTED]',
    );
    expect(requireTextSanitizer()(output)).toBe(output);
  });

  it.each([
    ['|', true],
    ['—', true],
    ['=', false],
    [';', true],
    ['?', false],
    ['#', true],
    ['(', true],
  ])(
    'sanitizes every repeated protocol-relative URL across the %s prose separator',
    (separator, preservesSecondUrl) => {
      const sanitize = requireTextSanitizer();
      const output = sanitize(
        '//' + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path?oauth_signature=' + MARKERS.query + separator + '//' +
        MARKERS.user + ':' + MARKERS.password +
        '@two.example/path?oauth_signature=' + MARKERS.authorization,
      );

      expectNoSecrets(output);
      expect(output).toContain('//one.example/path?oauth_signature=[REDACTED]');
      if (preservesSecondUrl) {
        expect(output).toContain('//two.example/path?oauth_signature=[REDACTED]');
      }
      expect(sanitize(output)).toBe(output);
    },
  );

  it.each(['|', '—', '=', ';', '?', '#', '('])(
    'sanitizes every repeated absolute URL across the %s prose separator',
    (separator) => {
      const output = requireTextSanitizer()(
        'https://' + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path' + separator + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@two.example/path?oauth_signature=' + MARKERS.authorization,
      );

      expectNoSecrets(output);
      expect(output).toContain('https://one.example/path');
      expect(output).toContain('https://two.example/path?oauth_signature=[REDACTED]');
    },
  );

  it('keeps punctuation-heavy embedded-URL scanning within a linear-time safety bound', () => {
    const input = '//' + MARKERS.user + ':' + MARKERS.password +
      '@one.example/path' + '!'.repeat(32_768);
    const startedAt = performance.now();
    const output = requireTextSanitizer()(input);
    const elapsedMs = performance.now() - startedAt;

    expectNoSecrets(output);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('keeps many safe punctuation-separated URL starts within a linear-time safety bound', () => {
    const input = '//safe.example/path?value=public|'.repeat(2_048);
    const startedAt = performance.now();
    const output = requireTextSanitizer()(input);
    const elapsedMs = performance.now() - startedAt;

    expect(output).toBe(input);
    expect(elapsedMs).toBeLessThan(500);
  });

  it.each([
    ['Unicode', '秘密'],
    ['bang punctuation', '!!!'],
    ['closing punctuation', '))]'],
    ['asterisk punctuation', '***'],
  ])('fully redacts a %s-only sensitive value at URL and inter-URL boundaries', (_name, secret) => {
    const sanitize = requireTextSanitizer();
    const outputs = [
      sanitize('https://one.example/path?token=' + secret),
      sanitize(
        'https://one.example/path?token=' + secret + '|https://two.example/safe',
      ),
      sanitize(
        '//one.example/path?oauth_signature=' + secret + '|//two.example/safe',
      ),
    ];

    for (const output of outputs) {
      expect(output).not.toContain(secret);
      expect(output).toContain('[REDACTED]');
      expect(sanitize(output)).toBe(output);
    }
  });

  it.each([
    ['punctuation-only query token', '?token=', '!$%'],
    ['marker-plus-punctuation query password', '?password=', MARKERS.query + '!$%'],
    ['punctuation-only encoded fragment token', '#%74oken=', '()}'],
    ['marker-plus-punctuation malformed fragment name', '#%ZZ=', MARKERS.fragment + '||'],
  ])(
    'does not trust a literal redaction sentinel after a raw %s value',
    (_name, parameterPrefix, secret) => {
      const sanitize = requireTextSanitizer();
      const input = 'https://one.example/path' + parameterPrefix + secret + '[REDACTED]';
      const once = sanitize(input);

      expect(once).toBe(
        'https://one.example/path' + parameterPrefix + '[REDACTED]',
      );
      expect(once).not.toContain(secret);
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([
    ['safe query value', 'https://one.example/path?safe=' + SAFE + '!$%[REDACTED]'],
    ['safe path', 'https://one.example/path-' + SAFE + '!$%[REDACTED]'],
  ])('preserves a literal redaction sentinel in a %s control', (_name, input) => {
    const sanitize = requireTextSanitizer();

    expect(sanitize(input)).toBe(input);
    expect(sanitize(sanitize(input))).toBe(input);
  });

  it.each([
    ['query', '?token=', MARKERS.query, '!'],
    ['fragment', '#oauth_signature=', MARKERS.fragment, ')'],
  ])(
    'does not reattach detached %s punctuation after a sensitive literal sentinel',
    (_name, parameterPrefix, secret, punctuation) => {
      const sanitize = requireTextSanitizer();
      const input = 'https://one.example/path' + parameterPrefix + secret +
        '[REDACTED]' + punctuation;
      const once = sanitize(input);

      expect(once).toBe(
        'https://one.example/path' + parameterPrefix + '[REDACTED]',
      );
      expect(once).not.toContain(secret);
      expect(sanitize(once)).toBe(once);
    },
  );

  it('does not trust an attacker-mimicked sentinel and separator boundary', () => {
    const sanitize = requireTextSanitizer();
    const input = 'https://one.example/path?token=[REDACTED], [REDACTED]';
    const once = sanitize(input);

    expect(once).toBe(
      'https://one.example/path?token=[REDACTED] [REDACTED]',
    );
    expect(sanitize(once)).toBe(once);
  });

  it('redacts an entire sensitive value containing nested URLs or question marks', () => {
    const nested = 'https://outer.example/path?token=https://' +
      MARKERS.user + ':' + MARKERS.password +
      '@nested.example/path?safe=' + SAFE;
    const questionMark = 'https://outer.example/path?token=' +
      MARKERS.query + '?tail=' + SAFE;
    const outputs = [
      requireUrlSanitizer()(nested),
      requireTextSanitizer()(nested),
      requireUrlSanitizer()(questionMark),
      requireTextSanitizer()(questionMark),
    ];

    for (const output of outputs) {
      expectNoSecrets(output);
      expect(output).toBe('https://outer.example/path?token=[REDACTED]');
    }
  });

  it('keeps nested sensitive-value URL suppression within a linear-time safety bound', () => {
    const input = 'https://outer.example/path?token=' +
      'https://inner.example/'.repeat(3_200) + 'tail';
    const startedAt = performance.now();
    const output = requireTextSanitizer()(input);
    const elapsedMs = performance.now() - startedAt;

    expect(output).toBe('https://outer.example/path?token=[REDACTED]');
    expect(elapsedMs).toBeLessThan(500);
  });

  it('sanitizes credentialed protocol-relative URLs nested after path characters', () => {
    const output = requireTextSanitizer()(
      'https://one.example/a//' + MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?token=' + MARKERS.query +
      ' https://one.example/a///' + MARKERS.user + ':' + MARKERS.password +
      '@three.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(output);
    expect(output).toContain('https://one.example/a//two.example/path?token=[REDACTED]');
    expect(output).toContain('https://one.example/a///three.example/path?token=[REDACTED]');
  });

  it('leaves a safe double-slash path unchanged', () => {
    const input = 'https://one.example/a//two.example/path?safe=' + SAFE;
    expect(requireTextSanitizer()(input)).toBe(input);
  });

  it('preserves punctuation after an existing redaction sentinel between URLs', () => {
    const sanitize = requireTextSanitizer();
    const input = '//one.example/path?oauth_signature=[REDACTED]),//' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?oauth_signature=' + MARKERS.authorization;
    const output = sanitize(input);

    expectNoSecrets(output);
    expect(output).toContain('[REDACTED]),//two.example/path?oauth_signature=[REDACTED]');
    expect(sanitize(output)).toBe(output);
  });

  it.each([
    ['NUL', '\u0000'],
    ['SOH', '\u0001'],
    ['BS', '\u0008'],
    ['VT', '\u000b'],
    ['US', '\u001f'],
    ['DEL', '\u007f'],
    ['C1 start', '\u0080'],
    ['NEL', '\u0085'],
    ['C1 end', '\u009f'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
  ])(
    'fails closed across the %s URL-token control boundary',
    (_name, control) => {
      const output = requireTextSanitizer()(
        '//' + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path?token=' + MARKERS.query + control + 'tail=' + SAFE,
      );

      expectNoSecrets(output);
      expect(output).toBe('[REDACTED]');
      expect(output).not.toContain(control);
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it('sanitizes mixed-case absolute URLs nested after URL punctuation', () => {
    const output = requireTextSanitizer()(
      'https://outer.example/a/HTTPS://' + MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?safe=' + SAFE + '=FTP://' +
      MARKERS.user + ':' + MARKERS.password +
      '@three.example/path?oauth_signature=' + MARKERS.authorization,
    );

    expectNoSecrets(output);
    expect(output).toContain('https://two.example/path?safe=' + SAFE + '=');
    expect(output).toContain('ftp://three.example/path?oauth_signature=[REDACTED]');
  });

  it('redacts a credentialed URL marker attached after an ordinary byte', () => {
    const input = 'https://outer.example/path?next=7http:' +
      MARKERS.user + ':' + MARKERS.password +
      '@bad.example/path&safe=' + SAFE;
    const parsedInner = new URL(
      'http:' + MARKERS.user + ':' + MARKERS.password + '@bad.example/path',
    );
    const outputs = [
      requireUrlSanitizer()(input),
      requireTextSanitizer()(input),
    ];

    expect(parsedInner.username).toBe(MARKERS.user);
    expect(parsedInner.password).toBe(MARKERS.password);
    expectNoSecrets(outputs, [MARKERS.user, MARKERS.password]);
    for (const output of outputs) {
      expect(output).toContain('outer.example/path');
      expect(output).toContain('safe=' + SAFE);
    }
  });

  it('redacts sensitive parameters in embedded SOCKS proxy URLs', () => {
    const proxyUrl = 'socks5://proxy.example/path?token=' +
      MARKERS.proxyAuthorization + '&safe=' + SAFE;
    const direct = requireUrlSanitizer()(proxyUrl);
    const embedded = requireTextSanitizer()('proxy failed at ' + proxyUrl);

    expectNoSecrets([direct, embedded], [MARKERS.proxyAuthorization]);
    expect(direct).toContain('token=[REDACTED]');
    expect(embedded).toContain('socks5://proxy.example/path?token=[REDACTED]');
    expect(embedded).toContain('safe=' + SAFE);
  });

  it.each([
    ['backslash authority', 'http:\\' + MARKERS.user + ':' + MARKERS.password +
      '@host.example/path?token=' + MARKERS.query, '[REDACTED]'],
    ['slashless authority', 'http:' + MARKERS.user + ':' + MARKERS.password +
      '@host.example/path?token=' + MARKERS.query,
      'http://host.example/path?token=[REDACTED]'],
    ['slashless query', 'http:host.example/path?token=' + MARKERS.query,
      'http://host.example/path?token=[REDACTED]'],
  ])('sanitizes the WHATWG %s special-scheme form in diagnostic prose', (_name, rawUrl, expected) => {
    const output = requireTextSanitizer()('URL ' + rawUrl);

    expectNoSecrets(output);
    expect(output).toContain(expected);
  });

  it('does not reinterpret a scheme label separated from ordinary prose', () => {
    const input = 'HTTP: status unavailable; safe=' + SAFE;
    expect(requireTextSanitizer()(input)).toBe(input);
  });

  it.each([
    ['NUL', '\u0000'],
    ['NEL', '\u0085'],
  ])('fails closed when %s is inserted inside a logical credentialed URL', (_name, control) => {
    const inputs = [
      '//' + control + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path?token=' + MARKERS.query,
      '//' + MARKERS.user + ':' + MARKERS.password +
        '@one.example' + control + '/path?token=' + MARKERS.query,
      '//' + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path' + control + '?token=' + MARKERS.query,
      '//' + MARKERS.user + ':' + MARKERS.password +
        '@one.example/path?' + control + 'token=' + MARKERS.query,
    ];

    for (const input of inputs) {
      const output = requireTextSanitizer()(input);
      expectNoSecrets(output);
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain(control);
      expect(requireTextSanitizer()(output)).toBe(output);
    }
  });

  it.each([
    ['TAB', '\t'],
    ['LF', '\n'],
    ['CR', '\r'],
    ['mixed TAB/LF/CR', '\t\n\r'],
  ])('fails closed for WHATWG %s folding inside schemes and network markers', (_name, control) => {
    const scheme = 'h' + control + 'ttp://host.example/path?token=' + MARKERS.query;
    const network = '/' + control + '/host.example/path?token=' + MARKERS.query;
    const colonNetwork = 'http:' + control + '//host.example/path?token=' + MARKERS.query;
    const repeatedNetwork = 'http://' + control + '//host.example/path?token=' + MARKERS.query;
    const nestedNetwork = 'http://outer.example/path/' + control + '/user:' +
      MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const nestedAbsoluteChain = 'http://outer.example/path/http://' + control +
      '//user:' + MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const nestedNetworkChain = 'http://outer.example/path//nested.example/' + control +
      '/user:' + MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const nestedAbsoluteAuthority = 'http://outer.example/path/https://' + control +
      MARKERS.user + ':' + MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const nestedNetworkAuthority = 'http://outer.example/path//' + control +
      MARKERS.user + ':' + MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const nestedAuthorityControl = 'http://outer.example/path//' + MARKERS.user + control +
      ':' + MARKERS.password + '@host.example/path?token=' + MARKERS.query;
    const outputs = [
      requireTextSanitizer()('URL=' + scheme),
      requireTextSanitizer()('URL=' + network),
      requireTextSanitizer()('URL=' + colonNetwork),
      requireTextSanitizer()('URL=' + repeatedNetwork),
      requireTextSanitizer()('URL=' + nestedNetwork),
      requireTextSanitizer()('URL=' + nestedAbsoluteChain),
      requireTextSanitizer()('URL=' + nestedNetworkChain),
      requireTextSanitizer()('URL=' + nestedAbsoluteAuthority),
      requireTextSanitizer()('URL=' + nestedNetworkAuthority),
      requireTextSanitizer()('URL=' + nestedAuthorityControl),
    ];

    for (const output of outputs) {
      expectNoSecrets(output);
      expect(output).toBe('URL=[REDACTED]');
      expect(requireTextSanitizer()(output)).toBe(output);
    }
  });

  it.each([',', '|', '—', '=', ';', '?', '#', '(', ')', ']', '}'])(
    'preserves a safe URL before the %s prose boundary when the next URL fails closed',
    (separator) => {
      const output = requireTextSanitizer()(
        'https://safe.example/path' + separator + 'h\tttp://' + MARKERS.user + ':' +
        MARKERS.password + '@host.example/path?token=' + MARKERS.query,
      );

      expectNoSecrets(output);
      expect(output).toBe('https://safe.example/path' + separator + '[REDACTED]');
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each(
    [',', '|', '—', '=', ';', '?', '#', '(', ')', ']', '}'].flatMap((separator) => [
      [separator, 'TAB', '\t'],
      [separator, 'NUL', '\u0000'],
      [separator, 'backslash', '\\'],
    ]),
  )(
    'preserves a safe URL before %s plus %s leading into a fail-closed URL',
    (separator, _controlName, control) => {
      const output = requireTextSanitizer()(
        'https://safe.example/path' + separator + control + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@host.example/path?token=' + MARKERS.query,
      );

      expectNoSecrets(output);
      expect(output).toBe('https://safe.example/path' + separator + '[REDACTED]');
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each([
    ['bare hard terminator', '\\ ', ''],
    ['label after hard terminator', '\\ URL=', 'URL='],
  ])(
    'sanitizes a credentialed URL after a backslash and %s in the same pass',
    (_name, poisonedGap, preservedLabel) => {
      const output = requireTextSanitizer()(
        'https://safe.example/path,' + poisonedGap + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.query,
      );

      expectNoSecrets(output);
      expect(output).toBe(
        'https://safe.example/path,[REDACTED] ' + preservedLabel +
        'https://bad.example/path?token=[REDACTED]',
      );
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it('does not copy a folded credentialed URL tail raw because a later URL is recognized', () => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(
      'https://one.example/path?x=1h\tttp://bad.example/path?token=' +
      MARKERS.query + ' https://safe.example/path',
    );

    expectNoSecrets(once);
    expect(once).toBe('[REDACTED] https://safe.example/path');
    expect(sanitize(once)).toBe(once);
  });

  it.each([',', '|', '—', ';', '#', '(', ')', ']', '}'])(
    'preserves the %s boundary after a fail-closed URL and before a safe URL',
    (separator) => {
      const output = requireTextSanitizer()(
        'h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.query + separator +
        'https://safe.example/path',
      );

      expectNoSecrets(output);
      expect(output).toBe('[REDACTED]' + separator + 'https://safe.example/path');
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each(
    [',', '|', '—', ';', '#', '(', ')', ']', '}'].flatMap((separator) => [
      [separator, 'TAB', '\t'],
      [separator, 'NUL', '\u0000'],
      [separator, 'backslash', '\\'],
    ]),
  )(
    'preserves a sensitive first URL before %s plus %s and a fail-closed URL',
    (separator, _controlName, control) => {
      const output = requireTextSanitizer()(
        'https://one.example/path?token=' + MARKERS.query + separator + control +
        'https://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(output);
      expect(output).toBe(
        'https://one.example/path?token=[REDACTED] ' + separator + ' [REDACTED]',
      );
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each([
    ['parenthesized', ',\t(', ', ('],
    ['labelled', ',\tURL=', ', URL='],
  ])(
    'preserves a safe first URL across %s prose between a separator and the next URL',
    (_name, prose, expectedProse) => {
      const output = requireTextSanitizer()(
        'https://safe.example/path' + prose + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.query,
      );

      expectNoSecrets(output);
      expect(output).toBe(
        'https://safe.example/path' + expectedProse +
        'https://bad.example/path?token=[REDACTED]',
      );
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each([
    ['label before assignment', ',URL\t=', ',URL ='],
    ['ordinary prose before parenthesis', ',abc\t(', ',abc ('],
    ['generic equals boundary', '=URL\t?', '=URL ?'],
    ['generic question boundary', '?URL\t=', '?URL ='],
  ])(
    'preserves a safe first URL across %s before a poisoned second URL',
    (_name, prose, expectedProse) => {
      const output = requireTextSanitizer()(
        'https://safe.example/path' + prose + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.query,
      );

      expectNoSecrets(output);
      expect(output).toBe(
        'https://safe.example/path' + expectedProse +
        'https://bad.example/path?token=[REDACTED]',
      );
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it('preserves and sanitizes a sensitive first URL across labelled poisoned prose', () => {
    const output = requireTextSanitizer()(
      'https://one.example/path?token=' + MARKERS.query + ',\tURL=https://' +
      MARKERS.user + ':' + MARKERS.password +
      '@bad.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(output);
    expect(output).toBe(
      'https://one.example/path?token=[REDACTED], URL=' +
      'https://bad.example/path?token=[REDACTED]',
    );
    expect(requireTextSanitizer()(output)).toBe(output);
  });

  it.each([',', '|', '—', ';', '#', '(', ')', ']', '}'])(
    'keeps a terminal %s boundary when the following URL fails closed',
    (separator) => {
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'https://one.example/path?token=' + MARKERS.query + separator +
        '\tURL=h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(once);
      expect(once).toBe(
        'https://one.example/path?token=[REDACTED] ' + separator +
        ' URL=[REDACTED]',
      );
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([',', '|', '—', ';', '#', '(', ')', ']', '}'])(
    'canonicalizes a sensitive sentinel value before a folded URL at %s',
    (separator) => {
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'https://one.example/path?token=' + MARKERS.query + '?x=[REDACTED]' +
        separator + 'h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(once);
      expect(once).toBe(
        'https://one.example/path?token=[REDACTED] ' + separator + ' [REDACTED]',
      );
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([',', '|', '—', ';', '#', '(', ')', ']', '}'])(
    'collapses a backslash-labelled folded URL after the %s boundary',
    (separator) => {
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'https://one.example/path?token=' + MARKERS.query + separator +
        '\\URL=h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(once);
      expect(once).not.toContain('\\');
      expect(once).toBe(
        'https://one.example/path?token=[REDACTED] ' + separator + ' [REDACTED]',
      );
      expect(sanitize(once)).toBe(once);
    },
  );

  it('composes sensitive-sentinel canonicalization with backslash-labelled collapse', () => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(
      'https://one.example/path?token=' + MARKERS.query + '?x=[REDACTED],' +
      '\\URL=h\tttp://' + MARKERS.user + ':' + MARKERS.password +
      '@bad.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(once);
    expect(once).toBe(
      'https://one.example/path?token=[REDACTED] , [REDACTED]',
    );
    expect(sanitize(once)).toBe(once);
  });

  it.each([
    ['semicolon and Unicode boundary', ',,;—', '; —'],
    ['fragment and Unicode boundary', '))#—', '# —'],
  ])(
    'canonicalizes a composed %s before a later fail-closed URL on the first pass',
    (_name, rawBoundary, expectedBoundary) => {
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'https://one.example/path?token=' + MARKERS.query + rawBoundary +
        '\tURL=h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(once);
      expect(once).toBe(
        'https://one.example/path?token=[REDACTED]' + expectedBoundary +
        ' URL=[REDACTED]',
      );
      expect(sanitize(once)).toBe(once);
    },
  );

  it.each([
    ['TAB', '\t'],
    ['NUL', '\u0000'],
    ['C1 NEL', '\u0085'],
  ])('preserves labelled prose after a %s separator control', (_name, control) => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(
      'https://safe.example/path,' + control + 'URL=https://' +
      MARKERS.user + ':' + MARKERS.password +
      '@bad.example/path?token=' + MARKERS.query,
    );

    expectNoSecrets(once);
    expect(once).toBe(
      'https://safe.example/path, URL=' +
      'https://bad.example/path?token=[REDACTED]',
    );
    expect(sanitize(once)).toBe(once);
  });

  it('does not alter an unrelated diagnostic backslash', () => {
    const input = 'local path C:\\diagnostics\\public.txt';
    expect(requireTextSanitizer()(input)).toBe(input);
  });

  it.each([
    ['comma-bearing value text', ',TAIL\t='],
    ['equals-bearing value text', '=URL\t?'],
    ['question-bearing value text', '?URL\t='],
    ['synthetic redaction sentinel', '[REDACTED]\t='],
  ])(
    'does not release sensitive %s before a nested poisoned URL',
    (_name, prose) => {
      const output = requireTextSanitizer()(
        'https://one.example/path?token=' + MARKERS.query + prose + 'https://' +
        MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(output);
      expect(output).toBe('[REDACTED]');
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it.each(['(', '|', '—', ']'])(
    'does not let a later %s boundary release an already-poisoned sensitive value',
    (separator) => {
      const output = requireTextSanitizer()(
        'https://one.example/path?token=' + MARKERS.query + ',' + MARKERS.attempt +
        '\t' + separator + 'h\tttp://' + MARKERS.user + ':' + MARKERS.password +
        '@bad.example/path?token=' + MARKERS.fragment,
      );

      expectNoSecrets(output);
      expect(output).toBe('[REDACTED]');
      expect(requireTextSanitizer()(output)).toBe(output);
    },
  );

  it('fails closed for a WHATWG backslash network URL', () => {
    const rawUrl = '\\\\' + MARKERS.user + ':' + MARKERS.password +
      '@host.example/path?token=' + MARKERS.query;
    const textOutput = requireTextSanitizer()('URL=' + rawUrl);
    const urlOutput = requireUrlSanitizer()(rawUrl);
    const nestedOutput = requireTextSanitizer()(
      'URL=http://outer.example/path\\\\' + MARKERS.user + ':' +
      MARKERS.password + '@host.example/path?token=' + MARKERS.query,
    );
    const nestedAbsoluteOutput = requireTextSanitizer()(
      'URL=http://outer.example/path/https://\\' + MARKERS.user + ':' +
      MARKERS.password + '@host.example/path?token=' + MARKERS.query,
    );

    expectNoSecrets([textOutput, urlOutput, nestedOutput, nestedAbsoluteOutput]);
    expect(textOutput).toBe('URL=[REDACTED]');
    expect(urlOutput).toBe('[REDACTED]');
    expect(nestedOutput).toBe('URL=[REDACTED]');
    expect(nestedAbsoluteOutput).toBe('URL=[REDACTED]');
  });

  it('is total under hostile coercion and never echoes the thrown message', () => {
    let coercionCalls = 0;
    const hostile = {
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        throw new Error(MARKERS.coercion);
      },
      toString() {
        coercionCalls += 1;
        throw new Error(MARKERS.coercion);
      },
    };

    const output = requireTextSanitizer()(hostile);
    expectNoSecrets(output);
    expect(coercionCalls).toBe(0);
  });

  it('bypasses hostile URL overrides without mutating the URL and is idempotent', () => {
    const hostileUrl = new URL(makeUrl('object'));
    let ownOverrideCalls = 0;
    Object.defineProperty(hostileUrl, 'toString', {
      value: () => {
        ownOverrideCalls += 1;
        throw new Error(MARKERS.coercion);
      },
    });
    Object.defineProperty(hostileUrl, 'href', {
      get: () => {
        ownOverrideCalls += 1;
        throw new Error(MARKERS.coercion);
      },
    });
    const before = URL.prototype.toString.call(hostileUrl);
    const sanitize = requireUrlSanitizer();
    const once = sanitize(hostileUrl);

    expectNoSecrets(once);
    expect(once).toContain(`https://example.test/object?token=[REDACTED]&safe=${SAFE}`);
    expect(sanitize(once)).toBe(once);
    expect(URL.prototype.toString.call(hostileUrl)).toBe(before);
    expect(ownOverrideCalls).toBe(0);
  });

  it('is idempotent for sanitized diagnostic text', () => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(`Authorization: Bearer ${MARKERS.authorization}\r\n${makeUrl('idempotent')}`);

    expect(sanitize(once)).toBe(once);
  });

  it('is idempotent for whitespace-separated sanitized URLs', () => {
    const sanitize = requireTextSanitizer();
    const input = 'https://one.example/path?token=' + MARKERS.query + ' https://' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?token=' + MARKERS.fragment;
    const once = sanitize(input);

    expectNoSecrets(once);
    expect(once).toBe(
      'https://one.example/path?token=[REDACTED] ' +
      'https://two.example/path?token=[REDACTED]',
    );
    expect(sanitize(once)).toBe(once);
  });

  it.each([
    [
      'collapsed URL after a brace and backslash',
      'https://a.example/x{\\https://' + MARKERS.user + ':' +
        MARKERS.password + '@b.example/y https://c.example/z',
    ],
    [
      'sensitive fragment followed by another credentialed URL',
      'https://a.example/p#oauth_signature=' + MARKERS.fragment +
        '#!https://' + MARKERS.user + ':' + MARKERS.password +
        '@b.example/p?token=' + MARKERS.query,
    ],
    [
      'attacker-supplied sentinel before a collapsed URL',
      'https://a.example/p?token=RAW_MIMIC_Q7Z[REDACTED]\\\\https://' +
        'u:RAW_MIMIC_Q7Z@b.example/p',
    ],
  ])('reaches a fixed point for %s', (_name, input) => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(input);

    expectNoSecrets(once);
    expect(sanitize(once)).toBe(once);
  });

  it('fails closed for ambiguous labelled text after a sensitive value', () => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(
      'https://one.example/path?token=' + MARKERS.query + ',abc\t(h\tttp://' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(once);
    expect(once).toBe('[REDACTED]');
    expect(sanitize(once)).toBe(once);
  });

  it('preserves labelled prose after a non-sensitive URL before a fail-closed URL', () => {
    const sanitize = requireTextSanitizer();
    const once = sanitize(
      'https://one.example/path?view=summary,abc\t(h\tttp://' +
      MARKERS.user + ':' + MARKERS.password +
      '@two.example/path?token=' + MARKERS.fragment,
    );

    expectNoSecrets(once);
    expect(once).toBe(
      'https://one.example/path?view=summary,abc ([REDACTED]',
    );
    expect(sanitize(once)).toBe(once);
  });

  it.each(['—', '中', '😀'])(
    'keeps the %s Unicode boundary code-point-safe and idempotent',
    (boundary) => {
      const sanitize = requireTextSanitizer();
      const once = sanitize(
        'https://safe.example/path?x=a' + boundary + 'b\thttps://' +
        MARKERS.user + ':' + MARKERS.password + '@bad.example/path?token=' +
        MARKERS.query,
      );

      expectNoSecrets(once);
      expect(sanitize(once)).toBe(once);
      for (let index = 0; index < once.length; index += 1) {
        const code = once.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = once.charCodeAt(index + 1);
          expect(next).toBeGreaterThanOrEqual(0xdc00);
          expect(next).toBeLessThanOrEqual(0xdfff);
          index += 1;
        } else {
          expect(code < 0xdc00 || code > 0xdfff).toBe(true);
        }
      }
    },
  );

  it('keeps adjacent redaction sentinels bounded and idempotent', () => {
    const sanitize = requireTextSanitizer();
    const inputs = [
      ...['=', '?', ',', '|', '&'].map((separator) =>
        'https://safe.example/path?token=[REDACTED]' + separator + '[REDACTED]'),
      'https://safe.example/path?token=' + MARKERS.query + '?x=[REDACTED]',
    ];

    for (const input of inputs) {
      const first = sanitize(input);
      const second = sanitize(first);
      const third = sanitize(second);
      expectNoSecrets([first, second, third]);
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(first.length).toBeLessThanOrEqual(input.length + '[REDACTED]'.length);
    }
  });

  it.each([
    ['absolute', ' \t https://' + MARKERS.user + ':' + MARKERS.password +
      '@example.test/path?token=' + MARKERS.query + '&safe=' + SAFE],
    ['protocol-relative', '  //' + MARKERS.user + ':' + MARKERS.password +
      '@example.test/path?token=' + MARKERS.query + '&safe=' + SAFE],
    ['C0-prefixed absolute', '\u0000\u0001\u0008\u000b\u001fhttps://' +
      MARKERS.user + ':' + MARKERS.password +
      '@example.test/path?token=' + MARKERS.query + '&safe=' + SAFE],
  ])('sanitizes a whitespace-prefixed %s URL without dropping its safe structure', (_name, input) => {
    const output = requireUrlSanitizer()(input);

    expectNoSecrets(output);
    expect(output).toContain('example.test/path?token=[REDACTED]');
    expect(output).toContain('safe=' + SAFE);
  });

  it.each(['"', "'", '|', '>', '—'])(
    'sanitizes a protocol-relative URL after the %s punctuation boundary',
    (prefix) => {
      const output = requireTextSanitizer()(
        prefix + '//' + MARKERS.user + ':' + MARKERS.password +
        '@example.test/path?oauth_signature=' + MARKERS.authorization + '&safe=' + SAFE,
      );

      expectNoSecrets(output);
      expect(output).toContain('//example.test/path?oauth_signature=[REDACTED]');
      expect(output).toContain('safe=' + SAFE);
    },
  );
});

describe('Phase 1a RezoError transport and output boundaries', () => {
  it('makes retained transport objects non-enumerable without changing identity or readonly access', () => {
    const { error, config, request, response } = makeErrorFixture();

    for (const key of ['config', 'request', 'response'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      expect(descriptor?.enumerable, key).toBe(false);
      expect(descriptor?.writable, key).toBe(false);
      expect(descriptor?.configurable, key).toBe(false);
      expect(Reflect.ownKeys(error)).toContain(key);
      expect(Object.keys(error)).not.toContain(key);
    }
    expect(error.config).toBe(config);
    expect(error.request).toBe(request);
    expect(error.response).toBe(response);
    expect(Reflect.set(error, 'config', {})).toBe(false);
    expect(Reflect.deleteProperty(error, 'config')).toBe(false);
  });

  it('closes both credential carriers across spread and serializer paths', () => {
    const fixture = makeErrorFixture();
    const headerOnly = new RezoError(
      SAFE,
      { url: `https://example.test/?safe=${SAFE}`, headers: fixture.config.headers } as unknown as RezoConfigArgument,
      'ECONNRESET',
    );

    expectNoSecrets(JSON.stringify({ ...headerOnly }), [MARKERS.authorization, MARKERS.proxyAuthorization, MARKERS.cookie]);
    expectNoSecrets(JSON.stringify(headerOnly), [MARKERS.authorization, MARKERS.proxyAuthorization, MARKERS.cookie]);
    expectNoSecrets(JSON.stringify({ ...fixture.error }));
    expectNoSecrets(JSON.stringify(fixture.error));
  });

  it('stores safe diagnostic URL leaves while retaining untouched raw transports', () => {
    const { error, config, response, sourceUrl, finalUrl } = makeErrorFixture();

    expectNoSecrets(Reflect.get(error, 'url'));
    expectNoSecrets(Reflect.get(error, 'finalUrl'));
    expectNoSecrets(Reflect.get(error, 'urls'));
    expect(config.url).toBe(sourceUrl);
    expect(response.finalUrl).toBe(finalUrl);
    expect(config.url).toContain(MARKERS.query);
    expect(response.finalUrl).toContain(MARKERS.fragment);
  });

  it('sanitizes every Rezo-owned debug and supported string/serialization sink', () => {
    const fixture = makeErrorFixture();
    const copiedCause = new Error(
      `${SAFE}; Cookie: sid=${MARKERS.cookie}; URL: ${makeUrl('copied')}`,
    ) as Error & { code: string };
    copiedCause.code = 'ECONNRESET';
    const copied = RezoError.fromError(
      copiedCause,
      fixture.config as unknown as RezoConfigArgument,
    );
    const debugOutput = captureDebug(fixture.config, fixture.error);
    const trackOutput = captureDebug({ ...fixture.config, debug: false, trackUrl: true }, copied);
    const stringOutput = fixture.error.toString();
    const detailOutput = fixture.error.getFullDetails();
    const outputs = [
      debugOutput,
      trackOutput,
      fixture.error.toJSON(),
      JSON.stringify(fixture.error),
      stringOutput,
      detailOutput,
      copied.toJSON(),
      copied.toString(),
      copied.getFullDetails(),
    ];

    for (const output of outputs) {
      expectNoSecrets(output);
    }
    expect(outputs.map(serialized).join('\n')).toContain(SAFE);
    expect(debugOutput).toContain(`[Rezo Debug] Request: GET ${requireUrlSanitizer()(fixture.sourceUrl)}`);
    expect(debugOutput).toContain(`[Rezo Debug] Final URL: ${requireUrlSanitizer()(fixture.finalUrl)} (2 redirects)`);
    expect(debugOutput).toContain('[Rezo Debug] URL chain:');
    expect(debugOutput).toContain('[Rezo Debug] Attempts (1):');
    expect(debugOutput).toContain('[Rezo Debug] Stack:');
    expect(debugOutput.endsWith('[Rezo Debug] ─────────────────────────────────────')).toBe(true);
    expect(trackOutput.startsWith('[Rezo Track] ✗ ECONNRESET:')).toBe(true);
    expect(trackOutput).not.toContain('\n');
    expect(stringOutput).toBe('RezoError: Request failed with status code 401 [REZ_HTTP_ERROR]');
    expect(detailOutput).toContain('Code: REZ_HTTP_ERROR\nMethod: GET\nURL:');
    expect(detailOutput.endsWith('\n')).toBe(true);
  });

  it('falls back from hostile debug getters and completes the fingerprint', () => {
    const fallbackUrl = makeUrl('fallback');
    const config = { debug: true, method: 'get', url: fallbackUrl };
    Object.defineProperty(config, 'fullUrl', {
      get() {
        throw new Error(MARKERS.coercion);
      },
    });
    const error = { name: 'RezoError', code: 'ECONNRESET' };
    Object.defineProperty(error, 'message', {
      get() {
        throw new Error(MARKERS.coercion);
      },
    });

    const output = captureDebug(config, error);

    expectNoSecrets(output);
    expect(output).toContain(`[Rezo Debug] Request: GET ${requireUrlSanitizer()(fallbackUrl)}`);
    expect(output).toContain('[Rezo Debug] Response: none received');
    expect(output).toContain('[Rezo Debug] Flags: timeout=false network=false retryable=false');
    expect(output.endsWith('[Rezo Debug] ─────────────────────────────────────')).toBe(true);
  });

  it('retains the five-line debug stack bound while neutralizing its content', () => {
    const sixthLine = 'SIXTH_STACK_LINE_MUST_BE_OMITTED';
    const stack = [
      'Error: ' + SAFE,
      '    at one (/safe.ts:1:1)',
      '    at two (/safe.ts:2:1)',
      '    at three (/safe.ts:3:1)',
      '    at four (/safe.ts:4:1)',
      sixthLine,
    ].join('\n');
    const output = captureDebug(
      { debug: true, method: 'get', url: 'https://example.test/' },
      { name: 'Error', message: SAFE, stack },
    );

    expect(output).toContain('[Rezo Debug] Stack:');
    expect(output).toContain('at four');
    expect(output).not.toContain(sixthLine);
  });

  it('reports a final URL when raw endpoints differ only in redacted credentials', () => {
    const source = 'https://first:one@example.test/path?token=source&safe=' + SAFE;
    const final = 'https://second:two@example.test/path?token=final&safe=' + SAFE;
    const config = { debug: true, method: 'get', url: source, fullUrl: source, finalUrl: final, redirectCount: 1 };
    const response = { status: 401, statusText: 'Unauthorized', finalUrl: final, urls: [source, final] };
    const error = RezoError.createHttpError(
      401,
      config as unknown as RezoConfigArgument,
      undefined,
      response as unknown as RezoResponseArgument,
    );

    const debugOutput = captureDebug(config, error);
    const detailOutput = error.getFullDetails();
    expect(debugOutput).toContain('[Rezo Debug] Final URL:');
    expect(detailOutput).toContain('Final URL:');
    expectNoSecrets([debugOutput, detailOutput], ['first', 'second', 'source', 'final']);
  });

  it('does not invent a final URL when no raw final endpoint exists', () => {
    const source = 'https://' + MARKERS.user + ':' + MARKERS.password +
      '@example.test/path?token=' + MARKERS.query + '&safe=' + SAFE;
    const config = { debug: true, method: 'get', url: source, fullUrl: source };
    const error = RezoError.createHttpError(
      401,
      config as unknown as RezoConfigArgument,
    );

    const debugOutput = captureDebug(config, error);
    const detailOutput = error.getFullDetails();
    expectNoSecrets([debugOutput, detailOutput]);
    expect(debugOutput).not.toContain('[Rezo Debug] Final URL:');
    expect(detailOutput).not.toContain('Final URL:');
  });

  it('keeps supported RezoError outputs total under hostile diagnostic getters', () => {
    const error = new RezoError(
      SAFE,
      { url: `https://example.test/?safe=${SAFE}` } as unknown as RezoConfigArgument,
    );
    const hostileKeys = [
      'name', 'message', 'code', 'method', 'url', 'finalUrl', 'urls',
      'status', 'statusText', 'cause', 'errno', 'hostname', 'port',
    ] as const;

    for (const key of hostileKeys) {
      Object.defineProperty(error, key, {
        configurable: true,
        get() {
          throw new Error(`${MARKERS.coercion}-${key}`);
        },
      });
    }

    const outputs: unknown[] = [];
    expect(() => outputs.push(error.toJSON())).not.toThrow();
    expect(() => outputs.push(JSON.stringify(error))).not.toThrow();
    expect(() => outputs.push(error.toString())).not.toThrow();
    expect(() => outputs.push(error.getFullDetails())).not.toThrow();

    expectNoSecrets(outputs);
    expect(serialized(outputs)).not.toContain(MARKERS.coercion);
  });

  it('sanitizes native inspection while preserving deliberate raw direct access', () => {
    const raw = new Error(
      SAFE + '; Authorization: Bearer ' + MARKERS.authorization + '; URL: ' + makeUrl('inspect'),
    ) as Error & { code: string };
    raw.code = 'ECONNRESET';
    raw.stack = raw.name + ': ' + raw.message + '\nCookie: sid=' + MARKERS.cookie +
      '\n    at caller (/safe.ts:1:1)';
    const config = {
      url: makeUrl('inspect-config'),
      headers: { Authorization: 'Bearer ' + MARKERS.authorization },
    } as unknown as RezoConfigArgument;
    const error = RezoError.fromError(raw, config);

    expect(error.message).toContain(MARKERS.authorization);
    expect(raw.stack).toContain(MARKERS.cookie);
    expectNoSecrets(error.stack);
    expect(error.cause).toBe(raw);
    const inspected = inspect(error, { depth: 5 });
    expectNoSecrets(inspected);
    expect(inspected).toContain(SAFE);
    expect(inspected).toContain('ECONNRESET');
    const denoInspect = Reflect.get(error, Symbol.for('Deno.customInspect'));
    const denoOutput = Reflect.apply(denoInspect, error, []);
    expect(denoOutput).toBeTypeOf('string');
    expectNoSecrets(denoOutput);
    expect(denoOutput).toContain(SAFE);
    expect(denoOutput).toContain('ECONNRESET');
  });

  it('preserves the exact public serializer key set and structured values', () => {
    const { error, sourceUrl, finalUrl, response } = makeErrorFixture();
    const json = error.toJSON();

    expect(Object.keys(json)).toEqual([
      'name', 'message', 'code', 'method', 'url',
      'finalUrl', 'status', 'statusText', 'urls', 'cause',
    ]);
    expect(json.name).toBe('RezoError');
    expect(json.message).toBe('Request failed with status code 401');
    expect(json.code).toBe('REZ_HTTP_ERROR');
    expect(json.status).toBe(401);
    expect(json.method).toBe('GET');
    expect(json.statusText).toBe('Unauthorized');
    expect(json.url).toBe(requireUrlSanitizer()(sourceUrl));
    expect(json.finalUrl).toBe(requireUrlSanitizer()(finalUrl));
    expect(json.urls).toEqual(response.urls.map(requireUrlSanitizer()));
    expect(json.urls).not.toBe(response.urls);
    expect(JSON.parse(JSON.stringify(error))).toEqual(json);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RezoError);
  });

  it('preserves null for an empty typed Error cause in the public serializer', () => {
    const error = new RezoError(
      SAFE,
      { url: 'https://example.test/' } as unknown as RezoConfigArgument,
      'ECONNRESET',
    );
    Object.defineProperty(error, 'cause', {
      value: new Error(''),
      enumerable: false,
    });

    expect(error.toJSON().cause).toBeNull();
    expect(JSON.parse(JSON.stringify(error)).cause).toBeNull();
  });
});
