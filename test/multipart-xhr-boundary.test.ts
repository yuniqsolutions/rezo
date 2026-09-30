import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { RezoFormData } from '../src/utils/form-data';
import { RezoCookieJar } from '../src/cookies/cookie-jar';

// This observes the XHR API boundary on the host; it is not a browser run.
const sent: { body: unknown; headers: Headers }[] = [];
class CapturingXHR {
  readyState = 0;
  status = 200;
  statusText = 'OK';
  responseURL = '';
  response = 'ok';
  responseText = 'ok';
  responseType = '';
  timeout = 0;
  withCredentials = false;
  onload?: () => void;
  onreadystatechange?: () => void;
  upload = {};
  headers = new Headers();
  open(_method: string, url: string): void { this.responseURL = url; this.readyState = 1; }
  setRequestHeader(name: string, value: string): void { this.headers.append(name, value); }
  getAllResponseHeaders(): string { return 'content-type: text/plain\r\ncontent-length: 2\r\n'; }
  getResponseHeader(name: string): string | null {
    return new Headers({ 'content-type': 'text/plain', 'content-length': '2' }).get(name);
  }
  send(body: unknown): void {
    sent.push({ body, headers: this.headers });
    queueMicrotask(() => { this.readyState = 4; this.onreadystatechange?.(); this.onload?.(); });
  }
  abort(): void {}
}
vi.stubGlobal('XMLHttpRequest', CapturingXHR);
const { executeRequest } = await import('../src/adapters/xhr');
beforeEach(() => { sent.length = 0; });
afterAll(() => { vi.unstubAllGlobals(); });

it('Rezo metadata helpers leave the XHR runtime in charge of its new boundary', async () => {
  const form = new RezoFormData();
  form.append('note', 'literal');
  await executeRequest({
    url: 'http://example.invalid/form', fullUrl: 'http://example.invalid/form', method: 'POST', body: form,
    headers: await form.getHeadersAsync(), responseType: 'text', timeout: 1000,
  }, { cache: false, retry: false, disableJar: true }, new RezoCookieJar());
  expect(sent).toHaveLength(1);
  expect(sent[0].headers.has('Content-Type')).toBe(false);
  expect(sent[0].headers.has('Content-Length')).toBe(false);
  expect((sent[0].body as FormData).get('note')).toBe('literal');
});

for (const native of [true, false]) {
  for (const contentType of [undefined, '', 'application/json', 'multipart/form-data']) {
    it(`${native ? 'native' : 'Rezo'} FormData forwards fields with ${contentType ?? 'inferred'} type`, async () => {
      const form = native ? new FormData() : new RezoFormData();
      form.append('note', 'literal');
      form.append('file', new Blob([Uint8Array.from([0, 255])]), 'bytes.bin');
      await executeRequest({
        url: 'http://example.invalid/form', fullUrl: 'http://example.invalid/form', method: 'POST', body: form, responseType: 'text',
        headers: contentType === undefined ? {} : { 'Content-Type': contentType }, timeout: 1000,
      }, { cache: false, retry: false, disableJar: true }, new RezoCookieJar());
      expect(sent).toHaveLength(1);
      expect(sent[0].headers.get('Content-Type')).toBe(contentType ?? null);
      expect(sent[0].body).toBeInstanceOf(FormData);
      const received = sent[0].body as FormData;
      expect(received.get('note')).toBe('literal');
      const file = received.get('file') as File;
      expect(file.name).toBe('bytes.bin');
      expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0, 255]);
    });
  }
}
