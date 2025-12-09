<script lang="ts">
  import { navigate } from '../stores/router';
  
  export let href: string;
  let className = '';
  export { className as class };
  export let style = '';
</script>

<button 
  on:click={() => navigate(href)} 
  class={className}
  {style}
>
  <slot />
</button>
