<script lang="ts">
  import LingvolernadoCardForm from './LingvolernadoCardForm.svelte';
  import LingvolernadoDictionary from './LingvolernadoDictionary.svelte';
  import LingvolernadoProgress from './LingvolernadoProgress.svelte';
  import TaglibroplaniloSection from './TaglibroplaniloSection.svelte';
  import type { IloCard, IloCardInput, IloSnapshot, IloTab } from '../../lib/domain/ilo';
  import type { IloGState } from '../../lib/states/IloGState';

  type Props = { snapshot: Readonly<IloSnapshot>; state: IloGState };
  let { snapshot, state: iloState }: Props = $props();
  let activeTab = $state<IloTab | 'activity'>('train');
  let editingCard = $state<IloCard | null>(null);
  let revealedCardId = $state<string | null>(null);
  let pendingDelete = $state<{ ids: string[]; label: string } | null>(null);
  let copyingLogs = $state(false);
  let copiedLogs = $state(false);
  let activeTool = $state<'lingvolernado' | 'taglibroplanilo'>('lingvolernado');

  const tabs = [
    { id: 'train' as const, label: 'Train', icon: 'spark' },
    { id: 'search' as const, label: 'Dictionary', icon: 'book' },
    { id: 'add' as const, label: 'Add', icon: 'plus' },
    { id: 'progress' as const, label: 'Progress', icon: 'chart' },
    { id: 'activity' as const, label: 'Activity', icon: 'pulse' },
  ];

  function openTab(tab: typeof activeTab): void {
    editingCard = null;
    activeTab = tab;
    if (tab === 'search' && !snapshot.cardsLoaded && !snapshot.cardsLoading) {
      void iloState.searchCards('', '');
    }
  }

  function openTool(tool: typeof activeTool): void {
    activeTool = tool;
    if (tool === 'taglibroplanilo') void iloState.refreshTaglibro(false);
  }

  async function grade(action: 'forgot' | 'remember'): Promise<void> {
    const cardId = snapshot.train.card?.id;
    if (!cardId) return;
    const changed = await iloState.grade(cardId, action);
    if (changed) revealedCardId = null;
  }

  async function createCard(input: IloCardInput): Promise<boolean> {
    const saved = await iloState.createCard(input);
    if (saved) {
      revealedCardId = null;
      openTab('train');
    }
    return saved;
  }

  async function updateCard(input: IloCardInput): Promise<boolean> {
    if (!editingCard) return false;
    const saved = await iloState.updateCard(editingCard.id, input);
    if (saved) openTab('search');
    return saved;
  }

  function editCard(card: IloCard): void {
    editingCard = card;
    activeTab = 'edit';
  }

  function requestDelete(card: IloCard): void {
    pendingDelete = { ids: [card.id], label: card.article ? `${card.article} ${card.german}` : card.german };
  }

  function requestDeleteMany(ids: string[]): void {
    pendingDelete = { ids, label: `${ids.length} selected cards` };
  }

  async function confirmDelete(): Promise<void> {
    const target = pendingDelete;
    if (!target) return;
    const deleted = target.ids.length === 1
      ? await iloState.deleteCard(target.ids[0]!)
      : await iloState.deleteCards(target.ids);
    if (deleted) pendingDelete = null;
  }

  async function copyLogs(): Promise<void> {
    if (copyingLogs || snapshot.logs.length === 0) return;
    copyingLogs = true;
    try {
      const text = snapshot.logs.map((entry) => (
        `[${new Date(entry.at).toISOString()}] ${entry.operation}: ${entry.message}`
      )).join('\n');
      await navigator.clipboard.writeText(text);
      copiedLogs = true;
      setTimeout(() => { copiedLogs = false; }, 1_800);
    } catch {
      copiedLogs = false;
    } finally {
      copyingLogs = false;
    }
  }

  function taskLabel(task: string): string {
    if (task === 'de_to_native') return 'German → your language';
    if (task === 'native_to_de') return 'Your language → German';
    return 'Sentence completion';
  }
</script>

