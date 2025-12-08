const { RezoCookieJar } = require('../utils/cookies.cjs');
const { RezoHeaders } = require('../utils/headers.cjs');
const { RezoFormData } = require('../utils/form-data.cjs');
const { RezoQueue } = require('../queue/queue.cjs');
const { RezoURLSearchParams } = require('../utils/data-operations.cjs');
const packageJson = require("../../package.json");
const { createDefaultHooks, mergeHooks, runVoidHooksSync, runTransformHooks } = require('./hooks.cjs');
const { ResponseCache, DNSCache } = require('../cache/index.cjs');
const { ProxyManager } = require('../proxy/manager.cjs');
let globalAdapter = null;
function setGlobalAdapter(adapter) {
  globalAdapter = adapter;
}
function getGlobalAdapter() {
  return globalAdapter;
}
function generateInstanceSessionId() {
  return `ses_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
function parseCacheOption(option) {
  if (!option)
    return {};
  if (option === true) {
    return { response: { enable: true }, dns: true };
  }
  return {
    response: typeof option.response === "boolean" ? option.response ? { enable: true } : undefined : option.response,
    dns: option.dns === true || typeof option.dns === "object" && option.dns.enable !== false
  };
}

class Rezo {
  queue = null;
  isQueueEnabled = false;
  defaults;
  hooks;
  jar;
  sessionId;
  responseCache;
  dnsCache;
  adapter;
  _proxyManager = null;
  constructor(config, adapter) {
    if (!adapter && !globalAdapter) {
      throw new Error(`No HTTP adapter configured. Import from a platform-specific entry:
` + `  - Node.js/Bun/Deno: import { Rezo } from "rezo"
` + `  - Browser: import { Rezo } from "rezo"
` + "  - Or provide an adapter: new Rezo(config, myAdapter)");
    }
    this.adapter = adapter || globalAdapter;
    this.defaults = config || {};
    if (config?.cookieJar instanceof RezoCookieJar) {
      this.jar = config.cookieJar;
    } else if (config?.cookieFile) {
      this.jar = RezoCookieJar.fromFile(config.cookieFile);
    } else {
      this.jar = new RezoCookieJar;
    }
    this.hooks = mergeHooks(createDefaultHooks(), config?.hooks);
    this.sessionId = generateInstanceSessionId();
    this.isQueueEnabled = config?.queueOptions?.enable || false;
    if (this.isQueueEnabled) {
      this.queue = new RezoQueue(config?.queueOptions?.options);
    }
    const cacheConfig = parseCacheOption(config?.cache);
    if (cacheConfig.response) {
      this.responseCache = new ResponseCache(cacheConfig.response);
    }
    if (cacheConfig.dns) {
      const dnsOptions = typeof config?.cache === "object" && typeof config.cache.dns === "object" ? config.cache.dns : undefined;
      this.dnsCache = new DNSCache(dnsOptions);
    }
    if (config?.proxyManager) {
      if (config.proxyManager instanceof ProxyManager) {
        this._proxyManager = config.proxyManager;
      } else {
        this._proxyManager = new ProxyManager(config.proxyManager);
      }
    }
  }
  get proxyManager() {
    return this._proxyManager;
  }
  clearCache() {
    this.responseCache?.clear();
    this.dnsCache?.clear();
  }
  invalidateCache(url, method) {
    this.responseCache?.invalidate(url, method);
  }
  getCacheStats() {
    const stats = {};
    if (this.responseCache) {
      stats.response = {
        size: this.responseCache.size,
        enabled: this.responseCache.isEnabled,
        persistent: this.responseCache.isPersistent
      };
    }
    if (this.dnsCache) {
      stats.dns = {
        size: this.dnsCache.size,
        enabled: this.dnsCache.isEnabled
      };
    }
    return stats;
  }
  get = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "GET",
      url
    }, this.defaults, this.jar);
  };
  head = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "HEAD",
      url
    }, this.defaults, this.jar);
  };
  options = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "OPTIONS",
      url
    }, this.defaults, this.jar);
  };
  trace = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "TRACE",
      url
    }, this.defaults, this.jar);
  };
  delete = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "DELETE",
      url
    }, this.defaults, this.jar);
  };
  request = (options) => {
    return this.executeRequest(options, this.defaults, this.jar);
  };
  post = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "POST"
    }, this.defaults, this.jar);
  };
  postJson = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/json");
    options.headers = headers;
    data = typeof data === "string" ? data : Array.isArray(data) ? JSON.stringify(data) : Object.keys(data || {}).length ? JSON.stringify(data) : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "POST"
    }, this.defaults, this.jar);
  };
  postForm = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/x-www-form-urlencoded");
    options.headers = headers;
    data = typeof data === "string" ? data : data instanceof URLSearchParams ? data.toString() : data instanceof RezoURLSearchParams ? data.toString() : Object.keys(data || {}).length ? new RezoURLSearchParams(data || {}).toString() : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "POST"
    }, this.defaults, this.jar);
  };
  postMultipart = async (url, data, options = {}) => {
    let formData;
    if (data instanceof RezoFormData) {
      formData = data;
    } else if (data instanceof FormData) {
      formData = await RezoFormData.fromNativeFormData(data);
    } else {
      formData = RezoFormData.fromObject(data);
    }
    return this.executeRequest({
      ...options,
      url,
      formData,
      method: "POST"
    }, this.defaults, this.jar);
  };
  put = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PUT"
    }, this.defaults, this.jar);
  };
  putJson = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/json");
    options.headers = headers;
    data = typeof data === "string" ? data : Array.isArray(data) ? JSON.stringify(data) : Object.keys(data || {}).length ? JSON.stringify(data) : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PUT"
    }, this.defaults, this.jar);
  };
  putForm = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/x-www-form-urlencoded");
    options.headers = headers;
    data = typeof data === "string" ? data : data instanceof URLSearchParams ? data.toString() : data instanceof RezoURLSearchParams ? data.toString() : Object.keys(data || {}).length ? new RezoURLSearchParams(data || {}).toString() : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PUT"
    }, this.defaults, this.jar);
  };
  putMultipart = async (url, data, options = {}) => {
    let formData;
    if (data instanceof RezoFormData) {
      formData = data;
    } else if (data instanceof FormData) {
      formData = await RezoFormData.fromNativeFormData(data);
    } else {
      formData = RezoFormData.fromObject(data);
    }
    return this.executeRequest({
      ...options,
      url,
      formData,
      method: "PUT"
    }, this.defaults, this.jar);
  };
  patch = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PATCH"
    }, this.defaults, this.jar);
  };
  patchJson = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/json");
    options.headers = headers;
    data = typeof data === "string" ? data : Array.isArray(data) ? JSON.stringify(data) : Object.keys(data || {}).length ? JSON.stringify(data) : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PATCH"
    }, this.defaults, this.jar);
  };
  patchForm = (url, data, options = {}) => {
    const headers = new RezoHeaders(options.headers);
    headers.setContentType("application/x-www-form-urlencoded");
    options.headers = headers;
    data = typeof data === "string" ? data : data instanceof URLSearchParams ? data.toString() : data instanceof RezoURLSearchParams ? data.toString() : Object.keys(data || {}).length ? new RezoURLSearchParams(data || {}).toString() : "";
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PATCH"
    }, this.defaults, this.jar);
  };
  patchMultipart = async (url, data, options = {}) => {
    let formData;
    if (data instanceof RezoFormData) {
      formData = data;
    } else if (data instanceof FormData) {
      formData = await RezoFormData.fromNativeFormData(data);
    } else {
      formData = RezoFormData.fromObject(data);
    }
    return this.executeRequest({
      ...options,
      url,
      formData,
      method: "PATCH"
    }, this.defaults, this.jar);
  };
  async executeRequest(options, defaultOptions, jar) {
    const requestHooks = options.hooks ? mergeHooks(this.hooks, options.hooks) : this.hooks;
    options.sessionId = this.sessionId;
    const plainOptions = { ...options };
    runVoidHooksSync(requestHooks.init, plainOptions, options);
    const headers = new RezoHeaders(options.headers);
    headers.setUserAgent(headers.getUserAgent() || `Rezo/${packageJson.version} (+https://www.npmjs.com/package/${packageJson.name})`);
    const fullUrl = this.buildFullUrl(options.url, defaultOptions.baseURL);
    const method = (options.method || "GET").toUpperCase();
    const requestHeadersRaw = headers.toObject();
    const requestHeaders = {};
    for (const [key, value] of Object.entries(requestHeadersRaw)) {
      requestHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    const cacheMode = options.cache;
    const shouldCheckCache = this.responseCache && cacheMode !== "reload" && cacheMode !== "no-store" && !(options._isStream || options._isDownload || options._isUpload);
    if (shouldCheckCache) {
      const cached = this.responseCache.get(method, fullUrl, requestHeaders);
      if (cached) {
        return {
          data: cached.data,
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
          config: options,
          request: undefined,
          _fromCache: true
        };
      }
      if (cacheMode === "only-if-cached") {
        throw new Error("Response not found in cache");
      }
      if (cacheMode !== "force-cache") {
        const conditionalHeaders = this.responseCache.getConditionalHeaders(method, fullUrl, requestHeaders);
        if (conditionalHeaders) {
          Object.assign(requestHeaders, conditionalHeaders);
          options.headers = requestHeaders;
        }
      }
    }
    const executeWithHooks = async () => {
      const mergedDefaults = this._proxyManager ? { ...defaultOptions, _proxyManager: this._proxyManager } : defaultOptions;
      const response = await this.adapter(options, mergedDefaults, jar);
      if (jar.cookieFile) {
        try {
          jar.saveToFile();
        } catch (e) {}
      }
      if (this.responseCache && cacheMode !== "no-store" && response && typeof response === "object" && "data" in response && !(options._isStream || options._isDownload || options._isUpload)) {
        this.responseCache.set(method, fullUrl, response, requestHeaders);
      }
      if (response && typeof response === "object" && "data" in response && requestHooks.afterResponse.length > 0) {
        const context = {
          retryCount: 0,
          retryWithMergedOptions: (mergeOptions) => {
            throw new Error("Retry requested with options: " + JSON.stringify(mergeOptions));
          }
        };
        return runTransformHooks(requestHooks.afterResponse, response, response.config, context);
      }
      return response;
    };
    if (options.queue) {
      return await options.queue.add(() => executeWithHooks());
    }
    if (this.isQueueEnabled && this.queue) {
      return await this.queue.add(() => executeWithHooks());
    }
    return executeWithHooks();
  }
  buildFullUrl(url, baseURL) {
    if (!url)
      return baseURL || "";
    const urlStr = url.toString();
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      return urlStr;
    }
    if (baseURL) {
      return baseURL.endsWith("/") ? baseURL + (urlStr.startsWith("/") ? urlStr.slice(1) : urlStr) : baseURL + (urlStr.startsWith("/") ? urlStr : "/" + urlStr);
    }
    return urlStr;
  }
  isvalidJson(str) {
    try {
      return JSON.parse(str) ? true : false;
    } catch {
      return false;
    }
  }
  __create(config) {
    return new Rezo(config, this.adapter);
  }
  get cookieJar() {
    return this.jar;
  }
  set cookieJar(jar) {
    this.jar = jar;
  }
  saveCookies(filePath) {
    if (filePath) {
      this.jar.saveToFile(filePath);
    } else if (this.jar.cookieFile) {
      this.jar.saveToFile();
    } else {
      throw new Error("No cookie file path configured. Provide a path or configure cookieFile option.");
    }
  }
  stream(url, options) {
    return this.executeRequest({
      ...options,
      method: options?.method || "GET",
      url,
      _isStream: true
    }, this.defaults, this.jar);
  }
  download(url, saveTo, options) {
    return this.executeRequest({
      ...options,
      method: options?.method || "GET",
      url,
      saveTo,
      _isDownload: true
    }, this.defaults, this.jar);
  }
  upload(url, data, options) {
    return this.executeRequest({
      ...options,
      method: options?.method || "POST",
      url,
      body: data,
      _isUpload: true
    }, this.defaults, this.jar);
  }
  setCookies(cookies, url, startNew) {
    if (!this.jar)
      this.jar = new RezoCookieJar;
    if (startNew)
      this.jar.removeAllCookiesSync();
    this.jar.setCookiesSync(cookies, url);
  }
  getCookies() {
    return this.jar.cookies();
  }
  clearCookies() {
    this.jar?.removeAllCookiesSync();
  }
}
const defaultTransforms = exports.defaultTransforms = {
  request: [
    function transformRequestData(data, headers, config) {
      if (data === null || data === undefined) {
        return data;
      }
      if (config?.isMultipart || config?.multipart) {
        if (typeof FormData !== "undefined" && data instanceof FormData) {
          return data;
        }
        if (data instanceof RezoFormData) {
          if (headers instanceof RezoHeaders) {
            headers.setContentType(data.getContentType());
          }
          return data.toBuffer();
        }
        if (typeof data === "object" && data.constructor === Object) {
          const formData = RezoFormData.fromObject(data);
          if (headers instanceof RezoHeaders) {
            headers.setContentType(formData.getContentType());
          }
          return formData.toBuffer();
        }
        return data;
      }
      if (typeof FormData !== "undefined" && data instanceof FormData) {
        return data;
      }
      if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) {
        if (headers instanceof RezoHeaders) {
          headers.setContentType("application/x-www-form-urlencoded;charset=utf-8");
        } else {
          headers["content-type"] = "application/x-www-form-urlencoded;charset=utf-8";
        }
        return data.toString();
      }
      if (typeof data === "object" && data.constructor === Object) {
        if (headers instanceof RezoHeaders) {
          headers.setContentType("application/json;charset=utf-8");
        } else {
          headers["content-type"] = "application/json;charset=utf-8";
        }
        return JSON.stringify(data);
      }
      return data;
    }
  ],
  response: [
    function transformResponseData(data) {
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {}
      }
      return data;
    }
  ]
};
const { RezoError } = require('../errors/rezo-error.cjs');
function createRezoInstance(adapter, config) {
  const instance = new Rezo(config, adapter);
  instance.create = (cfg) => new Rezo(cfg, adapter);
  instance.isRezoError = RezoError.isRezoError;
  instance.isCancel = (error) => {
    return error instanceof RezoError && error.code === "ECONNABORTED";
  };
  instance.Cancel = RezoError;
  instance.CancelToken = AbortController;
  instance.all = Promise.all.bind(Promise);
  instance.spread = (callback) => (array) => callback(...array);
  return instance;
}
function createDefaultInstance(config) {
  if (!globalAdapter) {
    throw new Error(`No HTTP adapter configured. Import from a platform-specific entry:
` + `  - Node.js: import rezo from "rezo"
` + `  - Browser: import rezo from "rezo"
` + "The bundler will automatically select the appropriate adapter.");
  }
  return createRezoInstance(globalAdapter, config);
}

exports.setGlobalAdapter = setGlobalAdapter;
exports.getGlobalAdapter = getGlobalAdapter;
exports.Rezo = Rezo;
exports.createRezoInstance = createRezoInstance;
exports.createDefaultInstance = createDefaultInstance;