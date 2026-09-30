import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index';
import { RezoHeaders } from '../src/utils/headers';

type RedirectOriginRelation =
  | 'same-origin'
  | 'cross-origin'
  | 'downgrade'
  | 'invalid';

type RedirectHeaderField =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: unknown };

type RedirectHeaderOperation =
  | { readonly kind: 'set'; readonly values: readonly string[] }
  | { readonly kind: 'delete' };

interface RedirectHeaderPatch {
  readonly size: number;
  get(name: string): RedirectHeaderOperation | undefined;
  entries(): IterableIterator<readonly [string, RedirectHeaderOperation]>;
}

interface RedirectHeaderPolicyState {
  readonly currentUrl: string;
  readonly redirectCount: number;
  readonly history: readonly string[];
  readonly persistent: Readonly<{
    readonly anchorOrigin: string;
    readonly patch: RedirectHeaderPatch;
  }> | null;
  readonly oneHop: RedirectHeaderPatch | null;
}

type PolicyFailure =
  | { readonly ok: false; readonly reason: 'invalid-url' }
  | {
      readonly ok: false;
      readonly reason: 'invalid-header-patch';
      readonly field: 'setHeaders' | 'setHeadersOnRedirects';
    };

type InitResult =
  | { readonly ok: true; readonly state: RedirectHeaderPolicyState }
  | PolicyFailure;

type TransitionResult =
  | {
      readonly ok: true;
      readonly relation: RedirectOriginRelation;
      readonly state: RedirectHeaderPolicyState;
    }
  | PolicyFailure;

interface RedirectHeaderPolicyModule {
  createRedirectHeaderPolicyState(initialNormalizedUrl: string | URL): InitResult;
  stageRedirectHeaderTransition(
    current: RedirectHeaderPolicyState,
    input: Readonly<{
      finalizedNormalizedUrl: string | URL;
      setHeaders: RedirectHeaderField;
      setHeadersOnRedirects: RedirectHeaderField;
    }>,
  ): TransitionResult;
  composeRedirectHeaders(
    state: RedirectHeaderPolicyState,
    layers: Readonly<{
      targetBase: RezoHeaders;
      destinationHeaders: RezoHeaders;
    }>,
  ): RezoHeaders;
}

const internalModulePath = '../src/utils/' + 'redirect-header-policy.ts';
const policyModule = await import(/* @vite-ignore */ internalModulePath)
  .then((value) => value as unknown as Partial<RedirectHeaderPolicyModule>)
  .catch(() => undefined);

const ABSENT = Object.freeze({ kind: 'absent' } as const);
const present = (value: unknown): RedirectHeaderField =>
  Object.freeze({ kind: 'present', value });

function requirePolicy(): RedirectHeaderPolicyModule {
  expect(policyModule, 'internal redirect-header policy module').toBeDefined();
  expect(policyModule?.createRedirectHeaderPolicyState).toBeTypeOf('function');
  expect(policyModule?.stageRedirectHeaderTransition).toBeTypeOf('function');
  expect(policyModule?.composeRedirectHeaders).toBeTypeOf('function');
  return policyModule as RedirectHeaderPolicyModule;
}

function createState(initialUrl = 'https://a.test/start'): RedirectHeaderPolicyState {
  const result = requirePolicy().createRedirectHeaderPolicyState(initialUrl);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Unexpected policy init failure: ${result.reason}`);
  return result.state;
}

function stage(
  current: RedirectHeaderPolicyState,
  finalizedNormalizedUrl: string | URL,
  setHeaders: RedirectHeaderField = ABSENT,
  setHeadersOnRedirects: RedirectHeaderField = ABSENT,
): Extract<TransitionResult, { readonly ok: true }> {
  const result = requirePolicy().stageRedirectHeaderTransition(current, {
    finalizedNormalizedUrl,
    setHeaders,
    setHeadersOnRedirects,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Unexpected transition failure: ${result.reason}`);
  return result;
}

