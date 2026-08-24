<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    type AppSection,
    type AppSectionDefinition,
  } from '../lib/domain/appSection';
  import type { WorkspaceSummary } from '../lib/domain/workspace';

  type Props = {
    activeFile: WorkspaceSummary | null;
    activeSection: AppSection;
    onBack: () => void | Promise<void>;
    onNavigate: (section: AppSection) => void;
    platform: 'desktop' | 'web';
    sections: ReadonlyArray<AppSectionDefinition>;
  };

  let { activeFile, activeSection, onBack, onNavigate, platform, sections }: Props = $props();
  let navigationSections = $derived(sections.filter((section) => section.id !== 'agordoj'));
  let appBarElement = $state<HTMLElement>();
  let backButtonElement = $state<HTMLButtonElement>();
  let segmentedElement = $state<HTMLElement>();
  let indicatorElement = $state<HTMLDivElement>();
  let indicatorFrame = 0;

  const INTERACTIVE_SELECTOR = [
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="option"]',
  ].join(', ');

  function isHeaderDragTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !target.closest(INTERACTIVE_SELECTOR);
  }

  function syncSegmentedIndicator() {
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame);

    indicatorFrame = requestAnimationFrame(() => {
      if (!segmentedElement || !indicatorElement) return;

      const checkedInput = segmentedElement.querySelector<HTMLInputElement>('input:checked');
      const activeLabel = checkedInput?.nextElementSibling;
      if (!(activeLabel instanceof HTMLElement)) {
        indicatorElement.style.width = '0px';
        return;
      }

      indicatorElement.style.left = `${activeLabel.offsetLeft}px`;
      indicatorElement.style.width = `${activeLabel.offsetWidth}px`;
    });
  }

  async function runWindowAction(
    action: 'close' | 'minimize' | 'toggleMaximize',
  ): Promise<void> {
    if (platform !== 'desktop') return;

    try {
      await getCurrentWindow()[action]();
    } catch (error) {
      // Keep the control responsive in browser mode while retaining a useful
      // diagnostic when a bundled Tauri capability is misconfigured.
      console.error(`Unable to ${action} the Kaordo window.`, error);
    }
  }

  $effect(() => {
    const currentSection = activeSection;
    const sectionCount = navigationSections.length;
    if (!currentSection || sectionCount === 0) return;
    syncSegmentedIndicator();
  });

  onDestroy(() => {
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
  });

  onMount(() => {
    if (platform !== 'desktop' || !appBarElement) return;

    // Tauri's built-in drag script uses `internal_toggle_maximize`, which
    // refuses to maximize some transparent, undecorated macOS windows. Stop
    // only that second-click path before it reaches the document listener
    // and use the regular toggle command, which supports both directions.
    const blockNativeDoubleClick = (event: MouseEvent) => {
      if (
        event.button === 0 &&
        event.detail === 2 &&
        isHeaderDragTarget(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'mousedown') {
          void runWindowAction('toggleMaximize');
        }
      }
    };

    appBarElement.addEventListener('mousedown', blockNativeDoubleClick, true);
    appBarElement.addEventListener('mouseup', blockNativeDoubleClick, true);

    return () => {
      appBarElement?.removeEventListener('mousedown', blockNativeDoubleClick, true);
      appBarElement?.removeEventListener('mouseup', blockNativeDoubleClick, true);
    };
  });

  export function focusBack() {
    backButtonElement?.focus();
  }
</script>

<!-- Tauri maps a double click on this drag region to maximize/unmaximize. -->
<header
  class="app-bar"
  bind:this={appBarElement}
  data-tauri-drag-region={platform === 'desktop' ? 'deep' : undefined}
