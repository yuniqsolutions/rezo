export class Cookie {
  key;
  value;
  domain = null;
  path = "/";
  expires = null;
  httpOnly = false;
  secure = false;
  sameSite;
  maxAge = null;
  constructor(options) {
    this.key = options.key;
    this.value = options.value;
  }
  toString() {
    return `${this.key}=${this.value}`;
  }
  toJSON() {
    return { key: this.key, value: this.value };
  }
  static parse(_str) {
    return null;
  }
}
const EMPTY_COOKIES = { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] };

export class RezoCookieJar {
  constructor(_cookies, _url) {}
  setCookie(_c, _u) {}
  setCookiesSync(_c, _u) {}
  getCookiesSync(_u) {
    return [];
  }
  getCookieStringSync(_u) {
    return "";
  }
  getCookiesForRequest(_u) {
    return { cookiesString: "", cookies: [] };
  }
  getCookieHeader(_u) {
    return "";
  }
  removeAllCookiesSync() {}
  cookies() {
    return EMPTY_COOKIES;
  }
  toJSON() {
    return [];
  }
  static fromJSON(_d) {
    return new RezoCookieJar;
  }
  generateCookies(_u, _s) {
    return [];
  }
  parseResponseCookies(_s, _u) {
    return [];
  }
  toCookieString(_u) {
    return "";
  }
  toNetscapeCookie() {
    return "";
  }
}

export { Cookie as default };
