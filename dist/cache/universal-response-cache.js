import { LRUCache } from './lru-cache.js';
const DEFAULT_TTL = 3000000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_METHODS = ["GET", "HEAD"];

export class UniversalResponseCache {
  memoryCache;
  config;
  constructor(options = true) {
    const config = options === true ? {} : options === false ? { enable: false } : options;
    this.config = {
      enable: config.enable !== false,
      networkCheck: config.networkCheck ?? false,
      ttl: config.ttl ?? DEFAULT_TTL,
      maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
      methods: config.methods ?? DEFAULT_METHODS,
      respectHeaders: config.respectHeaders ?? true
    };
    this.memoryCache = new LRUCache({
      maxEntries: this.config.maxEntries,
      ttl: this.config.ttl
    });
  }
  generateCacheKey(method, url, headers) {
    const varyHeader = headers?.["vary"];
    let key = `${method}:${url}`;
    if (varyHeader && headers) {
      const varyFields = varyHeader.split(",").map((f) => f.trim().toLowerCase());
      for (const field of varyFields) {
        const value = headers[field] || "";
        key += `:${field}=${value}`;
      }
    }
    return key;
  }
  parseCacheControl(headers) {
    const cacheControl = headers["cache-control"] || "";
    const directives = cacheControl.toLowerCase().split(",").map((d) => d.trim());
    let maxAge;
    for (const directive of directives) {
      if (directive.startsWith("max-age=")) {
        maxAge = parseInt(directive.substring(8), 10);
      }
    }
    return {
      noStore: directives.includes("no-store"),
      noCache: directives.includes("no-cache"),
      mustRevalidate: directives.includes("must-revalidate"),
      maxAge
    };
  }
  get(method, url, requestHeaders) {
    if (!this.config.enable)
      return;
    if (!this.config.methods.includes(method.toUpperCase()))
      return;
    const key = this.generateCacheKey(method, url, requestHeaders);
    const cached = this.memoryCache.get(key);
    if (!cached)
      return;
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.memoryCache.delete(key);
      return;
    }
    return cached;
  }
  set(method, url, response, requestHeaders) {
    if (!this.config.enable)
      return false;
    if (!this.config.methods.includes(method.toUpperCase()))
      return false;
    const responseHeaders = {};
    if (response.headers) {
      if (typeof response.headers.forEach === "function") {
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });
      } else if (typeof response.headers === "object") {
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders[key.toLowerCase()] = value;
          }
        }
      }
    }
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(responseHeaders);
      if (cacheControl.noStore)
        return false;
    }
    let ttl = this.config.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(responseHeaders);
      if (cacheControl.maxAge !== undefined) {
        ttl = cacheControl.maxAge * 1000;
      }
    }
    const key = this.generateCacheKey(method, url, requestHeaders);
    const cached = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      data: response.data,
      url,
      timestamp: Date.now(),
      ttl,
      etag: responseHeaders["etag"],
      lastModified: responseHeaders["last-modified"]
    };
    this.memoryCache.set(key, cached);
    return true;
  }
  getConditionalHeaders(method, url, requestHeaders) {
    const cached = this.get(method, url, requestHeaders);
    if (!cached)
      return null;
    if (!cached.etag && !cached.lastModified)
      return null;
    return {
      etag: cached.etag,
      lastModified: cached.lastModified
    };
  }
  updateRevalidated(method, url, responseHeaders, requestHeaders) {
    const key = this.generateCacheKey(method, url, requestHeaders);
    const cached = this.memoryCache.get(key);
    if (!cached)
      return null;
    let newTtl = this.config.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(responseHeaders);
      if (cacheControl.maxAge !== undefined) {
        newTtl = cacheControl.maxAge * 1000;
      }
    }
    const updated = {
      ...cached,
      timestamp: Date.now(),
      ttl: newTtl,
      etag: responseHeaders["etag"] || cached.etag,
      lastModified: responseHeaders["last-modified"] || cached.lastModified
    };
    this.memoryCache.set(key, updated);
    return updated;
  }
  clear() {
    this.memoryCache.clear();
  }
  size() {
    return this.memoryCache.size;
  }
}

export { UniversalResponseCache as ResponseCache };
export function normalizeResponseCacheConfig(option) {
  if (option === undefined || option === false)
    return;
  if (option === true)
    return { enable: true };
  return option;
}
