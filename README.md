<p align="center">
  <img src="https://raw.githubusercontent.com/yuniqsolutions/rezo/main/assets/logo.svg" alt="Rezo HTTP Client" width="400">
</p>

<h1 align="center">Rezo HTTP Client</h1>

<p align="center">
  <strong>Lightning-fast, enterprise-grade HTTP client for modern JavaScript</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#adapters">Adapters</a> •
  <a href="#advanced-usage">Advanced Usage</a> •
  <a href="#migration-guide">Migration</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/rezo?style=flat-square&color=00D4FF" alt="npm version">
  <img src="https://img.shields.io/npm/dm/rezo?style=flat-square&color=0099FF" alt="npm downloads">
  <img src="https://img.shields.io/bundlephobia/minzip/rezo?style=flat-square&color=0066CC" alt="bundle size">
  <img src="https://img.shields.io/npm/l/rezo?style=flat-square&color=00D4FF" alt="license">
  <img src="https://img.shields.io/node/v/rezo?style=flat-square&color=0099FF" alt="node version">
</p>

---

## Overview

Rezo is a production-ready HTTP client library engineered for Node.js 22+ and universal JavaScript runtimes. Built from the ground up with TypeScript, Rezo delivers exceptional performance, comprehensive feature coverage, and seamless cross-environment compatibility.

**Why Rezo?**

