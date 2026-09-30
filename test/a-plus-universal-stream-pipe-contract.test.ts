// Universal stream pipe contract — the shared `UniversalStreamResponse.pipe`
// destination semantics every adapter's stream facade inherits (RF-06 shared
// seam). RED-first: SP-01 and SP-06 are red on the double-end bytes and flip
// green with the per-pipe idempotence guard; the controls pin the behaviour
// the guard must not disturb (finish-only, done-only, `end: false`, error
// destruction with identity).
import { describe, expect, it } from 'vitest';
import { StreamResponse } from '../src/responses/universal/stream.js';

interface CountingDestination {
  chunks: unknown[];
  ends: number;
  destroys: number;
  destroyErrors: unknown[];
  write(chunk: unknown): boolean;
  end(): void;
  destroy(error?: unknown): void;
}

function createDestination(): CountingDestination {
  return {
    chunks: [],
    ends: 0,
    destroys: 0,
    destroyErrors: [],
    write(chunk: unknown) { this.chunks.push(chunk); return true; },
    end() { this.ends += 1; },
    destroy(error?: unknown) { this.destroys += 1; this.destroyErrors.push(error); },
  };
}

const finishEvent = Object.freeze({ status: 200, statusText: 'OK', finalUrl: 'https://stream.pipe.rezo.test/' });

// The success trio exactly as the adapters publish it: finish and done both
// carry the event payload, complete closes the family, _markFinished() is the
// sole authoritative finished marker.
function publishSuccessTrio(stream: StreamResponse): void {
  stream.emit('finish', finishEvent);
  stream.emit('done', finishEvent);
  stream.emit('complete', finishEvent);
  stream._markFinished();
}

describe('universal stream pipe contract', () => {
  it('SP-01 two piped destinations each end exactly once on the success trio', () => {
    const stream = new StreamResponse();
    const first = createDestination();
    const second = createDestination();
    stream.pipe(first as never);
    stream.pipe(second as never);
    stream.write('payload');
    publishSuccessTrio(stream);
    expect({ first: first.ends, second: second.ends, destroys: first.destroys + second.destroys })
      .toEqual({ first: 1, second: 1, destroys: 0 });
  });

  it('SP-02 a finish-only producer still ends the destination exactly once', () => {
    const stream = new StreamResponse();
    const target = createDestination();
    stream.pipe(target as never);
    stream.emit('finish', finishEvent);
    stream._markFinished();
    expect(target.ends).toBe(1);
  });

  it('SP-03 a done-only producer still ends the destination exactly once', () => {
    const stream = new StreamResponse();
    const target = createDestination();
    stream.pipe(target as never);
    stream.emit('done', finishEvent);
    stream._markFinished();
    expect(target.ends).toBe(1);
  });

  it('SP-04 `end: false` receives data and is never ended', () => {
    const stream = new StreamResponse();
    const target = createDestination();
    stream.pipe(target as never, { end: false });
    stream.write('kept-open');
    publishSuccessTrio(stream);
    expect({ chunks: target.chunks, ends: target.ends }).toEqual({ chunks: ['kept-open'], ends: 0 });
  });

  it('SP-05 an error destroys every destination exactly once with the exact error identity and never ends it', () => {
    const stream = new StreamResponse();
    const first = createDestination();
    const second = createDestination();
    stream.pipe(first as never);
    stream.pipe(second as never);
    const failure = new Error('wire reset');
    stream.emit('error', failure);
    expect({
      firstDestroys: first.destroys, secondDestroys: second.destroys,
      firstIdentity: first.destroyErrors[0] === failure, secondIdentity: second.destroyErrors[0] === failure,
      ends: first.ends + second.ends,
    }).toEqual({ firstDestroys: 1, secondDestroys: 1, firstIdentity: true, secondIdentity: true, ends: 0 });
  });

  it('SP-06 a throwing destination end() is invoked exactly once across the success trio', () => {
    const stream = new StreamResponse();
    let endInvocations = 0;
    const throwing = {
      write() { return true; },
      end() { endInvocations += 1; throw new Error('destination end failed'); },
      destroy() {},
    };
    stream.pipe(throwing as never);
    publishSuccessTrio(stream);
    expect(endInvocations).toBe(1);
  });
});
