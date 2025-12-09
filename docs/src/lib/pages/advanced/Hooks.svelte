<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const hooksOverview = `import { Rezo } from 'rezo';

const client = new Rezo({
  hooks: {
    // Request lifecycle
    init: [],              // Options initialization
    beforeRequest: [],     // Before request is sent
    beforeRedirect: [],    // Before following a redirect
    beforeRetry: [],       // Before retry attempt
    
    // Response lifecycle  
    afterResponse: [],     // After response received
    afterHeaders: [],      // When headers received (before body)
    afterParse: [],        // After response body is parsed
    
    // Error handling
    beforeError: [],       // Before error is thrown
    
    // Cache events
    beforeCache: [],       // Before caching response
    
    // Cookie events
    beforeCookie: [],      // Before setting a cookie
    afterCookie: [],       // After cookies processed
    
    // Proxy hooks (9 hooks for ProxyManager)
    beforeProxySelect: [], // Before proxy selection
    afterProxySelect: [],  // After proxy selected
    beforeProxyError: [],  // Before handling proxy error
    afterProxyError: [],   // After proxy error processed
    beforeProxyDisable: [],// Before disabling a proxy
    afterProxyDisable: [], // After proxy disabled
    afterProxyRotate: [],  // After proxy rotation
    afterProxyEnable: [],  // After proxy re-enabled
    onNoProxiesAvailable: [], // When proxy pool exhausted
    
    // Network events
    onSocket: [],          // Socket events (connect, close, error)
    onDns: [],             // DNS resolution events
    onTls: [],             // TLS handshake events
    onTimeout: [],         // Timeout events
    onAbort: []            // Request abort events
  }
});`;

  const beforeRequest = `// Modify request before sending
const client = new Rezo({
  hooks: {
    beforeRequest: [
      (config, context) => {
        // context: { retryCount, isRedirect, redirectCount, startTime }
        
        // Add authentication (config.headers is a RezoHeaders instance)
        const token = getAuthToken();
        config.headers = {
          ...config.headers,
          'Authorization': \`Bearer \${token}\`,
          'X-Request-ID': crypto.randomUUID()
        };
        
        // Return early with cached response (bypass actual request)
        // return new Response('cached data');
      }
    ]
  }
});`;

  const afterResponse = `// Transform or retry after response
const client = new Rezo({
  hooks: {
    afterResponse: [
      async (response, config, context) => {
        // context: { retryCount, retryWithMergedOptions }
        
        // Unwrap API envelope
        if (response.data?.result) {
          response.data = response.data.result;
        }
        
        // Token refresh on 401
        if (response.status === 401) {
          const newToken = await refreshToken();
          context.retryWithMergedOptions({
            headers: { Authorization: \`Bearer \${newToken}\` }
          });
        }
        
        return response;
      }
    ]
  }
});`;

  const beforeError = `// Transform errors before throwing
const client = new Rezo({
  hooks: {
    beforeError: [
      (error) => {
        // Add user-friendly message
        if (error.status === 404) {
          error.message = 'Resource not found';
        }
        
        // Log to monitoring service
        errorMonitor.capture(error);
        
        // Return modified error (will be thrown)
        return error;
      }
    ]
  }
});`;

  const networkHooks = `// Monitor network events
const client = new Rezo({
  hooks: {
    onDns: [
      (event, config) => {
        // event: { hostname, address, family, duration, timestamp }
        console.log(\`DNS resolved \${event.hostname} to \${event.address} in \${event.duration}ms\`);
      }
    ],
    
    onTls: [
      (event, config) => {
        // event: { protocol, cipher, authorized, certificate, duration }
        console.log(\`TLS \${event.protocol} handshake in \${event.duration}ms\`);
        if (!event.authorized) {
          console.warn('Certificate not authorized:', event.authorizationError);
        }
      }
    ],
    
    onSocket: [
      (event, socket) => {
        // event.type: 'connect' | 'close' | 'drain' | 'error' | 'timeout' | 'end'
        console.log(\`Socket \${event.type} - bytes: \${event.bytesRead}/\${event.bytesWritten}\`);
      }
    ]
  }
});`;

  const cacheHooks = `// Control caching behavior
const client = new Rezo({
  cache: true,
  hooks: {
    beforeCache: [
      (event) => {
        // event: { status, headers, url, cacheKey, isCacheable, cacheControl }
        
        // Don't cache error responses
        if (event.status >= 400) return false;
        
        // Don't cache if no-store directive
        if (event.cacheControl?.noStore) return false;
        
        // Cache is allowed
        return true;
      }
    ]
  }
});`;

  const cookieHooks = `// Intercept cookie processing
const client = new Rezo({
  hooks: {
    beforeCookie: [
      (event, config) => {
        // event: { cookie, source, url, isValid, validationErrors }
        
        // Reject tracking cookies
        if (event.cookie.key.startsWith('_ga')) {
          return false; // Cookie will not be set
        }
        
        // Allow cookie
        return true;
      }
    ],
    
    afterCookie: [
      (cookies, config) => {
        // cookies: Array of Cookie objects
        console.log(\`Processed \${cookies.length} cookies\`);
      }
    ]
  }
});`;

  const retryHooks = `// Custom retry logic
const client = new Rezo({
  retry: { maxRetries: 3 },
  hooks: {
    beforeRetry: [
      async (config, error, retryCount) => {
        console.log(\`Retry attempt \${retryCount} for \${config.url}\`);
        
        // Custom backoff delay
        await new Promise(r => setTimeout(r, retryCount * 1000));
        
        // Refresh credentials before retry
        if (error.status === 401) {
          config.headers = {
            ...config.headers,
            'Authorization': await getNewToken()
          };
        }
      }
    ]
  }
});`;

  const perRequestHooks = `// Hooks can also be set per-request
const response = await rezo.get('https://api.example.com/data', {
  hooks: {
    beforeRequest: [
      (config, context) => {
        config.headers = { ...config.headers, 'X-Custom': 'value' };
      }
    ],
    afterResponse: [
      (response, config, context) => {
        console.log('Request completed:', response.status);
        return response;
      }
    ]
  }
});`;
</script>