- **Lightning Fast**: Native HTTP/2 multiplexing, connection pooling, and optimized stream handling
- **Universal**: Works seamlessly across Node.js, Bun, Deno, browsers, React Native, and edge runtimes
- **Type-Safe**: First-class TypeScript support with comprehensive type definitions
- **Enterprise Ready**: Advanced cookie management, proxy support, retry logic, and error handling
- **Tree-Shakeable**: Modular architecture enables optimal bundle sizes
- **Production Proven**: Battle-tested in high-throughput enterprise applications

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [Adapters](#adapters)
  - [HTTP Adapter](#http-adapter)
  - [HTTP/2 Adapter](#http2-adapter)
  - [Fetch Adapter](#fetch-adapter)
  - [cURL Adapter](#curl-adapter)
  - [XHR Adapter](#xhr-adapter)
  - [React Native Adapter](#react-native-adapter)
- [API Reference](#api-reference)
  - [Request Methods](#request-methods)
  - [Request Configuration](#request-configuration)
  - [Response Schema](#response-schema)
  - [Instance Methods](#instance-methods)
- [Advanced Usage](#advanced-usage)
  - [Cookie Management](#cookie-management)
  - [Proxy Configuration](#proxy-configuration)
  - [Proxy Manager](#proxy-manager)
  - [Request Queue](#request-queue)
  - [Streaming](#streaming)
  - [File Downloads](#file-downloads)
  - [File Uploads](#file-uploads)
  - [Hooks & Interceptors](#hooks--interceptors)
  - [Retry Logic](#retry-logic)
  - [Error Handling](#error-handling)
  - [Performance Metrics](#performance-metrics)
- [Platform Support](#platform-support)
- [Migration Guide](#migration-guide)
- [TypeScript](#typescript)
- [Crawler Module](#crawler-module)
- [DOM Module](#dom-module)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Installation

### npm

```bash
npm install rezo
```

### Yarn

```bash
yarn add rezo
```

### pnpm

```bash
pnpm add rezo
```

### Bun

```bash
bun add rezo
```

### Requirements

- **Node.js**: 22.0.0 or higher
- **Bun**: 1.0.0 or higher
- **Deno**: 1.40.0 or higher (with Node.js compatibility)

---

## Quick Start

### Basic GET Request

```typescript
import rezo from 'rezo';

// Simple GET request with destructured response
const { data, status, headers } = await rezo.get('https://api.example.com/users');
console.log(data);        // Response body (auto-parsed JSON)
console.log(status);      // 200
console.log(headers);     // Response headers

// With query parameters
const { data: users } = await rezo.get('https://api.example.com/users', {
  params: { page: 1, limit: 10 }
});
console.log(users);
```

### POST Request with JSON

```typescript
import rezo from 'rezo';

// Destructure the response for cleaner code
const { data, status, headers, config } = await rezo.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

console.log(data);    // Created user object
console.log(status);  // 201
```

### Creating an Instance

```typescript
import rezo from 'rezo';

const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 30000,
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  }
});

// All requests will use the base configuration
const users = await api.get('/users');
const user = await api.post('/users', { name: 'Jane Doe' });
```

### CommonJS Usage

```javascript
const rezo = require('rezo').default;

// Using default instance
rezo.get('https://api.example.com/data')
  .then(response => console.log(response.data))
  .catch(error => console.error(error));

// Creating custom instance
const client = rezo.create({ baseURL: 'https://api.example.com' });
```

---

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **HTTP/1.1 & HTTP/2** | Full support for both protocols with automatic negotiation |
| **All HTTP Methods** | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE |
| **Request Body Types** | JSON, FormData, URLSearchParams, Streams, Buffers |
| **Response Types** | JSON, Text, ArrayBuffer, Blob, Streams |
| **Automatic Transforms** | JSON parsing, content-type detection, compression handling |
| **Query Parameters** | Automatic URL encoding and serialization |
| **Request Cancellation** | AbortController support for request cancellation |

### Network Features

| Feature | Description |
|---------|-------------|
| **Cookie Management** | RFC 6265 compliant cookie jar with persistence |
| **Proxy Support** | HTTP, HTTPS, SOCKS4, and SOCKS5 proxies |
| **TLS/SSL** | Custom certificates, client certs, certificate pinning |
| **Compression** | Automatic gzip, deflate, brotli, and zstd handling |
| **Connection Pooling** | Reusable connections for improved performance |
| **Keep-Alive** | Persistent connections with configurable timeouts |

### Enterprise Features

| Feature | Description |
|---------|-------------|
| **Retry Logic** | Configurable retry with exponential backoff |
| **Timeout Control** | Connection, request, and total timeout options |
| **Rate Limiting** | Built-in request queue with priority, concurrency, and domain-based rate limiting |
| **Hooks System** | Lifecycle hooks for request/response interception |
| **Error Handling** | Structured errors with actionable suggestions |
| **Performance Metrics** | Detailed timing data for monitoring |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **TypeScript First** | Comprehensive type definitions and generics |
| **Tree-Shakeable** | Modular exports for optimal bundle size |
| **Zero Config** | Works out of the box with sensible defaults |
| **Extensive Logging** | Debug mode for troubleshooting |
| **Cross-Platform** | Node.js, Bun, Deno, browsers, React Native, edge |

---

## Adapters

Rezo uses a pluggable adapter architecture, allowing you to choose the optimal HTTP implementation for your environment and requirements.

### Automatic Adapter Selection

By default, Rezo automatically selects the best adapter based on your runtime environment:

| Environment | Default Adapter |
|-------------|-----------------|
| Node.js | HTTP Adapter |
| Bun | HTTP Adapter |
| Deno | HTTP Adapter |
| Browser | Fetch Adapter |
| Cloudflare Workers | Fetch Adapter |
| React Native | React Native Adapter |

### HTTP Adapter

The full-featured adapter for Node.js environments with complete cookie, proxy, and streaming support.

```typescript
import rezo from 'rezo/adapters/http';

const response = await rezo.get('https://api.example.com/data');
```

**Features:**
- Full cookie jar support with persistence
- HTTP/HTTPS/SOCKS proxy support
- Streaming request and response bodies
- All compression algorithms
- Custom TLS configuration
- Connection keep-alive

### HTTP/2 Adapter

Native HTTP/2 support with session multiplexing for maximum performance.

```typescript
import rezo from 'rezo/adapters/http2';

const response = await rezo.get('https://api.example.com/data');
```

**Features:**
- HTTP/2 multiplexing (multiple requests over single connection)
- Automatic session pooling and reuse
- ALPN protocol negotiation
- Falls back to HTTP/1.1 when needed
- Server push support
- Header compression (HPACK)

### Fetch Adapter

Lightweight adapter using the native Fetch API, ideal for browsers and edge runtimes.

```typescript
import rezo from 'rezo/adapters/fetch';

const response = await rezo.get('https://api.example.com/data');
```

**Features:**
- Minimal bundle size
- Native browser support
- Edge runtime compatible (Cloudflare Workers, Vercel Edge)
- Streaming response bodies
- AbortController integration

### cURL Adapter

Advanced adapter wrapping the cURL command-line tool with **120+ configuration options** for maximum compatibility, debugging, and fine-grained control.

```typescript
import rezo from 'rezo/adapters/curl';

const response = await rezo.get('https://api.example.com/data', {
  curl: {
    connectTimeout: 10,
    limitRate: '500K',
    retry: { attempts: 3, allErrors: true },
    verbose: true
  }
});
```

**Features:**
- 120+ cURL command-line options via `curl` property
- HTTP/1.0, 1.1, 2.0, 3.0 protocol support
- Advanced authentication (Basic, Digest, NTLM, Negotiate, AWS SigV4, OAuth2)
- Comprehensive TLS/SSL configuration
- FTP, SSH, SMTP, and TFTP protocol support
- Connection pooling and reuse
- Detailed timing and debugging information
- Proxy authentication and chaining

**Important**: The `curl` property is **only available** when importing from `rezo/adapters/curl`. It does not appear in the base `RezoRequestConfig` type.

#### cURL Options Categories

The cURL adapter provides options across the following categories:

| Category | Example Options | Description |
|----------|----------------|-------------|
| **Connection** | `connectTimeout`, `maxTime`, `tcpFastOpen`, `tcpNodelay` | Connection timing and TCP settings |
| **Rate Limiting** | `limitRate`, `speedLimit`, `maxFilesize` | Bandwidth and transfer limits |
| **Retry** | `retry.attempts`, `retry.delay`, `retry.allErrors` | Automatic retry configuration |
| **Network** | `interface`, `localPort`, `ipVersion`, `resolve` | Network interface and routing |
| **HTTP** | `httpVersion`, `pathAsIs`, `maxRedirs`, `referer` | HTTP protocol settings |
| **TLS/SSL** | `tls.min`, `tls.ciphers`, `tls.cert`, `insecure` | Comprehensive TLS configuration |
| **Proxy** | `proxyHeaders`, `proxyTls`, `proxyTunnel` | Proxy-specific settings |
| **DNS** | `dns.servers`, `dns.dohUrl`, `dns.dohInsecure` | DNS resolution and DoH |
| **Authentication** | `negotiate`, `awsSigv4`, `oauth2Bearer`, `kerberos` | Advanced auth methods |
| **FTP** | `ftp.pasv`, `ftp.createDirs`, `ftp.method` | FTP protocol options |
| **SSH** | `ssh.privateKey`, `ssh.knownHosts`, `ssh.compression` | SSH/SCP/SFTP settings |
| **SMTP** | `smtp.mailFrom`, `smtp.mailRcpt` | Email sending configuration |
| **Debug** | `verbose`, `trace`, `traceTime`, `dumpHeader` | Debugging and tracing |

#### cURL Options Examples

##### Connection & Timeout

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://api.example.com/data', {
  curl: {
    connectTimeout: 10,        // 10 seconds for TCP connection
    maxTime: 300,              // 5 minutes max for entire request
    keepaliveTime: 60,         // Send keepalive after 60s idle
    tcpFastOpen: true,         // Enable TCP Fast Open
    tcpNodelay: true,          // Disable Nagle algorithm
    happyEyeballsTimeout: 200  // IPv6/IPv4 fallback timeout
  }
});
```

##### Rate Limiting & Bandwidth

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://example.com/large-file.zip', {
  curl: {
    limitRate: '1M',                        // Limit to 1 MB/s
    speedLimit: { limit: 1000, time: 30 },  // Abort if <1KB/s for 30s
    maxFilesize: 100 * 1024 * 1024          // Max 100MB response
  }
});
```

##### Retry Configuration

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://unreliable-api.com/data', {
  curl: {
    retry: {
      attempts: 5,        // Retry up to 5 times
      delay: 2,           // 2 seconds between retries
      maxTime: 60,        // Max 60 seconds total for retries
      allErrors: true,    // Retry on all errors (not just transient)
      connRefused: true   // Retry on connection refused
    }
  }
});
```

##### Custom DNS Resolution

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://api.example.com/data', {
  curl: {
    resolve: [
      { host: 'api.example.com', port: 443, address: '10.0.0.1' }
    ],
    dns: {
      servers: '8.8.8.8,8.8.4.4',
      dohUrl: 'https://dns.google/dns-query'
    }
  }
});
```

##### Comprehensive TLS Configuration

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://secure.example.com/api', {
  curl: {
    tls: {
      min: 'tlsv1.2',                                    // Minimum TLS 1.2
      tls13Ciphers: 'TLS_AES_256_GCM_SHA384',           // TLS 1.3 ciphers
      ciphers: 'ECDHE-RSA-AES256-GCM-SHA384',           // TLS 1.2 ciphers
      certStatus: true,                                  // OCSP stapling
      pinnedPubKey: 'sha256//base64hash=',              // Certificate pinning
      cert: '/path/to/client.crt',                      // Client certificate
      key: '/path/to/client.key',                       // Client key
      cacert: '/path/to/ca-bundle.crt'                  // CA certificate
    }
  }
});
```

##### Advanced Authentication

```typescript
import rezo from 'rezo/adapters/curl';

// AWS Signature Version 4
await rezo.get('https://s3.amazonaws.com/bucket/object', {
  curl: {
    awsSigv4: {
      provider: 'aws:amz',
      region: 'us-east-1',
      service: 's3'
    }
  }
});

// Kerberos/SPNEGO
await rezo.get('https://internal.company.com/api', {
  curl: {
    negotiate: true,
    delegation: 'policy'
  }
});

// OAuth 2.0 Bearer Token
await rezo.get('https://api.example.com/protected', {
  curl: {
    oauth2Bearer: 'your-access-token'
  }
});
```

##### FTP Operations

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('ftp://ftp.example.com/file.txt', {
  curl: {
    ftp: {
      pasv: true,
      createDirs: true,
      method: 'singlecwd',
      sslControl: true
    }
  }
});
```

##### SSH/SFTP Configuration

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('sftp://server.example.com/path/file.txt', {
  curl: {
    ssh: {
      privateKey: '/home/user/.ssh/id_rsa',
      publicKey: '/home/user/.ssh/id_rsa.pub',
      knownHosts: '/home/user/.ssh/known_hosts',
      compression: true
    }
  }
});
```

##### Debugging & Tracing

```typescript
import rezo from 'rezo/adapters/curl';

await rezo.get('https://api.example.com/debug', {
  curl: {
    verbose: true,                  // Show detailed output
    trace: '/tmp/curl-trace.log',   // Write full trace to file
    traceTime: true,                // Include timestamps
    dumpHeader: '/tmp/headers.txt'  // Dump headers to file
  }
});
```

#### CurlRequestConfig Type

When using the cURL adapter, the request configuration type extends the base with cURL-specific options:

```typescript
import rezo, { CurlRequestConfig } from 'rezo/adapters/curl';

const config: CurlRequestConfig = {
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: { 'Accept': 'application/json' },
  curl: {
    connectTimeout: 10,
    retry: { attempts: 3 }
  }
};

const response = await rezo.request(config);
```

#### Available cURL Option Types

The cURL adapter exports all option types for TypeScript users:

```typescript
import type {
  CurlOptions,
  CurlRequestConfig,
  CurlTlsOptions,
  CurlFtpOptions,
  CurlSshOptions,
  CurlSmtpOptions,
  CurlDnsOptions,
  CurlRetryOptions,
  CurlProxyTlsOptions,
  CurlResolveEntry,
  CurlConnectToEntry,
  CurlSpeedLimit,
  CurlParallelOptions,
  CurlHttpVersion,
  CurlSslVersion,
  CurlIpVersion,
  CurlAuthMethod,
  CurlDelegation
} from 'rezo/adapters/curl';
```

### XHR Adapter

Legacy browser support using XMLHttpRequest for maximum compatibility.

```typescript
import rezo from 'rezo/adapters/xhr';

const response = await rezo.get('https://api.example.com/data');
```

**Features:**
- Legacy browser support (IE11+)
- Upload progress events
- Download progress events
- Synchronous request option
- Cross-origin request handling

### React Native Adapter

Optimized adapter for React Native mobile applications.

```typescript
import rezo from 'rezo/adapters/react-native';

const response = await rezo.get('https://api.example.com/data');
```

**Features:**
- Optimized for mobile networks
- File download support (react-native-fs)
- Manual cookie header management
- Background fetch support
- Network state awareness

---

## API Reference

### Request Methods

Rezo provides convenient methods for all standard HTTP verbs:

```typescript
// GET request
rezo.get(url[, config])

// POST request
rezo.post(url[, data[, config]])

// PUT request
rezo.put(url[, data[, config]])

// PATCH request
rezo.patch(url[, data[, config]])

// DELETE request
rezo.delete(url[, config])

// HEAD request
rezo.head(url[, config])

// OPTIONS request
rezo.options(url[, config])

// Generic request
rezo.request(config)
```

### Convenience Methods

Rezo provides specialized methods for common content types:

```typescript
// JSON POST with automatic Content-Type header
rezo.postJson(url, data[, config])

// Form-encoded POST
rezo.postForm(url, data[, config])

// Multipart form data POST
rezo.postMultipart(url, data[, config])

// Same patterns available for PUT and PATCH
rezo.putJson(url, data[, config])
rezo.patchJson(url, data[, config])
```

### Request Configuration

```typescript
interface RezoConfig {
  // URL and Method
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  baseURL?: string;
  
  // Request Data
  params?: Record<string, any>;
  data?: any;
  headers?: RezoHeaders | Record<string, string>;
  
  // Timeouts (in milliseconds)
  timeout?: number;
  connectTimeout?: number;
  requestTimeout?: number;
  
  // Response Handling
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
  responseEncoding?: string;
  validateStatus?: (status: number) => boolean;
  maxContentLength?: number;
  maxBodyLength?: number;
  
  // Redirects
  maxRedirects?: number;
  followRedirect?: boolean;
  
  // Authentication
  auth?: {
    username: string;
    password: string;
  };
  
  // Proxy Configuration
  proxy?: {
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    host: string;
    port: number;
    auth?: {
      username: string;
      password: string;
    };
  };
  
  // TLS/SSL
  httpsAgent?: any;
  rejectUnauthorized?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  
  // Advanced
  decompress?: boolean;
  signal?: AbortSignal;
  onUploadProgress?: (progressEvent: ProgressEvent) => void;
  onDownloadProgress?: (progressEvent: ProgressEvent) => void;
  
  // Retry Configuration
  retry?: {
    limit?: number;
    delay?: number;
    maxDelay?: number;
    backoff?: number;
    retryOn?: number[] | ((error: Error, attempt: number) => boolean);
  };
  
  // Cookies
  jar?: CookieJar;
  withCredentials?: boolean;
}
```

### Response Schema

```typescript
interface RezoResponse<T = any> {
  // Response data (automatically parsed based on content-type)
  data: T;
  
  // HTTP status
  status: number;
  statusText: string;
  
  // Response headers (case-insensitive access)
  headers: RezoHeaders;
  
  // Request configuration used
  config: RezoConfig;
  
  // The request that generated this response
  request: any;
  
  // Timing metrics (when available)
  timing?: {
    start: number;
    dns: number;
    connect: number;
    tls: number;
    firstByte: number;
    download: number;
    total: number;
  };
}
```

### Instance Methods

```typescript
const instance = rezo.create(config);

// Request methods
instance.get(url, config?)
instance.post(url, data?, config?)
instance.put(url, data?, config?)
instance.patch(url, data?, config?)
instance.delete(url, config?)
instance.head(url, config?)
instance.options(url, config?)
instance.request(config)

// Instance configuration
instance.defaults  // Access default configuration
instance.getUri(config)  // Get the full URL

// Cookie management
instance.jar  // Access the cookie jar
instance.getCookies(url)
instance.setCookie(cookie, url)
instance.clearCookies()

// Hooks
instance.hooks.beforeRequest.push(handler)
instance.hooks.afterResponse.push(handler)
instance.hooks.beforeRetry.push(handler)
instance.hooks.beforeError.push(handler)
```

---

## Advanced Usage

### Cookie Management

Rezo provides RFC 6265 compliant cookie management with automatic persistence. The default instance already has a built-in cookie jar - no configuration required.

```typescript
import rezo from 'rezo';

// Cookies work automatically with the default instance
await rezo.post('https://api.example.com/login', { username: 'user', password: 'pass' });

// Subsequent requests automatically include session cookies
const profile = await rezo.get('https://api.example.com/profile');

// Access cookies directly from the default instance
const cookies = rezo.getCookies('https://api.example.com');
console.log(cookies);

// Set cookies manually
rezo.setCookie('custom=value; Path=/; HttpOnly', 'https://api.example.com');

// Clear all cookies
rezo.clearCookies();
```

#### Custom Cookie Jar (Optional)

Only create your own CookieJar if you need to manage cookies externally or use multiple isolated jars:

```typescript
import rezo, { CookieJar } from 'rezo';

// Custom jar for isolated cookie management
const myJar = new CookieJar();

const client = rezo.create({
  baseURL: 'https://api.example.com',
  jar: myJar
});

// Export cookies to different formats
const netscapeFormat = myJar.toNetscapeString();
const setCookieHeaders = myJar.toSetCookieStrings();
const jsonFormat = myJar.toJSON();
```

### Proxy Configuration

Rezo provides comprehensive proxy support for HTTP, HTTPS, SOCKS4, and SOCKS5 protocols, enabling secure and anonymous web requests through proxy servers.

#### Quick Usage (Per-Request)

You can use a proxy directly in any request without creating an instance:

```typescript
import rezo from 'rezo';

// Use proxy for a single request
const response = await rezo.get('https://api.example.com/data', {
  proxy: {
    protocol: 'http',
    host: 'proxy.example.com',
    port: 8080
  }
});
```

#### Proxy Protocols

| Protocol | Description | Use Case |
|----------|-------------|----------|
| `http` | HTTP proxy (CONNECT method for HTTPS targets) | General-purpose web proxy |
| `https` | HTTPS proxy (encrypted proxy connection) | Secure corporate proxies |
| `socks4` | SOCKS4 proxy (TCP connections only) | Legacy proxy servers |
| `socks5` | SOCKS5 proxy (TCP + UDP, authentication) | Anonymous browsing, Tor |

#### Basic HTTP Proxy

```typescript
import rezo from 'rezo';

// HTTP Proxy - routes all traffic through the proxy
const client = rezo.create({
  proxy: {
    protocol: 'http',
    host: 'proxy.example.com',
    port: 8080
  }
});

const response = await client.get('https://api.example.com/data');
```

#### HTTPS Proxy

```typescript
import rezo from 'rezo';

// HTTPS Proxy - encrypted connection to proxy server
const client = rezo.create({
  proxy: {
    protocol: 'https',
    host: 'secure-proxy.example.com',
    port: 443
  }
});
```

#### Authenticated Proxy

```typescript
import rezo from 'rezo';

// Proxy with username/password authentication
const client = rezo.create({
  proxy: {
    protocol: 'http',
    host: 'proxy.example.com',
    port: 8080,
    auth: {
      username: 'proxyuser',
      password: 'proxypass'
    }
  }
});
```

#### SOCKS4 Proxy

```typescript
import rezo from 'rezo';

// SOCKS4 Proxy - TCP connections only, no authentication
const client = rezo.create({
  proxy: {
    protocol: 'socks4',
    host: 'socks4.example.com',
    port: 1080
  }
});
```

#### SOCKS5 Proxy

```typescript
import rezo from 'rezo';

// SOCKS5 Proxy - supports TCP, UDP, and authentication
const client = rezo.create({
  proxy: {
    protocol: 'socks5',
    host: 'socks5.example.com',
    port: 1080
  }
});

// SOCKS5 with authentication
const authenticatedSocks = rezo.create({
  proxy: {
    protocol: 'socks5',
    host: 'socks5.example.com',
    port: 1080,
    auth: {
      username: 'socksuser',
      password: 'sockspass'
    }
  }
});

// Using Tor network (typically SOCKS5 on port 9050)
const torClient = rezo.create({
  proxy: {
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 9050
  }
});
```

#### Per-Request Proxy Override

```typescript
import rezo from 'rezo';

const client = rezo.create({
  proxy: {
    protocol: 'http',
    host: 'default-proxy.example.com',
    port: 8080
  }
});

// Use a different proxy for this specific request
await client.get('https://api.example.com/data', {
  proxy: {
    protocol: 'https',
    host: 'different-proxy.example.com',
    port: 443
  }
});

// Disable proxy for specific request (direct connection)
await client.get('https://internal.example.com/data', {
  proxy: false
});
```

#### Proxy Configuration Interface

```typescript
interface ProxyConfig {
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
}
```

### Proxy Manager

Rezo includes a powerful Proxy Manager for enterprise scenarios requiring proxy rotation, health monitoring, and intelligent failover. The Proxy Manager automatically rotates through a pool of proxies, tracks their health, and removes failing proxies from circulation.

#### Basic Usage

```typescript
import rezo, { ProxyManager } from 'rezo';

// Create a proxy manager with a pool of proxies
const proxyManager = new ProxyManager({
  proxies: [
    { protocol: 'http', host: 'proxy1.example.com', port: 8080 },
    { protocol: 'http', host: 'proxy2.example.com', port: 8080 },
    { protocol: 'socks5', host: 'proxy3.example.com', port: 1080 }
  ]
});

// Create client with proxy manager
const client = rezo.create({
  proxyManager
});

// Requests automatically rotate through available proxies
await client.get('https://api.example.com/data');
```

#### Rotation Strategies

```typescript
import { ProxyManager } from 'rezo';

// Random rotation (default) - randomly selects from available proxies
const randomManager = new ProxyManager({
  proxies: [...],
  rotationStrategy: 'random'
});

// Sequential rotation - cycles through proxies in order
const sequentialManager = new ProxyManager({
  proxies: [...],
  rotationStrategy: 'sequential'
});

// Per-proxy limit - switches after N requests per proxy
const limitManager = new ProxyManager({
  proxies: [...],
  rotationStrategy: 'per-proxy-limit',
  perProxyLimit: 100  // Switch after 100 requests
});
```

#### URL Filtering (Whitelist/Blacklist)

Control which URLs use the proxy manager with glob patterns or regular expressions:

```typescript
import { ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({
  proxies: [...],
  
  // Only use proxies for these URL patterns (glob or regex)
  whitelist: [
    '*.example.com',           // Glob pattern
    'https://api.service.io/*',
    /^https:\/\/secure\./      // Regex pattern
  ],
  
  // Never use proxies for these URLs
  blacklist: [
    '*.internal.company.com',
    'https://localhost/*'
  ]
});

const client = rezo.create({ proxyManager });

// Uses proxy (matches whitelist)
await client.get('https://api.example.com/data');

// Direct connection (matches blacklist)
await client.get('https://app.internal.company.com/status');
```

#### Health Monitoring & Failover

The Proxy Manager automatically tracks proxy health and removes failing proxies:

```typescript
import { ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({
  proxies: [...],
  
  // Mark proxy as dead after 5 consecutive failures
  maxFailures: 5,
  
  // Re-enable dead proxies after 5 minutes cooldown
  cooldownPeriod: 5 * 60 * 1000,
  
  // Fail request if no proxies available (vs direct connection)
  failWithoutProxy: true
});

// Check proxy pool status
const status = proxyManager.getStatus();
console.log('Active proxies:', status.active);
console.log('Disabled proxies:', status.disabled);
console.log('Total proxies:', status.total);

// Check if proxies are available
if (proxyManager.hasAvailableProxies()) {
  await client.get('https://api.example.com/data');
}

// Reset all proxy states (re-enable all)
proxyManager.reset();
```

#### Lifecycle Hooks

Monitor and react to proxy events with lifecycle hooks:

```typescript
import { ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({
  proxies: [...],
  
  hooks: {
    // Called before selecting a proxy
    beforeProxySelect: (url) => {
      console.log('Selecting proxy for:', url);
    },
    
    // Called after proxy selection
    afterProxySelect: (proxy, url) => {
      console.log('Selected:', proxy.host);
    },
    
    // Called before reporting a proxy error
    beforeProxyError: (proxy, error) => {
      console.log('Proxy failed:', proxy.host, error.message);
    },
    
    // Called after error is recorded
    afterProxyError: (proxy, error, failureCount) => {
      console.log('Failure count:', failureCount);
    },
    
    // Called when proxy is disabled
    afterProxyDisable: (proxy, reason) => {
      console.log('Proxy disabled:', proxy.host, reason);
    },
    
    // Called when proxy is re-enabled
    afterProxyEnable: (proxy) => {
      console.log('Proxy re-enabled:', proxy.host);
    },
    
    // Called after rotation occurs
    afterProxyRotate: (oldProxy, newProxy) => {
      console.log('Rotated from', oldProxy?.host, 'to', newProxy.host);
    }
  }
});
```

#### Instance-Level Hooks

You can also add proxy hooks at the instance level:

```typescript
import rezo, { ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({ proxies: [...] });

const client = rezo.create({
  proxyManager,
  hooks: {
    afterProxySelect: (proxy, url) => {
      console.log('Request will use proxy:', proxy.host);
    },
    afterProxyDisable: (proxy) => {
      // Alert monitoring system
      alertMonitoring('Proxy disabled', proxy.host);
    }
  }
});
```

#### Manual Proxy Control

Override Proxy Manager for specific requests:

```typescript
import rezo, { ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({ proxies: [...] });
const client = rezo.create({ proxyManager });

// Use a specific proxy (bypasses Proxy Manager)
await client.get('https://api.example.com/data', {
  proxy: {
    protocol: 'http',
    host: 'specific-proxy.example.com',
    port: 8080
  }
});

// Direct connection (bypasses Proxy Manager)
await client.get('https://api.example.com/data', {
  useProxyManager: false
});
```

#### Proxy Manager Configuration

```typescript
interface ProxyManagerConfig {
  // Array of proxy configurations
  proxies: ProxyConfig[];
  
  // Rotation strategy: 'random' | 'sequential' | 'per-proxy-limit'
  rotationStrategy?: string;
  
  // Requests per proxy before rotation (for 'per-proxy-limit')
  perProxyLimit?: number;
  
  // URL patterns to use with proxies (glob or regex)
  whitelist?: (string | RegExp)[];
  
  // URL patterns to bypass proxies (glob or regex)
  blacklist?: (string | RegExp)[];
  
  // Consecutive failures before disabling proxy
  maxFailures?: number;
  
  // Milliseconds before re-enabling disabled proxy
  cooldownPeriod?: number;
  
  // Throw error if no proxy available (vs direct connection)
  failWithoutProxy?: boolean;
  
  // Lifecycle hooks
  hooks?: ProxyManagerHooks;
}
```

#### Adapter Support

| Adapter | Proxy Manager Support |
|---------|----------------------|
| HTTP | Full support |
| HTTP/2 | Full support |
| cURL | Full support |
| Fetch | Not supported (browser security) |
| React Native | Not supported (platform limitations) |

### Request Queue

Rezo includes a built-in zero-dependency request queue system for rate limiting, priority management, and concurrency control.

#### RezoQueue - General Purpose Queue

```typescript
import { RezoQueue, Priority } from 'rezo';

const queue = new RezoQueue({
  concurrency: 5,           // Max concurrent tasks
  interval: 1000,           // Rate limit interval (ms)
  intervalCap: 10,          // Max tasks per interval
  timeout: 30000,           // Task timeout (ms)
  autoStart: true           // Start processing immediately
});

// Add tasks with priority
queue.add(async () => {
  return await fetch('https://api.example.com/data');
}, { priority: Priority.HIGH });

// Priority constants: LOWEST (0), LOW (25), NORMAL (50), HIGH (75), HIGHEST (100), CRITICAL (1000)

// Event handling
queue.on('completed', ({ id, result, duration }) => {
  console.log(`Task ${id} completed in ${duration}ms`);
});

queue.on('error', ({ id, error }) => {
  console.error(`Task ${id} failed:`, error);
});

// Queue control
queue.pause();
queue.resume();
queue.cancel(taskId);
queue.clear();

// Statistics
const stats = queue.stats();
console.log(`Completed: ${stats.completed}, Failed: ${stats.failed}`);
```

#### HttpQueue - HTTP-Aware Queue

```typescript
import { HttpQueue, HttpMethodPriority } from 'rezo';

const httpQueue = new HttpQueue({
  concurrency: 10,
  perDomainConcurrency: 2,   // Limit concurrent requests per domain
  retryOnRateLimit: true,     // Auto-retry on 429 responses
  maxRetries: 3,
  retryDelay: 1000
});

// Add HTTP requests
const result = await httpQueue.addHttp(
  'https://api.example.com/users',
  async () => fetch('https://api.example.com/users'),
  { 
    priority: HttpMethodPriority.GET,  // GET=75, POST=50, DELETE=25
    timeout: 10000
  }
);

// Domain-specific control
httpQueue.pauseDomain('api.example.com');
httpQueue.resumeDomain('api.example.com');

// Rate limit handling
httpQueue.onHttp('rateLimited', ({ domain, retryAfter }) => {
  console.log(`Rate limited on ${domain}, retry in ${retryAfter}s`);
});

// Per-domain statistics
const domainStats = httpQueue.httpStats();
console.log(domainStats.byDomain['api.example.com']);
```

#### Queue Events

| Event | Description |
|-------|-------------|
| `add` | Task added to queue |
| `start` | Task started processing |
| `completed` | Task completed successfully |
| `error` | Task failed with error |
| `timeout` | Task timed out |
| `cancelled` | Task was cancelled |
| `active` | Queue became active |
| `idle` | Queue became idle |
| `empty` | Queue is empty |
| `rateLimited` | Rate limit detected (HttpQueue) |
| `retry` | Task being retried (HttpQueue) |

### Streaming

Rezo provides powerful streaming capabilities for handling large data efficiently.

```typescript
import rezo from 'rezo';
import { createWriteStream } from 'fs';

const client = rezo.create();

// Stream response to file
const response = await client.get('https://example.com/large-file.zip', {
  responseType: 'stream'
});

const writer = createWriteStream('./download.zip');
response.data.pipe(writer);

await new Promise((resolve, reject) => {
  writer.on('finish', resolve);
  writer.on('error', reject);
});

// Stream request body
import { createReadStream } from 'fs';

await client.post('https://api.example.com/upload', createReadStream('./file.txt'), {
  headers: {
    'Content-Type': 'application/octet-stream'
  }
});
```

### File Downloads

Rezo provides a dedicated download API with progress tracking.

```typescript
import rezo, { DownloadResponse } from 'rezo';

const client = rezo.create();

// Download with progress
const download = await client.download('https://example.com/file.zip', {
  outputPath: './downloads/file.zip'
});

download.on('progress', (progress) => {
  console.log(`Downloaded: ${progress.percent}%`);
  console.log(`Speed: ${progress.speed} bytes/sec`);
  console.log(`ETA: ${progress.eta} seconds`);
});

download.on('complete', (result) => {
  console.log('Download complete:', result.path);
  console.log('Total size:', result.size);
  console.log('Duration:', result.duration);
});

download.on('error', (error) => {
  console.error('Download failed:', error.message);
});

// Wait for completion
await download.finished();
```

### File Uploads

Upload files with progress tracking and multipart support.

```typescript
import rezo, { FormData } from 'rezo';
import { createReadStream } from 'fs';

const client = rezo.create();

// Simple file upload
const formData = new FormData();
formData.append('file', createReadStream('./document.pdf'));
formData.append('name', 'My Document');

const response = await client.post('https://api.example.com/upload', formData, {
  onUploadProgress: (progress) => {
    console.log(`Uploaded: ${Math.round(progress.loaded / progress.total * 100)}%`);
  }
});

// Upload with detailed progress
const upload = await client.upload('https://api.example.com/upload', {
  file: createReadStream('./large-file.zip'),
  filename: 'archive.zip'
});

upload.on('progress', (progress) => {
  console.log(`Uploaded: ${progress.percent}%`);
});

await upload.finished();
console.log('Upload complete:', upload.response.data);
```

### Hooks & Interceptors

Rezo provides a powerful hooks system for request/response interception.

```typescript
import rezo from 'rezo';

const client = rezo.create({
  baseURL: 'https://api.example.com'
});

// Before request hook
client.hooks.beforeRequest.push((options) => {
  // Add timestamp to all requests
  options.headers['X-Request-Time'] = Date.now().toString();
  
  // Log outgoing requests
  console.log(`-> ${options.method} ${options.url}`);
  
  return options;
});

// After response hook
client.hooks.afterResponse.push((response, options) => {
  // Log responses
  console.log(`<- ${response.status} ${options.url}`);
  
  // Transform response data
  if (response.data && typeof response.data === 'object') {
    response.data._receivedAt = new Date().toISOString();
  }
  
  return response;
});

// Before retry hook
client.hooks.beforeRetry.push((error, retryCount) => {
  console.log(`Retry attempt ${retryCount} for ${error.config.url}`);
  
  // Optionally modify the request before retry
  error.config.headers['X-Retry-Count'] = retryCount.toString();
});

// Before error hook (transform errors)
client.hooks.beforeError.push((error) => {
  // Add additional context to errors
  error.timestamp = new Date().toISOString();
  error.requestId = error.config?.headers?.['X-Request-ID'];
  
  return error;
});

// Authentication refresh example
client.hooks.afterResponse.push(async (response, options, client) => {
  if (response.status === 401 && !options._retry) {
    // Refresh token
    const refreshResponse = await client.post('/auth/refresh', {
      refreshToken: getRefreshToken()
    });
    
    // Update authorization header
    const newToken = refreshResponse.data.accessToken;
    client.defaults.headers['Authorization'] = `Bearer ${newToken}`;
    
    // Retry original request
    options._retry = true;
    return client.request(options);
  }
  
  return response;
});
```

### Retry Logic

Configure automatic retry with exponential backoff.

```typescript
import rezo from 'rezo';

const client = rezo.create({
  retry: {
    limit: 3,           // Maximum retry attempts
    delay: 1000,        // Initial delay (ms)
    maxDelay: 30000,    // Maximum delay (ms)
    backoff: 2,         // Exponential backoff multiplier
    retryOn: [408, 429, 500, 502, 503, 504]  // Status codes to retry
  }
});

// Custom retry logic
const customClient = rezo.create({
  retry: {
    limit: 5,
    retryOn: (error, attemptNumber) => {
      // Retry on network errors
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        return true;
      }
      
      // Retry on specific status codes
      if (error.response?.status >= 500) {
        return true;
      }
      
      // Don't retry on 4xx errors (except 429)
      if (error.response?.status === 429) {
        return true;
      }
      
      return false;
    }
  }
});

// Per-request retry configuration
await client.get('https://api.example.com/data', {
  retry: {
    limit: 10,
    delay: 500
  }
});

// Disable retry for specific request
await client.get('https://api.example.com/critical', {
  retry: false
});
```

### Error Handling

Rezo provides structured errors with actionable information.

```typescript
import rezo, { RezoError, isRezoError, RezoErrorCode } from 'rezo';

const client = rezo.create();

try {
  await client.get('https://api.example.com/data');
} catch (error) {
  if (isRezoError(error)) {
    // Access structured error information
    console.log('Error Code:', error.code);
    console.log('Message:', error.message);
    console.log('Details:', error.details);
    console.log('Suggestion:', error.suggestion);
    
    // Check error type
    if (error.isTimeout) {
      console.log('Request timed out');
    }
    
    if (error.isNetworkError) {
      console.log('Network error occurred');
    }
    
    if (error.isHttpError) {
      console.log('HTTP error:', error.status, error.statusText);
      console.log('Response data:', error.response?.data);
    }
    
    if (error.isProxyError) {
      console.log('Proxy connection failed');
    }
    
    if (error.isTlsError) {
      console.log('TLS/SSL error');
    }
    
    // Check if error is retryable
    if (error.isRetryable) {
      console.log('This error can be retried');
    }
    
    // Access original request configuration
    console.log('Request URL:', error.config?.url);
    console.log('Request Method:', error.config?.method);
    
    // Serialize error (hides sensitive data)
    console.log('Error JSON:', JSON.stringify(error));
  }
}

// Error code enumeration
switch (error.code) {
  case RezoErrorCode.TIMEOUT:
    // Handle timeout
    break;
  case RezoErrorCode.NETWORK_ERROR:
    // Handle network error
    break;
  case RezoErrorCode.PROXY_ERROR:
    // Handle proxy error
    break;
  case RezoErrorCode.TLS_ERROR:
    // Handle TLS error
    break;
  case RezoErrorCode.HTTP_ERROR:
    // Handle HTTP error
    break;
}
```

### Performance Metrics

Track detailed timing information for performance monitoring.

```typescript
import rezo, { RezoPerformance } from 'rezo';

const client = rezo.create({
  timing: true  // Enable timing collection
});

const response = await client.get('https://api.example.com/data');

// Access timing metrics
const timing = response.timing;
console.log('DNS Lookup:', timing.dns, 'ms');
console.log('TCP Connect:', timing.connect, 'ms');
console.log('TLS Handshake:', timing.tls, 'ms');
console.log('Time to First Byte:', timing.firstByte, 'ms');
console.log('Download Time:', timing.download, 'ms');
console.log('Total Time:', timing.total, 'ms');

// Using RezoPerformance utility
const perf = new RezoPerformance();

perf.mark('start');
await client.get('https://api.example.com/data');
perf.mark('end');

const metrics = perf.measure('request', 'start', 'end');
console.log('Request Duration:', metrics.duration, 'ms');
```

---

## Platform Support

Rezo is designed for universal JavaScript environments with platform-specific optimizations.

### Node.js

Full feature support including all adapters, cookie management, proxy, and streaming.

```typescript
import rezo from 'rezo';
// or
import rezo from 'rezo/platform/node';
```

### Bun

Optimized for Bun runtime with native performance.

```typescript
import rezo from 'rezo';
// or
import rezo from 'rezo/platform/bun';
```

### Deno

Compatible with Deno's Node.js compatibility layer.

```typescript
import rezo from 'npm:rezo';
// or
import rezo from 'npm:rezo/platform/deno';
```

### Browser

Lightweight Fetch-based implementation for browsers.

```typescript
import rezo from 'rezo';
// or
import rezo from 'rezo/platform/browser';
```

### Cloudflare Workers & Edge Runtimes

Edge-compatible Fetch adapter with minimal footprint.

```typescript
import rezo from 'rezo';
// or
import rezo from 'rezo/platform/worker';
```

### React Native

Mobile-optimized adapter with file system integration.

```typescript
import rezo from 'rezo';
// or
import rezo from 'rezo/platform/react-native';
```

---

## Migration Guide

### Migrating from Fetch API

```typescript
// Before (Fetch)
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John' })
});
const data = await response.json();

// After (Rezo)
const response = await rezo.post('https://api.example.com/data', {
  name: 'John'
});
const data = response.data;  // Automatically parsed
```

### Migrating from Got

```typescript
// Before (Got)
import got from 'got';
const response = await got.post('https://api.example.com/data', {
  json: { name: 'John' },
  responseType: 'json',
  retry: { limit: 3 }
});

// After (Rezo)
import rezo from 'rezo';
const response = await rezo.post('https://api.example.com/data', 
  { name: 'John' },
  { retry: { limit: 3 } }
);
```

### Migrating from Node-Fetch

```typescript
// Before (node-fetch)
import fetch from 'node-fetch';
const response = await fetch('https://api.example.com/data');
const data = await response.json();

// After (Rezo)
import rezo from 'rezo';
const { data } = await rezo.get('https://api.example.com/data');
```

---

## TypeScript

Rezo is written in TypeScript and provides comprehensive type definitions.

### Generic Response Types

```typescript
import rezo from 'rezo';

interface User {
  id: number;
  name: string;
  email: string;
}

interface ApiResponse<T> {
  data: T;
  meta: { total: number; page: number };
}

const client = rezo.create({ baseURL: 'https://api.example.com' });

// Typed response
const response = await client.get<User>('/users/1');
const user: User = response.data;

// Nested generic types
const listResponse = await client.get<ApiResponse<User[]>>('/users');
const users: User[] = listResponse.data.data;
const total: number = listResponse.data.meta.total;
```

### Request Configuration Types

```typescript
import { RezoConfig, RezoResponse, RezoError } from 'rezo';

// Type-safe configuration
const config: RezoConfig = {
  baseURL: 'https://api.example.com',
  timeout: 30000,
  headers: {
    'Authorization': 'Bearer token'
  }
};

// Type-safe error handling
function handleError(error: RezoError): void {
  if (error.isHttpError) {
    console.log('Status:', error.status);
  }
}
```

### Custom Type Guards

```typescript
import { isRezoError, RezoError } from 'rezo';

try {
  await rezo.get('/data');
} catch (error) {
  if (isRezoError(error)) {
    // TypeScript knows error is RezoError here
    console.log(error.code);
    console.log(error.details);
  }
}
```

---

## Crawler Module

Rezo includes a powerful web crawler module for web scraping scenarios.

```typescript
import { Crawler, CrawlerOptions } from 'rezo/crawler';

const options = new CrawlerOptions()
  .setGlobalProxy({ host: 'proxy.example.com', port: 8080 })
  .setGlobalHeaders({ 'User-Agent': 'Mozilla/5.0...' })
  .addLimiter({ domain: 'example.com', concurrency: 2, interval: 1000 });

const crawler = new Crawler(options);

crawler.onDocument(async (doc, url) => {
  const title = doc.querySelector('title')?.textContent;
  console.log(`Title: ${title}`);
});

crawler.onAnchor((href, anchor) => {
  console.log(`Found link: ${href}`);
});

await crawler.crawl('https://example.com');
```

---

## DOM Module

Rezo provides a lightweight DOM parsing module for server-side HTML manipulation. Built on [linkedom](https://github.com/WebReflection/linkedom), it enables fast, standards-compliant DOM operations in Node, Bun, Deno or Edge environments - perfect for web scraping, HTML transformation, and testing.

### Parsing HTML

```typescript
import { parseHTML } from 'rezo/dom';

// Parse HTML and work with the document
const { document, window } = parseHTML(`
  <html>
    <body>
      <h1>Hello World</h1>
      <ul id="items">
        <li>Item 1</li>
        <li>Item 2</li>
      </ul>
    </body>
  </html>
`);

// Use familiar DOM APIs
console.log(document.querySelector('h1')?.textContent); // 'Hello World'
console.log(document.querySelectorAll('li').length);    // 2
```

### Using with Rezo HTTP Client

```typescript
import rezo from 'rezo';
import { parseHTML } from 'rezo/dom';

// Fetch and parse a webpage
const { data: html } = await rezo.get('https://example.com');
const { document } = parseHTML(html);

// Extract data from the page
const title = document.querySelector('title')?.textContent;
const links = [...document.querySelectorAll('a')].map(a => a.getAttribute('href'));
```

### DOMParser Interface

```typescript
import { DOMParser } from 'rezo/dom';

const parser = new DOMParser();
const doc = parser.parseFromString('<div class="content">Text</div>', 'text/html');
console.log(doc.querySelector('.content')?.textContent); // 'Text'
```

### Available APIs

| Export | Description |
|--------|-------------|
| `parseHTML` | Parse HTML string into window/document objects |
| `DOMParser` | Standard W3C DOMParser interface |
| `Document` | Document constructor for creating new documents |
| `Event` / `CustomEvent` | DOM Event interfaces |
| `EventTarget` | Event handling interface |
| `NodeList` | Standard NodeList interface |

---

## Troubleshooting

### Common Issues

#### Request Timeout

```typescript
// Increase timeout
const client = rezo.create({
  timeout: 60000,  // 60 seconds
  connectTimeout: 10000  // 10 seconds for connection
});
```

#### SSL Certificate Errors

```typescript
// For development only - not recommended for production
const client = rezo.create({
  rejectUnauthorized: false
});

// Better: provide custom CA
const client = rezo.create({
  ca: fs.readFileSync('./custom-ca.pem')
});
```

#### Proxy Connection Issues

```typescript
// Verify proxy settings
const client = rezo.create({
  proxy: {
    protocol: 'http',  // Ensure correct protocol
    host: 'proxy.example.com',
    port: 8080
  }
});

// Test proxy connection
try {
  await client.get('https://httpbin.org/ip');
} catch (error) {
  if (error.isProxyError) {
    console.log('Proxy connection failed:', error.details);
  }
}
```

#### Memory Issues with Large Files

```typescript
// Use streaming for large files
const response = await client.get('https://example.com/large-file', {
  responseType: 'stream'
});

// Or use download API
const download = await client.download('https://example.com/large-file', {
  outputPath: './large-file.zip'
});
```

### Debug Mode

```typescript
// Enable debug logging
const client = rezo.create({
  debug: true
});

// Or set environment variable
process.env.REZO_DEBUG = 'true';
```

---

## Contributing

We welcome contributions to Rezo! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone repository
git clone https://github.com/yuniqsolutions/rezo.git
cd rezo

# Install dependencies
bun install

# Run tests
bun test

# Build
bun run bundle

# Lint
bun run lint
```

### Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun run test:coverage

# Run specific test file
bun test src/adapters/http.test.ts
```

---

## Acknowledgments

Rezo was built with inspiration from the JavaScript HTTP client ecosystem, including the excellent work done by the teams behind Got, Ky, Undici, and other HTTP client libraries. We thank the open-source community for their contributions to the JavaScript ecosystem.

---

## License

Rezo is open source software licensed under the [MIT License](LICENSE).

Copyright (c) 2024-2025 Yuniq Solutions Tech

See the [LICENSE](LICENSE) file for the complete license text.

---

<p align="center">
  <img src="https://raw.githubusercontent.com/yuniqsolutions/rezo/main/assets/icon.svg" alt="Rezo Icon" width="60">
</p>

<p align="center">
  <strong>Built with lightning speed in mind</strong><br>
  <sub>Made by <a href="https://yuniq.solutions">Yuniq Solutions Tech</a></sub>
</p>
