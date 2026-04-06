import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse } from '../responses/buildError.js';
import { RezoCookieJar } from '../cookies/cookie-jar.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { RezoPerformance } from '../utils/tools.js';
import { isSameDomain } from '../utils/tools.js';
import { ResponseCache } from '../cache/universal-response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
const Environment = {
  get isReactNative() {
    return typeof navigator !== "undefined" && navigator.product === "ReactNative";
  },
  get isExpo() {
    return typeof globalThis.expo !== "undefined";
  },
  get hasFetch() {
    return typeof fetch !== "undefined";
  },
  get hasBlob() {
    return typeof Blob !== "undefined";
  },
  get hasFormData() {
    return typeof FormData !== "undefined";
  },
  get hasAbortController() {
    return typeof AbortController !== "undefined";
  }
};
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      console.log(`[Rezo Debug] Adapter: react-native`);
      if (config.originalRequest?.headers) {
        const headers = config.originalRequest.headers instanceof RezoHeaders ? config.originalRequest.headers.toObject() : config.originalRequest.headers;
        console.log(`[Rezo Debug] Request Headers:`, JSON.stringify(headers, null, 2));
      }
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track] → ${method} ${url}`);
    }
  },
  redirect: (config, fromUrl, toUrl, statusCode, method) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Redirect ${statusCode}: ${fromUrl}`);
      console.log(`[Rezo Debug]        → ${toUrl} (${method})`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ↳ ${statusCode} → ${toUrl}`);
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
function createEmptyCookies() {
  return {
    array: [],
    serialized: [],
    netscape: `# Netscape HTTP Cookie File
# This file was generated by Rezo HTTP client
`,
    string: "",
    setCookiesString: []
  };
}
function normalizeResponseType(responseType) {
  if (!responseType)
    return "auto";
  const lower = responseType.toLowerCase();
  if (lower === "arraybuffer")
    return "arrayBuffer";
  if (lower === "binary")
    return "buffer";
  return responseType;
}
async function parseCookiesFromHeaders(headers, url, config) {
  let setCookieHeaders = [];
  const headersWithGetSetCookie = headers;
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    setCookieHeaders = headersWithGetSetCookie.getSetCookie() || [];
  } else {
    const rawSetCookie = headers.get("set-cookie");
    if (rawSetCookie) {
      const splitPattern = /,(?=\s*[A-Za-z0-9_-]+=)/;
      setCookieHeaders = rawSetCookie.split(splitPattern).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (setCookieHeaders.length === 0) {
    return createEmptyCookies();
  }
  const tempJar = new RezoCookieJar;
  tempJar.setCookiesSync(setCookieHeaders, url);
  const parsedCookies = tempJar.cookies();
  const acceptedCookies = [];
  let hookError = null;
  if (config?.hooks?.beforeCookie && config.hooks.beforeCookie.length > 0) {
    for (const cookie of parsedCookies.array) {
      let shouldAccept = true;
      for (const hook of config.hooks.beforeCookie) {
        try {
          const result = await hook({
            cookie,
            source: "response",
            url,
            isValid: true
          }, config);
          if (result === false) {
            shouldAccept = false;
            break;
          }
        } catch (err) {
          hookError = err;
          if (config.debug) {
            console.log("[Rezo Debug] beforeCookie hook error:", err);
          }
        }
      }
      if (shouldAccept) {
        acceptedCookies.push(cookie);
      }
    }
  } else {
    acceptedCookies.push(...parsedCookies.array);
  }
  const acceptedCookieStrings = acceptedCookies.map((cookie) => cookie.toSetCookieString());
  const jar = new RezoCookieJar;
  jar.setCookiesSync(acceptedCookieStrings, url);
  if (!config?.disableJar && config?.jar) {
    config.jar.setCookiesSync(acceptedCookieStrings, url);
  }
  const cookies = jar.cookies();
  cookies.setCookiesString = setCookieHeaders;
  if (!hookError && config?.hooks?.afterCookie && config.hooks.afterCookie.length > 0) {
    for (const hook of config.hooks.afterCookie) {
      try {
        await hook(acceptedCookies, config);
      } catch (err) {
        if (config.debug) {
          console.log("[Rezo Debug] afterCookie hook error:", err);
        }
      }
    }
  }
  return cookies;
}
function mergeRequestAndResponseCookies(config, responseCookies, url) {
  const mergedCookiesArray = [];
  const cookieKeyDomainMap = new Map;
  if (config.requestCookies && config.requestCookies.length > 0) {
    for (const cookie of config.requestCookies) {
      const key = `${cookie.key}|${cookie.domain || ""}`;
      mergedCookiesArray.push(cookie);
      cookieKeyDomainMap.set(key, mergedCookiesArray.length - 1);
    }
  }
  for (const cookie of responseCookies.array) {
    const key = `${cookie.key}|${cookie.domain || ""}`;
    const existingIndex = cookieKeyDomainMap.get(key);
    if (existingIndex !== undefined) {
      mergedCookiesArray[existingIndex] = cookie;
    } else {
      mergedCookiesArray.push(cookie);
      cookieKeyDomainMap.set(key, mergedCookiesArray.length - 1);
    }
  }
  if (mergedCookiesArray.length > 0) {
    const mergedJar = new RezoCookieJar(mergedCookiesArray, url);
    return mergedJar.cookies();
  }
  return createEmptyCookies();
}
function runAfterParseHooks(parsedData, rawData, contentType, parseDuration, config) {
  if (!config.hooks?.afterParse || config.hooks.afterParse.length === 0) {
    return parsedData;
  }
  let transformed = parsedData;
  for (const hook of config.hooks.afterParse) {
    const result = hook({
      data: transformed,
      rawData,
      contentType,
      parseDuration,
      timestamp: Date.now()
    }, config);
    if (result !== undefined && result !== null) {
      transformed = result;
    }
  }
  return transformed;
}
function runOnTimeoutHooks(config, url, elapsed) {
  if (config.hooks?.onTimeout && config.hooks.onTimeout.length > 0) {
    for (const hook of config.hooks.onTimeout) {
      try {
        hook({
          type: "request",
          timeout: config.timeout || 0,
          elapsed,
          url,
          timestamp: Date.now()
        }, config);
      } catch {}
    }
  }
}
function runOnAbortHooks(config, reason, message, url, elapsed) {
  if (config.hooks?.onAbort && config.hooks.onAbort.length > 0) {
    for (const hook of config.hooks.onAbort) {
      try {
        hook({
          reason,
          message,
          url,
          elapsed,
          timestamp: Date.now()
        }, config);
      } catch {}
    }
  }
}
async function executeManagedNativeTransport(config, fetchOptions, url, timing, operation) {
  const abortController = new AbortController;
  let timeoutId;
  let abortedByTimeout = false;
  let abortedBySignal = false;
  const configAbortListener = () => {
    abortedBySignal = true;
    abortController.abort();
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
  if (config.timeout) {
    timeoutId = setTimeout(() => {
      abortedByTimeout = true;
      abortController.abort();
    }, config.timeout);
  }
  if (config.signal?.aborted) {
    abortedBySignal = true;
    abortController.abort();
  } else if (config.signal) {
    config.signal.addEventListener("abort", configAbortListener, { once: true });
  }
  const abortPromise = new Promise((_resolve, reject) => {
    abortController.signal.addEventListener("abort", () => {
      const error = new Error(abortedByTimeout && config.timeout ? `Request timeout after ${config.timeout}ms` : "Request was aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  try {
    const requestPromise = operation(abortController.signal);
    return await Promise.race([requestPromise, abortPromise]);
  } catch (err) {
    const isAbortError = err?.name === "AbortError" || abortController.signal.aborted;
    if (isAbortError) {
      const elapsed = performance.now() - timing.startTime;
      const message = abortedByTimeout && config.timeout ? `Request timeout after ${config.timeout}ms` : "Request was aborted";
      if (abortedByTimeout) {
        runOnTimeoutHooks(config, url, elapsed);
      }
      runOnAbortHooks(config, abortedByTimeout ? "timeout" : abortedBySignal ? "signal" : "error", message, url, elapsed);
      throw buildSmartError(config, fetchOptions, new Error(message));
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (config.signal) {
      config.signal.removeEventListener("abort", configAbortListener);
    }
  }
}
async function executeNativeTransferRequestWithRetry(config, fetchOptions, options, perform, eventEmitter, executeAttempt) {
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  let totalAttempts = 0;
  eventEmitter.emit("initiated");
  while (true) {
    totalAttempts++;
    if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
      throw builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
    }
    try {
      return await executeAttempt();
    } catch (error) {
      const rezoError = error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
      if (rezoError.response?.status && shouldWaitOnStatus(rezoError.response.status, options.waitOnStatus)) {
        const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
        const waitResult = await handleRateLimitWait({
          status: rezoError.response.status,
          headers: rezoError.response.headers,
          data: rezoError.response.data,
          url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
          method: fetchOptions.method || "GET",
          config,
          options,
          currentWaitAttempt: rateLimitWaitAttempt
        });
        if (waitResult.shouldRetry) {
          config._rateLimitWaitAttempt = waitResult.waitAttempt;
          perform.reset();
          continue;
        }
      }
      config.errors.push({
        attempt: config.retryAttempts + 1,
        error: rezoError,
        duration: perform.now()
      });
      perform.reset();
      if (!retryConfig) {
        throw rezoError;
      }
      const method = fetchOptions.method || "GET";
      retryAttempt++;
      if (retryConfig.condition) {
        const shouldContinue = await retryConfig.condition(rezoError, retryAttempt);
        if (shouldContinue === false) {
          if (retryConfig.onRetryExhausted) {
            await retryConfig.onRetryExhausted(rezoError, retryAttempt);
          }
          throw rezoError;
        }
      } else {
        const canRetry = shouldRetry(rezoError, retryAttempt, method, retryConfig);
        if (!canRetry) {
          if (retryAttempt > retryConfig.maxRetries) {
            debugLog.maxRetries(config, retryConfig.maxRetries);
            if (retryConfig.onRetryExhausted) {
              await retryConfig.onRetryExhausted(rezoError, retryAttempt);
            }
          }
          throw rezoError;
        }
      }
      const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
      debugLog.retry(config, retryAttempt, retryConfig.maxRetries, rezoError.status || 0, currentDelay);
      if (retryConfig.onRetry) {
        const shouldProceed = await retryConfig.onRetry(rezoError, retryAttempt, currentDelay);
        if (shouldProceed === false) {
          throw rezoError;
        }
      }
      if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
        for (const hook of config.hooks.beforeRetry) {
          try {
            await hook(config, rezoError, retryAttempt);
          } catch (hookErr) {
            if (config.debug) {
              console.log("[Rezo Debug] beforeRetry hook error:", hookErr);
            }
          }
        }
      }
      if (currentDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
      }
      config.retryAttempts++;
    }
  }
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
    cookies: createEmptyCookies(),
    config: {
      ...config,
      url: cached.url,
      method: "GET",
      headers,
      adapterUsed: "react-native",
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
function isInternalRedirectResponse(response) {
  return typeof response.__redirectLocation === "string";
}
function resolveRedirectLocation(fromUrl, location) {
  const redirectUrl = new URL(location, fromUrl);
  const currentUrl = new URL(fromUrl);
  if (!redirectUrl.hash && currentUrl.hash) {
    redirectUrl.hash = currentUrl.hash;
  }
  return redirectUrl.href;
}
function syncRedirectCookies(config, sourceUrl) {
  if (config.disableJar || !config.jar || !config.responseCookies?.array?.length) {
    return;
  }
  try {
    config.jar.setCookiesSync(config.responseCookies.array, sourceUrl);
  } catch {}
}
function rebuildCookieHeaderFromJar(config, fetchOptions) {
  if (config.disableJar || !config.jar || !(fetchOptions.headers instanceof RezoHeaders)) {
    return;
  }
  const redirectUrl = fetchOptions.fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const cookieHeader = config.jar.getCookieHeader(redirectUrl);
  if (cookieHeader) {
    fetchOptions.headers.set("Cookie", cookieHeader);
  } else {
    fetchOptions.headers.delete("Cookie");
  }
}
function emitObservedRedirect(streamResult, sourceUrl, destinationUrl, status, statusText, headers, cookies, method, redirectCount, maxRedirects, duration) {
  const redirectEvent = {
    sourceUrl,
    sourceStatus: status,
    sourceStatusText: statusText,
    destinationUrl,
    redirectCount,
    maxRedirects,
    headers,
    cookies,
    method,
    timestamp: performance.now(),
    duration
  };
  streamResult.emit("redirect", redirectEvent);
}
async function applyManualRedirect(config, fetchOptions, options, response, duration, streamResult) {
  const location = response.__redirectLocation;
  const fromUrl = fetchOptions.fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  if (config.maxRedirects === 0) {
    config.maxRedirectsReached = true;
    throw builErrorFromResponse("Redirects are disabled (maxRedirects=0)", response, config, fetchOptions);
  }
  const enableCycleDetection = config.enableRedirectCycleDetection === true;
  if (enableCycleDetection) {
    const normalizedRedirectUrl = location.toLowerCase();
    const visitedUrls = new Set((config.redirectHistory || []).map((redirect) => redirect.url.toLowerCase()));
    if (visitedUrls.has(normalizedRedirectUrl)) {
      throw builErrorFromResponse(`Redirect cycle detected: ${location}`, response, config, fetchOptions);
    }
  }
  const redirectCode = response.status;
  if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
    const redirectContext = {
      redirectUrl: new URL(location),
      fromUrl,
      status: response.status,
      headers: response.headers,
      sameDomain: isSameDomain(fromUrl, location),
      method: (fetchOptions.method || "GET").toUpperCase(),
      body: config.originalBody,
      request: fetchOptions,
      redirectCount: config.redirectCount,
      timestamp: Date.now()
    };
    for (const hook of config.hooks.beforeRedirect) {
      await hook(redirectContext, config, response);
    }
  }
  const redirectCallback = config.beforeRedirect || config.onRedirect;
  const onRedirect = redirectCallback ? redirectCallback({
    url: new URL(location),
    status: response.status,
    headers: response.headers,
    sameDomain: isSameDomain(fromUrl, location),
    method: (fetchOptions.method || "GET").toUpperCase(),
    body: config.originalBody
  }) : undefined;
  if (typeof onRedirect !== "undefined") {
    if (typeof onRedirect === "boolean" && !onRedirect) {
      throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
    }
    if (typeof onRedirect === "object" && !onRedirect.redirect && !onRedirect.withoutBody && !("body" in onRedirect)) {
      throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
    }
  }
  if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
    config.maxRedirectsReached = true;
    throw builErrorFromResponse(`Max redirects (${config.maxRedirects}) reached`, response, config, fetchOptions);
  }
  config.redirectHistory.push({
    url: fromUrl,
    statusCode: redirectCode,
    statusText: response.statusText,
    headers: response.headers,
    method: (fetchOptions.method || "GET").toUpperCase(),
    cookies: config.responseCookies?.array || [],
    duration,
    request: { ...fetchOptions }
  });
  config.redirectCount++;
  syncRedirectCookies(config, fromUrl);
  fetchOptions.fullUrl = location;
  options.fullUrl = location;
  config.finalUrl = location;
  const normalizedRedirect = typeof onRedirect === "object" ? onRedirect.redirect || onRedirect.withoutBody || "body" in onRedirect : undefined;
  if (typeof onRedirect === "object" && normalizedRedirect) {
    let method;
    const userMethod = onRedirect.method;
    if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
      method = userMethod || "GET";
    } else {
      method = userMethod || (fetchOptions.method || "GET");
    }
    config.method = method;
    options.method = method;
    fetchOptions.method = method;
    if (onRedirect.redirect && onRedirect.url) {
      fetchOptions.fullUrl = onRedirect.url;
      options.fullUrl = onRedirect.url;
      config.finalUrl = onRedirect.url;
    }
    if (onRedirect.withoutBody) {
      delete options.body;
      delete fetchOptions.body;
      config.originalBody = undefined;
      if (fetchOptions.headers instanceof RezoHeaders) {
        fetchOptions.headers.delete("Content-Type");
        fetchOptions.headers.delete("Content-Length");
      }
    } else if ("body" in onRedirect) {
      options.body = onRedirect.body;
      fetchOptions.body = onRedirect.body;
      config.originalBody = onRedirect.body;
    } else if (redirectCode === 307 || redirectCode === 308) {
      const methodUpper = method.toUpperCase();
      if ((methodUpper === "POST" || methodUpper === "PUT" || methodUpper === "PATCH") && config.originalBody !== undefined) {
        options.body = config.originalBody;
        fetchOptions.body = config.originalBody;
      }
    } else {
      delete options.body;
      delete fetchOptions.body;
      if (fetchOptions.headers instanceof RezoHeaders) {
        fetchOptions.headers.delete("Content-Type");
        fetchOptions.headers.delete("Content-Length");
      }
    }
    if (onRedirect.redirect && onRedirect.setHeaders && fetchOptions.headers instanceof RezoHeaders) {
      for (const [key, value] of Object.entries(onRedirect.setHeaders)) {
        fetchOptions.headers.set(key, value);
      }
    }
  } else if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
    options.method = "GET";
    fetchOptions.method = "GET";
    config.method = "GET";
    delete options.body;
    delete fetchOptions.body;
    if (fetchOptions.headers instanceof RezoHeaders) {
      fetchOptions.headers.delete("Content-Type");
      fetchOptions.headers.delete("Content-Length");
    }
  }
  rebuildCookieHeaderFromJar(config, fetchOptions);
  debugLog.redirect(config, fromUrl, fetchOptions.fullUrl || location, redirectCode, fetchOptions.method || "GET");
  if (streamResult) {
    emitObservedRedirect(streamResult, fromUrl, fetchOptions.fullUrl || location, redirectCode, response.statusText, response.headers, config.responseCookies?.array || [], (fetchOptions.method || "GET").toUpperCase(), config.redirectCount, config.maxRedirects, duration);
  }
}
function sanitizeConfig(config) {
  const sanitized = { ...config };
  delete sanitized.data;
  return sanitized;
}
function fromFetchHeaders(headers) {
  const record = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return new RezoHeaders(record);
}
function toFetchHeaders(headers) {
  const fetchHeaders = new Headers;
  if (!headers)
    return fetchHeaders;
  if (headers instanceof RezoHeaders) {
    for (const [key, value] of headers.entries()) {
      if (value !== undefined && value !== null) {
        fetchHeaders.set(key, String(value));
      }
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        fetchHeaders.set(key, String(value));
      }
    }
  }
  return fetchHeaders;
}
async function prepareBody(body) {
  if (!body)
    return;
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return body.toString();
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return body;
  }
  if (body instanceof RezoFormData) {
    const nativeForm = body.toNativeFormData();
    if (nativeForm) {
      return nativeForm;
    }
    return;
  }
  if (typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
    return JSON.stringify(body);
  }
  return body;
}
function resolveReactNativeOptions(options, defaultOptions) {
  return {
    ...defaultOptions.reactNative || {},
    ...options.reactNative || {},
    fileSystemAdapter: options.reactNative?.fileSystemAdapter || defaultOptions.reactNative?.fileSystemAdapter,
    streamTransport: options.reactNative?.streamTransport || defaultOptions.reactNative?.streamTransport,
    networkInfoProvider: options.reactNative?.networkInfoProvider || defaultOptions.reactNative?.networkInfoProvider,
    backgroundTaskProvider: options.reactNative?.backgroundTaskProvider || defaultOptions.reactNative?.backgroundTaskProvider,
    backgroundTask: options.reactNative?.backgroundTask !== undefined ? options.reactNative.backgroundTask : defaultOptions.reactNative?.backgroundTask,
    upload: options.reactNative?.upload !== undefined ? options.reactNative.upload : defaultOptions.reactNative?.upload
  };
}
function resolveBackgroundTaskConfig(reactNativeOptions) {
  const task = reactNativeOptions.backgroundTask;
  if (!task || task.enabled === false) {
    return null;
  }
  const name = typeof task.name === "string" ? task.name.trim() : "";
  if (!name) {
    throw new Error("React Native background tasks require `reactNative.backgroundTask.name`.");
  }
  return {
    name,
    minimumInterval: task.minimumInterval,
    metadata: task.metadata,
    keepRegistered: task.keepRegistered === true
  };
}
function resolveNativeDownloadTarget(options) {
  const internal = options;
  return internal.saveTo || internal.fileName || options.saveTo || options.fileName || undefined;
}
function getFileNameFromUri(uri) {
  const normalized = uri.split("?")[0]?.split("#")[0] || uri;
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1] || "";
  return lastPart || undefined;
}
function normalizeNativeUploadFileSource(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const uri = candidate.uri || candidate.filePath || candidate.filepath || candidate.path;
  if (typeof uri !== "string" || uri.trim().length === 0) {
    return null;
  }
  return {
    uri,
    name: typeof candidate.name === "string" ? candidate.name : typeof candidate.filename === "string" ? candidate.filename : getFileNameFromUri(uri),
    type: typeof candidate.type === "string" ? candidate.type : typeof candidate.filetype === "string" ? candidate.filetype : undefined,
    fieldName: typeof candidate.fieldName === "string" ? candidate.fieldName : typeof candidate.field === "string" ? candidate.field : undefined,
    size: typeof candidate.size === "number" ? candidate.size : undefined
  };
}
function resolveNativeUploadConfig(options, reactNativeOptions) {
  const internal = options;
  const responseType = typeof internal.responseType === "string" ? internal.responseType.toLowerCase() : undefined;
  const isUploadMode = internal._isUpload || responseType === "upload";
  const explicitUpload = reactNativeOptions.upload;
  if (explicitUpload && explicitUpload.enabled !== false) {
    if (!isUploadMode) {
      throw new Error("React Native `reactNative.upload` requires `rezo.upload(...)` or `responseType: 'upload'`.");
    }
    const file = normalizeNativeUploadFileSource(explicitUpload);
    if (!file) {
      throw new Error("React Native file uploads require `reactNative.upload.uri`.");
    }
    return {
      file,
      fields: explicitUpload.fields,
      binaryStreamOnly: explicitUpload.binaryStreamOnly,
      inferred: false
    };
  }
  if (!isUploadMode) {
    return null;
  }
  const bodyCandidate = options.body ?? options.data;
  const file = normalizeNativeUploadFileSource(bodyCandidate);
  if (!file) {
    return null;
  }
  return {
    file,
    inferred: true
  };
}
function setRequestTransferSize(config, body) {
  if (!config.transfer || !body) {
    return;
  }
  if (typeof body === "string") {
    config.transfer.requestSize = body.length;
  } else if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
    config.transfer.requestSize = body.byteLength || body.length;
  } else if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    config.transfer.requestSize = body.toString().length;
  } else if (body instanceof RezoFormData && typeof body.getLengthSync === "function") {
    const len = body.getLengthSync();
    if (len !== undefined) {
      config.transfer.requestSize = len;
    }
  } else if (typeof body === "object" && !(typeof Blob !== "undefined" && body instanceof Blob)) {
    config.transfer.requestSize = JSON.stringify(body).length;
  }
}
function setNativeUploadTransferSize(config, uploadConfig) {
  if (typeof uploadConfig.file.size === "number" && uploadConfig.file.size >= 0) {
    config.transfer.requestSize = uploadConfig.file.size;
  }
}
function getBinaryResponseData(value) {
  if (value === null || value === undefined) {
    return new ArrayBuffer(0);
  }
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (value instanceof Uint8Array) {
    const clone = new Uint8Array(value.byteLength);
    clone.set(value);
    return clone.buffer;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value).buffer;
  }
  return new TextEncoder().encode(JSON.stringify(value ?? "")).buffer;
}
async function parseResponseData(payload, responseType, contentType, config) {
  const normalizedResponseType = normalizeResponseType(responseType);
  if (payload === null || payload === undefined) {
    return {
      data: payload,
      rawData: payload,
      bodySize: 0
    };
  }
  if (normalizedResponseType === "blob") {
    const blob = payload instanceof Blob ? payload : new Blob([payload instanceof ArrayBuffer ? payload : typeof payload === "string" ? payload : JSON.stringify(payload ?? "")]);
    return {
      data: blob,
      rawData: blob,
      bodySize: blob.size
    };
  }
  if (normalizedResponseType === "arrayBuffer" || normalizedResponseType === "buffer") {
    const buffer = getBinaryResponseData(payload);
    return {
      data: buffer,
      rawData: buffer,
      bodySize: buffer.byteLength
    };
  }
  if (normalizedResponseType === "text") {
    const text = typeof payload === "string" ? payload : payload instanceof ArrayBuffer ? new TextDecoder().decode(payload) : JSON.stringify(payload ?? "");
    return {
      data: text,
      rawData: text,
      bodySize: text.length
    };
  }
  if (normalizedResponseType === "json") {
    if (typeof payload === "string") {
      try {
        return {
          data: JSON.parse(payload),
          rawData: payload,
          bodySize: payload.length
        };
      } catch {
        return {
          data: payload,
          rawData: payload,
          bodySize: payload.length
        };
      }
    }
    return {
      data: payload,
      rawData: payload,
      bodySize: JSON.stringify(payload ?? "").length
    };
  }
  if (typeof payload === "string") {
    if (contentType.includes("application/json")) {
      try {
        return {
          data: JSON.parse(payload),
          rawData: payload,
          bodySize: payload.length
        };
      } catch {
        if (config.debug) {
          console.log("[Rezo Debug] Failed to parse JSON response payload from native RN upload transport");
        }
      }
    }
    return {
      data: payload,
      rawData: payload,
      bodySize: payload.length
    };
  }
  return {
    data: payload,
    rawData: payload,
    bodySize: JSON.stringify(payload ?? "").length
  };
}
function updateReactNativeTrackingData(config, data) {
  const trackingData = config.trackingData && typeof config.trackingData === "object" ? config.trackingData : {};
  const currentReactNative = trackingData.reactNative && typeof trackingData.reactNative === "object" ? trackingData.reactNative : {};
  config.trackingData = {
    ...trackingData,
    reactNative: {
      ...currentReactNative,
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => {
        const currentValue = currentReactNative[key];
        if (value && typeof value === "object" && !Array.isArray(value) && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
          return [key, { ...currentValue, ...value }];
        }
        return [key, value];
      }))
    }
  };
}
function isOfflineNetworkState(state) {
  if (!state) {
    return false;
  }
  return state.isConnected === false || state.isInternetReachable === false;
}
async function captureNetworkState(config, provider) {
  if (!provider) {
    return null;
  }
  const checkedAt = Date.now();
  try {
    const state = await provider.fetch();
    updateReactNativeTrackingData(config, {
      networkInfoEnabled: true,
      lastNetworkCheckAt: checkedAt,
      networkState: state
    });
    return state;
  } catch (error) {
    updateReactNativeTrackingData(config, {
      networkInfoEnabled: true,
      lastNetworkCheckAt: checkedAt,
      networkInfoError: error instanceof Error ? error.message : String(error)
    });
    if (config.debug) {
      console.log("[Rezo Debug] networkInfoProvider fetch error:", error);
    }
    return null;
  }
}
function createOfflineError(config, request) {
  const error = new RezoError("React Native request blocked because the device is offline.", config, "ENETUNREACH", request);
  error.message = "React Native request blocked because the device is offline.";
  return error;
}
async function prepareBackgroundTaskLifecycle(config, provider, backgroundTask) {
  if (!backgroundTask) {
    return;
  }
  if (!provider) {
    throw new Error("React Native background task requests require `reactNative.backgroundTaskProvider`. Install and configure a background task provider to use `reactNative.backgroundTask`.");
  }
  let alreadyRegistered = false;
  let registeredByAdapter = false;
  if (provider.isTaskRegistered) {
    try {
      alreadyRegistered = await provider.isTaskRegistered(backgroundTask.name);
    } catch (error) {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          isTaskRegisteredError: error instanceof Error ? error.message : String(error)
        }
      });
      if (config.debug) {
        console.log("[Rezo Debug] backgroundTaskProvider.isTaskRegistered error:", error);
      }
    }
  }
  if (!alreadyRegistered) {
    await provider.registerTask({
      name: backgroundTask.name,
      minimumInterval: backgroundTask.minimumInterval,
      metadata: backgroundTask.metadata
    });
    registeredByAdapter = true;
  }
  updateReactNativeTrackingData(config, {
    backgroundTask: {
      name: backgroundTask.name,
      minimumInterval: backgroundTask.minimumInterval,
      keepRegistered: backgroundTask.keepRegistered,
      alreadyRegistered,
      registeredByAdapter,
      active: true
    }
  });
  return async () => {
    if (backgroundTask.keepRegistered || !registeredByAdapter) {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregistered: false
        }
      });
      return;
    }
    try {
      await provider.unregisterTask(backgroundTask.name);
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregistered: true
        }
      });
    } catch (error) {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregisterError: error instanceof Error ? error.message : String(error)
        }
      });
      if (config.debug) {
        console.log("[Rezo Debug] backgroundTaskProvider.unregisterTask error:", error);
      }
    }
  };
}
function getUnsupportedModeError(options, reactNativeOptions, backgroundTask, nativeUpload) {
  const internal = options;
  const responseType = internal.responseType;
  const isStreamMode = internal._isStream || responseType === "stream";
  if (isStreamMode && !reactNativeOptions.streamTransport) {
    return new Error("React Native streaming requires `reactNative.streamTransport`. Configure a dedicated RN streaming transport to use `rezo.stream(...)`.");
  }
  const downloadTarget = resolveNativeDownloadTarget(options);
  if (downloadTarget && !reactNativeOptions.fileSystemAdapter?.downloadFile) {
    return new Error("React Native file downloads require `reactNative.fileSystemAdapter`. Install and configure an Expo FileSystem or react-native-fs adapter to use `saveTo` or `fileName`.");
  }
  if (nativeUpload && !reactNativeOptions.fileSystemAdapter?.uploadFile) {
    return new Error("React Native file uploads require `reactNative.fileSystemAdapter.uploadFile`. Install and configure an RN file upload provider to use `reactNative.upload` or file-based `rezo.upload(...)`.");
  }
  if (backgroundTask && !reactNativeOptions.backgroundTaskProvider) {
    return new Error("React Native background task requests require `reactNative.backgroundTaskProvider`. Install and configure a background task provider to use `reactNative.backgroundTask`.");
  }
  return null;
}
export async function executeRequest(options, defaultOptions, jar) {
  if (!Environment.hasFetch) {
    throw new Error("Fetch API is not available in this React Native environment");
  }
  const reactNativeOptions = resolveReactNativeOptions(options, defaultOptions);
  const backgroundTask = resolveBackgroundTaskConfig(reactNativeOptions);
  const nativeDownloadTarget = resolveNativeDownloadTarget(options);
  const nativeUpload = resolveNativeUploadConfig(options, reactNativeOptions);
  const unsupportedModeError = getUnsupportedModeError(options, reactNativeOptions, backgroundTask, nativeUpload);
  if (unsupportedModeError) {
    throw unsupportedModeError;
  }
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions);
  const requestOptionsForPrep = nativeDownloadTarget ? { ...options, saveTo: undefined, fileName: undefined } : options;
  const configResult = prepareHTTPOptions(requestOptionsForPrep, jar, { defaultOptions: d_options });
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  if (!mainConfig.errors) {
    mainConfig.errors = [];
  }
  updateReactNativeTrackingData(mainConfig, {
    fileSystemAdapter: reactNativeOptions.fileSystemAdapter?.name || null,
    streamTransport: reactNativeOptions.streamTransport?.name || null,
    networkInfoEnabled: !!reactNativeOptions.networkInfoProvider,
    backgroundTaskEnabled: !!reactNativeOptions.backgroundTaskProvider,
    backgroundTaskRequested: !!backgroundTask,
    nativeUploadRequested: !!nativeUpload
  });
  mainConfig.originalRequest = options;
  if (nativeDownloadTarget) {
    mainConfig.fileName = nativeDownloadTarget;
    fetchOptions.fileName = nativeDownloadTarget;
  } else if (nativeUpload?.file.name) {
    mainConfig.fileName = nativeUpload.file.name;
  }
  const perform = new RezoPerformance;
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
  const isSecureRequest = requestUrl.startsWith("https:");
  const hasNativeStreaming = !!reactNativeOptions.streamTransport;
  const hasNativeFileDownload = !!reactNativeOptions.fileSystemAdapter?.downloadFile && (reactNativeOptions.fileSystemAdapter.capabilities?.fileDownload ?? true);
  const hasNativeDownloadProgress = hasNativeFileDownload && (reactNativeOptions.fileSystemAdapter?.capabilities?.downloadProgress ?? true);
  const hasNativeFileUpload = !!reactNativeOptions.fileSystemAdapter?.uploadFile && (reactNativeOptions.fileSystemAdapter.capabilities?.uploadFromFile ?? true);
  const hasNativeUploadProgress = hasNativeFileUpload && (reactNativeOptions.fileSystemAdapter?.capabilities?.uploadProgress ?? true);
  const adapterFeatures = [
    "fetch",
    "timeout",
    "abort",
    !mainConfig.disableJar ? "cookies" : null,
    mainConfig.maxRedirects > 0 ? "redirects" : null,
    mainConfig.retry ? "retry" : null,
    cacheOption ? "cache" : null,
    hasNativeStreaming ? "streaming" : null,
    hasNativeFileDownload ? "file-download" : null,
    hasNativeDownloadProgress ? "download-progress" : null,
    hasNativeFileUpload ? "file-upload" : null,
    hasNativeUploadProgress ? "upload-progress" : null,
    reactNativeOptions.networkInfoProvider ? "network-info" : null,
    reactNativeOptions.backgroundTaskProvider ? "background-tasks" : null,
    "hooks"
  ].filter(Boolean);
  mainConfig.adapterMetadata = {
    version: "react-native",
    features: adapterFeatures,
    capabilities: {
      fetch: true,
      cookies: !mainConfig.disableJar,
      redirects: mainConfig.maxRedirects > 0,
      timeout: true,
      abort: true,
      retry: !!mainConfig.retry,
      cache: !!cacheOption,
      afterHeaders: true,
      afterParse: true,
      onAbort: true,
      onTimeout: true,
      finalUrl: true,
      progress: hasNativeStreaming || hasNativeDownloadProgress || hasNativeUploadProgress,
      streaming: hasNativeStreaming,
      fileDownload: hasNativeFileDownload,
      downloadProgress: hasNativeDownloadProgress,
      uploadProgress: hasNativeUploadProgress,
      networkInfo: !!reactNativeOptions.networkInfoProvider,
      backgroundTasks: !!reactNativeOptions.backgroundTaskProvider,
      proxy: false,
      http2: false,
      ssl: isSecureRequest
    }
  };
  mainConfig.features = {
    http2: false,
    compression: false,
    cookies: !mainConfig.disableJar,
    redirects: mainConfig.maxRedirects > 0,
    proxy: false,
    timeout: true,
    retry: !!mainConfig.retry,
    cache: !!cacheOption,
    metrics: true,
    events: true,
    validation: true,
    browser: false,
    ssl: isSecureRequest
  };
  let cache;
  let requestHeaders;
  let cachedEntry;
  if (cacheOption) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
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
      if (conditionalHeaders.etag) {
        headers.set("If-None-Match", conditionalHeaders.etag);
      }
      if (conditionalHeaders.lastModified) {
        headers.set("If-Modified-Since", conditionalHeaders.lastModified);
      }
      fetchOptions.headers = headers;
    }
  }
  const responseType = typeof options.responseType === "string" ? options.responseType.toLowerCase() : undefined;
  const isStream = options._isStream || responseType === "stream";
  const isDownload = options._isDownload || responseType === "download" || !!options.fileName || !!options.saveTo;
  const isUpload = options._isUpload || responseType === "upload";
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = options._streamResponse || new StreamResponse;
  } else if (isDownload) {
    downloadResponse = options._downloadResponse || (() => {
      const fileName = options.fileName || options.saveTo || "";
      const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
      return new DownloadResponse(fileName, url);
    })();
  } else if (isUpload) {
    uploadResponse = options._uploadResponse || (() => {
      const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
      return new UploadResponse(url, nativeUpload?.file.name);
    })();
  }
  const runRequest = () => {
    if (nativeDownloadTarget && downloadResponse && reactNativeOptions.fileSystemAdapter?.downloadFile) {
      return executeNativeTransferRequestWithRetry(mainConfig, fetchOptions, options, perform, downloadResponse, () => executeNativeFileDownloadRequest(fetchOptions, mainConfig, downloadResponse, reactNativeOptions.fileSystemAdapter, nativeDownloadTarget, reactNativeOptions.networkInfoProvider));
    }
    if (streamResponse && reactNativeOptions.streamTransport) {
      return executeNativeStreamRequestWithRetry(mainConfig, fetchOptions, options, perform, streamResponse, reactNativeOptions.streamTransport, reactNativeOptions.networkInfoProvider);
    }
    if (nativeUpload && uploadResponse && reactNativeOptions.fileSystemAdapter?.uploadFile) {
      return executeNativeTransferRequestWithRetry(mainConfig, fetchOptions, options, perform, uploadResponse, () => executeNativeFileUploadRequest(fetchOptions, mainConfig, uploadResponse, reactNativeOptions.fileSystemAdapter, nativeUpload, reactNativeOptions.networkInfoProvider));
    }
    return executeFetchRequest(fetchOptions, mainConfig, options, perform, reactNativeOptions.networkInfoProvider, streamResponse, downloadResponse, uploadResponse);
  };
  const res = (async () => {
    const cleanupBackgroundTask = await prepareBackgroundTaskLifecycle(mainConfig, reactNativeOptions.backgroundTaskProvider, backgroundTask);
    try {
      return await runRequest();
    } finally {
      if (cleanupBackgroundTask) {
        await cleanupBackgroundTask();
      }
    }
  })();
  if (streamResponse) {
    res.catch((err) => {
      streamResponse.emit("error", err);
    });
    return streamResponse;
  } else if (downloadResponse) {
    res.catch((err) => {
      downloadResponse.emit("error", err);
    });
    return downloadResponse;
  } else if (uploadResponse) {
    res.catch((err) => {
      uploadResponse.emit("error", err);
    });
    return uploadResponse;
  }
  const response = await res;
  if (cache && !isStream && !isDownload && !isUpload) {
    if (response.status === 304 && cachedEntry) {
      const responseHeaders = response.headers instanceof RezoHeaders ? Object.fromEntries(response.headers.entries()) : response.headers;
      const updatedCached = cache.updateRevalidated(method, requestUrl, responseHeaders, requestHeaders);
      if (updatedCached) {
        return buildCachedRezoResponse(updatedCached, mainConfig);
      }
      return buildCachedRezoResponse(cachedEntry, mainConfig);
    }
    if (response.status >= 200 && response.status < 300) {
      cache.set(method, requestUrl, response, requestHeaders);
    }
  }
  return response;
}
async function executeNativeFileDownloadRequest(fetchOptions, config, downloadResult, fileSystemAdapter, destination, networkInfoProvider) {
  const { fullUrl, body } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "GET").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.fileName = destination;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: fetchOptions.timeout,
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  downloadResult.emit("start", startEvent);
  const preparedBody = await prepareBody(body);
  setRequestTransferSize(config, body);
  let status = 0;
  let statusText = "OK";
  let responseHeaders = new RezoHeaders;
  let contentType = "";
  let contentLength = 0;
  let finalUrl = url;
  let progressLoaded = 0;
  let headersHandled = false;
  let responseCookies = createEmptyCookies();
  const emitHeaders = async (event) => {
    headersHandled = true;
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    status = event.status;
    statusText = event.statusText || statusText;
    responseHeaders = new RezoHeaders(event.headers || {});
    contentType = event.contentType || responseHeaders.get("content-type") || contentType;
    const headerContentLength = parseInt(responseHeaders.get("content-length") || "0", 10) || 0;
    contentLength = event.contentLength ?? (headerContentLength || contentLength);
    finalUrl = event.finalUrl || finalUrl;
    responseCookies = await parseCookiesFromHeaders(new Headers(event.headers || {}), finalUrl, config);
    config.responseCookies = responseCookies;
    config.finalUrl = finalUrl;
    config.status = status;
    config.statusText = statusText;
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength || undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    downloadResult.emit("headers", headersEvent);
    downloadResult.emit("status", status, statusText);
    downloadResult.emit("cookies", responseCookies.array);
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      for (const hook of config.hooks.afterHeaders) {
        await hook(headersEvent, config);
      }
    }
  };
  const emitProgress = (event) => {
    progressLoaded = event.loaded;
    config.transfer.bodySize = event.loaded;
    config.transfer.responseSize = event.loaded;
    const total = event.total ?? contentLength ?? 0;
    const elapsedMs = Math.max(performance.now() - timing.startTime, 1);
    const speed = event.speed ?? event.loaded / (elapsedMs / 1000);
    const averageSpeed = event.averageSpeed ?? speed;
    const estimatedTime = event.estimatedTime ?? (total > event.loaded && averageSpeed > 0 ? (total - event.loaded) / averageSpeed * 1000 : 0);
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed,
      averageSpeed,
      estimatedTime,
      timestamp: Date.now()
    };
    downloadResult.emit("progress", progressEvent);
    downloadResult.emit("download-progress", progressEvent);
    const onDownloadProgress = config.originalRequest?.onDownloadProgress;
    if (typeof onDownloadProgress === "function") {
      try {
        onDownloadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onDownloadProgress callback error:", error);
        }
      }
    }
  };
  const result = await executeManagedNativeTransport(config, fetchOptions, url, timing, (signal) => fileSystemAdapter.downloadFile({
    url,
    destination,
    method,
    headers: Object.fromEntries(reqHeaders.entries()),
    body: preparedBody,
    timeout: config.timeout ?? null,
    signal,
    onHeaders: emitHeaders,
    onProgress: emitProgress
  }));
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  status = result.status || status || 200;
  statusText = result.statusText || statusText;
  if (result.headers) {
    responseHeaders = new RezoHeaders(result.headers);
  }
  contentType = result.contentType || responseHeaders.get("content-type") || contentType;
  contentLength = result.contentLength ?? contentLength;
  finalUrl = result.finalUrl || finalUrl;
  responseCookies = await parseCookiesFromHeaders(new Headers(result.headers || {}), finalUrl, config);
  config.responseCookies = responseCookies;
  config.finalUrl = finalUrl;
  config.status = status;
  config.statusText = statusText;
  const bodySize = result.fileSize ?? result.contentLength ?? (contentLength || progressLoaded);
  updateTiming(config, timing, bodySize);
  if (!headersHandled) {
    await emitHeaders({
      status,
      statusText,
      headers: Object.fromEntries(responseHeaders.entries()),
      finalUrl,
      contentType,
      contentLength: bodySize
    });
  }
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    throw builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
      status,
      statusText,
      headers: responseHeaders,
      data: null
    }, config, fetchOptions);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const finalResponse = {
    data: undefined,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: bodySize,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
  const downloadFinishEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: bodySize,
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    fileName: result.filePath || destination,
    fileSize: bodySize,
    timing: {
      ...getTimingDurations(config),
      download: getTimingDurations(config).download || 0
    },
    averageSpeed: getTimingDurations(config).download ? bodySize / getTimingDurations(config).download * 1000 : 0,
    config: sanitizeConfig(config)
  };
  downloadResult.emit("finish", downloadFinishEvent);
  downloadResult.emit("done", downloadFinishEvent);
  downloadResult.emit("complete", downloadFinishEvent);
  downloadResult._markFinished();
  return finalResponse;
}
async function executeNativeStreamRequestWithRetry(config, fetchOptions, options, perform, streamResult, streamTransport, networkInfoProvider) {
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  let totalAttempts = 0;
  streamResult.emit("initiated");
  while (true) {
    totalAttempts++;
    if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
      throw builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
    }
    try {
      const response = await executeNativeStreamRequest(fetchOptions, config, streamResult, streamTransport, networkInfoProvider);
      if (isInternalRedirectResponse(response)) {
        const redirectDuration = perform.now();
        perform.reset();
        await applyManualRedirect(config, fetchOptions, options, response, redirectDuration, streamResult);
        continue;
      }
      return response;
    } catch (error) {
      const rezoError = error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
      const bodyStarted = rezoError.__rezoStreamBodyStarted === true;
      if (rezoError.response?.status && shouldWaitOnStatus(rezoError.response.status, options.waitOnStatus) && !bodyStarted) {
        const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
        const waitResult = await handleRateLimitWait({
          status: rezoError.response.status,
          headers: rezoError.response.headers,
          data: rezoError.response.data,
          url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
          method: fetchOptions.method || "GET",
          config,
          options,
          currentWaitAttempt: rateLimitWaitAttempt
        });
        if (waitResult.shouldRetry) {
          config._rateLimitWaitAttempt = waitResult.waitAttempt;
          perform.reset();
          continue;
        }
      }
      config.errors.push({
        attempt: config.retryAttempts + 1,
        error: rezoError,
        duration: perform.now()
      });
      perform.reset();
      if (!retryConfig || bodyStarted) {
        throw rezoError;
      }
      const method = fetchOptions.method || "GET";
      retryAttempt++;
      if (retryConfig.condition) {
        const shouldContinue = await retryConfig.condition(rezoError, retryAttempt);
        if (shouldContinue === false) {
          if (retryConfig.onRetryExhausted) {
            await retryConfig.onRetryExhausted(rezoError, retryAttempt);
          }
          throw rezoError;
        }
      } else {
        const canRetry = shouldRetry(rezoError, retryAttempt, method, retryConfig);
        if (!canRetry) {
          if (retryAttempt > retryConfig.maxRetries) {
            debugLog.maxRetries(config, retryConfig.maxRetries);
            if (retryConfig.onRetryExhausted) {
              await retryConfig.onRetryExhausted(rezoError, retryAttempt);
            }
          }
          throw rezoError;
        }
      }
      const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
      debugLog.retry(config, retryAttempt, retryConfig.maxRetries, rezoError.status || 0, currentDelay);
      if (retryConfig.onRetry) {
        const shouldProceed = await retryConfig.onRetry(rezoError, retryAttempt, currentDelay);
        if (shouldProceed === false) {
          throw rezoError;
        }
      }
      if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
        for (const hook of config.hooks.beforeRetry) {
          try {
            await hook(config, rezoError, retryAttempt);
          } catch (hookErr) {
            if (config.debug) {
              console.log("[Rezo Debug] beforeRetry hook error:", hookErr);
            }
          }
        }
      }
      if (currentDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
      }
      config.retryAttempts++;
    }
  }
}
async function executeNativeStreamRequest(fetchOptions, config, streamResult, streamTransport, networkInfoProvider) {
  const { fullUrl, body } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "GET").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: fetchOptions.timeout,
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  streamResult.emit("start", startEvent);
  const preparedBody = await prepareBody(body);
  setRequestTransferSize(config, body);
  const abortController = new AbortController;
  let timeoutId;
  let abortedByTimeout = false;
  let abortedBySignal = false;
  const configAbortListener = () => {
    abortedBySignal = true;
    abortController.abort();
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
  if (config.timeout) {
    timeoutId = setTimeout(() => {
      abortedByTimeout = true;
      abortController.abort();
    }, config.timeout);
  }
  if (config.signal?.aborted) {
    abortedBySignal = true;
    abortController.abort();
  } else if (config.signal) {
    config.signal.addEventListener("abort", configAbortListener, { once: true });
  }
  let status = 200;
  let statusText = "OK";
  let responseHeaders = new RezoHeaders;
  let contentType = "";
  let contentLength = 0;
  let finalUrl = url;
  let bytesReceived = 0;
  let responseCookies = createEmptyCookies();
  let redirectLocation = null;
  let bodyStarted = false;
  const emitHeaders = async (event) => {
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    status = event.status;
    statusText = event.statusText || statusText;
    responseHeaders = new RezoHeaders(event.headers || {});
    contentType = event.contentType || responseHeaders.get("content-type") || contentType;
    const headerContentLength = parseInt(responseHeaders.get("content-length") || "0", 10) || 0;
    contentLength = event.contentLength ?? (headerContentLength || contentLength);
    finalUrl = event.finalUrl || finalUrl;
    responseCookies = await parseCookiesFromHeaders(new Headers(event.headers || {}), finalUrl, config);
    config.responseCookies = responseCookies;
    config.finalUrl = finalUrl;
    config.status = status;
    config.statusText = statusText;
    const locationHeader = responseHeaders.get("location") || responseHeaders.get("Location");
    if (status >= 300 && status < 400 && locationHeader) {
      redirectLocation = resolveRedirectLocation(url, locationHeader);
      finalUrl = redirectLocation;
      config.finalUrl = finalUrl;
      return;
    }
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength || undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    streamResult.emit("headers", headersEvent);
    streamResult.emit("status", status, statusText);
    streamResult.emit("cookies", responseCookies.array);
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      for (const hook of config.hooks.afterHeaders) {
        await hook(headersEvent, config);
      }
    }
  };
  const emitProgress = (event) => {
    if (redirectLocation) {
      return;
    }
    bytesReceived = Math.max(bytesReceived, event.loaded);
    config.transfer.bodySize = bytesReceived;
    config.transfer.responseSize = bytesReceived;
    const total = event.total ?? contentLength ?? 0;
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed: event.speed ?? event.averageSpeed ?? 0,
      averageSpeed: event.averageSpeed ?? event.speed ?? 0,
      estimatedTime: event.estimatedTime ?? 0,
      timestamp: Date.now()
    };
    streamResult.emit("progress", progressEvent);
    streamResult.emit("download-progress", progressEvent);
    const onDownloadProgress = config.originalRequest?.onDownloadProgress;
    if (typeof onDownloadProgress === "function") {
      try {
        onDownloadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onDownloadProgress callback error:", error);
        }
      }
    }
  };
  try {
    await streamTransport.stream({
      url,
      method,
      headers: Object.fromEntries(reqHeaders.entries()),
      body: preparedBody,
      timeout: config.timeout ?? null,
      signal: abortController.signal,
      onHeaders: emitHeaders,
      onChunk: async (chunk) => {
        if (redirectLocation) {
          return;
        }
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const chunkSize = typeof chunk === "string" ? chunk.length : chunk.byteLength;
        bytesReceived += chunkSize;
        if (chunkSize > 0) {
          bodyStarted = true;
        }
        config.transfer.bodySize = bytesReceived;
        config.transfer.responseSize = bytesReceived;
        streamResult.emit("data", chunk);
      },
      onProgress: emitProgress
    });
  } catch (err) {
    const isAbortError = err?.name === "AbortError" || abortController.signal.aborted;
    if (isAbortError) {
      const elapsed = performance.now() - timing.startTime;
      const message = abortedByTimeout && config.timeout ? `Request timeout after ${config.timeout}ms` : "Request was aborted";
      if (abortedByTimeout) {
        runOnTimeoutHooks(config, url, elapsed);
      }
      runOnAbortHooks(config, abortedByTimeout ? "timeout" : abortedBySignal ? "signal" : "error", message, url, elapsed);
      const abortError = buildSmartError(config, fetchOptions, new Error(message));
      abortError.__rezoStreamBodyStarted = bodyStarted;
      throw abortError;
    }
    err.__rezoStreamBodyStarted = bodyStarted;
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (config.signal) {
      config.signal.removeEventListener("abort", configAbortListener);
    }
  }
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  if (redirectLocation) {
    return {
      data: undefined,
      status,
      statusText,
      headers: responseHeaders,
      cookies: responseCookies,
      config,
      contentType,
      contentLength: contentLength || 0,
      finalUrl: redirectLocation,
      urls: buildUrlTree(config, redirectLocation),
      __redirectLocation: redirectLocation
    };
  }
  updateTiming(config, timing, bytesReceived);
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    throw builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
      status,
      statusText,
      headers: responseHeaders,
      data: null
    }, config, fetchOptions);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const streamFinishEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: bytesReceived,
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    timing: getTimingDurations(config),
    config: sanitizeConfig(config)
  };
  streamResult.emit("finish", streamFinishEvent);
  streamResult.emit("done", streamFinishEvent);
  streamResult.emit("complete", streamFinishEvent);
  streamResult.emit("end");
  streamResult._markFinished();
  return {
    data: undefined,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: bytesReceived,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
}
async function executeNativeFileUploadRequest(fetchOptions, config, uploadResult, fileSystemAdapter, uploadConfig, networkInfoProvider) {
  const { fullUrl } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "POST").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.fileName = uploadConfig.file.name || config.fileName || null;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  setNativeUploadTransferSize(config, uploadConfig);
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: fetchOptions.timeout,
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  uploadResult.emit("start", startEvent);
  let uploadedBytes = 0;
  const emitProgress = (event) => {
    uploadedBytes = event.loaded;
    if (typeof event.total === "number" && event.total >= 0) {
      config.transfer.requestSize = event.total;
    } else if (event.loaded > config.transfer.requestSize) {
      config.transfer.requestSize = event.loaded;
    }
    const total = event.total ?? config.transfer.requestSize ?? 0;
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed: event.speed ?? event.averageSpeed ?? 0,
      averageSpeed: event.averageSpeed ?? event.speed ?? 0,
      estimatedTime: event.estimatedTime ?? 0,
      timestamp: Date.now()
    };
    uploadResult.emit("progress", progressEvent);
    uploadResult.emit("upload-progress", progressEvent);
    const onUploadProgress = config.originalRequest?.onUploadProgress;
    if (typeof onUploadProgress === "function") {
      try {
        onUploadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onUploadProgress callback error:", error);
        }
      }
    }
  };
  const result = await executeManagedNativeTransport(config, fetchOptions, url, timing, (signal) => fileSystemAdapter.uploadFile({
    url,
    method,
    headers: Object.fromEntries(reqHeaders.entries()),
    file: uploadConfig.file,
    fields: uploadConfig.fields,
    binaryStreamOnly: uploadConfig.binaryStreamOnly,
    timeout: config.timeout ?? null,
    signal,
    onProgress: emitProgress
  }));
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  const status = result.status || 200;
  const statusText = result.statusText || "OK";
  const responseHeaders = new RezoHeaders(result.headers || {});
  const contentType = result.contentType || responseHeaders.get("content-type") || "";
  const contentLength = result.contentLength ?? (parseInt(responseHeaders.get("content-length") || "0", 10) || 0);
  const finalUrl = result.finalUrl || url;
  const nativeHeaders = new Headers(result.headers || {});
  const responseCookies = await parseCookiesFromHeaders(nativeHeaders, finalUrl, config);
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  config.responseCookies = responseCookies;
  config.finalUrl = finalUrl;
  config.status = status;
  config.statusText = statusText;
  const headersEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: contentLength || undefined,
    cookies: responseCookies.array,
    timing: {
      firstByte: config.timing.responseStart - config.timing.startTime,
      total: performance.now() - config.timing.startTime
    }
  };
  uploadResult.emit("headers", headersEvent);
  uploadResult.emit("status", status, statusText);
  uploadResult.emit("cookies", responseCookies.array);
  uploadResult.status = status;
  uploadResult.statusText = statusText;
  if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
    for (const hook of config.hooks.afterHeaders) {
      await hook(headersEvent, config);
    }
  }
  const parseStart = performance.now();
  const parsed = await parseResponseData(result.body, config.responseType || fetchOptions.responseType || "auto", contentType, config);
  const parseDuration = performance.now() - parseStart;
  const responseData = runAfterParseHooks(parsed.data, parsed.rawData, contentType, parseDuration, config);
  updateTiming(config, timing, parsed.bodySize);
  if (uploadedBytes > config.transfer.requestSize) {
    config.transfer.requestSize = uploadedBytes;
  }
  if (typeof result.uploadSize === "number" && result.uploadSize >= 0) {
    config.transfer.requestSize = result.uploadSize;
  }
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    throw builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
      status,
      statusText,
      headers: responseHeaders,
      data: responseData
    }, config, fetchOptions);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const finalResponse = {
    data: responseData,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: parsed.bodySize,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
  const timingDurations = getTimingDurations(config);
  const uploadFinishEvent = {
    response: {
      status,
      statusText,
      headers: responseHeaders,
      data: responseData,
      contentType,
      contentLength: parsed.bodySize
    },
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    uploadSize: config.transfer.requestSize || uploadedBytes || uploadConfig.file.size || 0,
    fileName: result.fileName || uploadConfig.file.name,
    timing: {
      ...timingDurations,
      upload: timingDurations.firstByte || 0,
      waiting: timingDurations.download > 0 && timingDurations.firstByte > 0 ? timingDurations.download - timingDurations.firstByte : 0
    },
    averageUploadSpeed: timingDurations.firstByte && (config.transfer.requestSize || uploadedBytes) ? (config.transfer.requestSize || uploadedBytes) / timingDurations.firstByte * 1000 : 0,
    averageDownloadSpeed: timingDurations.download ? parsed.bodySize / timingDurations.download * 1000 : 0,
    config: sanitizeConfig(config)
  };
  uploadResult.emit("finish", uploadFinishEvent);
  uploadResult.emit("done", uploadFinishEvent);
  uploadResult.emit("complete", uploadFinishEvent);
  uploadResult._markFinished();
  return finalResponse;
}
async function executeFetchRequest(fetchOptions, config, options, perform, networkInfoProvider, streamResult, downloadResult, uploadResult) {
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const startTime = performance.now();
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
  while (true) {
    totalAttempts++;
    if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
      const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
      throw error;
    }
    try {
      const response = await executeSingleRequest(config, fetchOptions, timing, networkInfoProvider, streamResult, downloadResult, uploadResult);
      if (!(response instanceof RezoError) && isInternalRedirectResponse(response)) {
        const redirectDuration = perform.now();
        perform.reset();
        await applyManualRedirect(config, fetchOptions, options, response, redirectDuration);
        continue;
      }
      if (response instanceof RezoError) {
        if (options.cache && response.response?.status === 304) {
          return response.response;
        }
        if (response.response?.status && shouldWaitOnStatus(response.response.status, options.waitOnStatus)) {
          const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
          const waitResult = await handleRateLimitWait({
            status: response.response.status,
            headers: response.response.headers,
            data: response.response.data,
            url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
            method: fetchOptions.method || "GET",
            config,
            options,
            currentWaitAttempt: rateLimitWaitAttempt
          });
          if (waitResult.shouldRetry) {
            config._rateLimitWaitAttempt = waitResult.waitAttempt;
            perform.reset();
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
          throw response;
        }
        const method = fetchOptions.method || "GET";
        retryAttempt++;
        if (retryConfig.condition) {
          const shouldContinue = await retryConfig.condition(response, retryAttempt);
          if (shouldContinue === false) {
            if (retryConfig.onRetryExhausted) {
              await retryConfig.onRetryExhausted(response, retryAttempt);
            }
            throw response;
          }
        } else {
          const canRetry = shouldRetry(response, retryAttempt, method, retryConfig);
          if (!canRetry) {
            if (retryAttempt > retryConfig.maxRetries) {
              debugLog.maxRetries(config, retryConfig.maxRetries);
              if (retryConfig.onRetryExhausted) {
                await retryConfig.onRetryExhausted(response, retryAttempt);
              }
            }
            throw response;
          }
        }
        const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
        debugLog.retry(config, retryAttempt, retryConfig.maxRetries, response.status || 0, currentDelay);
        if (retryConfig.onRetry) {
          const shouldProceed = await retryConfig.onRetry(response, retryAttempt, currentDelay);
          if (shouldProceed === false) {
            throw response;
          }
        }
        if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
          for (const hook of config.hooks.beforeRetry) {
            try {
              await hook(config, response, retryAttempt);
            } catch (hookErr) {
              if (config.debug) {
                console.log("[Rezo Debug] beforeRetry hook error:", hookErr);
              }
            }
          }
        }
        if (currentDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
        }
        config.retryAttempts++;
        continue;
      }
      return response;
    } catch (error) {
      if (error instanceof RezoError) {
        throw error;
      }
      throw buildSmartError(config, fetchOptions, error);
    }
  }
}
async function executeSingleRequest(config, fetchOptions, timing, networkInfoProvider, streamResult, downloadResult, uploadResult) {
  try {
    const { fullUrl, body } = fetchOptions;
    const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
    const isSecure = url.startsWith("https:");
    const method = (fetchOptions.method || "GET").toUpperCase();
    const normalizedResponseType = normalizeResponseType(config.responseType || fetchOptions.responseType || "auto");
    config.adapterUsed = "react-native";
    config.isSecure = isSecure;
    config.finalUrl = url;
    config.network.protocol = isSecure ? "https" : "http";
    config.responseType = normalizedResponseType;
    fetchOptions.responseType = normalizedResponseType;
    const eventEmitter = streamResult || downloadResult || uploadResult;
    const networkState = await captureNetworkState(config, networkInfoProvider);
    if (isOfflineNetworkState(networkState)) {
      const error = createOfflineError(config, fetchOptions);
      debugLog.error(config, error);
      if (eventEmitter) {
        eventEmitter.emit("error", error);
      }
      return error;
    }
    debugLog.requestStart(config, url, method);
    const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
    const headers = toFetchHeaders(reqHeaders);
    if (eventEmitter) {
      const startEvent = {
        url,
        method,
        headers: new RezoHeaders(reqHeaders),
        timestamp: timing.startTime,
        timeout: fetchOptions.timeout,
        maxRedirects: config.maxRedirects
      };
      eventEmitter.emit("start", startEvent);
    }
    const abortController = new AbortController;
    let timeoutId;
    let abortedByTimeout = false;
    let abortedBySignal = false;
    const configAbortListener = () => {
      abortedBySignal = true;
      abortController.abort();
      if (timeoutId)
        clearTimeout(timeoutId);
    };
    if (config.timeout) {
      timeoutId = setTimeout(() => {
        abortedByTimeout = true;
        abortController.abort();
      }, config.timeout);
    }
    if (config.signal) {
      config.signal.addEventListener("abort", configAbortListener, { once: true });
    }
    const preparedBody = await prepareBody(body);
    setRequestTransferSize(config, body);
    const fetchInit = {
      method,
      headers,
      body: preparedBody,
      signal: abortController.signal,
      redirect: "manual"
    };
    let response;
    try {
      response = await fetch(url, fetchInit);
    } catch (err) {
      if (timeoutId)
        clearTimeout(timeoutId);
      if (config.signal) {
        config.signal.removeEventListener("abort", configAbortListener);
      }
      if (err.name === "AbortError") {
        const elapsed = performance.now() - timing.startTime;
        const message = abortedByTimeout && config.timeout ? `Request timeout after ${config.timeout}ms` : "Request was aborted";
        if (abortedByTimeout) {
          runOnTimeoutHooks(config, url, elapsed);
        }
        runOnAbortHooks(config, abortedByTimeout ? "timeout" : abortedBySignal ? "signal" : "error", message, url, elapsed);
        const error = buildSmartError(config, fetchOptions, new Error(message));
        if (eventEmitter)
          eventEmitter.emit("error", error);
        return error;
      }
      throw err;
    } finally {
      if (timeoutId)
        clearTimeout(timeoutId);
      if (config.signal) {
        config.signal.removeEventListener("abort", configAbortListener);
      }
    }
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    const status = response.status;
    const statusText = response.statusText;
    const responseHeaders = fromFetchHeaders(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");
    const finalUrl = response.url || url;
    const responseCookies = await parseCookiesFromHeaders(response.headers, finalUrl, config);
    config.responseCookies = responseCookies;
    config.finalUrl = finalUrl;
    config.status = status;
    config.statusText = statusText;
    const locationHeader = response.headers.get("location") || response.headers.get("Location");
    const isRedirect = status >= 300 && status < 400 && !!locationHeader;
    if (isRedirect && locationHeader) {
      const redirectLocation = resolveRedirectLocation(url, locationHeader);
      const redirectResponse = {
        data: undefined,
        status,
        statusText,
        headers: responseHeaders,
        cookies: responseCookies,
        config,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : 0,
        finalUrl: redirectLocation,
        urls: buildUrlTree(config, redirectLocation),
        __redirectLocation: redirectLocation
      };
      return redirectResponse;
    }
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    if (eventEmitter) {
      eventEmitter.emit("headers", headersEvent);
      eventEmitter.emit("status", status, statusText);
      eventEmitter.emit("cookies", responseCookies.array);
      if (downloadResult) {
        downloadResult.status = status;
        downloadResult.statusText = statusText;
      } else if (uploadResult) {
        uploadResult.status = status;
        uploadResult.statusText = statusText;
      }
    }
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      for (const hook of config.hooks.afterHeaders) {
        await hook(headersEvent, config);
      }
    }
    let responseData;
    let rawResponseData;
    let bodySize = 0;
    const responseType = normalizeResponseType(config.responseType || fetchOptions.responseType || "auto");
    const parseStart = performance.now();
    if (responseType === "blob") {
      const blob = await response.blob();
      rawResponseData = blob;
      responseData = blob;
      bodySize = blob.size;
    } else if (responseType === "arrayBuffer" || responseType === "buffer") {
      const buffer = await response.arrayBuffer();
      rawResponseData = buffer;
      responseData = buffer;
      bodySize = buffer.byteLength;
    } else if (responseType === "text") {
      const text = await response.text();
      rawResponseData = text;
      responseData = text;
      bodySize = text.length;
    } else if (responseType === "json") {
      const text = await response.text();
      rawResponseData = text;
      bodySize = text.length;
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = text;
      }
    } else {
      const text = await response.text();
      rawResponseData = text;
      bodySize = text.length;
      if (contentType.includes("application/json")) {
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }
      } else {
        responseData = text;
      }
    }
    const parseDuration = performance.now() - parseStart;
    responseData = runAfterParseHooks(responseData, rawResponseData, contentType, parseDuration, config);
    updateTiming(config, timing, bodySize);
    const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
    const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
    if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
      const error = builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
        status,
        statusText,
        headers: responseHeaders,
        data: responseData
      }, config, fetchOptions);
      if (eventEmitter)
        eventEmitter.emit("error", error);
      return error;
    }
    const duration = performance.now() - timing.startTime;
    debugLog.response(config, status, statusText, duration);
    debugLog.responseHeaders(config, responseHeaders.toObject());
    debugLog.cookies(config, mergedCookies.array.length);
    debugLog.timing(config, {
      ttfb: timing.firstByteTime ? timing.firstByteTime - timing.startTime : undefined,
      total: duration
    });
    const finalResponse = {
      data: responseData,
      status,
      statusText,
      headers: responseHeaders,
      cookies: mergedCookies,
      config,
      contentType,
      contentLength: bodySize,
      finalUrl,
      urls: buildUrlTree(config, finalUrl)
    };
    debugLog.complete(config, finalUrl);
    if (streamResult) {
      const streamFinishEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: bodySize,
        finalUrl,
        cookies: mergedCookies,
        urls: buildUrlTree(config, finalUrl),
        timing: getTimingDurations(config),
        config: sanitizeConfig(config)
      };
      streamResult.emit("finish", streamFinishEvent);
      streamResult.emit("done", streamFinishEvent);
      streamResult.emit("complete", streamFinishEvent);
      streamResult.emit("end");
      streamResult._markFinished();
    }
    if (downloadResult) {
      const downloadFinishEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: bodySize,
        finalUrl,
        cookies: mergedCookies,
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
      downloadResult.emit("finish", downloadFinishEvent);
      downloadResult.emit("done", downloadFinishEvent);
      downloadResult.emit("complete", downloadFinishEvent);
      downloadResult._markFinished();
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
        cookies: mergedCookies,
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
      uploadResult.emit("finish", uploadFinishEvent);
      uploadResult.emit("done", uploadFinishEvent);
      uploadResult.emit("complete", uploadFinishEvent);
      uploadResult._markFinished();
    }
    return finalResponse;
  } catch (error) {
    const rezoError = buildSmartError(config, fetchOptions, error);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter) {
      eventEmitter.emit("error", rezoError);
    }
    return rezoError;
  }
}

export { Environment };
