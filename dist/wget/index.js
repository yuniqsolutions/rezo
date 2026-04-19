export { WgetError } from './types.js';
export { AssetExtractor } from './asset-extractor.js';
export { UrlFilter } from './url-filter.js';
export { FileWriter } from './file-writer.js';
export { RobotsHandler } from './robots.js';
export { ResumeHandler } from './resume.js';
export { ProgressReporter, ProgressTracker, parseSize } from './progress.js';
export { LinkConverter } from './link-converter.js';
export { StyleExtractor } from './style-extractor.js';
export { Downloader } from './downloader.js';
export { AssetOrganizer, DEFAULT_ASSET_FOLDERS } from './asset-organizer.js';
export { DownloadCache } from './download-cache.js';
export {
  EXECUTABLE_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  WEB_ASSET_EXTENSIONS,
  DATA_EXTENSIONS,
  EXECUTABLE_MIME_TYPES,
  ARCHIVE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  AUDIO_MIME_TYPES,
  FONT_MIME_TYPES,
  WEB_ASSET_MIME_TYPES,
  DATA_MIME_TYPES,
  SAFE_WEB_PRESET,
  DOCUMENTS_ONLY_PRESET,
  NO_MEDIA_PRESET,
  MINIMAL_MIRROR_PRESET,
  TEXT_ONLY_PRESET
} from './filter-lists.js';
import { Downloader } from './downloader.js';
import rezo from '../index.js';
import { promises as fs } from "node:fs";
import { ProgressReporter } from './progress.js';
import { flattenWgetOptions } from './types.js';
import { parseProxyString } from '../proxy/parse.js';

