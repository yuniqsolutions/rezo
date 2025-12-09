class RezoURLSearchParams extends URLSearchParams {
  constructor(init) {
    super();
    if (init) {
      if (init instanceof RezoURLSearchParams) {
        this.appendObject(init.toObject());
      } else if (typeof init === "string" || init instanceof URLSearchParams || Array.isArray(init)) {
        const params = new URLSearchParams(init);
        params.forEach((value, key) => this.append(key, value));
      } else {
        this.appendObject(init);
      }
    }
  }
  appendObject(obj, prefix = "") {
    Object.entries(obj).forEach(([key, value]) => {
      this.appendValue(prefix ? `${prefix}[${key}]` : key, value);
    });
  }
  setObject(obj, prefix = "") {
    if (prefix) {
      const keysToDelete = [];
      this.forEach((_, key) => {
        if (key.startsWith(prefix + "[")) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach((key) => this.delete(key));
    } else {
      const keysToDelete = [];
      this.forEach((_, key) => keysToDelete.push(key));
      keysToDelete.forEach((key) => this.delete(key));
    }
    this.appendObject(obj, prefix);
  }
  appendValue(key, value) {
    if (value === null || value === undefined) {
      return;
    }
    if (value instanceof Date) {
      this.append(key, value.toISOString());
      return;
    }
    if (Array.isArray(value)) {
      this.appendArray(key, value);
      return;
    }
    if (typeof value === "object") {
      this.appendObject(value, key);
      return;
    }
    this.append(key, String(value));
  }
  appendArray(key, arr) {
    arr.forEach((item, index) => {
      this.appendValue(`${key}[${index}]`, item);
    });
  }
  toObject() {
    const obj = {};
    this.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  static fromFlat(flat) {
    const params = new RezoURLSearchParams;
    Object.entries(flat).forEach(([key, value]) => {
      params.append(key, value);
    });
    return params;
  }
}

exports.RezoURLSearchParams = RezoURLSearchParams;