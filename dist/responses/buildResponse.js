import { RezoCookieJar } from '../utils/cookies.js';
import RezoHeaders from '../utils/headers.js';
const textRelatedTypes = [
  "text",
  "xml",
  "xhtml+xml",
  "html",
  "php",
  "javascript",
  "ecmascript",
  "x-javascript",
  "typescript",
  "x-httpd-php",
  "x-php",
  "x-python",
  "x-python",
  "x-ruby",
  "x-ruby",
  "x-sh",
  "x-bash",
  "x-java",
  "x-java-source",
  "x-c",
  "x-c++",
  "x-csrc",
  "x-chdr",
  "x-csharp",
  "x-csh",
  "x-go",
  "x-go",
  "x-scala",
  "x-scala",
  "x-rust",
  "rust",
  "x-swift",
  "x-swift",
  "x-kotlin",
  "x-kotlin",
  "x-perl",
  "x-perl",
  "x-lua",
  "x-lua",
  "x-haskell",
  "x-haskell",
  "x-sql",
  "sql",
  "css",
  "csv",
  "plain",
  "markdown",
  "x-markdown",
  "x-latex",
  "x-tex"
];
const jsonRelatedTypes = [
  "application/json",
  "application/dns-json",
  "application/jsonrequest",
  "application/x-json",
  "text/json",
  "application/jsonc",
  "application/x-jsonc",
  "application/json-lines",
  "application/jsonl",
  "application/x-jsonl",
  "application/ndjson",
  "application/x-ndjson"
];
function isNodeEnvironment() {
  return !!(typeof process !== "undefined" && process.versions && process.versions.node);
}
function isBrowserEnvironment() {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}
function supportsBlob() {
  return isBrowserEnvironment() && typeof Blob !== "undefined";
}
function supportsBuffer() {
  return isNodeEnvironment() && typeof Buffer !== "undefined";
}
function supportsArrayBuffer() {
  return typeof ArrayBuffer !== "undefined";
}
function formatResponse(data, config, headers) {
  const contentType = headers.get("Content-Type");
  const responseType = config.responseType;
  if (responseType === "buffer" || responseType === "binary") {
    config.responseType = "buffer";
    if (supportsBuffer()) {
      return data instanceof Buffer ? data : Buffer.from(data);
    }
    return data;
  }
  if (responseType === "arrayBuffer") {
    if (supportsArrayBuffer()) {
      if (data instanceof ArrayBuffer)
        return data;
      if (typeof data === "string") {
        const encoder = new TextEncoder;
        return encoder.encode(data).buffer;
      }
      if (supportsBuffer() && data instanceof Buffer) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    }
    return data;
  }
  if (responseType === "blob") {
    if (supportsBlob()) {
      if (typeof data === "string") {
        return new Blob([data]);
      }
      if (data instanceof ArrayBuffer || supportsBuffer() && data instanceof Buffer) {
        return new Blob([data]);
      }
    }
    return data;
  }
  if (responseType === "text") {
    if (typeof data === "string")
      return data;
    if (supportsBuffer() && data instanceof Buffer) {
      return data.toString("utf-8");
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    return String(data);
  }
  if (responseType === "json") {
    return parseJsonData(data);
  }
  return parseResponseBodyWithAutoDetect(data, contentType, config);
}
function parseResponseBodyWithAutoDetect(data, contentType, config) {
  if (contentType && jsonRelatedTypes.some((type) => contentType.includes(type))) {
    config.responseType = "json";
    return parseJsonData(data);
  }
  if (contentType && (contentType.includes("image/") || contentType.includes("video/") || contentType.includes("audio/"))) {
    config.responseType = "buffer";
    if (supportsBuffer()) {
      return data instanceof Buffer ? data : Buffer.from(data);
    }
    return data;
  }
  if (contentType && contentType.includes("application/octet-stream")) {
    config.responseType = "buffer";
    if (supportsBuffer()) {
      return data instanceof Buffer ? data : Buffer.from(data);
    }
    return data;
  }
  if (contentType && textRelatedTypes.some((type) => contentType.includes(type))) {
    config.responseType = "text";
    if (typeof data === "string")
      return data;
    if (supportsBuffer() && data instanceof Buffer) {
      return data.toString("utf-8");
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    return String(data);
  }
  config.responseType = "buffer";
  if (supportsBuffer()) {
    return data instanceof Buffer ? data : Buffer.from(data);
  }
  if (supportsArrayBuffer()) {
    if (data instanceof ArrayBuffer)
      return data;
    if (typeof data === "string") {
      const encoder = new TextEncoder;
      return encoder.encode(data).buffer;
    }
  }
  return data;
}
function parseResponseBody(data, contentType, responseType) {
  if (contentType && jsonRelatedTypes.some((type) => contentType.includes(type))) {
    return parseJsonData(data);
  }
  if (contentType && contentType.includes("image/") || contentType && contentType.includes("video/") || contentType && contentType.includes("audio/")) {
    if (responseType === "blob" && supportsBlob()) {
      if (typeof data === "string") {
        return new Blob([data]);
      }
      return new Blob([data]);
    }
    if (responseType === "arrayBuffer" && supportsArrayBuffer()) {
      if (data instanceof ArrayBuffer)
        return data;
      if (supportsBuffer() && data instanceof Buffer) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    }
  }
  if (contentType && contentType.includes("application/octet-stream")) {
    if (responseType === "arrayBuffer" && supportsArrayBuffer()) {
      if (data instanceof ArrayBuffer)
        return data;
      if (supportsBuffer() && data instanceof Buffer) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    }
    if (supportsBuffer()) {
      return data instanceof Buffer ? data : Buffer.from(data);
    }
    return data;
  }
  if (contentType && textRelatedTypes.some((type) => contentType.includes(type))) {
    if (typeof data === "string")
      return data;
    if (supportsBuffer() && data instanceof Buffer) {
      return data.toString("utf-8");
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    return String(data);
  }
  if (supportsBuffer()) {
    return data instanceof Buffer ? data : Buffer.from(data);
  }
  if (supportsArrayBuffer()) {
    if (data instanceof ArrayBuffer)
      return data;
    if (typeof data === "string") {
      const encoder = new TextEncoder;
      return encoder.encode(data).buffer;
    }
  }
  return data;
}
function parseJsonData(body) {
  try {
    let jsonString;
    if (typeof body === "string") {
      if (body.length < 3)
        return body;
      jsonString = body;
    } else if (supportsBuffer() && body instanceof Buffer) {
      jsonString = body.toString("utf-8");
    } else if (body instanceof ArrayBuffer) {
      jsonString = new TextDecoder().decode(body);
    } else {
      jsonString = String(body);
    }
    jsonString = jsonString.trim();
    if (jsonString.includes(`
`) && !jsonString.startsWith("[") && !jsonString.startsWith("{")) {
      const lines = jsonString.split(`
`).filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line.trim()));
    }
    let cleanJsonString = jsonString;
    if (jsonString.includes("//") || jsonString.includes("/*")) {
      cleanJsonString = jsonString.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
    }
    return JSON.parse(cleanJsonString);
  } catch {
    try {
      if (supportsBuffer()) {
        return JSON.parse(Buffer.from(body, "base64").toString("utf-8"));
      }
      const base64String = typeof body === "string" ? body : String(body);
      const decodedString = atob ? atob(base64String) : base64String;
      return JSON.parse(decodedString);
    } catch {
      if (typeof body === "string")
        return body;
      if (supportsBuffer() && body instanceof Buffer) {
        return body.toString("utf-8");
      }
      if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(body);
      }
      return String(body);
    }
  }
}
export function buildResponse(params) {
  const {
    statusCode,
    statusMessage,
    headers,
    body,
    contentType,
    contentLength,
    cookies = [],
    url,
    finalUrl,
    urls,
    config
  } = params;
  const rezoHeaders = new RezoHeaders(headers);
  rezoHeaders.delete("set-cookie");
  let cookieData;
  if (config.responseCookies && config.responseCookies.array && config.responseCookies.array.length > 0) {
    cookieData = config.responseCookies;
  } else if (cookies.length > 0) {
    const cookieJar = new RezoCookieJar;
    cookieData = cookieJar.setCookiesSync(cookies, url);
  } else {
    cookieData = {
      array: [],
      serialized: [],
      netscape: `# Netscape HTTP Cookie File
# This file was generated by Rezo HTTP client
# Based on uniqhtt cookie implementation
`,
      string: "",
      setCookiesString: []
    };
  }
  return {
    data: formatResponse(body, config, rezoHeaders),
    status: statusCode,
    statusText: statusMessage,
    finalUrl,
    cookies: cookieData,
    headers: rezoHeaders,
    contentType,
    contentLength: typeof contentLength === "string" ? parseInt(contentLength, 10) : contentLength,
    urls,
    config
  };
}
export function buildResponseFromIncoming(response, body, config, finalUrl, urls, optionalStatus, optionalStatusText, actualContentLength) {
  const cookies = response.headers["set-cookie"] || [];
  const contentLength = actualContentLength !== undefined ? actualContentLength : response.headers["content-length"] || "0";
  return buildResponse({
    statusCode: response.statusCode || optionalStatus || 200,
    statusMessage: response.statusMessage || optionalStatusText || "OK",
    headers: response.headers,
    body,
    contentType: response.headers["content-type"],
    contentLength,
    cookies,
    url: response.url || finalUrl,
    finalUrl,
    urls,
    config
  });
}
export function buildDownloadResponse(statusCode, statusMessage, headers, contentLength, cookies, url, finalUrl, urls, config) {
  return buildResponse({
    statusCode,
    statusMessage,
    headers,
    body: null,
    contentType: headers["content-type"],
    contentLength,
    cookies,
    url,
    finalUrl,
    urls,
    config
  });
}
