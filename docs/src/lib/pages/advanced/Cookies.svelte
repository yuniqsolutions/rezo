<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const adHocCookies = `// Use the cookies option for ad-hoc/one-time cookies
// (NOT the jar option - jar is for cookie jar management)
await rezo.get('https://example.com', {
  cookies: {
    session: 'abc123',
    user: 'john'
  }
});

// Or as an array
await rezo.get('https://example.com', {
  cookies: [
    { key: 'session', value: 'abc123', domain: 'example.com' }
  ]
});

// Or as a Netscape format string
await rezo.get('https://example.com', {
  cookies: 'session=abc123; user=john'
});`;

  const cookieJar = `import { RezoCookieJar } from 'rezo';
import rezo from 'rezo';

// Create a cookie jar for persistence
const myJar = new RezoCookieJar();

// Pass jar when creating an instance (recommended)
const client = rezo.create({ jar: myJar });
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies sent automatically

// Access cookies
const cookies = myJar.getCookiesSync('https://example.com');`;

  const cookieResponse = `const response = await rezo.get('https://example.com');

// Response cookies are available in multiple formats
const cookies = response.cookies;

cookies.array          // [{name, value, domain, path, ...}]
cookies.serialized     // {name: value, name2: value2}
cookies.netscape       // Netscape format string
cookies.string         // "name=value; name2=value2"
cookies.setCookiesString // "name=value; Path=/; Domain=..."`;

  const cookieMerging = `// Cookies are automatically merged
// Request cookies + Response cookies = Final result

const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });

// First request sets cookies
await client.get('https://example.com/set-cookies');
// jar now has: session=abc, user=john

// Second request gets new cookies
const response = await client.get('https://example.com/more-cookies');
// If server sets: user=jane, token=xyz

// Response cookies contain merged result:
// session=abc (from request), user=jane (updated), token=xyz (new)`;

  const cookieSerialization = `const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });
// ... make requests ...

// Serialize to JSON for storage
const json = myJar.toJSON();
fs.writeFileSync('cookies.json', JSON.stringify(json));

// Restore from JSON
const saved = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
const restoredJar = RezoCookieJar.fromJSON(saved);

// Continue with restored cookies
const client2 = rezo.create({ jar: restoredJar });
await client2.get('https://example.com');`;

  const manualCookies = `// Set cookies manually in headers
await rezo.get('https://example.com', {
  headers: {
    'Cookie': 'session=abc123; user=john'
  }
});

// Or use the cookies option (object format)
await rezo.get('https://example.com', {
  cookies: {
    session: 'abc123',
    user: 'john'
  }
});`;

  const instanceCookieJar = `import Rezo from 'rezo';

// Create an instance with a cookie jar 
const client = new Rezo();

// Cookies are automatically managed across requests
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies sent automatically

// Access the instance's global cookie jar
const jar = client.cookieJar;
const allCookies = jar.cookies();
console.log(allCookies.serialized);

// Replace the cookie jar
import { RezoCookieJar } from 'rezo';
client.cookieJar = new RezoCookieJar();

// Save cookies to file
client.saveCookies('./cookies.json');

// Clear all cookies
client.clearCookies();`;

  const createWithCookieJar = `import Rezo, { RezoCookieJar } from 'rezo';

// Create instance with existing cookie jar (recommended)
const myJar = new RezoCookieJar();
const client = Rezo.create({ jar: myJar });

// Or load from file
const clientFromFile = Rezo.create({
  cookieFile: './cookies.json'
});

// Cookies are shared across all requests made by this instance
await client.get('https://example.com/login');
await client.get('https://example.com/api'); // Same jar used`;
</script>

<svelte:head>
  <title>Cookie Management - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Cookies & Sessions</h1>
    <p class="text-lg" style="color: var(--muted);">
      Learn about Rezo's intelligent cookie handling with RezoCookieJar.
    </p>
  </header>

  <section class="info-box">
    <h3 class="text-lg font-semibold mb-2">Key Concepts</h3>
    <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);">
      <li><strong>jar</strong> - Cookie jar instance (pass via constructor, NOT per-request)</li>
      <li><strong>cookies</strong> - Ad-hoc cookies for individual requests</li>
      <li><strong>cookieJar</strong> - Instance property to access/replace the jar</li>
    </ul>
  </section>

  <section class="warning-box">
    <h3 class="text-lg font-semibold mb-2">Fetch Adapter Limitation</h3>
    <p style="color: var(--muted);">
      The Fetch adapter supports cookies in Node.js, Deno, Bun, and edge runtimes, but <strong>NOT in browsers</strong>.
      Browser security restrictions prevent the Fetch API from accessing cookies programmatically.
      Use the HTTP adapter or XHR adapter for browser cookie management.
    </p>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Jar</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use RezoCookieJar for automatic cookie persistence:
    </p>
    <CodeBlock code={cookieJar} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Cookies</h2>
    <p class="mb-4" style="color: var(--muted);">
      Cookies are available in multiple formats:
    </p>
    <CodeBlock code={cookieResponse} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Merging</h2>
    <p class="mb-4" style="color: var(--muted);">
      Request and response cookies are automatically merged:
    </p>
    <CodeBlock code={cookieMerging} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Serialization</h2>
    <p class="mb-4" style="color: var(--muted);">
      Save and restore cookies for long-term persistence:
    </p>
    <CodeBlock code={cookieSerialization} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Ad-Hoc Cookies</h2>
    <p class="mb-4" style="color: var(--muted);">
      Use the <code>cookies</code> option for one-time cookies on individual requests.
      This is the recommended way to send custom cookies without affecting the cookie jar:
    </p>
    <CodeBlock code={adHocCookies} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Manual Cookies (Legacy)</h2>
    <p class="mb-4" style="color: var(--muted);">
      You can also set cookies via headers, but the <code>cookies</code> option above is preferred:
    </p>
    <CodeBlock code={manualCookies} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Instance Cookie Jar</h2>
    <p class="mb-4" style="color: var(--muted);">
      Every Rezo instance has a built-in cookie jar. Access it via the <code>cookieJar</code> property:
    </p>
    <CodeBlock code={instanceCookieJar} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Creating Instances with Cookie Jars</h2>
    <p class="mb-4" style="color: var(--muted);">
      Pass a cookie jar when creating a Rezo instance for shared cookie management:
    </p>
    <CodeBlock code={createWithCookieJar} language="typescript" />
  </section>

  <section class="tip-box">
    <h3 class="text-lg font-semibold mb-2">Best Practices</h3>
    <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);">
      <li>Pass <code>jar</code> when creating the Rezo instance, not per-request</li>
      <li>Use <code>cookies</code> option for ad-hoc cookies on specific requests</li>
      <li>Access the instance jar via <code>client.cookieJar</code> property</li>
      <li>Per-request <code>jar</code> is supported but NOT recommended</li>
    </ul>
  </section>
</div>

<style>
  .info-box {
    background: var(--code-bg);
    border-left: 4px solid var(--primary);
    padding: 1rem;
    border-radius: 0.25rem;
  }
  
  .warning-box {
    background: rgba(251, 146, 60, 0.1);
    border-left: 4px solid #f97316;
    padding: 1rem;
    border-radius: 0.25rem;
  }
  
  .tip-box {
    background: rgba(34, 197, 94, 0.1);
    border-left: 4px solid #22c55e;
    padding: 1rem;
    border-radius: 0.25rem;
  }
  
  code {
    background: var(--code-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }
</style>
