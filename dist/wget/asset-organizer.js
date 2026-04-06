import { createHash } from "node:crypto";
import { extname, basename, join } from "node:path";
export const DEFAULT_ASSET_FOLDERS = {
  css: "css",
  js: "js",
  images: "images",
  fonts: "fonts",
  audio: "audio",
  video: "video",
  other: "assets"
};
const MIME_TO_ASSET = {
  "text/css": "css",
  "application/javascript": "js",
  "application/x-javascript": "js",
  "text/javascript": "js",
  "application/ecmascript": "js",
  "image/jpeg": "images",
  "image/png": "images",
  "image/gif": "images",
  "image/webp": "images",
  "image/svg+xml": "images",
  "image/x-icon": "images",
  "image/vnd.microsoft.icon": "images",
  "image/bmp": "images",
  "image/tiff": "images",
  "image/avif": "images",
  "font/woff": "fonts",
  "font/woff2": "fonts",
  "font/ttf": "fonts",
  "font/otf": "fonts",
  "application/font-woff": "fonts",
  "application/font-woff2": "fonts",
  "application/x-font-ttf": "fonts",
  "application/x-font-otf": "fonts",
  "application/vnd.ms-fontobject": "fonts",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
  "audio/aac": "audio",
  "audio/flac": "audio",
  "video/mp4": "video",
  "video/webm": "video",
  "video/ogg": "video",
  "video/quicktime": "video",
  "video/x-msvideo": "video",
  "video/x-ms-wmv": "video"
};
const EXT_TO_ASSET = {
  ".css": "css",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jpg": "images",
  ".jpeg": "images",
  ".png": "images",
  ".gif": "images",
  ".webp": "images",
  ".svg": "images",
  ".ico": "images",
  ".bmp": "images",
  ".tiff": "images",
  ".tif": "images",
  ".avif": "images",
  ".woff": "fonts",
  ".woff2": "fonts",
  ".ttf": "fonts",
  ".otf": "fonts",
  ".eot": "fonts",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".aac": "audio",
  ".flac": "audio",
  ".m4a": "audio",
  ".mp4": "video",
  ".webm": "video",
  ".ogv": "video",
  ".mov": "video",
  ".avi": "video",
  ".wmv": "video",
  ".mkv": "video"
};

export class AssetOrganizer {
  options;
  hashCache;
  urlToPath;
  filenameVersions;
  constructor(options) {
    this.options = options;
    this.hashCache = new Map;
    this.urlToPath = new Map;
    this.filenameVersions = new Map;
  }
  computeHash(content) {
    return createHash("md5").update(content).digest("hex");
  }
  getAssetFolder(mimeType, url) {
    const folders = {
      ...DEFAULT_ASSET_FOLDERS,
      ...this.options.assetFolders
    };
    if (mimeType) {
      const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
      const assetType = MIME_TO_ASSET[normalizedMime];
      if (assetType) {
        return folders[assetType];
      }
    }
    try {
      const urlPath = new URL(url).pathname;
      const ext = extname(urlPath).toLowerCase();
      const assetType = EXT_TO_ASSET[ext];
      if (assetType) {
        return folders[assetType];
      }
    } catch {}
    return folders.other;
  }
  shouldOrganize(mimeType, url) {
    if (!this.options.organizeAssets) {
      return false;
    }
    if (mimeType) {
      const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
      if (normalizedMime === "text/html" || normalizedMime === "application/xhtml+xml" || normalizedMime === "text/xml" || normalizedMime === "application/xml") {
        return false;
      }
    }
    try {
      const urlPath = new URL(url).pathname;
      const ext = extname(urlPath).toLowerCase();
      if (ext === ".html" || ext === ".htm" || ext === ".xhtml") {
        return false;
      }
    } catch {}
    return true;
  }
  getOrganizedPath(url, content, mimeType) {
    const existingPath = this.urlToPath.get(url);
    if (existingPath) {
      return {
        path: existingPath,
        isDuplicate: false
      };
    }
    const hash = this.computeHash(content);
    const existing = this.hashCache.get(hash);
    if (existing) {
      this.urlToPath.set(url, existing.path);
      return {
        path: existing.path,
        isDuplicate: true,
        originalUrl: existing.originalUrl
      };
    }
    const folder = this.getAssetFolder(mimeType, url);
    let filename = this.getFilename(url);
    const basePath = join(folder, filename);
    const finalPath = this.resolveCollision(basePath, hash);
    this.hashCache.set(hash, {
      hash,
      path: finalPath,
      originalUrl: url
    });
    this.urlToPath.set(url, finalPath);
    return {
      path: finalPath,
      isDuplicate: false
    };
  }
  getFilename(url) {
    try {
      const urlObj = new URL(url);
      let pathname = urlObj.pathname;
      if (pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }
      let filename = basename(pathname);
      if (!filename || filename === "/") {
        filename = "index";
      }
      const queryIndex = filename.indexOf("?");
      if (queryIndex > 0) {
        filename = filename.slice(0, queryIndex);
      }
      return filename;
    } catch {
      return "asset";
    }
  }
  resolveCollision(basePath, _hash) {
    const existingVersion = this.filenameVersions.get(basePath);
    if (existingVersion === undefined) {
      this.filenameVersions.set(basePath, 1);
      return basePath;
    }
    const ext = extname(basePath);
    const nameWithoutExt = basePath.slice(0, -ext.length || undefined);
    const newVersion = existingVersion + 1;
    this.filenameVersions.set(basePath, newVersion);
    const versionedPath = `${nameWithoutExt}_v${newVersion}${ext}`;
    return versionedPath;
  }
  getPathForUrl(url) {
    return this.urlToPath.get(url);
  }
  getUrlMappings() {
    return new Map(this.urlToPath);
  }
  clear() {
    this.hashCache.clear();
    this.urlToPath.clear();
    this.filenameVersions.clear();
  }
  getStats() {
    return {
      uniqueFiles: this.hashCache.size,
      duplicatesFound: this.urlToPath.size - this.hashCache.size,
      totalUrls: this.urlToPath.size
    };
  }
}
export default AssetOrganizer;
