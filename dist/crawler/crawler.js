import fs from "node:fs";
import { FileCacher } from './plugin/file-cacher.js';
import { UrlStore } from './plugin/url-store.js';
import { NavigationHistory } from './plugin/navigation-history.js';
import { RobotsTxt } from './plugin/robots-txt.js';
import { MemoryMonitor } from './plugin/memory-monitor.js';
import { HealthMetrics } from './plugin/health-metrics.js';
import { CappedMap } from './plugin/capped-map.js';
import { CappedArray } from './plugin/capped-array.js';
import { parseHTML } from '../dom/index.js';
import path from "node:path";
import rezo, { Rezo } from '../index.js';
import { RezoQueue } from '../queue/queue.js';
import { Scraper } from './scraper.js';
import { CrawlerOptions } from './crawler-options.js';
import { loadAdapter } from '../adapters/picker.js';
import { resetGlobalAgentPool } from '../utils/agent-pool.js';
String.prototype.addBaseUrl = function(url) {
  url = url instanceof URL ? url.href : url;
  const html = this.replace(/<base\b[^>]*?>/gi, "");
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}
<base href="${url}">`);
  }
  const baseTag = `<head>
<base href="${url}">
</head>
`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, baseTag + "$&");
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, `$&
` + baseTag);
  }
  return this;
};

export class Crawler {
  http;
  events = [];
  jsonEvents = [];
  errorEvents = [];
  responseEvents = [];
  rawResponseEvents = [];
  emailDiscoveredEvents = [];
  emailLeadsEvents = [];
  eventCount = 0;
  cacher = null;
  queue;
  scraperQueue;
  isCacheEnabled;
  config;
  urlStorage;
  isStorageReady = false;
  isCacheReady = false;
  leadsFinder;
  navigationHistory = null;
  isNavigationHistoryReady = false;
  isSessionReady = false;
  currentSession = null;
  navigationHistoryInitPromise = null;
  adapterExecutor = null;
  adaptedHttpClients = new WeakMap;
  adapterInitPromise = null;
  adapterType;
  isDestroyed = false;
  shutdownRequested = false;
  robotsTxt;
  domainResponseTimes = new CappedMap({ maxSize: 500 });
  domainCurrentDelay = new CappedMap({ maxSize: 500 });
  crawlStats = {
    urlsVisited: 0,
    urlsQueued: 0,
    urlsFailed: 0,
    startTime: 0,
    currentDepth: 0
  };
  urlDepthMap = new CappedMap({ maxSize: 50000 });
  cleanupInterval;
  checkpointInterval;
  lastCheckpointTime = 0;
  memoryMonitor;
  healthMetrics;
  originalConcurrency = 100;
  shutdownHandler = null;
  rateLimitedDomains = new CappedMap({ maxSize: 1e4 });
  startHandlers = [];
  finishHandlers = [];
  redirectHandlers = [];
  queueChangeHandlers = [];
  collectedData = new CappedArray({
    maxSize: 1e5,
    evictionRatio: 0.1,
    onEviction: (evicted, remaining) => {
      console.warn(`[Crawler] collectedData auto-evicted ${evicted.length} oldest entries. ${remaining} entries remaining. Consider using exportData() more frequently.`);
    }
  });
  hasScheduledWork = false;
  hasStartedLifecycle = false;
  startHandlersPromise = null;
  constructor(crawlerOptions, http = rezo.create()) {
    this.http = http;
    this.config = new CrawlerOptions(crawlerOptions);
    this.adapterType = this.config.adapter;
    if (this.config.stealth) {
      this.http = rezo.create({
        stealth: this.config.stealth
      });
    }
    const concurrency = this.config.concurrency;
    this.queue = new RezoQueue({
      name: "crawler",
      concurrency
    });
    this.originalConcurrency = concurrency;
    this.scraperQueue = new RezoQueue({
      name: "scraper",
      concurrency: this.config.scraperConcurrency
    });
    this._subscribeToQueueEvents(this.queue, "crawler");
    this._subscribeToQueueEvents(this.scraperQueue, "scraper");
    this.config.onLimiterAdded = (queue) => {
      if (!this.subscribedManagedQueues.has(queue)) {
        this._subscribeToQueueEvents(queue, "limiter");
        this.subscribedManagedQueues.add(queue);
      }
    };
    this.config.onProviderAdded = (queue) => {
      if (!this.subscribedManagedQueues.has(queue)) {
        this._subscribeToQueueEvents(queue, "provider");
        this.subscribedManagedQueues.add(queue);
      }
    };
    this.memoryMonitor = new MemoryMonitor({ warningRatio: 0.7, criticalRatio: 0.85 });
    this.healthMetrics = new HealthMetrics({ windowSize: 60000 });
    const enableCache = this.config.enableCache;
    this.isCacheEnabled = enableCache;
    if (enableCache) {
      const cacheDir = this.config.cacheDir;
      const cacheTTL = this.config.cacheTTL;
      const dbUrl = cacheDir && (cacheDir.startsWith("./") || cacheDir.startsWith("/")) ? `${cacheDir}${cacheDir.endsWith("/") ? "" : "/"}` : cacheDir ? `./${cacheDir}${cacheDir.endsWith("/") ? "" : "/"}` : `./cache/`;
      if (!fs.existsSync(path.dirname(dbUrl)))
        fs.mkdirSync(path.dirname(dbUrl), { recursive: true });
      FileCacher.create({
        cacheDir: dbUrl,
        ttl: cacheTTL,
        maxEntries: 1e5
      }).then((storage) => {
        this.cacher = storage;
        this.isCacheReady = true;
      }).catch((err) => {
        if (this.config.debug)
          console.warn("[Crawler] Failed to initialize cache:", err);
        this.isCacheReady = true;
      });
      const dit = path.resolve(cacheDir, "urls");
      if (!fs.existsSync(dit))
        fs.mkdirSync(dit, { recursive: true });
      UrlStore.create({
        storeDir: dit,
        dbFileName: ".url_cache.db",
        ttl: 1000 * 60 * 60 * 24 * 7
      }).then((storage) => {
        this.urlStorage = storage;
        this.isStorageReady = true;
      }).catch((err) => {
        if (this.config.debug)
          console.warn("[Crawler] Failed to initialize URL storage:", err);
        this.isStorageReady = true;
      });
    } else {
      const dit = path.resolve(this.config.cacheDir, "./cache/urls");
      if (!fs.existsSync(dit))
        fs.mkdirSync(dit, { recursive: true });
      UrlStore.create({
        storeDir: dit,
        dbFileName: ".url_cache.db",
        ttl: 1000 * 60 * 60 * 24 * 7
      }).then((storage) => {
        this.urlStorage = storage;
        this.isStorageReady = true;
      }).catch((err) => {
        if (this.config.debug)
          console.warn("[Crawler] Failed to initialize URL storage:", err);
        this.isStorageReady = true;
      });
    }
    if (this.config.enableNavigationHistory) {
      const navHistoryDir = path.resolve(this.config.cacheDir, "navigation");
      if (!fs.existsSync(navHistoryDir))
        fs.mkdirSync(navHistoryDir, { recursive: true });
      this.navigationHistoryInitPromise = this.initializeNavigationHistory(navHistoryDir);
    }
    this.adapterInitPromise = this.initializeAdapter();
    this.leadsFinder = new Scraper(this.http, this.config, this._onEmailLeads.bind(this), this._onEmailDiscovered.bind(this), this.config.debug);
    this.robotsTxt = new RobotsTxt({
      userAgent: this.config.userAgent || "RezoBot",
      cacheTTL: 24 * 60 * 60 * 1000
    });
    this.crawlStats.startTime = Date.now();
    if (this.config.baseUrl) {
      this.urlDepthMap.set(this.config.baseUrl, 0);
    }
    if (this.config.enableSignalHandlers) {
      this.registerShutdownHandlers();
    }
  }
  registerShutdownHandlers() {
    if (this.shutdownHandler)
      return;
    this.shutdownHandler = () => this.gracefulShutdown();
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);
  }
  removeShutdownHandlers() {
    if (this.shutdownHandler) {
      process.off("SIGINT", this.shutdownHandler);
      process.off("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = null;
    }
  }
  async gracefulShutdown() {
    if (this.shutdownRequested || this.isDestroyed)
      return;
    this.shutdownRequested = true;
    console.log(`
