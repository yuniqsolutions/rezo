const { RezoError } = require('../errors/rezo-error.cjs');
const { buildResponse } = require('./buildResponse.cjs');
function traverseCauseChain(error, detector, maxDepth = 10) {
  let current = error;
  let depth = 0;
  while (current && depth < maxDepth) {
    const result = detector(current);
    if (result)
      return result;
    current = current.cause;
    depth++;
  }
  return null;
}
function isSocksLikeError(error) {
  const name = error.name || "";
  const message = (error.message || "").toLowerCase();
  const code = error.code || "";
  if (name === "SocksClientError" || name.includes("Socks") || name.includes("SOCKS")) {
    return detectSocksError(error.message);
  }
  if (message.includes("socks")) {
    return detectSocksError(error.message);
  }
  if (message.includes("sockshost") || message.includes("socks proxy") || message.includes("socks5") || message.includes("socks4")) {
    return detectSocksError(error.message);
  }
  if (error.options?.proxy?.type === 4 || error.options?.proxy?.type === 5) {
    return detectSocksError(error.message);
  }
  return null;
}
function isProxyLikeError(error) {
  const name = error.name || "";
  const message = (error.message || "").toLowerCase();
  const code = error.code || "";
  if (name.includes("Proxy") || name.includes("proxy")) {
    return detectProxyError(error.message, code);
  }
  if (message.includes("proxy") || message.includes("http proxy") || message.includes("https proxy")) {
    return detectProxyError(error.message, code);
  }
  if (message.includes("connect tunnel") || message.includes("tunnel connection")) {
    return detectProxyError(error.message, code);
  }
  if (message.includes("407")) {
    return { type: "proxy", code: "REZ_PROXY_AUTHENTICATION_FAILED", message: error.message };
  }
  if (error.stack) {
    const stack = error.stack.toLowerCase();
    if (stack.includes("proxy-agent") || stack.includes("proxyagent")) {
      if (code === "ECONNREFUSED" || code === "ECONNRESET") {
        return { type: "proxy", code: "REZ_PROXY_CONNECTION_FAILED", message: error.message };
      }
      if (code === "ETIMEDOUT") {
        return { type: "proxy", code: "REZ_PROXY_TIMEOUT", message: error.message };
      }
      return detectProxyError(error.message, code);
    }
  }
  const errorAny = error;
  if (errorAny.options?.proxy || errorAny.proxy || errorAny.proxyUrl) {
    if (code === "ECONNREFUSED" || code === "ECONNRESET") {
      return { type: "proxy", code: "REZ_PROXY_CONNECTION_FAILED", message: error.message };
    }
    if (code === "ETIMEDOUT") {
      return { type: "proxy", code: "REZ_PROXY_TIMEOUT", message: error.message };
    }
    return detectProxyError(error.message, code);
  }
  return null;
}
function detectErrorType(error) {
  const errorMessage = error.message || "";
  const errorCode = error.code || "";
  const socksResult = traverseCauseChain(error, isSocksLikeError);
  if (socksResult)
    return socksResult;
  const proxyResult = traverseCauseChain(error, isProxyLikeError);
  if (proxyResult)
    return proxyResult;
  if (isTlsError(errorCode, errorMessage)) {
    return { type: "tls", code: mapTlsCode(errorCode, errorMessage), message: errorMessage };
  }
  if (isTimeoutError(errorCode, errorMessage)) {
    return { type: "timeout", code: mapTimeoutCode(errorCode), message: errorMessage };
  }
  if (isAbortError(errorCode, errorMessage)) {
    return { type: "abort", code: "ABORT_ERR", message: errorMessage };
  }
  if (isNetworkError(errorCode)) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes("socks") || msg.includes("proxy")) {
      if (msg.includes("socks")) {
        return detectSocksError(errorMessage);
      }
      return detectProxyError(errorMessage, errorCode);
    }
    return { type: "network", code: errorCode, message: errorMessage };
  }
  return { type: "unknown", code: "REZ_UNKNOWN_ERROR", message: errorMessage };
}
function detectSocksError(message) {
  const msg = message.toLowerCase();
  if (msg.includes("authentication") || msg.includes("auth") || msg.includes("username") || msg.includes("password")) {
    return { type: "socks", code: "REZ_SOCKS_AUTHENTICATION_FAILED", message };
  }
  if (msg.includes("connect") && (msg.includes("refused") || msg.includes("failed") || msg.includes("timeout"))) {
    return { type: "socks", code: "REZ_SOCKS_CONNECTION_FAILED", message };
  }
  if (msg.includes("destination") || msg.includes("target") || msg.includes("host unreachable") || msg.includes("network unreachable")) {
    return { type: "socks", code: "REZ_SOCKS_TARGET_CONNECTION_FAILED", message };
  }
  if (msg.includes("protocol") || msg.includes("version") || msg.includes("invalid") || msg.includes("malformed")) {
    return { type: "socks", code: "REZ_SOCKS_PROTOCOL_ERROR", message };
  }
  if (msg.includes("internal") || msg.includes("should not happen")) {
    return { type: "socks", code: "REZ_SOCKS_PROTOCOL_ERROR", message };
  }
  return { type: "socks", code: "REZ_SOCKS_CONNECTION_FAILED", message };
}
function detectProxyError(message, code) {
  const msg = message.toLowerCase();
  if (msg.includes("407") || msg.includes("authentication") || msg.includes("auth") || msg.includes("unauthorized")) {
    return { type: "proxy", code: "REZ_PROXY_AUTHENTICATION_FAILED", message };
  }
  if (msg.includes("connect") && (msg.includes("refused") || msg.includes("failed"))) {
    return { type: "proxy", code: "REZ_PROXY_CONNECTION_FAILED", message };
  }
  if (msg.includes("timeout") || code === "ETIMEDOUT") {
    return { type: "proxy", code: "REZ_PROXY_TIMEOUT", message };
  }
  if (msg.includes("502") || msg.includes("504") || msg.includes("bad gateway") || msg.includes("unreachable")) {
    return { type: "proxy", code: "REZ_PROXY_TARGET_UNREACHABLE", message };
  }
  return { type: "proxy", code: "REZ_PROXY_ERROR", message };
}
function isTlsError(code, message) {
  const tlsCodes = [
    "EPROTO",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_TLS_HANDSHAKE_TIMEOUT",
    "ERR_TLS_INVALID_PROTOCOL_VERSION",
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_RENEGOTIATION_DISABLED",
    "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED"
  ];
  if (tlsCodes.includes(code))
    return true;
  const msg = message.toLowerCase();
  return msg.includes("certificate") || msg.includes("ssl") || msg.includes("tls") || msg.includes("handshake");
}
function mapTlsCode(code, message) {
  if (code && code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code === "EPROTO" || code.startsWith("UNABLE_TO") || code.startsWith("SELF_SIGNED") || code.startsWith("DEPTH_ZERO")) {
    return code;
  }
  const msg = message.toLowerCase();
  if (msg.includes("expired"))
    return "CERT_HAS_EXPIRED";
  if (msg.includes("self-signed") || msg.includes("self signed"))
    return "SELF_SIGNED_CERT_IN_CHAIN";
  if (msg.includes("hostname") || msg.includes("altname"))
    return "ERR_TLS_CERT_ALTNAME_INVALID";
  if (msg.includes("handshake") && msg.includes("timeout"))
    return "ERR_TLS_HANDSHAKE_TIMEOUT";
  return "EPROTO";
}
function isTimeoutError(code, message) {
  const timeoutCodes = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_REQUEST_TIMEOUT", "ERR_TLS_HANDSHAKE_TIMEOUT"];
  if (timeoutCodes.includes(code))
    return true;
  return message.toLowerCase().includes("timeout") && !message.toLowerCase().includes("proxy");
}
function mapTimeoutCode(code) {
  if (code && code.includes("TIMEOUT"))
    return code;
  return "ETIMEDOUT";
}
function isAbortError(code, message) {
  const abortCodes = ["ABORT_ERR", "UND_ERR_ABORTED", "ERR_ABORTED"];
  if (abortCodes.includes(code))
    return true;
  return message.toLowerCase().includes("aborted");
}
function isNetworkError(code) {
  const networkCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET"];
  return networkCodes.includes(code);
}
function shouldFilterStackLine(line) {
  if (!line.trim().startsWith("at "))
    return false;
  if (line.includes("/node_modules/socks/"))
    return true;
  if (line.includes("/node_modules/socks-proxy-agent/"))
    return true;
  if (line.includes("/node_modules/http-proxy-agent/"))
    return true;
  if (line.includes("/node_modules/https-proxy-agent/"))
    return true;
  if (line.includes("/node_modules/agent-base/"))
    return true;
  if (line.includes("/src/adapters/"))
    return true;
  if (line.includes("/src/responses/"))
    return true;
  if (line.includes("/src/errors/"))
    return true;
  if (line.includes("/src/core/"))
    return true;
  if (line.includes("/src/utils/"))
    return true;
  if (line.includes("/src/proxy/"))
    return true;
  if (line.includes("node:internal/"))
    return true;
  if (line.includes("node:_http"))
    return true;
  if (line.includes("node:events"))
    return true;
  if (line.includes("node:net"))
    return true;
  if (line.includes("node:tls"))
    return true;
  if (line.includes("node:stream"))
    return true;
  return false;
}
function maskPathInLine(line) {
  return line.replace(/\(\/[^)]+\/([^/)]+:[0-9]+:[0-9]+)\)/g, "($1)").replace(/at \/[^\s]+\/([^\s]+:[0-9]+:[0-9]+)/g, "at $1");
}
function cleanStackTrace(stack) {
  if (!stack)
    return;
  const lines = stack.split(`
`);
  const cleanedLines = [];
  let userFrameCount = 0;
  const maxUserFrames = 5;
  for (const line of lines) {
    if (!line.trim().startsWith("at ")) {
      cleanedLines.push(line);
      continue;
    }
    if (shouldFilterStackLine(line)) {
      continue;
    }
    if (userFrameCount < maxUserFrames) {
      cleanedLines.push(maskPathInLine(line));
      userFrameCount++;
    }
  }
  if (cleanedLines.length === 0) {
    return lines[0] || undefined;
  }
  return cleanedLines.join(`
`);
}
function buildHttpError(params) {
  const {
    statusCode,
    headers,
    contentType,
    contentLength,
    cookies,
    statusText,
    url,
    body,
    finalUrl,
    config,
    request
  } = params;
  const response = buildResponse({
    statusCode,
    statusMessage: statusText,
    headers,
    body,
    contentType,
    contentLength,
    cookies,
    url,
    finalUrl: finalUrl || url,
    urls: [url],
    config
  });
  return RezoError.createHttpError(statusCode, config, request, response);
}
function buildDownloadError(messageOrParams, config, request, response) {
  if (typeof messageOrParams === "string") {
    return RezoError.createDownloadError(messageOrParams, config, request, response);
  }
  const { statusCode, headers, cookies, statusText, url, body, finalUrl, config: errorConfig, request: errorRequest } = messageOrParams;
  const errorResponse = buildResponse({
    statusCode,
    statusMessage: statusText,
    headers,
    body,
    contentType: headers["content-type"],
    contentLength: headers["content-length"] || "0",
    cookies,
    url,
    finalUrl: finalUrl || url,
    urls: [url],
    config: errorConfig
  });
  return RezoError.createDownloadError("Download failed", errorConfig, errorRequest, errorResponse);
}
function buildDecompressionError(messageOrParams, config, request, response) {
  if (typeof messageOrParams === "string") {
    return RezoError.createDecompressionError(messageOrParams, config, request, response);
  }
  const { statusCode, headers, cookies, statusText, url, body, finalUrl, config: errorConfig, request: errorRequest } = messageOrParams;
  const errorResponse = buildResponse({
    statusCode,
    statusMessage: statusText,
    headers,
    body,
    contentType: headers["content-type"],
    contentLength: headers["content-length"] || "0",
    cookies,
    url,
    finalUrl: finalUrl || url,
    urls: [url],
    config: errorConfig
  });
  return RezoError.createDecompressionError("Decompression failed", errorConfig, errorRequest, errorResponse);
}
function buildRedirectError(messageOrParams, config, request, response) {
  if (typeof messageOrParams === "string") {
    return RezoError.createRedirectError(messageOrParams, config, request, response);
  }
  const { statusCode, headers, cookies, statusText, url, body, finalUrl, config: errorConfig, request: errorRequest } = messageOrParams;
  const errorResponse = buildResponse({
    statusCode,
    statusMessage: statusText,
    headers,
    body,
    contentType: headers["content-type"],
    contentLength: headers["content-length"] || "0",
    cookies,
    url,
    finalUrl: finalUrl || url,
    urls: [url],
    config: errorConfig
  });
  return RezoError.createRedirectError("Redirect location not found", errorConfig, errorRequest, errorResponse);
}
function builErrorFromResponse(message, response, config, request) {
  const statusCode = response?.status || 0;
  if (statusCode >= 400) {
    return RezoError.createHttpError(statusCode, config, request, response);
  }
  return new RezoError(message, config, "REZ_UNKNOWN_ERROR", request, response);
}
function buildNetworkError(message, code, config, request) {
  return RezoError.createNetworkError(message, code, config, request);
}
function buildTimeoutError(message, config, request) {
  return RezoError.createTimeoutError(message, config, request);
}
function buildAbortError(message, config, request) {
  return RezoError.createAbortError(message, config, request);
}
function hasProxyConfigured(config) {
  const proxy = config?.proxy;
  if (!proxy)
    return { isProxy: false, isSocks: false };
  if (typeof proxy === "string") {
    const lower = proxy.toLowerCase();
    return {
      isProxy: true,
      isSocks: lower.startsWith("socks4://") || lower.startsWith("socks5://") || lower.startsWith("socks://")
    };
  }
  if (typeof proxy === "object") {
    const protocol = proxy.protocol?.toLowerCase() || "";
    return {
      isProxy: true,
      isSocks: protocol.includes("socks")
    };
  }
  return { isProxy: false, isSocks: false };
}
function buildSmartError(config, request, cause) {
  if (!cause) {
    return new RezoError("Unknown error occurred", config, "REZ_UNKNOWN_ERROR", request);
  }
  let detected = detectErrorType(cause);
  if (detected.type === "network" || detected.type === "unknown") {
    const proxyConfig = hasProxyConfigured(config);
    const errorCode = cause.code || "";
    if (proxyConfig.isSocks) {
      if (errorCode === "ECONNREFUSED" || errorCode === "ECONNRESET") {
        detected = { type: "socks", code: "REZ_SOCKS_CONNECTION_FAILED", message: cause.message };
      } else if (errorCode === "ETIMEDOUT") {
        detected = { type: "socks", code: "REZ_SOCKS_CONNECTION_FAILED", message: cause.message };
      } else if (errorCode === "EHOSTUNREACH" || errorCode === "ENETUNREACH") {
        detected = { type: "socks", code: "REZ_SOCKS_TARGET_CONNECTION_FAILED", message: cause.message };
      }
    } else if (proxyConfig.isProxy) {
      if (errorCode === "ECONNREFUSED" || errorCode === "ECONNRESET") {
        detected = { type: "proxy", code: "REZ_PROXY_CONNECTION_FAILED", message: cause.message };
      } else if (errorCode === "ETIMEDOUT") {
        detected = { type: "proxy", code: "REZ_PROXY_TIMEOUT", message: cause.message };
      } else if (errorCode === "EHOSTUNREACH" || errorCode === "ENETUNREACH") {
        detected = { type: "proxy", code: "REZ_PROXY_TARGET_UNREACHABLE", message: cause.message };
      }
    }
  }
  let error;
  switch (detected.type) {
    case "socks":
      error = RezoError.createSocksError(detected.code, config, request);
      break;
    case "proxy":
      error = RezoError.createProxyError(detected.code, config, request);
      break;
    case "tls":
      error = RezoError.createTlsError(detected.code, config, request);
      break;
    case "timeout":
      error = RezoError.createTimeoutError(detected.message, config, request);
      Object.defineProperty(error, "code", { value: detected.code, enumerable: true });
      break;
    case "abort":
      error = RezoError.createAbortError(detected.message, config, request);
      break;
    case "network":
      error = RezoError.createNetworkError(detected.message, detected.code, config, request);
      break;
    default:
      error = new RezoError(detected.message || "Unknown error occurred", config, "REZ_UNKNOWN_ERROR", request);
  }
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  const cleanedStack = cleanStackTrace(error.stack);
  if (cleanedStack) {
    Object.defineProperty(error, "stack", { value: cleanedStack, enumerable: false });
  }
  return error;
}
function buildGenericError(_message, config, request, cause) {
  return buildSmartError(config, request, cause);
}

exports.buildHttpError = buildHttpError;
exports.buildDownloadError = buildDownloadError;
exports.buildDecompressionError = buildDecompressionError;
exports.buildRedirectError = buildRedirectError;
exports.builErrorFromResponse = builErrorFromResponse;
exports.buildNetworkError = buildNetworkError;
exports.buildTimeoutError = buildTimeoutError;
exports.buildAbortError = buildAbortError;
exports.buildSmartError = buildSmartError;
exports.buildGenericError = buildGenericError;