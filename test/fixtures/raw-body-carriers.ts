import { Readable } from 'node:stream';

export interface RawBodyCase {
  name: string;
  make: () => unknown;
  bytes: number[];
}

const payload = [65, 0, 255, 13, 10];
export const rawBodyCases: RawBodyCase[] = [
  { name: 'Buffer', make: () => Buffer.from(payload), bytes: payload },
  { name: 'Uint8Array offset', make: () => Uint8Array.from([88, ...payload, 89]).subarray(1, 6), bytes: payload },
  { name: 'ArrayBuffer', make: () => Uint8Array.from(payload).buffer, bytes: payload },
  { name: 'DataView offset', make: () => new DataView(Uint8Array.from([88, ...payload, 89]).buffer, 1, 5), bytes: payload },
  { name: 'empty view offset', make: () => new Uint8Array(new ArrayBuffer(4), 2, 0), bytes: [] },
  { name: 'Blob', make: () => new Blob([Uint8Array.from(payload)]), bytes: payload },
  { name: 'JSON byte array', make: () => new TextEncoder().encode('{"v":1}'), bytes: Array.from(Buffer.from('{"v":1}')) },
  { name: 'at string', make: () => '@rezo-nonexistent-body-file', bytes: Array.from(Buffer.from('@rezo-nonexistent-body-file')) },
  { name: 'NUL string', make: () => 'a\0b\r\ncafé', bytes: Array.from(Buffer.from('a\0b\r\ncafé')) },
];

for (const Type of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array]) {
  const width = Type.BYTES_PER_ELEMENT;
  const bytes = Array.from({ length: width * 2 }, (_, i) => i + 1);
  rawBodyCases.push({
    name: `${Type.name} selected bytes`, bytes,
    make: () => {
      const backing = new Uint8Array(width * 4).fill(99);
      backing.set(bytes, width);
      return new Type(backing.buffer, width, 2);
    },
  });
}

export const streamBodyCases: RawBodyCase[] = [
  { name: 'Node stream', make: () => Readable.from([Buffer.from(payload)]), bytes: payload },
  { name: 'Web stream', make: () => new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.from(payload)); controller.close(); },
  }), bytes: payload },
  { name: 'Request body stream', make: () => new Request('https://example.invalid', {
    method: 'POST', body: Uint8Array.from(payload),
  }).body, bytes: payload },
  { name: 'Response body stream', make: () => new Response(Uint8Array.from(payload)).body, bytes: payload },
];
