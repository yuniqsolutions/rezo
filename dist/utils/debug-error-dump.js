import { sanitizeDiagnosticText, sanitizeDiagnosticUrl } from './tools.js';
function safeRead(value, key) {
  if (value === null || value === undefined)
    return;
  try {
    return Reflect.get(Object(value), key);
  } catch {
    return;
  }
}
function safeHeaderValue(headers, name) {
  try {
    const get = safeRead(headers, "get");
    return typeof get === "function" ? Reflect.apply(get, headers, [name]) : safeRead(headers, name);
  } catch {
    return;
  }
}
function sanitizeDiagnosticStack(value) {
  if (typeof value !== "string")
    return sanitizeDiagnosticText(value);
  return value.split(/\r\n|\r|\n|\u2028|\u2029/).slice(0, 5).map((line) => sanitizeDiagnosticText(line)).join(" ");
}
export function debugErrorDump(config, error) {
  try {
    if (!safeRead(config, "debug")) {
      if (safeRead(config, "trackUrl")) {
        const code = safeRead(error, "code") || safeRead(error, "name") || "Error";
        const message = sanitizeDiagnosticText(safeRead(error, "message") || "");
        console.log(`[Rezo Track] ✗ ${sanitizeDiagnosticText(code)}: ${message}`);
      }
      return;
    }
    const p = (line) => console.log(`[Rezo Debug] ${line}`);
    p("─────────────────────────────────────");
    const name = sanitizeDiagnosticText(safeRead(error, "name") || "Error");
    const code = safeRead(error, "code");
    const message = sanitizeDiagnosticText(safeRead(error, "message") || "");
    p(`✗ ${name}${code ? ` [${sanitizeDiagnosticText(code)}]` : ""}: ${message}`);
    const method = sanitizeDiagnosticText(safeRead(config, "method") || "GET").toUpperCase();
    const rawUrl = safeRead(config, "fullUrl") || safeRead(config, "url") || "";
    const url = sanitizeDiagnosticUrl(rawUrl);
    p(`Request: ${method} ${url}`);
    const response = safeRead(error, "response");
    const responseFinalUrl = safeRead(response, "finalUrl");
    const configFinalUrl = safeRead(config, "finalUrl");
    const explicitRawFinalUrl = responseFinalUrl ?? configFinalUrl;
    const rawFinalUrl = explicitRawFinalUrl ?? safeRead(error, "finalUrl");
    const finalUrl = rawFinalUrl ? sanitizeDiagnosticUrl(rawFinalUrl) : "";
    const finalUrlDiffers = explicitRawFinalUrl !== undefined && explicitRawFinalUrl !== null ? explicitRawFinalUrl !== rawUrl || finalUrl !== url : finalUrl !== url;
    if (finalUrl && finalUrlDiffers) {
      p(`Final URL: ${finalUrl} (${sanitizeDiagnosticText(safeRead(config, "redirectCount") || 0)} redirects)`);
    }
    const errorUrls = safeRead(error, "urls");
    const history = safeRead(config, "redirectHistory");
    const urls = Array.isArray(errorUrls) ? errorUrls.map(sanitizeDiagnosticUrl) : Array.isArray(history) && history.length > 0 ? [url, ...history.map((entry) => sanitizeDiagnosticUrl(safeRead(entry, "url")))] : null;
    if (urls && urls.length > 1)
      p(`URL chain: ${urls.join(" → ")}`);
    const res = response;
    if (res) {
      const headers = safeRead(res, "headers");
      const enc = safeHeaderValue(headers, "content-encoding") ?? "";
      const cl = safeHeaderValue(headers, "content-length") ?? "";
      let dataInfo = "none";
      const data = safeRead(res, "data");
      if (data !== undefined && data !== null) {
        try {
          const serialized = typeof data === "string" ? data : JSON.stringify(data);
          dataInfo = `${typeof data} (${serialized?.length ?? 0} chars)`;
        } catch {
          dataInfo = typeof data;
        }
      }
      p(`Response: ${sanitizeDiagnosticText(safeRead(res, "status") || "")} ` + `${sanitizeDiagnosticText(safeRead(res, "statusText") || "")} | ` + `content-encoding: ${sanitizeDiagnosticText(enc || "none")} | ` + `content-length: ${sanitizeDiagnosticText(cl || "none")} | data: ${dataInfo}`);
    } else {
      p("Response: none received");
    }
    const phase = safeRead(error, "phase");
    const elapsed = safeRead(error, "elapsed");
    if (phase) {
      p(`Timeout phase: ${sanitizeDiagnosticText(phase)}` + `${elapsed ? ` (${sanitizeDiagnosticText(elapsed)}ms elapsed)` : ""}`);
    }
    p(`Flags: timeout=${!!safeRead(error, "isTimeout")} ` + `network=${!!safeRead(error, "isNetworkError")} ` + `retryable=${!!safeRead(error, "isRetryable")}`);
    const attempts = safeRead(config, "errors");
    if (Array.isArray(attempts) && attempts.length > 0) {
      p(`Attempts (${attempts.length}):`);
      attempts.forEach((attempt, index) => {
        const attemptError = safeRead(attempt, "error");
        const attemptNumber = safeRead(attempt, "attempt") ?? index + 1;
        const attemptCode = safeRead(attemptError, "code") || safeRead(attemptError, "name") || "Error";
        p(`  #${sanitizeDiagnosticText(attemptNumber)} ${sanitizeDiagnosticText(attemptCode)}: ` + sanitizeDiagnosticText(safeRead(attemptError, "message") || ""));
      });
    }
    const suggestion = safeRead(error, "suggestion");
    if (suggestion)
      p(`Suggestion: ${sanitizeDiagnosticText(suggestion)}`);
    const stack = safeRead(error, "stack");
    if (stack)
      p(`Stack:
${sanitizeDiagnosticStack(stack)}`);
    p("─────────────────────────────────────");
  } catch {}
}
export default debugErrorDump;
