import { describe, expect, it } from 'vitest';
import type { OutgoingHttpHeaders } from 'node:http';
import * as publicApi from '../src/index';
import * as toolExports from '../src/utils/tools';
import { RezoHeaders } from '../src/utils/headers';
import * as headerExports from '../src/utils/headers';

type RedirectOriginRelation =
  | 'same-origin'
  | 'cross-origin'
  | 'downgrade'
  | 'invalid';

type ClassifyRedirectOrigin = (
  sourceUrl: string | URL,
  destinationUrl: string | URL,
) => RedirectOriginRelation;

type RedirectHeaderInit =
  | Headers
  | RezoHeaders
  | Iterable<readonly [string, string]>
  | Record<string, string | number | string[] | undefined>;

type PrepareRedirectHeaders = (
  inherited: RezoHeaders,
  relation: RedirectOriginRelation,
  explicit?: RedirectHeaderInit,
) => RezoHeaders;

const classifyRedirectOrigin = (
  toolExports as unknown as { classifyRedirectOrigin?: ClassifyRedirectOrigin }
).classifyRedirectOrigin;

const prepareRedirectHeaders = (
  headerExports as unknown as { prepareRedirectHeaders?: PrepareRedirectHeaders }
).prepareRedirectHeaders;

const ORIGIN_CASES: ReadonlyArray<{
  name: string;
  source: string | URL;
  destination: string | URL;
  expected: RedirectOriginRelation;
}> = [
  { name: 'relative destination', source: 'https://example.test/a', destination: '/b?q=1', expected: 'same-origin' },
  { name: 'path/query/fragment only', source: 'https://example.test/a', destination: 'https://example.test/b?q=1#x', expected: 'same-origin' },
  { name: 'HTTPS implicit/default port', source: 'https://example.test/a', destination: 'https://example.test:443/b', expected: 'same-origin' },
  { name: 'HTTP implicit/default port', source: 'http://example.test:80/a', destination: 'http://example.test/b', expected: 'same-origin' },
  { name: 'userinfo does not change origin', source: 'https://first:one@example.test/a', destination: 'https://second:two@example.test/b', expected: 'same-origin' },
  { name: 'host casing canonicalizes', source: 'https://EXAMPLE.test/a', destination: 'https://example.TEST/b', expected: 'same-origin' },
  { name: 'Unicode hostname canonicalizes', source: 'https://bücher.example/a', destination: 'https://xn--bcher-kva.example/b', expected: 'same-origin' },
  { name: 'URL objects compare canonically', source: new URL('https://example.test/a'), destination: new URL('https://example.test/b'), expected: 'same-origin' },
  { name: 'relative parent path resolves against source', source: 'https://example.test/a/b', destination: '../next', expected: 'same-origin' },
  { name: 'non-default port changes origin', source: 'https://example.test/a', destination: 'https://example.test:444/b', expected: 'cross-origin' },
  { name: 'hostname changes origin', source: 'https://one.example/a', destination: 'https://two.example/b', expected: 'cross-origin' },
  { name: 'IP and hostname are different origins', source: 'http://127.0.0.1/a', destination: 'http://localhost/b', expected: 'cross-origin' },
  { name: 'HTTP to HTTPS has no exemption', source: 'http://example.test/a', destination: 'https://example.test/b', expected: 'cross-origin' },
  { name: 'HTTPS to HTTP is downgrade', source: 'https://example.test/a', destination: 'http://example.test/b', expected: 'downgrade' },
  { name: 'downgrade remains specific across hosts', source: 'https://one.example/a', destination: 'http://two.example/b', expected: 'downgrade' },
  { name: 'IPv6 non-default port changes origin', source: 'http://[::1]:8080/a', destination: 'http://[::1]:8081/b', expected: 'cross-origin' },
  { name: 'protocol-relative target resolves per hop', source: 'https://one.example/a', destination: '//two.example/b', expected: 'cross-origin' },
  { name: 'unsupported destination scheme', source: 'https://example.test/a', destination: 'ftp://example.test/b', expected: 'invalid' },
  { name: 'unsupported source scheme', source: 'ftp://example.test/a', destination: 'https://example.test/b', expected: 'invalid' },
  { name: 'relative source', source: '/source', destination: 'https://example.test/b', expected: 'invalid' },
  { name: 'opaque data target', source: 'https://example.test/a', destination: 'data:text/plain,hello', expected: 'invalid' },
  { name: 'file target', source: 'https://example.test/a', destination: 'file:///tmp/a', expected: 'invalid' },
  { name: 'mailto target', source: 'https://example.test/a', destination: 'mailto:user@example.test', expected: 'invalid' },
  { name: 'malformed source', source: 'http://[::1', destination: '/b', expected: 'invalid' },
  { name: 'malformed destination', source: 'https://example.test/a', destination: 'http://[::1', expected: 'invalid' },
];

