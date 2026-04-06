export const CHROME_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
export const CHROME_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:" + "ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:" + "rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
export const CHROME_CURVES_PRE_124 = "X25519:prime256v1:secp384r1";
export const CHROME_CURVES_124_130 = "X25519:prime256v1:secp384r1";
export const CHROME_CURVES_131_PLUS = "X25519:prime256v1:secp384r1";
export const CHROME_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  maxConcurrentStreams: 1000,
  initialWindowSize: 6291456,
  maxFrameSize: 16384,
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
  "accept-language"
];
export const FIREFOX_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384:" + "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" + "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" + "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" + "ECDHE-ECDSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA:" + "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" + "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
export const FIREFOX_115_CIPHERS = FIREFOX_CIPHERS + ":DES-CBC3-SHA";
export const FIREFOX_SIGALGS = "ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:" + "rsa_pss_rsae_sha256:rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:" + "rsa_pkcs1_sha256:rsa_pkcs1_sha384:rsa_pkcs1_sha512:" + "ecdsa_sha1:rsa_pkcs1_sha1";
export const FIREFOX_CURVES = "X25519:prime256v1:secp384r1:secp521r1";
export const FIREFOX_H2 = {
  headerTableSize: 65536,
  enablePush: false,
  maxConcurrentStreams: 0,
  initialWindowSize: 131072,
  maxFrameSize: 16384,
  maxHeaderListSize: 0,
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
  headerTableSize: 4096,
  enablePush: false,
  maxConcurrentStreams: 100,
  initialWindowSize: 4194304,
  maxFrameSize: 16384,
  maxHeaderListSize: 0,
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
  "accept-encoding"
];
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
    ecdhCurve: FIREFOX_CURVES,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    alpnProtocols: ["h2", "http/1.1"],
    sessionTimeout: 3600
  };
}
export function safariTls() {
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
export function expandPseudoOrder(shorthand) {
  return shorthand.split("").map((c) => PSEUDO_MAP[c]);
}
