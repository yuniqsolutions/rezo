const { normalize, relative, join } = require("node:path");
const { RezoQueue } = require('../queue/queue.cjs');
const { RezoHeaders } = require('../utils/headers.cjs');
const { WgetError: WgetErrorClass } = require('./types.cjs');
const { AssetExtractor } = require('./asset-extractor.cjs');
const { UrlFilter } = require('./url-filter.cjs');
const { FileWriter } = require('./file-writer.cjs');
const { RobotsHandler } = require('./robots.cjs');
const { ResumeHandler } = require('./resume.cjs');
const { ProgressReporter, parseSize } = require('./progress.cjs');
const { LinkConverter } = require('./link-converter.cjs');
const { StyleExtractor } = require('./style-extractor.cjs');
const { DownloadCache } = require('./download-cache.cjs');
const DEFAULT_OPTIONS = {
  outputDir: ".",
  depth: 5,
  timeout: 30,
  tries: 3,
  waitRetry: 10,
  wait: 0,
  concurrency: 1,
  robots: true,
  userAgent: "Rezo-Wget/1.0",
  maxRedirects: 20,
  retryConnrefused: true
};

class Downloader {
  options;
  http;
  queue;
  assetExtractor;
  urlFilter;
  fileWriter;
  robots;
  resumeHandler;
  progressReporter;
  linkConverter;
  visitedUrls = new Set;
  queuedUrls = new Set;
  urlMap = new Map;
  mimeMap = new Map;
  stats;
  aborted = false;
  quotaBytes = 1 / 0;
  totalDownloaded = 0;
  cache = null;
  eventHandlers = new Map;
  constructor(options = {}, http) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.http = http;
    this.queue = new RezoQueue({
      concurrency: 1 / 0
    });
    this.assetExtractor = new AssetExtractor;
    this.urlFilter = new UrlFilter(this.options);
    this.fileWriter = new FileWriter(this.options);
    this.robots = new RobotsHandler(this.options);
    this.resumeHandler = new ResumeHandler(this.options);
    this.progressReporter = new ProgressReporter(this.options);
    this.linkConverter = new LinkConverter(this.options);
    this.stats = {
      urlsDownloaded: 0,
      urlsFailed: 0,
      urlsSkipped: 0,
      bytesDownloaded: 0,
      filesWritten: 0,
      startTime: Date.now()
    };
    if (this.options.quota) {
      this.quotaBytes = parseSize(this.options.quota);
    }
  }
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set);
    }
    this.eventHandlers.get(event).add(handler);
    return this;
  }
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
    return this;
  }
  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of Array.from(handlers)) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }
  debug(message) {
    if (this.options.debug && !this.options.quiet) {
      console.log(`[DEBUG] ${message}`);
    }
  }
  async download(urls) {
    const urlArray = Array.isArray(urls) ? urls : [urls];
    this.debug(`Starting wget download`);
    this.debug(`  URLs: ${urlArray.length}`);
    this.debug(`  Concurrency: ${this.options.concurrency} (handled by Rezo HTTP queue)`);
    this.debug(`  Recursive: ${this.options.recursive}`);
    this.debug(`  Depth: ${this.options.depth}`);
    this.debug(`  Page requisites: ${this.options.pageRequisites}`);
    this.debug(`  Convert links: ${this.options.convertLinks}`);
    this.debug(`  Output dir: ${this.options.outputDir}`);
    this.debug(`  Organize assets: ${this.options.organizeAssets}`);
    this.debug(`  Cache enabled: ${this.options.cache !== false}`);
    if (this.options.proxy) {
      const proxy = this.options.proxy;
      if (typeof proxy === "string") {
        this.debug(`  Proxy: ${proxy}`);
      } else {
        this.debug(`  Proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
      }
    }
    if (this.options.cache !== false) {
      const baseUrl = urlArray[0];
      this.cache = new DownloadCache(this.options.outputDir || ".", baseUrl);
      await this.cache.load();
      const cacheStats = this.cache.stats();
      this.debug(`  Cache loaded: ${cacheStats.entries} entries, ${cacheStats.totalBytes} bytes`);
    }
    for (const url of urlArray) {
      this.urlFilter.addStartUrl(url);
    }
    if (this.options.mirror) {
      this.debug(`Mirror mode enabled - setting recursive=true, depth=Infinity, timestamping=true`);
      this.options.recursive = true;
      this.options.depth = 1 / 0;
      this.options.timestamping = true;
    }
    for (const url of urlArray) {
      this.fileWriter.markAsEntry(url);
      await this.addToQueue(url, 0, null, "document");
    }
    await this.processQueue();
    if ((this.options.extractInternalStyles || this.options.removeJavascript) && this.urlMap.size > 0) {
      this.debug(`Post-processing HTML files`);
      await this.postProcessHtml();
    }
    if (this.options.convertLinks && this.urlMap.size > 0) {
      this.debug(`Converting links in ${this.urlMap.size} downloaded files`);
      await this.convertLinks();
    }
    this.stats.endTime = Date.now();
    this.stats.duration = this.stats.endTime - this.stats.startTime;
    this.stats.urlMap = this.urlMap;
    this.debug(`Download complete in ${this.stats.duration}ms`);
    this.debug(`  Downloaded: ${this.stats.urlsDownloaded}`);
    this.debug(`  Failed: ${this.stats.urlsFailed}`);
    this.debug(`  Skipped: ${this.stats.urlsSkipped}`);
    this.debug(`  Bytes: ${this.stats.bytesDownloaded}`);
    if (this.cache) {
      await this.cache.save();
      this.debug(`  Cache saved: ${this.cache.filePath}`);
    }
    this.emit("finish", {
      stats: this.stats,
      success: this.stats.urlsFailed === 0
    });
    return this.stats;
  }
  async addToQueue(url, depth, parentUrl, assetType) {
    const normalizedUrl = this.normalizeUrl(url);
    if (!normalizedUrl) {
      this.emitSkip(url, "invalid-url", "Invalid URL", depth, parentUrl);
      return;
    }
    if (this.visitedUrls.has(normalizedUrl)) {
      this.emitSkip(normalizedUrl, "already-downloaded", "Already downloaded", depth, parentUrl);
      return;
    }
    if (this.queuedUrls.has(normalizedUrl)) {
      this.emitSkip(normalizedUrl, "already-queued", "Already in queue", depth, parentUrl);
      return;
    }
    if (this.totalDownloaded >= this.quotaBytes) {
      this.emitSkip(normalizedUrl, "quota-exceeded", "Download quota exceeded", depth, parentUrl);
      return;
    }
    const filterResult = this.urlFilter.shouldDownload(normalizedUrl, parentUrl || normalizedUrl, depth);
    if (!filterResult.allowed) {
      this.emitSkip(normalizedUrl, filterResult.reason, filterResult.message, depth, parentUrl);
      this.stats.urlsSkipped++;
      return;
    }
    if (this.options.robots !== false && !this.options.noRobots) {
      await this.fetchRobots(normalizedUrl);
      if (!this.robots.isAllowed(normalizedUrl)) {
        this.emitSkip(normalizedUrl, "robots-disallowed", "Blocked by robots.txt", depth, parentUrl);
        this.stats.urlsSkipped++;
        return;
      }
    }
    this.queuedUrls.add(normalizedUrl);
    const item = {
      url: normalizedUrl,
      depth,
      parentUrl,
      priority: depth,
      assetType,
      retryCount: 0,
      proxyRetryCount: 0
    };
    this.debug(`Queue add: ${normalizedUrl} (depth=${depth}, type=${assetType}, queue size=${this.queuedUrls.size})`);
    this.queue.add(() => this.processItem(item), { priority: depth });
  }
  async processQueue() {
    this.debug(`Processing queue with ${this.queuedUrls.size} URLs`);
    await this.queue.onIdle();
    this.debug(`Queue processing complete`);
  }
  async processItem(item) {
    if (this.aborted)
      return;
    await this.applyRateLimit();
    this.debug(`Downloading: ${item.url}`);
    this.emit("start", {
      url: item.url,
      filename: this.fileWriter.getOutputPath(item.url),
      depth: item.depth,
      parentUrl: item.parentUrl,
      assetType: item.assetType,
      timestamp: Date.now()
    });
    try {
      const result = await this.downloadFile(item);
      this.visitedUrls.add(item.url);
      const outputDir = normalize(this.options.outputDir || ".");
      const normalizedFilename = normalize(result.filename);
      const relativePath = relative(outputDir, normalizedFilename);
      this.urlMap.set(item.url, relativePath);
      this.mimeMap.set(relativePath, result.mimeType);
      if (result.finalUrl && result.finalUrl !== item.url) {
        this.urlMap.set(result.finalUrl, relativePath);
      }
      this.debug(`Downloaded: ${item.url} -> ${relativePath} (${result.size} bytes, ${result.duration}ms)`);
      this.stats.urlsDownloaded++;
      this.stats.bytesDownloaded += result.size;
      this.stats.filesWritten++;
      this.totalDownloaded += result.size;
      this.emit("complete", {
        url: item.url,
        finalUrl: result.finalUrl,
        filename: result.filename,
        size: result.size,
        mimeType: result.mimeType,
        statusCode: result.statusCode,
        duration: result.duration,
        fromCache: result.fromCache,
        resumed: result.resumed,
        depth: item.depth
      });
      if (this.shouldExtractAssets(item, result)) {
        this.debug(`Extracting assets from ${item.url}`);
        await this.extractAndQueueAssets(item, result);
      }
    } catch (error) {
      await this.handleError(item, error);
    }
  }
  async downloadFile(item) {
    const startTime = Date.now();
    const outputPath = this.fileWriter.getOutputPath(item.url);
    let resumed = false;
    if (this.cache && item.assetType !== "document") {
      const cacheCheck = await this.cache.check(item.url);
      if (cacheCheck.cached && cacheCheck.entry && cacheCheck.filename) {
        const outputDir = normalize(this.options.outputDir || ".");
        const fullPath = join(outputDir, cacheCheck.filename);
        this.debug(`Cache hit: ${item.url} -> ${fullPath}`);
        const tracker = this.progressReporter.createTracker(item.url, fullPath);
        tracker.start(cacheCheck.entry.totalBytes, cacheCheck.entry.contentType);
        tracker.update(cacheCheck.entry.totalBytes);
        this.emit("progress", tracker.getProgress());
        return {
          url: item.url,
          finalUrl: item.url,
          filename: fullPath,
          size: cacheCheck.entry.totalBytes,
          mimeType: cacheCheck.entry.contentType,
          statusCode: 200,
          duration: Date.now() - startTime,
          fromCache: true,
          resumed: false
        };
      }
    }
    const resumeInfo = await this.resumeHandler.getResumeInfo(outputPath);
    const resumeHeaders = this.resumeHandler.getResumeHeaders(resumeInfo);
    const timestampHeaders = await this.resumeHandler.getTimestampHeaders(outputPath);
    const headers = new RezoHeaders({
      ...resumeHeaders,
      ...timestampHeaders
    });
    if (item.parentUrl) {
      headers.set("Referer", item.parentUrl);
    }
    const response = await this.http.get(item.url, {
      headers,
      responseType: "buffer",
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
      rejectUnauthorized: !this.options.noCheckCertificate,
      proxy: this.options.proxy
    });
    const finalUrl = response.finalUrl || item.url;
    if (finalUrl !== item.url) {
      this.visitedUrls.add(this.normalizeUrl(finalUrl) || finalUrl);
    }
    if (response.status === 304) {
      return {
        url: item.url,
        finalUrl,
        filename: outputPath,
        size: resumeInfo.bytesDownloaded,
        mimeType: response.headers.get("content-type") || "application/octet-stream",
        statusCode: 304,
        duration: Date.now() - startTime,
        fromCache: true,
        resumed: false
      };
    }
    const contentType = response.headers.get("content-type");
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
    const contentFilterResult = this.checkContentTypeFilter(contentType, contentLength);
    if (!contentFilterResult.allowed) {
      throw new WgetErrorClass(contentFilterResult.message || "Content filtered", "CONTENT_FILTERED", item.url, response.status);
    }
    if (response.status === 206 && resumeInfo.canResume) {
      resumed = true;
    }
    const content = response.data;
    const mimeType = this.getMimeType(response);
    const writtenPath = await this.fileWriter.write(item.url, content, mimeType);
    const tracker = this.progressReporter.createTracker(item.url, writtenPath);
    tracker.start(content.length, mimeType);
    tracker.update(content.length);
    this.emit("progress", tracker.getProgress());
    const lastModified = response.headers.get("last-modified");
    if (lastModified) {
      const mtime = this.resumeHandler.parseLastModified(lastModified);
      if (mtime) {
        await this.fileWriter.setMtime(writtenPath, mtime);
      }
    }
    if (this.options.deleteAfter) {
      await this.fileWriter.deleteFile(writtenPath);
    }
    if (this.cache) {
      const outputDir = normalize(this.options.outputDir || ".");
      const relativePath = relative(outputDir, writtenPath);
      this.cache.set(item.url, {
        filenames: [relativePath],
        bytesDownloaded: content.length,
        totalBytes: content.length,
        percent: 100,
        contentType: mimeType,
        lastDownloaded: Date.now(),
        etag: response.headers.get("etag") || undefined,
        lastModified: response.headers.get("last-modified") || undefined
      });
    }
    return {
      url: item.url,
      finalUrl,
      filename: writtenPath,
      size: content.length,
      mimeType,
      statusCode: response.status,
      duration: Date.now() - startTime,
      fromCache: false,
      resumed
    };
  }
  shouldExtractAssets(item, result) {
    if (!this.options.recursive && !this.options.pageRequisites) {
      return false;
    }
    const maxDepth = this.options.depth ?? this.options.maxDepth ?? 5;
    if (maxDepth !== 0 && maxDepth !== 1 / 0 && item.depth >= maxDepth) {
      return false;
    }
    const extractableTypes = ["text/html", "text/css", "text/xml", "application/xml", "image/svg+xml"];
    const baseMime = result.mimeType.split(";")[0].trim().toLowerCase();
    return extractableTypes.some((type) => baseMime.includes(type.split("/")[1]));
  }
  async extractAndQueueAssets(item, result) {
    const content = await this.readFile(result.filename);
    if (!content)
      return;
    const assets = this.assetExtractor.extract(content, result.mimeType, result.finalUrl, {
      strictComments: this.options.strictComments,
      followTags: this.options.followTags,
      ignoreTags: this.options.ignoreTags
    });
    const filteredAssets = this.assetExtractor.filterAssets(assets, this.options);
    this.debug(`  Found ${assets.length} assets, ${filteredAssets.length} will be queued`);
    const skippedAssets = [];
    for (const asset of assets) {
      if (!filteredAssets.includes(asset)) {
        skippedAssets.push({ asset, reason: "pattern-rejected" });
      }
    }
    this.emit("assets", {
      url: item.url,
      filename: result.filename,
      contentType: result.mimeType,
      assets,
      filteredAssets,
      skippedAssets
    });
    const nextDepth = item.depth + 1;
    for (const asset of filteredAssets) {
      const assetDepth = asset.required && this.options.pageRequisites ? item.depth : nextDepth;
      await this.addToQueue(asset.url, assetDepth, item.url, asset.type);
    }
  }
  async handleError(item, error) {
    const wgetError = this.toWgetError(error, item.url);
    const isProxyError = wgetError.isProxyError();
    this.debug(`Error downloading ${item.url}: ${wgetError.code} - ${wgetError.message}`);
    if (isProxyError) {
      this.debug(`  Proxy error detected (proxy retry ${item.proxyRetryCount})`);
    }
    const maxTries = this.options.tries || 3;
    const maxProxyRetries = this.options.maxProxyRetries ?? 3;
    const retryProxyErrors = this.options.retryProxyErrors ?? true;
    let shouldRetry = false;
    let isProxyRetry = false;
    if (isProxyError && retryProxyErrors && item.proxyRetryCount < maxProxyRetries) {
      shouldRetry = true;
      isProxyRetry = true;
    } else if (!isProxyError && item.retryCount < maxTries - 1 && wgetError.isRetryable()) {
      shouldRetry = true;
    }
    this.emit("error", {
      url: item.url,
      error: wgetError,
      statusCode: wgetError.statusCode || null,
      retryCount: isProxyRetry ? item.proxyRetryCount : item.retryCount,
      willRetry: shouldRetry,
      depth: item.depth,
      parentUrl: item.parentUrl
    });
    if (shouldRetry) {
      const baseDelay = 1000;
      const maxDelay = (this.options.waitRetry || 10) * 1000;
      const retryCount = isProxyRetry ? item.proxyRetryCount : item.retryCount;
      const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
      this.debug(`  Will retry in ${delay}ms (attempt ${retryCount + 2}/${isProxyRetry ? maxProxyRetries : maxTries})`);
      this.emit("retry", {
        url: item.url,
        error: wgetError,
        attempt: retryCount + 2,
        maxAttempts: isProxyRetry ? maxProxyRetries : maxTries,
        delayMs: delay
      });
      await this.sleep(delay);
      const retryItem = isProxyRetry ? { ...item, proxyRetryCount: item.proxyRetryCount + 1 } : { ...item, retryCount: item.retryCount + 1 };
      this.queue.add(() => this.processItem(retryItem), { priority: item.priority });
    } else {
      this.debug(`  Not retrying - marking as failed`);
      this.visitedUrls.add(item.url);
      this.stats.urlsFailed++;
    }
  }
  async fetchRobots(url) {
    if (this.robots.hasFetched(url))
      return;
    await this.robots.fetch(url, async (robotsUrl) => {
      try {
        const response = await this.http.get(robotsUrl, {
          timeout: 1e4
        });
        return response.data;
      } catch {
        return null;
      }
    });
    const domain = new URL(url).hostname;
    const parsed = this.robots.getParsed(domain);
    this.emit("robots", {
      domain,
      url: this.robots.getRobotsUrl(url),
      found: !!parsed,
      rulesCount: this.robots.getRulesCount(domain),
      crawlDelay: this.robots.getCrawlDelay(domain)
    });
  }
  async postProcessHtml() {
    const processor = new StyleExtractor(this.options);
    const outputDir = this.options.outputDir || ".";
    const htmlMimes = ["text/html", "application/xhtml+xml"];
    const htmlFiles = Array.from(this.urlMap.entries()).filter(([_, path]) => {
      const mime = this.mimeMap.get(path);
      if (mime) {
        const baseMime = mime.split(";")[0].trim().toLowerCase();
        return htmlMimes.includes(baseMime);
      }
      return false;
    });
    let totalStylesExtracted = 0;
    let totalScriptsRemoved = 0;
    for (const [url, relativePath] of htmlFiles) {
      const fullPath = join(outputDir, relativePath);
      const result = await processor.processFile(fullPath, outputDir, relativePath);
      if (result.stylesExtracted > 0) {
        this.debug(`  Extracted ${result.stylesExtracted} styles from ${relativePath}`);
        totalStylesExtracted += result.stylesExtracted;
      }
      if (result.scriptsRemoved > 0) {
        this.debug(`  Removed ${result.scriptsRemoved} scripts from ${relativePath}`);
        totalScriptsRemoved += result.scriptsRemoved;
      }
      let styleIdx = 0;
      for (const [_, cssPath] of result.extractedFiles) {
        this.urlMap.set(`${url}#__extracted_style_${styleIdx++}`, cssPath);
      }
    }
    if (totalStylesExtracted > 0)
      this.debug(`  Total styles extracted: ${totalStylesExtracted}`);
    if (totalScriptsRemoved > 0)
      this.debug(`  Total scripts removed: ${totalScriptsRemoved}`);
  }
  async convertLinks() {
    this.linkConverter.setEventHandler((event) => {
      this.emit("convert", event);
    });
    await this.linkConverter.convertLinks(this.options.outputDir || ".", this.urlMap, this.mimeMap);
  }
  async applyRateLimit() {
    if (!this.options.wait || this.options.wait <= 0)
      return;
    let waitTime = this.options.wait * 1000;
    if (this.options.randomWait) {
      const factor = 0.5 + Math.random();
      waitTime *= factor;
    }
    await this.sleep(waitTime);
  }
  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }
  getMimeType(response) {
    const contentType = response.headers.get("content-type");
    if (contentType) {
      return contentType.split(";")[0].trim();
    }
    return "application/octet-stream";
  }
  async readFile(path) {
    try {
      const { promises: fs } = await import("node:fs");
      return await fs.readFile(path, "utf-8");
    } catch {
      return null;
    }
  }
  checkContentTypeFilter(contentType, contentLength) {
    if (this.options.excludeMimeTypes && this.options.excludeMimeTypes.length > 0 && contentType) {
      const normalizedMime = contentType.split(";")[0].trim().toLowerCase();
      for (const excludeMime of this.options.excludeMimeTypes) {
        if (normalizedMime === excludeMime.toLowerCase()) {
          return {
            allowed: false,
            reason: "pattern-rejected",
            message: `MIME type ${normalizedMime} is excluded`
          };
        }
      }
    }
    if (contentLength !== null && contentLength > 0) {
      if (this.options.maxFileSize && contentLength > this.options.maxFileSize) {
        return {
          allowed: false,
          reason: "quota-exceeded",
          message: `File size ${contentLength} bytes exceeds max ${this.options.maxFileSize} bytes`
        };
      }
      if (this.options.minFileSize && contentLength < this.options.minFileSize) {
        return {
          allowed: false,
          reason: "pattern-rejected",
          message: `File size ${contentLength} bytes below min ${this.options.minFileSize} bytes`
        };
      }
    }
    return { allowed: true };
  }
  toWgetError(error, url) {
    if (error instanceof WgetErrorClass) {
      return error;
    }
    if (error instanceof Error) {
      return WgetErrorClass.fromNetworkError(url, error);
    }
    return new WgetErrorClass(String(error), "UNKNOWN_ERROR", url);
  }
  emitSkip(url, reason, message, depth, parentUrl) {
    this.emit("skip", {
      url,
      reason,
      message,
      depth,
      parentUrl
    });
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  abort() {
    this.aborted = true;
    this.queue.clear();
  }
  getStats() {
    return { ...this.stats };
  }
  getUrlMap() {
    return new Map(this.urlMap);
  }
  async destroy() {
    this.aborted = true;
    this.queue.clear();
    this.visitedUrls.clear();
    this.queuedUrls.clear();
    this.urlMap.clear();
    this.eventHandlers.clear();
    if (this.cache) {
      await this.cache.destroy();
      this.cache = null;
    }
  }
}

exports.Downloader = Downloader;
exports.default = Downloader;
module.exports = Object.assign(Downloader, exports);