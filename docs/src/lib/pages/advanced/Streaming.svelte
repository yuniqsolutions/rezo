<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const streamResponse = `// Get a streaming response
const stream = await rezo.getStream('https://example.com/large-file');

stream.on('data', (chunk) => {
  console.log('Received:', chunk.length, 'bytes');
  processChunk(chunk);
});

stream.on('end', () => {
  console.log('Stream complete');
});

stream.on('error', (error) => {
  console.error('Stream error:', error);
});`;

  const downloadFile = `// Download file with progress
const download = await rezo.download(
  'https://example.com/video.mp4',
  './downloads/video.mp4'
);

download.on('progress', (progress) => {
  console.log(\`Downloaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
  console.log(\`ETA: \${progress.eta} seconds\`);
});

download.on('complete', (stats) => {
  console.log('Download complete!');
  console.log(\`Total: \${stats.totalBytes} bytes\`);
  console.log(\`Duration: \${stats.duration}ms\`);
});

download.on('error', (error) => {
  console.error('Download failed:', error);
});`;

  const uploadProgress = `import { RezoFormData } from 'rezo';

const form = new RezoFormData();
form.append('video', fs.createReadStream('./large-video.mp4'));

const upload = await rezo.upload('https://api.example.com/upload', form);

upload.on('progress', (progress) => {
  console.log(\`Uploaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete!');
  console.log('Server response:', response.data);
});`;

  const streamBody = `import { createReadStream } from 'fs';

// Stream a file as request body
const stream = createReadStream('./large-data.json');

await rezo.post('https://api.example.com/import', stream, {
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': String(fs.statSync('./large-data.json').size)
  }
});`;
</script>

<svelte:head>
  <title>Streaming Responses - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Streaming</h1>
    <p class="text-lg" style="color: var(--muted);">
      Memory-efficient streaming for large file downloads, uploads, and data processing.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Stream Response</h2>
    <CodeBlock code={streamResponse} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Download with Progress</h2>
    <CodeBlock code={downloadFile} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Upload with Progress</h2>
    <CodeBlock code={uploadProgress} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Stream Request Body</h2>
    <CodeBlock code={streamBody} language="typescript" />
  </section>
</div>
