<script lang="ts">
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import { Button } from './components/ui/button/index.js';

  let { name, homeHref, sticky = false, wide = false }: {
    name: string;
    homeHref: string;
    sticky?: boolean;
    wide?: boolean;
  } = $props();
</script>

<header class={`shrink-0 border-b border-border/80 bg-background/95 backdrop-blur-xl ${sticky ? 'sticky top-0 z-20' : ''}`}>
  <div class={`mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 ${wide ? 'max-w-[90rem]' : 'max-w-6xl'}`}>
    <div class="flex min-w-0 items-center gap-2.5">
      <a href={homeHref} rel="external" aria-label="Kaordo home"
        class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring">K</a>
      <span class="hidden text-sm font-bold tracking-tight text-primary min-[390px]:inline">Kaordo</span>
      <span class="text-border" aria-hidden="true">/</span>
      <span class="truncate text-base font-bold tracking-tight">{name}</span>
    </div>
    <Button href={homeHref} rel="external" variant="ghost" size="sm" class="shrink-0">
      All apps <ArrowUpRightIcon class="size-4" />
    </Button>
  </div>
</header>
