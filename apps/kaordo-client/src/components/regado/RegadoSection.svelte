<script lang="ts">
  import type { AdminUser, CloudflareUsage } from '../../lib/domain/admin';
  import type { RegadoSnapshot } from '../../lib/states/RegadoGState';
  import AdminUserActionDialog from './AdminUserActionDialog.svelte';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    onRefresh: () => void | Promise<void>;
    onRefreshCloudflare: () => void | Promise<void>;
    onRefreshDashboard: () => void | Promise<void>;
    onModerateUser: (userId: string, action: 'ban' | 'unban' | 'erase' | 'reset-seed') => void | Promise<void>;
    snapshot: Readonly<RegadoSnapshot>;
  };

  const EMPTY_CLOUDFLARE_USAGE: CloudflareUsage = {
    d1: { databaseCount: 0, queryLatencyP90Ms: 0, readQueriesToday: 0, responseBytesToday: 0, rowsReadToday: 0, rowsWrittenToday: 0, storageBytes: 0, writeQueriesToday: 0 },
    periods: { dailyResetAt: 0, monthlyStartedAt: 0 },
    r2: { bucketCount: 0, classAOperationsThisMonth: 0, classBOperationsThisMonth: 0, objectCount: 0, storageBytes: 0, unclassifiedOperationsThisMonth: 0 },
    sampledAt: 0,
    turn: { averageConcurrentConnections: 0, egressBytesThisMonth: 0, ingressBytesThisMonth: 0 },
    worker: { cpuTimeP50Ms: 0, cpuTimeP99Ms: 0, errorsToday: 0, requestsToday: 0, subrequestsToday: 0 },
  };

  let { onRefresh, onRefreshCloudflare, onRefreshDashboard, onModerateUser, snapshot }: Props = $props();
  let dashboard = $derived(snapshot.dashboard);
  let cloudflare = $derived(snapshot.cloudflare ?? EMPTY_CLOUDFLARE_USAGE);
  let cloudflareLoading = $derived(snapshot.cloudflarePhase === 'loading');
  let dashboardLoading = $derived(snapshot.dashboardLoading);
  let admins = $derived(dashboard?.users.filter((user) => user.role !== 'user').length ?? 0);
  let requestsPercent = $derived(percent(
    cloudflare.worker.requestsToday,
    dashboard?.capacity.worker.requestsDaily ?? 1,
  ));
  let action = $state<{ kind: 'ban' | 'erase' | 'reset-seed'; user: AdminUser } | null>(null);
  let actionError = $state<string | null>(null);
  let moderatingUserId = $state<string | null>(null);

  function compact(value: number): string {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function bytes(value: number | null): string {
    if (value === null) return 'Unavailable';
    if (value < 1_000) return `${Math.round(value)} B`;
    if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
    if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
    if (value < 1_000_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
    return `${(value / 1_000_000_000_000).toFixed(2)} TB`;
  }

  function relative(timestamp: number): string {
    if (!timestamp) return 'Never';
    const seconds = Math.max(0, Math.floor(Date.now() / 1_000 - timestamp));
    if (seconds < 60) return 'Just now';
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
    return `${Math.floor(seconds / 86_400)}d ago`;
  }

  function joined(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(timestamp * 1_000));
  }

  function roleLabel(role: AdminUser['role']): string {
    return role === 'superadmin' ? 'Superadmin' : role === 'admin' ? 'Admin' : 'Member';
  }

  function percent(used: number, limit: number): number {
    return Math.min(100, Math.max(0, used / Math.max(1, limit) * 100));
  }

  function decimal(value: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  }

  function resetTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
      .format(new Date(timestamp * 1_000));
  }

  function openAction(kind: 'ban' | 'erase' | 'reset-seed', user: AdminUser): void {
    actionError = null;
    action = { kind, user };
  }

  async function confirmAction(): Promise<void> {
    if (!action) return;
    const current = action;
    moderatingUserId = current.user.id;
    actionError = null;
    try {
      await onModerateUser(current.user.id, current.kind);
      action = null;
    } catch (error) {
      actionError = error instanceof Error && error.message.trim()
        ? error.message
        : 'The moderation action could not be completed.';
    } finally {
      moderatingUserId = null;
    }
  }

  async function unban(user: AdminUser): Promise<void> {
    moderatingUserId = user.id;
    actionError = null;
    try {
      await onModerateUser(user.id, 'unban');
    } catch (error) {
      actionError = error instanceof Error && error.message.trim()
        ? error.message
        : 'The account could not be unbanned.';
    } finally {
      moderatingUserId = null;
    }
  }

  function statusLabel(status: AdminUser['status']): string {
    return status === 'suspended' ? 'Banned' : status === 'erasing' ? 'Erasing…' : status;
  }
</script>

