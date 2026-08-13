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
  .join-shell { display: grid; min-width: 0; min-height: 0; padding: 38px; overflow-y: auto; background: radial-gradient(circle at 50% 42%, rgb(74 137 118 / 8%), transparent 30%), var(--canvas); place-items: center; }
  form { width: min(460px, 100%); padding: 36px; color: #2b3731; background: rgb(255 255 255 / 88%); border: 1px solid #d5ded8; border-radius: 22px; box-shadow: 0 22px 54px rgb(41 70 58 / 9%); text-align: center; }
  .join-mark { display: grid; width: 52px; height: 52px; margin: 0 auto 20px; color: #4b8877; background: #e8f2ed; border: 1px solid #cce0d7; border-radius: 16px; place-items: center; }
  .join-mark svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
  .eyebrow { color: var(--accent); font-size: calc(9px * var(--text-scale)); font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 9px; color: #24312b; font-size: calc(27px * var(--text-scale)); font-weight: 690; letter-spacing: -.035em; }
  p { margin-top: 9px; color: #7c8780; font-size: calc(11px * var(--text-scale)); }
  label { display: grid; gap: 8px; margin-top: 28px; color: #59665e; font-size: calc(10px * var(--text-scale)); font-weight: 680; text-align: left; }
  input { width: 100%; height: 46px; padding: 0 14px; color: #27342e; background: #fafcf9; border: 1px solid #cbd6cf; border-radius: 11px; outline: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: calc(14px * var(--text-scale)); font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
  input:focus { border-color: #6fa28f; box-shadow: 0 0 0 3px rgb(71 132 111 / 10%); }
  .form-error { margin-top: 14px; padding: 10px 12px; color: #9b473d; background: #fff2ef; border: 1px solid #edc9c2; border-radius: 10px; font-size: calc(10px * var(--text-scale)); text-align: left; }
  footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; }
  button { height: 38px; padding: 0 17px; border-radius: 10px; cursor: pointer; font-size: calc(11px * var(--text-scale)); font-weight: 680; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  .secondary { color: #647068; background: #f6f8f5; border: 1px solid #d5dcd7; }
  .primary { color: #f8fcfa; background: var(--accent); border: 1px solid #2f6a5b; box-shadow: 0 8px 18px rgb(46 102 84 / 16%); }
</style>
