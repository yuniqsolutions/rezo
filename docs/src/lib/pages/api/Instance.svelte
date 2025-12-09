<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const createInstance = `import rezo from 'rezo';

// Create a new instance with custom defaults
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer token'
  }
});

// Instance methods
api.get(url, config?)
api.post(url, data?, config?)
api.put(url, data?, config?)
api.patch(url, data?, config?)
api.delete(url, config?)
api.head(url, config?)
api.options(url, config?)
api.request(config)`;

  const instanceMethods = `// Multipart helpers
api.postMultipart(url, data, config?)
api.putMultipart(url, data, config?)
api.patchMultipart(url, data, config?)

// Streaming helpers
api.getStream(url, config?)
api.download(url, filepath, config?)
api.upload(url, data, config?)

// Defaults
api.defaults  // Read/modify instance defaults`;
</script>

<svelte:head>
  <title>Rezo Instance API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Rezo Instance</h1>
    <p class="text-lg" style="color: var(--muted);">
      API reference for the Rezo instance and its methods.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Creating an Instance</h2>
    <CodeBlock code={createInstance} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Instance Methods</h2>
    <CodeBlock code={instanceMethods} language="typescript" />
  </section>
</div>
