<script lang="ts">
  import type { LingvolernandoArtifactDefinition } from '../../../lib/domain/lingvolernando';

  type Props = {
    artifact: LingvolernandoArtifactDefinition | null;
    level?: number;
    locked?: boolean;
    size?: number;
  };

  let { artifact, level = 1, locked = false, size = 96 }: Props = $props();
  const form = $derived(artifact?.form ?? 0);
  const motion = $derived((artifact?.animationIndex ?? 0) % 12);
  const phase = $derived(((artifact?.animationIndex ?? 0) % 17) * -0.11);
  const duration = $derived(2.8 + ((artifact?.animationIndex ?? 0) % 11) * 0.13);
</script>

<span
  class:locked
  class="artifact-glyph modifier-{artifact?.modifier ?? 'void'} motion-{motion}"
  style={`--glyph-size:${size}px;--artifact-accent:${artifact?.accent ?? '#8993a8'};--motion-delay:${phase}s;--motion-duration:${duration}s;--artifact-level:${Math.min(level, 9)}`}
  aria-hidden="true"
>
  <svg viewBox="0 0 120 120">
    <defs>
      <radialGradient id={`core-${artifact?.id ?? 'locked'}`} cx="35%" cy="26%" r="72%">
        <stop offset="0" stop-color="white" stop-opacity=".94" />
        <stop offset=".34" stop-color="var(--artifact-accent)" stop-opacity=".9" />
        <stop offset="1" stop-color="var(--artifact-accent)" stop-opacity=".18" />
      </radialGradient>
      <filter id={`glow-${artifact?.id ?? 'locked'}`} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <circle class="halo halo-one" cx="60" cy="60" r="47" />
    <circle class="halo halo-two" cx="60" cy="60" r="38" />
    <g class="satellites">
      <circle cx="60" cy="11" r="3" />
      <circle cx="106" cy="65" r="2.4" />
      <circle cx="25" cy="92" r="2.8" />
    </g>

    <g class="artifact-form" filter={`url(#glow-${artifact?.id ?? 'locked'})`}>
      {#if form === 0}
        <circle class="mass" cx="60" cy="60" r="25" />
        <path class="etch" d="M60 38 68 60 60 82 52 60Z" />
        <path class="etch faint" d="M37 60h46M60 37v46" />
      {:else if form === 1}
        <path class="mass" d="M42 83h36l-5-13V45L60 30 47 45v25Z" />
        <path class="etch" d="M51 48h18M50 70h20M54 83v8h12v-8" />
        <circle class="spark" cx="60" cy="55" r="6" />
      {:else if form === 2}
        <path class="mass" d="M60 89C35 77 31 51 47 38c8 8 13 2 13-8 10 8 18 5 21 1 11 22 2 48-21 58Z" />
        <path class="etch" d="M60 82V48M60 61 47 52M60 68l14-12" />
      {:else if form === 3}
        <path class="mass" d="M29 75c23-1 30-33 63-39-7 31-24 53-63 39Z" />
        <path class="etch" d="M35 73c18-8 35-20 51-33M55 62l-2-15M67 54l10 7" />
      {:else if form === 4}
        <circle class="mass" cx="48" cy="56" r="19" />
        <path class="mass" d="M62 55h34v12H84v12H73V67H62Z" />
        <circle class="etch" cx="48" cy="56" r="7" />
      {:else if form === 5}
        <path class="mass" d="M44 27h32l-8 22 13 15-21 29-21-29 13-15Z" />
        <path class="etch" d="M52 49h16M43 65h34M60 29v62" />
      {:else if form === 6}
        <circle class="mass" cx="60" cy="60" r="31" />
        <ellipse class="etch" cx="60" cy="60" rx="17" ry="30" />
        <path class="etch faint" d="M31 60h58M39 43c12 6 30 6 42 0M39 77c12-6 30-6 42 0" />
      {:else if form === 7}
        <path class="mass" d="M45 34h30v9c0 13 7 19 15 28-9 13-51 13-60 0 8-9 15-15 15-28Z" />
        <path class="etch" d="M39 70h42M49 34V25h22v9" />
        <circle class="spark" cx="60" cy="55" r="5" />
      {:else if form === 8}
        <path class="mass" d="M60 91C35 81 27 59 34 37c13 4 20-3 26-13 6 10 13 17 26 13 7 22-1 44-26 54Z" />
        <path class="etch" d="M60 84V36M60 54 45 43M60 66l17-15" />
      {:else}
        <path class="mass" d="M57 86C39 74 30 55 31 35c14 2 25 11 29 24 4-13 15-22 29-24 1 20-8 39-26 51l-3 9Z" />
        <path class="etch" d="M35 40c11 9 18 21 25 39M85 40C74 49 67 61 60 79" />
      {/if}
    </g>

    {#if level > 1 && !locked}
      <g class="level-stars">
        {#each Array(Math.min(5, level - 1)) as _, index}
          <path transform={`rotate(${index * 72} 60 60)`} d="M60 5 62 9 66 10 62 13 63 18 60 15 57 18 58 13 54 10 58 9Z" />
        {/each}
      </g>
    {/if}
  </svg>
</span>

<style>
  .artifact-glyph {
    position: relative;
    display: inline-grid;
    width: var(--glyph-size);
    height: var(--glyph-size);
    flex: 0 0 auto;
    color: var(--artifact-accent);
    place-items: center;
    contain: layout paint;
    filter: saturate(calc(.88 + var(--artifact-level) * .035));
  }
  svg { width: 100%; height: 100%; overflow: visible; }
  .halo { fill: none; stroke: currentColor; transform-origin: 60px 60px; }
  .halo-one { stroke-width: 1.3; stroke-dasharray: 4 9; opacity: .33; animation: orbit var(--motion-duration) linear infinite; animation-delay: var(--motion-delay); }
  .halo-two { stroke-width: 2; stroke-dasharray: 1 12; opacity: .23; animation: orbit calc(var(--motion-duration) * 1.7) linear reverse infinite; animation-delay: var(--motion-delay); }
  .satellites { fill: currentColor; transform-origin: 60px 60px; animation: counter-orbit calc(var(--motion-duration) * 2.1) ease-in-out infinite; animation-delay: var(--motion-delay); }
  .mass { fill: url('#core'); fill: color-mix(in srgb, var(--artifact-accent) 68%, white 32%); stroke: color-mix(in srgb, var(--artifact-accent) 76%, #273248 24%); stroke-width: 2; stroke-linejoin: round; }
  .etch { fill: none; stroke: rgb(255 255 255 / 82%); stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round; }
  .etch.faint { opacity: .46; stroke-width: 1.4; }
  .spark { fill: white; stroke: none; transform-origin: 60px 55px; animation: spark calc(var(--motion-duration) * .72) ease-in-out infinite; }
  .artifact-form { transform-origin: 60px 60px; animation: breathe var(--motion-duration) ease-in-out infinite; animation-delay: var(--motion-delay); }
  .level-stars { fill: color-mix(in srgb, var(--artifact-accent) 52%, white); transform-origin: 60px 60px; animation: orbit 9s linear infinite; }
  .locked { color: #8a94a8; filter: grayscale(1); opacity: .45; }
  .locked .artifact-form { filter: none; }
  .locked .mass { fill: #7c879b; stroke: #677287; }
  .modifier-lunar .artifact-form { filter: drop-shadow(0 0 7px color-mix(in srgb, var(--artifact-accent) 62%, transparent)); }
  .modifier-garden .satellites { animation-timing-function: cubic-bezier(.2,.8,.3,1); }
  .modifier-solar .halo-one { stroke-width: 2.6; }
  .modifier-crystal .mass { stroke-width: 3; }
  .modifier-prism .artifact-form { filter: drop-shadow(4px 1px 0 rgb(85 149 207 / 15%)) drop-shadow(-3px 1px 0 rgb(201 111 145 / 12%)); }
  .modifier-aurora .halo-two { opacity: .5; }
  .modifier-echo .artifact-form { animation-name: echo-breathe; }
  .modifier-void .halo-one { stroke-dasharray: 12 6; }
  .motion-1 .artifact-form { animation-name: tilt; }
  .motion-2 .artifact-form { animation-name: hover; }
  .motion-3 .artifact-form { animation-name: heartbeat; }
  .motion-4 .artifact-form { animation-name: pendulum; }
  .motion-5 .artifact-form { animation-name: bloom; }
  .motion-6 .satellites { animation-name: comet; }
  .motion-7 .artifact-form { animation-name: drift; }
  .motion-8 .halo-one { animation-name: halo-pulse; }
  .motion-9 .artifact-form { animation-name: prism-step; }
  .motion-10 .artifact-form { animation-name: wave; }
  .motion-11 .artifact-form { animation-name: reveal; }
  @keyframes orbit { to { transform: rotate(360deg); } }
  @keyframes counter-orbit { 0%,100% { transform: rotate(-8deg) scale(.97); } 50% { transform: rotate(15deg) scale(1.04); } }
  @keyframes breathe { 0%,100% { transform: translateY(1px) scale(.96); } 50% { transform: translateY(-3px) scale(1.035); } }
  @keyframes echo-breathe { 0%,100% { transform: scale(.96); opacity: .82; } 45% { transform: scale(1.06); opacity: 1; } 62% { transform: scale(1.01); } }
  @keyframes tilt { 0%,100% { transform: rotate(-3deg) translateY(1px); } 50% { transform: rotate(4deg) translateY(-2px); } }
  @keyframes hover { 0%,100% { transform: translateY(3px); } 50% { transform: translateY(-5px); } }
  @keyframes heartbeat { 0%,55%,100% { transform: scale(.96); } 64% { transform: scale(1.08); } 72% { transform: scale(1); } 80% { transform: scale(1.05); } }
  @keyframes pendulum { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
  @keyframes bloom { 0%,100% { transform: scale(.91) rotate(-2deg); } 50% { transform: scale(1.07) rotate(2deg); } }
  @keyframes comet { 0% { transform: rotate(0) scale(.9); opacity: .4; } 45% { opacity: 1; } 100% { transform: rotate(360deg) scale(1.08); opacity: .4; } }
  @keyframes drift { 0%,100% { transform: translate(-2px,2px) rotate(-2deg); } 50% { transform: translate(3px,-3px) rotate(3deg); } }
  @keyframes halo-pulse { 0%,100% { transform: scale(.9); opacity: .18; } 50% { transform: scale(1.08); opacity: .7; } }
  @keyframes prism-step { 0%,100% { transform: translateX(-1px) skewX(-1deg); } 34% { transform: translateX(2px) skewX(2deg); } 67% { transform: translateY(-3px); } }
  @keyframes wave { 0%,100% { transform: rotate(-3deg) scaleY(.96); } 50% { transform: rotate(3deg) scaleY(1.04); } }
  @keyframes reveal { 0%,100% { transform: scale(.95); filter: brightness(.94); } 50% { transform: scale(1.04); filter: brightness(1.18); } }
  @keyframes spark { 0%,100% { transform: scale(.65); opacity: .55; } 50% { transform: scale(1.25); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
