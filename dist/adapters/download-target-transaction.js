import { randomUUID } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  openSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
const STAGE_ACQUISITION_ATTEMPTS = 8;
const STAGE_MODE = 438;
const nodeOperations = {
  openSync,
  createWriteStream,
  writeSync,
  closeSync,
  renameSync,
  unlinkSync
};
function errorFromUnknown(value) {
  return value instanceof Error ? value : new Error(String(value));
}
function hasErrorCode(error, code) {
  return error !== null && typeof error === "object" && Reflect.get(error, "code") === code;
}
function combineFailures(failures, message) {
  if (failures.length === 0)
    return;
  if (failures.length === 1)
    return failures[0];
  return new AggregateError(failures, message);
}
function downloadTargetFailureCause(primaryCause, cleanupFailure) {
  return cleanupFailure === undefined ? primaryCause : new AggregateError([primaryCause, cleanupFailure], "Download failed and staging cleanup also failed");
}
export function attachDownloadTargetFailureCause(publicError, primaryCause, cleanupFailure) {
  const cause = downloadTargetFailureCause(primaryCause, cleanupFailure);
  const existing = Object.getOwnPropertyDescriptor(publicError, "cause");
  if (existing?.configurable === false) {
    if (existing.value === cause || cleanupFailure === undefined && existing.value === primaryCause)
      return publicError;
    throw new Error("Download error cause is already non-configurable");
  }
  Object.defineProperty(publicError, "cause", {
    value: cause,
    enumerable: false,
    configurable: true
  });
  return publicError;
}

