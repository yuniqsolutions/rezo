<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>DOM Module - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>DOM Module</h1>
  <p class="lead">
    The DOM module provides server-side HTML parsing capabilities using <a href="https://github.com/WebReflection/linkedom" target="_blank" rel="noopener">linkedom</a>. It enables DOM manipulation in Node.js environments without a browser.
  </p>

  <h2>Import</h2>
  <CodeBlock 
    code={`import { parseHTML, DOMParser } from 'rezo/dom';`}
    language="typescript"
  />

  <h2>Parsing HTML</h2>
  <CodeBlock 
    code={`import { parseHTML } from 'rezo/dom';

const html = \`
<!DOCTYPE html>
<html>
  <head><title>Example</title></head>
  <body>
    <h1>Hello World</h1>
    <ul class="items">
      <li>Item 1</li>
      <li>Item 2</li>
      <li>Item 3</li>
    </ul>
  </body>
</html>
\`;

const { document, window } = parseHTML(html);

// Use standard DOM APIs
const title = document.querySelector('title')?.textContent;
console.log(title); // "Example"

const items = document.querySelectorAll('.items li');
items.forEach(item => console.log(item.textContent));`}
    language="typescript"
  />

  <h2>Using with Rezo Requests</h2>
  <CodeBlock 
    code={`import rezo from 'rezo';
import { parseHTML } from 'rezo/dom';

const response = await rezo.get('https://example.com');
const { document } = parseHTML(response.data);

// Extract data from the page
const heading = document.querySelector('h1')?.textContent;
const links = document.querySelectorAll('a');

const hrefs = Array.from(links).map(link => ({
  text: link.textContent,
  href: link.getAttribute('href')
}));`}
    language="typescript"
  />

  <h2>DOMParser</h2>
  <CodeBlock 
    code={`import { DOMParser } from 'rezo/dom';

const parser = new DOMParser();
const doc = parser.parseFromString('<div>Hello</div>', 'text/html');

const div = doc.querySelector('div');
console.log(div?.textContent); // "Hello"`}
    language="typescript"
  />

  <h2>Available Exports</h2>
  <p>
    The DOM module re-exports the following from linkedom:
  </p>
  <table>
    <thead>
      <tr>
        <th>Export</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>parseHTML</code></td>
        <td>Parse HTML string and return document + window</td>
      </tr>
      <tr>
        <td><code>DOMParser</code></td>
        <td>Standard DOMParser implementation</td>
      </tr>
      <tr>
        <td><code>Document</code></td>
        <td>Document class</td>
      </tr>
      <tr>
        <td><code>Element</code></td>
        <td>Element class</td>
      </tr>
      <tr>
        <td><code>HTMLElement</code></td>
        <td>HTMLElement class</td>
      </tr>
    </tbody>
  </table>

  <h2>Common Patterns</h2>

  <h3>Extracting Links</h3>
  <CodeBlock 
    code={`import { parseHTML } from 'rezo/dom';

function extractLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const links = document.querySelectorAll('a[href]');
  
  return Array.from(links)
    .map(a => a.getAttribute('href'))
    .filter(Boolean)
    .map(href => new URL(href!, baseUrl).toString());
}`}
    language="typescript"
  />

  <h3>Extracting Structured Data</h3>
  <CodeBlock 
    code={`import { parseHTML } from 'rezo/dom';

interface Product {
  name: string;
  price: string;
  image: string;
}

function extractProducts(html: string): Product[] {
  const { document } = parseHTML(html);
  const productElements = document.querySelectorAll('.product');
  
  return Array.from(productElements).map(el => ({
    name: el.querySelector('.name')?.textContent || '',
    price: el.querySelector('.price')?.textContent || '',
    image: el.querySelector('img')?.getAttribute('src') || ''
  }));
}`}
    language="typescript"
  />

  <h3>Form Data Extraction</h3>
  <CodeBlock 
    code={`import { parseHTML } from 'rezo/dom';

function extractFormData(html: string): Record<string, string> {
  const { document } = parseHTML(html);
  const form = document.querySelector('form');
  
  if (!form) return {};
  
  const data: Record<string, string> = {};
  const inputs = form.querySelectorAll('input[name]');
  
  inputs.forEach(input => {
    const name = input.getAttribute('name');
    const value = input.getAttribute('value') || '';
    if (name) data[name] = value;
  });
  
  return data;
}`}
    language="typescript"
  />

  <div class="tip">
    <strong>Tip:</strong> For web crawling use cases, consider using the <a href="/crawler">Crawler</a> which provides built-in DOM parsing with event handlers for elements, links, and text content.
  </div>
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
  
  .lead a {
    color: var(--primary);
    text-decoration: underline;
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
  
  .tip {
    background: var(--code-bg);
    border-left: 4px solid var(--primary);
    padding: 1rem;
    margin: 1.5rem 0;
    border-radius: 0.25rem;
  }
  
  .tip a {
    color: var(--primary);
    text-decoration: underline;
  }
</style>
