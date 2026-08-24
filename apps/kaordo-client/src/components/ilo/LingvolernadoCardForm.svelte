<script lang="ts">
  import { untrack } from 'svelte';
  import type { IloCard, IloCardInput } from '../../lib/domain/ilo';

  type Props = {
    busy: boolean;
    card?: IloCard | null;
    onCancel?: () => void;
    onSubmit: (input: IloCardInput) => Promise<boolean>;
    themes: string[];
  };

  let { busy, card = null, onCancel = undefined, onSubmit, themes }: Props = $props();
  const initialCard = untrack(() => card);
  let german = $state(initialCard?.german ?? '');
  let translation = $state(initialCard?.translation ?? '');
  let theme = $state(initialCard?.theme ?? 'other');
  let article = $state(initialCard?.article ?? '');
  let plural = $state(initialCard?.plural ?? '');
  let example = $state(initialCard?.example ?? '');
  let note = $state(initialCard?.note ?? '');
  let noun = $state(Boolean(initialCard?.article || initialCard?.plural));
  let template = $state('');
  let formError = $state<string | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    if (!german.trim() || !translation.trim()) {
      formError = 'German and translation are required.';
      return;
    }
    formError = null;
    const saved = await onSubmit({
      article: noun ? article.trim() : '',
      example: example.trim(),
      german: german.trim(),
      note: note.trim(),
      plural: noun ? plural.trim() : '',
      theme,
      translation: translation.trim(),
    });
    if (saved && !card) reset();
  }

  function applyTemplate(): void {
    const parts = template.split('||');
    if (parts.length < 7) {
      formError = 'The template needs 7 blocks separated by ||.';
      return;
    }
    const [word, meaning, nextTheme, nounValue, nextArticle, nextPlural, ...exampleParts] = parts;
    if (!word?.trim() || !meaning?.trim()) {
      formError = 'The template needs a German word and translation.';
      return;
    }
    const enabled = /^(1|true|y|yes)$/iu.test(nounValue?.trim() ?? '');
    german = word.trim();
    translation = meaning.trim();
    theme = themes.includes(nextTheme?.trim().toLowerCase() ?? '') ? nextTheme!.trim().toLowerCase() : 'other';
    noun = enabled;
    article = enabled ? optionalTemplate(nextArticle) : '';
    plural = enabled ? optionalTemplate(nextPlural) : '';
    example = exampleParts.join('||').trim();
    formError = null;
  }

  function optionalTemplate(value: string | undefined): string {
    const normalized = value?.trim() ?? '';
    return /^(?:-|_|empty|mock|n\/?a|none|null)$/iu.test(normalized) ? '' : normalized;
  }

  function reset(): void {
    german = '';
    translation = '';
    theme = 'other';
    article = '';
    plural = '';
    example = '';
    note = '';
    noun = false;
    template = '';
  }

  function titleize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<form class="word-form" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
  <header>
    <div>
      <span>{card ? 'Dictionary card' : 'New vocabulary'}</span>
      <h3>{card ? 'Edit this word' : 'Add a German word'}</h3>
      <p>{card ? 'Review the details without resetting its learning stage.' : 'It will enter the review queue immediately.'}</p>
    </div>
    <div class="form-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8A3 3 0 0 1 5 16.5z"/><path d="M8 19.5a3 3 0 0 1 0-6h11M9 8h6"/></svg>
    </div>
  </header>

  {#if !card}
    <section class="template-row">
      <label for="ilo-template">Quick template</label>
      <div>
        <input id="ilo-template" bind:value={template} placeholder="word||translation||theme||noun||article||plural||example" />
        <button type="button" onclick={applyTemplate}>Apply</button>
      </div>
    </section>
  {/if}

  <div class="fields-grid">
    <label>
      <span>German <b>Required</b></span>
      <input bind:value={german} maxlength="256" placeholder="zum Beispiel" autocomplete="off" />
    </label>
    <label>
      <span>Translation <b>Required</b></span>
      <input bind:value={translation} maxlength="512" placeholder="meaning in your language" autocomplete="off" />
    </label>
    <label>
      <span>Theme</span>
      <select bind:value={theme}>
        {#each themes as option}
          <option value={option}>{titleize(option)}</option>
        {/each}
      </select>
    </label>
    <label class="noun-toggle">
      <span>Noun details</span>
      <button class:active={noun} type="button" role="switch" aria-checked={noun} onclick={() => { noun = !noun; }}>
        <i></i><strong>{noun ? 'Included' : 'Not needed'}</strong>
      </button>
    </label>
    {#if noun}
      <label>
        <span>Article</span>
        <select bind:value={article}>
          <option value="">No article</option>
          <option value="der">der</option>
          <option value="die">die</option>
          <option value="das">das</option>
        </select>
      </label>
      <label>
        <span>Plural</span>
        <input bind:value={plural} maxlength="256" placeholder="plural form" autocomplete="off" />
      </label>
    {/if}
    <label class="wide">
      <span>Example</span>
      <textarea bind:value={example} maxlength="512" rows="3" placeholder="A sentence that uses this word"></textarea>
    </label>
    <label class="wide">
      <span>Personal note</span>
      <textarea bind:value={note} maxlength="512" rows="2" placeholder="A memory hook, exception, or context"></textarea>
    </label>
  </div>

  {#if formError}
    <p class="form-error" role="alert">{formError}</p>
  {/if}

  <footer>
    {#if onCancel}
      <button class="secondary" type="button" onclick={onCancel}>Cancel</button>
    {/if}
    <button class="primary" type="submit" disabled={busy}>
      {#if busy}<span class="button-spinner" aria-hidden="true"></span>{/if}
      {busy ? 'Saving…' : card ? 'Save changes' : 'Add to training'}
    </button>
  </footer>
</form>

<style>
  .word-form { max-width: 920px; margin: 0 auto; padding: 28px; color: #314039; background: rgb(255 255 255 / 88%); border: 1px solid #dce4df; border-radius: 20px; box-shadow: 0 20px 48px rgb(45 75 62 / 8%); animation: form-in 260ms cubic-bezier(.2,.8,.2,1); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; padding-bottom: 22px; border-bottom: 1px solid #e1e7e3; }
  header span, label > span { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
  h3 { margin: 6px 0 0; color: #27352e; font-size: calc(20px * var(--text-scale)); font-weight: 720; letter-spacing: -.025em; }
  header p { margin-top: 7px; color: #859089; font-size: calc(9px * var(--text-scale)); line-height: 1.5; }
  .form-mark { display: grid; flex: none; width: 45px; height: 45px; color: #4d8976; background: #ebf3ef; border: 1px solid #d5e4dc; border-radius: 13px; place-items: center; }
  .form-mark svg { width: 24px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .template-row { padding: 18px 0; border-bottom: 1px solid #e5eae7; }
  .template-row label { display: block; margin-bottom: 8px; color: #74827a; font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .template-row div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .template-row button { padding: 0 14px; color: #3f7463; background: #eef5f1; border: 1px solid #ccddd5; border-radius: 10px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 700; }
  .fields-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding-top: 22px; }
  label { display: grid; min-width: 0; gap: 8px; }
  label > span { color: #6f7e76; letter-spacing: .06em; }
  label > span b { margin-left: 5px; color: #a77762; font-size: calc(7px * var(--text-scale)); font-weight: 680; letter-spacing: .04em; }
  input, select, textarea { width: 100%; min-width: 0; color: #314039; background: #f8faf8; border: 1px solid #d7dfda; border-radius: 11px; outline: 0; font-size: calc(10px * var(--text-scale)); transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease; }
  input, select { height: 42px; padding: 0 12px; }
  textarea { padding: 11px 12px; resize: vertical; line-height: 1.55; }
  input:focus, select:focus, textarea:focus { background: #fff; border-color: #78aa98; box-shadow: 0 0 0 3px rgb(76 139 116 / 10%); }
  .wide { grid-column: 1 / -1; }
  .noun-toggle button { display: flex; align-items: center; gap: 9px; width: 100%; height: 42px; padding: 0 11px; color: #829087; background: #f8faf8; border: 1px solid #d7dfda; border-radius: 11px; cursor: pointer; text-align: left; }
  .noun-toggle button i { position: relative; width: 30px; height: 18px; background: #dfe5e1; border-radius: 999px; transition: background 160ms ease; }
  .noun-toggle button i::after { position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; background: #fff; border-radius: 50%; box-shadow: 0 1px 4px rgb(38 62 51 / 16%); content: ''; transition: transform 160ms ease; }
  .noun-toggle button.active { color: #3e7563; border-color: #bcd2c8; }
  .noun-toggle button.active i { background: #57917e; }
  .noun-toggle button.active i::after { transform: translateX(12px); }
  .noun-toggle strong { font-size: calc(9px * var(--text-scale)); font-weight: 660; }
  .form-error { margin-top: 17px; padding: 11px 13px; color: #9f4c43; background: #fff1ef; border: 1px solid #eccfc9; border-radius: 10px; font-size: calc(9px * var(--text-scale)); }
  footer { display: flex; justify-content: flex-end; gap: 9px; padding-top: 22px; }
  footer button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 11px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 720; }
  footer .secondary { color: #68766e; background: #f7f9f7; border: 1px solid #d6ded9; }
  footer .primary { min-width: 132px; color: #f7fbf9; background: #397967; border: 1px solid #2f6c5a; box-shadow: 0 8px 18px rgb(47 108 90 / 16%); }
  footer button:disabled { cursor: progress; opacity: .65; }
  .button-spinner { width: 13px; height: 13px; border: 2px solid rgb(255 255 255 / 35%); border-top-color: #fff; border-radius: 50%; animation: spin .65s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes form-in { from { opacity: 0; transform: translateY(8px); } }
  @media (max-width: 1080px) { .fields-grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
  @media (prefers-reduced-motion: reduce) { .word-form, .button-spinner { animation: none; } }
</style>
