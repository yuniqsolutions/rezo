<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const allOptions = `interface RezoRequestConfig {
  // URL Configuration
  url?: string;
  baseURL?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  params?: Record<string, any>;

  // Request Body
  data?: any;

  // Headers
  headers?: Record<string, string>;

  // Timeouts
  timeout?: number | {
    connection?: number;
    request?: number;
    response?: number;
  };

  // Response
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
  validateStatus?: (status: number) => boolean;

  // Authentication
  auth?: {
    username: string;
    password: string;
    type?: 'basic' | 'digest' | 'ntlm';
  };

  // Cookies
  jar?: CookieJar;
  cookies?: Record<string, string>;
  withCredentials?: boolean;

  // Proxy
  proxy?: {
    host: string;
    port: number;
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    auth?: { username: string; password: string };
  };
  proxyManager?: ProxyManager;
  useProxyManager?: boolean;

  // Retry
  retry?: {
    attempts?: number;
    delay?: number;
    multiplier?: number;
    statusCodes?: number[];
    methods?: string[];
    condition?: (error: RezoError) => boolean;
    respectRetryAfter?: boolean;
  };

  // Redirects
  maxRedirects?: number;
  followRedirects?: boolean;

  // TLS/SSL
  rejectUnauthorized?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  passphrase?: string;

  // Cancellation
  signal?: AbortSignal;

  // Adapter
  adapter?: 'http' | 'http2' | 'fetch' | 'curl' | 'xhr' | 'react-native';

  // Progress
  onUploadProgress?: (progress: ProgressEvent) => void;
  onDownloadProgress?: (progress: ProgressEvent) => void;

  // Hooks
  hooks?: {
    init?: Function[];
    beforeRequest?: Function[];
    beforeRedirect?: Function[];
    beforeRetry?: Function[];
    afterResponse?: Function[];
    beforeError?: Function[];
  };
}`;
</script>

<svelte:head>
  <title>Request Options API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Request Options</h1>
    <p class="text-lg" style="color: var(--muted);">
      Complete reference for all request configuration options.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">All Options</h2>
    <CodeBlock code={allOptions} language="typescript" />
  </section>
</div>
