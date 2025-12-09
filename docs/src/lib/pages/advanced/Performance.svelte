<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const metrics = `import { RezoPerformance } from 'rezo';

const perf = new RezoPerformance();

perf.start('dns');
// ... DNS lookup happens
perf.end('dns');

perf.start('connect');
// ... TCP connection
perf.end('connect');

// Get metrics
console.log(perf.getMetrics());
// {
//   dns: 45,
//   connect: 32,
//   tls: 89,
//   ttfb: 156,
//   total: 423
// }`;

  const responseMetrics = `const response = await rezo.get('https://api.example.com');

// Response includes transfer metrics
console.log(response.metrics);
// {
//   requestSize: 245,      // Bytes sent
//   responseSize: 1834,    // Bytes received
//   duration: 156,         // Total time (ms)
//   contentLength: 1789    // Content-Length header
// }`;

  const connectionReuse = `// HTTP/2 adapter automatically reuses connections
import rezo from 'rezo/adapters/http2';

// First request establishes connection
await rezo.get('https://api.example.com/a');

// Subsequent requests reuse the connection
await rezo.get('https://api.example.com/b');
await rezo.get('https://api.example.com/c');

// For HTTP/1.1, use keep-alive
await rezo.get('https://api.example.com', {
  headers: {
    'Connection': 'keep-alive'
  }
});`;
</script>

<svelte:head>
  <title>Performance Metrics - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Performance</h1>
    <p class="text-lg" style="color: var(--muted);">
      Performance monitoring, metrics collection, and optimization strategies.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Performance Metrics</h2>
    <CodeBlock code={metrics} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Metrics</h2>
    <CodeBlock code={responseMetrics} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Connection Reuse</h2>
    <CodeBlock code={connectionReuse} language="typescript" />
  </section>
</div>
