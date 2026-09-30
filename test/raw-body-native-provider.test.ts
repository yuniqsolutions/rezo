import { describe, expect, it } from 'vitest';
import { executeRequest } from '../src/adapters/react-native';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import type { RezoStreamResponse } from '../src/types/response';
import { streamBodyCases } from './fixtures/raw-body-carriers';

describe('React Native custom upload producer boundary', () => {
  for (const carrier of streamBodyCases) {
    it(`forwards ${carrier.name} unchanged to an explicitly configured stream provider`, async () => {
      const body = carrier.make();
      let received: unknown;
      let calls = 0;
      const response = await executeRequest({
        url: 'https://example.invalid/body-provider', method: 'POST', responseType: 'stream',
        headers: { 'Content-Type': 'application/json' }, body, timeout: 1000, retry: false,
      }, { disableJar: true, cache: false, reactNative: { streamTransport: {
        name: 'synthetic-body-capable-provider',
        async stream(request) {
          calls++; received = request.body;
          expect(request.headers['content-type']).toBe('application/json');
          await request.onHeaders?.({ status: 200, headers: { 'content-type': 'text/plain' } });
          await request.onChunk?.('ok');
          return { status: 200, contentLength: 2 };
        },
      } } }, new RezoCookieJar()) as RezoStreamResponse;
      await new Promise<void>((resolve, reject) => {
        response.once('complete', () => resolve()); response.once('error', reject);
      });
      expect(calls).toBe(1);
      expect(received).toBe(body);
    });
  }
});
