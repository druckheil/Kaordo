<script lang="ts">
  import type { LingvolernandoWorldElementDefinition } from '../../../lib/domain/lingvolernando';

  type Props = { element: LingvolernandoWorldElementDefinition; locked?: boolean; size?: number };
  let { element, locked = false, size = 72 }: Props = $props();
  const variant = $derived(element.sprite % 20);
  const duration = $derived(3.2 + (element.sprite % 9) * 0.27);
</script>

<span
  class:locked
  class="world-sprite kind-{element.kind} variant-{variant}"
  style={`--sprite-size:${size}px;--sprite-accent:${element.accent};--sprite-duration:${duration}s;--sprite-delay:${(element.sprite % 7) * -.19}s`}
  aria-hidden="true"
>
  <svg viewBox="0 0 100 100">
    <ellipse class="ground-shadow" cx="50" cy="83" rx="29" ry="7" />
    {#if variant === 0}
      <path class="main" d="M49 82V45C35 49 27 40 28 27c15-3 24 5 22 18 3-17 13-26 27-22 2 15-8 27-27 24" />
      <path class="detail" d="M36 34c7 2 11 6 14 11M68 32c-8 4-13 9-18 15" />
    {:else if variant === 1}
      <g class="wing wing-left"><path class="main" d="M48 48C31 29 17 34 20 48c3 12 16 17 28 8Z"/><path class="detail" d="M25 42c8 2 15 6 23 13"/></g>
      <g class="wing wing-right"><path class="main" d="M52 48c17-19 31-14 28 0-3 12-16 17-28 8Z"/><path class="detail" d="M75 42c-8 2-15 6-23 13"/></g><circle class="core" cx="50" cy="53" r="8"/>
    {:else if variant === 2}
      <path class="main" d="M22 71c7-22 17-37 29-48 15 13 23 29 28 48Z" />
      <path class="detail" d="m51 25-8 26 10-5 4 23M28 66h44" />
    {:else if variant === 3}
      <path class="main" d="M20 59c7-22 19-32 30-18 11-14 23-4 30 18-9 19-51 19-60 0Z" />
      <path class="detail" d="M25 59c8-10 16-9 25 0 9-9 17-10 25 0" />
      <circle class="spark" cx="50" cy="45" r="5" />
    {:else if variant === 4}
      <ellipse class="main" cx="50" cy="64" rx="31" ry="18"/><path class="main" d="M29 62c1-24 11-36 21-36s20 12 21 36Z"/><path class="detail" d="M37 52h26M41 41h18"/><circle class="spark" cx="50" cy="34" r="4"/>
    {:else if variant === 5}
      <path class="main" d="M45 84V39L30 28M45 55 63 39M45 68l23-12M45 49l-16 9"/><circle class="leaf" cx="28" cy="26" r="11"/><circle class="leaf" cx="65" cy="36" r="12"/><circle class="leaf" cx="70" cy="54" r="10"/><circle class="leaf" cx="27" cy="58" r="9"/>
    {:else if variant === 6}
      <path class="main" d="M28 67c2-19 12-31 27-28l10-11 4 15c10 7 10 21 2 31-16 8-34 5-43-7Z"/><path class="detail" d="M35 63c10 7 22 8 34 2M56 46h.1"/><path class="tail" d="M29 62C16 57 16 43 25 40"/>
    {:else if variant === 7}
      <path class="main" d="M18 74h64M27 74V48h46v26M21 48h58L66 31H34Z"/><path class="detail" d="M39 74V58h22v16M31 48h38"/>
    {:else if variant === 8}
      <path class="star main" d="m50 18 8 22 24 1-19 15 7 24-20-13-20 13 7-24-19-15 24-1Z"/><circle class="spark" cx="50" cy="49" r="8"/>
    {:else if variant === 9}
      <path class="main kite" d="m51 19 25 27-25 25-25-25Z"/><path class="detail" d="M51 20v51M27 46h49M51 71c-5 9 8 8 2 16"/>
    {:else if variant === 10}
      <path class="main" d="M20 79V38l30-20 30 20v41M20 43h60M35 79V52h30v27"/><path class="detail" d="M44 63h12M50 52v27"/>
    {:else if variant === 11}
      <path class="main bird" d="M19 54c13-3 21-9 27-20 4 9 6 16 4 24 7-10 17-13 31-10-10 17-29 24-45 17Z"/><path class="detail" d="M39 60c11-4 20-8 29-12"/>
    {:else if variant === 12}
      <path class="main" d="M34 81V40l16-20 16 20v41Z"/><path class="detail" d="M39 47h22M39 62h22M50 25v55"/><circle class="spark" cx="50" cy="45" r="7"/>
    {:else if variant === 13}
      <path class="main" d="M16 75C27 62 32 47 33 25c15 14 22 32 18 51 8-18 18-30 34-38-1 20-8 33-23 39Z"/><path class="detail" d="M24 72c12-9 20-22 26-39M55 72c7-12 15-21 24-28"/>
    {:else if variant === 14}
      <path class="main" d="M23 34c17-11 37-11 54 0L70 74c-14 10-26 10-40 0Z"/><path class="detail" d="M28 38c15 8 29 8 44 0M39 50h22M36 61h28"/>
    {:else if variant === 15}
      <circle class="main" cx="33" cy="57" r="14"/><circle class="main" cx="67" cy="57" r="14"/><path class="main" d="M33 43c2-20 32-20 34 0M33 71c2 18 32 18 34 0"/><path class="detail" d="M46 31h8M46 81h8"/>
    {:else if variant === 16}
      <path class="main" d="M20 75c5-30 17-48 30-48s25 18 30 48Z"/><path class="detail" d="M27 66h46M32 55h36M38 44h24M50 27v48"/>
    {:else if variant === 17}
      <path class="main" d="M22 75V28h56v47Z"/><path class="detail" d="M35 28v47M49 28v47M63 28v47M22 43h56M22 59h56"/><path class="thread" d="M25 71c15-19 34-29 50-35"/>
    {:else if variant === 18}
      <path class="main" d="M50 17 65 43l18 9-17 11-6 22-10-13-10 13-6-22-17-11 18-9Z"/><path class="detail" d="m50 25 5 24 20 3-19 6-6 20-6-20-19-6 20-3Z"/>
    {:else}
      <path class="main" d="M48 82V49c-10-19-26-18-30-5 7 12 17 15 30 10 10-20 26-19 34-7-7 13-18 16-34 10"/><path class="detail" d="M48 74h24M48 65h18M48 54c-7-3-15-6-23-11M49 53c8-2 17-4 26-7"/>
    {/if}
    <g class="motes"><circle cx="18" cy="24" r="2"/><circle cx="84" cy="23" r="1.7"/><circle cx="89" cy="72" r="2.2"/></g>
  </svg>
</span>

<style>
  .world-sprite { display:inline-grid; width:var(--sprite-size); height:var(--sprite-size); color:var(--sprite-accent); place-items:center; contain:layout paint; }
  svg { width:100%; height:100%; overflow:visible; }
  .ground-shadow { fill:rgb(37 48 67 / 13%); }
  .main { fill:color-mix(in srgb,var(--sprite-accent) 36%,#edf2f8 64%); stroke:color-mix(in srgb,var(--sprite-accent) 82%,#2b3548 18%); stroke-width:2.8; stroke-linecap:round; stroke-linejoin:round; }
  .detail,.tail,.thread { fill:none; stroke:color-mix(in srgb,var(--sprite-accent) 72%,#35415a 28%); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
  .leaf { fill:color-mix(in srgb,var(--sprite-accent) 55%,white); stroke:var(--sprite-accent); stroke-width:2.4; }
  .core,.spark { fill:white; stroke:var(--sprite-accent); stroke-width:2; }
  .motes { fill:var(--sprite-accent); opacity:.5; animation:motes var(--sprite-duration) ease-in-out infinite; animation-delay:var(--sprite-delay); }
  .wing { transform-origin:50px 52px; animation:wing var(--sprite-duration) ease-in-out infinite; animation-delay:var(--sprite-delay); }
  .wing-right { animation-direction:reverse; }
  .bird,.kite,.star { transform-origin:50px 52px; animation:float var(--sprite-duration) ease-in-out infinite; animation-delay:var(--sprite-delay); }
  .tail { transform-origin:29px 62px; animation:tail calc(var(--sprite-duration) * .6) ease-in-out infinite; }
  .thread { stroke-dasharray:4 4; animation:thread 2.4s linear infinite; }
  .kind-flora svg { animation:sway var(--sprite-duration) ease-in-out infinite; animation-delay:var(--sprite-delay); transform-origin:50px 82px; }
  .kind-creature svg { animation:creature var(--sprite-duration) cubic-bezier(.45,.05,.55,.95) infinite; animation-delay:var(--sprite-delay); }
  .kind-phenomenon svg { animation:phenomenon var(--sprite-duration) ease-in-out infinite; animation-delay:var(--sprite-delay); }
  .kind-workshop .spark { animation:spark 1.9s ease-in-out infinite; }
  .locked { filter:grayscale(1); opacity:.26; }
  .locked svg { animation:none !important; }
  .locked .main { fill:#7f899c; stroke:#626d81; }
  .locked .detail,.locked .tail,.locked .thread { stroke:#626d81; }
  @keyframes motes { 0%,100%{transform:translateY(3px);opacity:.25}50%{transform:translateY(-5px);opacity:.75} }
  @keyframes wing { 0%,100%{transform:rotate(-8deg) scaleY(.88)}50%{transform:rotate(9deg) scaleY(1.08)} }
  @keyframes float { 0%,100%{transform:translateY(2px) rotate(-2deg)}50%{transform:translateY(-5px) rotate(2deg)} }
  @keyframes tail { 0%,100%{transform:rotate(-8deg)}50%{transform:rotate(14deg)} }
  @keyframes thread { to{stroke-dashoffset:-16} }
  @keyframes sway { 0%,100%{transform:rotate(-2deg)}50%{transform:rotate(3deg)} }
  @keyframes creature { 0%,100%{transform:translateY(1px)}42%{transform:translateY(-4px)}55%{transform:translateY(-4px) rotate(1deg)} }
  @keyframes phenomenon { 0%,100%{transform:scale(.96) rotate(-2deg);filter:brightness(.95)}50%{transform:scale(1.05) rotate(2deg);filter:brightness(1.12)} }
  @keyframes spark { 0%,100%{transform:scale(.7);opacity:.45}50%{transform:scale(1.25);opacity:1} }
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
