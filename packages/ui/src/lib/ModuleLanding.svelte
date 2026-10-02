<script lang="ts">
  import type { Snippet } from 'svelte';
  import AppHeader from './AppHeader.svelte';

  let { name, description, homeHref, children }: {
    name: string;
    description: string;
    homeHref: string;
    children: Snippet;
  } = $props();
</script>

<AppHeader {name} {homeHref} />
<main id="main-content" tabindex="-1" class="mx-auto min-h-[calc(100dvh-4rem)] max-w-6xl px-5 pb-16 pt-10 sm:px-8">
  <section class="relative overflow-hidden rounded-[1.5rem] border border-border bg-card p-7 shadow-[0_24px_80px_-48px_rgba(21,75,43,.45)] sm:p-12">
    <div class="pointer-events-none absolute -right-20 -top-32 size-80 rounded-full bg-accent blur-3xl" aria-hidden="true"></div>
    <div class="relative max-w-xl">
      <span class="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">In development</span>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.055em] sm:text-6xl">{name}</h1>
      <p class="mt-4 text-base leading-7 text-muted-foreground">{description}</p>
    </div>
  </section>
  <div class="max-w-xl">{@render children()}</div>
</main>
