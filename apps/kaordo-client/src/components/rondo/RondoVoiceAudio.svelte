<script lang="ts">
  import type { RondoVoiceSnapshot } from '../../lib/services/RondoVoiceSession';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';

  type Props = { media: Readonly<MediaSettingsSnapshot>; voice: RondoVoiceSnapshot };
  let { media, voice }: Props = $props();

  type AudioTarget = { speakerId: string; stream: MediaStream; volume: number };
  type SinkAudio = HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };

  function attach(node: SinkAudio, target: AudioTarget) {
    apply(node, target);
    return {
      update(next: AudioTarget) { apply(node, next); },
      destroy() { node.srcObject = null; },
    };
  }

  function apply(node: SinkAudio, target: AudioTarget): void {
    if (node.srcObject !== target.stream) node.srcObject = target.stream;
    node.volume = Math.min(1, Math.max(0, target.volume / 100));
    if (node.setSinkId) void node.setSinkId(target.speakerId).catch(() => undefined);
    void node.play().catch(() => undefined);
  }
</script>

<div class="voice-audio" aria-hidden="true">
  {#each voice.participants.filter(({ local }) => !local) as participant (participant.peerId)}
    {#each participant.streams.filter((stream) => stream.getAudioTracks().length > 0) as stream (stream.id)}
      <audio
        autoplay
        muted={voice.deafened}
        use:attach={{ speakerId: media.speakerId, stream, volume: media.speakerVolume }}
      ></audio>
    {/each}
  {/each}
</div>

<style>
  .voice-audio { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
</style>
