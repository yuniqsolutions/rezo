import { createDefaultHooks } from '../core/hooks.js';
import { invalidInput, unsupportedInput } from './request-input-errors.js';
const unsupported = [
  "cancelToken",
  "adapter",
  "transport",
  "request",
  "interceptors",
  "timeoutErrorMessage",
  "socketPath",
  "insecureHTTPParser",
  "env",
  "formSerializer",
  "family",
  "lookup",
  "withXSRFToken",
  "fetchOptions",
  "httpVersion",
  "http2Options",
  "cookieJar",
  "cacheOptions",
  "cacheHeuristic",
  "dnsLookupIpVersion",
  "localAddress",
  "createConnection",
  "parseJson",
  "stringifyJson",
  "pagination",
  "context",
  "h2session",
  "enableUnixSockets",
  "preserveHooks",
  "setHost",
  "allowGetBody",
  "maxHeaderSize",
  "maxResponseSize"
];
const retryKeys = new Set([
  "limit",
  "maxRetries",
  "retryDelay",
  "incrementDelay",
  "delay",
  "backoff",
  "maxDelay",
  "statusCodes",
  "retryOn",
  "retryOnTimeout",
  "retryOnNetworkError",
  "methods",
  "condition",
  "onRetry",
  "onRetryExhausted"
]);
const timeoutKeys = new Set(["total", "connect", "headers", "body"]);
const cacheKeys = new Set(["cacheDir", "ttl", "maxEntries", "methods", "respectHeaders"]);
const hookKeys = new Set(Object.keys(createDefaultHooks()));
function validateKeys(value, keys, name) {
  if (value === null || typeof value !== "object")
    return;
  for (const key of Object.keys(value)) {
    if (Reflect.get(value, key) !== undefined && !keys.has(key))
      unsupportedInput(`${name}.${key}`);
  }
}
export function normalizeInputPolicy(options) {
  for (const key of unsupported)
    if (options[key] !== undefined)
      unsupportedInput(key);
  for (const key of ["transformRequest", "transformResponse"]) {
    if (options[key] !== undefined && !Array.isArray(options[key]))
      unsupportedInput(key);
  }
  if (options.resolveBodyOnly === true)
    unsupportedInput("resolveBodyOnly");
  if (options.isStream === true)
    unsupportedInput("isStream");
  if (typeof options.followRedirect === "function")
    unsupportedInput("followRedirect callback");
  if (options.followRedirects === undefined && options.followRedirect !== undefined) {
    if (typeof options.followRedirect !== "boolean")
      invalidInput("followRedirect must be a boolean.");
    options.followRedirects = options.followRedirect;
  }
  validateKeys(options.timeout, timeoutKeys, "timeout");
  validateKeys(options.retry, retryKeys, "retry");
  validateKeys(options.hooks, hookKeys, "hooks");
  validateKeys(options.cache, cacheKeys, "cache");
  validateKeys(options.dnsCache, new Set(["ttl", "maxEntries"]), "dnsCache");
  if (options.cache && typeof options.cache === "object" && Object.getPrototypeOf(options.cache) !== Object.prototype && Object.getPrototypeOf(options.cache) !== null)
    unsupportedInput("cache implementation");
  const serializer = options.paramsSerializer;
  if (serializer && typeof serializer === "object") {
    validateKeys(serializer, new Set(["serialize"]), "paramsSerializer");
    const serialize = Reflect.get(serializer, "serialize");
    if (typeof serialize !== "function")
      unsupportedInput("paramsSerializer");
    options.paramsSerializer = (params) => serialize.call(serializer, params);
  }
  if (options.agent && typeof options.agent === "object") {
    validateKeys(options.agent, new Set(["http", "https"]), "agent");
    if (Reflect.get(options.agent, "http") === false || Reflect.get(options.agent, "https") === false)
      unsupportedInput("agent: false");
    options.httpAgent ??= Reflect.get(options.agent, "http");
    options.httpsAgent ??= Reflect.get(options.agent, "https");
  } else if (options.agent !== undefined)
    unsupportedInput("agent");
  if (options.https && typeof options.https === "object") {
    validateKeys(options.https, new Set(["rejectUnauthorized"]), "https");
    options.rejectUnauthorized ??= Reflect.get(options.https, "rejectUnauthorized");
  } else if (options.https !== undefined)
    unsupportedInput("https");
  if (options.proxy === false) {
    options.useProxyManager = false;
  } else if (options.proxy && typeof options.proxy === "object") {
    options.proxy = { protocol: "http", ...options.proxy };
    const proxy = options.proxy;
    if (typeof proxy.protocol === "string")
      proxy.protocol = proxy.protocol.replace(/:$/u, "").toLowerCase();
  }
  if (options.auth === undefined && (options.username !== undefined || options.password !== undefined)) {
    if (options.username !== undefined && typeof options.username !== "string" || options.password !== undefined && typeof options.password !== "string")
      invalidInput("username and password must be strings.");
    options.auth = { username: options.username ?? "", password: options.password ?? "" };
  }
  if (options.signal === null)
    delete options.signal;
  const signal = options.signal;
  if (signal !== undefined && (!signal || typeof signal !== "object" || typeof Reflect.get(signal, "addEventListener") !== "function" || typeof Reflect.get(signal, "removeEventListener") !== "function" || typeof Reflect.get(signal, "aborted") !== "boolean"))
    invalidInput("signal must be an AbortSignal.");
}