[Crawler] Shutdown requested, finishing current tasks...`);
    this.queue.pause();
    this.scraperQueue.pause();
    for (const queue of this.getProviderQueues()) {
      queue.pause();
    }
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.log("[Crawler] Shutdown timeout (5s), forcing exit...");
        resolve();
      }, 5000);
    });
    await Promise.race([
      this.waitForActiveQueuesIdle(),
      timeoutPromise
    ]);
    if (this.navigationHistory && this.currentSession) {
      try {
        await this.persistNavigationSession("paused");
        console.log(`[Crawler] Session saved: ${this.currentSession.sessionId}`);
      } catch (err) {
        console.warn("[Crawler] Failed to save session state:", err);
      }
    }
    await this.destroy();
    console.log("[Crawler] Graceful shutdown complete");
    process.exit(0);
  }
  async initializeAdapter() {
    this.adaptedHttpClients = new WeakMap;
    if (this.adapterType === "http") {
      this.adapterExecutor = null;
      return;
    }
    try {
      const adapterModule = await loadAdapter(this.adapterType);
      this.adapterExecutor = adapterModule.executeRequest.bind(adapterModule);
    } catch (error) {
      this.adapterExecutor = null;
      if (this.config.debug) {
        console.warn(`[Crawler] Failed to load adapter '${this.adapterType}', falling back to http instance`);
      }
    }
  }
  async waitForAdapter() {
    if (this.adapterInitPromise) {
      await this.adapterInitPromise;
    }
  }
  getRequestClient(baseClient) {
    if (!this.adapterExecutor) {
      return baseClient;
    }
    const cachedClient = this.adaptedHttpClients.get(baseClient);
    if (cachedClient) {
      return cachedClient;
    }
    const adaptedClient = new Rezo({
      ...baseClient.defaults,
      hooks: baseClient.hooks,
      jar: baseClient.jar,
      proxyManager: baseClient.proxyManager || undefined
    }, this.adapterExecutor);
    adaptedClient.defaults = baseClient.defaults;
    adaptedClient.hooks = baseClient.hooks;
    adaptedClient.jar = baseClient.jar;
    this.adaptedHttpClients.set(baseClient, adaptedClient);
    return adaptedClient;
  }
  headersToRecord(headers) {
    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        normalized[key] = value.join(", ");
      } else if (typeof value === "number") {
        normalized[key] = value.toString();
      }
    }
    return normalized;
  }
  encodeProviderBody(body) {
    if (body === undefined || body === null || body === "") {
      return;
    }
    if (Buffer.isBuffer(body)) {
      return body.toString("base64");
    }
    if (typeof body === "string") {
      return Buffer.from(body).toString("base64");
    }
    return Buffer.from(JSON.stringify(body)).toString("base64");
  }
  findProviderQueue(entries, adapter) {
    return entries.find((entry) => entry.adaptar === adapter)?.pqueue;
  }
  async runWithQueues(task, ...queues) {
    const uniqueQueues = Array.from(new Set(queues.filter((queue) => !!queue)));
    let wrappedTask = task;
    for (let i = uniqueQueues.length - 1;i >= 0; i--) {
      const queue = uniqueQueues[i];
      const previousTask = wrappedTask;
      wrappedTask = () => queue.add(() => previousTask());
    }
    return wrappedTask();
  }
  getProviderQueues() {
    return [
      ...this.config.oxylabs.map((entry) => entry.pqueue),
      ...this.config.decodo.map((entry) => entry.pqueue)
    ].filter((queue) => !!queue);
  }
  getManagedQueues() {
    return [this.queue, this.scraperQueue, ...this.getProviderQueues()];
  }
  startManagedQueues() {
    for (const queue of this.getManagedQueues()) {
      queue.start();
    }
  }
  clearManagedQueues() {
    for (const queue of this.getManagedQueues()) {
      queue.clear();
    }
  }
  async persistNavigationSession(status) {
    const history = await this.ensureNavigationHistoryReady();
    if (!history || !this.currentSession)
      return null;
    const queueSize = await history.getQueueSize(this.currentSession.sessionId);
    await history.updateSessionStats(this.currentSession.sessionId, {
      urlsVisited: this.crawlStats.urlsVisited,
      urlsQueued: queueSize,
      urlsFailed: this.crawlStats.urlsFailed
    });
    this.currentSession.urlsVisited = this.crawlStats.urlsVisited;
    this.currentSession.urlsQueued = queueSize;
    this.currentSession.urlsFailed = this.crawlStats.urlsFailed;
    if (status) {
      await history.updateSessionStatus(this.currentSession.sessionId, status);
      this.currentSession.status = status;
    }
    return { queueSize };
  }
  ensureActive() {
    if (!this.isDestroyed)
      return;
    throw new Error("Crawler has been destroyed. Create a new Crawler instance to start another crawl.");
  }
  async initializeNavigationHistory(navHistoryDir) {
    try {
      const history = await NavigationHistory.create({
        storeDir: navHistoryDir,
        dbFileName: "navigation.db"
      });
      this.navigationHistory = history;
      this.isNavigationHistoryReady = true;
      const session = await history.getSession(this.config.sessionId);
      if (session && (session.status === "running" || session.status === "paused")) {
        this.currentSession = session;
        await history.updateSessionStatus(this.config.sessionId, "running");
      } else if (session && (session.status === "completed" || session.status === "failed")) {
        await history.deleteSession(this.config.sessionId);
        this.currentSession = await history.createSession(this.config.sessionId, this.config.baseUrl, { adapter: this.adapterType });
      } else if (!session) {
        this.currentSession = await history.createSession(this.config.sessionId, this.config.baseUrl, { adapter: this.adapterType });
      }
      this.isSessionReady = true;
    } catch (error) {
      if (this.config.debug) {
        console.error(`[Crawler] Failed to initialize navigation history:`, error);
      }
      this.isNavigationHistoryReady = false;
      this.isSessionReady = false;
    }
  }
  async waitForNavigationHistory() {
    if (!this.config.enableNavigationHistory)
      return;
    if (this.isNavigationHistoryReady && this.isSessionReady)
      return;
    if (this.navigationHistoryInitPromise) {
      await this.navigationHistoryInitPromise;
    }
  }
  async ensureNavigationHistoryReady() {
    if (!this.config.enableNavigationHistory)
      return null;
    await this.waitForNavigationHistory();
    return this.navigationHistory;
  }
  async addToNavigationQueue(url, method, body, headers) {
    const history = await this.ensureNavigationHistoryReady();
    if (!history || !this.currentSession)
      return;
    try {
      await history.addToQueue(this.currentSession.sessionId, url, {
        method,
        body,
        headers
      });
    } catch (error) {
      if (this.config.debug) {
        console.warn(`[Crawler] Failed to add URL to navigation queue: ${url}`, error);
      }
    }
  }
  async removeFromNavigationQueue(url) {
    const history = await this.ensureNavigationHistoryReady();
    if (!history || !this.currentSession)
      return;
    try {
      await history.removeFromQueue(this.currentSession.sessionId, url);
    } catch (error) {
      if (this.config.debug) {
        console.warn(`[Crawler] Failed to remove URL from navigation queue: ${url}`, error);
      }
    }
  }
  async markUrlVisited(url, result) {
    const history = await this.ensureNavigationHistoryReady();
    if (!history || !this.currentSession)
      return;
    try {
      await history.markVisited(this.currentSession.sessionId, url, result);
    } catch (error) {
      if (this.config.debug) {
        console.warn(`[Crawler] Failed to mark URL as visited: ${url}`, error);
      }
    }
  }
  async syncNavigationSessionStats(status) {
    try {
      await this.persistNavigationSession(status);
    } catch (error) {
      if (this.config.debug) {
        console.warn("[Crawler] Failed to sync navigation session stats:", error);
      }
    }
  }
  getSession() {
    return this.currentSession;
  }
  getSessionId() {
    return this.config.sessionId;
  }
  async resume(sessionId) {
    this.ensureActive();
    if (!this.config.enableNavigationHistory) {
      throw new Error("Navigation history is not enabled. Set enableNavigationHistory: true in options.");
    }
    await this.waitForNavigationHistory();
    if (!this.navigationHistory) {
      throw new Error("Navigation history failed to initialize.");
    }
    await this.waitForStorage();
    if (this.isCacheEnabled) {
      await this.waitForCache();
    }
    const targetSessionId = sessionId || this.config.sessionId;
    const previousSessionId = this.currentSession?.sessionId;
    const managedQueues = this.getManagedQueues();
    const hasPausedInMemoryQueues = managedQueues.some((queue) => queue.isPaused);
    const hasInMemoryQueuedWork = managedQueues.some((queue) => queue.size > 0);
    const hasInMemoryActiveWork = managedQueues.some((queue) => queue.pending > 0);
    const hasInMemoryWork = hasInMemoryQueuedWork || hasInMemoryActiveWork;
    const session = await this.navigationHistory.getSession(targetSessionId);
    if (!session) {
      throw new Error(`Session '${targetSessionId}' not found`);
    }
    if (session.status === "completed") {
      throw new Error(`Session '${targetSessionId}' is already completed`);
    }
    const isCurrentSessionResume = previousSessionId === targetSessionId && hasPausedInMemoryQueues;
    if (previousSessionId && previousSessionId !== targetSessionId) {
      if (hasInMemoryActiveWork) {
        throw new Error(`Cannot resume session '${targetSessionId}' while session '${previousSessionId}' still has active in-memory work.`);
      }
      if (hasInMemoryQueuedWork) {
        this.clearManagedQueues();
      }
    }
    this.currentSession = {
      ...session,
      status: "running"
    };
    await this.navigationHistory.updateSessionStatus(targetSessionId, "running");
    if (isCurrentSessionResume && hasInMemoryWork) {
      this.startManagedQueues();
      return this;
    }
    const queuedUrls = await this.navigationHistory.getAllQueuedUrls(targetSessionId);
    if (this.config.debug) {
      console.log(`[Crawler] Resuming session '${targetSessionId}' with ${queuedUrls.length} queued URLs`);
    }
    const scheduledUrls = new Set;
    for (const item of queuedUrls) {
      if (scheduledUrls.has(item.url)) {
        continue;
      }
      scheduledUrls.add(item.url);
      const body = item.body ? JSON.parse(item.body) : undefined;
      const headers = item.headers ? JSON.parse(item.headers) : undefined;
      this.visit(item.url, {
        method: item.method,
        body,
        headers,
        forceRevisit: false
      });
    }
    this.startManagedQueues();
    return this;
  }
  async getResumableSessions() {
    if (!this.config.enableNavigationHistory) {
      return [];
    }
    await this.waitForNavigationHistory();
    if (!this.navigationHistory) {
      return [];
    }
    return this.navigationHistory.getResumableSessions();
  }
  async pause() {
    await this.waitForNavigationHistory();
    if (!this.navigationHistory || !this.currentSession) {
      return;
    }
    this.queue.pause();
    this.scraperQueue.pause();
    for (const queue of this.getProviderQueues()) {
      queue.pause();
    }
    await this.syncNavigationSessionStats("paused");
  }
  async complete() {
    await this.waitForNavigationHistory();
    if (!this.navigationHistory || !this.currentSession) {
      return;
    }
    await this.syncNavigationSessionStats("completed");
  }
  getAdapterType() {
    return this.adapterType;
  }
  async setAdapter(adapter) {
    this.adapterType = adapter;
    this.adapterInitPromise = this.initializeAdapter();
    await this.adapterInitPromise;
  }
  rawResponseHandler(data) {
    if (this.rawResponseEvents.length === 0)
      return;
    const isBuffer = Buffer.isBuffer(data);
    if (!isBuffer) {
      if (data instanceof ArrayBuffer) {
        data = Buffer.from(new Uint8Array(data));
      } else if (data instanceof Uint8Array) {
        data = Buffer.from(data);
      } else if (typeof data === "string") {
        data = Buffer.from(data, "utf8");
      } else if (typeof data === "object") {
        data = Buffer.from(JSON.stringify(data), "utf8");
      }
    }
    this.rawResponseEvents.forEach((e) => {
      const handler = e.attr[0];
      handler(data);
    });
  }
  async waitForCache(timeoutMs = 30000) {
    if (this.isCacheReady)
      return;
    const start = Date.now();
    while (!this.isCacheReady) {
      if (Date.now() - start > timeoutMs) {
        console.warn("[Crawler] Cache initialization timeout, continuing without cache");
        this.isCacheReady = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async waitForStorage(timeoutMs = 30000) {
    if (this.isStorageReady)
      return;
    const start = Date.now();
    while (!this.isStorageReady) {
      if (Date.now() - start > timeoutMs) {
        console.warn("[Crawler] Storage initialization timeout, continuing without URL tracking");
        this.isStorageReady = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  stopBackgroundMonitoring() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = undefined;
    }
  }
  async waitForActiveQueuesIdle() {
    if (this.queue.stats.added > 0) {
      await this.queue.onIdle();
    }
    if (this.scraperQueue.stats.added > 0) {
      await this.scraperQueue.onIdle();
    }
  }
  startPeriodicCleanup() {
    if (this.cleanupInterval)
      return;
    this.cleanupInterval = setInterval(() => {
      const memStatus = this.memoryMonitor.check();
      if (memStatus === "critical") {
        this.queue.pause();
        this.memoryMonitor.forceGC();
        if (this.config.debug) {
          const report = this.memoryMonitor.getReport();
          console.warn(`[Crawler] CRITICAL memory (${report.usagePercent}%), pausing...`);
        }
        setTimeout(() => {
          this.queue.concurrency = Math.max(5, Math.floor(this.originalConcurrency * 0.25));
          this.queue.start();
        }, 3000);
      } else if (memStatus === "warning") {
        const newConcurrency = Math.max(10, Math.floor(this.originalConcurrency * 0.5));
        if (this.queue.concurrency > newConcurrency) {
          this.queue.concurrency = newConcurrency;
          if (this.config.debug) {
            const report = this.memoryMonitor.getReport();
            console.warn(`[Crawler] High memory (${report.usagePercent}%), reducing concurrency to ${newConcurrency}`);
          }
        }
      } else {
        if (this.queue.concurrency < this.originalConcurrency) {
          this.queue.concurrency = Math.min(this.originalConcurrency, this.queue.concurrency + 10);
        }
      }
    }, 30000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
    if (this.config.enableNavigationHistory) {
      this.startAutoCheckpoint();
    }
  }
  startAutoCheckpoint() {
    if (this.checkpointInterval)
      return;
    const CHECKPOINT_INTERVAL = 5 * 60 * 1000;
    this.checkpointInterval = setInterval(async () => {
      if (this.shutdownRequested || this.isDestroyed)
        return;
      try {
        await this.saveCheckpoint();
      } catch (error) {
        if (this.config.debug) {
          console.error("[Crawler] Checkpoint save failed:", error);
        }
      }
    }, CHECKPOINT_INTERVAL);
    if (this.checkpointInterval.unref) {
      this.checkpointInterval.unref();
    }
  }
  async saveCheckpoint() {
    if (!this.navigationHistory || !this.currentSession)
      return;
    const now = Date.now();
    if (now - this.lastCheckpointTime < 60000)
      return;
    try {
      const persisted = await this.persistNavigationSession();
      this.lastCheckpointTime = now;
      if (this.config.debug) {
        console.log(`[Crawler] Checkpoint saved: ${this.crawlStats.urlsVisited} visited, ${persisted?.queueSize ?? 0} queued, ${this.crawlStats.urlsFailed} failed`);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error("[Crawler] Failed to save checkpoint:", error);
      }
    }
  }
  async saveUrl(url) {
    await this.waitForStorage();
    await this.urlStorage.set(url, "default");
  }
  async hasUrlInCache(url) {
    await this.waitForStorage();
    return await this.urlStorage.has(url, "default");
  }
  async saveCache(url, value, domain) {
    if (!this.isCacheEnabled)
      return;
    await this.waitForCache();
    const ns = domain || this.getNamespace(url);
    return this.cacher.set(url, value, this.config.cacheTTL, ns);
  }
  getNamespace(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return;
    }
  }
  async hasCache(url, domain) {
    if (!this.isCacheEnabled)
      return false;
    await this.waitForCache();
    const ns = domain || this.getNamespace(url);
    return this.cacher.has(url, ns);
  }
  async getCache(url, domain) {
    if (!this.isCacheEnabled)
      return null;
    await this.waitForCache();
    const ns = domain || this.getNamespace(url);
    return this.cacher.get(url, ns);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  rnd(min = 0, max = Number.MAX_VALUE) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  onError(handler) {
    this.errorEvents.push({
      handler: "_onError",
      attr: [handler]
    });
    return this;
  }
  onJson(handler) {
    this.jsonEvents.push({
      handler: "_onJson",
      attr: [handler]
    });
    return this;
  }
  onEmailDiscovered(handler) {
    this.emailDiscoveredEvents.push(handler);
    return this;
  }
  onEmailLeads(handler) {
    this.emailLeadsEvents.push(handler);
    return this;
  }
  onStart(handler) {
    this.startHandlers.push(handler);
    return this;
  }
  onFinish(handler) {
    this.finishHandlers.push(handler);
    return this;
  }
  onRedirect(handler) {
    this.redirectHandlers.push(handler);
    return this;
  }
  onQueueChange(handler) {
    this.queueChangeHandlers.push(handler);
    this._subscribeToManagedQueues();
    return this;
  }
  onRawData(handler) {
    this.rawResponseEvents.push({
      handler: "_onRawResponse",
      attr: [handler]
    });
    return this;
  }
  onDocument(handler) {
    this.events.push({
      handler: "_onDocument",
      attr: [handler]
    });
    return this;
  }
  onBody(handler) {
    this.events.push({
      handler: "_onBody",
      attr: [handler]
    });
    return this;
  }
  onElement(handler) {
    this.events.push({
      handler: "_onElement",
      attr: [handler]
    });
    return this;
  }
  onAnchor(selection, handler) {
    this.events.push({
      handler: "_onAnchor",
      attr: [selection, handler]
    });
    return this;
  }
  onHref(handler) {
    this.events.push({
      handler: "_onHref",
      attr: [handler]
    });
    return this;
  }
  onSelection(selection, handler) {
    this.events.push({
      handler: "_onSelection",
      attr: [selection, handler]
    });
    return this;
  }
  onResponse(handler) {
    this.responseEvents.push({
      handler: "_onResponse",
      attr: [handler]
    });
    return this;
  }
  onAttribute(selection, attribute, handler) {
    this.events.push({
      handler: "_onAttribute",
      attr: [selection, attribute, handler]
    });
    return this;
  }
  onText(selection, handler) {
    this.events.push({
      handler: "_onText",
      attr: [selection, handler]
    });
    return this;
  }
  subscribedManagedQueues = new Set;
  _subscribeToQueueEvents(queue, queueType) {
    const emitEvent = (event, taskId) => {
      if (this.queueChangeHandlers.length === 0)
        return;
      const state = queue.state;
      const queueChangeEvent = {
        queueName: queue.name,
        queueType,
        event,
        pending: state.pending,
        size: state.size,
        total: state.total,
        isPaused: state.isPaused,
        isIdle: state.isIdle,
        taskId
      };
      for (const handler of this.queueChangeHandlers) {
        try {
          handler(queueChangeEvent);
        } catch (err) {
          if (this.config.debug)
            console.error("[Crawler] onQueueChange handler error:", err);
        }
      }
    };
    queue.on("add", (data) => emitEvent("add", data.id));
    queue.on("start", (data) => emitEvent("start", data.id));
    queue.on("completed", (data) => emitEvent("completed", data.id));
    queue.on("error", (data) => emitEvent("error", data.id));
    queue.on("timeout", (data) => emitEvent("timeout", data.id));
    queue.on("cancelled", (data) => emitEvent("cancelled", data.id));
    queue.on("idle", () => emitEvent("idle"));
    queue.on("active", () => emitEvent("active"));
    queue.on("paused", () => emitEvent("paused"));
    queue.on("resumed", () => emitEvent("resumed"));
  }
  _subscribeToManagedQueues() {
    const limiters = this.config.getLimiters();
    for (const limiter of limiters) {
      if (!this.subscribedManagedQueues.has(limiter.pqueue)) {
        this._subscribeToQueueEvents(limiter.pqueue, "limiter");
        this.subscribedManagedQueues.add(limiter.pqueue);
      }
    }
    for (const oxylabs of this.config.oxylabs) {
      if (oxylabs.pqueue && !this.subscribedManagedQueues.has(oxylabs.pqueue)) {
        this._subscribeToQueueEvents(oxylabs.pqueue, "provider");
        this.subscribedManagedQueues.add(oxylabs.pqueue);
      }
    }
    for (const decodo of this.config.decodo) {
      if (decodo.pqueue && !this.subscribedManagedQueues.has(decodo.pqueue)) {
        this._subscribeToQueueEvents(decodo.pqueue, "provider");
        this.subscribedManagedQueues.add(decodo.pqueue);
      }
    }
  }
  _runHandler(handler, arg) {
    this.eventCount++;
    new Promise(async (resolve) => {
      try {
        await handler(arg);
      } catch (err) {
        if (this.config.debug)
          console.error("[Crawler] Handler error:", err);
      }
      resolve();
    }).finally(() => {
      this.eventCount--;
    });
  }
  _runBoundHandler(fn) {
    this.eventCount++;
    Promise.resolve().then(async () => {
      try {
        await fn();
      } catch (err) {
        if (this.config.debug)
          console.error("[Crawler] Handler error:", err);
      }
    }).finally(() => {
      this.eventCount--;
    });
  }
  _onBody(handler, document) {
    this._runHandler(handler, document.body);
  }
  _onAttribute(selection, attribute, handler, document) {
    const isSimpleForm = typeof attribute === "function";
    const actualAttribute = isSimpleForm ? selection : attribute;
    const actualHandler = isSimpleForm ? attribute : handler;
    const actualSelection = isSimpleForm ? `[${selection}]` : selection || `[${attribute}]`;
    const elements = document.querySelectorAll(actualSelection);
    for (let i = 0;i < elements.length; i++) {
      const el = elements[i];
      if (el.hasAttribute(actualAttribute)) {
        const value = el.getAttribute(actualAttribute);
        this._runBoundHandler(() => actualHandler.call(el, value, actualAttribute));
      }
    }
  }
  _onText(selection, handler, document) {
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      const el = elements[i];
      const text = el.textContent;
      this._runBoundHandler(() => handler.call(el, text));
    }
  }
  _onSelection(selection, handler, document) {
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      this._runHandler(handler, elements[i]);
    }
  }
  _onElement(handler, document) {
    const elements = document.querySelectorAll("*");
    for (let i = 0;i < elements.length; i++) {
      this._runHandler(handler, elements[i]);
    }
  }
  _onHref(handler, document) {
    const elements = document.querySelectorAll("a, link");
    for (let i = 0;i < elements.length; i++) {
      const el = elements[i];
      if (el.hasAttribute("href")) {
        const href = new URL(el.getAttribute("href"), document.URL).href;
        this._runBoundHandler(() => handler.call(el, href));
      }
    }
  }
  _onAnchor(selection, handler, document) {
    handler = typeof selection === "function" ? selection : handler;
    selection = typeof selection === "function" ? "a" : selection;
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      if (elements[i]?.href && document.baseURI)
        elements[i].href = new URL(elements[i].getAttribute("href"), document.baseURI).href;
      this._runHandler(handler, elements[i]);
    }
  }
  _onDocument(handler, document) {
    this._runHandler(handler, document);
  }
  _onJson(handler, json) {
    this._runHandler(handler, json);
  }
  _onError(handler, error) {
    this._runHandler(handler, error);
  }
  async _onEmailDiscovered(handler, email) {
    this._runHandler(handler, email);
  }
  async _onEmailLeads(handler, leads) {
    this._runHandler(handler, leads);
  }
  _onRawResponse(handler, rawResponse) {
    this._runHandler(handler, rawResponse);
  }
  _onResponse(handler, response) {
    this._runHandler(handler, response);
  }
  calculateAutoThrottleDelay(domain, responseTime) {
    if (!this.config.autoThrottle)
      return 0;
    let times = this.domainResponseTimes.get(domain) || [];
    times.push(responseTime);
    if (times.length > 10) {
      times = times.slice(-10);
    }
    this.domainResponseTimes.set(domain, times);
    const avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    const targetDelay = this.config.autoThrottleTargetDelay;
    const loadFactor = avgResponseTime / 200;
    let newDelay = Math.round(targetDelay * loadFactor);
    newDelay = Math.max(this.config.autoThrottleMinDelay, newDelay);
    newDelay = Math.min(this.config.autoThrottleMaxDelay, newDelay);
    this.domainCurrentDelay.set(domain, newDelay);
    if (this.config.debug) {
      console.log(`[AutoThrottle] ${domain}: avgRT=${avgResponseTime.toFixed(0)}ms, delay=${newDelay}ms`);
    }
    return newDelay;
  }
  getAutoThrottleDelay(domain) {
    if (!this.config.autoThrottle)
      return 0;
    return this.domainCurrentDelay.get(domain) || this.config.autoThrottleMinDelay;
  }
  async handle429Response(url, response, retryCount, domain, proxyRotating = false) {
    const retryOpts = this.config.getRetryOptions(url);
    const max429Retries = retryOpts?.max429Retries ?? 3;
    const baseDelay = retryOpts?.retryDelay ?? 1000;
    const useBackoff = retryOpts?.backoff ?? true;
    if (retryCount >= max429Retries) {
      if (this.config.debug) {
        console.log(`[Crawler] 429 retry cap reached (${max429Retries}) for ${url}, giving up`);
      }
      return { shouldRetry: false, waitTime: 0 };
    }
    let retryAfter = 0;
    const retryAfterHeader = response?.headers?.["retry-after"] || response?.headers?.get?.("retry-after");
    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsed)) {
        retryAfter = parsed * 1000;
      } else {
        const date = new Date(retryAfterHeader);
        if (!isNaN(date.getTime())) {
          retryAfter = date.getTime() - Date.now();
        }
      }
    }
    if (retryAfter <= 0) {
      retryAfter = useBackoff ? baseDelay * Math.pow(2, retryCount) : baseDelay;
    }
    const maxWait = this.config.maxWaitOn429;
    const alwaysWait = this.config.alwaysWaitOn429;
    if (retryAfter > maxWait && !alwaysWait) {
      const waitMinutes = Math.round(retryAfter / 60000);
      const error = new Error(`Rate limited: Server requested wait time of ${waitMinutes} minutes, which exceeds maxWaitOn429 (${Math.round(maxWait / 60000)} minutes). Set alwaysWaitOn429: true to wait regardless.`);
      error.code = "REZ_RATE_LIMIT_EXCEEDED";
      error.url = url;
      error.status = 429;
      throw error;
    }
    if (retryAfter > maxWait && alwaysWait) {
      const waitMinutes = Math.round(retryAfter / 60000);
      console.warn(`[Crawler] WARNING: Rate limited on ${url}. Server requested ${waitMinutes} minute wait. Waiting because alwaysWaitOn429 is enabled.`);
    }
    if (!proxyRotating) {
      if (domain) {
        this.rateLimitedDomains.set(domain, Date.now() + retryAfter);
      } else {
        try {
          this.rateLimitedDomains.set(new URL(url).hostname, Date.now() + retryAfter);
        } catch {}
      }
    }
    if (this.config.debug) {
      console.log(`[Crawler] 429 Rate Limited: waiting ${Math.round(retryAfter / 1000)}s before retry (attempt ${retryCount + 1}/${max429Retries})`);
    }
    return { shouldRetry: true, waitTime: retryAfter };
  }
  async checkCrawlLimits(url, parentUrl) {
    if (this.config.maxUrls > 0 && this.crawlStats.urlsVisited >= this.config.maxUrls) {
      return { allowed: false, reason: `maxUrls limit reached (${this.config.maxUrls})` };
    }
    if (this.config.maxDepth > 0) {
      const parentDepth = parentUrl ? this.urlDepthMap.get(parentUrl) ?? 0 : 0;
      const urlDepth = this.urlDepthMap.get(url) ?? parentDepth + 1;
      if (urlDepth > this.config.maxDepth) {
        return { allowed: false, reason: `maxDepth limit reached (depth ${urlDepth} > ${this.config.maxDepth})` };
      }
      if (!this.urlDepthMap.has(url)) {
        this.urlDepthMap.set(url, urlDepth);
        this.crawlStats.currentDepth = Math.max(this.crawlStats.currentDepth, urlDepth);
      }
    }
    if (this.config.respectRobotsTxt) {
      try {
        if (!this.robotsTxt.isCached(url)) {
          await this.robotsTxt.fetch(url, async (robotsUrl) => {
            const response = await this.http.get(robotsUrl, { timeout: 1e4 });
            return { status: response.status, data: response.data };
          });
        }
        const allowed = this.robotsTxt.isAllowed(url);
        if (!allowed) {
          return { allowed: false, reason: "Blocked by robots.txt" };
        }
      } catch (error) {
        if (this.config.debug) {
          console.warn(`[Crawler] Failed to check robots.txt for ${url}:`, error);
        }
      }
    }
    return { allowed: true };
  }
  shouldFollowLink(element) {
    if (this.config.followNofollow) {
      return true;
    }
    const rel = element.getAttribute("rel");
    if (rel && rel.toLowerCase().includes("nofollow")) {
      return false;
    }
    return true;
  }
  checkResponseSize(contentLength) {
    if (this.config.maxResponseSize > 0 && contentLength > this.config.maxResponseSize) {
      return {
        allowed: false,
        reason: `Response size (${contentLength} bytes) exceeds maxResponseSize (${this.config.maxResponseSize} bytes)`
      };
    }
    return { allowed: true };
  }
  collect(data) {
    this.collectedData.push(data);
    return this;
  }
  getCollectedData() {
    return this.collectedData.toArray();
  }
  clearCollectedData() {
    this.collectedData.clear();
    return this;
  }
  async exportData(filePath, format = "json") {
    const data = this.collectedData.toArray();
    if (data.length === 0) {
      if (this.config.debug) {
        console.warn("[Crawler] No data to export");
      }
      return;
    }
    let content;
    switch (format) {
      case "json":
        content = JSON.stringify(data, null, 2);
        break;
      case "jsonl":
        content = data.map((item) => JSON.stringify(item)).join(`
