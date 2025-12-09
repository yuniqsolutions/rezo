const { Cookie, RezoCookieJar } = require('./cookies.cjs');
const RezoFormData = require('./form-data.cjs');
const { RezoHeaders } = require('./headers.cjs');
const { RezoURLSearchParams } = require('./data-operations.cjs');
const path = require("node:path");
const { parseProxyString } = require('../proxy/index.cjs');
const { createDefaultHooks, mergeHooks, serializeHooks } = require('../core/hooks.cjs');
const ERROR_INFO = exports.ERROR_INFO = {
  ECONNREFUSED: {
    code: -111,
    message: "Connection Refused: The target server actively refused the TCP connection attempt."
  },
  ECONNRESET: {
    code: -104,
    message: "Connection Reset: An existing TCP connection was forcibly closed by the peer (server or intermediary)."
  },
  ETIMEDOUT: {
    code: -110,
    message: "Connection Timeout: Attempt to establish a TCP connection timed out (no response received within the timeout period)."
  },
  ENOTFOUND: {
    code: -3008,
    message: "DNS Lookup Failed: DNS lookup for this hostname failed (domain name does not exist or DNS server error)."
  },
  EAI_AGAIN: {
    code: -3001,
    message: "Temporary DNS Failure: Temporary failure in DNS name resolution; retrying might succeed."
  },
  EPROTO: {
    code: -71,
    message: "Protocol Error: A protocol error occurred, often during the TLS/SSL handshake phase."
  },
  ERR_INVALID_PROTOCOL: {
    code: -1001,
    message: "Invalid URL Protocol: The provided URL uses an unsupported or invalid protocol."
  },
  ERR_TLS_CERT_ALTNAME_INVALID: {
    code: -1002,
    message: "Certificate Invalid Alt Name: The server's SSL/TLS certificate hostname does not match the requested domain (Subject Alternative Name mismatch)."
  },
  ERR_TLS_HANDSHAKE_TIMEOUT: {
    code: -1003,
    message: "TLS Handshake Timeout: The TLS/SSL handshake timed out before completing."
  },
  ERR_TLS_INVALID_PROTOCOL_VERSION: {
    code: -1004,
    message: "Invalid TLS Protocol Version: The client and server could not agree on a mutually supported TLS/SSL protocol version."
  },
  ERR_TLS_RENEGOTIATION_DISABLED: {
    code: -1005,
    message: "TLS Renegotiation Disabled: An attempt at TLS/SSL renegotiation was made, but it is disabled or disallowed by the server/configuration."
  },
  ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED: {
    code: -1006,
    message: "Unsupported Cert Signature Algorithm: The signature algorithm used in the server's SSL/TLS certificate is not supported or deemed insecure by the client."
  },
  ERR_HTTP_HEADERS_SENT: {
    code: -1007,
    message: "Headers Already Sent: An attempt was made to send HTTP headers after they had already been sent (application logic error)."
  },
  ERR_INVALID_ARG_TYPE: {
    code: -1008,
    message: "Invalid Argument Type: An argument of an incorrect type was passed to the underlying HTTP(S) request function."
  },
  ERR_INVALID_URL: {
    code: -1009,
    message: "Invalid URL: The provided URL is syntactically invalid or cannot be parsed."
  },
  ERR_STREAM_DESTROYED: {
    code: -1010,
    message: "Stream Destroyed: The readable/writable stream associated with the request/response was destroyed prematurely."
  },
  ERR_STREAM_PREMATURE_CLOSE: {
    code: -1011,
    message: "Premature Stream Close: The server closed the connection before sending the complete response body (e.g., incomplete chunked encoding)."
  },
  UND_ERR_CONNECT_TIMEOUT: {
    code: -1020,
    message: "Connect Timeout (rezo): Timeout occurred specifically while waiting for the TCP socket connection to be established."
  },
  UND_ERR_HEADERS_TIMEOUT: {
    code: -1021,
    message: "Headers Timeout (rezo): Timeout occurred while waiting to receive the complete HTTP response headers from the server."
  },
  UND_ERR_SOCKET: {
    code: -1022,
    message: "Socket Error (rezo): An error occurred at the underlying socket level (may wrap other errors like ECONNRESET)."
  },
  UND_ERR_INFO: {
    code: -1023,
    message: "Invalid Request Info (rezo): Internal error related to invalid or missing metadata needed to process the request."
  },
  UND_ERR_ABORTED: {
    code: -1024,
    message: "Request Aborted (rezo): The request was explicitly aborted, often due to a timeout signal or user action."
  },
  ABORT_ERR: {
    code: -1025,
    message: "Request Aborted: The request was explicitly aborted, often due to a timeout signal or user action."
  },
  UND_ERR_REQUEST_TIMEOUT: {
    code: -1026,
    message: "Request Timeout (rezo): The request timed out (check specific connect/headers/body timeouts if applicable)."
  },
  UNQ_UNKOWN_ERROR: {
    code: -9999,
    message: "Unknown Error: An unspecified or unrecognized error occurred during the request."
  },
  UNQ_FILE_PERMISSION_ERROR: {
    code: -1027,
    message: "File Permission Error: Insufficient permissions to read or write a required file."
  },
  UNQ_MISSING_REDIRECT_LOCATION: {
    code: -1028,
    message: "Redirect Location Not Found: Redirect header (Location:) missing in the server's response for a redirect status code (3xx)."
  },
  UNQ_DECOMPRESSION_ERROR: {
    code: -1029,
    message: "Decompression Error: Failed to decompress response body. Data may be corrupt or encoding incorrect."
  },
  UNQ_DOWNLOAD_FAILED: {
    code: -1030,
    message: "Download Failed: The resource could not be fully downloaded due to an unspecified error during data transfer."
  },
  UNQ_HTTP_ERROR: {
    code: -1031,
    message: "HTTP Error: The server responded with a non-successful HTTP status code."
  },
  UNQ_REDIRECT_DENIED: {
    code: -1032,
    message: "Redirect Denied: A redirect response was received, but following redirects is disabled or disallowed by configuration/user."
  },
  UNQ_PROXY_INVALID_PROTOCOL: {
    code: -1033,
    message: "Invalid Proxy Protocol: The specified proxy URL has an invalid or unsupported protocol scheme."
  },
  UNQ_PROXY_INVALID_HOSTPORT: {
    code: -1034,
    message: "Invalid Proxy Host/Port: The hostname or port number provided for the proxy server is invalid or malformed."
  },
  UNQ_SOCKS_CONNECTION_FAILED: {
    code: -1040,
    message: "SOCKS Proxy Connection Failed: Failed to establish connection with the SOCKS proxy server (check host, port, network)."
  },
  UNQ_SOCKS_AUTHENTICATION_FAILED: {
    code: -1041,
    message: "SOCKS Proxy Authentication Failed: Authentication with the SOCKS5 proxy failed (invalid credentials or unsupported method)."
  },
  UNQ_SOCKS_TARGET_CONNECTION_FAILED: {
    code: -1042,
    message: "SOCKS Proxy Target Connection Failed: The SOCKS proxy reported failure connecting to the final destination (e.g., Connection refused, Host unreachable, Network unreachable)."
  },
  UNQ_SOCKS_PROTOCOL_ERROR: {
    code: -1043,
    message: "SOCKS Proxy Protocol Error: Invalid or malformed response received from the SOCKS proxy during handshake or connection."
  },
  UNQ_PROXY_ERROR: {
    code: -1047,
    message: "Proxy Error: An unspecified error occurred while communicating with or through the proxy server."
  },
  UNQ_NO_PROXY_AVAILABLE: {
    code: -1050,
    message: "No Proxy Available: All proxies in ProxyManager are exhausted, disabled, or the URL did not match whitelist/blacklist rules."
  }
};
function setSignal() {
  if (this.signal)
    return;
  if (this.timeoutClearInstanse)
    clearTimeout(this.timeoutClearInstanse);
  if (this.timeout && typeof this.timeout === "number" && this.timeout > 100) {
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), this.timeout);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    this.timeoutClearInstanse = timer;
    this.signal = controller.signal;
  }
}
async function getDefaultConfig(config = {}, proxyManager) {
  return {
    baseURL: config.baseURL,
    headers: config.headers,
    rejectUnauthorized: config.rejectUnauthorized,
    httpAgent: config.httpAgent,
    httpsAgent: config.httpsAgent,
    debug: config.debug === true,
    maxRedirects: config.maxRedirects,
    retry: config.retry,
    proxy: config.proxy,
    followRedirects: config.followRedirects,
    useCookies: config.enableCookieJar,
    fs: await getFS(),
    timeout: config.timeout ?? config.requestTimeout,
    hooks: config.hooks,
    cookieFile: config.cookieFile,
    encoding: config.encoding,
    proxyManager: proxyManager || null,
    decompress: config.decompress
  };
}
async function getFS() {
  const type = getEnvironment();
  if (type !== "node" && type !== "deno" && type !== "bun" && type !== "cf-worker") {
    return;
  }
  try {
    return await import("node:fs");
  } catch {
    return;
  }
}
function prepareHTTPOptions(options, jar, addedOptions, config) {
  const validMethods = ["post", "put", "patch"];
  let isNew = false;
  if (!addedOptions.isRedirected || !config || Object.keys(config).length === 0) {
    isNew = true;
    const settions = createConfig(options, jar, addedOptions);
    config = { ...settions.config };
    options = settions.options;
  }
  options.headers = buildHeaders(options.headers);
  let headers = options.headers instanceof RezoHeaders ? options.headers : new RezoHeaders(options.headers || {});
  if (options.headers.has("Cookie")) {
    headers = new RezoHeaders(options.headers.toObject());
    if (!config.useCookies) {
      config.useCookies = true;
    }
    options.headers.delete("Cookie");
  }
  const mainUrl = !isNew && addedOptions.fullUrl ? addedOptions.fullUrl : undefined;
  const forContentType = validMethods.includes(options.method.toLowerCase());
  let fetchOptions = {};
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const cookieJar = config.enableCookieJar ? jar : new RezoCookieJar(config.requestCookies);
  let requestCookies = [];
  fetchOptions.method = options.method;
  if (options.fullUrl) {
    fetchOptions.url = options.fullUrl;
    fetchOptions.fullUrl = options.fullUrl;
  } else {
    fetchOptions.url = options.url;
  }
  let contentType = options.contentType || headers.get("Content-Type") || (forContentType ? "application/json" : undefined);
  if (addedOptions && addedOptions.customHeaders) {
    headers = addedOptions.customHeaders instanceof RezoHeaders ? addedOptions.customHeaders : new RezoHeaders(addedOptions.customHeaders);
  }
  if (headers.has("Cookie")) {
    const cookieString = headers.get("Cookie");
    if (config.useCookies && !addedOptions.redirectedUrl && !addedOptions.isRedirected) {
      cookieJar.setCookiesSync(cookieString, options.url instanceof URL ? options.url.href : options.url);
    }
    headers.delete("Cookie");
    if (options.headers instanceof RezoHeaders) {
      options.headers.delete("Cookie");
    }
  }
  fetchOptions.headers = headers;
  if (options.cookies && config.useCookies) {
    cookieJar.setCookiesSync(options.cookies, options.url instanceof URL ? options.url.href : options.url);
    delete options.cookies;
    delete fetchOptions.cookies;
  }
  if (config.useCookies) {
    if (options.cookies && !addedOptions.redirectedUrl && !addedOptions.isRedirected) {
      cookieJar.setCookiesSync(options.cookies, options.url instanceof URL ? options.url.href : options.url);
    }
  }
  let cookiesString = "";
  if (config.useCookies) {
    requestCookies = cookieJar.getCookiesSync(options.url instanceof URL ? options.url.href : options.url).map((c) => new Cookie(c));
    cookiesString = cookieJar.getCookieStringSync(options.url instanceof URL ? options.url.href : options.url);
  }
  if (options.xsrfCookieName && options.xsrfHeaderName && requestCookies.length > 0) {
    const xsrfCookie = requestCookies.find((c) => c.key === options.xsrfCookieName);
    if (xsrfCookie && xsrfCookie.value) {
      fetchOptions.headers.set(options.xsrfHeaderName, xsrfCookie.value);
    }
  }
  if (requestCookies.length > 0 && config) {
    if (!config.requestCookies) {
      config.requestCookies = requestCookies;
    } else {
      for (const cookie of requestCookies) {
        config.requestCookies = config.requestCookies.filter((c) => c.key !== cookie.key);
        config.requestCookies.push(cookie);
      }
    }
  }
  if (cookiesString) {
    fetchOptions.headers.set("Cookie", cookiesString);
  }
  if (options.body) {
    fetchOptions.body = options.body;
  }
  const isFormData = fetchOptions.body && (fetchOptions.body instanceof FormData || fetchOptions.body instanceof RezoFormData);
  if (!isFormData) {
    if (options.multipart || options.json || options.formData || options.form) {
      if (options.formData || options.multipart) {
        if (options.multipart instanceof RezoFormData || options.formData instanceof RezoFormData) {
          const body = options.multipart instanceof RezoFormData ? options.multipart : options.formData;
          contentType = body.getContentType();
          fetchOptions.body = body;
        } else {
          const body = new RezoFormData;
          const _body = options.formData || options.multipart;
          if (_body) {
            Object.entries(_body).forEach(([key, value]) => {
              if (value === null || value === undefined) {
                body.append(key, "");
              } else if (typeof value === "string" || Buffer.isBuffer(value)) {
                body.append(key, value);
              } else if (typeof value === "object" && typeof value.pipe === "function") {
                body.append(key, value);
              } else if (typeof value === "object" && value.value !== undefined) {
                const val = value.value;
                const opts = value.options || {};
                if (typeof val === "string" || Buffer.isBuffer(val)) {
                  body.append(key, val, opts);
                } else {
                  body.append(key, String(val), opts);
                }
              } else {
                body.append(key, String(value));
              }
            });
          }
          contentType = body.getContentType();
          fetchOptions.body = body;
        }
        fetchOptions.headers.set("Content-Type", contentType);
      } else if (options.form) {
        contentType = "application/x-www-form-urlencoded";
        if (typeof options.form === "object") {
          fetchOptions.body = new RezoURLSearchParams(options.form).toString();
        } else {
          fetchOptions.body = options.form;
        }
        fetchOptions.headers.set("Content-Type", contentType);
      } else if (options.json) {
        fetchOptions.body = options.body;
        contentType = "application/json";
        fetchOptions.headers.set("Content-Type", contentType);
      }
    } else if (contentType) {
      const type = contentType.toLowerCase();
      if (type.includes("json")) {
        fetchOptions.headers.set("Content-Type", "application/json");
        if (fetchOptions.body && typeof fetchOptions.body === "object") {
          fetchOptions.body = JSON.stringify(fetchOptions.body);
        }
      } else if (type.includes("x-www-form-urlencoded")) {
        fetchOptions.headers.set("Content-Type", "application/x-www-form-urlencoded");
        if (fetchOptions.body && typeof fetchOptions.body === "object") {
          fetchOptions.body = new URLSearchParams(fetchOptions.body).toString();
        }
      } else if (type.includes("multipart")) {
        if (fetchOptions.body && typeof fetchOptions.body === "object") {
          const formData = new RezoFormData;
          Object.entries(fetchOptions.body).forEach(([key, value]) => {
            if (value === null || value === undefined) {
              formData.append(key, "");
            } else if (typeof value === "string" || Buffer.isBuffer(value)) {
              formData.append(key, value);
            } else if (typeof value === "object" && typeof value.pipe === "function") {
              formData.append(key, value);
            } else if (typeof value === "object" && value.value !== undefined) {
              const val = value.value;
              const opts = value.options || {};
              if (typeof val === "string" || Buffer.isBuffer(val)) {
                formData.append(key, val, opts);
              } else {
                formData.append(key, String(val), opts);
              }
            } else {
              formData.append(key, String(value));
            }
          });
          fetchOptions.body = formData;
        }
      } else if (type.includes("text/") || type.includes("/javascript")) {
        fetchOptions.body = fetchOptions.body ? typeof fetchOptions.body === "object" ? JSON.stringify(fetchOptions.body) : fetchOptions.body : "";
        fetchOptions.headers.set("Content-Type", contentType);
      }
    } else if (contentType && !options.withoutContentType) {
      fetchOptions.headers.set("Content-Type", contentType);
    }
  }
  if (options.withoutContentType || isFormData) {
    fetchOptions.headers.delete("Content-Type");
  }
  if (options.withoutBodyOnRedirect && addedOptions.isRedirected) {
    fetchOptions.body = undefined;
  }
  options.rejectUnauthorized = config.rejectUnauthorized;
  if ((typeof options.autoSetReferer !== "boolean" || options.autoSetReferer) && addedOptions.redirectedUrl) {
    if (!addedOptions.customHeaders)
      fetchOptions.headers.set("Referer", addedOptions.redirectedUrl);
  }
  if (!config.useCookies) {
    fetchOptions.headers.delete("Cookie");
  }
  if (fetchOptions.body && (fetchOptions.body instanceof FormData || fetchOptions.body instanceof RezoFormData)) {
    fetchOptions.headers.delete("Content-Type");
  }
  if (options.proxy) {
    fetchOptions.proxy = options.proxy;
  }
  if (fetchOptions.method.toLowerCase() === "get" && fetchOptions.headers.has("Content-Type")) {
    fetchOptions.headers.delete("Content-Type");
  }
  if (mainUrl || addedOptions.redirectedUrl) {
    fetchOptions.headers.set("host", new URL(fetchOptions.fullUrl).host);
    if ([`POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`].includes(fetchOptions.method.toUpperCase()))
      fetchOptions.headers.set("origin", new URL(mainUrl || fetchOptions.url).origin);
  } else {
    if (!fetchOptions.headers.has("origin") && options.autoSetOrigin) {
      const r = [`POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`].includes(fetchOptions.method.toUpperCase());
      if (r)
        fetchOptions.headers.set("origin", new URL(mainUrl || fetchOptions.url).origin);
    }
    if (mainUrl && !fetchOptions.headers.has("referer") && options.autoSetReferer) {
      fetchOptions.headers.set("referer", mainUrl);
    }
  }
  if (addedOptions.redirectCode && addedOptions.lastRedirectedUrl) {
    fetchOptions.headers.set("referer", addedOptions.lastRedirectedUrl);
  }
  if (options.responseType) {
    fetchOptions.responseType = options.responseType;
  }
  if (options.httpAgent) {
    fetchOptions.httpAgent = options.httpAgent;
  }
  if (options.httpsAgent) {
    fetchOptions.httpsAgent = options.httpsAgent;
  }
  if (isNew && config) {
    config.originalRequest = fetchOptions;
  }
  fetchOptions.rejectUnauthorized = options.rejectUnauthorized;
  if (options.sessionId) {
    fetchOptions.sessionId = options.sessionId;
  }
  let resolvedProxyManager = null;
  const pm = addedOptions.defaultOptions.proxyManager;
  if (pm && options.useProxyManager !== false && !options.proxy) {
    resolvedProxyManager = pm;
  }
  return {
    fetchOptions,
    config,
    options,
    proxyManager: resolvedProxyManager
  };
}
function buildHeaders(headers) {
  return headers = headers instanceof RezoHeaders ? headers : new RezoHeaders(headers);
}
function createConfig(options, jar, addedOptions) {
  const { defaultOptions } = addedOptions;
  const { fs } = defaultOptions;
  const rawUrl = typeof options.url === "string" ? options.url : options.url.toString();
  options["debug"] = options.debug ?? defaultOptions.debug;
  const {
    autoSetOrigin = false,
    autoSetReferer = false,
    useCookies = typeof defaultOptions.useCookies === "boolean" ? defaultOptions.useCookies : undefined,
    httpAgent = defaultOptions.httpAgent,
    rejectUnauthorized = defaultOptions.rejectUnauthorized,
    httpsAgent = defaultOptions.httpsAgent,
    followRedirects = true,
    withCredentials = typeof defaultOptions.withCredentials === "boolean" ? defaultOptions.withCredentials : undefined,
    enableRedirectCycleDetection = typeof defaultOptions.enableRedirectCycleDetection === "boolean" ? defaultOptions.enableRedirectCycleDetection : false
  } = options;
  delete options.autoSetOrigin;
  delete options.autoSetReferer;
  const requestOptions = {
    ...options,
    autoSetOrigin,
    autoSetReferer,
    useCookies,
    followRedirects,
    httpsAgent,
    httpAgent
  };
  if (typeof requestOptions.treat302As303 === "undefined") {
    requestOptions.treat302As303 = true;
  }
  requestOptions.useCookies = typeof useCookies === "boolean" ? useCookies : typeof withCredentials === "boolean" ? withCredentials : true;
  requestOptions.proxy = requestOptions.proxy || defaultOptions.proxy;
  const debug = requestOptions.debug !== undefined ? requestOptions.debug : false;
  const type = getEnvironment();
  if (type !== "node" && type !== "bun" && type !== "deno") {
    if (httpAgent || httpsAgent) {
      throw new Error(`Custom HTTP or HTTPS agents are not supported in '${type}' mode. Please remove 'httpAgent' or 'httpsAgent'.`);
    }
    if (rejectUnauthorized && debug) {
      console.warn(`[WARNING] 'rejectUnauthorized' is enabled in '${type}' mode.
The built-in fetch API does not support this option directly.
As a workaround, process.env.NODE_TLS_REJECT_UNAUTHORIZED is being set to '0'.
` + `⚠️ This disables TLS certificate verification and can expose sensitive data.
` + `⚠️ Avoid using 'rejectUnauthorized' in '${type}' environments unless absolutely necessary.`);
      if (typeof process !== "undefined")
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const method = methods && methods.includes(options.method.toUpperCase()) ? options.method?.toUpperCase() : "GET";
  requestOptions.method = method;
  if (options.startNewRequest)
    jar?.removeAllCookiesSync();
  const maxRedirects = requestOptions.maxRedirects || 10;
  const saveTo = requestOptions.saveTo || requestOptions.fileName;
  let fileName = undefined;
  requestOptions.timeout = requestOptions.timeout ?? defaultOptions.timeout;
  if (defaultOptions.retry && !requestOptions.retry) {
    requestOptions.retry = {
      maxRetries: defaultOptions.retry.maxRetries && typeof defaultOptions.retry.maxRetries === "number" ? defaultOptions.retry.maxRetries : 0,
      retryDelay: defaultOptions.retry.retryDelay && typeof defaultOptions.retry.retryDelay === "number" ? defaultOptions.retry.retryDelay : 0,
      incrementDelay: defaultOptions.retry.incrementDelay && typeof defaultOptions.retry.incrementDelay === "boolean" ? defaultOptions.retry.incrementDelay : false,
      condition: defaultOptions.retry.condition,
      statusCodes: defaultOptions.retry.statusCodes || [408, 429, 500, 502, 503, 504, 425, 520]
    };
  }
  requestOptions.followRedirects = typeof requestOptions.followRedirects === "boolean" ? requestOptions.followRedirects : typeof defaultOptions.followRedirects === "boolean" ? defaultOptions.followRedirects : true;
  const retryLimit = typeof requestOptions?.retry?.maxRetries === "number" && requestOptions?.retry?.maxRetries > 0 ? requestOptions?.retry?.maxRetries : 0;
  const retryDelay = typeof requestOptions?.retry?.retryDelay === "number" && requestOptions?.retry?.retryDelay > 0 ? requestOptions?.retry?.retryDelay : 0;
  const retryIncrementDelay = typeof requestOptions?.retry?.incrementDelay === "boolean" ? requestOptions?.retry?.incrementDelay : false;
  const statusCodes = Array.isArray(requestOptions?.retry?.statusCodes) && requestOptions.retry.statusCodes.length > 0 ? requestOptions.retry.statusCodes : [408, 429, 500, 502, 503, 504, 425, 520];
  const redirectCount = 0;
  const params = new RezoURLSearchParams(options.params || {});
  const baseURL = requestOptions.baseURL && (requestOptions.baseURL.startsWith("http://") || requestOptions.baseURL.startsWith("https://")) ? requestOptions.baseURL : defaultOptions.baseURL && (defaultOptions.baseURL.startsWith("http://") || defaultOptions.baseURL.startsWith("https://")) ? defaultOptions.baseURL : undefined;
  const url = new URL(options.url, baseURL);
  params.forEach((value, key) => {
    if (value && !url.searchParams.has(key)) {
      url.searchParams.append(key, value);
    }
  });
  requestOptions.fullUrl = url.href;
  requestOptions.url = options.url;
  requestOptions.baseURL = options.baseURL;
  requestOptions.params = options.params;
  requestOptions["method"] = method;
  requestOptions["headers"] = parseInputHeaders(requestOptions.headers, defaultOptions.headers);
  requestOptions["debug"] = requestOptions["debug"] !== undefined ? requestOptions["debug"] : defaultOptions.debug;
  requestOptions.proxy = typeof requestOptions.proxy === "string" ? parseProxyString(requestOptions.proxy) : requestOptions.proxy;
  requestOptions.useCookies = useCookies;
  const normalizedProxy = requestOptions.proxy ? typeof requestOptions.proxy === "string" ? parseProxyString(requestOptions.proxy) : requestOptions.proxy : null;
  const config = {
    url: requestOptions.url,
    rawUrl,
    baseURL: requestOptions.baseURL || url.origin,
    params: requestOptions.params || {},
    method: requestOptions.method,
    headers: requestOptions.headers,
    maxRedirects,
    retryAttempts: 0,
    timeout: typeof requestOptions.timeout === "number" ? requestOptions.timeout : null,
    enableCookieJar: typeof defaultOptions.enableCookieJar === "boolean" ? defaultOptions.enableCookieJar : true,
    useCookies: typeof requestOptions.useCookies === "boolean" ? requestOptions.useCookies : true,
    cookieJar: requestOptions.jar || jar,
    retry: {
      maxRetries: retryLimit,
      retryDelay,
      incrementDelay: retryIncrementDelay,
      statusCodes,
      condition: requestOptions.retry?.condition || defaultOptions.retry?.condition || ((error) => {
        return error;
      })
    },
    originalRequest: requestOptions,
    redirectCount,
    redirectHistory: [],
    network: {},
    timing: {},
    transfer: {},
    responseType: requestOptions.responseType,
    proxy: normalizedProxy,
    enableRedirectCycleDetection,
    rejectUnauthorized: typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : true,
    decompress: typeof requestOptions.decompress === "boolean" ? requestOptions.decompress : typeof defaultOptions.decompress === "boolean" ? defaultOptions.decompress : true
  };
  config.setSignal = setSignal.bind(config);
  if (requestOptions.encoding || defaultOptions.encoding) {
    config.encoding = requestOptions.encoding || defaultOptions.encoding;
  }
  if (requestOptions.beforeRedirect || defaultOptions.beforeRedirect) {
    config.beforeRedirect = requestOptions.beforeRedirect || defaultOptions.beforeRedirect;
  }
  config.requestCookies = [];
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
  config.cookieFile = defaultOptions.cookieFile || jar.cookieFile || null;
  const baseHooks = mergeHooks(createDefaultHooks(), defaultOptions.hooks || {});
  const mergedHooks = mergeHooks(baseHooks, requestOptions.hooks || {});
  config.hooks = serializeHooks(mergedHooks);
  if (typeof config.enableCookieJar !== "boolean") {
    config.enableCookieJar = true;
  }
  if (!config.enableCookieJar) {
    config.cookieJar = new RezoCookieJar;
  }
  if (options.httpAgent) {
    config.httpAgent = options.httpAgent;
  }
  if (options.httpsAgent) {
    config.httpsAgent = options.httpsAgent;
  }
  const isSupportedRuntime = type === "node" || type === "bun" || type === "deno";
  if (saveTo) {
    if (!isSupportedRuntime) {
      throw new Error(`You can only use this feature in Node.js, Deno or Bun and not available in Edge or Browser.`);
    } else if (!fs) {
      throw new Error(`You can only use this feature in nodejs module, not in Edge module.`);
    }
    const name = path.basename(saveTo);
    if (checkISPermission && checkISPermission(saveTo.length ? path.dirname(saveTo) : path.resolve(process.cwd()), fs)) {
      const dir = name.length < saveTo.length ? path.dirname(saveTo) : path.join(process.cwd(), "download");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fileName = path.join(dir, name);
      config.fileName = fileName;
    } else {
      throw new Error(`Permission denied to save to ${saveTo}`);
    }
  }
  return {
    config,
    options: requestOptions
  };
}
function getEnvironment() {
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }
  if (typeof Bun !== "undefined") {
    return "bun";
  }
  if (typeof Deno !== "undefined") {
    return "deno";
  }
  if (typeof caches !== "undefined" && typeof Request !== "undefined" && typeof Response !== "undefined" && typeof addEventListener !== "undefined" && typeof importScripts === "undefined" && typeof window === "undefined") {
    return "cf-worker";
  }
  if (typeof self !== "undefined" && typeof importScripts !== "undefined" && typeof caches !== "undefined" && "serviceWorker" in navigator) {
    return "service-worker";
  }
  if (typeof self !== "undefined" && typeof importScripts !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope && typeof window === "undefined") {
    return "web-worker";
  }
  if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
    return "worker";
  }
  if (typeof window !== "undefined" && typeof document !== "undefined" && typeof navigator !== "undefined") {
    return "browser";
  }
  return "unknown";
}
function parseInputHeaders(headers, defaultHeaders) {
  const requestHeaders = headers instanceof RezoHeaders ? headers : new RezoHeaders(headers !== undefined ? headers : {});
  defaultHeaders = defaultHeaders instanceof RezoHeaders ? defaultHeaders : new RezoHeaders(defaultHeaders !== undefined ? defaultHeaders : {});
  if (defaultHeaders instanceof RezoHeaders) {
    defaultHeaders.forEach((value, key) => {
      if (value && !requestHeaders.has(key)) {
        requestHeaders.append(key, value);
      }
    });
  }
  return requestHeaders;
}
function getCode(code) {
  const error = ERROR_INFO[code];
  if (error) {
    return {
      code,
      errno: error.code,
      message: error.message
    };
  } else {
    const error = ERROR_INFO["UNQ_UNKOWN_ERROR"];
    return {
      code: "UNQ_UNKOWN_ERROR",
      errno: error.code,
      message: error.message
    };
  }
}
function checkISPermission(currentDir, fs) {
  try {
    fs.accessSync(currentDir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
async function checkCurl() {
  const type = getEnvironment();
  if (type !== "node" && type !== "deno" && type !== "bun") {
    return { status: false };
  }
  const { execSync } = await import("node:child_process");
  try {
    return curlCheckOption(execSync("curl --version").toString().includes("curl"));
  } catch {
    return curlCheckOption();
  }
}
async function curlCheckOption(isAvailable) {
  const type = getEnvironment();
  if (type !== "node" && type !== "deno" && type !== "bun") {
    return { status: false };
  }
  const { existsSync } = await import("node:fs");
  const os = await import("node:os");
  if (isAvailable)
    return { status: true };
  let message = "Curl is not installed. ";
  const platform = os.platform();
  if (platform === "darwin") {
    message += "Install curl via Homebrew with 'brew install curl' or use 'xcode-select --install' to install command line tools.";
  } else if (platform === "win32") {
    message += "Install curl by downloading it from https://curl.se/windows/ or use a package manager like Chocolatey with 'choco install curl'.";
  } else if (platform === "linux") {
    const isDebian = existsSync("/etc/debian_version");
    const isRedHat = existsSync("/etc/redhat-release");
    const isArch = existsSync("/etc/arch-release");
    if (isDebian) {
      message += "Install curl with 'sudo apt-get install curl'.";
    } else if (isRedHat) {
      message += "Install curl with 'sudo dnf install curl' or 'sudo yum install curl'.";
    } else if (isArch) {
      message += "Install curl with 'sudo pacman -S curl'.";
    } else {
      message += "Install curl using your distribution's package manager.";
    }
  } else {
    message += "Please install curl from https://curl.se/download.html";
  }
  return {
    status: false,
    message
  };
}

exports.getDefaultConfig = getDefaultConfig;
exports.getFS = getFS;
exports.prepareHTTPOptions = prepareHTTPOptions;
exports.getCode = getCode;