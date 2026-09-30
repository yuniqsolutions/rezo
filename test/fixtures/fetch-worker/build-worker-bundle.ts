/**
 * Builds the Fetch entry's published worker bundle (esbuild CLI, `worker` export condition, browser platform, no Node
 * builtins — the metafile is checked for `node:` inputs) into a fresh directory, next to a copy of the worker script.
 * Runtime-agnostic: the esbuild binary is spawned through node:child_process, which Node, Bun and Deno all provide.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const FETCH_ENTRY_SOURCE = 'src/adapters/entries/fetch.ts';

export interface WorkerBundle { directory: string; bundlePath: string; scriptPath: string; bundleBytes: number; nodeInputs: string[]; inputs: number }

export function buildWorkerBundle(): WorkerBundle {
  const directory = mkdtempSync(join(tmpdir(), 'rezo-fetch-worker-'));
  const bundlePath = join(directory, 'fetch-entry.worker.mjs');
  const metafilePath = join(directory, 'meta.json');
  execFileSync(join(REPO_ROOT, 'node_modules', '.bin', 'esbuild'), [
    join(REPO_ROOT, FETCH_ENTRY_SOURCE), '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--conditions=worker',
    `--outfile=${bundlePath}`, `--metafile=${metafilePath}`, '--log-level=silent',
  ], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const metafile = JSON.parse(readFileSync(metafilePath, 'utf8')) as { inputs: Record<string, unknown> };
  const inputs = Object.keys(metafile.inputs);
  const scriptPath = join(directory, 'worker-script.mjs');
  copyFileSync(join(HERE, 'worker-script.mjs'), scriptPath);
  return { directory, bundlePath, scriptPath, bundleBytes: readFileSync(bundlePath).length, nodeInputs: inputs.filter((input) => input.startsWith('node:')), inputs: inputs.length };
}
