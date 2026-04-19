import { normalize, relative, join, resolve as resolvePath } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promises as nodeFs } from "node:fs";
import { RezoQueue } from '../queue/queue.js';
import { RezoHeaders } from '../utils/headers.js';
import { WgetError as WgetErrorClass } from './types.js';
import { AssetExtractor } from './asset-extractor.js';
import { UrlFilter } from './url-filter.js';
import { FileWriter } from './file-writer.js';
import { RobotsHandler } from './robots.js';
import { ResumeHandler } from './resume.js';
import { ProgressReporter, parseSize } from './progress.js';
import { LinkConverter } from './link-converter.js';
import { StyleExtractor } from './style-extractor.js';
import { DownloadCache } from './download-cache.js';
import { SessionCheckpoint } from './session.js';
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

export class Downloader {
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
  session = null;
  seedUrls = [];
  abortController = new AbortController;
  eventHandlers = new Map;
  timeoutMs() {
    const t = this.options.timeout;
    if (t === undefined || t === null)
      return;
    if (t <= 0)
      return 0;
    return Math.round(t * 1000);
  }
  get signal() {
    return this.abortController.signal;
  }
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
    const userSignal = this.options.signal;
    if (userSignal) {
      if (userSignal.aborted) {
        this.abortController.abort(userSignal.reason);
      } else {
        userSignal.addEventListener("abort", () => {
          this.abortController.abort(userSignal.reason);
        }, { once: true });
      }
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
    const normalizedSeeds = [];
    for (const raw of urlArray) {
      const n = this.normalizeUrl(raw);
      if (n)
        normalizedSeeds.push(n);
    }
    this.seedUrls = normalizedSeeds.length > 0 ? normalizedSeeds : urlArray.slice();
    if (this.options.cache !== false) {
      const baseUrl = urlArray[0];
      this.cache = new DownloadCache(this.options.outputDir || ".", baseUrl);
      await this.cache.load();
      const cacheStats = this.cache.stats();
      this.debug(`  Cache loaded: ${cacheStats.entries} entries, ${cacheStats.totalBytes} bytes`);
    }
    if (this.options.resumeSession || this.options.session !== false) {
      this.session = new SessionCheckpoint(this.options.outputDir || ".");
      const locked = await this.session.acquireLock();
      if (!locked) {
        this.debug(`  Session lock held by another process — disabling checkpoint`);
        this.session = null;
      } else if (this.options.resumeSession) {
        const prior = await this.session.load();
        if (prior) {
          this.debug(`  Resuming session: ${prior.visitedUrls.length} visited, ` + `${prior.queuedUrls.length} pending`);
          for (const u of prior.visitedUrls)
            this.visitedUrls.add(u);
          for (const [u, p] of prior.urlMap)
            this.urlMap.set(u, p);
          for (const [p, m] of prior.mimeMap)
            this.mimeMap.set(p, m);
          this.stats = { ...this.stats, ...prior.stats };
        }
      }
    }
    for (const url of this.seedUrls) {
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
    if (this.session) {
      if (!this.aborted && this.stats.urlsFailed === 0) {
        await this.session.clear();
      } else {
        await this.checkpoint(true);
      }
      await this.session.close();
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
    if (!normalizedUrl.startsWith("file://") && this.options.robots !== false && !this.options.noRobots) {
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
    let lastSize = this.visitedUrls.size;
    let lastProgress = Date.now();
    const stallMs = 60000;
    const watchdog = setInterval(() => {
      const now = Date.now();
      if (this.visitedUrls.size !== lastSize) {
        lastSize = this.visitedUrls.size;
        lastProgress = now;
        return;
      }
      if (now - lastProgress > stallMs && !this.aborted) {
        const inflight = Array.from(this.queuedUrls).filter((u) => !this.visitedUrls.has(u));
        const sample = inflight.slice(0, 5).join(", ") || "(none)";
        if (!this.options.quiet) {
          console.warn(`[wget] no activity for ${Math.round((now - lastProgress) / 1000)}s — ` + `${inflight.length} URL(s) in flight: ${sample}${inflight.length > 5 ? ", ..." : ""}`);
        }
        lastProgress = now;
      }
    }, 15000);
    watchdog.unref?.();
    try {
      await this.queue.onIdle();
    } finally {
      clearInterval(watchdog);
    }
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
      this.checkpoint();
    } catch (error) {
      await this.handleError(item, error);
      this.checkpoint();
    }
  }
  async downloadFile(item) {
    const startTime = Date.now();
    if (item.url.startsWith("file://")) {
      return this.loadLocalFile(item, startTime);
    }
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
    const method = (this.options.method ?? "GET").toUpperCase();
    const reqConfig = {
      headers,
      responseType: "buffer",
      timeout: this.timeoutMs(),
      maxRedirects: this.options.maxRedirects,
      rejectUnauthorized: !this.options.noCheckCertificate,
      proxy: this.options.proxy,
      signal: this.signal
    };
    const body = this.options.postData;
    let response;
    const coerce = (v) => v;
    if (method === "GET") {
      response = coerce(await this.http.get(item.url, reqConfig));
    } else if (method === "HEAD") {
      response = coerce(await this.http.head(item.url, reqConfig));
    } else if (method === "DELETE") {
      response = coerce(await this.http.delete(item.url, reqConfig));
    } else if (method === "POST") {
      response = coerce(await this.http.post(item.url, body, reqConfig));
    } else if (method === "PUT") {
      response = coerce(await this.http.put(item.url, body, reqConfig));
    } else if (method === "PATCH") {
      response = coerce(await this.http.patch(item.url, body, reqConfig));
    } else {
      response = coerce(await this.http.request({
        ...reqConfig,
        url: item.url,
        method,
        data: body
      }));
    }
    const finalUrl = response.finalUrl || item.url;
    const contentTypeHeader = response.headers.get("content-type");
    const lenHeader = response.headers.get("content-length");
    const lastModHeader = response.headers.get("last-modified");
    const etagHeader = response.headers.get("etag");
    this.emit("headers", {
      url: item.url,
      statusCode: response.status,
      statusText: response.statusText ?? "",
      headers: this.headersToRecord(response.headers),
      contentLength: lenHeader ? parseInt(lenHeader, 10) : null,
      contentType: contentTypeHeader,
      lastModified: lastModHeader ? new Date(lastModHeader) : null,
      etag: etagHeader
    });
    if (finalUrl !== item.url) {
      this.emit("redirect", {
        fromUrl: item.url,
        toUrl: finalUrl,
        statusCode: response.status,
        redirectCount: 1,
        maxRedirects: this.options.maxRedirects ?? 20
      });
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
          timeout: 1e4,
          signal: this.signal
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
    if (url.startsWith("./") || url.startsWith("../") || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith("/") && !url.startsWith("//")) {
      if (!isSupportedLocalExtension(url))
        return null;
      try {
        return pathToFileURL(resolvePath(url)).href;
      } catch {
        return null;
      }
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "file:") {
        return isSupportedLocalExtension(parsed.pathname) ? parsed.href : null;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }
  async loadLocalFile(item, startTime) {
    const sourcePath = fileURLToPath(item.url);
    const buf = await nodeFs.readFile(sourcePath);
    const mimeType = inferMimeFromPath(sourcePath);
    const writtenPath = await this.fileWriter.write(item.url, buf, mimeType);
    const tracker = this.progressReporter.createTracker(item.url, writtenPath);
    tracker.start(buf.length, mimeType);
    tracker.update(buf.length);
    this.emit("progress", tracker.getProgress());
    if (this.cache) {
      const outputDir = normalize(this.options.outputDir || ".");
      const relativePath = relative(outputDir, writtenPath);
      this.cache.set(item.url, {
        filenames: [relativePath],
        bytesDownloaded: buf.length,
        totalBytes: buf.length,
        percent: 100,
        contentType: mimeType,
        lastDownloaded: Date.now()
      });
    }
    return {
      url: item.url,
      finalUrl: item.url,
      filename: writtenPath,
      size: buf.length,
      mimeType,
      statusCode: 200,
      duration: Date.now() - startTime,
      fromCache: false,
      resumed: false
    };
  }
  headersToRecord(headers) {
    const out = {};
    if (typeof headers.entries === "function") {
      for (const [k, v] of headers.entries()) {
        const existing = out[k];
        if (existing === undefined) {
          out[k] = v;
        } else if (Array.isArray(existing)) {
          existing.push(v);
        } else {
          out[k] = [existing, v];
        }
      }
    }
    return out;
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
      return await nodeFs.readFile(path, "utf-8");
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
    if (this.aborted || this.signal.aborted)
      return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  abort() {
    if (this.aborted)
      return;
    this.aborted = true;
    this.abortController.abort(new Error("wget: download aborted"));
    this.queue.clear();
    if (this.session) {
      this.checkpoint(true);
    }
  }
  async checkpoint(immediate = false) {
    if (!this.session)
      return;
    await this.session.save({
      seedUrls: this.seedUrls,
      visitedUrls: Array.from(this.visitedUrls),
      queuedUrls: Array.from(this.queuedUrls).filter((u) => !this.visitedUrls.has(u)),
      urlMap: Array.from(this.urlMap.entries()),
      mimeMap: Array.from(this.mimeMap.entries()),
      stats: {
        urlsDownloaded: this.stats.urlsDownloaded,
        urlsFailed: this.stats.urlsFailed,
        urlsSkipped: this.stats.urlsSkipped,
        bytesDownloaded: this.stats.bytesDownloaded,
        filesWritten: this.stats.filesWritten,
        startTime: this.stats.startTime,
        endTime: this.stats.endTime,
        duration: this.stats.duration
      }
    }, immediate);
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
function isSupportedLocalExtension(pathOrUrl) {
  const cleanPath = pathOrUrl.split(/[?#]/, 1)[0];
  const dot = cleanPath.lastIndexOf(".");
  if (dot < 0)
    return false;
  const ext = cleanPath.slice(dot).toLowerCase();
  return ext === ".html" || ext === ".htm" || ext === ".xhtml" || ext === ".xml" || ext === ".css";
}
function inferMimeFromPath(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map = {
    ".html": "text/html",
    ".htm": "text/html",
    ".xhtml": "application/xhtml+xml",
    ".xml": "application/xml",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".pdf": "application/pdf",
    ".txt": "text/plain"
  };
  return map[ext] ?? "application/octet-stream";
}
export default Downloader;
