const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const OPENSSL_FAMILY = new Set(["OpenSSL", "quictls"]);
const BACKEND_TOKEN = /^\(?(OpenSSL|quictls|LibreSSL|BoringSSL|AWS-LC|wolfSSL|GnuTLS|mbedTLS|Schannel|SecureTransport|rustls|bearssl)(?:\/([\w.+-]+))?\)?$/u;
const CURL_ROUTE_BOUNDARIES = Object.freeze([
  "sigalgs",
  "renegotiationScsv",
  "extensionOrder",
  "grease",
  "h2Settings",
  "h2ConnectionWindow",
  "h2PseudoHeaderOrder"
]);
function parseCurlTlsBackends(versionLine) {
  const backends = [];
  for (const token of versionLine.trim().split(/\s+/u)) {
    const match = token.match(BACKEND_TOKEN);
    if (match)
      backends.push({ name: match[1], version: match[2] ?? null });
  }
  return backends;
}
function splitCipherSuites(ciphers) {
  const tls12 = [];
  const tls13 = [];
  for (const suite of ciphers.split(":")) {
    if (!suite || suite.startsWith("@"))
      continue;
    (suite.startsWith("TLS_") ? tls13 : tls12).push(suite);
  }
  return { tls12, tls13 };
}
function supportsKeyShareMarkers(backend) {
  if (!backend || !OPENSSL_FAMILY.has(backend.name) || !backend.version)
    return false;
  const [major = 0, minor = 0] = backend.version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 3 || major === 3 && minor >= 5;
}
function stealthTlsArguments(profile, keyShareMarkers = false) {
  const { tls12, tls13 } = splitCipherSuites(profile.tls.ciphers);
  const args = [];
  args.push(profile.tls.minVersion === "TLSv1.3" ? "--tlsv1.3" : "--tlsv1.2");
  args.push("--tls-max", profile.tls.maxVersion === "TLSv1.2" ? "1.2" : "1.3");
  if (tls13.length > 0)
    args.push("--tls13-ciphers", tls13.join(":"));
  if (tls12.length > 0)
    args.push("--ciphers", tls12.join(":"));
  const groups = profile.tls.ecdhCurve.split(":").filter((group) => group.length > 0).map((group) => keyShareMarkers ? group : group.replace(/^\*/u, ""));
  if (groups.length > 0)
    args.push("--curves", groups.join(":"));
  return args;
}
const acceptanceByMaterial = new Map;
function probeCurlTlsAcceptance(tlsArgs, curlCommand = "curl") {
  const key = `${curlCommand} ${tlsArgs.join(" ")}`;
  let pending = acceptanceByMaterial.get(key);
  if (!pending) {
    pending = runAcceptanceProbe(tlsArgs, curlCommand);
    acceptanceByMaterial.set(key, pending);
    pending.catch(() => acceptanceByMaterial.delete(key));
  }
  return pending;
}
async function runAcceptanceProbe(tlsArgs, curlCommand) {
  const listener = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(curlCommand, ["-sS", "--max-time", "10", "-o", "/dev/null", ...tlsArgs, `https://127.0.0.1:${port}/`], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 59)
          resolve({ accepted: false, detail: stderr.trim().split(`
`).pop() ?? `curl exit ${code}` });
        else
          resolve({ accepted: true });
      });
    });
  } finally {
    await new Promise((resolve) => listener.close(() => resolve()));
  }
}
async function mapStealthProfileToCurl(profile, capabilities, curlCommand = "curl") {
  const reasons = [];
  if (capabilities.tlsBackends.length !== 1) {
    reasons.push(capabilities.tlsBackends.length === 0 ? `curl ${capabilities.curlVersion} names no TLS backend, so its cipher and group syntax is unknown` : `curl ${capabilities.curlVersion} is a MultiSSL build (${capabilities.tlsBackends.map((backend) => backend.name).join(", ")}); the active backend cannot be known from here`);
  } else if (!OPENSSL_FAMILY.has(capabilities.tlsBackends[0].name)) {
    reasons.push(`curl ${capabilities.curlVersion} uses ${capabilities.tlsBackends[0].name}, which does not take the profile's OpenSSL cipher and group lists`);
  }
  const wantsHttp2 = profile.tls.alpnProtocols.includes("h2");
  if (wantsHttp2 && !capabilities.http2)
    reasons.push(`profile offers h2 in ALPN but curl ${capabilities.curlVersion} was built without HTTP/2`);
  if (reasons.length > 0)
    return { ok: false, reasons };
  const tlsArgs = stealthTlsArguments(profile, supportsKeyShareMarkers(capabilities.tlsBackends[0]));
  const acceptance = await probeCurlTlsAcceptance(tlsArgs, curlCommand);
  if (!acceptance.accepted) {
    return { ok: false, reasons: [`curl ${capabilities.curlVersion} (${capabilities.tlsBackends[0].name}/${capabilities.tlsBackends[0].version ?? "?"}) rejects the profile's TLS material: ${acceptance.detail}`] };
  }
  return {
    ok: true,
    mapping: { tlsArgs, httpVersionArg: wantsHttp2 ? "--http2" : "--http1.1", useHttp2Headers: wantsHttp2, notExpressible: CURL_ROUTE_BOUNDARIES }
  };
}

exports.parseCurlTlsBackends = parseCurlTlsBackends;
exports.splitCipherSuites = splitCipherSuites;
exports.supportsKeyShareMarkers = supportsKeyShareMarkers;
exports.stealthTlsArguments = stealthTlsArguments;
exports.probeCurlTlsAcceptance = probeCurlTlsAcceptance;
exports.mapStealthProfileToCurl = mapStealthProfileToCurl;