<script lang="ts">
  import { router } from './lib/stores/router';
  import Layout from './lib/components/Layout.svelte';
  import Header from './lib/components/Header.svelte';
  import SearchModal from './lib/components/SearchModal.svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  
  import Landing from './lib/pages/Landing.svelte';
  import Home from './lib/pages/Home.svelte';
  import Installation from './lib/pages/Installation.svelte';
  import QuickStart from './lib/pages/QuickStart.svelte';
  import WhyRezo from './lib/pages/WhyRezo.svelte';
  import Requests from './lib/pages/Requests.svelte';
  import Responses from './lib/pages/Responses.svelte';
  import Configuration from './lib/pages/Configuration.svelte';
  import Errors from './lib/pages/Errors.svelte';
  import Adapters from './lib/pages/Adapters.svelte';
  import AdapterHttp from './lib/pages/adapters/Http.svelte';
  import AdapterHttp2 from './lib/pages/adapters/Http2.svelte';
  import AdapterFetch from './lib/pages/adapters/Fetch.svelte';
  import AdapterCurl from './lib/pages/adapters/Curl.svelte';
  import AdapterXhr from './lib/pages/adapters/Xhr.svelte';
  import AdapterReactNative from './lib/pages/adapters/ReactNative.svelte';
  import Cookies from './lib/pages/advanced/Cookies.svelte';
  import Proxy from './lib/pages/advanced/Proxy.svelte';
  import ProxyManager from './lib/pages/advanced/ProxyManager.svelte';
  import Streaming from './lib/pages/advanced/Streaming.svelte';
  import Retry from './lib/pages/advanced/Retry.svelte';
  import Hooks from './lib/pages/advanced/Hooks.svelte';
  import Queue from './lib/pages/advanced/Queue.svelte';
  import Caching from './lib/pages/advanced/Caching.svelte';
  import Security from './lib/pages/advanced/Security.svelte';
  import ApiInstance from './lib/pages/api/Instance.svelte';
  import ApiOptions from './lib/pages/api/Options.svelte';
  import ApiResponse from './lib/pages/api/Response.svelte';
  import ApiError from './lib/pages/api/Error.svelte';
  import ApiTypes from './lib/pages/api/Types.svelte';
  import UtilHeaders from './lib/pages/utilities/Headers.svelte';
  import UtilFormData from './lib/pages/utilities/FormData.svelte';
  import UtilCookieJar from './lib/pages/utilities/CookieJar.svelte';
  import UtilDom from './lib/pages/utilities/Dom.svelte';
  import CrawlerIndex from './lib/pages/crawler/Index.svelte';
  import CrawlerConfig from './lib/pages/crawler/Configuration.svelte';
  import CrawlerEvents from './lib/pages/crawler/Events.svelte';
  import CrawlerProxy from './lib/pages/crawler/Proxy.svelte';
  import CrawlerCaching from './lib/pages/crawler/Caching.svelte';
  import MigrationAxios from './lib/pages/migration/Axios.svelte';
  import MigrationGot from './lib/pages/migration/Got.svelte';
  import MigrationNodeFetch from './lib/pages/migration/NodeFetch.svelte';
  import Examples from './lib/pages/Examples.svelte';
  import Faq from './lib/pages/Faq.svelte';
  import Changelog from './lib/pages/Changelog.svelte';
  import Contributing from './lib/pages/Contributing.svelte';

  const routes: Record<string, any> = {
    '/': Landing,
    '/docs': Home,
    '/installation': Installation,
    '/quick-start': QuickStart,
    '/why-rezo': WhyRezo,
    '/requests': Requests,
    '/responses': Responses,
    '/configuration': Configuration,
    '/errors': Errors,
    '/adapters': Adapters,
    '/adapters/http': AdapterHttp,
    '/adapters/http2': AdapterHttp2,
    '/adapters/fetch': AdapterFetch,
    '/adapters/curl': AdapterCurl,
    '/adapters/xhr': AdapterXhr,
    '/adapters/react-native': AdapterReactNative,
    '/advanced/cookies': Cookies,
    '/advanced/proxy': Proxy,
    '/advanced/proxy-manager': ProxyManager,
    '/advanced/streaming': Streaming,
    '/advanced/retry': Retry,
    '/advanced/hooks': Hooks,
    '/advanced/queue': Queue,
    '/advanced/caching': Caching,
    '/advanced/security': Security,
    '/api/instance': ApiInstance,
    '/api/options': ApiOptions,
    '/api/response': ApiResponse,
    '/api/error': ApiError,
    '/api/types': ApiTypes,
    '/utilities/headers': UtilHeaders,
    '/utilities/formdata': UtilFormData,
    '/utilities/cookiejar': UtilCookieJar,
    '/utilities/dom': UtilDom,
    '/crawler': CrawlerIndex,
    '/crawler/configuration': CrawlerConfig,
    '/crawler/events': CrawlerEvents,
    '/crawler/proxy': CrawlerProxy,
    '/crawler/caching': CrawlerCaching,
    '/migration/axios': MigrationAxios,
    '/migration/got': MigrationGot,
    '/migration/node-fetch': MigrationNodeFetch,
    '/examples': Examples,
    '/faq': Faq,
    '/changelog': Changelog,
    '/contributing': Contributing,
  };

  $: currentPath = $router;
  $: CurrentPage = routes[currentPath] || Home;
  $: isLanding = currentPath === '/';
</script>

{#if isLanding}
  <div 
    class="page-wrapper"
    style="background-color: var(--bg); color: var(--text);"
    in:fade={{ duration: 300, easing: cubicOut }}
  >
    <Header isLanding={true} />
    <SearchModal />
    <Landing />
  </div>
{:else}
  <div 
    class="page-wrapper"
    in:fade={{ duration: 300, easing: cubicOut }}
  >
    <Layout {currentPath}>
      {#key currentPath}
        <div 
          class="page-content"
          in:fly={{ y: 20, duration: 400, delay: 100, easing: cubicOut }}
          out:fade={{ duration: 150 }}
        >
          <svelte:component this={CurrentPage} />
        </div>
      {/key}
    </Layout>
  </div>
{/if}

<style>
  .page-wrapper {
    min-height: 100vh;
  }

  .page-content {
    animation: page-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes page-enter {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  :global(html) {
    scroll-behavior: smooth;
  }

  :global(.page-transition-enter) {
    opacity: 0;
    transform: translateY(20px);
  }

  :global(.page-transition-enter-active) {
    opacity: 1;
    transform: translateY(0);
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :global(.page-transition-exit) {
    opacity: 1;
  }

  :global(.page-transition-exit-active) {
    opacity: 0;
    transition: opacity 0.15s ease-out;
  }
</style>
