<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/fetch';

// Works in browsers, Node.js, Deno, and edge runtimes
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);`;

  const browserUsage = `// Browser environment
import rezo from 'rezo/adapters/fetch';

// CORS requests
const response = await rezo.get('https://api.example.com/data', {
  mode: 'cors',
  credentials: 'include' // Send cookies
});

// Credentials options
await rezo.get('/api/protected', { credentials: 'same-origin' });
await rezo.get('https://other.com/api', { credentials: 'include' });
await rezo.get('/api/public', { credentials: 'omit' });`;

  const edgeRuntime = `// Cloudflare Workers / Vercel Edge
import rezo from 'rezo/adapters/fetch';

export default {
  async fetch(request: Request): Promise<Response> {
    // Fetch adapter is the only one that works in edge runtimes
    const data = await rezo.get('https://api.example.com/data');
    
    return new Response(JSON.stringify(data.data), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`;

  const nodeJsMode = `// Node.js mode (different from browser mode)
// In Node.js, Fetch adapter supports cookies and proxies

import rezo from 'rezo/adapters/fetch';
import { RezoCookieJar } from 'rezo';

// Cookie jar works in Node.js - use jar when creating an instance
const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });
await client.get('https://example.com');

// Proxy works in Node.js
await rezo.get('https://example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});`;

  const streaming = `// Streaming with Fetch adapter
const response = await rezo.get('https://example.com/stream', {
  responseType: 'stream'
});

// response.data is a ReadableStream
const reader = response.data.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('Chunk:', value);
}`;
</script>

<svelte:head>
  <title>Fetch Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">🌍</span>
      <h1 class="text-3xl sm:text-4xl font-bold">Fetch Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      Universal Fetch API adapter for browsers, Node.js, and edge runtimes. 
      The most portable adapter with minimal bundle size.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Browser Usage</h2>
    <p class="mb-4" style="color: var(--muted);">
      In browsers, Fetch adapter uses native Fetch API with CORS support:
    </p>
    <CodeBlock code={browserUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Edge Runtimes</h2>
    <p class="mb-4" style="color: var(--muted);">
      The Fetch adapter is the only one that works in edge runtimes:
    </p>
    <CodeBlock code={edgeRuntime} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Node.js Mode</h2>
    <p class="mb-4" style="color: var(--muted);">
      In Node.js, Fetch adapter gains additional features:
    </p>
    <CodeBlock code={nodeJsMode} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Streaming</h2>
    <CodeBlock code={streaming} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Dual-Mode Features</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b" style="border-color: var(--border);">
            <th class="text-left py-3 px-4">Feature</th>
            <th class="text-center py-3 px-4">Browser</th>
            <th class="text-center py-3 px-4">Node.js</th>
            <th class="text-center py-3 px-4">Edge</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Basic Requests</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Cookie Jar</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Proxy Support</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Streaming</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">CORS</td>
            <td class="text-center">✅</td>
            <td class="text-center">N/A</td>
            <td class="text-center">N/A</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: cURL Adapter</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about advanced auth and debugging</p>
    </div>
    <button on:click={() => navigate('/adapters/curl')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
