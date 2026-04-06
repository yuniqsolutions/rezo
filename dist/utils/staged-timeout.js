import { RezoError } from '../errors/rezo-error.js';

export class StagedTimeoutManager {
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
    const elapsed = Date.now() - phase.startTime;
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
    const phaseMessages = {
      connect: `Connection timeout: Failed to establish TCP connection within ${elapsed}ms`,
      headers: `Headers timeout: Server did not send response headers within ${elapsed}ms`,
      body: `Body timeout: Response body transfer stalled for ${elapsed}ms`,
      total: `Total timeout: Request exceeded maximum duration of ${elapsed}ms`
    };
    const message = phaseMessages[phaseName] || `Timeout in ${phaseName} phase after ${elapsed}ms`;
    const error = new RezoError(message, this.config || {}, phaseName === "connect" ? "ETIMEDOUT" : phaseName === "headers" ? "ESOCKETTIMEDOUT" : "ECONNRESET", this.requestConfig || undefined);
    error.phase = phaseName;
    error.elapsed = elapsed;
    error.isRetryable = phaseName === "connect" || phaseName === "headers";
    return error;
  }
  getPhaseTimeout(phaseName) {
    return this.phases.get(phaseName)?.timeout;
  }
  hasPhase(phaseName) {
    return this.phases.has(phaseName);
  }
}
export function parseStagedTimeouts(timeout) {
  if (!timeout) {
    return {};
  }
  if (typeof timeout === "number") {
    return {
      total: timeout,
      connect: Math.min(timeout, 1e4),
      headers: Math.min(timeout, 30000)
    };
  }
  return timeout;
}
export default StagedTimeoutManager;
