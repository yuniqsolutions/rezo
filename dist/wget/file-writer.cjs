const { promises: fs, createWriteStream } = require("node:fs");
const { dirname, join, basename, extname } = require("node:path");
const { AssetOrganizer } = require('./asset-organizer.cjs');
const MIME_EXTENSIONS = {
  "text/html": ".html",
  "text/css": ".css",
  "text/javascript": ".js",
  "application/javascript": ".js",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "application/font-woff": ".woff",
  "application/font-woff2": ".woff2",
  "font/ttf": ".ttf",
  "application/x-font-ttf": ".ttf",
  "font/otf": ".otf"
};
const UNSAFE_CHARS = {
  unix: /[\x00-\x1f\/]/g,
  windows: /[\x00-\x1f\/\\:*?"<>|]/g,
  ascii: /[^\x20-\x7e]/g
};

class FileWriter {
  options;
  outputDir;
  writtenFiles = new Map;
  assetOrganizer = null;
  entryUrls = new Set;
  constructor(options) {
    this.options = options;
    this.outputDir = options.outputDir || ".";
    if (options.organizeAssets) {
      this.assetOrganizer = new AssetOrganizer(options);
    }
  }
  markAsEntry(url) {
    this.entryUrls.add(url);
  }
  isEntryUrl(url) {
    return this.entryUrls.has(url);
  }
  async write(url, content, mimeType) {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    let outputPath;
    if (this.options.organizeAssets && this.isEntryUrl(url)) {
      outputPath = this.getEntryFilePath(url, mimeType);
    } else if (this.assetOrganizer?.shouldOrganize(mimeType, url)) {
      const result = this.assetOrganizer.getOrganizedPath(url, buffer, mimeType);
      if (result.isDuplicate) {
        const fullPath = join(this.outputDir, result.path);
        this.writtenFiles.set(url, fullPath);
        return fullPath;
      }
      outputPath = join(this.outputDir, result.path);
    } else {
      outputPath = this.getOutputPath(url);
      if (this.options.adjustExtension) {
        outputPath = this.adjustExtension(outputPath, mimeType);
      }
    }
    if (this.options.noClobber) {
      const exists = await this.fileExists(outputPath);
      if (exists) {
        this.writtenFiles.set(url, outputPath);
        return outputPath;
      }
    }
    if (this.options.backups && this.options.backups > 0) {
      await this.createBackup(outputPath);
    }
    await this.ensureDir(dirname(outputPath));
    await fs.writeFile(outputPath, buffer);
    this.writtenFiles.set(url, outputPath);
    return outputPath;
  }
  async createWriteStream(url, mimeType) {
    let outputPath = this.getOutputPath(url);
    if (mimeType && this.options.adjustExtension) {
      outputPath = this.adjustExtension(outputPath, mimeType);
    }
    if (this.options.noClobber) {
      const exists = await this.fileExists(outputPath);
      if (exists) {
        throw new Error(`File exists and noClobber is enabled: ${outputPath}`);
      }
    }
    if (this.options.backups && this.options.backups > 0) {
      await this.createBackup(outputPath);
    }
    await this.ensureDir(dirname(outputPath));
    const stream = createWriteStream(outputPath);
    stream.on("close", () => {
      this.writtenFiles.set(url, outputPath);
    });
    return { stream, path: outputPath };
  }
  getOutputPath(url) {
    if (this.options.output) {
      return join(this.outputDir, this.options.output);
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return join(this.outputDir, this.hashUrl(url));
    }
    const parts = [];
    if (this.options.protocolDirectories) {
      parts.push(parsed.protocol.replace(":", ""));
    }
    if (!this.options.noHostDirectories && !this.options.noDirectories) {
      parts.push(this.sanitizeFilename(parsed.hostname));
    }
    if (!this.options.noDirectories) {
      let pathname = parsed.pathname;
      if (this.options.cutDirs && this.options.cutDirs > 0) {
        const pathParts = pathname.split("/").filter((p) => p);
        pathname = "/" + pathParts.slice(this.options.cutDirs).join("/");
      }
      const pathParts = pathname.split("/").filter((p) => p);
      for (const part of pathParts) {
        parts.push(this.sanitizeFilename(part));
      }
    } else {
      const filename = basename(parsed.pathname) || "index.html";
      parts.push(this.sanitizeFilename(filename));
    }
    if (parts.length === 0 || parts[parts.length - 1] === "") {
      parts.push("index.html");
    }
    const lastPart = parts[parts.length - 1];
    if (!lastPart.includes(".") && !parsed.pathname.endsWith("/")) {}
    if (parsed.search) {
      const lastIndex = parts.length - 1;
      const filename = parts[lastIndex];
      const queryHash = this.hashString(parsed.search).substring(0, 8);
      const ext = extname(filename);
      const base = basename(filename, ext);
      parts[lastIndex] = `${base}_${queryHash}${ext}`;
    }
    return join(this.outputDir, ...parts);
  }
  getRelativePath(fullPath) {
    if (fullPath.startsWith(this.outputDir)) {
      return fullPath.substring(this.outputDir.length).replace(/^[\/\\]/, "");
    }
    return fullPath;
  }
  isDocument(mimeType, url) {
    if (mimeType) {
      const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
      if (normalizedMime === "text/html" || normalizedMime === "application/xhtml+xml") {
        return true;
      }
    }
    try {
      const urlPath = new URL(url).pathname;
      const ext = extname(urlPath).toLowerCase();
      if (ext === ".html" || ext === ".htm" || ext === ".xhtml" || ext === "") {
        return true;
      }
    } catch {}
    return false;
  }
  getEntryFilePath(url, mimeType) {
    try {
      const parsed = new URL(url);
      let filename = basename(parsed.pathname);
      if (!filename || filename === "/") {
        filename = this.isDocument(mimeType, url) ? "index.html" : "asset";
      }
      if (this.isDocument(mimeType, url)) {
        const ext = extname(filename).toLowerCase();
        if (!ext || ![".html", ".htm", ".xhtml"].includes(ext)) {
          if (!ext) {
            filename = filename + ".html";
          }
        }
      }
      return join(this.outputDir, this.sanitizeFilename(filename));
    } catch {
      return join(this.outputDir, this.isDocument(mimeType, url) ? "index.html" : "asset");
    }
  }
  adjustExtension(path, mimeType) {
    const currentExt = extname(path).toLowerCase();
    const baseMime = mimeType.split(";")[0].trim().toLowerCase();
    const expectedExt = MIME_EXTENSIONS[baseMime];
    if (!expectedExt) {
      return path;
    }
    if (!currentExt) {
      return path + expectedExt;
    }
    if (currentExt === expectedExt) {
      return path;
    }
    if (baseMime === "text/html") {
      const htmlExts = [".html", ".htm", ".php", ".asp", ".aspx", ".jsp", ".xhtml"];
      if (htmlExts.includes(currentExt)) {
        return path;
      }
      if (![".txt", ".md", ".shtml"].includes(currentExt)) {
        return path + ".html";
      }
    }
    return path;
  }
  sanitizeFilename(name) {
    const mode = this.options.restrictFileNames || "unix";
    let sanitized = name;
    if (mode === "windows") {
      sanitized = sanitized.replace(UNSAFE_CHARS.windows, "_");
    } else if (mode === "ascii") {
      sanitized = sanitized.replace(UNSAFE_CHARS.ascii, "_");
    } else {
      sanitized = sanitized.replace(UNSAFE_CHARS.unix, "_");
    }
    if (mode === "lowercase") {
      sanitized = sanitized.toLowerCase();
    } else if (mode === "uppercase") {
      sanitized = sanitized.toUpperCase();
    }
    try {
      sanitized = decodeURIComponent(sanitized);
    } catch {}
    if (mode === "windows") {
      sanitized = sanitized.replace(UNSAFE_CHARS.windows, "_");
    } else if (mode === "ascii") {
      sanitized = sanitized.replace(UNSAFE_CHARS.ascii, "_");
    } else {
      sanitized = sanitized.replace(UNSAFE_CHARS.unix, "_");
    }
    sanitized = sanitized.replace(/_+/g, "_");
    sanitized = sanitized.replace(/^[_\s]+|[_\s]+$/g, "");
    if (!sanitized || sanitized === "." || sanitized === "..") {
      return "unnamed";
    }
    if (sanitized.length > 200) {
      const ext = extname(sanitized);
      const base = basename(sanitized, ext);
      sanitized = base.substring(0, 200 - ext.length) + ext;
    }
    return sanitized;
  }
  async createBackup(path) {
    const exists = await this.fileExists(path);
    if (!exists)
      return;
    const maxBackups = this.options.backups || 1;
    for (let i = maxBackups - 1;i >= 1; i--) {
      const oldBackup = `${path}.${i}`;
      const newBackup = `${path}.${i + 1}`;
      const oldExists = await this.fileExists(oldBackup);
      if (oldExists) {
        if (i + 1 > maxBackups) {
          await fs.unlink(oldBackup);
        } else {
          await fs.rename(oldBackup, newBackup);
        }
      }
    }
    await fs.rename(path, `${path}.1`);
  }
  async ensureDir(dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
  async getFileStats(path) {
    try {
      const stats = await fs.stat(path);
      return {
        size: stats.size,
        mtime: stats.mtime
      };
    } catch {
      return null;
    }
  }
  async setMtime(path, mtime) {
    try {
      await fs.utimes(path, mtime, mtime);
    } catch {}
  }
  hashUrl(url) {
    return this.hashString(url) + ".html";
  }
  hashString(str) {
    let hash = 0;
    for (let i = 0;i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  getUrlMap() {
    return new Map(this.writtenFiles);
  }
  getPathForUrl(url) {
    return this.writtenFiles.get(url);
  }
  hasUrl(url) {
    return this.writtenFiles.has(url);
  }
  async deleteFile(path) {
    try {
      await fs.unlink(path);
    } catch {}
  }
  setOutputDir(dir) {
    this.outputDir = dir;
  }
  getOutputDir() {
    return this.outputDir;
  }
  getAssetStats() {
    return this.assetOrganizer?.getStats() ?? null;
  }
  getAssetOrganizer() {
    return this.assetOrganizer;
  }
}

exports.FileWriter = FileWriter;
exports.default = FileWriter;
module.exports = Object.assign(FileWriter, exports);