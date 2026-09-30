import { describe, expect, it } from 'vitest';
import { RezoCookieJar } from '../src/cookies/cookie-jar';
import type { RezoRequestConfig } from '../src/types/rezo-request';
import RezoFormData from '../src/utils/form-data';
import { RezoHeaders } from '../src/utils/headers';
import { getDefaultConfig, prepareHTTPOptions } from '../src/utils/http-config';

// Approved bounded JSON repair: PLAN/tayo-terminal-a-plus-implementation-plan.md.
// These rows observe shared preparation, not a real receiver or every adapter.
// Defined explicit bodies retain their existing behavior, including falsy ones.
const URL_UNDER_TEST = 'https://example.invalid/json-option-regression';

async function prepare(
  method: RezoRequestConfig['method'], input: Partial<RezoRequestConfig>, isRedirected = false,
) {
  const defaults = await getDefaultConfig({ disableJar: true });
  const prepared = prepareHTTPOptions(
    { ...input, url: URL_UNDER_TEST, fullUrl: URL_UNDER_TEST, method },
    new RezoCookieJar(),
    { defaultOptions: defaults, isRedirected },
  );
  const headers = new RezoHeaders(prepared.fetchOptions.headers);
  return {
    method: prepared.fetchOptions.method,
    body: prepared.fetchOptions.body,
    contentType: headers.get('Content-Type'),
  };
}

