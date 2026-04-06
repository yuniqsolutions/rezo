import * as http2 from "node:http2";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import { URL } from "node:url";
import { Readable } from "node:stream";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, buildDecompressionError, builErrorFromResponse, buildDownloadError } from '../responses/buildError.js';
import { RezoCookieJar } from '../cookies/cookie-jar.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { RezoHeaders, sanitizeHttp2Headers } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { CompressionUtil } from '../utils/compression.js';
import { isSameDomain, RezoPerformance } from '../utils/tools.js';
import { SocksClient } from '../internal/agents/socks-client.js';
import * as net from "node:net";
import { ResponseCache } from '../cache/response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
import { buildTlsOptions } from '../stealth/tls-fingerprint.js';
let zstdDecompressSync = null;
let zstdChecked = false;
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
function looksCompressed(buffer, encoding) {
  if (buffer.length < 2)
    return false;
  const enc = encoding.toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") {
    return buffer[0] === 31 && buffer[1] === 139;
  }
  if (enc === "deflate" || enc === "x-deflate") {
    return buffer[0] === 120;
  }
  if (enc === "zstd") {
    return buffer.length >= 4 && buffer[0] === 40 && buffer[1] === 181 && buffer[2] === 47 && buffer[3] === 253;
  }
  if (enc === "br" || enc === "brotli") {
    const firstByte = buffer[0];
    if (firstByte === 123 || firstByte === 91 || firstByte === 60) {
      return false;
    }
    return true;
  }
  return true;
}
async function decompressBuffer(buffer, contentEncoding) {
  const encoding = contentEncoding.toLowerCase();
  if (!looksCompressed(buffer, encoding)) {
    return buffer;
  }
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
  getSessionKey(url, _options, proxy) {
    const proxyKey = proxy ? typeof proxy === "string" ? proxy : `${proxy.protocol}://${proxy.host}:${proxy.port}` : "";
    return `${url.protocol}//${url.host}${proxyKey ? `@${proxyKey}` : ""}`;
  }
  isSessionHealthy(session, entry) {
    if (session.closed || session.destroyed)
      return false;
    if (entry.goawayReceived)
      return false;
    const socket = session.socket;
    if (socket && (socket.destroyed || socket.closed || !socket.writable))
      return false;
    return true;
  }
  async getSession(url, options, timeout, forceNew = false, proxy, stealthProfile) {
    const key = this.getSessionKey(url, options, proxy);
    const existing = this.sessions.get(key);
    if (!forceNew && existing && this.isSessionHealthy(existing.session, existing)) {
      existing.lastUsed = Date.now();
      existing.refCount++;
      return existing.session;
    }
    if (existing && !this.isSessionHealthy(existing.session, existing)) {
      try {
        existing.session.close();
      } catch {}
      this.sessions.delete(key);
    }
    const session = await this.createSession(url, options, timeout, proxy, stealthProfile);
    const entry = {
      session,
      lastUsed: Date.now(),
      refCount: 1,
      goawayReceived: false,
      proxy
    };
    this.sessions.set(key, entry);
    session.on("close", () => {
      this.sessions.delete(key);
    });
    session.on("error", () => {
      this.sessions.delete(key);
    });
    session.on("goaway", () => {
      entry.goawayReceived = true;
    });
    return session;
  }
  async createSession(url, options, timeout, proxy, stealthProfile) {
    const authority = `${url.protocol}//${url.host}`;
    const sessionOptions = {
      ...options,
      rejectUnauthorized: options?.rejectUnauthorized !== false,
      ALPNProtocols: ["h2", "http/1.1"],
      timeout
    };
    if (stealthProfile) {
      const tlsOpts = buildTlsOptions(stealthProfile.tls);
      sessionOptions.secureContext = tlsOpts.secureContext;
      sessionOptions.ALPNProtocols = stealthProfile.tls.alpnProtocols;
      sessionOptions.minVersion = stealthProfile.tls.minVersion;
      sessionOptions.maxVersion = stealthProfile.tls.maxVersion;
      const h2 = stealthProfile.h2Settings;
      sessionOptions.settings = {
        headerTableSize: h2.headerTableSize,
        enablePush: h2.enablePush,
        initialWindowSize: h2.initialWindowSize,
        maxFrameSize: h2.maxFrameSize,
        ...h2.maxConcurrentStreams > 0 ? { maxConcurrentStreams: h2.maxConcurrentStreams } : {},
        ...h2.maxHeaderListSize > 0 ? { maxHeaderListSize: h2.maxHeaderListSize } : {}
      };
    }
    if (proxy) {
      const tunnelSocket = await this.createProxyTunnel(url, proxy, timeout, options?.rejectUnauthorized, stealthProfile);
      sessionOptions.createConnection = () => tunnelSocket;
    }
    return new Promise((resolve, reject) => {
      const session = http2.connect(authority, sessionOptions);
      session.setMaxListeners(20);
      if (stealthProfile && stealthProfile.h2Settings.connectionWindowSize > 0) {
        try {
          session.setLocalWindowSize(stealthProfile.h2Settings.connectionWindowSize);
        } catch {}
      }
      let settled = false;
      const timeoutId = timeout ? setTimeout(() => {
        if (!settled) {
          settled = true;
          session.destroy();
          reject(new Error(`HTTP/2 connection timeout after ${timeout}ms`));
        }
      }, timeout) : null;
      if (timeoutId && typeof timeoutId === "object" && "unref" in timeoutId) {
        timeoutId.unref();
      }
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
  async createProxyTunnel(url, proxy, timeout, rejectUnauthorized, stealthProfile) {
    return new Promise((resolve, reject) => {
      let proxyUrl;
      let proxyAuth;
      if (typeof proxy === "string") {
        proxyUrl = new URL(proxy);
        if (proxyUrl.username || proxyUrl.password) {
          proxyAuth = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64");
        }
      } else {
        const protocol = proxy.protocol || "http";
        let proxyUrlStr = `${protocol}://${proxy.host}:${proxy.port}`;
        if (proxy.auth) {
          const encodedUser = encodeURIComponent(proxy.auth.username);
          const encodedPass = encodeURIComponent(proxy.auth.password);
          proxyUrlStr = `${protocol}://${encodedUser}:${encodedPass}@${proxy.host}:${proxy.port}`;
          proxyAuth = Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString("base64");
        }
        proxyUrl = new URL(proxyUrlStr);
      }
      const targetHost = url.hostname;
      const targetPort = url.port || (url.protocol === "https:" ? "443" : "80");
      const stealthTlsOpts = stealthProfile ? buildTlsOptions(stealthProfile.tls) : undefined;
      if (proxyUrl.protocol.startsWith("socks")) {
        const socksType = proxyUrl.protocol === "socks5:" || proxyUrl.protocol === "socks5h:" ? 5 : 4;
        const socksOpts = {
          proxy: {
            host: proxyUrl.hostname,
            port: parseInt(proxyUrl.port || "1080", 10),
            type: socksType,
            userId: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
            password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined
          },
          destination: {
            host: targetHost,
            port: parseInt(targetPort, 10)
          },
          command: "connect",
          timeout
        };
        SocksClient.createConnection(socksOpts).then(({ socket }) => {
          if (url.protocol === "https:") {
            const tlsSocket = tls.connect({
              socket,
              host: targetHost,
              servername: targetHost,
              rejectUnauthorized: rejectUnauthorized !== false,
              ALPNProtocols: ["h2", "http/1.1"],
              ...stealthTlsOpts
            });
            tlsSocket.setMaxListeners(20);
            const tlsTimeoutId = timeout ? setTimeout(() => {
              tlsSocket.destroy();
              reject(new Error(`TLS handshake timeout after ${timeout}ms`));
            }, timeout) : null;
            tlsSocket.on("secureConnect", () => {
              if (tlsTimeoutId)
                clearTimeout(tlsTimeoutId);
              const alpn = tlsSocket.alpnProtocol;
              if (alpn && alpn !== "h2") {
                tlsSocket.destroy();
                reject(new Error(`Server does not support HTTP/2 (negotiated: ${alpn})`));
                return;
              }
              resolve(tlsSocket);
            });
            tlsSocket.on("error", (err) => {
              if (tlsTimeoutId)
                clearTimeout(tlsTimeoutId);
              reject(new Error(`TLS handshake failed: ${err.message}`));
            });
          } else {
            resolve(socket);
          }
        }).catch((err) => {
          reject(new Error(`SOCKS proxy connection failed: ${err.message}`));
        });
        return;
      }
      const proxyHost = proxyUrl.hostname;
      const proxyPort = parseInt(proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80"), 10);
      let proxySocket;
      const connectToProxy = () => {
        if (proxyUrl.protocol === "https:") {
          proxySocket = tls.connect({
            host: proxyHost,
            port: proxyPort,
            rejectUnauthorized: rejectUnauthorized !== false
          });
        } else {
          proxySocket = net.connect({
            host: proxyHost,
            port: proxyPort
          });
        }
        let settled = false;
        const timeoutId = timeout ? setTimeout(() => {
          if (!settled) {
            settled = true;
            proxySocket.destroy();
            reject(new Error(`Proxy connection timeout after ${timeout}ms`));
          }
        }, timeout) : null;
        proxySocket.on("error", (err) => {
          if (!settled) {
            settled = true;
            if (timeoutId)
              clearTimeout(timeoutId);
            reject(new Error(`Proxy connection error: ${err.message}`));
          }
        });
        proxySocket.on("connect", () => {
          const connectRequest = [
            `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
            `Host: ${targetHost}:${targetPort}`,
            proxyAuth ? `Proxy-Authorization: Basic ${proxyAuth}` : "",
            "",
            ""
          ].filter(Boolean).join(`\r
`);
          proxySocket.write(connectRequest);
        });
        let responseBuffer = "";
        proxySocket.on("data", function onData(data) {
          if (settled)
            return;
          responseBuffer += data.toString();
          const headerEnd = responseBuffer.indexOf(`\r
\r
`);
          if (headerEnd !== -1) {
            settled = true;
            if (timeoutId)
              clearTimeout(timeoutId);
            proxySocket.removeListener("data", onData);
            const statusLine = responseBuffer.split(`\r
`)[0];
            const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d{3})/);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
            if (statusCode === 200) {
              if (url.protocol === "https:") {
                const tlsSocket = tls.connect({
                  socket: proxySocket,
                  host: targetHost,
                  servername: targetHost,
                  rejectUnauthorized: rejectUnauthorized !== false,
                  ALPNProtocols: ["h2", "http/1.1"],
                  ...stealthTlsOpts
                });
                tlsSocket.setMaxListeners(20);
                const tlsTimeoutId = timeout ? setTimeout(() => {
                  tlsSocket.destroy();
                  reject(new Error(`TLS handshake timeout after ${timeout}ms`));
                }, timeout) : null;
                tlsSocket.on("secureConnect", () => {
                  if (tlsTimeoutId)
                    clearTimeout(tlsTimeoutId);
                  const alpn = tlsSocket.alpnProtocol;
                  if (alpn && alpn !== "h2") {
                    tlsSocket.destroy();
                    reject(new Error(`Server does not support HTTP/2 (negotiated: ${alpn})`));
                    return;
                  }
                  resolve(tlsSocket);
                });
                tlsSocket.on("error", (err) => {
                  if (tlsTimeoutId)
                    clearTimeout(tlsTimeoutId);
                  reject(new Error(`TLS handshake failed: ${err.message}`));
                });
              } else {
                resolve(proxySocket);
              }
            } else {
              proxySocket.destroy();
              reject(new Error(`Proxy CONNECT failed with status ${statusCode}: ${statusLine}`));
            }
          }
        });
      };
      connectToProxy();
    });
  }
  releaseSession(url, proxy) {
    const key = this.getSessionKey(url, undefined, proxy);
    const entry = this.sessions.get(key);
    if (entry) {
      entry.refCount = Math.max(0, entry.refCount - 1);
      entry.lastUsed = Date.now();
      if (entry.refCount === 0) {
        const socket = entry.session.socket;
        if (socket && typeof socket.unref === "function") {
          socket.unref();
        }
      }
    }
  }
  closeSession(url, proxy) {
    const key = this.getSessionKey(url, undefined, proxy);
    const entry = this.sessions.get(key);
    if (entry) {
      entry.session.close();
      this.sessions.delete(key);
    }
  }
  closeAllSessions() {
    for (const [_key, entry] of this.sessions.entries()) {
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
function updateTiming(config, timing, contentLengthCounter) {
  const now = performance.now();
  config.timing.domainLookupStart = timing.dnsStart || config.timing.startTime;
  config.timing.domainLookupEnd = timing.dnsEnd || timing.dnsStart || config.timing.startTime;
  config.timing.connectStart = timing.tcpStart || timing.dnsEnd || config.timing.startTime;
  config.timing.secureConnectionStart = timing.tlsStart || 0;
  config.timing.connectEnd = timing.tcpEnd || timing.tlsEnd || timing.tcpStart || config.timing.startTime;
  config.timing.requestStart = timing.tcpEnd || config.timing.startTime;
  config.timing.responseStart = timing.firstByteTime || config.timing.requestStart;
  config.timing.responseEnd = now;
  config.transfer.bodySize = contentLengthCounter;
  config.transfer.responseSize = contentLengthCounter;
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
  const { data: _data, ...sanitized } = config;
  return sanitized;
}
async function updateCookies(config, headers, url, rootJar) {
  const setCookieHeaders = headers["set-cookie"];
  if (!setCookieHeaders)
    return;
  const cookieHeaderArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  if (cookieHeaderArray.length === 0)
    return;
  const tempJar = new RezoCookieJar;
  tempJar.setCookiesSync(cookieHeaderArray, url);
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
  const jar = new RezoCookieJar;
  jar.setCookiesSync(acceptedCookieStrings, url);
  const jarToSync = rootJar || config.jar;
  if (!config.disableJar && jarToSync) {
    jarToSync.setCookiesSync(acceptedCookieStrings, url);
  }
  const cookies = jar.cookies();
  cookies.setCookiesString = cookieHeaderArray;
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
    config.responseCookies.setCookiesString = cookieHeaderArray;
  } else {
    config.responseCookies = cookies;
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
export async function executeRequest(options, defaultOptions, jar) {
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions, defaultOptions._proxyManager);
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  const { proxyManager } = configResult;
  const perform = new RezoPerformance;
  let selectedProxy = null;
  if (proxyManager) {
    const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    selectedProxy = proxyManager.next(requestUrl);
    if (selectedProxy) {
      fetchOptions.proxy = {
        protocol: selectedProxy.protocol,
        host: selectedProxy.host,
        port: selectedProxy.port,
        auth: selectedProxy.auth
      };
    } else if (proxyManager.shouldProxy(requestUrl) && !proxyManager.hasAvailableProxies() && proxyManager.config.failWithoutProxy) {
      const noProxyError = new RezoError("No proxy available: All proxies in the pool are exhausted, disabled, or in cooldown", mainConfig, "REZ_NO_PROXY_AVAILABLE", fetchOptions);
      proxyManager.notifyNoProxiesAvailable(requestUrl, noProxyError);
      throw noProxyError;
    }
  }
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
  let cache;
  let requestHeaders;
  let cachedEntry;
  let _needsRevalidation = false;
  if (cacheOption) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
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
    const res = executeHttp2Request(fetchOptions, mainConfig, options, perform, fs, streamResponse, downloadResponse, uploadResponse, jar);
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
          const retryUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
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
async function executeHttp2Request(fetchOptions, config, options, perform, fs, streamResult, downloadResult, uploadResult, rootJar) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let responseStatusCode;
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
  const _timeoutClearInstance = config.timeoutClearInstance;
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
  const sessionPool = Http2SessionPool.getInstance();
  while (true) {
    totalAttempts++;
    if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
      const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
      throw error;
    }
    try {
      const response = await executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool, rootJar);
      const statusOnNext = _stats.statusOnNext;
      if (response instanceof RezoError) {
        const fileName = config.fileName;
        if (fileName && fs && fs.existsSync(fileName)) {
          fs.unlinkSync(fileName);
        }
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
        const fromUrl = fetchOptions.fullUrl;
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
        fetchOptions.fullUrl = location;
        delete options.params;
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
        if (response.cookies?.setCookiesString?.length > 0 && jarToSync) {
          try {
            jarToSync.setCookiesSync(response.cookies.setCookiesString, fromUrl);
          } catch (e) {}
        }
        if (jarToSync && !config.disableJar) {
          try {
            const cookieString = jarToSync.getCookieStringSync(fetchOptions.fullUrl);
            if (cookieString) {
              if (fetchOptions.headers instanceof RezoHeaders) {
                fetchOptions.headers.set("cookie", cookieString);
              } else if (fetchOptions.headers) {
                fetchOptions.headers["cookie"] = cookieString;
              } else {
                fetchOptions.headers = new RezoHeaders({ cookie: cookieString });
              }
              if (config.debug) {
                console.log(`[Rezo Debug] HTTP/2: Updated Cookie header for redirect: ${cookieString.substring(0, 100)}...`);
              }
            }
          } catch (e) {}
        }
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
async function executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, _responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool, rootJar) {
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
      }
      const stealthProfile = fetchOptions._resolvedStealth;
      const pseudoValues = {
        ":method": fetchOptions.method.toUpperCase(),
        ":path": url.pathname + url.search,
        ":scheme": url.protocol.replace(":", ""),
        ":authority": url.host
      };
      const headers = {};
      if (stealthProfile) {
        for (const ph of stealthProfile.pseudoHeaderOrder) {
          headers[ph] = pseudoValues[ph];
        }
      } else {
        headers[http2.constants.HTTP2_HEADER_METHOD] = pseudoValues[":method"];
        headers[http2.constants.HTTP2_HEADER_PATH] = pseudoValues[":path"];
        headers[http2.constants.HTTP2_HEADER_SCHEME] = pseudoValues[":scheme"];
        headers[http2.constants.HTTP2_HEADER_AUTHORITY] = pseudoValues[":authority"];
      }
      const reqHeaders = stealthProfile && fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toOrderedObject(stealthProfile.headerOrder) : fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
      for (const [key, value] of Object.entries(reqHeaders)) {
        if (value !== undefined && value !== null) {
          headers[key.toLowerCase()] = String(value);
        }
      }
      if (!headers["accept-encoding"]) {
        headers["accept-encoding"] = "gzip, deflate, br";
      }
      if (config.debug && headers["cookie"]) {
        console.log(`[Rezo Debug] HTTP/2: Sending Cookie header: ${String(headers["cookie"]).substring(0, 100)}...`);
      } else if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: No Cookie header in request`);
      }
      if (body instanceof RezoFormData) {
        headers["content-type"] = `multipart/form-data; boundary=${body.getBoundary()}`;
      } else if (body instanceof FormData) {
        const tempForm = await RezoFormData.fromNativeFormData(body);
        headers["content-type"] = `multipart/form-data; boundary=${tempForm.getBoundary()}`;
        fetchOptions._convertedFormData = tempForm;
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
      const forceNewSession = requestCount > 0;
      let session;
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: Acquiring session for ${url.host}${forceNewSession ? " (forcing new for redirect)" : ""}${fetchOptions.proxy ? " (via proxy)" : ""}...`);
      }
      try {
        session = await (sessionPool || Http2SessionPool.getInstance()).getSession(url, sessionOptions, config.timeout !== null ? config.timeout : undefined, forceNewSession, fetchOptions.proxy, stealthProfile);
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session acquired successfully`);
        }
      } catch (err) {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session failed:`, err.message);
        }
        const error = buildSmartError(config, fetchOptions, err);
        _stats.statusOnNext = "error";
        resolve(error);
        return;
      }
      let chunks = [];
      let contentLengthCounter = 0;
      let responseHeaders = {};
      let status = 0;
      let statusText = "";
      let resolved = false;
      let isRedirect = false;
      let timeoutId = null;
      const sessionErrorHandler = (err) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session error:`, err.message);
        }
        if (!resolved) {
          resolved = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          const error = buildSmartError(config, fetchOptions, err);
          _stats.statusOnNext = "error";
          resolve(error);
        }
      };
      session.once("error", sessionErrorHandler);
      session.once("goaway", (errorCode, lastStreamID) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session GOAWAY received (errorCode: ${errorCode}, lastStreamID: ${lastStreamID})`);
        }
      });
      const cleanupSessionListeners = () => {
        session.removeListener("error", sessionErrorHandler);
      };
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: Creating request stream...`);
      }
      let req;
      try {
        req = session.request(headers);
      } catch (err) {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Failed to create request stream:`, err.message);
        }
        session.removeListener("error", sessionErrorHandler);
        const error = buildSmartError(config, fetchOptions, err);
        _stats.statusOnNext = "error";
        resolve(error);
        return;
      }
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: Request stream created`);
      }
      const requestTimeout = config.timeout || 30000;
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanupSessionListeners();
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Request timeout after ${requestTimeout}ms (no response received)`);
          }
          req.close(http2.constants.NGHTTP2_CANCEL);
          const error = buildSmartError(config, fetchOptions, new Error(`Request timeout after ${requestTimeout}ms`));
          _stats.statusOnNext = "error";
          resolve(error);
        }
      }, requestTimeout);
      const sessionSocket = session.socket;
      if (sessionSocket && typeof sessionSocket.ref === "function") {
        sessionSocket.ref();
      }
      req.on("close", () => {
        if (config.debug && !resolved) {
          console.log(`[Rezo Debug] HTTP/2: Stream closed (status: ${status}, resolved: ${resolved})`);
        }
        if (!resolved && status === 0) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanupSessionListeners();
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Stream closed without response - retrying with new session`);
          }
          const error = buildSmartError(config, fetchOptions, new Error("HTTP/2 stream closed without response"));
          _stats.statusOnNext = "error";
          resolve(error);
        }
      });
      req.on("aborted", () => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Stream aborted`);
        }
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanupSessionListeners();
          const error = buildSmartError(config, fetchOptions, new Error("HTTP/2 stream aborted"));
          _stats.statusOnNext = "error";
          resolve(error);
        }
      });
      req.on("error", (err) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Stream error:`, err.message);
        }
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanupSessionListeners();
          const error = buildSmartError(config, fetchOptions, err);
          _stats.statusOnNext = "error";
          resolve(error);
        }
      });
      req.on("frameError", (type, code, id) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Frame error - type: ${type}, code: ${code}, id: ${id}`);
        }
      });
      req.on("response", (headers) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Response received, status: ${headers[":status"]}`);
        }
        responseHeaders = headers;
        status = Number(headers[http2.constants.HTTP2_HEADER_STATUS]) || 200;
        statusText = getStatusText(status);
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const location = headers["location"];
        isRedirect = status >= 300 && status < 400 && !!location;
        if (isRedirect) {
          _stats.statusOnNext = "redirect";
          const redirectUrlObj = new URL(location, url);
          if (!redirectUrlObj.hash && url.hash) {
            redirectUrlObj.hash = url.hash;
          }
          _stats.redirectUrl = redirectUrlObj.href;
        }
        config.network.httpVersion = "h2";
        (async () => {
          try {
            await updateCookies(config, headers, url.href, rootJar);
          } catch (err) {
            if (config.debug) {
              console.log("[Rezo Debug] Cookie hook error:", err);
            }
          }
        })();
        if (eventEmitter && !isRedirect) {
          const headersEvent = {
            status,
            statusText,
            headers: new RezoHeaders(sanitizeHttp2Headers(headers)),
            contentType: headers["content-type"],
            contentLength: headers["content-length"] ? parseInt(headers["content-length"], 10) : undefined,
            cookies: config.responseCookies?.array || [],
            timing: {
              firstByte: config.timing.responseStart - config.timing.startTime,
              total: performance.now() - config.timing.startTime
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
      const dataStartTime = performance.now();
      req.on("data", (chunk) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Received data chunk: ${chunk.length} bytes (total: ${contentLengthCounter + chunk.length})`);
        }
        chunks.push(chunk);
        contentLengthCounter += chunk.length;
        if (streamResult) {
          streamResult.emit("data", chunk);
        }
        const contentLength = responseHeaders["content-length"] ? parseInt(responseHeaders["content-length"], 10) : undefined;
        if (eventEmitter) {
          const now = performance.now();
          const elapsed = now - dataStartTime;
          const speed = elapsed > 0 ? contentLengthCounter / (elapsed / 1000) : 0;
          const remaining = contentLength && contentLength > contentLengthCounter && speed > 0 ? (contentLength - contentLengthCounter) / speed * 1000 : 0;
          const progressEvent = {
            loaded: contentLengthCounter,
            total: contentLength || 0,
            percentage: contentLength ? contentLengthCounter / contentLength * 100 : 0,
            speed,
            averageSpeed: speed,
            estimatedTime: remaining,
            timestamp: now
          };
          eventEmitter.emit("progress", progressEvent);
        }
      });
      req.on("end", async () => {
        if (resolved)
          return;
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Stream 'end' event fired (status: ${status}, chunks: ${chunks.length}, bytes: ${contentLengthCounter})`);
        }
        resolved = true;
        clearTimeout(timeoutId);
        cleanupSessionListeners();
        try {
          updateTiming(config, timing, contentLengthCounter);
          if (!config.transfer) {
            config.transfer = { requestSize: 0, responseSize: 0, headerSize: 0, bodySize: 0 };
          }
          if (config.transfer.requestSize === undefined) {
            config.transfer.requestSize = 0;
          }
          if (config.transfer.requestSize === 0 && body) {
            if (typeof body === "string") {
              config.transfer.requestSize = Buffer.byteLength(body, "utf8");
            } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
              config.transfer.requestSize = body.length;
            } else if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
              config.transfer.requestSize = Buffer.byteLength(body.toString(), "utf8");
            } else if (body instanceof RezoFormData) {
              config.transfer.requestSize = await body.getLength() || 0;
            } else if (typeof body === "object") {
              config.transfer.requestSize = Buffer.byteLength(JSON.stringify(body), "utf8");
            }
          }
          (sessionPool || Http2SessionPool.getInstance()).releaseSession(url, fetchOptions.proxy);
          if (isRedirect) {
            _stats.statusOnNext = "redirect";
            const partialResponse = {
              data: "",
              status,
              statusText,
              headers: new RezoHeaders(sanitizeHttp2Headers(responseHeaders)),
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
          if (contentEncoding && contentLengthCounter > 0 && CompressionUtil.shouldDecompress(contentEncoding, config)) {
            try {
              const decompressed = await decompressBuffer(responseBody, contentEncoding);
              responseBody = decompressed;
            } catch (err) {
              const error = buildDecompressionError({
                statusCode: status,
                headers: sanitizeHttp2Headers(responseHeaders),
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
          config.status = status;
          config.statusText = statusText;
          const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
          _stats.statusOnNext = fetchOptions.validateStatus === null || _validateStatus(status) ? "success" : "error";
          const responseCookies = config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] };
          const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, url.href);
          const finalResponse = {
            data,
            status,
            statusText,
            headers: new RezoHeaders(sanitizeHttp2Headers(responseHeaders)),
            cookies: mergedCookies,
            config,
            contentType,
            contentLength: contentLengthCounter,
            finalUrl: url.href,
            urls: buildUrlTree(config, url.href)
          };
          if (downloadResult && fs && config.fileName) {
            try {
              const { dirname } = await import("node:path");
              const dir = dirname(config.fileName);
              if (dir && dir !== ".")
                fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(config.fileName, responseBody);
              const downloadFinishEvent = {
                status,
                statusText,
                headers: new RezoHeaders(sanitizeHttp2Headers(responseHeaders)),
                contentType,
                contentLength: responseBody.length,
                finalUrl: url.href,
                cookies: mergedCookies,
                urls: buildUrlTree(config, url.href),
                fileName: config.fileName,
                fileSize: responseBody.length,
                timing: {
                  ...getTimingDurations(config),
                  download: getTimingDurations(config).download || 0
                },
                averageSpeed: getTimingDurations(config).download ? responseBody.length / getTimingDurations(config).download * 1000 : 0,
                config: sanitizeConfig(config)
              };
              downloadResult.emit("finish", downloadFinishEvent);
              downloadResult.emit("done", downloadFinishEvent);
              downloadResult.emit("complete", downloadFinishEvent);
              downloadResult._markFinished();
            } catch (err) {
              const error = buildDownloadError({
                statusCode: status,
                headers: sanitizeHttp2Headers(responseHeaders),
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
              headers: new RezoHeaders(sanitizeHttp2Headers(responseHeaders)),
              contentType,
              contentLength: contentLengthCounter,
              finalUrl: url.href,
              cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
              urls: buildUrlTree(config, url.href),
              timing: getTimingDurations(config),
              config: sanitizeConfig(config)
            };
            streamResult.emit("finish", streamFinishEvent);
            streamResult.emit("done", streamFinishEvent);
            streamResult.emit("complete", streamFinishEvent);
            streamResult._markFinished();
          }
          if (uploadResult) {
            const uploadFinishEvent = {
              response: {
                status,
                statusText,
                headers: new RezoHeaders(sanitizeHttp2Headers(responseHeaders)),
                data,
                contentType,
                contentLength: contentLengthCounter
              },
              finalUrl: url.href,
              cookies: config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] },
              urls: buildUrlTree(config, url.href),
              uploadSize: config.transfer.requestSize || 0,
              timing: {
                ...getTimingDurations(config),
                upload: getTimingDurations(config).firstByte || 0,
                waiting: getTimingDurations(config).download > 0 && getTimingDurations(config).firstByte > 0 ? getTimingDurations(config).download - getTimingDurations(config).firstByte : 0
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
          resolve(finalResponse);
        } catch (endError) {
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Error in 'end' handler:`, endError.message);
          }
          (sessionPool || Http2SessionPool.getInstance()).releaseSession(url, fetchOptions.proxy);
          const error = buildSmartError(config, fetchOptions, endError);
          _stats.statusOnNext = "error";
          resolve(error);
        }
      });
      if (body) {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Writing request body (type: ${body?.constructor?.name || typeof body})...`);
        }
        if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
          req.write(body.toString());
        } else if (body instanceof FormData || body instanceof RezoFormData) {
          const form = body instanceof RezoFormData ? body : RezoFormData.fromNativeFormData(body);
          const buffer = await form.toBuffer();
          if (uploadResult) {
            const chunkSize = 16384;
            const totalSize = buffer.length;
            let written = 0;
            const uploadStart = performance.now();
            for (let offset = 0;offset < totalSize; offset += chunkSize) {
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
        } else if (typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) && !(body instanceof Readable)) {
          req.write(JSON.stringify(body));
        } else if (body instanceof Readable) {
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Piping stream body...`);
          }
          body.pipe(req);
          return;
        } else {
          req.write(body);
        }
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Body written, calling req.end()...`);
        }
      } else {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: No body, calling req.end()...`);
        }
      }
      req.end();
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: req.end() called, waiting for response...`);
      }
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
