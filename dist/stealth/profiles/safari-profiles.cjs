const { safariTls, SAFARI_H2, SAFARI_ACCEPT, SAFARI_HEADER_ORDER } = require('./constants.cjs');
const NO_HINTS = { secChUa: null, secChUaMobile: null, secChUaPlatform: null };
const NAV_MAC = { platform: "MacIntel", hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 };
const NAV_IOS = { platform: "iPhone", hardwareConcurrency: 6, deviceMemory: 4, maxTouchPoints: 5 };
const SAFARI_16_6 = exports.SAFARI_16_6 = {
  id: "safari-16.6",
  family: "safari",
  engine: "webkit",
  version: "16.6",
  majorVersion: 16,
  device: "desktop",
  tls: safariTls(),
  h2Settings: SAFARI_H2,
  pseudoHeaderOrder: "mspa",
  headerOrder: SAFARI_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15"
  },
  accept: SAFARI_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: NO_HINTS,
  navigator: NAV_MAC
};
const SAFARI_17_4 = exports.SAFARI_17_4 = {
  id: "safari-17.4",
  family: "safari",
  engine: "webkit",
  version: "17.4",
  majorVersion: 17,
  device: "desktop",
  tls: safariTls(),
  h2Settings: SAFARI_H2,
  pseudoHeaderOrder: "mspa",
  headerOrder: SAFARI_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
  },
  accept: SAFARI_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: NO_HINTS,
  navigator: NAV_MAC
};
const SAFARI_18_2 = exports.SAFARI_18_2 = {
  id: "safari-18.2",
  family: "safari",
  engine: "webkit",
  version: "18.2",
  majorVersion: 18,
  device: "desktop",
  tls: safariTls(),
  h2Settings: SAFARI_H2,
  pseudoHeaderOrder: "mspa",
  headerOrder: SAFARI_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"
  },
  accept: SAFARI_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: NO_HINTS,
  navigator: NAV_MAC
};
const SAFARI_17_IOS = exports.SAFARI_17_IOS = {
  id: "safari-17-ios",
  family: "safari",
  engine: "webkit",
  version: "17.0",
  majorVersion: 17,
  device: "mobile",
  tls: safariTls(),
  h2Settings: SAFARI_H2,
  pseudoHeaderOrder: "mspa",
  headerOrder: SAFARI_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  },
  accept: SAFARI_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: NO_HINTS,
  navigator: NAV_IOS
};
const SAFARI_18_IOS = exports.SAFARI_18_IOS = {
  id: "safari-18-ios",
  family: "safari",
  engine: "webkit",
  version: "18.0",
  majorVersion: 18,
  device: "mobile",
  tls: safariTls(),
  h2Settings: SAFARI_H2,
  pseudoHeaderOrder: "mspa",
  headerOrder: SAFARI_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  },
  accept: SAFARI_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: NO_HINTS,
  navigator: NAV_IOS
};
const SAFARI_PROFILES = exports.SAFARI_PROFILES = {
  "safari-16.6": SAFARI_16_6,
  "safari-17.4": SAFARI_17_4,
  "safari-18.2": SAFARI_18_2,
  "safari-17-ios": SAFARI_17_IOS,
  "safari-18-ios": SAFARI_18_IOS
};
