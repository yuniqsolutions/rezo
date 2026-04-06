import * as zlib from "node:zlib";
import { Transform } from "node:stream";
function looksCompressed(data, encoding) {
  if (data.length < 2)
    return false;
  const enc = encoding.toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") {
    return data[0] === 31 && data[1] === 139;
  }
  if (enc === "deflate" || enc === "x-deflate") {
    return data[0] === 120;
  }
  if (enc === "zstd") {
    return data[0] === 40 && data[1] === 181 && data[2] === 47 && data[3] === 253;
  }
  if (enc === "br" || enc === "brotli") {
    let i = 0;
    while (i < data.length && (data[i] === 32 || data[i] === 9 || data[i] === 10 || data[i] === 13)) {
      i++;
    }
    if (i >= data.length) {
      return false;
    }
    const firstNonWhitespace = data[i];
    const textStarts = [
      123,
      91,
      34,
      39,
      60,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      45,
      43,
      46,
      116,
      102,
      110,
      84,
      70,
      78
    ];
    if (textStarts.includes(firstNonWhitespace)) {
      return false;
    }
    if (data[0] === 239 && data.length >= 3 && data[1] === 187 && data[2] === 191) {
      return false;
    }
    const checkLen = Math.min(16, data.length);
    let printableCount = 0;
    for (let j = 0;j < checkLen; j++) {
      if (data[j] >= 32 && data[j] <= 126) {
        printableCount++;
      }
    }
    if (printableCount >= checkLen * 0.8) {
      return false;
    }
    return true;
  }
  return true;
}

class SmartDecompressStream extends Transform {
  encoding;
  decompressor = null;
  isCompressed = null;
  buffer = Buffer.alloc(0);
  headerChecked = false;
  passThrough = false;
  constructor(encoding) {
    super();
    this.encoding = encoding.toLowerCase();
  }
  _transform(chunk, _encoding, callback) {
    if (!this.headerChecked) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length >= 4) {
        this.headerChecked = true;
        this.isCompressed = looksCompressed(this.buffer, this.encoding);
        if (this.isCompressed) {
          this.decompressor = this.createDecompressor();
          if (this.decompressor) {
            this.decompressor.on("data", (data) => this.push(data));
            this.decompressor.on("error", (err) => {
              this.destroy(err);
            });
            this.decompressor.write(this.buffer);
          } else {
            this.passThrough = true;
            this.push(this.buffer);
          }
        } else {
          this.passThrough = true;
          this.push(this.buffer);
        }
        this.buffer = Buffer.alloc(0);
        callback();
        return;
      }
      callback();
      return;
    }
    if (this.passThrough) {
      this.push(chunk);
      callback();
    } else if (this.decompressor) {
      this.decompressor.write(chunk, callback);
    } else {
      callback();
    }
  }
  _flush(callback) {
    if (!this.headerChecked && this.buffer.length > 0) {
      this.isCompressed = looksCompressed(this.buffer, this.encoding);
      if (this.isCompressed && this.buffer.length > 0) {
        const decompressor = this.createDecompressor();
        if (decompressor) {
          const chunks = [];
          decompressor.on("data", (data) => chunks.push(data));
          decompressor.on("end", () => {
            this.push(Buffer.concat(chunks));
            callback();
          });
          decompressor.on("error", () => {
            this.push(this.buffer);
            callback();
          });
          decompressor.end(this.buffer);
          return;
        }
      }
      this.push(this.buffer);
      callback();
      return;
    }
    if (this.decompressor) {
      this.decompressor.end();
      this.decompressor.once("end", () => callback());
    } else {
      callback();
    }
  }
  createDecompressor() {
    switch (this.encoding) {
      case "gzip":
      case "x-gzip":
        return zlib.createGunzip();
      case "deflate":
      case "x-deflate":
        return zlib.createInflate();
      case "gzip-raw":
        return zlib.createInflate({ windowBits: 15 });
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

export class CompressionUtil {
  static decompressStream(response, contentEncoding, config) {
    if (!contentEncoding) {
      return response;
    }
    if (!this.shouldDecompress(contentEncoding, config)) {
      return response;
    }
    const encoding = contentEncoding.toLowerCase();
    const smartStream = new SmartDecompressStream(encoding);
    return response.pipe(smartStream);
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
