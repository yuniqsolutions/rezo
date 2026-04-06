const { parseProxyString } = require('./parse.cjs');
const { RezoError } = require('../errors/rezo-error.cjs');
function generateProxyId() {
  return `proxy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
function ensureId(proxy) {
  if (!proxy.id)
    proxy.id = generateProxyId();
  return proxy;
}

class ProxyManager {
  _config;
  get config() {
    return this._config;
  }
  states = new Map;
  currentSequentialId = null;
  currentProxyRequests = 0;
  lastSelectedProxy = null;
  cooldownTimers = new Map;
  lastCooldownCheck = 0;
  pendingWaiters = [];
  pendingRejecters = [];
  debug = false;
  _totalRequests = 0;
  _totalSuccesses = 0;
  _totalFailures = 0;
  hooks = {
    beforeProxySelect: [],
    afterProxySelect: [],
    beforeProxyError: [],
    afterProxyError: [],
    beforeProxyDisable: [],
    afterProxyDisable: [],
    afterProxyRotate: [],
    afterProxyEnable: [],
    afterProxySuccess: [],
    onNoProxiesAvailable: []
  };
  constructor(config) {
    const parsedProxies = [];
    for (const proxy of config.proxies) {
      if (typeof proxy === "string") {
        const parsed = parseProxyString(proxy);
        if (parsed) {
          parsedProxies.push(parsed);
        }
      } else {
        parsedProxies.push(proxy);
      }
    }
    let cooldown = config.cooldown;
    if (config.cooldownPeriod && !cooldown) {
      cooldown = { enabled: true, durationMs: config.cooldownPeriod };
    }
    this._config = {
      failWithoutProxy: true,
      autoDisableDeadProxies: false,
      maxFailures: 3,
      retryWithNextProxy: false,
      maxProxyRetries: 3,
      ...config,
      cooldown,
      proxies: parsedProxies
    };
    this.debug = !!config.debug;
    for (const proxy of this._config.proxies) {
      if (!proxy.id) {
        proxy.id = generateProxyId();
      }
      this.states.set(proxy.id, this.createInitialState(proxy));
    }
    if (config.hooks) {
      const h = config.hooks;
      if (h.beforeProxySelect)
        this.hooks.beforeProxySelect.push(...h.beforeProxySelect);
      if (h.afterProxySelect)
        this.hooks.afterProxySelect.push(...h.afterProxySelect);
      if (h.beforeProxyError)
        this.hooks.beforeProxyError.push(...h.beforeProxyError);
      if (h.afterProxyError)
        this.hooks.afterProxyError.push(...h.afterProxyError);
      if (h.beforeProxyDisable)
        this.hooks.beforeProxyDisable.push(...h.beforeProxyDisable);
      if (h.afterProxyDisable)
        this.hooks.afterProxyDisable.push(...h.afterProxyDisable);
      if (h.afterProxyRotate)
        this.hooks.afterProxyRotate.push(...h.afterProxyRotate);
      if (h.afterProxyEnable)
        this.hooks.afterProxyEnable.push(...h.afterProxyEnable);
      if (h.afterProxySuccess)
        this.hooks.afterProxySuccess.push(...h.afterProxySuccess);
      if (h.onNoProxiesAvailable)
        this.hooks.onNoProxiesAvailable.push(...h.onNoProxiesAvailable);
    }
  }
  createInitialState(proxy) {
    return {
      proxy,
      requestCount: 0,
      failureCount: 0,
      successCount: 0,
      totalFailures: 0,
      isActive: true
    };
  }
  shouldProxy(url) {
    const { whitelist, blacklist } = this._config;
    if (whitelist && whitelist.length > 0) {
      const matches = whitelist.some((pattern) => this.matchPattern(pattern, url));
      if (!matches) {
        return false;
      }
    }
    if (blacklist && blacklist.length > 0) {
      const matches = blacklist.some((pattern) => this.matchPattern(pattern, url));
      if (matches) {
        return false;
      }
    }
    return true;
  }
  matchPattern(pattern, url) {
    if (pattern instanceof RegExp) {
      return pattern.test(url);
    }
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      if (hostname === pattern) {
        return true;
      }
      if (hostname.endsWith("." + pattern)) {
        return true;
      }
      if (pattern.startsWith("*.")) {
        const domain = pattern.slice(2);
        if (hostname === domain || hostname.endsWith("." + domain)) {
          return true;
        }
      }
      return false;
    } catch {
      return url.includes(pattern);
    }
  }
  getActive() {
    return this.getActiveInternal();
  }
  getActiveInternal() {
    this.processExpiredCooldowns();
    return Array.from(this.states.values()).filter((state) => state.isActive).map((state) => state.proxy);
  }
  getDisabled() {
    this.processExpiredCooldowns();
    return Array.from(this.states.values()).filter((state) => !state.isActive && !state.reenableAt).map((state) => state.proxy);
  }
  getCooldown() {
    this.processExpiredCooldowns();
    const now = Date.now();
    return Array.from(this.states.values()).filter((state) => !state.isActive && state.reenableAt && state.reenableAt > now).map((state) => state.proxy);
  }
  getAll() {
    this.processExpiredCooldowns();
    return Array.from(this.states.values());
  }
  processExpiredCooldowns() {
    const now = Date.now();
    if (now - this.lastCooldownCheck < 1000)
      return;
    this.lastCooldownCheck = now;
    for (const state of this.states.values()) {
      if (!state.isActive && state.reenableAt && state.reenableAt <= now) {
        this.enableProxy(state.proxy, "cooldown-expired");
      }
    }
  }
  next(url) {
    return this.select(url).proxy;
  }
  select(url) {
    const activeProxies = this.getActiveInternal();
    const hookOverride = this.runBeforeProxySelectHooks({
      url,
      proxies: activeProxies,
      isRetry: false,
      retryCount: 0
    });
    if (hookOverride) {
      const identified = ensureId(hookOverride);
      this._totalRequests++;
      const overrideState = this.states.get(identified.id);
      if (overrideState) {
        overrideState.requestCount++;
        if (this._config.rotation === "per-proxy-limit") {
          const limit = this._config.limit;
          if (overrideState.requestCount >= limit) {
            this.disableProxy(hookOverride, "limit-reached");
          }
        }
      }
      this.lastSelectedProxy = hookOverride;
      this.runHooks("afterProxySelect", this.hooks.afterProxySelect, { url, proxy: hookOverride, reason: "selected" });
      return { proxy: hookOverride, reason: "selected" };
    }
    if (!this.shouldProxy(url)) {
      const reason = this._config.blacklist?.some((p) => this.matchPattern(p, url)) ? "blacklist-match" : "whitelist-no-match";
      this.runHooks("afterProxySelect", this.hooks.afterProxySelect, { url, proxy: null, reason });
      return { proxy: null, reason };
    }
    if (activeProxies.length === 0) {
      this.runHooks("afterProxySelect", this.hooks.afterProxySelect, { url, proxy: null, reason: "no-proxies-available" });
      return { proxy: null, reason: "no-proxies-available" };
    }
    this._totalRequests++;
    const selected = this.selectProxy(activeProxies);
    if (selected) {
      const state = this.states.get(selected.id);
      if (state) {
        state.requestCount++;
        if (this._config.rotation === "per-proxy-limit") {
          const limit = this._config.limit;
          if (state.requestCount >= limit) {
            this.disableProxy(selected, "limit-reached");
          }
        }
      }
      if (this.lastSelectedProxy && this.lastSelectedProxy.id !== selected.id) {
        this.runHooks("afterProxyRotate", this.hooks.afterProxyRotate, {
          from: this.lastSelectedProxy,
          to: selected,
          reason: "scheduled"
        });
      }
      this.lastSelectedProxy = selected;
    }
    const reason = selected ? "selected" : "no-proxies-available";
    this.runHooks("afterProxySelect", this.hooks.afterProxySelect, { url, proxy: selected, reason });
    return { proxy: selected, reason };
  }
  selectProxy(activeProxies) {
    if (activeProxies.length === 0) {
      return null;
    }
    const rotation = this._config.rotation;
    if (rotation === "random") {
      const index = Math.floor(Math.random() * activeProxies.length);
      return activeProxies[index];
    }
    if (rotation === "sequential") {
      const requestsPerProxy = this._config.requestsPerProxy ?? 1;
      let currentIdx = this.currentSequentialId ? activeProxies.findIndex((p) => p.id === this.currentSequentialId) : -1;
      if (currentIdx === -1) {
        currentIdx = 0;
        this.currentProxyRequests = 0;
      }
      if (this.currentProxyRequests >= requestsPerProxy) {
        currentIdx = (currentIdx + 1) % activeProxies.length;
        this.currentProxyRequests = 0;
      }
      this.currentProxyRequests++;
      const selected = activeProxies[currentIdx];
      this.currentSequentialId = selected.id;
      return selected;
    }
    if (rotation === "per-proxy-limit") {
      for (const proxy of activeProxies) {
        const state = this.states.get(proxy.id);
        if (state && state.isActive) {
          return proxy;
        }
      }
      return null;
    }
    return activeProxies[0];
  }
  reportSuccess(proxy) {
    const id = ensureId(proxy).id;
    this._totalSuccesses++;
    const state = this.states.get(id);
    if (state) {
      state.successCount++;
      state.failureCount = 0;
      state.lastSuccessAt = Date.now();
      this.runHooks("afterProxySuccess", this.hooks.afterProxySuccess, { proxy, state });
    }
  }
  reportFailure(proxy, error, url) {
    const id = ensureId(proxy).id;
    this._totalFailures++;
    const state = this.states.get(id);
    if (!state)
      return;
    const willBeDisabled = !!(this._config.autoDisableDeadProxies && state.failureCount + 1 >= (this._config.maxFailures ?? 3));
    this.runHooks("beforeProxyError", this.hooks.beforeProxyError, {
      proxy,
      error,
      url: url || "",
      failureCount: state.failureCount + 1,
      willBeDisabled
    });
    state.failureCount++;
    state.totalFailures++;
    state.lastFailureAt = Date.now();
    state.lastError = error.message;
    let action = "continue";
    if (this._config.autoDisableDeadProxies) {
      const maxFailures = this._config.maxFailures ?? 3;
      if (state.failureCount >= maxFailures) {
        this.disableProxy(proxy, "dead");
        action = "disabled";
      }
    }
    this.runHooks("afterProxyError", this.hooks.afterProxyError, {
      proxy,
      error,
      action
    });
  }
  reportError(proxy, error, url) {
    this.reportFailure(proxy, error, url);
  }
  disableProxy(proxy, reason = "manual") {
    const id = ensureId(proxy).id;
    const state = this.states.get(id);
    if (!state || !state.isActive)
      return;
    if (this.hooks.beforeProxyDisable && this.hooks.beforeProxyDisable.length > 0) {
      for (const hook of this.hooks.beforeProxyDisable) {
        try {
          const result = hook({ proxy, reason, state });
          if (result === false)
            return;
        } catch (error) {
          if (this.debug)
            console.error("[ProxyManager] beforeProxyDisable hook error:", error);
        }
      }
    }
    state.isActive = false;
    state.disabledReason = reason;
    state.disabledAt = Date.now();
    const { cooldown } = this._config;
    let hasCooldown = false;
    let reenableAt;
    if (cooldown?.enabled && cooldown.durationMs > 0) {
      hasCooldown = true;
      reenableAt = Date.now() + cooldown.durationMs;
      state.reenableAt = reenableAt;
      const timerId = setTimeout(() => {
        this.enableProxy(proxy, "cooldown-expired");
        this.cooldownTimers.delete(id);
      }, cooldown.durationMs);
      this.cooldownTimers.set(id, timerId);
    }
    this.runHooks("afterProxyDisable", this.hooks.afterProxyDisable, {
      proxy,
      reason,
      hasCooldown,
      reenableAt
    });
  }
  enableProxy(proxy, reason = "manual") {
    const id = ensureId(proxy).id;
    const state = this.states.get(id);
    if (!state || state.isActive)
      return;
    state.isActive = true;
    state.failureCount = 0;
    state.disabledReason = undefined;
    state.disabledAt = undefined;
    state.reenableAt = undefined;
    const timerId = this.cooldownTimers.get(id);
    if (timerId) {
      clearTimeout(timerId);
      this.cooldownTimers.delete(id);
    }
    this.runHooks("afterProxyEnable", this.hooks.afterProxyEnable, {
      proxy,
      reason
    });
    if (this.pendingWaiters.length > 0) {
      this.pendingWaiters.shift()(proxy);
      this.pendingRejecters.shift();
    }
  }
  add(proxies) {
    const raw = Array.isArray(proxies) ? proxies : [proxies];
    for (const entry of raw) {
      const proxy = typeof entry === "string" ? parseProxyString(entry) : entry;
      if (!proxy)
        continue;
      if (!proxy.id) {
        proxy.id = generateProxyId();
      }
      if (!this.states.has(proxy.id)) {
        this.states.set(proxy.id, this.createInitialState(proxy));
        this._config.proxies.push(proxy);
        if (this.pendingWaiters.length > 0) {
          this.pendingWaiters.shift()(proxy);
          this.pendingRejecters.shift();
        }
      }
    }
  }
  remove(proxies) {
    const toRemove = Array.isArray(proxies) ? proxies : [proxies];
    for (const proxy of toRemove) {
      if (proxy.id)
        this.removeById(proxy.id);
    }
  }
  removeById(id) {
    if (!this.states.has(id))
      return;
    const timerId = this.cooldownTimers.get(id);
    if (timerId) {
      clearTimeout(timerId);
      this.cooldownTimers.delete(id);
    }
    this.states.delete(id);
    const index = this._config.proxies.findIndex((p) => p.id === id);
    if (index !== -1) {
      this._config.proxies.splice(index, 1);
    }
  }
  reset() {
    for (const timerId of this.cooldownTimers.values()) {
      clearTimeout(timerId);
    }
    this.cooldownTimers.clear();
    for (const state of this.states.values()) {
      state.requestCount = 0;
      state.failureCount = 0;
      state.successCount = 0;
      state.totalFailures = 0;
      state.isActive = true;
      state.disabledReason = undefined;
      state.disabledAt = undefined;
      state.reenableAt = undefined;
      state.lastSuccessAt = undefined;
      state.lastFailureAt = undefined;
      state.lastError = undefined;
    }
    this.currentSequentialId = null;
    this.currentProxyRequests = 0;
    this.lastSelectedProxy = null;
    this._totalRequests = 0;
    this._totalSuccesses = 0;
    this._totalFailures = 0;
    if (this.pendingWaiters.length > 0) {
      const active = this.getActive();
      for (const proxy of active) {
        if (this.pendingWaiters.length === 0)
          break;
        this.pendingWaiters.shift()(proxy);
        this.pendingRejecters.shift();
      }
    }
  }
  clear() {
    for (const timerId of this.cooldownTimers.values()) {
      clearTimeout(timerId);
    }
    this.cooldownTimers.clear();
    this.states.clear();
    this._config.proxies.length = 0;
    this.currentSequentialId = null;
    this.currentProxyRequests = 0;
    this.lastSelectedProxy = null;
    this._totalRequests = 0;
    this._totalSuccesses = 0;
    this._totalFailures = 0;
    if (this.pendingRejecters.length > 0) {
      const err = this.createError("Proxy pool cleared");
      for (const reject of this.pendingRejecters) {
        reject(err);
      }
    }
    this.pendingWaiters.length = 0;
    this.pendingRejecters.length = 0;
  }
  getStatus() {
    this.processExpiredCooldowns();
    return {
      active: this.getActive(),
      disabled: this.getDisabled(),
      cooldown: this.getCooldown(),
      total: this.states.size,
      rotation: this._config.rotation,
      totalRequests: this._totalRequests,
      totalSuccesses: this._totalSuccesses,
      totalFailures: this._totalFailures
    };
  }
  get size() {
    return this.states.size;
  }
  get totalRequests() {
    return this._totalRequests;
  }
  get totalSuccesses() {
    return this._totalSuccesses;
  }
  get totalFailures() {
    return this._totalFailures;
  }
  getProxyState(proxy) {
    return this.states.get(ensureId(proxy).id);
  }
  has(proxy) {
    return this.states.has(ensureId(proxy).id);
  }
  hasAvailableProxies() {
    return this.getActive().length > 0;
  }
  isCoolingDown() {
    return this.getCooldown().length > 0;
  }
  nextCooldownMs() {
    if (this.hasAvailableProxies())
      return 0;
    const now = Date.now();
    let earliest = 1 / 0;
    for (const state of this.states.values()) {
      if (!state.isActive && state.reenableAt && state.reenableAt > now) {
        earliest = Math.min(earliest, state.reenableAt - now);
      }
    }
    return earliest === 1 / 0 ? -1 : earliest;
  }
  waitForProxy() {
    const active = this.getActive();
    if (active.length > 0) {
      return Promise.resolve(active[0]);
    }
    if (!this.isCoolingDown()) {
      return Promise.reject(this.createError("No proxies in cooldown — pool is permanently exhausted"));
    }
    return new Promise((resolve, reject) => {
      this.pendingWaiters.push(resolve);
      this.pendingRejecters.push(reject);
    });
  }
  destroy() {
    for (const timerId of this.cooldownTimers.values()) {
      clearTimeout(timerId);
    }
    this.cooldownTimers.clear();
    this.states.clear();
    if (this.pendingRejecters.length > 0) {
      const err = this.createError("ProxyManager destroyed");
      for (const reject of this.pendingRejecters) {
        reject(err);
      }
    }
    this.pendingWaiters.length = 0;
    this.pendingRejecters.length = 0;
  }
  createError(message) {
    return new RezoError(message, null, "REZ_NO_PROXY_AVAILABLE");
  }
  runHooks(name, hooks, context) {
    for (const hook of hooks) {
      try {
        const result = hook(context);
        if (result && typeof result === "object" && typeof result.catch === "function") {
          result.catch((err) => {
            if (this.debug)
              console.error(`[ProxyManager] ${name} async hook error:`, err);
          });
        }
      } catch (error) {
        if (this.debug)
          console.error(`[ProxyManager] ${name} hook error:`, error);
      }
    }
  }
  runBeforeProxySelectHooks(context) {
    for (const hook of this.hooks.beforeProxySelect) {
      try {
        const result = hook(context);
        if (result && typeof result === "object" && "host" in result && "port" in result) {
          return result;
        }
      } catch (error) {
        if (this.debug)
          console.error("[ProxyManager] beforeProxySelect hook error:", error);
      }
    }
    return null;
  }
  notifyNoProxiesAvailable(url, error) {
    const allProxies = Array.from(this.states.values());
    const active = allProxies.filter((s) => s.isActive);
    const disabled = allProxies.filter((s) => !s.isActive && !s.reenableAt);
    const cooldown = allProxies.filter((s) => !s.isActive && s.reenableAt);
    const disabledReasons = {
      dead: allProxies.filter((s) => s.disabledReason === "dead").length,
      limitReached: allProxies.filter((s) => s.disabledReason === "limit-reached").length,
      manual: allProxies.filter((s) => s.disabledReason === "manual").length
    };
    const context = {
      url,
      error,
      allProxies,
      activeCount: active.length,
      disabledCount: disabled.length,
      cooldownCount: cooldown.length,
      disabledReasons,
      timestamp: Date.now()
    };
    this.runHooks("onNoProxiesAvailable", this.hooks.onNoProxiesAvailable, context);
    return context;
  }
}

exports.ProxyManager = ProxyManager;