const { parseHTML, DOMParser } = require('../dom/index.cjs');
const HTML_URL_ATTRIBUTES = {
  a: ["href"],
  area: ["href"],
  link: ["href"],
  base: ["href"],
  img: ["src", "srcset", "data-src", "data-srcset", "data-lazy-src"],
  picture: [],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  script: ["src"],
  style: [],
  iframe: ["src"],
  frame: ["src"],
  embed: ["src"],
  object: ["data", "codebase"],
  form: ["action"],
  input: ["src"],
  button: ["formaction"],
  meta: ["content"],
  body: ["background"],
  table: ["background"],
  td: ["background"],
  th: ["background"],
  blockquote: ["cite"],
  q: ["cite"],
  del: ["cite"],
  ins: ["cite"],
  applet: ["code", "codebase", "archive"]
};
const META_URL_PROPERTIES = [
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "og:video",
  "og:video:url",
  "og:video:secure_url",
  "og:audio",
  "og:audio:url",
  "og:audio:secure_url",
  "og:url",
  "twitter:image",
  "twitter:image:src",
  "twitter:player",
  "twitter:player:stream"
];
const REQUISITE_LINK_RELS = [
  "stylesheet",
  "icon",
  "shortcut icon",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "manifest",
  "preload",
  "modulepreload"
];
function determineAssetType(url, tag, attribute, rel) {
  const lowerTag = tag.toLowerCase();
  const lowerUrl = url.toLowerCase();
  if (lowerTag === "script")
    return "script";
  if (lowerTag === "style")
    return "stylesheet";
  if (lowerTag === "img" || lowerTag === "picture")
    return "image";
  if (lowerTag === "video")
    return "video";
  if (lowerTag === "audio")
    return "audio";
  if (lowerTag === "iframe" || lowerTag === "frame")
    return "iframe";
  if (lowerTag === "embed" || lowerTag === "object")
    return "object";
  if (lowerTag === "link" && rel) {
    const lowerRel = rel.toLowerCase();
    if (lowerRel.includes("stylesheet"))
      return "stylesheet";
    if (lowerRel.includes("icon"))
      return "favicon";
    if (lowerRel.includes("manifest"))
      return "manifest";
    if (lowerRel.includes("preload") || lowerRel.includes("modulepreload")) {
      return "other";
    }
  }
  const ext = getUrlExtension(lowerUrl);
  switch (ext) {
    case "css":
      return "stylesheet";
    case "js":
    case "mjs":
    case "cjs":
      return "script";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "avif":
    case "svg":
    case "ico":
    case "bmp":
    case "tiff":
    case "tif":
      return "image";
    case "mp4":
    case "webm":
    case "ogg":
    case "ogv":
    case "mov":
    case "avi":
    case "mkv":
      return "video";
    case "mp3":
    case "wav":
    case "flac":
    case "aac":
    case "m4a":
    case "oga":
      return "audio";
    case "woff":
    case "woff2":
    case "ttf":
    case "otf":
    case "eot":
      return "font";
    case "html":
    case "htm":
    case "xhtml":
    case "php":
    case "asp":
    case "aspx":
    case "jsp":
      return "document";
    case "json":
    case "xml":
      return "data";
    case "webmanifest":
      return "manifest";
    default:
      if (lowerTag === "a")
        return "document";
      return "other";
  }
}
function getUrlExtension(url) {
  try {
    const pathname = new URL(url, "http://localhost").pathname;
    const lastDot = pathname.lastIndexOf(".");
    const lastSlash = pathname.lastIndexOf("/");
    if (lastDot > lastSlash && lastDot < pathname.length - 1) {
      return pathname.slice(lastDot + 1).toLowerCase();
    }
  } catch {
    const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
    if (match)
      return match[1].toLowerCase();
  }
  return "";
}
function isPageRequisite(type, tag, rel) {
  if (["stylesheet", "script", "font", "favicon", "manifest"].includes(type)) {
    return true;
  }
  if (type === "image") {
    return true;
  }
  if (tag.toLowerCase() === "link" && rel) {
    return REQUISITE_LINK_RELS.some((r) => rel.toLowerCase().includes(r));
  }
  return false;
}

