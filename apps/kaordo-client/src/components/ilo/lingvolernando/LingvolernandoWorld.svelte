<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import type { LingvolernandoWorldElementDefinition } from '../../../lib/domain/lingvolernando';
  import { LINGVOLERNANDO_BIOMES, LINGVOLERNANDO_WORLD, lingvolernandoBonuses } from '../../../lib/services/lingvolernandoGame';
  import RoomHeader from './RoomHeader.svelte';
  import WorldSprite from './WorldSprite.svelte';

  type Props = { onHome: () => void; onSelectBiome: (index: number) => void; snapshot: Readonly<IloSnapshot> };
  let { onHome, onSelectBiome, snapshot }: Props = $props();
  let selectedId = $state<string | null>(null);
  let showAtlas = $state(false);

  const biome = $derived(LINGVOLERNANDO_BIOMES[snapshot.lingvolernando.selectedBiome] ?? LINGVOLERNANDO_BIOMES[0]);
  const elements = $derived(LINGVOLERNANDO_WORLD.filter((element) => element.biome === biome.id));
  const discovered = $derived(new Set(snapshot.lingvolernando.discoveredWorldIds));
  const selected = $derived(elements.find((element) => element.id === selectedId) ?? elements.find((element) => discovered.has(element.id)) ?? elements[0]);
  const biomeDiscovered = $derived(elements.filter((element) => discovered.has(element.id)).length);
  const nextElement = $derived(elements.find((element) => !discovered.has(element.id)) ?? null);
  const bonuses = $derived(lingvolernandoBonuses(snapshot.lingvolernando));
  const nextBiome = $derived(LINGVOLERNANDO_BIOMES.find((item) => item.unlockAt > snapshot.lingvolernando.worldLight) ?? null);

  function inspect(element: LingvolernandoWorldElementDefinition): void {
    selectedId = element.id;
  }
</script>

