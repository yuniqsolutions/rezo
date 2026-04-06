const { promises: fs } = require("node:fs");
const { dirname, join, relative } = require("node:path");
const { parseHTML } = require('../dom/index.cjs');
const { DEFAULT_ASSET_FOLDERS } = require('./asset-organizer.cjs');

class StyleExtractor {
  options;
  constructor(options) {
    this.options = options;
  }
  async processFile(htmlPath, outputDir, baseFile) {
    const result = {
      modified: false,
      stylesExtracted: 0,
      scriptsRemoved: 0,
      extractedFiles: new Map
    };
    let html;
    try {
      html = await fs.readFile(htmlPath, "utf-8");
    } catch {
      return result;
    }
    const { document } = parseHTML(html);
    if (this.options.extractInternalStyles) {
      const styleResult = await this.extractStyles(document, outputDir, baseFile);
      result.stylesExtracted = styleResult.count;
      result.extractedFiles = styleResult.files;
      if (styleResult.count > 0)
        result.modified = true;
    }
    if (this.options.removeJavascript) {
      const removed = this.removeScripts(document);
      result.scriptsRemoved = removed;
      if (removed > 0)
        result.modified = true;
    }
    if (result.modified) {
      const serialized = document.toString();
      await fs.writeFile(htmlPath, serialized, "utf-8");
    }
    return result;
  }
  async extractStyles(document, outputDir, baseFile) {
    const files = new Map;
    const styleTags = Array.from(document.querySelectorAll("style"));
    if (styleTags.length === 0) {
      return { count: 0, files };
    }
    const htmlDir = dirname(baseFile);
    const cssFolder = this.getCssFolder();
    let count = 0;
    for (let i = 0;i < styleTags.length; i++) {
      const styleTag = styleTags[i];
      const content = styleTag.textContent;
      if (!content || !content.trim()) {
        continue;
      }
      const identifier = this.getStyleIdentifier(styleTag, i);
      const cssFilename = `internal.${identifier}.css`;
      let cssRelativePath;
      if (this.options.organizeAssets) {
        cssRelativePath = join(cssFolder, cssFilename);
      } else {
        cssRelativePath = join(htmlDir, cssFilename);
      }
      const cssFullPath = join(outputDir, cssRelativePath);
      await fs.mkdir(dirname(cssFullPath), { recursive: true });
      await fs.writeFile(cssFullPath, content, "utf-8");
      const linkHref = this.getRelativePath(htmlDir, cssRelativePath);
      const linkEl = document.createElement("link");
      linkEl.setAttribute("rel", "stylesheet");
      linkEl.setAttribute("href", linkHref);
      const media = styleTag.getAttribute("media");
      if (media) {
        linkEl.setAttribute("media", media);
      }
      styleTag.replaceWith(linkEl);
      const syntheticUrl = `internal-style://${baseFile}/${cssFilename}`;
      files.set(syntheticUrl, cssRelativePath);
      count++;
    }
    return { count, files };
  }
  removeScripts(document) {
    const scriptTags = Array.from(document.querySelectorAll("script"));
    for (const script of scriptTags) {
      script.remove();
    }
    const allElements = Array.from(document.querySelectorAll("*"));
    for (const el of allElements) {
      const attrs = Array.from(el.attributes || []);
      for (const attr of attrs) {
        if (attr.name.toLowerCase().startsWith("on")) {
          el.removeAttribute(attr.name);
        }
      }
      const href = el.getAttribute("href");
      if (href && href.trim().toLowerCase().startsWith("javascript:")) {
        el.removeAttribute("href");
      }
      const action = el.getAttribute("action");
      if (action && action.trim().toLowerCase().startsWith("javascript:")) {
        el.removeAttribute("action");
      }
    }
    return scriptTags.length;
  }
  getStyleIdentifier(element, index) {
    const id = element.getAttribute("id");
    if (id)
      return this.sanitize(id);
    const name = element.getAttribute("name");
    if (name)
      return this.sanitize(name);
    const cls = element.getAttribute("class");
    if (cls) {
      const first = cls.trim().split(/\s+/)[0];
      if (first)
        return this.sanitize(first);
    }
    return String(index);
  }
  sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 100);
  }
  getCssFolder() {
    return this.options.assetFolders?.css || DEFAULT_ASSET_FOLDERS.css;
  }
  getRelativePath(from, to) {
    let rel = relative(from, to).replace(/\\/g, "/");
    if (!rel.startsWith("../") && !rel.startsWith("./")) {
      rel = "./" + rel;
    }
    return rel;
  }
}

exports.StyleExtractor = StyleExtractor;
exports.default = StyleExtractor;
module.exports = Object.assign(StyleExtractor, exports);