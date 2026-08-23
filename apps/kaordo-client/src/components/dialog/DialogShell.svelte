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
    variant?: 'workspace' | 'object';
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

<div class="modal-layer">
  <div class="modal-backdrop" aria-hidden="true"></div>
  <div
    class="create-workspace-dialog"
    class:create-object-dialog={variant === 'object'}
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
          class:dialog-mark--object={variant === 'object'}
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
