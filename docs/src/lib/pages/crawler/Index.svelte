<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Crawler - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Crawler</h1>
  <p class="lead">
    A powerful event-driven web crawler built on the Rezo HTTP client. Features automatic caching, proxy rotation, retry mechanisms, email lead discovery, and DOM parsing.
  </p>

  <h2>Overview</h2>
  <p>
    The Crawler provides a fluent API for web scraping with chainable event handlers. It automatically handles caching, retries, and proxy rotation while you focus on data extraction.
  </p>

  <h2>Import</h2>
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';`}
    language="typescript"
  />

  <h2>Quick Start</h2>
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  enableCache: true,
  timeout: 30000
}, http);

crawler
  .onDocument(async (doc) => {
    console.log('Page title:', doc.title);
  })
  .onAnchor(async (anchor) => {
    console.log('Found link:', anchor.href);
  })
  .visit('/page1')
  .visit('/page2');

await crawler.waitForAll();`}
    language="typescript"
  />

  <h2>Key Features</h2>
  <ul>
    <li><strong>Event-Driven Parsing</strong> - Chain event handlers for documents, elements, links, and more</li>
    <li><strong>Automatic Caching</strong> - Built-in file-based caching with configurable TTL</li>
    <li><strong>Proxy Rotation</strong> - Domain-specific or global proxy configuration</li>
    <li><strong>Rate Limiting</strong> - Domain-specific concurrency and interval controls</li>
    <li><strong>Email Discovery</strong> - Automatic email lead extraction from pages</li>
    <li><strong>Retry Logic</strong> - Configurable retry with proxy fallback</li>
  </ul>

  <h2>Basic Example: Scraping Products</h2>
  <CodeBlock 
    code={`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

interface Product {
  name: string;
  price: string;
  url: string;
}

const products: Product[] = [];
const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://shop.example.com',
  enableCache: true,
  timeout: 15000
}, http);

crawler
  .onSelection<HTMLDivElement>('.product-card', async (card) => {
    products.push({
      name: card.querySelector('.name')?.textContent || '',
      price: card.querySelector('.price')?.textContent || '',
      url: card.querySelector('a')?.href || ''
    });
  })
  .onAnchor('.pagination a', async (link) => {
    // Follow pagination links
    crawler.visit(link.href);
  })
  .visit('/products');

await crawler.waitForAll();
console.log('Found products:', products.length);`}
    language="typescript"
  />

  <h2>Event Handlers</h2>
  <p>The Crawler provides multiple event handlers for different parsing stages:</p>
  
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>onDocument</code></td>
        <td>Full document access</td>
      </tr>
      <tr>
        <td><code>onBody</code></td>
        <td>Body element access</td>
      </tr>
      <tr>
        <td><code>onElement</code></td>
        <td>All HTML elements</td>
      </tr>
      <tr>
        <td><code>onSelection</code></td>
        <td>Elements matching CSS selector</td>
      </tr>
      <tr>
        <td><code>onAnchor</code></td>
        <td>Anchor elements (links)</td>
      </tr>
      <tr>
        <td><code>onHref</code></td>
        <td>Raw href strings</td>
      </tr>
      <tr>
        <td><code>onText</code></td>
        <td>Text content from selector</td>
      </tr>
      <tr>
        <td><code>onAttribute</code></td>
        <td>Attribute values from elements</td>
      </tr>
      <tr>
        <td><code>onResponse</code></td>
        <td>HTTP response metadata</td>
      </tr>
      <tr>
        <td><code>onRawData</code></td>
        <td>Raw response buffer</td>
      </tr>
      <tr>
        <td><code>onJson</code></td>
        <td>JSON response data</td>
      </tr>
      <tr>
        <td><code>onError</code></td>
        <td>Error handling</td>
      </tr>
      <tr>
        <td><code>onEmailDiscovered</code></td>
        <td>Individual email found</td>
      </tr>
      <tr>
        <td><code>onEmailLeads</code></td>
        <td>Batch of discovered emails</td>
      </tr>
    </tbody>
  </table>

  <p>
    See the <a href="/crawler/events">Event Handlers</a> page for detailed documentation of each event.
  </p>

  <h2>Next Steps</h2>
  <ul>
    <li><a href="/crawler/configuration">Configuration Options</a></li>
    <li><a href="/crawler/events">Event Handlers</a></li>
    <li><a href="/crawler/proxy">Proxy Integration</a></li>
    <li><a href="/crawler/caching">Caching & Rate Limiting</a></li>
  </ul>
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
  
  .prose ul {
    margin-bottom: 1.5rem;
    padding-left: 1.5rem;
  }
  
  .prose li {
    margin-bottom: 0.5rem;
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
