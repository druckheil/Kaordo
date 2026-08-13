<script lang="ts">
  import { tick } from 'svelte';
  import {
    closeContextMenu,
    contextMenu,
    type ContextMenuIcon,
    type ContextMenuItem,
  } from '../../lib/ui/contextMenu';

  let menu = $state<HTMLDivElement>();
  let confirmingId = $state<string | null>(null);
  let activeToken = 0;
  let snapshot = $derived($contextMenu);
  let confirming = $derived(
    snapshot?.items.find((item) => item.id === confirmingId) ?? null,
  );
  let position = $derived(menuPosition());

  $effect(() => {
    if (!snapshot) return;
    if (activeToken !== snapshot.token) {
      activeToken = snapshot.token;
      confirmingId = null;
    }
    void tick().then(() => {
      menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({
        preventScroll: true,
      });
    });
  });

  function menuPosition(): string {
    if (!snapshot) return '';
    const width = 204;
    const height = confirmingId ? 126 : 34 + snapshot.items.length * 37 + 10;
    const x = Math.max(8, Math.min(snapshot.x, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(snapshot.y, window.innerHeight - height - 8));
    return `left:${x}px;top:${y}px`;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!snapshot) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeContextMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }

  function run(item: ContextMenuItem) {
    if (item.confirmation && confirmingId !== item.id) {
      confirmingId = item.id;
      void tick().then(() => {
        menu?.querySelector<HTMLButtonElement>('.confirm-delete')?.focus({
          preventScroll: true,
        });
      });
      return;
    }
    closeContextMenu();
    void item.action();
  }

  function iconPath(icon: ContextMenuIcon): string {
    switch (icon) {
      case 'delete': return 'M5 6h10m-8 0 .7 10h4.6L13 6M8 6V4h4v2m-3 3v4m2-4v4';
      case 'edit': return 'M5 15h3l7.4-7.4-3-3L5 12v3Zm6.3-9.3 3 3';
      case 'focus': return 'M7 4H4v3m9-3h3v3M7 16H4v-3m9 3h3v-3M7.5 10h5';
      case 'open': return 'M4 6.5h5l1.4 1.7H16v7H4v-8.7ZM4 6.5V5h5l1.2 1.5';
      case 'rectangle': return 'M4 5h12v10H4z';
      case 'select': return 'm5 3 9 8-4.1.7L8 16 5 3Z';
      case 'text': return 'M5 5V3h10v2m-5-2v14m-3 0h6';
    }
  }
</script>

<svelte:window
  onblur={closeContextMenu}
  onkeydown={handleWindowKeydown}
  onpointerdown={closeContextMenu}
  onresize={closeContextMenu}
/>

{#if snapshot}
  <div
    class="context-menu"
    bind:this={menu}
    role="menu"
    tabindex="-1"
    aria-label={`${snapshot.label} actions`}
    style={position}
    oncontextmenu={(event) => event.preventDefault()}
    onpointerdown={(event) => event.stopPropagation()}
  >
    {#if confirming}
      <div class="confirmation" role="alert">
        <strong>{confirming.confirmation}</strong>
        <span>This cannot be undone.</span>
        <div>
          <button type="button" onclick={() => confirmingId = null}>Cancel</button>
          <button
            class="confirm-delete"
            type="button"
            onclick={() => run(confirming)}
          >Delete</button>
        </div>
      </div>
    {:else}
      <div class="context-menu-label">{snapshot.label}</div>
      {#each snapshot.items as item (item.id)}
        <button
          class:danger={item.danger}
          type="button"
          role="menuitem"
          onclick={() => run(item)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d={iconPath(item.icon)} />
          </svg>
          <span>{item.label}</span>
          {#if item.hint}<kbd>{item.hint}</kbd>{/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    width: 196px;
    padding: 5px;
    color: #303a34;
    background: rgb(252 253 251 / 96%);
    border: 1px solid rgb(178 190 182 / 78%);
    border-radius: 10px;
    box-shadow:
      0 18px 44px rgb(29 47 39 / 18%),
      0 3px 10px rgb(29 47 39 / 9%),
      inset 0 1px rgb(255 255 255 / 90%);
    backdrop-filter: blur(18px) saturate(1.15);
    animation: context-menu-enter 110ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .context-menu-label {
    height: 29px;
    padding: 8px 9px 0;
    overflow: hidden;
    color: #859088;
    font-size: calc(9px * var(--text-scale));
    font-weight: 720;
    letter-spacing: 0.095em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  button {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 35px;
    padding: 0 8px;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: default;
    font: inherit;
    font-size: calc(11px * var(--text-scale));
    font-weight: 590;
    text-align: left;
  }

  button:hover,
  button:focus-visible {
    color: #245d4f;
    background: #e7f1ed;
    outline: none;
  }

  button.danger {
    color: #a44942;
  }

  button.danger:hover,
  button.danger:focus-visible {
    color: #92372f;
    background: #faeae7;
  }

  .confirmation {
    display: grid;
    gap: 4px;
    padding: 8px;
  }

  .confirmation strong {
    overflow: hidden;
    color: #513d39;
    font-size: calc(11px * var(--text-scale));
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .confirmation > span {
    color: #8d7771;
    font-size: calc(9px * var(--text-scale));
  }

  .confirmation > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 7px;
  }

  .confirmation button {
    display: block;
    height: 30px;
    padding: 0 8px;
    background: #f1f3f0;
    text-align: center;
  }

  .confirmation .confirm-delete {
    color: #fff;
    background: #b44d43;
  }

  .confirmation .confirm-delete:hover,
  .confirmation .confirm-delete:focus-visible {
    color: #fff;
    background: #9e3d35;
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.45;
  }

  kbd {
    color: #929b95;
    font-family: inherit;
    font-size: calc(9px * var(--text-scale));
    font-weight: 560;
  }

  @keyframes context-menu-enter {
    from { opacity: 0; transform: translateY(-3px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .context-menu { animation: none; }
  }
</style>
