import { parseProxyString } from './index.js';
function generateProxyId() {
  return `proxy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class ProxyManager {
  config;
  states = new Map;
  currentIndex = 0;
  currentProxyRequests = 0;
  lastSelectedProxy = null;
  cooldownTimers = new Map;
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
    this.config = {
      failWithoutProxy: true,
      autoDisableDeadProxies: false,
      maxFailures: 3,
      retryWithNextProxy: false,
      maxProxyRetries: 3,
      ...config,
      proxies: parsedProxies
    };
    for (const proxy of this.config.proxies) {
      if (!proxy.id) {
        proxy.id = generateProxyId();
      }
      this.states.set(proxy.id, this.createInitialState(proxy));
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
    const { whitelist, blacklist } = this.config;
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
    this.processExpiredCooldowns();
    return Array.from(this.states.values()).filter((state) => state.isActive).map((state) => state.proxy);
  }
  getDisabled() {
    return Array.from(this.states.values()).filter((state) => !state.isActive && !state.reenableAt).map((state) => state.proxy);
  }
  getCooldown() {
    const now = Date.now();
    return Array.from(this.states.values()).filter((state) => !state.isActive && state.reenableAt && state.reenableAt > now).map((state) => state.proxy);
  }
  processExpiredCooldowns() {
    const now = Date.now();
    for (const state of this.states.values()) {
      if (!state.isActive && state.reenableAt && state.reenableAt <= now) {
        this.enableProxy(state.proxy, "cooldown-expired");
      }
    }
  }
  next(url) {
    this._totalRequests++;
    const activeProxies = this.getActive();
    this.runBeforeProxySelectHooksSync({
      url,
      proxies: activeProxies,
      isRetry: false,
      retryCount: 0
    });
    if (!this.shouldProxy(url)) {
      this.runAfterProxySelectHooksSync({
        url,
        proxy: null,
        reason: this.config.blacklist?.some((p) => this.matchPattern(p, url)) ? "blacklist-match" : "whitelist-no-match"
      });
      return null;
    }
    if (activeProxies.length === 0) {
      this.runAfterProxySelectHooksSync({
        url,
        proxy: null,
        reason: "no-proxies-available"
      });
      return null;
    }
    const selected = this.selectProxy(activeProxies);
    if (selected) {
      const state = this.states.get(selected.id);
      if (state) {
        state.requestCount++;
        if (this.config.rotation === "per-proxy-limit") {
          const limit = this.config.limit;
          if (state.requestCount >= limit) {
            this.disableProxy(selected, "limit-reached");
          }
        }
      }
      if (this.lastSelectedProxy && this.lastSelectedProxy.id !== selected.id) {
        this.runAfterProxyRotateHooks({
          from: this.lastSelectedProxy,
          to: selected,
          reason: "scheduled"
        });
      }
      this.lastSelectedProxy = selected;
    }
    this.runAfterProxySelectHooksSync({
      url,
      proxy: selected,
      reason: selected ? "selected" : "no-proxies-available"
    });
    return selected;
  }
  select(url) {
    this._totalRequests++;
    if (!this.shouldProxy(url)) {
      const { whitelist, blacklist } = this.config;
      const reason = blacklist?.some((p) => this.matchPattern(p, url)) ? "blacklist-match" : "whitelist-no-match";
      return { proxy: null, reason };
    }
    const activeProxies = this.getActive();
    if (activeProxies.length === 0) {
      return { proxy: null, reason: "no-proxies-available" };
    }
    const selected = this.selectProxy(activeProxies);
    if (selected) {
      const state = this.states.get(selected.id);
      if (state) {
        state.requestCount++;
        if (this.config.rotation === "per-proxy-limit") {
          const limit = this.config.limit;
          if (state.requestCount >= limit) {
            this.disableProxy(selected, "limit-reached");
          }
        }
      }
      this.lastSelectedProxy = selected;
      return { proxy: selected, reason: "selected" };
    }
    return { proxy: null, reason: "no-proxies-available" };
  }
  selectProxy(activeProxies) {
    if (activeProxies.length === 0) {
      return null;
    }
    const rotation = this.config.rotation;
    if (rotation === "random") {
      const index = Math.floor(Math.random() * activeProxies.length);
      return activeProxies[index];
    }
    if (rotation === "sequential") {
      const requestsPerProxy = this.config.requestsPerProxy ?? 1;
      if (this.currentProxyRequests >= requestsPerProxy) {
        this.currentIndex = (this.currentIndex + 1) % activeProxies.length;
        this.currentProxyRequests = 0;
      }
      if (this.currentIndex >= activeProxies.length) {
        this.currentIndex = 0;
      }
      this.currentProxyRequests++;
      return activeProxies[this.currentIndex];
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
    this._totalSuccesses++;
    const state = this.states.get(proxy.id);
    if (state) {
      state.successCount++;
      state.failureCount = 0;
      state.lastSuccessAt = Date.now();
    }
  }
  reportFailure(proxy, error, url) {
    this._totalFailures++;
    const state = this.states.get(proxy.id);
    if (!state)
      return;
    const willBeDisabled = !!(this.config.autoDisableDeadProxies && state.failureCount + 1 >= (this.config.maxFailures ?? 3));
    this.runBeforeProxyErrorHooksSync({
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
    if (this.config.autoDisableDeadProxies) {
      const maxFailures = this.config.maxFailures ?? 3;
      if (state.failureCount >= maxFailures) {
        this.disableProxy(proxy, "dead");
        action = "disabled";
      }
    }
    this.runAfterProxyErrorHooksSync({
      proxy,
      error,
      action
    });
  }
  disableProxy(proxy, reason = "manual") {
    const state = this.states.get(proxy.id);
    if (!state || !state.isActive)
      return;
    state.isActive = false;
    state.disabledReason = reason;
    state.disabledAt = Date.now();
    const { cooldown } = this.config;
    let hasCooldown = false;
    let reenableAt;
    if (cooldown?.enabled && cooldown.durationMs > 0) {
      hasCooldown = true;
      reenableAt = Date.now() + cooldown.durationMs;
      state.reenableAt = reenableAt;
      const timerId = setTimeout(() => {
        this.enableProxy(proxy, "cooldown-expired");
        this.cooldownTimers.delete(proxy.id);
      }, cooldown.durationMs);
      this.cooldownTimers.set(proxy.id, timerId);
    }
    this.runAfterProxyDisableHooks({
      proxy,
      reason,
      hasCooldown,
      reenableAt
    });
  }
  enableProxy(proxy, reason = "manual") {
    const state = this.states.get(proxy.id);
    if (!state || state.isActive)
      return;
    state.isActive = true;
    state.failureCount = 0;
    state.disabledReason = undefined;
    state.disabledAt = undefined;
    state.reenableAt = undefined;
    const timerId = this.cooldownTimers.get(proxy.id);
    if (timerId) {
      clearTimeout(timerId);
      this.cooldownTimers.delete(proxy.id);
    }
    this.runAfterProxyEnableHooks({
      proxy,
      reason
    });
  }
  add(proxies) {
    const toAdd = Array.isArray(proxies) ? proxies : [proxies];
    for (const proxy of toAdd) {
      if (!proxy.id) {
        proxy.id = generateProxyId();
      }
      if (!this.states.has(proxy.id)) {
        this.states.set(proxy.id, this.createInitialState(proxy));
        this.config.proxies.push(proxy);
      }
    }
  }
  remove(proxies) {
    const toRemove = Array.isArray(proxies) ? proxies : [proxies];
    for (const proxy of toRemove) {
      if (proxy.id) {
        const timerId = this.cooldownTimers.get(proxy.id);
        if (timerId) {
          clearTimeout(timerId);
          this.cooldownTimers.delete(proxy.id);
        }
        this.states.delete(proxy.id);
        const index = this.config.proxies.findIndex((p) => p.id === proxy.id);
        if (index !== -1) {
          this.config.proxies.splice(index, 1);
        }
      }
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
      state.isActive = true;
      state.disabledReason = undefined;
      state.disabledAt = undefined;
      state.reenableAt = undefined;
    }
    this.currentIndex = 0;
    this.currentProxyRequests = 0;
    this.lastSelectedProxy = null;
  }
  getStatus() {
    this.processExpiredCooldowns();
    return {
      active: this.getActive(),
      disabled: this.getDisabled(),
      cooldown: this.getCooldown(),
      total: this.states.size,
      rotation: this.config.rotation,
      totalRequests: this._totalRequests,
      totalSuccesses: this._totalSuccesses,
      totalFailures: this._totalFailures
    };
  }
  getProxyState(proxy) {
    return this.states.get(proxy.id);
  }
  hasAvailableProxies() {
    return this.getActive().length > 0;
  }
  destroy() {
    for (const timerId of this.cooldownTimers.values()) {
      clearTimeout(timerId);
    }
    this.cooldownTimers.clear();
    this.states.clear();
  }
  runBeforeProxySelectHooksSync(context) {
    for (const hook of this.hooks.beforeProxySelect) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] beforeProxySelect hook error:", error);
      }
    }
  }
  runAfterProxySelectHooksSync(context) {
    for (const hook of this.hooks.afterProxySelect) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] afterProxySelect hook error:", error);
      }
    }
  }
  runBeforeProxyErrorHooksSync(context) {
    for (const hook of this.hooks.beforeProxyError) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] beforeProxyError hook error:", error);
      }
    }
  }
  runAfterProxyErrorHooksSync(context) {
    for (const hook of this.hooks.afterProxyError) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] afterProxyError hook error:", error);
      }
    }
  }
  runAfterProxyRotateHooks(context) {
    for (const hook of this.hooks.afterProxyRotate) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] afterProxyRotate hook error:", error);
      }
    }
  }
  runAfterProxyDisableHooks(context) {
    for (const hook of this.hooks.afterProxyDisable) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] afterProxyDisable hook error:", error);
      }
    }
  }
  runAfterProxyEnableHooks(context) {
    for (const hook of this.hooks.afterProxyEnable) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] afterProxyEnable hook error:", error);
      }
    }
  }
  runOnNoProxiesAvailableHooksSync(context) {
    for (const hook of this.hooks.onNoProxiesAvailable) {
      try {
        hook(context);
      } catch (error) {
        console.error("[ProxyManager] onNoProxiesAvailable hook error:", error);
      }
    }
  }
  async runOnNoProxiesAvailableHooks(context) {
    for (const hook of this.hooks.onNoProxiesAvailable) {
      try {
        await hook(context);
      } catch (error) {
        console.error("[ProxyManager] onNoProxiesAvailable hook error:", error);
      }
    }
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
    this.runOnNoProxiesAvailableHooksSync(context);
    return context;
  }
}
