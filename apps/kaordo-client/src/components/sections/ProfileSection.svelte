<script lang="ts">
  import type { AuthSession, AuthUser } from '../../lib/domain/auth';
  import type { PublicNodoStorage } from '../../lib/domain/nodo';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    busy: boolean;
    error: string | null;
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
    error,
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
  let initial = $derived(user.username.slice(0, 1).toUpperCase());
  let joined = $derived(formatJoined(user.createdAt));
  let publicPercent = $derived(publicStorage
    ? Math.min(100, publicStorage.usedBytes / Math.max(1, publicStorage.limitBytes) * 100)
    : 0);

  function formatJoined(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(timestamp * 1_000));
  }

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
</script>

<main class="profile-shell" aria-labelledby="profile-title">
  <div class="profile-layout">
    <header class="profile-heading">
      <div>
        <span class="eyebrow">Your identity</span>
        <h1 id="profile-title">Mi</h1>
        <p>Account details and security for your Kaordo identity.</p>
      </div>
      <span class="account-state"><i aria-hidden="true"></i> Active account</span>
    </header>

    <section class="identity-card" aria-labelledby="identity-title">
      <div class="avatar" aria-hidden="true">{initial}</div>
      <div class="identity-copy">
        <span class="card-label">Kaordo identity</span>
        <h2 id="identity-title">{user.username}</h2>
        <p>Member since {joined}</p>
      </div>
      <span class="identity-badge">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2.7 16 5v4.3c0 3.5-2 6.1-6 7.9-4-1.8-6-4.4-6-7.9V5l6-2.3Z" />
          <path d="m7.2 9.9 1.7 1.7 3.9-4" />
        </svg>
        Protected
      </span>
    </section>

    <div class="profile-grid">
      <section class="detail-card" aria-labelledby="account-details-title">
        <header>
          <span class="detail-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <circle cx="10" cy="6.5" r="3" />
              <path d="M4.5 16c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5" />
            </svg>
          </span>
          <div>
            <h2 id="account-details-title">Account</h2>
            <p>Your public identity details</p>
          </div>
        </header>
        <dl>
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Account ID</dt>
            <dd class="account-id" title={user.id}>{user.id}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd class="status-value"><i aria-hidden="true"></i> Active</dd>
          </div>
        </dl>
      </section>

      <section class="detail-card" aria-labelledby="security-title">
        <header>
          <span class="detail-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <rect x="4.5" y="8.2" width="11" height="8" rx="2" />
              <path d="M7 8.2V6.4a3 3 0 0 1 6 0v1.8M10 11.5v1.8" />
            </svg>
          </span>
          <div>
            <h2 id="security-title">Session & security</h2>
            <p>This device is currently authenticated</p>
          </div>
        </header>
        <div class="session-row">
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

    <section
      class="public-storage-card"
      aria-busy={publicStorageLoading}
      aria-labelledby="public-storage-title"
    >
      <button class="storage-list-button" type="button" onclick={onListPublic} aria-label="List Public Nodo data" title="List Public Nodo data">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10" /><path d="M3 5h.01M3 10h.01M3 15h.01" /></svg>
      </button>
      <span class="storage-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="M10 3 16 6.2v7.4L10 17l-6-3.4V6.2L10 3Z"/><path d="m4 6.2 6 3.3 6-3.3M10 9.5V17"/></svg>
      </span>
      <div class="storage-copy">
        <span class="card-label">Fluo storage</span>
        <h2 id="public-storage-title">Public Nodo</h2>
        <p>Your personal allowance across the shared public-node pool.</p>
        <div class="storage-track" aria-hidden="true"><i style={`width:${publicPercent}%`}></i></div>
      </div>
      <div class="storage-amount">
        {#if publicStorageLoading}
          <div class="storage-loading" role="status">
            <LoadingSpinner compact />
            <span>Loading…</span>
          </div>
        {:else if publicStorage}
          <strong>{formatBytes(publicStorage.usedBytes)}</strong>
          <span>of {formatBytes(publicStorage.limitBytes)}</span>
          {#if publicStorage.reservedBytes > 0}
            <small>{formatBytes(publicStorage.reservedBytes)} uploading</small>
          {/if}
        {:else}
          <strong>—</strong>
          <span>{publicStorageError ?? 'Unavailable'}</span>
        {/if}
      </div>
      <div class="rondo-storage-subitem" aria-busy={rondoPublicStorageLoading}>
        <span class="rondo-subicon" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="M10 3.2 16 6.5v7L10 16.8 4 13.5v-7L10 3.2Z"/><path d="m7.2 10 1.8 1.8 3.8-4"/></svg>
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
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4H4.5v12H8M11 6l4 4-4 4M6.5 10H15" />
          </svg>
          Log out
        {/if}
      </button>
    </section>

    {#if error}
      <p class="profile-error" role="alert">{error}</p>
    {/if}
  </div>
</main>

<style>
  .profile-shell {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: #2c3731;
    background:
      radial-gradient(circle at 72% 8%, rgb(70 136 116 / 9%), transparent 28%),
      #f4f6f2;
  }

  .profile-layout {
    width: min(100%, 930px);
    min-height: 100%;
    margin: 0 auto;
    padding: 32px 34px 58px;
  }

  .profile-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 3px 22px;
  }

  .eyebrow,
  .card-label {
    color: #568575;
    font-size: calc(9px * var(--text-scale));
    font-weight: 730;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .profile-heading h1 {
    margin-top: 6px;
    color: #223029;
    font-size: calc(28px * var(--text-scale));
    font-weight: 690;
    letter-spacing: -0.04em;
  }

  .profile-heading p {
    margin-top: 7px;
    color: #748078;
    font-size: calc(11px * var(--text-scale));
  }

  .account-state {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 27px;
    padding: 0 10px;
    color: #587068;
    background: rgb(255 255 255 / 68%);
    border: 1px solid #d5ddd7;
    border-radius: 999px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 620;
  }

  .account-state i,
  .status-value i {
    width: 6px;
    height: 6px;
    background: #4e9b80;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgb(78 155 128 / 12%);
  }

  .identity-card {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    min-height: 124px;
    padding: 22px 24px;
    color: #eff8f3;
    background:
      radial-gradient(circle at 90% -20%, rgb(134 199 176 / 19%), transparent 43%),
      linear-gradient(135deg, #1d302a, #263c35);
    border: 1px solid rgb(255 255 255 / 6%);
    border-radius: 16px;
    box-shadow: 0 18px 40px rgb(29 54 44 / 13%);
  }

  .avatar {
    display: grid;
    width: 68px;
    height: 68px;
    color: #214a3e;
    background: linear-gradient(145deg, #dcece5, #9ccbb9);
    border: 1px solid rgb(255 255 255 / 34%);
    border-radius: 20px;
    box-shadow: inset 0 1px rgb(255 255 255 / 54%);
    font-size: calc(25px * var(--text-scale));
    font-weight: 710;
    place-items: center;
  }

  .identity-copy h2 {
    margin-top: 6px;
    font-size: calc(21px * var(--text-scale));
    font-weight: 670;
    letter-spacing: -0.03em;
  }

  .identity-copy p {
    margin-top: 5px;
    color: rgb(239 248 243 / 53%);
    font-size: calc(9px * var(--text-scale));
  }

  .identity-card .card-label { color: #8ec1af; }

  .identity-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 29px;
    padding: 0 10px;
    color: #b5dacc;
    background: rgb(255 255 255 / 6%);
    border: 1px solid rgb(255 255 255 / 9%);
    border-radius: 8px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 630;
  }

  .identity-badge svg,
  .detail-icon svg,
  .device-mark svg,
  .storage-icon svg,
  .logout-card button > svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .identity-badge svg { width: 16px; }

  .profile-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    margin-top: 16px;
  }

  .sessions-card {
    margin-top: 16px;
    padding: 19px 20px;
    background: rgb(255 255 255 / 86%);
    border: 1px solid #dce1dc;
    border-radius: 13px;
    box-shadow: 0 8px 25px rgb(33 57 47 / 5%);
  }

  .sessions-heading {
    display: flex;
    align-items: center;
    gap: 11px;
    padding-bottom: 14px;
    border-bottom: 1px solid #e3e7e3;
  }

  .sessions-heading h2 { color: #2c3832; font-size: calc(12px * var(--text-scale)); font-weight: 670; }
  .sessions-heading p { margin-top: 3px; color: #879089; font-size: calc(9px * var(--text-scale)); }
  .session-count { display: grid; min-width: 24px; height: 22px; margin-left: auto; padding: 0 7px; color: #4a806f; background: #edf4f0; border-radius: 999px; font-size: calc(9px * var(--text-scale)); font-weight: 680; place-items: center; }
  .sessions-status { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; color: #5a7b6d; font-size: calc(9px * var(--text-scale)); }
  .sessions-status :global(.library-loader), .sessions-empty :global(.library-loader), .terminate-session :global(.library-loader) { border-color: #c6d9d0; border-top-color: #43836e; }

  .sessions-list { display: grid; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
  .session-item { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; padding: 10px 0; }
  .session-item + .session-item { border-top: 1px solid #edf0ed; }
  .session-item--current { background: linear-gradient(90deg, rgb(238 247 242 / 50%), transparent); border-radius: 8px; }
  .session-device-mark { display: grid; width: 36px; height: 36px; color: #528676; background: #e8f0eb; border-radius: 9px; place-items: center; }
  .session-device-mark svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .session-item-copy { min-width: 0; }
  .session-item-copy strong, .session-item-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-item-copy strong { color: #4a554f; font-size: calc(10px * var(--text-scale)); font-weight: 640; }
  .session-item-copy small { margin-top: 3px; color: #919991; font-size: calc(8px * var(--text-scale)); }
  .session-item-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .terminate-session { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 76px; height: 28px; padding: 0 8px; color: #9b5b55; background: #fff; border: 1px solid #e3cbc8; border-radius: 7px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 650; transition: 120ms ease; }
  .terminate-session:hover:not(:disabled) { color: #8b423c; background: #fff7f6; border-color: #d5aaa6; }
  .terminate-session:disabled { cursor: default; opacity: 0.58; }
  .sessions-empty { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 58px; color: #8b958e; font-size: calc(9px * var(--text-scale)); }
  .sessions-error { margin-top: 12px; padding: 9px 11px; color: #954b46; background: #fbefed; border: 1px solid #ebd1ce; border-radius: 8px; font-size: calc(9px * var(--text-scale)); }

  .detail-card {
    min-width: 0;
    padding: 19px 20px;
    background: rgb(255 255 255 / 86%);
    border: 1px solid #dce1dc;
    border-radius: 13px;
    box-shadow: 0 8px 25px rgb(33 57 47 / 5%);
  }

  .detail-card > header {
    display: flex;
    align-items: center;
    gap: 11px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e3e7e3;
  }

  .detail-icon,
  .device-mark {
    display: grid;
    flex: none;
    width: 34px;
    height: 34px;
    color: #528676;
    background: #e8f0eb;
    border-radius: 9px;
    place-items: center;
  }

  .detail-icon svg { width: 18px; }
  .detail-card h2,
  .logout-card h2 { color: #2c3832; font-size: calc(12px * var(--text-scale)); font-weight: 670; }
  .detail-card header p { margin-top: 3px; color: #879089; font-size: calc(9px * var(--text-scale)); }

  dl { margin: 8px 0 0; }
  dl > div {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    min-height: 32px;
  }

  dt { color: #8a938d; font-size: calc(9px * var(--text-scale)); }
  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: #48534d;
    font-size: calc(10px * var(--text-scale));
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-id { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: calc(8px * var(--text-scale)); }
  .status-value { display: flex; align-items: center; gap: 7px; color: #397963; }
  .status-value i { width: 5px; height: 5px; }

  .session-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 70px;
    margin-top: 9px;
  }

  .device-mark { width: 36px; height: 36px; }
  .device-mark svg { width: 19px; }
  .session-row strong,
  .session-row small { display: block; }
  .session-row strong { color: #4a554f; font-size: calc(10px * var(--text-scale)); font-weight: 640; }
  .session-row small { margin-top: 4px; color: #919991; font-size: calc(8px * var(--text-scale)); }

  .current-session {
    padding: 5px 7px;
    color: #4a806f;
    background: #edf4f0;
    border-radius: 999px;
    font-size: calc(8px * var(--text-scale));
    font-weight: 680;
    text-transform: uppercase;
  }

  .public-storage-card {
    position: relative;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    min-height: 104px;
    margin-top: 16px;
    padding: 18px 20px;
    background: linear-gradient(135deg, rgb(233 244 239 / 92%), rgb(255 255 255 / 84%));
    border: 1px solid #cfe0d8;
    border-radius: 13px;
    box-shadow: 0 8px 25px rgb(33 57 47 / 4%);
  }

  .storage-icon {
    display: grid;
    width: 42px;
    height: 42px;
    color: #3f806c;
    background: rgb(255 255 255 / 76%);
    border: 1px solid #c9ddd4;
    border-radius: 11px;
    place-items: center;
  }

  .storage-list-button {
    position: absolute;
    top: 12px;
    right: 12px;
    display: grid;
    width: 27px;
    height: 27px;
    color: #4b806d;
    background: rgb(255 255 255 / 72%);
    border: 1px solid #cfe0d8;
    border-radius: 7px;
    cursor: pointer;
    place-items: center;
    transition: 120ms ease;
  }

  .storage-list-button:hover { color: #2d6652; background: #fff; border-color: #a9cbb8; }
  .storage-list-button svg { width: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }

  .storage-icon svg { width: 21px; }
  .storage-copy h2 { margin-top: 4px; color: #2c3d35; font-size: calc(13px * var(--text-scale)); font-weight: 680; }
  .storage-copy p { margin-top: 4px; color: #77867e; font-size: calc(9px * var(--text-scale)); }
  .storage-track { height: 5px; margin-top: 12px; overflow: hidden; background: #d9e6e0; border-radius: 99px; }
  .storage-track i { display: block; height: 100%; background: linear-gradient(90deg, #66ad93, #367a65); border-radius: inherit; }
  .storage-amount { min-width: 112px; text-align: right; }
  .storage-amount strong,
  .storage-amount span,
  .storage-amount small { display: block; }
  .storage-amount strong { color: #2e6655; font-size: calc(15px * var(--text-scale)); font-weight: 710; font-variant-numeric: tabular-nums; }
  .storage-amount span { margin-top: 2px; color: #839189; font-size: calc(9px * var(--text-scale)); }
  .storage-amount small { margin-top: 5px; color: #9a754e; font-size: calc(8px * var(--text-scale)); }
  .storage-loading { display: inline-flex; align-items: center; justify-content: flex-end; gap: 7px; color: #5a7b6d; font-size: calc(9px * var(--text-scale)); }
  .storage-loading :global(.library-loader) { border-color: #c6d9d0; border-top-color: #43836e; }

  .rondo-storage-subitem {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
    padding-top: 12px;
    border-top: 1px solid rgb(98 145 125 / 18%);
  }

  .rondo-subicon { display: grid; width: 30px; height: 30px; color: #5d8877; background: rgb(255 255 255 / 72%); border: 1px solid #cfe0d8; border-radius: 8px; place-items: center; }
  .rondo-subicon svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  .rondo-subcopy { min-width: 0; }
  .rondo-subcopy strong, .rondo-subcopy span { display: block; }
  .rondo-subcopy strong { color: #426b59; font-size: calc(9px * var(--text-scale)); font-weight: 700; }
  .rondo-subcopy span { margin-top: 2px; overflow: hidden; color: #84938b; font-size: calc(8px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .rondo-subtrack { height: 4px; margin-top: 7px; overflow: hidden; background: #d8e7df; border-radius: 99px; }
  .rondo-subtrack i { display: block; height: 100%; background: linear-gradient(90deg, #82bda4, #4b886f); border-radius: inherit; transition: width 180ms ease; }
  .rondo-subamount { min-width: 82px; text-align: right; }
  .rondo-subamount strong, .rondo-subamount span, .rondo-subamount small { display: block; }
  .rondo-subamount strong { color: #4a7965; font-size: calc(11px * var(--text-scale)); font-weight: 700; font-variant-numeric: tabular-nums; }
  .rondo-subamount span { margin-top: 2px; color: #8b9891; font-size: calc(8px * var(--text-scale)); }
  .rondo-subamount small { margin-top: 3px; color: #9a856b; font-size: calc(7px * var(--text-scale)); }
  .rondo-subamount :global(.library-loader) { margin-left: auto; border-color: #c6d9d0; border-top-color: #43836e; }

  .logout-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    min-height: 82px;
    margin-top: 16px;
    padding: 17px 20px;
    background: rgb(255 255 255 / 66%);
    border: 1px solid #dce1dc;
    border-radius: 13px;
  }

  .logout-card p { margin-top: 5px; color: #7e8881; font-size: calc(9px * var(--text-scale)); }

  .logout-card button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    flex: none;
    min-width: 105px;
    height: 34px;
    padding: 0 12px;
    color: #9b4843;
    background: #fff;
    border: 1px solid #e0c5c2;
    border-radius: 8px;
    cursor: pointer;
    font-size: calc(9px * var(--text-scale));
    font-weight: 660;
    transition: 120ms ease;
  }

  .logout-card button:hover:not(:disabled) { background: #fbf3f2; border-color: #d5aaa6; }
  .logout-card button:disabled { cursor: default; opacity: 0.65; }
  .logout-card button > svg { width: 16px; }
  .logout-card button :global(.library-loader) { border-color: #e2c9c6; border-top-color: #a4514b; }

  .profile-error {
    margin-top: 10px;
    padding: 9px 11px;
    color: #954b46;
    background: #fbefed;
    border: 1px solid #ebd1ce;
    border-radius: 8px;
    font-size: calc(9px * var(--text-scale));
  }

  @media (prefers-reduced-motion: reduce) {
    .logout-card button { transition: none; }
  }
</style>
