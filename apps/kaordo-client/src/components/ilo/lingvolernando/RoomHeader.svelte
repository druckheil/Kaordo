<script lang="ts">
  type Props = {
    eyebrow: string;
    onHome: () => void;
    summary: string;
    title: string;
  };
  let { eyebrow, onHome, summary, title }: Props = $props();
</script>

<header class="room-header">
  <button type="button" onclick={onHome} aria-label="Return to Lingvolernando home">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4-6 6 6 6"/></svg>
    Home
  </button>
  <div><span>{eyebrow}</span><h2>{title}</h2><p>{summary}</p></div>
</header>

<style>
  .room-header { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:start; gap:18px; padding:4px 3px 20px; }
  button { display:flex; align-items:center; gap:7px; min-height:40px; padding:0 14px; color:var(--sui-primary); font:inherit; font-size:calc(10px * var(--text-scale)); font-weight:760; background:var(--sui-bg); border:0; border-radius:13px; box-shadow:var(--sui-shadow-raised-sm); cursor:pointer; transition:transform 150ms ease,box-shadow 150ms ease; }
  button:hover { transform:translateY(-1px); box-shadow:var(--sui-shadow-raised); }
  button:active { transform:none; box-shadow:var(--sui-shadow-inset-sm); }
  svg { width:17px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
  span { display:block; margin:1px 0 5px; color:var(--sui-primary); font-size:calc(8px * var(--text-scale)); font-weight:820; letter-spacing:.16em; text-transform:uppercase; }
  h2 { margin:0; color:var(--sui-text); font-size:clamp(calc(25px * var(--text-scale)),2.7vw,calc(38px * var(--text-scale))); line-height:1; letter-spacing:-.045em; }
  p { max-width:680px; margin:8px 0 0; color:var(--sui-text-muted); font-size:calc(10px * var(--text-scale)); line-height:1.5; }
  @media(max-width:620px){.room-header{grid-template-columns:1fr;gap:13px}.room-header button{width:max-content}}
</style>
