import { afterEach, describe, expect, it, vi } from 'vitest';

import { UniversalEventEmitter } from '../src/responses/universal/event-emitter.js';
import { UniversalStreamResponse } from '../src/responses/universal/stream.js';

function rejectingThenable(error: Error, onAssimilate: () => void): PromiseLike<void> {
  return {
    then(_resolve, reject): PromiseLike<never> {
      onAssimilate();
      reject?.(error);
      return undefined as unknown as PromiseLike<never>;
    },
  };
}

async function flushPromiseReactions(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Phase 1c-c universal event listener rejection containment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('observes rejecting thenables from regular and once listeners while preserving emit order', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emitter = new UniversalEventEmitter();
    const regularError = new Error('regular async listener sentinel');
    const onceError = new Error('once async listener sentinel');
    const calls: string[] = [];
    let regularAssimilations = 0;
    let onceAssimilations = 0;

    emitter.on('packet', (() => {
      calls.push('regular');
      return rejectingThenable(regularError, () => regularAssimilations++);
    }) as () => void);
    emitter.once('packet', (() => {
      calls.push('once');
      return rejectingThenable(onceError, () => onceAssimilations++);
    }) as () => void);
    emitter.on('packet', () => calls.push('following'));

    expect(emitter.emit('packet', 1)).toBe(true);
    expect(emitter.emit('packet', 2)).toBe(true);
    expect(calls).toEqual([
      'regular', 'following', 'once',
      'regular', 'following',
    ]);

    await flushPromiseReactions();

    expect(regularAssimilations).toBe(2);
    expect(onceAssimilations).toBe(1);
    expect(diagnostic.mock.calls).toEqual(expect.arrayContaining([
      ['EventEmitter listener error:', regularError],
      ['EventEmitter once listener error:', onceError],
    ]));
  });

  it('reads a one-shot then getter once and observes its intended rejection without a global leak', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emitter = new UniversalEventEmitter();
    const intendedError = new Error('one-shot thenable rejection sentinel');
    const repeatedReadError = new Error('then getter read more than once');
    const processUnhandled: unknown[] = [];
    const globalUnhandled: unknown[] = [];
    let getterReads = 0;
    let thenCalls = 0;

    const onProcessUnhandled = (reason: unknown): void => {
      processUnhandled.push(reason);
    };
    const onGlobalUnhandled = (event: PromiseRejectionEvent): void => {
      globalUnhandled.push(event.reason);
      event.preventDefault();
    };

    process.on('unhandledRejection', onProcessUnhandled);
    globalThis.addEventListener?.('unhandledrejection', onGlobalUnhandled);

    try {
      const thenable = Object.defineProperty({}, 'then', {
        get(): PromiseLike<void>['then'] {
          getterReads++;
          if (getterReads > 1) {
            throw repeatedReadError;
          }
          return (_resolve, reject): PromiseLike<never> => {
            thenCalls++;
            reject?.(intendedError);
            return undefined as unknown as PromiseLike<never>;
          };
        },
      });

      emitter.on('packet', (() => thenable) as () => void);

      expect(emitter.emit('packet')).toBe(true);
      await flushPromiseReactions();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onProcessUnhandled);
      globalThis.removeEventListener?.('unhandledrejection', onGlobalUnhandled);
    }

    expect(getterReads).toBe(1);
    expect(thenCalls).toBe(1);
    expect(diagnostic.mock.calls).toEqual([
      ['EventEmitter listener error:', intendedError],
    ]);
    expect(processUnhandled).toEqual([]);
    expect(globalUnhandled).toEqual([]);
  });

  it('observes a rejecting thenable returned while replaying buffered stream metadata', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stream = new UniversalStreamResponse();
    const replayError = new Error('replay async listener sentinel');
    let assimilations = 0;

    expect(stream.emit('headers', { status: 200 } as never)).toBe(false);
    stream.on('headers', (() => rejectingThenable(
      replayError,
      () => assimilations++,
    )) as () => void);

    await flushPromiseReactions();

    expect(assimilations).toBe(1);
    expect(diagnostic).toHaveBeenCalledWith(
      'EventEmitter listener error:',
      replayError,
    );
  });
});
