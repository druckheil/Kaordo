<script lang="ts">
  type Props = {
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onJoin: (inviteCode: string) => void | Promise<void>;
  };

  let { busy, error, onCancel, onJoin }: Props = $props();
  let inviteCode = $state('');
  let canSubmit = $derived(!busy && inviteCode.trim().length >= 10);

  function submit() {
    if (canSubmit) void onJoin(inviteCode.trim());
  }
</script>

<main class="join-shell">
  <form aria-labelledby="join-space-title" onsubmit={(event) => { event.preventDefault(); submit(); }}>
    <div class="join-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 5h9v14H5zM10 12h9m-3.5-3.5L19 12l-3.5 3.5" /></svg>
    </div>
    <span class="eyebrow">Invitation</span>
    <h2 id="join-space-title">Join a Space</h2>
    <p>Enter an invite code from a Space member.</p>

    <label>
      <span>Invite code</span>
      <input bind:value={inviteCode} type="text" autocomplete="off" maxlength="18" placeholder="RND-XXXXX-XXXXX" />
    </label>

    {#if error}<div class="form-error" role="alert">{error}</div>{/if}

    <footer>
      <button class="secondary" type="button" disabled={busy} onclick={onCancel}>Cancel</button>
      <button class="primary" type="submit" disabled={!canSubmit}>{busy ? 'Joining…' : 'Join Space'}</button>
    </footer>
  </form>
</main>

<style>
  .join-shell { display: grid; min-width: 0; min-height: 0; padding: 24px; overflow-y: auto; background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--rondo-primary, #5b54e0) 10%, transparent), transparent 34%), var(--rondo-bg, var(--canvas)); place-items: center; }
  form { width: min(460px, 100%); padding: 34px; color: var(--rondo-text, #2d3748); background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4)); border: 0; border-radius: 24px; box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%), -5px -5px 13px rgb(255 255 255 / 56%)); text-align: center; }
  .join-mark { display: grid; width: 56px; height: 56px; margin: 0 auto 20px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 17px; box-shadow: var(--rondo-shadow-inset), var(--rondo-shadow-raised-sm); place-items: center; }
  .join-mark svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
  .eyebrow { color: var(--rondo-primary, #5b54e0); font-size: calc(9px * var(--text-scale)); font-weight: 780; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 9px; color: var(--rondo-text, #2d3748); font-size: calc(27px * var(--text-scale)); font-weight: 740; letter-spacing: -.04em; }
  p { margin-top: 9px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(11px * var(--text-scale)); }
  label { display: grid; gap: 8px; margin-top: 28px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(10px * var(--text-scale)); font-weight: 700; text-align: left; }
  input { width: 100%; height: 48px; padding: 0 14px; color: var(--rondo-text, #2d3748); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 12px; outline: none; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%), inset -2px -2px 5px rgb(255 255 255 / 50%)); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: calc(14px * var(--text-scale)); font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
  input:focus { box-shadow: var(--rondo-shadow-inset-sm), 0 0 0 3px color-mix(in srgb, var(--rondo-primary, #5b54e0) 18%, transparent); }
  .form-error { margin-top: 14px; padding: 10px 12px; color: var(--rondo-danger, #c75b68); background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, var(--rondo-surface, #e8edf4)); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(10px * var(--text-scale)); text-align: left; }
  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
  button { height: 38px; padding: 0 17px; border-radius: 10px; cursor: pointer; font-size: calc(11px * var(--text-scale)); font-weight: 680; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  .secondary { color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm); transition: box-shadow 140ms ease, transform 140ms ease; }
  .secondary:hover:not(:disabled) { transform: translateY(-1px); }
  .secondary:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
  .primary { color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 12px; box-shadow: 5px 6px 13px rgb(74 68 196 / 25%), -3px -3px 8px rgb(255 255 255 / 45%); transition: box-shadow 140ms ease, transform 140ms ease; }
  .primary:hover:not(:disabled) { transform: translateY(-1px); }
  .primary:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
</style>
