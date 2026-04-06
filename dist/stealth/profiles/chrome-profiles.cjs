const { chromeTls, CHROME_H2, CHROME_ACCEPT, CHROME_HEADER_ORDER } = require('./constants.cjs');
const NAV = { platform: "Win32", hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 };
const CHROME_120 = exports.CHROME_120 = {
  id: "chrome-120",
  family: "chrome",
  engine: "blink",
  version: "120.0.6099.109",
  majorVersion: 120,
  device: "desktop",
  tls: chromeTls(120),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
const CHROME_124 = exports.CHROME_124 = {
  id: "chrome-124",
  family: "chrome",
  engine: "blink",
  version: "124.0.6367.91",
  majorVersion: 124,
  device: "desktop",
  tls: chromeTls(124),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
const CHROME_128 = exports.CHROME_128 = {
  id: "chrome-128",
  family: "chrome",
  engine: "blink",
  version: "128.0.6613.84",
  majorVersion: 128,
  device: "desktop",
  tls: chromeTls(128),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
const CHROME_131 = exports.CHROME_131 = {
  id: "chrome-131",
  family: "chrome",
  engine: "blink",
  version: "131.0.6778.86",
  majorVersion: 131,
  device: "desktop",
  tls: chromeTls(131),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
const CHROME_131_ANDROID = exports.CHROME_131_ANDROID = {
  id: "chrome-131-android",
  family: "chrome",
  engine: "blink",
  version: "131.0.6778.200",
  majorVersion: 131,
  device: "mobile",
  tls: chromeTls(131),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"'
  },
  navigator: { platform: "Linux armv81", hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 5 }
};
const CHROME_PROFILES = exports.CHROME_PROFILES = {
  "chrome-120": CHROME_120,
  "chrome-124": CHROME_124,
  "chrome-128": CHROME_128,
  "chrome-131": CHROME_131,
  "chrome-131-android": CHROME_131_ANDROID
};
