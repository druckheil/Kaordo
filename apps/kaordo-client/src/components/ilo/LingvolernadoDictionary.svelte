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
    onSearch: (query: string, theme: string) => Promise<void>;
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
    <button class="refresh" type="button" disabled={loading} onclick={() => onSearch(query, theme)} title="Refresh dictionary">
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
  .dictionary-shell { max-width: 1120px; margin: 0 auto; color: #324139; }
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  header > div:first-child > span { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
  h3 { margin: 5px 0 0; color: #27352e; font-size: calc(22px * var(--text-scale)); font-weight: 730; letter-spacing: -.03em; }
  header p { margin-top: 6px; color: #839087; font-size: calc(9px * var(--text-scale)); }
  .selection-actions { display: flex; align-items: center; gap: 7px; }
  .selection-actions span { margin-right: 5px; color: #718078; font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  .selection-actions button { height: 32px; padding: 0 10px; color: #627068; background: #fff; border: 1px solid #d5ddd8; border-radius: 8px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .selection-actions .danger { color: #9a4c44; background: #fff4f2; border-color: #e8cbc6; }
  .search-bar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 38px; gap: 9px; margin-bottom: 13px; padding: 12px; background: rgb(255 255 255 / 72%); border: 1px solid #dce4df; border-radius: 14px; }
  .search-field { position: relative; display: flex; align-items: center; }
  .search-field svg { position: absolute; left: 12px; width: 17px; fill: none; stroke: #7f8d84; stroke-linecap: round; stroke-width: 1.5; }
  input, select { width: 100%; height: 38px; color: #34423a; background: #f7f9f7; border: 1px solid #d6ded9; border-radius: 10px; outline: 0; font-size: calc(9px * var(--text-scale)); }
  input { padding: 0 38px; }
  select { padding: 0 10px; }
  input:focus, select:focus { background: #fff; border-color: #79a996; box-shadow: 0 0 0 3px rgb(66 130 106 / 9%); }
  .search-field i { position: absolute; right: 13px; width: 13px; height: 13px; border: 2px solid #ccdbd4; border-top-color: #43806d; border-radius: 50%; animation: spin .65s linear infinite; }
  .refresh { display: grid; width: 38px; height: 38px; padding: 0; color: #55776a; background: #edf4f0; border: 1px solid #ceded6; border-radius: 10px; cursor: pointer; place-items: center; }
  .refresh svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .refresh:disabled { cursor: progress; opacity: .55; }
  .card-list { display: grid; gap: 8px; }
  article { display: grid; grid-template-columns: 26px minmax(150px, .75fr) minmax(220px, 1.5fr) 110px 72px; align-items: center; gap: 14px; min-height: 92px; padding: 13px 14px; background: rgb(255 255 255 / 86%); border: 1px solid #dce4df; border-radius: 14px; box-shadow: 0 8px 22px rgb(43 69 57 / 4%); transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; animation: row-in 220ms ease both; }
  article:hover { border-color: #c3d4cb; transform: translateY(-1px); }
  article.selected { background: #f0f7f3; border-color: #88b5a3; }
  .pick { display: grid; width: 20px; height: 20px; padding: 0; color: #fff; background: #fff; border: 1px solid #cad4ce; border-radius: 6px; cursor: pointer; place-items: center; }
  article.selected .pick { background: #4b8874; border-color: #3d7663; }
  .pick svg { width: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
  .word-identity { min-width: 0; }
  .word-identity span { color: #6f8b80; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .word-identity strong { display: block; overflow: hidden; color: #2d3c34; font-size: calc(13px * var(--text-scale)); font-weight: 730; letter-spacing: -.015em; text-overflow: ellipsis; }
  .word-identity p { overflow: hidden; margin-top: 3px; color: #77847c; font-size: calc(9px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .word-context { min-width: 0; color: #738078; font-size: calc(8px * var(--text-scale)); }
  .word-context .theme { display: inline-flex; margin-bottom: 5px; padding: 3px 7px; color: #477562; background: #eaf2ee; border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .word-context p { overflow: hidden; margin-top: 3px; text-overflow: ellipsis; white-space: nowrap; }
  .word-context b { margin-right: 4px; color: #57675e; font-weight: 690; }
  .word-context .example { color: #5c6d63; font-style: italic; }
  .word-context .note { color: #89948d; }
  .review-state { display: grid; gap: 3px; }
  .review-state span { color: #87928b; font-size: calc(7px * var(--text-scale)); font-weight: 690; text-transform: uppercase; }
  .review-state strong { color: #668376; font-size: calc(9px * var(--text-scale)); font-weight: 720; }
  .review-state strong.due { color: #b56c50; }
  .review-state small { color: #a18a80; font-size: calc(7px * var(--text-scale)); }
  .row-actions { display: flex; justify-content: flex-end; gap: 5px; }
  .row-actions button { display: grid; width: 31px; height: 31px; padding: 0; color: #68786f; background: #f5f8f6; border: 1px solid #d5ddd8; border-radius: 8px; cursor: pointer; place-items: center; }
  .row-actions button:hover { color: #3b7864; border-color: #a9c4b8; }
  .row-actions .delete:hover { color: #a24e45; background: #fff3f1; border-color: #e1bbb5; }
  .row-actions svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .empty-dictionary { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 300px; color: #89958e; background: rgb(255 255 255 / 66%); border: 1px dashed #cdd9d2; border-radius: 16px; text-align: center; }
  .empty-dictionary svg { width: 40px; color: #6d9989; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .empty-dictionary h4 { margin: 13px 0 0; color: #48594f; font-size: calc(12px * var(--text-scale)); }
  .empty-dictionary p { margin-top: 5px; font-size: calc(9px * var(--text-scale)); }
  .dictionary-loading { display: grid; gap: 8px; }
  .dictionary-loading span { height: 92px; background: linear-gradient(90deg, #edf1ee, #f8faf8, #edf1ee); background-size: 220% 100%; border: 1px solid #e0e6e2; border-radius: 14px; animation: shimmer 1.2s linear infinite; }
  .load-more { display: block; min-width: 150px; height: 37px; margin: 14px auto 0; padding: 0 15px; color: #4f7567; background: #f3f7f5; border: 1px solid #cddbd4; border-radius: 10px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 690; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { to { background-position: -220% 0; } }
  @keyframes row-in { from { opacity: 0; transform: translateY(4px); } }
  @media (max-width: 1160px) { article { grid-template-columns: 26px minmax(150px, .8fr) minmax(180px, 1.2fr) 95px 72px; } }
  @media (prefers-reduced-motion: reduce) { article, .search-field i, .dictionary-loading span { animation: none; } }
</style>
