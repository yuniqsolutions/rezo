const { LRUCache } = require('./lru-cache.cjs');
const { createResponseCacheIdentity, identityMatchesTarget } = require('./response-cache-identity.cjs');
const { ResponseCachePersistence } = require('./response-cache-persistence.cjs');
const { registerCachePersistence } = require('./response-cache-readiness.cjs');
const { registerResponseCacheBackend } = require('./bound-response-cache.cjs');
const { RezoError } = require('../errors/rezo-error.cjs');
const DEFAULT_TTL = 3000000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_METHODS = ["GET", "HEAD"];

class ResponseCache {
  memoryCache;
  config;
  persistence;
  persistenceRefusalReported = false;
  writeGeneration = 0;
  lastWriteGeneration = new Map;
  clearedBeforeHydration = false;
  hydrationPending = false;
  constructor(options = true) {
    const config = options === true ? {} : options === false ? { enable: false } : options;
    this.config = {
      enable: config.enable !== false,
      cacheDir: config.cacheDir,
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
    this.persistence = new ResponseCachePersistence(this.config.cacheDir);
    registerCachePersistence(this, this.persistence);
    this.registerBoundBackend();
    if (this.config.cacheDir) {
      this.hydrationPending = true;
      this.persistence.settled.then(() => this.hydrateFromDisk());
    }
  }
  registerBoundBackend() {
    const guard = (operation) => {
      this.assertPersistenceHonoured();
      return operation();
    };
    registerResponseCacheBackend(this, {
      getByIdentity: (identity) => guard(() => this.getByIdentity(identity)),
      setByIdentity: (identity, method, url, response, headers) => guard(() => this.setByIdentity(identity, method, url, response, headers)),
      conditionalHeadersByIdentity: (identity) => guard(() => this.conditionalHeadersByIdentity(identity)),
      updateRevalidatedByIdentity: (identity, responseHeaders) => guard(() => this.updateRevalidatedByIdentity(identity, responseHeaders))
    });
  }
  assertPersistenceHonoured() {
    if (this.persistence.state !== "unavailable" || this.persistenceRefusalReported)
      return;
    this.persistenceRefusalReported = true;
    throw new RezoError("Cache Persistence Unavailable", { adapterUsed: null }, "REZ_CACHE_PERSISTENCE_UNAVAILABLE");
  }
  async hydrateFromDisk() {
    const entries = await this.persistence.hydrate();
    if (this.clearedBeforeHydration) {
      this.hydrationPending = false;
      return;
    }
    this.hydrationPending = false;
    const now = Date.now();
    for (const [identity, envelope] of entries) {
      if (this.memoryCache.get(identity))
        continue;
      const remainingTTL = envelope.timestamp + envelope.ttl - now;
      if (remainingTTL <= 0)
        continue;
      this.memoryCache.set(identity, this.toCachedResponse(envelope), remainingTTL);
    }
  }
  toCachedResponse(envelope) {
    return {
      status: envelope.status,
      statusText: envelope.statusText,
      headers: envelope.headers,
      data: envelope.data,
      url: "",
      timestamp: envelope.timestamp,
      ttl: envelope.ttl,
      etag: envelope.etag,
      lastModified: envelope.lastModified
    };
  }
  toEnvelope(identity, entry) {
    return {
      identity,
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
      data: entry.data,
      timestamp: entry.timestamp,
      ttl: entry.ttl,
      etag: entry.etag,
      lastModified: entry.lastModified
    };
  }
  generateKey(method, url, headers) {
    return createResponseCacheIdentity({ method, url, mode: null, headers });
  }
  parseCacheControl(headers) {
    const cacheControl = headers["cache-control"] || headers["Cache-Control"] || "";
    const result = {};
    if (cacheControl.includes("no-store"))
      result.noStore = true;
    if (cacheControl.includes("no-cache"))
      result.noCache = true;
    if (cacheControl.includes("must-revalidate"))
      result.mustRevalidate = true;
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      result.maxAge = parseInt(maxAgeMatch[1], 10) * 1000;
    }
    const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/);
    if (sMaxAgeMatch) {
      result.maxAge = parseInt(sMaxAgeMatch[1], 10) * 1000;
    }
    return result;
  }
  isCacheable(method, status, headers) {
    if (!this.config.enable)
      return false;
    if (!this.config.methods.includes(method.toUpperCase()))
      return false;
    if (status < 200 || status >= 300)
      return false;
    if (this.config.respectHeaders && headers) {
      const cacheControl = this.parseCacheControl(headers);
      if (cacheControl.noStore)
        return false;
    }
    return true;
  }
  get(method, url, headers) {
    if (!this.config.enable)
      return;
    const entry = this.getByIdentity(this.generateKey(method, url, headers));
    if (entry && !entry.url)
      entry.url = url;
    return entry;
  }
  getByIdentity(identity) {
    if (!this.config.enable)
      return;
    const cached = this.memoryCache.get(identity);
    if (cached)
      return cached;
    return this.loadSingleFromDisk(identity);
  }
  loadSingleFromDisk(identity) {
    const envelope = this.persistence.readOne(identity);
    if (!envelope)
      return;
    const remainingTTL = envelope.timestamp + envelope.ttl - Date.now();
    if (remainingTTL <= 0) {
      this.persistence.remove(identity);
      return;
    }
    const entry = this.toCachedResponse(envelope);
    this.memoryCache.set(identity, entry, remainingTTL);
    return entry;
  }
  set(method, url, response, requestHeaders) {
    this.storeEntry(method, url, response, requestHeaders);
  }
  storeEntry(method, url, response, requestHeaders, identity) {
    if (!this.config.enable)
      return;
    const responseHeaders = this.normalizeHeaders(response.headers);
    if (!this.isCacheable(method, response.status, responseHeaders))
      return;
    if ((responseHeaders["vary"] ?? "").trim() === "*")
      return;
    let ttl = this.config.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(responseHeaders);
      if (cacheControl.maxAge !== undefined) {
        ttl = cacheControl.maxAge;
      }
    }
    const key = identity ?? this.generateKey(method, url, requestHeaders);
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
    this.memoryCache.set(key, cached, ttl);
    this.lastWriteGeneration.set(key, ++this.writeGeneration);
    this.persistence.write(key, this.toEnvelope(key, cached));
  }
  setByIdentity(identity, method, url, response, requestHeaders) {
    this.storeEntry(method, url, response, requestHeaders, identity);
  }
  normalizeHeaders(headers) {
    const result = {};
    if (!headers)
      return result;
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
      });
    } else if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") {
          result[key.toLowerCase()] = value;
        } else if (Array.isArray(value)) {
          result[key.toLowerCase()] = value.join(", ");
        }
      }
    }
    return result;
  }
  getConditionalHeaders(method, url, requestHeaders) {
    return this.conditionalHeadersByIdentity(this.generateKey(method, url, requestHeaders));
  }
  conditionalHeadersByIdentity(identity) {
    const cached = this.getByIdentity(identity);
    if (!cached)
      return;
    const headers = {};
    if (cached.etag) {
      headers["If-None-Match"] = cached.etag;
    }
    if (cached.lastModified) {
      headers["If-Modified-Since"] = cached.lastModified;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
  updateRevalidated(method, url, newHeaders, requestHeaders) {
    return this.updateRevalidatedByIdentity(this.generateKey(method, url, requestHeaders), newHeaders);
  }
  updateRevalidatedByIdentity(key, newHeaders) {
    if (!this.config.enable)
      return;
    const cached = this.getByIdentity(key);
    if (!cached)
      return;
    const normalizedHeaders = this.normalizeHeaders(newHeaders);
    let ttl = cached.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(normalizedHeaders);
      if (cacheControl.noStore) {
        this.memoryCache.delete(key);
        this.persistence.remove(key);
        return;
      }
      if (cacheControl.maxAge !== undefined) {
        ttl = cacheControl.maxAge;
      }
    }
    const updated = {
      ...cached,
      timestamp: Date.now(),
      ttl,
      headers: { ...cached.headers, ...normalizedHeaders },
      etag: normalizedHeaders["etag"] || cached.etag,
      lastModified: normalizedHeaders["last-modified"] || cached.lastModified
    };
    this.memoryCache.set(key, updated, ttl);
    this.lastWriteGeneration.set(key, ++this.writeGeneration);
    this.persistence.write(key, this.toEnvelope(key, updated));
    return updated;
  }
  invalidate(url, method) {
    const matches = (identity) => identityMatchesTarget(identity, method, url);
    for (const key of this.memoryCache.keys()) {
      if (!matches(key))
        continue;
      this.memoryCache.delete(key);
      this.persistence.remove(key);
    }
    const issuedAt = this.writeGeneration;
    this.persistence.removeMatching(matches).then((removed) => {
      for (const identity of removed) {
        if ((this.lastWriteGeneration.get(identity) ?? 0) > issuedAt)
          continue;
        this.memoryCache.delete(identity);
        this.lastWriteGeneration.delete(identity);
      }
    });
  }
  clear() {
    this.memoryCache.clear();
    this.lastWriteGeneration.clear();
    if (this.hydrationPending)
      this.clearedBeforeHydration = true;
    this.persistence.removeAll();
  }
  get size() {
    return this.memoryCache.size;
  }
  get isEnabled() {
    return this.config.enable;
  }
  get isPersistent() {
    return this.persistence.isReady;
  }
  getConfig() {
    return { ...this.config };
  }
}
function normalizeResponseCacheConfig(option) {
  if (option === undefined || option === false)
    return;
  if (option === true)
    return { enable: true };
  return option;
}

exports.ResponseCache = ResponseCache;
exports.normalizeResponseCacheConfig = normalizeResponseCacheConfig;
exports.default = ResponseCache;
module.exports = Object.assign(ResponseCache, exports);