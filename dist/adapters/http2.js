import * as http2 from "node:http2";
import * as zlib from "node:zlib";
import { URL } from "node:url";
import { Readable } from "node:stream";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, buildDecompressionError, builErrorFromResponse, buildDownloadError } from '../responses/buildError.js';
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
let zstdDecompressSync = null;
let zstdChecked = false;
async function decompressBuffer(buffer, contentEncoding) {
  const encoding = contentEncoding.toLowerCase();
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
          if (err)
            reject(err);
          else
            resolve(result);
        });
      });
    case "deflate":
    case "x-deflate":
      return new Promise((resolve, reject) => {
        zlib.inflate(buffer, (err, result) => {
          if (err)
            reject(err);
          else
            resolve(result);
        });
      });
    case "br":
    case "brotli":
      return new Promise((resolve, reject) => {
        zlib.brotliDecompress(buffer, (err, result) => {
          if (err)
            reject(err);
          else
            resolve(result);
        });
      });
    case "zstd":
      if (!zstdChecked) {
        zstdChecked = true;
        try {
          const zlibModule = await import("node:zlib");
          if (typeof zlibModule.zstdDecompressSync === "function") {
            zstdDecompressSync = zlibModule.zstdDecompressSync;
          }
        } catch {}
      }
      if (!zstdDecompressSync) {
        throw new Error("zstd decompression not available: requires Node.js 22.15+ with native zstd support");
      }
      return zstdDecompressSync(buffer);
    default:
      return buffer;
  }
}

