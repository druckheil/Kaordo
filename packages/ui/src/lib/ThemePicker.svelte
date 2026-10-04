<script lang="ts">
  // Selects a persisted theme through Rhea choice cards with live palette previews
  import { setTheme, theme } from 'mode-watcher';
  import * as RadioGroup from './components/ui/radio-group/index.js';
  import { defaultTheme, resolveTheme, themes } from './themes/index.js';

  const selected = $derived(resolveTheme(theme.current));
</script>

<section aria-labelledby="theme-heading" class="space-y-5">
  <div>
    <h2 id="theme-heading" class="text-lg font-semibold tracking-tight">Theme</h2>
    <p id="theme-description" class="mt-1 text-sm text-muted-foreground">
      Choose a look. Your selection is saved automatically in this browser.
    </p>
  </div>

  <RadioGroup.Root
    value={selected.id}
    onValueChange={setTheme}
    name="theme"
    aria-labelledby="theme-heading"
    aria-describedby="theme-description"
    class="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3"
  >
    {#each themes as candidate (candidate.id)}
      <label
        for={`theme-${candidate.id}`}
        class="group/field-label cursor-pointer rounded-2xl border border-border bg-card p-3 transition-[border-color,box-shadow] hover:border-ring/50 has-data-[checked]:border-ring has-data-[checked]:ring-1 has-data-[checked]:ring-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
      >
        <div
          data-theme={candidate.id}
          class="relative flex aspect-[2/1] overflow-hidden rounded-xl border border-border bg-background text-foreground"
          aria-hidden="true"
        >
          <div class="flex w-1/5 flex-col gap-2 border-r border-border bg-sidebar p-3">
            <span class="size-5 rounded-md bg-sidebar-primary"></span>
            <span class="h-1.5 w-full rounded-full bg-sidebar-accent"></span>
            <span class="h-1.5 w-3/4 rounded-full bg-sidebar-accent"></span>
          </div>
          <div class="flex flex-1 flex-col justify-center gap-3 px-4 font-sans">
            <div class="flex items-center justify-between gap-2">
              <span class="text-2xl font-semibold tracking-tight">Aa</span>
              <span class="h-5 w-12 rounded-lg bg-primary"></span>
            </div>
            <div class="space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm">
              <span class="block h-1.5 w-3/4 rounded-full bg-foreground/60"></span>
              <span class="block h-1.5 w-1/2 rounded-full bg-muted-foreground/40"></span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 px-1 pb-1 pt-4">
          <span class="flex-1 text-sm font-semibold">{candidate.name}</span>
          {#if candidate.id === defaultTheme.id}
            <span class="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">Default</span>
          {/if}
          <RadioGroup.Item
            id={`theme-${candidate.id}`}
            value={candidate.id}
            aria-label={candidate.name}
          />
        </div>
      </label>
    {/each}
  </RadioGroup.Root>

  <p role="status" class="text-sm text-muted-foreground">Current theme: {selected.name}</p>
</section>
