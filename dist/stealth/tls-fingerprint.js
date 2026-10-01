import { setTlsProbe } from './resolver.js';
import { contextFromTlsMaterial, groupsOf, HYBRID_GROUPS, selectTlsMaterial } from './tls-material.js';
const runtimeName = () => {
  const g = globalThis;
  if (typeof g.Bun !== "undefined")
    return "bun";
  if (typeof g.Deno !== "undefined")
    return "deno";
  return "node";
};
export function probeTlsMaterial(fingerprint) {
  const runtime = runtimeName();
  const requested = groupsOf(fingerprint.ecdhCurve);
  const hybridRequested = requested.some((group) => HYBRID_GROUPS.has(group));
  const notExpressible = ["clientHelloExtensionOrder", "grease", "padding"];
  const material = selectTlsMaterial(fingerprint);
  if (runtime === "bun") {
    return {
      tls: material.fingerprint,
      boundary: { runtime: { name: runtime, tlsShaping: "unavailable" }, hybridGroup: hybridRequested ? "unsupported" : "not-requested", groups: [], notExpressible: [...notExpressible, "ciphers", "sigalgs", "groups", "h1HeaderOrder"] }
    };
  }
  if (!material.marked)
    notExpressible.push("keyShareGroups");
  if (material.groups.length !== requested.length)
    notExpressible.push("groups");
  if (material.legacyLevelOmitted)
    notExpressible.push("securityLevel");
  return {
    tls: material.fingerprint,
    boundary: {
      runtime: { name: runtime, tlsShaping: "available" },
      hybridGroup: hybridRequested ? requested.filter((group) => HYBRID_GROUPS.has(group)).every((group) => material.groups.includes(group)) ? "supported" : "unsupported" : "not-requested",
      groups: material.groups,
      notExpressible
    }
  };
}
setTlsProbe(probeTlsMaterial);
export function createSecureContext(fingerprint) {
  return contextFromTlsMaterial(fingerprint);
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
