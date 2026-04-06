import { RezoMemoryCookieStore } from './memory-store.js';

export class RezoCookieStore extends RezoMemoryCookieStore {
  options;
  constructor(options) {
    super();
    this.options = options || {};
    this.synchronous = true;
  }
  putCookie(cookie, callback) {
    if (this.options.autoPurge) {
      this.purgeExpiredSync();
    }
    if (this.options.maxCookiesPerDomain && cookie.domain) {
      const domainCount = this.countCookiesForDomainSync(cookie.domain);
      if (domainCount >= this.options.maxCookiesPerDomain) {
        this.evictOldestForDomainSync(cookie.domain);
      }
    }
    if (this.options.maxTotalCookies) {
      const total = this.countAllSync();
      if (total >= this.options.maxTotalCookies) {
        this.evictOldestSync();
      }
    }
    if (callback) {
      super.putCookie(cookie, (err) => {
        if (!err)
          this.emitChange("put", cookie);
        callback(err);
      });
    } else {
      return super.putCookie(cookie).then(() => {
        this.emitChange("put", cookie);
      });
    }
  }
  updateCookie(_oldCookie, newCookie, callback) {
    if (callback) {
      super.updateCookie(_oldCookie, newCookie, (err) => {
        if (!err)
          this.emitChange("update", newCookie);
        callback(err);
      });
    } else {
      return super.updateCookie(_oldCookie, newCookie).then(() => {
        this.emitChange("update", newCookie);
      });
    }
  }
  removeCookie(domain, path, key, callback) {
    if (callback) {
      super.removeCookie(domain, path, key, (err) => {
        if (!err)
          this.emitChange("remove", undefined, domain, path, key);
        callback(err);
      });
    } else {
      return super.removeCookie(domain, path, key).then(() => {
        this.emitChange("remove", undefined, domain, path, key);
      });
    }
  }
  removeAllCookies(callback) {
    const count = this.countAllSync();
    if (callback) {
      super.removeAllCookies((err) => {
        if (!err)
          this.options.onChange?.({ type: "remove-all", count, timestamp: Date.now() });
        callback(err);
      });
    } else {
      return super.removeAllCookies().then(() => {
        this.options.onChange?.({ type: "remove-all", count, timestamp: Date.now() });
      });
    }
  }
  getDomains() {
    return Object.keys(this.idx);
  }
  getCookiesForDomain(domain) {
    const domainEntry = this.idx[domain];
    if (!domainEntry)
      return [];
    const cookies = [];
    for (const path of Object.values(domainEntry)) {
      for (const cookie of Object.values(path)) {
        cookies.push(cookie);
      }
    }
    return cookies;
  }
  countCookiesForDomainSync(domain) {
    const domainEntry = this.idx[domain];
    if (!domainEntry)
      return 0;
    let count = 0;
    for (const path of Object.values(domainEntry)) {
      count += Object.keys(path).length;
    }
    return count;
  }
  countAllSync() {
    let count = 0;
    for (const domain of Object.values(this.idx)) {
      for (const path of Object.values(domain)) {
        count += Object.keys(path).length;
      }
    }
    return count;
  }
  hasDomain(domain) {
    return domain in this.idx && this.countCookiesForDomainSync(domain) > 0;
  }
  findCookieSync(domain, path, key) {
    return this.idx[domain]?.[path]?.[key];
  }
  purgeExpiredSync() {
    let purged = 0;
    for (const [domain, paths] of Object.entries(this.idx)) {
      for (const [path, cookies] of Object.entries(paths)) {
        for (const [key, cookie] of Object.entries(cookies)) {
          if (cookie.TTL() <= 0) {
            delete this.idx[domain][path][key];
            purged++;
          }
        }
        if (Object.keys(this.idx[domain][path]).length === 0) {
          delete this.idx[domain][path];
        }
      }
      if (Object.keys(this.idx[domain]).length === 0) {
        delete this.idx[domain];
      }
    }
    if (purged > 0) {
      this.options.onChange?.({ type: "purge", count: purged, timestamp: Date.now() });
    }
    return purged;
  }
  getExpiredCookies() {
    const expired = [];
    for (const paths of Object.values(this.idx)) {
      for (const cookies of Object.values(paths)) {
        for (const cookie of Object.values(cookies)) {
          if (cookie.TTL() <= 0) {
            expired.push(cookie);
          }
        }
      }
    }
    return expired;
  }
  evictOldestForDomainSync(domain) {
    const cookies = this.getCookiesForDomain(domain);
    if (cookies.length === 0)
      return;
    cookies.sort((a, b) => {
      const aTime = a.creation instanceof Date ? a.creation.getTime() : 0;
      const bTime = b.creation instanceof Date ? b.creation.getTime() : 0;
      return aTime - bTime;
    });
    const oldest = cookies[0];
    if (oldest.domain && oldest.path && oldest.key) {
      delete this.idx[oldest.domain]?.[oldest.path]?.[oldest.key];
    }
  }
  evictOldestSync() {
    let oldest = null;
    for (const paths of Object.values(this.idx)) {
      for (const cookies of Object.values(paths)) {
        for (const cookie of Object.values(cookies)) {
          const cookieTime = cookie.creation instanceof Date ? cookie.creation.getTime() : 0;
          const oldestTime = oldest?.creation instanceof Date ? oldest.creation.getTime() : 0;
          if (!oldest || cookieTime < oldestTime) {
            oldest = cookie;
          }
        }
      }
    }
    if (oldest?.domain && oldest.path && oldest.key) {
      delete this.idx[oldest.domain]?.[oldest.path]?.[oldest.key];
    }
  }
  getStats() {
    let totalCookies = 0;
    let expiredCookies = 0;
    let secureCookies = 0;
    let httpOnlyCookies = 0;
    let sessionCookies = 0;
    const domainsBreakdown = {};
    for (const [domain, paths] of Object.entries(this.idx)) {
      let domainCount = 0;
      for (const cookies of Object.values(paths)) {
        for (const cookie of Object.values(cookies)) {
          totalCookies++;
          domainCount++;
          if (cookie.secure)
            secureCookies++;
          if (cookie.httpOnly)
            httpOnlyCookies++;
          const ttl = cookie.TTL();
          if (ttl === 1 / 0) {
            sessionCookies++;
          } else if (ttl <= 0) {
            expiredCookies++;
          }
        }
      }
      domainsBreakdown[domain] = domainCount;
    }
    return {
      totalCookies,
      totalDomains: Object.keys(this.idx).length,
      domainsBreakdown,
      expiredCookies,
      secureCookies,
      httpOnlyCookies,
      sessionCookies
    };
  }
  removeCookiesForDomainSync(domain) {
    const count = this.countCookiesForDomainSync(domain);
    delete this.idx[domain];
    if (count > 0) {
      this.emitChange("remove", undefined, domain);
    }
    return count;
  }
  exportCookiesSync() {
    const cookies = [];
    for (const paths of Object.values(this.idx)) {
      for (const keys of Object.values(paths)) {
        for (const cookie of Object.values(keys)) {
          cookies.push(cookie);
        }
      }
    }
    return cookies;
  }
  importCookiesSync(cookies) {
    for (const cookie of cookies) {
      if (!cookie.domain || !cookie.path || !cookie.key)
        continue;
      const domain = cookie.domain;
      const path = cookie.path;
      if (!this.idx[domain])
        this.idx[domain] = {};
      if (!this.idx[domain][path])
        this.idx[domain][path] = {};
      this.idx[domain][path][cookie.key] = cookie;
    }
  }
  emitChange(type, cookie, domain, path, key) {
    this.options.onChange?.({
      type,
      domain: cookie?.domain || domain,
      path: cookie?.path || path,
      key: cookie?.key || key,
      cookie,
      timestamp: Date.now()
    });
  }
}
