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
  import type { AuthSession, AuthUser } from '../../lib/domain/auth';
  import type { PublicNodoStorage } from '../../lib/domain/nodo';
  import type { AppearanceSnapshot } from '../../lib/states/AppearanceGState';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';
  import AccountSettingsPanel from './AccountSettingsPanel.svelte';
  import MediaSettingsCard from './MediaSettingsCard.svelte';

  type Props = {
    accountBusy: boolean;
    accountError: string | null;
    busy: boolean;
    media: Readonly<MediaSettingsSnapshot>;
    onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
    onChangeUsername: (newUsername: string, currentPassword: string) => Promise<boolean>;
    onIssueSeed: () => Promise<string>;
    onListPublic: () => void | Promise<void>;
    onLogout: () => void | Promise<void>;
    onMediaReset: () => void;
    onMicrophone: (deviceId: string) => void;
    onMicrophoneVolume: (volume: number) => void;
    onReset: () => void;
    onScale: (scale: AppScale) => void;
    onSpeaker: (deviceId: string) => void;
    onSpeakerVolume: (volume: number) => void;
    onTerminateSession: (sessionId: string, current: boolean) => void | Promise<void>;
    onTextScale: (scale: TextScale) => void;
    onTheme: (theme: AppTheme) => void;
    platform: 'desktop' | 'web';
    publicStorage: PublicNodoStorage | null;
    publicStorageError: string | null;
    publicStorageLoading: boolean;
    rondoPublicStorage: { allocated: boolean; limitBytes: number; usedBytes: number } | null;
    rondoPublicStorageError: string | null;
    rondoPublicStorageLoading: boolean;
    sessions: AuthSession[];
    sessionsError: string | null;
    sessionsLoading: boolean;
    terminatingSessionId: string | null;
    snapshot: Readonly<AppearanceSnapshot>;
    user: AuthUser;
  };

  let {
    accountBusy,
    accountError,
    busy,
    media,
    onChangePassword,
    onChangeUsername,
    onIssueSeed,
    onListPublic,
    onLogout,
    onMediaReset,
    onMicrophone,
    onMicrophoneVolume,
    onReset,
    onScale,
    onSpeaker,
    onSpeakerVolume,
    onTerminateSession,
    onTextScale,
    onTheme,
    platform,
    publicStorage,
    publicStorageError,
    publicStorageLoading,
    rondoPublicStorage,
    rondoPublicStorageError,
    rondoPublicStorageLoading,
    sessions,
    sessionsError,
    sessionsLoading,
    terminatingSessionId,
    snapshot,
    user,
  }: Props = $props();

  function rangeProgress(value: number, min: number, max: number): number {
    return Math.min(100, Math.max(0, (value - min) / Math.max(1, max - min) * 100));
  }
</script>

