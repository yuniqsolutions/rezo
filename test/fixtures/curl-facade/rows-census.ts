/**
 * Child-process lifecycle, observed from outside (repair family 2g and the census control): CFC-23 no curl child outlives a
 * terminal and a settled facade stays silent; CFC-26 the facade settles only once its child is gone (close-gated settlement),
 * proven at the terminal itself with `/bin/ps` — no public field needed.
 */
import type { FixtureServer } from './fixture-server.ts';
import { ADAPTERS, check, equal, liveCurlChildren } from './harness.ts';
import { Rezo } from '../../../src/core/rezo.ts';
import type { Row } from './row.ts';

/** Runs one cURL stream and captures the live-child census at the exact moment its terminal fires. */
function censusAtTerminal(url: string, abortAfterMs?: number): Promise<{ terminal: string; childrenAtTerminal: number; childrenAfter: number }> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const rezo = new Rezo({ retry: false, timeout: 8000 } as never, ADAPTERS.curl);
    const stream = rezo.stream(url, { signal: controller.signal } as never) as unknown as { on(name: string, listener: (payload?: unknown) => void): void };
    let done = false;
    // The census is taken at the first terminal the facade publishes (`complete` on success, `error` otherwise). A facade
    // that publishes nothing within the watchdog is recorded as `unsettled` and torn down through the test-owned signal.
    const settle = (terminal: string): void => {
      if (done) return;
      done = true;
      const childrenAtTerminal = liveCurlChildren().length;
      setTimeout(() => resolve({ terminal, childrenAtTerminal, childrenAfter: liveCurlChildren().length }), 300);
    };
    stream.on('complete', () => settle('complete'));
    stream.on('error', (error) => settle(`error:${(error as { code?: string })?.code ?? 'no-code'}`));
    if (abortAfterMs !== undefined) setTimeout(() => controller.abort(), abortAfterMs);
    setTimeout(() => { if (!done) { settle('unsettled'); controller.abort(); } }, 3000);
  });
}

export const censusRows: Row[] = [
  {
    id: 'CFC-23', title: 'census: after an accepted stream, a rejected 500 and a mid-body abort no curl child of this process is alive',
    async run(fixture: FixtureServer) {
      const runs = [
        await censusAtTerminal(`${fixture.origin}/200`),
        await censusAtTerminal(`${fixture.origin}/500`),
        await censusAtTerminal(`${fixture.origin}/slow/cfc-23-${Date.now()}`, 400),
      ];
      const deadline = Date.now() + 1500;
      while (liveCurlChildren().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      equal({ terminals: runs.map((run) => run.terminal), after: runs.map((run) => run.childrenAfter), live: liveCurlChildren().length }, { terminals: ['complete', 'error:REZ_HTTP_ERROR', 'error:ABORT_ERR'], after: [0, 0, 0], live: 0 }, 'child census');
    },
  },
  {
    id: 'CFC-26', title: 'the facade settles only after its child is gone: zero live curl children at the terminal for success, rejection and abort',
    async run(fixture: FixtureServer) {
      const success = await censusAtTerminal(`${fixture.origin}/200`);
      const rejected = await censusAtTerminal(`${fixture.origin}/500`);
      const aborted = await censusAtTerminal(`${fixture.origin}/slow/cfc-26-${Date.now()}`, 400);
      equal({ success: success.childrenAtTerminal, rejected: rejected.childrenAtTerminal, aborted: aborted.childrenAtTerminal }, { success: 0, rejected: 0, aborted: 0 }, 'children alive at the terminal');
      check(aborted.terminal === 'error:ABORT_ERR', `abort terminal: ${aborted.terminal}`);
    },
  },
];
