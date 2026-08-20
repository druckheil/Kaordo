<script lang="ts">
  import type { LigoAttachment } from '../../lib/domain/ligo';
  import { createLigoPlaybackSource } from '../../lib/services/LigoPlaybackSource';
  import KaordoVideoPlayer from '../ui/KaordoVideoPlayer.svelte';

  type Props = { attachment: LigoAttachment };

  let { attachment }: Props = $props();
  let source = $state('');
  let loading = $state(true);
  let mediaError = $state(false);

  $effect(() => {
    let disposed = false;
    let releaseSource = () => {};
    source = '';
    loading = true;
    mediaError = false;

    void createLigoPlaybackSource(attachment).then((playback) => {
      if (disposed) {
        playback.release();
        return;
      }
      releaseSource = playback.release;
      source = playback.url;
    }).catch(() => {
      if (!disposed) {
        loading = false;
        mediaError = true;
      }
    });

    return () => {
      disposed = true;
      releaseSource();
    };
  });

  function ready(): void {
    loading = false;
    mediaError = false;
  }

  function failed(): void {
    loading = false;
    mediaError = true;
  }
</script>

<div class="player" class:failed={mediaError} class:loading>
  {#if source}
    <KaordoVideoPlayer
      mimeType={attachment.mimeType}
      onError={failed}
      onReady={ready}
      src={source}
      title={attachment.name}
    />
  {/if}
  {#if loading}
    <div class="preparing" aria-live="polite"><i></i><span>Preparing video…</span></div>
  {:else if mediaError}
    <div class="unsupported" role="alert">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 18 17H2z"/><path d="M10 7v5M10 14.5v.1"/></svg>
      <span><strong>Video format is not supported</strong><small>{attachment.name}</small></span>
    </div>
  {/if}
</div>

<style>
  .player{position:relative;width:100%;max-width:100%;aspect-ratio:16/9;overflow:hidden;background:#050706;border-radius:8px}.player :global(.kaordo-video-player){display:block;width:100%;height:100%}.preparing,.unsupported{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:11px;padding:18px;color:rgb(255 255 255 / 70%);text-align:left;background:linear-gradient(145deg,#111714,#080b0a)}.preparing{font-size:calc(10px * var(--text-scale))}.preparing i{width:17px;height:17px;border:2px solid rgb(255 255 255 / 17%);border-top-color:rgb(255 255 255 / 68%);border-radius:50%;animation:spin 700ms linear infinite}.unsupported svg{flex:none;width:28px;fill:none;stroke:#dba35e;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4}.unsupported span{display:grid;min-width:0;gap:4px}.unsupported strong{font-size:calc(11px * var(--text-scale))}.unsupported small{overflow:hidden;color:rgb(255 255 255 / 48%);font-size:calc(9px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}@keyframes spin{to{transform:rotate(1turn)}}
</style>
