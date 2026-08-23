<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { AuthMode } from '../../lib/domain/auth';
  import type { AuthSnapshot } from '../../lib/states/AuthGState';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    onAuthenticate: (
      mode: AuthMode,
      username: string,
      password: string,
    ) => void | Promise<boolean>;
    onClearError: () => void;
    platform: 'desktop' | 'web';
    snapshot: Readonly<AuthSnapshot>;
  };

  let { onAuthenticate, onClearError, platform, snapshot }: Props = $props();
  let mode = $state<AuthMode>('login');
  let username = $state('');
  let password = $state('');
  let confirmation = $state('');
  let passwordVisible = $state(false);
  let fieldError = $state<string | null>(null);
  let usernameInput = $state<HTMLInputElement>();
  let focusFrame = 0;
  let busy = $derived(snapshot.phase === 'submitting');

  onMount(() => {
    if (snapshot.phase !== 'checking') usernameInput?.focus();
  });

  onDestroy(() => {
    if (focusFrame) cancelAnimationFrame(focusFrame);
  });

  function selectMode(nextMode: AuthMode) {
    if (busy || mode === nextMode) return;
    mode = nextMode;
    confirmation = '';
    fieldError = null;
    onClearError();
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      usernameInput?.focus();
    });
  }

  function clearErrors() {
    fieldError = null;
    onClearError();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;

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

  <header class="auth-brand" aria-label="Kaordo">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M8.2 8.7 16 4.2l7.8 4.5v9L16 22.2l-7.8-4.5v-9Z" />
        <path d="m8.2 8.7 7.8 4.5 7.8-4.5M16 13.2v9" />
        <path d="m11.9 24.1 4.1 2.4 4.1-2.4" />
      </svg>
    </span>
    <span>Kaordo</span>
  </header>

  <section class="auth-layout">
    <div class="auth-intro" aria-hidden="true">
      <span class="intro-kicker">Your knowledge, in your hands</span>
      <h2>Shape ideas.<br />Keep their context.</h2>
      <p>
        One calm place for connected knowledge, conversation, and the data you
        choose to own.
      </p>
      <div class="intro-preview">
        <span class="preview-node preview-node--primary">
          <i></i>
          Research map
        </span>
        <span class="preview-node preview-node--small">Notes</span>
        <span class="preview-node preview-node--wide">Working theory</span>
        <svg viewBox="0 0 420 210">
          <path d="M112 105c49 0 44-51 103-51M112 105c54 0 58 53 123 53M305 54c43 0 37 51 68 51" />
        </svg>
      </div>
    </div>

    <div class="auth-card">
      {#if snapshot.phase === 'checking'}
        <div class="session-check" role="status" aria-live="polite">
          <h1 id="auth-title" class="visually-hidden">Kaordo authentication</h1>
          <span class="session-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M8.2 8.7 16 4.2l7.8 4.5v9L16 22.2l-7.8-4.5v-9Z" />
              <path d="m8.2 8.7 7.8 4.5 7.8-4.5M16 13.2v9" />
            </svg>
          </span>
          <LoadingSpinner />
          <strong>Opening your space</strong>
          <p>Checking the secure session on this device…</p>
        </div>
      {:else}
        <div class="card-heading">
          <span class="card-eyebrow">Private by default</span>
          <h1 id="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p>
            {mode === 'login'
              ? 'Sign in to unlock your Kaordo workspace.'
              : 'A single identity for every Kaordo space.'}
          </p>
        </div>

        <div class="mode-switch" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            class:mode-active={mode === 'login'}
            disabled={busy}
            onclick={() => selectMode('login')}
          >Log in</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            class:mode-active={mode === 'register'}
            disabled={busy}
            onclick={() => selectMode('register')}
          >Register</button>
        </div>

        <form novalidate onsubmit={submit}>
          <label class="field">
            <span>Username</span>
            <span class="input-shell">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="6.5" r="3" />
                <path d="M4.5 16c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5" />
              </svg>
              <input
                bind:this={usernameInput}
                bind:value={username}
                type="text"
                inputmode="text"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                maxlength="32"
                placeholder="your_name"
                disabled={busy}
                aria-invalid={fieldError ? 'true' : undefined}
                oninput={clearErrors}
              />
            </span>
          </label>

          <label class="field">
            <span>Password</span>
            <span class="input-shell">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="4.5" y="8.2" width="11" height="8" rx="2" />
                <path d="M7 8.2V6.4a3 3 0 0 1 6 0v1.8M10 11.5v1.8" />
              </svg>
              <input
                bind:value={password}
                type={passwordVisible ? 'text' : 'password'}
                autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
                maxlength={mode === 'register' ? 32 : 128}
                placeholder={mode === 'login' ? 'Your password' : '6–32 characters'}
                disabled={busy}
                oninput={clearErrors}
              />
              <button
                class="reveal-button"
                type="button"
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={passwordVisible}
                disabled={busy}
                onclick={() => (passwordVisible = !passwordVisible)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M2.5 10s2.6-4.2 7.5-4.2 7.5 4.2 7.5 4.2-2.6 4.2-7.5 4.2S2.5 10 2.5 10Z" />
                  <circle cx="10" cy="10" r="2.1" />
                </svg>
              </button>
            </span>
          </label>

          {#if mode === 'register'}
            <label class="field field--confirmation">
              <span>Confirm password</span>
              <span class="input-shell">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5.5 10.5 3 3 6-7" />
                </svg>
                <input
                  bind:value={confirmation}
                  type={passwordVisible ? 'text' : 'password'}
                  autocomplete="new-password"
                  maxlength="32"
                  placeholder="Repeat your password"
                  disabled={busy}
                  oninput={clearErrors}
                />
              </span>
            </label>
          {/if}

          <div class="form-message" aria-live="polite">
            {#if fieldError || snapshot.error}
              <p class="form-error" role="alert">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="7.5" />
                  <path d="M10 6.5v4.2M10 13.6h.01" />
                </svg>
                {fieldError ?? snapshot.error}
              </p>
            {:else if mode === 'register'}
              <p class="form-help">Use 6–32 characters. Your password never leaves this device.</p>
            {/if}
          </div>

          <button class="submit-button" type="submit" disabled={busy}>
            {#if busy}
              <LoadingSpinner compact />
              {mode === 'login' ? 'Signing in…' : 'Creating account…'}
            {:else}
              {mode === 'login' ? 'Continue' : 'Create account'}
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 6l4 4-4 4" />
              </svg>
            {/if}
          </button>
        </form>

        <div class="security-note">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.8 16 5v4.4c0 3.5-2 6-6 7.8-4-1.8-6-4.3-6-7.8V5l6-2.2Z" />
            <path d="m7.3 9.8 1.7 1.7 3.7-4" />
          </svg>
          <span>
            <strong>Protected on this device.</strong>
            {platform === 'desktop'
              ? 'Your session key stays in secure system storage.'
              : 'Your session stays in a protected browser cookie.'}
          </span>
        </div>
      {/if}
    </div>
  </section>

  <footer class="auth-footer">
    <span>Kaordo 0.x</span>
    <span><i aria-hidden="true"></i> Secure connection</span>
  </footer>
</main>

<style>
  .auth-screen {
    position: fixed;
    z-index: 10000;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 1024px;
    min-height: 680px;
    overflow: auto;
    color: #edf6f1;
    background:
      radial-gradient(circle at 23% 40%, rgb(77 143 121 / 20%), transparent 30%),
      linear-gradient(135deg, #17231f 0%, #1b2c27 47%, #14211e 100%);
    isolation: isolate;
  }

  .auth-screen::before {
    position: fixed;
    z-index: -1;
    inset: 0;
    background-image:
      linear-gradient(rgb(255 255 255 / 2.4%) 1px, transparent 1px),
      linear-gradient(90deg, rgb(255 255 255 / 2.4%) 1px, transparent 1px);
    background-size: 44px 44px;
    content: '';
    mask-image: linear-gradient(to right, #000, transparent 72%);
  }

  .ambient {
    position: fixed;
    z-index: -1;
    border-radius: 50%;
    filter: blur(1px);
    pointer-events: none;
  }

  .ambient--one {
    top: -210px;
    right: -100px;
    width: 560px;
    height: 560px;
    background: radial-gradient(circle, rgb(118 183 161 / 12%), transparent 68%);
  }

  .ambient--two {
    bottom: -270px;
    left: 20%;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgb(86 136 118 / 10%), transparent 68%);
  }

  .auth-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 72px;
    padding: 0 34px;
    color: #f7fbf8;
    font-size: calc(14px * var(--text-scale));
    font-weight: 680;
    letter-spacing: -0.01em;
  }

  .brand-mark {
    display: grid;
    width: 30px;
    height: 30px;
    color: #a7d3c4;
    background: rgb(255 255 255 / 6%);
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 9px;
    place-items: center;
  }

  .brand-mark svg,
  .session-mark svg {
    width: 21px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .auth-layout {
    display: grid;
    grid-template-columns: minmax(400px, 520px) 430px;
    align-items: center;
    justify-content: center;
    gap: clamp(64px, 9vw, 146px);
    padding: 20px 64px 30px;
  }

  .auth-intro {
    align-self: center;
    padding-bottom: 18px;
  }

  .intro-kicker,
  .card-eyebrow {
    color: #8fc1b0;
    font-size: calc(10px * var(--text-scale));
    font-weight: 730;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .auth-intro h2 {
    margin-top: 18px;
    color: #f4faf6;
    font-size: clamp(
      calc(42px * var(--text-scale)),
      calc(4vw * var(--text-scale)),
      calc(58px * var(--text-scale))
    );
    font-weight: 650;
    letter-spacing: -0.055em;
    line-height: 0.98;
  }

  .auth-intro > p {
    max-width: 420px;
    margin-top: 22px;
    color: #9dafa7;
    font-size: calc(14px * var(--text-scale));
    line-height: 1.65;
  }

  .intro-preview {
    position: relative;
    width: 420px;
    height: 210px;
    margin-top: 36px;
  }

  .intro-preview > svg {
    position: absolute;
    inset: 0;
    fill: none;
    stroke: rgb(147 195 178 / 24%);
    stroke-dasharray: 3 5;
    stroke-width: 1.2;
  }

  .preview-node {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 13px;
    color: #b6c8c0;
    background: rgb(246 252 248 / 5%);
    border: 1px solid rgb(210 235 224 / 11%);
    border-radius: 10px;
    box-shadow: 0 15px 45px rgb(0 0 0 / 12%);
    font-size: calc(11px * var(--text-scale));
    font-weight: 590;
    backdrop-filter: blur(8px);
  }

  .preview-node--primary {
    top: 84px;
    left: 16px;
    min-width: 130px;
    color: #e8f5ef;
    background: rgb(111 171 149 / 14%);
    border-color: rgb(152 207 187 / 21%);
  }

  .preview-node--primary i {
    width: 7px;
    height: 7px;
    background: #79bda4;
    border-radius: 50%;
    box-shadow: 0 0 0 4px rgb(121 189 164 / 10%);
  }

  .preview-node--small { top: 34px; left: 214px; }
  .preview-node--wide { top: 138px; left: 234px; min-width: 138px; }

  .auth-card {
    min-height: 570px;
    padding: 38px 42px 32px;
    color: #26312c;
    background: rgb(249 251 248 / 97%);
    border: 1px solid rgb(255 255 255 / 42%);
    border-radius: 20px;
    box-shadow:
      0 32px 90px rgb(4 13 10 / 36%),
      0 2px 8px rgb(4 13 10 / 18%);
  }

  .session-check {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 492px;
    text-align: center;
  }

  .session-check :global(.library-loader) { margin-bottom: 20px; }

  .session-mark {
    display: grid;
    width: 52px;
    height: 52px;
    margin-bottom: 28px;
    color: #4d8878;
    background: #e5efea;
    border-radius: 15px;
    place-items: center;
  }

  .session-check strong { color: #26342d; font-size: calc(16px * var(--text-scale)); }
  .session-check p { margin-top: 8px; color: #7c8982; font-size: calc(11px * var(--text-scale)); }

  .card-heading h1 {
    margin-top: 8px;
    color: #223029;
    font-size: calc(28px * var(--text-scale));
    font-weight: 690;
    letter-spacing: -0.04em;
  }

  .card-heading p {
    margin-top: 8px;
    color: #77827c;
    font-size: calc(11px * var(--text-scale));
    line-height: 1.5;
  }

  .mode-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 38px;
    margin-top: 24px;
    padding: 3px;
    background: #e9ede9;
    border: 1px solid #dfe4df;
    border-radius: 10px;
  }

  .mode-switch button {
    color: #738079;
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
    font-size: calc(11px * var(--text-scale));
    font-weight: 650;
    transition: 140ms ease;
  }

  .mode-switch button.mode-active {
    color: #2b4037;
    background: #fff;
    box-shadow: 0 1px 4px rgb(30 52 42 / 12%);
  }

  form { margin-top: 22px; }

  .field {
    display: block;
    margin-top: 14px;
  }

  .field > span:first-child {
    display: block;
    margin-bottom: 7px;
    color: #48534d;
    font-size: calc(10px * var(--text-scale));
    font-weight: 650;
  }

  .input-shell {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    height: 43px;
    padding: 0 11px;
    background: #fff;
    border: 1px solid #ccd3ce;
    border-radius: 9px;
    box-shadow: inset 0 1px 2px rgb(26 44 35 / 3%);
    transition:
      border-color 130ms ease,
      box-shadow 130ms ease;
  }

  .input-shell:focus-within {
    border-color: #5b9282;
    box-shadow: 0 0 0 3px rgb(61 126 108 / 12%);
  }

  .input-shell > svg,
  .reveal-button svg {
    width: 17px;
    fill: none;
    stroke: #8b968f;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .input-shell input {
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0;
    color: #26312c;
    background: transparent;
    border: 0;
    outline: none;
    font-size: calc(12px * var(--text-scale));
  }

  .input-shell input::placeholder { color: #a3aaa6; }

  .reveal-button {
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    place-items: center;
  }

  .reveal-button:hover { background: #f0f3f0; }

  .form-message {
    min-height: 39px;
    padding-top: 10px;
  }

  .form-error,
  .form-help {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: #a04f48;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.35;
  }

  .form-help { color: #7b8680; }

  .form-error svg {
    flex: none;
    width: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.4;
  }

  .submit-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    height: 43px;
    color: #f7fbf8;
    background: #326f60;
    border: 0;
    border-radius: 9px;
    box-shadow: 0 8px 20px rgb(50 111 96 / 20%);
    cursor: pointer;
    font-size: calc(11px * var(--text-scale));
    font-weight: 680;
    transition:
      transform 120ms ease,
      background 120ms ease,
      box-shadow 120ms ease;
  }

  .submit-button:hover:not(:disabled) {
    background: #2d6658;
    box-shadow: 0 10px 24px rgb(50 111 96 / 27%);
    transform: translateY(-1px);
  }

  .submit-button:active:not(:disabled) { transform: translateY(0); }
  .submit-button:disabled { cursor: default; opacity: 0.75; }

  .submit-button > svg {
    width: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .submit-button :global(.library-loader) {
    border-color: rgb(255 255 255 / 28%);
    border-top-color: #fff;
  }

  .security-note {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: 18px;
    padding-top: 17px;
    color: #78837d;
    border-top: 1px solid #e1e5e1;
    font-size: calc(9px * var(--text-scale));
    line-height: 1.35;
  }

  .security-note svg {
    flex: none;
    width: 20px;
    fill: none;
    stroke: #5d8d7e;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.3;
  }

  .security-note strong { color: #52605a; }

  .auth-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 46px;
    padding: 0 34px;
    color: #687c73;
    font-size: calc(8px * var(--text-scale));
    font-weight: 620;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .auth-footer span:last-child { display: flex; align-items: center; gap: 7px; }
  .auth-footer i { width: 5px; height: 5px; background: #6eb39b; border-radius: 50%; }

  @media (max-width: 1120px) {
    .auth-layout { grid-template-columns: 390px 410px; gap: 52px; }
    .intro-preview { transform: scale(0.92); transform-origin: left top; }
  }

  @media (max-height: 720px) {
    .auth-footer { display: none; }
    .auth-layout { padding-block: 8px 14px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-switch button,
    .input-shell,
    .submit-button { transition: none; }
  }
</style>
