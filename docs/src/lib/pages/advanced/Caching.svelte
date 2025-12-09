<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Caching - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Caching</h1>
  <p class="lead">
    Rezo provides built-in response caching and DNS caching to improve performance and reduce redundant network requests.
  </p>

  <h2>Response Cache</h2>
  <p>
    Enable response caching to store and reuse HTTP responses. Caching can be configured per-request or as a default option.
  </p>

  <h3>Basic Usage</h3>
  <CodeBlock 
    code={`import rezo from 'rezo';

// Enable memory-only cache
const response = await rezo.get('https://api.example.com/data', {
  cache: true
});

// With file persistence
const response2 = await rezo.get('https://api.example.com/data', {
  cache: {
    cacheDir: './cache',
    ttl: 300000 // 5 minutes
  }
});`}
    language="typescript"
  />

  <h3>Cache Options</h3>
  <table>
    <thead>
      <tr>
        <th>Option</th>
        <th>Type</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>cacheDir</code></td>
        <td><code>string</code></td>
        <td>Directory for persistent cache storage</td>
      </tr>
      <tr>
        <td><code>ttl</code></td>
        <td><code>number</code></td>
        <td>Time-to-live in milliseconds</td>
      </tr>
      <tr>
        <td><code>maxEntries</code></td>
        <td><code>number</code></td>
        <td>Maximum number of entries to cache</td>
      </tr>
      <tr>
        <td><code>methods</code></td>
        <td><code>string[]</code></td>
        <td>HTTP methods to cache (default: GET only)</td>
      </tr>
      <tr>
        <td><code>respectHeaders</code></td>
        <td><code>boolean</code></td>
        <td>Honor Cache-Control headers from response</td>
      </tr>
    </tbody>
  </table>

  <h3>Custom Cache Configuration</h3>
  <CodeBlock 
    code={`const response = await rezo.get('https://api.example.com/data', {
  cache: {
    ttl: 600000,           // 10 minutes
    maxEntries: 1000,
    methods: ['GET'],      // Only cache GET requests
    respectHeaders: true   // Honor Cache-Control headers
  }
});`}
    language="typescript"
  />

  <h2>DNS Cache</h2>
  <p>
    DNS caching reduces DNS lookup overhead by caching resolved addresses.
  </p>

  <CodeBlock 
    code={`import rezo from 'rezo';

// Enable DNS caching
const response = await rezo.get('https://api.example.com/data', {
  dnsCache: true
});

// DNS cache with custom TTL
const response2 = await rezo.get('https://api.example.com/data', {
  dnsCache: {
    ttl: 60000 // 1 minute
  }
});`}
    language="typescript"
  />

  <h2>Cache Hooks</h2>
  <p>
    Use the <code>beforeCache</code> hook to control caching behavior programmatically.
  </p>

  <CodeBlock 
    code={`import { Rezo } from 'rezo';

const client = new Rezo({
  cache: true,
  hooks: {
    beforeCache: [(event) => {
      // Don't cache error responses
      if (event.status >= 400) {
        return false;
      }
      
      // Don't cache if no-store directive
      if (event.cacheControl?.noStore) {
        return false;
      }
      
      // Allow caching
      return true;
    }]
  }
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
