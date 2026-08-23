<script lang="ts">
  type Props = {
    action: 'ban' | 'erase';
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
    username: string;
  };

  let { action, busy, error, onCancel, onConfirm, username }: Props = $props();
  let title = $derived(action === 'erase' ? 'Erase account' : 'Ban account');
  let description = $derived(action === 'erase'
    ? `This permanently removes ${username}'s account, conversations, spaces and stored payloads from every Nodo. Offline Nodos will finish the cleanup when they reconnect.`
    : `${username} will be signed out and blocked from every Kaordo action until an administrator unbans the account.`);
  let submitLabel = $derived(action === 'erase' ? 'Erase everything' : 'Ban user');
</script>

<div class="modal-layer" role="presentation">
  <div class="modal-backdrop" aria-hidden="true"></div>
  <div class="action-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-action-title" aria-describedby="admin-action-description" tabindex="-1">
    <header>
      <span class:danger={action === 'erase'} class="action-icon" aria-hidden="true">{action === 'erase' ? '×' : '!'}</span>
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
  .modal-layer { position: fixed; inset: 0; z-index: 120; display: grid; padding: 24px; place-items: center; }
  .modal-backdrop { position: absolute; inset: 0; background: rgb(12 20 17 / 48%); backdrop-filter: blur(5px); }
  .action-dialog { position: relative; width: min(470px, calc(100vw - 48px)); overflow: hidden; color: #26352d; background: #fbfcfa; border: 1px solid #d6e1da; border-radius: 16px; box-shadow: 0 28px 80px rgb(7 18 13 / 28%); animation: modal-in 160ms ease-out both; }
  header { display: flex; align-items: center; gap: 12px; padding: 20px; background: #f1f6f2; border-bottom: 1px solid #dfe8e1; }
  .action-icon { display: grid; width: 38px; height: 38px; color: #8b6423; background: #f6ead3; border-radius: 11px; font-size: 24px; font-weight: 700; place-items: center; }
  .action-icon.danger { color: #a94b45; background: #f8e0dc; }
  .eyebrow { color: #5b8977; font-size: 9px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 3px; font-size: 21px; letter-spacing: -.035em; }
  .close { margin-left: auto; padding: 2px 6px; color: #7e8b83; background: transparent; border: 0; cursor: pointer; font-size: 24px; line-height: 1; }
  .body { padding: 22px 22px 8px; color: #617168; font-size: 13px; line-height: 1.55; }
  .warning { margin-top: 13px; padding: 11px 12px; color: #81504b; background: #fbefed; border: 1px solid #f0d4d0; border-radius: 9px; font-size: 12px; }
  .error { margin-top: 12px; padding: 9px 10px; color: #9b4b43; background: #fbeceb; border-radius: 8px; font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 9px; padding: 15px 22px 20px; }
  footer button { min-height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer; font-size: 12px; font-weight: 680; }
  .secondary { color: #4c6659; background: #fff; border: 1px solid #ccd9d0; }
  .primary { display: inline-flex; align-items: center; gap: 7px; color: #fff; background: #3b7d65; border: 1px solid #326b57; }
  .danger-button { background: #b75b52; border-color: #9f4d45; }
  button:disabled { cursor: wait; opacity: .62; }
  .spinner { width: 12px; height: 12px; border: 2px solid rgb(255 255 255 / 42%); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