describe('JSON option body — bounded shared-preparation repair', () => {
  for (const [index, method] of (['POST', 'PUT', 'PATCH'] as const).entries()) {
    it(`JB-0${index + 1} ${method} json-only serializes its documented payload`, async () => {
      const payload = { label: 'café', nested: { active: true }, values: [1, 2, 3] };
      const expectedBytes = JSON.stringify(payload);

      expect(await prepare(method, { json: payload })).toEqual({
        method,
        body: expectedBytes,
        contentType: 'application/json',
      });
      expect(payload).toEqual({ label: 'café', nested: { active: true }, values: [1, 2, 3] });
    });
  }

  it('JB-04 an empty json object remains a two-byte JSON body', async () => {
    expect(await prepare('POST', { json: {} })).toEqual({
      method: 'POST',
      body: '{}',
      contentType: 'application/json',
    });
  });

  it('JB-05 CONTROL an explicit JSON body is preserved without json shorthand', async () => {
    const body = '{"source":"explicit-body"}';
    expect(await prepare('POST', { body })).toEqual({
      method: 'POST', body, contentType: 'application/json',
    });
  });

  it('JB-06 CONTROL a plain object body is serialized by the existing sibling', async () => {
    expect(await prepare('PUT', { body: { source: 'object-body' } })).toEqual({
      method: 'PUT', body: '{"source":"object-body"}', contentType: 'application/json',
    });
  });

  it('JB-07 CONTROL form shorthand prepares a nonempty encoded body', async () => {
    expect(await prepare('POST', { form: { source: 'form-control' } })).toEqual({
      method: 'POST', body: 'source=form-control', contentType: 'application/x-www-form-urlencoded',
    });
  });

  for (const [label, body] of [
    ['string', '{"source":"explicit"}'], ['empty string', ''], ['null', null],
    ['false', false], ['zero', 0], ['object', { source: 'explicit' }],
    ['Buffer', Buffer.from('explicit')],
  ] as const) {
    it(`JB-08 CONTROL defined ${label} body wins over json without transformation`, async () => {
      const result = await prepare('POST', { body, json: { source: 'ignored' } });
      expect(result.body).toBe(body);
      expect(result.contentType).toBe('application/json');
    });
  }

  it('JB-09 an own undefined body still permits json serialization', async () => {
    expect((await prepare('POST', { body: undefined, json: { source: 'json' } })).body)
      .toBe('{"source":"json"}');
  });

  it('JB-10 CONTROL explicit body never evaluates ignored json serialization', async () => {
    let calls = 0;
    const json = { toJSON() { calls++; throw new Error('Ignored json must not be serialized'); } };
    expect((await prepare('POST', { body: '', json })).body).toBe('');
    expect(calls).toBe(0);
  });

  it('JB-11 CONTROL form keeps its existing precedence over json', async () => {
    expect(await prepare('POST', { form: { source: 'form' }, json: { source: 'json' } }))
      .toEqual({ method: 'POST', body: 'source=form', contentType: 'application/x-www-form-urlencoded' });
  });

  for (const field of ['formData', 'multipart'] as const) {
    it(`JB-12 CONTROL ${field} keeps its existing precedence over json`, async () => {
      const body = new RezoFormData();
      body.append('source', field);
      const result = await prepare('POST', { [field]: body, json: { source: 'json' } });
      expect(result.body).toBe(body);
      expect(result.body.get('source')).toBe(field);
      expect(result.contentType).toBeNull();
    });
  }

  it('JB-13 CONTROL explicit URLSearchParams bypasses json transformation', async () => {
    expect(await prepare('POST', {
      body: new URLSearchParams({ source: 'params' }), json: { source: 'json' },
    })).toEqual({ method: 'POST', body: 'source=params', contentType: 'application/x-www-form-urlencoded' });
  });

  it('JB-14 CONTROL explicit FormData bypasses json and retains the caller Content-Type', async () => {
    const body = new FormData();
    body.append('source', 'form-data');
    const result = await prepare('POST', {
      body, json: { source: 'json' }, headers: { 'Content-Type': 'application/json' },
    });
    expect(result.body).toBe(body);
    expect(result.contentType).toBe('application/json');
  });

  it('JB-15 withoutContentType suppresses the header, not serialized json bytes', async () => {
    expect(await prepare('POST', { json: { source: 'json' }, withoutContentType: true }))
      .toEqual({ method: 'POST', body: '{"source":"json"}', contentType: null });
  });

  it('JB-16 CONTROL redirect body removal still wins after json preparation', async () => {
    const input = {
      body: '{"source":"explicit"}', json: { source: 'json' }, withoutBodyOnRedirect: true,
    };
    expect((await prepare('POST', input)).body).toBe(input.body);
    expect((await prepare('POST', input, true)).body).toBeUndefined();
  });

  it('JB-17 serializes json through toJSON exactly once', async () => {
    let calls = 0;
    const json = { toJSON() { calls++; return { source: 'toJSON' }; } };
    expect((await prepare('POST', { json })).body).toBe('{"source":"toJSON"}');
    expect(calls).toBe(1);
  });

  it('JB-18 circular json rejects rather than silently dropping its body', async () => {
    const json: Record<string, unknown> = {};
    json.self = json;
    await expect(prepare('POST', { json })).rejects.toBeInstanceOf(TypeError);
  });

  it('JB-19 BigInt json rejects rather than silently dropping its body', async () => {
    await expect(prepare('POST', { json: { value: 1n } })).rejects.toBeInstanceOf(TypeError);
  });

  it('JB-20 a throwing toJSON preserves the thrown error', async () => {
    const cause = new Error('Synthetic serialization failure');
    await expect(prepare('POST', { json: { toJSON() { throw cause; } } })).rejects.toBe(cause);
  });

  it('JB-21 CONTROL redirected re-preparation does not replace committed replay state', async () => {
    const defaultOptions = await getDefaultConfig({ disableJar: true });
    const jar = new RezoCookieJar();
    const options: RezoRequestConfig = {
      url: URL_UNDER_TEST, fullUrl: URL_UNDER_TEST, method: 'POST', json: { source: 'initial' },
    };
    const initial = prepareHTTPOptions(options, jar, { defaultOptions });
    const committedBody = '{"source":"committed-redirect"}';
    initial.config.originalBody = committedBody;
    // Unlike JB-16, supply an existing config: this is a re-preparation seam
    // check, not a claim that a particular adapter takes this exact branch.
    const redirected = prepareHTTPOptions(
      options, jar, { defaultOptions, isRedirected: true }, initial.config,
    );
    expect(redirected.fetchOptions.body).toBe('{"source":"initial"}');
    expect(redirected.config.originalBody).toBe(committedBody);
  });
});
