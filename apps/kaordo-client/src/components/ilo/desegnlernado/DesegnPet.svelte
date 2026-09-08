<script lang="ts">
  import type { DesegnPetProfile } from '../../../lib/domain/desegnLernado';
  import type { DesegnArtifact } from '../../../lib/services/desegnLernadoProgress';

  type Props = {
    artifacts?: readonly DesegnArtifact[];
    compact?: boolean;
    pet: Readonly<DesegnPetProfile>;
  };

  let { artifacts = [], compact = false, pet }: Props = $props();
  const instanceId = $props.id();
</script>

<div class:compact class="pet-stage" data-palette={pet.palette} aria-label={`${pet.name}, your drawing companion`}>
  <div class="paper-halo" aria-hidden="true"><i></i><i></i><i></i></div>
  <svg class="pet" viewBox="0 0 260 250" role="img" aria-label={`${pet.name}, an animated ink companion`}>
    <defs>
      <linearGradient id={`${instanceId}-body`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--pet-light)" />
        <stop offset="1" stop-color="var(--pet-main)" />
      </linearGradient>
      <filter id={`${instanceId}-shadow`} x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="var(--pet-shadow)" flood-opacity=".26" />
      </filter>
    </defs>
    <g class="tail" filter={`url(#${instanceId}-shadow)`}>
      <path d="M178 168c42-10 55 10 34 31-13 13-9 27 16 25" />
      <path class="brush" d="m225 214 21 13-24 7z" />
    </g>
    <g class="body" filter={`url(#${instanceId}-shadow)`}>
      <path d="M71 101c-5-32 12-63 35-75 10 13 15 28 15 43 14-5 29-5 43 0 2-17 9-32 21-43 22 17 34 48 25 78 17 18 25 42 20 67-7 37-43 61-93 58-48-3-81-29-83-66-1-23 5-43 17-62z" fill={`url(#${instanceId}-body)`} />
      <path class="ear" d="M88 77c-1-17 5-32 15-41 7 12 10 26 9 39M174 76c2-17 7-30 12-38 8 12 12 27 10 43" />
      <path class="belly" d="M91 171c9 30 30 43 52 43s42-14 49-43c-28 17-73 17-101 0z" />
      <g class="face">
        <ellipse cx="111" cy="125" rx="13" ry="17" />
        <ellipse cx="169" cy="125" rx="13" ry="17" />
        <g class="pupils"><circle cx="114" cy="127" r="5"/><circle cx="166" cy="127" r="5"/></g>
        <path d="m134 148 7 4 7-4M141 152v7m0 0c-6 8-15 6-19 1m19-1c6 8 15 6 19 1" />
        <path class="blush" d="M84 151c8 5 15 6 22 3M176 154c7 3 15 2 22-3" />
      </g>
      <g class="paws"><path d="M91 187c9-6 18-5 25 2M166 189c7-7 16-8 25-2" /></g>
    </g>
    <g class="pencil" filter={`url(#${instanceId}-shadow)`}>
      <path d="m43 202 80-48 12 19-80 48z" />
      <path class="pencil-tip" d="m43 202-14 20 26-1z" />
      <path class="pencil-band" d="m111 161 12-7 12 19-12 7z" />
    </g>
  </svg>
  {#each artifacts.slice(0, 3) as artifact, index (artifact.id)}
    <span
      class="orbit-artifact"
      style={`--artifact:${artifact.accent};--slot:${index}`}
      title={artifact.name}
      aria-label={`Equipped: ${artifact.name}`}
    >{artifact.glyph}</span>
  {/each}
  {#if !compact}
    <span class="pet-name">{pet.name}<small>studio companion</small></span>
  {/if}
</div>

<style>
  .pet-stage {
    --pet-main: #6d69d9;
    --pet-light: #b9b4f2;
    --pet-shadow: #4b476f;
    --pet-accent: #4db39a;
    position: relative;
    display: grid;
    width: min(100%, 390px);
    aspect-ratio: 1.08;
    place-items: center;
    isolation: isolate;
  }

  .pet-stage[data-palette='mint'] { --pet-main: #48a990; --pet-light: #b3e4d6; --pet-shadow: #326f64; --pet-accent: #6d69d9; }
  .pet-stage[data-palette='sunset'] { --pet-main: #e27b82; --pet-light: #f4c2aa; --pet-shadow: #8e4c59; --pet-accent: #f1b44f; }
  .pet-stage[data-palette='night'] { --pet-main: #48516f; --pet-light: #8792bc; --pet-shadow: #1f263c; --pet-accent: #9a8df0; }

  .paper-halo { position: absolute; z-index: -1; width: 76%; aspect-ratio: 1; background: var(--sui-bg); border-radius: 45% 55% 48% 52%; box-shadow: var(--sui-shadow-inset); animation: halo-morph 9s ease-in-out infinite alternate; }
  .paper-halo i { position: absolute; width: 8px; height: 8px; background: var(--pet-accent); border-radius: 50%; opacity: .5; }
  .paper-halo i:nth-child(1) { top: 18%; left: 8%; animation: mote 3.2s ease-in-out infinite; }
  .paper-halo i:nth-child(2) { top: 11%; right: 16%; width: 5px; height: 5px; animation: mote 2.7s .4s ease-in-out infinite; }
  .paper-halo i:nth-child(3) { right: 8%; bottom: 25%; width: 11px; height: 11px; animation: mote 3.8s .8s ease-in-out infinite; }
  .pet { width: 78%; overflow: visible; animation: breathe 3.4s ease-in-out infinite; }
  .body { transform-origin: 140px 170px; }
  .ear, .face path, .paws path { fill: none; stroke: var(--pet-shadow); stroke-linecap: round; stroke-linejoin: round; stroke-width: 7; }
  .belly { fill: color-mix(in srgb, var(--pet-light) 58%, white 42%); opacity: .8; }
  .face ellipse { fill: color-mix(in srgb, var(--sui-bg-light) 82%, white 18%); stroke: var(--pet-shadow); stroke-width: 6; }
  .pupils { fill: var(--pet-shadow); transform-origin: center; animation: blink 5.2s ease-in-out infinite; }
  .blush { stroke: #e8839c !important; opacity: .7; }
  .tail { fill: none; stroke: var(--pet-main); stroke-linecap: round; stroke-width: 19; transform-origin: 178px 168px; animation: tail-wag 2.9s ease-in-out infinite; }
  .tail .brush { fill: var(--pet-shadow); stroke: var(--pet-shadow); stroke-width: 3; }
  .pencil { transform-origin: 120px 172px; animation: pencil-tap 3.8s ease-in-out infinite; }
  .pencil path:first-child { fill: #f2bd50; stroke: #b27c2f; stroke-width: 3; }
  .pencil-tip { fill: #efd9b8; stroke: #765849; stroke-width: 3; }
  .pencil-band { fill: var(--pet-accent); stroke: color-mix(in srgb, var(--pet-accent) 70%, #25314b); stroke-width: 3; }
  .orbit-artifact { position: absolute; z-index: 3; display: grid; width: 39px; height: 39px; color: #fff; background: radial-gradient(circle at 35% 28%, white, var(--artifact) 32%, color-mix(in srgb, var(--artifact) 70%, #2c2d51)); border: 3px solid color-mix(in srgb, var(--artifact) 30%, var(--sui-bg-light)); border-radius: 50%; box-shadow: 0 8px 18px color-mix(in srgb, var(--artifact) 35%, transparent); font-size: 16px; place-items: center; animation: artifact-float 3.2s calc(var(--slot) * -.8s) ease-in-out infinite; }
  .orbit-artifact:nth-of-type(1) { top: 17%; right: 8%; }
  .orbit-artifact:nth-of-type(2) { bottom: 24%; left: 5%; }
  .orbit-artifact:nth-of-type(3) { right: 8%; bottom: 18%; }
  .pet-name { position: absolute; right: 16%; bottom: 2%; left: 16%; display: grid; padding: 11px 18px; color: var(--sui-text); background: color-mix(in srgb, var(--sui-bg) 88%, transparent); border-radius: 15px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(13px * var(--text-scale)); font-weight: 780; text-align: center; backdrop-filter: blur(8px); }
  .pet-name small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
  .compact { width: 100px; }
  .compact .orbit-artifact { width: 22px; height: 22px; border-width: 2px; font-size: 9px; }

  @keyframes breathe { 50% { transform: translateY(-5px) scale(1.012); } }
  @keyframes blink { 0%, 45%, 49%, 100% { transform: scaleY(1); } 47% { transform: scaleY(.08); } }
  @keyframes tail-wag { 50% { transform: rotate(7deg); } }
  @keyframes pencil-tap { 0%, 62%, 100% { transform: rotate(0); } 70% { transform: rotate(-5deg); } 78% { transform: rotate(2deg); } }
  @keyframes mote { 50% { opacity: 1; transform: translateY(-9px) scale(1.25); } }
  @keyframes halo-morph { to { border-radius: 54% 46% 56% 44%; transform: rotate(3deg); } }
  @keyframes artifact-float { 50% { transform: translateY(-8px) rotate(8deg); } }

  @media (prefers-reduced-motion: reduce) {
    .paper-halo, .paper-halo i, .pet, .tail, .pencil, .orbit-artifact, .pupils { animation: none; }
  }
</style>
