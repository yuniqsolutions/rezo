/**
 * vite-node never services the adapters' opaque `import()` (src/utils/node-runtime.ts), so on Node a carrier that drives a
 * download must bridge exactly what the adapters resolve through it: `node:fs`, `node:path` and the download-target
 * transaction sibling (its specifier is relative to the LOADER module). Bun's native runner services the opaque import
 * itself and needs no bridge. Anything else stays unresolved on purpose — an unexpected specifier is an infrastructure fact.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import * as downloadTargetTransaction from '../../src/adapters/download-target-transaction';

export function installNodeRequireBridge(): { restore(): void } {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') return { restore(): void { /* Bun services the opaque import natively */ } };
  if (Object.getOwnPropertyDescriptor(globalThis, 'require') !== undefined) throw new Error('require bridge: globalThis.require already has an own descriptor');
  const bridged: Record<string, unknown> = { 'node:fs': nodeFs, 'node:path': nodePath, '../adapters/download-target-transaction.js': downloadTargetTransaction };
  const nodeRequire = (specifier: string): unknown => { if (specifier in bridged) return bridged[specifier]; throw new Error(`require bridge: unexpected specifier ${specifier}`); };
  Object.defineProperty(globalThis, 'require', { configurable: true, enumerable: false, value: nodeRequire, writable: false });
  return { restore(): void { if (!Reflect.deleteProperty(globalThis, 'require')) throw new Error('require bridge: failed to remove'); } };
}
