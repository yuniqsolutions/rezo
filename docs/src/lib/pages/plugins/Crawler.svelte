<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicCrawler = `import rezo, { Crawler } from 'rezo';

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  enableCache: true,
  cacheDir: './cache',
  timeout: 30000,
  maxRedirects: 10
}, rezo);

crawler
  .onDocument(async (doc) => {
    console.log('Page title:', doc.title);
  })
  .onAnchor(async (anchor) => {
    console.log('Found link:', anchor.href);
  })
  .visit('/page1')
  .visit('/page2');

await crawler.waitForAll();
await crawler.close();`;

  const eventHandlers = `const crawler = new Crawler(options, rezo);

// Document-level events
crawler.onDocument(async (doc) => {
  console.log('Title:', doc.title);
  console.log('URL:', doc.URL);
});

crawler.onBody(async (body) => {
  console.log('Body classes:', body.className);
});

// Element selection
crawler.onElement(async (element) => {
  if (element.tagName === 'IMG') {
    console.log('Image:', element.getAttribute('src'));
  }
});

crawler.onSelection<HTMLDivElement>('.product-card', async (card) => {
  const title = card.querySelector('.title')?.textContent;
  const price = card.querySelector('.price')?.textContent;
  console.log('Product:', title, 'Price:', price);
});

// Links and anchors
crawler.onAnchor(async (anchor) => {
  console.log('Link:', anchor.href, 'Text:', anchor.textContent);
});

crawler.onAnchor('a[href^="http"]', async (anchor) => {
  console.log('External link:', anchor.href);
});

crawler.onHref(async (href) => {
  console.log('URL found:', href);
});

// Attribute extraction
crawler.onAttribute('img', 'src', async (src) => {
  console.log('Image source:', src);
});

crawler.onAttribute('data-id', async (id) => {
  console.log('Data ID:', id);
});

// Text content
crawler.onText('h1, h2, h3', async (text) => {
  console.log('Heading:', text.trim());
});`;

  const dataEvents = `// JSON responses
crawler.onJson<{users: User[]}>(async (data) => {
  console.log('Users:', data.users.length);
  for (const user of data.users) {
    console.log(user.name, user.email);
  }
});

// Raw response data
crawler.onRawData(async (buffer) => {
  console.log('Response size:', buffer.length, 'bytes');
  await fs.writeFile('response.bin', buffer);
});

// HTTP response metadata
crawler.onResponse(async (response) => {
  console.log('Status:', response.status);
  console.log('Content-Type:', response.contentType);
  console.log('Final URL:', response.finalUrl);
  console.log('Headers:', response.headers);
});

// Error handling
crawler.onError<RezoError>(async (error) => {
  console.error('Crawl error:', error.message);
  console.error('URL:', error.url);
  console.error('Status:', error.status);
});`;

  const visitOptions = `// Basic visit
crawler.visit('/page1');

// With full options
crawler.visit('/api/data', {
  method: 'POST',
  body: JSON.stringify({ query: 'search' }),
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000,
  maxRedirects: 5,
  maxRetryAttempts: 3,
  retryDelay: 1000,
  retryOnStatusCode: [429, 500, 502, 503],
  forceRevisit: true,      // Force visit even if cached
  useProxy: true,          // Use configured proxy
  extractLeads: true,      // Enable email extraction
  rejectUnauthorized: true,
  params: { page: 1, limit: 10 }
});

// Chain multiple visits
crawler
  .visit('/page1')
  .visit('/page2')
  .visit('/page3');

await crawler.waitForAll();`;

  const emailExtraction = `// Single email discovery
crawler.onEmailDiscovered(async (event) => {
  console.log('Email:', event.email);
  console.log('Found on:', event.url);
  console.log('Context:', event.context);
});

// Bulk email leads
crawler.onEmailLeads(async (emails) => {
  console.log('Found', emails.length, 'emails');
  await saveToDatabase(emails);
});

// Enable email extraction on visit
crawler.visit('/contact', {
  extractLeads: true
});

// Deep email finder (follows links)
crawler.visit('/about', {
  deepEmailFinder: true
});`;

  const domainConfig = `const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Per-domain proxy configuration
  proxy: {
    enable: true,
    proxies: [
      { 
        domain: 'api.example.com',
        proxy: { host: 'proxy1.com', port: 8080 }
      },
      { 
        domain: ['shop.example.com', 'store.example.com'],
        proxy: { protocol: 'socks5', host: 'proxy2.com', port: 1080 }
      },
      {
        domain: '*',       // Global fallback
        isGlobal: true,
        proxy: { host: 'default-proxy.com', port: 8080 }
      }
    ]
  },
  
  // Per-domain rate limiting
  limiter: {
    enable: true,
    limiters: [
      {
        domain: 'api.example.com',
        options: { concurrency: 2, interval: 1000 }
      },
      {
        domain: '*',
        isGlobal: true,
        options: { concurrency: 10 }
      }
    ]
  },
  
  // Per-domain headers
  headers: {
    enable: true,
    httpHeaders: [
      {
        domain: 'api.example.com',
        headers: { 'Authorization': 'Bearer token' }
      }
    ]
  }
}, rezo);`;

  const caching = `const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Caching configuration
  enableCache: true,
  cacheDir: './cache',           // Cache directory
  cacheTTL: 7 * 24 * 60 * 60 * 1000,  // 7 days in ms
  
  // Retry configuration
  maxRetryAttempts: 3,
  retryDelay: 1000,
  retryOnStatusCode: [408, 429, 500, 502, 503, 504],
  retryOnProxyError: true,
  maxRetryOnProxyError: 3,
  
  // Other options
  forceRevisit: false,          // Skip cached URLs
  allowRevisiting: false,       // Don't revisit same URL
  throwFatalError: false,       // Handle errors gracefully
  debug: true                   // Enable debug logging
}, rezo);`;

  const crawlerOptions = `interface ICrawlerOptions {
  baseUrl: string;                    // Starting URL
  rejectUnauthorized?: boolean;       // SSL cert verification (default: true)
  userAgent?: string;                 // Custom user agent
  useRndUserAgent?: boolean;          // Random user agent (default: false)
  timeout?: number;                   // Request timeout (default: 30000)
  maxRedirects?: number;              // Max redirects (default: 10)
  maxRetryAttempts?: number;          // Retry attempts (default: 3)
  retryDelay?: number;                // Delay between retries (default: 0)
  retryOnStatusCode?: number[];       // Status codes to retry
  forceRevisit?: boolean;             // Force revisit cached URLs
  retryWithoutProxyOnStatusCode?: number[];  // Retry without proxy on these codes
  retryOnProxyError?: boolean;        // Retry on proxy errors (default: true)
  maxRetryOnProxyError?: number;      // Max proxy error retries (default: 3)
  allowRevisiting?: boolean;          // Allow revisiting URLs (default: false)
  enableCache?: boolean;              // Enable response caching (default: true)
  cacheTTL?: number;                  // Cache TTL in ms (default: 7 days)
  cacheDir?: string;                  // Cache directory (default: ./cache)
  throwFatalError?: boolean;          // Throw on fatal errors (default: false)
  debug?: boolean;                    // Enable debug logging (default: false)
  proxy?: ProxyConfig;                // Per-domain proxy configuration
  limiter?: LimiterConfig;            // Per-domain rate limiting
  headers?: HeadersConfig;            // Per-domain headers
}`;
</script>