<section class="world-room" style={`--biome-accent:${biome.accent}`}>
  <RoomHeader
    eyebrow="Living language world"
    title="A world that explains your progress"
    summary="Grow the world by completing learning pulses. Every awakened object permanently strengthens XP, artifact luck, duplicate dust, or the light that opens new biomes."
    {onHome}
  />

  <nav class="biome-rail" aria-label="Language biomes">
    {#each LINGVOLERNANDO_BIOMES as item, index}
      {@const unlocked = snapshot.lingvolernando.worldLight >= item.unlockAt}
      <button class:active={item.id === biome.id} class:locked={!unlocked} type="button" disabled={!unlocked} onclick={() => { onSelectBiome(index); selectedId = null; }}>
        <i style={`--accent:${item.accent}`}></i>
        <span><strong>{item.name}</strong><small>{unlocked ? item.subtitle : `${Math.max(0, item.unlockAt - snapshot.lingvolernando.worldLight)} light away`}</small></span>
        {#if !unlocked}<svg viewBox="0 0 20 20"><rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/></svg>{/if}
      </button>
    {/each}
  </nav>

  <section class="world-purpose" aria-label="Living World objective and permanent bonuses">
    <div><span>Current objective</span><strong>{nextElement ? `Awaken ${nextElement.name}` : nextBiome ? `Open ${nextBiome.name}` : 'Complete the living atlas'}</strong><small>{nextElement ? `${Math.max(0,nextElement.unlockAt - snapshot.lingvolernando.worldLight)} world light remaining` : nextBiome ? `${nextBiome.unlockAt - snapshot.lingvolernando.worldLight} world light remaining` : `${snapshot.lingvolernando.discoveredWorldIds.length}/120 objects awake`}</small></div>
    <article><span>XP engine</span><strong>+{bonuses.xpPercent}%</strong></article>
    <article><span>Artifact luck</span><strong>+{bonuses.artifactChancePercent}%</strong></article>
    <article><span>Duplicate dust</span><strong>+{bonuses.dustPercent}%</strong></article>
    <article><span>Light engine</span><strong>+{bonuses.worldLightPercent}%</strong></article>
  </section>

  <div class="world-layout">
    <div class="world-map" aria-label={`${biome.name} discovery map`}>
      <div class="sky-layer"><i></i><i></i><i></i></div>
      <div class="horizon"></div><div class="terrain terrain-one"></div><div class="terrain terrain-two"></div>
      <svg class="map-routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 82C22 68 20 41 36 52s11 31 28 19 8-37 31-48"/><path d="M17 18c20 8 27 25 41 18S77 17 92 30"/></svg>
      {#each elements as element}
        {@const isDiscovered = discovered.has(element.id)}
        <button
          class:active={selected?.id === element.id}
          class:locked={!isDiscovered}
          class="world-object"
          style={`left:${element.x}%;top:${element.y}%`}
          type="button"
          onclick={() => inspect(element)}
          aria-label={isDiscovered ? element.name : `Undiscovered ${element.kind}`}
        >
          <WorldSprite {element} locked={!isDiscovered} size={isDiscovered ? 68 : 58} />
          <span>{isDiscovered ? element.name : 'Unknown'}</span>
        </button>
      {/each}
      <div class="map-caption"><span>{biome.name}</span><strong>{biomeDiscovered}/20 awake</strong></div>
      <div class="light-meter"><span>World light</span><div><i style={`width:${Math.min(100, (snapshot.lingvolernando.worldLight / Math.max(1, nextElement?.unlockAt ?? snapshot.lingvolernando.worldLight)) * 100)}%`}></i></div><strong>{snapshot.lingvolernando.worldLight}</strong></div>
    </div>

    <aside class="inspector">
      {#if selected}
        {@const isDiscovered = discovered.has(selected.id)}
        <div class="inspector-visual"><WorldSprite element={selected} locked={!isDiscovered} size={132} /><span>{selected.kind}</span></div>
        <span class="eyebrow">{isDiscovered ? 'Discovered' : 'Silhouette'}</span>
        <h3>{isDiscovered ? selected.name : `Unknown ${selected.kind}`}</h3>
        <p>{isDiscovered ? selected.description : 'Its outline is visible now. Complete German learning pulses to bring it into the world.'}</p>
        <div class="effect-card">
          <svg viewBox="0 0 20 20"><path d="m10 2 1.5 5L16 9l-4.5 2L10 16l-1.5-5L4 9l4.5-2Z"/></svg>
          <span><small>{isDiscovered ? 'Permanent active bonus' : 'Locked permanent bonus'}</small><strong>{isDiscovered ? selected.effect : `Reveals at ${selected.unlockAt} world light`}</strong></span>
        </div>
        <button class="atlas-button" type="button" onclick={() => { showAtlas = !showAtlas; }}>{showAtlas ? 'Hide biome atlas' : 'Open biome atlas'}</button>
      {/if}
    </aside>
  </div>

  {#if showAtlas}
    <section class="atlas" aria-labelledby="biome-atlas-title">
      <header><div><span class="eyebrow">Compact collection</span><h3 id="biome-atlas-title">{biome.name} atlas</h3></div><strong>{biomeDiscovered} found · {20 - biomeDiscovered} silhouettes</strong></header>
      <div>
        {#each elements as element}
          {@const isDiscovered = discovered.has(element.id)}
          <button class:active={selected?.id === element.id} type="button" onclick={() => inspect(element)}>
            <WorldSprite {element} locked={!isDiscovered} size={48} />
            <span><strong>{isDiscovered ? element.name : 'Undiscovered'}</strong><small>{element.kind} · {isDiscovered ? 'awake' : `${Math.max(0, element.unlockAt - snapshot.lingvolernando.worldLight)} light`}</small></span>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .world-room{display:grid;gap:15px;padding:24px;animation:scene-in .32s ease-out}.biome-rail{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.biome-rail button{display:grid;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:58px;padding:8px 10px;color:var(--sui-text-muted);text-align:left;background:var(--sui-bg);border:1px solid transparent;border-radius:15px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer;transition:transform .15s ease,color .15s ease,box-shadow .15s ease}.biome-rail button:hover:not(:disabled){transform:translateY(-2px);color:var(--sui-text)}.biome-rail button.active{color:var(--sui-text);border-color:color-mix(in srgb,var(--biome-accent) 38%,transparent);box-shadow:var(--sui-shadow-inset-sm)}.biome-rail button.locked{opacity:.55;cursor:default}.biome-rail i{width:9px;height:34px;background:var(--accent);border-radius:99px;box-shadow:0 0 12px color-mix(in srgb,var(--accent) 40%,transparent)}.biome-rail span{display:grid;gap:2px;min-width:0}.biome-rail strong{overflow:hidden;font-size:calc(8px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.biome-rail small{overflow:hidden;font-size:calc(6px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.biome-rail svg{width:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .world-purpose{display:grid;grid-template-columns:minmax(230px,1.5fr) repeat(4,minmax(95px,.5fr));gap:8px;padding:9px;background:linear-gradient(135deg,color-mix(in srgb,var(--sui-bg-light) 82%,var(--biome-accent) 18%),var(--sui-bg));border-radius:18px;box-shadow:var(--sui-shadow-raised-sm)}.world-purpose>div,.world-purpose article{display:grid;gap:2px;padding:8px 10px;background:color-mix(in srgb,var(--sui-bg-light) 78%,transparent);border-radius:11px;box-shadow:var(--sui-shadow-inset-sm)}.world-purpose span{color:var(--biome-accent);font-size:calc(5px * var(--text-scale));font-weight:810;letter-spacing:.08em;text-transform:uppercase}.world-purpose strong{font-size:calc(8px * var(--text-scale))}.world-purpose>div strong{font-size:calc(9px * var(--text-scale))}.world-purpose small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale))}
  .world-layout{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:14px;min-height:520px}.world-map{position:relative;min-height:520px;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,var(--biome-accent) 9%,var(--sui-bg-light)) 0 55%,color-mix(in srgb,var(--biome-accent) 15%,var(--sui-bg)) 56% 100%);border:1px solid color-mix(in srgb,var(--biome-accent) 18%,transparent);border-radius:28px;box-shadow:var(--sui-shadow-inset);isolation:isolate}.sky-layer{position:absolute;inset:0 0 45%;background:radial-gradient(circle at 65% 22%,color-mix(in srgb,var(--biome-accent) 18%,transparent),transparent 36%)}.sky-layer i{position:absolute;width:4px;height:4px;background:var(--biome-accent);border-radius:50%;opacity:.5;animation:star 3s ease-in-out infinite}.sky-layer i:nth-child(1){top:20%;left:24%}.sky-layer i:nth-child(2){top:34%;right:19%;animation-delay:-1s}.sky-layer i:nth-child(3){top:12%;right:42%;animation-delay:-2s}.horizon{position:absolute;right:-8%;bottom:34%;left:-8%;height:42%;background:color-mix(in srgb,var(--biome-accent) 9%,var(--sui-bg));border-radius:50% 50% 0 0/45% 45% 0 0;box-shadow:inset 0 14px 23px rgb(255 255 255 / 12%)}.terrain{position:absolute;bottom:-22%;width:72%;height:59%;background:color-mix(in srgb,var(--biome-accent) 14%,var(--sui-bg-dark));border-radius:50%;opacity:.85}.terrain-one{left:-12%;transform:rotate(8deg)}.terrain-two{right:-15%;transform:rotate(-7deg)}.map-routes{position:absolute;inset:0;width:100%;height:100%}.map-routes path{fill:none;stroke:color-mix(in srgb,var(--biome-accent) 31%,transparent);stroke-width:.5;stroke-dasharray:1.5 2;vector-effect:non-scaling-stroke;animation:routes 18s linear infinite}.world-object{position:absolute;z-index:2;display:grid;gap:0;width:84px;padding:2px;color:var(--sui-text);background:transparent;border:0;place-items:center;cursor:pointer;transform:translate(-50%,-50%);transition:transform .16s ease,filter .16s ease}.world-object:hover,.world-object.active{z-index:4;transform:translate(-50%,-55%) scale(1.11);filter:drop-shadow(0 8px 8px rgb(46 58 77 / 18%))}.world-object.locked:hover{filter:none}.world-object>span{max-width:84px;overflow:hidden;padding:3px 6px;font-size:calc(6px * var(--text-scale));font-weight:760;background:color-mix(in srgb,var(--sui-bg-light) 84%,transparent);border-radius:7px;box-shadow:var(--sui-shadow-raised-sm);text-overflow:ellipsis;white-space:nowrap;backdrop-filter:blur(5px)}.world-object.locked>span{opacity:.6}.map-caption{position:absolute;top:18px;left:19px;z-index:5;display:grid;gap:2px;padding:10px 13px;background:color-mix(in srgb,var(--sui-bg-light) 80%,transparent);border-radius:13px;box-shadow:var(--sui-shadow-raised-sm);backdrop-filter:blur(8px)}.map-caption span{color:var(--biome-accent);font-size:calc(7px * var(--text-scale));font-weight:820;letter-spacing:.1em;text-transform:uppercase}.map-caption strong{font-size:calc(10px * var(--text-scale))}.light-meter{position:absolute;right:18px;bottom:16px;left:18px;z-index:6;display:grid;grid-template-columns:auto minmax(70px,1fr) auto;align-items:center;gap:9px;padding:8px 11px;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));font-weight:700;background:color-mix(in srgb,var(--sui-bg-light) 82%,transparent);border-radius:12px;box-shadow:var(--sui-shadow-raised-sm);backdrop-filter:blur(8px)}.light-meter>div{height:6px;overflow:hidden;background:var(--sui-bg-dark);border-radius:99px;box-shadow:var(--sui-shadow-inset-sm)}.light-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--biome-accent),#8277ef);border-radius:inherit;transition:width .4s ease}.light-meter strong{color:var(--sui-text)}
  .inspector{display:grid;align-content:start;gap:10px;padding:19px;background:var(--sui-bg);border-radius:24px;box-shadow:var(--sui-shadow-raised)}.inspector-visual{position:relative;display:grid;min-height:164px;background:radial-gradient(circle,color-mix(in srgb,var(--biome-accent) 15%,var(--sui-bg-light)),var(--sui-bg));border-radius:19px;box-shadow:var(--sui-shadow-inset);place-items:center}.inspector-visual>span{position:absolute;right:10px;bottom:9px;padding:4px 7px;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));font-weight:750;background:var(--sui-bg);border-radius:7px;text-transform:capitalize}.eyebrow{color:var(--biome-accent,var(--sui-primary));font-size:calc(7px * var(--text-scale));font-weight:820;letter-spacing:.14em;text-transform:uppercase}.inspector h3,.atlas h3{margin:0;color:var(--sui-text);font-size:calc(18px * var(--text-scale));letter-spacing:-.035em}.inspector>p{margin:0;color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale));line-height:1.55}.effect-card{display:grid;grid-template-columns:31px minmax(0,1fr);align-items:center;gap:9px;margin-top:3px;padding:10px;background:color-mix(in srgb,var(--sui-bg-light) 86%,var(--biome-accent) 14%);border-radius:13px;box-shadow:var(--sui-shadow-inset-sm)}.effect-card svg{width:25px;fill:none;stroke:var(--biome-accent);stroke-width:1.7}.effect-card span{display:grid;gap:2px}.effect-card small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));font-weight:720}.effect-card strong{font-size:calc(8px * var(--text-scale));line-height:1.35}.atlas-button{min-height:41px;margin-top:3px;color:var(--biome-accent);font:inherit;font-size:calc(8px * var(--text-scale));font-weight:760;background:var(--sui-bg);border:0;border-radius:12px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.atlas-button:active{box-shadow:var(--sui-shadow-inset-sm)}
  .atlas{display:grid;gap:12px;padding:18px;background:var(--sui-bg);border-radius:22px;box-shadow:var(--sui-shadow-raised)}.atlas>header{display:flex;align-items:end;justify-content:space-between;gap:15px}.atlas>header>div{display:grid;gap:3px}.atlas>header strong{color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale))}.atlas>div{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}.atlas button{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:5px;padding:5px 7px;color:var(--sui-text);text-align:left;background:var(--sui-bg);border:1px solid transparent;border-radius:12px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.atlas button.active{border-color:color-mix(in srgb,var(--biome-accent) 30%,transparent);box-shadow:var(--sui-shadow-inset-sm)}.atlas button span{display:grid;gap:2px;min-width:0}.atlas button strong,.atlas button small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.atlas button strong{font-size:calc(7px * var(--text-scale))}.atlas button small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale))}
  @keyframes scene-in{from{opacity:0;transform:translateY(8px)}}@keyframes star{0%,100%{transform:scale(.6);opacity:.25}50%{transform:scale(1.35);opacity:.75}}@keyframes routes{to{stroke-dashoffset:-30}}
  @media(max-width:1100px){.biome-rail{grid-template-columns:repeat(3,minmax(0,1fr))}.world-purpose{grid-template-columns:repeat(4,minmax(0,1fr))}.world-purpose>div{grid-column:1/-1}.world-layout{grid-template-columns:1fr}.inspector{grid-template-columns:165px minmax(0,1fr);align-items:start}.inspector-visual{grid-row:1/7}.atlas>div{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:720px){.world-room{padding:17px}.biome-rail{grid-template-columns:repeat(2,minmax(0,1fr))}.world-purpose{grid-template-columns:repeat(2,minmax(0,1fr))}.world-map{min-height:600px}.inspector{grid-template-columns:1fr}.inspector-visual{grid-row:auto}.atlas>header{align-items:flex-start;flex-direction:column}.atlas>div{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
