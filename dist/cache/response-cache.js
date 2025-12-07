import { LRUCache } from './lru-cache.js';
import fs from "fs";
import path from "path";
const fsPromises = fs.promises;
const DEFAULT_TTL = 3000000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_METHODS = ["GET", "HEAD"];

export class ResponseCache {
  memoryCache;
  config;
  persistenceEnabled;
  initialized = false;
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
    this.persistenceEnabled = !!this.config.cacheDir;
    this.memoryCache = new LRUCache({
      maxEntries: this.config.maxEntries,
      ttl: this.config.ttl,
      onEvict: this.persistenceEnabled ? (key, value) => this.persistToDisk(key, value) : undefined
    });
    if (this.persistenceEnabled) {
      this.initializePersistence();
    }
  }
  initializePersistence() {
    if (!this.config.cacheDir || this.initialized)
      return;
    this.initializePersistenceAsync().catch(() => {
      this.persistenceEnabled = false;
    });
  }
  async initializePersistenceAsync() {
    if (!this.config.cacheDir)
      return;
    try {
      await fsPromises.mkdir(this.config.cacheDir, { recursive: true });
      await this.loadFromDiskAsync();
      this.initialized = true;
    } catch {
      this.persistenceEnabled = false;
    }
  }
  getCacheFilePath(key) {
    const safeKey = Buffer.from(key).toString("base64url");
    return path.join(this.config.cacheDir, `${safeKey}.json`);
  }
  persistToDisk(key, entry) {
    if (!this.persistenceEnabled || !this.config.cacheDir)
      return;
    const filePath = this.getCacheFilePath(key);
    fsPromises.writeFile(filePath, JSON.stringify(entry), "utf-8").catch(() => {});
  }
  async loadFromDiskAsync() {
    if (!this.persistenceEnabled || !this.config.cacheDir)
      return;
    try {
      const files = await fsPromises.readdir(this.config.cacheDir);
      const now = Date.now();
      for (const file of files) {
        if (!file.endsWith(".json"))
          continue;
        try {
          const filePath = path.join(this.config.cacheDir, file);
          const content = await fsPromises.readFile(filePath, "utf-8");
          const entry = JSON.parse(content);
          if (entry.timestamp + entry.ttl > now) {
            const key = Buffer.from(file.replace(".json", ""), "base64url").toString("utf-8");
            const remainingTTL = entry.timestamp + entry.ttl - now;
            this.memoryCache.set(key, entry, remainingTTL);
          } else {
            fsPromises.unlink(filePath).catch(() => {});
          }
        } catch {}
      }
    } catch {}
  }
  generateKey(method, url, headers) {
    let key = `${method.toUpperCase()}:${url}`;
    if (headers) {
      const accept = headers["accept"] || headers["Accept"];
      const acceptEncoding = headers["accept-encoding"] || headers["Accept-Encoding"];
      if (accept)
        key += `:accept=${accept}`;
      if (acceptEncoding)
        key += `:encoding=${acceptEncoding}`;
    }
    return key;
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
    const key = this.generateKey(method, url, headers);
    const cached = this.memoryCache.get(key);
    if (!cached) {
      if (this.persistenceEnabled) {
        return this.loadSingleFromDisk(key);
      }
      return;
    }
    return cached;
  }
  loadSingleFromDisk(key) {
    if (!this.persistenceEnabled || !this.config.cacheDir)
      return;
    try {
      const filePath = this.getCacheFilePath(key);
      if (!fs.existsSync(filePath))
        return;
      const content = fs.readFileSync(filePath, "utf-8");
      const entry = JSON.parse(content);
      const now = Date.now();
      if (entry.timestamp + entry.ttl > now) {
        const remainingTTL = entry.timestamp + entry.ttl - now;
        this.memoryCache.set(key, entry, remainingTTL);
        return entry;
      } else {
        fs.unlinkSync(filePath);
        return;
      }
    } catch {
      return;
    }
  }
  set(method, url, response, requestHeaders) {
    if (!this.config.enable)
      return;
    const responseHeaders = this.normalizeHeaders(response.headers);
    if (!this.isCacheable(method, response.status, responseHeaders))
      return;
    let ttl = this.config.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(responseHeaders);
      if (cacheControl.maxAge !== undefined) {
        ttl = cacheControl.maxAge;
      }
    }
    const key = this.generateKey(method, url, requestHeaders);
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
    if (this.persistenceEnabled) {
      this.persistToDisk(key, cached);
    }
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
    const cached = this.get(method, url, requestHeaders);
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
    if (!this.config.enable)
      return;
    const key = this.generateKey(method, url, requestHeaders);
    const cached = this.memoryCache.get(key) || this.loadSingleFromDisk(key);
    if (!cached)
      return;
    const normalizedHeaders = this.normalizeHeaders(newHeaders);
    let ttl = cached.ttl;
    if (this.config.respectHeaders) {
      const cacheControl = this.parseCacheControl(normalizedHeaders);
      if (cacheControl.noStore) {
        this.memoryCache.delete(key);
        if (this.persistenceEnabled) {
          const filePath = this.getCacheFilePath(key);
          fsPromises.unlink(filePath).catch(() => {});
        }
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
    if (this.persistenceEnabled) {
      this.persistToDisk(key, updated);
    }
    return updated;
  }
  invalidate(url, method) {
    const methods = method ? [method] : this.config.methods;
    for (const m of methods) {
      const key = this.generateKey(m, url);
      this.memoryCache.delete(key);
      if (this.persistenceEnabled) {
        const filePath = this.getCacheFilePath(key);
        fsPromises.unlink(filePath).catch(() => {});
      }
    }
  }
  clear() {
    this.memoryCache.clear();
    if (this.persistenceEnabled && this.config.cacheDir) {
      const cacheDir = this.config.cacheDir;
      fsPromises.readdir(cacheDir).then((files) => {
        for (const file of files) {
          if (file.endsWith(".json")) {
            fsPromises.unlink(path.join(cacheDir, file)).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }
  get size() {
    return this.memoryCache.size;
  }
  get isEnabled() {
    return this.config.enable;
  }
  get isPersistent() {
    return this.persistenceEnabled;
  }
  getConfig() {
    return { ...this.config };
  }
}
export function normalizeResponseCacheConfig(option) {
  if (option === undefined || option === false)
    return;
  if (option === true)
    return { enable: true };
  return option;
}
export default ResponseCache;
