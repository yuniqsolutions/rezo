<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const jsonBody = `// JSON body (default)
await rezo.post('/api/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
// Content-Type: application/json is set automatically`;

  const formData = `import { RezoFormData } from 'rezo';

// Using RezoFormData
const form = new RezoFormData();
form.append('name', 'John Doe');
form.append('avatar', fs.createReadStream('./avatar.png'), {
  filename: 'avatar.png',
  contentType: 'image/png'
});

await rezo.post('/api/upload', form);

// Or use postMultipart helper
await rezo.postMultipart('/api/upload', {
  name: 'John Doe',
  avatar: fs.createReadStream('./avatar.png')
});

// Nested objects are JSON stringified
await rezo.postMultipart('/api/data', {
  name: 'John',
  metadata: { role: 'admin', active: true }, // → JSON string
  tags: ['javascript', 'http']                // → multiple entries
});`;

  const urlencoded = `// URL-encoded form data
await rezo.post('/api/login', new URLSearchParams({
  username: 'john',
  password: 'secret123'
}));
// Content-Type: application/x-www-form-urlencoded`;

  const streamBody = `import { createReadStream } from 'fs';

// Stream a file as request body
const stream = createReadStream('./large-file.zip');
await rezo.post('/api/upload', stream, {
  headers: {
    'Content-Type': 'application/zip',
    'Content-Length': '104857600' // 100MB
  }
});`;

  const headers = `// Custom headers
await rezo.get('/api/protected', {
  headers: {
    'Authorization': 'Bearer your-token',
    'X-Custom-Header': 'custom-value',
    'Accept': 'application/json'
  }
});

// Headers are case-insensitive
await rezo.get('/api/data', {
  headers: {
    'content-type': 'application/json',  // Works the same as
    'Content-Type': 'application/json'   // this
  }
});`;

  const timeout = `// Request timeout (in milliseconds)
await rezo.get('/api/slow-endpoint', {
  timeout: 30000 // 30 seconds
});

// Different timeout types
await rezo.get('/api/data', {
  timeout: {
    connection: 5000,  // Time to establish connection
    request: 30000,    // Total request time
    response: 10000    // Time waiting for response
  }
});`;

  const auth = `// Basic authentication
await rezo.get('/api/protected', {
  auth: {
    username: 'user',
    password: 'pass'
  }
});

// Bearer token (using headers)
await rezo.get('/api/protected', {
  headers: {
    'Authorization': 'Bearer your-jwt-token'
  }
});

// With cURL adapter: NTLM, Digest auth
import rezo from 'rezo/adapters/curl';

await rezo.get('/api/ntlm-protected', {
  auth: {
    username: 'domain\\\\user',
    password: 'pass',
    type: 'ntlm'
  }
});`;

  const responseType = `// Response types
await rezo.get('/api/users');                    // Auto-detect (JSON/text)
await rezo.get('/api/users', { responseType: 'json' });
await rezo.get('/api/page', { responseType: 'text' });
await rezo.get('/api/file', { responseType: 'arraybuffer' });
await rezo.get('/api/file', { responseType: 'blob' });
await rezo.get('/api/stream', { responseType: 'stream' });`;

  const abort = `// Abort controller for cancellation
const controller = new AbortController();

const request = rezo.get('/api/long-running', {
  signal: controller.signal
});

// Cancel the request after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const response = await request;
} catch (error) {
  if (error.isAborted) {
    console.log('Request was cancelled');
  }
}`;
</script>

<svelte:head>
  <title>Making Requests - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Making Requests</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn about different request body types, headers, authentication, and more.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">JSON Body</h2>
    <p class="mb-4" style="color: var(--muted);">
      By default, objects are serialized as JSON:
    </p>
    <CodeBlock code={jsonBody} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Form Data (Multipart)</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use RezoFormData for file uploads and multipart form data:
    </p>
    <CodeBlock code={formData} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">URL-Encoded Data</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use URLSearchParams for form submissions:
    </p>
    <CodeBlock code={urlencoded} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Stream Body</h2>
    <p class="mb-4" style="color: var(--muted);">
      Stream large files without loading them into memory:
    </p>
    <CodeBlock code={streamBody} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Custom Headers</h2>
    <CodeBlock code={headers} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Timeouts</h2>
    <CodeBlock code={timeout} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Authentication</h2>
    <CodeBlock code={auth} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Types</h2>
    <CodeBlock code={responseType} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Request Cancellation</h2>
    <CodeBlock code={abort} language="typescript" />
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Response Handling</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about response data, headers, and cookies</p>
    </div>
    <button on:click={() => navigate('/responses')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
