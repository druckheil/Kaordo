<script lang="ts">
  import {
    appSectionLabel,
    type AppSection,
    type AppSectionDefinition,
  } from '../lib/domain/appSection';
  import type { WorkspaceSummary } from '../lib/domain/workspace';

  type Props = {
    activeFile: WorkspaceSummary | null;
    activeSection: AppSection;
    onBack: () => void | Promise<void>;
    onNavigate: (section: AppSection) => void;
    sections: ReadonlyArray<AppSectionDefinition>;
  };

  let { activeFile, activeSection, onBack, onNavigate, sections }: Props = $props();
  let backButtonElement = $state<HTMLButtonElement>();

  export function focusBack() {
    backButtonElement?.focus();
  }
</script>

<header class="app-bar">
  <div class="brand" data-tauri-drag-region>
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="presentation">
        <path d="M7 8.5 16 4l9 4.5v10L16 28l-9-9.5z" />
        <path d="m7 8.5 9 4.8 9-4.8M16 13.3V28" />
      </svg>
    </span>
    <span class="brand-name">Kaordo</span>
  </div>

  <nav class="section-tabs" aria-label="Kaordo sections">
    {#each sections as section}
      <button
        class="section-tab"
        class:section-tab--active={activeSection === section.id}
        type="button"
        title={section.description}
        aria-current={activeSection === section.id ? 'page' : undefined}
        onclick={() => onNavigate(section.id)}
      >
        <span class="section-tab__indicator" aria-hidden="true"></span>
        {section.label}
      </button>
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
    {:else}
      <span class="context-label">{appSectionLabel(activeSection)}</span>
    {/if}
  </div>
</header>

<style>
  .app-bar {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    color: var(--chrome-text);
    background:
      linear-gradient(90deg, rgb(255 255 255 / 3%), transparent 34%),
      var(--chrome);
    border-bottom: 1px solid rgb(255 255 255 / 8%);
    user-select: none;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 10px;
    width: 100%;
  }

  .brand-mark {
    display: grid;
    flex: none;
    width: 28px;
    height: 28px;
    color: var(--accent-bright);
    background: rgb(255 255 255 / 7%);
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 8px;
    place-items: center;
  }

  .brand-mark svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .brand-name {
    font-size: calc(14px * var(--text-scale));
    font-weight: 620;
    letter-spacing: 0.01em;
  }

  .section-tabs {
    display: flex;
    align-self: stretch;
    align-items: center;
    justify-self: center;
    gap: 2px;
  }

  .section-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 11px;
    color: rgb(246 250 247 / 54%);
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
    font-size: calc(12px * var(--text-scale));
    font-weight: 610;
    letter-spacing: 0.005em;
    transition:
      color 130ms ease,
      background 130ms ease;
  }

  .section-tab:hover {
    color: rgb(246 250 247 / 86%);
    background: rgb(255 255 255 / 6%);
  }

  .section-tab--active {
    color: var(--chrome-text);
    background: rgb(255 255 255 / 8%);
  }

  .section-tab__indicator {
    position: absolute;
    right: 10px;
    bottom: -7px;
    left: 10px;
    height: 2px;
    background: var(--accent-bright);
    border-radius: 999px 999px 0 0;
    opacity: 0;
    transform: scaleX(0.5);
    transition:
      opacity 150ms ease,
      transform 150ms ease;
  }

  .section-tab--active .section-tab__indicator {
    opacity: 1;
    transform: scaleX(1);
  }

  .section-tab:focus-visible,
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
    color: rgb(246 250 247 / 48%);
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
    color: rgb(246 250 247 / 76%);
    background: rgb(255 255 255 / 5%);
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 7px;
    cursor: pointer;
    font-size: calc(11px * var(--text-scale));
    font-weight: 600;
  }

  .back-action:hover {
    color: var(--chrome-text);
    background: rgb(255 255 255 / 9%);
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
    background: rgb(255 255 255 / 13%);
  }

  @media (max-width: 1120px) {
    .app-bar {
      grid-template-columns: minmax(140px, 1fr) auto minmax(140px, 1fr);
      padding-inline: 14px;
    }

    .section-tab {
      padding-inline: 8px;
    }

    .context-label {
      max-width: 110px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .section-tab,
    .section-tab__indicator {
      transition: none;
    }
  }
</style>
