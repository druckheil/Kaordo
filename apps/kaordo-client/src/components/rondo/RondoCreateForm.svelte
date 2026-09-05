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
    padding: 24px clamp(22px, 5vw, 72px);
    overflow-y: auto;
    background:
      radial-gradient(circle at 72% 8%, color-mix(in srgb, var(--rondo-primary, #5b54e0) 10%, transparent), transparent 30%),
      var(--rondo-bg, var(--canvas));
  }

  .rondo-form {
    width: min(720px, 100%);
    margin: 0 auto;
    padding: 30px;
    color: var(--rondo-text, #2d3748);
    background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4));
    border: 0;
    border-radius: 24px;
    box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%), -5px -5px 13px rgb(255 255 255 / 56%));
  }

  header { margin-bottom: 28px; }
  .eyebrow { color: var(--rondo-primary, #5b54e0); font-size: calc(9px * var(--text-scale)); font-weight: 780; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 9px; color: var(--rondo-text, #2d3748); font-size: calc(27px * var(--text-scale)); font-weight: 740; letter-spacing: -.04em; }
  header p { margin-top: 9px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(12px * var(--text-scale)); line-height: 1.55; }

  .fields { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 16px; }
  .fields label { position: relative; display: grid; align-content: start; gap: 8px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .fields label > span { display: flex; justify-content: space-between; }
  .fields i { color: var(--rondo-text-light, #7b8ca3); font-size: calc(9px * var(--text-scale)); font-style: normal; font-weight: 560; }
  input[type='text'], textarea {
    width: 100%; color: var(--rondo-text, #2d3748); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 12px; outline: none; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%), inset -2px -2px 5px rgb(255 255 255 / 50%));
    font-size: calc(12px * var(--text-scale)); transition: border-color 130ms ease, box-shadow 130ms ease;
  }
  input[type='text'] { height: 42px; padding: 0 12px; }
  textarea { min-height: 78px; padding: 11px 12px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus { box-shadow: var(--rondo-shadow-inset-sm), 0 0 0 3px color-mix(in srgb, var(--rondo-primary, #5b54e0) 18%, transparent); }
  .fields small { position: absolute; right: 10px; bottom: 8px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); font-weight: 560; }

  fieldset { display: grid; gap: 9px; margin: 28px 0 0; padding: 0; border: 0; }
  legend { color: var(--rondo-text-muted, #5c6d84); font-size: calc(10px * var(--text-scale)); font-weight: 720; }
  .storage-note { margin: -3px 0 5px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .storage-card {
    display: grid; grid-template-columns: 42px minmax(0, 1fr) 18px; align-items: center; gap: 13px; min-height: 72px; padding: 12px 14px;
    background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 15px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); cursor: pointer; transition: color 130ms ease, box-shadow 130ms ease, transform 130ms ease;
  }
  .storage-card:hover:not(.storage-card--disabled) { color: var(--rondo-primary, #5b54e0); transform: translateY(-1px); }
  .storage-card--selected { color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg-dark, #d1d9e6); box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%), inset -2px -2px 5px rgb(255 255 255 / 50%)); }
  .storage-card--disabled { cursor: not-allowed; opacity: .52; }
  .storage-card > input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .storage-icon { display: grid; width: 40px; height: 40px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg, #e4e9f0); border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); place-items: center; }
  .public-icon { color: var(--rondo-success, #2d9f75); }
  .storage-icon svg { width: 21px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .storage-copy { display: grid; gap: 3px; min-width: 0; }
  .storage-copy strong { color: var(--rondo-text, #2d3748); font-size: calc(11px * var(--text-scale)); font-weight: 740; }
  .storage-copy > span { color: var(--rondo-text-muted, #5c6d84); font-size: calc(10px * var(--text-scale)); }
  .storage-copy small { color: var(--rondo-text-light, #7b8ca3); font-size: calc(9px * var(--text-scale)); }
  .storage-copy small.offline { color: var(--rondo-danger, #c75b68); }
  .radio-mark { width: 16px; height: 16px; border: 2px solid var(--rondo-text-light, #7b8ca3); border-radius: 50%; box-shadow: inset 0 0 0 4px transparent; }
  .storage-card--selected .radio-mark { background: var(--rondo-primary, #5b54e0); border-color: var(--rondo-primary, #5b54e0); box-shadow: inset 0 0 0 4px var(--rondo-bg-dark, #d1d9e6); }
  .no-private-node { padding: 14px; color: var(--rondo-text-light, #7b8ca3); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 13px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(10px * var(--text-scale)); text-align: center; }

  .form-error { margin-top: 16px; padding: 10px 12px; color: var(--rondo-danger, #c75b68); background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, var(--rondo-surface, #e8edf4)); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(10px * var(--text-scale)); }
  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 20px; border-top: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 20%, transparent); }
  footer button { height: 38px; padding: 0 17px; border-radius: 10px; cursor: pointer; font-size: calc(11px * var(--text-scale)); font-weight: 680; }
  footer button:disabled { cursor: not-allowed; opacity: .5; }
  .secondary { color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm); transition: box-shadow 140ms ease, transform 140ms ease; }
  .secondary:hover:not(:disabled) { transform: translateY(-1px); }
  .secondary:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
  .primary { color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 12px; box-shadow: 5px 6px 13px rgb(74 68 196 / 25%), -3px -3px 8px rgb(255 255 255 / 45%); transition: box-shadow 140ms ease, transform 140ms ease; }
  .primary:hover:not(:disabled) { transform: translateY(-1px); }
  .primary:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }

  @media (max-width: 1120px) { .fields { grid-template-columns: 1fr; } }
</style>
