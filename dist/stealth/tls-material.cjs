const tls = require("node:tls");
const { RezoError, RezoErrorCode } = require('../errors/rezo-error.cjs');
const HYBRID_GROUPS = exports.HYBRID_GROUPS = new Set(["X25519MLKEM768", "X25519Kyber768Draft00", "SecP256r1MLKEM768", "SecP384r1MLKEM1024"]);
const OPTIONAL_GROUPS = new Set([...HYBRID_GROUPS, "ffdhe2048", "ffdhe3072", "ffdhe4096", "ffdhe6144", "ffdhe8192"]);
const LEGACY_SIGALGS = new Set(["ecdsa_sha1", "rsa_pkcs1_sha1"]);
const acceptedMaterial = new WeakMap;
const groupsOf = exports.groupsOf = (curve) => curve.split(":").map((group) => group.replace(/^\*/u, "")).filter(Boolean);
const contextOptions = (fingerprint) => ({
  ciphers: fingerprint.ciphers,
  sigalgs: fingerprint.sigalgs,
  ecdhCurve: fingerprint.ecdhCurve,
  minVersion: fingerprint.minVersion,
  maxVersion: fingerprint.maxVersion,
  sessionTimeout: fingerprint.sessionTimeout
});
const materialKey = (fingerprint) => JSON.stringify(contextOptions(fingerprint));
function unsupported(cause) {
  const error = new RezoError("The TLS provider cannot construct the requested stealth TLS context", {}, RezoErrorCode.UNSUPPORTED_CAPABILITY);
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
}
function markedGroups(groups) {
  const count = groups.length > 1 && HYBRID_GROUPS.has(groups[0]) ? 2 : 1;
  return groups.map((group, index) => index < count ? `*${group}` : group).join(":");
}
function selectTlsMaterial(fingerprint) {
  const requested = groupsOf(fingerprint.ecdhCurve);
  const addLegacyLevel = fingerprint.sigalgs.split(":").some((name) => LEGACY_SIGALGS.has(name)) && !fingerprint.ciphers.split(":").some((name) => name.startsWith("@SECLEVEL="));
  const ciphers = addLegacyLevel ? [`${fingerprint.ciphers}:@SECLEVEL=0`, fingerprint.ciphers] : [fingerprint.ciphers];
  let lastError;
  const tryGroups = (groups) => {
    for (const cipher of ciphers) {
      for (const marked of [true, false]) {
        const candidate = { ...fingerprint, ciphers: cipher, ecdhCurve: marked ? markedGroups(groups) : groups.join(":") };
        try {
          const context = tls.createSecureContext(contextOptions(candidate));
          acceptedMaterial.set(candidate, materialKey(candidate));
          return { fingerprint: candidate, context, groups, marked, legacyLevelOmitted: addLegacyLevel && cipher === fingerprint.ciphers };
        } catch (error) {
          lastError = error;
        }
      }
    }
    return;
  };
  const full = tryGroups(requested);
  if (full)
    return full;
  const supported = requested.filter((group) => {
    if (!OPTIONAL_GROUPS.has(group))
      return true;
    try {
      tls.createSecureContext({ ecdhCurve: group });
      return true;
    } catch {
      return false;
    }
  });
  if (supported.length > 0 && supported.length !== requested.length) {
    const narrowed = tryGroups(supported);
    if (narrowed)
      return narrowed;
  }
  throw unsupported(lastError);
}
function contextFromTlsMaterial(fingerprint) {
  if (acceptedMaterial.get(fingerprint) !== materialKey(fingerprint))
    return selectTlsMaterial(fingerprint).context;
  try {
    return tls.createSecureContext(contextOptions(fingerprint));
  } catch (error) {
    throw unsupported(error);
  }
}

exports.selectTlsMaterial = selectTlsMaterial;
exports.contextFromTlsMaterial = contextFromTlsMaterial;