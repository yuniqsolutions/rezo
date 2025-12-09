<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Crawler Caching & Rate Limiting - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Caching & Rate Limiting</h1>
  <p class="lead">
    Configure response caching and domain-specific rate limiting for efficient and polite crawling.
  </p>

  <h2>Response Caching</h2>
  <p>
    The Crawler includes built-in file-based caching to avoid redundant requests.
  </p>
  
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Enable caching (default: true)
  enableCache: true,
  
  // Cache TTL in milliseconds (default: 7 days)
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  
  // Cache directory (default: OS temp dir)
  cacheDir: './crawler-cache'
}, http);`}
    language="typescript"
  />

  <h3>Cache Behavior</h3>
  <ul>
    <li>Cached responses are stored with encrypted namespace</li>
    <li>Automatic cache expiration based on TTL</li>
    <li>URL tracking prevents duplicate requests</li>
  </ul>

  <h3>Bypassing Cache</h3>
  <p>Use <code>forceRevisit</code> to bypass cache for specific scenarios.</p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  enableCache: true,
  
  // Force re-fetch even if cached
  forceRevisit: true
}, http);`}
    language="typescript"
  />

  <h2>Rate Limiting</h2>
  <p>
    Configure domain-specific rate limiting to avoid overwhelming target servers.
  </p>

  <h3>Global Rate Limiting</h3>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  limiter: {
    enable: true,
    limiters: [{
      domain: '*',
      isGlobal: true,
      options: {
        concurrency: 2,        // Max concurrent requests
        interval: 1000,        // Interval in ms
        intervalCap: 5         // Max requests per interval
      }
    }]
  }
}, http);`}
    language="typescript"
  />

  <h3>Domain-Specific Rate Limiting</h3>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  limiter: {
    enable: true,
    limiters: [
      {
        domain: 'api.example.com',
        options: {
          concurrency: 5,
          interval: 100
        }
      },
      {
        domain: 'slow-server.example.com',
        options: {
          concurrency: 1,
          interval: 2000
        }
      },
      {
        domain: '*',
        isGlobal: true,
        options: {
          concurrency: 3,
          interval: 500
        }
      }
    ]
  }
}, http);`}
    language="typescript"
  />

  <h3>Adding Limiters Dynamically</h3>
  <CodeBlock 
    code={`crawler.config.addLimiter({
  domain: 'new-domain.example.com',
  options: {
    concurrency: 2,
    interval: 1000,
    intervalCap: 10
  }
});`}
    language="typescript"
  />

  <h2>Rate Limiter Options</h2>
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
        <td><code>concurrency</code></td>
        <td><code>number</code></td>
        <td>Maximum concurrent requests</td>
      </tr>
      <tr>
        <td><code>interval</code></td>
        <td><code>number</code></td>
        <td>Rate limit interval in milliseconds</td>
      </tr>
      <tr>
        <td><code>intervalCap</code></td>
        <td><code>number</code></td>
        <td>Maximum requests per interval</td>
      </tr>
      <tr>
        <td><code>timeout</code></td>
        <td><code>number</code></td>
        <td>Task timeout in milliseconds</td>
      </tr>
    </tbody>
  </table>

  <h2>Custom Headers</h2>
  <p>Configure domain-specific headers for crawling.</p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  headers: {
    enable: true,
    httpHeaders: [
      {
        domain: 'api.example.com',
        headers: {
          'Authorization': 'Bearer token123',
          'X-API-Key': 'my-api-key'
        }
      },
      {
        domain: '*',
        isGlobal: true,
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    ]
  }
}, http);`}
    language="typescript"
  />

  <h2>URL Tracking</h2>
  <p>
    The Crawler automatically tracks visited URLs to avoid duplicates.
  </p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Allow same URL to be visited multiple times
  allowRevisiting: false, // default
  
  // Force revisit even if URL was visited
  forceRevisit: false // default
}, http);`}
    language="typescript"
  />

  <h2>Complete Example</h2>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Caching
  enableCache: true,
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  cacheDir: './cache',
  
  // Rate limiting
  limiter: {
    enable: true,
    limiters: [
      {
        domain: 'api.example.com',
        options: { concurrency: 5, interval: 200 }
      },
      {
        domain: '*',
        isGlobal: true,
        options: { concurrency: 2, interval: 1000 }
      }
    ]
  },
  
  // Custom headers
  headers: {
    enable: true,
    httpHeaders: [{
      domain: '*',
      isGlobal: true,
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US'
      }
    }]
  }
}, http);

crawler
  .onSelection('.product', async (el) => {
    // Process products with automatic rate limiting
  })
  .visit('/products');

await crawler.waitForAll();`}
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
  
  .prose ul {
    margin-bottom: 1.5rem;
    padding-left: 1.5rem;
  }
  
  .prose li {
    margin-bottom: 0.5rem;
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
