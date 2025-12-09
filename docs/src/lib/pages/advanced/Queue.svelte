<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicQueue = `import { RezoQueue } from 'rezo';

// Create a queue with concurrency limit
const queue = new RezoQueue({
  concurrency: 5,      // Max concurrent tasks
  interval: 1000,      // Min time between tasks (ms)
  intervalCap: 10      // Max tasks per interval
});

// Add tasks
queue.add(async () => {
  return await rezo.get('https://api.example.com/data/1');
});

queue.add(async () => {
  return await rezo.get('https://api.example.com/data/2');
});

// Wait for all to complete
await queue.onIdle();`;

  const httpQueue = `import { HttpQueue } from 'rezo';

// HTTP-aware queue with per-domain limits
const queue = new HttpQueue({
  concurrency: 10,           // Global concurrency
  perDomainConcurrency: 2,   // Per-domain limit
  
  retry: {
    attempts: 3,
    delay: 1000,
    statusCodes: [429, 500, 502, 503]
  }
});

// Rate limit headers are automatically respected
queue.add(async () => {
  return await rezo.get('https://api.example.com/data');
});`;

  const priorityQueue = `import { RezoQueue, Priority } from 'rezo';

const queue = new RezoQueue({ concurrency: 3 });

// Add with priority
queue.add(lowPriorityTask, { priority: Priority.LOW });        // 25
queue.add(normalTask, { priority: Priority.NORMAL });          // 50
queue.add(highPriorityTask, { priority: Priority.HIGH });      // 75
queue.add(criticalTask, { priority: Priority.CRITICAL });      // 1000

// Higher priority tasks run first`;

  const queueEvents = `const queue = new RezoQueue({ concurrency: 5 });

queue.on('add', (task) => {
  console.log('Task added, pending:', queue.pending);
});

queue.on('start', (task) => {
  console.log('Task started, active:', queue.active);
});

queue.on('completed', (result, task) => {
  console.log('Task completed:', result);
});

queue.on('error', (error, task) => {
  console.error('Task failed:', error);
});

queue.on('idle', () => {
  console.log('Queue is empty and idle');
});

queue.on('rateLimited', (domain) => {
  console.log('Rate limited for:', domain);
});`;

  const queueControl = `const queue = new RezoQueue({ concurrency: 5 });

// Pause processing
queue.pause();

// Add tasks while paused (they queue up)
queue.add(task1);
queue.add(task2);

// Resume processing
queue.resume();

// Clear pending tasks
queue.clear();

// Get statistics
console.log(queue.stats);
// { processed, completed, failed, timedOut, cancelled, averageDuration }`;
</script>

<svelte:head>
  <title>Queue & Rate Limiting - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Queue & Rate Limiting</h1>
    <p class="text-lg" style="color: var(--muted);">
      Built-in request queuing with priority, concurrency limits, and rate limiting.
    </p>
  </header>

  <section class="info-box">
    <h3 class="text-lg font-semibold mb-2">Two Queue Types</h3>
    <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);">
      <li><strong>RezoQueue</strong> - General-purpose priority queue with concurrency control</li>
      <li><strong>HttpQueue</strong> - HTTP-aware queue with per-domain limits, rate limit header parsing, and auto-retry</li>
    </ul>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Queue</h2>
    <CodeBlock code={basicQueue} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">HTTP-Aware Queue</h2>
    <CodeBlock code={httpQueue} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Priority Levels</h2>
    <CodeBlock code={priorityQueue} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Queue Events</h2>
    <CodeBlock code={queueEvents} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Queue Control</h2>
    <CodeBlock code={queueControl} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Configuration Reference</h2>
    <h3 class="text-lg font-semibold mb-2">RezoQueue Config</h3>
    <table>
      <thead>
        <tr>
          <th>Option</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>concurrency</code></td>
          <td><code>number</code></td>
          <td>Infinity</td>
          <td>Max concurrent tasks</td>
        </tr>
        <tr>
          <td><code>interval</code></td>
          <td><code>number</code></td>
          <td>0</td>
          <td>Rate limit interval (ms)</td>
        </tr>
        <tr>
          <td><code>intervalCap</code></td>
          <td><code>number</code></td>
          <td>Infinity</td>
          <td>Max tasks per interval</td>
        </tr>
        <tr>
          <td><code>timeout</code></td>
          <td><code>number</code></td>
          <td>0</td>
          <td>Task timeout (ms)</td>
        </tr>
        <tr>
          <td><code>throwOnTimeout</code></td>
          <td><code>boolean</code></td>
          <td>true</td>
          <td>Throw on timeout</td>
        </tr>
        <tr>
          <td><code>autoStart</code></td>
          <td><code>boolean</code></td>
          <td>true</td>
          <td>Auto-start processing</td>
        </tr>
      </tbody>
    </table>

    <h3 class="text-lg font-semibold mb-2 mt-6">HttpQueue Config (extends RezoQueue)</h3>
    <table>
      <thead>
        <tr>
          <th>Option</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>domainConcurrency</code></td>
          <td><code>number | object</code></td>
          <td>Infinity</td>
          <td>Per-domain concurrency limit</td>
        </tr>
        <tr>
          <td><code>requestsPerSecond</code></td>
          <td><code>number</code></td>
          <td>0</td>
          <td>Rate limit requests per second</td>
        </tr>
        <tr>
          <td><code>respectRetryAfter</code></td>
          <td><code>boolean</code></td>
          <td>true</td>
          <td>Honor Retry-After header</td>
        </tr>
        <tr>
          <td><code>respectRateLimitHeaders</code></td>
          <td><code>boolean</code></td>
          <td>true</td>
          <td>Honor X-RateLimit-* headers</td>
        </tr>
        <tr>
          <td><code>autoRetry</code></td>
          <td><code>boolean</code></td>
          <td>false</td>
          <td>Auto-retry failed requests</td>
        </tr>
        <tr>
          <td><code>maxRetries</code></td>
          <td><code>number</code></td>
          <td>3</td>
          <td>Max retry attempts</td>
        </tr>
        <tr>
          <td><code>retryDelay</code></td>
          <td><code>number</code></td>
          <td>1000</td>
          <td>Delay between retries (ms)</td>
        </tr>
        <tr>
          <td><code>retryStatusCodes</code></td>
          <td><code>number[]</code></td>
          <td>[429, 500, 502, 503, 504]</td>
          <td>Status codes to retry</td>
        </tr>
      </tbody>
    </table>
  </section>
</div>

<style>
  .info-box {
    background: var(--code-bg);
    border-left: 4px solid var(--primary);
    padding: 1rem;
    border-radius: 0.25rem;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.875rem;
  }
  
  th, td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  
  th {
    font-weight: 600;
    background: var(--code-bg);
  }
  
  code {
    background: var(--code-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.8rem;
  }
</style>
