<script lang="ts">
  import type { RondoSpace } from '../../lib/domain/rondo';

  type Props = {
    activeSpaceId: string | null;
    onCreate: () => void;
    onJoin: () => void;
    onSelect: (spaceId: string) => void;
    spaces: RondoSpace[];
  };

  let { activeSpaceId, onCreate, onJoin, onSelect, spaces }: Props = $props();

  function initials(name: string): string {
    return name.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function spaceHue(id: string): number {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return 142 + Math.abs(hash % 54);
  }
</script>

<aside class="rondo-rail" aria-label="Rondo Spaces">
  <div class="rail-heading" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  </div>

  <div class="space-list">
    {#each spaces as space (space.id)}
      <button
        class="space-button"
        class:space-button--active={activeSpaceId === space.id}
        type="button"
        title={space.name}
        aria-label={`Open ${space.name}`}
        aria-pressed={activeSpaceId === space.id}
        onclick={() => onSelect(space.id)}
      >
        <span class="active-marker" aria-hidden="true"></span>
        <span class="space-avatar" style={`--space-hue:${spaceHue(space.id)}`}>
          {initials(space.name)}
        </span>
      </button>
    {/each}
  </div>

  <div class="rail-actions">
    <button type="button" title="Create a Space" aria-label="Create a Space" onclick={onCreate}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    </button>
    <button type="button" title="Join a Space" aria-label="Join a Space" onclick={onJoin}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3.5 4.5h8v11h-8zM8 10h8m-3-3 3 3-3 3" />
      </svg>
    </button>
  </div>
</aside>

<style>
  .rondo-rail {
    display: grid;
    grid-template-rows: 64px minmax(0, 1fr) auto;
    min-height: 0;
    margin: 14px 0 14px 12px;
    padding: 12px 0 14px;
    overflow: hidden;
    color: var(--rondo-text-muted, #5c6d84);
    background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4));
    border-radius: 22px;
    box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%));
  }

  .rail-heading {
    display: grid;
    width: 42px;
    height: 42px;
    margin: 0 auto;
    color: var(--rondo-primary, #5b54e0);
    background: var(--rondo-bg, #e4e9f0);
    border: 0;
    border-radius: 14px;
    box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%));
    place-items: center;
  }

  .rail-heading svg,
  .rail-actions svg {
    width: 20px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
  }

  .space-list {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 9px;
    min-height: 0;
    padding: 5px 0 12px;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .space-list::-webkit-scrollbar { display: none; }

  .space-button {
    position: relative;
    display: grid;
    flex: none;
    width: 58px;
    height: 52px;
    padding: 0;
    color: var(--rondo-text-muted, #5c6d84);
    background: transparent;
    border: 0;
    cursor: pointer;
    place-items: center;
  }

  .space-avatar {
    display: grid;
    width: 42px;
    height: 42px;
    color: var(--rondo-primary, #5b54e0);
    background: var(--rondo-bg, #e4e9f0);
    border: 0;
    border-radius: 14px;
    box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%));
    font-size: calc(11px * var(--text-scale));
    font-weight: 740;
    letter-spacing: 0.02em;
    place-items: center;
    transition: color 150ms ease, background 150ms ease, border-radius 150ms ease, transform 150ms ease, box-shadow 150ms ease;
  }

  .space-button:hover .space-avatar,
  .space-button--active .space-avatar {
    color: #fff;
    background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4));
    border-radius: 13px;
    transform: translateY(-1px);
    box-shadow: 5px 6px 13px rgb(74 68 196 / 24%), -3px -3px 8px rgb(255 255 255 / 46%);
  }

  .active-marker {
    position: absolute;
    left: 0;
    width: 4px;
    height: 10px;
    background: var(--rondo-primary, #5b54e0);
    border-radius: 0 6px 6px 0;
    opacity: 0;
    transform: scaleY(0.4);
    transition: height 150ms ease, opacity 150ms ease, transform 150ms ease;
  }

  .space-button--active .active-marker {
    height: 28px;
    opacity: 1;
    transform: scaleY(1);
  }

  .rail-actions {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 20%, transparent);
  }

  .rail-actions button {
    display: grid;
    width: 38px;
    height: 38px;
    padding: 0;
    color: var(--rondo-primary, #5b54e0);
    background: var(--rondo-bg, #e4e9f0);
    border: 0;
    border-radius: 12px;
    box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%));
    cursor: pointer;
    place-items: center;
    transition: color 130ms ease, box-shadow 130ms ease, transform 130ms ease;
  }

  .rail-actions button:hover {
    color: var(--rondo-primary-hover, #4a44c4);
    box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%));
    transform: translateY(-1px);
  }

  .rail-actions button:active { box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); transform: none; }
  .space-button:focus-visible, .rail-actions button:focus-visible { outline: 2px solid color-mix(in srgb, var(--rondo-primary, #5b54e0) 45%, transparent); outline-offset: 3px; border-radius: 14px; }

  :global(html[data-theme='dark']) .rondo-rail {
    color: var(--rondo-text-muted, #aab4c5);
    background: linear-gradient(145deg, var(--rondo-surface-strong, #343740), var(--rondo-surface, #2d3038));
    box-shadow: var(--rondo-shadow-raised, 7px 8px 18px rgb(0 0 0 / 42%));
  }
</style>
