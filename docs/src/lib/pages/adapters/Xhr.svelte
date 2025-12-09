<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/xhr';

// Uses XMLHttpRequest
const response = await rezo.get('/api/users');
console.log(response.data);`;

  const progressEvents = `// Upload progress
const form = new FormData();
form.append('file', largeFile);

const upload = await rezo.post('/api/upload', form, {
  onUploadProgress: (event) => {
    const percent = Math.round((event.loaded / event.total) * 100);
    console.log(\`Upload: \${percent}%\`);
    updateProgressBar(percent);
  }
});

// Download progress
await rezo.get('/api/large-file', {
  onDownloadProgress: (event) => {
    const percent = Math.round((event.loaded / event.total) * 100);
    console.log(\`Download: \${percent}%\`);
  }
});`;

  const credentials = `// Send cookies with cross-origin requests
await rezo.get('https://api.example.com/data', {
  withCredentials: true
});

// Equivalent to:
// xhr.withCredentials = true`;

  const responseTypes = `// Different response types
await rezo.get('/api/data');           // Auto-detect (text/json)
await rezo.get('/api/data', { responseType: 'json' });
await rezo.get('/api/page', { responseType: 'text' });
await rezo.get('/api/file', { responseType: 'arraybuffer' });
await rezo.get('/api/file', { responseType: 'blob' });
await rezo.get('/api/doc', { responseType: 'document' });`;

  const sync = `// Synchronous requests (not recommended)
// Only use when absolutely necessary
const response = await rezo.get('/api/data', {
  async: false // Blocks the main thread!
});`;
</script>

<svelte:head>
  <title>XHR Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">📦</span>
      <h1 class="text-3xl sm:text-4xl font-bold">XHR Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      XMLHttpRequest adapter for legacy browser support with upload/download 
      progress events and synchronous request capability.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Progress Events</h2>
    <p class="mb-4" style="color: var(--muted);">
      Track upload and download progress with callbacks:
    </p>
    <CodeBlock code={progressEvents} language="typescript" />
    
    <div class="mt-4 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-2">Why XHR for Progress?</h4>
      <p class="text-sm" style="color: var(--muted);">
        The Fetch API doesn't support upload progress events. If you need upload 
        progress tracking in browsers, use the XHR adapter.
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Credentials</h2>
    <CodeBlock code={credentials} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Types</h2>
    <CodeBlock code={responseTypes} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Synchronous Requests</h2>
    <CodeBlock code={sync} language="typescript" />
    <div class="mt-4 p-4 rounded-lg border-l-4 border-red-500" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-2">Warning: Avoid Synchronous Requests</h4>
      <p class="text-sm" style="color: var(--muted);">
        Synchronous XHR blocks the browser's main thread and causes poor user experience.
        Only use when absolutely necessary (e.g., beforeunload handlers).
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">XHR vs Fetch</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Use XHR When</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Need upload progress events</li>
          <li>• Supporting older browsers</li>
          <li>• Need synchronous requests</li>
          <li>• Need to abort requests easily</li>
        </ul>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Use Fetch When</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Modern browsers only</li>
          <li>• Want smaller bundle</li>
          <li>• Need streaming responses</li>
          <li>• Cleaner Promise API</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: React Native Adapter</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about mobile-optimized HTTP</p>
    </div>
    <button on:click={() => navigate('/adapters/react-native')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
