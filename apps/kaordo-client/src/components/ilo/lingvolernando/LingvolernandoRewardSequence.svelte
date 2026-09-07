<script lang="ts">
  import type { LingvolernandoRewardOutcome } from '../../../lib/domain/lingvolernando';
  import { LINGVOLERNANDO_ACHIEVEMENTS, LINGVOLERNANDO_ARTIFACTS, LINGVOLERNANDO_SYNERGIES, LINGVOLERNANDO_WORLD } from '../../../lib/services/lingvolernandoGame';
  import ArtifactGlyph from './ArtifactGlyph.svelte';
  import LumaCreature from './LumaCreature.svelte';
  import WorldSprite from './WorldSprite.svelte';

  type Props = { onClose: () => void; outcome: LingvolernandoRewardOutcome };
  let { onClose, outcome }: Props = $props();
  const artifact = $derived(LINGVOLERNANDO_ARTIFACTS.find((item) => item.id === outcome.artifactId) ?? null);
  const worldElement = $derived(LINGVOLERNANDO_WORLD.find((item) => item.id === outcome.worldElementId) ?? null);
  const achievements = $derived(LINGVOLERNANDO_ACHIEVEMENTS.filter((item) => outcome.newlyClaimedAchievementIds.includes(item.id)));
  const achievementRewards = $derived(LINGVOLERNANDO_ARTIFACTS.filter((item) => outcome.achievementRewardArtifactIds.includes(item.id)));
  const synergies = $derived(LINGVOLERNANDO_SYNERGIES.filter((item) => outcome.synergyIds.includes(item.id)));
  const pulseLabel = $derived(outcome.source === 'remembered'
    ? 'Ten words remembered'
    : outcome.source === 'forgotten'
      ? 'Twenty useful misses processed'
      : 'Long-memory trail complete');
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onClose(); }} />