function compose(
  state: RedirectHeaderPolicyState,
  targetBase: RezoHeaders | Record<string, string> = {},
  destinationHeaders: RezoHeaders | Record<string, string> = {},
): RezoHeaders {
  return requirePolicy().composeRedirectHeaders(state, {
    targetBase: targetBase instanceof RezoHeaders
      ? targetBase
      : new RezoHeaders(targetBase),
    destinationHeaders: destinationHeaders instanceof RezoHeaders
      ? destinationHeaders
      : new RezoHeaders(destinationHeaders),
  });
}

describe('Phase 1c-a internal redirect-header policy contract', () => {
  it('adds the direct-import-only immutable state owner', () => {
    requirePolicy();
  });

  it('does not expose internal state helpers from the public root', () => {
    expect(publicApi).not.toHaveProperty('createRedirectHeaderPolicyState');
    expect(publicApi).not.toHaveProperty('stageRedirectHeaderTransition');
    expect(publicApi).not.toHaveProperty('composeRedirectHeaders');
  });
});

describe.skipIf(policyModule === undefined)('Phase 1c-a U1 immutable authority state', () => {
  it('takes case-insensitive immutable snapshots of callback carriers', () => {
    const firstValue = ['persistent-one'];
    const persistentInput: Record<string, string | string[] | undefined> = {
      'X-Mixed': firstValue,
      'x-mixed': 'persistent-two',
      'X-Deleted': undefined,
    };
    const oneHopInput = new RezoHeaders({
      'X-One-Hop': 'one-hop-before',
    });
    const original = createState();
    const next = stage(
      original,
      '/one',
      present(oneHopInput),
      present(persistentInput),
    ).state;

    firstValue[0] = 'mutated-array';
    persistentInput['X-Mixed'] = 'mutated-record';
    oneHopInput.set('X-One-Hop', 'mutated-headers');

    const headers = compose(next, { 'X-Deleted': 'base' });
    expect(headers.get('x-mixed')).toBe('persistent-one, persistent-two');
    expect(headers.get('x-one-hop')).toBe('one-hop-before');
    expect(headers.get('x-deleted')).toBeNull();
    expect(original.currentUrl).toBe('https://a.test/start');
    expect(original.redirectCount).toBe(0);
  });

  it('treats own string-keyed records as records without reading unrelated iterators', () => {
    let iteratorReads = 0;
    const record = { 'X-Record': 'record-value' };
    Object.defineProperty(record, Symbol.iterator, {
      get() {
        iteratorReads++;
        throw new Error('must not read record iterator');
      },
    });

    const state = stage(createState(), '/one', present(record)).state;
    expect(iteratorReads).toBe(0);
    expect(compose(state).get('x-record')).toBe('record-value');
  });

  it('captures a generic iterable accessor exactly once', () => {
    let iteratorReads = 0;
    const carrier = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(carrier, Symbol.iterator, {
      get() {
        iteratorReads++;
        if (iteratorReads > 1) throw new Error('iterator accessor read twice');
        return function* headerEntries() {
          yield ['X-Iterable', 'iterable-value'] as const;
        };
      },
    });

    const state = stage(createState(), '/one', present(carrier)).state;
    expect(iteratorReads).toBe(1);
    expect(compose(state).get('x-iterable')).toBe('iterable-value');
  });

  it('composes base, destination, persistent, and one-hop in order and reuses one-hop on retry', () => {
    const state = stage(
      createState(),
      '/one',
      present({ 'X-Collision': 'one-hop', 'X-One-Hop': 'yes' }),
      present({ 'X-Collision': 'persistent', 'X-Persistent': 'yes' }),
    ).state;
    const base = new RezoHeaders({ 'X-Collision': 'base', 'X-Base': 'yes' });
    const destination = new RezoHeaders({ 'X-Collision': 'destination', 'X-Destination': 'yes' });
    const baseBefore = [...base.entries()];
    const destinationBefore = [...destination.entries()];

    const firstAttempt = compose(state, base, destination);
    expect(firstAttempt).not.toBe(base);
    expect(firstAttempt).not.toBe(destination);
    firstAttempt.set('X-Collision', 'mutated-output');
    const retryAttempt = compose(state, base, destination);

    expect(retryAttempt.get('x-collision')).toBe('one-hop');
    expect(retryAttempt.get('x-base')).toBe('yes');
    expect(retryAttempt.get('x-destination')).toBe('yes');
    expect(retryAttempt.get('x-persistent')).toBe('yes');
    expect(retryAttempt.get('x-one-hop')).toBe('yes');
    expect([...base.entries()]).toEqual(baseBefore);
    expect([...destination.entries()]).toEqual(destinationBefore);

    const laterRedirect = stage(state, '/two').state;
    const laterHeaders = compose(laterRedirect, base, destination);
    expect(laterHeaders.get('x-collision')).toBe('persistent');
    expect(laterHeaders.get('x-one-hop')).toBeNull();
  });

  it('treats per-name undefined and empty arrays as deletion tombstones', () => {
    const state = stage(
      createState(),
      '/one',
      present({
        'X-Base': undefined,
        'X-Persistent': [],
      }),
      present({
        'X-Destination': undefined,
        'X-Persistent': 'persistent',
      }),
    ).state;
    const headers = compose(
      state,
      { 'X-Base': 'base' },
      { 'X-Destination': 'destination' },
    );

    expect(headers.get('x-base')).toBeNull();
    expect(headers.get('x-destination')).toBeNull();
    expect(headers.get('x-persistent')).toBeNull();

    const sequential = stage(
      createState(),
      '/one',
      present([
        ['X-Sequential', 'one'],
        ['x-sequential', undefined],
        ['X-Sequential', 'two'],
      ]),
    ).state;
    expect(compose(sequential).get('x-sequential')).toBe('two');
    const finalTombstone = stage(
      createState(),
      '/one',
      present([
        ['X-Sequential', 'one'],
        ['x-sequential', []],
      ]),
    ).state;
    expect(compose(finalTombstone).get('x-sequential')).toBeNull();
  });

  it('distinguishes absent, empty, and nonempty persistent fields', () => {
    const established = stage(
      createState(),
      '/one',
      ABSENT,
      present({ 'X-Old': 'old' }),
    ).state;
    const retained = stage(established, '/two').state;
    expect(compose(retained).get('x-old')).toBe('old');

    const cleared = stage(retained, '/three', ABSENT, present({})).state;
    expect(cleared.persistent).toBeNull();
    expect(compose(cleared).get('x-old')).toBeNull();

    const replaced = stage(
      retained,
      '/four',
      ABSENT,
      present({ 'X-New': 'new' }),
    ).state;
    const replacementHeaders = compose(replaced);
    expect(replacementHeaders.get('x-old')).toBeNull();
    expect(replacementHeaders.get('x-new')).toBe('new');
  });

  it('retains persistence only across exact scheme, host, and effective-port origin', () => {
    const sameOrigin = stage(
      stage(createState(), '/one', ABSENT, present({ 'X-Persistent': 'yes' })).state,
      'https://a.test:443/two',
    );
    expect(sameOrigin.relation).toBe('same-origin');
    expect(compose(sameOrigin.state).get('x-persistent')).toBe('yes');

    const cases = [
      ['host', 'https://b.test/two', 'cross-origin'],
      ['port', 'https://a.test:444/two', 'cross-origin'],
      ['downgrade', 'http://a.test/two', 'downgrade'],
    ] as const;
    for (const [_name, destination, relation] of cases) {
      const established = stage(
        createState(),
        '/one',
        ABSENT,
        present({ 'X-Persistent': 'yes' }),
      ).state;
      const expired = stage(established, destination);
      expect(expired.relation).toBe(relation);
      expect(expired.state.persistent).toBeNull();
      expect(compose(expired.state).get('x-persistent')).toBeNull();
    }

    const httpEstablished = stage(
      createState('http://a.test/start'),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'yes' }),
    ).state;
    const upgraded = stage(httpEstablished, 'https://a.test/two');
    expect(upgraded.relation).toBe('cross-origin');
    expect(upgraded.state.persistent).toBeNull();
  });

  it('terminally expires persistence across A to B to A without revival', () => {
    const atA = stage(
      createState(),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'from-a' }),
    ).state;
    const atB = stage(atA, 'https://b.test/two').state;
    const backAtA = stage(atB, 'https://a.test/three').state;

    expect(atB.persistent).toBeNull();
    expect(backAtA.persistent).toBeNull();
    expect(compose(backAtA).get('x-persistent')).toBeNull();
  });

  it('anchors a fresh persistent patch to the callback-finalized destination', () => {
    const atA = stage(
      createState(),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'from-a' }),
    ).state;
    const reestablishedAtB = stage(
      atA,
      'https://b.test/two',
      ABSENT,
      present({ 'X-Persistent': 'from-b' }),
    ).state;
    const stillAtB = stage(reestablishedAtB, 'https://b.test/three').state;

    expect(reestablishedAtB.persistent?.anchorOrigin).toBe('https://b.test');
    expect(stillAtB.persistent?.anchorOrigin).toBe('https://b.test');
    expect(compose(stillAtB).get('x-persistent')).toBe('from-b');
  });

  it('allows a fresh callback patch to reissue authority after a downgrade', () => {
    const source = stage(
      createState(),
      '/one',
      ABSENT,
      present({ Authorization: 'Bearer source', 'X-Old': 'old' }),
    ).state;
    const downgraded = stage(
      source,
      'http://a.test/two',
      present({ Authorization: 'Bearer one-hop' }),
      present({ Cookie: 'fresh=one', 'X-Fresh': 'yes' }),
    );
    const headers = compose(downgraded.state);

    expect(downgraded.relation).toBe('downgrade');
    expect(headers.get('authorization')).toBe('Bearer one-hop');
    expect(headers.get('cookie')).toBe('fresh=one');
    expect(headers.get('x-fresh')).toBe('yes');
    expect(headers.get('x-old')).toBeNull();
  });

  it('excludes Proxy-Authorization from every layer without suppressing valid overlays', () => {
    const emptyState = createState();
    expect(compose(emptyState, { 'Proxy-Authorization': 'Basic base-only' }).get('proxy-authorization')).toBeNull();
    expect(compose(emptyState, {}, { 'Proxy-Authorization': 'Basic destination-only' }).get('proxy-authorization')).toBeNull();

    const persistentOnly = stage(
      emptyState,
      '/persistent',
      ABSENT,
      present({ 'Proxy-Authorization': 'Basic persistent-only' }),
    ).state;
    expect(compose(persistentOnly).get('proxy-authorization')).toBeNull();

    const oneHopOnly = stage(
      emptyState,
      '/one-hop',
      present({ 'Proxy-Authorization': 'Basic one-hop-only' }),
    ).state;
    expect(compose(oneHopOnly).get('proxy-authorization')).toBeNull();

    const state = stage(
      createState(),
      '/one',
      present({
        'pRoXy-AuThOrIzAtIoN': 'Basic one-hop',
        Authorization: 'Bearer allowed',
      }),
      present({ 'PROXY-AUTHORIZATION': 'Basic persistent', 'X-Persistent': 'yes' }),
    ).state;
    const headers = compose(
      state,
      { 'Proxy-Authorization': 'Basic base' },
      { 'proxy-authorization': 'Basic destination' },
    );

    expect(headers.get('proxy-authorization')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer allowed');
    expect(headers.get('x-persistent')).toBe('yes');
  });

  it('returns recursively immutable state and patch views', () => {
    const state = stage(
      createState(),
      '/one',
      present({ 'X-One-Hop': ['one', 'two'] }),
      present({ 'X-Persistent': ['three', 'four'] }),
    ).state;

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.history)).toBe(true);
    expect(Object.isFrozen(state.persistent)).toBe(true);
    expect(Object.isFrozen(state.persistent?.patch)).toBe(true);
    expect(Object.isFrozen(state.oneHop)).toBe(true);
    const operation = state.oneHop?.get('x-one-hop');
    expect(Object.isFrozen(operation)).toBe(true);
    if (operation?.kind === 'set') expect(Object.isFrozen(operation.values)).toBe(true);

    const oneHopEntry = [...(state.oneHop?.entries() ?? [])][0];
    const persistentEntry = [...(state.persistent?.patch.entries() ?? [])][0];
    expect(Object.isFrozen(oneHopEntry)).toBe(true);
    expect(Object.isFrozen(persistentEntry)).toBe(true);
    expect(Object.isFrozen(persistentEntry?.[1])).toBe(true);
    if (persistentEntry?.[1].kind === 'set') {
      expect(Object.isFrozen(persistentEntry[1].values)).toBe(true);
      expect(Reflect.set(persistentEntry[1].values, 0, 'mutated')).toBe(false);
    }
    expect(Reflect.set(oneHopEntry, 0, 'mutated')).toBe(false);
    const headers = compose(state);
    expect(headers.get('x-one-hop')).toBe('one, two');
    expect(headers.get('x-persistent')).toBe('three, four');
  });

  it('accepts portable scalar numbers, HTAB, and Latin-1 values', () => {
    const state = stage(
      createState(),
      '/one',
      present({
        'X-Number': 42,
        'X-Tab': 'left\tright',
        'X-Latin-One': '\x80ÿ',
      }),
    ).state;
    const headers = compose(state);

    expect(headers.get('x-number')).toBe('42');
    expect(headers.get('x-tab')).toBe('left\tright');
    expect(headers.get('x-latin-one')).toBe('\x80ÿ');
  });
});

