const _mod_8rdpag = require('./types.cjs');
exports.WgetError = _mod_8rdpag.WgetError;;
const _mod_rkhf97 = require('./asset-extractor.cjs');
exports.AssetExtractor = _mod_rkhf97.AssetExtractor;;
const _mod_i85476 = require('./url-filter.cjs');
exports.UrlFilter = _mod_i85476.UrlFilter;;
const _mod_6e0ca6 = require('./file-writer.cjs');
exports.FileWriter = _mod_6e0ca6.FileWriter;;
const _mod_5hf7v1 = require('./robots.cjs');
exports.RobotsHandler = _mod_5hf7v1.RobotsHandler;;
const _mod_w0yc8w = require('./resume.cjs');
exports.ResumeHandler = _mod_w0yc8w.ResumeHandler;;
const _mod_3iur5r = require('./progress.cjs');
exports.ProgressReporter = _mod_3iur5r.ProgressReporter;
exports.ProgressTracker = _mod_3iur5r.ProgressTracker;
exports.parseSize = _mod_3iur5r.parseSize;;
const _mod_fbbq8h = require('./link-converter.cjs');
exports.LinkConverter = _mod_fbbq8h.LinkConverter;;
const _mod_j5iv43 = require('./style-extractor.cjs');
exports.StyleExtractor = _mod_j5iv43.StyleExtractor;;
const _mod_vam23z = require('./downloader.cjs');
exports.Downloader = _mod_vam23z.Downloader;;
const _mod_xdzxni = require('./asset-organizer.cjs');
exports.AssetOrganizer = _mod_xdzxni.AssetOrganizer;
exports.DEFAULT_ASSET_FOLDERS = _mod_xdzxni.DEFAULT_ASSET_FOLDERS;;
const _mod_3wja47 = require('./download-cache.cjs');
exports.DownloadCache = _mod_3wja47.DownloadCache;;
const _mod_lgqidx = require('./filter-lists.cjs');
exports.EXECUTABLE_EXTENSIONS = _mod_lgqidx.EXECUTABLE_EXTENSIONS;
exports.ARCHIVE_EXTENSIONS = _mod_lgqidx.ARCHIVE_EXTENSIONS;
exports.DOCUMENT_EXTENSIONS = _mod_lgqidx.DOCUMENT_EXTENSIONS;
exports.IMAGE_EXTENSIONS = _mod_lgqidx.IMAGE_EXTENSIONS;
exports.VIDEO_EXTENSIONS = _mod_lgqidx.VIDEO_EXTENSIONS;
exports.AUDIO_EXTENSIONS = _mod_lgqidx.AUDIO_EXTENSIONS;
exports.FONT_EXTENSIONS = _mod_lgqidx.FONT_EXTENSIONS;
exports.WEB_ASSET_EXTENSIONS = _mod_lgqidx.WEB_ASSET_EXTENSIONS;
exports.DATA_EXTENSIONS = _mod_lgqidx.DATA_EXTENSIONS;
exports.EXECUTABLE_MIME_TYPES = _mod_lgqidx.EXECUTABLE_MIME_TYPES;
exports.ARCHIVE_MIME_TYPES = _mod_lgqidx.ARCHIVE_MIME_TYPES;
exports.DOCUMENT_MIME_TYPES = _mod_lgqidx.DOCUMENT_MIME_TYPES;
exports.IMAGE_MIME_TYPES = _mod_lgqidx.IMAGE_MIME_TYPES;
exports.VIDEO_MIME_TYPES = _mod_lgqidx.VIDEO_MIME_TYPES;
exports.AUDIO_MIME_TYPES = _mod_lgqidx.AUDIO_MIME_TYPES;
exports.FONT_MIME_TYPES = _mod_lgqidx.FONT_MIME_TYPES;
exports.WEB_ASSET_MIME_TYPES = _mod_lgqidx.WEB_ASSET_MIME_TYPES;
exports.DATA_MIME_TYPES = _mod_lgqidx.DATA_MIME_TYPES;
exports.SAFE_WEB_PRESET = _mod_lgqidx.SAFE_WEB_PRESET;
exports.DOCUMENTS_ONLY_PRESET = _mod_lgqidx.DOCUMENTS_ONLY_PRESET;
exports.NO_MEDIA_PRESET = _mod_lgqidx.NO_MEDIA_PRESET;
exports.MINIMAL_MIRROR_PRESET = _mod_lgqidx.MINIMAL_MIRROR_PRESET;
exports.TEXT_ONLY_PRESET = _mod_lgqidx.TEXT_ONLY_PRESET;;
const { Downloader } = require('./downloader.cjs');
const rezo = require('../index.cjs');
const { promises: fs } = require("node:fs");
const { flattenWgetOptions } = require('./types.cjs');
const { parseProxyString } = require('../proxy/parse.cjs');

class Wget {
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
async function wget(url, options) {
  const instance = new Wget(options);
  return instance.get(url);
}
async function wgetAll(urls, options) {
  const instance = new Wget(options);
  return instance.getAll(urls);
}
function parseWgetArgs(args) {
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
  options.proxy = options.proxy;
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

exports.Wget = Wget;
exports.wget = wget;
exports.wgetAll = wgetAll;
exports.parseWgetArgs = parseWgetArgs;
exports.default = Wget;
module.exports = Object.assign(Wget, exports);