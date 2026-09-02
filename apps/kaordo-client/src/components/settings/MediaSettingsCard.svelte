<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { openMicrophone, type OpenedMicrophone } from '../../lib/services/mediaDevices';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';

  type Props = {
    onMicrophone: (deviceId: string) => void;
    onMicrophoneVolume: (volume: number) => void;
    onReset: () => void;
    onSpeaker: (deviceId: string) => void;
    onSpeakerVolume: (volume: number) => void;
    snapshot: Readonly<MediaSettingsSnapshot>;
  };
  type SinkAudio = HTMLAudioElement & {
    setSinkId?: (deviceId: string) => Promise<void>;
    sinkId?: string;
  };
  type OutputMediaDevices = MediaDevices & {
    selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
  };

  let {
    onMicrophone, onMicrophoneVolume, onReset, onSpeaker, onSpeakerVolume, snapshot,
  }: Props = $props();
  let devices = $state<MediaDeviceInfo[]>([]);
  let deviceError = $state<string | null>(null);
  let accessPhase = $state<'checking' | 'denied' | 'ready'>('checking');
  let selecting = $state<'microphone' | 'speaker' | null>(null);
  let activeMicrophone = $state<string | null>(null);
  let microphoneStream = $state<MediaStream | null>(null);
  let cameraStream = $state<MediaStream | null>(null);
  let accessRequestId = 0;
  let microphoneLevel = $state(0);
  let microphoneContext: AudioContext | null = null;
  let microphoneGain: GainNode | null = null;
  let microphoneMonitor = $state<SinkAudio>();
  let microphoneFrame = 0;
  let microphoneRevision = 0;
  let microphonePendingRevision: number | null = null;
  let cameraRevision = 0;
  let cameraPendingRevision: number | null = null;
  let deviceRequestId = 0;
  let lifecycleId = 0;
  const microphones = $derived(devices.filter(({ kind }) => kind === 'audioinput'));
  const speakers = $derived(devices.filter(({ kind }) => kind === 'audiooutput'));

  $effect(() => {
    const gain = snapshot.microphoneVolume / 100;
    const speakerId = snapshot.speakerId;
    const speakerVolume = snapshot.speakerVolume / 100;
    if (microphoneGain && microphoneContext) {
      microphoneGain.gain.setTargetAtTime(gain, microphoneContext.currentTime, 0.015);
    }
    if (microphoneMonitor) {
      microphoneMonitor.volume = Math.min(1, Math.max(0, speakerVolume));
      if (microphoneMonitor.setSinkId) {
        void microphoneMonitor.setSinkId(speakerId).catch(() => undefined);
      }
    }
  });

  onMount(() => {
    void requestDeviceAccess();
    navigator.mediaDevices?.addEventListener?.('devicechange', deviceChanged);
  });

  onDestroy(() => {
    lifecycleId += 1;
    accessRequestId += 1;
    deviceRequestId += 1;
    navigator.mediaDevices?.removeEventListener?.('devicechange', deviceChanged);
    stopMicrophoneTest();
    stopCameraTest();
  });

  function deviceChanged(): void {
    void refreshDevices();
  }

  async function requestDeviceAccess(): Promise<void> {
    const lifecycle = lifecycleId;
    const requestId = ++accessRequestId;
    accessPhase = 'checking';
    deviceError = null;
    try {
      let selectionError: unknown = null;
      let opened: OpenedMicrophone;
      try {
        opened = await openMicrophone(snapshot.microphoneId);
      } catch (error) {
        if (!snapshot.microphoneId) throw error;
        selectionError = error;
        opened = await openMicrophone('');
        onMicrophone('');
      }
      opened.stream.getTracks().forEach((track) => track.stop());
      if (lifecycle !== lifecycleId || requestId !== accessRequestId) return;
      await refreshDevices();
      if (lifecycle !== lifecycleId || requestId !== accessRequestId) return;
      accessPhase = 'ready';
      if (snapshot.microphoneId && !microphones.some(({ deviceId }) => deviceId === snapshot.microphoneId)) {
        onMicrophone('');
      }
      if (snapshot.speakerId && !speakers.some(({ deviceId }) => deviceId === snapshot.speakerId)) {
        onSpeaker('');
      }
      if (selectionError) deviceError = readableMediaError(selectionError);
    } catch (error) {
      if (lifecycle !== lifecycleId || requestId !== accessRequestId) return;
      accessPhase = 'denied';
      deviceError = readableMediaError(error);
      await refreshDevices(false);
    }
  }

  async function refreshDevices(clearError = true): Promise<void> {
    const lifecycle = lifecycleId;
    const requestId = ++deviceRequestId;
    if (!navigator.mediaDevices?.enumerateDevices) {
      deviceError = 'Media device selection is not supported on this device.';
      return;
    }
    try {
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      if (lifecycle !== lifecycleId || requestId !== deviceRequestId) return;
      devices = nextDevices;
      if (clearError) deviceError = null;
    } catch (error) {
      if (lifecycle !== lifecycleId || requestId !== deviceRequestId) return;
      deviceError = readableMediaError(error);
    }
  }

  async function toggleMicrophoneTest(): Promise<void> {
    if (microphoneStream) {
      stopMicrophoneTest();
      return;
    }
    const revision = ++microphoneRevision;
    if (microphonePendingRevision !== null) return;
    const lifecycle = lifecycleId;
    microphonePendingRevision = revision;
    let openedStream: MediaStream | null = null;
    let openedContext: AudioContext | null = null;
    try {
      const opened = await openMicrophone(snapshot.microphoneId);
      const stream = opened.stream;
      openedStream = stream;
      if (lifecycle !== lifecycleId || revision !== microphoneRevision) return;
      const context = new AudioContext();
      openedContext = context;
      await context.resume().catch(() => undefined);
      if (lifecycle !== lifecycleId || revision !== microphoneRevision) return;
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      const delay = context.createDelay(0.15);
      const monitor = context.createMediaStreamDestination();
      gain.gain.value = snapshot.microphoneVolume / 100;
      delay.delayTime.value = 0.055;
      analyser.fftSize = 256;
      source.connect(gain);
      gain.connect(analyser);
      gain.connect(delay).connect(monitor);
      microphoneStream = stream;
      activeMicrophone = opened.label;
      microphoneContext = context;
      microphoneGain = gain;
      openedStream = null;
      openedContext = null;
      if (microphoneMonitor) {
        microphoneMonitor.srcObject = monitor.stream;
        microphoneMonitor.volume = snapshot.speakerVolume / 100;
        if (microphoneMonitor.setSinkId) {
          await microphoneMonitor.setSinkId(snapshot.speakerId);
          if (microphoneMonitor.sinkId !== undefined && microphoneMonitor.sinkId !== snapshot.speakerId) {
            throw new Error('The system did not switch to the selected speakers.');
          }
        }
        await microphoneMonitor.play().catch(() => undefined);
      }
      if (lifecycle !== lifecycleId || revision !== microphoneRevision) return;
      const values = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      const sample = () => {
        if (!microphoneStream) return;
        analyser.getByteTimeDomainData(values);
        let energy = 0;
        for (const value of values) energy += ((value - 128) / 128) ** 2;
        microphoneLevel = Math.min(100, Math.round(Math.sqrt(energy / values.length) * 310));
        microphoneFrame = requestAnimationFrame(sample);
      };
      sample();
      await refreshDevices();
    } catch (error) {
      if (lifecycle === lifecycleId && revision === microphoneRevision) {
        stopMicrophoneTest();
        deviceError = readableMediaError(error);
      }
    } finally {
      openedStream?.getTracks().forEach((track) => track.stop());
      void openedContext?.close().catch(() => undefined);
      if (microphonePendingRevision === revision) microphonePendingRevision = null;
    }
  }

  function stopMicrophoneTest(): void {
    microphoneRevision += 1;
    microphonePendingRevision = null;
    if (microphoneFrame) cancelAnimationFrame(microphoneFrame);
    microphoneFrame = 0;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    activeMicrophone = null;
    microphoneLevel = 0;
    microphoneGain = null;
    if (microphoneMonitor) {
      if (microphoneMonitor.srcObject) microphoneMonitor.pause();
      microphoneMonitor.srcObject = null;
    }
    void microphoneContext?.close().catch(() => undefined);
    microphoneContext = null;
  }

  async function selectMicrophone(deviceId: string): Promise<void> {
    if (selecting) return;
    const lifecycle = lifecycleId;
    selecting = 'microphone';
    const wasTesting = microphoneStream !== null;
    stopMicrophoneTest();
    try {
      const opened = await openMicrophone(deviceId);
      opened.stream.getTracks().forEach((track) => track.stop());
      if (lifecycle !== lifecycleId) return;
      onMicrophone(deviceId);
      deviceError = null;
      await refreshDevices();
      if (wasTesting) {
        await tick();
        await toggleMicrophoneTest();
      }
    } catch (error) {
      if (lifecycle === lifecycleId) deviceError = readableMediaError(error);
    } finally {
      if (lifecycle === lifecycleId) selecting = null;
    }
  }

  async function selectSpeaker(deviceId: string): Promise<void> {
    if (selecting) return;
    if (!microphoneMonitor?.setSinkId) {
      deviceError = 'Individual speaker selection is not supported by this system. Use the system output setting.';
      return;
    }
    const lifecycle = lifecycleId;
    selecting = 'speaker';
    try {
      let permittedId = deviceId;
      try {
        await microphoneMonitor.setSinkId(deviceId);
      } catch (error) {
        const outputDevices = navigator.mediaDevices as OutputMediaDevices;
        if (!deviceId || !outputDevices.selectAudioOutput) throw error;
        const permitted = await outputDevices.selectAudioOutput({ deviceId });
        permittedId = permitted.deviceId;
        await microphoneMonitor.setSinkId(permittedId);
      }
      if (microphoneMonitor.sinkId !== undefined && microphoneMonitor.sinkId !== permittedId) {
        throw new Error('The system did not switch to the selected speakers.');
      }
      if (lifecycle !== lifecycleId) return;
      onSpeaker(permittedId);
      deviceError = null;
      await refreshDevices();
    } catch (error) {
      if (lifecycle === lifecycleId) deviceError = readableMediaError(error);
    } finally {
      if (lifecycle === lifecycleId) selecting = null;
    }
  }

  async function toggleCameraTest(): Promise<void> {
    if (cameraStream) {
      stopCameraTest();
      return;
    }
    const revision = ++cameraRevision;
    if (cameraPendingRevision !== null) return;
    const lifecycle = lifecycleId;
    cameraPendingRevision = revision;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { frameRate: { ideal: 30 }, height: { ideal: 720 }, width: { ideal: 1280 } },
      });
      if (lifecycle !== lifecycleId || revision !== cameraRevision) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream = stream;
      await refreshDevices();
    } catch (error) {
      if (lifecycle === lifecycleId && revision === cameraRevision) {
        stopCameraTest();
        deviceError = readableMediaError(error);
      }
    } finally {
      if (cameraPendingRevision === revision) cameraPendingRevision = null;
    }
  }

  function stopCameraTest(): void {
    cameraRevision += 1;
    cameraPendingRevision = null;
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  function attachCamera(node: HTMLVideoElement, stream: MediaStream) {
    node.srcObject = stream;
    void node.play().catch(() => undefined);
    return { destroy: () => { node.srcObject = null; } };
  }

  function label(device: MediaDeviceInfo): string {
    return device.label || 'Device name unavailable';
  }

  function readableMediaError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return 'Permission was denied. Allow microphone and camera access in system settings.';
    }
    return error instanceof Error && error.message ? error.message : 'The media device could not be opened.';
  }

  function rangeProgress(value: number, min: number, max: number): number {
    return Math.min(100, Math.max(0, (value - min) / Math.max(1, max - min) * 100));
  }
