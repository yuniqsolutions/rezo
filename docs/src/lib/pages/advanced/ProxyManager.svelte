<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>ProxyManager - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>ProxyManager</h1>
  <p class="lead">
    ProxyManager provides advanced proxy rotation and pool management with multiple rotation strategies, failure handling, URL filtering, and comprehensive lifecycle hooks.
  </p>

  <h2>Overview</h2>
  <p>
    While basic proxy configuration works for single-proxy setups, ProxyManager is designed for enterprise scenarios where you need to manage a pool of proxies with automatic rotation, failure detection, and intelligent URL-based routing.
  </p>

  <h2>Basic Setup</h2>
  <CodeBlock 
    code={`import { Rezo, ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({
  rotation: 'random',
  proxies: [
    { protocol: 'http', host: 'proxy1.example.com', port: 8080 },
    { protocol: 'socks5', host: 'proxy2.example.com', port: 1080 },
    'http://user:pass@proxy3.example.com:8080'
  ]
});

const client = new Rezo({
  proxyManager
});

// All requests automatically use the proxy pool
const response = await client.get('https://api.example.com/data');`}
    language="typescript"
  />

  <h2>Rotation Strategies</h2>
  
  <h3>Random Rotation</h3>
  <p>Randomly selects a proxy from the available pool for each request.</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */]
});`}
    language="typescript"
  />

  <h3>Sequential Rotation</h3>
  <p>Uses proxies in order, optionally rotating after N requests per proxy.</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'sequential',
  requestsPerProxy: 10, // Rotate after 10 requests
  proxies: [/* ... */]
});`}
    language="typescript"
  />

  <h3>Per-Proxy Limit</h3>
  <p>Uses each proxy for a maximum number of total requests, then permanently removes it.</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'per-proxy-limit',
  limit: 100, // Each proxy handles max 100 requests
  proxies: [/* ... */]
});`}
    language="typescript"
  />

  <h2>URL Filtering</h2>
  
  <h3>Whitelist</h3>
  <p>Only use proxies for specific domains or URL patterns.</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  whitelist: [
    'api.example.com',           // Exact domain match
    /^\\/api\\//,                  // Regex pattern
    /^https:\\/\\/secure\\./       // URLs starting with https://secure.
  ]
});`}
    language="typescript"
  />

  <h3>Blacklist</h3>
  <p>Exclude certain domains from proxy usage (direct connection).</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  blacklist: [
    'localhost',
    '127.0.0.1',
    /\\.internal\\./
  ]
});`}
    language="typescript"
  />

  <h2>Failure Handling</h2>
  
  <h3>Auto-Disable Dead Proxies</h3>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  autoDisableDeadProxies: true,
  maxFailures: 3 // Disable after 3 consecutive failures
});`}
    language="typescript"
  />

  <h3>Cooldown Period</h3>
  <p>Re-enable disabled proxies after a cooldown period.</p>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  autoDisableDeadProxies: true,
  maxFailures: 3,
  cooldown: {
    enabled: true,
    durationMs: 60000 // Re-enable after 1 minute
  }
});`}
    language="typescript"
  />

  <h3>Retry with Next Proxy</h3>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  retryWithNextProxy: true,
  maxProxyRetries: 3
});`}
    language="typescript"
  />

  <h2>ProxyManager Hooks</h2>
  <p>ProxyManager provides 9 lifecycle hooks for monitoring and controlling proxy behavior.</p>

  <table>
    <thead>
      <tr>
        <th>Hook</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>beforeProxySelect</code></td>
        <td>Called before selecting a proxy. Can return a specific proxy to use.</td>
      </tr>
      <tr>
        <td><code>afterProxySelect</code></td>
        <td>Called after a proxy is selected for a request.</td>
      </tr>
      <tr>
        <td><code>beforeProxyError</code></td>
        <td>Called before a proxy error is processed.</td>
      </tr>
      <tr>
        <td><code>afterProxyError</code></td>
        <td>Called after a proxy error has been processed.</td>
      </tr>
      <tr>
        <td><code>beforeProxyDisable</code></td>
        <td>Called before disabling a proxy. Return false to prevent.</td>
      </tr>
      <tr>
        <td><code>afterProxyDisable</code></td>
        <td>Called after a proxy has been disabled.</td>
      </tr>
      <tr>
        <td><code>afterProxyRotate</code></td>
        <td>Called after rotating to a new proxy.</td>
      </tr>
      <tr>
        <td><code>afterProxyEnable</code></td>
        <td>Called when a proxy is re-enabled (after cooldown).</td>
      </tr>
      <tr>
        <td><code>onNoProxiesAvailable</code></td>
        <td>Called when no proxies are available. Use for alerts or pool refresh.</td>
      </tr>
    </tbody>
  </table>

  <h3>Hook Examples</h3>
  <CodeBlock 
    code={`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */]
});

// Log when proxy is selected
manager.hooks.afterProxySelect.push(({ proxy, url }) => {
  console.log(\`Using \${proxy.host}:\${proxy.port} for \${url}\`);
});

// Alert when proxies are exhausted
manager.hooks.onNoProxiesAvailable.push(({ reason }) => {
  console.error('No proxies available:', reason);
  // Trigger alert or refresh proxy pool
});

// Prevent disabling certain proxies
manager.hooks.beforeProxyDisable.push(({ proxy }) => {
  if (proxy.label === 'premium') {
    return false; // Don't disable premium proxies
  }
});

// Log proxy failures
manager.hooks.afterProxyError.push(({ proxy, error, failureCount }) => {
  console.warn(\`Proxy \${proxy.host} failed (\${failureCount}x): \${error.message}\`);
});`}
    language="typescript"
  />

  <h2>Configuration Reference</h2>
  <table>
    <thead>
      <tr>
        <th>Option</th>
        <th>Type</th>
        <th>Default</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>proxies</code></td>
        <td><code>(ProxyInfo | string)[]</code></td>
        <td>Required</td>
        <td>Array of proxy configurations or URL strings</td>
      </tr>
      <tr>
        <td><code>rotation</code></td>
        <td><code>'random' | 'sequential' | 'per-proxy-limit'</code></td>
        <td>Required</td>
        <td>Rotation strategy</td>
      </tr>
      <tr>
        <td><code>whitelist</code></td>
        <td><code>(string | RegExp)[]</code></td>
        <td>undefined</td>
        <td>URLs that should use proxy</td>
      </tr>
      <tr>
        <td><code>blacklist</code></td>
        <td><code>(string | RegExp)[]</code></td>
        <td>undefined</td>
        <td>URLs that bypass proxy</td>
      </tr>
      <tr>
        <td><code>autoDisableDeadProxies</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Auto-disable failing proxies</td>
      </tr>
      <tr>
        <td><code>maxFailures</code></td>
        <td><code>number</code></td>
        <td>3</td>
        <td>Failures before disabling</td>
      </tr>
      <tr>
        <td><code>cooldown</code></td>
        <td><code>ProxyCooldownConfig</code></td>
        <td>undefined</td>
        <td>Re-enable config after cooldown</td>
      </tr>
      <tr>
        <td><code>failWithoutProxy</code></td>
        <td><code>boolean</code></td>
        <td>true</td>
        <td>Throw error if no proxy available</td>
      </tr>
      <tr>
        <td><code>retryWithNextProxy</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Retry failed requests with next proxy</td>
      </tr>
      <tr>
        <td><code>maxProxyRetries</code></td>
        <td><code>number</code></td>
        <td>3</td>
        <td>Max proxy retry attempts</td>
      </tr>
    </tbody>
  </table>

  <h2>Bypassing ProxyManager</h2>
  <p>You can bypass the ProxyManager for specific requests:</p>
  <CodeBlock 
    code={`// Use direct connection for this request
const response = await client.get('https://api.example.com/data', {
  useProxyManager: false
});

// Use a specific proxy instead of the manager
const response2 = await client.get('https://api.example.com/data', {
  useProxyManager: false,
  proxy: 'http://specific-proxy.com:8080'
});`}
    language="typescript"
  />
</article>

<style>
  .prose {
    max-width: 65ch;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  
  .prose h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 1rem;
    background: linear-gradient(135deg, var(--primary), var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .lead {
    font-size: 1.25rem;
    color: var(--muted);
    margin-bottom: 2rem;
  }
  
  .prose h2 {
    font-size: 1.75rem;
    font-weight: 600;
    margin-top: 3rem;
    margin-bottom: 1rem;
    color: var(--text);
  }
  
  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    color: var(--text);
  }
  
  .prose p {
    margin-bottom: 1rem;
    line-height: 1.7;
    color: var(--text);
  }
  
  .prose code {
    background: var(--code-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    font-family: 'JetBrains Mono', monospace;
  }
  
  .prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    font-size: 0.9rem;
  }
  
  .prose th,
  .prose td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  
  .prose th {
    font-weight: 600;
    color: var(--text);
    background: var(--code-bg);
  }
  
  .prose td {
    color: var(--text);
  }
</style>
