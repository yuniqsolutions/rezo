<script lang="ts">
  const faqs = [
    {
      q: 'How easy is it to switch to Rezo from other HTTP clients?',
      a: 'Very easy. The API is designed to be intuitive and familiar. Interceptors become hooks, and error handling is explicit (Rezo throws for 4xx/5xx by default). Check our migration guides for details.'
    },
    {
      q: 'Does Rezo work in browsers?',
      a: 'Yes! Use the Fetch adapter for modern browsers or XHR adapter for legacy support. The default import auto-selects the right adapter.'
    },
    {
      q: 'What Node.js version is required?',
      a: 'Rezo requires Node.js 22+ for full feature support, including native zstd compression.'
    },
    {
      q: 'How do I handle cookies?',
      a: 'Use RezoCookieJar for automatic cookie persistence. Pass it to requests with the `jar` option. Cookies are automatically merged between requests and responses.'
    },
    {
      q: 'Why do 4xx/5xx responses throw errors?',
      a: 'This makes error handling explicit and integrates with retry logic. If you configure retry for specific status codes, Rezo retries first before throwing.'
    },
    {
      q: 'Can I use Rezo in Cloudflare Workers?',
      a: 'Yes! Use the Fetch adapter which is compatible with edge runtimes. Note that features like cookie jars and proxies are limited in edge environments.'
    },
    {
      q: 'How does HTTP/2 work?',
      a: 'Import from rezo/adapters/http2. Sessions are automatically pooled and reused for each origin. Multiple requests are multiplexed over a single connection.'
    },
    {
      q: 'Is there a size limit for uploads?',
      a: 'No inherent limit. Use streaming for large files to avoid loading them into memory. The upload helper provides progress tracking.'
    }
  ];
</script>

<svelte:head>
  <title>FAQ - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">FAQ</h1>
    <p class="text-lg" style="color: var(--muted);">
      Frequently asked questions about Rezo.
    </p>
  </header>

  <section class="space-y-6">
    {#each faqs as faq}
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <h3 class="text-lg font-semibold mb-3">{faq.q}</h3>
        <p style="color: var(--muted);">{faq.a}</p>
      </div>
    {/each}
  </section>
</div>
