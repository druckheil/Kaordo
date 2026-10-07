<script lang="ts">
  // Presents local audio and camera settings with isolated device checks

  import { onMount } from 'svelte';
  import {
    Button, CheckIcon, ChevronLeftIcon, HeadphonesIcon, LoaderCircleIcon, MicIcon,
    PlayIcon, Progress, Slider, VideoIcon, XIcon
  } from '@kaordo/ui';
  import {
    chooseSpeaker, listVoiceDevices, MicrophoneCheck, supportsAudioOutputSelection, voiceDeviceError
  } from '@kaordo/voice-client/devices';
  import {
    devicePreferenceKeys, loadVoicePreferences, sameVoicePreferences, saveVoicePreferences,
    type VoicePreferences, type VoiceVolumeKey
  } from '@kaordo/voice-client/preferences';
  import { VoiceSounds } from '@kaordo/voice-client/sounds';
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
  const microphone = new MicrophoneCheck();
  let devices = $state<MediaDeviceInfo[]>([]);
  let outputSupported = $state(false);
  let mediaSupported = $state(true);
  let busyKind = $state<MediaDeviceKind | null>(null);
  let errors = $state<Partial<Record<MediaDeviceKind | 'defaults' | 'devices', string>>>({});
  let saved = $state<VoicePreferences>(loadVoicePreferences());
  let microphoneTesting = $state(false);
  let microphoneStarting = $state(false);
  let microphoneLevel = $state(0);
  let speakerTesting = $state(false);
  let speakerSounds: VoiceSounds | null = null;
  let deviceRevision = 0;
  let active = false;
  const defaultsChanged = $derived(!sameVoicePreferences(preferences, saved));

  onMount(() => {
    active = true;
    mediaSupported = !!navigator.mediaDevices;
    outputSupported = supportsAudioOutputSelection();
    if (mediaSupported) {
      void refreshDevices();
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }
    return () => {
      active = false;
      deviceRevision++;
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
      stopMicrophone();
      stopSpeakers();
    };
  });

  function handleDeviceChange(): void {
    void refreshDevices();
  }

  async function refreshDevices(): Promise<void> {
    const revision = ++deviceRevision;
    try {
      const listed = await listVoiceDevices();
      if (active && revision === deviceRevision) { devices = listed; errors.devices = ''; }
    } catch (cause) {
      if (active && revision === deviceRevision) errors.devices = voiceDeviceError(cause);
    }
  }

  async function runDeviceAction(kind: MediaDeviceKind, action: () => Promise<void>): Promise<void> {
    if (!active || busyKind) return;
    busyKind = kind;
    errors[kind] = '';
    if (kind === 'audioinput') stopMicrophone();
    if (kind === 'audiooutput') stopSpeakers();
    try {
      await action();
      if (active) await refreshDevices();
    } catch (cause) {
      if (active) errors[kind] = voiceDeviceError(cause);
    } finally { if (active) busyKind = null; }
  }

  function changeDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> | undefined {
    if (preferences[devicePreferenceKeys[kind]] === deviceId) return;
    return runDeviceAction(kind, () => onDeviceChange(kind, deviceId));
  }

  function allowDevices(kind: MediaDeviceKind): Promise<void> {
    return runDeviceAction(kind, async () => {
      if (kind !== 'audiooutput') {
        await listVoiceDevices(kind, true);
        return;
      }
      const selected = await chooseSpeaker();
      if (active && selected) await onDeviceChange(kind, selected.deviceId);
    });
  }

  function changeVolume(key: VoiceVolumeKey, value: number): void {
    onVolumeChange(key, value);
    if (key === 'microphoneVolume') microphone.setVolume(value);
    else speakerSounds?.setVolume(value);
  }

  function stopMicrophone(): void {
    microphone.stop();
    microphoneTesting = false;
    microphoneStarting = false;
    microphoneLevel = 0;
  }

  async function toggleMicrophoneCheck(): Promise<void> {
    if (microphoneTesting) { stopMicrophone(); return; }
    microphoneTesting = true;
    microphoneStarting = true;
    errors.audioinput = '';
    try {
      const started = await microphone.start(preferences.microphoneId, preferences.microphoneVolume, (level) => {
        if (active) microphoneLevel = level;
      });
      if (active && started) { microphoneStarting = false; await refreshDevices(); }
    } catch (cause) {
      if (active) { stopMicrophone(); errors.audioinput = voiceDeviceError(cause); }
    }
  }

  function stopSpeakers(): void {
    speakerSounds?.dispose();
    speakerSounds = null;
    speakerTesting = false;
  }

  async function toggleSpeakerCheck(): Promise<void> {
    if (speakerTesting) { stopSpeakers(); return; }
    speakerTesting = true;
    errors.audiooutput = '';
    const sounds = new VoiceSounds();
    speakerSounds = sounds;
    sounds.setVolume(preferences.speakerVolume);
    sounds.unlock();
    try {
      await sounds.setOutput(outputSupported ? preferences.speakerId : 'default');
      if (!active || speakerSounds !== sounds) return;
      await sounds.testOutput();
      if (active && speakerSounds === sounds) stopSpeakers();
    } catch (cause) {
      if (active && speakerSounds === sounds) { stopSpeakers(); errors.audiooutput = voiceDeviceError(cause); }
    }
  }

  function saveDefaults(): void {
    errors.defaults = '';
    try {
      saveVoicePreferences(preferences);
      saved = { ...preferences };
    } catch {
      errors.defaults = 'Could not save defaults in this browser. Your current settings still apply.';
    }
  }
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

    {#if !mediaSupported}
      <p class="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">Device access is unavailable. Open Rondo over HTTPS in a browser that supports voice calls.</p>
    {/if}
    {#if errors.devices}<p class="mt-5 text-sm text-destructive" role="alert">{errors.devices}</p>{/if}

    <div class="mt-6 space-y-4">
      {#each deviceSections as section (section.kind)}
        {@const kind = section.kind}
        {@const output = kind === 'audiooutput'}
        {@const selectedId = preferences[devicePreferenceKeys[kind]]}
        {@const available = devices.filter((device) => device.kind === kind)}
        {@const needsAccess = !available.length || available.some((device) => !device.label)}
        <section aria-label={section.label} class="rounded-2xl border border-border/75 bg-card p-5 shadow-xs sm:p-6">
          <div class="mb-5 flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"><section.icon class="size-5" /></span>
            <div><h2 class="font-semibold">{section.label}</h2><p class="mt-0.5 text-xs leading-5 text-muted-foreground">{section.description}</p></div>
          </div>
          <VoiceDevicePicker label={section.label} {kind} {devices} value={output && !outputSupported ? 'default' : selectedId}
            disabled={!mediaSupported || !!busyKind || (output && !outputSupported)}
            onChange={(value) => void changeDevice(kind, value)} />
          {#if output && !outputSupported}
            <p class="mt-3 text-xs leading-5 text-muted-foreground">This browser uses your system output. Change the device in your system settings.</p>
          {:else if needsAccess || output}
            <Button variant="ghost" size="sm" class="mt-2 -ml-2 text-link" disabled={!mediaSupported || !!busyKind}
              onclick={() => void allowDevices(kind)}>
              {#if busyKind === kind}<LoaderCircleIcon class="size-4 animate-spin" />{/if}
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
                thumbLabel={`${section.label} volume`} onValueChange={(value) => changeVolume(volumeKey, value)} />
              <div class="mt-4 flex flex-wrap items-center gap-3">
                {#if output}
                  <Button variant={speakerTesting ? 'secondary' : 'outline'} size="sm" disabled={!mediaSupported || busyKind === kind}
                    onclick={() => void toggleSpeakerCheck()}>
                    {#if speakerTesting}<XIcon class="size-4" /> Stop test{:else}<PlayIcon class="size-4" /> Test speakers{/if}
                  </Button>
                  <span class="text-xs text-muted-foreground" role="status">{speakerTesting ? 'Playing three tones…' : 'Listen for a short test sound.'}</span>
                {:else}
                  <Button variant={microphoneTesting ? 'secondary' : 'outline'} size="sm" disabled={!mediaSupported || busyKind === kind}
                    onclick={() => void toggleMicrophoneCheck()}>
                    {#if microphoneStarting}<LoaderCircleIcon class="size-4 animate-spin" />
                    {:else if microphoneTesting}<XIcon class="size-4" />{:else}<MicIcon class="size-4" />{/if}
                    {microphoneTesting ? 'Stop test' : 'Test microphone'}
                  </Button>
                  <span class="text-xs text-muted-foreground" role="status">{microphoneStarting ? 'Opening microphone…' : 'Speak to see your input level.'}</span>
                {/if}
              </div>
              {#if !output}
                <Progress class="mt-4 h-2 [&_[data-slot=progress-indicator]]:transition-transform [&_[data-slot=progress-indicator]]:duration-75"
                  value={microphoneLevel} aria-label="Microphone input level" />
              {/if}
            </div>
          {/if}
          {#if errors[kind]}<p class="mt-4 text-sm text-destructive" role="alert">{errors[kind]}</p>{/if}
        </section>
      {/each}
    </div>

    <div class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/75 bg-card p-5 sm:p-6">
      <div><h2 class="text-sm font-semibold">Your defaults</h2><p class="mt-1 text-xs leading-5 text-muted-foreground">Remember these devices and volumes for future calls in this browser.</p></div>
      <Button disabled={!defaultsChanged || !!busyKind} onclick={saveDefaults}>
        {#if !defaultsChanged}<CheckIcon class="size-4" /> Using defaults{:else}Save as defaults{/if}
      </Button>
      {#if errors.defaults}<p class="w-full text-sm text-destructive" role="alert">{errors.defaults}</p>{/if}
    </div>
  </div>
</main>
