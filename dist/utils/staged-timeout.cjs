const { createStagedTimeoutError } = require('../shared/create-staged-timeout-error.cjs');

class StagedTimeoutManager {
  phases = new Map;
  socket = null;
  request = null;
  abortController = null;
  config = null;
  requestConfig = null;
  onTimeout = null;
  constructor(timeoutConfig, config, requestConfig) {
    this.config = config || null;
    this.requestConfig = requestConfig || null;
    if (timeoutConfig.connect) {
      this.phases.set("connect", {
        name: "connect",
        timeout: timeoutConfig.connect,
        timer: null,
        startTime: 0
      });
    }
    if (timeoutConfig.headers) {
      this.phases.set("headers", {
        name: "headers",
        timeout: timeoutConfig.headers,
        timer: null,
        startTime: 0
      });
    }
    if (timeoutConfig.body) {
      this.phases.set("body", {
        name: "body",
        timeout: timeoutConfig.body,
        timer: null,
        startTime: 0
      });
    }
    if (timeoutConfig.total) {
      this.phases.set("total", {
        name: "total",
        timeout: timeoutConfig.total,
        timer: null,
        startTime: 0
      });
    }
  }
  setSocket(socket) {
    this.socket = socket;
  }
  setRequest(request) {
    this.request = request;
  }
  setAbortController(controller) {
    this.abortController = controller;
  }
  setTimeoutCallback(callback) {
    this.onTimeout = callback;
  }
  startPhase(phaseName) {
    const phase = this.phases.get(phaseName);
    if (!phase)
      return;
    this.clearPhase(phaseName);
    phase.startTime = Date.now();
    phase.timer = setTimeout(() => {
      this.handleTimeout(phaseName);
    }, phase.timeout);
    if (typeof phase.timer === "object" && typeof phase.timer.unref === "function")
      phase.timer.unref();
  }
  clearPhase(phaseName) {
    const phase = this.phases.get(phaseName);
    if (phase?.timer) {
      clearTimeout(phase.timer);
      phase.timer = null;
    }
  }
  clearAll() {
    for (const phaseName of this.phases.keys()) {
      this.clearPhase(phaseName);
    }
  }
  handleTimeout(phaseName) {
    const phase = this.phases.get(phaseName);
    if (!phase)
      return;
    const elapsed = Math.max(phase.timeout, Date.now() - phase.startTime);
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
    }
    if (this.request) {
      try {
        this.request.destroy();
      } catch {}
    }
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
    }
    if (this.onTimeout) {
      this.onTimeout(phaseName, elapsed);
    }
  }
  createTimeoutError(phaseName, elapsed) {
    return createStagedTimeoutError(phaseName, elapsed, this.config || {}, this.requestConfig || undefined);
  }
  getPhaseTimeout(phaseName) {
    return this.phases.get(phaseName)?.timeout;
  }
  overduePhase() {
    const now = Date.now();
    let earliest;
    for (const [name, phase] of this.phases) {
      if (!phase.timer)
        continue;
      const dueAt = phase.startTime + phase.timeout;
      if (now < dueAt)
        continue;
      if (!earliest || dueAt < earliest.dueAt)
        earliest = { phase: name, elapsed: Math.max(phase.timeout, now - phase.startTime), dueAt };
    }
    return earliest;
  }
  hasPhase(phaseName) {
    return this.phases.has(phaseName);
  }
}
function parseStagedTimeouts(timeout) {
  if (!timeout) {
    return {};
  }
  if (typeof timeout === "number") {
    return timeout > 0 ? { total: timeout } : {};
  }
  return timeout;
}
function resolveTimeoutMs(timeout) {
  if (timeout == null)
    return;
  if (typeof timeout === "number")
    return timeout;
  return timeout.total ?? timeout.body ?? timeout.headers ?? timeout.connect ?? undefined;
}

exports.StagedTimeoutManager = StagedTimeoutManager;
exports.parseStagedTimeouts = parseStagedTimeouts;
exports.resolveTimeoutMs = resolveTimeoutMs;
exports.default = StagedTimeoutManager;
module.exports = Object.assign(StagedTimeoutManager, exports);