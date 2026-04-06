const { RezoHeaders } = require('./headers.cjs');
const DEFAULT_WAIT_STATUS_CODES = exports.DEFAULT_WAIT_STATUS_CODES = [429];
const DEFAULT_MAX_WAIT_TIME = exports.DEFAULT_MAX_WAIT_TIME = 60000;
const DEFAULT_WAIT_TIME = exports.DEFAULT_WAIT_TIME = 1000;
const DEFAULT_MAX_WAIT_ATTEMPTS = exports.DEFAULT_MAX_WAIT_ATTEMPTS = 3;
function shouldWaitOnStatus(status, waitOnStatus) {
  if (!waitOnStatus)
    return false;
  if (waitOnStatus === true) {
    return DEFAULT_WAIT_STATUS_CODES.includes(status);
  }
  if (Array.isArray(waitOnStatus)) {
    return waitOnStatus.includes(status);
  }
  return false;
}
function parseRetryAfterHeader(value) {
  if (!value)
    return null;
  const trimmed = value.trim();
  const seconds = parseInt(trimmed, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }
  return null;
}
function getNestedValue(obj, path) {
  if (!obj || typeof path !== "string")
    return;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined)
      return;
    if (typeof current !== "object")
      return;
    current = current[part];
  }
  return current;
}
function extractWaitTime(response, options) {
  const source = options.waitTimeSource ?? "retry-after";
  const defaultWaitTime = options.defaultWaitTime ?? DEFAULT_WAIT_TIME;
  if (typeof source === "function") {
    try {
      const seconds = source(response);
      if (seconds !== null && seconds !== undefined && seconds > 0) {
        return {
          waitTimeMs: seconds * 1000,
          source: "function"
        };
      }
    } catch {}
    return {
      waitTimeMs: defaultWaitTime,
      source: "default"
    };
  }
  if (source === "retry-after") {
    const headerValue = response.headers?.get?.("retry-after") ?? response.headers?.get?.("Retry-After") ?? response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
    const waitTimeMs = parseRetryAfterHeader(headerValue);
    if (waitTimeMs !== null) {
      return {
        waitTimeMs,
        source: "header",
        sourcePath: "retry-after"
      };
    }
    return {
      waitTimeMs: defaultWaitTime,
      source: "default"
    };
  }
  if (typeof source === "object" && "header" in source) {
    const headerName = source.header;
    const headerValue = response.headers?.get?.(headerName) ?? response.headers?.get?.(headerName.toLowerCase()) ?? response.headers?.[headerName] ?? response.headers?.[headerName.toLowerCase()];
    if (headerValue) {
      const numValue = parseInt(headerValue, 10);
      if (!isNaN(numValue)) {
        const now = Math.floor(Date.now() / 1000);
        if (numValue > now && numValue < now + 86400 * 365) {
          const waitTimeMs = (numValue - now) * 1000;
          return {
            waitTimeMs: waitTimeMs > 0 ? waitTimeMs : defaultWaitTime,
            source: "header",
            sourcePath: headerName
          };
        }
        return {
          waitTimeMs: numValue * 1000,
          source: "header",
          sourcePath: headerName
        };
      }
      const waitTimeMs = parseRetryAfterHeader(headerValue);
      if (waitTimeMs !== null) {
        return {
          waitTimeMs,
          source: "header",
          sourcePath: headerName
        };
      }
    }
    return {
      waitTimeMs: defaultWaitTime,
      source: "default"
    };
  }
  if (typeof source === "object" && "body" in source) {
    const bodyPath = source.body;
    const value = getNestedValue(response.data, bodyPath);
    if (value !== null && value !== undefined) {
      const numValue = typeof value === "number" ? value : parseInt(String(value), 10);
      if (!isNaN(numValue) && numValue > 0) {
        return {
          waitTimeMs: numValue * 1000,
          source: "body",
          sourcePath: bodyPath
        };
      }
    }
    return {
      waitTimeMs: defaultWaitTime,
      source: "default"
    };
  }
  return {
    waitTimeMs: defaultWaitTime,
    source: "default"
  };
}
function createRateLimitWaitEvent(status, waitTimeMs, attempt, maxAttempts, source, sourcePath, url, method) {
  return {
    status,
    waitTime: waitTimeMs,
    attempt,
    maxAttempts,
    source,
    sourcePath,
    url,
    method,
    timestamp: Date.now()
  };
}
async function executeRateLimitWaitHooks(event, config) {
  const hooks = config.hooks?.onRateLimitWait;
  if (!hooks || hooks.length === 0)
    return;
  for (const hook of hooks) {
    try {
      await hook(event, config);
    } catch (err) {
      if (config.debug) {
        console.log("[Rezo Debug] onRateLimitWait hook error:", err);
      }
    }
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeHeaders(headers) {
  if (!headers)
    return new RezoHeaders;
  if (headers instanceof RezoHeaders)
    return headers;
  if (typeof headers.get === "function")
    return headers;
  try {
    return new RezoHeaders(headers);
  } catch {
    return new RezoHeaders;
  }
}
async function handleRateLimitWait(ctx) {
  const { status, headers, data, url, method, config, options, currentWaitAttempt } = ctx;
  if (!shouldWaitOnStatus(status, options.waitOnStatus)) {
    return { shouldRetry: false, waitAttempt: currentWaitAttempt, waitedMs: 0 };
  }
  const maxAttempts = options.maxWaitAttempts ?? DEFAULT_MAX_WAIT_ATTEMPTS;
  const maxWaitTime = options.maxWaitTime ?? DEFAULT_MAX_WAIT_TIME;
  const nextAttempt = currentWaitAttempt + 1;
  if (nextAttempt > maxAttempts) {
    return { shouldRetry: false, waitAttempt: currentWaitAttempt, waitedMs: 0 };
  }
  const normalizedHeaders = normalizeHeaders(headers);
  const extracted = extractWaitTime({ status, headers: normalizedHeaders, data }, options);
  let waitTimeMs = extracted.waitTimeMs;
  if (maxWaitTime > 0 && waitTimeMs > maxWaitTime) {
    return { shouldRetry: false, waitAttempt: currentWaitAttempt, waitedMs: 0 };
  }
  const event = createRateLimitWaitEvent(status, waitTimeMs, nextAttempt, maxAttempts, extracted.source, extracted.sourcePath, url, method);
  await executeRateLimitWaitHooks(event, config);
  if (config.debug) {
    console.log(`[Rezo Debug] Rate limit (${status}) - waiting ${waitTimeMs}ms (attempt ${nextAttempt}/${maxAttempts}, source: ${extracted.source}${extracted.sourcePath ? `:${extracted.sourcePath}` : ""})`);
  }
  await sleep(waitTimeMs);
  return {
    shouldRetry: true,
    waitAttempt: nextAttempt,
    waitedMs: waitTimeMs
  };
}

exports.shouldWaitOnStatus = shouldWaitOnStatus;
exports.parseRetryAfterHeader = parseRetryAfterHeader;
exports.getNestedValue = getNestedValue;
exports.extractWaitTime = extractWaitTime;
exports.createRateLimitWaitEvent = createRateLimitWaitEvent;
exports.executeRateLimitWaitHooks = executeRateLimitWaitHooks;
exports.sleep = sleep;
exports.handleRateLimitWait = handleRateLimitWait;