<svelte:head>
  <title>Hooks System - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Hooks System</h1>
    <p class="text-lg" style="color: var(--muted);">
      Comprehensive lifecycle hooks for request/response interception, network monitoring, caching control, and cookie management.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Overview</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo provides 24+ hooks covering the entire request lifecycle:
    </p>
    <CodeBlock code={hooksOverview} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Request Lifecycle Hooks</h2>
    
    <div class="space-y-8">
      <div>
        <h3 class="text-xl font-semibold mb-3">beforeRequest</h3>
        <p class="mb-4" style="color: var(--muted);">
          Called before the request is sent. Modify config, add headers, or return early with a Response to bypass the actual request.
        </p>
        <CodeBlock code={beforeRequest} language="typescript" />
      </div>
      
      <div>
        <h3 class="text-xl font-semibold mb-3">afterResponse</h3>
        <p class="mb-4" style="color: var(--muted);">
          Called after the response is received. Transform data, trigger retries with merged options, or modify the response.
        </p>
        <CodeBlock code={afterResponse} language="typescript" />
      </div>
      
      <div>
        <h3 class="text-xl font-semibold mb-3">beforeError</h3>
        <p class="mb-4" style="color: var(--muted);">
          Called before an error is thrown. Transform errors, add context, or log to monitoring services.
        </p>
        <CodeBlock code={beforeError} language="typescript" />
      </div>
      
      <div>
        <h3 class="text-xl font-semibold mb-3">beforeRetry</h3>
        <p class="mb-4" style="color: var(--muted);">
          Called before a retry attempt. Implement custom backoff, refresh credentials, or modify config.
        </p>
        <CodeBlock code={retryHooks} language="typescript" />
      </div>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Network Event Hooks</h2>
    <p class="mb-4" style="color: var(--muted);">
      Monitor low-level network events for debugging and performance analysis.
    </p>
    <CodeBlock code={networkHooks} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cache Hooks</h2>
    <p class="mb-4" style="color: var(--muted);">
      Control which responses get cached.
    </p>
    <CodeBlock code={cacheHooks} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Hooks</h2>
    <p class="mb-4" style="color: var(--muted);">
      Intercept cookie processing to filter, validate, or log cookies.
    </p>
    <CodeBlock code={cookieHooks} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Per-Request Hooks</h2>
    <p class="mb-4" style="color: var(--muted);">
      Hooks can be set per-request in addition to instance-level hooks.
    </p>
    <CodeBlock code={perRequestHooks} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Hook Reference</h2>
    <p class="mb-4 text-sm" style="color: var(--muted); font-style: italic;">
      Async-capable hooks can return a Promise. Event hooks (on*) are synchronous only.
    </p>
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <thead>
          <tr style="background: var(--surface);">
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Hook</th>
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Parameters</th>
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Return Type</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>init</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(plainOptions, options)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeRequest</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(config, context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Response | Promise&lt;void | Response&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeRedirect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(config, response)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeRetry</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(config, error, retryCount)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterResponse</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(response, config, context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>RezoResponse&lt;T&gt; | Promise&lt;...&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterHeaders</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterParse</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>T | Promise&lt;T&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(error)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>RezoError | Error | Promise&lt;...&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeCache</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>boolean | void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeCookie</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>boolean | void | Promise&lt;...&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterCookie</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(cookies, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onSocket</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, socket)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onDns</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onTls</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onTimeout</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onAbort</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void</code></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h3 class="text-xl font-semibold mb-4">Proxy Hooks</h3>
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <thead>
          <tr style="background: var(--surface);">
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Hook</th>
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Parameters</th>
            <th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Return Type</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeProxySelect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>ProxyInfo | void | Promise&lt;...&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterProxySelect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeProxyError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterProxyError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>beforeProxyDisable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>boolean | void | Promise&lt;...&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterProxyDisable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterProxyRotate</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>afterProxyEnable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
          <tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>onNoProxiesAvailable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code>void | Promise&lt;void&gt;</code></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="tip-box">
    <h3 class="text-lg font-semibold mb-2">Tips</h3>
    <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);">
      <li>Most hooks support async handlers and can return Promises</li>
      <li>Event hooks (<code>onSocket</code>, <code>onDns</code>, <code>onTls</code>, <code>onTimeout</code>, <code>onAbort</code>) are synchronous only</li>
      <li>Arrays of hooks run in order</li>
    </ul>
  </section>
</div>

<style>
  .tip-box {
    background: rgba(34, 197, 94, 0.1);
    border-left: 4px solid #22c55e;
    padding: 1rem;
    border-radius: 0.25rem;
  }
  
  code {
    background: var(--code-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }
</style>
