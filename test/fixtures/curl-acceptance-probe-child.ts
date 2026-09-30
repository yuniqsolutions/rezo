// Isolated source-module cache and kill-bounded listener lifetime per test.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeCurlTlsAcceptance } from '../../src/adapters/curl-stealth.js';
// @ts-expect-error Existing JavaScript wire observer has no declaration file.
import { startClientHelloObserver } from './stealth/wire-observer.mjs';

interface Observer {
  port: number;
  hellos: unknown[];
  close(): Promise<void>;
}

const cleanCurl = fileURLToPath(new URL('./curl-acceptance-clean.sh', import.meta.url));

async function observe(args: string[]) {
  const observer: Observer = await startClientHelloObserver();
  try {
    const processResult = await new Promise<{ code: number | null; signal: string | null; stderr: string }>((resolve, reject) => {
      const child = spawn(cleanCurl, [
        '-sS', '-o', '/dev/null', ...args, `https://127.0.0.1:${observer.port}/`,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, stderr }));
    });
    return { ...processResult, hellos: observer.hellos };
  } finally {
    await observer.close();
  }
}

try {
  const input: unknown = JSON.parse(process.argv[2] ?? 'null');
  if (!Array.isArray(input) || !input.every((arg) => typeof arg === 'string')) {
    throw new Error('Expected a JSON string-array of TLS arguments');
  }
  const args: string[] = input;
  // Independent observation does not use the product probe's destroy-on-connect
  // listener. It establishes this binary/material's actual setup/wire behavior.
  const direct = await observe(args);
  const acceptance = await probeCurlTlsAcceptance(args, cleanCurl);
  process.stdout.write(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', direct, acceptance }) + '\n');
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
}
