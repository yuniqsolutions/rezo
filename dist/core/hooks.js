export function createDefaultHooks() {
  return {
    init: [],
    beforeRequest: [],
    beforeRedirect: [],
    beforeRetry: [],
    afterResponse: [],
    beforeError: [],
    beforeCache: [],
    afterHeaders: [],
    afterParse: [],
    beforeCookie: [],
    afterCookie: [],
    onSocket: [],
    onDns: [],
    onTls: [],
    onTimeout: [],
    onAbort: []
  };
}
export function mergeHooks(base, overrides) {
  if (!overrides)
    return { ...base };
  return {
    init: [...base.init, ...overrides.init || []],
    beforeRequest: [...base.beforeRequest, ...overrides.beforeRequest || []],
    beforeRedirect: [...base.beforeRedirect, ...overrides.beforeRedirect || []],
    beforeRetry: [...base.beforeRetry, ...overrides.beforeRetry || []],
    afterResponse: [...base.afterResponse, ...overrides.afterResponse || []],
    beforeError: [...base.beforeError, ...overrides.beforeError || []],
    beforeCache: [...base.beforeCache, ...overrides.beforeCache || []],
    afterHeaders: [...base.afterHeaders, ...overrides.afterHeaders || []],
    afterParse: [...base.afterParse, ...overrides.afterParse || []],
    beforeCookie: [...base.beforeCookie, ...overrides.beforeCookie || []],
    afterCookie: [...base.afterCookie, ...overrides.afterCookie || []],
    onSocket: [...base.onSocket, ...overrides.onSocket || []],
    onDns: [...base.onDns, ...overrides.onDns || []],
    onTls: [...base.onTls, ...overrides.onTls || []],
    onTimeout: [...base.onTimeout, ...overrides.onTimeout || []],
    onAbort: [...base.onAbort, ...overrides.onAbort || []]
  };
}
export function serializeHooks(hooks) {
  const result = {};
  let hasAnyHooks = false;
  for (const [key, value] of Object.entries(hooks)) {
    if (Array.isArray(value) && value.length > 0) {
      result[key] = value;
      hasAnyHooks = true;
    }
  }
  return hasAnyHooks ? result : null;
}
export async function runVoidHooks(hooks, arg, ...args) {
  for (const hook of hooks) {
    await hook(arg, ...args);
  }
}
export function runVoidHooksSync(hooks, arg, ...args) {
  for (const hook of hooks) {
    hook(arg, ...args);
  }
}
export async function runTransformHooks(hooks, initial, ...args) {
  let result = initial;
  for (const hook of hooks) {
    result = await hook(result, ...args);
  }
  return result;
}
export function runBooleanHooks(hooks, arg, ...args) {
  for (const hook of hooks) {
    const result = hook(arg, ...args);
    if (result === false) {
      return false;
    }
  }
  return true;
}
export async function runBooleanHooksAsync(hooks, arg, ...args) {
  for (const hook of hooks) {
    const result = await hook(arg, ...args);
    if (result === false) {
      return false;
    }
  }
  return true;
}
export async function runEarlyReturnHooks(hooks, arg, ...args) {
  for (const hook of hooks) {
    const result = await hook(arg, ...args);
    if (result !== undefined && result !== null) {
      return result;
    }
  }
  return;
}
export function runEventHooks(hooks, arg, ...args) {
  for (const hook of hooks) {
    try {
      hook(arg, ...args);
    } catch (error) {
      console.error("[Rezo] Event hook error:", error);
    }
  }
}
export function createBeforeRequestContext(retryCount, isRedirect, redirectCount, startTime) {
  return {
    retryCount,
    isRedirect,
    redirectCount,
    startTime
  };
}
export function createAfterResponseContext(retryCount, retryFn) {
  return {
    retryCount,
    retryWithMergedOptions: retryFn
  };
}