<svelte:head>
  <title>Crawler Plugin - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Crawler Plugin</h1>
    <p class="text-lg" style="color: var(--muted);">
      Event-driven web crawler for HTML parsing, data extraction, and email lead discovery.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Getting Started</h2>
    <p class="mb-4" style="color: var(--muted);">
      The Crawler plugin provides a powerful event-driven API for web scraping and data extraction.
      It features caching, proxy rotation, retry mechanisms, and intelligent email lead discovery.
    </p>
    <CodeBlock code={basicCrawler} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Event Handlers</h2>
    <p class="mb-4" style="color: var(--muted);">
      Register handlers for various parsing events. All handlers are chainable and receive parsed DOM elements.
    </p>
    <CodeBlock code={eventHandlers} language="typescript" />
    
    <div class="mt-6 overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th class="text-left py-3 px-4">Event</th>
            <th class="text-left py-3 px-4">Description</th>
            <th class="text-left py-3 px-4">Callback Type</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onDocument</td>
            <td class="py-3 px-4">Full parsed HTML document</td>
            <td class="py-3 px-4 font-mono text-xs">Document</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onBody</td>
            <td class="py-3 px-4">Document body element</td>
            <td class="py-3 px-4 font-mono text-xs">HTMLBodyElement</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onElement</td>
            <td class="py-3 px-4">Every HTML element</td>
            <td class="py-3 px-4 font-mono text-xs">HTMLElement</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onSelection</td>
            <td class="py-3 px-4">Elements matching CSS selector</td>
            <td class="py-3 px-4 font-mono text-xs">T extends Element</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onAnchor</td>
            <td class="py-3 px-4">Anchor elements (optionally filtered)</td>
            <td class="py-3 px-4 font-mono text-xs">HTMLAnchorElement</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onHref</td>
            <td class="py-3 px-4">Resolved URLs from anchors/links</td>
            <td class="py-3 px-4 font-mono text-xs">string</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onAttribute</td>
            <td class="py-3 px-4">Attribute values from elements</td>
            <td class="py-3 px-4 font-mono text-xs">string</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">onText</td>
            <td class="py-3 px-4">Text content of matching elements</td>
            <td class="py-3 px-4 font-mono text-xs">string</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Data & Response Events</h2>
    <p class="mb-4" style="color: var(--muted);">
      Handle JSON responses, raw data, response metadata, and errors.
    </p>
    <CodeBlock code={dataEvents} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Visit Options</h2>
    <p class="mb-4" style="color: var(--muted);">
      The visit method accepts a URL and optional configuration to customize each request.
    </p>
    <CodeBlock code={visitOptions} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Email Extraction</h2>
    <p class="mb-4" style="color: var(--muted);">
      Built-in email discovery with individual and bulk event handlers.
    </p>
    <CodeBlock code={emailExtraction} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Domain-Specific Configuration</h2>
    <p class="mb-4" style="color: var(--muted);">
      Configure proxies, rate limiting, and headers on a per-domain basis with pattern matching.
    </p>
    <CodeBlock code={domainConfig} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Caching & Retry</h2>
    <p class="mb-4" style="color: var(--muted);">
      Built-in SQLite-based caching and intelligent retry logic.
    </p>
    <CodeBlock code={caching} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Configuration Reference</h2>
    <p class="mb-4" style="color: var(--muted);">
      Complete list of crawler configuration options.
    </p>
    <CodeBlock code={crawlerOptions} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Lifecycle Methods</h2>
    <div class="mt-4 overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th class="text-left py-3 px-4">Method</th>
            <th class="text-left py-3 px-4">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">visit(url, options?)</td>
            <td class="py-3 px-4">Queue a URL for crawling</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">waitForAll()</td>
            <td class="py-3 px-4">Wait for all queued visits to complete</td>
          </tr>
          <tr style="border-bottom: 1px solid var(--border);">
            <td class="py-3 px-4 font-mono text-sm">close()</td>
            <td class="py-3 px-4">Close caches and cleanup resources</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</div>
