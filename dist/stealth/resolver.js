import { UAParser } from "ua-parser-js";
import { getProfile, getProfilesByFamily, getRandomProfile, getRandomProfileByFamily, PROFILE_REGISTRY } from './profiles/index.js';
import { expandPseudoOrder } from './profiles/constants.js';
export function resolveProfile(input) {
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
  const tls = options.tls ? { ...profile.tls, ...options.tls } : profile.tls;
  const h2Settings = options.h2Settings ? { ...profile.h2Settings, ...options.h2Settings } : profile.h2Settings;
  const headerOrder = options.headerOrder ?? profile.headerOrder;
  const pseudoHeaderOrder = expandPseudoOrder(profile.pseudoHeaderOrder);
  const platform = options.platform ?? inferPlatformFromProfile(profile);
  const userAgent = profile.userAgents[platform] ?? profile.userAgents.windows ?? profile.userAgents.macos;
  const defaultHeaders = {
    "user-agent": userAgent,
    accept: profile.accept,
    "accept-encoding": profile.acceptEncoding,
    "accept-language": options.language ?? profile.acceptLanguage,
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-user": "?1",
    "sec-fetch-dest": "document",
    "upgrade-insecure-requests": "1"
  };
  const platformHints = getPlatformHints(platform);
  if (profile.clientHints.secChUa) {
    defaultHeaders["sec-ch-ua"] = profile.clientHints.secChUa;
    defaultHeaders["sec-ch-ua-mobile"] = platformHints.mobile;
    defaultHeaders["sec-ch-ua-platform"] = platformHints.secChUaPlatform;
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      defaultHeaders[key.toLowerCase()] = value;
    }
  }
  const navigator = {
    ...profile.navigator,
    platform: platformHints.navigatorPlatform,
    maxTouchPoints: platformHints.maxTouchPoints
  };
  return {
    profile,
    profileId: profile.id,
    tls,
    h2Settings,
    headerOrder,
    pseudoHeaderOrder,
    defaultHeaders,
    navigator
  };
}
export function detectProfileFromUserAgent(userAgent) {
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
const DESKTOP_PLATFORMS = ["windows", "macos", "linux"];
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
