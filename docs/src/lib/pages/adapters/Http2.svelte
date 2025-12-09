<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/http2';

// Uses HTTP/2 with session pooling
const response = await rezo.get('https://api.example.com/users');

// Multiple requests to same origin share a session
await Promise.all([
  rezo.get('https://api.example.com/users'),
  rezo.get('https://api.example.com/posts'),
  rezo.get('https://api.example.com/comments'),
]); // All multiplexed over single connection`;

  const sessionPooling = `// Sessions are automatically pooled per origin
// This is handled internally - no configuration needed

// First request: creates new HTTP/2 session
await rezo.get('https://api.example.com/a');

// Subsequent requests: reuse existing session
await rezo.get('https://api.example.com/b');
await rezo.get('https://api.example.com/c');

// Different origin: creates new session
await rezo.get('https://other-api.com/data');

// Sessions are cleaned up on process exit`;

  const alpn = `// ALPN (Application-Layer Protocol Negotiation)
// HTTP/2 adapter automatically negotiates the best protocol

// If server supports HTTP/2 → uses HTTP/2
// If server only supports HTTP/1.1 → falls back automatically

const response = await rezo.get('https://api.example.com');
console.log(response.httpVersion); // '2' or '1.1'`;

  const multiplexing = `// HTTP/2 multiplexing benefits
// Multiple requests share a single TCP connection

const start = Date.now();

// These all run concurrently over one connection
const results = await Promise.all([
  rezo.get('https://api.example.com/resource/1'),
  rezo.get('https://api.example.com/resource/2'),
  rezo.get('https://api.example.com/resource/3'),
  rezo.get('https://api.example.com/resource/4'),
  rezo.get('https://api.example.com/resource/5'),
]);

console.log(\`Completed in \${Date.now() - start}ms\`);
// Much faster than HTTP/1.1 which would open 5 connections`;

  const formData = `import rezo from 'rezo/adapters/http2';
import { RezoFormData } from 'rezo';

// FormData works with HTTP/2
// Headers are set before request creation (HTTP/2 requirement)
const form = new RezoFormData();
form.append('file', fs.createReadStream('./upload.pdf'));
form.append('name', 'document.pdf');

await rezo.post('https://api.example.com/upload', form);

// Or use postMultipart helper
await rezo.postMultipart('https://api.example.com/upload', {
  file: fs.createReadStream('./upload.pdf'),
  name: 'document.pdf'
});`;
</script>

<svelte:head>
  <title>HTTP/2 Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">⚡</span>
      <h1 class="text-3xl sm:text-4xl font-bold">HTTP/2 Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      HTTP/2 adapter with session pooling, stream multiplexing, ALPN negotiation, 
      and automatic cleanup. Perfect for high-performance API clients.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Session Pooling</h2>
    <p class="mb-4" style="color: var(--muted);">
      HTTP/2 sessions are automatically pooled and reused:
    </p>
    <CodeBlock code={sessionPooling} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">ALPN Negotiation</h2>
    <p class="mb-4" style="color: var(--muted);">
      Automatically negotiates the best protocol with the server:
    </p>
    <CodeBlock code={alpn} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Multiplexing Benefits</h2>
    <p class="mb-4" style="color: var(--muted);">
      Multiple requests share a single connection for better performance:
    </p>
    <CodeBlock code={multiplexing} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">FormData Handling</h2>
    <p class="mb-4" style="color: var(--muted);">
      FormData works seamlessly with HTTP/2:
    </p>
    <CodeBlock code={formData} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">When to Use HTTP/2</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-green-400">✅ Use HTTP/2 When</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Making many requests to same origin</li>
          <li>• Need multiplexed streams</li>
          <li>• Want connection reuse</li>
          <li>• Server supports HTTP/2</li>
        </ul>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-yellow-400">⚠️ Consider HTTP Instead</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Single requests to many origins</li>
          <li>• Server doesn't support HTTP/2</li>
          <li>• Need simpler debugging</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Fetch Adapter</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about the universal Fetch adapter</p>
    </div>
    <button on:click={() => navigate('/adapters/fetch')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
