<script lang="ts">
  const releases = [
    {
      version: '1.0.0',
      date: 'December 2024',
      changes: [
        'Initial stable release',
        '6 adapters: HTTP, HTTP/2, Fetch, cURL, XHR, React Native',
        'Full cookie management with tough-cookie',
        'Proxy support (HTTP, HTTPS, SOCKS4/5)',
        'ProxyManager with rotation strategies',
        'Request queue with priority and rate limiting',
        'Lifecycle hooks system',
        'Automatic retry with exponential backoff',
        'Streaming downloads and uploads with progress',
        'TypeScript first with full type definitions'
      ]
    }
  ];
</script>

<svelte:head>
  <title>Changelog - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Changelog</h1>
    <p class="text-lg" style="color: var(--muted);">
      Release history and version changes.
    </p>
  </header>

  <section class="space-y-8">
    {#each releases as release}
      <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-xl font-bold gradient-text">v{release.version}</span>
          <span class="text-sm px-2 py-1 rounded" style="background-color: var(--border); color: var(--muted);">
            {release.date}
          </span>
        </div>
        <ul class="space-y-2">
          {#each release.changes as change}
            <li class="flex items-start gap-2">
              <span class="text-green-500 mt-1">+</span>
              <span style="color: var(--muted);">{change}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </section>
</div>
