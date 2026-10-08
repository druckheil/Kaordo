<script lang="ts">
  // Presents voice and video settings while the device controller owns local checks
  import {
    Button, CheckIcon, ChevronLeftIcon, HeadphonesIcon, LoaderCircleIcon, MicIcon,
    PlayIcon, Progress, Slider, VideoIcon, XIcon
  } from '@kaordo/ui';
  import { devicePreferenceKeys, type VoicePreferences, type VoiceVolumeKey } from '@kaordo/voice-client/preferences';
  import { createDeviceSettingsState } from './device-settings-state.svelte.ts';
  import VoiceDevicePicker from './VoiceDevicePicker.svelte';

  let { preferences, connected, onDeviceChange, onVolumeChange, onBack }: {
    preferences: VoicePreferences;
    connected: boolean;
    onDeviceChange: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
    onVolumeChange: (key: VoiceVolumeKey, value: number) => void;
    onBack: () => void;
  } = $props();

  const deviceSections = [
    { kind: 'audioinput', label: 'Microphone', icon: MicIcon, description: 'Choose how people hear you.' },
    { kind: 'audiooutput', label: 'Speakers', icon: HeadphonesIcon, description: 'Choose where you hear the room.' },
    { kind: 'videoinput', label: 'Camera', icon: VideoIcon, description: 'Choose the camera used when you turn on video.' }
  ] as const;
  const state = createDeviceSettingsState({
    preferences: () => preferences,
    onDeviceChange: (kind, deviceId) => onDeviceChange(kind, deviceId),
    onVolumeChange: (key, value) => onVolumeChange(key, value)
  });
</script>

<main id="main-content" tabindex="-1" class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto">
  <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-9">
    <Button variant="ghost" size="sm" class="mb-5 -ml-2" onclick={onBack}>
      <ChevronLeftIcon class="size-4" /> Back to room
    </Button>
    <p class="text-xs font-bold uppercase tracking-[0.18em] text-link">Rondo / Settings</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Voice &amp; video</h1>
    <p class="mt-2 text-sm leading-6 text-muted-foreground">Get your devices ready for the next conversation.</p>
    {#if connected}
      <p class="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><span class="size-2 rounded-full bg-emerald-500"></span>Your call stays connected. Changes apply immediately.</p>
    {/if}

    {#if !state.mediaSupported}
      <p class="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">Device access is unavailable. Open Rondo over HTTPS in a browser that supports voice calls.</p>
    {/if}
    {#if state.errors.devices}<p class="mt-5 text-sm text-destructive" role="alert">{state.errors.devices}</p>{/if}

    <div class="mt-6 space-y-4">
      {#each deviceSections as section (section.kind)}
        {@const kind = section.kind}
        {@const output = kind === 'audiooutput'}
        {@const selectedId = preferences[devicePreferenceKeys[kind]]}
        {@const available = state.devices.filter((device) => device.kind === kind)}
        {@const needsAccess = !available.length || available.some((device) => !device.label)}
        <section aria-label={section.label} class="rounded-2xl border border-border/75 bg-card p-5 shadow-xs sm:p-6">
          <div class="mb-5 flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"><section.icon class="size-5" /></span>
            <div><h2 class="font-semibold">{section.label}</h2><p class="mt-0.5 text-xs leading-5 text-muted-foreground">{section.description}</p></div>
          </div>
          <VoiceDevicePicker label={section.label} {kind} devices={state.devices} value={output && !state.outputSupported ? 'default' : selectedId}
            disabled={!state.mediaSupported || !!state.busyKind || (output && !state.outputSupported)}
            onChange={(value) => void state.changeDevice(kind, value)} />
          {#if output && !state.outputSupported}
            <p class="mt-3 text-xs leading-5 text-muted-foreground">This browser uses your system output. Change the device in your system settings.</p>
          {:else if needsAccess || output}
            <Button variant="ghost" size="sm" class="mt-2 -ml-2 text-link" disabled={!state.mediaSupported || !!state.busyKind}
              onclick={() => void state.allowDevices(kind)}>
              {#if state.busyKind === kind}<LoaderCircleIcon class="size-4 animate-spin" />{/if}
              {output ? 'Choose output device' : `Allow ${section.label.toLowerCase()} access`}
            </Button>
          {/if}

          {#if kind !== 'videoinput'}
            {@const volumeKey = output ? 'speakerVolume' : 'microphoneVolume'}
            <div class="mt-5 border-t border-border/60 pt-5">
              <div class="mb-3 flex items-center justify-between text-sm">
                <span>{output ? 'Output volume' : 'Input volume'}</span>
                <span class="tabular-nums text-muted-foreground">{preferences[volumeKey]}%</span>
              </div>
              <Slider type="single" value={preferences[volumeKey]} min={0} max={100} step={1} class="h-6"
                thumbLabel={`${section.label} volume`} onValueChange={(value) => state.changeVolume(volumeKey, value)} />
              <div class="mt-4 flex flex-wrap items-center gap-3">
                {#if output}
                  <Button variant={state.speakerTesting ? 'secondary' : 'outline'} size="sm" disabled={!state.mediaSupported || state.busyKind === kind}
                    onclick={() => void state.toggleSpeakerCheck()}>
                    {#if state.speakerTesting}<XIcon class="size-4" /> Stop test{:else}<PlayIcon class="size-4" /> Test speakers{/if}
                  </Button>
                  <span class="text-xs text-muted-foreground" role="status">{state.speakerTesting ? 'Playing three tones…' : 'Listen for a short test sound.'}</span>
                {:else}
                  <Button variant={state.microphoneTesting ? 'secondary' : 'outline'} size="sm" disabled={!state.mediaSupported || state.busyKind === kind}
                    onclick={() => void state.toggleMicrophoneCheck()}>
                    {#if state.microphoneStarting}<LoaderCircleIcon class="size-4 animate-spin" />
                    {:else if state.microphoneTesting}<XIcon class="size-4" />{:else}<MicIcon class="size-4" />{/if}
                    {state.microphoneTesting ? 'Stop test' : 'Test microphone'}
                  </Button>
                  <span class="text-xs text-muted-foreground" role="status">{state.microphoneStarting ? 'Opening microphone…' : 'Speak to see your input level.'}</span>
                {/if}
              </div>
              {#if !output}
                <Progress class="mt-4 h-2 [&_[data-slot=progress-indicator]]:transition-transform [&_[data-slot=progress-indicator]]:duration-75"
                  value={state.microphoneLevel} aria-label="Microphone input level" />
              {/if}
            </div>
          {/if}
          {#if state.errors[kind]}<p class="mt-4 text-sm text-destructive" role="alert">{state.errors[kind]}</p>{/if}
        </section>
      {/each}
    </div>

    <div class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/75 bg-card p-5 sm:p-6">
      <div><h2 class="text-sm font-semibold">Your defaults</h2><p class="mt-1 text-xs leading-5 text-muted-foreground">Remember these devices and volumes for future calls in this browser.</p></div>
      <Button disabled={!state.defaultsChanged || !!state.busyKind} onclick={state.saveDefaults}>
        {#if !state.defaultsChanged}<CheckIcon class="size-4" /> Using defaults{:else}Save as defaults{/if}
      </Button>
      {#if state.errors.defaults}<p class="w-full text-sm text-destructive" role="alert">{state.errors.defaults}</p>{/if}
    </div>
  </div>
</main>
