<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicProxy = `// HTTP proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});

// HTTPS proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    protocol: 'https'
  }
});

// SOCKS5 proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'socks.example.com',
    port: 1080,
    protocol: 'socks5'
  }
});

// Authenticated proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});`;

  const proxyManager = `import { ProxyManager } from 'rezo';

// Create a proxy manager with multiple proxies
const manager = new ProxyManager({
  proxies: [
    { host: 'proxy1.example.com', port: 8080 },
    { host: 'proxy2.example.com', port: 8080 },
    { host: 'proxy3.example.com', port: 8080 },
  ],
  
  // Rotation strategy
  strategy: 'random',  // or 'sequential', 'per-proxy-limit'
  
  // Health checking
  failureThreshold: 3,     // Mark dead after 3 failures
  cooldownPeriod: 60000,   // Re-enable after 60 seconds
});

// Use with rezo
const api = rezo.create({
  proxyManager: manager
});

await api.get('https://api.example.com'); // Uses rotating proxies`;

  const proxyFiltering = `const manager = new ProxyManager({
  proxies: [...],
  
  // Only use proxy for specific URLs
  whitelist: [
    '*.target-site.com',
    'api.specific-domain.com'
  ],
  
  // Never use proxy for these
  blacklist: [
    '*.internal.company.com',
    'localhost',
    /^192\\.168\\./  // Regex pattern
  ]
});`;

  const proxyHooks = `const manager = new ProxyManager({
  proxies: [...],
  
  hooks: {
    beforeProxySelect: (url, proxies) => {
      console.log(\`Selecting proxy for \${url}\`);
    },
    
    afterProxySelect: (url, proxy) => {
      console.log(\`Selected: \${proxy.host}\`);
    },
    
    beforeProxyError: (proxy, error) => {
      console.log(\`Proxy error: \${proxy.host}\`);
    },
    
    onProxyDead: (proxy) => {
      console.log(\`Proxy marked dead: \${proxy.host}\`);
      // Optionally notify monitoring system
    },
    
    onProxyRevived: (proxy) => {
      console.log(\`Proxy revived: \${proxy.host}\`);
    }
  }
});`;
</script>

<svelte:head>
  <title>Proxy Configuration - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Proxy Support</h1>
    <p class="text-lg" style="color: var(--muted);">
      Comprehensive proxy support with HTTP, HTTPS, SOCKS4/5, rotation, and health management.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Proxy Configuration</h2>
    <CodeBlock code={basicProxy} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">ProxyManager</h2>
    <p class="mb-4" style="color: var(--muted);">
      Advanced proxy rotation and health management:
    </p>
    <CodeBlock code={proxyManager} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">URL Filtering</h2>
    <p class="mb-4" style="color: var(--muted);">
      Control which URLs use proxies:
    </p>
    <CodeBlock code={proxyFiltering} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Proxy Lifecycle Hooks</h2>
    <CodeBlock code={proxyHooks} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Rotation Strategies</h2>
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">random</h4>
        <p class="text-sm" style="color: var(--muted);">Randomly select from healthy proxies</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">sequential</h4>
        <p class="text-sm" style="color: var(--muted);">Round-robin through proxies in order</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">per-proxy-limit</h4>
        <p class="text-sm" style="color: var(--muted);">Limit requests per proxy before rotating</p>
      </div>
    </div>
  </section>
</div>