<main class="regado-shell" aria-labelledby="regado-title">
  <div class="regado-layout">
    <header class="regado-heading">
      <div>
        <span class="eyebrow">Administration</span>
        <h1 id="regado-title">Regado</h1>
        <p>Service capacity, storage health and account activity.</p>
      </div>
      <button class="refresh" type="button" disabled={snapshot.phase === 'loading' || cloudflareLoading || dashboardLoading} onclick={onRefresh}>
        {#if snapshot.phase === 'loading' || cloudflareLoading || dashboardLoading}<LoadingSpinner compact />{:else}<span aria-hidden="true">↻</span>{/if}
        Refresh
      </button>
    </header>

    {#if snapshot.error && !dashboard}
      <section class="error-card" role="alert">
        <strong>Regado could not load</strong>
        <p>{snapshot.error}</p>
        <button type="button" onclick={onRefresh}>Try again</button>
      </section>
    {:else if !dashboard}
      <section class="initial-loading" aria-label="Loading Regado" aria-busy="true">
        <div class="initial-field initial-field--wide"><span></span><i></i><b></b><div class="async-loader"><LoadingSpinner /></div></div>
        <div class="initial-field"><span></span><i></i><b></b><div class="async-loader"><LoadingSpinner /></div></div>
        <div class="initial-field"><span></span><i></i><b></b><div class="async-loader"><LoadingSpinner /></div></div>
        <div class="initial-field"><span></span><i></i><b></b><div class="async-loader"><LoadingSpinner /></div></div>
        <div class="initial-field initial-field--wide"><span></span><i></i><b></b><div class="async-loader"><LoadingSpinner /></div></div>
      </section>
    {:else}
      {#if snapshot.error}<p class="inline-error" role="alert">{snapshot.error}</p>{/if}

      <section class="overview" aria-labelledby="capacity-title">
        <header class="section-heading">
          <div><span class="section-number">01</span><h2 id="capacity-title">Cloudflare capacity</h2></div>
          <div class="section-actions">
            <span class="plan-badge">Free plan</span>
            <button
              class="field-refresh"
              type="button"
              title="Refresh Cloudflare usage"
              aria-label="Refresh Cloudflare usage"
              disabled={cloudflareLoading}
              onclick={onRefreshCloudflare}
            >
              {#if cloudflareLoading}<LoadingSpinner compact />{:else}<span aria-hidden="true">↻</span>{/if}
            </button>
          </div>
        </header>

        {#if snapshot.cloudflare || cloudflareLoading}
        <div class="summary-grid">
          <article class="storage-card" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading Worker request usage"><LoadingSpinner /></span>{/if}
            <div class="storage-ring" style={`--usage: ${requestsPercent * 3.6}deg`}>
              <div><strong>{requestsPercent.toFixed(1)}%</strong><span>used today</span></div>
            </div>
            <div class="storage-copy">
              <span>Worker requests</span>
              <strong>{compact(cloudflare.worker.requestsToday)} <small>of {compact(dashboard.capacity.worker.requestsDaily)}</small></strong>
              <p>Daily account usage · resets {resetTime(cloudflare.periods.dailyResetAt)}</p>
            </div>
          </article>
          <article class="health-card" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading telemetry status"><LoadingSpinner /></span>{/if}
            <span class="health-icon">↗</span><div><span>Cloudflare Analytics</span><strong>Live telemetry</strong><p>Sampled {relative(cloudflare.sampledAt)} · refreshes at most once per minute</p></div>
          </article>
        </div>

        <div class="quota-groups quota-groups--live">
          <article class="quota-panel usage-panel" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading Workers usage"><LoadingSpinner /></span>{/if}
            <header><span class="service-icon worker">W</span><div><h3>Workers</h3><p>Account usage today</p></div></header>
            <div class="usage-meters">
              <div class="usage-meter"><div><span>Requests</span><strong>{compact(cloudflare.worker.requestsToday)} / {compact(dashboard.capacity.worker.requestsDaily)}</strong></div><i><b style={`width:${percent(cloudflare.worker.requestsToday, dashboard.capacity.worker.requestsDaily)}%`}></b></i></div>
              <div class="mini-metrics">
                <span><strong>{compact(cloudflare.worker.errorsToday)}</strong> errors</span>
                <span><strong>{compact(cloudflare.worker.subrequestsToday)}</strong> subrequests</span>
                <span><strong>{decimal(cloudflare.worker.cpuTimeP50Ms)} ms</strong> CPU p50</span>
                <span><strong>{decimal(cloudflare.worker.cpuTimeP99Ms)} ms</strong> CPU p99</span>
              </div>
            </div>
            <div class="limit-strip"><span>{dashboard.capacity.worker.cpuMsPerRequest} ms CPU/request</span><span>{bytes(dashboard.capacity.worker.memoryBytes)} memory</span><span>{dashboard.capacity.worker.subrequestsPerRequest} subrequests/request</span></div>
          </article>
          <article class="quota-panel usage-panel" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading database usage"><LoadingSpinner /></span>{/if}
            <header><span class="service-icon d1">D1</span><div><h3>Database</h3><p>Daily operations and storage</p></div></header>
            <div class="usage-meters">
              <div class="usage-meter"><div><span>Rows read</span><strong>{compact(cloudflare.d1.rowsReadToday)} / {compact(dashboard.capacity.d1.rowsReadDaily)}</strong></div><i><b style={`width:${percent(cloudflare.d1.rowsReadToday, dashboard.capacity.d1.rowsReadDaily)}%`}></b></i></div>
              <div class="usage-meter"><div><span>Rows written</span><strong>{compact(cloudflare.d1.rowsWrittenToday)} / {compact(dashboard.capacity.d1.rowsWrittenDaily)}</strong></div><i><b style={`width:${percent(cloudflare.d1.rowsWrittenToday, dashboard.capacity.d1.rowsWrittenDaily)}%`}></b></i></div>
              <div class="usage-meter"><div><span>Account storage</span><strong>{bytes(cloudflare.d1.storageBytes)} / {bytes(dashboard.capacity.d1.accountStorageBytes)}</strong></div><i><b style={`width:${percent(cloudflare.d1.storageBytes, dashboard.capacity.d1.accountStorageBytes)}%`}></b></i></div>
            </div>
            <div class="limit-strip"><span>{cloudflare.d1.readQueriesToday} read queries</span><span>{cloudflare.d1.writeQueriesToday} writes</span><span>{decimal(cloudflare.d1.queryLatencyP90Ms)} ms p90</span></div>
          </article>
          <article class="quota-panel usage-panel r2-panel" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading object storage usage"><LoadingSpinner /></span>{/if}
            <header><span class="service-icon r2">R2</span><div><h3>Object storage</h3><p>Monthly included usage</p></div></header>
            <div class="usage-meters">
              <div class="usage-meter"><div><span>Storage</span><strong>{bytes(cloudflare.r2.storageBytes)} / {bytes(dashboard.capacity.r2.storageBytesMonthly)}</strong></div><i><b style={`width:${percent(cloudflare.r2.storageBytes, dashboard.capacity.r2.storageBytesMonthly)}%`}></b></i></div>
              <div class="usage-meter"><div><span>Class A operations</span><strong>{compact(cloudflare.r2.classAOperationsThisMonth)} / {compact(dashboard.capacity.r2.classAOperationsMonthly)}</strong></div><i><b style={`width:${percent(cloudflare.r2.classAOperationsThisMonth, dashboard.capacity.r2.classAOperationsMonthly)}%`}></b></i></div>
              <div class="usage-meter"><div><span>Class B operations</span><strong>{compact(cloudflare.r2.classBOperationsThisMonth)} / {compact(dashboard.capacity.r2.classBOperationsMonthly)}</strong></div><i><b style={`width:${percent(cloudflare.r2.classBOperationsThisMonth, dashboard.capacity.r2.classBOperationsMonthly)}%`}></b></i></div>
            </div>
            <div class="limit-strip"><span>{cloudflare.r2.bucketCount} buckets</span><span>{compact(cloudflare.r2.objectCount)} objects</span><span>Free egress</span></div>
          </article>
          <article class="quota-panel usage-panel turn-panel" class:metric-loading={cloudflareLoading} aria-busy={cloudflareLoading}>
            {#if cloudflareLoading}<span class="async-loader" aria-label="Loading TURN usage"><LoadingSpinner /></span>{/if}
            <header><span class="service-icon turn">T</span><div><h3>TURN relay</h3><p>Monthly Realtime bandwidth</p></div></header>
            <div class="usage-meters">
              <div class="usage-meter"><div><span>Billable egress</span><strong>{bytes(cloudflare.turn.egressBytesThisMonth)} / {bytes(dashboard.capacity.turn.egressBytesMonthly)}</strong></div><i><b style={`width:${percent(cloudflare.turn.egressBytesThisMonth, dashboard.capacity.turn.egressBytesMonthly)}%`}></b></i></div>
              <div class="turn-balance">
                <div><strong>{bytes(Math.max(0, dashboard.capacity.turn.egressBytesMonthly - cloudflare.turn.egressBytesThisMonth))}</strong><span>free egress left</span></div>
                <div><strong>{bytes(cloudflare.turn.ingressBytesThisMonth)}</strong><span>free ingress</span></div>
              </div>
            </div>
            <div class="limit-strip"><span>{percent(cloudflare.turn.egressBytesThisMonth, dashboard.capacity.turn.egressBytesMonthly).toFixed(3)}% used</span><span>{decimal(cloudflare.turn.averageConcurrentConnections)} avg connections</span><span>${dashboard.capacity.turn.overageUsdPerGb.toFixed(2)}/GB after free tier</span></div>
          </article>
          <article class="quota-panel limits-panel">
            <header><span class="service-icon limits">∞</span><div><h3>Runtime ceilings</h3><p>Additional Free plan limits</p></div></header>
            <div class="metric-grid">
              <div><strong>{dashboard.capacity.worker.scripts}</strong><span>Worker scripts</span></div>
              <div><strong>{dashboard.capacity.worker.cronTriggers}</strong><span>Cron triggers</span></div>
              <div><strong>{bytes(dashboard.capacity.worker.workerBytes)}</strong><span>Worker size</span></div>
              <div><strong>{dashboard.capacity.worker.startupMs} ms</strong><span>Startup time</span></div>
              <div><strong>{dashboard.capacity.d1.databases}</strong><span>D1 databases</span></div>
              <div><strong>{dashboard.capacity.d1.timeTravelDays} days</strong><span>Time Travel</span></div>
            </div>
          </article>
        </div>
        <p class="capacity-note"><span aria-hidden="true">i</span> Live account analytics are visible only to the immutable root superadmin. Daily limits reset at 00:00 UTC; R2 and Realtime included usage reset monthly.</p>
        {:else}
          <div class="analytics-unavailable"><span>!</span><div><strong>Live Cloudflare analytics unavailable</strong><p>{snapshot.cloudflareError ?? 'Static plan ceilings remain available, but this account cannot access the protected telemetry.'}</p></div></div>
        {/if}
      </section>

      <section class="users-section" class:metric-loading={dashboardLoading} aria-busy={dashboardLoading} aria-labelledby="users-title">
        {#if dashboardLoading}<span class="async-loader" aria-label="Loading users and account data"><LoadingSpinner /></span>{/if}
        <header class="section-heading">
          <div><span class="section-number">02</span><h2 id="users-title">Users</h2></div>
          <div class="section-actions">
            <span class="live-label"><i></i> Live presence</span>
            <button
              class="field-refresh"
              type="button"
              title="Refresh users"
              aria-label="Refresh users"
              disabled={dashboardLoading}
              onclick={onRefreshDashboard}
            >
              {#if dashboardLoading}<LoadingSpinner compact />{:else}<span aria-hidden="true">↻</span>{/if}
            </button>
          </div>
        </header>
        <div class="stat-row">
          <article><span>Accounts</span><strong>{dashboard.usage.totalUsers}</strong><small>registered</small></article>
          <article><span>Online now</span><strong class="green">{dashboard.usage.onlineUsers}</strong><small>application open now</small></article>
          <article><span>Sessions</span><strong>{dashboard.usage.activeSessions}</strong><small>active keys</small></article>
          <article><span>Administrators</span><strong>{admins}</strong><small>privileged</small></article>
        </div>
        <div class="users-table" role="table" aria-label="Registered users">
          <div class="table-head" role="row"><span>User</span><span>Role</span><span>Status</span><span>Last seen</span><span>Joined</span><span>Sessions</span><span>Actions</span></div>
          {#each dashboard.users as user (user.id)}
            <div class="user-row" role="row">
              <span class="user-cell"><span class="avatar">{user.username.slice(0, 1).toUpperCase()}</span><span><strong>{user.username}</strong><small>{user.id.slice(0, 10)}…</small></span></span>
              <span><mark class:superadmin={user.role === 'superadmin'}>{roleLabel(user.role)}</mark></span>
              <span class="presence" class:online={user.online} class:banned={user.status === 'suspended' || user.status === 'erasing'}><i></i>{user.online ? 'Online' : statusLabel(user.status)}</span>
              <span>{relative(user.lastSeenAt)}</span>
              <span>{joined(user.createdAt)}</span>
              <span class="sessions">{user.activeSessions}</span>
              <span class="user-actions">
                {#if user.role !== 'superadmin' && user.status !== 'erasing'}
                  {#if user.status === 'suspended'}
                    <button type="button" class="small-action" disabled={moderatingUserId !== null} onclick={() => void unban(user)}>Unban</button>
                  {:else}
                    <button type="button" class="small-action" disabled={moderatingUserId !== null} onclick={() => openAction('ban', user)}>Ban</button>
                  {/if}
                  <button type="button" class="small-action" disabled={moderatingUserId !== null} onclick={() => openAction('reset-seed', user)}>Reset seed</button>
                  <button type="button" class="small-action small-action--danger" disabled={moderatingUserId !== null} onclick={() => openAction('erase', user)}>Erase</button>
                {:else if user.status === 'erasing'}
                  <span class="erase-progress">Queued</span>
                {:else}
                  <span class="protected">Protected</span>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</main>

{#if action}
  <AdminUserActionDialog
    action={action.kind}
    busy={moderatingUserId === action.user.id}
    error={actionError}
    onCancel={() => { if (!moderatingUserId) action = null; }}
    onConfirm={confirmAction}
    username={action.user.username}
  />
{/if}

<style>
  .regado-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-light: transparent;
    --sui-shadow-dark: var(--sui-shadow-color);
    --sui-shadow-raised: 5px 5px 14px var(--sui-shadow-color);
    --sui-shadow-raised-sm: 3px 3px 8px var(--sui-shadow-color);
    --sui-shadow-raised-lg: 12px 14px 30px var(--sui-shadow-color);
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-color);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-color);
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #c95667;
    --sui-warning: #b7793e;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-danger-bg: color-mix(in srgb, var(--sui-danger) 8%, var(--sui-bg));
    --sui-warning-bg: color-mix(in srgb, var(--sui-warning) 9%, var(--sui-bg));
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: var(--sui-text);
    background:
      radial-gradient(circle at 76% -6%, rgb(91 84 224 / 8%), transparent 34%),
      var(--sui-bg);
  }

  .regado-layout { width: min(100%, 1080px); margin: 0 auto; padding: 25px 30px 48px; }
  .regado-heading, .section-heading, .quota-panel header, .health-card, .storage-card { display: flex; align-items: center; }
  .regado-heading {
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 18px;
    padding: 16px 18px;
    background: var(--sui-bg);
    border-radius: 21px;
    box-shadow: var(--sui-shadow-raised);
  }
  .eyebrow { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  h1 { margin-top: 3px; color: var(--sui-text); font-size: calc(26px * var(--text-scale)); line-height: 1; letter-spacing: -.045em; }
  .regado-heading p { margin-top: 6px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }
  button { font: inherit; }
  .refresh, .error-card button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-width: 88px;
    height: 37px;
    padding: 0 13px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 12px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font-size: calc(9px * var(--text-scale));
    font-weight: 720;
    transition: color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  }
  .refresh:hover:not(:disabled), .error-card button:hover { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .refresh:active:not(:disabled), .error-card button:active { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .refresh:disabled { cursor: wait; opacity: .62; }
  .initial-loading { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
  .initial-field {
    position: relative;
    min-height: 148px;
    padding: 20px;
    overflow: hidden;
    background: var(--sui-bg);
    border-radius: 16px;
    box-shadow: var(--sui-shadow-raised);
  }
  .initial-field--wide { grid-column: 1 / -1; min-height: 116px; }
  .initial-field > :not(.async-loader) { display: block; filter: blur(5px); opacity: .55; }
  .initial-field > span { width: 34%; height: 17px; background: var(--sui-bg-dark); border-radius: 5px; }
  .initial-field > i { width: 82%; height: 8px; margin-top: 28px; background: color-mix(in srgb, var(--sui-text) 10%, var(--sui-bg)); border-radius: 999px; }
  .initial-field > b { width: 58%; height: 8px; margin-top: 13px; background: color-mix(in srgb, var(--sui-text) 6%, var(--sui-bg)); border-radius: 999px; }
  .metric-loading { position: relative; overflow: hidden; }
  .metric-loading > :not(.async-loader) { filter: blur(5px); opacity: .52; pointer-events: none; user-select: none; }
  .async-loader { position: absolute; z-index: 5; inset: 0; display: grid; place-items: center; color: var(--sui-primary); }
  .regado-shell :global(.library-loader) { border-color: color-mix(in srgb, var(--sui-text) 18%, transparent); border-top-color: var(--sui-primary); }

  .overview, .users-section {
    padding: 22px;
    background: var(--sui-bg);
    border-radius: 20px;
    box-shadow: var(--sui-shadow-raised-lg);
  }
  .users-section { margin-top: 18px; }
  .section-heading { justify-content: space-between; gap: 14px; margin-bottom: 17px; }
  .section-heading > div { display: flex; align-items: center; gap: 9px; }
  .section-actions { display: flex; align-items: center; gap: 8px; }
  .field-refresh {
    display: grid;
    width: 29px;
    height: 29px;
    padding: 0;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 9px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font-size: calc(14px * var(--text-scale));
    line-height: 1;
    place-items: center;
    transition: color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  }
  .field-refresh:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .field-refresh:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .field-refresh:disabled { cursor: wait; opacity: .62; }
  .field-refresh :global(.library-loader) { width: 13px; height: 13px; border-width: 1.5px; }
  .section-heading h2 { color: var(--sui-text); font-size: calc(15px * var(--text-scale)); letter-spacing: -.02em; }
  .section-number { color: var(--sui-primary); font-family: ui-monospace, monospace; font-size: calc(9px * var(--text-scale)); font-weight: 700; }
  .plan-badge, .live-label {
    padding: 5px 8px;
    color: var(--sui-text-light);
    background: var(--sui-bg);
    border: 0;
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(8px * var(--text-scale));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
  }
  .live-label { display: flex; align-items: center; gap: 6px; }
  .live-label i { width: 6px; height: 6px; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-success) 14%, transparent); }

  .summary-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 11px; }
  .storage-card, .health-card {
    position: relative;
    gap: 16px;
    min-height: 126px;
    padding: 17px;
    border-radius: 17px;
    box-shadow: var(--sui-shadow-raised);
  }
  .storage-card {
    --summary-accent: var(--sui-primary);
    color: var(--sui-text);
    background: linear-gradient(145deg, color-mix(in srgb, var(--sui-primary) 16%, var(--sui-bg-light)), var(--sui-bg));
  }
  .health-card {
    --summary-accent: var(--sui-success);
    color: var(--sui-text);
    background: linear-gradient(145deg, color-mix(in srgb, var(--sui-success) 12%, var(--sui-bg-light)), var(--sui-bg));
  }
  .storage-ring {
    display: grid;
    width: 82px;
    height: 82px;
    flex: none;
    background: conic-gradient(var(--summary-accent) var(--usage), color-mix(in srgb, var(--sui-text) 13%, transparent) 0);
    border-radius: 50%;
    box-shadow: var(--sui-shadow-raised-sm);
    place-items: center;
  }
  .storage-ring::before { content: ''; grid-area: 1/1; width: 66px; height: 66px; background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-inset-sm); }
  .storage-ring div { z-index: 1; grid-area: 1/1; text-align: center; }
  .storage-ring strong, .storage-ring span { display: block; }
  .storage-ring strong { color: var(--sui-text); font-size: calc(15px * var(--text-scale)); }
  .storage-ring span { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); text-transform: uppercase; }
  .storage-copy, .health-card > div { min-width: 0; }
  .storage-copy > span, .health-card div > span { color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .storage-copy strong, .health-card strong { display: block; margin-top: 5px; color: var(--sui-text); font-size: calc(18px * var(--text-scale)); letter-spacing: -.03em; }
  .storage-copy small { color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); font-weight: 520; }
  .storage-copy p, .health-card p { margin-top: 5px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.4; }
  .health-icon { display: grid; width: 37px; height: 37px; flex: none; color: var(--sui-success); background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(16px * var(--text-scale)); place-items: center; }

  .quota-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-top: 11px; }
  .quota-panel { padding: 16px; color: var(--sui-text); background: var(--sui-bg); border-radius: 17px; box-shadow: var(--sui-shadow-raised); }
  .quota-panel header { gap: 10px; padding-bottom: 13px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text) 12%, transparent); }
  .service-icon {
    --service-accent: var(--sui-warning);
    display: grid;
    width: 30px;
    height: 30px;
    flex: none;
    color: color-mix(in srgb, var(--service-accent) 82%, var(--sui-text));
    background: color-mix(in srgb, var(--service-accent) 13%, var(--sui-bg));
    border-radius: 10px;
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(10px * var(--text-scale));
    font-weight: 800;
    place-items: center;
  }
  .service-icon.worker { --service-accent: var(--sui-primary); }
  .service-icon.d1, .service-icon.turn { --service-accent: #4e8fc5; }
  .service-icon.r2 { --service-accent: #b06d4f; }
  .service-icon.limits { --service-accent: #766bb4; font-size: calc(14px * var(--text-scale)); }
  .quota-panel h3 { color: var(--sui-text); font-size: calc(11px * var(--text-scale)); }
  .quota-panel header p { margin-top: 2px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px; padding-top: 14px; }
  .metric-grid strong, .metric-grid span { display: block; }
  .metric-grid strong { color: var(--sui-text); font-size: calc(14px * var(--text-scale)); letter-spacing: -.02em; }
  .metric-grid span { margin-top: 3px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); text-transform: uppercase; letter-spacing: .06em; }
  .usage-meters { display: grid; gap: 12px; padding-top: 14px; }
  .usage-meter > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .usage-meter span { color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .usage-meter strong { color: var(--sui-text); font-size: calc(9px * var(--text-scale)); }
  .usage-meter > i { display: block; height: 6px; margin-top: 6px; overflow: hidden; background: color-mix(in srgb, var(--sui-text) 11%, transparent); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .usage-meter > i > b { display: block; min-width: 2px; height: 100%; background: linear-gradient(90deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 55%, var(--sui-success))); border-radius: inherit; transition: width 260ms ease; }
  .mini-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mini-metrics span { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .mini-metrics strong { display: block; margin-bottom: 2px; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); }
  .limit-strip { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 13px; padding-top: 11px; color: var(--sui-text-light); border-top: 1px solid color-mix(in srgb, var(--sui-text) 11%, transparent); font-size: calc(7px * var(--text-scale)); }
  .r2-panel .usage-meter > i > b { background: linear-gradient(90deg, #a8654d, #cf987d); }
  .turn-panel .usage-meter > i > b { background: linear-gradient(90deg, #4e82ad, #73b3d0); }
  .turn-balance { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .turn-balance div { padding: 9px; background: color-mix(in srgb, #4e8fc5 7%, var(--sui-bg)); border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); }
  .turn-balance strong, .turn-balance span { display: block; }
  .turn-balance strong { color: var(--sui-text); font-size: calc(11px * var(--text-scale)); }
  .turn-balance span { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); text-transform: uppercase; letter-spacing: .05em; }
  .limits-panel .metric-grid { grid-template-columns: repeat(3, 1fr); }
  .analytics-unavailable { display: flex; align-items: center; gap: 12px; min-height: 92px; padding: 18px; color: var(--sui-text-muted); background: var(--sui-warning-bg); border-radius: 15px; box-shadow: var(--sui-shadow-inset-sm); }
  .analytics-unavailable > span { display: grid; width: 30px; height: 30px; flex: none; color: var(--sui-warning); background: var(--sui-bg); border-radius: 9px; box-shadow: var(--sui-shadow-raised-sm); font-weight: 750; place-items: center; }
  .analytics-unavailable strong { display: block; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); }
  .analytics-unavailable p { margin-top: 4px; font-size: calc(8px * var(--text-scale)); line-height: 1.45; }
  .capacity-note { display: flex; align-items: center; gap: 7px; margin: 12px 2px 0; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); line-height: 1.4; }
  .capacity-note span { display: grid; width: 17px; height: 17px; flex: none; color: var(--sui-primary); background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }

  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 13px; }
  .stat-row article { padding: 12px 13px; background: var(--sui-bg); border-radius: 13px; box-shadow: var(--sui-shadow-raised-sm); }
  .stat-row span, .stat-row strong, .stat-row small { display: block; }
  .stat-row span { color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .stat-row strong { margin-top: 5px; color: var(--sui-text); font-size: calc(18px * var(--text-scale)); }
  .stat-row strong.green { color: var(--sui-success); }
  .stat-row small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .users-table { overflow: hidden; border-radius: 14px; box-shadow: var(--sui-shadow-inset-sm); }
  .table-head, .user-row { display: grid; grid-template-columns: minmax(160px, 1.6fr) .8fr .8fr .8fr 1fr .45fr 1.2fr; align-items: center; gap: 9px; padding: 0 13px; }
  .table-head { height: 31px; color: var(--sui-text-light); background: var(--sui-bg-dark); font-size: calc(7px * var(--text-scale)); font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
  .user-row { min-height: 53px; color: var(--sui-text-muted); border-top: 1px solid color-mix(in srgb, var(--sui-text) 10%, transparent); font-size: calc(8px * var(--text-scale)); }
  .user-row:hover { background: color-mix(in srgb, var(--sui-primary) 4%, transparent); }
  .user-cell { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .avatar { display: grid; width: 29px; height: 29px; flex: none; color: var(--sui-primary); background: linear-gradient(145deg, color-mix(in srgb, var(--sui-primary) 16%, var(--sui-bg-light)), color-mix(in srgb, var(--sui-primary) 20%, var(--sui-bg-dark))); border-radius: 10px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(10px * var(--text-scale)); font-weight: 730; place-items: center; }
  .user-cell strong, .user-cell small { display: block; }
  .user-cell strong { color: var(--sui-text); font-size: calc(9px * var(--text-scale)); }
  .user-cell small { margin-top: 2px; color: var(--sui-text-light); font-family: ui-monospace, monospace; font-size: calc(6px * var(--text-scale)); }
  mark { padding: 4px 6px; color: var(--sui-text-muted); background: var(--sui-bg); border-radius: 6px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  mark.superadmin { color: var(--sui-warning); background: color-mix(in srgb, var(--sui-warning) 12%, var(--sui-bg)); }
  .presence { display: flex; align-items: center; gap: 5px; color: var(--sui-text-light); text-transform: capitalize; }
  .presence i { width: 5px; height: 5px; background: var(--sui-text-light); border-radius: 50%; }
  .presence.online { color: var(--sui-success); }
  .presence.online i { background: var(--sui-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-success) 13%, transparent); }
  .presence.banned { color: var(--sui-danger); }
  .presence.banned i { background: var(--sui-danger); }
  .sessions { justify-self: center; color: var(--sui-text); font-weight: 700; }
  .user-actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
  .small-action {
    min-height: 27px;
    padding: 0 8px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 8px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font-size: calc(7px * var(--text-scale));
    font-weight: 700;
    transition: color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  }
  .small-action:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .small-action:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .small-action--danger { color: var(--sui-danger); }
  .small-action:disabled { cursor: wait; opacity: .55; }
  .erase-progress { color: var(--sui-warning); font-size: calc(7px * var(--text-scale)); }
  .protected { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .error-card { display: grid; min-height: 220px; padding: 30px; background: var(--sui-bg); border-radius: 20px; box-shadow: var(--sui-shadow-raised-lg); place-items: center; align-content: center; gap: 10px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); text-align: center; }
  .error-card strong { color: var(--sui-text); font-size: calc(14px * var(--text-scale)); }
  .error-card p { margin-bottom: 5px; }
  .inline-error { margin-bottom: 12px; padding: 11px 14px; color: var(--sui-danger); background: var(--sui-danger-bg); border-radius: 13px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); }

  :global(html[data-theme='dark']) .regado-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-dark: var(--sui-shadow-color);
    --sui-shadow-raised: 6px 7px 16px var(--sui-shadow-color);
    --sui-shadow-raised-sm: 3px 4px 9px var(--sui-shadow-color);
    --sui-shadow-raised-lg: 12px 15px 30px var(--sui-shadow-color);
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-color);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-color);
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-warning: #e0b477;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-danger-bg: #38272d;
    --sui-warning-bg: #342d25;
    color: var(--sui-text) !important;
    background: var(--sui-bg) !important;
  }
  :global(html[data-theme='dark']) .regado-shell :is(.regado-heading, .overview, .users-section, .quota-panel, .stat-row article, .error-card, .initial-field) {
    color: var(--sui-text) !important;
    background: var(--sui-bg) !important;
    border-color: transparent !important;
    box-shadow: var(--sui-shadow-raised) !important;
  }
  :global(html[data-theme='dark']) .regado-shell :is(.storage-card, .health-card) {
    color: var(--sui-text) !important;
    border-color: transparent !important;
    box-shadow: var(--sui-shadow-raised) !important;
  }
  :global(html[data-theme='dark']) .regado-shell .storage-card { background: linear-gradient(145deg, color-mix(in srgb, var(--sui-primary) 18%, var(--sui-bg-light)), var(--sui-bg)) !important; }
  :global(html[data-theme='dark']) .regado-shell .health-card { background: linear-gradient(145deg, color-mix(in srgb, var(--sui-success) 14%, var(--sui-bg-light)), var(--sui-bg)) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.storage-ring::before, .health-icon, .field-refresh, .refresh, .error-card button, .small-action, .capacity-note span, .analytics-unavailable > span) {
    color: var(--sui-primary) !important;
    background: var(--sui-bg) !important;
    border-color: transparent !important;
  }
  :global(html[data-theme='dark']) .regado-shell .storage-ring::before { box-shadow: var(--sui-shadow-inset-sm) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.table-head, .users-table) { border-color: transparent !important; }
  :global(html[data-theme='dark']) .regado-shell .users-table { background: var(--sui-bg-dark) !important; box-shadow: var(--sui-shadow-inset-sm) !important; }
  :global(html[data-theme='dark']) .regado-shell .table-head { color: var(--sui-text-light) !important; background: var(--sui-bg-dark) !important; }
  :global(html[data-theme='dark']) .regado-shell .user-row { color: var(--sui-text-muted) !important; background: transparent !important; border-color: color-mix(in srgb, var(--sui-text) 12%, transparent) !important; }
  :global(html[data-theme='dark']) .regado-shell .user-row:hover { background: color-mix(in srgb, var(--sui-primary) 8%, transparent) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(h1, .section-heading h2, .quota-panel h3, .storage-copy strong, .health-card strong, .metric-grid strong, .usage-meter strong, .mini-metrics strong, .stat-row strong, .user-cell strong, .sessions, .error-card strong, .analytics-unavailable strong) { color: var(--sui-text) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.regado-heading p, .quota-panel header p, .storage-copy p, .storage-copy small, .health-card p, .metric-grid span, .usage-meter span, .mini-metrics span, .limit-strip, .capacity-note, .stat-row span, .stat-row small, .user-cell small, .protected, .user-row > span:not(.user-cell):not(.user-actions)) { color: var(--sui-text-muted) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.section-number, .eyebrow, .storage-ring strong, .health-icon, .field-refresh, .refresh) { color: var(--sui-primary) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.storage-ring span, .storage-copy > span, .health-card div > span, .section-number, .plan-badge, .live-label) { color: var(--sui-text-light) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.plan-badge, .live-label) { background: var(--sui-bg) !important; box-shadow: var(--sui-shadow-inset-sm) !important; }
  :global(html[data-theme='dark']) .regado-shell .quota-panel header { border-color: color-mix(in srgb, var(--sui-text) 14%, transparent) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.limit-strip, .user-row) { border-color: color-mix(in srgb, var(--sui-text) 12%, transparent) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.usage-meter > i, .initial-field > i, .initial-field > b) { background: color-mix(in srgb, var(--sui-text) 14%, transparent) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.turn-balance div, mark, .avatar) { color: var(--sui-text) !important; background: var(--sui-bg-light) !important; border-color: transparent !important; }
  :global(html[data-theme='dark']) .regado-shell mark.superadmin { color: var(--sui-warning) !important; background: color-mix(in srgb, var(--sui-warning) 14%, var(--sui-bg)) !important; }
  :global(html[data-theme='dark']) .regado-shell .small-action { color: var(--sui-primary) !important; box-shadow: var(--sui-shadow-raised-sm) !important; }
  :global(html[data-theme='dark']) .regado-shell .small-action--danger { color: var(--sui-danger) !important; }
  :global(html[data-theme='dark']) .regado-shell :is(.presence.online, .live-label i) { color: var(--sui-success) !important; }
  :global(html[data-theme='dark']) .regado-shell .presence.online i { background: var(--sui-success) !important; }
  :global(html[data-theme='dark']) .regado-shell .presence.banned { color: var(--sui-danger) !important; }
  :global(html[data-theme='dark']) .regado-shell .presence.banned i { background: var(--sui-danger) !important; }
  :global(html[data-theme='dark']) .regado-shell .analytics-unavailable { color: var(--sui-text-muted) !important; background: var(--sui-warning-bg) !important; box-shadow: var(--sui-shadow-inset-sm) !important; }
  :global(html[data-theme='dark']) .regado-shell .inline-error { color: var(--sui-danger) !important; background: var(--sui-danger-bg) !important; }

  @media (max-width: 850px) {
    .initial-loading, .summary-grid, .quota-groups { grid-template-columns: 1fr; }
    .initial-field--wide { grid-column: auto; }
    .table-head, .user-row { grid-template-columns: minmax(140px, 1.5fr) .8fr .8fr .8fr 1.2fr; }
    .table-head span:nth-child(5), .table-head span:nth-child(6), .user-row > span:nth-child(5), .user-row > span:nth-child(6) { display: none; }
  }
  @media (max-width: 620px) {
    .regado-layout { padding: 14px 12px 34px; }
    .regado-heading { align-items: flex-start; flex-direction: column; padding: 14px; border-radius: 17px; }
    .refresh { align-self: stretch; }
    .overview, .users-section { padding: 15px; border-radius: 17px; }
    .section-heading { align-items: flex-start; flex-direction: column; }
    .section-actions { align-self: stretch; justify-content: flex-end; }
    .storage-card, .health-card { align-items: flex-start; flex-direction: column; gap: 12px; }
    .storage-ring { width: 70px; height: 70px; }
    .storage-ring::before { width: 56px; height: 56px; }
    .stat-row { grid-template-columns: 1fr 1fr; }
    .users-table { overflow-x: auto; }
    .table-head, .user-row { min-width: 640px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .regado-shell *, .regado-shell *::before, .regado-shell *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: .01ms !important;
    }
  }
</style>
