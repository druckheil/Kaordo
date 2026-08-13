<script lang="ts">
  import type { CreateRondoSpaceInput, RondoPrivateNode } from '../../lib/domain/rondo';

  type Props = {
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onCreate: (input: CreateRondoSpaceInput) => void | Promise<void>;
    privateNodes: RondoPrivateNode[];
    publicOption: { alreadyCreated: boolean; available: boolean; limitBytes: number };
  };

  let { busy, error, onCancel, onCreate, privateNodes, publicOption }: Props = $props();
  let name = $state('');
  let description = $state('');
  let storage = $state<'private' | 'public'>('private');
  let nodeId = $state('');
  let initialized = false;
  let validPrivateNode = $derived(privateNodes.some((node) => node.nodeId === nodeId && node.online && node.availableBytes > 0));
  let canSubmit = $derived(
    !busy && name.trim().length >= 2 && (
      storage === 'public' ? publicOption.available : validPrivateNode
    ),
  );

  $effect(() => {
    if (initialized) return;
    storage = publicOption.available ? 'public' : 'private';
    nodeId = privateNodes.find(({ online, availableBytes }) => online && availableBytes > 0)?.nodeId ?? '';
    initialized = true;
  });

  function submit() {
    if (!canSubmit) return;
    void onCreate({
      description: description.trim(),
      name: name.trim(),
      ...(storage === 'private' ? { nodeId } : {}),
      storage,
    });
  }

  function formatBytes(value: number): string {
    if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(value % 1_073_741_824 ? 1 : 0)} GB`;
    return `${Math.max(0, value / 1_048_576).toFixed(0)} MB`;
  }
</script>

<main class="rondo-form-shell">
  <form class="rondo-form" aria-labelledby="create-space-title" onsubmit={(event) => { event.preventDefault(); submit(); }}>
    <header>
      <span class="eyebrow">New community</span>
      <h2 id="create-space-title">Create a Space</h2>
      <p>Choose its identity and the primary Nodo where its data will live.</p>
    </header>

    <div class="fields">
      <label>
        <span>Space name</span>
        <input bind:value={name} type="text" maxlength="48" minlength="2" placeholder="Design circle" />
        <small>{name.length}/48</small>
      </label>
      <label>
        <span>Description <i>Optional</i></span>
        <textarea bind:value={description} maxlength="180" rows="3" placeholder="What brings everyone together?"></textarea>
        <small>{description.length}/180</small>
      </label>
    </div>

    <fieldset>
      <legend>Primary storage</legend>
      <p class="storage-note">Content follows this Nodo. More nodes and their priority can be configured later.</p>

      <label class="storage-card" class:storage-card--selected={storage === 'public'} class:storage-card--disabled={!publicOption.available}>
        <input
          type="radio"
          name="rondo-storage"
          value="public"
          checked={storage === 'public'}
          disabled={!publicOption.available}
          onchange={() => storage = 'public'}
        />
        <span class="storage-icon public-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="M10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm-5.7-6h11.4M10 4c1.5 1.6 2.3 3.6 2.3 6s-.8 4.4-2.3 6c-1.5-1.6-2.3-3.6-2.3-6S8.5 5.6 10 4Z" /></svg>
        </span>
        <span class="storage-copy">
          <strong>Public Node</strong>
          <span>Shared storage pool · up to {formatBytes(publicOption.limitBytes)}</span>
          <small>{publicOption.alreadyCreated
            ? 'Your free Public Space is already in use.'
            : publicOption.available
              ? 'One free Public Space per account.'
              : 'No Public Node storage is currently available.'}</small>
        </span>
        <span class="radio-mark" aria-hidden="true"></span>
      </label>

      {#each privateNodes as node (node.nodeId)}
        <label
          class="storage-card"
          class:storage-card--selected={storage === 'private' && nodeId === node.nodeId}
          class:storage-card--disabled={!node.online || node.availableBytes <= 0}
        >
          <input
            type="radio"
            name="rondo-storage"
            value={node.nodeId}
            checked={storage === 'private' && nodeId === node.nodeId}
            disabled={!node.online || node.availableBytes <= 0}
            onchange={() => { storage = 'private'; nodeId = node.nodeId; }}
          />
          <span class="storage-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20"><path d="M4 5.5C4 4.7 6.7 4 10 4s6 .7 6 1.5S13.3 7 10 7 4 6.3 4 5.5Zm0 0v4C4 10.3 6.7 11 10 11s6-.7 6-1.5v-4m-12 4v4C4 14.3 6.7 15 10 15s6-.7 6-1.5v-4" /></svg>
          </span>
          <span class="storage-copy">
            <strong>{node.deviceName}</strong>
            <span>Private Nodo · {formatBytes(node.availableBytes)} available</span>
            <small class:offline={!node.online}>{node.online ? 'Online and ready' : 'Offline'}</small>
          </span>
          <span class="radio-mark" aria-hidden="true"></span>
        </label>
      {/each}

      {#if privateNodes.length === 0}
        <div class="no-private-node">No writable private Nodo is configured for this account.</div>
      {/if}
    </fieldset>

    {#if error}<div class="form-error" role="alert">{error}</div>{/if}

    <footer>
      <button class="secondary" type="button" disabled={busy} onclick={onCancel}>Cancel</button>
      <button class="primary" type="submit" disabled={!canSubmit}>{busy ? 'Creating…' : 'Create Space'}</button>
    </footer>
  </form>
</main>

<style>
  .rondo-form-shell {
    min-width: 0;
    min-height: 0;
    padding: 38px clamp(28px, 5vw, 72px);
    overflow-y: auto;
    background:
      radial-gradient(circle at 72% 8%, rgb(74 137 118 / 8%), transparent 28%),
      var(--canvas);
  }

  .rondo-form {
    width: min(720px, 100%);
    margin: 0 auto;
    padding: 32px;
    color: #2b3731;
    background: rgb(255 255 255 / 84%);
    border: 1px solid #d5ded8;
    border-radius: 22px;
    box-shadow: 0 22px 54px rgb(41 70 58 / 9%);
  }

  header { margin-bottom: 28px; }
  .eyebrow { color: var(--accent); font-size: calc(9px * var(--text-scale)); font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 9px; color: #24312b; font-size: calc(27px * var(--text-scale)); font-weight: 690; letter-spacing: -.035em; }
  header p { margin-top: 9px; color: #78837d; font-size: calc(12px * var(--text-scale)); line-height: 1.55; }

  .fields { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 16px; }
  .fields label { position: relative; display: grid; align-content: start; gap: 8px; color: #536159; font-size: calc(10px * var(--text-scale)); font-weight: 680; }
  .fields label > span { display: flex; justify-content: space-between; }
  .fields i { color: #98a29c; font-size: calc(9px * var(--text-scale)); font-style: normal; font-weight: 560; }
  input[type='text'], textarea {
    width: 100%; color: #27342e; background: #fafcf9; border: 1px solid #cfd8d2; border-radius: 11px; outline: none;
    font-size: calc(12px * var(--text-scale)); transition: border-color 130ms ease, box-shadow 130ms ease;
  }
  input[type='text'] { height: 42px; padding: 0 12px; }
  textarea { min-height: 78px; padding: 11px 12px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus { border-color: #6fa28f; box-shadow: 0 0 0 3px rgb(71 132 111 / 10%); }
  .fields small { position: absolute; right: 10px; bottom: 8px; color: #a2aaa5; font-size: calc(8px * var(--text-scale)); font-weight: 560; }

  fieldset { display: grid; gap: 9px; margin: 28px 0 0; padding: 0; border: 0; }
  legend { color: #536159; font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .storage-note { margin: -3px 0 5px; color: #8a948e; font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .storage-card {
    display: grid; grid-template-columns: 42px minmax(0, 1fr) 18px; align-items: center; gap: 13px; min-height: 72px; padding: 12px 14px;
    background: #f9fbf8; border: 1px solid #d6ddd8; border-radius: 14px; cursor: pointer; transition: border-color 130ms ease, background 130ms ease, transform 130ms ease;
  }
  .storage-card:hover:not(.storage-card--disabled) { border-color: #91b5a7; transform: translateY(-1px); }
  .storage-card--selected { background: #eef6f2; border-color: #6d9f8d; box-shadow: inset 0 0 0 1px rgb(55 117 102 / 10%); }
  .storage-card--disabled { cursor: not-allowed; opacity: .52; }
  .storage-card > input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .storage-icon { display: grid; width: 40px; height: 40px; color: #64877a; background: #edf3ef; border-radius: 12px; place-items: center; }
  .public-icon { color: #397a68; background: #e1f0ea; }
  .storage-icon svg { width: 21px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .storage-copy { display: grid; gap: 3px; min-width: 0; }
  .storage-copy strong { color: #334139; font-size: calc(11px * var(--text-scale)); font-weight: 700; }
  .storage-copy > span { color: #707c75; font-size: calc(10px * var(--text-scale)); }
  .storage-copy small { color: #87938c; font-size: calc(9px * var(--text-scale)); }
  .storage-copy small.offline { color: #b36c62; }
  .radio-mark { width: 16px; height: 16px; border: 2px solid #acb8b1; border-radius: 50%; box-shadow: inset 0 0 0 4px transparent; }
  .storage-card--selected .radio-mark { background: var(--accent); border-color: var(--accent); box-shadow: inset 0 0 0 4px #eef6f2; }
  .no-private-node { padding: 14px; color: #87918b; background: #f5f7f4; border: 1px dashed #d5dbd6; border-radius: 12px; font-size: calc(10px * var(--text-scale)); text-align: center; }

  .form-error { margin-top: 16px; padding: 10px 12px; color: #9b473d; background: #fff2ef; border: 1px solid #edc9c2; border-radius: 10px; font-size: calc(10px * var(--text-scale)); }
  footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e0e5e1; }
  footer button { height: 38px; padding: 0 17px; border-radius: 10px; cursor: pointer; font-size: calc(11px * var(--text-scale)); font-weight: 680; }
  footer button:disabled { cursor: not-allowed; opacity: .5; }
  .secondary { color: #647068; background: #f6f8f5; border: 1px solid #d5dcd7; }
  .primary { color: #f8fcfa; background: var(--accent); border: 1px solid #2f6a5b; box-shadow: 0 8px 18px rgb(46 102 84 / 16%); }

  @media (max-width: 1120px) { .fields { grid-template-columns: 1fr; } }
</style>
