<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import {
    LINGVOLERNANDO_ARTIFACTS,
    LINGVOLERNANDO_BIOMES,
    LINGVOLERNANDO_WORLD,
    activeSynergies,
    journeyWordForGame,
    lingvolernandoBonuses,
    metricsFromProgress,
  } from '../../../lib/services/lingvolernandoGame';
  import ArtifactGlyph from './ArtifactGlyph.svelte';
  import LumaCreature from './LumaCreature.svelte';
  import WorldSprite from './WorldSprite.svelte';

  export type LingvolernandoRoom = 'companion' | 'insights' | 'journey' | 'vault' | 'world';
  type Props = {
    onNavigate: (room: LingvolernandoRoom) => void;
    onTrain: () => void;
    snapshot: Readonly<IloSnapshot>;
  };

  let { onNavigate, onTrain, snapshot }: Props = $props();
  const metrics = $derived(metricsFromProgress(snapshot.progress));
  const totalXp = $derived(metrics.serverXp + snapshot.lingvolernando.earnedXp);
  const level = $derived(Math.floor(Math.sqrt(totalXp / 70)) + 1);
  const levelFloor = $derived((level - 1) ** 2 * 70);
  const levelCeiling = $derived(level ** 2 * 70);
  const levelProgress = $derived(Math.max(0, Math.min(100, ((totalXp - levelFloor) / Math.max(1, levelCeiling - levelFloor)) * 100)));
  const currentBiome = $derived(LINGVOLERNANDO_BIOMES[snapshot.lingvolernando.selectedBiome] ?? LINGVOLERNANDO_BIOMES[0]);
  const discoveredArtifacts = $derived(snapshot.lingvolernando.discoveredArtifactIds.length);
  const discoveredWorld = $derived(snapshot.lingvolernando.discoveredWorldIds.length);
  const synergies = $derived(activeSynergies(snapshot.lingvolernando.equippedArtifactIds));
  const bonuses = $derived(lingvolernandoBonuses(snapshot.lingvolernando));
  const equippedArtifact = $derived(LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === snapshot.lingvolernando.equippedArtifactIds[0]) ?? null);
  const orbitArtifacts = $derived((snapshot.lingvolernando.pet.accessoryArtifactIds.length > 0
    ? snapshot.lingvolernando.pet.accessoryArtifactIds
    : snapshot.lingvolernando.equippedArtifactIds.filter((id): id is string => Boolean(id)))
    .map((id) => LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === id))
    .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
    .slice(0, 3));
  const newestWorld = $derived(LINGVOLERNANDO_WORLD.find((item) => item.id === snapshot.lingvolernando.discoveredWorldIds.at(-1)) ?? LINGVOLERNANDO_WORLD[0]);
  const nextArtifact = $derived(LINGVOLERNANDO_ARTIFACTS.find((item) => !snapshot.lingvolernando.discoveredArtifactIds.includes(item.id) && item.unlockAt > totalXp) ?? null);
  const answers = $derived(snapshot.lingvolernando.learning.rememberedAnswers + snapshot.lingvolernando.learning.forgottenAnswers);
  const accuracy = $derived(answers > 0 ? Math.round(snapshot.lingvolernando.learning.rememberedAnswers / answers * 100) : 50);
  const journeyReady = $derived(Boolean(journeyWordForGame(snapshot.lingvolernando)));

  const rooms = $derived<Array<{ id: LingvolernandoRoom | 'train'; label: string; note: string; icon: string; position: string }>>([
    { id: 'journey', label: 'Memory trail', note: journeyReady ? 'An old word is waiting' : `${snapshot.lingvolernando.journey.words.length} mature words queued`, icon: 'path', position: 'north-west' },
    { id: 'world', label: 'Living world', note: `${discoveredWorld}/120 permanent boosts`, icon: 'world', position: 'north-east' },
    { id: 'companion', label: snapshot.lingvolernando.pet.name, note: 'Look, rename, and customise', icon: 'pet', position: 'east' },
    { id: 'vault', label: 'Vault', note: `${discoveredArtifacts}/120 artifacts`, icon: 'vault', position: 'south-east' },
    { id: 'insights', label: 'Progress', note: `${accuracy}% recall · clear charts`, icon: 'insights', position: 'south-west' },
    { id: 'train', label: 'Train words', note: snapshot.progress.due > 0 ? `${snapshot.progress.due} ready now` : 'Review queue is clear', icon: 'train', position: 'west' },
  ]);
