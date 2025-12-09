<svelte:head>
  <title>Rezo - Enterprise-grade HTTP Client for JavaScript</title>
</svelte:head>

<script lang="ts">
  import { navigate } from '../stores/router';
  import CodeBlock from '../components/CodeBlock.svelte';
  import { onMount } from 'svelte';
  import { siteMetadata } from '../data/site-metadata';

  let mounted = false;
  let scrollY = 0;
  
  onMount(() => {
    mounted = true;
    const handleScroll = () => scrollY = window.scrollY;
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  });

  const heroCode = `import rezo from 'rezo';

// Simple and intuitive API
const { data } = await rezo.get('https://api.example.com/users');

// Full TypeScript support
const user = await rezo.post<User>('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});`;

  const features = [
    {
      icon: '⚡',
      title: 'Lightning Fast',
      description: 'HTTP/2 with session pooling and multiplexing for maximum performance.'
    },
    {
      icon: '🔌',
      title: `${siteMetadata.adapterCount} Adapters`,
      description: 'HTTP, HTTP/2, Fetch, cURL, XHR, and React Native adapters.'
    },
    {
      icon: '🍪',
      title: 'Smart Cookies',
      description: 'Automatic cookie management with tough-cookie integration.'
    },
    {
      icon: '🔄',
      title: 'Retry Logic',
      description: 'Exponential backoff with customizable retry strategies.'
    },
    {
      icon: '🌐',
      title: 'Proxy Support',
      description: 'HTTP, HTTPS, SOCKS4/5 with rotation and health checking.'
    },
    {
      icon: '📦',
      title: 'Tree-Shakeable',
      description: 'Import only what you need for optimal bundle size.'
    }
  ];

  const stats = [
    { value: String(siteMetadata.adapterCount), label: 'Adapters' },
    { value: siteMetadata.typesCoverage, label: 'TypeScript' },
    { value: String(siteMetadata.dependencyCount), label: 'Dependencies' },
    { value: '∞', label: 'Possibilities' },
  ];

  const adapters = [
    { name: 'HTTP', desc: 'Full-featured Node.js adapter', icon: '🌐' },
    { name: 'HTTP/2', desc: 'Multiplexed connections', icon: '⚡' },
    { name: 'Fetch', desc: 'Browser & Edge runtimes', icon: '🌍' },
    { name: 'cURL', desc: 'Advanced auth & certificates', icon: '🔧' },
    { name: 'XHR', desc: 'Legacy browser support', icon: '📱' },
    { name: 'React Native', desc: 'Mobile applications', icon: '📲' },
  ];
</script>

