<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const basicError = `import { rezo, RezoError } from 'rezo';

try {
  const response = await rezo.get('/api/users/999');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    console.log('Message:', error.message);
    console.log('Status:', error.status);
    console.log('Details:', error.details);
    console.log('Suggestion:', error.suggestion);
  }
}`;

  const errorTypes = `// HTTP errors (4xx, 5xx)
if (error.isHttpError) {
  console.log('Status:', error.status);      // 404, 500, etc.
  console.log('Body:', error.response?.data); // Server response
}

// Network errors (connection refused, DNS failed)
if (error.isNetworkError) {
  console.log('Connection failed:', error.message);
}

// Timeout errors
if (error.isTimeout) {
  console.log('Request timed out');
}

// Request was aborted
if (error.isAborted) {
  console.log('Request was cancelled');
}

// Proxy errors
if (error.isProxyError) {
  console.log('Proxy connection failed');
}

// TLS/SSL errors
if (error.isTlsError) {
  console.log('Certificate validation failed');
}

// Can this error be retried?
if (error.isRetryable) {
  console.log('This error is suitable for retry');
}`;

  const errorResponse = `try {
  await rezo.post('/api/users', { invalid: 'data' });
} catch (error) {
  if (RezoError.isRezoError(error) && error.response) {
    // Access the full response
    console.log('Status:', error.response.status);
    console.log('Headers:', error.response.headers);
    console.log('Body:', error.response.data);
    
    // Server error messages
    if (error.response.data?.message) {
      console.log('Server message:', error.response.data.message);
    }
  }
}`;

  const errorCodes = `import { RezoErrorCode } from 'rezo';

try {
  await rezo.get('/api/data');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    switch (error.code) {
      case RezoErrorCode.TIMEOUT:
        console.log('Request timed out');
        break;
      case RezoErrorCode.NETWORK_ERROR:
        console.log('Network error');
        break;
      case RezoErrorCode.HTTP_ERROR:
        console.log('HTTP error:', error.status);
        break;
      case RezoErrorCode.PROXY_ERROR:
        console.log('Proxy error');
        break;
      case RezoErrorCode.ABORT:
        console.log('Request aborted');
        break;
      default:
        console.log('Unknown error:', error.code);
    }
  }
}`;

  const retryIntegration = `// Retry integrates with error handling
const response = await rezo.get('/api/flaky', {
  retry: {
    attempts: 3,
    delay: 1000,
    multiplier: 2,
    statusCodes: [500, 502, 503, 504], // Retry these
  }
});

// Flow:
// 1. First request → 503 error
// 2. Wait 1000ms, retry → 503 error
// 3. Wait 2000ms, retry → 503 error
// 4. Wait 4000ms, retry → Still 503? Throw RezoError
// Or at any point: → 200 success? Return response`;

  const customValidation = `// Validate response before considering it successful
const response = await rezo.get('/api/data', {
  validateStatus: (status) => {
    // Consider 2xx and 304 as success
    return (status >= 200 && status < 300) || status === 304;
  }
});

// Custom response validation
const response = await rezo.get('/api/data', {
  validateResponse: (response) => {
    // Throw if response doesn't meet criteria
    if (!response.data?.success) {
      throw new Error('API returned error: ' + response.data?.message);
    }
    return true;
  }
});`;

  const errorToJson = `try {
  await rezo.get('/api/data');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    // Safe to log or send to error tracking
    console.log(JSON.stringify(error));
    
    // toJSON() hides sensitive config/request/response
    // Only includes: name, message, code, status, details, suggestion
    
    // Full access still available via properties
    console.log(error.config);   // Full request config
    console.log(error.request);  // Request object
    console.log(error.response); // Full response
  }
}`;
</script>

<svelte:head>
  <title>Error Handling - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Error Handling</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn how to handle errors gracefully with RezoError.
    </p>
  </header>

  <section>
    <div class="p-4 rounded-lg border-l-4 border-primary-500 mb-6" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-2">Important: 4xx/5xx Throw Errors</h4>
      <p class="text-sm" style="color: var(--muted);">
        Unlike some HTTP clients, Rezo throws errors for 4xx and 5xx status codes by default.
        Only 2xx responses return successfully. This makes error handling explicit and integrates
        well with retry logic.
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Error Handling</h2>
    <CodeBlock code={basicError} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Types</h2>
    <p class="mb-4" style="color: var(--muted);">
      RezoError provides boolean flags to identify error types:
    </p>
    <CodeBlock code={errorTypes} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Accessing Error Response</h2>
    <p class="mb-4" style="color: var(--muted);">
      For HTTP errors, the full response is attached:
    </p>
    <CodeBlock code={errorResponse} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Codes</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use error codes for programmatic error handling:
    </p>
    <CodeBlock code={errorCodes} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Retry Integration</h2>
    <p class="mb-4" style="color: var(--muted);">
      Errors integrate with retry logic - retries happen before throwing:
    </p>
    <CodeBlock code={retryIntegration} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Custom Validation</h2>
    <CodeBlock code={customValidation} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Safe Error Serialization</h2>
    <p class="mb-4" style="color: var(--muted);">
      RezoError's toJSON() method hides sensitive data for safe logging:
    </p>
    <CodeBlock code={errorToJson} language="typescript" />
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Adapters</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about the different HTTP adapters</p>
    </div>
    <button on:click={() => navigate('/adapters')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