</script>

<section class="home" aria-labelledby="lingvolernando-home-title">
  <header class="home-intro">
    <div>
      <span class="eyebrow">German learning sanctuary</span>
      <h2 id="lingvolernando-home-title">Every word changes this place.</h2>
      <p>Review German words. Every ten remembered or twenty forgotten answers creates a discovery — automatically.</p>
    </div>
    <div class="level-card">
      <span>Level {level}</span>
      <strong>{totalXp.toLocaleString()} XP</strong>
      <div aria-label={`${Math.round(levelProgress)} percent to next level`}><i style={`width:${levelProgress}%`}></i></div>
      <small>{Math.max(0, levelCeiling - totalXp)} XP to the next orbit</small>
    </div>
  </header>

  <div class="sanctuary">
    <svg class="route-lines" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
      <path d="M500 310C420 210 315 180 202 160M500 310c88-105 190-135 307-154M500 310c127-18 232 15 337 77M500 310c102 77 183 127 281 190M500 310c-85 83-158 137-271 187M500 310c-125-17-220 15-318 83"/>
    </svg>
    <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div><div class="ambient ambient-c"></div>

    {#each rooms as room}
      <button class="room-node {room.position}" type="button" onclick={() => room.id === 'train' ? onTrain() : onNavigate(room.id)} aria-label={`${room.label}. ${room.note}`}>
        <span class="node-icon">
          {#if room.icon === 'path'}<svg viewBox="0 0 24 24"><path d="M5 19c5-1 2-7 7-8s4-5 7-6"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>
          {:else if room.icon === 'world'}<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c4 4 4 12 0 16M12 4c-4 4-4 12 0 16"/></svg>
          {:else if room.icon === 'pet'}<svg viewBox="0 0 24 24"><path d="M7 10 5 5l5 3h4l5-3-2 5c2 5-1 9-5 9s-7-4-5-9Z"/><path d="M9 13h.1M15 13h.1M10 16c1 1 3 1 4 0"/></svg>
          {:else if room.icon === 'vault'}<svg viewBox="0 0 24 24"><path d="M5 8h14v11H5zM8 8V5h8v3"/><circle cx="12" cy="13" r="2"/><path d="M12 15v2"/></svg>
          {:else if room.icon === 'insights'}<svg viewBox="0 0 24 24"><path d="M5 18V11M10 18V6M15 18v-4M20 18V8"/></svg>
          {:else}<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/><circle cx="12" cy="12" r="9"/></svg>{/if}
        </span>
        <span><strong>{room.label}</strong><small>{room.note}</small></span>
        <svg class="node-arrow" viewBox="0 0 20 20"><path d="m8 5 5 5-5 5"/></svg>
      </button>
    {/each}

    <button class="luma-core" type="button" onclick={() => onNavigate('companion')} aria-label="Visit Luma, your living language companion">
      <span class="core-rings"></span>
      <span class="artifact-orbit" aria-hidden="true">
        {#each orbitArtifacts as artifact, index}
          <i class="orbit-slot orbit-{index}"><ArtifactGlyph {artifact} size={57 - index * 5} level={snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1} /></i>
        {/each}
      </span>
      <LumaCreature mood={snapshot.lingvolernando.pet.mood} palette={snapshot.lingvolernando.pet.palette} size={184} />
      <span class="luma-label"><strong>{snapshot.lingvolernando.pet.name}</strong><small>{snapshot.lingvolernando.pet.mood} · {accuracy}% recall</small></span>
    </button>

    <article class="world-peek" style={`--biome-accent:${currentBiome.accent}`}>
      <WorldSprite element={newestWorld} locked={!snapshot.lingvolernando.discoveredWorldIds.includes(newestWorld.id)} size={68} />
      <span><small>{currentBiome.name}</small><strong>{snapshot.lingvolernando.discoveredWorldIds.includes(newestWorld.id) ? newestWorld.name : 'First silhouette'}</strong></span>
    </article>
    <article class="artifact-peek">
      <ArtifactGlyph artifact={equippedArtifact ?? nextArtifact} locked={!equippedArtifact} size={72} level={equippedArtifact ? snapshot.lingvolernando.artifactLevels[equippedArtifact.id] ?? 1 : 1} />
      <span><small>{equippedArtifact ? 'Active artifact' : 'Next silhouette'}</small><strong>{equippedArtifact?.name ?? 'Unknown form'}</strong></span>
    </article>
  </div>

  <div class="action-dock">
    <div class="action-copy">
      <span class="action-orb" aria-hidden="true"><i></i></span>
      <div><small>Automatic learning pulse</small><strong>{snapshot.progress.due > 0 ? `${snapshot.progress.due} German cards are ready` : 'Your scheduled queue is complete'}</strong><p>{snapshot.lingvolernando.learning.rememberedTowardAction}/10 remembered · {snapshot.lingvolernando.learning.forgottenTowardAction}/20 forgotten toward the next reward.</p></div>
    </div>
    <div class="action-buttons">
      <button class="claim-button" type="button" onclick={onTrain}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>
        Continue training
      </button>
    </div>
  </div>

  <footer class="home-status">
    <button type="button" onclick={() => onNavigate('vault')}><span>Loadout</span><strong>{synergies[0]?.name ?? `${snapshot.lingvolernando.equippedArtifactIds.filter(Boolean).length}/3 artifacts`}</strong></button>
    <button type="button" onclick={() => onNavigate('world')}><span>World engine</span><strong>+{bonuses.worldLightPercent}% light</strong></button>
    <button type="button" onclick={() => onNavigate('vault')}><span>Discovery odds</span><strong>{snapshot.lingvolernando.pity >= 2 ? 'Guaranteed' : `${Math.round(28 + snapshot.lingvolernando.pity * 8 + bonuses.artifactChancePercent)}%`}</strong></button>
    <button type="button" onclick={() => onNavigate('journey')}><span>Memory trail</span><strong>Position {snapshot.lingvolernando.journey.position}</strong></button>
  </footer>
</section>

<style>
  .home { display:grid; gap:16px; min-height:100%; padding:24px; animation:scene-in .36s ease-out; }
  .home-intro { display:flex; align-items:center; justify-content:space-between; gap:25px; }
  .eyebrow { display:block; margin-bottom:7px; color:var(--sui-primary); font-size:calc(8px * var(--text-scale)); font-weight:830; letter-spacing:.17em; text-transform:uppercase; }
  h2 { max-width:720px; margin:0; color:var(--sui-text); font-size:clamp(calc(31px * var(--text-scale)),3.9vw,calc(52px * var(--text-scale))); line-height:.98; letter-spacing:-.055em; }
  .home-intro p { max-width:680px; margin:12px 0 0; color:var(--sui-text-muted); font-size:calc(10px * var(--text-scale)); line-height:1.55; }
  .level-card { display:grid; min-width:210px; gap:4px; padding:15px 17px; background:var(--sui-bg); border-radius:17px; box-shadow:var(--sui-shadow-raised); }
  .level-card>span,.level-card small { color:var(--sui-text-muted); font-size:calc(8px * var(--text-scale)); font-weight:690; }
  .level-card strong { color:var(--sui-text); font-size:calc(15px * var(--text-scale)); }
  .level-card>div { height:7px; margin:5px 0 2px; overflow:hidden; background:var(--sui-bg-dark); border-radius:99px; box-shadow:var(--sui-shadow-inset-sm); }
  .level-card i { display:block; height:100%; background:linear-gradient(90deg,#5b54e0,#8a7cf3,#43b1a0); border-radius:inherit; box-shadow:0 0 10px rgb(91 84 224 / 42%); transition:width .45s ease; }
  .sanctuary { position:relative; min-height:520px; overflow:hidden; background:linear-gradient(145deg,color-mix(in srgb,var(--sui-bg-light) 70%,#dddff7 30%),var(--sui-bg)); border:1px solid color-mix(in srgb,var(--sui-primary) 13%,transparent); border-radius:30px; box-shadow:var(--sui-shadow-inset),0 14px 35px rgb(64 76 100 / 8%); isolation:isolate; }
  .route-lines { position:absolute; inset:0; z-index:-1; width:100%; height:100%; }
  .route-lines path { fill:none; stroke:color-mix(in srgb,var(--sui-primary) 32%,transparent); stroke-width:2.4; stroke-dasharray:6 9; vector-effect:non-scaling-stroke; animation:route 16s linear infinite; }
  .ambient { position:absolute; z-index:-2; border-radius:50%; filter:blur(10px); opacity:.42; animation:ambient 9s ease-in-out infinite; }
  .ambient-a{width:280px;height:280px;top:-90px;left:8%;background:#bcded6}.ambient-b{width:340px;height:340px;right:4%;bottom:-150px;background:#d3c9ef;animation-delay:-3s}.ambient-c{width:190px;height:190px;top:42%;left:41%;background:#f2d9b3;animation-delay:-6s}
  .room-node { position:absolute; z-index:3; display:grid; grid-template-columns:44px minmax(0,1fr) 17px; align-items:center; gap:10px; width:224px; min-height:70px; padding:10px 11px; color:var(--sui-text); text-align:left; background:color-mix(in srgb,var(--sui-bg-light) 84%,transparent); border:1px solid color-mix(in srgb,white 55%,transparent); border-radius:19px; box-shadow:var(--sui-shadow-raised); backdrop-filter:blur(12px); cursor:pointer; transition:transform .18s ease,box-shadow .18s ease,background .18s ease; }
  .room-node:hover { z-index:5; transform:translateY(-4px) scale(1.025); background:var(--sui-bg-light); box-shadow:var(--sui-shadow-raised-lg); }
  .room-node:active { transform:translateY(0); box-shadow:var(--sui-shadow-inset-sm); }
  .room-node.north-west{top:11%;left:5%}.room-node.north-east{top:10%;right:5%}.room-node.east{top:44%;right:2.5%}.room-node.south-east{right:8%;bottom:7%}.room-node.south-west{left:8%;bottom:7%}.room-node.west{top:45%;left:2.5%}
  .node-icon { display:grid; width:44px; height:44px; color:var(--sui-primary); background:var(--sui-bg); border-radius:14px; box-shadow:var(--sui-shadow-inset-sm); place-items:center; }
  .node-icon svg { width:23px; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
  .room-node>span:nth-child(2){display:grid;gap:3px;min-width:0}.room-node strong{font-size:calc(10px * var(--text-scale));letter-spacing:-.02em}.room-node small{overflow:hidden;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.node-arrow{width:16px;fill:none;stroke:var(--sui-primary);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .luma-core { position:absolute; top:50%; left:50%; z-index:2; display:grid; width:230px; height:230px; padding:0; color:var(--sui-text); background:radial-gradient(circle at 42% 35%,var(--sui-bg-light),var(--sui-bg)); border:0; border-radius:50%; box-shadow:var(--sui-shadow-raised-lg),inset 0 0 0 1px color-mix(in srgb,var(--sui-primary) 12%,transparent); place-items:center; cursor:pointer; transform:translate(-50%,-50%); transition:transform .2s ease,box-shadow .2s ease; }
  .luma-core:hover { transform:translate(-50%,-52%) scale(1.025); box-shadow:0 20px 50px rgb(70 72 124 / 24%); }
  .core-rings { position:absolute; inset:-19px; border:1px dashed color-mix(in srgb,var(--sui-primary) 42%,transparent); border-radius:50%; animation:core-ring 18s linear infinite; }
  .core-rings::before,.core-rings::after { position:absolute; width:8px; height:8px; background:var(--sui-primary); border-radius:50%; box-shadow:0 0 12px var(--sui-primary); content:''; }.core-rings::before{top:30px;left:18px}.core-rings::after{right:13px;bottom:42px}
  .luma-core :global(.luma){position:relative;z-index:2;margin-top:-20px}.artifact-orbit{position:absolute;inset:-27px;z-index:1;border-radius:50%;animation:artifact-orbit 17s linear infinite;pointer-events:none}.orbit-slot{position:absolute;display:grid;width:62px;height:62px;filter:drop-shadow(0 7px 8px rgb(57 64 87 / 22%));place-items:center;animation:artifact-counter 17s linear infinite}.orbit-0{top:-8px;left:50%;transform:translateX(-50%)}.orbit-1{right:-2px;bottom:30px}.orbit-2{bottom:30px;left:-2px}.luma-label{position:absolute;right:22px;bottom:18px;left:22px;z-index:4;display:grid;gap:2px;padding:8px 12px;background:color-mix(in srgb,var(--sui-bg-light) 82%,transparent);border-radius:12px;box-shadow:var(--sui-shadow-raised-sm);backdrop-filter:blur(8px)}.luma-label strong{font-size:calc(10px * var(--text-scale))}.luma-label small{color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));text-transform:capitalize}
  .world-peek,.artifact-peek { position:absolute; z-index:1; display:flex; align-items:center; gap:2px; opacity:.78; pointer-events:none; }.world-peek{left:26%;bottom:25%}.artifact-peek{top:25%;right:26%}.world-peek span,.artifact-peek span{display:grid;gap:2px}.world-peek small,.artifact-peek small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));font-weight:760;text-transform:uppercase}.world-peek strong,.artifact-peek strong{max-width:120px;color:var(--sui-text);font-size:calc(8px * var(--text-scale));line-height:1.1}
  .action-dock { display:flex; align-items:center; justify-content:space-between; gap:22px; padding:16px 17px 16px 20px; background:var(--sui-bg); border-radius:21px; box-shadow:var(--sui-shadow-raised); }
  .action-copy{display:flex;align-items:center;gap:14px;min-width:0}.action-copy>div{display:grid;gap:2px}.action-copy small{color:var(--sui-primary);font-size:calc(7px * var(--text-scale));font-weight:820;letter-spacing:.12em;text-transform:uppercase}.action-copy strong{color:var(--sui-text);font-size:calc(12px * var(--text-scale));letter-spacing:-.025em}.action-copy p{margin:1px 0 0;color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale))}.action-orb{position:relative;display:grid;width:48px;height:48px;flex:0 0 auto;background:var(--sui-bg);border-radius:50%;box-shadow:var(--sui-shadow-inset);place-items:center}.action-orb::before,.action-orb::after,.action-orb i{position:absolute;border-radius:50%;content:''}.action-orb::before{width:24px;height:24px;background:linear-gradient(145deg,#8c81f5,#574fd7);box-shadow:0 5px 13px rgb(91 84 224 / 35%)}.action-orb::after{width:34px;height:34px;border:1px dashed #7369e7;animation:core-ring 7s linear infinite}.action-orb i{width:5px;height:5px;background:white;transform:translate(5px,-5px)}
  .action-buttons { display:flex; flex:0 0 auto; gap:9px; }.action-buttons button{min-height:46px;padding:0 18px;font:inherit;font-size:calc(9px * var(--text-scale));font-weight:760;border:0;border-radius:14px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}.train-button{color:var(--sui-text-muted);background:var(--sui-bg);box-shadow:var(--sui-shadow-raised-sm)}.claim-button{display:flex;align-items:center;gap:8px;color:white;background:linear-gradient(135deg,#655ce7,#5149d3);box-shadow:0 9px 22px rgb(91 84 224 / 28%)}.claim-button svg{width:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.action-buttons button:hover{transform:translateY(-2px)}.action-buttons button:active{transform:none;box-shadow:var(--sui-shadow-inset-sm)}
  .home-status { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }.home-status button{display:grid;gap:3px;padding:12px 15px;color:var(--sui-text);text-align:left;background:var(--sui-bg);border:0;border-radius:15px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}.home-status button:hover{transform:translateY(-2px);box-shadow:var(--sui-shadow-raised)}.home-status span{color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));font-weight:700}.home-status strong{overflow:hidden;font-size:calc(10px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}
  @keyframes route{to{stroke-dashoffset:-120}}@keyframes ambient{0%,100%{transform:translate(0,0) scale(.95)}50%{transform:translate(12px,-8px) scale(1.08)}}@keyframes core-ring{to{transform:rotate(360deg)}}@keyframes artifact-orbit{to{transform:rotate(360deg)}}@keyframes artifact-counter{to{rotate:-360deg}}@keyframes scene-in{from{opacity:0;transform:translateY(8px)}}
  @media(max-width:1080px){.sanctuary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;min-height:auto;padding:230px 16px 16px}.route-lines,.world-peek,.artifact-peek{display:none}.luma-core{top:115px;width:190px;height:190px}.room-node{position:relative!important;inset:auto!important;width:auto}.action-dock{align-items:flex-start;flex-direction:column}.action-buttons{width:100%}.action-buttons button{flex:1}}
  @media(max-width:720px){.home{padding:17px}.home-intro{align-items:flex-start;flex-direction:column}.level-card{width:100%;box-sizing:border-box}.sanctuary{grid-template-columns:1fr}.action-copy{align-items:flex-start}.action-buttons{flex-direction:column}.home-status{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
