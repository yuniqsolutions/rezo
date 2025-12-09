<svelte:head>
  <title>Introduction - Rezo Documentation</title>
</svelte:head>

<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';
  
  const quickExample = `import rezo from 'rezo';

// Simple GET request
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);

// POST with JSON body
const user = await rezo.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// With full configuration
const data = await rezo.request({
  method: 'GET',
  url: 'https://api.example.com/posts',
  headers: { 'Authorization': 'Bearer token' },
  timeout: 5000,
  retry: { attempts: 3 }
});`;

  const features = [
    { icon: '⚡', title: 'HTTP/2 Support', desc: 'Native HTTP/2 with session pooling and multiplexing.' },
    { icon: '🍪', title: 'Cookie Management', desc: 'Automatic cookie persistence with tough-cookie.' },
    { icon: '🌐', title: 'Proxy Support', desc: 'HTTP, HTTPS, SOCKS4/5 with rotation.' },
    { icon: '🔄', title: 'Retry Logic', desc: 'Exponential backoff with custom strategies.' },
    { icon: '🪝', title: 'Hooks System', desc: 'Request/response interception at any stage.' },
    { icon: '📊', title: 'Request Queue', desc: 'Priority, concurrency, and rate limiting.' },
  ];
</script>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Introduction</h1>
    <p class="text-lg" style="color: var(--muted);">
      Welcome to Rezo, an enterprise-grade HTTP client library for Node.js 22+ and universal JavaScript runtimes.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">What is Rezo?</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo is a powerful, flexible HTTP client designed for modern JavaScript development. It provides 
      a clean, intuitive API while supporting advanced features like HTTP/2, intelligent cookie management, 
      proxy rotation, and comprehensive streaming support.
    </p>
    <p style="color: var(--muted);">
      Whether you're building a simple API client or a complex web scraper, Rezo gives you the tools 
      you need without compromising on performance or developer experience.
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Quick Example</h2>
    <CodeBlock code={quickExample} language="typescript" filename="example.ts" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-6">Key Features</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      {#each features as feature}
        <div 
          class="p-4 rounded-xl border"
          style="background-color: var(--surface); border-color: var(--border);"
        >
          <div class="flex items-start gap-3">
            <span class="text-2xl">{feature.icon}</span>
            <div>
              <h3 class="font-semibold mb-1">{feature.title}</h3>
              <p class="text-sm" style="color: var(--muted);">{feature.desc}</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Supported Environments</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo works across all major JavaScript runtimes:
    </p>
    <ul class="space-y-2" style="color: var(--muted);">
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>Node.js 22+</strong> - Full feature support with native HTTP/2
      </li>
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>Bun</strong> - Optimized for Bun's fast runtime
      </li>
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>Deno</strong> - Works with Deno's Node.js compatibility
      </li>
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>Browsers</strong> - Via Fetch or XHR adapters
      </li>
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>React Native</strong> - Dedicated mobile adapter
      </li>
      <li class="flex items-center gap-2">
        <span class="text-green-500">&#10003;</span>
        <strong>Edge Runtimes</strong> - Cloudflare Workers, Vercel Edge, etc.
      </li>
    </ul>
  </section>

  <section class="flex items-center gap-4">
    <button 
      on:click={() => navigate('/installation')}
      class="gradient-bg text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity cursor-pointer"
    >
      Get Started
    </button>
    <button 
      on:click={() => navigate('/quick-start')}
      class="px-6 py-3 rounded-lg font-semibold border transition-colors hover:bg-[var(--surface)] cursor-pointer"
      style="border-color: var(--border); color: var(--text);"
    >
      Quick Start Guide
    </button>
  </section>
</div>
