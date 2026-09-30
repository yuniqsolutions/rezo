const { createHmac, randomBytes } = require("node:crypto");

class Http2SessionIdentity {
  secret = randomBytes(32);
  opaqueSequence = 0;
  suffix(options) {
    const fields = Object.entries(options ?? {}).filter(([key, value]) => value !== undefined && !(key === "rejectUnauthorized" && value !== false));
    if (!fields.length)
      return "";
    const hash = createHmac("sha256", this.secret);
    this.add(Object.fromEntries(fields), hash, new Set);
    return `#connection:${hash.digest("hex")}`;
  }
  add(value, hash, ancestors) {
    if (value === undefined) {
      hash.update("U;");
      return;
    }
    if (value === null) {
      hash.update("N;");
      return;
    }
    const bytes = typeof value === "string" ? Buffer.from(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value instanceof ArrayBuffer ? new Uint8Array(value) : undefined;
    if (bytes) {
      hash.update(`B${bytes.byteLength}:`).update(bytes);
      return;
    }
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
      hash.update(`${typeof value}:${String(value)};`);
      return;
    }
    if (typeof value === "object" && !ancestors.has(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (Array.isArray(value)) {
        ancestors.add(value);
        hash.update(`A${value.length}:`);
        for (const item of value)
          this.add(item, hash, ancestors);
        ancestors.delete(value);
        return;
      }
      if (prototype === Object.prototype || prototype === null) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Object.keys(descriptors).sort();
        if (keys.every((key) => ("value" in descriptors[key]))) {
          ancestors.add(value);
          hash.update(`O${keys.length}:`);
          for (const key of keys) {
            this.add(key, hash, ancestors);
            this.add(descriptors[key].value, hash, ancestors);
          }
          ancestors.delete(value);
          return;
        }
      }
    }
    hash.update(`X${++this.opaqueSequence};`);
  }
}

exports.Http2SessionIdentity = Http2SessionIdentity;