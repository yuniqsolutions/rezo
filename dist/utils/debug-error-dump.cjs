function debugErrorDump(config, error) {
  if (!config?.debug) {
    if (config?.trackUrl) {
      console.log(`[Rezo Track] ✗ ${error?.code || error?.name || "Error"}: ${error?.message || ""}`);
    }
    return;
  }
  const p = (line) => console.log(`[Rezo Debug] ${line}`);
  try {
    p("─────────────────────────────────────");
    p(`✗ ${error?.name || "Error"}${error?.code ? ` [${error.code}]` : ""}: ${error?.message || ""}`);
    const method = (config.method || "GET").toUpperCase();
    const url = config.fullUrl || config.url || "";
    p(`Request: ${method} ${url}`);
    const finalUrl = error?.finalUrl || config.finalUrl;
    if (finalUrl && finalUrl !== url)
      p(`Final URL: ${finalUrl} (${config.redirectCount || 0} redirects)`);
    const urls = error?.urls || (config.redirectHistory?.length ? [url, ...config.redirectHistory.map((r) => r.url)] : null);
    if (urls && urls.length > 1)
      p(`URL chain: ${urls.join(" → ")}`);
    const res = error?.response;
    if (res) {
      const enc = res.headers?.get?.("content-encoding") ?? res.headers?.["content-encoding"] ?? "";
      const cl = res.headers?.get?.("content-length") ?? res.headers?.["content-length"] ?? "";
      let dataInfo = "none";
      if (res.data !== undefined && res.data !== null) {
        try {
          const s = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          dataInfo = `${typeof res.data} (${s?.length ?? 0} chars)`;
        } catch {
          dataInfo = typeof res.data;
        }
      }
      p(`Response: ${res.status} ${res.statusText || ""} | content-encoding: ${enc || "none"} | content-length: ${cl || "none"} | data: ${dataInfo}`);
    } else {
      p("Response: none received");
    }
    if (error?.phase)
      p(`Timeout phase: ${error.phase}${error.elapsed ? ` (${error.elapsed}ms elapsed)` : ""}`);
    p(`Flags: timeout=${!!error?.isTimeout} network=${!!error?.isNetworkError} retryable=${!!error?.isRetryable}`);
    const attempts = config.errors;
    if (attempts?.length) {
      p(`Attempts (${attempts.length}):`);
      attempts.forEach((a, i) => p(`  #${a.attempt ?? i + 1} ${a.error?.code || a.error?.name || "Error"}: ${a.error?.message || ""}`));
    }
    if (error?.suggestion)
      p(`Suggestion: ${error.suggestion}`);
    if (error?.stack)
      p(`Stack:
${String(error.stack).split(`
`).slice(0, 5).join(`
`)}`);
    p("─────────────────────────────────────");
  } catch {}
}

exports.debugErrorDump = debugErrorDump;
exports.default = debugErrorDump;
module.exports = Object.assign(debugErrorDump, exports);