`);
        break;
      case "csv":
        const keys = new Set;
        data.forEach((item) => {
          if (typeof item === "object" && item !== null) {
            Object.keys(item).forEach((key) => keys.add(key));
          }
        });
        const headers = Array.from(keys);
        const escapeCSV = (val) => {
          if (val === null || val === undefined)
            return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes(`
`)) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        const rows = [
          headers.join(","),
          ...data.map((item) => {
            if (typeof item !== "object" || item === null) {
              return escapeCSV(item);
            }
            return headers.map((key) => escapeCSV(item[key])).join(",");
          })
        ];
        content = rows.join(`
`);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
    if (this.config.debug) {
      console.log(`[Crawler] Exported ${data.length} items to ${filePath} (${format})`);
    }
  }
  getStats() {
    return { ...this.crawlStats };
  }
  getHealthSnapshot() {
    return this.healthMetrics.getSnapshot(this.queue.size, this.queue.pending);
  }
  isHealthy(options) {
    return this.healthMetrics.isHealthy(options);
  }
  getPrometheusMetrics(prefix = "crawler") {
    return this.healthMetrics.toPrometheusFormat(prefix);
  }
  async triggerStartHandlers() {
    if (this.hasStartedLifecycle)
      return;
    if (this.startHandlersPromise) {
      return this.startHandlersPromise;
    }
    this.hasStartedLifecycle = true;
    this.startHandlersPromise = (async () => {
      this.crawlStats.startTime = Date.now();
      this.startPeriodicCleanup();
      for (const handler of this.startHandlers) {
        try {
          await handler();
        } catch (err) {
          if (this.config.debug)
            console.error("[Crawler] onStart handler error:", err);
        }
      }
    })();
    try {
      await this.startHandlersPromise;
    } finally {
      this.startHandlersPromise = null;
    }
  }
  async triggerFinishHandlers() {
    this.crawlStats.endTime = Date.now();
    for (const handler of this.finishHandlers) {
      try {
        await handler(this.crawlStats);
      } catch (err) {
        if (this.config.debug)
          console.error("[Crawler] onFinish handler error:", err);
      }
    }
  }
  async triggerRedirectHandlers(event) {
    for (const handler of this.redirectHandlers) {
      this._runHandler(handler, event);
    }
  }
  buildUrl(url, params) {
    if (params) {
      const u = new URL(url, this.config.baseUrl);
      for (const [key, value] of Object.entries(params)) {
        u.searchParams.set(key, value.toString());
      }
      url = u.href;
    }
    return url;
  }
  visit(url, options) {
    this.ensureActive();
    if (this.config.baseUrl)
      url = new URL(url, this.config.baseUrl).href;
    if (options?.params && (options.useOxylabsScraperAi || this.config.hasDomain(url, "oxylabs"))) {
      url = this.buildUrl(url, options.params);
    }
    const {
      method = "GET",
      headers = new Headers,
      forceRevisit = this.config.forceRevisit,
      body = "",
      timeout = this.config.timeout,
      maxRedirects = this.config.maxRedirects,
      extractLeads = false,
      rejectUnauthorized,
      deepEmailFinder = false,
      useOxylabsScraperAi = false,
      useOxylabsRotation = true,
      useDecodo = false,
      skipCache = false,
      emailMetadata = {}
    } = options || {};
    const useProxy = options?.useProxy ?? this.config.hasDomain(url, "proxies", true);
    const useQueue = options?.useQueue ?? this.config.hasDomain(url, "limiters", true);
    const mergedHeaders = this.config.pickHeaders(url, true, headers, true);
    const limiterQueue = useQueue ? this.config.getAdapter(url, "limiters", true, false) || undefined : undefined;
    const proxyConfig = useProxy ? this.config.getProxyConfig(url, true, true) : null;
    const _options = {
      headers: mergedHeaders,
      timeout,
      maxRedirects,
      proxy: proxyConfig?.proxy,
      rejectUnauthorized: typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : this.config.rejectUnauthorized,
      queue: limiterQueue
    };
    let oxylabsOptions = {};
    let oxylabsInstance = undefined;
    let oxylabsQueue = undefined;
    if (useOxylabsScraperAi && this.config.hasDomain(url, "oxylabs", true)) {
      oxylabsOptions = {
        browserType: options?.browserType,
        locale: options?.locale,
        geoLocation: options?.geoLocation,
        http_method: options?.http_method ?? (method === "POST" ? "post" : "get"),
        base64Body: options?.base64Body ?? this.encodeProviderBody(body),
        returnAsBase64: options?.returnAsBase64,
        successful_status_codes: options?.successful_status_codes,
        session_id: options?.session_id,
        follow_redirects: options?.follow_redirects,
        javascript_rendering: options?.javascript_rendering,
        headers: this.headersToRecord(mergedHeaders),
        cookies: options?.cookies,
        render: options?.render,
        context: options?.context
      };
      oxylabsInstance = this.config.getAdapter(url, "oxylabs", true, useOxylabsRotation) || undefined;
      oxylabsQueue = oxylabsInstance ? this.findProviderQueue(this.config.oxylabs, oxylabsInstance) : undefined;
    }
    let decodoOptions = {};
    let decodoInstance = undefined;
    let decodoQueue = undefined;
    if (useDecodo && this.config.hasDomain(url, "decodo", true)) {
      decodoOptions = {
        deviceType: options?.deviceType,
        locale: options?.locale,
        country: options?.country,
        state: options?.state,
        city: options?.city,
        headless: options?.headless,
        sessionId: options?.sessionId,
        sessionDuration: options?.sessionDuration,
        javascript: options?.javascript,
        javascriptWait: options?.javascriptWait,
        waitForCss: options?.waitForCss,
        http_method: options?.http_method ?? (method === "POST" ? "post" : "get"),
        base64Body: options?.base64Body ?? this.encodeProviderBody(body),
        successful_status_codes: options?.successful_status_codes,
        session_id: options?.session_id,
        javascript_rendering: options?.javascript_rendering,
        headers: this.headersToRecord(mergedHeaders),
        cookies: options?.cookies
      };
      decodoInstance = this.config.getAdapter(url, "decodo", true, false) || undefined;
      decodoQueue = decodoInstance ? this.findProviderQueue(this.config.decodo, decodoInstance) : undefined;
    }
    const stealthInstance = this.config.getAdapter(url, "stealth", true, false) || undefined;
    url = this.buildUrl(url, options?.params);
    if (this.config.enableNavigationHistory) {
      const headersObj = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
      this.addToNavigationQueue(url, method, body, headersObj);
    }
    this.hasScheduledWork = true;
    if (deepEmailFinder) {
      this.execute2(method, url, body, _options, forceRevisit, emailMetadata);
      return this;
    }
    this.execute(method, url, body, _options, proxyConfig?.rotating ?? false, extractLeads, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, skipCache, emailMetadata, stealthInstance);
    return this;
  }
  async execute(method, url, body, options = {}, proxyRotating = false, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, skipCache, emailMetadata, stealthInstance) {
    this.queue.add(async () => {
      if (!this.isStorageReady)
        await this.waitForStorage();
      if (this.isCacheEnabled && !this.isCacheReady)
        await this.waitForCache();
      if (this.config.enableNavigationHistory && !this.isNavigationHistoryReady)
        await this.waitForNavigationHistory();
      await this.executeHttp(method, url, body, options, proxyRotating, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, 0, undefined, skipCache, emailMetadata, stealthInstance);
    }).catch((err) => {
      if (this.config.debug)
        console.warn("[Crawler] execute() task error:", err?.message);
    });
  }
  async execute2(method, url, body, options = {}, forceRevisit, emailMetadata) {
    this.scraperQueue.add(async () => {
      if (!this.isStorageReady)
        await this.waitForStorage();
      if (this.isCacheEnabled && !this.isCacheReady)
        await this.waitForCache();
      if (this.config.enableNavigationHistory && !this.isNavigationHistoryReady)
        await this.waitForNavigationHistory();
      await this.leadsFinder.parseExternalWebsite(url, method, body, {
        httpConfig: options,
        saveCache: this.saveCache.bind(this),
        saveUrl: this.saveUrl.bind(this),
        getCache: this.getCache.bind(this),
        hasUrlInCache: this.hasUrlInCache.bind(this),
        onEmailDiscovered: this.emailDiscoveredEvents,
        onEmails: this.emailLeadsEvents,
        queue: this.scraperQueue,
        depth: 1,
        allowCrossDomainTravel: true,
        emailMetadata
      }, forceRevisit, true);
    }).catch((err) => {
      if (this.config.debug)
        console.warn("[Crawler] execute2() task error:", err?.message);
    });
  }
  async executeHttp(method, url, body, options = {}, proxyRotating = false, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, retryCount = 0, parentUrl, skipCache, emailMetadata, stealthInstance) {
    let domain;
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = "default";
    }
    try {
      await this.triggerStartHandlers();
      const limitCheck = await this.checkCrawlLimits(url, parentUrl);
      if (!limitCheck.allowed) {
        await this.removeFromNavigationQueue(url);
        if (this.config.debug) {
          console.log(`[Crawler] Skipping ${url}: ${limitCheck.reason}`);
        }
        return;
      }
      this.crawlStats.urlsQueued++;
      const limiterRandomDelay = this.config.getRandomDelay(url, true);
      let delay = 0;
      if (limiterRandomDelay !== undefined && limiterRandomDelay > 0) {
        delay = Math.floor(Math.random() * limiterRandomDelay);
        if (this.config.debug) {
          console.log(`[RandomDelay] ${domain}: ${delay}ms (max: ${limiterRandomDelay}ms)`);
        }
      } else {
        delay = this.getAutoThrottleDelay(domain);
      }
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const rateLimitUntil = proxyRotating ? undefined : this.rateLimitedDomains.get(domain);
      if (rateLimitUntil) {
        const remaining = rateLimitUntil - Date.now();
        if (remaining > 0) {
          if (this.config.debug) {
            console.log(`[Crawler] Domain ${domain} rate-limited, waiting ${Math.round(remaining / 1000)}s`);
          }
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        this.rateLimitedDomains.delete(domain);
      }
      let cache;
      if (method === "GET") {
        if (!forceRevisit) {
          cache = await this.getCache(url, domain) ?? undefined;
          if (!cache) {
            const isVisited = await this.hasUrlInCache(url);
            if (isVisited) {
              await this.removeFromNavigationQueue(url);
              return;
            }
          }
        } else {
          cache = await this.getCache(url, domain) ?? undefined;
        }
      }
      const requestStartTime = Date.now();
      await this.waitForAdapter();
      const http = this.getRequestClient(stealthInstance || this.http);
      const response = cache && method === "GET" && !skipCache ? cache : oxylabsInstance && oxylabsOptions ? await this.runWithQueues(() => oxylabsInstance.scrape(url, oxylabsOptions), options.queue, oxylabsQueue) : decodoInstance && decodoOptions ? await this.runWithQueues(() => decodoInstance.scrape(url, decodoOptions), options.queue, decodoQueue) : method === "GET" ? await http.get(url, options) : method === "PATCH" ? await http.patch(url, body, options) : method === "POST" ? await http.post(url, body, options) : await http.put(url, body, options);
      if (!response) {
        this.crawlStats.urlsFailed++;
        this.healthMetrics.recordRequest(Date.now() - requestStartTime, false);
        await this.markUrlVisited(url, {
          status: 0,
          errorMessage: "Request failed"
        });
        if (this.config.debug) {
          console.log(`[Crawler] Request failed for ${url}`);
        }
        return;
      }
      if (!cache) {
        const responseTime = Date.now() - requestStartTime;
        this.calculateAutoThrottleDelay(domain, responseTime);
      }
      const res = {
        data: response.data || response.content || "",
        contentType: response.contentType || "",
        finalUrl: response.finalUrl || response.url || url,
        url: response?.urls?.[0] || response.url || this.buildUrl(url, options.params),
        headers: response.headers || {},
        status: response.status || response.statusCode || 200,
        statusText: response.statusText || "",
        cookies: response?.cookies?.serialized || response?.cookies,
        contentLength: response.contentLength || 0
      };
      if (res.contentLength && res.contentLength > 0) {
        const sizeCheck = this.checkResponseSize(res.contentLength);
        if (!sizeCheck.allowed) {
          await this.removeFromNavigationQueue(url);
          if (this.config.debug) {
            console.log(`[Crawler] Skipping ${url}: ${sizeCheck.reason}`);
          }
          return;
        }
      }
      this.crawlStats.urlsVisited++;
      const finalResponseTime = cache ? 0 : Date.now() - requestStartTime;
      this.healthMetrics.recordRequest(finalResponseTime, true);
      if (res.finalUrl && res.finalUrl !== url && this.redirectHandlers.length > 0) {
        await this.triggerRedirectHandlers({
          originalUrl: url,
          finalUrl: res.finalUrl,
          redirectCount: response.redirectCount || 1,
          statusCode: res.status
        });
      }
      if (!cache && method === "GET")
        await this.saveCache(url, res, domain);
      if (method === "GET")
        await this.saveUrl(url);
      await this.markUrlVisited(url, {
        status: res.status,
        finalUrl: res.finalUrl,
        contentType: res.contentType
      });
      if (res.contentType && res.contentType.includes("/json")) {
        if (this.emailDiscoveredEvents.length > 0 || this.emailLeadsEvents.length > 0) {
          this.leadsFinder.extractEmails(JSON.stringify(res.data), res.finalUrl, this.emailDiscoveredEvents, this.emailLeadsEvents, this.scraperQueue, emailMetadata);
        }
        for (let i = 0;i < this.jsonEvents.length; i++) {
          const event = this.jsonEvents[i];
          this[event.handler](...event.attr, res.data);
        }
      }
      for (let i = 0;i < this.responseEvents.length; i++) {
        const event = this.responseEvents[i];
        this[event.handler](...event.attr, res);
      }
      this.rawResponseHandler(res.data);
      if (!res.contentType || !res.contentType.includes("/html") || typeof res.data !== "string")
        return;
      if ((this.emailDiscoveredEvents.length > 0 || this.emailLeadsEvents.length > 0) && isEmail) {
        this.leadsFinder.extractEmails(res.data, res.finalUrl, this.emailDiscoveredEvents, this.emailLeadsEvents, this.scraperQueue, emailMetadata);
      }
      if (this.events.length > 0) {
        const { document } = parseHTML(res.data.addBaseUrl(res.finalUrl));
        document.URL = res.finalUrl;
        for (let i = 0;i < this.events.length; i++) {
          const event = this.events[i];
          this[event.handler](...event.attr, document);
        }
      }
    } catch (e) {
      const error = e;
      if (error?.response?.status === 429 || error?.status === 429) {
        try {
          const { shouldRetry, waitTime } = await this.handle429Response(url, error.response || error, retryCount, domain, proxyRotating);
          if (shouldRetry) {
            await this.sleep(waitTime);
            return await this.executeHttp(method, url, body, options, proxyRotating, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, retryCount + 1, parentUrl, skipCache, emailMetadata, stealthInstance);
          } else {
            this.crawlStats.urlsFailed++;
            await this.markUrlVisited(url, {
              status: error?.response?.status || 429,
              errorMessage: error.message || "Rate limit retry cap reached"
            });
            for (let i = 0;i < this.errorEvents.length; i++) {
              const event = this.errorEvents[i];
              this[event.handler](...event.attr, error);
            }
            return;
          }
        } catch (rateLimitError) {
          this.crawlStats.urlsFailed++;
          await this.markUrlVisited(url, {
            status: error?.response?.status || 429,
            errorMessage: rateLimitError?.message || "Rate limit handling failed"
          });
          if (this.config.throwFatalError)
            throw rateLimitError;
          for (let i = 0;i < this.errorEvents.length; i++) {
            const event = this.errorEvents[i];
            this[event.handler](...event.attr, rateLimitError);
          }
          return;
        }
      }
      if (error && error.response) {
        const status = error.response.status;
        const retryDelay = this.config.retryDelay || 1000;
        const maxRetryAttempts = this.config.maxRetryAttempts || 3;
        const maxRetryOnProxyError = this.config.maxRetryOnProxyError || 3;
        const retryWithoutProxyOnStatusCode = this.config.retryWithoutProxyOnStatusCode || undefined;
        const retryOnStatusCode = this.config.retryOnStatusCode || undefined;
        const retryOnProxyError = this.config.retryOnProxyError || undefined;
        if (retryWithoutProxyOnStatusCode && options.proxy && retryWithoutProxyOnStatusCode.includes(status) && retryCount < maxRetryAttempts) {
          await this.sleep(retryDelay);
          delete options.proxy;
          return await this.executeHttp(method, url, body, options, proxyRotating, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, retryCount + 1, parentUrl, skipCache, emailMetadata, stealthInstance);
        } else if (retryOnStatusCode && options.proxy && retryOnStatusCode.includes(status) && retryCount < maxRetryAttempts) {
          await this.sleep(retryDelay);
          return await this.executeHttp(method, url, body, options, proxyRotating, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, retryCount + 1, parentUrl, skipCache, emailMetadata, stealthInstance);
        } else if (retryOnProxyError && options.proxy && retryCount < maxRetryOnProxyError) {
          await this.sleep(retryDelay);
          return await this.executeHttp(method, url, body, options, proxyRotating, isEmail, forceRevisit, oxylabsOptions, oxylabsInstance, oxylabsQueue, decodoInstance, decodoOptions, decodoQueue, retryCount + 1, parentUrl, skipCache, emailMetadata, stealthInstance);
        }
      }
      this.crawlStats.urlsFailed++;
      await this.markUrlVisited(url, {
        status: error?.response?.status || 0,
        errorMessage: e.message || "Unknown error"
      });
      if (this.config.throwFatalError)
        throw e;
      if (this.config.debug) {
        console.log(`Error visiting ${url}: ${e.message}`);
      }
      for (let i = 0;i < this.errorEvents.length; i++) {
        const event = this.errorEvents[i];
        this[event.handler](...event.attr, e);
      }
    }
  }
  async waitForAll() {
    if (!this.hasScheduledWork) {
      await new Promise((resolve) => setImmediate(resolve));
      const maxWaitForStart = 1000;
      const startWait = Date.now();
      while (!this.hasScheduledWork && Date.now() - startWait < maxWaitForStart) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!this.hasScheduledWork) {
        return;
      }
    }
    let consecutiveIdleChecks = 0;
    const REQUIRED_IDLE_CHECKS = 2;
    const SETTLE_DELAY = 20;
    while (true) {
      await this.waitForActiveQueuesIdle();
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY));
      const allIdle = this.queue.size === 0 && this.queue.pending === 0 && this.scraperQueue.size === 0 && this.scraperQueue.pending === 0 && this.eventCount === 0;
      if (allIdle) {
        consecutiveIdleChecks++;
        if (consecutiveIdleChecks >= REQUIRED_IDLE_CHECKS) {
          break;
        }
      } else {
        consecutiveIdleChecks = 0;
      }
    }
    await this.triggerFinishHandlers();
    await this.syncNavigationSessionStats("completed");
    this.hasScheduledWork = false;
    this.hasStartedLifecycle = false;
    this.startHandlersPromise = null;
    this.stopBackgroundMonitoring();
  }
  async done() {
    return this.waitForAll();
  }
  async close() {
    try {
      await this.cacher?.close();
    } catch {}
    try {
      await this.urlStorage?.close();
    } catch {}
    try {
      await this.navigationHistory?.close();
    } catch {}
  }
  async destroy() {
    if (this.isDestroyed)
      return;
    this.isDestroyed = true;
    this.removeShutdownHandlers();
    this.stopBackgroundMonitoring();
    this.memoryMonitor.destroy();
    this.hasScheduledWork = false;
    this.hasStartedLifecycle = false;
    this.startHandlersPromise = null;
    this.queue.destroy();
    this.scraperQueue.destroy();
    this.config.destroyLimiters();
    this.config.destroyProviderQueues();
    this.events.length = 0;
    this.jsonEvents.length = 0;
    this.errorEvents.length = 0;
    this.responseEvents.length = 0;
    this.rawResponseEvents.length = 0;
    this.emailDiscoveredEvents.length = 0;
    this.emailLeadsEvents.length = 0;
    this.domainResponseTimes.clear();
    this.domainCurrentDelay.clear();
    this.urlDepthMap.clear();
    this.collectedData.clear();
    await this.close();
    resetGlobalAgentPool();
  }
}
