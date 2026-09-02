<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { AuthMode } from '../../lib/domain/auth';
  import type { AuthSnapshot } from '../../lib/states/AuthGState';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type AuthMethod = 'credentials' | 'seed';

  type Props = {
    onAuthenticate: (
      mode: AuthMode,
      username: string,
      password: string,
    ) => void | Promise<boolean>;
    onClearError: () => void;
    onSeedAuthenticate: (seedPhrase: string) => void | Promise<boolean>;
    platform: 'desktop' | 'web';
    snapshot: Readonly<AuthSnapshot>;
  };

  let { onAuthenticate, onClearError, onSeedAuthenticate, platform, snapshot }: Props = $props();
  let mode = $state<AuthMode>('login');
  let method = $state<AuthMethod>('credentials');
  let username = $state('');
  let password = $state('');
  let confirmation = $state('');
  let seedPhrase = $state('');
  let passwordVisible = $state(false);
  let fieldError = $state<string | null>(null);
  let usernameInput = $state<HTMLInputElement>();
  let seedInput = $state<HTMLTextAreaElement>();
  let focusFrame = 0;
  let busy = $derived(snapshot.phase === 'submitting');

  onMount(() => {
    if (snapshot.phase !== 'checking') focusActiveField();
  });

  onDestroy(() => {
    if (focusFrame) cancelAnimationFrame(focusFrame);
  });

  function focusActiveField(): void {
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      if (method === 'seed') seedInput?.focus();
      else usernameInput?.focus();
    });
  }

  function selectMode(nextMode: AuthMode): void {
    if (busy || method !== 'credentials' || mode === nextMode) return;
    mode = nextMode;
    confirmation = '';
    fieldError = null;
    onClearError();
    focusActiveField();
  }

  function selectSeedMode(): void {
    if (busy || method === 'seed') return;
    method = 'seed';
    fieldError = null;
    onClearError();
    focusActiveField();
  }

  function selectCredentialsMode(): void {
    if (busy || method === 'credentials') return;
    method = 'credentials';
    fieldError = null;
    onClearError();
    focusActiveField();
  }

  function clearErrors(): void {
    fieldError = null;
    onClearError();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    if (method === 'seed') {
      const cleanSeed = seedPhrase.trim().toLowerCase().split(/\s+/u).join(' ');
      if (!/^(?:[0-9a-f]{8})(?: [0-9a-f]{8}){7}$/u.test(cleanSeed)) {
        fieldError = 'Enter all 8 groups from your seed.';
        seedInput?.focus();
        return;
      }
      fieldError = null;
      await onSeedAuthenticate(cleanSeed);
      return;
    }

    const cleanUsername = username.trim();
    if (!/^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/iu.test(cleanUsername)) {
      fieldError = 'Use 3–32 letters, numbers, or inner underscores.';
      usernameInput?.focus();
      return;
    }
    const passwordLength = [...password].length;
    const passwordMaximum = mode === 'register' ? 32 : 128;
    if (passwordLength < 6 || passwordLength > passwordMaximum) {
      fieldError = `Password must be 6–${passwordMaximum} characters.`;
      return;
    }
    if (mode === 'register' && password !== confirmation) {
      fieldError = 'Passwords do not match.';
      return;
    }

    fieldError = null;
    await onAuthenticate(mode, cleanUsername, password);
  }
</script>

<svelte:head>
  <title>Welcome · Kaordo</title>
</svelte:head>