<div class="reward-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) onClose(); }}>
  <div class="reward-sequence rarity-{outcome.rarity ?? 'common'}" role="dialog" aria-modal="true" aria-labelledby="reward-title">
    <button class="close-button" type="button" onclick={onClose} aria-label="Close reward sequence">×</button>
    <div class="particle-field" aria-hidden="true">{#each Array(24) as _, index}<i style={`--particle:${index};--angle:${index * 15}deg;--distance:${80 + (index % 7) * 14}px;--delay:${(index % 8) * .055}s`}></i>{/each}</div>
    <div class="reward-aura"><i></i><i></i><i></i></div>

    <div class="xp-flight"><span>{pulseLabel}</span><strong>+{outcome.xp} XP</strong><i></i></div>

    <div class="reward-focus">
      {#if artifact}
        <ArtifactGlyph {artifact} size={230} level={outcome.artifactLevel ?? 1} />
        <span class="rarity-label">{artifact.rarity} {outcome.artifactWasDuplicate ? 'evolution' : 'discovery'}</span>
        <h2 id="reward-title">{outcome.artifactWasDuplicate ? `${artifact.name} evolved` : artifact.name}</h2>
        <p>{outcome.artifactWasDuplicate ? `The duplicate became level ${outcome.artifactLevel}. ${outcome.dustEarned} artifact dust returned to the vault.` : artifact.description}</p>
      {:else}
        <div class="pure-energy"><LumaCreature mood="glowing" size={205} /></div>
        <span class="rarity-label">Stored energy</span>
        <h2 id="reward-title">The sanctuary grew brighter</h2>
        <p>No artifact emerged this time. The protected deck is now more likely to reveal one on your next learning pulse.</p>
      {/if}
    </div>

    <div class="consequence-row">
      {#if worldElement}
        <article class="consequence world"><WorldSprite element={worldElement} size={72} /><span><small>World awakened</small><strong>{worldElement.name}</strong><p>{worldElement.effect}</p></span></article>
      {/if}
      {#if achievements.length > 0}
        <article class="consequence achievement"><span class="achievement-gem">{achievements.length}</span><span><small>Milestone reached</small><strong>{achievements[0]?.name}</strong><p>{achievementRewards.length > 0 ? `${achievementRewards.length} permanent artifact ${achievementRewards.length === 1 ? 'reward' : 'rewards'} entered your Vault.` : achievements.length > 1 ? `And ${achievements.length - 1} more landmarks.` : achievements[0]?.description}</p></span></article>
      {/if}
      {#if synergies.length > 0}
        <article class="consequence synergy"><span class="synergy-gem"><i></i><i></i><i></i></span><span><small>Active resonance</small><strong>{synergies[0]?.name}</strong><p>{synergies[0]?.description}</p></span></article>
      {/if}
      {#if !worldElement && achievements.length === 0 && synergies.length === 0}
        <article class="consequence quiet"><span class="quiet-orb"></span><span><small>Momentum stored</small><strong>The next draw is stronger</strong><p>Your pity protection increased. An empty streak cannot continue.</p></span></article>
      {/if}
    </div>

    <button class="continue-button" type="button" onclick={onClose}>Return to Lingvolernando</button>
  </div>
</div>

<style>
  .reward-backdrop{position:fixed;inset:0;z-index:1600;display:grid;padding:25px;background:rgb(35 43 60 / 45%);backdrop-filter:blur(12px);place-items:center;animation:backdrop-in .28s ease-out}.reward-sequence{--rarity:#7b72e8;position:relative;display:grid;justify-items:center;width:min(720px,calc(100vw - 40px));max-height:calc(100vh - 40px);padding:34px 37px 29px;overflow:auto;color:var(--sui-text);background:radial-gradient(circle at 50% 32%,color-mix(in srgb,var(--rarity) 15%,var(--sui-bg-light)),var(--sui-bg) 58%);border:1px solid color-mix(in srgb,var(--rarity) 30%,transparent);border-radius:34px;box-shadow:0 28px 90px rgb(29 37 55 / 36%),inset 0 1px 0 rgb(255 255 255 / 42%);isolation:isolate;animation:sequence-in .5s cubic-bezier(.16,1,.3,1)}.rarity-rare{--rarity:#4e9bcf}.rarity-epic{--rarity:#b36bc1}.rarity-mythic{--rarity:#d6a746}.close-button{position:absolute;top:16px;right:16px;z-index:5;display:grid;width:38px;height:38px;color:var(--sui-text-muted);font:inherit;font-size:24px;background:var(--sui-bg);border:0;border-radius:12px;box-shadow:var(--sui-shadow-raised-sm);place-items:center;cursor:pointer}.particle-field,.reward-aura{position:absolute;inset:0;z-index:-1;overflow:hidden;border-radius:inherit;pointer-events:none}.particle-field i{position:absolute;top:39%;left:50%;width:5px;height:5px;background:var(--rarity);border-radius:50%;box-shadow:0 0 9px var(--rarity);opacity:0;animation:particle 1.4s cubic-bezier(.1,.7,.2,1) forwards;animation-delay:calc(.3s + var(--delay))}.particle-field i:nth-child(3n){width:3px;height:3px;background:#fff}.particle-field i:nth-child(4n){border-radius:1px;transform:rotate(45deg)}.reward-aura i{position:absolute;top:37%;left:50%;width:330px;height:330px;border:1px solid color-mix(in srgb,var(--rarity) 30%,transparent);border-radius:50%;transform:translate(-50%,-50%);animation:aura 3.3s ease-in-out infinite}.reward-aura i:nth-child(2){width:250px;height:250px;border-style:dashed;animation:orbit 14s linear infinite}.reward-aura i:nth-child(3){width:410px;height:410px;animation-delay:-1.1s}.xp-flight{display:grid;gap:3px;margin-bottom:-10px;text-align:center;animation:xp-in .65s .15s both}.xp-flight span{color:var(--sui-text-muted);font-size:calc(7px * var(--text-scale));font-weight:780;letter-spacing:.16em;text-transform:uppercase}.xp-flight strong{color:var(--rarity);font-size:calc(18px * var(--text-scale));letter-spacing:-.04em;text-shadow:0 5px 15px color-mix(in srgb,var(--rarity) 25%,transparent)}.xp-flight i{width:42px;height:2px;margin:4px auto;background:linear-gradient(90deg,transparent,var(--rarity),transparent)}.reward-focus{display:grid;max-width:520px;place-items:center;text-align:center;animation:focus-in .7s .28s cubic-bezier(.16,1,.3,1) both}.rarity-label{padding:5px 10px;color:var(--rarity);font-size:calc(7px * var(--text-scale));font-weight:830;letter-spacing:.12em;background:color-mix(in srgb,var(--rarity) 10%,var(--sui-bg));border-radius:99px;box-shadow:var(--sui-shadow-inset-sm);text-transform:uppercase}.reward-focus h2{margin:10px 0 0;font-size:calc(27px * var(--text-scale));line-height:1;letter-spacing:-.05em}.reward-focus p{max-width:500px;margin:8px 0 0;color:var(--sui-text-muted);font-size:calc(9px * var(--text-scale));line-height:1.5}.pure-energy{height:230px}.consequence-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;width:100%;margin-top:24px}.consequence-row>:only-child{grid-column:1/-1}.consequence{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:5px;min-height:93px;padding:8px 11px;background:color-mix(in srgb,var(--sui-bg-light) 84%,transparent);border:1px solid rgb(255 255 255 / 30%);border-radius:16px;box-shadow:var(--sui-shadow-raised-sm);backdrop-filter:blur(7px);animation:consequence-in .5s .72s both}.consequence>span:last-child{display:grid;gap:2px;min-width:0}.consequence small{color:var(--rarity);font-size:calc(6px * var(--text-scale));font-weight:800;letter-spacing:.08em;text-transform:uppercase}.consequence strong{overflow:hidden;font-size:calc(8px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.consequence p{display:-webkit-box;overflow:hidden;margin:0;color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));line-height:1.3;line-clamp:2;-webkit-box-orient:vertical;-webkit-line-clamp:2}.achievement-gem,.synergy-gem,.quiet-orb{display:grid;width:58px;height:58px;color:#fff;font-size:calc(15px * var(--text-scale));font-weight:850;background:linear-gradient(145deg,#d7ac50,#ad7940);border-radius:18px;box-shadow:0 8px 18px rgb(168 117 59 / 25%);place-items:center}.synergy-gem{position:relative;background:linear-gradient(145deg,#8177ee,#4f48c9);border-radius:50%}.synergy-gem i{position:absolute;width:9px;height:9px;background:white;border-radius:50%}.synergy-gem i:nth-child(1){top:11px}.synergy-gem i:nth-child(2){right:10px;bottom:12px}.synergy-gem i:nth-child(3){bottom:12px;left:10px}.quiet-orb{background:radial-gradient(circle at 35% 30%,#fff 0 7%,#8378ed 9% 45%,#5149c8 70%);border-radius:50%;animation:quiet 2.4s ease-in-out infinite}.continue-button{min-height:47px;margin-top:18px;padding:0 25px;color:#fff;font:inherit;font-size:calc(9px * var(--text-scale));font-weight:770;background:linear-gradient(135deg,color-mix(in srgb,var(--rarity) 84%,#665de1),color-mix(in srgb,var(--rarity) 42%,#4e47c9));border:0;border-radius:14px;box-shadow:0 10px 24px color-mix(in srgb,var(--rarity) 26%,transparent);cursor:pointer;animation:consequence-in .5s .9s both}.continue-button:hover{transform:translateY(-2px)}
  @keyframes backdrop-in{from{opacity:0}}@keyframes sequence-in{from{opacity:0;transform:translateY(18px) scale(.94)}}@keyframes xp-in{from{opacity:0;transform:translateY(14px)}}@keyframes focus-in{from{opacity:0;transform:scale(.62) rotate(-5deg)}}@keyframes consequence-in{from{opacity:0;transform:translateY(12px)}}@keyframes particle{0%{opacity:0;transform:rotate(var(--angle)) translateX(0) scale(.2)}20%{opacity:1}100%{opacity:0;transform:rotate(var(--angle)) translateX(var(--distance)) scale(1)}}@keyframes aura{0%,100%{transform:translate(-50%,-50%) scale(.9);opacity:.25}50%{transform:translate(-50%,-50%) scale(1.08);opacity:.62}}@keyframes orbit{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}@keyframes quiet{0%,100%{transform:scale(.94);box-shadow:0 7px 18px rgb(91 84 224 / 18%)}50%{transform:scale(1.05);box-shadow:0 10px 27px rgb(91 84 224 / 38%)}}
  @media(max-width:680px){.reward-sequence{padding:29px 18px 22px}.consequence-row{grid-template-columns:1fr}.consequence-row>:only-child{grid-column:auto}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
