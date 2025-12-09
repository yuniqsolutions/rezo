<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicMigration = `// Got
import got from 'got';
const response = await got('https://api.example.com/users');
const data = JSON.parse(response.body);

// Rezo (auto-parses JSON)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data; // Already parsed`;

  const hooksMigration = `// Got hooks
const client = got.extend({
  hooks: {
    beforeRequest: [(options) => { ... }],
    afterResponse: [(response) => { ... }],
    beforeRetry: [(error, retryCount) => { ... }]
  }
});

// Rezo hooks (nearly identical)
const client = rezo.create({
  hooks: {
    beforeRequest: [(options) => { ... }],
    afterResponse: [(response) => { ... }],
    beforeRetry: [(options, error, retryCount) => { ... }]
  }
});`;

  const retryMigration = `// Got retry
got('https://api.example.com', {
  retry: {
    limit: 3,
    methods: ['GET', 'POST'],
    statusCodes: [500, 502, 503]
  }
});

// Rezo retry
rezo.get('https://api.example.com', {
  retry: {
    attempts: 3,
    methods: ['GET', 'POST'],
    statusCodes: [500, 502, 503]
  }
});`;
</script>

<svelte:head>
  <title>Migrate from Got - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from Got</h1>
    <p class="text-lg" style="color: var(--muted);">
      Rezo shares many concepts with Got but works in browsers too.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Requests</h2>
    <CodeBlock code={basicMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Hooks</h2>
    <CodeBlock code={hooksMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Retry Configuration</h2>
    <CodeBlock code={retryMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">What You Gain</h2>
    <div class="p-4 rounded-lg" style="background-color: var(--surface);">
      <ul class="space-y-2" style="color: var(--muted);">
        <li>✅ Browser support (Got is Node.js only)</li>
        <li>✅ React Native support</li>
        <li>✅ Edge runtime support</li>
        <li>✅ ProxyManager with rotation</li>
        <li>✅ Built-in request queuing</li>
      </ul>
    </div>
  </section>
</div>
