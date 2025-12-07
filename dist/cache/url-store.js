import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
function detectRuntime() {
  if (typeof globalThis.Bun !== "undefined") {
    return "bun";
  }
  if (typeof globalThis.Deno !== "undefined") {
    return "deno";
  }
  return "node";
}
async function createDatabase(dbPath) {
  const runtime = detectRuntime();
  if (runtime === "bun") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath);
    return {
      run: (sql, ...params) => db.run(sql, ...params),
      get: (sql, ...params) => db.query(sql).get(...params),
      all: (sql, ...params) => db.query(sql).all(...params),
      close: () => db.close()
    };
  }
  if (runtime === "deno") {
    try {
      const { Database } = await import("node:sqlite");
      const db = new Database(dbPath);
      return {
        run: (sql, ...params) => db.exec(sql, params),
        get: (sql, ...params) => {
          const stmt = db.prepare(sql);
          return stmt.get(...params);
        },
        all: (sql, ...params) => {
          const stmt = db.prepare(sql);
          return stmt.all(...params);
        },
        close: () => db.close()
      };
    } catch {
      throw new Error("Deno SQLite support requires Node.js compatibility mode");
    }
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  return {
    run: (sql, ...params) => db.exec(sql),
    get: (sql, ...params) => {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },
    all: (sql, ...params) => {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    close: () => db.close()
  };
}

export class UrlStore {
  db = null;
  options;
  storeDir;
  dbPath;
  closed = false;
  initPromise = null;
  constructor(options = {}) {
    this.options = {
      storeDir: options.storeDir || "./url-store",
      dbFileName: options.dbFileName || "urls.db",
      ttl: options.ttl || 604800000,
      maxUrls: options.maxUrls ?? 0,
      hashUrls: options.hashUrls ?? false
    };
    this.storeDir = path.resolve(this.options.storeDir);
    this.dbPath = path.join(this.storeDir, this.options.dbFileName);
    if (!fs.existsSync(this.storeDir)) {
      fs.mkdirSync(this.storeDir, { recursive: true });
    }
  }
  static async create(options = {}) {
    const store = new UrlStore(options);
    await store.initialize();
    return store;
  }
  async initialize() {
    if (this.initPromise)
      return this.initPromise;
    this.initPromise = (async () => {
      this.db = await createDatabase(this.dbPath);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS urls (
          url TEXT PRIMARY KEY,
          visitedAt INTEGER NOT NULL,
          expiresAt INTEGER NOT NULL,
          namespace TEXT DEFAULT 'default',
          metadata TEXT
        )
      `);
      this.db.run("CREATE INDEX IF NOT EXISTS idx_expires ON urls(expiresAt)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_namespace ON urls(namespace)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_visited ON urls(visitedAt)");
    })();
    return this.initPromise;
  }
  getUrlKey(url) {
    if (this.options.hashUrls) {
      return createHash("sha256").update(url).digest("hex");
    }
    return url;
  }
  async set(url, namespace = "default", metadata, ttl) {
    if (this.closed)
      throw new Error("UrlStore is closed");
    await this.initialize();
    const key = this.getUrlKey(url);
    const now = Date.now();
    const expiresAt = now + (ttl ?? this.options.ttl);
    const metaStr = metadata ? JSON.stringify(metadata) : null;
    this.db.run(`
      INSERT OR REPLACE INTO urls (url, visitedAt, expiresAt, namespace, metadata)
      VALUES (?, ?, ?, ?, ?)
    `, key, now, expiresAt, namespace, metaStr);
    if (this.options.maxUrls > 0) {
      const count = this.db.get("SELECT COUNT(*) as cnt FROM urls");
      if (count && count.cnt > this.options.maxUrls) {
        const excess = count.cnt - this.options.maxUrls;
        this.db.run(`
          DELETE FROM urls WHERE url IN (
            SELECT url FROM urls ORDER BY visitedAt ASC LIMIT ?
          )
        `, excess);
      }
    }
  }
  async has(url, namespace) {
    if (this.closed)
      return false;
    await this.initialize();
    const key = this.getUrlKey(url);
    const now = Date.now();
    let entry;
    if (namespace) {
      entry = this.db.get("SELECT url, expiresAt FROM urls WHERE url = ? AND namespace = ?", key, namespace);
    } else {
      entry = this.db.get("SELECT url, expiresAt FROM urls WHERE url = ?", key);
    }
    if (!entry)
      return false;
    return entry.expiresAt >= now;
  }
  async hasMany(urls, namespace) {
    if (this.closed)
      return new Set;
    await this.initialize();
    const result = new Set;
    const now = Date.now();
    const batchSize = 100;
    for (let i = 0;i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const keys = batch.map((u) => this.getUrlKey(u));
      const placeholders = keys.map(() => "?").join(",");
      let entries;
      if (namespace) {
        entries = this.db.all(`SELECT url, expiresAt FROM urls WHERE url IN (${placeholders}) AND namespace = ?`, ...keys, namespace);
      } else {
        entries = this.db.all(`SELECT url, expiresAt FROM urls WHERE url IN (${placeholders})`, ...keys);
      }
      for (const entry of entries) {
        if (entry.expiresAt >= now) {
          const idx = keys.indexOf(entry.url);
          if (idx !== -1) {
            result.add(batch[idx]);
          }
        }
      }
    }
    return result;
  }
  async getMetadata(url, namespace) {
    if (this.closed)
      return null;
    await this.initialize();
    const key = this.getUrlKey(url);
    let entry;
    if (namespace) {
      entry = this.db.get("SELECT metadata FROM urls WHERE url = ? AND namespace = ?", key, namespace);
    } else {
      entry = this.db.get("SELECT metadata FROM urls WHERE url = ?", key);
    }
    if (!entry?.metadata)
      return null;
    try {
      return JSON.parse(entry.metadata);
    } catch {
      return null;
    }
  }
  async delete(url, namespace) {
    if (this.closed)
      return false;
    await this.initialize();
    const key = this.getUrlKey(url);
    if (namespace) {
      this.db.run("DELETE FROM urls WHERE url = ? AND namespace = ?", key, namespace);
    } else {
      this.db.run("DELETE FROM urls WHERE url = ?", key);
    }
    return true;
  }
  async clear(namespace) {
    if (this.closed)
      return;
    await this.initialize();
    if (namespace) {
      this.db.run("DELETE FROM urls WHERE namespace = ?", namespace);
    } else {
      this.db.run("DELETE FROM urls");
    }
  }
  async cleanup() {
    if (this.closed)
      return 0;
    await this.initialize();
    const now = Date.now();
    const countBefore = this.db.get("SELECT COUNT(*) as cnt FROM urls");
    this.db.run("DELETE FROM urls WHERE expiresAt < ?", now);
    const countAfter = this.db.get("SELECT COUNT(*) as cnt FROM urls");
    return (countBefore?.cnt || 0) - (countAfter?.cnt || 0);
  }
  async getAll(namespace = "default", includeExpired = false) {
    if (this.closed)
      return [];
    await this.initialize();
    const now = Date.now();
    let entries;
    if (includeExpired) {
      entries = this.db.all("SELECT url FROM urls WHERE namespace = ?", namespace);
    } else {
      entries = this.db.all("SELECT url FROM urls WHERE namespace = ? AND expiresAt >= ?", namespace, now);
    }
    return entries.map((e) => e.url);
  }
  async stats(namespace) {
    if (this.closed)
      return { total: 0, expired: 0, namespaces: 0 };
    await this.initialize();
    const now = Date.now();
    let total;
    let expired;
    if (namespace) {
      total = this.db.get("SELECT COUNT(*) as cnt FROM urls WHERE namespace = ?", namespace);
      expired = this.db.get("SELECT COUNT(*) as cnt FROM urls WHERE namespace = ? AND expiresAt < ?", namespace, now);
    } else {
      total = this.db.get("SELECT COUNT(*) as cnt FROM urls");
      expired = this.db.get("SELECT COUNT(*) as cnt FROM urls WHERE expiresAt < ?", now);
    }
    const namespaceCount = this.db.get("SELECT COUNT(DISTINCT namespace) as cnt FROM urls");
    return {
      total: total?.cnt || 0,
      expired: expired?.cnt || 0,
      namespaces: namespaceCount?.cnt || 0
    };
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    await this.initPromise;
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
  get isClosed() {
    return this.closed;
  }
  get path() {
    return this.dbPath;
  }
}
export default UrlStore;
