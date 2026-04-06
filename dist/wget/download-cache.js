import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { cwd } from "node:process";

export class DownloadCache {
  outputDir;
  baseUrl;
  cacheDir;
  cacheFile;
  data = null;
  dirty = false;
  saveTimeout = null;
  static VERSION = 1;
  static CACHE_DIR = ".rezo-wget";
  constructor(outputDir, baseUrl) {
    this.outputDir = outputDir;
    this.baseUrl = baseUrl;
    this.cacheDir = join(cwd(), DownloadCache.CACHE_DIR);
    const hash = this.generateCacheHash();
    this.cacheFile = join(this.cacheDir, `${hash}.json`);
  }
  generateCacheHash() {
    return createHash("md5").update(this.baseUrl).digest("hex").slice(0, 12);
  }
  urlHash(url) {
    return createHash("md5").update(url).digest("hex");
  }
  async load() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const content = await fs.readFile(this.cacheFile, "utf-8");
      const data = JSON.parse(content);
      if (data.version !== DownloadCache.VERSION) {
        this.data = this.createEmptyCache();
        return;
      }
      this.data = data;
    } catch (error) {
      this.data = this.createEmptyCache();
    }
  }
  createEmptyCache() {
    return {
      version: DownloadCache.VERSION,
      created: Date.now(),
      updated: Date.now(),
      configHash: this.generateCacheHash(),
      baseUrl: this.baseUrl,
      entries: {}
    };
  }
  async check(url) {
    if (!this.data) {
      await this.load();
    }
    const key = this.urlHash(url);
    const entry = this.data.entries[key];
    if (!entry) {
      return { cached: false, reason: "not-found" };
    }
    for (const filename of entry.filenames) {
      const fullPath = join(this.outputDir, filename);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size === entry.totalBytes) {
          return {
            cached: true,
            entry,
            filename
          };
        }
      } catch {}
    }
    if (entry.filenames.length > 0) {
      return { cached: false, reason: "file-missing", entry };
    }
    return { cached: false, reason: "size-mismatch", entry };
  }
  get(url) {
    if (!this.data)
      return;
    return this.data.entries[this.urlHash(url)];
  }
  set(url, entry) {
    if (!this.data) {
      this.data = this.createEmptyCache();
    }
    const key = this.urlHash(url);
    const existing = this.data.entries[key];
    this.data.entries[key] = {
      url,
      ...entry,
      filenames: existing ? [...new Set([...existing.filenames, ...entry.filenames])] : entry.filenames
    };
    this.data.updated = Date.now();
    this.dirty = true;
    this.scheduleSave();
  }
  addFilename(url, filename) {
    if (!this.data)
      return;
    const key = this.urlHash(url);
    const entry = this.data.entries[key];
    if (entry && !entry.filenames.includes(filename)) {
      entry.filenames.push(filename);
      this.data.updated = Date.now();
      this.dirty = true;
      this.scheduleSave();
    }
  }
  delete(url) {
    if (!this.data)
      return;
    const key = this.urlHash(url);
    if (this.data.entries[key]) {
      delete this.data.entries[key];
      this.data.updated = Date.now();
      this.dirty = true;
      this.scheduleSave();
    }
  }
  has(url) {
    if (!this.data)
      return false;
    return this.urlHash(url) in this.data.entries;
  }
  urls() {
    if (!this.data)
      return [];
    return Object.values(this.data.entries).map((e) => e.url);
  }
  stats() {
    if (!this.data) {
      return { entries: 0, totalBytes: 0, filesCount: 0 };
    }
    const entries = Object.values(this.data.entries);
    return {
      entries: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + e.totalBytes, 0),
      filesCount: entries.reduce((sum, e) => sum + e.filenames.length, 0)
    };
  }
  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 1000);
  }
  async save() {
    if (!this.data || !this.dirty)
      return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    try {
      await fs.mkdir(dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.data, null, 2), "utf-8");
      this.dirty = false;
    } catch (error) {
      console.error("Failed to save download cache:", error);
    }
  }
  clear() {
    if (this.data) {
      this.data.entries = {};
      this.data.updated = Date.now();
      this.dirty = true;
      this.scheduleSave();
    }
  }
  async cleanup() {
    if (!this.data)
      return 0;
    let removed = 0;
    const entries = Object.entries(this.data.entries);
    for (const [key, entry] of entries) {
      let hasValidFile = false;
      const validFilenames = [];
      for (const filename of entry.filenames) {
        const fullPath = join(this.outputDir, filename);
        try {
          await fs.stat(fullPath);
          validFilenames.push(filename);
          hasValidFile = true;
        } catch {}
      }
      if (!hasValidFile) {
        delete this.data.entries[key];
        removed++;
      } else if (validFilenames.length !== entry.filenames.length) {
        entry.filenames = validFilenames;
      }
    }
    if (removed > 0) {
      this.data.updated = Date.now();
      this.dirty = true;
      await this.save();
    }
    return removed;
  }
  async destroy() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
    this.data = null;
  }
  get filePath() {
    return this.cacheFile;
  }
  get dirPath() {
    return this.cacheDir;
  }
}
export default DownloadCache;
