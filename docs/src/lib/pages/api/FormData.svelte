<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const formDataClass = `import { RezoFormData } from 'rezo';

const form = new RezoFormData();

// Append text field
form.append('name', 'John Doe');

// Append file with options
form.append('avatar', fs.createReadStream('./photo.jpg'), {
  filename: 'photo.jpg',
  contentType: 'image/jpeg'
});

// Append buffer
form.append('data', Buffer.from('binary data'), {
  filename: 'data.bin',
  contentType: 'application/octet-stream'
});`;

  const fromObject = `// Create from object (recommended)
const form = RezoFormData.fromObject({
  name: 'John Doe',              // → plain text
  age: 30,                       // → plain text
  active: true,                  // → plain text
  metadata: { role: 'admin' },   // → JSON with Content-Type
  tags: ['js', 'http', 'api']    // → multiple entries
});

// Equivalent to:
// form.append('name', 'John Doe')
// form.append('age', '30')
// form.append('active', 'true')
// form.append('metadata', '{"role":"admin"}', {
//   filename: 'metadata.json',
//   contentType: 'application/json'
// })
// form.append('tags', 'js')
// form.append('tags', 'http')
// form.append('tags', 'api')`;
</script>

<svelte:head>
  <title>FormData API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">RezoFormData</h1>
    <p class="text-lg" style="color: var(--muted);">
      Enhanced FormData class with object conversion and proper handling.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={formDataClass} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">fromObject()</h2>
    <CodeBlock code={fromObject} language="typescript" />
  </section>
</div>
