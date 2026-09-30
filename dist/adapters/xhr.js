import { assertInputTransport } from '../utils/request-fetch-options.js';
import { resolveResponseType } from '../shared/resolve-response-type.js';
import { isStreamBody, isRawBody } from '../utils/request-body.js';
import { takeCoreCacheOwnership } from '../cache/response-cache-ownership.js';
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse, buildRedirectControlError } from '../responses/buildError.js';
import RezoFormData from '../utils/form-data.js';
import { settleFacadeError } from '../core/hooks.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { RezoPerformance } from '../utils/tools.js';
import { sanitizeConfig } from '../responses/sanitize-config.js';
import { ResponseCache } from '../cache/universal-response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
import { parseStagedTimeouts, resolveTimeoutMs } from '../utils/staged-timeout.js';
import { containLifecycleHook } from '../shared/contain-lifecycle-hook.js';
import { createStagedTimeoutError } from '../shared/create-staged-timeout-error.js';
import { createTotalDeadline } from '../shared/create-total-deadline.js';
import { debugErrorDump } from '../utils/debug-error-dump.js';
import {
  collectRedirectGuarantees,
  formatUnsupportedRedirectCapabilities,
  hiddenRedirectVisibility,
  registerAdapterCapabilities,
  visibleRedirectVisibility
} from '../core/adapter-capabilities.js';
const Environment = {
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  hasXHR: typeof XMLHttpRequest !== "undefined",
  hasFormData: typeof FormData !== "undefined",
  hasBlob: typeof Blob !== "undefined"
};
function evaluateXHRRedirectVisibility() {
  return Environment.hasXHR ? hiddenRedirectVisibility("xhr") : visibleRedirectVisibility();
}
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      console.log(`[Rezo Debug] Adapter: xhr`);
      if (config.originalRequest?.headers) {
        const headers = config.originalRequest.headers instanceof RezoHeaders ? config.originalRequest.headers.toObject() : config.originalRequest.headers;
        console.log(`[Rezo Debug] Request Headers:`, JSON.stringify(headers, null, 2));
      }
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track] → ${method} ${url}`);
    }
  },
  retry: (config, attempt, maxRetries, statusCode, delay) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Retry ${attempt}/${maxRetries} after status ${statusCode}${delay > 0 ? ` (waiting ${delay}ms)` : ""}`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ⟳ Retry ${attempt}/${maxRetries} (status ${statusCode})`);
    }
  },
  maxRetries: (config, maxRetries) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Max retries (${maxRetries}) reached, throwing error`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ✗ Max retries reached`);
    }
  },
  response: (config, status, statusText, duration) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Response: ${status} ${statusText} (${duration.toFixed(2)}ms)`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track] ✓ ${status} ${statusText}`);
    }
  },
  responseHeaders: (config, headers) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Response Headers:`, JSON.stringify(headers, null, 2));
    }
  },
  cookies: (config, cookieCount) => {
    if (config.debug && cookieCount > 0) {
      console.log(`[Rezo Debug] Cookies received: ${cookieCount}`);
    }
  },
  timing: (config, timing) => {
    if (config.debug) {
      const parts = [];
      if (timing.ttfb)
        parts.push(`TTFB: ${timing.ttfb.toFixed(2)}ms`);
      if (timing.total)
        parts.push(`Total: ${timing.total.toFixed(2)}ms`);
      if (parts.length > 0) {
        console.log(`[Rezo Debug] Timing: ${parts.join(" | ")}`);
      }
    }
  },
  complete: (config, url) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Request complete: ${url}`);
      console.log(`[Rezo Debug] ─────────────────────────────────────
`);
    }
  },
  error: (config, error) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Error: ${error instanceof Error ? error.message : error}`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ✗ Error: ${error instanceof Error ? error.message : error}`);
    }
  }
};
function updateTiming(config, timing, bodySize) {
  const now = performance.now();
  config.timing.domainLookupStart = config.timing.startTime;
  config.timing.domainLookupEnd = config.timing.startTime;
  config.timing.connectStart = config.timing.startTime;
  config.timing.secureConnectionStart = 0;
  config.timing.connectEnd = config.timing.startTime;
  config.timing.requestStart = config.timing.startTime;
  config.timing.responseStart = timing.firstByteTime || config.timing.startTime;
  config.timing.responseEnd = now;
  config.transfer.bodySize = bodySize;
  config.transfer.responseSize = bodySize;
}
function getTimingDurations(config) {
  const t = config.timing;
  return {
    total: t.responseEnd - t.startTime,
    dns: t.domainLookupEnd - t.domainLookupStart,
    tcp: t.secureConnectionStart > 0 ? t.secureConnectionStart - t.connectStart : t.connectEnd - t.connectStart,
    tls: t.secureConnectionStart > 0 ? t.connectEnd - t.secureConnectionStart : undefined,
    firstByte: t.responseStart - t.startTime,
    download: t.responseEnd - t.responseStart
  };
}
const responseCacheInstances = new Map;
function getCacheConfigKey(option) {
  if (option === true)
    return "default";
  if (option === false)
    return "disabled";
  const cfg = option;
  return JSON.stringify({
    cacheDir: cfg.cacheDir || null,
    ttl: cfg.ttl || 300000,
    maxEntries: cfg.maxEntries || 500,
    methods: cfg.methods || ["GET", "HEAD"],
    respectHeaders: cfg.respectHeaders !== false
  });
}
function getResponseCache(option) {
  const key = getCacheConfigKey(option);
  let cache = responseCacheInstances.get(key);
  if (!cache) {
    cache = new ResponseCache(option);
    responseCacheInstances.set(key, cache);
  }
  return cache;
}
function parseCacheControlFromHeaders(headers) {
  const cacheControl = headers["cache-control"] || "";
  return {
    noCache: cacheControl.includes("no-cache"),
    mustRevalidate: cacheControl.includes("must-revalidate")
  };
}
function buildCachedRezoResponse(cached, config) {
  const headers = new RezoHeaders(cached.headers);
  return {
    data: cached.data,
    status: cached.status,
    statusText: cached.statusText,
    headers,
    finalUrl: cached.url,
    urls: [cached.url],
    contentType: cached.headers["content-type"],
    contentLength: parseInt(cached.headers["content-length"] || "0", 10) || 0,
    cookies: {
      array: [],
      serialized: [],
      netscape: "",
      string: "",
      setCookiesString: []
    },
    config: {
      ...config,
      url: cached.url,
      method: "GET",
      headers,
      adapterUsed: "xhr",
      fromCache: true
    }
  };
}
function buildUrlTree(config, finalUrl) {
  const urls = [];
  if (config.rawUrl) {
    urls.push(config.rawUrl);
  } else if (config.url) {
    const urlStr = typeof config.url === "string" ? config.url : String(config.url);
    urls.push(urlStr);
  }
  if (config.redirectHistory && config.redirectHistory.length > 0) {
    for (const redirect of config.redirectHistory) {
      const redirectUrl = typeof redirect.url === "string" ? redirect.url : redirect.url?.toString?.() || "";
      if (redirectUrl && urls[urls.length - 1] !== redirectUrl) {
        urls.push(redirectUrl);
      }
    }
  }
  if (finalUrl && (urls.length === 0 || urls[urls.length - 1] !== finalUrl)) {
    urls.push(finalUrl);
  }
  return urls.length > 0 ? urls : [finalUrl];
}
function parseXHRHeaders(xhr) {
  const headerString = xhr.getAllResponseHeaders();
  const headers = {};
  if (headerString) {
    const lines = headerString.trim().split(`\r
