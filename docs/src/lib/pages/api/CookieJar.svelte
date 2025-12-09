<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const basicUsage = `import { RezoCookieJar } from 'rezo';
import rezo from 'rezo';

const myJar = new RezoCookieJar();

// Set a cookie manually
myJar.setCookieSync('session=abc123; Path=/; Domain=example.com', 'https://example.com');

// Get cookies for a URL
const cookies = myJar.getCookiesSync('https://example.com');

// Create an instance with the jar (recommended)
const client = rezo.create({ jar: myJar });
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies sent automatically`;

  const responseFormats = `// Response cookies come in multiple formats
const response = await rezo.get('https://example.com');

response.cookies.array          // Cookie[] - Full cookie objects
response.cookies.serialized     // SerializedCookie[] - JSON-serializable
response.cookies.string         // "name=value; name2=value2"
response.cookies.netscape       // Netscape/Mozilla cookies.txt format
response.cookies.setCookiesString // ["name=value; Path=/; Domain=...", ...]`;

  const serialization = `const jar = new RezoCookieJar();

// Serialize to JSON for storage
const json = jar.toJSON();
fs.writeFileSync('cookies.json', JSON.stringify(json));

// Restore from JSON
const saved = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
const restored = RezoCookieJar.fromJSON(saved);

// Or use built-in file persistence
jar.loadFromFile('cookies.json');  // Supports .json and .txt (Netscape)
jar.saveToFile('cookies.json');    // Auto-detects format from extension`;

  const jarMethods = `const jar = new RezoCookieJar();

// Get all cookies in various formats
jar.cookies()               // Returns Cookies object with all formats
jar.toCookieString()        // "name=value; name2=value2"
jar.toNetscapeCookie()      // Netscape format string
jar.toArray()               // Cookie[]
jar.toSetCookies()          // Set-Cookie header strings
jar.toSerializedCookies()   // SerializedCookie[]

// Set cookies from various formats
jar.setCookiesSync('name=value', 'https://example.com')              // Single cookie
jar.setCookiesSync(['name=value; Path=/', 'other=123'], url)         // Array of Set-Cookie strings
jar.setCookiesSync(serializedCookies)                                // From serialized format
jar.setCookiesSync(netscapeString)                                   // From Netscape format`;

  const staticMethods = `import { RezoCookieJar, Cookie } from 'rezo';

// Convert Netscape format to Set-Cookie headers
const setCookies = RezoCookieJar.netscapeCookiesToSetCookieArray(netscapeText);

// Convert cookies to Netscape format
const netscape = RezoCookieJar.toNetscapeCookie(cookies);

// Convert cookies to cookie string
const cookieString = RezoCookieJar.toCookieString(cookies);

// Check if object is a Cookie
if (Cookie.isCookie(obj)) {
  console.log(obj.key, obj.value);
}`;
</script>

<svelte:head>
  <title>CookieJar API - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">RezoCookieJar</h1>
    <p class="text-lg" style="color: var(--muted);">
      RezoCookieJar provides RFC 6265 compliant cookie persistence with automatic domain management, serialization, and multi-format support.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Basic Usage</h2>
    <CodeBlock code={basicUsage} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Response Cookie Formats</h2>
    <p class="mb-4" style="color: var(--muted);">
      Response cookies are available in multiple formats for different use cases:
    </p>
    <CodeBlock code={responseFormats} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Serialization & Persistence</h2>
    <p class="mb-4" style="color: var(--muted);">
      Save and restore cookies for long-term persistence:
    </p>
    <CodeBlock code={serialization} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Instance Methods</h2>
    <CodeBlock code={jarMethods} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Static Methods</h2>
    <CodeBlock code={staticMethods} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Cookie Object Properties</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b" style="border-color: var(--border);">
            <th class="text-left py-3 px-4">Property</th>
            <th class="text-left py-3 px-4">Type</th>
            <th class="text-left py-3 px-4">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>key</code></td>
            <td class="py-2 px-4">string</td>
            <td class="py-2 px-4">Cookie name</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>value</code></td>
            <td class="py-2 px-4">string</td>
            <td class="py-2 px-4">Cookie value</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>domain</code></td>
            <td class="py-2 px-4">string</td>
            <td class="py-2 px-4">Cookie domain</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>path</code></td>
            <td class="py-2 px-4">string</td>
            <td class="py-2 px-4">Cookie path</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>expires</code></td>
            <td class="py-2 px-4">Date</td>
            <td class="py-2 px-4">Expiration date</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>secure</code></td>
            <td class="py-2 px-4">boolean</td>
            <td class="py-2 px-4">HTTPS only</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>httpOnly</code></td>
            <td class="py-2 px-4">boolean</td>
            <td class="py-2 px-4">Not accessible via JavaScript</td>
          </tr>
          <tr class="border-b" style="border-color: var(--border);">
            <td class="py-2 px-4"><code>sameSite</code></td>
            <td class="py-2 px-4">string</td>
            <td class="py-2 px-4">SameSite policy (Strict, Lax, None)</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</div>