function requireClassifier(): ClassifyRedirectOrigin {
  expect(classifyRedirectOrigin, 'internal security classifier export').toBeTypeOf('function');
  return classifyRedirectOrigin as ClassifyRedirectOrigin;
}

function requireHeaderPreparation(): PrepareRedirectHeaders {
  expect(prepareRedirectHeaders, 'internal redirect-header helper export').toBeTypeOf('function');
  return prepareRedirectHeaders as PrepareRedirectHeaders;
}

describe('Phase 1a redirect-origin classifier', () => {
  it('exports a separate internal security helper', () => {
    expect(classifyRedirectOrigin).toBeTypeOf('function');
  });

  it('does not expand the public root API with internal Phase 1a helpers', () => {
    expect(publicApi).not.toHaveProperty('classifyRedirectOrigin');
    expect(publicApi).not.toHaveProperty('prepareRedirectHeaders');
    expect(publicApi).not.toHaveProperty('sanitizeDiagnosticText');
    expect(publicApi).not.toHaveProperty('sanitizeDiagnosticUrl');
  });

  it('leaves legacy sameDomain callback metadata semantics intact', () => {
    expect(toolExports.isSameDomain('https://example.test:444/a', 'http://example.test:80/b')).toBe(true);
  });

  it.each(ORIGIN_CASES)('$name → $expected', ({ source, destination, expected }) => {
    expect(requireClassifier()(source, destination)).toBe(expected);
  });

  it('is deterministic, pure, and does not mutate URL inputs', () => {
    const source = new URL('https://user:pass@example.test/a');
    const destination = new URL('https://example.test/b');
    const before = [source.href, destination.href];
    const classify = requireClassifier();

    expect(classify(source, destination)).toBe('same-origin');
    expect(classify(source, destination)).toBe('same-origin');
    expect([source.href, destination.href]).toEqual(before);
  });
});

