import { LRUCache } from './lru-cache.js';
import dns from "dns";
const DEFAULT_DNS_TTL = 60000;
const DEFAULT_DNS_MAX_ENTRIES = 1000;

export class DNSCache {
  cache;
  enabled;
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
    if (cached && cached.addresses.length > 0) {
      const address = cached.addresses[Math.floor(Math.random() * cached.addresses.length)];
      return { address, family: cached.family };
    }
    const result = await this.resolveDNS(hostname, family);
    if (result) {
      this.cache.set(key, {
        addresses: [result.address],
        family: result.family,
        timestamp: Date.now()
      });
    }
    return result;
  }
  async lookupAll(hostname, family) {
    if (!this.enabled) {
      return this.resolveAllDNS(hostname, family);
    }
    const key = this.makeKey(hostname, family);
    const cached = this.cache.get(key);
    if (cached && cached.addresses.length > 0) {
      return cached.addresses.map((address) => ({ address, family: cached.family }));
    }
    const results = await this.resolveAllDNS(hostname, family);
    if (results.length > 0) {
      this.cache.set(key, {
        addresses: results.map((r) => r.address),
        family: results[0].family,
        timestamp: Date.now()
      });
    }
    return results;
  }
  resolveDNS(hostname, family) {
    return new Promise((resolve) => {
      const options = { family: family ?? 0 };
      dns.lookup(hostname, options, (err, address, resultFamily) => {
        if (err || !address || typeof address !== "string") {
          resolve(undefined);
        } else {
          resolve({ address, family: resultFamily });
        }
      });
    });
  }
  resolveAllDNS(hostname, family) {
    return new Promise((resolve) => {
      const options = { family: family ?? 0, all: true };
      dns.lookup(hostname, options, (err, addresses) => {
        if (err || !addresses || !Array.isArray(addresses)) {
          resolve([]);
        } else {
          resolve(addresses.map((a) => ({ address: a.address, family: a.family })));
        }
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
export function getGlobalDNSCache(options) {
  if (!globalDNSCache) {
    globalDNSCache = new DNSCache(options);
  }
  return globalDNSCache;
}
export function resetGlobalDNSCache() {
  if (globalDNSCache) {
    globalDNSCache.clear();
  }
  globalDNSCache = null;
}
export default DNSCache;
