<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import {
    LINGVOLERNANDO_ACHIEVEMENTS,
    LINGVOLERNANDO_ARTIFACTS,
    LINGVOLERNANDO_SYNERGIES,
    achievementValue,
    activeSynergies,
    artifactEffectLabel,
    lingvolernandoBonuses,
    metricsFromProgress,
  } from '../../../lib/services/lingvolernandoGame';
  import ArtifactGlyph from './ArtifactGlyph.svelte';
  import RoomHeader from './RoomHeader.svelte';

  type Props = {
    onEquip: (artifactId: string, slot: number) => void;
    onEvolve: (artifactId: string) => void;
    onHome: () => void;
    snapshot: Readonly<IloSnapshot>;
  };
  let { onEquip, onEvolve, onHome, snapshot }: Props = $props();
  let mode = $state<'artifacts' | 'atlas' | 'synergies'>('artifacts');
  let rarity = $state<'all' | 'common' | 'epic' | 'mythic' | 'rare'>('all');
  let page = $state(0);
  let selectedArtifactId = $state<string | null>(null);
  let selectedAchievementId = $state<string | null>(null);
  let achievementPath = $state('Return');

  const metrics = $derived(metricsFromProgress(snapshot.progress));
  const totalXp = $derived(metrics.serverXp + snapshot.lingvolernando.earnedXp);
  const discovered = $derived(new Set(snapshot.lingvolernando.discoveredArtifactIds));
  const claimed = $derived(new Set(snapshot.lingvolernando.claimedAchievementIds));
  const filteredArtifacts = $derived(LINGVOLERNANDO_ARTIFACTS.filter((artifact) => rarity === 'all' || artifact.rarity === rarity));
  const pageCount = $derived(Math.max(1, Math.ceil(filteredArtifacts.length / 12)));
  const artifactPage = $derived(filteredArtifacts.slice(page * 12, page * 12 + 12));
  const selectedArtifact = $derived(LINGVOLERNANDO_ARTIFACTS.find((artifact) => artifact.id === selectedArtifactId) ?? LINGVOLERNANDO_ARTIFACTS.find((artifact) => discovered.has(artifact.id)) ?? LINGVOLERNANDO_ARTIFACTS[0]);
  const active = $derived(activeSynergies(snapshot.lingvolernando.equippedArtifactIds));
  const bonuses = $derived(lingvolernandoBonuses(snapshot.lingvolernando));
  const achievements = $derived(LINGVOLERNANDO_ACHIEVEMENTS.filter((achievement) => achievement.path === achievementPath));
  const nextAchievement = $derived(achievements.find((item) => !claimed.has(item.id)) ?? achievements.at(-1) ?? null);
  const selectedAchievement = $derived(achievements.find((item) => item.id === selectedAchievementId) ?? nextAchievement);
  const selectedAchievementValue = $derived(selectedAchievement ? achievementValue(selectedAchievement, snapshot.lingvolernando, metrics) : 0);
  const selectedAchievementReward = $derived(selectedAchievement ? LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === selectedAchievement.rewardArtifactId) ?? null : null);
  const achievementPaths = ['Return', 'Lexicon', 'Rhythm', 'Vault', 'World', 'Recall'];
  const nextRareIn = $derived(Math.max(0, 3 - snapshot.lingvolernando.pity));

  function setRarity(next: typeof rarity): void {
    rarity = next;
    page = 0;
  }
</script>

