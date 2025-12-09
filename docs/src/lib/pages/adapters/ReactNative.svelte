<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
  import { navigate } from '../../stores/router';

  const basicUsage = `import rezo from 'rezo/adapters/react-native';

// Optimized for React Native environment
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);`;

  const cookieHandling = `// Cookies are handled via headers (not cookie jar)
// This is because React Native's networking doesn't support cookie jars

await rezo.get('https://api.example.com/protected', {
  headers: {
    'Cookie': 'session=abc123; token=xyz789'
  }
});

// Response cookies are parsed from headers
const response = await rezo.get('https://api.example.com/login');
console.log(response.cookies); // Parsed from Set-Cookie headers`;

  const fileDownload = `// Download files with react-native-fs
import RNFS from 'react-native-fs';

const download = await rezo.download(
  'https://example.com/video.mp4',
  RNFS.DocumentDirectoryPath + '/video.mp4'
);

download.on('progress', (p) => {
  console.log(\`Downloaded: \${p.percent}%\`);
});

download.on('complete', () => {
  console.log('Download complete!');
});`;

  const fileUpload = `import { RezoFormData } from 'rezo';

// Upload files from local storage
const form = new RezoFormData();
form.append('photo', {
  uri: 'file:///path/to/photo.jpg',
  type: 'image/jpeg',
  name: 'photo.jpg'
});

const response = await rezo.post('https://api.example.com/upload', form);`;

  const imageUpload = `// Upload from camera/gallery
import { launchImageLibrary } from 'react-native-image-picker';

const result = await launchImageLibrary({ mediaType: 'photo' });
const asset = result.assets?.[0];

if (asset) {
  const form = new RezoFormData();
  form.append('photo', {
    uri: asset.uri,
    type: asset.type || 'image/jpeg',
    name: asset.fileName || 'photo.jpg'
  });
  
  await rezo.post('https://api.example.com/photos', form);
}`;
</script>

<svelte:head>
  <title>React Native Adapter - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <div class="flex items-center gap-3 mb-4">
      <span class="text-4xl">📱</span>
      <h1 class="text-3xl sm:text-4xl font-bold">React Native Adapter</h1>
    </div>
    <p class="text-lg" style="color: var(--muted);">
      Mobile-optimized HTTP adapter with manual cookie headers, react-native-fs 
      download support, and platform-specific optimizations.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Handling</h2>
    <p class="mb-4" style="color: var(--muted);">
      Cookies are handled via headers since React Native doesn't support cookie jars:
    </p>
    <CodeBlock code={cookieHandling} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">File Downloads</h2>
    <p class="mb-4" style="color: var(--muted);">
      Download files with progress using react-native-fs:
    </p>
    <CodeBlock code={fileDownload} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">File Uploads</h2>
    <p class="mb-4" style="color: var(--muted);">
      Upload files from the device:
    </p>
    <CodeBlock code={fileUpload} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Image Picker Integration</h2>
    <CodeBlock code={imageUpload} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Setup Requirements</h2>
    <div class="p-4 rounded-lg" style="background-color: var(--surface);">
      <h4 class="font-semibold mb-3">Optional Dependencies</h4>
      <ul class="text-sm space-y-2" style="color: var(--muted);">
        <li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-fs</code> - For file downloads</li>
        <li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-image-picker</code> - For camera/gallery uploads</li>
        <li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-document-picker</code> - For document uploads</li>
      </ul>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Platform Considerations</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">iOS</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• ATS (App Transport Security) applies</li>
          <li>• HTTPS required by default</li>
          <li>• Add exceptions in Info.plist if needed</li>
        </ul>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h4 class="font-semibold mb-2">Android</h4>
        <ul class="text-sm space-y-1" style="color: var(--muted);">
          <li>• Network security config applies</li>
          <li>• Cleartext traffic disabled by default</li>
          <li>• Add network_security_config.xml if needed</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
    <div>
      <h3 class="font-semibold mb-1">Next: Cookie Management</h3>
      <p class="text-sm" style="color: var(--muted);">Learn about advanced cookie handling</p>
    </div>
    <button on:click={() => navigate('/advanced/cookies')} class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">
      Continue →
    </button>
  </section>
</div>
