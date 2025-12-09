<script lang="ts">
  import { sidebarOpen } from '../stores/sidebar';
  import { navigate } from '../stores/router';
  
  export let currentPath: string = '/';
  
  const navItems = [
    { 
      title: 'Getting Started', 
      items: [
        { name: 'Introduction', path: '/docs' },
        { name: 'Installation', path: '/installation' },
        { name: 'Quick Start', path: '/quick-start' },
        { name: 'Why Rezo?', path: '/why-rezo' },
      ]
    },
    { 
      title: 'Core HTTP', 
      items: [
        { name: 'Making Requests', path: '/requests' },
        { name: 'Response Handling', path: '/responses' },
        { name: 'Configuration', path: '/configuration' },
        { name: 'Error Handling', path: '/errors' },
      ]
    },
    { 
      title: 'Advanced', 
      items: [
        { name: 'Cookies & Sessions', path: '/advanced/cookies' },
        { name: 'Hooks System', path: '/advanced/hooks' },
        { name: 'Retry & Resilience', path: '/advanced/retry' },
        { name: 'Caching', path: '/advanced/caching' },
        { name: 'Proxy Configuration', path: '/advanced/proxy' },
        { name: 'ProxyManager', path: '/advanced/proxy-manager' },
        { name: 'Queue & Rate Limiting', path: '/advanced/queue' },
        { name: 'Streaming', path: '/advanced/streaming' },
        { name: 'TLS & Security', path: '/advanced/security' },
      ]
    },
    { 
      title: 'Adapters', 
      items: [
        { name: 'Overview', path: '/adapters' },
        { name: 'HTTP Adapter', path: '/adapters/http' },
        { name: 'HTTP/2 Adapter', path: '/adapters/http2' },
        { name: 'Fetch Adapter', path: '/adapters/fetch' },
        { name: 'cURL Adapter', path: '/adapters/curl' },
        { name: 'XHR Adapter', path: '/adapters/xhr' },
        { name: 'React Native', path: '/adapters/react-native' },
      ]
    },
    { 
      title: 'Utilities', 
      items: [
        { name: 'RezoHeaders', path: '/utilities/headers' },
        { name: 'RezoFormData', path: '/utilities/formdata' },
        { name: 'RezoCookieJar', path: '/utilities/cookiejar' },
        { name: 'DOM Module', path: '/utilities/dom' },
      ]
    },
    { 
      title: 'Crawler', 
      items: [
        { name: 'Getting Started', path: '/crawler' },
        { name: 'Configuration', path: '/crawler/configuration' },
        { name: 'Event Handlers', path: '/crawler/events' },
        { name: 'Proxy Integration', path: '/crawler/proxy' },
        { name: 'Caching & Limits', path: '/crawler/caching' },
      ]
    },
    { 
      title: 'API Reference', 
      items: [
        { name: 'Rezo Instance', path: '/api/instance' },
        { name: 'Request Options', path: '/api/options' },
        { name: 'Response Object', path: '/api/response' },
        { name: 'RezoError', path: '/api/error' },
        { name: 'Types', path: '/api/types' },
      ]
    },
    { 
      title: 'Migration', 
      items: [
        { name: 'From Axios', path: '/migration/axios' },
        { name: 'From Got', path: '/migration/got' },
        { name: 'From node-fetch', path: '/migration/node-fetch' },
      ]
    },
    { 
      title: 'Resources', 
      items: [
        { name: 'Examples', path: '/examples' },
        { name: 'FAQ', path: '/faq' },
        { name: 'Changelog', path: '/changelog' },
        { name: 'Contributing', path: '/contributing' },
      ]
    },
  ];
  
  function isActive(path: string): boolean {
    return currentPath === path;
  }
  
  function handleClick(e: Event, path: string) {
    e.preventDefault();
    navigate(path);
    sidebarOpen.set(false);
  }
</script>

{#if $sidebarOpen}
  <div 
    class="fixed inset-0 bg-black/50 z-40 lg:hidden"
    on:click={() => sidebarOpen.set(false)}
    on:keydown={(e) => e.key === 'Escape' && sidebarOpen.set(false)}
    role="button"
    tabindex="0"
    aria-label="Close sidebar"
  ></div>
{/if}

<aside 
  class="fixed top-16 left-0 bottom-0 w-72 overflow-y-auto z-40 transition-transform duration-300 border-r lg:translate-x-0"
  class:translate-x-0={$sidebarOpen}
  class:-translate-x-full={!$sidebarOpen}
  style="background-color: var(--bg); border-color: var(--border);"
>
  <nav class="p-4 pb-20">
    {#each navItems as section}
      <div class="mb-6">
        <h3 class="px-3 mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted);">
          {section.title}
        </h3>
        <ul class="space-y-1">
          {#each section.items as item}
            <li>
              <a 
                href={'#' + item.path}
                class="sidebar-link block text-sm w-full text-left cursor-pointer"
                class:active={isActive(item.path)}
                on:click={(e) => handleClick(e, item.path)}
              >
                {item.name}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>
</aside>
