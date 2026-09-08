<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import type { LingvolernandoPetPalette } from '../../../lib/domain/lingvolernando';
  import { LINGVOLERNANDO_ARTIFACTS, lingvolernandoArtifact } from '../../../lib/services/lingvolernandoGame';
  import ArtifactGlyph from './ArtifactGlyph.svelte';
  import LingvolernandoLearningPulse from './LingvolernandoLearningPulse.svelte';
  import LumaCreature from './LumaCreature.svelte';
  import RoomHeader from './RoomHeader.svelte';

  type Props = {
    onArtifact: (artifactId: string) => void;
    onHome: () => void;
    onPalette: (palette: LingvolernandoPetPalette) => void;
    onRename: (name: string) => void;
    snapshot: Readonly<IloSnapshot>;
  };
  let { onArtifact, onHome, onPalette, onRename, snapshot }: Props = $props();
  let gazeX = $state(0);
  let gazeY = $state(0);
  let editingName = $state(false);
  let nameDraft = $state('');

  $effect(() => {
    if (!editingName) nameDraft = snapshot.lingvolernando.pet.name;
  });

  const discovered = $derived(LINGVOLERNANDO_ARTIFACTS.filter((item) => snapshot.lingvolernando.discoveredArtifactIds.includes(item.id)));
  const activeArtifactIds = $derived(snapshot.lingvolernando.equippedArtifactIds);
  const carried = $derived(activeArtifactIds.map((id) => lingvolernandoArtifact(id)).filter(Boolean));
  const answers = $derived(snapshot.lingvolernando.learning.rememberedAnswers + snapshot.lingvolernando.learning.forgottenAnswers);
  const accuracy = $derived(answers > 0 ? Math.round(snapshot.lingvolernando.learning.rememberedAnswers / answers * 100) : 50);
  const growthLevel = $derived(Math.min(6, Math.floor((snapshot.lingvolernando.actionCount + snapshot.lingvolernando.learning.vocabularyBlooms) / 5)));
  const palettes: Array<{ id: LingvolernandoPetPalette; label: string }> = [
    { id: 'moon', label: 'Moon' }, { id: 'aurora', label: 'Aurora' }, { id: 'moss', label: 'Moss' }, { id: 'ember', label: 'Ember' },
  ];
  const abilities = [
    'Follows your cursor', 'Reacts to remembered words', 'Notices new vocabulary',
    'Carries a second artifact', 'Changes aura with progress', 'Carries three artifacts',
  ];

  function followPointer(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    gazeX = Math.max(-4, Math.min(4, ((event.clientX - rect.left) / rect.width - .5) * 8));
    gazeY = Math.max(-3, Math.min(3, ((event.clientY - rect.top) / rect.height - .5) * 6));
  }

  function saveName(): void {
    const name = nameDraft.trim();
    if (name) onRename(name);
    else nameDraft = snapshot.lingvolernando.pet.name;
    editingName = false;
  }
</script>

