import { RezoQueue } from './queue.js';
import { HttpMethodPriority } from './types.js';
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    const match = url.match(/^(?:https?:\/\/)?([^/:]+)/i);
    return match?.[1] ?? "unknown";
  }
}
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class HttpQueue extends RezoQueue {
  domainQueues = new Map;
  domainPending = new Map;
  domainPaused = new Map;
  domainRateLimited = new Map;
  domainConcurrencyLimits = new Map;
  httpStatsData;
  httpEventHandlers = new Map;
  httpConfig;
  constructor(config = {}) {
    super(config);
    this.httpConfig = {
      ...this.config,
      domainConcurrency: config.domainConcurrency ?? 1 / 0,
      requestsPerSecond: config.requestsPerSecond ?? 0,
      respectRetryAfter: config.respectRetryAfter ?? true,
      respectRateLimitHeaders: config.respectRateLimitHeaders ?? true,
      autoRetry: config.autoRetry ?? false,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      retryStatusCodes: config.retryStatusCodes ?? [429, 500, 502, 503, 504]
    };
    if (typeof config.domainConcurrency === "object") {
      for (const [domain, limit] of Object.entries(config.domainConcurrency)) {
        this.domainConcurrencyLimits.set(domain, limit);
      }
    }
    this.httpStatsData = {
      ...this.stats,
      byDomain: {},
      retries: 0,
      rateLimitHits: 0
    };
    if (this.httpConfig.requestsPerSecond > 0) {
      this.config.interval = 1000;
      this.config.intervalCap = this.httpConfig.requestsPerSecond;
    }
  }
  start() {
    super.start();
    this.tryRunHttpNext();
  }
  get httpStats() {
    return {
      ...this.stats,
      byDomain: { ...this.httpStatsData.byDomain },
      retries: this.httpStatsData.retries,
      rateLimitHits: this.httpStatsData.rateLimitHits
    };
  }
  addHttp(fn, options = {}) {
    return new Promise((resolve, reject) => {
      const domain = options.domain ?? "default";
      const method = (options.method ?? "GET").toUpperCase();
      const effectivePriority = options.priority ?? (HttpMethodPriority[method] ?? HttpMethodPriority.GET);
      const maxRetries = typeof options.retry === "number" ? options.retry : options.retry === true ? this.httpConfig.maxRetries : 0;
      const task = {
        id: options.id ?? generateId(),
        fn,
        priority: effectivePriority,
        timeout: options.timeout ?? this.config.timeout,
        signal: options.signal,
        resolve,
        reject,
        addedAt: Date.now(),
        domain,
        method,
        retryCount: 0,
        maxRetries: this.httpConfig.autoRetry ? Math.max(maxRetries, this.httpConfig.maxRetries) : maxRetries,
        retryDelay: options.retryDelay
      };
      if (options.signal?.aborted) {
        reject(new Error("Task was cancelled before starting"));
        return;
      }
      options.signal?.addEventListener("abort", () => {
        this.cancelHttp(task.id);
      });
      this.ensureDomainStats(domain);
      this.insertHttpTask(task);
      this.emitHttp("add", { id: task.id, priority: task.priority });
      if (!this.isPaused) {
        this.tryRunHttpNext();
      }
    });
  }
  pauseDomain(domain) {
    this.domainPaused.set(domain, true);
  }
  resumeDomain(domain) {
    this.domainPaused.delete(domain);
    this.emitHttp("domainAvailable", { domain });
    this.tryRunHttpNext();
  }
  setDomainConcurrency(domain, limit) {
    this.domainConcurrencyLimits.set(domain, limit);
    this.tryRunHttpNext();
  }
  getDomainState(domain) {
    return {
      pending: this.domainPending.get(domain) ?? 0,
      size: this.domainQueues.get(domain)?.length ?? 0,
      isPaused: this.domainPaused.get(domain) ?? false,
      rateLimitedUntil: this.domainRateLimited.get(domain)
    };
  }
  handleRateLimit(domain, retryAfter) {
    const until = Date.now() + retryAfter * 1000;
    this.domainRateLimited.set(domain, until);
    this.httpStatsData.rateLimitHits++;
    this.ensureDomainStats(domain);
    this.httpStatsData.byDomain[domain].rateLimited++;
    this.emitHttp("rateLimited", { domain, retryAfter });
    setTimeout(() => {
      this.domainRateLimited.delete(domain);
      this.emitHttp("domainAvailable", { domain });
      this.tryRunHttpNext();
    }, retryAfter * 1000);
  }
  cancelHttp(id) {
    for (const [domain, queue] of this.domainQueues.entries()) {
      const index = queue.findIndex((t) => t.id === id);
      if (index !== -1) {
        const [task] = queue.splice(index, 1);
        task.reject(new Error("Task was cancelled"));
        this.ensureDomainStats(domain);
        this.httpStatsData.byDomain[domain].failed++;
        this.emitHttp("cancelled", { id });
        return true;
      }
    }
    return false;
  }
  onHttp(event, handler) {
    if (!this.httpEventHandlers.has(event)) {
      this.httpEventHandlers.set(event, new Set);
    }
    this.httpEventHandlers.get(event).add(handler);
  }
  offHttp(event, handler) {
    this.httpEventHandlers.get(event)?.delete(handler);
  }
  clearHttp() {
    for (const [domain, queue] of this.domainQueues.entries()) {
      this.ensureDomainStats(domain);
      for (const task of queue) {
        task.reject(new Error("Queue was cleared"));
        this.httpStatsData.byDomain[domain].failed++;
        this.emitHttp("cancelled", { id: task.id });
      }
    }
    this.domainQueues.clear();
    this.domainPending.clear();
  }
  destroy() {
    this.clearHttp();
    this.httpEventHandlers.clear();
    super.destroy();
  }
  insertHttpTask(task) {
    const domain = task.domain ?? "default";
    if (!this.domainQueues.has(domain)) {
      this.domainQueues.set(domain, []);
    }
    const queue = this.domainQueues.get(domain);
    let insertIndex = queue.length;
    for (let i = 0;i < queue.length; i++) {
      if (task.priority > queue[i].priority) {
        insertIndex = i;
        break;
      }
    }
    queue.splice(insertIndex, 0, task);
  }
  getDomainLimit(domain) {
    const specificLimit = this.domainConcurrencyLimits.get(domain);
    if (specificLimit !== undefined)
      return specificLimit;
    if (typeof this.httpConfig.domainConcurrency === "number") {
      return this.httpConfig.domainConcurrency;
    }
    return 1 / 0;
  }
  canRunDomain(domain) {
    if (this.domainPaused.get(domain))
      return false;
    const rateLimitedUntil = this.domainRateLimited.get(domain);
    if (rateLimitedUntil && Date.now() < rateLimitedUntil)
      return false;
    const pending = this.domainPending.get(domain) ?? 0;
    const limit = this.getDomainLimit(domain);
    return pending < limit;
  }
  tryRunHttpNext() {
    if (this.isPaused)
      return;
    for (const [domain, queue] of this.domainQueues.entries()) {
      if (queue.length === 0)
        continue;
      if (!this.canRunDomain(domain))
        continue;
      const task = queue.shift();
      this.runHttpTask(task);
    }
  }
  async runHttpTask(task) {
    const domain = task.domain ?? "default";
    const pending = (this.domainPending.get(domain) ?? 0) + 1;
    this.domainPending.set(domain, pending);
    this.ensureDomainStats(domain);
    this.httpStatsData.byDomain[domain].pending++;
    this.emitHttp("start", { id: task.id });
    const startTime = Date.now();
    let timeoutId;
    try {
      let result;
      if (task.timeout && task.timeout > 0) {
        result = await Promise.race([
          task.fn(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              this.emitHttp("timeout", { id: task.id });
              reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
            }, task.timeout);
          })
        ]);
      } else {
        result = await task.fn();
      }
      if (timeoutId)
        clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      this.httpStatsData.byDomain[domain].completed++;
      this.emitHttp("completed", { id: task.id, result, duration });
      task.resolve(result);
    } catch (error) {
      if (timeoutId)
        clearTimeout(timeoutId);
      const shouldRetry = task.retryCount < task.maxRetries;
      if (shouldRetry) {
        task.retryCount++;
        this.httpStatsData.retries++;
        const delay = this.getRetryDelay(task);
        this.emitHttp("retry", {
          id: task.id,
          attempt: task.retryCount,
          error
        });
        setTimeout(() => {
          this.insertHttpTask(task);
          this.tryRunHttpNext();
        }, delay);
      } else {
        this.httpStatsData.byDomain[domain].failed++;
        this.emitHttp("error", { id: task.id, error });
        task.reject(error);
      }
    } finally {
      const newPending = (this.domainPending.get(domain) ?? 1) - 1;
      this.domainPending.set(domain, newPending);
      this.httpStatsData.byDomain[domain].pending = newPending;
      this.tryRunHttpNext();
    }
  }
  getRetryDelay(task) {
    if (task.retryDelay !== undefined) {
      return task.retryDelay;
    }
    const baseDelay = typeof this.httpConfig.retryDelay === "function" ? this.httpConfig.retryDelay(task.retryCount) : this.httpConfig.retryDelay;
    return baseDelay * Math.pow(2, task.retryCount - 1);
  }
  ensureDomainStats(domain) {
    if (!this.httpStatsData.byDomain[domain]) {
      this.httpStatsData.byDomain[domain] = {
        pending: 0,
        completed: 0,
        failed: 0,
        rateLimited: 0
      };
    }
  }
  emitHttp(event, data) {
    const handlers = this.httpEventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {}
      }
    }
    if (event in this.config) {
      this.emit(event, data);
    }
  }
}

export { extractDomain };
