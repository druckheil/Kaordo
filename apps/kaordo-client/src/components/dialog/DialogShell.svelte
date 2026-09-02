<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    busy: boolean;
    children: Snippet;
    descriptionId: string;
    eyebrow: string;
    icon: Snippet;
    onCancel: () => void | Promise<void>;
    onSubmit: (event: SubmitEvent) => void | Promise<void>;
    submitLabel: string;
    submittingLabel: string;
    title: string;
    titleId: string;
    variant?: 'workspace' | 'panel' | 'settings';
  };

  let {
    busy,
    children,
    descriptionId,
    eyebrow,
    icon,
    onCancel,
    onSubmit,
    submitLabel,
    submittingLabel,
    title,
    titleId,
    variant = 'workspace',
  }: Props = $props();
  let dialogElement = $state<HTMLDivElement>();

  function handleKeydown(event: KeyboardEvent) {
    if (busy) return;

    if (event.key === 'Tab') {
      keepFocusInsideDialog(event);
      return;
    }

    if (event.key !== 'Escape') return;

    event.preventDefault();
    void onCancel();
  }

  function keepFocusInsideDialog(event: KeyboardEvent) {
    const focusableElements = Array.from(
      dialogElement?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ) ?? [],
    );
    const firstElement = focusableElements.at(0);
    const lastElement = focusableElements.at(-1);
    if (!firstElement || !lastElement) return;

    if (
      event.shiftKey &&
      (document.activeElement === firstElement ||
        document.activeElement === dialogElement)
    ) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
</script>

<div class="modal-layer" class:softui-modal-layer={variant === 'settings'}>
  <div class="modal-backdrop" aria-hidden="true"></div>
  <div
    class="create-workspace-dialog"
    class:create-panel-dialog={variant === 'panel'}
    class:softui-dialog={variant === 'settings'}
    bind:this={dialogElement}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="dialog-heading">
      <div class="dialog-title-group">
        <span
          class="dialog-mark"
          class:dialog-mark--panel={variant === 'panel'}
          aria-hidden="true"
        >
          {@render icon()}
        </span>
        <div>
          <span class="dialog-eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
      </div>
      <button
        class="dialog-close"
        type="button"
        aria-label="Close"
        disabled={busy}
        onclick={onCancel}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5.5 5.5 9 9m0-9-9 9" />
        </svg>
      </button>
    </header>

    <form class="dialog-form" aria-busy={busy} novalidate onsubmit={onSubmit}>
      {@render children()}

      <footer class="dialog-actions">
        <button
          class="secondary-action"
          type="button"
          disabled={busy}
          onclick={onCancel}
        >
          Cancel
        </button>
        <button class="dialog-primary-action" type="submit" disabled={busy}>
          {busy ? submittingLabel : submitLabel}
        </button>
      </footer>
    </form>
  </div>
</div>

