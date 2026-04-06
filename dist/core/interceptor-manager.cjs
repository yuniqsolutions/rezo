class RequestInterceptorManager {
  entries = [];
  hooks;
  constructor(hooks) {
    this.hooks = hooks;
  }
  use(fulfilled, rejected, options) {
    const entry = { hookFn: null };
    const hookFn = async (config, _context) => {
      if (options?.runWhen && !options.runWhen(config))
        return;
      if (fulfilled) {
        try {
          const result = await fulfilled(config);
          if (result && result !== config) {
            Object.assign(config, result);
          }
        } catch (err) {
          if (rejected) {
            await rejected(err);
          } else {
            throw err;
          }
        }
      }
    };
    entry.hookFn = hookFn;
    this.hooks.beforeRequest.push(hookFn);
    this.entries.push(entry);
    return this.entries.length - 1;
  }
  eject(id) {
    const entry = this.entries[id];
    if (!entry)
      return;
    const hookIdx = this.hooks.beforeRequest.indexOf(entry.hookFn);
    if (hookIdx !== -1)
      this.hooks.beforeRequest.splice(hookIdx, 1);
    this.entries[id] = null;
  }
  clear() {
    for (let i = 0;i < this.entries.length; i++) {
      if (this.entries[i])
        this.eject(i);
    }
    this.entries = [];
  }
  forEach(fn) {
    for (const entry of this.entries) {
      if (entry !== null) {
        fn({ fulfilled: entry.hookFn, rejected: entry.errorHookFn || null });
      }
    }
  }
  get size() {
    let count = 0;
    for (const entry of this.entries) {
      if (entry !== null)
        count++;
    }
    return count;
  }
}

class ResponseInterceptorManager {
  entries = [];
  hooks;
  constructor(hooks) {
    this.hooks = hooks;
  }
  use(fulfilled, rejected, options) {
    const entry = { hookFn: null };
    if (fulfilled) {
      const hookFn = async (response, _config, _context) => {
        if (options?.runWhen && !options.runWhen(response))
          return response;
        return await fulfilled(response);
      };
      entry.hookFn = hookFn;
      this.hooks.afterResponse.push(hookFn);
    }
    if (rejected) {
      const errorHookFn = async (error) => {
        return await rejected(error);
      };
      entry.errorHookFn = errorHookFn;
      this.hooks.beforeError.push(errorHookFn);
    }
    this.entries.push(entry);
    return this.entries.length - 1;
  }
  eject(id) {
    const entry = this.entries[id];
    if (!entry)
      return;
    if (entry.hookFn) {
      const idx = this.hooks.afterResponse.indexOf(entry.hookFn);
      if (idx !== -1)
        this.hooks.afterResponse.splice(idx, 1);
    }
    if (entry.errorHookFn) {
      const idx = this.hooks.beforeError.indexOf(entry.errorHookFn);
      if (idx !== -1)
        this.hooks.beforeError.splice(idx, 1);
    }
    this.entries[id] = null;
  }
  clear() {
    for (let i = 0;i < this.entries.length; i++) {
      if (this.entries[i])
        this.eject(i);
    }
    this.entries = [];
  }
  forEach(fn) {
    for (const entry of this.entries) {
      if (entry !== null) {
        fn({ fulfilled: entry.hookFn || null, rejected: entry.errorHookFn || null });
      }
    }
  }
  get size() {
    let count = 0;
    for (const entry of this.entries) {
      if (entry !== null)
        count++;
    }
    return count;
  }
}

exports.RequestInterceptorManager = RequestInterceptorManager;
exports.ResponseInterceptorManager = ResponseInterceptorManager;