import { assertInputTransport, getRequestFetchOptions, getOriginalFetchRequest, requestDisablesProxy } from '../utils/request-fetch-options.js';
import { unsupportedInput } from '../utils/request-input-errors.js';
import { resolveResponseType } from '../shared/resolve-response-type.js';
import { requestBodyBytes, isRawBody, isBlobBody, isWebStreamBody, isNodeStreamBody, claimBodyStream, extractWebBodyStream } from '../utils/request-body.js';
import { ownFetchRequestStream } from './fetch-request-body.js';
import { takeCoreCacheOwnership } from '../cache/response-cache-ownership.js';
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse, buildRedirectControlError, buildDecompressionError } from '../responses/buildError.js';
import { runAfterParseHooks, settleFacadeError } from '../core/hooks.js';
import { mergeRequestAndResponseCookieSnapshot } from '../responses/buildResponse.js';
import { RezoCookieJar } from '../cookies/index.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { RezoHeaders, prepareRedirectHeaders } from '../utils/headers.js';
import {
  composeRedirectHeaders,
  createRedirectHeaderPolicyState,
  stageRedirectHeaderTransition
} from '../utils/redirect-header-policy.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { isSameDomain, RezoPerformance } from '../utils/tools.js';
import { sanitizeConfig } from '../responses/sanitize-config.js';
import { ResponseCache } from '../cache/universal-response-cache.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
import { resolveTimeoutMs } from '../utils/staged-timeout.js';
import {
  createFetchRequestDeadline,
  createFetchTimeoutError,
  statusAttemptContinues
} from '../shared/index.js';
import { debugErrorDump } from '../utils/debug-error-dump.js';
import { importNodeModule } from '../utils/node-runtime.js';
import {
  collectRedirectGuarantees,
  formatUnsupportedRedirectCapabilities,
  hiddenRedirectVisibility,
  visibleRedirectVisibility,
  registerAdapterCapabilities
} from '../core/adapter-capabilities.js';
const Environment = {
  isNode: typeof process !== "undefined" && process.versions?.node,
  isBrowser: typeof window !== "undefined" && typeof document !== "undefined",
  isWebWorker: typeof self !== "undefined" && typeof self.WorkerGlobalScope !== "undefined",
  isDeno: typeof globalThis.Deno !== "undefined",
  isBun: typeof globalThis.Bun !== "undefined",
  isEdgeRuntime: typeof globalThis.EdgeRuntime !== "undefined" || typeof globalThis.caches !== "undefined",
  isCloudflareWorker: typeof globalThis.caches !== "undefined" && typeof globalThis.navigator !== "undefined" && globalThis.navigator?.userAgent === "Cloudflare-Workers",
  get hasFetch() {
    return typeof fetch !== "undefined";
  },
  get hasReadableStream() {
    return typeof ReadableStream !== "undefined";
  },
  get hasAbortController() {
    return typeof AbortController !== "undefined";
  },
  get canUseCookieJar() {
    if (this.isBrowser || this.isWebWorker)
      return false;
    return !!(this.isNode || this.isBun || this.isDeno || this.isCloudflareWorker || this.isEdgeRuntime);
  }
};
function evaluateFetchRedirectVisibility() {
  const runtime = globalThis;
  const navigatorLike = typeof runtime.navigator === "object" && runtime.navigator ? runtime.navigator : undefined;
  const isExplicitServerRuntime = typeof runtime.Bun !== "undefined" || typeof runtime.Deno !== "undefined" || typeof runtime.EdgeRuntime !== "undefined" || navigatorLike?.userAgent === "Cloudflare-Workers" || typeof runtime.caches !== "undefined" && typeof runtime.caches.default !== "undefined";
  if (isExplicitServerRuntime)
    return visibleRedirectVisibility();
  const isPlatformOwnedContext = navigatorLike?.product === "ReactNative" || typeof runtime.document !== "undefined" || typeof runtime.WorkerGlobalScope !== "undefined" || typeof runtime.importScripts === "function";
  if (isPlatformOwnedContext) {
    return hiddenRedirectVisibility("browser-fetch");
  }
  return visibleRedirectVisibility();
}
function redirectHeaderField(value, field) {
  if (value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, field)) {
    return Object.freeze({ kind: "present", value: Reflect.get(value, field) });
  }
  return Object.freeze({ kind: "absent" });
}
function replayHookHeaderOperations(target, operations) {
  for (const operation of operations) {
    if (operation.op === "delete") {
      target.delete(operation.key);
    } else if (operation.op === "append") {
      target.append(operation.key, operation.value);
    } else {
      target.set(operation.key, operation.value);
    }
  }
}
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      console.log(`[Rezo Debug] Adapter: fetch`);
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
  redirect: (config, fromUrl, toUrl, statusCode, method) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Redirect ${statusCode}: ${fromUrl}`);
      console.log(`[Rezo Debug]        → ${toUrl} (${method})`);
    }
    if (config.trackUrl) {
      console.log(`[Rezo Track]   ↳ ${statusCode} → ${toUrl}`);
    }
  },
  complete: (config, url, redirectCount, duration) => {
    if (config.debug) {
      console.log(`[Rezo Debug] Complete: ${url}`);
      if (redirectCount && redirectCount > 0) {
        console.log(`[Rezo Debug] Redirects: ${redirectCount}`);
      }
      if (duration) {
        console.log(`[Rezo Debug] Total Duration: ${duration.toFixed(2)}ms`);
      }
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
      adapterUsed: "fetch",
      fromCache: true
    }
  };
}
function notifyFetchAbortHooksOnce(config, stats, url, startedAt, message) {
  if (stats.abortHooksNotified)
    return;
  stats.abortHooksNotified = true;
  const hooks = config.hooks?.onAbort;
  if (!hooks || hooks.length === 0)
    return;
  for (const hook of hooks) {
    try {
      hook({ reason: "signal", message, url, elapsed: performance.now() - startedAt, timestamp: Date.now() }, config);
    } catch {}
  }
}
function normaliseFetchFailure(error, userSignal) {
  const candidate = error instanceof Error ? error : new Error(String(error));
  if (userSignal?.aborted || candidate.name === "AbortError") {
    const aborted = new Error("Request aborted by signal");
    aborted.code = "ABORT_ERR";
    aborted.name = "AbortError";
    return aborted;
  }
  const toPeerReset = (source) => {
    const reset = new Error(source.message);
    reset.code = "ECONNRESET";
    Object.defineProperty(reset, "cause", { value: source, enumerable: false });
    return reset;
  };
  const code = candidate.code;
  if (code === "UND_ERR_SOCKET")
    return toPeerReset(candidate);
  if (typeof code === "string")
    return candidate;
  let current = candidate;
  let depth = 0;
  while (current.code === undefined && current.name === "TypeError" && current.cause instanceof Error && depth < 4) {
    current = current.cause;
    depth += 1;
  }
  const resolvedCode = current.code;
  if (resolvedCode === "UND_ERR_SOCKET" || resolvedCode === undefined && candidate.message === "terminated")
    return toPeerReset(candidate);
  if (typeof resolvedCode === "string")
    return current;
  if (code === undefined)
    return candidate;
  const wrapped = new Error(candidate.message);
  wrapped.name = candidate.name;
  Object.defineProperty(wrapped, "cause", { value: candidate, enumerable: false });
  return wrapped;
}
function buildFetchCallbackFailure(causeValue, config, fetchOptions) {
  const cause = causeValue instanceof Error ? causeValue : new Error(String(causeValue));
  if (!(causeValue instanceof Error))
    Object.defineProperty(cause, "cause", { value: causeValue, enumerable: false });
  const error = new RezoError(cause.message || "Response callback failed", config, "REZ_UNKNOWN_ERROR", fetchOptions);
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
}

class FetchBodyReadFailure extends Error {
  platformError;
  partialBody;
  constructor(platformError, partialBody) {
    super(platformError instanceof Error ? platformError.message : String(platformError));
    this.platformError = platformError;
    this.partialBody = partialBody;
    this.name = "FetchBodyReadFailure";
  }
}
function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
async function readFetchBody(response, raceRead, onChunk, onCleanupError) {
  if (!response.body)
    return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  const releaseReaderLock = () => {
    try {
      reader.releaseLock();
    } catch {}
  };
  const cancelLockedReader = () => {
    try {
      reader.cancel().then(() => releaseReaderLock(), (error) => {
        onCleanupError(error);
        releaseReaderLock();
      });
    } catch (error) {
      onCleanupError(error);
      releaseReaderLock();
    }
  };
  try {
    while (true) {
      const { done, value } = await raceRead(reader.read());
      if (done)
        break;
      if (value) {
        chunks.push(value);
        onChunk?.();
      }
    }
  } catch (platformError) {
    if (platformError.name === "AbortError")
      cancelLockedReader();
    else
      releaseReaderLock();
    throw new FetchBodyReadFailure(platformError, concatBytes(chunks));
  }
  releaseReaderLock();
  return concatBytes(chunks);
}
const PLATFORM_DECODE_FAILURE_IDENTITIES = new Set([
  "ZstdDecompressionError",
  "BrotliDecompressionError",
  "ZlibError",
  "Z_BUF_ERROR",
  "Z_DATA_ERROR"
]);
function resolveDecodeFailure(error) {
  let current = error;
  let depth = 0;
  let found;
  while (current instanceof Error && depth <= 4) {
    const code = current.code;
    if (typeof code === "string" && PLATFORM_DECODE_FAILURE_IDENTITIES.has(code))
      found = { identity: code, source: current };
    else if (PLATFORM_DECODE_FAILURE_IDENTITIES.has(current.name))
      found = { identity: current.name, source: current };
    current = current.cause;
    depth += 1;
  }
  return found;
}
function decodeFailureIdentity(error) {
  return resolveDecodeFailure(error)?.identity;
}
function decodeFailureSource(error) {
  return resolveDecodeFailure(error)?.source ?? error;
}
function isPlatformDecodeFailure(error) {
  return decodeFailureIdentity(error) !== undefined;
}
function isTransportTruncation(error) {
  const candidate = error instanceof Error ? error : undefined;
  if (!candidate)
    return false;
  const code = candidate.code;
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET")
    return true;
  const cause = candidate.cause;
  if (cause && (cause.code === "UND_ERR_SOCKET" || cause.code === "ECONNRESET"))
    return true;
  return candidate.name === "TypeError" && candidate.message === "terminated";
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
async function parseCookiesFromHeaders(headers, url, config) {
  let setCookieHeaders = [];
  if (typeof headers.getSetCookie === "function") {
    setCookieHeaders = headers.getSetCookie() || [];
  } else {
    const setCookieRaw = headers.get("set-cookie");
    if (setCookieRaw) {
      const splitPattern = /,(?=\s*[A-Za-z0-9_-]+=)/;
      setCookieHeaders = setCookieRaw.split(splitPattern).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (setCookieHeaders.length === 0) {
    return {
      array: [],
      serialized: [],
      netscape: "",
      string: "",
      setCookiesString: []
    };
  }
  const pairs = [];
  for (const raw of setCookieHeaders) {
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
  if (config?.hooks?.beforeCookie && config.hooks.beforeCookie.length > 0) {
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
  const jar = new RezoCookieJar;
  jar.setCookiesSync(acceptedRaw, url);
  if (!config?.disableJar && config?.jar) {
    config.jar.setCookiesSync(acceptedRaw, url);
  }
  const cookies = jar.cookies();
  cookies.setCookiesString = setCookieHeaders;
  if (!hookError && config?.hooks?.afterCookie && config.hooks.afterCookie.length > 0) {
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
async function prepareFetchBody(body, config, request, signal) {
  if (!body)
    return;
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return body.toString();
  }
  if (body instanceof FormData) {
    return body;
  }
  if (body instanceof RezoFormData) {
    return body.toNativeFormData();
  }
  if (isNodeStreamBody(body)) {
    const streamModule = await importNodeModule("node:stream");
    signal.throwIfAborted();
    if (!streamModule)
      throw new RezoError("This Fetch runtime cannot adapt Node request streams.", config, "REZ_UNSUPPORTED_CAPABILITY", request);
    return streamModule.Readable.toWeb(body);
  }
  if (isWebStreamBody(body))
    return extractWebBodyStream(body, config, request);
  if (isRawBody(body))
    return body;
  if (typeof body === "object") {
    return JSON.stringify(body);
  }
  return body;
}
export async function executeRequest(options, defaultOptions, jar) {
  const coreDispatchIdentity = options;
  const canonicalResponseType = resolveResponseType(options.responseType, defaultOptions?.responseType, options);
  if (options.responseType !== canonicalResponseType) {
    options = { ...options, responseType: canonicalResponseType };
  }
  assertInputTransport(options, defaultOptions, "fetch");
  if (Environment.isBun && getRequestFetchOptions(options).integrity)
    unsupportedInput("fetch: Bun response integrity");
  if (Environment.isBun && requestDisablesProxy(options))
    unsupportedInput("fetch: Bun proxy disabling");
  if (!Environment.hasFetch) {
    throw new Error("Fetch API is not available in this environment");
  }
  const d_options = {
    ...await getDefaultConfig(defaultOptions),
    validateStatus: defaultOptions.validateStatus
  };
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  if (configResult.fetchOptions?.headers instanceof RezoHeaders) {
    configResult.fetchOptions.headers = prepareRedirectHeaders(configResult.fetchOptions.headers, "same-origin");
  }
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  const redirectGuarantees = collectRedirectGuarantees(Object.freeze({
    request: options,
    defaults: defaultOptions,
    effectiveHooks: defaultOptions._hooks ?? {}
  }));
  const redirectVisibility = evaluateFetchRedirectVisibility();
  if (redirectVisibility.visibility === "hidden" && redirectGuarantees.length > 0) {
    throw new RezoError(formatUnsupportedRedirectCapabilities(redirectVisibility.lane, redirectGuarantees), mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const requestedConnectTimeout = typeof fetchOptions.timeout === "object" && fetchOptions.timeout !== null ? fetchOptions.timeout.connect : undefined;
  if (typeof requestedConnectTimeout === "number" && Number.isFinite(requestedConnectTimeout) && requestedConnectTimeout > 0) {
    throw new RezoError(`The Fetch adapter has no connect stage: timeout.connect=${requestedConnectTimeout} cannot be honoured (use timeout.headers, timeout.body or timeout.total, or the HTTP adapter for a connect deadline)`, mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const requestedProxy = fetchOptions.proxy ?? options.proxy ?? mainConfig.proxy;
  const proxyPool = options.useProxyManager === false ? null : defaultOptions._proxyManager ?? null;
  const proxyRequestUrl = fetchOptions.fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  if (requestedProxy || proxyPool !== null && proxyPool.shouldProxy(proxyRequestUrl)) {
    throw new RezoError("The Fetch adapter cannot route a request through a proxy (the runtime fetch owns the connection): use the HTTP/1.1, HTTP/2 or cURL adapter for proxied requests", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const perform = new RezoPerformance;
  const cacheOption = options.cache;
  const method = (options.method || "GET").toUpperCase();
  const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
  let cache;
  let requestHeaders;
  let cacheIdentityHeaders;
  let cachedEntry;
  if (cacheOption && !takeCoreCacheOwnership(coreDispatchIdentity)) {
    cache = getResponseCache(cacheOption);
    requestHeaders = fetchOptions.headers instanceof RezoHeaders ? Object.fromEntries(fetchOptions.headers.entries()) : fetchOptions.headers;
    cacheIdentityHeaders = { ...requestHeaders };
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
      for (const [name, value] of Object.entries(conditionalHeaders)) {
        headers.set(name, value);
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
  try {
    const res = executeFetchRequest(fetchOptions, mainConfig, options, perform, streamResponse, downloadResponse, uploadResponse, jar, !!(cache && cachedEntry), redirectVisibility.visibility === "hidden");
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
    debugErrorDump(mainConfig, error);
    throw error;
  }
}
async function executeFetchRequest(fetchOptions, config, options, perform, streamResult, downloadResult, uploadResult, rootJar, allowCacheRevalidation = false, usePlatformRedirects = false) {
  let requestCount = 0;
  const _stats = { statusOnNext: "abort" };
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
  const initialRedirectPolicy = createRedirectHeaderPolicyState(String(fetchOptions.fullUrl ?? fetchOptions.url));
  if (!initialRedirectPolicy.ok) {
    throw new RezoError("Invalid redirect source URL", config, "ERR_INVALID_URL", fetchOptions);
  }
  let redirectPolicyState = initialRedirectPolicy.state;
  let redirectCleanBase = fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : new RezoHeaders(fetchOptions.headers ?? {});
  const requestUrl = String(fetchOptions.fullUrl ?? fetchOptions.url ?? "");
  const requestDeadlineStartedAt = performance.now();
  const requestDeadline = createFetchRequestDeadline(fetchOptions.timeout);
  let deadlineError;
  let deadlineErrorExpiration;
  let redirectTerminalSnapshot;
  const getDeadlineError = () => {
    const expiration = requestDeadline?.expiration();
    if (expiration === undefined)
      return;
    if (deadlineError !== undefined && deadlineErrorExpiration === expiration)
      return deadlineError;
    deadlineError = createFetchTimeoutError(expiration, redirectTerminalSnapshot?.config ?? config, redirectTerminalSnapshot?.request ?? fetchOptions);
    deadlineErrorExpiration = expiration;
    for (const hook of config.hooks?.onTimeout ?? []) {
      hook({
        type: expiration.phase === "total" ? "request" : "response",
        timeout: expiration.timeout,
        elapsed: expiration.elapsed,
        url: requestUrl,
        timestamp: Date.now()
      }, config);
    }
    return deadlineError;
  };
  const totalDeadlineMs = requestDeadline?.totalSignal === undefined ? undefined : resolveTimeoutMs(fetchOptions.timeout);
  const totalDeadlineDueAt = totalDeadlineMs === undefined ? undefined : requestDeadlineStartedAt + totalDeadlineMs;
  const eventEmitter = streamResult || downloadResult || uploadResult;
  const preDispatchCallerSignal = fetchOptions.signal;
  let preDispatchCallerAbortAt = preDispatchCallerSignal?.aborted ? Number.NEGATIVE_INFINITY : undefined;
  const recordPreDispatchCallerAbort = () => {
    if (preDispatchCallerAbortAt === undefined)
      preDispatchCallerAbortAt = performance.now();
  };
  if (eventEmitter && preDispatchCallerSignal && !preDispatchCallerSignal.aborted) {
    preDispatchCallerSignal.addEventListener("abort", recordPreDispatchCallerAbort, { once: true });
  }
  const awaitPreDispatchEmitterDeadlineCheckpoint = async (site) => {
    const callerOwns = preDispatchCallerAbortAt !== undefined && (totalDeadlineDueAt === undefined || preDispatchCallerAbortAt < totalDeadlineDueAt);
    if (callerOwns) {
      if (site === "initiated")
        return;
      const aborted = new Error("Request aborted by signal before dispatch");
      aborted.code = "ABORT_ERR";
      aborted.name = "AbortError";
      throw buildSmartError(config, fetchOptions, aborted);
    }
    const existingError = getDeadlineError();
    if (existingError !== undefined)
      throw existingError;
    if (totalDeadlineMs === undefined || performance.now() - timing.startTime < totalDeadlineMs)
      return;
    let checkpointTimer;
    try {
      await new Promise((resolve) => {
        checkpointTimer = setTimeout(resolve, 0);
      });
    } finally {
      if (checkpointTimer !== undefined)
        clearTimeout(checkpointTimer);
    }
    const deadlineFailure = getDeadlineError();
    if (deadlineFailure !== undefined)
      throw deadlineFailure;
  };
  try {
    if (!config.requestId) {
      config.requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    debugLog.requestStart(config, requestUrl, fetchOptions.method || "GET");
    if (eventEmitter) {
      eventEmitter.emit("initiated");
      await awaitPreDispatchEmitterDeadlineCheckpoint("initiated");
    }
    const publishFacadeTerminal = (response) => {
      const finalUrl = response.finalUrl || requestUrl;
      const urls = buildUrlTree(config, finalUrl);
      const durations = getTimingDurations(config);
      if (streamResult) {
        const event = { status: response.status, statusText: response.statusText, headers: response.headers, contentType: response.contentType || undefined, contentLength: 0, finalUrl, cookies: response.cookies, urls, timing: durations, config: sanitizeConfig(config) };
        streamResult.emit("end");
        streamResult.emit("finish", event);
        streamResult.emit("done", event);
        streamResult.emit("complete", event);
        streamResult._markFinished();
        streamResult.end();
      } else if (downloadResult) {
        const event = { status: response.status, statusText: response.statusText, headers: response.headers, contentType: response.contentType || "", contentLength: 0, finalUrl, cookies: response.cookies, urls, fileName: config.fileName ?? "", fileSize: 0, timing: { ...durations, download: durations.download || 0 }, averageSpeed: 0, config: sanitizeConfig(config) };
        downloadResult.emit("finish", event);
        downloadResult.emit("done", event);
        downloadResult.emit("complete", event);
        downloadResult._markFinished();
      } else if (uploadResult) {
        const event = { response: { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data, contentType: response.contentType || "", contentLength: 0 }, finalUrl, cookies: response.cookies, urls, uploadSize: config.transfer?.requestSize || 0, timing: { ...durations, upload: durations.firstByte || 0, waiting: 0 }, averageUploadSpeed: 0, averageDownloadSpeed: 0, config: sanitizeConfig(config) };
        uploadResult.emit("finish", event);
        uploadResult.emit("done", event);
        uploadResult.emit("complete", event);
        uploadResult._markFinished();
      }
    };
    while (true) {
      totalAttempts++;
      let redirectCallbackThrew = false;
      let redirectCallbackThrownValue;
      if (totalAttempts > ABSOLUTE_MAX_ATTEMPTS) {
        const error = builErrorFromResponse(`Absolute maximum attempts (${ABSOLUTE_MAX_ATTEMPTS}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
        throw error;
      }
      try {
        const response = await executeSingleFetchRequest(config, fetchOptions, requestCount, timing, _stats, streamResult, downloadResult, uploadResult, allowCacheRevalidation, usePlatformRedirects, requestDeadline, (status) => statusAttemptContinues(status, retryConfig, retryAttempt, options.waitOnStatus), getDeadlineError, awaitPreDispatchEmitterDeadlineCheckpoint);
        const statusOnNext = _stats.statusOnNext;
        const retrySignal = fetchOptions.signal;
        const totalDeadlineSignal = requestDeadline?.totalSignal;
        const interruptionWins = (stage) => {
          const timeoutError = getDeadlineError();
          if (timeoutError !== undefined)
            throw timeoutError;
          if (!retrySignal?.aborted)
            return;
          const abortedDuringRetry = new Error(`Request aborted by signal during the ${stage}`);
          abortedDuringRetry.code = "ABORT_ERR";
          abortedDuringRetry.name = "AbortError";
          throw buildSmartError(redirectTerminalSnapshot?.config ?? config, redirectTerminalSnapshot?.request ?? fetchOptions, abortedDuringRetry);
        };
        const awaitUnlessCancelled = async (stage, work) => {
          interruptionWins(stage);
          if (!retrySignal && !totalDeadlineSignal)
            return await work();
          let onAbort;
          let onDeadline;
          const interrupted = new Promise((_, reject) => {
            if (retrySignal) {
              onAbort = () => reject(new Error(`Request aborted by signal during the ${stage}`));
              retrySignal.addEventListener("abort", onAbort, { once: true });
            }
            if (totalDeadlineSignal) {
              onDeadline = () => reject(new Error(`Request deadline expired during the ${stage}`));
              totalDeadlineSignal.addEventListener("abort", onDeadline, { once: true });
            }
          });
          try {
            const result = await Promise.race([Promise.resolve().then(work), interrupted]);
            interruptionWins(stage);
            return result;
          } catch (error) {
            interruptionWins(stage);
            throw error;
          } finally {
            if (retrySignal && onAbort)
              retrySignal.removeEventListener("abort", onAbort);
            if (totalDeadlineSignal && onDeadline)
              totalDeadlineSignal.removeEventListener("abort", onDeadline);
          }
        };
        const awaitRedirectCheckpoint = async (stage) => {
          interruptionWins(stage);
          if (!totalDeadlineSignal)
            return;
          let checkpointTimer;
          try {
            await awaitUnlessCancelled(stage, () => new Promise((resolve) => {
              checkpointTimer = setTimeout(resolve, 0);
            }));
          } finally {
            if (checkpointTimer !== undefined)
              clearTimeout(checkpointTimer);
          }
          interruptionWins(stage);
        };
        const awaitRedirectWork = async (stage, work) => {
          let outcome;
          try {
            outcome = Object.freeze({ ok: true, value: await awaitUnlessCancelled(stage, work) });
          } catch (error) {
            outcome = Object.freeze({ error, ok: false });
          }
          await awaitRedirectCheckpoint(stage);
          if (!outcome.ok)
            throw outcome.error;
          return outcome.value;
        };
        const awaitRetryDelay = async (delayMs) => {
          if (delayMs > 0) {
            let delayTimer;
            try {
              await awaitUnlessCancelled("retry delay", () => new Promise((resolve) => {
                delayTimer = setTimeout(resolve, delayMs);
              }));
            } finally {
              if (delayTimer !== undefined)
                clearTimeout(delayTimer);
            }
          }
          interruptionWins("retry delay");
        };
        if (response instanceof RezoError) {
          if (!config.errors)
            config.errors = [];
          config.errors.push({
            attempt: config.retryAttempts + 1,
            error: response,
            duration: perform.now()
          });
          perform.reset();
          if (response.code === "ABORT_ERR") {
            throw response;
          }
          if (response.code === "ECONNABORTED" && Reflect.get(response, "phase") === "total") {
            throw response;
          }
          if (!retryConfig || _stats.bodyStarted) {
            throw response;
          }
          const method = fetchOptions.method || "GET";
          retryAttempt++;
          if (retryConfig.condition && retryAttempt > retryConfig.maxRetries) {
            if (retryConfig.onRetryExhausted) {
              await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(response, retryAttempt));
            }
            throw response;
          }
          if (retryConfig.condition) {
            const shouldContinue = await awaitUnlessCancelled("retry decision", () => retryConfig.condition(response, retryAttempt));
            if (shouldContinue === false) {
              if (retryConfig.onRetryExhausted) {
                await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(response, retryAttempt));
              }
              throw response;
            }
          } else {
            const canRetry = shouldRetry(response, retryAttempt, method, retryConfig);
            if (!canRetry) {
              if (retryAttempt > retryConfig.maxRetries && retryConfig.onRetryExhausted) {
                await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(response, retryAttempt));
              }
              throw response;
            }
          }
          const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
          if (retryConfig.onRetry) {
            const shouldProceed = await awaitUnlessCancelled("retry decision", () => retryConfig.onRetry(response, retryAttempt, currentDelay));
            if (shouldProceed === false) {
              throw response;
            }
          }
          if (config.hooks?.beforeRetry && config.hooks.beforeRetry.length > 0) {
            for (const hook of config.hooks.beforeRetry) {
              await awaitUnlessCancelled("retry decision", () => hook(config, response, retryAttempt));
            }
          }
          await awaitRetryDelay(currentDelay);
          config.retryAttempts++;
          continue;
        }
        if (statusOnNext === "success") {
          const totalDuration = performance.now() - timing.startTime;
          debugLog.complete(config, response.finalUrl || requestUrl, config.redirectCount, totalDuration);
          return response;
        }
        if (statusOnNext === "error") {
          if (shouldWaitOnStatus(response.status, options.waitOnStatus)) {
            const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
            const rateLimitWaitController = new AbortController;
            const rateLimitAbortSources = [retrySignal, totalDeadlineSignal].filter((signal) => signal !== undefined);
            const abortRateLimitWait = () => {
              rateLimitWaitController.abort();
            };
            for (const signal of rateLimitAbortSources) {
              if (signal.aborted)
                abortRateLimitWait();
              else
                signal.addEventListener("abort", abortRateLimitWait, { once: true });
            }
            let waitResult;
            try {
              waitResult = await awaitUnlessCancelled("retry delay", () => handleRateLimitWait({
                status: response.status,
                headers: response.headers,
                data: response.data,
                url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
                method: fetchOptions.method || "GET",
                config,
                options,
                currentWaitAttempt: rateLimitWaitAttempt,
                signal: rateLimitWaitController.signal,
                isActive: () => rateLimitWaitController.signal.aborted !== true
              }));
            } finally {
              for (const signal of rateLimitAbortSources) {
                signal.removeEventListener("abort", abortRateLimitWait);
              }
            }
            interruptionWins("retry delay");
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
              if (retryConfig.onRetryExhausted)
                await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(httpError, retryAttempt));
              retryAllowed = false;
            } else if (retryConfig.condition) {
              retryAllowed = await awaitUnlessCancelled("retry decision", () => retryConfig.condition(httpError, retryAttempt)) !== false;
              if (!retryAllowed && retryConfig.onRetryExhausted)
                await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(httpError, retryAttempt));
            } else {
              retryAllowed = shouldRetry(httpError, retryAttempt, method, retryConfig);
              if (!retryAllowed && retryAttempt > retryConfig.maxRetries && retryConfig.onRetryExhausted) {
                await awaitUnlessCancelled("retry decision", () => retryConfig.onRetryExhausted(httpError, retryAttempt));
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
              if (config.debug) {
                console.log(`Request failed with status code ${response.status}, retrying...${currentDelay > 0 ? " in " + currentDelay + "ms" : ""}`);
              }
              const proceed = retryConfig.onRetry ? await awaitUnlessCancelled("retry decision", () => retryConfig.onRetry(httpError, retryAttempt, currentDelay)) !== false : true;
              if (proceed) {
                for (const hook of config.hooks?.beforeRetry ?? []) {
                  await awaitUnlessCancelled("retry decision", () => hook(config, httpError, retryAttempt));
                }
                await awaitRetryDelay(currentDelay);
                _stats.deferredHeaderEvents = undefined;
                continue;
              }
            }
          }
          _stats.deferredHeaderEvents?.();
          _stats.deferredHeaderEvents = undefined;
          throw httpError;
        }
        if (statusOnNext === "redirect") {
          if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
            const hopContentLength = response.headers.get("content-length");
            const hopHeadersEvent = {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              contentType: response.contentType || undefined,
              contentLength: hopContentLength ? parseInt(hopContentLength, 10) : undefined,
              cookies: response.cookies?.array ?? [],
              timing: {
                firstByte: config.timing.responseStart - config.timing.startTime,
                total: performance.now() - config.timing.startTime
              }
            };
            for (const hook of config.hooks.afterHeaders) {
              try {
                await awaitRedirectWork("redirect hook", () => hook(hopHeadersEvent, config));
              } catch (hookFailure) {
                if (getDeadlineError() !== undefined)
                  throw hookFailure;
                throw buildFetchCallbackFailure(hookFailure, config, fetchOptions);
              }
            }
          }
          if (config.maxRedirects === 0) {
            config.maxRedirectsReached = true;
            throw buildRedirectControlError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
          }
          if (fetchOptions.followRedirects === false) {
            const validateStatus = fetchOptions.validateStatus;
            let redirectAccepted;
            try {
              redirectAccepted = validateStatus === undefined || validateStatus === null || validateStatus(response.status) === true;
            } catch (callbackFailure) {
              throw buildFetchCallbackFailure(callbackFailure, config, fetchOptions);
            }
            if (!redirectAccepted) {
              throw RezoError.createHttpError(response.status, config, fetchOptions, response);
            }
            publishFacadeTerminal(response);
            return response;
          }
          if (_stats.invalidRedirectLocation !== undefined) {
            throw new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
          }
          const location = _stats.redirectUrl;
          if (!location) {
            throw RezoError.createRedirectError("Redirect location not found", config, fetchOptions, response);
          }
          const redirectCode = response.status;
          const fromUrl = String(fetchOptions.fullUrl);
          if (eventEmitter) {
            const hopHeaders = new RezoHeaders(response.headers);
            hopHeaders.delete("set-cookie");
            const redirectEvent = {
              sourceUrl: fromUrl,
              sourceStatus: response.status,
              sourceStatusText: response.statusText,
              destinationUrl: location,
              redirectCount: config.redirectCount + 1,
              maxRedirects: config.maxRedirects,
              headers: hopHeaders,
              cookies: response.cookies?.array ?? [],
              method: fetchOptions.method.toUpperCase(),
              timestamp: performance.now(),
              duration: 0
            };
            eventEmitter.emit("redirect", redirectEvent);
          }
          const sourceRequestSnapshot = {
            ...fetchOptions,
            headers: new RezoHeaders(fetchOptions.headers ?? {}),
            url: fetchOptions.url instanceof URL ? new URL(fetchOptions.url.href) : fetchOptions.url
          };
          const redirectCallback = config.beforeRedirect || config.onRedirect;
          if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0 || redirectCallback) {
            const sourceConfigSnapshot = {
              ...config,
              errors: config.errors ? [...config.errors] : [],
              headers: new RezoHeaders(config.headers ?? {}),
              network: { ...config.network },
              originalRequest: sourceRequestSnapshot,
              redirectHistory: config.redirectHistory.map((entry) => ({
                ...entry,
                cookies: [...entry.cookies],
                headers: new RezoHeaders(entry.headers),
                request: {
                  ...entry.request,
                  headers: new RezoHeaders(entry.request.headers ?? {})
                }
              })),
              requestCookies: config.requestCookies ? [...config.requestCookies] : [],
              responseCookies: config.responseCookies ? {
                ...config.responseCookies,
                array: [...config.responseCookies.array],
                serialized: [...config.responseCookies.serialized],
                setCookiesString: [...config.responseCookies.setCookiesString]
              } : config.responseCookies,
              security: { ...config.security },
              timing: { ...config.timing },
              transfer: { ...config.transfer }
            };
            redirectTerminalSnapshot = Object.freeze({
              config: sourceConfigSnapshot,
              request: sourceRequestSnapshot
            });
          }
          const hookHeaderOperations = [];
          let hookCarrierReplacement;
          let hookCookieDecision = false;
          if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
            const sourceHeaderCarrier = fetchOptions.headers;
            const hookWorkingHeaders = sourceHeaderCarrier instanceof RezoHeaders ? new RezoHeaders(sourceHeaderCarrier) : new RezoHeaders(sourceHeaderCarrier ?? {});
            let hookRecorder;
            hookRecorder = new Proxy(hookWorkingHeaders, {
              get(target, property) {
                const conveniences = {
                  setAuthorization: "authorization",
                  setContentType: "content-type",
                  setUserAgent: "user-agent"
                };
                if (typeof property === "string" && Object.prototype.hasOwnProperty.call(conveniences, property)) {
                  return (...args) => {
                    hookHeaderOperations.push(Object.freeze({
                      op: "set",
                      key: conveniences[property],
                      value: String(args[0])
                    }));
                    target[property](...args);
                    return hookRecorder;
                  };
                }
                if (property === "forEach") {
                  return (callback, thisArg) => target.forEach((value, key) => {
                    callback.call(thisArg, value, key, hookRecorder);
                  });
                }
                if (property === "set" || property === "append" || property === "delete") {
                  return (...args) => {
                    hookHeaderOperations.push(Object.freeze({
                      op: property,
                      key: String(args[0]),
                      ...property === "delete" ? {} : { value: String(args[1]) }
                    }));
                    return target[property](...args);
                  };
                }
                const member = Reflect.get(target, property, target);
                return typeof member === "function" ? member.bind(target) : member;
              },
              set(target, property, value) {
                if (typeof property === "string") {
                  hookHeaderOperations.push(Object.freeze({
                    op: "set",
                    key: property,
                    value: String(value)
                  }));
                }
                return Reflect.set(target, property, value);
              },
              deleteProperty(target, property) {
                if (typeof property === "string") {
                  hookHeaderOperations.push(Object.freeze({
                    op: "delete",
                    key: property
                  }));
                }
                return Reflect.deleteProperty(target, property);
              }
            });
            fetchOptions.headers = hookRecorder;
            let afterHooks = hookRecorder;
            try {
              const redirectContext = {
                redirectUrl: new URL(location),
                fromUrl,
                status: response.status,
                headers: response.headers,
                sameDomain: isSameDomain(fromUrl, location),
                method: fetchOptions.method.toUpperCase(),
                body: config.originalBody,
                request: fetchOptions,
                redirectCount: config.redirectCount,
                timestamp: Date.now()
              };
              for (const hook of config.hooks.beforeRedirect) {
                await awaitRedirectWork("redirect hook", () => hook(redirectContext, config, response));
              }
            } finally {
              afterHooks = fetchOptions.headers;
              fetchOptions.headers = sourceHeaderCarrier;
            }
            if (afterHooks !== hookRecorder) {
              if (afterHooks instanceof RezoHeaders) {
                hookCarrierReplacement = new RezoHeaders(afterHooks);
              } else if (afterHooks && typeof afterHooks === "object") {
                hookCarrierReplacement = new RezoHeaders(afterHooks);
              } else if (afterHooks == null) {
                hookCarrierReplacement = new RezoHeaders;
              } else {
                throw new TypeError("Invalid redirect hook header carrier");
              }
              hookCookieDecision = true;
            } else {
              hookCookieDecision = hookHeaderOperations.some((operation) => operation.key.toLowerCase() === "cookie");
            }
          }
          let onRedirect;
          const boxedRedirect = redirectCallback ? await awaitRedirectWork("redirect callback", () => {
            try {
              return Object.freeze({
                value: redirectCallback({
                  url: new URL(location),
                  status: response.status,
                  headers: response.headers,
                  sameDomain: isSameDomain(fromUrl, location),
                  method: fetchOptions.method.toUpperCase(),
                  body: config.originalBody
                })
              });
            } catch (error) {
              redirectCallbackThrew = true;
              redirectCallbackThrownValue = error;
              throw error;
            }
          }) : undefined;
          onRedirect = boxedRedirect?.value;
          let instruction;
          if (onRedirect !== null && typeof onRedirect === "object") {
            const hasBody = Reflect.has(onRedirect, "body");
            instruction = Object.freeze({
              body: hasBody ? Reflect.get(onRedirect, "body") : undefined,
              hasBody,
              method: Reflect.get(onRedirect, "method"),
              redirect: Reflect.get(onRedirect, "redirect"),
              setHeaders: redirectHeaderField(onRedirect, "setHeaders"),
              setHeadersOnRedirects: redirectHeaderField(onRedirect, "setHeadersOnRedirects"),
              url: Reflect.get(onRedirect, "url"),
              withoutBody: Reflect.get(onRedirect, "withoutBody")
            });
          }
          if (redirectCallback) {
            await awaitRedirectCheckpoint("redirect callback");
          }
          if (typeof onRedirect === "boolean" && !onRedirect) {
            throw buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
          }
          if (instruction && !instruction.redirect && !instruction.withoutBody && !instruction.hasBody) {
            throw buildRedirectControlError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
          }
          if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
            config.maxRedirectsReached = true;
            throw buildRedirectControlError("Max redirects (" + config.maxRedirects + ") reached", config, "REZ_MAX_REDIRECTS_EXCEEDED", fetchOptions, response);
          }
          const normalizedRedirect = !!instruction && !!(instruction.redirect || instruction.withoutBody || instruction.hasBody);
          let nextUrl = location;
          let nextMethod = fetchOptions.method;
          let nextBody = fetchOptions.body;
          let nextHasBody = Object.prototype.hasOwnProperty.call(fetchOptions, "body");
          let clearRepresentationHeaders = false;
          if (instruction && normalizedRedirect) {
            const userMethod = instruction.method === undefined ? undefined : String(instruction.method);
            nextMethod = redirectCode === 301 || redirectCode === 302 || redirectCode === 303 ? userMethod || "GET" : userMethod || fetchOptions.method;
            if (instruction.redirect && instruction.url) {
              nextUrl = instruction.url;
            }
            if (instruction.withoutBody) {
              nextBody = undefined;
              nextHasBody = false;
              clearRepresentationHeaders = true;
            } else if (instruction.hasBody) {
              nextBody = instruction.body;
              nextHasBody = true;
            } else if (redirectCode === 307 || redirectCode === 308) {
              const methodUpper = nextMethod.toUpperCase();
              nextHasBody = (methodUpper === "POST" || methodUpper === "PUT" || methodUpper === "PATCH") && config.originalBody !== undefined;
              nextBody = nextHasBody ? config.originalBody : undefined;
            } else {
              nextBody = undefined;
              nextHasBody = false;
              clearRepresentationHeaders = true;
            }
          } else if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
            nextMethod = "GET";
            nextBody = undefined;
            nextHasBody = false;
            clearRepresentationHeaders = true;
          }
          const absentField = Object.freeze({ kind: "absent" });
          const transition = stageRedirectHeaderTransition(redirectPolicyState, {
            finalizedNormalizedUrl: nextUrl,
            setHeaders: instruction?.setHeaders ?? absentField,
            setHeadersOnRedirects: instruction?.setHeadersOnRedirects ?? absentField
          });
          if (!transition.ok) {
            throw new RezoError(transition.reason === "invalid-url" ? "Invalid redirect destination URL" : 'Invalid redirect header patch "' + transition.field + '"', config, transition.reason === "invalid-url" ? "ERR_INVALID_URL" : "ERR_INVALID_ARG_TYPE", fetchOptions, response);
          }
          await awaitRedirectCheckpoint("redirect commit");
          if (config.enableRedirectCycleDetection === true) {
            if (visitedUrls.size === 0) {
              visitedUrls.add(redirectPolicyState.currentUrl);
            }
            const finalizedRedirectUrl = transition.state.currentUrl;
            if (visitedUrls.has(finalizedRedirectUrl)) {
              throw buildRedirectControlError("Redirect cycle detected: " + finalizedRedirectUrl, config, "REZ_REDIRECT_CYCLE_DETECTED", fetchOptions, response);
            }
            visitedUrls.add(finalizedRedirectUrl);
          }
          let nextCleanBase = prepareRedirectHeaders(new RezoHeaders(redirectCleanBase), transition.relation);
          if (clearRepresentationHeaders) {
            nextCleanBase.delete("Content-Type");
            nextCleanBase.delete("Content-Length");
          }
          if (hookCarrierReplacement) {
            nextCleanBase = new RezoHeaders(hookCarrierReplacement);
          } else {
            replayHookHeaderOperations(nextCleanBase, hookHeaderOperations);
          }
          nextCleanBase.delete("proxy-authorization");
          const jarToSync = rootJar || config.jar;
          if (response.cookies?.array?.length > 0 && jarToSync) {
            try {
              jarToSync.setCookiesSync(response.cookies.array, fromUrl);
            } catch (_error) {}
          }
          const destinationHeaders = new RezoHeaders;
          if (Environment.canUseCookieJar && jarToSync && !config.disableJar && !hookCookieDecision) {
            const cookieHeader = jarToSync.getCookieHeader(transition.state.currentUrl);
            if (cookieHeader)
              destinationHeaders.set("Cookie", cookieHeader);
          }
          const nextHeaders = composeRedirectHeaders(transition.state, {
            targetBase: nextCleanBase,
            destinationHeaders
          });
          fetchOptions.fullUrl = transition.state.currentUrl;
          fetchOptions.url = transition.state.currentUrl;
          fetchOptions.method = nextMethod;
          fetchOptions.headers = nextHeaders;
          options.fullUrl = transition.state.currentUrl;
          options.url = transition.state.currentUrl;
          options.method = nextMethod;
          if (nextHasBody) {
            fetchOptions.body = nextBody;
            options.body = nextBody;
            config.originalBody = nextBody;
          } else {
            delete fetchOptions.body;
            delete options.body;
            config.originalBody = undefined;
          }
          if (transition.relation !== "same-origin") {
            delete fetchOptions.auth;
            delete options.auth;
            config.auth = null;
          }
          config.redirectHistory.push({
            url: fromUrl,
            statusCode: redirectCode,
            statusText: response.statusText,
            headers: response.headers,
            method: sourceRequestSnapshot.method.toUpperCase(),
            cookies: response.cookies.array,
            duration: perform.now(),
            request: sourceRequestSnapshot
          });
          perform.reset();
          config.redirectCount = transition.state.redirectCount;
          config.finalUrl = transition.state.currentUrl;
          config.originalRequest = fetchOptions;
          redirectPolicyState = transition.state;
          redirectCleanBase = nextCleanBase;
          debugLog.redirect(config, fromUrl, transition.state.currentUrl, redirectCode, nextMethod);
          delete options.params;
          requestCount++;
          redirectTerminalSnapshot = undefined;
          continue;
        }
        throw builErrorFromResponse("Unexpected state", response, config, fetchOptions);
      } catch (error) {
        const finalError = redirectCallbackThrew && Object.is(error, redirectCallbackThrownValue) || error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
        if (finalError instanceof RezoError && finalError.code === "ABORT_ERR") {
          notifyFetchAbortHooksOnce(config, _stats, requestUrl, timing.startTime, finalError.message);
        }
        throw finalError;
      }
    }
  } finally {
    if (preDispatchCallerSignal) {
      preDispatchCallerSignal.removeEventListener("abort", recordPreDispatchCallerAbort);
    }
    requestDeadline?.clear();
  }
}
async function executeSingleFetchRequest(config, fetchOptions, requestCount, timing, _stats, streamResult, downloadResult, uploadResult, allowCacheRevalidation = false, usePlatformRedirects = false, requestDeadline, attemptContinuesAfterStatus = () => false, getDeadlineError = () => {
  return;
}, awaitPreDispatchEmitterDeadlineCheckpoint = async () => {}) {
  let userSignal;
  let onUserAbort;
  let phaseDeadlineSignal;
  let onPhaseDeadline;
  let onTotalDeadline;
  let releaseUpload;
  const isDownloadMode = !!(downloadResult && config.fileName);
  try {
    const { fullUrl, body } = fetchOptions;
    const url = new URL(fullUrl || fetchOptions.url);
    const isSecure = url.protocol === "https:";
    if (requestCount === 0) {
      config.adapterUsed = "fetch";
      config.isSecure = isSecure;
      config.finalUrl = url.href;
      config.network.protocol = isSecure ? "https" : "http";
      config.network.httpVersion = undefined;
      if (!config.transfer) {
        config.transfer = { requestSize: 0, responseSize: 0, headerSize: 0, bodySize: 0 };
      } else if (config.transfer.requestSize === undefined) {
        config.transfer.requestSize = 0;
      }
    }
    const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
    const headers = toFetchHeaders(reqHeaders);
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (eventEmitter && requestCount === 0 && _stats.startEventEmitted !== true) {
      _stats.startEventEmitted = true;
      const startEvent = {
        url: url.toString(),
        method: fetchOptions.method.toUpperCase(),
        headers: new RezoHeaders(reqHeaders),
        timestamp: timing.startTime,
        timeout: resolveTimeoutMs(fetchOptions.timeout),
        maxRedirects: config.maxRedirects
      };
      eventEmitter.emit("start", startEvent);
      await awaitPreDispatchEmitterDeadlineCheckpoint("start");
    }
    const abortController = new AbortController;
    phaseDeadlineSignal = requestDeadline?.startAttempt();
    const totalDeadlineSignal = requestDeadline?.totalSignal;
    if (phaseDeadlineSignal) {
      onPhaseDeadline = () => abortController.abort();
      if (phaseDeadlineSignal.aborted)
        onPhaseDeadline();
      else
        phaseDeadlineSignal.addEventListener("abort", onPhaseDeadline, { once: true });
    }
    if (totalDeadlineSignal) {
      onTotalDeadline = () => abortController.abort();
      if (totalDeadlineSignal.aborted)
        onTotalDeadline();
      else
        totalDeadlineSignal.addEventListener("abort", onTotalDeadline, { once: true });
    }
    userSignal = fetchOptions.signal;
    if (userSignal) {
      if (userSignal.aborted) {
        const aborted = new Error("Request aborted by signal before dispatch");
        aborted.code = "ABORT_ERR";
        aborted.name = "AbortError";
        _stats.statusOnNext = "error";
        return buildSmartError(config, fetchOptions, aborted);
      }
      onUserAbort = () => {
        abortController.abort();
      };
      userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
    const settleStageFailure = (err) => {
      if (err.name !== "AbortError")
        throw err;
      const timeoutError = getDeadlineError();
      if (timeoutError !== undefined) {
        _stats.statusOnNext = "error";
        return timeoutError;
      }
      if (userSignal?.aborted) {
        const aborted = new Error("Request aborted by signal");
        aborted.code = "ABORT_ERR";
        aborted.name = "AbortError";
        _stats.statusOnNext = "error";
        return buildSmartError(config, fetchOptions, aborted);
      }
      _stats.statusOnNext = "error";
      return buildSmartError(config, fetchOptions, err);
    };
    const raceWithStageAbort = async (work) => {
      let onStageAbort;
      const aborted = new Promise((_, reject) => {
        onStageAbort = () => {
          const stageAbort = new Error("This operation was aborted");
          stageAbort.name = "AbortError";
          reject(stageAbort);
        };
        if (abortController.signal.aborted) {
          onStageAbort();
          return;
        }
        abortController.signal.addEventListener("abort", onStageAbort, { once: true });
      });
      try {
        return await Promise.race([work, aborted]);
      } finally {
        if (onStageAbort)
          abortController.signal.removeEventListener("abort", onStageAbort);
      }
    };
    const originalFetchRequest = getOriginalFetchRequest(fetchOptions);
    const browserRequest = !Environment.canUseCookieJar && originalFetchRequest !== undefined && originalFetchRequest.body === body && originalFetchRequest.url === url.href ? originalFetchRequest : undefined;
    let preparedBody;
    try {
      claimBodyStream(body, config, fetchOptions);
      if (!browserRequest)
        preparedBody = await raceWithStageAbort(prepareFetchBody(body, config, fetchOptions, abortController.signal));
      if (isWebStreamBody(preparedBody)) {
        const ownedUpload = ownFetchRequestStream(preparedBody, (error) => {
          config.errors ??= [];
          config.errors.push({
            attempt: requestCount,
            duration: 0,
            error: buildSmartError(config, fetchOptions, error instanceof Error ? error : new Error(String(error)))
          });
          debugLog.error(config, error instanceof Error ? error : String(error));
        });
        preparedBody = ownedUpload.body;
        releaseUpload = ownedUpload.release;
      }
    } catch (err) {
      return settleStageFailure(err);
    }
    if (config.transfer && body) {
      if (typeof body === "string") {
        config.transfer.requestSize = new TextEncoder().encode(body).byteLength;
      } else if (requestBodyBytes(body)) {
        config.transfer.requestSize = requestBodyBytes(body).byteLength;
      } else if (isBlobBody(body)) {
        config.transfer.requestSize = body.size;
      } else if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
        config.transfer.requestSize = body.toString().length;
      } else if (body instanceof RezoFormData && typeof body.getLengthSync === "function") {
        const len = body.getLengthSync();
        if (len !== undefined) {
          config.transfer.requestSize = len;
        }
      } else if (typeof body === "object" && !isRawBody(body)) {
        config.transfer.requestSize = JSON.stringify(body).length;
      }
    }
    const credentials = Environment.canUseCookieJar ? "omit" : config.withCredentials !== false ? "include" : "omit";
    const compatibleFetch = getRequestFetchOptions(fetchOptions);
    const fetchInit = {
      ...compatibleFetch,
      method: fetchOptions.method.toUpperCase(),
      headers,
      body: preparedBody,
      signal: abortController.signal,
      redirect: compatibleFetch.redirect === "error" ? "error" : usePlatformRedirects ? compatibleFetch.redirect ?? "follow" : "manual",
      credentials: compatibleFetch.credentials ?? credentials
    };
    if (isWebStreamBody(preparedBody))
      fetchInit.duplex = "half";
    let response;
    try {
      response = await fetch(browserRequest ?? url.toString(), fetchInit);
    } catch (err) {
      if (err instanceof RezoError)
        return err;
      if (!userSignal?.aborted && isPlatformDecodeFailure(err)) {
        _stats.statusOnNext = "error";
        const failure = buildDecompressionError("Decompression failed", config, fetchOptions);
        if (isDownloadMode)
          Object.defineProperty(failure, "cause", { value: decodeFailureSource(err), enumerable: false });
        return failure;
      }
      return settleStageFailure(err);
    }
    requestDeadline?.startBody();
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    const status = response.status;
    const statusText = response.statusText;
    const responseHeaders = fromFetchHeaders(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");
    const responseUrl = response.url || url.href;
    const responseUrlObject = new URL(responseUrl, url);
    config.status = status;
    config.statusText = statusText;
    const declaredContentLength = contentLength === null ? NaN : parseInt(contentLength, 10);
    const contentEncoding = response.headers.get("content-encoding");
    const buildTruncationError = (partialBody, bytesReceived, platformError) => {
      const partialHeaders = new RezoHeaders(responseHeaders);
      partialHeaders.delete("set-cookie");
      const partialData = partialBody === null ? undefined : Environment.isNode ? Buffer.from(partialBody) : partialBody;
      let parsedPartial;
      try {
        parsedPartial = runAfterParseHooks(config, {
          data: partialData,
          rawData: partialData,
          contentType,
          parseDuration: 0,
          timestamp: Date.now()
        });
      } catch (hookFailure) {
        return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
      }
      const partialResponse = {
        data: parsedPartial,
        status,
        statusText,
        headers: partialHeaders,
        cookies: mergeRequestAndResponseCookieSnapshot(config, cookies.array),
        config,
        contentType,
        contentLength: bytesReceived,
        finalUrl: responseUrlObject.href,
        urls: buildUrlTree(config, responseUrlObject.href)
      };
      const truncation = new Error(`fetch body ended before the declared content-length was delivered (received ${bytesReceived} of ${Number.isFinite(declaredContentLength) ? declaredContentLength : "unknown"} bytes)`);
      truncation.code = "ECONNRESET";
      if (platformError !== undefined)
        Object.defineProperty(truncation, "cause", { value: platformError, enumerable: false });
      return RezoError.fromError(truncation, config, fetchOptions, partialResponse);
    };
    const cookies = await parseCookiesFromHeaders(response.headers, responseUrlObject.href, config);
    config.responseCookies = cookies;
    const publicHeaders = new RezoHeaders(responseHeaders);
    publicHeaders.delete("set-cookie");
    const mergedCookies = mergeRequestAndResponseCookieSnapshot(config, cookies.array);
    _stats.redirectUrl = undefined;
    _stats.invalidRedirectLocation = undefined;
    const location = response.headers.get("location");
    const isRedirect = status >= 300 && status < 400 && status !== 304;
    if (isRedirect) {
      _stats.statusOnNext = "redirect";
      if (location) {
        try {
          const redirectUrlObj = new URL(location, url);
          if (!redirectUrlObj.hash && url.hash) {
            redirectUrlObj.hash = url.hash;
          }
          _stats.redirectUrl = redirectUrlObj.href;
        } catch {
          _stats.invalidRedirectLocation = location;
        }
      }
      const partialResponse = {
        data: "",
        status,
        statusText,
        headers: publicHeaders,
        cookies: mergedCookies,
        config,
        contentType,
        contentLength: 0,
        finalUrl: url.href,
        urls: buildUrlTree(config, url.href)
      };
      try {
        await response.body?.cancel();
      } catch {}
      return partialResponse;
    }
    config.finalUrl = responseUrlObject.href;
    const attemptIsTerminal = !attemptContinuesAfterStatus(status);
    _stats.deferredHeaderEvents = undefined;
    if (eventEmitter && !isRedirect) {
      const headersEvent = {
        status,
        statusText,
        headers: publicHeaders,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        cookies: cookies.array,
        timing: {
          firstByte: config.timing.responseStart - config.timing.startTime,
          total: performance.now() - config.timing.startTime
        }
      };
      const publishHeaderTimeEvents = () => {
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
      };
      if (attemptIsTerminal)
        publishHeaderTimeEvents();
      else
        _stats.deferredHeaderEvents = publishHeaderTimeEvents;
    }
    const cancelUnreadResponseBody = () => {
      try {
        const cancellation = response.body?.cancel();
        if (cancellation) {
          cancellation.catch((error) => {
            debugLog.error(config, error instanceof Error ? error : String(error));
          });
        }
      } catch (error) {
        debugLog.error(config, error instanceof Error ? error : String(error));
      }
    };
    const settleInterruptedResponseStage = () => {
      const interruption = new Error("This operation was aborted");
      interruption.name = "AbortError";
      cancelUnreadResponseBody();
      return settleStageFailure(interruption);
    };
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      const ttfb = config.timing.responseStart - config.timing.startTime;
      const headersReceivedEvent = {
        status,
        statusText,
        headers: publicHeaders,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        cookies: cookies.array,
        timing: {
          firstByte: ttfb,
          total: performance.now() - config.timing.startTime
        }
      };
      for (const hook of config.hooks.afterHeaders) {
        try {
          await raceWithStageAbort(Promise.resolve().then(() => hook(headersReceivedEvent, config)));
          if (abortController.signal.aborted)
            return settleInterruptedResponseStage();
        } catch (hookFailure) {
          _stats.statusOnNext = "error";
          if (abortController.signal.aborted)
            return settleInterruptedResponseStage();
          cancelUnreadResponseBody();
          return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
        }
      }
    }
    const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
    let statusAccepted;
    try {
      statusAccepted = status === 304 && allowCacheRevalidation && fetchOptions.validateStatus === undefined || fetchOptions.validateStatus === null || _validateStatus(status) === true;
    } catch (callbackFailure) {
      _stats.statusOnNext = "error";
      try {
        await response.body?.cancel();
      } catch {}
      return buildFetchCallbackFailure(callbackFailure, config, fetchOptions);
    }
    if (streamResult && statusAccepted) {
      const streamFailure = await handleStreamingResponse(response, config, fetchOptions, _stats, timing, streamResult, responseUrlObject, status, statusText, publicHeaders, cookies, userSignal, raceWithStageAbort, getDeadlineError);
      if (streamFailure) {
        _stats.statusOnNext = "error";
        return streamFailure;
      }
      _stats.statusOnNext = streamResult.isFinished() ? "success" : "error";
      return {};
    }
    let responseData;
    let bodyBuffer;
    let rawBody;
    const responseType = config.responseType || fetchOptions.responseType || "auto";
    let salvagedTruncation = false;
    const canSalvageTruncation = (bytes) => fetchOptions.acceptPartialBody === true && bytes.byteLength > 0 && statusAccepted && !userSignal?.aborted && !isDownloadMode && !uploadResult && !streamResult;
    const representBody = (bytes, buffer) => {
      const text = () => new TextDecoder().decode(bytes);
      if (isDownloadMode || responseType === "buffer" || responseType === "arrayBuffer") {
        return Environment.isNode ? Buffer.from(bytes) : buffer;
      }
      if (responseType === "blob")
        return new Blob([new Uint8Array(bytes)], { type: contentType });
      if (responseType === "text")
        return text();
      if (responseType === "json" || contentType.includes("application/json")) {
        try {
          return JSON.parse(text());
        } catch {
          return text();
        }
      }
      return text();
    };
    const parseStart = performance.now();
    try {
      rawBody = await readFetchBody(response, raceWithStageAbort, () => {
        _stats.bodyStarted = true;
      }, (error) => {
        debugLog.error(config, error instanceof Error ? error : String(error));
      });
      bodyBuffer = rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength);
      if (Number.isFinite(declaredContentLength) && !contentEncoding && rawBody.byteLength < declaredContentLength && fetchOptions.method?.toUpperCase() !== "HEAD" && status !== 204 && status !== 304) {
        if (!canSalvageTruncation(rawBody)) {
          _stats.statusOnNext = "error";
          return buildTruncationError(rawBody, rawBody.byteLength, undefined);
        }
        salvagedTruncation = true;
      }
      responseData = representBody(rawBody, bodyBuffer);
    } catch (bodyReadError) {
      const platformError = bodyReadError instanceof FetchBodyReadFailure ? bodyReadError.platformError : bodyReadError;
      if (platformError instanceof RezoError) {
        _stats.statusOnNext = "error";
        return platformError;
      }
      const timeoutError = getDeadlineError();
      if (timeoutError !== undefined) {
        _stats.statusOnNext = "error";
        return timeoutError;
      }
      const partialBody = bodyReadError instanceof FetchBodyReadFailure ? bodyReadError.partialBody : new Uint8Array(0);
      if (!userSignal?.aborted && isPlatformDecodeFailure(platformError)) {
        _stats.statusOnNext = "error";
        let failure;
        try {
          failure = buildDecompressionError({
            statusCode: status,
            headers: responseHeaders.toObject(),
            contentType,
            contentLength: contentLength ?? "0",
            cookies: cookies.setCookiesString,
            statusText: decodeFailureIdentity(platformError) ?? "Decompression failed",
            url: responseUrlObject.href,
            body: null,
            finalUrl: responseUrlObject.href,
            config,
            request: fetchOptions
          });
        } catch (hookFailure) {
          return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
        }
        if (isDownloadMode)
          Object.defineProperty(failure, "cause", { value: decodeFailureSource(platformError), enumerable: false });
        return failure;
      }
      if (!userSignal?.aborted && isTransportTruncation(platformError)) {
        if (!canSalvageTruncation(partialBody)) {
          _stats.statusOnNext = "error";
          return buildTruncationError(partialBody, partialBody.byteLength, platformError);
        }
        salvagedTruncation = true;
        rawBody = partialBody;
        bodyBuffer = partialBody.buffer.slice(partialBody.byteOffset, partialBody.byteOffset + partialBody.byteLength);
        responseData = representBody(partialBody, bodyBuffer);
      } else if (userSignal?.aborted) {
        const aborted = new Error("Request aborted by signal");
        aborted.code = "ABORT_ERR";
        aborted.name = "AbortError";
        const error = buildSmartError(config, fetchOptions, aborted);
        _stats.statusOnNext = "error";
        return error;
      } else {
        throw platformError;
      }
    }
    const bodySize = bodyBuffer?.byteLength || (typeof responseData === "string" ? responseData.length : 0);
    updateTiming(config, timing, bodySize);
    try {
      responseData = runAfterParseHooks(config, {
        data: isDownloadMode ? null : responseData,
        rawData: isDownloadMode ? null : Environment.isNode ? Buffer.from(rawBody) : rawBody,
        contentType,
        parseDuration: performance.now() - parseStart,
        timestamp: Date.now()
      });
    } catch (hookFailure) {
      _stats.statusOnNext = "error";
      return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
    }
    if (isDownloadMode) {
      responseData = Environment.isNode ? Buffer.from(rawBody) : bodyBuffer;
    }
    _stats.statusOnNext = statusAccepted ? "success" : "error";
    const duration = performance.now() - timing.startTime;
    debugLog.response(config, status, statusText, duration);
    debugLog.responseHeaders(config, responseHeaders.toObject());
    debugLog.cookies(config, mergedCookies.array.length);
    debugLog.timing(config, {
      ttfb: timing.firstByteTime ? timing.firstByteTime - timing.startTime : undefined,
      total: duration
    });
    const finalResponse = {
      data: responseData,
      status,
      statusText,
      headers: publicHeaders,
      cookies: mergedCookies,
      config,
      contentType,
      contentLength: bodySize,
      finalUrl: responseUrlObject.href,
      urls: buildUrlTree(config, responseUrlObject.href)
    };
    if (salvagedTruncation)
      finalResponse.truncated = true;
    if (downloadResult && config.fileName && Environment.isNode && statusAccepted) {
      let cleanupFailure;
      let transactionModule;
      try {
        const fs = await importNodeModule("node:fs");
        const pathMod = await importNodeModule("node:path");
        transactionModule = await importNodeModule("../adapters/download-target-transaction.js");
        if (!fs || !pathMod || !transactionModule)
          throw new Error("node:fs, node:path and the download-target transaction are required for file downloads");
        const { dirname } = pathMod;
        const dir = dirname(config.fileName);
        if (dir && dir !== ".")
          fs.mkdirSync(dir, { recursive: true });
        const buffer = bodyBuffer ? Buffer.from(bodyBuffer) : Buffer.from(responseData);
        const transaction = transactionModule.createDownloadTargetTransaction(config.fileName, { operations: fs });
        try {
          transaction.writeBufferAndClose(buffer);
          transaction.commit();
        } catch (writeError) {
          try {
            await transaction.cleanup();
          } catch (cleanupError) {
            cleanupFailure = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
          }
          throw writeError;
        }
        const downloadFinishEvent = {
          status,
          statusText,
          headers: publicHeaders,
          contentType,
          contentLength: buffer.length,
          finalUrl: responseUrlObject.href,
          cookies: mergedCookies,
          urls: buildUrlTree(config, responseUrlObject.href),
          fileName: config.fileName,
          fileSize: buffer.length,
          timing: {
            ...getTimingDurations(config),
            download: getTimingDurations(config).download || 0
          },
          averageSpeed: getTimingDurations(config).download ? buffer.length / getTimingDurations(config).download * 1000 : 0,
          config: sanitizeConfig(config)
        };
        downloadResult.emit("finish", downloadFinishEvent);
        downloadResult.emit("done", downloadFinishEvent);
        downloadResult.emit("complete", downloadFinishEvent);
        downloadResult._markFinished();
      } catch (err) {
        const primaryCause = err instanceof Error ? err : new Error(String(err));
        const failureResponse = {
          data: null,
          status,
          statusText: primaryCause.message || "Download failed",
          headers: publicHeaders,
          cookies: mergedCookies,
          config,
          contentType,
          contentLength: bodySize,
          finalUrl: responseUrlObject.href,
          urls: buildUrlTree(config, responseUrlObject.href)
        };
        const error = RezoError.createDownloadError("Download failed", config, fetchOptions, failureResponse);
        if (transactionModule !== undefined)
          transactionModule.attachDownloadTargetFailureCause(error, primaryCause, cleanupFailure);
        else
          Object.defineProperty(error, "cause", { value: primaryCause, enumerable: false, configurable: true });
        return error;
      }
    }
    if (uploadResult && statusAccepted) {
      const uploadFinishEvent = {
        response: {
          status,
          statusText,
          headers: publicHeaders,
          data: responseData,
          contentType,
          contentLength: bodySize
        },
        finalUrl: responseUrlObject.href,
        cookies: mergedCookies,
        urls: buildUrlTree(config, responseUrlObject.href),
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
    return finalResponse;
  } catch (error) {
    _stats.statusOnNext = "error";
    if (error instanceof RezoError)
      return error;
    return buildSmartError(config, fetchOptions, normaliseFetchFailure(error, userSignal));
  } finally {
    releaseUpload?.();
    if (userSignal && onUserAbort)
      userSignal.removeEventListener("abort", onUserAbort);
    if (phaseDeadlineSignal && onPhaseDeadline)
      phaseDeadlineSignal.removeEventListener("abort", onPhaseDeadline);
    if (requestDeadline?.totalSignal && onTotalDeadline)
      requestDeadline.totalSignal.removeEventListener("abort", onTotalDeadline);
    requestDeadline?.finishAttempt();
  }
}
async function handleStreamingResponse(response, config, fetchOptions, stats, timing, streamResult, url, status, statusText, headers, cookies, userSignal, raceWithStageAbort, getDeadlineError) {
  const reader = response.body ? response.body.getReader() : undefined;
  const releaseReaderLock = () => {
    try {
      reader?.releaseLock();
    } catch {}
  };
  const cancelLockedReader = () => {
    if (reader === undefined)
      return;
    try {
      reader.cancel().then(() => releaseReaderLock(), (error) => {
        debugLog.error(config, error instanceof Error ? error : String(error));
        releaseReaderLock();
      });
    } catch (error) {
      debugLog.error(config, error instanceof Error ? error : String(error));
      releaseReaderLock();
    }
  };
  const mergedCookies = mergeRequestAndResponseCookieSnapshot(config, cookies.array);
  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let bytesReceived = 0;
  const buildStreamTruncation = (platformError) => {
    const partialHeaders = new RezoHeaders(headers);
    partialHeaders.delete("set-cookie");
    const partialResponse = {
      data: undefined,
      status,
      statusText,
      headers: partialHeaders,
      cookies: mergedCookies,
      config,
      contentType: response.headers.get("content-type") || "",
      contentLength: bytesReceived,
      finalUrl: url.href,
      urls: buildUrlTree(config, url.href)
    };
    const truncation = new Error(`fetch body ended before the declared content-length was delivered (received ${bytesReceived} of ${totalBytes || "unknown"} bytes)`);
    truncation.code = "ECONNRESET";
    if (platformError !== undefined)
      Object.defineProperty(truncation, "cause", { value: platformError, enumerable: false });
    return RezoError.fromError(truncation, config, fetchOptions, partialResponse);
  };
  try {
    while (reader !== undefined) {
      const { done, value } = await raceWithStageAbort(reader.read());
      if (done) {
        const declared = headers.get("content-length");
        const declaredLength = declared === null ? NaN : parseInt(String(declared), 10);
        if (Number.isFinite(declaredLength) && !response.headers.get("content-encoding") && bytesReceived < declaredLength) {
          return buildStreamTruncation(undefined);
        }
        break;
      }
      if (value) {
        bytesReceived += value.length;
        stats.bodyStarted = true;
        streamResult.emit("data", Environment.isNode ? Buffer.from(value) : value);
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
    releaseReaderLock();
    updateTiming(config, timing, bytesReceived);
    try {
      const emptyBody = Environment.isNode ? Buffer.alloc(0) : new Uint8Array(0);
      runAfterParseHooks(config, { data: emptyBody, rawData: emptyBody, contentType: response.headers.get("content-type") || "", parseDuration: 0, timestamp: Date.now() });
    } catch (hookFailure) {
      return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
    }
    const streamFinishEvent = {
      status,
      statusText,
      headers,
      contentType: response.headers.get("content-type") || undefined,
      contentLength: bytesReceived,
      finalUrl: url.href,
      cookies: mergedCookies,
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
    return;
  } catch (err) {
    if (config.debug) {
      console.log("[Rezo Debug] Fetch stream error:", err.message, err.stack);
    }
    if (err instanceof RezoError) {
      releaseReaderLock();
      return err;
    }
    const timeoutError = getDeadlineError();
    if (timeoutError !== undefined) {
      cancelLockedReader();
      return timeoutError;
    }
    if (userSignal?.aborted || err.name === "AbortError")
      cancelLockedReader();
    else
      releaseReaderLock();
    if (!userSignal?.aborted && isPlatformDecodeFailure(err)) {
      let failure;
      try {
        failure = buildDecompressionError({
          statusCode: status,
          headers: headers.toObject(),
          contentType: response.headers.get("content-type") || "",
          contentLength: response.headers.get("content-length") ?? "0",
          cookies: cookies.setCookiesString,
          statusText: decodeFailureIdentity(err) ?? "Decompression failed",
          url: url.href,
          body: null,
          finalUrl: url.href,
          config,
          request: fetchOptions
        });
      } catch (hookFailure) {
        return buildFetchCallbackFailure(hookFailure, config, fetchOptions);
      }
      return failure;
    }
    if (!userSignal?.aborted && isTransportTruncation(err))
      return buildStreamTruncation(err);
    return buildSmartError(config, fetchOptions, normaliseFetchFailure(err, userSignal));
  }
}

export { Environment };
registerAdapterCapabilities(executeRequest, {
  evaluateRedirectVisibility: evaluateFetchRedirectVisibility
});
