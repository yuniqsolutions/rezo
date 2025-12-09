<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Crawler Proxy Integration - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Proxy Integration</h1>
  <p class="lead">
    Configure domain-specific or global proxy settings for crawler requests.
  </p>

  <h2>Basic Proxy Configuration</h2>
  <p>Add proxies via the constructor or using the <code>addProxy</code> method.</p>
  
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [{
      domain: '*',
      isGlobal: true,
      proxy: {
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080
      }
    }]
  }
}, http);`}
    language="typescript"
  />

  <h2>Domain-Specific Proxies</h2>
  <p>Use different proxies for different domains.</p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [
      {
        domain: 'api.example.com',
        proxy: {
          protocol: 'http',
          host: 'api-proxy.example.com',
          port: 8080
        }
      },
      {
        domain: '*.data.example.com',
        proxy: {
          protocol: 'socks5',
          host: 'data-proxy.example.com',
          port: 1080
        }
      },
      {
        domain: '*',
        isGlobal: true,
        proxy: {
          protocol: 'http',
          host: 'default-proxy.example.com',
          port: 8080
        }
      }
    ]
  }
}, http);`}
    language="typescript"
  />

  <h2>Adding Proxies Dynamically</h2>
  <p>Use the <code>addProxy</code> method on the crawler config.</p>
  <CodeBlock 
    code={`crawler.config.addProxy({
  domain: 'secure.example.com',
  proxy: {
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 9050,
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});`}
    language="typescript"
  />

  <h2>Domain Pattern Matching</h2>
  <p>Domain patterns support multiple formats:</p>
  <table>
    <thead>
      <tr>
        <th>Pattern</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>'example.com'</code></td>
        <td>Exact domain match</td>
      </tr>
      <tr>
        <td><code>'*.example.com'</code></td>
        <td>Wildcard subdomain match</td>
      </tr>
      <tr>
        <td><code>['a.com', 'b.com']</code></td>
        <td>Array of domains</td>
      </tr>
      <tr>
        <td><code>/^api\./</code></td>
        <td>Regex pattern</td>
      </tr>
      <tr>
        <td><code>'*'</code></td>
        <td>Match all (with isGlobal: true)</td>
      </tr>
    </tbody>
  </table>

  <h2>Proxy Authentication</h2>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [{
      domain: '*',
      isGlobal: true,
      proxy: {
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080,
        auth: {
          username: 'proxyuser',
          password: 'proxypass'
        }
      }
    }]
  }
}, http);`}
    language="typescript"
  />

  <h2>SOCKS Proxy Support</h2>
  <CodeBlock 
    code={`// SOCKS4
{
  protocol: 'socks4',
  host: '127.0.0.1',
  port: 1080
}

// SOCKS5 with authentication
{
  protocol: 'socks5',
  host: '127.0.0.1',
  port: 1080,
  auth: {
    username: 'user',
    password: 'pass'
  }
}`}
    language="typescript"
  />

  <h2>Retry Without Proxy</h2>
  <p>Configure automatic retry without proxy on certain status codes.</p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Retry without proxy on these status codes
  retryWithoutProxyOnStatusCode: [407, 403],
  
  // Enable retry on proxy errors
  retryOnProxyError: true,
  maxRetryOnProxyError: 3,
  
  proxy: {
    enable: true,
    proxies: [/* ... */]
  }
}, http);`}
    language="typescript"
  />

  <h2>Oxylabs Integration</h2>
  <p>Built-in support for Oxylabs proxy service.</p>
  <CodeBlock 
    code={`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  oxylabs: {
    enable: true,
    labs: [{
      domain: 'target-site.com',
      options: {
        username: 'your-username',
        password: 'your-password',
        country: 'us'
      },
      queueOptions: {
        concurrency: 5,
        interval: 1000
      }
    }]
  }
}, http);`}
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
