const { RezoHeaders } = require('../utils/headers.cjs');
const CREDENTIAL_HEADER_NAMES = ["authorization", "proxy-authorization", "cookie", "set-cookie"];
function sanitizeUrl(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  try {
    const url = new URL(text);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
      return url.toString();
    }
    return text;
  } catch {
    return text.replace(/^((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)[^/?#]*@/, "$1");
  }
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function optionalFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function optionalString(value) {
  return typeof value === "string" ? value : undefined;
}
function setHeaderSafely(target, name, value, append) {
  try {
    if (append)
      target.append(name, value);
    else
      target.set(name, value);
  } catch {}
}
function sanitizeHeaders(headers) {
  const fresh = new RezoHeaders;
  if (headers instanceof RezoHeaders) {
    for (const [name, value] of headers.entries())
      setHeaderSafely(fresh, name, value, false);
  } else if (headers !== null && typeof headers === "object" && typeof headers.entries === "function") {
    for (const entry of headers.entries()) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
        setHeaderSafely(fresh, entry[0], entry[1], false);
      }
    }
  } else if (headers !== null && typeof headers === "object") {
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value === "string")
        setHeaderSafely(fresh, name, value, false);
      else if (Array.isArray(value)) {
        for (const item of value)
          if (typeof item === "string")
            setHeaderSafely(fresh, name, item, true);
      } else if (typeof value === "number" || typeof value === "boolean")
        setHeaderSafely(fresh, name, String(value), false);
    }
  }
  for (const name of CREDENTIAL_HEADER_NAMES)
    fresh.delete(name);
  return fresh;
}
function sanitizeRetryError(entry) {
  const record = entry !== null && typeof entry === "object" ? entry : {};
  const error = record.error !== null && typeof record.error === "object" ? record.error : {};
  return {
    attempt: finiteNumber(record.attempt, 0),
    duration: finiteNumber(record.duration, 0),
    error: {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "",
      code: typeof error.code === "string" ? error.code : null,
      status: optionalFiniteNumber(error.status) ?? null
    }
  };
}
function sanitizeAdapterMetadata(metadata) {
  if (metadata === undefined || metadata === null)
    return;
  const version = optionalString(metadata.version);
  const features = Array.isArray(metadata.features) ? metadata.features.filter((feature) => typeof feature === "string") : undefined;
  return {
    ...version !== undefined ? { version } : {},
    ...features !== undefined ? { features } : {}
  };
}
function sanitizeConfig(config) {
  const network = config.network ?? {};
  const timing = config.timing ?? {};
  const transfer = config.transfer ?? {};
  const localAddress = optionalString(network.localAddress);
  const localPort = optionalFiniteNumber(network.localPort);
  const remoteAddress = optionalString(network.remoteAddress);
  const remotePort = optionalFiniteNumber(network.remotePort);
  const httpVersion = optionalString(network.httpVersion);
  const requestHeaderSize = optionalFiniteNumber(transfer.requestHeaderSize);
  const requestBodySize = optionalFiniteNumber(transfer.requestBodySize);
  const compressionRatio = optionalFiniteNumber(transfer.compressionRatio);
  return {
    adapterMetadata: sanitizeAdapterMetadata(config.adapterMetadata),
    adapterUsed: config.adapterUsed,
    errors: Array.isArray(config.errors) ? config.errors.map(sanitizeRetryError) : [],
    finalUrl: sanitizeUrl(config.finalUrl ?? config.url),
    headers: sanitizeHeaders(config.headers),
    method: typeof config.method === "string" ? config.method : String(config.method ?? "GET"),
    network: {
      ...localAddress !== undefined ? { localAddress } : {},
      ...localPort !== undefined ? { localPort } : {},
      ...remoteAddress !== undefined ? { remoteAddress } : {},
      ...remotePort !== undefined ? { remotePort } : {},
      protocol: typeof network.protocol === "string" ? network.protocol : "",
      ...httpVersion !== undefined ? { httpVersion } : {},
      ...network.family === 4 || network.family === "IPv4" ? { family: 4 } : network.family === 6 || network.family === "IPv6" ? { family: 6 } : {}
    },
    redirectCount: finiteNumber(config.redirectCount, 0),
    responseType: config.responseType,
    retryAttempts: finiteNumber(config.retryAttempts, 0),
    timing: {
      startTime: finiteNumber(timing.startTime, 0),
      domainLookupStart: finiteNumber(timing.domainLookupStart, 0),
      domainLookupEnd: finiteNumber(timing.domainLookupEnd, 0),
      connectStart: finiteNumber(timing.connectStart, 0),
      secureConnectionStart: finiteNumber(timing.secureConnectionStart, 0),
      connectEnd: finiteNumber(timing.connectEnd, 0),
      requestStart: finiteNumber(timing.requestStart, 0),
      responseStart: finiteNumber(timing.responseStart, 0),
      responseEnd: finiteNumber(timing.responseEnd, 0)
    },
    transfer: {
      requestSize: finiteNumber(transfer.requestSize, 0),
      ...requestHeaderSize !== undefined ? { requestHeaderSize } : {},
      ...requestBodySize !== undefined ? { requestBodySize } : {},
      responseSize: finiteNumber(transfer.responseSize, 0),
      headerSize: finiteNumber(transfer.headerSize, 0),
      bodySize: finiteNumber(transfer.bodySize, 0),
      ...compressionRatio !== undefined ? { compressionRatio } : {}
    },
    url: sanitizeUrl(config.url)
  };
}

exports.sanitizeConfig = sanitizeConfig;