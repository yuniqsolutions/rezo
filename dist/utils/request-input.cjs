const { RezoHeaders } = require('./headers.cjs');
const { assertBodyAvailable } = require('./request-body.cjs');
const { invalidInput } = require('./request-input-errors.cjs');
const { normalizeInputPolicy } = require('./request-input-policy.cjs');
const { normalizeInputUrl } = require('./request-input-url.cjs');
const { normalizeFetchOptions } = require('./request-fetch-options.cjs');
function inputRecord(value) {
  return value !== null && typeof value === "object" ? value : undefined;
}
function copyHeaders(value, method) {
  if (value === undefined)
    return;
  if (value instanceof Headers || Array.isArray(value))
    return new RezoHeaders(value);
  const record = inputRecord(value);
  if (!record)
    invalidInput("headers must be a Headers instance, header pairs or a record.");
  const source = typeof record.toJSON === "function" ? record.toJSON() : record;
  const result = new RezoHeaders;
  const groups = new Set(["common", "get", "post", "put", "patch", "delete", "head", "options", "trace", "connect"]);
  for (const layer of [inputRecord(source.common), inputRecord(source[method.toLowerCase()]), source]) {
    for (const [key, item] of Object.entries(layer ?? {})) {
      if (groups.has(key) && inputRecord(item))
        continue;
      if (item === undefined || item === null || item === false) {
        result.delete(key);
        continue;
      }
      if (Array.isArray(item)) {
        result.delete(key);
        for (const entry of item)
          result.append(key, String(entry));
      } else if (typeof item === "string" || typeof item === "number" || item === true)
        result.set(key, String(item));
      else
        invalidInput("Header values must be strings, numbers or arrays of strings.");
    }
  }
  return result;
}
function normalizeRequestInput(input, init, defaultBase) {
  if (init !== undefined && !inputRecord(init))
    invalidInput("Request options must be an object.");
  const overrides = inputRecord(init) ?? {};
  let options;
  if (typeof Request !== "undefined" && input instanceof Request) {
    const body = overrides.body == null ? input.body : overrides.body;
    if (body === input.body)
      assertBodyAvailable(body, { adapterUsed: null }, { url: input.url, method: input.method }, input.bodyUsed);
    options = { url: input.url, method: input.method, headers: input.headers, signal: input.signal, ...overrides, body };
    if (overrides.method === undefined)
      options.method = input.method;
    if (overrides.headers === undefined)
      options.headers = input.headers;
    if (overrides.signal === undefined)
      options.signal = input.signal;
  } else if (typeof input === "string" || input instanceof URL) {
    options = { ...overrides, url: input };
  } else {
    const record = inputRecord(input);
    if (!record)
      invalidInput("Request input must be a URL, Request or configuration object.");
    options = { ...record, ...overrides };
  }
  normalizeInputPolicy(options);
  normalizeFetchOptions(options, typeof Request !== "undefined" && input instanceof Request ? input : undefined);
  normalizeInputUrl(options, defaultBase);
  const method = options.method ?? "GET";
  if (typeof method !== "string" || !/^[!#$%&'*+.^_`|~\da-z-]+$/iu.test(method))
    invalidInput("Invalid HTTP method token.");
  options.method = method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request && ["GET", "HEAD"].includes(options.method) && options.body != null) {
    invalidInput("A Fetch Request with GET or HEAD cannot have a body.");
  }
  if (options.body === undefined && options.data !== undefined)
    options.body = options.data;
  try {
    options.headers = copyHeaders(options.headers, options.method);
  } catch (error) {
    if (!(error instanceof TypeError))
      throw error;
    invalidInput("Invalid request headers.");
  }
  if (options.json !== undefined && (options.json === null || typeof options.json !== "object")) {
    if (!["string", "number", "boolean"].includes(typeof options.json) && options.json !== null)
      invalidInput("json must be JSON serializable.");
    if (options.body === undefined)
      options.body = JSON.stringify(options.json);
    const headers = options.headers ?? new RezoHeaders;
    headers.set("content-type", "application/json");
    options.headers = headers;
    delete options.json;
  }
  return options;
}

exports.inputRecord = inputRecord;
exports.normalizeRequestInput = normalizeRequestInput;