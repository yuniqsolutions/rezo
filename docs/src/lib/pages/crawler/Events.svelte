<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Crawler Event Handlers - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>Event Handlers</h1>
  <p class="lead">
    The Crawler uses an event-driven architecture with chainable handlers for different parsing stages.
  </p>

  <h2>Document Events</h2>

  <h3>onDocument</h3>
  <p>Access the full parsed Document object.</p>
  <CodeBlock 
    code={`crawler.onDocument(async (doc) => {
  console.log('Title:', doc.title);
  console.log('URL:', doc.URL);
  
  const meta = doc.querySelector('meta[name="description"]');
  console.log('Description:', meta?.getAttribute('content'));
});`}
    language="typescript"
  />

  <h3>onBody</h3>
  <p>Access the document body element.</p>
  <CodeBlock 
    code={`crawler.onBody(async (body) => {
  const text = body.textContent;
  console.log('Body text length:', text?.length);
});`}
    language="typescript"
  />

  <h2>Element Events</h2>

  <h3>onElement</h3>
  <p>Called for every HTML element in the document.</p>
  <CodeBlock 
    code={`crawler.onElement(async (element) => {
  if (element.tagName === 'IMG') {
    console.log('Image src:', element.getAttribute('src'));
  }
});`}
    language="typescript"
  />

  <h3>onSelection</h3>
  <p>Select elements matching a CSS selector. Most commonly used for scraping.</p>
  <CodeBlock 
    code={`// Type-safe element selection
crawler.onSelection<HTMLDivElement>('.product-card', async (card) => {
  const name = card.querySelector('.name')?.textContent;
  const price = card.querySelector('.price')?.textContent;
  const image = card.querySelector('img')?.src;
  
  products.push({ name, price, image });
});

// Multiple selectors
crawler.onSelection('.article', async (article) => {
  // Handle articles
});

crawler.onSelection('.sidebar-item', async (item) => {
  // Handle sidebar items
});`}
    language="typescript"
  />

  <h2>Link Events</h2>

  <h3>onAnchor</h3>
  <p>Handle anchor elements. Can optionally filter by CSS selector.</p>
  <CodeBlock 
    code={`// All links
crawler.onAnchor(async (anchor) => {
  console.log('Link text:', anchor.textContent);
  console.log('Link href:', anchor.href);
});

// Filtered by selector
crawler.onAnchor('.nav-link', async (anchor) => {
  // Only navigation links
  crawler.visit(anchor.href);
});`}
    language="typescript"
  />

  <h3>onHref</h3>
  <p>Get raw href strings from all anchor elements.</p>
  <CodeBlock 
    code={`crawler.onHref(async (href) => {
  if (href.includes('/products/')) {
    crawler.visit(href);
  }
});`}
    language="typescript"
  />

  <h2>Text & Attribute Events</h2>

  <h3>onText</h3>
  <p>Extract text content from elements matching a selector.</p>
  <CodeBlock 
    code={`crawler.onText('h1', async (text) => {
  console.log('Page heading:', text);
});

crawler.onText('.article-content p', async (text) => {
  paragraphs.push(text);
});`}
    language="typescript"
  />

  <h3>onAttribute</h3>
  <p>Extract attribute values from elements.</p>
  <CodeBlock 
    code={`// Get all image sources
crawler.onAttribute('src', async (src) => {
  imageUrls.push(src);
});

// Get data attributes from specific elements
crawler.onAttribute('data-id', '.product-card', async (id) => {
  productIds.push(id);
});`}
    language="typescript"
  />

  <h2>Response Events</h2>

  <h3>onResponse</h3>
  <p>Access HTTP response metadata.</p>
  <CodeBlock 
    code={`crawler.onResponse(async (response) => {
  console.log('Status:', response.status);
  console.log('Content-Type:', response.contentType);
  console.log('Final URL:', response.finalUrl);
  console.log('Headers:', response.headers);
});`}
    language="typescript"
  />

  <h3>onRawData</h3>
  <p>Access raw response buffer (for binary data).</p>
  <CodeBlock 
    code={`crawler.onRawData(async (buffer) => {
  // Save binary response
  fs.writeFileSync('output.bin', buffer);
});`}
    language="typescript"
  />

  <h3>onJson</h3>
  <p>Automatically parse JSON responses.</p>
  <CodeBlock 
    code={`interface ApiResponse {
  users: { id: number; name: string }[];
  total: number;
}

crawler.onJson<ApiResponse>(async (data) => {
  console.log('Total users:', data.total);
  for (const user of data.users) {
    console.log('User:', user.name);
  }
});`}
    language="typescript"
  />

  <h2>Error Events</h2>

  <h3>onError</h3>
  <p>Handle errors during crawling.</p>
  <CodeBlock 
    code={`import { RezoError } from 'rezo';

crawler.onError<RezoError>(async (error) => {
  console.error('Crawl error:', error.message);
  console.error('URL:', error.url);
  console.error('Status:', error.status);
  
  // Log to file or monitoring service
  await logError(error);
});`}
    language="typescript"
  />

  <h2>Email Discovery Events</h2>

  <h3>onEmailDiscovered</h3>
  <p>Called when an individual email address is found.</p>
  <CodeBlock 
    code={`crawler.onEmailDiscovered(async (event) => {
  console.log('Email found:', event.email);
  console.log('Source URL:', event.url);
  console.log('Context:', event.context);
});`}
    language="typescript"
  />

  <h3>onEmailLeads</h3>
  <p>Called with batch of discovered emails after crawling completes.</p>
  <CodeBlock 
    code={`crawler.onEmailLeads(async (emails) => {
  console.log('All emails found:', emails);
  await saveToDatabase(emails);
});`}
    language="typescript"
  />

  <h2>Chaining Handlers</h2>
  <p>All event handlers return the Crawler instance for fluent chaining.</p>
  <CodeBlock 
    code={`crawler
  .onDocument(async (doc) => { /* ... */ })
  .onSelection('.product', async (el) => { /* ... */ })
  .onAnchor('.pagination a', async (link) => { /* ... */ })
  .onError(async (err) => { /* ... */ })
  .visit('/products')
  .visit('/categories');

await crawler.waitForAll();`}
    language="typescript"
  />

  <h2>Execution Control</h2>

  <h3>visit</h3>
  <p>Queue a URL for crawling.</p>
  <CodeBlock 
    code={`// Visit single URL
crawler.visit('/page');

// Visit with query parameters
crawler.visit('/search', { q: 'keyword', page: 1 });

// Chain visits
crawler
  .visit('/page1')
  .visit('/page2')
  .visit('/page3');`}
    language="typescript"
  />

  <h3>waitForAll</h3>
  <p>Wait for all queued visits to complete.</p>
  <CodeBlock 
    code={`await crawler.waitForAll();
console.log('Crawling complete!');`}
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
</style>
