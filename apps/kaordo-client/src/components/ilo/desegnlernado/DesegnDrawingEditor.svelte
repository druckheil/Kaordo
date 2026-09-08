<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DESEGN_FOCUSES,
    type DesegnDrawing,
    type DesegnDrawingPatch,
  } from '../../../lib/domain/desegnLernado';

  type Props = {
    busy: boolean;
    drawing: Readonly<DesegnDrawing>;
    onClose: () => void;
    onDelete: () => void;
    onSave: (patch: DesegnDrawingPatch) => Promise<boolean>;
  };

  let { busy, drawing, onClose, onDelete, onSave }: Props = $props();
  let sourceId = $state('');
  let title = $state('');
  let description = $state('');
  let focus = $state<(typeof DESEGN_FOCUSES)[number]>('other');
  let rating = $state<number | null>(null);
  let shortcomings = $state<string[]>([]);
  let formError = $state('');

  $effect(() => {
    if (sourceId === drawing.id) return;
    sourceId = drawing.id;
    title = drawing.title;
    description = drawing.description;
    focus = drawing.focus;
    rating = drawing.rating;
    shortcomings = [...drawing.shortcomings];
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  function updateShortcoming(index: number, value: string): void {
    shortcomings = shortcomings.map((item, itemIndex) => itemIndex === index ? value : item);
  }

  function removeShortcoming(index: number): void {
    shortcomings = shortcomings.filter((_, itemIndex) => itemIndex !== index);
  }

  function addShortcoming(): void {
    if (shortcomings.length >= 20) return;
    shortcomings = [...shortcomings, ''];
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    formError = '';
    if (!title.trim()) {
      formError = 'Give this drawing a short title.';
      return;
    }
    const saved = await onSave({ description, focus, rating, shortcomings, title });
    if (saved) onClose();
  }
</script>

<div class="editor-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
  <div class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="drawing-editor-title">
    <header>
      <span class="editor-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5zM14.8 6.5l2.7 2.7M5 19h14"/></svg>
      </span>
      <div><span class="eyebrow">Studio notes</span><h2 id="drawing-editor-title">Reflect on this drawing</h2><p>Keep observations concrete so the next attempt has a direction.</p></div>
      <button class="close-button" type="button" disabled={busy} onclick={onClose} aria-label="Close drawing notes">×</button>
    </header>

    <form onsubmit={submit}>
      <div class="form-grid">
        <label class="wide"><span>Title</span><input maxlength="100" bind:value={title} placeholder="Untitled drawing" /></label>
        <label><span>Practice focus</span><select bind:value={focus}>{#each DESEGN_FOCUSES as item}<option value={item}>{focusLabel(item)}</option>{/each}</select></label>
        <fieldset class="rating-field">
          <legend>How does it feel?</legend>
          <div>{#each [1, 2, 3, 4, 5] as value}<button class:active={rating !== null && value <= rating} type="button" onclick={() => { rating = rating === value ? null : value; }} aria-label={`Rate ${value} out of 5`} aria-pressed={rating !== null && value <= rating}>★</button>{/each}</div>
        </fieldset>
        <label class="wide"><span>Description <small>{description.length}/2000</small></span><textarea maxlength="2000" rows="4" bind:value={description} placeholder="What did you practise? What worked better than before?"></textarea></label>
      </div>

      <section class="shortcomings-panel" aria-labelledby="shortcomings-title">
        <header><div><span class="eyebrow">Next attempt</span><h3 id="shortcomings-title">Shortcomings to revisit</h3></div><button type="button" disabled={shortcomings.length >= 20} onclick={addShortcoming}>+ Add point</button></header>
        {#if shortcomings.length === 0}
          <button class="empty-shortcomings" type="button" onclick={addShortcoming}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>
            Add one specific observation — for example “hands feel too flat”.
          </button>
        {:else}
          <div class="shortcoming-list">
            {#each shortcomings as item, index}
              <label><b>{String(index + 1).padStart(2, '0')}</b><input maxlength="300" value={item} oninput={(event) => updateShortcoming(index, event.currentTarget.value)} placeholder="A concrete thing to improve" /><button type="button" onclick={() => removeShortcoming(index)} aria-label={`Remove point ${index + 1}`}>×</button></label>
            {/each}
          </div>
        {/if}
      </section>

      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
      <footer>
        <button class="delete-button" type="button" disabled={busy} onclick={onDelete}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M7 6V4h6v2M6.5 8l.6 8h5.8l.6-8"/></svg>
          Delete drawing
        </button>
        <span></span>
        <button type="button" disabled={busy} onclick={onClose}>Cancel</button>
        <button class="save-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save reflection'}</button>
      </footer>
    </form>
  </div>
</div>

<script lang="ts" module>
  function focusLabel(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<style>
  .editor-backdrop { position: fixed; z-index: 240; display: grid; inset: 0; padding: 24px; overflow: auto; background: rgb(39 46 66 / 52%); backdrop-filter: blur(9px); place-items: center; animation: fade-in 160ms ease; }
  .editor-dialog { width: min(760px, 100%); max-height: calc(100vh - 48px); padding: 24px; overflow: auto; color: var(--sui-text); background: var(--sui-bg); border-radius: 24px; box-shadow: 18px 18px 42px rgb(35 44 62 / 34%), -8px -8px 24px rgb(255 255 255 / 20%); animation: dialog-in 220ms cubic-bezier(.2, .8, .2, 1); }
  .editor-dialog > header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 15px; padding-bottom: 18px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 16%, transparent); }
  .editor-mark { display: grid; width: 52px; height: 52px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-shadow-inset); place-items: center; }
  .editor-mark svg { width: 27px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .eyebrow { color: var(--sui-primary); font-size: calc(7px * var(--text-scale)); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin: 4px 0 0; color: var(--sui-text); font-size: calc(18px * var(--text-scale)); letter-spacing: -.025em; }
  header p { margin: 4px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  button { font: inherit; }
  .close-button { width: 38px; height: 38px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: 22px; }
  form { margin-top: 19px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  label, fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  label > span, legend { display: flex; justify-content: space-between; margin: 0 4px 7px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); font-weight: 710; }
  label small { color: var(--sui-text-light); font-weight: 600; }
  .wide { grid-column: 1 / -1; }
  input, select, textarea { box-sizing: border-box; width: 100%; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); font: inherit; font-size: calc(9px * var(--text-scale)); outline: 0; }
  input, select { height: 43px; padding: 0 13px; }
  textarea { min-height: 112px; padding: 12px 13px; overflow-x: hidden; overflow-wrap: anywhere; line-height: 1.5; resize: vertical; white-space: pre-wrap; }
  input:focus, select:focus, textarea:focus { box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--sui-primary) 34%, transparent); }
  .rating-field > div { display: flex; align-items: center; justify-content: space-around; height: 43px; padding: 0 7px; background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); }
  .rating-field button { padding: 3px; color: color-mix(in srgb, var(--sui-text-light) 36%, transparent); background: transparent; border: 0; cursor: pointer; font-size: 20px; transition: color 140ms ease, transform 140ms ease; }
  .rating-field button:hover, .rating-field button.active { color: #e3a83d; transform: translateY(-1px) scale(1.06); }
  .shortcomings-panel { margin-top: 18px; padding: 16px; background: color-mix(in srgb, var(--sui-primary) 4%, var(--sui-bg)); border-radius: 17px; box-shadow: var(--sui-shadow-inset-sm); }
  .shortcomings-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h3 { margin: 3px 0 0; color: var(--sui-text); font-size: calc(11px * var(--text-scale)); }
  .shortcomings-panel header button, .empty-shortcomings { color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 720; }
  .shortcomings-panel header button { height: 34px; padding: 0 11px; }
  .empty-shortcomings { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 60px; margin-top: 13px; padding: 10px; color: var(--sui-text-muted); }
  .empty-shortcomings svg { width: 17px; fill: none; stroke: var(--sui-primary); stroke-width: 1.5; }
  .shortcoming-list { display: grid; gap: 8px; margin-top: 13px; }
  .shortcoming-list label { display: grid; grid-template-columns: 30px minmax(0, 1fr) 32px; align-items: center; gap: 7px; }
  .shortcoming-list b { color: var(--sui-primary); font-size: calc(7px * var(--text-scale)); text-align: center; }
  .shortcoming-list input { height: 38px; background: var(--sui-bg-light); }
  .shortcoming-list button { width: 30px; height: 30px; color: var(--sui-danger); background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: 18px; }
  .form-error { margin: 12px 2px 0; color: var(--sui-danger); font-size: calc(8px * var(--text-scale)); }
  footer { display: grid; grid-template-columns: auto 1fr auto auto; gap: 9px; margin-top: 19px; padding-top: 17px; border-top: 1px solid color-mix(in srgb, var(--sui-text-light) 16%, transparent); }
  footer button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 40px; padding: 0 15px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 730; }
  footer button:active:not(:disabled), .close-button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); }
  footer svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  footer .delete-button { color: var(--sui-danger); }
  footer .save-button { min-width: 140px; color: #fff; background: linear-gradient(145deg, var(--sui-primary), var(--sui-primary-hover)); box-shadow: 0 8px 18px color-mix(in srgb, var(--sui-primary) 28%, transparent); }
  button:disabled { cursor: progress; opacity: .55; }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes dialog-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }
  @media (max-width: 680px) { .form-grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } footer { grid-template-columns: 1fr 1fr; } footer span { display: none; } .delete-button { grid-column: 1 / -1; } }
  @media (prefers-reduced-motion: reduce) { .editor-backdrop, .editor-dialog { animation: none; } }
</style>
