const NodeFormData = require("form-data");
const { Readable } = require("node:stream");

class RezoFormData extends NodeFormData {
  constructor(options) {
    super(options);
  }
  async getFieldEntries() {
    return new Promise((resolve, reject) => {
      const entries = [];
      const fields = this._fields || [];
      for (const field of fields) {
        if (field && field.name && field.value !== undefined) {
          entries.push([field.name, field.value]);
        }
      }
      resolve(entries);
    });
  }
  async toNativeFormData() {
    if (typeof globalThis !== "undefined" && typeof globalThis.FormData !== "undefined" || typeof global !== "undefined" && typeof global.FormData !== "undefined" || typeof window !== "undefined" && typeof window.FormData !== "undefined") {
      const formData = new FormData;
      const entries = await this.getFieldEntries();
      for (const [key, value] of entries) {
        if (value instanceof Readable) {
          const chunks = [];
          for await (const chunk of value) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);
          const blob = new Blob([buffer]);
          formData.append(key, blob);
        } else {
          formData.append(key, value);
        }
      }
      return formData;
    }
    return null;
  }
  static async fromNativeFormData(formData, options) {
    const rezoFormData = new RezoFormData(options);
    for (const [key, value] of Array.from(formData.entries())) {
      if (typeof File !== "undefined" && value instanceof File) {
        const file = value;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        rezoFormData.append(key, buffer, {
          filename: file.name,
          contentType: file.type || "application/octet-stream"
        });
      } else if (typeof Blob !== "undefined" && value instanceof Blob) {
        const blob = value;
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        rezoFormData.append(key, buffer, {
          contentType: blob.type || "application/octet-stream"
        });
      } else {
        rezoFormData.append(key, value);
      }
    }
    return rezoFormData;
  }
  getContentType() {
    return `multipart/form-data; boundary=${this.getBoundary()}`;
  }
  toBuffer() {
    return Buffer.from(this.toString());
  }
  static fromObject(obj, options) {
    const formData = new RezoFormData(options);
    for (const [key, value] of Object.entries(obj)) {
      RezoFormData.appendValue(formData, key, value);
    }
    return formData;
  }
  static appendValue(formData, key, value) {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      formData.append(key, String(value));
      return;
    }
    if (Buffer.isBuffer(value)) {
      formData.append(key, value, {
        contentType: "application/octet-stream"
      });
      return;
    }
    if (value instanceof Uint8Array) {
      formData.append(key, Buffer.from(value), {
        contentType: "application/octet-stream"
      });
      return;
    }
    if (value instanceof Readable) {
      formData.append(key, value);
      return;
    }
    if (typeof File !== "undefined" && value instanceof File) {
      formData.append(key, value, {
        filename: value.name,
        contentType: value.type || "application/octet-stream"
      });
      return;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      formData.append(key, value, {
        contentType: value.type || "application/octet-stream"
      });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        RezoFormData.appendValue(formData, key, item);
      }
      return;
    }
    if (typeof value === "object" && value !== null && "value" in value && (value.filename || value.contentType)) {
      const opts = {};
      if (value.filename)
        opts.filename = value.filename;
      if (value.contentType)
        opts.contentType = value.contentType;
      formData.append(key, value.value, opts);
      return;
    }
    if (typeof value === "object" && value !== null) {
      const jsonString = JSON.stringify(value);
      const jsonBuffer = Buffer.from(jsonString, "utf8");
      formData.append(key, jsonBuffer, {
        filename: `${key}.json`,
        contentType: "application/json"
      });
      return;
    }
    formData.append(key, String(value));
  }
  async toUrlQueryString(convertBinaryToBase64 = false) {
    const params = new URLSearchParams;
    let hasOmittedData = false;
    try {
      const entries = await this.getFieldEntries();
      for (const [name, value] of entries) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          params.append(name, String(value));
        } else if (value instanceof Buffer) {
          if (convertBinaryToBase64) {
            params.append(name, value.toString("base64"));
          } else {
            hasOmittedData = true;
          }
        } else if (value instanceof Readable || typeof File !== "undefined" && value instanceof File || typeof Blob !== "undefined" && value instanceof Blob) {
          if (convertBinaryToBase64 && value instanceof File) {
            hasOmittedData = true;
          } else {
            hasOmittedData = true;
          }
        } else if (typeof value === "object" && value && "value" in value) {
          if (typeof value.value === "string" || typeof value.value === "number" || typeof value.value === "boolean") {
            params.append(name, String(value.value));
          } else {
            hasOmittedData = true;
          }
        } else {
          hasOmittedData = true;
        }
      }
    } catch (error) {
      console.warn("RezoFormData.toUrlQueryString(): Error reading form data entries:", error);
    }
    if (hasOmittedData && !convertBinaryToBase64) {
      console.warn("RezoFormData.toUrlQueryString(): Binary data, files, and blobs have been omitted. Use convertBinaryToBase64=true to include binary data as base64 strings.");
    }
    return params.toString();
  }
  async toURLSearchParams(convertBinaryToBase64 = false) {
    const params = new URLSearchParams;
    let hasOmittedData = false;
    try {
      const entries = await this.getFieldEntries();
      for (const [name, value] of entries) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          params.append(name, String(value));
        } else if (value instanceof Buffer) {
          if (convertBinaryToBase64) {
            params.append(name, value.toString("base64"));
          } else {
            hasOmittedData = true;
          }
        } else if (value instanceof Readable || typeof File !== "undefined" && value instanceof File || typeof Blob !== "undefined" && value instanceof Blob) {
          if (convertBinaryToBase64 && value instanceof File) {
            hasOmittedData = true;
          } else {
            hasOmittedData = true;
          }
        } else if (typeof value === "object" && value && "value" in value) {
          if (typeof value.value === "string" || typeof value.value === "number" || typeof value.value === "boolean") {
            params.append(name, String(value.value));
          } else {
            hasOmittedData = true;
          }
        } else {
          hasOmittedData = true;
        }
      }
    } catch (error) {
      console.warn("RezoFormData.toURLSearchParams(): Error reading form data entries:", error);
    }
    if (hasOmittedData && !convertBinaryToBase64) {
      console.warn("RezoFormData.toURLSearchParams(): Binary data, files, and blobs have been omitted. Use convertBinaryToBase64=true to include binary data as base64 strings.");
    }
    return params;
  }
}

exports.RezoFormData = RezoFormData;
exports.default = RezoFormData;
module.exports = Object.assign(RezoFormData, exports);