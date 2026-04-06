function parseBracketKey(key) {
  const match = key.match(/^([^[]+)(.*)/);
  if (!match)
    return [key];
  const root = match[1];
  const rest = match[2];
  const keys = [root];
  const bracketRegex = /\[([^\]]*)\]/g;
  let m;
  while ((m = bracketRegex.exec(rest)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

class RezoURLSearchParams extends URLSearchParams {
  nestedMode;
  constructor(init, options) {
    super();
    this.nestedMode = options?.nestedKeys || "json";
    if (init) {
      if (init instanceof RezoURLSearchParams) {
        this.nestedMode = options?.nestedKeys || init.nestedMode;
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
      const fullKey = prefix ? this.buildNestedKey(prefix, key) : key;
      this.appendValue(fullKey, value, !!prefix);
    });
  }
  buildNestedKey(prefix, key) {
    switch (this.nestedMode) {
      case "brackets":
        return `${prefix}[${key}]`;
      case "dots":
        return `${prefix}.${key}`;
      case "json":
      default:
        return key;
    }
  }
  setObject(obj, prefix = "") {
    if (prefix) {
      const keysToDelete = [];
      this.forEach((_, key) => {
        if (key.startsWith(prefix + "[") || key.startsWith(prefix + ".") || key === prefix) {
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
  appendValue(key, value, isNested = false) {
    if (value === null || value === undefined) {
      return;
    }
    if (value instanceof Date) {
      this.append(key, value.toISOString());
      return;
    }
    if (Array.isArray(value)) {
      if (this.nestedMode === "json" && !isNested) {
        this.append(key, JSON.stringify(value));
      } else {
        this.appendArray(key, value);
      }
      return;
    }
    if (typeof value === "object") {
      if (this.nestedMode === "json" && !isNested) {
        this.append(key, JSON.stringify(value));
      } else if (this.nestedMode === "json" && isNested) {
        this.append(key, JSON.stringify(value));
      } else {
        this.appendObject(value, key);
      }
      return;
    }
    this.append(key, String(value));
  }
  appendArray(key, arr) {
    arr.forEach((item, index) => {
      if (this.nestedMode === "dots") {
        this.appendValue(`${key}.${index}`, item, true);
      } else {
        this.appendValue(`${key}[${index}]`, item, true);
      }
    });
  }
  toFlatObject() {
    const obj = {};
    this.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  toObject() {
    const result = {};
    this.forEach((value, key) => {
      const keys = parseBracketKey(key);
      if (keys.length === 1) {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === "object" && parsed !== null) {
            result[key] = parsed;
            return;
          }
        } catch {}
        result[key] = value;
        return;
      }
      let current = result;
      for (let i = 0;i < keys.length - 1; i++) {
        const k = keys[i];
        const nextKey = keys[i + 1];
        if (current[k] === undefined) {
          current[k] = /^\d+$/.test(nextKey) ? [] : {};
        }
        current = current[k];
      }
      const lastKey = keys[keys.length - 1];
      current[lastKey] = value;
    });
    return result;
  }
  toString() {
    if (this.nestedMode === "brackets") {
      return super.toString().replace(/%5B/gi, "[").replace(/%5D/gi, "]");
    }
    return super.toString();
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