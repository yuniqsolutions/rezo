<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';
  import { navigate } from '../stores/router';

  const responseObject = `const response = await rezo.get('/api/users');

// Response properties
response.data       // Parsed response body (auto-detected)
response.status     // HTTP status code (200, 404, etc.)
response.statusText // Status text ("OK", "Not Found", etc.)
response.headers    // Response headers (RezoHeaders object)
response.cookies    // Response cookies (merged with request cookies)
response.config     // The request configuration used
response.request    // The underlying request object`;

  const responseData = `// JSON responses are auto-parsed
const response = await rezo.get('/api/users');
const users = response.data; // Already an object

// Access typed data
interface User {
  id: number;
  name: string;
}
const response = await rezo.get<User[]>('/api/users');
const users: User[] = response.data;

// Text responses
const html = await rezo.get('/page.html', { responseType: 'text' });
console.log(html.data); // HTML string

// Binary data
const image = await rezo.get('/image.png', { responseType: 'arraybuffer' });
const buffer = image.data; // ArrayBuffer`;

  const responseHeaders = `const response = await rezo.get('/api/users');

// Access headers (case-insensitive)
response.headers.get('content-type');
response.headers.get('Content-Type'); // Same result

// Get all headers
for (const [name, value] of response.headers) {
  console.log(name, value);
}

// Check if header exists
response.headers.has('x-custom-header');

// Get multiple values (for Set-Cookie, etc.)
response.headers.getAll('set-cookie');`;

  const responseCookies = `const response = await rezo.get('/api/login');

// Access cookies object
const cookies = response.cookies;

// Different formats available
cookies.array        // Array of cookie objects with metadata
cookies.serialized   // Object with cookie key-value pairs
cookies.netscape     // Netscape format string
cookies.string       // Simple "key=value; key2=value2" string
cookies.setCookiesString // Set-Cookie header format

// Cookie merging
// Request cookies + Response cookies = Merged result
// Response cookies overwrite request cookies with same name/domain`;

  const streamResponse = `// Stream response for large files
const response = await rezo.getStream('/api/large-file');

// response is a StreamResponse
response.on('data', (chunk) => {
  console.log('Received chunk:', chunk.length, 'bytes');
});

response.on('end', () => {
  console.log('Download complete');
});

response.on('error', (error) => {
  console.error('Stream error:', error);
});`;

  const downloadResponse = `// Download to file with progress
const download = await rezo.download('/api/file.zip', './output.zip');

download.on('progress', (progress) => {
  console.log(\`Downloaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
  console.log(\`Remaining: \${progress.remaining} bytes\`);
});

download.on('complete', (stats) => {
  console.log('Download complete!');
  console.log(\`Total size: \${stats.totalBytes}\`);
  console.log(\`Duration: \${stats.duration}ms\`);
});

download.on('error', (error) => {
  console.error('Download failed:', error);
});`;

  const uploadResponse = `// Upload with progress tracking
const form = new RezoFormData();
form.append('file', fs.createReadStream('./large-file.mp4'));

const upload = await rezo.upload('/api/upload', form);

upload.on('progress', (progress) => {
  console.log(\`Uploaded: \${progress.percent}%\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete!');
  console.log('Server response:', response.data);
});`;
</script>

<svelte:head>
  <title>Response Handling - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Response Handling</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn how to work with response data, headers, cookies, and streaming responses.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Object</h2>
    <p class="mb-4" style="color: var(--muted);">
      Every successful request returns a response object with these properties:
    </p>
    <CodeBlock code={responseObject} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Data</h2>
    <p class="mb-4" style="color: var(--muted);">
      Response data is automatically parsed based on content type:
    </p>
    <CodeBlock code={responseData} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Headers</h2>
    <p class="mb-4" style="color: var(--muted);">
      Access response headers using the RezoHeaders object:
    </p>
    <CodeBlock code={responseHeaders} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Cookies</h2>
    <p class="mb-4" style="color: var(--muted);">
      All adapters return merged cookies (request + response):
    </p>
    <CodeBlock code={responseCookies} language="typescript" />
    
    <div class="mt-6 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-2">Cookie Merging</h4>
      <p class="text-sm" style="color: var(--muted);">
        Rezo automatically merges request cookies with response Set-Cookie headers. 
        Response cookies with the same key and domain overwrite request cookies. 
        This ensures cookie persistence works correctly across requests.
      </p>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Stream Responses</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use streaming for memory-efficient handling of large responses:
    </p>
    <CodeBlock code={streamResponse} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Download with Progress</h2>
    <p class="mb-4" style="color: var(--muted);">
      Download files directly to disk with progress tracking:
    </p>
    <CodeBlock code={downloadResponse} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Upload with Progress</h2>
    <p class="mb-4" style="color: var(--muted);">
      Track upload progress for large file transfers:
    </p>
    <CodeBlock code={uploadResponse} language="typescript" />
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Configuration</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about instance configuration and defaults</p>
    </div>
    <button on:click={() => navigate('/configuration')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
