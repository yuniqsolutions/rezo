import { RezoHeaders } from '../src/utils/headers.ts';
import {
  composeRedirectHeaders,
  createRedirectHeaderPolicyState,
  stageRedirectHeaderTransition,
  type RedirectHeaderField,
  type RedirectHeaderPolicyState,
  type RedirectHeaderPolicyTransitionResult,
} from '../src/utils/redirect-header-policy.ts';

interface RuntimeErrorModule {
  readonly ERROR_INFO: Record<string, {
    readonly code: number;
  }>;
  readonly RezoErrorCode: Record<string, string>;
  readonly RezoError: new (
    message: string,
    config: object,
    code: string,
  ) => {
    readonly errno?: number;
    readonly isRetryable: boolean;
  };
}

const publicModulePath = '../src/' + 'index.ts';
const errorModulePath = '../src/errors/' + 'rezo-error.ts';
const publicApi = await import(publicModulePath) as Record<string, unknown>;
const {
  ERROR_INFO,
  RezoError,
  RezoErrorCode,
} = await import(errorModulePath) as unknown as RuntimeErrorModule;

const ABSENT = Object.freeze({ kind: 'absent' } as const);
const present = (value: unknown): RedirectHeaderField =>
  Object.freeze({ kind: 'present', value });

let assertionCount = 0;
const EXPECTED_ASSERTION_COUNT = 165;

function assert(condition: unknown, message: string): asserts condition {
  assertionCount++;
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assertionCount++;
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
  }
}

function createState(initialUrl = 'https://a.test/start'): RedirectHeaderPolicyState {
  const result = createRedirectHeaderPolicyState(initialUrl);
  assert(result.ok, `policy init failed for ${initialUrl}`);
  return result.state;
}

function stage(
  current: RedirectHeaderPolicyState,
  finalizedNormalizedUrl: string | URL,
  setHeaders: RedirectHeaderField = ABSENT,
  setHeadersOnRedirects: RedirectHeaderField = ABSENT,
): Extract<RedirectHeaderPolicyTransitionResult, { readonly ok: true }> {
  const result = stageRedirectHeaderTransition(current, {
    finalizedNormalizedUrl,
    setHeaders,
    setHeadersOnRedirects,
  });
  assert(result.ok, `policy transition failed for ${String(finalizedNormalizedUrl)}`);
  return result;
}

function compose(
  state: RedirectHeaderPolicyState,
  targetBase: RezoHeaders | Record<string, string> = {},
  destinationHeaders: RezoHeaders | Record<string, string> = {},
): RezoHeaders {
  return composeRedirectHeaders(state, {
    targetBase: targetBase instanceof RezoHeaders
      ? targetBase
      : new RezoHeaders(targetBase),
    destinationHeaders: destinationHeaders instanceof RezoHeaders
      ? destinationHeaders
      : new RezoHeaders(destinationHeaders),
  });
}