export class Wget {
  options = {};
  downloader = null;
  eventHandlers = new Map;
  http;
  constructor(options = {}) {
    this.options = JSON.parse(JSON.stringify(options));
    this.options.proxy = this.parseProxyString(this.options.proxy || "");
    const timeout = this.options.download?.timeout ?? 30;
    const maxRedirects = this.options.http?.maxRedirects;
    const userAgent = this.options.http?.userAgent ?? "Rezo-Wget/1.0";
    const headers = this.options.http?.headers ?? {};
    const noCheckCert = this.options.http?.noCheckCertificate ?? false;
    const proxyConfig = this.options.proxy;
    const concurrency = this.options.download?.concurrency ?? 1;
    const wait = this.options.download?.wait ?? 0;
    this.http = rezo.create({
      timeout: timeout * 1000,
      maxRedirects,
      headers: {
        "User-Agent": userAgent,
        ...headers
      },
      rejectUnauthorized: !noCheckCert,
      proxy: proxyConfig,
      queueOptions: {
        enable: true,
        options: {
          concurrency,
          ...wait > 0 ? {
            interval: wait * 1000,
            intervalCap: 1
          } : {}
        }
      }
    });
  }
  parseProxyString(proxy) {
    if (!proxy)
      return;
    if (typeof proxy === "string") {
      return parseProxyString(proxy) || undefined;
    }
    return proxy;
  }
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
    return this;
  }
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
    return this;
  }
  onProgress(callback) {
    return this.on("progress", callback);
  }
  onDownload(callback) {
    return this.on("complete", callback);
  }
  onError(callback) {
    return this.on("error", (event) => callback(event.error, event.url));
  }
  onComplete(callback) {
    return this.on("finish", (event) => callback(event.stats));
  }
  async get(url, options) {
    const mergedOptions = this.mergeOptions(this.options, options);
    const flatOptions = flattenWgetOptions(mergedOptions);
    this.downloader = new Downloader(flatOptions, this.http);
    this.attachEventHandlers();
    return this.downloader.download(url);
  }
  async getAll(urls, options) {
    const mergedOptions = this.mergeOptions(this.options, options);
    const flatOptions = flattenWgetOptions(mergedOptions);
    this.downloader = new Downloader(flatOptions, this.http);
    this.attachEventHandlers();
    return this.downloader.download(urls);
  }
  async mirror(url, options) {
    const mirrorOptions = {
      recursive: {
        enabled: true,
        mirror: true,
        depth: 1 / 0
      },
      download: {
        timestamping: true
      },
      ...options
    };
    return this.get(url, mirrorOptions);
  }
  async fromFile(inputFile, options) {
    const content = await fs.readFile(inputFile, "utf-8");
    const urls = content.split(`
`).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    return this.getAll(urls, options);
  }
  async post(url, body, options) {
    return this.runWithMethod("POST", url, body, options);
  }
  async put(url, body, options) {
    return this.runWithMethod("PUT", url, body, options);
  }
  async patch(url, body, options) {
    return this.runWithMethod("PATCH", url, body, options);
  }
  async delete(url, body, options) {
    return this.runWithMethod("DELETE", url, body, options);
  }
  async head(url, options) {
    return this.runWithMethod("HEAD", url, undefined, options);
  }
  async runWithMethod(method, url, body, options) {
    const { encoded, contentType } = encodeWgetBody(body);
    const merged = {
      ...options ?? {},
      http: {
        ...options?.http ?? {},
        method,
        ...encoded !== undefined ? { postData: encoded } : {},
        headers: {
          ...options?.http?.headers ?? {},
          ...contentType && !options?.http?.headers?.["Content-Type"] ? { "Content-Type": contentType } : {}
        }
      }
    };
    return this.get(url, merged);
  }
  clone(options = {}) {
    const { copyEventHandlers = true } = options;
    const sharedJar = this.options.http?.cookies?.jar;
    const sharedSignal = this.options.misc?.signal;
    const cloned = new Wget(deepCloneWgetOptions(this.options));
    if (sharedJar) {
      cloned.options.http = {
        ...cloned.options.http,
        cookies: { ...cloned.options.http?.cookies, jar: sharedJar }
      };
    }
    if (sharedSignal) {
      cloned.options.misc = { ...cloned.options.misc, signal: sharedSignal };
    }
    if (copyEventHandlers) {
      for (const [event, handlers] of Array.from(this.eventHandlers.entries())) {
        for (const handler of handlers) {
          cloned.on(event, handler);
        }
      }
    }
    return cloned;
  }
  recursive(depth) {
    this.options.recursive = { ...this.options.recursive, enabled: true };
    if (depth !== undefined) {
      this.options.recursive.depth = depth;
    }
    return this;
  }
  depth(depth) {
    this.options.recursive = { ...this.options.recursive, depth };
    return this;
  }
  pageRequisites() {
    this.options.recursive = { ...this.options.recursive, pageRequisites: true };
    return this;
  }
  convertLinks() {
    this.options.recursive = { ...this.options.recursive, convertLinks: true };
    return this;
  }
  extractInternalStyles(enabled = true) {
    this.options.recursive = { ...this.options.recursive, extractInternalStyles: enabled };
    return this;
  }
  removeJavascript(enabled = true) {
    this.options.recursive = { ...this.options.recursive, removeJavascript: enabled };
    return this;
  }
  noParent() {
    this.options.filter = { ...this.options.filter, noParent: true };
    return this;
  }
  domains(...domains) {
    this.options.filter = { ...this.options.filter, domains, spanHosts: true };
    return this;
  }
  accept(...patterns) {
    this.options.filter = { ...this.options.filter, accept: patterns };
    return this;
  }
  reject(...patterns) {
    this.options.filter = { ...this.options.filter, reject: patterns };
    return this;
  }
  wait(seconds) {
    this.options.download = { ...this.options.download, wait: seconds };
    return this;
  }
  randomWait() {
    this.options.download = { ...this.options.download, randomWait: true };
    return this;
  }
  limitRate(rate) {
    this.options.download = { ...this.options.download, limitRate: rate };
    return this;
  }
  userAgent(ua) {
    this.options.http = { ...this.options.http, userAgent: ua };
    return this;
  }
  header(name, value) {
    const headers = { ...this.options.http?.headers, [name]: value };
    this.options.http = { ...this.options.http, headers };
    return this;
  }
  outputDir(dir) {
    this.options.download = { ...this.options.download, outputDir: dir };
    return this;
  }
  output(filename) {
    this.options.download = { ...this.options.download, output: filename };
    return this;
  }
  continue() {
    this.options.download = { ...this.options.download, continue: true };
    return this;
  }
  timestamping() {
    this.options.download = { ...this.options.download, timestamping: true };
    return this;
  }
  concurrency(n) {
    this.options.download = { ...this.options.download, concurrency: n };
    return this;
  }
  noRobots() {
    this.options.robots = { ...this.options.robots, enabled: false };
    return this;
  }
  quiet() {
    this.options.logging = { ...this.options.logging, quiet: true };
    return this;
  }
  verbose() {
    this.options.logging = { ...this.options.logging, verbose: true };
    return this;
  }
  debug() {
    this.options.logging = { ...this.options.logging, debug: true };
    return this;
  }
  setProxy(proxy) {
    this.options.proxy = this.parseProxyString(proxy || "");
    return this;
  }
  timeout(seconds) {
    this.options.download = { ...this.options.download, timeout: seconds };
    return this;
  }
  tries(n) {
    this.options.download = { ...this.options.download, tries: n };
    return this;
  }
  spanHosts() {
    this.options.filter = { ...this.options.filter, spanHosts: true };
    return this;
  }
  noCheckCertificate() {
    this.options.http = { ...this.options.http, noCheckCertificate: true };
    return this;
  }
  cache(enabled = true) {
    this.options.cache = enabled;
    return this;
  }
  noCache() {
    this.options.cache = false;
    return this;
  }
  organizeAssets(enabled = true) {
    this.options.directories = { ...this.options.directories, organizeAssets: enabled };
    return this;
  }
  assetFolders(folders) {
    this.options.directories = { ...this.options.directories, assetFolders: folders };
    return this;
  }
  excludeDirectories(directories) {
    this.options.filter = { ...this.options.filter, excludeDirectories: directories };
    return this;
  }
  includeDirectories(directories) {
    this.options.filter = { ...this.options.filter, includeDirectories: directories };
    return this;
  }
  excludeExtensions(extensions) {
    this.options.filter = { ...this.options.filter, excludeExtensions: extensions };
    return this;
  }
  excludeMimeTypes(mimeTypes) {
    this.options.filter = { ...this.options.filter, excludeMimeTypes: mimeTypes };
    return this;
  }
  includeTypes(types) {
    this.options.filter = { ...this.options.filter, acceptAssetTypes: types };
    return this;
  }
  excludeTypes(types) {
    this.options.filter = { ...this.options.filter, rejectAssetTypes: types };
    return this;
  }
  maxFileSize(bytes) {
    this.options.filter = { ...this.options.filter, maxFileSize: bytes };
    return this;
  }
  minFileSize(bytes) {
    this.options.filter = { ...this.options.filter, minFileSize: bytes };
    return this;
  }
  abort() {
    if (this.downloader) {
      this.downloader.abort();
    }
  }
  async resume(url, options) {
    const resumeOpts = {
      ...options ?? {},
      resumeSession: true
    };
    if (url)
      return this.get(url, resumeOpts);
    const outputDir = this.options.download?.outputDir ?? ".";
    const { join } = await import("node:path");
    try {
      const path = join(outputDir, ".rezo-wget", "session.json");
      const raw = await fs.readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      const seeds = parsed.seedUrls ?? [];
      if (seeds.length === 0) {
        throw new Error("resume: no saved seed URLs; pass a URL explicitly");
      }
      return this.getAll(seeds, resumeOpts);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("resume:"))
        throw err;
      throw new Error(`resume: could not read session at ${outputDir}/.rezo-wget/session.json — pass a URL to start fresh`);
    }
  }
  getOptions() {
    return { ...this.options };
  }
  getUrlMap() {
    return this.downloader?.getUrlMap() || null;
  }
  async destroy() {
    if (this.downloader) {
      await this.downloader.destroy();
      this.downloader = null;
    }
    this.eventHandlers.clear();
  }
  attachEventHandlers() {
    if (!this.downloader)
      return;
    for (const [event, handlers] of Array.from(this.eventHandlers.entries())) {
      for (const handler of handlers) {
        this.downloader.on(event, handler);
      }
    }
    this.attachWgetStyleReporter();
  }
  attachWgetStyleReporter() {
    if (!this.downloader)
      return;
    const log = this.options.logging ?? {};
    if (log.quiet)
      return;
    const flat = flattenWgetOptions(this.options);
    const reporter = new ProgressReporter(flat);
    const trackers = new Map;
    this.downloader.on("start", (e) => {
      trackers.set(e.url, { start: Date.now(), filename: e.filename });
      reporter.wgetStart(e);
    });
    this.downloader.on("headers", (e) => {
      const t = trackers.get(e.url);
      reporter.wgetHeaders(e, t?.filename ?? e.url);
    });
    this.downloader.on("redirect", (e) => reporter.wgetRedirect(e));
    this.downloader.on("retry", (e) => reporter.wgetRetry(e));
    this.downloader.on("progress", (p) => {
      if (flat.progress !== "none") {
        reporter.reportProgress({
          getProgress: () => p
        });
      }
    });
    this.downloader.on("complete", (e) => {
      const t = trackers.get(e.url);
      const duration = t ? (Date.now() - t.start) / 1000 : 0;
      const avgSpeed = duration > 0 ? e.size / duration : 0;
      reporter.wgetComplete(e, avgSpeed);
      trackers.delete(e.url);
    });
    this.downloader.on("error", (e) => {
      reporter.wgetError(e);
      trackers.delete(e.url);
    });
    this.downloader.on("finish", () => {
      process.stdout.write(reporter.formatStats() + `
`);
    });
  }
  mergeOptions(base, override) {
    if (!override)
      return { ...base };
    const result = {};
    const categories = [
      "logging",
      "download",
      "directories",
      "http",
      "recursive",
      "filter",
      "robots",
      "proxy",
      "network",
      "input",
      "misc"
    ];
    for (const cat of categories) {
      const baseVal = base[cat];
      const overrideVal = override[cat];
      if (baseVal || overrideVal) {
        result[cat] = {
          ...baseVal || {},
          ...overrideVal || {}
        };
      }
    }
    return result;
  }
}
export async function wget(url, options) {
  const instance = new Wget(options);
  return instance.get(url);
}
export async function wgetAll(urls, options) {
  const instance = new Wget(options);
  return instance.getAll(urls);
}
export function parseWgetArgs(args) {
  const options = {
    logging: {},
    download: {},
    directories: {},
    http: {},
    recursive: {},
    filter: {},
    robots: {},
    proxy: undefined,
    network: {},
    input: {},
    misc: {}
  };
  const urls = [];
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      urls.push(arg);
      continue;
    }
    if (arg.includes("=")) {
      const [key, value] = arg.split("=");
      setOption(options, key, value);
      continue;
    }
    switch (arg) {
      case "-r":
      case "--recursive":
        options.recursive.enabled = true;
        break;
      case "-l":
      case "--level":
        options.recursive.depth = parseInt(args[++i], 10);
        break;
      case "-p":
      case "--page-requisites":
        options.recursive.pageRequisites = true;
        break;
      case "-k":
      case "--convert-links":
        options.recursive.convertLinks = true;
        break;
      case "-K":
      case "--backup-converted":
        options.recursive.backupConverted = true;
        break;
      case "-m":
      case "--mirror":
        options.recursive.mirror = true;
        break;
      case "-c":
      case "--continue":
        options.download.continue = true;
        break;
      case "-N":
      case "--timestamping":
        options.download.timestamping = true;
        break;
      case "-w":
      case "--wait":
        options.download.wait = parseFloat(args[++i]);
        break;
      case "--random-wait":
        options.download.randomWait = true;
        break;
      case "-T":
      case "--timeout":
        options.download.timeout = parseInt(args[++i], 10);
        break;
      case "-t":
      case "--tries":
        options.download.tries = parseInt(args[++i], 10);
        break;
      case "-O":
      case "--output-document":
        options.download.output = args[++i];
        break;
      case "-P":
      case "--directory-prefix":
        options.download.outputDir = args[++i];
        break;
      case "-nc":
      case "--no-clobber":
        options.download.noClobber = true;
        break;
      case "-E":
      case "--adjust-extension":
        options.download.adjustExtension = true;
        break;
      case "-np":
      case "--no-parent":
        options.filter.noParent = true;
        break;
      case "-H":
      case "--span-hosts":
        options.filter.spanHosts = true;
        break;
      case "-A":
      case "--accept":
        options.filter.accept = args[++i];
        break;
      case "-R":
      case "--reject":
        options.filter.reject = args[++i];
        break;
      case "-D":
      case "--domains":
        options.filter.domains = args[++i];
        break;
      case "-q":
      case "--quiet":
        options.logging.quiet = true;
        break;
      case "-v":
      case "--verbose":
        options.logging.verbose = true;
        break;
      case "-d":
      case "--debug":
        options.logging.debug = true;
        break;
      case "-nv":
      case "--no-verbose":
        options.logging.noVerbose = true;
        break;
      case "-nd":
      case "--no-directories":
        options.directories.noDirectories = true;
        break;
      case "-x":
      case "--force-directories":
        options.directories.forceDirectories = true;
        break;
      case "-nH":
      case "--no-host-directories":
        options.directories.noHostDirectories = true;
        break;
      case "--no-check-certificate":
        options.http.noCheckCertificate = true;
        break;
      case "-U":
      case "--user-agent":
        options.http.userAgent = args[++i];
        break;
      case "-i":
      case "--input-file":
        options.input.file = args[++i];
        break;
      default:
        setOption(options, arg, args[++i]);
    }
  }
  for (const key of Object.keys(options)) {
    if (options[key] && Object.keys(options[key]).length === 0) {
      delete options[key];
    }
  }
  return { options, urls };
}
function setOption(options, key, value) {
  const cleanKey = key.replace(/^--?/, "");
  options.download = options.download || {};
  options.recursive = options.recursive || {};
  options.directories = options.directories || {};
  options.http = options.http || {};
  options.filter = options.filter || {};
  options.input = options.input || {};
  switch (cleanKey) {
    case "limit-rate":
      options.download.limitRate = value;
      break;
    case "wait":
      options.download.wait = parseFloat(value);
      break;
    case "timeout":
      options.download.timeout = parseInt(value, 10);
      break;
    case "tries":
      options.download.tries = parseInt(value, 10);
      break;
    case "quota":
      options.download.quota = value;
      break;
    case "output-document":
      options.download.output = value;
      break;
    case "directory-prefix":
      options.download.outputDir = value;
      break;
    case "level":
      options.recursive.depth = parseInt(value, 10);
      break;
    case "cut-dirs":
      options.directories.cutDirs = parseInt(value, 10);
      break;
    case "user-agent":
      options.http.userAgent = value;
      break;
    case "referer":
      options.http.referer = value;
      break;
    case "http-user":
      options.http.user = value;
      break;
    case "http-password":
      options.http.password = value;
      break;
    case "accept":
      options.filter.accept = value;
      break;
    case "reject":
      options.filter.reject = value;
      break;
    case "domains":
      options.filter.domains = value;
      break;
    case "exclude-domains":
      options.filter.excludeDomains = value.split(",");
      break;
    case "include-directories":
      options.filter.includeDirectories = value.split(",");
      break;
    case "exclude-directories":
      options.filter.excludeDirectories = value.split(",");
      break;
    case "proxy":
      options.proxy = value;
      break;
    case "input-file":
      options.input.file = value;
      break;
    case "base":
      options.input.base = value;
      break;
  }
}
function encodeWgetBody(body) {
  if (body === undefined || body === null)
    return {};
  if (typeof body === "string")
    return { encoded: body, contentType: "text/plain" };
  if (body instanceof Uint8Array) {
    return {
      encoded: Buffer.from(body).toString("binary"),
      contentType: "application/octet-stream"
    };
  }
  if (body instanceof URLSearchParams) {
    return {
      encoded: body.toString(),
      contentType: "application/x-www-form-urlencoded"
    };
  }
  try {
    return { encoded: JSON.stringify(body), contentType: "application/json" };
  } catch {
    return { encoded: String(body) };
  }
}
function deepCloneWgetOptions(options) {
  const sharedJar = options.http?.cookies?.jar;
  const sharedSignal = options.misc?.signal;
  const prepped = {
    ...options,
    http: options.http && {
      ...options.http,
      cookies: options.http.cookies && { ...options.http.cookies, jar: undefined }
    },
    misc: options.misc && { ...options.misc, signal: undefined }
  };
  let cloned;
  try {
    cloned = structuredClone(prepped);
  } catch {
    cloned = JSON.parse(JSON.stringify(prepped));
  }
  if (sharedJar && cloned.http) {
    cloned.http.cookies = { ...cloned.http.cookies, jar: sharedJar };
  }
  if (sharedSignal && cloned.misc) {
    cloned.misc.signal = sharedSignal;
  }
  return cloned;
}
export default Wget;
