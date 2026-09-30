/**
 * DR — download refusal when the runtime cannot provide `node:fs` is a TYPED error.
 *
 * `prepareHTTPOptions` refuses a `saveTo` download when the `node:fs` handle is unavailable (a bundler that strips `node:*`,
 * an edge runtime, or — as here — vite-node, whose loader never services the adapters' opaque `import()`; no require bridge
 * is installed on purpose). That refusal was a plain `Error` with no code, and its message named the wrong runtime. Errors
 * are typed and structured: the refusal is a `RezoError` carrying `REZ_UNSUPPORTED_CAPABILITY` and a truthful message.
 * Under `bun test` the opaque import is serviced natively, so the refusal cannot be observed there (the row is skipped with
 * that reason, never silently GREEN).
 */

import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { Rezo } from '../src/core/rezo';
import { RezoError } from '../src/errors/rezo-error';
import { executeRequest as httpAdapter } from '../src/adapters/http';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const server = http.createServer((_request, response) => { response.setHeader('content-type', 'text/plain'); response.end('body'); });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const scratch = mkdtempSync(join(tmpdir(), 'download-refusal-'));
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

type Refusal = { code: string | undefined; isRezoError: boolean; message: string; hits: number };
async function refusal(adapter: typeof httpAdapter, label: string): Promise<Refusal> {
  const rezo = new Rezo({ retry: false, timeout: 5000 } as never, adapter);
  const file = join(scratch, `${label}.bin`);
  let failure: unknown;
  // The absence is now DELIBERATE. This row used to depend on vite-node simply
  // failing to service the opaque `import()`, which stopped being true once the
  // runtime bridge learned `process.getBuiltinModule` — the fix that made the
  // persistent cache, `pipeTo`, and the cookie jar work on ESM at all. Relying
  // on an ambient defect meant the row proved the harness, not the refusal, so
  // it withholds the handle explicitly instead.
  const host = (globalThis as { process?: { getBuiltinModule?: (specifier: string) => unknown } }).process;
  const realResolver = host?.getBuiltinModule;
  if (host && realResolver) {
    host.getBuiltinModule = ((specifier: string) =>
      specifier === 'node:fs' || specifier === 'fs' ? undefined : realResolver.call(host, specifier)) as typeof realResolver;
  }
  try {
    const facade: any = await rezo.download(`${origin}/file`, file);
    failure = await new Promise((resolve) => { facade.on('error', resolve); facade.on('done', () => resolve(new Error('download completed although node:fs is unavailable'))); });
  } catch (error) { failure = error; }
  finally { if (host && realResolver) host.getBuiltinModule = realResolver; }
  return { code: (failure as { code?: string })?.code, isRezoError: failure instanceof RezoError, message: String((failure as Error)?.message ?? ''), hits: hitsSoFar() };
}
let hits = 0; server.on('request', () => { hits += 1; }); const hitsSoFar = () => hits;

it.skipIf(isBun)('DR-01 HTTP/1.1: a download without a node:fs handle is refused with a typed REZ_UNSUPPORTED_CAPABILITY before any wire hit', async () => {
  const outcome = await refusal(httpAdapter, 'h1');
  expect(outcome.isRezoError).toBe(true);
  expect(outcome.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(outcome.message).toMatch(/node:fs/);
  expect(outcome.message).not.toMatch(/Edge module/);
  expect(outcome.hits).toBe(0);
});

it.skipIf(isBun)('DR-02 Fetch: the same refusal, same code, same message shape', async () => {
  const outcome = await refusal(fetchAdapter, 'fetch');
  expect(outcome.isRezoError).toBe(true);
  expect(outcome.code).toBe('REZ_UNSUPPORTED_CAPABILITY');
  expect(outcome.message).toMatch(/node:fs/);
  expect(outcome.hits).toBe(0);
});

it('DR-03 control: the carrier sees the runtime it thinks it sees (vite-node refuses, bun services the opaque import)', () => {
  expect(typeof isBun).toBe('boolean');
});
