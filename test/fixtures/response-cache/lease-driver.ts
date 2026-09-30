/**
 * Child-process driver for the cache-directory lease rows (carrier 8, PC-33+).
 *
 * The in-process rows (PC-17, PC-18, PC-19, PC-27) prove refusal logic against
 * a lease *file* and sibling sharing within one process. They cannot prove what
 * the lease is actually for: two LIVE processes contending on the exclusive
 * create, a holder surviving a contender, token-authenticated cleanup on a
 * normal exit, and no-steal after a crash. Those need real processes.
 *
 * Protocol is strict, versioned NDJSON on stdout with line commands on stdin, so
 * the test synchronises on observed events rather than on sleeps:
 *
 *   → ready {state,isPersistent}   after construction has settled
 *   → bound {code}                 result of one bound-cache use
 *   → set {ok}                     an accepted set, drained
 *   ← use                          perform a bound use
 *   ← store                        perform a set and drain
 *   ← exit                         exit 0 normally, running lease cleanup
 *
 * A crash is produced by the parent with SIGKILL, so no cleanup can run.
 */
import { ResponseCache } from '../../../src/cache/response-cache.js';
import { cachePersistence } from '../../../src/cache/response-cache-readiness.js';
import { bindResponseCache } from '../../../src/cache/bound-response-cache.js';
import { RezoError } from '../../../src/errors/rezo-error.js';

const PROTOCOL = 1;
const URL_UNDER_TEST = 'https://example.invalid/lease-driver';
const HEADERS = { authorization: 'Bearer driver', accept: 'application/json' };

let sequence = 0;

/**
 * Every line carries a monotonic sequence number. Without it a reader cannot
 * distinguish the second answer to a repeated command from the first — so a
 * "reported exactly once" claim would reread the original event and prove
 * nothing.
 */
function emit(event: string, payload: Record<string, unknown> = {}): void {
  sequence += 1;
  process.stdout.write(`${JSON.stringify({ v: PROTOCOL, seq: sequence, event, ...payload })}\n`);
}

async function settle(cache: object): Promise<void> {
  const persistence = cachePersistence(cache);
  if (!persistence) return;
  await persistence.drain();
  await persistence.drain();
}

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory) {
    emit('fatal', { reason: 'no directory argument' });
    process.exit(2);
  }

  // A consumer whose dependency patches `Object.prototype.toJSON` at import
  // time. The patch is lifted once the lease has been written, because this
  // driver's own NDJSON goes through `JSON.stringify` too — the write is the
  // only moment that matters, since exit cleanup reads with `JSON.parse`.
  const poisoned = process.argv[3] === 'poison';
  if (poisoned) {
    (Object.prototype as unknown as Record<string, unknown>).toJSON = () => ({ replaced: true });
  }
  const cache = new ResponseCache({ enable: true, ttl: 60_000, cacheDir: directory } as never);
  await settle(cache);
  if (poisoned) delete (Object.prototype as unknown as Record<string, unknown>).toJSON;
  const persistence = cachePersistence(cache as unknown as object);
  emit('ready', {
    state: persistence?.state ?? 'none',
    isPersistent: (cache as unknown as { isPersistent: boolean }).isPersistent,
  });

  let buffered = '';
  // Commands are serialized: two arriving in one chunk used to run
  // concurrently, so a synchronous `exit` could terminate the process while an
  // earlier async `store` was still awaiting its drain — and the caller waited
  // forever for an event that never came.
  let pending: Promise<void> = Promise.resolve();
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const command = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      pending = pending.then(() => handle(command));
      newline = buffered.indexOf('\n');
    }
  });

  async function handle(command: string): Promise<void> {
    if (command === 'use') {
      const bound = bindResponseCache(cache as unknown as object, 'json');
      let code = 'none';
      try {
        bound?.get('GET', URL_UNDER_TEST, HEADERS);
      } catch (error) {
        code = error instanceof RezoError ? String(error.code) : 'non-rezo';
      }
      emit('bound', { code });
      return;
    }
    if (command === 'store') {
      (cache as unknown as { set(m: string, u: string, r: unknown, h: unknown): void }).set(
        'GET', URL_UNDER_TEST,
        {
          data: { from: 'driver' }, status: 200, statusText: 'OK',
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
          config: {},
        },
        HEADERS,
      );
      await settle(cache as unknown as object);
      emit('set', { ok: true });
      return;
    }
    if (command === 'lease') {
      // The token this process believes it holds, so a row can replace the file
      // with a same-PID / different-token lease and observe what exit does.
      let contents: string | null = null;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        contents = fs.readFileSync(path.join(directory, '.rezo-cache-lease.json'), 'utf-8');
      } catch { contents = null; }
      emit('lease', { contents });
      return;
    }
    if (command === 'exit') {
      emit('exiting', {});
      // Normal exit: the module's `process.once('exit')` cleanup runs here and
      // must unlink only a lease whose token still matches ours.
      process.exit(0);
    }
  }
}

void main();
