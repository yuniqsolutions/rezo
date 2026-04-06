import { RezoCookieJar } from '../cookies/cookie-jar.js';
import { RezoHeaders } from '../utils/headers.js';
import { RezoFormData } from '../utils/form-data.js';
import { RezoQueue } from '../queue/queue.js';
import { HttpQueue } from '../queue/http-queue.js';
import { RezoURLSearchParams } from '../utils/data-operations.js';
import { VERSION, PACKAGE_NAME } from '../version.js';
import { createDefaultHooks, mergeHooks, runVoidHooksSync, runTransformHooks } from './hooks.js';
import { RequestInterceptorManager, ResponseInterceptorManager } from './interceptor-manager.js';
import { ResponseCache, DNSCache } from '../cache/index.js';
import { DownloadResponse } from '../responses/universal/download.js';
import { StreamResponse } from '../responses/universal/stream.js';
import { UploadResponse } from '../responses/universal/upload.js';
import { ProxyManager } from '../proxy/manager.js';
import { toCurl as toCurlUtil, fromCurl as fromCurlUtil } from '../utils/curl.js';
import { parseLinkHeader } from '../utils/link-header.js';
import { RezoUri } from '../utils/uri.js';
function applyUrlParts(url, opts) {
  if (opts.protocol)
    url.protocol = opts.protocol.includes(":") ? opts.protocol : opts.protocol + ":";
  if (opts.username)
    url.username = opts.username;
  if (opts.password)
    url.password = opts.password;
  if (opts.host)
    url.host = opts.host;
  if (opts.hostname)
    url.hostname = opts.hostname;
  if (opts.port !== undefined)
    url.port = String(opts.port);
  if (opts.pathname)
    url.pathname = opts.pathname;
  if (opts.search)
    url.search = opts.search;
  if (opts.hash)
    url.hash = opts.hash.startsWith("#") ? opts.hash : "#" + opts.hash;
  if (opts.auth) {
    url.username = encodeURIComponent(opts.auth.username);
    url.password = encodeURIComponent(opts.auth.password);
  }
}
function appendParams(url, opts) {
  if (!opts.params)
    return;
  const serializer = opts.paramsSerializer;
  if (serializer) {
    const serialized = serializer(opts.params);
    if (serialized) {
      const sp = typeof serialized === "string" ? new URLSearchParams(serialized) : new URLSearchParams(serialized);
      sp.forEach((v, k) => {
        if (!url.searchParams.has(k))
          url.searchParams.append(k, v);
      });
    }
  } else {
    const sp = new RezoURLSearchParams(opts.params);
    sp.forEach((v, k) => {
      if (v && !url.searchParams.has(k))
        url.searchParams.append(k, v);
    });
  }
}
function buildUriFromParts(opts) {
  const protocol = (opts.protocol || "https").replace(/:$/, "");
  const host = opts.host || opts.hostname || "localhost";
  const port = opts.port !== undefined && !opts.host ? `:${opts.port}` : "";
  const pathname = opts.pathname || "/";
  const path = pathname.startsWith("/") ? pathname : "/" + pathname;
  const url = new RezoUri(`${protocol}://${host}${port}${path}`);
  applyUrlParts(url, opts);
  appendParams(url, opts);
  return url;
}
let globalAdapter = null;
export function setGlobalAdapter(adapter) {
  globalAdapter = adapter;
}
export function getGlobalAdapter() {
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

export class Rezo {
  queue = null;
  isQueueEnabled = false;
  defaults;
  hooks;
  cookieJar;
  sessionId;
  responseCache;
  dnsCache;
  adapter;
  _proxyManager = null;
  interceptors;
  constructor(config, adapter) {
    if (!adapter && !globalAdapter) {
      throw new Error(`No HTTP adapter configured. Import from a platform-specific entry:
` + `  - Node.js/Bun/Deno: import { Rezo } from "rezo"
` + `  - Browser: import { Rezo } from "rezo"
` + "  - Or provide an adapter: new Rezo(config, myAdapter)");
    }
    this.adapter = adapter || globalAdapter;
    this.defaults = config || {};
    if (config?.jar instanceof RezoCookieJar) {
      this.cookieJar = config.jar;
    } else if (config?.cookieFile) {
      this.cookieJar = RezoCookieJar.fromFile(config.cookieFile);
    } else {
      this.cookieJar = new RezoCookieJar;
    }
    this.hooks = mergeHooks(createDefaultHooks(), config?.hooks);
    this.sessionId = generateInstanceSessionId();
    this.interceptors = {
      request: new RequestInterceptorManager(this.hooks),
      response: new ResponseInterceptorManager(this.hooks)
    };
    if (config?.queue) {
      if (config.queue instanceof HttpQueue) {
        this.queue = config.queue;
        this.isQueueEnabled = true;
      } else if (config.queue instanceof RezoQueue) {
        this.queue = config.queue;
        this.isQueueEnabled = true;
      } else {
        const queueConfig = config.queue;
        if (queueConfig.domainConcurrency !== undefined || queueConfig.retryOnRateLimit !== undefined) {
          this.queue = new HttpQueue(queueConfig);
        } else {
          this.queue = new RezoQueue(queueConfig);
        }
        this.isQueueEnabled = true;
      }
    } else if (config?.queueOptions?.enable) {
      this.queue = new RezoQueue(config?.queueOptions?.options);
      this.isQueueEnabled = true;
    } else {
      this.isQueueEnabled = false;
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
    }, this.defaults, this.cookieJar);
  };
  head = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "HEAD",
      url
    }, this.defaults, this.cookieJar);
  };
  options = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "OPTIONS",
      url
    }, this.defaults, this.cookieJar);
  };
  trace = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "TRACE",
      url
    }, this.defaults, this.cookieJar);
  };
  delete = (url, options) => {
    return this.executeRequest({
      ...options,
      method: "DELETE",
      url
    }, this.defaults, this.cookieJar);
  };
  request = (options) => {
    return this.executeRequest(options, this.defaults, this.cookieJar);
  };
  post = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "POST"
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
  };
  put = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PUT"
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
  };
  patch = (url, data, options = {}) => {
    return this.executeRequest({
      ...options,
      url,
      body: data,
      method: "PATCH"
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
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
    }, this.defaults, this.cookieJar);
  };
  async executeRequest(options, defaultOptions, jar) {
    if (options.jar instanceof RezoCookieJar) {
      jar = options.jar;
    }
    const requestHooks = options.hooks ? mergeHooks(this.hooks, options.hooks) : this.hooks;
    options.sessionId = this.sessionId;
    const plainOptions = { ...options };
    runVoidHooksSync(requestHooks.init, plainOptions, options);
    const headers = new RezoHeaders(options.headers);
    const stealth = defaultOptions.stealth;
    if (stealth) {
      const currentUserAgent = stealth.isAutoDetect ? headers.getUserAgent() : undefined;
      const resolved = stealth.resolve(currentUserAgent);
      options._resolvedStealth = resolved;
      for (const [key, value] of Object.entries(resolved.defaultHeaders)) {
        if (!headers.has(key))
          headers.set(key, value);
      }
      options.headers = headers;
    }
    headers.setUserAgent(headers.getUserAgent() || `Rezo/${VERSION} (+https://www.npmjs.com/package/${PACKAGE_NAME})`);
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
      const startTime = Date.now();
      const beforeRequestContext = {
        retryCount: 0,
        isRedirect: false,
        redirectCount: 0,
        startTime
      };
      if (requestHooks.beforeRequest.length > 0) {
        for (const hook of requestHooks.beforeRequest) {
          const result = await hook(options, beforeRequestContext);
          if (result && typeof result === "object" && "status" in result) {
            return result;
          }
        }
      }
      const mergedDefaults = {
        ...defaultOptions,
        _proxyManager: this._proxyManager || null,
        _hooks: requestHooks
      };
      let response;
      try {
        response = await this.adapter(options, mergedDefaults, jar);
      } catch (error) {
        if (requestHooks.beforeError.length > 0) {
          let transformedError = error;
          for (const hook of requestHooks.beforeError) {
            transformedError = await hook(transformedError);
          }
          throw transformedError;
        }
        throw error;
      }
      if (jar.cookieFile) {
        try {
          jar.saveToFile();
        } catch (e) {}
      }
      if (requestHooks.beforeCache.length > 0 && response && typeof response === "object" && "data" in response) {
        const cacheEvent = {
          url: fullUrl,
          status: response.status,
          headers: response.headers,
          cacheKey: `${method}:${fullUrl}`,
          isCacheable: ["GET", "HEAD"].includes(method) && response.status >= 200 && response.status < 300
        };
        for (const hook of requestHooks.beforeCache) {
          const shouldCache = hook(cacheEvent);
          if (shouldCache === false) {
            return response;
          }
        }
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
  buildUri(config) {
    if (typeof config === "string" || config instanceof URL) {
      return new RezoUri(config.toString());
    }
    const serializerOpts = { ...config, paramsSerializer: config.paramsSerializer || this.defaults.paramsSerializer };
    if (config.href) {
      const url = new RezoUri(config.href);
      applyUrlParts(url, config);
      appendParams(url, serializerOpts);
      return url;
    }
    if (!config.url && !config.baseURL && (config.protocol || config.hostname || config.host)) {
      return buildUriFromParts(serializerOpts);
    }
    const urlStr = config.url ? config.url.toString() : "";
    const baseURL = config.baseURL || this.defaults.baseURL;
    let url;
    try {
      url = baseURL ? new RezoUri(urlStr, baseURL) : new RezoUri(urlStr);
    } catch {
      const full = baseURL ? (baseURL.endsWith("/") ? baseURL : baseURL + "/") + (urlStr.startsWith("/") ? urlStr.slice(1) : urlStr) : urlStr;
      url = new RezoUri(full);
    }
    applyUrlParts(url, config);
    appendParams(url, serializerOpts);
    return url;
  }
  _isvalidJson(str) {
    try {
      return JSON.parse(str) ? true : false;
    } catch {
      return false;
    }
  }
  static mergeConfig(config1, config2) {
    const merged = { ...config1, ...config2 };
    if (config1.headers || config2.headers) {
      merged.headers = {
        ...config1.headers || {},
        ...config2.headers || {}
      };
    }
    if (config1.params || config2.params) {
      merged.params = {
        ...config1.params || {},
        ...config2.params || {}
      };
    }
    return merged;
  }
  extend(config) {
    return new Rezo(Rezo.mergeConfig(this.defaults, config), this.adapter);
  }
  async* paginate(url, options) {
    const pagination = options?.pagination;
    const limit = pagination?.requestLimit ?? pagination?.countLimit ?? 1 / 0;
    let nextUrl = url;
    let count = 0;
    while (nextUrl && count < limit) {
      const { pagination: _, ...reqOptions } = options || {};
      const response = await this.get(nextUrl, reqOptions);
      count++;
      if (pagination?.transform) {
        yield pagination.transform(response);
      } else {
        yield response.data;
      }
      if (pagination?.getNextUrl) {
        nextUrl = pagination.getNextUrl(response);
      } else {
        const linkHeader = response.headers.get("link");
        const links = parseLinkHeader(linkHeader);
        nextUrl = links.next || null;
      }
    }
  }
  _create(config) {
    return new Rezo(config, this.adapter);
  }
  get jar() {
    return this.cookieJar;
  }
  set jar(jar) {
    this.cookieJar = jar;
  }
  saveCookies(filePath) {
    if (filePath) {
      this.cookieJar.saveToFile(filePath);
    } else if (this.cookieJar.cookieFile) {
      this.cookieJar.saveToFile();
    } else {
      throw new Error("No cookie file path configured. Provide a path or configure cookieFile option.");
    }
  }
  stream(url, options) {
    const streamResponse = new StreamResponse;
    this.executeRequest({
      ...options,
      method: options?.method || "GET",
      url,
      _isStream: true,
      _streamResponse: streamResponse
    }, this.defaults, this.cookieJar).catch((err) => {
      streamResponse.emit("error", err);
    });
    return streamResponse;
  }
  download(url, saveTo, options) {
    const urlStr = typeof url === "string" ? url : url.toString();
    const downloadResponse = new DownloadResponse(saveTo, urlStr);
    this.executeRequest({
      ...options,
      method: options?.method || "GET",
      url,
      saveTo,
      _isDownload: true,
      _downloadResponse: downloadResponse
    }, this.defaults, this.cookieJar).catch((err) => {
      downloadResponse.emit("error", err);
    });
    return downloadResponse;
  }
  upload(url, data, options) {
    const urlStr = typeof url === "string" ? url : url.toString();
    const fileName = typeof data === "string" ? undefined : data?.name;
    const uploadResponse = new UploadResponse(urlStr, fileName);
    this.executeRequest({
      ...options,
      method: options?.method || "POST",
      url,
      data,
      body: data,
      _isUpload: true,
      _uploadResponse: uploadResponse
    }, this.defaults, this.cookieJar).catch((err) => {
      uploadResponse.emit("error", err);
    });
    return uploadResponse;
  }
  setCookies(cookies, url, startNew) {
    if (!this.cookieJar)
      this.cookieJar = new RezoCookieJar;
    if (startNew)
      this.cookieJar.removeAllCookiesSync();
    this.cookieJar.setCookiesSync(cookies, url);
  }
  getCookies(url) {
    return this.cookieJar.cookies(url);
  }
  clearCookies() {
    this.cookieJar?.removeAllCookiesSync();
  }
  destroy() {
    if (this._proxyManager) {
      this._proxyManager.destroy();
    }
  }
  static toCurl(config) {
    return toCurlUtil(config);
  }
  static fromCurl(curlCommand) {
    return fromCurlUtil(curlCommand);
  }
}
export const defaultTransforms = {
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
          return data;
        }
        if (typeof data === "object" && data.constructor === Object) {
          const formData = RezoFormData.fromObject(data);
          return formData;
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
import { RezoError } from '../errors/rezo-error.js';
export function createRezoInstance(adapter, config) {
  const instance = new Rezo(config, adapter);
  const callable = function(url, options) {
    const method = (options?.method || "GET").toUpperCase();
    const { method: _, ...rest } = options || {};
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const handler = instance[method.toLowerCase()];
      return handler(url, rest.body, rest);
    }
    const methodMap = {
      GET: instance.get,
      HEAD: instance.head,
      OPTIONS: instance.options,
      TRACE: instance.trace,
      DELETE: instance.delete
    };
    const handler = methodMap[method];
    if (handler) {
      return handler(url, rest);
    }
    return instance.request({ ...options, url, method });
  };
  const proto = Object.getPrototypeOf(instance);
  const protoMethods = Object.getOwnPropertyNames(proto).filter((name) => name !== "constructor" && typeof proto[name] === "function");
  for (const method of protoMethods) {
    callable[method] = instance[method].bind(instance);
  }
  const instanceProps = Object.getOwnPropertyNames(instance);
  for (const prop of instanceProps) {
    const descriptor = Object.getOwnPropertyDescriptor(instance, prop);
    if (descriptor) {
      if (descriptor.get || descriptor.set) {
        Object.defineProperty(callable, prop, {
          get: descriptor.get ? descriptor.get.bind(instance) : undefined,
          set: descriptor.set ? descriptor.set.bind(instance) : undefined,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        });
      } else if (typeof descriptor.value === "function") {
        callable[prop] = descriptor.value.bind(instance);
      } else {
        Object.defineProperty(callable, prop, {
          get: () => instance[prop],
          set: (value) => {
            instance[prop] = value;
          },
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        });
      }
    }
  }
  callable.create = (cfg) => new Rezo(cfg, adapter);
  callable.mergeConfig = Rezo.mergeConfig;
  callable.isRezoError = RezoError.isRezoError;
  callable.isCancel = (error) => {
    return error instanceof RezoError && error.code === "ECONNABORTED";
  };
  callable.Cancel = RezoError;
  callable.CancelToken = AbortController;
  callable.all = Promise.all.bind(Promise);
  callable.spread = (callback) => (array) => callback(...array);
  return callable;
}
export function createDefaultInstance(config) {
  if (!globalAdapter) {
    throw new Error(`No HTTP adapter configured. Import from a platform-specific entry:
` + `  - Node.js: import rezo from "rezo"
` + `  - Browser: import rezo from "rezo"
` + "The bundler will automatically select the appropriate adapter.");
  }
  return createRezoInstance(globalAdapter, config);
}
