<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/http';

// All standard request methods
const response = await rezo.get('https://api.example.com/users');
const created = await rezo.post('https://api.example.com/users', { name: 'John' });`;

  const cookieJar = `import rezo from 'rezo/adapters/http';
import { RezoCookieJar } from 'rezo';

// Create a cookie jar for persistence
const myJar = new RezoCookieJar();

// Create an instance with the jar (recommended)
const client = rezo.create({ jar: myJar });
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies included

// Access stored cookies
const cookies = myJar.getCookiesSync('https://example.com');
console.log(cookies);`;

  const proxySupport = `// HTTP proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});

// HTTPS proxy with auth
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    protocol: 'https',
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});

// SOCKS5 proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'socks.example.com',
    port: 1080,
    protocol: 'socks5'
  }
});`;

  const streaming = `// Stream response
const stream = await rezo.getStream('https://example.com/large-file');

stream.on('data', (chunk) => {
  console.log('Received:', chunk.length, 'bytes');
});

stream.on('end', () => console.log('Complete'));

// Download to file
const download = await rezo.download(
  'https://example.com/file.zip',
  './downloads/file.zip'
);

download.on('progress', (p) => {
  console.log(\`Progress: \${p.percent}%\`);
});`;

  const tlsConfig = `// Custom TLS configuration
await rezo.get('https://internal-api.company.com', {
  // Custom CA certificate
  ca: fs.readFileSync('./certs/ca.pem'),
  
  // Client certificate authentication
  cert: fs.readFileSync('./certs/client.pem'),
  key: fs.readFileSync('./certs/client-key.pem'),
  
  // Skip certificate validation (not recommended for production)
  rejectUnauthorized: false
});`;

  const compression = `// Compression is automatic
// Requests include: Accept-Encoding: gzip, deflate, br, zstd
// Responses are automatically decompressed

const response = await rezo.get('https://api.example.com/data');
// response.data is already decompressed

// Disable compression
await rezo.get('https://api.example.com/data', {
  decompress: false
});`;
</script>

<svelte:head>
  <title>HTTP Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">🌐</span>
      <h1 class="text-3xl sm:text-4xl font-bold">HTTP Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      The full-featured reference adapter for Node.js, Bun, and Deno. Includes cookie jar, 
      all proxy types, streaming, compression, and comprehensive TLS configuration.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Jar</h2>
    <p class="mb-4" style="color: var(--muted);">
      Automatic cookie persistence with RezoCookieJar:
    </p>
    <CodeBlock code={cookieJar} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Proxy Support</h2>
    <p class="mb-4" style="color: var(--muted);">
      Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies:
    </p>
    <CodeBlock code={proxySupport} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Streaming</h2>
    <p class="mb-4" style="color: var(--muted);">
      Memory-efficient streaming for large files:
    </p>
    <CodeBlock code={streaming} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">TLS Configuration</h2>
    <p class="mb-4" style="color: var(--muted);">
      Comprehensive TLS/SSL options:
    </p>
    <CodeBlock code={tlsConfig} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Automatic Compression</h2>
    <CodeBlock code={compression} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Features Summary</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-green-400">✅ Supported</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Cookie jar with persistence</li>
          <li>• HTTP, HTTPS, SOCKS4/5 proxies</li>
          <li>• Request/response streaming</li>
          <li>• File downloads with progress</li>
          <li>• Gzip, deflate, brotli, zstd</li>
          <li>• Custom TLS certificates</li>
          <li>• Basic authentication</li>
          <li>• Timeout configuration</li>
        </ul>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2 text-red-400">❌ Not Supported</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Browser environment</li>
          <li>• HTTP/2 (use HTTP/2 adapter)</li>
          <li>• NTLM/Digest auth (use cURL)</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: HTTP/2 Adapter</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about HTTP/2 with session pooling</p>
    </div>
    <button on:click={() => navigate('/adapters/http2')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
