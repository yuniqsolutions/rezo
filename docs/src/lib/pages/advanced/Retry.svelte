<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicRetry = `// Simple retry configuration
await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 3,          // Max retry attempts
    delay: 1000,          // Initial delay (ms)
    multiplier: 2,        // Exponential backoff
    statusCodes: [500, 502, 503, 504]  // Retry these
  }
});

// Flow:
// 1. Request fails with 503
// 2. Wait 1000ms, retry
// 3. Fails again → wait 2000ms, retry
// 4. Fails again → wait 4000ms, retry
// 5. Still fails → throw RezoError`;

  const conditionalRetry = `await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 5,
    delay: 500,
    
    // Only retry specific status codes
    statusCodes: [429, 500, 502, 503, 504],
    
    // Only retry safe methods by default
    methods: ['GET', 'HEAD', 'OPTIONS'],
    
    // Custom condition
    condition: (error) => {
      // Don't retry auth errors
      if (error.status === 401) return false;
      
      // Retry network errors
      if (error.isNetworkError) return true;
      
      // Custom logic
      return error.isRetryable;
    }
  }
});`;

  const retryAfter = `// Automatic Retry-After header support
await rezo.get('https://api.example.com/rate-limited', {
  retry: {
    attempts: 3,
    respectRetryAfter: true  // Honor Retry-After header
  }
});

// If server returns:
// HTTP/1.1 429 Too Many Requests
// Retry-After: 60
//
// Rezo waits 60 seconds before retrying`;

  const retryHooks = `await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 3,
    delay: 1000
  },
  
  hooks: {
    beforeRetry: [(options, error, retryCount) => {
      console.log(\`Retry attempt \${retryCount}\`);
      console.log(\`Failed with: \${error.message}\`);
      
      // Optionally modify options before retry
      options.headers['X-Retry-Attempt'] = String(retryCount);
      
      return options;
    }]
  }
});`;
</script>

<svelte:head>
  <title>Retry Logic - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Retry & Backoff</h1>
    <p class="text-lg" style="color: var(--muted);">
      Intelligent retry logic with exponential backoff and custom conditions.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Retry</h2>
    <CodeBlock code={basicRetry} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Conditional Retry</h2>
    <CodeBlock code={conditionalRetry} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Retry-After Header</h2>
    <CodeBlock code={retryAfter} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Retry Hooks</h2>
    <CodeBlock code={retryHooks} language="typescript" />
  </section>
</div>
