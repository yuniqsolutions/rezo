<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const comparisonData = [
    { feature: 'HTTP/2 Support', rezo: '✅', axios: '❌', got: '✅', superagent: '❌' },
    { feature: 'Built-in Cookie Jar', rezo: '✅', axios: '❌', got: '✅', superagent: '⚠️' },
    { feature: 'SOCKS Proxy', rezo: '✅', axios: '⚠️', got: '✅', superagent: '❌' },
    { feature: 'Proxy Rotation', rezo: '✅', axios: '❌', got: '❌', superagent: '❌' },
    { feature: 'Request Queue', rezo: '✅', axios: '❌', got: '❌', superagent: '❌' },
    { feature: 'Multiple Adapters', rezo: '✅', axios: '⚠️', got: '❌', superagent: '❌' },
    { feature: 'Tree-Shakeable', rezo: '✅', axios: '❌', got: '❌', superagent: '❌' },
    { feature: 'TypeScript First', rezo: '✅', axios: '✅', got: '✅', superagent: '⚠️' },
    { feature: 'Browser Support', rezo: '✅', axios: '✅', got: '❌', superagent: '✅' },
    { feature: 'React Native', rezo: '✅', axios: '✅', got: '❌', superagent: '⚠️' },
    { feature: 'cURL Adapter', rezo: '✅', axios: '❌', got: '❌', superagent: '❌' },
    { feature: 'Performance Metrics', rezo: '✅', axios: '❌', got: '⚠️', superagent: '❌' },
  ];

  const gotComparison = `// Got (Node.js only)
import got from 'got';
const response = await got('https://api.example.com/users');
const data = JSON.parse(response.body);

// Rezo (Universal)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data; // Auto-parsed, works in browsers too`;
</script>

<svelte:head>
  <title>Why Rezo - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Why Choose Rezo?</h1>
    <p class="text-lg" style="color: var(--muted);">
      Rezo is designed to be the last HTTP client you'll ever need. Here's why.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-6">Feature Comparison</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b" style="border-color: var(--border);">
            <th class="text-left py-3 px-4 font-semibold">Feature</th>
            <th class="text-center py-3 px-4 font-semibold gradient-text">Rezo</th>
            <th class="text-center py-3 px-4 font-semibold">Axios</th>
            <th class="text-center py-3 px-4 font-semibold">Got</th>
            <th class="text-center py-3 px-4 font-semibold">SuperAgent</th>
          </tr>
        </thead>
        <tbody>
          {#each comparisonData as row}
            <tr class="border-b" style="border-color: var(--border);">
              <td class="py-3 px-4">{row.feature}</td>
              <td class="py-3 px-4 text-center">{row.rezo}</td>
              <td class="py-3 px-4 text-center">{row.axios}</td>
              <td class="py-3 px-4 text-center">{row.got}</td>
              <td class="py-3 px-4 text-center">{row.superagent}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="mt-4 text-sm" style="color: var(--muted);">
      ✅ Full support &nbsp; ⚠️ Partial/Plugin &nbsp; ❌ Not supported
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-6">Key Advantages</h2>
    <div class="grid sm:grid-cols-2 gap-6">
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">Universal Runtime Support</h3>
        <p style="color: var(--muted);">
          One library that works everywhere - Node.js, Bun, Deno, browsers, React Native, 
          and edge runtimes like Cloudflare Workers. No more maintaining different HTTP 
          clients for different platforms.
        </p>
      </div>
      
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">6 Specialized Adapters</h3>
        <p style="color: var(--muted);">
          Choose the right tool for the job. HTTP for full features, HTTP/2 for performance, 
          Fetch for browsers, cURL for advanced auth, XHR for legacy support, or React Native 
          for mobile apps.
        </p>
      </div>
      
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">Enterprise-Grade Proxy Support</h3>
        <p style="color: var(--muted);">
          Built-in ProxyManager with rotation strategies, health checking, automatic failover, 
          whitelist/blacklist filtering, and support for HTTP, HTTPS, SOCKS4, and SOCKS5 proxies.
        </p>
      </div>
      
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">Smart Cookie Management</h3>
        <p style="color: var(--muted);">
          Automatic cookie handling with tough-cookie integration. Cookies persist across 
          requests, can be serialized to multiple formats, and merge correctly with response cookies.
        </p>
      </div>
      
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">Built-in Request Queue</h3>
        <p style="color: var(--muted);">
          Zero-dependency queuing with priority levels, per-domain concurrency, rate limiting, 
          automatic retry with exponential backoff, and Retry-After header support.
        </p>
      </div>
      
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-xl font-semibold mb-3 gradient-text">Better Error Handling</h3>
        <p style="color: var(--muted);">
          RezoError provides professional error messages with actionable suggestions. 
          4xx/5xx responses throw errors (not silent failures), integrating perfectly with 
          retry logic.
        </p>
      </div>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Rezo vs Got</h2>
    <CodeBlock code={gotComparison} language="typescript" />
    <div class="mt-4 p-4 rounded-lg" style="background-color: var(--surface);">
      <p style="color: var(--muted);">
        While Got is excellent for Node.js, Rezo works universally across all JavaScript 
        runtimes including browsers and edge functions, with automatic response parsing.
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-6">Who Uses Rezo?</h2>
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="p-4 rounded-lg text-center" style="background-color: var(--surface);">
        <div class="text-3xl mb-2">🏢</div>
        <div class="font-semibold">Enterprise APIs</div>
        <p class="text-sm" style="color: var(--muted);">Complex auth, proxies, rate limiting</p>
      </div>
      <div class="p-4 rounded-lg text-center" style="background-color: var(--surface);">
        <div class="text-3xl mb-2">🕷️</div>
        <div class="font-semibold">Web Scrapers</div>
        <p class="text-sm" style="color: var(--muted);">Cookie persistence, proxy rotation</p>
      </div>
      <div class="p-4 rounded-lg text-center" style="background-color: var(--surface);">
        <div class="text-3xl mb-2">📱</div>
        <div class="font-semibold">Mobile Apps</div>
        <p class="text-sm" style="color: var(--muted);">React Native with full features</p>
      </div>
    </div>
  </section>

  <section class="text-center py-8">
    <h2 class="text-2xl font-bold mb-4">Ready to Try Rezo?</h2>
    <button on:click={() => navigate('/installation')} class="gradient-bg text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity inline-block">
      Get Started Now
    </button>
  </section>
</div>
