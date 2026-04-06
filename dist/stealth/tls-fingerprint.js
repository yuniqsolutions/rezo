import tls from "node:tls";
export function createSecureContext(fingerprint) {
  return tls.createSecureContext({
    ciphers: fingerprint.ciphers,
    sigalgs: fingerprint.sigalgs,
    ecdhCurve: fingerprint.ecdhCurve,
    minVersion: fingerprint.minVersion,
    maxVersion: fingerprint.maxVersion,
    sessionTimeout: fingerprint.sessionTimeout
  });
}
export function buildTlsOptions(fingerprint) {
  return {
    secureContext: createSecureContext(fingerprint),
    ALPNProtocols: fingerprint.alpnProtocols,
    minVersion: fingerprint.minVersion,
    maxVersion: fingerprint.maxVersion,
    rejectUnauthorized: true
  };
}