`);
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
  }
  return new RezoHeaders(headers);
}
function createEmptyXHRCookies() {
  return {
    array: [],
    serialized: [],
    netscape: "",
    string: "",
    setCookiesString: []
  };
}
function prepareXHRBody(body) {
  if (body === undefined || body === null)
    return null;
  if (typeof body === "number" || typeof body === "boolean")
    return String(body);
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return body.toString();
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return body;
  }
  if (body instanceof RezoFormData) {
    return body.toNativeFormData();
  }
  if (isRawBody(body)) {
    return body;
  }
  if (typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    return JSON.stringify(body);
  }
  return body;
}
function isXHRJsonContentType(contentType) {
  const essence = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return essence === "application/json" || essence.endsWith("+json");
}
function notifyXHRProgressCallback(callback, event, config, label) {
  if (typeof callback !== "function")
    return;
  try {
    const result = callback(event);
    if (result !== null && typeof result === "object" && "then" in result) {
      Promise.resolve(result).catch((error) => {
        debugLog.error(config, error instanceof Error ? error : new Error(String(error)));
      });
    }
  } catch (error) {
    debugLog.error(config, error instanceof Error ? error : new Error(`${label} progress callback failed: ${String(error)}`));
  }
}
function createXHRAttemptPublication(deferred) {
  const actions = [];
  let active = true;
  return {
    enqueue(action) {
      if (!active)
        return;
      if (deferred)
        actions.push(action);
      else
        action();
    },
    publish() {
      if (!active)
        return;
      active = false;
      for (const action of actions)
        action();
      actions.length = 0;
    },
    discard() {
      if (!active)
        return;
      active = false;
      actions.length = 0;
    }
  };
}
function notifyXHRAbortHooksOnce(config, request, lifecycle, message) {
  if (lifecycle.abortHookNotified)
    return;
  lifecycle.abortHookNotified = true;
  const event = {
    reason: "signal",
    message,
    url: String(request.fullUrl ?? request.url ?? ""),
    elapsed: performance.now() - lifecycle.startedAt,
    timestamp: Date.now()
  };
  for (const hook of config.hooks?.onAbort ?? []) {
    containLifecycleHook(() => hook({ ...event }, config), (error) => {
      if (config.debug)
        console.log("[Rezo Debug] onAbort hook error:", error);
    });
  }
}
function notifyXHRTimeoutHooksOnce(config, request, lifecycle, phase, elapsed) {
  if (lifecycle.timeoutHookNotified)
    return;
  lifecycle.timeoutHookNotified = true;
  const staged = parseStagedTimeouts(request.timeout);
  const configuredTimeout = staged[phase] ?? elapsed;
  const event = {
    type: phase === "total" ? "request" : phase === "connect" ? "connect" : "response",
    timeout: configuredTimeout,
    elapsed,
    url: String(request.fullUrl ?? request.url ?? ""),
    timestamp: Date.now()
  };
  for (const hook of config.hooks?.onTimeout ?? []) {
    containLifecycleHook(() => hook({ ...event }, config), (error) => {
      if (config.debug)
        console.log("[Rezo Debug] onTimeout hook error:", error);
    });
  }
}
function createXHRTotalDeadline(timeout) {
  const { total } = parseStagedTimeouts(timeout);
  return typeof total === "number" && total > 0 ? createTotalDeadline(total) : undefined;
}
function createXHRPrematureCloseError(config, request, receivedBytes, expectedBytes) {
  const cause = new Error(`XHR response ended after ${receivedBytes} bytes; Content-Length declared ${expectedBytes}`);
  const error = new RezoError("Response body ended before the declared Content-Length was received", config, "ERR_STREAM_PREMATURE_CLOSE", request);
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  Object.defineProperty(error, "receivedBytes", { value: receivedBytes, enumerable: true });
  Object.defineProperty(error, "expectedBytes", { value: expectedBytes, enumerable: true });
  return error;
}
function toXHRHeaders(headers) {
  if (!headers)
    return {};
  if (headers instanceof RezoHeaders) {
    return headers.toObject();
  }
  return headers;
}
export async function executeRequest(options, defaultOptions, jar) {
  const coreDispatchIdentity = options;
  const canonicalResponseType = resolveResponseType(options.responseType, defaultOptions?.responseType, options);
  if (options.responseType !== canonicalResponseType) {
    options = { ...options, responseType: canonicalResponseType };
  }
  assertInputTransport(options, defaultOptions, "xhr");
  const d_options = await getDefaultConfig(defaultOptions);
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  if (!Environment.hasXHR) {
    throw new RezoError("XMLHttpRequest is not available in this environment", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const preparedHeaders = toXHRHeaders(fetchOptions.headers);
  if (Object.keys(preparedHeaders).some((name) => name.toLowerCase() === "cookie")) {
    throw new RezoError("The browser-owned XHR lane cannot set an explicit Cookie request header", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const requestedProxy = fetchOptions.proxy ?? options.proxy ?? mainConfig.proxy;
  const proxyPool = defaultOptions._proxyManager ?? null;
  const proxyRequestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
  if (requestedProxy || proxyPool !== null && proxyPool.shouldProxy(proxyRequestUrl)) {
    throw new RezoError("The browser-owned XHR lane cannot route a request through a proxy (the browser owns the connection): use the HTTP/1.1, HTTP/2 or cURL adapter for proxied requests", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  if (isStreamBody(fetchOptions.body)) {
    throw new RezoError("XHR does not support streaming request bodies.", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const stagedTimeouts = parseStagedTimeouts(fetchOptions.timeout);
  if (typeof stagedTimeouts.connect === "number" && stagedTimeouts.connect > 0) {
    throw new RezoError("The browser-owned XHR lane cannot observe or enforce a distinct connect timeout phase", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const redirectGuarantees = collectRedirectGuarantees(Object.freeze({
    request: options,
    defaults: defaultOptions,
    effectiveHooks: defaultOptions._hooks ?? {}
  }));
  const redirectVisibility = evaluateXHRRedirectVisibility();
  if (redirectVisibility.visibility === "hidden" && redirectGuarantees.length > 0) {
    throw new RezoError(formatUnsupportedRedirectCapabilities(redirectVisibility.lane, redirectGuarantees), mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  if (redirectVisibility.visibility === "hidden" && (fetchOptions.followRedirects === false || fetchOptions.maxRedirects === 0)) {
    throw new RezoError("Redirect policy (followRedirects: false / maxRedirects: 0) cannot be enforced on the browser-owned XHR lane", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const perform = new RezoPerformance;
  const internalOptions = options;
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
  let cache;
  let requestHeaders;
  let cacheIdentityHeaders;
  let cachedEntry;
  if (cacheOption && !takeCoreCacheOwnership(coreDispatchIdentity)) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
    cacheIdentityHeaders = { ...requestHeaders };
    cachedEntry = cache.get(method, requestUrl, requestHeaders);
    if (cachedEntry) {
      const cacheControl = parseCacheControlFromHeaders(cachedEntry.headers);
      if (!cacheControl.noCache && !cacheControl.mustRevalidate) {
        return buildCachedRezoResponse(cachedEntry, mainConfig);
      }
    }
    const conditionalHeaders = cache.getConditionalHeaders(method, requestUrl, requestHeaders);
    if (conditionalHeaders) {
      const headers = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
      for (const [name, value] of Object.entries(conditionalHeaders)) {
        headers.set(name, value);
      }
      fetchOptions.headers = headers;
      fetchOptions._acceptNotModified = cachedEntry !== undefined;
    }
  }
  const isStream = internalOptions._isStream;
  const isDownload = internalOptions._isDownload || !!internalOptions.fileName || !!internalOptions.saveTo;
  const isUpload = internalOptions._isUpload;
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = internalOptions._streamResponse ?? new StreamResponse;
  } else if (isDownload) {
    const fileName = internalOptions.fileName || internalOptions.saveTo || "";
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    downloadResponse = internalOptions._downloadResponse ?? new DownloadResponse(fileName, url);
  } else if (isUpload) {
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    uploadResponse = internalOptions._uploadResponse ?? new UploadResponse(url);
  }
  const res = executeXHRRequest(fetchOptions, mainConfig, options, perform, streamResponse, downloadResponse, uploadResponse);
  if (streamResponse) {
    res.catch((error) => {
      debugErrorDump(mainConfig, error);
      settleFacadeError(mainConfig.hooks, streamResponse, error);
    });
    return streamResponse;
  } else if (downloadResponse) {
    res.catch((error) => {
      debugErrorDump(mainConfig, error);
      settleFacadeError(mainConfig.hooks, downloadResponse, error);
    });
    return downloadResponse;
  } else if (uploadResponse) {
    res.catch((error) => {
      debugErrorDump(mainConfig, error);
      settleFacadeError(mainConfig.hooks, uploadResponse, error);
    });
    return uploadResponse;
  }
  const response = await res;
  if (cache && !isStream && !isDownload && !isUpload) {
    if (response.status === 304 && cachedEntry) {
      const responseHeaders = response.headers instanceof RezoHeaders ? Object.fromEntries(response.headers.entries()) : response.headers;
      const updatedCached = cache.updateRevalidated(method, requestUrl, responseHeaders, cacheIdentityHeaders);
      if (updatedCached) {
        return buildCachedRezoResponse(updatedCached, mainConfig);
      }
      return buildCachedRezoResponse(cachedEntry, mainConfig);
    }
    if (response.status >= 200 && response.status < 300) {
      cache.set(method, requestUrl, response, cacheIdentityHeaders);
    }
  }
  return response;
}
function createXHRSignalAbortError(config, request, stage) {
  const stageSuffix = stage.length > 0 ? ` ${stage}` : "";
  const cause = new Error(`Request aborted by signal${stageSuffix}`);
  cause.name = "AbortError";
  cause.code = "ABORT_ERR";
  return buildSmartError(config, request, cause);
}
function throwIfXHRSignalAborted(signal, config, request, stage) {
  if (signal?.aborted === true) {
    throw createXHRSignalAbortError(config, request, stage);
  }
}
function createXHRTotalTimeoutError(deadline, config, request) {
  return createStagedTimeoutError("total", deadline.elapsed(), config, request);
}
function throwIfXHRTotalDeadlineExpired(deadline, config, request) {
  if (deadline?.expired())
    throw createXHRTotalTimeoutError(deadline, config, request);
}
function runXHRRetryStage(callerSignal, totalDeadline, config, request, stage, operation) {
  if (callerSignal?.aborted) {
    return Promise.reject(createXHRSignalAbortError(config, request, stage));
  }
  if (totalDeadline?.expired()) {
    return Promise.reject(createXHRTotalTimeoutError(totalDeadline, config, request));
  }
  if (callerSignal === undefined && totalDeadline === undefined) {
    return Promise.resolve().then(operation);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled)
        return;
      settled = true;
      callerSignal?.removeEventListener("abort", onAbort);
      totalDeadline?.signal.removeEventListener("abort", onTotalTimeout);
      callback();
    };
    const onAbort = () => {
      finish(() => reject(createXHRSignalAbortError(config, request, stage)));
    };
    const onTotalTimeout = () => {
      finish(() => reject(createXHRTotalTimeoutError(totalDeadline, config, request)));
    };
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    totalDeadline?.signal.addEventListener("abort", onTotalTimeout, { once: true });
    if (callerSignal?.aborted) {
      onAbort();
      return;
    }
    if (totalDeadline?.expired()) {
      onTotalTimeout();
      return;
    }
    try {
      Promise.resolve(operation()).then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
function createXHRInterruptScope(callerSignal, totalDeadline) {
  const totalSignal = totalDeadline?.signal;
  if (callerSignal === undefined || totalSignal === undefined) {
    return {
      signal: callerSignal ?? totalSignal,
      clear: () => {
        return;
      }
    };
  }
  const controller = new AbortController;
  const abort = () => controller.abort();
  callerSignal.addEventListener("abort", abort, { once: true });
  totalSignal.addEventListener("abort", abort, { once: true });
  if (callerSignal.aborted || totalSignal.aborted)
    abort();
  return {
    signal: controller.signal,
    clear() {
      callerSignal.removeEventListener("abort", abort);
      totalSignal.removeEventListener("abort", abort);
    }
  };
}
function waitForXHRRetryDelay(delayMs, callerSignal, totalDeadline, config, request) {
  if (totalDeadline?.expired()) {
    return Promise.reject(createXHRTotalTimeoutError(totalDeadline, config, request));
  }
  if (callerSignal?.aborted) {
    return Promise.reject(createXHRSignalAbortError(config, request, "during the retry delay"));
  }
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  if (callerSignal === undefined && totalDeadline === undefined) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled)
        return;
      settled = true;
      if (timer !== undefined)
        clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
      totalDeadline?.signal.removeEventListener("abort", onTotalTimeout);
      callback();
    };
    const onAbort = () => {
      finish(() => reject(createXHRSignalAbortError(config, request, "during the retry delay")));
    };
    const onTotalTimeout = () => {
      finish(() => reject(createXHRTotalTimeoutError(totalDeadline, config, request)));
    };
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    totalDeadline?.signal.addEventListener("abort", onTotalTimeout, { once: true });
    timer = setTimeout(() => {
      if (totalDeadline?.expired())
        onTotalTimeout();
      else if (callerSignal?.aborted)
        onAbort();
      else
        finish(resolve);
    }, delayMs);
  });
}
async function executeXHRRequest(fetchOptions, config, options, perform, streamResult, downloadResult, uploadResult) {
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const requestSignal = fetchOptions.signal ?? config.signal ?? undefined;
  const startTime = performance.now();
  const totalDeadline = createXHRTotalDeadline(fetchOptions.timeout);
  const lifecycle = {
    startedAt: startTime,
    abortHookNotified: false,
    timeoutHookNotified: false
  };
  const timing = {
    startTime
  };
  config.timing.startTime = startTime;
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  let totalAttempts = 0;
  const eventEmitter = streamResult || downloadResult || uploadResult;
  if (eventEmitter) {
    eventEmitter.emit("initiated");
  }
  try {
    while (true) {
      totalAttempts++;
      throwIfXHRTotalDeadlineExpired(totalDeadline, config, fetchOptions);
      if (totalAttempts > 1) {
        throwIfXHRSignalAborted(requestSignal, config, fetchOptions, "before retry dispatch");
      }
      if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
        const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
        throw error;
      }
      const attemptPublication = createXHRAttemptPublication(Boolean(retryConfig && retryConfig.maxRetries > 0 || options.waitOnStatus));
      let responseReceived = false;
      try {
        const response = await executeSingleXHRRequest(config, fetchOptions, options, totalDeadline, attemptPublication, timing, streamResult, downloadResult, uploadResult);
        responseReceived = true;
        if (response instanceof RezoError) {
          if (response.code === "ABORT_ERR") {
            attemptPublication.publish();
            throw response;
          }
          if (response.code === "ECONNABORTED" && response.phase === "total") {
            attemptPublication.publish();
            throw response;
          }
          const errorStatus = response.status || 0;
          if (shouldWaitOnStatus(errorStatus, options.waitOnStatus)) {
            const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
            const interruptScope = createXHRInterruptScope(requestSignal, totalDeadline);
            let waitResult;
            try {
              waitResult = await handleRateLimitWait({
                status: errorStatus,
                headers: response.response?.headers || new RezoHeaders,
                data: response.response?.data,
                url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
                method: fetchOptions.method || "GET",
                config,
                options,
                currentWaitAttempt: rateLimitWaitAttempt,
                signal: interruptScope.signal,
                isActive: () => requestSignal?.aborted !== true && totalDeadline?.expired() !== true
              });
            } finally {
              interruptScope.clear();
            }
            throwIfXHRSignalAborted(requestSignal, config, fetchOptions, "during the rate-limit wait");
            throwIfXHRTotalDeadlineExpired(totalDeadline, config, fetchOptions);
            if (waitResult.shouldRetry) {
              config._rateLimitWaitAttempt = waitResult.waitAttempt;
              attemptPublication.discard();
              continue;
            }
          }
          config.errors.push({
            attempt: config.retryAttempts + 1,
            error: response,
            duration: perform.now()
          });
          perform.reset();
          if (!retryConfig) {
            attemptPublication.publish();
            throw response;
          }
          const method = fetchOptions.method || "GET";
          retryAttempt++;
          if (retryAttempt > retryConfig.maxRetries) {
            debugLog.maxRetries(config, retryConfig.maxRetries);
            if (retryConfig.onRetryExhausted) {
              await runXHRRetryStage(requestSignal, totalDeadline, config, fetchOptions, "during retry exhaustion", () => retryConfig.onRetryExhausted(response, retryAttempt));
            }
            attemptPublication.publish();
            throw response;
          }
          if (retryConfig.condition) {
            const shouldContinue = await runXHRRetryStage(requestSignal, totalDeadline, config, fetchOptions, "during the retry condition", () => retryConfig.condition(response, retryAttempt));
            if (shouldContinue === false) {
              if (retryConfig.onRetryExhausted) {
                await runXHRRetryStage(requestSignal, totalDeadline, config, fetchOptions, "during retry exhaustion", () => retryConfig.onRetryExhausted(response, retryAttempt));
              }
              attemptPublication.publish();
              throw response;
            }
          } else {
            const canRetry = shouldRetry(response, retryAttempt, method, retryConfig);
            if (!canRetry) {
              attemptPublication.publish();
              throw response;
            }
          }
          const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
          debugLog.retry(config, retryAttempt, retryConfig.maxRetries, response.status || 0, currentDelay);
          if (retryConfig.onRetry) {
            const shouldProceed = await runXHRRetryStage(requestSignal, totalDeadline, config, fetchOptions, "during the retry callback", () => retryConfig.onRetry(response, retryAttempt, currentDelay));
            if (shouldProceed === false) {
              attemptPublication.publish();
              throw response;
            }
          }
          for (const hook of config.hooks?.beforeRetry ?? []) {
            await runXHRRetryStage(requestSignal, totalDeadline, config, fetchOptions, "during the beforeRetry hook", () => hook(config, response, retryAttempt));
          }
          attemptPublication.discard();
          await waitForXHRRetryDelay(currentDelay, requestSignal, totalDeadline, config, fetchOptions);
          config.retryAttempts++;
          continue;
        }
        attemptPublication.publish();
        return response;
      } catch (error) {
        if (responseReceived)
          attemptPublication.discard();
        else
          attemptPublication.publish();
        if (error instanceof RezoError) {
          if (error.code === "ABORT_ERR") {
            notifyXHRAbortHooksOnce(config, fetchOptions, lifecycle, error.message);
          }
          const phase = error.phase;
          const elapsed = error.elapsed;
          if ((phase === "connect" || phase === "headers" || phase === "body" || phase === "total") && typeof elapsed === "number") {
            notifyXHRTimeoutHooksOnce(config, fetchOptions, lifecycle, phase, elapsed);
          }
          debugErrorDump(config, error);
          throw error;
        }
        const smartError = buildSmartError(config, fetchOptions, error);
        debugErrorDump(config, smartError);
        throw smartError;
      }
    }
  } finally {
    totalDeadline?.clear();
  }
}
function executeSingleXHRRequest(config, fetchOptions, originalOptions, totalDeadline, attemptPublication, timing, streamResult, downloadResult, uploadResult) {
  return new Promise((resolve) => {
    const requestSignal = fetchOptions.signal ?? config.signal ?? undefined;
    let onRequestAbort;
    let settled = false;
    let failureClaimed = false;
    let cleanupAttemptTimeouts = () => {
      return;
    };
    const eventEmitter = streamResult || downloadResult || uploadResult;
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      cleanupAttemptTimeouts();
      if (requestSignal && onRequestAbort) {
        requestSignal.removeEventListener("abort", onRequestAbort);
      }
      resolve(result);
    };
    const settleFailure = (failure) => {
      if (settled || failureClaimed)
        return;
      failureClaimed = true;
      const error = failure instanceof RezoError ? failure : buildSmartError(config, fetchOptions, failure instanceof Error ? failure : new Error(String(failure)));
      settle(error);
    };
    try {
      const { fullUrl, body } = fetchOptions;
      const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
      const isSecure = url.startsWith("https:");
      config.adapterUsed = "xhr";
      config.isSecure = isSecure;
      config.finalUrl = url;
      config.network.protocol = isSecure ? "https" : "http";
      debugLog.requestStart(config, url, fetchOptions.method?.toUpperCase() || "GET");
      const xhr = new XMLHttpRequest;
      const stagedTimeouts = parseStagedTimeouts(fetchOptions.timeout);
      let headersTimer;
      let headersStartedAt = 0;
      let bodyTimer;
      let bodyStartedAt = 0;
      let declaredResponseBytes = 0;
      let onTotalDeadline;
      const clearHeadersTimer = () => {
        if (headersTimer !== undefined) {
          clearTimeout(headersTimer);
          headersTimer = undefined;
        }
      };
      const clearBodyTimer = () => {
        if (bodyTimer !== undefined) {
          clearTimeout(bodyTimer);
          bodyTimer = undefined;
        }
      };
      const settleOwnedTimeout = (phase, elapsed) => {
        if (settled || failureClaimed)
          return;
        const timeoutError = createStagedTimeoutError(phase, elapsed, config, fetchOptions);
        settleFailure(timeoutError);
        try {
          xhr.abort();
        } catch {}
      };
      cleanupAttemptTimeouts = () => {
        clearHeadersTimer();
        clearBodyTimer();
        if (totalDeadline && onTotalDeadline) {
          totalDeadline.signal.removeEventListener("abort", onTotalDeadline);
        }
        xhr.onreadystatechange = null;
      };
      const armBodyTimeout = () => {
        if (bodyTimer !== undefined || typeof stagedTimeouts.body !== "number" || stagedTimeouts.body <= 0) {
          return;
        }
        bodyStartedAt = performance.now();
        bodyTimer = setTimeout(() => {
          const elapsed = Math.max(stagedTimeouts.body, Math.round(performance.now() - bodyStartedAt));
          settleOwnedTimeout("body", elapsed);
        }, stagedTimeouts.body);
      };
      const armAttemptTimeouts = () => {
        if (typeof stagedTimeouts.headers === "number" && stagedTimeouts.headers > 0) {
          headersStartedAt = performance.now();
          headersTimer = setTimeout(() => {
            const elapsed = Math.max(stagedTimeouts.headers, Math.round(performance.now() - headersStartedAt));
            settleOwnedTimeout("headers", elapsed);
          }, stagedTimeouts.headers);
        }
        if (totalDeadline) {
          onTotalDeadline = () => settleOwnedTimeout("total", totalDeadline.elapsed());
          totalDeadline.signal.addEventListener("abort", onTotalDeadline, { once: true });
          if (totalDeadline.expired())
            onTotalDeadline();
        }
      };
      xhr.open(fetchOptions.method.toUpperCase(), url, true);
      xhr.onreadystatechange = () => {
        if (xhr.readyState >= 2) {
          clearHeadersTimer();
          armBodyTimeout();
          try {
            const contentLength = Number.parseInt(xhr.getResponseHeader("content-length") ?? "", 10);
            if (Number.isFinite(contentLength) && contentLength > 0) {
              declaredResponseBytes = contentLength;
            }
          } catch {}
        }
      };
      const headers = toXHRHeaders(fetchOptions.headers);
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) {
          xhr.setRequestHeader(key, String(value));
        }
      }
      const responseType = config.responseType || fetchOptions.responseType || "auto";
      if (responseType === "blob") {
        xhr.responseType = "blob";
      } else if (responseType === "arrayBuffer" || responseType === "buffer") {
        xhr.responseType = "arraybuffer";
      } else if (responseType === "json") {
        xhr.responseType = "text";
      } else {
        xhr.responseType = "text";
      }
      xhr.timeout = 0;
      xhr.withCredentials = config.withCredentials === true;
      if (eventEmitter) {
        const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
        const startEvent = {
          url,
          method: fetchOptions.method.toUpperCase(),
          headers: new RezoHeaders(reqHeaders),
          timestamp: timing.startTime,
          timeout: resolveTimeoutMs(fetchOptions.timeout),
          maxRedirects: config.maxRedirects
        };
        attemptPublication.enqueue(() => eventEmitter.emit("start", startEvent));
      }
      let requestSent = false;
      let abortRequestedBeforeSend = requestSignal?.aborted === true;
      if (requestSignal) {
        onRequestAbort = () => {
          if (settled || failureClaimed)
            return;
          if (!requestSent) {
            abortRequestedBeforeSend = true;
            return;
          }
          settleFailure(createXHRSignalAbortError(config, fetchOptions, ""));
          xhr.abort();
        };
        requestSignal.addEventListener("abort", onRequestAbort, { once: true });
      }
      const downloadStartTime = performance.now();
      let lastDownloadBytes = 0;
      let lastDownloadTime = downloadStartTime;
      const downloadProgressCallback = originalOptions.onDownloadProgress ?? config.originalRequest?.onDownloadProgress ?? fetchOptions.onDownloadProgress;
      xhr.onprogress = (event) => {
        if (settled || failureClaimed)
          return;
        if (event.total > 0)
          declaredResponseBytes = event.total;
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const now = performance.now();
        const elapsed = now - downloadStartTime;
        const chunkSize = event.loaded - lastDownloadBytes;
        const chunkTime = now - lastDownloadTime;
        const speed = chunkTime > 0 ? chunkSize / (chunkTime / 1000) : 0;
        const averageSpeed = elapsed > 0 ? event.loaded / (elapsed / 1000) : 0;
        const remaining = event.total > event.loaded && averageSpeed > 0 ? (event.total - event.loaded) / averageSpeed * 1000 : 0;
        lastDownloadBytes = event.loaded;
        lastDownloadTime = now;
        const progressEvent = {
          loaded: event.loaded,
          total: event.total || 0,
          percentage: event.total ? event.loaded / event.total * 100 : 0,
          speed,
          averageSpeed,
          estimatedTime: remaining,
          timestamp: now
        };
        attemptPublication.enqueue(() => {
          eventEmitter?.emit("progress", progressEvent);
          notifyXHRProgressCallback(downloadProgressCallback, progressEvent, config, "download");
        });
      };
      const uploadProgressCallback = originalOptions.onUploadProgress ?? config.originalRequest?.onUploadProgress ?? fetchOptions.onUploadProgress;
      if (xhr.upload && (uploadResult || uploadProgressCallback)) {
        const uploadStartTime = performance.now();
        let lastUploadBytes = 0;
        let lastUploadTime = uploadStartTime;
        xhr.upload.onprogress = (event) => {
          if (settled)
            return;
          const now = performance.now();
          const elapsed = now - uploadStartTime;
          const chunkSize = event.loaded - lastUploadBytes;
          const chunkTime = now - lastUploadTime;
          const speed = chunkTime > 0 ? chunkSize / (chunkTime / 1000) : 0;
          const averageSpeed = elapsed > 0 ? event.loaded / (elapsed / 1000) : 0;
          const remaining = event.total > event.loaded && averageSpeed > 0 ? (event.total - event.loaded) / averageSpeed * 1000 : 0;
          lastUploadBytes = event.loaded;
          lastUploadTime = now;
          const progressEvent = {
            loaded: event.loaded,
            total: event.total || 0,
            percentage: event.total ? event.loaded / event.total * 100 : 0,
            speed,
            averageSpeed,
            estimatedTime: remaining,
            timestamp: now
          };
          attemptPublication.enqueue(() => {
            uploadResult?.emit("progress", progressEvent);
            notifyXHRProgressCallback(uploadProgressCallback, progressEvent, config, "upload");
          });
        };
      }
      const handleLoad = async () => {
        if (settled || failureClaimed)
          return;
        clearBodyTimer();
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const status = xhr.status;
        const statusText = xhr.statusText;
        const finalUrl = xhr.responseURL || url;
        config.finalUrl = finalUrl;
        const responseHeaders = parseXHRHeaders(xhr);
        const contentType = xhr.getResponseHeader("content-type") || "";
        const contentLength = xhr.getResponseHeader("content-length");
        const parsedContentLength = contentLength === null ? undefined : Number.parseInt(contentLength, 10);
        const cookies = createEmptyXHRCookies();
        config.responseCookies = cookies;
        const errorCarrier = config.originalRequest ?? fetchOptions;
        const buildXhrSourceResponse = (data, responseBodySize) => ({
          data,
          status,
          statusText,
          finalUrl,
          cookies: config.responseCookies ?? createEmptyXHRCookies(),
          headers: responseHeaders,
          contentType: responseHeaders.get("content-type") || undefined,
          contentLength: responseBodySize,
          urls: buildUrlTree(config, finalUrl),
          config
        });
        const headersHookEvent = {
          status,
          statusText,
          headers: responseHeaders,
          contentType: contentType || undefined,
          contentLength: Number.isFinite(parsedContentLength) ? parsedContentLength : undefined,
          ttfb: config.timing.responseStart - config.timing.startTime,
          timestamp: performance.now()
        };
        for (const hook of config.hooks?.afterHeaders ?? []) {
          await hook(headersHookEvent, config);
        }
        if (settled)
          return;
        if (eventEmitter) {
          const headersEvent = {
            status,
            statusText,
            headers: responseHeaders,
            contentType,
            contentLength: Number.isFinite(parsedContentLength) ? parsedContentLength : undefined,
            cookies: cookies.array,
            timing: {
              firstByte: config.timing.responseStart - config.timing.startTime,
              total: performance.now() - config.timing.startTime
            }
          };
          attemptPublication.enqueue(() => {
            eventEmitter.emit("headers", headersEvent);
            eventEmitter.emit("status", status, statusText);
            eventEmitter.emit("cookies", cookies.array);
            if (downloadResult) {
              downloadResult.status = status;
              downloadResult.statusText = statusText;
            } else if (uploadResult) {
              uploadResult.status = status;
              uploadResult.statusText = statusText;
            }
          });
        }
        let responseData;
        let bodySize = 0;
        let rawData;
        let rawBytes;
        const parseStartedAt = performance.now();
        if (xhr.responseType === "blob") {
          const blob = xhr.response;
          responseData = blob;
          const blobBuffer = await blob.arrayBuffer();
          rawBytes = new Uint8Array(blobBuffer);
          rawData = rawBytes;
          bodySize = blob.size;
        } else if (xhr.responseType === "arraybuffer") {
          const arrayBuffer = xhr.response ?? new ArrayBuffer(0);
          responseData = arrayBuffer;
          rawBytes = new Uint8Array(arrayBuffer);
          rawData = rawBytes;
          bodySize = arrayBuffer.byteLength;
        } else {
          const text = xhr.responseText ?? "";
          rawData = text;
          rawBytes = new TextEncoder().encode(text);
          bodySize = rawBytes.byteLength;
          const parseAsJson = responseType === "json" || responseType === "auto" && isXHRJsonContentType(contentType);
          if (parseAsJson) {
            try {
              responseData = JSON.parse(text);
            } catch (parseFailure) {
              const parsingError = new RezoError("Failed to parse JSON response", config, "REZ_INVALID_JSON", errorCarrier, buildXhrSourceResponse(text, bodySize));
              Object.defineProperty(parsingError, "cause", {
                value: parseFailure instanceof Error ? parseFailure : new Error(String(parseFailure)),
                enumerable: false
              });
              throw parsingError;
            }
          } else {
            responseData = text;
          }
        }
        const parseDuration = performance.now() - parseStartedAt;
        for (const hook of config.hooks?.afterParse ?? []) {
          const transformed = await hook({
            data: responseData,
            rawData,
            contentType,
            parseDuration,
            timestamp: performance.now()
          }, config);
          if (transformed !== undefined && transformed !== null) {
            responseData = transformed;
          }
        }
        if (settled)
          return;
        updateTiming(config, timing, bodySize);
        const xhrTerminalLocation = responseHeaders.get("location") || responseHeaders.get("Location");
        if (status >= 300 && status < 400 && status !== 304 && !xhrTerminalLocation) {
          const missingLocationError = buildRedirectControlError("Redirect location not found", config, "REZ_MISSING_REDIRECT_LOCATION", errorCarrier, buildXhrSourceResponse(responseData, bodySize));
          settle(missingLocationError);
          return;
        }
        const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
        const notModifiedFromCache = status === 304 && fetchOptions.validateStatus === undefined && fetchOptions._acceptNotModified === true;
        if (fetchOptions.validateStatus !== null && !notModifiedFromCache && !_validateStatus(status)) {
          const sourceResponse = buildXhrSourceResponse(responseData, bodySize);
          const error = status >= 400 ? builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, sourceResponse, config, errorCarrier) : RezoError.createHttpError(status, config, errorCarrier, sourceResponse);
          settle(error);
          return;
        }
        const duration = performance.now() - timing.startTime;
        debugLog.response(config, status, statusText, duration);
        debugLog.responseHeaders(config, responseHeaders.toObject());
        debugLog.cookies(config, cookies.array.length);
        debugLog.timing(config, {
          ttfb: config.timing.responseStart - config.timing.startTime,
          total: duration
        });
        debugLog.complete(config, finalUrl);
        const finalResponse = {
          data: responseData,
          status,
          statusText,
          headers: responseHeaders,
          cookies,
          config,
          contentType,
          contentLength: bodySize,
          finalUrl,
          urls: buildUrlTree(config, finalUrl)
        };
        if (streamResult) {
          const streamFinishEvent = {
            status,
            statusText,
            headers: responseHeaders,
            contentType,
            contentLength: bodySize,
            finalUrl,
            cookies,
            urls: buildUrlTree(config, finalUrl),
            timing: getTimingDurations(config),
            config: sanitizeConfig(config)
          };
          attemptPublication.enqueue(() => {
            if (rawBytes.byteLength > 0)
              streamResult.write(rawBytes);
            streamResult.emit("end");
            streamResult.emit("finish", streamFinishEvent);
            streamResult.emit("done", streamFinishEvent);
            streamResult.emit("complete", streamFinishEvent);
            streamResult._markFinished();
            streamResult.end();
          });
        }
        if (downloadResult) {
          const downloadFinishEvent = {
            status,
            statusText,
            headers: responseHeaders,
            contentType,
            contentLength: bodySize,
            finalUrl,
            cookies,
            urls: buildUrlTree(config, finalUrl),
            fileName: config.fileName || "",
            fileSize: bodySize,
            timing: {
              ...getTimingDurations(config),
              download: getTimingDurations(config).download || 0
            },
            averageSpeed: getTimingDurations(config).download ? bodySize / getTimingDurations(config).download * 1000 : 0,
            config: sanitizeConfig(config)
          };
          attemptPublication.enqueue(() => {
            downloadResult.emit("finish", downloadFinishEvent);
            downloadResult.emit("done", downloadFinishEvent);
            downloadResult.emit("complete", downloadFinishEvent);
            downloadResult._markFinished();
          });
        }
        if (uploadResult) {
          const uploadFinishEvent = {
            response: {
              status,
              statusText,
              headers: responseHeaders,
              data: responseData,
              contentType,
              contentLength: bodySize
            },
            finalUrl,
            cookies,
            urls: buildUrlTree(config, finalUrl),
            uploadSize: config.transfer.requestSize || 0,
            timing: {
              ...getTimingDurations(config),
              upload: getTimingDurations(config).firstByte || 0,
              waiting: getTimingDurations(config).download > 0 && getTimingDurations(config).firstByte > 0 ? getTimingDurations(config).download - getTimingDurations(config).firstByte : 0
            },
            averageUploadSpeed: getTimingDurations(config).firstByte && config.transfer.requestSize ? config.transfer.requestSize / getTimingDurations(config).firstByte * 1000 : 0,
            averageDownloadSpeed: getTimingDurations(config).download ? bodySize / getTimingDurations(config).download * 1000 : 0,
            config: sanitizeConfig(config)
          };
          attemptPublication.enqueue(() => {
            uploadResult.emit("finish", uploadFinishEvent);
            uploadResult.emit("done", uploadFinishEvent);
            uploadResult.emit("complete", uploadFinishEvent);
            uploadResult._markFinished();
          });
        }
        settle(finalResponse);
      };
      xhr.onload = () => {
        handleLoad().catch((error) => {
          settleFailure(error);
        });
      };
      xhr.onerror = () => {
        let declaredLength = declaredResponseBytes;
        if (declaredLength <= 0) {
          try {
            declaredLength = Number.parseInt(xhr.getResponseHeader("content-length") ?? "", 10);
          } catch {
            declaredLength = Number.NaN;
          }
        }
        const error = lastDownloadBytes > 0 && Number.isFinite(declaredLength) && lastDownloadBytes < declaredLength ? createXHRPrematureCloseError(config, fetchOptions, lastDownloadBytes, declaredLength) : buildSmartError(config, fetchOptions, new Error("Network error"));
        settleFailure(error);
      };
      xhr.ontimeout = () => {
        const totalMs = stagedTimeouts.total ?? resolveTimeoutMs(fetchOptions.timeout) ?? 0;
        settleOwnedTimeout("total", Math.max(totalMs, totalDeadline?.elapsed() ?? totalMs));
      };
      xhr.onabort = () => {
        const abortCause = new Error("Request aborted by signal");
        abortCause.name = "AbortError";
        abortCause.code = "ABORT_ERR";
        const error = buildSmartError(config, fetchOptions, abortCause);
        settleFailure(error);
      };
      const preparedBody = prepareXHRBody(body);
      armAttemptTimeouts();
      if (failureClaimed)
        return;
      xhr.send(preparedBody);
      requestSent = true;
      if (abortRequestedBeforeSend || requestSignal?.aborted === true) {
        abortRequestedBeforeSend = false;
        onRequestAbort?.();
      }
    } catch (error) {
      settleFailure(error);
    }
  });
}

export { Environment };
registerAdapterCapabilities(executeRequest, {
  evaluateRedirectVisibility: evaluateXHRRedirectVisibility
});