<section class="ilo-shell" aria-labelledby="ilo-title">
  <aside class="tools-rail">
    <header>
      <span>Ilo</span>
      <strong>Tools</strong>
    </header>
    <button class:active={activeTool === 'lingvolernado'} class="tool-card" type="button" aria-current={activeTool === 'lingvolernado' ? 'page' : undefined} onclick={() => openTool('lingvolernado')}>
      <span class="tool-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8A3 3 0 0 1 5 16.5z"/><path d="M8 19.5a3 3 0 0 1 0-6h10M9 8h5M9 10.8h3.5"/></svg>
      </span>
      <span><strong>Lingvolernado</strong><small>German vocabulary</small></span>
      {#if snapshot.progress.due > 0}<b>{snapshot.progress.due}</b>{/if}
    </button>
    <button class:active={activeTool === 'taglibroplanilo'} class="tool-card tag-tool" type="button" aria-current={activeTool === 'taglibroplanilo' ? 'page' : undefined} onclick={() => openTool('taglibroplanilo')}>
      <span class="tool-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
      </span>
      <span><strong>Taglibroplanilo</strong><small>Daily planner & diary</small></span>
    </button>
    <div class="rail-spacer"></div>
    <div class="storage-note">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7.5 10 4l6 3.5v6L10 17l-6-3.5zM10 10.5V17M4 7.5l6 3 6-3"/></svg>
      <span><strong>Synced safely</strong><small>Kaordo account storage</small></span>
    </div>
  </aside>

  <main class:taglibro-active={activeTool === 'taglibroplanilo'} class="tool-workspace">
    {#if activeTool === 'taglibroplanilo'}
      <TaglibroplaniloSection snapshot={snapshot.taglibro} state={iloState} />
    {:else}
    <header class="tool-header">
      <div class="tool-heading">
        <span class="hero-mark" aria-hidden="true">L</span>
        <div>
          <span class="eyebrow">Language learning</span>
          <h1 id="ilo-title">Lingvolernado</h1>
          <p>German vocabulary, spaced repetition, and a clear record of your progress.</p>
        </div>
      </div>
      <div class="header-actions">
        <span class="sync-state"><i></i>{snapshot.error ? 'Needs attention' : 'Saved'}</span>
        <button class:loading={snapshot.refreshing} type="button" disabled={snapshot.refreshing || snapshot.busy !== null} onclick={() => iloState.refresh()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7.5A6 6 0 1 0 16 12M15.5 3.5v4h-4"/></svg>
          {snapshot.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </header>

    <nav class="tool-tabs" aria-label="Lingvolernado sections">
      {#each tabs as tab}
        <button class:active={activeTab === tab.id} type="button" onclick={() => openTab(tab.id)}>
          {#if tab.icon === 'spark'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 1.2 4.1L15 8l-3.8 1.9L10 14l-1.2-4.1L5 8l3.8-1.9z"/><path d="m15.5 13 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/></svg>
          {:else if tab.icon === 'book'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h5A2.5 2.5 0 0 1 11 7v9a2.5 2.5 0 0 0-2.5-2.5h-5zM16.5 4.5h-3A2.5 2.5 0 0 0 11 7v9a2.5 2.5 0 0 1 2.5-2.5h3z"/></svg>
          {:else if tab.icon === 'plus'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
          {:else if tab.icon === 'chart'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15V9M8 15V5M12 15v-3M16 15V7M3 16.5h14"/></svg>
          {:else}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h3l1.5-4 3 8 2-5 1.5 3H17"/></svg>
          {/if}
          {tab.label}
          {#if tab.id === 'activity' && snapshot.logs.length > 0}<b>{snapshot.logs.length}</b>{/if}
        </button>
      {/each}
    </nav>

    {#if snapshot.error}
      <div class="error-banner" role="alert">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 17 16H3zM10 7.5v4M10 14h.01"/></svg>
        <span><strong>Lingvolernado could not finish an operation</strong>{snapshot.error}</span>
        <button type="button" onclick={() => iloState.clearError()} aria-label="Dismiss error">×</button>
      </div>
    {/if}

    <div class="tool-scroll">
      {#if snapshot.phase === 'loading'}
        <div class="initial-loading" aria-label="Loading Lingvolernado">
          <span class="loading-orbit"><i></i><b>L</b></span>
          <strong>Opening your learning space</strong>
          <p>Loading cards, review queue, and progress…</p>
        </div>
      {:else if activeTab === 'train'}
        <section class="training-view" aria-labelledby="training-title">
          <div class="training-summary">
            <article><span>Due now</span><strong>{snapshot.train.due}</strong><small>cards ready</small></article>
            <article><span>Dictionary</span><strong>{snapshot.train.active}</strong><small>active cards</small></article>
            <article class:complete={snapshot.progress.learnedToday}><span>Today</span><strong>{snapshot.progress.todayPoints}</strong><small>{snapshot.progress.learnedToday ? 'points earned' : 'start a session'}</small></article>
          </div>

          {#if snapshot.train.card}
            {@const card = snapshot.train.card}
            {@const revealed = revealedCardId === card.id}
            {#key card.id}
              <article class:revealed class="training-card">
                <header>
                  <div><span>{taskLabel(card.task)}</span><h2 id="training-title">{card.promptTitle}</h2></div>
                  <span class="stage-badge">Stage {card.stage}</span>
                </header>
                <div class="stage-track" aria-label={`Stage ${card.stage} of 8`}>
                  {#each Array(9) as _, index}<i class:reached={index <= card.stage}></i>{/each}
                </div>
                <p class="training-prompt">{card.promptText}</p>
                {#if revealed}
                  <div class="answer-panel">
                    <span>Answer</span>
                    <ul>{#each card.answerLines as line}<li>{line}</li>{/each}</ul>
                  </div>
                  <div class="training-actions split">
                    <button class="forgot" type="button" disabled={snapshot.busy !== null} onclick={() => grade('forgot')}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5A6 6 0 1 1 4.5 12M5 3.5v4H1"/></svg>
                      Forgot
                    </button>
                    <button class="remember" type="button" disabled={snapshot.busy !== null} onclick={() => grade('remember')}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>
                      {snapshot.busy ? 'Saving…' : 'Remember'}
                    </button>
                  </div>
                {:else}
                  <div class="training-actions">
                    <button class="reveal" type="button" onclick={() => { revealedCardId = card.id; }}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.8-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.8 4.5-7.5 4.5S2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2"/></svg>
                      Reveal answer
                    </button>
                  </div>
                {/if}
              </article>
            {/key}
          {:else}
            <article class="queue-clear">
              <span class="clear-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m8 16 5 5L24 10"/></svg></span>
              <span class="eyebrow">Queue clear</span>
              <h2 id="training-title">Nothing is due right now</h2>
              <p>Your schedule is up to date. Add another word or return when the next review is ready.</p>
              <div><button type="button" onclick={() => openTab('add')}>Add a word</button><button type="button" onclick={() => iloState.refresh()}>Check again</button></div>
            </article>
          {/if}
        </section>
      {:else if activeTab === 'search'}
        <LingvolernadoDictionary
          busy={snapshot.busy !== null}
          cards={snapshot.cards}
          hasMore={snapshot.cardsHasMore}
          loading={snapshot.cardsLoading}
          onDelete={requestDelete}
          onDeleteMany={requestDeleteMany}
          onEdit={editCard}
          onLoadMore={() => iloState.loadMoreCards()}
          onSearch={(query, theme, force) => iloState.searchCards(query, theme, force)}
          themes={snapshot.themes}
        />
      {:else if activeTab === 'add'}
        <LingvolernadoCardForm busy={snapshot.busy !== null} onSubmit={createCard} themes={snapshot.themes} />
      {:else if activeTab === 'edit' && editingCard}
        {#key editingCard.id}
          <LingvolernadoCardForm
            busy={snapshot.busy !== null}
            card={editingCard}
            onCancel={() => openTab('search')}
            onSubmit={updateCard}
            themes={snapshot.themes}
          />
        {/key}
      {:else if activeTab === 'progress'}
        <LingvolernadoProgress progress={snapshot.progress} />
      {:else if activeTab === 'activity'}
        <section class="activity-view" aria-labelledby="activity-title">
          <header>
            <div><span class="eyebrow">Local diagnostics</span><h2 id="activity-title">Activity log</h2><p>Operation errors stay available across restarts; server failures also appear in Worker observability.</p></div>
            <div><button type="button" disabled={snapshot.logs.length === 0 || copyingLogs} onclick={copyLogs}>{copiedLogs ? 'Copied' : 'Copy log'}</button><button type="button" disabled={snapshot.logs.length === 0} onclick={() => iloState.clearLogs()}>Clear</button></div>
          </header>
          {#if snapshot.logs.length === 0}
            <div class="activity-empty"><i></i><strong>No errors recorded</strong><p>Lingvolernado operations are healthy in this session.</p></div>
          {:else}
            <div class="log-list">
              {#each snapshot.logs as entry}
                <article><span></span><div><strong>{entry.operation}</strong><p>{entry.message}</p></div><time datetime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString()}</time></article>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>

    {#if pendingDelete}
      <div class="confirm-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) pendingDelete = null; }}>
        <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
          <span class="delete-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5.5 7.5h13M9 7.5V5h6v2.5M8 10l.7 9h6.6l.7-9"/></svg></span>
          <span class="eyebrow">Permanent action</span>
          <h2 id="delete-title">Delete {pendingDelete.label}?</h2>
          <p>The selected vocabulary and its review history will be removed from your Kaordo account.</p>
          <div><button type="button" onclick={() => { pendingDelete = null; }}>Cancel</button><button class="confirm-danger" type="button" disabled={snapshot.busy !== null} onclick={confirmDelete}>{snapshot.busy ? 'Deleting…' : 'Delete'}</button></div>
        </div>
      </div>
    {/if}
    {/if}
  </main>
</section>

<style>
  /* Ilo shares Fluo's SoftUI surface contract while keeping its learning
     views isolated from the legacy green application tokens. */
  .ilo-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --ilo-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--ilo-shadow-color) !important;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #d03a5c;
    --sui-warning: #c57b46;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-radius-sm: 10px;
    --sui-radius: 16px;
    --sui-radius-lg: 24px;
    --sui-shadow-raised: 0 5px 14px var(--ilo-shadow-color) !important;
    --sui-shadow-raised-sm: 0 3px 8px var(--ilo-shadow-color) !important;
    --sui-shadow-raised-lg: 0 16px 36px var(--ilo-shadow-color) !important;
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-dark);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark);
    display: grid;
    grid-template-columns: minmax(210px, 236px) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--sui-text);
    background: var(--sui-bg);
    isolation: isolate;
  }

  :global(html[data-theme='dark']) .ilo-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --ilo-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-dark: var(--ilo-shadow-color) !important;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-warning: #f1bd63;
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
    --sui-text-light: #8a94a6;
  }

  .tools-rail {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding: 18px 13px 14px;
    flex-direction: column;
    background: color-mix(in srgb, var(--sui-bg) 70%, var(--sui-bg-dark) 30%);
    box-shadow: inset -1px 0 0 color-mix(in srgb, var(--sui-shadow-dark) 20%, transparent);
  }

  :global(html[data-theme='dark']) .tools-rail {
    background: color-mix(in srgb, var(--sui-bg) 78%, var(--sui-bg-dark) 22%) !important;
  }

  .tools-rail > header { display: grid; gap: 3px; padding: 0 9px 16px; }
  .tools-rail > header span { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  .tools-rail > header strong { color: var(--sui-text); font-size: calc(16px * var(--text-scale)); font-weight: 740; letter-spacing: -.02em; }

  .tool-card {
    position: relative;
    display: grid;
    grid-template-columns: 41px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 65px;
    margin-bottom: 7px;
    padding: 10px;
    color: var(--sui-text-muted);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 13px;
    box-shadow: none;
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .tool-card:hover { color: var(--sui-text); background: color-mix(in srgb, var(--sui-bg-light) 48%, transparent); box-shadow: var(--sui-shadow-raised-sm); transform: translateY(-1px); }
  .tool-card.active { color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .tool-card:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .tool-icon { display: grid; width: 41px; height: 41px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .tool-card.active .tool-icon { box-shadow: var(--sui-shadow-inset-sm); }
  .tool-icon svg { width: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .tool-card > span:nth-child(2) { min-width: 0; }
  .tool-card strong, .tool-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-card strong { color: currentColor; font-size: calc(9px * var(--text-scale)); font-weight: 710; }
  .tool-card small { margin-top: 3px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .tool-card > b { display: grid; min-width: 20px; height: 20px; padding: 0 5px; color: #fff; background: var(--sui-primary); border-radius: 999px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(7px * var(--text-scale)); place-items: center; }
  .rail-spacer { flex: 1; }
  .storage-note { display: flex; align-items: center; gap: 9px; margin-top: 10px; padding: 13px 9px 4px; color: var(--sui-text-light); border-top: 0; }
  .storage-note svg { flex: none; width: 19px; fill: none; stroke: var(--sui-primary); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .storage-note strong, .storage-note small { display: block; }
  .storage-note strong { color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .storage-note small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }

  .tool-workspace {
    position: relative;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(circle at 78% -8%, color-mix(in srgb, var(--sui-primary) 10%, transparent), transparent 31%), var(--sui-bg);
  }

  .tool-workspace.taglibro-active { display: block; overflow: auto; }
  .tool-workspace.taglibro-active > :global(.taglibro-shell) { min-height: 100%; }

  .tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    min-height: 72px;
    margin: 10px 16px 0;
    padding: 9px 15px;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised);
  }

  .tool-heading { display: flex; align-items: center; gap: 13px; min-width: 0; }
  .hero-mark { display: grid; flex: none; width: 50px; height: 50px; color: #fff; background: linear-gradient(145deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 68%, #242a48)); border: 0; border-radius: 16px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(20px * var(--text-scale)); font-weight: 740; place-items: center; }
  .eyebrow { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 770; letter-spacing: .13em; text-transform: uppercase; }
  .tool-heading h1 { margin: 3px 0 0; color: var(--sui-text); font-size: calc(21px * var(--text-scale)); font-weight: 740; letter-spacing: -.035em; }
  .tool-heading p { margin-top: 3px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .header-actions { display: flex; align-items: center; gap: 13px; }
  .sync-state { display: inline-flex; align-items: center; gap: 6px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); font-weight: 660; }
  .sync-state i { width: 7px; height: 7px; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-success) 12%, transparent); }
  .header-actions button { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 13px; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 700; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .header-actions button:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .header-actions button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .header-actions button:disabled { cursor: progress; opacity: .62; }
  .header-actions svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .header-actions button.loading svg { animation: spin .75s linear infinite; }

  .tool-tabs { display: flex; align-items: center; gap: 4px; min-height: 43px; margin: 8px 16px 0; padding: 5px; background: var(--sui-bg); border: 0; border-radius: var(--sui-radius); box-shadow: var(--sui-shadow-inset-sm); }
  .tool-tabs button { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; color: var(--sui-text-muted); background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .tool-tabs button:hover { color: var(--sui-primary); background: color-mix(in srgb, var(--sui-bg-light) 60%, transparent); }
  .tool-tabs button.active { color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-shadow-raised-sm); }
  .tool-tabs button:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .tool-tabs svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .tool-tabs b { display: grid; min-width: 17px; height: 17px; padding: 0 4px; color: #fff; background: var(--sui-primary); border-radius: 999px; font-size: calc(6px * var(--text-scale)); place-items: center; }

  .error-banner { display: flex; align-items: center; gap: 10px; margin: 11px 16px 0; padding: 11px 13px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(8px * var(--text-scale)); animation: banner-in 180ms ease; }
  .error-banner > svg { flex: none; width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .error-banner span { display: grid; gap: 2px; }
  .error-banner strong { font-size: calc(8px * var(--text-scale)); }
  .error-banner button { margin-left: auto; color: inherit; background: transparent; border: 0; border-radius: 7px; cursor: pointer; font-size: 18px; }
  .error-banner button:active { box-shadow: var(--sui-shadow-inset-sm); }

  .tool-scroll { min-width: 0; min-height: 0; padding: 24px 30px 34px; overflow: auto; scrollbar-color: color-mix(in srgb, var(--sui-text-light) 48%, transparent) transparent; scrollbar-width: thin; }
  .initial-loading { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 430px; color: var(--sui-text-muted); text-align: center; }
  .loading-orbit { position: relative; display: grid; width: 68px; height: 68px; margin-bottom: 18px; color: #fff; background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-raised); place-items: center; }
  .loading-orbit i { position: absolute; inset: -6px; border: 2px solid transparent; border-top-color: var(--sui-primary); border-right-color: color-mix(in srgb, var(--sui-primary) 36%, transparent); border-radius: 50%; animation: spin .9s linear infinite; }
  .loading-orbit b { display: grid; width: 42px; height: 42px; background: linear-gradient(145deg, var(--sui-primary), var(--sui-primary-hover)); border-radius: 13px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .initial-loading > strong { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); }
  .initial-loading p { margin-top: 6px; font-size: calc(8px * var(--text-scale)); }

  .training-view { display: flex; max-width: 920px; min-height: 100%; margin: 0 auto; flex-direction: column; }
  .training-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; margin-bottom: 14px; }
  .training-summary article { position: relative; min-width: 0; padding: 12px 14px; overflow: hidden; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 14px; box-shadow: var(--sui-shadow-raised-sm); }
  .training-summary article::after { position: absolute; right: -18px; bottom: -25px; width: 75px; height: 75px; background: color-mix(in srgb, var(--sui-primary) 8%, transparent); border-radius: 50%; content: ''; }
  .training-summary span { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); font-weight: 690; text-transform: uppercase; }
  .training-summary strong { display: inline-block; margin: 0 6px 0 9px; color: var(--sui-text); font-size: calc(16px * var(--text-scale)); font-weight: 730; }
  .training-summary small { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .training-summary .complete { box-shadow: 0 5px 14px color-mix(in srgb, var(--sui-success) 19%, var(--ilo-shadow-color)); }

  .training-card { display: flex; min-height: 0; padding: 28px; flex: 1 1 auto; flex-direction: column; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 21px; box-shadow: var(--sui-shadow-raised-lg); animation: card-in 260ms cubic-bezier(.2, .8, .2, 1); }
  .training-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .training-card header span:first-child { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .09em; text-transform: uppercase; }
  .training-card h2 { margin: 6px 0 0; color: var(--sui-text); font-size: calc(15px * var(--text-scale)); font-weight: 700; }
  .stage-badge { flex: none; padding: 6px 10px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .stage-track { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-top: 19px; }
  .stage-track i { height: 4px; background: color-mix(in srgb, var(--sui-text-light) 16%, transparent); border-radius: 999px; }
  .stage-track i.reached { background: linear-gradient(90deg, var(--sui-primary), var(--sui-primary-hover)); }
  .training-prompt { display: grid; min-height: clamp(112px, 19vh, 170px); margin: 17px 0 0; padding: 30px 22px; flex: 1 1 auto; color: var(--sui-text); background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-shadow-inset); font-size: calc(25px * var(--text-scale)); font-weight: 650; letter-spacing: -.025em; line-height: 1.35; place-items: center; text-align: center; white-space: pre-line; }
  .training-card.revealed .training-prompt { min-height: clamp(82px, 13vh, 132px); }
  .answer-panel { max-height: clamp(100px, 20vh, 210px); margin-top: 14px; padding: 17px 19px; overflow: auto; flex: 0 1 auto; color: var(--sui-text); background: color-mix(in srgb, var(--sui-primary) 7%, var(--sui-bg)); border-radius: 13px; box-shadow: var(--sui-shadow-inset-sm); animation: answer-in 180ms ease; }
  .answer-panel > span { color: var(--sui-primary); font-size: calc(7px * var(--text-scale)); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
  .answer-panel ul { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
  .answer-panel li { color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .training-actions { display: flex; flex: none; justify-content: center; margin-top: 16px; }
  .training-actions.split { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 10px; }
  .training-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 180px; height: 43px; padding: 0 17px; border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 720; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .training-actions button:hover:not(:disabled) { transform: translateY(-1px); }
  .training-actions button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .training-actions svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  .training-actions .reveal, .training-actions .remember { color: #fff; background: var(--sui-primary); }
  .training-actions .reveal:hover:not(:disabled), .training-actions .remember:hover:not(:disabled) { background: var(--sui-primary-hover); }
  .training-actions .forgot { color: var(--sui-warning); background: var(--sui-bg); }
  .training-actions button:disabled { cursor: progress; opacity: .62; }

  .queue-clear { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 430px; padding: 35px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 20px; box-shadow: var(--sui-shadow-raised-lg); text-align: center; }
  .clear-mark { display: grid; width: 62px; height: 62px; margin-bottom: 18px; color: var(--sui-success); background: var(--sui-bg); border-radius: 18px; box-shadow: var(--sui-shadow-inset); place-items: center; }
  .clear-mark svg { width: 36px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  .queue-clear h2 { margin: 8px 0 0; color: var(--sui-text); font-size: calc(20px * var(--text-scale)); }
  .queue-clear p { max-width: 470px; margin-top: 8px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); line-height: 1.55; }
  .queue-clear > div { display: flex; gap: 9px; margin-top: 20px; }
  .queue-clear button { height: 37px; padding: 0 14px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 690; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .queue-clear button:hover { color: var(--sui-primary); transform: translateY(-1px); }
  .queue-clear button:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .queue-clear button:first-child { color: #fff; background: var(--sui-primary); }

  .activity-view { max-width: 1000px; margin: 0 auto; }
  .activity-view > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
  .activity-view h2 { margin: 5px 0 0; color: var(--sui-text); font-size: calc(21px * var(--text-scale)); }
  .activity-view header p { margin-top: 5px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .activity-view header > div:last-child { display: flex; gap: 8px; }
  .activity-view header button { height: 34px; padding: 0 11px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .activity-view header button:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .activity-view header button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .activity-view header button:disabled { opacity: .45; cursor: default; }
  .activity-empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 330px; margin-top: 18px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 17px; box-shadow: var(--sui-shadow-raised); text-align: center; }
  .activity-empty i { width: 18px; height: 18px; margin-bottom: 12px; background: var(--sui-success); border: 5px solid color-mix(in srgb, var(--sui-success) 15%, var(--sui-bg)); border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); }
  .activity-empty strong { color: var(--sui-text); font-size: calc(11px * var(--text-scale)); }
  .activity-empty p { margin-top: 5px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .log-list { display: grid; gap: 9px; margin-top: 18px; }
  .log-list article { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; align-items: start; gap: 11px; padding: 14px 15px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 13px; box-shadow: var(--sui-shadow-raised-sm); }
  .log-list article > span { width: 8px; height: 8px; margin-top: 4px; background: var(--sui-danger); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-danger) 12%, transparent); }
  .log-list strong { color: var(--sui-danger); font-size: calc(8px * var(--text-scale)); text-transform: capitalize; }
  .log-list p { margin-top: 4px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .log-list time { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }

  .confirm-backdrop { position: absolute; z-index: 50; display: grid; inset: 0; padding: 24px; background: rgb(45 55 72 / 48%); backdrop-filter: blur(7px); place-items: center; animation: fade-in 150ms ease; }
  .confirm-dialog { width: min(430px, 100%); padding: 27px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 19px; box-shadow: var(--sui-shadow-raised-lg); text-align: center; animation: dialog-in 190ms cubic-bezier(.2, .8, .2, 1); }
  .delete-mark { display: grid; width: 51px; height: 51px; margin: 0 auto 14px; color: var(--sui-danger); background: var(--sui-bg); border-radius: 15px; box-shadow: var(--sui-shadow-inset); place-items: center; }
  .delete-mark svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .confirm-dialog h2 { margin: 7px 0 0; color: var(--sui-text); font-size: calc(16px * var(--text-scale)); }
  .confirm-dialog p { margin-top: 8px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); line-height: 1.5; }
  .confirm-dialog > div { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 21px; }
  .confirm-dialog button { height: 39px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 700; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .confirm-dialog button:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .confirm-dialog button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .confirm-dialog .confirm-danger { color: #fff; background: var(--sui-danger); }

  button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 72%, transparent); outline-offset: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes banner-in { from { opacity: 0; transform: translateY(-4px); } }
  @keyframes card-in { from { opacity: 0; transform: translateY(8px) scale(.995); } }
  @keyframes answer-in { from { opacity: 0; transform: translateY(4px); } }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes dialog-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  @media (max-width: 1160px) { .ilo-shell { grid-template-columns: 194px minmax(0, 1fr); } .tool-header, .tool-tabs { margin-inline: 12px; } .tool-scroll { padding-inline: 22px; } }
  @media (max-width: 760px) { .ilo-shell { grid-template-columns: 178px minmax(0, 1fr); } .tool-header { align-items: flex-start; flex-direction: column; gap: 13px; } .header-actions { width: 100%; justify-content: space-between; } .tool-tabs { overflow-x: auto; } .tool-tabs button { flex: none; } .training-summary { grid-template-columns: 1fr; } .training-card { padding: 21px; } }
  @media (prefers-reduced-motion: reduce) { .loading-orbit i, .header-actions button.loading svg, .training-card, .answer-panel, .error-banner, .confirm-backdrop, .confirm-dialog { animation: none; } }
</style>
