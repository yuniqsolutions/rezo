const { assertInputTransport } = require('../utils/request-fetch-options.cjs');
const { resolveResponseType } = require('../shared/resolve-response-type.cjs');
const { requestBodyBytes, isBlobBody } = require('../utils/request-body.cjs');
const { assertNodeBodyAvailable, claimNodeBodyStream, nodeRequestBodyStream, pipeRequestBody } = require('./node-request-body.cjs');
const { encodeMultipartBody } = require('./multipart-request-body.cjs');
const { takeCoreCacheOwnership } = require('../cache/response-cache-ownership.cjs');
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { RezoError } = require('../errors/rezo-error.cjs');
const { RezoCookieJar } = require('../cookies/index.cjs');
import RezoHeaders, { prepareRedirectHeaders } from '../utils/headers.cjs';
const { createRedirectHeaderPolicyState, stageRedirectHeaderTransition } = require('../utils/redirect-header-policy.cjs');
function redirectHeaderField(value, field) {
  if (value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, field)) {
    return Object.freeze({ kind: "present", value: Reflect.get(value, field) });
  }
  return Object.freeze({ kind: "absent" });
}
function redirectPatchToCarrier(patch) {
  const carrier = Object.create(null);
  for (const [name, operation] of patch.entries()) {
    carrier[name] = operation.kind === "delete" ? undefined : operation.values.length === 1 ? operation.values[0] : [...operation.values];
  }
  return carrier;
}
const { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } = require('../utils/http-config.cjs');
const { RezoURLSearchParams } = require('../utils/data-operations.cjs');
const RezoFormData = require('../utils/form-data.cjs');
const { destroyPendingProxyHandshake, rezoProxy } = require('../proxy/index.cjs');
const { StreamResponse } = require('../responses/stream.cjs');
const { DownloadResponse } = require('../responses/download.cjs');
const { UploadResponse } = require('../responses/upload.cjs');
const { CompressionUtil } = require('../utils/compression.cjs');
const { ZstdFrameValidator } = require('../utils/zstd-frame-validator.cjs');
const { buildResponseFromIncoming, buildDownloadResponse, mergeRequestAndResponseCookieSnapshot } = require('../responses/buildResponse.cjs');
const { buildDownloadError, buildDecompressionError, buildRedirectControlError, buildSmartError, builErrorFromResponse } = require('../responses/buildError.cjs');
const { classifyRedirectOrigin, isSameDomain, RezoPerformance } = require('../utils/tools.cjs');
const { sanitizeConfig } = require('../responses/sanitize-config.cjs');
const { getGlobalDNSCache } = require('../cache/dns-cache.cjs');
const { isIP } = require("node:net");
const { ResponseCache } = require('../cache/response-cache.cjs');
const { getGlobalAgentPool } = require('../utils/agent-pool.cjs');
const { buildTlsOptions } = require('../stealth/tls-fingerprint.cjs');
const { StagedTimeoutManager, parseStagedTimeouts, resolveTimeoutMs } = require('../utils/staged-timeout.cjs');
const { combineWaitInterrupts, containLifecycleHook, createStagedTimeoutError, createTotalDeadline, statusAttemptContinues } = require('../shared/index.cjs');
const { debugErrorDump } = require('../utils/debug-error-dump.cjs');
const { settleFacadeError } = require('../core/hooks.cjs');
const { handleRateLimitWait, shouldWaitOnStatus } = require('../utils/rate-limit-wait.cjs');
const { getSocketTelemetry, beginRequestContext } = require('../utils/socket-telemetry.cjs');
const dns = require("node:dns");
const { bunHttp, isBunRuntime, isBunSocksRequest } = require('../internal/agents/bun-socks-http.cjs');
const { attachDownloadTargetFailureCause, createDownloadTargetTransaction } = require('./download-target-transaction.cjs');
function errorFromUnknown(value) {
  if (value instanceof Error)
    return value;
  const wrapper = new Error(String(value));
  Object.defineProperty(wrapper, "cause", { value, enumerable: false });
  return wrapper;
}
function combineDownloadTargetFailureCause(primaryCause, cleanupFailure) {
  const combined = new AggregateError([primaryCause, cleanupFailure], primaryCause.message);
  const primaryCode = primaryCause.code;
  if (primaryCode !== undefined) {
    Object.defineProperty(combined, "code", {
      value: primaryCode,
      enumerable: false
    });
  }
  return combined;
}
function createPrematureResponseCloseError() {
  const error = new Error("Response closed before the body completed");
  error.code = "ERR_STREAM_PREMATURE_CLOSE";
  return error;
}
function finalizePendingAgentRequest(request, error) {
  if (!(request instanceof http.ClientRequest) || request.socket || request.closed || request.destroyed)
    return false;
  const candidateAgent = Reflect.get(request, "agent");
  if (!(candidateAgent instanceof http.Agent))
    return false;
  const requestsDescriptor = Reflect.getOwnPropertyDescriptor(candidateAgent, "requests");
  if (!requestsDescriptor || requestsDescriptor.get !== undefined || requestsDescriptor.set !== undefined || requestsDescriptor.value !== candidateAgent.requests)
    return false;
  const onSocketDescriptor = Reflect.getOwnPropertyDescriptor(http.ClientRequest.prototype, "onSocket");
  const nativeOnSocket = onSocketDescriptor?.value;
  if (typeof nativeOnSocket !== "function" || nativeOnSocket.length < 2)
    return false;
  let matchedKey;
  let matchedQueue;
  let matchedIndex = -1;
  let matchCount = 0;
  for (const [key, queue] of Object.entries(candidateAgent.requests)) {
    if (!queue)
      continue;
    for (let index = 0;index < queue.length; index++) {
      if (queue[index] !== request)
        continue;
      matchCount += 1;
      matchedKey = key;
      matchedQueue = queue;
      matchedIndex = index;
    }
  }
  if (matchCount !== 1 || matchedKey === undefined || !matchedQueue || matchedIndex < 0) {
    return false;
  }
  matchedQueue.splice(matchedIndex, 1);
  if (matchedQueue.length === 0) {
    Reflect.deleteProperty(candidateAgent.requests, matchedKey);
  }
  try {
    Reflect.apply(nativeOnSocket, request, [null, error]);
    return true;
  } catch {
    if (matchedQueue.length === 0) {
      Reflect.set(candidateAgent.requests, matchedKey, matchedQueue);
    }
    matchedQueue.splice(matchedIndex, 0, request);
    return false;
  }
}
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
  errorDump: (config, error) => debugErrorDump(config, error),
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
  const coreDispatchIdentity = options;
  const canonicalResponseType = resolveResponseType(options.responseType, defaultOptions?.responseType, options);
  if (options.responseType !== canonicalResponseType) {
    options = { ...options, responseType: canonicalResponseType };
  }
  assertInputTransport(options, defaultOptions, "http");
  const coreDefaults = defaultOptions;
  const d_options = {
    ...await getDefaultConfig(defaultOptions, coreDefaults._proxyManager),
    validateStatus: defaultOptions.validateStatus,
    _dnsCache: coreDefaults._dnsCache ?? null
  };
  const config = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  if (config.fetchOptions?.headers instanceof RezoHeaders) {
    config.fetchOptions.headers = prepareRedirectHeaders(config.fetchOptions.headers, "same-origin");
  }
  let mainConfig = config.config;
  const { proxyManager } = config;
  const perform = new RezoPerformance;
  let selectedProxy = null;
  if (proxyManager && !options._proxyRetryDirect) {
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
  let cacheIdentityHeaders;
  let cachedEntry;
  let _needsRevalidation = false;
  if (cacheOption && !takeCoreCacheOwnership(coreDispatchIdentity)) {
    cache = getResponseCache(cacheOption);
    requestHeaders = config.fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(config.fetchOptions.headers.entries()) : config.fetchOptions.headers;
    cacheIdentityHeaders = { ...requestHeaders };
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
    const res = executeHttp1Request(config.fetchOptions, mainConfig, config.options, perform, d_options.fs, streamResponse, downloadResponse, uploadResponse, jar, _needsRevalidation && cachedEntry !== undefined);
    if (streamResponse) {
      res.catch((err) => {
        debugErrorDump(mainConfig, err);
        settleFacadeError(mainConfig.hooks, streamResponse, err);
      });
      return streamResponse;
    } else if (downloadResponse) {
      res.catch((err) => {
        debugErrorDump(mainConfig, err);
        settleFacadeError(mainConfig.hooks, downloadResponse, err);
      });
      return downloadResponse;
    } else if (uploadResponse) {
      res.catch((err) => {
        debugErrorDump(mainConfig, err);
        settleFacadeError(mainConfig.hooks, uploadResponse, err);
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
  } catch (error) {
    if (proxyManager && selectedProxy) {
      proxyManager.reportFailure(selectedProxy, error);
      if (proxyManager.config.retryWithNextProxy && error?.code !== "ABORT_ERR") {
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
          if (!proxyManager.config.failWithoutProxy) {
            delete options.proxy;
            options._proxyRetryDirect = true;
            return executeRequest(options, defaultOptions, jar);
          }
        }
      }
    }
    debugErrorDump(mainConfig, error);
    throw error;
  }
}
async function executeHttp1Request(fetchOptions, config, options, perform, fs, streamResult, downloadResult, uploadResult, rootJar, acceptNotModified = false) {
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
  let staleSocketRetried = false;
  const totalDeadline = createRequestTotalDeadline(fetchOptions.timeout);
  const throwIfTotalExpired = () => {
    if (!totalDeadline?.expired())
      return;
    const elapsed = totalDeadline.elapsed();
    notifyTimeoutHooks(config, "total", elapsed, fetchOptions.fullUrl ? String(fetchOptions.fullUrl) : String(fetchOptions.url ?? ""));
    throw createStagedTimeoutError("total", elapsed, config, fetchOptions);
  };
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
  let redirectPolicyState;
  let redirectCleanBase;
  let clearedRepresentationHeaders = false;
  let pendingNextPolicyState;
  let pendingNextCleanBase;
  let pendingRedirectHistoryEntry;
  let pendingRedirectCountIncrement = false;
  let pendingVisitedRedirectUrl;
  try {
    while (true) {
      totalAttempts++;
      if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
        const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded. This prevents infinite loops from retries and redirects.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
        throw error;
      }
      throwIfTotalExpired();
      const retrySignal = fetchOptions.signal ?? config.signal ?? undefined;
      const cancellationWins = () => {
        if (!retrySignal?.aborted)
          return;
        const abortedDuringRetry = new Error("Request aborted by signal during the retry decision");
        abortedDuringRetry.code = "ABORT_ERR";
        abortedDuringRetry.name = "AbortError";
        const abortOutcome = buildSmartError(config, fetchOptions, abortedDuringRetry);
        notifyAbortHooksOnce(config, fetchOptions, _stats, timing.startTime, "signal", abortOutcome.message);
        throw abortOutcome;
      };
      const awaitUnlessCancelled = async (work) => {
        cancellationWins();
        throwIfTotalExpired();
        const interruptSignals = [retrySignal, totalDeadline?.signal].filter((signal) => signal !== undefined);
        if (interruptSignals.length === 0)
          return await work();
        const listeners = [];
        const interrupted = new Promise((_, reject) => {
          for (const signal of interruptSignals) {
            const onAbort = () => reject(new Error("Request aborted during the retry decision"));
            signal.addEventListener("abort", onAbort, { once: true });
            listeners.push([signal, onAbort]);
          }
        });
        try {
          const result = await Promise.race([Promise.resolve().then(work), interrupted]);
          cancellationWins();
          throwIfTotalExpired();
          return result;
        } catch (error) {
          cancellationWins();
          throwIfTotalExpired();
          throw error;
        } finally {
          for (const [signal, onAbort] of listeners)
            signal.removeEventListener("abort", onAbort);
        }
      };
      try {
        const response = await request(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, rootJar, acceptNotModified, totalDeadline, (status) => statusAttemptContinues(status, retryConfig, retryAttempt, options.waitOnStatus));
        const statusOnNext = _stats.statusOnNext;
        if (response instanceof RezoError) {
          config.errors.push({
            attempt: config.retryAttempts + 1,
            error: response,
            duration: perform.now()
          });
          perform.reset();
          if (response.phase === "total" && response.code === "ECONNABORTED") {
            throw response;
          }
          if (response.isStaleSocketReset && !staleSocketRetried) {
            const staleMethod = (fetchOptions.method || "GET").toUpperCase();
            const staleBody = fetchOptions.body;
            const bodyReplayable = staleBody === undefined || staleBody === null || typeof staleBody === "string" || Buffer.isBuffer(staleBody);
            if (["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "TRACE"].includes(staleMethod) && bodyReplayable) {
              staleSocketRetried = true;
              continue;
            }
          }
          if (response?.code === "ABORT_ERR") {
            throw response;
          }
          if (!retryConfig) {
            throw response;
          }
          const method = fetchOptions.method || "GET";
          retryAttempt++;
          if (retryConfig.condition && retryAttempt > retryConfig.maxRetries) {
            debugLog.maxRetries(config, retryConfig.maxRetries);
            if (retryConfig.onRetryExhausted) {
              await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(response, retryAttempt));
            }
            throw response;
          }
          if (retryConfig.condition) {
            const shouldContinue = await awaitUnlessCancelled(() => retryConfig.condition(response, retryAttempt));
            if (shouldContinue === false) {
              if (retryConfig.onRetryExhausted) {
                await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(response, retryAttempt));
              }
              throw response;
            }
          } else {
            const canRetry = shouldRetry(response, retryAttempt, method, retryConfig);
            if (!canRetry) {
              if (retryAttempt > retryConfig.maxRetries) {
                debugLog.maxRetries(config, retryConfig.maxRetries);
                if (retryConfig.onRetryExhausted) {
                  await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(response, retryAttempt));
                }
              }
              throw response;
            }
          }
          const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
          debugLog.retry(config, retryAttempt, retryConfig.maxRetries, responseStatusCode || 0, currentDelay);
          if (retryConfig.onRetry) {
            const shouldProceed = await awaitUnlessCancelled(() => retryConfig.onRetry(response, retryAttempt, currentDelay));
            if (shouldProceed === false) {
              throw response;
            }
          }
          if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
            for (const hook of config.hooks.beforeRetry) {
              await awaitUnlessCancelled(() => hook(config, response, retryAttempt));
            }
          }
          if (currentDelay > 0) {
            let delayTimer;
            try {
              await awaitUnlessCancelled(() => new Promise((resolve) => {
                delayTimer = setTimeout(resolve, currentDelay);
              }));
            } finally {
              if (delayTimer !== undefined)
                clearTimeout(delayTimer);
            }
          }
          cancellationWins();
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
          if (config.maxRedirects === 0) {
            config.maxRedirectsReached = true;
            const redirectError = buildRedirectControlError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
            throw redirectError;
          }
          if (fetchOptions.followRedirects === false) {
            const validateStatus = fetchOptions.validateStatus;
            if (validateStatus !== undefined && validateStatus !== null && !validateStatus(response.status)) {
              throw RezoError.createHttpError(response.status, config, fetchOptions, response);
            }
            if (streamResult && !streamResult.isFinished()) {
              const terminal = {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                contentType: response.contentType || undefined,
                contentLength: 0,
                finalUrl: response.finalUrl,
                cookies: response.cookies,
                urls: response.urls,
                timing: getTimingDurations(config),
                config: sanitizeConfig(config)
              };
              streamResult.emit("end");
              streamResult.emit("finish", terminal);
              streamResult.emit("done", terminal);
              streamResult.emit("complete", terminal);
              streamResult._markFinished();
              streamResult.end();
            } else if (downloadResult && !downloadResult.isFinished()) {
              const durations = getTimingDurations(config);
              const terminal = {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                contentType: response.contentType || "",
                contentLength: 0,
                finalUrl: response.finalUrl,
                cookies: response.cookies,
                urls: response.urls,
                fileName: downloadResult.fileName,
                fileSize: 0,
                timing: { ...durations, download: durations.download || 0 },
                averageSpeed: 0,
                config: sanitizeConfig(config)
              };
              downloadResult.emit("finish", terminal);
              downloadResult.emit("done", terminal);
              downloadResult.emit("complete", terminal);
              downloadResult._markFinished();
            } else if (uploadResult && !uploadResult.isFinished()) {
              const durations = getTimingDurations(config);
              const terminal = {
                response: {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                  data: response.data,
                  contentType: response.contentType || "",
                  contentLength: 0
                },
                finalUrl: response.finalUrl,
                cookies: response.cookies,
                urls: response.urls,
                uploadSize: config.transfer?.requestSize || 0,
                fileName: uploadResult.fileName,
                timing: { ...durations, upload: durations.firstByte || 0, waiting: 0 },
                averageUploadSpeed: 0,
                averageDownloadSpeed: 0,
                config: sanitizeConfig(config)
              };
              uploadResult.emit("finish", terminal);
              uploadResult.emit("done", terminal);
              uploadResult.emit("complete", terminal);
              uploadResult._markFinished();
            }
            return response;
          }
          if (_stats.invalidRedirectLocation !== undefined) {
            const redirectError = new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({
              attempt: config.retryAttempts + 1,
              error: redirectError,
              duration: perform.now()
            });
            throw redirectError;
          }
          const addedOptions = {};
          const location = _stats.redirectUrl;
          if (!location || !_stats.redirectUrl) {
            const redirectError = RezoError.createRedirectError("Redirect location not found", config, fetchOptions, response);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
            throw redirectError;
          }
          const redirectCode = response.status;
          const customHeaders = undefined;
          const sourceHeadersSnapshot = fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : fetchOptions.headers;
          if (sourceHeadersSnapshot instanceof RezoHeaders) {
            const readSnapshotHeader = sourceHeadersSnapshot.get.bind(sourceHeadersSnapshot);
            Object.defineProperty(sourceHeadersSnapshot, "get", {
              configurable: true,
              writable: true,
              value: (name) => readSnapshotHeader(name) ?? undefined
            });
          }
          const sourceRequestSnapshot = {
            ...fetchOptions,
            headers: sourceHeadersSnapshot
          };
          const redirectBaseBeforeHooks = redirectCleanBase ?? (fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : undefined);
          const hookHeaderOps = [];
          let hookCarrierBeforeHooks;
          let hookCarrierReplacement;
          let hookRecorder;
          if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
            if (fetchOptions.headers instanceof RezoHeaders) {
              hookCarrierBeforeHooks = fetchOptions.headers;
              hookRecorder = new Proxy(hookCarrierBeforeHooks, {
                get(target, prop) {
                  const conveniences = {
                    setAuthorization: "authorization",
                    setContentType: "content-type",
                    setUserAgent: "user-agent"
                  };
                  if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(conveniences, prop)) {
                    return (...args) => {
                      hookHeaderOps.push({
                        op: "set",
                        key: conveniences[prop],
                        value: String(args[0])
                      });
                      target[prop](...args);
                      return hookRecorder;
                    };
                  }
                  if (prop === "set" || prop === "append" || prop === "delete") {
                    return (...args) => {
                      if (prop === "delete") {
                        hookHeaderOps.push({ op: "delete", key: String(args[0]) });
                      } else {
                        hookHeaderOps.push({
                          op: prop,
                          key: String(args[0]),
                          value: String(args[1])
                        });
                      }
                      return target[prop](...args);
                    };
                  }
                  const value = Reflect.get(target, prop, target);
                  return typeof value === "function" ? value.bind(hookRecorder) : value;
                },
                set(target, prop, value) {
                  if (typeof prop === "string") {
                    hookHeaderOps.push({
                      op: "set",
                      key: prop,
                      value: String(value)
                    });
                  }
                  return Reflect.set(target, prop, value);
                },
                deleteProperty(target, prop) {
                  if (typeof prop === "string") {
                    hookHeaderOps.push({ op: "delete", key: prop });
                  }
                  return Reflect.deleteProperty(target, prop);
                }
              });
              fetchOptions.headers = hookRecorder;
            }
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
            const afterHooks = fetchOptions.headers;
            if (afterHooks === hookRecorder) {
              fetchOptions.headers = hookCarrierBeforeHooks;
            } else if (afterHooks instanceof RezoHeaders) {
              hookCarrierReplacement = afterHooks;
              fetchOptions.headers = afterHooks;
            } else if (afterHooks && typeof afterHooks === "object") {
              const normalized = new RezoHeaders(afterHooks);
              hookCarrierReplacement = normalized;
              fetchOptions.headers = normalized;
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
          const redirectFields = Object.freeze({
            setHeaders: redirectHeaderField(onRedirect, "setHeaders"),
            setHeadersOnRedirects: redirectHeaderField(onRedirect, "setHeadersOnRedirects")
          });
          if (typeof onRedirect !== "undefined") {
            if (typeof onRedirect === "boolean") {
              if (!onRedirect) {
                const redirectError = buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
                _stats.statusOnNext = "error";
                if (!config.errors)
                  config.errors = [];
                config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
                throw redirectError;
              }
            } else if (!onRedirect.redirect && !onRedirect.withoutBody && !("body" in onRedirect)) {
              const redirectError = buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
              _stats.statusOnNext = "error";
              if (!config.errors)
                config.errors = [];
              config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
              throw redirectError;
            }
          }
          const fromUrl = fetchOptions.fullUrl;
          const selectedRedirectUrl = typeof onRedirect === "object" && onRedirect !== null && onRedirect.redirect === true && onRedirect.url ? onRedirect.url : location;
          const relation = classifyRedirectOrigin(fromUrl, selectedRedirectUrl);
          if (relation === "invalid") {
            const invalidTargetError = new RezoError(`Redirect target is not a valid URL: refusing to follow redirect from ${fromUrl}`, config, "ERR_INVALID_URL", fetchOptions, response);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: invalidTargetError, duration: perform.now() });
            throw invalidTargetError;
          }
          const finalizedRedirectUrl = new URL(selectedRedirectUrl, fromUrl).href;
          const cycleKey = config.enableRedirectCycleDetection === true ? finalizedRedirectUrl.toLowerCase() : undefined;
          if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
            config.maxRedirectsReached = true;
            const redirectError = buildRedirectControlError(`Max redirects (${config.maxRedirects}) reached`, config, "REZ_MAX_REDIRECTS_EXCEEDED", fetchOptions, response);
            _stats.statusOnNext = "error";
            if (!config.errors)
              config.errors = [];
            config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
            throw redirectError;
          }
          if (cycleKey !== undefined) {
            if (visitedUrls.has(cycleKey)) {
              const redirectError = buildRedirectControlError(`Redirect cycle detected: attempting to revisit ${finalizedRedirectUrl}`, config, "REZ_REDIRECT_CYCLE_DETECTED", fetchOptions, response);
              _stats.statusOnNext = "error";
              if (!config.errors)
                config.errors = [];
              config.errors.push({ attempt: config.retryAttempts + 1, error: redirectError, duration: perform.now() });
              throw redirectError;
            }
            pendingVisitedRedirectUrl = cycleKey;
          }
          if (typeof onRedirect === "object" && onRedirect !== null) {
            if (!redirectPolicyState) {
              const init = createRedirectHeaderPolicyState(fetchOptions.fullUrl);
              if (init.ok)
                redirectPolicyState = init.state;
            }
            if (redirectPolicyState) {
              const probe = stageRedirectHeaderTransition(redirectPolicyState, {
                finalizedNormalizedUrl: redirectPolicyState.currentUrl,
                setHeaders: redirectFields.setHeaders,
                setHeadersOnRedirects: redirectFields.setHeadersOnRedirects
              });
              if (!probe.ok) {
                const reason = probe.reason;
                throw new RezoError(reason === "invalid-url" ? "Invalid redirect destination URL" : `Invalid redirect header patch "${probe.field}"`, config, reason === "invalid-url" ? "ERR_INVALID_URL" : "ERR_INVALID_ARG_TYPE", fetchOptions, response);
              }
            }
          }
          pendingRedirectHistoryEntry = {
            url: fetchOptions.fullUrl,
            statusCode: redirectCode,
            statusText: response.statusText,
            headers: response.headers,
            method: fetchOptions.method.toUpperCase(),
            cookies: response.cookies.array,
            duration: perform.now(),
            request: sourceRequestSnapshot
          };
          perform.reset();
          pendingRedirectCountIncrement = true;
          addedOptions.redirectedUrl = finalizedRedirectUrl;
          addedOptions.redirectCode = redirectCode;
          addedOptions.isRedirected = true;
          addedOptions.lastRedirectedUrl = fetchOptions.fullUrl;
          addedOptions.customHeaders = customHeaders;
          addedOptions.fullUrl = fetchOptions.fullUrl;
          delete options.params;
          fetchOptions.fullUrl = finalizedRedirectUrl;
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
              options.fullUrl = finalizedRedirectUrl;
            }
            if (onRedirect.withoutBody) {
              delete options.body;
              delete fetchOptions.body;
              config.originalBody = undefined;
              if (fetchOptions.headers instanceof RezoHeaders) {
                fetchOptions.headers.delete("Content-Type");
                fetchOptions.headers.delete("Content-Length");
                clearedRepresentationHeaders = true;
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
                clearedRepresentationHeaders = true;
              }
            }
            debugLog.redirect(config, fromUrl, fetchOptions.fullUrl, redirectCode, method);
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
              clearedRepresentationHeaders = true;
            }
          } else {
            debugLog.redirect(config, fromUrl, fetchOptions.fullUrl, redirectCode, fetchOptions.method);
          }
          {
            if (fetchOptions.headers instanceof RezoHeaders) {
              if (!redirectPolicyState) {
                const init = createRedirectHeaderPolicyState(fromUrl);
                if (!init.ok) {
                  throw new RezoError("Invalid redirect source URL", config, "ERR_INVALID_URL", fetchOptions, response);
                }
                redirectPolicyState = init.state;
              }
              const transition = stageRedirectHeaderTransition(redirectPolicyState, {
                finalizedNormalizedUrl: String(fetchOptions.fullUrl),
                setHeaders: redirectFields.setHeaders,
                setHeadersOnRedirects: redirectFields.setHeadersOnRedirects
              });
              if (!transition.ok) {
                const reason = transition.reason;
                throw new RezoError(reason === "invalid-url" ? "Invalid redirect destination URL" : `Invalid redirect header patch "${transition.field}"`, config, reason === "invalid-url" ? "ERR_INVALID_URL" : "ERR_INVALID_ARG_TYPE", fetchOptions, response);
              }
              if (transition.relation === "invalid") {
                throw new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
              }
              let nextCleanBase = prepareRedirectHeaders(new RezoHeaders(redirectBaseBeforeHooks ?? fetchOptions.headers), relation);
              if (clearedRepresentationHeaders) {
                nextCleanBase.delete("Content-Type");
                nextCleanBase.delete("Content-Length");
              }
              if (hookCarrierReplacement) {
                nextCleanBase = new RezoHeaders(hookCarrierReplacement);
                nextCleanBase.delete("proxy-authorization");
                addedOptions.hookCookieDecision = true;
              } else {
                for (const hookOp of hookHeaderOps) {
                  if (hookOp.op === "delete")
                    nextCleanBase.delete(hookOp.key);
                  else if (hookOp.op === "append")
                    nextCleanBase.append(hookOp.key, hookOp.value);
                  else
                    nextCleanBase.set(hookOp.key, hookOp.value);
                }
                if (hookHeaderOps.some((hookOp) => hookOp.key.toLowerCase() === "cookie")) {
                  addedOptions.hookCookieDecision = true;
                }
              }
              nextCleanBase.delete("proxy-authorization");
              fetchOptions.headers = new RezoHeaders(nextCleanBase);
              const layers = Object.create(null);
              if (transition.state.persistent) {
                Object.assign(layers, redirectPatchToCarrier(transition.state.persistent.patch));
              }
              if (transition.state.oneHop) {
                Object.assign(layers, redirectPatchToCarrier(transition.state.oneHop));
              }
              addedOptions.customHeaders = Object.keys(layers).length > 0 ? layers : undefined;
              pendingNextPolicyState = transition.state;
              pendingNextCleanBase = nextCleanBase;
            }
            clearedRepresentationHeaders = false;
            if (relation !== "same-origin") {
              delete fetchOptions.auth;
              delete options.auth;
              config.auth = null;
              fetchOptions.withoutCredentialsOnRedirect = true;
            }
          }
          const jarToSync = rootJar || config.jar;
          if (response.cookies?.array?.length > 0 && jarToSync) {
            try {
              jarToSync.setCookiesSync(response.cookies.array, fromUrl);
            } catch (e) {}
          }
          const __ = prepareHTTPOptions(fetchOptions, jarToSync, addedOptions, config);
          if (pendingRedirectHistoryEntry) {
            config.redirectHistory.push(pendingRedirectHistoryEntry);
            pendingRedirectHistoryEntry = undefined;
          }
          if (pendingRedirectCountIncrement) {
            config.redirectCount++;
            pendingRedirectCountIncrement = false;
          }
          if (pendingVisitedRedirectUrl) {
            visitedUrls.add(pendingVisitedRedirectUrl);
            pendingVisitedRedirectUrl = undefined;
          }
          if (pendingNextPolicyState)
            redirectPolicyState = pendingNextPolicyState;
          if (pendingNextCleanBase)
            redirectCleanBase = pendingNextCleanBase;
          pendingNextPolicyState = undefined;
          pendingNextCleanBase = undefined;
          fetchOptions = __.fetchOptions;
          config = __.config;
          options = __.options;
          fetchOptions.url = fetchOptions.fullUrl;
          options.url = fetchOptions.fullUrl;
          config.originalRequest = fetchOptions;
          continue;
        }
        if (statusOnNext === "error") {
          const waitSignal = fetchOptions.signal ?? config.signal ?? undefined;
          if (shouldWaitOnStatus(response.status, options.waitOnStatus)) {
            const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
            const waitInterrupt = combineWaitInterrupts(waitSignal, totalDeadline?.signal);
            let waitResult;
            try {
              waitResult = await handleRateLimitWait({
                status: response.status,
                headers: response.headers,
                data: response.data,
                url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
                method: fetchOptions.method || "GET",
                config,
                options,
                currentWaitAttempt: rateLimitWaitAttempt,
                signal: waitInterrupt.signal,
                isActive: () => waitInterrupt.signal?.aborted !== true
              });
            } finally {
              waitInterrupt.release();
            }
            throwIfAbortedDuringWait(waitSignal, config, fetchOptions, _stats, timing.startTime);
            throwIfTotalExpired();
            if (waitResult.shouldRetry) {
              config._rateLimitWaitAttempt = waitResult.waitAttempt;
              _stats.deferredHeaderEvents = undefined;
              continue;
            }
          }
          const httpError = RezoError.createHttpError(response.status, config, fetchOptions, response);
          if (retryConfig && retryConfig.statusCodes?.includes(response.status)) {
            const method = fetchOptions.method || "GET";
            retryAttempt++;
            let retryAllowed;
            if (retryConfig.condition && retryAttempt > retryConfig.maxRetries) {
              debugLog.maxRetries(config, retryConfig.maxRetries);
              if (retryConfig.onRetryExhausted)
                await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(httpError, retryAttempt));
              retryAllowed = false;
            } else if (retryConfig.condition) {
              retryAllowed = await awaitUnlessCancelled(() => retryConfig.condition(httpError, retryAttempt)) !== false;
              if (!retryAllowed && retryConfig.onRetryExhausted)
                await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(httpError, retryAttempt));
            } else {
              retryAllowed = shouldRetry(httpError, retryAttempt, method, retryConfig);
              if (!retryAllowed && retryAttempt > retryConfig.maxRetries) {
                debugLog.maxRetries(config, retryConfig.maxRetries);
                if (retryConfig.onRetryExhausted)
                  await awaitUnlessCancelled(() => retryConfig.onRetryExhausted(httpError, retryAttempt));
              }
            }
            if (retryAllowed) {
              config.retryAttempts++;
              config.errors.push({
                attempt: config.retryAttempts,
                error: httpError,
                duration: perform.now()
              });
              perform.reset();
              const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
              debugLog.retry(config, retryAttempt, retryConfig.maxRetries, response.status, currentDelay);
              const proceed = retryConfig.onRetry ? await awaitUnlessCancelled(() => retryConfig.onRetry(httpError, retryAttempt, currentDelay)) !== false : true;
              if (proceed) {
                for (const hook of config.hooks?.beforeRetry ?? []) {
                  await awaitUnlessCancelled(() => hook(config, httpError, retryAttempt));
                }
                if (currentDelay > 0) {
                  await waitForRetryDelay(currentDelay, totalDeadline, waitSignal);
                }
                throwIfAbortedDuringWait(waitSignal, config, fetchOptions, _stats, timing.startTime);
                throwIfTotalExpired();
                _stats.deferredHeaderEvents = undefined;
                continue;
              }
            }
          }
          _stats.deferredHeaderEvents?.();
          _stats.deferredHeaderEvents = undefined;
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
  } finally {
    totalDeadline?.clear();
  }
}
function createRequestTotalDeadline(timeout) {
  const { total } = parseStagedTimeouts(timeout);
  return typeof total === "number" && total > 0 ? createTotalDeadline(total) : undefined;
}
async function waitForRetryDelay(delayMs, totalDeadline, interruptSignal) {
  if (interruptSignal?.aborted)
    return;
  await new Promise((resolve) => {
    let timer;
    const finish = () => {
      if (timer !== undefined)
        clearTimeout(timer);
      timer = undefined;
      totalDeadline?.signal.removeEventListener("abort", finish);
      interruptSignal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, delayMs);
    totalDeadline?.signal.addEventListener("abort", finish, { once: true });
    interruptSignal?.addEventListener("abort", finish, { once: true });
  });
}
function throwIfAbortedDuringWait(signal, config, fetchOptions, stats, startTime) {
  if (!signal?.aborted)
    return;
  const abortedDuringWait = new Error("Request aborted by signal during the retry wait");
  abortedDuringWait.code = "ABORT_ERR";
  abortedDuringWait.name = "AbortError";
  const abortOutcome = buildSmartError(config, fetchOptions, abortedDuringWait);
  notifyAbortHooksOnce(config, fetchOptions, stats, startTime, "signal", abortOutcome.message);
  throw abortOutcome;
}
function notifyTimeoutHooks(config, phase, elapsed, url) {
  if (!config.hooks?.onTimeout || config.hooks.onTimeout.length === 0)
    return;
  const timeoutType = phase === "connect" ? "connect" : phase === "headers" || phase === "body" ? "response" : "request";
  for (const hook of config.hooks.onTimeout) {
    containLifecycleHook(() => hook({
      type: timeoutType,
      timeout: elapsed,
      elapsed,
      url,
      timestamp: Date.now()
    }, config), (hookError) => {
      if (config.debug)
        console.log("[Rezo Debug] onTimeout hook error:", hookError);
    });
  }
}
function notifyAbortHooksOnce(config, fetchOptions, stats, startedAt, reason, message) {
  if (stats.abortHooksNotified)
    return;
  stats.abortHooksNotified = true;
  const hooks = config.hooks?.onAbort;
  if (!hooks || hooks.length === 0)
    return;
  const url = String(fetchOptions.fullUrl || fetchOptions.url || "");
  const elapsed = performance.now() - startedAt;
  for (const hook of hooks) {
    containLifecycleHook(() => hook({ reason, message, url, elapsed, timestamp: Date.now() }, config), (hookError) => {
      if (config.debug)
        console.log("[Rezo Debug] onAbort hook error:", hookError);
    });
  }
}
async function request(config, fetchOptions, requestCount, timing, _stats, _responseStatusCode, fs, streamResult, downloadResult, uploadResult, rootJar, acceptNotModified = false, totalDeadline, attemptContinuesAfterStatus = () => false) {
  return await new Promise((resolvePromise) => {
    let promiseSettled = false;
    let activeDownloadFailureCleanup;
    const notifyAbortOutcome = (value) => {
      if (value instanceof RezoError && value.code === "ABORT_ERR") {
        notifyAbortHooksOnce(config, fetchOptions, _stats, timing.startTime, "signal", value.message);
      }
    };
    const settlePromise = (value) => {
      if (promiseSettled)
        return false;
      promiseSettled = true;
      notifyAbortOutcome(value);
      resolvePromise(value);
      return true;
    };
    const totalOverdueAfterParse = () => {
      if (!totalDeadline || totalDeadline.elapsed() < totalDeadline.totalMs)
        return;
      const elapsed = totalDeadline.elapsed();
      notifyTimeoutHooks(config, "total", elapsed, String(fetchOptions.fullUrl || fetchOptions.url || config.url || ""));
      _stats.statusOnNext = "error";
      return createStagedTimeoutError("total", elapsed, config, fetchOptions);
    };
    const settleErrorAfterDownloadCleanup = (primaryCause, buildError) => {
      if (!activeDownloadFailureCleanup) {
        return settlePromise(buildError(primaryCause));
      }
      if (promiseSettled)
        return false;
      promiseSettled = true;
      const cleanup = activeDownloadFailureCleanup;
      activeDownloadFailureCleanup = undefined;
      (async () => {
        let cleanupFailure;
        try {
          await cleanup();
        } catch (error) {
          cleanupFailure = errorFromUnknown(error);
        }
        const effectiveCause = cleanupFailure ? combineDownloadTargetFailureCause(primaryCause, cleanupFailure) : primaryCause;
        const settledError = buildError(effectiveCause, cleanupFailure);
        notifyAbortOutcome(settledError);
        resolvePromise(settledError);
      })().catch((error) => {
        resolvePromise(new RezoError(errorFromUnknown(error).message, config, "REZ_UNKNOWN_ERROR", fetchOptions));
      });
      return true;
    };
    (async () => {
      try {
        const { fullUrl, body, fileName: filename } = fetchOptions;
        assertNodeBodyAvailable(body, config, fetchOptions);
        const url = new URL(fullUrl || fetchOptions.url);
        const isSecure = url.protocol === "https:";
        const httpModule = isBunRuntime() && isBunSocksRequest(fetchOptions.proxy) ? bunHttp : isSecure ? config.isSecure && config.adapter ? config.adapter : https : !config.isSecure && config.adapter ? config.adapter : http;
        await setInitialConfig(config, fetchOptions, isSecure, url, httpModule, requestCount, timing.startTime, timing.startTimestamp);
        const eventEmitter = streamResult || downloadResult || uploadResult;
        if (eventEmitter && requestCount === 0 && _stats.startEventEmitted !== true) {
          const startEvent = {
            url: url.toString(),
            method: fetchOptions.method.toUpperCase(),
            headers: fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers),
            timestamp: timing.startTime,
            timeout: resolveTimeoutMs(fetchOptions.timeout),
            maxRedirects: config.maxRedirects,
            retry: config.retry ? {
              maxRetries: config.retry.maxRetries,
              delay: config.retry.retryDelay,
              backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : config.retry.backoff === "exponential" ? 2 : config.retry.backoff === "linear" ? 1 : undefined
            } : undefined
          };
          _stats.startEventEmitted = true;
          eventEmitter.emit("start", startEvent);
        }
        const requestOptions = buildHTTPOptions(fetchOptions, isSecure, url);
        const { total: _totalBudget, ...attemptTimeouts } = parseStagedTimeouts(fetchOptions.timeout);
        const timeoutManager = new StagedTimeoutManager(attemptTimeouts, config, fetchOptions);
        let detachTotalDeadline;
        let detachRequestAbort;
        let connectionWasReused = false;
        let responseReceived = false;
        let terminalState = "open";
        const claimTerminal = (next) => {
          if (terminalState !== "open")
            return false;
          terminalState = next;
          timeoutManager.clearAll();
          detachTotalDeadline?.();
          detachRequestAbort?.();
          return true;
        };
        const requestAbortSignal = fetchOptions.signal ?? config.signal ?? undefined;
        const remapUserAbort = (candidate) => {
          const candidateCode = candidate.code;
          if (requestAbortSignal?.aborted && (candidateCode === "ECONNRESET" || candidateCode === "EPIPE" || candidateCode === "ECONNABORTED" || candidateCode === "ERR_STREAM_PREMATURE_CLOSE")) {
            const abortCause = new Error(candidate.message || "Request aborted by signal");
            abortCause.code = "ABORT_ERR";
            abortCause.name = "AbortError";
            return abortCause;
          }
          return candidate;
        };
        if (totalDeadline?.expired()) {
          if (claimTerminal("timeout")) {
            _stats.statusOnNext = "error";
            const elapsed = totalDeadline.elapsed();
            notifyTimeoutHooks(config, "total", elapsed, url.toString());
            settlePromise(createStagedTimeoutError("total", elapsed, config, fetchOptions));
          }
          return;
        }
        if (requestAbortSignal?.aborted) {
          if (claimTerminal("transport")) {
            _stats.statusOnNext = "error";
            const preAborted = new Error("Request aborted by signal before dispatch");
            preAborted.code = "ABORT_ERR";
            preAborted.name = "AbortError";
            settlePromise(buildSmartError(config, fetchOptions, preAborted));
          }
          return;
        }
        try {
          let settleOverdueBudget = () => false;
          const transportBody = claimNodeBodyStream(body, config, fetchOptions);
          const req = httpModule.request(requestOptions, (res) => {
            if (terminalState !== "open") {
              res.resume();
              return;
            }
            responseReceived = true;
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
            let contentLengthCounter = 0;
            let responseAborted = false;
            let responseBodyEnded = false;
            let responseFailureInFlight = false;
            let responseFailureIncludesBody = false;
            let responseFailureBody = () => Buffer.alloc(0);
            let responseFailureBytes = () => contentLengthCounter;
            let responseFailureModeCleanup;
            let responseNativeError;
            const cleanupRawResponse = async () => {
              if (res.closed || res.complete && res.readableEnded)
                return;
              await new Promise((closeResolve) => {
                res.once("close", closeResolve);
                if (!res.destroyed)
                  res.destroy();
              });
            };
            const cleanupResponseFailure = async () => {
              try {
                await responseFailureModeCleanup?.();
              } finally {
                await cleanupRawResponse();
              }
            };
            const buildCallbackFailure = (cause) => {
              const error = new RezoError(cause.message || "Response callback failed", config, "REZ_UNKNOWN_ERROR", fetchOptions);
              Object.defineProperty(error, "cause", {
                value: cause,
                enumerable: false
              });
              return error;
            };
            const beginResponseFailure = () => {
              if (promiseSettled || responseFailureInFlight)
                return false;
              if (terminalState === "open") {
                if (!claimTerminal("response"))
                  return false;
              } else if (terminalState !== "response") {
                return false;
              }
              responseFailureInFlight = true;
              return true;
            };
            const buildFailureResponse = (data) => {
              if (responseFailureIncludesBody) {
                return buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
              }
              config.status = statusCode || 200;
              config.statusText = statusMessage || "";
              const partialHeaders = new RezoHeaders(headers);
              partialHeaders.delete("set-cookie");
              return {
                data: undefined,
                status: statusCode || 200,
                statusText: statusMessage || "",
                finalUrl: url.toString(),
                cookies: mergeRequestAndResponseCookieSnapshot(config, config.responseCookies?.array ?? []),
                headers: partialHeaders,
                contentType,
                contentLength: responseFailureBytes(),
                urls: buildUrlTree(config, url.toString()),
                config
              };
            };
            const settleResponseFailure = async (causeValue, origin) => {
              if (!beginResponseFailure())
                return;
              const rawCause = errorFromUnknown(causeValue);
              const cause = origin === "source" ? remapUserAbort(rawCause) : rawCause;
              _stats.statusOnNext = "error";
              try {
                const hasActiveDownload = activeDownloadFailureCleanup !== undefined;
                let cleanupFailure;
                try {
                  await cleanupResponseFailure();
                } catch (error) {
                  if (!hasActiveDownload)
                    throw error;
                  cleanupFailure = errorFromUnknown(error);
                }
                if (hasActiveDownload)
                  activeDownloadFailureCleanup = undefined;
                const effectiveCause = cleanupFailure ? combineDownloadTargetFailureCause(cause, cleanupFailure) : cause;
                updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                if (origin === "callback") {
                  settlePromise(buildCallbackFailure(effectiveCause));
                  return;
                }
                const data = responseFailureBody();
                if (_stats.redirectUrl) {
                  settlePromise(buildFailureResponse(data));
                  return;
                }
                const partialResponse = buildFailureResponse(data);
                settlePromise(RezoError.fromError(effectiveCause, config, fetchOptions, partialResponse));
              } catch (settlementFailure) {
                settlePromise(buildCallbackFailure(errorFromUnknown(settlementFailure)));
              }
            };
            const scheduleResponseFailure = (error) => {
              queueMicrotask(() => {
                settleResponseFailure(error, "source");
              });
            };
            const onResponseAborted = () => {
              responseAborted = true;
            };
            const onResponseError = (error) => {
              responseNativeError ??= error;
              scheduleResponseFailure(responseNativeError);
            };
            const onResponseEnd = () => {
              responseBodyEnded = true;
            };
            const onResponseClose = () => {
              const needsFallback = responseNativeError === undefined && !promiseSettled && (responseAborted || !responseBodyEnded);
              res.off("aborted", onResponseAborted);
              res.off("end", onResponseEnd);
              res.off("error", onResponseError);
              res.off("close", onResponseClose);
              if (!needsFallback)
                return;
              scheduleResponseFailure(createPrematureResponseCloseError());
            };
            const guardResponseWork = (operation) => {
              try {
                operation();
              } catch (error) {
                settleResponseFailure(error, "callback");
              }
            };
            res.once("aborted", onResponseAborted);
            res.once("end", onResponseEnd);
            res.on("error", onResponseError);
            res.once("close", onResponseClose);
            (async () => {
              await updateCookies(config, headers, url.href, rootJar);
              if (terminalState !== "open")
                return;
              let recordedStatusVerdict;
              const cookieArray = config.responseCookies?.array || [];
              delete headers["set-cookie"];
              _stats.redirectUrl = undefined;
              _stats.invalidRedirectLocation = undefined;
              const isRedirected = statusCode !== 304 && typeof statusCode === "number" && statusCode >= 300 && statusCode < 400;
              const eventEmitter = streamResult || downloadResult || uploadResult;
              const attemptIsTerminal = !attemptContinuesAfterStatus(statusCode ?? 0);
              _stats.deferredHeaderEvents = undefined;
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
                const publishHeaderTimeEvents = () => {
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
                };
                if (attemptIsTerminal)
                  publishHeaderTimeEvents();
                else
                  _stats.deferredHeaderEvents = publishHeaderTimeEvents;
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
                  if (terminalState !== "open" || settleOverdueBudget())
                    return;
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
                const rawLocation = typeof location === "string" ? location : location.toString();
                let normalizedRedirectUrl;
                try {
                  const redirectUrlObj = new URL(rawLocation, url);
                  if (!redirectUrlObj.hash && url.hash) {
                    redirectUrlObj.hash = url.hash;
                  }
                  normalizedRedirectUrl = redirectUrlObj.href;
                } catch {
                  _stats.invalidRedirectLocation = rawLocation;
                }
                if (normalizedRedirectUrl !== undefined) {
                  _stats.redirectUrl = normalizedRedirectUrl;
                  const prospectiveRedirectCount = (config.redirectCount ?? 0) + 1;
                  if (eventEmitter && fetchOptions.followRedirects !== false) {
                    emitRedirect(eventEmitter, headers, statusCode || 302, statusMessage || "", url.toString(), _stats.redirectUrl, prospectiveRedirectCount, config.maxRedirects, fetchOptions.method.toUpperCase());
                  }
                }
              }
              let streamStatusAccepted = true;
              if (streamResult && !isRedirected) {
                try {
                  const validateStreamStatus = fetchOptions.validateStatus ?? ((status) => status >= 200 && status < 300);
                  streamStatusAccepted = statusCode === 304 && acceptNotModified && fetchOptions.validateStatus === undefined || !!statusCode && (fetchOptions.validateStatus === null || validateStreamStatus(statusCode) === true);
                } catch (callbackFailure) {
                  settleResponseFailure(callbackFailure, "callback");
                  return;
                }
                recordedStatusVerdict = { accepted: streamStatusAccepted };
              }
              if (streamResult && (isRedirected || streamStatusAccepted)) {
                if (isRedirected) {
                  if (!claimTerminal("response")) {
                    res.resume();
                    return;
                  }
                  const sourceResponse = {
                    data: undefined,
                    status: statusCode,
                    statusText: statusMessage || "",
                    finalUrl: url.href,
                    cookies: config.responseCookies,
                    headers: new RezoHeaders(headers),
                    contentType,
                    contentLength: 0,
                    urls: buildUrlTree(config, url.href),
                    config
                  };
                  res.resume();
                  settlePromise(sourceResponse);
                  return;
                }
                if (streamResult.encoding) {
                  res.setEncoding(streamResult.encoding);
                }
                responseFailureModeCleanup = async () => {
                  res.unpipe(streamResult);
                };
                let streamedBytes = 0;
                responseFailureBytes = () => streamedBytes;
                const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
                const streamStartTime = performance.now();
                const streamContentEncoding = (res.headers["content-encoding"] || "").toLowerCase();
                const zstdStreamTee = streamContentEncoding === "zstd" && CompressionUtil.shouldDecompress(streamContentEncoding, config) ? new ZstdFrameValidator : null;
                res.on("data", (chunk) => {
                  guardResponseWork(() => {
                    if (terminalState !== "open")
                      return;
                    zstdStreamTee?.update(chunk);
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
                });
                res.on("end", () => {
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
                    updateTiming(config, timing, contentLength || "", streamedBytes, res.rawHeaders);
                    if (zstdStreamTee) {
                      const verdict = zstdStreamTee.finish();
                      if (!verdict.complete) {
                        _stats.statusOnNext = "error";
                        const error = buildDecompressionError({
                          statusCode: res.statusCode || 500,
                          headers,
                          contentType,
                          contentLength: contentLength || streamedBytes.toString(),
                          cookies: cookies || [],
                          statusText: verdict.fault ? `invalid zstd frame: ${verdict.fault}` : "truncated zstd frame: the encoded body ended before the frame was structurally complete",
                          url: res.url || url.toString(),
                          body: null,
                          finalUrl: url.toString(),
                          config,
                          request: fetchOptions
                        });
                        settlePromise(error);
                        return;
                      }
                    }
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
                    const minimalResponse = buildResponseFromIncoming(res, Buffer.alloc(0), config, url.toString(), buildUrlTree(config, url.toString()));
                    const overdueAfterStreamParse = totalOverdueAfterParse();
                    if (overdueAfterStreamParse) {
                      settlePromise(overdueAfterStreamParse);
                      return;
                    }
                    streamResult.emit("end");
                    streamResult.emit("finish", streamFinishEvent);
                    streamResult.emit("done", streamFinishEvent);
                    streamResult.emit("complete", streamFinishEvent);
                    streamResult._markFinished();
                    _stats.statusOnNext = "success";
                    settlePromise(minimalResponse);
                  });
                });
                res.pipe(streamResult);
              } else if (downloadResult && filename && fs && statusCode && statusCode >= 200 && statusCode < 300) {
                const { dirname } = await import("node:path");
                if (terminalState !== "open")
                  return;
                const dir = dirname(filename);
                if (dir && dir !== ".")
                  fs.mkdirSync(dir, { recursive: true });
                const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
                let downloadedBytes = 0;
                responseFailureBytes = () => downloadedBytes;
                const downloadStartTime = performance.now();
                let lastProgressTime = downloadStartTime;
                let transaction;
                let writeStream;
                const settleDownloadFailure = async (causeValue) => {
                  if (!beginResponseFailure())
                    return;
                  const primaryCause = errorFromUnknown(causeValue);
                  _stats.statusOnNext = "error";
                  let cleanupFailure;
                  try {
                    await cleanupResponseFailure();
                  } catch (error) {
                    cleanupFailure = errorFromUnknown(error);
                  }
                  activeDownloadFailureCleanup = undefined;
                  updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                  const error = buildDownloadError({
                    statusCode: res.statusCode || 500,
                    headers,
                    contentType,
                    contentLength: contentLength || "0",
                    cookies: cookies || [],
                    statusText: primaryCause.message || "Download failed",
                    url: res.url || url.toString(),
                    body: null,
                    finalUrl: url.toString(),
                    config,
                    request: fetchOptions
                  });
                  attachDownloadTargetFailureCause(error, primaryCause, cleanupFailure);
                  settlePromise(error);
                };
                try {
                  transaction = createDownloadTargetTransaction(filename, { operations: fs });
                  const cleanupTransaction = async () => {
                    if (writeStream)
                      res.unpipe(writeStream);
                    await transaction.cleanup();
                  };
                  responseFailureModeCleanup = cleanupTransaction;
                  activeDownloadFailureCleanup = cleanupTransaction;
                  writeStream = transaction.createWriteStream();
                } catch (error) {
                  responseFailureModeCleanup = undefined;
                  activeDownloadFailureCleanup = undefined;
                  await settleDownloadFailure(error);
                  return;
                }
                const activeTransaction = transaction;
                const activeWriteStream = writeStream;
                const downloadContentEncoding = (res.headers["content-encoding"] || "").toLowerCase();
                const downloadZstdTee = downloadContentEncoding === "zstd" && CompressionUtil.shouldDecompress(downloadContentEncoding, config) ? new ZstdFrameValidator : null;
                res.on("data", (chunk) => {
                  guardResponseWork(() => {
                    if (terminalState !== "open")
                      return;
                    downloadZstdTee?.update(chunk);
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
                });
                activeWriteStream.once("close", () => {
                  if (!activeWriteStream.writableFinished)
                    return;
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
                    if (downloadZstdTee) {
                      const verdict = downloadZstdTee.finish();
                      if (!verdict.complete) {
                        (async () => {
                          if (!beginResponseFailure())
                            return;
                          const primaryCause = new Error(verdict.fault ? `invalid zstd frame: ${verdict.fault}` : "truncated zstd frame: the encoded body ended before the frame was structurally complete");
                          _stats.statusOnNext = "error";
                          let cleanupFailure;
                          try {
                            await cleanupResponseFailure();
                          } catch (error) {
                            cleanupFailure = errorFromUnknown(error);
                          }
                          activeDownloadFailureCleanup = undefined;
                          updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                          const error = buildDecompressionError({
                            statusCode: res.statusCode || 500,
                            headers,
                            contentType,
                            contentLength: contentLength || "0",
                            cookies: cookies || [],
                            statusText: primaryCause.message,
                            url: res.url || url.toString(),
                            body: null,
                            finalUrl: url.toString(),
                            config,
                            request: fetchOptions
                          });
                          attachDownloadTargetFailureCause(error, primaryCause, cleanupFailure);
                          settlePromise(error);
                        })();
                        return;
                      }
                    }
                    contentLengthCounter = downloadedBytes;
                    updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                    const downloadResponse = buildDownloadResponse(res.statusCode ?? 200, res.statusMessage ?? "OK", headers, contentLengthCounter, cookies || [], res.url || url.toString(), url.toString(), [url.toString()], config);
                    const overdueAfterDownloadParse = totalOverdueAfterParse();
                    if (overdueAfterDownloadParse) {
                      settleDownloadFailure(overdueAfterDownloadParse);
                      return;
                    }
                    try {
                      activeTransaction.markWriterClosed();
                      activeTransaction.commit();
                    } catch (error) {
                      settleDownloadFailure(error);
                      return;
                    }
                    activeDownloadFailureCleanup = undefined;
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
                    _stats.statusOnNext = "success";
                    settlePromise(downloadResponse);
                  });
                });
                activeWriteStream.once("error", (error) => {
                  settleDownloadFailure(error);
                });
                res.pipe(activeWriteStream);
              } else if (filename && fs && statusCode && statusCode >= 200 && statusCode < 300) {
                const { dirname } = await import("node:path");
                if (terminalState !== "open")
                  return;
                const dir = dirname(filename);
                if (dir && dir !== ".")
                  fs.mkdirSync(dir, { recursive: true });
                const writeStream = fs.createWriteStream(filename);
                responseFailureModeCleanup = async () => {
                  res.unpipe(writeStream);
                  if (writeStream.closed)
                    return;
                  await new Promise((closeResolve) => {
                    writeStream.once("close", closeResolve);
                    writeStream.destroy();
                  });
                };
                writeStream.on("finish", () => {
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
                    if (!contentLength) {
                      if (fs.existsSync(filename)) {
                        contentLengthCounter = fs.statSync(filename).size;
                      }
                    }
                    updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                    const downloadResponse = buildDownloadResponse(res.statusCode ?? 200, res.statusMessage ?? "OK", headers, parseInt(contentLength || "0", 10) || contentLengthCounter, cookies || [], res.url || url.toString(), url.toString(), [url.toString()], config);
                    const overdueAfterDownloadSettle = totalOverdueAfterParse();
                    if (overdueAfterDownloadSettle) {
                      settlePromise(overdueAfterDownloadSettle);
                      return;
                    }
                    _stats.statusOnNext = "success";
                    settlePromise(downloadResponse);
                  });
                });
                writeStream.on("error", (err) => {
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
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
                    settlePromise(error);
                  });
                });
                res.pipe(writeStream);
              } else {
                if (config.encoding) {
                  res.setEncoding(config.encoding);
                }
                const decompressedStream = CompressionUtil.decompressStream(res, res.headers["content-encoding"], config);
                const responseTransform = decompressedStream === res ? undefined : decompressedStream;
                const chunks = [];
                let decompressedEnded = false;
                let decompressedNativeError = false;
                responseFailureIncludesBody = true;
                responseFailureBody = () => Buffer.concat(chunks);
                if (responseTransform !== undefined) {
                  responseFailureModeCleanup = async () => {
                    res.unpipe(responseTransform);
                    if (responseTransform.closed)
                      return;
                    await new Promise((closeResolve) => {
                      responseTransform.once("close", closeResolve);
                      responseTransform.destroy();
                    });
                  };
                }
                decompressedStream.on("data", (chunk) => {
                  guardResponseWork(() => {
                    if (terminalState !== "open")
                      return;
                    contentLengthCounter += chunk.length;
                    chunks.push(chunk);
                  });
                });
                decompressedStream.on("end", () => {
                  decompressedEnded = true;
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
                    const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
                    _stats.statusOnNext = isRedirected ? "redirect" : (recordedStatusVerdict !== undefined ? recordedStatusVerdict.accepted : statusCode === 304 && acceptNotModified && fetchOptions.validateStatus === undefined || statusCode && (fetchOptions.validateStatus === null || _validateStatus(statusCode))) ? "success" : "error";
                    updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                    const finalResponse = buildResponseFromIncoming(res, Buffer.concat(chunks), config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                    const overdueAfterParse = totalOverdueAfterParse();
                    if (overdueAfterParse) {
                      settlePromise(overdueAfterParse);
                      return;
                    }
                    if (uploadResult && !isRedirected && _stats.statusOnNext === "success") {
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
                    settlePromise(finalResponse);
                  });
                });
                decompressedStream.on("error", (err) => {
                  decompressedNativeError = true;
                  guardResponseWork(() => {
                    if (!claimTerminal("response"))
                      return;
                    _stats.statusOnNext = "error";
                    updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
                    const data = Buffer.concat(chunks);
                    if (_stats.redirectUrl) {
                      const partialResponse = buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                      const overdueAfterPartialParse = totalOverdueAfterParse();
                      if (overdueAfterPartialParse) {
                        settlePromise(overdueAfterPartialParse);
                        return;
                      }
                      settlePromise(partialResponse);
                      return;
                    }
                    if (fetchOptions.acceptPartialBody && !responseBodyEnded && data.length > 0 && statusCode && remapUserAbort(err).code !== "ABORT_ERR") {
                      const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
                      if (recordedStatusVerdict !== undefined ? recordedStatusVerdict.accepted : fetchOptions.validateStatus === null || _validateStatus(statusCode)) {
                        _stats.statusOnNext = "success";
                        const salvagedResponse = buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                        salvagedResponse.truncated = true;
                        const overdueAfterSalvageParse = totalOverdueAfterParse();
                        if (overdueAfterSalvageParse) {
                          settlePromise(overdueAfterSalvageParse);
                          return;
                        }
                        settlePromise(salvagedResponse);
                        return;
                      }
                    }
                    if (!err.code && !responseBodyEnded)
                      err.code = "ERR_STREAM_PREMATURE_CLOSE";
                    const isNetworkError = err.code && ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ERR_STREAM_PREMATURE_CLOSE"].includes(err.code);
                    if (isNetworkError) {
                      const partialResponse = buildResponseFromIncoming(res, data, config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                      const settleCause = remapUserAbort(err);
                      const error = RezoError.fromError(settleCause, config, fetchOptions, partialResponse);
                      settlePromise(error);
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
                      settlePromise(error);
                    }
                  });
                });
              }
            })().catch((error) => {
              settleResponseFailure(error, "callback");
            });
          });
          const settleTimeout = (phase, elapsed) => {
            if (!claimTerminal("timeout"))
              return;
            _stats.statusOnNext = "error";
            const error = createStagedTimeoutError(phase, elapsed, config, fetchOptions);
            const finalizedPendingRequest = !req.socket && finalizePendingAgentRequest(req, error);
            notifyTimeoutHooks(config, phase, elapsed, url.toString());
            settleErrorAfterDownloadCleanup(error, (_effectiveCause, cleanupFailure) => {
              if (cleanupFailure) {
                attachDownloadTargetFailureCause(error, error, cleanupFailure);
              }
              return error;
            });
            if (!finalizedPendingRequest)
              req.destroy(error);
            destroyPendingProxyHandshake(req, error);
          };
          timeoutManager.setTimeoutCallback((phase, elapsed) => settleTimeout(phase, elapsed));
          settleOverdueBudget = () => {
            if (terminalState !== "open")
              return true;
            const phase = timeoutManager.overduePhase();
            const totalOverdue = totalDeadline !== undefined && totalDeadline.elapsed() >= totalDeadline.totalMs;
            if (!phase && !totalOverdue)
              return false;
            const totalDueAt = totalOverdue ? Date.now() - (totalDeadline.elapsed() - totalDeadline.totalMs) : Number.POSITIVE_INFINITY;
            if (phase && phase.dueAt <= totalDueAt)
              settleTimeout(phase.phase, phase.elapsed);
            else
              settleTimeout("total", totalDeadline.elapsed());
            return true;
          };
          const requestUsesProxy = Boolean(fetchOptions.proxy ?? config.proxy);
          if (requestUsesProxy && !req.socket && timeoutManager.hasPhase("connect")) {
            timeoutManager.startPhase("connect");
          }
          if (requestAbortSignal) {
            const onRequestAbort = () => {
              if (!claimTerminal("transport"))
                return;
              _stats.statusOnNext = "error";
              updateTiming(config, timing, "", 0);
              const aborted = new Error("The operation was aborted");
              aborted.code = "ABORT_ERR";
              aborted.name = "AbortError";
              settleErrorAfterDownloadCleanup(aborted, (effectiveCause) => buildSmartError(config, fetchOptions, effectiveCause));
              req.destroy(aborted);
              destroyPendingProxyHandshake(req, aborted);
            };
            requestAbortSignal.addEventListener("abort", onRequestAbort, { once: true });
            detachRequestAbort = () => requestAbortSignal.removeEventListener("abort", onRequestAbort);
          }
          if (totalDeadline) {
            const onTotalDeadline = () => settleTimeout("total", totalDeadline.elapsed());
            totalDeadline.signal.addEventListener("abort", onTotalDeadline, { once: true });
            detachTotalDeadline = () => totalDeadline.signal.removeEventListener("abort", onTotalDeadline);
            if (totalDeadline.expired())
              onTotalDeadline();
          }
          const settleTransportError = (err) => {
            if (!claimTerminal("transport"))
              return;
            _stats.statusOnNext = "error";
            updateTiming(config, timing, "", 0);
            err = remapUserAbort(err);
            const errCode = err.code;
            if (errCode === "ABORT_ERR" || err.name === "AbortError" || errCode === "ECONNABORTED") {
              notifyAbortHooksOnce(config, fetchOptions, _stats, timing.startTime, errCode === "ECONNABORTED" ? "timeout" : "signal", err.message);
            }
            settleErrorAfterDownloadCleanup(err, (effectiveCause) => {
              const error = buildSmartError(config, fetchOptions, effectiveCause);
              if (err?.code === "ECONNRESET" && connectionWasReused && !responseReceived) {
                error.isStaleSocketReset = true;
              }
              return error;
            });
          };
          req.on("error", settleTransportError);
          req.on("close", () => {
            if (terminalState !== "open" || responseReceived)
              return;
            const hangUp = new Error("socket hang up");
            hangUp.code = "ECONNRESET";
            settleTransportError(hangUp);
          });
          req.on("socket", (socket) => {
            if (terminalState !== "open" || req.destroyed)
              return;
            const reqContext = beginRequestContext(socket, isSecure);
            const telemetry = getSocketTelemetry(socket);
            connectionWasReused = reqContext.connectionReused;
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
          let bodyPiped = false;
          if (body) {
            if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
              req.write(body.toString());
            } else if (body instanceof FormData || body instanceof RezoFormData) {
              const multipart = await encodeMultipartBody(body);
              if (terminalState !== "open")
                return;
              const buffer = multipart.bytes;
              if (!req.hasHeader("Content-Type"))
                req.setHeader("Content-Type", multipart.contentType);
              req.setHeader("Content-Length", buffer.length);
              if (uploadResult) {
                const chunkSize = 16384;
                const totalSize = buffer.length;
                let written = 0;
                const uploadStart = performance.now();
                for (let offset = 0;offset < totalSize; offset += chunkSize) {
                  if (terminalState !== "open")
                    return;
                  const end = Math.min(offset + chunkSize, totalSize);
                  const chunk = buffer.subarray(offset, end);
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
            } else {
              const bytes = requestBodyBytes(body);
              const stream = bytes ? undefined : nodeRequestBodyStream(transportBody);
              if (bytes)
                req.write(bytes);
              else if (stream) {
                bodyPiped = true;
                pipeRequestBody(stream, req);
              } else
                req.write(typeof body === "object" ? JSON.stringify(body) : body);
            }
          }
          if (!bodyPiped) {
            if (terminalState !== "open")
              return;
            req.end();
          }
        } catch (error) {
          if (!claimTerminal("transport"))
            return;
          _stats.statusOnNext = "error";
          updateTiming(config, timing, "", 0);
          const e = buildSmartError(config, fetchOptions, error);
          settlePromise(e);
          return;
        }
      } catch (error) {
        const rezoError = buildSmartError(config, fetchOptions, error);
        settlePromise(rezoError);
      }
    })().catch((error) => {
      if (promiseSettled)
        return;
      settlePromise(buildSmartError(config, fetchOptions, errorFromUnknown(error)));
    });
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
function parseLookupArguments(optionsOrCallback, callbackOrUndefined) {
  if (typeof optionsOrCallback === "function") {
    return { options: {}, callback: optionsOrCallback };
  }
  if (typeof optionsOrCallback === "number") {
    return { options: { family: optionsOrCallback }, callback: callbackOrUndefined };
  }
  return { options: optionsOrCallback || {}, callback: callbackOrUndefined };
}
function requestedFamily(options) {
  return options.family === 4 || options.family === 6 ? options.family : undefined;
}
function createInvalidResolverOutputError(detail) {
  const error = new Error(`Custom dnsLookup returned an invalid result: ${detail}`);
  error.code = "ERR_INVALID_ARG_TYPE";
  error.errno = -1008;
  return error;
}
function normalizeResolvedAddress(address, family) {
  const version = typeof address === "string" ? isIP(address) : 0;
  if (version !== 4 && version !== 6) {
    return createInvalidResolverOutputError(`${String(address)} is not an IP address`);
  }
  if (family === undefined || family === null || family === 0) {
    return { address, family: version };
  }
  if (family !== version) {
    return createInvalidResolverOutputError(`family ${String(family)} does not match ${address}`);
  }
  return { address, family: version };
}
function createPublicLookupBridge(publicLookup) {
  return (hostname, optionsOrCallback, callbackOrUndefined) => {
    const { options, callback } = parseLookupArguments(optionsOrCallback, callbackOrUndefined);
    const { all: wantsAll, ...scalarOptions } = options;
    publicLookup(hostname, { ...scalarOptions, all: false }, (error, address, family) => {
      if (error) {
        callback(error);
        return;
      }
      const resolved = normalizeResolvedAddress(address, family);
      if (resolved instanceof Error) {
        callback(resolved);
        return;
      }
      if (wantsAll === true) {
        callback(null, [resolved]);
        return;
      }
      callback(null, resolved.address, resolved.family);
    });
  };
}
function createDNSLookup(cache) {
  return (hostname, optionsOrCallback, callbackOrUndefined) => {
    const { options, callback } = parseLookupArguments(optionsOrCallback, callbackOrUndefined);
    const family = requestedFamily(options);
    const resolveNatively = () => {
      dns.lookup(hostname, options, callback);
    };
    if (options.all === true) {
      cache.lookupAll(hostname, family).then((entries) => {
        if (entries.length > 0) {
          callback(null, entries.map((entry) => ({ address: entry.address, family: entry.family })));
          return;
        }
        resolveNatively();
      }).catch(resolveNatively);
      return;
    }
    cache.lookup(hostname, family).then((result) => {
      if (result) {
        callback(null, result.address, result.family);
        return;
      }
      resolveNatively();
    }).catch(resolveNatively);
  };
}
function buildHTTPOptions(fetchOptions, isSecure, url) {
  const {
    method,
    headers,
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
  if (stealthProfile && (httpAgent || httpsAgent)) {
    throw new RezoError(`Stealth profile "${stealthProfile.profileId}" cannot ride a custom agent's TLS: remove httpAgent/httpsAgent or disable stealth for this request`, fetchOptions, "REZ_UNSUPPORTED_CAPABILITY");
  }
  const servername = isIP(url.hostname) ? undefined : url.hostname;
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
      servername,
      rejectUnauthorized,
      keepAlive,
      keepAliveMsecs: keepAlive ? keepAliveMsecs : undefined
    });
  } else if (keepAlive === false) {
    agent = isSecure ? new https.Agent({
      keepAlive: false,
      ...useSecureContext ? { secureContext: createSecureContext() } : {},
      servername,
      rejectUnauthorized
    }) : new http.Agent({ keepAlive: false });
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
        servername
      });
    } else {
      agent = agentPool.getHttpAgent();
    }
  } else if (isSecure && useSecureContext) {
    agent = new https.Agent({
      secureContext: createSecureContext(),
      servername,
      rejectUnauthorized,
      keepAlive,
      keepAliveMsecs: keepAlive ? keepAliveMsecs : undefined
    });
  }
  let lookup;
  const requestLocalDnsCache = fetchOptions._dnsCache;
  if (proxy) {
    lookup = undefined;
  } else if (fetchOptions.dnsLookup) {
    lookup = createPublicLookupBridge(fetchOptions.dnsLookup);
  } else if (dnsCacheOption !== false) {
    const cacheOptions = typeof dnsCacheOption === "object" ? {
      enable: true,
      ttl: dnsCacheOption.ttl,
      maxEntries: dnsCacheOption.maxEntries
    } : { enable: true };
    lookup = createDNSLookup(requestLocalDnsCache ?? getGlobalDNSCache(cacheOptions));
  }
  if (stealthProfile) {
    if (!headers.has("host"))
      headers.set("host", url.host);
    if (!headers.has("connection"))
      headers.set("connection", keepAlive ? "keep-alive" : "close");
    for (const [name, value] of Object.entries(stealthProfile.extraHeaders.h1 ?? {})) {
      if (!headers.has(name))
        headers.set(name, value);
    }
  }
  const headerObj = stealthProfile ? headers.toOrderedObject(stealthProfile.headerOrder) : headers.toObject();
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isSecure ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: headerObj,
    timeout: 0,
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
    if (typeof config.retryAttempts !== "number")
      config.retryAttempts = 0;
    if (!Array.isArray(config.errors))
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
    } else if (requestBodyBytes(fetchOptions.body)) {
      requestBodySize = requestBodyBytes(fetchOptions.body).byteLength;
    } else if (isBlobBody(fetchOptions.body)) {
      requestBodySize = fetchOptions.body.size;
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
    const cookieHeaderArray = Array.isArray(cookies) ? cookies : [cookies];
    const pairs = [];
    for (const raw of cookieHeaderArray) {
      const singleJar = new RezoCookieJar;
      try {
        singleJar.setCookiesSync([raw], url);
        const parsed = singleJar.cookies().array[0];
        if (parsed)
          pairs.push({ raw, cookie: parsed });
      } catch {}
    }
    const acceptedCookies = [];
    const acceptedRaw = [];
    let hookError = null;
    if (config.hooks?.beforeCookie && config.hooks.beforeCookie.length > 0) {
      for (const { raw, cookie } of pairs) {
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
          acceptedRaw.push(raw);
        }
      }
    } else {
      for (const { raw, cookie } of pairs) {
        acceptedCookies.push(cookie);
        acceptedRaw.push(raw);
      }
    }
    const jarToUpdate = rootJar || config.jar;
    if (!config.disableJar && jarToUpdate) {
      jarToUpdate.setCookiesSync(acceptedRaw, url);
    }
    jar.setCookiesSync(acceptedRaw, url);
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
      config.responseCookies = new RezoCookieJar().parseResponseCookies(existingArray);
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