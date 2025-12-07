const adapterCache = new Map;
export function detectRuntime() {
  const result = {
    isNode: false,
    isBrowser: false,
    isDeno: false,
    isBun: false,
    isReactNative: false,
    isEdge: false,
    isWebWorker: false,
    isElectronMain: false,
    isElectronRenderer: false
  };
  if (typeof globalThis.Deno !== "undefined") {
    result.isDeno = true;
    return result;
  }
  if (typeof globalThis.Bun !== "undefined") {
    result.isBun = true;
    result.isNode = true;
    return result;
  }
  if (typeof navigator !== "undefined" && typeof navigator.product === "string" && navigator.product === "ReactNative") {
    result.isReactNative = true;
    return result;
  }
  if (typeof globalThis.EdgeRuntime !== "undefined" || typeof globalThis.caches !== "undefined" && typeof globalThis.WebSocketPair !== "undefined") {
    result.isEdge = true;
    return result;
  }
  if (typeof self !== "undefined" && typeof self.WorkerGlobalScope !== "undefined" && self instanceof self.WorkerGlobalScope) {
    result.isWebWorker = true;
    result.isBrowser = true;
    return result;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (typeof process !== "undefined" && process.versions?.electron) {
      if (process.type === "renderer") {
        result.isElectronRenderer = true;
      } else {
        result.isElectronMain = true;
      }
      result.isNode = true;
    } else {
      result.isBrowser = true;
    }
    return result;
  }
  if (typeof process !== "undefined" && process.versions?.node && typeof module !== "undefined") {
    result.isNode = true;
    return result;
  }
  result.isNode = true;
  return result;
}
export function getAdapterCapabilities(adapter) {
  const capabilities = {
    http: {
      cookies: true,
      proxy: true,
      streaming: true,
      http2: false,
      uploadProgress: true,
      downloadProgress: true,
      fileDownload: true,
      compression: true,
      abortSignal: true,
      tlsConfig: true
    },
    http2: {
      cookies: true,
      proxy: true,
      streaming: true,
      http2: true,
      uploadProgress: true,
      downloadProgress: true,
      fileDownload: true,
      compression: true,
      abortSignal: true,
      tlsConfig: true
    },
    curl: {
      cookies: true,
      proxy: true,
      streaming: true,
      http2: true,
      uploadProgress: true,
      downloadProgress: true,
      fileDownload: true,
      compression: true,
      abortSignal: true,
      tlsConfig: true
    },
    fetch: {
      cookies: false,
      proxy: false,
      streaming: true,
      http2: false,
      uploadProgress: false,
      downloadProgress: true,
      fileDownload: false,
      compression: true,
      abortSignal: true,
      tlsConfig: false
    },
    xhr: {
      cookies: false,
      proxy: false,
      streaming: false,
      http2: false,
      uploadProgress: true,
      downloadProgress: true,
      fileDownload: false,
      compression: false,
      abortSignal: true,
      tlsConfig: false
    },
    "react-native": {
      cookies: false,
      proxy: false,
      streaming: true,
      http2: false,
      uploadProgress: false,
      downloadProgress: true,
      fileDownload: true,
      compression: true,
      abortSignal: true,
      tlsConfig: false
    }
  };
  return capabilities[adapter];
}
export function buildAdapterContext(options, defaultOptions) {
  const internal = options;
  return {
    needsCookies: !!(options.cookieJar || defaultOptions.cookieJar),
    needsProxy: !!options.proxy,
    needsStreaming: !!internal._isStream,
    needsHttp2: !!(options.http2 || defaultOptions.http2),
    needsUploadProgress: !!internal._isUpload,
    needsDownloadProgress: !!internal._isDownload,
    needsFileDownload: !!(internal.fileName || internal.saveTo),
    preferredAdapter: options.adapter
  };
}
export function getAvailableAdapters(runtime) {
  if (runtime.isReactNative) {
    return ["react-native", "fetch"];
  }
  if (runtime.isBrowser || runtime.isWebWorker) {
    return ["fetch", "xhr"];
  }
  if (runtime.isEdge) {
    return ["fetch"];
  }
  if (runtime.isDeno) {
    return ["fetch", "http"];
  }
  if (runtime.isNode || runtime.isBun || runtime.isElectronMain || runtime.isElectronRenderer) {
    return ["http", "http2", "curl", "fetch"];
  }
  return ["fetch", "http"];
}
function scoreAdapter(adapter, context, runtime) {
  const caps = getAdapterCapabilities(adapter);
  let score = 100;
  if (context.needsCookies && !caps.cookies) {
    return -1;
  }
  if (context.needsProxy && !caps.proxy) {
    return -1;
  }
  if (context.needsHttp2 && !caps.http2) {
    score -= 30;
  }
  if (context.needsStreaming && caps.streaming) {
    score += 20;
  }
  if (context.needsUploadProgress && caps.uploadProgress) {
    score += 10;
  }
  if (context.needsDownloadProgress && caps.downloadProgress) {
    score += 10;
  }
  if (context.needsFileDownload && caps.fileDownload) {
    score += 15;
  }
  if (runtime.isNode || runtime.isBun) {
    if (adapter === "http" || adapter === "http2") {
      score += 10;
    }
  }
  if (runtime.isBrowser) {
    if (adapter === "fetch") {
      score += 15;
    }
  }
  if (runtime.isReactNative) {
    if (adapter === "react-native") {
      score += 20;
    }
  }
  if (runtime.isEdge) {
    if (adapter === "fetch") {
      score += 25;
    }
  }
  const featureCount = Object.values(caps).filter(Boolean).length;
  score += featureCount * 2;
  return score;
}
export function selectAdapter(context, runtime) {
  const env = runtime || detectRuntime();
  if (context.preferredAdapter) {
    const available = getAvailableAdapters(env);
    if (available.includes(context.preferredAdapter)) {
      return context.preferredAdapter;
    }
    console.warn(`[Rezo] Preferred adapter '${context.preferredAdapter}' not available in current runtime. ` + `Available: ${available.join(", ")}`);
  }
  const available = getAvailableAdapters(env);
  const scored = available.map((adapter) => ({
    adapter,
    score: scoreAdapter(adapter, context, env)
  }));
  const qualified = scored.filter((s) => s.score >= 0);
  if (qualified.length === 0) {
    console.warn(`[Rezo] No adapter fully satisfies requirements. ` + `Falling back to '${available[0]}'. Some features may be unavailable.`);
    return available[0];
  }
  qualified.sort((a, b) => b.score - a.score);
  return qualified[0].adapter;
}
export async function loadAdapter(adapter) {
  const cached = adapterCache.get(adapter);
  if (cached) {
    return cached;
  }
  let adapterModule;
  switch (adapter) {
    case "http":
      adapterModule = await import("./http.js");
      break;
    case "http2":
      adapterModule = await import("./http2.js");
      break;
    case "curl":
      adapterModule = await import("./curl.js");
      break;
    case "fetch":
      adapterModule = await import("./fetch.js");
      break;
    case "xhr":
      adapterModule = await import("./xhr.js");
      break;
    case "react-native":
      adapterModule = await import("./react-native.js");
      break;
    default:
      throw new Error(`[Rezo] Unknown adapter type: ${adapter}`);
  }
  adapterCache.set(adapter, adapterModule);
  return adapterModule;
}
export function clearAdapterCache() {
  adapterCache.clear();
}
export async function executeWithBestAdapter(options, defaultOptions, jar) {
  const runtime = detectRuntime();
  const context = buildAdapterContext(options, defaultOptions);
  const adapter = selectAdapter(context, runtime);
  const adapterModule = await loadAdapter(adapter);
  return adapterModule.executeRequest(options, defaultOptions, jar);
}
export function getAdapterDiagnostics(options, defaultOptions) {
  const runtime = detectRuntime();
  const context = buildAdapterContext(options, defaultOptions);
  const available = getAvailableAdapters(runtime);
  const scores = available.map((adapter) => ({
    adapter,
    score: scoreAdapter(adapter, context, runtime)
  }));
  const selected = selectAdapter(context, runtime);
  return {
    runtime,
    context,
    available,
    selected,
    scores,
    selectedCapabilities: getAdapterCapabilities(selected)
  };
}
export function createAdapterPicker(config = {}) {
  return (options, defaultOptions) => {
    const runtime = detectRuntime();
    const context = buildAdapterContext(options, defaultOptions);
    if (config.adapter) {
      if (config.debug) {
        console.log(`[Rezo Picker] Using manually configured adapter: ${config.adapter}`);
      }
      return config.adapter;
    }
    if (config.customPicker) {
      const selected = config.customPicker(context, runtime);
      if (config.debug) {
        console.log(`[Rezo Picker] Custom picker selected: ${selected}`);
      }
      return selected;
    }
    const selected = selectAdapter(context, runtime);
    if (config.debug) {
      const diagnostics = getAdapterDiagnostics(options, defaultOptions);
      console.log(`[Rezo Picker] Auto-selected: ${selected}`);
      console.log(`[Rezo Picker] Runtime:`, diagnostics.runtime);
      console.log(`[Rezo Picker] Scores:`, diagnostics.scores);
    }
    return selected;
  };
}
export default {
  detectRuntime,
  getAdapterCapabilities,
  buildAdapterContext,
  getAvailableAdapters,
  selectAdapter,
  loadAdapter,
  clearAdapterCache,
  executeWithBestAdapter,
  getAdapterDiagnostics,
  createAdapterPicker
};
