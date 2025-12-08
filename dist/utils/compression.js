import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { Transform } from "node:stream";
let createZstdDecompress = null;
let zstdAvailable = null;
function getZstdDecompressor() {
  if (zstdAvailable === null) {
    try {
      const zlib = require("node:zlib");
      if (typeof zlib.createZstdDecompress === "function") {
        createZstdDecompress = zlib.createZstdDecompress;
        zstdAvailable = true;
      } else {
        zstdAvailable = false;
      }
    } catch {
      zstdAvailable = false;
    }
  }
  return createZstdDecompress;
}

export class CompressionUtil {
  static decompressStream(response, contentEncoding, config) {
    if (!contentEncoding) {
      return response;
    }
    if (!this.shouldDecompress(contentEncoding, config)) {
      return response;
    }
    const encoding = contentEncoding.toLowerCase();
    switch (encoding) {
      case "gzip":
      case "x-gzip":
        return response.pipe(createGunzip());
      case "deflate":
      case "x-deflate":
        return response.pipe(createInflate());
      case "gzip-raw":
        return response.pipe(createInflate({ windowBits: 15 }));
      case "br":
      case "brotli":
        return response.pipe(createBrotliDecompress());
      case "zstd":
        return this.createZstdDecompressStream(response);
      default:
        return response;
    }
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
  static createZstdDecompressStream(response) {
    const decompressor = getZstdDecompressor();
    if (!decompressor) {
      const passthrough = new Transform({
        transform(chunk, encoding, callback) {
          callback(new Error("zstd decompression not available: requires Node.js 22.15+ with native zstd support"));
        }
      });
      return response.pipe(passthrough);
    }
    return response.pipe(decompressor());
  }
  static getSupportedAlgorithms() {
    return ["gzip", "x-gzip", "deflate", "x-deflate", "gzip-raw", "br", "brotli", "zstd"];
  }
  static isSupported(contentEncoding) {
    return this.getSupportedAlgorithms().includes(contentEncoding.toLowerCase());
  }
}
