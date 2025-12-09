<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const types = `// Main exports
import rezo, {
  RezoError,
  RezoFormData,
  RezoCookieJar,
  RezoHeaders,
  RezoQueue,
  HttpQueue,
  ProxyManager,
  RezoPerformance
} from 'rezo';

// Type imports
import type {
  RezoRequestConfig,
  RezoResponse,
  RezoInstance,
  RezoAdapter,
  Cookie,
  Proxy,
  RetryConfig,
  HooksConfig,
  ProgressEvent,
  StreamResponse,
  DownloadResponse,
  UploadResponse
} from 'rezo';

// Error codes
import { RezoErrorCode } from 'rezo';

// Priority constants
import { Priority } from 'rezo';
// Priority.LOWEST (0)
// Priority.LOW (25)
// Priority.NORMAL (50)
// Priority.HIGH (75)
// Priority.HIGHEST (100)
// Priority.CRITICAL (1000)`;
</script>

<svelte:head>
  <title>TypeScript Types - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Types</h1>
    <p class="text-lg" style="color: var(--muted);">
      TypeScript types and exports from Rezo.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Exports</h2>
    <CodeBlock code={types} language="typescript" />
  </section>
</div>