class AssetExtractor {
  extractFromHTML(html, baseUrl, options) {
    const assets = [];
    const { document } = parseHTML(html);
    const baseElement = document.querySelector("base[href]");
    if (baseElement) {
      const baseHref = baseElement.getAttribute("href");
      if (baseHref) {
        baseUrl = this.resolveUrl(baseHref, baseUrl) || baseUrl;
      }
    }
    const followTags = options?.followTags ? new Set(options.followTags.map((t) => t.toLowerCase())) : null;
    const ignoreTags = options?.ignoreTags ? new Set(options.ignoreTags.map((t) => t.toLowerCase())) : null;
    for (const [tag, attributes] of Object.entries(HTML_URL_ATTRIBUTES)) {
      const lowerTag = tag.toLowerCase();
      if (followTags && !followTags.has(lowerTag))
        continue;
      if (ignoreTags && ignoreTags.has(lowerTag))
        continue;
      const elements = Array.from(document.querySelectorAll(tag));
      for (const element of elements) {
        const rel = element.getAttribute("rel");
        for (const attr of attributes) {
          const value = element.getAttribute(attr);
          if (!value)
            continue;
          if (attr === "srcset" || attr === "data-srcset") {
            const srcsetUrls = this.parseSrcset(value, baseUrl);
            for (const url of srcsetUrls) {
              assets.push({
                url,
                type: "image",
                source: "html",
                tag: lowerTag,
                attribute: attr,
                required: true,
                inline: false
              });
            }
            continue;
          }
          if (lowerTag === "meta" && attr === "content") {
            const property = element.getAttribute("property") || element.getAttribute("name");
            if (!property || !META_URL_PROPERTIES.includes(property.toLowerCase())) {
              continue;
            }
          }
          const resolvedUrl = this.resolveUrl(value, baseUrl);
          if (!resolvedUrl)
            continue;
          const assetType = determineAssetType(resolvedUrl, lowerTag, attr, rel);
          const required = isPageRequisite(assetType, lowerTag, rel);
          assets.push({
            url: resolvedUrl,
            type: assetType,
            source: "html",
            tag: lowerTag,
            attribute: attr,
            required,
            inline: false
          });
        }
        const styleAttr = element.getAttribute("style");
        if (styleAttr) {
          const cssAssets = this.extractUrlsFromCSSText(styleAttr, baseUrl);
          for (const cssAsset of cssAssets) {
            assets.push({
              ...cssAsset,
              source: "html",
              tag: lowerTag,
              attribute: "style",
              inline: true
            });
          }
        }
      }
    }
    const styleTags = Array.from(document.querySelectorAll("style"));
    for (const styleTag of styleTags) {
      const cssContent = styleTag.textContent;
      if (cssContent) {
        const cssAssets = this.extractFromCSS(cssContent, baseUrl);
        for (const asset of cssAssets) {
          assets.push({
            ...asset,
            source: "html",
            tag: "style",
            inline: true
          });
        }
      }
    }
    return assets;
  }
  extractFromCSS(css, baseUrl) {
    const assets = [];
    const importRegex = /@import\s+(?:url\s*\(\s*)?['"]?([^'"\)\s;]+)['"]?\s*\)?[^;]*;/gi;
    let match;
    while ((match = importRegex.exec(css)) !== null) {
      const url = this.resolveUrl(match[1], baseUrl);
      if (url) {
        assets.push({
          url,
          type: "stylesheet",
          source: "css",
          required: true,
          inline: false
        });
      }
    }
    const urlAssets = this.extractUrlsFromCSSText(css, baseUrl);
    assets.push(...urlAssets);
    return assets;
  }
  extractUrlsFromCSSText(css, baseUrl) {
    const assets = [];
    const urlRegex = /url\s*\(\s*(['"]?)([^'"\)\s]+)\1\s*\)/gi;
    let match;
    while ((match = urlRegex.exec(css)) !== null) {
      const urlValue = match[2].trim();
      if (urlValue.startsWith("data:")) {
        continue;
      }
      if (!urlValue || urlValue.startsWith("#")) {
        continue;
      }
      const resolvedUrl = this.resolveUrl(urlValue, baseUrl);
      if (!resolvedUrl)
        continue;
      const type = this.guessAssetTypeFromUrl(resolvedUrl);
      assets.push({
        url: resolvedUrl,
        type,
        source: "css",
        required: true,
        inline: false
      });
    }
    return assets;
  }
  extractFromXML(xml, baseUrl) {
    const assets = [];
    try {
      const parser = new DOMParser;
      const doc = parser.parseFromString(xml, "text/xml");
      const isSVG = doc.documentElement?.tagName.toLowerCase() === "svg";
      const source = isSVG ? "svg" : "xml";
      const allElements = Array.from(doc.querySelectorAll("*"));
      for (const el of allElements) {
        for (const attr of ["href", "src", "xlink:href"]) {
          const value = el.getAttribute(attr);
          if (value && !value.startsWith("#") && !value.startsWith("data:")) {
            const resolvedUrl = this.resolveUrl(value, baseUrl);
            if (resolvedUrl) {
              if (!assets.some((a) => a.url === resolvedUrl)) {
                const tagName = el.tagName.toLowerCase();
                let assetType = this.guessAssetTypeFromUrl(resolvedUrl);
                if (isSVG) {
                  if (tagName === "image")
                    assetType = "image";
                  else if (tagName === "use")
                    assetType = "image";
                }
                assets.push({
                  url: resolvedUrl,
                  type: assetType,
                  source,
                  tag: tagName,
                  attribute: attr,
                  required: isSVG && (tagName === "image" || tagName === "use"),
                  inline: false
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn("Failed to parse XML/SVG:", error);
    }
    return assets;
  }
  extractFromJS(js, baseUrl) {
    const assets = [];
    const seen = new Set;
    const patterns = [
      /['"`](https?:\/\/[^'"`\s]+)['"`]/gi,
      /['"`](\/[a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]+)['"`]/gi,
      /['"`](\.\/[a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]+)['"`]/gi
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(js)) !== null) {
        const urlCandidate = match[1];
        if (seen.has(urlCandidate))
          continue;
        seen.add(urlCandidate);
        if (urlCandidate.startsWith("data:"))
          continue;
        const resolvedUrl = this.resolveUrl(urlCandidate, baseUrl);
        if (!resolvedUrl)
          continue;
        const ext = getUrlExtension(resolvedUrl);
        if (ext && ["js", "css", "png", "jpg", "jpeg", "gif", "svg", "webp", "json", "html"].includes(ext)) {
          assets.push({
            url: resolvedUrl,
            type: this.guessAssetTypeFromUrl(resolvedUrl),
            source: "js",
            required: false,
            inline: false
          });
        }
      }
    }
    return assets;
  }
  parseSrcset(srcset, baseUrl) {
    const urls = [];
    const candidates = srcset.split(/,\s*(?=[^\s])/);
    for (const candidate of candidates) {
      const parts = candidate.trim().split(/\s+/);
      if (parts.length > 0 && parts[0]) {
        const url = this.resolveUrl(parts[0], baseUrl);
        if (url) {
          urls.push(url);
        }
      }
    }
    return urls;
  }
  resolveUrl(url, baseUrl) {
    if (!url)
      return null;
    url = url.trim();
    if (!url || url.startsWith("#") || url.startsWith("javascript:") || url.startsWith("data:") || url.startsWith("mailto:") || url.startsWith("tel:")) {
      return null;
    }
    try {
      const resolved = new URL(url, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        return null;
      }
      return resolved.href;
    } catch {
      return null;
    }
  }
  guessAssetTypeFromUrl(url) {
    const ext = getUrlExtension(url);
    switch (ext) {
      case "css":
        return "stylesheet";
      case "js":
      case "mjs":
      case "cjs":
        return "script";
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "webp":
      case "avif":
      case "svg":
      case "ico":
      case "bmp":
        return "image";
      case "mp4":
      case "webm":
      case "ogg":
      case "ogv":
        return "video";
      case "mp3":
      case "wav":
      case "flac":
      case "aac":
        return "audio";
      case "woff":
      case "woff2":
      case "ttf":
      case "otf":
      case "eot":
        return "font";
      case "html":
      case "htm":
      case "xhtml":
        return "document";
      case "json":
      case "xml":
        return "data";
      default:
        return "other";
    }
  }
  filterAssets(assets, options) {
    return assets.filter((asset) => {
      if (options.acceptAssetTypes && options.acceptAssetTypes.length > 0) {
        if (!options.acceptAssetTypes.includes(asset.type)) {
          return false;
        }
      }
      if (options.rejectAssetTypes && options.rejectAssetTypes.length > 0) {
        if (options.rejectAssetTypes.includes(asset.type)) {
          return false;
        }
      }
      if (options.followTags && asset.tag) {
        if (!options.followTags.includes(asset.tag)) {
          return false;
        }
      }
      if (options.ignoreTags && asset.tag) {
        if (options.ignoreTags.includes(asset.tag)) {
          return false;
        }
      }
      if (options.accept) {
        const patterns = Array.isArray(options.accept) ? options.accept : options.accept.split(",");
        const matches = patterns.some((p) => this.matchGlob(asset.url, p.trim()));
        if (!matches)
          return false;
      }
      if (options.reject) {
        const patterns = Array.isArray(options.reject) ? options.reject : options.reject.split(",");
        const matches = patterns.some((p) => this.matchGlob(asset.url, p.trim()));
        if (matches)
          return false;
      }
      if (options.acceptRegex) {
        const regex = options.acceptRegex instanceof RegExp ? options.acceptRegex : new RegExp(options.acceptRegex);
        if (!regex.test(asset.url))
          return false;
      }
      if (options.rejectRegex) {
        const regex = options.rejectRegex instanceof RegExp ? options.rejectRegex : new RegExp(options.rejectRegex);
        if (regex.test(asset.url))
          return false;
      }
      if (options.excludeExtensions && options.excludeExtensions.length > 0) {
        const ext = getUrlExtension(asset.url);
        if (ext) {
          const normalizedExt = "." + ext.toLowerCase();
          const excluded = options.excludeExtensions.some((excludeExt) => {
            const normalizedExclude = excludeExt.startsWith(".") ? excludeExt.toLowerCase() : ("." + excludeExt).toLowerCase();
            return normalizedExt === normalizedExclude;
          });
          if (excluded)
            return false;
        }
      }
      return true;
    });
  }
  matchGlob(url, pattern) {
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexStr}$|${regexStr}`, "i");
    return regex.test(url);
  }
  extract(content, mimeType, baseUrl, options) {
    const lowerMime = mimeType.toLowerCase();
    if (lowerMime.includes("html") || lowerMime.includes("xhtml")) {
      return this.extractFromHTML(content, baseUrl, options);
    }
    if (lowerMime.includes("css")) {
      return this.extractFromCSS(content, baseUrl);
    }
    if (lowerMime.includes("svg")) {
      return this.extractFromXML(content, baseUrl);
    }
    if (lowerMime.includes("xml")) {
      return this.extractFromXML(content, baseUrl);
    }
    if (lowerMime.includes("javascript") || lowerMime.includes("ecmascript")) {
      return this.extractFromJS(content, baseUrl);
    }
    return [];
  }
}

exports.AssetExtractor = AssetExtractor;
exports.default = AssetExtractor;
module.exports = Object.assign(AssetExtractor, exports);