const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { URL } = require("node:url");
const { Readable } = require("node:stream");
const { RezoError } = require('../errors/rezo-error.cjs');
const { RezoCookieJar } = require('../cookies/index.cjs');
const RezoHeaders = require('../utils/headers.cjs');
const { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } = require('../utils/http-config.cjs');
const { RezoURLSearchParams } = require('../utils/data-operations.cjs');
const RezoFormData = require('../utils/form-data.cjs');
const { rezoProxy } = require('../proxy/index.cjs');
const { StreamResponse } = require('../responses/stream.cjs');
const { DownloadResponse } = require('../responses/download.cjs');
const { UploadResponse } = require('../responses/upload.cjs');
const { CompressionUtil } = require('../utils/compression.cjs');
const { buildResponseFromIncoming, buildDownloadResponse } = require('../responses/buildResponse.cjs');
const { buildDownloadError, buildDecompressionError, buildSmartError, builErrorFromResponse } = require('../responses/buildError.cjs');
const { isSameDomain, RezoPerformance } = require('../utils/tools.cjs');
const { getGlobalDNSCache } = require('../cache/dns-cache.cjs');
const { ResponseCache } = require('../cache/response-cache.cjs');
const { getGlobalAgentPool } = require('../utils/agent-pool.cjs');
const { buildTlsOptions } = require('../stealth/tls-fingerprint.cjs');
const { StagedTimeoutManager, parseStagedTimeouts } = require('../utils/staged-timeout.cjs');
const { handleRateLimitWait, shouldWaitOnStatus } = require('../utils/rate-limit-wait.cjs');
const { getSocketTelemetry, beginRequestContext } = require('../utils/socket-telemetry.cjs');
const dns = require("node:dns");
const { bunHttp, isBunRuntime, isBunSocksRequest } = require('../internal/agents/bun-socks-http.cjs');
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      if (config.originalRequest?.headers) {
        const headers = config.originalRequest.headers instanceof RezoHeaders ? config.originalRequest.headers.toObject() : config.originalRequest.headers;
        console.log(`[Rezo Debug] Request Headers:`, JSON.stringify(headers, null, 2));
      }
      if (config.proxy && typeof config.proxy === "object") {
        console.log(`[Rezo Debug] Proxy: ${config.proxy.protocol}://${config.proxy.host}:${config.proxy.port}`);
      } else if (config.proxy && typeof config.proxy === "string") {
        console.log(`[Rezo Debug] Proxy: ${config.proxy}`);
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
    } else if (config.trackUrl) {
      console.log(`[Rezo Track]   ✗ Max retries reached`);
    }
  },
  response: (config, status, statusText, duration) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Response: ${status} ${statusText} (${duration.toFixed(2)}ms)`);
    } else if (config.trackUrl) {
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
      if (timing.dns)
        parts.push(`DNS: ${timing.dns.toFixed(2)}ms`);
      if (timing.connect)
        parts.push(`Connect: ${timing.connect.toFixed(2)}ms`);
      if (timing.tls)
        parts.push(`TLS: ${timing.tls.toFixed(2)}ms`);
      if (timing.ttfb)
        parts.push(`TTFB: ${timing.ttfb.toFixed(2)}ms`);
      if (timing.total)
        parts.push(`Total: ${timing.total.toFixed(2)}ms`);
      if (parts.length > 0) {
        console.log(`[Rezo Debug] Timing: ${parts.join(" | ")}`);
      }
    }
  },
  complete: (config, finalUrl, redirectCount, duration) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Complete: ${finalUrl}`);
      if (redirectCount > 0) {
        console.log(`[Rezo Debug] Redirects: ${redirectCount}`);
      }
      console.log(`[Rezo Debug] Total Duration: ${duration.toFixed(2)}ms`);
      console.log(`[Rezo Debug] ─────────────────────────────────────
`);
    }
  }
};
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
    const existing = responseCacheInstances.get(key);
    if (existing) {
      return existing;
    }
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
      adapterUsed: "http",
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
async function executeRequest(options, defaultOptions, jar) {
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions, defaultOptions._proxyManager);
  const config = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  let mainConfig = config.config;
  const { proxyManager } = config;
  const perform = new RezoPerformance;
  let selectedProxy = null;
  if (proxyManager) {
    const requestUrl = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url?.toString() || "";
    selectedProxy = proxyManager.next(requestUrl);
    if (selectedProxy) {
      config.fetchOptions.proxy = {
        protocol: selectedProxy.protocol,
        host: selectedProxy.host,
        port: selectedProxy.port,
        auth: selectedProxy.auth
      };
    } else if (proxyManager.shouldProxy(requestUrl) && !proxyManager.hasAvailableProxies() && proxyManager.config.failWithoutProxy) {
      const noProxyError = new RezoError("No proxy available: All proxies in the pool are exhausted, disabled, or in cooldown", mainConfig, "REZ_NO_PROXY_AVAILABLE", config.fetchOptions);
      proxyManager.notifyNoProxiesAvailable(requestUrl, noProxyError);
      throw noProxyError;
    }
  }
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url?.toString() || "";
  let cache;
  let requestHeaders;
  let cachedEntry;
  let _needsRevalidation = false;
  if (cacheOption) {
    cache = getResponseCache(cacheOption);
    requestHeaders = config.fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(config.fetchOptions.headers.entries()) : config.fetchOptions.headers;
    cachedEntry = cache.get(method, requestUrl, requestHeaders);
    if (cachedEntry) {
      const cacheControl = parseCacheControlFromHeaders(cachedEntry.headers);
      if (cacheControl.noCache || cacheControl.mustRevalidate) {
        _needsRevalidation = true;
      } else {
        return buildCachedRezoResponse(cachedEntry, mainConfig);
      }
    }
    const conditionalHeaders = cache.getConditionalHeaders(method, requestUrl, requestHeaders);
    if (conditionalHeaders) {
      if (config.fetchOptions.headers instanceof RezoHeaders) {
        for (const [key, value] of Object.entries(conditionalHeaders)) {
          config.fetchOptions.headers.set(key, value);
        }
      } else {
        config.fetchOptions.headers = {
          ...config.fetchOptions.headers,
          ...conditionalHeaders
        };
      }
    }
  }
  const isStream = options.responseType === "stream" || options._isStream;
  const isDownload = options.responseType === "download" || !!options.fileName || !!options.saveTo || options._isDownload;
  const isUpload = options.responseType === "upload" || options._isUpload;
  if (isUpload && !config.config.data && !config.fetchOptions.body) {
    throw RezoError.fromError(new Error("Upload response type requires a request body (data or body)"), mainConfig, config.fetchOptions);
  }
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = options._streamResponse || new StreamResponse;
  } else if (isDownload) {
    downloadResponse = options._downloadResponse || (() => {
      const fileName = options.fileName || options.saveTo;
      const url = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url.toString();
      return new DownloadResponse(fileName, url);
    })();
  } else if (isUpload) {
    uploadResponse = options._uploadResponse || (() => {
      const fileName = typeof options.body === "string" ? undefined : options.body?.name;
      const url = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url.toString();
      return new UploadResponse(url, fileName);
    })();
  }
  if (proxyManager && selectedProxy) {
    if (streamResponse) {
      streamResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      streamResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    } else if (downloadResponse) {
      downloadResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      downloadResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    } else if (uploadResponse) {
      uploadResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      uploadResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    }
  }
  try {
    const res = executeHttp1Request(config.fetchOptions, mainConfig, config.options, perform, d_options.fs, streamResponse, downloadResponse, uploadResponse, jar);
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
    if (proxyManager && selectedProxy) {
      proxyManager.reportSuccess(selectedProxy);
    }
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
    if (proxyManager && selectedProxy) {
      proxyManager.reportFailure(selectedProxy, error);
      if (proxyManager.config.retryWithNextProxy) {
        const maxRetries = proxyManager.config.maxProxyRetries ?? 3;
        const attempt = (mainConfig._proxyRetryCount ?? 0) + 1;
        if (attempt <= maxRetries) {
          mainConfig._proxyRetryCount = attempt;
          const retryUrl = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url?.toString() || "";
          const nextProxy = proxyManager.next(retryUrl);
          if (nextProxy) {
            options.proxy = {
              protocol: nextProxy.protocol,
              host: nextProxy.host,
              port: nextProxy.port,
              auth: nextProxy.auth
            };
            return executeRequest(options, defaultOptions, jar);
          }
        }
      }
    }
    throw error;
  }
}
async function executeHttp1Request(fetchOptions, config, options, perform, fs, streamResult, downloadResult, uploadResult, rootJar) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let responseStatusCode;
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const timing = {
    startTime: performance.now(),
    startTimestamp: Date.now()
  };
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  const visitedUrls = new Set;
  let totalAttempts = 0;
  config.setSignal();
  const timeoutClearInstance = config.timeoutClearInstance;
  delete config.timeoutClearInstance;
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
      const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded. This prevents infinite loops from retries and redirects.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
      throw error;
    }
    try {
      const response = await request(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, rootJar);
      const statusOnNext = _stats.statusOnNext;
      if (response instanceof RezoError) {
        const fileName = config.fileName;
        if (fileName && fs && fs.existsSync(fileName)) {
          fs.unlinkSync(fileName);
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
        debugLog.retry(config, retryAttempt, retryConfig.maxRetries, responseStatusCode || 0, currentDelay);
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
        config.retryAttempts++;
        continue;
      }
      if (statusOnNext === "success") {
        const totalDuration = performance.now() - timing.startTime;
        debugLog.response(config, response.status, response.statusText, totalDuration);
        if (response.headers) {
          const headersObj = response.headers instanceof RezoHeaders ? response.headers.toObject() : response.headers;
          debugLog.responseHeaders(config, headersObj);
        }
        if (response.cookies?.array) {
          debugLog.cookies(config, response.cookies.array.length);
        }
        debugLog.complete(config, response.finalUrl || requestUrl, config.redirectCount, totalDuration);
        return response;
      }
      if (statusOnNext === "redirect") {
        const addedOptions = {};
        const location = _stats.redirectUrl;
        if (!location || !_stats.redirectUrl) {
          const redirectError = builErrorFromResponse("Redirect location not found", response, config, fetchOptions);
          _stats.statusOnNext = "error";
          if (!config.errors)
            config.errors = [];
          config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
          throw redirectError;
        }
        if (config.maxRedirects === 0) {
          config.maxRedirectsReached = true;
          const redirectError = builErrorFromResponse(`Redirects are disabled (maxRedirects=0)`, response, config, fetchOptions);
          _stats.statusOnNext = "error";
          if (!config.errors)
            config.errors = [];
          config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
          throw redirectError;
        }
        const enableCycleDetection = config.enableRedirectCycleDetection === true;
        if (enableCycleDetection) {
          const normalizedRedirectUrl = _stats.redirectUrl.toLowerCase();
          if (visitedUrls.has(normalizedRedirectUrl)) {
            const redirectError = builErrorFromResponse(`Redirect cycle detected: attempting to revisit ${_stats.redirectUrl}`, response, config, fetchOptions);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
            throw redirectError;
          }
          visitedUrls.add(normalizedRedirectUrl);
        }
        const redirectCode = response.status;
        const customHeaders = undefined;
        if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
          const redirectContext = {
            redirectUrl: new URL(_stats.redirectUrl),
            fromUrl: fetchOptions.fullUrl,
            status: response.status,
            headers: response.headers,
            sameDomain: isSameDomain(fetchOptions.fullUrl, _stats.redirectUrl),
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
          url: new URL(_stats.redirectUrl),
          status: response.status,
          headers: response.headers,
          sameDomain: isSameDomain(fetchOptions.fullUrl, _stats.redirectUrl),
          method: fetchOptions.method.toUpperCase(),
          body: config.originalBody
        }) : undefined;
        if (typeof onRedirect !== "undefined") {
          if (typeof onRedirect === "boolean") {
            if (!onRedirect) {
              const redirectError = builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
              _stats.statusOnNext = "error";
              if (!config.errors)
                config.errors = [];
              config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
              throw redirectError;
            }
          } else if (!onRedirect.redirect && !onRedirect.withoutBody && !("body" in onRedirect)) {
            const redirectError = builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
            throw redirectError;
          }
        }
        if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
          config.maxRedirectsReached = true;
          const redirectError = builErrorFromResponse(`Max redirects (${config.maxRedirects}) reached`, response, config, fetchOptions);
          _stats.statusOnNext = "error";
          if (!config.errors)
            config.errors = [];
          config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
          throw redirectError;
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
        addedOptions.redirectedUrl = _stats.redirectUrl;
        addedOptions.redirectCode = redirectCode;
        addedOptions.isRedirected = true;
        addedOptions.lastRedirectedUrl = fetchOptions.fullUrl;
        addedOptions.customHeaders = customHeaders;
        addedOptions.fullUrl = fetchOptions.fullUrl;
        delete options.params;
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
            addedOptions.customHeaders = onRedirect.setHeaders;
          }
        } else if (response.status === 301 || response.status === 302 || response.status === 303) {
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
        const __ = prepareHTTPOptions(fetchOptions, jarToSync, addedOptions, config);
        fetchOptions = __.fetchOptions;
        config = __.config;
        options = __.options;
        continue;
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
            debugLog.retry(config, retryAttempt, retryConfig.maxRetries, response.status, currentDelay);
            if (currentDelay > 0) {
              await new Promise((resolve) => setTimeout(resolve, currentDelay));
            }
            continue;
          }
        }
        throw httpError;
      }
      delete config.beforeRedirect;
      config.setSignal = () => {};
      return response;
    } catch (error) {
      throw error;
    } finally {
      if (timeoutClearInstance)
        clearTimeout(timeoutClearInstance);
    }
  }
}
async function request(config, fetchOptions, requestCount, timing, _stats, _responseStatusCode, fs, streamResult, downloadResult, uploadResult, rootJar) {
  return await new Promise(async (resolve) => {
    try {
      const { fullUrl, body, fileName: filename } = fetchOptions;
      const url = new URL(fullUrl || fetchOptions.url);
      const isSecure = url.protocol === "https:";
      const httpModule = isBunRuntime() && isBunSocksRequest(fetchOptions.proxy) ? bunHttp : isSecure ? config.isSecure && config.adapter ? config.adapter : https : !config.isSecure && config.adapter ? config.adapter : http;
      await setInitialConfig(config, fetchOptions, isSecure, url, httpModule, requestCount, timing.startTime, timing.startTimestamp);
      const eventEmitter = streamResult || downloadResult || uploadResult;
      if (eventEmitter && requestCount === 0) {
        const startEvent = {
          url: url.toString(),
          method: fetchOptions.method.toUpperCase(),
          headers: fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers),
          timestamp: timing.startTime,
          timeout: fetchOptions.timeout,
          maxRedirects: config.maxRedirects,
          retry: config.retry ? {
            maxRetries: config.retry.maxRetries,
            delay: config.retry.retryDelay,
            backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : config.retry.backoff === "exponential" ? 2 : config.retry.backoff === "linear" ? 1 : undefined
          } : undefined
        };
        eventEmitter.emit("start", startEvent);
      }
      const requestOptions = buildHTTPOptions(fetchOptions, isSecure, url);
      const stagedTimeoutConfig = parseStagedTimeouts(fetchOptions.timeout);
      const timeoutManager = new StagedTimeoutManager(stagedTimeoutConfig, config, fetchOptions);
      if (timeoutManager.hasPhase("total")) {
        timeoutManager.startPhase("total");
      }
      try {
        const req = httpModule.request(requestOptions, async (res) => {
          timeoutManager.clearPhase("headers");
          if (timeoutManager.hasPhase("body")) {
            timeoutManager.startPhase("body");
          }
          if (!timing.firstByteTime) {
            timing.firstByteTime = performance.now();
            config.timing.responseStart = timing.firstByteTime;
          }
          const { statusCode, statusMessage, headers, httpVersion, socket } = res;
          const { remoteAddress, remotePort, localAddress, localPort } = socket;
          _responseStatusCode = statusCode;
          config.network.remoteAddress = remoteAddress;
          config.network.remotePort = remotePort;
          config.network.localAddress = localAddress;
          config.network.localPort = localPort;
          config.network.httpVersion = httpVersion;
          config.network.family = socket.remoteFamily || undefined;
          const contentType = headers["content-type"];
          const location = headers["location"] || headers["Location"];
          const contentLength = headers["content-length"];
          const cookies = headers["set-cookie"];
          await updateCookies(config, headers, url.href, rootJar);
          const cookieArray = config.responseCookies?.array || [];
          delete headers["set-cookie"];
          _stats.redirectUrl = undefined;
          const isRedirected = statusCode && statusCode >= 300 && statusCode < 400;
          const eventEmitter = streamResult || downloadResult || uploadResult;
          if (!isRedirected && eventEmitter) {
            const headersEvent = {
              status: statusCode || 200,
              statusText: statusMessage || "",
              headers: new RezoHeaders(headers),
              contentType,
              contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
              cookies: cookieArray,
              timing: {
                firstByte: config.timing.responseStart - config.timing.startTime,
                total: performance.now() - config.timing.startTime
              }
            };
            eventEmitter.emit("headers", headersEvent);
            eventEmitter.emit("status", statusCode, statusMessage);
            eventEmitter.emit("cookies", cookieArray);
            if (downloadResult) {
              downloadResult.status = statusCode;
              downloadResult.statusText = statusMessage;
            } else if (uploadResult) {
              uploadResult.status = statusCode;
              uploadResult.statusText = statusMessage;
            }
          }
          if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
            const ttfb = config.timing.responseStart - config.timing.startTime;
            const headersReceivedEvent = {
              status: statusCode || 200,
              statusText: statusMessage || "",
              headers: new RezoHeaders(headers),
              contentType,
              contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
              cookies: cookieArray,
              timing: {
                firstByte: ttfb,
                total: performance.now() - config.timing.startTime
              }
            };
            for (const hook of config.hooks.afterHeaders) {
              await hook(headersReceivedEvent, config);
            }
          }
          if (isSecure) {
            const socket = res.socket || res.connection;
            if (socket) {
              try {
                const hasTlsMethods = typeof socket.getCipher === "function" && typeof socket.getProtocol === "function";
                if (hasTlsMethods) {
                  const cipher = socket.getCipher();
                  const cert = typeof socket.getPeerCertificate === "function" ? socket.getPeerCertificate() : null;
                  const tlsVersion = socket.getProtocol();
                  if (tlsVersion)
                    config.security.tlsVersion = tlsVersion;
                  if (cipher?.name)
                    config.security.cipher = cipher.name;
                  if (cert && cert.subject) {
                    config.security.certificateInfo = {
                      subject: cert.subject,
                      issuer: cert.issuer,
                      validFrom: cert.valid_from,
                      validTo: cert.valid_to,
                      fingerprint: cert.fingerprint
                    };
                    config.security.validationResults = {
                      certificateValid: !cert.fingerprint?.includes("error"),
                      hostnameMatch: cert.subject?.CN === url.hostname,
                      chainValid: true
                    };
                  }
                } else if (socket.encrypted) {
                  config.security.encrypted = true;
                  config.security.tlsDetailsUnavailable = true;
                }
              } catch {}
            }
          }
          if (isRedirected)
            _stats.statusOnNext = "redirect";
          if (isRedirected && location) {
            const redirectUrlObj = new URL(typeof location === "string" ? location : location.toString(), url);
            if (!redirectUrlObj.hash && url.hash) {
              redirectUrlObj.hash = url.hash;
            }
            _stats.redirectUrl = redirectUrlObj.href;
            if (config.redirectCount) {
              config.redirectCount++;
            } else {
              config.redirectCount = 1;
            }
            if (eventEmitter) {
              emitRedirect(eventEmitter, headers, statusCode || 302, statusMessage || "", url.toString(), _stats.redirectUrl, config.redirectCount, config.maxRedirects, fetchOptions.method.toUpperCase());
            }
          }
          let contentLengthCounter = 0;
          if (streamResult) {
            if (isRedirected) {
              resolve(null);
              return;
            }
            if (streamResult.encoding) {
              res.setEncoding(streamResult.encoding);
            }
            let streamedBytes = 0;
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
            const streamStartTime = performance.now();
            res.on("data", (chunk) => {
              streamedBytes += chunk.length;
              const now = performance.now();
              const elapsed = now - streamStartTime;
              const speed = elapsed > 0 ? streamedBytes / (elapsed / 1000) : 0;
              const percentage = totalBytes > 0 ? streamedBytes / totalBytes * 100 : 0;
              const estimatedTime = speed > 0 && totalBytes > 0 ? (totalBytes - streamedBytes) / speed * 1000 : 0;
              streamResult.emit("progress", {
                loaded: streamedBytes,
                total: totalBytes,
                percentage,
                speed,
                averageSpeed: speed,
                estimatedTime,
                timestamp: now
              });
            });
            res.on("end", () => {
              updateTiming(config, timing, contentLength || "", streamedBytes, res.rawHeaders);
              const streamFinishEvent = {
                status: statusCode || 200,
                statusText: statusMessage || "OK",
                headers: new RezoHeaders(headers),
                contentType,
                contentLength: streamedBytes,
                finalUrl: url.toString(),
                cookies: config.jar?.cookies() || { array: [], map: {} },
                urls: [url.toString()],
                timing: getTimingDurations(config),
                config: sanitizeConfig(config)
              };
              streamResult.emit("finish", streamFinishEvent);
              streamResult.emit("done", streamFinishEvent);
              streamResult.emit("complete", streamFinishEvent);
              streamResult._markFinished();
              _stats.statusOnNext = "success";
              const minimalResponse = buildResponseFromIncoming(res, Buffer.alloc(0), config, url.toString(), buildUrlTree(config, url.toString()));
              resolve(minimalResponse);
            });
            res.pipe(streamResult);
          } else if (downloadResult && filename && fs && statusCode && statusCode >= 200 && statusCode < 300) {
            const { dirname } = await import("node:path");
            const dir = dirname(filename);
            if (dir && dir !== ".")
              fs.mkdirSync(dir, { recursive: true });
            const writeStream = fs.createWriteStream(filename);
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
            let downloadedBytes = 0;
            const downloadStartTime = performance.now();
            let lastProgressTime = downloadStartTime;
            res.on("data", (chunk) => {
              downloadedBytes += chunk.length;
              const now = performance.now();
              const elapsed = now - downloadStartTime;
              const timeSinceLastProgress = now - lastProgressTime;
              if (timeSinceLastProgress >= 100 || downloadedBytes === totalBytes) {
                const progressEvent = {
                  loaded: downloadedBytes,
                  total: totalBytes,
                  percentage: totalBytes > 0 ? downloadedBytes / totalBytes * 100 : 0,
                  speed: timeSinceLastProgress > 0 ? chunk.length / timeSinceLastProgress * 1000 : 0,
                  averageSpeed: elapsed > 0 ? downloadedBytes / elapsed * 1000 : 0,
                  estimatedTime: totalBytes > downloadedBytes && elapsed > 0 ? (totalBytes - downloadedBytes) / downloadedBytes * elapsed : 0,
                  timestamp: now
                };
                downloadResult.emit("progress", progressEvent);
                lastProgressTime = now;
              }
            });
            res.pipe(writeStream);
            writeStream.on("finish", () => {
              if (!contentLength) {
                if (fs.existsSync(filename)) {
                  contentLengthCounter = fs.statSync(filename).size;
                }
              } else {
                contentLengthCounter = downloadedBytes;
              }
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              const finishEvent = {
                status: statusCode || 200,
                statusText: statusMessage || "OK",
                headers: new RezoHeaders(headers),
                contentType,
                contentLength: contentLengthCounter,
                finalUrl: url.toString(),
                cookies: config.jar?.cookies() || { array: [], map: {} },
                urls: [url.toString()],
                fileName: filename,
                fileSize: contentLengthCounter,
                timing: {
                  ...getTimingDurations(config),
                  download: getTimingDurations(config).download || 0
                },
                averageSpeed: getTimingDurations(config).download ? contentLengthCounter / getTimingDurations(config).download * 1000 : 0,
                config: sanitizeConfig(config)
              };
              downloadResult.emit("finish", finishEvent);
              downloadResult.emit("done", finishEvent);
              downloadResult.emit("complete", finishEvent);
              downloadResult._markFinished();
              const downloadResponse = buildDownloadResponse(res.statusCode ?? 200, res.statusMessage ?? "OK", headers, contentLengthCounter, cookies || [], res.url || url.toString(), url.toString(), [url.toString()], config);
              _stats.statusOnNext = "success";
              resolve(downloadResponse);
            });
            writeStream.on("error", (err) => {
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              _stats.statusOnNext = "error";
              const error = buildDownloadError({
                statusCode: res.statusCode || 500,
                headers,
                contentType,
                contentLength: contentLength || "0",
                cookies: cookies || [],
                statusText: err.message || "Download failed",
                url: res.url || url.toString(),
                body: null,
                finalUrl: url.toString(),
                config,
                request: fetchOptions
              });
              downloadResult.emit("error", error);
              resolve(error);
              return;
            });
          } else if (filename && fs && statusCode && statusCode >= 200 && statusCode < 300) {
            const { dirname } = await import("node:path");
            const dir = dirname(filename);
            if (dir && dir !== ".")
              fs.mkdirSync(dir, { recursive: true });
            const writeStream = fs.createWriteStream(filename);
            res.pipe(writeStream);
            writeStream.on("finish", () => {
              if (!contentLength) {
                if (fs.existsSync(filename)) {
                  contentLengthCounter = fs.statSync(filename).size;
                }
              }
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              const downloadResponse = buildDownloadResponse(res.statusCode ?? 200, res.statusMessage ?? "OK", headers, parseInt(contentLength || "0", 10) || contentLengthCounter, cookies || [], res.url || url.toString(), url.toString(), [url.toString()], config);
              _stats.statusOnNext = "success";
              resolve(downloadResponse);
            });
            writeStream.on("error", (err) => {
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              _stats.statusOnNext = "error";
              const error = buildDownloadError({
                statusCode: res.statusCode || 500,
                headers,
                contentType,
                contentLength: contentLength || "0",
                cookies: cookies || [],
                statusText: err.message || "Download failed",
                url: res.url || url.toString(),
                body: null,
                finalUrl: url.toString(),
                config,
                request: fetchOptions
              });
              resolve(error);
              return;
            });
          } else {
            if (config.encoding) {
              res.setEncoding(config.encoding);
            }
            const decompressedStream = CompressionUtil.decompressStream(res, res.headers["content-encoding"], config);
            const chunks = [];
            decompressedStream.on("data", (chunk) => {
              contentLengthCounter += chunk.length;
              chunks.push(chunk);
            });
            decompressedStream.on("end", () => {
              const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
              _stats.statusOnNext = isRedirected ? "redirect" : statusCode && (fetchOptions.validateStatus === null || _validateStatus(statusCode)) ? "success" : "error";
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              const finalResponse = buildResponseFromIncoming(res, Buffer.concat(chunks), config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
              if (uploadResult && !isRedirected) {
                const uploadFinishEvent = {
                  response: {
                    status: statusCode || 200,
                    statusText: statusMessage || "OK",
                    headers: new RezoHeaders(headers),
                    data: finalResponse.data,
                    contentType,
                    contentLength: contentLengthCounter
                  },
                  finalUrl: url.toString(),
                  cookies: config.jar?.cookies() || { array: [], map: {} },
                  urls: [url.toString()],
                  uploadSize: config.transfer.requestSize || 0,
                  fileName: uploadResult.fileName,
                  timing: {
                    total: getTimingDurations(config).total,
                    dns: getTimingDurations(config).dns,
                    tcp: getTimingDurations(config).tcp,
                    tls: getTimingDurations(config).tls,
                    upload: getTimingDurations(config).firstByte || 0,
                    waiting: getTimingDurations(config).download > 0 && getTimingDurations(config).firstByte > 0 ? getTimingDurations(config).download - getTimingDurations(config).firstByte : 0,
                    download: getTimingDurations(config).download
                  },
                  averageUploadSpeed: getTimingDurations(config).firstByte && config.transfer.requestSize ? config.transfer.requestSize / getTimingDurations(config).firstByte * 1000 : 0,
                  averageDownloadSpeed: getTimingDurations(config).download ? contentLengthCounter / getTimingDurations(config).download * 1000 : 0,
                  config: sanitizeConfig(config)
                };
                uploadResult.emit("finish", uploadFinishEvent);
                uploadResult.emit("done", uploadFinishEvent);
                uploadResult.emit("complete", uploadFinishEvent);
                uploadResult._markFinished();
              }
              timeoutManager.clearAll();
              resolve(finalResponse);
            });
            decompressedStream.on("error", (err) => {
              timeoutManager.clearAll();
              _stats.statusOnNext = "error";
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              const data = Buffer.concat(chunks);
              if (_stats.redirectUrl) {
                const partialResponse = buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                resolve(partialResponse);
                return;
              }
              const isNetworkError = err.code && ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ERR_STREAM_PREMATURE_CLOSE"].includes(err.code);
              if (isNetworkError) {
                const partialResponse = buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                const error = new RezoError(err.message, config, err.code, fetchOptions, partialResponse);
                resolve(error);
              } else {
                const error = buildDecompressionError({
                  statusCode: res.statusCode || 500,
                  headers,
                  contentType,
                  contentLength: contentLength || contentLengthCounter.toString(),
                  cookies: cookies || [],
                  statusText: err.message || "Decompression failed",
                  url: res.url || url.toString(),
                  body: data,
                  finalUrl: url.toString(),
                  config,
                  request: fetchOptions
                });
                resolve(error);
              }
            });
          }
        });
        req.on("error", (err) => {
          timeoutManager.clearAll();
          _stats.statusOnNext = "error";
          const errCode = err.code;
          if ((errCode === "ABORT_ERR" || err.name === "AbortError" || errCode === "ECONNABORTED") && config.hooks?.onAbort && config.hooks.onAbort.length > 0) {
            const reason = errCode === "ECONNABORTED" ? "timeout" : "signal";
            for (const hook of config.hooks.onAbort) {
              try {
                hook({
                  reason,
                  message: err.message,
                  url: url.toString(),
                  elapsed: performance.now() - timing.startTime,
                  timestamp: Date.now()
                }, config);
              } catch {}
            }
          }
          const error = buildSmartError(config, fetchOptions, err);
          resolve(error);
        });
        req.on("socket", (socket) => {
          timeoutManager.setSocket(socket);
          timeoutManager.setRequest(req);
          timeoutManager.setTimeoutCallback((phase, elapsed) => {
            _stats.statusOnNext = "error";
            const error = timeoutManager.createTimeoutError(phase, elapsed);
            if (config.hooks?.onTimeout && config.hooks.onTimeout.length > 0) {
              const timeoutType = phase === "connect" ? "connect" : phase === "headers" ? "response" : phase === "body" ? "response" : "request";
              for (const hook of config.hooks.onTimeout) {
                try {
                  hook({
                    type: timeoutType,
                    timeout: elapsed,
                    elapsed,
                    url: url.toString(),
                    timestamp: Date.now()
                  }, config);
                } catch {}
              }
            }
            const eventEmitter = streamResult || downloadResult || uploadResult;
            if (eventEmitter) {
              eventEmitter.emit("error", error);
            }
            resolve(error);
          });
          const reqContext = beginRequestContext(socket, isSecure);
          const telemetry = getSocketTelemetry(socket);
          if (reqContext.connectionReused) {
            timeoutManager.clearPhase("connect");
            if (timeoutManager.hasPhase("headers")) {
              timeoutManager.startPhase("headers");
            }
            if (telemetry) {
              config.timing.domainLookupStart = timing.dnsStart = performance.now();
              config.timing.domainLookupEnd = timing.dnsEnd = timing.dnsStart;
              config.timing.connectStart = timing.tcpStart = timing.dnsEnd;
              config.timing.connectEnd = timing.tcpEnd = timing.tcpStart;
              if (telemetry.network.remoteAddress) {
                config.network.remoteAddress = telemetry.network.remoteAddress;
                config.network.remotePort = telemetry.network.remotePort;
                config.network.localAddress = telemetry.network.localAddress;
                config.network.localPort = telemetry.network.localPort;
                config.network.family = telemetry.network.family;
              }
              if (isSecure && telemetry.tls) {
                config.security.tlsVersion = telemetry.tls.protocol;
                config.security.cipher = telemetry.tls.cipher;
                if (telemetry.tls.certificate) {
                  config.security.certificateInfo = {
                    subject: { CN: telemetry.tls.certificate.subject },
                    issuer: { CN: telemetry.tls.certificate.issuer },
                    validFrom: telemetry.tls.certificate.validFrom,
                    validTo: telemetry.tls.certificate.validTo,
                    fingerprint: telemetry.tls.certificate.fingerprint
                  };
                }
              }
              config.connectionReuse = {
                reused: true,
                reuseCount: telemetry.reuse.count,
                socketAge: Date.now() - telemetry.timings.created,
                historicalDns: telemetry.timings.dnsDuration || 0,
                historicalTcp: telemetry.timings.tcpDuration || 0,
                historicalTls: telemetry.timings.tlsDuration || 0
              };
            }
          } else {
            if (timeoutManager.hasPhase("connect")) {
              timeoutManager.startPhase("connect");
            }
            timing.dnsStart = performance.now();
            config.timing.domainLookupStart = timing.dnsStart;
            config.connectionReuse = {
              reused: false,
              reuseCount: 1
            };
            const populateFromTelemetry = () => {
              if (!telemetry)
                return;
              if (telemetry.timings.dnsEnd && !timing.dnsEnd) {
                timing.dnsEnd = performance.now();
                config.timing.domainLookupEnd = timing.dnsEnd;
                timing.tcpStart = performance.now();
                config.timing.connectStart = timing.tcpStart;
                if (config.hooks?.onDns && config.hooks.onDns.length > 0) {
                  for (const hook of config.hooks.onDns) {
                    try {
                      hook({
                        hostname: url.hostname,
                        address: telemetry.timings.address || "",
                        family: telemetry.timings.family || 4,
                        duration: telemetry.timings.dnsDuration || 0,
                        timestamp: Date.now()
                      }, config);
                    } catch (err) {
                      if (config.debug) {
                        console.log("[Rezo Debug] onDns hook error:", err);
                      }
                    }
                  }
                }
              }
              if (telemetry.timings.connectEnd && !timing.tcpEnd) {
                timing.tcpEnd = performance.now();
                config.timing.connectEnd = timing.tcpEnd;
                if (isSecure) {
                  timing.tlsStart = performance.now();
                  config.timing.secureConnectionStart = timing.tlsStart;
                }
                if (telemetry.network.remoteAddress) {
                  config.network.remoteAddress = telemetry.network.remoteAddress;
                  config.network.remotePort = telemetry.network.remotePort;
                  config.network.localAddress = telemetry.network.localAddress;
                  config.network.localPort = telemetry.network.localPort;
                  config.network.family = telemetry.network.family;
                }
                if (config.hooks?.onSocket && config.hooks.onSocket.length > 0) {
                  for (const hook of config.hooks.onSocket) {
                    try {
                      hook({
                        type: "connect",
                        localAddress: telemetry.network.localAddress,
                        localPort: telemetry.network.localPort,
                        remoteAddress: telemetry.network.remoteAddress,
                        remotePort: telemetry.network.remotePort,
                        timestamp: Date.now()
                      }, socket);
                    } catch (err) {
                      if (config.debug) {
                        console.log("[Rezo Debug] onSocket hook error:", err);
                      }
                    }
                  }
                }
                if (!isSecure) {
                  timeoutManager.clearPhase("connect");
                  if (timeoutManager.hasPhase("headers")) {
                    timeoutManager.startPhase("headers");
                  }
                }
              }
              if (isSecure && telemetry.timings.secureConnectEnd && !timing.tlsEnd) {
                timing.tlsEnd = performance.now();
                config.timing.connectEnd = timing.tlsEnd;
                timeoutManager.clearPhase("connect");
                if (timeoutManager.hasPhase("headers")) {
                  timeoutManager.startPhase("headers");
                }
                if (telemetry.tls) {
                  config.security.tlsVersion = telemetry.tls.protocol;
                  config.security.cipher = telemetry.tls.cipher;
                  config.security.certificateInfo = telemetry.tls.certificate ? {
                    subject: { CN: telemetry.tls.certificate.subject },
                    issuer: { CN: telemetry.tls.certificate.issuer },
                    validFrom: telemetry.tls.certificate.validFrom,
                    validTo: telemetry.tls.certificate.validTo,
                    fingerprint: telemetry.tls.certificate.fingerprint
                  } : undefined;
                  config.security.validationResults = {
                    certificateValid: true,
                    hostnameMatch: telemetry.tls.certificate?.subject === url.hostname || false,
                    chainValid: telemetry.tls.authorized === true,
                    authorizationError: telemetry.tls.authorizationError ? true : false
                  };
                  if (config.hooks?.onTls && config.hooks.onTls.length > 0) {
                    for (const hook of config.hooks.onTls) {
                      try {
                        hook({
                          protocol: telemetry.tls.protocol || "",
                          cipher: telemetry.tls.cipher || "",
                          authorized: telemetry.tls.authorized !== false,
                          authorizationError: telemetry.tls.authorizationError,
                          certificate: telemetry.tls.certificate ? {
                            subject: telemetry.tls.certificate.subject || "",
                            issuer: telemetry.tls.certificate.issuer || "",
                            validFrom: telemetry.tls.certificate.validFrom || "",
                            validTo: telemetry.tls.certificate.validTo || "",
                            fingerprint: telemetry.tls.certificate.fingerprint || ""
                          } : undefined,
                          duration: telemetry.timings.tlsDuration || 0,
                          timestamp: Date.now()
                        }, config);
                      } catch (err) {
                        if (config.debug) {
                          console.log("[Rezo Debug] onTls hook error:", err);
                        }
                      }
                    }
                  }
                }
              }
            };
            if (socket?.readyState === "open" || socket?.writable === true && !socket?.connecting) {
              populateFromTelemetry();
            } else if (isSecure) {
              socket.once("secureConnect", () => populateFromTelemetry());
            } else {
              socket.once("connect", () => populateFromTelemetry());
            }
          }
        });
        req.on("error", (error) => {
          timeoutManager.clearAll();
          _stats.statusOnNext = "error";
          updateTiming(config, timing, "", 0);
          const e = buildSmartError(config, fetchOptions, error);
          const eventEmitter = streamResult || downloadResult || uploadResult;
          if (eventEmitter) {
            eventEmitter.emit("error", e);
          }
          resolve(e);
          return;
        });
        let bodyPiped = false;
        if (body) {
          if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
            req.write(body.toString());
          } else if (body instanceof FormData || body instanceof RezoFormData) {
            const form = body instanceof RezoFormData ? body : RezoFormData.fromNativeFormData(body);
            const buffer = await form.toBuffer();
            const contentType = await form.getContentTypeAsync();
            req.setHeader("Content-Type", contentType);
            req.setHeader("Content-Length", buffer.length);
            if (uploadResult) {
              const chunkSize = 16384;
              const totalSize = buffer.length;
              let written = 0;
              const uploadStart = performance.now();
              for (let offset = 0;offset < totalSize; offset += chunkSize) {
                const end = Math.min(offset + chunkSize, totalSize);
                const chunk = buffer.slice(offset, end);
                req.write(chunk);
                written += chunk.length;
                const now = performance.now();
                const elapsed = now - uploadStart;
                const speed = elapsed > 0 ? written / (elapsed / 1000) : 0;
                uploadResult.emit("progress", {
                  loaded: written,
                  total: totalSize,
                  percentage: written / totalSize * 100,
                  speed,
                  averageSpeed: speed,
                  estimatedTime: speed > 0 ? (totalSize - written) / speed * 1000 : 0,
                  timestamp: now
                });
              }
            } else {
              req.write(buffer);
            }
          } else if (body instanceof Readable) {
            bodyPiped = true;
            body.pipe(req);
          } else if (typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
            req.write(JSON.stringify(body));
          } else {
            req.write(body);
          }
        }
        if (!bodyPiped) {
          req.end();
        }
      } catch (error) {
        _stats.statusOnNext = "error";
        updateTiming(config, timing, "", 0);
        const e = buildSmartError(config, fetchOptions, error);
        const eventEmitter = streamResult || downloadResult || uploadResult;
        if (eventEmitter) {
          eventEmitter.emit("error", e);
        }
        resolve(e);
        return;
      }
    } catch (error) {
      const rezoError = buildSmartError(config, fetchOptions, error);
      const eventEmitter = streamResult || downloadResult || uploadResult;
      if (eventEmitter) {
        eventEmitter.emit("error", rezoError);
      }
      resolve(rezoError);
    }
  });
}
function updateTiming(config, timing, contentLength, contentLengthCounter, rawHeaders) {
  const now = performance.now();
  config.timing.domainLookupStart = timing.dnsStart || config.timing.startTime;
  config.timing.domainLookupEnd = timing.dnsEnd || timing.dnsStart || config.timing.startTime;
  config.timing.connectStart = timing.tcpStart || timing.dnsEnd || config.timing.startTime;
  config.timing.secureConnectionStart = timing.tlsStart || 0;
  config.timing.connectEnd = timing.tlsEnd || timing.tcpEnd || timing.tcpStart || config.timing.startTime;
  config.timing.requestStart = timing.tlsEnd || timing.tcpEnd || config.timing.startTime;
  config.timing.responseStart = timing.firstByteTime || config.timing.requestStart;
  config.timing.responseEnd = now;
  const bodySize = parseInt(contentLength || "0", 10) || contentLengthCounter;
  config.transfer.bodySize = bodySize;
  let headerSize = 0;
  if (rawHeaders && rawHeaders.length > 0) {
    for (let i = 0;i < rawHeaders.length; i += 2) {
      const key = rawHeaders[i] || "";
      const value = rawHeaders[i + 1] || "";
      headerSize += Buffer.byteLength(key + ": " + value + `\r
`, "utf8");
    }
    headerSize += 2;
    config.transfer.headerSize = headerSize;
  }
  config.transfer.responseSize = headerSize + bodySize;
  if (contentLength && contentLengthCounter) {
    const originalSize = parseInt(contentLength, 10);
    if (originalSize > 0 && contentLengthCounter > 0) {
      config.transfer.compressionRatio = contentLengthCounter / originalSize;
    }
  }
  if (!config.trackingData || Object.keys(config.trackingData).length === 0) {
    config.trackingData = {
      redirectCount: config.redirectCount || 0,
      method: config.method,
      protocol: config.network?.protocol || "unknown",
      httpVersion: config.network?.httpVersion,
      compressed: !!config.transfer.compressionRatio && config.transfer.compressionRatio !== 1,
      cached: false,
      retried: (config.retryAttempts || 0) > 0
    };
  }
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
let dnsCache = null;
function createDNSLookup(cache) {
  return (hostname, optionsOrCallback, callbackOrUndefined) => {
    let options = {};
    let callback;
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    } else if (typeof optionsOrCallback === "number") {
      options = { family: optionsOrCallback };
      callback = callbackOrUndefined;
    } else {
      options = optionsOrCallback || {};
      callback = callbackOrUndefined;
    }
    const family = options.family;
    cache.lookup(hostname, family).then((result) => {
      if (result) {
        callback(null, result.address, result.family);
      } else {
        dns.lookup(hostname, options, callback);
      }
    }).catch(() => {
      dns.lookup(hostname, options, callback);
    });
  };
}
function buildHTTPOptions(fetchOptions, isSecure, url) {
  const {
    method,
    headers,
    timeout,
    proxy,
    httpAgent,
    httpsAgent,
    signal,
    rejectUnauthorized,
    useSecureContext = true,
    auth,
    dnsCache: dnsCacheOption,
    keepAlive = true,
    keepAliveMsecs = 60000,
    useAgentPool = true
  } = fetchOptions;
  const stealthProfile = fetchOptions._resolvedStealth;
  let agent;
  if (httpAgent || httpsAgent) {
    agent = isSecure ? httpsAgent : httpAgent;
  } else if (proxy) {
    agent = parseProxy(proxy, isSecure, rejectUnauthorized, stealthProfile);
  } else if (stealthProfile && isSecure) {
    const tlsOpts = buildTlsOptions(stealthProfile.tls);
    tlsOpts.ALPNProtocols = ["http/1.1"];
    agent = new https.Agent({
      ...tlsOpts,
      servername: url.hostname,
      rejectUnauthorized,
      keepAlive,
      keepAliveMsecs: keepAlive ? keepAliveMsecs : undefined
    });
  } else if (useAgentPool) {
    const agentPool = getGlobalAgentPool({
      keepAlive: true,
      keepAliveMsecs,
      maxSockets: 256,
      maxFreeSockets: 64,
      dnsCache: dnsCacheOption !== false
    });
    if (isSecure) {
      agent = agentPool.getHttpsAgent({
        rejectUnauthorized,
        servername: url.hostname
      });
    } else {
      agent = agentPool.getHttpAgent();
    }
  } else if (isSecure && useSecureContext) {
    agent = new https.Agent({
      secureContext: createSecureContext(),
      servername: url.hostname,
      rejectUnauthorized,
      keepAlive,
      keepAliveMsecs: keepAlive ? keepAliveMsecs : undefined
    });
  }
  let lookup;
  if (fetchOptions.dnsLookup) {
    lookup = fetchOptions.dnsLookup;
  } else if (dnsCacheOption !== false && !useAgentPool) {
    if (!dnsCache) {
      const cacheOptions = typeof dnsCacheOption === "object" ? {
        enable: true,
        ttl: dnsCacheOption.ttl,
        maxEntries: dnsCacheOption.maxEntries
      } : { enable: true };
      dnsCache = getGlobalDNSCache(cacheOptions);
    }
    lookup = createDNSLookup(dnsCache);
  }
  const headerObj = stealthProfile ? headers.toOrderedObject(stealthProfile.headerOrder) : headers.toObject();
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isSecure ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: headerObj,
    timeout: timeout || 0,
    signal,
    rejectUnauthorized,
    agent,
    auth: auth?.username && auth?.password ? `${auth.username}:${auth.password}` : undefined,
    lookup
  };
  return requestOptions;
}
async function setInitialConfig(config, fetchOptions, isSecure, url, httpModule, requestCount, _startTime, _actualTimestamp) {
  if (requestCount === 0) {
    const { body, timeout, proxy, httpAgent, httpsAgent, fileName: filename, auth, signal } = fetchOptions;
    config.adapterUsed = isSecure ? "https" : "http";
    config.adapter = httpModule;
    config.isSecure = isSecure;
    config.finalUrl = url.href;
    config.network.protocol = url.protocol.replace(":", "");
    config.data = body ?? null;
    config.auth = auth ?? null;
    if (proxy !== undefined) {
      config.proxy = proxy;
    }
    let normalizedResponseType = fetchOptions.responseType;
    if (normalizedResponseType) {
      const lowerType = normalizedResponseType.toLowerCase();
      if (lowerType === "arraybuffer") {
        normalizedResponseType = "arrayBuffer";
      } else if (lowerType === "binary") {
        normalizedResponseType = "buffer";
      }
    }
    config.responseType = normalizedResponseType;
    config.insecureHTTPParser = fetchOptions.insecureHTTPParser || false;
    config.maxRate = fetchOptions.maxRate || 0;
    config.cancelToken = fetchOptions.cancelToken ?? null;
    config.signal = signal ?? null;
    config.httpAgent = httpAgent ?? null;
    config.httpsAgent = httpsAgent ?? null;
    config.socketPath = fetchOptions.socketPath ?? null;
    config.fileName = filename ?? null;
    config.adapterMetadata = {
      version: process.version || "1.0.0",
      features: ["http1", "cookies", "redirects", "compression", "proxy", "timeout"],
      capabilities: {
        http1: true,
        http2: config.http2,
        compression: true,
        cookies: !config.disableJar,
        redirects: config.maxRedirects > 0,
        proxy: !!proxy,
        timeout: !!timeout,
        ssl: isSecure
      }
    };
    config.features = {
      http2: !!config.http2,
      compression: !!config.compression?.enabled,
      cookies: !config.disableJar,
      redirects: config.maxRedirects > 0,
      proxy: !!proxy,
      timeout: !!timeout,
      retry: !!config.retry,
      metrics: true,
      events: true,
      validation: true,
      browser: false,
      ssl: isSecure
    };
    const startTime = performance.now();
    config.timing = config.timing || {
      startTime,
      domainLookupStart: startTime,
      domainLookupEnd: startTime,
      connectStart: startTime,
      secureConnectionStart: 0,
      connectEnd: startTime,
      requestStart: startTime,
      responseStart: startTime,
      responseEnd: startTime
    };
    config.timing.startTime = config.timing.startTime || startTime;
    config.maxRedirectsReached = false;
    config.responseCookies = {
      array: [],
      serialized: [],
      netscape: `# Netscape HTTP Cookie File
# This file was generated by Rezo HTTP client
`,
      string: "",
      setCookiesString: []
    };
    config.retryAttempts = 0;
    config.errors = [];
    config.debug = config.debug || fetchOptions.debug || false;
    config.requestId = generateRequestId();
    config.sessionId = fetchOptions.sessionId || generateSessionId();
    config.traceId = generateTraceId();
    config.timestamp = Date.now();
    config.trackingData = {};
    config.transfer = {
      requestSize: 0,
      responseSize: 0,
      headerSize: 0,
      bodySize: 0
    };
    config.security = {};
  }
  let requestBodySize = 0;
  if (fetchOptions.body) {
    if (typeof fetchOptions.body === "string") {
      requestBodySize = Buffer.byteLength(fetchOptions.body, "utf8");
    } else if (Buffer.isBuffer(fetchOptions.body)) {
      requestBodySize = fetchOptions.body.length;
    } else if (fetchOptions.body instanceof RezoFormData) {
      requestBodySize = await fetchOptions.body.getLength();
    } else if (fetchOptions.body instanceof FormData) {
      requestBodySize = await RezoFormData.fromNativeFormData(fetchOptions.body).getLength();
    }
  }
  const headers = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers);
  const requestHeaderSize = calculateRequestHeaderSize(fetchOptions.method?.toUpperCase() || "GET", url, headers.toObject());
  config.transfer.requestSize = requestHeaderSize + requestBodySize;
  config.transfer.requestHeaderSize = requestHeaderSize;
  config.transfer.requestBodySize = requestBodySize;
}
function sanitizeConfig(config) {
  const { data, ...sanitized } = config;
  return sanitized;
}
function emitRedirect(emitter, headers, status, statusText, sourceUri, destinationUri, redirectCount, maxRedirects, method) {
  const jar = new RezoCookieJar;
  const newHeaders = new RezoHeaders(headers);
  const cookies = newHeaders.getSetCookie();
  newHeaders.delete("set-cookie");
  if (cookies && cookies.length > 0) {
    jar.setCookiesSync(cookies, sourceUri);
  }
  const redirectEvent = {
    sourceUrl: sourceUri,
    sourceStatus: status,
    sourceStatusText: statusText,
    destinationUrl: destinationUri,
    redirectCount,
    maxRedirects,
    headers: newHeaders,
    cookies: jar.cookies().array,
    method,
    timestamp: performance.now(),
    duration: 0
  };
  emitter.emit("redirect", redirectEvent);
}
function createSecureContext() {
  return tls.createSecureContext({
    ecdhCurve: "X25519:prime256v1:secp384r1",
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-RSA-AES256-SHA",
      "AES128-GCM-SHA256",
      "AES256-GCM-SHA384",
      "AES128-SHA",
      "AES256-SHA"
    ].join(":"),
    sigalgs: [
      "ecdsa_secp256r1_sha256",
      "rsa_pss_rsae_sha256",
      "rsa_pkcs1_sha256",
      "ecdsa_secp384r1_sha384",
      "rsa_pss_rsae_sha384",
      "rsa_pkcs1_sha384",
      "rsa_pss_rsae_sha512",
      "rsa_pkcs1_sha512"
    ].join(":"),
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    sessionTimeout: 3600
  });
}
function calculateRequestHeaderSize(method, url, headers) {
  const requestLine = `${method} ${url.pathname}${url.search} HTTP/1.1\r
`;
  let size = Buffer.byteLength(requestLine, "utf8");
  size += Buffer.byteLength(`Host: ${url.host}\r
`, "utf8");
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        size += Buffer.byteLength(`${key}: ${v}\r
`, "utf8");
      }
    } else {
      size += Buffer.byteLength(`${key}: ${value}\r
`, "utf8");
    }
  }
  size += 2;
  return size;
}
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
function generateSessionId() {
  return `ses_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
function generateTraceId() {
  return `trc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
const proxyAgentCache = new Map;
const PROXY_AGENT_EVICTION_MS = 60000;
function buildProxyAgentKey(proxy, isSecure, rejectUnauthorized) {
  if (typeof proxy === "string") {
    return `str:${proxy}:${isSecure}:${rejectUnauthorized}`;
  }
  const p = proxy;
  const authKey = p.auth ? `${p.auth.username}:${p.auth.password}` : "";
  return `obj:${p.protocol}://${p.host}:${p.port}:${authKey}:${isSecure}:${rejectUnauthorized}`;
}
function evictStaleProxyAgents() {
  const now = Date.now();
  for (const [key, entry] of proxyAgentCache) {
    if (now - entry.lastUsed > PROXY_AGENT_EVICTION_MS) {
      try {
        entry.agent.destroy();
      } catch {}
      proxyAgentCache.delete(key);
    }
  }
}
let lastProxyEviction = 0;
function parseProxy(proxy, isScure = true, rejectUnauthorized = false, stealthProfile) {
  if (!proxy) {
    return;
  }
  const now = Date.now();
  if (now - lastProxyEviction > PROXY_AGENT_EVICTION_MS / 2) {
    evictStaleProxyAgents();
    lastProxyEviction = now;
  }
  const cacheKey = buildProxyAgentKey(proxy, isScure, rejectUnauthorized);
  if (!stealthProfile) {
    const cached = proxyAgentCache.get(cacheKey);
    if (cached) {
      cached.lastUsed = now;
      return cached.agent;
    }
  }
  const stealthTlsOpts = stealthProfile ? buildTlsOptions(stealthProfile.tls) : undefined;
  if (stealthTlsOpts)
    stealthTlsOpts.ALPNProtocols = ["http/1.1"];
  let agent;
  if (typeof proxy === "string") {
    if (proxy.startsWith("http://")) {
      agent = rezoProxy(`http://${proxy.slice(7)}`, "http", stealthTlsOpts ? { targetTlsOptions: stealthTlsOpts } : undefined);
    } else if (proxy.startsWith("https://")) {
      agent = rezoProxy(`https://${proxy.slice(8)}`, "https", stealthTlsOpts ? { targetTlsOptions: stealthTlsOpts } : undefined);
    } else {
      agent = rezoProxy(proxy, stealthTlsOpts);
    }
  } else if (proxy.protocol === "http" || proxy.protocol === "https") {
    agent = rezoProxy({
      ...proxy,
      client: !isScure ? "http" : "https",
      ...stealthTlsOpts ? { targetTlsOptions: stealthTlsOpts } : {}
    });
  } else {
    agent = rezoProxy(proxy, stealthTlsOpts);
  }
  if (!stealthProfile) {
    proxyAgentCache.set(cacheKey, { agent, lastUsed: now });
  }
  return agent;
}
async function updateCookies(config, headers, url, rootJar) {
  const cookies = headers["set-cookie"];
  if (cookies) {
    const jar = new RezoCookieJar;
    const tempJar = new RezoCookieJar;
    tempJar.setCookiesSync(cookies, url);
    const parsedCookies = tempJar.cookies();
    const acceptedCookies = [];
    let hookError = null;
    if (config.hooks?.beforeCookie && config.hooks.beforeCookie.length > 0) {
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
    const jarToUpdate = rootJar || config.jar;
    if (!config.disableJar && jarToUpdate) {
      jarToUpdate.setCookiesSync(acceptedCookieStrings, url);
    }
    jar.setCookiesSync(acceptedCookieStrings, url);
    if (config.useCookies) {
      const existingArray = config.responseCookies?.array || [];
      for (const cookie of acceptedCookies) {
        const existingIndex = existingArray.findIndex((c) => c.key === cookie.key && c.domain === cookie.domain);
        if (existingIndex >= 0) {
          existingArray[existingIndex] = cookie;
        } else {
          existingArray.push(cookie);
        }
      }
      const mergedJar = new RezoCookieJar(existingArray, url);
      config.responseCookies = mergedJar.cookies();
    }
    if (!hookError && config.hooks?.afterCookie && config.hooks.afterCookie.length > 0) {
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
  }
}

exports.executeRequest = executeRequest;