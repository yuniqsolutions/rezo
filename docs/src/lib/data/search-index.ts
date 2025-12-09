export interface SearchItem {
  title: string;
  path: string;
  category: string;
  content: string;
  type: 'page' | 'concept' | 'api' | 'example' | 'guide';
}

export const searchIndex: SearchItem[] = [
  { title: 'Introduction to Rezo', path: '/docs', category: 'Getting Started', content: 'Rezo is an enterprise-grade HTTP client library for Node.js and browsers. It provides a powerful and flexible API for making HTTP requests.', type: 'page' },
  { title: 'Installation', path: '/installation', category: 'Getting Started', content: 'npm install rezo bun add rezo pnpm add rezo yarn add rezo Node.js 22+ required ESM CommonJS TypeScript', type: 'page' },
  { title: 'Quick Start', path: '/quick-start', category: 'Getting Started', content: 'Making your first HTTP request GET POST PUT DELETE PATCH import rezo async await response data headers status', type: 'page' },
  { title: 'Why Rezo?', path: '/why-rezo', category: 'Getting Started', content: 'HTTP/2 support cookies proxy streaming adapters enterprise-grade TypeScript tree-shakeable performance universal runtime', type: 'page' },
  
  { title: 'GET Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.get() fetch data retrieve resource query parameters URL params', type: 'concept' },
  { title: 'POST Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.post() send data create resource request body JSON FormData', type: 'concept' },
  { title: 'PUT Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.put() update resource replace data modify endpoint', type: 'concept' },
  { title: 'PATCH Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.patch() partial update modify fields incremental change', type: 'concept' },
  { title: 'DELETE Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.delete() remove resource destroy endpoint', type: 'concept' },
  { title: 'HEAD Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.head() get headers without body metadata check resource exists', type: 'concept' },
  { title: 'OPTIONS Request', path: '/requests', category: 'HTTP Methods', content: 'rezo.options() CORS preflight allowed methods headers', type: 'concept' },
  
  { title: 'Request Headers', path: '/requests', category: 'Request Configuration', content: 'headers Authorization Content-Type Accept User-Agent custom headers', type: 'concept' },
  { title: 'Request Body', path: '/requests', category: 'Request Configuration', content: 'body JSON object FormData URLSearchParams Buffer Stream string', type: 'concept' },
  { title: 'Query Parameters', path: '/requests', category: 'Request Configuration', content: 'params query string URL parameters key value pairs searchParams', type: 'concept' },
  { title: 'Base URL', path: '/configuration', category: 'Request Configuration', content: 'baseURL prefix URL endpoint API base path', type: 'concept' },
  { title: 'Request Timeout', path: '/configuration', category: 'Request Configuration', content: 'timeout milliseconds ms request limit AbortController signal', type: 'concept' },
  { title: 'Authentication', path: '/requests', category: 'Request Configuration', content: 'auth Bearer token Basic auth Authorization header API key JWT', type: 'concept' },
  
  { title: 'Response Data', path: '/responses', category: 'Response Handling', content: 'response.data JSON object parsed body automatic content-type detection', type: 'concept' },
  { title: 'Response Status', path: '/responses', category: 'Response Handling', content: 'status statusText HTTP status code 200 201 404 500 response.status', type: 'concept' },
  { title: 'Response Headers', path: '/responses', category: 'Response Handling', content: 'response.headers getHeader content-type set-cookie access-control', type: 'concept' },
  { title: 'Response Cookies', path: '/responses', category: 'Response Handling', content: 'response.cookies Set-Cookie parsed cookies cookie attributes', type: 'concept' },
  { title: 'Response Timing', path: '/responses', category: 'Response Handling', content: 'response.timing DNS lookup TCP TLS TTFB duration performance metrics', type: 'concept' },
  
  { title: 'RezoError', path: '/errors', category: 'Error Handling', content: 'RezoError try catch error handling isRezoError error.status error.data structured errors', type: 'concept' },
  { title: 'Network Errors', path: '/errors', category: 'Error Handling', content: 'ECONNREFUSED ETIMEDOUT ENOTFOUND DNS resolution connection refused network failure', type: 'concept' },
  { title: 'HTTP Status Errors', path: '/errors', category: 'Error Handling', content: '4xx 5xx client error server error 400 401 403 404 500 502 503', type: 'concept' },
  { title: 'Timeout Errors', path: '/errors', category: 'Error Handling', content: 'request timeout isTimeout ETIMEDOUT socket timeout connection timeout', type: 'concept' },
  { title: 'Error Retry', path: '/errors', category: 'Error Handling', content: 'isRetryable retry on error automatic retry exponential backoff', type: 'concept' },
  
  { title: 'Adapters Overview', path: '/adapters', category: 'Adapters', content: 'adapter system pluggable architecture environment detection auto-select tree-shaking', type: 'page' },
  { title: 'HTTP Adapter', path: '/adapters/http', category: 'Adapters', content: 'Node.js native http https full-featured cookies proxy streaming decompression gzip brotli zstd', type: 'page' },
  { title: 'HTTP/2 Adapter', path: '/adapters/http2', category: 'Adapters', content: 'HTTP/2 multiplexing session pooling ALPN negotiation connection reuse server push performance', type: 'page' },
  { title: 'Fetch Adapter', path: '/adapters/fetch', category: 'Adapters', content: 'browser fetch API universal edge workers Cloudflare Vercel Deno Bun Web API', type: 'page' },
  { title: 'cURL Adapter', path: '/adapters/curl', category: 'Adapters', content: 'curl command line wrapper advanced auth NTLM digest Kerberos negotiate SSL certificates', type: 'page' },
  { title: 'XHR Adapter', path: '/adapters/xhr', category: 'Adapters', content: 'XMLHttpRequest legacy browsers Internet Explorer compatibility upload progress download progress', type: 'page' },
  { title: 'React Native Adapter', path: '/adapters/react-native', category: 'Adapters', content: 'React Native mobile iOS Android Expo fetch networking FormData file upload', type: 'page' },
  
  { title: 'HTTP/2 Multiplexing', path: '/adapters/http2', category: 'HTTP/2 Features', content: 'multiplexed connections single connection multiple streams concurrent requests', type: 'concept' },
  { title: 'HTTP/2 Session Pooling', path: '/adapters/http2', category: 'HTTP/2 Features', content: 'connection pool session reuse keep-alive persistent connections', type: 'concept' },
  { title: 'ALPN Negotiation', path: '/adapters/http2', category: 'HTTP/2 Features', content: 'Application-Layer Protocol Negotiation TLS handshake HTTP/2 upgrade', type: 'concept' },
  
  { title: 'Cookie Management', path: '/advanced/cookies', category: 'Cookies', content: 'CookieJar RezoCookieJar tough-cookie persistence domain path expires httpOnly secure sameSite Netscape JSON serialize deserialize', type: 'page' },
  { title: 'Cookie Jar', path: '/advanced/cookies', category: 'Cookies', content: 'RezoCookieJar cookie storage persistence automatic cookie handling session cookies', type: 'concept' },
  { title: 'Cookie Attributes', path: '/advanced/cookies', category: 'Cookies', content: 'expires maxAge domain path secure httpOnly sameSite cookie flags', type: 'concept' },
  { title: 'Cookie Serialization', path: '/advanced/cookies', category: 'Cookies', content: 'toJSON fromJSON serialize deserialize Netscape format cookie export import', type: 'concept' },
  
  { title: 'Proxy Support', path: '/advanced/proxy', category: 'Proxy', content: 'HTTP HTTPS SOCKS4 SOCKS5 proxy rotation ProxyManager round-robin random weighted health check authentication tunnel', type: 'page' },
  { title: 'HTTP Proxy', path: '/advanced/proxy', category: 'Proxy', content: 'HTTP proxy CONNECT tunnel proxy authentication proxy URL', type: 'concept' },
  { title: 'HTTPS Proxy', path: '/advanced/proxy', category: 'Proxy', content: 'HTTPS proxy TLS SSL encrypted proxy secure tunnel', type: 'concept' },
  { title: 'SOCKS Proxy', path: '/advanced/proxy', category: 'Proxy', content: 'SOCKS4 SOCKS5 proxy protocol TCP UDP proxy socks-proxy-agent', type: 'concept' },
  { title: 'Proxy Rotation', path: '/advanced/proxy', category: 'Proxy', content: 'ProxyManager rotate proxies round-robin random weighted selection proxy pool', type: 'concept' },
  { title: 'Proxy Health Check', path: '/advanced/proxy', category: 'Proxy', content: 'proxy health monitoring alive dead proxy status check interval', type: 'concept' },
  { title: 'Proxy Authentication', path: '/advanced/proxy', category: 'Proxy', content: 'proxy username password auth credentials Proxy-Authorization', type: 'concept' },
  
  { title: 'Streaming', path: '/advanced/streaming', category: 'Streaming', content: 'stream download upload progress file transfer ReadableStream WritableStream pipe chunked encoding large files', type: 'page' },
  { title: 'Download Progress', path: '/advanced/streaming', category: 'Streaming', content: 'download progress bytes downloaded total bytes percentage progress callback', type: 'concept' },
  { title: 'Upload Progress', path: '/advanced/streaming', category: 'Streaming', content: 'upload progress bytes uploaded total bytes percentage progress callback', type: 'concept' },
  { title: 'Stream Response', path: '/advanced/streaming', category: 'Streaming', content: 'StreamResponse ReadableStream Node.js stream chunked transfer', type: 'concept' },
  { title: 'File Download', path: '/advanced/streaming', category: 'Streaming', content: 'download file save to disk writeStream pipe file output', type: 'concept' },
  { title: 'File Upload', path: '/advanced/streaming', category: 'Streaming', content: 'upload file FormData multipart file input file stream', type: 'concept' },
  
  { title: 'Retry & Backoff', path: '/advanced/retry', category: 'Retry', content: 'retry exponential backoff status codes attempts delay maxRetries retryCondition retryDelay 429 503 Retry-After', type: 'page' },
  { title: 'Retry Configuration', path: '/advanced/retry', category: 'Retry', content: 'maxRetries retries attempts retry count limit', type: 'concept' },
  { title: 'Exponential Backoff', path: '/advanced/retry', category: 'Retry', content: 'exponential delay backoff factor increasing delay wait time', type: 'concept' },
  { title: 'Retry Condition', path: '/advanced/retry', category: 'Retry', content: 'retryCondition shouldRetry retry predicate custom retry logic', type: 'concept' },
  { title: 'Rate Limiting', path: '/advanced/retry', category: 'Retry', content: '429 Too Many Requests Retry-After rate limit throttle', type: 'concept' },
  
  { title: 'Hooks & Interceptors', path: '/advanced/hooks', category: 'Hooks', content: 'beforeRequest afterResponse onError interceptors middleware request transform response transform authentication refresh token', type: 'page' },
  { title: 'Before Request Hook', path: '/advanced/hooks', category: 'Hooks', content: 'beforeRequest request interceptor modify request add headers auth token', type: 'concept' },
  { title: 'After Response Hook', path: '/advanced/hooks', category: 'Hooks', content: 'afterResponse response interceptor transform response logging', type: 'concept' },
  { title: 'Error Hook', path: '/advanced/hooks', category: 'Hooks', content: 'onError error interceptor error handling custom error processing', type: 'concept' },
  { title: 'Request Interceptor', path: '/advanced/hooks', category: 'Hooks', content: 'interceptor middleware chain request pipeline modify request', type: 'concept' },
  { title: 'Token Refresh', path: '/advanced/hooks', category: 'Hooks', content: 'refresh token JWT expired token automatic refresh 401 unauthorized', type: 'concept' },
  
  { title: 'Request Queue', path: '/advanced/queue', category: 'Queue', content: 'queue RezoQueue HttpQueue concurrency rate limiting priority throttle per-domain limits batch requests', type: 'page' },
  { title: 'Concurrency Control', path: '/advanced/queue', category: 'Queue', content: 'concurrent requests limit parallel requests max connections', type: 'concept' },
  { title: 'Rate Limiting Queue', path: '/advanced/queue', category: 'Queue', content: 'requests per second rate limit throttle delay between requests', type: 'concept' },
  { title: 'Priority Queue', path: '/advanced/queue', category: 'Queue', content: 'priority high low urgent request priority ordering', type: 'concept' },
  { title: 'Per-Domain Limits', path: '/advanced/queue', category: 'Queue', content: 'domain limits per-host limits connection limit per domain', type: 'concept' },
  
  { title: 'TLS & Security', path: '/advanced/security', category: 'Security', content: 'TLS SSL certificates CA custom certificate chain client certificates mTLS pinning rejectUnauthorized', type: 'page' },
  { title: 'TLS Configuration', path: '/advanced/security', category: 'Security', content: 'TLS options SSL settings secure context', type: 'concept' },
  { title: 'Custom CA Certificate', path: '/advanced/security', category: 'Security', content: 'CA certificate custom CA root certificate trust chain', type: 'concept' },
  { title: 'Client Certificate', path: '/advanced/security', category: 'Security', content: 'client cert mTLS mutual TLS client authentication certificate key', type: 'concept' },
  { title: 'Certificate Pinning', path: '/advanced/security', category: 'Security', content: 'certificate pinning pin public key fingerprint security', type: 'concept' },
  { title: 'Skip Certificate Validation', path: '/advanced/security', category: 'Security', content: 'rejectUnauthorized false skip SSL verification insecure self-signed', type: 'concept' },
  
  { title: 'Performance', path: '/advanced/performance', category: 'Performance', content: 'performance metrics RezoPerformance timing DNS TCP TLS TTFB total duration connection pooling keep-alive', type: 'page' },
  { title: 'Performance Metrics', path: '/advanced/performance', category: 'Performance', content: 'RezoPerformance timing metrics measurement', type: 'concept' },
  { title: 'DNS Lookup Time', path: '/advanced/performance', category: 'Performance', content: 'DNS lookup duration hostname resolution time', type: 'concept' },
  { title: 'TCP Connection Time', path: '/advanced/performance', category: 'Performance', content: 'TCP connect duration socket connection time', type: 'concept' },
  { title: 'TLS Handshake Time', path: '/advanced/performance', category: 'Performance', content: 'TLS handshake duration SSL negotiation time', type: 'concept' },
  { title: 'Time to First Byte', path: '/advanced/performance', category: 'Performance', content: 'TTFB first byte latency server response time', type: 'concept' },
  { title: 'Connection Pooling', path: '/advanced/performance', category: 'Performance', content: 'connection pool keep-alive reuse connections persistent', type: 'concept' },
  
  { title: 'Rezo Instance', path: '/api/instance', category: 'API Reference', content: 'rezo.create instance methods get post put patch delete head options request defaults extend', type: 'api' },
  { title: 'rezo.create()', path: '/api/instance', category: 'API Reference', content: 'create instance custom defaults configuration new instance', type: 'api' },
  { title: 'Instance Methods', path: '/api/instance', category: 'API Reference', content: 'get post put patch delete head options request methods', type: 'api' },
  { title: 'Instance Defaults', path: '/api/instance', category: 'API Reference', content: 'defaults config baseURL headers timeout auth adapter', type: 'api' },
  
  { title: 'Request Options', path: '/api/options', category: 'API Reference', content: 'RequestOptions url method headers body timeout proxy auth retry hooks adapter jar signal', type: 'api' },
  { title: 'url option', path: '/api/options', category: 'API Reference', content: 'url endpoint path request URL string', type: 'api' },
  { title: 'method option', path: '/api/options', category: 'API Reference', content: 'method GET POST PUT PATCH DELETE HEAD OPTIONS', type: 'api' },
  { title: 'headers option', path: '/api/options', category: 'API Reference', content: 'headers object key value pairs request headers', type: 'api' },
  { title: 'body option', path: '/api/options', category: 'API Reference', content: 'body data payload JSON object FormData string', type: 'api' },
  { title: 'timeout option', path: '/api/options', category: 'API Reference', content: 'timeout milliseconds request timeout limit', type: 'api' },
  { title: 'proxy option', path: '/api/options', category: 'API Reference', content: 'proxy configuration HTTP HTTPS SOCKS proxy URL', type: 'api' },
  { title: 'adapter option', path: '/api/options', category: 'API Reference', content: 'adapter http http2 fetch curl xhr react-native', type: 'api' },
  { title: 'jar option', path: '/api/options', category: 'API Reference', content: 'jar cookie jar CookieJar RezoCookieJar', type: 'api' },
  { title: 'signal option', path: '/api/options', category: 'API Reference', content: 'signal AbortSignal AbortController cancel request', type: 'api' },
  
  { title: 'Response Object', path: '/api/response', category: 'API Reference', content: 'RezoResponse data status statusText headers cookies url ok redirected type timing', type: 'api' },
  { title: 'response.data', path: '/api/response', category: 'API Reference', content: 'data property parsed response body JSON object', type: 'api' },
  { title: 'response.status', path: '/api/response', category: 'API Reference', content: 'status HTTP status code 200 201 404 500', type: 'api' },
  { title: 'response.headers', path: '/api/response', category: 'API Reference', content: 'headers response headers object key value', type: 'api' },
  { title: 'response.cookies', path: '/api/response', category: 'API Reference', content: 'cookies parsed cookies Set-Cookie header', type: 'api' },
  { title: 'response.ok', path: '/api/response', category: 'API Reference', content: 'ok boolean 2xx success status', type: 'api' },
  
  { title: 'RezoError Class', path: '/api/error', category: 'API Reference', content: 'RezoError isRezoError code message status data config request response isTimeout isNetwork', type: 'api' },
  { title: 'error.status', path: '/api/error', category: 'API Reference', content: 'error status HTTP status code error.status', type: 'api' },
  { title: 'error.data', path: '/api/error', category: 'API Reference', content: 'error data response body error message', type: 'api' },
  { title: 'error.code', path: '/api/error', category: 'API Reference', content: 'error code ETIMEDOUT ECONNREFUSED network error', type: 'api' },
  { title: 'isRezoError()', path: '/api/error', category: 'API Reference', content: 'isRezoError type guard check error type', type: 'api' },
  
  { title: 'RezoFormData', path: '/api/formdata', category: 'API Reference', content: 'RezoFormData fromObject append set get getAll delete has entries file upload multipart', type: 'api' },
  { title: 'RezoFormData.fromObject()', path: '/api/formdata', category: 'API Reference', content: 'fromObject create FormData from object nested arrays', type: 'api' },
  { title: 'FormData.append()', path: '/api/formdata', category: 'API Reference', content: 'append add field value file to FormData', type: 'api' },
  
  { title: 'CookieJar API', path: '/api/cookiejar', category: 'API Reference', content: 'RezoCookieJar getCookies setCookie serialize deserialize toJSON fromJSON clear domain path', type: 'api' },
  { title: 'jar.getCookies()', path: '/api/cookiejar', category: 'API Reference', content: 'getCookies get cookies for URL domain', type: 'api' },
  { title: 'jar.setCookie()', path: '/api/cookiejar', category: 'API Reference', content: 'setCookie set cookie for URL domain', type: 'api' },
  { title: 'jar.toJSON()', path: '/api/cookiejar', category: 'API Reference', content: 'toJSON serialize cookies to JSON export', type: 'api' },
  { title: 'jar.fromJSON()', path: '/api/cookiejar', category: 'API Reference', content: 'fromJSON deserialize cookies from JSON import', type: 'api' },
  
  { title: 'TypeScript Types', path: '/api/types', category: 'API Reference', content: 'TypeScript types interfaces RequestOptions RezoResponse RezoError Adapter ProxyConfig RetryConfig HooksConfig', type: 'api' },
  { title: 'RequestOptions type', path: '/api/types', category: 'API Reference', content: 'RequestOptions interface TypeScript type definition', type: 'api' },
  { title: 'RezoResponse type', path: '/api/types', category: 'API Reference', content: 'RezoResponse interface TypeScript type definition', type: 'api' },
  { title: 'RezoError type', path: '/api/types', category: 'API Reference', content: 'RezoError class TypeScript type definition', type: 'api' },
  
  { title: 'Migrate from Axios', path: '/migration/axios', category: 'Migration', content: 'axios migration guide differences compatibility interceptors hooks error handling CancelToken AbortController', type: 'guide' },
  { title: 'Axios Interceptors to Hooks', path: '/migration/axios', category: 'Migration', content: 'axios.interceptors to hooks beforeRequest afterResponse migration', type: 'guide' },
  { title: 'Axios CancelToken to AbortController', path: '/migration/axios', category: 'Migration', content: 'CancelToken AbortController cancel request migration', type: 'guide' },
  
  { title: 'Migrate from Got', path: '/migration/got', category: 'Migration', content: 'got migration hooks retry pagination stream body response parsing options mapping', type: 'guide' },
  { title: 'Migrate from node-fetch', path: '/migration/node-fetch', category: 'Migration', content: 'node-fetch migration Response clone json text headers status fetch API compatibility', type: 'guide' },
  
  { title: 'Examples', path: '/examples', category: 'Resources', content: 'code examples recipes patterns authentication file upload download streaming proxy webscraping API integration', type: 'page' },
  { title: 'Authentication Example', path: '/examples', category: 'Examples', content: 'auth example Bearer token JWT login logout refresh token', type: 'example' },
  { title: 'File Upload Example', path: '/examples', category: 'Examples', content: 'upload file FormData multipart file input example', type: 'example' },
  { title: 'File Download Example', path: '/examples', category: 'Examples', content: 'download file stream save to disk example', type: 'example' },
  { title: 'Proxy Example', path: '/examples', category: 'Examples', content: 'proxy configuration HTTP SOCKS proxy example', type: 'example' },
  { title: 'Retry Example', path: '/examples', category: 'Examples', content: 'retry exponential backoff error handling example', type: 'example' },
  { title: 'Streaming Example', path: '/examples', category: 'Examples', content: 'stream response download upload progress example', type: 'example' },
  
  { title: 'FAQ', path: '/faq', category: 'Resources', content: 'frequently asked questions troubleshooting common issues browser Node.js Bun Deno edge runtime', type: 'page' },
  { title: 'Changelog', path: '/changelog', category: 'Resources', content: 'changelog version history releases updates breaking changes new features bug fixes', type: 'page' },
  { title: 'Contributing', path: '/contributing', category: 'Resources', content: 'contributing guide pull requests issues bug reports feature requests development setup testing', type: 'page' },
  
  { title: 'Node.js Runtime', path: '/why-rezo', category: 'Runtimes', content: 'Node.js runtime server-side JavaScript v22+ required', type: 'concept' },
  { title: 'Bun Runtime', path: '/why-rezo', category: 'Runtimes', content: 'Bun runtime fast JavaScript TypeScript runtime', type: 'concept' },
  { title: 'Deno Runtime', path: '/why-rezo', category: 'Runtimes', content: 'Deno runtime secure TypeScript runtime', type: 'concept' },
  { title: 'Browser Runtime', path: '/why-rezo', category: 'Runtimes', content: 'browser client-side JavaScript DOM fetch API', type: 'concept' },
  { title: 'Edge Workers', path: '/why-rezo', category: 'Runtimes', content: 'edge workers Cloudflare Vercel Netlify edge runtime serverless', type: 'concept' },
  { title: 'React Native', path: '/why-rezo', category: 'Runtimes', content: 'React Native mobile iOS Android Expo', type: 'concept' },
  
  { title: 'Decompression', path: '/adapters/http', category: 'Features', content: 'gzip brotli zstd deflate automatic decompression Accept-Encoding', type: 'concept' },
  { title: 'Tree Shaking', path: '/why-rezo', category: 'Features', content: 'tree-shaking bundle size optimization import only what you need', type: 'concept' },
  { title: 'TypeScript Support', path: '/why-rezo', category: 'Features', content: 'TypeScript types definitions generics type safety IntelliSense', type: 'concept' },
  { title: 'Automatic JSON Parsing', path: '/responses', category: 'Features', content: 'automatic JSON parsing content-type detection response.data', type: 'concept' },
  { title: 'URL Encoding', path: '/requests', category: 'Features', content: 'URL encoding URLSearchParams query string encoding', type: 'concept' },
  { title: 'FormData Encoding', path: '/requests', category: 'Features', content: 'FormData multipart encoding file upload nested objects arrays', type: 'concept' },
];
