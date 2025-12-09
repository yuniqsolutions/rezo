<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const createInstance = `import rezo from 'rezo';

// Create a configured instance
const api = rezo.create({
  baseURL: 'https://api.example.com/v1',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer default-token',
    'Content-Type': 'application/json'
  }
});

// All requests use the base configuration
await api.get('/users');        // https://api.example.com/v1/users
await api.post('/users', data); // With default headers

// Override per-request
await api.get('/users', {
  timeout: 30000,
  headers: { 'Authorization': 'Bearer other-token' }
});`;

  const allOptions = `interface RezoRequestConfig {
  // URL and method
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  baseURL?: string;
  params?: Record<string, any>;
  
  // Request body
  data?: any;
  
  // Headers
  headers?: Record<string, string>;
  
  // Timeouts
  timeout?: number | {
    connection?: number;
    request?: number;
    response?: number;
  };
  
  // Response handling
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
  
  // Authentication
  auth?: {
    username: string;
    password: string;
    type?: 'basic' | 'digest' | 'ntlm';
  };
  
  // Cookies
  cookies?: CookieJar | Record<string, string>;
  withCredentials?: boolean;
  
  // Proxy
  proxy?: {
    host: string;
    port: number;
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    auth?: { username: string; password: string };
  };
  
  // Retry configuration
  retry?: {
    attempts?: number;
    delay?: number;
    multiplier?: number;
    statusCodes?: number[];
    methods?: string[];
    condition?: (error: RezoError) => boolean;
  };
  
  // Redirects
  maxRedirects?: number;
  followRedirects?: boolean;
  
  // TLS/SSL
  rejectUnauthorized?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  
  // Cancellation
  signal?: AbortSignal;
  
  // Adapter selection
  adapter?: 'http' | 'http2' | 'fetch' | 'curl' | 'xhr' | 'react-native';
}`;

  const defaults = `// Get global defaults
console.log(rezo.defaults);

// Modify global defaults
rezo.defaults.timeout = 15000;
rezo.defaults.headers['X-Client-Version'] = '1.0.0';

// Instance defaults
const api = rezo.create({
  baseURL: 'https://api.example.com'
});

// Modify instance defaults after creation
api.defaults.timeout = 20000;
api.defaults.headers['Authorization'] = 'Bearer new-token';`;

  const headerMerging = `// Headers are merged in order: defaults < instance < request
const api = rezo.create({
  headers: {
    'Content-Type': 'application/json',
    'X-API-Version': '1.0'
  }
});

// This request will have:
// - Content-Type: application/xml (overridden)
// - X-API-Version: 1.0 (from instance)
// - Authorization: Bearer token (from request)
await api.get('/data', {
  headers: {
    'Content-Type': 'application/xml',
    'Authorization': 'Bearer token'
  }
});`;

  const baseUrl = `const api = rezo.create({
  baseURL: 'https://api.example.com/v1'
});

// Relative URLs are resolved against baseURL
await api.get('/users');          // https://api.example.com/v1/users
await api.get('users');           // https://api.example.com/v1/users

// Absolute URLs ignore baseURL
await api.get('https://other.com/data'); // https://other.com/data

// URLs starting with // use baseURL protocol
await api.get('//other.com/data'); // https://other.com/data`;

  const perMethodDefaults = `// Different defaults per HTTP method
const api = rezo.create({
  baseURL: 'https://api.example.com',
  
  // Default for all methods
  timeout: 10000,
  
  // These headers apply to all requests
  headers: {
    'Authorization': 'Bearer token'
  }
});

// POST/PUT/PATCH automatically set Content-Type if not specified
await api.post('/users', { name: 'John' });
// Content-Type: application/json (automatic)

// GET requests with query params
await api.get('/users', {
  params: { page: 1, limit: 10 }
});`;
</script>

<svelte:head>
  <title>Configuration - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Configuration</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn how to configure Rezo instances, set defaults, and customize request behavior.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Creating Instances</h2>
    <p class="mb-4" style="color: var(--muted);">
      Create configured instances for different APIs or use cases:
    </p>
    <CodeBlock code={createInstance} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">All Configuration Options</h2>
    <p class="mb-4" style="color: var(--muted);">
      Complete list of available request configuration options:
    </p>
    <CodeBlock code={allOptions} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Global and Instance Defaults</h2>
    <p class="mb-4" style="color: var(--muted);">
      Modify defaults globally or per-instance:
    </p>
    <CodeBlock code={defaults} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Header Merging</h2>
    <p class="mb-4" style="color: var(--muted);">
      Headers are merged from defaults → instance → request:
    </p>
    <CodeBlock code={headerMerging} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Base URL Resolution</h2>
    <p class="mb-4" style="color: var(--muted);">
      How relative and absolute URLs are resolved:
    </p>
    <CodeBlock code={baseUrl} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Per-Method Behavior</h2>
    <CodeBlock code={perMethodDefaults} language="typescript" />
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Error Handling</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about RezoError and handling failures</p>
    </div>
    <button on:click={() => navigate('/errors')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
