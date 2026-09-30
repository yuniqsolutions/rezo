import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as curl } from '../src/adapters/curl';
import { RezoError } from '../src/errors/rezo-error';
import { rawBodyReceiver } from './fixtures/raw-body-receiver';

const NativeResponse = Response;
afterEach(() => { vi.unstubAllGlobals(); Http2SessionPool.getInstance().destroy(); });

for (const [name, adapter] of [['http2', http2], ['curl', curl]] as const) {
  describe(`${name} multipart preparation lifetime`, () => {
    for (const terminal of ['pre-abort', 'abort', 'deadline', 'encoder failure'] as const) {
      it(`${terminal} settles without dispatch or a late request`, async () => {
        const receiver = await rawBodyReceiver(adapter === http2);
        const client = new Rezo({ cache: false, retry: false, disableJar: true }, adapter);
        const controller = new AbortController();
        let started!: () => void;
        const preparing = new Promise<void>(resolve => { started = resolve; });
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let encoded = 0;
        vi.stubGlobal('Response', class extends NativeResponse {
          override async arrayBuffer(): Promise<ArrayBuffer> {
            encoded++;
            started();
            if (terminal === 'encoder failure') throw new Error('Synthetic multipart encoder failure');
            await held;
            return super.arrayBuffer();
          }
        });
        const body = new FormData();
        body.append('file', new Blob([Uint8Array.from([0, 255])]), 'bytes.bin');
        if (terminal === 'pre-abort') controller.abort();
        const pending = client.request({
          url: receiver.url, method: 'POST', body, signal: controller.signal,
          timeout: terminal === 'deadline' ? 100 : 1000,
        }).then(() => undefined, (error: unknown) => error);
        try {
          if (terminal === 'abort') { await preparing; controller.abort(); }
          const error = await pending;
          expect(error).toBeInstanceOf(RezoError);
          if (terminal === 'pre-abort' || terminal === 'abort') expect((error as RezoError).code).toBe('ABORT_ERR');
          if (terminal === 'deadline') expect((error as RezoError).code).toBe('ECONNABORTED');
          if (terminal === 'encoder failure') expect((error as Error).message).toContain('Synthetic multipart encoder failure');
          expect(encoded).toBe(terminal === 'pre-abort' ? 0 : 1);
          release();
          await new Promise(resolve => setTimeout(resolve, 30));
          expect(receiver.arrivals).toEqual([]);
        } finally {
          release(); controller.abort(); client.destroy();
          await pending;
          await receiver.close();
        }
      });
    }
  });
}
