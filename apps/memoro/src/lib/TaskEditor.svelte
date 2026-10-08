<script lang="ts">
  // Edits one task with optional scheduling and compact category choices
  import { Button, Dialog, Input, RadioGroup, DropdownMenu, ChevronDownIcon } from '@kaordo/ui';
  import { categories, documentText, type Task, type TaskStatus } from '@kaordo/memoro-client';
  import type { DraftAttachment } from '@kaordo/editor-ui';
  import type { MediaAttachment } from '@kaordo/media-ui';
  import EntryEditor from './EntryEditor.svelte';
  let { task = $bindable(), files = $bindable([]), media, pending, isNew = false, onSave, onCancel }:
    { task: Task; files?: DraftAttachment[]; media: MediaAttachment[]; pending: boolean; isNew?: boolean; onSave: () => void; onCancel: () => void } = $props();
  const formId = $props.id();
  const statuses: { value: TaskStatus; label: string }[] = [ { value: '', label: 'No status' }, { value: 'planned', label: 'Planned' }, { value: 'in-progress', label: 'In progress' }, { value: 'done', label: 'Done' } ];
  const valid = $derived(!!documentText(task.content) || task.media.length > 0 || files.length > 0);
</script>
<Dialog.Header><Dialog.Title>{isNew ? 'Add task' : 'Edit task'}</Dialog.Title><Dialog.Description>Plan something for this day. Status and time are optional.</Dialog.Description></Dialog.Header>
<div class="space-y-4">
  <EntryEditor bind:entry={task} bind:files {media} label="Task text" placeholder="What would you like to do?" {pending} onChange={() => {}} />
  <fieldset><legend class="mb-2 text-sm font-medium">Category</legend>
    <RadioGroup.Root bind:value={task.category} class="flex flex-wrap gap-2" disabled={pending}>
      {#each categories as category}<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition-colors has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"><RadioGroup.Item value={category.id} /><span class="size-2.5 rounded-full" style={`background:${category.color}`}></span>{category.name}</label>{/each}
    </RadioGroup.Root>
  </fieldset>
  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-2"><label class="text-sm font-medium" for={`${formId}-status`}>Status <span class="text-xs font-normal text-muted-foreground">Optional</span></label>
      <DropdownMenu.Root><DropdownMenu.Trigger id={`${formId}-status`} disabled={pending} class="flex h-10 w-full items-center justify-between rounded-xl border border-input bg-background px-3 text-sm">{statuses.find(status => status.value === task.status)?.label}<ChevronDownIcon class="size-4" /></DropdownMenu.Trigger><DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)"><DropdownMenu.RadioGroup bind:value={task.status}>{#each statuses as status}<DropdownMenu.RadioItem value={status.value}>{status.label}</DropdownMenu.RadioItem>{/each}</DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Root>
    </div>
    <label class="space-y-2 text-sm font-medium" for={`${formId}-time`}>Time <span class="text-xs font-normal text-muted-foreground">Optional</span><Input id={`${formId}-time`} type="time" bind:value={task.time} disabled={pending} /></label>
  </div>
</div>
<Dialog.Footer><Button variant="ghost" disabled={pending} onclick={onCancel}>Cancel</Button><Button disabled={!valid || pending} onclick={onSave}>{pending ? 'Saving…' : isNew ? 'Add task' : 'Save task'}</Button></Dialog.Footer>
