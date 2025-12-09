<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';

  const autoSelection = `// Default: Auto-selects best adapter for your runtime
import rezo from 'rezo';

// Node.js/Bun/Deno → HTTP adapter
// Browser → Fetch adapter
// React Native → React Native adapter
// Cloudflare Workers → Fetch adapter`;

  const explicitImport = `// Import specific adapters
import rezo from 'rezo/adapters/http';       // Node.js HTTP
import rezo from 'rezo/adapters/http2';      // HTTP/2
import rezo from 'rezo/adapters/fetch';      // Fetch API
import rezo from 'rezo/adapters/curl';       // cURL
import rezo from 'rezo/adapters/xhr';        // XMLHttpRequest
import rezo from 'rezo/adapters/react-native'; // React Native`;

  const adapters = [
    {
      name: 'HTTP',
      path: '/adapters/http',
      icon: '🌐',
      runtime: 'Node.js, Bun, Deno',
      description: 'Full-featured reference adapter with cookies, proxy, streaming, and compression.',
      features: ['Cookie Jar', 'All Proxy Types', 'Streaming', 'Compression', 'TLS Config']
    },
    {
      name: 'HTTP/2',
      path: '/adapters/http2',
      icon: '⚡',
      runtime: 'Node.js, Bun',
      description: 'HTTP/2 with session pooling, multiplexing, and automatic cleanup.',
      features: ['Session Pooling', 'Multiplexing', 'ALPN Negotiation', 'Fallback to HTTP/1.1']
    },
    {
      name: 'Fetch',
      path: '/adapters/fetch',
      icon: '🌍',
      runtime: 'Browser, Edge, Node.js',
      description: 'Universal Fetch API adapter for browsers and edge runtimes.',
      features: ['Browser Native', 'Edge Workers', 'Minimal Bundle', 'CORS Support']
    },
    {
      name: 'cURL',
      path: '/adapters/curl',
      icon: '🔧',
      runtime: 'Node.js (requires curl)',
      description: 'cURL command-line wrapper with 200+ options and advanced auth.',
      features: ['NTLM Auth', 'Digest Auth', 'Connection Pooling', '200+ Options']
    },
    {
      name: 'XHR',
      path: '/adapters/xhr',
      icon: '📦',
      runtime: 'Browser (legacy)',
      description: 'XMLHttpRequest for legacy browser support with progress events.',
      features: ['Upload Progress', 'Download Progress', 'Legacy Support', 'Sync Requests']
    },
    {
      name: 'React Native',
      path: '/adapters/react-native',
      icon: '📱',
      runtime: 'React Native',
      description: 'Optimized for React Native with manual cookie headers and fs downloads.',
      features: ['File Downloads', 'Cookie Headers', 'Mobile Optimized', 'RN-FS Support']
    }
  ];
</script>

<svelte:head>
  <title>Adapters Overview - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Adapters</h1>
    <p class="text-lg" style="color: var(--muted);">
      Rezo includes 6 specialized adapters for different runtime environments and use cases.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Automatic Adapter Selection</h2>
    <p class="mb-4" style="color: var(--muted);">
      By default, Rezo automatically selects the best adapter for your environment:
    </p>
    <CodeBlock code={autoSelection} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Explicit Adapter Import</h2>
    <p class="mb-4" style="color: var(--muted);">
      For optimal tree-shaking and control, import the adapter you need:
    </p>
    <CodeBlock code={explicitImport} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-6">Available Adapters</h2>
    <div class="grid gap-6">
      {#each adapters as adapter}
        <a 
          href={adapter.path}
          class="block p-6 rounded-xl border transition-all hover:border-primary-500/50 hover:shadow-lg"
          style="background-color: var(--surface); border-color: var(--border);"
        >
          <div class="flex items-start gap-4">
            <div class="text-4xl">{adapter.icon}</div>
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <h3 class="text-xl font-semibold">{adapter.name} Adapter</h3>
                <span class="text-xs px-2 py-1 rounded-full" style="background-color: var(--border); color: var(--muted);">
                  {adapter.runtime}
                </span>
              </div>
              <p class="mb-3" style="color: var(--muted);">{adapter.description}</p>
              <div class="flex flex-wrap gap-2">
                {#each adapter.features as feature}
                  <span class="text-xs px-2 py-1 rounded" style="background-color: rgba(0, 212, 255, 0.1); color: #00d4ff;">
                    {feature}
                  </span>
                {/each}
              </div>
            </div>
            <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </a>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Adapter Comparison</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b" style="border-color: var(--border);">
            <th class="text-left py-3 px-4">Feature</th>
            <th class="text-center py-3 px-2">HTTP</th>
            <th class="text-center py-3 px-2">HTTP/2</th>
            <th class="text-center py-3 px-2">Fetch</th>
            <th class="text-center py-3 px-2">cURL</th>
            <th class="text-center py-3 px-2">XHR</th>
            <th class="text-center py-3 px-2">RN</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Cookie Jar</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">⚠️</td>
            <td class="text-center">✅</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Proxy Support</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅*</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
            <td class="text-center">❌</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Streaming</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">HTTP/2</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
            <td class="text-center">⚠️</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
            <td class="text-center">❌</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Browser</td>
            <td class="text-center">❌</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
            <td class="text-center">✅</td>
            <td class="text-center">❌</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4">Progress Events</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">⚠️</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
            <td class="text-center">✅</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-4 text-sm" style="color: var(--muted);">
      * Fetch proxy support is Node.js only &nbsp; ⚠️ Partial/Limited support
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Choosing the Right Adapter</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">For Node.js Servers</h4>
        <p class="text-sm" style="color: var(--muted);">Use <strong>HTTP</strong> for full features, or <strong>HTTP/2</strong> for multiplexing and performance.</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">For Browsers</h4>
        <p class="text-sm" style="color: var(--muted);">Use <strong>Fetch</strong> for modern browsers, or <strong>XHR</strong> for legacy support with progress events.</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">For Edge Runtimes</h4>
        <p class="text-sm" style="color: var(--muted);">Use <strong>Fetch</strong> - it's the only adapter that works in Cloudflare Workers, Vercel Edge, etc.</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">For Web Scraping</h4>
        <p class="text-sm" style="color: var(--muted);">Use <strong>cURL</strong> for advanced auth (NTLM, Digest), or <strong>HTTP</strong> for cookie persistence.</p>
      </div>
    </div>
  </section>
</div>
