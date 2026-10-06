<script lang="ts">
  // Presents device selection using the shared native dropdown radio group

  import { Button, ChevronDownIcon, DropdownMenu } from '@kaordo/ui';

  let { label, kind, devices, value, disabled = false, onChange }: {
    label: string;
    kind: MediaDeviceKind;
    devices: MediaDeviceInfo[];
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  } = $props();

  const options = $derived(devices.filter((device) => device.kind === kind &&
    device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
    .map((device, index) => ({ value: device.deviceId, label: device.label || `${label} ${index + 1}` })));
  const selected = $derived(options.find((device) => device.value === value));
  const selectedLabel = $derived(value === 'default' ? 'System default' :
    selected?.label ?? 'Unavailable device');
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" class="h-11 w-full min-w-0 justify-between bg-background text-left"
        {disabled} aria-label={`${label} device: ${selectedLabel}`}>
        <span class="truncate">{selectedLabel}</span><ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-[var(--bits-dropdown-menu-anchor-width)] min-w-60" align="start">
    <DropdownMenu.Group><DropdownMenu.Label>{label}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup {value} onValueChange={onChange}>
        <DropdownMenu.RadioItem value="default" closeOnSelect>System default</DropdownMenu.RadioItem>
        {#each options as device (device.value)}
          <DropdownMenu.RadioItem value={device.value} closeOnSelect>
            <span class="truncate">{device.label}</span>
          </DropdownMenu.RadioItem>
        {/each}
        {#if value !== 'default' && !selected}
          <DropdownMenu.RadioItem {value} disabled>Unavailable device</DropdownMenu.RadioItem>
        {/if}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
