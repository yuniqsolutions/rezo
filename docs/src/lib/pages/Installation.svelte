<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const npmInstall = 'npm install rezo';
  const bunInstall = 'bun add rezo';
  const pnpmInstall = 'pnpm add rezo';
  const yarnInstall = 'yarn add rezo';

  const basicImport = `import rezo from 'rezo';

// Or with destructuring
import { rezo, RezoError, RezoFormData } from 'rezo';`;

  const adapterImports = `// Import specific adapters for tree-shaking
import rezo from 'rezo/adapters/http';       // Node.js HTTP adapter
import rezo from 'rezo/adapters/http2';      // HTTP/2 adapter
import rezo from 'rezo/adapters/fetch';      // Fetch API adapter
import rezo from 'rezo/adapters/curl';       // cURL adapter
import rezo from 'rezo/adapters/xhr';        // XHR adapter (browser)
import rezo from 'rezo/adapters/react-native'; // React Native`;

  const typescript = `import rezo from 'rezo';
import type { RezoRequestConfig, RezoResponse } from 'rezo';

interface User {
  id: number;
  name: string;
  email: string;
}

// Fully typed response
const response: RezoResponse<User[]> = await rezo.get<User[]>('/api/users');
const users: User[] = response.data;`;
</script>

<svelte:head>
  <title>Installation - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Installation</h1>
    <p class="text-lg" style="color: var(--muted);">
      Get started with Rezo in your project. Works with npm, bun, pnpm, and yarn.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Package Managers</h2>
    <p class="mb-4" style="color: var(--muted);">
      Install Rezo using your preferred package manager:
    </p>
    
    <div class="space-y-4">
      <div>
        <h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">npm</h3>
        <CodeBlock code={npmInstall} language="bash" showLineNumbers={false} />
      </div>
      
      <div>
        <h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">bun</h3>
        <CodeBlock code={bunInstall} language="bash" showLineNumbers={false} />
      </div>
      
      <div>
        <h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">pnpm</h3>
        <CodeBlock code={pnpmInstall} language="bash" showLineNumbers={false} />
      </div>
      
      <div>
        <h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">yarn</h3>
        <CodeBlock code={yarnInstall} language="bash" showLineNumbers={false} />
      </div>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Import</h2>
    <p class="mb-4" style="color: var(--muted);">
      Import Rezo in your JavaScript or TypeScript files:
    </p>
    <CodeBlock code={basicImport} language="typescript" />
    <p class="mt-4 text-sm" style="color: var(--muted);">
      The default import automatically selects the best adapter for your runtime environment.
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Tree-Shaking with Specific Adapters</h2>
    <p class="mb-4" style="color: var(--muted);">
      For optimal bundle size, import only the adapter you need:
    </p>
    <CodeBlock code={adapterImports} language="typescript" />
    
    <div class="mt-6 p-4 rounded-lg border" style="background-color: var(--surface); border-color: var(--border);">
      <h4 class="font-semibold mb-2">Adapter Selection Guide</h4>
      <ul class="space-y-2 text-sm" style="color: var(--muted);">
        <li><strong>http</strong> - Best for Node.js servers (cookies, proxy, streaming)</li>
        <li><strong>http2</strong> - Use when HTTP/2 multiplexing is needed</li>
        <li><strong>fetch</strong> - Best for browsers and edge runtimes</li>
        <li><strong>curl</strong> - Advanced auth (NTLM, Digest) and debugging</li>
        <li><strong>xhr</strong> - Legacy browser support with progress events</li>
        <li><strong>react-native</strong> - Optimized for React Native apps</li>
      </ul>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">TypeScript Support</h2>
    <p class="mb-4" style="color: var(--muted);">
      Rezo is written in TypeScript and provides full type definitions out of the box:
    </p>
    <CodeBlock code={typescript} language="typescript" filename="api.ts" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Requirements</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Node.js</h4>
        <p class="text-sm" style="color: var(--muted);">Version 22.0.0 or higher</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">TypeScript</h4>
        <p class="text-sm" style="color: var(--muted);">Version 5.0+ recommended</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Browsers</h4>
        <p class="text-sm" style="color: var(--muted);">Modern browsers with Fetch API</p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Bun/Deno</h4>
        <p class="text-sm" style="color: var(--muted);">Latest stable versions</p>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Quick Start</h3>
      <p class="text-sm" style="color: var(--muted);">Learn how to make your first HTTP request</p>
    </div>
    <button on:click={() => navigate('/quick-start')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
