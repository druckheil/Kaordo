<script lang="ts">
  // Presents the shared menu for an owner's chosen availability

  import type { FluoStatus } from '@kaordo/contracts';
  import { Button, DropdownMenu, ChevronDownIcon, CircleIcon, CircleMinusIcon, EyeOffIcon } from '@kaordo/ui';

  let { status, busy = false, onChange }: {
    status: FluoStatus;
    busy?: boolean;
    onChange: (status: FluoStatus) => void;
  } = $props();
  const options = [
    { value: 'online', label: 'Online', description: 'Available in Kaordo', icon: CircleIcon },
    { value: 'busy', label: 'Busy', description: 'Let people know you are occupied', icon: CircleMinusIcon },
    { value: 'invisible', label: 'Invisible', description: 'Hide your availability', icon: EyeOffIcon }
  ] as const;
  const selected = $derived(options.find((option) => option.value === status));
  const Icon = $derived(selected?.icon ?? CircleIcon);
</script>

{#snippet indicator()}
  <Icon class={`size-3.5 ${status === 'online' ? 'fill-emerald-500 text-emerald-500' : status === 'busy' ? 'fill-amber-500/20 text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`} aria-hidden="true" />
  <span>{selected?.label}</span>
{/snippet}

  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="sm" disabled={busy} class="h-8 gap-1.5 rounded-full px-2.5 text-xs" aria-label={`Status: ${selected?.label}. Change availability`}>
          {@render indicator()}<ChevronDownIcon class="size-3 text-muted-foreground" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="w-64">
      <DropdownMenu.Label>Your status</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={status} onValueChange={(value) => {
        if (value === 'online' || value === 'busy' || value === 'invisible') onChange(value);
      }}>
        {#each options as option (option.value)}
          <DropdownMenu.RadioItem value={option.value} class="items-start py-2.5">
            <option.icon class={`mt-0.5 size-4 ${option.value === 'online' ? 'text-emerald-600 dark:text-emerald-400' : option.value === 'busy' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`} />
            <span><span class="block font-medium">{option.label}</span><span class="mt-0.5 block text-xs text-muted-foreground">{option.description}</span></span>
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
