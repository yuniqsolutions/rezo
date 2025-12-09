<script lang="ts">
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';
  import SearchModal from './SearchModal.svelte';
  import { theme } from '../stores/theme';
  import { onMount } from 'svelte';
  
  export let currentPath: string = '/';
  
  onMount(() => {
    theme.init();
  });
</script>

<div class="min-h-screen transition-colors duration-300" style="background-color: var(--bg); color: var(--text);">
  <Header isLanding={false} />
  <Sidebar {currentPath} />
  <SearchModal />
  
  <main class="pt-16 lg:pl-72">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
      <slot />
    </div>
  </main>
</div>
