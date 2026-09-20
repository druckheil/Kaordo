<script lang="ts">
  type Props = {
    action: 'ban' | 'erase' | 'reset-seed';
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
    username: string;
  };

  let { action, busy, error, onCancel, onConfirm, username }: Props = $props();
  let title = $derived(action === 'erase' ? 'Erase account' : action === 'reset-seed' ? 'Reset sign-in seed' : 'Ban account');
  let description = $derived(action === 'erase'
    ? `This permanently removes ${username}'s account, conversations, spaces and stored payloads from every Nodo. Offline Nodos will finish the cleanup when they reconnect.`
    : action === 'reset-seed'
      ? `${username}'s current sign-in seed will stop working immediately. They can show one new seed from Agordoj.`
      : `${username} will be signed out and blocked from every Kaordo action until an administrator unbans the account.`);
  let submitLabel = $derived(action === 'erase' ? 'Erase everything' : action === 'reset-seed' ? 'Reset seed' : 'Ban user');
</script>

<div class="modal-layer" role="presentation">
  <div class="modal-backdrop" aria-hidden="true"></div>
  <div class="action-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-action-title" aria-describedby="admin-action-description" tabindex="-1">
    <header>
      <span class:danger={action === 'erase'} class="action-icon" aria-hidden="true">{action === 'erase' ? '×' : action === 'reset-seed' ? '↻' : '!'}</span>
      <div>
        <span class="eyebrow">User moderation</span>
        <h2 id="admin-action-title">{title}</h2>
      </div>
      <button class="close" type="button" aria-label="Close" disabled={busy} onclick={onCancel}>×</button>
    </header>
    <div class="body">
      <p id="admin-action-description">{description}</p>
      {#if action === 'erase'}
        <p class="warning"><strong>This cannot be undone.</strong> The account is kept suspended only until every reachable Nodo confirms deletion.</p>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
    <footer>
      <button class="secondary" type="button" disabled={busy} onclick={onCancel}>Cancel</button>
      <button class:danger-button={action === 'erase'} class="primary" type="button" disabled={busy} onclick={onConfirm}>
        {#if busy}<span class="spinner" aria-hidden="true"></span>{/if}{busy ? 'Working…' : submitLabel}
      </button>
    </footer>
  </div>
</div>

<style>
  .modal-layer {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-raised: 7px 8px 20px var(--sui-shadow-color);
    --sui-shadow-raised-sm: 3px 4px 9px var(--sui-shadow-color);
    --sui-shadow-raised-lg: 16px 20px 46px var(--sui-shadow-color);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-color);
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-danger: #c95667;
    --sui-warning: #b7793e;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-danger-bg: color-mix(in srgb, var(--sui-danger) 8%, var(--sui-bg));
    --sui-warning-bg: color-mix(in srgb, var(--sui-warning) 9%, var(--sui-bg));
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    padding: 24px;
    place-items: center;
  }
  .modal-backdrop { position: absolute; inset: 0; background: rgb(45 55 72 / 48%); backdrop-filter: blur(5px); }
  .action-dialog { position: relative; width: min(470px, calc(100vw - 48px)); overflow: hidden; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 22px; box-shadow: var(--sui-shadow-raised-lg); animation: modal-in 160ms ease-out both; }
  header { display: flex; align-items: center; gap: 12px; padding: 20px; background: var(--sui-bg-light); border-bottom: 1px solid color-mix(in srgb, var(--sui-text) 8%, transparent); }
  .action-icon { display: grid; width: 42px; height: 42px; flex: none; color: var(--sui-warning); background: var(--sui-warning-bg); border-radius: 13px; box-shadow: var(--sui-shadow-inset-sm); font-size: 24px; font-weight: 700; place-items: center; }
  .action-icon.danger { color: var(--sui-danger); background: var(--sui-danger-bg); }
  .eyebrow { color: var(--sui-primary); font-size: 9px; font-weight: 780; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 3px; color: var(--sui-text); font-size: 21px; letter-spacing: -.035em; }
  .close { display: grid; width: 38px; height: 38px; margin-left: auto; padding: 0; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: 24px; line-height: 1; place-items: center; transition: color 140ms ease, transform 140ms ease, box-shadow 140ms ease; }
  .close:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .close:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .body { padding: 22px 22px 8px; color: var(--sui-text-muted); font-size: 13px; line-height: 1.55; }
  .warning { margin-top: 13px; padding: 11px 12px; color: color-mix(in srgb, var(--sui-warning) 82%, var(--sui-text)); background: var(--sui-warning-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); font-size: 12px; }
  .error { margin-top: 12px; padding: 10px 11px; color: var(--sui-danger); background: var(--sui-danger-bg); border-radius: 10px; box-shadow: var(--sui-shadow-inset-sm); font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 9px; padding: 15px 22px 20px; border-top: 1px solid color-mix(in srgb, var(--sui-text) 8%, transparent); }
  footer button { min-height: 37px; padding: 0 15px; border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: 12px; font-weight: 720; transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease; }
  footer button:hover:not(:disabled) { transform: translateY(-1px); }
  footer button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .secondary { color: var(--sui-text-muted); background: var(--sui-bg); }
  .primary { display: inline-flex; align-items: center; gap: 7px; color: #fff; background: var(--sui-primary); }
  .primary:hover:not(:disabled) { background: var(--sui-primary-hover); }
  .danger-button { background: var(--sui-danger); }
  button:disabled { cursor: wait; opacity: .62; }
  .spinner { width: 12px; height: 12px; border: 2px solid rgb(255 255 255 / 42%); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  :global(html[data-theme='dark']) .modal-layer {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-color: rgb(0 0 0 / 44%);
    --sui-shadow-raised: 7px 8px 20px var(--sui-shadow-color);
    --sui-shadow-raised-sm: 3px 4px 9px var(--sui-shadow-color);
    --sui-shadow-raised-lg: 16px 20px 46px var(--sui-shadow-color);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-color);
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-danger: #e28a9e;
    --sui-warning: #e0b477;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-danger-bg: #38272d;
    --sui-warning-bg: #342d25;
  }
  :global(html[data-theme='dark']) .modal-backdrop { background: rgb(10 12 18 / 62%); }
  :global(html[data-theme='dark']) .action-dialog { color: var(--sui-text); background: var(--sui-bg); border-color: transparent; box-shadow: var(--sui-shadow-raised-lg); }
  :global(html[data-theme='dark']) .action-dialog header { background: var(--sui-bg-light); border-color: color-mix(in srgb, var(--sui-text) 8%, transparent); }
  :global(html[data-theme='dark']) .action-dialog footer { border-color: color-mix(in srgb, var(--sui-text) 8%, transparent); }
  @keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