</script>

<section class="media-settings-card" aria-labelledby="media-title">
  <audio bind:this={microphoneMonitor} class="microphone-monitor" aria-hidden="true"></audio>
  <header class="media-heading">
    <span class="setting-icon" aria-hidden="true">
      <svg viewBox="0 0 20 20"><path d="M7 7.5v2a3 3 0 0 0 6 0v-2a3 3 0 0 0-6 0Z"/><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17m-3 0h6"/><path d="M15.5 5.5h2v7h-2"/></svg>
    </span>
    <div><h2 id="media-title">Audio &amp; Video</h2><p>Choose call devices, tune levels, and verify them before joining voice.</p></div>
    <button class="reset-media" type="button" onclick={onReset}>Reset</button>
  </header>

  <div class="device-grid">
    <label class="device-field">
      <span>Microphone</span>
      <select
        disabled={accessPhase !== 'ready' || selecting !== null}
        bind:value={() => snapshot.microphoneId, (deviceId) => void selectMicrophone(deviceId)}
      >
        <option value="">{accessPhase === 'ready' ? 'System default' : 'Waiting for device access…'}</option>
        {#if accessPhase === 'ready'}
          {#each microphones as device (device.deviceId)}
            <option value={device.deviceId}>{label(device)}</option>
          {/each}
        {/if}
      </select>
    </label>

    <label class="device-field">
      <span>Speakers</span>
      <select
        disabled={accessPhase !== 'ready' || selecting !== null}
        bind:value={() => snapshot.speakerId, (deviceId) => void selectSpeaker(deviceId)}
      >
        <option value="">{accessPhase === 'ready' ? 'System default' : 'Waiting for device access…'}</option>
        {#if accessPhase === 'ready'}
          {#each speakers as device (device.deviceId)}
            <option value={device.deviceId}>{label(device)}</option>
          {/each}
        {/if}
      </select>
    </label>

    <div class="level-field">
      <div><label for="microphone-volume">Microphone volume</label><output for="microphone-volume">{snapshot.microphoneVolume}%</output></div>
      <input id="microphone-volume" class="sui-range" style={`--range-progress:${rangeProgress(snapshot.microphoneVolume, 0, 200)}%`} min="0" max="200" step="5" type="range" value={snapshot.microphoneVolume} oninput={(event) => onMicrophoneVolume(Number(event.currentTarget.value))}/>
      <small>100% is the natural input level</small>
    </div>

    <div class="level-field">
      <div><label for="speaker-volume">Speaker volume</label><output for="speaker-volume">{snapshot.speakerVolume}%</output></div>
      <input id="speaker-volume" class="sui-range" style={`--range-progress:${rangeProgress(snapshot.speakerVolume, 0, 100)}%`} min="0" max="100" step="5" type="range" value={snapshot.speakerVolume} oninput={(event) => onSpeakerVolume(Number(event.currentTarget.value))}/>
      <small>Applied to everyone you hear in voice</small>
    </div>
  </div>

  {#if accessPhase !== 'ready'}
    <div class="access-row" class:error={accessPhase === 'denied'}>
      <span>{accessPhase === 'checking' ? 'Requesting microphone and audio-device access…' : 'Device access is required before choosing call hardware.'}</span>
      {#if accessPhase === 'denied'}<button type="button" onclick={requestDeviceAccess}>Grant device access</button>{/if}
    </div>
  {/if}

  <div class="test-grid">
    <article class:active={microphoneStream !== null} class="test-panel microphone-test">
      <div class="test-copy"><strong>Microphone check</strong><span>{microphoneStream ? `${activeMicrophone ?? 'Selected microphone'} · You hear yourself with a short delay.` : 'Hear and verify your selected input without joining a call.'}</span></div>
      <div class="microphone-meter" aria-label="Microphone level" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={microphoneLevel}>
        <i style={`width: ${microphoneLevel}%`}></i><span>{microphoneStream ? `${microphoneLevel}%` : 'Ready'}</span>
      </div>
      <button class:stop={microphoneStream !== null} disabled={accessPhase !== 'ready' || selecting !== null} type="button" onclick={toggleMicrophoneTest}>{microphoneStream ? 'Stop test' : 'Test microphone'}</button>
    </article>

    <article class:active={cameraStream !== null} class="test-panel camera-test">
      <div class="camera-preview">
        {#if cameraStream}
          <video autoplay muted playsinline use:attachCamera={cameraStream}></video>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="12.5" height="12" rx="3"/><path d="m16 10 4-2v8l-4-2"/></svg>
          <span>Camera preview</span>
        {/if}
      </div>
      <div class="camera-action"><span>{cameraStream ? 'Camera is working' : 'Preview stays only on this device'}</span><button class:stop={cameraStream !== null} type="button" onclick={toggleCameraTest}>{cameraStream ? 'Stop camera' : 'Test camera'}</button></div>
    </article>
  </div>

  {#if deviceError}<p class="media-error" role="alert">{deviceError}</p>{/if}
  {#if snapshot.error}<p class="media-error" role="alert">{snapshot.error}</p>{/if}
</section>

<style>
  .media-settings-card { margin-top: 13px; padding: 20px; color: #2b3731; background: rgb(255 255 255 / 84%); border: 1px solid #dce1dc; border-radius: 15px; box-shadow: 0 12px 30px rgb(38 66 54 / 6%); }
  .microphone-monitor { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .media-heading { display: grid; grid-template-columns: 35px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding-bottom: 16px; border-bottom: 1px solid #e6eae7; }
  .setting-icon { display: grid; width: 35px; height: 35px; color: #4d8271; background: #e8f0eb; border: 1px solid #d6e2dc; border-radius: 10px; place-items: center; }
  .setting-icon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  h2 { color: #2a3831; font-size: calc(12px * var(--text-scale)); font-weight: 680; }
  .media-heading p { margin-top: 3px; color: #879089; font-size: calc(9px * var(--text-scale)); }
  .reset-media { height: 29px; padding: 0 10px; color: #607068; background: #f7f9f6; border: 1px solid #d5ddd7; border-radius: 8px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 620; }
  .device-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; padding-top: 17px; }
  .device-field, .level-field { min-width: 0; }
  .device-field > span, .level-field label { display: block; margin-bottom: 7px; color: #59675f; font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  select { width: 100%; height: 38px; padding: 0 34px 0 11px; overflow: hidden; color: #34423a; background: #f8faf7; border: 1px solid #d9e0db; border-radius: 9px; outline: none; font: inherit; font-size: calc(10px * var(--text-scale)); text-overflow: ellipsis; }
  select:focus { border-color: #6b9d8b; box-shadow: 0 0 0 3px rgb(82 145 123 / 11%); }
  .level-field > div { display: flex; align-items: center; justify-content: space-between; }
  .level-field output { color: #3e7664; font-size: calc(10px * var(--text-scale)); font-weight: 720; font-variant-numeric: tabular-nums; }
  .level-field input { width: 100%; height: 18px; margin: 0; cursor: pointer; accent-color: #4d8c77; }
  .level-field small { display: block; margin-top: 4px; color: #949d97; font-size: calc(8px * var(--text-scale)); }
  .access-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 15px; padding: 10px 12px; color: #557568; background: #eef5f1; border: 1px solid #d2e2da; border-radius: 9px; font-size: calc(9px * var(--text-scale)); }
  .access-row.error { color: #8d554f; background: #fbf0ee; border-color: #ead1cd; }
  .access-row button { height: 29px; padding: 0 10px; color: #356b59; background: #fff; border: 1px solid #c7d9d1; border-radius: 7px; cursor: pointer; font: inherit; font-size: calc(8px * var(--text-scale)); font-weight: 690; }
  .test-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-top: 19px; padding-top: 17px; border-top: 1px solid #e6eae7; }
  .test-panel { min-width: 0; padding: 13px; background: #f7f9f6; border: 1px solid #dde3de; border-radius: 11px; transition: border-color 150ms ease, box-shadow 150ms ease; }
  .test-panel.active { border-color: #72a493; box-shadow: inset 0 0 0 1px rgb(83 146 124 / 10%); }
  .test-copy strong, .test-copy span { display: block; }
  .test-copy strong { color: #35423b; font-size: calc(10px * var(--text-scale)); }
  .test-copy span { min-height: 27px; margin-top: 4px; color: #8a948e; font-size: calc(8px * var(--text-scale)); line-height: 1.45; }
  .microphone-meter { position: relative; height: 27px; margin-top: 12px; overflow: hidden; background: #e7ece8; border: 1px solid #d9e1dc; border-radius: 7px; }
  .microphone-meter i { position: absolute; inset: 0 auto 0 0; min-width: 0; background: linear-gradient(90deg, #75ad98, #4b8b75); border-radius: 6px; transition: width 70ms linear; }
  .microphone-meter span { position: absolute; inset: 0; display: grid; color: #65736b; font-size: calc(8px * var(--text-scale)); font-weight: 700; place-items: center; }
  .test-panel.active .microphone-meter span { color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / 25%); }
  .test-panel button { height: 31px; margin-top: 10px; padding: 0 11px; color: #376d5b; background: #edf4f0; border: 1px solid #cadbd3; border-radius: 8px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 690; }
  .test-panel button.stop { color: #94544d; background: #fbf0ee; border-color: #ead1cd; }
  .test-panel button:disabled, select:disabled { cursor: not-allowed; opacity: .58; }
  .camera-test { padding: 9px; }
  .camera-preview { display: grid; position: relative; height: 126px; overflow: hidden; color: #829087; background: radial-gradient(circle at 50% 35%, #edf3ef, #e5ebe7); border-radius: 8px; place-items: center; }
  .camera-preview video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
  .camera-preview svg { width: 28px; height: 28px; margin-bottom: -27px; fill: none; stroke: #719181; stroke-linejoin: round; stroke-width: 1.4; }
  .camera-preview span { margin-top: 28px; font-size: calc(8px * var(--text-scale)); font-weight: 620; }
  .camera-action { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; }
  .camera-action span { color: #8a948e; font-size: calc(8px * var(--text-scale)); }
  .camera-action button { flex: 0 0 auto; }
  .media-error { margin-top: 12px; padding: 9px 11px; color: #944b45; background: #fbefed; border: 1px solid #ebd1ce; border-radius: 8px; font-size: calc(9px * var(--text-scale)); }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid rgb(55 117 102 / 44%); outline-offset: 2px; }
  @media (max-width: 760px) { .device-grid, .test-grid { grid-template-columns: 1fr; } }

  /* Media controls use the same SoftUI surface contract as Agordoj. Keep
     these variables local so the card also remains legible when embedded in
     another section or rendered in isolation by a story/test. */
  .media-settings-card {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #c95667;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-shadow-raised: 0 9px 22px rgb(39 51 67 / 20%), -5px -5px 14px rgb(255 255 255 / 56%);
    --sui-shadow-raised-sm: 0 4px 10px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 50%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    margin-top: 14px;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    box-shadow: var(--sui-shadow-raised);
  }

  :global(html[data-theme='dark']) .media-settings-card {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-shadow-raised: 0 11px 25px rgb(0 0 0 / 42%);
    --sui-shadow-raised-sm: 0 5px 12px rgb(0 0 0 / 36%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  .media-settings-card .media-heading { border-bottom-color: color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .media-settings-card .setting-icon { color: var(--sui-primary); background: var(--sui-bg); border: 0; box-shadow: var(--sui-shadow-inset-sm); }
  .media-settings-card h2, .media-settings-card .test-copy strong { color: var(--sui-text); }
  .media-settings-card .media-heading p, .media-settings-card .test-copy span, .media-settings-card .camera-action span { color: var(--sui-text-light); }
  .media-settings-card .reset-media,
  .media-settings-card .access-row button,
  .media-settings-card .test-panel button {
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 10px;
    box-shadow: var(--sui-shadow-raised-sm);
  }
  .media-settings-card .reset-media:hover,
  .media-settings-card .access-row button:hover,
  .media-settings-card .test-panel button:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .media-settings-card .reset-media:active,
  .media-settings-card .access-row button:active,
  .media-settings-card .test-panel button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .media-settings-card select,
  .media-settings-card .test-panel,
  .media-settings-card .camera-preview {
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    box-shadow: var(--sui-shadow-inset-sm);
  }
  .media-settings-card select { border-radius: 10px; }
  .media-settings-card select:focus { border-color: var(--sui-primary); box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--sui-primary) 20%, transparent); }
  .media-settings-card .device-field > span,
  .media-settings-card .level-field label { color: var(--sui-text-muted); }
  .media-settings-card .level-field output { color: var(--sui-primary); }
  .media-settings-card .level-field small { color: var(--sui-text-light); }
  .media-settings-card .level-field input {
    height: 20px;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .media-settings-card .level-field input::-webkit-slider-runnable-track {
    height: 6px;
    background: linear-gradient(90deg, var(--sui-primary) 0 var(--range-progress), var(--sui-bg-dark) var(--range-progress) 100%);
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
  }
  .media-settings-card .level-field input::-webkit-slider-thumb {
    width: 17px;
    height: 17px;
    margin-top: -5.5px;
    appearance: none;
    background: var(--sui-bg-light);
    border: 2px solid var(--sui-primary);
    border-radius: 50%;
    box-shadow: var(--sui-shadow-raised-sm);
  }
  .media-settings-card .level-field input::-moz-range-track { height: 6px; background: var(--sui-bg-dark); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .media-settings-card .level-field input::-moz-range-progress { height: 6px; background: var(--sui-primary); border-radius: 999px; }
  .media-settings-card .level-field input::-moz-range-thumb { width: 13px; height: 13px; background: var(--sui-bg-light); border: 2px solid var(--sui-primary); border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); }
  .media-settings-card .access-row { color: var(--sui-text-muted); background: color-mix(in srgb, var(--sui-success) 8%, var(--sui-bg)); border: 0; box-shadow: var(--sui-shadow-inset-sm); }
  .media-settings-card .access-row.error { color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 9%, var(--sui-bg)); }
  .media-settings-card .test-grid { border-top-color: color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .media-settings-card .test-panel.active { border: 0; box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--sui-success) 25%, transparent); }
  .media-settings-card .microphone-meter { background: var(--sui-bg-dark); border: 0; box-shadow: var(--sui-shadow-inset-sm); }
  .media-settings-card .microphone-meter i { background: linear-gradient(90deg, color-mix(in srgb, var(--sui-success) 58%, var(--sui-primary)), var(--sui-primary)); }
  .media-settings-card .microphone-meter span { color: var(--sui-text-muted); }
  .media-settings-card .camera-preview { color: var(--sui-text-light); }
  .media-settings-card .camera-preview svg { stroke: var(--sui-primary); }
  .media-settings-card .test-grid { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); }
  .media-settings-card .camera-preview {
    width: 100%;
    height: auto;
    min-height: 150px;
    max-height: 240px;
    aspect-ratio: 16 / 9;
  }
  .media-settings-card .camera-preview video {
    background: var(--sui-bg-dark);
    object-fit: contain;
  }
  @media (max-width: 760px) { .media-settings-card .test-grid { grid-template-columns: 1fr; } }
  .media-settings-card .test-panel button.stop { color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 9%, var(--sui-bg)); }
  .media-settings-card .media-error { color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border: 0; box-shadow: var(--sui-shadow-inset-sm); }
  .media-settings-card button:focus-visible,
  .media-settings-card select:focus-visible,
  .media-settings-card input:focus-visible { outline-color: color-mix(in srgb, var(--sui-primary) 45%, transparent); }
</style>
