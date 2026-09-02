<script lang="ts">
  import AccountChangeDialog, {
    type AccountChangeMode,
    type AccountChangeValues,
  } from '../dialog/AccountChangeDialog.svelte';
  import type { AuthSession, AuthUser } from '../../lib/domain/auth';
  import type { PublicNodoStorage } from '../../lib/domain/nodo';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    busy: boolean;
    accountBusy: boolean;
    error: string | null;
    onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
    onChangeUsername: (newUsername: string, currentPassword: string) => Promise<boolean>;
    onLogout: () => void | Promise<void>;
    onListPublic: () => void | Promise<void>;
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
    onTerminateSession: (sessionId: string, current: boolean) => void | Promise<void>;
    user: AuthUser;
  };

  let {
    busy,
    accountBusy,
    error,
    onChangePassword,
    onChangeUsername,
    onLogout,
    onListPublic,
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
    onTerminateSession,
    user,
  }: Props = $props();

  let accountModal = $state<AccountChangeMode | null>(null);
  let publicPercent = $derived(publicStorage
    ? Math.min(100, publicStorage.usedBytes / Math.max(1, publicStorage.limitBytes) * 100)
    : 0);

  function formatBytes(value: number): string {
    if (value < 1_024) return `${value} B`;
    if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
    if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
    return `${(value / 1_073_741_824).toFixed(2)} GB`;
  }

  function formatSessionTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp * 1_000));
  }

  async function submitAccountChange(values: AccountChangeValues): Promise<void> {
    const changed = values.kind === 'username'
      ? await onChangeUsername(values.newUsername, values.currentPassword)
      : await onChangePassword(values.currentPassword, values.newPassword);
    if (changed) accountModal = null;
  }
</script>

