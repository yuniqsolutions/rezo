import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import typescript from 'typescript';
import {
  attachDownloadTargetFailureCause,
  createDownloadTargetTransaction,
  type DownloadTargetTransactionOperations,
} from '../src/adapters/download-target-transaction';
import { RezoError } from '../src/errors/rezo-error';
import type { RezoConfig } from '../src/types/rezo-config';

const SENTINEL = Buffer.from('R36 private helper destination sentinel');
const PAYLOAD = Buffer.from('R36 complete accepted payload');

let temporaryDirectory = '';

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'rezo-r36-helper-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function actualOperations(
  overrides: Partial<DownloadTargetTransactionOperations> = {},
): DownloadTargetTransactionOperations {
  return {
    openSync: (path, flags, mode) => fs.openSync(path, flags, mode),
    createWriteStream: (path, options) => fs.createWriteStream(path, options),
    writeSync: (fd, buffer, offset, length, position) => (
      fs.writeSync(fd, buffer, offset, length, position)
    ),
    closeSync: (fd) => fs.closeSync(fd),
    renameSync: (sourcePath, destinationPath) => (
      fs.renameSync(sourcePath, destinationPath)
    ),
    unlinkSync: (path) => fs.unlinkSync(path),
    ...overrides,
  };
}

function stagePath(destinationPath: string, stageId: string): string {
  return join(
    temporaryDirectory,
    `.${basename(destinationPath)}.rezo-${stageId}.part`,
  );
}

