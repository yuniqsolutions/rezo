<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>RezoFormData - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>RezoFormData</h1>
  <p class="lead">
    RezoFormData is an enhanced FormData class for building multipart/form-data requests. It supports nested objects, file uploads, and automatic conversion from plain objects.
  </p>

  <h2>Import</h2>
  <CodeBlock 
    code={`import { RezoFormData } from 'rezo';`}
    language="typescript"
  />

  <h2>Creating FormData</h2>
  
  <h3>From Object</h3>
  <p>The <code>fromObject</code> method handles nested objects and arrays automatically.</p>
  <CodeBlock 
    code={`const formData = RezoFormData.fromObject({
  name: 'John Doe',
  email: 'john@example.com',
  profile: {
    age: 30,
    city: 'New York'
  },
  tags: ['developer', 'designer']
});

// Results in:
// name=John Doe
// email=john@example.com
// profile[age]=30
// profile[city]=New York
// tags[0]=developer
// tags[1]=designer`}
    language="typescript"
  />

  <h3>Manual Construction</h3>
  <CodeBlock 
    code={`const formData = new RezoFormData();

formData.append('username', 'johndoe');
formData.append('avatar', fileBuffer, 'avatar.png');`}
    language="typescript"
  />

  <h3>From Native FormData</h3>
  <CodeBlock 
    code={`const nativeFormData = new FormData();
nativeFormData.append('field', 'value');

const rezoFormData = await RezoFormData.fromNativeFormData(nativeFormData);`}
    language="typescript"
  />

  <h2>File Uploads</h2>
  <CodeBlock 
    code={`import { RezoFormData } from 'rezo';
import { readFileSync } from 'fs';

const formData = new RezoFormData();

// Append file with filename
formData.append('document', readFileSync('./report.pdf'), 'report.pdf');

// Append with content type
formData.append('image', imageBuffer, {
  filename: 'photo.jpg',
  contentType: 'image/jpeg'
});`}
    language="typescript"
  />

  <h2>Usage with Requests</h2>
  
  <h3>Using formData Option</h3>
  <CodeBlock 
    code={`import rezo, { RezoFormData } from 'rezo';

const formData = RezoFormData.fromObject({
  title: 'My Post',
  content: 'Post content here'
});

const response = await rezo.post('https://api.example.com/posts', {
  formData
});`}
    language="typescript"
  />

  <h3>Using postMultipart Helper</h3>
  <CodeBlock 
    code={`import rezo from 'rezo';

// Automatically converts object to FormData
const response = await rezo.postMultipart('https://api.example.com/upload', {
  name: 'John',
  avatar: fileBuffer
});`}
    language="typescript"
  />

  <h2>Method Reference</h2>
  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>append(name, value, filename?)</code></td>
        <td>Append a field to the form data</td>
      </tr>
      <tr>
        <td><code>set(name, value, filename?)</code></td>
        <td>Set a field value (replaces existing)</td>
      </tr>
      <tr>
        <td><code>get(name)</code></td>
        <td>Get a field value</td>
      </tr>
      <tr>
        <td><code>getAll(name)</code></td>
        <td>Get all values for a field</td>
      </tr>
      <tr>
        <td><code>has(name)</code></td>
        <td>Check if field exists</td>
      </tr>
      <tr>
        <td><code>delete(name)</code></td>
        <td>Remove a field</td>
      </tr>
      <tr>
        <td><code>fromObject(obj)</code></td>
        <td>Static: Create from plain object</td>
      </tr>
      <tr>
        <td><code>fromNativeFormData(fd)</code></td>
        <td>Static: Create from native FormData</td>
      </tr>
      <tr>
        <td><code>getBoundary()</code></td>
        <td>Get multipart boundary string</td>
      </tr>
      <tr>
        <td><code>getHeaders()</code></td>
        <td>Get headers including Content-Type with boundary</td>
      </tr>
    </tbody>
  </table>
</article>

<style>
  .prose {
    max-width: 65ch;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  
  .prose h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 1rem;
    background: linear-gradient(135deg, var(--primary), var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .lead {
    font-size: 1.25rem;
    color: var(--muted);
    margin-bottom: 2rem;
  }
  
  .prose h2 {
    font-size: 1.75rem;
    font-weight: 600;
    margin-top: 3rem;
    margin-bottom: 1rem;
    color: var(--text);
  }
  
  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    color: var(--text);
  }
  
  .prose p {
    margin-bottom: 1rem;
    line-height: 1.7;
    color: var(--text);
  }
  
  .prose code {
    background: var(--code-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    font-family: 'JetBrains Mono', monospace;
  }
  
  .prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
  }
  
  .prose th,
  .prose td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  
  .prose th {
    font-weight: 600;
    color: var(--text);
    background: var(--code-bg);
  }
  
  .prose td {
    color: var(--text);
  }
</style>