<section class="companion-room">
  <RoomHeader
    eyebrow="Learning companion"
    title={`${snapshot.lingvolernando.pet.name}'s observatory`}
    summary="Your companion is powered by learning, not care buttons. Answers, recall accuracy, and new vocabulary change its mood, room, abilities, and carried artifacts."
    {onHome}
  />

  <LingvolernandoLearningPulse game={snapshot.lingvolernando} progress={snapshot.progress} />

  <div class="companion-layout">
    <div class="habitat" role="presentation" onpointermove={followPointer} onpointerleave={() => { gazeX = 0; gazeY = 0; }}>
      <div class="sky"><i></i><i></i><i></i><span></span></div>
      <div class="arch"></div><div class="floor"></div><div class="constellation"><i></i><i></i><i></i><i></i></div>
      <div class="pet-stage">
        <span class="orbit-line one"></span><span class="orbit-line two"></span>
        {#each carried as artifact, index}
          {#if artifact}<span class="carried artifact-{index}"><ArtifactGlyph {artifact} size={72 - index * 7} level={snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1} /></span>{/if}
        {/each}
        <LumaCreature mood={snapshot.lingvolernando.pet.mood} palette={snapshot.lingvolernando.pet.palette} {gazeX} {gazeY} size={320} />
      </div>
      <div class="speech"><span></span><strong>{answers === 0 ? 'Let’s remember our first German word.' : accuracy >= 70 ? 'Your recall current feels bright today.' : accuracy >= 45 ? 'This is the useful edge where memory grows.' : 'Forgotten words are not failures. They show us the path.'}</strong><small>{snapshot.lingvolernando.pet.mood} mood · {activeArtifactIds.filter(Boolean).length}/3 artifacts equipped</small></div>
    </div>

    <aside class="customizer">
      <header><span>Identity</span><h3>Make the companion yours</h3><p>Everything here is local to this Kaordo account.</p></header>
      <label class:editing={editingName} class="name-control">
        <span>Name</span>
        <div><input bind:value={nameDraft} maxlength="24" disabled={!editingName} onkeydown={(event) => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') { nameDraft = snapshot.lingvolernando.pet.name; editingName = false; } }} />{#if editingName}<button type="button" onclick={saveName}>Save</button>{:else}<button type="button" onclick={() => { editingName = true; }}>Rename</button>{/if}</div>
      </label>
      <div class="palette-control"><span>Aura</span><div>{#each palettes as palette}<button class:active={snapshot.lingvolernando.pet.palette === palette.id} class="palette-{palette.id}" type="button" onclick={() => onPalette(palette.id)}><i></i>{palette.label}</button>{/each}</div></div>
      <div class="ability-tree"><header><span>Learning evolution</span><strong>{growthLevel}/6 behaviours</strong></header>{#each abilities as ability, index}<article class:unlocked={index < growthLevel}><span>{index < growthLevel ? '✓' : index + 1}</span><div><strong>{ability}</strong><small>{index < growthLevel ? 'Awake' : `${Math.max(0, (index + 1) * 5 - snapshot.lingvolernando.actionCount - snapshot.lingvolernando.learning.vocabularyBlooms)} growth signals away`}</small></div></article>{/each}</div>
    </aside>
  </div>

  <section class="artifact-wardrobe">
    <header><div><span>Artifact wardrobe</span><h3>Equip up to three orbiting companions</h3><p>This loadout is shared with the Vault and powers your learning bonuses.</p></div><strong>{activeArtifactIds.filter(Boolean).length}/3 equipped</strong></header>
    {#if discovered.length > 0}
      <div class="artifact-strip">
        {#each discovered.slice(0, 16) as artifact}
          {@const selectedIndex = activeArtifactIds.indexOf(artifact.id)}
          {@const loadoutFull = selectedIndex < 0 && activeArtifactIds.every(Boolean)}
          <button class:active={selectedIndex >= 0} disabled={loadoutFull} type="button" onclick={() => onArtifact(artifact.id)} title={loadoutFull ? 'All three artifact slots are occupied' : artifact.name} aria-label={loadoutFull ? `${artifact.name}. All three artifact slots are occupied` : `${selectedIndex >= 0 ? 'Unequip' : 'Equip'} ${artifact.name}`}>
            <ArtifactGlyph {artifact} size={66} level={snapshot.lingvolernando.artifactLevels[artifact.id] ?? 1} />
            <span><strong>{artifact.name}</strong><small>{selectedIndex >= 0 ? `Slot ${selectedIndex + 1} · Unequip` : loadoutFull ? 'Loadout full' : `Equip · ${artifact.rarity}`}</small></span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="empty-wardrobe"><span>?</span><div><strong>No artifacts discovered yet</strong><p>Ten remembered answers or twenty forgotten answers complete a learning pulse and open the protected artifact deck.</p></div></div>
    {/if}
  </section>
</section>

<style>
  .companion-room{display:grid;gap:15px;padding:24px;animation:scene-in .32s ease-out}.companion-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px}.habitat{position:relative;min-height:560px;overflow:hidden;background:linear-gradient(165deg,color-mix(in srgb,var(--sui-bg-light) 68%,#cedcf0 32%),color-mix(in srgb,var(--sui-bg) 75%,#cfe1d9 25%));border-radius:29px;box-shadow:var(--sui-shadow-inset);isolation:isolate}.sky{position:absolute;inset:0 0 43%;background:radial-gradient(circle at 70% 22%,rgb(244 232 179 / 64%),transparent 22%)}.sky>span{position:absolute;top:38px;right:55px;width:74px;height:74px;background:#f4eac7;border-radius:50%;box-shadow:0 0 38px rgb(244 230 171 / 55%)}.sky i{position:absolute;width:5px;height:5px;background:#7167dd;border-radius:50%;animation:star 2.8s ease-in-out infinite}.sky i:nth-child(1){top:23%;left:14%}.sky i:nth-child(2){top:43%;right:27%;animation-delay:-1s}.sky i:nth-child(3){top:15%;left:48%;animation-delay:-2s}.arch{position:absolute;bottom:40px;left:28px;width:190px;height:330px;border:20px solid color-mix(in srgb,var(--sui-bg-dark) 77%,#8a91b0 23%);border-bottom:0;border-radius:110px 110px 0 0;opacity:.72}.floor{position:absolute;right:-10%;bottom:-27%;left:-10%;height:55%;background:radial-gradient(ellipse,color-mix(in srgb,var(--sui-bg) 70%,#bfcfc5 30%),color-mix(in srgb,var(--sui-bg-dark) 88%,#bfcae0 12%));border-radius:50%}.constellation{position:absolute;top:155px;left:62px;width:110px;height:145px;border-left:2px dashed rgb(105 95 219 / 26%);transform:rotate(19deg)}.constellation i{position:absolute;width:9px;height:9px;background:#766ce3;border-radius:50%;box-shadow:0 0 0 7px rgb(118 108 227 / 11%)}.constellation i:nth-child(2){top:45px;left:42px}.constellation i:nth-child(3){top:92px;left:8px}.constellation i:nth-child(4){top:128px;left:62px}.pet-stage{position:absolute;right:8%;bottom:18px;z-index:2;width:390px;height:390px}.pet-stage>:global(.luma){position:absolute;right:15px;bottom:0;z-index:2}.orbit-line{position:absolute;z-index:0;border:1px dashed rgb(100 91 220 / 31%);border-radius:50%;animation:orbit 19s linear infinite}.orbit-line.one{inset:26px}.orbit-line.two{inset:60px;animation-direction:reverse;animation-duration:13s}.carried{position:absolute;z-index:1;filter:drop-shadow(0 9px 10px rgb(46 54 77 / 22%));animation:float 3s ease-in-out infinite}.artifact-0{top:18px;left:48%;animation-delay:-.4s}.artifact-1{top:43%;right:-2px;animation-delay:-1.4s}.artifact-2{bottom:22px;left:13%;animation-delay:-2.3s}.speech{position:absolute;top:46px;left:42px;z-index:3;display:grid;gap:5px;width:min(350px,43%);padding:18px 20px;background:color-mix(in srgb,var(--sui-bg-light) 84%,transparent);border-radius:21px;box-shadow:var(--sui-shadow-raised);backdrop-filter:blur(10px)}.speech>span{position:absolute;right:-19px;bottom:20px;border:11px solid transparent;border-left-color:color-mix(in srgb,var(--sui-bg-light) 84%,transparent)}.speech strong{font-size:calc(10px * var(--text-scale));line-height:1.45}.speech small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));text-transform:capitalize}
  .customizer{display:grid;align-content:start;gap:13px;padding:19px;background:var(--sui-bg);border-radius:24px;box-shadow:var(--sui-shadow-raised)}.customizer>header{display:grid;gap:3px}.customizer>header>span,.palette-control>span,.ability-tree>header>span,.artifact-wardrobe>header span{color:var(--sui-primary);font-size:calc(6px * var(--text-scale));font-weight:820;letter-spacing:.12em;text-transform:uppercase}.customizer h3,.artifact-wardrobe h3{margin:0;font-size:calc(15px * var(--text-scale));letter-spacing:-.03em}.customizer p,.artifact-wardrobe p{margin:0;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));line-height:1.4}.name-control{display:grid;gap:6px}.name-control>span{color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));font-weight:720}.name-control>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.name-control input{min-width:0;height:42px;padding:0 11px;color:var(--sui-text);font:inherit;font-size:calc(9px * var(--text-scale));font-weight:730;background:var(--sui-bg);border:1px solid transparent;border-radius:12px;box-shadow:var(--sui-shadow-inset-sm);outline:0}.name-control.editing input{border-color:rgb(91 84 224 / 30%)}.name-control button{padding:0 10px;color:var(--sui-primary);font:inherit;font-size:calc(7px * var(--text-scale));font-weight:750;background:var(--sui-bg);border:0;border-radius:11px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.palette-control{display:grid;gap:7px}.palette-control>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.palette-control button{display:flex;align-items:center;gap:7px;min-height:38px;padding:5px 8px;color:var(--sui-text-muted);font:inherit;font-size:calc(7px * var(--text-scale));font-weight:720;background:var(--sui-bg);border:1px solid transparent;border-radius:11px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.palette-control button.active{color:var(--sui-text);border-color:rgb(91 84 224 / 24%);box-shadow:var(--sui-shadow-inset-sm)}.palette-control i{width:20px;height:20px;background:linear-gradient(145deg,#f8fbff,#cad5ed);border-radius:50%;box-shadow:0 3px 7px rgb(52 63 83 / 20%)}.palette-aurora i{background:linear-gradient(145deg,#f7fffc,#addbd2)}.palette-moss i{background:linear-gradient(145deg,#fbfff5,#bfd0ab)}.palette-ember i{background:linear-gradient(145deg,#fffaf5,#dfb7a4)}.ability-tree{display:grid;gap:6px}.ability-tree>header{display:flex;justify-content:space-between;gap:8px}.ability-tree>header strong{font-size:calc(7px * var(--text-scale))}.ability-tree article{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:8px;padding:7px 8px;opacity:.48;background:var(--sui-bg);border-radius:10px;box-shadow:var(--sui-shadow-inset-sm)}.ability-tree article.unlocked{opacity:1;box-shadow:var(--sui-shadow-raised-sm)}.ability-tree article>span{display:grid;width:27px;height:27px;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));font-weight:820;background:var(--sui-bg-dark);border-radius:8px;place-items:center}.ability-tree article.unlocked>span{color:white;background:#6259dc}.ability-tree article>div{display:grid;gap:1px}.ability-tree article strong{font-size:calc(7px * var(--text-scale))}.ability-tree article small{color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale))}
  .artifact-wardrobe{display:grid;gap:12px;padding:18px;background:var(--sui-bg);border-radius:23px;box-shadow:var(--sui-shadow-raised)}.artifact-wardrobe>header{display:flex;align-items:end;justify-content:space-between;gap:12px}.artifact-wardrobe>header>div{display:grid;gap:3px}.artifact-wardrobe>header>strong{color:var(--sui-primary);font-size:calc(11px * var(--text-scale))}.artifact-strip{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:7px}.artifact-strip button{display:grid;min-width:0;padding:5px;color:var(--sui-text);background:var(--sui-bg);border:1px solid transparent;border-radius:13px;box-shadow:var(--sui-shadow-raised-sm);place-items:center;cursor:pointer}.artifact-strip button.active{border-color:rgb(91 84 224 / 32%);box-shadow:var(--sui-shadow-inset-sm)}.artifact-strip button:disabled{opacity:.55;cursor:not-allowed;box-shadow:var(--sui-shadow-inset-sm)}.artifact-strip button>span{display:grid;width:100%;gap:1px;text-align:center}.artifact-strip strong,.artifact-strip small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-strip strong{font-size:calc(6px * var(--text-scale))}.artifact-strip small{color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale));text-transform:capitalize}.empty-wardrobe{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:11px;padding:14px;background:var(--sui-bg);border-radius:14px;box-shadow:var(--sui-shadow-inset-sm)}.empty-wardrobe>span{display:grid;width:46px;height:46px;color:var(--sui-primary);font-size:calc(13px * var(--text-scale));font-weight:850;background:var(--sui-bg);border-radius:50%;box-shadow:var(--sui-shadow-raised-sm);place-items:center}.empty-wardrobe>div{display:grid;gap:3px}.empty-wardrobe strong{font-size:calc(9px * var(--text-scale))}
  @keyframes scene-in{from{opacity:0;transform:translateY(8px)}}@keyframes star{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1.35)}}@keyframes orbit{to{transform:rotate(360deg)}}@keyframes float{0%,100%{transform:translateY(3px) rotate(-4deg)}50%{transform:translateY(-7px) rotate(5deg)}}@media(max-width:1080px){.companion-layout{grid-template-columns:1fr}.customizer{grid-template-columns:repeat(2,minmax(0,1fr))}.customizer>header{grid-column:1/-1}.ability-tree{grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr))}.ability-tree>header{grid-column:1/-1}.artifact-strip{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:720px){.companion-room{padding:17px}.habitat{min-height:500px}.speech{top:18px;right:18px;left:18px;width:auto}.pet-stage{right:-30px;bottom:0}.customizer{grid-template-columns:1fr}.ability-tree{grid-column:auto;grid-template-columns:1fr}.artifact-wardrobe>header{align-items:flex-start;flex-direction:column}.artifact-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
