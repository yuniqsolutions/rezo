<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/curl';

// Uses cURL command-line under the hood
const response = await rezo.get('https://api.example.com/users');`;

  const advancedAuth = `// NTLM authentication (Windows networks)
await rezo.get('https://intranet.company.com/api', {
  auth: {
    username: 'DOMAIN\\\\username',
    password: 'password',
    type: 'ntlm'
  }
});

// Digest authentication
await rezo.get('https://secure.example.com/api', {
  auth: {
    username: 'user',
    password: 'pass',
    type: 'digest'
  }
});

// Negotiate (Kerberos/SPNEGO)
await rezo.get('https://kerberos.company.com/api', {
  auth: {
    type: 'negotiate'
  }
});`;

  const curlOptions = `// Use typed curl options for maximum control
await rezo.get('https://example.com', {
  curl: {
    // Connection options
    connectTimeout: 10,
    maxTime: 30,
    
    // TLS/SSL configuration
    tls: {
      insecure: true,
      cacert: '/path/to/ca.pem',
      min: 'tlsv1.2'
    },
    
    // Retry with exponential backoff
    retry: {
      attempts: 3,
      delay: 2,
      allErrors: true
    },
    
    // Debugging
    verbose: true,
    
    // Rate limiting
    limitRate: '500K',
    
    // HTTP version
    httpVersion: '2',
    
    // And 100+ more typed options...
  }
});`;

  const debugging = `// Get the actual cURL command for debugging
const response = await rezo.get('https://api.example.com', {
  curl: {
    returnCommand: true
  }
});

console.log(response.curlCommand);
// curl -X GET 'https://api.example.com' -H 'Accept: application/json' ...

// Verbose output for detailed request/response info
await rezo.get('https://api.example.com', {
  curl: {
    verbose: true,
    output: {
      trace: '/tmp/curl-trace.log',
      traceTime: true
    }
  }
});`;

  const connectionPooling = `// cURL adapter supports connection reuse
// Multiple requests to same host reuse connections

await Promise.all([
  rezo.get('https://api.example.com/a'),
  rezo.get('https://api.example.com/b'),
  rezo.get('https://api.example.com/c'),
]);`;
</script>

<svelte:head>
  <title>cURL Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">🔧</span>
      <h1 class="text-3xl sm:text-4xl font-bold">cURL Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      cURL command-line wrapper with 200+ options, advanced authentication 
      (NTLM, Digest, Negotiate), and powerful debugging capabilities.
    </p>
  </header>

  <section class="p-4 rounded-lg border-l-4 border-yellow-500" style="background-color: var(--surface);">
    <h4 class="font-semibold mb-2">Requires cURL</h4>
    <p class="text-sm" style="color: var(--muted);">
      This adapter requires cURL to be installed on the system. Most Unix-like systems 
      have it pre-installed. On Windows, install via chocolatey: <code>choco install curl</code>
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Advanced Authentication</h2>
    <p class="mb-4" style="color: var(--muted);">
      cURL adapter supports authentication methods not available in other adapters:
    </p>
    <CodeBlock code={advancedAuth} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Direct cURL Options</h2>
    <p class="mb-4" style="color: var(--muted);">
      Pass any cURL option directly for maximum control:
    </p>
    <CodeBlock code={curlOptions} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Debugging</h2>
    <p class="mb-4" style="color: var(--muted);">
      Get the exact cURL command or enable verbose output:
    </p>
    <CodeBlock code={debugging} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Connection Pooling</h2>
    <CodeBlock code={connectionPooling} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">When to Use cURL</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-green-400">✅ Perfect For</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• NTLM/Digest/Negotiate auth</li>
          <li>• Windows network integration</li>
          <li>• Advanced debugging</li>
          <li>• Maximum protocol control</li>
        </ul>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-yellow-400">⚠️ Considerations</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Requires cURL installation</li>
          <li>• Spawns child processes</li>
          <li>• Slightly higher overhead</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: XHR Adapter</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about XMLHttpRequest for browsers</p>
    </div>
    <button on:click={() => navigate('/adapters/xhr')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
