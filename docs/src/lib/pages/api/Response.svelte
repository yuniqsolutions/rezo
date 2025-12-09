<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const responseType = `interface RezoResponse<T = any> {
  // Response data (auto-parsed)
  data: T;

  // HTTP status
  status: number;
  statusText: string;

  // Headers
  headers: RezoHeaders;

  // Cookies (merged request + response)
  cookies: {
    array: Cookie[];
    serialized: Record<string, string>;
    netscape: string;
    string: string;
    setCookiesString: string;
  };

  // Original request config
  config: RezoRequestConfig;

  // Underlying request object
  request: any;

  // Transfer metrics
  metrics?: {
    requestSize: number;
    responseSize: number;
    duration: number;
    contentLength: number;
  };
}`;
</script>

<svelte:head>
  <title>Response API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Response Object</h1>
    <p class="text-lg" style="color: var(--muted);">
      Structure of the response object returned by Rezo.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Type</h2>
    <CodeBlock code={responseType} language="typescript" />
  </section>
</div>
