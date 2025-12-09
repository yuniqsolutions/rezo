class LRUCache {
  cache = new Map;
  maxEntries;
  defaultTTL;
  onEvict;
  constructor(options = {}) {
    this.maxEntries = options.maxEntries ?? 500;
    this.defaultTTL = options.ttl ?? 3000000;
    this.onEvict = options.onEvict;
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.delete(key);
      return;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }
  set(key, value, ttl) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        if (this.onEvict && oldEntry) {
          this.onEvict(oldestKey, oldEntry.value);
        }
      }
    }
    const actualTTL = ttl ?? this.defaultTTL;
    const expires = actualTTL > 0 ? Date.now() + actualTTL : 0;
    this.cache.set(key, { value, expires });
  }
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.delete(key);
      return false;
    }
    return true;
  }
  delete(key) {
    const entry = this.cache.get(key);
    const deleted = this.cache.delete(key);
    if (deleted && this.onEvict && entry) {
      this.onEvict(key, entry.value);
    }
    return deleted;
  }
  clear() {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value);
      }
    }
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
  keys() {
    return Array.from(this.cache.keys());
  }
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expires > 0 && now > entry.expires) {
        this.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
  getStats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}

exports.LRUCache = LRUCache;
exports.default = LRUCache;
module.exports = Object.assign(LRUCache, exports);