<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { IloCard } from '../../lib/domain/ilo';

  type Props = {
    busy: boolean;
    cards: IloCard[];
    hasMore: boolean;
    loading: boolean;
    onDelete: (card: IloCard) => void;
    onDeleteMany: (cardIds: string[]) => void;
    onEdit: (card: IloCard) => void;
    onLoadMore: () => Promise<void>;
    onSearch: (query: string, theme: string, force?: boolean) => Promise<void>;
    themes: string[];
  };

  let { busy, cards, hasMore, loading, onDelete, onDeleteMany, onEdit, onLoadMore, onSearch, themes }: Props = $props();
  let query = $state('');
  let theme = $state('');
  let selected = $state(new Set<string>());
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const visible = new Set(cards.map(({ id }) => id));
    if ([...selected].some((id) => !visible.has(id))) {
      selected = new Set([...selected].filter((id) => visible.has(id)));
    }
  });

  function scheduleSearch(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { void onSearch(query, theme); }, 280);
  }

  function filterTheme(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    void onSearch(query, theme);
  }

  function toggle(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function clearSelection(): void {
    selected = new Set();
  }

  function titleize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function reviewLabel(timestamp: number): string {
    const seconds = timestamp - Math.floor(Date.now() / 1_000);
    if (seconds <= 0) return 'Due now';
    if (seconds < 3_600) return `In ${Math.max(1, Math.ceil(seconds / 60))}m`;
    if (seconds < 86_400) return `In ${Math.ceil(seconds / 3_600)}h`;
    return `In ${Math.ceil(seconds / 86_400)}d`;
  }

  onDestroy(() => { if (debounceTimer) clearTimeout(debounceTimer); });
</script>

<section class="dictionary-shell" aria-labelledby="dictionary-title">
  <header>
    <div>
      <span>Vocabulary library</span>
      <h3 id="dictionary-title">Dictionary</h3>
      <p>Search, refine, and maintain every card without resetting its learning history.</p>
    </div>
    {#if selected.size > 0}
      <div class="selection-actions">
        <span>{selected.size} selected</span>
        <button type="button" onclick={clearSelection}>Clear</button>
        <button class="danger" type="button" disabled={busy} onclick={() => onDeleteMany([...selected])}>Delete</button>
      </div>
    {/if}
  </header>

  <div class="search-bar">
    <label class="search-field">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.8"/><path d="m12 12 4 4"/></svg>
      <span class="visually-hidden">Search cards</span>
      <input bind:value={query} maxlength="64" placeholder="Search German, translation, example, or note" oninput={scheduleSearch} />
      {#if loading}<i aria-label="Searching"></i>{/if}
    </label>
    <label>
      <span class="visually-hidden">Filter by theme</span>
      <select bind:value={theme} onchange={filterTheme}>
        <option value="">All themes</option>
        {#each themes as option}<option value={option}>{titleize(option)}</option>{/each}
      </select>
    </label>
    <button class="refresh" type="button" disabled={loading} onclick={() => onSearch(query, theme, true)} title="Refresh dictionary">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7.5A6 6 0 1 0 16 12M15.5 3.5v4h-4"/></svg>
    </button>
  </div>

  {#if cards.length === 0 && loading}
    <div class="dictionary-loading" aria-label="Loading cards">
      {#each Array(5) as _}<span></span>{/each}
    </div>
  {:else if cards.length === 0}
    <div class="empty-dictionary">
      <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 5.5h12a4 4 0 0 1 4 4V23H9a4 4 0 0 1-4-4z"/><path d="M9 23a4 4 0 0 1 0-8h12M10 10h6"/></svg>
      <h4>No cards found</h4>
      <p>Try another filter or add a new German word.</p>
    </div>
  {:else}
    <div class="card-list">
      {#each cards as card (card.id)}
        <article class:selected={selected.has(card.id)}>
          <button class="pick" type="button" aria-label={selected.has(card.id) ? 'Unselect card' : 'Select card'} onclick={() => toggle(card.id)}>
            {#if selected.has(card.id)}
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>
            {/if}
          </button>
          <div class="word-identity">
            <span>{card.article}</span>
            <strong>{card.german}</strong>
            <p>{card.translation}</p>
          </div>
          <div class="word-context">
            <span class="theme">{titleize(card.theme)}</span>
            {#if card.plural}<p><b>Plural</b> {card.plural}</p>{/if}
            {#if card.example}<p class="example">{card.example}</p>{/if}
            {#if card.note}<p class="note">{card.note}</p>{/if}
          </div>
          <div class="review-state">
            <span>Stage {card.stage}</span>
            <strong class:due={card.nextReviewAt <= Date.now() / 1_000}>{reviewLabel(card.nextReviewAt)}</strong>
            {#if card.failureCount > 0}<small>{card.failureCount} forgotten</small>{/if}
          </div>
          <div class="row-actions">
            <button type="button" onclick={() => onEdit(card)} title="Edit card">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4 3.5 3.5-8 8-4 1 1-4zM11 5.5l3.5 3.5"/></svg>
            </button>
            <button class="delete" type="button" onclick={() => onDelete(card)} title="Delete card">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 6.5h9M8 6.5V4.8h4v1.7M7 8.5l.5 7h5l.5-7"/></svg>
            </button>
          </div>
        </article>
      {/each}
    </div>
    {#if hasMore}
      <button class="load-more" type="button" disabled={loading} onclick={() => onLoadMore()}>
        {loading ? 'Loading…' : 'Load more cards'}
      </button>
    {/if}
  {/if}
</section>

<style>
  .dictionary-shell {
    --soft-bg: var(--sui-bg, #e4e9f0);
    --soft-bg-light: var(--sui-bg-light, #edf1f7);
    --soft-shadow: var(--sui-shadow-dark, rgb(39 51 67 / 20%));
    --soft-primary: var(--sui-primary, #5b54e0);
    --soft-primary-hover: var(--sui-primary-hover, #4a44c4);
    --soft-text: var(--sui-text, #2d3748);
    --soft-muted: var(--sui-text-muted, #5a6a7e);
    --soft-light: var(--sui-text-light, #6a7d94);
    max-width: 1120px;
    margin: 0 auto;
    color: var(--soft-text);
  }

  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  header > div:first-child > span { color: var(--soft-primary); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
  h3 { margin: 5px 0 0; color: var(--soft-text); font-size: calc(22px * var(--text-scale)); font-weight: 730; letter-spacing: -.03em; }
  header p { margin-top: 6px; color: var(--soft-muted); font-size: calc(9px * var(--text-scale)); }
  .selection-actions { display: flex; align-items: center; gap: 7px; }
  .selection-actions span { margin-right: 5px; color: var(--soft-muted); font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  .selection-actions button, .load-more { color: var(--soft-muted); background: var(--soft-bg); border: 0; border-radius: 10px; box-shadow: 0 3px 8px var(--soft-shadow); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .selection-actions button { height: 32px; padding: 0 10px; }
  .selection-actions button:hover:not(:disabled), .load-more:hover:not(:disabled) { color: var(--soft-primary); transform: translateY(-1px); }
  .selection-actions button:active:not(:disabled), .load-more:active:not(:disabled) { box-shadow: inset 2px 2px 5px var(--soft-shadow); transform: none; }
  .selection-actions .danger { color: var(--sui-danger, #d03a5c); }

  .search-bar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 40px; gap: 10px; margin-bottom: 14px; padding: 12px; background: var(--soft-bg); border: 0; border-radius: 14px; box-shadow: var(--soft-shadow-raised, 0 5px 14px var(--soft-shadow)); }
  .search-field { position: relative; display: flex; align-items: center; }
  .search-field svg { position: absolute; left: 13px; width: 17px; color: var(--soft-light); fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.5; }
  input, select { width: 100%; height: 38px; color: var(--soft-text); background: var(--soft-bg); border: 0; border-radius: 10px; outline: 0; box-shadow: inset 2px 2px 5px var(--soft-shadow); font-size: calc(9px * var(--text-scale)); }
  input { padding: 0 38px; }
  select { padding: 0 10px; }
  input:focus, select:focus { background: var(--soft-bg-light); box-shadow: inset 2px 2px 5px var(--soft-shadow), 0 0 0 2px color-mix(in srgb, var(--soft-primary) 22%, transparent); }
  .search-field i { position: absolute; right: 13px; width: 13px; height: 13px; border: 2px solid color-mix(in srgb, var(--soft-muted) 20%, transparent); border-top-color: var(--soft-primary); border-radius: 50%; animation: spin .65s linear infinite; }
  .refresh { display: grid; width: 40px; height: 38px; padding: 0; color: var(--soft-primary); background: var(--soft-bg); border: 0; border-radius: 10px; box-shadow: 0 3px 8px var(--soft-shadow); cursor: pointer; place-items: center; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .refresh:hover:not(:disabled) { color: var(--soft-primary-hover); transform: translateY(-1px); }
  .refresh:active:not(:disabled) { box-shadow: inset 2px 2px 5px var(--soft-shadow); transform: none; }
  .refresh svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .refresh:disabled { cursor: progress; opacity: .55; }

  .card-list { display: grid; gap: 9px; }
  article { display: grid; grid-template-columns: 26px minmax(150px, .75fr) minmax(220px, 1.5fr) 110px 72px; align-items: center; gap: 14px; min-height: 92px; padding: 13px 14px; color: var(--soft-text); background: var(--soft-bg); border: 0; border-radius: 14px; box-shadow: 0 5px 14px var(--soft-shadow); transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; animation: row-in 220ms ease both; }
  article:hover { box-shadow: 0 8px 18px var(--soft-shadow); transform: translateY(-1px); }
  article.selected { color: var(--soft-primary); box-shadow: inset 3px 3px 8px var(--soft-shadow); }
  .pick { display: grid; width: 20px; height: 20px; padding: 0; color: transparent; background: var(--soft-bg); border: 0; border-radius: 6px; box-shadow: inset 2px 2px 5px var(--soft-shadow); cursor: pointer; place-items: center; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease; }
  article.selected .pick { color: #fff; background: var(--soft-primary); box-shadow: 0 3px 8px var(--soft-shadow); }
  .pick:active { box-shadow: inset 2px 2px 5px var(--soft-shadow); }
  .pick svg { width: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
  .word-identity { min-width: 0; }
  .word-identity span { color: var(--soft-primary); font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .word-identity strong { display: block; overflow: hidden; color: var(--soft-text); font-size: calc(13px * var(--text-scale)); font-weight: 730; letter-spacing: -.015em; text-overflow: ellipsis; }
  .word-identity p { overflow: hidden; margin-top: 3px; color: var(--soft-muted); font-size: calc(9px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .word-context { min-width: 0; color: var(--soft-muted); font-size: calc(8px * var(--text-scale)); }
  .word-context .theme { display: inline-flex; margin-bottom: 5px; padding: 4px 8px; color: var(--soft-primary); background: var(--soft-bg); border-radius: 999px; box-shadow: inset 2px 2px 5px var(--soft-shadow); font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .word-context p { overflow: hidden; margin-top: 3px; text-overflow: ellipsis; white-space: nowrap; }
  .word-context b { margin-right: 4px; color: var(--soft-text); font-weight: 690; }
  .word-context .example { color: var(--soft-muted); font-style: italic; }
  .word-context .note { color: var(--soft-light); }
  .review-state { display: grid; gap: 3px; }
  .review-state span { color: var(--soft-light); font-size: calc(7px * var(--text-scale)); font-weight: 690; text-transform: uppercase; }
  .review-state strong { color: var(--sui-success, #1fa96e); font-size: calc(9px * var(--text-scale)); font-weight: 720; }
  .review-state strong.due { color: var(--sui-warning, #c57b46); }
  .review-state small { color: var(--soft-light); font-size: calc(7px * var(--text-scale)); }
  .row-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .row-actions button { display: grid; width: 31px; height: 31px; padding: 0; color: var(--soft-muted); background: var(--soft-bg); border: 0; border-radius: 9px; box-shadow: 0 3px 8px var(--soft-shadow); cursor: pointer; place-items: center; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .row-actions button:hover { color: var(--soft-primary); transform: translateY(-1px); }
  .row-actions button:active { box-shadow: inset 2px 2px 5px var(--soft-shadow); transform: none; }
  .row-actions .delete:hover { color: var(--sui-danger, #d03a5c); }
  .row-actions svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .empty-dictionary { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 300px; color: var(--soft-muted); background: var(--soft-bg); border: 0; border-radius: 16px; box-shadow: var(--soft-shadow-raised, 0 5px 14px var(--soft-shadow)); text-align: center; }
  .empty-dictionary svg { width: 40px; color: var(--soft-primary); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .empty-dictionary h4 { margin: 13px 0 0; color: var(--soft-text); font-size: calc(12px * var(--text-scale)); }
  .empty-dictionary p { margin-top: 5px; font-size: calc(9px * var(--text-scale)); }
  .dictionary-loading { display: grid; gap: 9px; }
  .dictionary-loading span { height: 92px; background: linear-gradient(90deg, var(--soft-bg-dark, #d1d9e6), var(--soft-bg-light), var(--soft-bg-dark, #d1d9e6)); background-size: 220% 100%; border-radius: 14px; box-shadow: var(--soft-shadow-raised-sm, 0 3px 8px var(--soft-shadow)); animation: shimmer 1.2s linear infinite; }
  .load-more { display: block; min-width: 150px; height: 37px; margin: 14px auto 0; padding: 0 15px; color: var(--soft-primary); font-size: calc(9px * var(--text-scale)); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { to { background-position: -220% 0; } }
  @keyframes row-in { from { opacity: 0; transform: translateY(4px); } }
  @media (max-width: 1160px) { article { grid-template-columns: 26px minmax(150px, .8fr) minmax(180px, 1.2fr) 95px 72px; } }
  @media (max-width: 820px) { header { align-items: flex-start; flex-direction: column; } .search-bar { grid-template-columns: minmax(0, 1fr) 40px; } .search-bar select { grid-column: 1 / -1; grid-row: 2; } article { grid-template-columns: 26px minmax(0, 1fr) auto; } .word-context, .review-state { grid-column: 2 / -1; } .row-actions { grid-column: 3; grid-row: 1; } }
  @media (prefers-reduced-motion: reduce) { article, .search-field i, .dictionary-loading span, .selection-actions button, .refresh, .row-actions button, .load-more { animation: none; transition: none; } }
</style>
