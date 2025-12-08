function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

class RezoQueue {
  queue = [];
  pendingCount = 0;
  isPausedFlag = false;
  intervalId;
  intervalCount = 0;
  intervalStart = 0;
  eventHandlers = new Map;
  statsData = {
    added: 0,
    processed: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    averageDuration: 0,
    throughput: 0
  };
  totalDuration = 0;
  throughputWindow = [];
  throughputWindowSize = 60;
  idlePromise;
  emptyPromise;
  config;
  constructor(config = {}) {
    this.config = {
      concurrency: config.concurrency ?? 1 / 0,
      autoStart: config.autoStart ?? true,
      timeout: config.timeout ?? 0,
      throwOnTimeout: config.throwOnTimeout ?? true,
      interval: config.interval ?? 0,
      intervalCap: config.intervalCap ?? 1 / 0,
      carryoverConcurrencyCount: config.carryoverConcurrencyCount ?? false
    };
    if (!this.config.autoStart) {
      this.isPausedFlag = true;
    }
    if (this.config.interval > 0) {
      this.startInterval();
    }
  }
  get state() {
    return {
      pending: this.pendingCount,
      size: this.queue.length,
      total: this.pendingCount + this.queue.length,
      isPaused: this.isPausedFlag,
      isIdle: this.pendingCount === 0 && this.queue.length === 0
    };
  }
  get stats() {
    return { ...this.statsData };
  }
  get concurrency() {
    return this.config.concurrency;
  }
  set concurrency(value) {
    this.config.concurrency = value;
    this.tryRunNext();
  }
  get pending() {
    return this.pendingCount;
  }
  get size() {
    return this.queue.length;
  }
  get isPaused() {
    return this.isPausedFlag;
  }
  add(fn, options = {}) {
    return new Promise((resolve, reject) => {
      const task = {
        id: options.id ?? generateId(),
        fn,
        priority: options.priority ?? 0,
        timeout: options.timeout ?? this.config.timeout,
        signal: options.signal,
        resolve,
        reject,
        addedAt: Date.now()
      };
      if (options.signal?.aborted) {
        reject(new Error("Task was cancelled before starting"));
        return;
      }
      options.signal?.addEventListener("abort", () => {
        this.cancel(task.id);
      });
      this.insertByPriority(task);
      this.statsData.added++;
      this.emit("add", { id: task.id, priority: task.priority });
      if (this.config.autoStart && !this.isPausedFlag) {
        this.tryRunNext();
      }
    });
  }
  addAll(fns, options = {}) {
    return Promise.all(fns.map((fn, i) => this.add(fn, { ...options, id: options.id ? `${options.id}-${i}` : undefined })));
  }
  pause() {
    if (!this.isPausedFlag) {
      this.isPausedFlag = true;
      this.emit("paused", undefined);
    }
  }
  start() {
    if (this.isPausedFlag) {
      this.isPausedFlag = false;
      this.emit("resumed", undefined);
      this.tryRunNext();
    }
  }
  clear() {
    const tasks = [...this.queue];
    this.queue = [];
    for (const task of tasks) {
      task.reject(new Error("Queue was cleared"));
      this.statsData.cancelled++;
      this.emit("cancelled", { id: task.id });
    }
    this.checkEmpty();
  }
  cancel(id) {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index !== -1) {
      const [task] = this.queue.splice(index, 1);
      task.reject(new Error("Task was cancelled"));
      this.statsData.cancelled++;
      this.emit("cancelled", { id });
      this.checkEmpty();
      return true;
    }
    return false;
  }
  cancelBy(predicate) {
    let count = 0;
    const remaining = [];
    for (const task of this.queue) {
      if (predicate({ id: task.id, priority: task.priority })) {
        task.reject(new Error("Task was cancelled"));
        this.statsData.cancelled++;
        this.emit("cancelled", { id: task.id });
        count++;
      } else {
        remaining.push(task);
      }
    }
    this.queue = remaining;
    if (count > 0) {
      this.checkEmpty();
    }
    return count;
  }
  onIdle() {
    if (this.state.isIdle) {
      return Promise.resolve();
    }
    if (!this.idlePromise) {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      this.idlePromise = { promise, resolve: resolvePromise };
    }
    return this.idlePromise.promise;
  }
  onEmpty() {
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    if (!this.emptyPromise) {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      this.emptyPromise = { promise, resolve: resolvePromise };
    }
    return this.emptyPromise.promise;
  }
  onSizeLessThan(limit) {
    if (this.queue.length < limit) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length < limit) {
          this.off("completed", check);
          this.off("cancelled", check);
          this.off("error", check);
          resolve();
        }
      };
      this.on("completed", check);
      this.on("cancelled", check);
      this.on("error", check);
    });
  }
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set);
    }
    this.eventHandlers.get(event).add(handler);
  }
  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }
  destroy() {
    this.clear();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.eventHandlers.clear();
  }
  insertByPriority(task) {
    let insertIndex = this.queue.length;
    for (let i = 0;i < this.queue.length; i++) {
      if (task.priority > this.queue[i].priority) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, task);
  }
  tryRunNext() {
    if (this.isPausedFlag)
      return;
    if (this.queue.length === 0)
      return;
    if (this.pendingCount >= this.config.concurrency)
      return;
    if (this.config.interval > 0) {
      if (this.intervalCount >= this.config.intervalCap)
        return;
      this.intervalCount++;
    }
    const task = this.queue.shift();
    this.runTask(task);
    this.tryRunNext();
  }
  async runTask(task) {
    this.pendingCount++;
    this.statsData.processed++;
    const wasIdle = this.pendingCount === 1 && this.queue.length === 0;
    if (wasIdle) {
      this.emit("active", undefined);
    }
    this.emit("start", { id: task.id });
    this.emit("next", undefined);
    const startTime = Date.now();
    let timeoutId;
    try {
      let result;
      if (task.timeout && task.timeout > 0) {
        result = await Promise.race([
          task.fn(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              this.statsData.timedOut++;
              this.emit("timeout", { id: task.id });
              if (this.config.throwOnTimeout) {
                reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
              }
            }, task.timeout);
          })
        ]);
      } else {
        result = await task.fn();
      }
      if (timeoutId)
        clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      this.recordDuration(duration);
      this.statsData.completed++;
      this.emit("completed", { id: task.id, result, duration });
      task.resolve(result);
    } catch (error) {
      if (timeoutId)
        clearTimeout(timeoutId);
      this.statsData.failed++;
      this.emit("error", { id: task.id, error });
      task.reject(error);
    } finally {
      this.pendingCount--;
      this.checkEmpty();
      this.checkIdle();
      this.tryRunNext();
    }
  }
  recordDuration(duration) {
    this.totalDuration += duration;
    this.statsData.averageDuration = this.totalDuration / this.statsData.completed;
    const now = Date.now();
    this.throughputWindow.push(now);
    const windowStart = now - this.throughputWindowSize * 1000;
    this.throughputWindow = this.throughputWindow.filter((t) => t > windowStart);
    this.statsData.throughput = this.throughputWindow.length / this.throughputWindowSize;
  }
  startInterval() {
    this.intervalStart = Date.now();
    this.intervalCount = 0;
    this.intervalId = setInterval(() => {
      if (!this.config.carryoverConcurrencyCount) {
        this.intervalCount = 0;
      } else {
        this.intervalCount = Math.max(0, this.intervalCount - this.config.intervalCap);
      }
      this.intervalStart = Date.now();
      this.tryRunNext();
    }, this.config.interval);
  }
  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {}
      }
    }
  }
  checkEmpty() {
    if (this.queue.length === 0) {
      this.emit("empty", undefined);
      if (this.emptyPromise) {
        this.emptyPromise.resolve();
        this.emptyPromise = undefined;
      }
    }
  }
  checkIdle() {
    if (this.state.isIdle) {
      this.emit("idle", undefined);
      if (this.idlePromise) {
        this.idlePromise.resolve();
        this.idlePromise = undefined;
      }
    }
  }
}

exports.RezoQueue = RezoQueue;