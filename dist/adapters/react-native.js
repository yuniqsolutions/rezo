import { assertInputTransport } from '../utils/request-fetch-options.js';
import { resolveResponseType } from '../shared/resolve-response-type.js';
import { isRawBody, isStreamBody, claimBodyStream, requestBodyBytes } from '../utils/request-body.js';
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse, buildRedirectControlError } from '../responses/buildError.js';
import { RezoCookieJar } from '../cookies/cookie-jar.js';
import { runTransformHooks, settleFacadeError } from '../core/hooks.js';
import RezoFormData from '../utils/form-data.js';
import { getDefaultConfig, prepareHTTPOptions, calculateRetryDelay, shouldRetry } from '../utils/http-config.js';
import { prepareRedirectHeaders, RezoHeaders } from '../utils/headers.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { invokeUniversalEventListener } from '../responses/universal/event-emitter.js';
import { RezoPerformance, isSameDomain } from '../utils/tools.js';
import {
  composeRedirectHeaders,
  createRedirectHeaderPolicyState,
  stageRedirectHeaderTransition
} from '../utils/redirect-header-policy.js';
import { sanitizeConfig } from '../responses/sanitize-config.js';
import { ResponseCache } from '../cache/universal-response-cache.js';
import { takeCoreCacheOwnership } from '../cache/response-cache-ownership.js';
import { handleRateLimitWait, shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
import { resolveTimeoutMs } from '../utils/staged-timeout.js';
import { debugErrorDump } from '../utils/debug-error-dump.js';
import {
  collectRedirectGuarantees,
  formatUnsupportedRedirectCapabilities,
  hiddenRedirectVisibility,
  registerAdapterCapabilities,
  visibleRedirectVisibility
} from '../core/adapter-capabilities.js';
const Environment = {
  get isReactNative() {
    return typeof navigator !== "undefined" && navigator.product === "ReactNative";
  },
  get isExpo() {
    return typeof globalThis.expo !== "undefined";
  },
  get hasFetch() {
    return typeof fetch !== "undefined";
  },
  get hasBlob() {
    return typeof Blob !== "undefined";
  },
  get hasFormData() {
    return typeof FormData !== "undefined";
  },
  get hasAbortController() {
    return typeof AbortController !== "undefined";
  }
};
const debugLog = {
  requestStart: (config, url, method) => {
    if (config.debug) {
      console.log(`
[Rezo Debug] ─────────────────────────────────────`);
      console.log(`[Rezo Debug] ${method} ${url}`);
      console.log(`[Rezo Debug] Request ID: ${config.requestId}`);
      console.log(`[Rezo Debug] Adapter: react-native`);
      if (config.originalRequest?.headers) {
        const headers = config.originalRequest.headers instanceof RezoHeaders ? config.originalRequest.headers.toObject() : config.originalRequest.headers;
        console.log(`[Rezo Debug] Request Headers:`, JSON.stringify(headers, null, 2));
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
      if (error instanceof Error)
        debugErrorDump(config, error);
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
function createEmptyCookies() {
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
function normalizeResponseType(responseType) {
  if (!responseType)
    return "auto";
  const lower = responseType.toLowerCase();
  if (lower === "arraybuffer")
    return "arrayBuffer";
  if (lower === "binary")
    return "buffer";
  return responseType;
}
async function parseCookiesFromHeaders(headers, url, config) {
  let setCookieHeaders = [];
  const headersWithGetSetCookie = headers;
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    setCookieHeaders = headersWithGetSetCookie.getSetCookie() || [];
  } else {
    const rawSetCookie = headers.get("set-cookie");
    if (rawSetCookie) {
      const splitPattern = /,(?=\s*[A-Za-z0-9_-]+=)/;
      setCookieHeaders = rawSetCookie.split(splitPattern).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (setCookieHeaders.length === 0) {
    return createEmptyCookies();
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
  return createEmptyCookies();
}
async function runAfterParseHooks(parsedData, rawData, contentType, parseDuration, config) {
  if (!config.hooks?.afterParse || config.hooks.afterParse.length === 0) {
    return parsedData;
  }
  let transformed = parsedData;
  for (const hook of config.hooks.afterParse) {
    const result = await hook({
      data: transformed,
      rawData,
      contentType,
      parseDuration,
      timestamp: Date.now()
    }, config);
    if (result !== undefined && result !== null) {
      transformed = result;
    }
  }
  return transformed;
}
function runOnTimeoutHooks(config, url, elapsed, timeout = resolveTimeoutMs(config.timeout) ?? 0, type = "request") {
  if (config.hooks?.onTimeout && config.hooks.onTimeout.length > 0) {
    for (const hook of config.hooks.onTimeout) {
      try {
        Promise.resolve(hook({
          type,
          timeout,
          elapsed,
          url,
          timestamp: Date.now()
        }, config)).catch(() => {
          return;
        });
      } catch {}
    }
  }
}
function runOnAbortHooks(config, reason, message, url, elapsed) {
  if (config.hooks?.onAbort && config.hooks.onAbort.length > 0) {
    for (const hook of config.hooks.onAbort) {
      try {
        Promise.resolve(hook({
          reason,
          message,
          url,
          elapsed,
          timestamp: Date.now()
        }, config)).catch(() => {
          return;
        });
      } catch {}
    }
  }
}

class ReactNativeRequestLifetime {
  config;
  request;
  url;
  controller = new AbortController;
  startedAt = performance.now();
  totalTimeout;
  bodyTimeout;
  callerSignal;
  callerAbortListener;
  totalTimer;
  cancellationError = null;
  finished = false;
  constructor(config, request, timeout, callerSignal, url) {
    this.config = config;
    this.request = request;
    this.url = url;
    this.totalTimeout = typeof timeout === "number" ? timeout : timeout?.total;
    this.bodyTimeout = typeof timeout === "object" && timeout !== null ? timeout.body : undefined;
    this.callerSignal = callerSignal;
    this.callerAbortListener = () => this.cancel("signal");
    if (callerSignal?.aborted) {
      this.cancel("signal");
    } else if (callerSignal) {
      callerSignal.addEventListener("abort", this.callerAbortListener, { once: true });
    }
    if (this.totalTimeout !== undefined && this.totalTimeout > 0 && !this.cancellationError) {
      this.totalTimer = setTimeout(() => this.cancel("total"), this.totalTimeout);
    }
  }
  get signal() {
    return this.controller.signal;
  }
  get active() {
    return !this.finished && this.cancellationError === null;
  }
  assertActive() {
    if (this.cancellationError)
      throw this.cancellationError;
    if (this.finished) {
      throw RezoError.createAbortError("React Native request lifetime has ended", this.config, this.request);
    }
  }
  isCancellation(error) {
    return error === this.cancellationError;
  }
  async run(operation) {
    this.assertActive();
    const operationPromise = Promise.resolve().then(() => {
      this.assertActive();
      return operation();
    });
    if (!this.active)
      throw this.cancellationError;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler, value) => {
        if (settled)
          return;
        settled = true;
        this.signal.removeEventListener("abort", onAbort);
        handler(value);
      };
      const onAbort = () => finish(reject, this.cancellationError ?? RezoError.createAbortError("Request was aborted", this.config, this.request));
      this.signal.addEventListener("abort", onAbort, { once: true });
      if (!this.active) {
        onAbort();
        return;
      }
      operationPromise.then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  }
  async runBody(operation) {
    if (this.bodyTimeout === undefined || this.bodyTimeout <= 0) {
      return this.run(operation);
    }
    const bodyTimer = setTimeout(() => this.cancel("body"), this.bodyTimeout);
    try {
      return await this.run(operation);
    } finally {
      clearTimeout(bodyTimer);
    }
  }
  async delay(milliseconds) {
    if (milliseconds <= 0) {
      this.assertActive();
      return;
    }
    let timer;
    try {
      await this.run(() => new Promise((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }));
    } finally {
      if (timer !== undefined)
        clearTimeout(timer);
    }
  }
  createAttempt() {
    this.assertActive();
    return new ReactNativeAttemptLifetime(this);
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    if (this.totalTimer !== undefined)
      clearTimeout(this.totalTimer);
    this.totalTimer = undefined;
    this.callerSignal?.removeEventListener("abort", this.callerAbortListener);
  }
  cancel(reason) {
    if (this.cancellationError || this.finished)
      return;
    const elapsed = performance.now() - this.startedAt;
    if (reason === "signal") {
      this.cancellationError = RezoError.createAbortError("Request was aborted", this.config, this.request);
      runOnAbortHooks(this.config, "signal", this.cancellationError.message, this.url, elapsed);
    } else {
      const configuredTimeout = reason === "body" ? this.bodyTimeout : this.totalTimeout;
      this.cancellationError = RezoError.createTimeoutError(`${reason === "body" ? "Response body" : "Request"} timeout after ${configuredTimeout ?? 0}ms`, this.config, this.request);
      runOnTimeoutHooks(this.config, this.url, elapsed, configuredTimeout ?? 0, reason === "body" ? "response" : "request");
    }
    if (this.totalTimer !== undefined)
      clearTimeout(this.totalTimer);
    this.totalTimer = undefined;
    this.controller.abort();
  }
}

class ReactNativeAttemptLifetime {
  root;
  controller = new AbortController;
  rootAbortListener;
  closed = false;
  transferStarted = false;
  constructor(root) {
    this.root = root;
    this.rootAbortListener = () => this.controller.abort();
    if (root.signal.aborted) {
      this.controller.abort();
    } else {
      root.signal.addEventListener("abort", this.rootAbortListener, { once: true });
    }
  }
  get signal() {
    return this.controller.signal;
  }
  get active() {
    return !this.closed && this.root.active && !this.controller.signal.aborted;
  }
  get publicTransferStarted() {
    return this.transferStarted;
  }
  run(operation) {
    if (!this.active)
      return this.root.run(() => {
        this.root.assertActive();
        throw new Error("Attempt is closed");
      });
    return this.root.run(operation);
  }
  markPublicTransfer() {
    if (this.active)
      this.transferStarted = true;
  }
  close() {
    if (this.closed)
      return;
    this.closed = true;
    this.root.signal.removeEventListener("abort", this.rootAbortListener);
  }
}

class ReactNativeFacadeSettlement {
  facade;
  terminal = false;
  deferredSuccess;
  constructor(facade) {
    this.facade = facade;
  }
  deferSuccess(publish) {
    if (!this.terminal)
      this.deferredSuccess = publish;
  }
  publishSuccess() {
    if (this.terminal)
      return;
    this.terminal = true;
    const publish = this.deferredSuccess;
    this.deferredSuccess = undefined;
    publish?.();
  }
  async publishError(error, hooks) {
    if (this.terminal)
      return;
    this.terminal = true;
    this.deferredSuccess = undefined;
    if (this.facade) {
      await settleFacadeError(hooks, this.facade, error);
    }
  }
}
const REACT_NATIVE_REPLAY_EVENTS = new Set([
  "initiated",
  "start",
  "headers",
  "status",
  "cookies",
  "error"
]);
function captureReactNativeEarlyFacadeEvent(facade, earlyEvents, event, args) {
  if (typeof event === "string" && REACT_NATIVE_REPLAY_EVENTS.has(event) && facade.listenerCount(event) === 0 && (event !== "error" || !earlyEvents.some((entry) => entry.event === "error"))) {
    earlyEvents.push({ event, args });
  }
}
function replayReactNativeEarlyFacadeEvents(facade, earlyEvents, event, listener, once) {
  if (typeof event !== "string" || earlyEvents.length === 0)
    return;
  if (once) {
    const first = earlyEvents.find((entry) => entry.event === event);
    if (!first)
      return;
    for (let index = earlyEvents.length - 1;index >= 0; index -= 1) {
      if (earlyEvents[index]?.event === event)
        earlyEvents.splice(index, 1);
    }
    facade.off(event, listener);
    invokeUniversalEventListener(listener, first.args, "once listener");
    return;
  }
  const replay = earlyEvents.filter((entry) => entry.event === event);
  if (replay.length === 0)
    return;
  for (let index = earlyEvents.length - 1;index >= 0; index -= 1) {
    if (earlyEvents[index]?.event === event)
      earlyEvents.splice(index, 1);
  }
  for (const entry of replay) {
    invokeUniversalEventListener(listener, entry.args);
  }
}
const ReactNativeStreamResponse = class UniversalStreamResponse extends StreamResponse {
  earlyEvents = [];
  emit(event, ...args) {
    if (event === "error") {
      captureReactNativeEarlyFacadeEvent(this, this.earlyEvents, event, args);
    }
    return super.emit(event, ...args);
  }
  on(event, listener) {
    super.on(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, false);
    return this;
  }
  once(event, listener) {
    super.once(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, true);
    return this;
  }
};

class ReactNativeDownloadResponse extends DownloadResponse {
  earlyEvents = [];
  emit(event, ...args) {
    captureReactNativeEarlyFacadeEvent(this, this.earlyEvents, event, args);
    return super.emit(event, ...args);
  }
  on(event, listener) {
    super.on(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, false);
    return this;
  }
  once(event, listener) {
    super.once(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, true);
    return this;
  }
}

class ReactNativeUploadResponse extends UploadResponse {
  earlyEvents = [];
  emit(event, ...args) {
    captureReactNativeEarlyFacadeEvent(this, this.earlyEvents, event, args);
    return super.emit(event, ...args);
  }
  on(event, listener) {
    super.on(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, false);
    return this;
  }
  once(event, listener) {
    super.once(event, listener);
    replayReactNativeEarlyFacadeEvents(this, this.earlyEvents, event, listener, true);
    return this;
  }
}
function assertSupportedReactNativeTimeoutStages(timeout, config, request) {
  if (typeof timeout !== "object" || timeout === null)
    return;
  if (typeof timeout.connect === "number" && timeout.connect > 0) {
    throw new RezoError("React Native providers cannot expose an enforceable connect timeout phase", config, "REZ_UNSUPPORTED_CAPABILITY", request);
  }
  if (typeof timeout.headers === "number" && timeout.headers > 0) {
    throw new RezoError("React Native providers cannot expose an enforceable headers timeout phase", config, "REZ_UNSUPPORTED_CAPABILITY", request);
  }
}
function resolveReactNativeProviderTimeout(timeout) {
  if (typeof timeout === "number")
    return timeout > 0 ? timeout : null;
  if (typeof timeout === "object" && timeout !== null && typeof timeout.total === "number") {
    return timeout.total > 0 ? timeout.total : null;
  }
  return null;
}
function createReactNativeHookError(config, request, cause) {
  const normalizedCause = cause instanceof Error ? cause : new Error(String(cause));
  const error = new RezoError(normalizedCause.message || "React Native lifecycle hook failed", config, "REZ_UNKNOWN_ERROR", request);
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
}
async function executeReactNativeRequestWithRetry(execution) {
  const {
    lifetime,
    config,
    fetchOptions,
    options,
    perform,
    eventEmitter,
    beforeAttempt,
    executeAttempt,
    handleRedirect
  } = execution;
  const retryConfig = config.retry;
  const absoluteMaxAttempts = 50;
  let totalAttempts = 0;
  let retriesUsed = 0;
  let failureOrdinal = 0;
  eventEmitter?.emit("initiated");
  while (true) {
    lifetime.assertActive();
    totalAttempts += 1;
    if (totalAttempts > absoluteMaxAttempts) {
      throw builErrorFromResponse(`Absolute maximum attempts (${absoluteMaxAttempts}) exceeded.`, { status: 0, statusText: "Max Attempts Exceeded" }, config, fetchOptions);
    }
    beforeAttempt?.();
    const attempt = lifetime.createAttempt();
    let publicTransferStarted = false;
    try {
      let response;
      try {
        response = await attempt.run(() => executeAttempt(attempt));
      } finally {
        publicTransferStarted = attempt.publicTransferStarted;
        attempt.close();
      }
      if (response instanceof RezoError) {
        if (response.response?.status === 304 && requestIssuedConditionalRevalidation(fetchOptions)) {
          return response.response;
        }
        throw response;
      }
      if (isInternalRedirectResponse(response) && handleRedirect) {
        await lifetime.run(() => handleRedirect(response));
        continue;
      }
      return response;
    } catch (error) {
      attempt.close();
      if (lifetime.isCancellation(error))
        throw error;
      const rezoError = error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
      if (!publicTransferStarted && rezoError.response?.status && shouldWaitOnStatus(rezoError.response.status, options.waitOnStatus)) {
        const rateLimitWaitAttempt = config._rateLimitWaitAttempt || 0;
        const waitResult = await lifetime.run(() => handleRateLimitWait({
          status: rezoError.response.status,
          headers: rezoError.response.headers,
          data: rezoError.response.data,
          url: fetchOptions.fullUrl || fetchOptions.url?.toString() || "",
          method: fetchOptions.method || "GET",
          config,
          options,
          currentWaitAttempt: rateLimitWaitAttempt,
          signal: lifetime.signal,
          isActive: () => lifetime.active
        }));
        lifetime.assertActive();
        if (waitResult.shouldRetry) {
          config._rateLimitWaitAttempt = waitResult.waitAttempt;
          perform.reset();
          continue;
        }
      }
      failureOrdinal += 1;
      config.errors.push({
        attempt: failureOrdinal,
        error: rezoError,
        duration: perform.now()
      });
      perform.reset();
      if (!retryConfig || publicTransferStarted)
        throw rezoError;
      const retryAttempt = retriesUsed + 1;
      if (retriesUsed >= retryConfig.maxRetries) {
        debugLog.maxRetries(config, retryConfig.maxRetries);
        if (retryConfig.onRetryExhausted) {
          await lifetime.run(() => retryConfig.onRetryExhausted(rezoError, failureOrdinal));
        }
        throw rezoError;
      }
      if (retryConfig.condition) {
        const shouldContinue = await lifetime.run(() => retryConfig.condition(rezoError, retryAttempt));
        if (shouldContinue === false) {
          if (retryConfig.onRetryExhausted) {
            await lifetime.run(() => retryConfig.onRetryExhausted(rezoError, retryAttempt));
          }
          throw rezoError;
        }
      } else if (!shouldRetry(rezoError, retryAttempt, fetchOptions.method || "GET", retryConfig)) {
        throw rezoError;
      }
      const currentDelay = calculateRetryDelay(retryAttempt, retryConfig.retryDelay, retryConfig.backoff, retryConfig.maxDelay);
      debugLog.retry(config, retryAttempt, retryConfig.maxRetries, rezoError.status || 0, currentDelay);
      if (retryConfig.onRetry) {
        const shouldProceed = await lifetime.run(() => retryConfig.onRetry(rezoError, retryAttempt, currentDelay));
        if (shouldProceed === false)
          throw rezoError;
      }
      if (config.hooks?.beforeRetry) {
        for (const hook of config.hooks.beforeRetry) {
          try {
            await lifetime.run(() => hook(config, rezoError, retryAttempt));
          } catch (hookError) {
            if (lifetime.isCancellation(hookError))
              throw hookError;
            throw createReactNativeHookError(config, fetchOptions, hookError);
          }
        }
      }
      await lifetime.delay(currentDelay);
      retriesUsed += 1;
      config.retryAttempts = retriesUsed;
    }
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
    cookies: createEmptyCookies(),
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
function isInternalRedirectResponse(response) {
  return typeof response.__redirectLocation === "string";
}
function resolveRedirectLocation(fromUrl, location) {
  const redirectUrl = new URL(location, fromUrl);
  const currentUrl = new URL(fromUrl);
  if (!redirectUrl.hash && currentUrl.hash) {
    redirectUrl.hash = currentUrl.hash;
  }
  return redirectUrl.href;
}
const ABSENT_REDIRECT_HEADER_FIELD = Object.freeze({ kind: "absent" });
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REDIRECT_CONNECTION_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_REDIRECT_REQUEST_HEADERS = Object.freeze([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
function encodeBasicCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let encoded = "";
  for (let index = 0;index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = first << 16 | (second ?? 0) << 8 | (third ?? 0);
    encoded += BASE64_ALPHABET[combined >>> 18 & 63];
    encoded += BASE64_ALPHABET[combined >>> 12 & 63];
    encoded += second === undefined ? "=" : BASE64_ALPHABET[combined >>> 6 & 63];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[combined & 63];
  }
  return `Basic ${encoded}`;
}
function decodeUrlCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function normalizeReactNativeRequest(options, defaultOptions) {
  const headers = new RezoHeaders(options.headers || {});
  const defaultHeaders = new RezoHeaders(defaultOptions.headers || {});
  defaultHeaders.forEach((value, name) => {
    if (value && !headers.has(name))
      headers.append(name, value);
  });
  const literalCookie = headers.get("cookie");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  const normalizedOptions = { ...options, headers };
  const requestWithJson = options;
  if (options.body === undefined && Object.prototype.hasOwnProperty.call(requestWithJson, "json") && requestWithJson.json !== undefined) {
    normalizedOptions.body = JSON.stringify(requestWithJson.json);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json");
  }
  let urlAuth;
  const rawUrl = options.fullUrl || (typeof options.url === "string" ? options.url : options.url?.toString() || "");
  try {
    const parsed = new URL(rawUrl, options.baseURL || defaultOptions.baseURL);
    if (parsed.username || parsed.password) {
      urlAuth = {
        username: decodeUrlCredential(parsed.username),
        password: decodeUrlCredential(parsed.password)
      };
      parsed.username = "";
      parsed.password = "";
      normalizedOptions.url = parsed.href;
      if (options.fullUrl)
        normalizedOptions.fullUrl = parsed.href;
    }
  } catch {}
  const auth = options.auth || defaultOptions.auth || urlAuth;
  if (auth)
    normalizedOptions.auth = auth;
  if (!headers.has("authorization") && auth) {
    headers.set("authorization", encodeBasicCredentials(auth.username, auth.password));
  }
  return Object.freeze({
    options: normalizedOptions,
    literalCookie,
    originHeaders: new RezoHeaders(headers)
  });
}
function getEffectiveCoreHooks(defaultOptions) {
  return defaultOptions._hooks;
}
function createHiddenRedirectCapabilityError(lane, guarantees, config, request) {
  return new RezoError(formatUnsupportedRedirectCapabilities(lane, guarantees), config, "REZ_UNSUPPORTED_CAPABILITY", request);
}
function redirectHeaderField(value, field) {
  if (value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, field)) {
    return Object.freeze({ kind: "present", value: Reflect.get(value, field) });
  }
  return ABSENT_REDIRECT_HEADER_FIELD;
}
function createDestinationHeaders(config, runtime, destinationUrl, targetBase) {
  const destinationHeaders = new RezoHeaders;
  if (config.disableJar || config.useCookies === false || !config.jar) {
    return destinationHeaders;
  }
  const cookieHeader = config.jar.getCookieHeader(destinationUrl);
  if (cookieHeader) {
    const inheritedCookie = targetBase.get("cookie");
    destinationHeaders.set("cookie", inheritedCookie ? `${inheritedCookie}; ${cookieHeader}` : cookieHeader);
  }
  if (runtime.xsrfCookieName && runtime.xsrfHeaderName) {
    const token = config.jar.getCookiesForRequest(destinationUrl).find((cookie) => cookie.key === runtime.xsrfCookieName)?.value;
    if (token)
      destinationHeaders.set(runtime.xsrfHeaderName, token);
  }
  return destinationHeaders;
}
function createRedirectBaseHeaders(runtime, relation, method, body, preserveRepresentation) {
  const base = relation === "same-origin" ? prepareRedirectHeaders(runtime.baseHeaders, relation) : new RezoHeaders;
  if (relation !== "same-origin" && preserveRepresentation && body !== undefined && body !== null) {
    const contentType = runtime.baseHeaders.get("content-type");
    const contentEncoding = runtime.baseHeaders.get("content-encoding");
    if (contentType)
      base.set("content-type", contentType);
    if (contentEncoding)
      base.set("content-encoding", contentEncoding);
  }
  base.delete("host");
  base.delete("proxy-authorization");
  if (!preserveRepresentation) {
    base.delete("content-type");
    base.delete("content-encoding");
  }
  if (body === undefined || body === null || method === "GET" || method === "HEAD") {
    base.delete("content-type");
    base.delete("content-length");
    base.delete("content-encoding");
  } else {
    base.delete("content-length");
  }
  return base;
}
function enforceReactNativeRedirectGuardrails(headers, method, body) {
  const connection = headers.get("connection");
  if (connection) {
    for (const token of connection.split(",")) {
      const name = token.trim();
      if (REDIRECT_CONNECTION_TOKEN.test(name))
        headers.delete(name);
    }
  }
  for (const name of FORBIDDEN_REDIRECT_REQUEST_HEADERS)
    headers.delete(name);
  headers.delete("content-length");
  if (body === undefined || body === null || method === "GET" || method === "HEAD") {
    headers.delete("content-type");
    headers.delete("content-encoding");
  }
}
function refreshReactNativeRedirectHeaders(config, runtime, fetchOptions) {
  const destinationHeaders = createDestinationHeaders(config, runtime, runtime.state.currentUrl, runtime.baseHeaders);
  const headers = composeRedirectHeaders(runtime.state, {
    targetBase: runtime.baseHeaders,
    destinationHeaders
  });
  enforceReactNativeRedirectGuardrails(headers, (fetchOptions.method || "GET").toUpperCase(), fetchOptions.body);
  fetchOptions.headers = headers;
}
function redirectCallbackError(error, config, request) {
  if (error instanceof RezoError)
    return error;
  if (error instanceof Error)
    return RezoError.fromError(error, config, request);
  return new RezoError("Redirect callback failed", config, "REZ_UNKNOWN_ERROR", request);
}
function emitObservedRedirect(streamResult, sourceUrl, destinationUrl, status, statusText, headers, cookies, method, redirectCount, maxRedirects, duration) {
  const redirectEvent = {
    sourceUrl,
    sourceStatus: status,
    sourceStatusText: statusText,
    destinationUrl,
    redirectCount,
    maxRedirects,
    headers,
    cookies,
    method,
    timestamp: performance.now(),
    duration
  };
  streamResult.emit("redirect", redirectEvent);
}
async function applyManualRedirect(config, fetchOptions, runtime, response, duration, streamResult) {
  const location = response.__redirectLocation;
  const fromUrl = runtime.state.currentUrl;
  if (config.maxRedirects === 0) {
    config.maxRedirectsReached = true;
    throw new RezoError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
  }
  const redirectCode = response.status;
  let onRedirect;
  try {
    if (config.hooks?.beforeRedirect && config.hooks.beforeRedirect.length > 0) {
      const redirectContext = {
        redirectUrl: new URL(location),
        fromUrl,
        status: response.status,
        headers: response.headers,
        sameDomain: isSameDomain(fromUrl, location),
        method: (fetchOptions.method || "GET").toUpperCase(),
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
    onRedirect = redirectCallback ? redirectCallback({
      url: new URL(location),
      status: response.status,
      headers: response.headers,
      sameDomain: isSameDomain(fromUrl, location),
      method: (fetchOptions.method || "GET").toUpperCase(),
      body: config.originalBody
    }) : undefined;
  } catch (error) {
    throw redirectCallbackError(error, config, fetchOptions);
  }
  const redirectDecision = onRedirect !== null && typeof onRedirect === "object" ? onRedirect : undefined;
  if (typeof onRedirect !== "undefined") {
    if (typeof onRedirect === "boolean" && !onRedirect) {
      throw new RezoError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
    }
    if (redirectDecision && !redirectDecision.redirect && !redirectDecision.withoutBody && !("body" in redirectDecision)) {
      throw new RezoError("Redirect denied by user", config, "REZ_REDIRECT_DENIED", fetchOptions, response);
    }
  }
  if (config.redirectCount >= config.maxRedirects && config.maxRedirects > 0) {
    config.maxRedirectsReached = true;
    throw new RezoError(`Max redirects (${config.maxRedirects}) reached`, config, "REZ_MAX_REDIRECTS_EXCEEDED", fetchOptions, response);
  }
  const normalizedRedirect = redirectDecision ? redirectDecision.redirect || redirectDecision.withoutBody || "body" in redirectDecision : undefined;
  let finalizedUrl = location;
  let nextMethod = (fetchOptions.method || "GET").toUpperCase();
  let nextBody = fetchOptions.body;
  let nextOriginalBody = config.originalBody;
  let preserveRepresentation = true;
  if (redirectDecision && normalizedRedirect) {
    const userMethod = redirectDecision.method;
    if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
      nextMethod = (userMethod || "GET").toUpperCase();
    } else {
      nextMethod = (userMethod || nextMethod).toUpperCase();
    }
    if (redirectDecision.redirect && redirectDecision.url) {
      finalizedUrl = redirectDecision.url;
    }
    if (redirectDecision.withoutBody) {
      nextBody = undefined;
      nextOriginalBody = undefined;
      preserveRepresentation = false;
    } else if ("body" in redirectDecision) {
      nextBody = redirectDecision.body;
      nextOriginalBody = redirectDecision.body;
      preserveRepresentation = false;
    } else if (redirectCode === 307 || redirectCode === 308) {
      if ((nextMethod === "POST" || nextMethod === "PUT" || nextMethod === "PATCH") && config.originalBody !== undefined) {
        nextBody = fetchOptions.body;
      }
    } else {
      nextBody = undefined;
      nextOriginalBody = undefined;
      preserveRepresentation = false;
    }
  } else if (redirectCode === 301 || redirectCode === 302 || redirectCode === 303) {
    nextMethod = "GET";
    nextBody = undefined;
    nextOriginalBody = undefined;
    preserveRepresentation = false;
  }
  let normalizedFinalizedUrl;
  try {
    normalizedFinalizedUrl = resolveRedirectLocation(fromUrl, finalizedUrl);
  } catch {
    throw new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
  }
  const transition = stageRedirectHeaderTransition(runtime.state, {
    finalizedNormalizedUrl: normalizedFinalizedUrl,
    setHeaders: redirectHeaderField(onRedirect, "setHeaders"),
    setHeadersOnRedirects: redirectHeaderField(onRedirect, "setHeadersOnRedirects")
  });
  if (!transition.ok) {
    const code = transition.reason === "invalid-url" ? "ERR_INVALID_URL" : "ERR_INVALID_ARG_TYPE";
    const message = transition.reason === "invalid-url" ? "Invalid redirect destination URL" : `Invalid redirect header patch "${transition.field}"`;
    throw new RezoError(message, config, code, fetchOptions, response);
  }
  if (transition.relation === "invalid") {
    throw new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", fetchOptions, response);
  }
  if (config.enableRedirectCycleDetection === true && runtime.state.history.some((visited) => visited.toLowerCase() === normalizedFinalizedUrl.toLowerCase())) {
    throw new RezoError(`Redirect cycle detected: ${normalizedFinalizedUrl}`, config, "REZ_REDIRECT_CYCLE_DETECTED", fetchOptions, response);
  }
  const nextBaseHeaders = createRedirectBaseHeaders(runtime, transition.relation, nextMethod, nextBody, preserveRepresentation);
  const destinationHeaders = createDestinationHeaders(config, runtime, normalizedFinalizedUrl, nextBaseHeaders);
  const nextHeaders = composeRedirectHeaders(transition.state, {
    targetBase: nextBaseHeaders,
    destinationHeaders
  });
  enforceReactNativeRedirectGuardrails(nextHeaders, nextMethod, nextBody);
  config.redirectHistory.push({
    url: fromUrl,
    statusCode: redirectCode,
    statusText: response.statusText,
    headers: response.headers,
    method: (fetchOptions.method || "GET").toUpperCase(),
    cookies: config.responseCookies?.array || [],
    duration,
    request: {
      ...fetchOptions,
      headers: fetchOptions.headers instanceof RezoHeaders ? new RezoHeaders(fetchOptions.headers) : fetchOptions.headers
    }
  });
  runtime.state = transition.state;
  runtime.baseHeaders = nextBaseHeaders;
  config.redirectCount = transition.state.redirectCount;
  config.method = nextMethod;
  config.originalBody = nextOriginalBody;
  config.finalUrl = normalizedFinalizedUrl;
  fetchOptions.fullUrl = normalizedFinalizedUrl;
  fetchOptions.method = nextMethod;
  fetchOptions.body = nextBody;
  fetchOptions.headers = nextHeaders;
  debugLog.redirect(config, fromUrl, normalizedFinalizedUrl, redirectCode, nextMethod);
  if (streamResult) {
    emitObservedRedirect(streamResult, fromUrl, normalizedFinalizedUrl, redirectCode, response.statusText, response.headers, config.responseCookies?.array || [], nextMethod, config.redirectCount, config.maxRedirects, duration);
  }
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
function resolveReactNativeRequestOption(options, defaultOptions, name) {
  const requestValue = Reflect.get(options, name);
  return requestValue !== undefined ? requestValue : Reflect.get(defaultOptions, name);
}
async function applyReactNativeRequestTransforms(fetchOptions, options, defaultOptions) {
  const transforms = options.transformRequest ?? defaultOptions.transformRequest;
  if (!transforms || transforms.length === 0)
    return;
  const headers = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  let body = fetchOptions.body;
  for (const transform of transforms) {
    body = await transform(body, headers);
  }
  fetchOptions.body = body;
  fetchOptions.headers = headers;
}
async function applyReactNativeResponseTransforms(data, fetchOptions) {
  const transforms = fetchOptions.transformResponse;
  if (!transforms || transforms.length === 0)
    return data;
  let transformed = data;
  for (const transform of transforms) {
    transformed = await transform(transformed);
  }
  return transformed;
}
function getReactNativeBodyByteLength(body) {
  if (body === null || body === undefined)
    return 0;
  if (typeof body === "string")
    return new TextEncoder().encode(body).byteLength;
  if (typeof body === "number" || typeof body === "boolean") {
    return new TextEncoder().encode(String(body)).byteLength;
  }
  if (requestBodyBytes(body))
    return requestBodyBytes(body).byteLength;
  if (isStreamBody(body))
    return;
  if (typeof Blob !== "undefined" && body instanceof Blob)
    return body.size;
  if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof RezoFormData && typeof body.getLengthSync === "function") {
    return body.getLengthSync();
  }
  if (typeof body === "object") {
    try {
      const serialized = JSON.stringify(body);
      return serialized === undefined ? undefined : new TextEncoder().encode(serialized).byteLength;
    } catch {
      return;
    }
  }
  return;
}
function isJsonResponseContentType(contentType) {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() || "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}
function isBinaryResponseContentType(contentType) {
  return (contentType.split(";", 1)[0]?.trim().toLowerCase() || "") === "application/octet-stream";
}
function createReactNativeInvalidJsonError(rawData, cause, config, request, response) {
  const error = new RezoError("Failed to parse JSON response", config, "REZ_INVALID_JSON", request, { ...response, data: rawData });
  Object.defineProperty(error, "cause", {
    value: cause instanceof Error ? cause : new Error(String(cause)),
    enumerable: false
  });
  return error;
}
async function prepareBody(body) {
  if (body === null || body === undefined)
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
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body;
  }
  if (isRawBody(body)) {
    return body;
  }
  if (typeof body === "object") {
    return JSON.stringify(body);
  }
  return body;
}
function resolveReactNativeOptions(options, defaultOptions) {
  return {
    ...defaultOptions.reactNative || {},
    ...options.reactNative || {},
    fileSystemAdapter: options.reactNative?.fileSystemAdapter || defaultOptions.reactNative?.fileSystemAdapter,
    streamTransport: options.reactNative?.streamTransport || defaultOptions.reactNative?.streamTransport,
    networkInfoProvider: options.reactNative?.networkInfoProvider || defaultOptions.reactNative?.networkInfoProvider,
    backgroundTaskProvider: options.reactNative?.backgroundTaskProvider || defaultOptions.reactNative?.backgroundTaskProvider,
    backgroundTask: options.reactNative?.backgroundTask !== undefined ? options.reactNative.backgroundTask : defaultOptions.reactNative?.backgroundTask,
    upload: options.reactNative?.upload !== undefined ? options.reactNative.upload : defaultOptions.reactNative?.upload
  };
}
function resolveBackgroundTaskConfig(reactNativeOptions) {
  const task = reactNativeOptions.backgroundTask;
  if (!task || task.enabled === false) {
    return null;
  }
  const name = typeof task.name === "string" ? task.name.trim() : "";
  if (!name) {
    throw new Error("React Native background tasks require `reactNative.backgroundTask.name`.");
  }
  return {
    name,
    minimumInterval: task.minimumInterval,
    metadata: task.metadata,
    keepRegistered: task.keepRegistered === true
  };
}
function resolveNativeDownloadTarget(options) {
  const internal = options;
  return internal.saveTo || internal.fileName || options.saveTo || options.fileName || undefined;
}
function getFileNameFromUri(uri) {
  const normalized = uri.split("?")[0]?.split("#")[0] || uri;
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1] || "";
  return lastPart || undefined;
}
function normalizeNativeUploadFileSource(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const uri = candidate.uri || candidate.filePath || candidate.filepath || candidate.path;
  if (typeof uri !== "string" || uri.trim().length === 0) {
    return null;
  }
  return {
    uri,
    name: typeof candidate.name === "string" ? candidate.name : typeof candidate.filename === "string" ? candidate.filename : getFileNameFromUri(uri),
    type: typeof candidate.type === "string" ? candidate.type : typeof candidate.filetype === "string" ? candidate.filetype : undefined,
    fieldName: typeof candidate.fieldName === "string" ? candidate.fieldName : typeof candidate.field === "string" ? candidate.field : undefined,
    size: typeof candidate.size === "number" ? candidate.size : undefined
  };
}
function resolveNativeUploadConfig(options, reactNativeOptions) {
  const internal = options;
  const responseType = typeof internal.responseType === "string" ? internal.responseType.toLowerCase() : undefined;
  const isUploadMode = internal._isUpload || responseType === "upload";
  const explicitUpload = reactNativeOptions.upload;
  if (explicitUpload && explicitUpload.enabled !== false) {
    if (!isUploadMode) {
      throw new Error("React Native `reactNative.upload` requires `rezo.upload(...)` or `responseType: 'upload'`.");
    }
    const file = normalizeNativeUploadFileSource(explicitUpload);
    if (!file) {
      throw new Error("React Native file uploads require `reactNative.upload.uri`.");
    }
    return {
      file,
      fields: explicitUpload.fields ? { ...explicitUpload.fields } : undefined,
      binaryStreamOnly: explicitUpload.binaryStreamOnly,
      inferred: false
    };
  }
  if (!isUploadMode) {
    return null;
  }
  const bodyCandidate = options.body ?? options.data;
  const file = normalizeNativeUploadFileSource(bodyCandidate);
  if (!file) {
    return null;
  }
  return {
    file,
    inferred: true
  };
}
function setRequestTransferSize(config, body) {
  if (!config.transfer || body === null || body === undefined) {
    return;
  }
  if (typeof body === "string") {
    config.transfer.requestSize = new TextEncoder().encode(body).byteLength;
  } else if (typeof body === "number" || typeof body === "boolean") {
    config.transfer.requestSize = new TextEncoder().encode(String(body)).byteLength;
  } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    config.transfer.requestSize = body.byteLength;
  } else if (typeof Blob !== "undefined" && body instanceof Blob) {
    config.transfer.requestSize = body.size;
  } else if (body instanceof URLSearchParams || body instanceof RezoURLSearchParams) {
    config.transfer.requestSize = new TextEncoder().encode(body.toString()).byteLength;
  } else if (body instanceof RezoFormData && typeof body.getLengthSync === "function") {
    const len = body.getLengthSync();
    if (len !== undefined) {
      config.transfer.requestSize = len;
    }
  } else if (typeof body === "object" && !(typeof Blob !== "undefined" && body instanceof Blob)) {
    config.transfer.requestSize = JSON.stringify(body).length;
  }
}
function setNativeUploadTransferSize(config, uploadConfig) {
  if (typeof uploadConfig.file.size === "number" && uploadConfig.file.size >= 0) {
    config.transfer.requestSize = uploadConfig.file.size;
  }
}
function getBinaryResponseData(value) {
  if (value === null || value === undefined) {
    return new ArrayBuffer(0);
  }
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const clone = new Uint8Array(view.byteLength);
    clone.set(view);
    return clone.buffer;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value).buffer;
  }
  return new TextEncoder().encode(JSON.stringify(value ?? "")).buffer;
}
async function parseResponseData(payload, responseType, contentType, config, invalidJsonError) {
  const normalizedResponseType = normalizeResponseType(responseType);
  if (payload === null || payload === undefined) {
    return {
      data: payload,
      rawData: payload,
      bodySize: 0
    };
  }
  if (normalizedResponseType === "blob") {
    const blob = payload instanceof Blob ? payload : new Blob([payload instanceof ArrayBuffer ? payload : typeof payload === "string" ? payload : JSON.stringify(payload ?? "")]);
    return {
      data: blob,
      rawData: blob,
      bodySize: blob.size
    };
  }
  if (normalizedResponseType === "arrayBuffer" || normalizedResponseType === "buffer") {
    const buffer = getBinaryResponseData(payload);
    return {
      data: buffer,
      rawData: buffer,
      bodySize: buffer.byteLength
    };
  }
  if (normalizedResponseType === "text") {
    const text = typeof payload === "string" ? payload : payload instanceof ArrayBuffer ? new TextDecoder().decode(payload) : JSON.stringify(payload ?? "");
    return {
      data: text,
      rawData: text,
      bodySize: text.length
    };
  }
  if (normalizedResponseType === "json") {
    if (typeof payload === "string") {
      try {
        return {
          data: JSON.parse(payload),
          rawData: payload,
          bodySize: payload.length
        };
      } catch (cause) {
        if (invalidJsonError)
          throw invalidJsonError(payload, cause);
        throw cause;
      }
    }
    return {
      data: payload,
      rawData: payload,
      bodySize: JSON.stringify(payload ?? "").length
    };
  }
  if (typeof payload === "string") {
    if (isJsonResponseContentType(contentType)) {
      try {
        return {
          data: JSON.parse(payload),
          rawData: payload,
          bodySize: payload.length
        };
      } catch (cause) {
        if (invalidJsonError)
          throw invalidJsonError(payload, cause);
        if (config.debug) {
          console.log("[Rezo Debug] Failed to parse JSON response payload from native RN upload transport");
        }
        throw cause;
      }
    }
    return {
      data: payload,
      rawData: payload,
      bodySize: payload.length
    };
  }
  return {
    data: payload,
    rawData: payload,
    bodySize: JSON.stringify(payload ?? "").length
  };
}
function captureNativeHeaders(attempt) {
  let captured;
  let fingerprint;
  let conflict = false;
  return {
    accept(event) {
      if (!attempt.active)
        return;
      const nextFingerprint = JSON.stringify(event);
      if (captured === undefined) {
        captured = event;
        fingerprint = nextFingerprint;
      } else if (fingerprint !== nextFingerprint) {
        conflict = true;
      }
    },
    current: () => captured,
    conflicted: () => conflict
  };
}
function createReactNativeProviderError(mode, message, config, request) {
  if (mode === "stream")
    return RezoError.createStreamError(message, config, request);
  if (mode === "download")
    return RezoError.createDownloadError(message, config, request);
  return RezoError.createUploadError(message, config, request);
}
function reconcileReactNativeProviderMetadata(mode, callback, callbackConflict, result, fallbackUrl, config, request) {
  if (callbackConflict) {
    throw createReactNativeProviderError(mode, `React Native ${mode} provider emitted conflicting header callbacks`, config, request);
  }
  const resultHasStatus = Object.prototype.hasOwnProperty.call(result, "status");
  const status = result.status;
  if (!resultHasStatus || typeof status !== "number" || !Number.isFinite(status) || status <= 0) {
    throw createReactNativeProviderError(mode, `React Native ${mode} provider returned an invalid status`, config, request);
  }
  if (callback && Object.prototype.hasOwnProperty.call(callback, "status") && callback.status !== status) {
    throw createReactNativeProviderError(mode, `React Native ${mode} provider callback status conflicts with its result status`, config, request);
  }
  if (callback) {
    for (const field of ["statusText", "finalUrl", "contentType", "contentLength"]) {
      if (Object.prototype.hasOwnProperty.call(callback, field) && Object.prototype.hasOwnProperty.call(result, field) && callback[field] !== result[field]) {
        throw createReactNativeProviderError(mode, `React Native ${mode} provider callback ${field} conflicts with its result metadata`, config, request);
      }
    }
  }
  const callbackHeaders = callback?.headers && typeof callback.headers === "object" ? callback.headers : {};
  const resultHeaders = result.headers && typeof result.headers === "object" ? result.headers : {};
  const normalizedCallbackHeaders = new RezoHeaders(callbackHeaders);
  const normalizedResultHeaders = new RezoHeaders(resultHeaders);
  for (const [name, value] of normalizedCallbackHeaders.entries()) {
    const resultValue = normalizedResultHeaders.get(name);
    if (resultValue !== null && resultValue !== value) {
      throw createReactNativeProviderError(mode, `React Native ${mode} provider callback header ${name} conflicts with its result metadata`, config, request);
    }
  }
  const headers = { ...callbackHeaders, ...resultHeaders };
  const normalizedHeaders = new RezoHeaders(headers);
  const resultStatusText = typeof result.statusText === "string" ? result.statusText : undefined;
  const resultFinalUrl = typeof result.finalUrl === "string" ? result.finalUrl : undefined;
  const resultContentType = typeof result.contentType === "string" ? result.contentType : undefined;
  const resultContentLength = typeof result.contentLength === "number" && Number.isFinite(result.contentLength) ? result.contentLength : undefined;
  const callbackContentType = typeof callback?.contentType === "string" ? callback.contentType : undefined;
  const callbackContentLength = typeof callback?.contentLength === "number" && Number.isFinite(callback.contentLength) ? callback.contentLength : undefined;
  const parseHeaderContentLength = (value) => {
    if (value === null)
      return;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const hasCrossRepresentationConflict = (callbackValues, resultValues) => callbackValues.some((callbackValue) => callbackValue !== undefined && resultValues.some((resultValue) => resultValue !== undefined && !Object.is(callbackValue, resultValue)));
  if (hasCrossRepresentationConflict([callbackContentType, normalizedCallbackHeaders.get("content-type") ?? undefined], [resultContentType, normalizedResultHeaders.get("content-type") ?? undefined])) {
    throw createReactNativeProviderError(mode, `React Native ${mode} provider callback content type conflicts with its result metadata`, config, request);
  }
  if (hasCrossRepresentationConflict([callbackContentLength, parseHeaderContentLength(normalizedCallbackHeaders.get("content-length"))], [resultContentLength, parseHeaderContentLength(normalizedResultHeaders.get("content-length"))])) {
    throw createReactNativeProviderError(mode, `React Native ${mode} provider callback content length conflicts with its result metadata`, config, request);
  }
  return {
    status,
    statusText: resultStatusText ?? callback?.statusText ?? "OK",
    headers,
    finalUrl: resultFinalUrl ?? callback?.finalUrl ?? fallbackUrl,
    contentType: resultContentType ?? callback?.contentType ?? normalizedHeaders.get("content-type") ?? "",
    contentLength: resultContentLength ?? callback?.contentLength ?? (parseInt(normalizedHeaders.get("content-length") || "0", 10) || undefined)
  };
}
function updateReactNativeTrackingData(config, data) {
  const trackingData = config.trackingData && typeof config.trackingData === "object" ? config.trackingData : {};
  const currentReactNative = trackingData.reactNative && typeof trackingData.reactNative === "object" ? trackingData.reactNative : {};
  config.trackingData = {
    ...trackingData,
    reactNative: {
      ...currentReactNative,
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => {
        const currentValue = currentReactNative[key];
        if (value && typeof value === "object" && !Array.isArray(value) && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
          return [key, { ...currentValue, ...value }];
        }
        return [key, value];
      }))
    }
  };
}
function isOfflineNetworkState(state) {
  if (!state) {
    return false;
  }
  return state.isConnected === false || state.isInternetReachable === false;
}
async function captureNetworkState(config, provider, lifetime) {
  if (!provider) {
    return null;
  }
  const checkedAt = Date.now();
  try {
    const state = await lifetime.run(() => provider.fetch());
    updateReactNativeTrackingData(config, {
      networkInfoEnabled: true,
      lastNetworkCheckAt: checkedAt,
      networkState: state
    });
    return state;
  } catch (error) {
    if (lifetime.isCancellation(error))
      throw error;
    updateReactNativeTrackingData(config, {
      networkInfoEnabled: true,
      lastNetworkCheckAt: checkedAt,
      networkInfoError: error instanceof Error ? error.message : String(error)
    });
    if (config.debug) {
      console.log("[Rezo Debug] networkInfoProvider fetch error:", error);
    }
    return null;
  }
}
function createOfflineError(config, request) {
  const error = new RezoError("React Native request blocked because the device is offline.", config, "ENETUNREACH", request);
  error.message = "React Native request blocked because the device is offline.";
  return error;
}
async function prepareBackgroundTaskLifecycle(config, provider, backgroundTask, lifetime) {
  if (!backgroundTask) {
    return;
  }
  if (!provider) {
    throw new Error("React Native background task requests require `reactNative.backgroundTaskProvider`. Install and configure a background task provider to use `reactNative.backgroundTask`.");
  }
  let alreadyRegistered = false;
  let registeredByAdapter = false;
  if (provider.isTaskRegistered) {
    try {
      alreadyRegistered = await lifetime.run(() => provider.isTaskRegistered(backgroundTask.name));
    } catch (error) {
      if (lifetime.isCancellation(error))
        throw error;
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          isTaskRegisteredError: error instanceof Error ? error.message : String(error)
        }
      });
      if (config.debug) {
        console.log("[Rezo Debug] backgroundTaskProvider.isTaskRegistered error:", error);
      }
    }
  }
  if (!alreadyRegistered) {
    await lifetime.run(() => provider.registerTask({
      name: backgroundTask.name,
      minimumInterval: backgroundTask.minimumInterval,
      metadata: backgroundTask.metadata
    }));
    registeredByAdapter = true;
  }
  updateReactNativeTrackingData(config, {
    backgroundTask: {
      name: backgroundTask.name,
      minimumInterval: backgroundTask.minimumInterval,
      keepRegistered: backgroundTask.keepRegistered,
      alreadyRegistered,
      registeredByAdapter,
      active: true
    }
  });
  let cleanupStarted = false;
  return async () => {
    if (cleanupStarted)
      return;
    cleanupStarted = true;
    if (backgroundTask.keepRegistered || !registeredByAdapter) {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregistered: false
        }
      });
      return;
    }
    const markUnregistered = () => {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregistered: true
        }
      });
    };
    const recordUnregisterError = (error) => {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregisterError: error instanceof Error ? error.message : String(error)
        }
      });
      if (config.debug) {
        console.log("[Rezo Debug] backgroundTaskProvider.unregisterTask error:", error);
      }
    };
    if (!lifetime.active) {
      updateReactNativeTrackingData(config, {
        backgroundTask: {
          name: backgroundTask.name,
          keepRegistered: backgroundTask.keepRegistered,
          active: false,
          unregistered: false
        }
      });
      try {
        const detachedCleanup = provider.unregisterTask(backgroundTask.name);
        Promise.resolve(detachedCleanup).catch((error) => {
          if (config.debug) {
            console.log("[Rezo Debug] detached backgroundTaskProvider.unregisterTask error:", error);
          }
        });
      } catch (error) {
        recordUnregisterError(error);
      }
      return;
    }
    try {
      await lifetime.run(() => provider.unregisterTask(backgroundTask.name));
      markUnregistered();
    } catch (error) {
      if (lifetime.isCancellation(error))
        throw error;
      recordUnregisterError(error);
    }
  };
}
function getUnsupportedModeMessage(options, reactNativeOptions, backgroundTask, nativeUpload) {
  const internal = options;
  const responseType = internal.responseType;
  const isStreamMode = internal._isStream || responseType === "stream";
  if (isStreamMode && !reactNativeOptions.streamTransport) {
    return "React Native streaming requires `reactNative.streamTransport`. Configure a dedicated RN streaming transport to use `rezo.stream(...)`.";
  }
  const downloadTarget = resolveNativeDownloadTarget(options);
  if (downloadTarget && !reactNativeOptions.fileSystemAdapter?.downloadFile) {
    return "React Native file downloads require `reactNative.fileSystemAdapter`. Install and configure an Expo FileSystem or react-native-fs adapter to use `saveTo` or `fileName`.";
  }
  if (nativeUpload && !reactNativeOptions.fileSystemAdapter?.uploadFile) {
    return "React Native file uploads require `reactNative.fileSystemAdapter.uploadFile`. Install and configure an RN file upload provider to use `reactNative.upload` or file-based `rezo.upload(...)`.";
  }
  if (backgroundTask && !reactNativeOptions.backgroundTaskProvider) {
    return "React Native background task requests require `reactNative.backgroundTaskProvider`. Install and configure a background task provider to use `reactNative.backgroundTask`.";
  }
  return null;
}
function getReactNativeHiddenRedirectLane(options, reactNativeOptions, nativeDownloadTarget, nativeUpload) {
  const internalOptions = options;
  const responseType = typeof options.responseType === "string" ? options.responseType.toLowerCase() : undefined;
  const usesVisibleStreamTransport = (internalOptions._isStream || responseType === "stream") && !!reactNativeOptions.streamTransport;
  if (nativeDownloadTarget && reactNativeOptions.fileSystemAdapter?.downloadFile) {
    return "react-native-file-download";
  }
  if (nativeUpload && reactNativeOptions.fileSystemAdapter?.uploadFile) {
    return "react-native-file-upload";
  }
  if (Environment.isReactNative && !usesVisibleStreamTransport) {
    return "react-native-stock-fetch";
  }
  return null;
}
function evaluateReactNativeRedirectVisibility(context) {
  if (!Environment.hasFetch)
    return visibleRedirectVisibility();
  try {
    const effectiveRequest = context.request.responseType ? context.request : Object.freeze({
      ...context.request,
      responseType: context.defaults.responseType || "auto"
    });
    const reactNativeOptions = resolveReactNativeOptions(effectiveRequest, context.defaults);
    const backgroundTask = resolveBackgroundTaskConfig(reactNativeOptions);
    const nativeDownloadTarget = resolveNativeDownloadTarget(effectiveRequest);
    const nativeUpload = resolveNativeUploadConfig(effectiveRequest, reactNativeOptions);
    if (getUnsupportedModeMessage(effectiveRequest, reactNativeOptions, backgroundTask, nativeUpload)) {
      return visibleRedirectVisibility();
    }
    const lane = getReactNativeHiddenRedirectLane(effectiveRequest, reactNativeOptions, nativeDownloadTarget, nativeUpload);
    return lane ? hiddenRedirectVisibility(lane) : visibleRedirectVisibility();
  } catch {
    return visibleRedirectVisibility();
  }
}
function isPositiveReactNativeRate(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0;
  return Array.isArray(value) && value.some((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
}
function getUnsupportedReactNativeOption(options, defaultOptions) {
  const value = (name) => resolveReactNativeRequestOption(options, defaultOptions, name);
  const unsupported = (name) => ({
    name,
    message: `React Native adapter does not support the \`${name}\` option.`
  });
  if (isPositiveReactNativeRate(value("maxRate")))
    return unsupported("maxRate");
  if (value("responseEncoding") !== undefined)
    return unsupported("responseEncoding");
  if (value("encoding") !== undefined)
    return unsupported("encoding");
  if (value("decompress") === false)
    return unsupported("decompress");
  if (value("acceptPartialBody") === true)
    return unsupported("acceptPartialBody");
  if (value("proxy") !== undefined && value("proxy") !== null && value("proxy") !== false)
    return unsupported("proxy");
  if (value("httpAgent") !== undefined && value("httpAgent") !== null)
    return unsupported("httpAgent");
  if (value("httpsAgent") !== undefined && value("httpsAgent") !== null)
    return unsupported("httpsAgent");
  if (value("dnsLookup") !== undefined && value("dnsLookup") !== null)
    return unsupported("dnsLookup");
  if (value("dnsCache") === true || typeof value("dnsCache") === "object" && value("dnsCache") !== null) {
    return unsupported("dnsCache");
  }
  if (value("rejectUnauthorized") === false)
    return unsupported("rejectUnauthorized");
  if (value("secureContext") !== undefined && value("secureContext") !== null)
    return unsupported("secureContext");
  if (value("useSecureContext") === true)
    return unsupported("useSecureContext");
  if (typeof value("socketPath") === "string" && value("socketPath") !== "")
    return unsupported("socketPath");
  if (value("http2") === true)
    return unsupported("http2");
  return null;
}
function requestIssuedConditionalRevalidation(options) {
  const headers = options.headers;
  if (!headers)
    return false;
  const names = headers instanceof RezoHeaders ? Array.from(headers.keys()) : Object.keys(headers);
  return names.some((name) => {
    const lower = name.toLowerCase();
    return lower === "if-none-match" || lower === "if-modified-since";
  });
}
export async function executeRequest(options, defaultOptions, jar) {
  const coreDispatchIdentity = options;
  const canonicalResponseType = resolveResponseType(options.responseType, defaultOptions?.responseType, options);
  if (options.responseType !== canonicalResponseType) {
    options = { ...options, responseType: canonicalResponseType };
  }
  assertInputTransport(options, defaultOptions, "react-native");
  if (!Environment.hasFetch) {
    throw new Error("Fetch API is not available in this React Native environment");
  }
  const redirectGuarantees = collectRedirectGuarantees(Object.freeze({
    request: options,
    defaults: defaultOptions,
    effectiveHooks: getEffectiveCoreHooks(defaultOptions) ?? {}
  }));
  const normalizedRequest = normalizeReactNativeRequest(options, defaultOptions);
  options = normalizedRequest.options;
  const requestedMethod = (options.method || "GET").toUpperCase();
  if (!options.responseType) {
    options.responseType = defaultOptions.responseType || "auto";
  }
  const reactNativeOptions = resolveReactNativeOptions(options, defaultOptions);
  const backgroundTask = resolveBackgroundTaskConfig(reactNativeOptions);
  const nativeDownloadTarget = resolveNativeDownloadTarget(options);
  const nativeUpload = resolveNativeUploadConfig(options, reactNativeOptions);
  const unsupportedModeMessage = getUnsupportedModeMessage(options, reactNativeOptions, backgroundTask, nativeUpload);
  const d_options = await getDefaultConfig(defaultOptions);
  const effectiveCoreHooks = getEffectiveCoreHooks(defaultOptions);
  const preparationDefaults = {
    ...d_options,
    headers: undefined,
    hooks: effectiveCoreHooks || d_options.hooks,
    beforeRedirect: defaultOptions.beforeRedirect,
    onRedirect: defaultOptions.onRedirect
  };
  const optionsForPreparation = nativeDownloadTarget ? { ...options, saveTo: undefined, fileName: undefined } : options;
  const requestOptionsForPrep = effectiveCoreHooks ? { ...optionsForPreparation, hooks: undefined } : optionsForPreparation;
  const configResult = prepareHTTPOptions(requestOptionsForPrep, jar, { defaultOptions: preparationDefaults });
  let mainConfig = configResult.config;
  const fetchOptions = configResult.fetchOptions;
  if (options.body === 0 || options.body === false || options.body === "") {
    fetchOptions.body = options.body;
  }
  fetchOptions.transformResponse = options.transformResponse ?? defaultOptions.transformResponse;
  const resolvedMaxContentLength = resolveReactNativeRequestOption(options, defaultOptions, "maxContentLength");
  if (resolvedMaxContentLength !== undefined) {
    Reflect.set(fetchOptions, "maxContentLength", resolvedMaxContentLength);
  }
  if (!mainConfig.errors) {
    mainConfig.errors = [];
  }
  mainConfig.adapterUsed = "react-native";
  mainConfig.auth = options.auth || null;
  mainConfig.originalRequest = options;
  if (isStreamBody(fetchOptions.body) && !(options.responseType === "stream" && reactNativeOptions.streamTransport)) {
    throw new RezoError("React Native fetch does not support streaming request bodies; use a compatible streamTransport provider.", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  if (unsupportedModeMessage) {
    throw new RezoError(unsupportedModeMessage, mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  if (requestedMethod === "CONNECT") {
    throw new RezoError("React Native adapter does not support CONNECT requests.", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const unsupportedOption = getUnsupportedReactNativeOption(options, defaultOptions);
  if (unsupportedOption) {
    throw new RezoError(unsupportedOption.message, mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const hiddenRedirectLane = getReactNativeHiddenRedirectLane(options, reactNativeOptions, nativeDownloadTarget, nativeUpload);
  if (hiddenRedirectLane && redirectGuarantees.length > 0) {
    throw createHiddenRedirectCapabilityError(hiddenRedirectLane, redirectGuarantees, mainConfig, fetchOptions);
  }
  if (hiddenRedirectLane && (fetchOptions.followRedirects === false || fetchOptions.maxRedirects === 0)) {
    throw new RezoError(`Redirect policy (followRedirects: false / maxRedirects: 0) cannot be enforced on the provider-owned ${hiddenRedirectLane} lane`, mainConfig, "REZ_UNSUPPORTED_CAPABILITY", mainConfig.originalRequest ?? fetchOptions);
  }
  const initialUrl = fetchOptions.fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const initialPolicy = createRedirectHeaderPolicyState(initialUrl);
  if (!initialPolicy.ok) {
    throw new RezoError("Invalid React Native request URL", mainConfig, "ERR_INVALID_URL", fetchOptions);
  }
  const responseType = typeof options.responseType === "string" ? options.responseType.toLowerCase() : undefined;
  const isStream = options._isStream || responseType === "stream";
  const isDownload = options._isDownload || responseType === "download" || !!options.fileName || !!options.saveTo;
  const isUpload = options._isUpload || responseType === "upload";
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = options._streamResponse || new ReactNativeStreamResponse;
  } else if (isDownload) {
    downloadResponse = options._downloadResponse || (() => {
      const fileName = options.fileName || options.saveTo || "";
      const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
      return new ReactNativeDownloadResponse(fileName, url);
    })();
  } else if (isUpload) {
    uploadResponse = options._uploadResponse || (() => {
      const url = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
      return new ReactNativeUploadResponse(url, nativeUpload?.file.name);
    })();
  }
  const usesNativeProviderLane = isStream && !!reactNativeOptions.streamTransport || !!nativeDownloadTarget && !!reactNativeOptions.fileSystemAdapter?.downloadFile || !!nativeUpload && !!reactNativeOptions.fileSystemAdapter?.uploadFile;
  if (resolvedMaxContentLength !== undefined && usesNativeProviderLane) {
    throw new RezoError("React Native adapter does not support the `maxContentLength` option.", mainConfig, "REZ_UNSUPPORTED_CAPABILITY", fetchOptions);
  }
  const facade = streamResponse || downloadResponse || uploadResponse;
  const lifetime = new ReactNativeRequestLifetime(mainConfig, fetchOptions, fetchOptions.timeout, fetchOptions.signal ?? options.signal, initialUrl);
  const settlement = new ReactNativeFacadeSettlement(facade);
  const executePreparedRequest = async () => {
    const preparedHeaders = fetchOptions.headers instanceof RezoHeaders ? prepareRedirectHeaders(fetchOptions.headers, "same-origin") : prepareRedirectHeaders(new RezoHeaders(fetchOptions.headers || {}), "same-origin");
    if (normalizedRequest.literalCookie) {
      const sourceJarCookie = preparedHeaders.get("cookie");
      preparedHeaders.set("cookie", sourceJarCookie ? `${normalizedRequest.literalCookie}; ${sourceJarCookie}` : normalizedRequest.literalCookie);
    }
    preparedHeaders.delete("proxy-authorization");
    fetchOptions.headers = preparedHeaders;
    const redirectBaseHeaders = new RezoHeaders(preparedHeaders);
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
    const redirectRuntime = {
      state: initialPolicy.state,
      baseHeaders: redirectBaseHeaders,
      xsrfCookieName: options.xsrfCookieName,
      xsrfHeaderName: options.xsrfHeaderName
    };
    updateReactNativeTrackingData(mainConfig, {
      fileSystemAdapter: reactNativeOptions.fileSystemAdapter?.name || null,
      streamTransport: reactNativeOptions.streamTransport?.name || null,
      networkInfoEnabled: !!reactNativeOptions.networkInfoProvider,
      backgroundTaskEnabled: !!reactNativeOptions.backgroundTaskProvider,
      backgroundTaskRequested: !!backgroundTask,
      nativeUploadRequested: !!nativeUpload
    });
    if (nativeDownloadTarget) {
      mainConfig.fileName = nativeDownloadTarget;
      fetchOptions.fileName = nativeDownloadTarget;
    } else if (nativeUpload?.file.name) {
      mainConfig.fileName = nativeUpload.file.name;
    }
    const perform = new RezoPerformance;
    const resolvedMaxBodyLength = resolveReactNativeRequestOption(options, defaultOptions, "maxBodyLength");
    if (typeof resolvedMaxBodyLength === "number" && Number.isFinite(resolvedMaxBodyLength) && resolvedMaxBodyLength >= 0) {
      const bodySize = nativeUpload?.file.size ?? getReactNativeBodyByteLength(fetchOptions.body);
      if (bodySize !== undefined && bodySize > resolvedMaxBodyLength) {
        throw new RezoError(`Request body size ${bodySize} exceeds maxBodyLength ${resolvedMaxBodyLength}`, mainConfig, "REZ_BODY_TOO_LARGE", fetchOptions);
      }
    }
    const cacheOption = options.cache;
    const method = requestedMethod;
    const requestUrl = typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "";
    const isSecureRequest = requestUrl.startsWith("https:");
    const hasNativeStreaming = !!reactNativeOptions.streamTransport;
    const hasNativeFileDownload = !!reactNativeOptions.fileSystemAdapter?.downloadFile && (reactNativeOptions.fileSystemAdapter.capabilities?.fileDownload ?? true);
    const hasNativeDownloadProgress = hasNativeFileDownload && (reactNativeOptions.fileSystemAdapter?.capabilities?.downloadProgress ?? true);
    const hasNativeFileUpload = !!reactNativeOptions.fileSystemAdapter?.uploadFile && (reactNativeOptions.fileSystemAdapter.capabilities?.uploadFromFile ?? true);
    const hasNativeUploadProgress = hasNativeFileUpload && (reactNativeOptions.fileSystemAdapter?.capabilities?.uploadProgress ?? true);
    const adapterFeatures = [
      "fetch",
      "timeout",
      "abort",
      !mainConfig.disableJar ? "cookies" : null,
      mainConfig.maxRedirects > 0 ? "redirects" : null,
      mainConfig.retry ? "retry" : null,
      cacheOption ? "cache" : null,
      hasNativeStreaming ? "streaming" : null,
      hasNativeFileDownload ? "file-download" : null,
      hasNativeDownloadProgress ? "download-progress" : null,
      hasNativeFileUpload ? "file-upload" : null,
      hasNativeUploadProgress ? "upload-progress" : null,
      reactNativeOptions.networkInfoProvider ? "network-info" : null,
      reactNativeOptions.backgroundTaskProvider ? "background-tasks" : null,
      "hooks"
    ].filter(Boolean);
    mainConfig.adapterMetadata = {
      version: "react-native",
      features: adapterFeatures,
      capabilities: {
        fetch: true,
        cookies: !mainConfig.disableJar,
        redirects: mainConfig.maxRedirects > 0,
        timeout: true,
        abort: true,
        retry: !!mainConfig.retry,
        cache: !!cacheOption,
        afterHeaders: true,
        afterParse: true,
        onAbort: true,
        onTimeout: true,
        finalUrl: true,
        progress: hasNativeStreaming || hasNativeDownloadProgress || hasNativeUploadProgress,
        streaming: hasNativeStreaming,
        fileDownload: hasNativeFileDownload,
        downloadProgress: hasNativeDownloadProgress,
        uploadProgress: hasNativeUploadProgress,
        networkInfo: !!reactNativeOptions.networkInfoProvider,
        backgroundTasks: !!reactNativeOptions.backgroundTaskProvider,
        proxy: false,
        http2: false,
        ssl: isSecureRequest
      }
    };
    mainConfig.features = {
      http2: false,
      compression: false,
      cookies: !mainConfig.disableJar,
      redirects: mainConfig.maxRedirects > 0,
      proxy: false,
      timeout: true,
      retry: !!mainConfig.retry,
      cache: !!cacheOption,
      metrics: true,
      events: true,
      validation: true,
      browser: false,
      ssl: isSecureRequest
    };
    let cache;
    let requestHeaders;
    let cachedEntry;
    if (cacheOption && !isStream && !isDownload && !isUpload && !takeCoreCacheOwnership(coreDispatchIdentity)) {
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
        for (const [name, value] of Object.entries(conditionalHeaders)) {
          headers.set(name, value);
          redirectRuntime.baseHeaders.set(name, value);
        }
        fetchOptions.headers = headers;
      }
    }
    const runRequest = () => {
      if (nativeDownloadTarget && downloadResponse && reactNativeOptions.fileSystemAdapter?.downloadFile) {
        return executeReactNativeRequestWithRetry({
          lifetime,
          config: mainConfig,
          fetchOptions,
          options,
          perform,
          eventEmitter: downloadResponse,
          executeAttempt: (attempt) => executeNativeFileDownloadRequest(fetchOptions, mainConfig, downloadResponse, reactNativeOptions.fileSystemAdapter, nativeDownloadTarget, reactNativeOptions.networkInfoProvider, lifetime, attempt, settlement)
        });
      }
      if (streamResponse && reactNativeOptions.streamTransport) {
        return executeReactNativeRequestWithRetry({
          lifetime,
          config: mainConfig,
          fetchOptions,
          options,
          perform,
          eventEmitter: streamResponse,
          beforeAttempt: () => refreshReactNativeRedirectHeaders(mainConfig, redirectRuntime, fetchOptions),
          executeAttempt: (attempt) => executeNativeStreamRequest(fetchOptions, mainConfig, streamResponse, reactNativeOptions.streamTransport, reactNativeOptions.networkInfoProvider, lifetime, attempt, settlement),
          handleRedirect: async (response) => {
            const redirectDuration = perform.now();
            perform.reset();
            await applyManualRedirect(mainConfig, fetchOptions, redirectRuntime, response, redirectDuration, streamResponse);
          }
        });
      }
      if (nativeUpload && uploadResponse && reactNativeOptions.fileSystemAdapter?.uploadFile) {
        return executeReactNativeRequestWithRetry({
          lifetime,
          config: mainConfig,
          fetchOptions,
          options,
          perform,
          eventEmitter: uploadResponse,
          executeAttempt: (attempt) => executeNativeFileUploadRequest(fetchOptions, mainConfig, uploadResponse, reactNativeOptions.fileSystemAdapter, nativeUpload, reactNativeOptions.networkInfoProvider, lifetime, attempt, settlement)
        });
      }
      return executeReactNativeRequestWithRetry({
        lifetime,
        config: mainConfig,
        fetchOptions,
        options,
        perform,
        eventEmitter: facade,
        beforeAttempt: () => refreshReactNativeRedirectHeaders(mainConfig, redirectRuntime, fetchOptions),
        executeAttempt: (attempt) => executeSingleRequest(mainConfig, fetchOptions, { startTime: mainConfig.timing.startTime || performance.now() }, reactNativeOptions.networkInfoProvider, streamResponse, downloadResponse, uploadResponse, lifetime, attempt, settlement),
        handleRedirect: async (response) => {
          const redirectDuration = perform.now();
          perform.reset();
          await applyManualRedirect(mainConfig, fetchOptions, redirectRuntime, response, redirectDuration);
        }
      });
    };
    lifetime.assertActive();
    assertSupportedReactNativeTimeoutStages(fetchOptions.timeout, mainConfig, fetchOptions);
    const cleanupBackgroundTask = await prepareBackgroundTaskLifecycle(mainConfig, reactNativeOptions.backgroundTaskProvider, backgroundTask, lifetime);
    let response;
    try {
      response = await runRequest();
      if (cleanupBackgroundTask)
        await cleanupBackgroundTask();
      settlement.publishSuccess();
    } catch (error) {
      if (cleanupBackgroundTask)
        await cleanupBackgroundTask();
      throw error;
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
  };
  const res = (async () => {
    try {
      await lifetime.run(() => applyReactNativeRequestTransforms(fetchOptions, options, defaultOptions));
      return await executePreparedRequest();
    } catch (error) {
      const rezoError = error instanceof RezoError ? error : buildSmartError(mainConfig, fetchOptions, error);
      if (facade) {
        await settlement.publishError(rezoError, mainConfig.hooks);
        throw rezoError;
      }
      if (!effectiveCoreHooks && mainConfig.hooks?.beforeError?.length) {
        try {
          throw await runTransformHooks(mainConfig.hooks.beforeError, rezoError);
        } catch (hookFailure) {
          throw hookFailure;
        }
      }
      throw rezoError;
    } finally {
      lifetime.finish();
    }
  })();
  if (streamResponse) {
    res.catch(() => {
      return;
    });
    return streamResponse;
  } else if (downloadResponse) {
    res.catch(() => {
      return;
    });
    return downloadResponse;
  } else if (uploadResponse) {
    res.catch(() => {
      return;
    });
    return uploadResponse;
  }
  return await res;
}
async function executeNativeFileDownloadRequest(fetchOptions, config, downloadResult, fileSystemAdapter, destination, networkInfoProvider, lifetime, attempt, settlement) {
  const { fullUrl, body } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "GET").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.fileName = destination;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: resolveTimeoutMs(fetchOptions.timeout),
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider, lifetime);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  downloadResult.emit("start", startEvent);
  const preparedBody = await lifetime.run(() => prepareBody(body));
  setRequestTransferSize(config, body);
  let status = 0;
  let statusText = "OK";
  let responseHeaders = new RezoHeaders;
  let contentType = "";
  let contentLength = 0;
  let finalUrl = url;
  let progressLoaded = 0;
  let responseCookies = createEmptyCookies();
  const capturedHeaders = captureNativeHeaders(attempt);
  const captureHeaders = (event) => {
    capturedHeaders.accept(event);
  };
  const publishHeaders = async (metadata) => {
    if (!attempt.active)
      return;
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    status = metadata.status;
    statusText = metadata.statusText;
    responseHeaders = new RezoHeaders(metadata.headers);
    contentType = metadata.contentType;
    contentLength = metadata.contentLength ?? 0;
    finalUrl = metadata.finalUrl;
    responseCookies = await lifetime.run(() => parseCookiesFromHeaders(new Headers(metadata.headers), finalUrl, config));
    config.responseCookies = responseCookies;
    config.finalUrl = finalUrl;
    config.status = status;
    config.statusText = statusText;
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength || undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    downloadResult.emit("headers", headersEvent);
    downloadResult.emit("status", status, statusText);
    downloadResult.emit("cookies", responseCookies.array);
    if (config.hooks?.afterHeaders) {
      for (const hook of config.hooks.afterHeaders) {
        await lifetime.run(() => hook(headersEvent, config));
      }
    }
  };
  const emitProgress = (event) => {
    if (!attempt.active)
      return;
    attempt.markPublicTransfer();
    progressLoaded = event.loaded;
    config.transfer.bodySize = event.loaded;
    config.transfer.responseSize = event.loaded;
    const total = event.total ?? contentLength ?? 0;
    const elapsedMs = Math.max(performance.now() - timing.startTime, 1);
    const speed = event.speed ?? event.loaded / (elapsedMs / 1000);
    const averageSpeed = event.averageSpeed ?? speed;
    const estimatedTime = event.estimatedTime ?? (total > event.loaded && averageSpeed > 0 ? (total - event.loaded) / averageSpeed * 1000 : 0);
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed,
      averageSpeed,
      estimatedTime,
      timestamp: Date.now()
    };
    downloadResult.emit("progress", progressEvent);
    downloadResult.emit("download-progress", progressEvent);
    const onDownloadProgress = config.originalRequest?.onDownloadProgress;
    if (typeof onDownloadProgress === "function") {
      try {
        onDownloadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onDownloadProgress callback error:", error);
        }
      }
    }
  };
  const result = await attempt.run(() => fileSystemAdapter.downloadFile({
    url,
    destination,
    method,
    headers: Object.fromEntries(reqHeaders.entries()),
    body: preparedBody,
    timeout: resolveReactNativeProviderTimeout(fetchOptions.timeout),
    signal: attempt.signal,
    onHeaders: captureHeaders,
    onProgress: emitProgress
  }));
  const metadata = reconcileReactNativeProviderMetadata("download", capturedHeaders.current(), capturedHeaders.conflicted(), result, url, config, fetchOptions);
  await publishHeaders(metadata);
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  const bodySize = result.fileSize ?? result.contentLength ?? (contentLength || progressLoaded);
  updateTiming(config, timing, bodySize);
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    throw builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
      status,
      statusText,
      headers: responseHeaders,
      data: null
    }, config, fetchOptions);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const finalResponse = {
    data: undefined,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: bodySize,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
  const downloadFinishEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: bodySize,
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    fileName: result.filePath || destination,
    fileSize: bodySize,
    timing: {
      ...getTimingDurations(config),
      download: getTimingDurations(config).download || 0
    },
    averageSpeed: getTimingDurations(config).download ? bodySize / getTimingDurations(config).download * 1000 : 0,
    config: sanitizeConfig(config)
  };
  settlement.deferSuccess(() => {
    downloadResult.emit("finish", downloadFinishEvent);
    downloadResult.emit("done", downloadFinishEvent);
    downloadResult.emit("complete", downloadFinishEvent);
    downloadResult._markFinished();
  });
  return finalResponse;
}
async function executeNativeStreamRequest(fetchOptions, config, streamResult, streamTransport, networkInfoProvider, lifetime, attempt, settlement) {
  const { fullUrl, body } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "GET").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: resolveTimeoutMs(fetchOptions.timeout),
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider, lifetime);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  streamResult.emit("start", startEvent);
  const preparedBody = await lifetime.run(() => prepareBody(body));
  setRequestTransferSize(config, body);
  let status = 0;
  let statusText = "OK";
  let responseHeaders = new RezoHeaders;
  let contentType = "";
  let contentLength = 0;
  let finalUrl = url;
  let bytesReceived = 0;
  let responseCookies = createEmptyCookies();
  let redirectLocation = null;
  let bodyStarted = false;
  let streamPolicyError = null;
  const errorCarrier = config.originalRequest ?? fetchOptions;
  const buildStreamSourceResponse = () => ({
    data: undefined,
    status,
    statusText,
    finalUrl: url,
    cookies: responseCookies,
    headers: responseHeaders,
    contentType,
    contentLength: contentLength || 0,
    urls: [url],
    config
  });
  const capturedHeaders = captureNativeHeaders(attempt);
  const publishHeaders = async (event) => {
    if (!attempt.active)
      return;
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    status = event.status;
    statusText = event.statusText || statusText;
    responseHeaders = new RezoHeaders(event.headers || {});
    contentType = event.contentType || responseHeaders.get("content-type") || contentType;
    const headerContentLength = parseInt(responseHeaders.get("content-length") || "0", 10) || 0;
    contentLength = event.contentLength ?? (headerContentLength || contentLength);
    const providerFinalUrl = event.finalUrl || finalUrl;
    const locationHeader = responseHeaders.get("location") || responseHeaders.get("Location");
    const redirectClassStatus = status >= 300 && status < 400 && status !== 304;
    const redirectPolicyDisabled = fetchOptions.followRedirects === false;
    const isRedirect = redirectClassStatus && !!locationHeader && !redirectPolicyDisabled;
    responseCookies = await lifetime.run(() => parseCookiesFromHeaders(new Headers(event.headers || {}), isRedirect ? url : providerFinalUrl, config));
    config.responseCookies = responseCookies;
    config.status = status;
    config.statusText = statusText;
    if (redirectClassStatus && fetchOptions.maxRedirects === 0) {
      config.maxRedirectsReached = true;
      streamPolicyError = buildRedirectControlError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", errorCarrier, buildStreamSourceResponse());
      return;
    }
    if (redirectClassStatus && !locationHeader && !redirectPolicyDisabled) {
      streamPolicyError = buildRedirectControlError("Redirect location not found", config, "REZ_MISSING_REDIRECT_LOCATION", errorCarrier, buildStreamSourceResponse());
      return;
    }
    if (isRedirect && locationHeader) {
      try {
        redirectLocation = resolveRedirectLocation(url, locationHeader);
      } catch {
        streamPolicyError = new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", errorCarrier, buildStreamSourceResponse());
        return;
      }
      finalUrl = redirectLocation;
      return;
    }
    finalUrl = providerFinalUrl;
    config.finalUrl = finalUrl;
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength || undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    streamResult.emit("headers", headersEvent);
    streamResult.emit("status", status, statusText);
    streamResult.emit("cookies", responseCookies.array);
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      for (const hook of config.hooks.afterHeaders) {
        await lifetime.run(() => hook(headersEvent, config));
      }
    }
  };
  const emitProgress = (event) => {
    if (!attempt.active || redirectLocation || streamPolicyError) {
      return;
    }
    attempt.markPublicTransfer();
    bytesReceived = Math.max(bytesReceived, event.loaded);
    config.transfer.bodySize = bytesReceived;
    config.transfer.responseSize = bytesReceived;
    const total = event.total ?? contentLength ?? 0;
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed: event.speed ?? event.averageSpeed ?? 0,
      averageSpeed: event.averageSpeed ?? event.speed ?? 0,
      estimatedTime: event.estimatedTime ?? 0,
      timestamp: Date.now()
    };
    streamResult.emit("progress", progressEvent);
    streamResult.emit("download-progress", progressEvent);
    const onDownloadProgress = config.originalRequest?.onDownloadProgress;
    if (typeof onDownloadProgress === "function") {
      try {
        onDownloadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onDownloadProgress callback error:", error);
        }
      }
    }
  };
  let result;
  try {
    claimBodyStream(body, config, fetchOptions);
    result = await attempt.run(() => streamTransport.stream({
      url,
      method,
      headers: Object.fromEntries(reqHeaders.entries()),
      body: preparedBody,
      timeout: resolveReactNativeProviderTimeout(fetchOptions.timeout),
      signal: attempt.signal,
      onHeaders: (event) => {
        capturedHeaders.accept(event);
      },
      onChunk: async (chunk) => {
        if (!attempt.active || redirectLocation || streamPolicyError) {
          return;
        }
        if (!timing.firstByteTime) {
          timing.firstByteTime = performance.now();
          config.timing.responseStart = timing.firstByteTime;
        }
        const chunkSize = typeof chunk === "string" ? chunk.length : chunk.byteLength;
        bytesReceived += chunkSize;
        if (chunkSize > 0) {
          bodyStarted = true;
          attempt.markPublicTransfer();
        }
        config.transfer.bodySize = bytesReceived;
        config.transfer.responseSize = bytesReceived;
        streamResult.write(chunk);
      },
      onProgress: emitProgress
    }));
  } catch (err) {
    err.__rezoStreamBodyStarted = bodyStarted;
    throw err;
  }
  const metadata = reconcileReactNativeProviderMetadata("stream", capturedHeaders.current(), capturedHeaders.conflicted(), result, url, config, fetchOptions);
  await publishHeaders(metadata);
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  if (streamPolicyError) {
    throw streamPolicyError;
  }
  if (redirectLocation) {
    return {
      data: undefined,
      status,
      statusText,
      headers: responseHeaders,
      cookies: responseCookies,
      config,
      contentType,
      contentLength: contentLength || 0,
      finalUrl: redirectLocation,
      urls: buildUrlTree(config, redirectLocation),
      __redirectLocation: redirectLocation
    };
  }
  updateTiming(config, timing, bytesReceived);
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  const streamRedirectClass = status >= 300 && status < 400 && status !== 304;
  const unfollowedRedirectSettles = fetchOptions.followRedirects === false && streamRedirectClass && fetchOptions.validateStatus === undefined;
  if (!unfollowedRedirectSettles && fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    const sourceResponse = buildStreamSourceResponse();
    throw status >= 400 ? builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, sourceResponse, config, errorCarrier) : RezoError.createHttpError(status, config, errorCarrier, sourceResponse);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const streamFinishEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: bytesReceived,
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    timing: getTimingDurations(config),
    config: sanitizeConfig(config)
  };
  settlement.deferSuccess(() => {
    streamResult.emit("end");
    streamResult.emit("finish", streamFinishEvent);
    streamResult.emit("done", streamFinishEvent);
    streamResult.emit("complete", streamFinishEvent);
    streamResult._markFinished();
    streamResult.end();
  });
  return {
    data: undefined,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: bytesReceived,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
}
async function executeNativeFileUploadRequest(fetchOptions, config, uploadResult, fileSystemAdapter, uploadConfig, networkInfoProvider, lifetime, attempt, settlement) {
  const { fullUrl } = fetchOptions;
  const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
  const isSecure = url.startsWith("https:");
  const method = (fetchOptions.method || "POST").toUpperCase();
  const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers : new RezoHeaders(fetchOptions.headers || {});
  const timing = {
    startTime: performance.now()
  };
  config.adapterUsed = "react-native";
  config.isSecure = isSecure;
  config.finalUrl = url;
  config.fileName = uploadConfig.file.name || config.fileName || null;
  config.network.protocol = isSecure ? "https" : "http";
  config.timing.startTime = timing.startTime;
  setNativeUploadTransferSize(config, uploadConfig);
  debugLog.requestStart(config, url, method);
  const startEvent = {
    url,
    method,
    headers: new RezoHeaders(reqHeaders),
    timestamp: timing.startTime,
    timeout: resolveTimeoutMs(fetchOptions.timeout),
    maxRedirects: fetchOptions.maxRedirects,
    retry: config.retry ? {
      maxRetries: config.retry.maxRetries,
      delay: config.retry.retryDelay,
      backoff: typeof config.retry.backoff === "number" ? config.retry.backoff : undefined
    } : undefined
  };
  const networkState = await captureNetworkState(config, networkInfoProvider, lifetime);
  if (isOfflineNetworkState(networkState)) {
    const error = createOfflineError(config, fetchOptions);
    debugLog.error(config, error);
    throw error;
  }
  uploadResult.emit("start", startEvent);
  let uploadedBytes = 0;
  const capturedHeaders = captureNativeHeaders(attempt);
  const emitProgress = (event) => {
    if (!attempt.active)
      return;
    attempt.markPublicTransfer();
    uploadedBytes = event.loaded;
    if (typeof event.total === "number" && event.total >= 0) {
      config.transfer.requestSize = event.total;
    } else if (event.loaded > config.transfer.requestSize) {
      config.transfer.requestSize = event.loaded;
    }
    const total = event.total ?? config.transfer.requestSize ?? 0;
    const progressEvent = {
      loaded: event.loaded,
      total,
      percentage: total > 0 ? event.loaded / total * 100 : 0,
      speed: event.speed ?? event.averageSpeed ?? 0,
      averageSpeed: event.averageSpeed ?? event.speed ?? 0,
      estimatedTime: event.estimatedTime ?? 0,
      timestamp: Date.now()
    };
    uploadResult.emit("progress", progressEvent);
    uploadResult.emit("upload-progress", progressEvent);
    const onUploadProgress = config.originalRequest?.onUploadProgress;
    if (typeof onUploadProgress === "function") {
      try {
        onUploadProgress(progressEvent);
      } catch (error) {
        if (config.debug) {
          console.log("[Rezo Debug] onUploadProgress callback error:", error);
        }
      }
    }
  };
  const result = await attempt.run(() => fileSystemAdapter.uploadFile({
    url,
    method,
    headers: Object.fromEntries(reqHeaders.entries()),
    file: { ...uploadConfig.file },
    fields: uploadConfig.fields ? { ...uploadConfig.fields } : undefined,
    binaryStreamOnly: uploadConfig.binaryStreamOnly,
    timeout: resolveReactNativeProviderTimeout(fetchOptions.timeout),
    signal: attempt.signal,
    onHeaders: (event) => {
      capturedHeaders.accept(event);
    },
    onProgress: emitProgress
  }));
  const metadata = reconcileReactNativeProviderMetadata("upload", capturedHeaders.current(), capturedHeaders.conflicted(), result, url, config, fetchOptions);
  if (!timing.firstByteTime) {
    timing.firstByteTime = performance.now();
    config.timing.responseStart = timing.firstByteTime;
  }
  const status = metadata.status;
  const statusText = metadata.statusText;
  const responseHeaders = new RezoHeaders(metadata.headers);
  const contentType = metadata.contentType;
  const contentLength = metadata.contentLength ?? 0;
  const finalUrl = metadata.finalUrl;
  const nativeHeaders = new Headers(metadata.headers);
  const responseCookies = await lifetime.run(() => parseCookiesFromHeaders(nativeHeaders, finalUrl, config));
  const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
  config.responseCookies = responseCookies;
  config.finalUrl = finalUrl;
  config.status = status;
  config.statusText = statusText;
  const headersEvent = {
    status,
    statusText,
    headers: responseHeaders,
    contentType,
    contentLength: contentLength || undefined,
    cookies: responseCookies.array,
    timing: {
      firstByte: config.timing.responseStart - config.timing.startTime,
      total: performance.now() - config.timing.startTime
    }
  };
  uploadResult.emit("headers", headersEvent);
  uploadResult.emit("status", status, statusText);
  uploadResult.emit("cookies", responseCookies.array);
  uploadResult.status = status;
  uploadResult.statusText = statusText;
  if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
    for (const hook of config.hooks.afterHeaders) {
      await lifetime.run(() => hook(headersEvent, config));
    }
  }
  const buildUploadSourceResponse = (data) => ({
    data,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  });
  const bodyless = method === "HEAD" || status === 204 || status === 205 || status === 304;
  const parsedBody = await lifetime.runBody(async () => {
    const parseStart = performance.now();
    const parsed = bodyless ? { data: null, rawData: null, bodySize: 0 } : await parseResponseData(result.body, config.responseType || fetchOptions.responseType || "auto", contentType, config, (rawData, cause) => createReactNativeInvalidJsonError(rawData, cause, config, fetchOptions, buildUploadSourceResponse(rawData)));
    const parseDuration = performance.now() - parseStart;
    const transformedData = await applyReactNativeResponseTransforms(parsed.data, fetchOptions);
    const responseData = await runAfterParseHooks(transformedData, parsed.rawData, contentType, parseDuration, config);
    return { parsed, responseData };
  });
  const { parsed, responseData } = parsedBody;
  updateTiming(config, timing, parsed.bodySize);
  if (uploadedBytes > config.transfer.requestSize) {
    config.transfer.requestSize = uploadedBytes;
  }
  if (typeof result.uploadSize === "number" && result.uploadSize >= 0) {
    config.transfer.requestSize = result.uploadSize;
  }
  const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
  if (fetchOptions.validateStatus !== null && !_validateStatus(status)) {
    throw builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, {
      status,
      statusText,
      headers: responseHeaders,
      data: responseData
    }, config, fetchOptions);
  }
  debugLog.response(config, status, statusText, performance.now() - timing.startTime);
  debugLog.responseHeaders(config, responseHeaders.toObject());
  debugLog.cookies(config, mergedCookies.array.length);
  debugLog.complete(config, finalUrl);
  const finalResponse = {
    data: responseData,
    status,
    statusText,
    headers: responseHeaders,
    cookies: mergedCookies,
    config,
    contentType,
    contentLength: parsed.bodySize,
    finalUrl,
    urls: buildUrlTree(config, finalUrl)
  };
  const timingDurations = getTimingDurations(config);
  const uploadFinishEvent = {
    response: {
      status,
      statusText,
      headers: responseHeaders,
      data: responseData,
      contentType,
      contentLength: parsed.bodySize
    },
    finalUrl,
    cookies: mergedCookies,
    urls: buildUrlTree(config, finalUrl),
    uploadSize: config.transfer.requestSize || uploadedBytes || uploadConfig.file.size || 0,
    fileName: result.fileName || uploadConfig.file.name,
    timing: {
      ...timingDurations,
      upload: timingDurations.firstByte || 0,
      waiting: timingDurations.download > 0 && timingDurations.firstByte > 0 ? timingDurations.download - timingDurations.firstByte : 0
    },
    averageUploadSpeed: timingDurations.firstByte && (config.transfer.requestSize || uploadedBytes) ? (config.transfer.requestSize || uploadedBytes) / timingDurations.firstByte * 1000 : 0,
    averageDownloadSpeed: timingDurations.download ? parsed.bodySize / timingDurations.download * 1000 : 0,
    config: sanitizeConfig(config)
  };
  settlement.deferSuccess(() => {
    uploadResult.emit("finish", uploadFinishEvent);
    uploadResult.emit("done", uploadFinishEvent);
    uploadResult.emit("complete", uploadFinishEvent);
    uploadResult._markFinished();
  });
  return finalResponse;
}
async function executeSingleRequest(config, fetchOptions, timing, networkInfoProvider, streamResult, downloadResult, uploadResult, lifetime, attempt, settlement) {
  try {
    const { fullUrl, body } = fetchOptions;
    const url = fullUrl || (typeof fetchOptions.url === "string" ? fetchOptions.url : fetchOptions.url?.toString() || "");
    const isSecure = url.startsWith("https:");
    const method = (fetchOptions.method || "GET").toUpperCase();
    const normalizedResponseType = normalizeResponseType(config.responseType || fetchOptions.responseType || "auto");
    config.adapterUsed = "react-native";
    config.isSecure = isSecure;
    config.finalUrl = url;
    config.network.protocol = isSecure ? "https" : "http";
    config.responseType = normalizedResponseType;
    fetchOptions.responseType = normalizedResponseType;
    const eventEmitter = streamResult || downloadResult || uploadResult;
    if (!lifetime || !attempt || !settlement) {
      throw new Error("React Native fetch execution requires request lifetime ownership");
    }
    const networkState = await captureNetworkState(config, networkInfoProvider, lifetime);
    if (isOfflineNetworkState(networkState)) {
      const error = createOfflineError(config, fetchOptions);
      debugLog.error(config, error);
      return error;
    }
    debugLog.requestStart(config, url, method);
    const reqHeaders = fetchOptions.headers instanceof RezoHeaders ? fetchOptions.headers.toObject() : fetchOptions.headers || {};
    const headers = toFetchHeaders(reqHeaders);
    if (eventEmitter) {
      const startEvent = {
        url,
        method,
        headers: new RezoHeaders(reqHeaders),
        timestamp: timing.startTime,
        timeout: resolveTimeoutMs(fetchOptions.timeout),
        maxRedirects: config.maxRedirects
      };
      eventEmitter.emit("start", startEvent);
    }
    const preparedBody = await lifetime.run(() => prepareBody(body));
    setRequestTransferSize(config, body);
    const fetchInit = {
      method,
      headers,
      body: preparedBody,
      signal: attempt.signal,
      redirect: "manual"
    };
    const response = await attempt.run(() => fetch(url, fetchInit));
    if (!timing.firstByteTime) {
      timing.firstByteTime = performance.now();
      config.timing.responseStart = timing.firstByteTime;
    }
    const status = response.status;
    const statusText = response.statusText;
    const responseHeaders = fromFetchHeaders(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");
    const providerFinalUrl = response.url || url;
    const locationHeader = response.headers.get("location") || response.headers.get("Location");
    const redirectClassStatus = status >= 300 && status < 400 && status !== 304;
    const redirectPolicyDisabled = fetchOptions.followRedirects === false;
    const isRedirect = redirectClassStatus && !!locationHeader && !redirectPolicyDisabled;
    const responseCookies = await lifetime.run(() => parseCookiesFromHeaders(response.headers, isRedirect ? url : providerFinalUrl, config));
    config.responseCookies = responseCookies;
    config.status = status;
    config.statusText = statusText;
    const errorCarrier = config.originalRequest ?? fetchOptions;
    const buildBufferedSourceResponse = (data) => ({
      data,
      status,
      statusText,
      finalUrl: url,
      cookies: responseCookies,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength ? parseInt(contentLength, 10) || 0 : 0,
      urls: [url],
      config
    });
    if (redirectClassStatus && fetchOptions.maxRedirects === 0) {
      config.maxRedirectsReached = true;
      return buildRedirectControlError("Redirects are disabled (maxRedirects=0)", config, "REZ_REDIRECT_DENIED", errorCarrier, buildBufferedSourceResponse());
    }
    if (redirectClassStatus && !locationHeader && !redirectPolicyDisabled) {
      return buildRedirectControlError("Redirect location not found", config, "REZ_MISSING_REDIRECT_LOCATION", errorCarrier, buildBufferedSourceResponse());
    }
    if (isRedirect && locationHeader) {
      let redirectLocation;
      try {
        redirectLocation = resolveRedirectLocation(url, locationHeader);
      } catch {
        return new RezoError("Invalid redirect destination URL", config, "ERR_INVALID_URL", errorCarrier, buildBufferedSourceResponse());
      }
      const redirectResponse = {
        data: undefined,
        status,
        statusText,
        headers: responseHeaders,
        cookies: responseCookies,
        config,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : 0,
        finalUrl: redirectLocation,
        urls: buildUrlTree(config, redirectLocation),
        __redirectLocation: redirectLocation
      };
      return redirectResponse;
    }
    const configuredMaxContentLength = Reflect.get(fetchOptions, "maxContentLength");
    const maxContentLength = typeof configuredMaxContentLength === "number" && Number.isFinite(configuredMaxContentLength) && configuredMaxContentLength >= 0 ? configuredMaxContentLength : undefined;
    const declaredContentLength = contentLength ? parseInt(contentLength, 10) : 0;
    if (maxContentLength !== undefined && Number.isFinite(declaredContentLength) && declaredContentLength > maxContentLength) {
      return new RezoError(`Response body size ${declaredContentLength} exceeds maxContentLength ${maxContentLength}`, config, "REZ_RESPONSE_TOO_LARGE", errorCarrier, buildBufferedSourceResponse());
    }
    const finalUrl = providerFinalUrl;
    config.finalUrl = finalUrl;
    const headersEvent = {
      status,
      statusText,
      headers: responseHeaders,
      contentType,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
      cookies: responseCookies.array,
      timing: {
        firstByte: config.timing.responseStart - config.timing.startTime,
        total: performance.now() - config.timing.startTime
      }
    };
    if (eventEmitter) {
      eventEmitter.emit("headers", headersEvent);
      eventEmitter.emit("status", status, statusText);
      eventEmitter.emit("cookies", responseCookies.array);
      if (downloadResult) {
        downloadResult.status = status;
        downloadResult.statusText = statusText;
      } else if (uploadResult) {
        uploadResult.status = status;
        uploadResult.statusText = statusText;
      }
    }
    if (config.hooks?.afterHeaders && config.hooks.afterHeaders.length > 0) {
      for (const hook of config.hooks.afterHeaders) {
        await lifetime.run(() => hook(headersEvent, config));
      }
    }
    const bodyResult = await lifetime.runBody(async () => {
      let responseData;
      let rawResponseData;
      let bodySize = 0;
      let shouldParseJson = false;
      const responseType = normalizeResponseType(config.responseType || fetchOptions.responseType || "auto");
      const parseStart = performance.now();
      const bodyless = method === "HEAD" || status === 204 || status === 205 || status === 304;
      if (bodyless) {
        rawResponseData = null;
        responseData = null;
      } else if (responseType === "blob") {
        const blob = await response.blob();
        rawResponseData = blob;
        responseData = blob;
        bodySize = blob.size;
      } else if (responseType === "arrayBuffer" || responseType === "buffer") {
        const buffer = await response.arrayBuffer();
        rawResponseData = buffer;
        responseData = buffer;
        bodySize = buffer.byteLength;
      } else if (responseType === "text") {
        const text = await response.text();
        rawResponseData = text;
        responseData = text;
        bodySize = new TextEncoder().encode(text).byteLength;
      } else if (responseType === "json") {
        const text = await response.text();
        rawResponseData = text;
        responseData = text;
        bodySize = new TextEncoder().encode(text).byteLength;
        shouldParseJson = true;
      } else if (isBinaryResponseContentType(contentType)) {
        const buffer = await response.arrayBuffer();
        rawResponseData = buffer;
        responseData = buffer;
        bodySize = buffer.byteLength;
      } else {
        const text = await response.text();
        rawResponseData = text;
        bodySize = new TextEncoder().encode(text).byteLength;
        if (isJsonResponseContentType(contentType)) {
          responseData = text;
          shouldParseJson = true;
        } else {
          responseData = text;
        }
      }
      if (maxContentLength !== undefined && bodySize > maxContentLength) {
        throw new RezoError(`Response body size ${bodySize} exceeds maxContentLength ${maxContentLength}`, config, "REZ_RESPONSE_TOO_LARGE", errorCarrier, buildBufferedSourceResponse(rawResponseData));
      }
      if (shouldParseJson) {
        const text = rawResponseData;
        try {
          responseData = JSON.parse(text);
        } catch (cause) {
          throw createReactNativeInvalidJsonError(text, cause, config, errorCarrier, buildBufferedSourceResponse(text));
        }
      }
      const parseDuration = performance.now() - parseStart;
      responseData = await applyReactNativeResponseTransforms(responseData, fetchOptions);
      responseData = await runAfterParseHooks(responseData, rawResponseData, contentType, parseDuration, config);
      return { responseData, bodySize };
    });
    const { responseData, bodySize } = bodyResult;
    updateTiming(config, timing, bodySize);
    const mergedCookies = mergeRequestAndResponseCookies(config, responseCookies, finalUrl);
    const _validateStatus = fetchOptions.validateStatus ?? ((s) => s >= 200 && s < 300);
    const unfollowedRedirectSettles = redirectPolicyDisabled && redirectClassStatus && fetchOptions.validateStatus === undefined;
    if (!unfollowedRedirectSettles && fetchOptions.validateStatus !== null && !_validateStatus(status)) {
      const sourceResponse = buildBufferedSourceResponse(responseData);
      const error = status >= 400 ? builErrorFromResponse(`HTTP Error ${status}: ${statusText}`, sourceResponse, config, errorCarrier) : RezoError.createHttpError(status, config, errorCarrier, sourceResponse);
      return error;
    }
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
      headers: responseHeaders,
      cookies: mergedCookies,
      config,
      contentType,
      contentLength: bodySize,
      finalUrl,
      urls: buildUrlTree(config, finalUrl)
    };
    debugLog.complete(config, finalUrl);
    if (streamResult) {
      const streamFinishEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: bodySize,
        finalUrl,
        cookies: mergedCookies,
        urls: buildUrlTree(config, finalUrl),
        timing: getTimingDurations(config),
        config: sanitizeConfig(config)
      };
      settlement.deferSuccess(() => {
        streamResult.emit("finish", streamFinishEvent);
        streamResult.emit("done", streamFinishEvent);
        streamResult.emit("complete", streamFinishEvent);
        streamResult.emit("end");
        streamResult._markFinished();
      });
    }
    if (downloadResult) {
      const downloadFinishEvent = {
        status,
        statusText,
        headers: responseHeaders,
        contentType,
        contentLength: bodySize,
        finalUrl,
        cookies: mergedCookies,
        urls: buildUrlTree(config, finalUrl),
        fileName: config.fileName || "",
        fileSize: bodySize,
        timing: {
          ...getTimingDurations(config),
          download: getTimingDurations(config).download || 0
        },
        averageSpeed: getTimingDurations(config).download ? bodySize / getTimingDurations(config).download * 1000 : 0,
        config: sanitizeConfig(config)
      };
      settlement.deferSuccess(() => {
        downloadResult.emit("finish", downloadFinishEvent);
        downloadResult.emit("done", downloadFinishEvent);
        downloadResult.emit("complete", downloadFinishEvent);
        downloadResult._markFinished();
      });
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
        finalUrl,
        cookies: mergedCookies,
        urls: buildUrlTree(config, finalUrl),
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
      settlement.deferSuccess(() => {
        uploadResult.emit("finish", uploadFinishEvent);
        uploadResult.emit("done", uploadFinishEvent);
        uploadResult.emit("complete", uploadFinishEvent);
        uploadResult._markFinished();
      });
    }
    return finalResponse;
  } catch (error) {
    return error instanceof RezoError ? error : buildSmartError(config, fetchOptions, error);
  }
}
registerAdapterCapabilities(executeRequest, {
  evaluateRedirectVisibility: evaluateReactNativeRedirectVisibility
});

export { Environment };
