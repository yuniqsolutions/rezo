import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse } from '../responses/buildError.js';
import { Cookie } from '../cookies/cookie-jar.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { RezoPerformance } from '../utils/tools.js';
import { ResponseCache } from '../cache/universal-response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
const Environment = {
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  hasXHR: typeof XMLHttpRequest !== "undefined",
  hasFormData: typeof FormData !== "undefined",
  hasBlob: typeof Blob !== "undefined"
};
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
function sanitizeConfig(config) {
  const sanitized = { ...config };
  delete sanitized.data;
  return sanitized;
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
function getCookiesFromDocument(url) {
  const cookies = {
    array: [],
    serialized: [],
    netscape: "",
    string: "",
    setCookiesString: []
  };
  if (typeof document === "undefined" || !document.cookie) {
    return cookies;
  }
  const cookieString = document.cookie;
  const pairs = cookieString.split(";");
  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split("=");
    const value = valueParts.join("=");
    if (name && value !== undefined) {
      const hostname = new URL(url).hostname;
      const cookie = new Cookie({
        key: name.trim(),
        value: value.trim(),
        domain: hostname,
        path: "/"
      });
      cookies.array.push(cookie);
    }
  }
  cookies.string = cookies.array.map((c) => `${c.key}=${c.value}`).join("; ");
  cookies.serialized = cookies.array.map((c) => c.toJSON());
  cookies.netscape = cookies.array.map((c) => c.toNetscapeFormat()).join(`
`);
  return cookies;
}
function prepareXHRBody(body) {
  if (!body)
    return null;
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return body.toString();
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return body;
  }
  if (body instanceof RezoFormData) {
    const buffer = body.getBuffer();
    if (buffer) {
      return new Blob([new Uint8Array(buffer)], { type: `multipart/form-data; boundary=${body.getBoundary()}` });
    }
    return null;
  }
  if (typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    return JSON.stringify(body);
  }
  return body;
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
  if (!Environment.hasXHR) {
    throw new Error("XMLHttpRequest is not available in this environment");
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
    streamResponse = new StreamResponse;
  } else if (isDownload) {
    const fileName = options.fileName || options.saveTo || "";
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    downloadResponse = new DownloadResponse(fileName, url);
  } else if (isUpload) {
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    uploadResponse = new UploadResponse(url);
  }
  const res = executeXHRRequest(fetchOptions, mainConfig, options, perform, streamResponse, downloadResponse, uploadResponse);
  if (streamResponse) {
    return streamResponse;
  } else if (downloadResponse) {
    return downloadResponse;
  } else if (uploadResponse) {
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
async function executeXHRRequest(fetchOptions, config, options, perform, streamResult, downloadResult, uploadResult) {
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const startTime = performance.now();
  const timing = {
    startTime
  };
  config.timing.startTime = startTime;
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  let totalAttempts = 0;
  config.setSignal();
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
      const response = await executeSingleXHRRequest(config, fetchOptions, timing, streamResult, downloadResult, uploadResult);
      if (response instanceof RezoError) {
        const errorStatus = response.status || 0;
        if (shouldWaitOnStatus(errorStatus, options.waitOnStatus)) {
          const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
          const waitResult = await handleRateLimitWait({
            status: errorStatus,
            headers: response.response?.headers || new RezoHeaders,
            data: response.response?.data,
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
function executeSingleXHRRequest(config, fetchOptions, timing, streamResult, downloadResult, uploadResult) {
  return new Promise((resolve) => {
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
      xhr.open(fetchOptions.method.toUpperCase(), url, true);
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
        xhr.responseType = "json";
      } else {
        xhr.responseType = "text";
      }
      if (config.timeout) {
        xhr.timeout = config.timeout;
      }
      xhr.withCredentials = config.withCredentials === true;
      const eventEmitter = streamResult || downloadResult || uploadResult;
      if (eventEmitter) {
        const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
        const startEvent = {
          url,
          method: fetchOptions.method.toUpperCase(),
          headers: new RezoHeaders(reqHeaders),
          timestamp: timing.startTime,
          timeout: fetchOptions.timeout,
          maxRedirects: config.maxRedirects
        };
        eventEmitter.emit("start", startEvent);
      }
      if (config.signal) {
        config.signal.addEventListener("abort", () => {
          xhr.abort();
        });
      }
      const downloadStartTime = performance.now();
      let lastDownloadBytes = 0;
      let lastDownloadTime = downloadStartTime;
      xhr.onprogress = (event) => {
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        if (eventEmitter) {
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
          eventEmitter.emit("progress", progressEvent);
        }
      };
      if (xhr.upload && uploadResult) {
        const uploadStartTime = performance.now();
        let lastUploadBytes = 0;
        let lastUploadTime = uploadStartTime;
        xhr.upload.onprogress = (event) => {
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
          uploadResult.emit("progress", progressEvent);
        };
      }
      xhr.onload = () => {
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const status = xhr.status;
        const statusText = xhr.statusText;
        const responseHeaders = parseXHRHeaders(xhr);
        const contentType = xhr.getResponseHeader("content-type") || "";
        const contentLength = xhr.getResponseHeader("content-length");
        const cookies = getCookiesFromDocument(url);
        config.responseCookies = cookies;
        if (eventEmitter) {
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
        let responseData;
        let bodySize = 0;
        if (xhr.responseType === "blob") {
          responseData = xhr.response;
          bodySize = xhr.response?.size || 0;
        } else if (xhr.responseType === "arraybuffer") {
          responseData = xhr.response;
          bodySize = xhr.response?.byteLength || 0;
        } else if (xhr.responseType === "json") {
          responseData = xhr.response;
          bodySize = JSON.stringify(xhr.response || "").length;
        } else {
          const text = xhr.responseText || "";
          bodySize = text.length;
          if (responseType === "auto" && contentType.includes("application/json")) {
            try {
              responseData = JSON.parse(text);
            } catch {
              responseData = text;
            }
          } else if (responseType === "json") {
            try {
              responseData = JSON.parse(text);
            } catch {
              responseData = text;
            }
          } else {
            responseData = text;
          }
        }
        updateTiming(config, timing, bodySize);
        const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
        if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
          const error = builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
            status,
            statusText,
            headers: responseHeaders,
            data: responseData
          }, config, fetchOptions);
          if (eventEmitter) {
            eventEmitter.emit("error", error);
          }
          resolve(error);
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
        debugLog.complete(config, xhr.responseURL || url);
        const finalResponse = {
          data: responseData,
          status,
          statusText,
          headers: responseHeaders,
          cookies,
          config,
          contentType,
          contentLength: bodySize,
          finalUrl: xhr.responseURL || url,
          urls: buildUrlTree(config, xhr.responseURL || url)
        };
        if (streamResult) {
          const streamFinishEvent = {
            status,
            statusText,
            headers: responseHeaders,
            contentType,
            contentLength: bodySize,
            finalUrl: xhr.responseURL || url,
            cookies,
            urls: buildUrlTree(config, xhr.responseURL || url),
            timing: getTimingDurations(config),
            config: sanitizeConfig(config)
          };
          streamResult.emit("finish", streamFinishEvent);
          streamResult.emit("done", streamFinishEvent);
          streamResult.emit("complete", streamFinishEvent);
          streamResult._markFinished();
        }
        if (downloadResult) {
          const downloadFinishEvent = {
            status,
            statusText,
            headers: responseHeaders,
            contentType,
            contentLength: bodySize,
            finalUrl: xhr.responseURL || url,
            cookies,
            urls: buildUrlTree(config, xhr.responseURL || url),
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
            finalUrl: xhr.responseURL || url,
            cookies,
            urls: buildUrlTree(config, xhr.responseURL || url),
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
        resolve(finalResponse);
      };
      xhr.onerror = () => {
        const error = buildSmartError(config, fetchOptions, new Error("Network error"));
        if (eventEmitter) {
          eventEmitter.emit("error", error);
        }
        resolve(error);
      };
      xhr.ontimeout = () => {
        const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${config.timeout}ms`));
        if (eventEmitter) {
          eventEmitter.emit("error", error);
        }
        resolve(error);
      };
      xhr.onabort = () => {
        const error = buildSmartError(config, fetchOptions, new Error("Request aborted"));
        if (eventEmitter) {
          eventEmitter.emit("error", error);
        }
        resolve(error);
      };
      const preparedBody = prepareXHRBody(body);
      xhr.send(preparedBody);
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

export { Environment };
