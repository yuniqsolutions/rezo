<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const getRequest = `import rezo from 'rezo';

// Simple GET request
const response = await rezo.get('https://api.example.com/users');

console.log(response.status);     // 200
console.log(response.data);       // Response body (auto-parsed JSON)
console.log(response.headers);    // Response headers`;

  const postRequest = `// POST with JSON body
const response = await rezo.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com',
  role: 'admin'
});

console.log(response.data); // Created user object`;

  const allMethods = `// All HTTP methods
await rezo.get(url);
await rezo.post(url, data);
await rezo.put(url, data);
await rezo.patch(url, data);
await rezo.delete(url);
await rezo.head(url);
await rezo.options(url);

// With request config
await rezo.get(url, { headers: { ... }, timeout: 5000 });
await rezo.post(url, data, { headers: { ... } });`;

  const requestMethod = `// Using the request method
const response = await rezo.request({
  method: 'POST',
  url: 'https://api.example.com/users',
  data: {
    name: 'John Doe',
    email: 'john@example.com'
  },
  headers: {
    'Authorization': 'Bearer your-token-here',
    'Content-Type': 'application/json'
  },
  timeout: 10000
});`;

  const errorHandling = `import { rezo, RezoError } from 'rezo';

try {
  const response = await rezo.get('https://api.example.com/users/999');
  console.log(response.data);
} catch (error) {
  if (RezoError.isRezoError(error)) {
    // HTTP error (4xx, 5xx)
    if (error.isHttpError) {
      console.log('Status:', error.status);        // 404
      console.log('Response:', error.response?.data);
    }
    
    // Network/timeout error
    if (error.isNetworkError) {
      console.log('Network failed:', error.message);
    }
    
    if (error.isTimeout) {
      console.log('Request timed out');
    }
    
    // Helpful error info
    console.log('Details:', error.details);
    console.log('Suggestion:', error.suggestion);
  }
}`;

  const createInstance = `// Create a configured instance
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  }
});

// Use the instance
const users = await api.get('/users');
const posts = await api.get('/posts');
const newUser = await api.post('/users', { name: 'Jane' });`;

  const queryParams = `// Query parameters in URL
await rezo.get('https://api.example.com/users?page=1&limit=10');

// Using params option
await rezo.get('https://api.example.com/users', {
  params: {
    page: 1,
    limit: 10,
    sort: 'name',
    filter: ['active', 'verified']
  }
});
// Results in: /users?page=1&limit=10&sort=name&filter=active&filter=verified`;
</script>

<svelte:head>
  <title>Quick Start - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Quick Start</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn the basics of making HTTP requests with Rezo in just a few minutes.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Making a GET Request</h2>
    <p class="mb-4" style="color: var(--muted);">
      The simplest way to fetch data from an API:
    </p>
    <CodeBlock code={getRequest} language="typescript" filename="get-example.ts" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Making a POST Request</h2>
    <p class="mb-4" style="color: var(--muted);">
      Send data to create a new resource:
    </p>
    <CodeBlock code={postRequest} language="typescript" filename="post-example.ts" />
    <p class="mt-4 text-sm" style="color: var(--muted);">
      Rezo automatically sets the <code>Content-Type</code> header to <code>application/json</code> 
      and serializes the object to JSON.
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">All HTTP Methods</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo provides convenience methods for all standard HTTP methods:
    </p>
    <CodeBlock code={allMethods} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Using the Request Method</h2>
    <p class="mb-4" style="color: var(--muted);">
      For full control, use the <code>request()</code> method with a configuration object:
    </p>
    <CodeBlock code={requestMethod} language="typescript" filename="request-example.ts" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Query Parameters</h2>
    <p class="mb-4" style="color: var(--muted);">
      Add query parameters to your requests:
    </p>
    <CodeBlock code={queryParams} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Handling</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo throws errors for non-2xx status codes. Handle them with try/catch:
    </p>
    <CodeBlock code={errorHandling} language="typescript" filename="error-handling.ts" />
    
    <div class="mt-6 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-2">Important</h4>
      <p class="text-sm" style="color: var(--muted);">
        Unlike some HTTP clients, Rezo throws errors for 4xx and 5xx status codes by default.
        This integrates well with retry logic - if you configure retry for specific status codes,
        Rezo will retry first before throwing.
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Creating an Instance</h2>
    <p class="mb-4" style="color: var(--muted);">
      Create a configured instance for a specific API:
    </p>
    <CodeBlock code={createInstance} language="typescript" filename="api-instance.ts" />
  </section>

  <section class="grid sm:grid-cols-2 gap-4">
    <button on:click={() => navigate('/requests')} class="p-6 rounded-xl border transition-colors hover:border-primary-500/50 text-left" style="background-color: var(--surface); border-color: var(--border);">
      <h3 class="font-semibold mb-2">Making Requests →</h3>
      <p class="text-sm" style="color: var(--muted);">Deep dive into request options and body types</p>
    </button>
    <button on:click={() => navigate('/responses')} class="p-6 rounded-xl border transition-colors hover:border-primary-500/50 text-left" style="background-color: var(--surface); border-color: var(--border);">
      <h3 class="font-semibold mb-2">Response Handling →</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about response data, headers, and cookies</p>
    </button>
  </section>
</div>
