export class RezoUri extends URL {
  get params() {
    const obj = {};
    this.searchParams.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }
  set params(value) {
    const keys = Array.from(this.searchParams.keys());
    for (const k of keys)
      this.searchParams.delete(k);
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        this.searchParams.set(k, String(v));
      }
    }
  }
  get auth() {
    return {
      username: decodeURIComponent(this.username),
      password: decodeURIComponent(this.password)
    };
  }
  set auth(value) {
    this.username = encodeURIComponent(value.username);
    this.password = encodeURIComponent(value.password);
  }
  toObject() {
    return {
      href: this.href,
      origin: this.origin,
      protocol: this.protocol,
      username: decodeURIComponent(this.username),
      password: decodeURIComponent(this.password),
      host: this.host,
      hostname: this.hostname,
      port: this.port,
      pathname: this.pathname,
      search: this.search,
      hash: this.hash,
      params: this.params
    };
  }
  clone() {
    return new RezoUri(this.href);
  }
  toJSON() {
    return this.href;
  }
  static from(url) {
    return new RezoUri(url.toString());
  }
}