<style>
  .modal-layer {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    padding: 48px;
    place-items: center;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgb(12 20 17 / 48%);
    backdrop-filter: blur(4px);
    animation: modal-backdrop-enter 160ms ease-out both;
  }

  .create-workspace-dialog {
    position: relative;
    z-index: 1;
    width: min(468px, calc(100vw - 80px));
    overflow: hidden;
    background: #fafbf8;
    border: 1px solid rgb(255 255 255 / 62%);
    border-radius: 14px;
    box-shadow:
      0 26px 70px rgb(5 13 10 / 28%),
      0 3px 12px rgb(5 13 10 / 16%);
    animation: modal-card-enter 180ms ease-out both;
  }

  .dialog-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 78px;
    padding: 16px 18px 16px 22px;
    background: #f4f6f2;
    border-bottom: 1px solid var(--line);
  }

  .dialog-title-group {
    display: flex;
    align-items: center;
    gap: 13px;
  }

  .dialog-mark {
    display: grid;
    width: 38px;
    height: 38px;
    color: var(--accent);
    background: var(--accent-soft);
    border: 1px solid #c7dcd4;
    border-radius: 10px;
    place-items: center;
  }

  .dialog-mark :global(svg) {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .dialog-eyebrow {
    display: block;
    margin-bottom: 5px;
    color: var(--accent);
    font-size: calc(9px * var(--text-scale));
    font-weight: 720;
    letter-spacing: 0.13em;
    line-height: 1;
    text-transform: uppercase;
  }

  .dialog-heading h2 {
    color: #252c28;
    font-size: calc(18px * var(--text-scale));
    font-weight: 650;
    letter-spacing: -0.018em;
    line-height: 1.1;
  }

  .dialog-close {
    display: grid;
    width: 30px;
    height: 30px;
    padding: 0;
    color: #69716c;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    cursor: pointer;
    place-items: center;
  }

  .dialog-close:hover:not(:disabled) {
    color: #343c37;
    background: #e9ece7;
    border-color: #d9ddd7;
  }

  .dialog-close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.7;
  }

  .dialog-form {
    padding: 22px;
  }

  .dialog-form :global(.dialog-description) {
    max-width: 390px;
    color: #626b65;
    font-size: calc(12px * var(--text-scale));
    line-height: 1.55;
  }

  .dialog-form :global(.dialog-field) {
    margin-top: 20px;
  }

  .dialog-form :global(.dialog-field label) {
    display: block;
    margin-bottom: 8px;
    color: #323a35;
    font-size: calc(12px * var(--text-scale));
    font-weight: 650;
  }

  .dialog-form :global(.dialog-field > p) {
    margin-top: 7px;
    color: #7a827c;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.4;
  }

  .dialog-form :global(.dialog-error) {
    margin-top: 14px;
    padding: 9px 11px;
    color: #8f3535;
    background: #fbefed;
    border: 1px solid #efd2cd;
    border-radius: 7px;
    font-size: calc(11px * var(--text-scale));
    line-height: 1.45;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 24px;
  }

  .secondary-action,
  .dialog-primary-action {
    height: 36px;
    padding: 0 15px;
    border-radius: 8px;
    cursor: pointer;
    font-size: calc(11px * var(--text-scale));
    font-weight: 650;
  }

  .secondary-action {
    color: #4f5852;
    background: #f8f9f6;
    border: 1px solid #cfd4ce;
  }

  .secondary-action:hover:not(:disabled) {
    background: #f0f2ee;
    border-color: #bcc3bd;
  }

  .dialog-primary-action {
    min-width: 126px;
    color: #f8fbf9;
    background: var(--accent);
    border: 1px solid #2f675a;
    box-shadow: 0 4px 11px rgb(39 82 71 / 13%);
  }

  .dialog-primary-action:hover:not(:disabled) {
    background: #2f6b5d;
  }

  .dialog-close:focus-visible,
  .secondary-action:focus-visible,
  .dialog-primary-action:focus-visible {
    outline: 3px solid rgb(82 145 128 / 25%);
    outline-offset: 2px;
  }

  .dialog-close:disabled,
  .secondary-action:disabled,
  .dialog-primary-action:disabled,
  .dialog-form :global(input:disabled) {
    cursor: wait;
    opacity: 0.66;
  }

  /* Account and public-profile dialogs use the same SoftUI surface language
     as Mi and Agordoj. The workspace/panel dialogs keep their existing
     treatment, while this variant provides a reusable private-settings shell. */
  .softui-modal-layer {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-danger: #c95667;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-raised: 0 17px 38px var(--sui-shadow-color), -7px -7px 18px rgb(255 255 255 / 48%);
    --sui-shadow-raised-sm: 0 5px 12px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 50%);
    --sui-shadow-inset: inset 3px 3px 8px rgb(39 51 67 / 17%), inset -3px -3px 7px rgb(255 255 255 / 50%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
  }

  :global(html[data-theme='dark']) .softui-modal-layer {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-danger: #e28a9e;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-raised: 0 18px 40px var(--sui-shadow-color);
    --sui-shadow-raised-sm: 0 6px 14px rgb(0 0 0 / 37%);
    --sui-shadow-inset: inset 3px 3px 8px rgb(0 0 0 / 32%), inset -3px -3px 7px rgb(255 255 255 / 4%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  .softui-modal-layer .modal-backdrop {
    background: rgb(35 44 61 / 52%);
    backdrop-filter: blur(7px);
  }

  .softui-dialog {
    display: flex;
    flex-direction: column;
    width: min(468px, calc(100vw - 80px));
    max-height: min(680px, calc(100vh - 64px));
    overflow: hidden;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 24px;
    box-shadow: var(--sui-shadow-raised);
  }

  .softui-dialog .dialog-heading {
    flex: 0 0 auto;
    min-height: 66px;
    padding: 13px 17px 13px 19px;
    background: linear-gradient(145deg, var(--sui-bg-light), var(--sui-bg));
    border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 16%, transparent);
  }

  .softui-dialog .dialog-title-group { gap: 11px; }
  .softui-dialog .dialog-mark {
    width: 42px;
    height: 42px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 14px;
    box-shadow: var(--sui-shadow-inset-sm);
  }
  .softui-dialog .dialog-eyebrow { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); }
  .softui-dialog .dialog-heading h2 { color: var(--sui-text); font-size: calc(17px * var(--text-scale)); font-weight: 730; }
  .softui-dialog .dialog-close {
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border: 0;
    border-radius: 50%;
    box-shadow: var(--sui-shadow-raised-sm);
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .softui-dialog .dialog-close:hover:not(:disabled) { color: var(--sui-primary); background: var(--sui-bg); border: 0; box-shadow: var(--sui-shadow-inset-sm); transform: translateY(-1px); }
  .softui-dialog .dialog-close:active:not(:disabled) { transform: translateY(1px); }

  .softui-dialog .dialog-form {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 18px 20px 20px;
    scrollbar-color: color-mix(in srgb, var(--sui-primary) 48%, transparent) transparent;
  }
  .softui-dialog .dialog-form :global(.dialog-description) { max-width: none; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); line-height: 1.5; }
  .softui-dialog .dialog-form :global(.dialog-field) { margin-top: 16px; }
  .softui-dialog .dialog-form :global(.dialog-field label) { margin-bottom: 7px; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .softui-dialog .dialog-form :global(.dialog-field > p) { margin-top: 6px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .softui-dialog .dialog-form :global(input),
  .softui-dialog .dialog-form :global(textarea) {
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 11px;
    box-shadow: var(--sui-shadow-inset-sm);
    outline: 0;
    font: inherit;
    font-size: calc(10px * var(--text-scale));
    transition: box-shadow 140ms ease;
  }
  .softui-dialog .dialog-form :global(input) { height: 39px; }
  .softui-dialog .dialog-form :global(textarea) { min-height: 94px; resize: vertical; line-height: 1.5; }
  .softui-dialog .dialog-form :global(input:focus),
  .softui-dialog .dialog-form :global(textarea:focus) { box-shadow: var(--sui-shadow-inset-sm), 0 0 0 3px color-mix(in srgb, var(--sui-primary) 18%, transparent); }
  .softui-dialog .dialog-form :global(input::placeholder),
  .softui-dialog .dialog-form :global(textarea::placeholder) { color: var(--sui-text-light); opacity: .76; }
  .softui-dialog .dialog-form :global(.dialog-error) { margin-top: 12px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); }
  .softui-dialog .dialog-actions { margin-top: 19px; padding-top: 15px; border-top: 1px solid color-mix(in srgb, var(--sui-text-light) 16%, transparent); }
  .softui-dialog .secondary-action,
  .softui-dialog .dialog-primary-action {
    height: 37px;
    border: 0;
    border-radius: 11px;
    box-shadow: var(--sui-shadow-raised-sm);
    font-size: calc(10px * var(--text-scale));
    transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .softui-dialog .secondary-action { color: var(--sui-text-muted); background: var(--sui-bg); }
  .softui-dialog .secondary-action:hover:not(:disabled) { color: var(--sui-primary); background: var(--sui-bg); border: 0; transform: translateY(-1px); }
  .softui-dialog .secondary-action:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .softui-dialog .dialog-primary-action { color: #fff; background: var(--sui-primary); border: 0; box-shadow: 4px 4px 12px color-mix(in srgb, var(--sui-primary) 35%, transparent); }
  .softui-dialog .dialog-primary-action:hover:not(:disabled) { color: #fff; background: var(--sui-primary-hover); transform: translateY(-1px); }
  .softui-dialog .dialog-primary-action:active:not(:disabled) { box-shadow: var(--sui-shadow-inset); transform: translateY(1px); }

  @media (max-width: 560px) {
    .softui-modal-layer { padding: 24px; }
    .softui-dialog { width: min(100%, 468px); max-height: calc(100vh - 48px); border-radius: 20px; }
    .softui-dialog .dialog-form { padding: 16px; }
  }

  @keyframes modal-backdrop-enter {
    from {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }

  @keyframes modal-card-enter {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-backdrop,
    .create-workspace-dialog {
      animation: none;
    }
  }
</style>
