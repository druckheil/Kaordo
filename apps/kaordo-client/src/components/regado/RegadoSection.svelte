<script lang="ts">
  import type { AdminUser, CloudflareUsage } from '../../lib/domain/admin';
  import type { RegadoSnapshot } from '../../lib/states/RegadoGState';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    onRefresh: () => void | Promise<void>;
    onRefreshCloudflare: () => void | Promise<void>;
    onRefreshDashboard: () => void | Promise<void>;
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

  let { onRefresh, onRefreshCloudflare, onRefreshDashboard, snapshot }: Props = $props();
  let dashboard = $derived(snapshot.dashboard);
  let cloudflare = $derived(snapshot.cloudflare ?? EMPTY_CLOUDFLARE_USAGE);
  let cloudflareLoading = $derived(snapshot.cloudflarePhase === 'loading');
  let dashboardLoading = $derived(snapshot.dashboardLoading);
  let admins = $derived(dashboard?.users.filter((user) => user.role !== 'user').length ?? 0);
  let requestsPercent = $derived(percent(
    cloudflare.worker.requestsToday,
    dashboard?.capacity.worker.requestsDaily ?? 1,
  ));

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
          <div class="table-head" role="row"><span>User</span><span>Role</span><span>Status</span><span>Last seen</span><span>Joined</span><span>Sessions</span></div>
          {#each dashboard.users as user (user.id)}
            <div class="user-row" role="row">
              <span class="user-cell"><span class="avatar">{user.username.slice(0, 1).toUpperCase()}</span><span><strong>{user.username}</strong><small>{user.id.slice(0, 10)}…</small></span></span>
              <span><mark class:superadmin={user.role === 'superadmin'}>{roleLabel(user.role)}</mark></span>
              <span class="presence" class:online={user.online}><i></i>{user.online ? 'Online' : user.status}</span>
              <span>{relative(user.lastSeenAt)}</span>
              <span>{joined(user.createdAt)}</span>
              <span class="sessions">{user.activeSessions}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</main>

<style>
  .regado-shell { min-width: 0; min-height: 0; overflow: auto; color: #26332d; background: radial-gradient(circle at 74% 0%, rgb(72 143 119 / 10%), transparent 31%), #f3f6f2; }
  .regado-layout { width: min(100%, 1080px); margin: 0 auto; padding: 31px 34px 64px; }
  .regado-heading, .section-heading, .quota-panel header, .health-card, .storage-card { display: flex; align-items: center; }
  .regado-heading { justify-content: space-between; margin-bottom: 26px; padding: 0 2px; }
  .eyebrow { color: #4d826e; font-size: calc(9px * var(--text-scale)); font-weight: 750; letter-spacing: .15em; text-transform: uppercase; }
  h1 { margin-top: 5px; color: #1f2d27; font-size: calc(29px * var(--text-scale)); line-height: 1; letter-spacing: -.045em; }
  .regado-heading p { margin-top: 8px; color: #768078; font-size: calc(11px * var(--text-scale)); }
  .refresh, .error-card button { display: inline-flex; align-items: center; gap: 7px; height: 31px; padding: 0 11px; color: #345c4e; background: #fff; border: 1px solid #d5ded8; border-radius: 8px; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 650; box-shadow: 0 2px 7px rgb(39 65 54 / 5%); }
  .refresh:disabled { cursor: wait; opacity: .7; }
  .initial-loading { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
  .initial-field { position: relative; min-height: 148px; padding: 20px; overflow: hidden; background: #fff; border: 1px solid #dce3de; border-radius: 16px; box-shadow: 0 12px 32px rgb(45 72 61 / 6%); }
  .initial-field--wide { grid-column: 1 / -1; min-height: 116px; }
  .initial-field > :not(.async-loader) { display: block; filter: blur(5px); opacity: .55; }
  .initial-field > span { width: 34%; height: 17px; background: #cbd8d1; border-radius: 5px; }
  .initial-field > i { width: 82%; height: 8px; margin-top: 28px; background: #dce5e0; border-radius: 999px; }
  .initial-field > b { width: 58%; height: 8px; margin-top: 13px; background: #e5ebe7; border-radius: 999px; }
  .metric-loading { position: relative; overflow: hidden; }
  .metric-loading > :not(.async-loader) { filter: blur(5px); opacity: .52; pointer-events: none; user-select: none; }
  .async-loader { position: absolute; z-index: 5; inset: 0; display: grid; place-items: center; color: #4c7967; }
  .overview, .users-section { padding: 22px; background: rgb(255 255 255 / 78%); border: 1px solid #dce3de; border-radius: 16px; box-shadow: 0 12px 32px rgb(45 72 61 / 6%); }
  .users-section { margin-top: 18px; }
  .section-heading { justify-content: space-between; margin-bottom: 17px; }
  .section-heading > div { display: flex; align-items: center; gap: 9px; }
  .section-actions { display: flex; align-items: center; gap: 8px; }
  .field-refresh { display: grid; width: 25px; height: 25px; padding: 0; color: #4a806d; background: #fff; border: 1px solid #d5e0d9; border-radius: 7px; cursor: pointer; font-size: calc(14px * var(--text-scale)); line-height: 1; place-items: center; }
  .field-refresh:hover:not(:disabled) { color: #2c6653; background: #f1f7f3; border-color: #bdd3c7; }
  .field-refresh:disabled { cursor: wait; opacity: .65; }
  .field-refresh :global(.library-loader) { width: 13px; height: 13px; border-width: 1.5px; }
  .section-heading h2 { color: #24332c; font-size: calc(15px * var(--text-scale)); letter-spacing: -.02em; }
  .section-number { color: #7da997; font-family: ui-monospace, monospace; font-size: calc(9px * var(--text-scale)); }
  .plan-badge, .live-label { padding: 5px 8px; color: #567168; background: #f1f5f2; border: 1px solid #dde5df; border-radius: 999px; font-size: calc(8px * var(--text-scale)); font-weight: 690; text-transform: uppercase; letter-spacing: .07em; }
  .live-label { display: flex; align-items: center; gap: 6px; }
  .live-label i { width: 6px; height: 6px; background: #4da67f; border-radius: 50%; box-shadow: 0 0 0 3px rgb(77 166 127 / 12%); }
  .summary-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 11px; }
  .storage-card, .health-card { gap: 16px; min-height: 126px; padding: 17px; color: #edf8f2; background: linear-gradient(135deg, #20372e, #29473c); border-radius: 13px; }
  .health-card { background: linear-gradient(135deg, #eef5f1, #e4eee8); color: #2e443a; }
  .storage-ring { display: grid; width: 82px; height: 82px; flex: none; border-radius: 50%; background: conic-gradient(#79c5a5 var(--usage), rgb(255 255 255 / 10%) 0); place-items: center; }
  .storage-ring::before { content: ''; grid-area: 1/1; width: 66px; height: 66px; background: #263f35; border-radius: 50%; }
  .storage-ring div { z-index: 1; grid-area: 1/1; text-align: center; }
  .storage-ring strong, .storage-ring span { display: block; }
  .storage-ring strong { font-size: calc(15px * var(--text-scale)); } .storage-ring span { margin-top: 2px; color: #9fc7b7; font-size: calc(7px * var(--text-scale)); text-transform: uppercase; }
  .storage-copy > span, .health-card div > span { color: #99bcad; font-size: calc(8px * var(--text-scale)); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .storage-copy strong, .health-card strong { display: block; margin-top: 5px; font-size: calc(18px * var(--text-scale)); letter-spacing: -.03em; }
  .storage-copy small { color: #a8bcb4; font-size: calc(10px * var(--text-scale)); font-weight: 500; }
  .storage-copy p, .health-card p { margin-top: 5px; color: rgb(237 248 242 / 52%); font-size: calc(8px * var(--text-scale)); }
  .health-card div > span { color: #708d80; } .health-card p { color: #819087; }
  .health-icon { display: grid; width: 37px; height: 37px; color: #368766; background: #fff; border: 1px solid #cfe0d6; border-radius: 11px; font-size: calc(16px * var(--text-scale)); place-items: center; }
  .quota-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-top: 11px; }
  .quota-panel { padding: 16px; background: #fbfcfb; border: 1px solid #e0e6e2; border-radius: 13px; }
  .quota-panel header { gap: 10px; padding-bottom: 13px; border-bottom: 1px solid #e7ebe8; }
  .service-icon { display: grid; width: 30px; height: 30px; color: #704817; background: #fff1dd; border-radius: 8px; font-size: calc(10px * var(--text-scale)); font-weight: 800; place-items: center; }
  .service-icon.d1 { color: #315f92; background: #e8f2fb; }
  .service-icon.r2 { color: #7b4935; background: #f6e9e2; }
  .service-icon.turn { color: #315f92; background: #e8f2fb; }
  .service-icon.limits { color: #5f557e; background: #eeebf7; font-size: calc(14px * var(--text-scale)); }
  .quota-panel h3 { font-size: calc(11px * var(--text-scale)); } .quota-panel header p { margin-top: 2px; color: #8b948e; font-size: calc(8px * var(--text-scale)); }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px; padding-top: 14px; }
  .metric-grid strong, .metric-grid span { display: block; }
  .metric-grid strong { color: #263b32; font-size: calc(14px * var(--text-scale)); letter-spacing: -.02em; }
  .metric-grid span { margin-top: 3px; color: #919b94; font-size: calc(7px * var(--text-scale)); text-transform: uppercase; letter-spacing: .06em; }
  .usage-meters { display: grid; gap: 12px; padding-top: 14px; }
  .usage-meter > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .usage-meter span { color: #75827a; font-size: calc(8px * var(--text-scale)); }
  .usage-meter strong { color: #2b3d34; font-size: calc(9px * var(--text-scale)); }
  .usage-meter > i { display: block; height: 5px; margin-top: 6px; overflow: hidden; background: #e7ece8; border-radius: 999px; }
  .usage-meter > i > b { display: block; min-width: 2px; height: 100%; background: linear-gradient(90deg, #4f9d7c, #75bea0); border-radius: inherit; transition: width 260ms ease; }
  .mini-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mini-metrics span { color: #8d9690; font-size: calc(7px * var(--text-scale)); }
  .mini-metrics strong { display: block; margin-bottom: 2px; color: #3a4b42; font-size: calc(10px * var(--text-scale)); }
  .limit-strip { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 13px; padding-top: 11px; color: #8b948e; border-top: 1px solid #e8ece9; font-size: calc(7px * var(--text-scale)); }
  .r2-panel .usage-meter > i > b { background: linear-gradient(90deg, #a66e56, #ce9a7e); }
  .turn-panel .usage-meter > i > b { background: linear-gradient(90deg, #4a82aa, #72b3cf); }
  .turn-balance { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .turn-balance div { padding: 9px; background: #f3f7fa; border: 1px solid #e2edf3; border-radius: 8px; }
  .turn-balance strong, .turn-balance span { display: block; }
  .turn-balance strong { color: #2e4856; font-size: calc(11px * var(--text-scale)); }
  .turn-balance span { margin-top: 2px; color: #84949c; font-size: calc(7px * var(--text-scale)); text-transform: uppercase; letter-spacing: .05em; }
  .limits-panel .metric-grid { grid-template-columns: repeat(3, 1fr); }
  .analytics-unavailable { display: flex; align-items: center; gap: 12px; min-height: 92px; padding: 18px; color: #6b756f; background: #f8faf8; border: 1px dashed #ced8d1; border-radius: 12px; }
  .analytics-unavailable > span { display: grid; width: 30px; height: 30px; flex: none; color: #8c694b; background: #f4eadf; border-radius: 9px; font-weight: 750; place-items: center; }
  .analytics-unavailable strong { display: block; color: #34433b; font-size: calc(10px * var(--text-scale)); }
  .analytics-unavailable p { margin-top: 4px; font-size: calc(8px * var(--text-scale)); }
  .capacity-note { display: flex; align-items: center; gap: 7px; margin: 12px 2px 0; color: #7e8982; font-size: calc(8px * var(--text-scale)); }
  .capacity-note span { display: grid; width: 14px; height: 14px; color: #628376; background: #e9f0ec; border-radius: 50%; place-items: center; }
  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 13px; }
  .stat-row article { padding: 12px 13px; background: #f7f9f7; border: 1px solid #e2e7e3; border-radius: 10px; }
  .stat-row span, .stat-row strong, .stat-row small { display: block; }
  .stat-row span { color: #7c8981; font-size: calc(8px * var(--text-scale)); } .stat-row strong { margin-top: 5px; font-size: calc(18px * var(--text-scale)); } .stat-row strong.green { color: #3f966e; }
  .stat-row small { margin-top: 2px; color: #a0a7a2; font-size: calc(7px * var(--text-scale)); }
  .users-table { overflow: hidden; border: 1px solid #e0e6e2; border-radius: 11px; }
  .table-head, .user-row { display: grid; grid-template-columns: minmax(160px, 1.6fr) .8fr .8fr .8fr 1fr .45fr; align-items: center; gap: 9px; padding: 0 13px; }
  .table-head { height: 31px; color: #8b958f; background: #f5f7f5; font-size: calc(7px * var(--text-scale)); font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
  .user-row { min-height: 53px; color: #6d7871; border-top: 1px solid #e8ece9; font-size: calc(8px * var(--text-scale)); }
  .user-cell { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .avatar { display: grid; width: 29px; height: 29px; flex: none; color: #31594a; background: linear-gradient(145deg, #deebe5, #bad7cb); border-radius: 8px; font-size: calc(10px * var(--text-scale)); font-weight: 730; place-items: center; }
  .user-cell strong, .user-cell small { display: block; } .user-cell strong { color: #2b3a33; font-size: calc(9px * var(--text-scale)); } .user-cell small { margin-top: 2px; color: #a0a8a3; font-family: ui-monospace, monospace; font-size: calc(6px * var(--text-scale)); }
  mark { padding: 4px 6px; color: #63716a; background: #eef1ef; border-radius: 5px; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  mark.superadmin { color: #785620; background: #f8edcf; }
  .presence { display: flex; align-items: center; gap: 5px; text-transform: capitalize; } .presence i { width: 5px; height: 5px; background: #aeb7b1; border-radius: 50%; } .presence.online { color: #338a64; } .presence.online i { background: #47a979; box-shadow: 0 0 0 3px rgb(71 169 121 / 10%); }
  .sessions { justify-self: center; color: #35483f; font-weight: 700; }
  .error-card { display: grid; min-height: 220px; padding: 30px; background: #fff; border: 1px solid #dce3de; border-radius: 16px; place-items: center; align-content: center; gap: 10px; color: #718078; font-size: calc(10px * var(--text-scale)); text-align: center; }
  .error-card strong { color: #314039; font-size: calc(14px * var(--text-scale)); } .error-card p { margin-bottom: 5px; } .inline-error { margin-bottom: 12px; padding: 9px 11px; color: #8d493f; background: #faeeeb; border-radius: 8px; font-size: calc(9px * var(--text-scale)); }
  @media (max-width: 850px) { .initial-loading, .summary-grid, .quota-groups { grid-template-columns: 1fr; } .initial-field--wide { grid-column: auto; } .table-head, .user-row { grid-template-columns: minmax(140px, 1.5fr) .8fr .8fr .8fr; } .table-head span:nth-child(5), .table-head span:nth-child(6), .user-row > span:nth-child(5), .user-row > span:nth-child(6) { display: none; } }
</style>
