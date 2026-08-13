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
    padding: 10px 0 12px;
    color: #e9f4ef;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 4%), transparent 24%),
      #202d29;
    border-right: 1px solid rgb(17 32 27 / 24%);
  }

  .rail-heading {
    display: grid;
    width: 42px;
    height: 42px;
    margin: 0 auto;
    color: #94c9b7;
    background: rgb(255 255 255 / 7%);
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 14px;
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
    color: #eef7f2;
    background: transparent;
    border: 0;
    cursor: pointer;
    place-items: center;
  }

  .space-avatar {
    display: grid;
    width: 42px;
    height: 42px;
    background:
      linear-gradient(145deg, hsl(var(--space-hue) 34% 43%), hsl(var(--space-hue) 38% 30%));
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: 14px;
    box-shadow: 0 6px 14px rgb(4 14 10 / 16%);
    font-size: calc(11px * var(--text-scale));
    font-weight: 740;
    letter-spacing: 0.02em;
    place-items: center;
    transition: border-radius 150ms ease, transform 150ms ease, box-shadow 150ms ease;
  }

  .space-button:hover .space-avatar,
  .space-button--active .space-avatar {
    border-radius: 11px;
    transform: translateY(-1px);
    box-shadow: 0 9px 18px rgb(4 14 10 / 24%);
  }

  .active-marker {
    position: absolute;
    left: 0;
    width: 3px;
    height: 10px;
    background: #9ed3c0;
    border-radius: 0 4px 4px 0;
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
    border-top: 1px solid rgb(255 255 255 / 8%);
  }

  .rail-actions button {
    display: grid;
    width: 38px;
    height: 38px;
    padding: 0;
    color: #9ccbb9;
    background: rgb(255 255 255 / 6%);
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 12px;
    cursor: pointer;
    place-items: center;
    transition: color 130ms ease, background 130ms ease, transform 130ms ease;
  }

  .rail-actions button:hover {
    color: #e9f5ef;
    background: rgb(126 181 164 / 20%);
    transform: translateY(-1px);
  }
</style>