class NodeDownloadTargetTransaction {
  destinationPath;
  stagePath;
  descriptor;
  operations;
  mode = "idle";
  writer;
  writerClosed = false;
  descriptorNeedsClose = true;
  stageOwned = true;
  commitAttempted = false;
  cleanupAttempted = false;
  cleanupPromise;
  synchronousCleanupFailure;
  constructor(destinationPath, stagePath, descriptor, operations) {
    this.destinationPath = destinationPath;
    this.stagePath = stagePath;
    this.descriptor = descriptor;
    this.operations = operations;
  }
  createWriteStream() {
    this.assertUsable("create a writer");
    if (this.mode !== "idle") {
      throw new Error("Download target transaction already has a writer mode");
    }
    this.mode = "stream";
    try {
      const writer = this.operations.createWriteStream(this.stagePath, {
        fd: this.descriptor,
        autoClose: true,
        emitClose: true
      });
      this.descriptorNeedsClose = false;
      this.writer = writer;
      writer.once("close", () => {
        this.writerClosed = true;
      });
      return writer;
    } catch (error) {
      const primaryCause = errorFromUnknown(error);
      this.synchronousCleanupFailure = this.performSynchronousCleanup();
      this.cleanupAttempted = true;
      throw downloadTargetFailureCause(primaryCause, this.synchronousCleanupFailure);
    }
  }
  writeBufferAndClose(buffer) {
    this.assertUsable("write a buffer");
    if (this.mode !== "idle") {
      throw new Error("Download target transaction already has a writer mode");
    }
    this.mode = "buffer";
    let offset = 0;
    while (offset < buffer.byteLength) {
      const written = this.operations.writeSync(this.descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (!Number.isInteger(written) || written <= 0 || written > buffer.byteLength - offset) {
        throw new Error("Download staging write reported invalid progress");
      }
      offset += written;
    }
    const closeFailure = this.attemptDescriptorClose();
    if (closeFailure)
      throw closeFailure;
  }
  markWriterClosed() {
    if (this.writerClosed)
      return;
    if (this.mode === "stream" && this.writer?.closed === true) {
      this.writerClosed = true;
      return;
    }
    throw new Error("Download staging writer is not physically closed");
  }
  commit() {
    this.assertUsable("commit");
    if (!this.writerClosed) {
      throw new Error("Download staging writer must close before commit");
    }
    this.commitAttempted = true;
    this.operations.renameSync(this.stagePath, this.destinationPath);
    this.stageOwned = false;
  }
  cleanup() {
    if (this.cleanupPromise)
      return this.cleanupPromise;
    if (this.cleanupAttempted) {
      this.cleanupPromise = this.synchronousCleanupFailure ? Promise.reject(this.synchronousCleanupFailure) : Promise.resolve();
      return this.cleanupPromise;
    }
    this.cleanupAttempted = true;
    this.cleanupPromise = this.performCleanup();
    return this.cleanupPromise;
  }
  assertUsable(action) {
    if (!this.stageOwned) {
      throw new Error(`Cannot ${action}: download staging ownership has ended`);
    }
    if (this.cleanupAttempted) {
      throw new Error(`Cannot ${action}: download staging cleanup has started`);
    }
    if (this.commitAttempted) {
      throw new Error(`Cannot ${action}: download commit was already attempted`);
    }
  }
  attemptDescriptorClose() {
    if (!this.descriptorNeedsClose)
      return;
    try {
      this.operations.closeSync(this.descriptor);
      this.descriptorNeedsClose = false;
      this.writerClosed = true;
      return;
    } catch (error) {
      return errorFromUnknown(error);
    }
  }
  unlinkOwnedStage() {
    if (!this.stageOwned)
      return;
    try {
      this.operations.unlinkSync(this.stagePath);
      this.stageOwned = false;
      return;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        this.stageOwned = false;
        return;
      }
      return errorFromUnknown(error);
    }
  }
  performSynchronousCleanup() {
    const failures = [];
    const closeFailure = this.attemptDescriptorClose();
    if (closeFailure) {
      failures.push(closeFailure);
    } else {
      const unlinkFailure = this.unlinkOwnedStage();
      if (unlinkFailure)
        failures.push(unlinkFailure);
    }
    return combineFailures(failures, "Download staging cleanup failed");
  }
  async performCleanup() {
    const failures = [];
    if (this.writer && !this.writerClosed) {
      const closeFailure = await this.destroyWriterAndWaitForClose();
      if (closeFailure)
        failures.push(closeFailure);
    } else {
      const closeFailure = this.attemptDescriptorClose();
      if (closeFailure)
        failures.push(closeFailure);
    }
    if (!this.descriptorNeedsClose) {
      const unlinkFailure = this.unlinkOwnedStage();
      if (unlinkFailure)
        failures.push(unlinkFailure);
    }
    const failure = combineFailures(failures, "Download staging cleanup failed");
    if (failure)
      throw failure;
  }
  destroyWriterAndWaitForClose() {
    const writer = this.writer;
    if (writer.closed) {
      this.writerClosed = true;
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      let closeFailure;
      const onError = (error) => {
        closeFailure ??= error;
      };
      const onClose = () => {
        writer.off("error", onError);
        this.writerClosed = true;
        resolve(closeFailure);
      };
      writer.once("error", onError);
      writer.once("close", onClose);
      try {
        if (!writer.destroyed)
          writer.destroy();
      } catch (error) {
        writer.off("error", onError);
        writer.off("close", onClose);
        resolve(errorFromUnknown(error));
      }
    });
  }
}
export function createDownloadTargetTransaction(destinationPath, options = {}) {
  const operations = options.operations ?? nodeOperations;
  const createStageId = options.createStageId ?? randomUUID;
  const destinationName = basename(destinationPath);
  if (!destinationName)
    throw new Error("Download destination must name a file");
  let lastCollision;
  for (let attempt = 0;attempt < STAGE_ACQUISITION_ATTEMPTS; attempt++) {
    const stageId = createStageId();
    if (!stageId || stageId.includes("/") || stageId.includes("\\")) {
      throw new Error("Download staging identifier must be one path segment");
    }
    const stagePath = join(dirname(destinationPath), `.${destinationName}.rezo-${stageId}.part`);
    try {
      const descriptor = operations.openSync(stagePath, "wx", STAGE_MODE);
      return new NodeDownloadTargetTransaction(destinationPath, stagePath, descriptor, operations);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST"))
        throw error;
      lastCollision = error;
    }
  }
  throw lastCollision ?? new Error("Download staging acquisition exhausted");
}
