<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { LigoAttachment } from '../../lib/domain/ligo';

  type Props = {
    attachment: LigoAttachment;
    onClose: () => void;
    url: string;
  };

  let { attachment, onClose, url }: Props = $props();
  let closeButton = $state<HTMLButtonElement>();
  let previousOverflow = '';

  onMount(() => {
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    closeButton?.focus({ preventScroll: true });
  });
  onDestroy(() => { document.documentElement.style.overflow = previousOverflow; });

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="viewer" role="dialog" aria-modal="true" aria-label={`Preview ${attachment.name}`}>
  <button class="backdrop" type="button" onclick={onClose} aria-label="Close image preview"></button>
  <img src={url} alt={attachment.name} />
  <footer>
    <span>{attachment.name}</span>
    <a href={url} download={attachment.name} title="Download image" aria-label={`Download ${attachment.name}`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v10M6.5 9l3.5 3.5L13.5 9M3 16.5h14"/></svg>
    </a>
  </footer>
  <button bind:this={closeButton} class="close" type="button" onclick={onClose} title="Close (Esc)" aria-label="Close image preview">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
  </button>
</div>

<style>
  .viewer{position:fixed;z-index:400;inset:0;display:grid;padding:64px 72px 76px;place-items:center;isolation:isolate;animation:viewer-enter 180ms ease-out both}.backdrop{position:absolute;z-index:-1;inset:0;width:100%;height:100%;padding:0;background:rgb(5 9 8 / 91%);border:0;cursor:zoom-out;backdrop-filter:blur(18px);animation:backdrop-enter 180ms ease-out both}.viewer>img{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 24px 90px rgb(0 0 0 / 52%);user-select:none;animation:image-enter 220ms cubic-bezier(.18,.8,.24,1) both}.close,.viewer a{position:absolute;display:grid;width:42px;height:42px;padding:0;color:white;background:rgb(255 255 255 / 10%);border:1px solid rgb(255 255 255 / 15%);border-radius:13px;cursor:pointer;place-items:center;backdrop-filter:blur(12px);transition:background 130ms ease,transform 130ms ease}.close{top:20px;right:22px}.viewer a{right:74px;bottom:18px;text-decoration:none}.close:hover,.viewer a:hover{background:rgb(255 255 255 / 18%);transform:translateY(-1px)}.close:focus-visible,.viewer a:focus-visible{outline:2px solid white;outline-offset:2px}.close svg,.viewer a svg{width:20px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7}.viewer footer{position:absolute;right:130px;bottom:18px;left:24px;display:flex;align-items:center;height:42px;color:rgb(255 255 255 / 78%);font-size:calc(11px * var(--text-scale));pointer-events:none}.viewer footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@keyframes viewer-enter{from{opacity:0}}@keyframes backdrop-enter{from{background:rgb(5 9 8 / 0%);backdrop-filter:blur(0)}}@keyframes image-enter{from{opacity:0;transform:scale(.94) translateY(8px)}}@media(max-width:700px){.viewer{padding:58px 16px 70px}.close{top:12px;right:12px}.viewer a{right:12px;bottom:12px}.viewer footer{right:66px;bottom:12px;left:16px}}
</style>
