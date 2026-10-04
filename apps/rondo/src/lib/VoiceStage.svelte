<script lang="ts">
  // Presents voice controls and a responsive stage for connected video streams

  import { onMount } from 'svelte';
  import type { ScreenQuality, VoiceConnection, VoiceSnapshot } from '@kaordo/voice-client';
  import {
    Button, Dialog, HeadphoneOffIcon, HeadphonesIcon, Maximize2Icon, MicIcon, MicOffIcon,
    Minimize2Icon, MonitorOffIcon, MonitorUpIcon, VideoIcon, VideoOffIcon, Volume2Icon, VolumeXIcon
  } from '@kaordo/ui';
  import VoiceTile from './VoiceTile.svelte';

  let { connection, voice, channelName, soundsEnabled, onSoundsChanged, onDisconnect, onError }: {
    connection: VoiceConnection;
    voice: VoiceSnapshot;
    channelName: string;
    soundsEnabled: boolean;
    onSoundsChanged: (enabled: boolean) => void;
    onDisconnect: () => void;
    onError: (message: string) => void;
  } = $props();

  const qualities: { value: ScreenQuality; label: string; detail: string }[] = [
    { value: '360p15', label: '360p · 15 fps', detail: 'Low bandwidth' },
    { value: '720p5', label: '720p · 5 fps', detail: 'Static text · low bandwidth' },
    { value: '720p15', label: '720p · 15 fps', detail: 'Lower bandwidth' },
    { value: '720p30', label: '720p · 30 fps', detail: 'Smooth motion' },
    { value: '1080p15', label: '1080p · 15 fps', detail: 'Sharp text · recommended' },
    { value: '1080p30', label: '1080p · 30 fps', detail: 'High quality motion' },
    { value: 'original', label: 'Original resolution', detail: 'Source frame rate · highest bandwidth' }
  ];
  let shareDialog = $state(false);
  let quality = $state<ScreenQuality>('1080p15');
  let includeAudio = $state(false);
  let mediaBusy = $state(false);
  let stage: HTMLDivElement;
  let stageFullscreen = $state(false);
  let fullscreenVideoId = $state<string | null>(null);
  let fullscreenError = $state('');
  let fullscreenRevision = 0;
  const previewVideos = $derived.by(() => selectPreviewVideos(voice.videos, fullscreenVideoId));

  onMount(() => {
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  });

  function selectPreviewVideos(videos: VoiceSnapshot['videos'], fullscreenId: string | null) {
    const sorted = [...videos].sort((a, b) => Number(b.source === 'screen') - Number(a.source === 'screen'));
    const preview = sorted.slice(0, 4);
    if (!fullscreenId || preview.some((video) => video.id === fullscreenId)) return preview;

    const fullscreenVideo = sorted.find((video) => video.id === fullscreenId);
    return fullscreenVideo ? [...sorted.slice(0, 3), fullscreenVideo] : preview;
  }

  function syncFullscreenState(): void {
    const activeElement = document.fullscreenElement;
    fullscreenRevision++;
    stageFullscreen = activeElement === stage;
    fullscreenVideoId = activeElement?.getAttribute('data-voice-video-id') ?? null;
    if (stageFullscreen) fullscreenError = '';
  }

  function explain(error: unknown) {
    onError(error instanceof Error ? error.message : 'Could not change the voice setting.');
  }

  async function performMediaAction(action: () => Promise<void>, ignorePermissionDenial = false): Promise<boolean> {
    if (mediaBusy || !voice.connected) return false;

    mediaBusy = true;
    try {
      await action();
      onError('');
      return true;
    } catch (error) {
      if (!ignorePermissionDenial || !isPermissionDenial(error)) explain(error);
      return false;
    } finally {
      mediaBusy = false;
    }
  }

  function change(action: () => Promise<void>): Promise<boolean> {
    return performMediaAction(action);
  }

  function isPermissionDenial(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotAllowedError';
  }

  async function startShare() {
    const started = await performMediaAction(
      () => connection.toggleScreenShare(quality, includeAudio),
      true
    );
    if (started) shareDialog = false;
  }

  async function toggleFullscreen() {
    fullscreenError = '';
    const revision = fullscreenRevision;
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      if (fullscreenRevision === revision && document.fullscreenElement !== stage) fullscreenError = 'Fullscreen unavailable.';
    }
  }
