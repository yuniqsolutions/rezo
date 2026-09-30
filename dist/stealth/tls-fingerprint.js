import tls from "node:tls";
import { setTlsProbe } from './resolver.js';
const HYBRID_GROUPS = new Set(["X25519MLKEM768", "X25519Kyber768Draft00", "SecP256r1MLKEM768", "SecP384r1MLKEM1024"]);
const keyShareCount = (groups) => groups.length > 1 && HYBRID_GROUPS.has(groups[0]) ? 2 : 1;
const LEGACY_SIGALGS = ["ecdsa_sha1", "rsa_pkcs1_sha1"];
const groupsOf = (ecdhCurve) => ecdhCurve.split(":").map((group) => group.replace(/^\*/u, "")).filter((group) => group !== "");
const runtimeName = () => {
  const g = globalThis;
  if (typeof g.Bun !== "undefined")
    return "bun";
  if (typeof g.Deno !== "undefined")
    return "deno";
  return "node";
};
function cipherStringFor(fingerprint) {
  const needsLegacyLevel = LEGACY_SIGALGS.some((name) => fingerprint.sigalgs.split(":").includes(name));
  return needsLegacyLevel ? `${fingerprint.ciphers}:@SECLEVEL=0` : fingerprint.ciphers;
}
function groupStringFor(groups) {
  const marked = keyShareCount(groups);
  return groups.map((group, index) => index < marked ? `*${group}` : group).join(":");
}
export function probeTlsMaterial(fingerprint) {
  const runtime = runtimeName();
  const requested = groupsOf(fingerprint.ecdhCurve);
  const hybridRequested = requested.some((group) => HYBRID_GROUPS.has(group));
  const notExpressible = ["clientHelloExtensionOrder", "grease", "padding"];
  if (runtime === "bun") {
    const bunGroups = requested.filter((group) => !group.startsWith("ffdhe"));
    const bunCiphers = fingerprint.ciphers.split(":").filter((name) => !name.startsWith("@")).join(":");
    return {
      tls: { ...fingerprint, ciphers: bunCiphers, ecdhCurve: bunGroups.join(":") },
      boundary: { runtime: { name: runtime, tlsShaping: "unavailable" }, hybridGroup: hybridRequested ? "unsupported" : "not-requested", groups: [], notExpressible: [...notExpressible, "ciphers", "sigalgs", "groups", "h1HeaderOrder"] }
    };
  }
  const attempts = [
    { groups: requested, marked: true, hybrid: hybridRequested ? "supported" : "not-requested" },
    { groups: requested.filter((group) => !HYBRID_GROUPS.has(group)), marked: true, hybrid: hybridRequested ? "unsupported" : "not-requested" },
    { groups: requested.filter((group) => !HYBRID_GROUPS.has(group)), marked: false, hybrid: hybridRequested ? "unsupported" : "not-requested" }
  ];
  const ciphers = cipherStringFor(fingerprint);
  for (const attempt of attempts) {
    const ecdhCurve = attempt.marked ? groupStringFor(attempt.groups) : attempt.groups.join(":");
    try {
      tls.createSecureContext({ ciphers, sigalgs: fingerprint.sigalgs, ecdhCurve, minVersion: fingerprint.minVersion, maxVersion: fingerprint.maxVersion });
      return {
        tls: { ...fingerprint, ecdhCurve },
        boundary: { runtime: { name: runtime, tlsShaping: "available" }, hybridGroup: attempt.hybrid, groups: attempt.groups, notExpressible: attempt.marked ? notExpressible : [...notExpressible, "keyShareGroups"] }
      };
    } catch {}
  }
  return {
    tls: { ...fingerprint, ecdhCurve: requested.filter((group) => !HYBRID_GROUPS.has(group)).join(":") },
    boundary: { runtime: { name: runtime, tlsShaping: "unavailable" }, hybridGroup: hybridRequested ? "unsupported" : "not-requested", groups: [], notExpressible: [...notExpressible, "groups"] }
  };
}
setTlsProbe(probeTlsMaterial);
export function createSecureContext(fingerprint) {
  const groups = groupsOf(fingerprint.ecdhCurve);
  const bun = runtimeName() === "bun";
  const ecdhCurve = bun ? groups.filter((group) => !group.startsWith("ffdhe")).join(":") : fingerprint.ecdhCurve.includes("*") ? fingerprint.ecdhCurve : groupStringFor(groups);
  return tls.createSecureContext({
    ciphers: bun ? fingerprint.ciphers.split(":").filter((name) => !name.startsWith("@")).join(":") : cipherStringFor(fingerprint),
    sigalgs: fingerprint.sigalgs,
    ecdhCurve,
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
