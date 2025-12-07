import fs from "node:fs";
import { FileCacher } from '../cache/file-cacher.js';
import { UrlStore } from '../cache/url-store.js';
import { parseHTML } from "linkedom";
import path from "node:path";
import PQueue from "p-queue";
import { Scraper } from './scraper.js';
import { CrawlerOptions } from './crawler-options.js';
String.prototype.addBaseUrl = function(url) {
  url = url instanceof URL ? url.href : url;
  const html = this.replace(/<base\b[^>]*?>/gi, "");
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}
<base href="${url}">`);
  }
  const baseTag = `<head>
<base href="${url}">
</head>
`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, baseTag + "$&");
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, `$&
` + baseTag);
  }
  return this;
};

export class Crawler {
  http;
  events = [];
  jsonEvents = [];
  errorEvents = [];
  responseEvents = [];
  rawResponseEvents = [];
  emailDiscoveredEvents = [];
  emailLeadsEvents = [];
  cacher = null;
  queue;
  isCacheEnabled;
  config;
  urlStorage;
  isStorageReady = false;
  isCacheReady = false;
  leadsFinder;
  constructor(crawlerOptions, http) {
    this.http = http;
    this.queue = new PQueue({
      concurrency: 1000
    });
    this.config = new CrawlerOptions(crawlerOptions);
    const enableCache = this.config.enableCache;
    this.isCacheEnabled = enableCache;
    if (enableCache) {
      const cacheDir = this.config.cacheDir;
      const cacheTTL = this.config.cacheTTL;
      const dbUrl = cacheDir && (cacheDir.startsWith("./") || cacheDir.startsWith("/")) ? `${cacheDir}${cacheDir.endsWith("/") ? "" : "/"}` : cacheDir ? `./${cacheDir}${cacheDir.endsWith("/") ? "" : "/"}` : `./cache/`;
      if (!fs.existsSync(path.dirname(dbUrl)))
        fs.mkdirSync(path.dirname(dbUrl), { recursive: true });
      FileCacher.create({
        cacheDir: dbUrl,
        softDelete: false,
        ttl: cacheTTL,
        encryptNamespace: true
      }).then((storage) => {
        this.cacher = storage;
        this.isCacheReady = true;
      });
      const dit = path.resolve(cacheDir, "urls");
      if (!fs.existsSync(dit))
        fs.mkdirSync(dit, { recursive: true });
      UrlStore.create({
        storeDir: dit,
        dbFileName: ".url_cache.db",
        ttl: 1000 * 60 * 60 * 24 * 7
      }).then((storage) => {
        this.urlStorage = storage;
        this.isStorageReady = true;
      });
    } else {
      const dit = path.resolve(this.config.cacheDir, "./cache/urls");
      if (!fs.existsSync(dit))
        fs.mkdirSync(dit, { recursive: true });
      UrlStore.create({
        storeDir: dit,
        dbFileName: ".url_cache.db",
        ttl: 1000 * 60 * 60 * 24 * 7
      }).then((storage) => {
        this.urlStorage = storage;
        this.isStorageReady = true;
      });
    }
    this.leadsFinder = new Scraper(this.http, this.config, this._onEmailLeads.bind(this), this._onEmailDiscovered.bind(this), this.config.debug);
  }
  rawResponseHandler(data) {
    if (this.rawResponseEvents.length === 0)
      return;
    const isBuffer = data instanceof Buffer;
    if (!isBuffer) {
      if (data instanceof ArrayBuffer) {
        data = Buffer.from(new Uint8Array(data));
      } else if (data instanceof Uint8Array) {
        data = Buffer.from(data);
      } else if (typeof data === "string") {
        data = Buffer.from(data, "utf8");
      } else if (typeof data === "object") {
        data = Buffer.from(JSON.stringify(data), "utf8");
      }
    }
    this.rawResponseEvents.forEach((e) => {
      const handler = e.attr[0];
      handler(data);
    });
  }
  async waitForCache() {
    if (this.isCacheReady)
      return;
    await this.sleep(this.rnd(50, 200));
    await this.waitForCache();
  }
  async waitForStorage() {
    if (this.isStorageReady)
      return;
    await this.sleep(this.rnd(50, 200));
    await this.waitForStorage();
  }
  async saveUrl(url) {
    await this.waitForStorage();
    await this.urlStorage.set(url);
  }
  async hasUrlInCache(url) {
    await this.waitForStorage();
    return await this.urlStorage.has(url);
  }
  async saveCache(url, value) {
    if (!this.isCacheEnabled)
      return;
    await this.waitForCache();
    return this.cacher.set(url, value, this.config.cacheTTL, this.getNamespace(url));
  }
  getNamespace(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return;
    }
  }
  async hasCache(url) {
    if (!this.isCacheEnabled)
      return false;
    await this.waitForCache();
    return this.cacher.has(url, this.getNamespace(url));
  }
  async getCache(url) {
    if (!this.isCacheEnabled)
      return null;
    await this.waitForCache();
    return this.cacher.get(url, this.getNamespace(url));
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  rnd(min = 0, max = Number.MAX_VALUE) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  onError(handler) {
    this.errorEvents.push({
      handler: "_onError",
      attr: [handler]
    });
    return this;
  }
  onJson(handler) {
    this.jsonEvents.push({
      handler: "_onJson",
      attr: [handler]
    });
    return this;
  }
  onEmailDiscovered(handler) {
    this.emailDiscoveredEvents.push(handler);
    return this;
  }
  onEmailLeads(handler) {
    this.emailLeadsEvents.push(handler);
    return this;
  }
  onRawData(handler) {
    this.rawResponseEvents.push({
      handler: "_onRawResponse",
      attr: [handler]
    });
    return this;
  }
  onDocument(handler) {
    this.events.push({
      handler: "_onDocument",
      attr: [handler]
    });
    return this;
  }
  onBody(handler) {
    this.events.push({
      handler: "_onBody",
      attr: [handler]
    });
    return this;
  }
  onElement(handler) {
    this.events.push({
      handler: "_onElement",
      attr: [handler]
    });
    return this;
  }
  onAnchor(selection, handler) {
    this.events.push({
      handler: "_onAnchor",
      attr: [selection, handler]
    });
    return this;
  }
  onHref(handler) {
    this.events.push({
      handler: "_onHref",
      attr: [handler]
    });
    return this;
  }
  onSelection(selection, handler) {
    this.events.push({
      handler: "_onSelection",
      attr: [selection, handler]
    });
    return this;
  }
  onResponse(handler) {
    this.responseEvents.push({
      handler: "_onResponse",
      attr: [handler]
    });
    return this;
  }
  onAttribute(selection, attribute, handler) {
    this.events.push({
      handler: "_onAttribute",
      attr: [selection, attribute, handler]
    });
    return this;
  }
  onText(selection, handler) {
    this.events.push({
      handler: "_onText",
      attr: [selection, handler]
    });
    return this;
  }
  _onBody(handler, document) {
    this.queue.add(() => handler(document.body));
  }
  _onAttribute(selection, attribute, handler, document) {
    selection = typeof attribute === "function" ? selection : null;
    attribute = typeof attribute === "function" ? selection : attribute;
    handler = typeof attribute === "function" ? attribute : handler;
    selection = selection || `[${attribute}]`;
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      if (elements[i].hasAttribute(attribute))
        this.queue.add(() => handler(elements[i].getAttribute(attribute)));
    }
  }
  _onText(selection, handler, document) {
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      this.queue.add(() => handler(elements[i].textContent));
    }
  }
  _onSelection(selection, handler, document) {
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      this.queue.add(() => handler(elements[i]));
    }
  }
  _onElement(handler, document) {
    const elements = document.querySelectorAll("*");
    for (let i = 0;i < elements.length; i++) {
      this.queue.add(() => handler(elements[i]));
    }
  }
  _onHref(handler, document) {
    const elements = document.querySelectorAll("a, link");
    for (let i = 0;i < elements.length; i++) {
      if (elements[i].hasAttribute("href"))
        this.queue.add(() => handler(new URL(elements[i].getAttribute("href"), document.URL).href));
    }
  }
  _onAnchor(selection, handler, document) {
    handler = typeof selection === "function" ? selection : handler;
    selection = typeof selection === "function" ? "a" : selection;
    const elements = document.querySelectorAll(selection);
    for (let i = 0;i < elements.length; i++) {
      if (elements[i]?.href && document.baseURI)
        elements[i].href = new URL(elements[i].getAttribute("href"), document.baseURI).href;
      this.queue.add(() => handler(elements[i]));
    }
  }
  _onDocument(handler, document) {
    this.queue.add(() => handler(document));
  }
  _onJson(handler, json) {
    this.queue.add(() => handler(json));
  }
  _onError(handler, error) {
    this.queue.add(() => handler(error));
  }
  async _onEmailDiscovered(handler, email) {
    await handler(email);
  }
  async _onEmailLeads(handler, emails) {
    await handler(emails);
  }
  _onRawResponse(handler, rawResponse) {
    this.queue.add(() => handler(rawResponse));
  }
  _onResponse(handler, response) {
    this.queue.add(() => handler(response));
  }
  buildUrl(url, params) {
    if (params) {
      const u = new URL(url, this.config.baseUrl);
      for (const [key, value] of Object.entries(params)) {
        u.searchParams.set(key, value.toString());
      }
      url = u.href;
    }
    return url;
  }
  visit(url, options) {
    if (this.config.baseUrl)
      url = new URL(url, this.config.baseUrl).href;
    if (options?.params && (options.useOxylabsScraperAi || this.config.hasDomain(url, "oxylabs"))) {
      url = this.buildUrl(url, options.params);
    }
    const {
      method = "GET",
      headers = new Headers,
      forceRevisit = this.config.forceRevisit,
      body = "",
      timeout = this.config.timeout,
      maxRedirects = this.config.maxRedirects,
      useProxy = this.config.hasDomain(url, "proxies", options?.useProxy),
      extractLeads = false,
      params,
      rejectUnauthorized,
      useQueue = false,
      deepEmailFinder = false,
      useOxylabsScraperAi = false,
      useOxylabsRotation = true,
      useDecodo = false
    } = options || {};
    const _options = {
      headers: this.config.pickHeaders(url, true, headers, true),
      timeout,
      maxRedirects,
      params,
      proxy: useProxy ? this.config.getAdapter(url, "proxies", true, true) || undefined : undefined,
      rejectUnauthorized: typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : this.config.rejectUnauthorized,
      pqueue: this.config.getAdapter(url, "limiters", useQueue, useQueue) || undefined
    };
    let oxylabsOptions = {};
    let oxylabsInstanse = undefined;
    if (useOxylabsScraperAi && this.config.hasDomain(url, "oxylabs")) {
      oxylabsOptions = {
        method: method === "POST" ? "post" : "get",
        headers: this.config.pickHeaders(url, true, headers, true),
        pqueue: this.config.getAdapter(url, "limiters", useQueue, useQueue) || undefined,
        base64Body: typeof body === "string" ? Buffer.from(body).toString("base64") : undefined
      };
      oxylabsInstanse = this.config.getAdapter(url, "oxylabs", false, useOxylabsRotation) || undefined;
    }
    let decodoOptions = {};
    let decodoInstanse = undefined;
    if (useDecodo && this.config.hasDomain(url, "decodo")) {
      decodoOptions = {
        method: method === "POST" ? "post" : "get",
        headers: this.config.pickHeaders(url, true, headers, true),
        pqueue: this.config.getAdapter(url, "limiters", useQueue, useQueue) || undefined,
        base64Body: typeof body === "string" ? Buffer.from(body).toString("base64") : undefined
      };
      decodoInstanse = this.config.getAdapter(url, "decodo", false, useOxylabsRotation) || undefined;
    }
    if (deepEmailFinder) {
      this.execute2(method, url, body, _options, forceRevisit).then();
      return this;
    }
    this.execute(method, url, body, _options, extractLeads, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions).then();
    return this;
  }
  async execute(method, url, body, options = {}, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions) {
    this.queue.add(() => this.executeHttp(method, url, body, options, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions)).then();
  }
  async execute2(method, url, body, options = {}, forceRevisit) {
    this.queue.add(() => this.leadsFinder.parseExternalWebsite(url, method, body, {
      httpConfig: options,
      saveCache: this.saveCache.bind(this),
      saveUrl: this.saveUrl.bind(this),
      getCache: this.getCache.bind(this),
      hasUrlInCache: this.hasUrlInCache.bind(this),
      onEmailDiscovered: this.emailDiscoveredEvents,
      onEmails: this.emailLeadsEvents,
      queue: this.queue,
      depth: 1,
      allowCrossDomainTravel: true
    }, forceRevisit, true)).then();
  }
  async executeHttp(method, url, body, options = {}, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions, retryCount = 0) {
    try {
      console.log({
        oxylabsOptions: typeof oxylabsOptions,
        oxylabsInstanse: typeof oxylabsInstanse,
        decodoInstanse: typeof decodoInstanse,
        decodoOptions: typeof decodoOptions
      });
      const isVisited = forceRevisit ? false : await this.hasUrlInCache(url);
      const cache = await this.getCache(url);
      if (isVisited && !cache)
        return;
      if (isVisited && method !== "GET")
        return;
      const response = cache && method === "GET" ? cache : oxylabsInstanse && oxylabsOptions ? await oxylabsInstanse.scrape(url) : decodoInstanse && decodoOptions ? await decodoInstanse.scrape(url) : await (method === "GET" ? this.http.get(url, options) : method === "PATCH" ? this.http.patch(url, body, options) : method === "POST" ? this.http.post(url, body, options) : this.http.put(url, body, options));
      const res = {
        data: response.data || response.content || "",
        contentType: response.contentType || "",
        finalUrl: response.finalUrl || response.url || url,
        url: response?.urls?.[0] || response.url || this.buildUrl(url, options.params),
        headers: response.headers || {},
        status: response.status || response.statusCode || 200,
        statusText: response.statusText || "",
        cookies: response?.cookies?.serialized || response?.cookies,
        contentLength: response.contentLength || 0
      };
      if (!cache)
        await this.saveCache(url, res);
      if (!isVisited)
        await this.saveUrl(url);
      if (res.contentType && res.contentType.includes("/json")) {
        if (this.emailDiscoveredEvents.length > 0 || this.emailLeadsEvents.length > 0) {
          this.leadsFinder.extractEmails(JSON.stringify(res.data), res.finalUrl, this.emailDiscoveredEvents, this.emailLeadsEvents, this.queue);
        }
        for (let i = 0;i < this.jsonEvents.length; i++) {
          const event = this.jsonEvents[i];
          this[event.handler](...event.attr, res.data);
        }
      }
      for (let i = 0;i < this.responseEvents.length; i++) {
        const event = this.responseEvents[i];
        this[event.handler](...event.attr, res);
      }
      this.rawResponseHandler(res.data);
      if (!res.contentType || !res.contentType.includes("/html") || typeof res.data !== "string")
        return;
      if ((this.emailDiscoveredEvents.length > 0 || this.emailLeadsEvents.length > 0) && isEmail) {
        this.leadsFinder.extractEmails(res.data, res.finalUrl, this.emailDiscoveredEvents, this.emailLeadsEvents, this.queue);
      }
      const { document } = parseHTML(res.data.addBaseUrl(res.finalUrl));
      document.URL = res.finalUrl;
      for (let i = 0;i < this.events.length; i++) {
        const event = this.events[i];
        this[event.handler](...event.attr, document);
      }
    } catch (e) {
      const error = e;
      if (error && error.response) {
        const status = error.response.status;
        const retryDelay = this.config.retryDelay || 1000;
        const maxRetryAttempts = this.config.maxRetryAttempts || 3;
        const maxRetryOnProxyError = this.config.maxRetryOnProxyError || 3;
        const retryWithoutProxyOnStatusCode = this.config.retryWithoutProxyOnStatusCode || undefined;
        const retryOnStatusCode = this.config.retryOnStatusCode || undefined;
        const retryOnProxyError = this.config.retryOnProxyError || undefined;
        if (retryWithoutProxyOnStatusCode && options.proxy && retryWithoutProxyOnStatusCode.includes(status) && retryCount < maxRetryAttempts) {
          await this.sleep(retryDelay);
          delete options.proxy;
          return await this.executeHttp(method, url, body, options, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions, retryCount + 1);
        } else if (retryOnStatusCode && options.proxy && retryOnStatusCode.includes(status) && retryCount < maxRetryAttempts) {
          await this.sleep(retryDelay);
          return await this.executeHttp(method, url, body, options, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions, retryCount + 1);
        } else if (retryOnProxyError && options.proxy && retryCount < maxRetryOnProxyError) {
          await this.sleep(retryDelay);
          return await this.executeHttp(method, url, body, options, isEmail, forceRevisit, oxylabsOptions, oxylabsInstanse, decodoInstanse, decodoOptions, retryCount + 1);
        }
      }
      if (this.config.throwFatalError)
        throw e;
      if (this.config.debug) {
        console.log(`Error visiting ${url}: ${e.message}`);
      }
      console.log(error);
      for (let i = 0;i < this.errorEvents.length; i++) {
        const event = this.errorEvents[i];
        this[event.handler](...event.attr, e);
      }
    }
  }
  async waitForAll() {
    await this.queue.onIdle();
  }
  async close() {
    try {
      await this.cacher.close();
    } catch {}
    try {
      await this.urlStorage.close();
    } catch {}
  }
}
