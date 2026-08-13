<script lang="ts">
  import {
    APP_SCALES,
    TEXT_SCALE_MAX,
    TEXT_SCALE_MIN,
    TEXT_SCALE_STEP,
    type AppScale,
    type AppTheme,
    type TextScale,
  } from '../../lib/domain/appearance';
  import type { AppearanceSnapshot } from '../../lib/states/AppearanceGState';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';
  import MediaSettingsCard from './MediaSettingsCard.svelte';

  type Props = {
    media: Readonly<MediaSettingsSnapshot>;
    onMediaReset: () => void;
    onMicrophone: (deviceId: string) => void;
    onMicrophoneVolume: (volume: number) => void;
    onReset: () => void;
    onScale: (scale: AppScale) => void;
    onSpeaker: (deviceId: string) => void;
    onSpeakerVolume: (volume: number) => void;
    onTextScale: (scale: TextScale) => void;
    onTheme: (theme: AppTheme) => void;
    snapshot: Readonly<AppearanceSnapshot>;
  };

  let {
    media, onMediaReset, onMicrophone, onMicrophoneVolume, onReset, onScale,
    onSpeaker, onSpeakerVolume, onTextScale, onTheme, snapshot,
  }: Props = $props();
</script>

<main class="settings-shell" aria-labelledby="settings-title">
  <div class="settings-layout">
    <header class="settings-heading">
      <div>
        <span class="eyebrow">Application settings</span>
        <h1 id="settings-title">Agordoj</h1>
        <p>Make Kaordo comfortable for your display and workspace.</p>
      </div>
      <button class="reset-button" type="button" onclick={onReset}>Reset appearance</button>
    </header>

    <section class="settings-card" aria-labelledby="theme-title">
      <header class="card-heading">
        <span class="setting-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5v13M10 3.5a6.5 6.5 0 0 1 0 13" /></svg>
        </span>
        <div><h2 id="theme-title">Theme</h2><p>Choose the global color appearance for every section.</p></div>
      </header>

      <div class="theme-options" role="radiogroup" aria-label="Application theme">
        <button
          class="theme-option theme-option--light"
          class:theme-option--selected={snapshot.theme === 'light'}
          type="button"
          role="radio"
          aria-checked={snapshot.theme === 'light'}
          onclick={() => onTheme('light')}
        >
          <span class="theme-preview" aria-hidden="true"><i></i><b></b><em></em></span>
          <span class="option-copy"><strong>Light</strong><small>Clean and airy</small></span>
          <span class="selection-mark" aria-hidden="true">✓</span>
        </button>
        <button
          class="theme-option theme-option--dark"
          class:theme-option--selected={snapshot.theme === 'dark'}
          type="button"
          role="radio"
          aria-checked={snapshot.theme === 'dark'}
          onclick={() => onTheme('dark')}
        >
          <span class="theme-preview" aria-hidden="true"><i></i><b></b><em></em></span>
          <span class="option-copy"><strong>Dark</strong><small>Focused and calm</small></span>
          <span class="selection-mark" aria-hidden="true">✓</span>
        </button>
      </div>
    </section>

    <section class="settings-card" aria-labelledby="scale-title">
      <header class="card-heading">
        <span class="setting-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="M4 7V4h3M13 4h3v3M16 13v3h-3M7 16H4v-3" /><path d="m6.5 13.5 7-7M9 6.5h4.5V11" /></svg>
        </span>
        <div><h2 id="scale-title">Display</h2><p>Tune text clarity and the size of the entire interface independently.</p></div>
        <output aria-label="Current interface scale">{Math.round(snapshot.scale * 100)}%</output>
      </header>

      <div class="scale-control">
        <div class="control-label">
          <label for="text-scale">Text size</label>
          <output for="text-scale" aria-label="Current text size">{Math.round(snapshot.textScale * 100)}%</output>
        </div>
        <div class="scale-preview">
          <span class="preview-small" aria-hidden="true">A</span>
          <input
            id="text-scale"
            type="range"
            min={TEXT_SCALE_MIN * 100}
            max={TEXT_SCALE_MAX * 100}
            step={TEXT_SCALE_STEP * 100}
            value={snapshot.textScale * 100}
            aria-valuetext={`${Math.round(snapshot.textScale * 100)} percent`}
            oninput={(event) => onTextScale(Number(event.currentTarget.value) / 100)}
          />
          <span class="preview-large">A</span>
        </div>
        <div class="control-label application-scale-label">
          <span>Application scale</span>
        </div>
        <div class="scale-options" role="radiogroup" aria-label="Interface scale">
          {#each APP_SCALES as scale}
            <button
              class:scale-option--selected={snapshot.scale === scale}
              type="button"
              role="radio"
              aria-checked={snapshot.scale === scale}
              aria-label={`${Math.round(scale * 100)} percent`}
              onclick={() => onScale(scale)}
            >{Math.round(scale * 100)}%</button>
          {/each}
        </div>
        <p><span aria-hidden="true">i</span> Application scale is independent from the zoom level inside each knowledge canvas.</p>
      </div>
    </section>

    <MediaSettingsCard
      onMicrophone={onMicrophone}
      onMicrophoneVolume={onMicrophoneVolume}
      onReset={onMediaReset}
      onSpeaker={onSpeaker}
      onSpeakerVolume={onSpeakerVolume}
      snapshot={media}
    />

    {#if snapshot.error}<p class="settings-error" role="alert">{snapshot.error}</p>{/if}
  </div>
</main>

<style>
  .settings-shell { min-width: 0; min-height: 0; overflow: auto; color: #2b3731; background: radial-gradient(circle at 72% 4%, rgb(76 143 121 / 9%), transparent 30%), #f4f6f2; }
  .settings-layout { width: min(100%, 860px); margin: 0 auto; padding: 32px 34px 64px; }
  .settings-heading { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 23px; padding: 0 2px; }
  .eyebrow { color: #568575; font-size: calc(9px * var(--text-scale)); font-weight: 730; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin-top: 6px; color: #223029; font-size: calc(28px * var(--text-scale)); font-weight: 690; letter-spacing: -.04em; }
  .settings-heading p { margin-top: 7px; color: #748078; font-size: calc(11px * var(--text-scale)); }
  .reset-button { height: 29px; padding: 0 10px; color: #607068; background: rgb(255 255 255 / 68%); border: 1px solid #d5ddd7; border-radius: 8px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 620; }
  .reset-button:hover { color: #315d4e; background: #fff; border-color: #b9ccc3; }
  .settings-card { padding: 20px; background: rgb(255 255 255 / 84%); border: 1px solid #dce1dc; border-radius: 15px; box-shadow: 0 12px 30px rgb(38 66 54 / 6%); }
  .settings-card + .settings-card { margin-top: 13px; }
  .card-heading { display: grid; grid-template-columns: 35px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding-bottom: 16px; border-bottom: 1px solid #e6eae7; }
  .setting-icon { display: grid; width: 35px; height: 35px; color: #4d8271; background: #e8f0eb; border: 1px solid #d6e2dc; border-radius: 10px; place-items: center; }
  .setting-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .card-heading h2 { color: #2a3831; font-size: calc(12px * var(--text-scale)); font-weight: 680; }
  .card-heading p { margin-top: 3px; color: #879089; font-size: calc(9px * var(--text-scale)); }
  .card-heading output { color: #3e7664; font-size: calc(16px * var(--text-scale)); font-weight: 710; font-variant-numeric: tabular-nums; }
  .theme-options { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; padding-top: 16px; }
  .theme-option { display: grid; grid-template-columns: 86px minmax(0, 1fr) 20px; align-items: center; gap: 13px; min-height: 91px; padding: 11px; color: #4c5851; background: #fafbf9; border: 1px solid #dfe4e0; border-radius: 12px; cursor: pointer; text-align: left; transition: border-color 130ms ease, box-shadow 130ms ease, transform 130ms ease; }
  .theme-option:hover { border-color: #bdcec5; transform: translateY(-1px); }
  .theme-option--selected { border-color: #67a08d; box-shadow: 0 0 0 2px rgb(79 146 123 / 12%); }
  .theme-preview { position: relative; display: block; width: 86px; height: 65px; overflow: hidden; background: #eef1ed; border: 1px solid #d2d8d3; border-radius: 8px; }
  .theme-preview i { position: absolute; inset: 0 0 auto; height: 14px; background: #25332e; }
  .theme-preview b { position: absolute; top: 20px; bottom: 6px; left: 6px; width: 20px; background: #e0e5e0; border-radius: 4px; }
  .theme-preview em { position: absolute; top: 20px; right: 6px; bottom: 6px; left: 31px; background: #fff; border: 1px solid #e0e4e0; border-radius: 4px; }
  .theme-option--dark .theme-preview { background: #171d1a; border-color: #3b4741; }
  .theme-option--dark .theme-preview i { background: #0e1512; }
  .theme-option--dark .theme-preview b { background: #222b26; }
  .theme-option--dark .theme-preview em { background: #29332d; border-color: #3c4942; }
  .option-copy strong, .option-copy small { display: block; }
  .option-copy strong { color: #2d3a34; font-size: calc(11px * var(--text-scale)); }
  .option-copy small { margin-top: 4px; color: #8b948e; font-size: calc(8px * var(--text-scale)); }
  .selection-mark { display: grid; width: 18px; height: 18px; color: transparent; background: #edf0ed; border: 1px solid #d8ded9; border-radius: 50%; font-size: calc(9px * var(--text-scale)); place-items: center; }
  .theme-option--selected .selection-mark { color: #fff; background: #4e8e79; border-color: #4e8e79; }
  .scale-control { padding-top: 17px; }
  .control-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #59675f; font-size: calc(9px * var(--text-scale)); font-weight: 660; }
  .control-label output { color: #3e7664; font-size: calc(10px * var(--text-scale)); font-weight: 710; font-variant-numeric: tabular-nums; }
  .scale-preview { display: flex; align-items: center; gap: 10px; color: #87918b; }
  .preview-small { font-size: calc(9px * var(--text-scale)); } .preview-large { color: #557a6c; font-size: calc(18px * var(--text-scale)); font-weight: 700; }
  .scale-preview input { width: 100%; height: 18px; margin: 0; cursor: pointer; accent-color: #4d8c77; }
  .scale-preview input::-webkit-slider-runnable-track { height: 4px; background: linear-gradient(90deg, #9bb9ad, #4d8c77); border-radius: 999px; }
  .scale-preview input::-webkit-slider-thumb { width: 15px; height: 15px; margin-top: -5.5px; background: #fff; border: 2px solid #4d8c77; border-radius: 50%; box-shadow: 0 2px 6px rgb(36 69 57 / 20%); appearance: none; }
  .scale-preview input:focus-visible { outline: 2px solid rgb(55 117 102 / 44%); outline-offset: 3px; border-radius: 999px; }
  .application-scale-label { margin-top: 17px; margin-bottom: 0; }
  .scale-options { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 14px; padding: 5px; background: #f1f4f1; border: 1px solid #e0e5e1; border-radius: 10px; }
  .scale-options button { height: 34px; color: #6c7871; background: transparent; border: 0; border-radius: 7px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 650; font-variant-numeric: tabular-nums; }
  .scale-options button:hover { color: #315d4e; background: rgb(255 255 255 / 66%); }
  .scale-options .scale-option--selected { color: #285e4d; background: #fff; box-shadow: 0 2px 7px rgb(39 65 54 / 9%); }
  .scale-control > p { display: flex; align-items: center; gap: 7px; margin-top: 13px; color: #869089; font-size: calc(8px * var(--text-scale)); }
  .scale-control > p span { display: grid; width: 14px; height: 14px; color: #648376; background: #e9f0ec; border-radius: 50%; place-items: center; }
  .settings-error { margin-top: 12px; padding: 9px 11px; color: #944b45; background: #fbefed; border: 1px solid #ebd1ce; border-radius: 8px; font-size: calc(9px * var(--text-scale)); }
  button:focus-visible { outline: 2px solid rgb(55 117 102 / 44%); outline-offset: 2px; }
  @media (max-width: 760px) { .theme-options { grid-template-columns: 1fr; } }
</style>
