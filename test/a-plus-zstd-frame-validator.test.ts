import { describe, expect, it } from 'vitest';
import { zstdCompressSync } from 'node:zlib';
import {
  ZstdFrameValidator,
  validateZstdFrame,
} from '../src/utils/zstd-frame-validator';

// R07-2A direct conformance suite for the private single-frame structural
// validator. Every RFC 8878/9659 rule the pair froze gets a vector; the
// native decoder's authorities (checksum value, dictionary availability,
// compressed-block syntax, FCS equality) are exercised nowhere here.

const PAYLOAD = (() => {
  const buffer = Buffer.allocUnsafe(262_144);
  let state = 0x12345678;
  for (let index = 0; index < buffer.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    buffer[index] = state >>> 24;
  }
  return buffer;
})();
const REAL_FULL = zstdCompressSync(PAYLOAD);
const REAL_SMALL = zstdCompressSync(Buffer.from('R07 compression fixture payload!'));

// Handcrafted minimal frame: magic + descriptor(single-segment, FCS 1B)
// + FCS(3) + raw last block size 3 + 'abc'.
function minimalRawFrame(options?: {
  checksum?: boolean;
  descriptorBit4?: boolean;
  reservedBit3?: boolean;
}): Buffer {
  let descriptor = 0b0010_0000; // single-segment, FCS flag 0 => 1-byte FCS
  if (options?.checksum) descriptor |= 0b0000_0100;
  if (options?.descriptorBit4) descriptor |= 0b0001_0000;
  if (options?.reservedBit3) descriptor |= 0b0000_1000;
  const blockHeaderValue = (3 << 3) | (0 << 1) | 1; // size 3, raw, last
  const parts = [
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
    Buffer.from([descriptor]),
    Buffer.from([0x03]),
    Buffer.from([blockHeaderValue & 0xff, (blockHeaderValue >> 8) & 0xff, (blockHeaderValue >> 16) & 0xff]),
    Buffer.from('abc'),
  ];
  if (options?.checksum) parts.push(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
  return Buffer.concat(parts);
}

function frameWith(descriptor: number, tail: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
    Buffer.from([descriptor]),
    tail,
  ]);
}

