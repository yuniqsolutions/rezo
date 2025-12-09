const ERROR_INFO = exports.ERROR_INFO = {
  ECONNREFUSED: {
    code: -111,
    message: "Connection Refused",
    details: "The target server actively refused the TCP connection attempt. This typically means the server is not running or is blocking connections on the specified port.",
    suggestion: "Verify the server is running and accessible. Check firewall rules and ensure the correct host/port is configured."
  },
  ECONNRESET: {
    code: -104,
    message: "Connection Reset",
    details: "An existing TCP connection was forcibly closed by the peer (server or intermediary). This can occur due to server restarts, timeouts, or network issues.",
    suggestion: "Retry the request. If persistent, check server logs or contact the server administrator."
  },
  ETIMEDOUT: {
    code: -110,
    message: "Connection Timeout",
    details: "The attempt to establish a TCP connection timed out with no response received within the timeout period.",
    suggestion: "Increase the timeout value, check network connectivity, or verify the server is responding."
  },
  ENOTFOUND: {
    code: -3008,
    message: "DNS Lookup Failed",
    details: "DNS lookup for the hostname failed. The domain name does not exist or the DNS server returned an error.",
    suggestion: "Verify the hostname is correct and DNS resolution is working. Check your network connection."
  },
  EAI_AGAIN: {
    code: -3001,
    message: "Temporary DNS Failure",
    details: "A temporary failure occurred during DNS name resolution. This is often a transient network issue.",
    suggestion: "Retry the request. If persistent, check your DNS server configuration."
  },
  EPIPE: {
    code: -32,
    message: "Broken Pipe",
    details: "The connection was closed unexpectedly while writing data. The server closed the connection before all data was sent.",
    suggestion: "Retry the request. Check if the server has connection limits or timeout settings."
  },
  EHOSTUNREACH: {
    code: -113,
    message: "Host Unreachable",
    details: "No route to the host could be found. The destination is not reachable from your network.",
    suggestion: "Verify the host address is correct and check your network routing configuration."
  },
  ENETUNREACH: {
    code: -101,
    message: "Network Unreachable",
    details: "The network containing the target host is not reachable. This indicates a routing or connectivity issue.",
    suggestion: "Check your internet connection and network configuration."
  },
  EPROTO: {
    code: -71,
    message: "Protocol Error",
    details: "A protocol error occurred, often during the TLS/SSL handshake phase. This may indicate incompatible protocol versions.",
    suggestion: "Ensure TLS/SSL configuration is compatible with the server. Try disabling specific TLS versions if needed."
  },
  ERR_INVALID_PROTOCOL: {
    code: -1001,
    message: "Invalid URL Protocol",
    details: "The provided URL uses an unsupported or invalid protocol scheme. Only http:// and https:// are supported.",
    suggestion: "Use a valid URL with http:// or https:// protocol."
  },
  ERR_TLS_CERT_ALTNAME_INVALID: {
    code: -1002,
    message: "Certificate Hostname Mismatch",
    details: "The server's SSL/TLS certificate hostname does not match the requested domain (Subject Alternative Name mismatch).",
    suggestion: "Verify you're connecting to the correct host. The certificate may be misconfigured on the server."
  },
  ERR_TLS_HANDSHAKE_TIMEOUT: {
    code: -1003,
    message: "TLS Handshake Timeout",
    details: "The TLS/SSL handshake timed out before completing. This may indicate network latency or server issues.",
    suggestion: "Increase the timeout value or check network connectivity to the server."
  },
  ERR_TLS_INVALID_PROTOCOL_VERSION: {
    code: -1004,
    message: "TLS Protocol Version Mismatch",
    details: "The client and server could not agree on a mutually supported TLS/SSL protocol version.",
    suggestion: "Update TLS configuration to support the server's required protocol version."
  },
  ERR_TLS_RENEGOTIATION_DISABLED: {
    code: -1005,
    message: "TLS Renegotiation Disabled",
    details: "An attempt at TLS/SSL renegotiation was made, but it is disabled or disallowed by the server configuration.",
    suggestion: "Contact the server administrator if renegotiation is required for your use case."
  },
  ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED: {
    code: -1006,
    message: "Unsupported Certificate Signature",
    details: "The signature algorithm used in the server's SSL/TLS certificate is not supported or deemed insecure.",
    suggestion: "The server's certificate may need to be updated to use a supported signature algorithm."
  },
  CERT_HAS_EXPIRED: {
    code: -1050,
    message: "Certificate Expired",
    details: "The server's SSL/TLS certificate has expired and is no longer valid.",
    suggestion: "Contact the server administrator to renew the certificate, or set rejectUnauthorized: false for testing only."
  },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    code: -1051,
    message: "Certificate Verification Failed",
    details: "Unable to verify the server's SSL/TLS certificate chain. The certificate may be self-signed or missing intermediate certificates.",
    suggestion: "Add the certificate to your trust store, or set rejectUnauthorized: false for testing only."
  },
  SELF_SIGNED_CERT_IN_CHAIN: {
    code: -1052,
    message: "Self-Signed Certificate",
    details: "A self-signed certificate was found in the certificate chain. Self-signed certificates are not trusted by default.",
    suggestion: "Add the certificate to your trust store, or set rejectUnauthorized: false for testing only."
  },
  DEPTH_ZERO_SELF_SIGNED_CERT: {
    code: -1053,
    message: "Self-Signed Certificate (No Chain)",
    details: "The server presented a self-signed certificate with no certificate chain.",
    suggestion: "Add the certificate to your trust store, or set rejectUnauthorized: false for testing only."
  },
  ERR_HTTP_HEADERS_SENT: {
    code: -1007,
    message: "Headers Already Sent",
    details: "An attempt was made to send HTTP headers after they had already been sent. This is an application logic error.",
    suggestion: "Review your code to ensure headers are only set once before sending the response."
  },
  ERR_INVALID_ARG_TYPE: {
    code: -1008,
    message: "Invalid Argument Type",
    details: "An argument of an incorrect type was passed to the HTTP request function.",
    suggestion: "Check your request configuration and ensure all values have the correct types."
  },
  ERR_INVALID_URL: {
    code: -1009,
    message: "Invalid URL",
    details: "The provided URL is syntactically invalid or cannot be parsed.",
    suggestion: "Verify the URL format is correct and properly encoded."
  },
  ERR_STREAM_DESTROYED: {
    code: -1010,
    message: "Stream Destroyed",
    details: "The readable/writable stream associated with the request/response was destroyed prematurely.",
    suggestion: "Ensure streams are properly managed and not closed before operations complete."
  },
  ERR_STREAM_PREMATURE_CLOSE: {
    code: -1011,
    message: "Premature Stream Close",
    details: "The server closed the connection before sending the complete response body (e.g., incomplete chunked encoding).",
    suggestion: "This may indicate a server-side issue. Retry the request or contact the server administrator."
  },
  UND_ERR_CONNECT_TIMEOUT: {
    code: -1020,
    message: "Connect Timeout",
    details: "Timeout occurred while waiting for the TCP socket connection to be established.",
    suggestion: "Increase the connection timeout or check network connectivity."
  },
  UND_ERR_HEADERS_TIMEOUT: {
    code: -1021,
    message: "Headers Timeout",
    details: "Timeout occurred while waiting to receive the complete HTTP response headers from the server.",
    suggestion: "Increase the headers timeout or check if the server is responding slowly."
  },
  UND_ERR_SOCKET: {
    code: -1022,
    message: "Socket Error",
    details: "An error occurred at the underlying socket level during the connection.",
    suggestion: "Check network connectivity and firewall settings."
  },
  UND_ERR_INFO: {
    code: -1023,
    message: "Invalid Request Info",
    details: "Internal error related to invalid or missing metadata needed to process the request.",
    suggestion: "Check your request configuration for missing or invalid values."
  },
  UND_ERR_ABORTED: {
    code: -1024,
    message: "Request Aborted",
    details: "The request was explicitly aborted, often due to a timeout signal or user action.",
    suggestion: "If unintended, check your abort controller and timeout settings."
  },
  ABORT_ERR: {
    code: -1025,
    message: "Request Aborted",
    details: "The request was explicitly aborted by the client.",
    suggestion: "If unintended, review your code for abort signal triggers."
  },
  UND_ERR_REQUEST_TIMEOUT: {
    code: -1026,
    message: "Request Timeout",
    details: "The request timed out waiting for a response from the server.",
    suggestion: "Increase the request timeout or check server responsiveness."
  },
  REZ_UNKNOWN_ERROR: {
    code: -9999,
    message: "Unknown Error",
    details: "An unspecified or unrecognized error occurred during the request.",
    suggestion: "Check the error cause for more details. If the issue persists, please report it."
  },
  REZ_FILE_PERMISSION_ERROR: {
    code: -1027,
    message: "File Permission Error",
    details: "Insufficient permissions to read or write a required file.",
    suggestion: "Check file permissions and ensure the application has the necessary access rights."
  },
  REZ_MISSING_REDIRECT_LOCATION: {
    code: -1028,
    message: "Missing Redirect Location",
    details: "The server returned a redirect status code (3xx) but did not include the required Location header.",
    suggestion: "This is a server-side issue. Contact the server administrator."
  },
  REZ_DECOMPRESSION_ERROR: {
    code: -1029,
    message: "Decompression Error",
    details: "Failed to decompress the response body. The data may be corrupt or the encoding may be incorrect.",
    suggestion: "Try disabling automatic decompression with decompress: false."
  },
  REZ_DOWNLOAD_FAILED: {
    code: -1030,
    message: "Download Failed",
    details: "The resource could not be fully downloaded due to an error during data transfer.",
    suggestion: "Check network connectivity and available disk space. Retry the download."
  },
  REZ_HTTP_ERROR: {
    code: -1031,
    message: "HTTP Error",
    details: "The server responded with a non-successful HTTP status code.",
    suggestion: "Check the status code and response body for more details about the error."
  },
  REZ_REDIRECT_DENIED: {
    code: -1032,
    message: "Redirect Denied",
    details: "A redirect response was received, but following redirects is disabled or disallowed by configuration.",
    suggestion: "Enable followRedirects: true if you want to follow redirects automatically."
  },
  REZ_MAX_REDIRECTS_EXCEEDED: {
    code: -1035,
    message: "Maximum Redirects Exceeded",
    details: "The maximum number of allowed redirects has been exceeded. This may indicate a redirect loop.",
    suggestion: "Increase maxRedirects or check for redirect loops on the server."
  },
  REZ_REDIRECT_CYCLE_DETECTED: {
    code: -1036,
    message: "Redirect Cycle Detected",
    details: "A circular redirect loop was detected. The request is being redirected in a cycle.",
    suggestion: "This is a server configuration issue. Contact the server administrator."
  },
  REZ_PROXY_INVALID_PROTOCOL: {
    code: -1033,
    message: "Invalid Proxy Protocol",
    details: "The specified proxy URL has an invalid or unsupported protocol scheme. Supported protocols are: http, https, socks4, socks5.",
    suggestion: "Use a valid proxy URL with http://, https://, socks4://, or socks5:// protocol."
  },
  REZ_PROXY_INVALID_HOSTPORT: {
    code: -1034,
    message: "Invalid Proxy Configuration",
    details: "The hostname or port number provided for the proxy server is invalid or malformed.",
    suggestion: "Verify the proxy host and port are correct. Format: protocol://host:port"
  },
  REZ_PROXY_CONNECTION_FAILED: {
    code: -1044,
    message: "Proxy Connection Failed",
    details: "Failed to establish a connection with the proxy server. The proxy may be down or unreachable.",
    suggestion: "Verify the proxy server is running and accessible. Check host, port, and network connectivity."
  },
  REZ_PROXY_AUTHENTICATION_FAILED: {
    code: -1045,
    message: "Proxy Authentication Failed",
    details: "Authentication with the proxy server failed. The provided credentials were rejected.",
    suggestion: "Verify your proxy username and password are correct."
  },
  REZ_PROXY_TARGET_UNREACHABLE: {
    code: -1046,
    message: "Proxy Target Unreachable",
    details: "The proxy server was unable to connect to the target destination. The target may be blocked or unreachable from the proxy.",
    suggestion: "Verify the target URL is correct and accessible from the proxy server."
  },
  REZ_PROXY_ERROR: {
    code: -1047,
    message: "Proxy Error",
    details: "An unspecified error occurred while communicating with or through the proxy server.",
    suggestion: "Check proxy server logs or try a different proxy."
  },
  REZ_PROXY_TIMEOUT: {
    code: -1048,
    message: "Proxy Timeout",
    details: "The connection through the proxy server timed out before completing.",
    suggestion: "Increase the proxy timeout or check proxy server performance."
  },
  REZ_SOCKS_CONNECTION_FAILED: {
    code: -1040,
    message: "SOCKS Proxy Connection Failed",
    details: "Failed to establish a connection with the SOCKS proxy server. The proxy may be down or unreachable.",
    suggestion: "Verify the SOCKS proxy host, port, and network connectivity."
  },
  REZ_SOCKS_AUTHENTICATION_FAILED: {
    code: -1041,
    message: "SOCKS Proxy Authentication Failed",
    details: "Authentication with the SOCKS5 proxy failed. The credentials were rejected or the authentication method is not supported.",
    suggestion: "Verify your SOCKS proxy username and password. Ensure the proxy supports your authentication method."
  },
  REZ_SOCKS_TARGET_CONNECTION_FAILED: {
    code: -1042,
    message: "SOCKS Proxy Target Unreachable",
    details: "The SOCKS proxy was unable to connect to the final destination. The target may be unreachable from the proxy network.",
    suggestion: "Verify the target URL is correct and accessible from the SOCKS proxy."
  },
  REZ_SOCKS_PROTOCOL_ERROR: {
    code: -1043,
    message: "SOCKS Protocol Error",
    details: "Invalid or malformed response received from the SOCKS proxy during handshake or connection.",
    suggestion: "Ensure the proxy is a valid SOCKS4/SOCKS5 server and supports the required features."
  },
  REZ_SOCKS_UNSUPPORTED_VERSION: {
    code: -1049,
    message: "SOCKS Version Not Supported",
    details: "The SOCKS proxy version is not supported. Only SOCKS4 and SOCKS5 are supported.",
    suggestion: "Use a SOCKS4 or SOCKS5 proxy server."
  },
  REZ_UPLOAD_FAILED: {
    code: -1060,
    message: "Upload Failed",
    details: "The file upload could not be completed due to an error during data transfer.",
    suggestion: "Check network connectivity and try again. Verify the server accepts the file type and size."
  },
  REZ_STREAM_ERROR: {
    code: -1061,
    message: "Stream Error",
    details: "An error occurred while processing the response stream.",
    suggestion: "Retry the request. If persistent, the server may be returning malformed data."
  },
  REZ_BODY_TOO_LARGE: {
    code: -1062,
    message: "Request Body Too Large",
    details: "The request body exceeds the maximum allowed size.",
    suggestion: "Reduce the size of the request body or increase maxBodyLength."
  },
  REZ_RESPONSE_TOO_LARGE: {
    code: -1063,
    message: "Response Too Large",
    details: "The response body exceeds the maximum allowed size for buffering.",
    suggestion: "Use streaming mode for large responses with rezo.stream()."
  },
  REZ_INVALID_JSON: {
    code: -1064,
    message: "Invalid JSON Response",
    details: "Failed to parse the response body as JSON. The server returned invalid JSON data.",
    suggestion: "Check the response Content-Type header and response body. Use responseType: 'text' to get raw response."
  },
  REZ_RATE_LIMITED: {
    code: -1065,
    message: "Rate Limited",
    details: "The server has rate-limited your requests. Too many requests were sent in a short period.",
    suggestion: "Implement request throttling or wait before retrying. Check the Retry-After header if available."
  }
};
var RezoErrorCode; exports.RezoErrorCode = RezoErrorCode;
((RezoErrorCode) => {
  RezoErrorCode["CONNECTION_REFUSED"] = "ECONNREFUSED";
  RezoErrorCode["CONNECTION_RESET"] = "ECONNRESET";
  RezoErrorCode["CONNECTION_TIMEOUT"] = "ETIMEDOUT";
  RezoErrorCode["DNS_LOOKUP_FAILED"] = "ENOTFOUND";
  RezoErrorCode["DNS_TEMPORARY_FAILURE"] = "EAI_AGAIN";
  RezoErrorCode["HOST_UNREACHABLE"] = "EHOSTUNREACH";
  RezoErrorCode["NETWORK_UNREACHABLE"] = "ENETUNREACH";
  RezoErrorCode["BROKEN_PIPE"] = "EPIPE";
  RezoErrorCode["HTTP_ERROR"] = "REZ_HTTP_ERROR";
  RezoErrorCode["REDIRECT_DENIED"] = "REZ_REDIRECT_DENIED";
  RezoErrorCode["MAX_REDIRECTS"] = "REZ_MAX_REDIRECTS_EXCEEDED";
  RezoErrorCode["REDIRECT_CYCLE"] = "REZ_REDIRECT_CYCLE_DETECTED";
  RezoErrorCode["MISSING_REDIRECT_LOCATION"] = "REZ_MISSING_REDIRECT_LOCATION";
  RezoErrorCode["DECOMPRESSION_ERROR"] = "REZ_DECOMPRESSION_ERROR";
  RezoErrorCode["REQUEST_TIMEOUT"] = "UND_ERR_REQUEST_TIMEOUT";
  RezoErrorCode["HEADERS_TIMEOUT"] = "UND_ERR_HEADERS_TIMEOUT";
  RezoErrorCode["CONNECT_TIMEOUT"] = "UND_ERR_CONNECT_TIMEOUT";
  RezoErrorCode["ABORTED"] = "ABORT_ERR";
  RezoErrorCode["DOWNLOAD_FAILED"] = "REZ_DOWNLOAD_FAILED";
  RezoErrorCode["UPLOAD_FAILED"] = "REZ_UPLOAD_FAILED";
  RezoErrorCode["STREAM_ERROR"] = "REZ_STREAM_ERROR";
  RezoErrorCode["BODY_TOO_LARGE"] = "REZ_BODY_TOO_LARGE";
  RezoErrorCode["RESPONSE_TOO_LARGE"] = "REZ_RESPONSE_TOO_LARGE";
  RezoErrorCode["INVALID_JSON"] = "REZ_INVALID_JSON";
  RezoErrorCode["INVALID_URL"] = "ERR_INVALID_URL";
  RezoErrorCode["INVALID_PROTOCOL"] = "ERR_INVALID_PROTOCOL";
  RezoErrorCode["INVALID_ARGUMENT"] = "ERR_INVALID_ARG_TYPE";
  RezoErrorCode["FILE_PERMISSION"] = "REZ_FILE_PERMISSION_ERROR";
  RezoErrorCode["PROXY_CONNECTION_FAILED"] = "REZ_PROXY_CONNECTION_FAILED";
  RezoErrorCode["PROXY_AUTH_FAILED"] = "REZ_PROXY_AUTHENTICATION_FAILED";
  RezoErrorCode["PROXY_TARGET_UNREACHABLE"] = "REZ_PROXY_TARGET_UNREACHABLE";
  RezoErrorCode["PROXY_TIMEOUT"] = "REZ_PROXY_TIMEOUT";
  RezoErrorCode["PROXY_ERROR"] = "REZ_PROXY_ERROR";
  RezoErrorCode["PROXY_INVALID_PROTOCOL"] = "REZ_PROXY_INVALID_PROTOCOL";
  RezoErrorCode["PROXY_INVALID_CONFIG"] = "REZ_PROXY_INVALID_HOSTPORT";
  RezoErrorCode["SOCKS_CONNECTION_FAILED"] = "REZ_SOCKS_CONNECTION_FAILED";
  RezoErrorCode["SOCKS_AUTH_FAILED"] = "REZ_SOCKS_AUTHENTICATION_FAILED";
  RezoErrorCode["SOCKS_TARGET_UNREACHABLE"] = "REZ_SOCKS_TARGET_CONNECTION_FAILED";
  RezoErrorCode["SOCKS_PROTOCOL_ERROR"] = "REZ_SOCKS_PROTOCOL_ERROR";
  RezoErrorCode["SOCKS_UNSUPPORTED_VERSION"] = "REZ_SOCKS_UNSUPPORTED_VERSION";
  RezoErrorCode["TLS_HANDSHAKE_TIMEOUT"] = "ERR_TLS_HANDSHAKE_TIMEOUT";
  RezoErrorCode["TLS_PROTOCOL_ERROR"] = "EPROTO";
  RezoErrorCode["TLS_PROTOCOL_VERSION"] = "ERR_TLS_INVALID_PROTOCOL_VERSION";
  RezoErrorCode["CERTIFICATE_HOSTNAME_MISMATCH"] = "ERR_TLS_CERT_ALTNAME_INVALID";
  RezoErrorCode["CERTIFICATE_EXPIRED"] = "CERT_HAS_EXPIRED";
  RezoErrorCode["CERTIFICATE_SELF_SIGNED"] = "SELF_SIGNED_CERT_IN_CHAIN";
  RezoErrorCode["CERTIFICATE_VERIFY_FAILED"] = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  RezoErrorCode["RATE_LIMITED"] = "REZ_RATE_LIMITED";
  RezoErrorCode["UNKNOWN_ERROR"] = "REZ_UNKNOWN_ERROR";
})(RezoErrorCode ||= {});
function getHttpErrorMessage(statusCode) {
  const statusMessages = {
    400: "Bad Request: The server cannot process the request due to invalid syntax.",
    401: "Unauthorized: Authentication is required and has failed or has not been provided.",
    403: "Forbidden: The server understood the request but refuses to authorize it.",
    404: "Not Found: The requested resource could not be found on the server.",
    405: "Method Not Allowed: The request method is not supported for the requested resource.",
    408: "Request Timeout: The server timed out waiting for the request.",
    409: "Conflict: The request conflicts with the current state of the server.",
    410: "Gone: The requested resource is no longer available and will not be available again.",
    413: "Payload Too Large: The request entity is larger than limits defined by server.",
    414: "URI Too Long: The URI requested by the client is longer than the server can interpret.",
    415: "Unsupported Media Type: The media format of the requested data is not supported.",
    422: "Unprocessable Entity: The request was well-formed but contains semantic errors.",
    429: "Too Many Requests: The user has sent too many requests in a given amount of time.",
    500: "Internal Server Error: The server has encountered an unexpected condition.",
    501: "Not Implemented: The server does not support the functionality required to fulfill the request.",
    502: "Bad Gateway: The server received an invalid response from the upstream server.",
    503: "Service Unavailable: The server is currently unavailable (overloaded or down).",
    504: "Gateway Timeout: The server did not receive a timely response from the upstream server.",
    505: "HTTP Version Not Supported: The HTTP version used in the request is not supported."
  };
  return statusMessages[statusCode] || `HTTP Error ${statusCode}: The server responded with a non-successful status code.`;
}
function getCode(code) {
  const error = ERROR_INFO[code];
  if (error) {
    return {
      message: error.message,
      details: error.details,
      suggestion: error.suggestion,
      errno: error.code
    };
  } else {
    const unknownError = ERROR_INFO["REZ_UNKNOWN_ERROR"];
    return {
      message: unknownError.message,
      details: unknownError.details,
      suggestion: unknownError.suggestion,
      errno: unknownError.code
    };
  }
}
function getErrorInfo(code) {
  return getCode(code);
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

class RezoError extends Error {
  constructor(message, config, code, request, response) {
    super();
    Object.defineProperty(this, "config", { value: config, enumerable: false });
    Object.defineProperty(this, "request", { value: request, enumerable: false });
    Object.defineProperty(this, "response", { value: response, enumerable: false });
    Object.defineProperty(this, "isRezoError", { value: true, enumerable: false });
    if (code) {
      Object.defineProperty(this, "code", { value: code, enumerable: true });
    }
    const timeoutCodes = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_REQUEST_TIMEOUT", "ERR_TLS_HANDSHAKE_TIMEOUT", "REZ_PROXY_TIMEOUT"];
    const abortCodes = ["ABORT_ERR", "UND_ERR_ABORTED"];
    const networkCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET"];
    const proxyCodes = ["REZ_PROXY_CONNECTION_FAILED", "REZ_PROXY_AUTHENTICATION_FAILED", "REZ_PROXY_TARGET_UNREACHABLE", "REZ_PROXY_ERROR", "REZ_PROXY_TIMEOUT", "REZ_PROXY_INVALID_PROTOCOL", "REZ_PROXY_INVALID_HOSTPORT"];
    const socksCodes = ["REZ_SOCKS_CONNECTION_FAILED", "REZ_SOCKS_AUTHENTICATION_FAILED", "REZ_SOCKS_TARGET_CONNECTION_FAILED", "REZ_SOCKS_PROTOCOL_ERROR", "REZ_SOCKS_UNSUPPORTED_VERSION"];
    const tlsCodes = ["EPROTO", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_TLS_INVALID_PROTOCOL_VERSION", "ERR_TLS_RENEGOTIATION_DISABLED", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"];
    const retryableCodes = [...timeoutCodes, "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "REZ_RATE_LIMITED"];
    Object.defineProperty(this, "isTimeout", { value: code ? timeoutCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isAborted", { value: code ? abortCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isNetworkError", { value: code ? networkCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isHttpError", { value: code === "REZ_HTTP_ERROR", enumerable: false });
    Object.defineProperty(this, "isProxyError", { value: code ? proxyCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isSocksError", { value: code ? socksCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isTlsError", { value: code ? tlsCodes.includes(code) : false, enumerable: false });
    Object.defineProperty(this, "isRetryable", { value: code ? retryableCodes.includes(code) || code === "REZ_HTTP_ERROR" : false, enumerable: false });
    if (code) {
      const errorInfo = getCode(code);
      Object.defineProperty(this, "errno", { value: errorInfo.errno, enumerable: false });
      Object.defineProperty(this, "details", { value: errorInfo.details, enumerable: false });
      Object.defineProperty(this, "suggestion", { value: errorInfo.suggestion, enumerable: false });
      this.message = errorInfo.message;
    } else {
      this.message = message;
      Object.defineProperty(this, "details", { value: message, enumerable: false });
      Object.defineProperty(this, "suggestion", { value: "Check the error details for more information.", enumerable: false });
    }
    if (response) {
      Object.defineProperty(this, "status", { value: response.status, enumerable: false });
      Object.defineProperty(this, "statusText", { value: response.statusText, enumerable: false });
    }
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, RezoError.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    if (this.stack) {
      const cleaned = cleanStackTrace(this.stack);
      if (cleaned) {
        Object.defineProperty(this, "stack", { value: cleaned, enumerable: false, writable: true });
      }
    }
  }
  [Symbol.for("nodejs.util.inspect.custom")](_depth, _options) {
    const parts = [];
    parts.push(`${this.name}: ${this.message}`);
    if (this.code) {
      parts.push(`  code: '${this.code}'`);
    }
    if (this.details && this.details !== this.message) {
      parts.push(`  details: ${this.details}`);
    }
    if (this.suggestion) {
      parts.push(`  suggestion: ${this.suggestion}`);
    }
    return parts.join(`
`);
  }
  static isRezoError(error) {
    return error instanceof RezoError || error !== null && typeof error === "object" && error.isRezoError === true;
  }
  static fromError(error, config, request, response) {
    const code = "code" in error ? error.code : undefined;
    const rezoError = new RezoError(error.message, config, code, request, response);
    Object.defineProperty(rezoError, "cause", { value: error, enumerable: false });
    const cleaned = cleanStackTrace(error.stack);
    if (cleaned) {
      Object.defineProperty(rezoError, "stack", { value: cleaned, enumerable: false });
    }
    if ("syscall" in error) {
      Object.defineProperty(rezoError, "syscall", { value: error.syscall, enumerable: false });
    }
    if ("hostname" in error) {
      Object.defineProperty(rezoError, "hostname", { value: error.hostname, enumerable: false });
    }
    if ("port" in error) {
      Object.defineProperty(rezoError, "port", { value: error.port, enumerable: false });
    }
    if ("address" in error) {
      Object.defineProperty(rezoError, "address", { value: error.address, enumerable: false });
    }
    return rezoError;
  }
  static createNetworkError(message, code, config, request) {
    return new RezoError(message, config, code, request);
  }
  static createHttpError(statusCode, config, request, response) {
    const error = new RezoError(getHttpErrorMessage(statusCode), config, "REZ_HTTP_ERROR", request, response);
    Object.defineProperty(error, "status", { value: statusCode, enumerable: false });
    return error;
  }
  static createTimeoutError(message, config, request) {
    return new RezoError(message, config, "ETIMEDOUT", request);
  }
  static createAbortError(message, config, request) {
    return new RezoError(message, config, "ABORT_ERR", request);
  }
  static createParsingError(message, config, request) {
    return new RezoError(message, config, "REZ_INVALID_JSON", request);
  }
  static createEnvironmentError(message, config) {
    return new RezoError(message, config, "REZ_UNKNOWN_ERROR");
  }
  static createDecompressionError(message, config, request, response) {
    return new RezoError(message, config, "REZ_DECOMPRESSION_ERROR", request, response);
  }
  static createDownloadError(message, config, request, response) {
    return new RezoError(message, config, "REZ_DOWNLOAD_FAILED", request, response);
  }
  static createUploadError(message, config, request, response) {
    return new RezoError(message, config, "REZ_UPLOAD_FAILED", request, response);
  }
  static createStreamError(message, config, request, response) {
    return new RezoError(message, config, "REZ_STREAM_ERROR", request, response);
  }
  static createRedirectError(message, config, request, response) {
    return new RezoError(message, config, "REZ_MISSING_REDIRECT_LOCATION", request, response);
  }
  static createProxyError(code, config, request) {
    const validCodes = ["REZ_PROXY_CONNECTION_FAILED", "REZ_PROXY_AUTHENTICATION_FAILED", "REZ_PROXY_TARGET_UNREACHABLE", "REZ_PROXY_ERROR", "REZ_PROXY_TIMEOUT", "REZ_PROXY_INVALID_PROTOCOL", "REZ_PROXY_INVALID_HOSTPORT"];
    const errorCode = validCodes.includes(code) ? code : "REZ_PROXY_ERROR";
    return new RezoError("Proxy error", config, errorCode, request);
  }
  static createSocksError(code, config, request) {
    const validCodes = ["REZ_SOCKS_CONNECTION_FAILED", "REZ_SOCKS_AUTHENTICATION_FAILED", "REZ_SOCKS_TARGET_CONNECTION_FAILED", "REZ_SOCKS_PROTOCOL_ERROR", "REZ_SOCKS_UNSUPPORTED_VERSION"];
    const errorCode = validCodes.includes(code) ? code : "REZ_SOCKS_CONNECTION_FAILED";
    return new RezoError("SOCKS proxy error", config, errorCode, request);
  }
  static createTlsError(code, config, request) {
    const validCodes = ["EPROTO", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_TLS_INVALID_PROTOCOL_VERSION", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"];
    const errorCode = validCodes.includes(code) ? code : "EPROTO";
    return new RezoError("TLS/SSL error", config, errorCode, request);
  }
  static createRateLimitError(config, request, response) {
    const error = new RezoError("Rate limited", config, "REZ_RATE_LIMITED", request, response);
    Object.defineProperty(error, "status", { value: 429, enumerable: false });
    return error;
  }
  toJSON() {
    const result = {
      name: this.name,
      message: this.message
    };
    if (this.code !== undefined)
      result.code = this.code;
    if (this.details !== undefined)
      result.details = this.details;
    if (this.suggestion !== undefined)
      result.suggestion = this.suggestion;
    if (this.status !== undefined)
      result.status = this.status;
    if (this.statusText !== undefined)
      result.statusText = this.statusText;
    return result;
  }
  toString() {
    let result = `${this.name}: ${this.message}`;
    if (this.code) {
      result += ` [${this.code}]`;
    }
    return result;
  }
  getFullDetails() {
    let result = `${this.name}: ${this.message}
`;
    result += `
Details: ${this.details}
`;
    result += `Suggestion: ${this.suggestion}
`;
    if (this.code)
      result += `Code: ${this.code}
`;
    if (this.errno)
      result += `Error Number: ${this.errno}
`;
    if (this.status)
      result += `HTTP Status: ${this.status} ${this.statusText || ""}
`;
    if (this.hostname)
      result += `Host: ${this.hostname}
`;
    if (this.port)
      result += `Port: ${this.port}
`;
    return result;
  }
}

exports.getHttpErrorMessage = getHttpErrorMessage;
exports.getCode = getCode;
exports.getErrorInfo = getErrorInfo;
exports.RezoError = RezoError;
exports.default = RezoError;
module.exports = Object.assign(RezoError, exports);