const CHROME_CIPHERS = exports.CHROME_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
const CHROME_SIGALGS = exports.CHROME_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:" + "ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:" + "rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
const CHROME_CURVES_PRE_124 = exports.CHROME_CURVES_PRE_124 = "X25519:prime256v1:secp384r1";
const CHROME_CURVES_124_130 = exports.CHROME_CURVES_124_130 = "X25519:prime256v1:secp384r1";
const CHROME_CURVES_131_PLUS = exports.CHROME_CURVES_131_PLUS = "X25519:prime256v1:secp384r1";
const CHROME_H2 = exports.CHROME_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  maxConcurrentStreams: 1000,
  initialWindowSize: 6291456,
  maxFrameSize: 16384,
  maxHeaderListSize: 262144,
  connectionWindowSize: 15663105
};
const CHROME_ACCEPT = exports.CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
const CHROME_HEADER_ORDER = exports.CHROME_HEADER_ORDER = [
  "host",
  "connection",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "upgrade-insecure-requests",
  "user-agent",
  "accept",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-user",
  "sec-fetch-dest",
  "accept-encoding",
  "accept-language"
];
const FIREFOX_CIPHERS = exports.FIREFOX_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
const FIREFOX_115_CIPHERS = exports.FIREFOX_115_CIPHERS = FIREFOX_CIPHERS + ":DES-CBC3-SHA";
const FIREFOX_SIGALGS = exports.FIREFOX_SIGALGS = "ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:" + "rsa_pss_rsae_sha256:rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:" + "rsa_pkcs1_sha256:rsa_pkcs1_sha384:rsa_pkcs1_sha512:" + "ecdsa_sha1:rsa_pkcs1_sha1";
const FIREFOX_CURVES = exports.FIREFOX_CURVES = "X25519:prime256v1:secp384r1:secp521r1";
const FIREFOX_H2 = exports.FIREFOX_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  maxConcurrentStreams: 0,
  initialWindowSize: 131072,
  maxFrameSize: 16384,
  maxHeaderListSize: 0,
  connectionWindowSize: 12517377
};
const FIREFOX_ACCEPT = exports.FIREFOX_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8";
const FIREFOX_HEADER_ORDER = exports.FIREFOX_HEADER_ORDER = [
  "host",
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
  "connection",
  "upgrade-insecure-requests",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "te"
];
const FIREFOX_133_HEADER_ORDER = exports.FIREFOX_133_HEADER_ORDER = [
  "host",
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
  "connection",
  "upgrade-insecure-requests",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "priority",
  "te"
];
const SAFARI_CIPHERS = exports.SAFARI_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-CHACHA20-POLY1305:" + "ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-ECDSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA:" + "ECDHE-RSA-AES256-SHA:ECDHE-RSA-AES128-SHA:" + "AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-SHA:AES128-SHA";
const SAFARI_SIGALGS = exports.SAFARI_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:" + "ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:" + "rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:" + "rsa_pkcs1_sha384:rsa_pkcs1_sha512";
const SAFARI_CURVES = exports.SAFARI_CURVES = "X25519:prime256v1:secp384r1:secp521r1";
const SAFARI_H2 = exports.SAFARI_H2 = {
  headerTableSize: 4096,
  enablePush: false,
  maxConcurrentStreams: 100,
  initialWindowSize: 4194304,
  maxFrameSize: 16384,
  maxHeaderListSize: 0,
  connectionWindowSize: 10485760
};
const SAFARI_ACCEPT = exports.SAFARI_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const SAFARI_HEADER_ORDER = exports.SAFARI_HEADER_ORDER = [
  "host",
  "accept",
  "sec-fetch-site",
  "sec-fetch-dest",
  "accept-language",
  "sec-fetch-mode",
  "user-agent",
  "accept-encoding"
];
function chromeTls(majorVersion) {
  return {
    ciphers: CHROME_CIPHERS,
    sigalgs: CHROME_SIGALGS,
    ecdhCurve: majorVersion >= 131 ? CHROME_CURVES_131_PLUS : majorVersion >= 124 ? CHROME_CURVES_124_130 : CHROME_CURVES_PRE_124,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
function firefoxTls(majorVersion) {
  return {
    ciphers: majorVersion <= 115 ? FIREFOX_115_CIPHERS : FIREFOX_CIPHERS,
    sigalgs: FIREFOX_SIGALGS,
    ecdhCurve: FIREFOX_CURVES,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
function safariTls() {
  return {
    ciphers: SAFARI_CIPHERS,
    sigalgs: SAFARI_SIGALGS,
    ecdhCurve: SAFARI_CURVES,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
const PSEUDO_MAP = { m: ":method", a: ":authority", s: ":scheme", p: ":path" };
function expandPseudoOrder(shorthand) {
  return shorthand.split("").map((c) => PSEUDO_MAP[c]);
}

exports.chromeTls = chromeTls;
exports.firefoxTls = firefoxTls;
exports.safariTls = safariTls;
exports.expandPseudoOrder = expandPseudoOrder;