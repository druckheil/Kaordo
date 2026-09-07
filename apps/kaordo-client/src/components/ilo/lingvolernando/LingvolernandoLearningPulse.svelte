<script lang="ts">
  import type { IloProgress } from '../../../lib/domain/ilo';
  import type { LingvolernandoGameSnapshot } from '../../../lib/domain/lingvolernando';
  import LumaCreature from './LumaCreature.svelte';

  type Props = {
    game: Readonly<LingvolernandoGameSnapshot>;
    progress: Readonly<IloProgress>;
    reaction?: 'forgot' | 'remember' | null;
    reactionSequence?: number;
  };
  let { game, progress, reaction = null, reactionSequence = 0 }: Props = $props();

  const answers = $derived(game.learning.rememberedAnswers + game.learning.forgottenAnswers);
  const accuracy = $derived(answers > 0 ? Math.round(game.learning.rememberedAnswers / answers * 100) : 50);
  const rememberedPulse = $derived(game.learning.rememberedTowardAction / 10 * 100);
  const forgottenPulse = $derived(game.learning.forgottenTowardAction / 20 * 100);
  const actionPulse = $derived(Math.max(rememberedPulse, forgottenPulse));
  const actionRoute = $derived(rememberedPulse >= forgottenPulse ? 'remembered' : 'forgotten');
  const actionRemaining = $derived(actionRoute === 'remembered'
    ? 10 - game.learning.rememberedTowardAction
    : 20 - game.learning.forgottenTowardAction);
  const vocabularyPulse = $derived(game.learning.newWordsTowardBloom / 4 * 100);
</script>

<section class="learning-pulse" aria-label={`${game.pet.name}'s learning pulse`}>
  <div class="companion-mini">
    <div class="pet-glow"></div>
    {#key reactionSequence}<LumaCreature action={reaction} mood={game.pet.mood} palette={game.pet.palette} size={92} />{/key}
    <div><span>Learning with {game.pet.name}</span><strong>{progress.due > 0 ? `${progress.due} words are ready` : 'The review queue is clear'}</strong><small>Only real answers move these signals.</small></div>
  </div>

  <div class="signals">
    <article class="signal action">
      <header><span><i></i>Learning pulse</span><strong>{Math.round(actionPulse)}%</strong></header>
      <div class="track"><b style={`width:${actionPulse}%`}></b><em style="left:50%"></em></div>
      <footer><small>{game.learning.rememberedTowardAction}/10 remembered</small><small>{game.learning.forgottenTowardAction}/20 forgotten</small></footer>
      <p>{actionRemaining} more {actionRoute} answer{actionRemaining === 1 ? '' : 's'} to a discovery pulse</p>
    </article>

    <article class="signal recall">
      <header><span><i></i>Recall balance</span><strong>{accuracy}%</strong></header>
      <div class="track"><b style={`width:${accuracy}%`}></b><em style="left:50%"></em></div>
      <footer><small>{game.learning.rememberedAnswers} remembered</small><small>{game.learning.forgottenAnswers} forgotten</small></footer>
      <p>{answers === 0 ? 'A neutral signal until your first answer' : accuracy >= 70 ? 'A strong recall current' : accuracy >= 45 ? 'A useful learning edge' : 'New connections are forming'}</p>
    </article>

    <article class="signal vocabulary">
      <header><span><i></i>New vocabulary</span><strong>{game.learning.newWordsTowardBloom}/4</strong></header>
      <div class="track"><b style={`width:${vocabularyPulse}%`}></b></div>
      <footer><small>{game.learning.addedWords} words added</small><small>{game.learning.vocabularyBlooms} blooms</small></footer>
      <p>Four new words grow one world bloom.</p>
    </article>
  </div>
</section>

<style>
  .learning-pulse{display:grid;grid-template-columns:minmax(230px,.72fr) minmax(0,2.28fr);gap:11px;padding:11px;background:linear-gradient(135deg,color-mix(in srgb,var(--sui-bg-light) 78%,#dcd9f3 22%),color-mix(in srgb,var(--sui-bg) 88%,#cfe5dd 12%));border:1px solid rgb(255 255 255 / 28%);border-radius:21px;box-shadow:var(--sui-shadow-raised);isolation:isolate}.companion-mini{position:relative;display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:4px;min-width:0;padding:2px 9px 2px 2px;overflow:hidden;background:color-mix(in srgb,var(--sui-bg-light) 76%,transparent);border-radius:16px;box-shadow:var(--sui-shadow-inset-sm)}.companion-mini>div:last-child{display:grid;gap:2px;min-width:0}.companion-mini span{color:var(--sui-primary);font-size:calc(6px * var(--text-scale));font-weight:820;letter-spacing:.08em;text-transform:uppercase}.companion-mini strong{overflow:hidden;font-size:calc(9px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.companion-mini small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale))}.pet-glow{position:absolute;top:50%;left:47px;width:82px;height:82px;background:radial-gradient(circle,rgb(100 91 224 / 17%),transparent 66%);border-radius:50%;transform:translate(-50%,-50%);animation:pet-pulse 2.8s ease-in-out infinite}.signals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.signal{display:grid;align-content:center;gap:6px;min-width:0;padding:10px 11px;background:var(--sui-bg);border-radius:14px;box-shadow:var(--sui-shadow-raised-sm)}.signal header,.signal footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.signal header span{display:flex;align-items:center;gap:6px;color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));font-weight:760}.signal header i{width:8px;height:8px;background:var(--signal,#665de2);border-radius:50%;box-shadow:0 0 0 4px color-mix(in srgb,var(--signal,#665de2) 12%,transparent)}.signal header strong{color:var(--signal,#665de2);font-size:calc(10px * var(--text-scale))}.track{position:relative;height:8px;overflow:hidden;background:var(--sui-bg-dark);border-radius:99px;box-shadow:var(--sui-shadow-inset-sm)}.track b{display:block;height:100%;background:linear-gradient(90deg,color-mix(in srgb,var(--signal,#665de2) 72%,white),var(--signal,#665de2));border-radius:inherit;box-shadow:0 0 9px color-mix(in srgb,var(--signal,#665de2) 35%,transparent);transition:width .42s cubic-bezier(.2,.9,.2,1)}.track em{position:absolute;top:0;bottom:0;width:1px;background:rgb(255 255 255 / 72%);box-shadow:0 0 4px rgb(37 46 65 / 28%)}.signal footer small{color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale));font-weight:680}.signal p{margin:0;overflow:hidden;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.recall{--signal:#35a98c}.vocabulary{--signal:#d2964f}@keyframes pet-pulse{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(.88)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}}@media(max-width:1050px){.learning-pulse{grid-template-columns:1fr}.signals{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:720px){.signals{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
