import { URL } from "node:url";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse, buildDownloadError } from '../responses/buildError.js';
import { Cookie } from '../utils/cookies.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { isSameDomain, RezoPerformance } from '../utils/tools.js';
import { ResponseCache } from '../cache/response-cache.js';
const Environment = {
  isNode: typeof process !== "undefined" && process.versions?.node,
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  isWebWorker: typeof self !== "undefined" && typeof self.WorkerGlobalScope !== "undefined",
  isDeno: typeof globalThis.Deno !== "undefined",
  isBun: typeof globalThis.Bun !== "undefined",
  isEdgeRuntime: typeof globalThis.EdgeRuntime !== "undefined" || typeof globalThis.caches !== "undefined",
  get hasFetch() {
    return typeof fetch !== "undefined";
  },
  get hasReadableStream() {
    return typeof ReadableStream !== "undefined";
  },
  get hasAbortController() {
    return typeof AbortController !== "undefined";
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
  if (finalUrl && (urls.length === 0 || urls[0] !== finalUrl)) {
    urls.push(finalUrl);
  }
  return urls.length > 0 ? urls : [finalUrl];
}
function sanitizeConfig(config) {
  const sanitized = { ...config };
  delete sanitized.data;
  return sanitized;
}
function parseCookiesFromHeaders(headers, url) {
  const cookies = {
    array: [],
    serialized: [],
    netscape: "",
    string: "",
    setCookiesString: []
  };
  const setCookieHeaders = headers.getSetCookie?.() || [];
  for (const cookieStr of setCookieHeaders) {
    cookies.setCookiesString.push(cookieStr);
    const parts = cookieStr.split(";");
    const [nameValue] = parts;
    const [name, ...valueParts] = nameValue.split("=");
    const value = valueParts.join("=");
    if (name && value !== undefined) {
      const cookie = new Cookie({
        key: name.trim(),
        value: value.trim(),
        domain: new URL(url).hostname,
        path: "/",
        httpOnly: cookieStr.toLowerCase().includes("httponly"),
        secure: cookieStr.toLowerCase().includes("secure"),
        sameSite: "lax"
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
export async function executeRequest(options, defaultOptions, jar) {
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
    streamResponse = new StreamResponse;
  } else if (isDownload) {
    const fileName = options.fileName || options.saveTo || "";
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    downloadResponse = new DownloadResponse(fileName, url);
  } else if (isUpload) {
    const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    uploadResponse = new UploadResponse(url);
  }
  const res = executeFetchRequest(fetchOptions, mainConfig, options, perform, streamResponse, downloadResponse, uploadResponse);
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
async function executeFetchRequest(fetchOptions, config, options, perform, streamResult, downloadResult, uploadResult) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let retries = 0;
  const retryDelay = config?.retry?.retryDelay || 0;
  const maxRetries = config?.retry?.maxRetries || 0;
  const incrementDelay = config?.retry?.incrementDelay || false;
  const statusCodes = config?.retry?.statusCodes;
  const timing = {
    startTime: performance.now(),
    startTimestamp: Date.now()
  };
  const ABSOLUTE_MAX_ATTEMPTS = 50;
  const visitedUrls = new Set;
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
      const response = await executeSingleFetchRequest(config, fetchOptions, requestCount, timing, _stats, streamResult, downloadResult, uploadResult);
      const statusOnNext = _stats.statusOnNext;
      if (response instanceof RezoError) {
        config.errors.push({
          attempt: config.retryAttempts + 1,
          error: response,
          duration: perform.now()
        });
        perform.reset();
        if (!config.retry) {
          throw response;
        }
        if (config.retry) {
          if (config.retry.condition) {
            const isPassed = await config.retry.condition(response);
            if (typeof isPassed === "boolean" && isPassed === false) {
              throw response;
            }
          } else {
            if (statusCodes && !statusCodes.includes(response.status || 0)) {
              throw response;
            }
            if (maxRetries <= retries) {
              throw response;
            }
            retries++;
            if (retryDelay > 0) {
              await new Promise((resolve) => setTimeout(resolve, incrementDelay ? retryDelay * retries : retryDelay));
            }
          }
          config.retryAttempts++;
        }
        continue;
      }
      if (statusOnNext === "success") {
        return response;
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
        const onRedirect = config.beforeRedirect ? config.beforeRedirect({
          url: new URL(location),
          status: response.status,
          headers: response.headers,
          sameDomain: isSameDomain(fetchOptions.fullUrl, location),
          method: fetchOptions.method.toUpperCase()
        }) : undefined;
        if (typeof onRedirect !== "undefined") {
          if (typeof onRedirect === "boolean" && !onRedirect) {
            throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
          } else if (typeof onRedirect === "object" && !onRedirect.redirect) {
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
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          if (config.treat302As303 !== false || response.status === 303) {
            options.method = "GET";
            delete options.body;
          }
        }
        fetchOptions.fullUrl = location;
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
      config.timing.startTimestamp = timing.startTimestamp;
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
      });
    }
    const preparedBody = await prepareFetchBody(body);
    const fetchInit = {
      method: fetchOptions.method.toUpperCase(),
      headers,
      body: preparedBody,
      signal: abortController.signal,
      redirect: "manual",
      credentials: config.enableCookieJar ? "include" : "same-origin"
    };
    let response;
    try {
      response = await fetch(url.toString(), fetchInit);
    } catch (err) {
      if (timeoutId)
        clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${config.timeout}ms`));
        _stats.statusOnNext = "error";
        return error;
      }
      throw err;
    } finally {
      if (timeoutId)
        clearTimeout(timeoutId);
    }
    if (!config.timing.ttfbMs) {
      timing.firstByteTime = performance.now();
      config.timing.ttfbMs = timing.firstByteTime - timing.startTime;
    }
    const status = response.status;
    const statusText = response.statusText;
    const responseHeaders = fromFetchHeaders(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");
    const cookies = parseCookiesFromHeaders(response.headers, url.href);
    config.responseCookies = cookies;
    const location = response.headers.get("location");
    const isRedirect = status >= 300 && status < 400 && location;
    if (isRedirect) {
      _stats.statusOnNext = "redirect";
      _stats.redirectUrl = new URL(location, url).href;
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
          firstByte: config.timing.ttfbMs,
          total: performance.now() - timing.startTime
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
    if (streamResult && response.body) {
      handleStreamingResponse(response, config, timing, streamResult, url, status, statusText, responseHeaders, cookies);
      return {};
    }
    let responseData;
    let bodyBuffer;
    const responseType = config.responseType || fetchOptions.responseType || "auto";
    if (responseType === "buffer" || responseType === "arrayBuffer") {
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
    config.timing.endTimestamp = Date.now();
    config.timing.durationMs = performance.now() - timing.startTime;
    config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : config.timing.durationMs;
    const bodySize = bodyBuffer?.byteLength || (typeof responseData === "string" ? responseData.length : 0);
    config.transfer.bodySize = bodySize;
    config.transfer.responseSize = bodySize;
    if (status >= 400) {
      const error = builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
        status,
        statusText,
        headers: responseHeaders,
        data: responseData
      }, config, fetchOptions);
      _stats.statusOnNext = "error";
      return error;
    }
    _stats.statusOnNext = "success";
    const finalResponse = {
      data: responseData,
      status,
      statusText,
      headers: responseHeaders,
      cookies,
      config,
      contentType,
      contentLength: bodySize,
      finalUrl: url.href,
      urls: buildUrlTree(config, url.href)
    };
    if (downloadResult && config.fileName && Environment.isNode) {
      try {
        const fs = await import("node:fs");
        const buffer = bodyBuffer ? Buffer.from(bodyBuffer) : Buffer.from(responseData);
        fs.writeFileSync(config.fileName, buffer);
        const downloadFinishEvent = {
          status,
          statusText,
          headers: responseHeaders,
          contentType,
          contentLength: buffer.length,
          finalUrl: url.href,
          cookies,
          urls: buildUrlTree(config, url.href),
          fileName: config.fileName,
          fileSize: buffer.length,
          timing: {
            total: config.timing.durationMs || 0,
            dns: config.timing.dnsMs,
            tcp: config.timing.tcpMs,
            tls: config.timing.tlsMs,
            firstByte: config.timing.ttfbMs,
            download: config.timing.transferMs || 0
          },
          averageSpeed: config.timing.transferMs ? buffer.length / config.timing.transferMs * 1000 : 0,
          config: sanitizeConfig(config)
        };
        downloadResult.emit("finish", downloadFinishEvent);
        downloadResult.emit("done", downloadFinishEvent);
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
        cookies,
        urls: buildUrlTree(config, url.href),
        uploadSize: config.transfer.requestSize || 0,
        timing: {
          total: config.timing.durationMs || 0,
          dns: config.timing.dnsMs,
          tcp: config.timing.tcpMs,
          tls: config.timing.tlsMs,
          upload: config.timing.transferMs || 0,
          waiting: config.timing.ttfbMs || 0,
          download: config.timing.transferMs
        },
        averageUploadSpeed: config.timing.transferMs ? (config.transfer.requestSize || 0) / config.timing.transferMs * 1000 : 0,
        averageDownloadSpeed: config.timing.transferMs ? bodySize / config.timing.transferMs * 1000 : 0,
        config: sanitizeConfig(config)
      };
      uploadResult.emit("finish", uploadFinishEvent);
      uploadResult.emit("done", uploadFinishEvent);
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
    config.timing.endTimestamp = Date.now();
    config.timing.durationMs = performance.now() - timing.startTime;
    config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : config.timing.durationMs;
    config.transfer.bodySize = bytesReceived;
    config.transfer.responseSize = bytesReceived;
    const streamFinishEvent = {
      status,
      statusText,
      headers,
      contentType: response.headers.get("content-type") || undefined,
      contentLength: bytesReceived,
      finalUrl: url.href,
      cookies,
      urls: buildUrlTree(config, url.href),
      timing: {
        total: config.timing.durationMs || 0,
        dns: config.timing.dnsMs,
        tcp: config.timing.tcpMs,
        tls: config.timing.tlsMs,
        firstByte: config.timing.ttfbMs,
        download: config.timing.transferMs
      },
      config: sanitizeConfig(config)
    };
    streamResult.emit("finish", streamFinishEvent);
    streamResult.emit("done", streamFinishEvent);
    streamResult.emit("end");
    streamResult._markFinished();
  } catch (err) {
    streamResult.emit("error", buildSmartError(config, {}, err));
  }
}

export { Environment };
