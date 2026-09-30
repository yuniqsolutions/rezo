const zlib = require("node:zlib");
const { Transform } = require("node:stream");
const { ZstdFrameValidator } = require('./zstd-frame-validator.cjs');
const ZSTD_UNAVAILABLE_MARKER = exports.ZSTD_UNAVAILABLE_MARKER = "REZ_INTERNAL_ZSTD_UNAVAILABLE";
function zstdStreamsAvailable() {
  return typeof zlib.createZstdDecompress === "function";
}
function createZstdUnavailableError() {
  const error = new Error("zstd decompression is not available in this runtime (Node.js gained zlib zstd support in 22.15); the encoded body was not decoded");
  error.code = ZSTD_UNAVAILABLE_MARKER;
  return error;
}

class StrictDecompressStream extends Transform {
  decompressor;
  zstdValidator;
  unavailable;
  flushSettled = false;
  receivedBytes = 0;
  constructor(encoding) {
    super();
    const normalized = encoding.toLowerCase();
    this.zstdValidator = normalized === "zstd" ? new ZstdFrameValidator : null;
    if (normalized === "zstd" && !zstdStreamsAvailable()) {
      this.unavailable = createZstdUnavailableError();
      this.decompressor = null;
      return;
    }
    this.unavailable = null;
    this.decompressor = StrictDecompressStream.createDecompressor(normalized);
    if (this.decompressor) {
      this.decompressor.on("data", (data) => this.push(data));
      this.decompressor.on("error", (err) => {
        if (this.flushSettled)
          return;
        this.flushSettled = true;
        this.destroy(err);
      });
    }
  }
  _transform(chunk, _encoding, callback) {
    this.receivedBytes += chunk.length;
    if (this.unavailable) {
      callback(this.unavailable);
      return;
    }
    if (this.zstdValidator) {
      this.zstdValidator.update(chunk);
      const verdict = this.zstdValidator.finish();
      if (verdict.fault) {
        callback(new Error(`invalid zstd frame: ${verdict.fault}`));
        return;
      }
    }
    if (!this.decompressor) {
      callback();
      return;
    }
    this.decompressor.write(chunk, callback);
  }
  _flush(callback) {
    if (this.receivedBytes === 0) {
      callback();
      return;
    }
    if (this.unavailable) {
      callback(this.unavailable);
      return;
    }
    if (this.zstdValidator) {
      const verdict = this.zstdValidator.finish();
      if (!verdict.complete) {
        callback(new Error(verdict.fault ? `invalid zstd frame: ${verdict.fault}` : "truncated zstd frame: the encoded body ended before the frame was structurally complete"));
        return;
      }
    }
    if (!this.decompressor) {
      callback();
      return;
    }
    const settle = (error) => {
      if (this.flushSettled)
        return;
      this.flushSettled = true;
      callback(error ?? null);
    };
    this.decompressor.once("end", () => settle());
    this.decompressor.once("error", (err) => settle(err));
    this.decompressor.end();
  }
  static createDecompressor(encoding) {
    switch (encoding) {
      case "gzip":
      case "x-gzip":
        return zlib.createGunzip();
      case "deflate":
      case "x-deflate":
        return zlib.createInflate();
      case "gzip-raw":
        return zlib.createInflateRaw();
      case "br":
      case "brotli":
        return zlib.createBrotliDecompress();
      case "zstd":
        return zlib.createZstdDecompress();
      default:
        return null;
    }
  }
}

class CompressionUtil {
  static decompressStream(response, contentEncoding, config) {
    if (!contentEncoding) {
      return response;
    }
    if (!this.shouldDecompress(contentEncoding, config)) {
      return response;
    }
    const encoding = contentEncoding.toLowerCase();
    if (!this.isSupported(encoding)) {
      return response;
    }
    return response.pipe(new StrictDecompressStream(encoding));
  }
  static shouldDecompress(contentEncoding, config) {
    if (!config) {
      return true;
    }
    if (config.decompress === false) {
      return false;
    }
    if (config.compression?.enabled === false) {
      return false;
    }
    if (config.compression?.algorithms) {
      return config.compression.algorithms.includes(contentEncoding.toLowerCase());
    }
    return true;
  }
  static getSupportedAlgorithms() {
    return ["gzip", "x-gzip", "deflate", "x-deflate", "gzip-raw", "br", "brotli", "zstd"];
  }
  static isSupported(contentEncoding) {
    return this.getSupportedAlgorithms().includes(contentEncoding.toLowerCase());
  }
}

exports.CompressionUtil = CompressionUtil;