describe('real frames', () => {
  it('accepts exactly one real full frame', () => {
    expect(validateZstdFrame(REAL_FULL)).toEqual({ complete: true });
    expect(validateZstdFrame(REAL_SMALL)).toEqual({ complete: true });
  });

  it('reports the truncated prefix incomplete, never complete', () => {
    const verdict = validateZstdFrame(REAL_FULL.subarray(0, 131_084));
    expect(verdict.complete).toBe(false);
    expect(verdict.fault).toBeUndefined();
  });

  it('reports magic-only incomplete', () => {
    const verdict = validateZstdFrame(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
    expect(verdict.complete).toBe(false);
    expect(verdict.fault).toBeUndefined();
  });

  it('is chunking-invariant across arbitrary split points', () => {
    for (const splitAt of [1, 3, 4, 5, 9, 100, REAL_SMALL.length - 1]) {
      const validator = new ZstdFrameValidator();
      validator.update(REAL_SMALL.subarray(0, splitAt));
      validator.update(REAL_SMALL.subarray(splitAt));
      expect(validator.finish()).toEqual({ complete: true });
    }
  });
});

describe('frame-header rules', () => {
  it('rejects reserved descriptor bit 3', () => {
    const verdict = validateZstdFrame(minimalRawFrame({ reservedBit3: true }));
    expect(verdict.fault).toContain('reserved frame-header bit 3');
  });

  it('never interprets unused descriptor bit 4', () => {
    expect(validateZstdFrame(minimalRawFrame({ descriptorBit4: true })))
      .toEqual({ complete: true });
  });

  it('rejects an invalid magic', () => {
    const bad = Buffer.from(minimalRawFrame());
    bad[0] = 0x29;
    expect(validateZstdFrame(bad).fault).toContain('invalid zstd magic');
  });

  it('recognizes then rejects a skippable frame', () => {
    const skippable = Buffer.concat([
      Buffer.from([0x50, 0x2a, 0x4d, 0x18]),
      Buffer.from([0x02, 0x00, 0x00, 0x00]),
      Buffer.from([0x01, 0x02]),
    ]);
    expect(validateZstdFrame(skippable).fault).toContain('skippable frame');
  });
});

describe('RFC 9659 HTTP profile', () => {
  it('accepts an 8 MiB window and rejects the next exponent', () => {
    // window descriptor: exponent<<3; exp 13 => 8 MiB (allowed), exp 14 => 16 MiB.
    const okTail = Buffer.concat([
      Buffer.from([13 << 3]),
      Buffer.from([(0 << 3) | (0 << 1) | 1, 0x00, 0x00]), // empty raw last block
    ]);
    expect(validateZstdFrame(frameWith(0b0000_0000, okTail)))
      .toEqual({ complete: true });
    const bigTail = Buffer.from([14 << 3]);
    expect(validateZstdFrame(frameWith(0b0000_0000, bigTail)).fault)
      .toContain('8 MiB');
  });

  it('rejects a single-segment FCS-derived window above 8 MiB', () => {
    // descriptor: FCS flag 3 (8B) + single-segment.
    const fcs = Buffer.alloc(8);
    fcs.writeBigUInt64LE(BigInt(9 * 1024 * 1024), 0);
    expect(validateZstdFrame(frameWith(0b1110_0000, fcs)).fault)
      .toContain('single-segment content size');
  });

  it('rejects a block above min(window, 128KiB)', () => {
    // 1 MiB window (exp 10 => 2^20), raw block declaring 200 KiB.
    const blockSize = 200 * 1024;
    const header = (blockSize << 3) | 1;
    const tail = Buffer.concat([
      Buffer.from([10 << 3]),
      Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]),
    ]);
    expect(validateZstdFrame(frameWith(0b0000_0000, tail)).fault)
      .toContain('128 KiB');
  });

  it('rejects a block above a small single-segment window (window arm of the min)', () => {
    // Single-segment FCS 3 => window 3; raw block declaring 10 bytes must
    // fault on the WINDOW arm, not the 128 KiB arm.
    const header = (10 << 3) | 1;
    const tail = Buffer.concat([
      Buffer.from([0x03]),
      Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]),
      Buffer.alloc(10, 0x61),
    ]);
    expect(validateZstdFrame(frameWith(0b0010_0000, tail)).fault)
      .toContain('128 KiB');
  });
});

describe('block rules', () => {
  it('rejects the reserved block type', () => {
    const header = (3 << 3) | (3 << 1) | 1;
    const tail = Buffer.concat([
      Buffer.from([0x03]),
      Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]),
    ]);
    expect(validateZstdFrame(frameWith(0b0010_0000, tail)).fault)
      .toContain('reserved block type');
  });

  it('walks an RLE block with a single carried byte', () => {
    const header = (3 << 3) | (1 << 1) | 1; // regenerated size 3, RLE, last
    const frame = Buffer.concat([
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
      Buffer.from([0b0010_0000]),
      Buffer.from([0x03]),
      Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]),
      Buffer.from([0x61]),
    ]);
    expect(validateZstdFrame(frame)).toEqual({ complete: true });
  });

  it('EOF before any block completes is incomplete, not complete', () => {
    const headerOnly = Buffer.concat([
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
      Buffer.from([0b0010_0000]),
      Buffer.from([0x03]),
    ]);
    const verdict = validateZstdFrame(headerOnly);
    expect(verdict.complete).toBe(false);
    expect(verdict.fault).toBeUndefined();
  });
});

describe('single-frame subset boundary', () => {
  it('rejects trailing bytes after a complete frame', () => {
    const trailing = Buffer.concat([minimalRawFrame(), Buffer.from([0x00])]);
    expect(validateZstdFrame(trailing).fault).toContain('trailing bytes');
  });

  it('rejects concatenated frames at the second frame boundary', () => {
    const concatenated = Buffer.concat([minimalRawFrame(), minimalRawFrame()]);
    expect(validateZstdFrame(concatenated).fault).toContain('trailing bytes');
  });

  it('requires the full checksum trailer when flagged', () => {
    const withChecksum = minimalRawFrame({ checksum: true });
    expect(validateZstdFrame(withChecksum)).toEqual({ complete: true });
    const truncatedTrailer = withChecksum.subarray(0, withChecksum.length - 2);
    const verdict = validateZstdFrame(truncatedTrailer);
    expect(verdict.complete).toBe(false);
    expect(verdict.fault).toBeUndefined();
  });
});
