<p align="center">
  <img src="https://raw.githubusercontent.com/yuniqsolutions/rezo/main/assets/logo.svg" alt="Rezo" width="300">
</p>

<p align="center">
  <strong>The last HTTP client you'll ever need.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/rezo"><img src="https://img.shields.io/npm/v/rezo?style=flat-square&color=3080ff" alt="npm"></a>
  <a href="https://www.npmjs.com/package/rezo"><img src="https://img.shields.io/npm/dm/rezo?style=flat-square&color=3080ff" alt="downloads"></a>
  <a href="https://github.com/yuniqsolutions/rezo/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/rezo?style=flat-square&color=3080ff" alt="license"></a>
  <a href="https://rezo-http.dev/docs"><img src="https://img.shields.io/badge/docs-rezo--http.dev-3080ff?style=flat-square" alt="docs"></a>
</p>

<p align="center">
  <a href="https://rezo-http.dev/docs">Documentation</a> &middot;
  <a href="https://rezo-http.dev/docs/getting-started/installation">Get Started</a> &middot;
  <a href="https://rezo-http.dev/docs/api/rezo-class">API Reference</a> &middot;
  <a href="https://rezo-http.dev/docs/switch/why-rezo">Why Rezo?</a>
</p>

---

Enterprise-grade HTTP client for Node.js 22+, Bun, Deno, browsers, React Native, and edge runtimes. One API everywhere.

## Install

```bash
npm install rezo
```

## Quick Example

```typescript
import rezo from 'rezo';

// Callable like fetch — but with auto-JSON, cookies, retries, and more
const { data } = await rezo('https://api.example.com/users');

// Or use named methods
const { data: user } = await rezo.postJson('https://api.example.com/users', {
  name: 'Ada Lovelace'
});

// Create configured instances
const client = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  retry: { limit: 3 }
});
```

## Highlights

<table>
<tr><td><strong>6 Adapters</strong></td><td>HTTP &middot; HTTP/2 &middot; cURL &middot; Fetch &middot; XHR &middot; React Native</td></tr>
<tr><td><strong>26 Hooks</strong></td><td>Full lifecycle — DNS, TLS, redirects, retries, cookies, proxies</td></tr>
<tr><td><strong>70+ Errors</strong></td><td>Structured codes with boolean flags and recovery suggestions</td></tr>
</table>

Cookie jar &middot; Proxy rotation (SOCKS4/5) &middot; Stealth mode (18 browser profiles) &middot; Web crawler &middot; Request queue &middot; Streaming &middot; Downloads &middot; Staged timeouts &middot; Response cache &middot; Site cloning &middot; TypeScript-first

## Documentation

Everything you need is at **[rezo-http.dev](https://rezo-http.dev/docs)**

## About This Repo

This repository contains the **compiled distribution** of Rezo, published to npm. The source code is maintained privately by [Yuniq Solutions Tech](https://yuniq.solutions).

## License

MIT — Made with care by [Yuniq Solutions Tech](https://yuniq.solutions). Built by developers, for developers.

<p align="center">
  <img src="https://raw.githubusercontent.com/yuniqsolutions/rezo/main/assets/icon.svg" alt="Rezo" width="40">
</p>
