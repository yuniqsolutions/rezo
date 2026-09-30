const { LRUCache } = require('./lru-cache.cjs');
const { importNodeModule } = require('../utils/node-runtime.cjs');
const DEFAULT_DNS_TTL = 60000;
const DEFAULT_DNS_MAX_ENTRIES = 1000;

class DNSCache {
  cache;
  enabled;
  pendingScalarLookups = new Map;
  pendingAllLookups = new Map;
  constructor(options = {}) {
    this.enabled = options.enable !== false;
    this.cache = new LRUCache({
      maxEntries: options.maxEntries ?? DEFAULT_DNS_MAX_ENTRIES,
      ttl: options.ttl ?? DEFAULT_DNS_TTL
    });
  }
  makeKey(hostname, family) {
    return family ? `${hostname}:${family}` : hostname;
  }
  async lookup(hostname, family) {
    if (!this.enabled) {
      return this.resolveDNS(hostname, family);
    }
    const key = this.makeKey(hostname, family);
    const cached = this.cache.get(key);
    if (cached && cached.entries.length > 0) {
      const entry = cached.entries[Math.floor(Math.random() * cached.entries.length)];
      if (entry) {
        return { address: entry.address, family: entry.family };
      }
    }
    return this.coalesce(this.pendingScalarLookups, key, async () => {
      const result = await this.resolveDNS(hostname, family);
      if (result && typeof result.address === "string" && result.address.length > 0) {
        this.store(key, [result]);
      }
      return result;
    });
  }
  async lookupAll(hostname, family) {
    if (!this.enabled) {
      return this.resolveAllDNS(hostname, family);
    }
    const key = this.makeKey(hostname, family);
    const cached = this.cache.get(key);
    if (cached && cached.entries.length > 0) {
      return cached.entries.map((entry) => ({ address: entry.address, family: entry.family }));
    }
    return this.coalesce(this.pendingAllLookups, key, async () => {
      const results = await this.resolveAllDNS(hostname, family);
      if (results.length > 0) {
        this.store(key, results);
      }
      return results;
    });
  }
  coalesce(pending, key, resolve) {
    const inFlight = pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    const lookup = resolve().finally(() => {
      if (pending.get(key) === lookup) {
        pending.delete(key);
      }
    });
    pending.set(key, lookup);
    return lookup;
  }
  store(key, entries) {
    const copies = entries.map((entry) => ({ address: entry.address, family: entry.family }));
    this.cache.set(key, {
      entries: copies,
      addresses: copies.map((entry) => entry.address),
      family: copies[0]?.family ?? 4,
      timestamp: Date.now()
    });
  }
  async resolveDNS(hostname, family) {
    const dns = await importNodeModule("node:dns");
    if (!dns?.lookup) {
      return;
    }
    return new Promise((resolve) => {
      dns.lookup(hostname, { family: family ?? 0 }, (error, address, resultFamily) => {
        if (error || typeof address !== "string" || address.length === 0) {
          resolve(undefined);
          return;
        }
        resolve({ address, family: resultFamily === 6 ? 6 : 4 });
      });
    });
  }
  async resolveAllDNS(hostname, family) {
    const dns = await importNodeModule("node:dns");
    if (!dns?.lookup) {
      return [];
    }
    return new Promise((resolve) => {
      dns.lookup(hostname, { family: family ?? 0, all: true }, (error, addresses) => {
        if (error || !Array.isArray(addresses)) {
          resolve([]);
          return;
        }
        resolve(addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })));
      });
    });
  }
  invalidate(hostname) {
    this.cache.delete(this.makeKey(hostname));
    this.cache.delete(this.makeKey(hostname, 4));
    this.cache.delete(this.makeKey(hostname, 6));
  }
  clear() {
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
  get isEnabled() {
    return this.enabled;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}
let globalDNSCache = null;
function getGlobalDNSCache(options) {
  if (!globalDNSCache) {
    globalDNSCache = new DNSCache(options);
  }
  return globalDNSCache;
}
function resetGlobalDNSCache() {
  if (globalDNSCache) {
    globalDNSCache.clear();
  }
  globalDNSCache = null;
}

exports.DNSCache = DNSCache;
exports.getGlobalDNSCache = getGlobalDNSCache;
exports.resetGlobalDNSCache = resetGlobalDNSCache;
exports.default = DNSCache;
module.exports = Object.assign(DNSCache, exports);