<main class="auth-screen" aria-labelledby="auth-title">
  <div class="ambient ambient--one" aria-hidden="true"></div>
  <div class="ambient ambient--two" aria-hidden="true"></div>

  <section class="auth-layout">
    <aside class="auth-intro" aria-hidden="true">
      <span class="intro-kicker">A calmer way to connect</span>
      <h2>Keep your ideas<br /><em>close to home.</em></h2>
      <p>One friendly place for connected knowledge, conversation, and the data you choose to own.</p>
      <div class="intro-preview">
        <span class="preview-orbit preview-orbit--one"></span>
        <span class="preview-orbit preview-orbit--two"></span>
        <div class="preview-card preview-card--main"><span class="preview-dot"></span><strong>Research map</strong><small>3 connected ideas</small></div>
        <div class="preview-card preview-card--small"><span class="preview-icon">✦</span><strong>Private by default</strong></div>
        <div class="preview-card preview-card--wide"><span class="preview-line"></span><span class="preview-line preview-line--short"></span></div>
        <svg viewBox="0 0 470 240"><path d="M133 125c62 0 54-63 121-63M133 125c70 0 77 60 155 60M325 62c46 0 50 63 81 63" /></svg>
      </div>
      <div class="intro-points"><span><i>✓</i> Local-first files</span><span><i>✓</i> Secure sessions</span></div>
    </aside>

    <section class="auth-card">
      {#if snapshot.phase === 'checking'}
        <div class="session-check" role="status" aria-live="polite">
          <h1 id="auth-title" class="visually-hidden">Kaordo authentication</h1>
          <span class="session-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8.2 8.7 16 4.2l7.8 4.5v9L16 22.2l-7.8-4.5v-9Z" /><path d="m8.2 8.7 7.8 4.5 7.8-4.5M16 13.2v9" /></svg></span>
          <LoadingSpinner />
          <strong>Opening your space</strong>
          <p>Checking the secure session on this device…</p>
        </div>
      {:else}
        <div class="card-heading">
          <span class="card-eyebrow">{method === 'seed' ? 'Alternative sign-in' : 'Private by default'}</span>
          <h1 id="auth-title">{method === 'seed' ? 'Sign in with your seed' : mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p>{method === 'seed' ? 'Use the seed saved in Agordoj as a separate sign-in method.' : mode === 'login' ? 'Sign in to unlock your Kaordo workspace.' : 'A single identity for every Kaordo space.'}</p>
        </div>

        {#if method === 'credentials'}
          <div class="mode-switch" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} class:mode-active={mode === 'login'} disabled={busy} onclick={() => selectMode('login')}>Log in</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} class:mode-active={mode === 'register'} disabled={busy} onclick={() => selectMode('register')}>Register</button>
          </div>
        {:else}
          <div class="seed-mode-badge"><span class="seed-spark" aria-hidden="true">✦</span><span>Seed sign-in</span><button type="button" disabled={busy} onclick={selectCredentialsMode}>Back to password</button></div>
        {/if}

        <form novalidate onsubmit={submit}>
          {#if method === 'seed'}
            <label class="field seed-field" for="seed-input">
              <span>Seed phrase</span>
              <span class="textarea-shell">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5Z" /><path d="M6.5 8.2h7M6.5 11.2h4" /></svg>
                <textarea id="seed-input" bind:this={seedInput} bind:value={seedPhrase} rows="3" spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="00000000 00000000 00000000 00000000\n00000000 00000000 00000000 00000000" disabled={busy} aria-invalid={fieldError ? 'true' : undefined} oninput={clearErrors}></textarea>
              </span>
              <small class="field-hint">Eight groups · spaces and line breaks are accepted.</small>
            </label>
          {:else}
            <label class="field">
              <span>Username</span>
              <span class="input-shell"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3" /><path d="M4.5 16c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5" /></svg><input bind:this={usernameInput} bind:value={username} type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" placeholder="your_name" disabled={busy} aria-invalid={fieldError ? 'true' : undefined} oninput={clearErrors} /></span>
            </label>
            <label class="field">
              <span>Password</span>
              <span class="input-shell"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.2" width="11" height="8" rx="2" /><path d="M7 8.2V6.4a3 3 0 0 1 6 0v1.8M10 11.5v1.8" /></svg><input bind:value={password} type={passwordVisible ? 'text' : 'password'} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} maxlength={mode === 'register' ? 32 : 128} placeholder={mode === 'login' ? 'Your password' : '6–32 characters'} disabled={busy} oninput={clearErrors} /><button class="reveal-button" type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible} disabled={busy} onclick={() => (passwordVisible = !passwordVisible)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.6-4.2 7.5-4.2 7.5 4.2 7.5 4.2-2.6 4.2-7.5 4.2-7.5-4.2-7.5-4.2Z" /><circle cx="10" cy="10" r="2.1" /></svg></button></span>
            </label>
            {#if mode === 'register'}
              <label class="field field--confirmation"><span>Confirm password</span><span class="input-shell"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 10.5 3 3 6-7" /></svg><input bind:value={confirmation} type={passwordVisible ? 'text' : 'password'} autocomplete="new-password" maxlength="32" placeholder="Repeat your password" disabled={busy} oninput={clearErrors} /></span></label>
            {/if}
          {/if}

          <div class="form-message" aria-live="polite">
            {#if fieldError || snapshot.error}<p class="form-error" role="alert"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6.5v4.2M10 13.6h.01" /></svg>{fieldError ?? snapshot.error}</p>
            {:else if method === 'seed'}<p class="form-help">Your seed is checked over an encrypted connection and never saved on this device.</p>
            {:else if mode === 'register'}<p class="form-help">Use 6–32 characters. Your password never leaves this device.</p>{/if}
          </div>

          <button class="submit-button" type="submit" disabled={busy}>{#if busy}<LoadingSpinner compact />{method === 'seed' ? 'Checking seed…' : mode === 'login' ? 'Signing in…' : 'Creating account…'}{:else}{method === 'seed' ? 'Sign in with seed' : mode === 'login' ? 'Continue' : 'Create account'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" /></svg>{/if}</button>
        </form>

        {#if method === 'credentials' && mode === 'login'}
          <button class="seed-entry" type="button" disabled={busy} onclick={selectSeedMode}><span class="seed-entry-icon" aria-hidden="true">✦</span><span><strong>Sign in with a seed</strong><small>Use your separate seed sign-in method</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg></button>
        {/if}

        <div class="security-note"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8 16 5v4.4c0 3.5-2 6-6 7.8-4-1.8-6-4.3-6-7.8V5l6-2.2Z" /><path d="m7.3 9.8 1.7 1.7 3.7-4" /></svg><span><strong>Protected on this device.</strong>{platform === 'desktop' ? ' Your session key stays in secure system storage.' : ' Your session stays in a protected browser cookie.'}</span></div>
      {/if}
    </section>
  </section>

  <footer class="auth-footer"><span>Kaordo · Open beta</span><span><i aria-hidden="true"></i> Encrypted connection</span></footer>
</main>

<style>
  .auth-screen { --bg: #e6ebf3; --bg-light: #f1f4f9; --bg-dark: #cbd4e1; --text: #2d384c; --muted: #64758d; --light-text: #8798ad; --primary: #5b54e0; --primary-dark: #4b45c7; --success: #31a977; --shadow: 10px 10px 24px rgb(50 65 88 / 17%), -9px -9px 22px rgb(255 255 255 / 73%); --shadow-sm: 5px 5px 12px rgb(50 65 88 / 14%), -4px -4px 10px rgb(255 255 255 / 68%); --inset: inset 3px 3px 8px rgb(49 64 86 / 16%), inset -3px -3px 8px rgb(255 255 255 / 68%); position: relative; z-index: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; color: var(--text); background: radial-gradient(circle at 14% 28%, rgb(91 84 224 / 9%), transparent 34%), radial-gradient(circle at 90% 7%, rgb(49 169 119 / 8%), transparent 28%), var(--bg); isolation: isolate; }
  .auth-screen::before { position: fixed; z-index: -1; inset: 0; background-image: radial-gradient(rgb(92 108 131 / 13%) 1px, transparent 1px); background-size: 22px 22px; content: ''; mask-image: linear-gradient(to right, #000, transparent 85%); opacity: .48; }
  .ambient { position: fixed; z-index: -1; border-radius: 50%; pointer-events: none; }
  .ambient--one { top: -280px; right: -180px; width: 700px; height: 700px; background: radial-gradient(circle, rgb(122 115 236 / 11%), transparent 68%); animation: ambient-drift 14s ease-in-out infinite alternate; }
  .ambient--two { bottom: -300px; left: 21%; width: 620px; height: 620px; background: radial-gradient(circle, rgb(69 180 139 / 9%), transparent 69%); animation: ambient-drift 18s ease-in-out -5s infinite alternate-reverse; }
  .session-mark svg { width: 23px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .auth-footer i { width: 6px; height: 6px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 4px rgb(49 169 119 / 13%); }
  .auth-layout { display: grid; grid-template-columns: minmax(320px, 520px) minmax(360px, 440px); align-items: center; justify-content: center; gap: clamp(42px, 8vw, 132px); padding: 16px clamp(28px, 7vw, 86px) 24px; }
  .auth-intro { min-width: 0; padding-bottom: 4px; }
  .intro-kicker, .card-eyebrow { color: var(--primary); font-size: 10px; font-weight: 780; letter-spacing: .16em; text-transform: uppercase; }
  .auth-intro h2 { margin-top: 17px; color: var(--text); font-size: clamp(39px, 4.2vw, 60px); font-weight: 750; letter-spacing: -.065em; line-height: .98; }
  .auth-intro h2 em { color: var(--primary); font-style: normal; }
  .auth-intro > p { max-width: 430px; margin-top: 21px; color: var(--muted); font-size: 14px; line-height: 1.62; }
  .intro-preview { position: relative; height: 220px; margin-top: 28px; overflow: hidden; border-radius: 23px; background: color-mix(in srgb, var(--bg) 80%, #fff); box-shadow: var(--inset); }
  .intro-preview > svg { position: absolute; inset: 0; width: 100%; height: 100%; fill: none; stroke: color-mix(in srgb, var(--primary) 38%, transparent); stroke-linecap: round; stroke-width: 2; }
  .preview-card { position: absolute; z-index: 1; display: grid; align-content: center; border-radius: 13px; box-shadow: var(--shadow-sm); }
  .preview-card strong, .preview-card small { display: block; }.preview-card strong { color: var(--text); font-size: 11px; }.preview-card small { margin-top: 4px; color: var(--light-text); font-size: 8px; }
  .preview-card--main { top: 40px; left: 36px; width: 190px; height: 78px; padding: 0 18px 0 42px; background: var(--bg); }.preview-dot { position: absolute; top: 20px; left: 17px; width: 13px; height: 13px; background: var(--primary); border: 5px solid color-mix(in srgb, var(--primary) 15%, var(--bg)); border-radius: 50%; }
  .preview-card--small { top: 130px; left: 190px; width: 145px; height: 52px; grid-template-columns: 27px 1fr; gap: 7px; padding: 0 12px; background: color-mix(in srgb, var(--bg) 92%, #fff); }.preview-icon { display: grid; width: 25px; height: 25px; color: var(--success); background: color-mix(in srgb, var(--success) 12%, var(--bg)); border-radius: 8px; place-items: center; }
  .preview-card--wide { top: 43px; right: 27px; width: 128px; height: 59px; padding: 0 15px; background: color-mix(in srgb, var(--bg) 91%, #fff); }.preview-line { display: block; width: 86%; height: 6px; background: color-mix(in srgb, var(--primary) 18%, var(--bg)); border-radius: 99px; }.preview-line--short { width: 60%; margin-top: 8px; background: color-mix(in srgb, var(--text) 11%, var(--bg)); }
  .preview-orbit { position: absolute; border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent); border-radius: 50%; }.preview-orbit--one { top: -100px; right: -50px; width: 280px; height: 280px; }.preview-orbit--two { bottom: -180px; left: -110px; width: 350px; height: 350px; }
  .intro-points { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; color: var(--muted); font-size: 10px; font-weight: 650; }.intro-points span { display: inline-flex; align-items: center; gap: 6px; }.intro-points i { display: grid; width: 16px; height: 16px; color: var(--success); background: color-mix(in srgb, var(--success) 13%, var(--bg)); border-radius: 50%; font-size: 9px; font-style: normal; place-items: center; }
  .auth-card { width: 100%; min-height: 500px; padding: 32px 35px 26px; background: color-mix(in srgb, var(--bg) 94%, #fff); border-radius: 25px; box-shadow: var(--shadow); animation: card-in 420ms cubic-bezier(.2,.75,.25,1) both; }
  .card-heading h1 { margin-top: 8px; color: var(--text); font-size: 29px; font-weight: 770; letter-spacing: -.055em; }.card-heading p { max-width: 330px; margin-top: 7px; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 25px; padding: 5px; background: var(--bg); border-radius: 13px; box-shadow: var(--inset); }.mode-switch button { min-height: 33px; color: var(--muted); background: transparent; border: 0; border-radius: 9px; cursor: pointer; font: inherit; font-size: 10px; font-weight: 720; transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease; }.mode-switch button:hover:not(:disabled) { color: var(--text); }.mode-switch .mode-active { color: var(--primary); background: var(--bg-light); box-shadow: var(--shadow-sm); }
  form { margin-top: 20px; }.field { display: block; margin-top: 14px; color: var(--muted); font-size: 10px; font-weight: 700; }.field:first-child { margin-top: 0; }.input-shell, .textarea-shell { position: relative; display: flex; align-items: center; margin-top: 7px; color: var(--light-text); background: var(--bg); border-radius: 12px; box-shadow: var(--inset); transition: box-shadow 180ms ease, transform 180ms ease; }.input-shell:focus-within, .textarea-shell:focus-within { box-shadow: var(--inset), 0 0 0 2px color-mix(in srgb, var(--primary) 23%, transparent); transform: translateY(-1px); }.input-shell > svg, .textarea-shell > svg { position: absolute; left: 13px; width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; pointer-events: none; }.input-shell input, .textarea-shell textarea { width: 100%; min-height: 43px; padding: 0 42px; color: var(--text); background: transparent; border: 0; outline: 0; font: inherit; font-size: 12px; }.input-shell input::placeholder, .textarea-shell textarea::placeholder { color: color-mix(in srgb, var(--light-text) 82%, transparent); }.textarea-shell { align-items: flex-start; }.textarea-shell textarea { min-height: 93px; padding: 13px 13px 13px 42px; resize: vertical; line-height: 1.55; }.reveal-button { position: absolute; right: 9px; display: grid; width: 27px; height: 27px; color: var(--light-text); background: transparent; border: 0; border-radius: 8px; cursor: pointer; place-items: center; }.reveal-button:hover:not(:disabled) { color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); }.reveal-button svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }.field-hint { display: block; margin-top: 6px; color: var(--light-text); font-size: 8px; font-weight: 560; }.form-message { min-height: 31px; margin-top: 11px; }.form-help, .form-error { display: flex; align-items: flex-start; gap: 7px; color: var(--light-text); font-size: 9px; line-height: 1.4; }.form-error { color: #c65368; }.form-error svg { width: 15px; flex: none; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }.submit-button { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 45px; margin-top: 5px; color: #fff; background: linear-gradient(135deg, var(--primary), #7169ed); border: 0; border-radius: 12px; box-shadow: 0 9px 18px color-mix(in srgb, var(--primary) 29%, transparent); cursor: pointer; font: inherit; font-size: 12px; font-weight: 760; transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; }.submit-button:hover:not(:disabled) { filter: brightness(1.04); transform: translateY(-2px); box-shadow: 0 13px 23px color-mix(in srgb, var(--primary) 33%, transparent); }.submit-button:active:not(:disabled) { transform: translateY(0); box-shadow: 0 5px 11px color-mix(in srgb, var(--primary) 24%, transparent); }.submit-button svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .seed-entry { display: grid; grid-template-columns: 32px minmax(0, 1fr) 17px; align-items: center; gap: 9px; width: 100%; margin-top: 17px; padding: 9px 11px; color: var(--muted); background: var(--bg); border: 0; border-radius: 12px; box-shadow: var(--shadow-sm); cursor: pointer; text-align: left; transition: color 160ms ease, transform 160ms ease, box-shadow 160ms ease; }.seed-entry:hover:not(:disabled) { color: var(--primary); transform: translateY(-1px); }.seed-entry:active:not(:disabled) { box-shadow: var(--inset); transform: none; }.seed-entry-icon { display: grid; width: 31px; height: 31px; color: var(--primary); background: color-mix(in srgb, var(--primary) 11%, var(--bg)); border-radius: 9px; place-items: center; }.seed-entry strong, .seed-entry small { display: block; }.seed-entry strong { color: var(--text); font-size: 9px; }.seed-entry small { margin-top: 3px; color: var(--light-text); font-size: 8px; }.seed-entry > svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .seed-mode-badge { display: flex; align-items: center; gap: 8px; margin-top: 24px; padding: 8px 10px; color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--bg)); border-radius: 10px; font-size: 9px; font-weight: 720; }.seed-mode-badge button { margin-left: auto; padding: 3px 5px; color: var(--muted); background: transparent; border: 0; cursor: pointer; font: inherit; font-size: 8px; font-weight: 650; }.seed-mode-badge button:hover:not(:disabled) { color: var(--primary); }.seed-spark { font-size: 15px; animation: spark-pulse 2.2s ease-in-out infinite; }
  .security-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 21px; padding-top: 14px; color: var(--light-text); border-top: 1px solid color-mix(in srgb, var(--light-text) 18%, transparent); font-size: 8px; line-height: 1.45; }.security-note svg { width: 16px; flex: none; fill: none; stroke: var(--success); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.3; }.security-note strong { color: var(--muted); font-weight: 720; }
  .session-check { display: grid; min-height: 430px; align-content: center; justify-items: center; gap: 14px; text-align: center; }.session-mark { display: grid; width: 58px; height: 58px; color: var(--primary); background: var(--bg); border-radius: 18px; box-shadow: var(--shadow-sm); place-items: center; }.session-mark svg { width: 36px; }.session-check strong { color: var(--text); font-size: 15px; }.session-check p { color: var(--muted); font-size: 10px; }
  .auth-footer { display: flex; justify-content: space-between; gap: 16px; padding: 0 clamp(24px, 5vw, 66px) 20px; color: var(--light-text); font-size: 9px; }.auth-footer span:last-child { display: inline-flex; align-items: center; gap: 7px; }
  button:disabled { cursor: default; opacity: .56; }.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  @keyframes ambient-drift { from { transform: translate3d(-12px, 5px, 0) scale(.98); } to { transform: translate3d(14px, -10px, 0) scale(1.03); } }
  @keyframes card-in { from { opacity: 0; transform: translateY(11px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes spark-pulse { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.15) rotate(12deg); } }
  @media (max-width: 980px) { .auth-layout { gap: 34px; padding-inline: 34px; }.auth-intro h2 { font-size: 43px; }.intro-preview { height: 180px; }.auth-card { padding-inline: 28px; } }
  @media (max-width: 800px) { .auth-screen { min-width: 0; }.auth-layout { grid-template-columns: minmax(340px, 440px); }.auth-intro { display: none; }.auth-card { align-self: center; }.auth-footer { padding-bottom: 14px; } }
</style>
