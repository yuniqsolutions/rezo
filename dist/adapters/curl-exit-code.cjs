const EXIT_CODE_TO_ERROR_CODE = {
  1: "ERR_INVALID_PROTOCOL",
  3: "ERR_INVALID_URL",
  5: "REZ_PROXY_CONNECTION_FAILED",
  6: "ENOTFOUND",
  8: "HPE_INVALID_CONSTANT",
  16: "ERR_HTTP2_ERROR",
  18: "ERR_STREAM_PREMATURE_CLOSE",
  22: "REZ_HTTP_ERROR",
  23: "REZ_DOWNLOAD_FAILED",
  26: "REZ_UPLOAD_FAILED",
  35: "EPROTO",
  47: "REZ_MAX_REDIRECTS_EXCEEDED",
  52: "ECONNRESET",
  53: "EPROTO",
  55: "EPIPE",
  56: "ECONNRESET",
  58: "ERR_TLS_INVALID_CLIENT_CERTIFICATE",
  59: "EPROTO",
  61: "REZ_DECOMPRESSION_ERROR",
  63: "REZ_RESPONSE_TOO_LARGE",
  77: "ERR_TLS_CA_BUNDLE_UNREADABLE",
  91: "REZ_SOCKS_PROTOCOL_ERROR",
  92: "ECONNRESET",
  97: "REZ_PROXY_TARGET_UNREACHABLE",
  99: "ERR_TLS_INVALID_CLIENT_CERTIFICATE"
};
const CONNECT_FAILURE_PATTERNS = [
  [/connection refused/i, "ECONNREFUSED"],
  [/no route to host/i, "EHOSTUNREACH"],
  [/network (is )?unreachable/i, "ENETUNREACH"],
  [/timed? ?out/i, "ETIMEDOUT"]
];
const VERIFICATION_FAILURE_PATTERNS = [
  [/no alternative certificate subject name matches|does not match target host name/i, "ERR_TLS_CERT_ALTNAME_INVALID"],
  [/certificate has expired/i, "CERT_HAS_EXPIRED"],
  [/certificate is not yet valid/i, "CERT_NOT_YET_VALID"],
  [/self[- ]signed certificate in certificate chain/i, "SELF_SIGNED_CERT_IN_CHAIN"],
  [/self[- ]signed certificate/i, "DEPTH_ZERO_SELF_SIGNED_CERT"],
  [/unable to get (local )?issuer certificate/i, "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]
];
const CURL_EXIT_COULD_NOT_CONNECT = 7;
const CURL_EXIT_PEER_VERIFICATION_FAILED = 60;
const CURL_EXIT_PEER_VERIFICATION_FAILED_LEGACY = 51;
function firstMatchingCode(stderr, patterns, fallback) {
  for (const [pattern, code] of patterns) {
    if (pattern.test(stderr))
      return code;
  }
  return fallback;
}
function classifyCurlExitCode(exitCode, stderr) {
  if (exitCode === CURL_EXIT_COULD_NOT_CONNECT) {
    return firstMatchingCode(stderr, CONNECT_FAILURE_PATTERNS, "ECONNREFUSED");
  }
  if (exitCode === CURL_EXIT_PEER_VERIFICATION_FAILED || exitCode === CURL_EXIT_PEER_VERIFICATION_FAILED_LEGACY) {
    return firstMatchingCode(stderr, VERIFICATION_FAILURE_PATTERNS, "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  }
  return EXIT_CODE_TO_ERROR_CODE[exitCode] ?? "REZ_UNKNOWN_ERROR";
}
function isCurlTransferInterruption(exitCode) {
  return exitCode === 18 || exitCode === 55 || exitCode === 56 || exitCode === 92;
}

exports.classifyCurlExitCode = classifyCurlExitCode;
exports.isCurlTransferInterruption = isCurlTransferInterruption;