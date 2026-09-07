<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import LingvolernadoProgress from '../LingvolernadoProgress.svelte';
  import { lingvolernandoBonuses } from '../../../lib/services/lingvolernandoGame';
  import RoomHeader from './RoomHeader.svelte';

  type Props = { onHome: () => void; snapshot: Readonly<IloSnapshot> };
  let { onHome, snapshot }: Props = $props();
  const bonuses = $derived(lingvolernandoBonuses(snapshot.lingvolernando));
  const answers = $derived(snapshot.lingvolernando.learning.rememberedAnswers + snapshot.lingvolernando.learning.forgottenAnswers);
  const accuracy = $derived(answers > 0 ? Math.round(snapshot.lingvolernando.learning.rememberedAnswers / answers * 100) : 50);
</script>

<section class="progress-room">
  <RoomHeader
    eyebrow="Clear learning progress"
    title="What your German is doing"
    summary="The same simple Progress view you already know, with only the game effects that are useful for your next review."
    {onHome}
  />

  <div class="game-bridge" aria-label="Lingvolernando progress effects">
    <article><span>Recall</span><strong>{accuracy}%</strong><small>{snapshot.lingvolernando.learning.rememberedAnswers} remembered of {answers} answers</small><i><b style={`width:${accuracy}%`}></b></i></article>
    <article><span>Next pulse</span><strong>{snapshot.lingvolernando.learning.rememberedTowardAction}/10</strong><small>or {snapshot.lingvolernando.learning.forgottenTowardAction}/20 forgotten</small><i><b style={`width:${Math.max(snapshot.lingvolernando.learning.rememberedTowardAction / 10, snapshot.lingvolernando.learning.forgottenTowardAction / 20) * 100}%`}></b></i></article>
    <article><span>World effect</span><strong>+{bonuses.xpPercent}% XP</strong><small>+{bonuses.worldLightPercent}% world light</small><i><b style={`width:${Math.min(100,bonuses.xpPercent + bonuses.worldLightPercent)}%`}></b></i></article>
    <article><span>Discoveries</span><strong>{snapshot.lingvolernando.discoveredArtifactIds.length + snapshot.lingvolernando.discoveredWorldIds.length}</strong><small>{snapshot.lingvolernando.actionCount} learning pulses completed</small><i><b style={`width:${Math.min(100,(snapshot.lingvolernando.discoveredArtifactIds.length + snapshot.lingvolernando.discoveredWorldIds.length) / 2.4)}%`}></b></i></article>
  </div>

  <div class="familiar-progress"><LingvolernadoProgress progress={snapshot.progress} /></div>
</section>

<style>
  .progress-room{display:grid;gap:16px;padding:24px;animation:scene-in .3s ease-out}.game-bridge{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;max-width:1120px;width:100%;margin:0 auto}.game-bridge article{display:grid;gap:4px;padding:13px 15px;background:var(--sui-bg);border-radius:16px;box-shadow:var(--sui-shadow-raised-sm)}.game-bridge span{color:var(--sui-primary);font-size:calc(6px * var(--text-scale));font-weight:820;letter-spacing:.11em;text-transform:uppercase}.game-bridge strong{font-size:calc(16px * var(--text-scale));letter-spacing:-.035em}.game-bridge small{overflow:hidden;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.game-bridge i{height:6px;margin-top:4px;overflow:hidden;background:var(--sui-bg-dark);border-radius:99px;box-shadow:var(--sui-shadow-inset-sm)}.game-bridge b{display:block;height:100%;background:linear-gradient(90deg,#665de1,#42aa91);border-radius:inherit;transition:width .35s ease}.familiar-progress{padding:21px;background:color-mix(in srgb,var(--sui-bg-light) 55%,transparent);border-radius:24px;box-shadow:var(--sui-shadow-inset-sm)}@keyframes scene-in{from{opacity:0;transform:translateY(8px)}}@media(max-width:950px){.game-bridge{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.progress-room{padding:17px}.game-bridge{grid-template-columns:1fr}.familiar-progress{padding:14px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
