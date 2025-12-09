<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicMigration = `// Axios
import axios from 'axios';
const response = await axios.get('/users');

// Rezo (identical API)
import rezo from 'rezo';
const response = await rezo.get('/users');`;

  const instanceMigration = `// Axios
const api = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 10000
});

// Rezo (identical)
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000
});`;

  const interceptorsMigration = `// Axios interceptors
axios.interceptors.request.use(config => {
  config.headers.Authorization = 'Bearer token';
  return config;
});

// Rezo hooks
const api = rezo.create({
  hooks: {
    beforeRequest: [(options) => {
      options.headers.Authorization = 'Bearer token';
      return options;
    }]
  }
});`;

  const errorHandlingMigration = `// Axios (returns response for errors by default)
try {
  await axios.get('/users/999');
} catch (error) {
  if (axios.isAxiosError(error)) {
    console.log(error.response?.status);
  }
}

// Rezo (throws for 4xx/5xx by default)
try {
  await rezo.get('/users/999');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    console.log(error.status);          // Direct access
    console.log(error.response?.data);  // Full response
    console.log(error.suggestion);      // Helpful hint
  }
}`;

  const keyDifferences = [
    { axios: 'axios.isAxiosError()', rezo: 'RezoError.isRezoError()' },
    { axios: 'error.response.status', rezo: 'error.status (direct)' },
    { axios: 'interceptors.request.use()', rezo: 'hooks.beforeRequest[]' },
    { axios: 'interceptors.response.use()', rezo: 'hooks.afterResponse[]' },
    { axios: 'CancelToken (deprecated)', rezo: 'AbortController (standard)' },
  ];
</script>

<svelte:head>
  <title>Migrate from Axios - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from Axios</h1>
    <p class="text-lg" style="color: var(--muted);">
      Rezo is designed as a drop-in replacement for Axios. Most code works unchanged.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Requests</h2>
    <CodeBlock code={basicMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Creating Instances</h2>
    <CodeBlock code={instanceMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Interceptors → Hooks</h2>
    <CodeBlock code={interceptorsMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Handling</h2>
    <CodeBlock code={errorHandlingMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Key Differences</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b" style="border-color: var(--border);">
            <th class="text-left py-3 px-4">Axios</th>
            <th class="text-left py-3 px-4">Rezo</th>
          </tr>
        </thead>
        <tbody>
          {#each keyDifferences as row}
            <tr class="border-b" style="border-color: var(--border);">
              <td class="py-2 px-4 font-mono text-sm">{row.axios}</td>
              <td class="py-2 px-4 font-mono text-sm">{row.rezo}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">What You Gain</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 gradient-text">HTTP/2 Support</h4>
        <p class="text-sm" style="color: var(--muted);">Built-in HTTP/2 with session pooling</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 gradient-text">Cookie Jar</h4>
        <p class="text-sm" style="color: var(--muted);">Automatic cookie persistence</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 gradient-text">Proxy Rotation</h4>
        <p class="text-sm" style="color: var(--muted);">Built-in ProxyManager</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 gradient-text">Request Queue</h4>
        <p class="text-sm" style="color: var(--muted);">Priority-based queuing</p>
      </div>
    </div>
  </section>
</div>
