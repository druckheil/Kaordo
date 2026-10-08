<script lang="ts">
  // Uses normal profile links with the app's SvelteKit navigation when available

  import { getContext, type Snippet } from 'svelte';
  import { profileHashForUsername, profileNavigationKey } from './fluo-model';

  let { username, children, class: className = '', label, onNavigate }: {
    username: string;
    children: Snippet;
    class?: string;
    label?: string;
    onNavigate?: () => void;
  } = $props();
  const navigate = getContext<((username: string) => void) | undefined>(profileNavigationKey);
  function open(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (navigate) {
      event.preventDefault();
      navigate(username);
    }
    onNavigate?.();
  }
</script>

<a href={profileHashForUsername(username)} class={className} aria-label={label} onclick={open}>{@render children()}</a>
