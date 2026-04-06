const { Cookie: TouchCookie } = require("tough-cookie");

class Cookie extends TouchCookie {
  constructor(options) {
    super(options);
    this.fixDateFields();
  }
  fixDateFields() {
    if (this.creation && typeof this.creation === "string") {
      this.creation = new Date(this.creation);
    }
    if (this.lastAccessed && typeof this.lastAccessed === "string") {
      this.lastAccessed = new Date(this.lastAccessed);
    }
    if (this.expires && typeof this.expires === "string" && this.expires !== "Infinity") {
      this.expires = new Date(this.expires);
    }
  }
  getExpires() {
    let expires = 0;
    if (this.expires && typeof this.expires !== "string") {
      expires = Math.round(this.expires.getTime() / 1000);
    } else if (this.maxAge) {
      if (this.maxAge === "Infinity") {
        expires = 2147483647;
      } else if (this.maxAge === "-Infinity") {
        expires = 0;
      } else if (typeof this.maxAge === "number") {
        expires = Math.round(Date.now() / 1000 + this.maxAge);
      }
    }
    return expires;
  }
  toNetscapeFormat() {
    const domain = !this.hostOnly ? this.domain.startsWith(".") ? this.domain : "." + this.domain : this.domain;
    const secure = this.secure ? "TRUE" : "FALSE";
    const expires = this.getExpires();
    return `${domain}	TRUE	${this.path}	${secure}	${expires}	${this.key}	${this.value}`;
  }
  toSetCookieString() {
    let str = this.cookieString();
    if (this.expires instanceof Date) {
      str += `; Expires=${this.expires.toUTCString()}`;
    }
    if (this.maxAge != null) {
      str += `; Max-Age=${this.maxAge}`;
    }
    if (this.domain) {
      str += `; Domain=${this.domain}`;
    }
    if (this.path) {
      str += `; Path=${this.path}`;
    }
    if (this.secure) {
      str += "; Secure";
    }
    if (this.httpOnly) {
      str += "; HttpOnly";
    }
    if (this.sameSite) {
      str += `; SameSite=${this.sameSite}`;
    }
    if (this.extensions) {
      str += `; ${this.extensions.join("; ")}`;
    }
    return str;
  }
  getURL() {
    if (!this.domain) {
      return;
    }
    const protocol = this.secure ? "https://" : "http://";
    const domain = this.domain.startsWith(".") ? this.domain.substring(1) : this.domain;
    const path = this.path || "/";
    return `${protocol}${domain}${path}`;
  }
  static isCookie(cookie) {
    return cookie instanceof Cookie || cookie instanceof TouchCookie;
  }
}

exports.RezoCookie = Cookie;
exports.Cookie = Cookie;