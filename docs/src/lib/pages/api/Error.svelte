<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const errorType = `class RezoError extends Error {
  // Error identification
  name: 'RezoError';
  code: RezoErrorCode;
  isRezoError: true;

  // HTTP details
  status?: number;
  statusText?: string;

  // Error type flags
  isHttpError: boolean;
  isNetworkError: boolean;
  isTimeout: boolean;
  isAborted: boolean;
  isProxyError: boolean;
  isSocksError: boolean;
  isTlsError: boolean;
  isRetryable: boolean;

  // Helpful information
  details: string;
  suggestion: string;

  // Request/Response
  config: RezoRequestConfig;
  request?: any;
  response?: RezoResponse;

  // Static method
  static isRezoError(error: any): error is RezoError;
}

enum RezoErrorCode {
  TIMEOUT = 'ETIMEDOUT',
  NETWORK_ERROR = 'ENETWORK',
  HTTP_ERROR = 'EHTTP',
  PROXY_ERROR = 'EPROXY',
  ABORT = 'EABORT',
  TLS_ERROR = 'ETLS',
  // ...
}`;
</script>

<svelte:head>
  <title>RezoError API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">RezoError</h1>
    <p class="text-lg" style="color: var(--muted);">
      Error class with enhanced details and type identification.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Error Type</h2>
    <CodeBlock code={errorType} language="typescript" />
  </section>
</div>
