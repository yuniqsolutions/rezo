const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { URL } = require("node:url");
const { Readable } = require("node:stream");
const { RezoError } = require('../errors/rezo-error.cjs');
const { RezoCookieJar } = require('../utils/cookies.cjs');
const RezoHeaders = require('../utils/headers.cjs');
const { getDefaultConfig, prepareHTTPOptions } = require('../utils/http-config.cjs');
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
const dns = require("dns");
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
  if (finalUrl && (urls.length === 0 || urls[0] !== finalUrl)) {
    urls.push(finalUrl);
  }
  return urls.length > 0 ? urls : [finalUrl];
}
async function executeRequest(options, defaultOptions, jar) {
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions);
  const config = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  let mainConfig = config.config;
  const perform = new RezoPerformance;
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url?.toString() || "";
  let cache;
  let requestHeaders;
  let cachedEntry;
  let needsRevalidation = false;
  if (cacheOption) {
    cache = getResponseCache(cacheOption);
    requestHeaders = config.fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(config.fetchOptions.headers.entries()) : config.fetchOptions.headers;
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
  if (isUpload && !config.config.data) {
    throw RezoError.fromError(new Error("Upload response type requires a request body (data or body)"), mainConfig, config.fetchOptions);
  }
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = new StreamResponse;
  } else if (isDownload) {
    const fileName = options.fileName || options.saveTo;
    const url = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url.toString();
    downloadResponse = new DownloadResponse(fileName, url);
  } else if (isUpload) {
    const fileName = typeof options.body === "string" ? undefined : options.body?.name;
    const url = typeof config.fetchOptions.url === "string" ? config.fetchOptions.url : config.fetchOptions.url.toString();
    uploadResponse = new UploadResponse(url, fileName);
  }
  const res = executeHttp1Request(config.fetchOptions, mainConfig, config.options, perform, d_options.fs, streamResponse, downloadResponse, uploadResponse);
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
async function executeHttp1Request(fetchOptions, config, options, perform, fs, streamResult, downloadResult, uploadResult) {
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
  const timeoutClearInstanse = config.timeoutClearInstanse;
  delete config.timeoutClearInstanse;
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
      const response = await request(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult);
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
                console.log(`Max retries (${maxRetries}) reached, throwing the last error`);
              }
              throw response;
            }
            retries++;
            if (config.debug) {
              console.log(`Request failed with status code ${responseStatusCode}, retrying...${retryDelay > 0 ? " in " + (incrementDelay ? retryDelay * retries : retryDelay) + "ms" : ""}`);
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
        const addedOptions = {};
        const location = _stats.redirectUrl;
        if (!location || !_stats.redirectUrl) {
          throw builErrorFromResponse("Redirect location not found", response, config, fetchOptions);
        }
        if (config.maxRedirects === 0) {
          config.maxRedirectsReached = true;
          throw builErrorFromResponse(`Redirects are disabled (maxRedirects=0)`, response, config, fetchOptions);
        }
        const enableCycleDetection = config.enableRedirectCycleDetection === true;
        if (enableCycleDetection) {
          const normalizedRedirectUrl = _stats.redirectUrl.toLowerCase();
          if (visitedUrls.has(normalizedRedirectUrl)) {
            throw builErrorFromResponse(`Redirect cycle detected: attempting to revisit ${_stats.redirectUrl}`, response, config, fetchOptions);
          }
          visitedUrls.add(normalizedRedirectUrl);
        }
        const redirectCode = response.status;
        const customHeaders = undefined;
        const onRedirect = config.beforeRedirect ? config.beforeRedirect({
          url: new URL(_stats.redirectUrl),
          status: response.status,
          headers: response.headers,
          sameDomain: isSameDomain(fetchOptions.fullUrl, _stats.redirectUrl),
          method: fetchOptions.method.toUpperCase()
        }) : undefined;
        if (typeof onRedirect !== "undefined") {
          if (typeof onRedirect === "boolean") {
            if (!onRedirect) {
              throw builErrorFromResponse("Redirect denied by user", response, config, fetchOptions);
            }
          } else if (!onRedirect.redirect) {
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
        addedOptions.redirectedUrl = _stats.redirectUrl;
        addedOptions.redirectCode = redirectCode;
        addedOptions.isRedirected = true;
        addedOptions.lastRedirectedUrl = fetchOptions.fullUrl;
        addedOptions.customHeaders = customHeaders;
        addedOptions.fullUrl = fetchOptions.fullUrl;
        delete options.params;
        fetchOptions.fullUrl = location;
        let commented = false;
        if (typeof onRedirect === "object" && onRedirect.redirect) {
          const method = onRedirect.method || fetchOptions.method;
          config.method = method;
          options.fullUrl = onRedirect.url;
          fetchOptions.fullUrl = onRedirect.url;
          if (onRedirect.withoutBody) {
            delete options.body;
          } else if (onRedirect.body) {
            options.body = onRedirect.body;
          }
          if (config.debug) {
            commented = true;
            console.log(`
Redirecting to: ${fetchOptions.fullUrl} using ${method} method`);
          }
          if (onRedirect.setHeaders) {
            addedOptions.customHeaders = onRedirect.setHeaders;
          }
        } else if (response.status === 301 || response.status === 302 || response.status === 303) {
          if (config.debug) {
            commented = true;
            console.log(`
Redirecting to: ${fetchOptions.fullUrl} using GET method`);
          }
          options.method = "GET";
          delete options.body;
        } else
          commented = false;
        if (config.debug && !commented) {
          console.log(`Redirecting to: ${fetchOptions.fullUrl}`);
        }
        const __ = prepareHTTPOptions(fetchOptions, config.cookieJar, addedOptions, config);
        fetchOptions = __.fetchOptions;
        config = __.config;
        options = __.options;
        continue;
      }
      delete config.beforeRedirect;
      config.setSignal = () => {};
      return response;
    } catch (error) {
      throw error;
    } finally {
      if (timeoutClearInstanse)
        clearTimeout(timeoutClearInstanse);
    }
  }
}
async function request(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult) {
  return await new Promise(async (resolve) => {
    try {
      const { fullUrl, body, fileName: filename } = fetchOptions;
      const url = new URL(fullUrl || fetchOptions.url);
      const isSecure = url.protocol === "https:";
      const httpModule = isSecure ? config.isSecure && config.adapter ? config.adapter : https : !config.isSecure && config.adapter ? config.adapter : http;
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
            backoff: config.retry.incrementDelay ? config.retry.retryDelay : undefined
          } : undefined
        };
        eventEmitter.emit("start", startEvent);
      }
      const requestOptions = buildHTTPOptions(fetchOptions, isSecure, url);
      try {
        const req = httpModule.request(requestOptions, async (res) => {
          if (!config.timing.ttfbMs) {
            timing.firstByteTime = performance.now();
            config.timing.ttfbMs = timing.firstByteTime - timing.startTime;
          }
          const { statusCode, statusMessage, headers, httpVersion, socket } = res;
          const { remoteAddress, remotePort, localAddress, localPort } = socket;
          responseStatusCode = statusCode;
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
          updateCookies(config, headers, url.href);
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
                firstByte: config.timing.ttfbMs,
                total: performance.now() - timing.startTime
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
            _stats.redirectUrl = new URL(location, url).href;
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
            res.on("data", (chunk) => {
              streamedBytes += chunk.length;
            });
            streamResult.on("finish", () => {
              updateTiming(config, timing, contentLength || "", streamedBytes, res.rawHeaders);
              const streamFinishEvent = {
                status: statusCode || 200,
                statusText: statusMessage || "OK",
                headers: new RezoHeaders(headers),
                contentType,
                contentLength: streamedBytes,
                finalUrl: url.toString(),
                cookies: config.cookieJar?.cookies() || { array: [], map: {} },
                urls: [url.toString()],
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
              streamResult.emit("done", streamFinishEvent);
              streamResult._markFinished();
              _stats.statusOnNext = "success";
              const minimalResponse = buildResponseFromIncoming(res, Buffer.alloc(0), config, url.toString(), buildUrlTree(config, url.toString()));
              resolve(minimalResponse);
            });
            res.pipe(streamResult);
          } else if (downloadResult && filename && fs && statusCode && statusCode >= 200 && statusCode < 300) {
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
                cookies: config.cookieJar?.cookies() || { array: [], map: {} },
                urls: [url.toString()],
                fileName: filename,
                fileSize: contentLengthCounter,
                timing: {
                  total: config.timing.durationMs || 0,
                  dns: config.timing.dnsMs,
                  tcp: config.timing.tcpMs,
                  tls: config.timing.tlsMs,
                  firstByte: config.timing.ttfbMs,
                  download: config.timing.transferMs || 0
                },
                averageSpeed: config.timing.transferMs ? contentLengthCounter / config.timing.transferMs * 1000 : 0,
                config: sanitizeConfig(config)
              };
              downloadResult.emit("finish", finishEvent);
              downloadResult.emit("done", finishEvent);
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
              _stats.statusOnNext = isRedirected ? "redirect" : statusCode && statusCode >= 200 && statusCode < 300 ? "success" : "error";
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
                  cookies: config.cookieJar?.cookies() || { array: [], map: {} },
                  urls: [url.toString()],
                  uploadSize: config.transfer.requestSize || 0,
                  fileName: uploadResult.fileName,
                  timing: {
                    total: config.timing.durationMs || 0,
                    dns: config.timing.dnsMs,
                    tcp: config.timing.tcpMs,
                    tls: config.timing.tlsMs,
                    upload: config.timing.ttfbMs || 0,
                    waiting: config.timing.ttfbMs && config.timing.transferMs ? config.timing.transferMs - config.timing.ttfbMs : 0,
                    download: config.timing.transferMs
                  },
                  averageUploadSpeed: config.timing.ttfbMs && config.transfer.requestSize ? config.transfer.requestSize / config.timing.ttfbMs * 1000 : 0,
                  averageDownloadSpeed: config.timing.transferMs ? contentLengthCounter / config.timing.transferMs * 1000 : 0,
                  config: sanitizeConfig(config)
                };
                uploadResult.emit("finish", uploadFinishEvent);
                uploadResult.emit("done", uploadFinishEvent);
                uploadResult._markFinished();
              }
              resolve(finalResponse);
            });
            decompressedStream.on("error", (err) => {
              _stats.statusOnNext = "error";
              updateTiming(config, timing, contentLength || "", contentLengthCounter, res.rawHeaders);
              if (_stats.redirectUrl) {
                const partialResponse = buildResponseFromIncoming(res, Buffer.concat(chunks), config, url.toString(), buildUrlTree(config, url.toString()), undefined, undefined, contentLengthCounter);
                resolve(partialResponse);
                return;
              }
              const error = buildDecompressionError({
                statusCode: res.statusCode || 500,
                headers,
                contentType,
                contentLength: contentLength || contentLengthCounter.toString(),
                cookies: cookies || [],
                statusText: err.message || "Decompression failed",
                url: res.url || url.toString(),
                body: Buffer.concat(chunks),
                finalUrl: url.toString(),
                config,
                request: fetchOptions
              });
              resolve(error);
            });
          }
        });
        req.on("socket", (socket) => {
          timing.dnsStart = performance.now();
          socket.on("lookup", () => {
            if (!config.timing.dnsMs) {
              if (timing.dnsStart)
                config.timing.dnsMs = performance.now() - timing.dnsStart;
              timing.tcpStart = performance.now();
            }
          });
          socket.on("secureConnect", () => {
            if (!config.timing.tlsMs) {
              if (timing.tlsStart && !config.timing.tlsMs)
                config.timing.tlsMs = performance.now() - timing.tlsStart;
            }
            const tls = {
              cipher: socket.getCipher(),
              cert: socket.getPeerCertificate(),
              tlsVersion: socket.getProtocol()
            };
            const { cipher, cert, tlsVersion } = tls;
            config.security.tlsVersion = tlsVersion;
            config.security.cipher = cipher?.name;
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
          });
          socket.on("connect", () => {
            if (!config.timing.tcpMs) {
              if (timing.tcpStart)
                config.timing.tcpMs = performance.now() - timing.tcpStart;
              if (isSecure)
                timing.tlsStart = performance.now();
            }
            const { remoteAddress, remotePort, localAddress, localPort, remoteFamily } = socket;
            if (remoteAddress && !config.network.remoteAddress) {
              config.network.remoteAddress = remoteAddress;
              config.network.remotePort = remotePort;
              config.network.localAddress = localAddress;
              config.network.localPort = localPort;
              config.network.family = remoteFamily;
            }
          });
        });
        if (body) {
          if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
            req.write(body.toString());
          } else if (body instanceof FormData || body instanceof RezoFormData) {
            if (body instanceof RezoFormData) {
              req.setHeader("Content-Type", `multipart/form-data; boundary=${body.getBoundary()}`);
              body.pipe(req);
            } else {
              const form = await RezoFormData.fromNativeFormData(body);
              req.setHeader("Content-Type", `multipart/form-data; boundary=${form.getBoundary()}`);
              form.pipe(req);
            }
          } else if (typeof body === "object" && !(body instanceof Buffer) && !(body instanceof Uint8Array) && !(body instanceof Readable)) {
            req.write(JSON.stringify(body));
          } else {
            req.write(body);
          }
        }
        req.end();
        req.on("error", (error) => {
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
  config.timing.endTimestamp = Date.now();
  const elapsedMs = performance.now() - timing.startTime;
  config.timing.durationMs = elapsedMs;
  config.timing.transferMs = timing.firstByteTime ? performance.now() - timing.firstByteTime : elapsedMs;
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
    dnsCache: dnsCacheOption
  } = fetchOptions;
  const secureContext = isSecure && useSecureContext ? new https.Agent({
    secureContext: createSecureContext(),
    servername: url.host,
    rejectUnauthorized,
    keepAlive: true
  }) : undefined;
  const customAgent = url.protocol === "https:" && httpsAgent ? httpsAgent : httpAgent ? httpAgent : undefined;
  const agent = parseProxy(proxy) || customAgent || secureContext;
  let lookup;
  if (dnsCacheOption) {
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
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isSecure ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: headers.toObject(),
    timeout: timeout || 0,
    signal,
    rejectUnauthorized,
    agent,
    auth: auth?.username && auth?.password ? `${auth.username}:${auth.password}` : undefined,
    lookup
  };
  return requestOptions;
}
async function setInitialConfig(config, fetchOptions, isSecure, url, httpModule, requestCount, startTime, actualTimestamp) {
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
        cookies: config.enableCookieJar,
        redirects: config.maxRedirects > 0,
        proxy: !!proxy,
        timeout: !!timeout,
        ssl: isSecure
      }
    };
    config.features = {
      http2: !!config.http2,
      compression: !!config.compression?.enabled,
      cookies: !!config.enableCookieJar,
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
    const timestampToUse = actualTimestamp || Date.now();
    config.timing = config.timing || { startTimestamp: timestampToUse, endTimestamp: 0, durationMs: 0 };
    config.timing.startTimestamp = config.timing.startTimestamp || timestampToUse;
    config.maxRedirectsReached = false;
    config.responseCookies = {
      array: [],
      serialized: [],
      netscape: `# Netscape HTTP Cookie File
# This file was generated by Rezo HTTP client
# Based on uniqhtt cookie implementation
`,
      string: "",
      setCookiesString: []
    };
    config.retryAttempts = 0;
    config.errors = [];
    config.debug = fetchOptions.debug || false;
    config.requestId = generateRequestId();
    config.sessionId = fetchOptions.sessionId || generateSessionId();
    config.traceId = generateTraceId();
    config.timestamp = config.timing.startTimestamp;
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
      requestBodySize = fetchOptions.body.getLengthSync();
    } else if (fetchOptions.body instanceof FormData) {
      requestBodySize = (await RezoFormData.fromNativeFormData(fetchOptions.body)).getLengthSync();
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
    ecdhCurve: "X25519:prime256v1:secp384r1:secp521r1",
    honorCipherOrder: true,
    ciphers: "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA",
    sigalgs: "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:ecdsa_secp521r1_sha512:rsa_pss_rsae_sha512:rsa_pkcs1_sha512",
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
function parseProxy(proxy, isScure = true, rejectUnauthorized = false) {
  if (!proxy) {
    return;
  }
  if (typeof proxy === "string") {
    if (proxy.startsWith("http://")) {
      return rezoProxy(`http://${proxy.slice(7)}`, "http");
    } else if (proxy.startsWith("https://")) {
      return rezoProxy(`https://${proxy.slice(8)}`, "https");
    }
    return rezoProxy(proxy);
  }
  if (proxy.protocol === "http" || proxy.protocol === "https") {
    return rezoProxy({
      ...proxy,
      client: !isScure ? "http" : "https"
    });
  }
  return rezoProxy(proxy);
}
function updateCookies(config, headers, url) {
  const cookies = headers["set-cookie"];
  if (cookies) {
    const jar = new RezoCookieJar;
    if (config.enableCookieJar && config.cookieJar) {
      config.cookieJar.setCookiesSync(cookies, url);
    }
    jar.setCookiesSync(cookies, url);
    if (config.useCookies) {
      const parsedCookies = jar.cookies();
      const existingArray = config.responseCookies?.array || [];
      for (const cookie of parsedCookies.array) {
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
  }
}

exports.executeRequest = executeRequest;