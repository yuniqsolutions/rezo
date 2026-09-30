import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import { getDefaultConfig, prepareHTTPOptions } from '../src/utils/http-config';
import { rawBodyCases, streamBodyCases } from './fixtures/raw-body-carriers';

describe('raw bodies keep their representation through shared preparation', () => {
  for (const contentType of [undefined, 'application/json', 'text/plain', 'application/octet-stream',
    'application/x-www-form-urlencoded', 'multipart/form-data; boundary=synthetic']) {
    for (const carrier of [...rawBodyCases, ...streamBodyCases]) {
      it(`${contentType ?? 'inferred'} / ${carrier.name}`, async () => {
        const body = carrier.make();
        const { fetchOptions } = prepareHTTPOptions({
          url: 'http://example.invalid/', fullUrl: 'http://example.invalid/', method: 'POST', body,
          headers: contentType ? { 'Content-Type': contentType } : undefined,
        }, new RezoCookieJar(), { defaultOptions: await getDefaultConfig({ disableJar: true }) });
        expect(fetchOptions.body).toBe(body);
      });
    }
  }

  it('recognizes an ArrayBuffer from another realm without relying on instanceof', async () => {
    const body: unknown = runInNewContext('new Uint8Array([65, 0, 255]).buffer');
    const { fetchOptions } = prepareHTTPOptions({
      url: 'http://example.invalid/', fullUrl: 'http://example.invalid/', method: 'POST', body,
      headers: { 'Content-Type': 'application/json' },
    }, new RezoCookieJar(), { defaultOptions: await getDefaultConfig({ disableJar: true }) });
    expect(fetchOptions.body).toBe(body);
  });
});
