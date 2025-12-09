<script lang="ts">
  import { onMount } from 'svelte';
  import hljs from 'highlight.js/lib/core';
  import javascript from 'highlight.js/lib/languages/javascript';
  import typescript from 'highlight.js/lib/languages/typescript';
  import bash from 'highlight.js/lib/languages/bash';
  import json from 'highlight.js/lib/languages/json';

  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('ts', typescript);

  export let code: string;
  export let language: string = 'typescript';
  export let filename: string = '';
  export let showLineNumbers: boolean = true;

  let copied = false;
  let highlightedLines: string[] = [];

  onMount(() => {
    const trimmedCode = code.trim();
    const lines = trimmedCode.split('\n');
    highlightedLines = lines.map(line => {
      try {
        return hljs.highlight(line || ' ', { language }).value;
      } catch {
        return line || ' ';
      }
    });
  });

  async function copyCode() {
    await navigator.clipboard.writeText(code.trim());
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  $: lines = code.trim().split('\n');
</script>

<div class="code-block my-4 overflow-hidden">
  {#if filename}
    <div class="flex items-center justify-between px-4 py-2 border-b" style="border-color: var(--border);">
      <span class="text-sm font-mono" style="color: var(--muted);">{filename}</span>
      <button 
        class="flex items-center gap-1.5 text-xs px-2 py-1 rounded hover:bg-[var(--border)] transition-colors cursor-pointer"
        style="color: var(--muted);"
        on:click={copyCode}
      >
        {#if copied}
          <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        {:else}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        {/if}
      </button>
    </div>
  {/if}
  
  <div class="relative group">
    {#if !filename}
      <button 
        class="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        style="background-color: var(--border); color: var(--muted);"
        on:click={copyCode}
      >
        {#if copied}
          <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        {:else}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        {/if}
      </button>
    {/if}
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <tbody>
          {#each lines as line, i}
            <tr>
              {#if showLineNumbers}
                <td class="select-none text-right pr-4 pl-4 py-0 align-top" style="color: var(--muted); width: 1%; white-space: nowrap;">
                  {i + 1}
                </td>
              {/if}
              <td class="py-0 pr-4" style="white-space: pre;">
                {@html highlightedLines[i] || line || ' '}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  .code-block table {
    font-family: var(--font-mono);
    line-height: 1.6;
  }
  
  .code-block td {
    vertical-align: top;
  }

  :global(.hljs-keyword) { color: #c792ea; }
  :global(.hljs-string) { color: #c3e88d; }
  :global(.hljs-number) { color: #f78c6c; }
  :global(.hljs-function) { color: #82aaff; }
  :global(.hljs-title) { color: #82aaff; }
  :global(.hljs-params) { color: #89ddff; }
  :global(.hljs-comment) { color: #676e95; font-style: italic; }
  :global(.hljs-built_in) { color: #ffcb6b; }
  :global(.hljs-attr) { color: #ffcb6b; }
  :global(.hljs-literal) { color: #ff5370; }
  :global(.hljs-variable) { color: #f07178; }
  :global(.hljs-property) { color: #82aaff; }
  :global(.hljs-punctuation) { color: #89ddff; }
</style>
