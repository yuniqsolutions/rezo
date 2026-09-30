const { RezoError } = require('../errors/rezo-error.cjs');
const { invalidInput, unsupportedInput } = require('./request-input-errors.cjs');
function normalizeInputUrl(options, defaultBase) {
  const input = options.url;
  if (typeof input !== "string" && !(input instanceof URL))
    invalidInput("A request needs a string or URL target.");
  const base = typeof options.baseURL === "string" ? options.baseURL : defaultBase;
  let target = String(input);
  const absolute = input instanceof URL || /^[a-z][a-z\d+.-]*:/iu.test(target);
  const prefix = options.baseURL === undefined ? options.prefixUrl : undefined;
  if (prefix !== undefined && typeof prefix !== "string" && !(prefix instanceof URL))
    invalidInput("prefixUrl must be a string or URL.");
  if (options.allowAbsoluteUrls === false && (base || prefix)) {
    if (absolute || target.startsWith("//"))
      unsupportedInput("allowAbsoluteUrls: false with an absolute URL");
  }
  if (prefix && !absolute) {
    if (target.startsWith("/"))
      invalidInput("A relative URL with prefixUrl must not start with a slash.");
    target = String(prefix).replace(/\/?$/u, "/") + target;
  }
  let url;
  try {
    url = new URL(target, base);
  } catch {
    throw new RezoError("Invalid URL: relative request targets require a valid baseURL or prefixUrl.", { adapterUsed: null }, "ERR_INVALID_URL");
  }
  if (options.params === undefined && options.searchParams !== undefined) {
    const query = options.searchParams;
    let params;
    if (typeof query === "string" || query instanceof URLSearchParams)
      params = new URLSearchParams(query);
    else if (query && typeof query === "object" && !Array.isArray(query)) {
      params = new URLSearchParams;
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined)
          continue;
        if (value !== null && !["string", "number", "boolean"].includes(typeof value))
          invalidInput("searchParams values must be primitive; use URLSearchParams for repeated keys.");
        params.append(key, value === null ? "" : String(value));
      }
    } else
      invalidInput("searchParams must be a string, URLSearchParams or a record.");
    url.search = params.toString();
  }
  options.url = url.href;
}

exports.normalizeInputUrl = normalizeInputUrl;