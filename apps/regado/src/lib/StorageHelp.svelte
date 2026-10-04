<script lang="ts">
 // Presents contextual storage explanations through a keyboard and touch accessible Rhea popover
 import type { Snippet } from "svelte";
 import { Button, InfoIcon, Popover } from "@kaordo/ui";
 let { label, children }: { label: string; children: Snippet } = $props();
</script>

<Popover.Root>
 <Popover.Trigger>
  {#snippet child({ props })}
   <Button {...props} variant="ghost" size="icon-xs" aria-label={`About ${label}`}><InfoIcon class="size-4" /></Button>
  {/snippet}
 </Popover.Trigger>
 <Popover.Content class="w-80 max-w-[calc(100vw-2rem)] text-xs leading-5">
  <Popover.Title class="text-sm font-semibold">{label}</Popover.Title>
  <div class="space-y-2 text-muted-foreground">{@render children()}</div>
 </Popover.Content>
</Popover.Root>
