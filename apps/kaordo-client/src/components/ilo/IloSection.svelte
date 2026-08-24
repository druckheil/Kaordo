<script lang="ts">
  import LingvolernadoCardForm from './LingvolernadoCardForm.svelte';
  import LingvolernadoDictionary from './LingvolernadoDictionary.svelte';
  import LingvolernadoProgress from './LingvolernadoProgress.svelte';
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
    <button class="tool-card active" type="button" aria-current="page">
      <span class="tool-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8A3 3 0 0 1 5 16.5z"/><path d="M8 19.5a3 3 0 0 1 0-6h10M9 8h5M9 10.8h3.5"/></svg>
      </span>
      <span><strong>Lingvolernado</strong><small>German vocabulary</small></span>
      {#if snapshot.progress.due > 0}<b>{snapshot.progress.due}</b>{/if}
    </button>
    <div class="rail-spacer"></div>
    <div class="storage-note">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7.5 10 4l6 3.5v6L10 17l-6-3.5zM10 10.5V17M4 7.5l6 3 6-3"/></svg>
      <span><strong>Synced safely</strong><small>Kaordo account storage</small></span>
    </div>
  </aside>

  <main class="tool-workspace">
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
              <article class="training-card">
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
          onSearch={(query, theme) => iloState.searchCards(query, theme)}
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
  </main>
</section>

<style>
  .ilo-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-width: 0; min-height: 0; color: #34423a; background: var(--canvas); }
  .tools-rail { display: flex; min-width: 0; min-height: 0; padding: 22px 13px 14px; flex-direction: column; background: color-mix(in srgb, var(--panel) 72%, var(--canvas)); border-right: 1px solid var(--line); }
  .tools-rail > header { display: grid; gap: 3px; padding: 0 8px 16px; }
  .tools-rail > header span { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  .tools-rail > header strong { color: #405047; font-size: calc(15px * var(--text-scale)); font-weight: 720; }
  .tool-card { position: relative; display: grid; grid-template-columns: 39px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 61px; padding: 10px; color: #53635a; background: transparent; border: 1px solid transparent; border-radius: 13px; cursor: pointer; text-align: left; transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
  .tool-card:hover, .tool-card.active { background: color-mix(in srgb, var(--panel-soft) 72%, white); border-color: color-mix(in srgb, var(--accent) 24%, var(--line)); }
  .tool-card.active { box-shadow: 0 8px 22px rgb(39 72 59 / 7%); }
  .tool-card:active { transform: scale(.99); }
  .tool-icon { display: grid; width: 39px; height: 39px; color: #477f6d; background: #e8f1ed; border: 1px solid #d0e0d8; border-radius: 11px; place-items: center; }
  .tool-icon svg { width: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .tool-card > span:nth-child(2) { min-width: 0; }
  .tool-card strong, .tool-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-card strong { color: #394a41; font-size: calc(9px * var(--text-scale)); font-weight: 710; }
  .tool-card small { margin-top: 3px; color: #8a968f; font-size: calc(7px * var(--text-scale)); }
  .tool-card > b { display: grid; min-width: 20px; height: 20px; padding: 0 5px; color: #fff; background: #ba7158; border-radius: 999px; font-size: calc(7px * var(--text-scale)); place-items: center; }
  .rail-spacer { flex: 1; }
  .storage-note { display: flex; align-items: center; gap: 9px; padding: 11px 9px; color: #819087; border-top: 1px solid var(--line); }
  .storage-note svg { flex: none; width: 19px; fill: none; stroke: #60917f; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .storage-note strong, .storage-note small { display: block; }
  .storage-note strong { color: #5d6e64; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .storage-note small { margin-top: 2px; font-size: calc(7px * var(--text-scale)); }
  .tool-workspace { position: relative; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); min-width: 0; min-height: 0; background: radial-gradient(circle at 72% -8%, rgb(77 142 118 / 9%), transparent 30%), var(--canvas); }
  .tool-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 102px; padding: 18px 30px; background: color-mix(in srgb, var(--canvas) 86%, transparent); border-bottom: 1px solid var(--line); }
  .tool-heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .hero-mark { display: grid; flex: none; width: 52px; height: 52px; color: #f7fbf9; background: linear-gradient(145deg, #5b9984, #2f6d5b); border: 1px solid #2d6857; border-radius: 15px; box-shadow: 0 10px 24px rgb(45 103 84 / 18%); font-size: calc(20px * var(--text-scale)); font-weight: 730; place-items: center; }
  .eyebrow { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 770; letter-spacing: .13em; text-transform: uppercase; }
  .tool-heading h1 { margin: 3px 0 0; color: #26352d; font-size: calc(22px * var(--text-scale)); font-weight: 730; letter-spacing: -.035em; }
  .tool-heading p { margin-top: 3px; color: #87928b; font-size: calc(8px * var(--text-scale)); }
  .header-actions { display: flex; align-items: center; gap: 13px; }
  .sync-state { display: inline-flex; align-items: center; gap: 6px; color: #738178; font-size: calc(8px * var(--text-scale)); font-weight: 660; }
  .sync-state i { width: 7px; height: 7px; background: #5da284; border-radius: 50%; box-shadow: 0 0 0 4px rgb(93 162 132 / 10%); }
  .header-actions button { display: inline-flex; align-items: center; gap: 7px; height: 35px; padding: 0 12px; color: #527265; background: color-mix(in srgb, var(--panel-soft) 72%, white); border: 1px solid #cddbd4; border-radius: 10px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .header-actions button:disabled { cursor: progress; opacity: .62; }
  .header-actions svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .header-actions button.loading svg { animation: spin .75s linear infinite; }
  .tool-tabs { display: flex; align-items: center; gap: 4px; min-height: 53px; padding: 8px 30px; background: color-mix(in srgb, var(--panel) 45%, transparent); border-bottom: 1px solid var(--line); }
  .tool-tabs button { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 35px; padding: 0 12px; color: #78857d; background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 680; transition: color 140ms ease, background 140ms ease; }
  .tool-tabs button:hover { color: #477565; background: rgb(69 127 106 / 6%); }
  .tool-tabs button.active { color: #306c59; background: color-mix(in srgb, var(--panel-soft) 78%, white); box-shadow: 0 3px 9px rgb(47 79 66 / 6%); }
  .tool-tabs svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .tool-tabs b { display: grid; min-width: 17px; height: 17px; padding: 0 4px; color: #fff; background: #b76558; border-radius: 999px; font-size: calc(6px * var(--text-scale)); place-items: center; }
  .error-banner { display: flex; align-items: center; gap: 10px; margin: 10px 30px 0; padding: 10px 12px; color: #9d4f45; background: #fff1ef; border: 1px solid #edcec8; border-radius: 11px; font-size: calc(8px * var(--text-scale)); animation: banner-in 180ms ease; }
  .error-banner > svg { flex: none; width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .error-banner span { display: grid; gap: 2px; }
  .error-banner strong { font-size: calc(8px * var(--text-scale)); }
  .error-banner button { margin-left: auto; color: inherit; background: transparent; border: 0; cursor: pointer; font-size: 18px; }
  .tool-scroll { min-width: 0; min-height: 0; padding: 24px 30px 34px; overflow: auto; scrollbar-color: #bdcac3 transparent; scrollbar-width: thin; }
  .initial-loading { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 430px; color: #87938c; text-align: center; }
  .loading-orbit { position: relative; display: grid; width: 68px; height: 68px; margin-bottom: 18px; color: #fff; background: #dfece6; border: 1px solid #c8dcd2; border-radius: 50%; place-items: center; }
  .loading-orbit i { position: absolute; inset: -6px; border: 2px solid transparent; border-top-color: #5d9984; border-right-color: #bad2c7; border-radius: 50%; animation: spin .9s linear infinite; }
  .loading-orbit b { display: grid; width: 42px; height: 42px; background: linear-gradient(145deg, #5c9b85, #316f5c); border-radius: 13px; place-items: center; }
  .initial-loading > strong { color: #4c5d53; font-size: calc(12px * var(--text-scale)); }
  .initial-loading p { margin-top: 6px; font-size: calc(8px * var(--text-scale)); }
  .training-view { max-width: 920px; margin: 0 auto; }
  .training-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 13px; }
  .training-summary article { padding: 14px 16px; background: rgb(255 255 255 / 72%); border: 1px solid #dce4df; border-radius: 13px; }
  .training-summary span { color: #7d8982; font-size: calc(7px * var(--text-scale)); font-weight: 690; text-transform: uppercase; }
  .training-summary strong { display: inline-block; margin: 0 6px 0 9px; color: #365f51; font-size: calc(16px * var(--text-scale)); font-weight: 730; }
  .training-summary small { color: #929c96; font-size: calc(7px * var(--text-scale)); }
  .training-summary .complete { border-color: #bcd7ca; }
  .training-card { padding: 28px; background: rgb(255 255 255 / 90%); border: 1px solid #d7e1db; border-radius: 21px; box-shadow: 0 22px 52px rgb(40 71 56 / 9%); animation: card-in 260ms cubic-bezier(.2,.8,.2,1); }
  .training-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .training-card header span:first-child { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .09em; text-transform: uppercase; }
  .training-card h2 { margin: 6px 0 0; color: #293930; font-size: calc(15px * var(--text-scale)); font-weight: 700; }
  .stage-badge { flex: none; padding: 5px 9px; color: #507a69; background: #eaf3ef; border: 1px solid #d0e1d9; border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .stage-track { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-top: 19px; }
  .stage-track i { height: 4px; background: #e5eae7; border-radius: 999px; }
  .stage-track i.reached { background: linear-gradient(90deg, #6aa18e, #3f7b67); }
  .training-prompt { display: grid; min-height: 170px; padding: 30px 22px; color: #24352c; font-size: calc(25px * var(--text-scale)); font-weight: 650; letter-spacing: -.025em; line-height: 1.35; place-items: center; text-align: center; white-space: pre-line; }
  .answer-panel { padding: 17px 19px; background: #eef6f2; border: 1px solid #d0e2d9; border-radius: 13px; animation: answer-in 180ms ease; }
  .answer-panel > span { color: #568273; font-size: calc(7px * var(--text-scale)); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
  .answer-panel ul { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
  .answer-panel li { color: #485c51; font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .training-actions { display: flex; justify-content: center; margin-top: 20px; }
  .training-actions.split { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 9px; }
  .training-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 180px; height: 43px; padding: 0 17px; border-radius: 11px; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 720; }
  .training-actions svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  .training-actions .reveal, .training-actions .remember { color: #f7fbf9; background: #397a67; border: 1px solid #2e6a59; box-shadow: 0 9px 20px rgb(46 106 89 / 17%); }
  .training-actions .forgot { color: #9a5849; background: #fff4f1; border: 1px solid #e5c7bf; }
  .training-actions button:disabled { cursor: progress; opacity: .62; }
  .queue-clear { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 430px; padding: 35px; background: rgb(255 255 255 / 82%); border: 1px solid #dbe4df; border-radius: 20px; box-shadow: 0 18px 44px rgb(40 71 56 / 7%); text-align: center; }
  .clear-mark { display: grid; width: 62px; height: 62px; margin-bottom: 18px; color: #43806c; background: #e8f3ee; border: 1px solid #cae0d6; border-radius: 18px; place-items: center; }
  .clear-mark svg { width: 36px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  .queue-clear h2 { margin: 8px 0 0; color: #304139; font-size: calc(20px * var(--text-scale)); }
  .queue-clear p { max-width: 470px; margin-top: 8px; color: #839087; font-size: calc(9px * var(--text-scale)); line-height: 1.55; }
  .queue-clear > div { display: flex; gap: 8px; margin-top: 20px; }
  .queue-clear button { height: 37px; padding: 0 13px; color: #4d7264; background: #f4f8f6; border: 1px solid #cedcd5; border-radius: 10px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 690; }
  .queue-clear button:first-child { color: #f7fbf9; background: #3c7b68; border-color: #316b5b; }
  .activity-view { max-width: 1000px; margin: 0 auto; }
  .activity-view > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
  .activity-view h2 { margin: 5px 0 0; color: #2d3d34; font-size: calc(21px * var(--text-scale)); }
  .activity-view header p { margin-top: 5px; color: #849087; font-size: calc(8px * var(--text-scale)); }
  .activity-view header > div:last-child { display: flex; gap: 7px; }
  .activity-view header button { height: 33px; padding: 0 10px; color: #637169; background: #fff; border: 1px solid #d5ddd8; border-radius: 9px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .activity-view header button:disabled { opacity: .45; cursor: default; }
  .activity-empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 330px; margin-top: 18px; background: rgb(255 255 255 / 75%); border: 1px dashed #cdd9d2; border-radius: 17px; text-align: center; }
  .activity-empty i { width: 18px; height: 18px; margin-bottom: 12px; background: #5c9a84; border: 5px solid #deeee7; border-radius: 50%; box-shadow: 0 0 0 1px #a8cbbd; }
  .activity-empty strong { color: #4b5d53; font-size: calc(11px * var(--text-scale)); }
  .activity-empty p { margin-top: 5px; color: #8a958e; font-size: calc(8px * var(--text-scale)); }
  .log-list { display: grid; gap: 8px; margin-top: 18px; }
  .log-list article { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; align-items: start; gap: 11px; padding: 14px 15px; background: rgb(255 255 255 / 84%); border: 1px solid #e0d8d4; border-radius: 13px; }
  .log-list article > span { width: 8px; height: 8px; margin-top: 4px; background: #c27462; border-radius: 50%; box-shadow: 0 0 0 4px rgb(194 116 98 / 10%); }
  .log-list strong { color: #6d4f47; font-size: calc(8px * var(--text-scale)); text-transform: capitalize; }
  .log-list p { margin-top: 4px; color: #825e55; font-size: calc(8px * var(--text-scale)); }
  .log-list time { color: #9a918c; font-size: calc(7px * var(--text-scale)); }
  .confirm-backdrop { position: absolute; z-index: 50; display: grid; inset: 0; padding: 24px; background: rgb(17 27 22 / 38%); backdrop-filter: blur(5px); place-items: center; animation: fade-in 150ms ease; }
  .confirm-dialog { width: min(430px, 100%); padding: 27px; background: #fff; border: 1px solid #ded9d5; border-radius: 19px; box-shadow: 0 28px 70px rgb(19 35 27 / 22%); text-align: center; animation: dialog-in 190ms cubic-bezier(.2,.8,.2,1); }
  .delete-mark { display: grid; width: 51px; height: 51px; margin: 0 auto 14px; color: #aa5b4d; background: #fff0ed; border: 1px solid #eccdc6; border-radius: 15px; place-items: center; }
  .delete-mark svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .confirm-dialog h2 { margin: 7px 0 0; color: #3b3936; font-size: calc(16px * var(--text-scale)); }
  .confirm-dialog p { margin-top: 8px; color: #827d78; font-size: calc(9px * var(--text-scale)); line-height: 1.5; }
  .confirm-dialog > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 21px; }
  .confirm-dialog button { height: 39px; color: #68746d; background: #f7f8f7; border: 1px solid #d8ddda; border-radius: 10px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 700; }
  .confirm-dialog .confirm-danger { color: #fff; background: #aa594c; border-color: #984c40; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes banner-in { from { opacity: 0; transform: translateY(-4px); } }
  @keyframes card-in { from { opacity: 0; transform: translateY(8px) scale(.995); } }
  @keyframes answer-in { from { opacity: 0; transform: translateY(4px); } }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes dialog-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  @media (max-width: 1160px) { .ilo-shell { grid-template-columns: 190px minmax(0, 1fr); } .tool-header, .tool-tabs { padding-inline: 22px; } .tool-scroll { padding-inline: 22px; } }
  @media (prefers-reduced-motion: reduce) { .loading-orbit i, .header-actions button.loading svg, .training-card, .answer-panel, .error-banner, .confirm-backdrop, .confirm-dialog { animation: none; } }
</style>
