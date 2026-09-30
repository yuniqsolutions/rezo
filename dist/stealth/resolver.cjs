const { UAParser } = require("ua-parser-js");
const { getProfile, getProfilesByFamily, getRandomProfile, getRandomProfileByFamily, PROFILE_REGISTRY } = require('./profiles/index.cjs');
const { expandPseudoOrder, FAMILY_EXTRA_HEADERS, FAMILY_NAVIGATION_HEADERS } = require('./profiles/constants.cjs');
const { RezoError, RezoErrorCode } = require('../errors/rezo-error.cjs');
const universalProbe = (fingerprint) => ({
  tls: { ...fingerprint },
  boundary: { runtime: { name: typeof globalThis.window !== "undefined" ? "browser" : "unknown", tlsShaping: "unavailable" }, hybridGroup: "not-requested", groups: [], notExpressible: ["ciphers", "sigalgs", "groups", "clientHelloExtensionOrder", "grease", "padding"] }
});
let tlsProbe = universalProbe;
let rotationCounter = 0;
function setTlsProbe(probe) {
  tlsProbe = probe;
}
const DESKTOP_PLATFORMS = ["windows", "macos", "linux"];
const H2_SETTING_IDS = { headerTableSize: 1, enablePush: 2, maxConcurrentStreams: 3, initialWindowSize: 4, maxFrameSize: 5, maxHeaderListSize: 6 };
function h2SettingsOrderAscending(settings) {
  const ids = Object.keys(settings).filter((key) => (key in H2_SETTING_IDS) && settings[key] !== undefined).map((key) => H2_SETTING_IDS[key]);
  return ids.every((id, index) => index === 0 || ids[index - 1] < id);
}
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
function digestOf(material) {
  const text = JSON.stringify(material, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0;index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = hash * 0x100000001b3n & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
function resolveProfile(input) {
  let profile;
  let options = {};
  if (typeof input === "string") {
    const found = getProfile(input);
    if (!found)
      throw new Error(`Unknown browser profile: "${input}". Available: ${[...PROFILE_REGISTRY.keys()].join(", ")}`);
    profile = found;
  } else if ("id" in input && "tls" in input) {
    profile = input;
  } else {
    const opts = input;
    options = opts;
    if (opts.profile) {
      if (typeof opts.profile === "string") {
        const found = getProfile(opts.profile);
        if (!found)
          throw new Error(`Unknown browser profile: "${opts.profile}". Available: ${[...PROFILE_REGISTRY.keys()].join(", ")}`);
        profile = found;
      } else {
        profile = opts.profile;
      }
    } else if (opts.family) {
      profile = getRandomProfileByFamily(opts.family);
    } else {
      profile = getRandomProfile();
    }
  }
  profile = clone(profile);
  const requestedTls = options.tls ? { ...profile.tls, ...options.tls } : { ...profile.tls };
  const probed = tlsProbe(requestedTls);
  const tls = probed.tls;
  const tlsBoundary = probed.boundary;
  const h2Settings = options.h2Settings ? { ...profile.h2Settings, ...options.h2Settings } : { ...profile.h2Settings };
  if (!h2SettingsOrderAscending(h2Settings))
    tlsBoundary.notExpressible = [...tlsBoundary.notExpressible, "h2SettingsOrder"];
  const headerOrder = [...options.headerOrder ?? profile.headerOrder];
  const pseudoHeaderOrder = expandPseudoOrder(profile.pseudoHeaderOrder);
  const platform = options.platform ?? inferPlatformFromProfile(profile);
  const userAgent = profile.userAgents[platform];
  if (userAgent === undefined || !platformSupported(profile, platform)) {
    throw new RezoError(`Stealth profile "${profile.id}" has no identity for platform "${platform}" (available: ${supportedPlatforms(profile).join(", ")})`, {}, RezoErrorCode.STEALTH_PLATFORM_UNSUPPORTED);
  }
  const family = profile.family;
  const defaultHeaders = {
    "user-agent": userAgent,
    accept: profile.accept,
    "accept-encoding": profile.acceptEncoding,
    "accept-language": options.language ?? profile.acceptLanguage,
    ...FAMILY_NAVIGATION_HEADERS[family]
  };
  const platformHints = getPlatformHints(platform);
  if (profile.clientHints.secChUa) {
    defaultHeaders["sec-ch-ua"] = profile.clientHints.secChUa;
    defaultHeaders["sec-ch-ua-mobile"] = platformHints.mobile;
    defaultHeaders["sec-ch-ua-platform"] = platformHints.secChUaPlatform;
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers))
      defaultHeaders[key.toLowerCase()] = value;
  }
  const extraHeaders = clone(profile.extraHeaders ?? FAMILY_EXTRA_HEADERS[family] ?? {});
  const navigator = {
    ...profile.navigator,
    platform: platformHints.navigatorPlatform,
    maxTouchPoints: platformHints.maxTouchPoints
  };
  const materialDigest = digestOf({
    ciphers: tls.ciphers,
    sigalgs: tls.sigalgs,
    groups: tls.ecdhCurve,
    minVersion: tls.minVersion,
    maxVersion: tls.maxVersion,
    alpn: tls.alpnProtocols,
    h2Settings,
    pseudoHeaderOrder
  });
  const transportDigest = options.rotate ? `${materialDigest}:rotation-${(rotationCounter += 1).toString(36)}` : materialDigest;
  return {
    profile,
    profileId: profile.id,
    tls,
    h2Settings,
    headerOrder,
    pseudoHeaderOrder,
    defaultHeaders,
    extraHeaders,
    navigator,
    tlsBoundary,
    transportDigest
  };
}
function detectProfileFromUserAgent(userAgent) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  const browserName = result.browser.name?.toLowerCase() ?? "";
  const majorVersion = parseInt(result.browser.major ?? "0", 10);
  let family;
  if (browserName.includes("chrome") || browserName.includes("chromium")) {
    family = "chrome";
  } else if (browserName.includes("firefox")) {
    family = "firefox";
  } else if (browserName.includes("safari") && !browserName.includes("chrome")) {
    family = "safari";
  } else if (browserName.includes("edge") || browserName.includes("edg")) {
    family = "edge";
  } else if (browserName.includes("opera") || browserName.includes("opr")) {
    family = "opera";
  } else if (browserName.includes("brave")) {
    family = "brave";
  }
  if (!family)
    return;
  const familyProfiles = getProfilesByFamily(family);
  if (familyProfiles.length === 0)
    return;
  const exact = familyProfiles.find((p) => p.majorVersion === majorVersion);
  if (exact)
    return exact;
  let closest = familyProfiles[0];
  let closestDiff = Math.abs(closest.majorVersion - majorVersion);
  for (const p of familyProfiles) {
    const diff = Math.abs(p.majorVersion - majorVersion);
    if (diff < closestDiff || diff === closestDiff && p.majorVersion > closest.majorVersion) {
      closest = p;
      closestDiff = diff;
    }
  }
  return closest;
}
function supportedPlatforms(profile) {
  const shipped = Object.keys(profile.userAgents).filter((platform) => profile.userAgents[platform] !== undefined);
  return profile.family === "safari" ? shipped.filter((platform) => platform === "macos" || platform === "ios") : shipped;
}
const platformSupported = (profile, platform) => supportedPlatforms(profile).includes(platform);
function inferPlatformFromProfile(profile) {
  if (profile.device === "mobile") {
    if (profile.userAgents.android)
      return "android";
    if (profile.userAgents.ios)
      return "ios";
  }
  if (profile.family === "safari" && profile.device === "desktop") {
    return "macos";
  }
  return DESKTOP_PLATFORMS[Math.floor(Math.random() * DESKTOP_PLATFORMS.length)];
}
function getPlatformHints(platform) {
  switch (platform) {
    case "macos":
      return { secChUaPlatform: '"macOS"', mobile: "?0", navigatorPlatform: "MacIntel", maxTouchPoints: 0 };
    case "windows":
      return { secChUaPlatform: '"Windows"', mobile: "?0", navigatorPlatform: "Win32", maxTouchPoints: 0 };
    case "linux":
      return { secChUaPlatform: '"Linux"', mobile: "?0", navigatorPlatform: "Linux x86_64", maxTouchPoints: 0 };
    case "android":
      return { secChUaPlatform: '"Android"', mobile: "?1", navigatorPlatform: "Linux armv81", maxTouchPoints: 5 };
    case "ios":
      return { secChUaPlatform: '"iOS"', mobile: "?1", navigatorPlatform: "iPhone", maxTouchPoints: 5 };
    default:
      return { secChUaPlatform: '"Windows"', mobile: "?0", navigatorPlatform: "Win32", maxTouchPoints: 0 };
  }
}

exports.setTlsProbe = setTlsProbe;
exports.resolveProfile = resolveProfile;
exports.detectProfileFromUserAgent = detectProfileFromUserAgent;