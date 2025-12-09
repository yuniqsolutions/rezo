<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Crawler Configuration - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Crawler Configuration</h1>
  <p class="lead">
    Complete reference for all crawler configuration options including timeouts, retries, caching, and more.
  </p>

  <h2>Constructor</h2>
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  // ... options
}, http);`}
    language="typescript"
  />

  <h2>Basic Options</h2>
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
        <td><code>baseUrl</code></td>
        <td><code>string</code></td>
        <td>Required</td>
        <td>Starting point for crawling operations</td>
      </tr>
      <tr>
        <td><code>timeout</code></td>
        <td><code>number</code></td>
        <td>30000</td>
        <td>Request timeout in milliseconds</td>
      </tr>
      <tr>
        <td><code>userAgent</code></td>
        <td><code>string</code></td>
        <td>undefined</td>
        <td>Custom user agent string</td>
      </tr>
      <tr>
        <td><code>useRndUserAgent</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Use random user agent per request</td>
      </tr>
      <tr>
        <td><code>maxRedirects</code></td>
        <td><code>number</code></td>
        <td>10</td>
        <td>Maximum redirects to follow</td>
      </tr>
      <tr>
        <td><code>rejectUnauthorized</code></td>
        <td><code>boolean</code></td>
        <td>true</td>
        <td>Reject unauthorized SSL certificates</td>
      </tr>
      <tr>
        <td><code>debug</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Enable debug logging</td>
      </tr>
    </tbody>
  </table>

  <h2>Retry Options</h2>
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
        <td><code>maxRetryAttempts</code></td>
        <td><code>number</code></td>
        <td>3</td>
        <td>Maximum retry attempts for failed requests</td>
      </tr>
      <tr>
        <td><code>retryDelay</code></td>
        <td><code>number</code></td>
        <td>0</td>
        <td>Delay between retries in milliseconds</td>
      </tr>
      <tr>
        <td><code>retryOnStatusCode</code></td>
        <td><code>number[]</code></td>
        <td>[408, 429, 500, 502, 503, 504]</td>
        <td>Status codes that trigger retry</td>
      </tr>
      <tr>
        <td><code>retryOnProxyError</code></td>
        <td><code>boolean</code></td>
        <td>true</td>
        <td>Retry on proxy-related errors</td>
      </tr>
      <tr>
        <td><code>maxRetryOnProxyError</code></td>
        <td><code>number</code></td>
        <td>3</td>
        <td>Max retries for proxy errors</td>
      </tr>
      <tr>
        <td><code>retryWithoutProxyOnStatusCode</code></td>
        <td><code>number[]</code></td>
        <td>[407, 403]</td>
        <td>Status codes to retry without proxy</td>
      </tr>
    </tbody>
  </table>

  <h2>Cache Options</h2>
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
        <td><code>enableCache</code></td>
        <td><code>boolean</code></td>
        <td>true</td>
        <td>Enable response caching</td>
      </tr>
      <tr>
        <td><code>cacheTTL</code></td>
        <td><code>number</code></td>
        <td>604800000 (7 days)</td>
        <td>Cache time-to-live in milliseconds</td>
      </tr>
      <tr>
        <td><code>cacheDir</code></td>
        <td><code>string</code></td>
        <td>OS temp dir</td>
        <td>Directory for cache storage</td>
      </tr>
    </tbody>
  </table>

  <h2>URL Handling Options</h2>
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
        <td><code>forceRevisit</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Force revisiting URLs even if visited</td>
      </tr>
      <tr>
        <td><code>allowRevisiting</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Allow same URL to be visited multiple times</td>
      </tr>
    </tbody>
  </table>

  <h2>Error Handling</h2>
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
        <td><code>throwFatalError</code></td>
        <td><code>boolean</code></td>
        <td>false</td>
        <td>Throw errors or handle gracefully</td>
      </tr>
    </tbody>
  </table>

  <h2>Complete Example</h2>
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Timeouts
  timeout: 15000,
  maxRedirects: 5,
  
  // User Agent
  useRndUserAgent: true,
  
  // Retry configuration
  maxRetryAttempts: 5,
  retryDelay: 1000,
  retryOnStatusCode: [429, 500, 502, 503, 504],
  retryOnProxyError: true,
  
  // Cache configuration  
  enableCache: true,
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  cacheDir: './crawler-cache',
  
  // URL handling
  allowRevisiting: false,
  forceRevisit: false,
  
  // Error handling
  throwFatalError: false,
  debug: true,
  
  // SSL
  rejectUnauthorized: true
}, http);`}
    language="typescript"
  />

  <h2>Domain-Specific Configuration</h2>
  <p>
    The Crawler supports domain-specific configuration for proxies, rate limiting, and headers.
    See <a href="/crawler/proxy">Proxy Integration</a> and <a href="/crawler/caching">Rate Limiting</a> for details.
  </p>
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
  
  .prose p {
    margin-bottom: 1rem;
    line-height: 1.7;
    color: var(--text);
  }
  
  .prose a {
    color: var(--primary);
    text-decoration: underline;
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
