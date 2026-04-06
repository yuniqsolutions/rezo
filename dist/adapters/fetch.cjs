const { RezoError } = require('../errors/rezo-error.cjs');
const { buildSmartError, builErrorFromResponse, buildDownloadError } = require('../responses/buildError.cjs');
const { RezoCookieJar } = require('../cookies/index.cjs');
const RezoFormData = require('../utils/form-data.cjs');
const { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } = require('../utils/http-config.cjs');
const { RezoHeaders } = require('../utils/headers.cjs');
const { RezoURLSearchParams } = require('../utils/data-operations.cjs');
const { StreamResponse } = require('../responses/universal/stream.cjs');
const { DownloadResponse } = require('../responses/universal/download.cjs');
const { UploadResponse } = require('../responses/universal/upload.cjs');
const { isSameDomain, RezoPerformance } = require('../utils/tools.cjs');
const { ResponseCache } = require('../cache/universal-response-cache.cjs');
const { handleRateLimitWait, shouldWaitOnStatus } = require('../utils/rate-limit-wait.cjs');
const Environment = {
  isNode: typeof process !== "undefined" && process.versions?.node,
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  isWebWorker: typeof self !== "undefined" && typeof self.WorkerGlobalScope !== "undefined",
  isDeno: typeof globalThis.Deno !== "undefined",
  isBun: typeof globalThis.Bun !== "undefined",
  isEdgeRuntime: typeof globalThis.EdgeRuntime !== "undefined" || typeof globalThis.caches !== "undefined",
  isCloudflareWorker: typeof globalThis.caches !== "undefined" && typeof globalThis.navigator !== "undefined" && globalThis.navigator?.userAgent === "Cloudflare-Workers",
  get hasFetch() {
    return typeof fetch !== "undefined";
  },
  get hasReadableStream() {
    return typeof ReadableStream !== "undefined";
  },
  get hasAbortController() {
    return typeof AbortController !== "undefined";
  },
  get canUseCookieJar() {
    if (this.isBrowser || this.isWebWorker)
      return false;
    return !!(this.isNode || this.isBun || this.isDeno || this.isCloudflareWorker || this.isEdgeRuntime);
  }
};
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      console.log(`[Rezo Debug] Adapter: fetch`);
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
  redirect: (config, fromUrl, toUrl, statusCode, method) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Redirect ${statusCode}: ${fromUrl}`);
      console.log(`[Rezo Debug]        → ${toUrl} (${method})`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ↳ ${statusCode} → ${toUrl}`);
    }
  },
  complete: (config, url, redirectCount, duration) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Complete: ${url}`);
      if (redirectCount && redirectCount > 0) {
        console.log(`[Rezo Debug] Redirects: ${redirectCount}`);
      }
      if (duration) {
        console.log(`[Rezo Debug] Total Duration: ${duration.toFixed(2)}ms`);
      }
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
      adapterUsed: "fetch",
      fromCache: true
    }
  };
}
function buildUrlTree(config, finalUrl) {
  const urls = [];
  if (config.rawUrl) {
    urls.push(config.rawUrl);
  } else if (config.url) {
    const urlStr = typeof config.url === "string" ? config.url : config.url.toString();
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
function sanitizeConfig(config) {
  const sanitized = { ...config };
  delete sanitized.data;
  return sanitized;
}
async function parseCookiesFromHeaders(headers, url, config) {
  let setCookieHeaders = [];
  if (typeof headers.getSetCookie === "function") {
    setCookieHeaders = headers.getSetCookie() || [];
  } else {
    const setCookieRaw = headers.get("set-cookie");
    if (setCookieRaw) {
      const splitPattern = /,(?=\s*[A-Za-z0-9_-]+=)/;
      setCookieHeaders = setCookieRaw.split(splitPattern).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (setCookieHeaders.length === 0) {
    return {
      array: [],
      serialized: [],
      netscape: "",
      string: "",
      setCookiesString: []
    };
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
  const acceptedCookieStrings = acceptedCookies.map((c) => c.toSetCookieString());
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
function fromFetchHeaders(headers) {
  const record = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return new RezoHeaders(record);
}
async function prepareFetchBody(body) {
  if (!body)
    return;
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return body.toString();
  }
  if (body instanceof FormData) {
    return body;
  }
  if (body instanceof RezoFormData) {
    if (Environment.isNode) {
      const buffer = body.getBuffer();
      if (buffer) {
        return new Uint8Array(buffer);
      }
    }
    const nativeForm = await body.toNativeFormData();
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
async function executeRequest(options, defaultOptions, jar) {
  if (!Environment.hasFetch) {
    throw new Error("Fetch API is not available in this environment");
  }
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions);
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  const perform = new RezoPerformance;
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
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
  const isStream = options._isStream;
  const isDownload = options._isDownload || !!options.fileName || !!options.saveTo;
  const isUpload = options._isUpload;
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
      return new UploadResponse(url);
    })();
  }
  try {
    const res = executeFetchRequest(fetchOptions, mainConfig, options, perform, streamResponse, downloadResponse, uploadResponse, jar);
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
  } catch (error) {
    throw error;
  }
}
async function executeFetchRequest(fetchOptions, config, options, perform, streamResult, downloadResult, uploadResult, rootJar) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const startTime = performance.now();
  const timing = {
    startTime
  };
  config.timing.startTime = startTime;
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  const visitedUrls = new Set;
  let totalAttempts = 0;
  config.setSignal();
  if (!config.requestId) {
    config.requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  const requestUrl = fetchOptions.fullUrl ? String(fetchOptions.fullUrl) : "";
  debugLog.requestStart(config, requestUrl, fetchOptions.method || "GET");
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
      const response = await executeSingleFetchRequest(config, fetchOptions, requestCount, timing, _stats, streamResult, downloadResult, uploadResult);
      const statusOnNext = _stats.statusOnNext;
      if (response instanceof RezoError) {
        if (!config.errors)
          config.errors = [];
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
            if (retryAttempt > retryConfig.maxRetries && retryConfig.onRetryExhausted) {
              await retryConfig.onRetryExhausted(response, retryAttempt);
            }
            throw response;
          }
        }
        config.retryAttempts++;
        const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
        if (retryConfig.onRetry) {
          const shouldProceed = await retryConfig.onRetry(response, retryAttempt, currentDelay);
          if (shouldProceed === false) {
            throw response;
          }
        }
        if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
          for (const hook of config.hooks.beforeRetry) {
            await hook(config, response, retryAttempt);
          }
        }
        if (currentDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
        }
        continue;
      }
      if (statusOnNext === "success") {
        const totalDuration = performance.now() - timing.startTime;
        debugLog.complete(config, response.finalUrl || requestUrl, config.redirectCount, totalDuration);
        return response;
      }
      if (statusOnNext === "error") {
        if (shouldWaitOnStatus(response.status, options.waitOnStatus)) {
          const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
          const waitResult = await handleRateLimitWait({
            status: response.status,
            headers: response.headers,
            data: response.data,
            url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
            method: fetchOptions.method || "GET",
            config,
            options,
            currentWaitAttempt: rateLimitWaitAttempt
          });
          if (waitResult.shouldRetry) {
            config._rateLimitWaitAttempt = waitResult.waitAttempt;
            continue;
          }
        }
        const httpError = builErrorFromResponse(`Request failed with status code ${response.status}`, response, config, fetchOptions);
        if (retryConfig && retryConfig.statusCodes?.includes(response.status)) {
          retryAttempt++;
          if (retryAttempt <= retryConfig.maxRetries) {
            config.retryAttempts++;
            config.errors.push({
              attempt: config.retryAttempts,
              error: httpError,
              duration: perform.now()
            });
            perform.reset();
            const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
            if (config.debug) {
              console.log(`Request failed with status code ${response.status}, retrying...${currentDelay > 0 ? " in " + currentDelay + "ms" : ""}`);
            }
            if (currentDelay > 0) {
              await new Promise((resolve) => setTimeout(resolve, currentDelay));
            }
            continue;
          }
        }
        throw httpError;
      }
      if (statusOnNext === "redirect") {
        const location = _stats.redirectUrl;
        if (!location) {
          throw builErrorFromResponse("Redirect location not found", response, config, fetchOptions);
        }
        if (config.maxRedirects === 0) {
          config.maxRedirectsReached = true;
          throw builErrorFromResponse("Redirects are disabled (maxRedirects=0)", response, config, fetchOptions);
        }
        const enableCycleDetection = config.enableRedirectCycleDetection === true;
        if (enableCycleDetection) {
          const normalizedRedirectUrl = location.toLowerCase();
          if (visitedUrls.has(normalizedRedirectUrl)) {
            throw builErrorFromResponse(`Redirect cycle detected: ${location}`, response, config, fetchOptions);
          }
          visitedUrls.add(normalizedRedirectUrl);
        }
        const redirectCode = response.status;
        if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
          const redirectContext = {
            redirectUrl: new URL(location),
            fromUrl: fetchOptions.fullUrl,
            status: response.status,
            headers: response.headers,
            sameDomain: isSameDomain(fetchOptions.fullUrl, location),
            method: fetchOptions.method.toUpperCase(),
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
          sameDomain: isSameDomain(fetchOptions.fullUrl, location),
          method: fetchOptions.method.toUpperCase(),
          body: config.originalBody
        }) : undefined;
        if (typeof onRedirect !== "undefined") {
          if (typeof onRedirect === "boolean" && !onRedirect) {
            throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
          } else if (typeof onRedirect === "object" && !onRedirect.redirect && !onRedirect.withoutBody && !("body" in onRedirect)) {
            throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
          }
        }
        if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
          config.maxRedirectsReached = true;
          throw builErrorFromResponse(`Max redirects (${config.maxRedirects}) reached`, response, config, fetchOptions);
        }
        config.redirectHistory.push({
          url: fetchOptions.fullUrl,
          statusCode: redirectCode,
          statusText: response.statusText,
          headers: response.headers,
          method: fetchOptions.method.toUpperCase(),
          cookies: response.cookies.array,
          duration: perform.now(),
          request: fetchOptions
        });
        perform.reset();
        config.redirectCount++;
        const fromUrl = fetchOptions.fullUrl;
        fetchOptions.fullUrl = location;
        const normalizedRedirect = typeof onRedirect === "object" ? onRedirect.redirect || onRedirect.withoutBody || "body" in onRedirect : undefined;
        if (typeof onRedirect === "object" && normalizedRedirect) {
          let method;
          const userMethod = onRedirect.method;
          if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
            method = userMethod || "GET";
          } else {
            method = userMethod || fetchOptions.method;
          }
          config.method = method;
          options.method = method;
          fetchOptions.method = method;
          if (onRedirect.redirect && onRedirect.url) {
            options.fullUrl = onRedirect.url;
            fetchOptions.fullUrl = onRedirect.url;
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
          debugLog.redirect(config, fromUrl, fetchOptions.fullUrl, redirectCode, method);
          if (onRedirect.redirect && onRedirect.setHeaders) {
            if (fetchOptions.headers instanceof RezoHeaders) {
              for (const [key, value] of Object.entries(onRedirect.setHeaders)) {
                fetchOptions.headers.set(key, value);
              }
            }
          }
        } else if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
          debugLog.redirect(config, fromUrl, fetchOptions.fullUrl, redirectCode, "GET");
          options.method = "GET";
          fetchOptions.method = "GET";
          config.method = "GET";
          delete options.body;
          delete fetchOptions.body;
          if (fetchOptions.headers instanceof RezoHeaders) {
            fetchOptions.headers.delete("Content-Type");
            fetchOptions.headers.delete("Content-Length");
          }
        } else {
          debugLog.redirect(config, fromUrl, fetchOptions.fullUrl, redirectCode, fetchOptions.method);
        }
        const jarToSync = rootJar || config.jar;
        if (response.cookies?.array?.length > 0 && jarToSync) {
          try {
            jarToSync.setCookiesSync(response.cookies.array, fromUrl);
          } catch (e) {}
        }
        if (Environment.canUseCookieJar && jarToSync) {
          const redirectUrl = fetchOptions.fullUrl || "";
          const cookiesString = jarToSync.getCookieHeader(redirectUrl);
          if (cookiesString && fetchOptions.headers instanceof RezoHeaders) {
            fetchOptions.headers.set("Cookie", cookiesString);
          }
        }
        delete options.params;
        requestCount++;
        continue;
      }
      throw builErrorFromResponse("Unexpected state", response, config, fetchOptions);
    } catch (error) {
      if (error instanceof RezoError) {
        throw error;
      }
      throw buildSmartError(config, fetchOptions, error);
    }
  }
}
async function executeSingleFetchRequest(config, fetchOptions, requestCount, timing, _stats, streamResult, downloadResult, uploadResult) {
  try {
    const { fullUrl, body } = fetchOptions;
    const url = new URL(fullUrl || fetchOptions.url);
    const isSecure = url.protocol === "https:";
    if (requestCount === 0) {
      config.adapterUsed = "fetch";
      config.isSecure = isSecure;
      config.finalUrl = url.href;
      config.network.protocol = isSecure ? "https" : "http";
      config.network.httpVersion = undefined;
      if (!config.transfer) {
        config.transfer = { requestSize: 0, responseSize: 0, headerSize: 0, bodySize: 0 };
      } else if (config.transfer.requestSize === undefined) {
        config.transfer.requestSize = 0;
      }
    }
    const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
    const headers = toFetchHeaders(reqHeaders);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter && requestCount === 0) {
      const startEvent = {
        url: url.toString(),
        method: fetchOptions.method.toUpperCase(),
        headers: new RezoHeaders(reqHeaders),
        timestamp: timing.startTime,
        timeout: fetchOptions.timeout,
        maxRedirects: config.maxRedirects
      };
      eventEmitter.emit("start", startEvent);
    }
    const abortController = new AbortController;
    let timeoutId;
    if (config.timeout) {
      timeoutId = setTimeout(() => {
        abortController.abort();
      }, config.timeout);
    }
    if (config.signal) {
      config.signal.addEventListener("abort", () => {
        abortController.abort();
        if (timeoutId)
          clearTimeout(timeoutId);
        if (config.hooks?.onAbort && config.hooks.onAbort.length > 0) {
          for (const hook of config.hooks.onAbort) {
            try {
              hook({
                reason: "signal",
                message: "Request aborted by signal",
                url: url.toString(),
                elapsed: performance.now() - timing.startTime,
                timestamp: Date.now()
              }, config);
            } catch {}
          }
        }
      });
    }
    if (body instanceof RezoFormData && typeof body.getContentType === "function") {
      const contentType = body.getContentType();
      if (contentType && !headers.has("content-type")) {
        headers.set("content-type", contentType);
      }
    }
    const preparedBody = await prepareFetchBody(body);
    if (config.transfer && body) {
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
      } else if (typeof body === "object" && !(body instanceof Blob) && !(body instanceof ReadableStream)) {
        config.transfer.requestSize = JSON.stringify(body).length;
      }
    }
    const credentials = Environment.canUseCookieJar ? "omit" : config.withCredentials !== false ? "include" : "omit";
    const fetchInit = {
      method: fetchOptions.method.toUpperCase(),
      headers,
      body: preparedBody,
      signal: abortController.signal,
      redirect: "manual",
      credentials
    };
    let response;
    try {
      response = await fetch(url.toString(), fetchInit);
    } catch (err) {
      if (timeoutId)
        clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        if (config.hooks?.onTimeout && config.hooks.onTimeout.length > 0) {
          const elapsed = performance.now() - timing.startTime;
          for (const hook of config.hooks.onTimeout) {
            try {
              hook({
                type: "request",
                timeout: config.timeout || 0,
                elapsed,
                url: url.toString(),
                timestamp: Date.now()
              }, config);
            } catch {}
          }
        }
        const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${config.timeout}ms`));
        _stats.statusOnNext = "error";
        return error;
      }
      throw err;
    } finally {
      if (timeoutId)
        clearTimeout(timeoutId);
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
    const cookies = await parseCookiesFromHeaders(response.headers, url.href, config);
    config.responseCookies = cookies;
    const location = response.headers.get("location");
    const isRedirect = status >= 300 && status < 400 && location;
    if (isRedirect) {
      _stats.statusOnNext = "redirect";
      const redirectUrlObj = new URL(location, url);
      if (!redirectUrlObj.hash && url.hash) {
        redirectUrlObj.hash = url.hash;
      }
      _stats.redirectUrl = redirectUrlObj.href;
      const partialResponse = {
        data: "",
        status,
        statusText,
        headers: responseHeaders,
        cookies,
        config,
        contentType,
        contentLength: 0,
        finalUrl: url.href,
        urls: buildUrlTree(config, url.href)
      };
      return partialResponse;
    }
    if (eventEmitter && !isRedirect) {
      const headersEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        cookies: cookies.array,
        timing: {
          firstByte: config.timing.responseStart - config.timing.startTime,
          total: performance.now() - config.timing.startTime
        }
      };
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
    }
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      const ttfb = config.timing.responseStart - config.timing.startTime;
      const headersReceivedEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        cookies: cookies.array,
        timing: {
          firstByte: ttfb,
          total: performance.now() - config.timing.startTime
        }
      };
      for (const hook of config.hooks.afterHeaders) {
        await hook(headersReceivedEvent, config);
      }
    }
    if (streamResult && response.body) {
      await handleStreamingResponse(response, config, timing, streamResult, url, status, statusText, responseHeaders, cookies);
      return {};
    }
    let responseData;
    let bodyBuffer;
    const responseType = config.responseType || fetchOptions.responseType || "auto";
    const isDownloadMode = !!(downloadResult && config.fileName);
    if (isDownloadMode) {
      bodyBuffer = await response.arrayBuffer();
      responseData = Environment.isNode ? Buffer.from(bodyBuffer) : bodyBuffer;
    } else if (responseType === "buffer" || responseType === "arrayBuffer") {
      bodyBuffer = await response.arrayBuffer();
      responseData = Environment.isNode ? Buffer.from(bodyBuffer) : bodyBuffer;
    } else if (responseType === "blob") {
      responseData = await response.blob();
    } else if (responseType === "text") {
      responseData = await response.text();
    } else if (responseType === "json") {
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }
    } else {
      if (contentType.includes("application/json")) {
        try {
          responseData = await response.json();
        } catch {
          responseData = await response.text();
        }
      } else {
        responseData = await response.text();
      }
    }
    const bodySize = bodyBuffer?.byteLength || (typeof responseData === "string" ? responseData.length : 0);
    updateTiming(config, timing, bodySize);
    config.status = status;
    config.statusText = statusText;
    const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
    _stats.statusOnNext = fetchOptions.validateStatus === null || _validateStatus(status) ? "success" : "error";
    const mergedCookies = mergeRequestAndResponseCookies(config, cookies, url.href);
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
      finalUrl: url.href,
      urls: buildUrlTree(config, url.href)
    };
    if (downloadResult && config.fileName && Environment.isNode) {
      try {
        const fs = await import("node:fs");
        const { dirname } = await import("node:path");
        const dir = dirname(config.fileName);
        if (dir && dir !== ".")
          fs.mkdirSync(dir, { recursive: true });
        const buffer = bodyBuffer ? Buffer.from(bodyBuffer) : Buffer.from(responseData);
        fs.writeFileSync(config.fileName, buffer);
        const downloadFinishEvent = {
          status,
          statusText,
          headers: responseHeaders,
          contentType,
          contentLength: buffer.length,
          finalUrl: url.href,
          cookies: mergedCookies,
          urls: buildUrlTree(config, url.href),
          fileName: config.fileName,
          fileSize: buffer.length,
          timing: {
            ...getTimingDurations(config),
            download: getTimingDurations(config).download || 0
          },
          averageSpeed: getTimingDurations(config).download ? buffer.length / getTimingDurations(config).download * 1000 : 0,
          config: sanitizeConfig(config)
        };
        downloadResult.emit("finish", downloadFinishEvent);
        downloadResult.emit("done", downloadFinishEvent);
        downloadResult.emit("complete", downloadFinishEvent);
        downloadResult._markFinished();
      } catch (err) {
        const error = buildDownloadError({
          statusCode: status,
          headers: Object.fromEntries(responseHeaders.entries()),
          contentType,
          contentLength: String(bodySize),
          cookies: cookies.setCookiesString,
          statusText: err.message,
          url: url.href,
          body: Buffer.from([]),
          finalUrl: url.href,
          config,
          request: fetchOptions
        });
        downloadResult.emit("error", error);
        return error;
      }
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
        finalUrl: url.href,
        cookies: mergedCookies,
        urls: buildUrlTree(config, url.href),
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
    _stats.statusOnNext = "error";
    const rezoError = buildSmartError(config, fetchOptions, error);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter) {
      eventEmitter.emit("error", rezoError);
    }
    return rezoError;
  }
}
async function handleStreamingResponse(response, config, timing, streamResult, url, status, statusText, headers, cookies) {
  if (!response.body) {
    streamResult.emit("error", new Error("Response body is not available for streaming"));
    return;
  }
  const reader = response.body.getReader();
  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let bytesReceived = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value) {
        bytesReceived += value.length;
        streamResult.emit("data", Buffer.from(value));
        const progressEvent = {
          loaded: bytesReceived,
          total: totalBytes,
          percentage: totalBytes ? Math.round(bytesReceived / totalBytes * 100) : 0,
          speed: 0,
          averageSpeed: 0,
          estimatedTime: 0,
          timestamp: Date.now()
        };
        streamResult.emit("progress", progressEvent);
        streamResult.emit("download-progress", progressEvent);
      }
    }
    updateTiming(config, timing, bytesReceived);
    const streamFinishEvent = {
      status,
      statusText,
      headers,
      contentType: response.headers.get("content-type") || undefined,
      contentLength: bytesReceived,
      finalUrl: url.href,
      cookies,
      urls: buildUrlTree(config, url.href),
      timing: getTimingDurations(config),
      config: sanitizeConfig(config)
    };
    streamResult.emit("finish", streamFinishEvent);
    streamResult.emit("done", streamFinishEvent);
    streamResult.emit("complete", streamFinishEvent);
    streamResult.emit("end");
    streamResult._markFinished();
  } catch (err) {
    if (config.debug) {
      console.log("[Rezo Debug] Fetch stream error:", err.message, err.stack);
    }
    streamResult.emit("error", buildSmartError(config, {}, err));
  }
}

exports.Environment = Environment;
exports.executeRequest = executeRequest;