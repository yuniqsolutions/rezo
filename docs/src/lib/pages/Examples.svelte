<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';

  const examples = [
    {
      title: 'REST API Client',
      description: 'Create a typed API client with authentication',
      code: `import rezo from 'rezo';

interface User {
  id: number;
  name: string;
  email: string;
}

const api = rezo.create({
  baseURL: 'https://api.example.com/v1',
  headers: {
    'Authorization': 'Bearer ' + process.env.API_TOKEN
  }
});

// Typed requests
const users = await api.get<User[]>('/users');
const user = await api.post<User>('/users', { name: 'John', email: 'john@example.com' });`
    },
    {
      title: 'File Upload with Progress',
      description: 'Upload large files with progress tracking',
      code: `import rezo, { RezoFormData } from 'rezo';
import fs from 'fs';

const form = new RezoFormData();
form.append('file', fs.createReadStream('./video.mp4'));
form.append('title', 'My Video');

const upload = await rezo.upload('https://api.example.com/upload', form);

upload.on('progress', (p) => {
  console.log(\`Uploading: \${p.percent}% (\${p.speed} bytes/sec)\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete:', response.data);
});`
    },
    {
      title: 'Web Scraping with Cookies',
      description: 'Maintain session across requests',
      code: `import rezo, { RezoCookieJar } from 'rezo';

const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });

// Login and store cookies
await client.post('https://example.com/login', {
  username: 'user',
  password: 'pass'
});

// Access protected page with cookies
const dashboard = await client.get('https://example.com/dashboard');
console.log(dashboard.data);

// Save cookies for later
fs.writeFileSync('cookies.json', JSON.stringify(myJar.toJSON()));`
    },
    {
      title: 'Proxy Rotation',
      description: 'Rotate proxies for web scraping',
      code: `import rezo, { ProxyManager } from 'rezo';

const manager = new ProxyManager({
  proxies: [
    { host: 'proxy1.example.com', port: 8080 },
    { host: 'proxy2.example.com', port: 8080 },
    { host: 'proxy3.example.com', port: 8080 }
  ],
  strategy: 'random',
  failureThreshold: 3
});

const api = rezo.create({ proxyManager: manager });

// Each request uses a different proxy
for (let i = 0; i < 100; i++) {
  const response = await api.get('https://target-site.com/page/' + i);
  console.log(response.data);
}`
    },
    {
      title: 'Rate-Limited API Calls',
      description: 'Queue requests with rate limiting',
      code: `import rezo, { HttpQueue } from 'rezo';

const queue = new HttpQueue({
  concurrency: 5,
  perDomainConcurrency: 2,
  interval: 1000,
  intervalCap: 10
});

const urls = Array.from({ length: 100 }, (_, i) => 
  'https://api.example.com/items/' + i
);

// Add all requests to queue
const results = await Promise.all(
  urls.map(url => queue.add(() => rezo.get(url)))
);

console.log('All requests completed:', results.length);`
    },
    {
      title: 'Auto Token Refresh',
      description: 'Automatically refresh expired tokens',
      code: `import rezo from 'rezo';

let accessToken = 'initial-token';
let refreshToken = 'refresh-token';

const api = rezo.create({
  baseURL: 'https://api.example.com',
  hooks: {
    beforeRequest: [(options) => {
      options.headers.Authorization = 'Bearer ' + accessToken;
      return options;
    }],
    beforeError: [async (error) => {
      if (error.status === 401) {
        // Refresh the token
        const response = await rezo.post('https://auth.example.com/refresh', {
          refreshToken
        });
        accessToken = response.data.accessToken;
        
        // Retry original request
        error.config.headers.Authorization = 'Bearer ' + accessToken;
        return await rezo.request(error.config);
      }
      throw error;
    }]
  }
});`
    }
  ];
</script>

<svelte:head>
  <title>Examples - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Examples</h1>
    <p class="text-lg" style="color: var(--muted);">
      Real-world examples and common patterns with Rezo.
    </p>
  </header>

  {#each examples as example}
    <section>
      <h2 class="text-2xl font-bold mb-2">{example.title}</h2>
      <p class="mb-4" style="color: var(--muted);">{example.description}</p>
      <CodeBlock code={example.code} language="typescript" />
    </section>
  {/each}
</div>
