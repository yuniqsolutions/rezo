<script lang="ts">
  import { searchOpen, searchQuery } from '../stores/search';
  import { navigate } from '../stores/router';
  import Fuse from 'fuse.js';
  import { onMount } from 'svelte';
  import { searchIndex, type SearchItem } from '../data/search-index';

  const typeIcons: Record<string, string> = {
    page: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    concept: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    api: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    example: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    guide: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  };

  const fuse = new Fuse(searchIndex, {
    keys: [
      { name: 'title', weight: 4 },
      { name: 'content', weight: 2 },
      { name: 'category', weight: 1.5 },
      { name: 'type', weight: 0.5 }
    ],
    threshold: 0.35,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const defaultResults = searchIndex.filter(item => item.type === 'page').slice(0, 8);
  
  let results: SearchItem[] = [];
  let selectedIndex = 0;
  let inputEl: HTMLInputElement;

  $: if ($searchQuery && $searchQuery.length >= 1) {
    results = fuse.search($searchQuery).slice(0, 12).map(r => r.item);
    selectedIndex = 0;
  } else {
    results = defaultResults;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      navigateTo(results[selectedIndex].path);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  function navigateTo(path: string) {
    close();
    setTimeout(() => {
      navigate(path);
    }, 10);
  }

  function close() {
    searchOpen.set(false);
    searchQuery.set('');
  }

  onMount(() => {
    setTimeout(() => inputEl?.focus(), 50);
  });
</script>

{#if $searchOpen}
  <div 
    class="fixed inset-0 bg-black/50 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[15vh]"
    on:click={close}
    on:keydown={(e) => e.key === 'Escape' && close()}
    role="button"
    tabindex="-1"
    aria-label="Close search"
  >
    <div 
      class="w-full max-w-xl mx-4 rounded-xl shadow-2xl overflow-hidden"
      style="background-color: var(--bg); border: 1px solid var(--border);"
      on:click|stopPropagation
      on:keydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="flex items-center px-4 border-b" style="border-color: var(--border);">
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input 
          bind:this={inputEl}
          bind:value={$searchQuery}
          type="text" 
          placeholder="Search documentation..."
          class="flex-1 px-4 py-4 bg-transparent outline-none text-lg"
          style="color: var(--text);"
        />
        <button on:click={close} class="cursor-pointer">
          <kbd class="px-2 py-1 text-xs rounded" style="background-color: var(--surface); color: var(--muted);">ESC</kbd>
        </button>
      </div>
      
      <div class="max-h-[60vh] overflow-y-auto">
        {#if results.length === 0}
          <div class="px-4 py-8 text-center" style="color: var(--muted);">
            No results found for "{$searchQuery}"
          </div>
        {:else}
          <ul class="py-2">
            {#each results as item, i}
              <li>
                <a 
                  href={'#' + item.path}
                  class="flex items-center gap-3 px-4 py-3 transition-colors w-full text-left cursor-pointer"
                  class:selected={i === selectedIndex}
                  style="color: var(--text);"
                  on:click|preventDefault={() => navigateTo(item.path)}
                  on:mouseenter={() => selectedIndex = i}
                >
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background-color: var(--surface);">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #00d4ff;">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={typeIcons[item.type] || typeIcons.page} />
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium truncate">{item.title}</div>
                    <div class="text-sm truncate" style="color: var(--muted);">{item.category}</div>
                  </div>
                  {#if i === selectedIndex}
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      
      <div class="flex items-center justify-between px-4 py-3 border-t text-xs" style="border-color: var(--border); color: var(--muted);">
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 rounded" style="background-color: var(--surface);">↑↓</kbd>
            Navigate
          </span>
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 rounded" style="background-color: var(--surface);">↵</kbd>
            Select
          </span>
        </div>
        <span>Powered by Fuse.js</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .selected {
    background-color: rgba(0, 212, 255, 0.1);
  }
</style>
