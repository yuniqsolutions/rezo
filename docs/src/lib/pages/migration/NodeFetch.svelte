<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicMigration = `// node-fetch
import fetch from 'node-fetch';
const response = await fetch('https://api.example.com/users');
const data = await response.json();

// Rezo (simpler, auto-parses)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data;`;

  const postMigration = `// node-fetch
const response = await fetch('https://api.example.com/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John' })
});

// Rezo (auto-serializes)
const response = await rezo.post('https://api.example.com/users', {
  name: 'John'
});`;

  const errorMigration = `// node-fetch (must check status manually)
const response = await fetch('https://api.example.com/users/999');
if (!response.ok) {
  throw new Error(\`HTTP \${response.status}\`);
}

// Rezo (throws automatically for 4xx/5xx)
try {
  const response = await rezo.get('https://api.example.com/users/999');
} catch (error) {
  // Automatically thrown for 404
  console.log(error.status); // 404
}`;
</script>

<svelte:head>
  <title>Migrate from node-fetch - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from node-fetch</h1>
    <p class="text-lg" style="color: var(--muted);">
      Rezo provides a more ergonomic API with automatic error handling.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Requests</h2>
    <CodeBlock code={basicMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">POST Requests</h2>
    <CodeBlock code={postMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Handling</h2>
    <CodeBlock code={errorMigration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">What You Gain</h2>
    <div class="p-4 rounded-lg" style="background-color: var(--surface);">
      <ul class="space-y-2" style="color: var(--muted);">
        <li>✅ Auto JSON parsing and serialization</li>
        <li>✅ Automatic error handling for 4xx/5xx</li>
        <li>✅ Cookie jar support</li>
        <li>✅ Proxy support (HTTP, HTTPS, SOCKS)</li>
        <li>✅ Retry logic with backoff</li>
        <li>✅ Request/response hooks</li>
      </ul>
    </div>
  </section>
</div>
