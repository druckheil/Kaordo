<script lang="ts">
  import type { Snippet } from 'svelte';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import { Button } from './components/ui/button/index.js';

  let { name, description, homeHref, children }: {
    name: string;
    description: string;
    homeHref: string;
    children: Snippet;
  } = $props();
</script>

<main class="mx-auto min-h-screen max-w-6xl px-5 pb-16 pt-7 sm:px-8 sm:pt-10">
  <header class="flex items-center justify-between gap-4">
    <a href={homeHref} rel="external" class="inline-flex items-center gap-2 text-lg font-bold tracking-[-0.04em] text-primary">
      <span class="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">K</span> Kaordo
    </a>
    <Button href={homeHref} rel="external" variant="ghost" size="sm">All apps <ArrowUpRightIcon class="size-4" /></Button>
  </header>
  <section class="relative mt-12 overflow-hidden rounded-[2rem] border border-border bg-card p-7 shadow-[0_24px_80px_-48px_rgba(21,75,43,.45)] sm:p-12">
    <div class="pointer-events-none absolute -right-20 -top-32 size-80 rounded-full bg-accent blur-3xl" aria-hidden="true"></div>
    <div class="relative max-w-xl">
      <span class="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">In development</span>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.055em] sm:text-6xl">{name}</h1>
      <p class="mt-4 text-base leading-7 text-muted-foreground">{description}</p>
    </div>
  </section>
  <div class="max-w-xl">{@render children()}</div>
</main>
