import util from "node:util";

class RezoHeaders extends Headers {
  constructor(init) {
    if (init instanceof RezoHeaders) {
      super(init.toNative());
    } else if (init instanceof Headers || Array.isArray(init)) {
      super(init);
    } else if (typeof init === "object") {
      const isValueArray = Object.values(init).some((value) => Array.isArray(value));
      if (isValueArray) {
        const headers = new Headers;
        for (const [key, value] of Object.entries(init)) {
          if (Array.isArray(value)) {
            value.forEach((v) => headers.append(key, v));
          } else {
            headers.append(key, value);
          }
        }
        super(headers);
      } else {
        super(init);
      }
    } else {
      super(init);
    }
  }
  getAll(name) {
    if (typeof super.getAll === "function" || super.getAll !== undefined) {
      return super.getAll(name);
    }
    if (super.has(name)) {
      return super.get(name).split(",");
    }
    return [];
  }
  getSetCookie() {
    if (typeof super.getSetCookie === "function" || super.getSetCookie !== undefined) {
      return super.getSetCookie();
    }
    return this.getAll("set-cookie");
  }
  get size() {
    let size = 0;
    super.forEach(() => size++);
    return size;
  }
  setContentType(value) {
    this.set("content-type", value);
    return this;
  }
  getContentType() {
    return this.get("content-type") || undefined;
  }
  setAuthorization(value) {
    this.set("authorization", value);
    return this;
  }
  setUserAgent(value) {
    this.set("user-agent", value);
    return this;
  }
  getUserAgent() {
    return this.get("user-agent") || undefined;
  }
  getKeys() {
    const keys = [];
    super.forEach((_, key) => {
      keys.push(key);
    });
    return keys;
  }
  getValues() {
    const values = [];
    super.forEach((value) => {
      values.push(value);
    });
    return values;
  }
  toEntries() {
    return Object.entries(Object.fromEntries(super.entries()));
  }
  toNative() {
    const headers = new Headers;
    super.forEach((value, key) => {
      headers.append(key, value);
    });
    return headers;
  }
  toRaw() {
    const headers = [];
    for (const header of this.toArray()) {
      headers.push([header.key, header.value]);
    }
    return headers;
  }
  toArray() {
    const headers = [];
    for (const [key, value] of this) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.push({ key, value: v }));
      } else {
        headers.push({ key, value });
      }
    }
    return headers;
  }
  toObject(omit) {
    const headers = {};
    omit = (omit ? typeof omit === "string" ? [omit] : omit : []).map((key) => key.toLowerCase());
    for (const [key, value] of super.entries()) {
      if (omit.length > 0) {
        if (omit.includes(key.toLowerCase())) {
          continue;
        }
      }
      if (key.toLowerCase() === "set-cookie") {
        if (!headers[key]) {
          const cookies = this.getSetCookie();
          if (cookies.length > 0) {
            headers[key] = cookies;
          } else {
            headers[key] = cookies[0];
          }
        }
        continue;
      } else {
        headers[key] = value;
      }
    }
    return headers;
  }
  toString() {
    return this.toArray().map(({ key, value }) => key + ": " + value).join(`
`);
  }
  set(name, value) {
    super.set(name, value);
  }
  append(name, value) {
    super.append(name, value);
  }
  get(name) {
    return super.get(name);
  }
  has(name) {
    return super.has(name);
  }
  [Symbol.iterator]() {
    return Object.entries(this.toObject())[Symbol.iterator]();
  }
  [util.inspect.custom](_depth, options) {
    return `${this[Symbol.toStringTag]} ${util.inspect(this.toObject(), options)}`;
  }
  get [Symbol.toStringTag]() {
    return "RezoHeaders";
  }
}
function sanitizeHttp2Headers(headers) {
  const result = {};
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key === "symbol")
      continue;
    if (key.startsWith(":"))
      continue;
    const value = headers[key];
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }
  return result;
}

export { RezoHeaders, sanitizeHttp2Headers };
export default RezoHeaders;