</script>

<div bind:this={stage} class={`voice-stage min-w-0 shrink-0 border-b border-border/70 shadow-xs ${stageFullscreen ? 'flex h-dvh w-dvw flex-col overflow-hidden bg-background p-4' : 'bg-card/90 p-3 sm:px-6'}`}>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <div class="mr-auto min-w-0">
      <p class="truncate text-xs font-bold text-link">Voice · #{channelName}</p>
      <p class="text-xs text-muted-foreground">{voice.connected ? `${voice.participants.length} connected` : voice.reconnecting ? 'Reconnecting…' : 'Connecting…'}</p>
    </div>
    <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Voice controls">
      <Button size="icon-sm" variant={voice.microphoneEnabled ? 'outline' : 'secondary'} disabled={!voice.connected || voice.deafened || mediaBusy}
        aria-label={voice.microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'} title={voice.microphoneEnabled ? 'Mute' : 'Unmute'}
        onclick={() => void change(() => connection.toggleMicrophone())}>
        {#if voice.microphoneEnabled}<MicIcon class="size-4" />{:else}<MicOffIcon class="size-4" />{/if}
      </Button>
      <Button size="icon-sm" variant={voice.deafened ? 'secondary' : 'outline'} disabled={!voice.connected || mediaBusy}
        aria-label={voice.deafened ? 'Undeafen' : 'Deafen'} title={voice.deafened ? 'Undeafen' : 'Deafen'}
        onclick={() => void change(() => connection.toggleDeafen())}>
        {#if voice.deafened}<HeadphoneOffIcon class="size-4" />{:else}<HeadphonesIcon class="size-4" />{/if}
      </Button>
      <Button size="icon-sm" variant={voice.cameraEnabled ? 'secondary' : 'outline'} disabled={!voice.connected || mediaBusy}
        aria-label={voice.cameraEnabled ? 'Turn off camera' : 'Turn on camera'} title={voice.cameraEnabled ? 'Stop camera' : 'Start camera'}
        onclick={() => void change(() => connection.toggleCamera())}>
        {#if voice.cameraEnabled}<VideoIcon class="size-4" />{:else}<VideoOffIcon class="size-4" />{/if}
      </Button>
      <Button size="icon-sm" variant={voice.screenShareEnabled ? 'secondary' : 'outline'} disabled={!voice.connected || mediaBusy}
        aria-label={voice.screenShareEnabled ? 'Stop screen sharing' : 'Start screen sharing'} title={voice.screenShareEnabled ? 'Stop sharing' : 'Share screen'}
        onclick={() => { if (voice.screenShareEnabled) void change(() => connection.toggleScreenShare()); else shareDialog = true; }}>
        {#if voice.screenShareEnabled}<MonitorOffIcon class="size-4" />{:else}<MonitorUpIcon class="size-4" />{/if}
      </Button>
      <span class="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true"></span>
      <Button size="icon-sm" variant="ghost" aria-label={soundsEnabled ? 'Mute interface sounds' : 'Enable interface sounds'}
        title={soundsEnabled ? 'Mute sounds' : 'Enable sounds'} onclick={() => onSoundsChanged(!soundsEnabled)}>
        {#if soundsEnabled}<Volume2Icon class="size-4" />{:else}<VolumeXIcon class="size-4" />{/if}
      </Button>
      {#if voice.videos.length || stageFullscreen}
        <Button size="icon-sm" variant="ghost" aria-label={stageFullscreen ? 'Exit fullscreen voice panel' : 'Fullscreen voice panel'}
          title={stageFullscreen ? 'Exit fullscreen' : 'Fullscreen voice panel'} onclick={() => void toggleFullscreen()}>
          {#if stageFullscreen}<Minimize2Icon class="size-4" />{:else}<Maximize2Icon class="size-4" />{/if}
        </Button>
      {/if}
      <Button size="sm" variant="destructive" aria-label="Disconnect from voice" onclick={onDisconnect}>Leave</Button>
    </div>
  </div>
  {#if fullscreenError}<p class="mt-2 text-xs text-destructive" role="alert">{fullscreenError}</p>{/if}

  {#if voice.connected}
    <div class="kaordo-scrollbar mt-2 flex min-w-0 gap-1.5 overflow-x-auto pb-0.5" aria-label="Voice participants">
      {#each voice.participants as participant (participant.id)}
        <span class={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${participant.speaking ? 'border-primary/40 bg-primary-soft text-primary-soft-foreground' : 'border-border bg-background text-muted-foreground'}`}>
          {#if participant.microphoneEnabled}<MicIcon class="size-3" />{:else}<MicOffIcon class="size-3" />{/if}
          <span>{participant.local ? 'You' : participant.name}</span>
          {#if participant.cameraEnabled}<VideoIcon class="size-3" aria-label="Camera on" />{/if}
          {#if participant.screenShareEnabled}<MonitorUpIcon class="size-3" aria-label="Sharing screen" />{/if}
        </span>
      {/each}
    </div>
  {/if}

  {#if !voice.canPlaybackAudio || !voice.canPlaybackVideo}
    <div class="mt-2 flex flex-wrap gap-2">
      {#if !voice.canPlaybackAudio}<Button size="xs" variant="secondary" onclick={() => void change(() => connection.startAudio())}>Enable audio playback</Button>{/if}
      {#if !voice.canPlaybackVideo}<Button size="xs" variant="secondary" onclick={() => void change(() => connection.startVideo())}>Enable video playback</Button>{/if}
    </div>
  {/if}

  {#if voice.videos.length}
    <div class={stageFullscreen ? 'voice-stage-grid mt-3 min-h-0 min-w-0 flex-1 gap-3 overflow-hidden' : 'mt-2 flex min-w-0 flex-wrap gap-2'}
      aria-label="Live video streams">
      {#each stageFullscreen ? voice.videos : previewVideos as video (video.id)}
        <VoiceTile {connection} {video} large={stageFullscreen} />
      {/each}
      {#if !stageFullscreen && voice.videos.length > previewVideos.length}
        <Button variant="secondary" class="h-auto aspect-video w-[min(9rem,48%)] sm:w-40" onclick={() => void toggleFullscreen()}>
          +{voice.videos.length - previewVideos.length} more
        </Button>
      {/if}
    </div>
  {/if}
</div>

<Dialog.Root bind:open={shareDialog}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header><Dialog.Title>Share your screen</Dialog.Title>
      <Dialog.Description>Choose the quality before selecting a window or display. Your browser may limit the final capture size and frame rate.</Dialog.Description></Dialog.Header>
    <label class="mt-4 block text-sm font-semibold" for="rondo-share-quality">Video quality</label>
    <select id="rondo-share-quality" bind:value={quality}
      class="mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {#each qualities as option (option.value)}<option value={option.value}>{option.label} — {option.detail}</option>{/each}
    </select>
    <label class="mt-4 flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
      <input type="checkbox" bind:checked={includeAudio} class="mt-0.5 size-4 accent-primary" />
      <span><strong class="block font-semibold">Share tab audio</strong><span class="text-muted-foreground">Available only when the browser and selected source support it.</span></span>
    </label>
    <Dialog.Footer class="mt-5"><Button variant="outline" onclick={() => { shareDialog = false; }}>Cancel</Button>
      <Button disabled={mediaBusy || !voice.connected} onclick={() => void startShare()}>{mediaBusy ? 'Starting…' : 'Choose screen'}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .voice-stage:fullscreen { width: 100vw !important; height: 100dvh !important; overflow: hidden; }
  .voice-stage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    grid-auto-rows: minmax(0, 1fr);
  }
</style>
