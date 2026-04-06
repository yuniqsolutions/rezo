function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

class RezoQueue {
  queue = [];
  pendingCount = 0;
  isPausedFlag = false;
  intervalId;
  intervalCount = 0;
  name;
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
  hasEverBeenActive = false;
  config;
  constructor(config = {}) {
    this.name = config.name ?? `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    this.config = {
      name: this.name,
      concurrency: config.concurrency ?? 1 / 0,
      autoStart: config.autoStart ?? true,
      timeout: config.timeout ?? 0,
      throwOnTimeout: config.throwOnTimeout ?? true,
      interval: config.interval ?? 0,
      intervalCap: config.intervalCap ?? 1 / 0,
      carryoverConcurrencyCount: config.carryoverConcurrencyCount ?? false,
      rejectOnError: config.rejectOnError ?? true
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
      let abortHandler;
      if (options.signal) {
        abortHandler = () => this.cancel(task.id);
        options.signal.addEventListener("abort", abortHandler, { once: true });
        task._abortHandler = abortHandler;
        task._signal = options.signal;
      }
      this.insertByPriority(task);
      this.statsData.added++;
      this.hasEverBeenActive = true;
      this.emit("add", { id: task.id, priority: task.priority });
      if (this.config.interval > 0 && !this.intervalId) {
        this.startInterval();
      }
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
      if (this.config.rejectOnError) {
        task.reject(new Error("Queue was cleared"));
      } else {
        task.resolve(undefined);
      }
      this.statsData.cancelled++;
      this.emit("cancelled", { id: task.id });
    }
    this.clearIntervalTimer();
    this.checkEmpty();
    if (this.pendingCount === 0) {
      this.checkIdle();
    }
  }
  cancel(id) {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index !== -1) {
      const [task] = this.queue.splice(index, 1);
      if (this.config.rejectOnError) {
        task.reject(new Error("Task was cancelled"));
      } else {
        task.resolve(undefined);
      }
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
        if (this.config.rejectOnError) {
          task.reject(new Error("Task was cancelled"));
        } else {
          task.resolve(undefined);
        }
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
    if (this.hasEverBeenActive && this.state.isIdle) {
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
  onSizeLessThan(limit, timeoutMs = 0) {
    if (this.queue.length < limit) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timeoutId;
      const cleanup = () => {
        this.off("completed", check);
        this.off("cancelled", check);
        this.off("error", check);
        this.off("empty", check);
        if (timeoutId)
          clearTimeout(timeoutId);
      };
      const check = () => {
        if (this.queue.length < limit) {
          cleanup();
          resolve();
        }
      };
      this.on("completed", check);
      this.on("cancelled", check);
      this.on("error", check);
      this.on("empty", check);
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve();
        }, timeoutMs);
      }
    });
  }
  static MAX_HANDLERS_WARNING = 100;
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set);
    }
    const handlers = this.eventHandlers.get(event);
    handlers.add(handler);
    if (handlers.size === RezoQueue.MAX_HANDLERS_WARNING) {
      console.warn(`[RezoQueue] Warning: ${handlers.size} handlers registered for '${String(event)}' event. ` + `This may indicate a memory leak. Consider using off() to remove handlers when done.`);
    }
  }
  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }
  destroy() {
    this.clear();
    this.clearIntervalTimer();
    this.eventHandlers.clear();
  }
  insertByPriority(task) {
    if (task.priority === 0 && (this.queue.length === 0 || this.queue[this.queue.length - 1].priority >= 0)) {
      this.queue.push(task);
      return;
    }
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
      return false;
    if (this.queue.length === 0) {
      this.clearIntervalTimer();
      this.checkEmpty();
      if (this.pendingCount === 0) {
        this.checkIdle();
      }
      return false;
    }
    if (this.pendingCount >= this.config.concurrency)
      return false;
    if (this.config.interval > 0) {
      if (this.intervalCount >= this.config.intervalCap)
        return false;
      this.intervalCount++;
    }
    const task = this.queue.shift();
    this.runTask(task);
    this.tryRunNext();
    return true;
  }
  clearIntervalTimer() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
  async runTask(task) {
    this.pendingCount++;
    this.statsData.processed++;
    const wasIdle = this.pendingCount === 1 && this.queue.length === 0;
    if (wasIdle) {
      this.emit("active", undefined);
    }
    this.emit("start", { id: task.id });
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
      if (this.config.rejectOnError) {
        task.reject(error);
      } else {
        task.resolve(undefined);
      }
    } finally {
      if (task._abortHandler && task._signal) {
        task._signal.removeEventListener("abort", task._abortHandler);
        delete task._abortHandler;
        delete task._signal;
      }
      queueMicrotask(() => {
        this.pendingCount--;
        this.tryRunNext();
        this.emit("next", undefined);
      });
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