<main class="settings-shell" aria-labelledby="settings-title">
  <div class="settings-layout">
    <header class="settings-heading">
      <div>
        <span class="eyebrow">Preferences &amp; privacy</span>
        <h1 id="settings-title">Agordoj</h1>
        <p>Shape the Kaordo experience and keep your private controls in one place.</p>
      </div>
      <div class="settings-heading-actions">
        <span class="settings-state"><i aria-hidden="true"></i> Saved locally</span>
        <button class="reset-button" type="button" onclick={onReset}>Reset appearance</button>
      </div>
    </header>

    <AccountSettingsPanel
      {accountBusy}
      error={accountError}
      {busy}
      onChangePassword={onChangePassword}
      onChangeUsername={onChangeUsername}
      onIssueSeed={onIssueSeed}
      onListPublic={onListPublic}
      onLogout={onLogout}
      {platform}
      {publicStorage}
      {publicStorageError}
      {publicStorageLoading}
      {rondoPublicStorage}
      {rondoPublicStorageError}
      {rondoPublicStorageLoading}
      {sessions}
      {sessionsError}
      {sessionsLoading}
      {terminatingSessionId}
      onTerminateSession={onTerminateSession}
      {user}
    />

    <section class="settings-card" aria-labelledby="theme-title">
      <header class="card-heading">
        <span class="setting-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5v13M10 3.5a6.5 6.5 0 0 1 0 13" /></svg>
        </span>
        <div><h2 id="theme-title">Theme</h2><p>Choose the global color appearance for every section.</p></div>
      </header>

      <div class="theme-options" role="radiogroup" aria-label="Application theme">
        <button class="theme-option theme-option--light" class:theme-option--selected={snapshot.theme === 'light'} type="button" role="radio" aria-checked={snapshot.theme === 'light'} onclick={() => onTheme('light')}>
          <span class="theme-preview" aria-hidden="true"><i></i><b></b><em></em></span>
          <span class="option-copy"><strong>Light</strong><small>Clean and airy</small></span>
          <span class="selection-mark" aria-hidden="true">✓</span>
        </button>
        <button class="theme-option theme-option--dark" class:theme-option--selected={snapshot.theme === 'dark'} type="button" role="radio" aria-checked={snapshot.theme === 'dark'} onclick={() => onTheme('dark')}>
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
        <div class="control-label"><label for="text-scale">Text size</label><output for="text-scale" aria-label="Current text size">{Math.round(snapshot.textScale * 100)}%</output></div>
        <div class="scale-preview">
          <span class="preview-small" aria-hidden="true">A</span>
          <input
            id="text-scale"
            class="sui-range"
            style={`--range-progress:${rangeProgress(snapshot.textScale * 100, TEXT_SCALE_MIN * 100, TEXT_SCALE_MAX * 100)}%`}
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
        <div class="control-label application-scale-label"><span>Application scale</span></div>
        <div class="scale-options" role="radiogroup" aria-label="Interface scale">
          {#each APP_SCALES as scale}
            <button class:scale-option--selected={snapshot.scale === scale} type="button" role="radio" aria-checked={snapshot.scale === scale} aria-label={`${Math.round(scale * 100)} percent`} onclick={() => onScale(scale)}>{Math.round(scale * 100)}%</button>
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
  .settings-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-color: rgb(39 51 67 / 20%);
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #c95667;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-shadow-raised: 0 9px 22px var(--sui-shadow-color), -5px -5px 14px rgb(255 255 255 / 56%);
    --sui-shadow-raised-sm: 0 4px 10px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 50%);
    --sui-shadow-raised-lg: 0 15px 34px rgb(39 51 67 / 22%), -6px -6px 16px rgb(255 255 255 / 48%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: var(--sui-text);
    background: radial-gradient(circle at 76% 2%, rgb(91 84 224 / 8%), transparent 33%), var(--sui-bg);
  }

  :global(html[data-theme='dark']) .settings-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-color: rgb(0 0 0 / 42%);
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-shadow-raised: 0 11px 25px rgb(0 0 0 / 42%);
    --sui-shadow-raised-sm: 0 5px 12px rgb(0 0 0 / 36%);
    --sui-shadow-raised-lg: 0 18px 40px rgb(0 0 0 / 45%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  .settings-layout { width: min(100%, 960px); margin: 0 auto; padding: 24px 30px 54px; }
  .settings-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 17px; padding: 0 2px; }
  .eyebrow { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  .settings-heading h1 { margin-top: 4px; color: var(--sui-text); font-size: calc(27px * var(--text-scale)); font-weight: 740; letter-spacing: -.045em; }
  .settings-heading p { margin-top: 5px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }
  .settings-heading-actions { display: flex; align-items: center; gap: 12px; }
  .settings-state { display: inline-flex; align-items: center; gap: 7px; color: var(--sui-success); font-size: calc(8px * var(--text-scale)); font-weight: 720; white-space: nowrap; }
  .settings-state i { width: 7px; height: 7px; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-success) 14%, transparent); }
  .reset-button { min-height: 35px; padding: 0 12px; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font: inherit; font-size: calc(8px * var(--text-scale)); font-weight: 700; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .reset-button:hover { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .reset-button:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }

  .settings-card { margin-top: 14px; padding: 19px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 17px; box-shadow: var(--sui-shadow-raised); }
  .card-heading { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding-bottom: 14px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .setting-icon { display: grid; width: 36px; height: 36px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .setting-icon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .card-heading h2 { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); font-weight: 710; }
  .card-heading p { margin-top: 3px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .card-heading output { color: var(--sui-primary); font-size: calc(15px * var(--text-scale)); font-weight: 730; font-variant-numeric: tabular-nums; }
  .theme-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 15px; }
  .theme-option { display: grid; grid-template-columns: 86px minmax(0, 1fr) 20px; align-items: center; gap: 13px; min-height: 91px; padding: 11px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; text-align: left; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .theme-option:hover { color: var(--sui-text); transform: translateY(-1px); }
  .theme-option--selected { color: var(--sui-primary); box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--sui-primary) 22%, transparent); }
  .theme-preview { position: relative; display: block; width: 86px; height: 65px; overflow: hidden; background: var(--sui-bg-light); border-radius: 8px; box-shadow: var(--sui-shadow-inset-sm); }
  .theme-preview i { position: absolute; inset: 0 0 auto; height: 14px; background: #2d3748; }
  .theme-preview b { position: absolute; top: 20px; bottom: 6px; left: 6px; width: 20px; background: color-mix(in srgb, var(--sui-text-light) 20%, var(--sui-bg)); border-radius: 4px; }
  .theme-preview em { position: absolute; top: 20px; right: 6px; bottom: 6px; left: 31px; background: var(--sui-bg); border-radius: 4px; }
  .theme-option--dark .theme-preview { background: #20242d; }
  .theme-option--dark .theme-preview i { background: #11141b; }
  .theme-option--dark .theme-preview b { background: #31343c; }
  .theme-option--dark .theme-preview em { background: #2a2d35; }
  .option-copy strong, .option-copy small { display: block; }
  .option-copy strong { color: var(--sui-text); font-size: calc(10px * var(--text-scale)); }
  .option-copy small { margin-top: 4px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .selection-mark { display: grid; width: 19px; height: 19px; color: transparent; background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); place-items: center; }
  .theme-option--selected .selection-mark { color: #fff; background: var(--sui-primary); box-shadow: none; }
  .scale-control { padding-top: 16px; }
  .control-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .control-label output { color: var(--sui-primary); font-size: calc(9px * var(--text-scale)); font-weight: 720; font-variant-numeric: tabular-nums; }
  .scale-preview { display: flex; align-items: center; gap: 10px; color: var(--sui-text-light); }
  .preview-small { font-size: calc(9px * var(--text-scale)); } .preview-large { color: var(--sui-primary); font-size: calc(18px * var(--text-scale)); font-weight: 700; }
  .scale-preview input {
    width: 100%;
    height: 20px;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .scale-preview input::-webkit-slider-runnable-track {
    height: 6px;
    background: linear-gradient(90deg, var(--sui-primary) 0 var(--range-progress), var(--sui-bg-dark) var(--range-progress) 100%);
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
  }
  .scale-preview input::-webkit-slider-thumb {
    width: 17px;
    height: 17px;
    margin-top: -5.5px;
    appearance: none;
    background: var(--sui-bg-light);
    border: 2px solid var(--sui-primary);
    border-radius: 50%;
    box-shadow: var(--sui-shadow-raised-sm);
  }
  .scale-preview input::-moz-range-track { height: 6px; background: var(--sui-bg-dark); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .scale-preview input::-moz-range-progress { height: 6px; background: var(--sui-primary); border-radius: 999px; }
  .scale-preview input::-moz-range-thumb { width: 13px; height: 13px; background: var(--sui-bg-light); border: 2px solid var(--sui-primary); border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); }
  .scale-preview input:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 45%, transparent); outline-offset: 3px; border-radius: 999px; }
  .application-scale-label { margin-top: 17px; margin-bottom: 0; }
  .scale-options { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 13px; padding: 5px; background: var(--sui-bg-dark); border-radius: 10px; box-shadow: var(--sui-shadow-inset-sm); }
  .scale-options button { height: 34px; color: var(--sui-text-muted); background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 680; font-variant-numeric: tabular-nums; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .scale-options button:hover { color: var(--sui-primary); }
  .scale-options .scale-option--selected { color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-shadow-raised-sm); }
  .scale-control > p { display: flex; align-items: center; gap: 7px; margin-top: 13px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .scale-control > p span { display: grid; width: 14px; height: 14px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .settings-error { margin-top: 12px; padding: 10px 12px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border-radius: 10px; font-size: calc(8px * var(--text-scale)); }
  button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 45%, transparent); outline-offset: 3px; }
  @media (max-width: 700px) { .settings-layout { padding-inline: 18px; } .settings-heading { align-items: flex-start; flex-direction: column; gap: 10px; } .settings-heading-actions { width: 100%; justify-content: space-between; } }
  @media (max-width: 560px) { .theme-options { grid-template-columns: 1fr; } .theme-option { grid-template-columns: 74px minmax(0, 1fr) 20px; } .theme-preview { width: 74px; } }
</style>
