import { afterEach, describe, expect, it, vi } from 'vitest';
import { RezoFormData } from '../src/utils/form-data';

const NativeResponse = Response;
afterEach(() => { vi.unstubAllGlobals(); });

function sample(): RezoFormData {
  const form = new RezoFormData();
  form.append('note', 'first');
  form.append('file', new Blob([Uint8Array.from([0, 255, 65])]), 'bytes.bin');
  return form;
}

async function parse(bytes: ArrayBuffer, headers: Record<string, string>): Promise<FormData> {
  if (headers['content-length']) expect(Number(headers['content-length'])).toBe(bytes.byteLength);
  return new NativeResponse(bytes, { headers }).formData();
}

function holdEncodings(): { release: (() => void)[] } {
  const release: (() => void)[] = [];
  vi.stubGlobal('Response', class extends NativeResponse {
    override async arrayBuffer(): Promise<ArrayBuffer> {
      const bytes = super.arrayBuffer();
      await new Promise<void>(resolve => { release.push(resolve); });
      return bytes;
    }
  });
  return { release };
}

describe('RezoFormData encoding ownership', () => {
  it('concurrent public readers receive matching bytes, boundary and length', async () => {
    const form = sample();
    const [headers, buffer, bytes, array, length] = await Promise.all([
      form.getHeadersAsync(), form.toBuffer(), form.toUint8Array(), form.toArrayBuffer(), form.getLength(),
    ]);
    for (const data of [buffer, bytes, new Uint8Array(array)]) {
      expect(data.byteLength).toBe(length);
      const fields = await parse(Uint8Array.from(data).buffer, headers);
      expect(fields.get('note')).toBe('first');
      expect(Array.from(new Uint8Array(await (fields.get('file') as File).arrayBuffer()))).toEqual([0, 255, 65]);
    }
  });

  it('a completed read never exposes another pending encoding boundary', async () => {
    const gate = holdEncodings();
    const form = sample();
    const bytes = form.toArrayBuffer();
    const type = form.getContentTypeAsync();
    try {
      gate.release[0]();
      const first = await bytes;
      expect((await parse(first, form.getHeaders())).get('note')).toBe('first');
    } finally {
      for (const release of gate.release) release();
      await Promise.allSettled([bytes, type]);
    }
  });

  for (const native of [false, true]) {
    it(`${native ? 'native' : 'wrapper'} mutation invalidates completed cached data`, async () => {
      const form = sample();
      await form.toArrayBuffer();
      const target = native ? form.toNativeFormData() : form;
      target.set('note', 'second');
      target.append('repeat', 'a'); target.append('repeat', 'b');
      const bytes = await form.toArrayBuffer();
      const fields = await parse(bytes, await form.getHeadersAsync());
      expect(fields.get('note')).toBe('second');
      expect(fields.getAll('repeat')).toEqual(['a', 'b']);
      target.delete('note');
      expect((await parse(await form.toArrayBuffer(), await form.getHeadersAsync())).has('note')).toBe(false);
    });

    it(`${native ? 'native' : 'wrapper'} mutation cannot be overwritten by an older encoding completion`, async () => {
      const gate = holdEncodings();
      const form = sample();
      const older = form.toArrayBuffer();
      (native ? form.toNativeFormData() : form).set('note', 'second');
      const newer = form.toArrayBuffer();
      try {
        gate.release[1]();
        const newBytes = await newer;
        const newHeaders = form.getHeaders();
        expect((await parse(newBytes, newHeaders)).get('note')).toBe('second');
        gate.release[0]();
        await older;
        expect((await parse(await form.toArrayBuffer(), await form.getHeadersAsync())).get('note')).toBe('second');
      } finally {
        for (const release of gate.release) release();
        await Promise.allSettled([older, newer]);
      }
    });
  }

  it('native file replacement with identical metadata refreshes the encoded bytes', async () => {
    const form = sample();
    await form.toArrayBuffer();
    form.toNativeFormData().set('file', new Blob([Uint8Array.from([9, 8, 7])]), 'bytes.bin');
    const fields = await parse(await form.toArrayBuffer(), await form.getHeadersAsync());
    const file = fields.get('file') as File;
    expect(file.name).toBe('bytes.bin');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([9, 8, 7]);
  });

  it('native mutators retain their receiver when borrowed by another FormData', async () => {
    const form = sample();
    const before = await form.toArrayBuffer();
    const native = form.toNativeFormData();
    const other = new FormData();
    Reflect.apply(native.append, other, ['note', 'other']);
    Reflect.apply(native.set, other, ['note', 'updated']);
    expect(other.get('note')).toBe('updated');
    native.delete.call(other, 'note');
    expect(other.has('note')).toBe(false);
    expect(await form.toArrayBuffer()).toEqual(before);
    expect(native.get('note')).toBe('first');
  });

  it('an empty form shares complete metadata with concurrent readers', async () => {
    const form = new RezoFormData();
    const [headers, bytes] = await Promise.all([form.getHeadersAsync(), form.toArrayBuffer()]);
    expect(Array.from((await parse(bytes, headers)).entries())).toEqual([]);
    expect(form.getLengthSync()).toBe(bytes.byteLength);
    expect(headers['content-type']).toContain(form.getBoundary());
  });

  it('a failed older encoding cannot clear newer cached data', async () => {
    const form = sample();
    let failOlder: () => void = () => {};
    let attempts = 0;
    vi.stubGlobal('Response', class extends NativeResponse {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        if (attempts++ === 0) {
          await new Promise<void>((_resolve, reject) => {
            failOlder = () => { reject(new Error('Older encoding failed')); };
          });
        }
        return super.arrayBuffer();
      }
    });
    const older = form.toArrayBuffer();
    const failure = expect(older).rejects.toThrow('Older encoding failed');
    try {
      form.toNativeFormData().set('note', 'second');
      const bytes = await form.toArrayBuffer();
      const headers = form.getHeaders();
      failOlder();
      await failure;
      expect(form.getHeaders()).toEqual(headers);
      expect(await form.toArrayBuffer()).toEqual(bytes);
      expect((await parse(bytes, headers)).get('note')).toBe('second');
    } finally {
      failOlder();
      await failure;
    }
  });

  it('a failed encoding leaves no partial metadata and permits retry', async () => {
    const form = sample();
    let attempts = 0;
    vi.stubGlobal('Response', class extends NativeResponse {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        if (attempts++ === 0) throw new Error('Synthetic form encoding failure');
        return super.arrayBuffer();
      }
    });
    await expect(form.toArrayBuffer()).rejects.toThrow('Synthetic form encoding failure');
    expect(form.getHeaders()).toEqual({});
    expect(form.getBuffer()).toBeNull();
    expect((await parse(await form.toArrayBuffer(), await form.getHeadersAsync())).get('note')).toBe('first');
  });
});
