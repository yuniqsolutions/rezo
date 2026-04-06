const { promises: fs } = require("node:fs");
const { dirname, relative, join, extname, basename } = require("node:path");
const { parseHTML } = require('../dom/index.cjs');
const EXT_TO_FOLDER = {
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
  ".mp4": "video",
  ".webm": "video",
  ".ogv": "video",
  ".mov": "video"
};

class LinkConverter {
  options;
  onEvent;
  constructor(options) {
    this.options = options;
  }
  setEventHandler(handler) {
    this.onEvent = handler;
  }
  async convertLinks(outputDir, urlMap, mimeMap) {
    const stats = {
      filesProcessed: 0,
      filesModified: 0,
      linksConverted: 0,
      linksToRelative: 0,
      linksToAbsolute: 0
    };
    const pathToUrl = new Map;
    for (const [url, path] of urlMap) {
      if (!pathToUrl.has(path)) {
        pathToUrl.set(path, url);
      }
    }
    const urlLookup = new Map;
    for (const [url, path] of urlMap) {
      urlLookup.set(url, path);
      try {
        const parsed = new URL(url);
        if (parsed.search) {
          urlLookup.set(parsed.origin + parsed.pathname, path);
        }
      } catch {}
    }
    const htmlMimes = ["text/html", "application/xhtml+xml"];
    const cssMimes = ["text/css"];
    const filesToProcess = Array.from(new Set(urlMap.values())).filter((path) => {
      if (mimeMap) {
        const mime = mimeMap.get(path);
        if (mime) {
          const baseMime = mime.split(";")[0].trim().toLowerCase();
          return htmlMimes.includes(baseMime) || cssMimes.includes(baseMime);
        }
      }
      const ext = extname(path).toLowerCase();
      return ext === ".css" || ext === ".html" || ext === ".htm";
    });
    this.emitEvent({
      phase: "start",
      totalFiles: filesToProcess.length
    });
    for (const relativePath of filesToProcess) {
      const fullPath = join(outputDir, relativePath);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        let converted;
        let linkCount;
        const pageUrl = pathToUrl.get(relativePath);
        const mime = mimeMap?.get(relativePath)?.split(";")[0].trim().toLowerCase();
        const isCss = mime ? cssMimes.includes(mime) : extname(relativePath).toLowerCase() === ".css";
        if (isCss) {
          const result = this.convertCSSLinks(content, urlLookup, relativePath, outputDir, pageUrl);
          converted = result.content;
          linkCount = result.linksConverted;
          stats.linksToRelative += result.linksToRelative;
          stats.linksToAbsolute += result.linksToAbsolute;
        } else {
          const result = this.convertHTMLLinks(content, urlLookup, relativePath, outputDir, pageUrl);
          converted = result.content;
          linkCount = result.linksConverted;
          stats.linksToRelative += result.linksToRelative;
          stats.linksToAbsolute += result.linksToAbsolute;
        }
        stats.filesProcessed++;
        stats.linksConverted += linkCount;
        if (converted !== content) {
          if (this.options.backupConverted) {
            await fs.copyFile(fullPath, fullPath + ".orig");
          }
          await fs.writeFile(fullPath, converted, "utf-8");
          stats.filesModified++;
        }
      } catch (error) {
        console.warn(`Failed to convert links in ${fullPath}:`, error);
      }
    }
    this.emitEvent({
      phase: "complete",
      totalFiles: filesToProcess.length,
      convertedFiles: stats.filesModified,
      linksConverted: stats.linksConverted
    });
    return stats;
  }
  convertHTMLLinks(html, urlMap, baseFile, outputDir, pageUrl) {
    let linksConverted = 0;
    let linksToRelative = 0;
    let linksToAbsolute = 0;
    const { document } = parseHTML(html);
    const urlAttributes = {
      a: ["href"],
      area: ["href"],
      link: ["href"],
      script: ["src"],
      img: ["src", "srcset"],
      source: ["src", "srcset"],
      video: ["src", "poster"],
      audio: ["src"],
      track: ["src"],
      iframe: ["src"],
      frame: ["src"],
      embed: ["src"],
      object: ["data"],
      form: ["action"],
      input: ["src"]
    };
    for (const [tag, attrs] of Object.entries(urlAttributes)) {
      const elements = Array.from(document.querySelectorAll(tag));
      for (const element of elements) {
        for (const attr of attrs) {
          const value = element.getAttribute(attr);
          if (!value)
            continue;
          if (attr === "srcset") {
            const converted = this.convertSrcset(value, urlMap, baseFile, pageUrl);
            if (converted !== value) {
              element.setAttribute(attr, converted);
              linksConverted++;
            }
            continue;
          }
          if (this.isSpecialUrl(value))
            continue;
          const result = this.convertUrl(value, urlMap, baseFile, pageUrl);
          if (result.converted !== value) {
            element.setAttribute(attr, result.converted);
            linksConverted++;
            if (result.type === "relative") {
              linksToRelative++;
            } else {
              linksToAbsolute++;
            }
          }
        }
      }
    }
    const elementsWithStyle = Array.from(document.querySelectorAll("[style]"));
    for (const element of elementsWithStyle) {
      const style = element.getAttribute("style");
      if (style && style.includes("url(")) {
        const converted = this.convertCSSUrls(style, urlMap, baseFile, pageUrl);
        if (converted !== style) {
          element.setAttribute("style", converted);
          linksConverted++;
        }
      }
    }
    const styleTags = Array.from(document.querySelectorAll("style"));
    for (const styleTag of styleTags) {
      const content = styleTag.textContent;
      if (content && content.includes("url(")) {
        const converted = this.convertCSSUrls(content, urlMap, baseFile, pageUrl);
        if (converted !== content) {
          styleTag.textContent = converted;
          linksConverted++;
        }
      }
    }
    const serialized = document.toString();
    return {
      content: serialized,
      linksConverted,
      linksToRelative,
      linksToAbsolute
    };
  }
  convertCSSLinks(css, urlMap, baseFile, outputDir, pageUrl) {
    let linksConverted = 0;
    let linksToRelative = 0;
    let linksToAbsolute = 0;
    let converted = css.replace(/@import\s+(?:url\s*\(\s*)?(['"]?)([^'"\)\s;]+)\1\s*\)?/gi, (match, quote, url) => {
      if (this.isSpecialUrl(url))
        return match;
      const result = this.convertUrl(url, urlMap, baseFile, pageUrl);
      if (result.converted !== url) {
        linksConverted++;
        if (result.type === "relative") {
          linksToRelative++;
        } else {
          linksToAbsolute++;
        }
      }
      return `@import url(${quote}${result.converted}${quote})`;
    });
    converted = converted.replace(/url\s*\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, quote, url) => {
      if (this.isSpecialUrl(url))
        return match;
      const result = this.convertUrl(url, urlMap, baseFile, pageUrl);
      if (result.converted !== url) {
        linksConverted++;
        if (result.type === "relative") {
          linksToRelative++;
        } else {
          linksToAbsolute++;
        }
      }
      return `url(${quote}${result.converted}${quote})`;
    });
    return {
      content: converted,
      linksConverted,
      linksToRelative,
      linksToAbsolute
    };
  }
  convertCSSUrls(css, urlMap, baseFile, pageUrl) {
    return css.replace(/url\s*\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, quote, url) => {
      if (this.isSpecialUrl(url))
        return match;
      const result = this.convertUrl(url, urlMap, baseFile, pageUrl);
      return `url(${quote}${result.converted}${quote})`;
    });
  }
  convertSrcset(srcset, urlMap, baseFile, pageUrl) {
    const parts = srcset.split(",").map((part) => {
      const trimmed = part.trim();
      const spaceIndex = trimmed.search(/\s/);
      if (spaceIndex === -1) {
        const result = this.convertUrl(trimmed, urlMap, baseFile, pageUrl);
        return result.converted;
      }
      const url = trimmed.substring(0, spaceIndex);
      const descriptor = trimmed.substring(spaceIndex);
      const result = this.convertUrl(url, urlMap, baseFile, pageUrl);
      return result.converted + descriptor;
    });
    return parts.join(", ");
  }
  convertUrl(url, urlMap, baseFile, pageUrl) {
    const normalizedUrl = this.normalizeUrl(url);
    let resolvedUrl;
    let resolvedClean;
    if (pageUrl && !url.startsWith("http://") && !url.startsWith("https://")) {
      try {
        const parsed = new URL(url, pageUrl);
        resolvedUrl = parsed.href;
        if (parsed.search || parsed.hash) {
          resolvedClean = parsed.origin + parsed.pathname;
        }
      } catch {}
    }
    let urlClean;
    try {
      const parsed = new URL(url);
      if (parsed.search || parsed.hash) {
        urlClean = parsed.origin + parsed.pathname;
      }
    } catch {}
    const localPath = urlMap.get(normalizedUrl) || urlMap.get(url) || urlClean && urlMap.get(urlClean) || resolvedUrl && urlMap.get(resolvedUrl) || resolvedClean && urlMap.get(resolvedClean) || resolvedUrl && urlMap.get(this.normalizeUrl(resolvedUrl)) || urlMap.get(normalizedUrl.endsWith("/") ? normalizedUrl.slice(0, -1) : normalizedUrl + "/") || urlMap.get(url.endsWith("/") ? url.slice(0, -1) : url + "/");
    if (localPath) {
      const baseDir = dirname(baseFile);
      const relativePath = this.getRelativePath(baseDir, localPath);
      return { converted: relativePath, type: "relative" };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return { converted: url, type: "absolute" };
    }
    if (url.startsWith("/")) {
      const baseDir = dirname(baseFile);
      const parts = baseDir.split("/").filter((p) => p && p !== ".");
      const matchingPath = this.findSiteRootUrlInMap(url, urlMap);
      if (matchingPath) {
        const relativePath = this.getRelativePath(baseDir, matchingPath);
        return { converted: relativePath, type: "relative" };
      }
      if (this.options.organizeAssets) {
        const organizedPath = this.getOrganizedPathForUrl(url);
        if (organizedPath) {
          const relativePath = this.getRelativePath(baseDir, organizedPath);
          return { converted: relativePath, type: "relative" };
        }
      }
      if (parts.length > 0) {
        const firstPart = parts[0];
        if (firstPart.includes(".")) {
          const targetPath = firstPart + url;
          const relativePath = this.getRelativePath(baseDir, targetPath);
          return { converted: relativePath, type: "relative" };
        }
        const depth = parts.length;
        const prefix = depth > 0 ? "../".repeat(depth) : "./";
        return { converted: prefix + url.slice(1), type: "relative" };
      }
      return { converted: "." + url, type: "relative" };
    }
    if (!url.startsWith("./") && !url.startsWith("../")) {
      return { converted: "./" + url, type: "relative" };
    }
    return { converted: url, type: "relative" };
  }
  getRelativePath(from, to) {
    let relativePath = relative(from, to);
    relativePath = relativePath.replace(/\\/g, "/");
    if (!relativePath.startsWith("../") && !relativePath.startsWith("./")) {
      relativePath = "./" + relativePath;
    }
    return relativePath;
  }
  getOrganizedPathForUrl(url) {
    const ext = extname(url).toLowerCase();
    const folder = EXT_TO_FOLDER[ext];
    if (!folder) {
      return;
    }
    const filename = basename(url);
    return join(folder, filename);
  }
  findSiteRootUrlInMap(siteRootUrl, urlMap) {
    for (const [fullUrl, localPath] of urlMap) {
      try {
        const parsed = new URL(fullUrl);
        if (parsed.pathname === siteRootUrl) {
          return localPath;
        }
      } catch {}
    }
    return;
  }
  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      if (parsed.protocol === "http:" && parsed.port === "80" || parsed.protocol === "https:" && parsed.port === "443") {
        parsed.port = "";
      }
      return parsed.href;
    } catch {
      return url;
    }
  }
  isSpecialUrl(url) {
    return url.startsWith("data:") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("#") || url.startsWith("blob:");
  }
  emitEvent(event) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}

exports.LinkConverter = LinkConverter;
exports.default = LinkConverter;
module.exports = Object.assign(LinkConverter, exports);