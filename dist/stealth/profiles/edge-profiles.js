import { chromeTls, chromiumGreaseBrands, CHROME_H2, CHROME_ACCEPT, CHROME_HEADER_ORDER } from './constants.js';
const NAV = { platform: "Win32", hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 };
export const EDGE_120 = {
  id: "edge-120",
  family: "edge",
  engine: "blink",
  version: "120.0.2210.91",
  majorVersion: 120,
  device: "desktop",
  tls: chromeTls(120),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const EDGE_131 = {
  id: "edge-131",
  family: "edge",
  engine: "blink",
  version: "131.0.2903.70",
  majorVersion: 131,
  device: "desktop",
  tls: chromeTls(131),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const OPERA_115 = {
  id: "opera-115",
  family: "opera",
  engine: "blink",
  version: "115.0.5322.68",
  majorVersion: 115,
  device: "desktop",
  tls: chromeTls(131),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: '"Opera";v="115", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const BRAVE_1_73 = {
  id: "brave-1.73",
  family: "brave",
  engine: "blink",
  version: "1.73.97",
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
    secChUa: '"Brave";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const EDGE_151 = {
  id: "edge-151",
  family: "edge",
  engine: "blink",
  version: "151.0.4129.93",
  majorVersion: 151,
  device: "desktop",
  tls: chromeTls(151),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: chromiumGreaseBrands(151, "Microsoft Edge"),
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const OPERA_135 = {
  id: "opera-135",
  family: "opera",
  engine: "blink",
  version: "135.0.5973.55",
  majorVersion: 135,
  device: "desktop",
  tls: chromeTls(151),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: chromiumGreaseBrands(151, "Opera", 135),
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const BRAVE_1_93 = {
  id: "brave-1.93",
  family: "brave",
  engine: "blink",
  version: "1.93.136",
  majorVersion: 151,
  device: "desktop",
  tls: chromeTls(151),
  h2Settings: CHROME_H2,
  pseudoHeaderOrder: "masp",
  headerOrder: CHROME_HEADER_ORDER,
  userAgents: {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
  },
  accept: CHROME_ACCEPT,
  acceptEncoding: "gzip, deflate, br, zstd",
  acceptLanguage: "en-US,en;q=0.9",
  clientHints: {
    secChUa: chromiumGreaseBrands(151, "Brave"),
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"'
  },
  navigator: NAV
};
export const EDGE_PROFILES = {
  "edge-120": EDGE_120,
  "edge-131": EDGE_131,
  "edge-151": EDGE_151,
  "opera-115": OPERA_115,
  "opera-135": OPERA_135,
  "brave-1.73": BRAVE_1_73,
  "brave-1.93": BRAVE_1_93
};