<section class="vault-room">
  <RoomHeader
    eyebrow="Artifact system"
    title="Build a language constellation"
    summary="Every artifact has a permanent acquisition date and a real learning effect. Equip three, evolve duplicates, and combine traits into eight stronger engines."
    {onHome}
  />

  <nav class="vault-tabs" aria-label="Vault sections">
    <button class:active={mode === 'artifacts'} type="button" onclick={() => { mode = 'artifacts'; }}><span>120</span><div><strong>Artifact vault</strong><small>Discover, inspect, evolve</small></div></button>
    <button class:active={mode === 'atlas'} type="button" onclick={() => { mode = 'atlas'; }}><span>{snapshot.lingvolernando.claimedAchievementIds.length}</span><div><strong>Achievement atlas</strong><small>Six paths, 120 milestones</small></div></button>
    <button class:active={mode === 'synergies'} type="button" onclick={() => { mode = 'synergies'; }}><span>{active.length}</span><div><strong>Synergy chamber</strong><small>Build a three-artifact engine</small></div></button>
  </nav>

  {#if mode === 'artifacts'}
    <div class="artifact-layout">
      <section class="collection">
        <header>
          <div><span class="eyebrow">Discovery collection</span><h3>{discovered.size}/120 forms awakened</h3></div>
          <div class="rarity-filter">
            {#each ['all','common','rare','epic','mythic'] as filter}
              <button class:active={rarity === filter} type="button" onclick={() => setRarity(filter as typeof rarity)}>{filter}</button>
            {/each}
          </div>
        </header>
        <div class="artifact-grid">
          {#each artifactPage as artifact}
            {@const isDiscovered = discovered.has(artifact.id)}
            <button class:active={selectedArtifact?.id === artifact.id} class:locked={!isDiscovered} type="button" onclick={() => { selectedArtifactId = artifact.id; }} aria-label={isDiscovered ? artifact.name : `Unknown ${artifact.rarity} artifact`}>
              <ArtifactGlyph {artifact} locked={!isDiscovered} size={82} level={snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1} />
              <span><strong>{isDiscovered ? artifact.name : 'Unknown form'}</strong><small>{artifact.rarity} · {isDiscovered ? `level ${snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1}` : `${Math.max(0, artifact.unlockAt - totalXp)} XP horizon`}</small></span>
            </button>
          {/each}
        </div>
        <footer class="pagination"><button type="button" disabled={page === 0} onclick={() => { page -= 1; }}>←</button><span>Archive leaf <strong>{page + 1}</strong> / {pageCount}</span><button type="button" disabled={page >= pageCount - 1} onclick={() => { page += 1; }}>→</button></footer>
      </section>

      <aside class="artifact-inspector">
        {#if selectedArtifact}
          {@const isDiscovered = discovered.has(selectedArtifact.id)}
          {@const artifactLevel = snapshot.lingvolernando.artifactLevels[selectedArtifact.id] ?? 1}
          {@const evolveCost = 12 + artifactLevel * 8}
          <div class="artifact-stage rarity-{selectedArtifact.rarity}"><ArtifactGlyph artifact={selectedArtifact} locked={!isDiscovered} size={174} level={artifactLevel} /><span>{selectedArtifact.rarity}</span></div>
          <span class="eyebrow">{isDiscovered ? `${selectedArtifact.material} · level ${artifactLevel}` : 'Visible silhouette'}</span>
          <h3>{isDiscovered ? selectedArtifact.name : 'An unknown artifact'}</h3>
          <p>{isDiscovered ? selectedArtifact.description : 'Its shape is now part of the discovery pool. Keep completing learning pulses to reveal it.'}</p>
          {#if isDiscovered}
            <div class="artifact-purpose"><span><small>Acquired</small><strong>{snapshot.lingvolernando.artifactDiscoveredAt[selectedArtifact.id] ? new Date(snapshot.lingvolernando.artifactDiscoveredAt[selectedArtifact.id]).toLocaleString() : 'Before acquisition history'}</strong></span><span><small>Active effect</small><strong>{artifactEffectLabel(selectedArtifact, artifactLevel)}</strong></span></div>
            <div class="trait-pair"><span><small>{selectedArtifact.trait}</small><strong>+{selectedArtifact.value + artifactLevel - 1}</strong></span><span><small>{selectedArtifact.secondaryTrait}</small><strong>+{selectedArtifact.secondaryValue + Math.floor((artifactLevel - 1) / 2)}</strong></span></div>
            <div class="slot-buttons">
              {#each snapshot.lingvolernando.equippedArtifactIds as equippedId, slot}
                <button class:active={equippedId === selectedArtifact.id} type="button" onclick={() => onEquip(selectedArtifact.id, slot)}><span>{slot + 1}</span>{equippedId === selectedArtifact.id ? 'Equipped' : `Equip slot ${slot + 1}`}</button>
              {/each}
            </div>
            <button class="evolve-button" type="button" disabled={snapshot.lingvolernando.artifactDust < evolveCost} onclick={() => onEvolve(selectedArtifact.id)}><span>Evolve form</span><strong>{evolveCost} dust</strong></button>
          {:else}
            <div class="locked-message"><span></span><p>Unlock eligibility begins at {selectedArtifact.unlockAt} total XP. Discovery still uses the protected random deck.</p></div>
          {/if}
        {/if}
      </aside>
    </div>

    <section class="drop-deck">
      <div class="deck-visual"><i></i><i></i><i></i><span>{snapshot.lingvolernando.pity >= 2 ? '!' : '?'}</span></div>
      <div><span class="eyebrow">Protected discovery deck</span><h3>{snapshot.lingvolernando.pity >= 2 ? 'An artifact is guaranteed on the next learning pulse' : nextRareIn <= 1 ? 'The deck is becoming luminous' : 'Every learning pulse can reveal a form'}</h3><p>Misses increase the next chance. A long empty streak is impossible; duplicates become evolution levels and artifact dust.</p></div>
      <div class="deck-stats"><span><small>Current chance</small><strong>{Math.round(28 + snapshot.lingvolernando.pity * 8 + bonuses.artifactChancePercent)}%</strong></span><span><small>Dust · +{bonuses.dustPercent}%</small><strong>{snapshot.lingvolernando.artifactDust}</strong></span><span><small>Guarantee</small><strong>{snapshot.lingvolernando.pity >= 2 ? 'Next' : `${nextRareIn} pulses max`}</strong></span></div>
    </section>
  {:else if mode === 'atlas'}
    <div class="atlas-layout">
      <aside class="path-selector">
        <span class="eyebrow">Milestone paths</span>
        {#each achievementPaths as path}
          {@const pathItems = LINGVOLERNANDO_ACHIEVEMENTS.filter((item) => item.path === path)}
          {@const pathClaimed = pathItems.filter((item) => claimed.has(item.id)).length}
          <button class:active={achievementPath === path} type="button" onclick={() => { achievementPath = path; selectedAchievementId = null; }}><i style={`--path-accent:${pathItems[0]?.accent}`}></i><span><strong>{path}</strong><small>{pathClaimed}/20 milestones</small></span><b>{Math.round(pathClaimed / 20 * 100)}%</b></button>
        {/each}
      </aside>
      <section class="achievement-map">
        <header><div><span class="eyebrow">{achievementPath} constellation</span><h3>Twenty permanent landmarks</h3></div><strong>{achievements.filter((item) => claimed.has(item.id)).length}/20 reached</strong></header>
        <div class="milestone-road">
          {#each Array(4) as _, chapter}
            <section class="road-chapter">
              <header><span>Chapter {chapter + 1}</span><strong>{['First signal', 'Growing current', 'Deep orbit', 'Endless garden'][chapter]}</strong></header>
              <div>
                {#each achievements.slice(chapter * 5, chapter * 5 + 5) as achievement}
                  {@const value = achievementValue(achievement, snapshot.lingvolernando, metrics)}
                  {@const isClaimed = claimed.has(achievement.id)}
                  {@const isNext = nextAchievement?.id === achievement.id}
                  {@const rewardArtifact = LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === achievement.rewardArtifactId) ?? null}
                  <button
                    class:claimed={isClaimed}
                    class:next={isNext}
                    class:selected={selectedAchievement?.id === achievement.id}
                    class="milestone"
                    type="button"
                    onclick={() => { selectedAchievementId = achievement.id; }}
                    aria-label={`${achievement.name}. ${isClaimed ? 'Reached' : `${Math.min(value, achievement.target)} of ${achievement.target}`}`}
                  >
                    <span class="milestone-core"><b>{isClaimed ? '✓' : achievement.tier}</b><i></i></span>
                    <span class="milestone-copy"><small>Tier {achievement.tier}</small><strong>{achievement.name.split(': ')[1]}</strong><progress max={achievement.target} value={Math.min(value, achievement.target)}></progress><em>{isClaimed ? 'Reached' : `${Math.min(value, achievement.target)} / ${achievement.target}`}</em></span>
                    <span class="milestone-reward"><ArtifactGlyph artifact={rewardArtifact} locked={!isClaimed} size={49} /></span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
        <div class="achievement-detail">
          {#if selectedAchievement}
            <ArtifactGlyph artifact={selectedAchievementReward} locked={!claimed.has(selectedAchievement.id)} size={88} />
            <div><span class="eyebrow">{claimed.has(selectedAchievement.id) ? 'Permanent landmark reached' : nextAchievement?.id === selectedAchievement.id ? 'Next visible landmark' : 'Future landmark silhouette'}</span><h3>{selectedAchievement.name}</h3><p>{selectedAchievement.description}</p><span class="achievement-meta"><small>Reward · {claimed.has(selectedAchievement.id) ? selectedAchievementReward?.name : 'Hidden artifact silhouette'}</small><small>{snapshot.lingvolernando.achievementClaimedAt[selectedAchievement.id] ? `Reached · ${new Date(snapshot.lingvolernando.achievementClaimedAt[selectedAchievement.id]).toLocaleDateString()}` : `${selectedAchievement.metric} progress`}</small></span></div>
            <strong>{Math.min(selectedAchievementValue, selectedAchievement.target)} / {selectedAchievement.target}</strong>
          {/if}
        </div>
      </section>
    </div>
  {:else}
    <div class="synergy-layout">
      <section class="loadout-chamber">
        <header><span class="eyebrow">Three-slot loadout</span><h3>Traits become stronger together</h3><p>Select artifacts in the Vault, then combine their primary and secondary traits here.</p></header>
        <div class="loadout-orbit">
          <svg viewBox="0 0 520 390" aria-hidden="true"><circle cx="260" cy="195" r="131"/><path d="M147 128 373 128M147 262l226-134M147 128l226 134"/></svg>
          {#each snapshot.lingvolernando.equippedArtifactIds as artifactId, slot}
            {@const artifact = LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === artifactId) ?? null}
            <button class="loadout-slot slot-{slot}" type="button" onclick={() => { mode = 'artifacts'; if (artifact) selectedArtifactId = artifact.id; }}>
              <ArtifactGlyph {artifact} locked={!artifact} size={118} level={artifact ? snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1 : 1} />
              <span><small>Slot {slot + 1}</small><strong>{artifact?.name ?? 'Empty orbit'}</strong></span>
            </button>
          {/each}
          <div class:active={active.length > 0} class="synergy-core"><span>{active.length > 0 ? active.length : '—'}</span><strong>{active[0]?.name ?? 'No resonance'}</strong></div>
        </div>
      </section>
      <aside class="synergy-codex">
        <header><span class="eyebrow">Synergy codex</span><h3>{active.length}/8 active</h3></header>
        {#each LINGVOLERNANDO_SYNERGIES as synergy}
          {@const isActive = active.some((item) => item.id === synergy.id)}
          <article class:active={isActive} style={`--synergy-accent:${synergy.accent}`}><span>{isActive ? '✓' : '?'}</span><div><strong>{isActive ? synergy.name : 'Hidden resonance'}</strong><p>{isActive ? synergy.description : Object.entries(synergy.requiredTraits).map(([trait,count]) => `${count}× ${trait}`).join(' + ')}</p></div></article>
        {/each}
      </aside>
    </div>
  {/if}
</section>

<style>
  .vault-room{display:grid;gap:15px;padding:24px;animation:scene-in .32s ease-out}.eyebrow{color:var(--sui-primary);font-size:calc(7px * var(--text-scale));font-weight:820;letter-spacing:.14em;text-transform:uppercase}.vault-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.vault-tabs button{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:10px;min-height:68px;padding:10px 13px;color:var(--sui-text-muted);text-align:left;background:var(--sui-bg);border:1px solid transparent;border-radius:17px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer;transition:transform .15s ease,color .15s ease,box-shadow .15s ease}.vault-tabs button:hover{transform:translateY(-2px);color:var(--sui-text)}.vault-tabs button.active{color:var(--sui-primary);border-color:rgb(91 84 224 / 20%);box-shadow:var(--sui-shadow-inset-sm)}.vault-tabs>button>span{display:grid;width:46px;height:46px;font-size:calc(11px * var(--text-scale));font-weight:850;background:var(--sui-bg);border-radius:14px;box-shadow:var(--sui-shadow-raised-sm);place-items:center}.vault-tabs div{display:grid;gap:3px}.vault-tabs strong{font-size:calc(10px * var(--text-scale))}.vault-tabs small{font-size:calc(7px * var(--text-scale))}
  .artifact-layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:14px}.collection,.artifact-inspector,.drop-deck,.path-selector,.achievement-map,.loadout-chamber,.synergy-codex{background:var(--sui-bg);border-radius:23px;box-shadow:var(--sui-shadow-raised)}.collection{display:grid;gap:13px;padding:17px}.collection>header{display:flex;align-items:end;justify-content:space-between;gap:14px}.collection h3,.artifact-inspector h3,.drop-deck h3,.achievement-map h3,.achievement-detail h3,.loadout-chamber h3,.synergy-codex h3{margin:2px 0 0;color:var(--sui-text);font-size:calc(15px * var(--text-scale));letter-spacing:-.035em}.rarity-filter{display:flex;gap:5px}.rarity-filter button{padding:6px 9px;color:var(--sui-text-muted);font:inherit;font-size:calc(6px * var(--text-scale));font-weight:720;background:var(--sui-bg);border:0;border-radius:9px;box-shadow:var(--sui-shadow-raised-sm);text-transform:capitalize;cursor:pointer}.rarity-filter button.active{color:var(--sui-primary);box-shadow:var(--sui-shadow-inset-sm)}.artifact-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.artifact-grid>button{display:grid;grid-template-columns:82px minmax(0,1fr);align-items:center;min-height:91px;padding:4px 7px;color:var(--sui-text);text-align:left;background:var(--sui-bg);border:1px solid transparent;border-radius:15px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}.artifact-grid>button:hover{transform:translateY(-2px);box-shadow:var(--sui-shadow-raised)}.artifact-grid>button.active{border-color:rgb(91 84 224 / 27%);box-shadow:var(--sui-shadow-inset-sm)}.artifact-grid>button.locked{opacity:.58}.artifact-grid>button>span{display:grid;gap:3px;min-width:0}.artifact-grid strong,.artifact-grid small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-grid strong{font-size:calc(7px * var(--text-scale))}.artifact-grid small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));text-transform:capitalize}.pagination{display:flex;align-items:center;justify-content:center;gap:12px}.pagination button{display:grid;width:34px;height:34px;color:var(--sui-primary);font:inherit;background:var(--sui-bg);border:0;border-radius:10px;box-shadow:var(--sui-shadow-raised-sm);place-items:center;cursor:pointer}.pagination button:disabled{opacity:.35;box-shadow:var(--sui-shadow-inset-sm)}.pagination span{color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale))}.pagination strong{color:var(--sui-text)}
  .artifact-inspector{display:grid;align-content:start;gap:9px;padding:17px}.artifact-stage{position:relative;display:grid;min-height:205px;background:radial-gradient(circle,color-mix(in srgb,var(--artifact-tone,#756be8) 12%,var(--sui-bg-light)),var(--sui-bg));border-radius:18px;box-shadow:var(--sui-shadow-inset);place-items:center}.artifact-stage>span{position:absolute;right:9px;bottom:8px;padding:4px 7px;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));font-weight:760;background:var(--sui-bg);border-radius:8px;text-transform:capitalize}.artifact-inspector>p{margin:0;color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale));line-height:1.5}.trait-pair{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.trait-pair>span{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:9px;background:var(--sui-bg);border-radius:11px;box-shadow:var(--sui-shadow-inset-sm)}.trait-pair small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));text-transform:capitalize}.trait-pair strong{color:var(--sui-primary);font-size:calc(9px * var(--text-scale))}.slot-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.slot-buttons button{display:grid;gap:2px;padding:7px 4px;color:var(--sui-text-muted);font:inherit;font-size:calc(6px * var(--text-scale));font-weight:720;background:var(--sui-bg);border:0;border-radius:10px;box-shadow:var(--sui-shadow-raised-sm);place-items:center;cursor:pointer}.slot-buttons button.active{color:var(--sui-primary);box-shadow:var(--sui-shadow-inset-sm)}.slot-buttons span{font-size:calc(8px * var(--text-scale));font-weight:850}.evolve-button{display:flex;align-items:center;justify-content:space-between;min-height:42px;padding:0 13px;color:#fff;font:inherit;font-size:calc(8px * var(--text-scale));font-weight:760;background:linear-gradient(135deg,#665de5,#5149ce);border:0;border-radius:12px;box-shadow:0 7px 17px rgb(91 84 224 / 24%);cursor:pointer}.evolve-button:disabled{color:var(--sui-text-muted);background:var(--sui-bg-dark);box-shadow:var(--sui-shadow-inset-sm);cursor:default}.locked-message{display:grid;grid-template-columns:12px 1fr;gap:8px;padding:10px;background:var(--sui-bg);border-radius:12px;box-shadow:var(--sui-shadow-inset-sm)}.locked-message span{width:9px;height:9px;margin-top:3px;background:#949eb0;border-radius:50%}.locked-message p{margin:0;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));line-height:1.4}
  .artifact-purpose{display:grid;gap:6px;padding:9px 10px;background:color-mix(in srgb,var(--sui-bg-light) 86%,#d8d4ef 14%);border-radius:12px;box-shadow:var(--sui-shadow-inset-sm)}.artifact-purpose>span{display:grid;gap:2px}.artifact-purpose small{color:var(--sui-primary);font-size:calc(5px * var(--text-scale));font-weight:820;letter-spacing:.08em;text-transform:uppercase}.artifact-purpose strong{color:var(--sui-text);font-size:calc(7px * var(--text-scale));line-height:1.35}
  .drop-deck{display:grid;grid-template-columns:78px minmax(0,1fr) auto;align-items:center;gap:15px;padding:14px 17px}.deck-visual{position:relative;width:72px;height:60px}.deck-visual i{position:absolute;inset:6px 11px;background:var(--sui-bg);border:1px solid rgb(91 84 224 / 14%);border-radius:11px;box-shadow:var(--sui-shadow-raised-sm);transform:rotate(-8deg)}.deck-visual i:nth-child(2){transform:rotate(7deg)}.deck-visual i:nth-child(3){transform:none}.deck-visual>span{position:absolute;inset:6px 11px;display:grid;color:var(--sui-primary);font-size:calc(15px * var(--text-scale));font-weight:850;place-items:center}.drop-deck p,.loadout-chamber p{margin:3px 0 0;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));line-height:1.4}.deck-stats{display:grid;grid-template-columns:repeat(3,auto);gap:8px}.deck-stats>span{display:grid;gap:2px;min-width:85px;padding:8px 10px;background:var(--sui-bg);border-radius:11px;box-shadow:var(--sui-shadow-inset-sm)}.deck-stats small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale))}.deck-stats strong{font-size:calc(9px * var(--text-scale))}
  .atlas-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px}.path-selector{display:grid;align-content:start;gap:8px;padding:15px}.path-selector>.eyebrow{padding:4px}.path-selector button{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:58px;padding:8px;color:var(--sui-text-muted);text-align:left;background:var(--sui-bg);border:0;border-radius:13px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.path-selector button.active{color:var(--sui-text);box-shadow:var(--sui-shadow-inset-sm)}.path-selector i{width:7px;height:35px;background:var(--path-accent);border-radius:9px}.path-selector span{display:grid;gap:2px}.path-selector strong{font-size:calc(8px * var(--text-scale))}.path-selector small{font-size:calc(6px * var(--text-scale))}.path-selector b{font-size:calc(7px * var(--text-scale))}.achievement-map{display:grid;gap:12px;padding:17px}.achievement-map>header{display:flex;align-items:end;justify-content:space-between;gap:12px}.achievement-map>header>strong{color:var(--sui-primary);font-size:calc(11px * var(--text-scale))}.milestone-road{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:11px;background:linear-gradient(145deg,color-mix(in srgb,var(--sui-bg-light) 78%,#d9e6e2 22%),color-mix(in srgb,var(--sui-bg) 83%,#d9d5ef 17%));border-radius:19px;box-shadow:var(--sui-shadow-inset)}.road-chapter{display:grid;align-content:start;gap:7px;padding:9px;background:color-mix(in srgb,var(--sui-bg-light) 74%,transparent);border:1px solid rgb(255 255 255 / 24%);border-radius:15px;box-shadow:var(--sui-shadow-raised-sm)}.road-chapter>header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 4px}.road-chapter>header span{color:var(--sui-primary);font-size:calc(5px * var(--text-scale));font-weight:820;letter-spacing:.11em;text-transform:uppercase}.road-chapter>header strong{font-size:calc(7px * var(--text-scale))}.road-chapter>div{position:relative;display:grid;gap:6px}.road-chapter>div::before{position:absolute;top:22px;bottom:22px;left:22px;width:3px;background:linear-gradient(#756ce4,#42aa91);border-radius:99px;content:'';opacity:.4}.milestone{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) 51px;align-items:center;gap:7px;min-width:0;min-height:64px;padding:6px;color:var(--sui-text-muted);text-align:left;background:var(--sui-bg);border:1px solid transparent;border-radius:13px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer;transition:transform .15s ease,color .15s ease,box-shadow .15s ease}.milestone:hover{z-index:2;color:var(--sui-text);transform:translateX(2px)}.milestone.selected{color:var(--sui-text);border-color:rgb(91 84 224 / 26%);box-shadow:var(--sui-shadow-inset-sm)}.milestone.claimed{color:var(--sui-text)}.milestone.next{border-color:rgb(55 169 139 / 28%)}.milestone-core{position:relative;z-index:1;display:grid;width:42px;height:42px;color:var(--sui-text-muted);background:var(--sui-bg);border-radius:50%;box-shadow:var(--sui-shadow-raised-sm);place-items:center}.claimed .milestone-core{color:white;background:linear-gradient(145deg,#756ce8,#5149cf);box-shadow:0 6px 15px rgb(91 84 224 / 28%)}.next .milestone-core{color:white;background:linear-gradient(145deg,#52b69c,#288e76)}.milestone-core b{font-size:calc(7px * var(--text-scale))}.milestone-core i{position:absolute;inset:-4px;border:1px dashed rgb(91 84 224 / 25%);border-radius:50%}.next .milestone-core i{animation:milestone-ring 8s linear infinite}.milestone-copy{display:grid;gap:2px;min-width:0}.milestone-copy small{color:var(--sui-primary);font-size:calc(5px * var(--text-scale));font-weight:790;text-transform:uppercase}.milestone-copy strong{overflow:hidden;font-size:calc(7px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.milestone-copy em{color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale));font-style:normal}.milestone progress{width:100%;height:4px;border:0;border-radius:99px}.milestone progress::-webkit-progress-bar{background:var(--sui-bg-dark);border-radius:99px}.milestone progress::-webkit-progress-value{background:linear-gradient(90deg,#675fe2,#42aa91);border-radius:99px}.milestone-reward{display:grid;width:49px;height:49px;overflow:hidden;border-radius:12px;box-shadow:var(--sui-shadow-inset-sm);place-items:center}.achievement-detail{display:grid;grid-template-columns:88px minmax(0,1fr) auto;align-items:center;gap:12px;padding:10px 12px;background:var(--sui-bg);border-radius:16px;box-shadow:var(--sui-shadow-inset-sm)}.achievement-detail p{margin:2px 0 0;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));line-height:1.4}.achievement-detail>strong{padding:8px;color:var(--sui-primary);font-size:calc(11px * var(--text-scale))}.achievement-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.achievement-meta small{padding:4px 7px;color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale));font-weight:700;background:var(--sui-bg-dark);border-radius:7px}
  .synergy-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px}.loadout-chamber{display:grid;gap:12px;padding:20px}.loadout-orbit{position:relative;min-height:460px;overflow:hidden;background:radial-gradient(circle at center,rgb(111 101 226 / 12%),transparent 36%),var(--sui-bg);border-radius:22px;box-shadow:var(--sui-shadow-inset)}.loadout-orbit>svg{position:absolute;top:50%;left:50%;width:min(520px,90%);height:390px;transform:translate(-50%,-50%)}.loadout-orbit>svg circle,.loadout-orbit>svg path{fill:none;stroke:rgb(91 84 224 / 22%);stroke-width:2;stroke-dasharray:6 9}.loadout-slot{position:absolute;display:grid;width:170px;padding:7px;color:var(--sui-text);background:transparent;border:0;place-items:center;cursor:pointer;transform:translate(-50%,-50%)}.loadout-slot span{display:grid;gap:2px;padding:5px 8px;background:var(--sui-bg);border-radius:9px;box-shadow:var(--sui-shadow-raised-sm)}.loadout-slot small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale))}.loadout-slot strong{max-width:130px;overflow:hidden;font-size:calc(7px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.slot-0{top:22%;left:28%}.slot-1{top:22%;left:72%}.slot-2{top:76%;left:50%}.synergy-core{position:absolute;top:50%;left:50%;display:grid;width:125px;height:125px;color:var(--sui-text-muted);background:var(--sui-bg);border-radius:50%;box-shadow:var(--sui-shadow-inset);place-items:center;transform:translate(-50%,-50%)}.synergy-core.active{color:var(--sui-primary);box-shadow:0 0 35px rgb(91 84 224 / 22%),var(--sui-shadow-raised)}.synergy-core span{font-size:calc(17px * var(--text-scale));font-weight:850}.synergy-core strong{max-width:95px;font-size:calc(7px * var(--text-scale));text-align:center}.synergy-codex{display:grid;align-content:start;gap:8px;padding:16px}.synergy-codex>header{display:flex;align-items:end;justify-content:space-between;margin-bottom:3px}.synergy-codex article{display:grid;grid-template-columns:34px minmax(0,1fr);align-items:center;gap:9px;min-height:55px;padding:8px 10px;opacity:.55;background:var(--sui-bg);border:1px solid transparent;border-radius:13px;box-shadow:var(--sui-shadow-inset-sm)}.synergy-codex article.active{opacity:1;border-color:color-mix(in srgb,var(--synergy-accent) 28%,transparent);box-shadow:var(--sui-shadow-raised-sm)}.synergy-codex article>span{display:grid;width:34px;height:34px;color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale));font-weight:850;background:var(--sui-bg-dark);border-radius:10px;place-items:center}.synergy-codex article.active>span{color:white;background:var(--synergy-accent)}.synergy-codex article div{display:grid;gap:2px}.synergy-codex article strong{font-size:calc(8px * var(--text-scale))}.synergy-codex article p{margin:0;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));line-height:1.3}
  @keyframes scene-in{from{opacity:0;transform:translateY(8px)}}@keyframes milestone-ring{to{transform:rotate(360deg)}}
  @media(max-width:1180px){.artifact-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.artifact-layout{grid-template-columns:1fr}.artifact-inspector{grid-template-columns:220px minmax(0,1fr);align-items:start}.artifact-stage{grid-row:1/8}.atlas-layout,.synergy-layout{grid-template-columns:1fr}.path-selector{grid-template-columns:repeat(3,minmax(0,1fr))}.path-selector>.eyebrow{grid-column:1/-1}.synergy-codex{grid-template-columns:repeat(2,minmax(0,1fr))}.synergy-codex>header{grid-column:1/-1}}
  @media(max-width:780px){.vault-room{padding:17px}.vault-tabs{grid-template-columns:1fr}.artifact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.collection>header{align-items:flex-start;flex-direction:column}.rarity-filter{flex-wrap:wrap}.artifact-inspector{grid-template-columns:1fr}.artifact-stage{grid-row:auto}.drop-deck{grid-template-columns:65px 1fr}.deck-stats{grid-column:1/-1}.path-selector{grid-template-columns:repeat(2,minmax(0,1fr))}.milestone-road{grid-template-columns:1fr}.achievement-detail{grid-template-columns:70px 1fr}.achievement-detail>strong{grid-column:1/-1}.synergy-codex{grid-template-columns:1fr}.loadout-orbit{min-height:540px}.slot-0{top:18%;left:28%}.slot-1{top:18%;left:72%}.slot-2{top:80%;left:50%}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
