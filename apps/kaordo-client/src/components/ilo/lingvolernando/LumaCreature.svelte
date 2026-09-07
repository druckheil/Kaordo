<script lang="ts">
  import type { LingvolernandoPetMood, LingvolernandoPetPalette } from '../../../lib/domain/lingvolernando';

  export type LingvolernandoPetReaction = 'celebrate' | 'forgot' | 'new-word' | 'remember';

  type Props = {
    action?: LingvolernandoPetReaction | null;
    gazeX?: number;
    gazeY?: number;
    mood: LingvolernandoPetMood;
    palette?: LingvolernandoPetPalette;
    size?: number;
  };

  let { action = null, gazeX = 0, gazeY = 0, mood, palette = 'moon', size = 210 }: Props = $props();
</script>

<span
  class="luma mood-{mood} palette-{palette} action-{action ?? 'idle'}"
  style={`--luma-size:${size}px;--gaze-x:${gazeX}px;--gaze-y:${gazeY}px`}
  aria-hidden="true"
>
  <svg viewBox="0 0 240 240">
    <defs>
      <linearGradient id="luma-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--luma-light)"/><stop offset=".48" stop-color="var(--luma-mid)"/><stop offset="1" stop-color="var(--luma-deep)"/>
      </linearGradient>
      <radialGradient id="luma-glow"><stop offset="0" stop-color="var(--luma-accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--luma-accent)" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="aura" cx="120" cy="126" rx="105" ry="100" />
    <g class="stars"><circle cx="29" cy="69" r="4"/><circle cx="207" cy="84" r="3"/><circle cx="191" cy="30" r="2.5"/><path d="m42 32 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></g>
    <g class="tail"><path d="M166 173c40 7 45 34 22 44 31-1 47-22 37-42-8-17-30-25-55-19Z"/><path class="tail-line" d="M181 164c24 5 37 19 33 36"/></g>
    <g class="body">
      <path class="ear left-ear" d="M75 76C48 52 51 21 76 9c19 17 28 37 23 58Z"/>
      <path class="ear right-ear" d="M143 66c-3-24 8-47 29-57 23 17 22 48-3 69Z"/>
      <path class="ear-inner left-ear" d="M69 52c-4-13-1-24 7-31 9 11 14 23 14 35Z"/>
      <path class="ear-inner right-ear" d="M154 55c2-14 8-25 17-33 6 10 7 22 2 33Z"/>
      <path class="torso" d="M74 147c4-36 30-53 54-53s51 17 56 53c4 31-16 68-56 72-40-4-58-41-54-72Z"/>
      <path class="head" d="M63 91c8-31 32-47 66-47 37 0 62 20 65 53 3 37-23 67-67 67-45 0-73-33-64-73Z"/>
      <path class="cheek" d="M72 123c10 13 20 17 31 17M182 122c-10 13-20 17-31 17"/>
      <g class="face">
        <g class="eyes">
          <ellipse class="eye" cx="99" cy="100" rx="13" ry="16"/><ellipse class="eye" cx="157" cy="100" rx="13" ry="16"/>
          <g class="pupils" style={`transform:translate(${gazeX}px,${gazeY}px)`}><ellipse cx="100" cy="103" rx="5" ry="8"/><ellipse cx="156" cy="103" rx="5" ry="8"/></g>
          <g class="eye-light"><circle cx="102" cy="98" r="2"/><circle cx="158" cy="98" r="2"/></g>
        </g>
        <path class="nose" d="m123 119 5 4 5-4"/>
        <path class="mouth" d="M128 124c0 7-5 10-11 7M128 124c0 7 5 10 11 7"/>
      </g>
      <path class="chest" d="M99 158c9 5 18 5 29-2 11 7 21 7 30 2-2 24-11 39-30 47-18-8-27-23-29-47Z"/>
      <g class="paws"><path d="M85 180c-13 9-15 25-7 34 12 7 23 2 29-11Z"/><path d="M171 180c13 9 15 25 7 34-12 7-23 2-29-11Z"/></g>
    </g>
    <g class="focus-runes"><circle cx="120" cy="120" r="91"/><path d="M120 18v12M120 210v12M18 120h12M210 120h12"/></g>
    <g class="dreams"><path d="M184 57c8-8 17-6 18 1 1 6-6 10-15 10 10-11 20-14 27-8"/><circle cx="211" cy="44" r="5"/><circle cx="220" cy="28" r="3"/></g>
  </svg>
</span>