<div class="min-h-screen landing-page" style="background-color: var(--bg); color: var(--text);">
  <section class="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32">
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="floating-orb orb-1" style="transform: translateY({scrollY * 0.1}px);"></div>
      <div class="floating-orb orb-2" style="transform: translateY({scrollY * -0.05}px);"></div>
      <div class="floating-orb orb-3" style="transform: translateY({scrollY * 0.08}px);"></div>
      <div class="grid-bg"></div>
    </div>

    <div class="relative max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center mb-12">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm mb-8 version-badge"
             class:animate-in={mounted}>
          <span class="w-2 h-2 rounded-full bg-green-500 pulse-glow"></span>
          <span style="color: var(--muted);">v{siteMetadata.version} now available</span>
        </div>
        
        <h1 class="text-4xl sm:text-5xl lg:text-7xl font-bold mb-6 leading-tight hero-title"
            class:animate-in={mounted}>
          The <span class="gradient-text-animated">Modern</span> HTTP Client<br/>
          for JavaScript
        </h1>
        
        <p class="text-lg sm:text-xl max-w-2xl mx-auto mb-10 hero-desc"
           class:animate-in={mounted}
           style="color: var(--muted);">
          Enterprise-grade HTTP client with HTTP/2 support, intelligent cookie management, 
          {siteMetadata.adapterCount} adapters, and comprehensive proxy support. Works everywhere.
        </p>
        
        <div class="flex flex-wrap items-center justify-center gap-4 mb-12 hero-buttons"
             class:animate-in={mounted}>
          <button 
            on:click={() => navigate('/docs')}
            class="cta-button primary"
          >
            <span class="cta-glow"></span>
            <span class="relative z-10">Get Started</span>
          </button>
          <button 
            on:click={() => navigate('/examples')}
            class="cta-button secondary"
          >
            View Examples
          </button>
        </div>

        <div class="flex items-center justify-center gap-4 text-sm hero-install"
             class:animate-in={mounted}
             style="color: var(--muted);">
          <code class="install-code">
            <span class="shimmer-overlay"></span>
            npm install rezo
          </code>
          <span>or</span>
          <code class="install-code">
            <span class="shimmer-overlay"></span>
            bun add rezo
          </code>
        </div>
      </div>

      <div class="max-w-2xl mx-auto hero-code" class:animate-in={mounted}>
        <div class="code-wrapper">
          <CodeBlock code={heroCode} language="typescript" filename="app.ts" />
        </div>
      </div>
    </div>
  </section>

  <section class="py-16 border-y stats-section" style="border-color: var(--border);">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
        {#each stats as stat, i}
          <div class="text-center stat-item" style="animation-delay: {i * 100}ms;">
            <div class="text-4xl sm:text-5xl font-bold gradient-text-animated mb-2 stat-value">{stat.value}</div>
            <div style="color: var(--muted);">{stat.label}</div>
          </div>
        {/each}
      </div>
      <p class="text-center text-sm mt-6" style="color: var(--muted);">
        Minimal runtime dependencies for proxy support, cookies, and streaming.
      </p>
    </div>
  </section>

  <section class="py-20 lg:py-32 features-section">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title">
          Everything You <span class="gradient-text-animated">Need</span>
        </h2>
        <p class="text-lg max-w-2xl mx-auto" style="color: var(--muted);">
          Built for developers who demand the best. Rezo provides all the tools you need
          for robust HTTP communication.
        </p>
      </div>

      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each features as feature, i}
          <div 
            class="feature-card"
            style="animation-delay: {i * 100}ms;"
          >
            <div class="feature-card-inner">
              <div class="feature-glow"></div>
              <div class="text-4xl mb-4 feature-icon">{feature.icon}</div>
              <h3 class="text-xl font-semibold mb-2">{feature.title}</h3>
              <p style="color: var(--muted);">{feature.description}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="py-20 lg:py-32 adapters-section" style="background-color: var(--surface);">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title">
          One Library, <span class="gradient-text-animated">Six Adapters</span>
        </h2>
        <p class="text-lg max-w-2xl mx-auto" style="color: var(--muted);">
          Choose the right adapter for your environment. Rezo automatically selects the best one,
          or you can import exactly what you need.
        </p>
      </div>

      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each adapters as adapter, i}
          <div 
            class="adapter-card"
            style="animation-delay: {i * 80}ms;"
          >
            <div class="adapter-card-border"></div>
            <div class="adapter-card-inner">
              <div class="text-3xl adapter-icon">{adapter.icon}</div>
              <div>
                <h3 class="font-semibold mb-1">{adapter.name}</h3>
                <p class="text-sm" style="color: var(--muted);">{adapter.desc}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="py-20 lg:py-32 runtimes-section">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title">
          Works <span class="gradient-text-animated">Everywhere</span>
        </h2>
        <p class="text-lg max-w-2xl mx-auto" style="color: var(--muted);">
          From Node.js servers to browser apps, from React Native to edge functions.
          Rezo runs wherever JavaScript runs.
        </p>
      </div>

      <div class="flex flex-wrap justify-center gap-4 text-center">
        {#each ['Node.js 22+', 'Bun', 'Deno', 'Browsers', 'React Native', 'Cloudflare Workers', 'Vercel Edge'] as runtime, i}
          <div 
            class="runtime-tag"
            style="animation-delay: {i * 60}ms;"
          >
            <span class="runtime-tag-glow"></span>
            <span class="relative z-10">{runtime}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="py-20 lg:py-32 border-t cta-section" style="border-color: var(--border); background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%);">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 text-center">
      <div class="cta-glow-bg"></div>
      <h2 class="text-3xl sm:text-4xl font-bold mb-6 section-title relative z-10">
        Ready to <span class="gradient-text-animated">Get Started</span>?
      </h2>
      <p class="text-lg mb-10 relative z-10" style="color: var(--muted);">
        Join developers who have already made the switch to Rezo.
        It takes less than a minute to get started.
      </p>
      
      <div class="flex flex-wrap items-center justify-center gap-4 relative z-10">
        <button 
          on:click={() => navigate('/docs')}
          class="cta-button primary large"
        >
          <span class="cta-glow"></span>
          <span class="relative z-10">Read the Docs</span>
        </button>
        <a 
          href="https://github.com/yuniqsolutions/rezo"
          target="_blank"
          rel="noopener"
          class="cta-button secondary large flex items-center gap-2"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
          </svg>
          GitHub
        </a>
      </div>
    </div>
  </section>

  <footer class="py-8 border-t" style="border-color: var(--border);">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <p style="color: var(--muted);">Built with care for the JavaScript community</p>
        <div class="flex items-center gap-6" style="color: var(--muted);">
          <a href="#/docs" class="footer-link cursor-pointer">Docs</a>
          <a href="https://github.com/yuniqsolutions/rezo" target="_blank" rel="noopener" class="footer-link cursor-pointer">GitHub</a>
          <a href="https://npmjs.com/package/rezo" target="_blank" rel="noopener" class="footer-link cursor-pointer">npm</a>
        </div>
      </div>
    </div>
  </footer>
</div>

<style>
  .landing-page {
    --gradient-start: #00d4ff;
    --gradient-mid: #0099ff;
    --gradient-end: #0066cc;
  }

  .floating-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    animation: float 20s ease-in-out infinite;
  }

  .orb-1 {
    width: 600px;
    height: 600px;
    top: -200px;
    right: -100px;
    background: radial-gradient(circle, var(--gradient-start) 0%, transparent 70%);
    opacity: 0.15;
    animation-delay: 0s;
  }

  .orb-2 {
    width: 500px;
    height: 500px;
    bottom: -100px;
    left: -150px;
    background: radial-gradient(circle, var(--gradient-end) 0%, transparent 70%);
    opacity: 0.1;
    animation-delay: -7s;
  }

  .orb-3 {
    width: 400px;
    height: 400px;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, var(--gradient-mid) 0%, transparent 70%);
    opacity: 0.08;
    animation-delay: -14s;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0) scale(1); }
    33% { transform: translateY(-30px) scale(1.05); }
    66% { transform: translateY(20px) scale(0.95); }
  }

  .grid-bg {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
  }

  .gradient-text-animated {
    background: linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end), var(--gradient-start));
    background-size: 300% 300%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: gradient-shift 8s ease infinite;
  }

  @keyframes gradient-shift {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }

  .pulse-glow {
    animation: pulse-glow 2s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
    50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  }

  .version-badge {
    background-color: var(--surface);
    border: 1px solid var(--border);
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .version-badge.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-title {
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s;
  }

  .hero-title.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-desc {
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s;
  }

  .hero-desc.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-buttons {
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s;
  }

  .hero-buttons.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-install {
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.4s;
  }

  .hero-install.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-code {
    opacity: 0;
    transform: translateY(30px);
    transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s;
  }

  .hero-code.animate-in {
    opacity: 1;
    transform: translateY(0);
  }

  .code-wrapper {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
  }

  .code-wrapper::before {
    content: '';
    position: absolute;
    inset: -2px;
    background: linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end));
    border-radius: 18px;
    z-index: -1;
    opacity: 0.5;
    animation: border-glow 3s ease-in-out infinite alternate;
  }

  @keyframes border-glow {
    0% { opacity: 0.3; filter: blur(4px); }
    100% { opacity: 0.6; filter: blur(8px); }
  }

  .cta-button {
    position: relative;
    padding: 1rem 2rem;
    border-radius: 12px;
    font-weight: 600;
    font-size: 1.125rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  .cta-button.large {
    padding: 1.25rem 2.5rem;
  }

  .cta-button.primary {
    background: linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end));
    color: white;
    border: none;
    box-shadow: 0 10px 40px rgba(0, 212, 255, 0.3);
  }

  .cta-button.primary:hover {
    transform: translateY(-2px) scale(1.02);
    box-shadow: 0 15px 50px rgba(0, 212, 255, 0.4);
  }

  .cta-button.primary .cta-glow {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.3), transparent);
    opacity: 0;
    transition: opacity 0.3s;
  }

  .cta-button.primary:hover .cta-glow {
    opacity: 1;
  }

  .cta-button.secondary {
    background: transparent;
    color: var(--text);
    border: 2px solid var(--border);
  }

  .cta-button.secondary:hover {
    transform: translateY(-2px) scale(1.02);
    border-color: var(--gradient-start);
    box-shadow: 0 10px 30px rgba(0, 212, 255, 0.15);
  }

  .install-code {
    position: relative;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-family: 'JetBrains Mono', monospace;
    background-color: var(--surface);
    overflow: hidden;
  }

  .shimmer-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
    transform: translateX(-100%);
    animation: shimmer 3s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    50%, 100% { transform: translateX(100%); }
  }

  .stats-section {
    background: linear-gradient(180deg, var(--surface) 0%, rgba(0, 212, 255, 0.02) 50%, var(--surface) 100%);
  }

  .stat-item {
    animation: fade-up 0.6s ease-out forwards;
    opacity: 0;
  }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .stat-value {
    text-shadow: 0 0 40px rgba(0, 212, 255, 0.3);
  }

  .feature-card {
    position: relative;
    animation: fade-up 0.6s ease-out forwards;
    opacity: 0;
  }

  .feature-card-inner {
    position: relative;
    padding: 1.5rem;
    border-radius: 16px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    height: 100%;
  }

  .feature-glow {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100px;
    background: linear-gradient(180deg, rgba(0, 212, 255, 0.1), transparent);
    opacity: 0;
    transition: opacity 0.4s;
  }

  .feature-card:hover .feature-card-inner {
    transform: translateY(-4px);
    border-color: rgba(0, 212, 255, 0.3);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1), 0 0 40px rgba(0, 212, 255, 0.1);
  }

  .feature-card:hover .feature-glow {
    opacity: 1;
  }

  .feature-icon {
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .feature-card:hover .feature-icon {
    transform: scale(1.2);
  }

  .adapter-card {
    position: relative;
    animation: fade-up 0.5s ease-out forwards;
    opacity: 0;
  }

  .adapter-card-border {
    position: absolute;
    inset: 0;
    border-radius: 12px;
    padding: 1px;
    background: linear-gradient(135deg, transparent, transparent);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: xor;
    -webkit-mask-composite: xor;
    transition: background 0.4s;
  }

  .adapter-card:hover .adapter-card-border {
    background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
  }

  .adapter-card-inner {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 12px;
    background-color: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .adapter-card:hover .adapter-card-inner {
    border-color: transparent;
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  }

  .adapter-icon {
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .adapter-card:hover .adapter-icon {
    transform: scale(1.15) rotate(-5deg);
  }

  .runtime-tag {
    position: relative;
    padding: 0.75rem 1.5rem;
    border-radius: 9999px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    animation: fade-up 0.5s ease-out forwards;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  .runtime-tag-glow {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(0, 102, 204, 0.15));
    opacity: 0;
    transition: opacity 0.3s;
  }

  .runtime-tag:hover {
    transform: translateY(-2px);
    border-color: rgba(0, 212, 255, 0.4);
    box-shadow: 0 10px 30px rgba(0, 212, 255, 0.15);
  }

  .runtime-tag:hover .runtime-tag-glow {
    opacity: 1;
  }

  .cta-section {
    position: relative;
    overflow: hidden;
  }

  .cta-glow-bg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
    height: 400px;
    background: radial-gradient(ellipse, rgba(0, 212, 255, 0.1) 0%, transparent 70%);
    animation: pulse-slow 4s ease-in-out infinite;
  }

  @keyframes pulse-slow {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
    50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
  }

  .footer-link {
    position: relative;
    transition: color 0.3s;
  }

  .footer-link::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .footer-link:hover {
    color: var(--gradient-start);
  }

  .footer-link:hover::after {
    width: 100%;
  }

  .section-title {
    position: relative;
    display: inline-block;
  }
</style>