>
  <div class="brand-side">
    {#if platform === 'desktop'}
      <div class="window-controls" aria-label="Window controls">
        <button
          class="window-control window-control--close"
          type="button"
          aria-label="Close window"
          title="Close"
          onclick={() => void runWindowAction('close')}
        ></button>
        <button
          class="window-control window-control--minimize"
          type="button"
          aria-label="Minimize window"
          title="Minimize"
          onclick={() => void runWindowAction('minimize')}
        ></button>
        <button
          class="window-control window-control--maximize"
          type="button"
          aria-label="Maximize window"
          title="Maximize"
          onclick={() => void runWindowAction('toggleMaximize')}
        ></button>
      </div>
    {/if}
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="presentation">
          <path d="M7 8.5 16 4l9 4.5v10L16 28l-9-9.5z" />
          <path d="m7 8.5 9 4.8 9-4.8M16 13.3V28" />
        </svg>
      </span>
      <span class="brand-name">Kaordo</span>
    </div>
  </div>

  <nav
    class="section-tabs sui-segmented sui-segmented-primary"
    bind:this={segmentedElement}
    aria-label="Kaordo sections"
  >
    <div class="sui-segmented-indicator" bind:this={indicatorElement} aria-hidden="true"></div>
    {#each navigationSections as section}
      <input
        id={`kaordo-section-${section.id}`}
        type="radio"
        name="kaordo-sections"
        value={section.id}
        checked={activeSection === section.id}
        aria-label={section.label}
        onchange={() => onNavigate(section.id)}
      />
      <label for={`kaordo-section-${section.id}`} title={section.description}>{section.label}</label>
    {/each}
  </nav>

  <div class="section-context">
    {#if activeSection === 'klaro' && activeFile}
      <button
        class="back-action"
        type="button"
        bind:this={backButtonElement}
        onclick={onBack}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m11.5 5-5 5 5 5M7 10h7" />
        </svg>
        Back
      </button>
      <span class="navigation-separator" aria-hidden="true"></span>
      <span class="context-label" title={`${activeFile.name}.vdw`}>
        {activeFile.name}.vdw
      </span>
    {/if}
    <button
      class="sui-btn sui-btn-icon settings-action"
      class:settings-action--active={activeSection === 'agordoj'}
      type="button"
      title="Agordoj"
      aria-label="Open application settings"
      onclick={() => onNavigate('agordoj')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 1 1.8 2.1.6 1.8-1 1.7 1.7-1 1.8.6 2.1 1.8 1v2.4l-1.8 1-.6 2.1 1 1.8-1.7 1.7-1.8-1-2.1.6-1 1.8H9.6l-1-1.8-2.1-.6-1.8 1L3 17.4l1-1.8-.6-2.1-1.8-1V10l1.8-1L4 6.9 3 5.1 4.7 3.4l1.8 1 2.1-.6 1-1.8H12Z" />
        <circle cx="10.8" cy="11.2" r="2.7" />
      </svg>
    </button>
  </div>
</header>

<style>
  .app-bar {
    --header-background: #e4e9f0;
    --header-border: #d1d9e6;
    --header-text: #2d3748;
    --header-muted: #5a6a7e;
    --header-control: #edf1f7;
    --header-control-border: #d1d9e6;
    --header-primary: #5b54e0;
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    color: var(--header-text);
    background: var(--header-background);
    border-bottom: 1px solid var(--header-border);
    cursor: grab;
    user-select: none;
  }

  .app-bar:active {
    cursor: grabbing;
  }

  :global(html[data-theme='dark']) .app-bar {
    --header-background: var(--chrome);
    --header-border: rgb(255 255 255 / 8%);
    --header-text: var(--chrome-text);
    --header-muted: rgb(246 250 247 / 54%);
    --header-control: rgb(255 255 255 / 7%);
    --header-control-border: rgb(255 255 255 / 10%);
    --header-primary: var(--accent);
  }

  :global(html[data-theme='dark']) .sui-btn {
    box-shadow:
      2px 2px 6px rgb(0 0 0 / 28%),
      -2px -2px 6px rgb(255 255 255 / 5%);
  }

  :global(html[data-theme='dark']) .sui-segmented {
    --sui-bg: rgb(255 255 255 / 7%);
    --sui-shadow-inset:
      inset 2px 2px 5px rgb(0 0 0 / 18%), inset -2px -2px 5px rgb(255 255 255 / 5%);
    --sui-shadow-raised-sm:
      2px 2px 7px rgb(0 0 0 / 28%), -2px -2px 7px rgb(255 255 255 / 6%);
  }

  .brand-side {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 8px;
    min-width: 0;
  }

  .window-controls {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    padding-inline: 2px;
  }

  .window-control {
    width: 12px;
    height: 12px;
    padding: 0;
    border: 1px solid rgb(0 0 0 / 14%);
    border-radius: 50%;
    box-shadow: inset 0 1px rgb(255 255 255 / 42%);
    cursor: pointer;
    transition: filter 130ms ease, transform 130ms ease;
  }

  .window-control:hover {
    filter: brightness(0.92) saturate(1.12);
    transform: scale(1.08);
  }

  .window-control:focus-visible {
    outline: 2px solid var(--header-primary);
    outline-offset: 2px;
  }

  .window-control--close {
    background: #ff5f57;
  }

  .window-control--minimize {
    background: #febc2e;
  }

  .window-control--maximize {
    background: #28c840;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .brand-mark {
    display: grid;
    flex: none;
    width: 23px;
    height: 23px;
    color: var(--header-muted);
    background: var(--header-control);
    border: 1px solid var(--header-control-border);
    border-radius: 7px;
    place-items: center;
  }

  .brand-mark svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .brand-name {
    color: var(--header-text);
    font-size: calc(12px * var(--text-scale));
    font-weight: 620;
    letter-spacing: 0.01em;
  }

  /* SoftUI icon button, kept scoped to the header so its global reset is not
     applied to the rest of the app. */
  .sui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--header-muted);
    background: var(--header-control);
    border: 1px solid var(--header-control-border);
    border-radius: 50%;
    box-shadow:
      2px 2px 6px rgb(184 192 204 / 54%),
      -2px -2px 6px rgb(255 255 255 / 70%);
    cursor: pointer;
    transition:
      color 150ms ease,
      background 150ms ease,
      box-shadow 150ms ease,
      transform 150ms ease;
  }

  .sui-btn-icon {
    width: 25px;
    height: 25px;
  }

  .sui-btn svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .sui-btn:hover {
    color: var(--header-text);
    box-shadow:
      1px 1px 4px rgb(184 192 204 / 62%),
      -1px -1px 4px rgb(255 255 255 / 78%);
    transform: translateY(-1px);
  }

  .sui-btn:active {
    box-shadow: inset 2px 2px 5px rgb(184 192 204 / 62%);
    transform: translateY(0);
  }

  .settings-action--active {
    color: #fff;
    background: var(--header-primary);
    border-color: transparent;
    box-shadow: 0 2px 8px rgb(91 84 224 / 30%);
  }

  .sui-btn:focus-visible {
    outline: 2px solid var(--header-primary);
    outline-offset: 2px;
  }

  .section-tabs {
    display: inline-flex;
    align-self: center;
    align-items: center;
    justify-self: center;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .section-tabs::-webkit-scrollbar {
    display: none;
  }

  /*
   * SoftUI's segmented control is intentionally scoped to the app bar. The
   * full vendor stylesheet is opt-in, so this keeps the official component
   * contract and visual treatment without applying its global reset to the
   * rest of Kaordo.
   */
  .sui-segmented {
    --sui-bg: #d1d9e6;
    --sui-primary: var(--header-primary);
    --sui-text: var(--header-text);
    --sui-text-muted: var(--header-muted);
    --sui-radius-full: 9999px;
    --sui-font: inherit;
    --sui-transition-fast: 130ms;
    --sui-transition-base: 180ms;
    --sui-shadow-inset:
      inset 2px 2px 5px #b8c0cc, inset -2px -2px 5px #fff;
    --sui-shadow-raised-sm:
      2px 2px 7px #b8c0cc, -2px -2px 7px #fff;
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 2px;
    background: var(--sui-bg);
    border-radius: var(--sui-radius-full);
    box-shadow: var(--sui-shadow-inset);
  }

  .sui-segmented input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
  }

  .sui-segmented label {
    position: relative;
    z-index: 1;
    padding: 4px 9px;
    color: var(--sui-text-muted);
    border-radius: var(--sui-radius-full);
    cursor: pointer;
    font-family: var(--sui-font);
    font-size: calc(10px * var(--text-scale));
    font-weight: 610;
    letter-spacing: 0.005em;
    line-height: 1.25;
    text-align: center;
    transition: color var(--sui-transition-fast) ease;
    user-select: none;
    white-space: nowrap;
  }

  .sui-segmented label:hover {
    color: var(--sui-text);
  }

  .sui-segmented input:checked + label {
    color: #fff;
    font-weight: 650;
  }

  .sui-segmented input:focus-visible + label {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .sui-segmented-indicator {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    width: 0;
    border-radius: var(--sui-radius-full);
    background: var(--sui-primary);
    box-shadow: 0 2px 8px rgb(91 84 224 / 30%);
    pointer-events: none;
    transition:
      left var(--sui-transition-base) ease,
      width var(--sui-transition-base) ease;
    z-index: 0;
  }

  .back-action:focus-visible {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .section-context {
    display: flex;
    align-items: center;
    justify-self: end;
    gap: 9px;
    min-width: 0;
    max-width: 100%;
  }

  .context-label {
    overflow: hidden;
    color: var(--header-muted);
    font-size: calc(11px * var(--text-scale));
    font-weight: 580;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .back-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 26px;
    padding: 0 8px 0 6px;
    color: var(--header-muted);
    background: var(--header-control);
    border: 1px solid var(--header-control-border);
    border-radius: 7px;
    cursor: pointer;
    font-size: calc(11px * var(--text-scale));
    font-weight: 600;
  }

  .back-action:hover {
    color: var(--header-text);
    background: var(--header-background);
  }

  .back-action svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .navigation-separator {
    flex: none;
    width: 1px;
    height: 14px;
    background: var(--header-border);
  }

  .section-context .settings-action {
    margin-left: 2px;
  }

  @media (max-width: 1120px) {
    .app-bar {
      grid-template-columns: minmax(140px, 1fr) auto minmax(140px, 1fr);
      padding-inline: 14px;
    }

    .sui-segmented label {
      padding-inline: 7px;
    }

    .context-label {
      max-width: 110px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sui-segmented label,
    .sui-segmented-indicator {
      transition: none;
    }
  }
</style>