class Http2SessionPool {
  static instance;
  sessions = new Map;
  cleanupInterval = null;
  SESSION_TIMEOUT = 60000;
  CLEANUP_INTERVAL = 30000;
  static getInstance() {
    if (!Http2SessionPool.instance) {
      Http2SessionPool.instance = new Http2SessionPool;
    }
    return Http2SessionPool.instance;
  }
  constructor() {
    this.startCleanup();
  }
  startCleanup() {
    if (this.cleanupInterval)
      return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.sessions.entries()) {
        if (entry.refCount === 0 && now - entry.lastUsed > this.SESSION_TIMEOUT) {
          entry.session.close();
          this.sessions.delete(key);
        }
      }
    }, this.CLEANUP_INTERVAL);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
  getSessionKey(url, options) {
    return `${url.protocol}//${url.host}`;
  }
  async getSession(url, options, timeout) {
    const key = this.getSessionKey(url, options);
    const existing = this.sessions.get(key);
    if (existing && !existing.session.closed && !existing.session.destroyed) {
      existing.lastUsed = Date.now();
      existing.refCount++;
      return existing.session;
    }
    const session = await this.createSession(url, options, timeout);
    this.sessions.set(key, {
      session,
      lastUsed: Date.now(),
      refCount: 1
    });
    session.on("close", () => {
      this.sessions.delete(key);
    });
    session.on("error", () => {
      this.sessions.delete(key);
    });
    return session;
  }
  createSession(url, options, timeout) {
    return new Promise((resolve, reject) => {
      const authority = `${url.protocol}//${url.host}`;
      const sessionOptions = {
        ...options,
        rejectUnauthorized: options?.rejectUnauthorized !== false,
        ALPNProtocols: ["h2", "http/1.1"],
        timeout
      };
      const session = http2.connect(authority, sessionOptions);
      let settled = false;
      const timeoutId = timeout ? setTimeout(() => {
        if (!settled) {
          settled = true;
          session.destroy();
          reject(new Error(`HTTP/2 connection timeout after ${timeout}ms`));
        }
      }, timeout) : null;
      session.on("connect", () => {
        if (!settled) {
          settled = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          resolve(session);
        }
      });
      session.on("error", (err) => {
        if (!settled) {
          settled = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          reject(err);
        }
      });
    });
  }
  releaseSession(url) {
    const key = this.getSessionKey(url);
    const entry = this.sessions.get(key);
    if (entry) {
      entry.refCount = Math.max(0, entry.refCount - 1);
      entry.lastUsed = Date.now();
    }
  }
  closeSession(url) {
    const key = this.getSessionKey(url);
    const entry = this.sessions.get(key);
    if (entry) {
      entry.session.close();
      this.sessions.delete(key);
    }
  }
  closeAllSessions() {
    for (const [key, entry] of this.sessions.entries()) {
      entry.session.close();
    }
    this.sessions.clear();
  }
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.closeAllSessions();
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
      adapterUsed: "http2",
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
  const { data: _data, ...sanitized } = config;
  return sanitized;
}
function updateCookies(config, headers, url) {
  const setCookieHeaders = headers["set-cookie"];
  if (!setCookieHeaders)
    return;
  const cookieHeaderArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  if (!config.responseCookies) {
    config.responseCookies = {
      array: [],
      serialized: [],
      netscape: "",
      string: "",
      setCookiesString: []
    };
  }
  for (const cookieStr of cookieHeaderArray) {
    config.responseCookies.setCookiesString.push(cookieStr);
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
      config.responseCookies.array.push(cookie);
    }
  }
  config.responseCookies.string = config.responseCookies.array.map((c) => `${c.key}=${c.value}`).join("; ");
  config.responseCookies.serialized = config.responseCookies.array.map((c) => c.toJSON());
  config.responseCookies.netscape = config.responseCookies.array.map((c) => c.toNetscapeFormat()).join(`
`);
}
export async function executeRequest(options, defaultOptions, jar) {
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
  let needsRevalidation = false;
  if (cacheOption) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
    cachedEntry = cache.get(method, requestUrl, requestHeaders);
    if (cachedEntry) {
      const cacheControl = parseCacheControlFromHeaders(cachedEntry.headers);
      if (cacheControl.noCache || cacheControl.mustRevalidate) {
        needsRevalidation = true;
      } else {
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
  let fs;
  if (isDownload) {
    try {
      fs = await import("node:fs");
    } catch {
      fs = undefined;
    }
  }
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
  const res = executeHttp2Request(fetchOptions, mainConfig, options, perform, fs, streamResponse, downloadResponse, uploadResponse);
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
async function executeHttp2Request(fetchOptions, config, options, perform, fs, streamResult, downloadResult, uploadResult) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let responseStatusCode;
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
  const timeoutClearInstance = config.timeoutClearInstanse;
  delete config.timeoutClearInstanse;
  const eventEmitter = streamResult || downloadResult || uploadResult;
  if (eventEmitter) {
    eventEmitter.emit("initiated");
  }
  const sessionPool = Http2SessionPool.getInstance();
  while (true) {
    totalAttempts++;
    if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
      const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
      throw error;
    }
    try {
      const response = await executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool);
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
        if (!responseStatusCode || !config.retry) {
          throw response;
        }
        if (config.retry) {
          if (config.retry.condition) {
            const isPassed = await config.retry.condition(response);
            if (typeof isPassed === "boolean" && isPassed === false) {
              throw response;
            }
          } else {
            if (!statusCodes.includes(responseStatusCode)) {
              throw response;
            }
            if (maxRetries <= retries) {
              if (config.debug) {
                console.log(`Max retries (${maxRetries}) reached`);
              }
              throw response;
            }
            retries++;
            if (config.debug) {
              console.log(`Retrying... ${retryDelay > 0 ? "in " + (incrementDelay ? retryDelay * retries : retryDelay) + "ms" : ""}`);
            }
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
async function executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool) {
  return new Promise(async (resolve) => {
    try {
      const { fullUrl, body } = fetchOptions;
      const url = new URL(fullUrl || fetchOptions.url);
      const isSecure = url.protocol === "https:";
      if (requestCount === 0) {
        config.adapterUsed = "http2";
        config.isSecure = isSecure;
        config.finalUrl = url.href;
        config.network.protocol = "h2";
        config.timing.startTimestamp = timing.startTimestamp;
      }
      const headers = {
        [http2.constants.HTTP2_HEADER_METHOD]: fetchOptions.method.toUpperCase(),
        [http2.constants.HTTP2_HEADER_PATH]: url.pathname + url.search,
        [http2.constants.HTTP2_HEADER_SCHEME]: url.protocol.replace(":", ""),
        [http2.constants.HTTP2_HEADER_AUTHORITY]: url.host
      };
      const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
      for (const [key, value] of Object.entries(reqHeaders)) {
        if (value !== undefined && value !== null) {
          headers[key.toLowerCase()] = String(value);
        }
      }
      if (!headers["accept-encoding"]) {
        headers["accept-encoding"] = "gzip, deflate, br";
      }
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
      const sessionOptions = {
        rejectUnauthorized: config.rejectUnauthorized !== false
      };
      const securityContext = config.secureContext || config.security;
      if (securityContext?.ca)
        sessionOptions.ca = securityContext.ca;
      if (securityContext?.cert)
        sessionOptions.cert = securityContext.cert;
      if (securityContext?.key)
        sessionOptions.key = securityContext.key;
      if (securityContext?.pfx)
        sessionOptions.pfx = securityContext.pfx;
      if (securityContext?.passphrase)
        sessionOptions.passphrase = securityContext.passphrase;
      let session;
      try {
        session = await (sessionPool || Http2SessionPool.getInstance()).getSession(url, sessionOptions, config.timeout !== null ? config.timeout : undefined);
      } catch (err) {
        const error = buildSmartError(config, fetchOptions, err);
        _stats.statusOnNext = "error";
        resolve(error);
        return;
      }
      const req = session.request(headers);
      if (config.timeout) {
        req.setTimeout(config.timeout, () => {
          req.close(http2.constants.NGHTTP2_CANCEL);
          const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${config.timeout}ms`));
          _stats.statusOnNext = "error";
          resolve(error);
        });
      }
      let chunks = [];
      let contentLengthCounter = 0;
      let responseHeaders = {};
      let status = 0;
      let statusText = "";
      req.on("response", (headers) => {
        responseHeaders = headers;
        status = Number(headers[http2.constants.HTTP2_HEADER_STATUS]) || 200;
        statusText = getStatusText(status);
        if (!config.timing.ttfbMs) {
          timing.firstByteTime = performance.now();
          config.timing.ttfbMs = timing.firstByteTime - timing.startTime;
        }
        const location = headers["location"];
        const isRedirect = status >= 300 && status < 400 && location;
        if (isRedirect) {
          _stats.statusOnNext = "redirect";
          _stats.redirectUrl = new URL(location, url).href;
        }
        config.network.httpVersion = "h2";
        updateCookies(config, headers, url.href);
        if (eventEmitter && !isRedirect) {
          const headersEvent = {
            status,
            statusText,
            headers: new RezoHeaders(headers),
            contentType: headers["content-type"],
            contentLength: headers["content-length"] ? parseInt(headers["content-length"], 10) : undefined,
            cookies: config.responseCookies?.array || [],
            timing: {
              firstByte: config.timing.ttfbMs,
              total: performance.now() - timing.startTime
            }
          };
          eventEmitter.emit("headers", headersEvent);
          eventEmitter.emit("status", status, statusText);
          eventEmitter.emit("cookies", config.responseCookies?.array || []);
          if (downloadResult) {
            downloadResult.status = status;
            downloadResult.statusText = statusText;
          } else if (uploadResult) {
            uploadResult.status = status;
            uploadResult.statusText = statusText;
          }
        }
      });
      req.on("data", (chunk) => {
        chunks.push(chunk);
        contentLengthCounter += chunk.length;
        if (streamResult) {
          streamResult.emit("data", chunk);
        }
        const contentLength = responseHeaders["content-length"] ? parseInt(responseHeaders["content-length"], 10) : undefined;
        if (eventEmitter) {
          const progressEvent = {
            loaded: contentLengthCounter,
            total: contentLength || 0,
            percentage: contentLength ? Math.round(contentLengthCounter / contentLength * 100) : 0,
            speed: 0,
            averageSpeed: 0,
            estimatedTime: 0,
            timestamp: Date.now()
          };
          eventEmitter.emit("progress", progressEvent);
          eventEmitter.emit("download-progress", progressEvent);
        }
      });
      req.on("end", async () => {
        config.timing.endTimestamp = Date.now();
        config.timing.durationMs = performance.now() - timing.startTime;
        config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : config.timing.durationMs;
        config.transfer.bodySize = contentLengthCounter;
        config.transfer.responseSize = contentLengthCounter;
        (sessionPool || Http2SessionPool.getInstance()).releaseSession(url);
        if (_stats.statusOnNext === "redirect") {
          const partialResponse = {
            data: "",
            status,
            statusText,
            headers: new RezoHeaders(responseHeaders),
            cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
            config,
            contentType: responseHeaders["content-type"],
            contentLength: contentLengthCounter,
            finalUrl: url.href,
            urls: buildUrlTree(config, url.href)
          };
          resolve(partialResponse);
          return;
        }
        let responseBody = Buffer.concat(chunks);
        const contentEncoding = responseHeaders["content-encoding"];
        if (contentEncoding && contentLengthCounter > 0) {
          try {
            const decompressed = await decompressBuffer(responseBody, contentEncoding);
            responseBody = decompressed;
          } catch (err) {
            const error = buildDecompressionError({
              statusCode: status,
              headers: responseHeaders,
              contentType: responseHeaders["content-type"],
              contentLength: String(contentLengthCounter),
              cookies: config.responseCookies?.setCookiesString || [],
              statusText: err.message,
              url: url.href,
              body: responseBody,
              finalUrl: url.href,
              config,
              request: fetchOptions
            });
            _stats.statusOnNext = "error";
            resolve(error);
            return;
          }
        }
        let data;
        const contentType = responseHeaders["content-type"] || "";
        const responseType = config.responseType || fetchOptions.responseType || "auto";
        if (responseType === "buffer" || responseType === "arrayBuffer") {
          data = responseBody;
        } else if (responseType === "text") {
          data = responseBody.toString("utf-8");
        } else if (responseType === "json" || responseType === "auto" && contentType.includes("application/json")) {
          try {
            data = JSON.parse(responseBody.toString("utf-8"));
          } catch {
            data = responseBody.toString("utf-8");
          }
        } else {
          if (contentType.includes("application/json")) {
            try {
              data = JSON.parse(responseBody.toString("utf-8"));
            } catch {
              data = responseBody.toString("utf-8");
            }
          } else {
            data = responseBody.toString("utf-8");
          }
        }
        if (status >= 400) {
          const error = builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
            status,
            statusText,
            headers: new RezoHeaders(responseHeaders),
            data
          }, config, fetchOptions);
          _stats.statusOnNext = "error";
          resolve(error);
          return;
        }
        _stats.statusOnNext = "success";
        const finalResponse = {
          data,
          status,
          statusText,
          headers: new RezoHeaders(responseHeaders),
          cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
          config,
          contentType,
          contentLength: contentLengthCounter,
          finalUrl: url.href,
          urls: buildUrlTree(config, url.href)
        };
        if (downloadResult && fs && config.fileName) {
          try {
            fs.writeFileSync(config.fileName, responseBody);
            const downloadFinishEvent = {
              status,
              statusText,
              headers: new RezoHeaders(responseHeaders),
              contentType,
              contentLength: responseBody.length,
              finalUrl: url.href,
              cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
              urls: buildUrlTree(config, url.href),
              fileName: config.fileName,
              fileSize: responseBody.length,
              timing: {
                total: config.timing.durationMs || 0,
                dns: config.timing.dnsMs,
                tcp: config.timing.tcpMs,
                tls: config.timing.tlsMs,
                firstByte: config.timing.ttfbMs,
                download: config.timing.transferMs || 0
              },
              averageSpeed: config.timing.transferMs ? responseBody.length / config.timing.transferMs * 1000 : 0,
              config: sanitizeConfig(config)
            };
            downloadResult.emit("finish", downloadFinishEvent);
            downloadResult.emit("done", downloadFinishEvent);
            downloadResult._markFinished();
          } catch (err) {
            const error = buildDownloadError({
              statusCode: status,
              headers: responseHeaders,
              contentType,
              contentLength: String(contentLengthCounter),
              cookies: config.responseCookies?.setCookiesString || [],
              statusText: err.message,
              url: url.href,
              body: responseBody,
              finalUrl: url.href,
              config,
              request: fetchOptions
            });
            downloadResult.emit("error", error);
            resolve(error);
            return;
          }
        }
        if (streamResult) {
          const streamFinishEvent = {
            status,
            statusText,
            headers: new RezoHeaders(responseHeaders),
            contentType,
            contentLength: contentLengthCounter,
            finalUrl: url.href,
            cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
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
        }
        if (uploadResult) {
          const uploadFinishEvent = {
            response: {
              status,
              statusText,
              headers: new RezoHeaders(responseHeaders),
              data,
              contentType,
              contentLength: contentLengthCounter
            },
            finalUrl: url.href,
            cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
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
            averageDownloadSpeed: config.timing.transferMs ? contentLengthCounter / config.timing.transferMs * 1000 : 0,
            config: sanitizeConfig(config)
          };
          uploadResult.emit("finish", uploadFinishEvent);
          uploadResult.emit("done", uploadFinishEvent);
          uploadResult._markFinished();
        }
        resolve(finalResponse);
      });
      req.on("error", (err) => {
        _stats.statusOnNext = "error";
        (sessionPool || Http2SessionPool.getInstance()).releaseSession(url);
        const error = buildSmartError(config, fetchOptions, err);
        if (eventEmitter) {
          eventEmitter.emit("error", error);
        }
        resolve(error);
      });
      if (body) {
        if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
          req.write(body.toString());
        } else if (body instanceof FormData || body instanceof RezoFormData) {
          if (body instanceof RezoFormData) {
            body.pipe(req);
            return;
          } else {
            const form = await RezoFormData.fromNativeFormData(body);
            form.pipe(req);
            return;
          }
        } else if (typeof body === "object" && !(body instanceof Buffer) && !(body instanceof Uint8Array) && !(body instanceof Readable)) {
          req.write(JSON.stringify(body));
        } else if (body instanceof Readable) {
          body.pipe(req);
          return;
        } else {
          req.write(body);
        }
      }
      req.end();
    } catch (error) {
      _stats.statusOnNext = "error";
      const rezoError = buildSmartError(config, fetchOptions, error);
      const eventEmitter = streamResult || downloadResult || uploadResult;
      if (eventEmitter) {
        eventEmitter.emit("error", rezoError);
      }
      resolve(rezoError);
    }
  });
}
function getStatusText(status) {
  const statusTexts = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    204: "No Content",
    206: "Partial Content",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    429: "Too Many Requests",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout"
  };
  return statusTexts[status] || "Unknown";
}

export { Http2SessionPool };
