<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';
</script>

<svelte:head>
  <title>RezoCookieJar - Rezo Documentation</title>
</svelte:head>

<article class="prose">
  <h1>RezoCookieJar</h1>
  <p class="lead">
    RezoCookieJar provides RFC 6265 compliant cookie management with support for file persistence, multiple serialization formats, and domain-aware cookie handling.
  </p>

  <h2>Import</h2>
  <CodeBlock 
    code={`import { RezoCookieJar, Cookie } from 'rezo';`}
    language="typescript"
  />

  <h2>Basic Usage</h2>
  <p>
    Rezo manages cookies automatically. Access the cookie jar via the <code>cookieJar</code> property.
  </p>
  <CodeBlock 
    code={`import rezo from 'rezo';

// Make requests - cookies are handled automatically
await rezo.get('https://example.com/login');
await rezo.post('https://example.com/api/data', { body: { key: 'value' } });

// Access the cookie jar
const jar = rezo.cookieJar;

// Get all cookies for a domain
const cookies = jar.getCookiesSync('https://example.com');
console.log(cookies);`}
    language="typescript"
  />

  <h2>Custom Cookie Jar</h2>
  <CodeBlock 
    code={`import { Rezo, RezoCookieJar } from 'rezo';

// Create custom cookie jar
const jar = new RezoCookieJar();

// Create client with custom jar
const client = new Rezo({ jar });

// Or assign later
client.cookieJar = new RezoCookieJar();`}
    language="typescript"
  />

  <h2>File Persistence</h2>
  <p>
    Save and load cookies from files in JSON or Netscape format.
  </p>
  <CodeBlock 
    code={`import { RezoCookieJar } from 'rezo';

const jar = new RezoCookieJar();

// Save to JSON file
jar.saveToFile('./cookies.json');

// Save to Netscape format (compatible with curl, wget)
jar.saveToFile('./cookies.txt');

// Load from file
const loadedJar = RezoCookieJar.loadFromFile('./cookies.json');`}
    language="typescript"
  />

  <h3>Automatic Persistence</h3>
  <CodeBlock 
    code={`import { Rezo } from 'rezo';

// Cookies automatically saved after each request
const client = new Rezo({
  cookieFile: './cookies.json'
});`}
    language="typescript"
  />

  <h2>Manual Cookie Operations</h2>
  
  <h3>Setting Cookies</h3>
  <CodeBlock 
    code={`import { RezoCookieJar } from 'rezo';

const jar = new RezoCookieJar();

// Set cookie string
jar.setCookieSync(
  'session=abc123; Path=/; HttpOnly; Secure',
  'https://example.com'
);

// Set Cookie object
jar.setCookieSync({
  key: 'token',
  value: 'xyz789',
  domain: 'example.com',
  path: '/',
  httpOnly: true,
  secure: true,
  expires: new Date(Date.now() + 3600000)
}, 'https://example.com');`}
    language="typescript"
  />

  <h3>Getting Cookies</h3>
  <CodeBlock 
    code={`// Get all cookies for URL
const cookies = jar.getCookiesSync('https://example.com/api');

// Get cookie string for request header
const cookieString = jar.getCookieStringSync('https://example.com/api');
// Returns: "session=abc123; token=xyz789"

// Find specific cookie
const sessionCookie = cookies.find(c => c.key === 'session');`}
    language="typescript"
  />

  <h3>Removing Cookies</h3>
  <CodeBlock 
    code={`// Remove specific cookie
jar.removeCookie('example.com', '/', 'session');

// Remove all cookies for domain
jar.removeCookies('example.com');

// Clear all cookies
jar.removeAllCookies();`}
    language="typescript"
  />

  <h2>Serialization</h2>
  <CodeBlock 
    code={`const jar = new RezoCookieJar();

// Serialize to JSON string
const jsonString = jar.serializeSync();

// Deserialize from JSON string
const restoredJar = RezoCookieJar.deserializeSync(jsonString);

// Get as Netscape format string
const netscapeString = jar.toNetscapeString();`}
    language="typescript"
  />

  <h2>Cookie Object Properties</h2>
  <table>
    <thead>
      <tr>
        <th>Property</th>
        <th>Type</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>key</code></td>
        <td><code>string</code></td>
        <td>Cookie name</td>
      </tr>
      <tr>
        <td><code>value</code></td>
        <td><code>string</code></td>
        <td>Cookie value</td>
      </tr>
      <tr>
        <td><code>domain</code></td>
        <td><code>string</code></td>
        <td>Domain the cookie belongs to</td>
      </tr>
      <tr>
        <td><code>path</code></td>
        <td><code>string</code></td>
        <td>URL path scope</td>
      </tr>
      <tr>
        <td><code>expires</code></td>
        <td><code>Date</code></td>
        <td>Expiration date</td>
      </tr>
      <tr>
        <td><code>httpOnly</code></td>
        <td><code>boolean</code></td>
        <td>HTTP only flag</td>
      </tr>
      <tr>
        <td><code>secure</code></td>
        <td><code>boolean</code></td>
        <td>Secure flag (HTTPS only)</td>
      </tr>
      <tr>
        <td><code>sameSite</code></td>
        <td><code>'strict' | 'lax' | 'none'</code></td>
        <td>SameSite attribute</td>
      </tr>
    </tbody>
  </table>

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
        <td><code>setCookieSync(cookie, url)</code></td>
        <td>Set a cookie for URL</td>
      </tr>
      <tr>
        <td><code>getCookiesSync(url)</code></td>
        <td>Get all cookies for URL</td>
      </tr>
      <tr>
        <td><code>getCookieStringSync(url)</code></td>
        <td>Get Cookie header string</td>
      </tr>
      <tr>
        <td><code>removeCookie(domain, path, key)</code></td>
        <td>Remove specific cookie</td>
      </tr>
      <tr>
        <td><code>removeCookies(domain)</code></td>
        <td>Remove all cookies for domain</td>
      </tr>
      <tr>
        <td><code>removeAllCookies()</code></td>
        <td>Clear all cookies</td>
      </tr>
      <tr>
        <td><code>saveToFile(path)</code></td>
        <td>Save to JSON or Netscape file</td>
      </tr>
      <tr>
        <td><code>loadFromFile(path)</code></td>
        <td>Static: Load from file</td>
      </tr>
      <tr>
        <td><code>serializeSync()</code></td>
        <td>Serialize to JSON string</td>
      </tr>
      <tr>
        <td><code>deserializeSync(str)</code></td>
        <td>Static: Deserialize from JSON</td>
      </tr>
      <tr>
        <td><code>toNetscapeString()</code></td>
        <td>Export as Netscape format</td>
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