Deno.test('Phase 1c-a native Deno policy and error parity', () => {
  assert(typeof createRedirectHeaderPolicyState === 'function', 'missing create helper');
  assert(typeof stageRedirectHeaderTransition === 'function', 'missing stage helper');
  assert(typeof composeRedirectHeaders === 'function', 'missing compose helper');
  assert(!('createRedirectHeaderPolicyState' in publicApi), 'policy helper leaked from root');
  assert(!('stageRedirectHeaderTransition' in publicApi), 'stage helper leaked from root');
  assert(!('composeRedirectHeaders' in publicApi), 'compose helper leaked from root');

  const unsupportedMember = (RezoErrorCode as unknown as Record<string, string>)
    .UNSUPPORTED_CAPABILITY;
  equal(unsupportedMember, 'REZ_UNSUPPORTED_CAPABILITY', 'missing error enum member');
  equal(ERROR_INFO.REZ_UNSUPPORTED_CAPABILITY.code, -1075, 'wrong capability errno');
  const error = new RezoError(
    'Deno Fetch cannot enforce redirect capability "beforeRedirect" before dispatch.',
    {},
    'REZ_UNSUPPORTED_CAPABILITY',
  );
  equal(error.errno, -1075, 'constructed errno mismatch');
  equal(error.isRetryable, false, 'capability error must be non-retryable');

  const values = ['persistent-one'];
  const persistentInput: Record<string, string | string[] | undefined> = {
    'X-Mixed': values,
    'x-mixed': 'persistent-two',
    'X-Deleted': undefined,
  };
  const oneHopInput = new RezoHeaders({ 'X-One-Hop': 'one-hop-before' });
  const initial = createState();
  const immutableState = stage(
    initial,
    '/one',
    present(oneHopInput),
    present(persistentInput),
  ).state;
  values[0] = 'mutated-array';
  persistentInput['X-Mixed'] = 'mutated-record';
  oneHopInput.set('X-One-Hop', 'mutated-headers');
  const immutableHeaders = compose(immutableState, { 'X-Deleted': 'base' });
  equal(immutableHeaders.get('x-mixed'), 'persistent-one, persistent-two', 'snapshot changed');
  equal(immutableHeaders.get('x-one-hop'), 'one-hop-before', 'one-hop snapshot changed');
  equal(immutableHeaders.get('x-deleted'), null, 'tombstone was lost');
  equal(initial.currentUrl, 'https://a.test/start', 'initial URL mutated');

  let iteratorReads = 0;
  const record = { 'X-Record': 'record-value' };
  Object.defineProperty(record, Symbol.iterator, {
    get() {
      iteratorReads++;
      throw new Error('must not read record iterator');
    },
  });
  const recordState = stage(createState(), '/one', present(record)).state;
  equal(iteratorReads, 0, 'plain-record iterator getter was read');
  equal(compose(recordState).get('x-record'), 'record-value', 'plain record was not applied');

  let genericIteratorReads = 0;
  const iterableCarrier = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperty(iterableCarrier, Symbol.iterator, {
    get() {
      genericIteratorReads++;
      if (genericIteratorReads > 1) throw new Error('iterator accessor read twice');
      return function* headerEntries() {
        yield ['X-Iterable', 'iterable-value'] as const;
      };
    },
  });
  const iterableState = stage(createState(), '/one', present(iterableCarrier)).state;
  equal(genericIteratorReads, 1, 'generic iterator accessor was read more than once');
  equal(compose(iterableState).get('x-iterable'), 'iterable-value', 'generic iterable was not applied');

  const layeredState = stage(
    createState(),
    '/one',
    present({ 'X-Collision': 'one-hop', 'X-One-Hop': 'yes' }),
    present({ 'X-Collision': 'persistent', 'X-Persistent': 'yes' }),
  ).state;
  const base = new RezoHeaders({ 'X-Collision': 'base', 'X-Base': 'yes' });
  const destination = new RezoHeaders({ 'X-Collision': 'destination', 'X-Destination': 'yes' });
  const baseBefore = [...base.entries()];
  const destinationBefore = [...destination.entries()];
  const firstAttempt = compose(layeredState, base, destination);
  assert(firstAttempt !== base && firstAttempt !== destination, 'composition aliased a lower layer');
  firstAttempt.set('X-Collision', 'mutated-output');
  const retryAttempt = compose(layeredState, base, destination);
  equal(retryAttempt.get('x-collision'), 'one-hop', 'one-hop precedence/retry failed');
  equal([...base.entries()], baseBefore, 'target base mutated');
  equal([...destination.entries()], destinationBefore, 'destination layer mutated');
  const laterRedirect = stage(layeredState, '/two').state;
  equal(compose(laterRedirect, base, destination).get('x-collision'), 'persistent', 'one-hop did not expire');
  equal(compose(laterRedirect).get('x-one-hop'), null, 'one-hop survived a redirect');

  const tombstoneState = stage(
    createState(),
    '/one',
    present({ 'X-Base': undefined, 'X-Persistent': [] }),
    present({ 'X-Destination': undefined, 'X-Persistent': 'persistent' }),
  ).state;
  const tombstoneHeaders = compose(
    tombstoneState,
    { 'X-Base': 'base' },
    { 'X-Destination': 'destination' },
  );
  equal(tombstoneHeaders.get('x-base'), null, 'undefined tombstone failed');
  equal(tombstoneHeaders.get('x-destination'), null, 'destination tombstone failed');
  equal(tombstoneHeaders.get('x-persistent'), null, 'array tombstone failed');
  const sequential = stage(
    createState(),
    '/one',
    present([
      ['X-Sequential', 'one'],
      ['x-sequential', undefined],
      ['X-Sequential', 'two'],
    ]),
  ).state;
  equal(compose(sequential).get('x-sequential'), 'two', 'value after tombstone did not restart');
  const finalTombstone = stage(
    createState(),
    '/one',
    present([
      ['X-Sequential', 'one'],
      ['x-sequential', []],
    ]),
  ).state;
  equal(compose(finalTombstone).get('x-sequential'), null, 'final sequential tombstone failed');

  const established = stage(
    createState(),
    '/one',
    ABSENT,
    present({ 'X-Old': 'old' }),
  ).state;
  const retained = stage(established, '/two').state;
  equal(compose(retained).get('x-old'), 'old', 'absent persistent field did not retain');
  const cleared = stage(retained, '/three', ABSENT, present({})).state;
  equal(cleared.persistent, null, 'empty persistent field did not clear');
  const replaced = stage(retained, '/four', ABSENT, present({ 'X-New': 'new' })).state;
  equal(compose(replaced).get('x-old'), null, 'persistent replacement merged old state');
  equal(compose(replaced).get('x-new'), 'new', 'persistent replacement missing');

  const originCases = [
    ['https://a.test:443/two', 'same-origin', true],
    ['https://b.test/two', 'cross-origin', false],
    ['https://a.test:444/two', 'cross-origin', false],
    ['http://a.test/two', 'downgrade', false],
  ] as const;
  for (const [url, expectedRelation, retainedExpected] of originCases) {
    const source = stage(
      createState(),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'yes' }),
    ).state;
    const result = stage(source, url);
    equal(result.relation, expectedRelation, `wrong relation for ${url}`);
    equal(result.state.persistent !== null, retainedExpected, `wrong persistence for ${url}`);
  }
  const upgraded = stage(
    stage(
      createState('http://a.test/start'),
      '/one',
      ABSENT,
      present({ 'X-Persistent': 'yes' }),
    ).state,
    'https://a.test/two',
  );
  equal(upgraded.relation, 'cross-origin', 'scheme upgrade incorrectly exempted');
  equal(upgraded.state.persistent, null, 'persistence survived scheme upgrade');

  const atA = stage(
    createState(),
    '/one',
    ABSENT,
    present({ 'X-Persistent': 'from-a' }),
  ).state;
  const atB = stage(atA, 'https://b.test/two').state;
  const backAtA = stage(atB, 'https://a.test/three').state;
  equal(atB.persistent, null, 'persistence survived A to B');
  equal(backAtA.persistent, null, 'persistence revived on A to B to A');

  const reestablishedAtB = stage(
    atA,
    'https://b.test/two',
    ABSENT,
    present({ 'X-Persistent': 'from-b' }),
  ).state;
  const stillAtB = stage(reestablishedAtB, 'https://b.test/three').state;
  equal(reestablishedAtB.persistent?.anchorOrigin, 'https://b.test', 'fresh anchor used source');
  equal(compose(stillAtB).get('x-persistent'), 'from-b', 'fresh B persistence did not survive');

  const downgraded = stage(
    atA,
    'http://a.test/two',
    present({ Authorization: 'Bearer one-hop' }),
    present({ Cookie: 'fresh=one', 'X-Fresh': 'yes' }),
  );
  const downgradedHeaders = compose(downgraded.state);
  equal(downgradedHeaders.get('authorization'), 'Bearer one-hop', 'fresh downgrade auth missing');
  equal(downgradedHeaders.get('cookie'), 'fresh=one', 'fresh downgrade cookie missing');
  equal(downgradedHeaders.get('x-persistent'), null, 'old authority crossed downgrade');

  const proxyState = stage(
    createState(),
    '/one',
    present({ 'Proxy-Authorization': 'Basic one-hop', Authorization: 'Bearer allowed' }),
    present({ 'PROXY-AUTHORIZATION': 'Basic persistent', 'X-Persistent': 'yes' }),
  ).state;
  const emptyProxyState = createState();
  equal(
    compose(emptyProxyState, { 'Proxy-Authorization': 'Basic base-only' }).get('proxy-authorization'),
    null,
    'base-only proxy authorization reached origin',
  );
  equal(
    compose(emptyProxyState, {}, { 'Proxy-Authorization': 'Basic destination-only' }).get('proxy-authorization'),
    null,
    'destination-only proxy authorization reached origin',
  );
  const persistentProxyOnly = stage(
    emptyProxyState,
    '/persistent',
    ABSENT,
    present({ 'Proxy-Authorization': 'Basic persistent-only' }),
  ).state;
  equal(compose(persistentProxyOnly).get('proxy-authorization'), null, 'persistent proxy authorization reached origin');
  const oneHopProxyOnly = stage(
    emptyProxyState,
    '/one-hop',
    present({ 'Proxy-Authorization': 'Basic one-hop-only' }),
  ).state;
  equal(compose(oneHopProxyOnly).get('proxy-authorization'), null, 'one-hop proxy authorization reached origin');
  const proxyHeaders = compose(
    proxyState,
    { 'Proxy-Authorization': 'Basic base' },
    { 'proxy-authorization': 'Basic destination' },
  );
  equal(proxyHeaders.get('proxy-authorization'), null, 'proxy authorization reached origin');
  equal(proxyHeaders.get('authorization'), 'Bearer allowed', 'valid overlay was suppressed');

  assert(Object.isFrozen(proxyState), 'state is mutable');
  assert(Object.isFrozen(proxyState.history), 'history is mutable');
  assert(Object.isFrozen(proxyState.persistent), 'persistent state is mutable');
  assert(Object.isFrozen(proxyState.persistent?.patch), 'persistent patch is mutable');
  const persistentEntry = [...(proxyState.persistent?.patch.entries() ?? [])][0];
  assert(Object.isFrozen(persistentEntry), 'patch entry tuple is mutable');
  assert(Object.isFrozen(persistentEntry?.[1]), 'patch operation is mutable');

  const portableState = stage(
    createState(),
    '/one',
    present({ 'X-Number': 42, 'X-Tab': 'left\tright', 'X-Latin-One': '\x80ÿ' }),
  ).state;
  const portableHeaders = compose(portableState);
  equal(portableHeaders.get('x-number'), '42', 'scalar number rejected');
  equal(portableHeaders.get('x-tab'), 'left\tright', 'HTAB rejected');
  equal(portableHeaders.get('x-latin-one'), '\x80ÿ', 'Latin-1 rejected');

  for (const url of ['http://[::1', 'ftp://a.test/file', 'https://user:pass@a.test/next']) {
    const current = established;
    const failure = stageRedirectHeaderTransition(current, {
      finalizedNormalizedUrl: url,
      setHeaders: present({ 'X-New': 'new' }),
      setHeadersOnRedirects: ABSENT,
    });
    equal(failure, { ok: false, reason: 'invalid-url' }, `invalid URL accepted: ${url}`);
    equal(Reflect.ownKeys(failure), ['ok', 'reason'], 'invalid URL failure leaked fields');
    equal(current.currentUrl, 'https://a.test/one', 'invalid URL committed state');
  }

  const invalidPatches = [
    { 'Bad Header': 'value' },
    { 'X-Test': 'safe\r\ninjected' },
    { 'X-Test': 'safe\x01value' },
    { 'X-Test': 'safe\x7fvalue' },
    { 'X-Test': '€' },
    { 'X-Test': '\ud800' },
    { 'X-Test': ['safe', 42] },
    undefined,
  ];
  for (const value of invalidPatches) {
    const failure = stageRedirectHeaderTransition(established, {
      finalizedNormalizedUrl: '/two',
      setHeaders: ABSENT,
      setHeadersOnRedirects: present(value),
    });
    equal(failure, {
      ok: false,
      reason: 'invalid-header-patch',
      field: 'setHeadersOnRedirects',
    }, 'invalid patch accepted');
    equal(Reflect.ownKeys(failure), ['ok', 'reason', 'field'], 'patch failure leaked fields');
    equal(compose(established).get('x-old'), 'old', 'invalid patch changed prior state');
  }

  const throwingIterable = {
    *[Symbol.iterator](): IterableIterator<readonly [string, string]> {
      yield ['X-First', 'must-not-commit'];
      throw new Error('secret iterator failure');
    },
  };
  const iteratorFailure = stageRedirectHeaderTransition(initial, {
    finalizedNormalizedUrl: '/one',
    setHeaders: present(throwingIterable),
    setHeadersOnRedirects: ABSENT,
  });
  equal(iteratorFailure, {
    ok: false,
    reason: 'invalid-header-patch',
    field: 'setHeaders',
  }, 'throwing iterable escaped');
  equal(Reflect.ownKeys(iteratorFailure), ['ok', 'reason', 'field'], 'iterator cause leaked');

  let cleanupIteratorReads = 0;
  let cleanupCalls = 0;
  let advancedPastInvalid = 0;
  const cleanupCarrier = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperty(cleanupCarrier, Symbol.iterator, {
    get() {
      cleanupIteratorReads++;
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
  const cleanupFailure = stageRedirectHeaderTransition(initial, {
    finalizedNormalizedUrl: '/one',
    setHeaders: present(cleanupCarrier),
    setHeadersOnRedirects: ABSENT,
  });
  equal(cleanupFailure, {
    ok: false,
    reason: 'invalid-header-patch',
    field: 'setHeaders',
  }, 'invalid iterator entry did not produce fixed failure');
  equal(Reflect.ownKeys(cleanupFailure), ['ok', 'reason', 'field'], 'iterator cleanup failure leaked fields');
  equal(cleanupIteratorReads, 1, 'cleanup carrier iterator accessor was read more than once');
  equal(cleanupCalls, 1, 'iterator was not closed after validation failure');
  equal(advancedPastInvalid, 0, 'iterator advanced past the invalid entry before validation');
  equal(initial.currentUrl, 'https://a.test/start', 'iterator failure committed state');

  let callableIteratorReads = 0;
  let callableIndex = 0;
  const callableIterator = Object.assign(function iteratorObject() {}, {
    next: () => Object.assign(function iteratorResult() {}, {
      done: callableIndex++ > 0,
      value: ['X-Callable', 'callable-value'] as const,
    }),
  });
  const callableCarrier = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperty(callableCarrier, Symbol.iterator, {
    get() {
      callableIteratorReads++;
      return () => callableIterator;
    },
  });
  const callableState = stage(createState(), '/one', present(callableCarrier)).state;
  equal(callableIteratorReads, 1, 'callable carrier iterator accessor was read more than once');
  equal(compose(callableState).get('x-callable'), 'callable-value', 'callable iterator was rejected');

  const committed = stage(
    createState('https://A.test:443/start'),
    '/next',
    present({ 'X-One-Hop': 'yes' }),
    present({ 'X-Persistent': 'yes' }),
  ).state;
  equal(committed.currentUrl, 'https://a.test/next', 'committed URL not canonical');
  equal(committed.redirectCount, 1, 'redirect count not incremented exactly once');
  equal(committed.history, ['https://a.test/start', 'https://a.test/next'], 'history commit mismatch');
  equal(committed.persistent?.anchorOrigin, 'https://a.test', 'persistent anchor mismatch');

  if (assertionCount !== EXPECTED_ASSERTION_COUNT) {
    throw new Error(
      `Deno assertion count changed: expected ${EXPECTED_ASSERTION_COUNT}, received ${assertionCount}`,
    );
  }
  console.log(`DENO_NATIVE_PHASE1C_A_OK ${assertionCount} ${Deno.version.deno}`);
});