function thrown(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error, received ${String(error)}`);
  }
  throw new Error('Expected action to throw');
}

class ControlledWriteStream extends EventEmitter {
  closed = false;
  destroyed = false;

  constructor(private readonly closeDescriptor: () => void) {
    super();
  }

  destroy(): this {
    this.destroyed = true;
    this.closePhysically();
    return this;
  }

  closePhysically(): void {
    if (this.closed) return;
    this.closeDescriptor();
    this.closed = true;
    this.emit('close');
  }

  asWriteStream(): fs.WriteStream {
    return this as unknown as fs.WriteStream;
  }
}

describe('R36 private download-target transaction', () => {
  it('R36-H01 bounds exclusive acquisition and never touches collided paths', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const collisionIds = ['collision-a', 'collision-b'];
    for (const id of collisionIds) {
      await writeFile(stagePath(destination, id), Buffer.from(id));
    }

    const acquisitionIds = [...collisionIds, 'winner'];
    const openCalls: Array<readonly [string, string, number]> = [];
    const unlinkCalls: string[] = [];
    const operations = actualOperations({
      openSync: (path, flags, mode) => {
        openCalls.push([path, flags, mode]);
        return fs.openSync(path, flags, mode);
      },
      unlinkSync: (path) => {
        unlinkCalls.push(path);
        fs.unlinkSync(path);
      },
    });
    const transaction = createDownloadTargetTransaction(destination, {
      operations,
      createStageId: () => acquisitionIds.shift()!,
    });

    expect(openCalls).toEqual([
      [stagePath(destination, 'collision-a'), 'wx', 0o666],
      [stagePath(destination, 'collision-b'), 'wx', 0o666],
      [stagePath(destination, 'winner'), 'wx', 0o666],
    ]);
    expect(transaction.stagePath).toBe(stagePath(destination, 'winner'));
    await transaction.cleanup();
    expect(unlinkCalls).toEqual([stagePath(destination, 'winner')]);
    for (const id of collisionIds) {
      expect(await readFile(stagePath(destination, id), 'utf8')).toBe(id);
    }
    expect(await readFile(destination)).toEqual(SENTINEL);

    const exhaustionIds = Array.from({ length: 8 }, (_, index) => `full-${index}`);
    for (const id of exhaustionIds) {
      await writeFile(stagePath(destination, id), Buffer.from(id));
    }
    const exhaustionOpenCalls: string[] = [];
    const exhaustionUnlinks: string[] = [];
    const exhaustionOperations = actualOperations({
      openSync: (path, flags, mode) => {
        exhaustionOpenCalls.push(path);
        return fs.openSync(path, flags, mode);
      },
      unlinkSync: (path) => {
        exhaustionUnlinks.push(path);
        fs.unlinkSync(path);
      },
    });
    const failure = thrown(() => createDownloadTargetTransaction(destination, {
      operations: exhaustionOperations,
      createStageId: () => exhaustionIds[exhaustionOpenCalls.length],
    }));

    expect(failure).toMatchObject({ code: 'EEXIST' });
    expect(exhaustionOpenCalls).toHaveLength(8);
    expect(exhaustionUnlinks).toEqual([]);
    expect(await readFile(destination)).toEqual(SENTINEL);
  });

  it('R36-H02 rejects commit until the stream writer physically closes', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const ledger: string[] = [];
    let controlledWriter: ControlledWriteStream | undefined;
    let renameCalls = 0;
    const operations = actualOperations({
      createWriteStream: (path, options) => {
        ledger.push(`writer:${path}:${options.fd}:${options.autoClose}:${options.emitClose}`);
        controlledWriter = new ControlledWriteStream(() => {
          fs.closeSync(options.fd);
          ledger.push('writer-close');
        });
        return controlledWriter.asWriteStream();
      },
      renameSync: (sourcePath, destinationPath) => {
        renameCalls++;
        fs.renameSync(sourcePath, destinationPath);
      },
      unlinkSync: (path) => {
        ledger.push(`unlink:${path}`);
        fs.unlinkSync(path);
      },
    });
    const transaction = createDownloadTargetTransaction(destination, {
      operations,
      createStageId: () => 'close-gate',
    });
    transaction.createWriteStream();

    expect(() => transaction.markWriterClosed()).toThrow(/not physically closed/);
    expect(() => transaction.commit()).toThrow(/must close before commit/);
    expect(renameCalls).toBe(0);
    await transaction.cleanup();
    expect(controlledWriter?.destroyed).toBe(true);
    expect(ledger.indexOf('writer-close')).toBeLessThan(
      ledger.findIndex((entry) => entry.startsWith('unlink:')),
    );
    expect(fs.existsSync(transaction.stagePath)).toBe(false);
    expect(await readFile(destination)).toEqual(SENTINEL);
  });

  it('R36-H03 commits a closed accepted stage with exactly one rename', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const ledger: string[] = [];
    let controlledWriter: ControlledWriteStream | undefined;
    const operations = actualOperations({
      createWriteStream: (_path, options) => {
        fs.writeSync(options.fd, PAYLOAD, 0, PAYLOAD.length, null);
        controlledWriter = new ControlledWriteStream(() => {
          fs.closeSync(options.fd);
          ledger.push('writer-close');
        });
        return controlledWriter.asWriteStream();
      },
      renameSync: (sourcePath, destinationPath) => {
        ledger.push(`rename:${sourcePath}:${destinationPath}`);
        fs.renameSync(sourcePath, destinationPath);
      },
      unlinkSync: (path) => {
        ledger.push(`unlink:${path}`);
        fs.unlinkSync(path);
      },
    });
    const transaction = createDownloadTargetTransaction(destination, {
      operations,
      createStageId: () => 'accepted',
    });
    transaction.createWriteStream();
    controlledWriter!.closePhysically();
    transaction.markWriterClosed();
    transaction.commit();

    expect(ledger.filter((entry) => entry.startsWith('rename:'))).toEqual([
      `rename:${transaction.stagePath}:${destination}`,
    ]);
    expect(ledger.filter((entry) => entry.startsWith('unlink:'))).toEqual([]);
    expect(await readFile(destination)).toEqual(PAYLOAD);
    expect(fs.existsSync(transaction.stagePath)).toBe(false);
    expect(() => transaction.commit()).toThrow(/ownership has ended/);
    const cleanup = transaction.cleanup();
    expect(transaction.cleanup()).toBe(cleanup);
    await cleanup;
    expect(ledger.filter((entry) => entry.startsWith('unlink:'))).toEqual([]);
  });

  it('R36-H04 self-cleans construction and live-writer failures without rename', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const constructionFailure = new Error('writer construction failed');
    const constructionLedger: string[] = [];
    const constructionTransaction = createDownloadTargetTransaction(destination, {
      operations: actualOperations({
        createWriteStream: () => {
          constructionLedger.push('writer-construction');
          throw constructionFailure;
        },
        closeSync: (fd) => {
          constructionLedger.push('descriptor-close');
          fs.closeSync(fd);
        },
        unlinkSync: (path) => {
          constructionLedger.push(`unlink:${path}`);
          fs.unlinkSync(path);
        },
        renameSync: () => {
          constructionLedger.push('rename');
        },
      }),
      createStageId: () => 'construction-failure',
    });
    expect(thrown(() => constructionTransaction.createWriteStream())).toBe(
      constructionFailure,
    );
    expect(constructionLedger).toEqual([
      'writer-construction',
      'descriptor-close',
      `unlink:${constructionTransaction.stagePath}`,
    ]);
    await constructionTransaction.cleanup();

    const liveLedger: string[] = [];
    let liveWriter: ControlledWriteStream | undefined;
    const liveTransaction = createDownloadTargetTransaction(destination, {
      operations: actualOperations({
        createWriteStream: (_path, options) => {
          fs.writeSync(options.fd, PAYLOAD, 0, 7, null);
          liveWriter = new ControlledWriteStream(() => {
            fs.closeSync(options.fd);
            liveLedger.push('writer-close');
          });
          return liveWriter.asWriteStream();
        },
        renameSync: () => {
          liveLedger.push('rename');
        },
        unlinkSync: (path) => {
          liveLedger.push(`unlink:${path}`);
          fs.unlinkSync(path);
        },
      }),
      createStageId: () => 'live-failure',
    });
    liveTransaction.createWriteStream();
    await liveTransaction.cleanup();

    expect(liveWriter?.destroyed).toBe(true);
    expect(liveLedger).toEqual([
      'writer-close',
      `unlink:${liveTransaction.stagePath}`,
    ]);
    expect(await readFile(destination)).toEqual(SENTINEL);
    expect(fs.existsSync(liveTransaction.stagePath)).toBe(false);
  });

  it('R36-H05 propagates one cleanup failure and never unlinks the final path', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const cleanupFailure = new Error('owned stage unlink failed');
    const unlinkCalls: string[] = [];
    const transaction = createDownloadTargetTransaction(destination, {
      operations: actualOperations({
        unlinkSync: (path) => {
          unlinkCalls.push(path);
          throw cleanupFailure;
        },
      }),
      createStageId: () => 'cleanup-failure',
    });

    const firstCleanup = transaction.cleanup();
    const concurrentCleanup = transaction.cleanup();
    expect(concurrentCleanup).toBe(firstCleanup);
    await expect(firstCleanup).rejects.toBe(cleanupFailure);
    const laterCleanup = transaction.cleanup();
    expect(laterCleanup).toBe(firstCleanup);
    await expect(laterCleanup).rejects.toBe(cleanupFailure);
    expect(unlinkCalls).toEqual([transaction.stagePath]);
    expect(unlinkCalls).not.toContain(destination);
    expect(await readFile(destination)).toEqual(SENTINEL);
    expect(fs.existsSync(transaction.stagePath)).toBe(true);
  });

  it('R36-H06 keeps concurrent stages distinct and cleanup idempotent', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const unlinkCalls: string[] = [];
    const operations = actualOperations({
      unlinkSync: (path) => {
        unlinkCalls.push(path);
        fs.unlinkSync(path);
      },
    });
    const first = createDownloadTargetTransaction(destination, {
      operations,
      createStageId: () => 'concurrent-a',
    });
    const second = createDownloadTargetTransaction(destination, {
      operations,
      createStageId: () => 'concurrent-b',
    });
    expect(first.stagePath).not.toBe(second.stagePath);

    const firstCleanup = first.cleanup();
    expect(first.cleanup()).toBe(firstCleanup);
    await firstCleanup;
    expect(fs.existsSync(first.stagePath)).toBe(false);
    expect(fs.existsSync(second.stagePath)).toBe(true);
    await second.cleanup();
    expect(unlinkCalls).toEqual([first.stagePath, second.stagePath]);
    expect(await readFile(destination)).toEqual(SENTINEL);
  });

  it('R36-H07 preserves the final and cleans stage after one failed rename', async () => {
    const destination = join(temporaryDirectory, 'artifact.bin');
    await writeFile(destination, SENTINEL);
    const commitFailure = new Error('rename denied');
    let renameCalls = 0;
    let unlinkCalls = 0;
    let writeCalls = 0;
    const transaction = createDownloadTargetTransaction(destination, {
      operations: actualOperations({
        writeSync: (fd, buffer, offset, length, position) => {
          writeCalls++;
          const boundedLength = Math.min(length, 3);
          return fs.writeSync(fd, buffer, offset, boundedLength, position);
        },
        renameSync: () => {
          renameCalls++;
          throw commitFailure;
        },
        unlinkSync: (path) => {
          unlinkCalls++;
          fs.unlinkSync(path);
        },
      }),
      createStageId: () => 'rename-failure',
    });
    transaction.writeBufferAndClose(PAYLOAD);
    expect(await readFile(transaction.stagePath)).toEqual(PAYLOAD);
    expect(thrown(() => transaction.commit())).toBe(commitFailure);
    expect(() => transaction.commit()).toThrow(/already attempted/);
    expect(renameCalls).toBe(1);
    await transaction.cleanup();

    expect(writeCalls).toBeGreaterThan(1);
    expect(unlinkCalls).toBe(1);
    expect(await readFile(destination)).toEqual(SENTINEL);
    expect(fs.existsSync(transaction.stagePath)).toBe(false);
  });

  it.each(['transfer', 'write', 'close', 'commit'] as const)(
    'R36-H08 preserves primary %s error and orders dual-failure evidence',
    async (failurePoint) => {
      const destination = join(temporaryDirectory, `${failurePoint}.bin`);
      await writeFile(destination, SENTINEL);
      const primaryCause = new Error(`${failurePoint} primary failure`);
      const cleanupFailure = new Error(`${failurePoint} cleanup failure`);
      const ledger: string[] = [];
      let acquiredDescriptor = -1;
      let closeCalls = 0;
      let renameCalls = 0;
      let unlinkCalls = 0;
      let controlledWriter: ControlledWriteStream | undefined;
      const operations = actualOperations({
        openSync: (path, flags, mode) => {
          acquiredDescriptor = fs.openSync(path, flags, mode);
          return acquiredDescriptor;
        },
        createWriteStream: (_path, options) => {
          controlledWriter = new ControlledWriteStream(() => {
            fs.closeSync(options.fd);
            ledger.push('writer-close');
          });
          return controlledWriter.asWriteStream();
        },
        writeSync: (fd, buffer, offset, length, position) => {
          if (failurePoint === 'write') throw primaryCause;
          return fs.writeSync(fd, buffer, offset, length, position);
        },
        closeSync: (fd) => {
          closeCalls++;
          ledger.push('writer-close-attempt');
          if (failurePoint === 'close' && closeCalls === 1) throw primaryCause;
          fs.closeSync(fd);
          ledger.push('writer-close');
        },
        renameSync: (sourcePath, destinationPath) => {
          renameCalls++;
          if (failurePoint === 'commit') throw primaryCause;
          fs.renameSync(sourcePath, destinationPath);
        },
        unlinkSync: () => {
          unlinkCalls++;
          ledger.push('cleanup');
          throw cleanupFailure;
        },
      });
      const transaction = createDownloadTargetTransaction(destination, {
        operations,
        createStageId: () => failurePoint,
      });

      let observedPrimary: Error;
      if (failurePoint === 'transfer') {
        transaction.createWriteStream();
        observedPrimary = primaryCause;
      } else if (failurePoint === 'write') {
        observedPrimary = thrown(() => transaction.writeBufferAndClose(PAYLOAD));
      } else if (failurePoint === 'close') {
        observedPrimary = thrown(() => transaction.writeBufferAndClose(PAYLOAD));
      } else {
        transaction.writeBufferAndClose(PAYLOAD);
        observedPrimary = thrown(() => transaction.commit());
      }
      expect(observedPrimary).toBe(primaryCause);
      ledger.push('producer-stop');

      const cleanup = transaction.cleanup();
      expect(transaction.cleanup()).toBe(cleanup);
      let observedCleanup: Error;
      try {
        await cleanup;
        throw new Error('Expected cleanup to fail');
      } catch (error) {
        observedCleanup = errorFromCaught(error);
      }
      expect(observedCleanup).toBe(cleanupFailure);

      const publicError = RezoError.createDownloadError(
        'Download failed',
        {} as RezoConfig,
      );
      const publicSnapshot = {
        message: publicError.message,
        code: publicError.code,
        errno: publicError.errno,
      };
      attachDownloadTargetFailureCause(
        publicError,
        observedPrimary,
        observedCleanup,
      );
      ledger.push('settlement');

      expect(publicError).toMatchObject(publicSnapshot);
      const causeDescriptor = Object.getOwnPropertyDescriptor(publicError, 'cause');
      expect(causeDescriptor?.enumerable).toBe(false);
      expect(causeDescriptor?.value).toBeInstanceOf(AggregateError);
      expect((causeDescriptor!.value as AggregateError).errors).toEqual([
        observedPrimary,
        cleanupFailure,
      ]);
      expect((causeDescriptor!.value as AggregateError).errors[0]).toBe(primaryCause);
      expect((causeDescriptor!.value as AggregateError).errors[1]).toBe(cleanupFailure);
      expect(Object.keys(publicError)).not.toContain('cause');
      expect(unlinkCalls).toBe(1);
      expect(ledger.indexOf('producer-stop')).toBeLessThan(ledger.indexOf('cleanup'));
      expect(ledger.indexOf('writer-close')).toBeLessThan(ledger.indexOf('cleanup'));
      expect(ledger.indexOf('cleanup')).toBeLessThan(ledger.indexOf('settlement'));
      expect(await readFile(destination)).toEqual(SENTINEL);
      expect(fs.existsSync(transaction.stagePath)).toBe(true);
      if (failurePoint === 'commit') expect(renameCalls).toBe(1);
      else expect(renameCalls).toBe(0);
      if (failurePoint === 'close') {
        expect(closeCalls).toBe(2);
        expect(thrown(() => fs.fstatSync(acquiredDescriptor))).toMatchObject({
          code: 'EBADF',
        });
      }
      fs.unlinkSync(transaction.stagePath);
    },
  );

  it('enforces the reviewed no-fallback helper call shape through the AST', () => {
    const sourcePath = new URL(
      '../src/adapters/download-target-transaction.ts',
      import.meta.url,
    );
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sourceFile = typescript.createSourceFile(
      sourcePath.pathname,
      source,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const calls: Array<{ name: string; arguments: string[] }> = [];
    const visit = (node: typescript.Node): void => {
      if (typescript.isCallExpression(node)) {
        const expression = node.expression;
        const name = typescript.isPropertyAccessExpression(expression)
          ? expression.name.text
          : typescript.isIdentifier(expression)
            ? expression.text
            : '';
        calls.push({
          name,
          arguments: node.arguments.map((argument) => argument.getText(sourceFile)),
        });
      }
      typescript.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(calls.filter(({ name }) => /^(copyFile|copyFileSync|rm|rmSync)$/.test(name)))
      .toEqual([]);
    expect(calls.filter(({ name }) => name === 'openSync')).toEqual([
      expect.objectContaining({ arguments: [expect.any(String), "'wx'", 'STAGE_MODE'] }),
    ]);
    expect(source).toContain('const STAGE_ACQUISITION_ATTEMPTS = 8;');
    expect(source).toContain('const STAGE_MODE = 0o666;');
    expect(calls.filter(({ name }) => name === 'renameSync')).toEqual([
      { name: 'renameSync', arguments: ['this.stagePath', 'this.destinationPath'] },
    ]);
    expect(calls.filter(({ name }) => name === 'unlinkSync')).toEqual([
      { name: 'unlinkSync', arguments: ['this.stagePath'] },
    ]);
    const writerConstruction = calls.filter(({ name }) => name === 'createWriteStream');
    expect(writerConstruction).toHaveLength(1);
    expect(writerConstruction[0].arguments[0]).toBe('this.stagePath');
    expect(writerConstruction[0].arguments[1]).toContain('fd: this.descriptor');
    expect(writerConstruction[0].arguments[1]).toContain('autoClose: true');
    expect(writerConstruction[0].arguments[1]).toContain('emitClose: true');
  });
});

function errorFromCaught(error: unknown): Error {
  if (error instanceof Error) return error;
  throw new Error(`Expected Error, received ${String(error)}`);
}