describe.skipIf(policyModule === undefined)('Phase 1c-a U2 transactional staging', () => {
  it.each([
    ['malformed', 'http://[::1'],
    ['unsupported scheme', 'ftp://a.test/file'],
    ['un-normalized userinfo', 'https://user:pass@a.test/next'],
  ] as const)('rejects %s finalized URLs without committing state', (_name, destination) => {
    const current = stage(
      createState(),
      '/one',
      present({ 'X-One-Hop': 'stable' }),
      present({ 'X-Persistent': 'stable' }),
    ).state;
    const before = compose(current).toObject();
    const result = requirePolicy().stageRedirectHeaderTransition(current, {
      finalizedNormalizedUrl: destination,
      setHeaders: present({ 'X-New': 'new' }),
      setHeadersOnRedirects: present({ 'X-New-Persistent': 'new' }),
    });

    expect(result).toEqual({ ok: false, reason: 'invalid-url' });
    expect(Reflect.ownKeys(result)).toEqual(['ok', 'reason']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(current.currentUrl).toBe('https://a.test/one');
    expect(current.redirectCount).toBe(1);
    expect(current.history).toEqual(['https://a.test/start', 'https://a.test/one']);
    expect(compose(current).toObject()).toEqual(before);
  });

  it.each([
    ['invalid name', { 'Bad Header': 'value' }],
    ['newline value', { 'X-Test': 'safe\r\ninjected' }],
    ['SOH control value', { 'X-Test': 'safe\x01value' }],
    ['vertical-tab control value', { 'X-Test': 'safe\x0bvalue' }],
    ['form-feed control value', { 'X-Test': 'safe\x0cvalue' }],
    ['unit-separator control value', { 'X-Test': 'safe\x1fvalue' }],
    ['DEL control value', { 'X-Test': 'safe\x7fvalue' }],
    ['non-Latin-1 value', { 'X-Test': '€' }],
    ['unpaired surrogate value', { 'X-Test': '\ud800' }],
    ['malformed array', { 'X-Test': ['safe', 42] }],
    ['top-level undefined', undefined],
  ] as const)('rejects %s patches atomically', (_name, value) => {
    const current = stage(
      createState(),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'stable' }),
    ).state;
    const before = compose(current).toObject();
    const result = requirePolicy().stageRedirectHeaderTransition(current, {
      finalizedNormalizedUrl: '/two',
      setHeaders: present({ 'X-Valid-First': 'must-not-commit' }),
      setHeadersOnRedirects: present(value),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid-header-patch',
      field: 'setHeadersOnRedirects',
    });
    expect(Reflect.ownKeys(result)).toEqual(['ok', 'reason', 'field']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(current.currentUrl).toBe('https://a.test/one');
    expect(current.redirectCount).toBe(1);
    expect(compose(current).toObject()).toEqual(before);
  });

  it('contains throwing iterables and exposes no raw cause or carrier', () => {
    const throwingIterable = {
      *[Symbol.iterator](): IterableIterator<readonly [string, string]> {
        yield ['X-First', 'must-not-commit'];
        throw new Error('secret iterator failure');
      },
    };
    const current = createState();
    const result = requirePolicy().stageRedirectHeaderTransition(current, {
      finalizedNormalizedUrl: '/one',
      setHeaders: present(throwingIterable),
      setHeadersOnRedirects: ABSENT,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid-header-patch',
      field: 'setHeaders',
    });
    expect(Reflect.ownKeys(result)).toEqual(['ok', 'reason', 'field']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(current.currentUrl).toBe('https://a.test/start');
    expect(current.redirectCount).toBe(0);
    expect(current.history).toEqual(['https://a.test/start']);
  });

  it('closes a generic iterator when patch validation aborts iteration', () => {
    let iteratorReads = 0;
    let cleanupCalls = 0;
    let advancedPastInvalid = 0;
    const carrier = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(carrier, Symbol.iterator, {
      get() {
        iteratorReads++;
        return function* headerEntries() {
          try {
            yield ['X-First', 'must-not-commit'] as const;
            yield ['Bad Header', 'invalid'] as const;
            advancedPastInvalid++;
            yield ['X-After-Invalid', 'must-not-read'] as const;
          } finally {
            cleanupCalls++;
          }
        };
      },
    });
    const current = createState();
    const result = requirePolicy().stageRedirectHeaderTransition(current, {
      finalizedNormalizedUrl: '/one',
      setHeaders: present(carrier),
      setHeadersOnRedirects: ABSENT,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid-header-patch',
      field: 'setHeaders',
    });
    expect(Reflect.ownKeys(result)).toEqual(['ok', 'reason', 'field']);
    expect(iteratorReads).toBe(1);
    expect(cleanupCalls).toBe(1);
    expect(advancedPastInvalid).toBe(0);
    expect(current.currentUrl).toBe('https://a.test/start');
    expect(current.redirectCount).toBe(0);
  });

  it('accepts callable iterator objects and iterator-result objects', () => {
    let iteratorReads = 0;
    let index = 0;
    const callableIterator = Object.assign(function iteratorObject() {}, {
      next: () => Object.assign(function iteratorResult() {}, {
        done: index++ > 0,
        value: ['X-Callable', 'callable-value'] as const,
      }),
    });
    const carrier = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(carrier, Symbol.iterator, {
      get() {
        iteratorReads++;
        return () => callableIterator;
      },
    });

    const state = stage(createState(), '/one', present(carrier)).state;
    expect(iteratorReads).toBe(1);
    expect(compose(state).get('x-callable')).toBe('callable-value');
  });

  it('commits canonical URL, count, history, and patch state exactly once per staged result', () => {
    const current = createState('https://A.test:443/start');
    const result = stage(
      current,
      '/next',
      present({ 'X-One-Hop': 'yes' }),
      present({ 'X-Persistent': 'yes' }),
    );
    const committed = result.state;

    expect(current.currentUrl).toBe('https://a.test/start');
    expect(current.redirectCount).toBe(0);
    expect(current.history).toEqual(['https://a.test/start']);
    expect(committed.currentUrl).toBe('https://a.test/next');
    expect(committed.redirectCount).toBe(1);
    expect(committed.history).toEqual(['https://a.test/start', 'https://a.test/next']);
    expect(committed.persistent?.anchorOrigin).toBe('https://a.test');
    expect(compose(committed).get('x-one-hop')).toBe('yes');
    expect(compose(committed).get('x-persistent')).toBe('yes');

    const sameResultReused = result.state;
    expect(sameResultReused).toBe(committed);
    expect(sameResultReused.redirectCount).toBe(1);
    expect(sameResultReused.history).toHaveLength(2);
  });
});
