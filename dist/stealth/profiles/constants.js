export const CHROME_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
export const CHROME_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:" + "ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:" + "rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
export const CHROME_CURVES_PRE_124 = "X25519:prime256v1:secp384r1";
export const CHROME_CURVES_124_130 = "X25519Kyber768Draft00:X25519:prime256v1:secp384r1";
export const CHROME_CURVES_131_PLUS = "X25519MLKEM768:X25519:prime256v1:secp384r1";
export const CHROME_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 6291456,
  maxHeaderListSize: 262144,
  connectionWindowSize: 15663105
};
export const CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
export const CHROME_HEADER_ORDER = [
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
  "accept-language",
  "priority"
];
export const FIREFOX_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
export const FIREFOX_115_CIPHERS = FIREFOX_CIPHERS + ":DES-CBC3-SHA";
export const FIREFOX_SIGALGS = "ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:" + "rsa_pss_rsae_sha256:rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:" + "rsa_pkcs1_sha256:rsa_pkcs1_sha384:rsa_pkcs1_sha512:" + "ecdsa_sha1:rsa_pkcs1_sha1";
export const FIREFOX_CURVES = "X25519:prime256v1:secp384r1:secp521r1:ffdhe2048:ffdhe3072";
export const FIREFOX_CURVES_132_PLUS = "X25519MLKEM768:X25519:prime256v1:secp384r1:secp521r1:ffdhe2048:ffdhe3072";
export const FIREFOX_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 131072,
  maxFrameSize: 16384,
  connectionWindowSize: 12517377
};
export const FIREFOX_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8";
export const FIREFOX_HEADER_ORDER = [
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
export const FIREFOX_133_HEADER_ORDER = [
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
export const SAFARI_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-CHACHA20-POLY1305:" + "ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-ECDSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA:" + "ECDHE-RSA-AES256-SHA:ECDHE-RSA-AES128-SHA:" + "AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-SHA:AES128-SHA";
export const SAFARI_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:" + "ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:" + "rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:" + "rsa_pkcs1_sha384:rsa_pkcs1_sha512";
export const SAFARI_CURVES = "X25519:prime256v1:secp384r1:secp521r1";
export const SAFARI_H2 = {
  enablePush: false,
  initialWindowSize: 4194304,
  maxConcurrentStreams: 100,
  connectionWindowSize: 10485760
};
export const SAFARI_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const SAFARI_HEADER_ORDER = [
  "host",
  "accept",
  "sec-fetch-site",
  "sec-fetch-dest",
  "accept-language",
  "sec-fetch-mode",
  "user-agent",
  "accept-encoding",
  "connection"
];
const CHROMIUM_NAVIGATION = { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-user": "?1", "sec-fetch-dest": "document", "upgrade-insecure-requests": "1" };
export const FAMILY_NAVIGATION_HEADERS = {
  chrome: CHROMIUM_NAVIGATION,
  edge: CHROMIUM_NAVIGATION,
  opera: CHROMIUM_NAVIGATION,
  brave: CHROMIUM_NAVIGATION,
  firefox: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "sec-fetch-user": "?1", "upgrade-insecure-requests": "1" },
  safari: { "sec-fetch-site": "none", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }
};
const CHROMIUM_EXTRA = { h2: { priority: "u=0, i" } };
export const FAMILY_EXTRA_HEADERS = {
  chrome: CHROMIUM_EXTRA,
  edge: CHROMIUM_EXTRA,
  opera: CHROMIUM_EXTRA,
  brave: CHROMIUM_EXTRA,
  firefox: { h1: { priority: "u=0, i" }, h2: { priority: "u=0, i", te: "trailers" } },
  safari: {}
};
export function chromeTls(majorVersion) {
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
export function firefoxTls(majorVersion) {
  return {
    ciphers: majorVersion <= 115 ? FIREFOX_115_CIPHERS : FIREFOX_CIPHERS,
    sigalgs: FIREFOX_SIGALGS,
    ecdhCurve: majorVersion >= 132 ? FIREFOX_CURVES_132_PLUS : FIREFOX_CURVES,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
export const SAFARI_CURVES_26_PLUS = "X25519MLKEM768:X25519:prime256v1:secp384r1:secp521r1";
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
const GREASE_ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
export function chromiumGreaseBrands(major, brand, productVersion = major) {
  const greasy = `"Not${GREASE_CHARS[major % GREASE_CHARS.length]}A${GREASE_CHARS[(major + 1) % GREASE_CHARS.length]}Brand";v="${GREASE_VERSIONS[major % GREASE_VERSIONS.length]}"`;
  const chromium = `"Chromium";v="${major}"`;
  const product = `"${brand}";v="${productVersion}"`;
  const order = GREASE_ORDERS[major % GREASE_ORDERS.length];
  const list = [];
  list[order[0]] = greasy;
  list[order[1]] = chromium;
  list[order[2]] = product;
  return list.join(", ");
}
export function safariTls(majorVersion = 18) {
  return {
    ciphers: SAFARI_CIPHERS,
    sigalgs: SAFARI_SIGALGS,
    ecdhCurve: majorVersion >= 26 ? SAFARI_CURVES_26_PLUS : SAFARI_CURVES,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
const PSEUDO_MAP = { m: ":method", a: ":authority", s: ":scheme", p: ":path" };
export function expandPseudoOrder(shorthand) {
  return shorthand.split("").map((c) => PSEUDO_MAP[c]);
}
