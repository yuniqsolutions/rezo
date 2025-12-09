<script lang="ts">
  import { theme } from '../stores/theme';
  import { sidebarOpen } from '../stores/sidebar';
  import { searchOpen } from '../stores/search';
  import { navigate } from '../stores/router';
  import logoLight from '../../assets/logo-dark.svg';
  import logoDark from '../../assets/logo.svg';

  export let isLanding = false;

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchOpen.set(true);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<header class="fixed top-0 left-0 right-0 z-50 h-16 border-b transition-colors duration-300"
  style="background-color: var(--bg); border-color: var(--border);">
  <div class="flex items-center justify-between h-full px-4 lg:px-6 max-w-[1600px] mx-auto">
    <div class="flex items-center gap-4">
      {#if !isLanding}
        <button 
          class="lg:hidden p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
          on:click={() => sidebarOpen.update(v => !v)}
          aria-label="Toggle menu"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      {/if}
      
      <a href="#/" class="flex items-center cursor-pointer">
        {#if $theme === 'dark'}
          <img src={logoDark} alt="Rezo" class="h-8" />
        {:else}
          <img src={logoLight} alt="Rezo" class="h-8" />
        {/if}
      </a>
    </div>

    <div class="flex items-center gap-2 sm:gap-4">
      <button 
        class="lg:hidden p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
        on:click={() => searchOpen.set(true)}
        aria-label="Search"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      
      <button 
        class="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-sm cursor-pointer"
        style="background-color: var(--surface); border-color: var(--border); color: var(--muted);"
        on:click={() => searchOpen.set(true)}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span>Search...</span>
        <kbd class="hidden md:inline px-1.5 py-0.5 text-xs rounded" style="background-color: var(--border);">Ctrl+K</kbd>
      </button>

      <a 
        href="https://github.com/user/rezo" 
        target="_blank" 
        rel="noopener"
        class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
        aria-label="GitHub"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
          <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
        </svg>
      </a>

      <a 
        href="https://npmjs.com/package/rezo" 
        target="_blank" 
        rel="noopener"
        class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
        aria-label="npm"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
          <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"/>
        </svg>
      </a>

      <button 
        class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
        on:click={() => theme.toggle()}
        aria-label="Toggle theme"
      >
        {#if $theme === 'dark'}
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        {:else}
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
</header>
