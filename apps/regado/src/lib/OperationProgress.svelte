<script lang="ts">
 // Displays measured phase progress without manufacturing percentages for unknown totals
 import type { AdminOperationProgress } from "@kaordo/contracts";
 import { Progress, LoaderCircleIcon } from "@kaordo/ui";
 import { formatBytes as bytes } from "./regado-model";
 let { label, progress }: { label: string; progress?: AdminOperationProgress | null } = $props();
 const percent = $derived(progress?.total && progress.total > 0 ? Math.min(100, 100 * progress.completed / progress.total) : null);
 function amount(value: number): string { return progress?.unit === "bytes" ? bytes(value) : value.toLocaleString(); }
</script>

<div class="space-y-2 rounded-xl bg-secondary/50 p-3" aria-label={label}>
 <div class="flex items-center justify-between gap-3 text-xs">
  <span class="font-medium">{label}</span>
  <span class="shrink-0 tabular-nums text-primary">{percent === null ? "In progress" : `${percent.toFixed(1)}%`}</span>
 </div>
 {#if percent !== null}
  <Progress value={percent} aria-label={label} />
 {:else}
  <div class="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircleIcon class="size-3 animate-spin motion-reduce:animate-none" /><span>Waiting for measured progress</span></div>
 {/if}
 {#if progress}
  <p class="text-xs tabular-nums text-muted-foreground">{amount(progress.completed)}{progress.total ? ` / ${amount(progress.total)}` : ""}{progress.unit === "bytes" ? "" : ` ${progress.unit}`}</p>
 {/if}
</div>
