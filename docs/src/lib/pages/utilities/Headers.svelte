<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>RezoHeaders - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>RezoHeaders</h1>
  <p class="lead">
    RezoHeaders is an enhanced Headers class that provides convenient methods for working with HTTP headers, including content-type management, bearer token handling, and case-insensitive access.
  </p>

  <h2>Import</h2>
  <CodeBlock 
    code={`import { RezoHeaders } from 'rezo';`}
    language="typescript"
  />

  <h2>Creating Headers</h2>
  <CodeBlock 
    code={`// From object
const headers = new RezoHeaders({
  'Content-Type': 'application/json',
  'Authorization': 'Bearer token123'
});

// From existing Headers
const headers2 = new RezoHeaders(existingHeaders);

// Empty headers
const headers3 = new RezoHeaders();`}
    language="typescript"
  />

  <h2>Common Methods</h2>

  <h3>Content-Type Management</h3>
  <CodeBlock 
    code={`const headers = new RezoHeaders();

// Set content type
headers.setContentType('application/json');
headers.setContentType('application/x-www-form-urlencoded');
headers.setContentType('multipart/form-data');

// Get content type
const contentType = headers.getContentType();

// Check content type
if (headers.isJson()) { /* ... */ }
if (headers.isFormData()) { /* ... */ }
if (headers.isUrlEncoded()) { /* ... */ }`}
    language="typescript"
  />

  <h3>Authorization</h3>
  <CodeBlock 
    code={`const headers = new RezoHeaders();

// Set bearer token
headers.setBearer('your-jwt-token');

// Set basic auth
headers.setBasicAuth('username', 'password');

// Get authorization header
const auth = headers.get('Authorization');`}
    language="typescript"
  />

  <h3>Standard Methods</h3>
  <CodeBlock 
    code={`const headers = new RezoHeaders();

// Set header (case-insensitive key)
headers.set('X-Custom-Header', 'value');

// Get header
const value = headers.get('x-custom-header'); // Case-insensitive

// Check if header exists
if (headers.has('Content-Type')) { /* ... */ }

// Delete header
headers.delete('X-Custom-Header');

// Iterate headers
for (const [key, value] of headers) {
  console.log(\`\${key}: \${value}\`);
}

// Convert to plain object
const obj = headers.toObject();`}
    language="typescript"
  />

  <h2>Usage with Requests</h2>
  <CodeBlock 
    code={`import rezo, { RezoHeaders } from 'rezo';

const headers = new RezoHeaders();
headers.setBearer(accessToken);
headers.set('X-Request-ID', generateRequestId());

const response = await rezo.get('https://api.example.com/data', {
  headers
});`}
    language="typescript"
  />

  <h2>Method Reference</h2>
  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>set(name, value)</code></td>
        <td>Set a header value</td>
      </tr>
      <tr>
        <td><code>get(name)</code></td>
        <td>Get a header value (case-insensitive)</td>
      </tr>
      <tr>
        <td><code>has(name)</code></td>
        <td>Check if header exists</td>
      </tr>
      <tr>
        <td><code>delete(name)</code></td>
        <td>Remove a header</td>
      </tr>
      <tr>
        <td><code>setContentType(type)</code></td>
        <td>Set Content-Type header</td>
      </tr>
      <tr>
        <td><code>getContentType()</code></td>
        <td>Get Content-Type header</td>
      </tr>
      <tr>
        <td><code>setBearer(token)</code></td>
        <td>Set Bearer authorization</td>
      </tr>
      <tr>
        <td><code>setBasicAuth(user, pass)</code></td>
        <td>Set Basic authorization</td>
      </tr>
      <tr>
        <td><code>isJson()</code></td>
        <td>Check if Content-Type is JSON</td>
      </tr>
      <tr>
        <td><code>isFormData()</code></td>
        <td>Check if Content-Type is multipart</td>
      </tr>
      <tr>
        <td><code>isUrlEncoded()</code></td>
        <td>Check if Content-Type is form-urlencoded</td>
      </tr>
      <tr>
        <td><code>toObject()</code></td>
        <td>Convert to plain object</td>
      </tr>
    </tbody>
  </table>
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
