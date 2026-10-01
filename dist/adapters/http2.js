import { assertInputTransport } from '../utils/request-fetch-options.js';
import { resolveResponseType } from '../shared/resolve-response-type.js';
import { requestBodyBytes, isBlobBody, isStreamBody } from '../utils/request-body.js';
import { assertNodeBodyAvailable, claimNodeBodyStream, nodeRequestBodyStream, pipeRequestBody } from './node-request-body.js';
import { Http2SessionIdentity } from './http2-session-identity.js';
import { encodeMultipartBody } from './multipart-request-body.js';
import { takeCoreCacheOwnership } from '../cache/response-cache-ownership.js';
import * as http2 from "node:http2";
import { createHash } from "node:crypto";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, buildDecompressionError, builErrorFromResponse, buildDownloadError, buildRedirectControlError } from '../responses/buildError.js';
import { RezoCookieJar, Cookie } from '../cookies/cookie-jar.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import {
  attachDownloadTargetFailureCause,
  createDownloadTargetTransaction
} from './download-target-transaction.js';
import { RezoHeaders, prepareRedirectHeaders, sanitizeHttp2Headers } from '../utils/headers.js';
import {
  composeRedirectHeaders,
  createRedirectHeaderPolicyState,
  stageRedirectHeaderTransition
} from '../utils/redirect-header-policy.js';
const H2_PROXY_RETRY_COUNT = Symbol("rezo.http2.proxyRetryCount");
const H2_PROXY_RETRY_SELECTED = Symbol("rezo.http2.proxyRetrySelected");
const H2_PROXY_RETRY_FAILURES = Symbol("rezo.http2.proxyRetryFailures");
const H2_LOGICAL_REQUEST_LIFETIME = Symbol("rezo.http2.logicalRequestLifetime");
function normalizeH2Request(options, defaultOptions) {
  const headers = new RezoHeaders(options.headers || {});
  const defaultHeaders = new RezoHeaders(defaultOptions.headers || {});
  defaultHeaders.forEach((value, name) => {
    if (value && !headers.has(name))
      headers.append(name, value);
  });
  const literalCookie = headers.get("cookie");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  return Object.freeze({
    options: { ...options, headers },
    literalCookie,
    originHeaders: new RezoHeaders(headers)
  });
}
function mergeH2CookieLayers(literalCookie, jarCookie) {
  if (literalCookie && jarCookie)
    return `${literalCookie}; ${jarCookie}`;
  return literalCookie || jarCookie || null;
}
function createH2DestinationHeaders(config, jar, destinationUrl, targetBase, xsrfCookieName, xsrfHeaderName, suppressJarCookie) {
  const destinationHeaders = new RezoHeaders;
  if (config.disableJar || config.useCookies === false)
    return destinationHeaders;
  if (!suppressJarCookie) {
    const jarCookie = jar.getCookieHeader(destinationUrl);
    const cookie = mergeH2CookieLayers(targetBase.get("cookie"), jarCookie || null);
    if (cookie)
      destinationHeaders.set("cookie", cookie);
  }
  if (xsrfCookieName && xsrfHeaderName) {
    const token = jar.getCookiesForRequest(destinationUrl).find((cookie) => cookie.key === xsrfCookieName)?.value;
    if (token)
      destinationHeaders.set(xsrfHeaderName, token);
  }
  return destinationHeaders;
}
function h2HookOwnsCookie(operations, replacement) {
  if (operations.some(({ key }) => key.toLowerCase() === "cookie"))
    return true;
  return replacement !== undefined;
}
function updateH2RequestCookieDiagnostics(config, headers, url) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    config.requestCookies = [];
    return;
  }
  try {
    const diagnosticJar = new RezoCookieJar;
    diagnosticJar.setCookiesSync(cookieHeader, url);
    config.requestCookies = diagnosticJar.getCookiesForRequest(url);
  } catch (error) {
    config.requestCookies = [];
    if (config.debug) {
      console.log("[Rezo Debug] HTTP/2 request Cookie diagnostic parse failed:", error);
    }
  }
}
function refreshH2DestinationHeaders(config, fetchOptions, state, cleanBase, jar, xsrfCookieName, xsrfHeaderName, suppressJarCookie) {
  const destinationHeaders = createH2DestinationHeaders(config, jar, state.currentUrl, cleanBase, xsrfCookieName, xsrfHeaderName, suppressJarCookie);
  const headers = composeRedirectHeaders(state, {
    targetBase: cleanBase,
    destinationHeaders
  });
  fetchOptions.headers = headers;
  updateH2RequestCookieDiagnostics(config, headers, state.currentUrl);
}
function createH2RequestDeadline(timeout, startedAt = performance.now()) {
  const timeoutMs = typeof timeout === "number" ? timeout : timeout?.total;
  if (timeoutMs === undefined || timeoutMs === null || timeoutMs <= 0)
    return;
  return Object.freeze({
    expiresAt: startedAt + timeoutMs,
    timeoutMs
  });
}
function createH2DeadlineError(deadline, config, fetchOptions, stage) {
  const startedAt = deadline.expiresAt - deadline.timeoutMs;
  const elapsed = Math.max(deadline.timeoutMs, Math.round(performance.now() - startedAt));
  const error = createStagedTimeoutError("total", elapsed, config, fetchOptions);
  Object.defineProperty(error, "stage", { value: stage, enumerable: false, configurable: true });
  notifyH2TotalTimeoutHooksOnce(deadline, config, fetchOptions, elapsed);
  return error;
}
function notifyH2TimeoutHooks(config, fetchOptions, phase, elapsed) {
  const hooks = config.hooks?.onTimeout;
  if (!hooks || hooks.length === 0)
    return;
  const timeoutType = phase === "connect" ? "connect" : phase === "headers" || phase === "body" ? "response" : "request";
  const url = String(fetchOptions.fullUrl ?? fetchOptions.url ?? "");
  for (const hook of hooks) {
    containLifecycleHook(() => hook({ type: timeoutType, timeout: elapsed, elapsed, url, timestamp: Date.now() }, config), (hookError) => {
      if (config.debug)
        console.log("[Rezo Debug] onTimeout hook error:", hookError);
    });
  }
}
const notifiedH2Deadlines = new WeakSet;
function notifyH2TotalTimeoutHooksOnce(deadline, config, fetchOptions, elapsed) {
  if (notifiedH2Deadlines.has(deadline))
    return;
  notifiedH2Deadlines.add(deadline);
  const hooks = config.hooks?.onTimeout;
  if (!hooks || hooks.length === 0)
    return;
  const url = String(fetchOptions.fullUrl ?? fetchOptions.url ?? "");
  for (const hook of hooks) {
    containLifecycleHook(() => hook({ type: "request", timeout: elapsed, elapsed, url, timestamp: Date.now() }, config), (hookError) => {
      if (config.debug)
        console.log("[Rezo Debug] onTimeout hook error:", hookError);
    });
  }
}
function createH2AbortError(config, fetchOptions) {
  return new RezoError("Request aborted by signal", config, "ABORT_ERR", fetchOptions);
}
function isH2AbortOrTimeoutError(error) {
  if (!(error instanceof RezoError))
    return false;
  const code = String(error.code || "");
  return code === "ABORT_ERR" || code === "UND_ERR_ABORTED" || code === "ETIMEDOUT" || code === "ECONNABORTED";
}
function notifyH2AbortHooks(error, config, fetchOptions, startedAt) {
  const hooks = config.hooks?.onAbort;
  if (!hooks || hooks.length === 0)
    return;
  const code = String(error.code || "");
  const reason = code === "ABORT_ERR" || code === "UND_ERR_ABORTED" ? "signal" : "timeout";
  const url = String(fetchOptions.fullUrl || fetchOptions.url || "");
  const elapsed = performance.now() - startedAt;
  for (const hook of hooks) {
    containLifecycleHook(() => hook({ reason, message: error.message, url, elapsed, timestamp: Date.now() }, config), (hookError) => {
      if (config.debug)
        console.log("[Rezo Debug] onAbort hook error:", hookError);
    });
  }
}
function buildH2CallbackFailure(causeValue, config, fetchOptions) {
  const cause = causeValue instanceof Error ? causeValue : new Error(String(causeValue));
  if (!(causeValue instanceof Error))
    Object.defineProperty(cause, "cause", { value: causeValue, enumerable: false });
  const error = new RezoError(cause.message || "Response callback failed", config, "REZ_UNKNOWN_ERROR", fetchOptions);
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
}
function absoluteRedirectDestination(location, sourceUrl) {
  try {
    return new URL(location, sourceUrl).href;
  } catch {
    return location;
  }
}
function getH2DeadlineRemaining(deadline, config, fetchOptions, stage) {
  if (!deadline)
    return;
  const remaining = Math.ceil(deadline.expiresAt - performance.now());
  if (remaining <= 0)
    throw createH2DeadlineError(deadline, config, fetchOptions, stage);
  return remaining;
}
async function awaitH2Deadline(promiseOrFactory, deadline, config, fetchOptions, stage) {
  const remaining = getH2DeadlineRemaining(deadline, config, fetchOptions, stage);
  const signal = fetchOptions.signal ?? config.signal ?? undefined;
  if (signal?.aborted)
    throw createH2AbortError(config, fetchOptions);
  const promise = typeof promiseOrFactory === "function" ? Promise.resolve().then(promiseOrFactory) : promiseOrFactory;
  if (remaining === undefined && !signal)
    return promise;
  let timeoutId;
  let abortHandler;
  const lifetimePromise = new Promise((_resolve, reject) => {
    if (remaining !== undefined) {
      timeoutId = setTimeout(() => {
        reject(createH2DeadlineError(deadline, config, fetchOptions, stage));
      }, remaining);
    }
    if (signal) {
      abortHandler = () => {
        try {
          getH2DeadlineRemaining(deadline, config, fetchOptions, stage);
          reject(createH2AbortError(config, fetchOptions));
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
  try {
    const value = await Promise.race([promise, lifetimePromise]);
    getH2DeadlineRemaining(deadline, config, fetchOptions, stage);
    if (signal?.aborted)
      throw createH2AbortError(config, fetchOptions);
    return value;
  } catch (error) {
    getH2DeadlineRemaining(deadline, config, fetchOptions, stage);
    if (signal?.aborted)
      throw createH2AbortError(config, fetchOptions);
    throw error;
  } finally {
    if (timeoutId !== undefined)
      clearTimeout(timeoutId);
    if (signal && abortHandler)
      signal.removeEventListener("abort", abortHandler);
  }
}
async function waitForH2Delay(delayMs, deadline, config, fetchOptions, stage) {
  if (delayMs <= 0) {
    await awaitH2Deadline(() => Promise.resolve(), deadline, config, fetchOptions, stage);
    return;
  }
  let delayTimer;
  try {
    await awaitH2Deadline(() => new Promise((resolve) => {
      delayTimer = setTimeout(resolve, delayMs);
    }), deadline, config, fetchOptions, stage);
  } finally {
    if (delayTimer !== undefined)
      clearTimeout(delayTimer);
  }
}
async function awaitH2HookStage(promiseOrFactory, config, fetchOptions, stage, deadline) {
  if (deadline) {
    return awaitH2Deadline(promiseOrFactory, deadline, config, fetchOptions, stage);
  }
  const timeout = resolveTimeoutMs(fetchOptions.timeout) ?? resolveTimeoutMs(config.timeout) ?? 30000;
  const stageDeadline = timeout > 0 ? Object.freeze({
    expiresAt: performance.now() + timeout,
    timeoutMs: timeout
  }) : undefined;
  return awaitH2Deadline(promiseOrFactory, stageDeadline, config, fetchOptions, stage);
}
function h2RedirectField(value, field) {
  if (value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, field)) {
    return Object.freeze({ kind: "present", value: Reflect.get(value, field) });
  }
  return Object.freeze({ kind: "absent" });
}
function createH2HookHeaderRecorder(target, operations) {
  let recorder;
  recorder = new Proxy(target, {
    get(inner, prop) {
      const conveniences = {
        setAuthorization: "authorization",
        setContentType: "content-type",
        setUserAgent: "user-agent"
      };
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(conveniences, prop)) {
        return (...args) => {
          operations.push({
            op: "set",
            key: conveniences[prop],
            value: String(args[0])
          });
          inner[prop](...args);
          return recorder;
        };
      }
      if (prop === "set" || prop === "append" || prop === "delete") {
        return (...args) => {
          if (prop === "delete") {
            operations.push({ op: "delete", key: String(args[0]) });
          } else {
            operations.push({
              op: prop,
              key: String(args[0]),
              value: String(args[1])
            });
          }
          return inner[prop](...args);
        };
      }
      const value = Reflect.get(inner, prop, inner);
      return typeof value === "function" ? value.bind(recorder) : value;
    },
    set(inner, prop, value) {
      if (typeof prop === "string") {
        operations.push({ op: "set", key: prop, value: String(value) });
      }
      return Reflect.set(inner, prop, value);
    },
    deleteProperty(inner, prop) {
      if (typeof prop === "string")
        operations.push({ op: "delete", key: prop });
      return Reflect.deleteProperty(inner, prop);
    }
  });
  return recorder;
}
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { CompressionUtil, ZSTD_UNAVAILABLE_MARKER } from '../utils/compression.js';
import { validateZstdFrame } from '../utils/zstd-frame-validator.js';
import { isSameDomain, RezoPerformance } from '../utils/tools.js';
import { SOCKS_PROXY_CONNECTION_TIMEOUT_MESSAGE, SocksClient } from '../internal/agents/socks-client.js';
import { selectProxyForRetry } from '../proxy/manager.js';
import * as net from "node:net";
import { sanitizeConfig } from '../responses/sanitize-config.js';
import { ResponseCache } from '../cache/response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
import { parseStagedTimeouts, resolveTimeoutMs } from '../utils/staged-timeout.js';
import { containLifecycleHook, createStagedTimeoutError, statusAttemptContinues } from '../shared/index.js';
import { debugErrorDump } from '../utils/debug-error-dump.js';
import { runAfterParseHooks, settleFacadeError } from '../core/hooks.js';
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
    case "gzip-raw":
      return new Promise((resolve, reject) => {
        zlib.inflateRaw(buffer, (err, result) => {
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
    case "zstd": {
      const verdict = validateZstdFrame(buffer);
      if (!verdict.complete) {
        throw new Error(verdict.fault ? `invalid zstd frame: ${verdict.fault}` : "truncated zstd frame: the encoded body ended before the frame was structurally complete");
      }
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
        const unavailable = new Error("zstd decompression is not available in this runtime (Node.js gained zlib zstd support in 22.15); the encoded body was not decoded");
        unavailable.code = ZSTD_UNAVAILABLE_MARKER;
        throw unavailable;
      }
      return zstdDecompressSync(buffer);
    }
    default:
      return buffer;
  }
}

class H2PendingSessionCreation {
  key;
  baseline;
  state = "creating";
  stopError;
  supersededError;
  supersededResourcesAreDisposable = false;
  rejectStop;
  stop = new Promise((_resolve, reject) => {
    this.rejectStop = reject;
  });
  resources = new Set;
  constructor(key, baseline) {
    this.key = key;
    this.baseline = baseline;
  }
  track(resource) {
    if (this.state === "cancelled") {
      try {
        resource.destroy();
      } catch {}
      throw this.stopError;
    }
    this.resources.add(resource);
    return resource;
  }
  race(operation) {
    return Promise.race([operation, this.stop]);
  }
  cancel(error = new Error("HTTP/2 session acquisition cancelled")) {
    if (this.state === "cancelled" || this.state === "published")
      return;
    const shouldRejectStop = this.stopError === undefined;
    this.state = "cancelled";
    this.stopError = this.stopError ?? error;
    if (shouldRejectStop)
      this.rejectStop(this.stopError);
    for (const resource of [...this.resources].reverse()) {
      try {
        if (typeof resource.close === "function") {
          resource.close();
        } else if (typeof resource.end === "function" && resource.connecting !== true) {
          const forceDestroy = setTimeout(() => {
            if (!resource.destroyed)
              resource.destroy();
          }, 250);
          if (typeof forceDestroy === "object" && "unref" in forceDestroy) {
            forceDestroy.unref();
          }
          resource.once?.("close", () => clearTimeout(forceDestroy));
          resource.end();
        } else {
          resource.destroy();
        }
      } catch {}
    }
    this.resources.clear();
  }
  supersede() {
    if (this.state !== "creating")
      return;
    const error = new Error("HTTP/2 session acquisition superseded by a concurrent winner");
    this.state = "superseded";
    this.stopError = error;
    this.supersededError = error;
    this.rejectStop(error);
    if (this.supersededResourcesAreDisposable)
      this.cancel(error);
  }
  isSupersededError(error) {
    return error === this.supersededError;
  }
  checkpoint() {
    if (this.state === "creating")
      return;
    if (this.state === "superseded") {
      const error = this.supersededError;
      this.cancel(error);
      throw error;
    }
    if (this.state === "cancelled")
      throw this.stopError;
  }
  markSupersededResourcesDisposable() {
    this.supersededResourcesAreDisposable = true;
    this.checkpoint();
  }
  disposeIfDetached() {
    if (this.state === "superseded" || this.state === "cancelled") {
      this.cancel(this.stopError);
    }
  }
  publish() {
    this.checkpoint();
    this.state = "published";
    this.resources.clear();
  }
}
const H2_SESSION_RELEASE_TARGETS = new WeakMap;
function remainingUntil(deadlineAt) {
  if (deadlineAt === undefined)
    return;
  return Math.max(1, Math.ceil(deadlineAt - performance.now()));
}
const SESSION_CONNECT_TIMEOUT = Symbol("rezo.http2.sessionConnectTimeout");
function markSessionConnectTimeout(error) {
  Object.defineProperty(error, SESSION_CONNECT_TIMEOUT, { value: true, enumerable: false });
  return error;
}
function isSessionConnectTimeout(error) {
  return typeof error === "object" && error !== null && error[SESSION_CONNECT_TIMEOUT] === true;
}
function createH2ProxySessionKey(proxy) {
  let endpoint;
  let credentials = "";
  if (typeof proxy === "string") {
    try {
      const proxyUrl = new URL(proxy);
      const defaultPort = proxyUrl.protocol === "https:" ? "443" : proxyUrl.protocol.startsWith("socks") ? "1080" : "80";
      endpoint = `${proxyUrl.protocol}//${proxyUrl.hostname.toLowerCase()}:${proxyUrl.port || defaultPort}`;
      credentials = `${proxyUrl.username}\x00${proxyUrl.password}`;
    } catch {
      endpoint = `invalid:${createHash("sha256").update(proxy).digest("hex")}`;
    }
  } else {
    endpoint = `${proxy.protocol || "http"}://${proxy.host.toLowerCase()}:${proxy.port}`;
    if (proxy.auth) {
      credentials = `${proxy.auth.username}\x00${proxy.auth.password}`;
    }
  }
  if (!credentials)
    return endpoint;
  const credentialFingerprint = createHash("sha256").update(credentials).digest("hex");
  return `${endpoint}#auth=${credentialFingerprint}`;
}

class Http2SessionPool {
  static instance;
  connectionIdentity = new Http2SessionIdentity;
  sessions = new Map;
  entriesBySession = new Map;
  pendingCreations = new Set;
  poolEpoch = 0;
  keyEpochs = new Map;
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
      for (const entry of [...this.entriesBySession.values()]) {
        if (entry.refCount === 0 && now - entry.lastUsed > this.SESSION_TIMEOUT) {
          this.closeSessionEntry(entry);
        }
      }
    }, this.CLEANUP_INTERVAL);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
  getSessionKey(url, options, proxy, stealthProfile) {
    const proxyKey = proxy ? createH2ProxySessionKey(proxy) : "";
    const identityKey = stealthProfile ? `#tls:${stealthProfile.transportDigest}` : "";
    return `${url.protocol}//${url.host}${proxyKey ? `@${proxyKey}` : ""}${this.connectionIdentity.suffix(options)}${identityKey}`;
  }
  static keyMatches(entryKey, key) {
    return entryKey === key || entryKey.startsWith(`${key}#connection:`) || entryKey.startsWith(`${key}#tls:`);
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
  isEntryReusable(entry) {
    return entry.state === "reusable" && this.isSessionHealthy(entry.session, entry);
  }
  acquireSessionEntry(entry) {
    entry.lastUsed = Date.now();
    entry.refCount++;
    return entry.session;
  }
  deleteCurrentIfExact(entry) {
    if (this.sessions.get(entry.key) === entry)
      this.sessions.delete(entry.key);
  }
  forgetSessionEntry(entry) {
    if (entry.state === "closed")
      return;
    entry.state = "closed";
    this.deleteCurrentIfExact(entry);
    this.entriesBySession.delete(entry.session);
  }
  closeSessionEntry(entry) {
    if (entry.state === "closed")
      return;
    this.forgetSessionEntry(entry);
    try {
      entry.session.close();
    } catch {
      try {
        entry.session.destroy();
      } catch {}
    }
  }
  retireSessionEntry(entry) {
    if (entry.state !== "reusable")
      return;
    entry.state = "retired";
    this.deleteCurrentIfExact(entry);
    if (entry.refCount === 0)
      this.closeSessionEntry(entry);
  }
  releaseSessionEntry(entry) {
    if (entry.state === "closed" || entry.refCount <= 0)
      return;
    entry.refCount--;
    entry.lastUsed = Date.now();
    if (entry.refCount !== 0)
      return;
    const socket = entry.session.socket;
    if (socket && typeof socket.unref === "function")
      socket.unref();
    if (entry.state === "retired")
      this.closeSessionEntry(entry);
  }
  registerSessionEntry(key, session, proxy) {
    const entry = {
      key,
      session,
      lastUsed: Date.now(),
      refCount: 0,
      goawayReceived: false,
      state: "reusable",
      proxy
    };
    this.entriesBySession.set(session, entry);
    this.sessions.set(key, entry);
    session.once("close", () => {
      this.forgetSessionEntry(entry);
    });
    session.once("error", () => {
      this.closeSessionEntry(entry);
    });
    session.once("goaway", () => {
      entry.goawayReceived = true;
      this.retireSessionEntry(entry);
    });
    return entry;
  }
  async getSession(url, options, timeout, forceNew = false, proxy, stealthProfile, signal) {
    options = { ...options, rejectUnauthorized: options?.rejectUnauthorized !== false };
    const key = this.getSessionKey(url, options, proxy, stealthProfile);
    const existingAtStart = this.sessions.get(key);
    if (!forceNew && existingAtStart && this.isEntryReusable(existingAtStart)) {
      return this.acquireSessionEntry(existingAtStart);
    }
    if (existingAtStart && !this.isEntryReusable(existingAtStart)) {
      this.retireSessionEntry(existingAtStart);
    }
    const epoch = this.poolEpoch;
    const keyEpoch = this.keyEpochs.get(key) ?? 0;
    const creation = new H2PendingSessionCreation(key, existingAtStart);
    this.pendingCreations.add(creation);
    let detachAbort;
    if (signal) {
      const onAbort = () => creation.cancel(new Error("HTTP/2 session acquisition aborted by the caller"));
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        detachAbort = () => signal.removeEventListener("abort", onAbort);
      }
    }
    const rawSession = this.createSession(url, options, timeout, proxy, stealthProfile, creation);
    rawSession.then(() => {
      detachAbort?.();
      creation.disposeIfDetached();
      this.pendingCreations.delete(creation);
    }, () => {
      detachAbort?.();
      this.pendingCreations.delete(creation);
    });
    let session;
    try {
      session = await creation.race(rawSession);
    } catch (error) {
      if (creation.isSupersededError(error)) {
        const winner = this.sessions.get(key);
        if (winner && this.isEntryReusable(winner)) {
          creation.cancel(error instanceof Error ? error : undefined);
          return this.acquireSessionEntry(winner);
        }
      }
      creation.cancel(error instanceof Error ? error : undefined);
      throw error;
    }
    if (this.poolEpoch !== epoch || (this.keyEpochs.get(key) ?? 0) !== keyEpoch) {
      creation.cancel();
      throw new Error("HTTP/2 session acquisition invalidated before publication");
    }
    const current = this.sessions.get(key);
    if (current && current !== existingAtStart && this.isEntryReusable(current)) {
      creation.cancel();
      return this.acquireSessionEntry(current);
    }
    if (!forceNew && current && this.isEntryReusable(current)) {
      creation.cancel();
      return this.acquireSessionEntry(current);
    }
    if (current && !this.isEntryReusable(current))
      this.retireSessionEntry(current);
    for (const competitor of this.pendingCreations) {
      if (competitor !== creation && competitor.key === key && competitor.baseline === existingAtStart) {
        competitor.supersede();
      }
    }
    creation.publish();
    const entry = this.registerSessionEntry(key, session, proxy);
    if (current && current !== entry)
      this.retireSessionEntry(current);
    return this.acquireSessionEntry(entry);
  }
  async createSession(url, options, timeout, proxy, stealthProfile, creation) {
    const authority = `${url.protocol}//${url.host}`;
    const establishmentDeadlineAt = timeout !== undefined && timeout > 0 ? performance.now() + timeout : undefined;
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
      const settings = {};
      if (h2.headerTableSize !== undefined)
        settings.headerTableSize = h2.headerTableSize;
      if (h2.enablePush !== undefined)
        settings.enablePush = h2.enablePush;
      if (h2.maxConcurrentStreams !== undefined)
        settings.maxConcurrentStreams = h2.maxConcurrentStreams;
      if (h2.initialWindowSize !== undefined)
        settings.initialWindowSize = h2.initialWindowSize;
      if (h2.maxFrameSize !== undefined)
        settings.maxFrameSize = h2.maxFrameSize;
      if (h2.maxHeaderListSize !== undefined)
        settings.maxHeaderListSize = h2.maxHeaderListSize;
      sessionOptions.settings = settings;
      if (!proxy) {
        const port = url.port ? Number(url.port) : 443;
        const servername = net.isIP(url.hostname) ? undefined : url.hostname;
        sessionOptions.createConnection = () => tls.connect({
          host: url.hostname,
          port,
          servername,
          secureContext: tlsOpts.secureContext,
          ALPNProtocols: stealthProfile.tls.alpnProtocols,
          minVersion: stealthProfile.tls.minVersion,
          maxVersion: stealthProfile.tls.maxVersion,
          rejectUnauthorized: sessionOptions.rejectUnauthorized !== false
        });
      }
    }
    let proxyTunnel;
    if (proxy) {
      const establishedTunnel = await this.createProxyTunnel(url, proxy, establishmentDeadlineAt, options?.rejectUnauthorized, stealthProfile, creation);
      proxyTunnel = establishedTunnel;
      creation?.markSupersededResourcesDisposable();
      sessionOptions.createConnection = () => establishedTunnel;
    }
    if (!proxy)
      creation?.markSupersededResourcesDisposable();
    return new Promise((resolve, reject) => {
      const session = creation ? creation.track(http2.connect(authority, sessionOptions)) : http2.connect(authority, sessionOptions);
      session.setMaxListeners(20);
      const connectionWindowSize = stealthProfile?.h2Settings.connectionWindowSize;
      if (connectionWindowSize !== undefined && connectionWindowSize > 0) {
        session.once("connect", () => {
          try {
            session.setLocalWindowSize(65535 + connectionWindowSize);
          } catch (windowError) {
            session.emit("error", windowError instanceof Error ? windowError : new Error(String(windowError)));
          }
        });
      }
      let settled = false;
      const sessionBudget = remainingUntil(establishmentDeadlineAt);
      const timeoutId = sessionBudget !== undefined ? setTimeout(() => {
        if (!settled) {
          settled = true;
          session.destroy();
          reject(markSessionConnectTimeout(new Error(`HTTP/2 connection timeout after ${timeout}ms`)));
        }
      }, sessionBudget) : null;
      if (timeoutId && typeof timeoutId === "object" && "unref" in timeoutId) {
        timeoutId.unref();
      }
      session.on("connect", () => {
        if (!settled) {
          try {
            creation?.checkpoint();
          } catch (error) {
            settled = true;
            if (timeoutId)
              clearTimeout(timeoutId);
            session.destroy();
            reject(error);
            return;
          }
          proxyTunnel?.resume();
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
      session.on("close", () => {
        if (!settled) {
          settled = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          reject(new Error("HTTP/2 session closed before connection completed"));
        }
      });
    });
  }
  async createProxyTunnel(url, proxy, establishmentDeadlineAt, rejectUnauthorized, stealthProfile, creation) {
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
        const socksBudget = remainingUntil(establishmentDeadlineAt);
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
          ...socksBudget !== undefined ? { timeout: socksBudget } : {}
        };
        const socksConnection = SocksClient.createConnection(socksOpts).then(({ socket }) => {
          const tunnelSocket = creation ? creation.track(socket) : socket;
          creation?.checkpoint();
          return { socket: tunnelSocket };
        });
        const cancellableSocksConnection = creation ? creation.race(socksConnection) : socksConnection;
        cancellableSocksConnection.then(({ socket: tunnelSocket }) => {
          if (url.protocol === "https:") {
            const tlsSocket = creation ? creation.track(tls.connect({
              socket: tunnelSocket,
              host: targetHost,
              servername: targetHost,
              rejectUnauthorized: rejectUnauthorized !== false,
              ALPNProtocols: ["h2", "http/1.1"],
              ...stealthTlsOpts
            })) : tls.connect({
              socket: tunnelSocket,
              host: targetHost,
              servername: targetHost,
              rejectUnauthorized: rejectUnauthorized !== false,
              ALPNProtocols: ["h2", "http/1.1"],
              ...stealthTlsOpts
            });
            tlsSocket.setMaxListeners(20);
            let tlsSettled = false;
            const tlsBudget = remainingUntil(establishmentDeadlineAt);
            const tlsTimeoutId = tlsBudget !== undefined ? setTimeout(() => {
              if (tlsSettled)
                return;
              tlsSettled = true;
              tlsSocket.destroy();
              reject(markSessionConnectTimeout(new Error(`TLS handshake timeout after ${tlsBudget}ms`)));
            }, tlsBudget) : null;
            tlsSocket.on("secureConnect", () => {
              if (tlsSettled)
                return;
              tlsSettled = true;
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
              if (tlsSettled)
                return;
              tlsSettled = true;
              if (tlsTimeoutId)
                clearTimeout(tlsTimeoutId);
              reject(new Error(`TLS handshake failed: ${err.message}`));
            });
            tlsSocket.on("close", () => {
              if (tlsSettled)
                return;
              tlsSettled = true;
              if (tlsTimeoutId)
                clearTimeout(tlsTimeoutId);
              reject(new Error("TLS handshake closed before completion"));
            });
          } else {
            resolve(tunnelSocket);
          }
        }).catch((err) => {
          if (err instanceof Error && err.message === SOCKS_PROXY_CONNECTION_TIMEOUT_MESSAGE) {
            reject(markSessionConnectTimeout(new Error(`SOCKS proxy connection timeout after ${socksBudget}ms`)));
            return;
          }
          reject(new Error(`SOCKS proxy connection failed: ${err.message}`));
        });
        return;
      }
      const proxyHost = proxyUrl.hostname;
      const proxyPort = parseInt(proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80"), 10);
      let proxySocket;
      const connectToProxy = () => {
        if (proxyUrl.protocol === "https:") {
          const socket = tls.connect({
            host: proxyHost,
            port: proxyPort,
            rejectUnauthorized: rejectUnauthorized !== false
          });
          proxySocket = creation ? creation.track(socket) : socket;
        } else {
          const socket = net.connect({
            host: proxyHost,
            port: proxyPort
          });
          proxySocket = creation ? creation.track(socket) : socket;
        }
        let settled = false;
        const connectBudget = remainingUntil(establishmentDeadlineAt);
        const timeoutId = connectBudget !== undefined ? setTimeout(() => {
          if (!settled) {
            settled = true;
            proxySocket.destroy();
            reject(markSessionConnectTimeout(new Error(`Proxy connection timeout after ${connectBudget}ms`)));
          }
        }, connectBudget) : null;
        proxySocket.on("error", (err) => {
          if (!settled) {
            settled = true;
            if (timeoutId)
              clearTimeout(timeoutId);
            reject(new Error(`Proxy connection error: ${err.message}`));
          }
        });
        const rejectPrematureProxyClose = () => {
          if (settled)
            return;
          settled = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          reject(new Error("Proxy connection closed before CONNECT completed"));
        };
        proxySocket.once("end", rejectPrematureProxyClose);
        proxySocket.once("close", rejectPrematureProxyClose);
        proxySocket.on("connect", () => {
          const connectHeaders = [
            `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
            `Host: ${targetHost}:${targetPort}`
          ];
          if (proxyAuth) {
            connectHeaders.push(`Proxy-Authorization: Basic ${proxyAuth}`);
          }
          const connectRequest = `${connectHeaders.join(`\r
`)}\r
\r
`;
          proxySocket.write(connectRequest);
        });
        let responseBuffer = Buffer.alloc(0);
        proxySocket.on("data", function onData(data) {
          if (settled)
            return;
          responseBuffer = Buffer.concat([responseBuffer, data]);
          const headerEnd = responseBuffer.indexOf(`\r
\r
`);
          if (headerEnd !== -1) {
            settled = true;
            if (timeoutId)
              clearTimeout(timeoutId);
            proxySocket.pause();
            proxySocket.removeListener("data", onData);
            const statusLine = responseBuffer.subarray(0, headerEnd).toString("latin1").split(`\r
`)[0];
            const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d{3})/);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
            if (statusCode === 200) {
              const tunnelRemainder = responseBuffer.subarray(headerEnd + 4);
              if (tunnelRemainder.length > 0) {
                proxySocket.unshift(tunnelRemainder);
              }
              if (url.protocol === "https:") {
                const tlsSocket = creation ? creation.track(tls.connect({
                  socket: proxySocket,
                  host: targetHost,
                  servername: targetHost,
                  rejectUnauthorized: rejectUnauthorized !== false,
                  ALPNProtocols: ["h2", "http/1.1"],
                  ...stealthTlsOpts
                })) : tls.connect({
                  socket: proxySocket,
                  host: targetHost,
                  servername: targetHost,
                  rejectUnauthorized: rejectUnauthorized !== false,
                  ALPNProtocols: ["h2", "http/1.1"],
                  ...stealthTlsOpts
                });
                tlsSocket.setMaxListeners(20);
                let tlsSettled = false;
                const tlsBudget = remainingUntil(establishmentDeadlineAt);
                const tlsTimeoutId = tlsBudget !== undefined ? setTimeout(() => {
                  if (tlsSettled)
                    return;
                  tlsSettled = true;
                  tlsSocket.destroy();
                  reject(markSessionConnectTimeout(new Error(`TLS handshake timeout after ${tlsBudget}ms`)));
                }, tlsBudget) : null;
                tlsSocket.on("secureConnect", () => {
                  if (tlsSettled)
                    return;
                  tlsSettled = true;
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
                  if (tlsSettled)
                    return;
                  tlsSettled = true;
                  if (tlsTimeoutId)
                    clearTimeout(tlsTimeoutId);
                  reject(new Error(`TLS handshake failed: ${err.message}`));
                });
                tlsSocket.on("close", () => {
                  if (tlsSettled)
                    return;
                  tlsSettled = true;
                  if (tlsTimeoutId)
                    clearTimeout(tlsTimeoutId);
                  reject(new Error("TLS handshake closed before completion"));
                });
                proxySocket.resume();
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
    const targets = H2_SESSION_RELEASE_TARGETS.get(this);
    const exactSession = targets?.[targets.length - 1];
    if (exactSession) {
      const exactEntry = this.entriesBySession.get(exactSession);
      if (exactEntry)
        this.releaseSessionEntry(exactEntry);
      return;
    }
    const current = this.sessions.get(key);
    if (current && current.refCount > 0) {
      this.releaseSessionEntry(current);
      return;
    }
    const outstanding = [...this.entriesBySession.values()].find((entry) => Http2SessionPool.keyMatches(entry.key, key) && entry.refCount > 0);
    if (outstanding)
      this.releaseSessionEntry(outstanding);
  }
  closeSession(url, proxy) {
    const key = this.getSessionKey(url, undefined, proxy);
    for (const poolKey of new Set([key, ...[...this.sessions.keys()].filter((candidate) => Http2SessionPool.keyMatches(candidate, key))])) {
      this.keyEpochs.set(poolKey, (this.keyEpochs.get(poolKey) ?? 0) + 1);
    }
    for (const creation of this.pendingCreations) {
      if (Http2SessionPool.keyMatches(creation.key, key))
        creation.cancel();
    }
    for (const entry of [...this.entriesBySession.values()]) {
      if (Http2SessionPool.keyMatches(entry.key, key))
        this.closeSessionEntry(entry);
    }
  }
  closeAllSessions() {
    this.poolEpoch++;
    for (const creation of this.pendingCreations)
      creation.cancel();
    const entries = [...this.entriesBySession.values()];
    this.sessions.clear();
    for (const entry of entries)
      this.closeSessionEntry(entry);
    this.entriesBySession.clear();
  }
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.closeAllSessions();
  }
}
function releaseExactH2SessionLease(pool, url, proxy, session) {
  let targets = H2_SESSION_RELEASE_TARGETS.get(pool);
  if (!targets) {
    targets = [];
    H2_SESSION_RELEASE_TARGETS.set(pool, targets);
  }
  targets.push(session);
  try {
    pool.releaseSession(url, proxy);
  } finally {
    targets.pop();
    if (targets.length === 0)
      H2_SESSION_RELEASE_TARGETS.delete(pool);
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
function createH2CookiesSnapshot(cookies) {
  const array = [...cookies];
  const netscapeRows = array.map((cookie) => cookie.toNetscapeFormat());
  return {
    array,
    serialized: array.map((cookie) => cookie.toJSON()),
    netscape: [
      "# Netscape HTTP Cookie File",
      "# This file was generated by Rezo HTTP client",
      ...netscapeRows
    ].join(`
`) + (netscapeRows.length === 0 ? `
` : ""),
    string: array.map((cookie) => cookie.cookieString()).join("; "),
    setCookiesString: array.map((cookie) => cookie.toSetCookieString())
  };
}
function cloneH2CookieForHook(cookie) {
  const parsed = Cookie.fromJSON(cookie.toJSON());
  return new Cookie(parsed ?? undefined);
}
function cloneH2CookieJarForHook(jar) {
  const clone = new RezoCookieJar;
  for (const sourceCookie of jar.cookies().array) {
    const cookie = cloneH2CookieForHook(sourceCookie);
    const url = cookie.getURL();
    if (url)
      clone.setCookieSync(cookie.toSetCookieString(), url);
  }
  return clone;
}
function cloneH2PlainHookValue(value, seen = new WeakMap) {
  if (value === null || typeof value !== "object")
    return value;
  if (value instanceof Date)
    return new Date(value.getTime());
  if (value instanceof URL)
    return new URL(value.href);
  if (Buffer.isBuffer(value))
    return Buffer.from(value);
  if (value instanceof ArrayBuffer)
    return value.slice(0);
  const existing = seen.get(value);
  if (existing !== undefined)
    return existing;
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    for (const item of value)
      clone.push(cloneH2PlainHookValue(item, seen));
    return clone;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const clone = Object.create(prototype);
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor)
      continue;
    if ("value" in descriptor) {
      descriptor.value = cloneH2PlainHookValue(descriptor.value, seen);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone;
}
function cloneH2RequestForHook(request) {
  const cloned = cloneH2PlainHookValue(request);
  if (request.headers)
    cloned.headers = new RezoHeaders(request.headers);
  if (request.url instanceof URL)
    cloned.url = new URL(request.url.href);
  if (request.jar instanceof RezoCookieJar) {
    cloned.jar = cloneH2CookieJarForHook(request.jar);
  }
  return cloned;
}
function createH2RateLimitHookConfig(config, jar) {
  const detachedConfig = cloneH2PlainHookValue(config);
  const requestCookies = (config.requestCookies || []).map(cloneH2CookieForHook);
  const responseCookies = createH2CookiesSnapshot((config.responseCookies?.array || []).map(cloneH2CookieForHook));
  return {
    ...detachedConfig,
    headers: new RezoHeaders(config.headers),
    jar: cloneH2CookieJarForHook(jar),
    originalRequest: cloneH2RequestForHook(config.originalRequest),
    requestCookies,
    responseCookies,
    redirectHistory: (config.redirectHistory || []).map((entry) => ({
      ...entry,
      cookies: (entry.cookies || []).map(cloneH2CookieForHook),
      headers: new RezoHeaders(entry.headers),
      request: cloneH2RequestForHook(entry.request)
    })),
    timing: { ...config.timing },
    network: { ...config.network },
    transfer: { ...config.transfer },
    errors: (config.errors || []).map((entry) => ({ ...entry })),
    security: { ...config.security },
    adapterMetadata: config.adapterMetadata ? {
      ...config.adapterMetadata,
      features: config.adapterMetadata.features ? [...config.adapterMetadata.features] : undefined,
      capabilities: config.adapterMetadata.capabilities ? { ...config.adapterMetadata.capabilities } : undefined
    } : undefined,
    trackingData: config.trackingData ? { ...config.trackingData } : undefined
  };
}
function h2CookieIdentity(cookie) {
  return `${cookie.key}|${cookie.domain || ""}|${cookie.path || ""}`;
}
async function updateCookies(config, headers, url, rootJar, isRequestActive = () => true) {
  if (!isRequestActive())
    return;
  const setCookieHeaders = headers["set-cookie"];
  if (!setCookieHeaders)
    return;
  const cookieHeaderArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  if (cookieHeaderArray.length === 0)
    return;
  const parsedCookies = [];
  for (const raw of cookieHeaderArray) {
    const singleJar = new RezoCookieJar;
    try {
      singleJar.setCookiesSync([raw], url);
      const parsed = singleJar.cookies().array[0];
      if (parsed)
        parsedCookies.push(parsed);
    } catch {}
  }
  const acceptedCookies = [];
  const acceptedSetCookies = [];
  let hookError = null;
  if (config.hooks?.beforeCookie && config.hooks.beforeCookie.length > 0) {
    for (const cookie of parsedCookies) {
      if (!isRequestActive())
        return;
      let shouldAccept = true;
      for (const hook of config.hooks.beforeCookie) {
        try {
          const result = await hook({
            cookie,
            source: "response",
            url,
            isValid: true
          }, config);
          if (!isRequestActive())
            return;
          if (result === false) {
            shouldAccept = false;
            break;
          }
        } catch (err) {
          if (!isRequestActive())
            return;
          hookError = err;
          if (config.debug) {
            console.log("[Rezo Debug] beforeCookie hook error:", err);
          }
        }
      }
      if (shouldAccept) {
        acceptedCookies.push(cookie);
        acceptedSetCookies.push(cookie.toSetCookieString());
      }
    }
  } else {
    for (const cookie of parsedCookies) {
      acceptedCookies.push(cookie);
      acceptedSetCookies.push(cookie.toSetCookieString());
    }
  }
  if (!isRequestActive())
    return;
  const jarToSync = rootJar || config.jar;
  if (!config.disableJar && jarToSync) {
    jarToSync.setCookiesSync(acceptedSetCookies, url);
  }
  const existingArray = [...config.responseCookies?.array || []];
  for (const cookie of acceptedCookies) {
    const identity = h2CookieIdentity(cookie);
    const existingIndex = existingArray.findIndex((candidate) => h2CookieIdentity(candidate) === identity);
    if (existingIndex >= 0) {
      existingArray[existingIndex] = cookie;
    } else {
      existingArray.push(cookie);
    }
  }
  config.responseCookies = createH2CookiesSnapshot(existingArray);
  if (!hookError && config.hooks?.afterCookie && config.hooks.afterCookie.length > 0) {
    for (const hook of config.hooks.afterCookie) {
      if (!isRequestActive())
        return;
      try {
        await hook(acceptedCookies, config);
      } catch (err) {
        if (!isRequestActive())
          return;
        if (config.debug) {
          console.log("[Rezo Debug] afterCookie hook error:", err);
        }
      }
    }
  }
}
function mergeRequestAndResponseCookies(config, responseCookies) {
  const mergedCookiesArray = [];
  const cookieKeyDomainMap = new Map;
  if (config.requestCookies && config.requestCookies.length > 0) {
    for (const cookie of config.requestCookies) {
      const key = h2CookieIdentity(cookie);
      mergedCookiesArray.push(cookie);
      cookieKeyDomainMap.set(key, mergedCookiesArray.length - 1);
    }
  }
  for (const cookie of responseCookies.array) {
    const key = h2CookieIdentity(cookie);
    const existingIndex = cookieKeyDomainMap.get(key);
    if (existingIndex !== undefined) {
      mergedCookiesArray[existingIndex] = cookie;
    } else {
      mergedCookiesArray.push(cookie);
      cookieKeyDomainMap.set(key, mergedCookiesArray.length - 1);
    }
  }
  return createH2CookiesSnapshot(mergedCookiesArray);
}
export async function executeRequest(options, defaultOptions, jar) {
  const coreDispatchIdentity = options;
  const canonicalResponseType = resolveResponseType(options.responseType, defaultOptions?.responseType, options);
  if (options.responseType !== canonicalResponseType) {
    options = { ...options, responseType: canonicalResponseType };
  }
  assertInputTransport(options, defaultOptions, "http2");
  const requestEntryStartedAt = performance.now();
  const internalRetryState = options;
  const inheritedProxyRetryCount = internalRetryState[H2_PROXY_RETRY_COUNT] ?? 0;
  const selectedRetryProxy = internalRetryState[H2_PROXY_RETRY_SELECTED] ?? null;
  const inheritedProxyFailures = internalRetryState[H2_PROXY_RETRY_FAILURES] ?? [];
  const inheritedLogicalLifetime = internalRetryState[H2_LOGICAL_REQUEST_LIFETIME];
  delete internalRetryState[H2_PROXY_RETRY_COUNT];
  delete internalRetryState[H2_PROXY_RETRY_SELECTED];
  delete internalRetryState[H2_PROXY_RETRY_FAILURES];
  delete internalRetryState[H2_LOGICAL_REQUEST_LIFETIME];
  const callerOptions = options;
  const normalizedRequest = normalizeH2Request(options, defaultOptions);
  options = normalizedRequest.options;
  const effectiveJar = options.jar instanceof RezoCookieJar ? options.jar : jar;
  const effectiveDisableJar = options.disableJar ?? defaultOptions.disableJar ?? false;
  const coreDefaults = defaultOptions;
  const d_options = {
    ...await getDefaultConfig(defaultOptions, coreDefaults._proxyManager),
    validateStatus: defaultOptions.validateStatus
  };
  const preparationDefaults = {
    ...d_options,
    headers: undefined,
    disableJar: effectiveDisableJar,
    useCookies: effectiveDisableJar ? false : d_options.useCookies
  };
  const configResult = prepareHTTPOptions(options, effectiveJar, {
    defaultOptions: preparationDefaults
  });
  const preparedHeaders = configResult.fetchOptions?.headers instanceof RezoHeaders ? prepareRedirectHeaders(configResult.fetchOptions.headers, "same-origin") : prepareRedirectHeaders(new RezoHeaders(configResult.fetchOptions?.headers || {}), "same-origin");
  if (normalizedRequest.literalCookie) {
    const sourceJarCookie = preparedHeaders.get("cookie");
    const cookie = mergeH2CookieLayers(normalizedRequest.literalCookie, sourceJarCookie);
    if (cookie)
      preparedHeaders.set("cookie", cookie);
  }
  preparedHeaders.delete("proxy-authorization");
  configResult.fetchOptions.headers = preparedHeaders;
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  const { proxyManager } = configResult;
  const logicalLifetime = inheritedLogicalLifetime ?? {
    startedAt: requestEntryStartedAt,
    deadline: createH2RequestDeadline(fetchOptions.timeout, requestEntryStartedAt),
    abortNotified: false
  };
  const notifyFinalAbort = (error) => {
    if (!isH2AbortOrTimeoutError(error) || logicalLifetime.abortNotified)
      return;
    logicalLifetime.abortNotified = true;
    notifyH2AbortHooks(error, mainConfig, fetchOptions, logicalLifetime.startedAt);
  };
  updateH2RequestCookieDiagnostics(mainConfig, preparedHeaders, String(fetchOptions.fullUrl || fetchOptions.url || ""));
  const perform = new RezoPerformance;
  let selectedProxy = null;
  if (proxyManager) {
    const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    selectedProxy = selectedRetryProxy || proxyManager.next(requestUrl);
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
  let cacheIdentityHeaders;
  let cachedEntry;
  let _needsRevalidation = false;
  if (cacheOption && !takeCoreCacheOwnership(coreDispatchIdentity)) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
    cacheIdentityHeaders = { ...requestHeaders };
    cachedEntry = cache.get(method, requestUrl, requestHeaders);
    if (cachedEntry) {
      const cacheControl = parseCacheControlFromHeaders(cachedEntry.headers);
      if (cacheControl.noCache || cacheControl.mustRevalidate) {
        _needsRevalidation = true;
        fetchOptions._acceptNotModified = true;
      } else {
        return buildCachedRezoResponse(cachedEntry, mainConfig);
      }
    }
    const conditionalHeaders = cache.getConditionalHeaders(method, requestUrl, requestHeaders);
    if (conditionalHeaders) {
      const headers = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
      for (const [name, value] of Object.entries(conditionalHeaders)) {
        headers.set(name, value);
      }
      fetchOptions.headers = headers;
    }
  }
  const redirectBaseHeaders = fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : new RezoHeaders(fetchOptions.headers || {});
  redirectBaseHeaders.delete("cookie");
  if (options.xsrfHeaderName) {
    if (normalizedRequest.originHeaders.has(options.xsrfHeaderName)) {
      redirectBaseHeaders.set(options.xsrfHeaderName, normalizedRequest.originHeaders.get(options.xsrfHeaderName) || "");
    } else {
      redirectBaseHeaders.delete(options.xsrfHeaderName);
    }
  }
  if (normalizedRequest.literalCookie) {
    redirectBaseHeaders.set("cookie", normalizedRequest.literalCookie);
  }
  redirectBaseHeaders.delete("proxy-authorization");
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
    const res = executeHttp2Request(fetchOptions, mainConfig, options, callerOptions, perform, effectiveJar, redirectBaseHeaders, logicalLifetime, fs, streamResponse, downloadResponse, uploadResponse);
    if (streamResponse) {
      res.catch((err) => {
        notifyFinalAbort(err);
        debugErrorDump(mainConfig, err);
        settleFacadeError(mainConfig.hooks, streamResponse, err);
      });
      return streamResponse;
    } else if (downloadResponse) {
      res.catch((err) => {
        notifyFinalAbort(err);
        debugErrorDump(mainConfig, err);
        settleFacadeError(mainConfig.hooks, downloadResponse, err);
      });
      return downloadResponse;
    } else if (uploadResponse) {
      res.catch((err) => {
        notifyFinalAbort(err);
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
  } catch (caughtError) {
    let error = caughtError;
    if (proxyManager && selectedProxy) {
      proxyManager.reportFailure(selectedProxy, error);
      if (proxyManager.config.retryWithNextProxy && !isH2AbortOrTimeoutError(error)) {
        try {
          await awaitH2Deadline(() => Promise.resolve(), logicalLifetime.deadline, mainConfig, fetchOptions, "proxy retry selection");
        } catch (lifetimeError) {
          error = lifetimeError;
        }
        const maxRetries = proxyManager.config.maxProxyRetries ?? 3;
        const attempt = inheritedProxyRetryCount + 1;
        if (!isH2AbortOrTimeoutError(error) && attempt <= maxRetries && proxyManager.hasAvailableProxies()) {
          const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
          const nextProxy = selectProxyForRetry(proxyManager, requestUrl, [...inheritedProxyFailures, selectedProxy], attempt);
          if (!nextProxy)
            throw error;
          const retryOptions = { ...callerOptions };
          Object.defineProperties(retryOptions, {
            [H2_PROXY_RETRY_COUNT]: {
              configurable: true,
              value: attempt
            },
            [H2_PROXY_RETRY_SELECTED]: {
              configurable: true,
              value: nextProxy
            },
            [H2_PROXY_RETRY_FAILURES]: {
              configurable: true,
              value: [...inheritedProxyFailures, selectedProxy]
            },
            [H2_LOGICAL_REQUEST_LIFETIME]: {
              configurable: true,
              value: logicalLifetime
            }
          });
          delete retryOptions.proxy;
          return executeRequest(retryOptions, defaultOptions, jar);
        }
      }
    }
    notifyFinalAbort(error);
    debugErrorDump(mainConfig, error);
    throw error;
  }
}
async function executeHttp2Request(fetchOptions, config, options, callerOptions, perform, rootJar, initialCleanBase, logicalLifetime, fs, streamResult, downloadResult, uploadResult) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
  let responseStatusCode;
  let retryAttempt = 0;
  const retryConfig = config?.retry;
  const startTime = logicalLifetime.startedAt;
  const h2Deadline = logicalLifetime.deadline;
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
  try {
    const initialPolicy = createRedirectHeaderPolicyState(requestUrl);
    if (!initialPolicy.ok) {
      throw new RezoError("Invalid HTTP/2 request URL", config, "ERR_INVALID_URL", fetchOptions);
    }
    let h2PolicyState = initialPolicy.state;
    let h2CleanBase = new RezoHeaders(initialCleanBase);
    let h2SuppressJarCookie = false;
    while (true) {
      totalAttempts++;
      let redirectCallbackThrew = false;
      let redirectCallbackThrownValue;
      if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
        const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
        throw error;
      }
      try {
        const response = await executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool, rootJar, h2Deadline, totalAttempts === 1, (status) => statusAttemptContinues(status, retryConfig, retryAttempt, options.waitOnStatus));
        const statusOnNext = _stats.statusOnNext;
        if (response instanceof RezoError) {
          if (!config.errors)
            config.errors = [];
          config.errors.push({
            attempt: config.retryAttempts + 1,
            error: response,
            duration: perform.now()
          });
          if (!retryConfig) {
            throw response;
          }
          const method = fetchOptions.method || "GET";
          retryAttempt++;
          if (retryAttempt > retryConfig.maxRetries) {
            debugLog.maxRetries(config, retryConfig.maxRetries);
            if (retryConfig.onRetryExhausted) {
              await awaitH2Deadline(() => retryConfig.onRetryExhausted(response, retryAttempt), h2Deadline, config, fetchOptions, "onRetryExhausted callback");
            }
            throw response;
          }
          if (retryConfig.condition) {
            const shouldContinue = await awaitH2Deadline(() => retryConfig.condition(response, retryAttempt), h2Deadline, config, fetchOptions, "retry condition");
            if (shouldContinue === false) {
              if (retryConfig.onRetryExhausted) {
                await awaitH2Deadline(() => retryConfig.onRetryExhausted(response, retryAttempt), h2Deadline, config, fetchOptions, "onRetryExhausted callback");
              }
              throw response;
            }
          } else {
            const canRetry = shouldRetry(response, retryAttempt, method, retryConfig);
            if (!canRetry) {
              if (retryAttempt > retryConfig.maxRetries) {
                debugLog.maxRetries(config, retryConfig.maxRetries);
                if (retryConfig.onRetryExhausted) {
                  await awaitH2Deadline(() => retryConfig.onRetryExhausted(response, retryAttempt), h2Deadline, config, fetchOptions, "onRetryExhausted callback");
                }
              }
              throw response;
            }
          }
          const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
          debugLog.retry(config, retryAttempt, retryConfig.maxRetries, responseStatusCode || 0, currentDelay);
          if (retryConfig.onRetry) {
            const shouldProceed = await awaitH2Deadline(() => retryConfig.onRetry(response, retryAttempt, currentDelay), h2Deadline, config, fetchOptions, "onRetry callback");
            if (shouldProceed === false) {
              throw response;
            }
          }
          if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
            for (const hook of config.hooks.beforeRetry) {
              await awaitH2Deadline(() => hook(config, response, retryAttempt), h2Deadline, config, fetchOptions, "beforeRetry hook");
            }
          }
          await waitForH2Delay(currentDelay, h2Deadline, config, fetchOptions, "retry delay");
          refreshH2DestinationHeaders(config, fetchOptions, h2PolicyState, h2CleanBase, rootJar, options.xsrfCookieName, options.xsrfHeaderName, h2SuppressJarCookie);
          config.retryAttempts++;
          perform.reset();
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
            const rateLimitHookConfig = createH2RateLimitHookConfig(config, rootJar);
            const rateLimitStageController = new AbortController;
            let rateLimitStageActive = true;
            let waitResult;
            try {
              waitResult = await awaitH2Deadline(() => handleRateLimitWait({
                status: response.status,
                headers: response.headers,
                data: response.data,
                url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
                method: fetchOptions.method || "GET",
                config,
                options,
                currentWaitAttempt: rateLimitWaitAttempt,
                hookConfig: rateLimitHookConfig,
                signal: rateLimitStageController.signal,
                isActive: () => rateLimitStageActive
              }), h2Deadline, config, fetchOptions, "rate-limit wait");
            } finally {
              rateLimitStageActive = false;
              rateLimitStageController.abort();
            }
            if (waitResult.shouldRetry) {
              config._rateLimitWaitAttempt = waitResult.waitAttempt;
              _stats.deferredHeaderEvents = undefined;
              refreshH2DestinationHeaders(config, fetchOptions, h2PolicyState, h2CleanBase, rootJar, options.xsrfCookieName, options.xsrfHeaderName, h2SuppressJarCookie);
              continue;
            }
          }
          const httpError = RezoError.createHttpError(response.status, config, fetchOptions, response);
          if (retryConfig && retryConfig.statusCodes?.includes(response.status)) {
            retryAttempt++;
            if (retryAttempt <= retryConfig.maxRetries) {
              const failedAttemptDuration = perform.now();
              const method = fetchOptions.method || "GET";
              const retryAllowed = retryConfig.condition ? await awaitH2Deadline(() => retryConfig.condition(httpError, retryAttempt), h2Deadline, config, fetchOptions, "retry condition") : shouldRetry(httpError, retryAttempt, method, retryConfig);
              if (!retryAllowed) {
                _stats.deferredHeaderEvents?.();
                _stats.deferredHeaderEvents = undefined;
                throw httpError;
              }
              const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
              if (config.debug) {
                console.log(`Request failed with status code ${response.status}, retrying...${currentDelay > 0 ? " in " + currentDelay + "ms" : ""}`);
              }
              if (retryConfig.onRetry) {
                const shouldProceed = await awaitH2Deadline(() => retryConfig.onRetry(httpError, retryAttempt, currentDelay), h2Deadline, config, fetchOptions, "onRetry callback");
                if (shouldProceed === false) {
                  _stats.deferredHeaderEvents?.();
                  _stats.deferredHeaderEvents = undefined;
                  throw httpError;
                }
              }
              if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
                for (const hook of config.hooks.beforeRetry) {
                  await awaitH2Deadline(() => hook(config, httpError, retryAttempt), h2Deadline, config, fetchOptions, "beforeRetry hook");
                }
              }
              await waitForH2Delay(currentDelay, h2Deadline, config, fetchOptions, "retry delay");
              refreshH2DestinationHeaders(config, fetchOptions, h2PolicyState, h2CleanBase, rootJar, options.xsrfCookieName, options.xsrfHeaderName, h2SuppressJarCookie);
              config.retryAttempts++;
              if (!config.errors)
                config.errors = [];
              config.errors.push({
                attempt: config.retryAttempts,
                error: httpError,
                duration: failedAttemptDuration
              });
              perform.reset();
              _stats.deferredHeaderEvents = undefined;
              continue;
            }
          }
          _stats.deferredHeaderEvents?.();
          _stats.deferredHeaderEvents = undefined;
          throw httpError;
        }
        if (statusOnNext === "redirect") {
          if (config.maxRedirects === 0) {
            config.maxRedirectsReached = true;
            throw buildRedirectControlError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
          }
          if (fetchOptions.followRedirects === false) {
            const validateStatus = fetchOptions.validateStatus;
            let manualRedirectAccepted = true;
            if (validateStatus !== undefined && validateStatus !== null) {
              try {
                manualRedirectAccepted = validateStatus(response.status) === true;
              } catch (thrown) {
                throw buildH2CallbackFailure(thrown, config, fetchOptions);
              }
            }
            if (!manualRedirectAccepted) {
              throw RezoError.createHttpError(response.status, config, fetchOptions, response);
            }
            const manualDurations = getTimingDurations(config);
            const manualFinalUrl = response.finalUrl || String(fetchOptions.fullUrl || fetchOptions.url);
            if (streamResult && !streamResult.isFinished()) {
              const terminal = { status: response.status, statusText: response.statusText, headers: response.headers, contentType: response.contentType || undefined, contentLength: 0, finalUrl: manualFinalUrl, cookies: response.cookies, urls: response.urls, timing: manualDurations, config: sanitizeConfig(config) };
              streamResult.emit("end");
              streamResult.emit("finish", terminal);
              streamResult.emit("done", terminal);
              streamResult.emit("complete", terminal);
              streamResult._markFinished();
              streamResult.end();
            } else if (downloadResult && !downloadResult.isFinished()) {
              const terminal = { status: response.status, statusText: response.statusText, headers: response.headers, contentType: response.contentType || "", contentLength: 0, finalUrl: manualFinalUrl, cookies: response.cookies, urls: response.urls, fileName: downloadResult.fileName, fileSize: 0, timing: { ...manualDurations, download: manualDurations.download || 0 }, averageSpeed: 0, config: sanitizeConfig(config) };
              downloadResult.emit("finish", terminal);
              downloadResult.emit("done", terminal);
              downloadResult.emit("complete", terminal);
              downloadResult._markFinished();
            } else if (uploadResult && !uploadResult.isFinished()) {
              const terminal = { response: { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data, contentType: response.contentType || "", contentLength: 0 }, finalUrl: manualFinalUrl, cookies: response.cookies, urls: response.urls, uploadSize: config.transfer?.requestSize || 0, fileName: uploadResult.fileName, timing: { ...manualDurations, upload: manualDurations.firstByte || 0, waiting: 0 }, averageUploadSpeed: 0, averageDownloadSpeed: 0, config: sanitizeConfig(config) };
              uploadResult.emit("finish", terminal);
              uploadResult.emit("done", terminal);
              uploadResult.emit("complete", terminal);
              uploadResult._markFinished();
            }
            return response;
          }
          const location = _stats.redirectUrl;
          if (!location) {
            throw buildRedirectControlError("Redirect location not found", config, "REZ_MISSING_REDIRECT_LOCATION", fetchOptions, response);
          }
          const redirectCode = response.status;
          const fromUrl = String(fetchOptions.fullUrl);
          let redirectUrl;
          try {
            redirectUrl = new URL(location, fromUrl);
            const sourceUrl = new URL(fromUrl);
            if (!redirectUrl.hash && sourceUrl.hash)
              redirectUrl.hash = sourceUrl.hash;
          } catch {
            throw new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
          }
          const sourceHeaders = fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : new RezoHeaders(fetchOptions.headers ?? {});
          if (!(fetchOptions.headers instanceof RezoHeaders)) {
            fetchOptions.headers = new RezoHeaders(sourceHeaders);
          }
          const sourceRequestSnapshot = {
            ...fetchOptions,
            headers: new RezoHeaders(sourceHeaders)
          };
          let redirectRequestStage = fetchOptions;
          const redirectBaseBeforeHooks = new RezoHeaders(h2CleanBase);
          const restoreSourceHeaders = () => {
            fetchOptions.headers = new RezoHeaders(sourceHeaders);
          };
          const hookHeaderOperations = [];
          let hookCarrierReplacement;
          const redirectFacade = streamResult || downloadResult || uploadResult;
          if (redirectFacade) {
            const hopHeaders = new RezoHeaders(response.headers);
            hopHeaders.delete("set-cookie");
            const redirectEvent = {
              sourceUrl: String(fetchOptions.fullUrl || fetchOptions.url),
              sourceStatus: response.status,
              sourceStatusText: response.statusText,
              destinationUrl: absoluteRedirectDestination(location, String(fetchOptions.fullUrl || fetchOptions.url)),
              redirectCount: config.redirectCount + 1,
              maxRedirects: config.maxRedirects,
              headers: hopHeaders,
              cookies: response.cookies?.array ?? [],
              method: String(fetchOptions.method || "GET").toUpperCase(),
              timestamp: performance.now(),
              duration: 0
            };
            redirectFacade.emit("redirect", redirectEvent);
          }
          if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
            redirectRequestStage = {
              ...fetchOptions,
              url: fetchOptions.url instanceof URL ? new URL(fetchOptions.url.href) : fetchOptions.url,
              headers: new RezoHeaders(sourceHeaders)
            };
            const hookCarrier = redirectRequestStage.headers;
            const hookRecorder = createH2HookHeaderRecorder(hookCarrier, hookHeaderOperations);
            redirectRequestStage.headers = hookRecorder;
            try {
              const redirectContext = {
                redirectUrl,
                fromUrl,
                status: response.status,
                headers: response.headers,
                sameDomain: isSameDomain(fromUrl, redirectUrl.href),
                method: redirectRequestStage.method.toUpperCase(),
                body: redirectRequestStage.body ?? config.originalBody,
                request: redirectRequestStage,
                redirectCount: config.redirectCount,
                timestamp: Date.now()
              };
              await awaitH2HookStage(async () => {
                for (const hook of config.hooks.beforeRedirect) {
                  await hook(redirectContext, config, response);
                }
              }, config, fetchOptions, "beforeRedirect hooks", h2Deadline);
            } catch (error) {
              restoreSourceHeaders();
              throw error;
            }
            const afterHooks = redirectRequestStage.headers;
            if (afterHooks === hookRecorder) {
              redirectRequestStage.headers = hookCarrier;
            } else {
              hookCarrierReplacement = afterHooks instanceof RezoHeaders ? afterHooks : new RezoHeaders(afterHooks ?? {});
              redirectRequestStage.headers = hookCarrierReplacement;
            }
          }
          const redirectCallback = config.beforeRedirect || config.onRedirect;
          let onRedirect;
          try {
            onRedirect = redirectCallback ? redirectCallback({
              url: redirectUrl,
              status: response.status,
              headers: response.headers,
              sameDomain: isSameDomain(fromUrl, redirectUrl.href),
              method: redirectRequestStage.method.toUpperCase(),
              body: redirectRequestStage.body ?? config.originalBody
            }) : undefined;
          } catch (error) {
            restoreSourceHeaders();
            redirectCallbackThrew = true;
            redirectCallbackThrownValue = error;
            throw error;
          }
          if (typeof onRedirect !== "undefined") {
            if (typeof onRedirect === "boolean" && !onRedirect) {
              restoreSourceHeaders();
              throw buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
            }
            if (onRedirect !== null && typeof onRedirect === "object" && !onRedirect.redirect && !onRedirect.withoutBody && !("body" in onRedirect)) {
              restoreSourceHeaders();
              throw buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
            }
          }
          if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
            restoreSourceHeaders();
            config.maxRedirectsReached = true;
            throw buildRedirectControlError(`Max redirects (${config.maxRedirects}) reached`, config, "REZ_MAX_REDIRECTS_EXCEEDED", fetchOptions, response);
          }
          const normalizedRedirect = onRedirect !== null && typeof onRedirect === "object" ? onRedirect.redirect || onRedirect.withoutBody || "body" in onRedirect : undefined;
          const requestedTarget = onRedirect !== null && typeof onRedirect === "object" && normalizedRedirect && onRedirect.redirect && onRedirect.url ? onRedirect.url : redirectUrl;
          const transition = stageRedirectHeaderTransition(h2PolicyState, {
            finalizedNormalizedUrl: requestedTarget,
            setHeaders: h2RedirectField(onRedirect, "setHeaders"),
            setHeadersOnRedirects: h2RedirectField(onRedirect, "setHeadersOnRedirects")
          });
          if (!transition.ok) {
            restoreSourceHeaders();
            const reason = transition.reason;
            throw new RezoError(reason === "invalid-url" ? "Invalid redirect destination URL" : `Invalid redirect header patch "${transition.field}"`, config, reason === "invalid-url" ? "ERR_INVALID_URL" : "ERR_INVALID_ARG_TYPE", fetchOptions, response);
          }
          const finalizedTargetUrl = transition.state.currentUrl;
          const relation = transition.relation;
          const enableCycleDetection = config.enableRedirectCycleDetection === true;
          const normalizedRedirectUrl = finalizedTargetUrl.toLowerCase();
          if (enableCycleDetection && visitedUrls.has(normalizedRedirectUrl)) {
            restoreSourceHeaders();
            throw buildRedirectControlError(`Redirect cycle detected: ${finalizedTargetUrl}`, config, "REZ_REDIRECT_CYCLE_DETECTED", fetchOptions, response);
          }
          const clearsRepresentation = onRedirect !== null && typeof onRedirect === "object" && normalizedRedirect ? Boolean(onRedirect.withoutBody || !("body" in onRedirect) && redirectCode !== 307 && redirectCode !== 308) : redirectCode === 301 || redirectCode === 302 || redirectCode === 303;
          let nextCleanBase = prepareRedirectHeaders(new RezoHeaders(redirectBaseBeforeHooks), relation);
          if (clearsRepresentation) {
            nextCleanBase.delete("Content-Type");
            nextCleanBase.delete("Content-Length");
          }
          if (hookCarrierReplacement) {
            nextCleanBase = new RezoHeaders(hookCarrierReplacement);
          } else {
            for (const operation of hookHeaderOperations) {
              if (operation.op === "delete")
                nextCleanBase.delete(operation.key);
              else if (operation.op === "append")
                nextCleanBase.append(operation.key, operation.value);
              else
                nextCleanBase.set(operation.key, operation.value);
            }
          }
          nextCleanBase.delete("proxy-authorization");
          const nextSuppressJarCookie = h2HookOwnsCookie(hookHeaderOperations, hookCarrierReplacement) || relation === "same-origin" && h2SuppressJarCookie;
          const destinationHeaders = createH2DestinationHeaders(config, rootJar, transition.state.currentUrl, nextCleanBase, options.xsrfCookieName, options.xsrfHeaderName, nextSuppressJarCookie);
          const nextHeaders = composeRedirectHeaders(transition.state, {
            targetBase: nextCleanBase,
            destinationHeaders
          });
          if (redirectRequestStage !== fetchOptions) {
            fetchOptions = redirectRequestStage;
            config.originalRequest = fetchOptions;
          }
          config.redirectHistory.push({
            url: fromUrl,
            statusCode: redirectCode,
            statusText: response.statusText,
            headers: response.headers,
            method: String(sourceRequestSnapshot.method).toUpperCase(),
            cookies: response.cookies.array,
            duration: perform.now(),
            request: sourceRequestSnapshot
          });
          perform.reset();
          config.redirectCount++;
          if (enableCycleDetection)
            visitedUrls.add(normalizedRedirectUrl);
          h2PolicyState = transition.state;
          h2CleanBase = nextCleanBase;
          h2SuppressJarCookie = nextSuppressJarCookie;
          fetchOptions.fullUrl = finalizedTargetUrl;
          fetchOptions.url = finalizedTargetUrl;
          fetchOptions.headers = nextHeaders;
          options.fullUrl = finalizedTargetUrl;
          options.url = finalizedTargetUrl;
          callerOptions.fullUrl = finalizedTargetUrl;
          callerOptions.url = finalizedTargetUrl;
          updateH2RequestCookieDiagnostics(config, nextHeaders, finalizedTargetUrl);
          config.finalUrl = finalizedTargetUrl;
          config.originalRequest = fetchOptions;
          delete options.params;
          delete callerOptions.params;
          if (onRedirect !== null && typeof onRedirect === "object" && normalizedRedirect) {
            let method;
            const userMethod = onRedirect.method;
            if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
              method = userMethod || "GET";
            } else {
              method = userMethod || fetchOptions.method;
            }
            config.method = method;
            options.method = method;
            callerOptions.method = method;
            fetchOptions.method = method;
            if (onRedirect.withoutBody) {
              delete options.body;
              delete callerOptions.body;
              delete fetchOptions.body;
              config.originalBody = undefined;
            } else if ("body" in onRedirect) {
              options.body = onRedirect.body;
              callerOptions.body = onRedirect.body;
              fetchOptions.body = onRedirect.body;
              config.originalBody = onRedirect.body;
            } else if (redirectCode === 307 || redirectCode === 308) {
              const methodUpper = method.toUpperCase();
              if ((methodUpper === "POST" || methodUpper === "PUT" || methodUpper === "PATCH") && config.originalBody !== undefined) {
                options.body = config.originalBody;
                callerOptions.body = config.originalBody;
                fetchOptions.body = config.originalBody;
              }
            } else {
              delete options.body;
              delete callerOptions.body;
              delete fetchOptions.body;
            }
            debugLog.redirect(config, fromUrl, finalizedTargetUrl, redirectCode, method);
          } else if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
            debugLog.redirect(config, fromUrl, finalizedTargetUrl, redirectCode, "GET");
            options.method = "GET";
            callerOptions.method = "GET";
            fetchOptions.method = "GET";
            config.method = "GET";
            delete options.body;
            delete callerOptions.body;
            delete fetchOptions.body;
          } else {
            debugLog.redirect(config, fromUrl, finalizedTargetUrl, redirectCode, fetchOptions.method);
          }
          if (relation !== "same-origin") {
            delete fetchOptions.auth;
            delete options.auth;
            delete callerOptions.auth;
            config.auth = null;
          }
          requestCount++;
          continue;
        }
        throw builErrorFromResponse("Unexpected state", response, config, fetchOptions);
      } catch (error) {
        if (redirectCallbackThrew && Object.is(error, redirectCallbackThrownValue)) {
          throw error;
        }
        if (error instanceof RezoError) {
          throw error;
        }
        throw buildSmartError(config, fetchOptions, error);
      }
    }
  } finally {
    if (_timeoutClearInstance !== undefined)
      clearTimeout(_timeoutClearInstance);
  }
}
async function executeHttp2Stream(config, fetchOptions, requestCount, timing, _stats, _responseStatusCode, fs, streamResult, downloadResult, uploadResult, sessionPool, rootJar, requestDeadline, isFirstAttempt = false, attemptContinuesAfterStatus = () => false) {
  return new Promise(async (resolve) => {
    let releaseSessionLease = () => {};
    try {
      const { fullUrl, body } = fetchOptions;
      assertNodeBodyAvailable(body, config, fetchOptions);
      const url = new URL(fullUrl || fetchOptions.url);
      const isSecure = url.protocol === "https:";
      const configuredStreamTimeout = resolveTimeoutMs(fetchOptions.timeout) ?? config.timeout ?? 30000;
      const fallbackStreamTimeout = configuredStreamTimeout > 0 ? configuredStreamTimeout : 30000;
      if (requestCount === 0) {
        config.adapterUsed = "http2";
        config.isSecure = isSecure;
        config.finalUrl = url.href;
        config.network.protocol = "h2";
      }
      const stealthProfile = fetchOptions._resolvedStealth;
      if (stealthProfile && (fetchOptions.httpsAgent || fetchOptions.httpAgent)) {
        throw new RezoError(`Stealth profile "${stealthProfile.profileId}" cannot ride a custom agent's TLS: remove httpAgent/httpsAgent or disable stealth for this request`, config, "REZ_UNSUPPORTED_CAPABILITY");
      }
      if (stealthProfile && fetchOptions.headers instanceof RezoHeaders) {
        for (const [name, value] of Object.entries(stealthProfile.extraHeaders.h2 ?? {})) {
          if (!fetchOptions.headers.has(name))
            fetchOptions.headers.set(name, value);
        }
      }
      const pseudoValues = {
        ":method": fetchOptions.method.toUpperCase(),
        ":path": url.pathname + url.search,
        ":scheme": url.protocol.replace(":", ""),
        ":authority": url.host
      };
      const headers = Object.create(null);
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
      const multipart = body instanceof RezoFormData || body instanceof FormData ? await awaitH2Deadline(() => encodeMultipartBody(body), requestDeadline, config, fetchOptions, "multipart body") : undefined;
      if (multipart) {
        if (headers["content-type"] === undefined)
          headers["content-type"] = multipart.contentType;
        headers["content-length"] = String(multipart.bytes.byteLength);
      }
      const eventEmitter = streamResult || downloadResult || uploadResult;
      if (eventEmitter && isFirstAttempt) {
        const startEvent = {
          url: url.toString(),
          method: fetchOptions.method.toUpperCase(),
          headers: new RezoHeaders(reqHeaders),
          timestamp: timing.startTime,
          timeout: resolveTimeoutMs(fetchOptions.timeout),
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
      const stagedPhases = parseStagedTimeouts(fetchOptions.timeout);
      const connectBudget = stagedPhases.connect && stagedPhases.connect > 0 ? stagedPhases.connect : undefined;
      const sessionStartedAt = performance.now();
      let connectBudgetBinding = false;
      try {
        const activeSessionPool = sessionPool || Http2SessionPool.getInstance();
        const acquiredSessionUrl = new URL(url.href);
        const acquiredSessionProxy = fetchOptions.proxy;
        const deadlineRemaining = getH2DeadlineRemaining(requestDeadline, config, fetchOptions, "HTTP/2 session") ?? fallbackStreamTimeout;
        connectBudgetBinding = connectBudget !== undefined && connectBudget <= deadlineRemaining;
        const sessionTimeout = connectBudgetBinding ? connectBudget : deadlineRemaining;
        let sessionPromise;
        try {
          session = await awaitH2Deadline(() => {
            sessionPromise = activeSessionPool.getSession(url, sessionOptions, sessionTimeout, forceNewSession, fetchOptions.proxy, stealthProfile, fetchOptions.signal ?? config.signal ?? undefined);
            return sessionPromise;
          }, requestDeadline, config, fetchOptions, "HTTP/2 session");
        } catch (error) {
          if (sessionPromise) {
            sessionPromise.then((acquiredSession) => releaseExactH2SessionLease(activeSessionPool, acquiredSessionUrl, acquiredSessionProxy, acquiredSession), () => {
              return;
            });
          }
          throw error;
        }
        let leaseReleased = false;
        releaseSessionLease = () => {
          if (leaseReleased)
            return;
          leaseReleased = true;
          releaseExactH2SessionLease(activeSessionPool, acquiredSessionUrl, acquiredSessionProxy, session);
        };
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session acquired successfully`);
        }
      } catch (err) {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session failed:`, err.message);
        }
        if (connectBudgetBinding && isSessionConnectTimeout(err)) {
          const elapsed = Math.max(connectBudget, Math.round(performance.now() - sessionStartedAt));
          const connectError = createStagedTimeoutError("connect", elapsed, config, fetchOptions);
          notifyH2TimeoutHooks(config, fetchOptions, "connect", elapsed);
          _stats.statusOnNext = "error";
          resolve(connectError);
          return;
        }
        const error = err instanceof RezoError ? err : buildSmartError(config, fetchOptions, err);
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
      let responseAccepted = false;
      let responseValidationFailure;
      let publishResponseEvents = false;
      let publishHeaderEvents = false;
      let timeoutId = null;
      let cookieUpdatePromise = Promise.resolve();
      let responseHeadersEventPromise = Promise.resolve();
      let responseBodyEventPromise = Promise.resolve();
      const requestSignal = fetchOptions.signal ?? config.signal ?? undefined;
      let signalAbortHandler;
      const sessionErrorHandler = (err) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Session error:`, err.message);
        }
        if (!resolved) {
          resolved = true;
          if (timeoutId)
            clearTimeout(timeoutId);
          cleanupSessionListeners();
          releaseSessionLease();
          const error = buildSmartError(config, fetchOptions, err);
          _stats.statusOnNext = "error";
          resolve(error);
        }
      };
      session.once("error", sessionErrorHandler);
      const cleanupSessionListeners = () => {
        session.removeListener("error", sessionErrorHandler);
        if (requestSignal && signalAbortHandler) {
          requestSignal.removeEventListener("abort", signalAbortHandler);
        }
      };
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: Creating request stream...`);
      }
      let req;
      let transportBody;
      try {
        transportBody = claimNodeBodyStream(body, config, fetchOptions);
        req = session.request(headers);
      } catch (err) {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Failed to create request stream:`, err.message);
        }
        session.removeListener("error", sessionErrorHandler);
        releaseSessionLease();
        const error = buildSmartError(config, fetchOptions, err);
        _stats.statusOnNext = "error";
        resolve(error);
        return;
      }
      if (config.debug) {
        console.log(`[Rezo Debug] HTTP/2: Request stream created`);
      }
      const requestTimeout = getH2DeadlineRemaining(requestDeadline, config, fetchOptions, "HTTP/2 response") ?? fallbackStreamTimeout;
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanupSessionListeners();
          releaseSessionLease();
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Request timeout after ${requestTimeout}ms (no response received)`);
          }
          req.close(http2.constants.NGHTTP2_CANCEL);
          const error = requestDeadline ? createH2DeadlineError(requestDeadline, config, fetchOptions, "HTTP/2 response") : buildSmartError(config, fetchOptions, new Error(`Request timeout after ${requestTimeout}ms`));
          _stats.statusOnNext = "error";
          resolve(error);
        }
      }, requestTimeout);
      let headersPhaseTimer;
      let bodyPhaseTimer;
      let bodyStartedAt;
      let bodyBudget = 0;
      const clearStageTimers = () => {
        if (headersPhaseTimer !== undefined) {
          clearTimeout(headersPhaseTimer);
          headersPhaseTimer = undefined;
        }
        if (bodyPhaseTimer !== undefined) {
          clearTimeout(bodyPhaseTimer);
          bodyPhaseTimer = undefined;
        }
      };
      const settleStageTimeout = (phase, phaseStartedAt, budget) => {
        if (resolved)
          return;
        resolved = true;
        if (timeoutId)
          clearTimeout(timeoutId);
        clearStageTimers();
        cleanupSessionListeners();
        releaseSessionLease();
        try {
          req.close(http2.constants.NGHTTP2_CANCEL);
        } catch {}
        const elapsed = Math.max(budget, Math.round(performance.now() - phaseStartedAt));
        const error = createStagedTimeoutError(phase, elapsed, config, fetchOptions);
        notifyH2TimeoutHooks(config, fetchOptions, phase, elapsed);
        _stats.statusOnNext = "error";
        resolve(error);
      };
      const settleOverdueDeadlines = () => {
        if (resolved)
          return true;
        const now = performance.now();
        const bodyDueAt = bodyPhaseTimer !== undefined && bodyStartedAt !== undefined ? bodyStartedAt + bodyBudget : undefined;
        const totalDueAt = requestDeadline?.expiresAt;
        const bodyOverdue = bodyDueAt !== undefined && now >= bodyDueAt;
        const totalOverdue = totalDueAt !== undefined && now >= totalDueAt;
        if (!bodyOverdue && !totalOverdue)
          return false;
        if (bodyOverdue && (!totalOverdue || bodyDueAt <= totalDueAt)) {
          settleStageTimeout("body", bodyStartedAt, bodyBudget);
          return true;
        }
        resolved = true;
        if (timeoutId)
          clearTimeout(timeoutId);
        clearStageTimers();
        cleanupSessionListeners();
        releaseSessionLease();
        try {
          req.close(http2.constants.NGHTTP2_CANCEL);
        } catch {}
        _stats.statusOnNext = "error";
        resolve(createH2DeadlineError(requestDeadline, config, fetchOptions, "HTTP/2 response"));
        return true;
      };
      req.once("close", clearStageTimers);
      if (stagedPhases.headers && stagedPhases.headers > 0) {
        const headersStartedAt = performance.now();
        const headersBudget = stagedPhases.headers;
        headersPhaseTimer = setTimeout(() => settleStageTimeout("headers", headersStartedAt, headersBudget), headersBudget);
      }
      if (requestSignal) {
        signalAbortHandler = () => {
          if (resolved)
            return;
          resolved = true;
          clearTimeout(timeoutId);
          clearStageTimers();
          cleanupSessionListeners();
          releaseSessionLease();
          try {
            req.close(http2.constants.NGHTTP2_CANCEL);
          } catch {}
          let error;
          try {
            getH2DeadlineRemaining(requestDeadline, config, fetchOptions, "HTTP/2 response");
            error = createH2AbortError(config, fetchOptions);
          } catch (timeoutError) {
            error = timeoutError;
          }
          _stats.statusOnNext = "error";
          resolve(error);
        };
        requestSignal.addEventListener("abort", signalAbortHandler, { once: true });
        if (requestSignal.aborted)
          signalAbortHandler();
      }
      if (resolved)
        return;
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
          releaseSessionLease();
          if (config.debug) {
            console.log(`[Rezo Debug] HTTP/2: Stream closed without response - retrying with new session`);
          }
          const reportedRst = typeof req.rstCode === "number" && req.rstCode !== 0 ? ` (RST_STREAM code ${req.rstCode})` : "";
          const cause = new Error(`HTTP/2 stream closed without response${reportedRst}`);
          cause.code = "ECONNRESET";
          const error = buildSmartError(config, fetchOptions, cause);
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
          releaseSessionLease();
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
          releaseSessionLease();
          const streamReset = err.code === "ERR_HTTP2_STREAM_ERROR" || typeof req.rstCode === "number" && req.rstCode !== 0;
          const cause = streamReset ? Object.assign(new Error(err.message), { code: "ECONNRESET" }) : err;
          const error = buildSmartError(config, fetchOptions, cause);
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
        if (headersPhaseTimer !== undefined) {
          clearTimeout(headersPhaseTimer);
          headersPhaseTimer = undefined;
        }
        if (!resolved && stagedPhases.body && stagedPhases.body > 0) {
          bodyStartedAt = performance.now();
          bodyBudget = stagedPhases.body;
          const armedAt = bodyStartedAt;
          const armedBudget = bodyBudget;
          bodyPhaseTimer = setTimeout(() => settleStageTimeout("body", armedAt, armedBudget), armedBudget);
        }
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const location = typeof headers["location"] === "string" ? headers["location"] : undefined;
        _stats.redirectUrl = undefined;
        isRedirect = status >= 300 && status < 400 && status !== 304;
        if (isRedirect) {
          _stats.statusOnNext = "redirect";
          _stats.redirectUrl = location;
        }
        if (!isRedirect) {
          try {
            const validateStatus = fetchOptions.validateStatus ?? ((candidate) => candidate >= 200 && candidate < 300);
            const notModifiedFromCache = status === 304 && fetchOptions.validateStatus === undefined && fetchOptions._acceptNotModified === true;
            responseAccepted = fetchOptions.validateStatus === null || notModifiedFromCache || validateStatus(status);
          } catch (error) {
            responseValidationFailure = { thrown: error };
            responseAccepted = false;
          }
          publishResponseEvents = responseAccepted;
          publishHeaderEvents = responseAccepted || responseValidationFailure !== undefined || !attemptContinuesAfterStatus(status);
        }
        config.network.httpVersion = "h2";
        cookieUpdatePromise = updateCookies(config, headers, url.href, rootJar, () => !resolved).catch((err) => {
          if (config.debug) {
            console.log("[Rezo Debug] Cookie hook error:", err);
          }
        });
        responseHeadersEventPromise = cookieUpdatePromise.then(async () => {
          if (resolved)
            return;
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
          _stats.deferredHeaderEvents = undefined;
          if (eventEmitter) {
            const publishHeaderTimeEvents = () => {
              eventEmitter.emit("headers", headersEvent);
              if (resolved)
                return;
              eventEmitter.emit("status", status, statusText);
              if (resolved)
                return;
              eventEmitter.emit("cookies", config.responseCookies?.array || []);
              if (resolved)
                return;
              if (downloadResult) {
                downloadResult.status = status;
                downloadResult.statusText = statusText;
              } else if (uploadResult) {
                uploadResult.status = status;
                uploadResult.statusText = statusText;
              }
            };
            if (publishHeaderEvents)
              publishHeaderTimeEvents();
            else
              _stats.deferredHeaderEvents = publishHeaderTimeEvents;
          }
          if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
            for (const hook of config.hooks.afterHeaders) {
              await hook(headersEvent, config);
              if (resolved || settleOverdueDeadlines())
                return;
            }
          }
          if (responseValidationFailure !== undefined)
            throw responseValidationFailure.thrown;
        }).catch((hookFailure) => {
          if (resolved)
            return;
          resolved = true;
          clearTimeout(timeoutId);
          cleanupSessionListeners();
          releaseSessionLease();
          _stats.statusOnNext = "error";
          try {
            req.close(http2.constants.NGHTTP2_CANCEL);
          } catch {
            req.destroy();
          }
          resolve(buildH2CallbackFailure(hookFailure, config, fetchOptions));
        });
      });
      const dataStartTime = performance.now();
      req.on("data", (chunk) => {
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Received data chunk: ${chunk.length} bytes (total: ${contentLengthCounter + chunk.length})`);
        }
        chunks.push(chunk);
        contentLengthCounter += chunk.length;
        const contentLength = responseHeaders["content-length"] ? parseInt(responseHeaders["content-length"], 10) : undefined;
        if (publishResponseEvents && (streamResult || eventEmitter)) {
          const loaded = contentLengthCounter;
          const now = performance.now();
          const elapsed = now - dataStartTime;
          const speed = elapsed > 0 ? loaded / (elapsed / 1000) : 0;
          const remaining = contentLength && contentLength > loaded && speed > 0 ? (contentLength - loaded) / speed * 1000 : 0;
          responseBodyEventPromise = responseBodyEventPromise.then(() => responseHeadersEventPromise).then(() => {
            if (resolved)
              return;
            if (streamResult) {
              streamResult.emit("data", chunk);
              if (resolved)
                return;
            }
            if (eventEmitter) {
              const progressEvent = {
                loaded,
                total: contentLength || 0,
                percentage: contentLength ? loaded / contentLength * 100 : 0,
                speed,
                averageSpeed: speed,
                estimatedTime: remaining,
                timestamp: now
              };
              eventEmitter.emit("progress", progressEvent);
            }
          });
        }
      });
      req.on("end", async () => {
        if (resolved)
          return;
        if (config.debug) {
          console.log(`[Rezo Debug] HTTP/2: Stream 'end' event fired (status: ${status}, chunks: ${chunks.length}, bytes: ${contentLengthCounter})`);
        }
        try {
          await cookieUpdatePromise;
          await responseHeadersEventPromise;
          await responseBodyEventPromise;
          if (resolved)
            return;
          resolved = true;
          clearTimeout(timeoutId);
          cleanupSessionListeners();
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
            } else if (requestBodyBytes(body)) {
              config.transfer.requestSize = requestBodyBytes(body).byteLength;
            } else if (isBlobBody(body)) {
              config.transfer.requestSize = body.size;
            } else if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
              config.transfer.requestSize = Buffer.byteLength(body.toString(), "utf8");
            } else if (body instanceof RezoFormData) {
              config.transfer.requestSize = await body.getLength() || 0;
            } else if (typeof body === "object" && !isStreamBody(body)) {
              config.transfer.requestSize = Buffer.byteLength(JSON.stringify(body), "utf8");
            }
          }
          releaseSessionLease();
          if (status === 0) {
            const cause = new Error("HTTP/2 stream ended without response");
            cause.code = "ECONNRESET";
            const error = buildSmartError(config, fetchOptions, cause);
            _stats.statusOnNext = "error";
            resolve(error);
            return;
          }
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
          const declaredContentLength = responseHeaders["content-length"] !== undefined ? parseInt(responseHeaders["content-length"], 10) : Number.NaN;
          const bodylessStatus = status === 204 || status === 304 || status >= 100 && status < 200;
          const requestMethod = (config.method || "GET").toUpperCase();
          const contentType = responseHeaders["content-type"] || "";
          const responseType = config.responseType || fetchOptions.responseType || "auto";
          const parseResponseBody = (source) => {
            const parseStart = performance.now();
            let parsed;
            if (source === null) {
              parsed = null;
            } else if (responseType === "buffer" || responseType === "arrayBuffer") {
              parsed = source;
            } else if (responseType === "text") {
              parsed = source.toString("utf-8");
            } else if (responseType === "json" || responseType === "auto" && contentType.includes("application/json")) {
              try {
                parsed = JSON.parse(source.toString("utf-8"));
              } catch {
                parsed = source.toString("utf-8");
              }
            } else if (contentType.includes("application/json")) {
              try {
                parsed = JSON.parse(source.toString("utf-8"));
              } catch {
                parsed = source.toString("utf-8");
              }
            } else {
              parsed = source.toString("utf-8");
            }
            return runAfterParseHooks(config, {
              data: parsed,
              rawData: source,
              contentType,
              parseDuration: performance.now() - parseStart,
              timestamp: Date.now()
            });
          };
          if (Number.isFinite(declaredContentLength) && !bodylessStatus && requestMethod !== "HEAD" && contentLengthCounter !== declaredContentLength) {
            const truncation = new Error(`HTTP/2 stream ended before the declared content-length was delivered (received ${contentLengthCounter} of ${declaredContentLength} bytes)`);
            truncation.code = "ECONNRESET";
            const facadeMode = Boolean(streamResult || downloadResult || uploadResult);
            let partialData;
            try {
              partialData = facadeMode ? undefined : parseResponseBody(responseBody);
            } catch (hookFailure) {
              _stats.statusOnNext = "error";
              resolve(buildH2CallbackFailure(hookFailure, config, fetchOptions));
              return;
            }
            const partialHeaders = new RezoHeaders(sanitizeHttp2Headers(responseHeaders));
            partialHeaders.delete("set-cookie");
            config.status = status;
            config.statusText = statusText;
            const partialResponse = {
              data: partialData,
              status,
              statusText,
              headers: partialHeaders,
              cookies: mergeRequestAndResponseCookies(config, config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] }),
              config,
              contentType: responseHeaders["content-type"],
              contentLength: contentLengthCounter,
              finalUrl: url.href,
              urls: buildUrlTree(config, url.href)
            };
            const error = RezoError.fromError(truncation, config, fetchOptions, partialResponse);
            _stats.statusOnNext = "error";
            resolve(error);
            return;
          }
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
              if (downloadResult) {
                attachDownloadTargetFailureCause(error, err instanceof Error ? err : new Error(String(err)));
              }
              _stats.statusOnNext = "error";
              resolve(error);
              return;
            }
          }
          let data;
          try {
            data = parseResponseBody(streamResult ? Buffer.alloc(0) : downloadResult ? null : responseBody);
          } catch (hookFailure) {
            _stats.statusOnNext = "error";
            resolve(buildH2CallbackFailure(hookFailure, config, fetchOptions));
            return;
          }
          if (requestDeadline && performance.now() >= requestDeadline.expiresAt) {
            releaseSessionLease();
            _stats.statusOnNext = "error";
            resolve(createH2DeadlineError(requestDeadline, config, fetchOptions, "HTTP/2 response"));
            return;
          }
          config.status = status;
          config.statusText = statusText;
          if (responseValidationFailure !== undefined)
            throw buildH2CallbackFailure(responseValidationFailure.thrown, config, fetchOptions);
          _stats.statusOnNext = responseAccepted ? "success" : "error";
          const responseCookies = config.responseCookies || { array: [], serialized: [], netscape: "", string: "", setCookiesString: [] };
          const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies);
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
          if (responseAccepted && downloadResult && fs && config.fileName) {
            let transaction;
            try {
              const { dirname } = await import("node:path");
              const dir = dirname(config.fileName);
              if (dir && dir !== ".")
                fs.mkdirSync(dir, { recursive: true });
              transaction = createDownloadTargetTransaction(config.fileName, { operations: fs });
              transaction.writeBufferAndClose(responseBody);
              transaction.commit();
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
            } catch (caughtError) {
              const primaryCause = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
              let cleanupFailure;
              if (transaction) {
                try {
                  await transaction.cleanup();
                } catch (error) {
                  cleanupFailure = error instanceof Error ? error : new Error(String(error));
                }
              }
              const error = buildDownloadError({
                statusCode: status,
                headers: sanitizeHttp2Headers(responseHeaders),
                contentType,
                contentLength: String(contentLengthCounter),
                cookies: config.responseCookies?.setCookiesString || [],
                statusText: primaryCause.message,
                url: url.href,
                body: responseBody,
                finalUrl: url.href,
                config,
                request: fetchOptions
              });
              attachDownloadTargetFailureCause(error, primaryCause, cleanupFailure);
              _stats.statusOnNext = "error";
              resolve(error);
              return;
            }
          }
          if (responseAccepted && streamResult) {
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
            streamResult.emit("end");
            streamResult.emit("finish", streamFinishEvent);
            streamResult.emit("done", streamFinishEvent);
            streamResult.emit("complete", streamFinishEvent);
            streamResult._markFinished();
            streamResult.end();
          }
          if (responseAccepted && uploadResult) {
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
          releaseSessionLease();
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
        } else if (multipart) {
          const buffer = multipart.bytes;
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
        } else {
          const bytes = requestBodyBytes(body);
          const stream = bytes ? undefined : nodeRequestBodyStream(transportBody);
          if (bytes)
            req.write(bytes);
          else if (stream) {
            pipeRequestBody(stream, req);
            return;
          } else
            req.write(typeof body === "object" ? JSON.stringify(body) : body);
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
      releaseSessionLease();
      _stats.statusOnNext = "error";
      const rezoError = error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
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
