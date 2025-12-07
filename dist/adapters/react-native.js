import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse } from '../responses/buildError.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { RezoPerformance } from '../utils/tools.js';
import { ResponseCache } from '../cache/response-cache.js';
const Environment = {
  isReactNative: typeof navigator !== "undefined" && navigator.product === "ReactNative",
  isExpo: typeof globalThis.expo !== "undefined",
  hasFetch: typeof fetch !== "undefined",
  hasBlob: typeof Blob !== "undefined",
  hasFormData: typeof FormData !== "undefined",
  hasAbortController: typeof AbortController !== "undefined"
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
export async function executeRequest(options, defaultOptions, jar) {
  if (!Environment.hasFetch) {
    throw new Error("Fetch API is not available in this React Native environment");
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
      const response = await executeSingleRequest(config, fetchOptions, timing, streamResult, downloadResult, uploadResult);
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
async function executeSingleRequest(config, fetchOptions, timing, streamResult, downloadResult, uploadResult) {
  try {
    const { fullUrl, body } = fetchOptions;
    const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
    const isSecure = url.startsWith("https:");
    config.adapterUsed = "react-native";
    config.isSecure = isSecure;
    config.finalUrl = url;
    config.network.protocol = isSecure ? "https" : "http";
    config.timing.startTimestamp = timing.startTimestamp;
    const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
    const headers = toFetchHeaders(reqHeaders);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter) {
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
    const preparedBody = await prepareBody(body);
    const fetchInit = {
      method: fetchOptions.method.toUpperCase(),
      headers,
      body: preparedBody,
      signal: abortController.signal
    };
    let response;
    try {
      response = await fetch(url, fetchInit);
    } catch (err) {
      if (timeoutId)
        clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${config.timeout}ms`));
        if (eventEmitter)
          eventEmitter.emit("error", error);
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
    const cookies = {
      array: [],
      serialized: [],
      netscape: "",
      string: "",
      setCookiesString: []
    };
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
    let responseData;
    let bodySize = 0;
    const responseType = config.responseType || fetchOptions.responseType || "auto";
    if (responseType === "blob") {
      const blob = await response.blob();
      responseData = blob;
      bodySize = blob.size;
    } else if (responseType === "arrayBuffer" || responseType === "buffer") {
      const buffer = await response.arrayBuffer();
      responseData = buffer;
      bodySize = buffer.byteLength;
    } else if (responseType === "text") {
      const text = await response.text();
      responseData = text;
      bodySize = text.length;
    } else if (responseType === "json") {
      try {
        responseData = await response.json();
        bodySize = JSON.stringify(responseData || "").length;
      } catch {
        const text = await response.text();
        responseData = text;
        bodySize = text.length;
      }
    } else {
      if (contentType.includes("application/json")) {
        try {
          responseData = await response.json();
          bodySize = JSON.stringify(responseData || "").length;
        } catch {
          const text = await response.text();
          responseData = text;
          bodySize = text.length;
        }
      } else {
        const text = await response.text();
        responseData = text;
        bodySize = text.length;
      }
    }
    config.timing.endTimestamp = Date.now();
    config.timing.durationMs = performance.now() - timing.startTime;
    config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : config.timing.durationMs;
    config.transfer.bodySize = bodySize;
    config.transfer.responseSize = bodySize;
    if (status >= 400) {
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
    const finalResponse = {
      data: responseData,
      status,
      statusText,
      headers: responseHeaders,
      cookies,
      config,
      contentType,
      contentLength: bodySize,
      finalUrl: url,
      urls: buildUrlTree(config, url)
    };
    if (streamResult) {
      const streamFinishEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: bodySize,
        finalUrl: url,
        cookies,
        urls: buildUrlTree(config, url),
        timing: {
          total: config.timing.durationMs || 0,
          firstByte: config.timing.ttfbMs,
          download: config.timing.transferMs
        },
        config: sanitizeConfig(config)
      };
      streamResult.emit("finish", streamFinishEvent);
      streamResult.emit("done", streamFinishEvent);
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
        finalUrl: url,
        cookies,
        urls: buildUrlTree(config, url),
        fileName: config.fileName || "",
        fileSize: bodySize,
        timing: {
          total: config.timing.durationMs || 0,
          firstByte: config.timing.ttfbMs,
          download: config.timing.transferMs || 0
        },
        averageSpeed: config.timing.transferMs ? bodySize / config.timing.transferMs * 1000 : 0,
        config: sanitizeConfig(config)
      };
      downloadResult.emit("finish", downloadFinishEvent);
      downloadResult.emit("done", downloadFinishEvent);
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
        finalUrl: url,
        cookies,
        urls: buildUrlTree(config, url),
        uploadSize: config.transfer.requestSize || 0,
        timing: {
          total: config.timing.durationMs || 0,
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
    const rezoError = buildSmartError(config, fetchOptions, error);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter) {
      eventEmitter.emit("error", rezoError);
    }
    return rezoError;
  }
}

export { Environment };
