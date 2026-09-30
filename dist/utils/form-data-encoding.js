export class FormDataEncodingCache {
  form;
  cached;
  pending;
  constructor(form) {
    this.form = form;
    const cache = this;
    for (const name of ["append", "set", "delete"]) {
      const original = form[name];
      Object.defineProperty(form, name, {
        configurable: true,
        writable: true,
        value(...args) {
          if (this === form)
            cache.invalidate();
          Reflect.apply(original, this, args);
        }
      });
    }
  }
  invalidate() {
    this.cached = undefined;
    this.pending = undefined;
  }
  peek() {
    return this.cached;
  }
  read() {
    if (this.cached)
      return Promise.resolve(this.cached);
    if (this.pending)
      return this.pending;
    const operation = this.encode([...this.form.entries()]).then((encoding) => {
      if (this.pending === operation) {
        this.pending = undefined;
        this.cached = encoding;
      }
      return encoding;
    }, (error) => {
      if (this.pending === operation)
        this.pending = undefined;
      throw error;
    });
    this.pending = operation;
    return operation;
  }
  async encode(entries) {
    const snapshot = new FormData;
    for (const [name, value] of entries) {
      if (typeof value === "string")
        snapshot.append(name, value);
      else
        snapshot.append(name, value, value.name);
    }
    const response = new Response(snapshot);
    const contentType = response.headers.get("content-type") || "multipart/form-data";
    return { buffer: await response.arrayBuffer(), contentType };
  }
}
