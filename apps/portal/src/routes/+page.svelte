<script lang="ts">
  import { ArrowUpRightIcon, Button } from '@kaordo/ui';
  import { appPaths } from '@kaordo/links';

  const modules = [
    { name: 'Ligo', path: appPaths.ligo, description: 'Messages' },
    { name: 'Fluo', path: appPaths.fluo, description: 'Social' },
    { name: 'Rondo', path: appPaths.rondo, description: 'Communities' },
    { name: 'Regado', path: appPaths.regado, description: 'Administration' }
  ];
</script>

<svelte:head><title>Kaordo</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
  <p class="text-sm text-muted-foreground">Kaordo 0.0.1</p>
  <h1 class="mt-2 text-3xl font-semibold">Kaordo</h1>
  <p class="mt-4 text-muted-foreground">Application scaffolds</p>
  <div class="mt-8 flex flex-wrap gap-3">
    {#each modules as module}
      <Button href={module.path} rel="external" variant="outline">
        {module.name} · {module.description}
        <ArrowUpRightIcon class="size-4" />
      </Button>
    {/each}
  </div>
</main>
