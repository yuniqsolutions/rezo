const { invalidInput, unsupportedInput } = require('./request-input-errors.cjs');
const key = Symbol.for("solutions.yuniq.rezo.internal.fetch-input.v1");
const fields = [
  "cache",
  "credentials",
  "redirect",
  "mode",
  "referrer",
  "referrerPolicy",
  "integrity",
  "keepalive",
  "priority",
  "duplex"
];
const choices = {
  cache: ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"],
  credentials: ["omit", "same-origin", "include"],
  redirect: ["follow", "manual", "error"],
  mode: ["cors", "no-cors", "same-origin", "navigate"],
  priority: ["auto", "high", "low"],
  duplex: ["half"],
  keepalive: [true, false]
};
function getRequestFetchOptions(request) {
  return Reflect.get(request, key)?.options ?? {};
}
function getOriginalFetchRequest(options) {
  return Reflect.get(options, key)?.request;
}
function requestDisablesProxy(options) {
  return Reflect.get(options, key)?.proxyDisabled === true;
}
function copyRequestFetchOptions(source, target) {
  const value = Reflect.get(source, key);
  if (value)
    Reflect.set(target, key, value);
}
function normalizeFetchOptions(options, request) {
  const selected = {};
  for (const field of fields) {
    const value = options[field] !== undefined ? options[field] : request && Reflect.get(request, field);
    if (value === undefined || field === "cache" && typeof value !== "string")
      continue;
    if (choices[field] && !choices[field].includes(value))
      invalidInput(`Invalid Fetch ${field} option.`);
    if (["referrer", "referrerPolicy", "integrity"].includes(field) && typeof value !== "string")
      invalidInput(`Fetch ${field} must be a string.`);
    selected[field] = value;
  }
  if (options.followRedirects !== undefined)
    delete selected.redirect;
  else if (selected.redirect !== undefined)
    options.followRedirects = selected.redirect === "follow";
  if (selected.credentials !== undefined && options.withCredentials !== undefined)
    selected.credentials = options.withCredentials ? "include" : "omit";
  if (selected.cache !== undefined)
    options.cache = false;
  if (selected.credentials === "omit" || selected.credentials === "same-origin")
    options.useCookies = false;
  if (Object.keys(selected).length || options.proxy === false)
    Reflect.set(options, key, Object.freeze({
      options: Object.freeze(selected),
      fromRequest: request !== undefined,
      request,
      proxyDisabled: options.proxy === false
    }));
}
function omitsRequestJar(options) {
  const credentials = getRequestFetchOptions(options).credentials;
  return credentials === "omit" || credentials === "same-origin";
}
function assertInputTransport(options, defaults, adapter) {
  const metadata = Reflect.get(options, key);
  const fetch = metadata?.options ?? {};
  if (Reflect.get(options, "http2") === true && adapter !== "http2" && adapter !== "curl")
    unsupportedInput(`${adapter}: http2`);
  if (adapter !== "react-native") {
    for (const name of ["transformRequest", "transformResponse", "maxContentLength"]) {
      if (Reflect.get(options, name) !== undefined || Reflect.get(defaults, name) !== undefined)
        unsupportedInput(`${adapter}: ${name}`);
    }
  }
  if (adapter !== "http") {
    for (const name of ["httpAgent", "httpsAgent", "dnsLookup"]) {
      if (Reflect.get(options, name) !== undefined || Reflect.get(defaults, name) !== undefined)
        unsupportedInput(`${adapter}: ${name}`);
    }
  }
  if (adapter === "fetch" || adapter === "xhr" || adapter === "react-native") {
    if ((options.rejectUnauthorized ?? defaults.rejectUnauthorized) === false)
      unsupportedInput(`${adapter}: disabling TLS verification`);
  }
  if (adapter === "fetch")
    return;
  for (const name of ["integrity", "referrerPolicy", "referrer", "priority", "mode"]) {
    const value = fetch[name];
    const inheritedDefault = metadata?.fromRequest && (value === "" || value === "about:client" || value === "cors" || value === "auto");
    if (value !== undefined && !inheritedDefault)
      unsupportedInput(`${adapter}: Fetch ${name}`);
  }
  if (fetch.keepalive === true)
    unsupportedInput(`${adapter}: Fetch keepalive`);
  if (fetch.cache !== undefined && fetch.cache !== "default" && fetch.cache !== "no-store")
    unsupportedInput(`${adapter}: Fetch cache mode`);
  if (fetch.redirect === "error" || fetch.redirect === "manual" && (adapter === "xhr" || adapter === "react-native")) {
    unsupportedInput(`${adapter}: Fetch redirect mode`);
  }
  if (adapter === "xhr") {
    if (fetch.credentials === "omit")
      unsupportedInput("xhr: credentials omit cannot suppress same-origin ambient cookies");
    if (fetch.credentials !== undefined)
      options.withCredentials = fetch.credentials === "include";
  } else if (adapter === "react-native" && fetch.credentials !== undefined && fetch.credentials !== "include") {
    unsupportedInput("react-native: stock Fetch does not guarantee Fetch credential modes");
  }
}

exports.getRequestFetchOptions = getRequestFetchOptions;
exports.getOriginalFetchRequest = getOriginalFetchRequest;
exports.requestDisablesProxy = requestDisablesProxy;
exports.copyRequestFetchOptions = copyRequestFetchOptions;
exports.normalizeFetchOptions = normalizeFetchOptions;
exports.omitsRequestJar = omitsRequestJar;
exports.assertInputTransport = assertInputTransport;