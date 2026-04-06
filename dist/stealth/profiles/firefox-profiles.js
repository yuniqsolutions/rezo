import {
  firefoxTls,
  FIREFOX_H2,
  FIREFOX_ACCEPT,
  FIREFOX_HEADER_ORDER,
  FIREFOX_133_HEADER_ORDER
} from './constants.js';
const NO_HINTS = { secChUa: null, secChUaMobile: null, secChUaPlatform: null };
const NAV = { platform: "Win32", hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 };
export const FIREFOX_115 = {
  id: "firefox-115",
  family: "firefox",
  engine: "gecko",
  version: "115.0",
  majorVersion: 115,
  device: "desktop",
  tls: firefoxTls(115),
  h2Settings: FIREFOX_H2,
  pseudoHeaderOrder: "mpas",
  headerOrder: FIREFOX_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0"
  },
  accept: FIREFOX_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.5",
  clientHints: NO_HINTS,
  navigator: NAV
};
export const FIREFOX_121 = {
  id: "firefox-121",
  family: "firefox",
  engine: "gecko",
  version: "121.0",
  majorVersion: 121,
  device: "desktop",
  tls: firefoxTls(121),
  h2Settings: FIREFOX_H2,
  pseudoHeaderOrder: "mpas",
  headerOrder: FIREFOX_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
  },
  accept: FIREFOX_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.5",
  clientHints: NO_HINTS,
  navigator: NAV
};
export const FIREFOX_128 = {
  id: "firefox-128",
  family: "firefox",
  engine: "gecko",
  version: "128.0",
  majorVersion: 128,
  device: "desktop",
  tls: firefoxTls(128),
  h2Settings: FIREFOX_H2,
  pseudoHeaderOrder: "mpas",
  headerOrder: FIREFOX_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
  },
  accept: FIREFOX_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.5",
  clientHints: NO_HINTS,
  navigator: NAV
};
export const FIREFOX_133 = {
  id: "firefox-133",
  family: "firefox",
  engine: "gecko",
  version: "133.0",
  majorVersion: 133,
  device: "desktop",
  tls: firefoxTls(133),
  h2Settings: FIREFOX_H2,
  pseudoHeaderOrder: "mpas",
  headerOrder: FIREFOX_133_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"
  },
  accept: FIREFOX_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.5",
  clientHints: NO_HINTS,
  navigator: NAV
};
export const FIREFOX_PROFILES = {
  "firefox-115": FIREFOX_115,
  "firefox-121": FIREFOX_121,
  "firefox-128": FIREFOX_128,
  "firefox-133": FIREFOX_133
};
