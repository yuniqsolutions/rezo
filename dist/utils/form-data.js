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
  _cachedContentType = null;
  _cachedBuffer = null;
  _boundary;
  constructor() {
    this._fd = new FormData;
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
    this._cachedContentType = null;
    this._cachedBuffer = null;
  }
  async _buildResponse() {
    if (this._cachedBuffer === null || this._cachedContentType === null) {
      const response = new Response(this._fd);
      this._cachedContentType = response.headers.get("content-type") || "multipart/form-data";
      this._cachedBuffer = await response.arrayBuffer();
    }
    return new Response(this._cachedBuffer, {
      headers: { "content-type": this._cachedContentType }
    });
  }
  getBoundary() {
    if (!this._cachedContentType) {
      return "";
    }
    const match = this._cachedContentType.match(/boundary=([^;]+)/);
    return match ? match[1] : "";
  }
  getContentType() {
    return this._cachedContentType || `multipart/form-data; boundary=${this._boundary}`;
  }
  async getContentTypeAsync() {
    await this._buildResponse();
    return this._cachedContentType;
  }
  getHeaders() {
    if (this._cachedContentType) {
      return { "content-type": this._cachedContentType };
    }
    return {};
  }
  async getHeadersAsync() {
    const contentType = await this.getContentTypeAsync();
    const length = await this.getLength();
    return {
      "content-type": contentType,
      "content-length": String(length)
    };
  }
  getLengthSync() {
    return this._cachedBuffer?.byteLength;
  }
  async getLength() {
    await this._buildResponse();
    return this._cachedBuffer.byteLength;
  }
  getBuffer() {
    if (!hasBuffer || !this._cachedBuffer) {
      return null;
    }
    return Buffer.from(this._cachedBuffer);
  }
  async toBuffer() {
    await this._buildResponse();
    return Buffer.from(this._cachedBuffer);
  }
  async toArrayBuffer() {
    await this._buildResponse();
    return this._cachedBuffer;
  }
  async toUint8Array() {
    await this._buildResponse();
    return new Uint8Array(this._cachedBuffer);
  }
  static fromObject(obj, options) {
    const fd = new RezoFormData;
    const useNestedKeys = options?.nestedKeys || false;
    const appendValue = (key, value, isNested) => {
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
