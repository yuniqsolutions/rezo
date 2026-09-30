import { afterEach, describe, expect, it, vi } from 'vitest';

import { UniversalStreamResponse } from '../src/responses/universal/stream.js';

const REPLAYABLE = ['initiated', 'start', 'headers', 'status', 'cookies'] as const;

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

describe('Phase 1c-c universal stream once() late-attach replay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(REPLAYABLE)(
    'replays one buffered %s event to a late once() listener',
    (event) => {
      const stream = new UniversalStreamResponse();
      const hits: unknown[][] = [];
      const payload = event === 'status' ? [200, 'OK'] : [{ kind: event }];

      expect(stream.emit(event, ...payload)).toBe(false);
      stream.once(event, (...args: unknown[]) => {
        hits.push(args);
      });

      expect(hits).toEqual([payload]);
    },
  );

  it('control: once() attached before emit still fires exactly once', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    stream.once('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(stream.emit('headers', { status: 200 })).toBe(true);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    expect(hits).toEqual([200]);
  });

  it('control: late on() still replays the full same-name buffer', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    stream.on('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(hits).toEqual([200, 201]);
  });

  it('control: late addListener drains the complete same-name buffer in order', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    stream.addListener('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(hits).toEqual([200, 201]);
  });

  it('late prependOnceListener replays only chronological-first and ignores the next live event', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    stream.prependOnceListener('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(hits).toEqual([200]);
    expect(stream.emit('headers', { status: 202 })).toBe(false);
    expect(hits).toEqual([200]);
  });

  it('does not double-fire: late once() consumes the buffer and ignores the next live emit', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    stream.once('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(hits).toEqual([200]);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    expect(hits).toEqual([200]);
  });

  it('replays the chronological-first buffered headers args and discards the rest', () => {
    const stream = new UniversalStreamResponse();
    const hits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    stream.once('headers', (info: { status: number }) => {
      hits.push(info.status);
    });
    expect(hits).toEqual([200]);
  });

  it('once-then-on: once consumes and discards the buffer; on sees only later live events', () => {
    const stream = new UniversalStreamResponse();
    const onceHits: number[] = [];
    const onHits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(stream.emit('headers', { status: 201 })).toBe(false);
    stream.once('headers', (info: { status: number }) => {
      onceHits.push(info.status);
    });
    stream.on('headers', (info: { status: number }) => {
      onHits.push(info.status);
    });
    expect(onceHits).toEqual([200]);
    expect(onHits).toEqual([]);
    expect(stream.emit('headers', { status: 202 })).toBe(true);
    expect(onceHits).toEqual([200]);
    expect(onHits).toEqual([202]);
  });

  it('on-then-once: on drains the buffer; once sees only later live events', () => {
    const stream = new UniversalStreamResponse();
    const onHits: number[] = [];
    const onceHits: number[] = [];
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    stream.on('headers', (info: { status: number }) => {
      onHits.push(info.status);
    });
    stream.once('headers', (info: { status: number }) => {
      onceHits.push(info.status);
    });
    expect(onHits).toEqual([200]);
    expect(onceHits).toEqual([]);
    expect(stream.emit('headers', { status: 201 })).toBe(true);
    expect(onHits).toEqual([200, 201]);
    expect(onceHits).toEqual([201]);
  });

  it('observes a rejecting thenable returned from late once() replay without a global leak', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stream = new UniversalStreamResponse();
    const replayError = new Error('late-once replay thenable sentinel');
    const processUnhandled: unknown[] = [];
    const globalUnhandled: unknown[] = [];
    let assimilations = 0;
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
      expect(stream.emit('headers', { status: 200 })).toBe(false);
      stream.once('headers', (() => rejectingThenable(
        replayError,
        () => assimilations++,
      )) as () => void);
      await flushPromiseReactions();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onProcessUnhandled);
      globalThis.removeEventListener?.('unhandledrejection', onGlobalUnhandled);
    }

    expect(assimilations).toBe(1);
    expect(diagnostic).toHaveBeenCalledWith(
      'EventEmitter once listener error:',
      replayError,
    );
    expect(processUnhandled).toEqual([]);
    expect(globalUnhandled).toEqual([]);
  });

  it('contains a synchronous throw from late once() replay', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stream = new UniversalStreamResponse();
    const syncError = new Error('late-once replay sync sentinel');
    expect(stream.emit('headers', { status: 200 })).toBe(false);
    expect(() => {
      stream.once('headers', () => {
        throw syncError;
      });
    }).not.toThrow();
    expect(diagnostic).toHaveBeenCalledWith(
      'EventEmitter once listener error:',
      syncError,
    );
  });
});