<style>
  .luma { --luma-light:#f9fbff;--luma-mid:#dfe8fa;--luma-deep:#c8d2ed;--luma-accent:#7b70ee;display:inline-grid; width:var(--luma-size); height:var(--luma-size); place-items:center; contain:layout paint; }
  .palette-aurora{--luma-light:#f7fffc;--luma-mid:#d1eee7;--luma-deep:#addbd2;--luma-accent:#35a98c}.palette-ember{--luma-light:#fffaf5;--luma-mid:#f3dacd;--luma-deep:#dfb7a4;--luma-accent:#ca6e57}.palette-moss{--luma-light:#fbfff5;--luma-mid:#dfebd1;--luma-deep:#bfd0ab;--luma-accent:#71966b}
  svg { width:100%; height:100%; overflow:visible; }
  .aura { fill:url(#luma-glow); opacity:.5; animation:aura 3.8s ease-in-out infinite; transform-origin:120px 126px; }
  .stars { fill:var(--luma-accent); opacity:.5; animation:stars 5.4s ease-in-out infinite; }
  .body { transform-origin:128px 158px; animation:idle 3.6s ease-in-out infinite; }
  .head,.torso,.ear,.paws path { fill:url(#luma-body); stroke:#64708d; stroke-width:3; stroke-linejoin:round; }
  .ear-inner { fill:#c58ab5; opacity:.55; }
  .torso { filter:drop-shadow(0 8px 7px rgb(56 67 91 / 18%)); }
  .cheek { fill:none; stroke:#d386aa; stroke-width:4; stroke-linecap:round; opacity:.55; }
  .eye { fill:#f9fbff; stroke:#5d6880; stroke-width:2.4; }
  .pupils { fill:#5b54dd; transition:transform 90ms linear; }
  .eye-light { fill:white; }
  .nose,.mouth { fill:none; stroke:#59647b; stroke-width:2.7; stroke-linecap:round; }
  .chest { fill:#f5f8ff; stroke:#b9c4dc; stroke-width:2; }
  .tail { transform-origin:166px 173px; animation:tail 2.9s ease-in-out infinite; }
  .tail path:first-child { fill:url(#luma-body); stroke:#64708d; stroke-width:3; }
  .tail-line { fill:none; stroke:#8e9ab6; stroke-width:2; }
  .focus-runes { fill:none; stroke:#7268e7; stroke-width:2; stroke-dasharray:6 12; opacity:0; transform-origin:120px; }
  .dreams { fill:none; stroke:#7d72e9; stroke-width:3; stroke-linecap:round; opacity:0; }
  .mood-glowing .aura { opacity:1; animation-duration:1.7s; }
  .mood-focused .focus-runes { opacity:.65; animation:orbit 7s linear infinite; }
  .mood-dreaming .dreams,.mood-resting .dreams { opacity:.75; animation:dream 3s ease-in-out infinite; }
  .mood-curious .left-ear { animation:ear-left 2.7s ease-in-out infinite; transform-origin:84px 69px; }
  .mood-curious .right-ear { animation:ear-right 3.1s ease-in-out infinite; transform-origin:157px 70px; }
  .action-celebrate .body { animation:play .8s cubic-bezier(.2,.8,.3,1) 2; }
  .action-remember .focus-runes { opacity:.9; animation:focus 1.25s ease-out 1; }
  .action-forgot .body { animation:nuzzle 1.25s ease-in-out 1; }
  .action-new-word .body { animation:explore 1.4s ease-in-out 1; }
  @keyframes idle { 0%,100%{transform:translateY(1px) rotate(-.6deg)}50%{transform:translateY(-4px) rotate(.7deg)} }
  @keyframes tail { 0%,100%{transform:rotate(-8deg)}50%{transform:rotate(13deg)} }
  @keyframes aura { 0%,100%{transform:scale(.88);opacity:.25}50%{transform:scale(1.05);opacity:.65} }
  @keyframes stars { 0%,100%{transform:translateY(3px);opacity:.3}50%{transform:translateY(-5px);opacity:.75} }
  @keyframes orbit { to{transform:rotate(360deg)} }
  @keyframes dream { 0%,100%{transform:translate(0,2px);opacity:.35}50%{transform:translate(4px,-5px);opacity:.9} }
  @keyframes ear-left { 0%,76%,100%{transform:rotate(0)}82%{transform:rotate(-9deg)}88%{transform:rotate(4deg)} }
  @keyframes ear-right { 0%,70%,100%{transform:rotate(0)}78%{transform:rotate(10deg)}86%{transform:rotate(-3deg)} }
  @keyframes play { 0%{transform:translateY(0) scale(1)}35%{transform:translateY(-18px) rotate(-5deg) scale(1.03)}70%{transform:translateY(0) rotate(4deg)}100%{transform:none} }
  @keyframes nuzzle { 0%{transform:none}35%{transform:translateX(-13px) rotate(-6deg)}70%{transform:translateX(8px) rotate(4deg)}100%{transform:none} }
  @keyframes focus { 0%{transform:scale(.6) rotate(-30deg);opacity:0}55%{transform:scale(1.1) rotate(8deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:.65} }
  @keyframes explore { 0%{transform:none}30%{transform:translateX(-11px) rotate(-4deg)}60%{transform:translateX(13px) rotate(5deg)}100%{transform:none} }
  @keyframes rest { 0%{transform:none}45%{transform:translateY(14px) scaleY(.9)}100%{transform:none} }
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