describe('Phase 1a pure redirect-header preparation', () => {
  it('keeps the existing case-insensitive clone primitive as a passing control', () => {
    const original = new RezoHeaders({ Authorization: 'Bearer source' });
    const clone = new RezoHeaders(original);
    clone.delete('AUTHORIZATION');

    expect(original.get('authorization')).toBe('Bearer source');
    expect(clone.get('authorization')).toBeNull();
  });

  it('clones same-origin headers, retains origin credentials, and never emits proxy credentials', () => {
    const inherited = new RezoHeaders({
      Authorization: 'Bearer source',
      Cookie: 'source=one',
      'Proxy-Authorization': 'Basic proxy-source',
      'X-Control': 'kept',
    });
    const prepared = requireHeaderPreparation()(inherited, 'same-origin');

    expect(prepared).not.toBe(inherited);
    expect(prepared.get('authorization')).toBe('Bearer source');
    expect(prepared.get('cookie')).toBe('source=one');
    expect(prepared.get('proxy-authorization')).toBeNull();
    expect(prepared.get('x-control')).toBe('kept');
    expect(inherited.get('proxy-authorization')).toBe('Basic proxy-source');
  });

  it.each(['cross-origin', 'downgrade', 'invalid'] as const)(
    'strips every inherited credential carrier for %s',
    (relation) => {
      const inherited = new RezoHeaders({
        Authorization: 'Bearer source',
        Cookie: 'source=one',
        'Proxy-Authorization': 'Basic proxy-source',
        'X-Control': 'kept',
      });
      const prepared = requireHeaderPreparation()(inherited, relation);

      expect(prepared.get('authorization')).toBeNull();
      expect(prepared.get('cookie')).toBeNull();
      expect(prepared.get('proxy-authorization')).toBeNull();
      expect(prepared.get('x-control')).toBe('kept');
      expect(inherited.get('authorization')).toBe('Bearer source');
      expect(inherited.get('cookie')).toBe('source=one');
    },
  );

  it.each([
    ['native Headers', new Headers({ Authorization: 'Bearer destination', Cookie: 'destination=one', 'Proxy-Authorization': 'Basic forbidden', 'X-Explicit': 'native' })],
    ['RezoHeaders', new RezoHeaders({ Authorization: 'Bearer destination', Cookie: 'destination=one', 'Proxy-Authorization': 'Basic forbidden', 'X-Explicit': 'rezo' })],
    ['tuple iterable', [['Authorization', 'Bearer destination'], ['Cookie', 'destination=one'], ['Proxy-Authorization', 'Basic forbidden'], ['X-Explicit', 'tuple']] as const],
    ['record with arrays', { Authorization: 'Bearer destination', Cookie: ['destination=one'], 'Proxy-Authorization': 'Basic forbidden', 'X-Explicit': ['record'] }],
  ] as const)('applies %s explicit destination headers last without emitting Proxy-Authorization', (_name, explicit) => {
    const inherited = new RezoHeaders({ Authorization: 'Bearer source', Cookie: 'source=one', 'X-Control': 'kept' });
    const explicitBefore = explicit instanceof Headers
      ? [...explicit.entries()]
      : Array.isArray(explicit)
        ? explicit.map(([name, value]) => [name, value])
        : Object.entries(explicit).map(([name, value]) => [
            name,
            Array.isArray(value) ? [...value] : value,
          ]);
    const prepared = requireHeaderPreparation()(inherited, 'cross-origin', explicit);

    expect(prepared.get('authorization')).toBe('Bearer destination');
    expect(prepared.get('cookie')).toBe('destination=one');
    expect(prepared.get('proxy-authorization')).toBeNull();
    expect(prepared.get('x-control')).toBe('kept');
    expect(prepared.get('x-explicit')).toMatch(/native|rezo|tuple|record/);
    expect(inherited.get('authorization')).toBe('Bearer source');
    const explicitAfter = explicit instanceof Headers
      ? [...explicit.entries()]
      : Array.isArray(explicit)
        ? explicit.map(([name, value]) => [name, value])
        : Object.entries(explicit).map(([name, value]) => [
            name,
            Array.isArray(value) ? [...value] : value,
          ]);
    expect(explicitAfter).toEqual(explicitBefore);
  });

  it('preserves duplicate explicit values consistently across tuple and record carriers', () => {
    const inherited = new RezoHeaders({ Cookie: 'source=one', 'X-Control': 'kept' });
    const tuple = [
      ['Cookie', 'destination=one'],
      ['cookie', 'destination=two'],
      ['X-Duplicate', 'one'],
      ['x-duplicate', 'two'],
    ] as const;
    const record = {
      Cookie: ['destination=one', 'destination=two'],
      'X-Duplicate': ['one', 'two'],
    };
    const prepare = requireHeaderPreparation();
    const fromTuple = prepare(inherited, 'cross-origin', tuple);
    const fromRecord = prepare(inherited, 'cross-origin', record);

    expect(fromTuple.get('cookie')).toBe(fromRecord.get('cookie'));
    expect(fromTuple.get('x-duplicate')).toBe(fromRecord.get('x-duplicate'));
    expect(fromTuple.get('cookie')).toContain('destination=one');
    expect(fromTuple.get('cookie')).toContain('destination=two');
    expect(inherited.get('cookie')).toBe('source=one');
  });

  it('accepts the public OutgoingHttpHeaders value domain without emitting undefined', () => {
    const inherited = new RezoHeaders({ 'X-Undefined': 'inherited', 'X-Control': 'kept' });
    const explicit: OutgoingHttpHeaders = {
      'X-Number': 42,
      'X-Undefined': undefined,
      'X-Array': ['one', 'two'],
    };
    const prepared = requireHeaderPreparation()(inherited, 'same-origin', explicit);

    expect(prepared.get('x-number')).toBe('42');
    expect(prepared.get('x-undefined')).toBeNull();
    expect(prepared.get('x-array')).toContain('one');
    expect(prepared.get('x-array')).toContain('two');
    expect(explicit['X-Undefined']).toBeUndefined();
    expect(inherited.get('x-undefined')).toBe('inherited');
  });

  it('treats string-keyed records as records when an inherited iterator is unusable or empty', () => {
    const inherited = new RezoHeaders({ 'X-Control': 'kept' });
    const nonCallable = Object.assign(
      Object.create({ [Symbol.iterator]: 1 }),
      { Authorization: 'Bearer destination', 'X-Explicit': 'non-callable' },
    ) as Record<string, string>;
    const emptyCallable = Object.assign(
      Object.create({
        *[Symbol.iterator](): IterableIterator<readonly [string, string]> {
          // The inherited iterator is unrelated to the record's own headers.
        },
      }),
      { Authorization: 'Bearer destination', 'X-Explicit': 'empty-callable' },
    ) as Record<string, string>;

    for (const explicit of [nonCallable, emptyCallable]) {
      const before = Object.entries(explicit);
      const prepared = requireHeaderPreparation()(
        inherited,
        'cross-origin',
        explicit,
      );

      expect(prepared.get('authorization')).toBe('Bearer destination');
      expect(prepared.get('x-explicit')).toMatch(/non-callable|empty-callable/);
      expect(prepared.get('x-control')).toBe('kept');
      expect(Object.entries(explicit)).toEqual(before);
      expect(inherited.get('x-control')).toBe('kept');
    }
  });
});