<section class="account-settings" aria-labelledby="account-settings-title">
  <header class="account-settings-heading">
    <span class="account-settings-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 3.2 18.5 6v4.8c0 4-2.5 7.1-6.5 9-4-1.9-6.5-5-6.5-9V6z" /><path d="m9 11.8 2 2 4-4" /></svg>
    </span>
    <div>
      <span class="eyebrow">Account &amp; privacy</span>
      <h2 id="account-settings-title">Private account settings</h2>
      <p>Security, signed-in devices, and storage stay visible only to you.</p>
    </div>
    <span class="account-protected"><i aria-hidden="true"></i> Protected</span>
  </header>

  <div class="account-settings-grid">
    <section class="account-card" aria-labelledby="account-details-title">
      <header class="card-heading">
        <span class="detail-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><circle cx="10" cy="6.5" r="3" /><path d="M4.5 16c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5" /></svg>
        </span>
        <div>
          <h3 id="account-details-title">Account</h3>
          <p>Private identity and sign-in controls</p>
        </div>
      </header>
      <dl class="account-details-list">
        <div><dt>Username</dt><dd>{user.username}</dd></div>
        <div><dt>Account ID</dt><dd class="account-id" title={user.id}>{user.id}</dd></div>
        <div><dt>Status</dt><dd class="status-value"><i aria-hidden="true"></i> Active</dd></div>
      </dl>
      <div class="account-actions">
        <button type="button" disabled={accountBusy} onclick={() => (accountModal = 'username')}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5V17h1.5l9.7-9.7-1.5-1.5L4 15.5Z" /><path d="m12.8 5.8 1.5 1.5M4 10h4" /></svg>
          Change username
        </button>
        <button type="button" disabled={accountBusy} onclick={() => (accountModal = 'password')}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8.5" width="12" height="8" rx="2" /><path d="M6.8 8.5V6.7a3.2 3.2 0 0 1 6.4 0v1.8M10 11.5v2" /></svg>
          Change password
        </button>
      </div>
    </section>

    <section class="account-card" aria-labelledby="security-title">
      <header class="card-heading">
        <span class="detail-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><rect x="4.5" y="8.2" width="11" height="8" rx="2" /><path d="M7 8.2V6.4a3 3 0 0 1 6 0v1.8M10 11.5v1.8" /></svg>
        </span>
        <div>
          <h3 id="security-title">This device</h3>
          <p>The current authenticated session</p>
        </div>
      </header>
      <div class="current-device">
        <span class="device-mark" aria-hidden="true">
          {#if platform === 'desktop'}
            <svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="10" rx="1.5" /><path d="M7 16.5h6M10 13.5v3" /></svg>
          {:else}
            <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /><path d="M3.8 8h12.4M3.8 12h12.4M10 3.5c1.7 1.8 2.5 4 2.5 6.5s-.8 4.7-2.5 6.5M10 3.5C8.3 5.3 7.5 7.5 7.5 10s.8 4.7 2.5 6.5" /></svg>
          {/if}
        </span>
        <span>
          <strong>{platform === 'desktop' ? 'Desktop application' : 'Web browser'}</strong>
          <small>{platform === 'desktop' ? 'Key stored in the system keychain' : 'Protected browser session'}</small>
        </span>
        <span class="current-session">Current</span>
      </div>
    </section>
  </div>

  <section class="sessions-card" aria-busy={sessionsLoading} aria-labelledby="sessions-title">
    <header class="sessions-heading">
      <span class="detail-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.5" /><path d="M7 17h6M10 14v3M6.5 8h.01M9.5 8h4" /></svg>
      </span>
      <div>
        <h2 id="sessions-title">Sessions</h2>
        <p>Devices currently signed in to your account</p>
      </div>
      {#if sessionsLoading}
        <span class="sessions-status" role="status"><LoadingSpinner compact /> Loading…</span>
      {:else}
        <span class="session-count">{sessions.length}</span>
      {/if}
    </header>

    {#if sessionsError}
      <p class="sessions-error" role="alert">{sessionsError}</p>
    {:else if sessionsLoading && sessions.length === 0}
      <div class="sessions-empty" role="status"><LoadingSpinner compact /> Loading sessions…</div>
    {:else if sessions.length === 0}
      <p class="sessions-empty">No active sessions found.</p>
    {:else}
      <ul class="sessions-list" aria-label="Signed-in devices">
        {#each sessions as session (session.id)}
          <li class="session-item" class:session-item--current={session.current}>
            <span class="session-device-mark" aria-hidden="true">
              {#if session.clientKind === 'desktop'}
                <svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="10" rx="1.5" /><path d="M7 16.5h6M10 13.5v3" /></svg>
              {:else}
                <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /><path d="M3.8 8h12.4M3.8 12h12.4M10 3.5c1.7 1.8 2.5 4 2.5 6.5s-.8 4.7-2.5 6.5M10 3.5C8.3 5.3 7.5 7.5 7.5 10s.8 4.7 2.5 6.5" /></svg>
              {/if}
            </span>
            <span class="session-item-copy">
              <strong>{session.deviceName ?? (session.clientKind === 'desktop' ? 'Desktop application' : 'Web browser')}</strong>
              <small>{session.current ? 'Active on this device' : `Last active ${formatSessionTime(session.lastActiveAt)}`}</small>
              <small>Signed in {formatSessionTime(session.createdAt)}</small>
            </span>
            <span class="session-item-actions">
              {#if session.current}<span class="current-session">Current</span>{/if}
              <button
                type="button"
                class="terminate-session"
                disabled={terminatingSessionId !== null}
                onclick={() => onTerminateSession(session.id, session.current)}
              >
                {#if terminatingSessionId === session.id}
                  <LoadingSpinner compact />
                  Terminating…
                {:else}
                  Terminate
                {/if}
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="public-storage-card" aria-busy={publicStorageLoading} aria-labelledby="public-storage-title">
    <button class="storage-list-button" type="button" onclick={onListPublic} aria-label="List Public Nodo data" title="List Public Nodo data">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10" /><path d="M3 5h.01M3 10h.01M3 15h.01" /></svg>
    </button>
    <span class="storage-icon" aria-hidden="true">
      <svg viewBox="0 0 20 20"><path d="M10 3 16 6.2v7.4L10 17l-6-3.4V6.2L10 3Z" /><path d="m4 6.2 6 3.3 6-3.3M10 9.5V17" /></svg>
    </span>
    <div class="storage-copy">
      <span class="card-label">Fluo storage</span>
      <h2 id="public-storage-title">Public Nodo</h2>
      <p>Your personal allowance across the shared public-node pool.</p>
      <div class="storage-track" aria-hidden="true"><i style={`width:${publicPercent}%`}></i></div>
    </div>
    <div class="storage-amount">
      {#if publicStorageLoading}
        <div class="storage-loading" role="status"><LoadingSpinner compact /><span>Loading…</span></div>
      {:else if publicStorage}
        <strong>{formatBytes(publicStorage.usedBytes)}</strong>
        <span>of {formatBytes(publicStorage.limitBytes)}</span>
        {#if publicStorage.reservedBytes > 0}<small>{formatBytes(publicStorage.reservedBytes)} uploading</small>{/if}
      {:else}
        <strong>—</strong>
        <span>{publicStorageError ?? 'Unavailable'}</span>
      {/if}
    </div>
    <div class="rondo-storage-subitem" aria-busy={rondoPublicStorageLoading}>
      <span class="rondo-subicon" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="M10 3.2 16 6.5v7L10 16.8 4 13.5v-7L10 3.2Z" /><path d="m7.2 10 1.8 1.8 3.8-4" /></svg>
      </span>
      <div class="rondo-subcopy">
        <strong>Rondo Public storage</strong>
        <span>Separate 1 GB allowance for your public Space data.</span>
        <div class="rondo-subtrack" aria-hidden="true"><i style={`width:${rondoPublicStorage ? Math.min(100, rondoPublicStorage.usedBytes / Math.max(1, rondoPublicStorage.limitBytes) * 100) : 0}%`}></i></div>
      </div>
      <div class="rondo-subamount">
        {#if rondoPublicStorageLoading}
          <LoadingSpinner compact />
        {:else if rondoPublicStorage}
          <strong>{formatBytes(rondoPublicStorage.usedBytes)}</strong>
          <span>{formatBytes(rondoPublicStorage.limitBytes)} limit</span>
          {#if !rondoPublicStorage.allocated}<small>Not allocated</small>{/if}
        {:else}
          <strong>—</strong>
          <span>{rondoPublicStorageError ?? 'Unavailable'}</span>
        {/if}
      </div>
    </div>
  </section>

  <section class="logout-card" aria-labelledby="logout-title">
    <div>
      <h2 id="logout-title">Log out of this device</h2>
      <p>Your local session key will be removed. Your workspace files remain on this device.</p>
    </div>
    <button type="button" disabled={busy} onclick={onLogout}>
      {#if busy}
        <LoadingSpinner compact />
        Logging out…
      {:else}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H4.5v12H8M11 6l4 4-4 4M6.5 10H15" /></svg>
        Log out
      {/if}
    </button>
  </section>

  {#if error}<p class="account-settings-error" role="alert">{error}</p>{/if}
</section>

{#if accountModal}
  <AccountChangeDialog
    mode={accountModal}
    busy={accountBusy}
    error={error}
    onCancel={() => { accountModal = null; }}
    onSubmit={submitAccountChange}
    username={user.username}
  />
{/if}

<style>
  .account-settings {
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
    --sui-shadow-raised: 0 8px 20px var(--sui-shadow-color), -5px -5px 14px rgb(255 255 255 / 56%);
    --sui-shadow-raised-sm: 0 4px 10px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 50%);
    --sui-shadow-raised-lg: 0 14px 32px rgb(39 51 67 / 22%), -6px -6px 16px rgb(255 255 255 / 48%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    display: grid;
    gap: 14px;
    min-width: 0;
    color: var(--sui-text);
  }

  :global(html[data-theme='dark']) .account-settings {
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
    --sui-shadow-raised: 0 10px 23px rgb(0 0 0 / 40%);
    --sui-shadow-raised-sm: 0 5px 12px rgb(0 0 0 / 36%);
    --sui-shadow-raised-lg: 0 17px 38px rgb(0 0 0 / 45%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  .account-settings-heading,
  .account-card,
  .sessions-card,
  .public-storage-card,
  .logout-card {
    background: var(--sui-bg);
    border: 0;
    box-shadow: var(--sui-shadow-raised);
  }

  .account-settings-heading {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 13px;
    padding: 17px 19px;
    border-radius: 18px;
  }

  .account-settings-icon,
  .detail-icon,
  .device-mark,
  .session-device-mark,
  .storage-icon,
  .rondo-subicon {
    display: grid;
    flex: none;
    place-items: center;
    color: var(--sui-primary);
    background: var(--sui-bg);
    box-shadow: var(--sui-shadow-inset-sm);
  }

  .account-settings-icon { width: 48px; height: 48px; border-radius: 15px; }
  .account-settings-icon svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .eyebrow, .card-label { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .14em; text-transform: uppercase; }
  .account-settings-heading h2 { margin-top: 3px; color: var(--sui-text); font-size: calc(16px * var(--text-scale)); font-weight: 740; letter-spacing: -.03em; }
  .account-settings-heading p { margin-top: 3px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .account-protected { display: inline-flex; align-items: center; gap: 7px; color: var(--sui-success); font-size: calc(8px * var(--text-scale)); font-weight: 720; white-space: nowrap; }
  .account-protected i, .status-value i { width: 7px; height: 7px; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-success) 14%, transparent); }

  .account-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .account-card { min-width: 0; padding: 17px 18px; border-radius: 16px; }
  .card-heading, .sessions-heading { display: flex; align-items: center; gap: 10px; }
  .card-heading { padding-bottom: 13px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .detail-icon { width: 35px; height: 35px; border-radius: 11px; }
  .detail-icon svg, .device-mark svg, .session-device-mark svg, .storage-icon svg, .rondo-subicon svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .card-heading h3, .sessions-heading h2, .logout-card h2 { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); font-weight: 710; }
  .card-heading p, .sessions-heading p { margin-top: 3px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .account-details-list { margin: 10px 0 0; }
  .account-details-list > div { display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; min-height: 28px; }
  dt { color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  dd { min-width: 0; margin: 0; overflow: hidden; color: var(--sui-text); font-size: calc(9px * var(--text-scale)); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .account-id { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: calc(8px * var(--text-scale)); }
  .status-value { display: flex; align-items: center; gap: 7px; color: var(--sui-success); }
  .status-value i { width: 5px; height: 5px; box-shadow: none; }
  .account-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; padding-top: 11px; border-top: 1px solid color-mix(in srgb, var(--sui-text-light) 14%, transparent); }
  .account-actions button, .terminate-session, .logout-card button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--sui-primary); background: var(--sui-bg); border: 0; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font: inherit; font-size: calc(8px * var(--text-scale)); font-weight: 700; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .account-actions button { min-height: 29px; padding: 0 9px; border-radius: 9px; }
  .account-actions button svg { width: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .account-actions button:hover:not(:disabled), .terminate-session:hover:not(:disabled), .logout-card button:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .account-actions button:active:not(:disabled), .terminate-session:active:not(:disabled), .logout-card button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  button:disabled { cursor: default; opacity: .56; }

  .current-device { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 70px; }
  .device-mark { width: 40px; height: 40px; border-radius: 13px; }
  .current-device strong, .current-device small { display: block; }
  .current-device strong { color: var(--sui-text); font-size: calc(10px * var(--text-scale)); font-weight: 680; }
  .current-device small { margin-top: 4px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .current-session { padding: 5px 8px; color: var(--sui-success); background: color-mix(in srgb, var(--sui-success) 12%, var(--sui-bg)); border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 760; text-transform: uppercase; }

  .sessions-card { padding: 17px 18px; border-radius: 16px; }
  .sessions-heading { padding-bottom: 13px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .session-count { display: grid; min-width: 25px; height: 22px; margin-left: auto; padding: 0 7px; color: var(--sui-primary); background: color-mix(in srgb, var(--sui-primary) 12%, var(--sui-bg)); border-radius: 999px; font-size: calc(8px * var(--text-scale)); font-weight: 730; place-items: center; }
  .sessions-status { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .sessions-status :global(.library-loader), .sessions-empty :global(.library-loader), .terminate-session :global(.library-loader), .storage-loading :global(.library-loader), .rondo-subamount :global(.library-loader) { border-color: color-mix(in srgb, var(--sui-primary) 22%, transparent); border-top-color: var(--sui-primary); }
  .sessions-list { display: grid; gap: 5px; margin: 12px 0 0; padding: 0; list-style: none; }
  .session-item { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; padding: 9px; border-radius: 11px; }
  .session-item + .session-item { border-top: 1px solid color-mix(in srgb, var(--sui-text-light) 12%, transparent); }
  .session-item--current { background: color-mix(in srgb, var(--sui-primary) 6%, var(--sui-bg)); }
  .session-device-mark { width: 36px; height: 36px; border-radius: 11px; }
  .session-item-copy { min-width: 0; }
  .session-item-copy strong, .session-item-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-item-copy strong { color: var(--sui-text); font-size: calc(9px * var(--text-scale)); font-weight: 670; }
  .session-item-copy small { margin-top: 3px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .session-item-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .terminate-session { min-width: 76px; min-height: 28px; padding: 0 9px; border-radius: 9px; }
  .sessions-empty { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 58px; color: var(--sui-text-light); font-size: calc(9px * var(--text-scale)); }
  .sessions-error, .account-settings-error { padding: 10px 12px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border-radius: 10px; font-size: calc(8px * var(--text-scale)); }
  .sessions-error { margin-top: 12px; }

  .public-storage-card { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 13px; min-height: 106px; padding: 18px 19px; border-radius: 16px; }
  .storage-icon { width: 44px; height: 44px; border-radius: 14px; }
  .storage-list-button { position: absolute; top: 12px; right: 12px; display: grid; width: 28px; height: 28px; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 9px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; place-items: center; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .storage-list-button:hover { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .storage-list-button:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .storage-list-button svg { width: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .storage-copy h2 { margin-top: 3px; color: var(--sui-text); font-size: calc(13px * var(--text-scale)); font-weight: 710; }
  .storage-copy p { margin-top: 4px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .storage-track, .rondo-subtrack { overflow: hidden; background: color-mix(in srgb, var(--sui-text-light) 17%, var(--sui-bg)); border-radius: 999px; }
  .storage-track { height: 5px; margin-top: 11px; }
  .storage-track i, .rondo-subtrack i { display: block; height: 100%; background: linear-gradient(90deg, color-mix(in srgb, var(--sui-primary) 55%, #7abf9e), var(--sui-primary)); border-radius: inherit; transition: width 180ms ease; }
  .storage-amount { min-width: 112px; padding-right: 4px; text-align: right; }
  .storage-amount strong, .storage-amount span, .storage-amount small { display: block; }
  .storage-amount strong { color: var(--sui-text); font-size: calc(14px * var(--text-scale)); font-weight: 730; font-variant-numeric: tabular-nums; }
  .storage-amount span { margin-top: 2px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .storage-amount small { margin-top: 5px; color: #c57b46; font-size: calc(7px * var(--text-scale)); }
  .storage-loading { display: inline-flex; align-items: center; justify-content: flex-end; gap: 7px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .rondo-storage-subitem { display: grid; grid-column: 1 / -1; grid-template-columns: 31px minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-top: 1px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--sui-text-light) 16%, transparent); }
  .rondo-subicon { width: 31px; height: 31px; border-radius: 10px; }
  .rondo-subicon svg { width: 17px; }
  .rondo-subcopy { min-width: 0; }
  .rondo-subcopy strong, .rondo-subcopy span { display: block; }
  .rondo-subcopy strong { color: var(--sui-text); font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .rondo-subcopy span { margin-top: 2px; overflow: hidden; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .rondo-subtrack { height: 4px; margin-top: 7px; }
  .rondo-subamount { min-width: 83px; text-align: right; }
  .rondo-subamount strong, .rondo-subamount span, .rondo-subamount small { display: block; }
  .rondo-subamount strong { color: var(--sui-text); font-size: calc(10px * var(--text-scale)); font-weight: 700; font-variant-numeric: tabular-nums; }
  .rondo-subamount span { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .rondo-subamount small { margin-top: 3px; color: #c57b46; font-size: calc(7px * var(--text-scale)); }
  .rondo-subamount :global(.library-loader) { margin-left: auto; }

  .logout-card { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 74px; padding: 15px 18px; border-radius: 16px; }
  .logout-card p { margin-top: 5px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .logout-card button { min-width: 105px; min-height: 35px; padding: 0 12px; border-radius: 10px; }
  .logout-card button svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .account-settings-error { margin-top: 0; }

  button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 45%, transparent); outline-offset: 3px; }
  @media (max-width: 680px) {
    .account-settings-heading { grid-template-columns: 41px minmax(0, 1fr); }
    .account-settings-icon { width: 41px; height: 41px; }
    .account-protected { grid-column: 2; justify-self: start; }
    .account-settings-grid { grid-template-columns: 1fr; }
    .public-storage-card { grid-template-columns: 39px minmax(0, 1fr); }
    .storage-amount { grid-column: 2; min-width: 0; padding-top: 6px; text-align: left; }
    .rondo-subamount { min-width: 70px; }
    .logout-card { align-items: flex-start; flex-direction: column; }
    .logout-card button { width: 100%; }
  }
</style>
