<script lang="ts">
  import type { IloSnapshot } from '../../../lib/domain/ilo';
  import { journeyNextAvailableAt, journeyWordForGame } from '../../../lib/services/lingvolernandoGame';
  import LumaCreature from './LumaCreature.svelte';
  import RoomHeader from './RoomHeader.svelte';

  type Props = { onAnswer: (remembered: boolean) => void; onHome: () => void; snapshot: Readonly<IloSnapshot> };
  let { onAnswer, onHome, snapshot }: Props = $props();
  let now = $state(Date.now());
  let revealed = $state(false);

  const word = $derived(journeyWordForGame(snapshot.lingvolernando, now));
  const nextAt = $derived(journeyNextAvailableAt(snapshot.lingvolernando, now));
  const queueSize = $derived(snapshot.lingvolernando.journey.remainingWordIds.length || snapshot.lingvolernando.journey.words.length);
  const position = $derived(snapshot.lingvolernando.journey.position);

  // The gate only changes when the next hourly slot opens. A one-shot timer
  // avoids waking the renderer every few seconds while still updating the
  // countdown promptly when a word becomes available.
  $effect(() => {
    const availableAt = nextAt;
    const delay = availableAt !== null && availableAt > Date.now()
      ? Math.min(60_000, Math.max(1_000, availableAt - Date.now()))
      : 60_000;
    const timer = setTimeout(() => { now = Date.now(); }, delay);
    return () => clearTimeout(timer);
  });

  function waitLabel(timestamp: number | null): string {
    if (timestamp === null) return 'No mature words yet';
    const remaining = Math.max(0, timestamp - now);
    if (remaining === 0) return 'Ready now';
    const minutes = Math.ceil(remaining / 60_000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
  }

  function answer(remembered: boolean): void {
    if (!revealed || !word) return;
    onAnswer(remembered);
    revealed = false;
    now = Date.now();
  }
</script>

<section class="journey-room">
  <RoomHeader
    eyebrow="Long-memory queue"
    title="The Memory Trail"
    summary="Once an hour, one older German word returns. Remember it and move forward; forget it and move back. A word cannot repeat until the queue has completed a full round."
    {onHome}
  />

  <div class="trail-overview">
    <div class="trail-copy"><span>Current expedition</span><strong>Position {position}</strong><small>Best {snapshot.lingvolernando.journey.bestPosition} · {snapshot.lingvolernando.journey.roundsCompleted} completed rounds</small></div>
    <div class="trail-ribbon" aria-label={`Current trail position ${position}`}>
      <i></i>
      {#each Array(11) as _, index}
        {@const step = position + index - 5}
        <span class:current={index === 5} class:passed={index < 5}><b>{step}</b></span>
      {/each}
      <div class="traveller"><LumaCreature mood={snapshot.lingvolernando.pet.mood} palette={snapshot.lingvolernando.pet.palette} size={76} /></div>
    </div>
    <div class="trail-status"><span>{word ? 'Memory gate open' : nextAt ? 'Gate recharging' : 'Build the queue'}</span><strong>{word ? 'One recall available' : waitLabel(nextAt)}</strong><small>{queueSize} words remain in the no-repeat cycle</small></div>
  </div>

  <div class="journey-layout">
    <section class:ready={Boolean(word)} class="recall-gate">
      <div class="gate-scene" aria-hidden="true">
        <span class="moon"></span><span class="hill one"></span><span class="hill two"></span><span class="path"></span>
        <i class="star star-a"></i><i class="star star-b"></i><i class="star star-c"></i>
        <div class="gate"><i></i><b></b><span>{word ? '?' : '◷'}</span></div>
      </div>

      {#if word}
        <div class="challenge">
          <span class="eyebrow">Older word · stage {word.stage}</span>
          <h3>{word.german}</h3>
          <p>Recall the meaning before opening the answer.</p>
          {#if revealed}
            <div class="answer"><small>Meaning</small><strong>{word.translation}</strong></div>
            <div class="grade-buttons">
              <button class="forgot" type="button" onclick={() => answer(false)}><span>←</span><div><strong>I forgot</strong><small>Move one step back</small></div></button>
              <button class="remember" type="button" onclick={() => answer(true)}><div><strong>I remembered</strong><small>Move one step forward</small></div><span>→</span></button>
            </div>
          {:else}
            <button class="reveal" type="button" onclick={() => { revealed = true; }}>Reveal meaning</button>
          {/if}
        </div>
      {:else if snapshot.lingvolernando.journey.words.length === 0}
        <div class="challenge empty"><span class="eyebrow">Queue is forming</span><h3>Train mature words first</h3><p>Words enter this separate trail after they reach a durable SRS stage. Normal training remains the only source.</p><button class="reveal" type="button" onclick={onHome}>Return home</button></div>
      {:else}
        <div class="challenge empty"><span class="eyebrow">Next hourly recall</span><h3>{waitLabel(nextAt)}</h3><p>The next item is already reserved from the no-repeat queue. Nothing is fetched from Cloudflare while you wait.</p><button class="reveal" type="button" onclick={onHome}>Explore another room</button></div>
      {/if}
    </section>

    <aside class="queue-console">
      <header><span>How it works</span><h3>A second memory system</h3><p>The Trail never replaces spaced repetition. It samples only established words and tests whether they still feel alive.</p></header>
      <div class="rule-list">
        <article><span>01</span><div><strong>One gate per hour</strong><small>No session timer and no pressure. The gate waits for you.</small></div></article>
        <article><span>02</span><div><strong>No repeat in a round</strong><small>The queue must exhaust before an old word can return.</small></div></article>
        <article><span>03</span><div><strong>Honest movement</strong><small>Remember moves forward. Forget moves back. Both still teach the game.</small></div></article>
      </div>
      <div class="queue-meter"><span><small>Known by Trail</small><strong>{snapshot.lingvolernando.journey.words.length}</strong></span><span><small>Current cycle</small><strong>{queueSize}</strong></span><span><small>Position</small><strong>{position}</strong></span></div>
    </aside>
  </div>
</section>

<style>
  .journey-room{display:grid;gap:15px;min-width:0;padding:24px;animation:scene-in .32s ease-out}.trail-overview{display:grid;grid-template-columns:190px minmax(0,1fr) 210px;align-items:center;gap:16px;min-width:0;padding:13px 16px;background:var(--sui-bg);border-radius:20px;box-shadow:var(--sui-shadow-raised)}.trail-copy,.trail-status{display:grid;gap:3px;min-width:0}.trail-copy>span,.trail-status>span,.eyebrow,.queue-console>header>span{color:var(--sui-primary);font-size:calc(6px * var(--text-scale));font-weight:820;letter-spacing:.13em;text-transform:uppercase}.trail-copy strong,.trail-status strong{font-size:calc(11px * var(--text-scale))}.trail-copy small,.trail-status small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));line-height:1.35}.trail-status{text-align:right}.trail-ribbon{position:relative;display:flex;align-items:center;justify-content:space-between;min-width:0;height:64px;padding:0 15px}.trail-ribbon>i{position:absolute;right:16px;left:16px;height:5px;background:linear-gradient(90deg,#7b72e4,#4fae99);border-radius:99px;box-shadow:var(--sui-shadow-inset-sm)}.trail-ribbon>span{position:relative;z-index:1;display:grid;width:22px;height:22px;color:var(--sui-text-muted);background:var(--sui-bg);border-radius:50%;box-shadow:var(--sui-shadow-raised-sm);place-items:center}.trail-ribbon>span b{font-size:calc(5px * var(--text-scale))}.trail-ribbon>span.passed{color:white;background:#7168df}.trail-ribbon>span.current{width:32px;height:32px;color:white;background:#36a88c;box-shadow:0 0 0 7px rgb(54 168 140 / 13%),0 7px 17px rgb(54 168 140 / 25%)}.traveller{position:absolute;bottom:33px;left:50%;z-index:3;pointer-events:none;transform:translateX(-50%)}
  .journey-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,320px);gap:14px;min-width:0}.recall-gate,.queue-console{min-width:0;background:var(--sui-bg);border-radius:25px;box-shadow:var(--sui-shadow-raised)}.recall-gate{display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);min-height:520px;overflow:hidden}.gate-scene{position:relative;min-width:0;min-height:520px;overflow:hidden;background:linear-gradient(180deg,#c8d5eb 0 55%,#c9d8d0 56%);box-shadow:var(--sui-shadow-inset)}.moon{position:absolute;top:45px;right:58px;width:75px;height:75px;background:#f4eccb;border-radius:50%;box-shadow:0 0 38px rgb(244 231 174 / 65%);animation:moon 4s ease-in-out infinite}.hill{position:absolute;bottom:-90px;width:380px;height:300px;background:#9fb9ae;border-radius:50%}.hill.one{left:-120px}.hill.two{right:-150px;background:#abb6cb}.path{position:absolute;bottom:-5px;left:42%;width:100px;height:270px;background:linear-gradient(180deg,#ddc89f,#eee2c9);clip-path:polygon(47% 0,55% 0,100% 100%,0 100%)}.gate{position:absolute;bottom:145px;left:50%;display:grid;width:105px;height:145px;border:14px solid #6f6ad0;border-bottom:0;border-radius:70px 70px 0 0;box-shadow:0 0 32px rgb(104 95 219 / 28%),inset 0 0 28px rgb(255 255 255 / 35%);place-items:center;transform:translateX(-50%)}.gate::before{position:absolute;inset:8px;background:linear-gradient(180deg,rgb(107 98 221 / 35%),rgb(61 169 143 / 22%));border-radius:55px 55px 0 0;content:'';animation:gate-flow 3s ease-in-out infinite}.gate span{position:relative;z-index:1;color:white;font-size:calc(26px * var(--text-scale));font-weight:850;text-shadow:0 4px 14px rgb(50 54 87 / 45%)}.gate i,.gate b{position:absolute;z-index:2;width:9px;height:9px;background:white;border-radius:50%;box-shadow:0 0 12px white;animation:orbit 6s linear infinite}.gate i{top:14px;left:-17px;transform-origin:69px 57px}.gate b{right:-17px;bottom:24px;animation-direction:reverse}.star{position:absolute;width:5px;height:5px;background:#746ae4;border-radius:50%;animation:star 2.7s ease-in-out infinite}.star-a{top:18%;left:16%}.star-b{top:31%;right:19%;animation-delay:-.9s}.star-c{top:12%;left:53%;animation-delay:-1.8s}.challenge{display:grid;align-content:center;gap:10px;min-width:0;padding:38px}.challenge h3{min-width:0;margin:0;color:var(--sui-text);font-size:clamp(calc(28px * var(--text-scale)),4vw,calc(47px * var(--text-scale)));line-height:1;letter-spacing:-.055em;overflow-wrap:anywhere;text-wrap:balance}.challenge>p{min-width:0;margin:0;color:var(--sui-text-muted);font-size:calc(9px * var(--text-scale));line-height:1.5;overflow-wrap:anywhere}.answer{display:grid;gap:4px;min-width:0;margin-top:9px;padding:16px 18px;background:color-mix(in srgb,var(--sui-bg-light) 84%,#d6d2ef 16%);border-radius:16px;box-shadow:var(--sui-shadow-inset);animation:answer-in .28s ease-out}.answer small{color:var(--sui-primary);font-size:calc(6px * var(--text-scale));font-weight:820;text-transform:uppercase}.answer strong{font-size:calc(14px * var(--text-scale));overflow-wrap:anywhere}.reveal{min-height:48px;margin-top:9px;color:white;font:inherit;font-size:calc(9px * var(--text-scale));font-weight:770;background:linear-gradient(135deg,#6960e4,#5049cb);border:0;border-radius:14px;box-shadow:0 9px 22px rgb(91 84 224 / 26%);cursor:pointer}.grade-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;min-width:0;margin-top:4px}.grade-buttons button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;min-height:58px;padding:8px 13px;color:var(--sui-text);font:inherit;text-align:left;background:var(--sui-bg);border:0;border-radius:14px;box-shadow:var(--sui-shadow-raised-sm);cursor:pointer}.grade-buttons button:active{box-shadow:var(--sui-shadow-inset-sm)}.grade-buttons div{display:grid;gap:2px;min-width:0}.grade-buttons strong{font-size:calc(8px * var(--text-scale));overflow-wrap:anywhere}.grade-buttons small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));overflow-wrap:anywhere}.grade-buttons span{font-size:calc(15px * var(--text-scale));font-weight:850}.forgot span{color:#c57b46}.remember span{color:#2ca481}.empty h3{font-size:calc(24px * var(--text-scale))}
  .queue-console{display:grid;align-content:start;gap:14px;padding:20px}.queue-console>header{display:grid;gap:4px}.queue-console h3{margin:0;font-size:calc(17px * var(--text-scale));letter-spacing:-.035em}.queue-console>header p{margin:2px 0 0;color:var(--sui-text-muted);font-size:calc(8px * var(--text-scale));line-height:1.45}.rule-list{display:grid;gap:8px}.rule-list article{display:grid;grid-template-columns:35px minmax(0,1fr);align-items:center;gap:9px;padding:10px;background:var(--sui-bg);border-radius:13px;box-shadow:var(--sui-shadow-inset-sm)}.rule-list article>span{display:grid;width:34px;height:34px;color:white;font-size:calc(6px * var(--text-scale));font-weight:830;background:linear-gradient(145deg,#776de5,#5149c9);border-radius:10px;place-items:center}.rule-list article>div{display:grid;gap:2px}.rule-list strong{font-size:calc(8px * var(--text-scale))}.rule-list small{color:var(--sui-text-muted);font-size:calc(6px * var(--text-scale));line-height:1.35}.queue-meter{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.queue-meter>span{display:grid;gap:3px;padding:9px 7px;text-align:center;background:var(--sui-bg);border-radius:11px;box-shadow:var(--sui-shadow-raised-sm)}.queue-meter small{color:var(--sui-text-muted);font-size:calc(5px * var(--text-scale))}.queue-meter strong{color:var(--sui-primary);font-size:calc(10px * var(--text-scale))}
  @keyframes scene-in{from{opacity:0;transform:translateY(8px)}}@keyframes moon{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}@keyframes gate-flow{0%,100%{opacity:.55;transform:scaleY(.94)}50%{opacity:1;transform:scaleY(1)}}@keyframes orbit{to{rotate:360deg}}@keyframes star{0%,100%{opacity:.25;transform:scale(.6)}50%{opacity:1;transform:scale(1.4)}}@keyframes answer-in{from{opacity:0;transform:translateY(8px)}}@media(max-width:1050px){.trail-overview{grid-template-columns:160px 1fr}.trail-status{grid-column:1/-1;text-align:left}.journey-layout{grid-template-columns:1fr}.queue-console{grid-template-columns:230px 1fr}.queue-console>.rule-list{grid-column:2;grid-row:1/3}.queue-meter{grid-column:1/-1}}@media(max-width:720px){.journey-room{padding:17px}.trail-overview{grid-template-columns:1fr}.trail-ribbon{order:3}.recall-gate{grid-template-columns:1fr}.gate-scene{min-height:330px}.challenge{padding:24px}.queue-console{grid-template-columns:1fr}.queue-console>.rule-list{grid-column:auto;grid-row:auto}.grade-buttons{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
