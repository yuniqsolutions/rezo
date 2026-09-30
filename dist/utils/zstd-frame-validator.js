const ZSTD_MAGIC = 4247762216;
const SKIPPABLE_MAGIC_MIN = 407710288;
const SKIPPABLE_MAGIC_MAX = 407710303;
const HTTP_WINDOW_LIMIT = 8 * 1024 * 1024;
const BLOCK_CEILING = 128 * 1024;

export class ZstdFrameValidator {
  state = "magic";
  fault;
  pending = Buffer.alloc(0);
  need = 4;
  singleSegment = false;
  checksumFlagged = false;
  dictionaryBytes = 0;
  fcsBytes = 0;
  windowSize = 0;
  blockBytesRemaining = 0;
  lastBlockSeen = false;
  update(chunk) {
    let input = chunk;
    while (input.length > 0 || this.pending.length >= this.need) {
      if (this.state === "faulted")
        return;
      if (this.state === "done") {
        if (input.length > 0 || this.pending.length > 0) {
          this.setFault("trailing bytes after the single frame");
        }
        return;
      }
      if (this.state === "blockContent") {
        const available = this.pending.length + input.length;
        const consumed = Math.min(this.blockBytesRemaining, available);
        const fromPending = Math.min(consumed, this.pending.length);
        this.pending = this.pending.subarray(fromPending);
        input = input.subarray(consumed - fromPending);
        this.blockBytesRemaining -= consumed;
        if (this.blockBytesRemaining > 0)
          return;
        this.state = this.lastBlockSeen ? this.checksumFlagged ? "checksum" : "done" : "blockHeader";
        this.need = this.state === "checksum" ? 4 : this.state === "blockHeader" ? 3 : 0;
        continue;
      }
      if (this.pending.length < this.need) {
        const take = Math.min(this.need - this.pending.length, input.length);
        if (take === 0)
          return;
        this.pending = Buffer.concat([this.pending, input.subarray(0, take)]);
        input = input.subarray(take);
        if (this.pending.length < this.need)
          return;
      }
      const field = this.pending.subarray(0, this.need);
      this.pending = this.pending.subarray(this.need);
      this.consumeField(field);
    }
  }
  finish() {
    if (this.state === "faulted")
      return { complete: false, fault: this.fault };
    if (this.state === "done")
      return { complete: true };
    return { complete: false };
  }
  setFault(reason) {
    this.state = "faulted";
    this.fault = reason;
  }
  consumeField(field) {
    switch (this.state) {
      case "magic": {
        const magic = field.readUInt32LE(0);
        if (magic >= SKIPPABLE_MAGIC_MIN && magic <= SKIPPABLE_MAGIC_MAX) {
          this.setFault("skippable frame rejected under the single-frame subset");
          return;
        }
        if (magic !== ZSTD_MAGIC) {
          this.setFault("invalid zstd magic");
          return;
        }
        this.state = "descriptor";
        this.need = 1;
        return;
      }
      case "descriptor": {
        const descriptor = field[0];
        if ((descriptor & 8) !== 0) {
          this.setFault("reserved frame-header bit 3 set");
          return;
        }
        this.singleSegment = (descriptor & 32) !== 0;
        this.checksumFlagged = (descriptor & 4) !== 0;
        const dictionaryFlag = descriptor & 3;
        this.dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
        const fcsFlag = descriptor >> 6 & 3;
        this.fcsBytes = fcsFlag === 0 ? this.singleSegment ? 1 : 0 : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
        if (!this.singleSegment) {
          this.state = "window";
          this.need = 1;
        } else if (this.dictionaryBytes > 0) {
          this.state = "dictionary";
          this.need = this.dictionaryBytes;
        } else {
          this.state = "fcs";
          this.need = this.fcsBytes;
        }
        return;
      }
      case "window": {
        const exponent = field[0] >> 3;
        const mantissa = field[0] & 7;
        const windowBase = 2 ** (10 + exponent);
        this.windowSize = windowBase + windowBase / 8 * mantissa;
        if (this.windowSize > HTTP_WINDOW_LIMIT) {
          this.setFault("window size exceeds the RFC 9659 8 MiB HTTP limit");
          return;
        }
        if (this.dictionaryBytes > 0) {
          this.state = "dictionary";
          this.need = this.dictionaryBytes;
        } else if (this.fcsBytes > 0) {
          this.state = "fcs";
          this.need = this.fcsBytes;
        } else {
          this.state = "blockHeader";
          this.need = 3;
        }
        return;
      }
      case "dictionary": {
        if (this.fcsBytes > 0) {
          this.state = "fcs";
          this.need = this.fcsBytes;
        } else {
          this.state = "blockHeader";
          this.need = 3;
        }
        return;
      }
      case "fcs": {
        let contentSize;
        if (this.fcsBytes === 1)
          contentSize = field[0];
        else if (this.fcsBytes === 2)
          contentSize = field.readUInt16LE(0) + 256;
        else if (this.fcsBytes === 4)
          contentSize = field.readUInt32LE(0);
        else {
          const value = field.readBigUInt64LE(0);
          contentSize = value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
        }
        if (this.singleSegment) {
          this.windowSize = contentSize;
          if (this.windowSize > HTTP_WINDOW_LIMIT) {
            this.setFault("single-segment content size exceeds the RFC 9659 8 MiB HTTP limit");
            return;
          }
        }
        this.state = "blockHeader";
        this.need = 3;
        return;
      }
      case "blockHeader": {
        const header = field[0] | field[1] << 8 | field[2] << 16;
        const lastBlock = (header & 1) === 1;
        const blockType = header >> 1 & 3;
        const blockSize = header >> 3;
        if (blockType === 3) {
          this.setFault("reserved block type");
          return;
        }
        const blockCeiling = Math.min(this.windowSize, BLOCK_CEILING);
        if (blockSize > blockCeiling) {
          this.setFault("block size exceeds min(window, 128 KiB)");
          return;
        }
        this.lastBlockSeen = lastBlock;
        const contentBytes = blockType === 1 ? 1 : blockSize;
        if (contentBytes === 0) {
          this.state = lastBlock ? this.checksumFlagged ? "checksum" : "done" : "blockHeader";
          this.need = this.state === "checksum" ? 4 : this.state === "blockHeader" ? 3 : 0;
          return;
        }
        this.state = "blockContent";
        this.blockBytesRemaining = contentBytes;
        this.need = 0;
        return;
      }
      case "checksum": {
        this.state = "done";
        this.need = 0;
        return;
      }
      default:
        return;
    }
  }
}
export function validateZstdFrame(buffer) {
  const validator = new ZstdFrameValidator;
  validator.update(buffer);
  return validator.finish();
}
