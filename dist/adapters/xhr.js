import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse } from '../responses/buildError.js';
import { Cookie } from '../utils/cookies.js';
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
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  hasXHR: typeof XMLHttpRequest !== "undefined",
  hasFormData: typeof FormData !== "undefined",
  hasBlob: typeof Blob !== "undefined"
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
      const response = await executeSingleXHRRequest(config, fetchOptions, timing, streamResult, downloadResult, uploadResult);
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
      config.timing.startTimestamp = timing.startTimestamp;
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
      if (config.enableCookieJar) {
        xhr.withCredentials = true;
      }
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
      xhr.onprogress = (event) => {
        if (!config.timing.ttfbMs) {
          timing.firstByteTime = performance.now();
          config.timing.ttfbMs = timing.firstByteTime - timing.startTime;
        }
        if (eventEmitter) {
          const progressEvent = {
            loaded: event.loaded,
            total: event.total || 0,
            percentage: event.total ? Math.round(event.loaded / event.total * 100) : 0,
            speed: 0,
            averageSpeed: 0,
            estimatedTime: 0,
            timestamp: Date.now()
          };
          eventEmitter.emit("progress", progressEvent);
          eventEmitter.emit("download-progress", progressEvent);
        }
      };
      if (xhr.upload && uploadResult) {
        xhr.upload.onprogress = (event) => {
          const progressEvent = {
            loaded: event.loaded,
            total: event.total || 0,
            percentage: event.total ? Math.round(event.loaded / event.total * 100) : 0,
            speed: 0,
            averageSpeed: 0,
            estimatedTime: 0,
            timestamp: Date.now()
          };
          uploadResult.emit("progress", progressEvent);
          uploadResult.emit("upload-progress", progressEvent);
        };
      }
      xhr.onload = () => {
        if (!config.timing.ttfbMs) {
          timing.firstByteTime = performance.now();
          config.timing.ttfbMs = timing.firstByteTime - timing.startTime;
        }
        config.timing.endTimestamp = Date.now();
        config.timing.durationMs = performance.now() - timing.startTime;
        config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : config.timing.durationMs;
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
        config.transfer.bodySize = bodySize;
        config.transfer.responseSize = bodySize;
        if (status >= 400) {
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
              total: config.timing.durationMs || 0,
              dns: config.timing.dnsMs,
              tcp: config.timing.tcpMs,
              tls: config.timing.tlsMs,
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
            finalUrl: xhr.responseURL || url,
            cookies,
            urls: buildUrlTree(config, xhr.responseURL || url),
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
