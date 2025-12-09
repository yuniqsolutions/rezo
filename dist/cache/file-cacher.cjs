const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
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
async function compressData(data) {
  try {
    const zlib = await import("node:zlib");
    if (typeof zlib.zstdCompressSync === "function") {
      return zlib.zstdCompressSync(data);
    }
    return data;
  } catch {
    return data;
  }
}
async function decompressData(data) {
  try {
    const zlib = await import("node:zlib");
    if (typeof zlib.zstdDecompressSync === "function") {
      return zlib.zstdDecompressSync(data);
    }
    return data;
  } catch {
    return data;
  }
}

class FileCacher {
  databases = new Map;
  options;
  cacheDir;
  closed = false;
  constructor(options = {}) {
    this.options = {
      cacheDir: options.cacheDir || "./cache",
      ttl: options.ttl || 604800000,
      compression: options.compression ?? false,
      softDelete: options.softDelete ?? false,
      encryptNamespace: options.encryptNamespace ?? false,
      maxEntries: options.maxEntries ?? 0
    };
    this.cacheDir = path.resolve(this.options.cacheDir);
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }
  static async create(options = {}) {
    const cacher = new FileCacher(options);
    return cacher;
  }
  async getDatabase(namespace) {
    const nsKey = this.options.encryptNamespace ? createHash("md5").update(namespace).digest("hex") : namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (this.databases.has(nsKey)) {
      return this.databases.get(nsKey);
    }
    const dbPath = path.join(this.cacheDir, `${nsKey}.db`);
    const db = await createDatabase(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        compressed INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_expires ON cache(expiresAt)");
    db.run("CREATE INDEX IF NOT EXISTS idx_deleted ON cache(deleted)");
    this.databases.set(nsKey, db);
    return db;
  }
  async set(key, value, ttl, namespace = "default") {
    if (this.closed)
      throw new Error("FileCacher is closed");
    const db = await this.getDatabase(namespace);
    const now = Date.now();
    const expiresAt = now + (ttl ?? this.options.ttl);
    let serialized = JSON.stringify(value);
    let compressed = 0;
    if (this.options.compression) {
      try {
        const compressedData = await compressData(Buffer.from(serialized, "utf-8"));
        serialized = compressedData.toString("base64");
        compressed = 1;
      } catch {}
    }
    db.run(`
      INSERT OR REPLACE INTO cache (key, value, expiresAt, createdAt, compressed, deleted)
      VALUES (?, ?, ?, ?, ?, 0)
    `, key, serialized, expiresAt, now, compressed);
    if (this.options.maxEntries > 0) {
      const count = db.get("SELECT COUNT(*) as cnt FROM cache WHERE deleted = 0");
      if (count && count.cnt > this.options.maxEntries) {
        const excess = count.cnt - this.options.maxEntries;
        db.run(`
          DELETE FROM cache WHERE key IN (
            SELECT key FROM cache WHERE deleted = 0 ORDER BY createdAt ASC LIMIT ?
          )
        `, excess);
      }
    }
  }
  async get(key, namespace = "default") {
    if (this.closed)
      throw new Error("FileCacher is closed");
    const db = await this.getDatabase(namespace);
    const entry = db.get("SELECT * FROM cache WHERE key = ? AND deleted = 0", key);
    if (!entry)
      return null;
    if (entry.expiresAt < Date.now()) {
      if (this.options.softDelete) {
        db.run("UPDATE cache SET deleted = 1 WHERE key = ?", key);
      } else {
        db.run("DELETE FROM cache WHERE key = ?", key);
      }
      return null;
    }
    let value = entry.value;
    if (entry.compressed) {
      try {
        const decompressed = await decompressData(Buffer.from(value, "base64"));
        value = decompressed.toString("utf-8");
      } catch {
        return null;
      }
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  async has(key, namespace = "default") {
    if (this.closed)
      return false;
    const db = await this.getDatabase(namespace);
    const entry = db.get("SELECT key, expiresAt FROM cache WHERE key = ? AND deleted = 0", key);
    if (!entry)
      return false;
    return entry.expiresAt >= Date.now();
  }
  async delete(key, namespace = "default") {
    if (this.closed)
      return false;
    const db = await this.getDatabase(namespace);
    if (this.options.softDelete) {
      db.run("UPDATE cache SET deleted = 1 WHERE key = ?", key);
    } else {
      db.run("DELETE FROM cache WHERE key = ?", key);
    }
    return true;
  }
  async clear(namespace = "default") {
    if (this.closed)
      return;
    const db = await this.getDatabase(namespace);
    if (this.options.softDelete) {
      db.run("UPDATE cache SET deleted = 1");
    } else {
      db.run("DELETE FROM cache");
    }
  }
  async cleanup(namespace = "default") {
    if (this.closed)
      return 0;
    const db = await this.getDatabase(namespace);
    const now = Date.now();
    const countBefore = db.get("SELECT COUNT(*) as cnt FROM cache");
    db.run("DELETE FROM cache WHERE expiresAt < ? OR deleted = 1", now);
    const countAfter = db.get("SELECT COUNT(*) as cnt FROM cache");
    return (countBefore?.cnt || 0) - (countAfter?.cnt || 0);
  }
  async stats(namespace = "default") {
    if (this.closed)
      return { count: 0, expired: 0, deleted: 0 };
    const db = await this.getDatabase(namespace);
    const now = Date.now();
    const total = db.get("SELECT COUNT(*) as cnt FROM cache WHERE deleted = 0");
    const expired = db.get("SELECT COUNT(*) as cnt FROM cache WHERE expiresAt < ? AND deleted = 0", now);
    const deleted = db.get("SELECT COUNT(*) as cnt FROM cache WHERE deleted = 1");
    return {
      count: total?.cnt || 0,
      expired: expired?.cnt || 0,
      deleted: deleted?.cnt || 0
    };
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    for (const db of this.databases.values()) {
      try {
        db.close();
      } catch {}
    }
    this.databases.clear();
  }
  get isClosed() {
    return this.closed;
  }
  get directory() {
    return this.cacheDir;
  }
}

exports.FileCacher = FileCacher;
exports.default = FileCacher;
module.exports = Object.assign(FileCacher, exports);