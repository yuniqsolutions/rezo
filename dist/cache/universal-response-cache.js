import { LRUCache } from './lru-cache.js';
import { createResponseCacheIdentity, identityMatchesTarget } from './response-cache-identity.js';
import { registerResponseCacheBackend } from './bound-response-cache.js';
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
    registerResponseCacheBackend(this, {
      getByIdentity: (identity) => this.getByIdentity(identity),
      setByIdentity: (identity, method, url, response, headers) => void this.storeEntry(method, url, response, headers, identity),
      conditionalHeadersByIdentity: (identity) => this.conditionalHeadersByIdentity(identity),
      updateRevalidatedByIdentity: (identity, responseHeaders) => this.updateRevalidatedByIdentity(identity, responseHeaders)
    });
  }
  generateCacheKey(method, url, headers) {
    return createResponseCacheIdentity({ method, url, mode: null, headers });
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
    if (!this.config.methods.includes(method.toUpperCase()))
      return;
    return this.getByIdentity(this.generateCacheKey(method, url, requestHeaders));
  }
  getByIdentity(identity) {
    if (!this.config.enable)
      return;
    const cached = this.memoryCache.get(identity);
    if (!cached)
      return;
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.memoryCache.delete(identity);
      return;
    }
    return cached;
  }
  set(method, url, response, requestHeaders) {
    return this.storeEntry(method, url, response, requestHeaders);
  }
  storeEntry(method, url, response, requestHeaders, identity) {
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
    if ((responseHeaders["vary"] ?? "").trim() === "*")
      return false;
    const key = identity ?? this.generateCacheKey(method, url, requestHeaders);
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
    return this.conditionalHeadersByIdentity(this.generateCacheKey(method, url, requestHeaders));
  }
  conditionalHeadersByIdentity(identity) {
    const cached = this.getByIdentity(identity);
    if (!cached)
      return;
    const headers = {};
    if (cached.etag)
      headers["If-None-Match"] = cached.etag;
    if (cached.lastModified)
      headers["If-Modified-Since"] = cached.lastModified;
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
  updateRevalidated(method, url, responseHeaders, requestHeaders) {
    return this.updateRevalidatedByIdentity(this.generateCacheKey(method, url, requestHeaders), responseHeaders);
  }
  updateRevalidatedByIdentity(key, responseHeaders) {
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
  get size() {
    return this.memoryCache.size;
  }
  invalidate(url, method) {
    for (const key of this.memoryCache.keys()) {
      if (identityMatchesTarget(key, method, url))
        this.memoryCache.delete(key);
    }
  }
  get isEnabled() {
    return this.config.enable;
  }
  get isPersistent() {
    return false;
  }
  getConfig() {
    return { ...this.config };
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
