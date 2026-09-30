import { FormDataEncodingCache } from './form-data-encoding.js';
const hasBuffer = typeof Buffer !== "undefined";
function isBuffer(value) {
  return hasBuffer && Buffer.isBuffer(value);
}
function toBlob(value, contentType) {
  const options = contentType ? { type: contentType } : undefined;
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return new Blob([copy], options);
}

export class RezoFormData {
  _fd;
  _encoding;
  _boundary;
  constructor() {
    this._fd = new FormData;
    this._encoding = new FormDataEncodingCache(this._fd);
    this._boundary = "----RezoFormBoundary" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  append(name, value, filename) {
    this._invalidateCache();
    if (isBuffer(value)) {
      const blob = toBlob(value);
      if (filename) {
        this._fd.append(name, blob, filename);
      } else {
        this._fd.append(name, blob);
      }
    } else if (filename && value instanceof Blob) {
      this._fd.append(name, value, filename);
    } else {
      this._fd.append(name, value);
    }
  }
  set(name, value, filename) {
    this._invalidateCache();
    if (isBuffer(value)) {
      const blob = toBlob(value);
      if (filename) {
        this._fd.set(name, blob, filename);
      } else {
        this._fd.set(name, blob);
      }
    } else if (filename && value instanceof Blob) {
      this._fd.set(name, value, filename);
    } else {
      this._fd.set(name, value);
    }
  }
  get(name) {
    return this._fd.get(name);
  }
  getAll(name) {
    return this._fd.getAll(name);
  }
  has(name) {
    return this._fd.has(name);
  }
  delete(name) {
    this._invalidateCache();
    this._fd.delete(name);
  }
  entries() {
    return this._fd.entries();
  }
  keys() {
    return this._fd.keys();
  }
  values() {
    return this._fd.values();
  }
  forEach(callback) {
    this._fd.forEach(callback);
  }
  [Symbol.iterator]() {
    return this._fd.entries();
  }
  toNativeFormData() {
    return this._fd;
  }
  _invalidateCache() {
    this._encoding.invalidate();
  }
  getBoundary() {
    const contentType = this._encoding.peek()?.contentType;
    if (!contentType) {
      return "";
    }
    const match = contentType.match(/boundary=([^;]+)/);
    return match ? match[1] : "";
  }
  getContentType() {
    return this._encoding.peek()?.contentType || `multipart/form-data; boundary=${this._boundary}`;
  }
  async getContentTypeAsync() {
    return (await this._encoding.read()).contentType;
  }
  getHeaders() {
    const encoding = this._encoding.peek();
    if (encoding) {
      return { "content-type": encoding.contentType };
    }
    return {};
  }
  async getHeadersAsync() {
    const { contentType, buffer } = await this._encoding.read();
    return {
      "content-type": contentType,
      "content-length": String(buffer.byteLength)
    };
  }
  getLengthSync() {
    return this._encoding.peek()?.buffer.byteLength;
  }
  async getLength() {
    return (await this._encoding.read()).buffer.byteLength;
  }
  getBuffer() {
    const encoding = this._encoding.peek();
    if (!hasBuffer || !encoding) {
      return null;
    }
    return Buffer.from(encoding.buffer);
  }
  async toBuffer() {
    return Buffer.from((await this._encoding.read()).buffer);
  }
  async toArrayBuffer() {
    return (await this._encoding.read()).buffer;
  }
  async toUint8Array() {
    return new Uint8Array((await this._encoding.read()).buffer);
  }
  static fromObject(obj, options) {
    const fd = new RezoFormData;
    const useNestedKeys = options?.nestedKeys || false;
    const appendValue = (key, value, _isNested) => {
      if (value === null || value === undefined) {
        return;
      }
      if (typeof value === "string") {
        fd.append(key, value);
        return;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        fd.append(key, String(value));
        return;
      }
      if (value instanceof Blob) {
        const filename = value instanceof File ? value.name : undefined;
        fd.append(key, value, filename);
        return;
      }
      if (isBuffer(value)) {
        fd.append(key, toBlob(value));
        return;
      }
      if (value instanceof Uint8Array) {
        fd.append(key, toBlob(value));
        return;
      }
      if (value instanceof ArrayBuffer) {
        fd.append(key, new Blob([value]));
        return;
      }
      if (Array.isArray(value)) {
        if (useNestedKeys) {
          for (let i = 0;i < value.length; i++) {
            appendValue(`${key}[${i}]`, value[i], true);
          }
        } else {
          fd.append(key, JSON.stringify(value));
        }
        return;
      }
      if (typeof value === "object" && value !== null) {
        if ("value" in value && (("filename" in value) || ("contentType" in value))) {
          const v = value;
          if (v.value instanceof Blob) {
            fd.append(key, v.value, v.filename);
          } else if (isBuffer(v.value)) {
            const blob = toBlob(v.value, v.contentType);
            fd.append(key, blob, v.filename);
          } else if (v.value instanceof Uint8Array) {
            const blob = toBlob(v.value, v.contentType);
            fd.append(key, blob, v.filename);
          } else {
            fd.append(key, String(v.value));
          }
          return;
        }
        if (useNestedKeys) {
          for (const [subKey, subValue] of Object.entries(value)) {
            appendValue(`${key}[${subKey}]`, subValue, true);
          }
        } else {
          fd.append(key, JSON.stringify(value));
        }
        return;
      }
      fd.append(key, String(value));
    };
    for (const [key, value] of Object.entries(obj)) {
      appendValue(key, value, false);
    }
    return fd;
  }
  static createUrlEncoded(data) {
    const params = new URLSearchParams;
    for (const [key, value] of Object.entries(data)) {
      params.append(key, String(value));
    }
    return params.toString();
  }
  static fromNativeFormData(formData) {
    const fd = new RezoFormData;
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        fd.append(key, value);
      } else {
        const filename = value.name || undefined;
        fd.append(key, value, filename);
      }
    }
    return fd;
  }
  toUrlQueryString() {
    const params = new URLSearchParams;
    for (const [key, value] of this._fd.entries()) {
      if (typeof value === "string") {
        params.append(key, value);
      }
    }
    return params.toString();
  }
  toURLSearchParams() {
    const params = new URLSearchParams;
    for (const [key, value] of this._fd.entries()) {
      if (typeof value === "string") {
        params.append(key, value);
      }
    }
    return params;
  }
}
export default RezoFormData;
